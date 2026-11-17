/**
 * Per-worker TCP server. Accepts connections on the shared port, parses
 * requests, dispatches them through the router and serializes responses so
 * pipelined requests are written in order.
 */

import net from 'node:net';
import { Parser } from './parser.js';
import { writeResponse } from './response.js';
import { errorResponse } from './errors.js';
import { createRouter } from './router.js';
import { Metrics } from './metrics.js';
import { config } from './config.js';

const startedAt = Date.now();
const metrics = new Metrics();
const router = createRouter({
  config,
  startTime: startedAt,
  getMetrics: () => metrics.toPrometheus(),
});

let shuttingDown = false;

class Connection {
  constructor(socket) {
    this.socket = socket;
    // Avoid the Nagle + delayed-ACK interaction: response head and body are
    // separate writes for streamed responses, and coalescing them otherwise
    // adds ~40ms of latency per response.
    socket.setNoDelay(true);
    this.parser = new Parser({
      maxBufferSize: config.maxBufferSize,
      maxHeaderSize: config.maxHeaderSize,
      maxHeaderCount: config.maxHeaderCount,
      maxBodySize: config.maxBodySize,
      maxRequestLineSize: config.maxRequestLineSize,
    });
    this.queue = Promise.resolve();
    this.requestCount = 0;
    this.closeAfter = false;

    // Start with the stricter header timeout; relax it once a full request
    // has arrived so idle keep-alive sockets do not look like slowloris.
    socket.setTimeout(config.headerTimeout);
    socket.on('timeout', () => socket.destroy());
    socket.on('error', () => {}); // close/end handle cleanup
    socket.on('close', () => { this.closed = true; });
    socket.on('data', (chunk) => this.onData(chunk));
  }

  onData(chunk) {
    if (this.closed || this.socket.destroyed) return;

    const results = this.parser.feed(chunk);
    for (const result of results) {
      if (!result.ok) {
        this.closeAfter = true;
        this.enqueueError(result);
        break;
      }

      this.requestCount += 1;
      const keepAlive = result.request.keepAlive
        && this.requestCount < config.maxRequestsPerConnection
        && !this.closeAfter;

      if (!keepAlive) this.closeAfter = true;
      this.enqueue(result.request, keepAlive);
    }
  }

  enqueue(req, keepAlive) {
    this.queue = this.queue
      .then(() => this.process(req, keepAlive))
      .catch((err) => {
        console.error('[worker] request processing failed:', err);
        this.socket.destroy();
      });
  }

  enqueueError(result) {
    this.queue = this.queue
      .then(() => this.processError(result))
      .catch((err) => {
        console.error('[worker] error response failed:', err);
        this.socket.destroy();
      });
  }

  async process(req, keepAlive) {
    if (this.socket.destroyed) return;

    const start = process.hrtime.bigint();
    const response = await router(req);

    try {
      await writeResponse(this.socket, {
        ...response,
        method: req.method,
        keepAlive,
      });
    } catch (err) {
      console.error('[worker] write failed:', err);
      this.socket.destroy();
      return;
    }

    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const bodyBytes = Buffer.isBuffer(response.body)
      ? response.body.length
      : Buffer.byteLength(response.body || '');
    metrics.record({
      method: req.method,
      status: response.status,
      durationMs,
      bytes: response.contentLength ?? bodyBytes,
    });

    if (this.socket.destroyed) return;
    this.socket.setTimeout(config.keepAliveTimeout);
    if (!keepAlive) this.socket.end();
  }

  async processError(result) {
    if (this.socket.destroyed) return;
    const response = errorResponse(result.status, result.message);
    try {
      await writeResponse(this.socket, { ...response, method: 'GET', keepAlive: false });
    } catch {
      this.socket.destroy();
      return;
    }
    metrics.record({ method: 'ERROR', status: result.status, durationMs: 0, bytes: 0 });
    this.socket.end();
  }
}

const server = net.createServer({ allowHalfOpen: false }, (socket) => new Connection(socket));

server.on('error', (err) => {
  console.error('[worker] server error:', err);
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  console.log(`[worker ${process.pid}] listening on ${config.host}:${config.port}`);
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker ${process.pid}] shutting down`);
  server.close(() => process.exit(0));
  server.closeIdleConnections?.();
  const force = setTimeout(() => process.exit(0), config.shutdownTimeout);
  force.unref();
}

if (process.send) {
  const timer = setInterval(() => {
    process.send({ type: 'metrics', payload: metrics.snapshot() });
  }, config.metricsInterval);
  timer.unref();
  process.on('message', (msg) => {
    if (msg && msg.type === 'shutdown') {
      clearInterval(timer);
      shutdown();
    }
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
