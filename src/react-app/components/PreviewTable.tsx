import { Fragment, useMemo, useState } from "react";
import type {
  CampaignRow,
  ParseError,
  Catalog,
  RowOverride,
  ResolvedCampaignRow,
  BatchRequest,
  BatchResult,
  CreateAddressBookResult,
} from "../types";
import { resolveRows, describeSkipReason, type ResolvedRow } from "../lib/resolver";

interface Props {
  rows: CampaignRow[];
  errors: ParseError[];
  filename: string;
  catalog: Catalog | null;
  catalogLoading: boolean;
  catalogError: string | null;
  onCatalogRetry: () => void;
  onConfirm: (req: BatchRequest) => void;
  onTestRun: (req: BatchRequest) => void;
  testRunResult: BatchResult | null;
  testRunLoading: boolean;
  testRunProgress: { done: number; total: number };
  onClearTestRun: () => void;
  onBack: () => void;
}

interface GlobalSelections {
  queue_id: string;
  phone_number_id: string;
  business_hour_id: string;
  dnc_list_id: string;
  address_book_id: string;
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

export default function PreviewTable({
  rows,
  errors,
  filename,
  catalog,
  catalogLoading,
  catalogError,
  onCatalogRetry,
  onConfirm,
  onTestRun,
  testRunResult,
  testRunLoading,
  testRunProgress,
  onClearTestRun,
  onBack,
}: Props) {
  const [globals, setGlobals] = useState<GlobalSelections>({
    queue_id: "",
    phone_number_id: "",
    business_hour_id: "",
    dnc_list_id: "",
    address_book_id: "",
  });

  const [createABModalOpen, setCreateABModalOpen] = useState(false);

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
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  // Detect whether any row carries CSV-side queue/phone fields — used to adjust
  // whether the global Queue/Phone dropdowns are flagged required or optional.
  const anyCsvResolvable = useMemo(
    () => rows.some((r) => r.organization || r.queue_name || r.primary_did),
    [rows]
  );
  const allCsvResolvable = useMemo(
    () =>
      rows.length > 0 &&
      rows.every((r) => Boolean(r.organization && r.queue_name && r.primary_did)),
    [rows]
  );

  const resolutions: ResolvedRow[] | null = useMemo(() => {
    if (!catalog) return null;
    const ovForResolver = new Map<number, { queue_id?: string; phone_number_id?: string }>();
    for (const [i, o] of overrides) {
      ovForResolver.set(i, { queue_id: o.queue_id, phone_number_id: o.phone_number_id });
    }
    return resolveRows(
      rows,
      catalog,
      {
        queueId: globals.queue_id || undefined,
        phoneId: globals.phone_number_id || undefined,
      },
      ovForResolver
    );
  }, [rows, catalog, globals.queue_id, globals.phone_number_id, overrides]);

  const skipCount = resolutions?.filter((r) => r.skip).length ?? 0;
  const okCount = (resolutions?.length ?? 0) - skipCount;

  const skipSummary = useMemo(() => {
    if (!resolutions) return null;
    const counts = new Map<string, number>();
    for (const r of resolutions) {
      if (!r.skip || !r.skipReason) continue;
      counts.set(r.skipReason, (counts.get(r.skipReason) ?? 0) + 1);
    }
    return counts;
  }, [resolutions]);

  const canConfirm =
    !catalogLoading &&
    !catalogError &&
    catalog !== null &&
    resolutions !== null &&
    okCount > 0 &&
    Boolean(globals.address_book_id);

  function buildResolvedRows(): ResolvedCampaignRow[] {
    if (!resolutions) return [];
    const resolved: ResolvedCampaignRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const res = resolutions[i];
      if (res.skip || !res.queueId || !res.phoneId) continue;
      const ov = overrides.get(i) ?? {};
      resolved.push({
        ...rows[i],
        queue_id: res.queueId,
        phone_number_id: res.phoneId,
        business_hour_id: ov.business_hour_id || globals.business_hour_id || undefined,
        dnc_list_id: ov.dnc_list_id || globals.dnc_list_id || undefined,
      });
    }
    return resolved;
  }

  function buildBatchRequest(rowsToSend: ResolvedCampaignRow[]): BatchRequest {
    return {
      rows: rowsToSend,
      address_book_id: globals.address_book_id || undefined,
    };
  }

  function handleConfirm() {
    onConfirm(buildBatchRequest(buildResolvedRows()));
  }

  const testSampleSize = Math.min(okCount, Math.max(1, Math.ceil(okCount * 0.1)));

  function handleTestRun() {
    const all = buildResolvedRows();
    if (all.length === 0) return;
    // Fisher-Yates shuffle, then take the first N.
    const shuffled = [...all];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const sample = shuffled.slice(0, testSampleSize);
    onTestRun(buildBatchRequest(sample));
  }

  const queueOpts = catalog?.queues.map((q) => ({ id: q.id, label: q.name })) ?? [];
  const phoneOpts = catalog?.phoneNumbers.map((p) => ({ id: p.id, label: p.label })) ?? [];
  const bizOpts = catalog?.businessHours.map((b) => ({ id: b.id, label: b.name })) ?? [];
  const dncOpts = catalog?.contactLists.map((c) => ({ id: c.id, label: c.name })) ?? [];

  function labelFor(opts: { id: string; label: string }[], id: string) {
    return opts.find((o) => o.id === id)?.label ?? id;
  }

  const queueFallbackRequired = !allCsvResolvable;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Configure &amp; confirm</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            <span className="font-mono text-slate-600">{filename}</span>
            {" · "}
            <span className="text-emerald-600 font-medium">
              {okCount} ready
            </span>
            {skipCount > 0 && (
              <span className="text-amber-500 font-medium ml-2">
                {skipCount} skipped
              </span>
            )}
            {errors.length > 0 && (
              <span className="text-amber-500 font-medium ml-2">
                {errors.length} parse error{errors.length > 1 ? "s" : ""}
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
            onClick={handleTestRun}
            disabled={!canConfirm || testRunLoading}
            title={`Creates a random ${testSampleSize}-row sample so you can sanity-check before committing the full batch.`}
            className="px-4 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {testRunLoading ? `Testing ${testRunProgress.done}/${testRunProgress.total}…` : `Test run (${testSampleSize})`}
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm || testRunLoading}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create {okCount} campaign{okCount !== 1 ? "s" : ""}
          </button>
        </div>
      </div>

      {/* Parse errors */}
      {errors.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
          <p className="text-sm font-medium text-amber-700 mb-1">Rows skipped due to parse errors:</p>
          {errors.map((e) => (
            <p key={e.row} className="text-xs text-amber-600">
              Row {e.row}: {e.message}
            </p>
          ))}
        </div>
      )}

      {/* Resolution summary */}
      {skipSummary && skipSummary.size > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-sm font-medium text-amber-700 mb-1.5">
            {skipCount} row{skipCount !== 1 ? "s" : ""} will be skipped on submit:
          </p>
          <ul className="text-xs text-amber-700 space-y-0.5">
            {Array.from(skipSummary.entries()).map(([reason, count]) => (
              <li key={reason}>
                · {count}× {describeSkipReason(reason as Parameters<typeof describeSkipReason>[0])}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Test-run results */}
      {testRunResult && (
        <div
          className={`border rounded-xl p-4 ${
            testRunResult.failed === 0
              ? "bg-emerald-50 border-emerald-200"
              : "bg-rose-50 border-rose-200"
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-2xl">
                {testRunResult.failed === 0 ? "👍" : "👎"}
              </span>
              <div>
                <p
                  className={`text-sm font-semibold ${
                    testRunResult.failed === 0 ? "text-emerald-700" : "text-rose-700"
                  }`}
                >
                  Test run: {testRunResult.succeeded} / {testRunResult.total} succeeded
                </p>
                <p className="text-xs text-slate-600">
                  {testRunResult.failed === 0
                    ? "All sample rows imported cleanly. Catalog refreshed — they'll skip as 'already exists' in the full run."
                    : `${testRunResult.failed} failed — review errors below before running the full batch.`}
                </p>
              </div>
            </div>
            <button
              onClick={onClearTestRun}
              className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1"
            >
              Dismiss
            </button>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 max-h-60 overflow-y-auto">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-100">
                {testRunResult.results.map((r, idx) => (
                  <tr key={idx}>
                    <td className="px-3 py-1.5 w-6">
                      {r.status === "success" ? (
                        <span className="text-emerald-600">✓</span>
                      ) : (
                        <span className="text-rose-600">✗</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-slate-700">{r.campaign_name}</td>
                    <td className="px-3 py-1.5 text-rose-600 max-w-md truncate" title={r.error}>
                      {r.error ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Global settings panel */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          <h3 className="text-sm font-semibold text-slate-800">
            {anyCsvResolvable && allCsvResolvable
              ? "Defaults (queue + phone resolved per-row from CSV)"
              : "Default settings for all campaigns"}
          </h3>
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
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                Address book <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <select
                  value={globals.address_book_id}
                  onChange={(e) => {
                    if (e.target.value === "__create__") {
                      setCreateABModalOpen(true);
                      return;
                    }
                    setGlobal("address_book_id", e.target.value);
                  }}
                  disabled={catalogLoading}
                  className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">
                    {catalog && catalog.addressBooks.length === 0
                      ? "No address books found — create one"
                      : "Select an address book…"}
                  </option>
                  {catalog?.addressBooks.map((ab) => (
                    <option key={ab.id} value={ab.id}>
                      {ab.name} ({ab.custom_field_count} custom field{ab.custom_field_count === 1 ? "" : "s"})
                    </option>
                  ))}
                  <option value="__create__">+ Create new address book…</option>
                </select>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Contact lists will be scoped to this address book. Creating a new one auto-attaches every existing custom field.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                Queue{" "}
                {queueFallbackRequired ? (
                  <span className="text-red-500">*</span>
                ) : (
                  <span className="text-slate-400 font-normal">(fallback)</span>
                )}
              </label>
              <Select
                value={globals.queue_id}
                onChange={(v) => setGlobal("queue_id", v)}
                placeholder={allCsvResolvable ? "Not needed — per-row CSV" : "Select a queue…"}
                options={queueOpts}
                disabled={catalogLoading}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                Outbound phone number{" "}
                {queueFallbackRequired ? (
                  <span className="text-red-500">*</span>
                ) : (
                  <span className="text-slate-400 font-normal">(fallback)</span>
                )}
              </label>
              <Select
                value={globals.phone_number_id}
                onChange={(v) => setGlobal("phone_number_id", v)}
                placeholder={allCsvResolvable ? "Not needed — per-row CSV" : "Select a number…"}
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
                <th className="px-4 py-3 text-left font-semibold w-20">Status</th>
                <th className="px-4 py-3 text-left font-semibold">Campaign name</th>
                <th className="px-4 py-3 text-left font-semibold">Method</th>
                <th className="px-4 py-3 text-left font-semibold">Priority</th>
                <th className="px-4 py-3 text-left font-semibold">Queue</th>
                <th className="px-4 py-3 text-left font-semibold">Phone</th>
                <th className="px-4 py-3 text-left font-semibold w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, i) => {
                const res = resolutions?.[i];
                const isExpanded = expandedRows.has(i);
                const ov = overrides.get(i) ?? {};
                const hasOverride = Object.values(ov).some((v) =>
                  Array.isArray(v) ? v.length > 0 : Boolean(v)
                );
                const skipped = res?.skip ?? false;

                const queueLabel = res?.queueId ? labelFor(queueOpts, res.queueId) : null;
                const phoneLabel = res?.phoneId ? labelFor(phoneOpts, res.phoneId) : null;

                return (
                  <Fragment key={`frag-${i}`}>
                    <tr
                      className={
                        isExpanded
                          ? "bg-blue-50"
                          : skipped
                          ? "bg-amber-50/40 hover:bg-amber-50"
                          : "hover:bg-slate-50"
                      }
                    >
                      <td className="px-4 py-3 text-slate-400 text-xs">{i + 1}</td>
                      <td className="px-4 py-3">
                        {res == null ? (
                          <span className="text-xs text-slate-400">…</span>
                        ) : skipped ? (
                          <span
                            className="text-xs text-amber-700"
                            title={describeSkipReason(res.skipReason!, {
                              searchKey: res.queueSearchKey,
                              suggestion: res.queueSuggestion,
                              ambiguous: res.queueAmbiguous,
                              phoneSearchKey: res.phoneSearchKey,
                              phoneSuggestion: res.phoneSuggestion,
                            })}
                          >
                            ⚠ Skip
                          </span>
                        ) : (
                          <span className="text-xs text-emerald-700">✓ Ready</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <p className={`font-medium ${skipped ? "text-slate-500" : "text-slate-800"}`}>
                          {row.campaign_name}
                        </p>
                        {skipped && res?.skipReason && (
                          <p className="text-xs text-amber-600 mt-0.5">
                            {describeSkipReason(res.skipReason, {
                              searchKey: res.queueSearchKey,
                              suggestion: res.queueSuggestion,
                              ambiguous: res.queueAmbiguous,
                              phoneSearchKey: res.phoneSearchKey,
                              phoneSuggestion: res.phoneSuggestion,
                            })}
                          </p>
                        )}
                        {skipped && res?.queueSuggestionId && (
                          <button
                            onClick={() => setOverride(i, "queue_id", res.queueSuggestionId!)}
                            className="mt-1 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300"
                          >
                            ✓ Accept "{res.queueSuggestion}"
                          </button>
                        )}
                        {skipped && res?.queueAmbiguous && res.queueAmbiguous.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {res.queueAmbiguous.slice(0, 5).map((c) => (
                              <button
                                key={c.id}
                                onClick={() => setOverride(i, "queue_id", c.id)}
                                className="text-xs px-2 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300"
                              >
                                ✓ {c.name}
                              </button>
                            ))}
                          </div>
                        )}
                        {skipped && res?.phoneSuggestionId && (
                          <button
                            onClick={() => setOverride(i, "phone_number_id", res.phoneSuggestionId!)}
                            className="mt-1 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-300"
                            title={`Phone off by ${res.phoneSuggestionDistance} digit${res.phoneSuggestionDistance === 1 ? "" : "s"}`}
                          >
                            ✓ Accept "{res.phoneSuggestion}"
                          </button>
                        )}
                        {!skipped && res?.queueMatchType === "contains" && (
                          <p className="text-xs text-slate-400 mt-0.5">
                            Queue matched by word overlap (searched "{res.queueSearchKey}")
                          </p>
                        )}
                        {!skipped && row.campaign_description && (
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
                      <td className="px-4 py-3 text-xs text-slate-600 max-w-[160px] truncate">
                        {queueLabel ? (
                          <span
                            className={
                              res?.queueSource === "override"
                                ? "text-blue-700 font-medium"
                                : res?.queueSource === "csv"
                                ? "text-slate-700"
                                : "text-slate-500 italic"
                            }
                            title={`Source: ${res?.queueSource}`}
                          >
                            {queueLabel}
                          </span>
                        ) : (
                          <span className="text-red-400 italic">Not set</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 max-w-[160px] truncate">
                        {phoneLabel ? (
                          <span
                            className={
                              res?.phoneSource === "override"
                                ? "text-blue-700 font-medium"
                                : res?.phoneSource === "csv"
                                ? "text-slate-700"
                                : "text-slate-500 italic"
                            }
                            title={`Source: ${res?.phoneSource}`}
                          >
                            {phoneLabel}
                          </span>
                        ) : (
                          <span className="text-red-400 italic">Not set</span>
                        )}
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
                      <tr className="bg-blue-50 border-t-0">
                        <td colSpan={8} className="px-4 pb-4 pt-0">
                          <div className="bg-white border border-blue-200 rounded-lg p-4">
                            <p className="text-xs font-semibold text-blue-700 mb-3">
                              Override for "{row.campaign_name}"
                            </p>
                            <div className="grid grid-cols-4 gap-3">
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">Queue</label>
                                <Select
                                  value={ov.queue_id ?? ""}
                                  onChange={(v) => setOverride(i, "queue_id", v)}
                                  placeholder={
                                    res?.queueId
                                      ? `Current: ${labelFor(queueOpts, res.queueId)}`
                                      : "Pick a queue…"
                                  }
                                  options={queueOpts}
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">Phone number</label>
                                <Select
                                  value={ov.phone_number_id ?? ""}
                                  onChange={(v) => setOverride(i, "phone_number_id", v)}
                                  placeholder={
                                    res?.phoneId
                                      ? `Current: ${labelFor(phoneOpts, res.phoneId)}`
                                      : "Pick a number…"
                                  }
                                  options={phoneOpts}
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">Business hours</label>
                                <Select
                                  value={ov.business_hour_id ?? ""}
                                  onChange={(v) => setOverride(i, "business_hour_id", v)}
                                  placeholder={`Default: ${
                                    globals.business_hour_id ? labelFor(bizOpts, globals.business_hour_id) : "none"
                                  }`}
                                  options={bizOpts}
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-slate-500 mb-1">DNC list</label>
                                <Select
                                  value={ov.dnc_list_id ?? ""}
                                  onChange={(v) => setOverride(i, "dnc_list_id", v)}
                                  placeholder={`Default: ${
                                    globals.dnc_list_id ? labelFor(dncOpts, globals.dnc_list_id) : "none"
                                  }`}
                                  options={dncOpts}
                                />
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {createABModalOpen && (
        <CreateAddressBookModal
          onClose={() => setCreateABModalOpen(false)}
          onCreated={(result) => {
            setGlobal("address_book_id", result.id);
            setCreateABModalOpen(false);
            // Refresh catalog so the new AB shows up in the dropdown with its CF count.
            onCatalogRetry();
          }}
        />
      )}
    </div>
  );
}

function CreateAddressBookModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (result: CreateAddressBookResult) => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState<CreateAddressBookResult | null>(null);

  async function handleCreate() {
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch("/api/address-books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = (await r.json()) as CreateAddressBookResult & { error?: string };
      if (!r.ok) {
        setError(data.error || `HTTP ${r.status}`);
        return;
      }
      const failures = data.custom_fields.filter((f) => f.status === "failed");
      if (failures.length > 0) {
        // Address book exists; surface the CF attach failures so user can decide.
        setPartial(data);
        return;
      }
      onCreated(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-lg font-semibold text-slate-800">Create address book</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            All existing custom fields will be auto-attached.
          </p>
        </div>

        {partial ? (
          <div className="space-y-3">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              <p className="font-medium">
                Address book "{partial.name}" was created, but {partial.custom_fields.filter((f) => f.status === "failed").length} custom
                field{partial.custom_fields.filter((f) => f.status === "failed").length === 1 ? "" : "s"} failed to attach.
              </p>
              <ul className="mt-2 space-y-0.5 text-xs">
                {partial.custom_fields
                  .filter((f) => f.status === "failed")
                  .map((f) => (
                    <li key={f.custom_field_id}>
                      <span className="font-mono">{f.custom_field_name}</span>: {f.error}
                    </li>
                  ))}
              </ul>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-3 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Don't use it
              </button>
              <button
                onClick={() => onCreated(partial)}
                className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
              >
                Use it anyway
              </button>
            </div>
          </div>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Name</label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") onClose();
                }}
                disabled={submitting}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. UMMHC Patients"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                disabled={submitting}
                className="px-3 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={submitting || !name.trim()}
                className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? "Creating…" : "Create"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
