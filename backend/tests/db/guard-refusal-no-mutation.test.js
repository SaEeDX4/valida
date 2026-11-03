import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { requireTestDatabase, assertConnectedToTestDatabase } from './testDatabase.js';
import { plainText, hasVTControlSequences, withColourMode, COLOUR_MODES } from '../fixtures/terminalOutput.js';

/**
 * B6 r7 — the destructive-test guard against a REACHABLE database server.
 *
 * The offline guard test (tests/test-database-guard.test.js) points every
 * refused target at a closed port, so even a broken guard could not write
 * anything. Here the refused target is a database on the SAME, reachable
 * server as the test database, under a name that is not explicitly disposable
 * (not valida_test / valida_test_*). The runner must refuse in its global
 * setup — nonzero exit, the guard's own reason reported by the runner itself,
 * no test file loaded, no connection string disclosed — and that database
 * must still hold nothing afterwards: nothing was created, written or dropped.
 *
 * r8: the runner colours its output on Windows even when piped, so the run is
 * made twice — colours forced off and forced on — and every assertion (the
 * "must not contain" ones included) runs on the text with the VT control
 * sequences removed (../fixtures/terminalOutput.js).
 */
const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const PROBE = `valida_guardprobe_${randomBytes(4).toString('hex')}`;
const PROBE_URI = TEST_URI.replace(/\/([^/?]+)(\?|$)/, `/${PROBE}$2`);
const backendRoot = path.join(import.meta.dirname, '..', '..');

const collectionsOf = async (name) => (await mongoose.connection.client.db(name).listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name);

beforeAll(async () => {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5_000 });
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
});
afterAll(async () => {
  await mongoose.disconnect();
});

describe('test:db refuses a non-disposable database on a reachable server and changes nothing (r7, r8)', () => {
  it.each(COLOUR_MODES)('nonzero exit, the guard\'s reason reported by the runner, no test file loaded, nothing disclosed — and the refused database holds nothing (%s output)', async (colour) => {
    expect(PROBE_URI).not.toBe(TEST_URI);
    expect(await collectionsOf(PROBE)).toEqual([]);

    const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.db.config.js'], {
      cwd: backendRoot,
      env: withColourMode({ ...process.env, APP_ENV: 'local', NODE_ENV: 'development', MONGODB_TEST_URI: PROBE_URI }, colour),
      encoding: 'utf8',
      timeout: 90_000,
    });
    const raw = `${result.stdout}${result.stderr}`;
    const output = plainText(raw);

    expect(hasVTControlSequences(raw), `${colour} output`).toBe(colour === 'coloured');
    expect(result.status, output).not.toBe(0);
    expect(output).toMatch(/Error: \[test:db\] Refusing to run: the MONGODB_TEST_URI database must be an explicitly disposable test/);
    expect(output).not.toMatch(/Startup Error|charCodeAt|is not a function/);
    expect(output).not.toMatch(/database\.test\.js|b6-notifications|b5-apply|guard-refusal-no-mutation/);
    expect(output).not.toContain(PROBE_URI);
    expect(output).not.toMatch(/mongodb(\+srv)?:\/\//);

    // Nothing was created in the refused database (a database without collections does not exist).
    expect(await collectionsOf(PROBE)).toEqual([]);
  }, 120_000);
});
