import "dotenv/config";
import path from "node:path";

function integer(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export const config = {
  port: integer(process.env.PORT, 3001),
  host: process.env.HOST ?? "0.0.0.0",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  kucoinBaseUrl: (process.env.KUCOIN_FUTURES_BASE_URL ?? "https://api-futures.kucoin.com").replace(/\/$/, ""),
  symbolRequestDelayMs: integer(process.env.SYMBOL_REQUEST_DELAY_MS, 20_000),
  dataDirectory: path.resolve(process.cwd(), process.env.DATA_DIRECTORY ?? "./data/klines")
};
