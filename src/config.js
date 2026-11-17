import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function int(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export const config = Object.freeze({
  // Network
  host: process.env.HOST || '0.0.0.0',
  port: int('PORT', 3000),
  adminHost: process.env.ADMIN_HOST || '0.0.0.0',
  adminPort: int('ADMIN_PORT', 9090),

  // Concurrency
  workers: int('WORKERS', os.availableParallelism?.() || os.cpus().length),

  // Resource limits (per connection / per request)
  maxBufferSize: int('MAX_BUFFER_SIZE', 2 * 1024 * 1024), // 2 MiB total buffered
  maxHeaderSize: int('MAX_HEADER_SIZE', 16 * 1024), // 16 KiB request head
  maxHeaderCount: int('MAX_HEADER_COUNT', 100),
  maxBodySize: int('MAX_BODY_SIZE', 1 * 1024 * 1024), // 1 MiB request body
  maxRequestLineSize: int('MAX_REQUEST_LINE', 8 * 1024),
  maxRequestsPerConnection: int('MAX_REQUESTS_PER_CONNECTION', 1000),

  // Timeouts (ms)
  headerTimeout: int('HEADER_TIMEOUT', 30_000), // slowloris protection
  keepAliveTimeout: int('KEEP_ALIVE_TIMEOUT', 5_000),
  shutdownTimeout: int('SHUTDOWN_TIMEOUT', 10_000),

  // Static files
  staticDir: path.resolve(process.env.STATIC_DIR || path.join(ROOT, 'public')),

  // Metrics
  metricsInterval: int('METRICS_INTERVAL', 1000),
});
