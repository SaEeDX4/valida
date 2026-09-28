#!/usr/bin/env node
/**
 * B3 verification gate — Job Provisioning & Public Jobs API.
 *
 *   npm run verify:b3
 *
 * Before anything else, if MONGODB_TEST_URI is set it is checked with the
 * approved fail-closed test-database guard (scripts/test-database.mjs) against
 * the environment this command was launched with. A refused target stops the
 * command immediately with exit code 1 — nothing is run, nothing is touched.
 *
 * Then it runs, in order, and reports PASS/FAIL for each gate:
 *   0. a Node.js 24 runtime check (package.json engines), with the OS reported;
 *   1. the complete offline suite — B1, B2 and B3 (validation, DTO mapping,
 *      money conversion, visibility rules, HTTP contract, provisioning
 *      planning, configuration);
 *   2. the real-database prerequisites (MONGODB_TEST_URI set, accepted by the
 *      guard, and reachable);
 *   3. `db:indexes:apply` against that test database;
 *   4. the complete REAL-DATABASE suite — the B2 suite (persistence, restart,
 *      uniqueness, concurrency, lifecycle, index commands, server lifecycle)
 *      AND the B3 suite (public Jobs API over real MongoDB and real HTTP,
 *      effective-closing boundaries, query plan, database failure -> 503, and
 *      provisioning create/update/unchanged/lifecycle/duplicate-slug/screening
 *      identifiers, including the provisioning CLI itself);
 *   5. `db:indexes:check` against that test database.
 *
 * THE DATABASE GATE CANNOT BE SKIPPED. If MONGODB_TEST_URI is absent or the
 * database is unreachable, this command FAILS with a non-zero exit code and
 * says so. It never reports PASS with the database checks skipped: what the
 * public API returns from MongoDB, and what provisioning writes, cannot be
 * demonstrated with a stand-in.
 */
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import mongoose from 'mongoose';
import { checkTestDatabaseTarget } from './test-database.mjs';

const TEST_URI = process.env.MONGODB_TEST_URI;

// ------------------------------------------------------------ fail closed --
// Judged on the ORIGINATING environment, before any child process is given an
// overridden MONGODB_URI.
const target = checkTestDatabaseTarget({ env: process.env });
if (TEST_URI && !target.ok) {
  console.error(`\nB3 VERIFICATION REFUSED — ${target.reason}`);
  console.error('Nothing was run and no database was contacted.');
  process.exit(1);
}

/*
 * The offline suite includes tests that launch this script to prove the
 * refusal above. A nested run is refused so that, even if a future change broke
 * the guard, those tests could not recurse into a full verification.
 */
if (process.env.VALIDA_VERIFY_B3_ACTIVE === '1') {
  console.error('B3 VERIFICATION REFUSED — verify:b3 is already running in a parent process.');
  process.exit(1);
}
process.env.VALIDA_VERIFY_B3_ACTIVE = '1';

const results = [];

function run(label, command, args, env = {}) {
  process.stdout.write(`\n=== ${label} ===\n`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...env },
  });
  const ok = result.status === 0;
  results.push({ label: `${label} (exit ${result.status ?? 'signal'})`, ok });
  return ok;
}

// ---------------------------------------------------------------- runtime --
const nodeMajor = Number(process.versions.node.split('.')[0]);
process.stdout.write(
  '\n=== Runtime ===\n' +
    `node ${process.version} (${process.platform}, ${process.arch})\n` +
    `os   ${os.type()} ${os.release()}\n`,
);
if (nodeMajor !== 24) {
  console.error('FAIL: the backend requires Node.js 24 (engines >=24.0.0 <25.0.0).');
}
results.push({ label: `Node.js 24 runtime (found ${process.version})`, ok: nodeMajor === 24 });

// ---------------------------------------------------------------- offline --
run('B1 + B2 + B3 offline suite', 'npx', ['vitest', 'run']);

// --------------------------------------------------------------- database --
process.stdout.write('\n=== B3 real-database gate ===\n');

if (!TEST_URI) {
  console.error('FAIL: MONGODB_TEST_URI is not set.');
  console.error('');
  console.error('  The database gate is mandatory. What GET /api/v1/jobs returns from MongoDB,');
  console.error('  the effective-closing boundaries and what provisioning writes cannot be');
  console.error('  proven without a real MongoDB, and mocks are not evidence of them.');
  console.error('');
  console.error('  Windows PowerShell, using a local server:');
  console.error('    $env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test"');
  console.error('    npm run verify:b3');
  results.push({ label: 'B3 real-database gate', ok: false });
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
  results.push({ label: 'B3 real-database gate (prerequisites)', ok: reachable });

  if (reachable) {
    const againstTestDatabase = { MONGODB_URI: TEST_URI };
    run('Index apply (test database)', 'node', ['scripts/db-indexes.mjs', 'apply'], againstTestDatabase);
    run('B2 + B3 real-database suite', 'npx', ['vitest', 'run', '--config', 'vitest.db.config.js']);
    run('Index check (test database)', 'node', ['scripts/db-indexes.mjs', 'check'], againstTestDatabase);
  }
}

// ----------------------------------------------------------------- report --
console.log('\n=== B3 verification summary ===');
for (const { label, ok } of results) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
}

const failed = results.filter((entry) => !entry.ok).length;
console.log(failed === 0 ? '\nB3 VERIFICATION PASSED' : `\nB3 VERIFICATION FAILED — ${failed} gate(s)`);
process.exit(failed === 0 ? 0 : 1);
