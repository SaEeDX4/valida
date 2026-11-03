#!/usr/bin/env node
/**
 * B6 verification gate — Notification Integration.
 *
 *   npm run verify:b6
 *
 * Windows-safe: plain Node, no shell syntax; child commands go through
 * `shell: true` only on win32 (npx is a .cmd there).
 *
 * Before anything else, if MONGODB_TEST_URI is set it is checked with the
 * approved fail-closed test-database guard (scripts/test-database.mjs) against
 * the environment this command was launched with. A refused target stops the
 * command immediately with exit code 1 — nothing is run, nothing is touched.
 *
 * Then it runs, in order, and reports PASS / FAIL / PENDING for each gate:
 *   0. a Node.js 24 runtime check (package.json engines), with the OS reported;
 *   1. the complete offline suite — B1 to B6;
 *   2. the B6 acceptance gate on its own (offline, injected faults and TEST-
 *      DOUBLE transports): configuration rules, templates (escaping, header
 *      injection, text + HTML, no links/tracking, no candidate data in the
 *      internal email), the Notification Service (success, rejection,
 *      timeout, invalid recipient, suppression, allowlist, template error,
 *      classification), the claim / send / record cycle (partial failure,
 *      concurrent attempts, lost claims, unrecorded outcomes), the retry
 *      policy and run, both events through the real Apply route, replay,
 *      log privacy, readiness, the retry command's refusals, (r3) claim
 *      ownership through the real repository and Mongoose save path — only
 *      the claimant that acquired an attempt can record it — and (r4) the
 *      SMTP adapter: the bound that stops a provider call instead of
 *      abandoning it, and the REAL adapter (nodemailer over real TCP/TLS)
 *      against a LOCAL SMTP TEST SERVER — verified TLS with no fallback,
 *      authentication and its latch, every refusal by phase, OUTCOME_UNKNOWN
 *      after the body, aborts, the Apply workflow, replay and startServer.
 *      The local server is test infrastructure, NOT provider evidence;
 *   3. the B5 acceptance gate and 4. the B4 acceptance gate, carried forward
 *      as regression gates;
 *   5. the real-database prerequisites (MONGODB_TEST_URI set, accepted by the
 *      guard, reachable) and 6. the database ENGINE: it must be MongoDB — a
 *      MongoDB-compatible stand-in (e.g. FerretDB) is reported and FAILS this
 *      gate, because it is not MongoDB evidence;
 *   7. `db:indexes:apply` against that test database;
 *   8. the complete REAL-DATABASE suite — B2 to B6;
 *   9. the B6 real-database gate on its own: both events persisted, partial
 *      failure, replay, the engine's conditional-update atomicity, the claim
 *      race between independently loaded copies, concurrent retry cycles and
 *      runs, the conditional updates and the write-durability policy observed
 *      on the wire (also over an UNSAFE w=0 connection), the B2 protections,
 *      an unrecorded outcome left uncertain, the retry run and the retry
 *      command as a process. Its sanitised evidence is printed below it;
 *  10. `db:indexes:check` against that test database;
 *  11. REAL PROVIDER ACCEPTANCE / DELIVERY — PENDING. r4: the provider is
 *      selected (Bluehost Professional Email / Titan, over SMTP) and the
 *      adapter exists, but this command never sends email and never uses
 *      the owner's credentials. Live evidence (Titan authentication and relay
 *      acceptance, receipt, SPF/DKIM/DMARC, From / Reply-To, replay, bounce,
 *      Sent-folder retention) comes from the opt-in `npm run
 *      ops:notifications:smoke` plus the owner's manual checks, and is
 *      reviewed outside this command. This gate is therefore never reported
 *      as PASS by this build; neither a TEST-DOUBLE transport nor the local
 *      SMTP test server is provider evidence.
 *
 * EVIDENCE CLASSES are summarised separately at the end: offline / injected
 * faults; real MongoDB; real provider acceptance / delivery; Windows + Node 24.
 *
 * ISOLATION. As verify:b5: every child runs with RESUME_STORAGE_DRIVER /
 * RESUME_STORAGE_LOCAL_ROOT CLEARED, and the transactional-email variables
 * (r4: including every SMTP_* setting and the SMTP password) CLEARED too, so
 * a developer's own configuration is never used by a test.
 * The database gates use MONGODB_TEST_URI only (never valida_dev).
 *
 * THE DATABASE GATES CANNOT BE SKIPPED. If MONGODB_TEST_URI is absent, the
 * database unreachable or not MongoDB, this command FAILS (exit 1).
 *
 * Exit codes: 1 any gate failed or the run was refused;
 *             2 every available gate passed, but the real-provider gate is
 *               PENDING (live Titan evidence AWAITING INPUT) — B6 is not
 *               fully verified;
 *             0 every gate passed (not reachable in this build).
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
  console.error(`\nB6 VERIFICATION REFUSED — ${target.reason}`);
  console.error('Nothing was run and no database was contacted.');
  process.exit(1);
}

if (process.env.VALIDA_VERIFY_B6_ACTIVE === '1') {
  console.error('B6 VERIFICATION REFUSED — verify:b6 is already running in a parent process.');
  process.exit(1);
}
process.env.VALIDA_VERIFY_B6_ACTIVE = '1';

// A developer's own storage and email configuration is never handed to a test.
const ISOLATED_VARIABLES = [
  'RESUME_STORAGE_DRIVER',
  'RESUME_STORAGE_LOCAL_ROOT',
  'TRANSACTIONAL_EMAIL_PROVIDER',
  'TRANSACTIONAL_EMAIL_API_KEY',
  'TRANSACTIONAL_FROM_ADDRESS',
  'TRANSACTIONAL_FROM_NAME',
  'TRANSACTIONAL_REPLY_TO',
  'RECRUITMENT_NOTIFICATION_RECIPIENT',
  'APPLICATION_ACKNOWLEDGEMENT_ENABLED',
  'EMAIL_RECIPIENT_ALLOWLIST',
  // r4 — SMTP submission settings, the password included.
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURITY',
  'SMTP_USERNAME',
  'SMTP_PASSWORD',
];
const configuredLocally = ISOLATED_VARIABLES.filter((name) => process.env[name]);
const isolated = Object.fromEntries(ISOLATED_VARIABLES.map((name) => [name, '']));

const results = [];

function record(label, status, evidenceClass) {
  results.push({ label, status, evidenceClass });
  return status === 'PASS';
}

function run(label, command, args, evidenceClass, env = {}) {
  process.stdout.write(`\n=== ${label} ===\n`);
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...isolated, ...env },
  });
  return record(`${label} (exit ${result.status ?? 'signal'})`, result.status === 0 ? 'PASS' : 'FAIL', evidenceClass);
}

// ---------------------------------------------------------------- runtime --
const nodeMajor = Number(process.versions.node.split('.')[0]);
const isWindows = process.platform === 'win32';
process.stdout.write(
  '\n=== Runtime ===\n' +
    `node ${process.version} (${process.platform}, ${process.arch})\n` +
    `os   ${os.type()} ${os.release()}\n`,
);
if (configuredLocally.length > 0) {
  process.stdout.write(`note: ${configuredLocally.length} storage/email variable(s) are set in this shell; they are cleared for every test run.\n`);
}
if (nodeMajor !== 24) console.error('FAIL: the backend requires Node.js 24 (engines >=24.0.0 <25.0.0).');
record(`Node.js 24 runtime (found ${process.version})`, nodeMajor === 24 ? 'PASS' : 'FAIL', 'runtime');

// ---------------------------------------------------------------- offline --
run('B1 + B2 + B3 + B4 + B5 + B6 offline suite', 'npx', ['vitest', 'run'], 'offline');

const B6_ACCEPTANCE = [
  'tests/b6-config.test.js',
  'tests/b6-notification-service.test.js',
  'tests/b6-notifier.test.js',
  'tests/b6-apply-notifications.test.js',
  'tests/b6-readiness.test.js',
  'tests/b6-retry-command.test.js',
  'tests/b6-claim-ownership.test.js',
  // r4 — the bound that stops a provider call; the SMTP adapter against a LOCAL SMTP TEST SERVER.
  'tests/b6-service-abort.test.js',
  'tests/b6-smtp-transport.test.js',
  'tests/b6-smtp-integration.test.js',
  // r4 review — the nodemailer behaviours the adapter relies on, pinned on the wire;
  // the opt-in live smoke script's refusals, plan, verify-only and hard message budget.
  'tests/b6-nodemailer-contract.test.js',
  'tests/b6-smoke-script.test.js',
  // r5 — the live smoke test's lifecycle by fault injection: truthful result, records and files
  // kept consistent, the bounce exercise classified, the server bound to loopback;
  // r6 — nothing is deleted until the run's ownership (record, database target, marker) is proven.
  'tests/b6-smoke-lifecycle.test.js',
  // Stage 2 (OD-2026-10-26-03) — the b6-2 Concept A templates: approved copy, HTML rules, escaping, the
  // grapheme subject rule, UTC, MIME structure and size, unchanged transport headers, UTF-8 round trips,
  // and the per-message privacy rule on raw and decoded output and the envelope (LOCAL SMTP TEST SERVER).
  'tests/b6-stage2-templates.test.js',
];
run(
  'B6 acceptance gate (offline: injected faults, TEST-DOUBLE transports, SMTP adapter vs a LOCAL SMTP TEST SERVER — not provider evidence)',
  'npx',
  ['vitest', 'run', ...B6_ACCEPTANCE],
  'offline',
);

const B5_ACCEPTANCE = [
  'tests/apply-http.test.js',
  'tests/apply-validation-http.test.js',
  'tests/apply-failures.test.js',
  'tests/apply-units.test.js',
  'tests/apply-connection.test.js',
];
run('B5 acceptance gate (regression)', 'npx', ['vitest', 'run', ...B5_ACCEPTANCE], 'offline');

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
run('B4 acceptance gate (regression)', 'npx', ['vitest', 'run', ...B4_ACCEPTANCE], 'offline');

// --------------------------------------------------------------- database --
process.stdout.write('\n=== B6 real-database gate ===\n');

let engine = 'not checked';
if (!TEST_URI) {
  console.error('FAIL: MONGODB_TEST_URI is not set.');
  console.error('');
  console.error('  The database gate is mandatory. That a notification claim is applied at most once');
  console.error('  under concurrency, and that the recorded state is what happened, cannot be proven');
  console.error('  with a stand-in.');
  console.error('');
  console.error('  Windows PowerShell, using a local server:');
  console.error('    $env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test"');
  console.error('    npm run verify:b6');
  record('B6 real-database gate', 'FAIL', 'database');
} else {
  let reachable = false;
  let isMongoDB = false;
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5000 });
    const admin = mongoose.connection.db.admin();
    await admin.command({ ping: 1 });
    reachable = true;
    console.log(`reachable: approved test database "${target.databaseName}"`);
    const buildInfo = await admin.command({ buildInfo: 1 });
    // A MongoDB-compatible stand-in may identify itself. Recognised: FerretDB
    // (buildInfo.ferretdbVersion, as measured with FerretDB 1.24, or a
    // `ferretdb` object). Other compatible services are NOT detected here —
    // run this gate against a MongoDB server.
    const standIn = buildInfo.ferretdbVersion ?? buildInfo.ferretdb?.version ?? (buildInfo.ferretdb ? 'unknown version' : null);
    isMongoDB = standIn === null && typeof buildInfo.version === 'string';
    engine = standIn !== null ? `FerretDB ${String(standIn).slice(0, 40)} (NOT MongoDB)` : `MongoDB ${String(buildInfo.version).slice(0, 40)}`;
    console.log(`engine: ${engine}`);
    await mongoose.disconnect();
  } catch {
    // The driver message may contain the host and credentials; it is not printed.
    if (!reachable) {
      console.error('FAIL: MONGODB_TEST_URI is set but the database could not be reached.');
      console.error('  Start MongoDB and re-run. The gate does not pass without it.');
    } else {
      console.error('FAIL: the database engine could not be identified.');
    }
    try {
      await mongoose.disconnect();
    } catch {
      // Already closed.
    }
  }
  record('B6 real-database gate (prerequisites)', reachable ? 'PASS' : 'FAIL', 'database');
  if (reachable) {
    if (!isMongoDB) console.error('FAIL: the test database is not MongoDB. A compatible stand-in is not MongoDB evidence.');
    record(`Database engine is MongoDB (${engine})`, isMongoDB ? 'PASS' : 'FAIL', 'database');

    const againstTestDatabase = { MONGODB_URI: TEST_URI };
    run('Index apply (test database)', 'node', ['scripts/db-indexes.mjs', 'apply'], 'database', againstTestDatabase);
    run('B2 + B3 + B4 + B5 + B6 real-database suite', 'npx', ['vitest', 'run', '--config', 'vitest.db.config.js'], 'database');

    const evidenceFile = path.join(os.tmpdir(), `valida-b6-evidence-${randomBytes(8).toString('hex')}.jsonl`);
    const b6GatePassed = run(
      'B6 real-database gate (both events, claim race, concurrent retries, wire policy, B2 protections, retry run and command)',
      'npx',
      ['vitest', 'run', '--config', 'vitest.db.config.js', 'tests/db/b6-notifications.test.js'],
      'database',
      { VALIDA_B6_EVIDENCE_FILE: evidenceFile },
    );
    try {
      const evidence = fs.readFileSync(evidenceFile, 'utf8').trim();
      if (evidence) {
        process.stdout.write('\n=== B6 evidence (sanitised; synthetic data only; TEST-DOUBLE transport) ===\n');
        for (const line of evidence.split('\n')) process.stdout.write(`${JSON.stringify(JSON.parse(line), null, 2)}\n`);
      } else if (b6GatePassed) {
        console.error('FAIL: the B6 real-database gate passed but wrote no evidence.');
        record('B6 evidence written', 'FAIL', 'database');
      }
    } catch (error) {
      if (error?.code === 'ENOENT' && !b6GatePassed) {
        // No evidence was written (the gate above failed early); its FAIL is already recorded.
      } else if (error?.code === 'ENOENT') {
        console.error('FAIL: the B6 real-database gate passed but wrote no evidence.');
        record('B6 evidence written', 'FAIL', 'database');
      } else {
        console.error('FAIL: the B6 evidence file could not be read or parsed.');
        record('B6 evidence readable', 'FAIL', 'database');
      }
    } finally {
      fs.rmSync(evidenceFile, { force: true });
    }
    run(
      'B6 live-procedure rehearsal and ownership-verified cleanup (the owner\'s smoke procedure end to end on the test database; LOCAL SMTP TEST SERVER — no real email, not Titan)',
      'npx',
      ['vitest', 'run', '--config', 'vitest.db.config.js', 'tests/db/b6-smoke-rehearsal.test.js', 'tests/db/b6-smoke-cleanup.test.js'],
      'database',
    );
    run('Index check (test database)', 'node', ['scripts/db-indexes.mjs', 'check'], 'database', againstTestDatabase);
  }
}

// --------------------------------------------------------------- provider --
process.stdout.write('\n=== Real provider acceptance / delivery ===\n');
console.log('PENDING: live evidence from the selected provider (Bluehost Professional Email / Titan, over SMTP).');
console.log('  This command never sends email and never uses the owner\'s credentials: no real email was sent or delivered.');
console.log('  The TEST-DOUBLE transports and the LOCAL SMTP TEST SERVER above prove behaviour up to the provider only.');
console.log('  Live evidence: the opt-in `npm run ops:notifications:smoke` and the owner\'s manual checks (backend/README.md,');
console.log('  "B6 live Titan test"), reviewed outside this command.');
record('Real provider acceptance / delivery (AWAITING INPUT)', 'PENDING', 'provider');

// ----------------------------------------------------------------- report --
console.log('\n=== B6 verification summary ===');
for (const { label, status } of results) console.log(`  ${status.padEnd(7)} ${label}`);

const classStatus = (evidenceClass) => {
  const entries = results.filter((entry) => entry.evidenceClass === evidenceClass);
  if (entries.some((entry) => entry.status === 'FAIL')) return 'FAIL';
  if (entries.some((entry) => entry.status === 'PENDING')) return 'PENDING';
  return 'PASS';
};
console.log('\n=== Evidence classes ===');
console.log(`  Offline tests and injected faults:   ${classStatus('offline')}`);
console.log(`  Real MongoDB:                        ${classStatus('database')} (${engine})`);
console.log(`  Real provider acceptance / delivery: ${classStatus('provider')} (live Titan test: owner-run, opt-in — AWAITING INPUT)`);
console.log(
  `  Windows + Node 24:                   ${isWindows && nodeMajor === 24 ? 'YES' : 'NO'} (this run: ${process.platform}, node ${process.version})`,
);

const failed = results.filter((entry) => entry.status === 'FAIL').length;
const pending = results.filter((entry) => entry.status === 'PENDING').length;
if (failed > 0) {
  console.log(`\nB6 VERIFICATION FAILED — ${failed} gate(s) failed${pending ? `, ${pending} pending` : ''}`);
  process.exit(1);
}
if (pending > 0) {
  console.log(`\nB6 VERIFICATION INCOMPLETE — every available gate passed; ${pending} gate(s) PENDING (real provider: live Titan evidence AWAITING INPUT)`);
  process.exit(2);
}
console.log('\nB6 VERIFICATION PASSED');
process.exit(0);
