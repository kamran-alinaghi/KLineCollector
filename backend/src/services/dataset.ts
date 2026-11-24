import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { DatasetFileSummary, KLineDataset, Timeframe } from "../types.js";

let activeDataset: KLineDataset | null = null;
const timeframeValues = new Set(["1min", "5min", "15min", "30min", "1hour", "2hour", "4hour", "8hour", "12hour", "1day", "1week"]);

export function getActiveDataset(): KLineDataset | null { return activeDataset; }
export function setActiveDataset(dataset: KLineDataset | null): void { activeDataset = dataset; }

export function getDatasetSummary(dataset: KLineDataset | null) {
  if (!dataset) return null;
  const entries = Object.values(dataset.symbols);
  return {
    jobId: dataset.jobId,
    timeframe: dataset.timeframe,
    startTime: dataset.startTime,
    endTime: dataset.endTime,
    createdAt: dataset.createdAt,
    symbolCount: entries.length,
    klineCount: entries.reduce((total, entry) => total + entry.klines.length, 0)
  };
}

async function ensureDirectory(): Promise<void> {
  await mkdir(config.dataDirectory, { recursive: true });
}

function validateDataset(value: unknown): value is KLineDataset {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<KLineDataset>;
  if (candidate.schemaVersion !== 1 || typeof candidate.jobId !== "string") return false;
  if (typeof candidate.timeframe !== "string" || !timeframeValues.has(candidate.timeframe)) return false;
  if (typeof candidate.startTime !== "string" || typeof candidate.endTime !== "string" || typeof candidate.createdAt !== "string") return false;
  if (!candidate.symbols || typeof candidate.symbols !== "object" || Array.isArray(candidate.symbols)) return false;
  return Object.values(candidate.symbols).every((entry) =>
    !!entry && Array.isArray(entry.klines) && entry.klines.every((kline) =>
      !!kline && ["timestamp", "open", "high", "low", "close", "volume", "turnover"]
        .every((key) => typeof (kline as Record<string, unknown>)[key] === "number" &&
          Number.isFinite((kline as Record<string, number>)[key]))
    )
  );
}

export async function saveActiveDataset(): Promise<DatasetFileSummary> {
  if (!activeDataset) throw new Error("There is no active dataset to save.");
  await ensureDirectory();
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const filename = `collection_${timestamp}_${randomUUID().slice(0, 8)}.json`;
  // wx prevents accidentally overwriting an existing collection file.
  await writeFile(path.join(config.dataDirectory, filename), JSON.stringify(activeDataset, null, 2), {
    encoding: "utf8", flag: "wx"
  });
  return { filename, ...getDatasetSummary(activeDataset)! };
}

export async function listSavedDatasets(): Promise<DatasetFileSummary[]> {
  await ensureDirectory();
  const filenames = (await readdir(config.dataDirectory))
    .filter((filename) => /^collection_[a-zA-Z0-9_-]+\.json$/.test(filename))
    .sort().reverse();
  const summaries: DatasetFileSummary[] = [];
  for (const filename of filenames) {
    try {
      const parsed: unknown = JSON.parse(await readFile(path.join(config.dataDirectory, filename), "utf8"));
      if (!validateDataset(parsed)) continue;
      summaries.push({ filename, ...getDatasetSummary(parsed)! });
    } catch {
      // Keep invalid files out of the selectable dataset list.
    }
  }
  return summaries;
}

export async function loadSavedDataset(filename: string): Promise<KLineDataset> {
  if (!/^collection_[a-zA-Z0-9_-]+\.json$/.test(filename) || path.basename(filename) !== filename) {
    throw new Error("Invalid dataset filename.");
  }
  const content = await readFile(path.join(config.dataDirectory, filename), "utf8");
  const parsed: unknown = JSON.parse(content);
  if (!validateDataset(parsed)) throw new Error("The selected file is not a valid KLineCollector dataset.");
  // Replace only after the file has been read and fully validated.
  activeDataset = parsed;
  return parsed;
}

export function isTimeframe(value: unknown): value is Timeframe {
  return typeof value === "string" && timeframeValues.has(value);
}
