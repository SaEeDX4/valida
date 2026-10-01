import { describe, it, expect } from 'vitest';
import { inspect } from 'node:util';
import { loadConfig, LOCAL_DEFAULT_ORIGINS, REDACTED } from '../src/config/env.js';

/*
 * From B2 the database connection string is required in every environment.
 * The B1 cases below therefore start from a valid MONGODB_URI, so each one
 * passes or fails only because of the variable it is actually about. The
 * requirement itself is tested explicitly further down.
 */
const TEST_DATABASE = { MONGODB_URI: 'mongodb://127.0.0.1:27017/valida_test' };
const loadWithDatabase = (env) => loadConfig({ ...TEST_DATABASE, ...env });

/**
 * Configuration validation — Doc 15 section 50.
 * Invalid or missing production-critical configuration must stop startup.
 */
describe('configuration', () => {
  it('applies safe local defaults', () => {
    const config = loadWithDatabase({});
    expect(config.appEnv).toBe('local');
    expect(config.port).toBe(4000);
    expect(config.corsAllowedOrigins).toEqual(LOCAL_DEFAULT_ORIGINS);
    // Never trust proxy headers unless explicitly configured.
    expect(config.trustProxy).toBe(false);
    expect(config.rateLimit).toEqual({ windowMs: 60_000, max: 120 });
    expect(config.jsonBodyLimit).toBe('100kb');
    expect(config.databaseConnectTimeoutMs).toBe(10_000);
  });

  it.each([
    ['PORT above range', { PORT: '99999' }],
    ['PORT not a number', { PORT: 'http' }],
    ['PORT zero', { PORT: '0' }],
    ['unknown APP_ENV', { APP_ENV: 'staging' }],
    ['unknown NODE_ENV', { NODE_ENV: 'prod' }],
    ['unknown LOG_LEVEL', { LOG_LEVEL: 'verbose' }],
    ['non-numeric TRUST_PROXY', { TRUST_PROXY: 'yes' }],
    ['TRUST_PROXY out of range', { TRUST_PROXY: '99' }],
    ['rate limit window too small', { RATE_LIMIT_WINDOW_MS: '10' }],
    ['rate limit max zero', { RATE_LIMIT_MAX: '0' }],
  ])('rejects %s', (_label, env) => {
    expect(() => loadWithDatabase(env)).toThrow(/Invalid backend configuration/);
  });

  it('rejects a wildcard CORS origin', () => {
    expect(() => loadWithDatabase({ CORS_ALLOWED_ORIGINS: '*' })).toThrow(/must not contain "\*"/);
    expect(() => loadWithDatabase({ CORS_ALLOWED_ORIGINS: 'http://localhost:5173,*' })).toThrow(/must not contain "\*"/);
  });

  it.each([
    'valida.lt',
    'https://valida.lt/',
    'https://valida.lt/app',
    'ftp://valida.lt',
  ])('rejects malformed CORS origin %s', (origin) => {
    // The message is value-free by construction, so it is matched on the rule
    // wording rather than on the rejected value.
    expect(() => loadWithDatabase({ CORS_ALLOWED_ORIGINS: origin })).toThrow(/not a canonical origin/);
  });

  it('requires an explicit allowlist in production', () => {
    expect(() => loadWithDatabase({ APP_ENV: 'production', NODE_ENV: 'production' })).toThrow(
      /CORS_ALLOWED_ORIGINS: is required when APP_ENV=production/,
    );
  });

  it('accepts a valid production configuration', () => {
    const config = loadWithDatabase({
      APP_ENV: 'production',
      NODE_ENV: 'production',
      PORT: '8080',
      CORS_ALLOWED_ORIGINS: 'https://valida.lt, https://www.valida.lt',
      TRUST_PROXY: '1',
    });
    expect(config.isProduction).toBe(true);
    expect(config.corsAllowedOrigins).toEqual(['https://valida.lt', 'https://www.valida.lt']);
    expect(config.trustProxy).toBe(1);
  });

  it('names the offending variable without printing its value', () => {
    let message = '';
    try {
      loadWithDatabase({ PORT: 'not-a-port', CORS_ALLOWED_ORIGINS: 'https://valida.lt' });
    } catch (error) {
      message = error.message;
    }
    expect(message).toMatch(/PORT/);
    expect(message).not.toMatch(/not-a-port/);
  });

  it('requires MONGODB_URI from Milestone B2 onward', () => {
    // B1 deliberately did not require it; B2 connects at startup, so a missing
    // connection string must stop the process rather than start it half-working.
    expect(() => loadConfig({})).toThrow(/MONGODB_URI: is required/);
    expect(() => loadConfig({ MONGODB_URI: '' })).toThrow(/MONGODB_URI/);
    expect(loadWithDatabase({}).mongodbUri).toBe(TEST_DATABASE.MONGODB_URI);
  });

  it('still does not require or read variables owned by later milestones', () => {
    // Requiring email or public-URL settings before B6/Release C would imply
    // those capabilities exist. B4 CHANGE: resume storage is now implemented,
    // so `resumeStorage` is a real setting — but only its two B4 variables
    // are read, it stays optional, and an unrelated storage variable (a
    // production bucket name, which belongs to C6) is still ignored.
    const config = loadWithDatabase({
      RESUME_STORAGE_BUCKET: 'unused',
      TRANSACTIONAL_EMAIL_API_KEY: 'unused',
      PUBLIC_SITE_URL: 'unused',
    });
    const keys = Object.keys(config).join(' ').toLowerCase();
    ['email', 'publicsite', 'siteurl'].forEach((fragment) =>
      expect(keys, `unexpected ${fragment} setting`).not.toContain(fragment),
    );
    expect(Object.keys(config).filter((key) => key.toLowerCase().includes('storage'))).toEqual(['resumeStorage']);
    expect(config.resumeStorage).toEqual({ driver: null, localRoot: null });
    expect(JSON.stringify(config)).not.toMatch(/unused/);
  });

  it('reports every missing production requirement in one error', () => {
    let error;
    try {
      loadConfig({ APP_ENV: 'production', NODE_ENV: 'production' });
    } catch (caught) {
      error = caught;
    }
    expect(error.name).toBe('ConfigurationError');
    expect(error.issues.map((issue) => issue.variable)).toEqual(['CORS_ALLOWED_ORIGINS', 'MONGODB_URI']);
  });

  it('never serialises the database connection string', () => {
    const secretUri = 'mongodb+srv://admin:s3cr3t@cluster0.example.net/valida?authSource=admin';
    const config = loadConfig({ MONGODB_URI: secretUri });
    // The connection code still receives the real value...
    expect(config.mongodbUri).toBe(secretUri);
    // ...but JSON, util.inspect (console.log) and a spread copy never show it.
    [JSON.stringify(config), inspect(config), JSON.stringify({ ...config, port: 1 })].forEach((text) => {
      expect(text).toContain(REDACTED);
      [/s3cr3t/, /admin:/, /cluster0/, /example\.net/].forEach((pattern) =>
        expect(text, `leaked ${pattern}`).not.toMatch(pattern),
      );
    });
  });
});


describe('CORS origin validation (correction cycle 2, finding 3)', () => {
  /**
   * Validated with the WHATWG URL parser. The previous regular expression,
   * /^https?:\/\/[^/\s]+$/, accepted userinfo, query strings and fragments,
   * because none of them contains a slash after the host.
   */
  const accept = (origin) =>
    expect(loadWithDatabase({ CORS_ALLOWED_ORIGINS: origin }).corsAllowedOrigins).toEqual([origin]);
  const reject = (origin) => expect(() => loadWithDatabase({ CORS_ALLOWED_ORIGINS: origin })).toThrow(
    /Invalid backend configuration/,
  );

  it.each([
    'http://localhost:5173',
    'http://localhost:4173',
    'https://valida.lt',
    'http://valida.lt',
    'https://www.valida.lt',
    'https://valida.lt:8443',
    'http://127.0.0.1:3000',
  ])('accepts the canonical origin %s', (origin) => accept(origin));

  it('accepts a comma-separated list', () => {
    expect(
      loadWithDatabase({ CORS_ALLOWED_ORIGINS: 'https://valida.lt, https://www.valida.lt' })
        .corsAllowedOrigins,
    ).toEqual(['https://valida.lt', 'https://www.valida.lt']);
  });

  it.each([
    ['userinfo', 'https://user:password@example.com'],
    ['username only', 'https://user@example.com'],
    ['query string', 'https://example.com?token=x'],
    ['fragment', 'https://example.com#fragment'],
    ['path', 'https://example.com/path'],
    ['trailing slash', 'https://example.com/'],
    ['invalid port', 'https://example.com:99999'],
    ['non-numeric port', 'https://example.com:abc'],
    ['ftp protocol', 'ftp://example.com'],
    ['file protocol', 'file:///etc/passwd'],
    ['javascript protocol', 'javascript:alert(1)'],
    ['wildcard', '*'],
    ['scheme-relative wildcard', '//*'],
    ['bare host', 'example.com'],
    ['missing host', 'https://'],
    ['embedded space', 'https://exa mple.com'],
    ['redundant default port', 'https://example.com:443'],
    ['uppercase host', 'https://EXAMPLE.com'],
  ])('rejects %s', (_label, origin) => reject(origin));

  it('rejects a list where only one entry is invalid', () => {
    reject('https://valida.lt,https://user:pw@evil.example');
  });

  it('trims surrounding whitespace around list entries but not inside an origin', () => {
    // "a, b" is the natural way to write the list in a .env file, so padding
    // around an entry is trimmed. Whitespace INSIDE an origin stays invalid.
    expect(
      loadWithDatabase({ CORS_ALLOWED_ORIGINS: '  https://valida.lt ,  https://www.valida.lt  ' })
        .corsAllowedOrigins,
    ).toEqual(['https://valida.lt', 'https://www.valida.lt']);
    reject('https://exa mple.com');
  });
});

describe('configuration errors never contain the rejected value (finding 2)', () => {
  /**
   * The value of an environment variable may itself be a credential — an
   * origin can carry userinfo and a token in its query. Interpolating it into
   * an error message would place it in terminal and hosting logs.
   */
  const SECRET = 'https://user:s3cr3t@example.com/path?token=AKIAEXAMPLE';
  const LEAKS = [/s3cr3t/, /AKIAEXAMPLE/, /user:/, /token=/, /example\.com/];

  const messageFor = (env) => {
    try {
      loadWithDatabase(env);
      return '';
    } catch (error) {
      return `${error.message} ${JSON.stringify(error.issues ?? [])}`;
    }
  };

  it.each([
    ['CORS_ALLOWED_ORIGINS', { CORS_ALLOWED_ORIGINS: SECRET }],
    ['PORT', { PORT: SECRET }],
    ['APP_ENV', { APP_ENV: SECRET }],
    ['NODE_ENV', { NODE_ENV: SECRET }],
    ['LOG_LEVEL', { LOG_LEVEL: SECRET }],
    ['TRUST_PROXY', { TRUST_PROXY: SECRET }],
    ['RATE_LIMIT_MAX', { RATE_LIMIT_MAX: SECRET }],
    ['RATE_LIMIT_WINDOW_MS', { RATE_LIMIT_WINDOW_MS: SECRET }],
  ])('a secret-looking %s value never reaches the error text', (variable, env) => {
    const message = messageFor(env);
    // The variable NAME is expected and useful.
    expect(message).toContain(variable);
    LEAKS.forEach((pattern) => expect(message, `leaked ${pattern}`).not.toMatch(pattern));
  });

  it('throws a ConfigurationError carrying only variable and rule', () => {
    let error;
    try {
      loadWithDatabase({ CORS_ALLOWED_ORIGINS: SECRET });
    } catch (caught) {
      error = caught;
    }
    expect(error.name).toBe('ConfigurationError');
    expect(error.issues).toEqual([
      { variable: 'CORS_ALLOWED_ORIGINS', rule: expect.any(String) },
    ]);
    expect(JSON.stringify(error.issues)).not.toMatch(/s3cr3t|AKIAEXAMPLE/);
  });
});
