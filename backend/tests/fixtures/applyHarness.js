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
import { openSuppressionGate } from './suppressionDoubles.js';

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
 *   faults.recordNotification   an error to throw when recording notification outcomes
 *   faults.claimNotification    an error to throw when claiming a notification attempt (nothing written)
 *   faults.claimNotificationAppliedThenFails  an error to throw AFTER the claim was applied (unknown outcome)
 *   faults.loadForUpdate        an error to throw when loading an Application for update
 */
/*
 * A minimal MongoDB filter matcher for the notification scan — the operators
 * notificationDueFilter uses: equality (null matches null or missing), $in,
 * $nin (null in the list excludes null AND missing), $gt, $gte, $lt, $lte
 * (never match null or missing) and $or. Anything else is a test defect and
 * throws.
 */
const comparable = (value) => (value instanceof Date ? value.getTime() : value);
// MongoDB compares only within one type bracket: a date never orders against a number or a string.
const sameType = (a, b) => a instanceof Date === b instanceof Date && typeof a === typeof b;
function matchesCondition(value, condition) {
  if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
    return Object.entries(condition).every(([operator, operand]) => {
      switch (operator) {
        case '$in':
          return operand.some((item) => matchesCondition(value, item ?? null));
        case '$nin':
          return !operand.some((item) => matchesCondition(value, item ?? null));
        case '$gt':
          return value != null && sameType(value, operand) && comparable(value) > comparable(operand);
        case '$lt':
          return value != null && sameType(value, operand) && comparable(value) < comparable(operand);
        case '$lte':
          return value != null && sameType(value, operand) && comparable(value) <= comparable(operand);
        case '$gte':
          return value != null && sameType(value, operand) && comparable(value) >= comparable(operand);
        default:
          throw new Error(`matchesFilter: unsupported operator ${operator}`);
      }
    });
  }
  if (value != null && condition != null && !sameType(value, condition)) return false;
  return comparable(value ?? null) === comparable(condition ?? null);
}
export function matchesFilter(record, filter) {
  return Object.entries(filter).every(([key, condition]) =>
    key === '$or'
      ? condition.some((clause) => matchesFilter(record, clause))
      : matchesCondition(key.split('.').reduce((value, part) => (value == null ? undefined : value[part]), record), condition),
  );
}

export function memoryApplicationRepository() {
  const records = new Map(); // keyHash -> plain record
  const faults = {
    findByKeyHash: null,
    indexesMissing: false,
    recordNotification: null,
    claimNotification: null,
    claimNotificationAppliedThenFails: null,
    loadForUpdate: null,
    readBackAfterAmbiguity: undefined,
  };
  const calls = {
    insert: 0,
    findByKeyHash: 0,
    majorityReads: 0,
    loadForUpdate: 0,
    claimNotificationAttempts: 0,
    recordNotificationOutcomes: 0,
    findNotificationCandidates: 0,
  };
  const byId = (id) => [...records.values()].find((candidate) => String(candidate._id) === String(id));
  const heldClaims = new WeakMap();
  const claimedThrough = new WeakSet();
  const plain = (value) => (value && typeof value.toObject === 'function' ? value.toObject() : { ...value });
  const pathValue = (object, path) => path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);
  /** Applies the caller's channel states to the stored record iff `where` still matches it. */
  function applyConditionally(document, channels, where) {
    const record = byId(document._id);
    if (!record) return false;
    if (!Object.entries(where).every(([path, expected]) => (pathValue(record, path) ?? null) === expected)) return false;
    for (const channel of channels) record.notifications[channel] = clone(plain(document.notifications[channel]));
    return true;
  }
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
      calls.loadForUpdate += 1;
      if (faults.loadForUpdate) throw faults.loadForUpdate;
      const record = byId(id);
      // A full, independent copy — like a freshly loaded Mongoose document.
      return record ? clone(record) : null;
    },
    /*
     * B6 — notification state with the real repository's CONDITIONAL
     * semantics: a claim / record applies only if the stored channel state
     * still matches what the caller's copy held (else LOST).
     */
    async claimNotificationAttempts(document, channels, { now }) {
      calls.claimNotificationAttempts += 1;
      // r3: the real repository's ownership rules — valid channels, single-use documents, claimable states only.
      if (!Array.isArray(channels) || channels.length === 0 || new Set(channels).size !== channels.length || !channels.every((channel) => ['internal', 'candidateAcknowledgement'].includes(channel))) {
        throw new TypeError('claimNotificationAttempts: channels must be distinct notification channels');
      }
      if (claimedThrough.has(document)) return 'LOST';
      if (!channels.every((channel) => ['PENDING', 'FAILED'].includes(document.notifications?.[channel]?.status))) return 'LOST';
      claimedThrough.add(document);
      if (faults.claimNotification) throw faults.claimNotification;
      const appliedThenFails = faults.claimNotificationAppliedThenFails;
      const where = {};
      const attempts = {};
      for (const channel of channels) {
        const state = document.notifications[channel];
        where[`notifications.${channel}.status`] = state.status;
        where[`notifications.${channel}.attemptCount`] = state.attemptCount;
        where[`notifications.${channel}.lastErrorCode`] = state.lastErrorCode ?? null;
        state.status = 'PENDING';
        state.attemptCount += 1;
        state.lastAttemptAt = now;
        state.lastErrorCode = 'ATTEMPT_IN_PROGRESS';
        state.lastStatusCode = null;
        attempts[channel] = state.attemptCount;
      }
      const claimed = applyConditionally(document, channels, where);
      // The write was applied, but its acknowledgement is lost (e.g. a timeout): no ownership.
      if (claimed && appliedThenFails) throw appliedThenFails;
      if (claimed) heldClaims.set(document, { attempts, claimedAt: now });
      return claimed ? 'CLAIMED' : 'LOST';
    },
    async recordNotificationOutcomes(document, outcomes) {
      calls.recordNotificationOutcomes += 1;
      // r3: only the holder of the claim, for exactly its channels; nothing is written otherwise.
      const claim = heldClaims.get(document);
      const channels = Object.keys(outcomes ?? {});
      const owned = claim ? Object.keys(claim.attempts) : [];
      if (!claim || channels.length === 0 || channels.length !== owned.length || !channels.every((channel) => owned.includes(channel))) return 'LOST';
      heldClaims.delete(document);
      if (faults.recordNotification) throw faults.recordNotification;
      const where = {};
      for (const [channel, outcome] of Object.entries(outcomes)) {
        const state = document.notifications[channel];
        where[`notifications.${channel}.attemptCount`] = claim.attempts[channel];
        where[`notifications.${channel}.lastErrorCode`] = 'ATTEMPT_IN_PROGRESS';
        state.attemptCount = claim.attempts[channel];
        state.lastAttemptAt = claim.claimedAt;
        if (outcome.status === 'SENT') {
          state.status = 'SENT';
          state.sentAt = outcome.sentAt;
          state.lastErrorCode = null;
          state.lastStatusCode = null;
        } else {
          state.status = 'FAILED';
          state.lastErrorCode = outcome.errorCode;
          state.lastStatusCode = outcome.statusCode ?? null;
        }
      }
      return applyConditionally(document, Object.keys(outcomes), where) ? 'RECORDED' : 'LOST';
    },
    async findNotificationCandidates({ limit, filter }) {
      calls.findNotificationCandidates += 1;
      return [...records.values()]
        .filter((record) => matchesFilter(record, filter))
        .sort((a, b) => a.submittedAt - b.submittedAt || String(a._id).localeCompare(String(b._id)))
        .slice(0, limit)
        .map((record) => ({ _id: record._id, submittedAt: record.submittedAt, notifications: clone(record.notifications) }));
    },
    async summarizeNotificationStates({ maxAttempts }) {
      const summary = {};
      for (const channel of ['internal', 'candidateAcknowledgement']) {
        const counts = new Map();
        let exhausted = 0;
        for (const record of records.values()) {
          const { status, lastErrorCode, attemptCount } = record.notifications[channel];
          const key = `${status}/${lastErrorCode ?? null}`;
          counts.set(key, { status, code: lastErrorCode ?? null, count: (counts.get(key)?.count ?? 0) + 1 });
          if (['PENDING', 'FAILED'].includes(status) && attemptCount >= maxAttempts) exhausted += 1;
        }
        summary[channel] = { states: [...counts.values()].sort((a, b) => `${a.status}/${a.code}`.localeCompare(`${b.status}/${b.code}`)), exhausted };
      }
      return summary;
    },
  };
  return repo;
}

/** B6 — synthetic sending identity and recipients for the Notification Service (never deliverable). */
export const QA_NOTIFICATION_OPTIONS = Object.freeze({
  fromAddress: 'careers@notify.qa-valida.example.test',
  fromName: 'Valida Careers',
  replyTo: 'careers@qa-valida.example.test',
  internalRecipient: 'recruitment@qa-valida.example.test',
  acknowledgementEnabled: false,
  recipientAllowlist: null,
});

/** A transport double for the notification boundary — records calls; never sends anything. */
export function recordingTransport(behaviour = 'accept', { verify = 'ok', name = 'qa-test-double' } = {}) {
  /*
   * B6 — a TEST DOUBLE implementing the transport contract of
   * notificationService.js. It never sends anything; its acceptance is not
   * email evidence. `behaviour` (or a function (message, callNumber) ->
   * behaviour, for per-call sequences):
   *   'accept'            resolves with a synthetic provider message id
   *   'hang'              never settles (the bound must abort it)
   *   '<CODE>'            rejects with { notificationCode: '<CODE>' }
   *   an Error / value    rejects with it as is
   * `verify`: 'ok' | 'hang' | '<CODE>' | null (no verify function).
   */
  const settle = (current, accepted) => {
    if (current === 'accept') return accepted();
    if (current === 'hang') return new Promise(() => {});
    if (typeof current === 'string') throw Object.assign(new Error('QA transport failure'), { notificationCode: current });
    throw current;
  };
  const transport = {
    name,
    calls: [],
    signals: [],
    idempotencyKeys: [],
    verifyCalls: 0,
    async send(message, { signal, idempotencyKey }) {
      transport.calls.push(clone(message));
      transport.signals.push(signal);
      transport.idempotencyKeys.push(idempotencyKey);
      const callNumber = transport.calls.length;
      const current = typeof behaviour === 'function' ? behaviour(message, callNumber) : behaviour;
      return settle(current, () => ({ providerMessageId: `qa-message-${callNumber}` }));
    },
  };
  if (verify !== null) {
    transport.verify = async () => {
      transport.verifyCalls += 1;
      return settle(verify === 'ok' ? 'accept' : verify, () => undefined);
    };
  }
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
  // B6 — synthetic identities only (example.test is never deliverable).
  notificationOptions = {},
  clock = () => QA_NOW,
  configOverrides = {},
  storageOptions = {},
  storage: storageOverride,
  withStorage = true,
  // B7 — the suppression check (default: complete coverage, nothing suppressed).
  suppression = openSuppressionGate(),
} = {}) {
  const log = capturingLogger();
  const intake = withStorage ? await createIntakeEnvironment({ logger: log.logger, storageOptions }) : null;
  const jobRepository = memoryJobRepository(jobs);
  const applicationRepository = memoryApplicationRepository();
  const notificationService = createNotificationService({
    transport,
    timeoutMs: notificationTimeoutMs,
    clock,
    ...QA_NOTIFICATION_OPTIONS,
    ...notificationOptions,
  });
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
    suppressionGate: suppression,
  });
  return {
    app,
    suppression,
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
