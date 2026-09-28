#!/usr/bin/env node
/**
 * MongoDB index management — Doc 10 sections 66-68, 97, 113, 128-132.
 *
 *   node scripts/db-indexes.mjs check    (npm run db:indexes:check)
 *   node scripts/db-indexes.mjs apply    (npm run db:indexes:apply)
 *
 * SAFETY. Apply is additive and repeatable. It compares first and creates only
 * what is missing, leaving every existing index — compatible or not — alone. It never drops an index, never deletes a
 * record, never resets a database and never uses destructive synchronisation
 * to make a conflict disappear — a conflicting index is REPORTED and the
 * command fails, so a human decides.
 *
 * Check inspects the indexes the database actually reports, comparing key
 * order, direction and the significant options, and exits non-zero when any
 * required index is missing or incompatible.
 *
 * Neither command prints the connection string.
 */
import mongoose from 'mongoose';
import { loadConfig, ConfigurationError } from '../src/config/env.js';
import { REQUIRED_INDEXES, SIGNIFICANT_OPTIONS, diffIndexes, optionsCompatible } from '../src/db/indexes.js';
import { safeErrorSummary } from '../src/lib/safeError.js';

const MODE = process.argv[2];

if (!['check', 'apply'].includes(MODE)) {
  console.error('Usage: node scripts/db-indexes.mjs <check|apply>');
  process.exit(2);
}

/** Describes a key specification the way a human reads an index. */
const describeKey = (key) =>
  Object.entries(key)
    .map(([field, direction]) => `${field}:${direction}`)
    .join(', ');

async function readActualIndexes(connection) {
  const collections = [...new Set(REQUIRED_INDEXES.map((index) => index.collection))];
  const actual = {};

  for (const name of collections) {
    const collection = connection.db.collection(name);
    try {
      actual[name] = await collection.indexes();
    } catch {
      // A collection that does not exist yet simply has no indexes. That is a
      // missing-index result, not an error.
      actual[name] = [];
    }
  }

  return actual;
}

/** Which significant options differ — named, never valued. */
const differingOptions = (required, actual) =>
  SIGNIFICANT_OPTIONS.filter((option) => !optionsCompatible({ [option]: required[option] }, { [option]: actual[option] }));

function report({ satisfied, missing, incompatible }) {
  for (const entry of satisfied) {
    const unique = entry.requirement.options.unique ? ' unique' : '';
    console.log(
      `  PASS     ${entry.requirement.collection}.${entry.actual.name}  { ${describeKey(entry.requirement.key)} }${unique}`,
    );
  }
  for (const requirement of missing) {
    console.error(`  MISSING  ${requirement.collection}  { ${describeKey(requirement.key)} }`);
    console.error(`           ${requirement.reason}`);
  }
  for (const entry of incompatible) {
    console.error(
      `  CONFLICT ${entry.requirement.collection}.${entry.actual.name}  { ${describeKey(entry.requirement.key)} }`,
    );
    console.error(
      `           an index on these keys exists with different options ` +
        `(${differingOptions(entry.requirement.options, entry.actual).join(', ')}). It was NOT modified.`,
    );
  }
}

async function main() {
  const config = loadConfig();

  await mongoose.connect(config.mongodbUri, {
    serverSelectionTimeoutMS: config.databaseConnectTimeoutMs,
    autoIndex: false,
    autoCreate: false,
  });

  const connection = mongoose.connection;
  console.log(`database: ${connection.name}`);
  console.log(`mode: ${MODE}\n`);

  let applyFailures = 0;

  if (MODE === 'apply') {
    /*
     * Compare first, then create ONLY what is missing. A required index that
     * already exists — under any name — is left exactly as it is, so re-running
     * changes nothing. An incompatible one is reported and never rebuilt.
     */
    const before = diffIndexes(REQUIRED_INDEXES, await readActualIndexes(connection));

    for (const entry of before.satisfied) {
      console.log(`  present  ${entry.requirement.collection}.${entry.actual.name}  (no change)`);
    }
    for (const entry of before.incompatible) {
      console.error(
        `  CONFLICT ${entry.requirement.collection}.${entry.actual.name}  not modified — resolve it deliberately`,
      );
    }
    for (const required of before.missing) {
      const collection = connection.db.collection(required.collection);
      try {
        const created = await collection.createIndex(required.key, {
          name: required.name,
          ...required.options,
        });
        console.log(`  created  ${required.collection}.${created}  { ${describeKey(required.key)} }`);
      } catch (error) {
        // Typically an index already holding the required NAME on other keys,
        // or existing documents that violate a new unique index.
        applyFailures += 1;
        console.error(
          `  FAILED   ${required.collection}.${required.name}  { ${describeKey(required.key)} } — ` +
            `${safeErrorSummary(error).type}. Nothing was dropped or deleted.`,
        );
      }
    }
    console.log('');
  }

  const result = diffIndexes(REQUIRED_INDEXES, await readActualIndexes(connection));
  report(result);

  await mongoose.disconnect();

  const failures = result.missing.length + result.incompatible.length + applyFailures;
  console.log(
    `\n${result.satisfied.length}/${REQUIRED_INDEXES.length} required indexes present` +
      (failures ? ` — ${failures} problem(s)` : ''),
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  // Never print a driver message or the connection string.
  if (error instanceof ConfigurationError) {
    console.error(error.message);
  } else if (
    error instanceof mongoose.Error.MongooseServerSelectionError ||
    error instanceof mongoose.mongo.MongoServerSelectionError
  ) {
    console.error(
      'Index command failed: the database named by MONGODB_URI could not be reached. ' +
        'Detail is withheld because it may contain connection details.',
    );
  } else {
    const { type, code } = safeErrorSummary(error);
    console.error(
      `Index command failed: ${type}${code ? ` (${code})` : ''}. ` +
        'Detail is withheld because it may contain connection details.',
    );
  }
  try {
    await mongoose.disconnect();
  } catch {
    // Already closed.
  }
  process.exit(1);
});
