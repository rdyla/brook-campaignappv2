export type DialingMethod = "preview" | "progressive" | "agentless";
export type StepStatus = "pending" | "success" | "failed" | "skipped";

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

// Custom field definition parsed from a `cf:<name>:<data_type>[:v1|v2|…]` column header
export interface CustomFieldDef {
  name: string;
  data_type: CFDataType;
  pick_list_values?: string[];
}

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
  custom_field_defs: CustomFieldDef[];
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

export interface Catalog {
  queues: QueueOption[];
  phoneNumbers: PhoneNumberOption[];
  businessHours: BusinessHourOption[];
  contactLists: ContactListOption[];
}

export interface BatchRequest {
  rows: ResolvedCampaignRow[];
}

// Batch results
export interface CampaignSteps {
  contact_list: StepStatus;
  custom_fields: StepStatus;
  campaign: StepStatus;
}

export interface AttachedCustomField {
  custom_field_id: string;
  custom_field_name: string;
  reused: boolean;
}

export interface CampaignResult {
  campaign_name: string;
  status: "success" | "failed";
  contact_list_id?: string;
  campaign_id?: string;
  custom_fields?: AttachedCustomField[];
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

// ── Contact import ─────────────────────────────────────────────────────────

export type ContactPhoneType = "Main" | "Work" | "Home" | "Mobile" | "Other";

export interface ContactPhone {
  contact_phone_number: string;
  contact_phone_type: ContactPhoneType;
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

export interface ContactImportRequest {
  contacts: ContactPayload[];
}

// Custom field metadata returned by GET /api/contact-lists/:id/custom-fields
export interface ContactListCustomField {
  id: string;
  name: string;
  data_type: CFDataType;
  pick_list_values: string[];
}
