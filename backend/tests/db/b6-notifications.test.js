import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { Job } from '../../src/models/Job.js';
import { Application } from '../../src/models/Application.js';
import { REQUIRED_INDEXES } from '../../src/db/indexes.js';
import { createJobRepository } from '../../src/modules/jobs/job.repository.js';
import { publishJob } from '../../src/modules/jobs/job.service.js';
import { createApplicationRepository } from '../../src/modules/applications/application.repository.js';
import { createApplicationNotifier, runNotificationRetry, staleAfterMs } from '../../src/modules/applications/application.notifications.js';
import { createNotificationService } from '../../src/integrations/notifications/notificationService.js';
import { Readiness, DEPENDENCY_STATE } from '../../src/modules/health/readiness.js';
import { capturingLogger, testConfig } from '../helpers.js';
import { PDF_MIME, syntheticPdf } from '../fixtures/resumeFiles.js';
import { createIntakeEnvironment } from '../fixtures/uploadHarness.js';
import { QA_CANDIDATE, QA_NOTIFICATION_OPTIONS, applyRequest, recordingTransport } from '../fixtures/applyHarness.js';
import { requireTestDatabase, assertConnectedToTestDatabase } from './testDatabase.js';
import { clearSuppression, realSuppression, registerKeys } from './fixtures/suppression.js';

/**
 * B6 REAL-DATABASE SUITE — notification state, claims and retries against a
 * REAL MongoDB (Doc 09 sections 128-136; Doc 10 sections 117-122; Doc 14
 * sections 119-121; Doc 18 section 137).
 *
 * Real: the app, the Application repository over Mongoose (validated,
 * conditional saves under the write-durability policy), the indexes, local
 * private storage, the notifier and the Notification Service with its
 * templates. The TRANSPORT is a test double: this suite proves what reaches
 * the provider boundary and what MongoDB records — never that an email was
 * sent or delivered (Doc 17 section 388; the provider is AWAITING INPUT).
 * Synthetic data only; only the approved disposable test database is touched.
 */
const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const backendRoot = path.join(import.meta.dirname, '..', '..');
const CONNECT = { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false };
const DAY = 24 * 60 * 60 * 1000;
const POLICY = Object.freeze({ maxAttempts: 5, baseDelayMs: 60_000, staleMs: staleAfterMs({ notificationTimeoutMs: 2_000, databaseTimeoutMs: 5_000 }) });
const evidence = (entry) => {
  if (process.env.VALIDA_B6_EVIDENCE_FILE) fs.appendFileSync(process.env.VALIDA_B6_EVIDENCE_FILE, `${JSON.stringify(entry)}\n`);
};

async function clearSuiteCollections() {
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  await Application.deleteMany({});
  await Job.deleteMany({});
  await clearSuppression(TEST_DATABASE);
}

async function publishedJob({ publishedAgoMs = 60_000 } = {}) {
  const job = new Job({
    title: 'QA Synthetic Notification Role',
    slug: 'qa-synthetic-apply-role',
    location: { displayName: 'QA Region, Canada', countryCode: 'CA' },
    workArrangement: 'FULLY_REMOTE',
    employmentType: 'PART_TIME',
    schedule: 'QA TEST DATA schedule',
    weeklyHours: 30,
    compensation: { currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: true },
    description: 'QA TEST DATA description.',
    responsibilities: ['QA TEST DATA responsibility.'],
    requirements: ['QA TEST DATA requirement.'],
    applicationConfig: { resumeRequired: true, phone: { enabled: true, required: false }, message: { enabled: true, required: false, maxLength: 2000 }, screeningQuestions: [] },
  });
  await job.save();
  await publishJob(job, { now: new Date(Date.now() - publishedAgoMs) });
  return job;
}

beforeAll(async () => {
  await mongoose.connect(TEST_URI, CONNECT);
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  for (const required of REQUIRED_INDEXES) {
    await mongoose.connection.db.collection(required.collection).createIndex(required.key, { name: required.name, ...required.options });
  }
}, 30_000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(TEST_URI, CONNECT);
  await clearSuiteCollections();
  await mongoose.disconnect();
}, 30_000);

let intake;
let log;
// B7: acknowledgements pass the REAL suppression check (synthetic key, registered; empty register).
let suppression;
beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(TEST_URI, CONNECT);
  await clearSuiteCollections();
  suppression = realSuppression();
  await registerKeys(suppression);
  await publishedJob();
  log = capturingLogger();
  intake = await createIntakeEnvironment({ logger: log.logger });
});
afterEach(async () => {
  await intake.cleanup();
});

function realApp({ transport = null, acknowledgementEnabled = false, notificationTimeoutMs = 2000, clock } = {}) {
  const readiness = new Readiness();
  readiness.set('configuration', DEPENDENCY_STATE.READY);
  readiness.set('database', DEPENDENCY_STATE.READY);
  return createApp({
    config: testConfig({ applicationRateLimit: Object.freeze({ windowMs: 900_000, max: 1000 }) }),
    logger: log.logger,
    readiness,
    jobRepository: createJobRepository({ queryTimeoutMs: 5000 }),
    applicationRepository: createApplicationRepository({ timeoutMs: 5000 }),
    notificationService: createNotificationService({ transport, timeoutMs: notificationTimeoutMs, ...QA_NOTIFICATION_OPTIONS, acknowledgementEnabled }),
    resumeStorage: intake.storage,
    uploadArea: intake.uploadArea,
    clock,
    suppressionGate: suppression.gate,
  });
}

/** One accepted Application (201), its _id. */
async function accepted(options = {}) {
  const response = await applyRequest(realApp(options), { answers: [] });
  expect(response.status).toBe(201);
  const records = await Application.find({}, { _id: 1 }).sort({ submittedAt: -1, _id: -1 }).limit(1).lean();
  return records[0]._id;
}

/** The stored notification state, read on the majority snapshot. */
const storedNotifications = async (id) => (await Application.findById(id).readConcern('majority').lean()).notifications;
const plainState = ({ status, attemptCount, lastErrorCode, sentAt, lastAttemptAt }) => ({
  status,
  attemptCount,
  lastErrorCode,
  sentAtSet: sentAt instanceof Date,
  lastAttemptAtSet: lastAttemptAt instanceof Date,
});

function expectApplicationWriteConcern(writeConcern) {
  const csot = /[?&]timeoutMS=/i.test(TEST_URI);
  expect(writeConcern).toEqual(csot ? { w: 'majority', j: true } : { w: 'majority', j: true, wtimeout: 5000 });
}

function notifierWith({ transport = recordingTransport('accept'), acknowledgementEnabled = false, now = () => new Date() } = {}) {
  const applications = createApplicationRepository({ timeoutMs: 5000 });
  const notifications = createNotificationService({ transport, timeoutMs: 2000, clock: now, ...QA_NOTIFICATION_OPTIONS, acknowledgementEnabled });
  return { applications, transport, notifier: createApplicationNotifier({ applications, notifications, clock: now, logger: log.logger }) };
}

describe('both events over MongoDB (TEST-DOUBLE transport)', () => {
  it('acknowledgement enabled: both channels persisted SENT, one attempt each; each message to its own recipient', async () => {
    const transport = recordingTransport('accept');
    const id = await accepted({ transport, acknowledgementEnabled: true });
    await mongoose.disconnect();
    await mongoose.connect(TEST_URI, CONNECT);
    const notifications = await storedNotifications(id);
    expect(plainState(notifications.internal)).toEqual({ status: 'SENT', attemptCount: 1, lastErrorCode: null, sentAtSet: true, lastAttemptAtSet: true });
    expect(plainState(notifications.candidateAcknowledgement)).toEqual({ status: 'SENT', attemptCount: 1, lastErrorCode: null, sentAtSet: true, lastAttemptAtSet: true });
    expect(transport.calls.map((message) => [message.event, message.to[0]]).sort()).toEqual([
      ['APPLICATION_ACKNOWLEDGEMENT', QA_CANDIDATE.email],
      ['APPLICATION_RECEIVED_INTERNAL', QA_NOTIFICATION_OPTIONS.internalRecipient],
    ]);
    evidence({
      test: 'both events persisted',
      transport: 'TEST DOUBLE (not email evidence)',
      notifications: { internal: plainState(notifications.internal), candidateAcknowledgement: plainState(notifications.candidateAcknowledgement) },
      messages: transport.calls.map((message) => ({ event: message.event, to: message.event === 'APPLICATION_RECEIVED_INTERNAL' ? '<configured recruitment recipient>' : '<candidate (synthetic)>', subject: message.subject, hasText: message.text.length > 0, hasHtml: message.html.length > 0, tracking: message.tracking })),
    });
  });

  it('partial failure persisted: internal SENT, acknowledgement FAILED / SUPPRESSED; the Application and resume intact', async () => {
    const transport = recordingTransport((message) => (message.event === 'APPLICATION_ACKNOWLEDGEMENT' ? 'SUPPRESSED' : 'accept'));
    const id = await accepted({ transport, acknowledgementEnabled: true });
    const notifications = await storedNotifications(id);
    expect(plainState(notifications.internal)).toMatchObject({ status: 'SENT', attemptCount: 1 });
    expect(plainState(notifications.candidateAcknowledgement)).toEqual({ status: 'FAILED', attemptCount: 1, lastErrorCode: 'SUPPRESSED', sentAtSet: false, lastAttemptAtSet: true });
    const record = await Application.findById(id).lean();
    expect(record.status).toBe('RECEIVED');
    expect(fs.existsSync(path.join(intake.storageRoot, ...record.resume.storageKey.split('/')))).toBe(true);
  });

  it('acknowledgement disabled: NOT_REQUIRED persisted, never attempted', async () => {
    const id = await accepted({ transport: recordingTransport('accept') });
    const notifications = await storedNotifications(id);
    expect(plainState(notifications.candidateAcknowledgement)).toEqual({ status: 'NOT_REQUIRED', attemptCount: 0, lastErrorCode: null, sentAtSet: false, lastAttemptAtSet: false });
  });

  it('a replay over MongoDB sends nothing and changes no notification state', async () => {
    const transport = recordingTransport('accept');
    const app = realApp({ transport, acknowledgementEnabled: true });
    const key = randomUUID();
    const resume = { data: syntheticPdf(), filename: 'qa.pdf', contentType: PDF_MIME };
    expect((await applyRequest(app, { key, resume, answers: [] })).status).toBe(201);
    const before = await Application.findOne({}).lean();
    expect((await applyRequest(app, { key, resume, answers: [] })).status).toBe(200);
    expect(transport.calls).toHaveLength(2);
    expect((await Application.findOne({}).lean()).notifications).toEqual(before.notifications);
  });
});

describe('the conditional claim on a REAL MongoDB (duplicate-send protection)', () => {
  /*
   * The claim relies on MongoDB's single-document write atomicity: an update
   * whose filter includes the expected current values applies only if the
   * document still matches ("update if current"; MongoDB Manual, Atomicity
   * and Transactions — Concurrency Control). This probe checks the ENGINE
   * itself with the raw driver, independent of Valida code, so that a
   * failure of the races below on a MongoDB-compatible stand-in is diagnosed
   * as what it is. (FerretDB 1.x on SQLite does not provide it; FerretDB is
   * not MongoDB evidence.)
   */
  it('prerequisite: the database applies a conditional single-document update at most once under concurrency (raw driver probe)', async () => {
    assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
    const probe = mongoose.connection.db.collection('qa_b6_conditional_update_probe');
    let doubleMatches = 0;
    try {
      for (let round = 0; round < 20; round += 1) {
        await probe.deleteMany({});
        const { insertedId } = await probe.insertOne({ attempt: 0 });
        const results = await Promise.all([
          probe.updateOne({ _id: insertedId, attempt: 0 }, { $set: { attempt: 1, by: 'first' } }),
          probe.updateOne({ _id: insertedId, attempt: 0 }, { $set: { attempt: 1, by: 'second' } }),
        ]);
        if (results[0].matchedCount + results[1].matchedCount !== 1) doubleMatches += 1;
      }
    } finally {
      assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
      await probe.drop().catch(() => {});
    }
    evidence({ test: 'engine probe: conditional update atomicity', rounds: 20, roundsWithBothMatched: doubleMatches });
    expect(doubleMatches, 'this database engine applied BOTH concurrent conditional updates — it is not providing MongoDB single-document atomicity').toBe(0);
  });

  it('two concurrent claims from two independently loaded copies: exactly one CLAIMED, the other LOST — repeated 5 times', async () => {
    const applications = createApplicationRepository({ timeoutMs: 5000 });
    const rounds = [];
    for (let round = 0; round < 5; round += 1) {
      const id = await accepted(); // no transport: PENDING, attempt 0
      const [first, second] = [await applications.loadForUpdate(id), await applications.loadForUpdate(id)];
      const now = new Date();
      const results = await Promise.all([
        applications.claimNotificationAttempts(first, ['internal'], { now }),
        applications.claimNotificationAttempts(second, ['internal'], { now }),
      ]);
      rounds.push(results);
      expect([...results].sort()).toEqual(['CLAIMED', 'LOST']);
      expect(plainState((await storedNotifications(id)).internal)).toEqual({
        status: 'PENDING',
        attemptCount: 1,
        lastErrorCode: 'ATTEMPT_IN_PROGRESS',
        sentAtSet: false,
        lastAttemptAtSet: true,
      });
      // Only the winner can record; the loser's copy is stale.
      const [winner, loser] = results[0] === 'CLAIMED' ? [first, second] : [second, first];
      expect(await applications.recordNotificationOutcomes(loser, { internal: { status: 'FAILED', errorCode: 'TIMEOUT' } })).toBe('LOST');
      expect(await applications.recordNotificationOutcomes(winner, { internal: { status: 'SENT', sentAt: new Date() } })).toBe('RECORDED');
      expect(plainState((await storedNotifications(id)).internal)).toEqual({ status: 'SENT', attemptCount: 1, lastErrorCode: null, sentAtSet: true, lastAttemptAtSet: true });
    }
    evidence({ test: 'conditional claim race on MongoDB', rounds: rounds.map((results) => [...results].sort()) });
  });

  it('two concurrent retry cycles: the provider boundary is reached ONCE', async () => {
    const id = await accepted();
    const { applications, notifier, transport } = notifierWith();
    const [first, second] = [await applications.loadForUpdate(id), await applications.loadForUpdate(id)];
    const results = await Promise.all([notifier.retry(first, ['internal']), notifier.retry(second, ['internal'])]);
    expect(results.map((result) => result.attempted).sort()).toEqual([false, true]);
    expect(transport.calls).toHaveLength(1);
    expect(plainState((await storedNotifications(id)).internal)).toMatchObject({ status: 'SENT', attemptCount: 1 });
  });

  it('on the wire: the claim and the outcome are conditional updates of the notification paths only, under the write-durability policy', async () => {
    await mongoose.disconnect();
    const updates = [];
    let id;
    try {
      await mongoose.connect(TEST_URI, { ...CONNECT, monitorCommands: true });
      mongoose.connection.getClient().on('commandStarted', (event) => {
        if (event.commandName === 'update' && event.command.update === 'applications') updates.push(event.command);
      });
      id = await accepted({ transport: recordingTransport('PROVIDER_UNAVAILABLE') });
    } finally {
      await mongoose.disconnect();
      await mongoose.connect(TEST_URI, CONNECT);
    }
    expect(updates).toHaveLength(2);
    const [claim, outcome] = updates.map((command) => ({ filter: command.updates[0].q, update: command.updates[0].u, writeConcern: command.writeConcern }));
    expect(claim.filter).toEqual({
      _id: id,
      'notifications.internal.status': 'PENDING',
      'notifications.internal.attemptCount': 0,
      'notifications.internal.lastErrorCode': null,
    });
    expect(outcome.filter).toEqual({ _id: id, 'notifications.internal.attemptCount': 1, 'notifications.internal.lastErrorCode': 'ATTEMPT_IN_PROGRESS' });
    for (const { update, writeConcern } of [claim, outcome]) {
      expectApplicationWriteConcern(writeConcern);
      const paths = Object.values(update).flatMap((operator) => Object.keys(operator));
      expect(paths.length).toBeGreaterThan(0);
      for (const updatedPath of paths) expect(updatedPath).toMatch(/^(notifications\.internal(\.|$)|updatedAt$)/);
    }
    expect(plainState((await storedNotifications(id)).internal)).toEqual({ status: 'FAILED', attemptCount: 1, lastErrorCode: 'PROVIDER_UNAVAILABLE', sentAtSet: false, lastAttemptAtSet: true });
    evidence({
      test: 'conditional updates on the wire',
      claim: { filterPaths: Object.keys(claim.filter).map((key) => (key === '_id' ? '_id (<ObjectId>)' : key)), writeConcern: claim.writeConcern },
      outcome: { filterPaths: Object.keys(outcome.filter).map((key) => (key === '_id' ? '_id (<ObjectId>)' : key)), writeConcern: outcome.writeConcern },
    });
  });

  it('an UNSAFE connection (w=0 in the URI) cannot weaken the claim or the outcome: both carry the policy and are acknowledged', async () => {
    await mongoose.disconnect();
    const unsafeUri = /[?&]w=/.test(TEST_URI) ? TEST_URI.replace(/([?&])w=[^&]*/, '$1w=0') : `${TEST_URI}${TEST_URI.includes('?') ? '&' : '?'}w=0`;
    const writeConcerns = [];
    let id;
    try {
      await mongoose.connect(unsafeUri, { ...CONNECT, monitorCommands: true });
      assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
      expect(mongoose.connection.db.writeConcern?.w).toBe(0);
      mongoose.connection.getClient().on('commandStarted', (event) => {
        if (event.commandName === 'update' && event.command.update === 'applications') writeConcerns.push(event.command.writeConcern);
      });
      id = await accepted({ transport: recordingTransport('accept') });
    } finally {
      await mongoose.disconnect();
      await mongoose.connect(TEST_URI, CONNECT);
    }
    expect(writeConcerns).toHaveLength(2);
    writeConcerns.forEach((writeConcern) => expectApplicationWriteConcern(writeConcern));
    expect(plainState((await storedNotifications(id)).internal)).toMatchObject({ status: 'SENT', attemptCount: 1 });
  });

  it('B2 protections stay effective: a copy whose submission history was altered cannot claim — nothing is written, nothing sent', async () => {
    const id = await accepted();
    const { applications, notifier, transport } = notifierWith();
    const tampered = await applications.loadForUpdate(id);
    tampered.candidate.fullName = 'QA Altered Name';
    await expect(applications.claimNotificationAttempts(tampered, ['internal'], { now: new Date() })).rejects.toBeInstanceOf(mongoose.Error.ValidationError);
    const again = await applications.loadForUpdate(id);
    again.candidate.fullName = 'QA Altered Name';
    expect(await notifier.retry(again, ['internal'])).toEqual({ attempted: false, reason: 'CLAIM_FAILED' });
    expect(transport.calls).toHaveLength(0);
    const record = await Application.findById(id).lean();
    expect(record.candidate.fullName).toBe(QA_CANDIDATE.fullName);
    expect(plainState(record.notifications.internal)).toMatchObject({ status: 'PENDING', attemptCount: 0, lastErrorCode: null });
    // And the general query-update path stays closed.
    await expect(Application.updateOne({ _id: id }, { $set: { 'notifications.internal.status': 'SENT' } })).rejects.toThrow();
  });

  it('an outcome that cannot be recorded stays ATTEMPT_IN_PROGRESS in MongoDB and is never re-sent automatically', async () => {
    const id = await accepted();
    const { applications, transport } = notifierWith();
    const failingRecord = { ...applications, recordNotificationOutcomes: async () => Promise.reject(new Error('qa: record lost')) };
    const notifier = createApplicationNotifier({
      applications: failingRecord,
      notifications: createNotificationService({ transport, timeoutMs: 2000, ...QA_NOTIFICATION_OPTIONS }),
      clock: () => new Date(),
      logger: log.logger,
    });
    const result = await notifier.retry(await applications.loadForUpdate(id), ['internal']);
    expect(result).toMatchObject({ attempted: true, recorded: false });
    expect(plainState((await storedNotifications(id)).internal)).toEqual({ status: 'PENDING', attemptCount: 1, lastErrorCode: 'ATTEMPT_IN_PROGRESS', sentAtSet: false, lastAttemptAtSet: true });
    // A day later, a retry run (without --include-uncertain) does not send it.
    const later = () => new Date(Date.now() + DAY);
    const run = notifierWith({ now: later });
    const report = await runNotificationRetry({ applications: run.applications, notifier: run.notifier, clock: later, policy: POLICY, send: true });
    expect(report.due).toBe(0);
    expect(run.transport.calls).toHaveLength(0);
  });
});

describe('the retry run over MongoDB (ops:notifications:retry core)', () => {
  async function population() {
    return {
      unattempted: await accepted(),
      transient: await accepted({ transport: recordingTransport('PROVIDER_UNAVAILABLE') }),
      suppressed: await accepted({ transport: recordingTransport('SUPPRESSED') }),
      timeout: await accepted({ transport: recordingTransport('hang'), notificationTimeoutMs: 150 }),
      configuration: await accepted({ transport: recordingTransport('SENDER_NOT_VERIFIED') }),
      sent: await accepted({ transport: recordingTransport('accept') }),
    };
  }

  it('dry run, then --send: only the eligible notifications are attempted; the rest are left exactly as stored', async () => {
    const ids = await population();
    const later = () => new Date(Date.now() + DAY);
    const before = await Application.find({}).lean();

    const dry = notifierWith({ now: later });
    const dryReport = await runNotificationRetry({ applications: dry.applications, notifier: dry.notifier, clock: later, policy: POLICY });
    expect(dryReport.due).toBe(2);
    expect(dryReport.items.map((item) => item.applicationId).sort()).toEqual([String(ids.unattempted), String(ids.transient)].sort());
    expect(await Application.find({}).lean()).toEqual(before);
    expect(dry.transport.calls).toHaveLength(0);

    const summary = await dry.applications.summarizeNotificationStates({ maxAttempts: 1 });
    expect(summary.internal.states).toEqual([
      { status: 'FAILED', code: 'PROVIDER_UNAVAILABLE', count: 1 },
      { status: 'FAILED', code: 'SENDER_NOT_VERIFIED', count: 1 },
      { status: 'FAILED', code: 'SUPPRESSED', count: 1 },
      { status: 'FAILED', code: 'TIMEOUT', count: 1 },
      { status: 'PENDING', code: null, count: 1 },
      { status: 'SENT', code: null, count: 1 },
    ]);
    // With maxAttempts 1, the four FAILED channels (one attempt each) count as exhausted.
    expect(summary.internal.exhausted).toBe(4);
    expect(summary.candidateAcknowledgement).toEqual({ states: [{ status: 'NOT_REQUIRED', code: null, count: 6 }], exhausted: 0 });

    const send = notifierWith({ now: later });
    const report = await runNotificationRetry({ applications: send.applications, notifier: send.notifier, clock: later, policy: POLICY, send: true });
    expect(report.results).toEqual({ SENT: 2, FAILED: 0, CLAIM_LOST: 0, CLAIM_FAILED: 0, NOT_ATTEMPTED: 0, UNRECORDED: 0, NOT_LOADED: 0, NO_LONGER_DUE: 0 });
    expect(send.transport.calls).toHaveLength(2);
    const after = Object.fromEntries(await Promise.all(Object.entries(ids).map(async ([name, id]) => [name, plainState((await storedNotifications(id)).internal)])));
    expect(after).toEqual({
      unattempted: { status: 'SENT', attemptCount: 1, lastErrorCode: null, sentAtSet: true, lastAttemptAtSet: true },
      transient: { status: 'SENT', attemptCount: 2, lastErrorCode: null, sentAtSet: true, lastAttemptAtSet: true },
      suppressed: { status: 'FAILED', attemptCount: 1, lastErrorCode: 'SUPPRESSED', sentAtSet: false, lastAttemptAtSet: true },
      timeout: { status: 'FAILED', attemptCount: 1, lastErrorCode: 'TIMEOUT', sentAtSet: false, lastAttemptAtSet: true },
      configuration: { status: 'FAILED', attemptCount: 1, lastErrorCode: 'SENDER_NOT_VERIFIED', sentAtSet: false, lastAttemptAtSet: true },
      sent: { status: 'SENT', attemptCount: 1, lastErrorCode: null, sentAtSet: true, lastAttemptAtSet: true },
    });
    // A second run has nothing left to do: no duplicate.
    const again = notifierWith({ now: later });
    expect((await runNotificationRetry({ applications: again.applications, notifier: again.notifier, clock: later, policy: POLICY, send: true })).due).toBe(0);
    expect(again.transport.calls).toHaveLength(0);
    evidence({ test: 'retry run over MongoDB', dryRunDue: dryReport.due, sendResults: report.results, finalStates: after, summaryBefore: summary });
  });

  it('not yet due, on MongoDB: inside its backoff / grace period a row is not even scanned; once the time has passed it is', async () => {
    const unattempted = await accepted(); // PENDING, never attempted, submitted now (grace period 60 s)
    const transient = await accepted({ transport: recordingTransport('PROVIDER_UNAVAILABLE') }); // FAILED once now (backoff 60 s)
    const dryRunAt = (now) => {
      const run = notifierWith({ now: () => now });
      return runNotificationRetry({ applications: run.applications, notifier: run.notifier, clock: () => now, policy: POLICY });
    };
    const early = await dryRunAt(new Date(Date.now() + 30_000));
    expect(early).toMatchObject({ scanned: 0, due: 0 });
    const late = await dryRunAt(new Date(Date.now() + 2 * 60_000));
    expect(late.scanned).toBe(2);
    expect(late.items.map((item) => item.applicationId).sort()).toEqual([String(unattempted), String(transient)].sort());
    evidence({ test: 'due filter dates on MongoDB', scannedAtPlus30s: early.scanned, scannedAtPlus2min: late.scanned });
  });

  it('r2: states this code never writes (legacy code, FAILED without a code, PENDING attempted without a marker) are selected on MongoDB ONLY with includeUncertain', async () => {
    const ids = {};
    const states = {
      legacyCode: { status: 'FAILED', attemptCount: 1, lastErrorCode: 'LEGACY_PROVIDER_ERROR' },
      failedWithoutCode: { status: 'FAILED', attemptCount: 1, lastErrorCode: null },
      pendingWithoutMarker: { status: 'PENDING', attemptCount: 2, lastErrorCode: null },
    };
    for (const [name, values] of Object.entries(states)) {
      const id = await accepted();
      // Written through the validated document save (notification paths only).
      const document = await Application.findById(id);
      Object.assign(document.notifications.internal, values, { lastAttemptAt: new Date(Date.now() - 60 * 60 * 1000) });
      await document.save();
      ids[name] = String(id);
    }
    const later = () => new Date(Date.now() + DAY);
    const dryRun = (includeUncertain) => {
      const run = notifierWith({ now: later });
      return runNotificationRetry({ applications: run.applications, notifier: run.notifier, clock: later, policy: POLICY, includeUncertain });
    };
    const automatic = await dryRun(false);
    for (const id of Object.values(ids)) expect(automatic.items.map((item) => item.applicationId)).not.toContain(id);
    const operator = await dryRun(true);
    expect(operator.items.map((item) => item.applicationId).sort()).toEqual(Object.values(ids).sort());
    expect(operator.categories.internal).toEqual({ UNCERTAIN: 3 });
    evidence({ test: 'unwritten states on MongoDB', selectedAutomatically: automatic.items.length, selectedWithIncludeUncertain: operator.items.length });
  });

  it('two concurrent --send runs over MongoDB: each eligible notification reaches the provider boundary once', async () => {
    const ids = [await accepted(), await accepted(), await accepted()];
    const later = () => new Date(Date.now() + DAY);
    const runs = [notifierWith({ now: later }), notifierWith({ now: later })];
    const reports = await Promise.all(runs.map((run) => runNotificationRetry({ applications: run.applications, notifier: run.notifier, clock: later, policy: POLICY, send: true })));
    expect(runs[0].transport.calls.length + runs[1].transport.calls.length).toBe(3);
    expect(reports[0].results.SENT + reports[1].results.SENT).toBe(3);
    for (const id of ids) expect(plainState((await storedNotifications(id)).internal)).toMatchObject({ status: 'SENT', attemptCount: 1 });
    evidence({ test: 'concurrent retry runs over MongoDB', sent: [reports[0].results, reports[1].results] });
  });

  it('the command as a PROCESS (dry run) against the test database: reports, writes nothing, prints no candidate data', async () => {
    // An Application accepted two days ago whose notification failed transiently: due now.
    await Job.deleteMany({});
    await publishedJob({ publishedAgoMs: 3 * DAY });
    const twoDaysAgo = () => new Date(Date.now() - 2 * DAY);
    const id = await accepted({ transport: recordingTransport('PROVIDER_UNAVAILABLE'), clock: twoDaysAgo });
    const before = await Application.find({}).lean();
    const result = spawnSync(process.execPath, ['scripts/notifications-retry.mjs', '--limit', '10'], {
      cwd: backendRoot,
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, MONGODB_URI: TEST_URI, LOG_LEVEL: 'silent' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status, output).toBe(0);
    expect(output).toMatch(/mode: DRY RUN/);
    expect(output).toContain(`database: ${TEST_DATABASE}`);
    expect(output).toMatch(/FAILED \/ PROVIDER_UNAVAILABLE/);
    expect(output).toMatch(/scanned: 1 Application\(s\) with a notification due now/);
    expect(output).toContain(`${String(id)}  internal  WOULD_SEND`);
    // B7: one coverage line (design rev 8 §5) — this process has no suppression key, so acknowledgements are blocked.
    expect(output).toMatch(/suppression coverage: COVERAGE_INCOMPLETE \(CURRENT_KEY_MISSING\) — candidate acknowledgements are blocked/);
    expect(await Application.find({}).lean()).toEqual(before);
    for (const marker of [QA_CANDIDATE.fullName, QA_CANDIDATE.email, TEST_URI]) expect(output).not.toContain(marker);
    evidence({ test: 'retry command dry run (process)', exitCode: result.status, stdout: result.stdout.split('\n').filter(Boolean) });
  }, 60_000);
});
