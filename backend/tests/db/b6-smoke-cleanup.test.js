import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Job } from '../../src/models/Job.js';
import { Application } from '../../src/models/Application.js';
import { REQUIRED_INDEXES, diffIndexes } from '../../src/db/indexes.js';
import { isResumeStorageKey } from '../../src/integrations/storage/storageContract.js';
import { KEY_HASH_PATTERN, syntheticApplication } from './fixtures/syntheticApplication.js';
import {
  cleanupSmokeRun,
  reconcileSmokeRun,
  createOwnershipRecord,
  writeOwnershipRecord,
  ownershipRecordName,
  releasingRecord,
  smokeDatabaseTarget,
  smokeJobSlug,
  smokeStoragePrefix,
  OWNERSHIP_COLLECTION,
  SMOKE_JOB_TITLE_PREFIX,
  SMOKE_CANDIDATE_NAME,
} from '../../scripts/smoke-lifecycle.mjs';
import { requireTestDatabase, assertConnectedToTestDatabase } from './testDatabase.js';

/**
 * B6 r5/r6 — the live smoke test's record cleanup against a REAL database.
 *
 * r6: nothing is deleted until the run's OWNERSHIP is proven — the ownership
 * record names this database target, and this database holds the run's
 * marker with the recorded nonce and Job id. The run's Applications are found
 * by the recorded Job id, so they are found even when the Job is gone and
 * even when the run never captured their ids (the interrupted path). Nothing
 * outside the run — another run, an unrelated job, a non-synthetic record
 * linked to the run — is touched.
 *
 * r9 (the first real-MongoDB run, Windows, MongoDB 8.0.9): the fixtures used
 * to insert minimal documents straight into the collections — an Application
 * as { _id, jobId, candidate: { fullName }, status } — WITHOUT the two
 * uniquely indexed fields, idempotency.keyHash and resume.storageKey. MongoDB
 * indexes a missing field as null, so the second such Application in a test
 * was refused (E11000 … dup key: null) before any cleanup ran; FerretDB, the
 * stand-in used until r8, treats missing values as distinct and let it pass.
 *
 * Now:
 *   - Jobs and Applications are created through the models' validated save —
 *     the only supported write path (src/models/writeGuards.js). Raw insertion
 *     is not needed for them: the exceptional states these cases need are
 *     RELATIONSHIPS — an Application whose parent Job was deleted or never
 *     created, an Application the run never captured, a non-synthetic record
 *     linked to the run's Job — and the validated save does not check that a
 *     parent Job exists, so every one is built from fully valid documents.
 *     Every Application comes from fixtures/syntheticApplication.js (the
 *     production builder): its idempotency.keyHash is the production hash of a
 *     fresh synthetic key, its resume.storageKey a fresh key from the
 *     production generator — distinct for EVERY Application created here,
 *     including the unrelated and non-synthetic ones (checked as they are
 *     created).
 *   - The raw collection is used only for the run's ownership MARKER, which has
 *     no model and is written that way by the smoke script itself.
 *   - Before any test, the suite applies the approved required indexes
 *     (additively — the same definitions as db:indexes:apply; nothing is ever
 *     dropped or relaxed) and then verifies them, so a standalone run on a
 *     database without them cannot pass by accident; a prerequisite test
 *     shows that this engine actually ENFORCES the two unique indexes.
 *   - Teardown removes only the records this suite created (by id) and its own
 *     temporary directories.
 */
const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const TARGET = smokeDatabaseTarget(TEST_URI);
const RUN = 'c0ffee01';
const OTHER_RUN = 'c0ffee02';
const inserted = { jobs: [], applications: [], markers: [] };
const noConnect = { connect: async () => {}, disconnect: async () => {} };
const markersCollection = () => mongoose.connection.collection(OWNERSHIP_COLLECTION);
const markers = { findOne: (filter) => markersCollection().findOne(filter), deleteOne: (filter) => markersCollection().deleteOne(filter) };
const temporaryDirectories = [];
/** The Jobs this suite created (snapshot source), and every unique key any of its Applications was given. */
const jobsCreated = new Map();
const issuedKeys = { keyHashes: new Set(), storageKeys: new Set() };
const UNIQUE_APPLICATION_INDEXES = REQUIRED_INDEXES.filter((index) => index.collection === 'applications' && index.options.unique);

/** The approved required indexes — present and compatible (unique, neither sparse nor partial) — or the suite fails. */
async function requireApprovedIndexes() {
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  for (const required of REQUIRED_INDEXES) {
    // Additive, as db:indexes:apply: creates a missing index; an existing compatible one is left as it is.
    await mongoose.connection.db.collection(required.collection).createIndex(required.key, { name: required.name, ...required.options });
  }
  const actual = {};
  for (const collection of new Set(REQUIRED_INDEXES.map((index) => index.collection))) {
    // A collection that does not exist has no indexes: reported below as missing, as db:indexes:check does.
    actual[collection] = await mongoose.connection.db.collection(collection).indexes().catch(() => []);
  }
  const { missing, incompatible } = diffIndexes(REQUIRED_INDEXES, actual);
  if (missing.length > 0 || incompatible.length > 0) {
    throw new Error(`required indexes not in place: missing [${missing.map((index) => index.name)}], incompatible [${incompatible.map((entry) => entry.requirement.name)}]`);
  }
}

beforeAll(async () => {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5_000 });
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  await requireApprovedIndexes();
}, 30_000);
afterEach(async () => {
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  await Application.collection.deleteMany({ _id: { $in: inserted.applications } });
  await Job.collection.deleteMany({ _id: { $in: inserted.jobs } });
  await markersCollection().deleteMany({ _id: { $in: inserted.markers } });
  inserted.jobs = [];
  inserted.applications = [];
  inserted.markers = [];
  jobsCreated.clear();
  while (temporaryDirectories.length) fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});
afterAll(async () => {
  await mongoose.disconnect();
});

/** A DRAFT Job through the validated save (a draft needs only a title and a slug — Doc 10 section 65). */
async function job({ runId = RUN, title, slug, _id = new mongoose.Types.ObjectId() } = {}) {
  inserted.jobs.push(_id);
  const created = await new Job({ _id, title: title ?? `${SMOKE_JOB_TITLE_PREFIX} ${runId}`, slug: slug ?? smokeJobSlug(runId) }).save();
  jobsCreated.set(String(_id), { _id, title: created.title, slug: created.slug });
  return _id;
}

/** The snapshot of `jobId`: the Job this suite created, or — for a Job that is missing — the run's own smoke Job. */
const snapshotOf = (jobId) => jobsCreated.get(String(jobId)) ?? { title: `${SMOKE_JOB_TITLE_PREFIX} ${RUN}`, slug: smokeJobSlug(RUN) };

/**
 * A complete Application (fixtures/syntheticApplication.js), saved through the validated save and linked to `jobId`
 * whether or not that Job exists. Its idempotency key hash and resume storage key are checked to be distinct from
 * every other one issued in this suite.
 */
async function application(jobId, fullName = SMOKE_CANDIDATE_NAME) {
  const _id = new mongoose.Types.ObjectId();
  const document = syntheticApplication({ _id, jobId, jobSnapshot: snapshotOf(jobId), fullName });
  const { keyHash } = document.idempotency;
  const { storageKey } = document.resume;
  if (issuedKeys.keyHashes.has(keyHash) || issuedKeys.storageKeys.has(storageKey)) throw new Error('fixture: a unique key was issued twice');
  issuedKeys.keyHashes.add(keyHash);
  issuedKeys.storageKeys.add(storageKey);
  inserted.applications.push(_id);
  await document.save();
  return _id;
}
/** A run's ownership: the record (in memory) and, unless `marker: false`, its marker in this database. */
async function ownership({ runId = RUN, jobId = new mongoose.Types.ObjectId(), captured = [], marker = true, target = TARGET, markerStorageDirectory } = {}) {
  const record = { ...createOwnershipRecord({ runId, target, storageDirectory: `${smokeStoragePrefix(runId)}qa0001`, jobId }), applicationIds: captured.map(String) };
  if (marker) {
    // The marker has no model: the smoke script writes it to its collection directly, and so does this fixture.
    await markersCollection().insertOne({ _id: runId, nonce: record.database.nonce, jobId: String(jobId), storageDirectory: markerStorageDirectory ?? record.storageDirectory, createdAt: new Date() });
    inserted.markers.push(runId);
  }
  return { record, jobId };
}
const exists = async (model, _id) => (await model.collection.countDocuments({ _id })) === 1;

describe('r9 — the prerequisites this suite depends on, on this engine', () => {
  it('the two unique Application indexes are present and ENFORCED: a second Application with the same idempotency key hash, or with the same resume storage key, is refused (E11000)', async () => {
    expect(UNIQUE_APPLICATION_INDEXES.map((index) => index.name).sort()).toEqual(['idempotency_keyHash_unique', 'resume_storageKey_unique']);
    const jobId = await job();
    const original = await Application.findById(await application(jobId)).lean();
    const duplicateOf = (field) => {
      const _id = new mongoose.Types.ObjectId();
      inserted.applications.push(_id); // removed by the teardown should the engine accept it
      const document = syntheticApplication({ _id, jobId, jobSnapshot: snapshotOf(jobId), fullName: SMOKE_CANDIDATE_NAME });
      // A valid Application in every respect but one: it repeats the first Application's value of `field`.
      document.set(field, field === 'idempotency.keyHash' ? original.idempotency.keyHash : original.resume.storageKey);
      return document.save();
    };
    for (const field of ['idempotency.keyHash', 'resume.storageKey']) {
      const refusal = await duplicateOf(field).then(() => null, (error) => error);
      expect(refusal, `a duplicate ${field} must be refused`).not.toBeNull();
      expect(refusal.code, field).toBe(11000);
    }
    expect(await Application.collection.countDocuments({ jobId })).toBe(1);
  });

  it('every Application this suite creates — the run\'s, another run\'s, unrelated and non-synthetic ones — carries its own correctly shaped idempotency key hash and resume storage key', async () => {
    const runJob = await job();
    const otherJob = await job({ runId: OTHER_RUN });
    const unrelatedJob = await job({ slug: 'qa-unrelated-real-looking-job', title: 'Unrelated job' });
    const ids = [
      await application(runJob),
      await application(runJob),
      await application(new mongoose.Types.ObjectId()), // a parent Job that does not exist
      await application(runJob, 'Not a smoke candidate'),
      await application(otherJob),
      await application(unrelatedJob, 'Unrelated person'),
    ];
    const stored = await Application.collection.find({ _id: { $in: ids } }, { projection: { 'idempotency.keyHash': 1, 'resume.storageKey': 1 } }).toArray();
    expect(stored).toHaveLength(ids.length);
    for (const { idempotency, resume } of stored) {
      expect(idempotency.keyHash).toMatch(KEY_HASH_PATTERN);
      expect(isResumeStorageKey(resume.storageKey)).toBe(true);
    }
    expect(new Set(stored.map((entry) => entry.idempotency.keyHash)).size).toBe(ids.length);
    expect(new Set(stored.map((entry) => entry.resume.storageKey)).size).toBe(ids.length);
  });
});

describe('smoke-run cleanup on a REAL database — ownership proven first (r6)', () => {
  it('E + interrupted path: the run\'s Job and Applications — including one the run never captured — are removed and confirmed; nothing else is touched', async () => {
    const { record, jobId } = await ownership();
    await job({ _id: jobId });
    const captured = await application(jobId);
    const notCaptured = await application(jobId);
    record.applicationIds = [String(captured)];
    const otherRunJob = await job({ runId: OTHER_RUN });
    const otherRunApplication = await application(otherRunJob);
    const unrelatedJob = await job({ slug: 'qa-unrelated-real-looking-job', title: 'Unrelated job' });
    const unrelatedApplication = await application(unrelatedJob, 'Unrelated person');

    const result = await cleanupSmokeRun({ record, target: TARGET, Job, Application, markers, ...noConnect });

    expect(result).toEqual({
      complete: true,
      ownership: 'VERIFIED',
      discovered: { job: 'present', applications: 2, applicationsNotCapturedByTheRun: 1, applicationsWithMissingParentJob: 0, notOwned: { jobs: 0, applications: 0 } },
      confirmed: { applicationsDeleted: 2, jobsDeleted: 1 },
      remaining: { applications: 0, capturedApplications: 0, jobs: 0, jobsWithSlug: 0 },
    });
    expect(await exists(Application, captured)).toBe(false);
    expect(await exists(Application, notCaptured)).toBe(false);
    expect(await exists(Job, jobId)).toBe(false);
    for (const [model, id] of [[Job, otherRunJob], [Application, otherRunApplication], [Job, unrelatedJob], [Application, unrelatedApplication]]) {
      expect(await exists(model, id)).toBe(true);
    }
  });

  it('C: the parent Job is MISSING but its Applications survive — found by the recorded Job id and removed (r5 reported "complete" without looking)', async () => {
    const { record, jobId } = await ownership();
    const survivor = await application(jobId);
    const uncaptured = await application(jobId);
    record.applicationIds = [String(survivor)];

    const result = await cleanupSmokeRun({ record, target: TARGET, Job, Application, markers, ...noConnect });

    expect(result.discovered).toMatchObject({ job: 'missing', applications: 2, applicationsWithMissingParentJob: 2, applicationsNotCapturedByTheRun: 1 });
    expect(result).toMatchObject({ complete: true, confirmed: { applicationsDeleted: 2, jobsDeleted: 0 } });
    expect(await exists(Application, survivor)).toBe(false);
    expect(await exists(Application, uncaptured)).toBe(false);
  });

  it('C: Job missing and a NON-synthetic Application references it — not removed; the result is incomplete', async () => {
    const { record, jobId } = await ownership();
    const synthetic = await application(jobId);
    const foreign = await application(jobId, 'Not a smoke candidate');

    const result = await cleanupSmokeRun({ record, target: TARGET, Job, Application, markers, ...noConnect });

    expect(result.complete).toBe(false);
    expect(result.discovered.notOwned).toEqual({ jobs: 0, applications: 1 });
    expect(await exists(Application, synthetic)).toBe(false);
    expect(await exists(Application, foreign)).toBe(true);
  });

  it('B: the same database name and servers, but this database holds no marker of the run — REFUSED; the run\'s records are not touched', async () => {
    const { record, jobId } = await ownership({ marker: false });
    await job({ _id: jobId });
    const kept = await application(jobId);

    const result = await cleanupSmokeRun({ record, target: TARGET, Job, Application, markers, ...noConnect });

    expect(result).toMatchObject({ complete: false, refused: { code: 'OWNERSHIP_MARKER_ABSENT' } });
    expect(await exists(Application, kept)).toBe(true);
    expect(await exists(Job, jobId)).toBe(true);
  });

  it('D: the marker in this database names another storage directory than the record — REFUSED; nothing touched', async () => {
    const { record, jobId } = await ownership({ markerStorageDirectory: `${smokeStoragePrefix(RUN)}zzz999` });
    await job({ _id: jobId });
    const kept = await application(jobId);

    const result = await cleanupSmokeRun({ record, target: TARGET, Job, Application, markers, ...noConnect });

    expect(result).toMatchObject({ complete: false, refused: { code: 'OWNERSHIP_MARKER_MISMATCH' } });
    expect(await exists(Application, kept)).toBe(true);
    expect(await exists(Job, jobId)).toBe(true);
    expect(await markersCollection().countDocuments({ _id: RUN })).toBe(1);
  });

  it('A: a record of another permitted test database — REFUSED before anything is read', async () => {
    const { record, jobId } = await ownership({ target: { name: `${TEST_DATABASE}_elsewhere`, hosts: TARGET.hosts } });
    await job({ _id: jobId });
    const kept = await application(jobId);

    const result = await cleanupSmokeRun({ record, target: TARGET, Job, Application, markers, ...noConnect });

    expect(result).toMatchObject({ complete: false, refused: { code: 'TARGET_MISMATCH' } });
    expect(await exists(Application, kept)).toBe(true);
  });

  it('r7: the CLEANED receipt cannot be written after the marker was released — INCOMPLETE (RECEIPT_NOT_WRITTEN) with the record RELEASING; a retry on this database finishes (marker already gone) and a further one is ALREADY_CLEANED', async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'valida-r7-db-'));
    temporaryDirectories.push(temporaryDirectory);
    const { record, jobId } = await ownership();
    await job({ _id: jobId });
    await application(jobId);
    const storage = path.join(temporaryDirectory, record.storageDirectory);
    fs.mkdirSync(storage);
    fs.writeFileSync(path.join(storage, 'resume-object'), 'synthetic resume');
    writeOwnershipRecord(temporaryDirectory, record);
    const recordFile = path.join(temporaryDirectory, ownershipRecordName(RUN));
    let failOnce = true;
    const failingCleanedInstall = new Proxy(fs, {
      get: (target, property) =>
        property !== 'renameSync'
          ? target[property]
          : (from, to) => {
              if (failOnce && to === recordFile && JSON.parse(target.readFileSync(from, 'utf8')).state === 'CLEANED') {
                failOnce = false;
                throw Object.assign(new Error('injected'), { code: 'EIO' });
              }
              return target.renameSync(from, to);
            },
    });

    const first = await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET, Job, Application, markers, ...noConnect, fileSystem: failingCleanedInstall });
    expect(first).toMatchObject({ outcome: 'INCOMPLETE', code: 'RECEIPT_NOT_WRITTEN' });
    expect(await markersCollection().countDocuments({ _id: RUN })).toBe(0);
    expect(await Application.collection.countDocuments({ jobId })).toBe(0);
    expect(fs.existsSync(storage)).toBe(false);
    expect(JSON.parse(fs.readFileSync(recordFile, 'utf8')).state).toBe('RELEASING');

    const retry = await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET, Job, Application, markers, ...noConnect });
    expect(retry).toMatchObject({ outcome: 'COMPLETE', resumed: true, release: { markerRelease: 'already released', remaining: { applications: 0, jobs: 0 } } });
    expect(JSON.parse(fs.readFileSync(recordFile, 'utf8'))).toMatchObject({ state: 'CLEANED', markerRelease: 'already released' });
    expect((await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET, Job, Application, markers, ...noConnect })).outcome).toBe('ALREADY_CLEANED');
  });

  it('r7: a RELEASING record finishes on this database only while nothing of the run is found — a re-inserted Application of its Job keeps it INCOMPLETE and the marker in place', async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'valida-r7-db-'));
    temporaryDirectories.push(temporaryDirectory);
    const { record, jobId } = await ownership();
    const releasing = releasingRecord(record, { confirmed: { applicationsDeleted: 1, jobsDeleted: 1 } });
    writeOwnershipRecord(temporaryDirectory, releasing);
    const survivor = await application(jobId);

    const result = await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET, Job, Application, markers, ...noConnect });
    expect(result).toMatchObject({ outcome: 'INCOMPLETE', code: 'RECORDS_REMAIN', resumed: true });
    expect(await markersCollection().countDocuments({ _id: RUN })).toBe(1);
    expect(await exists(Application, survivor)).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(temporaryDirectory, ownershipRecordName(RUN)), 'utf8')).state).toBe('RELEASING');
  });

  it('E: --cleanup-run end to end on this database — COMPLETE (records, files, marker, record CLEANED); a repeat is ALREADY_CLEANED and changes nothing', async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'valida-r6-db-'));
    temporaryDirectories.push(temporaryDirectory);
    const { record, jobId } = await ownership();
    await job({ _id: jobId });
    await application(jobId);
    const storage = path.join(temporaryDirectory, record.storageDirectory);
    fs.mkdirSync(storage);
    fs.writeFileSync(path.join(storage, 'resume-object'), 'synthetic resume');
    writeOwnershipRecord(temporaryDirectory, record);

    const first = await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET, Job, Application, markers, ...noConnect });
    expect(first).toMatchObject({ outcome: 'COMPLETE', files: { removed: true } });
    expect(fs.existsSync(storage)).toBe(false);
    expect(await markersCollection().countDocuments({ _id: RUN })).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(temporaryDirectory, ownershipRecordName(RUN)), 'utf8')).state).toBe('CLEANED');

    const second = await reconcileSmokeRun({ runId: RUN, temporaryDirectory, target: TARGET, Job, Application, markers, ...noConnect });
    expect(second.outcome).toBe('ALREADY_CLEANED');
  });
});
