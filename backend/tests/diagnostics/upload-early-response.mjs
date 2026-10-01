/**
 * DIAGNOSTIC (B4 r3) — does a client receive the 503 that answers an upload
 * the server could not hold, and how does the connection end?
 *
 *   cd backend
 *   node tests/diagnostics/upload-early-response.mjs
 *
 * Not a test (vitest does not pick it up) and not part of the product. It
 * runs the four temporary-storage failure cases of
 * tests/upload-temp-failure.test.js over a real local socket, with SYNTHETIC
 * files in fresh `valida-b4-test-*` roots under the OS temporary directory,
 * which it deletes afterwards. It works on the r2 tree as well as r3 (it uses
 * only the test harness), so the same command shows the behaviour before and
 * after the fix.
 *
 * It prints one JSON line per case and nothing else: Node version, OS, the
 * HTTP status line received (if any), whether the response was complete by
 * its Content-Length, the client's socket events (data sizes, the server's
 * FIN, error CODES such as ECONNRESET, close), the server's logged outcome
 * (fixed tokens: status, code, reason), and how many request bytes the server
 * had read when it closed versus how many the client sent. No path, key,
 * credential, file content or personal data is printed.
 *
 * Exit code: 0 when every case delivered a complete response, 1 otherwise.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { capturingLogger } from '../helpers.js';
import { syntheticPdfOfSize } from '../fixtures/resumeFiles.js';
import { INTAKE_PATH, buildIntakeApp, createIntakeEnvironment, multipartBody, resumePart } from '../fixtures/uploadHarness.js';

const WAIT_MS = 4000;
const CASES = ['enospc', 'area-replaced-by-file', 'area-and-parent-removed', 'area-replaced-by-link'];

async function runCase(name) {
  const log = capturingLogger();
  const env = await createIntakeEnvironment({ logger: log.logger });
  const { app } = buildIntakeApp({ storage: env.storage, uploadArea: env.uploadArea, logger: log.logger });
  const server = http.createServer(app);
  const serverSide = { bytesReadAtClose: null, closed: false };
  server.on('connection', (socket) => {
    socket.on('close', () => {
      serverSide.closed = true;
      serverSide.bytesReadAtClose = socket.bytesRead;
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const originalCreateWriteStream = fs.createWriteStream;
  if (name === 'enospc') {
    fs.createWriteStream = function createWriteStreamWithFault(target, options) {
      const stream = originalCreateWriteStream.call(fs, target, options);
      if (/[\\/]up-[0-9a-f]{32}\.part$/.test(String(target))) {
        const failSoon = (callback) =>
          setImmediate(() => callback(Object.assign(new Error('QA injected'), { code: 'ENOSPC' })));
        stream._write = (_chunk, _encoding, callback) => failSoon(callback);
        stream._writev = (_chunks, callback) => failSoon(callback);
      }
      return stream;
    };
  } else if (name === 'area-replaced-by-file') {
    fs.rmSync(env.uploadArea.directory, { recursive: true, force: true });
    fs.writeFileSync(env.uploadArea.directory, 'QA obstruction');
  } else if (name === 'area-and-parent-removed') {
    fs.rmSync(env.tempBase, { recursive: true, force: true });
  } else if (name === 'area-replaced-by-link') {
    const elsewhere = path.join(env.root, 'elsewhere');
    fs.mkdirSync(elsewhere);
    fs.rmSync(env.uploadArea.directory, { recursive: true, force: true });
    fs.symlinkSync(elsewhere, env.uploadArea.directory, 'junction');
  }

  const { body } = multipartBody([resumePart(syntheticPdfOfSize(1024 * 1024), 'synthetic.pdf', 'application/pdf')], {
    boundary: 'qa-diagnostic',
    close: false,
  });
  const head = Buffer.from(
    `POST ${INTAKE_PATH} HTTP/1.1\r\nHost: qa\r\nContent-Type: multipart/form-data; boundary=qa-diagnostic\r\n` +
      `Content-Length: ${body.length + 24}\r\n\r\n`,
  );
  const started = Date.now();
  const events = [];
  const received = [];
  const note = (event) => {
    if (events.length < 20) events.push({ ms: Date.now() - started, ...event });
  };
  const socket = net.connect(server.address().port, '127.0.0.1');
  socket.on('data', (chunk) => {
    received.push(chunk);
    note({ event: 'data', bytes: chunk.length });
  });
  socket.on('end', () => note({ event: 'end (server FIN)' }));
  socket.on('error', (error) => note({ event: 'error', code: error.code }));
  socket.on('close', () => note({ event: 'close' }));
  await new Promise((resolve) => socket.once('connect', resolve));
  socket.write(head);
  socket.write(body); // 24 declared bytes are never sent: only the server can end this request

  const framed = () => {
    const text = Buffer.concat(received).toString('latin1');
    const split = text.indexOf('\r\n\r\n');
    const statusLine = (split === -1 ? text : text.slice(0, split)).split('\r\n')[0] || null;
    if (split === -1) return { statusLine, complete: false };
    const contentLength = Number(/\r\ncontent-length:[ \t]*(\d+)/i.exec(text.slice(0, split))?.[1] ?? Number.NaN);
    const bodyBytes = Buffer.byteLength(text.slice(split + 4), 'latin1');
    return {
      statusLine,
      connectionHeader: /\r\nconnection:[ \t]*([^\r]*)/i.exec(text.slice(0, split))?.[1] ?? null,
      contentLength: Number.isInteger(contentLength) ? contentLength : null,
      bodyBytes,
      complete: Number.isInteger(contentLength) && bodyBytes >= contentLength,
    };
  };
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline && !(framed().complete && serverSide.closed)) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  fs.createWriteStream = originalCreateWriteStream;

  const response = framed();
  const result = {
    case: name,
    node: process.version,
    os: `${process.platform} ${process.arch}`,
    response: { ...response, statusLine: response.statusLine?.slice(0, 60) ?? null },
    clientBytesSent: head.length + body.length,
    clientEvents: events,
    server: {
      logged: log
        .output()
        .split('\n')
        .filter((line) => line.includes('"reason"'))
        .map((line) => {
          const entry = JSON.parse(line);
          return { status: entry.status, code: entry.code, reason: entry.reason };
        })
        .slice(0, 5),
      closed: serverSide.closed,
      bytesReadAtClose: serverSide.bytesReadAtClose,
      storedObjects: env.storedObjects().length,
      ownedTempFiles: env.uploadArea.ownedCount,
    },
  };
  socket.destroy();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await env.cleanup().catch(() => {});
  return result;
}

let allDelivered = true;
for (const name of CASES) {
  const result = await runCase(name);
  if (!result.response.complete) allDelivered = false;
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
process.exitCode = allDelivered ? 0 : 1;
