import { useEffect, useMemo, useState } from "react";
import type {
  Catalog,
  PatchCampaignResult,
  PatchCampaignsResponse,
} from "../types";

const PATCH_CHUNK_SIZE = 50;

// A single field the user can toggle into the patch payload. The `build`
// function receives the raw input value (string) and returns the JSON shape
// to merge into the body — including any companion fields Zoom requires
// (e.g. max_ring_time needs enable_max_ring_time alongside).
type FieldKind = "boolean" | "number" | "select";

interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  // Initial value when the toggle is enabled
  defaultValue: string;
  // For select kinds
  options?: { value: string; label: string }[];
  // Build the partial-patch payload from the field's value
  build: (value: string, catalog: Catalog | null) => Record<string, unknown>;
}

const RETRY_PERIOD_UNITS = ["minutes", "hours"];
const DIAL_SEQUENCES = ["list_dial", "round_robin"];

const FIELD_DEFS: FieldDef[] = [
  {
    // Zoom requires both enable_always_running and contact_order to ride
    // together — sending only the bool returns 100908 "configuration invalid".
    // We collapse the two into a single 3-state field so picking "Always
    // running" forces the FIFO/LIFO choice instead of letting it be omitted.
    // contact_order values: 1 = FIFO, 2 = LIFO (educated guess; preview pane
    // lets you verify before submitting).
    key: "always_running_mode",
    label: "Always running mode",
    kind: "select",
    hint: "FIFO = first in, first out · LIFO = last in, first out.",
    defaultValue: "fifo",
    options: [
      { value: "off", label: "Off" },
      { value: "fifo", label: "Always running — FIFO" },
      { value: "lifo", label: "Always running — LIFO" },
    ],
    build: (v) => {
      if (v === "off") return { enable_always_running: false };
      return {
        enable_always_running: true,
        contact_order: v === "lifo" ? 2 : 1,
      };
    },
  },
  {
    key: "outbound_campaign_priority",
    label: "Priority",
    kind: "number",
    hint: "1 (highest) – 10 (lowest).",
    defaultValue: "5",
    build: (v) => ({ outbound_campaign_priority: Number(v) }),
  },
  {
    key: "max_attempts_per_contact",
    label: "Max attempts per contact",
    kind: "number",
    defaultValue: "3",
    build: (v) => ({ max_attempts_per_contact: Number(v) }),
  },
  {
    key: "max_ring_time",
    label: "Max ring time (sec)",
    kind: "number",
    hint: "Sets enable_max_ring_time=true alongside.",
    defaultValue: "60",
    build: (v) => ({ enable_max_ring_time: true, max_ring_time: Number(v) }),
  },
  {
    key: "dial_sequence",
    label: "Dial sequence",
    kind: "select",
    defaultValue: "list_dial",
    options: DIAL_SEQUENCES.map((v) => ({ value: v, label: v })),
    build: (v) => ({ dial_sequence: v }),
  },
  {
    key: "retry_period",
    label: "Retry period",
    kind: "number",
    hint: "Pair with retry_period_unit below.",
    defaultValue: "60",
    build: (v) => ({ retry_period: Number(v) }),
  },
  {
    key: "retry_period_unit",
    label: "Retry period unit",
    kind: "select",
    defaultValue: "hours",
    options: RETRY_PERIOD_UNITS.map((v) => ({ value: v, label: v })),
    build: (v) => ({ retry_period_unit: v }),
  },
  {
    key: "business_hour_id",
    label: "Business hours",
    kind: "select",
    hint: "Sets business_hour_source='campaign' alongside.",
    defaultValue: "",
    options: [],
    build: (v) => ({ business_hour_source: "campaign", business_hour_id: v }),
  },
  {
    key: "dnc_list_id",
    label: "Do-not-contact list",
    kind: "select",
    hint: "Sets exclusion_logic='and' alongside.",
    defaultValue: "",
    options: [],
    build: (v) => ({
      campaign_do_not_contact_list_ids: [v],
      exclusion_logic: "and",
    }),
  },
];

export default function PatchView() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Per-field on/off + value
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELD_DEFS.map((f) => [f.key, f.defaultValue]))
  );

  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<PatchCampaignResult[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  useEffect(() => {
    fetch("/api/catalog")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: Catalog) => setCatalog(data))
      .catch((err: Error) => setCatalogError(err.message))
      .finally(() => setCatalogLoading(false));
  }, []);

  const campaigns = catalog?.existingCampaigns ?? [];
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return campaigns;
    return campaigns.filter((c) => c.name.toLowerCase().includes(q));
  }, [campaigns, filter]);

  function toggleId(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of filtered) next.add(c.id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function toggleField(key: string) {
    setEnabled((prev) => ({ ...prev, [key]: !prev[key] }));
  }
  function setFieldValue(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  // Build the actual JSON payload from enabled fields
  const patchPayload = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const f of FIELD_DEFS) {
      if (!enabled[f.key]) continue;
      Object.assign(out, f.build(values[f.key], catalog));
    }
    return out;
  }, [enabled, values, catalog]);

  const enabledFieldCount = Object.keys(patchPayload).length;
  const selectedCount = selected.size;
  const canRun = selectedCount > 0 && enabledFieldCount > 0 && !running;

  async function handleRun() {
    setRunning(true);
    setResults([]);
    setRunError(null);
    setProgress({ done: 0, total: selectedCount });

    const ids = Array.from(selected);
    const allResults: PatchCampaignResult[] = [];
    try {
      for (let i = 0; i < ids.length; i += PATCH_CHUNK_SIZE) {
        const chunk = ids.slice(i, i + PATCH_CHUNK_SIZE);
        const r = await fetch("/api/campaigns/patch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaign_ids: chunk, patch: patchPayload }),
        });
        if (!r.ok) {
          const body = await r.json().catch(() => ({} as { error?: string }));
          throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
        }
        const data = (await r.json()) as PatchCampaignsResponse;
        allResults.push(...data.results);
        setProgress({ done: allResults.length, total: ids.length });
        setResults([...allResults]);
      }
    } catch (err) {
      setRunError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const failed = results.filter((r) => r.status === "failed");
  const succeeded = results.filter((r) => r.status === "success");
  const resultsById = useMemo(() => new Map(results.map((r) => [r.campaign_id, r])), [results]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-slate-800">Patch campaigns</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Bulk-update settings on existing campaigns. Toggle the fields you want to change — anything left off is untouched.
        </p>
      </div>

      {catalogError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          Failed to load catalog: {catalogError}
        </div>
      )}

      <div className="grid grid-cols-5 gap-5">
        {/* Left: campaign list */}
        <div className="col-span-3 space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Filter by name…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={selectAllFiltered}
              disabled={filtered.length === 0}
              className="px-3 py-2 text-xs rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Select all {filter ? `(${filtered.length})` : ""}
            </button>
            <button
              onClick={clearSelection}
              disabled={selected.size === 0}
              className="px-3 py-2 text-xs rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Clear
            </button>
          </div>

          <div className="border border-slate-200 rounded-xl bg-white overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
              <span className="font-semibold">{selectedCount} selected</span>
              <span className="text-slate-400">·</span>
              <span>{filtered.length} of {campaigns.length} shown</span>
              {catalogLoading && (
                <span className="ml-auto flex items-center gap-1 text-slate-400">
                  <span className="w-3 h-3 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin" />
                  Loading…
                </span>
              )}
            </div>
            <ul className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
              {filtered.length === 0 ? (
                <li className="px-4 py-6 text-sm text-slate-400 italic text-center">
                  {catalogLoading ? "Loading campaigns…" : "No campaigns match"}
                </li>
              ) : (
                filtered.map((c) => {
                  const res = resultsById.get(c.id);
                  return (
                    <li
                      key={c.id}
                      className={`flex items-center gap-3 px-4 py-2 ${
                        res?.status === "failed"
                          ? "bg-red-50"
                          : res?.status === "success"
                          ? "bg-emerald-50"
                          : ""
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleId(c.id)}
                        className="w-4 h-4 rounded border-slate-300 accent-blue-600 shrink-0"
                      />
                      <span className="text-sm text-slate-700 flex-1 truncate">{c.name}</span>
                      <span className="text-[11px] font-mono text-slate-400 shrink-0">
                        {c.id.slice(0, 8)}…
                      </span>
                      {res?.status === "success" && (
                        <span className="text-xs text-emerald-600 shrink-0">✓</span>
                      )}
                      {res?.status === "failed" && (
                        <span
                          className="text-xs text-red-600 shrink-0"
                          title={res.error}
                        >
                          ✗
                        </span>
                      )}
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </div>

        {/* Right: patch form */}
        <div className="col-span-2 space-y-3">
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-800">Patch fields</p>
              <span className="text-xs text-slate-500">
                {enabledFieldCount} field{enabledFieldCount === 1 ? "" : "s"} active
              </span>
            </div>
            <div className="space-y-2.5">
              {FIELD_DEFS.map((f) => (
                <PatchFieldRow
                  key={f.key}
                  def={f}
                  enabled={!!enabled[f.key]}
                  value={values[f.key]}
                  onToggle={() => toggleField(f.key)}
                  onChange={(v) => setFieldValue(f.key, v)}
                  catalog={catalog}
                />
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Preview
            </p>
            <pre className="text-[11px] bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-x-auto text-slate-700 whitespace-pre-wrap break-words">
{enabledFieldCount === 0
  ? "(no fields enabled — nothing will be sent)"
  : JSON.stringify(patchPayload, null, 2)}
            </pre>
          </div>

          {runError && (
            <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-red-700">
              {runError}
            </div>
          )}

          <button
            onClick={handleRun}
            disabled={!canRun}
            className="w-full px-4 py-2.5 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {running
              ? `Patching… ${progress.done}/${progress.total}`
              : `Patch ${selectedCount} campaign${selectedCount === 1 ? "" : "s"}`}
          </button>

          {results.length > 0 && (
            <div className="text-xs text-slate-600 space-y-0.5">
              <p>
                <span className="text-emerald-600 font-medium">{succeeded.length} succeeded</span>
                {failed.length > 0 && (
                  <>
                    {" · "}
                    <span className="text-red-600 font-medium">{failed.length} failed</span>
                  </>
                )}
              </p>
              {failed.length > 0 && (
                <details className="border border-red-200 rounded bg-red-50 mt-2">
                  <summary className="px-3 py-2 cursor-pointer text-xs font-semibold text-red-700">
                    Failures ({failed.length})
                  </summary>
                  <div className="px-3 pb-3 space-y-1 max-h-64 overflow-y-auto">
                    {failed.map((f) => (
                      <p key={f.campaign_id} className="text-[11px] text-red-700 font-mono break-words">
                        {f.campaign_id.slice(0, 8)}…: {f.error}
                      </p>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PatchFieldRow({
  def,
  enabled,
  value,
  onToggle,
  onChange,
  catalog,
}: {
  def: FieldDef;
  enabled: boolean;
  value: string;
  onToggle: () => void;
  onChange: (v: string) => void;
  catalog: Catalog | null;
}) {
  // Resolve dynamic select options from catalog
  let options = def.options ?? [];
  if (def.key === "business_hour_id" && catalog) {
    options = [
      { value: "", label: "— none —" },
      ...catalog.businessHours.map((b) => ({ value: b.id, label: b.name })),
    ];
  }
  if (def.key === "dnc_list_id" && catalog) {
    options = [
      { value: "", label: "— none —" },
      ...catalog.contactLists.map((c) => ({ value: c.id, label: c.name })),
    ];
  }

  return (
    <div
      className={`border rounded-lg p-2.5 transition-colors ${
        enabled ? "border-blue-200 bg-blue-50/40" : "border-slate-100 bg-white"
      }`}
    >
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          className="w-4 h-4 mt-0.5 rounded border-slate-300 accent-blue-600 shrink-0"
        />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-slate-700">{def.label}</p>
          {def.hint && <p className="text-[11px] text-slate-500 mt-0.5">{def.hint}</p>}
        </div>
      </label>
      {enabled && (
        <div className="mt-2 ml-6">
          {def.kind === "boolean" ? (
            <select
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          ) : def.kind === "number" ? (
            <input
              type="number"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          ) : (
            <select
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </div>
  );
}
