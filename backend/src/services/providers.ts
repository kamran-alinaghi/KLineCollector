import type { ExchangeId } from "../types.js";
import type { ExchangeProvider } from "./exchange-provider.js";
import { krakenProvider } from "./kraken.js";
import { kucoinProvider } from "./kucoin.js";
const providers: Record<ExchangeId, ExchangeProvider> = { kraken: krakenProvider, kucoin: kucoinProvider };
export function getExchangeProvider(exchange: ExchangeId): ExchangeProvider { return providers[exchange]; }
export function isExchangeId(value: unknown): value is ExchangeId { return value === "kraken" || value === "kucoin"; }
