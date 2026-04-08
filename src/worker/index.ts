import { Hono } from "hono";
import {
  createAddressBook,
  associateCustomFieldWithAddressBook,
  fetchCustomFieldsRaw,
  createContactList,
  createCampaign,
  listUnits,
  listAddressBookCustomFields,
  listAddressBooks,
  listQueues,
  listPhoneNumbers,
  listBusinessHours,
  listContactLists,
  listCampaigns,
  deleteCampaign,
  deleteContactList,
  deleteAddressBook,
} from "./zoom-client";
import { getAccessToken } from "./zoom-auth";
import type { ResolvedCampaignRow, CampaignResult, BatchResult, BatchRequest, CleanupDeleteRequest } from "../react-app/types";

interface AppEnv extends Env {
  ZOOM_ACCOUNT_ID: string;
  ZOOM_CLIENT_ID: string;
  ZOOM_CLIENT_SECRET: string;
}

const app = new Hono<{ Bindings: AppEnv }>();

// Return all catalog data needed for the confirm screen in one request
app.get("/api/catalog", async (c) => {
  // Pre-warm token so parallel calls share it
  await getAccessToken(c.env);

  const [queues, phoneNumbers, businessHours, contactLists, units, addressBookCustomFields] = await Promise.all([
    listQueues(c.env),
    listPhoneNumbers(c.env),
    listBusinessHours(c.env),
    listContactLists(c.env),
    listUnits(c.env),
    listAddressBookCustomFields(c.env),
  ]);

  return c.json({ queues, phoneNumbers, businessHours, contactLists, units, addressBookCustomFields });
});

// Execute batch campaign creation
app.post("/api/campaigns/batch", async (c) => {
  let rows: ResolvedCampaignRow[];
  let unit_id: string;
  try {
    const body = await c.req.json<BatchRequest>();
    rows = body.rows;
    unit_id = body.unit_id;
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  if (!unit_id) {
    return c.json({ error: "unit_id is required" }, 400);
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return c.json({ error: "No campaign rows provided" }, 400);
  }

  const results: CampaignResult[] = [];

  for (const row of rows) {
    const result: CampaignResult = {
      campaign_name: row.campaign_name,
      status: "failed",
      steps: {
        address_book: "pending",
        custom_field: row.custom_field_ids?.length ? "pending" : "skipped",
        contact_list: "pending",
        campaign: "pending",
      },
    };

    // Step 1: Address Book
    let addressBookId: string;
    try {
      const ab = await createAddressBook(
        c.env,
        `${row.campaign_name} Address Book`,
        row.campaign_description || "",
        unit_id
      );
      addressBookId = (ab.address_book_id ?? ab.id) as string;
      result.address_book_id = addressBookId;
      result.steps.address_book = "success";
    } catch (err) {
      result.steps.address_book = "failed";
      result.steps.custom_field = "skipped";
      result.steps.contact_list = "skipped";
      result.steps.campaign = "skipped";
      result.error = `Address Book: ${(err as Error).message}`;
      results.push(result);
      continue;
    }

    // Step 2: Associate custom fields with address book (if selected)
    // Non-fatal: a failure here logs a warning but does not abort contact list / campaign creation.
    if (row.custom_field_ids?.length) {
      try {
        // Fetch the custom fields list once per campaign, then reuse for all PATCHes
        // (avoids N redundant GETs when multiple custom fields are selected)
        const allFields = await fetchCustomFieldsRaw(c.env);
        await Promise.all(
          row.custom_field_ids.map((cfId) =>
            associateCustomFieldWithAddressBook(c.env, cfId, addressBookId, allFields)
          )
        );
        result.steps.custom_field = "success";
      } catch (err) {
        const msg = (err as Error).message;
        // Zoom returns 400 "Invalid field" for address_book_ids when the 50-address-book
        // limit per custom field is reached. Surface a clear message instead of raw API noise.
        const isLimitError = msg.includes("address_book_ids") && msg.includes("Invalid field");
        result.steps.custom_field = "failed";
        result.error = isLimitError
          ? "Custom Field: Zoom limit reached — a custom field cannot be associated with more than 50 address books."
          : `Custom Field: ${msg}`;
        // Continue — contact list and campaign creation are not dependent on custom field success.
      }
    }

    // Step 3: Contact List
    let contactListId: string;
    try {
      const cl = await createContactList(
        c.env,
        `${row.campaign_name} Contact List`,
        row.campaign_description || ""
      );
      contactListId = (cl.contact_list_id ?? cl.id) as string;
      result.contact_list_id = contactListId;
      result.steps.contact_list = "success";
    } catch (err) {
      result.steps.contact_list = "failed";
      result.steps.campaign = "skipped";
      result.error = `Contact List: ${(err as Error).message}`;
      results.push(result);
      continue;
    }

    // Step 4: Campaign
    try {
      const payload: Record<string, unknown> = {
        outbound_campaign_name: row.campaign_name,
        outbound_campaign_description: row.campaign_description || "",
        queue_id: row.queue_id,
        phone_number_id: row.phone_number_id,
        assign_type: "customer",
        dialing_method: row.dialing_method,
        outbound_campaign_priority: row.priority,
        campaign_contact_list_ids: [contactListId],
        enable_max_ring_time: true,
        max_ring_time: row.max_ring_time,
        enable_closure_hour: false,
        closure_set_id: "",
      };

      // Dialing method specific settings
      if (row.dialing_method === "preview") {
        payload.dialing_method_settings = {
          preview_timer: 15,
          dialing_strategy: "automatic",
          enable_skip: true,
          max_skips: 1,
          enable_ignore_preview_notification: false,
        };
      } else if (row.dialing_method === "progressive") {
        payload.dialing_method_settings = {
          enable_amd: false,
          enable_abandonment_timeout: false,
          abandonment_timeout: 5,
        };
      }

      // Business hours — only when explicitly selected
      if (row.business_hour_id) {
        payload.business_hour_source = "campaign";
        payload.business_hour_id = row.business_hour_id;
      }

      // DNC — only include exclusion_logic when a DNC list is present
      if (row.dnc_list_id) {
        payload.campaign_do_not_contact_list_ids = [row.dnc_list_id];
        payload.exclusion_logic = "and";
      }

      const camp = await createCampaign(c.env, payload);
      result.campaign_id = (camp.id ?? camp.campaign_id) as string | undefined;
      result.steps.campaign = "success";
      result.status = "success";
    } catch (err) {
      result.steps.campaign = "failed";
      result.error = `Campaign: ${(err as Error).message}`;
    }

    results.push(result);
  }

  const summary: BatchResult = {
    total: results.length,
    succeeded: results.filter((r) => r.status === "success").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
    timestamp: new Date().toISOString(),
  };

  return c.json(summary);
});

// Fetch all deletable resources for the cleanup view
app.get("/api/cleanup", async (c) => {
  await getAccessToken(c.env);

  async function safeList<T>(fn: () => Promise<T[]>): Promise<{ items: T[]; error?: string }> {
    try {
      return { items: await fn() };
    } catch (err) {
      return { items: [], error: (err as Error).message };
    }
  }

  const [campaignsResult, contactListsResult, unitsResult] = await Promise.all([
    safeList(() => listCampaigns(c.env)),
    safeList(() => listContactLists(c.env)),
    safeList(() => listUnits(c.env)),
  ]);

  // Fetch address books for each unit in parallel
  const addressBookResults = await Promise.all(
    unitsResult.items.map((u) => safeList(() => listAddressBooks(c.env, u.id)))
  );
  const allAddressBooks = addressBookResults.flatMap((r) => r.items);
  const addressBookError = addressBookResults.find((r) => r.error)?.error ?? unitsResult.error;

  return c.json({
    campaigns: campaignsResult.items,
    contactLists: contactListsResult.items,
    addressBooks: allAddressBooks,
    errors: {
      campaigns: campaignsResult.error,
      contactLists: contactListsResult.error,
      addressBooks: addressBookError,
    },
  });
});

// Bulk delete selected resources
app.post("/api/cleanup/delete", async (c) => {
  const { campaign_ids = [], contact_list_ids = [], address_book_ids = [] } =
    await c.req.json<CleanupDeleteRequest>();

  async function deleteAll(
    ids: string[],
    fn: (id: string) => Promise<void>
  ): Promise<{ id: string; status: "deleted" | "failed"; error?: string }[]> {
    return Promise.all(
      ids.map(async (id) => {
        try {
          await fn(id);
          return { id, status: "deleted" as const };
        } catch (err) {
          return { id, status: "failed" as const, error: (err as Error).message };
        }
      })
    );
  }

  const [campaigns, contactLists, addressBooks] = await Promise.all([
    deleteAll(campaign_ids, (id) => deleteCampaign(c.env, id)),
    deleteAll(contact_list_ids, (id) => deleteContactList(c.env, id)),
    deleteAll(address_book_ids, (id) => deleteAddressBook(c.env, id)),
  ]);

  return c.json({ campaigns, contactLists, addressBooks });
});

export default app;
