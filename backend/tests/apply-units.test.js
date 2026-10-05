import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Application } from '../src/models/Application.js';
import { UnsupportedWriteError } from '../src/models/writeGuards.js';
import {
  APPLICATION_WRITE_CONCERN,
  ApplicationIndexesMissingError,
  UNIQUE_APPLICATION_INDEXES,
  classifyWriteFailure,
  createApplicationRepository,
} from '../src/modules/applications/application.repository.js';
import { buildApplication } from '../src/modules/applications/application.service.js';
import {
  APPLICATION_TEXT_FIELDS,
  fingerprintAgainstExisting,
  isAcceptablePhone,
  parseScreeningAnswers,
  validateIdempotencyKeyHeader,
  validateJobDrivenFields,
} from '../src/modules/applications/application.validation.js';
import { createNotificationService, TRANSPORT_ERROR_CODES } from '../src/integrations/notifications/notificationService.js';
import { STAGED_CLOSE_LIMITS } from '../src/lib/http/stagedClose.js';
import { RESUME_UPLOAD_POLICY } from '../src/config/resumePolicy.js';
import { MULTIPART_OVERHEAD_BYTES } from '../src/lib/multipart/multipart.js';
import { loadConfig } from '../src/config/env.js';
import {
  QA_OPTION_A,
  QA_OPTION_B,
  QA_SELECT_QUESTION_ID,
  QA_TEXT_QUESTION_ID,
  QA_YES_NO_QUESTION_ID,
  qaAnswers,
  qaJob,
} from './fixtures/applyHarness.js';

const { mongo } = mongoose;

describe('the Idempotency-Key rule (Doc 09 section 76)', () => {
  it.each([
    [undefined, 'MISSING'],
    ['', 'MISSING'],
    ['a'.repeat(15), 'INVALID'],
    ['a'.repeat(129), 'INVALID'],
    ['key, key-0123456789abcdef', 'INVALID'], // a header sent twice
    ['qa\tkey0123456789abcdef', 'INVALID'],
    ['qa\u0000key0123456789abcdef', 'INVALID'],
    [['qa-key-0123456789abcdef'], 'INVALID'],
  ])('%j -> %s', (value, problem) => {
    expect(validateIdempotencyKeyHeader(value)).toEqual({ ok: false, problem });
  });

  it('accepts visible ASCII of 16-128 characters, e.g. a UUID v4', () => {
    const key = randomUUID();
    expect(validateIdempotencyKeyHeader(key)).toEqual({ ok: true, key });
  });
});

describe('transport bounds stay inside the staged-close drain bound', () => {
  it('file + text fields + multipart allowance < 8 MiB', () => {
    const total = RESUME_UPLOAD_POLICY.maxBytes + Object.values(APPLICATION_TEXT_FIELDS).reduce((a, b) => a + b, 0) + MULTIPART_OVERHEAD_BYTES;
    expect(total).toBeLessThan(STAGED_CLOSE_LIMITS.maxBytes);
  });
});

describe('screeningAnswers shape (Doc 09 section 87)', () => {
  it('absent is "no answers"; the canonical shape parses', () => {
    expect(parseScreeningAnswers(undefined)).toEqual({ fieldErrors: [], value: [] });
    expect(parseScreeningAnswers(JSON.stringify(qaAnswers())).value).toEqual(qaAnswers());
  });

  it('a __proto__ key cannot pollute anything: it is an unexpected key', () => {
    const result = parseScreeningAnswers('[{"questionId":"q","answer":true,"__proto__":{"polluted":true}}]');
    expect(result.fieldErrors[0].code).toBe('INVALID_SCREENING_ANSWERS');
    expect({}.polluted).toBeUndefined();
  });
});

describe('phone plausibility (Doc 09 section 85)', () => {
  it.each(['5550123', '+370 612 34567', '(604) 555-0123', '0612/345 678', '+1.604.555.0123'])('accepts %j', (value) => {
    expect(isAcceptablePhone(value)).toBe(true);
  });
  it.each(['123456', '+1 555 01', 'x'.repeat(10), '555-0123 ext 9', '1'.repeat(33), '+1-555-ABC-1234'])('refuses %j', (value) => {
    expect(isAcceptablePhone(value)).toBe(false);
  });
});

describe('the replay fingerprint reproduces the first-submission fingerprint exactly', () => {
  const job = qaJob();
  const candidate = { fullName: 'QA Synthetic Candidate', email: 'QA.Candidate@Example.INVALID' };
  const fields = { ...candidate, phone: ' +1 555 010 0199 ', message: ' QA line\r\nQA line 2 ' };
  const resume = {
    storageProvider: 'LOCAL_DEVELOPMENT',
    storageKey: `resumes/${'a'.repeat(32)}/${'b'.repeat(32)}`,
    originalFilename: 'qa.pdf',
    extension: '.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 10,
    checksumSha256: 'c'.repeat(64),
    storedAt: new Date(),
  };
  const firstSubmission = (answers) => {
    const driven = validateJobDrivenFields({ job, fields, answers });
    expect(driven.fieldErrors).toEqual([]);
    return buildApplication({
      job,
      candidate: { ...candidate, phone: driven.value.phone, message: driven.value.message },
      screeningAnswers: driven.value.screeningAnswers,
      resume,
      idempotencyKey: 'qa-key-0123456789abcdef',
    });
  };

  it('identical retry -> identical hash, even with the Job questions since removed', () => {
    const answers = [...qaAnswers(), { questionId: QA_TEXT_QUESTION_ID, answer: null }].slice(0, 3);
    const created = firstSubmission(answers);
    const existing = created.toObject();
    const replay = fingerprintAgainstExisting({ existing, candidate, fields, answers, resumeChecksumSha256: resume.checksumSha256 });
    expect(replay).toBe(existing.idempotency.requestFingerprintHash);
  });

  it.each([
    ['a different answer', (a) => a.map((x) => (x.questionId === QA_YES_NO_QUESTION_ID ? { ...x, answer: false } : x))],
    ['a different option', (a) => a.map((x) => (x.questionId === QA_SELECT_QUESTION_ID ? { ...x, answer: QA_OPTION_A } : x))],
    ['an extra answer', (a) => [...a, { questionId: 'qa-unknown', answer: 'x' }]],
    ['a missing answer', (a) => a.slice(1)],
  ])('%s -> a different hash', (_label, change) => {
    const answers = qaAnswers();
    const existing = firstSubmission(answers).toObject();
    const other = fingerprintAgainstExisting({ existing, candidate, fields, answers: change(answers), resumeChecksumSha256: resume.checksumSha256 });
    expect(other).not.toBe(existing.idempotency.requestFingerprintHash);
  });

  it('a different file, email or Job -> a different hash', () => {
    const answers = qaAnswers();
    const existing = firstSubmission(answers).toObject();
    const base = { existing, candidate, fields, answers, resumeChecksumSha256: resume.checksumSha256 };
    expect(fingerprintAgainstExisting({ ...base, resumeChecksumSha256: 'd'.repeat(64) })).not.toBe(existing.idempotency.requestFingerprintHash);
    expect(fingerprintAgainstExisting({ ...base, candidate: { ...candidate, email: 'qa.other@example.invalid' } })).not.toBe(existing.idempotency.requestFingerprintHash);
    expect(fingerprintAgainstExisting({ ...base, existing: { ...existing, jobId: new mongoose.Types.ObjectId() } })).not.toBe(existing.idempotency.requestFingerprintHash);
    // Case and surrounding whitespace of the email do not matter (normalisation, Doc 10 section 84).
    expect(fingerprintAgainstExisting({ ...base, candidate: { ...candidate, email: ' qa.candidate@example.invalid ' } })).toBe(existing.idempotency.requestFingerprintHash);
  });
});

/** An error carrying the server's NoWritesPerformed label (no attempt performed a write). */
function noWritesPerformed(error) {
  error.addErrorLabel('NoWritesPerformed');
  return error;
}

describe('write-failure classification (application.repository.js)', () => {
  it.each([
    ['duplicate on the key hash (keyPattern)', new mongo.MongoServerError({ message: 'E11000', code: 11000, keyPattern: { 'idempotency.keyHash': 1 } }), 'DUPLICATE_KEY_HASH'],
    ['duplicate on the key hash (index name only)', new mongo.MongoServerError({ message: 'E11000 duplicate key error index: idempotency_keyHash_unique', code: 11000 }), 'DUPLICATE_KEY_HASH'],
    ['duplicate on the storage key', new mongo.MongoServerError({ message: 'E11000', code: 11000, keyPattern: { 'resume.storageKey': 1 } }), 'DUPLICATE_OTHER'],
    ['duplicate on an unknown index', new mongo.MongoServerError({ message: 'E11000 dup', code: 11000 }), 'DUPLICATE_OTHER'],
    // Not proof that nothing was written: with retryable writes the driver
    // reports the RETRY's error while the first attempt may have been applied.
    ['a server error (e.g. not primary, from a retry)', new mongo.MongoServerError({ message: 'not primary', code: 10107 }), 'AMBIGUOUS'],
    ['no server selected (e.g. for a retry)', new mongo.MongoServerSelectionError('no server', {}), 'AMBIGUOUS'],
    ['a server error the driver carries NoWritesPerformed', noWritesPerformed(new mongo.MongoServerError({ message: 'not primary', code: 10107 })), 'NOT_PERSISTED'],
    ['a network error the driver carries NoWritesPerformed', noWritesPerformed(new mongo.MongoNetworkError('reset')), 'NOT_PERSISTED'],
    ['a write-concern error (may have been applied)', new mongo.MongoWriteConcernError({ writeConcernError: { code: 64, errmsg: 'wtimeout' } }), 'AMBIGUOUS'],
    ['a network error after sending', new mongo.MongoNetworkError('socket closed'), 'AMBIGUOUS'],
    ['a network timeout', new mongo.MongoNetworkTimeoutError('timed out'), 'AMBIGUOUS'],
    ['an unknown driver error', new mongo.MongoRuntimeError('odd'), 'AMBIGUOUS'],
    ['schema validation (a defect)', new mongoose.Error.ValidationError(), 'INVALID'],
    ['a forbidden write path (a defect)', new UnsupportedWriteError('Application', 'updateOne'), 'INVALID'],
    ['anything unrecognised (not proven to fail before sending)', new TypeError('x'), 'AMBIGUOUS'],
  ])('%s -> %s', (_label, error, kind) => {
    expect(classifyWriteFailure(error).kind).toBe(kind);
  });

  it('only fixed reason tokens leave the classifier (never error text)', () => {
    const hostile = new mongo.MongoServerError({ message: 'mongodb://qa-user:qa-secret@db.example.invalid', code: 10107 });
    expect(classifyWriteFailure(hostile)).toEqual({ kind: 'AMBIGUOUS', reason: 'SERVER_ERROR' });
    expect(classifyWriteFailure(new mongo.MongoServerSelectionError('x', {}))).toEqual({ kind: 'AMBIGUOUS', reason: 'SERVER_SELECTION' });
    expect(classifyWriteFailure(new TypeError('qa-secret'))).toEqual({ kind: 'AMBIGUOUS', reason: 'UNEXPECTED' });
    expect(classifyWriteFailure(noWritesPerformed(new mongo.MongoServerError({ message: 'x', code: 1 })))).toEqual({ kind: 'NOT_PERSISTED', reason: 'NO_WRITES_PERFORMED' });
  });
});

/**
 * r1 finding 1 — the Application write-durability policy. The REAL Application
 * model, the REAL validated B2 save (Mongoose validation, write guards) and the
 * REAL repository insert(); only the final collection adapter (insertOne) is
 * simulated, so the options that actually reach it and the result it reports
 * can be observed. Fault injection — not a database run (the real-database
 * gate repeats this over an unsafe w=0 connection).
 */
describe('the Application write-durability policy (r1 finding 1; real model, real save, simulated adapter)', () => {
  const job = qaJob();
  const makeDocument = () =>
    buildApplication({
      job,
      candidate: { fullName: 'QA Synthetic Candidate', email: 'qa.candidate@example.invalid', phone: null, message: null },
      screeningAnswers: [],
      resume: {
        storageProvider: 'LOCAL_DEVELOPMENT',
        storageKey: `resumes/${'d'.repeat(32)}/${'e'.repeat(32)}`,
        originalFilename: 'qa.pdf',
        extension: '.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        checksumSha256: 'f'.repeat(64),
        storedAt: new Date(),
      },
      idempotencyKey: `qa-key-${randomUUID()}`,
    });
  // The repository only consults the connection state; the document saves through its own (real) model.
  const connected = { db: { readyState: 1 } };

  async function insertThroughAdapter(adapter, { timeoutMs = 400 } = {}) {
    const calls = [];
    Application.collection.insertOne = async (doc, options) => {
      calls.push({ doc, options });
      return adapter(doc, options);
    };
    try {
      const repo = createApplicationRepository({ model: connected, timeoutMs });
      return { outcome: await repo.insert(makeDocument()), calls };
    } finally {
      delete Application.collection.insertOne; // back to the real (prototype) method
    }
  }

  it('every Application insert reaches the adapter with { w: "majority", j: true, wtimeout } — the policy, never a connection default', async () => {
    const { outcome, calls } = await insertThroughAdapter(async (doc) => ({ acknowledged: true, insertedId: doc._id }), { timeoutMs: 400 });
    expect(outcome).toEqual({ kind: 'CREATED' });
    expect(calls).toHaveLength(1);
    expect(calls[0].options.writeConcern).toEqual({ w: 'majority', j: true, wtimeout: 400 });
    expect(APPLICATION_WRITE_CONCERN).toEqual({ w: 'majority', j: true });
    expect(Object.isFrozen(APPLICATION_WRITE_CONCERN)).toBe(true);
  });

  it('an insert the adapter reports UNACKNOWLEDGED (as under w=0) is never CREATED: AMBIGUOUS / UNACKNOWLEDGED (the write may still land)', async () => {
    const { outcome, calls } = await insertThroughAdapter(async (doc) => ({ acknowledged: false, insertedId: doc._id }));
    expect(calls).toHaveLength(1);
    expect(outcome).toMatchObject({ kind: 'AMBIGUOUS', reason: 'UNACKNOWLEDGED', settled: null });
  });

  it('an adapter that reports nothing usable is not an acknowledgement either', async () => {
    for (const result of [undefined, null, {}, { acknowledged: 'yes' }]) {
      const { outcome } = await insertThroughAdapter(async () => result);
      expect(outcome).toMatchObject({ kind: 'AMBIGUOUS', reason: 'UNACKNOWLEDGED' });
    }
  });

  it('a timed-out insert that later resolves UNACKNOWLEDGED settles as AMBIGUOUS, never CREATED', async () => {
    const { outcome } = await insertThroughAdapter(
      (doc) => new Promise((resolve) => setTimeout(() => resolve({ acknowledged: false, insertedId: doc._id }), 120)),
      { timeoutMs: 30 },
    );
    expect(outcome).toMatchObject({ kind: 'AMBIGUOUS', reason: 'TIMEOUT' });
    expect(await outcome.settled).toBe('AMBIGUOUS');
  });

  it('a write-concern failure (e.g. wtimeout reached) stays AMBIGUOUS — never "not persisted"', async () => {
    const { outcome } = await insertThroughAdapter(async () => {
      throw new mongo.MongoWriteConcernError({ writeConcernError: { code: 64, errmsg: 'waiting for replication timed out' } });
    });
    expect(outcome).toMatchObject({ kind: 'AMBIGUOUS', reason: 'WRITE_CONCERN' });
  });

  it('the validated B2 save path is unchanged: an invalid document never reaches the adapter', async () => {
    const calls = [];
    Application.collection.insertOne = async (doc, options) => {
      calls.push({ doc, options });
      return { acknowledged: true };
    };
    try {
      const document = makeDocument();
      document.candidate.email = 'not-an-email';
      const outcome = await createApplicationRepository({ model: connected, timeoutMs: 400 }).insert(document);
      expect(outcome.kind).toBe('INVALID');
      expect(calls).toEqual([]);
    } finally {
      delete Application.collection.insertOne;
    }
  });
});

describe('the bounded insert (application.repository.js, scripted model)', () => {
  const modelWith = (readyState = 1, listIndexes = async () => []) => ({
    db: { readyState },
    collection: { listIndexes: () => ({ toArray: listIndexes }) },
  });
  /**
   * A scripted document: `save` decides the outcome; a save that resolves is
   * reported to 'save' listeners as an ACKNOWLEDGED insert, the way Mongoose
   * reports the driver's result. The options each save received are kept.
   */
  const documentSaving = (save) => {
    const listeners = new Set();
    const document = {
      saveOptions: [],
      $once: (event, listener) => {
        if (event === 'save') listeners.add(listener);
      },
      removeListener: (event, listener) => listeners.delete(listener),
      async save(options) {
        document.saveOptions.push(options);
        await save(options);
        for (const listener of listeners) listener(document, { acknowledged: true, insertedId: 'qa' });
        listeners.clear();
      },
    };
    return document;
  };

  it('disconnected: NOT_PERSISTED without sending anything (Mongoose would buffer it)', async () => {
    let saved = false;
    const repo = createApplicationRepository({ model: modelWith(0), timeoutMs: 50 });
    const outcome = await repo.insert(documentSaving(async () => { saved = true; }));
    expect(outcome).toEqual({ kind: 'NOT_PERSISTED', reason: 'DISCONNECTED' });
    expect(saved).toBe(false);
  });

  it('resolves: CREATED; rejects with a duplicate key hash: DUPLICATE_KEY_HASH', async () => {
    const repo = createApplicationRepository({ model: modelWith(), timeoutMs: 200 });
    const document = documentSaving(async () => {});
    expect(await repo.insert(document)).toEqual({ kind: 'CREATED' });
    expect(document.saveOptions).toEqual([{ writeConcern: { w: 'majority', j: true, wtimeout: 200 } }]);
    const duplicate = new mongo.MongoServerError({ message: 'E11000', code: 11000, keyPattern: { 'idempotency.keyHash': 1 } });
    expect(await repo.insert(documentSaving(async () => { throw duplicate; }))).toEqual({ kind: 'DUPLICATE_KEY_HASH', reason: 'DUPLICATE_KEY_HASH' });
  });

  it('a save still in flight at the bound: AMBIGUOUS, and `settled` reports how it really ended', async () => {
    const repo = createApplicationRepository({ model: modelWith(), timeoutMs: 30 });
    let finish;
    const outcome = await repo.insert(documentSaving(() => new Promise((resolve) => { finish = resolve; })));
    expect(outcome.kind).toBe('AMBIGUOUS');
    expect(outcome.reason).toBe('TIMEOUT');
    finish();
    expect(await outcome.settled).toBe('CREATED');

    const lateServerError = await repo.insert(documentSaving(() => new Promise((_resolve, reject) => setTimeout(() => reject(new mongo.MongoServerError({ message: 'x', code: 1 })), 60))));
    expect(await lateServerError.settled).toBe('AMBIGUOUS'); // still not proof
    const lateNoWrite = await repo.insert(documentSaving(() => new Promise((_resolve, reject) => setTimeout(() => reject(noWritesPerformed(new mongo.MongoServerError({ message: 'x', code: 1 }))), 60))));
    expect(await lateNoWrite.settled).toBe('NOT_PERSISTED');
    const lateDuplicate = await repo.insert(documentSaving(() => new Promise((_resolve, reject) => setTimeout(() => reject(new mongo.MongoServerError({ message: 'E11000', code: 11000, keyPattern: { 'idempotency.keyHash': 1 } })), 60))));
    expect(await lateDuplicate.settled).toBe('DUPLICATE_KEY_HASH');
  });

  it('a network error: AMBIGUOUS with no `settled` (the outcome cannot be learned from the save); the error is handed back for a SAFE summary only', async () => {
    const repo = createApplicationRepository({ model: modelWith(), timeoutMs: 200 });
    const reset = new mongo.MongoNetworkError('reset');
    const outcome = await repo.insert(documentSaving(async () => { throw reset; }));
    expect(outcome).toEqual({ kind: 'AMBIGUOUS', reason: 'NETWORK', settled: null, error: reset });
  });

  it('a server error or failed server selection is AMBIGUOUS (retryable writes), not NOT_PERSISTED', async () => {
    const repo = createApplicationRepository({ model: modelWith(), timeoutMs: 200 });
    const notPrimary = await repo.insert(documentSaving(async () => { throw new mongo.MongoServerError({ message: 'not primary', code: 10107 }); }));
    expect(notPrimary).toMatchObject({ kind: 'AMBIGUOUS', reason: 'SERVER_ERROR', settled: null });
    const selection = await repo.insert(documentSaving(async () => { throw new mongo.MongoServerSelectionError('no primary', {}); }));
    expect(selection).toMatchObject({ kind: 'AMBIGUOUS', reason: 'SERVER_SELECTION', settled: null });
  });

  it('assertUniqueIndexes fails closed when the unique indexes are missing, incompatible or the collection absent', async () => {
    const both = UNIQUE_APPLICATION_INDEXES.map((index) => ({ name: index.name, key: index.key, unique: true }));
    for (const reported of [[], [both[0]], [{ ...both[0], unique: false }, both[1]]]) {
      const repo = createApplicationRepository({ model: modelWith(1, async () => reported), timeoutMs: 200 });
      await expect(repo.assertUniqueIndexes()).rejects.toBeInstanceOf(ApplicationIndexesMissingError);
    }
    const absent = createApplicationRepository({
      model: modelWith(1, async () => {
        throw Object.assign(new mongo.MongoServerError({ message: 'ns not found', code: 26 }), { codeName: 'NamespaceNotFound' });
      }),
      timeoutMs: 200,
    });
    await expect(absent.assertUniqueIndexes()).rejects.toBeInstanceOf(ApplicationIndexesMissingError);

    let lists = 0;
    const present = createApplicationRepository({ model: modelWith(1, async () => { lists += 1; return both; }), timeoutMs: 200 });
    await present.assertUniqueIndexes();
    await present.assertUniqueIndexes();
    expect(lists).toBe(1); // verified once per process
  });

  it('recordInternalNotification goes through the validated document save and increments attemptCount', async () => {
    const repo = createApplicationRepository({ model: modelWith(), timeoutMs: 200 });
    const document = new Application({}); // shape only; save is replaced
    let saves = 0;
    document.save = async () => { saves += 1; };
    await repo.recordInternalNotification(document, { status: 'FAILED', attemptedAt: new Date(0), errorCode: 'TIMEOUT' });
    await repo.recordInternalNotification(document, { status: 'SENT', attemptedAt: new Date(1), sentAt: new Date(2) });
    expect(saves).toBe(2);
    expect(document.notifications.internal.toObject()).toEqual({
      status: 'SENT',
      attemptCount: 2,
      lastAttemptAt: new Date(1),
      sentAt: new Date(2),
      lastErrorCode: null,
    });
  });
});

describe('the notification boundary (notificationService.js)', () => {
  const summary = { applicationId: 'a'.repeat(24), job: { title: 'QA', slug: 'qa' }, submittedAt: new Date(0) };

  it('no transport (B5): NOT_ATTEMPTED / NOT_CONFIGURED — never SENT', async () => {
    const service = createNotificationService({ transport: null, timeoutMs: 100 });
    expect(service.configured).toBe(false);
    expect(await service.notifyApplicationReceived(summary)).toEqual({ status: 'NOT_ATTEMPTED', reason: 'NOT_CONFIGURED' });
  });

  it('classifies failures into fixed codes only, and never throws', async () => {
    for (const code of TRANSPORT_ERROR_CODES) {
      const service = createNotificationService({ transport: { send: async () => { throw Object.assign(new Error('x'), { notificationCode: code }); } }, timeoutMs: 100 });
      expect((await service.notifyApplicationReceived(summary)).errorCode).toBe(code);
    }
    const hostile = createNotificationService({ transport: { send: async () => { throw Object.assign(new Error('x'), { notificationCode: 'mongodb://u:p@h' }); } }, timeoutMs: 100 });
    expect((await hostile.notifyApplicationReceived(summary)).errorCode).toBe('PROVIDER_ERROR');
    const throwsSync = createNotificationService({ transport: { send: () => { throw new Error('sync'); } }, timeoutMs: 100 });
    expect((await throwsSync.notifyApplicationReceived(summary)).status).toBe('FAILED');
  });

  it('a hanging transport is cut off at the bound with TIMEOUT and its signal aborted', async () => {
    let signal;
    const service = createNotificationService({ transport: { send: (_m, options) => { signal = options.signal; return new Promise(() => {}); } }, timeoutMs: 40 });
    const started = Date.now();
    const outcome = await service.notifyApplicationReceived(summary);
    expect(outcome).toMatchObject({ status: 'FAILED', errorCode: 'TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(signal.aborted).toBe(true);
  });

  it('requires a bound', () => {
    expect(() => createNotificationService({ transport: null })).toThrow(TypeError);
  });
});

describe('B5 configuration (config/env.js)', () => {
  const base = { MONGODB_URI: 'mongodb://127.0.0.1:27017/valida_test' };
  it('defaults: 10 attempts per 15 minutes; notification bound 5 s', () => {
    const config = loadConfig(base);
    expect(config.applicationRateLimit).toEqual({ windowMs: 900_000, max: 10 });
    expect(config.notificationTimeoutMs).toBe(5000);
  });
  it.each([
    ['APPLICATION_RATE_LIMIT_MAX', '0'],
    ['APPLICATION_RATE_LIMIT_WINDOW_MS', '999'],
    ['NOTIFICATION_TIMEOUT_MS', '60001'],
    ['NOTIFICATION_TIMEOUT_MS', 'soon'],
  ])('%s=%s is refused at startup without echoing the value', (variable, value) => {
    let error;
    try {
      loadConfig({ ...base, [variable]: value });
    } catch (caught) {
      error = caught;
    }
    expect(error?.name).toBe('ConfigurationError');
    expect(error.message).toContain(variable);
    expect(error.message).not.toContain(`=${value}`);
  });
});

// Keep option ids referenced (lint): they document the fixture.
void QA_OPTION_B;
