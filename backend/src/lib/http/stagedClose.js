/**
 * Staged connection close — RFC 9112 section 9.6 ("Tear-down"). Milestone B4, r3.
 *
 * WHY. Some failures are answered before the request body has been read: an
 * upload whose temporary file cannot be written (503), or a body over the
 * size limit (413). Those responses say `Connection: close`. Node's HTTP
 * server then ends the socket and destroys it as soon as its FIN is written —
 * while the rest of the client's upload is still unread in the socket's
 * receive buffer. Closing a TCP socket with unread data makes the operating
 * system send a RESET instead of a clean close (Linux counts it as
 * TCPAbortOnClose; it was measured for every such r2 response). RFC 9112
 * section 9.6 describes the consequence: "the reset packet might erase the
 * client's unacknowledged input buffers before they can be read" — the client
 * loses the very response that explains the failure. Linux clients happen to
 * keep already-received data; the B4 r2 Windows run did not receive the 503
 * at all (verification report, "upload-temp-failure").
 *
 * WHAT. The close is done in the stages the RFC prescribes:
 *   1. the response is written, then only the WRITE side is closed (FIN);
 *   2. whatever the client is still sending for THIS request is read and
 *      discarded — never stored — so no unread data remains when the socket
 *      is finally closed;
 *   3. the socket is fully closed as soon as the request body is complete (and
 *      no further request followed it) or the client closes its side, and in
 *      any case within fixed bounds: at most `maxBytes` more bytes (more than
 *      any valid request may send), no more than `idleMs` without data, and
 *      `maxMs` in total.
 *
 * NO FURTHER REQUEST IS PROCESSED (RFC 9112 section 9.6: after "close" the
 * server "MUST NOT process any further requests received on that
 * connection"). While the rest of the body is read, Node's HTTP parser stays
 * attached to the socket, and it dispatches a request pipelined behind the
 * refused body — even in the same TCP read — to the request listener.
 * `serveUnlessConnectionClosing(app)` is therefore the HTTP server's request
 * listener (src/server.js), around the Express app — outside it, so the
 * canonical middleware order (Doc 09 section 13) is unchanged. A request that
 * arrives on the connection AFTER the close was armed never enters the app
 * and gets no response; its body is read and discarded like the rest, within
 * the same bounds, and the close then ends only when the client closes its
 * side or a bound is reached (a finished body no longer ends it: more may
 * follow). Found by the independent pre-submission check of r3.
 *
 * NOT COVERED (Node's ordinary pipelining, unchanged from r2): a request
 * pipelined so closely that Node dispatches it BEFORE the refused request's
 * error has been handled — before the close is armed — is processed like any
 * pipelined request.
 *
 * HOW. Node's HTTP server ends a `Connection: close` response by calling
 * `socket.destroySoon()` (lib/_http_server.js, resOnFinish). For the one socket
 * of such a response, that method is replaced by the staged close below. If a
 * future Node stopped calling it, the connection would simply be closed the
 * old way; tests/upload-temp-failure.test.js asserts the staged behaviour
 * (every byte the client sent is read before the server closes).
 */
export const STAGED_CLOSE_LIMITS = Object.freeze({
  /** Above the largest valid upload request (5 MiB file + text fields + 64 KiB). */
  maxBytes: 8 * 1024 * 1024,
  idleMs: 2_000,
  /** Below the graceful-shutdown timeout (10 s), so shutdown is never held up by it. */
  maxMs: 5_000,
});

/** Sockets being closed in stages -> the function that refuses a further request on them. */
const closing = new WeakMap();

/**
 * Arms the staged close for `req`'s connection. Call it before sending the
 * `Connection: close` response. Does nothing when the request body has
 * already been read completely (nothing is left unread) or the socket is gone.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {{ limits?: typeof STAGED_CLOSE_LIMITS, logger?: object }} [options]
 * @returns {boolean} whether the staged close was armed
 */
export function closeAfterResponseInStages(req, { limits = STAGED_CLOSE_LIMITS, logger } = {}) {
  const socket = req.socket;
  if (!socket || socket.destroyed || req.readableEnded || req.destroyed || closing.has(socket)) return false;

  let drainedBytes = 0;
  let idleTimer = null;
  let maxTimer = null;
  let staged = false;
  let outcome = null;
  let furtherRequests = 0;

  const clearTimers = () => {
    clearTimeout(idleTimer);
    clearTimeout(maxTimer);
  };

  const drained = new Set([req]);

  /**
   * Ends the close, once: one bounded log event, then the socket is destroyed
   * — at once for OVER_LIMIT, otherwise as soon as our own bytes (response and
   * FIN) are written.
   */
  const finish = (why, { immediately = false } = {}) => {
    if (outcome !== null) return;
    outcome = why;
    clearTimers();
    for (const stream of drained) stream.removeListener('data', onData);
    logger?.debug(
      { event: 'connection_staged_close', outcome: why, drainedBytes, furtherRequests },
      'connection closed after the response',
    );
    if (socket.destroyed) return;
    if (immediately || socket.writableFinished || !socket.writable) socket.destroy();
    else socket.once('finish', () => socket.destroy());
  };

  const restartIdle = () => {
    if (!staged) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => finish('IDLE'), limits.idleMs);
  };

  // Stage 2 starts now: the rest of this request's body is read and dropped.
  function onData(chunk) {
    drainedBytes += chunk.length;
    if (drainedBytes > limits.maxBytes) {
      // More than any valid request may send: stop reading at once.
      finish('OVER_LIMIT', { immediately: true });
      return;
    }
    restartIdle();
  }
  let clientClosed = false;
  /** A request that arrived after the close was armed: never processed; its body is drained too. */
  closing.set(socket, (further) => {
    furtherRequests += 1;
    if (outcome !== null) return;
    drained.add(further);
    further.on('data', onData);
    further.resume();
    restartIdle();
  });
  req.on('data', onData);
  req.once('end', () => {
    if (staged && furtherRequests === 0) finish('BODY_COMPLETE');
  });
  socket.once('end', () => {
    clientClosed = true;
    if (staged) finish('CLIENT_CLOSED');
  });
  socket.once('close', clearTimers);
  req.resume();

  // Stage 1 + 3: called by Node's HTTP server once the response is written.
  socket.destroySoon = function stagedDestroySoon() {
    staged = true;
    if (this.writable) this.end(); // our FIN follows the response
    if (outcome !== null) return; // already ended: destroyed once the FIN is written
    if (req.readableEnded && furtherRequests === 0) {
      finish('BODY_COMPLETE');
      return;
    }
    if (clientClosed) {
      finish('CLIENT_CLOSED');
      return;
    }
    maxTimer = setTimeout(() => finish('MAX_TIME'), limits.maxMs);
    restartIdle();
  };
  return true;
}

/**
 * True when `req` arrived on a connection that is being closed in stages:
 * such a request must not be processed. Its body is then read and discarded
 * as part of the close.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
export function refuseFurtherRequest(req) {
  const refuse = closing.get(req.socket);
  if (!refuse) return false;
  refuse(req);
  return true;
}

/**
 * Wraps an HTTP request listener (the Express app) so that a request arriving
 * on a connection being closed in stages never reaches it and is never
 * answered; its body is drained (see "NO FURTHER REQUEST IS PROCESSED" above). Used by
 * src/server.js: `http.createServer(serveUnlessConnectionClosing(app))`.
 *
 * @param {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void} listener
 */
export function serveUnlessConnectionClosing(listener) {
  return function serveUnlessConnectionClosingListener(req, res) {
    if (refuseFurtherRequest(req)) return;
    listener(req, res);
  };
}
