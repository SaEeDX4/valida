import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { AppError, ERROR_CODES } from '../../errors/AppError.js';
import { successEnvelope } from '../../lib/envelope.js';
import { Admin, ADMIN_ROLES } from '../../models/Admin.js';
import { normalizeEmail, isSyntacticallyValidEmail } from '../../models/Application.js';
import { randomToken, sha256Hex } from './auth/secrets.js';
import { activationMessage } from './adminMail.js';
import { createAdminAccountOps } from './auth.routes.js';
import { requirePermission, requireRecentAuth } from './session.js';

/**
 * /api/v1/admin/admins — Admin account administration (Doc 11 s25-31, s146-158,
 * s206-208, s229-230). ADMIN_OWNER only (admins:* permissions), and every
 * change needs recent strong authentication (s136).
 *
 * No public signup (s25); no default password (s27): a new Admin receives a
 * one-time activation link at their own email (s28-32). Disabling replaces
 * deletion (s207). The last active owner cannot be disabled or demoted (s230).
 */

const fail = (status, code, message) => new AppError({ status, code, message });
const notFound = () => fail(404, 'ADMIN_NOT_FOUND', 'That account was not found.');

function parseBody(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (result.success) return result.data;
  throw new AppError({
    status: 400,
    code: ERROR_CODES.VALIDATION_FAILED,
    message: 'Some fields need attention.',
    fieldErrors: result.error.issues.map((issue) => ({ field: String(issue.path[0] ?? 'body'), code: 'INVALID', message: 'Check this field.' })),
  });
}

const rolesField = z.array(z.enum(ADMIN_ROLES)).min(1).max(2).refine((r) => new Set(r).size === r.length);

export function toAdminView(admin) {
  return {
    id: String(admin._id),
    email: admin.email,
    displayName: admin.displayName,
    status: admin.status,
    roles: admin.roles,
    activated: Boolean(admin.authentication?.emailVerifiedAt),
    activationPending: Boolean(!admin.authentication?.emailVerifiedAt && admin.authentication?.activationExpiresAt && admin.authentication.activationExpiresAt > new Date()),
    mfaEnabled: Boolean(admin.mfa?.enabled),
    lastLoginAt: admin.lastLoginAt ? admin.lastLoginAt.toISOString() : null,
    createdAt: admin.createdAt ? admin.createdAt.toISOString() : null,
  };
}

/**
 * Issues a one-time activation token and emails the link. Returns the delivery
 * outcome; the token itself is never returned by the API.
 */
export async function issueActivation({ admin, adminAuth, notifications, clock, model = Admin }) {
  const token = randomToken(32);
  await model.updateOne(
    { _id: admin._id },
    { $set: { 'authentication.activationTokenHash': sha256Hex(token), 'authentication.activationExpiresAt': new Date(clock().getTime() + adminAuth.policy.activationLifetimeMs) } },
  );
  if (!notifications?.configured) return { delivery: 'NOT_CONFIGURED', token };
  const message = activationMessage({ appOrigin: adminAuth.appOrigin, token, displayName: admin.displayName });
  const outcome = await notifications.deliverAdminMessage({ event: 'ADMIN_ACTIVATION', adminId: String(admin._id), to: admin.email, ...message, reference: sha256Hex(token).slice(0, 16) });
  return { delivery: outcome.status, token };
}

export function adminsRouter({ adminAuth, clock = () => new Date(), audit, notifications, logger, model = Admin }) {
  const router = express.Router();
  const ops = createAdminAccountOps({ clock, audit, notifications, logger });
  const recent = requireRecentAuth({ adminAuth, clock });
  const record = (req, action, targetId, metadata = {}) =>
    audit.record({ actor: { type: 'ADMIN', id: req.admin.id }, action, resource: { type: 'ADMIN', id: targetId }, requestId: req.id ?? null, metadata });

  async function loadTarget(id) {
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const admin = await model.findById(id);
    if (!admin) throw notFound();
    return admin;
  }

  async function assertNotLastOwner(target, { removingOwner }) {
    if (!removingOwner || !target.roles.includes('ADMIN_OWNER') || target.status !== 'ACTIVE') return;
    const owners = await model.countDocuments({ status: 'ACTIVE', roles: 'ADMIN_OWNER' });
    if (owners <= 1) throw fail(409, 'LAST_OWNER', 'Valida must keep at least one active owner. Add another owner first.');
  }

  router.get('/', requirePermission('admins:read'), async (req, res, next) => {
    try {
      const admins = await model.find({}).sort({ createdAt: 1 }).limit(200).lean();
      res.json(successEnvelope({ items: admins.map(toAdminView) }, req.id));
    } catch (error) {
      next(error);
    }
  });

  const createSchema = z.object({ email: z.string().trim().max(254).refine(isSyntacticallyValidEmail), displayName: z.string().trim().min(1).max(120), roles: rolesField }).strict();
  router.post('/', requirePermission('admins:create'), recent, async (req, res, next) => {
    try {
      // Roles come from the authorised owner's request body here, and only here; the
      // permission check above is the authority (s154, s229).
      const input = parseBody(createSchema, req.body);
      if (await model.exists({ emailNormalized: normalizeEmail(input.email) })) throw fail(409, 'ADMIN_EXISTS', 'An account with this email already exists.');
      const admin = new model({ email: input.email, displayName: input.displayName, roles: input.roles, status: 'ACTIVE', createdByAdminId: req.admin.id });
      try {
        await admin.save();
      } catch (error) {
        if (error?.code === 11000) throw fail(409, 'ADMIN_EXISTS', 'An account with this email already exists.');
        throw error;
      }
      const { delivery } = await issueActivation({ admin, adminAuth, notifications, clock, model });
      await record(req, 'ADMIN_ACCOUNT_CREATED', admin._id, { roles: input.roles });
      await record(req, 'ADMIN_ACTIVATION_ISSUED', admin._id, { outcome: delivery });
      res.status(201).json(successEnvelope({ admin: toAdminView(await model.findById(admin._id).lean()), activationDelivery: delivery }, req.id));
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/activation', requirePermission('admins:update'), recent, async (req, res, next) => {
    try {
      const admin = await loadTarget(req.params.id);
      if (admin.authentication.emailVerifiedAt) throw fail(409, 'ALREADY_ACTIVATED', 'This account is already activated.');
      if (admin.status !== 'ACTIVE') throw fail(409, 'ACCOUNT_DISABLED', 'Enable the account before sending an activation link.');
      const { delivery } = await issueActivation({ admin, adminAuth, notifications, clock, model });
      await record(req, 'ADMIN_ACTIVATION_ISSUED', admin._id, { outcome: delivery });
      res.json(successEnvelope({ activationDelivery: delivery }, req.id));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id/roles', requirePermission('admins:roles:update'), recent, async (req, res, next) => {
    try {
      const { roles } = parseBody(z.object({ roles: rolesField }).strict(), req.body);
      const admin = await loadTarget(req.params.id);
      await assertNotLastOwner(admin, { removingOwner: !roles.includes('ADMIN_OWNER') });
      const previousRoles = [...admin.roles];
      admin.roles = roles;
      admin.authentication.authVersion += 1; // s156
      await admin.save();
      await ops.revokeSessions(admin._id);
      await record(req, 'ADMIN_ROLE_CHANGED', admin._id, { roles, previousRoles });
      res.json(successEnvelope({ admin: toAdminView(admin) }, req.id));
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/disable', requirePermission('admins:disable'), recent, async (req, res, next) => {
    try {
      const admin = await loadTarget(req.params.id);
      if (admin.status === 'DISABLED') return res.json(successEnvelope({ admin: toAdminView(admin) }, req.id));
      await assertNotLastOwner(admin, { removingOwner: true });
      admin.status = 'DISABLED';
      admin.authentication.authVersion += 1; // s157
      await admin.save();
      await ops.revokeSessions(admin._id);
      await record(req, 'ADMIN_ACCOUNT_DISABLED', admin._id, {});
      ops.notify(admin, 'ADMIN_ACCOUNT_DISABLED');
      res.json(successEnvelope({ admin: toAdminView(admin) }, req.id));
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id/enable', requirePermission('admins:update'), recent, async (req, res, next) => {
    try {
      const admin = await loadTarget(req.params.id);
      if (admin.status === 'ACTIVE') return res.json(successEnvelope({ admin: toAdminView(admin) }, req.id));
      admin.status = 'ACTIVE'; // s158: old sessions are not restored (authVersion moved on when disabled)
      await admin.save();
      await record(req, 'ADMIN_ACCOUNT_ENABLED', admin._id, {});
      ops.notify(admin, 'ADMIN_ACCOUNT_ENABLED');
      res.json(successEnvelope({ admin: toAdminView(admin) }, req.id));
    } catch (error) {
      next(error);
    }
  });

  /*
   * s84, s87 — manual MFA recovery for ANOTHER Admin who lost every factor.
   * The owner confirms that the person's identity was verified independently;
   * all sessions end and MFA must be enrolled again at the next sign-in.
   */
  router.post('/:id/mfa/reset', requirePermission('admins:update'), recent, async (req, res, next) => {
    try {
      const { identityVerified } = parseBody(z.object({ identityVerified: z.literal(true) }).strict(), req.body);
      const admin = await loadTarget(req.params.id);
      if (String(admin._id) === req.admin.id) throw fail(409, 'SELF_MFA_RESET', 'Use a recovery code to recover your own account.');
      await model.updateOne(
        { _id: admin._id },
        {
          $set: {
            'mfa.enabled': false,
            'mfa.method': null,
            'mfa.secretCiphertext': null,
            'mfa.encryptionKeyId': null,
            'mfa.enrolledAt': null,
            'mfa.lastUsedTimeStep': null,
            'mfa.recoveryCodes': [],
          },
          $inc: { 'authentication.authVersion': 1 },
        },
      );
      await ops.revokeSessions(admin._id);
      await record(req, 'MFA_RESET', admin._id, { reasonProvided: identityVerified });
      ops.notify(admin, 'MFA_RESET');
      res.json(successEnvelope({ admin: toAdminView(await model.findById(admin._id).lean()) }, req.id));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
