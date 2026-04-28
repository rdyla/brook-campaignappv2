import { Hono } from "hono";
import {
  createContactList,
  createCampaign,
  listQueues,
  listPhoneNumbers,
  listBusinessHours,
  listContactLists,
  listCampaigns,
  deleteCampaign,
  deleteContactList,
  listAddressBooks,
  createAddressBook,
  attachAllCustomFieldsToAddressBook,
  getCustomFieldsForAddressBook,
  listAddressBookCustomFields,
} from "./zoom-client";
import { getAccessToken } from "./zoom-auth";
import type {
  ResolvedCampaignRow,
  CampaignResult,
  BatchResult,
  BatchRequest,
  CleanupDeleteRequest,
  CreateAddressBookRequest,
  CreateAddressBookResult,
} from "../react-app/types";

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

  const [queues, phoneNumbers, businessHours, contactLists, existingCampaigns, addressBooks] =
    await Promise.all([
      listQueues(c.env),
      listPhoneNumbers(c.env),
      listBusinessHours(c.env),
      listContactLists(c.env),
      // null status → all campaigns (active + inactive) for dedup checks on import
      listCampaigns(c.env, null).catch(() => [] as { id: string; name: string }[]),
      listAddressBooks(c.env).catch(() => [] as Awaited<ReturnType<typeof listAddressBooks>>),
    ]);

  return c.json({
    queues,
    phoneNumbers,
    businessHours,
    contactLists,
    existingCampaigns,
    addressBooks,
  });
});

// Execute batch campaign creation for a single chunk
app.post("/api/campaigns/batch", async (c) => {
  let rows: ResolvedCampaignRow[];
  let addressBookId: string | undefined;
  try {
    const body = await c.req.json<BatchRequest>();
    rows = body.rows;
    addressBookId = body.address_book_id;
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
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
        contact_list: "pending",
        campaign: "pending",
      },
    };

    // Step 1: Contact List (scoped to the chosen address book)
    let contactListId: string;
    try {
      const cl = await createContactList(
        c.env,
        `${row.campaign_name} Contact List`,
        row.campaign_description || "",
        addressBookId
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

    // Step 2: Campaign
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

      if (row.business_hour_id) {
        payload.business_hour_source = "campaign";
        payload.business_hour_id = row.business_hour_id;
      }

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

// Create a new address book and attach every existing org-level custom field
// to it. Returns the new id along with per-CF attach status so the UI can
// surface partial failures.
app.post("/api/address-books", async (c) => {
  let body: CreateAddressBookRequest;
  try {
    body = await c.req.json<CreateAddressBookRequest>();
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }
  const name = body.name?.trim();
  if (!name) {
    return c.json({ error: "Address book name is required" }, 400);
  }

  let id: string;
  try {
    ({ id } = await createAddressBook(c.env, name, body.description ?? ""));
  } catch (err) {
    return c.json({ error: `Create failed: ${(err as Error).message}` }, 500);
  }

  const attachResults = await attachAllCustomFieldsToAddressBook(c.env, id);
  const result: CreateAddressBookResult = {
    id,
    name,
    custom_fields: attachResults,
  };
  return c.json(result);
});

// List CFs attached to a given address book — used by the UI to show "(N
// custom fields attached)" alongside the picker.
app.get("/api/address-books/:id/custom-fields", async (c) => {
  const id = c.req.param("id");
  try {
    const fields = await getCustomFieldsForAddressBook(c.env, id);
    return c.json({ fields });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Diagnostic — probes address-book endpoints directly so we can see Zoom's
// raw responses without the helper layer wrapping them. The exact paths for
// address-book CFs are best-guess; this route makes it easy to confirm and
// adjust.
app.get("/api/diagnostic/address-books", async (c) => {
  const token = await getAccessToken(c.env);
  const probes = [
    "https://api.zoom.us/v2/contact_center/address_books?page_size=10",
    "https://api.zoom.us/v2/contact_center/address_books/custom_fields?page_size=10",
  ];
  const out: Array<{
    url: string;
    status: number;
    statusText: string;
    bodyText: string;
    bodyParsed: unknown;
  }> = [];
  for (const url of probes) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const bodyText = await r.text();
      out.push({
        url,
        status: r.status,
        statusText: r.statusText,
        bodyText,
        bodyParsed: (() => {
          try {
            return JSON.parse(bodyText);
          } catch {
            return null;
          }
        })(),
      });
    } catch (err) {
      out.push({
        url,
        status: 0,
        statusText: "fetch_threw",
        bodyText: (err as Error).message,
        bodyParsed: null,
      });
    }
  }
  return c.json({ probes: out });
});

// Inventory of every org-level CF (used by the diagnostic and as raw data for
// debugging which ABs each CF is attached to).
app.get("/api/diagnostic/address-book-fields", async (c) => {
  try {
    const fields = await listAddressBookCustomFields(c.env);
    return c.json({ count: fields.length, fields });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
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

  const [campaignsResult, contactListsResult] = await Promise.all([
    safeList(() => listCampaigns(c.env)),
    safeList(() => listContactLists(c.env)),
  ]);

  return c.json({
    campaigns: campaignsResult.items,
    contactLists: contactListsResult.items,
    errors: {
      campaigns: campaignsResult.error,
      contactLists: contactListsResult.error,
    },
  });
});

// Bulk delete selected resources
app.post("/api/cleanup/delete", async (c) => {
  const { campaign_ids = [], contact_list_ids = [] } =
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

  const [campaigns, contactLists] = await Promise.all([
    deleteAll(campaign_ids, (id) => deleteCampaign(c.env, id)),
    deleteAll(contact_list_ids, (id) => deleteContactList(c.env, id)),
  ]);

  return c.json({ campaigns, contactLists });
});

export default app;
