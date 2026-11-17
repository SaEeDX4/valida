import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { isResumeStorageKey, storageObjectRef } from '../../integrations/storage/storageContract.js';
import { BackupStoreError, deleteObjectVersion, getObject, headObject, listKeys, putNewObject, sha256Hex } from './backupStore.js';
import { DeletionLogUnavailable, readDeletionLog } from './deletionLog.js';
import { SNAPSHOT_STATES } from './manifest.js';

/**
 * C6-T6 — restore and the reconciliation gate (C6 plan r3 §5.4, as corrected
 * by r3 correction 1: the damaged and healthy rehearsals).
 *
 * Precondition (the provider's act, outside this tool): the snapshot has
 * been restored into a NEW database. This tool never touches live data: it
 * is given the restored database's `applications` collection, the copy
 * bucket (read) and a NEW, empty, versioned restore-target bucket (write).
 * The restored API stays `RECRUITMENT_MODE=closed` throughout; the tool has
 * no way to open it, and its verdict is the only input to the owner's
 * decision to do so.
 *
 *   1  copy every verified object from the copy bucket into the target
 *   2  reconcile (dry run): every Application is OK, MISSING-EXPLAINED (no
 *      object, a deletion-log entry exists), MISSING-UNEXPLAINED or MISMATCH;
 *      objects without a record are listed (measured loss: accepted after T)
 *   3  read the WHOLE deletion log; if it is unavailable, STOP: RECOVERY FAILED
 *   4  apply every entry: remove the record and every object with its
 *      one-way reference (version-bound deletes)
 *   5  reconcile again
 *   6  verify every remaining résumé by its bytes: length and SHA-256 equal
 *      the restored record (and the checksum taken at submission, if given)
 *   7  deleted stays deleted: no record and no object for any entry
 *
 *   RECOVERY VERIFIED  only when 3 succeeded, 4 had no failure, 5 has
 *                      MISSING-UNEXPLAINED = 0 and MISMATCH = 0, and 6 and 7
 *                      found nothing. An owner disposition never makes a
 *                      failed restore VERIFIED.
 *   RECOVERY FAILED    otherwise, with the reasons.
 *
 * The report holds ids, one-way references, sizes, checksums, counts and
 * times — no applicant data, no storage key.
 */
const OBJECT_PREFIX = 'resumes/';
const ms = (from) => Number(process.hrtime.bigint() - from) / 1e6;

async function classify({ records, target, deletedIds }) {
  const rows = [];
  const referenced = new Set();
  for (const record of records) {
    const key = record.resume?.storageKey;
    const id = String(record._id);
    const objectRef = isResumeStorageKey(key) ? storageObjectRef(key) : null;
    if (objectRef) referenced.add(objectRef);
    let state;
    if (!objectRef) state = 'MISMATCH';
    else {
      const head = await headObject(target, key);
      if (!head.exists) state = deletedIds.has(id) ? 'MISSING-EXPLAINED' : 'MISSING-UNEXPLAINED';
      else state = head.size === record.resume.sizeBytes && head.sha256 === record.resume.checksumSha256 ? 'OK' : 'MISMATCH';
    }
    rows.push({ applicationId: id, objectRef, state });
  }
  const objects = (await listKeys(target, OBJECT_PREFIX)).filter((e) => isResumeStorageKey(e.key));
  const withoutRecord = objects.map((e) => storageObjectRef(e.key)).filter((ref) => !referenced.has(ref)).sort();
  const count = (state) => rows.filter((row) => row.state === state).length;
  return {
    applications: rows.sort((a, b) => a.applicationId.localeCompare(b.applicationId)),
    counts: { OK: count('OK'), 'MISSING-EXPLAINED': count('MISSING-EXPLAINED'), 'MISSING-UNEXPLAINED': count('MISSING-UNEXPLAINED'), MISMATCH: count('MISMATCH') },
    objectsWithoutRecord: withoutRecord,
  };
}

/**
 * @param {object} o
 * @param {object} o.applications  the RESTORED database's `applications` collection (native driver)
 * @param {object} o.copy          copy bucket endpoint (read)
 * @param {object} o.target        NEW restore-target bucket endpoint (write)
 * @param {object} o.log           log bucket endpoint (read)
 * @param {object} o.snapshot      { id, time }
 * @param {Map<string,{sizeBytes:number, checksumSha256:string}>} [o.expected] checksums taken at submission (H1)
 */
export async function runRestore({ applications, copy, target, log, snapshot, expected = null, clock = () => new Date() }) {
  const timings = {};
  const reasons = [];
  const report = { schema: 'valida.restore-report.v1', snapshot: { id: snapshot.id, time: snapshot.time.toISOString() }, startedAt: clock().toISOString(), restoredMode: 'closed' };

  // 1. The copy into the new bucket.
  let t = process.hrtime.bigint();
  const copied = { objects: 0, failed: [] };
  for (const { key } of (await listKeys(copy, OBJECT_PREFIX)).filter((e) => isResumeStorageKey(e.key))) {
    const objectRef = storageObjectRef(key);
    try {
      const object = await getObject(copy, key);
      if (!object.sha256 || sha256Hex(object.bytes) !== object.sha256) {
        copied.failed.push({ objectRef, reason: 'COPY_CHECKSUM_MISMATCH' });
        continue;
      }
      const written = await putNewObject(target, key, object.bytes, { metadata: { sha256: object.sha256 } });
      if (!written.created) copied.failed.push({ objectRef, reason: 'TARGET_NOT_EMPTY' });
      else copied.objects += 1;
    } catch (error) {
      copied.failed.push({ objectRef, reason: error instanceof BackupStoreError ? error.reason : 'UNAVAILABLE' });
    }
  }
  timings.objectsRestoredMs = ms(t);
  report.objectsRestored = copied;
  if (copied.failed.length) reasons.push('OBJECT_RESTORE_INCOMPLETE');

  // 2. Reconcile, dry run. (The deletion log is not needed to classify OK/MISMATCH;
  //    MISSING is split by it once it has been read.)
  t = process.hrtime.bigint();
  let logEntries = null;
  let logReason = null;
  try {
    logEntries = await readDeletionLog(log);
  } catch (error) {
    logReason = error instanceof DeletionLogUnavailable ? error.reason : 'UNAVAILABLE';
  }
  const deletedIds = new Set((logEntries ?? []).map((e) => e.applicationId));
  report.reconcileBefore = await classify({ records: await applications.find({}).toArray(), target, deletedIds });
  timings.reconcileBeforeMs = ms(t);

  // 3. The deletion log must be available, or the gate cannot pass.
  if (logEntries === null) {
    reasons.push(`DELETION_LOG_UNAVAILABLE_${logReason}`);
    report.deletionLog = { available: false, reason: logReason };
    return finish();
  }
  report.deletionLog = { available: true, entries: logEntries.length };

  // 4. Apply every entry (repeatable).
  t = process.hrtime.bigint();
  const applied = { entries: 0, recordsRemoved: 0, objectsRemoved: 0, failed: [] };
  const listing = (await listKeys(target, OBJECT_PREFIX)).filter((e) => isResumeStorageKey(e.key));
  const byRef = new Map(listing.map((e) => [storageObjectRef(e.key), e.key]));
  for (const entry of logEntries) {
    try {
      const record = await applications.findOne({ _id: toObjectId(entry.applicationId) });
      const refs = new Set([entry.objectRef, record?.resume?.storageKey && isResumeStorageKey(record.resume.storageKey) ? storageObjectRef(record.resume.storageKey) : null].filter(Boolean));
      for (const ref of refs) {
        const key = byRef.get(ref);
        if (!key) continue;
        const head = await headObject(target, key);
        if (head.exists) {
          const removed = await deleteObjectVersion(target, key, head.versionId);
          if (removed.deleted) applied.objectsRemoved += 1;
          if ((await headObject(target, key)).exists) throw new BackupStoreError('delete', 'CONFLICT');
        }
      }
      if (record) {
        const result = await applications.deleteOne({ _id: record._id });
        applied.recordsRemoved += result.deletedCount;
      }
      applied.entries += 1;
    } catch (error) {
      applied.failed.push({ entryId: entry.entryId, reason: error instanceof BackupStoreError ? error.reason : 'UNAVAILABLE' });
    }
  }
  timings.deletionLogAppliedMs = ms(t);
  report.deletionLogApplied = applied;
  if (applied.failed.length) reasons.push('DELETION_LOG_NOT_FULLY_APPLIED');

  // 5. Reconcile again.
  t = process.hrtime.bigint();
  report.reconcileAfter = await classify({ records: await applications.find({}).toArray(), target, deletedIds });
  timings.reconcileAfterMs = ms(t);
  if (report.reconcileAfter.counts['MISSING-UNEXPLAINED'] > 0) reasons.push(`MISSING_UNEXPLAINED_${report.reconcileAfter.counts['MISSING-UNEXPLAINED']}`);
  if (report.reconcileAfter.counts.MISMATCH > 0) reasons.push(`MISMATCH_${report.reconcileAfter.counts.MISMATCH}`);

  // 6. Every remaining résumé, by its bytes.
  t = process.hrtime.bigint();
  const verified = [];
  for (const record of await applications.find({}).toArray()) {
    const id = String(record._id);
    const key = record.resume?.storageKey;
    const row = { applicationId: id, objectRef: isResumeStorageKey(key) ? storageObjectRef(key) : null };
    try {
      const { bytes } = await getObject(target, key);
      row.byteLength = bytes.length;
      row.sha256 = createHash('sha256').update(bytes).digest('hex');
      row.matchesRecord = row.byteLength === record.resume.sizeBytes && row.sha256 === record.resume.checksumSha256;
      const original = expected?.get(id);
      row.matchesSubmission = original ? original.sizeBytes === row.byteLength && original.checksumSha256 === row.sha256 : null;
    } catch {
      row.matchesRecord = false;
      row.matchesSubmission = false;
    }
    verified.push(row);
  }
  timings.bytesVerifiedMs = ms(t);
  report.bytesVerified = verified.sort((a, b) => a.applicationId.localeCompare(b.applicationId));
  if (verified.some((row) => !row.matchesRecord || row.matchesSubmission === false)) reasons.push('BYTE_VERIFICATION_FAILED');

  // 7. Deleted stays deleted.
  const remainingRefs = new Set((await listKeys(target, OBJECT_PREFIX)).filter((e) => isResumeStorageKey(e.key)).map((e) => storageObjectRef(e.key)));
  const resurrected = [];
  for (const entry of logEntries) {
    const record = await applications.findOne({ _id: toObjectId(entry.applicationId) });
    if (record || (entry.objectRef && remainingRefs.has(entry.objectRef))) resurrected.push(entry.applicationId);
  }
  report.deletedStaysDeleted = { entries: logEntries.length, resurrected };
  if (resurrected.length) reasons.push('DELETED_DATA_PRESENT');
  return finish();

  function finish() {
    report.completedAt = clock().toISOString();
    report.timings = timings;
    report.reasons = reasons;
    report.verdict = reasons.length === 0 ? SNAPSHOT_STATES.VERIFIED : SNAPSHOT_STATES.FAILED;
    // The tool never opens the restored system. VERIFIED makes it eligible for the owner's decision.
    report.restoredSystem = { mode: 'closed', eligibleForOwnerReopening: reasons.length === 0 };
    return report;
  }
}

const OBJECT_ID = /^[0-9a-f]{24}$/;
/** A validated id from the log, as the database's ObjectId. */
function toObjectId(hex) {
  if (!OBJECT_ID.test(hex)) throw new BackupStoreError('find', 'UNEXPECTED_STATUS');
  return new mongoose.Types.ObjectId(hex);
}
