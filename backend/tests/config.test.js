import { describe, it, expect } from 'vitest';
import { loadConfig, LOCAL_DEFAULT_ORIGINS } from '../src/config/env.js';

/**
 * Configuration validation — Doc 15 section 50.
 * Invalid or missing production-critical configuration must stop startup.
 */
describe('configuration', () => {
  it('applies safe local defaults', () => {
    const config = loadConfig({});
    expect(config.appEnv).toBe('local');
    expect(config.port).toBe(4000);
    expect(config.corsAllowedOrigins).toEqual(LOCAL_DEFAULT_ORIGINS);
    // Never trust proxy headers unless explicitly configured.
    expect(config.trustProxy).toBe(false);
    expect(config.rateLimit).toEqual({ windowMs: 60_000, max: 120 });
    expect(config.jsonBodyLimit).toBe('100kb');
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
    expect(() => loadConfig(env)).toThrow(/Invalid backend configuration/);
  });

  it('rejects a wildcard CORS origin', () => {
    expect(() => loadConfig({ CORS_ALLOWED_ORIGINS: '*' })).toThrow(/must not contain "\*"/);
    expect(() => loadConfig({ CORS_ALLOWED_ORIGINS: 'http://localhost:5173,*' })).toThrow(/must not contain "\*"/);
  });

  it.each([
    'valida.lt',
    'https://valida.lt/',
    'https://valida.lt/app',
    'ftp://valida.lt',
  ])('rejects malformed CORS origin %s', (origin) => {
    // The message is value-free by construction, so it is matched on the rule
    // wording rather than on the rejected value.
    expect(() => loadConfig({ CORS_ALLOWED_ORIGINS: origin })).toThrow(/not a canonical origin/);
  });

  it('requires an explicit allowlist in production', () => {
    expect(() => loadConfig({ APP_ENV: 'production', NODE_ENV: 'production' })).toThrow(
      /CORS_ALLOWED_ORIGINS: is required when APP_ENV=production/,
    );
  });

  it('accepts a valid production configuration', () => {
    const config = loadConfig({
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
      loadConfig({ PORT: 'not-a-port', CORS_ALLOWED_ORIGINS: 'https://valida.lt' });
    } catch (error) {
      message = error.message;
    }
    expect(message).toMatch(/PORT/);
    expect(message).not.toMatch(/not-a-port/);
  });

  it('does not require future-milestone variables', () => {
    // Requiring MONGODB_URI before B2 would imply a database exists.
    const config = loadConfig({});
    expect(config).not.toHaveProperty('mongodbUri');
    expect(() => loadConfig({ MONGODB_URI: '' })).not.toThrow();
  });
});


describe('CORS origin validation (correction cycle 2, finding 3)', () => {
  /**
   * Validated with the WHATWG URL parser. The previous regular expression,
   * /^https?:\/\/[^/\s]+$/, accepted userinfo, query strings and fragments,
   * because none of them contains a slash after the host.
   */
  const accept = (origin) =>
    expect(loadConfig({ CORS_ALLOWED_ORIGINS: origin }).corsAllowedOrigins).toEqual([origin]);
  const reject = (origin) => expect(() => loadConfig({ CORS_ALLOWED_ORIGINS: origin })).toThrow(
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
      loadConfig({ CORS_ALLOWED_ORIGINS: 'https://valida.lt, https://www.valida.lt' })
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
      loadConfig({ CORS_ALLOWED_ORIGINS: '  https://valida.lt ,  https://www.valida.lt  ' })
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
      loadConfig(env);
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
      loadConfig({ CORS_ALLOWED_ORIGINS: SECRET });
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
