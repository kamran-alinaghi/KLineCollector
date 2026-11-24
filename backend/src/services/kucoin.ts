import { config } from "../config.js";
import type { KLine, Timeframe } from "../types.js";
import { TIMEFRAMES } from "../types.js";

interface KucoinEnvelope<T> { code: string; data: T; msg?: string; }
interface KucoinContract { symbol?: string; }
type RawKLine = Array<number | string>;

async function kucoinGet<T>(endpoint: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL(endpoint, config.kucoinBaseUrl);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, String(value));

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`KuCoin request failed (${response.status}): ${body || response.statusText}`);
  }
  const payload = await response.json() as KucoinEnvelope<T>;
  if (payload.code !== "200000") throw new Error(`KuCoin API error ${payload.code}: ${payload.msg ?? "Unknown error"}`);
  return payload.data;
}

export async function fetchActiveFuturesSymbols(): Promise<string[]> {
  const contracts = await kucoinGet<KucoinContract[]>("/api/v1/contracts/active");
  return [...new Set(contracts
    .filter((contract) => typeof contract.symbol === "string" && contract.symbol.length > 0)
    .map((contract) => contract.symbol as string))].sort();
}

export async function fetchKLinesPage(
  symbol: string, timeframe: Timeframe, fromMs: number, toMs: number
): Promise<KLine[]> {
  const rows = await kucoinGet<RawKLine[]>("/api/v1/kline/query", {
    symbol, granularity: TIMEFRAMES[timeframe], from: fromMs, to: toMs
  });
  return rows.map((row) => {
    if (row.length < 7) throw new Error(`KuCoin returned an invalid KLine row for ${symbol}`);
    const values = row.slice(0, 7).map(Number);
    if (values.some((value) => !Number.isFinite(value))) throw new Error(`KuCoin returned non-numeric KLine data for ${symbol}`);
    const [timestamp, open, high, low, close, volume, turnover] = values as [number, number, number, number, number, number, number];
    return { timestamp, open, high, low, close, volume, turnover };
  }).sort((a, b) => a.timestamp - b.timestamp);
}
