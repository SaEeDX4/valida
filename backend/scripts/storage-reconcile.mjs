#!/usr/bin/env node
/**
 * B7 — `npm run ops:storage:reconcile` (Doc 15 sections 199-205).
 *
 *   npm run ops:storage:reconcile                                   dry run (default): report only
 *   npm run ops:storage:reconcile -- --min-age-hours 96             a longer safety window
 *   npm run ops:storage:reconcile -- --delete --confirm-delete      delete unreferenced objects
 *                                                                   older than the minimum age
 *
 * Lists the private resume objects, checks each against MongoDB
 * (`resume.storageKey`) and reports possible orphans by their one-way
 * reference only — never a storage key or a filename. Deletion needs both
 * flags, keeps anything younger than the minimum age (72 h by default, never
 * below 24 h), re-checks each reference just before deleting, and logs every
 * deletion. Partial-write leftovers are reported, never deleted.
 *
 * Exit codes: 0 done; 1 a failure (nothing further deleted); 2 refused
 * (arguments, configuration or storage not available) — nothing read or deleted.
 */
import mongoose from 'mongoose';
import { loadConfig, ConfigurationError } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';
import { safeErrorSummary } from '../src/lib/safeError.js';
import { createPrivateStorage } from '../src/integrations/storage/privateStorage.js';
import { Application } from '../src/models/Application.js';
import {
  createApplicationReferenceLookup, parseReconcileArgs, reconcileOrphanObjects, ReconciliationRefused, MIN_AGE_FLOOR_MS,
} from '../src/integrations/storage/orphanReconciliation.js';

const HOUR_MS = 60 * 60 * 1000;

function usage(error) {
  if (error) console.error(`REFUSED: ${error}. Nothing was read or deleted.\n`);
  console.error(
    'usage: npm run ops:storage:reconcile -- [--min-age-hours N] [--delete --confirm-delete]\n' +
      `  default: dry run, minimum age 72 h (never below ${MIN_AGE_FLOOR_MS / HOUR_MS} h)`,
  );
  process.exit(error ? 2 : 0);
}

async function main() {
  const parsed = parseReconcileArgs(process.argv.slice(2));
  if (parsed.help) usage();
  if (parsed.error) usage(parsed.error);
  const { options } = parsed;

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error(`REFUSED: configuration is invalid (${safeErrorSummary(error)}). Nothing was read or deleted.`);
      process.exit(2);
    }
    throw error;
  }
  const logger = createLogger({ level: config.logLevel, appEnv: config.appEnv, isProduction: config.isProduction, destination: process.stderr });
  const storage = createPrivateStorage({ config, logger });
  if (storage === null) {
    console.error('REFUSED: no private storage is configured (RESUME_STORAGE_DRIVER). Nothing was read or deleted.');
    process.exit(2);
  }
  await storage.init();

  console.log(`mode: ${options.mode === 'DELETE' ? 'DELETE (confirmed)' : 'DRY RUN (nothing is deleted)'}`);
  console.log(`environment: APP_ENV=${config.appEnv}; storage: ${storage.provider}`);
  console.log(`minimum age: ${options.minAgeMs / HOUR_MS} h`);

  await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: config.databaseConnectTimeoutMs, autoIndex: false, autoCreate: false });
  console.log(`database: ${mongoose.connection.name}`);
  try {
    const report = await reconcileOrphanObjects({
      storage,
      findReferencedKeys: createApplicationReferenceLookup({ Application, timeoutMs: config.databaseQueryTimeoutMs }),
      mode: options.mode,
      confirmed: options.confirmed,
      minAgeMs: options.minAgeMs,
      logger,
    });
    console.log(`\nobjects: ${report.objects}; referenced by an Application: ${report.referenced}; possible orphans: ${report.possibleOrphans.length}`);
    for (const entry of report.possibleOrphans) {
      console.log(`  ${entry.ref}  age ${entry.ageHours} h  ${entry.sizeBytes} bytes  ${entry.action}`);
    }
    console.log(`partial-write leftovers (reported, never deleted): ${report.partials.length}`);
    for (const partial of report.partials) console.log(`  ${partial.ref}  age ${partial.ageHours} h`);
    if (report.unexpectedEntries || report.notConfinedEntries) {
      console.log(`unexpected entries: ${report.unexpectedEntries}; entries not confined to storage (skipped): ${report.notConfinedEntries}`);
    }
    if (options.mode === 'DELETE') {
      console.log(`deleted: ${report.deleted}; kept because referenced on re-check: ${report.keptReferencedOnRecheck}; failures: ${report.deleteFailures}`);
    }
    console.log(`\nrecommendation: ${report.recommendation}`);
    process.exitCode = report.deleteFailures > 0 ? 1 : 0;
  } catch (error) {
    if (error instanceof ReconciliationRefused) {
      console.error(`REFUSED: ${error.reason}. Nothing was deleted.`);
      process.exitCode = 2;
    } else {
      console.error(`FAILED: ${safeErrorSummary(error)}. Reconciliation stopped.`);
      process.exitCode = 1;
    }
  } finally {
    await mongoose.disconnect();
    await storage.close();
  }
}

main().catch((error) => {
  console.error(`FAILED: ${safeErrorSummary(error)}`);
  process.exit(1);
});
