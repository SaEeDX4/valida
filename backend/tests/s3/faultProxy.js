import { createServer, request as httpRequest } from 'node:http';

/**
 * C6-T4 — a fault-injecting HTTP proxy in front of the S3 test double, for
 * the outcomes a real network can produce. Modes (per request method):
 *
 *   pass                       forward unchanged
 *   lose-answer                forward the request; the double processes it;
 *                              then the CLIENT connection is destroyed before
 *                              any answer is relayed (a write that happened,
 *                              whose answer was lost)
 *   reset                      destroy the client connection without forwarding
 *   status:<n>                 answer <n> without forwarding (nothing happens upstream)
 *   hang                       never answer (the client's timeout decides)
 *   reset-then-forward:<ms>    destroy the client connection at once, then forward the
 *                              buffered request <ms> later (a write that lands AFTER the
 *                              client gave up: a late write)
 *   { respond: { status, headers, body } }   answer this without forwarding
 *   { rewrite: (status, body) => body }      forward, then replace the answer's body
 *
 * C6-T4 correction 1: a plan entry may also be a FUNCTION (req) => mode,
 * evaluated per request (for example by path, or by whether the request is
 * anonymous); `anonymous` is true when the request carries no Authorization.
 *
 * `plan` maps a method (or '*') to a list of modes consumed one per request;
 * the last mode repeats. Every request is recorded (method, mode, upstream
 * status) — never a header value.
 */
export async function startFaultProxy({ upstream }) {
  const target = new URL(upstream);
  const state = { plan: {}, log: [] };
  const next = (req) => {
    const list = state.plan[req.method] ?? state.plan['*'] ?? ['pass'];
    const entry = list.length > 1 ? list.shift() : list[0];
    return typeof entry === 'function' ? entry({ method: req.method, url: req.url, anonymous: !req.headers.authorization }) : entry;
  };
  const server = createServer((req, res) => {
    const mode = next(req);
    // C6-T6: `path` (the request path, test-side only) lets a check name the object a request was for.
    const entry = { method: req.method, path: new URL(req.url, 'http://x').pathname, mode: typeof mode === 'string' ? mode : Object.keys(mode)[0], anonymous: !req.headers.authorization, versionId: new URL(req.url, 'http://x').searchParams.get('versionId'), upstreamStatus: null };
    state.log.push(entry);
    if (mode === 'hang') {
      req.resume();
      return;
    }
    if (typeof mode === 'object' && mode.respond) {
      req.resume();
      req.on('end', () => {
        res.writeHead(mode.respond.status, { 'content-type': 'application/xml', ...(mode.respond.headers ?? {}) });
        res.end(mode.respond.body ?? '');
      });
      return;
    }
    if (typeof mode === 'string' && mode.startsWith('reset-then-forward:')) {
      const delay = Number(mode.split(':')[1]);
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        req.socket.destroy();
        setTimeout(() => {
          const late = httpRequest({ host: target.hostname, port: target.port, method: req.method, path: req.url, headers: req.headers }, (answer) => {
            entry.upstreamStatus = answer.statusCode;
            answer.resume();
          });
          late.on('error', () => {});
          late.end(Buffer.concat(chunks));
        }, delay);
      });
      return;
    }
    if (mode === 'reset') {
      req.resume();
      req.socket.destroy();
      return;
    }
    if (typeof mode === 'string' && mode.startsWith('status:')) {
      req.resume();
      req.on('end', () => {
        const status = Number(mode.slice(7));
        res.writeHead(status, { 'content-type': 'application/xml' });
        res.end(`<?xml version="1.0"?><Error><Code>${status === 403 ? 'AccessDenied' : 'InternalError'}</Code><Message>qa fault</Message></Error>`);
      });
      return;
    }
    const upstreamReq = httpRequest({ host: target.hostname, port: target.port, method: req.method, path: req.url, headers: req.headers }, (answer) => {
      entry.upstreamStatus = answer.statusCode;
      if (mode === 'lose-answer') {
        answer.resume();
        answer.on('end', () => req.socket.destroy());
        return;
      }
      // C6-T4 correction 2: { afterUpstream, stripHeaders } — the store has
      // answered; `afterUpstream(status, headers)` runs (e.g. a synthetic
      // replacement is placed) BEFORE the client sees the answer, so it lands
      // after the client's observation and before its next request.
      if (typeof mode === 'object' && (mode.afterUpstream || mode.stripHeaders)) {
        const parts = [];
        answer.on('data', (c) => parts.push(c));
        answer.on('end', async () => {
          if (mode.afterUpstream) await mode.afterUpstream(answer.statusCode, answer.headers);
          const headers = { ...answer.headers };
          for (const name of mode.stripHeaders ?? []) delete headers[name];
          res.writeHead(answer.statusCode, headers);
          res.end(Buffer.concat(parts));
        });
        return;
      }
      if (typeof mode === 'object' && mode.rewrite) {
        const parts = [];
        answer.on('data', (c) => parts.push(c));
        answer.on('end', () => {
          const body = mode.rewrite(answer.statusCode, Buffer.concat(parts).toString('utf8'));
          const headers = { ...answer.headers, 'content-length': String(Buffer.byteLength(body)) };
          delete headers['transfer-encoding'];
          res.writeHead(answer.statusCode, headers);
          res.end(body);
        });
        return;
      }
      res.writeHead(answer.statusCode, answer.headers);
      answer.pipe(res);
    });
    upstreamReq.on('error', () => req.socket.destroy());
    req.pipe(upstreamReq);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    setPlan(plan) {
      state.plan = Object.fromEntries(Object.entries(plan).map(([k, v]) => [k, [...v]]));
    },
    log: state.log,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}
