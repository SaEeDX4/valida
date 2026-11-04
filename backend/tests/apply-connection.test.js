import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { serveUnlessConnectionClosing } from '../src/lib/http/stagedClose.js';
import { PDF_MIME, syntheticPdf, syntheticPdfOfSize } from './fixtures/resumeFiles.js';
import { multipartBody, resumePart } from './fixtures/uploadHarness.js';
import { QA_CANDIDATE, applyPath, createApplyEnvironment, qaAnswers } from './fixtures/applyHarness.js';

/**
 * B5 — the Apply route at the CONNECTION level, over real sockets, served the
 * way src/server.js serves the app: http.createServer(serveUnlessConnectionClosing(app)).
 *
 * 1. Answers given BEFORE the upload is read (no/invalid Idempotency-Key, the
 *    Apply rate limit, storage not configured) close the connection in stages
 *    (B4 r3): the client receives the whole answer and every byte it sent is
 *    read before the close — no TCP reset.
 * 2. A request pipelined AFTER such a refusal was decided never reaches the
 *    app (the B4 guard).
 * 3. The B4 guard's documented limit: a request pipelined so closely that Node
 *    dispatches it BEFORE the refusal is decided is an ordinary pipelined
 *    request. Its B5 side effects are checked here: at most one Application
 *    for its key, no orphaned object, no temporary file, and a retry with the
 *    same key converges on exactly one Application.
 */
let env;
let server;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
  await env?.cleanup();
  env = undefined;
});

async function serve(options) {
  env = await createApplyEnvironment(options);
  server = http.createServer(serveUnlessConnectionClosing(env.app));
  const sockets = [];
  server.on('connection', (socket) => {
    const record = { socket, closed: false, bytesRead: null };
    socket.on('close', () => {
      record.closed = true;
      record.bytesRead = socket.bytesRead;
    });
    sockets.push(record);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: server.address().port, sockets };
}

async function eventually(check, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${what} not reached within ${timeoutMs} ms`);
}

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
  return {
    socket,
    state,
    send(data) {
      const bytes = Buffer.from(data);
      state.sent += bytes.length;
      return socket.write(bytes);
    },
    text: () => Buffer.concat(state.received).toString('latin1'),
  };
}

/** The bytes of one Apply request. */
function applyBytes({ slug = 'qa-synthetic-apply-role', key = randomUUID(), pdf = syntheticPdf(), fields = {} } = {}) {
  const { body, contentType } = multipartBody([
    { name: 'fullName', value: fields.fullName ?? QA_CANDIDATE.fullName },
    { name: 'email', value: fields.email ?? QA_CANDIDATE.email },
    { name: 'screeningAnswers', value: JSON.stringify(qaAnswers()) },
    resumePart(pdf, 'qa-resume.pdf', PDF_MIME),
  ]);
  const head =
    `POST ${applyPath(slug)} HTTP/1.1\r\nHost: qa\r\nContent-Type: ${contentType}\r\n` +
    (key === null ? '' : `Idempotency-Key: ${key}\r\n`) +
    `Content-Length: ${body.length}\r\n\r\n`;
  return { bytes: Buffer.concat([Buffer.from(head), body]), key };
}

const statusLines = (text) => text.match(/HTTP\/1\.1 \d{3}/g) ?? [];

describe('answers given before the upload is read are delivered, then the connection closes in stages', () => {
  it.each([
    ['no Idempotency-Key', {}, { key: null }, 400, 'IDEMPOTENCY_KEY_REQUIRED'],
    ['storage not configured', { withStorage: false }, {}, 503, 'SERVICE_UNAVAILABLE'],
  ])('%s: the %s answer arrives and every uploaded byte is read before the close', async (_label, options, request, status, code) => {
    const { port, sockets } = await serve(options);
    const client = await rawClient(port);
    // A 2 MiB upload, sent while the server has already answered.
    const { bytes } = applyBytes({ ...request, pdf: syntheticPdfOfSize(2 * 1024 * 1024) });
    client.send(bytes);
    await eventually(() => /\r\n\r\n\{.*\}$/s.test(client.text()) && client.state.ended, 3000, 'answer and FIN');
    await eventually(() => sockets[0]?.closed, 3000, 'server close');
    expect(client.text()).toMatch(new RegExp(`^HTTP/1\\.1 ${status} `));
    expect(client.text()).toMatch(/\r\nConnection: close\r\n/i);
    expect(client.text()).toContain(`"code":"${code}"`);
    expect(sockets[0].bytesRead).toBe(client.state.sent); // nothing left unread: no reset
    expect(client.state.errors).toEqual([]);
    expect(env.applications.all()).toEqual([]);
    expect(env.tempFiles()).toEqual([]);
  });

  it('the Apply rate limit: 429 delivered, upload read, connection closed', async () => {
    const { port, sockets } = await serve({ configOverrides: { applicationRateLimit: Object.freeze({ windowMs: 900_000, max: 1 }) } });
    const first = await rawClient(port);
    first.send(applyBytes().bytes);
    await eventually(() => statusLines(first.text()).length === 1, 3000, 'first answer');
    expect(first.text()).toMatch(/^HTTP\/1\.1 201 /);
    first.socket.destroy();

    const limited = await rawClient(port);
    limited.send(applyBytes({ pdf: syntheticPdfOfSize(1024 * 1024) }).bytes);
    await eventually(() => limited.state.ended, 3000, 'FIN');
    await eventually(() => sockets[1]?.closed, 3000, 'server close');
    expect(limited.text()).toMatch(/^HTTP\/1\.1 429 /);
    expect(limited.text()).toContain('"code":"RATE_LIMITED"');
    expect(sockets[1].bytesRead).toBe(limited.state.sent);
    expect(env.applications.all()).toHaveLength(1);
  });

});

/**
 * The GENERAL public rate limit (B1, app-wide) in front of the Apply route,
 * through the production request listener with an UNREAD multipart body.
 *
 * B7 (the body-discard issue): until B7 this 429 was sent with the connection
 * kept open and Node read and discarded the rest of the body bounded only by
 * its requestTimeout (300 s by default) or the client — measured here as a
 * DOCUMENTED LIMITATION. Since B7 every answer given before the body has
 * arrived closes the connection in stages, server-wide
 * (lib/http/stagedClose.js, closeEarlyAnswersInStages): the answer is
 * delivered, the rest of the body is read within the staged-close bounds
 * (8 MiB, 2 s idle, 5 s in total), and nothing behind it is processed.
 */
describe('the GENERAL rate limit on an Apply upload — B7: closed in stages', () => {
  const limitedServe = (windowMs = 60_000) => serve({ configOverrides: { rateLimit: Object.freeze({ windowMs, max: 1 }) } });

  /** Uses the single general-limit allowance with one accepted Application. */
  async function spendAllowance(port) {
    const first = await rawClient(port);
    first.send(applyBytes().bytes);
    await eventually(() => statusLines(first.text()).length === 1, 3000, 'first answer');
    expect(first.text()).toMatch(/^HTTP\/1\.1 201 /);
    first.socket.destroy();
  }

  it('the client receives the complete 429 (no reset), every uploaded byte is read, then the connection closes; nothing created, no temporary file', async () => {
    const { port, sockets } = await limitedServe();
    await spendAllowance(port);
    const limited = await rawClient(port);
    limited.send(applyBytes({ pdf: syntheticPdfOfSize(2 * 1024 * 1024) }).bytes);
    await eventually(() => /\r\n\r\n\{.*\}$/s.test(limited.text()) && limited.state.ended, 3000, 'the 429 and FIN');
    await eventually(() => sockets[1]?.closed, 3000, 'server close');
    expect(sockets[1].bytesRead).toBe(limited.state.sent); // nothing left unread: no reset
    expect(limited.text()).toMatch(/^HTTP\/1\.1 429 /);
    expect(limited.text()).toContain('"code":"RATE_LIMITED"');
    expect(limited.text()).toMatch(/\r\nCache-Control: no-store\r\n/i);
    expect(limited.text()).toMatch(/\r\nConnection: close\r\n/i);
    expect(limited.state.errors).toEqual([]);
    expect(env.applications.all()).toHaveLength(1);
    expect(env.storedObjects()).toHaveLength(1);
    expect(env.tempFiles()).toEqual([]);
  });

  it('a valid Application pipelined directly behind the refused body is never processed and gets no answer: no side effect', async () => {
    const { port, sockets } = await limitedServe();
    await spendAllowance(port);
    const client = await rawClient(port);
    client.send(Buffer.concat([applyBytes({ pdf: syntheticPdfOfSize(1024 * 1024) }).bytes, applyBytes().bytes]));
    await eventually(() => client.state.ended, 3000, 'FIN');
    await eventually(() => sockets[1]?.closed, 6000, 'server close');
    expect(statusLines(client.text())).toEqual(['HTTP/1.1 429']);
    expect(env.applications.all()).toHaveLength(1);
    expect(env.storedObjects()).toHaveLength(1);
    expect(env.tempFiles()).toEqual([]);
  });

  it('once the window has passed, a new Application on a NEW connection is an ordinary request — accepted once', async () => {
    const windowMs = 3_000;
    const { port, sockets } = await limitedServe(windowMs);
    const windowStarted = Date.now();
    await spendAllowance(port);
    const client = await rawClient(port);
    client.send(applyBytes({ pdf: syntheticPdfOfSize(1024 * 1024) }).bytes);
    await eventually(() => statusLines(client.text()).length === 1 && client.state.ended, 3000, 'the 429 and FIN');
    await eventually(() => sockets[1]?.closed, 3000, 'server close');
    expect(statusLines(client.text())).toEqual(['HTTP/1.1 429']);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, windowStarted + windowMs + 300 - Date.now())));
    const next = await rawClient(port);
    next.send(applyBytes().bytes);
    await eventually(() => statusLines(next.text()).length === 1 && /\}$/.test(next.text()), 3000, 'the answer');
    expect(statusLines(next.text())).toEqual(['HTTP/1.1 201']);
    expect(env.applications.all()).toHaveLength(2);
    expect(env.storedObjects()).toHaveLength(2);
    expect(env.tempFiles()).toEqual([]);
    next.socket.destroy();
  }, 15_000);

  it('B7 BOUND (was the documented limitation): an unread body after this 429 is read only within the staged-close bounds (8 MiB, 5 s), then the connection is closed; nothing is kept', async () => {
    const { port, sockets } = await limitedServe();
    await spendAllowance(port);
    const outcome = await trickleAfterEarlyAnswer(port, sockets, 1, (contentType, length) =>
      `POST ${applyPath('qa-synthetic-apply-role')} HTTP/1.1\r\nHost: qa\r\nContent-Type: ${contentType}\r\nIdempotency-Key: ${randomUUID()}\r\nContent-Length: ${length}\r\n\r\n`,
    );
    expect(outcome.status).toBe('HTTP/1.1 429');
    expect(outcome.connectionClose).toBe(true);
    expect(outcome.serverReadBeyondStagedCap).toBe(false);
    expect(outcome.closedWithinStagedMaxMs).toBe(true);
    expect(env.applications.all()).toHaveLength(1);
    expect(env.storedObjects()).toHaveLength(1);
    expect(env.tempFiles()).toEqual([]);
  }, 20_000);
});

/**
 * Sends the head of a request declaring a 64 MiB body, then 9 MiB at once
 * (over the staged-close byte cap) and 128 KiB every 500 ms until 5.5 s have
 * passed (over its 5 s time cap); reports what the server did.
 */
async function trickleAfterEarlyAnswer(port, sockets, socketIndex, head) {
  const client = await rawClient(port);
  const { contentType } = multipartBody([{ name: 'fullName', value: 'QA' }]);
  client.send(head(contentType, 64 * 1024 * 1024));
  await eventually(() => statusLines(client.text()).length === 1, 3000, 'the early answer');
  const started = Date.now();
  client.send(Buffer.alloc(9 * 1024 * 1024, 0x51));
  while (Date.now() - started < 5_500) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (client.state.closed || sockets[socketIndex].closed) break;
    client.send(Buffer.alloc(128 * 1024, 0x51));
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  const server = sockets[socketIndex];
  const outcome = {
    status: statusLines(client.text())[0],
    connectionClose: /\r\nConnection: close\r\n/i.test(client.text()),
    // Without the bound the server would read the 9 MiB burst PLUS the trickled chunks.
    serverReadBeyondStagedCap: server.socket.bytesRead >= 9 * 1024 * 1024 + 3 * 128 * 1024,
    closedWithinStagedMaxMs: server.closed && Date.now() - started <= 5_000 + 1_500,
  };
  client.socket.destroy();
  return outcome;
}

describe('B7 — the same bound server-wide, for every early answer (was: discarded without bounds)', () => {
  it.each([
    ['an unknown API route (B1 404)', () => `/api/v1/qa-unknown-route`, 'HTTP/1.1 404'],
    ['the Apply route with a non-multipart body (B4 415)', () => applyPath('qa-synthetic-apply-role'), 'HTTP/1.1 415'],
  ])('%s: the unread body is read only within the staged-close bounds, then the connection is closed', async (_label, pathOf, status) => {
    const { port, sockets } = await serve({});
    const outcome = await trickleAfterEarlyAnswer(port, sockets, 0, (contentType, length) =>
      `POST ${pathOf()} HTTP/1.1\r\nHost: qa\r\nContent-Type: ${status.endsWith('415') ? 'application/octet-stream' : contentType}\r\nIdempotency-Key: ${randomUUID()}\r\nContent-Length: ${length}\r\n\r\n`,
    );
    expect(outcome.status).toBe(status);
    expect(outcome.connectionClose).toBe(true);
    expect(outcome.serverReadBeyondStagedCap).toBe(false);
    expect(outcome.closedWithinStagedMaxMs).toBe(true);
    expect(env.applications.all()).toEqual([]);
    expect(env.tempFiles()).toEqual([]);
  }, 20_000);
});

describe('pipelined requests', () => {
  it('a valid Application pipelined AFTER an over-limit upload was refused is never processed (B4 guard)', async () => {
    const { port, sockets } = await serve({});
    const client = await rawClient(port, { allowHalfOpen: true });
    // Request 1 declares 6 MiB: over the Apply limit -> 413 before its body is read (close armed).
    const declared = 6 * 1024 * 1024;
    const { body, contentType } = multipartBody([resumePart(syntheticPdf(), 'qa.pdf', PDF_MIME)]);
    client.send(
      `POST ${applyPath('qa-synthetic-apply-role')} HTTP/1.1\r\nHost: qa\r\nContent-Type: ${contentType}\r\n` +
        `Idempotency-Key: ${randomUUID()}\r\nContent-Length: ${declared}\r\n\r\n`,
    );
    await eventually(() => statusLines(client.text()).length === 1, 3000, 'the 413');
    expect(client.text()).toMatch(/^HTTP\/1\.1 413 /);
    // The rest of request 1, then a complete valid Application, in one write.
    const filler = Buffer.alloc(declared - body.length, 0x51);
    client.send(Buffer.concat([body, filler, applyBytes().bytes]));
    client.socket.end();
    await eventually(() => sockets[0]?.closed, 5000, 'server close');
    await env.submission.drainFollowUps();
    expect(statusLines(client.text())).toEqual(['HTTP/1.1 413']);
    expect(env.applications.all()).toEqual([]);
    expect(env.storedObjects()).toEqual([]);
    expect(env.tempFiles()).toEqual([]);
  });

  it('DOCUMENTED LIMIT: a valid Application dispatched BEFORE the preceding refusal is decided is an ordinary pipelined request — at most one Application for its key, no orphan, no temp file; a retry converges', async () => {
    const { port } = await serve({});
    const client = await rawClient(port);
    // Request A: no Idempotency-Key (refused after the async rate limiter runs).
    // Request B: a complete valid Application. One write: Node parses B in the
    // same read and dispatches it before A's refusal arms the staged close.
    const a = applyBytes({ key: null });
    const b = applyBytes({ pdf: syntheticPdf({ text: 'QA TEST DOCUMENT - PIPELINED B' }) });
    client.send(Buffer.concat([a.bytes, b.bytes]));
    await eventually(() => client.state.closed, 5000, 'connection end');
    // Let B's processing settle, whatever happened to its socket.
    await eventually(() => env.tempFiles().length === 0, 5000, 'temporary files released');
    await new Promise((resolve) => setTimeout(resolve, 200));
    await env.submission.drainFollowUps();

    const lines = statusLines(client.text());
    expect(lines[0]).toBe('HTTP/1.1 400'); // A's refusal is always delivered first (responses are ordered)
    const forB = env.applications.all();
    expect(forB.length).toBeLessThanOrEqual(1); // B: never more than one Application
    expect(env.storedObjects()).toHaveLength(forB.length); // every stored object is referenced: no orphan
    expect(env.tempFiles()).toEqual([]);

    // The client retries B (same key) on a new connection: exactly one Application in the end.
    const retry = await rawClient(port);
    retry.send(b.bytes);
    await eventually(() => statusLines(retry.text()).length === 1, 5000, 'retry answer');
    const retryStatus = statusLines(retry.text())[0];
    expect(['HTTP/1.1 201', 'HTTP/1.1 200']).toContain(retryStatus);
    if (forB.length === 1) expect(retryStatus).toBe('HTTP/1.1 200'); // it had been accepted: replayed
    expect(env.applications.all()).toHaveLength(1);
    expect(env.storedObjects()).toHaveLength(1);
    retry.socket.destroy();
  });
});
