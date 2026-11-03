import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

/**
 * B6 — the ops:notifications:retry command as a real process (offline): its
 * refusals and error reporting. Its behaviour over a real MongoDB is in
 * tests/db/b6-notifications.test.js; the decision logic is
 * runNotificationRetry (tests/b6-notifier.test.js).
 */
const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const UNREACHABLE = 'mongodb://qa-user:qa-secret-password@127.0.0.1:1/valida_test';

const run = (args, env = {}) => {
  const result = spawnSync(process.execPath, ['scripts/notifications-retry.mjs', ...args], {
    cwd: backendRoot,
    // A clean environment: no developer .env is read (the script is run without --env-file).
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, MONGODB_URI: UNREACHABLE, MONGODB_CONNECT_TIMEOUT_MS: '1000', ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
};

describe('ops:notifications:retry', () => {
  it('is the npm script, reading backend/.env like npm start', () => {
    const packageJson = JSON.parse(fs.readFileSync(join(backendRoot, 'package.json'), 'utf8'));
    expect(packageJson.scripts['ops:notifications:retry']).toBe('node --env-file-if-exists=.env scripts/notifications-retry.mjs');
  });

  it('--send without a provider is refused BEFORE the database is contacted (TRANSACTIONAL_EMAIL_PROVIDER=none)', () => {
    const started = Date.now();
    const { code, output } = run(['--send']);
    expect(code).toBe(1);
    // r4: the wording names the setting (the provider itself is selected; this environment configures none).
    expect(output).toMatch(/provider: none configured \(TRANSACTIONAL_EMAIL_PROVIDER=none\)/);
    expect(output).toMatch(/REFUSED: --send requires a configured transactional email provider\. Nothing was read, written or sent\./);
    expect(output).not.toMatch(/database:|could not be reached/);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 30_000);

  it.each([
    [['--limit', '0'], /--limit must be a whole number from 1 to 500/],
    [['--limit', '501'], /--limit must be a whole number from 1 to 500/],
    [['--limit'], /--limit must be a whole number/],
    [['--sned'], /Unknown argument/],
  ])('usage error %j: exit 2, nothing contacted', (args, message) => {
    const { code, output } = run(args);
    expect(code).toBe(2);
    expect(output).toMatch(message);
    expect(output).toMatch(/Usage:/);
    expect(output).not.toMatch(/mode:/);
  }, 30_000);

  it('an unreachable database: exit 1, nothing written or sent, no connection string or credential printed', () => {
    const { code, output } = run([]);
    expect(code).toBe(1);
    expect(output).toMatch(/DRY RUN/);
    expect(output).toMatch(/could not be reached\. Nothing was written or sent\./);
    expect(output).not.toContain('qa-secret-password');
    expect(output).not.toContain('qa-user');
    expect(output).not.toContain('127.0.0.1:1');
  }, 30_000);

  it('invalid configuration: exit 1 with the variable named and the secret value withheld', () => {
    const { code, output } = run([], { TRANSACTIONAL_EMAIL_API_KEY: 'qa-secret-api-key-marker' });
    expect(code).toBe(1);
    expect(output).toMatch(/TRANSACTIONAL_EMAIL_API_KEY: is set but TRANSACTIONAL_EMAIL_PROVIDER is "none"/);
    expect(output).toMatch(/Nothing was read, written or sent\./);
    expect(output).not.toContain('qa-secret-api-key-marker');
  }, 30_000);
});
