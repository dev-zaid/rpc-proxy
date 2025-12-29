"use strict";

const { Pool } = require("pg");

const useSsl = String(process.env.DB_SSL || "false").toLowerCase() === "true";
const rejectUnauthorized = String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").toLowerCase() === "true";

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "blockscout",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: Number(process.env.DB_POOL_SIZE || 10),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000),
  ssl: useSsl ? { rejectUnauthorized } : undefined
});

pool.on("error", (err) => {
  console.error(`[${new Date().toISOString()}] PG pool error`, err);
});

module.exports = pool;
