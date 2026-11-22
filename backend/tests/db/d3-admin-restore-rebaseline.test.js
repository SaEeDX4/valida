import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { startServer, formatStartupFailure } from '../../src/server.js';
import { loadConfig } from '../../src/config/env.js';
import { REQUIRED_INDEXES } from '../../src/db/indexes.js';
import { ADMIN_RESTORE_STATE_COLLECTION, AdminRestoreRefused, adminRestoreGate, rebaselineAdmins } from '../../src/modules/admin/restoreRebaseline.js';
import { TEST_RECRUITMENT_ENV, freePort } from '../helpers.js';
import { requireTestDatabase } from './testDatabase.js';
import { ADMIN_ORIGIN, OTHER_PASSWORD, STRONG_PASSWORD, activateAndEnroll, agentFor, csrfFor, currentCode, provisionAdmin, testClock } from './adminHarness.js';

/**
 * D-3 (owner, 2026-11-22) — the Admin on a restored database. Real server, real
 * session store, real Argon2id; two databases stand in for the live cluster and
 * a restore target restored from an OLDER snapshot. Synthetic data only.
 *
 *   1. live: an owner, a recruiter and an unused invitation; snapshot; then a
 *      post-snapshot revocation (the recruiter is disabled) that the snapshot lacks;
 *   2. restored: the snapshot plus a `prepare-target` authorisation;
 *   3. interrupted recovery: the Admin stays closed (no start with ADMIN_AUTH,
 *      no Admin routes without it); an interrupted re-baseline keeps it closed;
 *   4. re-baselined: old cookies, passwords, invitation, TOTP secret and
 *      recovery codes regain nothing, even with the SAME session secret; only
 *      the owner, freshly activated and enrolled, signs in.
 *
 * The applicant-deletion gate that must pass first is exercised in
 * tests/recovery/admin-rebaseline.test.js (the CLI, two replica sets).
 */
const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const { MongoClient } = mongoose.mongo;
const uriFor = (db) => TEST_URI.replace(/\/[^/?]*(\?|$)/, `/${db}$1`);
const LIVE_DB = `${TEST_DATABASE}_d3live`;
const RESTORED_DB = `${TEST_DATABASE}_d3rst`;
const TARGET_ID = randomBytes(16).toString('hex');
const OWNER = `qa-owner-${randomBytes(3).toString('hex')}@example.invalid`;
const RECRUITER = `qa-recruiter-${randomBytes(3).toString('hex')}@example.invalid`;
const INVITED = `qa-invited-${randomBytes(3).toString('hex')}@example.invalid`;
const SESSION_SECRET = randomBytes(32).toString('base64url');
const MFA_KEYS = `qa1:${randomBytes(32).toString('base64')}`;
const NEW_PASSWORD = 'QA fresh owner passphrase 4 harbours';
let admin;
let root;
const state = {};

function envFor(db, { adminAuth = true } = {}) {
  return {
    ...TEST_RECRUITMENT_ENV, APP_ENV: 'local', NODE_ENV: 'test', LOG_LEVEL: process.env.QA_LOG_LEVEL ?? 'silent',
    MONGODB_URI: uriFor(db), CORS_ALLOWED_ORIGINS: ADMIN_ORIGIN, APPLICATION_RATE_LIMIT_MAX: '1000',
    ...(adminAuth
      ? { ADMIN_AUTH: 'enabled', ADMIN_SESSION_SECRET: SESSION_SECRET, ADMIN_MFA_KEYS: MFA_KEYS, ADMIN_MFA_CURRENT_KEY_ID: 'qa1', ADMIN_APP_ORIGIN: ADMIN_ORIGIN, ADMIN_LOGIN_RATE_LIMIT_MAX: '1000' }
      : {}),
  };
}
async function serve(db, options) {
  const port = await freePort();
  const server = await startServer({ env: { ...envFor(db, options), PORT: String(port) }, uploadTempBaseDirectory: root });
  server.base = `http://127.0.0.1:${port}`;
  return server;
}
const admins = (db) => admin.db(db).collection('admins');
/** A request carrying an OLD browser's cookie to another server. */
const withCookie = (base, cookie, p) => request(base).get(p).set('Origin', ADMIN_ORIGIN).set('Cookie', cookie);

beforeAll(async () => {
  admin = new MongoClient(TEST_URI);
  await admin.connect();
  for (const db of [LIVE_DB, RESTORED_DB]) {
    await admin.db(db).dropDatabase();
    for (const required of REQUIRED_INDEXES) await admin.db(db).collection(required.collection).createIndex(required.key, { name: required.name, ...required.options });
  }
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-d3-'));
}, 60_000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  for (const db of [LIVE_DB, RESTORED_DB]) await admin.db(db).dropDatabase().catch(() => {});
  await admin.close();
  fs.rmSync(root, { recursive: true, force: true });
}, 30_000);

describe('D-3: the Admin on a restored database', () => {
  it('live: owner, recruiter and an unused invitation; snapshot; then a post-snapshot revocation', async () => {
    const live = await serve(LIVE_DB);
    try {
      const clock = testClock(Date.now());
      const config = loadConfig(envFor(LIVE_DB));
      const ownerSeed = await provisionAdmin({ config, clock, email: OWNER, displayName: 'QA Owner' });
      state.ownerAgent = agentFor(live.base);
      const owner = await activateAndEnroll({ client: state.ownerAgent, token: ownerSeed.token, clock });
      state.ownerSecret = owner.secret;
      state.ownerRecovery = owner.recoveryCodes;
      state.ownerCsrf = owner.csrf;
      const recruiterSeed = await provisionAdmin({ config, clock, email: RECRUITER, displayName: 'QA Recruiter', roles: ['RECRUITMENT_ADMIN'] });
      state.recruiterId = String(recruiterSeed.admin._id);
      state.recruiterAgent = agentFor(live.base);
      clock.advance(30_000);
      await activateAndEnroll({ client: state.recruiterAgent, token: recruiterSeed.token, clock, password: OTHER_PASSWORD });
      state.inviteToken = (await provisionAdmin({ config, clock, email: INVITED, displayName: 'QA Invited', roles: ['RECRUITMENT_ADMIN'] })).token;
      await state.ownerAgent.get('/api/v1/admin/overview').expect(200);
      await state.recruiterAgent.get('/api/v1/admin/overview').expect(200);
      // The session cookies as the browsers hold them, to replay against the restored database later.
      const jarCookie = (client) => client.agent.jar.getCookies({ domain: '127.0.0.1', path: '/', secure: false, script: false }).toValueString();
      state.ownerCookie = jarCookie(state.ownerAgent);
      state.recruiterCookie = jarCookie(state.recruiterAgent);
      expect(state.ownerCookie).toMatch(/=s%3A/);
      // Control: the replay mechanism works — on the live server the same cookie is a valid session.
      expect((await withCookie(live.base, state.ownerCookie, '/api/v1/admin/overview')).status).toBe(200);

      // The Atlas snapshot (every collection), taken now.
      state.snapshot = {};
      for (const { name } of await admin.db(LIVE_DB).listCollections({}, { nameOnly: true }).toArray()) state.snapshot[name] = await admin.db(LIVE_DB).collection(name).find({}).toArray();
      expect(state.snapshot.admin_sessions.length).toBeGreaterThanOrEqual(2);

      // AFTER the snapshot: the owner revokes the recruiter. The snapshot does not know.
      await state.ownerAgent.post(`/api/v1/admin/admins/${state.recruiterId}/disable`, {}, state.ownerCsrf).expect(200);
      await state.recruiterAgent.get('/api/v1/admin/overview').expect(401);
      expect((await admins(LIVE_DB).findOne({ emailNormalized: RECRUITER })).status).toBe('DISABLED');
      // The live database is not a restore target: its gate is open, and it cannot be re-baselined.
      expect(await adminRestoreGate(admin.db(LIVE_DB))).toEqual({ open: true, restored: false });
    } finally {
      await live.shutdown('test');
    }
    await mongoose.connect(uriFor(LIVE_DB));
    await expect(rebaselineAdmins({ targetId: TARGET_ID, ownerEmail: OWNER })).rejects.toMatchObject({ reason: 'NOT_A_RESTORE_TARGET' });
    await mongoose.disconnect();
  }, 60_000);

  it('interrupted recovery: the restored Admin stays CLOSED, and the revoked recruiter cannot get back in', async () => {
    // The older snapshot restored into the target, plus the authorisation prepare-target writes there.
    for (const [name, docs] of Object.entries(state.snapshot)) if (docs.length) await admin.db(RESTORED_DB).collection(name).insertMany(docs);
    await admin.db(RESTORED_DB).collection('restore_authorization').insertOne({ targetId: TARGET_ID, setName: 'qa', database: RESTORED_DB, mode: 'snapshot', purpose: 'valida-restore', authorisedAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) });
    // The restore UNDID the post-snapshot revocation: the recruiter is ACTIVE again in the data.
    expect((await admins(RESTORED_DB).findOne({ emailNormalized: RECRUITER })).status).toBe('ACTIVE');
    expect(await adminRestoreGate(admin.db(RESTORED_DB))).toEqual({ open: false, reason: 'ADMIN_RESTORE_NOT_REBASELINED' });

    // With ADMIN_AUTH the backend refuses to start; the message names the fixed reason, nothing else.
    const refused = await serve(RESTORED_DB).then((s) => s.shutdown('test').then(() => null), (error) => error);
    expect(refused?.name).toBe('AdminRestoreClosedError');
    expect(refused.reason).toBe('ADMIN_RESTORE_NOT_REBASELINED');
    expect(formatStartupFailure(refused)).toMatch(/Admin surface is closed on this restored database \(ADMIN_RESTORE_NOT_REBASELINED\)/);

    // Without ADMIN_AUTH it serves the applicant API only: no Admin route exists, so no old credential is even checked.
    const closed = await serve(RESTORED_DB, { adminAuth: false });
    try {
      const recruiter = agentFor(closed.base);
      expect((await recruiter.post('/api/v1/auth/login', { realm: 'ADMIN', email: RECRUITER, password: OTHER_PASSWORD })).status).toBe(404);
      expect((await withCookie(closed.base, state.recruiterCookie, '/api/v1/admin/overview')).status).toBe(404);
      expect((await request(closed.base).get('/api/v1/health')).status).toBe(200);
    } finally {
      await closed.shutdown('test');
    }
  }, 60_000);

  it('an interrupted re-baseline (stopped before its last step) leaves the Admin closed; refusals change nothing', async () => {
    await mongoose.connect(uriFor(RESTORED_DB));
    try {
      const before = await admins(RESTORED_DB).find({}).toArray();
      await expect(rebaselineAdmins({ targetId: TARGET_ID, ownerEmail: 'nobody@example.invalid' })).rejects.toMatchObject({ reason: 'OWNER_NOT_FOUND' });
      await expect(rebaselineAdmins({ targetId: TARGET_ID, ownerEmail: RECRUITER })).rejects.toMatchObject({ reason: 'OWNER_NOT_FOUND' }); // not an owner
      await expect(rebaselineAdmins({ targetId: randomBytes(16).toString('hex'), ownerEmail: OWNER })).rejects.toMatchObject({ reason: 'NOT_A_RESTORE_TARGET' });
      expect(await admins(RESTORED_DB).find({}).toArray()).toEqual(before); // refusals wrote nothing

      const interrupted = rebaselineAdmins({ targetId: TARGET_ID, ownerEmail: OWNER, writeMark: async () => { throw Object.assign(new Error('interrupted'), { name: 'MongoNetworkError' }); } });
      await expect(interrupted).rejects.toThrow('interrupted');
    } finally {
      await mongoose.disconnect();
    }
    expect(await admin.db(RESTORED_DB).collection(ADMIN_RESTORE_STATE_COLLECTION).countDocuments({})).toBe(0);
    expect(await adminRestoreGate(admin.db(RESTORED_DB))).toEqual({ open: false, reason: 'ADMIN_RESTORE_NOT_REBASELINED' });
    const refused = await serve(RESTORED_DB).then((s) => s.shutdown('test').then(() => null), (error) => error);
    expect(refused?.reason).toBe('ADMIN_RESTORE_NOT_REBASELINED');
  }, 60_000);

  it('re-baselined: old cookies, passwords, invitation, TOTP and recovery codes regain nothing; only the freshly enrolled owner signs in', async () => {
    await mongoose.connect(uriFor(RESTORED_DB));
    let done;
    try {
      done = await rebaselineAdmins({ targetId: TARGET_ID, ownerEmail: OWNER }); // safe to re-run after the interruption
      await expect(rebaselineAdmins({ targetId: TARGET_ID, ownerEmail: OWNER })).rejects.toBeInstanceOf(AdminRestoreRefused);
    } finally {
      await mongoose.disconnect();
    }
    expect(done).toMatchObject({ adminsDisabled: 3, sessionsRemoved: 0 }); // the interrupted run already removed the sessions
    const after = await admins(RESTORED_DB).find({}).toArray();
    for (const a of after) {
      expect(a.authentication.passwordHash).toBeNull();
      expect(a.authentication.resetTokenHash).toBeNull();
      expect(a.mfa).toMatchObject({ enabled: false, secretCiphertext: null, recoveryCodes: [] });
      if (a.emailNormalized === OWNER) expect(a).toMatchObject({ status: 'ACTIVE', authentication: { activationTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) } });
      else expect(a).toMatchObject({ status: 'DISABLED', authentication: { activationTokenHash: null } });
    }
    expect(await admin.db(RESTORED_DB).collection('admin_sessions').countDocuments({})).toBe(0);
    expect(await admin.db(RESTORED_DB).collection('audit_events').countDocuments({ action: 'ADMIN_RESTORE_REBASELINED' })).toBe(2); // the interrupted attempt is audited too
    expect(await adminRestoreGate(admin.db(RESTORED_DB))).toEqual({ open: true, restored: true });

    // Worst case: the operator did NOT rotate the session secret. Old cookies still regain nothing.
    const server = await serve(RESTORED_DB);
    try {
      expect((await withCookie(server.base, state.ownerCookie, '/api/v1/admin/overview')).status).toBe(401);
      expect((await withCookie(server.base, state.recruiterCookie, '/api/v1/admin/overview')).status).toBe(401);
      expect((await withCookie(server.base, state.ownerCookie, '/api/v1/auth/sessions')).status).toBe(401);

      // Old passwords: generic refusal for the owner (no password yet) and the recruiter (disabled).
      for (const [email, password] of [[OWNER, STRONG_PASSWORD], [RECRUITER, OTHER_PASSWORD]]) {
        const c = agentFor(server.base);
        const r = await c.post('/api/v1/auth/login', { realm: 'ADMIN', email, password }, await csrfFor(c));
        expect(r.status, email).toBe(401);
        expect(r.body.error.code).toBe('INVALID_CREDENTIALS');
      }
      // The invitation issued before the snapshot is void.
      const invited = agentFor(server.base);
      const inv = await invited.post('/api/v1/auth/activation', { token: state.inviteToken, password: NEW_PASSWORD }, await csrfFor(invited));
      expect(inv.status).toBe(400);
      expect(inv.body.error.code).toBe('ACTIVATION_INVALID');

      // The owner, freshly: the new link, a new password, a NEW MFA secret.
      const clock = testClock(Date.now());
      const fresh = agentFor(server.base);
      const enrolled = await activateAndEnroll({ client: fresh, token: done.token, clock, password: NEW_PASSWORD });
      expect(enrolled.secret).not.toBe(state.ownerSecret);
      await fresh.get('/api/v1/admin/overview').expect(200);
      await fresh.post('/api/v1/auth/logout', {}, enrolled.csrf).expect(200);

      // Sign in again: the OLD TOTP secret and an OLD recovery code are refused at the MFA step; the new secret works.
      clock.advance(30_000);
      let csrf = await csrfFor(fresh);
      const login = await fresh.post('/api/v1/auth/login', { realm: 'ADMIN', email: OWNER, password: NEW_PASSWORD }, csrf).expect(200);
      csrf = login.body.data.csrfToken;
      const oldCode = currentCode(state.ownerSecret, clock);
      const newCode = currentCode(enrolled.secret, clock);
      if (oldCode !== newCode) expect((await fresh.post('/api/v1/auth/mfa/verify', { code: oldCode }, csrf)).status).toBe(401);
      expect((await fresh.post('/api/v1/auth/mfa/verify', { recoveryCode: state.ownerRecovery[0] }, csrf)).status).toBe(401);
      await fresh.post('/api/v1/auth/mfa/verify', { code: newCode }, csrf).expect(200);
      await fresh.get('/api/v1/admin/overview').expect(200);

      // The recruiter stays disabled until the owner re-invites them.
      const r = agentFor(server.base);
      expect((await r.post('/api/v1/auth/login', { realm: 'ADMIN', email: RECRUITER, password: OTHER_PASSWORD }, await csrfFor(r))).status).toBe(401);
    } finally {
      await server.shutdown('test');
    }
  }, 90_000);
});
