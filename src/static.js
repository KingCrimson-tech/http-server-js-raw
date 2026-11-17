import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { errorResponse } from './errors.js';

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
});

export function mimeType(filename) {
  return MIME_TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}

/**
 * Resolve a /static/* URL to a file and return a streaming response descriptor.
 * Path traversal is blocked by resolving against root and checking containment.
 */
export async function serveStatic(urlPath, staticDir) {
  let rel = urlPath === '/static' ? '' : urlPath.slice('/static/'.length);
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';

  let decoded;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return errorResponse(400, 'Invalid URL encoding');
  }
  if (decoded.includes('\0')) return errorResponse(400, 'Invalid path');

  const root = path.resolve(staticDir);
  let target = path.resolve(root, decoded);
  if (target !== root && !target.startsWith(root + path.sep)) {
    return errorResponse(403, 'Forbidden');
  }

  let info;
  try {
    info = await stat(target);
  } catch {
    return errorResponse(404, 'File not found');
  }

  if (info.isDirectory()) {
    target = path.join(target, 'index.html');
    try {
      info = await stat(target);
    } catch {
      return errorResponse(404, 'File not found');
    }
  }
  if (!info.isFile()) return errorResponse(404, 'File not found');

  return {
    status: 200,
    headers: {
      'Content-Type': mimeType(target),
      'Cache-Control': 'public, max-age=60',
    },
    contentLength: info.size,
    stream: createReadStream(target),
  };
}
