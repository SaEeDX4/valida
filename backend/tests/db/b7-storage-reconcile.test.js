import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Application } from '../../src/models/Application.js';
import { REQUIRED_INDEXES } from '../../src/db/indexes.js';
import { LocalPrivateStorage } from '../../src/integrations/storage/localPrivateStorage.js';
import { generateResumeStorageKey, storageObjectRef } from '../../src/integrations/storage/storageContract.js';
import { createApplicationReferenceLookup, reconcileOrphanObjects, RECONCILE_MODES } from '../../src/integrations/storage/orphanReconciliation.js';
import { syntheticApplication } from './fixtures/syntheticApplication.js';
import { requireTestDatabase, assertConnectedToTestDatabase } from './testDatabase.js';

/**
 * B7 — orphan reconciliation against the REAL Application collection (Doc 15
 * sections 199-205; Doc 17 sections 320-322): a synthetic referenced object,
 * a synthetic orphan and an Application persisted "in flight" between the
 * listing and the deletion. Synthetic data only, in the disposable test
 * database (requireTestDatabase).
 */
const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const HOUR = 60 * 60 * 1000;
const inserted = [];
let root;
let storage;
let nextKeys;

beforeAll(async () => {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false });
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  for (const required of REQUIRED_INDEXES) {
    await mongoose.connection.db.collection(required.collection).createIndex(required.key, { name: required.name, ...required.options });
  }
}, 30_000);

afterAll(async () => {
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  await Application.collection.deleteMany({ _id: { $in: inserted } });
  await mongoose.disconnect();
});

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'valida-b7-reconcile-db-'));
  nextKeys = [];
  storage = new LocalPrivateStorage({
    root: path.join(root, 'store'),
    appEnv: 'local',
    nodeEnv: 'test',
    generateKey: () => nextKeys.shift() ?? generateResumeStorageKey(),
  });
  await storage.init();
});

afterEach(async () => {
  await storage.close();
  await fsp.rm(root, { recursive: true, force: true });
});

/** Stores a synthetic object under `storageKey` and backdates it by `ageHours`. */
async function storeAt(storageKey, ageHours) {
  const bytes = Buffer.from(`%PDF-1.4 qa-synthetic-${storageKey.slice(-8)}`);
  const file = path.join(root, `upload-${storageKey.slice(-8)}`);
  await fsp.writeFile(file, bytes);
  nextKeys.push(storageKey);
  await storage.storePrivateResume({ filePath: file, sizeBytes: bytes.length, checksumSha256: createHash('sha256').update(bytes).digest('hex') });
  const [, id, fileKey] = storageKey.split('/');
  const objectPath = path.join(root, 'store', 'resumes', id, fileKey);
  const when = new Date(Date.now() - ageHours * HOUR);
  await fsp.utimes(objectPath, when, when);
  return objectPath;
}

/** A complete synthetic Application (not yet saved) with a fresh resume storage key. */
function syntheticReferencingApplication() {
  const _id = new mongoose.Types.ObjectId();
  const document = syntheticApplication({
    _id,
    jobId: new mongoose.Types.ObjectId(),
    jobSnapshot: { title: 'QA B7 RECONCILE ROLE - NOT A REAL VACANCY', slug: 'qa-b7-reconcile-role' },
    fullName: 'QA Reconcile Candidate (synthetic)',
  });
  return { document, storageKey: document.resume.storageKey };
}

/** Saves it through the validated save, in the disposable test database only. */
async function save(document) {
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  inserted.push(document._id);
  await document.save();
}

describe('ops:storage:reconcile against MongoDB', () => {
  it('dry run identifies the unreferenced object; the confirmed delete removes it and only it', async () => {
    const referenced = syntheticReferencingApplication();
    const orphanKey = generateResumeStorageKey();
    const referencedPath = await storeAt(referenced.storageKey, 100);
    const orphanPath = await storeAt(orphanKey, 100);
    await save(referenced.document);
    const findReferencedKeys = createApplicationReferenceLookup({ Application, timeoutMs: 5_000 });

    const dry = await reconcileOrphanObjects({ storage, findReferencedKeys });
    expect(dry.referenced).toBe(1);
    expect(dry.possibleOrphans.map((entry) => [entry.ref, entry.action])).toEqual([[storageObjectRef(orphanKey), 'DELETE_CANDIDATE']]);
    expect(fs.existsSync(orphanPath)).toBe(true);

    const run = await reconcileOrphanObjects({ storage, findReferencedKeys, mode: RECONCILE_MODES.DELETE, confirmed: true });
    expect(run.deleted).toBe(1);
    expect(fs.existsSync(orphanPath)).toBe(false);
    expect(fs.existsSync(referencedPath)).toBe(true);
  });

  it('an Application persisted between the listing and the deletion keeps its object (re-check against the database)', async () => {
    const inFlight = syntheticReferencingApplication();
    const objectPath = await storeAt(inFlight.storageKey, 100);
    const lookup = createApplicationReferenceLookup({ Application, timeoutMs: 5_000 });
    let calls = 0;
    const findReferencedKeys = async (keys) => {
      calls += 1;
      const found = await lookup(keys);
      if (calls === 1) await save(inFlight.document); // persisted right after the listing
      return found;
    };
    const run = await reconcileOrphanObjects({ storage, findReferencedKeys, mode: RECONCILE_MODES.DELETE, confirmed: true });
    expect(run.keptReferencedOnRecheck).toBe(1);
    expect(run.deleted).toBe(0);
    expect(fs.existsSync(objectPath)).toBe(true);
  });
});
