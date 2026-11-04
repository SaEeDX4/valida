/**
 * B7 — explicit HTTP server timeouts (Doc 13 sections 55-56: bounded requests,
 * a request timeout and a header timeout; exact production values are
 * deployment tuning, C6). Until B7 the server used Node's defaults without
 * stating them.
 *
 * Values and why:
 *
 *   headersTimeout  30 s  (Node default: 60 s) — the head of every valid
 *     request is a few kilobytes and arrives in milliseconds; 30 s still
 *     tolerates a very poor link while halving how long a client that drips
 *     its headers can hold a connection.
 *
 *   requestTimeout 180 s  (Node default: 300 s) — the whole request, body
 *     included. The largest valid request is about 5.4 MiB (a 5 MiB resume plus
 *     text fields; application.validation.js), which needs about 250 kbit/s to
 *     arrive in 180 s — below any current mobile upload rate — while a stalled
 *     or deliberately slow upload is cut off after 3 minutes instead of 5.
 *
 *   keepAliveTimeout  5 s  (Node default, stated) — how long an idle
 *     keep-alive connection waits for the next request. A reverse proxy in front
 *     of the server must use a shorter idle timeout (C6 deployment design).
 *
 * The staged close (stagedClose.js) bounds any discard separately
 * (8 MiB, 5 s), so these timeouts are not what limits a refused upload.
 */
export const SERVER_TIMEOUTS = Object.freeze({
  headersTimeout: 30_000,
  requestTimeout: 180_000,
  keepAliveTimeout: 5_000,
});

/**
 * @param {import('node:http').Server} server
 * @param {typeof SERVER_TIMEOUTS} [timeouts]
 */
export function applyServerTimeouts(server, timeouts = SERVER_TIMEOUTS) {
  if (!(timeouts.headersTimeout <= timeouts.requestTimeout)) {
    throw new Error('headersTimeout must not exceed requestTimeout');
  }
  server.headersTimeout = timeouts.headersTimeout;
  server.requestTimeout = timeouts.requestTimeout;
  server.keepAliveTimeout = timeouts.keepAliveTimeout;
  return server;
}
