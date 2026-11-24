import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { getJob, hasRunningJob, startCollection, subscribeToJob } from "./services/collection.js";
import { fetchActiveFuturesSymbols } from "./services/kucoin.js";
import {
  getActiveDataset, getDatasetSummary, isTimeframe, listSavedDatasets,
  loadSavedDataset, saveActiveDataset
} from "./services/dataset.js";
import type { CollectionRequest } from "./types.js";

let activeSymbols: string[] = [];

interface CollectBody {
  timeframe?: unknown;
  startTime?: unknown;
  endTime?: unknown;
}

function parseCollectionRequest(body: CollectBody): CollectionRequest {
  if (!isTimeframe(body.timeframe)) throw new Error("Choose a supported KLine timeframe.");
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
  return { timeframe: body.timeframe, startTime: start.toISOString(), endTime: end.toISOString() };
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

  app.get("/api/symbols", async () => ({
    symbols: activeSymbols,
    count: activeSymbols.length,
    fetched: activeSymbols.length > 0
  }));

  app.post("/api/symbols/refresh", async (_request, reply) => {
    try {
      const symbols = await fetchActiveFuturesSymbols();
      activeSymbols = symbols;
      return { symbols, count: symbols.length, fetchedAt: new Date().toISOString() };
    } catch (error) {
      return sendError(reply, error, "Unable to fetch active KuCoin Futures symbols.");
    }
  });

  app.post<{ Body: CollectBody }>("/api/klines/collect", async (request, reply) => {
    try {
      const collectionRequest = parseCollectionRequest(request.body ?? {});
      const job = startCollection(collectionRequest, activeSymbols);
      return reply.code(202).send(job);
    } catch (error) {
      return sendError(reply, error, "Unable to start collection.", 400);
    }
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
