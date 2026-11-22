import { constants as FS, promises as fsp } from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { ADMIN_POLICY } from '../../config/adminAuth.js';
import { Admin } from '../../models/Admin.js';
import { AuditEvent } from '../../models/AuditEvent.js';
import { normalizeEmail } from '../../models/Application.js';
import { RESTORE_AUTHORIZATION_COLLECTION } from '../../ops/backup/restoreTarget.js';
import { createAuditWriter } from './audit.js';
import { randomToken, sha256Hex } from './auth/secrets.js';

/**
 * D-3 (owner, 2026-11-22; correction 1) — the Recruitment Admin and database identity.
 *
 * A Flex snapshot is up to 24 h old: restoring it can undo Admin revocations made
 * after it, and those cannot be proven from the snapshot. The Admin therefore
 * opens ONLY on the database it is bound to:
 *
 *   identity            { setName, database } of the connection: the replica-set name
 *                       the server itself reports (`hello`) and the database name.
 *   ADMIN_DATABASE_REPLICA_SET   the configured cluster identity; required for the
 *                       Admin to start (config/adminAuth.js).
 *   database_identity   the live anchor { _id: 'live', setName, database }, written
 *                       ONCE at provisioning by the owner (`npm run db:identity:init`),
 *                       insert-only, never by the API. Every snapshot carries it, so
 *                       a restore into another cluster or database carries an anchor
 *                       that no longer matches its own identity.
 *
 * adminStartupGate(db, { expectedReplicaSet }) is OPEN when:
 *   - the connection's set name equals the configured one, AND
 *   - either the anchor names exactly this identity (the intended live database), or
 *     this database holds a restore authorisation bound to THIS identity AND a
 *     REBASELINED completion marker bound to that authorisation and THIS identity.
 * Otherwise CLOSED: a fresh unmarked restore (inherited anchor, no own marker), a
 * restore carrying an OLDER marker (bound to another cluster or database), an
 * unprovisioned database, a configuration mismatch, or any read error.
 *
 * rebaselineAdmins(...) — the owner's re-baseline after RECOVERY VERIFIED
 * (mongo-recovery.mjs restore-rebaseline). The activation link is delivered
 * privately and durably BEFORE any Admin write, the attempt is claimed atomically,
 * and the completion marker is published LAST:
 *
 *   1. deliver   the link is written to the owner's file: exclusive create (0600,
 *                no symlink, never overwritten) in a directory only the owner can
 *                write, fsync'd, renamed into place by a hard link, directory fsync'd.
 *                Any failure: nothing in the database changed.
 *   2. claim     admin_restore_state { _id: targetId, state: PENDING, attempt, epoch,
 *                tokenHash, ownerAdminId, adminIds, sessionIds, runner, runLeaseUntil }
 *                by insert: of concurrent attempts exactly one wins; a loser removes its
 *                own file and writes nothing else. adminIds and sessionIds are the
 *                restored ones: nothing created later is ever revoked by this restore.
 *   3. revoke    those Admins DISABLED, authVersion + 1, credentials cleared; those
 *                sessions removed — under THIS restore's fence (restoreFence
 *                { targetId, epoch }), so a stale run cannot touch them again.
 *   4. arm       the claim's owner re-enabled with the claim's token hash, same fence.
 *   5. publish   PENDING -> REBASELINED, only by the run holding the claim at its epoch.
 * Every run (original, resume, restart) takes an exclusive run lease and a new epoch:
 * one active run at a time, and a run whose lease lapsed is fenced out (correction 2).
 *
 * Interrupted after 2: run again with the SAME link file — the delivered link and
 * attempt are read back from it (and checked against the claim), and steps 3-5
 * complete with the SAME link. If that file is lost, the owner may name the stale
 * attempt with --restart-pending once its lease has expired: a new link replaces it
 * under a higher epoch. While the marker is unpublished the Admin stays closed, so
 * an undelivered or superseded link cannot be used.
 */
export const ADMIN_RESTORE_STATE_COLLECTION = 'admin_restore_state';
export const DATABASE_IDENTITY_COLLECTION = 'database_identity';
export const LIVE_ANCHOR_ID = 'live';
export const REBASELINED = 'REBASELINED';
export const PENDING = 'PENDING';
export const STANDALONE = 'standalone';
/** A pending claim may be restarted (a new link) only this long after it was made (an interrupted attempt). */
export const PENDING_LEASE_MS = 15 * 60_000;
/** One run at a time: the original attempt, a resume or a restart holds the claim this long; after it, another run may take over. */
export const RUN_LEASE_MS = 5 * 60_000;
const WRITE_CONCERN = Object.freeze({ w: 'majority', j: true });
const LINK_MARKER = '# valida restore-rebaseline';

export class AdminRestoreRefused extends Error {
  constructor(reason, detail = {}) {
    super(`admin re-baseline refused: ${reason}`);
    this.name = 'AdminRestoreRefused';
    this.reason = reason;
    this.detail = detail;
  }
}

/** The identity of a connected database: the set name the server reports, and the database name. */
export async function databaseIdentity(db) {
  const hello = await db.admin().command({ hello: 1 });
  return { setName: hello.setName ?? STANDALONE, database: db.databaseName };
}
const sameIdentity = (a, b) => Boolean(a && b) && a.setName === b.setName && a.database === b.database;

/**
 * @returns {Promise<{ open: true, basis: 'LIVE_ANCHOR'|'REBASELINED', identity } | { open: false, reason: string }>}
 * Never throws: a failed read is a closed gate.
 */
export async function adminStartupGate(db, { expectedReplicaSet } = {}) {
  if (typeof expectedReplicaSet !== 'string' || expectedReplicaSet === '') return { open: false, reason: 'ADMIN_DATABASE_IDENTITY_NOT_CONFIGURED' };
  try {
    const identity = await databaseIdentity(db);
    if (identity.setName !== expectedReplicaSet) return { open: false, reason: 'ADMIN_DATABASE_IDENTITY_MISMATCH' };
    const anchor = await db.collection(DATABASE_IDENTITY_COLLECTION).findOne({ _id: LIVE_ANCHOR_ID });
    if (sameIdentity(anchor, identity)) return { open: true, basis: 'LIVE_ANCHOR', identity };
    // Not the intended live database: open only through ITS OWN completed recovery.
    const own = await db.collection(RESTORE_AUTHORIZATION_COLLECTION).find({ setName: identity.setName, database: identity.database }, { limit: 10 }).toArray();
    for (const { targetId } of own) {
      if (typeof targetId !== 'string' || targetId === '') continue;
      const mark = await db.collection(ADMIN_RESTORE_STATE_COLLECTION).findOne({ _id: targetId, state: REBASELINED, setName: identity.setName, database: identity.database });
      if (mark) return { open: true, basis: REBASELINED, identity };
    }
    return { open: false, reason: anchor ? 'ADMIN_RESTORE_NOT_REBASELINED' : 'ADMIN_DATABASE_NOT_PROVISIONED' };
  } catch {
    return { open: false, reason: 'ADMIN_RESTORE_STATE_UNREADABLE' };
  }
}

/** Provisioning (owner): records the live anchor once. Refuses a database that already carries another identity. */
export async function initLiveAnchor(db, { clock = () => new Date() } = {}) {
  const identity = await databaseIdentity(db);
  const anchors = db.collection(DATABASE_IDENTITY_COLLECTION);
  const existing = await anchors.findOne({ _id: LIVE_ANCHOR_ID });
  if (existing) {
    if (sameIdentity(existing, identity)) return { created: false, identity };
    throw new AdminRestoreRefused('ANCHOR_OF_ANOTHER_DATABASE');
  }
  await anchors.insertOne({ _id: LIVE_ANCHOR_ID, ...identity, recordedAt: clock() }, { writeConcern: WRITE_CONCERN });
  return { created: true, identity };
}

/* ------------------------------------------------------- private delivery -- */

const linkText = ({ appOrigin, token, attempt, targetId }) => `${appOrigin}/admin/activate#token=${token}\n${LINK_MARKER} target=${targetId} attempt=${attempt}\n`;

function parseLink(text, targetId) {
  const match = /^(https?:\/\/[^\s#]+)\/admin\/activate#token=([A-Za-z0-9_-]{20,})\n# valida restore-rebaseline target=([0-9a-f]{32}) attempt=([A-Za-z0-9_-]{16,})\n$/.exec(text);
  if (!match || match[3] !== targetId) return null;
  return { token: match[2], attempt: match[4] };
}

/** The directory must be a real directory that only this user can write (no shared /tmp). */
async function assertPrivateDirectory(dir, fs) {
  let st;
  try {
    st = await fs.lstat(dir);
  } catch {
    throw new AdminRestoreRefused('DELIVERY_DIRECTORY_MISSING');
  }
  if (!st.isDirectory()) throw new AdminRestoreRefused('DELIVERY_DIRECTORY_UNSAFE');
  if (process.platform !== 'win32' && ((st.mode & 0o022) !== 0 || (typeof process.getuid === 'function' && st.uid !== process.getuid()))) {
    throw new AdminRestoreRefused('DELIVERY_DIRECTORY_UNSAFE');
  }
}

/**
 * Writes `text` to `file` privately and durably, or not at all. Never overwrites: if `file`
 * exists the delivery is refused (LINK_FILE_EXISTS) before anything is written.
 */
export async function deliverPrivately(file, text, { fs = fsp } = {}) {
  const dir = path.dirname(path.resolve(file));
  await assertPrivateDirectory(dir, fs);
  if (await fs.lstat(file).then(() => true, () => false)) throw new AdminRestoreRefused('LINK_FILE_EXISTS');
  const tmp = path.join(dir, `.${path.basename(file)}.${randomToken(8)}.tmp`);
  let linked = false;
  try {
    const handle = await fs.open(tmp, FS.O_WRONLY | FS.O_CREAT | FS.O_EXCL | (FS.O_NOFOLLOW ?? 0), 0o600);
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.link(tmp, file); // atomic, and fails if `file` appeared meanwhile: never overwrites
    } catch (error) {
      if (error?.code === 'EEXIST') throw new AdminRestoreRefused('LINK_FILE_EXISTS');
      throw error;
    }
    linked = true;
    await fs.unlink(tmp);
    if (process.platform !== 'win32') {
      const dirHandle = await fs.open(dir, FS.O_RDONLY);
      try {
        await dirHandle.sync();
      } finally {
        await dirHandle.close();
      }
    }
  } catch (error) {
    await fs.unlink(tmp).catch(() => {});
    if (linked) await fs.unlink(file).catch(() => {}); // not durable: not delivered
    if (error instanceof AdminRestoreRefused) throw error;
    throw new AdminRestoreRefused('DELIVERY_FAILED');
  }
}

/** Reads back a delivered link: a regular, private file (no symlink) for this target, or null. */
async function readDelivered(file, targetId, fs) {
  try {
    const st = await fs.lstat(file);
    if (!st.isFile()) return null;
    if (process.platform !== 'win32' && ((st.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && st.uid !== process.getuid()))) return null;
    return parseLink(await fs.readFile(file, 'utf8'), targetId);
  } catch {
    return null;
  }
}

/** Removes a file only if it holds exactly this attempt's link (a loser cleans up its own delivery, nothing else). */
async function removeOwnDelivery(file, targetId, attempt, fs) {
  const delivered = await readDelivered(file, targetId, fs);
  if (delivered?.attempt === attempt) await fs.unlink(file).catch(() => {});
}

/* ------------------------------------------------------------ re-baseline -- */

const REVOKE_ALL = Object.freeze({
  status: 'DISABLED',
  'authentication.passwordHash': null,
  'authentication.passwordChangedAt': null,
  'authentication.emailVerifiedAt': null,
  'authentication.activationTokenHash': null,
  'authentication.activationExpiresAt': null,
  'authentication.resetTokenHash': null,
  'authentication.resetTokenExpiresAt': null,
  'authentication.failedLoginCount': 0,
  'authentication.lastFailedLoginAt': null,
  'authentication.lockedUntil': null,
  'mfa.enabled': false,
  'mfa.method': null,
  'mfa.secretCiphertext': null,
  'mfa.encryptionKeyId': null,
  'mfa.enrolledAt': null,
  'mfa.lastUsedTimeStep': null,
  'mfa.recoveryCodes': [],
  'mfa.pendingSecretCiphertext': null,
  'mfa.pendingEncryptionKeyId': null,
  'mfa.pendingExpiresAt': null,
});

/** The fence of one restore: only a fence of THIS restore, at this epoch or later, protects a document. */
const fenceFor = (targetId, epoch) => ({ $or: [{ 'authentication.restoreFence.targetId': { $ne: targetId } }, { 'authentication.restoreFence.epoch': { $lte: epoch } }] });

/**
 * Runs on the default Mongoose connection, which the caller points at the RESTORED
 * database with an owner credential for that cluster only.
 *
 * Correction 2 (review of a861476):
 *   - ONE active run: the original attempt and every resume or restart take an exclusive
 *     run lease on the claim and a NEW epoch. A worker whose lease lapsed is stale: every
 *     write it could still make is fenced out by the newer epoch.
 *   - Scoped revocation: only the Admins and sessions that existed when the claim was made
 *     (the restored ones, recorded in the claim) are revoked or removed, and only under a
 *     fence of THIS restore. A fence left by another restore (an older restoreFence, or the
 *     legacy restoreEpoch field) protects nothing; an Admin or session created after the
 *     recovery (owner sign-in, a new invitation) is never touched by a late worker.
 *   - Bound owner: a resume or restart re-arms only the owner recorded in the original claim.
 *
 * @param {object} o
 * @param {string} o.targetId        the restore target id (the `prepare-target` authorisation)
 * @param {string} o.ownerEmail      the one owner to re-enable (a resume must name the SAME owner)
 * @param {string} o.linkFile        the owner's private file for the activation link
 * @param {string} o.appOrigin       the origin that serves /admin
 * @param {string} [o.restartPending] the stale attempt id the owner deliberately replaces
 * @param {() => Date} [o.clock]
 * @param {object} [o.fs]            test seam (node:fs/promises shape)
 * @param {object} [o.hooks]         test seam: { afterClaim, afterRevoke, afterArm } (interruption points)
 * @param {object} [o.connection]    the Mongoose connection to the restored database (default: the default connection)
 */
export async function rebaselineAdmins({ targetId, ownerEmail, linkFile, appOrigin, restartPending = null, clock = () => new Date(), fs = fsp, hooks = {}, connection = mongoose.connection }) {
  const db = connection.db;
  const AdminModel = connection === mongoose.connection ? Admin : connection.models.Admin ?? connection.model('Admin', Admin.schema, 'admins');
  const AuditModel = connection === mongoose.connection ? AuditEvent : connection.models.AuditEvent ?? connection.model('AuditEvent', AuditEvent.schema, 'audit_events');
  if (typeof targetId !== 'string' || !/^[0-9a-f]{32}$/.test(targetId)) throw new AdminRestoreRefused('TARGET_ID_INVALID');
  if (typeof linkFile !== 'string' || linkFile === '') throw new AdminRestoreRefused('LINK_FILE_REQUIRED');
  const identity = await databaseIdentity(db);
  const authorisation = await db.collection(RESTORE_AUTHORIZATION_COLLECTION).findOne({ targetId });
  if (!authorisation) throw new AdminRestoreRefused('NOT_A_RESTORE_TARGET');
  if (!sameIdentity(authorisation, identity)) throw new AdminRestoreRefused('AUTHORISATION_FOR_OTHER_DATABASE');
  const state = db.collection(ADMIN_RESTORE_STATE_COLLECTION);
  const existing = await state.findOne({ _id: targetId });
  if (existing?.state === REBASELINED) throw new AdminRestoreRefused('ALREADY_REBASELINED');
  const owner = await AdminModel.findOne({ emailNormalized: normalizeEmail(ownerEmail ?? '') });
  if (!owner || !owner.roles.includes('ADMIN_OWNER')) throw new AdminRestoreRefused('OWNER_NOT_FOUND');
  // A resume or restart is bound to the owner of the ORIGINAL claim.
  if (existing && String(existing.ownerAdminId) !== String(owner._id)) throw new AdminRestoreRefused('OWNER_MISMATCH');

  const runner = randomToken(12);
  const leaseFrom = (t) => new Date(t.getTime() + RUN_LEASE_MS);
  let claim;
  let resumed = false;
  if (existing?.state === PENDING) {
    const delivered = await readDelivered(linkFile, targetId, fs);
    const now = clock();
    if (delivered && delivered.attempt === existing.attempt && sha256Hex(delivered.token) === existing.tokenHash) {
      // Resume with the SAME delivered link — only when no other run holds the lease (one active resume).
      claim = await state.findOneAndUpdate(
        { _id: targetId, state: PENDING, attempt: existing.attempt, tokenHash: existing.tokenHash, runLeaseUntil: { $lte: now } },
        { $set: { runner, runLeaseUntil: leaseFrom(now) }, $inc: { epoch: 1 } },
        { returnDocument: 'after', writeConcern: WRITE_CONCERN },
      );
      if (!claim) throw new AdminRestoreRefused('REBASELINE_IN_PROGRESS', { pendingAttempt: existing.attempt });
      resumed = true;
    } else if (restartPending && restartPending === existing.attempt) {
      if (now.getTime() - new Date(existing.claimedAt).getTime() < PENDING_LEASE_MS || new Date(existing.runLeaseUntil).getTime() > now.getTime()) {
        throw new AdminRestoreRefused('REBASELINE_IN_PROGRESS', { pendingAttempt: existing.attempt });
      }
      const attempt = randomToken(16);
      const token = randomToken(32);
      await deliverPrivately(linkFile, linkText({ appOrigin, token, attempt, targetId }), { fs });
      claim = await state.findOneAndUpdate(
        { _id: targetId, state: PENDING, attempt: existing.attempt, epoch: existing.epoch, runLeaseUntil: { $lte: now } },
        { $set: { attempt, tokenHash: sha256Hex(token), claimedAt: now, runner, runLeaseUntil: leaseFrom(now) }, $inc: { epoch: 1 } },
        { returnDocument: 'after', writeConcern: WRITE_CONCERN },
      );
      if (!claim) {
        await removeOwnDelivery(linkFile, targetId, attempt, fs);
        throw new AdminRestoreRefused('REBASELINE_IN_PROGRESS');
      }
    } else {
      throw new AdminRestoreRefused('REBASELINE_IN_PROGRESS', { pendingAttempt: existing.attempt });
    }
  } else {
    const attempt = randomToken(16);
    const token = randomToken(32);
    // 1. Private, durable delivery BEFORE anything changes in the database.
    await deliverPrivately(linkFile, linkText({ appOrigin, token, attempt, targetId }), { fs });
    // 2. The claim, recording exactly what this restore revokes: the Admins and sessions restored with it.
    const now = clock();
    const adminIds = (await AdminModel.collection.find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
    const sessionIds = (await db.collection('admin_sessions').find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id);
    claim = { _id: targetId, state: PENDING, attempt, epoch: 1, tokenHash: sha256Hex(token), setName: identity.setName, database: identity.database, ownerAdminId: owner._id, adminIds, sessionIds, claimedAt: now, runner, runLeaseUntil: leaseFrom(now) };
    try {
      await state.insertOne(claim, { writeConcern: WRITE_CONCERN });
    } catch (error) {
      await removeOwnDelivery(linkFile, targetId, attempt, fs);
      if (error?.code === 11000) throw new AdminRestoreRefused('REBASELINE_IN_PROGRESS');
      throw error;
    }
  }
  await hooks.afterClaim?.();
  const mine = { _id: targetId, state: PENDING, attempt: claim.attempt, epoch: claim.epoch, runner };
  const stillMine = async () => {
    if (!(await state.findOne(mine))) throw new AdminRestoreRefused('REBASELINE_SUPERSEDED');
  };

  // 3. The restored Admins revoked under THIS restore's fence; then the restored sessions removed.
  const now = clock();
  const fence = fenceFor(targetId, claim.epoch);
  const stamp = { 'authentication.restoreFence': { targetId, epoch: claim.epoch } };
  const revoked = await AdminModel.collection.updateMany(
    { _id: { $in: claim.adminIds }, ...fence },
    { $set: { ...REVOKE_ALL, ...stamp, updatedAt: now }, $inc: { 'authentication.authVersion': 1 } },
    { writeConcern: WRITE_CONCERN },
  );
  await stillMine();
  const sessions = await db.collection('admin_sessions').deleteMany({ _id: { $in: claim.sessionIds } }, { writeConcern: WRITE_CONCERN });
  await hooks.afterRevoke?.();

  // 4. The claim's owner armed with the claim's token, under the same fence.
  await stillMine();
  const activationExpiresAt = new Date(now.getTime() + ADMIN_POLICY.activationLifetimeMs);
  const armed = await AdminModel.collection.updateOne(
    { _id: claim.ownerAdminId, ...fence },
    { $set: { status: 'ACTIVE', 'authentication.activationTokenHash': claim.tokenHash, 'authentication.activationExpiresAt': activationExpiresAt, ...stamp, updatedAt: now } },
    { writeConcern: WRITE_CONCERN },
  );
  if (armed.matchedCount !== 1) throw new AdminRestoreRefused('REBASELINE_SUPERSEDED');
  await hooks.afterArm?.();

  // 5. LAST, and only by the run that still holds the claim at this epoch.
  const result = { ownerAdminId: String(claim.ownerAdminId), adminsDisabled: revoked.modifiedCount, sessionsRemoved: sessions.deletedCount, attempt: claim.attempt, epoch: claim.epoch, resumed };
  const published = await state.updateOne(mine, { $set: { state: REBASELINED, rebaselinedAt: clock(), adminsDisabled: result.adminsDisabled, sessionsRemoved: result.sessionsRemoved } }, { writeConcern: WRITE_CONCERN });
  if (published.matchedCount !== 1) throw new AdminRestoreRefused('REBASELINE_SUPERSEDED');
  await createAuditWriter({ model: AuditModel, clock }).record({
    actor: { type: 'SYSTEM' },
    action: 'ADMIN_RESTORE_REBASELINED',
    resource: { type: 'ADMIN', id: claim.ownerAdminId },
    // Only allowlisted keys (audit.js): the outcome and the number of Admins revoked.
    metadata: { outcome: REBASELINED, count: result.adminsDisabled },
  });
  return { activationExpiresAt, ...result };
}
