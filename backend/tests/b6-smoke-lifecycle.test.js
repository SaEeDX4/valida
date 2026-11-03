import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  finaliseSmokeRun,
  cleanupSmokeRun,
  reconcileSmokeRun,
  createOwnershipRecord,
  writeOwnershipRecord,
  readOwnershipRecord,
  releasingRecord,
  validateOwnershipRecord,
  ownershipRecordName,
  smokeDatabaseTarget,
  sameDatabaseTarget,
  classifyBounceExercise,
  findSmokeStorageDirectories,
  removeDirectoryConfirmed,
  smokeJobSlug,
  smokeStoragePrefix,
  SMOKE_JOB_TITLE_PREFIX,
  SMOKE_CANDIDATE_NAME,
} from '../scripts/smoke-lifecycle.mjs';
import { startServer } from '../src/server.js';
import { offlineDatabase, OFFLINE_TEST_MONGODB_URI, freePort } from './helpers.js';

/**
 * B6 r5 — the live smoke test's lifecycle (scripts/smoke-lifecycle.mjs), by
 * FAULT INJECTION: every dependency outcome is injected, nothing is sent and
 * no database is used (record discovery against a real database:
 * tests/db/b6-smoke-cleanup.test.js; the script end to end:
 * tests/db/b6-smoke-rehearsal.test.js).
 *
 * Each describe block answers one finding of GPT's source review of r4, all
 * reproduced on unchanged r4 first (B6 r5 review):
 *   1 — the final result must be truthful about shutdown and cleanup;
 *   2 — records and resume files stay consistent; only this run is touched;
 *   3 — the bounce exercise never claims more than the evidence shows;
 *   4 — the smoke-test server listens on loopback only.
 * r6 (GPT's review of r5, reproduced on unchanged r5): cleanup must PROVE the
 * run's ownership — record, database target, marker — before deleting
 * anything, and find the run's Applications by the recorded Job id even when
 * the Job is gone (regressions A–E).
 */
const RUN = '0a1b2c3d';
const OTHER_RUN = 'ffff0000';
const summarise = (error) => `${error?.name ?? 'Error'}${error?.code ? ` (${error.code})` : ''}`;

/** A finalisation with every dependency healthy unless overridden; records what was called. */
async function finalise(overrides = {}) {
  const calls = [];
  const evidence = { checks: {}, ...(overrides.evidence ?? {}) };
  const result = await finaliseSmokeRun({
    evidence,
    runFailed: overrides.runFailed ?? false,
    keepRecords: overrides.keepRecords ?? false,
    shutdown: overrides.shutdown === null ? null : async () => {
      calls.push('shutdown');
      return overrides.shutdown ? overrides.shutdown() : { clean: true };
    },
    cleanupRecords: async () => {
      calls.push('cleanup');
      return overrides.cleanup ? overrides.cleanup() : { complete: true, confirmed: { applicationsDeleted: 2, jobsDeleted: 1 }, remaining: { applications: 0, jobs: 0 }, discovered: { notSynthetic: { jobs: 0, applications: 0 } } };
    },
    removeStorage: () => {
      calls.push('removeStorage');
      if (overrides.removeStorage) overrides.removeStorage();
    },
    storageName: `${smokeStoragePrefix(RUN)}abc123`,
    summarise,
  });
  return { result, evidence, calls };
}

describe('finding 1 — the final result is truthful about shutdown and cleanup', () => {
  it('everything confirmed: not failed; shutdown clean, records removed, files removed — in that order', async () => {
    const { result, evidence, calls } = await finalise();
    expect(result.failed).toBe(false);
    expect(calls).toEqual(['shutdown', 'cleanup', 'removeStorage']);
    expect(evidence.shutdown).toEqual({ clean: true });
    expect(evidence.cleanup.records).toBe('REMOVED');
    expect(evidence.storage.files).toBe('REMOVED');
    expect(evidence.lifecycle.failures).toEqual([]);
  });

  it('shutdown reports clean: false -> FAILED (r4: PASS, exit 0); the cleanup still runs', async () => {
    const { result, evidence, calls } = await finalise({ shutdown: () => ({ clean: false }) });
    expect(result.failed).toBe(true);
    expect(result.failures).toEqual(['server shut down cleanly']);
    expect(evidence.shutdown).toEqual({ clean: false });
    expect(calls).toEqual(['shutdown', 'cleanup', 'removeStorage']);
  });

  it('shutdown THROWS -> FAILED, recorded with a value-free summary; every later step still runs and the evidence is complete (r4: the error escaped, nothing was cleaned, no evidence)', async () => {
    const { result, evidence, calls } = await finalise({
      shutdown: () => {
        throw Object.assign(new Error('secret detail must not appear'), { code: 'EBUSY' });
      },
    });
    expect(result.failed).toBe(true);
    expect(calls).toEqual(['shutdown', 'cleanup', 'removeStorage']);
    expect(evidence.shutdown).toEqual({ clean: false, error: 'Error (EBUSY)' });
    expect(JSON.stringify(evidence)).not.toContain('secret detail');
    expect(evidence.cleanup.records).toBe('REMOVED');
  });

  it('the record cleanup FAILS (database unreachable) -> FAILED, outcome UNKNOWN (r4: PASS, exit 0)', async () => {
    const { result, evidence } = await finalise({
      cleanup: () => {
        throw Object.assign(new Error('connect ECONNREFUSED'), { name: 'MongooseServerSelectionError' });
      },
    });
    expect(result.failed).toBe(true);
    expect(result.failures).toEqual(['synthetic records removed (confirmed by the database)']);
    expect(evidence.cleanup).toEqual({ records: 'UNKNOWN', error: 'MongooseServerSelectionError' });
  });

  it('the database confirms FEWER deletions than intended -> INCOMPLETE and FAILED; the confirmed counts are reported, not the intended ones (r4 reported the intended count)', async () => {
    const { result, evidence } = await finalise({
      cleanup: () => ({ complete: false, confirmed: { applicationsDeleted: 0, jobsDeleted: 0 }, remaining: { applications: 2, jobs: 1 }, discovered: { notSynthetic: { jobs: 0, applications: 0 } } }),
    });
    expect(result.failed).toBe(true);
    expect(evidence.cleanup).toMatchObject({ records: 'INCOMPLETE', confirmed: { applicationsDeleted: 0, jobsDeleted: 0 }, remaining: { applications: 2, jobs: 1 } });
  });

  it('removing the files fails -> FAILED (NOT_REMOVED)', async () => {
    const { result, evidence } = await finalise({
      removeStorage: () => {
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      },
    });
    expect(result.failed).toBe(true);
    expect(evidence.storage).toMatchObject({ files: 'NOT_REMOVED', error: 'Error (EPERM)' });
  });

  it('the run already failed: its ORIGINAL error is preserved, and every additional lifecycle failure is recorded beside it, in order', async () => {
    const { result, evidence } = await finalise({
      runFailed: true,
      evidence: { error: 'TypeError' },
      shutdown: () => ({ clean: false }),
      cleanup: () => {
        throw new Error('unreachable');
      },
    });
    expect(result.failed).toBe(true);
    expect(evidence.error).toBe('TypeError');
    expect(evidence.lifecycle.failures).toEqual(['server shut down cleanly', 'synthetic records removed (confirmed by the database)']);
  });

  it('a run that never started a server needs no shutdown — and still cleans up', async () => {
    const { result, evidence, calls } = await finalise({ shutdown: null });
    expect(result.failed).toBe(false);
    expect(evidence.shutdown).toEqual({ started: false });
    expect(calls).toEqual(['cleanup', 'removeStorage']);
  });
});

describe('finding 2 — records and their resume files stay consistent', () => {
  it('--keep-records keeps the records AND their files (r4 deleted the files); no cleanup or deletion is attempted', async () => {
    const { result, evidence, calls } = await finalise({ keepRecords: true });
    expect(result.failed).toBe(false);
    expect(result.recordsRemaining).toBe(true);
    expect(calls).toEqual(['shutdown']);
    expect(evidence.cleanup).toEqual({ records: 'KEPT', reason: '--keep-records' });
    expect(evidence.storage).toMatchObject({ files: 'RETAINED', reason: 'kept with the records they belong to (--keep-records)' });
  });

  it.each([
    ['fails', () => { throw new Error('unreachable'); }],
    ['is incomplete', () => ({ complete: false, confirmed: { applicationsDeleted: 1, jobsDeleted: 0 }, remaining: { applications: 1, jobs: 1 }, discovered: { notOwned: { jobs: 0, applications: 1 } } })],
  ])('when the record cleanup %s, the files are NOT deleted (records may still reference them)', async (_label, cleanup) => {
    const { evidence, calls, result } = await finalise({ cleanup });
    expect(calls).not.toContain('removeStorage');
    expect(evidence.storage).toMatchObject({ files: 'RETAINED', reason: 'records that reference them may still exist' });
    expect(result.recordsRemaining).toBe(true);
  });
});

/** A 24-hex id, like an ObjectId's string form. */
const oid = (n) => String(n).padStart(24, '0');
const JOB = oid('a1');
const TARGET_A = { name: 'valida_test_a', hosts: ['127.0.0.1:27017'] };
const TARGET_B = { name: 'valida_test_b', hosts: ['127.0.0.1:27017'] };
const TARGET_A_ELSEWHERE = { name: 'valida_test_a', hosts: ['db.other.example.test:27017'] };
const STORAGE = `${smokeStoragePrefix(RUN)}abc123`;

/** In-memory Job / Application models and the marker collection, with the subset of the API the cleanup uses; every call is counted. */
function fakeDatabase({ jobs = [], applications = [], markers = [], deletedCountOverride, releaseCount, connectError } = {}) {
  const state = { jobs: jobs.map((d) => ({ ...d })), applications: applications.map((d) => ({ ...d })), markers: markers.map((d) => ({ ...d })), connects: 0, disconnects: 0, calls: {} };
  const count = (name) => (state.calls[name] = (state.calls[name] ?? 0) + 1);
  const matches = (doc, filter) =>
    Object.entries(filter).every(([field, condition]) => {
      if (condition && typeof condition === 'object' && '$in' in condition) return condition.$in.map(String).includes(String(doc[field]));
      return String(doc[field]) === String(condition);
    });
  const model = (key, label) => ({
    find: (filter) => {
      count(`${label}.find`);
      return { lean: async () => state[key].filter((doc) => matches(doc, filter)).map((doc) => ({ ...doc })) };
    },
    async deleteMany(filter) {
      count(`${label}.deleteMany`);
      if (deletedCountOverride !== undefined) return { deletedCount: deletedCountOverride };
      const before = state[key].length;
      state[key] = state[key].filter((doc) => !matches(doc, filter));
      return { deletedCount: before - state[key].length };
    },
    async countDocuments(filter) {
      count(`${label}.countDocuments`);
      return state[key].filter((doc) => matches(doc, filter)).length;
    },
  });
  return {
    state,
    Job: model('jobs', 'Job'),
    Application: model('applications', 'Application'),
    markers: {
      async findOne(filter) {
        count('markers.findOne');
        return state.markers.find((doc) => matches(doc, filter)) ?? null;
      },
      async deleteOne(filter) {
        count('markers.deleteOne');
        if (releaseCount !== undefined) return { deletedCount: releaseCount };
        const before = state.markers.length;
        const index = state.markers.findIndex((doc) => matches(doc, filter));
        if (index >= 0) state.markers.splice(index, 1);
        return { deletedCount: before - state.markers.length };
      },
    },
    connect: async () => {
      state.connects += 1;
      if (connectError) throw connectError;
    },
    disconnect: async () => {
      state.disconnects += 1;
    },
  };
}
const syntheticJob = (id = JOB, runId = RUN) => ({ _id: id, slug: smokeJobSlug(runId), title: `${SMOKE_JOB_TITLE_PREFIX} ${runId}` });
const syntheticApplication = (id, jobId = JOB) => ({ _id: id, jobId, candidate: { fullName: SMOKE_CANDIDATE_NAME } });
const ownershipOf = (overrides = {}) => ({ ...createOwnershipRecord({ runId: RUN, target: TARGET_A, storageDirectory: STORAGE, jobId: JOB, nonce: 'f'.repeat(32) }), ...overrides });
const markerOf = (record) => ({ _id: record.runId, nonce: record.database.nonce, jobId: record.jobId, storageDirectory: record.storageDirectory });
const deletions = (db) => (db.state.calls['Application.deleteMany'] ?? 0) + (db.state.calls['Job.deleteMany'] ?? 0) + (db.state.calls['markers.deleteOne'] ?? 0);

describe('r6 — the database target: name AND servers, never credentials', () => {
  it('parses a target without credentials; sorts servers; distinguishes SRV; a name match alone is not the same target', () => {
    const withCredentials = smokeDatabaseTarget('mongodb://qa-user:qa-secret-marker@Db2.example.test:27018,db1.example.test:27017/valida_test_a?replicaSet=rs0');
    expect(withCredentials).toEqual({ name: 'valida_test_a', hosts: ['db1.example.test:27017', 'db2.example.test:27018'] });
    expect(JSON.stringify(withCredentials)).not.toMatch(/qa-user|qa-secret-marker/);
    expect(smokeDatabaseTarget('mongodb+srv://Cluster0.example.test/valida_test')).toEqual({ name: 'valida_test', hosts: ['srv:cluster0.example.test'] });
    expect(smokeDatabaseTarget('mongodb://127.0.0.1:27017')).toBeNull();
    expect(smokeDatabaseTarget('not a uri')).toBeNull();
    expect(sameDatabaseTarget(TARGET_A, { ...TARGET_A, hosts: [...TARGET_A.hosts] })).toBe(true);
    expect(sameDatabaseTarget(TARGET_A, TARGET_B)).toBe(false);
    expect(sameDatabaseTarget(TARGET_A, TARGET_A_ELSEWHERE)).toBe(false);
    expect(sameDatabaseTarget(TARGET_A, null)).toBe(false);
    expect(sameDatabaseTarget({ name: 'valida_test_a', hosts: [] }, { name: 'valida_test_a', hosts: [] })).toBe(false);
  });
});

describe('r6 — cleanup proves ownership before deleting anything (fault injection)', () => {
  it('E: the run\'s own database: the Job and its synthetic Applications — captured or not — are removed, and the re-count confirms it', async () => {
    const record = ownershipOf({ applicationIds: [oid('b1')] });
    const db = fakeDatabase({ jobs: [syntheticJob()], applications: [syntheticApplication(oid('b1')), syntheticApplication(oid('b2'))], markers: [markerOf(record)] });
    const result = await cleanupSmokeRun({ record, target: TARGET_A, ...db });
    expect(result).toEqual({
      complete: true,
      ownership: 'VERIFIED',
      discovered: { job: 'present', applications: 2, applicationsNotCapturedByTheRun: 1, applicationsWithMissingParentJob: 0, notOwned: { jobs: 0, applications: 0 } },
      confirmed: { applicationsDeleted: 2, jobsDeleted: 1 },
      remaining: { applications: 0, capturedApplications: 0, jobs: 0, jobsWithSlug: 0 },
    });
    expect(db.state.applications).toEqual([]);
    expect(db.state.markers).toHaveLength(1); // released only later, after the files
  });

  it('C: the Job is MISSING but its Applications survive — they are still found by the recorded Job id and removed (r5: "complete" with no Application query at all)', async () => {
    const record = ownershipOf({ applicationIds: [oid('b1')] });
    const db = fakeDatabase({ applications: [syntheticApplication(oid('b1')), syntheticApplication(oid('b2'))], markers: [markerOf(record)] });
    const result = await cleanupSmokeRun({ record, target: TARGET_A, ...db });
    expect(db.state.calls['Application.find']).toBeGreaterThanOrEqual(1);
    expect(result.discovered).toMatchObject({ job: 'missing', applications: 2, applicationsWithMissingParentJob: 2, applicationsNotCapturedByTheRun: 1 });
    expect(result.confirmed).toEqual({ applicationsDeleted: 2, jobsDeleted: 0 });
    expect(result.complete).toBe(true);
    expect(db.state.applications).toEqual([]);
  });

  it('C: Job missing and the surviving Applications cannot be deleted -> NOT complete (the database\'s own counts decide)', async () => {
    const record = ownershipOf();
    const db = fakeDatabase({ applications: [syntheticApplication(oid('b1'))], markers: [markerOf(record)], deletedCountOverride: 0 });
    const result = await cleanupSmokeRun({ record, target: TARGET_A, ...db });
    expect(result.complete).toBe(false);
    expect(result.remaining.applications).toBe(1);
  });

  it('A: another permitted test database -> REFUSED before connecting; nothing read or deleted', async () => {
    const record = ownershipOf();
    const db = fakeDatabase({ markers: [] });
    const result = await cleanupSmokeRun({ record, target: TARGET_B, ...db });
    expect(result).toMatchObject({ complete: false, refused: { code: 'TARGET_MISMATCH' } });
    expect(db.state.connects).toBe(0);
    expect(deletions(db)).toBe(0);
  });

  it.each([
    ['the same database name on other servers', TARGET_A_ELSEWHERE, (record) => [markerOf(record)], 'TARGET_MISMATCH'],
    ['the same name and servers, but no ownership marker (another server behind the same address, or ownership already released)', TARGET_A, () => [], 'OWNERSHIP_MARKER_ABSENT'],
    ['a marker with another nonce', TARGET_A, (record) => [{ ...markerOf(record), nonce: '0'.repeat(32) }], 'OWNERSHIP_MARKER_MISMATCH'],
    ['a marker naming another Job', TARGET_A, (record) => [{ ...markerOf(record), jobId: oid('ff') }], 'OWNERSHIP_MARKER_MISMATCH'],
    ['a marker naming another storage directory (a record edited to point elsewhere)', TARGET_A, (record) => [{ ...markerOf(record), storageDirectory: `${smokeStoragePrefix(RUN)}zzz999` }], 'OWNERSHIP_MARKER_MISMATCH'],
    ['a marker without a storage directory', TARGET_A, (record) => [{ ...markerOf(record), storageDirectory: undefined }], 'OWNERSHIP_MARKER_MISMATCH'],
  ])('B: %s -> REFUSED (%s); the run\'s records in that database are not touched', async (_label, target, markers, code) => {
    const record = ownershipOf();
    const db = fakeDatabase({ jobs: [syntheticJob()], applications: [syntheticApplication(oid('b1'))], markers: markers(record) });
    const result = await cleanupSmokeRun({ record, target, ...db });
    expect(result).toMatchObject({ complete: false, refused: { code } });
    expect(deletions(db)).toBe(0);
    expect(db.state.applications).toHaveLength(1);
    expect(db.state.jobs).toHaveLength(1);
  });

  it.each([
    ['no nonce', (r) => ({ ...r, database: { ...r.database, nonce: undefined } })],
    ['a storage directory with a path', (r) => ({ ...r, storageDirectory: `../${STORAGE}` })],
    ['another run\'s storage directory', (r) => ({ ...r, storageDirectory: `${smokeStoragePrefix(OTHER_RUN)}abc123` })],
    ['the bare prefix as a directory', (r) => ({ ...r, storageDirectory: smokeStoragePrefix(RUN) })],
    ['another run id', (r) => ({ ...r, runId: OTHER_RUN })],
    ['an unknown kind', (r) => ({ ...r, kind: 'something-else' })],
    ['an unknown version', (r) => ({ ...r, version: 2 })],
    ['a malformed Job id', (r) => ({ ...r, jobId: 'qa-smoke-*' })],
    ['malformed Application ids', (r) => ({ ...r, applicationIds: ['not-an-id'] })],
    ['no servers', (r) => ({ ...r, database: { ...r.database, hosts: [] } })],
    ['an unknown state', (r) => ({ ...r, state: 'GUESSED' })],
  ])('D: an ownership record with %s is refused without connecting', async (_label, mutate) => {
    const record = mutate(ownershipOf());
    const db = fakeDatabase({ jobs: [syntheticJob()], markers: [markerOf(ownershipOf())] });
    const result = await cleanupSmokeRun({ record, target: TARGET_A, ...db });
    expect(result).toMatchObject({ complete: false, refused: { code: expect.stringMatching(/^OWNERSHIP_RECORD_INVALID$|^TARGET_MISMATCH$/) } });
    expect(db.state.connects).toBe(0);
    expect(validateOwnershipRecord(record, RUN).ok).toBe(false);
  });

  it('never touches what is not positively the run\'s: a non-synthetic Application of the Job, another Job with the run\'s slug, a captured id that now points elsewhere', async () => {
    const record = ownershipOf({ applicationIds: [oid('c1')] });
    const db = fakeDatabase({
      jobs: [syntheticJob(), { _id: oid('a2'), slug: smokeJobSlug(RUN), title: 'Not the run\'s job' }, syntheticJob(oid('a3'), OTHER_RUN)],
      applications: [
        syntheticApplication(oid('b1')),
        { _id: oid('b9'), jobId: JOB, candidate: { fullName: 'A real person' } },
        { _id: oid('c1'), jobId: oid('a3'), candidate: { fullName: SMOKE_CANDIDATE_NAME } },
      ],
      markers: [markerOf(record)],
    });
    const result = await cleanupSmokeRun({ record, target: TARGET_A, ...db });
    expect(result.complete).toBe(false);
    expect(result.discovered.notOwned).toEqual({ jobs: 1, applications: 2 });
    expect(result.confirmed).toEqual({ applicationsDeleted: 1, jobsDeleted: 0 });
    expect(db.state.applications.map((a) => a._id).sort()).toEqual([oid('b9'), oid('c1')]);
    expect(db.state.jobs).toHaveLength(3);
  });
});

describe('r6 — --cleanup-run reconciliation (fault injection; real files in a temporary directory)', () => {
  const made = [];
  afterEach(() => {
    while (made.length) fs.rmSync(made.pop(), { recursive: true, force: true });
  });
  /** A temporary directory with the run's storage directory (one synthetic resume file) and, optionally, its ownership record. */
  function workspace(record = ownershipOf()) {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'valida-r6-test-'));
    made.push(temporaryDirectory);
    const storage = path.join(temporaryDirectory, STORAGE);
    fs.mkdirSync(storage);
    fs.writeFileSync(path.join(storage, 'resume-object'), 'synthetic resume');
    if (record) writeOwnershipRecord(temporaryDirectory, record);
    return { temporaryDirectory, storage, resume: path.join(storage, 'resume-object') };
  }
  const recordIn = (temporaryDirectory) => JSON.parse(fs.readFileSync(path.join(temporaryDirectory, ownershipRecordName(RUN)), 'utf8'));

  it('E: COMPLETE — records, then exactly the recorded directory, then the marker, then the record marked CLEANED; a repeat is ALREADY_CLEANED and touches nothing', async () => {
    const record = ownershipOf();
    const { temporaryDirectory, storage } = workspace(record);
    const db = fakeDatabase({ jobs: [syntheticJob()], applications: [syntheticApplication(oid('b1'))], markers: [markerOf(record)] });
    const first = await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_A, ...db });
    expect(first).toMatchObject({ outcome: 'COMPLETE', files: { directory: STORAGE, existed: true, removed: true }, untouched: [] });
    expect(fs.existsSync(storage)).toBe(false);
    expect(db.state.markers).toEqual([]);
    expect(recordIn(temporaryDirectory)).toMatchObject({ state: 'CLEANED', confirmed: { applicationsDeleted: 1, jobsDeleted: 1 } });

    const before = deletions(db);
    const second = await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_A, ...db });
    expect(second.outcome).toBe('ALREADY_CLEANED');
    expect(deletions(db)).toBe(before);
    expect(db.state.connects).toBe(2); // the first run's cleanup and release only

    fs.mkdirSync(storage);
    const inconsistent = await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_A, ...db });
    expect(inconsistent).toMatchObject({ outcome: 'REFUSED', code: 'OWNERSHIP_RECORD_INCONSISTENT' });
    expect(fs.existsSync(storage)).toBe(true);
  });

  it('A: the cleanup pointed at another permitted test database -> REFUSED; the run\'s file and its records stay (r5 removed the file and said COMPLETE)', async () => {
    const record = ownershipOf();
    const { temporaryDirectory, resume } = workspace(record);
    const db = fakeDatabase();
    const result = await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_B, ...db });
    expect(result).toMatchObject({ outcome: 'REFUSED', code: 'TARGET_MISMATCH', untouched: [STORAGE] });
    expect(fs.readFileSync(resume, 'utf8')).toBe('synthetic resume');
    expect(recordIn(temporaryDirectory).state).toBe('ACTIVE');
  });

  it('B: same name and servers, but this database holds no marker -> REFUSED, file kept', async () => {
    const { temporaryDirectory, resume } = workspace();
    const db = fakeDatabase({ jobs: [], applications: [] });
    const result = await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_A, ...db });
    expect(result).toMatchObject({ outcome: 'REFUSED', code: 'OWNERSHIP_MARKER_ABSENT' });
    expect(fs.existsSync(resume)).toBe(true);
  });

  it('C: missing parent Job, surviving Application that cannot be removed -> INCOMPLETE, its file kept; once it can be removed -> COMPLETE', async () => {
    const record = ownershipOf();
    const { temporaryDirectory, resume } = workspace(record);
    const stuck = fakeDatabase({ applications: [syntheticApplication(oid('b1'))], markers: [markerOf(record)], deletedCountOverride: 0 });
    const incomplete = await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_A, ...stuck });
    expect(incomplete).toMatchObject({ outcome: 'INCOMPLETE', code: 'RECORDS_REMAIN' });
    expect(fs.existsSync(resume)).toBe(true);
    const working = fakeDatabase({ applications: [syntheticApplication(oid('b1'))], markers: [markerOf(record)] });
    const complete = await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_A, ...working });
    expect(complete.outcome).toBe('COMPLETE');
    expect(complete.cleanup.discovered.applicationsWithMissingParentJob).toBe(1);
    expect(fs.existsSync(resume)).toBe(false);
  });

  it('D: no ownership record (every run made before r6) -> REFUSED without connecting; the directory is listed as untouched', async () => {
    const { temporaryDirectory, resume } = workspace(null);
    const db = fakeDatabase({ jobs: [syntheticJob()] });
    const result = await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_A, ...db });
    expect(result).toEqual({ outcome: 'REFUSED', code: 'OWNERSHIP_RECORD_MISSING', reason: expect.stringContaining('never guessed'), untouched: [STORAGE] });
    expect(db.state.connects).toBe(0);
    expect(fs.existsSync(resume)).toBe(true);
  });

  it('D: a corrupted or inconsistent record -> REFUSED; files kept', async () => {
    const { temporaryDirectory, resume } = workspace(null);
    fs.writeFileSync(path.join(temporaryDirectory, ownershipRecordName(RUN)), '{ not json');
    const db = fakeDatabase();
    expect(await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_A, ...db })).toMatchObject({ outcome: 'REFUSED', code: 'OWNERSHIP_RECORD_INVALID' });
    fs.writeFileSync(path.join(temporaryDirectory, ownershipRecordName(RUN)), JSON.stringify({ ...ownershipOf(), runId: OTHER_RUN }));
    expect(await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_A, ...db })).toMatchObject({ outcome: 'REFUSED', code: 'OWNERSHIP_RECORD_INVALID' });
    expect(fs.existsSync(resume)).toBe(true);
    expect(db.state.connects).toBe(0);
  });

  it('D: an ACTIVE record naming a storage directory that does not exist while another directory of the run does -> REFUSED (inconsistent) without connecting; both kept', async () => {
    const record = ownershipOf({ storageDirectory: `${smokeStoragePrefix(RUN)}zzz999` });
    const { temporaryDirectory, resume } = workspace(record);
    const db = fakeDatabase({ jobs: [syntheticJob()], applications: [syntheticApplication(oid('b1'))], markers: [markerOf(record)] });
    const result = await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_A, ...db });
    expect(result).toMatchObject({ outcome: 'REFUSED', code: 'OWNERSHIP_RECORD_INCONSISTENT', untouched: [STORAGE] });
    expect(db.state.connects).toBe(0);
    expect(deletions(db)).toBe(0);
    expect(fs.readFileSync(resume, 'utf8')).toBe('synthetic resume');
    expect(recordIn(temporaryDirectory).state).toBe('ACTIVE');
  });

  it('only the directory the record names is removed; another directory with the run\'s prefix is left untouched and reported', async () => {
    const record = ownershipOf();
    const { temporaryDirectory } = workspace(record);
    const stray = path.join(temporaryDirectory, `${smokeStoragePrefix(RUN)}zzz999`);
    fs.mkdirSync(stray);
    const db = fakeDatabase({ jobs: [syntheticJob()], markers: [markerOf(record)] });
    const result = await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_A, ...db });
    expect(result).toMatchObject({ outcome: 'COMPLETE', untouched: [`${smokeStoragePrefix(RUN)}zzz999`] });
    expect(fs.existsSync(stray)).toBe(true);
  });

  it('the database cannot be used -> FAILED; nothing deleted, files kept', async () => {
    const { temporaryDirectory, resume } = workspace();
    const db = fakeDatabase({ connectError: Object.assign(new Error('unreachable'), { name: 'MongooseServerSelectionError' }) });
    const result = await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_A, ...db });
    expect(result).toMatchObject({ outcome: 'FAILED', code: 'CLEANUP_FAILED' });
    expect(fs.existsSync(resume)).toBe(true);
  });

  it('the marker cannot be released after the files are gone -> INCOMPLETE with the record RELEASING (r7); a repeat (marker still there, nothing else left) releases it and marks CLEANED', async () => {
    const record = ownershipOf();
    const { temporaryDirectory, storage } = workspace(record);
    const failing = fakeDatabase({ jobs: [syntheticJob()], markers: [markerOf(record)], releaseCount: 0 });
    expect(await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_A, ...failing })).toMatchObject({ outcome: 'INCOMPLETE', code: 'MARKER_NOT_RELEASED' });
    expect(fs.existsSync(storage)).toBe(false);
    expect(recordIn(temporaryDirectory)).toMatchObject({ state: 'RELEASING', confirmed: { applicationsDeleted: 0, jobsDeleted: 1 } });
    const later = fakeDatabase({ markers: [markerOf(record)] });
    expect(await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_A, ...later })).toMatchObject({ outcome: 'COMPLETE', resumed: true, release: { markerRelease: 'released' } });
    expect(later.state.markers).toEqual([]);
    expect(recordIn(temporaryDirectory)).toMatchObject({ state: 'CLEANED', markerRelease: 'released' });
  });
});

describe('r6 — the end of a live run releases ownership only after records and files are gone', () => {
  it('confirmed: the marker is released, then the record marked CLEANED', async () => {
    const calls = [];
    const evidence = { checks: {} };
    const withOwnership = await finaliseSmokeRun({
      evidence,
      runFailed: false,
      keepRecords: false,
      shutdown: async () => ({ clean: true }),
      cleanupRecords: async () => ({ complete: true, confirmed: { applicationsDeleted: 1, jobsDeleted: 1 }, remaining: {} }),
      removeStorage: () => calls.push('files'),
      recordReleasing: () => calls.push('releasing'),
      releaseOwnership: async () => {
        calls.push('release');
        return { released: true };
      },
      recordCleaned: () => calls.push('record'),
      storageName: STORAGE,
    });
    expect(withOwnership.failed).toBe(false);
    expect(calls).toEqual(['files', 'releasing', 'release', 'record']);
    expect(evidence.lifecycle.failures).toEqual([]);
    expect(evidence.lifecycle.steps.map((step) => step.name)).toEqual([
      'server shut down cleanly',
      'synthetic records removed (confirmed by the database)',
      'resume files removed (confirmed)',
      'ownership record marked RELEASING (records and files confirmed removed)',
      'ownership marker released (confirmed)',
      'ownership record marked CLEANED',
    ]);
  });

  it('a REFUSED cleanup keeps the files, releases nothing, and FAILS', async () => {
    const calls = [];
    const evidence = { checks: {} };
    const result = await finaliseSmokeRun({
      evidence,
      runFailed: false,
      keepRecords: false,
      shutdown: null,
      cleanupRecords: async () => ({ complete: false, refused: { code: 'OWNERSHIP_MARKER_ABSENT', reason: 'no marker' }, confirmed: { applicationsDeleted: 0, jobsDeleted: 0 } }),
      removeStorage: () => calls.push('files'),
      recordReleasing: () => calls.push('releasing'),
      releaseOwnership: async () => calls.push('release'),
      recordCleaned: () => calls.push('record'),
      storageName: STORAGE,
    });
    expect(result.failed).toBe(true);
    expect(calls).toEqual([]);
    expect(evidence.cleanup.records).toBe('REFUSED');
    expect(evidence.storage.files).toBe('RETAINED');
  });

  it('a marker that is not released -> FAILED, and the record is NOT marked CLEANED; with no marker to release (the run never wrote one) the record is still marked', async () => {
    const calls = [];
    const failedRelease = await finaliseSmokeRun({
      evidence: { checks: {} },
      runFailed: false,
      keepRecords: false,
      shutdown: null,
      cleanupRecords: async () => ({ complete: true, confirmed: {}, remaining: {} }),
      removeStorage: () => {},
      recordReleasing: () => calls.push('releasing'),
      releaseOwnership: async () => ({ released: false }),
      recordCleaned: () => calls.push('record'),
      storageName: STORAGE,
    });
    expect(failedRelease.failed).toBe(true);
    expect(calls).toEqual(['releasing']);
    calls.length = 0;
    const noMarker = await finaliseSmokeRun({
      evidence: { checks: {} },
      runFailed: true,
      keepRecords: false,
      shutdown: null,
      cleanupRecords: async () => ({ complete: true, ownership: 'NOTHING_CREATED', confirmed: {}, remaining: {} }),
      removeStorage: () => {},
      releaseOwnership: null,
      recordCleaned: () => calls.push('record'),
      storageName: STORAGE,
    });
    expect(noMarker.failed).toBe(true); // the run itself failed
    expect(calls).toEqual(['record']);
  });
});

describe('finding 2 — the run\'s resume-file directories', () => {
  const made = [];
  afterEach(() => {
    while (made.length) fs.rmSync(made.pop(), { recursive: true, force: true });
  });

  it('only directories named for THIS run are found; files and other runs are ignored; removal is confirmed', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'valida-r5-test-'));
    made.push(base);
    const mine = fs.mkdtempSync(path.join(base, smokeStoragePrefix(RUN)));
    fs.writeFileSync(path.join(mine, 'resume-object'), 'synthetic');
    const other = fs.mkdtempSync(path.join(base, smokeStoragePrefix(OTHER_RUN)));
    fs.writeFileSync(path.join(base, `${smokeStoragePrefix(RUN)}not-a-directory`), 'x');
    expect(findSmokeStorageDirectories(RUN, base)).toEqual([mine]);
    removeDirectoryConfirmed(mine);
    expect(fs.existsSync(mine)).toBe(false);
    expect(fs.existsSync(other)).toBe(true);
    expect(() => findSmokeStorageDirectories('../../etc', base)).toThrow(TypeError);
  });

  it('a removal that leaves the directory behind is reported, not assumed', () => {
    const stuck = { rmSync() {}, existsSync: () => true };
    expect(() => removeDirectoryConfirmed('/anything', stuck)).toThrow(/still exists/);
  });
});

describe('finding 3 — the bounce exercise reports only what the evidence establishes', () => {
  const sent = { status: 'SENT', lastErrorCode: null };
  const failed = (code) => ({ status: 'FAILED', lastErrorCode: code });
  const submission = (result, diagnostic) => ({ event: 'APPLICATION_ACKNOWLEDGEMENT', result, ...(diagnostic ? { diagnostic } : {}) });

  it.each([
    ['accepted (SENT, transport reported acceptance)', 'ACCEPTED_BY_RELAY', 'PENDING_MANUAL', sent, submission('ACCEPTED_BY_RELAY')],
    ['recipient refused by the relay (550)', 'REJECTED_BY_RELAY', 'NOT_EXERCISED', failed('INVALID_RECIPIENT'), submission('FAILED:INVALID_RECIPIENT', { phase: 'envelope', replyCode: 550 })],
    ['message refused by the relay after the body (554)', 'REJECTED_BY_RELAY', 'NOT_EXERCISED', failed('PROVIDER_REJECTED'), submission('FAILED:PROVIDER_REJECTED', { phase: 'data', replyCode: 554 })],
    ['temporarily refused (451)', 'DEFERRED_BY_RELAY', 'NOT_EXERCISED', failed('PROVIDER_UNAVAILABLE'), submission('FAILED:PROVIDER_UNAVAILABLE', { phase: 'envelope', replyCode: 451 })],
    ['authentication refused', 'CONFIGURATION_FAILURE', 'NOT_EXERCISED', failed('PROVIDER_AUTH_FAILED'), submission('FAILED:PROVIDER_AUTH_FAILED', { phase: 'auth', replyCode: 535 })],
    ['TLS could not be verified', 'CONFIGURATION_FAILURE', 'NOT_EXERCISED', failed('TLS_FAILED'), submission('FAILED:TLS_FAILED', { phase: 'connect', errorCode: 'CERT_HAS_EXPIRED' })],
    ['sender refused (553)', 'CONFIGURATION_FAILURE', 'NOT_EXERCISED', failed('SENDER_NOT_VERIFIED'), submission('FAILED:SENDER_NOT_VERIFIED', { phase: 'envelope', replyCode: 553 })],
    ['connection refused before anything was submitted', 'NOT_SUBMITTED', 'NOT_EXERCISED', failed('PROVIDER_UNAVAILABLE'), submission('FAILED:PROVIDER_UNAVAILABLE', { phase: 'connect', errorCode: 'ECONNREFUSED' })],
    ['refused before the transport was called (address check)', 'NOT_SUBMITTED', 'NOT_EXERCISED', failed('INVALID_RECIPIENT'), null],
    ['refused before the transport was called (allowlist)', 'NOT_SUBMITTED', 'NOT_EXERCISED', failed('RECIPIENT_NOT_ALLOWED'), null],
    ['OUTCOME_UNKNOWN (connection lost after the body)', 'UNKNOWN', 'INCONCLUSIVE', failed('OUTCOME_UNKNOWN'), submission('FAILED:OUTCOME_UNKNOWN', { phase: 'data', errorCode: 'ECONNECTION' })],
    ['TIMEOUT', 'UNKNOWN', 'INCONCLUSIVE', failed('TIMEOUT'), submission('FAILED:TIMEOUT')],
    ['PROVIDER_ERROR', 'UNKNOWN', 'INCONCLUSIVE', failed('PROVIDER_ERROR'), null],
    ['an attempt still in progress', 'UNKNOWN', 'INCONCLUSIVE', { status: 'PENDING', lastErrorCode: 'ATTEMPT_IN_PROGRESS' }, submission(undefined)],
    ['an unrecognised code', 'UNKNOWN', 'INCONCLUSIVE', failed('SOMETHING_NEW'), submission('FAILED:SOMETHING_NEW')],
    ['no recorded state at all', 'UNKNOWN', 'INCONCLUSIVE', null, null],
    ['SENT without a transport acceptance (contradictory evidence)', 'UNKNOWN', 'INCONCLUSIVE', sent, null],
    ['FAILED although the transport reported acceptance (contradictory evidence)', 'UNKNOWN', 'INCONCLUSIVE', failed('INVALID_RECIPIENT'), submission('ACCEPTED_BY_RELAY')],
    ['a failure with no reply after the body began', 'UNKNOWN', 'INCONCLUSIVE', failed('PROVIDER_UNAVAILABLE'), submission('FAILED:PROVIDER_UNAVAILABLE', { phase: 'data' })],
  ])('%s -> %s (%s)', (_label, outcome, verification, recorded, ledgerEntry) => {
    const verdict = classifyBounceExercise({ recorded, submission: ledgerEntry });
    expect(verdict.outcome).toBe(outcome);
    expect(verdict.bounceVerification).toBe(verification);
  });

  it('only an explicit 5xx says the relay REFUSED it; an unknown outcome never says "refused" or "no bounce", and says a bounce MAY arrive', () => {
    const unknown = classifyBounceExercise({ recorded: { status: 'FAILED', lastErrorCode: 'OUTCOME_UNKNOWN' }, submission: { result: 'FAILED:OUTCOME_UNKNOWN', diagnostic: { phase: 'data' } } });
    expect(unknown.line).not.toMatch(/refused|no bounce/i);
    expect(unknown.line).toMatch(/MAY still arrive/);
    expect(unknown.line).toMatch(/INCONCLUSIVE/);
    expect(unknown.relayAcceptance).toBe('unknown');
    expect(unknown.line).toMatch(/never retried automatically/);
    for (const code of ['TIMEOUT', 'PROVIDER_AUTH_FAILED', 'PROVIDER_UNAVAILABLE']) {
      const verdict = classifyBounceExercise({ recorded: { status: 'FAILED', lastErrorCode: code }, submission: { result: `FAILED:${code}`, diagnostic: { phase: 'connect' } } });
      expect(verdict.line, code).not.toMatch(/explicitly REFUSED/);
    }
    const refused = classifyBounceExercise({ recorded: { status: 'FAILED', lastErrorCode: 'INVALID_RECIPIENT' }, submission: { result: 'FAILED:INVALID_RECIPIENT', diagnostic: { phase: 'envelope', replyCode: 550 } } });
    expect(refused.line).toMatch(/explicitly REFUSED/);
    expect(refused.replyCode).toBe(550);
  });
});

describe('finding 4 — startServer can be bound to loopback; the default is unchanged', () => {
  const handles = [];
  afterEach(async () => {
    while (handles.length) await handles.pop().shutdown('test cleanup');
  });
  async function start(extra = {}) {
    const port = await freePort();
    const handle = await startServer({
      env: { NODE_ENV: 'test', APP_ENV: 'local', PORT: String(port), LOG_LEVEL: 'silent', MONGODB_URI: OFFLINE_TEST_MONGODB_URI },
      database: offlineDatabase(),
      ...extra,
    });
    handles.push(handle);
    return { handle, port };
  }
  const reach = (host, port) =>
    new Promise((resolve) => {
      const socket = net.connect({ host, port });
      socket.setTimeout(2_000, () => {
        socket.destroy();
        resolve('timeout');
      });
      socket.once('connect', () => {
        socket.destroy();
        resolve('connected');
      });
      socket.once('error', (error) => resolve(error.code));
    });

  it('listenHost 127.0.0.1: the ACTUAL listening address is 127.0.0.1 (r4 ignored it: 0.0.0.0), and a non-loopback address of this machine is refused', async () => {
    const { handle, port } = await start({ listenHost: '127.0.0.1' });
    expect(handle.server.address()).toMatchObject({ address: '127.0.0.1', port });
    expect(await reach('127.0.0.1', port)).toBe('connected');
    const external = Object.values(os.networkInterfaces())
      .flat()
      .find((entry) => entry && entry.family === 'IPv4' && !entry.internal);
    if (external) expect(await reach(external.address, port)).not.toBe('connected');
  });

  it('without listenHost (production, npm start) the server listens on every interface, as before', async () => {
    const { handle } = await start();
    expect(['::', '0.0.0.0']).toContain(handle.server.address().address);
  });
});

describe('r7 — the cleanup receipt: a failed write after the marker is released is recoverable (fault injection; real files)', () => {
  /*
   * GPT's r6 reproduction: records and files removed, marker deleted, then the
   * CLEANED receipt could not be written -> RECORD_NOT_UPDATED, and every
   * retry -> OWNERSHIP_MARKER_ABSENT, permanently. r7 writes a RELEASING record
   * (durable evidence that the records and files were confirmed removed) BEFORE
   * the marker is released; a retry finishes from it. An ACTIVE record without a
   * marker is still refused — an absent marker alone never proves a cleanup.
   */
  const made = [];
  afterEach(() => {
    while (made.length) fs.rmSync(made.pop(), { recursive: true, force: true });
  });
  function workspace(record = ownershipOf(), { storage = true } = {}) {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'valida-r7-test-'));
    made.push(temporaryDirectory);
    const directory = path.join(temporaryDirectory, STORAGE);
    if (storage) {
      fs.mkdirSync(directory);
      fs.writeFileSync(path.join(directory, 'resume-object'), 'synthetic resume');
    }
    if (record) writeOwnershipRecord(temporaryDirectory, record);
    return { temporaryDirectory, directory };
  }
  const recordIn = (temporaryDirectory) => JSON.parse(fs.readFileSync(path.join(temporaryDirectory, ownershipRecordName(RUN)), 'utf8'));
  const leftovers = (temporaryDirectory) => fs.readdirSync(temporaryDirectory).filter((name) => name.endsWith('.partial'));
  /** The real file system, except that installing a record in `state` fails (`times` times). */
  function failingInstall(state, times = 1) {
    let remaining = times;
    return new Proxy(fs, {
      get(target, property) {
        if (property !== 'renameSync') return target[property];
        return (from, to) => {
          if (remaining > 0 && to.endsWith(ownershipRecordName(RUN)) && JSON.parse(target.readFileSync(from, 'utf8')).state === state) {
            remaining -= 1;
            throw Object.assign(new Error('injected: the record could not be installed'), { code: 'EIO' });
          }
          return target.renameSync(from, to);
        };
      },
    });
  }

  it('GPT\'s sequence: the CLEANED receipt cannot be written after the marker is released -> INCOMPLETE (RECEIPT_NOT_WRITTEN), the record says RELEASING; a retry FINISHES (marker already released) and a further retry is ALREADY_CLEANED', async () => {
    const record = ownershipOf();
    const { temporaryDirectory, directory } = workspace(record);
    const db = fakeDatabase({ jobs: [syntheticJob()], applications: [syntheticApplication(oid('b1'))], markers: [markerOf(record)] });

    const first = await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_A, ...db, fileSystem: failingInstall('CLEANED') });
    expect(first).toMatchObject({ outcome: 'INCOMPLETE', code: 'RECEIPT_NOT_WRITTEN' });
    expect(db.state).toMatchObject({ jobs: [], applications: [], markers: [] });
    expect(fs.existsSync(directory)).toBe(false);
    expect(recordIn(temporaryDirectory)).toMatchObject({ state: 'RELEASING', recordsRemovedAt: expect.any(String), confirmed: { applicationsDeleted: 1, jobsDeleted: 1 } });
    expect(leftovers(temporaryDirectory)).toEqual([]);

    const deletionsBefore = deletions(db);
    const retry = await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_A, ...db });
    expect(retry).toMatchObject({ outcome: 'COMPLETE', resumed: true, release: { markerRelease: 'already released', remaining: { applications: 0, jobs: 0 } } });
    expect(deletions(db)).toBe(deletionsBefore); // finishing deletes nothing
    expect(recordIn(temporaryDirectory)).toMatchObject({ state: 'CLEANED', markerRelease: 'already released', confirmed: { applicationsDeleted: 1, jobsDeleted: 1 } });

    expect(await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_A, ...db })).toMatchObject({ outcome: 'ALREADY_CLEANED' });
  });

  it('the RELEASING record itself cannot be written -> INCOMPLETE (RECORD_NOT_UPDATED) and the marker is KEPT (never released without the evidence); no partial file is left; a retry completes normally', async () => {
    const record = ownershipOf();
    const { temporaryDirectory } = workspace(record);
    const db = fakeDatabase({ jobs: [syntheticJob()], markers: [markerOf(record)] });

    const first = await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_A, ...db, fileSystem: failingInstall('RELEASING') });
    expect(first).toMatchObject({ outcome: 'INCOMPLETE', code: 'RECORD_NOT_UPDATED' });
    expect(db.state.calls['markers.deleteOne'] ?? 0).toBe(0);
    expect(db.state.markers).toHaveLength(1);
    expect(recordIn(temporaryDirectory).state).toBe('ACTIVE');
    expect(leftovers(temporaryDirectory)).toEqual([]);

    const retry = await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_A, ...db });
    expect(retry).toMatchObject({ outcome: 'COMPLETE' });
    expect(retry.resumed).toBeUndefined();
    expect(db.state.markers).toEqual([]);
    expect(recordIn(temporaryDirectory)).toMatchObject({ state: 'CLEANED', markerRelease: 'released' });
  });

  it('an ACTIVE record whose marker is gone is STILL refused (OWNERSHIP_MARKER_ABSENT) — even with no records and no files: an absent marker is never taken as proof of a cleanup', async () => {
    const { temporaryDirectory } = workspace(ownershipOf(), { storage: false });
    const db = fakeDatabase({});
    expect(await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_A, ...db })).toMatchObject({ outcome: 'REFUSED', code: 'OWNERSHIP_MARKER_ABSENT' });
    expect(recordIn(temporaryDirectory).state).toBe('ACTIVE');
  });

  it.each([
    ['another database target', { target: TARGET_B }, 'REFUSED', 'TARGET_MISMATCH'],
    ['the same name on other servers', { target: TARGET_A_ELSEWHERE }, 'REFUSED', 'TARGET_MISMATCH'],
    ['a marker of another record (different nonce)', { marker: (r) => ({ ...markerOf(r), nonce: '0'.repeat(32) }) }, 'REFUSED', 'OWNERSHIP_MARKER_MISMATCH'],
    ['the run\'s storage directory exists after all', { storage: true }, 'REFUSED', 'OWNERSHIP_RECORD_INCONSISTENT'],
    ['another directory of the run exists', { otherDirectory: true }, 'REFUSED', 'OWNERSHIP_RECORD_INCONSISTENT'],
    ['records with the run\'s Job id are found again', { records: true }, 'INCOMPLETE', 'RECORDS_REMAIN'],
  ])('a RELEASING record finishes only when everything agrees — %s -> %s (%s); nothing is deleted and the record stays RELEASING', async (_label, variant, outcome, code) => {
    const record = releasingRecord(ownershipOf(), { confirmed: { applicationsDeleted: 1, jobsDeleted: 1 } });
    const { temporaryDirectory } = workspace(record, { storage: Boolean(variant.storage) });
    if (variant.otherDirectory) fs.mkdirSync(path.join(temporaryDirectory, `${smokeStoragePrefix(RUN)}zzz999`));
    const db = fakeDatabase({
      markers: [variant.marker ? variant.marker(record) : markerOf(record)],
      ...(variant.records ? { applications: [syntheticApplication(oid('b9'))] } : {}),
    });
    const result = await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: variant.target ?? TARGET_A, ...db });
    expect(result).toMatchObject({ outcome, code });
    expect(deletions(db)).toBe(0);
    expect(db.state.markers).toHaveLength(1);
    expect(recordIn(temporaryDirectory).state).toBe('RELEASING');
  });

  it('a RELEASING record is a valid record; finishing it connects only to the recorded target', async () => {
    const record = releasingRecord(ownershipOf());
    expect(validateOwnershipRecord(record, RUN)).toEqual({ ok: true });
    const { temporaryDirectory } = workspace(record, { storage: false });
    const db = fakeDatabase({ markers: [markerOf(record)] });
    await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_B, ...db });
    expect(db.state.connects).toBe(0);
    expect(readOwnershipRecord(temporaryDirectory, RUN)).toMatchObject({ status: 'OK', record: { state: 'RELEASING' } });
  });

  it('end of a live run: the RELEASING record cannot be written -> the marker is NOT released and the run FAILS; the CLEANED record cannot be written after the release -> the run FAILS, and --cleanup-run finishes it later', async () => {
    const calls = [];
    const keptMarker = await finaliseSmokeRun({
      evidence: { checks: {} },
      runFailed: false,
      keepRecords: false,
      shutdown: null,
      cleanupRecords: async () => ({ complete: true, confirmed: { applicationsDeleted: 1, jobsDeleted: 1 }, remaining: {} }),
      removeStorage: () => {},
      recordReleasing: () => {
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      },
      releaseOwnership: async () => calls.push('release'),
      recordCleaned: () => calls.push('record'),
      storageName: STORAGE,
    });
    expect(keptMarker.failed).toBe(true);
    expect(keptMarker.failures).toEqual(['ownership record marked RELEASING (records and files confirmed removed)']);
    expect(calls).toEqual([]);

    // The real record file, a real failure on CLEANED, then the real reconciliation.
    const record = ownershipOf();
    const { temporaryDirectory } = workspace(record, { storage: false });
    const db = fakeDatabase({ markers: [markerOf(record)] });
    const evidence = { checks: {} };
    const failedReceipt = await finaliseSmokeRun({
      evidence,
      runFailed: false,
      keepRecords: false,
      shutdown: null,
      cleanupRecords: async () => ({ complete: true, confirmed: { applicationsDeleted: 1, jobsDeleted: 1 }, remaining: {} }),
      removeStorage: () => {},
      recordReleasing: () => writeOwnershipRecord(temporaryDirectory, releasingRecord(record, { confirmed: { applicationsDeleted: 1, jobsDeleted: 1 } })),
      releaseOwnership: async () => db.markers.deleteOne({ _id: RUN, nonce: record.database.nonce }).then((result) => ({ released: result.deletedCount === 1 })),
      recordCleaned: () => {
        throw Object.assign(new Error('injected'), { code: 'EIO' });
      },
      storageName: STORAGE,
    });
    expect(failedReceipt.failed).toBe(true);
    expect(failedReceipt.failures).toEqual(['ownership record marked CLEANED']);
    expect(db.state.markers).toEqual([]);
    expect(recordIn(temporaryDirectory).state).toBe('RELEASING');
    expect(await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET_A, ...db })).toMatchObject({ outcome: 'COMPLETE', resumed: true, release: { markerRelease: 'already released' } });
    expect(recordIn(temporaryDirectory).state).toBe('CLEANED');
  });

  it('releasing the marker without the RELEASING record is a programming error', async () => {
    await expect(
      finaliseSmokeRun({ evidence: { checks: {} }, runFailed: false, keepRecords: true, shutdown: null, cleanupRecords: async () => ({}), removeStorage: () => {}, releaseOwnership: async () => ({ released: true }), recordCleaned: () => {}, storageName: STORAGE }),
    ).rejects.toThrow(TypeError);
  });
});
