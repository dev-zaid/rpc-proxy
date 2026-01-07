"use strict";

const blockHex = process.argv[2];
const expected = process.argv[3];
const rpcUrl = process.argv[4] || process.env.RPC_URL || "http://127.0.0.1:8545";

if (!blockHex || !/^0x[0-9a-fA-F]+$/.test(blockHex)) {
  console.error("Usage: node scripts/smoke-trace-guard.js <blockHex> <error|empty|nonempty> [rpcUrl]");
  process.exit(1);
}

if (!expected || !["error", "empty", "nonempty"].includes(expected)) {
  console.error("Expected must be one of: error, empty, nonempty");
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

  if (expected === "error") {
    if (!data.error) {
      console.error("Expected error, got", data.result);
      process.exit(2);
    }
    console.log("OK: error response", data.error.message);
    return;
  }

  if (data.error) {
    console.error("Unexpected error", data.error);
    process.exit(3);
  }

  if (!Array.isArray(data.result)) {
    console.error("Unexpected result shape", data.result);
    process.exit(4);
  }

  if (expected === "empty" && data.result.length === 0) {
    console.log("OK: empty trace list for", blockHex);
    return;
  }

  if (expected === "nonempty" && data.result.length > 0) {
    console.log("OK: nonempty trace list for", blockHex);
    return;
  }

  console.error("Unexpected trace list length", data.result.length);
  process.exit(5);
}

main().catch((err) => {
  console.error(err);
  process.exit(6);
});
