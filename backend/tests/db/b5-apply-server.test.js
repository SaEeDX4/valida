import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { startServer } from '../../src/server.js';
import { Job } from '../../src/models/Job.js';
import { Application } from '../../src/models/Application.js';
import { REQUIRED_INDEXES } from '../../src/db/indexes.js';
import { publishJob } from '../../src/modules/jobs/job.service.js';
import { freePort } from '../helpers.js';
import { PDF_MIME, syntheticPdf, syntheticPdfOfSize } from '../fixtures/resumeFiles.js';
import { listFiles, makeTestRoot, multipartBody, removeTestRoot, resumePart } from '../fixtures/uploadHarness.js';
import { QA_CANDIDATE, applyPath } from '../fixtures/applyHarness.js';
import { requireTestDatabase, assertConnectedToTestDatabase } from './testDatabase.js';

/**
 * B5 — the Apply route in the REAL SERVER COMPOSITION against a REAL MongoDB:
 * startServer (src/server.js) with its production MongoDB connector, the
 * development storage driver on a fresh test root, the HTTP server exactly as
 * production builds it (serveUnlessConnectionClosing around the app), and —
 * for restart persistence — `node src/server.js` as two separate PROCESSES.
 *
 * Proves end to end: an Application accepted over the network is in MongoDB
 * and its resume in private storage; the B4 pipelining guard and its
 * documented limit, with B5's real side effects; persistence across a
 * backend process restart, with the idempotent replay answered by the new
 * process. Synthetic data only; only this file's records are removed.
 */
const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const backendRoot = path.join(import.meta.dirname, '..', '..');
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const RUN = randomUUID().slice(0, 8);
const SLUG = `qa-b5-server-${RUN}`;

let root;
let storageRoot;
let tempBase;
const running = [];

const serverEnv = (port) => ({
  APP_ENV: 'local',
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  PORT: String(port),
  MONGODB_URI: TEST_URI,
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  RESUME_STORAGE_DRIVER: 'local',
  RESUME_STORAGE_LOCAL_ROOT: storageRoot,
  APPLICATION_RATE_LIMIT_MAX: '1000',
});

async function seedJob() {
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  for (const required of REQUIRED_INDEXES) {
    await mongoose.connection.db.collection(required.collection).createIndex(required.key, { name: required.name, ...required.options });
  }
  const job = new Job({
    title: 'QA Synthetic Server Role',
    slug: SLUG,
    location: { displayName: 'QA Region, Canada', countryCode: 'CA' },
    workArrangement: 'FULLY_REMOTE',
    employmentType: 'PART_TIME',
    weeklyHours: 30,
    compensation: { currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: true },
    description: 'QA TEST DATA description.',
    responsibilities: ['QA TEST DATA responsibility.'],
    requirements: ['QA TEST DATA requirement.'],
  });
  await job.save();
  await publishJob(job, { now: new Date(Date.now() - 60_000) });
  return job;
}

async function removeThisRunsRecords() {
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  const jobs = await Job.find({ slug: { $eq: SLUG } }, { _id: 1 }).lean();
  for (const job of jobs) await Application.deleteMany({ jobId: job._id });
  await Job.deleteMany({ slug: { $eq: SLUG } });
}

beforeEach(() => {
  root = makeTestRoot();
  storageRoot = path.join(root, 'private-resumes');
  tempBase = path.join(root, 'tmp');
  fs.mkdirSync(tempBase);
});
afterEach(async () => {
  while (running.length) await running.pop().shutdown('test cleanup');
  if (mongoose.connection.readyState !== 1) await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false });
  await removeThisRunsRecords();
  await mongoose.disconnect();
  removeTestRoot(root);
}, 30_000);

async function startInProcess() {
  const port = await freePort();
  const handle = await startServer({ env: serverEnv(port), uploadTempBaseDirectory: tempBase });
  running.push(handle);
  return { port, handle };
}

function applyBytes({ key = randomUUID(), pdf = syntheticPdf(), withKey = true } = {}) {
  const { body, contentType } = multipartBody([
    { name: 'fullName', value: QA_CANDIDATE.fullName },
    { name: 'email', value: QA_CANDIDATE.email },
    resumePart(pdf, 'qa-resume.pdf', PDF_MIME),
  ]);
  const head =
    `POST ${applyPath(SLUG)} HTTP/1.1\r\nHost: qa\r\nContent-Type: ${contentType}\r\n` +
    (withKey ? `Idempotency-Key: ${key}\r\n` : '') +
    `Content-Length: ${body.length}\r\n\r\n`;
  return { bytes: Buffer.concat([Buffer.from(head), body]), key, pdf };
}

async function eventually(check, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${what} not reached within ${timeoutMs} ms`);
}

async function rawClient(port, { allowHalfOpen = false } = {}) {
  const socket = net.connect({ port, host: '127.0.0.1', allowHalfOpen });
  const state = { received: [], closed: false };
  socket.on('data', (chunk) => state.received.push(chunk));
  socket.on('error', () => {});
  socket.on('close', () => {
    state.closed = true;
  });
  await new Promise((resolve) => socket.once('connect', resolve));
  return { socket, state, text: () => Buffer.concat(state.received).toString('latin1') };
}
const statusLines = (text) => text.match(/HTTP\/1\.1 \d{3}/g) ?? [];
const storedObjects = () => listFiles(path.join(storageRoot, 'resumes'));
const tempFiles = () => listFiles(tempBase).filter((file) => path.basename(file) !== '.owner');

describe('startServer (production composition) over real MongoDB and real local storage', () => {
  it('accepts an Application end to end: 201 -> record in MongoDB -> object in private storage', async () => {
    const { port } = await startInProcess();
    const job = await seedJob();
    const pdf = syntheticPdf();
    const key = randomUUID();
    const response = await request(`http://127.0.0.1:${port}`)
      .post(applyPath(SLUG))
      .set('Idempotency-Key', key)
      .field('fullName', QA_CANDIDATE.fullName)
      .field('email', QA_CANDIDATE.email)
      .attach('resume', pdf, { filename: 'qa-resume.pdf', contentType: PDF_MIME });
    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const record = await Application.findOne({ jobId: job._id }).lean();
    expect(record.submittedAt.toISOString()).toBe(response.body.data.submittedAt);
    const stored = fs.readFileSync(path.join(storageRoot, ...record.resume.storageKey.split('/')));
    expect(sha256(stored)).toBe(sha256(pdf));
    expect(tempFiles()).toEqual([]);
    // Readiness stays honest while B6 is absent.
    const ready = await request(`http://127.0.0.1:${port}`).get('/api/v1/health/ready');
    expect(ready.status).toBe(503);
  }, 30_000);

  it('a valid Application pipelined AFTER an armed refusal is never processed (B4 guard, B5 side effects checked)', async () => {
    const { port } = await startInProcess();
    await seedJob();
    const client = await rawClient(port, { allowHalfOpen: true });
    const declared = 6 * 1024 * 1024; // over the Apply limit: 413 before the body is read
    const { body, contentType } = multipartBody([resumePart(syntheticPdf(), 'qa.pdf', PDF_MIME)]);
    client.socket.write(
      `POST ${applyPath(SLUG)} HTTP/1.1\r\nHost: qa\r\nContent-Type: ${contentType}\r\nIdempotency-Key: ${randomUUID()}\r\nContent-Length: ${declared}\r\n\r\n`,
    );
    await eventually(() => statusLines(client.text()).length === 1, 5000, 'the 413');
    const b = applyBytes();
    client.socket.write(Buffer.concat([body, Buffer.alloc(declared - body.length, 0x51), b.bytes]));
    client.socket.end();
    await eventually(() => client.state.closed, 10_000, 'connection closed');
    expect(statusLines(client.text())).toEqual(['HTTP/1.1 413']);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await Application.countDocuments({})).toBe(0);
    expect(storedObjects()).toEqual([]);
    expect(tempFiles()).toEqual([]);
  }, 30_000);

  it('DOCUMENTED LIMIT: an Application dispatched BEFORE the preceding refusal is decided — at most one Application, no orphan; the retry converges on exactly one', async () => {
    const { port } = await startInProcess();
    const job = await seedJob();
    const client = await rawClient(port);
    const a = applyBytes({ withKey: false });
    const b = applyBytes({ pdf: syntheticPdf({ text: 'QA TEST DOCUMENT - PIPELINED B' }) });
    client.socket.write(Buffer.concat([a.bytes, b.bytes]));
    await eventually(() => client.state.closed, 10_000, 'connection closed');
    await eventually(() => tempFiles().length === 0, 10_000, 'temporary files released');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(statusLines(client.text())[0]).toBe('HTTP/1.1 400');
    const accepted = await Application.countDocuments({ jobId: job._id });
    expect(accepted).toBeLessThanOrEqual(1);
    expect(storedObjects()).toHaveLength(accepted); // no orphaned object

    const retry = await request(`http://127.0.0.1:${port}`)
      .post(applyPath(SLUG))
      .set('Idempotency-Key', b.key)
      .field('fullName', QA_CANDIDATE.fullName)
      .field('email', QA_CANDIDATE.email)
      .attach('resume', b.pdf, { filename: 'qa-resume.pdf', contentType: PDF_MIME });
    expect(retry.status).toBe(accepted === 1 ? 200 : 201);
    expect(await Application.countDocuments({ jobId: job._id })).toBe(1);
    expect(storedObjects()).toHaveLength(1);
    if (process.env.VALIDA_B5_EVIDENCE_FILE) {
      fs.appendFileSync(process.env.VALIDA_B5_EVIDENCE_FILE, `${JSON.stringify({ pipelinedBeforeArming: { firstConnectionStatusLines: statusLines(client.text()), applicationsAfterFirstConnection: accepted, retryStatus: retry.status, applicationsAfterRetry: 1, storedObjects: 1 } })}\n`);
    }
  }, 30_000);
});

describe('persistence across a backend PROCESS restart (Doc 17 section 104)', () => {
  function spawnServer(port) {
    const child = spawn(process.execPath, ['src/server.js'], {
      cwd: backendRoot,
      env: { ...process.env, ...serverEnv(port), LOG_LEVEL: 'info', TMPDIR: tempBase, TEMP: tempBase, TMP: tempBase },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start')), 20_000);
      const onData = (chunk) => {
        output += chunk;
        if (/backend listening/.test(output)) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('exit', () => {
        clearTimeout(timer);
        reject(new Error('server exited before listening'));
      });
    });
    return { child, ready, output: () => output };
  }
  const stop = async (child) => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  };

  it('process A accepts; process A exits; process B finds the record and replays the same key', async () => {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false });
    const job = await seedJob();
    await mongoose.disconnect();

    const key = randomUUID();
    const pdf = syntheticPdf();
    const send = (port) =>
      request(`http://127.0.0.1:${port}`)
        .post(applyPath(SLUG))
        .set('Idempotency-Key', key)
        .field('fullName', QA_CANDIDATE.fullName)
        .field('email', QA_CANDIDATE.email)
        .attach('resume', pdf, { filename: 'qa-resume.pdf', contentType: PDF_MIME });

    const portA = await freePort();
    const a = spawnServer(portA);
    let first;
    try {
      await a.ready;
      first = await send(portA);
    } finally {
      await stop(a.child);
    }
    expect(first.status).toBe(201);
    // The child logs never contain candidate data or the key.
    expect(a.output()).not.toContain(QA_CANDIDATE.email);
    expect(a.output()).not.toContain(key);

    const portB = await freePort();
    const b = spawnServer(portB);
    let replay;
    try {
      await b.ready;
      replay = await send(portB);
    } finally {
      await stop(b.child);
    }
    expect(replay.status).toBe(200);
    expect(replay.body.meta.replayed).toBe(true);
    expect(replay.body.data).toEqual(first.body.data);

    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false });
    const records = await Application.find({ jobId: job._id }).lean();
    expect(records).toHaveLength(1);
    const stored = fs.readFileSync(path.join(storageRoot, ...records[0].resume.storageKey.split('/')));
    expect(sha256(stored)).toBe(sha256(pdf));
    expect(storedObjects()).toHaveLength(1);
    // Neither process logged the private storage key, a key segment or the storage root.
    for (const output of [a.output(), b.output()]) {
      for (const part of records[0].resume.storageKey.split('/').slice(1)) expect(output).not.toContain(part);
      expect(output).not.toContain(storageRoot);
    }
  }, 60_000);
});

// Large-upload helper kept for the documented-limit variants.
void syntheticPdfOfSize;
