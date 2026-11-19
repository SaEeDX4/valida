import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { scanApplicationResume } from './resumeSecurity.js';

/**
 * Proposed (MongoDB-native r3) — a starvation-free, bounded résumé scan queue.
 *
 * The Application data model is unchanged (Doc 10). Retry state lives in its
 * own collection, `scan_attempts`, one document per (Application, exact stored
 * version):
 *
 *   { _id: "<applicationId>:<sha256>", applicationId, storageKey, checksumSha256,
 *     attempts, infraFailures, lastAttemptAt, nextAttemptAt, lastFailure,
 *     exhausted, resolved, leaseUntil, leaseOwner }
 *
 * Selection, every run:
 *   1. NEW work first — NOT_SCANNED / PENDING résumés, oldest first — up to a
 *      reserved share of the batch (`newShare`, default 0.5, at least 1). An
 *      old batch that keeps failing can therefore never starve a new
 *      submission: a new résumé is scanned in the next run.
 *   2. Due retries — FAILED résumés whose attempts record says
 *      nextAttemptAt <= now, not exhausted — fill the rest, earliest due first.
 *      A FAILED résumé with no attempts record (failed before this queue
 *      existed) is a due retry.
 *   3. Unused retry capacity goes back to new work.
 *
 * Every item is CLAIMED before it is scanned (a lease written with a
 * conditional update/insert), so two workers never scan or record the same
 * item at once.
 *
 * Outcomes:
 *   - CLEAN / QUARANTINED recorded: the attempts record is resolved.
 *   - FAILED for a reason in the FILE or its record (integrity, missing file,
 *     bytes disagreement, unexpected verdict): attempts + 1, next attempt after
 *     an exponential backoff (base * 2^(attempts-1), capped); after
 *     `maxAttempts` the item is EXHAUSTED. It stays FAILED — held, never
 *     released, never retried automatically, reported in every run.
 *   - FAILED because the SCANNER is unusable (unavailable, timeout, reset,
 *     malformed answer, scanner error, stale/unknown/changed signatures): the
 *     file stays FAILED (held, Doc 13 section 74) but the attempt is NOT
 *     charged to the file — infraFailures + 1 instead — and the batch stops at
 *     once (circuit open), so an outage does not burn every file's attempts.
 *     A file that breaks the scanner on every attempt is still bounded:
 *     infraFailures reaching 2 x maxAttempts exhausts it.
 *   - Not recorded (the record moved to another version, was deleted, or
 *     changed state): the lease is released, no attempt is charged.
 */
export const SCAN_ATTEMPTS_COLLECTION = 'scan_attempts';
export const SCANNER_INFRA_FAILURES = Object.freeze(new Set([
  'UNAVAILABLE', 'TIMEOUT', 'MALFORMED_RESPONSE', 'SCANNER_ERROR', 'UNKNOWN_SIGNATURES', 'STALE_SIGNATURES', 'SIGNATURES_CHANGED', 'SCANNER_FAILED',
]));
export const QUEUE_DEFAULTS = Object.freeze({
  batchSize: 50,
  newShare: 0.5,
  maxAttempts: 6,
  backoffBaseMinutes: 15,
  backoffCapMinutes: 24 * 60,
  leaseMinutes: 15,
  backlogMaxAgeMinutes: 120,
});
const SCANNABLE_NEW = ['NOT_SCANNED', 'PENDING'];

export const attemptId = (applicationId, checksumSha256) => `${applicationId}:${checksumSha256}`;

export function backoffMinutes(attempts, { backoffBaseMinutes, backoffCapMinutes }) {
  return Math.min(backoffCapMinutes, backoffBaseMinutes * 2 ** Math.max(0, attempts - 1));
}

async function due(attempts, id, now) {
  const doc = await attempts.findOne({ _id: id });
  if (!doc) return true;
  if (doc.resolved || doc.exhausted) return false;
  if (doc.leaseUntil && doc.leaseUntil > now) return false;
  return !doc.nextAttemptAt || doc.nextAttemptAt <= now;
}

/** Picks the batch (no writes). */
export async function selectBatch({ applications, attempts, now, options }) {
  const o = { ...QUEUE_DEFAULTS, ...options };
  const newQuota = Math.max(1, Math.ceil(o.batchSize * o.newShare));
  const picked = [];
  const seen = new Set();
  const take = (app, kind) => {
    seen.add(String(app._id));
    picked.push({ kind, applicationId: String(app._id), storageKey: app.resume.storageKey, checksumSha256: app.resume.checksumSha256 });
  };
  async function takeNew(limit) {
    if (limit <= 0) return;
    const cursor = applications.find({ 'resume.scanStatus': { $in: SCANNABLE_NEW } }, { projection: { resume: 1 } }).sort({ 'resume.storedAt': 1, _id: 1 });
    let n = 0;
    for await (const app of cursor) {
      if (n >= limit) break;
      if (seen.has(String(app._id))) continue;
      if (!(await due(attempts, attemptId(app._id, app.resume.checksumSha256), now))) continue;
      take(app, 'new');
      n += 1;
    }
  }
  await takeNew(newQuota);

  // Due retries: recorded attempts first (earliest due), then FAILED résumés that have no attempts record.
  let room = o.batchSize - picked.length;
  if (room > 0) {
    const cursor = attempts.find({ resolved: { $ne: true }, exhausted: { $ne: true }, nextAttemptAt: { $lte: now }, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] }).sort({ nextAttemptAt: 1, _id: 1 });
    for await (const a of cursor) {
      if (room <= 0) break;
      if (seen.has(String(a.applicationId))) continue;
      const app = await applications.findOne({ _id: a.applicationId, 'resume.scanStatus': 'FAILED', 'resume.checksumSha256': a.checksumSha256, 'resume.storageKey': a.storageKey }, { projection: { resume: 1 } });
      if (!app) continue; // the record moved on (another version, decided, deleted)
      take(app, 'retry');
      room -= 1;
    }
  }
  if (room > 0) {
    const cursor = applications.find({ 'resume.scanStatus': 'FAILED' }, { projection: { resume: 1 } }).sort({ 'resume.storedAt': 1, _id: 1 });
    for await (const app of cursor) {
      if (room <= 0) break;
      if (seen.has(String(app._id))) continue;
      if (await attempts.countDocuments({ _id: attemptId(app._id, app.resume.checksumSha256) }, { limit: 1 })) continue;
      take(app, 'retry');
      room -= 1;
    }
  }
  // Unused retry capacity goes back to new work.
  await takeNew(o.batchSize - picked.length);
  return picked;
}

/** Claims one item for this worker (conditional). Returns false when another worker holds it or it is not due. */
export async function claim({ attempts, item, now, owner, leaseMinutes }) {
  const _id = attemptId(item.applicationId, item.checksumSha256);
  const leaseUntil = new Date(now.getTime() + leaseMinutes * 60_000);
  try {
    await attempts.insertOne({
      _id, applicationId: new mongoose.Types.ObjectId(item.applicationId), storageKey: item.storageKey, checksumSha256: item.checksumSha256,
      attempts: 0, infraFailures: 0, lastAttemptAt: null, nextAttemptAt: now, lastFailure: null, exhausted: false, resolved: false, leaseUntil, leaseOwner: owner,
    });
    return true;
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  const r = await attempts.updateOne(
    { _id, resolved: { $ne: true }, exhausted: { $ne: true }, nextAttemptAt: { $lte: now }, $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] },
    { $set: { leaseUntil, leaseOwner: owner } },
  );
  return r.modifiedCount === 1;
}

/**
 * One worker run: select, claim, scan, record. Returns counts only.
 * @returns {{ selected, claimed, claimedElsewhere, clean, quarantined, failed, failures, exhaustedNow, notRecorded, circuitOpen, newSelected, retrySelected }}
 */
export async function runScanBatch({ applications, attempts, storage, scanner, now = () => new Date(), options = {}, owner = randomBytes(8).toString('hex') }) {
  const o = { ...QUEUE_DEFAULTS, ...options };
  const runNow = now();
  const batch = await selectBatch({ applications, attempts, now: runNow, options: o });
  const s = { selected: batch.length, newSelected: batch.filter((b) => b.kind === 'new').length, retrySelected: batch.filter((b) => b.kind === 'retry').length, claimed: 0, claimedElsewhere: 0, clean: 0, quarantined: 0, failed: 0, failures: {}, exhaustedNow: 0, notRecorded: {}, circuitOpen: false };
  for (const item of batch) {
    const t = now();
    if (!(await claim({ attempts, item, now: t, owner, leaseMinutes: o.leaseMinutes }))) {
      s.claimedElsewhere += 1;
      continue;
    }
    s.claimed += 1;
    const _id = attemptId(item.applicationId, item.checksumSha256);
    const result = await scanApplicationResume({ applications, storage, scanner, applicationId: item.applicationId, now });
    const release = { leaseUntil: null, leaseOwner: null, lastAttemptAt: t };
    if (!result.recorded) {
      s.notRecorded[result.reason] = (s.notRecorded[result.reason] ?? 0) + 1;
      await attempts.updateOne({ _id, leaseOwner: owner }, { $set: { leaseUntil: null, leaseOwner: null } });
      continue;
    }
    if (result.scanStatus === 'CLEAN' || result.scanStatus === 'QUARANTINED') {
      s[result.scanStatus === 'CLEAN' ? 'clean' : 'quarantined'] += 1;
      await attempts.updateOne({ _id, leaseOwner: owner }, { $set: { ...release, resolved: true, outcome: result.scanStatus } });
      continue;
    }
    s.failed += 1;
    const reason = result.failure ?? 'UNKNOWN';
    s.failures[reason] = (s.failures[reason] ?? 0) + 1;
    const current = await attempts.findOne({ _id });
    if (SCANNER_INFRA_FAILURES.has(reason)) {
      const infraFailures = (current?.infraFailures ?? 0) + 1;
      const exhausted = infraFailures >= 2 * o.maxAttempts;
      if (exhausted) s.exhaustedNow += 1;
      await attempts.updateOne({ _id, leaseOwner: owner }, { $set: { ...release, infraFailures, lastFailure: reason, exhausted, nextAttemptAt: new Date(t.getTime() + o.backoffBaseMinutes * 60_000) } });
      s.circuitOpen = true; // the scanner itself is failing: stop, do not spend the other files' attempts
      break;
    }
    const n = (current?.attempts ?? 0) + 1;
    const exhausted = n >= o.maxAttempts;
    if (exhausted) s.exhaustedNow += 1;
    await attempts.updateOne({ _id, leaseOwner: owner }, { $set: { ...release, attempts: n, lastFailure: reason, exhausted, nextAttemptAt: new Date(t.getTime() + backoffMinutes(n, o) * 60_000) } });
  }
  return s;
}

/**
 * Backlog metrics (no writes, counts only) and the alert decision:
 * alert when the oldest unscanned résumé is older than backlogMaxAgeMinutes,
 * or when any résumé is exhausted (held FAILED with no further automatic retry).
 */
export async function backlog({ applications, attempts, now, options = {} }) {
  const o = { ...QUEUE_DEFAULTS, ...options };
  const unscanned = await applications.countDocuments({ 'resume.scanStatus': { $in: SCANNABLE_NEW } });
  const [oldest] = await applications.find({ 'resume.scanStatus': { $in: SCANNABLE_NEW } }, { projection: { 'resume.storedAt': 1 } }).sort({ 'resume.storedAt': 1 }).limit(1).toArray();
  const failedHeld = await applications.countDocuments({ 'resume.scanStatus': 'FAILED' });
  const exhaustedIds = await attempts.find({ exhausted: true, resolved: { $ne: true } }, { projection: { applicationId: 1, checksumSha256: 1 } }).toArray();
  let exhausted = 0;
  for (const a of exhaustedIds) {
    // Count only exhausted attempts whose record still holds that FAILED version.
    if (await applications.countDocuments({ _id: a.applicationId, 'resume.scanStatus': 'FAILED', 'resume.checksumSha256': a.checksumSha256 }, { limit: 1 })) exhausted += 1;
  }
  const dueRetries = await attempts.countDocuments({ resolved: { $ne: true }, exhausted: { $ne: true }, nextAttemptAt: { $lte: now } });
  const oldestUnscannedMinutes = oldest?.resume?.storedAt ? Math.floor((now.getTime() - oldest.resume.storedAt.getTime()) / 60_000) : null;
  const reasons = [];
  if (oldestUnscannedMinutes !== null && oldestUnscannedMinutes > o.backlogMaxAgeMinutes) reasons.push('UNSCANNED_TOO_OLD');
  if (exhausted > 0) reasons.push('EXHAUSTED_HELD');
  return { unscanned, oldestUnscannedMinutes, failedHeld, exhausted, dueRetries, alert: reasons.length > 0, reasons };
}
