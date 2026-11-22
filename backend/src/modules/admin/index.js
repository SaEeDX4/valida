import { argon2 } from 'node:crypto';
import express from 'express';
import { createSecretBox } from './auth/secrets.js';
import { createAuditWriter } from './audit.js';
import { authRouter } from './auth.routes.js';
import { adminsRouter } from './admins.routes.js';
import { jobsAdminRouter } from './jobs.admin.routes.js';
import { applicationsAdminRouter, auditRouter, overviewRouter } from './applications.admin.routes.js';
import { adminCors, adminSessionMiddleware, createSessionStore, noStoreAdmin, requireAdmin, requireCsrf, requireTrustedOrigin } from './session.js';

/**
 * The Recruitment Admin surface (E1-E5; OD-2026-11-21-01), mounted by app.js
 * only when configuration enables it:
 *
 *   /api/v1/auth/**   authentication (public entry points, CSRF + Origin protected)
 *   /api/v1/admin/**  everything else; every route needs an authenticated,
 *                     ACTIVE Admin at the current authVersion (Doc 11 s159)
 *
 * Paths the surface owns, for the public CORS policy to step aside.
 */
export const ADMIN_PATH_PREFIXES = Object.freeze(['/auth', '/admin']);

export function createAdminSurface({ adminAuth, clock = () => new Date(), logger, notificationService, resumeStorage, sessionStore }) {
  // Argon2id comes from Node itself (24.7+); without it the surface refuses to start rather than weaken hashing.
  if (typeof argon2 !== 'function') throw new Error('Admin authentication requires Node.js 24.7 or later (crypto.argon2)');
  const store = sessionStore ?? createSessionStore({ ttlSeconds: Math.ceil(adminAuth.policy.absoluteLifetimeMs / 1000) });
  const secretBox = createSecretBox({ keys: adminAuth.secrets.mfaKeys, currentKeyId: adminAuth.secrets.mfaCurrentKeyId });
  const audit = createAuditWriter({ clock, logger });

  // Cross-cutting middleware for both prefixes: credentialed CORS for the Admin
  // origin only, no caching, the session.
  const front = express.Router();
  front.use(adminCors({ appOrigin: adminAuth.appOrigin }));
  front.use(noStoreAdmin());
  front.use(adminSessionMiddleware({ adminAuth, store }));

  const auth = authRouter({ adminAuth, secretBox, clock, audit, notifications: notificationService, logger });

  const admin = express.Router();
  admin.use(requireTrustedOrigin({ appOrigin: adminAuth.appOrigin }));
  admin.use(requireAdmin({ adminAuth, clock }));
  admin.use(requireCsrf());
  admin.use('/overview', overviewRouter({ clock }));
  admin.use('/admins', adminsRouter({ adminAuth, clock, audit, notifications: notificationService, logger }));
  admin.use('/jobs', jobsAdminRouter({ clock, audit }));
  admin.use('/applications', applicationsAdminRouter({ clock, audit, resumeStorage }));
  admin.use('/audit', auditRouter());

  return { front, auth, admin, store, audit };
}
