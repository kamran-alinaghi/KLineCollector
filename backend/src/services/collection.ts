import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { config } from "../config.js";
import { TIMEFRAMES, type CollectionJob, type CollectionRequest, type KLineDataset } from "../types.js";
import { fetchKLinesPage } from "./kucoin.js";
import { setActiveDataset } from "./dataset.js";

const jobs = new Map<string, CollectionJob>();
const jobEvents = new Map<string, EventEmitter>();
let runningJobId: string | null = null;
const now = () => new Date().toISOString();

function publish(job: CollectionJob): void {
  job.updatedAt = now();
  job.progress = job.totalSymbols === 0 ? 0 : Math.round(job.processedSymbols / job.totalSymbols * 100);
  jobEvents.get(job.jobId)?.emit("update", { ...job, failedSymbolNames: [...job.failedSymbolNames] });
}

export function getJob(jobId: string): CollectionJob | undefined {
  const job = jobs.get(jobId);
  return job ? { ...job, failedSymbolNames: [...job.failedSymbolNames] } : undefined;
}

export function subscribeToJob(jobId: string, listener: (job: CollectionJob) => void): () => void {
  const emitter = jobEvents.get(jobId);
  if (!emitter) return () => undefined;
  emitter.on("update", listener);
  return () => emitter.off("update", listener);
}

export function hasRunningJob(): boolean { return runningJobId !== null; }

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startCollection(request: CollectionRequest, symbols: string[]): CollectionJob {
  if (runningJobId) throw new Error("A KLine collection is already running.");
  if (symbols.length === 0) throw new Error("Fetch active futures symbols before starting a collection.");

  const jobId = `job_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const job: CollectionJob = {
    jobId, status: "pending", timeframe: request.timeframe,
    startTime: request.startTime, endTime: request.endTime,
    totalSymbols: symbols.length, processedSymbols: 0, successfulSymbols: 0,
    failedSymbols: 0, currentSymbol: null, failedSymbolNames: [],
    progress: 0, createdAt: now(), updatedAt: now()
  };
  jobs.set(jobId, job);
  jobEvents.set(jobId, new EventEmitter());
  runningJobId = jobId;

  const dataset: KLineDataset = {
    schemaVersion: 1, jobId, timeframe: request.timeframe,
    startTime: request.startTime, endTime: request.endTime,
    createdAt: now(), symbols: {}
  };
  // Starting a collection establishes a fresh active dataset; no file is written here.
  setActiveDataset(dataset);

  void runCollection(job, dataset, [...symbols]).catch((error: unknown) => {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "Unexpected collection error.";
    job.currentSymbol = null;
    publish(job);
    runningJobId = null;
  });
  return { ...job, failedSymbolNames: [] };
}

async function runCollection(job: CollectionJob, dataset: KLineDataset, symbols: string[]): Promise<void> {
  job.status = "running";
  publish(job);
  const startMs = new Date(job.startTime).getTime();
  const endMs = new Date(job.endTime).getTime();
  const intervalMs = TIMEFRAMES[job.timeframe] * 60_000;
  const pageSpanMs = intervalMs * 500;

  for (let index = 0; index < symbols.length; index += 1) {
    if (index > 0 && config.symbolRequestDelayMs > 0) await wait(config.symbolRequestDelayMs);
    const symbol = symbols[index]!;
    job.currentSymbol = symbol;
    publish(job);

    try {
      const byTimestamp = new Map<number, (typeof dataset.symbols)[string]["klines"][number]>();
      let cursor = startMs;
      while (cursor <= endMs) {
        const pageEnd = Math.min(endMs, cursor + pageSpanMs - 1);
        const page = await fetchKLinesPage(symbol, job.timeframe, cursor, pageEnd);
        for (const kline of page) {
          if (kline.timestamp >= startMs && kline.timestamp <= endMs) byTimestamp.set(kline.timestamp, kline);
        }
        cursor = pageEnd + 1;
      }
      dataset.symbols[symbol] = {
        klines: [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp)
      };
      job.successfulSymbols += 1;
    } catch (error) {
      job.failedSymbols += 1;
      job.failedSymbolNames.push(symbol);
      console.error(`KLine collection failed for ${symbol}:`, error);
    }

    job.processedSymbols += 1;
    job.currentSymbol = null;
    publish(job);
  }

  job.status = "completed";
  job.outcome = job.successfulSymbols === 0 ? "failed" : job.failedSymbols > 0 ? "partial" : "success";
  publish(job);
  runningJobId = null;
}
