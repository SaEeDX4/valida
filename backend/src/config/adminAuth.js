/**
 * Recruitment Admin authentication settings — Release E, milestone E1
 * (Doc 11 sections 5-20, 33-35, 67-68, 93-94, 139-141, 234-238; OD-2026-11-21-01).
 *
 * Fail closed. The Admin surface (/api/v1/auth, /api/v1/admin) exists only when
 * ADMIN_AUTH=enabled AND every secret below is present and well formed. Anything
 * else and the routes are not mounted (an unknown route, 404). A *malformed*
 * setting while ADMIN_AUTH=enabled stops the backend, with fixed text that never
 * echoes a value: a half-configured authentication system is not started.
 *
 * Variables
 *   ADMIN_AUTH                  exactly "enabled"; anything else (or unset) = disabled
 *   ADMIN_SESSION_SECRET        >= 32 random bytes, base64url (43+ chars) — signs the session cookie
 *   ADMIN_SESSION_PREVIOUS_SECRETS  optional, comma-separated: verification-only secrets during rotation (Doc 11 s236)
 *   ADMIN_MFA_KEYS              "keyId:base64(32 bytes)" entries, comma-separated (Doc 11 s67-68, s237)
 *   ADMIN_MFA_CURRENT_KEY_ID    the keyId new MFA secrets are encrypted under
 *   ADMIN_APP_ORIGIN            the trusted origin that serves /admin (activation and reset links are built
 *                               from it, never from a request's Host header — Doc 11 s32; it is also the only
 *                               origin allowed to make credentialed Admin requests — s116, s120)
 *   ADMIN_LOGIN_RATE_LIMIT_MAX  default 30 per 15 minutes per client address (s139)
 *   ADMIN_ARGON2_MEMORY_KIB / ADMIN_ARGON2_PASSES  may only RAISE the Doc 11 s34 baseline
 */

export const ADMIN_POLICY = Object.freeze({
  idleTimeoutMs: 30 * 60_000, // s93
  absoluteLifetimeMs: 8 * 60 * 60_000, // s94
  preAuthLifetimeMs: 10 * 60_000, // s261
  enrollmentLifetimeMs: 10 * 60_000, // s262
  recentAuthMs: 10 * 60_000, // s135
  mfaAttemptsPerChallenge: 5, // s260
  failedLoginThreshold: 5, // s140
  lockDurationMs: 15 * 60_000, // s141
  loginWindowMs: 15 * 60_000, // s139
  activationLifetimeMs: 8 * 60 * 60_000, // s31
  resetLifetimeMs: 30 * 60_000, // s125
  passwordMinLength: 12, // s41
  passwordMaxLength: 128, // s41
  recoveryCodeCount: 10, // s77
});

/** Doc 11 s34 — the floor. Configuration may raise it, never lower it. */
export const ARGON2_BASELINE = Object.freeze({ memoryKiB: 19_456, passes: 2, parallelism: 1 });

const SECRET_PATTERN = /^[A-Za-z0-9_-]{43,}$/;
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/;

const PROBLEMS = Object.freeze({
  SESSION_SECRET: { variable: 'ADMIN_SESSION_SECRET', rule: 'is required with ADMIN_AUTH=enabled: at least 32 random bytes as base64url (43+ characters)' },
  SESSION_PREVIOUS: { variable: 'ADMIN_SESSION_PREVIOUS_SECRETS', rule: 'must be a comma-separated list of base64url secrets of 43+ characters, none equal to the current secret' },
  MFA_KEYS: { variable: 'ADMIN_MFA_KEYS', rule: 'is required with ADMIN_AUTH=enabled: comma-separated "keyId:base64" entries, each key exactly 32 bytes, unique key ids' },
  MFA_CURRENT: { variable: 'ADMIN_MFA_CURRENT_KEY_ID', rule: 'is required with ADMIN_AUTH=enabled and must name one of the ADMIN_MFA_KEYS entries' },
  APP_ORIGIN: { variable: 'ADMIN_APP_ORIGIN', rule: 'is required with ADMIN_AUTH=enabled: an origin (scheme, host, optional port; no path); https in production' },
  LOGIN_LIMIT: { variable: 'ADMIN_LOGIN_RATE_LIMIT_MAX', rule: 'must be an integer between 1 and 1000' },
  ARGON2: { variable: 'ADMIN_ARGON2_MEMORY_KIB', rule: 'ADMIN_ARGON2_MEMORY_KIB (>= 19456, <= 1048576) and ADMIN_ARGON2_PASSES (>= 2, <= 10) may only raise the Doc 11 baseline' },
});

/** The disabled state: nothing is mounted. */
export const DISABLED_ADMIN_AUTH = Object.freeze({ ok: true, enabled: false });

function parseOrigin(value, { isProduction }) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.origin !== value) return null; // no path, query, fragment, userinfo or trailing slash
  if (url.protocol !== 'https:' && (isProduction || url.protocol !== 'http:')) return null;
  return url.origin;
}

function parseMfaKeys(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const keys = new Map();
  for (const entry of value.split(',')) {
    const separator = entry.indexOf(':');
    if (separator < 1) return null;
    const keyId = entry.slice(0, separator).trim();
    const material = entry.slice(separator + 1).trim();
    if (!KEY_ID_PATTERN.test(keyId) || keys.has(keyId)) return null;
    if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(material)) return null;
    const bytes = Buffer.from(material.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (bytes.length !== 32) return null;
    keys.set(keyId, bytes);
  }
  return keys.size > 0 ? keys : null;
}

function boundedInteger(value, { min, max, fallback }) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}

/**
 * @returns {{ ok: true, enabled: false }
 *         | { ok: true, enabled: true, appOrigin, cookie, loginRateLimit, argon2, policy, secrets (non-enumerable) }
 *         | { ok: false, problems: {variable, rule}[] }}
 */
export function resolveAdminAuth(env = {}, { isProduction = false } = {}) {
  if (env.ADMIN_AUTH !== 'enabled') return DISABLED_ADMIN_AUTH;
  const problems = [];

  const sessionSecret = env.ADMIN_SESSION_SECRET;
  if (typeof sessionSecret !== 'string' || !SECRET_PATTERN.test(sessionSecret)) problems.push(PROBLEMS.SESSION_SECRET);

  let previousSecrets = [];
  if (env.ADMIN_SESSION_PREVIOUS_SECRETS !== undefined && env.ADMIN_SESSION_PREVIOUS_SECRETS !== '') {
    previousSecrets = String(env.ADMIN_SESSION_PREVIOUS_SECRETS).split(',').map((item) => item.trim());
    if (previousSecrets.some((item) => !SECRET_PATTERN.test(item) || item === sessionSecret)) problems.push(PROBLEMS.SESSION_PREVIOUS);
  }

  const mfaKeys = parseMfaKeys(env.ADMIN_MFA_KEYS);
  if (mfaKeys === null) problems.push(PROBLEMS.MFA_KEYS);
  const currentKeyId = env.ADMIN_MFA_CURRENT_KEY_ID;
  if (mfaKeys !== null && (typeof currentKeyId !== 'string' || !mfaKeys.has(currentKeyId))) problems.push(PROBLEMS.MFA_CURRENT);

  const appOrigin = parseOrigin(env.ADMIN_APP_ORIGIN, { isProduction });
  if (appOrigin === null) problems.push(PROBLEMS.APP_ORIGIN);

  const loginMax = boundedInteger(env.ADMIN_LOGIN_RATE_LIMIT_MAX, { min: 1, max: 1000, fallback: 30 });
  if (loginMax === null) problems.push(PROBLEMS.LOGIN_LIMIT);

  const memoryKiB = boundedInteger(env.ADMIN_ARGON2_MEMORY_KIB, { min: ARGON2_BASELINE.memoryKiB, max: 1_048_576, fallback: ARGON2_BASELINE.memoryKiB });
  const passes = boundedInteger(env.ADMIN_ARGON2_PASSES, { min: ARGON2_BASELINE.passes, max: 10, fallback: ARGON2_BASELINE.passes });
  if (memoryKiB === null || passes === null) problems.push(PROBLEMS.ARGON2);

  if (problems.length > 0) return { ok: false, problems };

  // Doc 11 s12-18: __Host- and Secure wherever the origin is HTTPS (always in production);
  // a plain-HTTP local origin gets a non-prefixed, non-Secure development cookie.
  const secure = appOrigin.startsWith('https:');
  const resolved = {
    ok: true,
    enabled: true,
    appOrigin,
    cookie: Object.freeze({ name: secure ? '__Host-valida.sid' : 'valida.sid', secure, httpOnly: true, sameSite: 'strict', path: '/' }),
    loginRateLimit: Object.freeze({ windowMs: ADMIN_POLICY.loginWindowMs, max: loginMax }),
    argon2: Object.freeze({ memoryKiB, passes, parallelism: ARGON2_BASELINE.parallelism }),
    policy: ADMIN_POLICY,
  };
  // Secrets are non-enumerable: absent from every serialised or logged view of the configuration.
  Object.defineProperty(resolved, 'secrets', {
    enumerable: false,
    value: Object.freeze({
      sessionSecrets: Object.freeze([sessionSecret, ...previousSecrets]),
      mfaKeys,
      mfaCurrentKeyId: currentKeyId,
    }),
  });
  return Object.freeze(resolved);
}
