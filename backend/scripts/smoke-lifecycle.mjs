import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { ERROR_CODE_CLASSES, FAILURE_CLASSES } from '../src/integrations/notifications/notificationService.js';
import { parseMongoUri } from '../src/db/connectionString.js';

/**
 * B6 r5 — the live smoke test's LIFECYCLE (scripts/notifications-smoke.mjs).
 *
 * Corrects four defects that GPT's source review found in r4 (reproduced on
 * unchanged r4 before the fix; see the B6 r5 review):
 *   1. the final result could say PASS (exit 0) although the server's
 *      shutdown was not clean or the database cleanup failed, a thrown
 *      shutdown error skipped every later step and the evidence file, and the
 *      cleanup reported the INTENDED deletions as done;
 *   2. --keep-records kept the Applications but deleted their resume files,
 *      a failed cleanup deleted the files of records it had not removed, and
 *      an Application whose id was not yet captured was never removed;
 *   3. every bounce-test outcome other than SENT was reported as "the relay
 *      refused it … no bounce message is expected" — false for an unknown
 *      outcome, a timeout, an authentication failure or a failure before
 *      anything was submitted.
 *
 * r6 (GPT's review of r5): the cleanup treated "no Job with the run's slug in
 * this database" as proof that the run's records were gone, and then removed
 * the run's resume files — against ANOTHER permitted test database, or when
 * the run's Job had been deleted while its Applications survived. A run now
 * proves OWNERSHIP before anything destructive:
 *   - an OWNERSHIP RECORD, a credential-free file in the OS temporary
 *     directory (valida-smoke-run-<run id>.json), written before the run
 *     touches the database: the run id, its exact database target (name AND
 *     server list — never credentials), a random nonce, the Job id chosen
 *     BEFORE the Job is created, the Application ids it captured, and the
 *     name of its storage directory;
 *   - an OWNERSHIP MARKER in that database (collection valida_smoke_runs,
 *     test databases only: { _id: run id, nonce, jobId, storageDirectory }),
 *     written before the run creates any record.
 * Cleanup proceeds only when the record is valid, the configured target is
 * the recorded one, AND the database holds the marker with the same nonce,
 * Job id and storage directory — a database of the same name on another
 * server holds no such marker. Applications are found by the recorded Job id, whether or not the
 * Job still exists. Anything missing, inconsistent or unverifiable is
 * REFUSED: no record is deleted and every file is kept. Runs made before r6
 * have no ownership record; they are refused, never guessed.
 *
 * r7 (GPT's review of r6): when the CLEANED receipt could not be written AFTER
 * the marker had been released, every later --cleanup-run was refused
 * (OWNERSHIP_MARKER_ABSENT) for good. The release is now two-phase: once the
 * records are confirmed removed and the storage directory is gone, the record
 * is first marked RELEASING (durable evidence), and only then is the marker
 * released and the record marked CLEANED. A RELEASING record lets a later
 * --cleanup-run finish — it deletes nothing but the run's own marker, re-counts
 * the run's records read-only, and refuses on any disagreement. An ACTIVE
 * record without a marker is still refused: an absent marker alone never
 * proves a cleanup.
 *
 * Everything here takes its dependencies as arguments, so each failure path
 * is tested by fault injection (tests/b6-smoke-lifecycle.test.js) and the
 * record discovery against a real database (tests/db/b6-smoke-cleanup.test.js).
 */

/** The run id of one live smoke run: 8 lower-case hex characters. */
export const SMOKE_RUN_ID = /^[0-9a-f]{8}$/;
/** Every synthetic job of a run carries this title prefix and the slug below. */
export const SMOKE_JOB_TITLE_PREFIX = 'QA SMOKE TEST ROLE - NOT A REAL VACANCY';
/** Every synthetic Application of a run carries exactly this candidate name (candidate.fullName). */
export const SMOKE_CANDIDATE_NAME = 'QA Smoke Candidate (synthetic)';
export const smokeJobSlug = (runId) => `qa-smoke-${runId}`;
/** The run's private resume storage is one fresh directory in the OS temporary directory with this prefix. */
export const smokeStoragePrefix = (runId) => `valida-smoke-storage-${runId}-`;

function assertRunId(runId) {
  if (typeof runId !== 'string' || !SMOKE_RUN_ID.test(runId)) throw new TypeError('a smoke run id is 8 lower-case hex characters');
}

/** Where a run's ownership marker lives — in the dedicated TEST database only. */
export const OWNERSHIP_COLLECTION = 'valida_smoke_runs';
export const OWNERSHIP_KIND = 'valida-b6-smoke-run';
export const OWNERSHIP_VERSION = 1;
/** The ownership record of a run: one file in the OS temporary directory. */
export const ownershipRecordName = (runId) => `valida-smoke-run-${runId}.json`;
const OBJECT_ID = /^[0-9a-f]{24}$/;
const NONCE = /^[0-9a-f]{32}$/;
/** ACTIVE → (records and files confirmed removed) RELEASING → (marker released) CLEANED. RELEASING is r7. */
const RECORD_STATES = new Set(['ACTIVE', 'RELEASING', 'CLEANED']);

/**
 * The database a connection string targets, WITHOUT credentials: the database
 * name and the server list as the MongoDB driver parses it (host:port, sorted;
 * or the SRV name). null when the string cannot be parsed or names no database.
 */
export function smokeDatabaseTarget(uri) {
  const parsed = parseMongoUri(uri);
  if (!parsed.valid || !parsed.databaseName) return null;
  let options;
  try {
    options = new mongoose.mongo.MongoClient(uri).options;
  } catch {
    return null;
  }
  const hosts = options.srvHost ? [`srv:${String(options.srvHost).toLowerCase()}`] : options.hosts.map((host) => String(host).toLowerCase()).sort();
  return { name: parsed.databaseName, hosts };
}

/** Same database name AND the same servers. A name match alone never establishes ownership. */
export function sameDatabaseTarget(a, b) {
  return (
    Boolean(a && b) &&
    typeof a.name === 'string' &&
    a.name === b.name &&
    Array.isArray(a.hosts) &&
    Array.isArray(b.hosts) &&
    a.hosts.length > 0 &&
    a.hosts.length === b.hosts.length &&
    a.hosts.every((host, index) => host === b.hosts[index])
  );
}

/** For evidence: a short fingerprint of a target instead of its server names. */
export const targetFingerprint = (target) => crypto.createHash('sha256').update(JSON.stringify({ name: target.name, hosts: target.hosts })).digest('hex').slice(0, 16);

/** A new run's ownership record (state ACTIVE). The Job id is chosen here, before the Job exists. */
export function createOwnershipRecord({ runId, target, storageDirectory, jobId, nonce = crypto.randomBytes(16).toString('hex'), now = new Date() }) {
  assertRunId(runId);
  return {
    kind: OWNERSHIP_KIND,
    version: OWNERSHIP_VERSION,
    runId,
    createdAt: now.toISOString(),
    database: { name: target.name, hosts: [...target.hosts], nonce },
    jobId: String(jobId),
    applicationIds: [],
    storageDirectory,
    state: 'ACTIVE',
  };
}

/** Whether `record` is a well-formed ownership record of `runId` (never guessed: any doubt is a refusal). */
export function validateOwnershipRecord(record, runId) {
  const no = (reason) => ({ ok: false, reason });
  if (!record || typeof record !== 'object' || Array.isArray(record)) return no('not an ownership record');
  if (record.kind !== OWNERSHIP_KIND || record.version !== OWNERSHIP_VERSION) return no('unknown record kind or version');
  if (typeof runId !== 'string' || !SMOKE_RUN_ID.test(runId) || record.runId !== runId) return no('the record names another run');
  const database = record.database;
  if (!database || typeof database.name !== 'string' || database.name.length === 0) return no('no database name');
  if (!Array.isArray(database.hosts) || database.hosts.length === 0 || !database.hosts.every((host) => typeof host === 'string' && host.length > 0)) return no('no database servers');
  if (typeof database.nonce !== 'string' || !NONCE.test(database.nonce)) return no('no valid ownership nonce');
  if (typeof record.jobId !== 'string' || !OBJECT_ID.test(record.jobId)) return no('no valid Job id');
  if (!Array.isArray(record.applicationIds) || !record.applicationIds.every((id) => typeof id === 'string' && OBJECT_ID.test(id))) return no('invalid Application ids');
  const directory = record.storageDirectory;
  if (typeof directory !== 'string' || directory !== path.basename(directory) || /[\\/]/.test(directory) || !directory.startsWith(smokeStoragePrefix(runId)) || directory.length <= smokeStoragePrefix(runId).length) {
    return no('the storage directory is not one of this run');
  }
  if (!RECORD_STATES.has(record.state)) return no('unknown record state');
  return { ok: true };
}

/**
 * Writes the record atomically (a temporary file, then a rename), readable by
 * this user only. On failure the previous record stays exactly as it was and
 * the temporary file is removed (best effort).
 */
export function writeOwnershipRecord(temporaryDirectory, record, fileSystem = fs) {
  const file = path.join(temporaryDirectory, ownershipRecordName(record.runId));
  const partial = `${file}.${crypto.randomBytes(4).toString('hex')}.partial`;
  try {
    fileSystem.writeFileSync(partial, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    fileSystem.renameSync(partial, file);
  } catch (error) {
    try {
      fileSystem.rmSync(partial, { force: true });
    } catch {
      // The write already failed; the previous record is untouched.
    }
    throw error;
  }
  return file;
}

/** @returns {{ status: 'MISSING' } | { status: 'INVALID', reason: string } | { status: 'OK', record: object }} */
export function readOwnershipRecord(temporaryDirectory, runId, fileSystem = fs) {
  assertRunId(runId);
  const file = path.join(temporaryDirectory, ownershipRecordName(runId));
  let text;
  try {
    text = fileSystem.readFileSync(file, 'utf8');
  } catch (error) {
    return error?.code === 'ENOENT' ? { status: 'MISSING' } : { status: 'INVALID', reason: 'the record could not be read' };
  }
  let record;
  try {
    record = JSON.parse(text);
  } catch {
    return { status: 'INVALID', reason: 'the record is not valid JSON' };
  }
  const valid = validateOwnershipRecord(record, runId);
  return valid.ok ? { status: 'OK', record } : { status: 'INVALID', reason: valid.reason };
}

const refusal = (code, reason) => ({ complete: false, refused: { code, reason }, confirmed: { applicationsDeleted: 0, jobsDeleted: 0 } });

/**
 * Finds and removes ONLY one run's synthetic records — after proving the
 * run's ownership — then confirms what is left.
 *
 * REFUSED (nothing read, nothing deleted) when the ownership record is
 * invalid, when the configured database is not the recorded target (name
 * AND servers), or when this database does not hold the run's ownership
 * marker with the recorded nonce, Job id and storage directory.
 *
 * Otherwise, positively identified by the RECORDED Job id (not by a lookup
 * that may find nothing):
 *   - Applications with that Job id AND the synthetic candidate name — found
 *     whether or not the Job still exists, and whether or not the run had
 *     captured their ids (the interrupted path);
 *   - the Job with that id, only with the run's slug and the synthetic title,
 *     and only when no other Application references it.
 * Anything linked to the run that is not positively the run's — a
 * non-synthetic Application, another Job with the run's slug, a captured id
 * that now points elsewhere — is reported and left alone; the result is then
 * incomplete.
 *
 * @returns {Promise<object>} `complete` only when, re-counted after the
 *   deletions, nothing of the run remains; `confirmed` holds the database's
 *   own deletion counts.
 */
export async function cleanupSmokeRun({ record, target, Job, Application, markers, connect, disconnect }) {
  const valid = validateOwnershipRecord(record, record?.runId);
  if (!valid.ok) return refusal('OWNERSHIP_RECORD_INVALID', valid.reason);
  if (!sameDatabaseTarget(record.database, target)) {
    return refusal('TARGET_MISMATCH', 'the configured test database is not the one this run used (database name or servers differ)');
  }
  const { runId, jobId } = record;
  const slug = smokeJobSlug(runId);
  await connect();
  try {
    const marker = await markers.findOne({ _id: runId });
    if (!marker) return refusal('OWNERSHIP_MARKER_ABSENT', 'this database holds no ownership marker of the run: it is not the run\'s database, or the run was already cleaned');
    if (marker.nonce !== record.database.nonce || String(marker.jobId) !== jobId || marker.storageDirectory !== record.storageDirectory) {
      return refusal('OWNERSHIP_MARKER_MISMATCH', 'the ownership marker in this database does not match the run record (nonce, Job id or storage directory)');
    }

    const recordedJob = (await Job.find({ _id: jobId }, { _id: 1, title: 1, slug: 1 }).lean())[0] ?? null;
    const jobIsTheRuns = Boolean(recordedJob) && recordedJob.slug === slug && typeof recordedJob.title === 'string' && recordedJob.title.startsWith(SMOKE_JOB_TITLE_PREFIX);
    const otherJobsWithSlug = (await Job.find({ slug }, { _id: 1 }).lean()).filter((job) => String(job._id) !== jobId).length;
    const linked = await Application.find({ jobId }, { _id: 1, 'candidate.fullName': 1 }).lean();
    const synthetic = linked.filter((application) => application.candidate?.fullName === SMOKE_CANDIDATE_NAME);
    const captured = record.applicationIds;
    const capturedElsewhere = captured.length > 0 ? (await Application.find({ _id: { $in: captured } }, { _id: 1, jobId: 1 }).lean()).filter((application) => String(application.jobId) !== jobId).length : 0;
    const notOwned = {
      jobs: otherJobsWithSlug + (recordedJob && !jobIsTheRuns ? 1 : 0),
      applications: linked.length - synthetic.length + capturedElsewhere,
    };

    const applicationsDeleted = synthetic.length > 0 ? ((await Application.deleteMany({ _id: { $in: synthetic.map((application) => application._id) }, jobId }))?.deletedCount ?? 0) : 0;
    const jobsDeleted = jobIsTheRuns && linked.length === synthetic.length ? ((await Job.deleteMany({ _id: jobId, slug }))?.deletedCount ?? 0) : 0;

    const remaining = {
      applications: await Application.countDocuments({ jobId }),
      capturedApplications: captured.length > 0 ? await Application.countDocuments({ _id: { $in: captured } }) : 0,
      jobs: await Job.countDocuments({ _id: jobId }),
      jobsWithSlug: await Job.countDocuments({ slug }),
    };
    const capturedSet = new Set(captured);
    return {
      complete: Object.values(remaining).every((count) => count === 0) && notOwned.jobs === 0 && notOwned.applications === 0,
      ownership: 'VERIFIED',
      discovered: {
        job: recordedJob ? (jobIsTheRuns ? 'present' : 'present, not the run\'s') : 'missing',
        applications: synthetic.length,
        // Found by the recorded Job id although the run never captured their ids (the interrupted path).
        applicationsNotCapturedByTheRun: synthetic.filter((application) => !capturedSet.has(String(application._id))).length,
        // Found although their parent Job no longer exists.
        applicationsWithMissingParentJob: recordedJob ? 0 : synthetic.length,
        notOwned,
      },
      confirmed: { applicationsDeleted, jobsDeleted },
      remaining,
    };
  } finally {
    try {
      await disconnect();
    } catch {
      // The counts above were already confirmed; a failing disconnect changes none of them.
    }
  }
}

/** Releases the run's ownership marker (last step, after its files are gone). Confirmed by the deletion count. */
export async function releaseSmokeOwnership({ record, markers, connect, disconnect }) {
  await connect();
  try {
    const result = await markers.deleteOne({ _id: record.runId, nonce: record.database.nonce });
    return { released: result?.deletedCount === 1 };
  } finally {
    try {
      await disconnect();
    } catch {
      // The deletion count above stands.
    }
  }
}

/**
 * r7 — the RELEASING record: written ONLY after the run's records were
 * confirmed removed (on the verified database, with its marker present) AND
 * its storage directory was removed — and BEFORE the marker is released. It is
 * the durable evidence that lets an interrupted release be finished later: a
 * RELEASING record, and only a RELEASING record, explains a marker that is
 * already gone. An ACTIVE record with no marker is still refused.
 */
export function releasingRecord(record, { now = new Date(), confirmed } = {}) {
  return { ...record, state: 'RELEASING', recordsRemovedAt: now.toISOString(), ...(confirmed ? { confirmed } : {}) };
}

/** The CLEANED record: kept as a credential-free receipt, so a repeated cleanup can report it truthfully. */
export function cleanedRecord(record, { now = new Date(), confirmed, markerRelease } = {}) {
  return { ...record, state: 'CLEANED', cleanedAt: now.toISOString(), ...(confirmed ? { confirmed } : {}), ...(markerRelease ? { markerRelease } : {}) };
}

/**
 * r7 — finishes the release of a run whose record says RELEASING. Deletes
 * NOTHING except the run's own marker (matched by run id AND nonce).
 *   refused     the configured database is not the recorded target, or this
 *               database holds a DIFFERENT marker for the run id;
 *   incomplete  a record of the run is found again (read-only re-count by the
 *               recorded Job id), or the marker could not be deleted — then
 *               nothing else is changed;
 *   complete    the marker was released now, or was already gone (the record
 *               is RELEASING, so the release had begun after the records and
 *               files were confirmed removed).
 */
export async function completeSmokeRelease({ record, target, Job, Application, markers, connect, disconnect }) {
  if (!sameDatabaseTarget(record.database, target)) {
    return { complete: false, refused: { code: 'TARGET_MISMATCH', reason: 'the configured test database is not the one this run used (database name or servers differ)' } };
  }
  const { runId, jobId } = record;
  await connect();
  try {
    const marker = await markers.findOne({ _id: runId });
    if (marker && (marker.nonce !== record.database.nonce || String(marker.jobId) !== jobId || marker.storageDirectory !== record.storageDirectory)) {
      return { complete: false, refused: { code: 'OWNERSHIP_MARKER_MISMATCH', reason: 'the ownership marker in this database does not match the run record (nonce, Job id or storage directory)' } };
    }
    const remaining = { applications: await Application.countDocuments({ jobId }), jobs: await Job.countDocuments({ _id: jobId }) };
    if (remaining.applications > 0 || remaining.jobs > 0) return { complete: false, remaining, markerRelease: marker ? 'kept' : 'already released' };
    if (!marker) return { complete: true, remaining, markerRelease: 'already released' };
    const result = await markers.deleteOne({ _id: runId, nonce: record.database.nonce });
    if (result?.deletedCount !== 1) return { complete: false, remaining, markerRelease: 'not released' };
    return { complete: true, remaining, markerRelease: 'released' };
  } finally {
    try {
      await disconnect();
    } catch {
      // The counts above stand.
    }
  }
}

/** Removes a directory and CONFIRMS it is gone (throws otherwise). */
export function removeDirectoryConfirmed(directory, fileSystem = fs) {
  fileSystem.rmSync(directory, { recursive: true, force: true });
  if (fileSystem.existsSync(directory)) throw Object.assign(new Error('the directory still exists after removal'), { code: 'NOT_REMOVED' });
}

/** The run's storage directories in `temporaryDirectory` (only names with this run's prefix; only directories). */
export function findSmokeStorageDirectories(runId, temporaryDirectory, fileSystem = fs) {
  assertRunId(runId);
  const prefix = smokeStoragePrefix(runId);
  return fileSystem
    .readdirSync(temporaryDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => path.join(temporaryDirectory, entry.name));
}

/**
 * --cleanup-run <run id>: reconciles ONE earlier run, proving ownership first.
 *   REFUSED      no ownership record (every run made before r6), an invalid
 *                record, another database target, no or a different
 *                ownership marker in this database, a record that says
 *                CLEANED while the run's storage directory still exists, or
 *                one whose storage directory is missing while another
 *                directory of the run exists: nothing is deleted, every file
 *                is kept;
 *   FAILED       the database could not be used: nothing more is attempted;
 *   INCOMPLETE   records of the run remain, or a later step failed: the files
 *                are kept while any record may reference them; every code is
 *                recoverable by running the command again once its cause is
 *                gone (RECORD_NOT_UPDATED: the marker was kept; MARKER_NOT_
 *                RELEASED and RECEIPT_NOT_WRITTEN: the record says RELEASING);
 *   COMPLETE     records removed and confirmed, then EXACTLY the recorded
 *                storage directory removed, then — r7 — the record marked
 *                RELEASING (durable evidence), then the marker released, then
 *                the record marked CLEANED; or (`resumed`) an interrupted
 *                release finished from a RELEASING record;
 *   ALREADY_CLEANED  the record says CLEANED and no storage directory remains:
 *                nothing to do (a repeated cleanup is harmless).
 * Other directories with the run's prefix are never touched (`untouched`).
 */
export async function reconcileSmokeRun({ runId, temporaryDirectory, target, Job, Application, markers, connect, disconnect, fileSystem = fs, now = () => new Date() }) {
  assertRunId(runId);
  const prefixed = findSmokeStorageDirectories(runId, temporaryDirectory, fileSystem).map((directory) => path.basename(directory));
  const read = readOwnershipRecord(temporaryDirectory, runId, fileSystem);
  if (read.status === 'MISSING') {
    return { outcome: 'REFUSED', code: 'OWNERSHIP_RECORD_MISSING', reason: 'no ownership record for this run (runs made before r6 have none; ownership is never guessed)', untouched: prefixed };
  }
  if (read.status === 'INVALID') return { outcome: 'REFUSED', code: 'OWNERSHIP_RECORD_INVALID', reason: read.reason, untouched: prefixed };
  const { record } = read;
  const owned = prefixed.includes(record.storageDirectory);
  const others = prefixed.filter((name) => name !== record.storageDirectory);
  if (record.state === 'CLEANED') {
    if (owned) return { outcome: 'REFUSED', code: 'OWNERSHIP_RECORD_INCONSISTENT', reason: 'the record says CLEANED but the run\'s storage directory exists', untouched: prefixed };
    return { outcome: 'ALREADY_CLEANED', cleanedAt: record.cleanedAt ?? null, untouched: others };
  }
  if (record.state === 'RELEASING') {
    // The records and files were confirmed removed before this state was written; only the marker
    // release and the receipt may be missing. Nothing but the marker is ever deleted from here.
    if (owned || others.length > 0) {
      return { outcome: 'REFUSED', code: 'OWNERSHIP_RECORD_INCONSISTENT', reason: 'the record says the run\'s records and files were removed, but a storage directory of this run exists', untouched: prefixed };
    }
    let release;
    try {
      release = await completeSmokeRelease({ record, target, Job, Application, markers, connect, disconnect });
    } catch (error) {
      return { outcome: 'FAILED', code: 'CLEANUP_FAILED', resumed: true, error, untouched: prefixed };
    }
    if (release.refused) return { outcome: 'REFUSED', code: release.refused.code, reason: release.refused.reason, resumed: true, untouched: prefixed };
    if (!release.complete) {
      const recordsFound = release.remaining.applications > 0 || release.remaining.jobs > 0;
      return { outcome: 'INCOMPLETE', code: recordsFound ? 'RECORDS_REMAIN' : 'MARKER_NOT_RELEASED', resumed: true, release, untouched: others };
    }
    try {
      writeOwnershipRecord(temporaryDirectory, cleanedRecord(record, { now: now(), confirmed: record.confirmed, markerRelease: release.markerRelease }), fileSystem);
    } catch (error) {
      return { outcome: 'INCOMPLETE', code: 'RECEIPT_NOT_WRITTEN', resumed: true, release, error, untouched: others };
    }
    return { outcome: 'COMPLETE', resumed: true, release, recordsRemovedAt: record.recordsRemovedAt ?? null, untouched: others };
  }
  // An ACTIVE record whose storage directory is gone is normal only after an earlier cleanup removed it
  // (and could not finish); while ANOTHER directory of this run exists, the record cannot be trusted.
  if (!owned && others.length > 0) {
    return { outcome: 'REFUSED', code: 'OWNERSHIP_RECORD_INCONSISTENT', reason: 'the record names a storage directory that does not exist, while another directory of this run does', untouched: prefixed };
  }
  let cleanup;
  try {
    cleanup = await cleanupSmokeRun({ record, target, Job, Application, markers, connect, disconnect });
  } catch (error) {
    return { outcome: 'FAILED', code: 'CLEANUP_FAILED', error, untouched: prefixed };
  }
  if (cleanup.refused) return { outcome: 'REFUSED', code: cleanup.refused.code, reason: cleanup.refused.reason, cleanup, untouched: prefixed };
  if (!cleanup.complete) return { outcome: 'INCOMPLETE', code: 'RECORDS_REMAIN', cleanup, untouched: prefixed };
  const files = { directory: record.storageDirectory, existed: owned, removed: false };
  try {
    removeDirectoryConfirmed(path.join(temporaryDirectory, record.storageDirectory), fileSystem);
    files.removed = true;
  } catch (error) {
    return { outcome: 'INCOMPLETE', code: 'FILES_NOT_REMOVED', cleanup, files, error, untouched: prefixed };
  }
  // r7: the durable evidence FIRST. If it cannot be written, the marker is kept and a repeat starts over.
  const releasing = releasingRecord(record, { now: now(), confirmed: cleanup.confirmed });
  try {
    writeOwnershipRecord(temporaryDirectory, releasing, fileSystem);
  } catch (error) {
    return { outcome: 'INCOMPLETE', code: 'RECORD_NOT_UPDATED', cleanup, files, error, untouched: others };
  }
  let release;
  try {
    release = await releaseSmokeOwnership({ record, markers, connect, disconnect });
  } catch (error) {
    return { outcome: 'INCOMPLETE', code: 'MARKER_NOT_RELEASED', cleanup, files, error, untouched: others };
  }
  if (!release.released) return { outcome: 'INCOMPLETE', code: 'MARKER_NOT_RELEASED', cleanup, files, untouched: others };
  try {
    writeOwnershipRecord(temporaryDirectory, cleanedRecord(releasing, { now: now(), confirmed: cleanup.confirmed, markerRelease: 'released' }), fileSystem);
  } catch (error) {
    return { outcome: 'INCOMPLETE', code: 'RECEIPT_NOT_WRITTEN', cleanup, files, error, untouched: others };
  }
  return { outcome: 'COMPLETE', cleanup, files, untouched: others };
}

/**
 * The end of a live run. Every step runs, each isolated from the others'
 * failures, and the outcome records only what was CONFIRMED:
 *   1. shutdown — required when a server was started; `clean: false` or a
 *      thrown error is a lifecycle failure (the later steps still run);
 *   2. the synthetic records — removed and confirmed (cleanupSmokeRun), or
 *      KEPT with --keep-records;
 *   3. the resume files — removed ONLY when the records that reference them
 *      are confirmed gone; otherwise they are RETAINED with the records
 *      (kept, a failed, refused or unknown cleanup), so a retained
 *      Application never points at a missing file;
 *   4. r6/r7: ownership — only after records AND files are gone: the record
 *      is marked RELEASING (r7: durable evidence that they were confirmed
 *      removed), then the marker is released (confirmed by its deletion
 *      count), then the record is marked CLEANED. If the RELEASING record
 *      cannot be written the marker is kept; if anything after it fails, a
 *      later --cleanup-run finishes from the RELEASING record. A run that never
 *      wrote a marker goes straight to CLEANED.
 * The run's own failure (`runFailed`, with evidence.error) is preserved;
 * lifecycle failures are added beside it, never in its place.
 *
 * @returns {Promise<{ failed: boolean, failures: string[], recordsRemaining: boolean }>}
 */
export async function finaliseSmokeRun({ evidence, runFailed, keepRecords, shutdown, cleanupRecords, removeStorage, recordReleasing = null, releaseOwnership = null, recordCleaned = null, storageName, summarise = defaultSummary }) {
  if (releaseOwnership && !recordReleasing) throw new TypeError('releasing the ownership marker needs the RELEASING record first (recordReleasing)');
  const steps = [];
  const failures = [];
  const step = (name, ok, detail) => {
    steps.push({ name, ok, ...detail });
    if (!ok) failures.push(name);
  };

  // 1. Shutdown.
  if (shutdown) {
    try {
      const outcome = await shutdown();
      const clean = outcome?.clean === true;
      evidence.shutdown = { clean };
      step('server shut down cleanly', clean, clean ? {} : { reason: 'shutdown reported an incomplete cleanup (clean: false)' });
    } catch (error) {
      evidence.shutdown = { clean: false, error: summarise(error) };
      step('server shut down cleanly', false, { reason: `shutdown failed: ${summarise(error)}` });
    }
  } else {
    evidence.shutdown = { started: false };
  }

  // 2. The synthetic records.
  let recordsGone = false;
  if (keepRecords) {
    evidence.cleanup = { records: 'KEPT', reason: '--keep-records' };
  } else {
    try {
      const result = await cleanupRecords();
      recordsGone = result.complete === true;
      evidence.cleanup = { records: recordsGone ? 'REMOVED' : result.refused ? 'REFUSED' : 'INCOMPLETE', ...result };
      step(
        'synthetic records removed (confirmed by the database)',
        recordsGone,
        recordsGone ? { confirmed: result.confirmed } : result.refused ? { reason: `refused: ${result.refused.reason}` } : { remaining: result.remaining, notOwned: result.discovered?.notOwned },
      );
    } catch (error) {
      evidence.cleanup = { records: 'UNKNOWN', error: summarise(error) };
      step('synthetic records removed (confirmed by the database)', false, { reason: `the cleanup failed or its outcome is unknown: ${summarise(error)}` });
    }
  }

  // 3. The resume files — only after their records are confirmed gone.
  let filesGone = false;
  if (recordsGone) {
    try {
      removeStorage();
      filesGone = true;
      evidence.storage = { files: 'REMOVED', directory: storageName };
      step('resume files removed (confirmed)', true, {});
    } catch (error) {
      evidence.storage = { files: 'NOT_REMOVED', directory: storageName, error: summarise(error) };
      step('resume files removed (confirmed)', false, { reason: summarise(error) });
    }
  } else {
    evidence.storage = {
      files: 'RETAINED',
      directory: storageName,
      reason: keepRecords ? 'kept with the records they belong to (--keep-records)' : 'records that reference them may still exist',
    };
  }

  // 4. Ownership — released only when records and files are gone (no marker
  //    to release when the run never wrote one: releaseOwnership is null).
  if (filesGone) {
    let released = true;
    if (releaseOwnership) {
      released = false;
      let releasing = false;
      try {
        await recordReleasing();
        releasing = true;
        step('ownership record marked RELEASING (records and files confirmed removed)', true, {});
      } catch (error) {
        step('ownership record marked RELEASING (records and files confirmed removed)', false, { reason: `${summarise(error)}; the ownership marker was kept, so --cleanup-run can finish` });
      }
      if (releasing) {
        try {
          released = (await releaseOwnership())?.released === true;
          step('ownership marker released (confirmed)', released, released ? {} : { reason: 'the marker was not deleted (deletion count 0)' });
        } catch (error) {
          step('ownership marker released (confirmed)', false, { reason: summarise(error) });
        }
      }
    }
    if (released && recordCleaned) {
      try {
        await recordCleaned();
        step('ownership record marked CLEANED', true, {});
      } catch (error) {
        step('ownership record marked CLEANED', false, { reason: summarise(error) });
      }
    }
  }

  evidence.lifecycle = { steps, failures };
  return { failed: Boolean(runFailed) || failures.length > 0, failures, recordsRemaining: !recordsGone };
}

function defaultSummary(error) {
  return `${error?.name ?? 'Error'}${error?.code ? ` (${String(error.code).slice(0, 60)})` : ''}`;
}

/**
 * What the optional bounce exercise established — from the acknowledgement
 * channel recorded for the bounce-test Application AND the submission ledger
 * (whether the transport was called at all, and the relay's numeric reply).
 * Never claims more than that evidence shows:
 *
 *   ACCEPTED_BY_RELAY   recorded SENT and the transport reported acceptance (250): a bounce
 *                       SHOULD arrive in the sending mailbox — a MANUAL check
 *   REJECTED_BY_RELAY   the relay answered 5xx during submission (recipient refused): no message
 *                       was accepted, so no bounce comes from this attempt; bounce path NOT exercised
 *   DEFERRED_BY_RELAY   the relay answered 4xx: not accepted (this run never retries); NOT exercised
 *   CONFIGURATION_FAILURE  authentication / TLS / sender / configuration failure: not accepted; NOT exercised
 *   NOT_SUBMITTED       refused or failed before anything was submitted (the transport was not called,
 *                       or the connection failed before the message): no bounce; NOT exercised
 *   UNKNOWN             OUTCOME_UNKNOWN, TIMEOUT, PROVIDER_ERROR, an attempt still in progress, or
 *                       evidence that does not agree: the relay MAY have accepted it, a bounce MAY
 *                       arrive; the exercise is INCONCLUSIVE; never retried automatically
 */
export function classifyBounceExercise({ recorded, submission }) {
  const status = recorded?.status ?? null;
  const code = recorded?.lastErrorCode ?? null;
  const replyCode = Number(submission?.diagnostic?.replyCode);
  const phase = submission?.diagnostic?.phase ?? null;
  const codeClass = code !== null && Object.hasOwn(ERROR_CODE_CLASSES, code) ? ERROR_CODE_CLASSES[code] : null;
  const base = { recorded: { status, code }, ...(Number.isInteger(replyCode) ? { replyCode } : {}) };
  const verdict = (outcome) => ({ outcome, ...OUTCOMES[outcome], ...base });

  if (!recorded) return verdict('UNKNOWN');
  if (status === 'SENT') return submission?.result === 'ACCEPTED_BY_RELAY' ? verdict('ACCEPTED_BY_RELAY') : verdict('UNKNOWN');
  if (status !== 'FAILED') return verdict('UNKNOWN'); // PENDING (in progress or never attempted), NOT_REQUIRED, unrecognised
  if (codeClass === null || codeClass === FAILURE_CLASSES.UNCERTAIN) return verdict('UNKNOWN');
  // The ledger must agree that the transport failed it (an acceptance, or no result, is contradictory evidence).
  if (submission && (typeof submission.result !== 'string' || !submission.result.startsWith('FAILED:'))) return verdict('UNKNOWN');
  if (codeClass === FAILURE_CLASSES.CONFIGURATION) return verdict('CONFIGURATION_FAILURE');
  if (!submission) return verdict('NOT_SUBMITTED'); // refused before the transport was called (allowlist, address check)
  if (replyCode >= 500 && replyCode <= 599) return verdict('REJECTED_BY_RELAY');
  if (replyCode >= 400 && replyCode <= 499) return verdict('DEFERRED_BY_RELAY');
  if (phase !== null && phase !== 'data') return verdict('NOT_SUBMITTED'); // no reply before the body: nothing was submitted
  return verdict('UNKNOWN');
}

const OUTCOMES = Object.freeze({
  ACCEPTED_BY_RELAY: {
    relayAcceptance: 'accepted',
    bounceExpectation: 'a bounce should arrive in the sending mailbox (the address cannot receive mail)',
    bounceVerification: 'PENDING_MANUAL',
    line: 'the relay ACCEPTED it (accepted is not delivered): a bounce should now arrive in the sending mailbox — confirming it is a MANUAL check',
  },
  REJECTED_BY_RELAY: {
    relayAcceptance: 'rejected',
    bounceExpectation: 'none from this attempt: the relay refused it during submission (SMTP 5xx)',
    bounceVerification: 'NOT_EXERCISED',
    line: 'the relay explicitly REFUSED it during submission (SMTP 5xx): nothing was accepted, so no bounce comes from this attempt. The bounce path was NOT exercised.',
  },
  DEFERRED_BY_RELAY: {
    relayAcceptance: 'not accepted (temporary refusal)',
    bounceExpectation: 'none from this attempt: the relay deferred it (SMTP 4xx); this run never retries',
    bounceVerification: 'NOT_EXERCISED',
    line: 'the relay TEMPORARILY refused it (SMTP 4xx): not accepted, and this run does not retry. The bounce path was NOT exercised.',
  },
  CONFIGURATION_FAILURE: {
    relayAcceptance: 'not accepted',
    bounceExpectation: 'none: a configuration / authentication / TLS / sender failure stopped it',
    bounceVerification: 'NOT_EXERCISED',
    line: 'NOT accepted: a configuration, authentication, TLS or sender failure stopped it — investigate it. The bounce path was NOT exercised.',
  },
  NOT_SUBMITTED: {
    relayAcceptance: 'not submitted',
    bounceExpectation: 'none: nothing was submitted to the relay',
    bounceVerification: 'NOT_EXERCISED',
    line: 'NOT submitted: refused or failed before the message reached the relay, so no bounce can come from it. The bounce path was NOT exercised.',
  },
  UNKNOWN: {
    relayAcceptance: 'unknown',
    bounceExpectation: 'unknown: the relay may have accepted it, so a bounce MAY arrive',
    bounceVerification: 'INCONCLUSIVE',
    line: 'OUTCOME UNKNOWN: the relay may or may not have accepted it, so a bounce MAY still arrive in the sending mailbox. The bounce exercise is INCONCLUSIVE (never retried automatically).',
  },
});
