/** Node's built-in http server, used as the performance baseline. */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';
const STATIC_DIR = path.join(ROOT, 'public');

const html = `<!doctype html><html><head><title>Raw HTTP Server</title></head><body><h1>Raw HTTP Server</h1></body></html>`;
const indexHtml = fs.readFileSync(path.join(STATIC_DIR, 'index.html'));

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/' || url.pathname === '/health') {
    const body = url.pathname === '/' ? html : JSON.stringify({ status: 'ok' });
    res.writeHead(200, {
      'Content-Type': url.pathname === '/' ? 'text/html' : 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    return res.end(body);
  }
  if (url.pathname === '/json') {
    const body = JSON.stringify({
      message: 'Hello from a hand-written HTTP parser',
      timestamp: new Date().toISOString(),
      pid: process.pid,
    });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    return res.end(body);
  }
  if (url.pathname === '/static/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': indexHtml.length });
    return res.end(indexHtml);
  }
  res.writeHead(404, { 'Content-Length': 0 });
  res.end();
});

server.listen(PORT, HOST, () => console.log(`[baseline] listening on ${HOST}:${PORT}`));
