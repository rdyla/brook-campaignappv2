import type { BatchRun, CampaignResult, StepStatus } from "../types";

interface Props {
  currentRun: BatchRun;
  history: BatchRun[];
  onReset: () => void;
}

const STEPS = ["contact_list", "custom_fields", "campaign"] as const;
const stepLabel: Record<typeof STEPS[number], string> = {
  contact_list: "Contact List",
  custom_fields: "Custom Fields",
  campaign: "Campaign",
};

function StepBadge({ status }: { status: StepStatus }) {
  const styles: Record<StepStatus, string> = {
    success: "bg-emerald-100 text-emerald-700",
    failed: "bg-red-100 text-red-700",
    skipped: "bg-slate-100 text-slate-500",
    pending: "bg-slate-100 text-slate-400",
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

function CampaignRow({ result }: { result: CampaignResult }) {
  return (
    <details className="border border-slate-100 rounded-lg bg-white">
      <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none list-none">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            result.status === "success" ? "bg-emerald-500" : "bg-red-500"
          }`}
        />
        <span className="font-medium text-slate-800 flex-1 text-sm">{result.campaign_name}</span>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded ${
            result.status === "success"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-red-100 text-red-700"
          }`}
        >
          {result.status}
        </span>
      </summary>

      <div className="px-4 pb-4 pt-2 border-t border-slate-100 text-xs space-y-3">
        <div className="flex gap-4">
          {STEPS.map((step) => (
            <div key={step} className="flex flex-col gap-1">
              <span className="text-slate-500">{stepLabel[step]}</span>
              <StepBadge status={result.steps[step]} />
            </div>
          ))}
        </div>

        {result.custom_fields && result.custom_fields.length > 0 && (
          <div>
            <p className="text-slate-500 mb-1">Custom fields attached</p>
            <div className="flex flex-wrap gap-1.5">
              {result.custom_fields.map((cf) => (
                <span
                  key={cf.custom_field_id}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border ${
                    cf.reused
                      ? "bg-slate-50 border-slate-200 text-slate-600"
                      : "bg-emerald-50 border-emerald-200 text-emerald-700"
                  }`}
                  title={cf.custom_field_id}
                >
                  <span className="font-medium">{cf.custom_field_name}</span>
                  <span className="text-slate-400">·</span>
                  <span>{cf.reused ? "reused" : "new"}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {result.error && (
          <div className="bg-red-50 border border-red-100 rounded px-3 py-2 text-red-700">
            {result.error}
          </div>
        )}

        {result.status === "success" && (
          <div className="grid grid-cols-2 gap-3 font-mono text-slate-600">
            {result.contact_list_id && (
              <div>
                <span className="block text-slate-400 font-sans mb-0.5">Contact List ID</span>
                {result.contact_list_id}
              </div>
            )}
            {result.campaign_id && (
              <div>
                <span className="block text-slate-400 font-sans mb-0.5">Campaign ID</span>
                {result.campaign_id}
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

function RunSummary({ run, defaultOpen = false }: { run: BatchRun; defaultOpen?: boolean }) {
  const { result } = run;
  return (
    <details open={defaultOpen} className="border border-slate-200 rounded-xl bg-slate-50">
      <summary className="flex items-center gap-4 px-4 py-3 cursor-pointer select-none list-none">
        <div className="flex-1">
          <p className="font-medium text-slate-800 text-sm">{run.filename}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {new Date(result.timestamp).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-4 text-sm">
          <span className="text-emerald-600 font-medium">{result.succeeded} succeeded</span>
          {result.failed > 0 && (
            <span className="text-red-500 font-medium">{result.failed} failed</span>
          )}
          <span className="text-slate-400">{result.total} total</span>
        </div>
      </summary>

      <div className="px-4 pb-4 pt-2 border-t border-slate-200 space-y-2">
        {result.results.map((r, i) => (
          <CampaignRow key={i} result={r} />
        ))}
      </div>
    </details>
  );
}

export default function ResultsView({ currentRun, history, onReset }: Props) {
  const pastRuns = history.filter((r) => r.id !== currentRun.id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-800">Results</h2>
        <button
          onClick={onReset}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
        >
          Upload another CSV
        </button>
      </div>

      <RunSummary run={currentRun} defaultOpen />

      {pastRuns.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">
            Previous runs
          </h3>
          {pastRuns.map((run) => (
            <RunSummary key={run.id} run={run} />
          ))}
        </div>
      )}
    </div>
  );
}
