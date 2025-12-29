"use strict";

const pool = require("../db/pool");
const {
  normalizeHex,
  normalizeAddress,
  normalizeBytes,
  parseTraceAddress,
  jsonRpcError
} = require("../utils/formatters");

const TRACE_BLOCK_SQL = `
SELECT 
  t.hash as transaction_hash,
  t.block_hash,
  t.block_number,
  t.index as transaction_position,
  it.type as call_type,
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

function isValidHexBlock(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
}

async function handleTraceBlock(payload) {
  const { id, params } = payload || {};

  if (!Array.isArray(params) || params.length === 0 || !isValidHexBlock(params[0])) {
    return jsonRpcError(id, -32602, "Invalid params: expected hex block number");
  }

  const blockNumberBigInt = BigInt(params[0]);
  const blockNumberParam = blockNumberBigInt.toString(10);
  const QUERY_TIMEOUT_MS = Number(process.env.DB_QUERY_TIMEOUT_MS || 15000);

  try {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("trace_block timeout")), QUERY_TIMEOUT_MS);
      timeoutId.unref();
    });

    const { rows } = await Promise.race([
      pool.query(TRACE_BLOCK_SQL, [blockNumberParam]),
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
            return { jsonrpc: "2.0", id, result: [] };
          }
        }
        return jsonRpcError(id, -32001, "Block not found");
      }
      return { jsonrpc: "2.0", id, result: [] };
    }

    const result = rows.map((row) => {
      const traceAddress = parseTraceAddress(row.trace_address);
      const callType = row.call_type || "call";
      const isCreate = callType === "create" || callType === "create2";
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
        type: callType
      };

      if (isCreate && toAddress) {
        response.result.address = toAddress;
      }

      if (row.error) response.error = row.error;

      return response;
    });

    return { jsonrpc: "2.0", id, result };
  } catch (err) {
    console.error(`[${new Date().toISOString()}] trace_block error`, err);
    return jsonRpcError(id, -32000, "trace_block query failed");
  }
}

module.exports = {
  handleTraceBlock
};
