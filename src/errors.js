import { STATUS_MESSAGES } from './response.js';

/** Build a consistent JSON error response object for the router/worker. */
export function errorResponse(status, message) {
  const reason = STATUS_MESSAGES[status] || 'Error';
  const body = JSON.stringify({ error: status, message: message || reason });
  return {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body,
  };
}
