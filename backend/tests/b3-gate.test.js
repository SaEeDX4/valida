import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, ConfigurationError } from '../src/config/env.js';
import { buildConnectedApp } from './helpers.js';

/**
 * B3 configuration, readiness truthfulness and the verify:b3 gate's refusals.
 */

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const withDatabase = (env = {}) => loadConfig({ MONGODB_URI: 'mongodb://127.0.0.1:27017/valida_dev', ...env });

describe('MONGODB_QUERY_TIMEOUT_MS (B3)', () => {
  it('defaults to 5000 ms and accepts the documented range', () => {
    expect(withDatabase().databaseQueryTimeoutMs).toBe(5_000);
    expect(withDatabase({ MONGODB_QUERY_TIMEOUT_MS: '500' }).databaseQueryTimeoutMs).toBe(500);
    expect(withDatabase({ MONGODB_QUERY_TIMEOUT_MS: '60000' }).databaseQueryTimeoutMs).toBe(60_000);
  });

  it.each(['499', '60001', '1.5', 'soon', '-1'])('rejects %s with a value-free message', (value) => {
    let error;
    try {
      withDatabase({ MONGODB_QUERY_TIMEOUT_MS: value });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error.message).toContain('MONGODB_QUERY_TIMEOUT_MS: must be an integer between 500 and 60000 (milliseconds)');
    expect(error.message).not.toContain(value);
  });
});

describe('readiness stays truthful after B3', () => {
  it('the Jobs API serves while /health/ready still answers 503 (resume storage not ready in this app; B6 not implemented)', async () => {
    const repository = {
      listOpenJobs: async () => ({ total: 0, jobs: [] }),
      findPublicJobBySlug: async () => null,
    };
    const app = buildConnectedApp({ jobRepository: repository });
    expect((await request(app).get('/api/v1/jobs')).status).toBe(200);
    const ready = await request(app).get('/api/v1/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.error).toEqual({ code: 'SERVICE_UNAVAILABLE', message: 'Service is not ready.' });
  });
});

describe('verify:b3 refuses before running or contacting anything', () => {
  const launch = (env) => {
    const result = spawnSync(process.execPath, ['scripts/verify-b3.mjs'], {
      cwd: backendRoot,
      // The nested-run guard is inherited, never cleared: every refusal below
      // happens before it would matter, and clearing it would remove the
      // protection against recursion if a refusal ever regressed.
      env: { ...process.env, ...env },
      encoding: 'utf8',
      timeout: 60_000,
    });
    return { code: result.status, output: `${result.stdout}${result.stderr}` };
  };

  it('refuses a production launching environment', () => {
    const { code, output } = launch({
      APP_ENV: 'production',
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://127.0.0.1:1/valida_latest',
      MONGODB_TEST_URI: 'mongodb://127.0.0.1:1/valida_test',
    });
    expect(code).toBe(1);
    expect(output).toMatch(/B3 VERIFICATION REFUSED/);
    expect(output).toMatch(/Nothing was run and no database was contacted/);
    expect(output).not.toMatch(/offline suite|Index apply|real-database suite/);
  }, 60_000);

  it('refuses a database whose name merely contains "test"', () => {
    const { code, output } = launch({
      APP_ENV: 'local',
      NODE_ENV: 'development',
      MONGODB_URI: 'mongodb://127.0.0.1:1/valida_dev',
      MONGODB_TEST_URI: 'mongodb://127.0.0.1:1/valida_latest',
    });
    expect(code).toBe(1);
    expect(output).toMatch(/explicitly disposable/);
    expect(output).not.toMatch(/offline suite/);
  }, 60_000);

  it('refuses a nested run instead of recursing into the suites', () => {
    const { code, output } = launch({ VALIDA_VERIFY_B3_ACTIVE: '1', MONGODB_TEST_URI: '' });
    expect(code).toBe(1);
    expect(output).toMatch(/verify:b3 is already running in a parent process/);
    expect(output).not.toMatch(/offline suite/);
  }, 60_000);
});
