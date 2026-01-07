"use strict";

const pool = require("../db/pool");
const {
  normalizeHex,
  normalizeAddress,
  normalizeBytes,
  parseTraceAddress,
  jsonRpcError
} = require("../utils/formatters");

const CALL_TYPE_COLUMN_SQL = `
SELECT 1
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'internal_transactions'
  AND column_name = 'call_type'
LIMIT 1;
`;

const BLOCK_EXISTS_SQL = `
SELECT 1
FROM transactions
WHERE block_number = $1
LIMIT 1;
`;

const BLOCKS_TABLE_EXISTS_SQL = `
SELECT 1
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'blocks'
LIMIT 1;
`;

const BLOCK_EXISTS_IN_BLOCKS_SQL = `
SELECT 1
FROM blocks
WHERE number = $1
LIMIT 1;
`;

const BLOCK_TX_COUNT_SQL = `
SELECT COUNT(*)::int AS tx_count
FROM transactions
WHERE block_number = $1;
`;

const BLOCK_TRACED_TX_COUNT_SQL = `
SELECT COUNT(DISTINCT it.transaction_hash)::int AS traced_tx_count
FROM internal_transactions it
JOIN transactions t ON it.transaction_hash = t.hash
WHERE t.block_number = $1;
`;

let traceSqlPromise;
let hashColumnIsByteaPromise;

async function getTraceSql({ byBlock }) {
  if (!traceSqlPromise) {
    traceSqlPromise = (async () => {
      const { rowCount } = await pool.query(CALL_TYPE_COLUMN_SQL);
      const callTypeExpr = rowCount > 0 ? "COALESCE(it.call_type, it.type)" : "it.type";
      return {
        byBlock: `
SELECT 
  t.hash as transaction_hash,
  t.block_hash,
  t.block_number,
  t.index as transaction_position,
  ${callTypeExpr} as call_type,
  it.from_address_hash,
  it.to_address_hash,
  it.value,
  it.gas,
  it.gas_used,
  it.input,
  it.output,
  it.error,
  it.trace_address,
  it.index as trace_index
FROM internal_transactions it
JOIN transactions t ON it.transaction_hash = t.hash
WHERE t.block_number = $1
ORDER BY t.index, it.index;
        `,
        byTransaction: `
SELECT 
  t.hash as transaction_hash,
  t.block_hash,
  t.block_number,
  t.index as transaction_position,
  ${callTypeExpr} as call_type,
  it.from_address_hash,
  it.to_address_hash,
  it.value,
  it.gas,
  it.gas_used,
  it.input,
  it.output,
  it.error,
  it.trace_address,
  it.index as trace_index
FROM internal_transactions it
JOIN transactions t ON it.transaction_hash = t.hash
WHERE t.hash = $1
ORDER BY t.index, it.index;
        `
      };
    })();
  }

  const sql = await traceSqlPromise;
  return byBlock ? sql.byBlock : sql.byTransaction;
}

async function getHashColumnIsBytea() {
  if (!hashColumnIsByteaPromise) {
    hashColumnIsByteaPromise = (async () => {
      const { rows } = await pool.query(`
SELECT data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'transactions'
  AND column_name = 'hash'
LIMIT 1;
      `);
      return rows[0]?.data_type === "bytea";
    })();
  }

  return hashColumnIsByteaPromise;
}

function isValidHexBlock(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
}

function isValidHexTx(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function getUpstreamUrl() {
  return process.env.EVMOS_RPC_URL || "http://18.60.158.87:8545";
}

function getTraceReadyMode() {
  const mode = String(process.env.TRACE_READY_MODE || "").toLowerCase();
  if (mode === "counts" || mode === "per_block") return "counts";
  if (mode === "height") return "height";
  const hasHeightGuard = Boolean(
    process.env.TRACE_READY_HEIGHT || process.env.TRACE_READY_LAG
  );
  return hasHeightGuard ? "height" : "none";
}

function traceReadyDebugEnabled() {
  return String(process.env.TRACE_READY_DEBUG || "false").toLowerCase() === "true";
}

async function getUpstreamBlock(blockNumberHex) {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  timeoutId.unref();

  try {
    const response = await fetch(getUpstreamUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getBlockByNumber",
        params: [blockNumberHex, false]
      }),
      signal: controller.signal
    });

    const data = await response.json().catch(() => null);
    if (data === null) return null;
    return { ok: true, result: data?.result ?? null };
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getUpstreamBlockNumber() {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  timeoutId.unref();

  try {
    const response = await fetch(getUpstreamUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_blockNumber",
        params: []
      }),
      signal: controller.signal
    });

    const data = await response.json().catch(() => null);
    if (!data?.result) return null;
    return Number(BigInt(data.result));
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function blockExistsOnChain(blockNumberHex) {
  const block = await getUpstreamBlock(blockNumberHex);
  if (block === null) return null;
  return Boolean(block.result);
}

async function getUpstreamTransaction(txHash) {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  timeoutId.unref();

  try {
    const response = await fetch(getUpstreamUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getTransactionByHash",
        params: [txHash]
      }),
      signal: controller.signal
    });

    const data = await response.json().catch(() => null);
    if (data === null) return null;
    return { ok: true, result: data?.result ?? null };
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getTraceReadyHeight() {
  const explicitHeight = process.env.TRACE_READY_HEIGHT;
  if (explicitHeight && /^\d+$/.test(explicitHeight)) {
    return Number(explicitHeight);
  }

  const lagValue = process.env.TRACE_READY_LAG;
  if (lagValue && /^\d+$/.test(lagValue)) {
    const head = await getUpstreamBlockNumber();
    if (head === null) return null;
    return Math.max(head - Number(lagValue), 0);
  }

  return null;
}

async function ensureTraceReady(blockNumber) {
  const readyHeight = await getTraceReadyHeight();
  if (readyHeight === null || readyHeight === undefined) return { ready: true };
  if (blockNumber <= readyHeight) return { ready: true };
  return { ready: false, readyHeight };
}

async function ensureTraceReadyByCounts(blockNumberParam) {
  const txRes = await pool.query(BLOCK_TX_COUNT_SQL, [blockNumberParam]);
  const txCount = Number(txRes.rows[0]?.tx_count ?? 0);
  if (txCount === 0) return { ready: true, reason: "empty_block" };

  const tracedRes = await pool.query(BLOCK_TRACED_TX_COUNT_SQL, [blockNumberParam]);
  const tracedCount = Number(tracedRes.rows[0]?.traced_tx_count ?? 0);
  if (tracedCount >= txCount) return { ready: true };
  return { ready: false, reason: "traces_pending" };
}

async function ensureTraceReadyForTransaction(txHashParam) {
  const res = await pool.query(
    "SELECT 1 FROM internal_transactions WHERE transaction_hash = $1 LIMIT 1;",
    [txHashParam]
  );
  return { ready: res.rowCount > 0 };
}

function traceNotReadyError(id, readyHeight, dataOverride) {
  const data = dataOverride ?? (readyHeight !== undefined ? { traceReadyHeight: readyHeight } : undefined);
  return jsonRpcError(id, -32010, "Trace data not ready", data);
}

async function ensureTraceReadyByCountsWithUpstream(blockNumberParam, blockNumberHex) {
  const readiness = await ensureTraceReadyByCounts(blockNumberParam);
  if (!readiness.ready) return readiness;

  if (readiness.reason === "empty_block") {
    const upstream = await getUpstreamBlock(blockNumberHex);
    if (upstream?.ok && upstream.result) {
      const upstreamTxCount = Array.isArray(upstream.result.transactions)
        ? upstream.result.transactions.length
        : 0;
      if (upstreamTxCount > 0) {
        return {
          ready: false,
          reason: "db_missing_transactions",
          upstreamTxCount
        };
      }
    }
  }

  return readiness;
}

async function checkTraceReadinessForBlock({ id, blockNumberParam, blockNumber }) {
  const mode = getTraceReadyMode();
  if (mode === "counts") {
    const blockNumberHex = `0x${BigInt(blockNumber).toString(16)}`;
    const readiness = await ensureTraceReadyByCountsWithUpstream(blockNumberParam, blockNumberHex);
    if (!readiness.ready) {
      if (traceReadyDebugEnabled()) {
        console.log(
          `[${new Date().toISOString()}] trace_ready counts not ready`,
          { blockNumber, ...readiness }
        );
      }
      return traceNotReadyError(id, undefined, readiness);
    }
    return null;
  }
  if (mode === "height") {
    const readiness = await ensureTraceReady(blockNumber);
    if (!readiness.ready) return traceNotReadyError(id, readiness.readyHeight);
  }
  return null;
}

function formatTraceRow(row) {
  const traceAddress = parseTraceAddress(row.trace_address);
  const rawCallType = row.call_type || "call";
  const callType = rawCallType === "create2" ? "create" : rawCallType;
  const isCreate = callType === "create";
  const actionType = isCreate ? "create" : "call";
  const fromAddress = normalizeAddress(row.from_address_hash);
  const toAddress = normalizeAddress(row.to_address_hash);
  const action = {
    callType,
    from: fromAddress,
    gas: normalizeHex(row.gas),
    value: normalizeHex(row.value)
  };

  if (isCreate) {
    action.init = normalizeBytes(row.input);
  } else {
    action.to = toAddress;
    action.input = normalizeBytes(row.input);
  }

  const response = {
    action,
    blockHash: normalizeHex(row.block_hash, { empty: "0x" }),
    blockNumber: Number(row.block_number),
    result: {
      gasUsed: normalizeHex(row.gas_used),
      output: normalizeBytes(row.output)
    },
    subtraces: 0,
    traceAddress,
    transactionHash: normalizeHex(row.transaction_hash, { empty: "0x" }),
    transactionPosition: row.transaction_position,
    type: actionType
  };

  if (isCreate && toAddress) {
    response.result.address = toAddress;
  }

  if (row.error) response.error = row.error;

  return response;
}

async function handleTraceBlock(payload) {
  const { id, params } = payload || {};

  if (!Array.isArray(params) || params.length === 0 || !isValidHexBlock(params[0])) {
    return jsonRpcError(id, -32602, "Invalid params: expected hex block number");
  }

  const blockNumberBigInt = BigInt(params[0]);
  const blockNumberParam = blockNumberBigInt.toString(10);
  const blockNumberHex = `0x${blockNumberBigInt.toString(16)}`;
  const blockNumber = Number(blockNumberBigInt);
  const QUERY_TIMEOUT_MS = Number(process.env.DB_QUERY_TIMEOUT_MS || 15000);

  try {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("trace_block timeout")), QUERY_TIMEOUT_MS);
      timeoutId.unref();
    });

    const { rows } = await Promise.race([
      (async () => {
        const sql = await getTraceSql({ byBlock: true });
        return pool.query(sql, [blockNumberParam]);
      })(),
      timeoutPromise
    ]);
    clearTimeout(timeoutId);

    if (rows.length === 0) {
      const exists = await pool.query(BLOCK_EXISTS_SQL, [blockNumberParam]);
      if (exists.rowCount === 0) {
        const blocksTable = await pool.query(BLOCKS_TABLE_EXISTS_SQL);
        if (blocksTable.rowCount > 0) {
          const blockExists = await pool.query(BLOCK_EXISTS_IN_BLOCKS_SQL, [blockNumberParam]);
          if (blockExists.rowCount > 0) {
            const notReady = await checkTraceReadinessForBlock({ id, blockNumberParam, blockNumber });
            if (notReady) return notReady;
            return { jsonrpc: "2.0", id, result: [] };
          }
          const upstreamExists = await blockExistsOnChain(blockNumberHex);
          if (upstreamExists === null || upstreamExists) {
            const notReady = await checkTraceReadinessForBlock({ id, blockNumberParam, blockNumber });
            if (notReady) return notReady;
            return { jsonrpc: "2.0", id, result: [] };
          }
          return jsonRpcError(id, -32001, "Block not found");
        }
        const upstreamExists = await blockExistsOnChain(blockNumberHex);
        if (upstreamExists === null || upstreamExists) {
          const notReady = await checkTraceReadinessForBlock({ id, blockNumberParam, blockNumber });
          if (notReady) return notReady;
          return { jsonrpc: "2.0", id, result: [] };
        }
        return jsonRpcError(id, -32001, "Block not found");
      }
      const notReady = await checkTraceReadinessForBlock({ id, blockNumberParam, blockNumber });
      if (notReady) return notReady;
      return { jsonrpc: "2.0", id, result: [] };
    }

    const result = rows.map((row) => formatTraceRow(row));

    return { jsonrpc: "2.0", id, result };
  } catch (err) {
    console.error(`[${new Date().toISOString()}] trace_block error`, err);
    return jsonRpcError(id, -32000, "trace_block query failed");
  }
}

async function handleTraceTransaction(payload) {
  const { id, params } = payload || {};

  if (!Array.isArray(params) || params.length === 0 || !isValidHexTx(params[0])) {
    return jsonRpcError(id, -32602, "Invalid params: expected transaction hash");
  }

  const txHash = params[0].toLowerCase();
  const isBytea = await getHashColumnIsBytea();
  const txHashParam = isBytea ? Buffer.from(txHash.slice(2), "hex") : txHash;
  const QUERY_TIMEOUT_MS = Number(process.env.DB_QUERY_TIMEOUT_MS || 15000);

  try {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("trace_transaction timeout")), QUERY_TIMEOUT_MS);
      timeoutId.unref();
    });

    const { rows } = await Promise.race([
      (async () => {
        const sql = await getTraceSql({ byBlock: false });
        return pool.query(sql, [txHashParam]);
      })(),
      timeoutPromise
    ]);
    clearTimeout(timeoutId);

    if (rows.length === 0) {
      const txRow = await pool.query(
        "SELECT block_number FROM transactions WHERE hash = $1 LIMIT 1;",
        [txHashParam]
      );
      const exists = txRow.rowCount > 0;
      if (!exists) {
        const upstream = await getUpstreamTransaction(txHash);
        if (upstream === null) {
          return { jsonrpc: "2.0", id, result: [] };
        }
        if (upstream.result === null) {
          return jsonRpcError(id, -32001, "Transaction not found");
        }
        if (getTraceReadyMode() === "counts" && upstream.result?.blockNumber) {
          return traceNotReadyError(id, undefined, { reason: "db_missing_transaction" });
        }
        if (upstream.result.blockNumber) {
          const blockNumber = Number(BigInt(upstream.result.blockNumber));
          const notReady = await checkTraceReadinessForBlock({
            id,
            blockNumberParam: blockNumber.toString(10),
            blockNumber
          });
          if (notReady) return notReady;
        }
        return { jsonrpc: "2.0", id, result: [] };
      }
      if (exists) {
        const blockNumber = Number(txRow.rows[0].block_number);
        const mode = getTraceReadyMode();
        if (mode === "counts") {
          const readyTx = await ensureTraceReadyForTransaction(txHashParam);
          if (!readyTx.ready) return traceNotReadyError(id);
        } else {
          const notReady = await checkTraceReadinessForBlock({
            id,
            blockNumberParam: blockNumber.toString(10),
            blockNumber
          });
          if (notReady) return notReady;
        }
      }
      return { jsonrpc: "2.0", id, result: [] };
    }

    const result = rows.map((row) => formatTraceRow(row));
    return { jsonrpc: "2.0", id, result };
  } catch (err) {
    console.error(`[${new Date().toISOString()}] trace_transaction error`, err);
    return jsonRpcError(id, -32000, "trace_transaction query failed");
  }
}

module.exports = {
  handleTraceBlock,
  handleTraceTransaction
};
