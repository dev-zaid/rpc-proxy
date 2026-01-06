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

## Smoke Check (empty traces)
Pick a recent block that you know has no internal transactions and run:
```bash
npm run smoke:trace-empty -- 0x<blockNumberHex>
```

## Troubleshooting
- `Block not found`: the block is not present on-chain (confirmed via upstream RPC).
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
```
