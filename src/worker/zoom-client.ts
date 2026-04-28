import { getAccessToken, type ZoomEnv } from "./zoom-auth";

const CC_BASE = "https://api.zoom.us/v2/contact_center";
const PHONE_BASE = "https://api.zoom.us/v2";

async function zoomGet(env: ZoomEnv, url: string): Promise<Record<string, unknown>> {
  const token = await getAccessToken(env);
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await r.json()) as Record<string, unknown>;
  if (!r.ok) {
    const msg = typeof data?.message === "string" ? data.message : JSON.stringify(data);
    throw new Error(msg);
  }
  return data;
}

async function zoomPost(env: ZoomEnv, path: string, body: unknown): Promise<Record<string, unknown>> {
  const token = await getAccessToken(env);
  const url = `${CC_BASE}${path}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await r.json()) as Record<string, unknown>;
  if (!r.ok) {
    throw new Error(
      `HTTP ${r.status} from ${path} | response: ${JSON.stringify(data)} | payload: ${JSON.stringify(body)}`
    );
  }
  return data;
}

async function zoomPatch(env: ZoomEnv, path: string, body: unknown): Promise<Record<string, unknown>> {
  const token = await getAccessToken(env);
  const r = await fetch(`${CC_BASE}${path}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const data = (await r.json()) as Record<string, unknown>;
    throw new Error(
      `HTTP ${r.status} from ${path} | response: ${JSON.stringify(data)} | payload: ${JSON.stringify(body)}`
    );
  }
  const text = await r.text();
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

async function zoomDelete(env: ZoomEnv, path: string): Promise<void> {
  const token = await getAccessToken(env);
  const r = await fetch(`${CC_BASE}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({})) as Record<string, unknown>;
    const msg = typeof data?.message === "string" ? data.message : JSON.stringify(data);
    throw new Error(`HTTP ${r.status}: ${msg}`);
  }
}

async function fetchAllPages<T>(
  env: ZoomEnv,
  baseUrl: string,
  itemsKey: string,
  extraParams: Record<string, string> = {}
): Promise<T[]> {
  const items: T[] = [];
  let nextPageToken = "";
  do {
    const params = new URLSearchParams({ page_size: "100", ...extraParams });
    if (nextPageToken) params.set("next_page_token", nextPageToken);
    const data = await zoomGet(env, `${baseUrl}?${params}`);
    const page = (data[itemsKey] as T[]) ?? [];
    items.push(...page);
    nextPageToken = (data.next_page_token as string) ?? "";
  } while (nextPageToken);
  return items;
}

// ── Catalog list functions ─────────────────────────────────────────────────

export async function listQueues(env: ZoomEnv) {
  type Q = { cc_queue_id: string; queue_name: string };
  const items = await fetchAllPages<Q>(env, `${CC_BASE}/queues`, "queues", {
    channel_type: "voice",
    channel: "voice",
  });
  return items.map((q) => ({ id: q.cc_queue_id, name: q.queue_name }));
}

export async function listPhoneNumbers(env: ZoomEnv) {
  type P = {
    id: string;
    number: string;
    display_name?: string;
    caller_id_name?: string;
  };
  const items = await fetchAllPages<P>(
    env,
    `${PHONE_BASE}/number_management/numbers`,
    "numbers",
    { allocated_product: "ZOOM_CONTACT_CENTER", number_status: "Normal" }
  );
  return items.map((p) => ({
    id: p.id,
    number: p.number,
    label: [p.number, p.caller_id_name || p.display_name].filter(Boolean).join(" — "),
  }));
}

export async function listBusinessHours(env: ZoomEnv) {
  type B = { business_hour_id: string; business_hour_name: string };
  const items = await fetchAllPages<B>(env, `${CC_BASE}/business_hours`, "business_hours");
  return items.map((b) => ({ id: b.business_hour_id, name: b.business_hour_name }));
}

export async function listContactLists(env: ZoomEnv) {
  type C = { contact_list_id: string; contact_list_name: string };
  const items = await fetchAllPages<C>(
    env,
    `${CC_BASE}/outbound_campaign/contact_lists`,
    "contact_lists"
  );
  return items.map((c) => ({ id: c.contact_list_id, name: c.contact_list_name }));
}

// ── Contact list custom fields ─────────────────────────────────────────────

export type CFDataType =
  | "string"
  | "number"
  | "boolean"
  | "email"
  | "phone"
  | "percent"
  | "currency"
  | "date_time"
  | "pick_list";

interface RawContactListCustomField {
  custom_field_id: string;
  custom_field_name: string;
  data_type: CFDataType;
  default_value?: string;
  pick_list_values?: string[];
  contact_list_ids?: string[];
  use_as_routing_profile_parameter?: boolean;
  use_as_external_url_parameter?: boolean;
  show_in_transferred_calls?: boolean;
  allow_third_party_access?: boolean;
  show_in_inbound_notification?: boolean;
  show_in_profile_tab?: boolean;
}

const CF_DEFAULT_FLAGS = {
  use_as_routing_profile_parameter: false,
  use_as_external_url_parameter: false,
  show_in_transferred_calls: true,
  allow_third_party_access: false,
  show_in_inbound_notification: true,
  show_in_profile_tab: false,
} as const;

const CF_LIST_LIMIT = 50;

export async function listContactListCustomFields(env: ZoomEnv): Promise<RawContactListCustomField[]> {
  return fetchAllPages<RawContactListCustomField>(
    env,
    `${CC_BASE}/outbound_campaign/contact_list_custom_fields`,
    "custom_fields"
  );
}

export async function getCustomFieldsForContactList(env: ZoomEnv, contactListId: string) {
  const all = await listContactListCustomFields(env);
  return all
    .filter((f) => f.contact_list_ids?.includes(contactListId))
    .map((f) => ({
      id: f.custom_field_id,
      name: f.custom_field_name,
      data_type: f.data_type,
      pick_list_values: f.pick_list_values ?? [],
    }));
}

interface CustomFieldDef {
  name: string;
  data_type: CFDataType;
  pick_list_values?: string[];
}

export interface CustomFieldAttachResult {
  custom_field_id: string;
  custom_field_name: string;
  reused: boolean;
}

export class CFLimitError extends Error {
  constructor(public readonly fieldName: string) {
    super(
      `Custom field "${fieldName}" is at Zoom's ${CF_LIST_LIMIT}-contact-list limit — rename in CSV (e.g. split UMMHC → UMMHC-A, UMMHC-B)`
    );
    this.name = "CFLimitError";
  }
}

/**
 * Attach a custom field (by name) to a contact list. Reuses an existing CF if
 * one with the same name already exists; otherwise creates a fresh one.
 *
 * The caller passes a pre-fetched `existingFields` snapshot to avoid one GET
 * per CF; this function does NOT mutate that snapshot. The caller should
 * refresh the snapshot after creating new CFs that subsequent rows may reuse.
 */
export async function attachCustomFieldToContactList(
  env: ZoomEnv,
  def: CustomFieldDef,
  contactListId: string,
  existingFields: RawContactListCustomField[]
): Promise<CustomFieldAttachResult> {
  const existing = existingFields.find((f) => f.custom_field_name === def.name);

  if (existing) {
    const currentIds = existing.contact_list_ids ?? [];
    if (currentIds.includes(contactListId)) {
      return {
        custom_field_id: existing.custom_field_id,
        custom_field_name: existing.custom_field_name,
        reused: true,
      };
    }
    if (currentIds.length >= CF_LIST_LIMIT) {
      throw new CFLimitError(def.name);
    }

    const body: Record<string, unknown> = {
      custom_field_name: existing.custom_field_name,
      data_type: existing.data_type,
      contact_list_ids: [...currentIds, contactListId],
      use_as_routing_profile_parameter:
        existing.use_as_routing_profile_parameter ?? CF_DEFAULT_FLAGS.use_as_routing_profile_parameter,
      use_as_external_url_parameter:
        existing.use_as_external_url_parameter ?? CF_DEFAULT_FLAGS.use_as_external_url_parameter,
      show_in_transferred_calls:
        existing.show_in_transferred_calls ?? CF_DEFAULT_FLAGS.show_in_transferred_calls,
      allow_third_party_access:
        existing.allow_third_party_access ?? CF_DEFAULT_FLAGS.allow_third_party_access,
      show_in_inbound_notification:
        existing.show_in_inbound_notification ?? CF_DEFAULT_FLAGS.show_in_inbound_notification,
      show_in_profile_tab: existing.show_in_profile_tab ?? CF_DEFAULT_FLAGS.show_in_profile_tab,
    };
    if (existing.default_value !== undefined) body.default_value = existing.default_value;
    if (existing.pick_list_values?.length) body.pick_list_values = existing.pick_list_values;

    await zoomPatch(
      env,
      `/outbound_campaign/contact_list_custom_fields/${existing.custom_field_id}`,
      body
    );

    // Mutate the snapshot in place so subsequent rows see the updated count
    existing.contact_list_ids = [...currentIds, contactListId];

    return {
      custom_field_id: existing.custom_field_id,
      custom_field_name: existing.custom_field_name,
      reused: true,
    };
  }

  const body: Record<string, unknown> = {
    custom_field_name: def.name,
    data_type: def.data_type,
    contact_list_ids: [contactListId],
    ...CF_DEFAULT_FLAGS,
  };
  if (def.data_type === "pick_list" && def.pick_list_values?.length) {
    body.pick_list_values = def.pick_list_values;
    body.default_value = def.pick_list_values[0];
  }

  const created = await zoomPost(env, "/outbound_campaign/contact_list_custom_fields", body);
  const newId = (created.custom_field_id ?? created.id) as string;

  // Push the freshly-created CF into the snapshot so later rows in the same
  // batch can reuse it without another network round trip.
  existingFields.push({
    custom_field_id: newId,
    custom_field_name: def.name,
    data_type: def.data_type,
    pick_list_values: def.pick_list_values,
    contact_list_ids: [contactListId],
    ...CF_DEFAULT_FLAGS,
  });

  return { custom_field_id: newId, custom_field_name: def.name, reused: false };
}

// ── Contact list + campaign creation ───────────────────────────────────────

export async function createContactList(
  env: ZoomEnv,
  name: string,
  description: string
): Promise<Record<string, unknown>> {
  return zoomPost(env, "/outbound_campaign/contact_lists", {
    contact_list_name: name,
    contact_list_description: description,
    contact_list_type: "contact",
  });
}

export async function createCampaign(
  env: ZoomEnv,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return zoomPost(env, "/outbound_campaign/campaigns", payload);
}

// ── Contact import ─────────────────────────────────────────────────────────

export interface ContactPhone {
  contact_phone_number: string;
  contact_phone_type: "Main" | "Work" | "Home" | "Mobile" | "Other";
}

export interface ContactCustomFieldValue {
  custom_field_id: string;
  custom_field_value: string;
}

export interface ContactPayload {
  contact_display_name: string;
  contact_first_name?: string;
  contact_last_name?: string;
  contact_phones: ContactPhone[];
  contact_emails?: string[];
  contact_location?: string;
  contact_account_number?: string;
  contact_company?: string;
  contact_role?: string;
  contact_timezone?: string;
  custom_fields?: ContactCustomFieldValue[];
}

export async function addContactToList(
  env: ZoomEnv,
  contactListId: string,
  contact: ContactPayload
): Promise<Record<string, unknown>> {
  return zoomPost(
    env,
    `/outbound_campaign/contact_lists/${contactListId}/contacts`,
    contact
  );
}

// ── Cleanup list + delete ──────────────────────────────────────────────────

export async function listCampaigns(env: ZoomEnv, status: string | null = "active") {
  type C = { outbound_campaign_id: string; outbound_campaign_name: string };
  const extraParams: Record<string, string> = { page_size: "10" };
  if (status) extraParams.status = status;
  const items = await fetchAllPages<C>(
    env,
    `${CC_BASE}/outbound_campaign/campaigns`,
    "outbound_campaign_items",
    extraParams
  );
  return items.map((c) => ({ id: c.outbound_campaign_id, name: c.outbound_campaign_name }));
}

export async function deleteCampaign(env: ZoomEnv, id: string): Promise<void> {
  return zoomDelete(env, `/outbound_campaign/campaigns/${id}`);
}

export async function deleteContactList(env: ZoomEnv, id: string): Promise<void> {
  return zoomDelete(env, `/outbound_campaign/contact_lists/${id}`);
}
