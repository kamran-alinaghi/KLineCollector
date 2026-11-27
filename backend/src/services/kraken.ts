import { config } from "../config.js";
import type { FuturesSymbol, KLine, Timeframe } from "../types.js";
import type { ExchangeProvider } from "./exchange-provider.js";
interface KrakenInstrument { symbol?: string; tradeable?: boolean; contractSize?: number | string; }
interface KrakenInstrumentsResponse { instruments?: KrakenInstrument[]; }
interface KrakenCandle {
  time?: number | string; open?: number | string; high?: number | string;
  low?: number | string; close?: number | string; volume?: number | string;
}
interface KrakenCandlesResponse { candles?: KrakenCandle[]; more_candles?: boolean; }
export const KRAKEN_RESOLUTIONS: Partial<Record<Timeframe, string>> = {
  "1min": "1m", "5min": "5m", "15min": "15m", "30min": "30m",
  "1hour": "1h", "4hour": "4h", "12hour": "12h", "1day": "1d", "1week": "1w"
};
let lastKlineRequestAt = 0;
function abortError(): Error { const error = new Error("KLine request was aborted."); error.name = "AbortError"; return error; }
async function waitForKlineRequestSlot(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError();
  const remaining = config.krakenKlineRequestDelayMs - (Date.now() - lastKlineRequestAt);
  if (lastKlineRequestAt > 0 && remaining > 0) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, remaining);
      const onAbort = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); reject(abortError()); };
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }
  if (signal?.aborted) throw abortError();
  lastKlineRequestAt = Date.now();
}
async function krakenGet<T>(endpoint: string, params?: Record<string, string | number>, signal?: AbortSignal): Promise<T> {
  const url = new URL(endpoint, config.krakenBaseUrl);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Kraken request failed (${response.status}): ${body || response.statusText}`);
  }
  return await response.json() as T;
}
export async function fetchKrakenFuturesSymbols(): Promise<FuturesSymbol[]> {
  const payload = await krakenGet<KrakenInstrumentsResponse>("/derivatives/api/v3/instruments");
  if (!Array.isArray(payload.instruments)) throw new Error("Kraken returned an invalid futures instruments response.");
  const bySymbol = new Map<string, FuturesSymbol>();
  for (const instrument of payload.instruments) {
    if (instrument.tradeable !== true || typeof instrument.symbol !== "string" || !instrument.symbol.trim()) continue;
    const multiplier = Number(instrument.contractSize);
    if (!Number.isFinite(multiplier) || multiplier <= 0) throw new Error(`Kraken returned an invalid contractSize for ${instrument.symbol}.`);
    const symbol = instrument.symbol.toUpperCase();
    bySymbol.set(symbol, { symbol, multiplier });
  }
  return [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}
export async function fetchKrakenKLinesPage(
  symbol: string, timeframe: Timeframe, fromMs: number, toMs: number, signal?: AbortSignal
): Promise<KLine[]> {
  const resolution = KRAKEN_RESOLUTIONS[timeframe];
  if (!resolution) throw new Error(`Kraken Futures does not support the ${timeframe} timeframe.`);
  await waitForKlineRequestSlot(signal);
  const payload = await krakenGet<KrakenCandlesResponse>(
    `/api/charts/v1/trade/${encodeURIComponent(symbol)}/${resolution}`,
    { from: Math.floor(fromMs / 1000), to: Math.floor(toMs / 1000), count: 500 }, signal
  );
  if (!Array.isArray(payload.candles)) throw new Error(`Kraken returned an invalid candle response for ${symbol}.`);
  return payload.candles.map((candle) => {
    const values = [Number(candle.time), Number(candle.open), Number(candle.high), Number(candle.low), Number(candle.close), Number(candle.volume)];
    if (values.some((value) => !Number.isFinite(value))) throw new Error(`Kraken returned non-numeric candle data for ${symbol}.`);
    const [timestamp, open, high, low, close, volume] = values;
    return { timestamp, open, high, low, close, volume, turnover: null };
  }).sort((a, b) => a.timestamp - b.timestamp);
}
export const krakenProvider: ExchangeProvider = {
  id: "kraken", label: "Kraken Futures",
  supportsTimeframe: (timeframe) => KRAKEN_RESOLUTIONS[timeframe] !== undefined,
  fetchSymbols: fetchKrakenFuturesSymbols, fetchKLinesPage: fetchKrakenKLinesPage
};
