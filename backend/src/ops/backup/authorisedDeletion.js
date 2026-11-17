import mongoose from 'mongoose';
import { isResumeStorageKey, storageObjectRef } from '../../integrations/storage/storageContract.js';
import { appendDeletionEntry } from './deletionLog.js';

/**
 * C6-T6 — an AUTHORISED deletion of one Application (C6 plan r3 §5.2,
 * "copy before delete"; §9.1 step 7: "deletion-log entry first").
 *
 * The order is the control:
 *   1. the deletion-log entry is written (log-writer credential, a new
 *      object in the locked log bucket). If it cannot be written, NOTHING is
 *      deleted;
 *   2. the Application record is removed (the API's database);
 *   3. the résumé object is removed through the API's own storage driver,
 *      which binds the deletion to the exact object version it observes
 *      (C6-T4 correction 2) — with the API's existing storage permissions.
 *
 * A crash between steps leaves a log entry for a deletion not (yet) done:
 * the command is repeatable, and a restore applies the entry whether or not
 * the original deletion finished. The reverse — a deletion with no entry —
 * cannot happen through this command.
 *
 * Phase 1 has no deletion workflow: this command is used by the rehearsal
 * and the C7 clean-up only, each time under a named authorisation.
 */
export async function deleteApplicationAuthorised({ applicationId, authorisation, applications, storage, log, clock = () => new Date() }) {
  if (!/^[0-9a-f]{24}$/.test(applicationId ?? '')) throw new TypeError('an Application id (24 hex) is required');
  const _id = new mongoose.Types.ObjectId(applicationId);
  const record = await applications.findOne({ _id }, { projection: { 'resume.storageKey': 1 } });
  const key = record?.resume?.storageKey;
  const objectRef = isResumeStorageKey(key) ? storageObjectRef(key) : null;

  const entry = await appendDeletionEntry(log, { applicationId, objectRef, authorisation, now: clock() });

  const removed = record ? (await applications.deleteOne({ _id })).deletedCount : 0;
  let object = 'NONE';
  if (objectRef) {
    const result = await storage.deletePrivateObject(key);
    object = result.deleted ? 'DELETED' : result.reason ?? 'NOT_FOUND';
  }
  return { entryId: entry.entryId, applicationId, objectRef, recordRemoved: removed === 1, object, loggedAt: entry.loggedAt };
}
