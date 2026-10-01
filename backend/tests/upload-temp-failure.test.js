import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { capturingLogger } from './helpers.js';
import { TempUploadArea } from '../src/lib/multipart/tempUploadArea.js';
import { PDF_MIME, syntheticPdf, syntheticPdfOfSize } from './fixtures/resumeFiles.js';
import {
  INTAKE_PATH, buildIntakeApp, createIntakeEnvironment, listFiles, makeTestRoot, multipartBody, removeTestRoot, resumePart,
} from './fixtures/uploadHarness.js';

/**
 * B4 review r1, FINDING 3 — temporary-storage failures during an upload.
 *
 * r1 noticed a failed temporary-file write only when the multipart parser
 * emitted 'finish' — which never comes once the failed pipeline has
 * destroyed the parser's file stream — so the request HUNG (no response
 * within 5 s, the temporary file still owned). A reservation failure (the
 * area and its parent gone) surfaced as 400 MALFORMED_REQUEST: a server-side
 * filesystem problem blamed on the client.
 *
 * Here, over a REAL listening socket, the client sends the upload and then
 * simply WAITS: it never closes, never aborts, and never sends the closing
 * boundary, so neither a client abort nor the parser finishing can be what
 * settles the request. The server must answer on its own, promptly, with the
 * canonical 503, close the connection (the unread body is never parsed as a
 * request), leave nothing stored and no temporary file behind, log a bounded
 * reason — and the next upload, once the condition is gone, must succeed.
 *
 * HOW THE RESPONSE IS READ (r3). The client reads the response the way HTTP
 * frames it — the header block, then exactly Content-Length body bytes — and
 * records every socket event (data, the server's FIN, errors such as a TCP
 * reset, close). If the response does not arrive, the failure message
 * carries those events, the bytes received and the server's own logged
 * outcome (fixed tokens only; no paths), so a run on any platform shows
 * whether the server answered and how the connection ended.
 *
 * STAGED CLOSE (r3). The Windows run of r2 did not receive these 503s at
 * all. On Linux, the kernel's TCPAbortOnClose counter shows why: r2 closed the
 * socket while most of the upload was still unread, which makes the TCP
 * stack send a reset — and a reset may erase a response the client has not
 * read yet (RFC 9112 section 9.6). Linux clients keep it; the Windows run
 * lost it. The server now half-closes, reads and discards the rest of the
 * request, then closes (lib/http/stagedClose.js). Each case therefore also
 * asserts that the server had read EVERY byte the client sent before its
 * socket closed — the condition under which no reset is sent, on any OS.
 *
 * Failures are produced two ways:
 *   - REAL filesystem conditions: the area directory replaced by a regular
 *     file, removed together with its parent, or replaced by a link
 *     (a symbolic link on Linux/macOS, a junction on Windows);
 *   - an asynchronous ENOSPC from the temporary-file writer, injected at the
 *     fs.createWriteStream boundary exactly as the review reproduced it (a
 *     full disk cannot be produced portably in a unit test). Injection
 *     simulates the error; it is not evidence that a disk filled up.
 */
const PROMPT_MS = 2000;

let env;
let log;
let server;
let port;
/** Server-side view of each connection: how many request bytes it had read when it closed. */
let serverConnections;

beforeEach(async () => {
  log = capturingLogger();
  env = await createIntakeEnvironment({ logger: log.logger });
  const { app } = buildIntakeApp({ storage: env.storage, uploadArea: env.uploadArea, logger: log.logger });
  server = http.createServer(app);
  serverConnections = [];
  server.on('connection', (socket) => {
    const record = { closed: false, bytesReadAtClose: null };
    socket.on('close', () => {
      record.closed = true;
      record.bytesReadAtClose = socket.bytesRead;
    });
    serverConnections.push(record);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  ({ port } = server.address());
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await env.cleanup();
});

async function eventually(check, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition not reached in time');
}

/** The response as HTTP frames it: the header block, then Content-Length body bytes. */
function parseResponse(bytes) {
  const text = bytes.toString('latin1');
  const split = text.indexOf('\r\n\r\n');
  if (split === -1) return { complete: false, statusLine: text.split('\r\n')[0] || null };
  const head = text.slice(0, split);
  const contentLength = Number(/\r\ncontent-length:[ \t]*(\d+)/i.exec(head)?.[1] ?? Number.NaN);
  const body = bytes.subarray(Buffer.byteLength(head, 'latin1') + 4);
  return {
    complete: Number.isInteger(contentLength) && body.length >= contentLength,
    statusLine: head.split('\r\n')[0],
    head,
    contentLength,
    body: body.subarray(0, Number.isInteger(contentLength) ? contentLength : body.length).toString('utf8'),
    bodyBytes: body.length,
  };
}

/**
 * Sends a resume upload WITHOUT its closing boundary, declaring the full
 * length, and keeps the connection open: the request can only end if the
 * server ends it. Returns the framed response plus a bounded record of what
 * happened on both ends of the connection.
 */
async function sendAndWait(data = syntheticPdfOfSize(1024 * 1024)) {
  const { body } = multipartBody([resumePart(data, 'synthetic.pdf', PDF_MIME)], { boundary: 'qa-temp-failure', close: false });
  const closing = Buffer.from('--qa-temp-failure--\r\n');
  const head = Buffer.from(
    `POST ${INTAKE_PATH} HTTP/1.1\r\nHost: 127.0.0.1\r\n` +
      'Content-Type: multipart/form-data; boundary=qa-temp-failure\r\n' +
      `Content-Length: ${body.length + closing.length}\r\n\r\n`,
  );
  const socket = net.connect(port, '127.0.0.1');
  const received = [];
  const events = [];
  const started = Date.now();
  const note = (event) => {
    if (events.length < 20) events.push({ ms: Date.now() - started, ...event });
  };
  let serverEnded = false;
  let closed = false;
  socket.on('data', (chunk) => {
    received.push(chunk);
    note({ event: 'data', bytes: chunk.length });
  });
  socket.on('end', () => {
    serverEnded = true;
    note({ event: 'end (server FIN)' });
  });
  // An error here (a TCP reset, typically) is recorded, never thrown: the
  // assertions below decide whether the exchange was acceptable.
  socket.on('error', (error) => note({ event: 'error', code: error.code }));
  socket.on('close', () => {
    closed = true;
    note({ event: 'close' });
  });
  await new Promise((resolve) => socket.once('connect', resolve));
  socket.write(head);
  socket.write(body);
  const clientBytesSent = head.length + body.length;

  const response = () => parseResponse(Buffer.concat(received));
  const diagnostics = () =>
    JSON.stringify({
      elapsedMs: Date.now() - started,
      clientBytesSent,
      bytesReceived: received.reduce((total, chunk) => total + chunk.length, 0),
      statusLine: response().statusLine?.slice(0, 60) ?? null,
      contentLength: response().contentLength ?? null,
      bodyBytesReceived: response().bodyBytes ?? 0,
      clientEvents: events,
      serverLogged: log
        .output()
        .split('\n')
        .filter((line) => line.includes('"reason"'))
        .map((line) => {
          const entry = JSON.parse(line);
          return { status: entry.status, code: entry.code, reason: entry.reason };
        })
        .slice(0, 5),
      serverConnections: serverConnections.map(({ closed: done, bytesReadAtClose }) => ({ closed: done, bytesReadAtClose })),
    });

  try {
    await eventually(() => response().complete, PROMPT_MS);
  } catch {
    throw new Error(`no complete HTTP response within ${PROMPT_MS} ms: ${diagnostics()}`);
  }
  const elapsedMs = Date.now() - started;
  // The server, not the client, ends the connection: its FIN, then the close
  // (this client closes its side when it sees the FIN).
  try {
    await eventually(() => serverEnded && closed && serverConnections.every((connection) => connection.closed), PROMPT_MS);
  } catch {
    throw new Error(`the connection was not closed by the server within ${PROMPT_MS} ms: ${diagnostics()}`);
  }
  socket.destroy();
  const { head: responseHead, body: responseBody, statusLine } = response();
  return {
    response: `${responseHead}\r\n\r\n${responseBody}`,
    statusLine,
    elapsedMs,
    clientBytesSent,
    serverBytesRead: serverConnections[0]?.bytesReadAtClose ?? null,
    clientErrors: events.filter((entry) => entry.event === 'error').map((entry) => entry.code),
    diagnostics: diagnostics(),
  };
}

/** A complete, ordinary upload on a fresh connection. */
function uploadNormally(data = syntheticPdf()) {
  const { body, contentType } = multipartBody([resumePart(data, 'synthetic.pdf', PDF_MIME)]);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method: 'POST', path: INTAKE_PATH, headers: { 'content-type': contentType, 'content-length': body.length } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

function expect503(result, reason) {
  expect(result.response).toMatch(/^HTTP\/1\.1 503 /);
  expect(result.response).toMatch(/\r\nConnection: close\r\n/i);
  expect(result.response).toContain('"code":"SERVICE_UNAVAILABLE"');
  expect(result.response).not.toContain('MALFORMED_REQUEST');
  expect(result.response).not.toContain(env.root);
  expect(result.elapsedMs).toBeLessThan(PROMPT_MS);
  expect(log.output()).toContain(`"reason":"${reason}"`);
  // Staged close (RFC 9112 section 9.6): the server read everything the
  // client sent before closing, so no TCP reset could erase the response; and
  // the client saw no connection error.
  expect(result.serverBytesRead, result.diagnostics).toBe(result.clientBytesSent);
  expect(result.clientErrors, result.diagnostics).toEqual([]);
}

const nothingKept = () => {
  expect(env.storedObjects()).toEqual([]);
  expect(env.uploadArea.ownedCount).toBe(0);
};

/**
 * Makes every temporary upload writer fail asynchronously with `code` after
 * `afterWrites` successful writes — the review's reproduction method.
 */
function injectTempWriteFailure({ code = 'ENOSPC', afterWrites = 0 } = {}) {
  const original = fs.createWriteStream;
  let injected = 0;
  fs.createWriteStream = function createWriteStreamWithFault(target, options) {
    const stream = original.call(fs, target, options);
    if (typeof target === 'string' && /[\\/]up-[0-9a-f]{32}\.part$/.test(target)) {
      injected += 1;
      let writes = 0;
      const failSoon = (callback) =>
        setImmediate(() => callback(Object.assign(new Error('QA injected temporary-file failure'), { code })));
      const write = stream._write.bind(stream);
      const writev = stream._writev.bind(stream);
      stream._write = (chunk, encoding, callback) =>
        writes++ >= afterWrites ? failSoon(callback) : write(chunk, encoding, callback);
      stream._writev = (chunks, callback) => (writes++ >= afterWrites ? failSoon(callback) : writev(chunks, callback));
    }
    return stream;
  };
  return { restore: () => (fs.createWriteStream = original), injected: () => injected };
}

describe('the temporary file cannot be written: an asynchronous ENOSPC from its writer', () => {
  it.each([
    ['on its first write', 0],
    ['in the middle of the file', 3],
  ])('%s -> a prompt 503, connection closed, temporary file removed, nothing stored', async (_label, afterWrites) => {
    const fault = injectTempWriteFailure({ afterWrites });
    let result;
    try {
      result = await sendAndWait();
    } finally {
      fault.restore();
    }
    expect(fault.injected()).toBe(1);
    expect503(result, 'UPLOAD_TEMP_WRITE_FAILED');
    nothingKept();
    await eventually(() => env.tempFiles().length === 0);
  });

  it('the next upload, with the disk healthy again, is accepted and stored', async () => {
    const fault = injectTempWriteFailure();
    try {
      expect503(await sendAndWait(), 'UPLOAD_TEMP_WRITE_FAILED');
    } finally {
      fault.restore();
    }
    expect(await uploadNormally()).toBe(201);
    expect(env.storedObjects()).toHaveLength(1);
    expect(env.uploadArea.ownedCount).toBe(0);
  });

  it('a cleanup failure after the write failure is logged as a bounded event; the response is still prompt, and close() retries', async () => {
    const fault = injectTempWriteFailure();
    const originalRm = fsp.rm;
    fsp.rm = async (target, options) => {
      if (/[\\/]up-[0-9a-f]{32}\.part$/.test(String(target))) {
        throw Object.assign(new Error('QA injected cleanup failure'), { code: 'EBUSY' });
      }
      return originalRm(target, options);
    };
    let result;
    try {
      result = await sendAndWait();
    } finally {
      fault.restore();
      fsp.rm = originalRm;
    }
    expect503(result, 'UPLOAD_TEMP_WRITE_FAILED');
    expect(log.output()).toMatch(/"event":"upload_temp_cleanup_incomplete","reason":"EBUSY","owned":1/);
    expect(log.output()).not.toContain(env.uploadArea.directory);
    // Still owned, so shutdown cleans it up.
    expect(env.uploadArea.ownedCount).toBe(1);
    expect(await uploadNormally()).toBe(201);
    await env.uploadArea.close();
    expect(env.uploadArea.ownedCount).toBe(0);
    expect(env.tempFiles()).toEqual([]);
  });
});

describe('the temporary area cannot reserve a file (real filesystem conditions)', () => {
  it('the area directory replaced by a regular file -> a prompt 503, not a hang; the file is left untouched', async () => {
    const area = env.uploadArea.directory;
    fs.rmSync(area, { recursive: true, force: true });
    fs.writeFileSync(area, 'QA regular file in place of the area');

    expect503(await sendAndWait(), 'UPLOAD_TEMP_RESERVE_FAILED');
    nothingKept();
    expect(fs.readFileSync(area, 'utf8')).toBe('QA regular file in place of the area');

    // Recovery: the obstruction is removed; the area heals itself.
    fs.rmSync(area);
    expect(await uploadNormally()).toBe(201);
    expect(env.storedObjects()).toHaveLength(1);
    expect(env.tempFiles()).toEqual([]);
  });

  it('the area AND its parent removed -> 503 (a server-side failure), never 400 MALFORMED_REQUEST', async () => {
    fs.rmSync(env.tempBase, { recursive: true, force: true });

    expect503(await sendAndWait(), 'UPLOAD_TEMP_RESERVE_FAILED');
    nothingKept();

    // Recovery: the parent exists again; the area recreates itself inside it.
    fs.mkdirSync(env.tempBase, { mode: 0o700 });
    expect(await uploadNormally()).toBe(201);
    expect(env.storedObjects()).toHaveLength(1);
  });

  it('the area replaced by a link (a junction on Windows) to another directory -> 503, and nothing is written there', async () => {
    const area = env.uploadArea.directory;
    const elsewhere = path.join(env.root, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.rmSync(area, { recursive: true, force: true });
    fs.symlinkSync(elsewhere, area, 'junction');

    expect503(await sendAndWait(), 'UPLOAD_TEMP_RESERVE_FAILED');
    nothingKept();
    expect(listFiles(elsewhere)).toEqual([]);

    fs.unlinkSync(area);
    expect(await uploadNormally()).toBe(201);
    expect(listFiles(elsewhere)).toEqual([]);
  });
});

describe('the temporary area never reserves, releases or cleans up through a replaced directory', () => {
  let base;
  let outside;
  let area;
  let areaLog;

  beforeEach(async () => {
    base = makeTestRoot();
    outside = path.join(base, 'outside');
    fs.mkdirSync(outside);
    areaLog = capturingLogger();
    area = await TempUploadArea.create({ baseDirectory: base, logger: areaLog.logger });
  });
  afterEach(() => {
    removeTestRoot(base);
  });

  /** Moves the real area away and puts a link (a junction on Windows) to `outside` in its place. */
  const replaceWithLink = () => {
    fs.renameSync(area.directory, path.join(base, 'moved-area'));
    fs.symlinkSync(outside, area.directory, 'junction');
  };

  it('release() of a file whose area was replaced by a link deletes nothing through it, and logs a bounded event', async () => {
    const file = area.reserveFile();
    fs.writeFileSync(file.path, 'QA upload');
    replaceWithLink();
    // A same-named file now "exists" through the link, outside the area.
    const lookalike = path.join(outside, path.basename(file.path));
    fs.writeFileSync(lookalike, 'QA OUTSIDE FILE - MUST SURVIVE');

    expect(await area.release(file)).toBe(false);
    expect(fs.readFileSync(lookalike, 'utf8')).toBe('QA OUTSIDE FILE - MUST SURVIVE');
    expect(areaLog.output()).toContain('"event":"upload_temp_cleanup_incomplete","reason":"AREA_REPLACED"');
    expect(areaLog.output()).not.toContain(base);
    expect(area.ownedCount).toBe(1);
    expect(() => area.reserveFile()).toThrow(/AREA_REPLACED/);

    // close() refuses too, and still deletes nothing outside.
    await expect(area.close()).rejects.toThrow(/cleanup incomplete/);
    expect(fs.readFileSync(lookalike, 'utf8')).toBe('QA OUTSIDE FILE - MUST SURVIVE');
    expect(listFiles(outside)).toEqual([path.basename(file.path)]);
  });

  it('a DIFFERENT real directory put where the area was is not used either (it could belong to someone else)', async () => {
    fs.renameSync(area.directory, path.join(base, 'moved-area'));
    fs.mkdirSync(area.directory);
    expect(() => area.reserveFile()).toThrow(/AREA_REPLACED/);
    expect(fs.readdirSync(area.directory)).toEqual([]);
  });

  it('after an outside deletion the area recreates itself, and that NEW directory is then its own', async () => {
    fs.rmSync(area.directory, { recursive: true, force: true });
    const file = area.reserveFile();
    fs.writeFileSync(file.path, 'QA upload');
    expect(await area.release(file)).toBe(true);
    expect(fs.existsSync(file.path)).toBe(false);
    await area.close();
    expect(fs.existsSync(area.directory)).toBe(false);
  });
});
