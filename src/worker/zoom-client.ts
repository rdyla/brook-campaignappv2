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
    // Include full response + the payload we sent so errors are debuggable
    throw new Error(
      `HTTP ${r.status} from ${path} | response: ${JSON.stringify(data)} | payload: ${JSON.stringify(body)}`
    );
  }
  return data;
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

export async function listUnits(env: ZoomEnv) {
  type U = { unit_id: string; unit_name: string };
  const items = await fetchAllPages<U>(env, `${CC_BASE}/address_books/units`, "units");
  return items.map((u) => ({ id: u.unit_id, name: u.unit_name }));
}

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

export async function listAddressBooks(env: ZoomEnv, unitId: string) {
  type AB = { address_book_id: string; address_book_name: string };
  const items = await fetchAllPages<AB>(env, `${CC_BASE}/address_books`, "address_books", {
    unit_id: unitId,
  });
  return items.map((ab) => ({ id: ab.address_book_id, name: ab.address_book_name }));
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

// ── Campaign creation functions ────────────────────────────────────────────

export async function createAddressBook(
  env: ZoomEnv,
  name: string,
  description: string,
  unitId: string
): Promise<Record<string, unknown>> {
  return zoomPost(env, "/address_books", {
    unit_id: unitId,
    address_book_name: name,
    address_book_description: description,
  });
}

export async function listAddressBookCustomFields(env: ZoomEnv) {
  type CF = { custom_field_id: string; custom_field_name: string };
  const data = await zoomGet(env, `${CC_BASE}/address_books/custom_fields`);
  const fields = (data.custom_fields as CF[]) ?? [];
  return fields.map((f) => ({ id: f.custom_field_id, name: f.custom_field_name }));
}

export async function associateCustomFieldWithAddressBook(
  env: ZoomEnv,
  customFieldId: string,
  addressBookId: string
): Promise<void> {
  type CF = {
    custom_field_id: string;
    custom_field_name: string;
    custom_field_description?: string;
    data_type: string;
    default_value?: string;
    pick_list_values?: string[];
    address_books?: { address_book_id: string }[];
    use_as_routing_profile_parameter?: boolean;
    use_as_external_url_parameter?: boolean;
    show_in_transferred_calls?: boolean;
    show_in_inbound_notification?: boolean;
    show_in_profile_tab?: boolean;
  };
  const data = await zoomGet(env, `${CC_BASE}/address_books/custom_fields`);
  const fields = (data.custom_fields as CF[]) ?? [];
  const field = fields.find((f) => f.custom_field_id === customFieldId);
  if (!field) throw new Error(`Custom field ${customFieldId} not found`);

  const currentIds = (field.address_books ?? []).map((ab) => ab.address_book_id);
  if (currentIds.includes(addressBookId)) return;

  // PATCH requires the full field definition alongside updated address_book_ids
  const body: Record<string, unknown> = {
    custom_field_name: field.custom_field_name,
    data_type: field.data_type,
    address_book_ids: [...currentIds, addressBookId],
    use_as_routing_profile_parameter: field.use_as_routing_profile_parameter ?? false,
    use_as_external_url_parameter: field.use_as_external_url_parameter ?? false,
    show_in_transferred_calls: field.show_in_transferred_calls ?? false,
    show_in_inbound_notification: field.show_in_inbound_notification ?? false,
    show_in_profile_tab: field.show_in_profile_tab ?? false,
  };
  if (field.custom_field_description) body.custom_field_description = field.custom_field_description;
  if (field.default_value !== undefined) body.default_value = field.default_value;
  if (field.pick_list_values) body.pick_list_values = field.pick_list_values;

  await zoomPatch(env, `/address_books/custom_fields/${customFieldId}`, body);
}

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


// ── Cleanup list + delete functions ───────────────────────────────────────

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

export async function listCampaigns(env: ZoomEnv) {
  type C = { outbound_campaign_id: string; outbound_campaign_name: string };
  const items = await fetchAllPages<C>(
    env,
    `${CC_BASE}/outbound_campaign/campaigns`,
    "outbound_campaign_items",
    { status: "active", page_size: "10" }
  );
  return items.map((c) => ({ id: c.outbound_campaign_id, name: c.outbound_campaign_name }));
}

export async function deleteCampaign(env: ZoomEnv, id: string): Promise<void> {
  return zoomDelete(env, `/outbound_campaign/campaigns/${id}`);
}

export async function deleteContactList(env: ZoomEnv, id: string): Promise<void> {
  return zoomDelete(env, `/outbound_campaign/contact_lists/${id}`);
}

export async function deleteAddressBook(env: ZoomEnv, id: string): Promise<void> {
  return zoomDelete(env, `/address_books/${id}`);
}

// ── Campaign creation functions ────────────────────────────────────────────

export async function createCampaign(
  env: ZoomEnv,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return zoomPost(env, "/outbound_campaign/campaigns", payload);
}
