import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { RELEASE_HEADER, RELEASE_SOURCE_VARIABLE, describeReleaseIdentity, resolveReleaseIdentity } from '../src/config/releaseIdentity.js';
import { ConfigurationError, loadConfig } from '../src/config/env.js';
import { resolveSiteAccess } from '../src/config/siteAccess.js';
import { formatStartupFailure, startServer } from '../src/server.js';
import { OFFLINE_TEST_MONGODB_URI, buildApp, capturingLogger, freePort, offlineDatabase, testConfig } from './helpers.js';

/**
 * C6-T5 — the release header on the API (C6 plan r3 §8.4, owner decision
 * D-6; config/releaseIdentity.js). Synthetic commit ids only.
 */
const SHA = '0123456789abcdef0123456789abcdef01234567';
const FORGED = 'ffffffffffffffffffffffffffffffffffffffff';
const header = RELEASE_HEADER.toLowerCase();
const configured = () => resolveReleaseIdentity({ [RELEASE_SOURCE_VARIABLE]: SHA });
const unset = () => resolveReleaseIdentity({});

describe('configuration — RENDER_GIT_COMMIT', () => {
  it.each([
    ['absent', undefined, { ok: true, sha: null, state: 'unset' }],
    ['empty', '', { ok: true, sha: null, state: 'unset' }],
    ['a full lowercase SHA', SHA, { ok: true, sha: SHA, state: 'configured' }],
  ])('%s -> %j', (_label, value, expected) => {
    expect(resolveReleaseIdentity(value === undefined ? {} : { RENDER_GIT_COMMIT: value })).toEqual(expected);
  });

  it.each([
    ['uppercase hex', SHA.toUpperCase()],
    ['39 characters', SHA.slice(0, 39)],
    ['41 characters', `${SHA}0`],
    ['an abbreviated SHA', SHA.slice(0, 7)],
    ['surrounding space', ` ${SHA}`],
    ['a trailing newline', `${SHA}\n`],
    ['non-hex characters', `${SHA.slice(0, 39)}g`],
    ['a branch name', 'main'],
    ['a 64-character SHA-256 id', SHA + SHA.slice(0, 24)],
    ['only spaces', '   '],
  ])('%s -> refused, without the value', (_label, value) => {
    const result = resolveReleaseIdentity({ RENDER_GIT_COMMIT: value });
    expect(result).toEqual({ ok: false, variable: 'RENDER_GIT_COMMIT', rule: expect.any(String) });
    expect(JSON.stringify(result)).not.toContain(value.trim() || 'x-never');
  });

  it('loadConfig: a valid SHA is carried as config.release; absent gives sha null', () => {
    const base = { APP_ENV: 'local', MONGODB_URI: OFFLINE_TEST_MONGODB_URI };
    expect(loadConfig({ ...base, RENDER_GIT_COMMIT: SHA }).release).toEqual({ ok: true, sha: SHA, state: 'configured' });
    expect(loadConfig(base).release).toEqual({ ok: true, sha: null, state: 'unset' });
  });

  it.each(['local', 'review', 'production'])('loadConfig (APP_ENV=%s): a malformed value stops configuration, naming the variable and never the value', (appEnv) => {
    const env = { APP_ENV: appEnv, MONGODB_URI: OFFLINE_TEST_MONGODB_URI, RENDER_GIT_COMMIT: 'qa-not-a-commit-value' };
    let error;
    try {
      loadConfig(env);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error.message).toContain('RENDER_GIT_COMMIT');
    expect(error.message).not.toContain('qa-not-a-commit-value');
  });

  it('describeReleaseIdentity: the start-up fields', () => {
    expect(describeReleaseIdentity(configured())).toEqual({ release: SHA, releaseState: 'configured' });
    expect(describeReleaseIdentity(unset())).toEqual({ release: null, releaseState: 'unset' });
  });
});

describe('the header on every kind of API response', () => {
  const app = (release, overrides = {}) => buildApp({ config: testConfig({ release, ...overrides }) });

  it.each([
    ['liveness', 'get', '/api/v1/health', 200],
    ['readiness (not ready: no database)', 'get', '/api/v1/health/ready', 503],
    ['an unknown API path', 'get', '/api/v1/qa-unknown', 404],
    ['a path outside the API', 'get', '/qa-outside', 404],
    ['a Jobs read while the database is unavailable (an error)', 'get', '/api/v1/jobs/qa-no-such-job', 503],
  ])('configured: %s -> %s %s carries the configured SHA', async (_label, method, path, status) => {
    const response = await request(app(configured()))[method](path);
    expect(response.status).toBe(status);
    expect(response.headers[header]).toBe(SHA);
  });

  it('configured: a CORS preflight from an allowed origin carries it', async () => {
    const response = await request(app(configured()))
      .options('/api/v1/jobs')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET');
    expect(response.status).toBe(204);
    expect(response.headers[header]).toBe(SHA);
  });

  it('configured: a private-site refusal (403) carries it', async () => {
    const siteAccess = resolveSiteAccess({ siteAccess: 'private', allowlist: '203.0.113.0/24', appEnv: 'local' });
    const response = await request(app(configured(), { siteAccess })).get('/api/v1/jobs');
    expect(response.status).toBe(403);
    expect(response.headers[header]).toBe(SHA);
  });

  it('a request cannot set it: a forged X-Valida-Release is ignored (configured)', async () => {
    const response = await request(app(configured())).get('/api/v1/health').set(RELEASE_HEADER, FORGED);
    expect(response.headers[header]).toBe(SHA);
  });

  it('a request cannot set it: a forged X-Valida-Release is not echoed when none is configured', async () => {
    const response = await request(app(unset())).get('/api/v1/health').set(RELEASE_HEADER, FORGED);
    expect(response.headers[header]).toBeUndefined();
  });

  it('unset (an ordinary local run): no header on any response', async () => {
    for (const path of ['/api/v1/health', '/api/v1/health/ready', '/api/v1/qa-unknown']) {
      const response = await request(app(unset())).get(path);
      expect(response.headers[header]).toBeUndefined();
    }
  });

  it('a configuration object without a release entry sends none', async () => {
    const config = { ...testConfig() };
    delete config.release;
    const response = await request(buildApp({ config })).get('/api/v1/health');
    expect(response.headers[header]).toBeUndefined();
  });
});

describe('start-up (startServer)', () => {
  const started = [];
  afterEach(async () => {
    while (started.length) await started.pop().shutdown('test cleanup');
  });
  const baseEnv = async () => ({
    NODE_ENV: 'test',
    APP_ENV: 'local',
    PORT: String(await freePort()),
    LOG_LEVEL: 'silent',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
    MONGODB_URI: OFFLINE_TEST_MONGODB_URI,
  });

  it('a valid SHA: listens, states it on responses and in one start-up line', async () => {
    const log = capturingLogger();
    const env = { ...(await baseEnv()), RENDER_GIT_COMMIT: SHA };
    const handle = await startServer({ env, database: offlineDatabase(), logger: log.logger });
    started.push(handle);
    const response = await fetch(`http://127.0.0.1:${env.PORT}/api/v1/health`, { headers: { [RELEASE_HEADER]: FORGED } });
    expect(response.headers.get(header)).toBe(SHA);
    const line = log.output().split('\n').filter(Boolean).map((text) => JSON.parse(text)).find((entry) => entry.msg === 'release identity');
    expect(line).toMatchObject({ release: SHA, releaseState: 'configured' });
  });

  it('absent: ordinary local start-up is unchanged; no header; the line says unset', async () => {
    const log = capturingLogger();
    const env = await baseEnv();
    const handle = await startServer({ env, database: offlineDatabase(), logger: log.logger });
    started.push(handle);
    const response = await fetch(`http://127.0.0.1:${env.PORT}/api/v1/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get(header)).toBeNull();
    const line = log.output().split('\n').filter(Boolean).map((text) => JSON.parse(text)).find((entry) => entry.msg === 'release identity');
    expect(line).toMatchObject({ release: null, releaseState: 'unset' });
  });

  it('malformed: refused before any database connection or socket; the printed failure names the variable, not the value', async () => {
    const database = offlineDatabase();
    const env = { ...(await baseEnv()), RENDER_GIT_COMMIT: 'QA-NOT-A-SHA-0123' };
    const error = await startServer({ env, database }).catch((caught) => caught);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(database.instance.connectCalls).toBe(0);
    const text = formatStartupFailure(error);
    expect(text).toContain('RENDER_GIT_COMMIT');
    expect(text).not.toContain('QA-NOT-A-SHA-0123');
    // Nothing listens on the port.
    await expect(fetch(`http://127.0.0.1:${env.PORT}/api/v1/health`)).rejects.toThrow();
  });
});
