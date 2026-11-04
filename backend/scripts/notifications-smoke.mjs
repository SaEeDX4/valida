#!/usr/bin/env node
/**
 * B6 LIVE SMOKE TEST — opt-in, owner-run. SENDS REAL EMAIL through the
 * configured SMTP relay (Bluehost Professional Email / Titan) when, and only
 * when, --confirm-live-email is given.
 *
 *   npm run ops:notifications:smoke -- --verify-only
 *       connect + TLS + login against the relay; NOTHING is sent, no database used
 *   npm run ops:notifications:smoke -- --candidate-recipient <your test inbox>
 *       prints the plan; nothing is sent (exit 2)
 *   npm run ops:notifications:smoke -- --candidate-recipient <your test inbox> --confirm-live-email
 *       [--bounce-recipient <address on a domain that cannot receive mail>] [--keep-records] [--evidence <file>]
 *   npm run ops:notifications:smoke -- --cleanup-run <run id>
 *       removes ONE earlier run's synthetic records and then its resume files
 *       (after --keep-records, or after a cleanup that failed) — only once the
 *       run's OWNERSHIP is proven on this database (r6, below); sends nothing
 *
 * WHAT A LIVE RUN DOES — the real backend, end to end, on SYNTHETIC data:
 *   1. verifies the relay (connect, TLS, login);
 *   2. starts the real server against the DEDICATED TEST DATABASE
 *      (MONGODB_TEST_URI, accepted by the same fail-closed guard as the test
 *      suites: valida_test or valida_test_*, never the application database)
 *      with private resume storage in a fresh temporary directory and
 *      candidate acknowledgement ON, listening on LOOPBACK ONLY (127.0.0.1 —
 *      checked from the server's actual address);
 *   3. creates ONE synthetic, clearly labelled QA job in that test database
 *      (the real vacancy is not touched and stays DRAFT);
 *   4. checks /api/v1/health/ready;
 *   5. submits ONE synthetic Application (QA name, a synthetic QA resume, the
 *      candidate address you name) through the real Apply API: one internal
 *      notification (to RECRUITMENT_NOTIFICATION_RECIPIENT) and one
 *      acknowledgement (to your test inbox, Reply-To TRANSACTIONAL_REPLY_TO);
 *   6. REPLAYS it with the same Idempotency-Key: nothing more may be sent;
 *   7. optionally submits a second Application whose candidate address cannot
 *      receive mail (bounce test), and reports what is ESTABLISHED about it:
 *      accepted by the relay (a bounce should follow — a manual check),
 *      refused by the relay (5xx), deferred (4xx), a configuration failure,
 *      not submitted, or UNKNOWN (a bounce MAY arrive; the exercise is
 *      inconclusive) — see scripts/smoke-lifecycle.mjs;
 *   8. runs the retry policy as a DRY RUN only (never --send: no bulk retry);
 *   9. shuts down, then removes ONLY this run's synthetic records and
 *      CONFIRMS the database holds none of them; only then removes the run's
 *      resume files. With --keep-records, or when the record cleanup failed,
 *      was refused or is unconfirmed, records AND files are kept together, and
 *      --cleanup-run <run id> removes them later;
 *  10. writes a sanitised evidence file. The result is PASS only if every
 *      required check AND every required lifecycle step (shutdown, cleanup)
 *      was confirmed. PASS is the AUTOMATED part only: it is not mailbox
 *      delivery, bounce or B6 acceptance — an INCONCLUSIVE bounce exercise
 *      stays inconclusive whatever the result line says.
 * Then YOU check the mailboxes (the printed checklist): receipt, From /
 * Reply-To, SPF/DKIM/DMARC in the received headers, the reply path, the bounce
 * and whether the sending mailbox kept a Sent copy.
 *
 * OWNERSHIP (r6). Before the run touches the database it writes an ownership
 * record — <temporary folder>/valida-smoke-run-<run id>.json, credential-free:
 * the run id, the test database's NAME and SERVERS (host:port as parsed from
 * MONGODB_TEST_URI; never the user name or password), a random nonce, the Job
 * id chosen in advance, the Application ids as they are captured, and the
 * name of the run's resume-file directory. In the test database it inserts a
 * marker { _id: <run id>, nonce, jobId, storageDirectory } in the collection
 * valida_smoke_runs before it creates anything. Cleanup (end of run, or
 * --cleanup-run) deletes nothing unless the record is intact AND names the
 * same database name and servers it is now pointed at AND that database holds
 * the marker with the same nonce, Job id and storage directory. The run's
 * Applications are then found by the RECORDED Job id — so they are found when
 * the Job itself is gone, and when the run never captured their ids. A
 * missing, corrupt, inconsistent or unproven ownership is REFUSED: nothing is
 * deleted and every file is kept. After the records and files are confirmed
 * gone the record is marked RELEASING (r7), then the marker is released, then
 * the record is marked CLEANED and kept, so a repeat is a harmless ALREADY
 * CLEANED; if the release or the receipt is interrupted, --cleanup-run
 * finishes it from the RELEASING record. Runs made before r6 have no record
 * and are refused, never guessed (backend/README.md: runs without an
 * ownership record).
 *
 * SAFETY. Refused in production (APP_ENV / NODE_ENV). Refused unless
 * TRANSACTIONAL_EMAIL_PROVIDER=smtp. Every recipient must pass
 * EMAIL_RECIPIENT_ALLOWLIST (required outside production). The password is
 * read from the environment / backend/.env only and is never printed. The
 * evidence file holds no secret and no full address (masked).
 *
 * Exit codes: 0 every automated check and lifecycle step passed (the manual
 *             checks remain); 1 refused, or a check or lifecycle step failed
 *             or could not be confirmed; 2 plan only / usage.
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import mongoose from 'mongoose';
import { loadConfig, ConfigurationError, PLAIN_EMAIL_ADDRESS } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';
import { startServer } from '../src/server.js';
import { Job } from '../src/models/Job.js';
import { publishJob } from '../src/modules/jobs/job.service.js';
import { Application } from '../src/models/Application.js';
import { REQUIRED_INDEXES } from '../src/db/indexes.js';
import { RecipientSuppressionKey } from '../src/models/RecipientSuppression.js';
import { keyCheckValue } from '../src/modules/suppression/suppressionKeys.js';
import { createNotificationService, notificationServiceOptions, isAllowedRecipient } from '../src/integrations/notifications/notificationService.js';
import { createNotificationTransport } from '../src/integrations/notifications/transport.js';
import { messageReference } from '../src/integrations/notifications/smtpTransport.js';
import { createApplicationRepository } from '../src/modules/applications/application.repository.js';
import { runNotificationRetry, staleAfterMs } from '../src/modules/applications/application.notifications.js';
import { checkTestDatabaseTarget } from './test-database.mjs';
import { createLedgerTransport, smokeMessageBudget } from './smoke-ledger.mjs';
import {
  SMOKE_RUN_ID,
  SMOKE_CANDIDATE_NAME,
  SMOKE_JOB_TITLE_PREFIX,
  smokeJobSlug,
  smokeStoragePrefix,
  OWNERSHIP_COLLECTION,
  smokeDatabaseTarget,
  targetFingerprint,
  createOwnershipRecord,
  writeOwnershipRecord,
  ownershipRecordName,
  cleanedRecord,
  releasingRecord,
  cleanupSmokeRun,
  releaseSmokeOwnership,
  reconcileSmokeRun,
  finaliseSmokeRun,
  removeDirectoryConfirmed,
  classifyBounceExercise,
} from './smoke-lifecycle.mjs';
// A synthetic PDF that passes the B4 resume checks: "QA TEST DOCUMENT - NOT A REAL CANDIDATE".
import { syntheticPdf } from '../tests/fixtures/resumeFiles.js';

const USAGE = `Usage:
  npm run ops:notifications:smoke -- --verify-only
  npm run ops:notifications:smoke -- --candidate-recipient <address> [--bounce-recipient <address>] --confirm-live-email [--keep-records] [--evidence <file>]
  npm run ops:notifications:smoke -- --cleanup-run <run id>`;

function parseArgs(argv) {
  const options = { verifyOnly: false, confirm: false, candidate: null, bounce: null, keep: false, evidence: null, cleanupRun: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      index += 1;
      return argv[index];
    };
    if (argument === '--verify-only') options.verifyOnly = true;
    else if (argument === '--confirm-live-email') options.confirm = true;
    else if (argument === '--candidate-recipient') options.candidate = value();
    else if (argument === '--bounce-recipient') options.bounce = value();
    else if (argument === '--keep-records') options.keep = true;
    else if (argument === '--evidence') options.evidence = value();
    else if (argument === '--cleanup-run') options.cleanupRun = value();
    else if (argument === '--help' || argument === '-h') return { help: true };
    else return { error: 'Unknown argument.' };
  }
  for (const name of ['candidate', 'bounce']) {
    if (options[name] !== null && !(typeof options[name] === 'string' && options[name].length <= 254 && PLAIN_EMAIL_ADDRESS.test(options[name]))) {
      return { error: `--${name}-recipient must be one plain email address.` };
    }
  }
  if (options.evidence === undefined) return { error: '--evidence needs a file path.' };
  if (options.cleanupRun !== null) {
    if (!(typeof options.cleanupRun === 'string' && SMOKE_RUN_ID.test(options.cleanupRun))) return { error: '--cleanup-run needs the run id printed by the live run (8 hex characters).' };
    if (argv.length !== 2) return { error: '--cleanup-run is used alone.' };
  }
  return { options };
}

/** "someone@example.test" -> "s***@example.test": evidence never holds a full address. */
export function maskAddress(address) {
  const text = String(address);
  const at = text.lastIndexOf('@');
  return at <= 0 ? '***' : `${text[0]}***${text.slice(at)}`;
}

const say = (line = '') => process.stdout.write(`${line}\n`);
const refuse = (lines) => {
  for (const line of lines) console.error(line);
  console.error('Nothing was sent.');
  process.exit(1);
};
const summarise = (error) => `${error?.name ?? 'Error'}${error?.code ? ` (${String(error.code).slice(0, 60)})` : ''}`;

/** The dedicated test database (the server's own connection is closed by its shutdown; an open one is reused). */
async function connectTestDatabase() {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(process.env.MONGODB_TEST_URI, { serverSelectionTimeoutMS: 5_000, autoIndex: false, autoCreate: false });
}

/** The run's ownership markers (test database only; raw collection — no application schema). */
const ownershipMarkers = {
  findOne: (filter) => mongoose.connection.collection(OWNERSHIP_COLLECTION).findOne(filter),
  insertOne: (document, options) => mongoose.connection.collection(OWNERSHIP_COLLECTION).insertOne(document, options),
  deleteOne: (filter) => mongoose.connection.collection(OWNERSHIP_COLLECTION).deleteOne(filter),
};

/**
 * --cleanup-run <run id>: reconciles ONE earlier run (scripts/smoke-lifecycle.mjs,
 * reconcileSmokeRun). r6: nothing is deleted unless the run's OWNERSHIP is
 * proven — its ownership record in the OS temporary directory, the same
 * database target (name and servers), and the run's ownership marker in that
 * database (same nonce, Job id and storage directory). Then its records
 * (found by the recorded Job id, even if the Job is gone), confirmed; then
 * exactly its recorded storage directory; then the marker; then the record is
 * marked CLEANED. It needs only MONGODB_TEST_URI — no relay settings — and
 * sends nothing.
 */
async function cleanupMode(runId) {
  say(`CLEANUP of live smoke run ${runId}: its records and files only, and only after its ownership is proven. Nothing is sent.`);
  const guard = checkTestDatabaseTarget({ env: process.env });
  if (!guard.ok) refuse([`REFUSED: ${guard.reason}`, '--cleanup-run needs MONGODB_TEST_URI naming the dedicated test database the run used.']);
  const result = await reconcileSmokeRun({
    runId,
    temporaryDirectory: os.tmpdir(),
    target: smokeDatabaseTarget(process.env.MONGODB_TEST_URI),
    Job,
    Application,
    markers: ownershipMarkers,
    connect: connectTestDatabase,
    disconnect: () => mongoose.disconnect(),
  });
  const { cleanup } = result;
  if (result.resumed) {
    say(`  resuming: the ownership record says RELEASING — this run's records and files were confirmed removed${result.recordsRemovedAt ? ` (recorded ${result.recordsRemovedAt})` : ''}; only the ownership marker and the receipt were left. Nothing but the marker is deleted.`);
    if (result.release) say(`  ownership marker: ${result.release.markerRelease}; re-count by the recorded Job id: ${result.release.remaining.applications} Application(s), ${result.release.remaining.jobs} job(s)`);
  }
  if (cleanup && !cleanup.refused) {
    const found = cleanup.discovered;
    say(`  ownership: VERIFIED (record ${ownershipRecordName(runId)}, database "${guard.databaseName}", marker present)`);
    say(`  found:     the run's Job ${found.job}; ${found.applications} synthetic Application(s) by the recorded Job id (${found.applicationsWithMissingParentJob} without their Job, ${found.applicationsNotCapturedByTheRun} not captured by the run)`);
    say(`  deleted:   ${cleanup.confirmed.applicationsDeleted} Application(s), ${cleanup.confirmed.jobsDeleted} job(s) (confirmed by the database)`);
    say(`  remaining: ${cleanup.remaining.applications} Application(s), ${cleanup.remaining.jobs} job(s) of the run`);
    if (found.notOwned.jobs > 0 || found.notOwned.applications > 0) {
      say(`  NOT TOUCHED: ${found.notOwned.jobs} job(s) and ${found.notOwned.applications} Application(s) linked to this run are not positively the run's — inspect them manually.`);
    }
  }
  if (result.untouched?.length > 0) {
    say(`  NOT TOUCHED: ${result.untouched.length} director(ies) named ${smokeStoragePrefix(runId)}* ${result.outcome === 'COMPLETE' || result.outcome === 'ALREADY_CLEANED' ? 'that the ownership record does not name' : 'in <OS temporary directory>'}.`);
  }
  switch (result.outcome) {
    case 'COMPLETE':
      if (result.resumed) {
        say('  ownership record marked CLEANED');
        say('CLEANUP COMPLETE (confirmed; an interrupted release was finished).');
        process.exit(0);
      }
      say(`  resume files removed: <OS temporary directory>/${result.files.directory}`);
      say('  ownership record marked RELEASING, ownership marker released, ownership record marked CLEANED');
      say('CLEANUP COMPLETE (confirmed).');
      process.exit(0);
      break;
    case 'ALREADY_CLEANED':
      say(`ALREADY CLEANED${result.cleanedAt ? ` (recorded ${result.cleanedAt})` : ''}: nothing to do.`);
      process.exit(0);
      break;
    case 'REFUSED':
      console.error(`REFUSED (${result.code}): ${result.reason}.`);
      console.error('Nothing was deleted; every file was kept.');
      if (result.code === 'OWNERSHIP_RECORD_MISSING') console.error('A run made before r6, or a record removed by hand: reconcile it manually (backend/README.md, "B6 live Titan test", runs without an ownership record).');
      if (result.code === 'TARGET_MISMATCH') console.error('Set MONGODB_TEST_URI to the database (and servers) the run used — the record names the database; credentials are never recorded.');
      process.exit(1);
      break;
    case 'FAILED':
      console.error(`FAILED: the test database could not be used (${summarise(result.error)}).`);
      console.error('Nothing more was attempted; every file was kept. Run this command again when the test database is reachable.');
      process.exit(1);
      break;
    default: {
      const incomplete = {
        RECORDS_REMAIN: result.resumed
          ? 'the ownership record says this run\'s records were removed, but records with its Job id exist in this database; nothing was changed — inspect them'
          : 'records of this run remain or could not be removed, so its resume files were KEPT; inspect what remains',
        FILES_NOT_REMOVED: 'the run\'s records are confirmed gone, but its resume-file directory could not be removed; the ownership is kept, so run this command again',
        RECORD_NOT_UPDATED: 'the run\'s records and files are confirmed gone, but the ownership record could not be updated, so the ownership marker was KEPT; make the temporary folder writable and run this command again',
        MARKER_NOT_RELEASED: 'the run\'s records and files are confirmed gone (the ownership record says RELEASING), but the ownership marker could not be released; run this command again',
        RECEIPT_NOT_WRITTEN: 'the run\'s records and files are confirmed gone and the ownership marker is released, but the CLEANED receipt could not be written (the ownership record says RELEASING); make the temporary folder writable and run this command again — it deletes nothing',
      };
      console.error(`INCOMPLETE (${result.code}): ${incomplete[result.code] ?? 'a later step could not be completed — run this command again'}.`);
      if (result.code !== 'RECORDS_REMAIN') console.error('If it keeps failing: backend/README.md, "B6 live Titan test", an incomplete cleanup that does not finish.');
      process.exit(1);
    }
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    say(USAGE);
    process.exit(2);
  }
  if (parsed.error) {
    console.error(parsed.error);
    console.error(USAGE);
    process.exit(2);
  }
  const { options } = parsed;

  say('B6 LIVE SMOKE TEST (opt-in). It sends REAL email only with --confirm-live-email.');
  if (process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production') {
    refuse(['REFUSED: never run against a production environment (APP_ENV / NODE_ENV is production).']);
  }
  if (options.cleanupRun) {
    await cleanupMode(options.cleanupRun);
    return;
  }
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigurationError) refuse([error.message]);
    throw error;
  }
  if (config.notifications.provider !== 'smtp') {
    refuse(['REFUSED: TRANSACTIONAL_EMAIL_PROVIDER is not "smtp". Configure the SMTP_* settings first (backend/README.md, "B6 live Titan test").']);
  }
  const smtp = config.notifications.smtp;
  say(`relay: ${smtp.host}:${smtp.port} (${smtp.security}); sender: ${maskAddress(smtp.username)}`);

  // 1. Verify: connect, TLS, login. Nothing is sent.
  const transport = createNotificationTransport({ config });
  const service = createNotificationService({ transport, timeoutMs: config.notificationTimeoutMs, ...notificationServiceOptions(config.notifications) });
  const verifyStarted = Date.now();
  const verified = await service.verify();
  await service.close();
  const verifyEvidence = { ok: verified.ok, reason: verified.reason ?? null, diagnostic: verified.diagnostic ?? null, ms: Date.now() - verifyStarted };
  say(`verify (connect + TLS + login, nothing sent): ${verified.ok ? 'OK' : `FAILED ${verified.reason}${verified.diagnostic ? ` ${JSON.stringify(verified.diagnostic)}` : ''}`}`);
  if (!verified.ok) {
    if (verified.reason === 'PROVIDER_AUTH_FAILED') {
      say('  The relay refused the login. Do NOT retry repeatedly: Titan blocks an IP after repeated failures.');
      say('  Check: SMTP_USERNAME is the full mailbox address; SMTP_PASSWORD is the app password (2FA is on);');
      say('  "Enable Titan on other apps" / third-party access is ON for that mailbox.');
    }
    refuse(['FAILED: the relay could not be verified.']);
  }
  if (options.verifyOnly) {
    say('VERIFY ONLY: the relay accepted the TLS connection and the login. No email was sent; no database was used.');
    say('This is authentication evidence only — not relay acceptance of a message, not delivery.');
    process.exit(0);
  }

  // 2. Plan unless confirmed.
  if (!options.candidate) {
    console.error('A live run needs --candidate-recipient <a test inbox you control>.');
    console.error(USAGE);
    process.exit(2);
  }
  const allowlist = config.notifications.recipientAllowlist;
  for (const [flag, address] of [['--candidate-recipient', options.candidate], ['--bounce-recipient', options.bounce]]) {
    if (address && !isAllowedRecipient(address, allowlist)) {
      refuse([`REFUSED: ${flag} is not covered by EMAIL_RECIPIENT_ALLOWLIST. Add exactly that address (or its @domain) for this test.`]);
    }
  }
  if (!config.notifications.replyTo) refuse(['REFUSED: TRANSACTIONAL_REPLY_TO must be set (the acknowledgement needs the careers Reply-To).']);
  const target = checkTestDatabaseTarget({ env: process.env });
  if (!target.ok) refuse([`REFUSED: ${target.reason}`, 'A live run needs MONGODB_TEST_URI naming a dedicated test database (valida_test or valida_test_*).']);
  // r6: the exact target (database name and servers, never credentials) that the run's ownership is bound to.
  const runTarget = smokeDatabaseTarget(process.env.MONGODB_TEST_URI);
  if (!runTarget) refuse(['REFUSED: MONGODB_TEST_URI could not be resolved to a database and its servers.']);

  say('');
  say('PLAN — a live run will send REAL email:');
  say(`  1 internal notification  -> ${maskAddress(config.notifications.internalRecipient)}`);
  say(`  1 acknowledgement        -> ${maskAddress(options.candidate)} (Reply-To ${maskAddress(config.notifications.replyTo)})`);
  if (options.bounce) say(`  bounce test: 1 internal + 1 acknowledgement -> ${maskAddress(options.bounce)}`);
  say(
    `  database: "${target.databaseName}" (test only); one synthetic QA job and Application(s), ${
      options.keep
        ? 'KEPT afterwards together with their resume files (--keep-records; remove them later with --cleanup-run <run id>)'
        : 'removed afterwards — the records first, then their resume files, each confirmed'
    }`,
  );
  say('  the test server listens on 127.0.0.1 only (loopback).');
  say('  then a replay (must send nothing) and a DRY-RUN retry assessment (never --send).');
  const budget = smokeMessageBudget({ bounce: Boolean(options.bounce) });
  say(`  HARD LIMIT: at most ${budget} messages are submitted; any further submission is refused before the relay.`);
  if (!options.confirm) {
    say('\nPLAN ONLY: add --confirm-live-email to run it. Nothing was sent.');
    process.exit(2);
  }

  // 3. The live run.
  const runId = randomBytes(4).toString('hex');
  /*
   * B7 — the acknowledgement passes the real suppression check (G-SUP; design
   * rev 8 §3.2). This throw-away run uses its OWN synthetic key: random bytes
   * made here, a fresh key id, its check value registered in the disposable
   * TEST database for the run and removed at its end. No real key is involved.
   */
  const suppressionKeyId = `smoke-${runId}`;
  const suppressionKey = randomBytes(32);
  let suppressionKeyRegistered = false;
  const evidence = {
    kind: 'valida-b6-live-smoke',
    runId,
    startedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${os.release()}`,
    relay: { host: smtp.host, port: smtp.port, security: smtp.security },
    database: target.databaseName,
    verify: verifyEvidence,
    checks: {},
    sends: [],
    notes: [
      'SENT / ACCEPTED_BY_RELAY means the relay accepted the message. It is not delivery.',
      'Message-IDs are Valida\'s own, derived per logical message; they are a correlation aid, not exactly-once.',
      'Addresses are masked. No password, token or message content is in this file.',
    ],
  };
  const checks = evidence.checks;
  // The run's private resume storage: one fresh directory named after the run, so --cleanup-run can find it.
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), smokeStoragePrefix(runId)));
  // r6 — OWNERSHIP, recorded before this run touches the database: the record
  // (a file next to the storage directory) and, below, the marker in the database.
  // The Job id is chosen now, so the run's Applications stay identifiable even
  // if the Job itself is later missing.
  const jobId = new mongoose.Types.ObjectId();
  const ownership = createOwnershipRecord({ runId, target: runTarget, storageDirectory: path.basename(storageRoot), jobId });
  let markerState = 'NOT_ATTEMPTED';
  evidence.ownership = { record: ownershipRecordName(runId), database: runTarget.name, target: targetFingerprint(runTarget), marker: markerState };
  const logLines = [];
  const logger = createLogger({
    level: 'info',
    appEnv: 'local',
    isProduction: false,
    destination: new Writable({
      write(chunk, _encoding, callback) {
        logLines.push(...chunk.toString('utf8').split('\n').filter(Boolean));
        callback();
      },
    }),
  });
  // Instrumentation only: every call goes to the REAL transport; the ledger
  // records what was submitted, and the hard budget refuses any submission
  // beyond the plan before it reaches the relay.
  evidence.messageBudget = budget;
  let refusedOverBudget = 0;
  const instrumented = (options_) =>
    createLedgerTransport({
      real: createNotificationTransport(options_),
      budget,
      ledger: evidence.sends,
      describe: (message, args) => ({
        event: message.event,
        applicationId: String(message.metadata?.applicationId ?? ''),
        to: maskAddress(message.to[0]),
        messageId: `<${messageReference(args.idempotencyKey)}.b6@${smtp.username.split('@')[1]}>`,
      }),
      onRefused: () => {
        refusedOverBudget += 1;
      },
    });

  let handle;
  const created = { jobId: null, applicationIds: [] };
  let failed = false;
  const check = (name, ok, detail = {}) => {
    checks[name] = { ok, ...detail };
    say(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : ''}`);
    if (!ok) failed = true;
  };

  try {
    writeOwnershipRecord(os.tmpdir(), ownership);
    const port = await new Promise((resolve) => {
      const probe = net.createServer().listen(0, '127.0.0.1', () => {
        const { port: free } = probe.address();
        probe.close(() => resolve(free));
      });
    });
    handle = await startServer({
      env: {
        ...process.env,
        APP_ENV: 'local',
        NODE_ENV: 'development',
        PORT: String(port),
        MONGODB_URI: process.env.MONGODB_TEST_URI,
        RESUME_STORAGE_DRIVER: 'local',
        RESUME_STORAGE_LOCAL_ROOT: storageRoot,
        APPLICATION_ACKNOWLEDGEMENT_ENABLED: 'true',
        SUPPRESSION_HMAC_KEY: suppressionKey.toString('base64'),
        SUPPRESSION_HMAC_KEY_ID: suppressionKeyId,
        SUPPRESSION_HMAC_PREVIOUS_KEYS: '',
      },
      logger,
      notificationTransportFactory: instrumented,
      // Loopback only: this throw-away server must not be reachable from the network.
      listenHost: '127.0.0.1',
    });
    const base = `http://127.0.0.1:${port}`;
    say(`\nLIVE RUN ${runId} (keep this run id: --cleanup-run ${runId} removes this run's records and files if they are kept)`);
    // What the server ACTUALLY listens on — not what the client URL says.
    const listening = handle.server.address();
    evidence.listen = { address: listening?.address ?? null, port: listening?.port === port ? 'as chosen' : 'unexpected' };
    const loopbackOnly = listening?.address === '127.0.0.1' && listening?.port === port;
    check('the test server listens on loopback only (127.0.0.1)', loopbackOnly, { address: listening?.address ?? null });
    // Never continue (create records, send email) on a server reachable from the network.
    if (!loopbackOnly) throw Object.assign(new Error('the test server is not bound to loopback only'), { code: 'NOT_LOOPBACK' });

    // The ownership marker, before any record of the run exists (acknowledged by a majority, journaled).
    markerState = 'ATTEMPTED';
    await ownershipMarkers.insertOne(
      { _id: runId, nonce: ownership.database.nonce, jobId: String(jobId), storageDirectory: ownership.storageDirectory, createdAt: new Date() },
      { writeConcern: { w: 'majority', j: true, wtimeout: 10_000 } },
    );
    markerState = 'WRITTEN';
    evidence.ownership.marker = markerState;

    for (const index of REQUIRED_INDEXES) {
      await mongoose.connection.collection(index.collection).createIndex(index.key, { name: index.name, ...index.options });
    }
    await new RecipientSuppressionKey({ _id: suppressionKeyId, check: keyCheckValue(suppressionKey, suppressionKeyId), state: 'ACTIVE', recovery: null, createdBy: 'smoke-run', requestId: `smoke-${runId}` }).save({
      writeConcern: { w: 'majority', j: true, wtimeout: 10_000 },
    });
    suppressionKeyRegistered = true;
    check('the run\'s synthetic suppression key is registered (the acknowledgement passes the real suppression check)', true, { keyId: suppressionKeyId });
    const slug = smokeJobSlug(runId);
    // Created as a draft and published through the real lifecycle service, like every Job.
    const job = new Job({
      _id: jobId,
      title: `${SMOKE_JOB_TITLE_PREFIX} ${runId}`,
      slug,
      location: { displayName: 'QA Smoke Test Location', countryCode: 'CA' },
      workArrangement: 'FULLY_REMOTE',
      employmentType: 'PART_TIME',
      weeklyHours: 1,
      compensation: { currency: 'CAD', amountMinor: 100, unit: 'HOUR', gross: true },
      description: 'QA SMOKE TEST DATA. Not a real vacancy.',
      responsibilities: ['QA SMOKE TEST DATA.'],
      requirements: ['QA SMOKE TEST DATA.'],
    });
    await job.save();
    created.jobId = job._id;
    await publishJob(job, { now: new Date(Date.now() - 60_000) });

    const ready = await fetch(`${base}/api/v1/health/ready`);
    check('readiness is 200 (database, storage and the relay login verified)', ready.status === 200, { status: ready.status });

    const apply = async (candidateEmail, key) => {
      const form = new FormData();
      form.set('fullName', SMOKE_CANDIDATE_NAME);
      form.set('email', candidateEmail);
      form.set('resume', new Blob([syntheticPdf()], { type: 'application/pdf' }), 'qa-smoke-resume.pdf');
      const response = await fetch(`${base}/api/v1/jobs/${slug}/applications`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: form });
      return { status: response.status, body: await response.json().catch(() => null) };
    };
    const stateOf = async () => {
      const records = await Application.find({ jobId: job._id }).sort({ submittedAt: 1 }).lean();
      created.applicationIds = records.map((stored) => stored._id);
      // Record the captured ids too (best effort: discovery does not depend on them — it uses the recorded Job id).
      const ids = created.applicationIds.map(String);
      if (ids.some((id) => !ownership.applicationIds.includes(id))) {
        ownership.applicationIds = [...new Set([...ownership.applicationIds, ...ids])];
        try {
          writeOwnershipRecord(os.tmpdir(), ownership);
        } catch {
          evidence.ownership.recordUpdate = 'FAILED (the Applications are still found by the recorded Job id)';
        }
      }
      return records;
    };

    const key = randomUUID();
    const first = await apply(options.candidate, key);
    check('Apply answered 201 RECEIVED', first.status === 201 && first.body?.data?.status === 'RECEIVED', { status: first.status });
    const [application] = await stateOf();
    const channels = application?.notifications ?? {};
    check('internal notification recorded SENT (accepted by the relay)', channels.internal?.status === 'SENT', {
      status: channels.internal?.status ?? null,
      code: channels.internal?.lastErrorCode ?? null,
    });
    check('acknowledgement recorded SENT (accepted by the relay)', channels.candidateAcknowledgement?.status === 'SENT', {
      status: channels.candidateAcknowledgement?.status ?? null,
      code: channels.candidateAcknowledgement?.lastErrorCode ?? null,
    });
    const sentBeforeReplay = evidence.sends.length;

    const replay = await apply(options.candidate, key);
    const [afterReplay] = await stateOf();
    check('replay answered 200 replayed', replay.status === 200 && replay.body?.meta?.replayed === true, { status: replay.status });
    check('replay sent nothing more (submissions unchanged, attempt counts unchanged)', evidence.sends.length === sentBeforeReplay && afterReplay?.notifications?.internal?.attemptCount === 1 && afterReplay?.notifications?.candidateAcknowledgement?.attemptCount === 1, {
      submissions: evidence.sends.length,
    });

    if (options.bounce) {
      const bounced = await apply(options.bounce, randomUUID());
      const records = await stateOf();
      const bounceApplication = records[1] ?? null;
      check('bounce test Application answered 201', bounced.status === 201, { status: bounced.status });
      // What is ESTABLISHED about the bounce-test acknowledgement: the recorded
      // channel state AND whether / how the transport handled it (the ledger).
      const recorded = bounceApplication?.notifications?.candidateAcknowledgement ?? null;
      const submissions = bounceApplication
        ? evidence.sends.filter((entry) => entry.event === 'APPLICATION_ACKNOWLEDGEMENT' && entry.applicationId === String(bounceApplication._id))
        : [];
      const bounceTest = classifyBounceExercise({ recorded, submission: submissions.at(-1) ?? null });
      evidence.bounceTest = { ...bounceTest, line: undefined };
      say(`        bounce-test acknowledgement: ${bounceTest.outcome} (recorded ${recorded?.status ?? 'unknown'}${recorded?.lastErrorCode ? ` / ${recorded.lastErrorCode}` : ''}${bounceTest.replyCode ? `, relay reply ${bounceTest.replyCode}` : ''})`);
      say(`        ${bounceTest.line}`);
      checks['bounce test acknowledgement (informational)'] = {
        outcome: bounceTest.outcome,
        relayAcceptance: bounceTest.relayAcceptance,
        bounceVerification: bounceTest.bounceVerification,
        status: recorded?.status ?? null,
        code: recorded?.lastErrorCode ?? null,
      };
    }

    // DRY RUN of the retry policy (send: false — it cannot send; no bulk retry).
    const dry = await runNotificationRetry({
      applications: createApplicationRepository({ timeoutMs: config.databaseQueryTimeoutMs }),
      notifier: { configured: false, acknowledgementEnabled: true },
      clock: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
      policy: {
        maxAttempts: config.notifications.retry.maxAttempts,
        baseDelayMs: config.notifications.retry.baseDelayMs,
        staleMs: staleAfterMs({ notificationTimeoutMs: config.notificationTimeoutMs, databaseTimeoutMs: config.databaseQueryTimeoutMs }),
      },
      send: false,
    });
    // The main Application must have nothing due. The bounce-test one is
    // reported only: a relay that defers an undeliverable address (4xx) makes
    // its acknowledgement transient-due — correct, and NOT sent by this run.
    const mainId = String(created.applicationIds[0]);
    const mainDue = dry.items.filter((item) => item.applicationId === mainId);
    check('dry-run retry assessment: nothing of the main Application is due for a resend', mainDue.length === 0, { due: mainDue.map((item) => item.channels) });
    if (options.bounce) {
      const bounceDue = dry.items.filter((item) => item.applicationId === String(created.applicationIds[1]));
      checks['dry-run retry assessment of the bounce test (informational; nothing is sent)'] = { due: bounceDue.map((item) => item.channels) };
    }

    check(`no more submissions than planned (hard limit ${budget})`, refusedOverBudget === 0 && evidence.sends.length <= budget, { submissions: evidence.sends.length, refused: refusedOverBudget });
    const attempted = logLines.map((line) => JSON.parse(line)).filter((line) => line.event === 'notification_attempted');
    evidence.logEvents = attempted.map(({ channel, notificationEvent, attempt, outcome, errorCode, errorClass, diagnostic, provider }) => ({ channel, notificationEvent, attempt, outcome, errorCode, errorClass, diagnostic, provider }));
    check('notification log lines name no address', !JSON.stringify(attempted).includes('@'));
  } catch (error) {
    failed = true;
    const summary = error instanceof ConfigurationError ? error.message : summarise(error);
    console.error(`FAILED during the live run: ${summary}. Detail is withheld.`);
    // The ORIGINAL failure. Lifecycle failures below are recorded beside it, never in its place.
    evidence.error = summary;
  } finally {
    // B7: the run's synthetic key check value is removed before shutdown (it protects nothing after the run).
    if (suppressionKeyRegistered) {
      try {
        const removed = await RecipientSuppressionKey.deleteOne({ _id: { $eq: suppressionKeyId } }, { writeConcern: { w: 'majority', j: true, wtimeout: 10_000 } });
        evidence.suppressionKey = removed.deletedCount === 1 ? 'REMOVED' : 'NOT_FOUND';
      } catch {
        evidence.suppressionKey = 'REMOVE_FAILED';
      }
    }
    // Every step runs whatever happened before it; PASS needs each one confirmed.
    let ownershipReleasing = null;
    const finalised = await finaliseSmokeRun({
      evidence,
      runFailed: failed,
      keepRecords: options.keep,
      shutdown: handle ? () => handle.shutdown('smoke test complete') : null,
      cleanupRecords: async () => {
        if (markerState === 'NOT_ATTEMPTED') {
          // Proven by the run itself: the marker precedes every record the run creates, so nothing of it is in the database.
          return {
            complete: true,
            ownership: 'NOTHING_CREATED',
            discovered: { job: 'never created', applications: 0, applicationsNotCapturedByTheRun: 0, applicationsWithMissingParentJob: 0, notOwned: { jobs: 0, applications: 0 } },
            confirmed: { applicationsDeleted: 0, jobsDeleted: 0 },
            remaining: { applications: 0, capturedApplications: 0, jobs: 0, jobsWithSlug: 0 },
          };
        }
        return cleanupSmokeRun({ record: ownership, target: runTarget, Job, Application, markers: ownershipMarkers, connect: connectTestDatabase, disconnect: () => mongoose.disconnect() });
      },
      removeStorage: () => removeDirectoryConfirmed(storageRoot),
      // r7: durable evidence that the records and files were confirmed removed, BEFORE the marker is released.
      recordReleasing: () => {
        const releasing = releasingRecord(ownership, { confirmed: evidence.cleanup?.confirmed });
        writeOwnershipRecord(os.tmpdir(), releasing);
        ownershipReleasing = releasing;
      },
      releaseOwnership:
        markerState === 'NOT_ATTEMPTED'
          ? null
          : () => releaseSmokeOwnership({ record: ownership, markers: ownershipMarkers, connect: connectTestDatabase, disconnect: () => mongoose.disconnect() }),
      recordCleaned: () => writeOwnershipRecord(os.tmpdir(), cleanedRecord(ownershipReleasing ?? ownership, { confirmed: evidence.cleanup?.confirmed, markerRelease: markerState === 'NOT_ATTEMPTED' ? 'never written' : 'released' })),
      storageName: path.basename(storageRoot),
      summarise,
    });
    failed = finalised.failed;
    say('\nLIFECYCLE');
    for (const step of evidence.lifecycle.steps) say(`  ${step.ok ? 'PASS' : 'FAIL'}  ${step.name}${step.reason ? ` — ${step.reason}` : ''}`);
    if (finalised.recordsRemaining) {
      say(
        options.keep && evidence.cleanup?.records === 'KEPT'
          ? `  KEPT: this run's synthetic records in "${target.databaseName}" and their resume files (<OS temporary directory>/${path.basename(storageRoot)}); ownership record <OS temporary directory>/${ownershipRecordName(runId)}.`
          : `  RETAINED: the cleanup was not confirmed, so the resume files (<OS temporary directory>/${path.basename(storageRoot)}) were kept with any records that may remain; ownership record <OS temporary directory>/${ownershipRecordName(runId)}.`,
      );
      say(`  Remove them (only this run's synthetic records, then their files): npm run ops:notifications:smoke -- --cleanup-run ${runId}`);
    } else if (evidence.storage?.files === 'REMOVED' && finalised.failures.some((name) => name.startsWith('ownership '))) {
      say(`  The run's records and files are gone, but its ownership could not be fully released or recorded. Finish it: npm run ops:notifications:smoke -- --cleanup-run ${runId}`);
    }
  }

  evidence.finishedAt = new Date().toISOString();
  evidence.automatedResult = failed ? 'FAIL' : 'PASS';
  evidence.automatedResultScope = 'automated checks and lifecycle steps only; not mailbox delivery, bounce verification or B6 acceptance';
  const evidenceFile = options.evidence ?? path.join(os.tmpdir(), `valida-b6-live-smoke-${runId}.json`);
  try {
    fs.writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
    say(`\nevidence file (sanitised): ${evidenceFile}`);
  } catch (error) {
    failed = true;
    console.error(`FAILED to write the evidence file: ${summarise(error)}.`);
  }

  say('\nSUBMITTED (Valida Message-IDs — search for them in the mailboxes):');
  for (const entry of evidence.sends) {
    say(`  ${entry.event.padEnd(30)} ${entry.to.padEnd(28)} ${String(entry.result ?? 'NO RESULT RECORDED').padEnd(26)} ${entry.messageId}`);
  }
  const reasons = [...(evidence.error ? [`the run failed: ${evidence.error}`] : []), ...(evidence.lifecycle?.failures ?? []).map((name) => `lifecycle: ${name}`)];
  for (const [name, entry] of Object.entries(checks)) if (entry.ok === false) reasons.push(`check: ${name}`);
  say(`\nAUTOMATED RESULT: ${failed ? 'FAIL' : 'PASS'}${failed ? '' : ' — now complete the MANUAL checks (backend/README.md, "B6 live Titan test"):'}`);
  if (failed) for (const reason of reasons) say(`  - ${reason}`);
  if (!failed) say('  (automated checks and lifecycle steps only — this is NOT mailbox delivery, bounce verification or B6 acceptance)');
  if (evidence.bounceTest) say(`  bounce exercise: ${evidence.bounceTest.outcome} — bounce verification ${evidence.bounceTest.bounceVerification}`);
  if (!failed) {
    say('  [ ] internal notification received by the recruitment mailbox; acknowledgement received by your test inbox (inbox or spam?)');
    say('  [ ] From is the sending mailbox; the acknowledgement\'s Reply-To is the careers address');
    say('  [ ] "Show original" on the received acknowledgement: SPF=pass, DKIM=pass, DMARC=pass (save the Authentication-Results)');
    say('  [ ] reply to the acknowledgement: the reply arrives in the careers / recruitment mailbox');
    say('  [ ] each message arrived ONCE (the replay sent nothing)');
    say('  [ ] the sending mailbox\'s Sent folder: are these messages there? (archival question)');
    if (evidence.bounceTest?.outcome === 'ACCEPTED_BY_RELAY') say('  [ ] the sending mailbox\'s Inbox: a bounce for the bounce-test message (match its Message-ID / subject)');
    if (evidence.bounceTest?.outcome === 'UNKNOWN') say('  [ ] the sending mailbox\'s Inbox: a bounce MAY arrive (acceptance unknown) — record whether one did; the exercise stays INCONCLUSIVE');
  }
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  const summary = error instanceof ConfigurationError ? error.message : `${error?.name ?? 'Error'}${error?.code ? ` (${error.code})` : ''}`;
  console.error(`Smoke test failed: ${summary}. Detail is withheld.`);
  process.exit(1);
});
