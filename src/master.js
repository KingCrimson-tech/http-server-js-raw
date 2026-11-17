/**
 * Cluster primary. Forks one worker per CPU, respawns on crash, aggregates
 * per-worker metrics over IPC, exposes them on a dedicated admin port and
 * drives graceful shutdown across the whole cluster.
 */

import cluster from 'node:cluster';
import http from 'node:http';
import os from 'node:os';
import { config } from './config.js';

const workers = Math.max(1, config.workers);
const workerMetrics = new Map();
let shuttingDown = false;

if (cluster.isPrimary) {
  for (let i = 0; i < workers; i++) cluster.fork();

  cluster.on('exit', (worker, code, signal) => {
    if (shuttingDown) return;
    console.error(`[master] worker ${worker.process.pid} exited (${signal || code}); respawning`);
    workerMetrics.delete(worker.id);
    cluster.fork();
  });

  cluster.on('message', (_worker, msg) => {
    if (msg && msg.type === 'metrics') workerMetrics.set(_worker.id, msg.payload);
  });

  const adminServer = http.createServer((req, res) => {
    const path = (req.url || '/').split('?')[0];
    if (path !== '/metrics' && path !== '/') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not Found\n');
    }

    const lines = [
      '# HELP raw_http_cluster_workers Number of live workers.',
      '# TYPE raw_http_cluster_workers gauge',
      `raw_http_cluster_workers ${Object.keys(cluster.workers).length}`,
    ];
    const aggregated = {
      requests: 0, responses: 0, bytes: 0, errors: 0,
      latencyBuckets: new Array(10).fill(0), latencySum: 0,
    };
    const byStatus = new Map();
    const byMethod = new Map();

    for (const m of workerMetrics.values()) {
      aggregated.requests += m.requests || 0;
      aggregated.responses += m.responses || 0;
      aggregated.bytes += m.bytes || 0;
      aggregated.errors += m.errors || 0;
      aggregated.latencySum += m.latencySum || 0;
      (m.latencyBuckets || []).forEach((v, i) => { aggregated.latencyBuckets[i] += v; });
      for (const [k, v] of Object.entries(m.byStatus || {})) byStatus.set(k, (byStatus.get(k) || 0) + v);
      for (const [k, v] of Object.entries(m.byMethod || {})) byMethod.set(k, (byMethod.get(k) || 0) + v);
    }

    lines.push(
      '# HELP raw_http_cluster_requests_total Aggregated requests across all workers.',
      '# TYPE raw_http_cluster_requests_total counter',
      `raw_http_cluster_requests_total ${aggregated.requests}`,
      '# HELP raw_http_cluster_bytes_total Aggregated response bytes across all workers.',
      '# TYPE raw_http_cluster_bytes_total counter',
      `raw_http_cluster_bytes_total ${aggregated.bytes}`,
      '# HELP raw_http_cluster_request_duration_ms Aggregated latency histogram.',
      '# TYPE raw_http_cluster_request_duration_ms histogram',
    );
    const bounds = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];
    aggregated.latencyBuckets.forEach((v, i) => {
      lines.push(`raw_http_cluster_request_duration_ms_bucket{le="${bounds[i]}"} ${v}`);
    });
    lines.push(`raw_http_cluster_request_duration_ms_bucket{le="+Inf"} ${aggregated.requests}`);
    lines.push(`raw_http_cluster_request_duration_ms_sum ${aggregated.latencySum.toFixed(3)}`);
    for (const [code, count] of byStatus) {
      lines.push(`raw_http_cluster_responses_by_status{code="${code}"} ${count}`);
    }
    for (const [method, count] of byMethod) {
      lines.push(`raw_http_cluster_requests_by_method{method="${method}"} ${count}`);
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
    res.end(lines.join('\n') + '\n');
  });

  adminServer.listen(config.adminPort, config.adminHost, () => {
    console.log(`[master] ${workers} workers; admin metrics on ${config.adminHost}:${config.adminPort}`);
  });

  let shutdownTimer;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[master] ${signal} received; shutting down ${workers} workers`);
    adminServer.close();
    for (const worker of Object.values(cluster.workers)) {
      worker?.send?.({ type: 'shutdown' });
      // Fall back to SIGTERM if a worker is wedged.
      setTimeout(() => {
        if (!worker.isDead()) worker.process.kill('SIGTERM');
      }, config.shutdownTimeout).unref();
    }
    if (shutdownTimer) clearTimeout(shutdownTimer);
    shutdownTimer = setTimeout(() => process.exit(0), config.shutdownTimeout + 500);
    shutdownTimer.unref();
    cluster.on('exit', () => {
      if (Object.keys(cluster.workers).length === 0) process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
} else {
  // Workers simply run the shared worker module (cluster handles the socket).
  import('./worker.js');
}
