/**
 * HTTP response serialization with backpressure handling.
 *
 * `writeResponse` always returns a Promise that settles once the response has
 * been fully flushed to the socket (or the socket closed). That lets the
 * connection worker serialize pipelined responses deterministically.
 */

const EMPTY = Buffer.alloc(0);
const SERVER = 'raw-http-server';

export const STATUS_MESSAGES = Object.freeze({
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  301: 'Moved Permanently',
  304: 'Not Modified',
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  413: 'Payload Too Large',
  414: 'URI Too Long',
  431: 'Request Header Fields Too Large',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  505: 'HTTP Version Not Supported',
  503: 'Service Unavailable',
});

export function buildHead(status, headers = {}, { keepAlive = true, contentLength = 0 } = {}) {
  const reason = STATUS_MESSAGES[status] || 'Unknown';
  const finalHeaders = {
    'Content-Length': String(contentLength),
    'Content-Type': 'text/plain; charset=utf-8',
    'Connection': keepAlive ? 'keep-alive' : 'close',
    'Date': new Date().toUTCString(),
    'Server': SERVER,
    ...headers,
  };

  let head = `HTTP/1.1 ${status} ${reason}\r\n`;
  for (const [name, value] of Object.entries(finalHeaders)) {
    head += `${name}: ${value}\r\n`;
  }
  return head + '\r\n';
}

/**
 * Write a complete response.
 *
 * @param {import('node:net').Socket} socket
 * @param {object} options
 * @param {number} options.status
 * @param {object} [options.headers]
 * @param {Buffer|string|null} [options.body]
 * @param {import('node:stream').Readable|null} [options.stream]
 * @param {string} [options.method] request method (HEAD suppresses the body)
 * @param {boolean} [options.keepAlive]
 * @param {number} [options.contentLength] required when streaming
 * @returns {Promise<void>}
 */
export function writeResponse(socket, options = {}) {
  if (socket.destroyed) return Promise.resolve();

  const {
    status = 200,
    headers = {},
    body = null,
    stream = null,
    method = 'GET',
    keepAlive = true,
    contentLength,
  } = options;

  const bodyBuf = body == null
    ? EMPTY
    : (Buffer.isBuffer(body) ? body : Buffer.from(body));

  const noBody = method === 'HEAD' || status === 204 || status === 304;
  const length = noBody ? 0 : (contentLength ?? (stream ? undefined : bodyBuf.length));
  const head = buildHead(status, headers, { keepAlive, contentLength: length ?? 0 });

  if (noBody) {
    socket.write(head);
    return Promise.resolve();
  }

  if (stream) {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        socket.off('close', done);
        stream.off('error', done);
        resolve();
      };

      socket.on('close', done);
      stream.on('error', () => {
        socket.destroy();
        done();
      });

      socket.write(head);
      stream.on('data', (chunk) => {
        if (!socket.write(chunk)) {
          // Backpressure: stop reading until the kernel buffer drains.
          stream.pause();
          socket.once('drain', () => stream.resume());
        }
      });
      stream.on('end', done);
      stream.resume();
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      socket.off('close', done);
      resolve();
    };
    socket.on('close', done);

    const payload = length === 0 ? head : Buffer.concat([Buffer.from(head), bodyBuf]);
    if (socket.write(payload)) done();
    else socket.once('drain', done);
  });
}
