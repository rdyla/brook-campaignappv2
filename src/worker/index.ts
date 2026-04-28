import { Hono } from "hono";
import {
  createContactList,
  createCampaign,
  attachCustomFieldToContactList,
  listContactListCustomFields,
  getCustomFieldsForContactList,
  addContactToList,
  CFLimitError,
  listQueues,
  listPhoneNumbers,
  listBusinessHours,
  listContactLists,
  listCampaigns,
  deleteCampaign,
  deleteContactList,
  type ContactPayload,
} from "./zoom-client";
import { getAccessToken } from "./zoom-auth";
import type {
  ResolvedCampaignRow,
  CampaignResult,
  BatchResult,
  BatchRequest,
  CleanupDeleteRequest,
  ContactImportRequest,
  ContactImportItemResult,
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

  const [queues, phoneNumbers, businessHours, contactLists, existingCampaigns] =
    await Promise.all([
      listQueues(c.env),
      listPhoneNumbers(c.env),
      listBusinessHours(c.env),
      listContactLists(c.env),
      // null status → all campaigns (active + inactive) for dedup checks on import
      listCampaigns(c.env, null).catch(() => [] as { id: string; name: string }[]),
    ]);

  return c.json({
    queues,
    phoneNumbers,
    businessHours,
    contactLists,
    existingCampaigns,
  });
});

// Execute batch campaign creation for a single chunk
app.post("/api/campaigns/batch", async (c) => {
  let rows: ResolvedCampaignRow[];
  try {
    const body = await c.req.json<BatchRequest>();
    rows = body.rows;
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return c.json({ error: "No campaign rows provided" }, 400);
  }

  // Pre-fetch CF snapshot once per chunk; the helper mutates it in place as
  // CFs are created/attached so subsequent rows see the latest state.
  let existingFields = await listContactListCustomFields(c.env);

  const results: CampaignResult[] = [];

  for (const row of rows) {
    const hasCfs = (row.custom_field_defs?.length ?? 0) > 0;
    const result: CampaignResult = {
      campaign_name: row.campaign_name,
      status: "failed",
      steps: {
        contact_list: "pending",
        custom_fields: hasCfs ? "pending" : "skipped",
        campaign: "pending",
      },
      custom_fields: [],
    };

    // Step 1: Contact List
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
      result.steps.custom_fields = "skipped";
      result.steps.campaign = "skipped";
      result.error = `Contact List: ${(err as Error).message}`;
      results.push(result);
      continue;
    }

    // Step 2: Custom fields (attach existing or create fresh, per def).
    // Non-fatal — campaign creation should still proceed if a CF run fails.
    if (hasCfs) {
      try {
        for (const def of row.custom_field_defs!) {
          const attached = await attachCustomFieldToContactList(
            c.env,
            def,
            contactListId,
            existingFields
          );
          result.custom_fields!.push(attached);
        }
        result.steps.custom_fields = "success";
      } catch (err) {
        result.steps.custom_fields = "failed";
        result.error =
          err instanceof CFLimitError
            ? err.message
            : `Custom Fields: ${(err as Error).message}`;
        // Refresh snapshot once on failure in case the partial PATCH succeeded
        // server-side but failed to round-trip; subsequent rows still need a
        // consistent view.
        try {
          existingFields = await listContactListCustomFields(c.env);
        } catch {
          // ignore — we'll work off the stale snapshot
        }
      }
    }

    // Step 3: Campaign
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

// List the custom fields attached to a specific contact list (for contact-import mapping)
app.get("/api/contact-lists/:id/custom-fields", async (c) => {
  const id = c.req.param("id");
  try {
    const fields = await getCustomFieldsForContactList(c.env, id);
    return c.json({ fields });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Import a chunk of contacts into a contact list. Client chunks the upload
// (~200/request) and aggregates progress; concurrency-8 inside each chunk
// keeps total wall time per request under the Cloudflare Worker limit.
app.post("/api/contact-lists/:id/contacts/import", async (c) => {
  const id = c.req.param("id");
  let body: ContactImportRequest;
  try {
    body = await c.req.json<ContactImportRequest>();
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const contacts = body.contacts ?? [];
  if (!Array.isArray(contacts) || contacts.length === 0) {
    return c.json({ error: "No contacts provided" }, 400);
  }

  const concurrency = 8;
  const results: ContactImportItemResult[] = new Array(contacts.length);

  let nextIndex = 0;
  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= contacts.length) return;
      const contact = contacts[i] as ContactPayload;
      try {
        await addContactToList(c.env, id, contact);
        results[i] = {
          index: i,
          status: "success",
          display_name: contact.contact_display_name,
        };
      } catch (err) {
        results[i] = {
          index: i,
          status: "failed",
          display_name: contact.contact_display_name,
          error: (err as Error).message,
        };
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return c.json({ results });
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
