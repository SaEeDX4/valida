import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { isResumeStorageKey, storageObjectRef } from '../../integrations/storage/storageContract.js';
import { DeletionLogUnavailable } from './deletionLog.js';
import { identifyRestoreTarget } from './restoreTarget.js';

/**
 * Proposed (MongoDB-native, r2) — the restore gate for a database restored
 * from an Atlas snapshot.
 *
 * The snapshot holds the Applications AND their résumé documents together, so
 * it is internally consistent by construction. What it cannot know is what
 * was deleted AFTER it was taken. In order, and nothing is written before
 * steps 0 and 1 have both passed:
 *
 *   0. the target is positively identified as the authorised, disposable
 *      restore target, with a writer scoped to it (restoreTarget.js). A
 *      refusal: RECOVERY REFUSED, zero writes;
 *   1. the deletion history is read from the independent journal (or an
 *      offline export of it) and verified, optionally against the owner's
 *      anchor (deletionJournal.js). Unreadable, incomplete, stale or
 *      tampered: RECOVERY FAILED (DELETION_HISTORY_<reason>), zero writes;
 *   1b. (2026-11-18) FRESHNESS: the verified history must be known to be the NEWEST. It is when it was
 *      read from the live journal (its server answers as the configured live replica set) or from the
 *      independent external journal. An offline export cannot prove that no deletion followed it: it
 *      is accepted only with an explicit owner attestation (recorded in the report). Otherwise
 *      RECOVERY FAILED (DELETION_HISTORY_FRESHNESS_UNKNOWN), zero writes: the target stays closed;
 *   2. EVERY entry — checkpointed and pending — is applied: the Application
 *      and its exact résumé version are removed if present. Idempotent;
 *   3. every remaining Application must have its résumé document with the
 *      recorded size and SHA-256 (re-hashed): MISSING_n / MISMATCH_n;
 *   4. RECOVERY VERIFIED only when every step passed.
 */
export const RESTORE_VERDICTS = Object.freeze(['RECOVERY VERIFIED', 'RECOVERY FAILED', 'RECOVERY REFUSED']);
export const RESUME_FILES = 'resume_files';

export async function runMongoRestore({ targetClient, targetUri, liveUris = [], liveClient = null, env = process.env, history, anchor = null, freshness = { established: false, basis: 'UNSPECIFIED' }, snapshot, now = new Date() }) {
  const report = { snapshot, target: null, history: null, applied: { applications: 0, files: 0, alreadyAbsent: 0 }, checked: 0, missing: [], mismatched: [], orphans: 0, verdict: null, reasons: [] };

  const target = await identifyRestoreTarget({ targetClient, targetUri, liveUris, liveClient, env, now });
  if (!target.ok) {
    report.verdict = 'RECOVERY REFUSED';
    report.reasons.push(`TARGET_${target.reason}`);
    return report;
  }
  report.target = target.identity;

  let entries;
  try {
    const verified = await history.readHistory({ anchor });
    entries = [...verified.entries, ...verified.pending];
    report.history = { checkpointed: verified.entries.length, pending: verified.pending.length, checkpoint: verified.checkpoint, anchorChecked: Boolean(anchor) };
  } catch (error) {
    report.verdict = 'RECOVERY FAILED';
    report.reasons.push(`DELETION_HISTORY_${error instanceof DeletionLogUnavailable ? error.reason : 'UNAVAILABLE'}`);
    return report;
  }
  if (freshnessRefused(freshness, report)) return report;

  await replayAndVerify(targetClient.db(target.identity.database), entries, report);
  return report;
}

/** Step 1b. Records the basis; refuses (nothing written) when the history is not known to be the newest. */
export function freshnessRefused(freshness, report) {
  report.history.freshness = freshness?.basis ?? 'UNSPECIFIED';
  if (freshness?.attestation) report.history.attestation = freshness.attestation;
  if (freshness?.established === true) return false;
  report.verdict = 'RECOVERY FAILED';
  report.reasons.push('DELETION_HISTORY_FRESHNESS_UNKNOWN');
  return true;
}

/**
 * Steps 2-4 on an identified target: apply every deletion-history entry, then check every remaining
 * Application has its exact résumé version. Shared by the snapshot gate and the recovery-copy load (r3).
 */
export async function replayAndVerify(db, entries, report) {
  const applications = db.collection('applications');
  const resumeFiles = db.collection(RESUME_FILES);
  const refToKey = new Map();
  for await (const doc of resumeFiles.find({}, { projection: { _id: 1 } })) if (isResumeStorageKey(doc._id)) refToKey.set(storageObjectRef(doc._id), doc._id);
  for (const entry of entries) {
    const record = await applications.findOne({ _id: new mongoose.mongo.ObjectId(entry.applicationId) }, { projection: { resume: 1 } });
    let key = null;
    if (record) {
      key = record.resume?.storageKey ?? null;
      if (entry.objectRef && key && storageObjectRef(key) !== entry.objectRef) {
        report.reasons.push(`HISTORY_ENTRY_OBJECT_MISMATCH_${entry.applicationId}`);
        continue;
      }
      report.applied.applications += (await applications.deleteOne({ _id: record._id })).deletedCount;
    }
    key = key ?? (entry.objectRef ? refToKey.get(entry.objectRef) ?? null : null);
    if (key) report.applied.files += (await resumeFiles.deleteOne({ _id: key })).deletedCount;
    if (!record && !key) report.applied.alreadyAbsent += 1;
  }

  const referenced = new Set();
  for await (const app of applications.find({}, { projection: { resume: 1 } })) {
    report.checked += 1;
    const r = app.resume ?? {};
    referenced.add(r.storageKey);
    const file = isResumeStorageKey(r.storageKey) ? await resumeFiles.findOne({ _id: r.storageKey }) : null;
    if (!file) {
      report.missing.push(String(app._id));
      continue;
    }
    const bytes = file.data?.buffer ? Buffer.from(file.data.buffer) : null;
    const sha = bytes ? createHash('sha256').update(bytes).digest('hex') : null;
    if (!bytes || bytes.length !== r.sizeBytes || sha !== r.checksumSha256 || file.checksumSha256 !== r.checksumSha256) report.mismatched.push(String(app._id));
  }
  for await (const doc of resumeFiles.find({}, { projection: { _id: 1, probe: 1 } })) if (!doc.probe && !referenced.has(doc._id)) report.orphans += 1;

  if (report.missing.length) report.reasons.push(`MISSING_${report.missing.length}`);
  if (report.mismatched.length) report.reasons.push(`MISMATCH_${report.mismatched.length}`);
  report.verdict = report.reasons.length === 0 ? 'RECOVERY VERIFIED' : 'RECOVERY FAILED';
  return report;
}
