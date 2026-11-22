import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { REQUIRED_INDEXES } from '../../src/db/indexes.js';
import { SESSION_COLLECTION } from '../../src/modules/admin/session.js';
import { requireTestDatabase, assertConnectedToTestDatabase } from './testDatabase.js';
import {
  ADMIN_ORIGIN,
  OTHER_PASSWORD,
  STRONG_PASSWORD,
  Admin,
  activateAndEnroll,
  adminEnv,
  agentFor,
  buildAdminApp,
  clearAdminCollections,
  csrfFor,
  currentCode,
  provisionAdmin,
  readyAdmin,
  signIn,
} from './adminHarness.js';

/**
 * E1 — Admin authentication foundation (Doc 18 §§220-225; Doc 11 §§265-282, §285).
 * Real MongoDB, real session store, real Argon2id. Synthetic data only.
 */

const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const CONNECT = { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false };
const sessions = () => mongoose.connection.collection(SESSION_COLLECTION);
const auditActions = async () => (await mongoose.connection.collection('audit_events').find({}).sort({ occurredAt: 1, _id: 1 }).toArray()).map((e) => e.action);

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

describe('the Admin surface is fail-closed', () => {
  it('does not exist unless ADMIN_AUTH=enabled', async () => {
    const config = loadConfig({ NODE_ENV: 'test', APP_ENV: 'local', MONGODB_URI: TEST_URI });
    const app = createApp({ config });
    await request(app).get('/api/v1/auth/csrf').expect(404);
    await request(app).get('/api/v1/admin/overview').expect(404);
  });

  it('answers a protected Admin API call without a session with 401 — no React guard involved (§274)', async () => {
    const res = await request(env.app).get('/api/v1/admin/applications').expect(401);
    expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('activation, password storage and MFA enrolment (§28-36, §69-80, §265, §282)', () => {
  it('activates once with a strong password, enrols TOTP, and stores no secret in a recoverable form', async () => {
    const { clock, config, app } = env;
    const { admin, token } = await provisionAdmin({ config, clock, email: 'qa-owner@example.invalid' });
    const client = agentFor(app);

    // Weak and common passwords are refused with controlled validation, not truncated (§41-44).
    let csrf = await csrfFor(client);
    const short = await client.post('/api/v1/auth/activation', { token, password: 'short' }, csrf).expect(400);
    expect(short.body.error.fieldErrors[0].code).toBe('PASSWORD_TOO_SHORT');
    const common = await client.post('/api/v1/auth/activation', { token, password: 'password12345' }, csrf).expect(400);
    expect(common.body.error.fieldErrors[0].code).toBe('PASSWORD_TOO_COMMON');
    const tooLong = await client.post('/api/v1/auth/activation', { token, password: 'x'.repeat(129) }, csrf).expect(400);
    expect(tooLong.body.error.fieldErrors[0].code).toBe('PASSWORD_TOO_LONG');

    const { secret, recoveryCodes } = await activateAndEnroll({ client, token, clock });
    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);

    const stored = await Admin.findById(admin._id).select('+authentication.passwordHash +authentication.activationTokenHash +mfa.secretCiphertext +mfa.recoveryCodes').lean();
    expect(stored.authentication.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    const raw = JSON.stringify(stored);
    expect(raw).not.toContain(STRONG_PASSWORD);
    expect(raw).not.toContain(secret);
    for (const code of recoveryCodes) expect(raw).not.toContain(code);
    expect(stored.authentication.activationTokenHash).toBeNull();
    expect(stored.authentication.emailVerifiedAt).toBeInstanceOf(Date);
    expect(stored.mfa.enabled).toBe(true);
    expect(stored.mfa.encryptionKeyId).toBe('qa1');

    // The activation token is single use (§29, §282).
    const reuse = agentFor(app);
    const again = await reuse.post('/api/v1/auth/activation', { token, password: OTHER_PASSWORD }, await csrfFor(reuse)).expect(400);
    expect(again.body.error.code).toBe('ACTIVATION_INVALID');
    expect(await auditActions()).toEqual(expect.arrayContaining(['ADMIN_ACTIVATED', 'MFA_ENROLLED', 'AUTH_LOGIN_SUCCESS']));
  });

  it('refuses an expired activation token (§31, §282)', async () => {
    const { clock, config, app } = env;
    const { token } = await provisionAdmin({ config, clock, email: 'qa-late@example.invalid' });
    clock.advance(8 * 3_600_000 + 1);
    const client = agentFor(app);
    const res = await client.post('/api/v1/auth/activation', { token, password: STRONG_PASSWORD }, await csrfFor(client)).expect(400);
    expect(res.body.error.code).toBe('ACTIVATION_EXPIRED');
  });

  it('gives an activated-but-not-enrolled session no Admin access (§263)', async () => {
    const { clock, config, app } = env;
    const { token } = await provisionAdmin({ config, clock, email: 'qa-half@example.invalid' });
    const client = agentFor(app);
    await client.post('/api/v1/auth/activation', { token, password: STRONG_PASSWORD }, await csrfFor(client)).expect(200);
    const res = await client.get('/api/v1/admin/applications').expect(401);
    expect(res.body.error.code).toBe('MFA_ENROLLMENT_REQUIRED');
  });
});

describe('login, MFA and sessions (§53-60, §75-82, §88-108, §266-268)', () => {
  it('gives an unknown email and a wrong password the same public answer (§56-57, §266)', async () => {
    const owner = await readyAdmin({ ...env, email: 'qa-owner@example.invalid' });
    const client = agentFor(env.app);
    const csrf = await csrfFor(client);
    const unknown = await client.post('/api/v1/auth/login', { realm: 'ADMIN', email: 'nobody@example.invalid', password: STRONG_PASSWORD }, csrf);
    const wrong = await client.post('/api/v1/auth/login', { realm: 'ADMIN', email: 'qa-owner@example.invalid', password: OTHER_PASSWORD }, csrf);
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error).toEqual(wrong.body.error);
    expect(unknown.body.error.message).toBe('Invalid email or password.');
    expect(owner.secret).toBeTruthy();
  });

  it('requires password AND a valid TOTP; regenerates the session id at both steps; cookie is HttpOnly, SameSite=Strict, host-only', async () => {
    const { clock, app } = env;
    const owner = await readyAdmin({ ...env, email: 'qa-owner@example.invalid' });
    const client = agentFor(app);
    clock.advance(30_000);
    const first = await client.get('/api/v1/auth/csrf');
    const sid0 = first.headers['set-cookie'][0].split(';')[0];
    expect(first.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(first.headers['set-cookie'][0]).toMatch(/SameSite=Strict/);
    expect(first.headers['set-cookie'][0]).toMatch(/Path=\//);
    expect(first.headers['set-cookie'][0]).not.toMatch(/Domain=/i);
    const login = await client.post('/api/v1/auth/login', { realm: 'ADMIN', email: 'qa-owner@example.invalid', password: STRONG_PASSWORD }, first.body.data.csrfToken).expect(200);
    expect(login.body.data.pending).toBe('MFA_REQUIRED');
    const sid1 = login.headers['set-cookie'][0].split(';')[0];
    expect(sid1).not.toBe(sid0); // §60

    // Password alone does not reach Admin data (§267).
    const blocked = await client.get('/api/v1/admin/overview').expect(401);
    expect(blocked.body.error.code).toBe('MFA_REQUIRED');

    const wrongCode = await client.post('/api/v1/auth/mfa/verify', { code: '000000' }, login.body.data.csrfToken).expect(401);
    expect(wrongCode.body.error.code).toBe('INVALID_MFA_CODE');
    const mfa = await client.post('/api/v1/auth/mfa/verify', { code: currentCode(owner.secret, clock) }, login.body.data.csrfToken).expect(200);
    const sid2 = mfa.headers['set-cookie'][0].split(';')[0];
    expect(sid2).not.toBe(sid1); // §76
    expect(mfa.body.data.authenticated).toBe(true);
    expect(mfa.body.data.csrfToken).not.toBe(login.body.data.csrfToken); // §114
    await client.get('/api/v1/admin/overview').expect(200);
  });

  it('refuses a TOTP code from a time step already used (§74, §267)', async () => {
    const { clock, app } = env;
    const owner = await readyAdmin({ ...env, email: 'qa-owner@example.invalid' });
    // The enrolment consumed the current step; logging in within the same step must fail.
    const client = agentFor(app);
    const csrf = (await client.post('/api/v1/auth/login', { realm: 'ADMIN', email: 'qa-owner@example.invalid', password: STRONG_PASSWORD }, await csrfFor(client)).expect(200)).body.data.csrfToken;
    const replay = await client.post('/api/v1/auth/mfa/verify', { code: currentCode(owner.secret, clock) }, csrf).expect(401);
    expect(replay.body.error.code).toBe('INVALID_MFA_CODE');
    clock.advance(30_000);
    await client.post('/api/v1/auth/mfa/verify', { code: currentCode(owner.secret, clock) }, csrf).expect(200);
  });

  it('accepts each recovery code exactly once, and audits its use (§81-82, §267)', async () => {
    const { app } = env;
    const owner = await readyAdmin({ ...env, email: 'qa-owner@example.invalid' });
    const login = async () => {
      const client = agentFor(app);
      const csrf = (await client.post('/api/v1/auth/login', { realm: 'ADMIN', email: 'qa-owner@example.invalid', password: STRONG_PASSWORD }, await csrfFor(client)).expect(200)).body.data.csrfToken;
      return client.post('/api/v1/auth/mfa/verify', { recoveryCode: owner.recoveryCodes[0].toLowerCase() }, csrf);
    };
    const first = await login();
    expect(first.status).toBe(200);
    expect(first.body.data.recoveryCodesRemaining).toBe(9);
    const second = await login();
    expect(second.status).toBe(401);
    expect(await auditActions()).toContain('MFA_RECOVERY_CODE_USED');
  });

  it('ends the MFA challenge after 5 wrong codes (§260)', async () => {
    const { app } = env;
    await readyAdmin({ ...env, email: 'qa-owner@example.invalid' });
    const client = agentFor(app);
    const csrf = (await client.post('/api/v1/auth/login', { realm: 'ADMIN', email: 'qa-owner@example.invalid', password: STRONG_PASSWORD }, await csrfFor(client)).expect(200)).body.data.csrfToken;
    for (let i = 0; i < 4; i += 1) await client.post('/api/v1/auth/mfa/verify', { code: '123456' }, csrf).expect(401);
    const ended = await client.post('/api/v1/auth/mfa/verify', { code: '123456' }, csrf).expect(401);
    expect(ended.body.error.code).toBe('MFA_CHALLENGE_ENDED');
    const after = await client.post('/api/v1/auth/mfa/verify', { code: '123456' }, csrf);
    expect([401, 403]).toContain(after.status);
  });

  it('expires a session after 30 idle minutes and at the 8-hour absolute limit (§93-97, §268)', async () => {
    const { clock } = env;
    const owner = await readyAdmin({ ...env, email: 'qa-owner@example.invalid' });
    await owner.client.get('/api/v1/admin/overview').expect(200);
    clock.advance(29 * 60_000);
    await owner.client.get('/api/v1/admin/overview').expect(200);
    clock.advance(30 * 60_000 + 1);
    const idle = await owner.client.get('/api/v1/admin/overview').expect(401);
    expect(idle.body.error.code).toBe('SESSION_EXPIRED');

    const again = await signIn({ client: owner.client, clock, email: 'qa-owner@example.invalid', secret: owner.secret });
    expect(again).toBeTruthy();
    for (let i = 0; i < 16; i += 1) {
      clock.advance(29 * 60_000);
      await owner.client.get('/api/v1/admin/overview').expect(200);
    }
    clock.advance(29 * 60_000);
    const absolute = await owner.client.get('/api/v1/admin/overview').expect(401);
    expect(absolute.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('logout destroys the server-side session; the old cookie is useless (§104-106, §268)', async () => {
    const owner = await readyAdmin({ ...env, email: 'qa-owner@example.invalid' });
    const cookie = (await owner.client.get('/api/v1/auth/session')).request.cookies;
    expect(await sessions().countDocuments({})).toBeGreaterThan(0);
    await owner.client.post('/api/v1/auth/logout', {}, owner.csrf).expect(200);
    await owner.client.get('/api/v1/admin/overview').expect(401);
    expect(await sessions().countDocuments({ 'session.authenticationLevel': 'AUTHENTICATED' })).toBe(0);
    expect(cookie).toBeDefined();
    expect(await auditActions()).toContain('AUTH_LOGOUT');
  });

  it('reports the session state without extending it (§99, §107-108)', async () => {
    const { clock } = env;
    const owner = await readyAdmin({ ...env, email: 'qa-owner@example.invalid' });
    const state = await owner.client.get('/api/v1/auth/session').expect(200);
    expect(state.body.data).toMatchObject({ authenticated: true, principalType: 'ADMIN', roles: ['ADMIN_OWNER'] });
    clock.advance(20 * 60_000);
    await owner.client.get('/api/v1/auth/session').expect(200);
    clock.advance(11 * 60_000);
    const expired = await owner.client.get('/api/v1/auth/session').expect(200);
    expect(expired.body.data.authenticated).toBe(false);
    const anonymous = await request(env.app).get('/api/v1/auth/session').expect(200);
    expect(anonymous.body.data).toEqual({ authenticated: false });
  });
});

describe('CSRF and Origin (§109-120, §269-270)', () => {
  it('refuses a state-changing Admin request with no token, a wrong token or another session\'s token', async () => {
    const owner = await readyAdmin({ ...env, email: 'qa-owner@example.invalid' });
    const other = await readyAdmin({ ...env, email: 'qa-other@example.invalid' });
    const body = { body: 'irrelevant' };
    const none = await owner.client.agent.post('/api/v1/admin/jobs').set('Origin', ADMIN_ORIGIN).send(body).expect(403);
    expect(none.body.error.code).toBe('CSRF_INVALID');
    await owner.client.post('/api/v1/admin/jobs', body, 'x'.repeat(43)).expect(403);
    const foreign = await owner.client.post('/api/v1/admin/jobs', body, other.csrf).expect(403);
    expect(foreign.body.error.code).toBe('CSRF_INVALID');
    // The same request with its own token reaches validation (400), proving the token was the only obstacle.
    await owner.client.post('/api/v1/admin/jobs', body, owner.csrf).expect(400);
  });

  it('refuses an untrusted Origin or Referer even with a valid session and token', async () => {
    const owner = await readyAdmin({ ...env, email: 'qa-owner@example.invalid' });
    const evil = await owner.client.agent.post('/api/v1/auth/logout').set('Origin', 'https://evil.example').set('X-CSRF-Token', owner.csrf).send({}).expect(403);
    expect(evil.body.error.code).toBe('ORIGIN_REJECTED');
    await owner.client.agent.post('/api/v1/auth/logout').set('Referer', 'https://localhost:5173.evil.example/admin').set('X-CSRF-Token', owner.csrf).send({}).expect(403);
    await owner.client.agent.post('/api/v1/auth/logout').set('Sec-Fetch-Site', 'cross-site').set('X-CSRF-Token', owner.csrf).send({}).expect(403);
    await owner.client.get('/api/v1/admin/overview').expect(200); // still signed in: nothing executed
  });

  it('sends credentialed CORS headers to the Admin origin only, never a wildcard (§120)', async () => {
    const ok = await request(env.app).options('/api/v1/admin/jobs').set('Origin', ADMIN_ORIGIN).set('Access-Control-Request-Method', 'PATCH').set('Access-Control-Request-Headers', 'x-csrf-token,content-type');
    expect(ok.headers['access-control-allow-origin']).toBe(ADMIN_ORIGIN);
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    expect(ok.headers['access-control-allow-methods']).toMatch(/PATCH/);
    const bad = await request(env.app).options('/api/v1/admin/jobs').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'POST');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('brute-force defence (§138-144, §271)', () => {
  it('locks an account for 15 minutes after 5 consecutive wrong passwords, with the same generic answer', async () => {
    const { clock, app } = env;
    const owner = await readyAdmin({ ...env, email: 'qa-owner@example.invalid' });
    const client = agentFor(app);
    const csrf = await csrfFor(client);
    for (let i = 0; i < 5; i += 1) await client.post('/api/v1/auth/login', { realm: 'ADMIN', email: 'qa-owner@example.invalid', password: OTHER_PASSWORD }, csrf).expect(401);
    const locked = await client.post('/api/v1/auth/login', { realm: 'ADMIN', email: 'qa-owner@example.invalid', password: STRONG_PASSWORD }, csrf).expect(401);
    expect(locked.body.error.message).toBe('Invalid email or password.');
    expect(await auditActions()).toContain('AUTH_ACCOUNT_LOCKED');
    // Reset requests never lock or unlock an account (§142).
    await client.post('/api/v1/auth/password/forgot', { realm: 'ADMIN', email: 'qa-owner@example.invalid' }, csrf).expect(202);
    clock.advance(15 * 60_000 + 1);
    await signIn({ client, clock, email: 'qa-owner@example.invalid', secret: owner.secret });
    const stored = await Admin.findById(owner.admin._id).lean();
    expect(stored.authentication.failedLoginCount).toBe(0);
  });

  it('limits login attempts per client address (§139)', async () => {
    const limited = buildAdminApp({ uri: TEST_URI, env: { ADMIN_LOGIN_RATE_LIMIT_MAX: '3' } });
    const client = agentFor(limited.app);
    const csrf = await csrfFor(client);
    for (let i = 0; i < 3; i += 1) await client.post('/api/v1/auth/login', { realm: 'ADMIN', email: 'x@example.invalid', password: STRONG_PASSWORD }, csrf).expect(401);
    const res = await client.post('/api/v1/auth/login', { realm: 'ADMIN', email: 'x@example.invalid', password: STRONG_PASSWORD }, csrf).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('password reset (§121-132, §280-281)', () => {
  const tokenFrom = (transport) => {
    const message = transport.calls.at(-1);
    return /reset-password#token=([A-Za-z0-9_-]+)/.exec(message.text)[1];
  };

  it('answers identically for existing and unknown emails, and the link works once, ends every session and keeps MFA', async () => {
    const { clock, app, transport } = env;
    const owner = await readyAdmin({ ...env, email: 'qa-owner@example.invalid' });
    const client = agentFor(app);
    const csrf = await csrfFor(client);
    const known = await client.post('/api/v1/auth/password/forgot', { realm: 'ADMIN', email: 'qa-owner@example.invalid' }, csrf).expect(202);
    const unknown = await client.post('/api/v1/auth/password/forgot', { realm: 'ADMIN', email: 'nobody@example.invalid' }, csrf).expect(202);
    expect(known.body.data).toEqual(unknown.body.data);
    await new Promise((resolve) => setTimeout(resolve, 300)); // the email is sent after the response
    const resetMails = transport.calls.filter((m) => m.event === 'ADMIN_PASSWORD_RESET');
    expect(resetMails).toHaveLength(1);
    expect(resetMails[0].to).toEqual(['qa-owner@example.invalid']);
    const token = tokenFrom(transport);

    await client.post('/api/v1/auth/password/reset', { token: 'A'.repeat(43), password: OTHER_PASSWORD }, csrf).expect(400);
    const done = await client.post('/api/v1/auth/password/reset', { token, password: OTHER_PASSWORD }, csrf).expect(200);
    expect(done.body.data).toEqual({ reset: true });
    // No automatic sign-in (§131), the owner's other session is revoked (§130), MFA kept (§132).
    expect((await client.get('/api/v1/auth/session')).body.data.authenticated).toBe(false);
    await owner.client.get('/api/v1/admin/overview').expect(401);
    expect((await Admin.findById(owner.admin._id).lean()).mfa.enabled).toBe(true);
    const twice = await client.post('/api/v1/auth/password/reset', { token, password: STRONG_PASSWORD }, await csrfFor(client)).expect(400);
    expect(twice.body.error.code).toBe('PASSWORD_RESET_INVALID');
    await signIn({ client, clock, email: 'qa-owner@example.invalid', secret: owner.secret, password: OTHER_PASSWORD });
  });

  it('refuses an expired reset link (§125, §280)', async () => {
    const { clock, app, transport } = env;
    await readyAdmin({ ...env, email: 'qa-owner@example.invalid' });
    const client = agentFor(app);
    const csrf = await csrfFor(client);
    await client.post('/api/v1/auth/password/forgot', { realm: 'ADMIN', email: 'qa-owner@example.invalid' }, csrf).expect(202);
    await new Promise((resolve) => setTimeout(resolve, 300));
    clock.advance(30 * 60_000 + 1);
    const res = await client.post('/api/v1/auth/password/reset', { token: tokenFrom(transport), password: OTHER_PASSWORD }, csrf).expect(400);
    expect(res.body.error.code).toBe('PASSWORD_RESET_EXPIRED');
  });
});

describe('step-up, password change, recovery codes and session management (§101-103, §133-137, §83)', () => {
  it('requires strong authentication in the last 10 minutes for high-risk operations', async () => {
    const { clock } = env;
    const owner = await readyAdmin({ ...env, email: 'qa-owner@example.invalid' });
    clock.advance(9 * 60_000);
    await owner.client.get('/api/v1/admin/overview').expect(200);
    clock.advance(2 * 60_000);
    const stale = await owner.client.post('/api/v1/auth/password/change', { currentPassword: STRONG_PASSWORD, newPassword: OTHER_PASSWORD }, owner.csrf).expect(403);
    expect(stale.body.error.code).toBe('RECENT_AUTH_REQUIRED');
    clock.advance(30_000);
    await owner.client.post('/api/v1/auth/reauthenticate', { password: STRONG_PASSWORD, code: currentCode(owner.secret, clock) }, owner.csrf).expect(200);
    const changed = await owner.client.post('/api/v1/auth/password/change', { currentPassword: STRONG_PASSWORD, newPassword: OTHER_PASSWORD }, owner.csrf).expect(200);
    // The current session continues at the new authVersion; regenerate recovery codes still works.
    const codes = await owner.client.post('/api/v1/auth/mfa/recovery-codes/regenerate', {}, changed.body.data.csrfToken).expect(200);
    expect(codes.body.data.recoveryCodes).toHaveLength(10);
    expect(await auditActions()).toEqual(expect.arrayContaining(['PASSWORD_CHANGED', 'MFA_RECOVERY_CODES_REGENERATED']));
  });

  it('lists the Admin\'s own sessions without raw ids, and revokes one or all others', async () => {
    const { clock, app } = env;
    const owner = await readyAdmin({ ...env, email: 'qa-owner@example.invalid' });
    const second = agentFor(app);
    await signIn({ client: second, clock, email: 'qa-owner@example.invalid', secret: owner.secret });
    const list = await owner.client.get('/api/v1/auth/sessions').expect(200);
    expect(list.body.data.items).toHaveLength(2);
    const raw = JSON.stringify(list.body);
    for (const doc of await sessions().find({}).toArray()) expect(raw).not.toContain(doc._id);
    const other = list.body.data.items.find((s) => !s.current);
    await owner.client.del(`/api/v1/auth/sessions/${other.id}`, owner.csrf).expect(200);
    await second.get('/api/v1/admin/overview').expect(401);
    await owner.client.del('/api/v1/auth/sessions/notASessionId1', owner.csrf).expect(404);
  });
});

describe('authorization by role (§146-159, §229-230, §272-276)', () => {
  it('lets a RECRUITMENT_ADMIN work on recruitment but not on accounts or the audit log', async () => {
    const recruiter = await readyAdmin({ ...env, email: 'qa-recruiter@example.invalid', roles: ['RECRUITMENT_ADMIN'] });
    await recruiter.client.get('/api/v1/admin/jobs').expect(200);
    await recruiter.client.get('/api/v1/admin/applications').expect(200);
    expect((await recruiter.client.get('/api/v1/admin/admins').expect(403)).body.error.code).toBe('AUTHORIZATION_DENIED');
    await recruiter.client.get('/api/v1/admin/audit').expect(403);
    await recruiter.client.post('/api/v1/admin/admins', { email: 'qa-new@example.invalid', displayName: 'QA', roles: ['ADMIN_OWNER'] }, recruiter.csrf).expect(403);
    // Role tampering: claiming a role in the body grants nothing (§154, §275).
    await recruiter.client.patch(`/api/v1/admin/admins/${recruiter.admin._id}/roles`, { roles: ['ADMIN_OWNER'] }, recruiter.csrf).expect(403);
    expect((await Admin.findById(recruiter.admin._id).lean()).roles).toEqual(['RECRUITMENT_ADMIN']);
    const session = await recruiter.client.get('/api/v1/auth/session').expect(200);
    expect(session.body.data.permissions).not.toContain('audit:read');
    expect(session.body.data.permissions).not.toContain('admins:create');
  });

  it('gives ADMIN_OWNER every documented permission and nothing else (§151, §273)', async () => {
    const owner = await readyAdmin({ ...env, email: 'qa-owner@example.invalid' });
    const session = await owner.client.get('/api/v1/auth/session').expect(200);
    expect(session.body.data.permissions).toHaveLength(17);
    await owner.client.get('/api/v1/admin/audit').expect(200);
  });

  it('ends a disabled Admin\'s session at once and refuses new logins; re-enabling restores nothing (§157-158, §276)', async () => {
    const { clock } = env;
    const owner = await readyAdmin({ ...env, email: 'qa-owner@example.invalid' });
    const recruiter = await readyAdmin({ ...env, email: 'qa-recruiter@example.invalid', roles: ['RECRUITMENT_ADMIN'] });
    await recruiter.client.get('/api/v1/admin/jobs').expect(200);
    await owner.client.post(`/api/v1/admin/admins/${recruiter.admin._id}/disable`, {}, owner.csrf).expect(200);
    expect((await recruiter.client.get('/api/v1/admin/jobs').expect(401)).body.error.code).toMatch(/AUTHENTICATION_REQUIRED|SESSION_REVOKED/);
    const client = agentFor(env.app);
    await client.post('/api/v1/auth/login', { realm: 'ADMIN', email: 'qa-recruiter@example.invalid', password: STRONG_PASSWORD }, await csrfFor(client)).expect(401);
    await owner.client.post(`/api/v1/admin/admins/${recruiter.admin._id}/enable`, {}, owner.csrf).expect(200);
    await recruiter.client.get('/api/v1/admin/jobs').expect(401);
    await signIn({ client, clock, email: 'qa-recruiter@example.invalid', secret: recruiter.secret });
    expect(await auditActions()).toEqual(expect.arrayContaining(['ADMIN_ACCOUNT_DISABLED', 'ADMIN_ACCOUNT_ENABLED']));
  });

  it('invalidates sessions holding an old authVersion even if the store still has them (§90-92, §268)', async () => {
    const owner = await readyAdmin({ ...env, email: 'qa-owner@example.invalid' });
    await Admin.updateOne({ _id: owner.admin._id }, { $inc: { 'authentication.authVersion': 1 } });
    const res = await owner.client.get('/api/v1/admin/overview').expect(401);
    expect(res.body.error.code).toBe('SESSION_REVOKED');
  });

  it('protects the last active owner from being disabled or demoted (§230)', async () => {
    const owner = await readyAdmin({ ...env, email: 'qa-owner@example.invalid' });
    const res = await owner.client.post(`/api/v1/admin/admins/${owner.admin._id}/disable`, {}, owner.csrf).expect(409);
    expect(res.body.error.code).toBe('LAST_OWNER');
    await owner.client.patch(`/api/v1/admin/admins/${owner.admin._id}/roles`, { roles: ['RECRUITMENT_ADMIN'] }, owner.csrf).expect(409);
  });

  it('lets an owner create an Admin who receives an activation email, change roles, and reset another Admin\'s MFA', async () => {
    const { transport } = env;
    const owner = await readyAdmin({ ...env, email: 'qa-owner@example.invalid' });
    const created = await owner.client.post('/api/v1/admin/admins', { email: 'qa-new@example.invalid', displayName: 'QA New', roles: ['RECRUITMENT_ADMIN'] }, owner.csrf).expect(201);
    expect(created.body.data.activationDelivery).toBe('SENT');
    expect(JSON.stringify(created.body)).not.toMatch(/token/i);
    const mail = transport.calls.find((m) => m.event === 'ADMIN_ACTIVATION');
    expect(mail.to).toEqual(['qa-new@example.invalid']);
    expect(mail.text).toMatch(/\/admin\/activate#token=[A-Za-z0-9_-]{43}/);
    await owner.client.post('/api/v1/admin/admins', { email: 'QA-NEW@example.invalid', displayName: 'Dup', roles: ['RECRUITMENT_ADMIN'] }, owner.csrf).expect(409);

    const recruiter = await readyAdmin({ ...env, email: 'qa-recruiter@example.invalid', roles: ['RECRUITMENT_ADMIN'] });
    await owner.client.patch(`/api/v1/admin/admins/${recruiter.admin._id}/roles`, { roles: ['RECRUITMENT_ADMIN', 'ADMIN_OWNER'] }, owner.csrf).expect(200);
    await recruiter.client.get('/api/v1/admin/jobs').expect(401); // role change revokes sessions (§156)
    await owner.client.post(`/api/v1/admin/admins/${recruiter.admin._id}/mfa/reset`, { identityVerified: true }, owner.csrf).expect(200);
    const after = await Admin.findById(recruiter.admin._id).select('+mfa.secretCiphertext').lean();
    expect(after.mfa.enabled).toBe(false);
    expect(after.mfa.secretCiphertext).toBeNull();
    const list = await owner.client.get('/api/v1/admin/admins').expect(200);
    expect(list.body.data.items.map((a) => a.email)).toEqual(expect.arrayContaining(['qa-owner@example.invalid', 'qa-new@example.invalid', 'qa-recruiter@example.invalid']));
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|secretCiphertext|recoveryCodes|TokenHash/);
  });
});

describe('cookie attributes on an HTTPS origin (§12-16)', () => {
  it('uses __Host-valida.sid with Secure when the Admin origin is HTTPS', async () => {
    const secure = buildAdminApp({ uri: TEST_URI, env: { ADMIN_APP_ORIGIN: 'https://admin.example.invalid', TRUST_PROXY: '1' } });
    const res = await request(secure.app).get('/api/v1/auth/csrf').set('X-Forwarded-Proto', 'https').set('Origin', 'https://admin.example.invalid').expect(200);
    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/^__Host-valida\.sid=/);
    expect(cookie).toMatch(/; Secure/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).not.toMatch(/Domain=/i);
  });
});
