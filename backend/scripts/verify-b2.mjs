#!/usr/bin/env node
/**
 * B2 verification gate.
 *
 *   npm run verify:b2
 *
 * Before anything else, if MONGODB_TEST_URI is set it is checked with the
 * fail-closed test-database guard (scripts/test-database.mjs) against the
 * environment this command was launched with. A refused target stops the
 * command immediately with exit code 1 — nothing is run, nothing is touched.
 *
 * Then it runs, in order:
 *   0. a Node.js 24 runtime check (package.json engines);
 *   1. the offline suite (schema, service, config, and all B1 behaviour);
 *   2. the real-database prerequisites (MONGODB_TEST_URI set, accepted by
 *      the guard, and reachable);
 *   3. `db:indexes:apply` against that test database;
 *   4. the REAL-DATABASE suite (persistence across a process restart,
 *      uniqueness, concurrency, lifecycle, index-command behaviour, server
 *      startup/shutdown against MongoDB);
 *   5. `db:indexes:check` against that test database.
 *
 * THE DATABASE GATE CANNOT BE SKIPPED. If MONGODB_TEST_URI is absent or the
 * database is unreachable, this command FAILS with a non-zero exit code and
 * says so. It never reports overall PASS with the database checks skipped:
 * persistence, uniqueness and concurrency cannot be demonstrated by mocks, so
 * a green result without them would be misleading.
 */
import { spawnSync } from 'node:child_process';
import mongoose from 'mongoose';
import { checkTestDatabaseTarget } from './test-database.mjs';

const TEST_URI = process.env.MONGODB_TEST_URI;

// ------------------------------------------------------------ fail closed --
// Judged on the ORIGINATING environment, before any child process is given an
// overridden MONGODB_URI.
const target = checkTestDatabaseTarget({ env: process.env });
if (TEST_URI && !target.ok) {
  console.error(`\nB2 VERIFICATION REFUSED — ${target.reason}`);
  console.error('Nothing was run and no database was contacted.');
  process.exit(1);
}

/*
 * The offline suite includes tests that launch this script to prove the
 * refusal above. A nested run is refused so that, even if a future change broke
 * the guard, those tests could not recurse into a full verification.
 */
if (process.env.VALIDA_VERIFY_B2_ACTIVE === '1') {
  console.error('B2 VERIFICATION REFUSED — verify:b2 is already running in a parent process.');
  process.exit(1);
}
process.env.VALIDA_VERIFY_B2_ACTIVE = '1';

const results = [];

function run(label, command, args, env = {}) {
  process.stdout.write(`\n=== ${label} ===\n`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  const ok = result.status === 0;
  results.push({ label, ok });
  return ok;
}

// ---------------------------------------------------------------- runtime --
/*
 * package.json declares engines ">=24.0.0 <25.0.0". The authoritative B2
 * verification runs on Node 24; any other runtime is reported as a failed gate
 * so a result from another version is never presented as the real thing.
 */
const nodeMajor = Number(process.versions.node.split('.')[0]);
process.stdout.write(`\n=== Node.js runtime ===\nnode ${process.version} (${process.platform}, ${process.arch})\n`);
if (nodeMajor !== 24) {
  console.error('FAIL: the backend requires Node.js 24 (engines >=24.0.0 <25.0.0).');
}
results.push({ label: `Node.js 24 runtime (found ${process.version})`, ok: nodeMajor === 24 });

// ---------------------------------------------------------------- offline --
run('B2 offline suite (schema, services, B1 behaviour)', 'npx', ['vitest', 'run']);

// --------------------------------------------------------------- database --
process.stdout.write('\n=== B2 real-database gate ===\n');

if (!TEST_URI) {
  console.error('FAIL: MONGODB_TEST_URI is not set.');
  console.error('');
  console.error('  The database gate is mandatory. Persistence, unique-index enforcement and');
  console.error('  concurrent-insert behaviour cannot be proven without a real MongoDB, and');
  console.error('  mocks are not evidence of them.');
  console.error('');
  console.error('  Windows PowerShell, using a local server:');
  console.error('    $env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test"');
  console.error('    npm run verify:b2');
  results.push({ label: 'B2 real-database gate', ok: false });
} else {
  let reachable = false;
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5000 });
    await mongoose.connection.db.admin().command({ ping: 1 });
    reachable = true;
    console.log(`reachable: approved test database "${target.databaseName}"`);
    await mongoose.disconnect();
  } catch {
    // The driver message may contain the host and credentials; it is not printed.
    console.error('FAIL: MONGODB_TEST_URI is set but the database could not be reached.');
    console.error('  Start MongoDB and re-run. The gate does not pass without it.');
    try {
      await mongoose.disconnect();
    } catch {
      // Already closed.
    }
  }
  results.push({ label: 'B2 real-database gate (prerequisites)', ok: reachable });

  if (reachable) {
    const againstTestDatabase = { MONGODB_URI: TEST_URI };
    run('B2 index apply (test database)', 'node', ['scripts/db-indexes.mjs', 'apply'], againstTestDatabase);
    run('B2 database suite', 'npx', ['vitest', 'run', '--config', 'vitest.db.config.js']);
    run('B2 index check (test database)', 'node', ['scripts/db-indexes.mjs', 'check'], againstTestDatabase);
  }
}

// ----------------------------------------------------------------- report --
console.log('\n=== B2 verification summary ===');
for (const { label, ok } of results) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
}

const failed = results.filter((entry) => !entry.ok).length;
console.log(failed === 0 ? '\nB2 VERIFICATION PASSED' : `\nB2 VERIFICATION FAILED — ${failed} gate(s)`);
process.exit(failed === 0 ? 0 : 1);
