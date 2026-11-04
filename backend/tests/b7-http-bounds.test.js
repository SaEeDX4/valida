import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { hasUnreadBody, serveUnlessConnectionClosing, STAGED_CLOSE_LIMITS } from '../src/lib/http/stagedClose.js';
import { applyServerTimeouts, SERVER_TIMEOUTS } from '../src/lib/http/serverTimeouts.js';

/**
 * B7 — the body-discard issue (Doc 13 sections 55-56; Doc 18 section 141
 * "request size"). Unit level, over real sockets, with a plain listener: an
 * answer given while the request body is still unread closes the connection in
 * the bounded stages; every other answer keeps the connection as before.
 * The Apply-route measurements are in tests/apply-connection.test.js.
 */
describe('hasUnreadBody', () => {
  const req = (headers, { complete = false, readableEnded = false } = {}) => ({ headers, complete, readableEnded });
  it.each([
    ['no body headers', {}, {}, false],
    ['Content-Length: 0', { 'content-length': '0' }, {}, false],
    ['Content-Length: 10, not yet received', { 'content-length': '10' }, {}, true],
    ['Transfer-Encoding: chunked, not yet received', { 'transfer-encoding': 'chunked' }, {}, true],
    ['Content-Length: 10, received completely', { 'content-length': '10' }, { complete: true }, false],
    ['Content-Length: 10, already consumed', { 'content-length': '10' }, { readableEnded: true }, false],
  ])('%s -> %s', (_label, headers, state, expected) => {
    expect(hasUnreadBody(req(headers, state))).toBe(expected);
  });
});

let server;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
});

/** A listener that answers at once, or after reading the whole body when `?read` is in the URL. */
async function serve() {
  server = http.createServer(
    serveUnlessConnectionClosing((req, res) => {
      const answer = () => {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end('{"success":false}');
      };
      if (req.url.includes('read')) {
        req.resume();
        req.on('end', answer);
      } else answer();
    }),
  );
  const sockets = [];
  server.on('connection', (socket) => {
    const record = { socket, closed: false };
    socket.on('close', () => {
      record.closed = true;
      record.bytesRead = socket.bytesRead;
    });
    sockets.push(record);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: server.address().port, sockets };
}

/** allowHalfOpen: like an uploading browser, the client keeps sending after the server's FIN. */
async function client(port) {
  const socket = net.connect({ port, host: '127.0.0.1', allowHalfOpen: true });
  const state = { data: '', ended: false, sent: 0 };
  socket.on('data', (chunk) => {
    state.data += chunk.toString('latin1');
  });
  socket.on('end', () => {
    state.ended = true;
  });
  socket.on('error', () => {});
  await new Promise((resolve) => socket.once('connect', resolve));
  return {
    socket,
    state,
    send(bytes) {
      state.sent += Buffer.byteLength(bytes);
      socket.write(bytes);
    },
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await wait(10);
  }
  throw new Error(`${what} not reached within ${ms} ms`);
}

describe('closeEarlyAnswersInStages (through serveUnlessConnectionClosing)', () => {
  it('a request without a body: the answer keeps the connection open, as before', async () => {
    const { port, sockets } = await serve();
    const c = await client(port);
    c.send('GET /x HTTP/1.1\r\nHost: qa\r\n\r\n');
    await until(() => c.state.data.endsWith('}'), 2000, 'answer');
    expect(c.state.data).toMatch(/\r\nConnection: keep-alive\r\n/i);
    await wait(300);
    expect(sockets[0].closed).toBe(false);
    c.socket.destroy();
  });

  it('a body read completely before the answer: the connection stays open, as before', async () => {
    const { port, sockets } = await serve();
    const c = await client(port);
    c.send('POST /read HTTP/1.1\r\nHost: qa\r\nContent-Length: 5\r\n\r\nhello');
    await until(() => c.state.data.endsWith('}'), 2000, 'answer');
    expect(c.state.data).toMatch(/\r\nConnection: keep-alive\r\n/i);
    await wait(300);
    expect(sockets[0].closed).toBe(false);
    c.socket.destroy();
  });

  it('an answer given while the body is unread: Connection: close, every byte sent is read, then the server closes', async () => {
    const { port, sockets } = await serve();
    const c = await client(port);
    c.send('POST /x HTTP/1.1\r\nHost: qa\r\nContent-Length: 1048576\r\n\r\n');
    await until(() => c.state.data.endsWith('}'), 2000, 'answer');
    c.send(Buffer.alloc(1024 * 1024, 0x41));
    await until(() => sockets[0].closed, 3000, 'server close');
    expect(c.state.data).toMatch(/^HTTP\/1\.1 404 /);
    expect(c.state.data).toMatch(/\r\nConnection: close\r\n/i);
    expect(sockets[0].bytesRead).toBe(c.state.sent);
  });

  it('the discard is bounded: more than the staged-close byte cap is not read; the connection is closed', async () => {
    const { port, sockets } = await serve();
    const c = await client(port);
    c.send('POST /x HTTP/1.1\r\nHost: qa\r\nContent-Length: 67108864\r\n\r\n');
    await until(() => c.state.data.endsWith('}'), 2000, 'answer');
    c.send(Buffer.alloc(STAGED_CLOSE_LIMITS.maxBytes + 2 * 1024 * 1024, 0x41));
    await until(() => sockets[0].closed, 3000, 'server close');
    expect(sockets[0].bytesRead).toBeLessThan(STAGED_CLOSE_LIMITS.maxBytes + 2 * 1024 * 1024);
  });

  it('the discard is bounded in time: a client that stops sending is closed after the idle limit', async () => {
    const { port, sockets } = await serve();
    const c = await client(port);
    c.send('POST /x HTTP/1.1\r\nHost: qa\r\nContent-Length: 1048576\r\n\r\nabc');
    await until(() => c.state.data.endsWith('}'), 2000, 'answer');
    const answered = Date.now();
    await until(() => sockets[0].closed, STAGED_CLOSE_LIMITS.idleMs + 2000, 'server close');
    expect(Date.now() - answered).toBeLessThan(STAGED_CLOSE_LIMITS.idleMs + 1500);
  }, 10_000);

  it('a request pipelined behind the unread body is never processed', async () => {
    const { port, sockets } = await serve();
    const c = await client(port);
    c.send('POST /x HTTP/1.1\r\nHost: qa\r\nContent-Length: 4\r\n\r\n');
    await until(() => c.state.data.endsWith('}'), 2000, 'answer');
    c.send('abcdGET /y HTTP/1.1\r\nHost: qa\r\n\r\n');
    await until(() => sockets[0].closed, 4000, 'server close');
    expect((c.state.data.match(/HTTP\/1\.1 /g) ?? []).length).toBe(1);
  });
});

describe('applyServerTimeouts', () => {
  it('sets the three explicit timeouts on a server', () => {
    const s = applyServerTimeouts(http.createServer());
    expect([s.headersTimeout, s.requestTimeout, s.keepAliveTimeout]).toEqual([
      SERVER_TIMEOUTS.headersTimeout,
      SERVER_TIMEOUTS.requestTimeout,
      SERVER_TIMEOUTS.keepAliveTimeout,
    ]);
  });
  it('refuses a header timeout longer than the request timeout', () => {
    expect(() => applyServerTimeouts(http.createServer(), { headersTimeout: 10, requestTimeout: 5, keepAliveTimeout: 1 })).toThrow();
  });
});
