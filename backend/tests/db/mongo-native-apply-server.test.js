import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { startServer } from '../../src/server.js';
import { Job } from '../../src/models/Job.js';
import { Application } from '../../src/models/Application.js';
import { REQUIRED_INDEXES } from '../../src/db/indexes.js';
import { publishJob } from '../../src/modules/jobs/job.service.js';
import { RESUME_FILES_COLLECTION } from '../../src/integrations/storage/mongoPrivateStorage.js';
import { TEST_RECRUITMENT_ENV, freePort } from '../helpers.js';
import { EXECUTABLE_BYTES, PDF_MIME, PNG_BYTES, syntheticDocx, DOCX_MIME, syntheticPdf, syntheticPdfOfSize } from '../fixtures/resumeFiles.js';
import { makeTestRoot, removeTestRoot } from '../fixtures/uploadHarness.js';
import { QA_CANDIDATE, applyPath } from '../fixtures/applyHarness.js';
import { requireTestDatabase, assertConnectedToTestDatabase } from './testDatabase.js';

/**
 * Proposed (MongoDB-native) — the Apply route in the REAL server composition
 * (startServer) with RESUME_STORAGE_DRIVER=mongodb against a real MongoDB:
 * upload validation through the route, file/Application consistency,
 * idempotent replay, and no stored version for anything refused.
 * Synthetic data only.
 */
const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const SLUG = `qa-mn-server-${randomUUID().slice(0, 8)}`;
let root;
let tempBase;
const running = [];

const serverEnv = (port) => ({
  ...TEST_RECRUITMENT_ENV,
  APP_ENV: 'local',
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  PORT: String(port),
  MONGODB_URI: TEST_URI,
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  RESUME_STORAGE_DRIVER: 'mongodb',
  RESUME_STORAGE_MONGODB_URI: TEST_URI,
  APPLICATION_RATE_LIMIT_MAX: '1000',
});

const files = () => mongoose.connection.db.collection(RESUME_FILES_COLLECTION);

async function seedJob() {
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  for (const required of REQUIRED_INDEXES) await mongoose.connection.db.collection(required.collection).createIndex(required.key, { name: required.name, ...required.options });
  const job = new Job({
    title: 'QA Synthetic Mongo-native Role', slug: SLUG, location: { displayName: 'QA Region, Canada', countryCode: 'CA' }, workArrangement: 'FULLY_REMOTE', employmentType: 'PART_TIME', weeklyHours: 30,
    compensation: { currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: true }, description: 'QA TEST DATA description.', responsibilities: ['QA TEST DATA responsibility.'], requirements: ['QA TEST DATA requirement.'],
  });
  await job.save();
  await publishJob(job, { now: new Date(Date.now() - 60_000) });
  return job;
}

beforeEach(async () => {
  root = makeTestRoot();
  tempBase = path.join(root, 'tmp');
  fs.mkdirSync(tempBase);
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false });
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  await files().deleteMany({});
});
afterEach(async () => {
  while (running.length) await running.pop().shutdown('test cleanup');
  if (mongoose.connection.readyState !== 1) await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false });
  const jobs = await Job.find({ slug: { $eq: SLUG } }, { _id: 1 }).lean();
  for (const job of jobs) await Application.deleteMany({ jobId: job._id });
  await Job.deleteMany({ slug: { $eq: SLUG } });
  await files().deleteMany({});
  await mongoose.disconnect();
  removeTestRoot(root);
}, 30_000);

async function start() {
  const port = await freePort();
  running.push(await startServer({ env: serverEnv(port), uploadTempBaseDirectory: tempBase }));
  return `http://127.0.0.1:${port}`;
}
const apply = (base, { key = randomUUID(), file = syntheticPdf(), name = 'qa-resume.pdf', type = PDF_MIME, fullName = QA_CANDIDATE.fullName } = {}) =>
  request(base).post(applyPath(SLUG)).set('Idempotency-Key', key).field('fullName', fullName).field('email', QA_CANDIDATE.email).attach('resume', file, { filename: name, contentType: type });

describe('Apply with RESUME_STORAGE_DRIVER=mongodb (real server, real MongoDB)', () => {
  it('201: one Application and exactly one résumé document, bound by key, size and SHA-256; no key in the response', async () => {
    const base = await start();
    const job = await seedJob();
    const pdf = syntheticPdf();
    const res = await apply(base, { file: pdf });
    expect(res.status).toBe(201);
    const record = await Application.findOne({ jobId: job._id }).lean();
    expect(record.resume.storageProvider).toBe('MONGODB');
    expect(record.resume.scanStatus).toBe('NOT_SCANNED');
    const doc = await files().findOne({ _id: record.resume.storageKey });
    expect(doc.sizeBytes).toBe(record.resume.sizeBytes);
    expect(doc.checksumSha256).toBe(record.resume.checksumSha256);
    expect(sha256(Buffer.from(doc.data.buffer))).toBe(sha256(pdf));
    expect(await files().countDocuments({})).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain(record.resume.storageKey);
  }, 30_000);

  it('idempotency: the same key replays (200) with no second document; a different body under the key is 409 with none', async () => {
    const base = await start();
    const job = await seedJob();
    const key = randomUUID();
    const pdf = syntheticPdf();
    expect((await apply(base, { key, file: pdf })).status).toBe(201);
    expect((await apply(base, { key, file: pdf })).status).toBe(200);
    expect((await apply(base, { key, file: pdf, fullName: 'QA Different Name' })).status).toBe(409);
    expect(await Application.countDocuments({ jobId: job._id })).toBe(1);
    expect(await files().countDocuments({})).toBe(1);
  }, 30_000);

  it('concurrent submissions under one key converge on one Application and one document', async () => {
    const base = await start();
    const job = await seedJob();
    const key = randomUUID();
    const pdf = syntheticPdf();
    const results = await Promise.all([apply(base, { key, file: pdf }), apply(base, { key, file: pdf }), apply(base, { key, file: pdf })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(await Application.countDocuments({ jobId: job._id })).toBe(1);
    expect(await files().countDocuments({})).toBe(1);
  }, 30_000);

  it('upload validation through the route: renamed PNG, executable, oversized and empty files are refused and store nothing; a DOCX is accepted', async () => {
    const base = await start();
    const job = await seedJob();
    for (const [file, name, type] of [[PNG_BYTES, 'qa.pdf', PDF_MIME], [EXECUTABLE_BYTES, 'qa.pdf', PDF_MIME], [syntheticPdfOfSize(5 * 1024 * 1024 + 1), 'qa.pdf', PDF_MIME], [Buffer.alloc(0), 'qa.pdf', PDF_MIME]]) {
      const res = await apply(base, { file, name, type });
      expect([400, 413, 415, 422]).toContain(res.status);
    }
    expect(await Application.countDocuments({ jobId: job._id })).toBe(0);
    expect(await files().countDocuments({})).toBe(0);
    expect((await apply(base, { file: syntheticDocx(), name: 'qa.docx', type: DOCX_MIME })).status).toBe(201);
    expect(await files().countDocuments({})).toBe(1);
  }, 60_000);
});
