import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import type { DatasetFileSummary, ExchangeId, KLineDataset, Timeframe } from "../types.js";
import { isExchangeId } from "./providers.js";
let activeDataset: KLineDataset | null = null;
const timeframeValues = new Set(["1min", "5min", "15min", "30min", "1hour", "2hour", "4hour", "8hour", "12hour", "1day", "1week"]);
export function getActiveDataset(): KLineDataset | null { return activeDataset; }
export function setActiveDataset(dataset: KLineDataset | null): void { activeDataset = dataset; }
export function getDatasetSummary(dataset: KLineDataset | null) {
  if (!dataset) return null;
  const entries = Object.values(dataset.symbols);
  return {
    jobId: dataset.jobId, exchange: dataset.exchange, timeframe: dataset.timeframe,
    startTime: dataset.startTime, endTime: dataset.endTime, createdAt: dataset.createdAt,
    symbolCount: entries.length, klineCount: entries.reduce((total, entry) => total + entry.klines.length, 0)
  };
}
async function ensureDirectory(): Promise<void> { await mkdir(config.dataDirectory, { recursive: true }); }
function normalizeDataset(value: unknown): KLineDataset | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const legacy = candidate.schemaVersion === 2;
  if ((!legacy && candidate.schemaVersion !== 3) || typeof candidate.jobId !== "string") return null;
  if (typeof candidate.timeframe !== "string" || !timeframeValues.has(candidate.timeframe)) return null;
  if (typeof candidate.startTime !== "string" || typeof candidate.endTime !== "string" || typeof candidate.createdAt !== "string") return null;
  if (!candidate.symbols || typeof candidate.symbols !== "object" || Array.isArray(candidate.symbols)) return null;
  const exchange: ExchangeId = legacy ? "kucoin" : candidate.exchange as ExchangeId;
  if (!legacy && (!isExchangeId(candidate.exchange) || candidate.marketType !== "futures")) return null;
  const valid = Object.values(candidate.symbols).every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const data = entry as Record<string, unknown>;
    return typeof data.multiplier === "number" && Number.isFinite(data.multiplier) &&
      Array.isArray(data.klines) && data.klines.every((item) => {
        if (!item || typeof item !== "object") return false;
        const candle = item as Record<string, unknown>;
        return ["timestamp", "open", "high", "low", "close", "volume"].every((key) =>
          typeof candle[key] === "number" && Number.isFinite(candle[key])
        ) && (candle.turnover === null || (typeof candle.turnover === "number" && Number.isFinite(candle.turnover)));
      });
  });
  if (!valid) return null;
  return { ...candidate, schemaVersion: 3, exchange, marketType: "futures", symbols: candidate.symbols } as unknown as KLineDataset;
}
export async function saveActiveDataset(): Promise<DatasetFileSummary> {
  if (!activeDataset) throw new Error("There is no active dataset to save.");
  await ensureDirectory();
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const filename = `collection_${timestamp}_${randomUUID().slice(0, 8)}.json`;
  await writeFile(path.join(config.dataDirectory, filename), JSON.stringify(activeDataset, null, 2), { encoding: "utf8", flag: "wx" });
  return { filename, ...getDatasetSummary(activeDataset)! };
}
export async function listSavedDatasets(): Promise<DatasetFileSummary[]> {
  await ensureDirectory();
  const filenames = (await readdir(config.dataDirectory)).filter((filename) => /^collection_[a-zA-Z0-9_-]+\.json$/.test(filename)).sort().reverse();
  const summaries: DatasetFileSummary[] = [];
  for (const filename of filenames) {
    try {
      const parsed = normalizeDataset(JSON.parse(await readFile(path.join(config.dataDirectory, filename), "utf8")));
      if (parsed) summaries.push({ filename, ...getDatasetSummary(parsed)! });
    } catch { /* Keep invalid files out of the selectable dataset list. */ }
  }
  return summaries;
}
export async function loadSavedDataset(filename: string): Promise<KLineDataset> {
  if (!/^collection_[a-zA-Z0-9_-]+\.json$/.test(filename) || path.basename(filename) !== filename) throw new Error("Invalid dataset filename.");
  const parsed = normalizeDataset(JSON.parse(await readFile(path.join(config.dataDirectory, filename), "utf8")));
  if (!parsed) throw new Error("The selected file is not a valid KLineCollector dataset.");
  activeDataset = parsed;
  return parsed;
}
export function isTimeframe(value: unknown): value is Timeframe { return typeof value === "string" && timeframeValues.has(value); }
