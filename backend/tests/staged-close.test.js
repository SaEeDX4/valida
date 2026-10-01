import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { closeAfterResponseInStages, serveUnlessConnectionClosing, STAGED_CLOSE_LIMITS } from '../src/lib/http/stagedClose.js';
import { startServer } from '../src/server.js';
import { OFFLINE_TEST_MONGODB_URI, capturingLogger, freePort, offlineDatabase } from './helpers.js';
import { PDF_MIME, syntheticPdf } from './fixtures/resumeFiles.js';
import { INTAKE_PATH, buildIntakeApp, createIntakeEnvironment, multipartBody, resumePart } from './fixtures/uploadHarness.js';

/**
 * B4 r3 — staged connection close (RFC 9112 section 9.6), over REAL sockets.
 *
 * A response sent before the request body has been read must reach the
 * client: the server half-closes, reads and discards what the client still
 * sends for that request, and only then closes — so no unread data is left
 * to turn the close into a TCP reset. Every wait below is bounded, and every
 * case checks the server's own byte count against what the client sent.
 *
 * A request pipelined behind the refused body is never processed (RFC 9112
 * section 9.6), even when it arrives in the same TCP read as the end of that
 * body — Node's parser dispatches it regardless, so the server's request
 * listener refuses it before it enters the app, and its body is drained like
 * the rest (found by the independent pre-submission check).
 */
const servers = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

async function eventually(check, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${what} not reached within ${timeoutMs} ms`);
}

/**
 * A server whose handler answers at once — before reading the body — with
 * `Connection: close`, using the staged close with the given limits, served
 * through `serveUnlessConnectionClosing` exactly as src/server.js serves the app.
 */
async function earlyResponder(limits) {
  const log = capturingLogger();
  const handled = [];
  const server = http.createServer(
    serveUnlessConnectionClosing((req, res) => {
      handled.push(req.url);
      closeAfterResponseInStages(req, { limits, logger: log.logger });
      res.writeHead(503, { 'Content-Type': 'application/json', 'Content-Length': 2, Connection: 'close' });
      res.end('{}');
    }),
  );
  const connections = [];
  server.on('connection', (socket) => {
    const record = { closed: false, bytesRead: null, closedAt: null };
    socket.on('close', () => {
      record.closed = true;
      record.bytesRead = socket.bytesRead;
      record.closedAt = Date.now();
    });
    connections.push(record);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const outcome = () => /"outcome":"([A-Z_]+)"/.exec(log.output())?.[1] ?? null;
  const furtherRequests = () => Number(/"furtherRequests":(\d+)/.exec(log.output())?.[1] ?? Number.NaN);
  return { port: server.address().port, handled, connections, outcome, furtherRequests };
}

/** A raw client. `allowHalfOpen` lets it keep its side open after the server's FIN. */
async function rawClient(port, { allowHalfOpen = false } = {}) {
  const socket = net.connect({ port, host: '127.0.0.1', allowHalfOpen });
  const state = { received: [], ended: false, closed: false, errors: [], sent: 0 };
  socket.on('data', (chunk) => state.received.push(chunk));
  socket.on('end', () => {
    state.ended = true;
  });
  socket.on('error', (error) => state.errors.push(error.code));
  socket.on('close', () => {
    state.closed = true;
  });
  await new Promise((resolve) => socket.once('connect', resolve));
  const send = (data) => {
    const bytes = Buffer.from(data);
    state.sent += bytes.length;
    return socket.write(bytes);
  };
  const text = () => Buffer.concat(state.received).toString('latin1');
  return { socket, state, send, text };
}

const head = (declared) => `POST /upload HTTP/1.1\r\nHost: qa\r\nContent-Type: application/octet-stream\r\nContent-Length: ${declared}\r\n\r\n`;

describe('the response is delivered, then the connection is closed in stages', () => {
  it('the client receives the whole response and the FIN while it is still uploading; everything it sent is read first', async () => {
    const server = await earlyResponder(STAGED_CLOSE_LIMITS);
    const client = await rawClient(server.port);
    client.send(head(2 * 1024 * 1024));
    client.send(Buffer.alloc(1024 * 1024, 0x51)); // half the declared body, then nothing more
    await eventually(() => client.text().endsWith('\r\n\r\n{}') && client.state.ended, 2000, 'response and FIN');
    await eventually(() => server.connections[0]?.closed, 2000, 'server close');
    expect(client.text()).toMatch(/^HTTP\/1\.1 503 /);
    expect(client.text()).toMatch(/\r\nConnection: close\r\n/i);
    expect(server.connections[0].bytesRead).toBe(client.state.sent);
    expect(client.state.errors).toEqual([]);
    expect(server.outcome()).toBe('CLIENT_CLOSED');
    client.socket.destroy();
  });

  it('when the client then completes its body, the connection closes', async () => {
    const server = await earlyResponder(STAGED_CLOSE_LIMITS);
    const client = await rawClient(server.port, { allowHalfOpen: true });
    client.send(head(4096));
    client.send(Buffer.alloc(1024, 0x51));
    await eventually(() => client.text().endsWith('\r\n\r\n{}'), 2000, 'response');
    client.send(Buffer.alloc(3072, 0x51)); // the rest of the body
    await eventually(() => server.connections[0]?.closed, 2000, 'server close');
    expect(server.outcome()).toBe('BODY_COMPLETE');
    expect(server.connections[0].bytesRead).toBe(client.state.sent);
    expect(server.handled).toEqual(['/upload']);
    client.socket.destroy();
  });

  it('a request pipelined in the SAME TCP read as the end of the refused body is never processed or answered', async () => {
    const server = await earlyResponder(STAGED_CLOSE_LIMITS);
    const client = await rawClient(server.port);
    // One write: the whole refused request, then a second request behind it.
    client.send(Buffer.concat([Buffer.from(head(1024)), Buffer.alloc(1024, 0x51), Buffer.from('GET /second HTTP/1.1\r\nHost: qa\r\n\r\n')]));
    await eventually(() => server.connections[0]?.closed, 2000, 'server close');
    expect(server.handled).toEqual(['/upload']);
    expect(server.furtherRequests()).toBe(1);
    // A finished body no longer ends the close (more may follow): the client's own close does.
    expect(server.outcome()).toBe('CLIENT_CLOSED');
    expect(server.connections[0].bytesRead).toBe(client.state.sent);
    expect(client.text().match(/HTTP\/1\.1 /g)).toHaveLength(1); // one response: the 503
    expect(client.text()).toMatch(/^HTTP\/1\.1 503 [^]*\r\n\r\n\{\}$/);
    expect(client.state.errors).toEqual([]);
    client.socket.destroy();
  });

  it('a pipelined request WITH a body is refused, and its body is drained too: every byte read, no reset', async () => {
    const server = await earlyResponder(STAGED_CLOSE_LIMITS);
    const client = await rawClient(server.port);
    const second = Buffer.alloc(512 * 1024, 0x52);
    client.send(
      Buffer.concat([
        Buffer.from(head(1024)),
        Buffer.alloc(1024, 0x51),
        Buffer.from(`POST /second HTTP/1.1\r\nHost: qa\r\nContent-Length: ${second.length}\r\n\r\n`),
        second,
      ]),
    );
    await eventually(() => server.connections[0]?.closed, 2000, 'server close');
    expect(server.handled).toEqual(['/upload']);
    expect(server.furtherRequests()).toBe(1);
    expect(server.outcome()).toBe('CLIENT_CLOSED');
    expect(server.connections[0].bytesRead).toBe(client.state.sent);
    expect(client.text().match(/HTTP\/1\.1 /g)).toHaveLength(1);
    expect(client.state.errors).toEqual([]);
    client.socket.destroy();
  });

  it('a request pipelined in a LATER write is not processed either', async () => {
    const server = await earlyResponder(STAGED_CLOSE_LIMITS);
    const client = await rawClient(server.port, { allowHalfOpen: true });
    client.send(head(4096));
    client.send(Buffer.alloc(1024, 0x51));
    await eventually(() => client.text().endsWith('\r\n\r\n{}'), 2000, 'response');
    client.send(Buffer.alloc(3072, 0x51));
    client.send('GET /second HTTP/1.1\r\nHost: qa\r\n\r\n');
    client.socket.end();
    await eventually(() => server.connections[0]?.closed, 2000, 'server close');
    expect(server.handled).toEqual(['/upload']);
    // Whether the body's end or the client's close ends it depends on how the reads fall; both are safe.
    expect(['BODY_COMPLETE', 'CLIENT_CLOSED']).toContain(server.outcome());
    expect(client.text().match(/HTTP\/1\.1 /g)).toHaveLength(1);
    client.socket.destroy();
  });

  it('a client that keeps its side open and sends nothing more is closed after the idle bound — with nothing left unread', async () => {
    const server = await earlyResponder({ ...STAGED_CLOSE_LIMITS, idleMs: 200, maxMs: 3000 });
    const client = await rawClient(server.port, { allowHalfOpen: true });
    client.send(head(1024 * 1024));
    client.send(Buffer.alloc(64 * 1024, 0x51));
    const started = Date.now();
    await eventually(() => server.connections[0]?.closed, 2000, 'server close');
    expect(Date.now() - started).toBeLessThan(1500);
    expect(server.outcome()).toBe('IDLE');
    expect(server.connections[0].bytesRead).toBe(client.state.sent);
    expect(client.text()).toMatch(/^HTTP\/1\.1 503 /);
    client.socket.destroy();
  });

  it('a client that keeps trickling data is closed at the total time bound', async () => {
    const server = await earlyResponder({ ...STAGED_CLOSE_LIMITS, idleMs: 300, maxMs: 600 });
    const client = await rawClient(server.port, { allowHalfOpen: true });
    client.send(head(10 * 1024 * 1024));
    const trickle = setInterval(() => {
      if (!client.state.closed) client.send(Buffer.alloc(16, 0x51));
    }, 50);
    try {
      await eventually(() => server.connections[0]?.closed, 2000, 'server close');
    } finally {
      clearInterval(trickle);
    }
    expect(server.outcome()).toBe('MAX_TIME');
    expect(client.text()).toMatch(/^HTTP\/1\.1 503 /);
    client.socket.destroy();
  });

  it('a client that sends more than the byte bound is cut off at once', async () => {
    const server = await earlyResponder({ ...STAGED_CLOSE_LIMITS, maxBytes: 256 * 1024, idleMs: 2000, maxMs: 4000 });
    const client = await rawClient(server.port, { allowHalfOpen: true });
    client.send(head(8 * 1024 * 1024));
    const block = Buffer.alloc(64 * 1024, 0x51);
    for (let index = 0; index < 32 && !client.state.closed; index += 1) {
      client.send(block);
      await new Promise((resolve) => setImmediate(resolve));
    }
    await eventually(() => server.connections[0]?.closed, 2000, 'server close');
    expect(server.connections[0].bytesRead).toBeLessThan(2 * 1024 * 1024);
    expect(server.outcome()).toBe('OVER_LIMIT'); // logged like every other outcome
    client.socket.destroy();
  });

  it('is not armed when the request body has already been read (nothing is left unread)', async () => {
    const results = [];
    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        results.push(closeAfterResponseInStages(req));
        res.writeHead(503, { 'Content-Length': 0, Connection: 'close' });
        res.end();
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    const client = await rawClient(server.address().port);
    client.send(`${head(4)}QA!!`);
    await eventually(() => client.state.closed, 2000, 'close');
    expect(results).toEqual([false]);
    expect(client.text()).toMatch(/^HTTP\/1\.1 503 /);
  });
});

describe('the upload refusals use it', () => {
  it('a 413 for a declared length over the limit is delivered, and the bytes already sent are read before closing', async () => {
    const log = capturingLogger();
    const env = await createIntakeEnvironment({ logger: log.logger });
    const { app } = buildIntakeApp({ storage: env.storage, uploadArea: env.uploadArea, logger: log.logger });
    const server = http.createServer(app);
    const connections = [];
    server.on('connection', (socket) => {
      const record = { closed: false, bytesRead: null };
      socket.on('close', () => {
        record.closed = true;
        record.bytesRead = socket.bytesRead;
      });
      connections.push(record);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    try {
      const client = await rawClient(server.address().port);
      client.send(
        `POST ${INTAKE_PATH} HTTP/1.1\r\nHost: qa\r\nContent-Type: multipart/form-data; boundary=qa\r\n` +
          `Content-Length: ${50 * 1024 * 1024}\r\n\r\n`,
      );
      client.send(Buffer.alloc(256 * 1024, 0x51)); // the start of a body the server will never accept
      await eventually(() => /\r\n\r\n\{.*\}$/s.test(client.text()) && client.state.ended, 2000, 'response and FIN');
      await eventually(() => connections[0]?.closed, 2000, 'server close');
      expect(client.text()).toMatch(/^HTTP\/1\.1 413 /);
      expect(client.text()).toContain('"code":"PAYLOAD_TOO_LARGE"');
      expect(connections[0].bytesRead).toBe(client.state.sent);
      expect(client.state.errors).toEqual([]);
      expect(env.storedObjects()).toEqual([]);
      expect(env.tempFiles()).toEqual([]);
      client.socket.destroy();
    } finally {
      await env.cleanup();
    }
  });

  it('a complete, valid upload pipelined behind a refused (413) body never reaches the route: nothing is stored, one response', async () => {
    const log = capturingLogger();
    const env = await createIntakeEnvironment({ logger: log.logger });
    const { app, captured } = buildIntakeApp({ storage: env.storage, uploadArea: env.uploadArea, logger: log.logger });
    const server = http.createServer(serveUnlessConnectionClosing(app)); // as src/server.js does
    const sockets = [];
    server.on('connection', (socket) => sockets.push(socket));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    try {
      const client = await rawClient(server.address().port, { allowHalfOpen: true });
      // Request 1 declares 6 MiB: over the upload limit (413 at once), under the drain bound (8 MiB).
      const declared = 6 * 1024 * 1024;
      client.send(
        `POST ${INTAKE_PATH} HTTP/1.1\r\nHost: qa\r\nContent-Type: multipart/form-data; boundary=qa\r\n` +
          `Content-Length: ${declared}\r\n\r\n`,
      );
      const tail = 4096;
      client.send(Buffer.alloc(declared - tail, 0x51));
      await eventually(() => sockets[0]?.bytesRead === client.state.sent, 3000, 'server read up to the tail');
      // The end of request 1 and a complete, valid upload in ONE write.
      const { body, contentType } = multipartBody([resumePart(syntheticPdf(), 'synthetic.pdf', PDF_MIME)]);
      client.send(
        Buffer.concat([
          Buffer.alloc(tail, 0x51),
          Buffer.from(`POST ${INTAKE_PATH} HTTP/1.1\r\nHost: qa\r\nContent-Type: ${contentType}\r\nContent-Length: ${body.length}\r\n\r\n`),
          body,
        ]),
      );
      client.socket.end(); // nothing more: the client closes its side
      await eventually(() => sockets[0].destroyed, 3000, 'server close');
      // Time for a wrongly dispatched upload to reach storage (it takes ~70 ms here without the guard).
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(client.text()).toMatch(/^HTTP\/1\.1 413 /);
      expect(client.text().match(/HTTP\/1\.1 /g)).toHaveLength(1);
      expect(captured).toEqual([]);
      expect(env.storedObjects()).toEqual([]);
      expect(env.tempFiles()).toEqual([]);
      expect(/"outcome":"([A-Z_]+)"/.exec(log.output())?.[1]).toBe('CLIENT_CLOSED');
      expect(log.output()).toContain('"furtherRequests":1');
      expect(sockets[0].bytesRead).toBe(client.state.sent); // the refused upload's body was drained too
      client.socket.destroy();
    } finally {
      await env.cleanup();
    }
  });

  it('the production server (startServer) serves the app through that guard, and still answers normally', async () => {
    const port = await freePort();
    const handle = await startServer({
      env: {
        NODE_ENV: 'test',
        APP_ENV: 'local',
        PORT: String(port),
        LOG_LEVEL: 'silent',
        CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
        MONGODB_URI: OFFLINE_TEST_MONGODB_URI,
      },
      database: offlineDatabase(),
    });
    try {
      const listeners = handle.server.listeners('request');
      expect(listeners).toHaveLength(1);
      expect(listeners[0].name).toBe('serveUnlessConnectionClosingListener');
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
      expect(response.status).toBe(200);
    } finally {
      await handle.shutdown('test cleanup');
    }
  });
});
