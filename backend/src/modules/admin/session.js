import { randomBytes, timingSafeEqual } from 'node:crypto';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import cors from 'cors';
import mongoose from 'mongoose';
import { AppError } from '../../errors/AppError.js';
import { Admin } from '../../models/Admin.js';
import { permissionsFor } from './auth/permissions.js';

/**
 * Admin sessions, CSRF and request-origin defence — Doc 11 sections 5-20,
 * 88-120, 152-159, 178, 239-249, 263-264 (E1).
 *
 * Browser → opaque cookie → Express → MongoDB session store → principal (s7).
 * The cookie carries only a signed random id (express-session, 192 bits); the
 * session document holds minimal state (s19-20). Every protected request
 * re-reads the Admin: ACTIVE, matching authVersion and current permissions
 * (s89, s155) — a stale or revoked session fails closed.
 */

export const SESSION_COLLECTION = 'admin_sessions';

export const AUTH_LEVEL = Object.freeze({
  PRE_AUTH: 'PRE_AUTH',
  PASSWORD_VERIFIED: 'PASSWORD_VERIFIED',
  MFA_ENROLLMENT_REQUIRED: 'MFA_ENROLLMENT_REQUIRED',
  AUTHENTICATED: 'AUTHENTICATED',
});

export const AUTH_ERRORS = Object.freeze({
  AUTHENTICATION_REQUIRED: [401, 'Sign in to continue.'],
  SESSION_EXPIRED: [401, 'Your session has expired. Sign in again.'],
  SESSION_REVOKED: [401, 'Your session is no longer valid. Sign in again.'],
  CSRF_INVALID: [403, 'The request could not be verified. Reload the page and try again.'],
  ORIGIN_REJECTED: [403, 'The request could not be verified. Reload the page and try again.'],
  AUTHORIZATION_DENIED: [403, 'You do not have permission to do this.'],
  RECENT_AUTH_REQUIRED: [403, 'Confirm your password and authentication code to continue.'],
  MFA_REQUIRED: [401, 'Enter the code from your authenticator app.'],
  MFA_ENROLLMENT_REQUIRED: [401, 'Set up two-step verification to continue.'],
});

export function authError(code, extra = {}) {
  const [status, message] = AUTH_ERRORS[code] ?? [401, 'Sign in to continue.'];
  return new AppError({ status, code, message, ...extra });
}

/* ------------------------------------------------------------------ store -- */

export function createSessionStore({ client = mongoose.connection.getClient(), ttlSeconds }) {
  return MongoStore.create({
    client,
    collectionName: SESSION_COLLECTION,
    // Stored as a document (not a JSON string) so revocation can find an
    // Admin's sessions by principal (s92, s101-103).
    stringify: false,
    // Expiry is a TTL index created with the other required indexes (db/indexes.js),
    // so the runtime database user needs no index privilege.
    autoRemove: 'disabled',
    ttl: ttlSeconds,
  });
}

/* ---------------------------------------------------------------- session -- */

export function adminSessionMiddleware({ adminAuth, store }) {
  return session({
    name: adminAuth.cookie.name,
    secret: [...adminAuth.secrets.sessionSecrets],
    store,
    resave: false,
    saveUninitialized: false,
    rolling: false,
    unset: 'destroy',
    proxy: undefined, // follows app 'trust proxy'
    cookie: {
      httpOnly: true,
      secure: adminAuth.cookie.secure,
      sameSite: 'strict',
      path: '/',
      // No Domain (host-only, s17) and no Max-Age: a browser-session cookie; lifetime is enforced server-side (s97).
    },
    genid: () => randomBytes(24).toString('base64url'), // 192 bits (s11)
  });
}

/** Promise wrappers around express-session's callbacks. */
export const regenerateSession = (req) => new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
export const destroySession = (req) => new Promise((resolve) => (req.session ? req.session.destroy(() => resolve()) : resolve()));
export const saveSession = (req) => new Promise((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));

/* ------------------------------------------------------------------- CSRF -- */

/** s110 — random, secret, session-bound, server-side; rotated on identity changes (s114). */
export function issueCsrfToken(req) {
  req.session.csrfToken = randomBytes(32).toString('base64url');
  return req.session.csrfToken;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireCsrf() {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const expected = req.session?.csrfToken;
    const provided = req.get('X-CSRF-Token');
    const ok =
      typeof expected === 'string' &&
      typeof provided === 'string' &&
      provided.length === expected.length &&
      timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    return ok ? next() : next(authError('CSRF_INVALID'));
  };
}

/**
 * s116-118 — a state-changing request that carries browser provenance must come
 * from the Admin origin: Origin when present, else the Referer's origin (exact
 * comparison, never a substring), and a cross-site Sec-Fetch-Site is refused.
 * Requests with no browser provenance at all still need the session and CSRF token.
 */
export function requireTrustedOrigin({ appOrigin }) {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('Origin');
    if (origin !== undefined) return origin === appOrigin ? next() : next(authError('ORIGIN_REJECTED'));
    const referer = req.get('Referer');
    if (referer !== undefined) {
      let refererOrigin = null;
      try {
        refererOrigin = new URL(referer).origin;
      } catch {
        refererOrigin = null;
      }
      return refererOrigin === appOrigin ? next() : next(authError('ORIGIN_REJECTED'));
    }
    if (req.get('Sec-Fetch-Site') === 'cross-site') return next(authError('ORIGIN_REJECTED'));
    return next();
  };
}

/** s120 — credentialed CORS for the Admin origin only; never a wildcard. */
export function adminCors({ appOrigin }) {
  return cors({
    origin(origin, callback) {
      callback(null, origin === appOrigin);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Request-ID', 'X-CSRF-Token'],
    exposedHeaders: ['X-Request-ID', 'Content-Disposition'],
    maxAge: 600,
  });
}

/* ------------------------------------------------------------ authorization -- */

/**
 * Resolves the authenticated Admin for a protected request (s89, s92-99, s155,
 * s263). Expired sessions are destroyed; a session whose Admin is gone, disabled
 * or at another authVersion is destroyed and refused. `touch` updates idle
 * activity — only meaningful requests do (s99).
 */
export function requireAdmin({ adminAuth, clock = () => new Date(), touch = true, model = Admin } = {}) {
  return async (req, _res, next) => {
    try {
      const s = req.session;
      if (!s || s.principalType !== 'ADMIN' || !s.principalId) return next(authError('AUTHENTICATION_REQUIRED'));
      if (s.authenticationLevel !== AUTH_LEVEL.AUTHENTICATED) {
        return next(authError(s.authenticationLevel === AUTH_LEVEL.MFA_ENROLLMENT_REQUIRED ? 'MFA_ENROLLMENT_REQUIRED' : 'MFA_REQUIRED'));
      }
      const now = clock().getTime();
      if (now >= s.absoluteExpiresAt || now - s.lastActivityAt >= adminAuth.policy.idleTimeoutMs) {
        await destroySession(req);
        return next(authError('SESSION_EXPIRED'));
      }
      const admin = await model.findById(s.principalId).lean();
      if (!admin || admin.status !== 'ACTIVE' || admin.authentication?.authVersion !== s.authVersion) {
        await destroySession(req);
        return next(authError('SESSION_REVOKED'));
      }
      req.admin = { id: String(admin._id), email: admin.email, displayName: admin.displayName, roles: admin.roles, permissions: permissionsFor(admin.roles) };
      if (touch) s.lastActivityAt = now;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

/** s152-153 — default deny. */
export function requirePermission(permission) {
  return (req, _res, next) => (req.admin?.permissions?.has(permission) ? next() : next(authError('AUTHORIZATION_DENIED')));
}

/** s135-137 — high-risk operations need strong authentication in the last 10 minutes. */
export function requireRecentAuth({ adminAuth, clock = () => new Date() }) {
  return (req, _res, next) => {
    const at = req.session?.strongAuthAt ?? 0;
    return clock().getTime() - at < adminAuth.policy.recentAuthMs ? next() : next(authError('RECENT_AUTH_REQUIRED'));
  };
}

/** s248 — authentication and Admin responses are never cached. */
export function noStoreAdmin() {
  return (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    next();
  };
}
