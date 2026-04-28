import { useState } from "react";
import type {
  CampaignRow,
  ParseError,
  Catalog,
  RowOverride,
  ResolvedCampaignRow,
  BatchRequest,
  CustomFieldDef,
} from "../types";

interface Props {
  rows: CampaignRow[];
  errors: ParseError[];
  filename: string;
  catalog: Catalog | null;
  catalogLoading: boolean;
  catalogError: string | null;
  onCatalogRetry: () => void;
  onConfirm: (req: BatchRequest) => void;
  onBack: () => void;
}

interface GlobalSelections {
  queue_id: string;
  phone_number_id: string;
  business_hour_id: string;
  dnc_list_id: string;
}

function Select({
  value,
  onChange,
  placeholder,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { id: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function CustomFieldChip({ def }: { def: CustomFieldDef }) {
  const detail =
    def.data_type === "pick_list" && def.pick_list_values?.length
      ? `pick_list (${def.pick_list_values.join(", ")})`
      : def.data_type;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-indigo-50 border border-indigo-200 text-indigo-700"
      title={detail}
    >
      <span className="font-medium">{def.name}</span>
      <span className="text-indigo-400">·</span>
      <span className="text-indigo-500">{def.data_type}</span>
    </span>
  );
}

export default function PreviewTable({
  rows,
  errors,
  filename,
  catalog,
  catalogLoading,
  catalogError,
  onCatalogRetry,
  onConfirm,
  onBack,
}: Props) {
  const [globals, setGlobals] = useState<GlobalSelections>({
    queue_id: "",
    phone_number_id: "",
    business_hour_id: "",
    dnc_list_id: "",
  });

  const [overrides, setOverrides] = useState<Map<number, RowOverride>>(new Map());
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  function setGlobal(field: keyof GlobalSelections, value: string) {
    setGlobals((g) => ({ ...g, [field]: value }));
  }

  function setOverride(rowIdx: number, field: keyof RowOverride, value: string) {
    setOverrides((prev) => {
      const next = new Map(prev);
      const current = next.get(rowIdx) ?? {};
      next.set(rowIdx, { ...current, [field]: value || undefined });
      return next;
    });
  }

  function toggleRow(idx: number) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  }

  function resolvedFor(idx: number): Partial<ResolvedCampaignRow> {
    const ov = overrides.get(idx) ?? {};
    return {
      queue_id: ov.queue_id || globals.queue_id || undefined,
      phone_number_id: ov.phone_number_id || globals.phone_number_id || undefined,
      business_hour_id: ov.business_hour_id || globals.business_hour_id || undefined,
      dnc_list_id: ov.dnc_list_id || globals.dnc_list_id || undefined,
    };
  }

  const canConfirm =
    !catalogLoading &&
    !catalogError &&
    catalog !== null &&
    globals.queue_id !== "" &&
    globals.phone_number_id !== "" &&
    rows.length > 0;

  function handleConfirm() {
    const resolved: ResolvedCampaignRow[] = rows.map((row, i) => {
      const r = resolvedFor(i);
      return {
        ...row,
        queue_id: r.queue_id!,
        phone_number_id: r.phone_number_id!,
        business_hour_id: r.business_hour_id || undefined,
        dnc_list_id: r.dnc_list_id || undefined,
      };
    });
    onConfirm({ rows: resolved });
  }

  const queueOpts = catalog?.queues.map((q) => ({ id: q.id, label: q.name })) ?? [];
  const phoneOpts = catalog?.phoneNumbers.map((p) => ({ id: p.id, label: p.label })) ?? [];
  const bizOpts = catalog?.businessHours.map((b) => ({ id: b.id, label: b.name })) ?? [];
  const dncOpts = catalog?.contactLists.map((c) => ({ id: c.id, label: c.name })) ?? [];

  function labelFor(opts: { id: string; label: string }[], id: string) {
    return opts.find((o) => o.id === id)?.label ?? id;
  }

  // CF defs are header-derived, so the same set applies to every row
  const cfDefs = rows[0]?.custom_field_defs ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Configure &amp; confirm</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            <span className="font-mono text-slate-600">{filename}</span>
            {" · "}
            <span className="text-emerald-600 font-medium">{rows.length} campaign{rows.length !== 1 ? "s" : ""}</span>
            {errors.length > 0 && (
              <span className="text-amber-500 font-medium ml-2">
                {errors.length} issue{errors.length > 1 ? "s" : ""}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onBack}
            className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            Back
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create {rows.length} campaign{rows.length !== 1 ? "s" : ""}
          </button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
          <p className="text-sm font-medium text-amber-700 mb-1">CSV issues:</p>
          {errors.map((e, i) => (
            <p key={i} className="text-xs text-amber-600">
              {e.row > 0 ? `Row ${e.row}: ` : "Header: "}{e.message}
            </p>
          ))}
        </div>
      )}

      {/* Custom field summary */}
      {cfDefs.length > 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <p className="text-sm font-semibold text-indigo-800 mb-1.5">
                Custom fields detected — {cfDefs.length} field{cfDefs.length !== 1 ? "s" : ""} will be attached to each contact list
              </p>
              <div className="flex flex-wrap gap-1.5">
                {cfDefs.map((d) => (
                  <CustomFieldChip key={d.name} def={d} />
                ))}
              </div>
              <p className="text-xs text-indigo-600 mt-2">
                Existing fields with the same name are reused (Zoom limit: 50 contact lists per field).
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Global settings panel */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          <h3 className="text-sm font-semibold text-slate-800">Default settings for all campaigns</h3>
          {catalogLoading && (
            <span className="text-xs text-slate-400 ml-1 flex items-center gap-1">
              <span className="w-3 h-3 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin inline-block" />
              Loading options…
            </span>
          )}
        </div>

        {catalogError ? (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <p className="text-sm text-red-700 flex-1">Failed to load options: {catalogError}</p>
            <button
              onClick={onCatalogRetry}
              className="text-sm px-3 py-1.5 rounded bg-red-100 hover:bg-red-200 text-red-700 font-medium"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                Queue <span className="text-red-500">*</span>
              </label>
              <Select
                value={globals.queue_id}
                onChange={(v) => setGlobal("queue_id", v)}
                placeholder="Select a queue…"
                options={queueOpts}
                disabled={catalogLoading}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                Outbound phone number <span className="text-red-500">*</span>
              </label>
              <Select
                value={globals.phone_number_id}
                onChange={(v) => setGlobal("phone_number_id", v)}
                placeholder="Select a number…"
                options={phoneOpts}
                disabled={catalogLoading}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                Business hours <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <Select
                value={globals.business_hour_id}
                onChange={(v) => setGlobal("business_hour_id", v)}
                placeholder="None"
                options={bizOpts}
                disabled={catalogLoading}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                Do-not-contact list <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <Select
                value={globals.dnc_list_id}
                onChange={(v) => setGlobal("dnc_list_id", v)}
                placeholder="None"
                options={dncOpts}
                disabled={catalogLoading}
              />
            </div>
          </div>
        )}
      </div>

      {/* Campaign table */}
      {rows.length > 0 && (
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left font-semibold w-8">#</th>
                <th className="px-4 py-3 text-left font-semibold">Campaign name</th>
                <th className="px-4 py-3 text-left font-semibold">Method</th>
                <th className="px-4 py-3 text-left font-semibold">Priority</th>
                <th className="px-4 py-3 text-left font-semibold">Attempts</th>
                <th className="px-4 py-3 text-left font-semibold">Queue</th>
                <th className="px-4 py-3 text-left font-semibold">Phone</th>
                <th className="px-4 py-3 text-left font-semibold w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, i) => {
                const r = resolvedFor(i);
                const isExpanded = expandedRows.has(i);
                const ov = overrides.get(i) ?? {};
                const hasOverride = Object.values(ov).some((v) => Boolean(v));

                return (
                  <>
                    <tr key={`row-${i}`} className={isExpanded ? "bg-blue-50" : "hover:bg-slate-50"}>
                      <td className="px-4 py-3 text-slate-400 text-xs">{i + 1}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">{row.campaign_name}</p>
                        {row.campaign_description && (
                          <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">
                            {row.campaign_description}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            row.dialing_method === "progressive"
                              ? "bg-blue-100 text-blue-700"
                              : row.dialing_method === "preview"
                              ? "bg-purple-100 text-purple-700"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {row.dialing_method}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{row.priority}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{row.max_attempts}</td>
                      <td className="px-4 py-3 text-xs text-slate-600 max-w-[140px] truncate">
                        {r.queue_id
                          ? <span className={ov.queue_id ? "text-blue-700 font-medium" : ""}>{labelFor(queueOpts, r.queue_id)}</span>
                          : <span className="text-red-400 italic">Not set</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 max-w-[140px] truncate">
                        {r.phone_number_id
                          ? <span className={ov.phone_number_id ? "text-blue-700 font-medium" : ""}>{labelFor(phoneOpts, r.phone_number_id)}</span>
                          : <span className="text-red-400 italic">Not set</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => toggleRow(i)}
                          className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                            isExpanded
                              ? "bg-blue-100 border-blue-300 text-blue-700"
                              : hasOverride
                              ? "bg-blue-50 border-blue-200 text-blue-600"
                              : "border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          {isExpanded ? "Done" : hasOverride ? "Overridden" : "Override"}
                        </button>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr key={`override-${i}`} className="bg-blue-50 border-t-0">
                        <td colSpan={8} className="px-4 pb-4 pt-0">
                          <div className="bg-white border border-blue-200 rounded-lg p-4">
                            <p className="text-xs font-semibold text-blue-700 mb-3">
                              Override defaults for "{row.campaign_name}"
                            </p>
                            <div className="grid grid-cols-4 gap-3">
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">Queue</label>
                                <Select
                                  value={ov.queue_id ?? ""}
                                  onChange={(v) => setOverride(i, "queue_id", v)}
                                  placeholder={`Default: ${globals.queue_id ? labelFor(queueOpts, globals.queue_id) : "none"}`}
                                  options={queueOpts}
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">Phone number</label>
                                <Select
                                  value={ov.phone_number_id ?? ""}
                                  onChange={(v) => setOverride(i, "phone_number_id", v)}
                                  placeholder={`Default: ${globals.phone_number_id ? labelFor(phoneOpts, globals.phone_number_id) : "none"}`}
                                  options={phoneOpts}
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">Business hours</label>
                                <Select
                                  value={ov.business_hour_id ?? ""}
                                  onChange={(v) => setOverride(i, "business_hour_id", v)}
                                  placeholder={`Default: ${globals.business_hour_id ? labelFor(bizOpts, globals.business_hour_id) : "none"}`}
                                  options={bizOpts}
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">DNC list</label>
                                <Select
                                  value={ov.dnc_list_id ?? ""}
                                  onChange={(v) => setOverride(i, "dnc_list_id", v)}
                                  placeholder={`Default: ${globals.dnc_list_id ? labelFor(dncOpts, globals.dnc_list_id) : "none"}`}
                                  options={dncOpts}
                                />
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
