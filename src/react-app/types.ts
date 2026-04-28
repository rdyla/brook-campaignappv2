export type DialingMethod = "preview" | "progressive" | "agentless";
export type StepStatus = "pending" | "success" | "failed" | "skipped";

// Fields that come from the CSV — no IDs, only human-knowable values
export interface CampaignRow {
  campaign_name: string;
  campaign_description: string;
  dialing_method: DialingMethod;
  priority: number;
  max_attempts: number;
  dial_sequence: string;
  max_ring_time: number;
  retry_period: number;
  // Raw CSV source fields used by the resolver for per-row queue/DID lookup.
  // Populated only when the CSV uses the new (organization + queue + primary_did + campaign) schema.
  organization?: string;
  queue_name?: string;
  primary_did?: string;
  campaign_suffix?: string;
}

// CampaignRow + IDs resolved via catalog dropdowns — sent to the batch endpoint
export interface ResolvedCampaignRow extends CampaignRow {
  queue_id: string;
  phone_number_id: string;
  business_hour_id?: string;
  dnc_list_id?: string;
}

// Per-row override selections (any field overrides the global default)
export interface RowOverride {
  queue_id?: string;
  phone_number_id?: string;
  business_hour_id?: string;
  dnc_list_id?: string;
}

// Catalog option types returned by GET /api/catalog
export interface QueueOption {
  id: string;
  name: string;
}

export interface PhoneNumberOption {
  id: string;
  number: string;
  label: string;
}

export interface BusinessHourOption {
  id: string;
  name: string;
}

export interface ContactListOption {
  id: string;
  name: string;
}

export interface ExistingCampaignOption {
  id: string;
  name: string;
}

export interface AddressBookOption {
  id: string;
  name: string;
  unit_id: string;
  unit_name: string;
  custom_field_count: number;
  total_contacts?: number;
}

export interface AddressBookUnitOption {
  id: string;
  name: string;
  description?: string;
}

export interface Catalog {
  queues: QueueOption[];
  phoneNumbers: PhoneNumberOption[];
  businessHours: BusinessHourOption[];
  contactLists: ContactListOption[];
  existingCampaigns: ExistingCampaignOption[];
  addressBooks: AddressBookOption[];
  addressBookUnits: AddressBookUnitOption[];
}

export interface BatchRequest {
  rows: ResolvedCampaignRow[];
  // Address book the contact lists are scoped to; required when present in
  // the catalog. Customer's automation later moves contacts AB → list.
  address_book_id?: string;
}

// Batch results
export interface CampaignSteps {
  contact_list: StepStatus;
  campaign: StepStatus;
}

export interface CampaignResult {
  campaign_name: string;
  status: "success" | "failed";
  contact_list_id?: string;
  campaign_id?: string;
  error?: string;
  steps: CampaignSteps;
}

export interface BatchResult {
  total: number;
  succeeded: number;
  failed: number;
  results: CampaignResult[];
  timestamp: string;
}

// Cleanup
export interface CleanupItem {
  id: string;
  name: string;
}

export interface CleanupResources {
  campaigns: CleanupItem[];
  contactLists: CleanupItem[];
}

export interface CleanupDeleteRequest {
  campaign_ids: string[];
  contact_list_ids: string[];
}

export interface CleanupItemResult {
  id: string;
  status: "deleted" | "failed";
  error?: string;
}

export interface CleanupDeleteResult {
  campaigns: CleanupItemResult[];
  contactLists: CleanupItemResult[];
}

export interface ParseError {
  row: number;
  message: string;
}

export interface BatchRun {
  id: string;
  filename: string;
  result: BatchResult;
}

// ── Address book creation ──────────────────────────────────────────────────

export interface CreateAddressBookRequest {
  name: string;
  unit_id: string;
  description?: string;
}

export interface AttachCFToABResult {
  custom_field_id: string;
  custom_field_name: string;
  status: "attached" | "already_attached" | "failed";
  error?: string;
}

export interface CreateAddressBookResult {
  id: string;
  name: string;
  custom_fields: AttachCFToABResult[];
}
