import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrivateStorageError, storageObjectRef } from '../src/integrations/storage/storageContract.js';
import { PDF_MIME, syntheticPdf } from './fixtures/resumeFiles.js';
import {
  QA_CANDIDATE,
  QA_NOW,
  applyRequest,
  createApplyEnvironment,
  dbUnavailable,
  qaJob,
  recordingTransport,
} from './fixtures/applyHarness.js';

/**
 * B5 — failure handling of the Apply workflow (Doc 09 sections 115-138;
 * Doc 18 sections 127-130; Doc 17 sections 96, 110-114; Doc 10 sections
 * 207-209, 229).
 *
 * Faults are injected at the repository and storage boundaries (permitted for
 * error simulation); the storage itself is the REAL local adapter, so every
 * "object removed" or "object kept" below is a fact about the disk.
 */
const UNAVAILABLE = { code: 'SERVICE_UNAVAILABLE', message: "We couldn't submit your application right now. Please try again." };
const CLOSED = { code: 'JOB_NOT_ACCEPTING_APPLICATIONS', message: 'Applications for this role have closed.' };

let env;
afterEach(async () => {
  await env?.cleanup();
  env = undefined;
});

const logEntries = () =>
  env.log
    .output()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const events = (name) => logEntries().filter((entry) => entry.event === name);
/** The storage keys of the objects now in private storage (what reconciliation lists). */
const storedKeys = () => env.storedObjects().map((relative) => `resumes/${relative.split(/[\\/]/).join('/')}`);
/** No log line carries a storage key, a key segment or the storage root. */
function expectNoStorageKeyInLogs() {
  const output = env.log.output();
  for (const key of storedKeys()) {
    const [, first, second] = key.split('/');
    expect(output).not.toContain(first);
    expect(output).not.toContain(second);
  }
  expect(output).not.toMatch(/resumes\/[0-9a-f]{32}/);
  expect(output).not.toContain(env.intake.storageRoot);
}

describe('the closing-time race (Doc 09 section 115; Doc 17 section 96)', () => {
  it('the Job is CLOSED while the resume is being stored: 409, the stored object is removed, no Application', async () => {
    env = await createApplyEnvironment();
    const [job] = [...env.jobs.jobs.values()];
    env.jobs.beforeEligibility = async () => {
      // At this point the resume IS stored: the Job closes now.
      expect(env.storedObjects()).toHaveLength(1);
      env.jobs.update(job._id, { status: 'CLOSED', closedAt: QA_NOW });
    };
    const response = await applyRequest(env.app);
    expect(response.status).toBe(409);
    expect(response.body.error).toEqual(CLOSED);
    expect(env.applications.all()).toEqual([]);
    expect(env.storedObjects()).toEqual([]);
    expect(env.tempFiles()).toEqual([]);
    expect(events('application_not_accepted')).toEqual([
      expect.objectContaining({ reason: 'JOB_CLOSED_DURING_SUBMISSION', compensation: 'DELETED' }),
    ]);
  });

  it('closesAt passes while the resume is being stored (server clock moves on): 409, object removed', async () => {
    let now = QA_NOW;
    const closesAt = new Date(QA_NOW.getTime() + 1000);
    env = await createApplyEnvironment({ jobs: [qaJob({ closesAt })], clock: () => now });
    const store = env.storage.storePrivateResume.bind(env.storage);
    env.storage.storePrivateResume = async (request) => {
      const stored = await store(request);
      now = closesAt; // the server clock reaches closesAt while the upload is being stored
      return stored;
    };
    const response = await applyRequest(env.app);
    expect(response.status).toBe(409);
    expect(env.applications.all()).toEqual([]);
    expect(env.storedObjects()).toEqual([]);
  });

  it('the Job is ARCHIVED (or removed) during the request: 404, object removed', async () => {
    env = await createApplyEnvironment();
    const [job] = [...env.jobs.jobs.values()];
    env.jobs.beforeEligibility = async () => {
      env.jobs.jobs.delete(String(job._id));
    };
    const response = await applyRequest(env.app);
    expect(response.status).toBe(404);
    expect(env.storedObjects()).toEqual([]);
  });

  it('submittedAt is the instant of the final eligibility check, after storage', async () => {
    let now = QA_NOW;
    env = await createApplyEnvironment({ clock: () => now });
    const store = env.storage.storePrivateResume.bind(env.storage);
    env.storage.storePrivateResume = async (request) => {
      const stored = await store(request);
      now = new Date(QA_NOW.getTime() + 2500); // storage took 2.5 s of server time
      return stored;
    };
    const response = await applyRequest(env.app);
    expect(response.status).toBe(201);
    expect(response.body.data.submittedAt).toBe('2026-10-05T12:00:02.500Z');
    expect(env.applications.all()[0].submittedAt).toEqual(new Date('2026-10-05T12:00:02.500Z'));
  });

  // r1 finding 3 — the Job expires DURING the final eligibility read itself.
  it.each([
    ['passes closesAt (clock 12:00:00 -> 12:00:02, closesAt 12:00:01)', '2026-10-05T12:00:02.000Z'],
    ['reaches EXACTLY closesAt (12:00:01.000)', '2026-10-05T12:00:01.000Z'],
  ])('the server clock %s during the eligibility read: 409, no Application, the stored object is compensated', async (_label, after) => {
    let now = QA_NOW; // 2026-10-05T12:00:00.000Z
    env = await createApplyEnvironment({ jobs: [qaJob({ closesAt: new Date('2026-10-05T12:00:01.000Z') })], clock: () => now });
    env.jobs.beforeEligibility = async () => {
      expect(env.storedObjects()).toHaveLength(1);
      now = new Date(after); // the read takes the request past (or onto) closesAt; the Job document is unchanged
    };
    const response = await applyRequest(env.app);
    expect(response.status).toBe(409);
    expect(response.body.error).toEqual(CLOSED);
    expect(env.applications.all()).toEqual([]);
    expect(env.storedObjects()).toEqual([]);
    expect(env.tempFiles()).toEqual([]);
    expect(events('application_not_accepted')).toEqual([
      expect.objectContaining({ reason: 'JOB_CLOSED_DURING_SUBMISSION', compensation: 'DELETED' }),
    ]);
  });

  it('the clock stays 1 ms BEFORE closesAt after the eligibility read: accepted, and submittedAt is that fresh instant (the one eligibility was evaluated at)', async () => {
    let now = QA_NOW;
    env = await createApplyEnvironment({ jobs: [qaJob({ closesAt: new Date('2026-10-05T12:00:01.000Z') })], clock: () => now });
    env.jobs.beforeEligibility = async () => {
      now = new Date('2026-10-05T12:00:00.999Z');
    };
    const response = await applyRequest(env.app);
    expect(response.status).toBe(201);
    expect(response.body.data.submittedAt).toBe('2026-10-05T12:00:00.999Z');
    const [record] = env.applications.all();
    expect(record.submittedAt).toEqual(new Date('2026-10-05T12:00:00.999Z'));
    expect(record.submittedAt < new Date('2026-10-05T12:00:01.000Z')).toBe(true);
  });
});

describe('private storage failure (Doc 09 section 137; Doc 18 section 128; Doc 17 section 112)', () => {
  it('a failed store is 503, no Application, no object, no temporary file', async () => {
    env = await createApplyEnvironment();
    const storage = env.storage;
    const original = storage.storePrivateResume.bind(storage);
    storage.storePrivateResume = async () => {
      throw new PrivateStorageError('store', 'NO_SPACE');
    };
    const response = await applyRequest(env.app);
    expect(response.status).toBe(503);
    expect(response.body.error).toEqual(UNAVAILABLE);
    expect(env.applications.calls.insert).toBe(0);
    expect(env.applications.all()).toEqual([]);
    expect(env.storedObjects()).toEqual([]);
    expect(env.tempFiles()).toEqual([]);
    storage.storePrivateResume = original;
    expect((await applyRequest(env.app)).status).toBe(201);
  });

  it('storage not configured at all: 503 before the body is read; the connection is closed', async () => {
    env = await createApplyEnvironment({ withStorage: false });
    const response = await applyRequest(env.app);
    expect(response.status).toBe(503);
    expect(response.body.error).toEqual(UNAVAILABLE);
    expect(response.headers.connection).toBe('close');
    expect(env.applications.all()).toEqual([]);
  });
});

describe('database failure (Doc 09 sections 119, 138; Doc 18 sections 129-130; Doc 17 sections 111, 113)', () => {
  it('the Job lookup fails: 503, nothing stored', async () => {
    env = await createApplyEnvironment();
    env.jobs.faults.findJobForApplication = dbUnavailable('disconnected');
    const response = await applyRequest(env.app);
    expect(response.status).toBe(503);
    expect(response.body.error).toEqual(UNAVAILABLE);
    expect(env.storedObjects()).toEqual([]);
  });

  it('the idempotency lookup fails: 503, nothing stored', async () => {
    env = await createApplyEnvironment();
    env.applications.faults.findByKeyHash = dbUnavailable('timeout');
    const response = await applyRequest(env.app);
    expect(response.status).toBe(503);
    expect(env.storedObjects()).toEqual([]);
  });

  it('the eligibility re-check fails after storage: 503, the object is removed', async () => {
    env = await createApplyEnvironment();
    env.jobs.faults.findJobEligibility = dbUnavailable('query_failed');
    const response = await applyRequest(env.app);
    expect(response.status).toBe(503);
    expect(env.storedObjects()).toEqual([]);
    expect(events('application_not_accepted')).toEqual([expect.objectContaining({ reason: 'ELIGIBILITY_RECHECK_FAILED', compensation: 'DELETED' })]);
  });

  it.each(['DISCONNECTED', 'NO_WRITES_PERFORMED'])(
    'the insert is PROVEN not persisted (%s): 503, never a fake success, and the stored object is removed (compensation)',
    async (reason) => {
      env = await createApplyEnvironment();
      env.applications.nextInsert = { kind: 'NOT_PERSISTED', reason };
      const response = await applyRequest(env.app);
      expect(response.status).toBe(503);
      expect(response.body.error).toEqual(UNAVAILABLE);
      expect(env.applications.all()).toEqual([]);
      expect(env.storedObjects()).toEqual([]);
      expect(env.tempFiles()).toEqual([]);
      expect(events('resume_compensation')).toEqual([expect.objectContaining({ outcome: 'DELETED' })]);
    },
  );

  it.each(['SERVER_ERROR', 'SERVER_SELECTION', 'UNEXPECTED'])(
    'a %s failure is NOT proof that nothing was written (retryable writes): read back; nothing found -> 503, the object is KEPT and named, never deleted',
    async (reason) => {
      env = await createApplyEnvironment();
      env.applications.nextInsert = { kind: 'AMBIGUOUS', reason, persist: false };
      const response = await applyRequest(env.app);
      expect(response.status).toBe(503);
      expect(response.body.error).toEqual(UNAVAILABLE);
      expect(env.applications.all()).toEqual([]);
      expect(env.storedObjects()).toHaveLength(1);
      expect(events('resume_compensation')).toEqual([]);
      expect(events('application_persistence_ambiguous')).toEqual([expect.objectContaining({ reason, readBack: 'NOT_FOUND' })]);
    },
  );

  it('a server error whose FIRST attempt was in fact applied: the read-back finds our record -> 201, and the object is kept', async () => {
    env = await createApplyEnvironment();
    env.applications.nextInsert = { kind: 'AMBIGUOUS', reason: 'SERVER_ERROR', persist: true };
    const response = await applyRequest(env.app);
    expect(response.status).toBe(201);
    expect(env.applications.all()).toHaveLength(1);
    expect(env.storedObjects()).toHaveLength(1);
    expect(events('resume_compensation')).toEqual([]);
  });

  it('the insert fails AND compensation fails: 503, the object stays private, an orphan event names its one-way object reference (never the key)', async () => {
    env = await createApplyEnvironment();
    env.applications.nextInsert = { kind: 'NOT_PERSISTED', reason: 'DISCONNECTED' };
    env.storage.deletePrivateObject = async () => {
      throw new PrivateStorageError('delete', 'PERMISSION_DENIED');
    };
    const response = await applyRequest(env.app);
    expect(response.status).toBe(503);
    expect(env.applications.all()).toEqual([]);
    expect(env.storedObjects()).toHaveLength(1);
    const [orphan] = events('resume_compensation');
    expect(orphan).toMatchObject({ outcome: 'ORPHANED', reason: 'PERMISSION_DENIED' });
    expect(orphan.storageKey).toBeUndefined();
    // Reconciliation lists storage and resolves the reference to the one object.
    expect(orphan.objectRef).toBe(storageObjectRef(storedKeys()[0]));
    expectNoStorageKeyInLogs();
  });

  it('an insert refused as invalid (a defect) is 500 INTERNAL_ERROR, after compensation', async () => {
    env = await createApplyEnvironment();
    env.applications.nextInsert = { kind: 'INVALID', reason: 'VALIDATION' };
    // The memory repository maps a scripted INVALID to its own shape; script a real one:
    env.applications.nextInsert = null;
    const realInsert = env.applications.insert.bind(env.applications);
    env.applications.insert = async (document) => {
      document.candidate.email = 'not-an-email-after-validation';
      return realInsert(document);
    };
    const response = await applyRequest(env.app);
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(env.storedObjects()).toEqual([]);
  });

  it('the unique Application indexes are missing: 503 before anything is stored (fail closed, DATA-066)', async () => {
    env = await createApplyEnvironment();
    env.applications.faults.indexesMissing = true;
    const response = await applyRequest(env.app);
    expect(response.status).toBe(503);
    expect(env.storedObjects()).toEqual([]);
    expect(logEntries().some((entry) => entry.reason === 'APPLICATION_INDEXES_MISSING')).toBe(true);
  });

  it('an UNATTRIBUTED duplicate-key refusal while another Application owns the key and nothing references our object: treated as the lost race — ours removed, the winner replayed', async () => {
    env = await createApplyEnvironment();
    const key = randomUUID();
    const resume = { data: syntheticPdf(), filename: 'qa-resume.pdf', contentType: PDF_MIME };
    expect((await applyRequest(env.app, { key, resume })).status).toBe(201);
    const realFind = env.applications.findByKeyHash.bind(env.applications);
    let first = true;
    env.applications.findByKeyHash = async (hash) => {
      if (first) {
        first = false;
        return null; // as if the race started before the winner was visible
      }
      return realFind(hash);
    };
    env.applications.nextInsert = { kind: 'DUPLICATE_OTHER', reason: 'DUPLICATE_OTHER_INDEX' };
    const second = await applyRequest(env.app, { key, resume });
    expect(second.status).toBe(200);
    expect(second.body.meta.replayed).toBe(true);
    expect(env.storedObjects()).toHaveLength(1);
  });

  it('an unattributed duplicate where our object IS referenced elsewhere: 503 and the object is kept', async () => {
    env = await createApplyEnvironment();
    const key = randomUUID();
    const resume = { data: syntheticPdf(), filename: 'qa-resume.pdf', contentType: PDF_MIME };
    expect((await applyRequest(env.app, { key, resume })).status).toBe(201);
    const realFind = env.applications.findByKeyHash.bind(env.applications);
    let first = true;
    env.applications.findByKeyHash = async (hash) => {
      if (first) {
        first = false;
        return null;
      }
      return realFind(hash);
    };
    env.applications.isStorageKeyReferenced = async () => true;
    env.applications.nextInsert = { kind: 'DUPLICATE_OTHER', reason: 'DUPLICATE_OTHER_INDEX' };
    const second = await applyRequest(env.app, { key, resume });
    expect(second.status).toBe(503);
    expect(env.storedObjects()).toHaveLength(2);
    expect(events('application_storage_key_conflict')).toHaveLength(1);
  });

  it('an UNATTRIBUTED duplicate whose key owner is a DIFFERENT submission: 409 IDEMPOTENCY_KEY_REUSED (not swallowed into a 503), ours removed, no "kept" claim', async () => {
    env = await createApplyEnvironment();
    const key = randomUUID();
    expect((await applyRequest(env.app, { key })).status).toBe(201);
    const realFind = env.applications.findByKeyHash.bind(env.applications);
    let first = true;
    env.applications.findByKeyHash = async (hash, options) => {
      if (first) {
        first = false;
        return null;
      }
      return realFind(hash, options);
    };
    env.applications.nextInsert = { kind: 'DUPLICATE_OTHER', reason: 'DUPLICATE_OTHER_INDEX' };
    const second = await applyRequest(env.app, { key, fields: { fullName: 'QA Different Person' } });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(env.storedObjects()).toHaveLength(1);
    expect(events('application_storage_key_conflict')).toEqual([]);
    expect(events('application_not_accepted')).toEqual([expect.objectContaining({ reason: 'IDEMPOTENCY_RACE_LOST', compensation: 'DELETED' })]);
  });

  it('a key-hash duplicate whose winner cannot be read: 503, the object is KEPT (the winner is read before anything is deleted)', async () => {
    env = await createApplyEnvironment();
    env.applications.nextInsert = { kind: 'DUPLICATE_KEY_HASH', reason: 'DUPLICATE_KEY_HASH' };
    const response = await applyRequest(env.app);
    expect(response.status).toBe(503);
    expect(env.storedObjects()).toHaveLength(1);
    expect(events('resume_compensation')).toEqual([]);
    expect(events('application_persistence_ambiguous')).toEqual([expect.objectContaining({ reason: 'DUPLICATE_KEY_HASH', readBack: 'NOT_FOUND' })]);
  });

  it('a key-hash duplicate reported for OUR OWN record (a retried insert whose first attempt was applied): 201, the object is kept', async () => {
    env = await createApplyEnvironment();
    env.applications.nextInsert = { kind: 'DUPLICATE_KEY_HASH', reason: 'DUPLICATE_KEY_HASH', persist: true };
    const response = await applyRequest(env.app);
    expect(response.status).toBe(201);
    expect(response.body.meta.replayed).toBe(false);
    expect(env.applications.all()).toHaveLength(1);
    expect(env.storedObjects()).toHaveLength(1);
    expect(events('resume_compensation')).toEqual([]);
    expect(events('application_persistence_confirmed')).toHaveLength(1);
    expect(env.applications.calls.majorityReads).toBe(1); // "ours" is confirmed by a majority read
  });

  it('a key-hash duplicate whose "ours" record a majority read does NOT confirm: 503, the object is kept, no success claimed', async () => {
    env = await createApplyEnvironment();
    env.applications.nextInsert = { kind: 'DUPLICATE_KEY_HASH', reason: 'DUPLICATE_KEY_HASH', persist: true };
    const realFind = env.applications.findByKeyHash.bind(env.applications);
    env.applications.findByKeyHash = async (hash, options = {}) => (options.majority ? null : realFind(hash, options));
    const response = await applyRequest(env.app);
    expect(response.status).toBe(503);
    expect(env.storedObjects()).toHaveLength(1);
    expect(events('resume_compensation')).toEqual([]);
    expect(events('application_persistence_ambiguous')).toEqual([expect.objectContaining({ readBack: 'UNCONFIRMED' })]);
  });

  it('a unique conflict on another index (storage key): 503, and the object is NEVER deleted', async () => {
    env = await createApplyEnvironment();
    env.applications.nextInsert = { kind: 'DUPLICATE_OTHER', reason: 'DUPLICATE_OTHER_INDEX' };
    const response = await applyRequest(env.app);
    expect(response.status).toBe(503);
    expect(env.storedObjects()).toHaveLength(1);
    expect(events('application_storage_key_conflict')).toHaveLength(1);
  });
});

/**
 * r1 finding 2 — a replay is a success claim, so it is answered only from a
 * record confirmed by a read with read concern "majority". Simulated here: the
 * record is visible to ordinary reads, but majority reads do not (yet) return
 * it — a record visible locally but not durably confirmed. Fault injection,
 * not a replica-set failover.
 */
describe('replays only from a durably confirmed record (r1 finding 2)', () => {
  /** Ordinary reads see the in-memory records; majority reads see them only once `confirmed()` is called. */
  function withMajorityLag() {
    const realFind = env.applications.findByKeyHash.bind(env.applications);
    let available = false;
    env.applications.findByKeyHash = async (hash, options = {}) => (options.majority && !available ? null : realFind(hash, options));
    return { confirm: () => { available = true; } };
  }
  const fixedResume = () => ({ data: syntheticPdf(), filename: 'qa-resume.pdf', contentType: PDF_MIME });

  it('an unconfirmed record stays unconfirmed on retry (503, nothing new); once confirmed, the same key replays — no second Application, object or notification', async () => {
    const transport = recordingTransport('accept');
    env = await createApplyEnvironment({ transport });
    const majority = withMajorityLag();
    env.applications.nextInsert = { kind: 'AMBIGUOUS', reason: 'WRITE_CONCERN', persist: true };
    const key = randomUUID();
    const resume = fixedResume();

    const first = await applyRequest(env.app, { key, resume });
    expect(first.status).toBe(503);
    expect(first.body.error).toEqual(UNAVAILABLE);
    expect(env.applications.all()).toHaveLength(1); // written, but not confirmed
    expect(env.storedObjects()).toHaveLength(1); // kept: it may belong to that record

    const retry = await applyRequest(env.app, { key, resume });
    expect(retry.status).toBe(503);
    expect(retry.body.error).toEqual(UNAVAILABLE);
    expect(retry.body.meta.replayed).toBeUndefined();
    expect(env.applications.all()).toHaveLength(1);
    expect(env.storedObjects()).toHaveLength(1); // nothing stored for the retry
    expect(env.tempFiles()).toEqual([]);
    expect(events('application_replay_unconfirmed')).toEqual([expect.objectContaining({ reason: 'REPLAY_UNCONFIRMED' })]);
    expect(events('application_replayed')).toEqual([]);

    majority.confirm();
    const replay = await applyRequest(env.app, { key, resume });
    expect(replay.status).toBe(200);
    expect(replay.body.meta.replayed).toBe(true);
    expect(replay.body.data.status).toBe('RECEIVED');
    expect(env.applications.all()).toHaveLength(1);
    expect(env.storedObjects()).toHaveLength(1);
    expect(env.tempFiles()).toEqual([]);
    expect(transport.calls).toHaveLength(0); // never notified by a replay
  });

  it('a lost-response retry after the Job has CLOSED still replays once the record is confirmed (Doc 09 section 121)', async () => {
    env = await createApplyEnvironment();
    const key = randomUUID();
    const resume = fixedResume();
    expect((await applyRequest(env.app, { key, resume })).status).toBe(201);
    const [job] = [...env.jobs.jobs.values()];
    env.jobs.update(job._id, { status: 'CLOSED', closedAt: QA_NOW });
    const majority = withMajorityLag();
    expect((await applyRequest(env.app, { key, resume })).status).toBe(503); // unconfirmed: no claim
    majority.confirm();
    const replay = await applyRequest(env.app, { key, resume });
    expect(replay.status).toBe(200);
    expect(replay.body.meta.replayed).toBe(true);
    expect(env.applications.all()).toHaveLength(1);
  });

  it('a different submission on a key whose record is unconfirmed is not answered 409 from the unconfirmed record: 503 until confirmed, then 409', async () => {
    env = await createApplyEnvironment();
    const key = randomUUID();
    expect((await applyRequest(env.app, { key })).status).toBe(201);
    const majority = withMajorityLag();
    expect((await applyRequest(env.app, { key, fields: { fullName: 'QA Different Person' } })).status).toBe(503);
    majority.confirm();
    const conflict = await applyRequest(env.app, { key, fields: { fullName: 'QA Different Person' } });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it.each([
    ['the key-hash unique index', { kind: 'DUPLICATE_KEY_HASH', reason: 'DUPLICATE_KEY_HASH' }],
    ['an unattributed unique index', { kind: 'DUPLICATE_OTHER', reason: 'DUPLICATE_OTHER_INDEX' }],
  ])('a race lost on %s to an UNCONFIRMED winner: ours is removed (the server refused it), no replay is claimed (503); once confirmed, a retry replays', async (_label, refusal) => {
    env = await createApplyEnvironment();
    const key = randomUUID();
    const resume = fixedResume();
    expect((await applyRequest(env.app, { key, resume })).status).toBe(201);
    const majority = withMajorityLag();
    // Force the second request past the replay lookup to the insert (as in a race).
    const lagged = env.applications.findByKeyHash;
    let first = true;
    env.applications.findByKeyHash = async (hash, options = {}) => {
      if (first && !options.majority) {
        first = false;
        return null;
      }
      return lagged(hash, options);
    };
    env.applications.nextInsert = refusal;
    const raced = await applyRequest(env.app, { key, resume });
    expect(raced.status).toBe(503);
    expect(raced.body.meta.replayed).toBeUndefined();
    expect(env.applications.all()).toHaveLength(1);
    expect(env.storedObjects()).toHaveLength(1); // ours compensated; the winner's kept
    expect(events('application_replay_unconfirmed')).toHaveLength(1);
    majority.confirm();
    const replay = await applyRequest(env.app, { key, resume });
    expect(replay.status).toBe(200);
    expect(replay.body.meta.replayed).toBe(true);
    expect(env.applications.all()).toHaveLength(1);
    expect(env.storedObjects()).toHaveLength(1);
  });
});

describe('an AMBIGUOUS persistence outcome (the write may or may not have happened)', () => {
  it('read-back finds OUR Application: it was persisted after all — 201', async () => {
    env = await createApplyEnvironment();
    env.applications.nextInsert = { kind: 'AMBIGUOUS', reason: 'NETWORK', persist: true };
    const response = await applyRequest(env.app);
    expect(response.status).toBe(201);
    expect(env.applications.all()).toHaveLength(1);
    expect(env.storedObjects()).toHaveLength(1);
    expect(events('application_persistence_confirmed')).toHaveLength(1);
    // Success is claimed only from a read with read concern "majority".
    expect(env.applications.calls.majorityReads).toBe(1);
  });

  it('read-back finds NOTHING: 503, no success or failure claimed, the object is KEPT and named for reconciliation', async () => {
    env = await createApplyEnvironment();
    env.applications.nextInsert = { kind: 'AMBIGUOUS', reason: 'NETWORK', persist: false };
    const response = await applyRequest(env.app);
    expect(response.status).toBe(503);
    expect(response.body.error).toEqual(UNAVAILABLE);
    expect(env.storedObjects()).toHaveLength(1); // NOT deleted: it may belong to a persisted Application
    const [ambiguous] = events('application_persistence_ambiguous');
    expect(ambiguous).toMatchObject({ reason: 'NETWORK', readBack: 'NOT_FOUND' });
    expect(ambiguous.storageKey).toBeUndefined();
    expect(ambiguous.objectRef).toBe(storageObjectRef(storedKeys()[0]));
    expectNoStorageKeyInLogs();
    expect(events('resume_compensation')).toEqual([]);
  });

  it('read-back itself fails: 503, the object is kept', async () => {
    env = await createApplyEnvironment();
    env.applications.nextInsert = { kind: 'AMBIGUOUS', reason: 'NETWORK', persist: false };
    let lookups = 0;
    const realFind = env.applications.findByKeyHash.bind(env.applications);
    env.applications.findByKeyHash = async (hash) => {
      lookups += 1;
      if (lookups > 1) throw dbUnavailable('timeout');
      return realFind(hash);
    };
    const response = await applyRequest(env.app);
    expect(response.status).toBe(503);
    expect(env.storedObjects()).toHaveLength(1);
    expect(events('application_persistence_ambiguous')[0]).toMatchObject({ readBack: 'READ_FAILED' });
  });

  it('an abandoned insert that later COMPLETES: 503 now, then the record exists, the object is kept, and a retry replays it', async () => {
    env = await createApplyEnvironment();
    env.applications.nextInsert = { kind: 'AMBIGUOUS', settleAfterMs: 50, settleAs: 'CREATED' };
    const key = randomUUID();
    const resume = { data: syntheticPdf(), filename: 'qa-resume.pdf', contentType: PDF_MIME };
    const first = await applyRequest(env.app, { key, resume });
    expect(first.status).toBe(503);
    await env.submission.drainFollowUps();
    expect(env.applications.all()).toHaveLength(1);
    expect(env.storedObjects()).toHaveLength(1);
    expect(events('application_persistence_resolved')).toEqual([expect.objectContaining({ outcome: 'PERSISTED' })]);
    const retry = await applyRequest(env.app, { key, resume });
    expect(retry.status).toBe(200);
    expect(retry.body.meta.replayed).toBe(true);
    expect(env.applications.all()).toHaveLength(1);
    expect(env.storedObjects()).toHaveLength(1);
  });

  it('an abandoned insert that later definitely FAILS: its object is then compensated', async () => {
    env = await createApplyEnvironment();
    env.applications.nextInsert = { kind: 'AMBIGUOUS', settleAfterMs: 50, settleAs: 'NOT_PERSISTED' };
    const response = await applyRequest(env.app);
    expect(response.status).toBe(503);
    expect(env.storedObjects()).toHaveLength(1);
    await env.submission.drainFollowUps();
    expect(env.storedObjects()).toEqual([]);
    expect(events('application_persistence_resolved')).toEqual([expect.objectContaining({ outcome: 'NOT_PERSISTED', compensation: 'DELETED' })]);
  });

  it('an abandoned insert that later fails with a SERVER ERROR: still not proof — the object stays, outcome UNKNOWN, named for reconciliation', async () => {
    env = await createApplyEnvironment();
    env.applications.nextInsert = { kind: 'AMBIGUOUS', settleAfterMs: 50, settleAs: 'AMBIGUOUS' };
    expect((await applyRequest(env.app)).status).toBe(503);
    await env.submission.drainFollowUps();
    expect(env.storedObjects()).toHaveLength(1);
    const [resolved] = events('application_persistence_resolved');
    expect(resolved).toMatchObject({ outcome: 'UNKNOWN', settledAs: 'AMBIGUOUS' });
    expect(resolved.objectRef).toBe(storageObjectRef(storedKeys()[0]));
    expectNoStorageKeyInLogs();
  });

  it('an abandoned insert that later loses the key race to ANOTHER request: its object is compensated only after the winner is read', async () => {
    env = await createApplyEnvironment();
    const key = randomUUID();
    env.applications.nextInsert = { kind: 'AMBIGUOUS', settleAfterMs: 1000, settleAs: 'DUPLICATE_KEY_HASH' };
    expect((await applyRequest(env.app, { key })).status).toBe(503);
    // Meanwhile the client's retry is accepted (no record existed yet).
    expect((await applyRequest(env.app, { key })).status).toBe(201);
    expect(env.storedObjects()).toHaveLength(2);
    await env.submission.drainFollowUps();
    expect(env.applications.all()).toHaveLength(1);
    expect(env.storedObjects()).toHaveLength(1); // the winner's
    expect(events('application_persistence_resolved')).toEqual([expect.objectContaining({ outcome: 'NOT_PERSISTED', compensation: 'DELETED' })]);
  });

  it('an abandoned insert that later reports a key-hash duplicate but NO winner can be read: the object is kept', async () => {
    env = await createApplyEnvironment();
    env.applications.nextInsert = { kind: 'AMBIGUOUS', settleAfterMs: 50, settleAs: 'DUPLICATE_KEY_HASH' };
    expect((await applyRequest(env.app)).status).toBe(503);
    await env.submission.drainFollowUps();
    expect(env.storedObjects()).toHaveLength(1);
    expect(events('application_persistence_resolved')).toEqual([expect.objectContaining({ outcome: 'UNKNOWN', settledAs: 'DUPLICATE_KEY_HASH' })]);
  });

  it('an ambiguous insert while another request with the SAME key won: ours is removed and the winner replayed', async () => {
    env = await createApplyEnvironment();
    const key = randomUUID();
    const resume = { data: syntheticPdf(), filename: 'qa-resume.pdf', contentType: PDF_MIME };
    expect((await applyRequest(env.app, { key, resume })).status).toBe(201);
    // Force the second request past the replay lookup to the insert (as in a race).
    const realFind = env.applications.findByKeyHash.bind(env.applications);
    let first = true;
    env.applications.findByKeyHash = async (hash) => {
      if (first) {
        first = false;
        return null;
      }
      return realFind(hash);
    };
    env.applications.nextInsert = { kind: 'AMBIGUOUS', reason: 'NETWORK', persist: false };
    const second = await applyRequest(env.app, { key, resume });
    expect(second.status).toBe(200);
    expect(second.body.meta.replayed).toBe(true);
    expect(env.applications.all()).toHaveLength(1);
    expect(env.storedObjects()).toHaveLength(1);
  });
});

describe('the notification boundary (Doc 09 sections 128-136; Doc 18 section 127; Doc 17 section 110)', () => {
  const internalOf = () => env.applications.all()[0].notifications.internal;

  it('B5 default (no provider): nothing attempted, nothing claimed — PENDING, attemptCount 0, logged NOT_ATTEMPTED', async () => {
    env = await createApplyEnvironment({ transport: null });
    expect((await applyRequest(env.app)).status).toBe(201);
    expect(internalOf()).toMatchObject({ status: 'PENDING', attemptCount: 0, lastAttemptAt: null, sentAt: null });
    expect(events('application_accepted')).toEqual([expect.objectContaining({ notification: 'NOT_ATTEMPTED', notificationReason: 'NOT_CONFIGURED' })]);
  });

  it('a provider failure after persistence: the Application stays accepted (201), notification FAILED is recorded', async () => {
    const transport = recordingTransport('PROVIDER_REJECTED');
    env = await createApplyEnvironment({ transport });
    const response = await applyRequest(env.app);
    expect(response.status).toBe(201);
    expect(env.applications.all()).toHaveLength(1);
    expect(env.storedObjects()).toHaveLength(1);
    expect(internalOf()).toMatchObject({ status: 'FAILED', attemptCount: 1, lastErrorCode: 'PROVIDER_REJECTED', sentAt: null });
    expect(internalOf().lastAttemptAt).toEqual(QA_NOW);
    // Only the internal id, the Job and the time reach the transport — no candidate data.
    expect(transport.calls).toHaveLength(1);
    expect(Object.keys(transport.calls[0]).sort()).toEqual(['applicationId', 'event', 'job', 'submittedAt']);
    expect(JSON.stringify(transport.calls[0])).not.toMatch(/QA Synthetic Candidate|example\.invalid|qa-resume/i);
  });

  it('an unclassified provider error is recorded as PROVIDER_ERROR, never its text', async () => {
    env = await createApplyEnvironment({ transport: recordingTransport(new Error('smtp 550 secret-token-QA')) });
    expect((await applyRequest(env.app)).status).toBe(201);
    expect(internalOf()).toMatchObject({ status: 'FAILED', lastErrorCode: 'PROVIDER_ERROR' });
    expect(env.log.output()).not.toContain('secret-token-QA');
  });

  it('a provider that hangs: answered within the bound, recorded FAILED / TIMEOUT, and the call is aborted', async () => {
    const transport = recordingTransport('hang');
    env = await createApplyEnvironment({ transport, notificationTimeoutMs: 150 });
    const started = Date.now();
    const response = await applyRequest(env.app);
    expect(response.status).toBe(201);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(internalOf()).toMatchObject({ status: 'FAILED', attemptCount: 1, lastErrorCode: 'TIMEOUT' });
    expect(transport.signals[0].aborted).toBe(true);
  });

  it('a provider that accepts (TEST DOUBLE — not email evidence): SENT recorded with sentAt', async () => {
    env = await createApplyEnvironment({ transport: recordingTransport('accept') });
    expect((await applyRequest(env.app)).status).toBe(201);
    expect(internalOf()).toMatchObject({ status: 'SENT', attemptCount: 1, lastErrorCode: null });
    expect(internalOf().sentAt).toEqual(QA_NOW);
  });

  it('recording the notification state fails: still 201, logged notification_state_unrecorded', async () => {
    env = await createApplyEnvironment({ transport: recordingTransport('PROVIDER_UNAVAILABLE') });
    env.applications.faults.recordNotification = dbUnavailable('timeout');
    const response = await applyRequest(env.app);
    expect(response.status).toBe(201);
    expect(events('notification_state_unrecorded')).toEqual([expect.objectContaining({ notification: 'FAILED' })]);
  });
});

describe('the Apply rate limit (Doc 09 sections 34-35; Doc 17 section 139)', () => {
  it('the 11th attempt in the window is 429 RATE_LIMITED with RateLimit headers; nothing is created by it', async () => {
    env = await createApplyEnvironment({ configOverrides: { applicationRateLimit: Object.freeze({ windowMs: 900_000, max: 10 }) } });
    const statuses = [];
    for (let attempt = 0; attempt < 10; attempt += 1) statuses.push((await applyRequest(env.app)).status);
    expect(statuses).toEqual(Array(10).fill(201));
    const limited = await applyRequest(env.app);
    expect(limited.status).toBe(429);
    expect(limited.body.error).toEqual({ code: 'RATE_LIMITED', message: 'Too many attempts were received in a short period. Please wait and try again.' });
    expect(limited.headers.ratelimit).toEqual(expect.any(String));
    expect(limited.headers.connection).toBe('close');
    expect(env.applications.all()).toHaveLength(10);
    expect(env.storedObjects()).toHaveLength(10);
    expect(env.tempFiles()).toEqual([]);
  }, 30_000);

  it('refused attempts count too (it limits attempts, not successes)', async () => {
    env = await createApplyEnvironment({ configOverrides: { applicationRateLimit: Object.freeze({ windowMs: 900_000, max: 3 }) } });
    for (let attempt = 0; attempt < 3; attempt += 1) expect((await applyRequest(env.app, { key: null })).status).toBe(400);
    expect((await applyRequest(env.app)).status).toBe(429);
  });

  it('is separate from the general limit: Job reads do not consume the Apply allowance', async () => {
    env = await createApplyEnvironment({ configOverrides: { applicationRateLimit: Object.freeze({ windowMs: 900_000, max: 2 }) } });
    const { default: request } = await import('supertest');
    for (let read = 0; read < 5; read += 1) await request(env.app).get('/api/v1/jobs');
    expect((await applyRequest(env.app)).status).toBe(201);
    expect((await applyRequest(env.app)).status).toBe(201);
    expect((await applyRequest(env.app)).status).toBe(429);
  });
});

describe('logs (Doc 09 sections 149-150; Doc 13 section 118; Doc 17 section 205)', () => {
  it('across success, replay, conflict, validation, failure, a failed compensation and an unknown outcome, no candidate data, filename, Idempotency-Key, key hash, storage key or path is logged', async () => {
    env = await createApplyEnvironment({ transport: recordingTransport('PROVIDER_REJECTED') });
    const key = randomUUID();
    const resume = { data: syntheticPdf(), filename: 'qa-private-filename-marker.pdf', contentType: PDF_MIME };
    const fields = { phone: QA_CANDIDATE.phone, message: 'QA-PRIVATE-MESSAGE-MARKER' };
    await applyRequest(env.app, { key, resume, fields });
    await applyRequest(env.app, { key, resume, fields });
    await applyRequest(env.app, { key, resume, fields: { ...fields, fullName: 'QA Other Name Marker' } });
    await applyRequest(env.app, { fields: { email: 'qa-invalid-email-marker' } });
    env.applications.nextInsert = { kind: 'NOT_PERSISTED', reason: 'DISCONNECTED' };
    await applyRequest(env.app, { resume, fields });
    env.applications.nextInsert = { kind: 'AMBIGUOUS', reason: 'SERVER_ERROR', persist: false };
    await applyRequest(env.app, { resume, fields });
    // A compensation that fails: the object stays (ORPHANED).
    const realDelete = env.storage.deletePrivateObject.bind(env.storage);
    env.storage.deletePrivateObject = async () => {
      throw new PrivateStorageError('delete', 'PERMISSION_DENIED');
    };
    env.applications.nextInsert = { kind: 'NOT_PERSISTED', reason: 'DISCONNECTED' };
    await applyRequest(env.app, { resume, fields });
    env.storage.deletePrivateObject = realDelete;

    const output = env.log.output();
    // Every object now in storage — accepted, kept after an unknown outcome,
    // orphaned — and none of their keys, key segments or the root is logged.
    expect(env.storedObjects()).toHaveLength(3);
    expectNoStorageKeyInLogs();
    expect(events('application_persistence_ambiguous')[0].objectRef).toMatch(/^[0-9a-f]{32}$/);
    expect(events('resume_compensation').find((entry) => entry.outcome === 'ORPHANED').objectRef).toMatch(/^[0-9a-f]{32}$/);
    const { hashIdempotencyKey } = await import('../src/modules/applications/application.service.js');
    for (const marker of [
      QA_CANDIDATE.fullName,
      'QA Other Name Marker',
      QA_CANDIDATE.email,
      QA_CANDIDATE.email.toLowerCase(),
      'qa-invalid-email-marker',
      QA_CANDIDATE.phone,
      'QA-PRIVATE-MESSAGE-MARKER',
      'QA TEST DATA short',
      'qa-private-filename-marker',
      key,
      hashIdempotencyKey(key),
      '%PDF',
    ]) {
      expect(output).not.toContain(marker);
    }
    // What IS logged: request ids, fixed tokens, the internal id, the Job slug.
    expect(events('application_accepted')[0]).toMatchObject({
      reqId: expect.any(String),
      applicationId: expect.stringMatching(/^[a-f0-9]{24}$/),
      jobSlug: 'qa-synthetic-apply-role',
      notification: 'FAILED',
      notificationReason: 'PROVIDER_REJECTED',
    });
    expect(events('application_replayed')).toHaveLength(1);
  });
});
