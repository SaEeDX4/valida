#!/usr/bin/env node
/**
 * B7 — `npm run ops:notifications:suppression -- <subcommand> [options]`
 * (RECIPIENT_SUPPRESSION_DESIGN.md rev 8 §3.4, §4.2, §4.4, §4.5.1; approved by
 * OD-2026-11-04-02). The logic lives in src/modules/suppression/suppressionOperations.js.
 *
 * DRY RUN BY DEFAULT: nothing is written without --apply, and --apply needs
 * --operator <id> listed in SUPPRESSION_OPERATOR_IDS. No address is ever typed
 * in or printed: addresses come from stored Applications, and the output holds
 * internal ids, key ids, counts and fixed tokens only.
 *
 * Exit codes: 0 done (including a dry run); 1 a failure (a write may be
 * unknown — re-run the same command, every subcommand is idempotent);
 * 2 refused (arguments, configuration or a precondition) — nothing written.
 */
import mongoose from 'mongoose';
import { loadConfig, ConfigurationError } from '../src/config/env.js';
import { safeErrorSummary } from '../src/lib/safeError.js';
import { createSuppressionRegister, SuppressionWriteUnknown } from '../src/modules/suppression/suppressionRegister.js';
import { keyringFromConfig } from '../src/modules/suppression/suppressionKeys.js';
import { createSuppressionOperations, SuppressionRefused } from '../src/modules/suppression/suppressionOperations.js';

export const SUBCOMMANDS = Object.freeze({
  list: ['--state', '--limit'],
  check: ['--application'],
  add: ['--from-refusal', '--from-bounce', '--complaint', '--application', '--evidence-ref', '--message-token', '--status', '--dsn-received', '--window-days', '--kind'],
  lift: ['--suppression', '--reason', '--evidence-ref'],
  forget: ['--application', '--reason', '--evidence-ref'],
  coverage: [],
  rekey: ['--limit'],
  'key-register': ['--key-id'],
  'recover-key': ['--key-id', '--decision-ref', '--evidence-ref', '--confirm-key-unavailable', '--expected-count', '--reason', '--limit', '--complete'],
  'resolve-unrecoverable': ['--key-id', '--expected-count', '--confirm-key-unavailable', '--decision-ref', '--evidence-ref'],
});
const BOOLEAN_FLAGS = new Set(['--apply', '--from-refusal', '--from-bounce', '--complaint', '--confirm-key-unavailable', '--complete']);
const INTEGER_FLAGS = new Set(['--limit', '--window-days', '--expected-count']);
const COMMON_FLAGS = ['--apply', '--operator'];

/** Parses argv into `{ subcommand, flags }`; throws SuppressionRefused('INVALID_ARGUMENTS') on anything unexpected. */
export function parseSuppressionArgs(argv) {
  const [subcommand, ...rest] = argv;
  if (!Object.hasOwn(SUBCOMMANDS, subcommand ?? '')) throw new SuppressionRefused('INVALID_ARGUMENTS', { reason: 'UNKNOWN_SUBCOMMAND' });
  const allowed = new Set([...SUBCOMMANDS[subcommand], ...COMMON_FLAGS]);
  const flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (!allowed.has(flag)) throw new SuppressionRefused('INVALID_ARGUMENTS', { reason: 'UNKNOWN_ARGUMENT' });
    if (Object.hasOwn(flags, flag)) throw new SuppressionRefused('INVALID_ARGUMENTS', { reason: 'REPEATED_ARGUMENT' });
    if (BOOLEAN_FLAGS.has(flag)) {
      flags[flag] = true;
      continue;
    }
    const value = rest[index + 1];
    index += 1;
    if (value === undefined || value.startsWith('--')) throw new SuppressionRefused('INVALID_ARGUMENTS', { reason: 'MISSING_VALUE' });
    if (INTEGER_FLAGS.has(flag)) {
      if (!/^\d{1,5}$/.test(value)) throw new SuppressionRefused('INVALID_ARGUMENTS', { reason: 'NOT_AN_INTEGER' });
      flags[flag] = Number(value);
    } else flags[flag] = value;
  }
  if (subcommand === 'add' && ['--from-refusal', '--from-bounce', '--complaint'].filter((flag) => flags[flag]).length !== 1) {
    throw new SuppressionRefused('INVALID_ARGUMENTS', { reason: 'ADD_NEEDS_EXACTLY_ONE_SOURCE' });
  }
  return { subcommand, flags };
}

/** Runs one parsed subcommand against the operations. */
export function runSubcommand(operations, { subcommand, flags }) {
  const write = { apply: flags['--apply'] === true, actor: flags['--operator'] };
  switch (subcommand) {
    case 'list':
      return operations.list({ state: flags['--state'] ?? null, limit: flags['--limit'] ?? 50 });
    case 'check':
      return operations.check({ applicationId: flags['--application'] });
    case 'add':
      if (flags['--from-refusal']) return operations.addFromRefusal({ applicationId: flags['--application'], evidenceRef: flags['--evidence-ref'], ...write });
      if (flags['--from-bounce']) {
        return operations.addFromBounce({
          messageToken: flags['--message-token'],
          status: flags['--status'],
          dsnReceived: flags['--dsn-received'],
          evidenceRef: flags['--evidence-ref'],
          windowDays: flags['--window-days'],
          ...write,
        });
      }
      return operations.addComplaint({ applicationId: flags['--application'], kind: flags['--kind'], evidenceRef: flags['--evidence-ref'], ...write });
    case 'lift':
      return operations.lift({ suppressionId: flags['--suppression'], reason: flags['--reason'], evidenceRef: flags['--evidence-ref'], ...write });
    case 'forget':
      return operations.forget({ applicationId: flags['--application'], reason: flags['--reason'], evidenceRef: flags['--evidence-ref'], ...write });
    case 'coverage':
      return operations.coverage();
    case 'rekey':
      return operations.rekey({ limit: flags['--limit'], ...write });
    case 'key-register':
      return operations.keyRegister({ keyId: flags['--key-id'], ...write });
    case 'recover-key':
      return operations.recoverKey({
        keyId: flags['--key-id'],
        decisionRef: flags['--decision-ref'],
        evidenceRef: flags['--evidence-ref'],
        confirmKeyUnavailable: flags['--confirm-key-unavailable'] === true,
        expectedCount: flags['--expected-count'],
        reason: flags['--reason'],
        limit: flags['--limit'],
        complete: flags['--complete'] === true,
        ...write,
      });
    case 'resolve-unrecoverable':
      return operations.resolveUnrecoverable({
        keyId: flags['--key-id'],
        expectedCount: flags['--expected-count'],
        confirmKeyUnavailable: flags['--confirm-key-unavailable'] === true,
        decisionRef: flags['--decision-ref'],
        evidenceRef: flags['--evidence-ref'],
        ...write,
      });
    default:
      throw new SuppressionRefused('INVALID_ARGUMENTS');
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('ops-notifications-suppression.mjs');

async function main() {
  let parsed;
  try {
    parsed = parseSuppressionArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`REFUSED: ${error.code} (${error.details?.reason ?? 'arguments'}). Subcommands: ${Object.keys(SUBCOMMANDS).join(', ')}. Nothing was read or written.`);
    process.exit(2);
  }
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error(error.message);
      console.error('REFUSED: configuration. Nothing was read or written.');
      process.exit(2);
    }
    throw error;
  }
  const keyring = keyringFromConfig(config.suppression);
  const apply = parsed.flags['--apply'] === true;
  console.log(`mode: ${apply ? 'APPLY' : 'DRY RUN (nothing is written)'}`);
  console.log(`environment: ${config.appEnv}`);
  console.log(`keys: current ${keyring.currentKeyId ?? 'NONE'}; previous ${keyring.previousKeyIds.join(', ') || 'none'}`);

  await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: config.databaseConnectTimeoutMs, autoIndex: false, autoCreate: false });
  console.log(`database: ${mongoose.connection.name}`);
  const register = createSuppressionRegister({ timeoutMs: config.databaseQueryTimeoutMs, writeTimeoutMs: config.databaseQueryTimeoutMs });
  const operations = createSuppressionOperations({ register, keyring, operatorIds: config.suppression.operatorIds, timeoutMs: config.databaseQueryTimeoutMs });

  let exitCode = 0;
  try {
    const result = await runSubcommand(operations, parsed);
    console.log(JSON.stringify({ subcommand: parsed.subcommand, ...result }, null, 2));
  } catch (error) {
    if (error instanceof SuppressionRefused) {
      console.error(`REFUSED: ${error.code}${Object.keys(error.details).length ? ` ${JSON.stringify(error.details)}` : ''}. Nothing was written by this step.`);
      exitCode = 2;
    } else if (error instanceof SuppressionWriteUnknown) {
      console.error(`FAILED: a write outcome is unknown (${error.reason}); it may have applied. Nothing further was written. Re-run the same command (idempotent).`);
      exitCode = 1;
    } else {
      const { type, code } = safeErrorSummary(error);
      console.error(`FAILED: ${type}${code ? ` (${code})` : ''}. Detail is withheld. Re-run without --apply to see the stored state.`);
      exitCode = 1;
    }
  }
  await mongoose.disconnect().catch(() => {});
  process.exit(exitCode);
}

if (isMain) {
  main().catch(async (error) => {
    const { type, code } = safeErrorSummary(error);
    console.error(`FAILED before any write: ${type}${code ? ` (${code})` : ''}. Detail is withheld.`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}
