import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, AlertCircle, AlertTriangle, ArrowDownToLine, BarChart3, Check,
  CheckCircle2, ChevronDown, Clock3, Database, FileJson, FolderOpen,
  LoaderCircle, RefreshCw, Save, Server, Signal, XCircle
} from "lucide-react";
import { api } from "./api";
import type { CollectionJob, DatasetSummary, Timeframe } from "./types";
import { TIMEFRAMES } from "./types";

type Notice = { kind: "success" | "error" | "info"; message: string };
const localDateTime = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};
const formatDate = (value: string) => new Date(value).toLocaleString();
const number = (value: number) => new Intl.NumberFormat().format(value);

export default function App() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbolsLoading, setSymbolsLoading] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>("1hour");
  const [startTime, setStartTime] = useState(() => localDateTime(new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const [endTime, setEndTime] = useState(() => localDateTime(new Date()));
  const [job, setJob] = useState<CollectionJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [activeDataset, setActiveDataset] = useState<DatasetSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingFile, setLoadingFile] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [showSymbols, setShowSymbols] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const notify = useCallback((next: Notice) => setNotice(next), []);

  const refreshDatasets = useCallback(async () => {
    const [saved, active] = await Promise.all([api.getDatasets(), api.getActiveDataset()]);
    setDatasets(saved.datasets);
    setActiveDataset(active.dataset);
  }, []);

  useEffect(() => {
    void api.getSymbols().then((result) => setSymbols(result.symbols)).catch(() => undefined);
    void refreshDatasets().catch(() => undefined);
    return () => eventSourceRef.current?.close();
  }, [refreshDatasets]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 6500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const fetchSymbols = async () => {
    setSymbolsLoading(true);
    try {
      const result = await api.refreshSymbols();
      setSymbols(result.symbols);
      notify({ kind: "success", message: `Loaded ${number(result.count)} active futures contracts from KuCoin.` });
    } catch (error) {
      notify({ kind: "error", message: error instanceof Error ? error.message : "Unable to fetch symbols." });
    } finally {
      setSymbolsLoading(false);
    }
  };

  const applyJobUpdate = useCallback((next: CollectionJob) => {
    setJob(next);
    if (next.status === "completed" || next.status === "failed") {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      void refreshDatasets().catch(() => undefined);
      if (next.status === "failed") {
        notify({ kind: "error", message: next.error ?? "The collection job failed." });
      } else if (next.outcome === "success") {
        notify({ kind: "success", message: `Collection completed: ${number(next.successfulSymbols)} symbols processed successfully.` });
      } else if (next.outcome === "partial") {
        notify({ kind: "info", message: `Collection completed with ${next.failedSymbols} failed symbol(s). Successful data is available to save.` });
      } else {
        notify({ kind: "error", message: "Collection finished, but no symbols were collected successfully." });
      }
    }
  }, [notify, refreshDatasets]);

  const startCollection = async () => {
    if (!startTime || !endTime) {
      notify({ kind: "error", message: "Choose both a start and end date." });
      return;
    }
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) {
      notify({ kind: "error", message: "The start date must be earlier than the end date." });
      return;
    }
    setStarting(true);
    eventSourceRef.current?.close();
    try {
      const created = await api.startCollection({
        timeframe,
        startTime: start.toISOString(),
        endTime: end.toISOString()
      });
      setJob(created);
      notify({ kind: "info", message: "KLine collection started. Progress will update automatically." });
      const source = new EventSource(api.jobEventsUrl(created.jobId));
      eventSourceRef.current = source;
      source.addEventListener("progress", (event) => {
        const update = JSON.parse((event as MessageEvent<string>).data) as CollectionJob;
        applyJobUpdate(update);
      });
      source.onerror = () => {
        // EventSource reconnects automatically. The job remains available through its job ID.
      };
    } catch (error) {
      notify({ kind: "error", message: error instanceof Error ? error.message : "Unable to start collection." });
    } finally {
      setStarting(false);
    }
  };

  const saveDataset = async () => {
    setSaving(true);
    try {
      const result = await api.saveDataset();
      await refreshDatasets();
      notify({ kind: "success", message: `Saved a new dataset: ${result.dataset.filename}` });
    } catch (error) {
      notify({ kind: "error", message: error instanceof Error ? error.message : "Unable to save dataset." });
    } finally {
      setSaving(false);
    }
  };

  const loadDataset = async (filename: string) => {
    setLoadingFile(filename);
    try {
      const result = await api.loadDataset(filename);
      setActiveDataset(result.dataset);
      setJob(null);
      notify({ kind: "success", message: `Loaded ${filename} into backend memory. The previous active dataset was replaced.` });
    } catch (error) {
      notify({ kind: "error", message: error instanceof Error ? error.message : "Unable to load dataset." });
    } finally {
      setLoadingFile(null);
    }
  };

  const collectionRunning = job?.status === "running" || job?.status === "pending";
  const canSave = !!activeDataset && !collectionRunning && !saving;
  const currentTimeframe = TIMEFRAMES.find((item) => item.value === (activeDataset?.timeframe ?? job?.timeframe))?.label;

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="KLineCollector home">
          <span className="brand-mark"><BarChart3 size={21} /></span>
          <span>KLine<span className="brand-light">Collector</span></span>
        </a>
        <div className="topbar-right"><span className="connection-dot" /> KuCoin Futures <span className="environment-tag">DATA WORKSPACE</span></div>
      </header>

      <section className="page-heading">
        <div>
          <div className="eyebrow"><Activity size={14} /> MARKET DATA MANAGEMENT</div>
          <h1>Collection workspace</h1>
          <p>Fetch active futures contracts, collect historical candles, and manage saved datasets.</p>
        </div>
        <div className="phase-chip"><span /> Phase 1 · Data collection</div>
      </section>

      {notice && (
        <div className={`notice notice-${notice.kind}`} role="status">
          {notice.kind === "success" ? <CheckCircle2 size={18} /> : notice.kind === "error" ? <AlertCircle size={18} /> : <Signal size={18} />}
          <span>{notice.message}</span>
          <button className="icon-button notice-close" onClick={() => setNotice(null)} aria-label="Dismiss notification"><XCircle size={17} /></button>
        </div>
      )}

      <section className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon blue"><Activity size={19} /></div>
          <div><span className="stat-label">Active contracts</span><strong>{symbols.length ? number(symbols.length) : "—"}</strong><small>{symbols.length ? "Cached in backend memory" : "Fetch symbols to begin"}</small></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon violet"><Database size={19} /></div>
          <div><span className="stat-label">Active dataset</span><strong>{activeDataset ? number(activeDataset.symbolCount) : "—"}</strong><small>{activeDataset ? `${number(activeDataset.klineCount)} KLines in memory` : "No dataset loaded"}</small></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon amber"><FileJson size={19} /></div>
          <div><span className="stat-label">Saved datasets</span><strong>{number(datasets.length)}</strong><small>Local JSON collections</small></div>
        </div>
      </section>

      <div className="workspace-grid">
        <section className="panel symbols-panel">
          <div className="panel-heading">
            <div className="section-icon"><Activity size={18} /></div>
            <div><h2>Futures symbols</h2><p>Retrieve all currently tradable KuCoin Futures contracts.</p></div>
          </div>
          <div className="symbol-summary">
            <div><span className="muted-label">Backend symbol cache</span><strong>{symbols.length ? `${number(symbols.length)} symbols` : "Not loaded yet"}</strong></div>
            <span className={symbols.length ? "status-pill status-ready" : "status-pill"}>{symbols.length ? "Ready" : "Waiting"}</span>
          </div>
          <button className="button button-primary full-width" onClick={fetchSymbols} disabled={symbolsLoading || collectionRunning}>
            {symbolsLoading ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}
            {symbolsLoading ? "Fetching contracts…" : "Fetch active symbols"}
          </button>
          {symbols.length > 0 && (
            <div className="symbol-preview">
              <button className="text-button" onClick={() => setShowSymbols((value) => !value)}>
                {showSymbols ? "Hide symbol preview" : "Preview symbols"} <ChevronDown className={showSymbols ? "rotate" : ""} size={15} />
              </button>
              {showSymbols && <div className="symbol-list">{symbols.slice(0, 24).map((symbol) => <span key={symbol}>{symbol}</span>)}{symbols.length > 24 && <span className="more-symbols">+{symbols.length - 24} more</span>}</div>}
            </div>
          )}
          <div className="info-line"><Server size={15} /> Symbol list is fetched and held by the backend.</div>
        </section>

        <section className="panel collect-panel">
          <div className="panel-heading">
            <div className="section-icon purple"><BarChart3 size={18} /></div>
            <div><h2>KLine collection</h2><p>Collect historical candles for every cached symbol.</p></div>
          </div>
          <div className="form-grid">
            <label className="field field-full"><span>Timeframe</span>
              <select value={timeframe} onChange={(event) => setTimeframe(event.target.value as Timeframe)} disabled={collectionRunning}>
                {TIMEFRAMES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="field"><span>Start date &amp; time</span><input type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} disabled={collectionRunning} /></label>
            <label className="field"><span>End date &amp; time</span><input type="datetime-local" value={endTime} onChange={(event) => setEndTime(event.target.value)} disabled={collectionRunning} /></label>
          </div>
          <div className="collection-note"><Clock3 size={15} /> Symbols are processed sequentially with a 20-second pause between symbols.</div>
          <button className="button button-dark full-width" onClick={startCollection} disabled={starting || collectionRunning || symbols.length === 0}>
            {starting || collectionRunning ? <LoaderCircle className="spin" size={17} /> : <ArrowDownToLine size={17} />}
            {collectionRunning ? "Collection running…" : starting ? "Starting…" : "Start KLine collection"}
          </button>
          {symbols.length === 0 && <p className="helper-text">Fetch active symbols before starting a collection.</p>}
        </section>
      </div>

      {(job || collectionRunning) && (
        <section className="panel progress-panel">
          <div className="panel-heading progress-heading">
            <div className="section-icon green"><Signal size={18} /></div>
            <div><h2>Collection progress</h2><p>{job?.jobId ?? "Preparing job"}</p></div>
            <span className={collectionRunning ? "status-pill status-running" : job?.outcome === "success" ? "status-pill status-ready" : "status-pill status-warning"}>
              {collectionRunning ? "In progress" : job?.status === "failed" || job?.outcome === "failed" ? "Failed" : job?.outcome === "partial" ? "Completed with errors" : "Completed"}
            </span>
          </div>
          {job && <>
            <div className="progress-topline"><strong>{job.progress}%</strong><span>{number(job.processedSymbols)} of {number(job.totalSymbols)} symbols processed</span></div>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${job.progress}%` }} /></div>
            <div className="progress-stats">
              <div><CheckCircle2 size={16} /><strong>{job.successfulSymbols}</strong><span>Successful</span></div>
              <div><AlertTriangle size={16} /><strong>{job.failedSymbols}</strong><span>Failed</span></div>
              <div><Clock3 size={16} /><strong>{job.totalSymbols - job.processedSymbols}</strong><span>Remaining</span></div>
            </div>
            {job.currentSymbol && <div className="current-symbol"><LoaderCircle className="spin" size={16} /> Processing <strong>{job.currentSymbol}</strong></div>}
            {job.failedSymbolNames.length > 0 && <details className="failed-list"><summary>Failed symbols ({job.failedSymbolNames.length})</summary><p>{job.failedSymbolNames.join(", ")}</p></details>}
            {job.status === "completed" && <div className="completion-message"><Check size={17} /> Collection finished. You can now save the active dataset.</div>}
            {job.status === "failed" && <div className="error-message">{job.error}</div>}
          </>}
        </section>
      )}

      <section className="panel datasets-panel">
        <div className="panel-heading datasets-heading">
          <div className="section-icon amber"><FolderOpen size={18} /></div>
          <div><h2>Dataset management</h2><p>Save the current in-memory collection or load a previous JSON file.</p></div>
        </div>
        <div className="dataset-actions">
          <div className="active-dataset-card">
            <div className="dataset-card-title"><Database size={17} /><strong>Active in-memory dataset</strong></div>
            {activeDataset ? <>
              <div className="dataset-metrics"><span><strong>{number(activeDataset.symbolCount)}</strong> symbols</span><span><strong>{number(activeDataset.klineCount)}</strong> KLines</span><span>{currentTimeframe ?? activeDataset.timeframe}</span></div>
              <p className="dataset-dates">{formatDate(activeDataset.startTime)} — {formatDate(activeDataset.endTime)}</p>
            </> : <p className="empty-copy">No active dataset. Complete a collection or load a saved file.</p>}
            <button className="button button-primary full-width" onClick={saveDataset} disabled={!canSave}>
              {saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
              {saving ? "Saving…" : "Save dataset as new JSON"}
            </button>
            <p className="helper-text">Saving is manual. Every save creates a new file; existing files are never overwritten.</p>
          </div>
          <div className="saved-list-card">
            <div className="dataset-card-title"><FileJson size={17} /><strong>Saved JSON datasets</strong><span className="count-badge">{datasets.length}</span></div>
            {datasets.length === 0 ? <div className="empty-state"><FolderOpen size={25} /><span>No saved datasets yet</span><small>Save a completed collection to create your first file.</small></div> :
              <div className="saved-list">{datasets.map((dataset) => (
                <div className="saved-item" key={dataset.filename}>
                  <div className="saved-file-icon"><FileJson size={17} /></div>
                  <div className="saved-file-info"><strong>{dataset.filename}</strong><span>{dataset.timeframe} · {dataset.symbolCount} symbols · {number(dataset.klineCount)} candles</span><small>{formatDate(dataset.createdAt)}</small></div>
                  <button className="button button-outline button-small" onClick={() => void loadDataset(dataset.filename!)} disabled={!!loadingFile || collectionRunning}>
                    {loadingFile === dataset.filename ? <LoaderCircle className="spin" size={15} /> : <FolderOpen size={15} />}
                    Load
                  </button>
                </div>
              ))}</div>}
          </div>
        </div>
      </section>

      <footer className="footer"><span>KLineCollector</span><span>Market data only · No order execution in this phase</span></footer>
    </main>
  );
}
