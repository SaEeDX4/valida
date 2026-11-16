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
 *
 * `plan` maps a method (or '*') to a list of modes consumed one per request;
 * the last mode repeats. Every request is recorded (method, mode, upstream
 * status) — never a header value.
 */
export async function startFaultProxy({ upstream }) {
  const target = new URL(upstream);
  const state = { plan: {}, log: [] };
  const next = (method) => {
    const list = state.plan[method] ?? state.plan['*'] ?? ['pass'];
    return list.length > 1 ? list.shift() : list[0];
  };
  const server = createServer((req, res) => {
    const mode = next(req.method);
    const entry = { method: req.method, mode, upstreamStatus: null };
    state.log.push(entry);
    if (mode === 'reset') {
      req.resume();
      req.socket.destroy();
      return;
    }
    if (mode.startsWith('status:')) {
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
