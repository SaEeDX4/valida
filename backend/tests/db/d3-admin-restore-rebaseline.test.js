import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { startServer, formatStartupFailure } from '../../src/server.js';
import { loadConfig } from '../../src/config/env.js';
import { REQUIRED_INDEXES } from '../../src/db/indexes.js';
import { ADMIN_RESTORE_STATE_COLLECTION, PENDING_LEASE_MS, RUN_LEASE_MS, adminStartupGate, initLiveAnchor, rebaselineAdmins } from '../../src/modules/admin/restoreRebaseline.js';
import { TEST_RECRUITMENT_ENV, freePort } from '../helpers.js';
import { requireTestDatabase } from './testDatabase.js';
import { ADMIN_ORIGIN, OTHER_PASSWORD, STRONG_PASSWORD, activateAndEnroll, agentFor, csrfFor, currentCode, provisionAdmin, testClock } from './adminHarness.js';

/**
 * D-3 (owner, 2026-11-22; correction 1) — the Admin is bound to its database. Real
 * server, real session store, real Argon2id; several databases stand in for the
 * live database and restores of it. Synthetic data only.
 *
 *   identity  the intended live database (its anchor) starts normally; a wrong
 *             configured cluster, a fresh unmarked restore and a restore carrying an
 *             OLDER completion marker stay closed until their OWN recovery completes;
 *   delivery  the activation link is delivered privately and durably BEFORE any
 *             Admin write: a write failure, an existing file and an unsafe directory
 *             change nothing; an interruption resumes with the SAME link; concurrent
 *             attempts have exactly one winner whose link stays valid; a stale attempt
 *             can never overwrite a newer one; the marker is published only after delivery;
 *   access    after re-baselining, old cookies, passwords, invitation, TOTP and recovery
 *             codes regain nothing; only the freshly enrolled owner signs in.
 *
 * The applicant-deletion gate that must pass first is exercised through the CLI in
 * tests/recovery/admin-rebaseline.test.js (two replica sets).
 */
const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const { MongoClient } = mongoose.mongo;
const uriFor = (db) => TEST_URI.replace(/\/[^/?]*(\?|$)/, `/${db}$1`);
const LIVE_DB = `${TEST_DATABASE}_d3live`;
const RESTORED_DB = `${TEST_DATABASE}_d3rst`;
const RESTORED2_DB = `${TEST_DATABASE}_d3rst2`;
const TARGET_ID = randomBytes(16).toString('hex');
const TARGET2_ID = randomBytes(16).toString('hex');
const OWNER = `qa-owner-${randomBytes(3).toString('hex')}@example.invalid`;
const RECRUITER = `qa-recruiter-${randomBytes(3).toString('hex')}@example.invalid`;
const INVITED = `qa-invited-${randomBytes(3).toString('hex')}@example.invalid`;
const OTHER_OWNER = `qa-owner2-${randomBytes(3).toString('hex')}@example.invalid`;
const OLD_TARGET = 'f'.repeat(32);
const SESSION_SECRET = randomBytes(32).toString('base64url');
const MFA_KEYS = `qa1:${randomBytes(32).toString('base64')}`;
const NEW_PASSWORD = 'QA fresh owner passphrase 4 harbours';
let admin;
let root;
let dir;
const state = {};

function envFor(db, { adminAuth = true, set = 'standalone' } = {}) {
  return {
    ...TEST_RECRUITMENT_ENV, APP_ENV: 'local', NODE_ENV: 'test', LOG_LEVEL: process.env.QA_LOG_LEVEL ?? 'silent',
    MONGODB_URI: uriFor(db), CORS_ALLOWED_ORIGINS: ADMIN_ORIGIN, APPLICATION_RATE_LIMIT_MAX: '1000',
    ...(adminAuth
      ? { ADMIN_AUTH: 'enabled', ADMIN_SESSION_SECRET: SESSION_SECRET, ADMIN_MFA_KEYS: MFA_KEYS, ADMIN_MFA_CURRENT_KEY_ID: 'qa1', ADMIN_APP_ORIGIN: ADMIN_ORIGIN, ADMIN_LOGIN_RATE_LIMIT_MAX: '1000', ...(set ? { ADMIN_DATABASE_REPLICA_SET: set } : {}) }
      : {}),
  };
}
async function serve(db, options) {
  const port = await freePort();
  const server = await startServer({ env: { ...envFor(db, options), PORT: String(port) }, uploadTempBaseDirectory: root });
  server.base = `http://127.0.0.1:${port}`;
  return server;
}
/** The start-up verdict: null when the backend started (and is stopped again), else the refusal. */
const startOutcome = (db, options) => serve(db, options).then((s) => s.shutdown('test').then(() => null), (error) => error);
const admins = (db) => admin.db(db).collection('admins');
const withCookie = (base, cookie, p) => request(base).get(p).set('Origin', ADMIN_ORIGIN).set('Cookie', cookie);
const gate = (db, set = 'standalone') => adminStartupGate(admin.db(db), { expectedReplicaSet: set });
async function copyDatabase(from, to) {
  await admin.db(to).dropDatabase();
  for (const { name } of await admin.db(from).listCollections({}, { nameOnly: true }).toArray()) {
    const docs = await admin.db(from).collection(name).find({}).toArray();
    if (docs.length) await admin.db(to).collection(name).insertMany(docs);
  }
}
const authorise = (db, targetId) => admin.db(db).collection('restore_authorization').insertOne({ targetId, setName: 'standalone', database: db, mode: 'snapshot', purpose: 'valida-restore', authorisedAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) });
const linkPath = (name) => path.join(dir, name);
const tokenIn = (file) => /#token=([A-Za-z0-9_-]+)/.exec(fs.readFileSync(file, 'utf8'))[1];
const sha = (v) => createHash('sha256').update(v).digest('hex');
async function on(db, fn) {
  await mongoose.connect(uriFor(db));
  try {
    return await fn();
  } finally {
    await mongoose.connection.close(); // only the default connection (a worker's own connection stays open)
  }
}

beforeAll(async () => {
  admin = new MongoClient(TEST_URI);
  await admin.connect();
  for (const db of [LIVE_DB, RESTORED_DB, RESTORED2_DB]) await admin.db(db).dropDatabase();
  for (const required of REQUIRED_INDEXES) await admin.db(LIVE_DB).collection(required.collection).createIndex(required.key, { name: required.name, ...required.options });
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-d3-'));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-d3-links-')); // 0700: private to this user
}, 60_000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  for (const db of [LIVE_DB, RESTORED_DB, RESTORED2_DB]) await admin.db(db).dropDatabase().catch(() => {});
  await admin.close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
}, 30_000);

describe('D-3: the Admin is bound to its database', () => {
  it('live: unprovisioned or misconfigured stays closed; with its anchor the intended live database starts normally', async () => {
    expect((await startOutcome(LIVE_DB))?.reason).toBe('ADMIN_DATABASE_NOT_PROVISIONED');
    expect(await initLiveAnchor(admin.db(LIVE_DB))).toMatchObject({ created: true, identity: { setName: 'standalone', database: LIVE_DB } });
    expect(await initLiveAnchor(admin.db(LIVE_DB))).toMatchObject({ created: false });
    expect((await startOutcome(LIVE_DB, { set: null }))?.reason).toBe('ADMIN_DATABASE_IDENTITY_NOT_CONFIGURED');
    expect((await startOutcome(LIVE_DB, { set: 'rs-some-other-cluster' }))?.reason).toBe('ADMIN_DATABASE_IDENTITY_MISMATCH');
    expect(await gate(LIVE_DB)).toMatchObject({ open: true, basis: 'LIVE_ANCHOR' });

    const live = await serve(LIVE_DB);
    try {
      const clock = testClock(Date.now());
      const config = loadConfig(envFor(LIVE_DB));
      const ownerSeed = await provisionAdmin({ config, clock, email: OWNER, displayName: 'QA Owner' });
      state.ownerAgent = agentFor(live.base);
      const owner = await activateAndEnroll({ client: state.ownerAgent, token: ownerSeed.token, clock });
      Object.assign(state, { ownerSecret: owner.secret, ownerRecovery: owner.recoveryCodes, ownerCsrf: owner.csrf });
      const recruiterSeed = await provisionAdmin({ config, clock, email: RECRUITER, displayName: 'QA Recruiter', roles: ['RECRUITMENT_ADMIN'] });
      state.recruiterId = String(recruiterSeed.admin._id);
      state.recruiterAgent = agentFor(live.base);
      clock.advance(30_000);
      await activateAndEnroll({ client: state.recruiterAgent, token: recruiterSeed.token, clock, password: OTHER_PASSWORD });
      state.inviteToken = (await provisionAdmin({ config, clock, email: INVITED, displayName: 'QA Invited', roles: ['RECRUITMENT_ADMIN'] })).token;
      const jarCookie = (client) => client.agent.jar.getCookies({ domain: '127.0.0.1', path: '/', secure: false, script: false }).toValueString();
      state.ownerCookie = jarCookie(state.ownerAgent);
      state.recruiterCookie = jarCookie(state.recruiterAgent);
      // Control: on the live server these cookies are valid sessions.
      expect((await withCookie(live.base, state.ownerCookie, '/api/v1/admin/overview')).status).toBe(200);
      expect((await withCookie(live.base, state.recruiterCookie, '/api/v1/admin/overview')).status).toBe(200);
      // The snapshot, then a post-snapshot revocation the snapshot does not know.
      await copyDatabase(LIVE_DB, RESTORED_DB);
      await state.ownerAgent.post(`/api/v1/admin/admins/${state.recruiterId}/disable`, {}, state.ownerCsrf).expect(200);
    } finally {
      await live.shutdown('test');
    }
    await on(LIVE_DB, () => expect(rebaselineAdmins({ targetId: TARGET_ID, ownerEmail: OWNER, linkFile: linkPath('live.txt'), appOrigin: ADMIN_ORIGIN })).rejects.toMatchObject({ reason: 'NOT_A_RESTORE_TARGET' }));
  }, 90_000);

  it('a FRESH UNMARKED restore stays closed (inherited anchor), with or without its authorisation; the revoked recruiter is ACTIVE again in it', async () => {
    expect((await admins(RESTORED_DB).findOne({ emailNormalized: RECRUITER })).status).toBe('ACTIVE');
    expect(await gate(RESTORED_DB)).toEqual({ open: false, reason: 'ADMIN_RESTORE_NOT_REBASELINED' });
    expect((await startOutcome(RESTORED_DB))?.reason).toBe('ADMIN_RESTORE_NOT_REBASELINED');
    await expect(initLiveAnchor(admin.db(RESTORED_DB))).rejects.toMatchObject({ reason: 'ANCHOR_OF_ANOTHER_DATABASE' }); // it cannot be re-declared live
    await authorise(RESTORED_DB, TARGET_ID);
    // Restored data as it may really look: a second owner, and a recruiter carrying fences left by an EARLIER restore
    // (an old restoreFence of another target, a high epoch, and the legacy restoreEpoch field). None of it may spare them.
    const seed = await admins(RESTORED_DB).findOne({ emailNormalized: OWNER });
    await admins(RESTORED_DB).insertOne({ ...seed, _id: new mongoose.Types.ObjectId(), email: OTHER_OWNER, emailNormalized: OTHER_OWNER, displayName: 'QA Owner 2' });
    await admins(RESTORED_DB).updateOne({ emailNormalized: RECRUITER }, { $set: { 'authentication.restoreFence': { targetId: OLD_TARGET, epoch: 999 }, 'authentication.restoreEpoch': 999 } });
    const refused = await startOutcome(RESTORED_DB);
    expect(refused?.name).toBe('AdminRestoreClosedError');
    expect(formatStartupFailure(refused)).toMatch(/Admin surface is closed \(ADMIN_RESTORE_NOT_REBASELINED\)/);
    // Without ADMIN_AUTH only the applicant API runs: no Admin route exists, so no old credential is checked.
    const closed = await serve(RESTORED_DB, { adminAuth: false });
    try {
      const r = agentFor(closed.base);
      expect((await r.post('/api/v1/auth/login', { realm: 'ADMIN', email: RECRUITER, password: OTHER_PASSWORD })).status).toBe(404);
      expect((await withCookie(closed.base, state.recruiterCookie, '/api/v1/admin/overview')).status).toBe(404);
      expect((await request(closed.base).get('/api/v1/health')).status).toBe(200);
    } finally {
      await closed.shutdown('test');
    }
  }, 60_000);

  it('delivery failures change nothing: a failed write, an existing file, an unsafe directory', async () => {
    const before = await admins(RESTORED_DB).find({}).toArray();
    const failingSync = { ...fsp, open: async (...a) => { const h = await fsp.open(...a); return Object.assign(Object.create(Object.getPrototypeOf(h)), h, { writeFile: (t) => h.writeFile(t), close: () => h.close(), sync: async () => { throw Object.assign(new Error('EIO'), { code: 'EIO' }); } }); } };
    await on(RESTORED_DB, async () => {
      await expect(rebaselineAdmins({ targetId: TARGET_ID, ownerEmail: OWNER, linkFile: linkPath('owner.txt'), appOrigin: ADMIN_ORIGIN, fs: failingSync })).rejects.toMatchObject({ reason: 'DELIVERY_FAILED' });
      expect(fs.readdirSync(dir)).toEqual([]); // no partial or temporary file left
      fs.writeFileSync(linkPath('taken.txt'), 'someone else\n', { mode: 0o600 });
      await expect(rebaselineAdmins({ targetId: TARGET_ID, ownerEmail: OWNER, linkFile: linkPath('taken.txt'), appOrigin: ADMIN_ORIGIN })).rejects.toMatchObject({ reason: 'LINK_FILE_EXISTS' });
      expect(fs.readFileSync(linkPath('taken.txt'), 'utf8')).toBe('someone else\n'); // never overwritten
      const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-d3-shared-'));
      fs.chmodSync(shared, 0o777);
      try {
        await expect(rebaselineAdmins({ targetId: TARGET_ID, ownerEmail: OWNER, linkFile: path.join(shared, 'owner.txt'), appOrigin: ADMIN_ORIGIN })).rejects.toMatchObject({ reason: 'DELIVERY_DIRECTORY_UNSAFE' });
        expect(fs.readdirSync(shared)).toEqual([]);
      } finally {
        fs.rmSync(shared, { recursive: true, force: true });
      }
      fs.rmSync(linkPath('taken.txt'));
    });
    expect(await admins(RESTORED_DB).find({}).toArray()).toEqual(before);
    expect(await admin.db(RESTORED_DB).collection(ADMIN_RESTORE_STATE_COLLECTION).countDocuments({})).toBe(0);
    expect((await gate(RESTORED_DB)).open).toBe(false);
  }, 60_000);

  it('one claim, one active run, bound owner: concurrent attempts -> one winner; interrupted; a resume is refused while a run holds the lease, for another owner, and twice at once; exactly one resume completes with the same link', async () => {
    const a = linkPath('a.txt');
    const b = linkPath('b.txt');
    const interrupted = { afterClaim: async () => { throw new Error('interrupted after the claim'); } };
    const results = await on(RESTORED_DB, () => Promise.allSettled([
      rebaselineAdmins({ targetId: TARGET_ID, ownerEmail: OWNER, linkFile: a, appOrigin: ADMIN_ORIGIN, hooks: interrupted }),
      rebaselineAdmins({ targetId: TARGET_ID, ownerEmail: OWNER, linkFile: b, appOrigin: ADMIN_ORIGIN, hooks: interrupted }),
    ]));
    expect(results.map((r) => r.reason?.reason ?? r.reason?.message).sort()).toEqual(['REBASELINE_IN_PROGRESS', 'interrupted after the claim']);
    const winnerFile = fs.existsSync(a) ? a : b;
    expect(fs.readdirSync(dir)).toEqual([path.basename(winnerFile)]); // the loser removed its own delivery
    expect(fs.statSync(winnerFile).mode & 0o777).toBe(0o600);
    const claim = await admin.db(RESTORED_DB).collection(ADMIN_RESTORE_STATE_COLLECTION).findOne({ _id: TARGET_ID });
    expect(claim).toMatchObject({ state: 'PENDING', epoch: 1, tokenHash: sha(tokenIn(winnerFile)), setName: 'standalone', database: RESTORED_DB });
    expect(claim.adminIds).toHaveLength(4); // exactly the restored Admins: the revocation is scoped to them
    expect(String(claim.ownerAdminId)).toBe(String((await admins(RESTORED_DB).findOne({ emailNormalized: OWNER }))._id));
    expect((await gate(RESTORED_DB)).open).toBe(false);
    expect((await startOutcome(RESTORED_DB))?.reason).toBe('ADMIN_RESTORE_NOT_REBASELINED');

    const later = () => new Date(Date.now() + RUN_LEASE_MS + 60_000);
    await on(RESTORED_DB, async () => {
      // No delivered file: no takeover; a restart before its lease: refused.
      await expect(rebaselineAdmins({ targetId: TARGET_ID, ownerEmail: OWNER, linkFile: linkPath('other.txt'), appOrigin: ADMIN_ORIGIN })).rejects.toMatchObject({ reason: 'REBASELINE_IN_PROGRESS', detail: { pendingAttempt: claim.attempt } });
      await expect(rebaselineAdmins({ targetId: TARGET_ID, ownerEmail: OWNER, linkFile: linkPath('other.txt'), appOrigin: ADMIN_ORIGIN, restartPending: claim.attempt, clock: later })).rejects.toMatchObject({ reason: 'REBASELINE_IN_PROGRESS' });
      // The interrupted run's lease still holds: no second active run.
      await expect(rebaselineAdmins({ targetId: TARGET_ID, ownerEmail: OWNER, linkFile: winnerFile, appOrigin: ADMIN_ORIGIN })).rejects.toMatchObject({ reason: 'REBASELINE_IN_PROGRESS' });
      // Bound to the original owner: another owner, even after the lease, is refused.
      await expect(rebaselineAdmins({ targetId: TARGET_ID, ownerEmail: OTHER_OWNER, linkFile: winnerFile, appOrigin: ADMIN_ORIGIN, clock: later })).rejects.toMatchObject({ reason: 'OWNER_MISMATCH' });
    });
    expect(fs.existsSync(linkPath('other.txt'))).toBe(false);
    expect(await admin.db(RESTORED_DB).collection(ADMIN_RESTORE_STATE_COLLECTION).findOne({ _id: TARGET_ID })).toMatchObject({ state: 'PENDING', epoch: 1 });

    // Two resumes at once after the lease: exactly one runs; it completes with the SAME link.
    const tokenBefore = tokenIn(winnerFile);
    const resumes = await on(RESTORED_DB, () => Promise.allSettled([1, 2].map(() => rebaselineAdmins({ targetId: TARGET_ID, ownerEmail: OWNER, linkFile: winnerFile, appOrigin: ADMIN_ORIGIN, clock: later }))));
    const won = resumes.filter((r) => r.status === 'fulfilled');
    expect(won).toHaveLength(1);
    expect(resumes.find((r) => r.status === 'rejected').reason).toMatchObject({ reason: 'REBASELINE_IN_PROGRESS' });
    expect(won[0].value).toMatchObject({ resumed: true, attempt: claim.attempt, epoch: 2, adminsDisabled: 4 });
    expect(tokenIn(winnerFile)).toBe(tokenBefore);
    state.token = tokenBefore;
    expect(await admin.db(RESTORED_DB).collection(ADMIN_RESTORE_STATE_COLLECTION).findOne({ _id: TARGET_ID })).toMatchObject({ state: 'REBASELINED', attempt: claim.attempt, epoch: 2 });
    expect((await admins(RESTORED_DB).findOne({ emailNormalized: OWNER })).authentication).toMatchObject({ activationTokenHash: sha(tokenBefore), restoreFence: { targetId: TARGET_ID, epoch: 2 } });
    // An old restoreFence / restoreEpoch spared nobody.
    const recruiter = await admins(RESTORED_DB).findOne({ emailNormalized: RECRUITER });
    expect(recruiter).toMatchObject({ status: 'DISABLED', authentication: { passwordHash: null, restoreFence: { targetId: TARGET_ID, epoch: 2 } }, mfa: { enabled: false, secretCiphertext: null } });
    expect((await admins(RESTORED_DB).findOne({ emailNormalized: OTHER_OWNER })).status).toBe('DISABLED');
    expect(await gate(RESTORED_DB)).toMatchObject({ open: true, basis: 'REBASELINED' });
    await on(RESTORED_DB, () => expect(rebaselineAdmins({ targetId: TARGET_ID, ownerEmail: OWNER, linkFile: winnerFile, appOrigin: ADMIN_ORIGIN })).rejects.toMatchObject({ reason: 'ALREADY_REBASELINED' }));
  }, 60_000);

  it('re-baselined: old cookies, passwords, invitation, TOTP and recovery codes regain nothing; only the freshly enrolled owner signs in', async () => {
    for (const a of await admins(RESTORED_DB).find({}).toArray()) {
      expect(a.authentication.passwordHash).toBeNull();
      expect(a.mfa).toMatchObject({ enabled: false, secretCiphertext: null, recoveryCodes: [] });
      expect(a.status).toBe(a.emailNormalized === OWNER ? 'ACTIVE' : 'DISABLED');
    }
    expect(await admin.db(RESTORED_DB).collection('admin_sessions').countDocuments({})).toBe(0);
    const server = await serve(RESTORED_DB); // worst case: the SAME session secret as live
    try {
      expect((await withCookie(server.base, state.ownerCookie, '/api/v1/admin/overview')).status).toBe(401);
      expect((await withCookie(server.base, state.recruiterCookie, '/api/v1/admin/overview')).status).toBe(401);
      for (const [email, password] of [[OWNER, STRONG_PASSWORD], [RECRUITER, OTHER_PASSWORD]]) {
        const c = agentFor(server.base);
        const r = await c.post('/api/v1/auth/login', { realm: 'ADMIN', email, password }, await csrfFor(c));
        expect(r.status, email).toBe(401);
        expect(r.body.error.code).toBe('INVALID_CREDENTIALS');
      }
      const invited = agentFor(server.base);
      expect((await invited.post('/api/v1/auth/activation', { token: state.inviteToken, password: NEW_PASSWORD }, await csrfFor(invited))).body.error.code).toBe('ACTIVATION_INVALID');

      const clock = testClock(Date.now());
      const fresh = agentFor(server.base);
      const enrolled = await activateAndEnroll({ client: fresh, token: state.token, clock, password: NEW_PASSWORD });
      expect(enrolled.secret).not.toBe(state.ownerSecret);
      await fresh.get('/api/v1/admin/overview').expect(200);
      await fresh.post('/api/v1/auth/logout', {}, enrolled.csrf).expect(200);
      clock.advance(30_000);
      let csrf = await csrfFor(fresh);
      csrf = (await fresh.post('/api/v1/auth/login', { realm: 'ADMIN', email: OWNER, password: NEW_PASSWORD }, csrf).expect(200)).body.data.csrfToken;
      const oldCode = currentCode(state.ownerSecret, clock);
      const newCode = currentCode(enrolled.secret, clock);
      if (oldCode !== newCode) expect((await fresh.post('/api/v1/auth/mfa/verify', { code: oldCode }, csrf)).status).toBe(401);
      expect((await fresh.post('/api/v1/auth/mfa/verify', { recoveryCode: state.ownerRecovery[0] }, csrf)).status).toBe(401);
      await fresh.post('/api/v1/auth/mfa/verify', { code: newCode }, csrf).expect(200);
      await fresh.get('/api/v1/admin/overview').expect(200);
    } finally {
      await server.shutdown('test');
    }
  }, 90_000);

  it('a restore carrying an OLDER completion marker stays closed until its own recovery; a LATE worker cannot disable the recovered owner, clear sessions or touch an Admin created after recovery', async () => {
    // A snapshot of the re-baselined, now-used database (its authorisation, its marker, its fences, its sessions), restored elsewhere.
    await copyDatabase(RESTORED_DB, RESTORED2_DB);
    expect(await admin.db(RESTORED2_DB).collection(ADMIN_RESTORE_STATE_COLLECTION).countDocuments({ _id: TARGET_ID, state: 'REBASELINED' })).toBe(1);
    expect(await gate(RESTORED2_DB)).toEqual({ open: false, reason: 'ADMIN_RESTORE_NOT_REBASELINED' });
    expect((await startOutcome(RESTORED2_DB))?.reason).toBe('ADMIN_RESTORE_NOT_REBASELINED');
    await on(RESTORED2_DB, () => expect(rebaselineAdmins({ targetId: TARGET_ID, ownerEmail: OWNER, linkFile: linkPath('old.txt'), appOrigin: ADMIN_ORIGIN })).rejects.toMatchObject({ reason: 'AUTHORISATION_FOR_OTHER_DATABASE' }));
    await authorise(RESTORED2_DB, TARGET2_ID);
    expect((await gate(RESTORED2_DB)).open).toBe(false);

    // Worker X claims on its OWN connection and stalls. Its run lease lapses; the owner restarts it as R (a new link).
    const xConn = await mongoose.createConnection(uriFor(RESTORED2_DB)).asPromise();
    let release;
    const stalled = new Promise((resolve) => { release = resolve; });
    const t0 = Date.now();
    const x = rebaselineAdmins({ targetId: TARGET2_ID, ownerEmail: OWNER, linkFile: linkPath('x.txt'), appOrigin: ADMIN_ORIGIN, clock: () => new Date(t0), hooks: { afterClaim: () => stalled }, connection: xConn });
    for (let i = 0; i < 50 && !(await admin.db(RESTORED2_DB).collection(ADMIN_RESTORE_STATE_COLLECTION).findOne({ _id: TARGET2_ID })); i += 1) await new Promise((r) => setTimeout(r, 50));
    const claimX = await admin.db(RESTORED2_DB).collection(ADMIN_RESTORE_STATE_COLLECTION).findOne({ _id: TARGET2_ID });
    // The inherited fences ({ TARGET_ID, epoch 2 }) are another restore's: they will not spare anyone from THIS one.
    const r = await on(RESTORED2_DB, () => rebaselineAdmins({ targetId: TARGET2_ID, ownerEmail: OWNER, linkFile: linkPath('r.txt'), appOrigin: ADMIN_ORIGIN, restartPending: claimX.attempt, clock: () => new Date(t0 + PENDING_LEASE_MS + 60_000) }));
    expect(r).toMatchObject({ resumed: false, epoch: 2, adminsDisabled: 4 });
    expect(await admin.db(RESTORED2_DB).collection(ADMIN_RESTORE_STATE_COLLECTION).findOne({ _id: TARGET2_ID })).toMatchObject({ state: 'REBASELINED', epoch: 2, attempt: r.attempt, setName: 'standalone', database: RESTORED2_DB });
    for (const a of await admins(RESTORED2_DB).find({}).toArray()) expect(a.authentication.restoreFence).toEqual({ targetId: TARGET2_ID, epoch: 2 });
    expect(await admin.db(RESTORED2_DB).collection('admin_sessions').countDocuments({})).toBe(0);

    // The recovered owner activates, enrols and signs in; an Admin is invited after recovery.
    const server = await serve(RESTORED2_DB);
    try {
      const clock = testClock(Date.now());
      const owner = agentFor(server.base);
      await activateAndEnroll({ client: owner, token: tokenIn(linkPath('r.txt')), clock, password: NEW_PASSWORD });
      await owner.get('/api/v1/admin/overview').expect(200);
      const config = loadConfig(envFor(RESTORED2_DB));
      await provisionAdmin({ config, clock, email: `qa-after-${randomBytes(3).toString('hex')}@example.invalid`, displayName: 'QA After Recovery', roles: ['RECRUITMENT_ADMIN'] });
      const before = { admins: await admins(RESTORED2_DB).find({}).sort({ _id: 1 }).toArray(), sessions: await admin.db(RESTORED2_DB).collection('admin_sessions').find({}).sort({ _id: 1 }).toArray() };
      expect(before.sessions.length).toBeGreaterThanOrEqual(1);

      // Now the late worker X wakes: it is fenced out of every write.
      release();
      await expect(x).rejects.toMatchObject({ reason: 'REBASELINE_SUPERSEDED' });
      expect(await admins(RESTORED2_DB).find({}).sort({ _id: 1 }).toArray()).toEqual(before.admins); // owner still ACTIVE with password and MFA; the new Admin untouched
      expect(await admin.db(RESTORED2_DB).collection('admin_sessions').find({}).sort({ _id: 1 }).toArray()).toEqual(before.sessions); // no session cleared
      const recovered = before.admins.find((a) => a.emailNormalized === OWNER);
      expect(recovered).toMatchObject({ status: 'ACTIVE', mfa: { enabled: true } });
      expect(recovered.authentication.passwordHash).toMatch(/^\$argon2id\$/);
      await owner.get('/api/v1/admin/overview').expect(200); // the recovered owner's session still works
      // The winner's link was R's; X's never armed anyone.
      expect(recovered.authentication.activationTokenHash).toBeNull(); // consumed by the activation
      expect(sha(tokenIn(linkPath('x.txt')))).not.toBe(sha(tokenIn(linkPath('r.txt'))));
    } finally {
      await server.shutdown('test');
      await xConn.close();
    }
    expect(await gate(RESTORED2_DB)).toMatchObject({ open: true, basis: 'REBASELINED' });
  }, 90_000);
});
