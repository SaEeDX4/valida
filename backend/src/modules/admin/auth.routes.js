import express from 'express';
import mongoose from 'mongoose';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { AppError, ERROR_CODES } from '../../errors/AppError.js';
import { successEnvelope } from '../../lib/envelope.js';
import { Admin } from '../../models/Admin.js';
import { normalizeEmail } from '../../models/Application.js';
import { dummyVerify, hashPassword, needsRehash, passwordPolicyProblem, verifyPassword } from './auth/password.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from './auth/totp.js';
import { generateRecoveryCode, hashRecoveryCode, normaliseRecoveryCode, randomToken, sha256Hex } from './auth/secrets.js';
import { permissionsFor } from './auth/permissions.js';
import { resetMessage, securityNoticeMessage } from './adminMail.js';
import {
  AUTH_LEVEL,
  SESSION_COLLECTION,
  authError,
  destroySession,
  issueCsrfToken,
  regenerateSession,
  requireAdmin,
  requireCsrf,
  requireRecentAuth,
  requireTrustedOrigin,
} from './session.js';

/**
 * /api/v1/auth — Doc 11 sections 50-137, 185-195, 239-264 (E1).
 *
 * Every state-changing route needs the trusted Origin (s116) and the session's
 * CSRF token (s109-112). Responses are generic wherever account state could
 * leak (s56-57, s122, s144).
 */

const ADMIN_SECRET_FIELDS =
  '+authentication.passwordHash +mfa.secretCiphertext +mfa.recoveryCodes +mfa.pendingSecretCiphertext';

const fail = (status, code, message, extra = {}) => new AppError({ status, code, message, ...extra });
const invalidCredentials = () => fail(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');

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

const emailField = z.string().trim().min(3).max(254);
const passwordInput = z.string().min(1).max(1024); // long inputs are refused by policy, never truncated (s43)

/** Coarse, safe device label (s101): browser family and platform, no version or fingerprint. */
function deviceLabel(userAgent = '') {
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Firefox\//.test(userAgent) ? 'Firefox' : /Chrome\//.test(userAgent) ? 'Chrome' : /Safari\//.test(userAgent) ? 'Safari' : 'Browser';
  const platform = /iPhone|iPad/.test(userAgent) ? 'iOS' : /Android/.test(userAgent) ? 'Android' : /Mac OS X/.test(userAgent) ? 'macOS' : /Windows/.test(userAgent) ? 'Windows' : /Linux/.test(userAgent) ? 'Linux' : 'unknown';
  return `${browser} on ${platform}`;
}

export function sessionSummary(admin) {
  return { authenticated: true, principalType: 'ADMIN', displayName: admin.displayName, email: admin.email, roles: admin.roles, permissions: [...permissionsFor(admin.roles)].sort() };
}

export function createAdminAccountOps({ clock, audit, notifications, logger, sessions = () => mongoose.connection.collection(SESSION_COLLECTION) }) {
  return {
    /** s92 — revoke in the store; authVersion (incremented by the caller) is the second, fail-closed layer. */
    async revokeSessions(adminId, { exceptSessionId = null } = {}) {
      const filter = { 'session.principalId': String(adminId) };
      if (exceptSessionId) filter._id = { $ne: exceptSessionId };
      const result = await sessions().deleteMany(filter);
      return result.deletedCount ?? 0;
    },
    /** s193 — fire-and-forget security notice; failure is logged, never fatal, never leaks. */
    notify(admin, notice) {
      if (!notifications?.configured) return;
      const message = securityNoticeMessage({ notice });
      notifications
        .deliverAdminMessage({ event: 'ADMIN_SECURITY_NOTICE', adminId: String(admin._id), to: admin.email, ...message, reference: `${notice}/${String(admin._id)}/${clock().getTime()}` })
        .then((outcome) => logger?.info?.({ event: 'admin.security_notice', notice, outcome: outcome.status }, 'admin security notice'))
        .catch(() => {});
    },
    audit,
  };
}

export function authRouter({ adminAuth, secretBox, clock = () => new Date(), audit, notifications, logger, model = Admin }) {
  const router = express.Router();
  const policy = adminAuth.policy;
  const ops = createAdminAccountOps({ clock, audit, notifications, logger });
  const now = () => clock().getTime();
  const origin = requireTrustedOrigin({ appOrigin: adminAuth.appOrigin });
  const csrf = requireCsrf();
  const authenticated = requireAdmin({ adminAuth, clock, model });
  const recent = requireRecentAuth({ adminAuth, clock });
  const record = (req, action, adminId, metadata) =>
    audit.record({ actor: adminId ? { type: 'ADMIN', id: adminId } : { type: 'SYSTEM' }, action, resource: { type: 'ADMIN', id: adminId ?? null }, requestId: req.id ?? null, metadata });

  // s139 — 30 attempts per 15 minutes per client address, generic 429 (s246).
  const loginLimiter = rateLimit({
    windowMs: adminAuth.loginRateLimit.windowMs,
    limit: adminAuth.loginRateLimit.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    handler: (_req, _res, next) => next(fail(429, 'RATE_LIMITED', 'Too many attempts. Wait a few minutes and try again.')),
  });

  /** Establishes a fresh authenticated session for `admin` (s76, s88, s100, s114). */
  async function establishSession(req, admin, { recoveryCodesRemaining } = {}) {
    await regenerateSession(req);
    const t = now();
    Object.assign(req.session, {
      principalType: 'ADMIN',
      principalId: String(admin._id),
      authVersion: admin.authentication.authVersion,
      authenticationLevel: AUTH_LEVEL.AUTHENTICATED,
      mfaSatisfiedAt: t,
      strongAuthAt: t,
      createdAt: t,
      lastActivityAt: t,
      absoluteExpiresAt: t + policy.absoluteLifetimeMs,
      publicId: randomToken(12),
      deviceLabel: deviceLabel(req.get('User-Agent')),
    });
    const csrfToken = issueCsrfToken(req);
    return { ...sessionSummary(admin), csrfToken, ...(recoveryCodesRemaining !== undefined ? { recoveryCodesRemaining } : {}) };
  }

  /** A password-verified or activation-verified pre-auth state (s22, s60, s261-263). */
  async function establishPreAuth(req, admin, level) {
    await regenerateSession(req);
    Object.assign(req.session, {
      principalType: 'ADMIN',
      principalId: String(admin._id),
      authVersion: admin.authentication.authVersion,
      authenticationLevel: level,
      preAuthExpiresAt: now() + policy.preAuthLifetimeMs,
      mfaAttempts: 0,
    });
    return issueCsrfToken(req);
  }

  /** Loads the pre-auth principal, or fails closed (s263). */
  async function loadPreAuth(req, level) {
    const s = req.session;
    if (!s || s.principalType !== 'ADMIN' || s.authenticationLevel !== level || !s.principalId) throw authError('AUTHENTICATION_REQUIRED');
    if (now() >= s.preAuthExpiresAt) {
      await destroySession(req);
      throw authError('SESSION_EXPIRED');
    }
    const admin = await model.findById(s.principalId).select(ADMIN_SECRET_FIELDS);
    if (!admin || admin.status !== 'ACTIVE' || admin.authentication.authVersion !== s.authVersion) {
      await destroySession(req);
      throw authError('SESSION_REVOKED');
    }
    return admin;
  }

  // ------------------------------------------------------------ s51-52 CSRF --
  router.get('/csrf', (req, res) => {
    const csrfToken = req.session.csrfToken ?? issueCsrfToken(req);
    res.json(successEnvelope({ csrfToken }, req.id));
  });

  // ------------------------------------------------------- s107-108 session --
  router.get('/session', async (req, res, next) => {
    try {
      const s = req.session;
      if (s?.principalType === 'ADMIN' && s.authenticationLevel === AUTH_LEVEL.AUTHENTICATED) {
        // A read-only check: it never extends the idle timer (s99).
        const check = requireAdmin({ adminAuth, clock, touch: false, model });
        await new Promise((resolve, reject) => check(req, res, (error) => (error ? reject(error) : resolve())));
        const admin = await model.findById(s.principalId).lean();
        return res.json(successEnvelope({ ...sessionSummary(admin), idleExpiresAt: new Date(s.lastActivityAt + policy.idleTimeoutMs).toISOString() }, req.id));
      }
      const pending =
        s?.authenticationLevel === AUTH_LEVEL.PASSWORD_VERIFIED ? 'MFA_REQUIRED' : s?.authenticationLevel === AUTH_LEVEL.MFA_ENROLLMENT_REQUIRED ? 'MFA_ENROLLMENT_REQUIRED' : null;
      return res.json(successEnvelope({ authenticated: false, ...(pending && now() < s.preAuthExpiresAt ? { pending } : {}) }, req.id));
    } catch (error) {
      if (error?.status === 401) return res.json(successEnvelope({ authenticated: false }, req.id));
      return next(error);
    }
  });

  // --------------------------------------------------------- s53-60 login --
  const loginSchema = z.object({ realm: z.literal('ADMIN'), email: emailField, password: passwordInput }).strict();
  router.post('/login', loginLimiter, origin, csrf, async (req, res, next) => {
    try {
      const { email, password } = parseBody(loginSchema, req.body);
      const admin = await model.findOne({ emailNormalized: { $eq: normalizeEmail(email) } }).select(ADMIN_SECRET_FIELDS);
      const t = now();
      const usable = admin && admin.status === 'ACTIVE' && admin.authentication.passwordHash && admin.authentication.emailVerifiedAt;
      const locked = usable && admin.authentication.lockedUntil && admin.authentication.lockedUntil.getTime() > t;
      if (!usable || locked || [...password].length > policy.passwordMaxLength) {
        await dummyVerify(password, adminAuth.argon2); // s59: no timing distinction
        logger?.info?.({ event: 'auth.login_failed', reason: !admin ? 'UNKNOWN' : locked ? 'LOCKED' : 'UNAVAILABLE', requestId: req.id }, 'admin login refused');
        if (admin) await record(req, 'AUTH_LOGIN_FAILED', admin._id, { outcome: locked ? 'LOCKED' : 'UNAVAILABLE' });
        throw invalidCredentials();
      }
      if (!(await verifyPassword(password, admin.authentication.passwordHash))) {
        // s140-141 — 5 consecutive failures within the window → a 15-minute lock.
        const recentFailure = admin.authentication.lastFailedLoginAt && t - admin.authentication.lastFailedLoginAt.getTime() < policy.loginWindowMs;
        const count = (recentFailure ? admin.authentication.failedLoginCount : 0) + 1;
        const lock = count >= policy.failedLoginThreshold;
        await model.updateOne(
          { _id: admin._id },
          { $set: { 'authentication.failedLoginCount': lock ? 0 : count, 'authentication.lastFailedLoginAt': new Date(t), ...(lock ? { 'authentication.lockedUntil': new Date(t + policy.lockDurationMs) } : {}) } },
        );
        await record(req, lock ? 'AUTH_ACCOUNT_LOCKED' : 'AUTH_LOGIN_FAILED', admin._id, { outcome: 'WRONG_PASSWORD', count });
        throw invalidCredentials();
      }
      if (needsRehash(admin.authentication.passwordHash, adminAuth.argon2)) {
        await model.updateOne({ _id: admin._id }, { $set: { 'authentication.passwordHash': await hashPassword(password, adminAuth.argon2) } }); // s46
      }
      const level = admin.mfa.enabled ? AUTH_LEVEL.PASSWORD_VERIFIED : AUTH_LEVEL.MFA_ENROLLMENT_REQUIRED;
      const csrfToken = await establishPreAuth(req, admin, level);
      res.json(successEnvelope({ authenticated: false, pending: level === AUTH_LEVEL.PASSWORD_VERIFIED ? 'MFA_REQUIRED' : 'MFA_ENROLLMENT_REQUIRED', csrfToken }, req.id));
    } catch (error) {
      next(error);
    }
  });

  // ------------------------------------------------- s75-82, s259-260 MFA --
  const mfaSchema = z.object({ code: z.string().max(20).optional(), recoveryCode: z.string().max(64).optional() }).strict();
  router.post('/mfa/verify', loginLimiter, origin, csrf, async (req, res, next) => {
    try {
      const { code, recoveryCode } = parseBody(mfaSchema, req.body);
      const admin = await loadPreAuth(req, AUTH_LEVEL.PASSWORD_VERIFIED);
      let ok = false;
      let usedRecovery = false;
      if (typeof recoveryCode === 'string' && normaliseRecoveryCode(recoveryCode)) {
        const hash = hashRecoveryCode(recoveryCode);
        // Consumed atomically: the same code cannot succeed twice, even concurrently (s81).
        const consumed = await model.updateOne(
          { _id: admin._id, 'mfa.recoveryCodes': { $elemMatch: { hash, usedAt: null } } },
          { $set: { 'mfa.recoveryCodes.$.usedAt': clock() } },
        );
        ok = consumed.modifiedCount === 1;
        usedRecovery = ok;
      } else if (typeof code === 'string') {
        const secret = secretBox.open({ keyId: admin.mfa.encryptionKeyId, ciphertext: admin.mfa.secretCiphertext });
        const result = verifyTotp(secret, code, { nowMs: now(), lastUsedStep: admin.mfa.lastUsedTimeStep });
        if (result.ok) {
          // Replay refusal is also atomic (s74): only a strictly later step is recorded.
          const claimed = await model.updateOne(
            { _id: admin._id, $or: [{ 'mfa.lastUsedTimeStep': null }, { 'mfa.lastUsedTimeStep': { $lt: result.step } }] },
            { $set: { 'mfa.lastUsedTimeStep': result.step } },
          );
          ok = claimed.modifiedCount === 1;
        }
      }
      if (!ok) {
        req.session.mfaAttempts = (req.session.mfaAttempts ?? 0) + 1;
        await record(req, 'MFA_FAILED', admin._id, { count: req.session.mfaAttempts });
        if (req.session.mfaAttempts >= policy.mfaAttemptsPerChallenge) {
          await destroySession(req); // s260: the challenge ends; sign in again
          throw fail(401, 'MFA_CHALLENGE_ENDED', 'Too many incorrect codes. Sign in again.');
        }
        throw fail(401, 'INVALID_MFA_CODE', 'That code is not correct. Try again.');
      }
      const fresh = await model.findByIdAndUpdate(
        admin._id,
        { $set: { lastLoginAt: clock(), 'authentication.failedLoginCount': 0, 'authentication.lockedUntil': null } },
        { returnDocument: 'after' },
      ).select('+mfa.recoveryCodes');
      const remaining = fresh.mfa.recoveryCodes.filter((c) => c.usedAt === null).length;
      const data = await establishSession(req, fresh, { recoveryCodesRemaining: remaining });
      await record(req, 'AUTH_LOGIN_SUCCESS', admin._id, { method: usedRecovery ? 'RECOVERY_CODE' : 'TOTP' });
      if (usedRecovery) {
        await record(req, 'MFA_RECOVERY_CODE_USED', admin._id, { count: remaining });
        ops.notify(fresh, 'MFA_RECOVERY_CODE_USED');
      }
      res.json(successEnvelope(data, req.id));
    } catch (error) {
      next(error);
    }
  });

  // --------------------------------------------------- s69-71 enrolment --
  router.post('/mfa/enroll/start', origin, csrf, async (req, res, next) => {
    try {
      const admin = await loadPreAuth(req, AUTH_LEVEL.MFA_ENROLLMENT_REQUIRED);
      const secret = generateTotpSecret();
      const sealed = secretBox.seal(secret);
      await model.updateOne(
        { _id: admin._id },
        { $set: { 'mfa.pendingSecretCiphertext': sealed.ciphertext, 'mfa.pendingEncryptionKeyId': sealed.keyId, 'mfa.pendingExpiresAt': new Date(now() + policy.enrollmentLifetimeMs) } },
      );
      // s70: sensitive — returned once, never logged.
      res.json(successEnvelope({ secret, otpauthUri: otpauthUri({ secretBase32: secret, accountName: admin.email }), expiresInSeconds: policy.enrollmentLifetimeMs / 1000 }, req.id));
    } catch (error) {
      next(error);
    }
  });

  router.post('/mfa/enroll/verify', loginLimiter, origin, csrf, async (req, res, next) => {
    try {
      const { code } = parseBody(z.object({ code: z.string().max(20) }).strict(), req.body);
      const admin = await loadPreAuth(req, AUTH_LEVEL.MFA_ENROLLMENT_REQUIRED);
      const pending = admin.mfa.pendingSecretCiphertext;
      if (!pending || !admin.mfa.pendingExpiresAt || admin.mfa.pendingExpiresAt.getTime() <= now()) {
        throw fail(400, 'MFA_ENROLLMENT_EXPIRED', 'The setup expired. Start again.');
      }
      const secret = secretBox.open({ keyId: admin.mfa.pendingEncryptionKeyId, ciphertext: pending });
      const result = verifyTotp(secret, code, { nowMs: now() });
      if (!result.ok) {
        req.session.mfaAttempts = (req.session.mfaAttempts ?? 0) + 1;
        if (req.session.mfaAttempts >= policy.mfaAttemptsPerChallenge) {
          await destroySession(req);
          throw fail(401, 'MFA_CHALLENGE_ENDED', 'Too many incorrect codes. Sign in again.');
        }
        throw fail(401, 'INVALID_MFA_CODE', 'That code is not correct. Try again.');
      }
      const codes = Array.from({ length: policy.recoveryCodeCount }, generateRecoveryCode);
      const firstActivation = !admin.mfa.enrolledAt && !admin.lastLoginAt;
      const fresh = await model.findByIdAndUpdate(
        admin._id,
        {
          $set: {
            'mfa.enabled': true,
            'mfa.method': 'TOTP',
            'mfa.secretCiphertext': pending,
            'mfa.encryptionKeyId': admin.mfa.pendingEncryptionKeyId,
            'mfa.enrolledAt': clock(),
            'mfa.lastUsedTimeStep': result.step,
            'mfa.recoveryCodes': codes.map((c) => ({ hash: hashRecoveryCode(c), usedAt: null })),
            'mfa.pendingSecretCiphertext': null,
            'mfa.pendingEncryptionKeyId': null,
            'mfa.pendingExpiresAt': null,
            lastLoginAt: clock(),
          },
        },
        { returnDocument: 'after' },
      );
      const data = await establishSession(req, fresh);
      await record(req, 'MFA_ENROLLED', admin._id, { method: 'TOTP' });
      if (firstActivation) await record(req, 'AUTH_LOGIN_SUCCESS', admin._id, { method: 'TOTP' });
      ops.notify(fresh, 'MFA_ENROLLED');
      // s79: shown once; only hashes are stored.
      res.json(successEnvelope({ ...data, recoveryCodes: codes }, req.id));
    } catch (error) {
      next(error);
    }
  });

  // ------------------------------------------------------ s28-31 activation --
  const tokenPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordInput }).strict();
  router.post('/activation', loginLimiter, origin, csrf, async (req, res, next) => {
    try {
      const { token, password } = parseBody(tokenPasswordSchema, req.body);
      const admin = await model.findOne({ 'authentication.activationTokenHash': { $eq: sha256Hex(token) } }).select(ADMIN_SECRET_FIELDS);
      if (!admin || admin.status !== 'ACTIVE') throw fail(400, 'ACTIVATION_INVALID', 'This activation link is not valid. Ask the owner for a new one.');
      if (!admin.authentication.activationExpiresAt || admin.authentication.activationExpiresAt.getTime() <= now()) {
        throw fail(400, 'ACTIVATION_EXPIRED', 'This activation link has expired. Ask the owner for a new one.');
      }
      const problem = passwordPolicyProblem(password, { email: admin.email });
      if (problem) throw new AppError({ status: 400, code: ERROR_CODES.VALIDATION_FAILED, message: problem.message, fieldErrors: [{ field: 'password', code: problem.code, message: problem.message }] });
      // Single use: the token is cleared in the same conditional write that sets the password.
      const updated = await model.findOneAndUpdate(
        { _id: admin._id, 'authentication.activationTokenHash': sha256Hex(token) },
        {
          $set: {
            'authentication.passwordHash': await hashPassword(password, adminAuth.argon2),
            'authentication.passwordChangedAt': clock(),
            'authentication.emailVerifiedAt': clock(),
            'authentication.activationTokenHash': null,
            'authentication.activationExpiresAt': null,
          },
          $inc: { 'authentication.authVersion': 1 },
        },
        { returnDocument: 'after' },
      );
      if (!updated) throw fail(400, 'ACTIVATION_INVALID', 'This activation link is not valid. Ask the owner for a new one.');
      await ops.revokeSessions(updated._id);
      const csrfToken = await establishPreAuth(req, updated, AUTH_LEVEL.MFA_ENROLLMENT_REQUIRED);
      await record(req, 'ADMIN_ACTIVATED', updated._id, {});
      res.json(successEnvelope({ authenticated: false, pending: 'MFA_ENROLLMENT_REQUIRED', csrfToken }, req.id));
    } catch (error) {
      next(error);
    }
  });

  // -------------------------------------------------- s121-132 password reset --
  const GENERIC_RESET = 'If an eligible account exists for that email, password reset instructions will be sent.';
  router.post('/password/forgot', loginLimiter, origin, csrf, async (req, res, next) => {
    try {
      const { email } = parseBody(z.object({ realm: z.literal('ADMIN'), email: emailField }).strict(), req.body);
      // Answer first: response time does not depend on whether an account exists (s57, s122).
      res.status(202).json(successEnvelope({ message: GENERIC_RESET }, req.id));
      setImmediate(async () => {
        try {
          const admin = await model.findOne({ emailNormalized: { $eq: normalizeEmail(email) } });
          if (!admin || admin.status !== 'ACTIVE' || !admin.authentication.emailVerifiedAt) return;
          const token = randomToken(32);
          await model.updateOne({ _id: admin._id }, { $set: { 'authentication.resetTokenHash': sha256Hex(token), 'authentication.resetTokenExpiresAt': new Date(now() + policy.resetLifetimeMs) } });
          await record(req, 'PASSWORD_RESET_REQUESTED', admin._id, {});
          if (notifications?.configured) {
            const message = resetMessage({ appOrigin: adminAuth.appOrigin, token });
            const outcome = await notifications.deliverAdminMessage({ event: 'ADMIN_PASSWORD_RESET', adminId: String(admin._id), to: admin.email, ...message, reference: sha256Hex(token).slice(0, 16) });
            logger?.info?.({ event: 'admin.reset_email', outcome: outcome.status }, 'password reset email');
          } else {
            logger?.warn?.({ event: 'admin.reset_email', outcome: 'NOT_CONFIGURED' }, 'password reset requested but transactional email is not configured');
          }
        } catch (error) {
          logger?.error?.({ event: 'admin.reset_request_failed', errorName: error?.name }, 'password reset request failed');
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/password/reset', loginLimiter, origin, csrf, async (req, res, next) => {
    try {
      const { token, password } = parseBody(tokenPasswordSchema, req.body);
      const hash = sha256Hex(token);
      const admin = await model.findOne({ 'authentication.resetTokenHash': { $eq: hash } });
      if (!admin || admin.status !== 'ACTIVE') throw fail(400, 'PASSWORD_RESET_INVALID', 'This reset link is not valid. Request a new one.');
      if (!admin.authentication.resetTokenExpiresAt || admin.authentication.resetTokenExpiresAt.getTime() <= now()) {
        throw fail(400, 'PASSWORD_RESET_EXPIRED', 'This reset link has expired. Request a new one.');
      }
      const problem = passwordPolicyProblem(password, { email: admin.email });
      if (problem) throw new AppError({ status: 400, code: ERROR_CODES.VALIDATION_FAILED, message: problem.message, fieldErrors: [{ field: 'password', code: problem.code, message: problem.message }] });
      const updated = await model.findOneAndUpdate(
        { _id: admin._id, 'authentication.resetTokenHash': hash },
        {
          $set: {
            'authentication.passwordHash': await hashPassword(password, adminAuth.argon2),
            'authentication.passwordChangedAt': clock(),
            'authentication.resetTokenHash': null,
            'authentication.resetTokenExpiresAt': null,
            'authentication.failedLoginCount': 0,
            'authentication.lockedUntil': null,
          },
          $inc: { 'authentication.authVersion': 1 }, // s130: every existing session ends
        },
        { returnDocument: 'after' },
      );
      if (!updated) throw fail(400, 'PASSWORD_RESET_INVALID', 'This reset link is not valid. Request a new one.');
      await ops.revokeSessions(updated._id);
      await destroySession(req); // s131: no automatic sign-in
      await record(req, 'PASSWORD_RESET_COMPLETED', updated._id, {});
      ops.notify(updated, 'PASSWORD_RESET_COMPLETED');
      res.json(successEnvelope({ reset: true }, req.id));
    } catch (error) {
      next(error);
    }
  });

  // ------------------------------------------------------- s104-106 logout --
  router.post('/logout', origin, csrf, async (req, res, next) => {
    try {
      const adminId = req.session?.authenticationLevel === AUTH_LEVEL.AUTHENTICATED ? req.session.principalId : null;
      await destroySession(req);
      res.clearCookie(adminAuth.cookie.name, { path: '/', httpOnly: true, secure: adminAuth.cookie.secure, sameSite: 'strict' });
      if (adminId) await record(req, 'AUTH_LOGOUT', adminId, {});
      res.json(successEnvelope({ loggedOut: true }, req.id));
    } catch (error) {
      next(error);
    }
  });

  // ------------------------------------------------- s135-137 step-up auth --
  router.post('/reauthenticate', loginLimiter, origin, csrf, authenticated, async (req, res, next) => {
    try {
      const { password, code } = parseBody(z.object({ password: passwordInput, code: z.string().max(20) }).strict(), req.body);
      const admin = await model.findById(req.admin.id).select(ADMIN_SECRET_FIELDS);
      const passwordOk = await verifyPassword(password, admin.authentication.passwordHash);
      const secret = secretBox.open({ keyId: admin.mfa.encryptionKeyId, ciphertext: admin.mfa.secretCiphertext });
      const totp = verifyTotp(secret, code, { nowMs: now(), lastUsedStep: admin.mfa.lastUsedTimeStep });
      let ok = passwordOk && totp.ok;
      if (ok) {
        const claimed = await model.updateOne(
          { _id: admin._id, $or: [{ 'mfa.lastUsedTimeStep': null }, { 'mfa.lastUsedTimeStep': { $lt: totp.step } }] },
          { $set: { 'mfa.lastUsedTimeStep': totp.step } },
        );
        ok = claimed.modifiedCount === 1;
      }
      if (!ok) throw fail(401, 'INVALID_CREDENTIALS', 'The password or code is not correct.');
      req.session.strongAuthAt = now();
      res.json(successEnvelope({ strongAuthUntil: new Date(req.session.strongAuthAt + policy.recentAuthMs).toISOString() }, req.id));
    } catch (error) {
      next(error);
    }
  });

  // ---------------------------------------------------- s133-134 change password --
  router.post('/password/change', origin, csrf, authenticated, recent, async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = parseBody(z.object({ currentPassword: passwordInput, newPassword: passwordInput }).strict(), req.body);
      const admin = await model.findById(req.admin.id).select(ADMIN_SECRET_FIELDS);
      if (!(await verifyPassword(currentPassword, admin.authentication.passwordHash))) throw fail(401, 'INVALID_CREDENTIALS', 'The current password is not correct.');
      const problem = passwordPolicyProblem(newPassword, { email: admin.email });
      if (problem) throw new AppError({ status: 400, code: ERROR_CODES.VALIDATION_FAILED, message: problem.message, fieldErrors: [{ field: 'newPassword', code: problem.code, message: problem.message }] });
      const updated = await model.findByIdAndUpdate(
        admin._id,
        { $set: { 'authentication.passwordHash': await hashPassword(newPassword, adminAuth.argon2), 'authentication.passwordChangedAt': clock() }, $inc: { 'authentication.authVersion': 1 } },
        { returnDocument: 'after' },
      );
      await ops.revokeSessions(admin._id, { exceptSessionId: req.sessionID });
      const strongAuthAt = req.session.strongAuthAt;
      const data = await establishSession(req, updated); // regenerated, at the new authVersion
      req.session.strongAuthAt = strongAuthAt;
      await record(req, 'PASSWORD_CHANGED', admin._id, {});
      ops.notify(updated, 'PASSWORD_CHANGED');
      res.json(successEnvelope(data, req.id));
    } catch (error) {
      next(error);
    }
  });

  // ------------------------------------------------- s83 regenerate recovery codes --
  router.post('/mfa/recovery-codes/regenerate', origin, csrf, authenticated, recent, async (req, res, next) => {
    try {
      const codes = Array.from({ length: policy.recoveryCodeCount }, generateRecoveryCode);
      const updated = await model.findByIdAndUpdate(req.admin.id, { $set: { 'mfa.recoveryCodes': codes.map((c) => ({ hash: hashRecoveryCode(c), usedAt: null })) } }, { returnDocument: 'after' });
      await record(req, 'MFA_RECOVERY_CODES_REGENERATED', req.admin.id, { count: codes.length });
      ops.notify(updated, 'MFA_RECOVERY_CODES_REGENERATED');
      res.json(successEnvelope({ recoveryCodes: codes }, req.id));
    } catch (error) {
      next(error);
    }
  });

  // ------------------------------------------------------ s101-103 sessions --
  router.get('/sessions', authenticated, async (req, res, next) => {
    try {
      const docs = await mongoose.connection
        .collection(SESSION_COLLECTION)
        .find({ 'session.principalId': req.admin.id, 'session.authenticationLevel': AUTH_LEVEL.AUTHENTICATED, 'session.absoluteExpiresAt': { $gt: now() } })
        .project({ 'session.publicId': 1, 'session.createdAt': 1, 'session.lastActivityAt': 1, 'session.deviceLabel': 1 })
        .toArray();
      const items = docs
        .filter((d) => d._id === req.sessionID || now() - d.session.lastActivityAt < policy.idleTimeoutMs)
        .map((d) => ({
          id: d.session.publicId,
          current: d._id === req.sessionID,
          createdAt: new Date(d.session.createdAt).toISOString(),
          lastActivityAt: new Date(d._id === req.sessionID ? req.session.lastActivityAt : d.session.lastActivityAt).toISOString(),
          device: d.session.deviceLabel ?? 'unknown',
        }));
      res.json(successEnvelope({ items }, req.id));
    } catch (error) {
      next(error);
    }
  });

  router.delete('/sessions/:publicId', origin, csrf, authenticated, async (req, res, next) => {
    try {
      const publicId = String(req.params.publicId);
      if (!/^[A-Za-z0-9_-]{8,40}$/.test(publicId)) throw fail(404, 'SESSION_NOT_FOUND', 'That session was not found.');
      if (publicId === req.session.publicId) {
        await destroySession(req);
        res.clearCookie(adminAuth.cookie.name, { path: '/', httpOnly: true, secure: adminAuth.cookie.secure, sameSite: 'strict' });
      } else {
        // Ownership is part of the filter: another Admin's session is simply "not found" (s102, s179).
        const result = await mongoose.connection.collection(SESSION_COLLECTION).deleteOne({ 'session.publicId': publicId, 'session.principalId': req.admin.id });
        if (result.deletedCount !== 1) throw fail(404, 'SESSION_NOT_FOUND', 'That session was not found.');
      }
      await record(req, 'SESSION_REVOKED', req.admin.id, { sessionPublicId: publicId });
      res.json(successEnvelope({ revoked: true }, req.id));
    } catch (error) {
      next(error);
    }
  });

  router.post('/sessions/revoke-others', origin, csrf, authenticated, recent, async (req, res, next) => {
    try {
      const count = await ops.revokeSessions(req.admin.id, { exceptSessionId: req.sessionID });
      await record(req, 'SESSIONS_REVOKED_OTHERS', req.admin.id, { count });
      res.json(successEnvelope({ revoked: count }, req.id));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
