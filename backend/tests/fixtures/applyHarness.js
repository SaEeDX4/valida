import mongoose from 'mongoose';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { Job } from '../../src/models/Job.js';
import { Readiness, DEPENDENCY_STATE } from '../../src/modules/health/readiness.js';
import { ApplicationIndexesMissingError, REPLAY_PROJECTION } from '../../src/modules/applications/application.repository.js';
import { DatabaseUnavailableError } from '../../src/modules/jobs/job.repository.js';
import { createNotificationService } from '../../src/integrations/notifications/notificationService.js';
import { capturingLogger, testConfig } from '../helpers.js';
import { PDF_MIME, syntheticPdf } from './resumeFiles.js';
import { createIntakeEnvironment } from './uploadHarness.js';

/**
 * OFFLINE B5 HARNESS — synthetic data only (Doc 17 sections 25-30).
 *
 * Runs the REAL Apply route: createApp, the real middleware stack, the B4
 * multipart parser and resume validator, REAL local private storage in a
 * fresh `valida-b4-test-*` root, the real submission service and the real
 * notification boundary. Only the two DATABASE repositories are in-memory
 * stand-ins implementing the same contract, so every database failure mode
 * (outage, definite failure, ambiguous outcome, lost race) can be produced on
 * demand. They are not evidence of persistence: that, the unique indexes and
 * real concurrency are proven by the real-database suite (tests/db).
 */

export const applyPath = (slug) => `/api/v1/jobs/${slug}/applications`;

/** Deep copy that keeps Dates and BSON ObjectIds intact (structuredClone would strip ObjectId). */
export function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof mongoose.Types.ObjectId) return new mongoose.Types.ObjectId(value.toHexString());
  if (Array.isArray(value)) return value.map(clone);
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = clone(item);
  return out;
}
export const QA_TEXT_QUESTION_ID = '55555555-5555-4555-8555-555555555555';
export const QA_LONG_QUESTION_ID = '66666666-6666-4666-8666-666666666666';
export const QA_YES_NO_QUESTION_ID = '11111111-1111-4111-8111-111111111111';
export const QA_SELECT_QUESTION_ID = '22222222-2222-4222-8222-222222222222';
export const QA_OPTION_A = '33333333-3333-4333-8333-333333333333';
export const QA_OPTION_B = '44444444-4444-4444-8444-444444444444';
export const QA_NOW = new Date('2026-10-05T12:00:00.000Z');

/** Synthetic candidate values — never real personal data. */
export const QA_CANDIDATE = Object.freeze({
  fullName: 'QA Synthetic Candidate',
  email: 'QA.Candidate+b5@Example.INVALID',
  phone: '+1 (555) 010-0199',
  message: 'QA TEST DATA message line one.\nQA TEST DATA line two.',
});

/**
 * A Job as the repository's lean read returns it, built through the REAL Job
 * model (defaults, identifiers, validation) — synthetic content only.
 */
export function qaJob(overrides = {}, { questions = true } = {}) {
  const document = new Job({
    title: 'QA Synthetic Apply Role',
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
    applicationConfig: {
      resumeRequired: true,
      phone: { enabled: true, required: false },
      message: { enabled: true, required: false, maxLength: 2000 },
      screeningQuestions: questions
        ? [
            { questionId: QA_YES_NO_QUESTION_ID, type: 'YES_NO', prompt: 'QA TEST DATA: can you work the stated hours?', required: true },
            {
              questionId: QA_SELECT_QUESTION_ID,
              type: 'SINGLE_SELECT',
              prompt: 'QA TEST DATA: preferred start window?',
              required: false,
              options: [
                { optionId: QA_OPTION_A, label: 'QA option A' },
                { optionId: QA_OPTION_B, label: 'QA option B' },
              ],
            },
            { questionId: QA_TEXT_QUESTION_ID, type: 'SHORT_TEXT', prompt: 'QA TEST DATA: short answer?', required: false },
            { questionId: QA_LONG_QUESTION_ID, type: 'LONG_TEXT', prompt: 'QA TEST DATA: long answer?', required: false },
          ]
        : [],
    },
    status: 'PUBLISHED',
    publishedAt: new Date('2026-09-20T09:30:00.000Z'),
    closesAt: null,
  });
  const plain = document.toObject({ depopulate: true });
  return { ...plain, ...overrides };
}

/** A valid set of answers for qaJob(). */
export const qaAnswers = () => [
  { questionId: QA_YES_NO_QUESTION_ID, answer: true },
  { questionId: QA_SELECT_QUESTION_ID, answer: QA_OPTION_B },
  { questionId: QA_TEXT_QUESTION_ID, answer: '  QA TEST DATA short  ' },
];

/** In-memory Job repository with the Apply methods' contract (visibility as publicDetailFilter). */
export function memoryJobRepository(initial = []) {
  const jobs = new Map(initial.map((job) => [String(job._id), clone(job)]));
  const faults = { findJobForApplication: null, findJobEligibility: null };
  const calls = { findJobForApplication: 0, findJobEligibility: 0 };
  const repo = {
    jobs,
    faults,
    calls,
    put(job) {
      jobs.set(String(job._id), clone(job));
    },
    update(jobId, patch) {
      const current = jobs.get(String(jobId));
      jobs.set(String(jobId), { ...current, ...patch });
    },
    async findJobForApplication({ slug, now }) {
      calls.findJobForApplication += 1;
      if (faults.findJobForApplication) throw faults.findJobForApplication;
      const job = [...jobs.values()].find((candidate) => candidate.slug === slug);
      if (!job || !['PUBLISHED', 'CLOSED'].includes(job.status) || !(job.publishedAt <= now)) return null;
      return clone(job);
    },
    async findJobEligibility({ jobId }) {
      calls.findJobEligibility += 1;
      if (repo.beforeEligibility) await repo.beforeEligibility();
      if (faults.findJobEligibility) throw faults.findJobEligibility;
      const job = jobs.get(String(jobId));
      return job ? { _id: job._id, status: job.status, publishedAt: job.publishedAt, closesAt: job.closesAt } : null;
    },
    async listOpenJobs() {
      return { total: 0, jobs: [] };
    },
    async findPublicJobBySlug() {
      return null;
    },
  };
  return repo;
}

const pick = (record, projection) => {
  const out = {};
  for (const path of Object.keys(projection)) {
    const [head, tail] = path.split('.');
    if (tail === undefined) out[head] = clone(record[head]);
    else if (Array.isArray(record[head])) {
      out[head] ??= record[head].map(() => ({}));
      record[head].forEach((item, index) => {
        out[head][index][tail] = item[tail];
      });
    } else {
      out[head] ??= {};
      out[head][tail] = clone(record[head]?.[tail]);
    }
  }
  return out;
};

/**
 * In-memory Application repository with the real repository's contract,
 * emulating the two UNIQUE indexes (key hash, storage key). Validation is the
 * REAL model validation (`document.validate()`).
 *
 * Fault injection:
 *   faults.findByKeyHash        an error to throw from the next lookups
 *   faults.indexesMissing       assertUniqueIndexes() refuses
 *   nextInsert                  { kind, reason, persist, settleAfterMs, settleAs } — settleAs is
 *                               the kind the abandoned save settles with ('CREATED' writes it)
 *   insertGate                  a promise every insert awaits first (races)
 *   faults.recordNotification   an error to throw when recording notification state
 */
export function memoryApplicationRepository() {
  const records = new Map(); // keyHash -> plain record
  const faults = { findByKeyHash: null, indexesMissing: false, recordNotification: null, readBackAfterAmbiguity: undefined };
  const calls = { insert: 0, findByKeyHash: 0, majorityReads: 0, recordInternalNotification: 0 };
  const repo = {
    records,
    faults,
    calls,
    nextInsert: null,
    insertGate: null,
    all: () => [...records.values()],
    async findByKeyHash(keyHash, { majority = false } = {}) {
      calls.findByKeyHash += 1;
      if (majority) calls.majorityReads += 1;
      if (faults.findByKeyHash) throw faults.findByKeyHash;
      const record = records.get(keyHash);
      return record ? pick(record, REPLAY_PROJECTION) : null;
    },
    async assertUniqueIndexes() {
      if (faults.indexesMissing) throw new ApplicationIndexesMissingError();
    },
    async insert(document) {
      calls.insert += 1;
      if (repo.insertGate) await repo.insertGate;
      const scripted = repo.nextInsert;
      repo.nextInsert = null;
      const persist = () => {
        const record = document.toObject({ depopulate: true });
        const keyHash = record.idempotency.keyHash;
        if (records.has(keyHash)) return 'DUPLICATE_KEY_HASH';
        if ([...records.values()].some((existing) => existing.resume.storageKey === record.resume.storageKey)) return 'DUPLICATE_OTHER';
        records.set(keyHash, record);
        document.isNew = false;
        return 'CREATED';
      };
      try {
        await document.validate();
      } catch (error) {
        return { kind: 'INVALID', reason: 'VALIDATION', error };
      }
      if (scripted) {
        if (scripted.kind === 'AMBIGUOUS') {
          if (scripted.settleAfterMs !== undefined) {
            const settled = new Promise((resolve) => {
              setTimeout(() => resolve(scripted.settleAs === 'CREATED' ? persist() : scripted.settleAs), scripted.settleAfterMs);
            });
            return { kind: 'AMBIGUOUS', reason: 'TIMEOUT', settled };
          }
          if (scripted.persist) persist();
          return { kind: 'AMBIGUOUS', reason: scripted.reason ?? 'NETWORK', settled: null };
        }
        // `persist` with a duplicate kind: the record IS written, yet the
        // duplicate refusal is reported (a retried insert whose first attempt
        // was applied).
        if (scripted.persist) persist();
        return { kind: scripted.kind, reason: scripted.reason ?? 'SCRIPTED' };
      }
      const kind = persist();
      return kind === 'CREATED' ? { kind } : { kind, reason: kind };
    },
    async isStorageKeyReferenced(storageKey) {
      return [...records.values()].some((record) => record.resume.storageKey === storageKey);
    },
    async loadForUpdate(id) {
      const record = [...records.values()].find((candidate) => String(candidate._id) === String(id));
      if (!record) return null;
      return { _id: record._id, notifications: clone(record.notifications) };
    },
    async recordInternalNotification(document, outcome) {
      calls.recordInternalNotification += 1;
      if (faults.recordNotification) throw faults.recordNotification;
      const internal = document.notifications.internal;
      internal.status = outcome.status;
      internal.attemptCount = (internal.attemptCount ?? 0) + 1;
      internal.lastAttemptAt = outcome.attemptedAt;
      if (outcome.status === 'SENT') {
        internal.sentAt = outcome.sentAt;
        internal.lastErrorCode = null;
      } else internal.lastErrorCode = outcome.errorCode;
      const record = [...records.values()].find((candidate) => String(candidate._id) === String(document._id));
      record.notifications.internal = clone(
        typeof internal.toObject === 'function' ? internal.toObject() : { ...internal },
      );
    },
  };
  return repo;
}

/** A transport double for the notification boundary — records calls; never sends anything. */
export function recordingTransport(behaviour = 'accept') {
  const transport = {
    calls: [],
    signals: [],
    async send(message, { signal }) {
      transport.calls.push(clone(message));
      transport.signals.push(signal);
      if (behaviour === 'accept') return { accepted: true };
      if (behaviour === 'hang') return new Promise(() => {});
      if (typeof behaviour === 'string') throw Object.assign(new Error('QA transport failure'), { notificationCode: behaviour });
      throw behaviour;
    },
  };
  return transport;
}

/**
 * A complete offline Apply environment: real storage + upload area, in-memory
 * repositories, the real app.
 */
export async function createApplyEnvironment({
  jobs = [qaJob()],
  transport = null,
  notificationTimeoutMs = 2_000,
  clock = () => QA_NOW,
  configOverrides = {},
  storageOptions = {},
  storage: storageOverride,
  withStorage = true,
} = {}) {
  const log = capturingLogger();
  const intake = withStorage ? await createIntakeEnvironment({ logger: log.logger, storageOptions }) : null;
  const jobRepository = memoryJobRepository(jobs);
  const applicationRepository = memoryApplicationRepository();
  const notificationService = createNotificationService({ transport, timeoutMs: notificationTimeoutMs, clock });
  const readiness = new Readiness();
  readiness.set('configuration', DEPENDENCY_STATE.READY);
  const config = testConfig({
    applicationRateLimit: Object.freeze({ windowMs: 900_000, max: 1000 }),
    ...configOverrides,
  });
  const storage = storageOverride ?? intake?.storage ?? null;
  const app = createApp({
    config,
    logger: log.logger,
    readiness,
    jobRepository,
    applicationRepository,
    notificationService,
    clock,
    resumeStorage: storage,
    uploadArea: intake?.uploadArea ?? null,
  });
  return {
    app,
    log,
    intake,
    storage,
    jobs: jobRepository,
    applications: applicationRepository,
    transport,
    submission: app.locals.applicationSubmission,
    storedObjects: () => intake?.storedObjects() ?? [],
    tempFiles: () => intake?.tempFiles() ?? [],
    async cleanup() {
      await app.locals.applicationSubmission.drainFollowUps();
      await intake?.cleanup();
    },
  };
}

/** A supertest Apply request with synthetic defaults; every part can be overridden or removed (null). */
export function applyRequest(app, {
  slug = 'qa-synthetic-apply-role',
  key = randomUUID(),
  fields = {},
  answers = qaAnswers(),
  resume = { data: syntheticPdf(), filename: 'qa-resume.pdf', contentType: PDF_MIME },
} = {}) {
  let call = request(app).post(applyPath(slug));
  if (key !== null) call = call.set('Idempotency-Key', key);
  const values = { fullName: QA_CANDIDATE.fullName, email: QA_CANDIDATE.email, ...fields };
  for (const [name, value] of Object.entries(values)) {
    if (value !== null && value !== undefined) call = call.field(name, value);
  }
  if (answers !== null) call = call.field('screeningAnswers', typeof answers === 'string' ? answers : JSON.stringify(answers));
  if (resume !== null) call = call.attach('resume', resume.data, { filename: resume.filename, contentType: resume.contentType });
  return call;
}

export const dbUnavailable = (reason = 'query_failed') => new DatabaseUnavailableError(reason);
export { mongoose };
