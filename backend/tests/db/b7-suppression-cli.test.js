import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { RecipientSuppressionKey } from '../../src/models/RecipientSuppression.js';
import { keyCheckValue } from '../../src/modules/suppression/suppressionKeys.js';
import { clearAll, connectAndIndex } from './fixtures/suppressionHarness.js';
import { requireTestDatabase } from './testDatabase.js';

/**
 * B7 — `npm run ops:notifications:suppression` as a PROCESS against the
 * disposable test database: dry run by default, --apply needs a listed
 * operator, refusals exit 2, results print key ids and fixed tokens only.
 * Synthetic key bytes generated here.
 */
const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const script = path.join(import.meta.dirname, '..', '..', 'scripts', 'ops-notifications-suppression.mjs');
const KEY = crypto.randomBytes(32);
const env = {
  PATH: process.env.PATH,
  APP_ENV: 'local',
  NODE_ENV: 'test',
  MONGODB_URI: TEST_URI,
  SUPPRESSION_HMAC_KEY: KEY.toString('base64'),
  SUPPRESSION_HMAC_KEY_ID: 'qa-cli-k1',
  SUPPRESSION_OPERATOR_IDS: 'qa-operator',
};
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env, timeout: 30_000 });

beforeAll(async () => {
  await connectAndIndex(TEST_URI, TEST_DATABASE);
  await clearAll(TEST_DATABASE);
}, 30_000);
afterAll(async () => {
  await clearAll(TEST_DATABASE);
  await mongoose.disconnect();
});

describe('ops:notifications:suppression (process, real test database)', () => {
  it('key-register: dry run writes nothing; --apply without a listed operator is refused (exit 2); with one it registers once; a repeat is refused', async () => {
    const dry = run('key-register', '--key-id', 'qa-cli-k1');
    expect(dry.status).toBe(0);
    expect(dry.stdout).toMatch(/mode: DRY RUN/);
    expect(dry.stdout).toMatch(/"result": "WOULD_REGISTER"/);
    expect(await RecipientSuppressionKey.countDocuments({})).toBe(0);

    const intruder = run('key-register', '--key-id', 'qa-cli-k1', '--apply', '--operator', 'qa-intruder');
    expect(intruder.status).toBe(2);
    expect(intruder.stderr).toMatch(/REFUSED: UNKNOWN_OPERATOR/);
    expect(await RecipientSuppressionKey.countDocuments({})).toBe(0);

    const applied = run('key-register', '--key-id', 'qa-cli-k1', '--apply', '--operator', 'qa-operator');
    expect(applied.status).toBe(0);
    expect(applied.stdout).toMatch(/"result": "REGISTERED"/);
    const stored = await RecipientSuppressionKey.findById('qa-cli-k1').lean();
    expect(stored).toMatchObject({ state: 'ACTIVE', createdBy: 'qa-operator', check: keyCheckValue(KEY, 'qa-cli-k1') });

    const again = run('key-register', '--key-id', 'qa-cli-k1', '--apply', '--operator', 'qa-operator');
    expect(again.status).toBe(2);
    expect(again.stderr).toMatch(/REFUSED: KEY_ID_ALREADY_USED/);

    const coverage = run('coverage');
    expect(coverage.status).toBe(0);
    expect(coverage.stdout).toMatch(/"result": "COVERAGE_COMPLETE"/);
    for (const output of [dry, intruder, applied, again, coverage]) {
      const printed = output.stdout + output.stderr;
      for (const secret of [KEY.toString('base64'), KEY.toString('hex'), stored.check]) expect(printed).not.toContain(secret);
    }
  });

  it('a malformed key in the configuration is refused before connecting (exit 2), without echoing it', () => {
    const bad = spawnSync(process.execPath, [script, 'coverage'], { encoding: 'utf8', env: { ...env, SUPPRESSION_HMAC_KEY: 'c2hvcnQ=' }, timeout: 30_000 });
    expect(bad.status).toBe(2);
    expect(bad.stderr).toMatch(/SUPPRESSION_HMAC_KEY: must be 32-128 bytes/);
    expect(bad.stderr).not.toContain('c2hvcnQ=');
    expect(bad.stdout).not.toMatch(/database:/);
  });
});
