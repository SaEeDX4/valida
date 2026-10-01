import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Job } from '../../src/models/Job.js';
import { Application } from '../../src/models/Application.js';
import { REQUIRED_INDEXES } from '../../src/db/indexes.js';
import { buildApplication } from '../../src/modules/applications/application.service.js';
import { discardStoredResume } from '../../src/modules/applications/resume/resumeStorage.js';
import { silentLogger } from '../helpers.js';
import { PDF_MIME, DOCX_MIME, syntheticPdf, syntheticDocx } from '../fixtures/resumeFiles.js';
import { INTAKE_PATH, buildIntakeApp, createIntakeEnvironment } from '../fixtures/uploadHarness.js';
import { requireTestDatabase, assertConnectedToTestDatabase } from './testDatabase.js';

/**
 * B4 REAL-DATABASE SUITE — private storage + MongoDB together.
 *
 * Doc 18 section 121 and the B4 authorization: the metadata B4 produces must
 * be compatible with the APPROVED Application model, as persisted by a real
 * MongoDB with its real unique indexes, and must keep describing the real
 * stored bytes after a reconnect. The resume goes through the real multipart
 * and validation path (test-only harness route) into real local private
 * storage in a fresh temporary root; the Application is built with the
 * approved B2 service. No stand-in anywhere.
 */
const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function clearSuiteCollections() {
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  await Job.deleteMany({});
  await Application.deleteMany({});
}

const publishableJob = (slug) => ({
  title: 'QA Role',
  slug,
  location: { displayName: 'British Columbia, Canada', countryCode: 'CA' },
  workArrangement: 'FULLY_REMOTE',
  employmentType: 'PART_TIME',
  schedule: '30 hours per week',
  weeklyHours: 30,
  compensation: { currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: true },
  description: 'QA role description.',
  responsibilities: ['QA responsibility.'],
  requirements: ['QA requirement.'],
});

beforeAll(async () => {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false });
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  for (const required of REQUIRED_INDEXES) {
    await mongoose.connection.db.collection(required.collection).createIndex(required.key, { name: required.name, ...required.options });
  }
}, 30_000);

afterAll(async () => {
  await clearSuiteCollections();
  await mongoose.disconnect();
});

let env;
let harness;
beforeEach(async () => {
  await clearSuiteCollections();
  env = await createIntakeEnvironment({ logger: silentLogger() });
  harness = buildIntakeApp({ storage: env.storage, uploadArea: env.uploadArea, logger: silentLogger() });
});
afterEach(async () => {
  await env.cleanup();
});

/** Uploads through the real multipart + validation + storage path; returns the metadata. */
async function uploadThroughIntake(bytes, filename, mime) {
  const response = await request(harness.app).post(INTAKE_PATH).attach('resume', bytes, { filename, contentType: mime });
  expect(response.status).toBe(201);
  return harness.captured.at(-1).metadata;
}

const applicationFor = (job, resume, idempotencyKey = `qa-key-${Math.random()}`) =>
  buildApplication({
    job,
    candidate: { fullName: 'QA Candidate', email: 'qa@example.invalid' },
    resume,
    idempotencyKey,
  });

describe('B4 metadata persisted by MongoDB describes the stored bytes', () => {
  it.each([
    ['PDF', syntheticPdf(), 'qa-resume.pdf', PDF_MIME],
    ['DOCX', syntheticDocx(), 'qa-resume.docx', DOCX_MIME],
  ])('a %s: object in private storage + Application in MongoDB agree after a reconnect', async (_format, bytes, filename, mime) => {
    const metadata = await uploadThroughIntake(bytes, filename, mime);
    const job = await new Job(publishableJob(`qa-${_format.toLowerCase()}`)).save();
    const saved = await applicationFor(job, metadata).save();

    // Reconnect: what MongoDB returns is what was durably written.
    await mongoose.disconnect();
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false });
    assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
    const found = await Application.findById(saved._id).lean();

    expect(found.resume).toEqual(metadata);
    expect(found.resume.scanStatus).toBe('NOT_SCANNED');
    expect(found.resume.scanCheckedAt).toBeNull();
    expect(found.resume.storedAt).toBeInstanceOf(Date);

    const onDisk = fs.readFileSync(path.join(env.storageRoot, ...found.resume.storageKey.split('/')));
    expect(onDisk.equals(bytes)).toBe(true);
    expect(sha256(onDisk)).toBe(found.resume.checksumSha256);
    expect(onDisk.length).toBe(found.resume.sizeBytes);
  }, 30_000);

  it('the unique resume.storageKey index refuses a second Application for the same object (Doc 10 section 97)', async () => {
    const metadata = await uploadThroughIntake(syntheticPdf(), 'qa.pdf', PDF_MIME);
    const job = await new Job(publishableJob('qa-unique-key')).save();
    await applicationFor(job, metadata).save();
    const error = await applicationFor(job, metadata).save().catch((caught) => caught);
    expect(error?.code).toBe(11000);
    expect(await Application.countDocuments({ 'resume.storageKey': metadata.storageKey })).toBe(1);
  }, 30_000);

  it('B5 compensation shape: the Application insert fails AFTER storage, the new object is removed, the other kept', async () => {
    const job = await new Job(publishableJob('qa-compensation')).save();
    const first = await uploadThroughIntake(syntheticPdf(), 'first.pdf', PDF_MIME);
    await applicationFor(job, first, 'qa-shared-idempotency-key').save();

    // A second upload is stored; its Application then fails the unique
    // idempotency index (the Doc 09 section 120 duplicate race).
    const second = await uploadThroughIntake(Buffer.concat([syntheticPdf(), Buffer.from('')]), 'second.pdf', PDF_MIME);
    const error = await applicationFor(job, second, 'qa-shared-idempotency-key').save().catch((caught) => caught);
    expect(error?.code).toBe(11000);

    expect(await discardStoredResume({ storage: env.storage, storageKey: second.storageKey, logger: silentLogger() })).toBe('DELETED');
    expect(await env.storage.statPrivateObject(second.storageKey)).toEqual({ exists: false });
    // The accepted Application's resume is untouched.
    expect(await env.storage.statPrivateObject(first.storageKey)).toEqual({ exists: true, sizeBytes: first.sizeBytes });
    expect(await Application.countDocuments({})).toBe(1);
  }, 30_000);
});
