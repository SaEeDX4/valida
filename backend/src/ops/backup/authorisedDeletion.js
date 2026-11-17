import mongoose from 'mongoose';
import { isResumeStorageKey, storageObjectRef } from '../../integrations/storage/storageContract.js';
import { appendDeletionEntry } from './deletionLog.js';

/**
 * C6-T6 — an AUTHORISED deletion of one Application (C6 plan r3 §5.2,
 * "copy before delete"; §9.1 step 7: "deletion-log entry first").
 *
 * The order is the control, and the RECORD IS THE DURABLE TO-DO:
 *   1. the deletion-log entry is written (log-writer credential, a new object
 *      in the locked log bucket). If it cannot be written, NOTHING is deleted;
 *   2. the résumé object is removed through the API's own storage driver,
 *      bound to the exact version its HEAD observes (C6-T4 correction 2) AND to
 *      the size and SHA-256 the record states (`expect`): an object under the
 *      key that is not the recorded one is never removed;
 *   3. only when the store has CONFIRMED the object absent (deleted now, or a
 *      404) is the Application record removed.
 *
 * A failure at any step leaves the record in place, so a retry can always
 * find the object again and finish (correction to the delivered T6 order,
 * which removed the record first: a storage failure then left an object no
 * retry could reach). Outcomes are reported truthfully:
 *
 *   COMPLETE         object confirmed absent; record removed
 *   INCOMPLETE       the log entry is written, and the object's removal is
 *                    UNCERTAIN (no definite answer) or the record could not be
 *                    removed. Run the command again with the same arguments
 *   OBJECT_MISMATCH  the object under the key is not the recorded one: left
 *                    alone, record kept, for the operator (an incident)
 *   NO_RECORD        no such Application: nothing is touched, nothing logged.
 *                    An earlier run completed, or the id never existed
 *
 * A retry appends another log entry for the same Application; a restore
 * applies every entry and is repeatable, so duplicates are harmless. The
 * result holds the id and the one-way object reference — never the key.
 *
 * Phase 1 has no deletion workflow: this command is used by the rehearsal
 * and the C7 clean-up only, each time under a named authorisation.
 */
export const DELETION_STATUSES = Object.freeze(['COMPLETE', 'INCOMPLETE', 'OBJECT_MISMATCH', 'NO_RECORD']);

export async function deleteApplicationAuthorised({ applicationId, authorisation, applications, storage, log, clock = () => new Date() }) {
  if (!/^[0-9a-f]{24}$/.test(applicationId ?? '')) throw new TypeError('an Application id (24 hex) is required');
  const _id = new mongoose.Types.ObjectId(applicationId);
  const record = await applications.findOne({ _id }, { projection: { 'resume.storageKey': 1, 'resume.sizeBytes': 1, 'resume.checksumSha256': 1 } });
  if (!record) return { applicationId, status: 'NO_RECORD', objectRef: null, object: 'NOT_TOUCHED', recordRemoved: false };
  const key = record.resume?.storageKey;
  const objectRef = isResumeStorageKey(key) ? storageObjectRef(key) : null;

  // 1. The log entry, first. A failure here propagates: nothing has been deleted.
  const entry = await appendDeletionEntry(log, { applicationId, objectRef, authorisation, now: clock() });
  const base = { entryId: entry.entryId, loggedAt: entry.loggedAt, applicationId, objectRef };

  // 2. The object, bound to its version and to the recorded size and checksum.
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
    else if (result.reason === 'NOT_THE_EXPECTED_OBJECT') return { ...base, status: 'OBJECT_MISMATCH', object: 'NOT_THE_RECORDED_OBJECT', recordRemoved: false };
    else return { ...base, status: 'INCOMPLETE', object: 'UNCERTAIN', reason: 'UNEXPECTED_RESULT', recordRemoved: false };
  }

  // 3. The record, only once the object is confirmed absent.
  let removed;
  try {
    removed = (await applications.deleteOne({ _id })).deletedCount;
  } catch {
    return { ...base, status: 'INCOMPLETE', object, reason: 'DATABASE_UNAVAILABLE', recordRemoved: false };
  }
  return { ...base, status: 'COMPLETE', object, recordRemoved: removed === 1 };
}
