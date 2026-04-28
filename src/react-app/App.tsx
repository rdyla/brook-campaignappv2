import { useState } from "react";
import UploadView from "./components/UploadView";
import PreviewTable from "./components/PreviewTable";
import ResultsView from "./components/ResultsView";
import CleanupView from "./components/CleanupView";
import ContactImportView from "./components/ContactImportView";
import type {
  CampaignRow,
  ParseError,
  BatchRequest,
  BatchResult,
  BatchRun,
  Catalog,
} from "./types";

type View = "upload" | "preview" | "processing" | "results" | "contacts" | "cleanup";

export default function App() {
  const [view, setView] = useState<View>("upload");
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [parseErrors, setParseErrors] = useState<ParseError[]>([]);
  const [filename, setFilename] = useState("");

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [batchHistory, setBatchHistory] = useState<BatchRun[]>([]);
  const [currentRun, setCurrentRun] = useState<BatchRun | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

  async function fetchCatalog() {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const r = await fetch("/api/catalog");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as Catalog;
      setCatalog(data);
    } catch (err) {
      setCatalogError((err as Error).message);
    } finally {
      setCatalogLoading(false);
    }
  }

  function handleParsed(parsed: CampaignRow[], errors: ParseError[], name: string) {
    setRows(parsed);
    setParseErrors(errors);
    setFilename(name);
    setView("preview");
    // Kick off catalog fetch immediately so dropdowns are ready
    if (!catalog) fetchCatalog();
  }

  async function handleConfirm(req: BatchRequest) {
    setView("processing");
    setBatchError(null);

    try {
      const r = await fetch("/api/campaigns/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const result = (await r.json()) as BatchResult;

      const run: BatchRun = {
        id: crypto.randomUUID(),
        filename,
        result,
      };

      setBatchHistory((prev) => [run, ...prev]);
      setCurrentRun(run);
      setView("results");
    } catch (err) {
      setBatchError((err as Error).message);
      setView("preview");
    }
  }

  function handleReset() {
    setRows([]);
    setParseErrors([]);
    setFilename("");
    setBatchError(null);
    setView("upload");
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/packetfusionlogo.png" alt="Packet Fusion" className="h-7 w-auto" />
            <span className="text-slate-300">|</span>
            <span className="text-slate-800 font-semibold text-base">
              Zoom CC · Campaign Batch Creator
            </span>
            {view !== "upload" && (
              <>
                <span className="text-slate-300">·</span>
                <span className="text-sm text-slate-500 font-mono">{filename}</span>
              </>
            )}
          </div>
          <nav className="flex items-center gap-1 text-xs">
            <button
              onClick={() => setView("upload")}
              className={`px-3 py-1.5 rounded ${
                view === "upload" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              Upload
            </button>
            {rows.length > 0 && (
              <button
                onClick={() => setView("preview")}
                className={`px-3 py-1.5 rounded ${
                  view === "preview" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                Configure
              </button>
            )}
            {batchHistory.length > 0 && (
              <button
                onClick={() => { setCurrentRun(batchHistory[0]); setView("results"); }}
                className={`px-3 py-1.5 rounded ${
                  view === "results" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                Results
              </button>
            )}
            <button
              onClick={() => setView("contacts")}
              className={`px-3 py-1.5 rounded ${
                view === "contacts" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              Import Contacts
            </button>
            <button
              onClick={() => setView("cleanup")}
              className={`px-3 py-1.5 rounded ${
                view === "cleanup" ? "bg-red-600 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              Cleanup
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {view === "upload" && <UploadView onParsed={handleParsed} />}

        {view === "preview" && (
          <>
            {batchError && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                Batch failed: {batchError}
              </div>
            )}
            <PreviewTable
              rows={rows}
              errors={parseErrors}
              filename={filename}
              catalog={catalog}
              catalogLoading={catalogLoading}
              catalogError={catalogError}
              onCatalogRetry={fetchCatalog}
              onConfirm={handleConfirm}
              onBack={handleReset}
            />
          </>
        )}

        {view === "processing" && (
          <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
            <div className="w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
            <p className="text-slate-600 font-medium">
              Creating {rows.length} campaign{rows.length !== 1 ? "s" : ""}…
            </p>
            <p className="text-slate-400 text-sm text-center max-w-sm">
              Creating contact list and campaign record for each row.
            </p>
          </div>
        )}

        {view === "results" && currentRun && (
          <ResultsView
            currentRun={currentRun}
            history={batchHistory}
            onReset={handleReset}
          />
        )}

        {view === "contacts" && <ContactImportView />}

        {view === "cleanup" && <CleanupView />}


      </main>
    </div>
  );
}
