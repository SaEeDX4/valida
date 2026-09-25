import { randomUUID } from 'node:crypto';

/**
 * Request correlation — 09_BACKEND_API_SPEC.md sections 19-21.
 *
 * Every request gets a high-entropy id, echoed in the X-Request-ID response
 * header and repeated in the response envelope and every log line, so one
 * reported failure can be traced without asking the user for more detail.
 *
 * INBOUND IDS ARE CONSTRAINED, NOT TRUSTED. An id supplied by the caller is
 * reused only when it matches a strict pattern. Without that, a caller could
 * inject newlines to forge log entries, or a megabyte of text to bloat every
 * log line. Anything else is replaced with a fresh UUID.
 *
 * crypto.randomUUID is a platform capability — no uuid package is added.
 */
const INBOUND_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

export function requestId() {
  return function requestIdMiddleware(req, res, next) {
    const inbound = req.get('x-request-id');
    req.id = typeof inbound === 'string' && INBOUND_PATTERN.test(inbound) ? inbound : randomUUID();
    res.setHeader('X-Request-ID', req.id);
    next();
  };
}
