import { useRef, useState } from "react";
import Papa from "papaparse";
import type { CampaignRow, ParseError } from "../types";
import { cleanMojibake, normalizeKey } from "../lib/resolver";

interface Props {
  onParsed: (rows: CampaignRow[], errors: ParseError[], filename: string) => void;
}

const VALID_DIALING: CampaignRow["dialing_method"][] = ["preview", "progressive", "agentless"];

// Normalize CSV header names to canonical snake_case keys so a file can use
// "Queue / Clinic", "Primary DID", "Campaign Name", etc. and still parse.
const HEADER_ALIASES: Record<string, string> = {
  "organization": "organization",
  "org": "organization",
  "queue / clinic": "queue",
  "queue/clinic": "queue",
  "queue": "queue",
  "clinic": "queue",
  "queue_name": "queue",
  "primary did": "primary_did",
  "primary_did": "primary_did",
  "did": "primary_did",
  "phone": "primary_did",
  "campaign": "campaign",
  "priority": "priority",
  "dialing method": "dialing_method",
  "dialing_method": "dialing_method",
  "campaign name": "campaign_name",
  "campaign_name": "campaign_name",
  "campaign description": "campaign_description",
  "campaign_description": "campaign_description",
  "max attempts": "max_attempts",
  "max_attempts": "max_attempts",
  "dial sequence": "dial_sequence",
  "dial_sequence": "dial_sequence",
  "max ring time": "max_ring_time",
  "max_ring_time": "max_ring_time",
  "retry period": "retry_period",
  "retry_period": "retry_period",
};

function normalizeHeader(h: string): string {
  const lower = h.toLowerCase().trim().replace(/\s+/g, " ");
  return HEADER_ALIASES[lower] ?? lower.replace(/\s+/g, "_");
}

function isNewFormatRow(r: Record<string, string>): boolean {
  // organization is optional; queue + primary_did + campaign signal the new format.
  return (
    typeof r.queue === "string" &&
    typeof r.primary_did === "string" &&
    typeof r.campaign === "string"
  );
}

function parseRows(raw: Record<string, string>[]): {
  rows: CampaignRow[];
  errors: ParseError[];
} {
  const rows: CampaignRow[] = [];
  const errors: ParseError[] = [];
  const newFormat = raw.length > 0 && isNewFormatRow(raw[0]);

  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const rowNum = i + 1;

    if (newFormat) {
      const organization = r.organization?.trim() ?? "";
      const queueName = r.queue?.trim();
      const primaryDid = r.primary_did?.trim();
      const campaignSuffix = r.campaign?.trim();

      if (!queueName) {
        errors.push({ row: rowNum, message: "Missing required field: queue" });
        continue;
      }
      if (!primaryDid) {
        errors.push({ row: rowNum, message: "Missing required field: primary_did" });
        continue;
      }
      if (!campaignSuffix) {
        errors.push({ row: rowNum, message: "Missing required field: campaign" });
        continue;
      }

      const rawMethod = r.dialing_method?.trim() || "preview";
      const method = rawMethod as CampaignRow["dialing_method"];
      if (!VALID_DIALING.includes(method)) {
        errors.push({
          row: rowNum,
          message: `Invalid dialing_method "${rawMethod}" — must be preview, progressive, or agentless`,
        });
        continue;
      }

      const orgClean = cleanMojibake(organization);
      const queueClean = cleanMojibake(queueName);
      const suffixClean = cleanMojibake(campaignSuffix);

      // Build the campaign name:
      // - No org → just "queue suffix"
      // - Org matches queue (e.g. "YJH, YJH") → collapse to "queue suffix"
      // - Otherwise → "org queue suffix"
      const orgKey = normalizeKey(orgClean);
      const queueKey = normalizeKey(queueClean);
      const prefix = orgClean && orgKey !== queueKey ? `${orgClean} ${queueClean}` : queueClean;
      const campaign_name = `${prefix} ${suffixClean}`.replace(/\s+/g, " ").trim();

      rows.push({
        campaign_name,
        campaign_description: r.campaign_description?.trim() || "",
        dialing_method: method,
        priority: r.priority ? Number(r.priority) : 5,
        max_attempts: r.max_attempts ? Number(r.max_attempts) : 3,
        dial_sequence: r.dial_sequence?.trim() || "list_dial",
        max_ring_time: r.max_ring_time ? Number(r.max_ring_time) : 60,
        retry_period: r.retry_period ? Number(r.retry_period) : 60,
        organization: orgClean || undefined,
        queue_name: queueClean,
        primary_did: primaryDid,
        campaign_suffix: suffixClean,
      });
      continue;
    }

    // Legacy single-row format
    if (!r.campaign_name?.trim()) {
      errors.push({ row: rowNum, message: "Missing required field: campaign_name" });
      continue;
    }
    if (!r.dialing_method?.trim()) {
      errors.push({ row: rowNum, message: "Missing required field: dialing_method" });
      continue;
    }

    const method = r.dialing_method.trim() as CampaignRow["dialing_method"];
    if (!VALID_DIALING.includes(method)) {
      errors.push({
        row: rowNum,
        message: `Invalid dialing_method "${r.dialing_method}" — must be preview, progressive, or agentless`,
      });
      continue;
    }

    rows.push({
      campaign_name: r.campaign_name.trim(),
      campaign_description: r.campaign_description?.trim() || "",
      dialing_method: method,
      priority: r.priority ? Number(r.priority) : 5,
      max_attempts: r.max_attempts ? Number(r.max_attempts) : 3,
      dial_sequence: r.dial_sequence?.trim() || "list_dial",
      max_ring_time: r.max_ring_time ? Number(r.max_ring_time) : 60,
      retry_period: r.retry_period ? Number(r.retry_period) : 60,
    });
  }

  return { rows, errors };
}

export default function UploadView({ onParsed }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [parseErr, setParseErr] = useState<string | null>(null);

  function handleFile(file: File) {
    if (!file.name.endsWith(".csv")) {
      setParseErr("Please upload a .csv file.");
      return;
    }
    setParseErr(null);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: normalizeHeader,
      complete(result) {
        if (result.errors.length > 0) {
          setParseErr(`CSV parse error: ${result.errors[0].message}`);
          return;
        }
        const { rows, errors } = parseRows(result.data);
        onParsed(rows, errors, file.name);
      },
    });
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-slate-800">Campaign Batch Creator</h1>
        <p className="text-slate-500 mt-1 text-sm">
          Upload a CSV file to create Zoom Contact Center outbound campaigns in bulk.
        </p>
      </div>

      <div
        className={`w-full max-w-lg border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
          dragging
            ? "border-blue-400 bg-blue-50"
            : "border-slate-300 hover:border-slate-400 bg-white"
        }`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <svg
          className="mx-auto mb-3 text-slate-400"
          width="40" height="40" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="1.5"
        >
          <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          <polyline points="7 9 12 4 17 9" />
          <line x1="12" y1="4" x2="12" y2="16" />
        </svg>
        <p className="text-slate-600 font-medium">
          {dragging ? "Drop to upload" : "Click or drag & drop a CSV file"}
        </p>
        <p className="text-slate-400 text-xs mt-1">One campaign definition per row</p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={onInputChange}
        />
      </div>

      {parseErr && (
        <div className="w-full max-w-lg bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {parseErr}
        </div>
      )}

      <div className="w-full max-w-lg bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs text-slate-600 space-y-4">
        <div>
          <p className="font-semibold mb-2 text-slate-700">Architecture format (recommended)</p>
          <p className="text-slate-500 mb-2">
            Queue + phone number resolved per-row from the CSV. Campaign name built as
            <span className="font-mono text-slate-700"> "&#123;organization&#125; &#123;queue&#125; &#123;campaign&#125;"</span>.
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            <div><span className="text-slate-900 font-medium">queue</span><span className="text-red-500 ml-1">*</span></div>
            <div><span className="text-slate-900 font-medium">primary_did</span><span className="text-red-500 ml-1">*</span></div>
            <div><span className="text-slate-900 font-medium">campaign</span><span className="text-red-500 ml-1">*</span></div>
            <div>organization <span className="text-slate-400">(optional prefix)</span></div>
            <div>priority <span className="text-slate-400">(default 5)</span></div>
            <div>dialing_method <span className="text-slate-400">(default preview)</span></div>
          </div>
          <p className="text-slate-500 mt-2">
            Leave organization blank if the Zoom queue name has no prefix. If organization matches the queue value, it's collapsed.
          </p>
        </div>

        <div className="border-t border-slate-200 pt-3">
          <p className="font-semibold mb-2 text-slate-700">Legacy format</p>
          <p className="text-slate-500 mb-2">
            One campaign per row, queue + phone chosen on the confirm screen.
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
            <div><span className="text-slate-900 font-medium">campaign_name</span><span className="text-red-500 ml-1">*</span></div>
            <div><span className="text-slate-900 font-medium">dialing_method</span><span className="text-red-500 ml-1">*</span></div>
            <div>campaign_description</div>
            <div>priority <span className="text-slate-400">(default 5)</span></div>
            <div>max_attempts <span className="text-slate-400">(default 3)</span></div>
            <div>dial_sequence <span className="text-slate-400">(default list_dial)</span></div>
            <div>max_ring_time <span className="text-slate-400">(default 60)</span></div>
            <div>retry_period <span className="text-slate-400">(default 60)</span></div>
          </div>
        </div>

        <p className="text-slate-400 pt-1 border-t border-slate-200">
          <span className="text-red-500">*</span> required · dialing_method: preview, progressive, or agentless
        </p>
      </div>
    </div>
  );
}
