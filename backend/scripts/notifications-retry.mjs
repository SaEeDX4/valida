#!/usr/bin/env node
/**
 * Controlled notification retry — Milestone B6.
 * 09_BACKEND_API_SPEC.md sections 132-134, 14_EMAIL_DNS_IDENTITY.md sections
 * 119-121, 10_DATA_MODEL.md sections 117-122.
 *
 *   npm run ops:notifications:retry                       (dry run: report only)
 *   npm run ops:notifications:retry -- --send [--limit N] [--include-uncertain] [--include-configuration]
 *
 * (equivalently `node --env-file-if-exists=.env scripts/notifications-retry.mjs …`)
 *
 * WHAT IT DOES. Reports every Application notification state (counts per
 * channel, status and fixed code, and how many reached the attempt limit),
 * scans at most --limit Applications (default 50, at most 500) with a
 * notification DUE now, oldest first, and classifies
 * each channel with the retry policy of
 * src/modules/applications/application.notifications.js. Without --send
 * nothing is written and nothing is sent. With --send, each due Application
 * goes through the SAME claim / send / record cycle as the first attempt: the
 * claim is a conditional, validated save, so a concurrent run or request makes
 * it LOST and nothing is sent twice by this command.
 *
 * WHAT IS NEVER RETRIED AUTOMATICALLY
 *   PERMANENT failures (invalid/suppressed recipient, rejected, not
 *   allowlisted) and attempts at the attempt limit: never.
 *   UNCERTAIN outcomes (timeout, unknown outcome, interrupted attempt): the
 *   provider MAY have accepted the message — only with --include-uncertain,
 *   which accepts the risk of a duplicate email.
 *   CONFIGURATION failures (credentials, sender identity, template): only with
 *   --include-configuration, after the configuration was fixed.
 * Candidate acknowledgements are retried only while
 * APPLICATION_ACKNOWLEDGEMENT_ENABLED is true; an Application accepted while
 * they were disabled never gets one later (its channel is NOT_REQUIRED).
 *
 * --send REQUIRES A CONFIGURED PROVIDER (r4: TRANSACTIONAL_EMAIL_PROVIDER=smtp
 * with its SMTP_* settings). Without one, --send is refused before the
 * database is contacted; with one, the provider is verified first (connect,
 * TLS, authentication — nothing sent) and --send is refused if that fails. A
 * dry run works without a provider.
 *
 * This is NOT a smoke test: it acts on every due Application in the database
 * it is pointed at. The opt-in live test is scripts/notifications-smoke.mjs.
 *
 * WHAT IT PRINTS. Internal Application ids, channel names, counts and fixed
 * codes only — never candidate data, an address, a provider response, the
 * connection string, a driver message or a stack. This is an operator tool:
 * it is not exposed over HTTP (Doc 15 section 175). The database is the one
 * named by MONGODB_URI, read from backend/.env like `npm start`, or from the
 * shell for one run.
 *
 * Exit codes: 0 completed (dry run, or every attempt's outcome recorded),
 *             1 refused, failed, or an attempt whose outcome could not be
 *               claimed, loaded or recorded,
 *             2 usage error.
 */
import mongoose from 'mongoose';
import { loadConfig, ConfigurationError } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';
import { safeErrorSummary } from '../src/lib/safeError.js';
import { createNotificationService, notificationServiceOptions } from '../src/integrations/notifications/notificationService.js';
import { createNotificationTransport } from '../src/integrations/notifications/transport.js';
import { createApplicationRepository } from '../src/modules/applications/application.repository.js';
import {
  RETRY_LIMITS,
  createApplicationNotifier,
  runNotificationRetry,
  staleAfterMs,
} from '../src/modules/applications/application.notifications.js';

const USAGE = [
  'Usage:',
  '  node scripts/notifications-retry.mjs [--send] [--limit N] [--include-uncertain] [--include-configuration]',
  '',
  '  (no --send)               dry run: report what is due; nothing is written or sent',
  '  --send                    attempt the due notifications (requires a configured provider)',
  `  --limit N                 Applications scanned in this run (1-${RETRY_LIMITS.maxLimit}, default ${RETRY_LIMITS.defaultLimit})`,
  '  --include-uncertain       also retry attempts whose outcome is unknown (may send a duplicate)',
  '  --include-configuration   also retry attempts that failed on configuration (after fixing it)',
].join('\n');

function usage(message) {
  if (message) console.error(`${message}\n`);
  console.error(USAGE);
  process.exit(2);
}

function parseRetryArgs(argv) {
  const options = { send: false, limit: RETRY_LIMITS.defaultLimit, includeUncertain: false, includeConfiguration: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--send') options.send = true;
    else if (argument === '--include-uncertain') options.includeUncertain = true;
    else if (argument === '--include-configuration') options.includeConfiguration = true;
    else if (argument === '--limit') {
      const value = argv[index + 1];
      index += 1;
      if (!/^\d{1,4}$/.test(value ?? '') || Number(value) < 1 || Number(value) > RETRY_LIMITS.maxLimit) {
        return { error: `--limit must be a whole number from 1 to ${RETRY_LIMITS.maxLimit}.` };
      }
      options.limit = Number(value);
    } else if (argument === '--help' || argument === '-h') return { help: true };
    else return { error: 'Unknown argument.' };
  }
  return { options };
}

let stage = 'setup';

async function main() {
  const parsed = parseRetryArgs(process.argv.slice(2));
  if (parsed.help) usage();
  if (parsed.error) usage(parsed.error);
  const { options } = parsed;

  const config = loadConfig();
  // Notifier events go to stderr as JSON lines (fixed tokens and internal ids only).
  const logger = createLogger({ level: config.logLevel, appEnv: config.appEnv, isProduction: config.isProduction, destination: process.stderr });
  const transport = createNotificationTransport({ config, logger });
  const notifications = createNotificationService({
    transport,
    timeoutMs: config.notificationTimeoutMs,
    ...notificationServiceOptions(config.notifications),
  });

  console.log(`mode: ${options.send ? 'SEND' : 'DRY RUN (nothing is written or sent)'}`);
  console.log(`provider: ${transport === null ? 'none configured (TRANSACTIONAL_EMAIL_PROVIDER=none)' : notifications.providerName}`);
  console.log(`candidate acknowledgement: ${notifications.acknowledgementEnabled ? 'enabled' : 'disabled'}`);

  if (options.send && transport === null) {
    console.error('\nREFUSED: --send requires a configured transactional email provider. Nothing was read, written or sent.');
    process.exit(1);
  }
  if (options.send) {
    const verified = await notifications.verify();
    if (!verified.ok) {
      const detail = verified.diagnostic ? ` ${JSON.stringify(verified.diagnostic)}` : '';
      console.error(`\nREFUSED: the provider could not be verified (${verified.reason}${detail}). Nothing was read, written or sent.`);
      process.exit(1);
    }
  }

  await mongoose.connect(config.mongodbUri, {
    serverSelectionTimeoutMS: config.databaseConnectTimeoutMs,
    autoIndex: false,
    autoCreate: false,
  });
  console.log(`database: ${mongoose.connection.name}`);

  const applications = createApplicationRepository({ timeoutMs: config.databaseQueryTimeoutMs });
  const notifier = createApplicationNotifier({ applications, notifications, clock: () => new Date(), logger });
  const policy = {
    maxAttempts: config.notifications.retry.maxAttempts,
    baseDelayMs: config.notifications.retry.baseDelayMs,
    staleMs: staleAfterMs({ notificationTimeoutMs: config.notificationTimeoutMs, databaseTimeoutMs: config.databaseQueryTimeoutMs }),
  };
  console.log(
    `policy: at most ${policy.maxAttempts} attempts; backoff ${policy.baseDelayMs} ms doubling (max 6 h); ` +
      `an attempt in progress for ${policy.staleMs} ms is uncertain`,
  );

  stage = 'summary';
  const summary = await applications.summarizeNotificationStates({ maxAttempts: policy.maxAttempts });
  console.log('\nnotification states (all Applications):');
  for (const [channel, { states, exhausted }] of Object.entries(summary)) {
    console.log(`  ${channel}:`);
    if (states.length === 0) console.log('    (none)');
    for (const { status, code, count } of states) console.log(`    ${String(count).padStart(6)}  ${status}${code ? ` / ${code}` : ''}`);
    console.log(`    ${String(exhausted).padStart(6)}  of these at the attempt limit (never retried)`);
  }

  stage = options.send ? 'sending' : 'scan';
  const report = await runNotificationRetry({
    applications,
    notifier,
    clock: () => new Date(),
    policy,
    send: options.send,
    limit: options.limit,
    includeUncertain: options.includeUncertain,
    includeConfiguration: options.includeConfiguration,
  });

  stage = 'reporting';
  console.log(
    `\nscanned: ${report.scanned} Application(s) with a notification due now` +
      (report.limitReached ? ' (limit reached: more may be due — raise --limit, or run --send again)' : ''),
  );
  for (const [channel, categories] of Object.entries(report.categories)) {
    const entries = Object.entries(categories);
    if (entries.length > 0) console.log(`  ${channel}: ${entries.map(([category, count]) => `${category} ${count}`).join(', ')}`);
  }
  console.log(`due: ${report.due} Application(s)`);
  for (const item of report.items) {
    const outcomes = item.outcomes ? ` ${Object.entries(item.outcomes).map(([channel, outcome]) => `${channel}=${outcome}`).join(' ')}` : '';
    console.log(`  ${item.applicationId}  ${item.channels.join('+')}  ${item.action}${outcomes}`);
  }
  if (options.send) {
    const r = report.results;
    console.log(
      `\nresults: ${r.SENT} accepted by the provider (not a delivery confirmation), ${r.FAILED} failed (recorded), ` +
        `${r.CLAIM_LOST} claimed by another process, ${r.NO_LONGER_DUE} no longer due, ` +
        `${r.CLAIM_FAILED} not claimed (database), ${r.NOT_ATTEMPTED} not attempted, ${r.NOT_LOADED} not loaded, ` +
        `${r.UNRECORDED} sent-or-failed but NOT RECORDED`,
    );
  }
  const incomplete =
    options.send && report.results.CLAIM_FAILED + report.results.NOT_ATTEMPTED + report.results.NOT_LOADED + report.results.UNRECORDED > 0;
  try {
    await mongoose.disconnect();
  } catch {
    console.error('warning: the database connection did not close cleanly. The report above stands.');
    process.exit(1);
  }
  await notifications.close().catch(() => {});
  if (incomplete) {
    console.error('\nINCOMPLETE: at least one attempt could not be claimed, loaded or recorded (see above). Its state is left as stored.');
    process.exit(1);
  }
  process.exit(0);
}

function classify(error) {
  if (error instanceof mongoose.Error.MongooseServerSelectionError || error instanceof mongoose.mongo.MongoServerSelectionError) {
    return 'the database named by MONGODB_URI could not be reached';
  }
  const { type, code } = safeErrorSummary(error);
  return `${type}${code ? ` (${code})` : ''}`;
}

main().catch(async (error) => {
  // Never print a driver message, a stack, an address or the connection string.
  if (error instanceof ConfigurationError) {
    console.error(error.message);
    console.error('Nothing was read, written or sent.');
  } else if (stage === 'setup' || stage === 'summary' || stage === 'scan') {
    console.error(`Notification retry failed before any attempt: ${classify(error)}. Nothing was written or sent. Detail is withheld.`);
  } else {
    console.error(
      `Notification retry failed during the run (${stage}): ${classify(error)}. Attempts may have been made — ` +
        'run again without --send to see the stored state. Detail is withheld.',
    );
  }
  try {
    await mongoose.disconnect();
  } catch {
    // Already closed or never opened.
  }
  process.exit(1);
});
