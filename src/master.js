/**
 * Cluster primary. Forks one worker per CPU, respawns on crash, and drives
 * graceful shutdown across the whole cluster.
 */

import cluster from 'node:cluster';
import { config } from './config.js';

const workers = Math.max(1, config.workers);
let shuttingDown = false;

if (cluster.isPrimary) {
  for (let i = 0; i < workers; i++) cluster.fork();

  cluster.on('exit', (worker, code, signal) => {
    if (shuttingDown) return;
    console.error(`[master] worker ${worker.process.pid} exited (${signal || code}); respawning`);
    cluster.fork();
  });

  console.log(`[master] ${workers} workers started`);

  let shutdownTimer;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[master] ${signal} received; shutting down ${workers} workers`);
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
