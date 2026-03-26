import type { ApiHistoryEntry } from "../hooks/useApiHistory";

interface Props {
  items: ApiHistoryEntry[];
  onClear: () => void;
}

export default function ApiHistory({ items, onClear }: Props) {
  return (
    <div className="border border-slate-200 rounded-lg p-3 mt-4 bg-white">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-700">API call history</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">{items.length} calls</span>
          <button
            onClick={onClear}
            disabled={items.length === 0}
            className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Clear
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-slate-400 py-2">No calls yet.</p>
      ) : (
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {items.map((entry) => (
            <details key={entry.id} className="border border-slate-100 rounded bg-slate-50 text-xs">
              <summary className="cursor-pointer px-2 py-1.5 flex items-center gap-2 select-none">
                <span className="text-slate-400 w-16 shrink-0">{entry.time}</span>
                <span className="font-mono w-12 shrink-0">{entry.method}</span>
                <span
                  className={`w-16 shrink-0 font-mono ${
                    entry.status >= 200 && entry.status < 300
                      ? "text-emerald-600"
                      : "text-rose-600"
                  }`}
                >
                  {entry.status} · {entry.ms}ms
                </span>
                <span className="font-mono truncate text-slate-600">{entry.url}</span>
              </summary>
              <div className="px-3 pb-3 pt-1 grid grid-cols-2 gap-3">
                <div>
                  <p className="font-semibold text-slate-600 mb-1">Request</p>
                  {entry.requestBody ? (
                    <pre className="bg-white border border-slate-200 rounded p-2 overflow-auto max-h-36 whitespace-pre-wrap text-slate-700">
                      {entry.requestBody}
                    </pre>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </div>
                <div>
                  <p className="font-semibold text-slate-600 mb-1">Response</p>
                  {entry.responseBody ? (
                    <pre className="bg-white border border-slate-200 rounded p-2 overflow-auto max-h-36 whitespace-pre-wrap text-slate-700">
                      {entry.responseBody}
                    </pre>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
