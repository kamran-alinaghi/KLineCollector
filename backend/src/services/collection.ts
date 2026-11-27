import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { TIMEFRAMES, type CollectionJob, type CollectionRequest, type FuturesSymbol, type KLineDataset } from "../types.js";
import { getExchangeProvider } from "./providers.js";
import { setActiveDataset } from "./dataset.js";
const jobs = new Map<string, CollectionJob>();
const jobEvents = new Map<string, EventEmitter>();
const abortControllers = new Map<string, AbortController>();
let runningJobId: string | null = null;
const now = () => new Date().toISOString();
function publish(job: CollectionJob): void {
  job.updatedAt = now();
  job.progress = job.totalSymbols === 0 ? 0 : Math.round(job.processedSymbols / job.totalSymbols * 100);
  jobEvents.get(job.jobId)?.emit("update", { ...job, failedSymbolNames: [...job.failedSymbolNames] });
}
export function getJob(jobId: string): CollectionJob | undefined {
  const job = jobs.get(jobId); return job ? { ...job, failedSymbolNames: [...job.failedSymbolNames] } : undefined;
}
export function subscribeToJob(jobId: string, listener: (job: CollectionJob) => void): () => void {
  const emitter = jobEvents.get(jobId); if (!emitter) return () => undefined;
  emitter.on("update", listener); return () => emitter.off("update", listener);
}
export function hasRunningJob(): boolean { return runningJobId !== null; }
export function cancelCollection(jobId: string): CollectionJob | undefined {
  const job = jobs.get(jobId); if (!job) return undefined;
  if (job.status === "pending" || job.status === "running") abortControllers.get(jobId)?.abort();
  return getJob(jobId);
}
export function startCollection(request: CollectionRequest, symbols: FuturesSymbol[]): CollectionJob {
  if (runningJobId) throw new Error("A KLine collection is already running.");
  if (symbols.length === 0) throw new Error("Fetch active futures symbols before starting a collection.");
  const provider = getExchangeProvider(request.exchange);
  if (!provider.supportsTimeframe(request.timeframe)) throw new Error(`${provider.label} does not support the ${request.timeframe} timeframe.`);
  const jobId = `job_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const job: CollectionJob = {
    jobId, exchange: request.exchange, status: "pending", timeframe: request.timeframe,
    startTime: request.startTime, endTime: request.endTime, totalSymbols: symbols.length,
    processedSymbols: 0, successfulSymbols: 0, failedSymbols: 0, currentSymbol: null,
    failedSymbolNames: [], progress: 0, createdAt: now(), updatedAt: now()
  };
  const controller = new AbortController();
  jobs.set(jobId, job); jobEvents.set(jobId, new EventEmitter());
  abortControllers.set(jobId, controller); runningJobId = jobId;
  const dataset: KLineDataset = {
    schemaVersion: 3, exchange: request.exchange, marketType: "futures",
    jobId, timeframe: request.timeframe, startTime: request.startTime,
    endTime: request.endTime, createdAt: now(), symbols: {}
  };
  setActiveDataset(dataset);
  void runCollection(job, dataset, [...symbols], controller.signal);
  return { ...job, failedSymbolNames: [] };
}
async function runCollection(job: CollectionJob, dataset: KLineDataset, symbols: FuturesSymbol[], signal: AbortSignal): Promise<void> {
  try {
    const provider = getExchangeProvider(job.exchange);
    job.status = "running"; publish(job);
    const startMs = new Date(job.startTime).getTime(), endMs = new Date(job.endTime).getTime();
    const pageSpanMs = TIMEFRAMES[job.timeframe] * 60_000 * 500;
    for (const contract of symbols) {
      if (signal.aborted) break;
      const { symbol, multiplier } = contract;
      job.currentSymbol = symbol; publish(job);
      try {
        const byTimestamp = new Map<number, (typeof dataset.symbols)[string]["klines"][number]>();
        let cursor = startMs;
        while (cursor <= endMs && !signal.aborted) {
          const pageEnd = Math.min(endMs, cursor + pageSpanMs - 1);
          const page = await provider.fetchKLinesPage(symbol, job.timeframe, cursor, pageEnd, signal);
          if (signal.aborted) break;
          for (const kline of page) if (kline.timestamp >= startMs && kline.timestamp <= endMs) byTimestamp.set(kline.timestamp, kline);
          cursor = pageEnd + 1;
        }
        if (signal.aborted) break;
        dataset.symbols[symbol] = { multiplier, klines: [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp) };
        job.successfulSymbols += 1;
      } catch (error) {
        if (signal.aborted) break;
        job.failedSymbols += 1; job.failedSymbolNames.push(symbol);
        console.error(`${provider.label} KLine collection failed for ${symbol}:`, error);
      }
      if (signal.aborted) break;
      job.processedSymbols += 1; job.currentSymbol = null; publish(job);
    }
    if (signal.aborted) job.status = "cancelled";
    else {
      job.status = "completed";
      job.outcome = job.successfulSymbols === 0 ? "failed" : job.failedSymbols > 0 ? "partial" : "success";
    }
  } catch (error) {
    job.status = "failed"; job.error = error instanceof Error ? error.message : "Unexpected collection error.";
  } finally {
    job.currentSymbol = null; publish(job); runningJobId = null; abortControllers.delete(job.jobId);
  }
}
