"use strict";

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const pool = require("./db/pool");
const { handleTraceBlock } = require("./handlers/traceBlock");
const { proxyJson, proxyStream } = require("./handlers/proxy");
const { jsonRpcError } = require("./utils/formatters");

const app = express();
const PORT = Number(process.env.PORT || 8545);
const HOST = process.env.HOST || "0.0.0.0";
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
const ENABLE_CORS = String(process.env.ENABLE_CORS || "false").toLowerCase() === "true";

app.use(helmet());
if (ENABLE_CORS) app.use(cors());

app.use(express.json({ limit: "1mb" }));
app.use(morgan(":method :url :status :response-time ms"));
app.use((req, res, next) => {
  if (typeof req.setTimeout === "function") {
    req.setTimeout(REQUEST_TIMEOUT_MS);
  }
  if (typeof res.setTimeout === "function") {
    res.setTimeout(REQUEST_TIMEOUT_MS);
  }
  if (req.method === "POST" && req.body) {
    const payload = req.body;
    const timestamp = new Date().toISOString();
    if (Array.isArray(payload)) {
      const methods = payload.map((item) => item?.method).filter(Boolean);
      console.log(`[${timestamp}] rpc batch size=${payload.length} methods=${methods.join(",")}`);
    } else if (payload.method) {
      const params = JSON.stringify(payload.params ?? []);
      console.log(`[${timestamp}] rpc method=${payload.method} params=${params}`);
    }
  }
  next();
});

app.get("/health", async (_req, res) => {
  try {
    console.log(`[${new Date().toISOString()}] health check`);
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] health check failed`, err);
    res.status(503).json({ status: "db_unavailable" });
  }
});

app.post("/", async (req, res) => {
  const payload = req.body;

  if (!payload) {
    return res.status(400).json(jsonRpcError(null, -32600, "Invalid Request"));
  }

  const isBatch = Array.isArray(payload);

  if (isBatch && payload.length === 0) {
    return res.status(400).json(jsonRpcError(null, -32600, "Invalid Request"));
  }

  if (!isBatch) {
    if (payload.method === "trace_block") {
      const response = await handleTraceBlock(payload);
      return res.json(response);
    }

    return proxyStream(payload, REQUEST_TIMEOUT_MS, res);
  }

  const responses = [];
  for (const entry of payload) {
    if (!entry || typeof entry.method !== "string") {
      responses.push(jsonRpcError(entry?.id ?? null, -32600, "Invalid Request"));
      continue;
    }

    if (entry.method === "trace_block") {
      responses.push(await handleTraceBlock(entry));
      continue;
    }

    responses.push(await proxyJson(entry, REQUEST_TIMEOUT_MS));
  }

  return res.json(responses);
});

app.use((err, _req, res, _next) => {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json(jsonRpcError(null, -32700, "Parse error"));
  }
  console.error(`[${new Date().toISOString()}] Unhandled error`, err);
  return res.status(500).json(jsonRpcError(null, -32603, "Internal error"));
});

const server = app.listen(PORT, HOST, () => {
  console.log(`[${new Date().toISOString()}] RPC proxy listening on ${HOST}:${PORT}`);
});
server.on("error", (err) => {
  console.error(`[${new Date().toISOString()}] Server error`, err);
});

function shutdown(signal) {
  console.log(`[${new Date().toISOString()}] Received ${signal}, shutting down`);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });

  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  console.error(`[${new Date().toISOString()}] Unhandled rejection`, reason);
});
process.on("uncaughtException", (err) => {
  console.error(`[${new Date().toISOString()}] Uncaught exception`, err);
  shutdown("uncaughtException");
});
