"use strict";

const blockHex = process.argv[2];
const rpcUrl = process.argv[3] || process.env.RPC_URL || "http://127.0.0.1:8545";

if (!blockHex || !/^0x[0-9a-fA-F]+$/.test(blockHex)) {
  console.error("Usage: node scripts/smoke-trace-empty.js <blockHex> [rpcUrl]");
  process.exit(1);
}

async function main() {
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "trace_block",
    params: [blockHex]
  };

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json();

  if (data.error) {
    console.error("RPC error", data.error);
    process.exit(2);
  }

  if (!Array.isArray(data.result)) {
    console.error("Unexpected result shape", data.result);
    process.exit(3);
  }

  if (data.result.length !== 0) {
    console.error("Expected empty trace list, got", data.result.length);
    process.exit(4);
  }

  console.log("OK: empty trace list for", blockHex);
}

main().catch((err) => {
  console.error(err);
  process.exit(5);
});
