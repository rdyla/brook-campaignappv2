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
  custom_field_ids?: string[];
}

// Per-row override selections (any field overrides the global default)
export interface RowOverride {
  queue_id?: string;
  phone_number_id?: string;
  business_hour_id?: string;
  dnc_list_id?: string;
  custom_field_ids?: string[];
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

export interface UnitOption {
  id: string;
  name: string;
}

export interface AddressBookCustomFieldOption {
  id: string;
  name: string;
}

export interface ExistingCampaignOption {
  id: string;
  name: string;
}

export interface Catalog {
  queues: QueueOption[];
  phoneNumbers: PhoneNumberOption[];
  businessHours: BusinessHourOption[];
  contactLists: ContactListOption[];
  units: UnitOption[];
  addressBookCustomFields: AddressBookCustomFieldOption[];
  existingCampaigns: ExistingCampaignOption[];
}

export interface BatchRequest {
  rows: ResolvedCampaignRow[];
  unit_id: string;
}

// Batch results
export interface CampaignSteps {
  address_book: StepStatus;
  custom_field: StepStatus;
  contact_list: StepStatus;
  campaign: StepStatus;
}

export interface CampaignResult {
  campaign_name: string;
  status: "success" | "failed";
  address_book_id?: string;
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
  addressBooks: CleanupItem[];
}

export interface CleanupDeleteRequest {
  campaign_ids: string[];
  contact_list_ids: string[];
  address_book_ids: string[];
}

export interface CleanupItemResult {
  id: string;
  status: "deleted" | "failed";
  error?: string;
}

export interface CleanupDeleteResult {
  campaigns: CleanupItemResult[];
  contactLists: CleanupItemResult[];
  addressBooks: CleanupItemResult[];
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
