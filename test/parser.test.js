import test from 'node:test';
import assert from 'node:assert/strict';
import { Parser } from '../src/parser.js';
import { request, feedByteByByte, feedInChunks, parse } from './helpers.js';

test('parses a basic GET request', () => {
  const { results } = parse(request({ headers: { Host: 'localhost', 'User-Agent': 'test' } }));
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  const req = results[0].request;
  assert.equal(req.method, 'GET');
  assert.equal(req.path, '/');
  assert.equal(req.query, '');
  assert.equal(req.httpVersion, 'HTTP/1.1');
  assert.equal(req.headers.host, 'localhost');
  assert.equal(req.headers['user-agent'], 'test');
  assert.equal(req.body.length, 0);
  assert.equal(req.keepAlive, true);
});

test('splits path and query string', () => {
  const { results } = parse(request({ target: '/search?q=hello+world&page=2' }));
  assert.equal(results[0].request.path, '/search');
  assert.equal(results[0].request.query, 'q=hello+world&page=2');
});

test('lowercases header names and joins duplicate values', () => {
  const raw = Buffer.from(
    'GET / HTTP/1.1\r\n' +
    'Host: example.com\r\n' +
    'X-Custom: one\r\n' +
    'x-custom: two\r\n' +
    '\r\n',
    'latin1',
  );
  const { results } = parse(raw);
  assert.equal(results[0].request.headers['x-custom'], 'one, two');
});

test('parses a POST body of exactly Content-Length bytes', () => {
  const body = '{"name":"Ada"}';
  const raw = request({ method: 'POST', target: '/echo', headers: { 'Content-Length': String(body.length) }, body });
  const { results } = parse(raw);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].request.body.toString(), body);
  assert.equal(results[0].request.rawLength, raw.length);
});

test('handles an empty body', () => {
  const { results } = parse(request({ method: 'POST', headers: { 'Content-Length': '0' } }));
  assert.equal(results[0].request.body.length, 0);
});

test('honors Connection: close', () => {
  const { results } = parse(request({ headers: { Connection: 'close' } }));
  assert.equal(results[0].request.keepAlive, false);
});

test('HTTP/1.0 defaults to close unless keep-alive requested', () => {
  const a = parse(request({ version: 'HTTP/1.0' })).results[0].request;
  const b = parse(request({ version: 'HTTP/1.0', headers: { Connection: 'keep-alive' } })).results[0].request;
  assert.equal(a.keepAlive, false);
  assert.equal(b.keepAlive, true);
});

test('parses correctly when fed one byte at a time', () => {
  const raw = request({
    method: 'POST',
    target: '/echo?x=1',
    headers: { Host: 'localhost', 'Content-Length': '11' },
    body: 'hello world',
  });
  const out = feedByteByByte(new Parser(), raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].ok, true);
  assert.equal(out[0].request.path, '/echo');
  assert.equal(out[0].request.query, 'x=1');
  assert.equal(out[0].request.body.toString(), 'hello world');
});

test('parses correctly for every fixed chunk size', () => {
  const raw = request({
    method: 'POST',
    headers: { Host: 'localhost', 'Content-Length': '5' },
    body: 'abcde',
  });
  for (let size = 1; size <= raw.length + 1; size++) {
    const out = feedInChunks(new Parser(), raw, size);
    assert.equal(out.length, 1, `chunk size ${size}`);
    assert.equal(out[0].request.body.toString(), 'abcde', `chunk size ${size}`);
  }
});

test('handles pipelined requests in a single chunk', () => {
  const combined = Buffer.concat([
    request({ target: '/one' }),
    request({ target: '/two' }),
    request({ target: '/three' }),
  ]);
  const { results } = parse(combined);
  assert.equal(results.length, 3);
  assert.deepEqual(results.map((r) => r.request.path), ['/one', '/two', '/three']);
});

test('keeps leftover partial bytes across feeds', () => {
  const parser = new Parser();
  const first = request({ target: '/one' });
  const second = request({ target: '/two' });
  const combined = Buffer.concat([first, second]);
  const split = first.length + 7;
  const out = [...parser.feed(combined.subarray(0, split)), ...parser.feed(combined.subarray(split))];
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.request.path), ['/one', '/two']);
});

test('rejects a malformed request line', () => {
  const { results } = parse(Buffer.from('GARBAGE\r\n\r\n'));
  assert.equal(results[0].ok, false);
  assert.equal(results[0].status, 400);
});

test('rejects an unsupported HTTP version', () => {
  const { results } = parse(request({ version: 'HTTP/2.0' }));
  assert.equal(results[0].ok, false);
  assert.equal(results[0].status, 505);
});

test('rejects an invalid Content-Length', () => {
  const { results } = parse(request({ headers: { 'Content-Length': 'abc' } }));
  assert.equal(results[0].ok, false);
  assert.equal(results[0].status, 400);
});

test('rejects duplicate Content-Length', () => {
  const raw = Buffer.from('POST / HTTP/1.1\r\nContent-Length: 1\r\ncontent-length: 1\r\n\r\nx');
  const { results } = parse(raw);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].status, 400);
});

test('rejects chunked request bodies with 501', () => {
  const { results } = parse(request({ headers: { 'Transfer-Encoding': 'chunked' } }));
  assert.equal(results[0].ok, false);
  assert.equal(results[0].status, 501);
});

test('enforces body size limit with 413', () => {
  const { results } = parse(
    request({ headers: { 'Content-Length': '100' } }),
    { maxBodySize: 10 },
  );
  assert.equal(results[0].ok, false);
  assert.equal(results[0].status, 413);
});

test('enforces header count limit with 431', () => {
  const headers = {};
  for (let i = 0; i < 20; i++) headers[`X-${i}`] = 'v';
  const { results } = parse(request({ headers }), { maxHeaderCount: 5 });
  assert.equal(results[0].ok, false);
  assert.equal(results[0].status, 431);
});

test('enforces header size limit with 431', () => {
  const { results } = parse(request({ headers: { 'X-Big': 'a'.repeat(200) } }), { maxHeaderSize: 32 });
  assert.equal(results[0].ok, false);
  assert.equal(results[0].status, 431);
});

test('enforces total buffer cap with 413', () => {
  const parser = new Parser({ maxBufferSize: 10 });
  const out = parser.feed(Buffer.alloc(64, 'x'));
  assert.equal(out[0].ok, false);
  assert.equal(out[0].status, 413);
  assert.equal(parser.errored, true);
});

test('a fatal error stops further parsing', () => {
  const parser = new Parser();
  const first = parser.feed(Buffer.from('BAD\r\n\r\n'));
  const second = parser.feed(request());
  assert.equal(first[0].ok, false);
  assert.equal(second.length, 0);
  assert.equal(parser.errored, true);
});
