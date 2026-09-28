#!/usr/bin/env node
/**
 * Controlled Job provisioning — Milestone B3.
 * 18_IMPLEMENTATION_ROADMAP.md sections 109-110, 15_DEVOPS_DEPLOYMENT.md
 * sections 171-175, 12_CAREERS_APPLICATIONS.md sections 44-47.
 *
 *   npm run jobs:provision:plan  -- --file <definition.json>
 *   npm run jobs:provision:apply -- --file <definition.json> [--confirm-lifecycle] [--confirm-material-change]
 *
 * (equivalently `node --env-file-if-exists=.env scripts/provision-job.mjs <plan|apply> --file …`)
 *
 * `plan` validates the definition, reads the stored Job and reports exactly
 * what `apply` would do. It never writes.
 * `apply` performs that change through the approved B2 services and validated
 * saves (see src/modules/jobs/job.provisioning.js).
 *
 * WHAT IT PRINTS IS WHAT IS KNOWN. "Nothing was written" appears only where
 * that is established: the run stopped before any write (invalid input,
 * configuration, connection, a read, a refusal), or its only write was
 * certainly rejected. When some writes were acknowledged and a later step was
 * not applied, the run is INCOMPLETE and the acknowledged writes are listed.
 * When the database did not confirm a write, or the result could not be read
 * back, the run is NOT CONFIRMED and nothing is assumed either way. Nothing is
 * ever rolled back or deleted; the printed guidance says how to reconcile.
 *
 * The database is the one named by MONGODB_URI, read from backend/.env like
 * `npm start`, or from the shell for one run. This is an operator tool: it is
 * not exposed over HTTP (Doc 15 section 175). The connection string, driver
 * messages and stack traces are never printed.
 *
 * Exit codes: 0 success (plan applicable / created / updated / unchanged),
 *             1 refused, incomplete, not confirmed, invalid input or failure,
 *             2 usage error.
 */
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { loadConfig, ConfigurationError } from '../src/config/env.js';
import { RECONCILIATION_GUIDANCE, parseJobDefinition, provisionJob } from '../src/modules/jobs/job.provisioning.js';
import { safeErrorSummary } from '../src/lib/safeError.js';

/** A definition is a small JSON document; anything larger is a mistake. */
const MAX_DEFINITION_BYTES = 256 * 1024;

const USAGE = [
  'Usage:',
  '  node scripts/provision-job.mjs plan  --file <definition.json>',
  '  node scripts/provision-job.mjs apply --file <definition.json> [--confirm-lifecycle] [--confirm-material-change]',
].join('\n');

function usage(message) {
  if (message) console.error(`${message}\n`);
  console.error(USAGE);
  process.exit(2);
}

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  if (mode !== 'plan' && mode !== 'apply') usage('The first argument must be "plan" or "apply".');
  const options = { mode, file: null, confirmLifecycle: false, confirmMaterialChange: false };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--file') {
      if (options.file !== null || index + 1 >= rest.length) usage('--file must be given exactly once, with a path.');
      options.file = rest[index + 1];
      index += 1;
    } else if (argument === '--confirm-lifecycle' && mode === 'apply') {
      options.confirmLifecycle = true;
    } else if (argument === '--confirm-material-change' && mode === 'apply') {
      options.confirmMaterialChange = true;
    } else {
      usage(`Unsupported argument for ${mode}: ${argument.slice(0, 60)}`);
    }
  }
  if (!options.file) usage('--file <definition.json> is required.');
  return options;
}

function fail(lines) {
  for (const line of [].concat(lines)) console.error(line);
  process.exit(1);
}

function readDefinition(path) {
  let stats;
  try {
    stats = statSync(path);
  } catch {
    fail(`Definition file not found or not readable: ${path}`);
  }
  if (!stats.isFile()) fail(`Definition path is not a regular file: ${path}`);
  if (stats.size > MAX_DEFINITION_BYTES) fail(`Definition file is larger than ${MAX_DEFINITION_BYTES} bytes.`);

  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(`Definition file is not valid JSON: ${path}`);
  }
  const parsed = parseJobDefinition(raw);
  if (!parsed.ok) {
    fail(['INVALID DEFINITION — nothing was read from or written to the database:', ...parsed.errors.map((e) => `  - ${e}`)]);
  }
  return parsed.definition;
}

const list = (items) => (items && items.length ? items.join(', ') : '—');
const publicLabel = (state) => (state === 'NOT_PUBLIC' ? 'not public' : state);

/** One-line verdict per outcome. "nothing was written" only where it is established. */
function verdictFor({ outcome, refusals, failure }) {
  switch (outcome) {
    case 'planned':
      return refusals.length === 0 ? 'PLAN OK — apply would succeed' : 'PLAN REFUSED — apply would write nothing';
    case 'created':
      return 'CREATED';
    case 'updated':
      return 'UPDATED';
    case 'unchanged':
      return 'UNCHANGED — the stored Job already matches; nothing was written';
    case 'refused':
      return 'REFUSED — nothing was written';
    case 'incomplete':
      return 'INCOMPLETE — the writes listed above were applied; a later step was NOT applied';
    case 'unconfirmed':
      return failure
        ? 'NOT CONFIRMED — the database did not confirm whether the failed step was applied; do not assume it either way'
        : 'NOT CONFIRMED — the writes listed above were acknowledged, but the stored result could not be confirmed';
    default:
      return 'UNKNOWN OUTCOME — do not assume anything was or was not written';
  }
}

const SUCCESS = new Set(['created', 'updated', 'unchanged']);

function report({ mode, file, databaseName, result, confirmations }) {
  const { plan, refusals, outcome, job, writes = [], failure = null, readback } = result;
  const lines = [];
  lines.push(`Valida Job provisioning — ${mode === 'plan' ? 'PLAN (nothing is written)' : 'APPLY'}`);
  lines.push(`database          : ${databaseName}`);
  lines.push(`definition        : ${file}`);
  lines.push(`slug              : ${plan.slug}`);
  lines.push(`stored status     : ${plan.currentStatus ?? 'none (no Job has this slug)'}`);
  lines.push(`action            : ${plan.action}`);
  lines.push(`fields changing   : ${list(plan.changes)}`);
  lines.push(
    `lifecycle         : ${
      plan.transition ? `${plan.transition.from} -> ${plan.transition.to}` : `no transition (${plan.desiredStatus})`
    }`,
  );
  lines.push(
    `public effect     : ${
      plan.effectiveChange
        ? `${publicLabel(plan.effectiveChange.from)} -> ${publicLabel(plan.effectiveChange.to)} (${plan.effectiveChange.cause})`
        : `none (${publicLabel(plan.publicBefore)} before and after)`
    }`,
  );
  if (plan.requiresConfirmation.lifecycle) {
    lines.push(
      `confirmation      : required — ${
        mode === 'plan' ? 'apply with --confirm-lifecycle' : `--confirm-lifecycle ${confirmations.lifecycle ? 'given' : 'NOT given'}`
      }`,
    );
  }
  if (plan.materialChanges.length > 0) {
    lines.push(
      `material changes  : ${list(plan.materialChanges)} — ${plan.applicationCount} Application(s) exist` +
        (plan.requiresConfirmation.materialChange
          ? ` (requires --confirm-material-change${
              mode === 'apply' ? `, ${confirmations.materialChange ? 'given' : 'NOT given'}` : ''
            })`
          : ''),
    );
  }
  if (plan.newScreeningIdentifiers > 0) {
    lines.push(`screening ids     : ${plan.newScreeningIdentifiers} new identifier(s) will be generated by the server`);
  }
  lines.push(
    `publish readiness : ${plan.readiness.ready ? 'ready' : `NOT READY — missing: ${list(plan.readiness.missing)}`}`,
  );
  lines.push(`awaiting input    : ${list(plan.awaitingInput)}`);
  lines.push(`public after apply: ${publicLabel(plan.publicAfter)}`);
  if (refusals.length > 0) {
    lines.push('refusals          :');
    for (const refusal of refusals) lines.push(`  - ${refusal.code}: ${refusal.message}`);
  }
  if (mode === 'apply' && !['refused', 'unchanged'].includes(outcome)) {
    lines.push(`written           : ${writes.length ? writes.join('; ') : 'nothing acknowledged by the database'}`);
  }
  if (failure) {
    const applied = failure.applied === 'no' ? 'NOT applied' : 'outcome UNKNOWN (the database did not confirm it)';
    lines.push(`failed step       : ${failure.step} — ${applied}`);
    for (const detail of failure.detail) lines.push(`  - ${detail.code}: ${detail.message}`);
  }
  if (readback === 'failed') lines.push('stored state      : could NOT be read back to confirm the result');
  if (readback === 'missing') lines.push('stored state      : the Job was NOT found when read back');
  if (job) {
    lines.push('stored Job        :');
    lines.push(`  status          : ${job.status}`);
    lines.push(`  publishedAt     : ${job.publishedAt ?? '—'}`);
    lines.push(`  closesAt        : ${job.closesAt ?? '—'}`);
    lines.push(`  closedAt        : ${job.closedAt ?? '—'}`);
    lines.push(`  archivedAt      : ${job.archivedAt ?? '—'}`);
    lines.push(`  public now      : ${publicLabel(job.publicNow)}`);
    for (const question of job.screeningQuestions) {
      lines.push(`  question ${question.questionId}  ${question.prompt.slice(0, 60)}`);
      for (const option of question.options) lines.push(`    option ${option.optionId}  ${option.label.slice(0, 60)}`);
    }
  }
  lines.push(`result            : ${verdictFor(result)}`);
  if (outcome === 'incomplete' || outcome === 'unconfirmed') {
    lines.push(`next step         : ${RECONCILIATION_GUIDANCE}`);
  }
  const failed = outcome === 'planned' ? refusals.length > 0 : !SUCCESS.has(outcome);
  (failed ? console.error : console.log)(lines.join('\n'));
  return failed ? 1 : 0;
}

/**
 * Where the run was when something failed. It decides what may truthfully be
 * said about writes:
 *   setup        before provisionJob ran — nothing can have been written;
 *   provisioning inside provisionJob, which throws only during its read phase,
 *                before any write is attempted (it returns every write-phase
 *                outcome as a result instead);
 *   reporting    provisionJob has returned; its result may or may not have
 *                been printed, so nothing is claimed about writes.
 */
let stage = 'setup';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const file = resolve(process.cwd(), options.file);

  // Validated completely before any database is contacted.
  const definition = readDefinition(file);
  const config = loadConfig();

  await mongoose.connect(config.mongodbUri, {
    serverSelectionTimeoutMS: config.databaseConnectTimeoutMs,
    autoIndex: false,
    autoCreate: false,
  });

  stage = 'provisioning';
  const result = await provisionJob({
    definition,
    apply: options.mode === 'apply',
    now: new Date(),
    confirmLifecycle: options.confirmLifecycle,
    confirmMaterialChange: options.confirmMaterialChange,
  });

  stage = 'reporting';
  const code = report({
    mode: options.mode,
    file: options.file,
    databaseName: mongoose.connection.name,
    result,
    confirmations: { lifecycle: options.confirmLifecycle, materialChange: options.confirmMaterialChange },
  });
  try {
    await mongoose.disconnect();
  } catch {
    console.error(
      'warning: the database connection did not close cleanly. The result above stands; ' +
        'run `plan` to confirm the stored state if in doubt.',
    );
    process.exit(1);
  }
  process.exit(code);
}

/** Safe, bounded description of an unexpected error: a fixed classification only. */
function classify(error) {
  if (
    error instanceof mongoose.Error.MongooseServerSelectionError ||
    error instanceof mongoose.mongo.MongoServerSelectionError
  ) {
    return 'the database named by MONGODB_URI could not be reached';
  }
  const { type, code } = safeErrorSummary(error);
  return `${type}${code ? ` (${code})` : ''}`;
}

main().catch(async (error) => {
  // Never print a driver message, a stack or the connection string.
  if (error instanceof ConfigurationError) {
    console.error(error.message);
    console.error('Nothing was read from or written to the database.');
  } else if (stage === 'setup') {
    console.error(
      `Job provisioning failed before contacting the Job data: ${classify(error)}. Nothing was written. ` +
        'Detail is withheld because it may contain connection details.',
    );
  } else if (stage === 'provisioning') {
    console.error(
      `Job provisioning failed while reading the stored Job, before any write: ${classify(error)}. ` +
        'Nothing was written. Detail is withheld because it may contain connection details.',
    );
  } else {
    // The write phase has finished, but its result may not have been printed:
    // claim nothing about what was written.
    console.error(
      `Job provisioning failed while reporting its result: ${classify(error)}. Writes may have been made — ` +
        'do not assume either way; run `plan` to see what is stored. ' +
        'Detail is withheld because it may contain connection details.',
    );
  }
  try {
    await mongoose.disconnect();
  } catch {
    // Already closed or never opened.
  }
  process.exit(1);
});
