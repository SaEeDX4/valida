import { randomUUID } from 'node:crypto';
import { storageObjectRef } from '../../integrations/storage/storageContract.js';
import { BackupStoreError, headObject, putNewObject } from './backupStore.js';
import { readCopyRuns } from './copyJob.js';
import { DeletionLogUnavailable, readDeletionLog } from './deletionLog.js';

/**
 * C6-T6 — the per-snapshot manifest (C6 plan r3 §5.2 as corrected by r3
 * correction 1).
 *
 * BUILT FROM THE LIVE DATABASE, so it is PRELIMINARY. It shows whether the
 * copy bucket holds a verified object for every Application the live
 * database says existed at the snapshot time T. It cannot see a record
 * that was removed from the live database without a log entry, and it does
 * not read the snapshot itself: only a restore can verify a snapshot.
 *
 * States (the word "recoverable" is not used):
 *
 *   UNASSESSED                     no complete copy run started after T, the
 *                                  copy-run records or the deletion log cannot
 *                                  be read, or a check could not be made
 *   PRELIMINARY: NO DEFECT FOUND   every Application created at or before T
 *                                  has a copy object with the stated size and
 *                                  SHA-256
 *   PRELIMINARY: DEFECT FOUND (n)  n Applications whose copy is absent or does
 *                                  not match. Reported the same day, with
 *                                  whether the primary still holds a good
 *                                  object (§5.3)
 *
 * RECOVERY VERIFIED and RECOVERY FAILED are given only by a restore
 * (restore.js). Nothing here changes a state into another.
 *
 * The manifest holds Application ids, one-way object references, sizes,
 * checksums and times — no applicant data — and is written once, as a new
 * object, in the log bucket under `manifests/<snapshot id>/`.
 */
export const MANIFEST_PREFIX = 'manifests/';
export const MANIFEST_SCHEMA = 'valida.snapshot-manifest.v1';
export const SNAPSHOT_STATES = Object.freeze({
  UNASSESSED: 'UNASSESSED',
  NO_DEFECT: 'PRELIMINARY: NO DEFECT FOUND',
  DEFECT: (n) => `PRELIMINARY: DEFECT FOUND (${n})`,
  VERIFIED: 'RECOVERY VERIFIED',
  FAILED: 'RECOVERY FAILED',
});
const SNAPSHOT_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * @param {object} o
 * @param {{ id: string, time: Date }} o.snapshot
 * @param {Array<{ id: string, createdAt: Date, storageKey: string, sizeBytes: number, checksumSha256: string }>} o.applications
 *        Applications in the LIVE database created at or before snapshot.time
 */
export async function buildManifest({ snapshot, applications, primary, copy, log, clock = () => new Date(), runId = randomUUID() }) {
  if (!SNAPSHOT_ID.test(snapshot?.id ?? '') || !(snapshot.time instanceof Date) || Number.isNaN(snapshot.time.getTime())) throw new TypeError('a snapshot id and time are required');
  const T = snapshot.time;
  const generatedAt = clock();
  const reasons = [];

  // The copy must have COMPLETED a run that STARTED after T.
  let copyRun = null;
  try {
    const { runs, unreadable } = await readCopyRuns(log);
    if (unreadable > 0) reasons.push('COPY_RUN_RECORD_UNREADABLE');
    copyRun = runs.filter((run) => run.complete && new Date(run.startedAt) >= T).at(-1) ?? null;
    if (!copyRun) reasons.push('NO_COMPLETE_COPY_RUN_AFTER_SNAPSHOT');
  } catch (error) {
    reasons.push(`COPY_RUNS_UNAVAILABLE_${error instanceof BackupStoreError ? error.reason : 'UNAVAILABLE'}`);
  }

  let deletionsAfter = null;
  try {
    const entries = await readDeletionLog(log);
    deletionsAfter = entries.filter((entry) => new Date(entry.loggedAt) > T).map(({ applicationId, objectRef, loggedAt }) => ({ applicationId, objectRef, loggedAt }));
  } catch (error) {
    reasons.push(error instanceof DeletionLogUnavailable ? `DELETION_LOG_UNAVAILABLE_${error.reason}` : 'DELETION_LOG_UNAVAILABLE');
  }

  const checked = [];
  const defects = [];
  let unchecked = 0;
  for (const app of applications) {
    if (!(app.createdAt instanceof Date) || app.createdAt > T) continue;
    const objectRef = storageObjectRef(app.storageKey);
    let finding;
    try {
      const head = await headObject(copy, app.storageKey);
      if (!head.exists) finding = 'ABSENT';
      else if (head.size !== app.sizeBytes) finding = 'WRONG_SIZE';
      else if (head.sha256 !== app.checksumSha256) finding = 'WRONG_CHECKSUM';
      else finding = 'OK';
    } catch {
      finding = 'UNCHECKED';
    }
    const row = { applicationId: String(app.id), objectRef, createdAt: app.createdAt.toISOString(), sizeBytes: app.sizeBytes, checksumSha256: app.checksumSha256, copy: finding };
    if (finding === 'UNCHECKED') unchecked += 1;
    if (finding !== 'OK' && finding !== 'UNCHECKED') {
      // §5.3: does the primary still hold a good object? (it can then be copied at once)
      let primaryHolds = 'UNKNOWN';
      try {
        const head = await headObject(primary, app.storageKey);
        primaryHolds = head.exists && head.size === app.sizeBytes && head.sha256 === app.checksumSha256 ? 'YES' : 'NO';
      } catch {
        primaryHolds = 'UNKNOWN';
      }
      row.primaryHoldsGoodObject = primaryHolds;
      defects.push(row);
    }
    checked.push(row);
  }
  if (unchecked > 0) reasons.push('CHECK_INCOMPLETE');

  const state = reasons.length > 0 ? SNAPSHOT_STATES.UNASSESSED : defects.length > 0 ? SNAPSHOT_STATES.DEFECT(defects.length) : SNAPSHOT_STATES.NO_DEFECT;
  const manifest = {
    schema: MANIFEST_SCHEMA,
    runId,
    snapshot: { id: snapshot.id, time: T.toISOString() },
    generatedAt: generatedAt.toISOString(),
    basis: 'LIVE_DATABASE',
    note: 'Preliminary: built from the live database, not from the snapshot. Only a restore verifies a snapshot.',
    state,
    reasons,
    copyRun: copyRun ? { runId: copyRun.runId, startedAt: copyRun.startedAt, completedAt: copyRun.completedAt } : null,
    applicationsAtOrBeforeSnapshot: checked.length,
    ok: checked.filter((row) => row.copy === 'OK').length,
    defects,
    deletionsAfterSnapshot: deletionsAfter,
    applications: checked,
  };
  let stored = false;
  try {
    const key = `${MANIFEST_PREFIX}${snapshot.id}/${manifest.generatedAt.replace(/[-:.]/g, '')}-${runId}.json`;
    stored = (await putNewObject(log, key, Buffer.from(`${JSON.stringify(manifest)}\n`), { contentType: 'application/json' })).created;
  } catch {
    stored = false;
  }
  return { ...manifest, stored };
}
