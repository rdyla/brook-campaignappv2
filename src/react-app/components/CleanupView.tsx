import { useEffect, useState } from "react";
import type {
  CleanupItem,
  CleanupResources,
  CleanupDeleteRequest,
  CleanupDeleteResult,
} from "../types";

type Section = "campaigns" | "contactLists";

const SECTION_LABELS: Record<Section, string> = {
  campaigns: "Campaigns",
  contactLists: "Contact Lists",
};

function useSelection(items: CleanupItem[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === items.length ? new Set() : new Set(items.map((i) => i.id))
    );
  }

  function clear() {
    setSelected(new Set());
  }

  return { selected, toggle, toggleAll, clear };
}

interface SectionListProps {
  label: string;
  items: CleanupItem[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  failedIds: Set<string>;
  failedErrors: Map<string, string>;
}

function SectionList({
  label,
  items,
  selected,
  onToggle,
  onToggleAll,
  failedIds,
  failedErrors,
}: SectionListProps) {
  const allSelected = items.length > 0 && selected.size === items.length;
  const someSelected = selected.size > 0 && !allSelected;

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
      <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200">
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => { if (el) el.indeterminate = someSelected; }}
          onChange={onToggleAll}
          disabled={items.length === 0}
          className="w-4 h-4 rounded border-slate-300 accent-blue-600"
        />
        <span className="text-sm font-semibold text-slate-700">{label}</span>
        <span className="text-xs text-slate-400 ml-auto">{items.length} item{items.length !== 1 ? "s" : ""}</span>
      </div>

      {items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-400 italic">None found</p>
      ) : (
        <ul className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
          {items.map((item) => {
            const failed = failedIds.has(item.id);
            return (
              <li key={item.id} className={`flex items-center gap-3 px-4 py-2.5 ${failed ? "bg-red-50" : ""}`}>
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => onToggle(item.id)}
                  className="w-4 h-4 rounded border-slate-300 accent-blue-600 shrink-0"
                />
                <span className="text-sm text-slate-700 flex-1 truncate">{item.name}</span>
                <span className="text-xs font-mono text-slate-400 shrink-0">{item.id.slice(0, 8)}…</span>
                {failed && (
                  <span
                    className="text-xs text-red-600 shrink-0"
                    title={failedErrors.get(item.id)}
                  >
                    failed
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function CleanupView() {
  const [resources, setResources] = useState<CleanupResources | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [lastResult, setLastResult] = useState<{ deleted: number; failed: number } | null>(null);
  const [failedIds, setFailedIds] = useState<Map<string, string>>(new Map());

  const campaigns = useSelection(resources?.campaigns ?? []);
  const contactLists = useSelection(resources?.contactLists ?? []);

  async function fetchResources() {
    setLoading(true);
    setFetchError(null);
    setLastResult(null);
    setFailedIds(new Map());
    campaigns.clear();
    contactLists.clear();
    try {
      const r = await fetch("/api/cleanup");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as CleanupResources & {
        errors?: { campaigns?: string; contactLists?: string };
      };
      setResources({
        campaigns: data.campaigns,
        contactLists: data.contactLists,
      });
      const errs = data.errors;
      if (errs) {
        const msgs = [
          errs.campaigns && `Campaigns: ${errs.campaigns}`,
          errs.contactLists && `Contact Lists: ${errs.contactLists}`,
        ].filter(Boolean);
        if (msgs.length) setFetchError(msgs.join(" · "));
      }
    } catch (err) {
      setFetchError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchResources(); }, []);

  const totalSelected = campaigns.selected.size + contactLists.selected.size;

  async function handleDelete() {
    if (!resources || totalSelected === 0) return;

    setDeleting(true);
    setLastResult(null);

    const req: CleanupDeleteRequest = {
      campaign_ids: [...campaigns.selected],
      contact_list_ids: [...contactLists.selected],
    };

    try {
      const r = await fetch("/api/cleanup/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      const data = (await r.json()) as CleanupDeleteResult;

      const newFailedIds = new Map<string, string>();
      const allResults = [...data.campaigns, ...data.contactLists];
      for (const item of allResults) {
        if (item.status === "failed") {
          newFailedIds.set(item.id, item.error ?? "Unknown error");
        }
      }
      setFailedIds(newFailedIds);

      const deletedCampaigns = new Set(data.campaigns.filter((i) => i.status === "deleted").map((i) => i.id));
      const deletedContactLists = new Set(data.contactLists.filter((i) => i.status === "deleted").map((i) => i.id));

      setResources((prev) =>
        prev
          ? {
              campaigns: prev.campaigns.filter((c) => !deletedCampaigns.has(c.id)),
              contactLists: prev.contactLists.filter((c) => !deletedContactLists.has(c.id)),
            }
          : prev
      );

      campaigns.clear();
      contactLists.clear();

      const deleted = allResults.filter((i) => i.status === "deleted").length;
      const failed = allResults.filter((i) => i.status === "failed").length;
      setLastResult({ deleted, failed });
    } catch (err) {
      setFetchError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  function failedIdsForSection(items: CleanupItem[]) {
    return new Set([...failedIds.keys()].filter((id) => items.some((c) => c.id === id)));
  }

  function errorsForSection(ids: Set<string>) {
    const m = new Map<string, string>();
    for (const id of ids) {
      const msg = failedIds.get(id);
      if (msg) m.set(id, msg);
    }
    return m;
  }

  const sections: { key: Section; sel: ReturnType<typeof useSelection>; items: CleanupItem[] }[] = [
    { key: "campaigns", sel: campaigns, items: resources?.campaigns ?? [] },
    { key: "contactLists", sel: contactLists, items: resources?.contactLists ?? [] },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Cleanup</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Select items to permanently delete from Zoom Contact Center.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchResources}
            disabled={loading || deleting}
            className="px-3 py-2 text-sm rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button
            onClick={handleDelete}
            disabled={totalSelected === 0 || deleting || loading}
            className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {deleting ? "Deleting…" : `Delete ${totalSelected > 0 ? totalSelected : ""} selected`}
          </button>
        </div>
      </div>

      {lastResult && (
        <div
          className={`rounded-lg px-4 py-3 text-sm font-medium ${
            lastResult.failed > 0
              ? "bg-amber-50 border border-amber-200 text-amber-700"
              : "bg-emerald-50 border border-emerald-200 text-emerald-700"
          }`}
        >
          {lastResult.deleted} deleted
          {lastResult.failed > 0 && ` · ${lastResult.failed} failed (hover "failed" for details)`}
        </div>
      )}

      {fetchError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {fetchError}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center min-h-[30vh]">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-500 rounded-full animate-spin" />
        </div>
      ) : resources ? (
        <div className="space-y-4">
          {sections.map(({ key, sel, items }) => {
            const failedSectionIds = failedIdsForSection(items);
            return (
              <SectionList
                key={key}
                label={SECTION_LABELS[key]}
                items={items}
                selected={sel.selected}
                onToggle={sel.toggle}
                onToggleAll={sel.toggleAll}
                failedIds={failedSectionIds}
                failedErrors={errorsForSection(failedSectionIds)}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
