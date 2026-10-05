import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

/**
 * The verify:b5 gate's refusals, and its wiring (same contract as verify:b4).
 *
 * Every refusal happens BEFORE anything is run or any database contacted; the
 * nested-run guard is inherited, never cleared.
 */
const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const launch = (env) => {
  const result = spawnSync(process.execPath, ['scripts/verify-b5.mjs'], {
    cwd: backendRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
};

describe('verify:b5 refuses before running or contacting anything', () => {
  it('refuses a production launching environment', () => {
    const { code, output } = launch({
      APP_ENV: 'production',
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://127.0.0.1:1/valida_latest',
      MONGODB_TEST_URI: 'mongodb://127.0.0.1:1/valida_test',
    });
    expect(code).toBe(1);
    expect(output).toMatch(/B5 VERIFICATION REFUSED/);
    expect(output).toMatch(/Nothing was run and no database was contacted/);
    expect(output).not.toMatch(/offline suite|acceptance gate|Index apply/);
  }, 60_000);

  it('refuses the development database as a test target', () => {
    const { code, output } = launch({
      APP_ENV: 'local',
      NODE_ENV: 'development',
      MONGODB_URI: 'mongodb://127.0.0.1:1/valida_dev',
      MONGODB_TEST_URI: 'mongodb://127.0.0.1:1/valida_dev',
    });
    expect(code).toBe(1);
    expect(output).toMatch(/B5 VERIFICATION REFUSED/);
    expect(output).not.toMatch(/offline suite/);
  }, 60_000);

  it('refuses a nested run instead of recursing into the suites', () => {
    const { code, output } = launch({ VALIDA_VERIFY_B5_ACTIVE: '1', MONGODB_TEST_URI: '' });
    expect(code).toBe(1);
    expect(output).toMatch(/verify:b5 is already running in a parent process/);
    expect(output).not.toMatch(/offline suite/);
  }, 60_000);
});

describe('verify:b5 wiring', () => {
  const script = fs.readFileSync(join(backendRoot, 'scripts', 'verify-b5.mjs'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(join(backendRoot, 'package.json'), 'utf8'));

  it('is the npm script', () => {
    expect(packageJson.scripts['verify:b5']).toBe('node scripts/verify-b5.mjs');
  });

  it('names every B5 acceptance file and carries the B4 acceptance gate forward; each file exists', () => {
    const listed = [...script.matchAll(/'(tests\/(?:db\/)?[\w-]+\.test\.js)'/g)].map(([, file]) => file);
    for (const required of [
      'tests/apply-http.test.js',
      'tests/apply-validation-http.test.js',
      'tests/apply-failures.test.js',
      'tests/apply-units.test.js',
      'tests/apply-connection.test.js',
      'tests/staged-close.test.js',
      'tests/upload-temp-failure.test.js',
      'tests/db/b5-apply.test.js',
      'tests/db/b5-apply-server.test.js',
    ]) {
      expect(listed, required).toContain(required);
    }
    listed.forEach((file) => expect(fs.existsSync(join(backendRoot, file)), file).toBe(true));
  });

  it('clears the developer storage variables for every child run', () => {
    expect(script).toMatch(/const isolated = \{ RESUME_STORAGE_DRIVER: '', RESUME_STORAGE_LOCAL_ROOT: '' \}/);
    expect(script).toMatch(/env: \{ \.\.\.process\.env, \.\.\.isolated, \.\.\.env \}/);
  });

  it('treats a missing or unreachable database as a FAILED gate, never a skip', () => {
    expect(script).toMatch(/results\.push\(\{ label: 'B5 real-database gate', ok: false \}\)/);
    expect(script).toMatch(/results\.push\(\{ label: 'B5 real-database gate \(prerequisites\)', ok: reachable \}\)/);
  });
});
