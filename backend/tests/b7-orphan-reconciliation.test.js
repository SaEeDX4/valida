import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LocalPrivateStorage } from '../src/integrations/storage/localPrivateStorage.js';
import { storageObjectRef } from '../src/integrations/storage/storageContract.js';
import {
  reconcileOrphanObjects, parseReconcileArgs, createApplicationReferenceLookup, ReconciliationRefused,
  DEFAULT_MIN_AGE_MS, MIN_AGE_FLOOR_MS, RECONCILE_MODES,
} from '../src/integrations/storage/orphanReconciliation.js';
import { capturingLogger } from './helpers.js';

/**
 * B7 — orphan private-file reconciliation (Doc 15 sections 199-205; Doc 17
 * sections 320-322: "Create synthetic orphan. Dry-run identifies it. No
 * deletion by default. Explicit cleanup removes intended synthetic orphan
 * only."). Real local storage on a temporary root; the MongoDB reference
 * lookup is a set here and the real collection in tests/db/b7-storage-reconcile.test.js.
 */
const HOUR = 60 * 60 * 1000;
const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let root;
let storage;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'valida-b7-reconcile-'));
  storage = new LocalPrivateStorage({ root: path.join(root, 'store'), appEnv: 'local', nodeEnv: 'test' });
  await storage.init();
});
afterEach(async () => {
  await storage?.close();
  await fsp.rm(root, { recursive: true, force: true });
});

/** Stores one synthetic object and backdates it by `ageHours`. */
async function storeObject(ageHours) {
  const bytes = Buffer.from(`%PDF-1.4 qa-synthetic-${randomBytes(4).toString('hex')}`);
  const file = path.join(root, `upload-${randomBytes(4).toString('hex')}`);
  await fsp.writeFile(file, bytes);
  const { storageKey } = await storage.storePrivateResume({
    filePath: file,
    sizeBytes: bytes.length,
    checksumSha256: createHash('sha256').update(bytes).digest('hex'),
  });
  const [, id, fileKey] = storageKey.split('/');
  const objectPath = path.join(root, 'store', 'resumes', id, fileKey);
  const when = new Date(Date.now() - ageHours * HOUR);
  await fsp.utimes(objectPath, when, when);
  return { storageKey, objectPath };
}

const lookupFrom = (referenced) => async (keys) => new Set(keys.filter((key) => referenced.has(key)));

describe('listPrivateObjects (local adapter)', () => {
  it('lists every object with size and time; counts partials and unexpected entries; never returns content', async () => {
    const a = await storeObject(1);
    const b = await storeObject(100);
    const [, id, fileKey] = a.storageKey.split('/');
    await fsp.writeFile(path.join(root, 'store', 'resumes', id, `${fileKey}.partial-0123456789abcdef`), 'x');
    await fsp.writeFile(path.join(root, 'store', 'resumes', 'not-an-object'), 'x');
    const listing = await storage.listPrivateObjects();
    expect(listing.objects.map((o) => o.storageKey).sort()).toEqual([a.storageKey, b.storageKey].sort());
    expect(listing.objects.every((o) => Number.isInteger(o.sizeBytes) && o.modifiedAt instanceof Date && !('content' in o))).toBe(true);
    expect(listing.partials.map((p) => p.storageKey)).toEqual([a.storageKey]);
    expect(listing.unexpected).toBe(1);
    expect(listing.notConfined).toBe(0);
  });

  it.skipIf(process.platform === 'win32')('a per-object directory that is a link out of storage is counted and skipped, never followed', async () => {
    const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'valida-b7-outside-'));
    try {
      const id = randomBytes(16).toString('hex');
      const fileKey = randomBytes(16).toString('hex');
      await fsp.writeFile(path.join(outside, fileKey), 'outside');
      await fsp.symlink(outside, path.join(root, 'store', 'resumes', id), 'dir');
      const listing = await storage.listPrivateObjects();
      expect(listing.objects).toEqual([]);
      expect(listing.notConfined).toBe(1);
    } finally {
      await fsp.rm(outside, { recursive: true, force: true });
    }
  });
});

describe('reconcileOrphanObjects', () => {
  it('DRY RUN by default: identifies the old unreferenced object, deletes nothing, names objects by one-way reference only', async () => {
    const referenced = await storeObject(200);
    const orphan = await storeObject(100);
    const recent = await storeObject(2);
    const report = await reconcileOrphanObjects({ storage, findReferencedKeys: lookupFrom(new Set([referenced.storageKey])) });
    expect(report.mode).toBe(RECONCILE_MODES.DRY_RUN);
    expect(report.objects).toBe(3);
    expect(report.referenced).toBe(1);
    const byRef = Object.fromEntries(report.possibleOrphans.map((e) => [e.ref, e]));
    expect(byRef[storageObjectRef(orphan.storageKey)].action).toBe('DELETE_CANDIDATE');
    expect(byRef[storageObjectRef(recent.storageKey)].action).toBe('KEEP_TOO_RECENT');
    expect(report.deleted).toBe(0);
    for (const object of [referenced, orphan, recent]) expect(fs.existsSync(object.objectPath)).toBe(true);
    const text = JSON.stringify(report);
    for (const object of [referenced, orphan, recent]) {
      expect(text).not.toContain(object.storageKey);
      expect(text).not.toContain(object.storageKey.split('/')[2]);
    }
  });

  it('DELETE with confirmation removes only the old unreferenced object; referenced and recent objects stay; each deletion is logged', async () => {
    const referenced = await storeObject(200);
    const orphan = await storeObject(100);
    const recent = await storeObject(2);
    const captured = capturingLogger();
    const report = await reconcileOrphanObjects({
      storage,
      findReferencedKeys: lookupFrom(new Set([referenced.storageKey])),
      mode: RECONCILE_MODES.DELETE,
      confirmed: true,
      logger: captured.logger,
    });
    const entries = captured.lines.map((line) => JSON.parse(line));
    expect(report.deleted).toBe(1);
    expect(fs.existsSync(orphan.objectPath)).toBe(false);
    expect(fs.existsSync(referenced.objectPath)).toBe(true);
    expect(fs.existsSync(recent.objectPath)).toBe(true);
    const deletions = entries.filter((e) => e.event === 'storage_orphan_deleted');
    expect(deletions).toHaveLength(1);
    expect(deletions[0].objectRef).toBe(storageObjectRef(orphan.storageKey));
    expect(captured.output()).not.toContain(orphan.storageKey);
  });

  it('in-flight safety: an object referenced by the time of the re-check is kept', async () => {
    const orphan = await storeObject(100);
    let calls = 0;
    const findReferencedKeys = async (keys) => {
      calls += 1;
      // Unreferenced at listing time; an Application referencing it is persisted before deletion.
      return calls === 1 ? new Set() : new Set(keys);
    };
    const report = await reconcileOrphanObjects({ storage, findReferencedKeys, mode: RECONCILE_MODES.DELETE, confirmed: true });
    expect(report.keptReferencedOnRecheck).toBe(1);
    expect(report.deleted).toBe(0);
    expect(fs.existsSync(orphan.objectPath)).toBe(true);
  });

  it('partial-write leftovers are reported and never deleted', async () => {
    const object = await storeObject(300);
    const [, id, fileKey] = object.storageKey.split('/');
    const partial = path.join(root, 'store', 'resumes', id, `${fileKey}.partial-00ff00ff00ff00ff`);
    await fsp.writeFile(partial, 'x');
    const report = await reconcileOrphanObjects({
      storage,
      findReferencedKeys: lookupFrom(new Set([object.storageKey])),
      mode: RECONCILE_MODES.DELETE,
      confirmed: true,
    });
    expect(report.partials).toHaveLength(1);
    expect(fs.existsSync(partial)).toBe(true);
  });

  it('a failed deletion is reported and logged, and the run carries on', async () => {
    const first = await storeObject(100);
    const second = await storeObject(100);
    const failing = {
      listPrivateObjects: () => storage.listPrivateObjects(),
      deletePrivateObject: async (key) => {
        if (key === first.storageKey) throw Object.assign(new Error('qa'), { reason: 'IO_ERROR' });
        return storage.deletePrivateObject(key);
      },
    };
    const captured = capturingLogger();
    const report = await reconcileOrphanObjects({ storage: failing, findReferencedKeys: lookupFrom(new Set()), mode: RECONCILE_MODES.DELETE, confirmed: true, logger: captured.logger });
    expect(report.deleteFailures).toBe(1);
    expect(report.deleted).toBe(1);
    expect(fs.existsSync(first.objectPath)).toBe(true);
    expect(fs.existsSync(second.objectPath)).toBe(false);
    expect(captured.lines.map((line) => JSON.parse(line)).some((e) => e.event === 'storage_orphan_delete_failed')).toBe(true);
    expect(report.recommendation).toMatch(/failed/);
  });

  it.each([
    ['DELETE without confirmation', { mode: RECONCILE_MODES.DELETE }, 'DELETE_NOT_CONFIRMED'],
    ['a minimum age below the 24 h floor', { minAgeMs: MIN_AGE_FLOOR_MS - 1 }, 'MIN_AGE_BELOW_FLOOR'],
    ['an unknown mode', { mode: 'PURGE' }, 'UNKNOWN_MODE'],
  ])('refuses %s before reading storage', async (_label, options, reason) => {
    const spy = { listPrivateObjects: async () => { throw new Error('must not be read'); }, deletePrivateObject: async () => {} };
    await expect(reconcileOrphanObjects({ storage: spy, findReferencedKeys: lookupFrom(new Set()), ...options })).rejects.toMatchObject({
      name: 'ReconciliationRefused',
      reason,
    });
  });

  it('the defaults: 72 h minimum age, never below 24 h', () => {
    expect(DEFAULT_MIN_AGE_MS).toBe(72 * HOUR);
    expect(MIN_AGE_FLOOR_MS).toBe(24 * HOUR);
    expect(new ReconciliationRefused('X').reason).toBe('X');
  });
});

describe('createApplicationReferenceLookup', () => {
  it('queries resume.storageKey with plain string values in $in, in batches, with a time limit', async () => {
    const calls = [];
    const Application = {
      find(filter, projection) {
        calls.push({ filter, projection });
        const keys = filter['resume.storageKey'].$in;
        return { lean: () => ({ maxTimeMS: async (ms) => (calls.at(-1).ms = ms, keys.filter((k) => k.endsWith('a')).map((k) => ({ resume: { storageKey: k } }))) }) };
      },
    };
    const lookup = createApplicationReferenceLookup({ Application, timeoutMs: 1234, batchSize: 2 });
    const found = await lookup(['k1a', 'k2b', 'k3a']);
    expect([...found].sort()).toEqual(['k1a', 'k3a']);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.ms === 1234 && c.filter['resume.storageKey'].$in.every((v) => typeof v === 'string'))).toBe(true);
    expect(calls[0].projection).toEqual({ 'resume.storageKey': 1, _id: 0 });
  });
});

describe('parseReconcileArgs and the CLI refusals', () => {
  it.each([
    [[], { mode: 'DRY_RUN', confirmed: false, minAgeMs: 72 * HOUR }],
    [['--min-age-hours', '96'], { mode: 'DRY_RUN', confirmed: false, minAgeMs: 96 * HOUR }],
    [['--delete', '--confirm-delete'], { mode: 'DELETE', confirmed: true, minAgeMs: 72 * HOUR }],
  ])('%j -> options', (argv, options) => {
    expect(parseReconcileArgs(argv)).toEqual({ options });
  });

  it.each([
    [['--delete']],
    [['--confirm-delete']],
    [['--min-age-hours', '1']],
    [['--min-age-hours', 'x']],
    [['--min-age-hours']],
    [['--purge']],
  ])('%j -> refused', (argv) => {
    expect(parseReconcileArgs(argv).error).toBeTypeOf('string');
  });

  it.each([
    ['an argument error', ['--delete'], {}],
    ['no storage configured', [], { RESUME_STORAGE_DRIVER: '' }],
  ])('the script refuses (%s) with exit code 2 before connecting to anything', (_label, argv, env) => {
    const result = spawnSync(process.execPath, ['scripts/storage-reconcile.mjs', ...argv], {
      cwd: BACKEND,
      encoding: 'utf8',
      timeout: 20_000,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        APP_ENV: 'local',
        LOG_LEVEL: 'silent',
        CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
        MONGODB_URI: 'mongodb://127.0.0.1:1/valida_test',
        ...env,
      },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/REFUSED/);
    expect(result.stdout).not.toMatch(/^database:/m);
  });
});
