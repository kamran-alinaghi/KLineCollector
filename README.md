# KLineCollector

React + TypeScript frontend and Fastify + TypeScript backend for collecting and analyzing Kraken Futures or KuCoin Futures market data.

## Requirements
- Node.js 20+
- npm 10+

## Start
```bash
npm install
npm run dev
```
Frontend: http://localhost:5173. API: http://localhost:3001.

Copy `backend/.env.example` to `backend/.env` to configure ports, CORS, exchange API base URLs, request delays, and the dataset directory.

## Exchanges and collection
- Kraken Futures is selected by default; KuCoin Futures is also supported.
- Select an exchange, fetch its tradable futures instruments, choose a supported timeframe and date range, and collect candles for each symbol sequentially.
- The collection engine is exchange-independent. Exchange providers implement symbol discovery and candle retrieval; both normalize data into the same KLine dataset format.
- Symbol caches are kept separately per exchange.
- Kraken Futures timeframes: 1m, 5m, 15m, 30m, 1h, 4h, 12h, 1d, 1w.
- KuCoin Futures retains the existing timeframes, including 2h and 8h.
- Kraken instrument `contractSize` is normalized to the shared `multiplier` field; KuCoin contract `multiplier` remains unchanged.
- Kraken's public candle endpoint does not provide turnover; its normalized KLines store `turnover: null`. KuCoin turnover remains populated from its API.
- Request delays are configured independently using `KRAKEN_KLINE_REQUEST_DELAY_MS` and `KUCOIN_KLINE_REQUEST_DELAY_MS`.

### Public API endpoints
**Kraken Futures**
- `GET /derivatives/api/v3/instruments`
- `GET /api/charts/v1/trade/{symbol}/{resolution}`

**KuCoin Futures**
- `GET /api/v1/contracts/active`
- `GET /api/v1/kline/query`

Kraken candle `from` and `to` parameters use epoch seconds; returned candle timestamps are milliseconds. Kraken's documented resolutions are mapped to app timeframe values. KuCoin KLine `granularity` is in minutes and `from`/`to` use milliseconds. KuCoin documents a maximum of 500 candles per response.

## Collection behavior
- Process symbols sequentially with a provider-specific minimum interval between KLine API requests, including pagination.
- Page requested date ranges into windows of up to 500 intervals.
- Stream job progress over SSE.
- Abort an in-flight request or pending throttle wait; do not start subsequent requests after cancellation.
- Keep data from fully completed symbols in the active in-memory dataset when a collection is aborted.
- Skip failed symbols and continue when a request fails for reasons other than cancellation.
- Keep the active dataset in backend memory; save manually as a new JSON file.
- List and load saved files, replacing the active in-memory dataset.
- One collection job runs at a time.

## Dataset format
New exports use schema version 3 and include `exchange` and `marketType: "futures"` metadata. Datasets from different exchanges are independent; the application does not compare results across exchanges. Existing schema version 2 datasets are migrated on load and treated as KuCoin Futures datasets.

Symbols, jobs, and the active dataset are memory-only and are cleared on backend restart. Saved files live in `backend/data/klines` and are git-ignored. Collection never saves automatically.

## API
- GET /api/health
- GET /api/symbols?exchange=kraken|kucoin
- POST /api/symbols/refresh (body: `{ "exchange": "kraken" }`; defaults to Kraken)
- POST /api/klines/collect (body: `exchange`, `timeframe`, `startTime`, `endTime`)
- POST /api/jobs/:jobId/cancel
- GET /api/jobs/:jobId
- GET /api/jobs/:jobId/events (SSE)
- GET /api/datasets
- GET /api/datasets/active
- POST /api/datasets/save
- POST /api/datasets/:filename/load
- POST /api/analysis/movements

## Price movement analysis
- Analyze every symbol in the active dataset using KLine high prices only for directional movement counts.
- Accept a user-defined positive reversal threshold percentage.
- Count directional legs when price advances by the threshold from a local low or reverses by the threshold from a local high; extensions in the same direction remain one movement.
- Calculate average volume as the arithmetic mean of all candle `volume` values for that symbol.
- Calculate the final result as `lastPrice * multiplier * averageVolume`, where `lastPrice` is the most recent candle's high.
- Show symbol, movement count, last price, multiplier, average volume, and result in the table.
- Support independent per-column filters; numeric columns accept exact values and `>`, `>=`, `<`, `<=` comparisons. All columns are sortable.

The same analysis engine is used for either selected exchange. Analysis runs in the backend and does not modify the collected dataset. No order execution is implemented.
