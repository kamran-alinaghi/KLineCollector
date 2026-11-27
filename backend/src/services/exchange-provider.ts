import type { ExchangeId, FuturesSymbol, KLine, Timeframe } from "../types.js";
export interface ExchangeProvider {
  readonly id: ExchangeId;
  readonly label: string;
  supportsTimeframe(timeframe: Timeframe): boolean;
  fetchSymbols(): Promise<FuturesSymbol[]>;
  fetchKLinesPage(symbol: string, timeframe: Timeframe, fromMs: number, toMs: number, signal?: AbortSignal): Promise<KLine[]>;
}
