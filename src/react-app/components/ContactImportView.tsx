import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import type {
  ContactListOption,
  ContactListCustomField,
  ContactPayload,
  ContactPhone,
  ContactPhoneType,
} from "../types";

type Stage = "pick-list" | "upload" | "map" | "importing" | "done";

interface ProgressItem {
  index: number;
  status: "success" | "failed";
  display_name: string;
  error?: string;
}

const STANDARD_FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: "contact_display_name", label: "Display name", required: true },
  { key: "contact_first_name", label: "First name" },
  { key: "contact_last_name", label: "Last name" },
  { key: "contact_location", label: "Location" },
  { key: "contact_account_number", label: "Account number" },
  { key: "contact_company", label: "Company" },
  { key: "contact_role", label: "Role" },
  { key: "contact_timezone", label: "Timezone" },
];

const PHONE_TYPES: ContactPhoneType[] = ["Main", "Work", "Home", "Mobile", "Other"];

interface Mapping {
  // standard field key → CSV column name (or empty)
  standard: Record<string, string>;
  // phone type → CSV column name
  phones: Partial<Record<ContactPhoneType, string>>;
  // email index (1..4) → CSV column name
  emails: Record<number, string>;
  // custom field id → CSV column name
  customFields: Record<string, string>;
}

function autoSuggestColumn(target: string, columns: string[]): string {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
  const t = norm(target);
  const exact = columns.find((c) => norm(c) === t);
  if (exact) return exact;
  const partial = columns.find((c) => norm(c).includes(t) || t.includes(norm(c)));
  return partial ?? "";
}

function buildContactPayload(
  row: Record<string, string>,
  mapping: Mapping,
  customFields: ContactListCustomField[]
): { ok: true; contact: ContactPayload } | { ok: false; reason: string } {
  const get = (col: string) => (col ? (row[col] ?? "").trim() : "");

  const display = get(mapping.standard.contact_display_name);
  if (!display) return { ok: false, reason: "Missing display name" };

  const phones: ContactPhone[] = [];
  for (const type of PHONE_TYPES) {
    const col = mapping.phones[type];
    if (!col) continue;
    const num = get(col);
    if (!num) continue;
    phones.push({ contact_phone_number: num, contact_phone_type: type });
  }
  if (phones.length === 0) return { ok: false, reason: "No phone numbers" };
  if (phones.length > 5) phones.length = 5;

  const emails: string[] = [];
  for (let i = 1; i <= 4; i++) {
    const col = mapping.emails[i];
    if (!col) continue;
    const v = get(col);
    if (v) emails.push(v);
  }

  const cfValues = customFields
    .map((cf) => {
      const col = mapping.customFields[cf.id];
      if (!col) return null;
      const v = get(col);
      if (!v) return null;
      return { custom_field_id: cf.id, custom_field_value: v };
    })
    .filter((v): v is { custom_field_id: string; custom_field_value: string } => v !== null);

  const contact: ContactPayload = {
    contact_display_name: display,
    contact_phones: phones,
  };

  for (const f of STANDARD_FIELDS) {
    if (f.key === "contact_display_name") continue;
    const v = get(mapping.standard[f.key]);
    if (v) (contact as unknown as Record<string, string>)[f.key] = v;
  }
  if (emails.length) contact.contact_emails = emails;
  if (cfValues.length) contact.custom_fields = cfValues;

  return { ok: true, contact };
}

export default function ContactImportView() {
  const [stage, setStage] = useState<Stage>("pick-list");

  // List picker
  const [lists, setLists] = useState<ContactListOption[]>([]);
  const [listsLoading, setListsLoading] = useState(false);
  const [listsError, setListsError] = useState<string | null>(null);
  const [selectedListId, setSelectedListId] = useState("");
  const [listFilter, setListFilter] = useState("");

  // CFs of the picked list
  const [customFields, setCustomFields] = useState<ContactListCustomField[]>([]);
  const [cfLoading, setCfLoading] = useState(false);
  const [cfError, setCfError] = useState<string | null>(null);

  // CSV
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [filename, setFilename] = useState("");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvError, setCsvError] = useState<string | null>(null);

  // Mapping
  const [mapping, setMapping] = useState<Mapping>({
    standard: {},
    phones: {},
    emails: {},
    customFields: {},
  });

  // Import progress
  const [importTotal, setImportTotal] = useState(0);
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [importError, setImportError] = useState<string | null>(null);

  // Load contact lists once
  useEffect(() => {
    setListsLoading(true);
    fetch("/api/catalog")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { contactLists: ContactListOption[] }) => {
        setLists(data.contactLists);
      })
      .catch((err: Error) => setListsError(err.message))
      .finally(() => setListsLoading(false));
  }, []);

  async function handlePickList(id: string) {
    setSelectedListId(id);
    setCfLoading(true);
    setCfError(null);
    setCustomFields([]);
    try {
      const r = await fetch(`/api/contact-lists/${id}/custom-fields`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { fields: ContactListCustomField[] };
      setCustomFields(data.fields);
      setStage("upload");
    } catch (err) {
      setCfError((err as Error).message);
    } finally {
      setCfLoading(false);
    }
  }

  function handleFile(file: File) {
    setCsvError(null);
    if (!file.name.endsWith(".csv")) {
      setCsvError("Please upload a .csv file.");
      return;
    }
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete(result) {
        if (result.errors.length > 0) {
          setCsvError(`CSV parse error: ${result.errors[0].message}`);
          return;
        }
        const headers = result.meta.fields ?? [];
        setFilename(file.name);
        setCsvHeaders(headers);
        setCsvRows(result.data);
        setMapping(buildAutoMapping(headers, customFields));
        setStage("map");
      },
    });
  }

  function buildAutoMapping(
    headers: string[],
    cfs: ContactListCustomField[]
  ): Mapping {
    const standard: Record<string, string> = {};
    for (const f of STANDARD_FIELDS) {
      standard[f.key] = autoSuggestColumn(f.key.replace(/^contact_/, ""), headers);
    }
    const phones: Mapping["phones"] = {};
    for (const t of PHONE_TYPES) {
      const col = autoSuggestColumn(`phone_${t}`, headers) || autoSuggestColumn(`${t}_phone`, headers);
      if (col) phones[t] = col;
    }
    // If no per-type phones matched, try a generic "phone" column → Main
    if (Object.keys(phones).length === 0) {
      const generic = autoSuggestColumn("phone", headers);
      if (generic) phones.Main = generic;
    }
    const emails: Mapping["emails"] = {};
    for (let i = 1; i <= 4; i++) {
      const col = autoSuggestColumn(`email_${i}`, headers) || (i === 1 ? autoSuggestColumn("email", headers) : "");
      if (col) emails[i] = col;
    }
    const customFieldMap: Record<string, string> = {};
    for (const cf of cfs) {
      customFieldMap[cf.id] = autoSuggestColumn(cf.name, headers);
    }
    return { standard, phones, emails, customFields: customFieldMap };
  }

  const validRowsPreview = useMemo(() => {
    if (csvRows.length === 0) return { valid: 0, invalid: 0, firstError: "" };
    let valid = 0;
    let invalid = 0;
    let firstError = "";
    for (const row of csvRows) {
      const result = buildContactPayload(row, mapping, customFields);
      if (result.ok) valid++;
      else {
        invalid++;
        if (!firstError) firstError = result.reason;
      }
    }
    return { valid, invalid, firstError };
  }, [csvRows, mapping, customFields]);

  async function handleImport() {
    setStage("importing");
    setProgress([]);
    setImportError(null);

    const contacts: ContactPayload[] = [];
    const skippedAtBuild: { rowNum: number; reason: string }[] = [];
    csvRows.forEach((row, i) => {
      const result = buildContactPayload(row, mapping, customFields);
      if (result.ok) contacts.push(result.contact);
      else skippedAtBuild.push({ rowNum: i + 1, reason: result.reason });
    });

    setImportTotal(contacts.length);

    if (contacts.length === 0) {
      setImportError("No valid contacts to import. Check your column mapping.");
      setStage("map");
      return;
    }

    try {
      const r = await fetch(`/api/contact-lists/${selectedListId}/contacts/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts }),
      });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);

      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE frames terminated by \n\n
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          const lines = frame.split("\n");
          let event = "message";
          let data = "";
          for (const line of lines) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data = line.slice(5).trim();
          }
          if (!data) continue;

          if (event === "progress") {
            const item = JSON.parse(data) as ProgressItem;
            setProgress((prev) => [...prev, item]);
          } else if (event === "done") {
            setStage("done");
          }
        }
      }
    } catch (err) {
      setImportError((err as Error).message);
      setStage("map");
    }
  }

  function reset() {
    setStage("pick-list");
    setSelectedListId("");
    setCustomFields([]);
    setCsvHeaders([]);
    setCsvRows([]);
    setFilename("");
    setMapping({ standard: {}, phones: {}, emails: {}, customFields: {} });
    setProgress([]);
    setImportError(null);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const filteredLists = useMemo(
    () =>
      lists.filter((l) => l.name.toLowerCase().includes(listFilter.toLowerCase())),
    [lists, listFilter]
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Import Contacts</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Add contacts to an existing campaign's contact list, with values for each custom field.
          </p>
        </div>
        {stage !== "pick-list" && (
          <button
            onClick={reset}
            className="px-3 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            Start over
          </button>
        )}
      </div>

      {/* Stage indicator */}
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className={stage === "pick-list" ? "text-blue-700 font-semibold" : ""}>1. Pick list</span>
        <span>›</span>
        <span className={stage === "upload" ? "text-blue-700 font-semibold" : ""}>2. Upload CSV</span>
        <span>›</span>
        <span className={stage === "map" ? "text-blue-700 font-semibold" : ""}>3. Map columns</span>
        <span>›</span>
        <span className={stage === "importing" || stage === "done" ? "text-blue-700 font-semibold" : ""}>4. Import</span>
      </div>

      {/* Stage 1: pick list */}
      {stage === "pick-list" && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-slate-800">Choose a contact list</h3>
            {listsLoading && (
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <span className="w-3 h-3 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin inline-block" />
                Loading…
              </span>
            )}
          </div>

          {listsError && (
            <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-red-700">
              {listsError}
            </div>
          )}
          {cfError && (
            <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-red-700">
              Failed to load custom fields: {cfError}
            </div>
          )}

          <input
            type="text"
            placeholder="Filter lists by name…"
            value={listFilter}
            onChange={(e) => setListFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <div className="border border-slate-200 rounded-lg max-h-[400px] overflow-y-auto divide-y divide-slate-100">
            {filteredLists.length === 0 ? (
              <p className="px-4 py-3 text-sm text-slate-400 italic">
                {lists.length === 0 ? "No contact lists found" : "No matches"}
              </p>
            ) : (
              filteredLists.map((l) => (
                <button
                  key={l.id}
                  onClick={() => handlePickList(l.id)}
                  disabled={cfLoading}
                  className="w-full text-left px-4 py-2.5 hover:bg-blue-50 disabled:opacity-50 flex items-center gap-3"
                >
                  <span className="text-sm text-slate-700 flex-1 truncate">{l.name}</span>
                  <span className="text-[11px] font-mono text-slate-400 shrink-0">{l.id.slice(0, 8)}…</span>
                  {cfLoading && selectedListId === l.id && (
                    <span className="w-3 h-3 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Stage 2: upload CSV */}
      {stage === "upload" && (
        <div className="space-y-4">
          <SelectedListBanner
            list={lists.find((l) => l.id === selectedListId)}
            customFields={customFields}
          />

          <div
            className="bg-white border-2 border-dashed border-slate-300 rounded-xl p-10 text-center cursor-pointer hover:border-slate-400"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
          >
            <p className="text-slate-600 font-medium">Click or drop a contacts CSV</p>
            <p className="text-slate-400 text-xs mt-1">
              Required: a display name column and at least one phone column
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </div>

          {csvError && (
            <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-red-700">
              {csvError}
            </div>
          )}
        </div>
      )}

      {/* Stage 3: map columns */}
      {stage === "map" && (
        <div className="space-y-4">
          <SelectedListBanner
            list={lists.find((l) => l.id === selectedListId)}
            customFields={customFields}
          />

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm text-slate-800">Map CSV columns</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  <span className="font-mono">{filename}</span> · {csvRows.length} rows · {csvHeaders.length} columns
                </p>
              </div>
              <p className="text-xs text-slate-500">
                <span className="text-emerald-600 font-medium">{validRowsPreview.valid} valid</span>
                {validRowsPreview.invalid > 0 && (
                  <>
                    {" · "}
                    <span className="text-red-500 font-medium">{validRowsPreview.invalid} will be skipped</span>
                  </>
                )}
              </p>
            </div>

            {validRowsPreview.invalid > 0 && validRowsPreview.firstError && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
                First skip reason: {validRowsPreview.firstError}
              </p>
            )}

            <MappingSection title="Standard fields">
              {STANDARD_FIELDS.map((f) => (
                <MappingRow
                  key={f.key}
                  label={f.label}
                  required={f.required}
                  value={mapping.standard[f.key] ?? ""}
                  options={csvHeaders}
                  onChange={(v) =>
                    setMapping((m) => ({ ...m, standard: { ...m.standard, [f.key]: v } }))
                  }
                />
              ))}
            </MappingSection>

            <MappingSection title="Phone numbers (at least one required, E164 format)">
              {PHONE_TYPES.map((t) => (
                <MappingRow
                  key={t}
                  label={`${t} phone`}
                  value={mapping.phones[t] ?? ""}
                  options={csvHeaders}
                  onChange={(v) =>
                    setMapping((m) => ({
                      ...m,
                      phones: { ...m.phones, [t]: v || undefined },
                    }))
                  }
                />
              ))}
            </MappingSection>

            <MappingSection title="Emails (up to 4)">
              {[1, 2, 3, 4].map((i) => (
                <MappingRow
                  key={i}
                  label={`Email ${i}`}
                  value={mapping.emails[i] ?? ""}
                  options={csvHeaders}
                  onChange={(v) =>
                    setMapping((m) => {
                      const next = { ...m.emails };
                      if (v) next[i] = v;
                      else delete next[i];
                      return { ...m, emails: next };
                    })
                  }
                />
              ))}
            </MappingSection>

            {customFields.length > 0 && (
              <MappingSection title={`Custom fields (${customFields.length})`}>
                {customFields.map((cf) => (
                  <MappingRow
                    key={cf.id}
                    label={`${cf.name} · ${cf.data_type}`}
                    value={mapping.customFields[cf.id] ?? ""}
                    options={csvHeaders}
                    onChange={(v) =>
                      setMapping((m) => ({
                        ...m,
                        customFields: { ...m.customFields, [cf.id]: v },
                      }))
                    }
                  />
                ))}
              </MappingSection>
            )}
          </div>

          {importError && (
            <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-red-700">
              {importError}
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleImport}
              disabled={validRowsPreview.valid === 0}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Import {validRowsPreview.valid} contact{validRowsPreview.valid !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      )}

      {/* Stage 4: importing / done */}
      {(stage === "importing" || stage === "done") && (
        <ImportProgress
          total={importTotal}
          progress={progress}
          done={stage === "done"}
        />
      )}
    </div>
  );
}

function SelectedListBanner({
  list,
  customFields,
}: {
  list: { id: string; name: string } | undefined;
  customFields: ContactListCustomField[];
}) {
  if (!list) return null;
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
      <p className="text-sm font-medium text-blue-800">
        Importing into <span className="font-mono">{list.name}</span>
      </p>
      <p className="text-xs text-blue-600 mt-0.5">
        {customFields.length} custom field{customFields.length !== 1 ? "s" : ""} attached:{" "}
        {customFields.length === 0
          ? "none"
          : customFields.map((cf) => `${cf.name} (${cf.data_type})`).join(", ")}
      </p>
    </div>
  );
}

function MappingSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">{title}</p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">{children}</div>
    </div>
  );
}

function MappingRow({
  label,
  required,
  value,
  options,
  onChange,
}: {
  label: string;
  required?: boolean;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-40 shrink-0 text-slate-700 truncate" title={label}>
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-0 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">— ignore —</option>
        {options.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}

function ImportProgress({
  total,
  progress,
  done,
}: {
  total: number;
  progress: ProgressItem[];
  done: boolean;
}) {
  const succeeded = progress.filter((p) => p.status === "success").length;
  const failed = progress.filter((p) => p.status === "failed").length;
  const pct = total > 0 ? Math.round((progress.length / total) * 100) : 0;
  const failedItems = progress.filter((p) => p.status === "failed");

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-semibold text-slate-800">
            {done ? "Import complete" : "Importing contacts…"}
          </p>
          <p className="text-sm text-slate-500">
            {progress.length} / {total}
          </p>
        </div>

        <div className="w-full bg-slate-100 rounded-full overflow-hidden h-2">
          <div
            className={`h-full transition-all ${done ? "bg-emerald-500" : "bg-blue-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="flex gap-4 text-sm">
          <span className="text-emerald-600 font-medium">{succeeded} succeeded</span>
          {failed > 0 && <span className="text-red-500 font-medium">{failed} failed</span>}
        </div>
      </div>

      {failedItems.length > 0 && (
        <details className="border border-red-200 rounded-xl bg-red-50">
          <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-red-700">
            Failures ({failedItems.length})
          </summary>
          <div className="px-4 pb-4 space-y-1 max-h-80 overflow-y-auto">
            {failedItems.map((item) => (
              <p key={item.index} className="text-xs text-red-600 font-mono">
                #{item.index + 1} {item.display_name}: {item.error}
              </p>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
