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

// ── Address books ──────────────────────────────────────────────────────────
// Address books are scoped to "units". To list ABs we first GET /units, then
// per unit GET /address_books?unit_id=… and flatten. Creating an AB also
// requires a unit_id in the body.
//
// Custom fields (managed in Zoom UI) get auto-attached to new ABs — we list
// the org-level CF inventory and PATCH each to add the new AB's id to its
// address_book_ids array.

interface RawAddressBookUnit {
  unit_id: string;
  unit_name: string;
  unit_description?: string;
}

export interface AddressBookUnitSummary {
  id: string;
  name: string;
  description?: string;
}

export async function listAddressBookUnits(env: ZoomEnv): Promise<AddressBookUnitSummary[]> {
  const items = await fetchAllPages<RawAddressBookUnit>(
    env,
    `${CC_BASE}/address_books/units`,
    "units"
  );
  return items.map((u) => ({
    id: u.unit_id,
    name: u.unit_name,
    description: u.unit_description,
  }));
}

interface RawAddressBook {
  address_book_id: string;
  address_book_name: string;
  address_book_description?: string;
  total_contacts?: number;
  unit_id?: string;
  unit_name?: string;
}

export interface AddressBookSummary {
  id: string;
  name: string;
  unit_id: string;
  unit_name: string;
  custom_field_count: number;
  total_contacts?: number;
}

export async function listAddressBooks(env: ZoomEnv): Promise<AddressBookSummary[]> {
  const units = await listAddressBookUnits(env);
  const all: AddressBookSummary[] = [];
  for (const unit of units) {
    const items = await fetchAllPages<RawAddressBook>(
      env,
      `${CC_BASE}/address_books`,
      "address_books",
      { unit_id: unit.id }
    );
    for (const a of items) {
      all.push({
        id: a.address_book_id,
        name: a.address_book_name,
        unit_id: a.unit_id ?? unit.id,
        unit_name: a.unit_name ?? unit.name,
        custom_field_count: 0,
        total_contacts: a.total_contacts,
      });
    }
  }
  // Fill in CF counts. Soft-fail if the CF endpoint isn't reachable — better
  // to show ABs with "0 fields" than to fail the whole catalog load.
  let cfs: RawAddressBookCustomField[] = [];
  try {
    cfs = await listAddressBookCustomFields(env);
  } catch {
    // ignored
  }
  for (const ab of all) {
    ab.custom_field_count = cfs.filter((f) => (f.address_book_ids ?? []).includes(ab.id)).length;
  }
  return all;
}

export async function createAddressBook(
  env: ZoomEnv,
  name: string,
  unitId: string,
  description = ""
): Promise<{ id: string }> {
  const created = await zoomPost(env, "/address_books", {
    address_book_name: name,
    address_book_description: description,
    unit_id: unitId,
  });
  const id = (created.address_book_id ?? created.id) as string;
  if (!id) {
    throw new Error(
      `Address book create returned no id — Zoom response: ${JSON.stringify(created)}`
    );
  }
  return { id };
}

// ── Address-book custom fields ─────────────────────────────────────────────
// Custom fields are created in Zoom's UI; we only list and attach them to
// new address books. The endpoint paths below are best-guess based on the
// pattern Zoom uses for contact-list custom fields — verify with
// /api/diagnostic/address-books before relying on them in prod.

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

interface RawAddressBookCustomField {
  custom_field_id: string;
  custom_field_name: string;
  data_type: CFDataType;
  default_value?: string;
  pick_list_values?: string[];
  address_book_ids?: string[];
  use_as_routing_profile_parameter?: boolean;
  use_as_external_url_parameter?: boolean;
  show_in_transferred_calls?: boolean;
  allow_third_party_access?: boolean;
  show_in_inbound_notification?: boolean;
  show_in_profile_tab?: boolean;
}

export async function listAddressBookCustomFields(
  env: ZoomEnv
): Promise<RawAddressBookCustomField[]> {
  return fetchAllPages<RawAddressBookCustomField>(
    env,
    `${CC_BASE}/address_books/custom_fields`,
    "custom_fields"
  );
}

export async function getCustomFieldsForAddressBook(env: ZoomEnv, addressBookId: string) {
  const all = await listAddressBookCustomFields(env);
  return all
    .filter((f) => f.address_book_ids?.includes(addressBookId))
    .map((f) => ({
      id: f.custom_field_id,
      name: f.custom_field_name,
      data_type: f.data_type,
      pick_list_values: f.pick_list_values ?? [],
    }));
}

export interface AttachCFToABResult {
  custom_field_id: string;
  custom_field_name: string;
  status: "attached" | "already_attached" | "failed";
  error?: string;
}

async function attachCustomFieldToAddressBook(
  env: ZoomEnv,
  field: RawAddressBookCustomField,
  addressBookId: string
): Promise<AttachCFToABResult> {
  const currentIds = field.address_book_ids ?? [];
  if (currentIds.includes(addressBookId)) {
    return {
      custom_field_id: field.custom_field_id,
      custom_field_name: field.custom_field_name,
      status: "already_attached",
    };
  }
  const body: Record<string, unknown> = {
    custom_field_name: field.custom_field_name,
    data_type: field.data_type,
    address_book_ids: [...currentIds, addressBookId],
  };
  if (field.default_value !== undefined) body.default_value = field.default_value;
  if (field.pick_list_values?.length) body.pick_list_values = field.pick_list_values;
  if (field.use_as_routing_profile_parameter !== undefined)
    body.use_as_routing_profile_parameter = field.use_as_routing_profile_parameter;
  if (field.use_as_external_url_parameter !== undefined)
    body.use_as_external_url_parameter = field.use_as_external_url_parameter;
  if (field.show_in_transferred_calls !== undefined)
    body.show_in_transferred_calls = field.show_in_transferred_calls;
  if (field.allow_third_party_access !== undefined)
    body.allow_third_party_access = field.allow_third_party_access;
  if (field.show_in_inbound_notification !== undefined)
    body.show_in_inbound_notification = field.show_in_inbound_notification;
  if (field.show_in_profile_tab !== undefined)
    body.show_in_profile_tab = field.show_in_profile_tab;

  await zoomPatch(env, `/address_books/custom_fields/${field.custom_field_id}`, body);
  return {
    custom_field_id: field.custom_field_id,
    custom_field_name: field.custom_field_name,
    status: "attached",
  };
}

export async function attachAllCustomFieldsToAddressBook(
  env: ZoomEnv,
  addressBookId: string
): Promise<AttachCFToABResult[]> {
  const fields = await listAddressBookCustomFields(env);
  const results: AttachCFToABResult[] = [];
  for (const f of fields) {
    try {
      results.push(await attachCustomFieldToAddressBook(env, f, addressBookId));
    } catch (err) {
      results.push({
        custom_field_id: f.custom_field_id,
        custom_field_name: f.custom_field_name,
        status: "failed",
        error: (err as Error).message,
      });
    }
  }
  return results;
}

// ── Contact list + campaign creation ───────────────────────────────────────

export async function createContactList(
  env: ZoomEnv,
  name: string,
  description: string,
  addressBookId?: string
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    contact_list_name: name,
    contact_list_description: description,
    contact_list_type: "contact",
  };
  if (addressBookId) body.address_book_id = addressBookId;
  return zoomPost(env, "/outbound_campaign/contact_lists", body);
}

export async function createCampaign(
  env: ZoomEnv,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return zoomPost(env, "/outbound_campaign/campaigns", payload);
}

export async function getCampaign(
  env: ZoomEnv,
  id: string
): Promise<Record<string, unknown>> {
  return zoomGet(env, `${CC_BASE}/outbound_campaign/campaigns/${id}`);
}

// Fields the GET endpoint returns but the PATCH endpoint won't accept on
// merge-back. Includes:
//   - read-only / derived (id, queue_name, status)
//   - response-side aggregate `campaign_contact_list` → translated to its
//     writable form `campaign_contact_list_ids`
//   - `outbound_campaign_name`: Zoom server-side bug — PATCHing a campaign
//     with its own current name fails with "Campaign name must be unique"
//     because the validator counts the campaign itself as a collision.
//     If the caller explicitly wants to rename, their patch wins via merge.
const READ_ONLY_CAMPAIGN_KEYS = new Set([
  "outbound_campaign_id",
  "outbound_campaign_name",
  "queue_name",
  "outbound_campaign_status",
  "campaign_contact_list",
  // Priority appears to be in a limited slot pool (~5 slots). Re-sending
  // the campaign's current priority on PATCH can trigger a uniqueness/slot
  // collision against itself or sibling campaigns. Strip from the merge
  // body; an explicit patch wins via merge.
  "outbound_campaign_priority",
]);

// Patch the campaign by mirroring what Zoom's UI does: GET the current
// config, merge the requested fields on top, then PATCH the full result.
// This sidesteps partial-body validation errors (code 100908) where Zoom
// requires co-fields to ride along with whatever you're changing.
export async function patchCampaign(
  env: ZoomEnv,
  id: string,
  patch: Record<string, unknown>
): Promise<void> {
  const current = await getCampaign(env, id);

  const writable: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(current)) {
    if (READ_ONLY_CAMPAIGN_KEYS.has(k)) continue;
    writable[k] = v;
  }

  const list = current.campaign_contact_list as
    | Array<{ contact_list_id: string }>
    | undefined;
  if (list?.length) {
    writable.campaign_contact_list_ids = list.map((c) => c.contact_list_id);
  }

  // Zoom returns business_hour_id: "1" as a sentinel for "no campaign-level
  // override" but the PATCH validator then rejects "1" as a missing business
  // hour (error 5011). Drop both BH fields so the campaign's stored value
  // stays as-is. Caller's patch wins via merge below if they actually want
  // to set BH.
  if (writable.business_hour_id === "1") {
    delete writable.business_hour_id;
    delete writable.business_hour_source;
  }

  // Zoom's PATCH validator rejects bodies missing fields it considers
  // required even when the caller didn't intend to change them. Campaigns
  // created via API often have these unset because the create payload
  // omits them; we backfill conservative defaults so the merged body
  // validates. Caller's explicit patch always wins via the spread below.
  if (writable.contact_order == null) {
    writable.contact_order = 1;
  }
  if (writable.contact_phone_order == null) {
    writable.contact_phone_order = "1,2,3,4,5";
  }

  const merged = { ...writable, ...patch };
  await zoomPatch(env, `/outbound_campaign/campaigns/${id}`, merged);
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
