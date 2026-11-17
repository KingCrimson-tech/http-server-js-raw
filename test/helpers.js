import { Parser } from '../src/parser.js';

/** Build a raw HTTP/1.1 request with CRLF line endings. */
export function request({ method = 'GET', target = '/', version = 'HTTP/1.1', headers = {}, body = '' } = {}) {
  const lines = [`${method} ${target} ${version}`];
  for (const [name, value] of Object.entries(headers)) lines.push(`${name}: ${value}`);
  const head = lines.join('\r\n') + '\r\n\r\n';
  return Buffer.from(head + body, 'latin1');
}

/** Feed every byte separately — the harshest split scenario. */
export function feedByteByByte(parser, buffer) {
  const out = [];
  for (const byte of buffer) out.push(...parser.feed(Buffer.from([byte])));
  return out;
}

/** Feed a buffer in fixed-size chunks. */
export function feedInChunks(parser, buffer, size) {
  const out = [];
  for (let i = 0; i < buffer.length; i += size) {
    out.push(...parser.feed(buffer.subarray(i, i + size)));
  }
  return out;
}

/** Convenience: parse a single complete buffer with default limits. */
export function parse(buffer, options) {
  const parser = new Parser(options);
  const results = parser.feed(buffer);
  return { results, parser };
}
