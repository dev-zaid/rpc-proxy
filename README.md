# RPC Proxy (Parity trace_block via Blockscout)

Production-ready JSON-RPC proxy that serves Parity-style `trace_block` from a Blockscout PostgreSQL database and forwards all other methods to an upstream Evmos node.

## Features
- `trace_block` served from Blockscout Postgres
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

## Troubleshooting
- `Block not found`: the block number was not found in the `transactions` table.
- Empty trace result: the block exists but has no internal transactions.
- Upstream timeout: increase `REQUEST_TIMEOUT_MS`.
- DB timeout: increase `DB_QUERY_TIMEOUT_MS` or check indexing on `transactions.block_number`.

## Notes
- `trace_block` values are formatted as Parity-compatible hex strings.
- Input/output bytea fields are returned as `0x`-prefixed hex.
