#!/usr/bin/env node
/**
 * B4 verification gate — Private Resume Storage & Validation.
 *
 *   npm run verify:b4
 *
 * Windows-safe: plain Node, no shell syntax; child commands go through
 * `shell: true` only on win32 (npx is a .cmd there).
 *
 * Before anything else, if MONGODB_TEST_URI is set it is checked with the
 * approved fail-closed test-database guard (scripts/test-database.mjs) against
 * the environment this command was launched with. A refused target stops the
 * command immediately with exit code 1 — nothing is run, nothing is touched.
 *
 * Then it runs, in order, and reports PASS/FAIL for each gate:
 *   0. a Node.js 24 runtime check (package.json engines), with the OS reported;
 *   1. the complete offline suite — B1, B2, B3 and B4;
 *   2. the B4 acceptance gate on its own, so it is reported by name: the
 *      Doc 17 file matrix through real HTTP into REAL local private storage
 *      (valid PDF/DOCX from real authoring tools, wrong/mismatched
 *      extension and MIME, malformed files, renamed executables and images,
 *      arbitrary ZIPs, legacy and macro-enabled Word, empty/oversized/multiple
 *      files, dangerous/long/Unicode filenames), bounded archive inspection
 *      and zip bombs, aborted and over-limit uploads over raw sockets,
 *      storage failures and cleanup, persisted bytes and SHA-256, distinct
 *      keys, persistence across a new adapter AND a new process, storage
 *      privacy and key non-disclosure, configuration and startup/readiness/
 *      shutdown integration — and the review r1 regressions: structural,
 *      namespace-aware DOCX package XML; storage confinement through links
 *      and junctions; prompt 503 on temporary-storage failures; PDF
 *      cross-reference / trailer / catalog structure; and (r3) the staged
 *      connection close that lets an early 413/503 reach the client;
 *   3. the real-database prerequisites (MONGODB_TEST_URI set, accepted by the
 *      guard, and reachable);
 *   4. `db:indexes:apply` against that test database;
 *   5. the complete REAL-DATABASE suite — B2, B3 and B4 (B4: stored resume
 *      metadata persisted by MongoDB matches the stored bytes after a
 *      reconnect, the unique storage-key index, the compensation shape, and
 *      the backend lifecycle with storage over real MongoDB);
 *   6. `db:indexes:check` against that test database.
 *
 * ISOLATION. Storage tests create their own roots under the OS temporary
 * directory (prefix `valida-b4-test-`) and delete only those. Every child
 * runs with RESUME_STORAGE_DRIVER / RESUME_STORAGE_LOCAL_ROOT CLEARED, so a
 * developer's configured storage is never initialised, written or cleaned by
 * a test. The database gate uses MONGODB_TEST_URI only (never valida_dev).
 *
 * THE DATABASE GATE CANNOT BE SKIPPED. If MONGODB_TEST_URI is absent or the
 * database is unreachable, this command FAILS with a non-zero exit code and
 * says so. It never reports PASS with the database checks skipped.
 */
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import mongoose from 'mongoose';
import { checkTestDatabaseTarget } from './test-database.mjs';

const TEST_URI = process.env.MONGODB_TEST_URI;

// ------------------------------------------------------------ fail closed --
const target = checkTestDatabaseTarget({ env: process.env });
if (TEST_URI && !target.ok) {
  console.error(`\nB4 VERIFICATION REFUSED — ${target.reason}`);
  console.error('Nothing was run and no database was contacted.');
  process.exit(1);
}

if (process.env.VALIDA_VERIFY_B4_ACTIVE === '1') {
  console.error('B4 VERIFICATION REFUSED — verify:b4 is already running in a parent process.');
  process.exit(1);
}
process.env.VALIDA_VERIFY_B4_ACTIVE = '1';

// A developer's own storage configuration is never handed to a test.
const storageWasConfigured = Boolean(process.env.RESUME_STORAGE_DRIVER || process.env.RESUME_STORAGE_LOCAL_ROOT);
const isolated = { RESUME_STORAGE_DRIVER: '', RESUME_STORAGE_LOCAL_ROOT: '' };

const results = [];

function run(label, command, args, env = {}) {
  process.stdout.write(`\n=== ${label} ===\n`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...isolated, ...env },
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
if (storageWasConfigured) {
  process.stdout.write('note: RESUME_STORAGE_* is set in this shell; it is cleared for every test run.\n');
}
if (nodeMajor !== 24) {
  console.error('FAIL: the backend requires Node.js 24 (engines >=24.0.0 <25.0.0).');
}
results.push({ label: `Node.js 24 runtime (found ${process.version})`, ok: nodeMajor === 24 });

// ---------------------------------------------------------------- offline --
run('B1 + B2 + B3 + B4 offline suite', 'npx', ['vitest', 'run']);

const B4_ACCEPTANCE = [
  'tests/resume-intake-http.test.js',
  'tests/upload-abort-limits.test.js',
  'tests/resume-inspection.test.js',
  'tests/resume-filename.test.js',
  'tests/private-storage.test.js',
  'tests/temp-upload-area.test.js',
  'tests/storage-config.test.js',
  'tests/b4-startup.test.js',
  'tests/resume-metadata.test.js',
  // Review r1 regressions (findings 1-4).
  'tests/docx-xml-structure.test.js',
  'tests/storage-link-confinement.test.js',
  'tests/upload-temp-failure.test.js',
  'tests/pdf-xref-structure.test.js',
  // r3: staged connection close after an early 413/503 (RFC 9112 section 9.6).
  'tests/staged-close.test.js',
];
run('B4 acceptance gate (file matrix, archive bounds, private storage, review r1 regressions)', 'npx', ['vitest', 'run', ...B4_ACCEPTANCE]);

// --------------------------------------------------------------- database --
process.stdout.write('\n=== B4 real-database gate ===\n');

if (!TEST_URI) {
  console.error('FAIL: MONGODB_TEST_URI is not set.');
  console.error('');
  console.error('  The database gate is mandatory. That B4 resume metadata is accepted and kept by');
  console.error('  MongoDB with its real unique indexes, and that the backend starts, reports and');
  console.error('  shuts down with storage over a real database, cannot be proven with a stand-in.');
  console.error('');
  console.error('  Windows PowerShell, using a local server:');
  console.error('    $env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test"');
  console.error('    npm run verify:b4');
  results.push({ label: 'B4 real-database gate', ok: false });
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
  results.push({ label: 'B4 real-database gate (prerequisites)', ok: reachable });

  if (reachable) {
    const againstTestDatabase = { MONGODB_URI: TEST_URI };
    run('Index apply (test database)', 'node', ['scripts/db-indexes.mjs', 'apply'], againstTestDatabase);
    run('B2 + B3 + B4 real-database suite', 'npx', ['vitest', 'run', '--config', 'vitest.db.config.js']);
    run('Index check (test database)', 'node', ['scripts/db-indexes.mjs', 'check'], againstTestDatabase);
  }
}

// ----------------------------------------------------------------- report --
console.log('\n=== B4 verification summary ===');
for (const { label, ok } of results) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
}

const failed = results.filter((entry) => !entry.ok).length;
console.log(failed === 0 ? '\nB4 VERIFICATION PASSED' : `\nB4 VERIFICATION FAILED — ${failed} gate(s)`);
process.exit(failed === 0 ? 0 : 1);
