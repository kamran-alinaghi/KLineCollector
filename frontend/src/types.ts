export type ExchangeId = "kraken" | "kucoin";
export const EXCHANGES: { value: ExchangeId; label: string }[] = [
  { value: "kraken", label: "Kraken Futures" }, { value: "kucoin", label: "KuCoin Futures" }
];
export const TIMEFRAMES_BY_EXCHANGE = {
  kraken: [
    { value: "1min", label: "1 minute" }, { value: "5min", label: "5 minutes" },
    { value: "15min", label: "15 minutes" }, { value: "30min", label: "30 minutes" },
    { value: "1hour", label: "1 hour" }, { value: "4hour", label: "4 hours" },
    { value: "12hour", label: "12 hours" }, { value: "1day", label: "1 day" },
    { value: "1week", label: "1 week" }
  ],
  kucoin: [
    { value: "1min", label: "1 minute" }, { value: "5min", label: "5 minutes" },
    { value: "15min", label: "15 minutes" }, { value: "30min", label: "30 minutes" },
    { value: "1hour", label: "1 hour" }, { value: "2hour", label: "2 hours" },
    { value: "4hour", label: "4 hours" }, { value: "8hour", label: "8 hours" },
    { value: "12hour", label: "12 hours" }, { value: "1day", label: "1 day" },
    { value: "1week", label: "1 week" }
  ]
} as const;
export type Timeframe = typeof TIMEFRAMES_BY_EXCHANGE.kucoin[number]["value"];
export interface CollectionJob {
  jobId: string; exchange: ExchangeId;
  status: "pending" | "running" | "completed" | "cancelled" | "failed";
  outcome?: "success" | "partial" | "failed"; timeframe: Timeframe;
  startTime: string; endTime: string; totalSymbols: number; processedSymbols: number;
  successfulSymbols: number; failedSymbols: number; currentSymbol: string | null;
  failedSymbolNames: string[]; progress: number; createdAt: string; updatedAt: string; error?: string;
}
export interface DatasetSummary {
  filename?: string; jobId: string; exchange: ExchangeId; timeframe: Timeframe;
  startTime: string; endTime: string; createdAt: string; symbolCount: number; klineCount: number;
}
export interface MovementAnalysisRow {
  symbol: string; movements: number; lastPrice: number | null;
  multiplier: number; averageVolume: number; result: number | null;
}
export interface MovementAnalysisResponse {
  thresholdPercent: number; datasetJobId: string; results: MovementAnalysisRow[];
}
