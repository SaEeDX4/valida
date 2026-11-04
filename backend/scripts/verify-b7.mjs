#!/usr/bin/env node
/**
 * B7 verification gate — Backend Security, Failure & QA Gate, and the
 * Release B completion evidence (Doc 18 sections 139-143).
 *
 *   npm run verify:b7
 *
 * Windows-safe: plain Node; child commands use `shell: true` only on win32.
 * Before anything else, if MONGODB_TEST_URI is set it is checked with the
 * fail-closed test-database guard (scripts/test-database.mjs); a refused
 * target stops the command with exit code 1 — nothing is run.
 *
 * Gates, in order (PASS / FAIL / PENDING / DIAGNOSTIC):
 *   1. verify:b6 — the complete offline suite (B1-B7), the B6, B5 and B4
 *      acceptance gates, and, with MONGODB_TEST_URI, the real-database suite
 *      (B2-B7, including tests/db/b7-storage-reconcile.test.js) and the index
 *      check. Its live-provider gate is PENDING by design: B6 was accepted on
 *      the owner's live evidence (OD-2026-11-04-01), so exit code 2 with only
 *      that gate pending counts as PASS here; its exit code 1 is a FAIL;
 *   2. the B7 acceptance gate on its own (offline): the bounded early-answer
 *      discard and the explicit server timeouts, public resume denial, log
 *      redaction, orphan reconciliation and storage listing, the controlled
 *      NoSQL-operator payloads, the production acknowledgement refusal (G-SUP)
 *      and the connection-level Apply measurements;
 *   3. the coverage diagnostic (Doc 17 sections 53-56) — reported, never a
 *      threshold; FAIL only if the run itself fails;
 *   4. the dependency check: `npm audit --omit=dev`.
 *
 * Exit code: 0 every gate passed; 1 a gate failed or the database gate could
 * not run.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkTestDatabaseTarget } from './test-database.mjs';

const target = checkTestDatabaseTarget({ env: process.env });
if (process.env.MONGODB_TEST_URI && !target.ok) {
  console.error(`\nB7 VERIFICATION REFUSED — ${target.reason}`);
  console.error('Nothing was run and no database was contacted.');
  process.exit(1);
}

const results = [];
const record = (label, status) => {
  results.push({ label, status });
  return status;
};
const spawn = (command, args, extra = {}) =>
  spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...extra } });

console.log(`\n=== Runtime ===\nnode ${process.version} (${process.platform}, ${process.arch})\nos   ${os.type()} ${os.release()}`);
const nodeMajor = Number(process.versions.node.split('.')[0]);
record(`Node.js 24 runtime (found ${process.version})`, nodeMajor === 24 ? 'PASS' : 'FAIL');

console.log('\n=== verify:b6 (offline suite B1-B7, B6/B5/B4 gates, real-database suite B2-B7) ===');
const b6 = spawn('node', ['scripts/verify-b6.mjs']);
record(
  `verify:b6 (exit ${b6.status ?? 'signal'}${b6.status === 2 ? ': every available gate passed; live-provider gate PENDING by design' : ''})`,
  b6.status === 0 || b6.status === 2 ? 'PASS' : 'FAIL',
);
if (!process.env.MONGODB_TEST_URI) {
  record('Real-database suite B2-B7 (MONGODB_TEST_URI not set — Release B gate needs it)', 'FAIL');
}

const B7_ACCEPTANCE = [
  'tests/b7-http-bounds.test.js',
  'tests/apply-connection.test.js',
  'tests/server.test.js',
  'tests/b7-public-resume-denial.test.js',
  'tests/b7-log-redaction.test.js',
  'tests/b7-orphan-reconciliation.test.js',
  'tests/b7-injection-negative.test.js',
  'tests/b7-acknowledgement-gate.test.js',
  'tests/staged-close.test.js',
  'tests/upload-temp-failure.test.js',
  'tests/private-storage.test.js',
  'tests/storage-link-confinement.test.js',
];
console.log('\n=== B7 acceptance gate (offline) ===');
const gate = spawn('npx', ['vitest', 'run', ...B7_ACCEPTANCE]);
record(`B7 acceptance gate (exit ${gate.status ?? 'signal'})`, gate.status === 0 ? 'PASS' : 'FAIL');

console.log('\n=== Coverage diagnostic (no threshold) ===');
const coverage = spawn('npx', ['vitest', 'run', '--coverage', '--reporter=dot']);
let summary = 'no summary';
try {
  const total = JSON.parse(fs.readFileSync(path.join('coverage', 'coverage-summary.json'), 'utf8')).total;
  summary = ['lines', 'statements', 'functions', 'branches'].map((name) => `${name} ${total[name].pct}%`).join(', ');
} catch {
  // Reported below as missing.
}
record(`Coverage diagnostic (exit ${coverage.status ?? 'signal'}; ${summary})`, coverage.status === 0 ? 'DIAGNOSTIC' : 'FAIL');

console.log('\n=== Dependency check: npm audit --omit=dev ===');
const audit = spawn('npm', ['audit', '--omit=dev']);
record(`npm audit --omit=dev (exit ${audit.status ?? 'signal'})`, audit.status === 0 ? 'PASS' : 'FAIL');

console.log('\n=== Summary ===');
for (const { label, status } of results) console.log(`  ${status.padEnd(10)} ${label}`);
const failed = results.filter((entry) => entry.status === 'FAIL').length;
if (failed > 0) {
  console.log(`\nB7 VERIFICATION FAILED — ${failed} gate(s) failed`);
  process.exit(1);
}
console.log('\nB7 VERIFICATION PASSED');
process.exit(0);
