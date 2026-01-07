# RPC Proxy (Parity trace_block via Blockscout)

Production-ready JSON-RPC proxy that serves Parity-style `trace_block` from a Blockscout PostgreSQL database and forwards all other methods to an upstream Evmos node.

## Features
- `trace_block` served from Blockscout Postgres
- `trace_transaction` served from Blockscout Postgres (for TXS reindex paths)
- All other JSON-RPC methods proxied to Evmos
- Connection pooling, timeouts, request logging
- Health check endpoint
- Graceful shutdown
- Docker support

## Setup (Local)
1. Install dependencies:
   ```bash
   npm install
   ```
2. Create environment file:
   ```bash
   cp .env.example .env
   ```
3. Edit `.env` with your DB credentials.
4. Start the server:
   ```bash
   npm start
   ```

The server listens on `PORT` (default `8545`).

## Docker
```bash
docker compose up --build
```

## Environment Variables
See `.env.example` for the full list. Key values:
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- `EVMOS_RPC_URL` (default `http://18.60.158.87:8545`)
- `PORT` (default `8545`)
- `TRACE_READY_HEIGHT`, `TRACE_READY_LAG`, `TRACE_READY_MODE`, `TRACE_READY_DEBUG` (optional readiness guard)

## Health Check
```bash
curl http://localhost:8545/health
```

## Testing with curl
### 1) trace_block
```bash
curl -s http://localhost:8545 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"trace_block","params":["0x1a4"]}'
```

### 1b) trace_transaction
```bash
curl -s http://localhost:8545 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"trace_transaction","params":["0x<txhash>"]}'
```

### 2) eth_blockNumber (proxied)
```bash
curl -s http://localhost:8545 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"eth_blockNumber","params":[]}'
```

### 3) health check
```bash
curl -s http://localhost:8545/health
```

## TXS Semantics
- `trace_block` returns `[]` for blocks with no traces (HTTP 200). It only returns `Block not found` if the block does not exist on-chain; if upstream reachability is unknown, it returns `[]` to avoid halting TXS.
- `trace_transaction` mirrors the same behavior: returns `[]` when a transaction exists but has no traces.
- Call types are normalized to Parity format; `create2` is emitted as `create`. If the `internal_transactions.call_type` column exists, it is preferred for `delegatecall`/`staticcall` detection.
- Optional trace readiness guard: if a block exists but traces are not ready, `trace_block` returns a JSON-RPC error (`Trace data not ready`, code `-32010`) so TXS retries instead of advancing.

## Smoke Check (empty traces)
Pick a recent block that you know has no internal transactions and run:
```bash
npm run smoke:trace-empty -- 0x<blockNumberHex>
```

## Smoke Check (trace readiness guard)
```bash
npm run smoke:trace-guard -- 0x<blockNumberHex> error
npm run smoke:trace-guard -- 0x<blockNumberHex> empty
npm run smoke:trace-guard -- 0x<blockNumberHex> nonempty
```

## Troubleshooting
- `Block not found`: the block is not present on-chain (confirmed via upstream RPC).
- `Trace data not ready`: trace indexing is lagging; TXS should retry the block.
- Empty trace result: the block exists but has no internal transactions.
- Upstream timeout: increase `REQUEST_TIMEOUT_MS`.
- DB timeout: increase `DB_QUERY_TIMEOUT_MS` or check indexing on `transactions.block_number`.

## Notes
- `trace_block` values are formatted as Parity-compatible hex strings.
- Input/output bytea fields are returned as `0x`-prefixed hex.

## Suggested DB Indexes
If not already present, these indexes help trace lookups and ordering:
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_block_number ON transactions (block_number);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_internal_transactions_tx_hash ON internal_transactions (transaction_hash);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_internal_transactions_tx_hash_index ON internal_transactions (transaction_hash, index);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_transactions_block_number_hash ON transactions (block_number, hash);
```

## Trace Readiness Guard (optional)
To avoid TXS skipping recent blocks, you can enable a readiness guard that returns an error when traces are not yet available.

Order of precedence:
1) `TRACE_READY_HEIGHT` (explicit block height)
2) `TRACE_READY_LAG` (derived from upstream head minus lag)

The guard treats blocks above the ready height as not ready and returns a JSON-RPC error.

### Alternative (per-block counts)
If your `blocks` table has no trace readiness column, set:
```
TRACE_READY_MODE=counts
```
This checks per block whether all transactions in the block have at least one entry in `internal_transactions`. It returns `Trace data not ready` if some txs are missing traces, and returns `[]` for genuinely empty blocks. It assumes Blockscout stores a top-level trace per transaction.
Set `TRACE_READY_DEBUG=true` to log readiness decisions.
