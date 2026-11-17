# Raw HTTP Server

An HTTP/1.1 server built from scratch on raw TCP sockets in Node.js — no framework, no `node:http` on the data plane. Scaled across CPU cores with `cluster`, with a hand-written parser and static file serving.

## Quick start

```bash
npm install
npm start
curl http://localhost:3000/
```

Listens on `:3000`.

## Scripts

- `npm start` — start the clustered server
- `npm test` — run tests
- `npm run bench` — run benchmarks
