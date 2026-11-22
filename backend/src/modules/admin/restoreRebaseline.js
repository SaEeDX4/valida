import mongoose from 'mongoose';
import { ADMIN_POLICY } from '../../config/adminAuth.js';
import { Admin } from '../../models/Admin.js';
import { normalizeEmail } from '../../models/Application.js';
import { RESTORE_AUTHORIZATION_COLLECTION } from '../../ops/backup/restoreTarget.js';
import { createAuditWriter } from './audit.js';
import { randomToken, sha256Hex } from './auth/secrets.js';

/**
 * D-3 (owner, 2026-11-22) — the Recruitment Admin on a RESTORED database.
 *
 * A Flex snapshot is up to 24 h old. Restoring it can undo any Admin revocation
 * made after it: a disabled Admin, a removed role, a reset password or MFA, a
 * revoked session. Those revocations cannot be proven from the snapshot, so the
 * Admin on a restored database is CLOSED until it is re-baselined:
 *
 *   adminRestoreGate(db)   any `restore_authorization` document (written only by
 *                          `prepare-target`, so present on every restore target and
 *                          never on the original live database) closes the Admin
 *                          unless `admin_restore_state` holds a REBASELINED mark for
 *                          that restore target. server.js refuses to start with
 *                          ADMIN_AUTH=enabled while the gate is closed, and a read
 *                          error closes it too (fail closed).
 *
 *   rebaselineAdmins(...)  run by the owner through `mongo-recovery.mjs
 *                          restore-rebaseline`, ONLY after the applicant-deletion
 *                          gate has returned RECOVERY VERIFIED for the same target.
 *                          Every restored Admin is treated as revoked: DISABLED,
 *                          authVersion + 1, password, activation and reset tokens,
 *                          MFA secret, pending enrolment and recovery codes cleared;
 *                          every Admin session removed. Then exactly ONE named owner
 *                          is re-enabled with no password and a fresh one-time
 *                          activation (8 h): the owner sets a new password and enrols
 *                          a new MFA secret. Other Admins stay DISABLED until the owner
 *                          re-invites them. The REBASELINED mark is written LAST: an
 *                          interrupted run leaves the Admin closed, and is safe to run
 *                          again (every step is idempotent; a new token replaces the old).
 *
 * The live-comparison route (proving post-snapshot revocations from the former
 * live cluster) is not implemented: until it is, a restored database reopens
 * its Admin only through re-baselining.
 */
export const ADMIN_RESTORE_STATE_COLLECTION = 'admin_restore_state';
export const REBASELINED = 'REBASELINED';
const WRITE_CONCERN = Object.freeze({ w: 'majority', j: true });

export class AdminRestoreRefused extends Error {
  constructor(reason) {
    super(`admin re-baseline refused: ${reason}`);
    this.name = 'AdminRestoreRefused';
    this.reason = reason;
  }
}

/**
 * @returns {Promise<{ open: true, restored: boolean } | { open: false, reason: string }>}
 * Never throws: a failed read is a closed gate.
 */
export async function adminRestoreGate(db) {
  try {
    const authorisations = await db.collection(RESTORE_AUTHORIZATION_COLLECTION).find({}, { projection: { targetId: 1 }, limit: 10 }).toArray();
    if (authorisations.length === 0) return { open: true, restored: false };
    for (const { targetId } of authorisations) {
      if (typeof targetId !== 'string' || targetId === '') return { open: false, reason: 'ADMIN_RESTORE_UNIDENTIFIED' };
      const mark = await db.collection(ADMIN_RESTORE_STATE_COLLECTION).findOne({ _id: targetId, state: REBASELINED });
      if (!mark) return { open: false, reason: 'ADMIN_RESTORE_NOT_REBASELINED' };
    }
    return { open: true, restored: true };
  } catch {
    return { open: false, reason: 'ADMIN_RESTORE_STATE_UNREADABLE' };
  }
}

/** Every credential and pending state an Admin can hold, cleared. */
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

/**
 * Runs on the default Mongoose connection, which the caller points at the
 * RESTORED database with an owner credential for that cluster only.
 *
 * @param {object} o
 * @param {string} o.targetId       the restore target id (the `prepare-target` authorisation)
 * @param {string} o.ownerEmail     the one owner to re-enable
 * @param {() => Date} [o.clock]
 * @param {(mark: object) => Promise<void>} [o.writeMark]  test seam: the last step
 * @returns {Promise<{ token, ownerAdminId, adminsDisabled, sessionsRemoved, activationExpiresAt }>}
 */
export async function rebaselineAdmins({ targetId, ownerEmail, clock = () => new Date(), writeMark }) {
  const db = mongoose.connection.db;
  if (typeof targetId !== 'string' || !/^[0-9a-f]{32}$/.test(targetId)) throw new AdminRestoreRefused('TARGET_ID_INVALID');
  if (!(await db.collection(RESTORE_AUTHORIZATION_COLLECTION).findOne({ targetId }))) throw new AdminRestoreRefused('NOT_A_RESTORE_TARGET');
  const state = db.collection(ADMIN_RESTORE_STATE_COLLECTION);
  if (await state.findOne({ _id: targetId, state: REBASELINED })) throw new AdminRestoreRefused('ALREADY_REBASELINED');
  const owner = await Admin.findOne({ emailNormalized: normalizeEmail(ownerEmail ?? '') });
  if (!owner || !owner.roles.includes('ADMIN_OWNER')) throw new AdminRestoreRefused('OWNER_NOT_FOUND');

  const now = clock();
  const revoked = await Admin.collection.updateMany({}, { $set: { ...REVOKE_ALL, updatedAt: now }, $inc: { 'authentication.authVersion': 1 } }, { writeConcern: WRITE_CONCERN });
  const sessions = await db.collection('admin_sessions').deleteMany({}, { writeConcern: WRITE_CONCERN });

  const token = randomToken(32);
  const activationExpiresAt = new Date(now.getTime() + ADMIN_POLICY.activationLifetimeMs);
  await Admin.collection.updateOne(
    { _id: owner._id },
    { $set: { status: 'ACTIVE', 'authentication.activationTokenHash': sha256Hex(token), 'authentication.activationExpiresAt': activationExpiresAt, updatedAt: now } },
    { writeConcern: WRITE_CONCERN },
  );
  const result = { ownerAdminId: String(owner._id), adminsDisabled: revoked.modifiedCount, sessionsRemoved: sessions.deletedCount };
  await createAuditWriter({ clock }).record({
    actor: { type: 'SYSTEM' },
    action: 'ADMIN_RESTORE_REBASELINED',
    resource: { type: 'ADMIN', id: owner._id },
    // Only allowlisted keys (audit.js): the outcome and the number of Admins revoked. The target id is in the mark.
    metadata: { outcome: REBASELINED, count: result.adminsDisabled },
  });

  // LAST: only now may the Admin surface start on this database.
  const mark = { _id: targetId, state: REBASELINED, ...result, rebaselinedAt: now };
  if (writeMark) await writeMark(mark);
  else await state.insertOne(mark, { writeConcern: WRITE_CONCERN });
  return { token, activationExpiresAt, ...result };
}
