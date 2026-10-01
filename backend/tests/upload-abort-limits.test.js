import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { capturingLogger } from './helpers.js';
import { PDF_MIME, syntheticPdf, syntheticPdfOfSize } from './fixtures/resumeFiles.js';
import { INTAKE_PATH, buildIntakeApp, createIntakeEnvironment, multipartBody, resumePart } from './fixtures/uploadHarness.js';

/**
 * B4 — interrupted and over-limit uploads, over a REAL listening socket.
 *
 * Doc 13 sections 55-56 and 255-256, Doc 09 sections 104-105: an upload
 * that is aborted, malformed or larger than allowed must never be reported
 * as accepted, must not leave a temporary file behind, and must not store
 * anything. Raw sockets are used so the test controls exactly what the
 * client sends and when it disappears.
 */
let env;
let log;
let server;
let port;

beforeEach(async () => {
  log = capturingLogger();
  env = await createIntakeEnvironment({ logger: log.logger });
  const { app } = buildIntakeApp({ storage: env.storage, uploadArea: env.uploadArea, logger: log.logger });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  ({ port } = server.address());
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await env.cleanup();
});

/** Waits until `check` returns true (the server finishes its cleanup asynchronously). */
async function eventually(check, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('condition not reached in time');
}

/** Opens a raw connection and collects everything the server sends back. */
function rawConnection() {
  const socket = net.connect(port, '127.0.0.1');
  const received = [];
  let closed = false;
  socket.on('data', (chunk) => received.push(chunk));
  socket.on('error', () => {});
  socket.on('close', () => {
    closed = true;
  });
  return {
    socket,
    text: () => Buffer.concat(received).toString('latin1'),
    isClosed: () => closed,
    ready: new Promise((resolve) => socket.once('connect', resolve)),
  };
}

const requestHead = ({ contentType, contentLength, chunked = false }) =>
  `POST ${INTAKE_PATH} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: ${contentType}\r\n` +
  (chunked ? 'Transfer-Encoding: chunked\r\n' : `Content-Length: ${contentLength}\r\n`) +
  '\r\n';

const nothingKept = () =>
  env.storedObjects().length === 0 && env.tempFiles().length === 0 && env.uploadArea.ownedCount === 0;

describe('over-limit request bodies', () => {
  it('a declared Content-Length over the limit is refused with 413 before any body is read, and the connection closes', async () => {
    const connection = rawConnection();
    await connection.ready;
    // Headers only: the server must answer without waiting for 50 MiB.
    connection.socket.write(requestHead({ contentType: 'multipart/form-data; boundary=qa', contentLength: 50 * 1024 * 1024 }));
    await eventually(() => connection.isClosed());
    const response = connection.text();
    expect(response).toMatch(/^HTTP\/1\.1 413 /);
    expect(response).toMatch(/\r\nConnection: close\r\n/i);
    expect(response).toContain('"code":"PAYLOAD_TOO_LARGE"');
    expect(nothingKept()).toBe(true);
    expect(log.output()).toContain('"reason":"REQUEST_OVER_LIMIT"');
  });

  it('a chunked body that streams past the limit is cut off and nothing is kept', async () => {
    const connection = rawConnection();
    await connection.ready;
    const boundary = 'qa-stream';
    connection.socket.write(requestHead({ contentType: `multipart/form-data; boundary=${boundary}`, chunked: true }));
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="resume"; filename="big.pdf"\r\nContent-Type: ${PDF_MIME}\r\n\r\n`,
    );
    const writeChunk = (data) => connection.socket.write(`${data.length.toString(16)}\r\n${data.toString('latin1')}\r\n`, 'latin1');
    writeChunk(head);
    const block = Buffer.alloc(256 * 1024, 0x41);
    // Keep sending (up to 16 MiB) until the server gives up on us.
    for (let sent = 0; sent < 16 * 1024 * 1024 && !connection.isClosed(); sent += block.length) {
      if (connection.text().length > 0) break;
      writeChunk(block);
      await new Promise((resolve) => setImmediate(resolve));
    }
    await eventually(() => connection.isClosed() || connection.text().includes('\r\n\r\n'));
    const response = connection.text();
    if (response.length > 0) expect(response).toMatch(/^HTTP\/1\.1 413 /);
    connection.socket.destroy();
    await eventually(nothingKept);
    expect(log.output()).toMatch(/"reason":"(REQUEST_OVER_LIMIT|RESUME_OVER_MAX_BYTES)"/);
  });
});

describe('aborted uploads (the client disappears mid-request)', () => {
  it.each([
    ['in the middle of the file', 0.5],
    ['just before the closing boundary', 0.999],
    ['right after the headers', 0],
  ])('an upload aborted %s leaves no temporary file and stores nothing', async (_label, fraction) => {
    const { body, contentType } = multipartBody([resumePart(syntheticPdfOfSize(3 * 1024 * 1024), 'qa.pdf', PDF_MIME)]);
    const connection = rawConnection();
    await connection.ready;
    connection.socket.write(requestHead({ contentType, contentLength: body.length }));
    connection.socket.write(body.subarray(0, Math.floor(body.length * fraction)));
    // Give the server time to start writing the temporary file.
    await new Promise((resolve) => setTimeout(resolve, 100));
    connection.socket.destroy();

    await eventually(() => log.output().includes('"reason":"CLIENT_ABORTED"') || fraction === 0);
    await eventually(nothingKept);
    expect(env.storedObjects()).toEqual([]);
  });

  it('the server keeps working normally after an aborted upload', async () => {
    const connection = rawConnection();
    await connection.ready;
    const { body, contentType } = multipartBody([resumePart(syntheticPdf(), 'qa.pdf', PDF_MIME)]);
    connection.socket.write(requestHead({ contentType, contentLength: body.length }));
    connection.socket.write(body.subarray(0, 100));
    connection.socket.destroy();
    await eventually(nothingKept);

    const good = rawConnection();
    await good.ready;
    good.socket.write(requestHead({ contentType, contentLength: body.length }));
    good.socket.write(body); // keep the connection open, as a real client does
    await eventually(() => good.text().includes('"received":true'));
    expect(good.text()).toMatch(/^HTTP\/1\.1 201 /);
    expect(env.storedObjects()).toHaveLength(1);
    expect(env.tempFiles()).toEqual([]);
  });

  it('a client that half-closes its connection: no hang, no leftover, no partial object', async () => {
    /*
     * Node's HTTP server (httpAllowHalfOpen=false) aborts a request whose
     * client sends FIN, and the connection closes without a response. Two
     * outcomes are correct, depending on timing:
     *   - the abort lands before the body was consumed: the upload fails as
     *     interrupted and nothing is kept;
     *   - the complete, valid body had already been consumed: it is stored
     *     exactly, and only the response is lost — Doc 09 section 121's
     *     "response lost" case, which B5 resolves by idempotent retry.
     * What must never happen is a hang, a leftover temporary file or a
     * partial object. (Before this test existed, the first case hung and
     * leaked its temporary file.)
     */
    const pdf = syntheticPdf();
    const { body, contentType } = multipartBody([resumePart(pdf, 'qa.pdf', PDF_MIME)]);
    const connection = rawConnection();
    await connection.ready;
    connection.socket.write(requestHead({ contentType, contentLength: body.length }));
    connection.socket.end(body);
    await eventually(() => connection.isClosed());
    expect(connection.text()).toBe('');
    await eventually(() => env.tempFiles().length === 0 && env.uploadArea.ownedCount === 0);
    const stored = env.storedObjects();
    if (stored.length === 0) {
      await eventually(() => log.output().includes('"reason":"CLIENT_ABORTED"'));
    } else {
      expect(stored).toHaveLength(1);
      expect(fs.readFileSync(path.join(env.storageRoot, 'resumes', stored[0])).equals(pdf)).toBe(true);
    }
  });

  describe('request-stream states the parser must not wait on forever', () => {
    const settleWithin = (promise, ms = 2000) =>
      Promise.race([
        promise.then(
          () => ({ settled: 'resolved' }),
          (error) => ({ settled: 'rejected', error }),
        ),
        new Promise((resolve) => setTimeout(() => resolve({ settled: 'hung' }), ms)),
      ]);
    const fakeRequest = async () => {
      const { PassThrough } = await import('node:stream');
      const stream = new PassThrough();
      stream.headers = { 'content-type': 'multipart/form-data; boundary=qa' };
      return stream;
    };
    const options = () => ({ uploadArea: env.uploadArea, fileField: 'resume', maxFileBytes: 1024 * 1024 });
    const parse = async (req) => (await import('../src/lib/multipart/multipart.js')).parseMultipartUpload(req, options());

    it('a request already destroyed (its close event long gone) is refused as interrupted', async () => {
      const req = await fakeRequest();
      req.destroy();
      await new Promise((resolve) => req.once('close', resolve));
      const outcome = await settleWithin(parse(req));
      expect(outcome.settled).toBe('rejected');
      expect(outcome.error.reason).toBe('CLIENT_ABORTED');
    });

    it('a request whose body was already consumed is refused, not awaited', async () => {
      const req = await fakeRequest();
      req.resume();
      req.end();
      await new Promise((resolve) => req.once('close', resolve));
      const outcome = await settleWithin(parse(req));
      expect(outcome.settled).toBe('rejected');
      expect(outcome.error.reason).toBe('MULTIPART_BODY_ALREADY_READ');
    });

    it('a request fully RECEIVED (complete) but destroyed before it was all READ is interrupted — and its temporary file removed', async () => {
      const req = await fakeRequest();
      // What Node does on a client half-close: every byte arrived
      // (req.complete), the stream is destroyed with part of it unread.
      req.complete = true;
      const pending = parse(req);
      const { body } = multipartBody([resumePart(syntheticPdf(), 'qa.pdf', PDF_MIME)], { boundary: 'qa' });
      req.write(body.subarray(0, body.length - 50));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(env.uploadArea.ownedCount).toBe(1);
      req.destroy();
      const outcome = await settleWithin(pending);
      expect(outcome.settled).toBe('rejected');
      expect(outcome.error.reason).toBe('CLIENT_ABORTED');
      expect(env.uploadArea.ownedCount).toBe(0);
      expect(env.tempFiles()).toEqual([]);
    });
  });

  it('a slow but complete upload is accepted', async () => {
    const { body, contentType } = multipartBody([resumePart(syntheticPdf(), 'qa.pdf', PDF_MIME)]);
    const connection = rawConnection();
    await connection.ready;
    connection.socket.write(requestHead({ contentType, contentLength: body.length }));
    for (let offset = 0; offset < body.length; offset += 97) {
      connection.socket.write(body.subarray(offset, offset + 97));
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    await eventually(() => connection.text().includes('\r\n\r\n{'));
    expect(connection.text()).toMatch(/^HTTP\/1\.1 201 /);
    connection.socket.destroy();
  });
});
