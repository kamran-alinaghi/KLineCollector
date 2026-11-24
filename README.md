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

Copy `backend/.env.example` to `backend/.env` to configure ports, CORS, KuCoin URL, symbol delay, and dataset directory.

## Phase 1
- Manually fetch all tradable KuCoin Futures contracts.
- Collect KLines for every backend-cached symbol with a selected timeframe and date range.
- Process symbols sequentially with a configurable 20-second delay between symbols.
- Page KLine requests into windows of up to 500 intervals.
- Stream job progress over SSE.
- Skip failed symbols and continue.
- Keep the active dataset in backend memory.
- Save manually; every save creates a new JSON file.
- List and load saved files, replacing the active in-memory dataset.

## KuCoin endpoints
- `GET /api/v1/contracts/active`
- `GET /api/v1/kline/query`

KLine `granularity` is in minutes and `from`/`to` use milliseconds. KuCoin documents a maximum of 500 candles per response. Empty intervals may be omitted when there are no trades.

## Runtime behavior
Symbols, jobs, and the active dataset are memory-only and are cleared on backend restart. Saved files live in `backend/data/klines` and are git-ignored. Collection never saves automatically. One collection job runs at a time. The delay is applied between symbols, not before the first symbol.

## API
- GET /api/health
- GET /api/symbols
- POST /api/symbols/refresh
- POST /api/klines/collect
- GET /api/jobs/:jobId
- GET /api/jobs/:jobId/events (SSE)
- GET /api/datasets
- GET /api/datasets/active
- POST /api/datasets/save
- POST /api/datasets/:filename/load

Collection body contains only `timeframe`, `startTime`, and `endTime`. The backend supplies its own symbol list.

This phase does not implement analysis or order execution.
