import type { CollectionJob, DatasetSummary, Timeframe } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers }
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload;
}

export interface SymbolResponse { symbols: string[]; count: number; fetchedAt?: string; fetched?: boolean; }
export interface DatasetListResponse { datasets: DatasetSummary[]; }
export interface ActiveDatasetResponse { dataset: DatasetSummary | null; }

export const api = {
  getSymbols: () => request<SymbolResponse>("/api/symbols"),
  refreshSymbols: () => request<SymbolResponse>("/api/symbols/refresh", { method: "POST" }),
  getDatasets: () => request<DatasetListResponse>("/api/datasets"),
  getActiveDataset: () => request<ActiveDatasetResponse>("/api/datasets/active"),
  saveDataset: () => request<{ dataset: DatasetSummary }>("/api/datasets/save", { method: "POST" }),
  loadDataset: (filename: string) => request<{ dataset: DatasetSummary }>(
    `/api/datasets/${encodeURIComponent(filename)}/load`, { method: "POST" }
  ),
  startCollection: (input: { timeframe: Timeframe; startTime: string; endTime: string }) =>
    request<CollectionJob>("/api/klines/collect", { method: "POST", body: JSON.stringify(input) }),
  jobEventsUrl: (jobId: string) => `${API_BASE}/api/jobs/${encodeURIComponent(jobId)}/events`
};
