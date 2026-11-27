import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { cancelCollection, getJob, hasRunningJob, startCollection, subscribeToJob } from "./services/collection.js";
import { getExchangeProvider, isExchangeId } from "./services/providers.js";
import {
  getActiveDataset, getDatasetSummary, isTimeframe, listSavedDatasets,
  loadSavedDataset, saveActiveDataset
} from "./services/dataset.js";
import type { CollectionRequest, ExchangeId, FuturesSymbol, Timeframe } from "./types.js";
import { analyzeDatasetMovements } from "./services/movement-analysis.js";

const activeSymbolsByExchange = new Map<ExchangeId, FuturesSymbol[]>();
const DEFAULT_EXCHANGE: ExchangeId = "kraken";
function parseExchange(value: unknown): ExchangeId {
  if (value === undefined || value === null || value === "") return DEFAULT_EXCHANGE;
  if (!isExchangeId(value)) throw new Error("Choose a supported exchange.");
  return value;
}
function isTimeframeForExchange(value: unknown, exchange: ExchangeId): value is Timeframe {
  return isTimeframe(value) && getExchangeProvider(exchange).supportsTimeframe(value);
}

interface CollectBody {
  exchange?: unknown;
  timeframe?: unknown;
  startTime?: unknown;
  endTime?: unknown;
}

function parseCollectionRequest(body: CollectBody): CollectionRequest {
  const exchange = parseExchange(body.exchange);
  if (!isTimeframeForExchange(body.timeframe, exchange)) throw new Error(`Choose a timeframe supported by ${getExchangeProvider(exchange).label}.`);
  if (typeof body.startTime !== "string" || typeof body.endTime !== "string") {
    throw new Error("Start time and end time are required.");
  }
  const start = new Date(body.startTime);
  const end = new Date(body.endTime);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    throw new Error("Start time and end time must be valid ISO date values.");
  }
  if (start.getTime() >= end.getTime()) throw new Error("Start time must be earlier than end time.");
  if (end.getTime() > Date.now() + 60_000) throw new Error("End time cannot be in the future.");
  return { exchange, timeframe: body.timeframe, startTime: start.toISOString(), endTime: end.toISOString() };
}

function sendError(reply: FastifyReply, error: unknown, fallback: string, status = 502) {
  const message = error instanceof Error ? error.message : fallback;
  return reply.code(status).send({ error: message || fallback });
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, bodyLimit: 1_048_576 });
  await app.register(cors, {
    origin: config.corsOrigin.split(",").map((origin) => origin.trim()),
    methods: ["GET", "POST", "OPTIONS"]
  });

  app.get("/api/health", async () => ({ status: "ok" }));

  app.get<{ Querystring: { exchange?: string } }>("/api/symbols", async (request, reply) => {
    let exchange: ExchangeId;
    try { exchange = parseExchange(request.query.exchange); }
    catch (error) { return sendError(reply, error, "Unsupported exchange.", 400); }
    const symbols = activeSymbolsByExchange.get(exchange) ?? [];
    return { exchange, symbols, count: symbols.length, fetched: symbols.length > 0 };
  });

  app.post<{ Body: { exchange?: unknown } }>("/api/symbols/refresh", async (request, reply) => {
    try {
      const exchange = parseExchange(request.body?.exchange);
      const provider = getExchangeProvider(exchange);
      const symbols = await provider.fetchSymbols();
      activeSymbolsByExchange.set(exchange, symbols);
      return { exchange, symbols, count: symbols.length, fetchedAt: new Date().toISOString() };
    } catch (error) {
      return sendError(reply, error, "Unable to fetch active exchange symbols.");
    }
  });

  app.post<{ Body: CollectBody }>("/api/klines/collect", async (request, reply) => {
    try {
      const collectionRequest = parseCollectionRequest(request.body ?? {});
      const symbols = activeSymbolsByExchange.get(collectionRequest.exchange) ?? [];
      const job = startCollection(collectionRequest, symbols);
      return reply.code(202).send(job);
    } catch (error) {
      return sendError(reply, error, "Unable to start collection.", 400);
    }
  });

  app.post<{ Params: { jobId: string } }>("/api/jobs/:jobId/cancel", async (request, reply) => {
    const job = cancelCollection(request.params.jobId);
    if (!job) return reply.code(404).send({ error: "Collection job not found." });
    if (job.status !== "pending" && job.status !== "running") {
      return reply.code(409).send({ error: "This collection job is no longer running." });
    }
    return { accepted: true, job };
  });

  app.get<{ Params: { jobId: string } }>("/api/jobs/:jobId", async (request, reply) => {
    const job = getJob(request.params.jobId);
    if (!job) return reply.code(404).send({
      error: "Collection job not found. It may have been cleared by a backend restart."
    });
    return job;
  });

  app.get<{ Params: { jobId: string } }>("/api/jobs/:jobId/events", async (request, reply) => {
    const jobId = request.params.jobId;
    const initial = getJob(jobId);
    if (!initial) return reply.code(404).send({ error: "Collection job not found." });

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    raw.write(`event: progress\ndata: ${JSON.stringify(initial)}\n\n`);

    const unsubscribe = subscribeToJob(jobId, (snapshot) => {
      if (!raw.destroyed) raw.write(`event: progress\ndata: ${JSON.stringify(snapshot)}\n\n`);
    });
    const heartbeat = setInterval(() => {
      if (!raw.destroyed) raw.write(": keep-alive\n\n");
    }, 15_000);

    raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });


  app.post<{ Body: { thresholdPercent?: unknown } }>("/api/analysis/movements", async (request, reply) => {
    const dataset = getActiveDataset();
    if (!dataset) return reply.code(409).send({ error: "Load or collect a dataset before running movement analysis." });
    const thresholdPercent = request.body?.thresholdPercent;
    if (typeof thresholdPercent !== "number" || !Number.isFinite(thresholdPercent) || thresholdPercent <= 0) {
      return reply.code(400).send({ error: "Threshold percentage must be a positive number." });
    }
    try {
      return {
        thresholdPercent,
        datasetJobId: dataset.jobId,
        results: analyzeDatasetMovements(dataset, thresholdPercent)
      };
    } catch (error) {
      return sendError(reply, error, "Unable to calculate price movements.", 400);
    }
  });

  app.get("/api/datasets", async () => ({ datasets: await listSavedDatasets() }));
  app.get("/api/datasets/active", async () => ({ dataset: getDatasetSummary(getActiveDataset()) }));

  app.post("/api/datasets/save", async (_request, reply) => {
    if (hasRunningJob()) return reply.code(409).send({ error: "Wait for collection to finish before saving the dataset." });
    try {
      const dataset = await saveActiveDataset();
      return reply.code(201).send({ dataset });
    } catch (error) {
      return sendError(reply, error, "Unable to save the active dataset.", 400);
    }
  });

  app.post<{ Params: { filename: string } }>("/api/datasets/:filename/load", async (request, reply) => {
    if (hasRunningJob()) return reply.code(409).send({ error: "Wait for collection to finish before loading a dataset." });
    try {
      const dataset = await loadSavedDataset(request.params.filename);
      return { dataset: getDatasetSummary(dataset) };
    } catch (error) {
      return sendError(reply, error, "Unable to load the selected dataset.", 400);
    }
  });

  return app;
}
