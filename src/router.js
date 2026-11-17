import os from 'node:os';
import { serveStatic } from './static.js';
import { errorResponse } from './errors.js';

const HTML_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Raw HTTP Server</title>
<style>body{font:16px system-ui,sans-serif;max-width:46rem;margin:4rem auto;padding:0 1rem;color:#222}
code{background:#eee;padding:.1rem .3rem;border-radius:3px}a{color:#06c}</style></head>
<body>
<h1>Raw HTTP Server</h1>
<p>Running on raw TCP sockets &mdash; no framework, no <code>node:http</code> on the data plane.</p>
<ul>
  <li><a href="/json">/json</a> &mdash; JSON response</li>
  <li><a href="/health">/health</a> &mdash; health check</li>
  <li><a href="/echo">/echo</a> &mdash; echo request metadata</li>
  <li><a href="/static/index.html">/static/index.html</a> &mdash; streamed static file</li>
  <li><a href="/metrics">/metrics</a> &mdash; this worker's metrics</li>
</ul>
</body></html>`;

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };
const htmlHeaders = { 'Content-Type': 'text/html; charset=utf-8' };

function json(body, status = 200) {
  return { status, headers: jsonHeaders, body: JSON.stringify(body) };
}

/**
 * Create a route dispatcher.
 * @param {object} deps
 * @param {object} deps.config
 * @param {() => string} [deps.getMetrics] returns Prometheus text for /metrics
 * @param {number} [deps.startTime] process start time for uptime
 */
export function createRouter({ config, getMetrics, startTime = Date.now() } = {}) {
  const routes = new Map();

  const add = (path, methods, handler) => routes.set(path, { methods, handler });

  add('/', ['GET', 'HEAD'], () => ({ status: 200, headers: htmlHeaders, body: HTML_PAGE }));

  add('/json', ['GET', 'HEAD'], () => json({
    message: 'Hello from a hand-written HTTP parser',
    timestamp: new Date().toISOString(),
    pid: process.pid,
  }));

  add('/health', ['GET', 'HEAD'], () => json({
    status: 'ok',
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    pid: process.pid,
    worker: process.env.NODE_APP_INSTANCE || null,
  }));

  add('/echo', ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], (req) => json({
    method: req.method,
    path: req.path,
    query: req.query,
    headers: req.headers,
    body: req.body.length > 0 ? req.body.toString('utf8') : '',
  }));

  add('/metrics', ['GET', 'HEAD'], () => ({
    status: 200,
    headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
    body: getMetrics ? getMetrics() : '',
  }));

  return async function route(req) {
    const { path, method } = req;

    if (path === '/static' || path.startsWith('/static/')) {
      if (method !== 'GET' && method !== 'HEAD') {
        return { ...errorResponse(405, 'Method Not Allowed'), headers: { Allow: 'GET, HEAD' } };
      }
      return serveStatic(path, config.staticDir);
    }

    const entry = routes.get(path);
    if (!entry) return errorResponse(404, `No route for ${path}`);

    const effective = method === 'HEAD' && entry.methods.includes('GET') ? 'GET' : method;
    if (!entry.methods.includes(effective)) {
      return {
        ...errorResponse(405, 'Method Not Allowed'),
        headers: { Allow: entry.methods.join(', ') },
      };
    }

    try {
      return await entry.handler(req);
    } catch (err) {
      console.error('[router] handler error:', err);
      return errorResponse(500, 'Internal Server Error');
    }
  };
}
