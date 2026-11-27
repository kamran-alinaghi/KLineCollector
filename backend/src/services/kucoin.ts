import { config } from "../config.js";
import type { FuturesSymbol, KLine, Timeframe } from "../types.js";
import type { ExchangeProvider } from "./exchange-provider.js";
import { TIMEFRAMES } from "../types.js";

interface KucoinEnvelope<T> { code: string; data: T; msg?: string; }
interface KucoinContract { symbol?: string; multiplier?: number | string; }
type RawKLine = Array<number | string>;

let lastKlineRequestAt = 0;

function abortError(): Error {
  const error = new Error("KLine request was aborted.");
  error.name = "AbortError";
  return error;
}

async function waitForKlineRequestSlot(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError();
  const elapsed = Date.now() - lastKlineRequestAt;
  const remaining = config.kucoinKlineRequestDelayMs - elapsed;
  if (lastKlineRequestAt > 0 && remaining > 0) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, remaining);
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(abortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }
  if (signal?.aborted) throw abortError();
  lastKlineRequestAt = Date.now();
}

async function kucoinGet<T>(
  endpoint: string, params?: Record<string, string | number>, signal?: AbortSignal
): Promise<T> {
  const url = new URL(endpoint, config.kucoinBaseUrl);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, String(value));

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`KuCoin request failed (${response.status}): ${body || response.statusText}`);
  }
  const payload = await response.json() as KucoinEnvelope<T>;
  if (payload.code !== "200000") throw new Error(`KuCoin API error ${payload.code}: ${payload.msg ?? "Unknown error"}`);
  return payload.data;
}

export async function fetchActiveFuturesSymbols(): Promise<FuturesSymbol[]> {
  const contracts = await kucoinGet<KucoinContract[]>("/api/v1/contracts/active");
  const bySymbol = new Map<string, FuturesSymbol>();
  for (const contract of contracts) {
    if (typeof contract.symbol !== "string" || contract.symbol.length === 0) continue;
    const multiplier = Number(contract.multiplier);
    if (!Number.isFinite(multiplier)) {
      throw new Error(`KuCoin returned an invalid multiplier for ${contract.symbol}.`);
    }
    bySymbol.set(contract.symbol, { symbol: contract.symbol, multiplier });
  }
  return [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export async function fetchKLinesPage(
  symbol: string, timeframe: Timeframe, fromMs: number, toMs: number, signal?: AbortSignal
): Promise<KLine[]> {
  await waitForKlineRequestSlot(signal);
  const rows = await kucoinGet<RawKLine[]>("/api/v1/kline/query", {
    symbol, granularity: TIMEFRAMES[timeframe], from: fromMs, to: toMs
  }, signal);
  return rows.map((row) => {
    if (row.length < 7) throw new Error(`KuCoin returned an invalid KLine row for ${symbol}`);
    const values = row.slice(0, 7).map(Number);
    if (values.some((value) => !Number.isFinite(value))) throw new Error(`KuCoin returned non-numeric KLine data for ${symbol}`);
    const [timestamp, open, high, low, close, volume, turnover] = values as [number, number, number, number, number, number, number];
    return { timestamp, open, high, low, close, volume, turnover };
  }).sort((a, b) => a.timestamp - b.timestamp);
}

export const kucoinProvider: ExchangeProvider = {
  id: "kucoin", label: "KuCoin Futures", supportsTimeframe: () => true,
  fetchSymbols: fetchActiveFuturesSymbols, fetchKLinesPage
};
