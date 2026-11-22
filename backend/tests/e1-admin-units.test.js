import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { ADMIN_POLICY, ARGON2_BASELINE, resolveAdminAuth } from '../src/config/adminAuth.js';
import { loadConfig, ConfigurationError } from '../src/config/env.js';
import { dummyVerify, hashPassword, needsRehash, parseHash, passwordPolicyProblem, verifyPassword } from '../src/modules/admin/auth/password.js';
import { isCommonPassword } from '../src/modules/admin/auth/commonPasswords.js';
import { base32Decode, base32Encode, normaliseTotpInput, otpauthUri, timeStep, totpAt, verifyTotp } from '../src/modules/admin/auth/totp.js';
import { createSecretBox, generateRecoveryCode, hashRecoveryCode, normaliseRecoveryCode, randomToken } from '../src/modules/admin/auth/secrets.js';
import { PERMISSIONS, hasPermission, permissionsFor } from '../src/modules/admin/auth/permissions.js';
import { allowedNextStatuses, checkTransition } from '../src/modules/admin/applicationStatus.rules.js';
import { createAuditWriter } from '../src/modules/admin/audit.js';
import { requirePermission, requireTrustedOrigin } from '../src/modules/admin/session.js';

/** E1/E5 primitives — offline, no database (Doc 11 §§33-46, 72-81, 146-152; Doc 12 §§85-92). */

const validEnv = () => ({
  ADMIN_AUTH: 'enabled',
  ADMIN_SESSION_SECRET: randomBytes(32).toString('base64url'),
  ADMIN_MFA_KEYS: `k1:${randomBytes(32).toString('base64')}`,
  ADMIN_MFA_CURRENT_KEY_ID: 'k1',
  ADMIN_APP_ORIGIN: 'https://cybervalida.com',
});

describe('admin configuration is fail-closed (Doc 11 §§12-18, 34, 67, 234-238)', () => {
  it('is disabled unless ADMIN_AUTH is exactly "enabled"', () => {
    for (const value of [undefined, '', 'true', 'ENABLED', ' enabled', '1']) {
      expect(resolveAdminAuth({ ...validEnv(), ADMIN_AUTH: value })).toEqual({ ok: true, enabled: false });
    }
  });

  it('resolves a complete setup with __Host-, Secure, SameSite=Strict, and keeps secrets out of every serialised view', () => {
    const env = validEnv();
    const resolved = resolveAdminAuth(env, { isProduction: true });
    expect(resolved).toMatchObject({ ok: true, enabled: true, appOrigin: 'https://cybervalida.com', cookie: { name: '__Host-valida.sid', secure: true, sameSite: 'strict', httpOnly: true } });
    expect(resolved.argon2).toEqual({ memoryKiB: 19_456, passes: 2, parallelism: 1 });
    expect(resolved.secrets.sessionSecrets[0]).toBe(env.ADMIN_SESSION_SECRET);
    const shown = JSON.stringify(resolved);
    expect(shown).not.toContain(env.ADMIN_SESSION_SECRET);
    expect(shown).not.toContain(env.ADMIN_MFA_KEYS.split(':')[1]);
  });

  it.each([
    ['ADMIN_SESSION_SECRET', 'short'],
    ['ADMIN_MFA_KEYS', 'k1:dG9vc2hvcnQ='],
    ['ADMIN_MFA_CURRENT_KEY_ID', 'k2'],
    ['ADMIN_APP_ORIGIN', 'https://cybervalida.com/admin'],
    ['ADMIN_APP_ORIGIN', 'http://cybervalida.com'],
    ['ADMIN_ARGON2_MEMORY_KIB', '8192'],
    ['ADMIN_ARGON2_PASSES', '1'],
    ['ADMIN_LOGIN_RATE_LIMIT_MAX', '0'],
  ])('refuses %s=%s with fixed text that never echoes the value', (variable, value) => {
    const resolved = resolveAdminAuth({ ...validEnv(), [variable]: value }, { isProduction: true });
    expect(resolved.ok).toBe(false);
    expect(JSON.stringify(resolved.problems)).not.toContain(value === '8192' || value === '1' || value === '0' ? 'never-match' : value);
  });

  it('stops the backend on a malformed enabled setup, and allows plain HTTP only for a local origin', () => {
    expect(() => loadConfig({ MONGODB_URI: 'mongodb://127.0.0.1:27017/valida_qa', ADMIN_AUTH: 'enabled' })).toThrow(ConfigurationError);
    const local = resolveAdminAuth({ ...validEnv(), ADMIN_APP_ORIGIN: 'http://localhost:5173' }, { isProduction: false });
    expect(local.cookie).toMatchObject({ name: 'valida.sid', secure: false });
  });

  it('carries the canonical policy values', () => {
    expect(ADMIN_POLICY).toMatchObject({ idleTimeoutMs: 1_800_000, absoluteLifetimeMs: 28_800_000, recentAuthMs: 600_000, failedLoginThreshold: 5, lockDurationMs: 900_000, mfaAttemptsPerChallenge: 5, activationLifetimeMs: 28_800_000, resetLifetimeMs: 1_800_000, passwordMinLength: 12, passwordMaxLength: 128, recoveryCodeCount: 10 });
  });
});

describe('Argon2id password storage (§33-46, §59, §265)', () => {
  it('hashes in the PHC encoding with a unique salt, verifies, and rejects a wrong password', async () => {
    const a = await hashPassword('QA synthetic passphrase one');
    const b = await hashPassword('QA synthetic passphrase one');
    expect(a).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword('QA synthetic passphrase one', a)).toBe(true);
    expect(await verifyPassword('QA synthetic passphrase two', a)).toBe(false);
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
    expect(await dummyVerify('anything')).toBe(false);
  });

  it('flags hashes below the current parameters for rehash on login (§46)', async () => {
    const stronger = { ...ARGON2_BASELINE, passes: 3 };
    const baseline = await hashPassword('QA synthetic passphrase one');
    expect(needsRehash(baseline)).toBe(false);
    expect(needsRehash(baseline, stronger)).toBe(true);
    expect(parseHash(await hashPassword('x'.repeat(12), stronger)).params.passes).toBe(3);
  });

  it('applies the length, common-password and own-email rules without composition rules (§41-44)', () => {
    expect(passwordPolicyProblem('short')?.code).toBe('PASSWORD_TOO_SHORT');
    expect(passwordPolicyProblem('x'.repeat(129))?.code).toBe('PASSWORD_TOO_LONG');
    expect(passwordPolicyProblem('abcdefghijklmnop')?.code).toBe('PASSWORD_TOO_COMMON');
    expect(passwordPolicyProblem('qa.recruiter-lantern-2026', { email: 'qa.recruiter@example.invalid' })?.code).toBe('PASSWORD_CONTAINS_EMAIL');
    expect(passwordPolicyProblem('all lower case words here')).toBeNull(); // no "1 uppercase 1 symbol" rule
    expect(passwordPolicyProblem('Ünïcödé pässphrase ✓ 7')).toBeNull();
    for (const common of ['password12345', '123456789012', 'qwertyuiopas', 'aaaaaaaaaaaa', 'abcabcabcabc', 'Password1234!', 'valida123456']) {
      expect(isCommonPassword(common)).toBe(true);
    }
    expect(isCommonPassword('QA synthetic passphrase 7 lanterns')).toBe(false);
  });
});

describe('TOTP (§72-74) — RFC 6238 appendix B vectors (SHA-1, 8 digits)', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('T=%i → %s', (seconds, expected) => {
    expect(totpAt(secret, Math.floor(seconds / 30), { digits: 8 })).toBe(expected);
  });

  it('round-trips base32 and builds an otpauth URI with the canonical parameters', () => {
    const bytes = randomBytes(20);
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    const uri = otpauthUri({ secretBase32: 'JBSWY3DPEHPK3PXP', accountName: 'qa@example.invalid' });
    expect(uri).toMatch(/^otpauth:\/\/totp\/Valida%3Aqa%40example\.invalid\?/);
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('accepts the current step ±1 only, refuses replay of a used step, and normalises spacing', () => {
    const s = 'JBSWY3DPEHPK3PXP';
    const now = 1_795_000_000_000;
    const step = timeStep(now);
    expect(verifyTotp(s, totpAt(s, step), { nowMs: now })).toEqual({ ok: true, step });
    expect(verifyTotp(s, totpAt(s, step - 1), { nowMs: now }).ok).toBe(true);
    expect(verifyTotp(s, totpAt(s, step + 1), { nowMs: now }).ok).toBe(true);
    expect(verifyTotp(s, totpAt(s, step - 2), { nowMs: now }).ok).toBe(false);
    expect(verifyTotp(s, totpAt(s, step + 2), { nowMs: now }).ok).toBe(false);
    expect(verifyTotp(s, totpAt(s, step), { nowMs: now, lastUsedStep: step }).ok).toBe(false);
    expect(verifyTotp(s, totpAt(s, step - 1), { nowMs: now, lastUsedStep: step }).ok).toBe(false);
    const code = totpAt(s, step);
    expect(normaliseTotpInput(`${code.slice(0, 3)} ${code.slice(3)}`)).toBe(code);
    expect(normaliseTotpInput('12345a')).toBeNull();
  });
});

describe('server-side secrets (§29-30, §66-68, §77-80, §123)', () => {
  it('generates 32-byte URL-safe tokens', () => {
    const token = randomToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('generates unambiguous ~128-bit recovery codes, normalises user input, and hashes deterministically', () => {
    const codes = Array.from({ length: 200 }, generateRecoveryCode);
    expect(new Set(codes).size).toBe(200);
    for (const code of codes) expect(code).toMatch(/^[A-HJKMNP-TV-Z2-9]{5}(-[A-HJKMNP-TV-Z2-9]{5}){4}-?[A-HJKMNP-TV-Z2-9]?$/);
    const code = codes[0];
    expect(normaliseRecoveryCode(code.toLowerCase().replace(/-/g, ' '))).toBe(code.replace(/-/g, ''));
    expect(hashRecoveryCode(code)).toBe(hashRecoveryCode(code.toLowerCase()));
    expect(hashRecoveryCode(code)).toMatch(/^[a-f0-9]{64}$/);
    expect(normaliseRecoveryCode('not a code')).toBeNull();
  });

  it('encrypts the MFA secret with AES-256-GCM bound to its key id, and refuses tampering or an unknown key', () => {
    const keys = new Map([['k1', randomBytes(32)], ['k2', randomBytes(32)]]);
    const box = createSecretBox({ keys, currentKeyId: 'k1' });
    const sealed = box.seal('JBSWY3DPEHPK3PXP');
    expect(sealed.keyId).toBe('k1');
    expect(sealed.ciphertext).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.open(sealed)).toBe('JBSWY3DPEHPK3PXP');
    // Rotation: records sealed under k1 still open after k2 becomes current (§237).
    expect(createSecretBox({ keys, currentKeyId: 'k2' }).open(sealed)).toBe('JBSWY3DPEHPK3PXP');
    expect(() => box.open({ keyId: 'k2', ciphertext: sealed.ciphertext })).toThrow();
    const parts = sealed.ciphertext.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => box.open({ keyId: 'k1', ciphertext: parts.join('.') })).toThrow();
    expect(() => box.open({ keyId: 'missing', ciphertext: sealed.ciphertext })).toThrow('MFA_SECRET_UNAVAILABLE');
  });
});

describe('roles and permissions (§146-152, §272-273)', () => {
  it('maps ADMIN_OWNER to every permission and RECRUITMENT_ADMIN to recruitment only; unknown roles get nothing', () => {
    expect([...permissionsFor(['ADMIN_OWNER'])].sort()).toEqual([...PERMISSIONS].sort());
    const recruiter = permissionsFor(['RECRUITMENT_ADMIN']);
    expect(recruiter.has('applications:resume:read')).toBe(true);
    expect([...recruiter].some((p) => p.startsWith('admins:'))).toBe(false);
    expect(recruiter.has('audit:read')).toBe(false);
    expect(permissionsFor(['SUPERUSER']).size).toBe(0);
    expect(permissionsFor('ADMIN_OWNER').size).toBe(0);
    expect(hasPermission([], 'jobs:read')).toBe(false);
  });

  it('denies by default in the middleware, including an Admin without résumé permission (§152, §277)', () => {
    const run = (permissions, needed) => {
      let result;
      requirePermission(needed)({ admin: { permissions: new Set(permissions) } }, {}, (error) => {
        result = error ?? 'next';
      });
      return result;
    };
    expect(run(['applications:read'], 'applications:resume:read').status).toBe(403);
    expect(run(['applications:resume:read'], 'applications:resume:read')).toBe('next');
    expect(run([], 'jobs:read').code).toBe('AUTHORIZATION_DENIED');
  });

  it('checks Origin exactly, falls back to Referer without substring matching, and refuses cross-site fetch metadata (§116-118)', () => {
    const check = (headers, method = 'POST') => {
      let result;
      requireTrustedOrigin({ appOrigin: 'https://cybervalida.com' })({ method, get: (h) => headers[h] }, {}, (error) => {
        result = error ? error.code : 'next';
      });
      return result;
    };
    expect(check({ Origin: 'https://cybervalida.com' })).toBe('next');
    expect(check({ Origin: 'https://cybervalida.com.evil.example' })).toBe('ORIGIN_REJECTED');
    expect(check({ Referer: 'https://cybervalida.com/admin/jobs' })).toBe('next');
    expect(check({ Referer: 'https://evil.example/?https://cybervalida.com' })).toBe('ORIGIN_REJECTED');
    expect(check({ 'Sec-Fetch-Site': 'cross-site' })).toBe('ORIGIN_REJECTED');
    expect(check({ Origin: 'https://evil.example' }, 'GET')).toBe('next'); // safe methods change nothing
  });
});

describe('application status rules (Doc 12 §85-92)', () => {
  it('allows the canonical transitions and refuses invented ones', () => {
    expect(checkTransition({ from: 'RECEIVED', to: 'IN_REVIEW' })).toEqual({ allowed: true, correction: false });
    expect(checkTransition({ from: 'IN_REVIEW', to: 'FINAL_REVIEW' }).allowed).toBe(true);
    expect(checkTransition({ from: 'ASSESSMENT', to: 'INTERVIEW' }).allowed).toBe(true);
    expect(checkTransition({ from: 'RECEIVED', to: 'SELECTED' }).code).toBe('TRANSITION_NOT_ALLOWED');
    expect(checkTransition({ from: 'INTERVIEW', to: 'SELECTED' }).allowed).toBe(false);
    expect(checkTransition({ from: 'ON_HOLD', to: 'RECEIVED' }).allowed).toBe(false);
    expect(checkTransition({ from: 'RECEIVED', to: 'RECEIVED' }).code).toBe('STATUS_UNCHANGED');
  });

  it('treats reopening a terminal Application as an owner-only correction with a reason', () => {
    expect(checkTransition({ from: 'SELECTED', to: 'IN_REVIEW', roles: ['RECRUITMENT_ADMIN'], reason: 'x' }).code).toBe('CORRECTION_REQUIRES_OWNER');
    expect(checkTransition({ from: 'SELECTED', to: 'IN_REVIEW', roles: ['ADMIN_OWNER'] }).code).toBe('REASON_REQUIRED');
    expect(checkTransition({ from: 'SELECTED', to: 'IN_REVIEW', roles: ['ADMIN_OWNER'], reason: 'QA correction' })).toEqual({ allowed: true, correction: true });
    expect(checkTransition({ from: 'NOT_SELECTED', to: 'SELECTED', roles: ['ADMIN_OWNER'], reason: 'x' }).allowed).toBe(false);
    expect(allowedNextStatuses('WITHDRAWN', ['RECRUITMENT_ADMIN'])).toEqual([]);
    expect(allowedNextStatuses('WITHDRAWN', ['ADMIN_OWNER']).every((s) => s.correction)).toBe(true);
  });
});

describe('the audit writer refuses metadata that could carry a secret or personal content (Doc 11 §202)', () => {
  it.each(['password', 'token', 'code', 'email', 'body', 'fullName', 'resume'])('refuses metadata key "%s"', async (key) => {
    const writer = createAuditWriter({ model: class { save() {} } });
    await expect(writer.record({ actor: { type: 'SYSTEM' }, action: 'AUTH_LOGOUT', resource: { type: 'ADMIN' }, metadata: { [key]: 'x' } })).rejects.toThrow(/not permitted/);
  });
});
