#!/usr/bin/env node
/**
 * B5 verification gate — Application Submission Workflow.
 *
 *   npm run verify:b5
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
 *   1. the complete offline suite — B1 to B5;
 *   2. the B5 acceptance gate on its own (offline): POST
 *      /api/v1/jobs/:jobSlug/applications through the real app, B4 parser and
 *      validator and REAL local private storage — the exact response, the
 *      stored record and object, idempotent replay / conflict / races, field
 *      and screening validation, Job eligibility and the closing-time race,
 *      storage and database failures with compensation, ambiguous persistence,
 *      the notification boundary, the Apply rate limit, log privacy, and the
 *      connection-level behaviour (staged close, the pipelining guard and its
 *      documented limit);
 *   3. the B4 acceptance gate, carried forward as a regression gate;
 *   4. the real-database prerequisites (MONGODB_TEST_URI set, accepted by the
 *      guard, and reachable);
 *   5. `db:indexes:apply` against that test database;
 *   6. the complete REAL-DATABASE suite — B2 to B5;
 *   7. the B5 real-database gate on its own, so it is reported by name: the
 *      full chain request -> response -> MongoDB record -> private object, the
 *      real unique-index race, a Job closed during Apply, the connection lost
 *      after storage (the repository's disconnected check), the real
 *      repository bound expiring during a real insert that then commits late
 *      (only the START of that save is delayed), an injected unknown outcome
 *      resolved by the real majority read-back, the notification state
 *      persisted, snapshot immutability, the write-durability policy on an
 *      UNSAFE (w=0) connection observed on the wire, expiry during the
 *      eligibility read, the production server composition with pipelining,
 *      and persistence across a backend PROCESS restart.
 *      (Which parts are injected is listed in backend/README.md, "B5
 *      verification".) Its sanitised evidence (synthetic data; no key, hash,
 *      storage key or path) is printed below the gate;
 *   8. `db:indexes:check` against that test database.
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
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mongoose from 'mongoose';
import { checkTestDatabaseTarget } from './test-database.mjs';

const TEST_URI = process.env.MONGODB_TEST_URI;

// ------------------------------------------------------------ fail closed --
const target = checkTestDatabaseTarget({ env: process.env });
if (TEST_URI && !target.ok) {
  console.error(`\nB5 VERIFICATION REFUSED — ${target.reason}`);
  console.error('Nothing was run and no database was contacted.');
  process.exit(1);
}

if (process.env.VALIDA_VERIFY_B5_ACTIVE === '1') {
  console.error('B5 VERIFICATION REFUSED — verify:b5 is already running in a parent process.');
  process.exit(1);
}
process.env.VALIDA_VERIFY_B5_ACTIVE = '1';

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
run('B1 + B2 + B3 + B4 + B5 offline suite', 'npx', ['vitest', 'run']);

const B5_ACCEPTANCE = [
  'tests/apply-http.test.js',
  'tests/apply-validation-http.test.js',
  'tests/apply-failures.test.js',
  'tests/apply-units.test.js',
  'tests/apply-connection.test.js',
];
run('B5 acceptance gate (Apply contract, idempotency, eligibility, failures, notification boundary, connection)', 'npx', ['vitest', 'run', ...B5_ACCEPTANCE]);

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
  'tests/docx-xml-structure.test.js',
  'tests/storage-link-confinement.test.js',
  'tests/upload-temp-failure.test.js',
  'tests/pdf-xref-structure.test.js',
  'tests/staged-close.test.js',
];
run('B4 acceptance gate (regression)', 'npx', ['vitest', 'run', ...B4_ACCEPTANCE]);

// --------------------------------------------------------------- database --
process.stdout.write('\n=== B5 real-database gate ===\n');

if (!TEST_URI) {
  console.error('FAIL: MONGODB_TEST_URI is not set.');
  console.error('');
  console.error('  The database gate is mandatory. That an Application is persisted by MongoDB with');
  console.error('  its real unique indexes, that concurrent duplicates and closing races resolve');
  console.error('  correctly, and that the record survives a backend restart cannot be proven with');
  console.error('  a stand-in.');
  console.error('');
  console.error('  Windows PowerShell, using a local server:');
  console.error('    $env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test"');
  console.error('    npm run verify:b5');
  results.push({ label: 'B5 real-database gate', ok: false });
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
  results.push({ label: 'B5 real-database gate (prerequisites)', ok: reachable });

  if (reachable) {
    const againstTestDatabase = { MONGODB_URI: TEST_URI };
    run('Index apply (test database)', 'node', ['scripts/db-indexes.mjs', 'apply'], againstTestDatabase);
    run('B2 + B3 + B4 + B5 real-database suite', 'npx', ['vitest', 'run', '--config', 'vitest.db.config.js']);

    const evidenceFile = path.join(os.tmpdir(), `valida-b5-evidence-${randomBytes(8).toString('hex')}.jsonl`);
    run(
      'B5 real-database gate (full chain, races, failures, write durability, server composition, restart)',
      'npx',
      ['vitest', 'run', '--config', 'vitest.db.config.js', 'tests/db/b5-apply.test.js', 'tests/db/b5-apply-server.test.js'],
      { VALIDA_B5_EVIDENCE_FILE: evidenceFile },
    );
    try {
      const evidence = fs.readFileSync(evidenceFile, 'utf8').trim();
      if (evidence) {
        process.stdout.write('\n=== B5 evidence (sanitised; synthetic data only) ===\n');
        for (const line of evidence.split('\n')) process.stdout.write(`${JSON.stringify(JSON.parse(line), null, 2)}\n`);
      }
    } catch {
      // No evidence was written (the gate above failed early); its FAIL is already recorded.
    } finally {
      fs.rmSync(evidenceFile, { force: true });
    }
    run('Index check (test database)', 'node', ['scripts/db-indexes.mjs', 'check'], againstTestDatabase);
  }
}

// ----------------------------------------------------------------- report --
console.log('\n=== B5 verification summary ===');
for (const { label, ok } of results) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
}

const failed = results.filter((entry) => !entry.ok).length;
console.log(failed === 0 ? '\nB5 VERIFICATION PASSED' : `\nB5 VERIFICATION FAILED — ${failed} gate(s)`);
process.exit(failed === 0 ? 0 : 1);
