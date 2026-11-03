import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

/**
 * The verify:b6 gate's refusals, and its wiring (same contract as verify:b5,
 * plus the engine check and the PENDING provider gate).
 *
 * Every refusal happens BEFORE anything is run or any database contacted; the
 * nested-run guard is inherited, never cleared.
 */
const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const launch = (env) => {
  const result = spawnSync(process.execPath, ['scripts/verify-b6.mjs'], {
    cwd: backendRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
};

describe('verify:b6 refuses before running or contacting anything', () => {
  it('refuses a production launching environment', () => {
    const { code, output } = launch({
      APP_ENV: 'production',
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://127.0.0.1:1/valida_latest',
      MONGODB_TEST_URI: 'mongodb://127.0.0.1:1/valida_test',
    });
    expect(code).toBe(1);
    expect(output).toMatch(/B6 VERIFICATION REFUSED/);
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
    expect(output).toMatch(/B6 VERIFICATION REFUSED/);
    expect(output).not.toMatch(/offline suite/);
  }, 60_000);

  it('refuses a nested run instead of recursing into the suites', () => {
    const { code, output } = launch({ VALIDA_VERIFY_B6_ACTIVE: '1', MONGODB_TEST_URI: '' });
    expect(code).toBe(1);
    expect(output).toMatch(/verify:b6 is already running in a parent process/);
    expect(output).not.toMatch(/offline suite/);
  }, 60_000);
});

describe('verify:b6 wiring', () => {
  const script = fs.readFileSync(join(backendRoot, 'scripts', 'verify-b6.mjs'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(join(backendRoot, 'package.json'), 'utf8'));

  it('is the npm script', () => {
    expect(packageJson.scripts['verify:b6']).toBe('node scripts/verify-b6.mjs');
  });

  it('names every B6 acceptance file and carries the B5 and B4 acceptance gates forward; each file exists', () => {
    const listed = [...script.matchAll(/'(tests\/(?:db\/)?[\w-]+\.test\.js)'/g)].map(([, file]) => file);
    for (const required of [
      'tests/b6-config.test.js',
      'tests/b6-notification-service.test.js',
      'tests/b6-notifier.test.js',
      'tests/b6-apply-notifications.test.js',
      'tests/b6-readiness.test.js',
      'tests/b6-retry-command.test.js',
      'tests/b6-claim-ownership.test.js',
      'tests/b6-service-abort.test.js',
      'tests/b6-smtp-transport.test.js',
      'tests/b6-smtp-integration.test.js',
      'tests/b6-nodemailer-contract.test.js',
      'tests/b6-smoke-script.test.js',
      'tests/b6-smoke-lifecycle.test.js',
      'tests/b6-stage2-templates.test.js',
      'tests/apply-http.test.js',
      'tests/apply-failures.test.js',
      'tests/apply-units.test.js',
      'tests/apply-connection.test.js',
      'tests/apply-validation-http.test.js',
      'tests/staged-close.test.js',
      'tests/resume-intake-http.test.js',
      'tests/db/b6-notifications.test.js',
      'tests/db/b6-smoke-rehearsal.test.js',
      'tests/db/b6-smoke-cleanup.test.js',
    ]) {
      expect(listed, required).toContain(required);
    }
    listed.forEach((file) => expect(fs.existsSync(join(backendRoot, file)), file).toBe(true));
  });

  it('clears the developer storage AND email variables for every child run', () => {
    for (const name of ['RESUME_STORAGE_DRIVER', 'RESUME_STORAGE_LOCAL_ROOT', 'TRANSACTIONAL_EMAIL_PROVIDER', 'TRANSACTIONAL_EMAIL_API_KEY', 'RECRUITMENT_NOTIFICATION_RECIPIENT', 'EMAIL_RECIPIENT_ALLOWLIST', 'APPLICATION_ACKNOWLEDGEMENT_ENABLED', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURITY', 'SMTP_USERNAME', 'SMTP_PASSWORD']) {
      expect(script).toContain(`'${name}'`);
    }
    expect(script).toMatch(/env: \{ \.\.\.process\.env, \.\.\.isolated, \.\.\.env \}/);
  });

  it('treats a missing, unreachable or non-MongoDB database as a FAILED gate, never a skip', () => {
    expect(script).toMatch(/record\('B6 real-database gate', 'FAIL', 'database'\)/);
    expect(script).toMatch(/record\('B6 real-database gate \(prerequisites\)', reachable \? 'PASS' : 'FAIL', 'database'\)/);
    expect(script).toMatch(/record\(`Database engine is MongoDB \(\$\{engine\}\)`, isMongoDB \? 'PASS' : 'FAIL', 'database'\)/);
  });

  it('never sends email itself: no smoke script, no --send, no transport is invoked by the gate', () => {
    expect(script).not.toMatch(/notifications-smoke|ops:notifications:smoke'\s*\]|--confirm-live-email|createNotificationTransport|--send/);
  });

  it('never reports the real-provider gate as PASS in this build: PENDING, and exit code 2 when it is the only gap', () => {
    expect(script).toMatch(/record\('Real provider acceptance \/ delivery \(AWAITING INPUT\)', 'PENDING', 'provider'\)/);
    expect(script).not.toMatch(/record\('Real provider[^)]*'PASS'/);
    expect(script).toMatch(/process\.exit\(2\)/);
  });
});
