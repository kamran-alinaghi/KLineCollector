import type { CollectionJob, DatasetSummary, ExchangeId, MovementAnalysisResponse, Timeframe } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  // Do not send an application/json content type on body-less POST requests.
  // Fastify correctly rejects an empty JSON body with HTTP 400.
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
  return payload;
}

export interface FuturesSymbol { symbol: string; multiplier: number; }
export interface SymbolResponse { symbols: FuturesSymbol[]; count: number; fetchedAt?: string; fetched?: boolean; }
export interface DatasetListResponse { datasets: DatasetSummary[]; }
export interface ActiveDatasetResponse { dataset: DatasetSummary | null; }

export const api = {
  getSymbols: (exchange: ExchangeId) => request<SymbolResponse>(`/api/symbols?exchange=${exchange}`),
  refreshSymbols: (exchange: ExchangeId) => request<SymbolResponse>("/api/symbols/refresh", { method: "POST", body: JSON.stringify({ exchange }) }),
  getDatasets: () => request<DatasetListResponse>("/api/datasets"),
  getActiveDataset: () => request<ActiveDatasetResponse>("/api/datasets/active"),
  saveDataset: () => request<{ dataset: DatasetSummary }>("/api/datasets/save", { method: "POST" }),
  loadDataset: (filename: string) => request<{ dataset: DatasetSummary }>(
    `/api/datasets/${encodeURIComponent(filename)}/load`, { method: "POST" }
  ),
  startCollection: (input: { exchange: ExchangeId; timeframe: Timeframe; startTime: string; endTime: string }) =>
    request<CollectionJob>("/api/klines/collect", { method: "POST", body: JSON.stringify(input) }),
  cancelCollection: (jobId: string) =>
    request<{ accepted: boolean; job: CollectionJob }>(
      `/api/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" }
    ),
  calculateMovements: (thresholdPercent: number) => request<MovementAnalysisResponse>(
    "/api/analysis/movements", { method: "POST", body: JSON.stringify({ thresholdPercent }) }
  ),
  jobEventsUrl: (jobId: string) => `${API_BASE}/api/jobs/${encodeURIComponent(jobId)}/events`
};
