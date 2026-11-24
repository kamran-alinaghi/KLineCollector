export const TIMEFRAMES = {
  "1min": 1, "5min": 5, "15min": 15, "30min": 30, "1hour": 60,
  "2hour": 120, "4hour": 240, "8hour": 480, "12hour": 720,
  "1day": 1440, "1week": 10080
} as const;

export type Timeframe = keyof typeof TIMEFRAMES;
export interface KLine {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}
export interface FuturesSymbol { symbol: string; multiplier: number; }
export interface SymbolKLines { multiplier: number; klines: KLine[]; }
export interface KLineDataset {
  schemaVersion: 2;
  jobId: string;
  timeframe: Timeframe;
  startTime: string;
  endTime: string;
  createdAt: string;
  symbols: Record<string, SymbolKLines>;
}
export type JobStatus = "pending" | "running" | "completed" | "cancelled" | "failed";
export type JobOutcome = "success" | "partial" | "failed";
export interface CollectionJob {
  jobId: string;
  status: JobStatus;
  outcome?: JobOutcome;
  timeframe: Timeframe;
  startTime: string;
  endTime: string;
  totalSymbols: number;
  processedSymbols: number;
  successfulSymbols: number;
  failedSymbols: number;
  currentSymbol: string | null;
  failedSymbolNames: string[];
  progress: number;
  createdAt: string;
  updatedAt: string;
  error?: string;
}
export interface DatasetFileSummary {
  filename: string;
  jobId: string;
  timeframe: Timeframe;
  startTime: string;
  endTime: string;
  createdAt: string;
  symbolCount: number;
  klineCount: number;
}
export interface CollectionRequest {
  timeframe: Timeframe;
  startTime: string;
  endTime: string;
}

export interface MovementAnalysisRow {
  symbol: string;
  movements: number;
  lastPrice: number | null;
  multiplier: number;
  averageVolume: number;
  result: number | null;
}
export interface MovementAnalysisResponse {
  thresholdPercent: number;
  datasetJobId: string;
  results: MovementAnalysisRow[];
}
