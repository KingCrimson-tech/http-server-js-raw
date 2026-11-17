/**
 * Benchmark harness: compares the from-scratch server against Node's built-in
 * http module with autocannon across a concurrency ramp.
 *
 * Both servers run single-process for an apples-to-apples comparison. Use
 * RUN_WORKERS>1 to benchmark the clustered raw server instead.
 *
 * Environment overrides:
 *   DURATION_MS   per-run duration (default 15000)
 *   WARMUP_MS     warm-up duration (default 3000)
 *   CONNECTIONS   comma-separated concurrency levels (default 10,50,100,200,500)
 *   REPS          repetitions per level, median is recorded (default 3)
 *   ROUTES        comma-separated routes (default /json,/static/index.html)
 *   WORKERS       cluster worker count for the raw server (default 1)
 *   NODE_BIN      node executable (default process.execPath)
 */

import autocannon from 'autocannon';
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE_BIN = process.env.NODE_BIN || process.execPath;
const DURATION = int('DURATION_MS', 15_000);
const WARMUP = int('WARMUP_MS', 3_000);
const CONNECTIONS = (process.env.CONNECTIONS || '10,50,100,200,500').split(',').map(Number);
const REPS = int('REPS', 3);
const ROUTES = (process.env.ROUTES || '/json,/static/index.html').split(',');
const WORKERS = int('WORKERS', 1);
const RESULTS_DIR = path.join(ROOT, 'results');

function int(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function waitForPort(port, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const attempt = () => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); resolve(); });
      s.once('error', () => {
        s.destroy();
        if (Date.now() - start > timeout) reject(new Error('server did not start'));
        else setTimeout(attempt, 25);
      });
    };
    attempt();
  });
}

function startServer(kind) {
  const portPromise = freePort();
  return portPromise.then((port) => {
    const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1' };
    const args = kind === 'raw'
      ? ['src/master.js']
      : ['bench/baseline-http.js'];
    if (kind === 'raw') env.WORKERS = String(WORKERS);
    const child = spawn(NODE_BIN, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    return waitForPort(port)
      .then(() => ({ child, port, stderr: () => stderr }))
      .catch((err) => { child.kill(); throw new Error(`${kind} failed: ${err.message}\n${stderr}`); });
  });
}

function stopServer(server) {
  if (server && !server.child.killed) server.child.kill('SIGTERM');
  return new Promise((resolve) => setTimeout(resolve, 250));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function measure(port, route, connections) {
  const result = await autocannon({
    url: `http://127.0.0.1:${port}${route}`,
    connections,
    duration: DURATION / 1000,
    warmup: WARMUP / 1000,
    pipelining: 1,
    timeout: 10,
  });
  return {
    throughput: result.requests.average,
    p50: result.latency.p50,
    p99: result.latency.p99,
    max: result.latency.max,
    avg: result.latency.average,
    errors: result.errors,
    non2xx: result.non2xx,
    timeouts: result.timeouts,
  };
}

function summarize(reps) {
  return {
    throughput: Math.round(median(reps.map((r) => r.throughput))),
    p50: median(reps.map((r) => r.p50)),
    p99: median(reps.map((r) => r.p99)),
    max: Math.round(median(reps.map((r) => r.max))),
    avg: median(reps.map((r) => r.avg)),
    errors: Math.round(median(reps.map((r) => r.errors))),
    non2xx: Math.round(median(reps.map((r) => r.non2xx))),
    timeouts: Math.round(median(reps.map((r) => r.timeouts))),
  };
}

function markdownTable(results) {
  const lines = [
    '| Server | Route | Connections | Req/s (median) | Avg ms | p50 ms | p99 ms | Max ms | Errors | Non-2xx |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const row of results) {
    lines.push(`| ${row.server} | \`${row.route}\` | ${row.connections} | ${row.m.throughput.toLocaleString()} | ${row.m.avg.toFixed(2)} | ${row.m.p50.toFixed(2)} | ${row.m.p99.toFixed(2)} | ${row.m.max} | ${row.m.errors} | ${row.m.non2xx} |`);
  }
  return lines.join('\n');
}

async function main() {
  console.log('Starting servers…');
  const raw = await startServer('raw');
  const baseline = await startServer('baseline');
  const results = [];

  try {
    for (const route of ROUTES) {
      for (const connections of CONNECTIONS) {
        for (const [name, server] of [['from-scratch', raw], ['node:http', baseline]]) {
          const reps = [];
          for (let i = 0; i < REPS; i++) {
            process.stdout.write(`  ${name} ${route} c=${connections} rep ${i + 1}/${REPS}… `);
            const r = await measure(server.port, route, connections);
            reps.push(r);
            console.log(`${r.throughput.toFixed(0)} req/s`);
          }
          results.push({ server: name, route, connections, m: summarize(reps) });
        }
      }
    }
  } finally {
    await Promise.all([stopServer(raw), stopServer(baseline)]);
  }

  const system = [
    `Date: ${new Date().toISOString()}`,
    `Node: ${process.version}`,
    `CPU: ${os.cpus()[0]?.model || 'unknown'} (${os.cpus().length} logical cores)`,
    `RAM: ${(os.totalmem() / 1024 ** 3).toFixed(1)} GiB`,
    `OS: ${os.platform()} ${os.release()}`,
    `Duration: ${DURATION / 1000}s/run, ${WARMUP / 1000}s warm-up, ${REPS} reps (median)`,
    `Raw server workers: ${WORKERS}`,
  ].join('\n');

  const table = markdownTable(results);
  const report = `# Benchmark Results\n\n## System\n\n\`\`\`\n${system}\n\`\`\`\n\n## Results\n\n${table}\n\n## Notes\n\n- Both servers are single-process by default for a fair comparison.\n- Routes: \`/json\` (no disk I/O) and \`/static/index.html\` (streamed from disk).\n- \`req/s\` is requests per second; latency values are in milliseconds.\n- Error rate is reported as absolute counts of client/network errors and non-2xx responses.\n`;

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, 'benchmark.md'), report);
  fs.writeFileSync(path.join(RESULTS_DIR, 'benchmark.json'), JSON.stringify({ system, results }, null, 2));
  console.log('\n' + table);
  console.log(`\nWrote ${path.join(RESULTS_DIR, 'benchmark.md')}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
