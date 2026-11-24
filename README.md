# KLineCollector

React + TypeScript frontend and Fastify + TypeScript backend for KuCoin Futures market data.

## Requirements
- Node.js 20+
- npm 10+

## Start
```bash
npm install
npm run dev
```
Frontend: http://localhost:5173. API: http://localhost:3001.

Copy `backend/.env.example` to `backend/.env` to configure ports, CORS, KuCoin URL, KLine request delay, and dataset directory.

## Phase 1
- Manually fetch all tradable KuCoin Futures contracts, including each contract's multiplier.
- Collect KLines for every backend-cached symbol with a selected timeframe and date range.
- Store each symbol's multiplier alongside its KLine array in the active dataset and JSON exports.
- Process symbols sequentially with a configurable minimum interval between KLine API requests (including pagination), which also spaces out requests for consecutive symbols.
- Page KLine requests into windows of up to 500 intervals.
- Stream job progress over SSE.
- Abort a collection from the frontend; the backend cancels an in-flight KuCoin request or pending throttle wait and does not start subsequent requests.
- Keep data from fully completed symbols in the active in-memory dataset when a collection is aborted.
- Skip failed symbols and continue when a request fails for reasons other than cancellation.
- Keep the active dataset in backend memory.
- Save manually; every save creates a new JSON file.
- List and load saved files, replacing the active in-memory dataset.

## KuCoin endpoints
- `GET /api/v1/contracts/active`
- `GET /api/v1/kline/query`

KLine `granularity` is in minutes and `from`/`to` use milliseconds. KuCoin documents a maximum of 500 candles per response. Empty intervals may be omitted when there are no trades.

## Runtime behavior
Symbols, jobs, and the active dataset are memory-only and are cleared on backend restart. Saved files live in `backend/data/klines` and are git-ignored. Collection never saves automatically. One collection job runs at a time. The first KLine request starts immediately; subsequent KLine requests are spaced by the configured delay. This also throttles pagination requests for the same symbol. Exported datasets use schema version 2, which requires a numeric multiplier for every symbol; schema version 1 files without multipliers are not loaded by this version.

## API
- GET /api/health
- GET /api/symbols
- POST /api/symbols/refresh
- POST /api/klines/collect
- POST /api/jobs/:jobId/cancel
- GET /api/jobs/:jobId
- GET /api/jobs/:jobId/events (SSE)
- GET /api/datasets
- GET /api/datasets/active
- POST /api/datasets/save
- POST /api/datasets/:filename/load

Collection body contains only `timeframe`, `startTime`, and `endTime`. The backend supplies its own symbol list.

This phase does not implement analysis or order execution.
