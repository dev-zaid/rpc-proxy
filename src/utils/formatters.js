"use strict";

function isHexString(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value);
}

function normalizeHex(value, { empty = "0x0" } = {}) {
  if (value === null || value === undefined) return empty;

  if (Buffer.isBuffer(value)) {
    const hex = value.toString("hex");
    return `0x${hex}`;
  }

  if (typeof value === "bigint") return `0x${value.toString(16)}`;
  if (typeof value === "number") return `0x${BigInt(value).toString(16)}`;

  if (typeof value === "string") {
    if (isHexString(value)) return value.toLowerCase();
    if (value.startsWith("\\x")) return `0x${value.slice(2)}`.toLowerCase();
    if (value === "") return empty;
    if (/^\d+$/.test(value)) return `0x${BigInt(value).toString(16)}`;
  }

  return empty;
}

function normalizeBytes(value) {
  if (value === null || value === undefined) return "0x";
  if (Buffer.isBuffer(value)) return `0x${value.toString("hex")}`;
  if (typeof value === "string") {
    if (isHexString(value)) return value.toLowerCase();
    if (value.startsWith("\\x")) return `0x${value.slice(2)}`.toLowerCase();
  }
  return "0x";
}

function normalizeAddress(value) {
  if (value === null || value === undefined) return null;
  let hex = null;

  if (Buffer.isBuffer(value)) {
    hex = value.toString("hex");
  } else if (typeof value === "string") {
    if (isHexString(value)) {
      hex = value.slice(2);
    } else if (value.startsWith("\\x")) {
      hex = value.slice(2);
    }
  }

  if (!hex || hex.length === 0) return null;
  const padded = hex.toLowerCase().padStart(40, "0").slice(-40);
  return `0x${padded}`;
}

function parseTraceAddress(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map((item) => Number(item));
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "{}" || trimmed === "") return [];
    const withoutBraces = trimmed.replace(/^\{/, "").replace(/\}$/, "");
    if (withoutBraces === "") return [];
    return withoutBraces.split(",").map((item) => Number(item));
  }
  return [];
}

function jsonRpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error
  };
}

module.exports = {
  normalizeHex,
  normalizeAddress,
  normalizeBytes,
  parseTraceAddress,
  jsonRpcError
};
