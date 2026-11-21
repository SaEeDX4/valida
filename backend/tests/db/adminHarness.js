import { createHash, randomBytes, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { Admin } from '../../src/models/Admin.js';
import { Application } from '../../src/models/Application.js';
import { Job } from '../../src/models/Job.js';
import { issueActivation } from '../../src/modules/admin/admins.routes.js';
import { timeStep, totpAt } from '../../src/modules/admin/auth/totp.js';
import { createNotificationService } from '../../src/integrations/notifications/notificationService.js';
import { recordingTransport } from '../fixtures/applyHarness.js';

/**
 * E1-E5 test harness — synthetic data only (OD-2026-11-21-01 §2.1). Every
 * address is @example.invalid; every secret is generated per run.
 */

export const ADMIN_ORIGIN = 'http://localhost:5173';
export const STRONG_PASSWORD = 'QA synthetic passphrase 7 lanterns';
export const OTHER_PASSWORD = 'QA another synthetic phrase 9 rivers';

export function adminEnv(uri, overrides = {}) {
  return {
    NODE_ENV: 'test',
    APP_ENV: 'local',
    MONGODB_URI: uri,
    RATE_LIMIT_MAX: '100000',
    LOG_LEVEL: process.env.QA_LOG_LEVEL ?? 'silent',
    ADMIN_AUTH: 'enabled',
    ADMIN_SESSION_SECRET: randomBytes(32).toString('base64url'),
    ADMIN_MFA_KEYS: `qa1:${randomBytes(32).toString('base64')}`,
    ADMIN_MFA_CURRENT_KEY_ID: 'qa1',
    ADMIN_APP_ORIGIN: ADMIN_ORIGIN,
    ADMIN_LOGIN_RATE_LIMIT_MAX: '1000',
    ...overrides,
  };
}

/** A controllable clock: the server's notion of now for sessions, TOTP and lockout. */
export function testClock(start = Date.parse('2026-11-22T10:00:00.000Z')) {
  let now = start;
  const clock = () => new Date(now);
  clock.advance = (ms) => {
    now += ms;
  };
  clock.ms = () => now;
  return clock;
}

/** In-memory private storage double: readPrivateObject with the store's integrity contract. */
export function memoryResumeStorage() {
  const objects = new Map();
  return {
    objects,
    put(bytes) {
      const storageKey = `resumes/${randomBytes(16).toString('hex')}/${randomBytes(16).toString('hex')}`;
      objects.set(storageKey, Buffer.from(bytes));
      return { storageKey, sizeBytes: bytes.length, checksumSha256: createHash('sha256').update(bytes).digest('hex') };
    },
    async readPrivateObject(storageKey, { expect }) {
      const bytes = objects.get(storageKey);
      if (!bytes || bytes.length !== expect.sizeBytes) return { found: false };
      return { found: true, bytes };
    },
  };
}

export function buildAdminApp({ uri, env = {}, clock = testClock(), resumeStorage = memoryResumeStorage(), transport = recordingTransport('accept') } = {}) {
  const config = loadConfig(adminEnv(uri, env));
  const notificationService = createNotificationService({
    transport,
    timeoutMs: 5_000,
    clock,
    fromAddress: 'notifications@example.invalid',
    fromName: 'Valida QA',
    internalRecipient: 'careers@example.invalid',
    recipientAllowlist: null,
  });
  const app = createApp({ config, clock, resumeStorage, notificationService });
  return { app, config, clock, resumeStorage, transport };
}

export function agentFor(app) {
  const agent = request.agent(app);
  return {
    agent,
    get: (path) => agent.get(path).set('Origin', ADMIN_ORIGIN),
    post: (path, body, csrf) => {
      const r = agent.post(path).set('Origin', ADMIN_ORIGIN);
      if (csrf) r.set('X-CSRF-Token', csrf);
      return r.send(body ?? {});
    },
    patch: (path, body, csrf) => agent.patch(path).set('Origin', ADMIN_ORIGIN).set('X-CSRF-Token', csrf).send(body ?? {}),
    del: (path, csrf) => agent.delete(path).set('Origin', ADMIN_ORIGIN).set('X-CSRF-Token', csrf),
  };
}

export async function csrfFor(client) {
  const res = await client.get('/api/v1/auth/csrf').expect(200);
  return res.body.data.csrfToken;
}

/** Creates an Admin the way the provisioning utility does and returns its one-time activation token. */
export async function provisionAdmin({ config, clock, email, displayName = 'QA Admin', roles = ['ADMIN_OWNER'] }) {
  const admin = await new Admin({ email, displayName, roles, status: 'ACTIVE' }).save();
  const { token } = await issueActivation({ admin, adminAuth: config.adminAuth, notifications: null, clock });
  return { admin, token };
}

export function currentCode(secret, clock) {
  return totpAt(secret, timeStep(clock.ms()));
}

/** Activation → password → MFA enrolment. Returns the TOTP secret, recovery codes and CSRF token. */
export async function activateAndEnroll({ client, token, clock, password = STRONG_PASSWORD }) {
  let csrf = await csrfFor(client);
  const activated = await client.post('/api/v1/auth/activation', { token, password }, csrf).expect(200);
  csrf = activated.body.data.csrfToken;
  const start = await client.post('/api/v1/auth/mfa/enroll/start', {}, csrf).expect(200);
  const { secret } = start.body.data;
  const verified = await client.post('/api/v1/auth/mfa/enroll/verify', { code: currentCode(secret, clock) }, csrf).expect(200);
  return { secret, recoveryCodes: verified.body.data.recoveryCodes, csrf: verified.body.data.csrfToken };
}

/** A full sign-in. Moves the clock one TOTP step forward so the code is never a replay. */
export async function signIn({ client, clock, email, secret, password = STRONG_PASSWORD }) {
  clock.advance(30_000);
  let csrf = await csrfFor(client);
  const login = await client.post('/api/v1/auth/login', { realm: 'ADMIN', email, password }, csrf).expect(200);
  csrf = login.body.data.csrfToken;
  const mfa = await client.post('/api/v1/auth/mfa/verify', { code: currentCode(secret, clock) }, csrf).expect(200);
  return mfa.body.data.csrfToken;
}

/** A ready, authenticated owner (or other role). */
export async function readyAdmin({ app, config, clock, email, roles = ['ADMIN_OWNER'], displayName }) {
  const { admin, token } = await provisionAdmin({ config, clock, email, roles, displayName: displayName ?? `QA ${roles[0]}` });
  const client = agentFor(app);
  const enrolled = await activateAndEnroll({ client, token, clock });
  return { client, admin, ...enrolled };
}

export function qaJobDefinition(slug, overrides = {}) {
  return {
    slug,
    title: `QA Synthetic Role ${slug}`,
    internalOccupationalReference: null,
    location: { displayName: 'QA Region, Canada', countryCode: 'CA', regionCode: null, locality: null },
    workArrangement: 'FULLY_REMOTE',
    employmentType: 'PART_TIME',
    schedule: 'QA TEST DATA schedule',
    weeklyHours: 30,
    compensation: { currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: true },
    description: 'QA TEST DATA description.',
    responsibilities: ['QA TEST DATA responsibility.'],
    requirements: ['QA TEST DATA requirement.'],
    preferredQualifications: [],
    applicationConfig: {
      resumeRequired: true,
      phone: { enabled: true, required: false },
      message: { enabled: true, required: false, maxLength: 2000 },
      screeningQuestions: [{ type: 'YES_NO', prompt: 'QA TEST DATA: can you work the stated hours?', required: true, options: [] }],
    },
    closesAt: null,
    ...overrides,
  };
}

/** A synthetic Application saved directly, with its résumé bytes in the storage double. */
export async function seedApplication({ job, storage, email = `qa-${randomUUID().slice(0, 8)}@example.invalid`, fullName = 'QA Synthetic Candidate', scanStatus = 'CLEAN', submittedAt = new Date('2026-11-20T09:00:00.000Z') }) {
  const bytes = Buffer.from(`%PDF-1.4\n% QA synthetic résumé ${randomUUID()}\n%%EOF\n`);
  const stored = storage.put(bytes);
  const application = await new Application({
    jobId: job._id,
    jobSnapshot: { title: job.title, slug: job.slug, location: job.location?.displayName ?? null, workArrangement: job.workArrangement, employmentType: job.employmentType, schedule: job.schedule, weeklyHours: job.weeklyHours, compensation: job.compensation },
    candidate: { fullName, email, phone: null, message: 'QA synthetic message.' },
    screeningAnswers: [],
    resume: {
      storageProvider: 'qa-memory',
      storageKey: stored.storageKey,
      originalFilename: 'QA résumé.pdf',
      extension: '.pdf',
      mimeType: 'application/pdf',
      sizeBytes: stored.sizeBytes,
      checksumSha256: stored.checksumSha256,
      scanStatus,
      scanCheckedAt: scanStatus === 'NOT_SCANNED' ? null : new Date('2026-11-20T09:05:00.000Z'),
      storedAt: submittedAt,
    },
    idempotency: { keyHash: createHash('sha256').update(randomUUID()).digest('hex'), requestFingerprintHash: createHash('sha256').update(randomUUID()).digest('hex') },
    submittedAt,
  }).save();
  return { application, bytes };
}

export async function clearAdminCollections() {
  const db = mongoose.connection.db;
  for (const name of ['admins', 'audit_events', 'admin_sessions', 'applications', 'jobs']) {
    await db.collection(name).deleteMany({});
  }
}

export { Admin, Application, Job };
