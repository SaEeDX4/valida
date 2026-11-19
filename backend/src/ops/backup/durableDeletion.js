import mongoose from 'mongoose';
import { isResumeStorageKey, storageObjectRef } from '../../integrations/storage/storageContract.js';

/**
 * Proposed (MongoDB-native r2, finding 2) — an authorised deletion whose
 * history survives the loss of the primary database.
 *
 *   1. The replay record AND a checkpoint covering it are written to the
 *      independent journal (deletionJournal.js) and read back verified.
 *      A failure here deletes nothing. If no entry landed: NOT_STARTED. If
 *      the entry landed but its checkpoint did not: INCOMPLETE — the deletion
 *      is now authorised AND recorded (a restore applies it), so the operator
 *      retries until COMPLETE; it is never silently abandoned.
 *   2. The exact résumé version is removed (bound to size and SHA-256).
 *   3. The Application record is removed — last, so a record never points
 *      at nothing outside an interrupted run.
 *   4. COMPLETE is reported only after 1-3, with the checkpoint to record.
 *
 * Every step is safe to retry. A retry after a lost acknowledgement finds its
 * own journal entry (keyed by the Application id) and continues; a retry
 * after the record is already gone confirms the journal covers it and
 * reports COMPLETE (ALREADY_DELETED) — never NO_RECORD for a deletion that
 * happened, and never a second entry.
 */
export async function deleteApplicationDurably({ applicationId, authorisation, applications, storage, journal }) {
  if (!/^[0-9a-f]{24}$/.test(applicationId ?? '')) throw new TypeError('an Application id (24 hex) is required');
  if (journal?.kind !== 'journal') throw new TypeError('the durable deletion journal is required');
  const _id = new mongoose.Types.ObjectId(applicationId);
  const record = await applications.findOne({ _id }, { projection: { 'resume.storageKey': 1, 'resume.sizeBytes': 1, 'resume.checksumSha256': 1 } });

  if (!record) {
    const prior = await journal.find(applicationId);
    if (!prior) return { applicationId, status: 'NO_RECORD', journal: 'NOT_WRITTEN', recordRemoved: false };
    // An earlier run removed the record: make sure its checkpoint exists, then report it.
    const { checkpoint } = await journal.ensureCheckpointed(applicationId);
    return { applicationId, status: 'COMPLETE', resumed: 'ALREADY_DELETED', objectRef: prior.objectRef, checkpoint, recordRemoved: true };
  }

  const key = record.resume?.storageKey;
  const objectRef = isResumeStorageKey(key) ? storageObjectRef(key) : null;
  let durable;
  try {
    durable = await journal.record({ applicationId, objectRef, authorisation });
  } catch (error) {
    const reason = typeof error?.reason === 'string' ? error.reason : 'UNAVAILABLE';
    // Did the entry land before the failure? Then the deletion is authorised and recorded, and a restore will
    // apply it: it must be completed by a retry. Only a definite "no entry" is NOT_STARTED.
    if (error?.beforeWrite) return { applicationId, status: 'NOT_STARTED', reason, journal: 'NOT_WRITTEN', recordRemoved: false };
    const landed = await journal.find(applicationId).then((e) => (e ? 'ENTRY_WRITTEN' : 'NONE'), () => 'UNKNOWN');
    if (landed === 'NONE') return { applicationId, status: 'NOT_STARTED', reason, journal: 'NOT_WRITTEN', recordRemoved: false };
    return { applicationId, status: 'INCOMPLETE', reason, journal: landed, action: 'RETRY_TO_COMPLETE', recordRemoved: false };
  }
  const base = { applicationId, objectRef, checkpoint: durable.checkpoint };

  let object = 'NONE';
  if (objectRef) {
    let result;
    try {
      result = await storage.deletePrivateObject(key, { expect: { sizeBytes: record.resume.sizeBytes, checksumSha256: record.resume.checksumSha256 } });
    } catch (error) {
      return { ...base, status: 'INCOMPLETE', object: 'UNCERTAIN', reason: typeof error?.reason === 'string' ? error.reason : 'UNAVAILABLE', recordRemoved: false };
    }
    if (result.deleted) object = 'DELETED';
    else if (result.reason === 'NOT_FOUND') object = 'ABSENT';
    else return { ...base, status: 'OBJECT_MISMATCH', object: 'NOT_THE_RECORDED_OBJECT', recordRemoved: false };
  }
  let removed;
  try {
    removed = (await applications.deleteOne({ _id }, { writeConcern: { w: 'majority', j: true } })).deletedCount;
  } catch {
    return { ...base, status: 'INCOMPLETE', object, reason: 'RECORD_DELETE_FAILED', recordRemoved: false };
  }
  return { ...base, status: 'COMPLETE', object, recordRemoved: removed === 1 };
}
