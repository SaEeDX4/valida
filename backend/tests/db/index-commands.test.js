import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mongoose from 'mongoose';
import { REQUIRED_INDEXES } from '../../src/db/indexes.js';
import { requireTestDatabase, assertConnectedToTestDatabase } from './testDatabase.js';

/**
 * `npm run db:indexes:apply` and `npm run db:indexes:check` against a REAL
 * MongoDB — Doc 10 sections 218-219.
 *
 * Runs the actual command-line scripts as separate processes, exactly as an
 * operator would, and inspects the indexes the database reports. Proves that
 * apply is repeatable, that check detects missing and incompatible indexes
 * with a non-zero exit, and that neither command drops or rebuilds an index
 * to make a conflict disappear.
 *
 * Only indexes are touched, and only in the test database (enforced by
 * requireTestDatabase). Every scenario restores the required set.
 */
// Judged on the launching environment BEFORE any child environment below
// overrides MONGODB_URI with the test target.
const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function indexCommand(mode) {
  const result = spawnSync(process.execPath, ['scripts/db-indexes.mjs', mode], {
    cwd: backendRoot,
    env: { ...process.env, MONGODB_URI: TEST_URI, MONGODB_CONNECT_TIMEOUT_MS: '10000' },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
}

const collection = (name) => mongoose.connection.db.collection(name);

async function indexSummary() {
  const summary = {};
  for (const name of ['jobs', 'applications']) {
    const indexes = await collection(name).indexes().catch(() => []);
    summary[name] = indexes
      .map((index) => ({ name: index.name, key: index.key, unique: Boolean(index.unique) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return summary;
}

async function dropIfPresent(collectionName, indexName) {
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  const names = (await collection(collectionName).indexes().catch(() => [])).map((index) => index.name);
  if (names.includes(indexName)) await collection(collectionName).dropIndex(indexName);
}

beforeAll(async () => {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 10_000, autoIndex: false, autoCreate: false });
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
}, 30_000);

afterAll(async () => {
  // Leave the test database with exactly the required set.
  indexCommand('apply');
  await mongoose.disconnect();
}, 60_000);

describe('db:indexes:apply', () => {
  it('creates the required indexes and changes nothing when run again', async () => {
    const first = indexCommand('apply');
    expect(first.code, first.output).toBe(0);
    const afterFirst = await indexSummary();

    const second = indexCommand('apply');
    expect(second.code, second.output).toBe(0);
    expect(second.output).not.toMatch(/\bcreated\b/);
    expect(second.output.match(/\(no change\)/g)).toHaveLength(REQUIRED_INDEXES.length);
    expect(await indexSummary()).toEqual(afterFirst);
  }, 120_000);

  it('creates exactly the six required indexes plus _id — nothing speculative, no TTL', async () => {
    expect(indexCommand('apply').code).toBe(0);
    const summary = await indexSummary();
    expect(summary.jobs.map((index) => index.name).sort()).toEqual(['_id_', 'public_listing', 'slug_unique'].sort());
    expect(summary.applications.map((index) => index.name).sort()).toEqual(
      ['_id_', 'candidateEmail_job_submittedAt', 'idempotency_keyHash_unique', 'job_submittedAt', 'resume_storageKey_unique'].sort(),
    );
    const raw = await collection('applications').indexes();
    raw.forEach((index) => expect(index.expireAfterSeconds).toBeUndefined());
  }, 60_000);
});

describe('db:indexes:check', () => {
  it('passes when every required index is present', () => {
    expect(indexCommand('apply').code).toBe(0);
    const check = indexCommand('check');
    expect(check.code, check.output).toBe(0);
    expect(check.output).toMatch(new RegExp(`${REQUIRED_INDEXES.length}/${REQUIRED_INDEXES.length} required indexes present`));
  }, 60_000);

  it('fails with a non-zero exit and names a missing index; apply then restores it', async () => {
    expect(indexCommand('apply').code).toBe(0);
    await dropIfPresent('applications', 'resume_storageKey_unique');

    const check = indexCommand('check');
    expect(check.code).toBe(1);
    expect(check.output).toMatch(/MISSING\s+applications\s+\{ resume\.storageKey:1 \}/);

    const apply = indexCommand('apply');
    expect(apply.code, apply.output).toBe(0);
    expect(apply.output).toMatch(/created\s+applications\.resume_storageKey_unique/);
    expect(indexCommand('check').code).toBe(0);
  }, 120_000);

  it('reports an incompatible index and never drops or rebuilds it', async () => {
    expect(indexCommand('apply').code).toBe(0);
    // Replace the unique slug index with a NON-unique one on the same key.
    await dropIfPresent('jobs', 'slug_unique');
    assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
    await collection('jobs').createIndex({ slug: 1 }, { name: 'slug_1' });

    const check = indexCommand('check');
    expect(check.code).toBe(1);
    expect(check.output).toMatch(/CONFLICT jobs\.slug_1/);
    expect(check.output).toMatch(/unique/);

    const apply = indexCommand('apply');
    expect(apply.code).toBe(1);
    expect(apply.output).toMatch(/CONFLICT jobs\.slug_1\s+not modified/);

    // Still exactly as it was: present, non-unique, not replaced.
    const slugIndexes = (await collection('jobs').indexes()).filter((index) => index.key.slug === 1);
    expect(slugIndexes.map((index) => [index.name, Boolean(index.unique)])).toEqual([['slug_1', false]]);

    // Restore deliberately, as an operator would.
    assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
    await collection('jobs').dropIndex('slug_1');
    expect(indexCommand('apply').code).toBe(0);
    expect(indexCommand('check').code).toBe(0);
  }, 120_000);

  it('never prints the connection string', () => {
    for (const mode of ['apply', 'check']) {
      const { output } = indexCommand(mode);
      expect(output).not.toContain(TEST_URI);
      expect(output).not.toMatch(/mongodb(\+srv)?:\/\//);
    }
  }, 60_000);
});
