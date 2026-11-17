# Raw HTTP Server

An HTTP/1.1 server implemented **from scratch on raw TCP sockets** in Node.js — no
web framework, no `node:http` on the data plane. It includes a hand-written request
parser, keep-alive and pipelining, backpressure-aware response writing, static file
serving, multi-core clustering, metrics, and a benchmark harness that compares it
against Node's built-in `http` module.

> Scaffold in progress — implementation milestones are being filled in. See `plan.md`.

## Quick start

```bash
npm install
npm start                 # multi-core cluster on :3000, admin metrics on :9090
curl http://localhost:3000/
curl http://localhost:3000/json
curl http://localhost:9090/metrics
```

## Scripts

| Script | Description |
| --- | --- |
| `npm start` | Start the clustered server (primary + N workers). |
| `npm run start:worker` | Start a single worker directly (no cluster). |
| `npm test` | Run unit + integration tests with the built-in test runner. |
| `npm run bench` | Run the autocannon benchmark harness. |

## Configuration

All settings have sensible defaults and can be overridden with environment variables
(see `src/config.js`): `PORT`, `HOST`, `WORKERS`, `ADMIN_PORT`, `MAX_HEADER_SIZE`,
`MAX_BODY_SIZE`, `KEEP_ALIVE_TIMEOUT`, `STATIC_DIR`, and more.

## License

MIT
