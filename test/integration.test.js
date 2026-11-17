import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

function waitForPort(port, timeout = 5000) {
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

let child;
let port;
let stderr = '';

before(async () => {
  port = await freePort();
  child = spawn(process.execPath, ['src/worker.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  await waitForPort(port);
});

after(() => {
  if (child && !child.killed) child.kill('SIGTERM');
});

function send(raw, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(raw));
    let data = Buffer.alloc(0);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('client timeout. worker stderr: ' + stderr));
    }, timeout);
    socket.on('data', (c) => { data = Buffer.concat([data, c]); });
    socket.on('error', reject);
    socket.on('close', () => { clearTimeout(timer); resolve(data.toString('latin1')); });
  });
}

function raw(method, target, headers = {}, body = '', close = true) {
  const lines = [`${method} ${target} HTTP/1.1`, 'Host: localhost'];
  if (close) lines.push('Connection: close');
  for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
  return Buffer.from(lines.join('\r\n') + '\r\n\r\n' + body, 'latin1');
}

function splitResponses(text) {
  const responses = [];
  let rest = text;
  while (rest.startsWith('HTTP/1.1')) {
    const sep = rest.indexOf('\r\n\r\n');
    if (sep === -1) break;
    const head = rest.slice(0, sep);
    const lines = head.split('\r\n');
    const status = Number(lines[0].split(' ')[1]);
    const headers = {};
    let length = 0;
    for (const line of lines.slice(1)) {
      const i = line.indexOf(':');
      const name = line.slice(0, i).toLowerCase();
      const value = line.slice(i + 1).trim();
      headers[name] = value;
      if (name === 'content-length') length = Number(value);
    }
    const body = rest.slice(sep + 4, sep + 4 + length);
    rest = rest.slice(sep + 4 + length);
    responses.push({ status, headers, body });
  }
  return responses;
}

test('GET / returns the HTML page', async () => {
  const [res] = splitResponses(await send(raw('GET', '/')));
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /Raw HTTP Server/);
  assert.equal(Number(res.headers['content-length']), Buffer.byteLength(res.body));
});

test('GET /json returns valid JSON', async () => {
  const [res] = splitResponses(await send(raw('GET', '/json')));
  assert.equal(res.status, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.message, 'Hello from a hand-written HTTP parser');
  assert.ok(data.timestamp);
});

test('GET /health reports ok', async () => {
  const [res] = splitResponses(await send(raw('GET', '/health')));
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).status, 'ok');
});

test('GET /static/index.html streams a file with correct Content-Length', async () => {
  const [res] = splitResponses(await send(raw('GET', '/static/index.html')));
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /Served from disk/);
  // The client decodes bytes as latin1, so string length === byte length.
  assert.equal(Number(res.headers['content-length']), res.body.length);
});

test('path traversal is rejected', async () => {
  const [res] = splitResponses(await send(raw('GET', '/static/../package.json')));
  assert.equal(res.status, 403);
});

test('POST /echo returns request metadata and body', async () => {
  const body = 'hello=world';
  const [res] = splitResponses(await send(raw(
    'POST',
    '/echo?a=1',
    { 'Content-Type': 'text/plain', 'Content-Length': String(body.length) },
    body,
  )));
  assert.equal(res.status, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.method, 'POST');
  assert.equal(data.query, 'a=1');
  assert.equal(data.body, body);
  assert.equal(data.headers['content-type'], 'text/plain');
});

test('pipelined requests are answered in order', async () => {
  const combined = Buffer.concat([
    raw('GET', '/json', {}, '', false), // keep-alive
    raw('GET', '/health'), // close
  ]);
  const responses = splitResponses(await send(combined));
  assert.equal(responses.length, 2);
  assert.equal(responses[0].status, 200);
  assert.equal(JSON.parse(responses[0].body).message, 'Hello from a hand-written HTTP parser');
  assert.equal(JSON.parse(responses[1].body).status, 'ok');
});

test('malformed request gets 400', async () => {
  const [res] = splitResponses(await send(Buffer.from('NOTVALID\r\n\r\n', 'latin1')));
  assert.equal(res.status, 400);
  assert.equal(res.headers.connection, 'close');
});

test('wrong method gets 405 with Allow header', async () => {
  const [res] = splitResponses(await send(raw('PUT', '/')));
  assert.equal(res.status, 405);
  assert.equal(res.headers.allow, 'GET, HEAD');
});

test('HEAD has no body but keeps Content-Length', async () => {
  const [res] = splitResponses(await send(raw('HEAD', '/')));
  assert.equal(res.status, 200);
  assert.equal(res.body, '');
  assert.ok(Number(res.headers['content-length']) > 0);
});

test('/metrics exposes Prometheus counters', async () => {
  const [res] = splitResponses(await send(raw('GET', '/metrics')));
  assert.equal(res.status, 200);
  assert.match(res.body, /raw_http_requests_total \d+/);
  assert.match(res.body, /raw_http_request_duration_ms_bucket\{le="10"\}/);
});
