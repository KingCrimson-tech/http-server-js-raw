/**
 * Incremental HTTP/1.1 request parser.
 *
 * Feeds arbitrary TCP chunks into a small state machine and emits complete
 * requests. A cursor (`_offset`) walks a single growing buffer instead of
 * repeatedly slicing it, so parsing stays linear. The buffer is compacted
 * occasionally to keep memory bounded across many keep-alive requests.
 *
 * States: REQUEST_LINE -> HEADERS -> BODY -> DONE -> REQUEST_LINE ...
 */

export const STATE = Object.freeze({
  REQUEST_LINE: 0,
  HEADERS: 1,
  BODY: 2,
});

const CRLF = '\r\n';
const EMPTY = Buffer.alloc(0);
const TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const METHOD_RE = /^[A-Z]+$/;
const CONTENT_LENGTH_RE = /^\d+$/;
const CONTROL_RE = /[\x00-\x1f]/;

const DEFAULTS = {
  maxBufferSize: 2 * 1024 * 1024,
  maxHeaderSize: 16 * 1024,
  maxHeaderCount: 100,
  maxBodySize: 1 * 1024 * 1024,
  maxRequestLineSize: 8 * 1024,
};

export class Parser {
  constructor(options = {}) {
    this.maxBufferSize = options.maxBufferSize ?? DEFAULTS.maxBufferSize;
    this.maxHeaderSize = options.maxHeaderSize ?? DEFAULTS.maxHeaderSize;
    this.maxHeaderCount = options.maxHeaderCount ?? DEFAULTS.maxHeaderCount;
    this.maxBodySize = options.maxBodySize ?? DEFAULTS.maxBodySize;
    this.maxRequestLineSize = options.maxRequestLineSize ?? DEFAULTS.maxRequestLineSize;

    this._buf = EMPTY;
    this._offset = 0;
    this._start = 0; // byte offset where the current request began
    this._state = STATE.REQUEST_LINE;
    this._errored = false;
    this._errorStatus = 0;
    this._errorMessage = '';
    this._resetRequest();
  }

  /** Number of unparsed bytes currently buffered. */
  get buffered() {
    return this._buf.length - this._offset;
  }

  /** True once a fatal parse error has been emitted; connection must close. */
  get errored() {
    return this._errored;
  }

  _resetRequest() {
    this._method = '';
    this._path = '';
    this._query = '';
    this._httpVersion = '';
    this._headers = Object.create(null);
    this._headerCount = 0;
    this._contentLength = 0;
    this._chunked = false;
    this._keepAlive = true;
    this._start = this._offset;
  }

  static _error(status, message) {
    return { ok: false, status, message };
  }

  /**
   * Append a chunk and return every result that became available.
   * Each result is either `{ ok: true, request }` or
   * `{ ok: false, status, message }` (a protocol error).
   */
  feed(chunk) {
    if (chunk && chunk.length > 0) {
      if (this._offset === this._buf.length) {
        // Everything consumed; reuse the incoming chunk directly.
        this._buf = chunk;
        this._offset = 0;
        this._start = 0;
      } else if (this._offset > this._buf.length / 2) {
        // Compact when a majority of the buffer is already consumed.
        const oldOffset = this._offset;
        const rest = this._buf.subarray(oldOffset);
        this._buf = Buffer.concat([rest, chunk]);
        this._offset = 0;
        this._start = Math.max(0, this._start - oldOffset);
      } else {
        this._buf = Buffer.concat([this._buf, chunk]);
      }
    }

    const out = [];

    if (this.buffered > this.maxBufferSize) {
      out.push(this._fail(413, 'Buffered request data exceeds limit'));
      this._offset = this._buf.length;
      return out;
    }

    while (!this._errored) {
      const result = this._parseOne();
      if (result === null) break; // need more bytes
      out.push(result);
      if (!result.ok) break;
      // Otherwise loop again to handle pipelined requests.
    }
    return out;
  }

  _parseOne() {
    switch (this._state) {
      case STATE.REQUEST_LINE:
        return this._parseRequestLine();
      case STATE.HEADERS:
        return this._parseHeaders();
      case STATE.BODY:
        return this._parseBody();
      default:
        throw new Error(`Unknown parser state: ${this._state}`);
    }
  }

  _parseRequestLine() {
    const buf = this._buf;
    const idx = buf.indexOf(CRLF, this._offset);
    if (idx === -1) {
      if (buf.length - this._start > this.maxRequestLineSize) {
        return this._fail(414, 'Request line too long');
      }
      return null;
    }
    if (idx - this._start > this.maxRequestLineSize) {
      return this._fail(414, 'Request line too long');
    }

    const line = buf.toString('latin1', this._offset, idx);
    this._offset = idx + 2;

    const sp1 = line.indexOf(' ');
    const sp2 = sp1 === -1 ? -1 : line.indexOf(' ', sp1 + 1);
    if (sp1 <= 0 || sp2 <= sp1 + 1 || sp2 === line.length - 1) {
      return this._fail(400, 'Malformed request line');
    }

    const method = line.slice(0, sp1);
    const target = line.slice(sp1 + 1, sp2);
    const version = line.slice(sp2 + 1);

    if (!METHOD_RE.test(method)) return this._fail(400, 'Invalid method token');
    if (CONTROL_RE.test(target)) return this._fail(400, 'Invalid request target');
    if (version !== 'HTTP/1.1' && version !== 'HTTP/1.0') {
      return this._fail(505, 'Unsupported HTTP version');
    }

    const q = target.indexOf('?');
    this._method = method;
    this._path = q === -1 ? target : target.slice(0, q);
    this._query = q === -1 ? '' : target.slice(q + 1);
    this._httpVersion = version;
    this._keepAlive = version === 'HTTP/1.1'; // HTTP/1.0 defaults to close

    this._state = STATE.HEADERS;
    return this._parseHeaders();
  }

  _parseHeaders() {
    const buf = this._buf;

    while (true) {
      if (this._offset - this._start > this.maxHeaderSize) {
        return this._fail(431, 'Request headers too large');
      }

      const idx = buf.indexOf(CRLF, this._offset);
      if (idx === -1) return null; // need more bytes

      if (idx === this._offset) {
        // Empty line terminates the header section.
        this._offset += 2;
        this._finalizeHeaders();
        if (this._errored) {
          return Parser._error(this._errorStatus, this._errorMessage);
        }
        this._state = STATE.BODY;
        return this._parseBody();
      }

      const line = buf.toString('latin1', this._offset, idx);
      this._offset = idx + 2;

      const colon = line.indexOf(':');
      if (colon <= 0) return this._fail(400, 'Malformed header line');

      const name = line.slice(0, colon).trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      if (!TOKEN_RE.test(name)) return this._fail(400, 'Invalid header name');
      if (CONTROL_RE.test(value)) return this._fail(400, 'Invalid header value');

      this._headerCount += 1;
      if (this._headerCount > this.maxHeaderCount) {
        return this._fail(431, 'Too many headers');
      }

      if (name === 'content-length') {
        if (this._headers[name] !== undefined) {
          return this._fail(400, 'Duplicate Content-Length');
        }
        if (!CONTENT_LENGTH_RE.test(value)) {
          return this._fail(400, 'Invalid Content-Length');
        }
        this._contentLength = Number(value);
        if (!Number.isSafeInteger(this._contentLength) || this._contentLength > this.maxBodySize) {
          return this._fail(413, 'Request body too large');
        }
        this._headers[name] = value;
      } else if (name === 'transfer-encoding') {
        if (/chunked/i.test(value)) this._chunked = true;
        this._headers[name] = value;
      } else if (this._headers[name] !== undefined) {
        this._headers[name] += ', ' + value;
      } else {
        this._headers[name] = value;
      }
    }
  }

  _finalizeHeaders() {
    const conn = this._headers['connection'] || '';
    if (/\bclose\b/i.test(conn)) this._keepAlive = false;
    else if (/\bkeep-alive\b/i.test(conn)) this._keepAlive = true;

    if (this._chunked) {
      this._fail(501, 'Chunked request bodies are not supported');
    }
  }

  _parseBody() {
    const need = this._contentLength;
    const available = this._buf.length - this._offset;
    if (available < need) return null; // need more bytes

    // Copy body bytes out of the shared buffer so later compaction is safe.
    const body = need > 0
      ? Buffer.from(this._buf.subarray(this._offset, this._offset + need))
      : EMPTY;
    this._offset += need;

    const request = {
      method: this._method,
      path: this._path,
      query: this._query,
      httpVersion: this._httpVersion,
      headers: this._headers,
      body,
      keepAlive: this._keepAlive,
      rawLength: this._offset - this._start,
    };

    this._state = STATE.REQUEST_LINE;
    this._resetRequest();
    return { ok: true, request };
  }

  _fail(status, message) {
    this._errored = true;
    this._errorStatus = status;
    this._errorMessage = message;
    return Parser._error(status, message);
  }
}
