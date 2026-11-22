import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { REQUIRED_INDEXES } from '../../src/db/indexes.js';
import { AUTH_LEVEL, SESSION_COLLECTION } from '../../src/modules/admin/session.js';
import { hashRecoveryCode } from '../../src/modules/admin/auth/secrets.js';
import { requireTestDatabase, assertConnectedToTestDatabase } from './testDatabase.js';
import { OTHER_PASSWORD, STRONG_PASSWORD, Admin, agentFor, buildAdminApp, clearAdminCollections, csrfFor, currentCode, provisionAdmin, readyAdmin } from './adminHarness.js';

/**
 * E1 correction: write-time checks for MFA enrolment completion, activation and password reset.
 *
 * Each completion is one conditional write. The state it was checked against must still hold when it
 * writes, so a change made between a request's read and its write must win. These tests put a change in
 * exactly that gap: a spy on Admin.findOneAndUpdate (the completion write) runs the change and then lets
 * the real write go ahead. For concurrent enrolment, a barrier holds both requests at the write until both
 * have passed every read-time check. Real MongoDB, real session store, real Argon2id. Synthetic data only.
 */

const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const CONNECT = { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false };
const sessions = () => mongoose.connection.collection(SESSION_COLLECTION);
const auditActions = async () => (await mongoose.connection.collection('audit_events').find({}).toArray()).map((e) => e.action);
const SECRET_FIELDS =
  '+authentication.passwordHash +authentication.activationTokenHash +authentication.resetTokenHash +mfa.secretCiphertext +mfa.pendingSecretCiphertext +mfa.recoveryCodes';
const ORIGINAL_WRITE = Admin.findOneAndUpdate;

beforeAll(async () => {
  await mongoose.connect(TEST_URI, CONNECT);
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  for (const required of REQUIRED_INDEXES) {
    await mongoose.connection.db.collection(required.collection).createIndex(required.key, { name: required.name, ...required.options });
  }
}, 30_000);

afterAll(async () => {
  await clearAdminCollections();
  await mongoose.disconnect();
}, 30_000);

let env;
beforeEach(async () => {
  await clearAdminCollections();
  env = buildAdminApp({ uri: TEST_URI });
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Runs `change` after the request's read-time checks, immediately before its completion write. */
function changeBeforeTheWrite(change) {
  vi.spyOn(Admin, 'findOneAndUpdate').mockImplementationOnce(async (...args) => {
    await change();
    return ORIGINAL_WRITE.apply(Admin, args);
  });
}

/** Holds every completion write until `count` requests have reached it, then releases them together. */
function holdWritesUntil(count) {
  let arrived = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  vi.spyOn(Admin, 'findOneAndUpdate').mockImplementation(async (...args) => {
    arrived += 1;
    if (arrived >= count) release();
    await Promise.race([gate, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    return ORIGINAL_WRITE.apply(Admin, args);
  });
  return () => arrived;
}

const raw = (id, $set) => mongoose.connection.collection('admins').updateOne({ _id: id }, { $set });
const credentials = async (id) => {
  const a = await Admin.findById(id).select(SECRET_FIELDS).lean();
  return {
    status: a.status,
    authVersion: a.authentication.authVersion,
    passwordHash: a.authentication.passwordHash ?? null,
    passwordChangedAt: a.authentication.passwordChangedAt ?? null,
    activationTokenHash: a.authentication.activationTokenHash ?? null,
    resetTokenHash: a.authentication.resetTokenHash ?? null,
    mfaEnabled: a.mfa.enabled,
    secretCiphertext: a.mfa.secretCiphertext ?? null,
    pendingSecretCiphertext: a.mfa.pendingSecretCiphertext ?? null,
    recoveryCodes: a.mfa.recoveryCodes ?? [],
  };
};
const authenticatedSessions = (id) => sessions().countDocuments({ 'session.principalId': String(id), 'session.authenticationLevel': AUTH_LEVEL.AUTHENTICATED });

/** Activated, with a pending enrolment started; returns the pre-auth client, its CSRF token and the pending secret. */
async function pendingEnrollment(email) {
  const { clock, config, app } = env;
  const { admin, token } = await provisionAdmin({ config, clock, email });
  const client = agentFor(app);
  const activated = await client.post('/api/v1/auth/activation', { token, password: STRONG_PASSWORD }, await csrfFor(client)).expect(200);
  const csrf = activated.body.data.csrfToken;
  const start = await client.post('/api/v1/auth/mfa/enroll/start', {}, csrf).expect(200);
  return { admin, client, csrf, secret: start.body.data.secret };
}

async function expectNoSession(client) {
  const state = (await client.get('/api/v1/auth/session')).body.data;
  expect(state.authenticated).toBe(false);
  expect(state.pending).toBeUndefined();
  await client.get('/api/v1/admin/overview').expect(401);
}

describe('MFA enrolment completion is one atomic, write-time-checked write', () => {
  it('lets exactly one of two concurrent completions of the same pending enrolment succeed', async () => {
    const { clock, app } = env;
    const email = 'qa-race@example.invalid';
    const first = await pendingEnrollment(email);
    // A second pre-auth session for the same account, from a password sign-in. It sees the same pending enrolment.
    const second = agentFor(app);
    const login = await second.post('/api/v1/auth/login', { realm: 'ADMIN', email, password: STRONG_PASSWORD }, await csrfFor(second)).expect(200);
    expect(login.body.data.pending).toBe('MFA_ENROLLMENT_REQUIRED');

    const arrivals = holdWritesUntil(2);
    const code = currentCode(first.secret, clock);
    const responses = await Promise.all([
      first.client.post('/api/v1/auth/mfa/enroll/verify', { code }, first.csrf),
      second.post('/api/v1/auth/mfa/enroll/verify', { code }, login.body.data.csrfToken),
    ]);
    // Both passed every read-time check and reached the write together: a real race, not two sequential calls.
    expect(arrivals()).toBe(2);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = responses.find((r) => r.status === 200);
    const loser = responses.find((r) => r.status === 409);
    const [winnerClient, loserClient] = winner === responses[0] ? [first.client, second] : [second, first.client];

    expect(winner.body.data.recoveryCodes).toHaveLength(10);
    expect(loser.body.error.code).toBe('MFA_ENROLLMENT_CONFLICT');
    expect(loser.body.data).toBeUndefined();
    expect(JSON.stringify(loser.body)).not.toMatch(/recoveryCodes|csrfToken/);

    // Only the winner's codes are stored; only the winner holds a session.
    const stored = await credentials(first.admin._id);
    expect(stored.mfaEnabled).toBe(true);
    expect(stored.recoveryCodes.map((c) => c.hash).sort()).toEqual(winner.body.data.recoveryCodes.map(hashRecoveryCode).sort());
    expect(await authenticatedSessions(first.admin._id)).toBe(1);
    await winnerClient.get('/api/v1/admin/overview').expect(200);
    await expectNoSession(loserClient);
    expect((await auditActions()).filter((a) => a === 'MFA_ENROLLED')).toHaveLength(1);
  });

  it.each([
    ['the account is disabled', (id) => raw(id, { status: 'DISABLED' }), 401, 'SESSION_REVOKED'],
    ['its sessions are revoked (auth version moved on)', (id) => mongoose.connection.collection('admins').updateOne({ _id: id }, { $inc: { 'authentication.authVersion': 1 } }), 401, 'SESSION_REVOKED'],
    ['the enrolment is restarted with a new secret', (id) => raw(id, { 'mfa.pendingSecretCiphertext': 'qa-replaced-ciphertext' }), 409, 'MFA_ENROLLMENT_CONFLICT'],
    ['MFA is enabled by another completion', (id) => raw(id, { 'mfa.enabled': true }), 409, 'MFA_ENROLLMENT_CONFLICT'],
  ])('refuses a completion when, after its checks, %s: no credential change, no session, no codes', async (_label, change, status, code) => {
    const { clock } = env;
    const { admin, client, csrf, secret } = await pendingEnrollment('qa-stale@example.invalid');
    changeBeforeTheWrite(() => change(admin._id));
    const before = await credentials(admin._id);

    const res = await client.post('/api/v1/auth/mfa/enroll/verify', { code: currentCode(secret, clock) }, csrf);
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
    expect(res.body.data).toBeUndefined();
    const after = await credentials(admin._id);
    // Nothing the completion would write was written: no secret, no codes, the pending state as the change left it.
    expect(after.secretCiphertext).toBeNull();
    expect(after.recoveryCodes).toEqual([]);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(await authenticatedSessions(admin._id)).toBe(0);
    await expectNoSession(client);
    expect(await auditActions()).not.toContain('MFA_ENROLLED');
  });

  it('refuses a completion whose pending enrolment expires between its checks and its write; the setup can restart', async () => {
    const { clock } = env;
    const { admin, client, csrf, secret } = await pendingEnrollment('qa-expiring@example.invalid');
    changeBeforeTheWrite(() => raw(admin._id, { 'mfa.pendingExpiresAt': new Date(clock.ms() - 1) }));

    const res = await client.post('/api/v1/auth/mfa/enroll/verify', { code: currentCode(secret, clock) }, csrf).expect(400);
    expect(res.body.error.code).toBe('MFA_ENROLLMENT_EXPIRED');
    const after = await credentials(admin._id);
    expect(after.mfaEnabled).toBe(false);
    expect(after.recoveryCodes).toEqual([]);
    expect(await authenticatedSessions(admin._id)).toBe(0);
    // Still only a pre-auth session: no Admin access, but a fresh setup can be started.
    expect((await client.get('/api/v1/auth/session')).body.data.pending).toBe('MFA_ENROLLMENT_REQUIRED');
    await client.get('/api/v1/admin/overview').expect(401);
    await client.post('/api/v1/auth/mfa/enroll/start', {}, csrf).expect(200);
  });

  it('refuses an expired enrolment outright, and a stale enrolment session cannot start one on an enrolled account', async () => {
    const { clock, config, app } = env;
    const { admin, client, csrf, secret } = await pendingEnrollment('qa-late-enrol@example.invalid');
    // Expired already at read time (the pre-auth session is still within its own limit).
    await raw(admin._id, { 'mfa.pendingExpiresAt': new Date(clock.ms() - 1) });
    const late = await client.post('/api/v1/auth/mfa/enroll/verify', { code: currentCode(secret, clock) }, csrf).expect(400);
    expect(late.body.error.code).toBe('MFA_ENROLLMENT_EXPIRED');
    expect((await credentials(admin._id)).mfaEnabled).toBe(false);

    // A second account: enrolled through one session while another enrolment session is still open.
    const owner = await readyAdmin({ app, config, clock, email: 'qa-enrolled@example.invalid' });
    const stale = agentFor(app);
    await raw(owner.admin._id, { 'mfa.enabled': false });
    const login = await stale.post('/api/v1/auth/login', { realm: 'ADMIN', email: 'qa-enrolled@example.invalid', password: STRONG_PASSWORD }, await csrfFor(stale)).expect(200);
    await raw(owner.admin._id, { 'mfa.enabled': true });
    const before = await credentials(owner.admin._id);
    const start = await stale.post('/api/v1/auth/mfa/enroll/start', {}, login.body.data.csrfToken).expect(409);
    expect(start.body.error.code).toBe('MFA_ENROLLMENT_CONFLICT');
    expect(await credentials(owner.admin._id)).toEqual(before);
    await expectNoSession(stale);
  });
});

describe('activation and password reset repeat their status and expiry checks at write time', () => {
  it.each([
    ['the account is disabled', () => ({ status: 'DISABLED' }), 'ACTIVATION_INVALID'],
    ['the link expires', (clock) => ({ 'authentication.activationExpiresAt': new Date(clock.ms() - 1) }), 'ACTIVATION_EXPIRED'],
  ])('activation: refused when, after its checks, %s — no password set, no session', async (_label, change, code) => {
    const { clock, config, app } = env;
    const { admin, token } = await provisionAdmin({ config, clock, email: 'qa-activate-stale@example.invalid' });
    const client = agentFor(app);
    changeBeforeTheWrite(() => raw(admin._id, change(clock)));
    const before = await credentials(admin._id);

    const res = await client.post('/api/v1/auth/activation', { token, password: STRONG_PASSWORD }, await csrfFor(client)).expect(400);
    expect(res.body.error.code).toBe(code);
    const after = await credentials(admin._id);
    expect(after.passwordHash).toBeNull();
    expect(after.authVersion).toBe(before.authVersion);
    expect(after.activationTokenHash).toBe(before.activationTokenHash);
    await expectNoSession(client);
    expect(await auditActions()).not.toContain('ADMIN_ACTIVATED');
  });

  const resetTokenFor = async (email) => {
    const { app, transport } = env;
    const client = agentFor(app);
    await client.post('/api/v1/auth/password/forgot', { realm: 'ADMIN', email }, await csrfFor(client)).expect(202);
    await new Promise((resolve) => setTimeout(resolve, 300)); // the email is sent after the response
    return /reset-password#token=([A-Za-z0-9_-]+)/.exec(transport.calls.at(-1).text)[1];
  };

  it.each([
    ['the account is disabled', () => ({ status: 'DISABLED' }), 'PASSWORD_RESET_INVALID'],
    ['the link expires', (clock) => ({ 'authentication.resetTokenExpiresAt': new Date(clock.ms() - 1) }), 'PASSWORD_RESET_EXPIRED'],
  ])('password reset: refused when, after its checks, %s — the password and sessions are untouched', async (label, change, code) => {
    const { clock, app } = env;
    const email = 'qa-reset-stale@example.invalid';
    const owner = await readyAdmin({ ...env, email });
    const token = await resetTokenFor(email);
    const client = agentFor(app);
    changeBeforeTheWrite(() => raw(owner.admin._id, change(clock)));
    const before = await credentials(owner.admin._id);

    const res = await client.post('/api/v1/auth/password/reset', { token, password: OTHER_PASSWORD }, await csrfFor(client)).expect(400);
    expect(res.body.error.code).toBe(code);
    const after = await credentials(owner.admin._id);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.passwordChangedAt).toEqual(before.passwordChangedAt);
    expect(after.authVersion).toBe(before.authVersion);
    expect(after.resetTokenHash).toBe(before.resetTokenHash);
    expect(await auditActions()).not.toContain('PASSWORD_RESET_COMPLETED');
    await expectNoSession(client);
    // Not revoked by the refused reset: only the change itself decides (a disabled account loses access by status).
    if (label === 'the link expires') await owner.client.get('/api/v1/admin/overview').expect(200);
  });

  it('password reset: refused when the auth version moved on between its checks and its write', async () => {
    const { app } = env;
    const email = 'qa-reset-version@example.invalid';
    const owner = await readyAdmin({ ...env, email });
    const token = await resetTokenFor(email);
    const client = agentFor(app);
    changeBeforeTheWrite(() => mongoose.connection.collection('admins').updateOne({ _id: owner.admin._id }, { $inc: { 'authentication.authVersion': 1 } }));
    const before = await credentials(owner.admin._id);

    const res = await client.post('/api/v1/auth/password/reset', { token, password: OTHER_PASSWORD }, await csrfFor(client)).expect(400);
    expect(res.body.error.code).toBe('PASSWORD_RESET_INVALID');
    expect((await credentials(owner.admin._id)).passwordHash).toBe(before.passwordHash);
  });
});
