import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { Job } from '../../src/models/Job.js';
import { Application } from '../../src/models/Application.js';
import { REQUIRED_INDEXES } from '../../src/db/indexes.js';
import { createJobRepository } from '../../src/modules/jobs/job.repository.js';
import { applyJobEdit, closeJob, publishJob, archiveJob } from '../../src/modules/jobs/job.service.js';
import { createApplicationRepository } from '../../src/modules/applications/application.repository.js';
import { hashIdempotencyKey } from '../../src/modules/applications/application.service.js';
import { createNotificationService } from '../../src/integrations/notifications/notificationService.js';
import { storageObjectRef } from '../../src/integrations/storage/privateStorage.js';
import { Readiness, DEPENDENCY_STATE } from '../../src/modules/health/readiness.js';
import { capturingLogger, testConfig } from '../helpers.js';
import { PDF_MIME, DOCX_MIME, syntheticPdf, syntheticDocx } from '../fixtures/resumeFiles.js';
import { createIntakeEnvironment } from '../fixtures/uploadHarness.js';
import { QA_CANDIDATE, applyRequest, qaAnswers, recordingTransport } from '../fixtures/applyHarness.js';
import { requireTestDatabase, assertConnectedToTestDatabase } from './testDatabase.js';

/**
 * B5 REAL-DATABASE SUITE — the Apply workflow against a REAL MongoDB.
 *
 * The real app (createApp) with the REAL Job and Application repositories
 * over Mongoose, the real unique indexes (applied here exactly as
 * `db:indexes:apply` does), REAL local private storage in a fresh temp root,
 * and the real notification boundary. Where a failure must happen at a
 * precise moment, the REAL repository or storage is wrapped — the operation
 * itself still runs against MongoDB / the disk. Synthetic data only; only the
 * approved disposable test database is touched (requireTestDatabase).
 *
 * Doc 18 section 132 — the full chain: Request -> HTTP response -> DB record ->
 * storage object.
 */
const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const CONNECT = { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false };

async function clearSuiteCollections() {
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  await Application.deleteMany({});
  await Job.deleteMany({});
}

async function applyIndexes() {
  for (const required of REQUIRED_INDEXES) {
    await mongoose.connection.db.collection(required.collection).createIndex(required.key, { name: required.name, ...required.options });
  }
}

/** A real, PUBLISHED synthetic Job, written through the B2 lifecycle service. */
async function publishedJob(slug = 'qa-synthetic-apply-role', overrides = {}) {
  const job = new Job({
    title: 'QA Synthetic Apply Role',
    slug,
    location: { displayName: 'QA Region, Canada', countryCode: 'CA' },
    workArrangement: 'FULLY_REMOTE',
    employmentType: 'PART_TIME',
    schedule: 'QA TEST DATA schedule',
    weeklyHours: 30,
    compensation: { currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: true },
    description: 'QA TEST DATA description.',
    responsibilities: ['QA TEST DATA responsibility.'],
    requirements: ['QA TEST DATA requirement.'],
    applicationConfig: {
      resumeRequired: true,
      phone: { enabled: true, required: false },
      message: { enabled: true, required: false, maxLength: 2000 },
      screeningQuestions: [
        { questionId: '11111111-1111-4111-8111-111111111111', type: 'YES_NO', prompt: 'QA TEST DATA: can you work the stated hours?', required: true },
        {
          questionId: '22222222-2222-4222-8222-222222222222',
          type: 'SINGLE_SELECT',
          prompt: 'QA TEST DATA: preferred start window?',
          required: false,
          options: [
            { optionId: '33333333-3333-4333-8333-333333333333', label: 'QA option A' },
            { optionId: '44444444-4444-4444-8444-444444444444', label: 'QA option B' },
          ],
        },
        { questionId: '55555555-5555-4555-8555-555555555555', type: 'SHORT_TEXT', prompt: 'QA TEST DATA: short answer?', required: false },
      ],
    },
    ...overrides,
  });
  await job.save();
  await publishJob(job, { now: new Date(Date.now() - 60_000) });
  return job;
}

beforeAll(async () => {
  await mongoose.connect(TEST_URI, CONNECT);
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  await applyIndexes();
}, 30_000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(TEST_URI, CONNECT);
  await clearSuiteCollections();
  await mongoose.disconnect();
}, 30_000);

let intake;
let log;
beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(TEST_URI, CONNECT);
  await clearSuiteCollections();
  log = capturingLogger();
  intake = await createIntakeEnvironment({ logger: log.logger });
});
afterEach(async () => {
  await intake.cleanup();
});

/** The real app over the real repositories; `wrap` may replace repository methods (the real ones still do the work). */
function realApp({ transport = null, wrapJobs = (repo) => repo, wrapApplications = (repo) => repo, storage = intake.storage } = {}) {
  const readiness = new Readiness();
  readiness.set('configuration', DEPENDENCY_STATE.READY);
  readiness.set('database', DEPENDENCY_STATE.READY);
  const app = createApp({
    config: testConfig({ applicationRateLimit: Object.freeze({ windowMs: 900_000, max: 1000 }) }),
    logger: log.logger,
    readiness,
    jobRepository: wrapJobs({ ...createJobRepository({ queryTimeoutMs: 5000 }) }),
    applicationRepository: wrapApplications({ ...createApplicationRepository({ timeoutMs: 5000 }) }),
    notificationService: createNotificationService({ transport, timeoutMs: 2000 }),
    resumeStorage: storage,
    uploadArea: intake.uploadArea,
  });
  return app;
}

const objectPath = (storageKey) => path.join(intake.storageRoot, ...storageKey.split('/'));
const events = (name) =>
  log
    .output()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.event === name);

describe('the full chain: request -> response -> MongoDB record -> private object (Doc 18 section 132)', () => {
  it.each([
    ['PDF', syntheticPdf(), 'qa-resume.pdf', PDF_MIME],
    ['DOCX', syntheticDocx(), 'qa-resume.docx', DOCX_MIME],
  ])('a %s Application', async (_format, bytes, filename, mime) => {
    const job = await publishedJob();
    const app = realApp();
    const key = randomUUID();
    const response = await applyRequest(app, { key, resume: { data: bytes, filename, contentType: mime }, fields: { phone: QA_CANDIDATE.phone } });

    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({ status: 'RECEIVED', job: { title: 'QA Synthetic Apply Role', slug: 'qa-synthetic-apply-role' }, submittedAt: expect.any(String) });
    expect(response.body.meta.replayed).toBe(false);

    // The record, read back from MongoDB on a FRESH connection.
    await mongoose.disconnect();
    await mongoose.connect(TEST_URI, CONNECT);
    const records = await Application.find({}).lean();
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(String(record.jobId)).toBe(String(job._id));
    expect(record.submittedAt.toISOString()).toBe(response.body.data.submittedAt);
    expect(record.status).toBe('RECEIVED');
    expect(record.jobSnapshot.slug).toBe('qa-synthetic-apply-role');
    expect(record.candidate.emailNormalized).toBe(QA_CANDIDATE.email.toLowerCase());
    expect(record.candidate.phone).toBe(QA_CANDIDATE.phone);
    expect(record.screeningAnswers).toHaveLength(3);
    expect(record.idempotency.keyHash).toBe(hashIdempotencyKey(key));
    expect(record.resume.scanStatus).toBe('NOT_SCANNED');
    expect(record.notifications.internal).toMatchObject({ status: 'PENDING', attemptCount: 0 });
    expect(record.createdAt).toBeInstanceOf(Date);
    expect(JSON.stringify(record)).not.toContain(key);

    // The private object: exactly the uploaded bytes, matching the record.
    const stored = fs.readFileSync(objectPath(record.resume.storageKey));
    expect(stored.equals(bytes)).toBe(true);
    expect(sha256(stored)).toBe(record.resume.checksumSha256);
    expect(stored.length).toBe(record.resume.sizeBytes);
    expect(intake.storedObjects()).toHaveLength(1);
    expect(intake.tempFiles()).toEqual([]);

    if (process.env.VALIDA_B5_EVIDENCE_FILE) {
      // Sanitised evidence: synthetic data only; no storage key, path, key or hash values.
      fs.appendFileSync(
        process.env.VALIDA_B5_EVIDENCE_FILE,
        `${JSON.stringify({
          format: _format,
          request: { method: 'POST', path: '/api/v1/jobs/qa-synthetic-apply-role/applications', idempotencyKey: '<uuid v4, not shown>', fields: ['fullName', 'email', 'phone', 'screeningAnswers', 'resume'] },
          response: { status: response.status, body: { ...response.body, meta: { ...response.body.meta, requestId: '<request id>' } } },
          record: {
            _id: '<ObjectId>',
            jobIdMatchesJob: String(record.jobId) === String(job._id),
            status: record.status,
            submittedAtMatchesResponse: record.submittedAt.toISOString() === response.body.data.submittedAt,
            jobSnapshot: record.jobSnapshot,
            candidate: { fullName: '<synthetic>', email: '<synthetic>', emailNormalizedIsLowercase: record.candidate.emailNormalized === record.candidate.email.toLowerCase(), phone: '<synthetic>', message: record.candidate.message },
            screeningAnswers: record.screeningAnswers.map(({ typeSnapshot, booleanValue, optionId }) => ({ typeSnapshot, booleanValue, optionIdPresent: optionId !== null })),
            resume: { ...record.resume, storageKey: `<generated: matches ${/^resumes\/[0-9a-f]{32}\/[0-9a-f]{32}$/.test(record.resume.storageKey)}>`, checksumSha256: '<64 hex>' },
            idempotency: { keyHash: `<sha256 hex, ${record.idempotency.keyHash.length} chars>`, requestFingerprintHash: `<sha256 hex, ${record.idempotency.requestFingerprintHash.length} chars>`, rawKeyStored: JSON.stringify(record).includes(key) },
            notifications: record.notifications,
          },
          object: { exists: true, bytesEqualUpload: stored.equals(bytes), sha256MatchesRecord: sha256(stored) === record.resume.checksumSha256, sizeMatchesRecord: stored.length === record.resume.sizeBytes, insidePrivateTestRoot: true },
          temporaryFilesLeft: intake.tempFiles().length,
        })}\n`,
      );
    }
  }, 30_000);
});

describe('idempotency against the REAL unique index (Doc 09 sections 78-80, 120-121; Doc 10 section 226)', () => {
  it('replay and conflict', async () => {
    await publishedJob();
    const app = realApp();
    const key = randomUUID();
    const resume = { data: syntheticPdf(), filename: 'qa.pdf', contentType: PDF_MIME };
    const first = await applyRequest(app, { key, resume });
    const replay = await applyRequest(app, { key, resume });
    const conflict = await applyRequest(app, { key, resume, fields: { email: 'qa.other@example.invalid' } });
    expect([first.status, replay.status, conflict.status]).toEqual([201, 200, 409]);
    expect(replay.body.data).toEqual(first.body.data);
    expect(await Application.countDocuments({})).toBe(1);
    expect(intake.storedObjects()).toHaveLength(1);
  }, 30_000);

  it('8 concurrent requests with one key, all past the replay lookup at once: ONE Application (unique index), ONE object; 7 replays', async () => {
    await publishedJob();
    let waiting = 0;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const app = realApp({
      wrapApplications: (repo) => ({
        ...repo,
        async insert(document) {
          waiting += 1;
          if (waiting === 8) release();
          await gate; // all eight inserts are released together into MongoDB
          return repo.insert(document);
        },
      }),
    });
    const key = randomUUID();
    const resume = { data: syntheticPdf(), filename: 'qa.pdf', contentType: PDF_MIME };
    const responses = await Promise.all(Array.from({ length: 8 }, () => applyRequest(app, { key, resume })));
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 201]);
    expect(new Set(responses.map((r) => r.body.data.submittedAt)).size).toBe(1);
    expect(await Application.countDocuments({ 'idempotency.keyHash': hashIdempotencyKey(key) })).toBe(1);
    const [record] = await Application.find({}).lean();
    expect(intake.storedObjects()).toHaveLength(1);
    expect(fs.existsSync(objectPath(record.resume.storageKey))).toBe(true);
    expect(intake.tempFiles()).toEqual([]);
    expect(events('application_not_accepted').filter((e) => e.reason === 'IDEMPOTENCY_RACE_LOST')).toHaveLength(7);
  }, 30_000);

  it('a different key with the same email is a second Application (APP-008)', async () => {
    await publishedJob();
    const app = realApp();
    expect((await applyRequest(app)).status).toBe(201);
    expect((await applyRequest(app)).status).toBe(201);
    expect(await Application.countDocuments({ 'candidate.emailNormalized': QA_CANDIDATE.email.toLowerCase() })).toBe(2);
  }, 30_000);
});

describe('Job eligibility over real Jobs (Doc 09 sections 111-115; Doc 17 sections 91-96)', () => {
  it('closed, archived, draft, expired: refused; nothing stored', async () => {
    const closed = await publishedJob('qa-closed-role');
    await closeJob(closed);
    const archived = await publishedJob('qa-archived-role');
    await closeJob(archived);
    await archiveJob(archived);
    await new Job({ title: 'QA Draft Role', slug: 'qa-draft-role' }).save();
    const expired = await publishedJob('qa-expired-role');
    applyJobEdit(expired, { closesAt: new Date(Date.now() - 1000) });
    await expired.save();
    const app = realApp();
    expect((await applyRequest(app, { slug: 'qa-closed-role' })).status).toBe(409);
    expect((await applyRequest(app, { slug: 'qa-archived-role' })).status).toBe(404);
    expect((await applyRequest(app, { slug: 'qa-draft-role' })).status).toBe(404);
    expect((await applyRequest(app, { slug: 'qa-expired-role' })).status).toBe(409);
    expect((await applyRequest(app, { slug: 'qa-unknown-role' })).status).toBe(404);
    expect(await Application.countDocuments({})).toBe(0);
    expect(intake.storedObjects()).toEqual([]);
  }, 30_000);

  it('CLOSE DURING APPLY: the Job is closed in MongoDB while the resume is stored -> 409, object removed, no record', async () => {
    const job = await publishedJob();
    const store = intake.storage.storePrivateResume.bind(intake.storage);
    intake.storage.storePrivateResume = async (request) => {
      const stored = await store(request);
      await closeJob(await Job.findById(job._id)); // a real, concurrent close, while the object is stored
      return stored;
    };
    const app = realApp();
    const response = await applyRequest(app);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('JOB_NOT_ACCEPTING_APPLICATIONS');
    expect(await Application.countDocuments({})).toBe(0);
    expect(intake.storedObjects()).toEqual([]);
    expect((await Job.findById(job._id).lean()).status).toBe('CLOSED');
  }, 30_000);

  it('the Job snapshot does not change when the Job is edited later (Doc 10 section 227)', async () => {
    const job = await publishedJob();
    expect((await applyRequest(realApp())).status).toBe(201);
    applyJobEdit(job, { title: 'QA Renamed Role', schedule: 'QA changed schedule' });
    await job.save();
    const record = await Application.findOne({}).lean();
    expect(record.jobSnapshot.title).toBe('QA Synthetic Apply Role');
    expect(record.jobSnapshot.schedule).toBe('QA TEST DATA schedule');
  }, 30_000);
});

describe('database failure after storage, for real (Doc 09 sections 119, 138; Doc 10 section 229)', () => {
  it('MongoDB goes away between the eligibility check and the insert: 503, nothing persisted, the object compensated', async () => {
    await publishedJob();
    const app = realApp({
      wrapJobs: (repo) => ({
        ...repo,
        async findJobEligibility(args) {
          const result = await repo.findJobEligibility(args);
          await mongoose.disconnect(); // the real connection is lost now
          return result;
        },
      }),
    });
    const response = await applyRequest(app);
    expect(response.status).toBe(503);
    expect(response.body.error).toEqual({ code: 'SERVICE_UNAVAILABLE', message: "We couldn't submit your application right now. Please try again." });
    expect(intake.storedObjects()).toEqual([]);
    expect(events('application_not_accepted')).toEqual([expect.objectContaining({ reason: 'APPLICATION_NOT_PERSISTED_DISCONNECTED', compensation: 'DELETED' })]);
    await mongoose.connect(TEST_URI, CONNECT);
    expect(await Application.countDocuments({})).toBe(0);
  }, 30_000);

  it('the REAL repository bound expires before a real insert completes: AMBIGUOUS/TIMEOUT, 503 (no claim), object kept; the save then commits, is logged PERSISTED, and a retry replays it', async () => {
    await publishedJob();
    // The real Application repository, with a short bound. Only the START of
    // the save is delayed past that bound; the save itself (validated B2 path,
    // write guards), the repository's race, timeout, classification and
    // `settled`, the majority read-back and the follow-up are all real.
    const bounded = createApplicationRepository({ timeoutMs: 150 });
    const app = realApp({
      wrapApplications: (repo) => ({
        ...repo,
        insert(document) {
          const realSave = document.save.bind(document);
          document.save = (...args) => new Promise((resolve) => setTimeout(resolve, 600)).then(() => realSave(...args));
          return bounded.insert(document);
        },
      }),
    });
    const key = randomUUID();
    const resume = { data: syntheticPdf(), filename: 'qa.pdf', contentType: PDF_MIME };
    const first = await applyRequest(app, { key, resume });
    expect(first.status).toBe(503);
    expect(first.body.error).toEqual({ code: 'SERVICE_UNAVAILABLE', message: "We couldn't submit your application right now. Please try again." });
    expect(events('application_persistence_ambiguous')).toEqual([expect.objectContaining({ reason: 'TIMEOUT', readBack: 'NOT_FOUND' })]);
    expect(intake.storedObjects()).toHaveLength(1); // kept: it may belong to a persisted Application
    await app.locals.applicationSubmission.drainFollowUps();
    const record = await Application.findOne({}).lean();
    expect(record).not.toBeNull();
    expect(fs.existsSync(objectPath(record.resume.storageKey))).toBe(true);
    expect(events('application_persistence_resolved')).toEqual([expect.objectContaining({ outcome: 'PERSISTED' })]);

    const retry = await applyRequest(realApp(), { key, resume });
    expect(retry.status).toBe(200);
    expect(retry.body.meta.replayed).toBe(true);
    expect(await Application.countDocuments({})).toBe(1);
    expect(intake.storedObjects()).toHaveLength(1);
  }, 30_000);

  it('an ambiguous outcome (injected: the insert reports a network failure and nothing was written): the real majority read-back finds nothing — 503, object kept and named; reconciliation can identify it as unreferenced', async () => {
    await publishedJob();
    const app = realApp({ wrapApplications: (repo) => ({ ...repo, insert: async () => ({ kind: 'AMBIGUOUS', reason: 'NETWORK', settled: null }) }) });
    expect((await applyRequest(app)).status).toBe(503);
    const [ambiguous] = events('application_persistence_ambiguous');
    expect(ambiguous.readBack).toBe('NOT_FOUND');
    // The log names the object only by its one-way reference — never the key or a path.
    expect(ambiguous.storageKey).toBeUndefined();
    expect(log.output()).not.toMatch(/resumes\/[0-9a-f]{32}/);
    expect(log.output()).not.toContain(intake.storageRoot);
    // Reconciliation (Doc 10 sections 207-209): LIST private storage, resolve the
    // reference to one object, and check MongoDB for a record referencing it.
    const listedKeys = intake.storedObjects().map((relative) => `resumes/${relative.split(/[\\/]/).join('/')}`);
    const matching = listedKeys.filter((key) => storageObjectRef(key) === ambiguous.objectRef);
    expect(matching).toHaveLength(1);
    expect(fs.existsSync(objectPath(matching[0]))).toBe(true);
    expect(await Application.countDocuments({ 'resume.storageKey': matching[0] })).toBe(0); // unreferenced: a possible orphan
  }, 30_000);

  it('the unique Application indexes are missing: 503 before anything is stored; restored, Applications are accepted again', async () => {
    await publishedJob();
    assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
    await mongoose.connection.db.collection('applications').dropIndex('idempotency_keyHash_unique');
    try {
      expect((await applyRequest(realApp())).status).toBe(503);
      expect(intake.storedObjects()).toEqual([]);
    } finally {
      await applyIndexes();
    }
    expect((await applyRequest(realApp())).status).toBe(201);
  }, 30_000);
});

/**
 * The write concern observed on the wire. `wtimeout` is the repository bound —
 * unless the test URI sets timeoutMS (client-side operation timeouts), in which
 * case the driver drops wtimeout and that timeout bounds the write instead.
 */
function expectApplicationWriteConcern(writeConcern) {
  const csot = /[?&]timeoutMS=/i.test(TEST_URI);
  expect(writeConcern).toEqual(csot ? { w: 'majority', j: true } : { w: 'majority', j: true, wtimeout: 5000 });
}

describe('the Application write-durability policy over a REAL connection (r2; r1 review finding 1)', () => {
  it('an UNSAFE connection (w=0 in the URI) cannot weaken it: the insert command carries { w: "majority", j: true, wtimeout }, the server acknowledges it, and the record is there for a majority read', async () => {
    const job = await publishedJob(); // written on the normal, acknowledged connection
    await mongoose.disconnect();
    // The test URI with its write concern forced to w=0 (replacing any w option it already has).
    const unsafeUri = /[?&]w=/.test(TEST_URI)
      ? TEST_URI.replace(/([?&])w=[^&]*/, '$1w=0')
      : `${TEST_URI}${TEST_URI.includes('?') ? '&' : '?'}w=0`;
    const insertWriteConcerns = [];
    let response;
    try {
      await mongoose.connect(unsafeUri, { ...CONNECT, monitorCommands: true });
      assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
      // The unsafe default really is in effect on this connection ...
      expect(mongoose.connection.db.writeConcern?.w).toBe(0);
      mongoose.connection.getClient().on('commandStarted', (event) => {
        if (event.commandName === 'insert' && event.command.insert === 'applications') insertWriteConcerns.push(event.command.writeConcern);
      });
      response = await applyRequest(realApp());
    } finally {
      await mongoose.disconnect();
      await mongoose.connect(TEST_URI, CONNECT);
    }
    // ... and the Application insert still went out under the policy.
    expect(insertWriteConcerns).toHaveLength(1);
    expectApplicationWriteConcern(insertWriteConcerns[0]);
    expect(response.status).toBe(201);
    const record = await Application.findOne({ jobId: job._id }).readConcern('majority').lean();
    expect(record).not.toBeNull();
    expect(record.submittedAt.toISOString()).toBe(response.body.data.submittedAt);
    expect(fs.existsSync(objectPath(record.resume.storageKey))).toBe(true);
  }, 30_000);

  it('the notification-state update is written under the same policy', async () => {
    await publishedJob();
    await mongoose.disconnect();
    const updates = [];
    try {
      await mongoose.connect(TEST_URI, { ...CONNECT, monitorCommands: true });
      mongoose.connection.getClient().on('commandStarted', (event) => {
        if (event.commandName === 'update' && event.command.update === 'applications') updates.push(event.command.writeConcern);
      });
      expect((await applyRequest(realApp({ transport: recordingTransport('PROVIDER_UNAVAILABLE') }))).status).toBe(201);
    } finally {
      await mongoose.disconnect();
      await mongoose.connect(TEST_URI, CONNECT);
    }
    expect(updates).toHaveLength(1);
    expectApplicationWriteConcern(updates[0]);
    expect((await Application.findOne({}).lean()).notifications.internal).toMatchObject({ status: 'FAILED', attemptCount: 1 });
  }, 30_000);
});

describe('expiry DURING the final eligibility read, over a real Job (r2; r1 review finding 3)', () => {
  it('closesAt passes while the real eligibility read is in progress: 409, no record, the stored object is compensated', async () => {
    const closesAt = new Date(Date.now() + 2_000);
    const job = await publishedJob('qa-synthetic-apply-role', { closesAt });
    const app = realApp({
      wrapJobs: (repo) => ({
        ...repo,
        async findJobEligibility(args) {
          const result = await repo.findJobEligibility(args); // the real read: the Job is still PUBLISHED with that closesAt
          await new Promise((resolve) => setTimeout(resolve, Math.max(0, closesAt.getTime() - Date.now() + 50)));
          return result;
        },
      }),
    });
    const response = await applyRequest(app);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('JOB_NOT_ACCEPTING_APPLICATIONS');
    expect(await Application.countDocuments({})).toBe(0);
    expect(intake.storedObjects()).toEqual([]);
    expect((await Job.findById(job._id).lean()).status).toBe('PUBLISHED'); // expiry, not a status change
  }, 30_000);
});

describe('the notification boundary over MongoDB (Doc 09 sections 128-136; Doc 18 section 127)', () => {
  it('a provider failure after persistence: 201, and FAILED / attemptCount 1 / the error code are persisted (validated save)', async () => {
    await publishedJob();
    const response = await applyRequest(realApp({ transport: recordingTransport('PROVIDER_UNAVAILABLE') }));
    expect(response.status).toBe(201);
    const record = await Application.findOne({}).lean();
    expect(record.notifications.internal).toMatchObject({ status: 'FAILED', attemptCount: 1, lastErrorCode: 'PROVIDER_UNAVAILABLE', sentAt: null });
    expect(record.notifications.internal.lastAttemptAt).toBeInstanceOf(Date);
    expect(intake.storedObjects()).toHaveLength(1);
  }, 30_000);

  it('a replay does not notify again', async () => {
    await publishedJob();
    const transport = recordingTransport('accept');
    const app = realApp({ transport });
    const key = randomUUID();
    const resume = { data: syntheticPdf(), filename: 'qa.pdf', contentType: PDF_MIME };
    await applyRequest(app, { key, resume });
    await applyRequest(app, { key, resume });
    expect(transport.calls).toHaveLength(1);
    expect((await Application.findOne({}).lean()).notifications.internal).toMatchObject({ status: 'SENT', attemptCount: 1 });
  }, 30_000);
});

// Fixture values kept referenced.
void qaAnswers;
