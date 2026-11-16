import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isResumeStorageKey, PrivateStorageError } from '../../src/integrations/storage/privateStorage.js';
import { reconcileOrphanObjects, RECONCILE_MODES } from '../../src/integrations/storage/orphanReconciliation.js';
import { syntheticPdf } from './resumeFiles.js';
import { makeTestRoot, removeTestRoot } from './uploadHarness.js';

/**
 * C6-T4 — THE B4 STORAGE CONTRACT, as one suite every driver must pass.
 *
 * What the callers rely on (Apply: storePrivateResume, deletePrivateObject;
 * readiness: init/isReady; reconciliation: listPrivateObjects, stat, delete):
 * exact bytes, length and SHA-256; server-generated résumé keys; nothing
 * stored on an integrity failure; NOT_FOUND on a second delete; fixed failure
 * reasons that never carry a key or a path; nothing usable before init or
 * after close; reconciliation keeps referenced and recent objects.
 *
 * Run by tests/storage-contract-local.test.js (the B4 local driver, offline)
 * and tests/s3/storage-contract-s3.test.js (the S3-compatible driver against
 * the local S3 test double, `npm run test:s3`).
 *
 * @param {string} label
 * @param {object} driver
 * @param {() => Promise<object>} driver.create         a new, NOT initialised storage
 * @param {(storage, key) => Promise<Buffer|null>} driver.readBack  the stored bytes, read
 *        independently of the driver (null when absent) — test-side only
 * @param {() => Promise<void>} [driver.reset]          empties the store between tests
 */
export function defineStorageContract(label, { create, readBack, reset = async () => {} }) {
  const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
  let root;
  let source;
  let pdf;
  const opened = [];
  const ready = async () => {
    const storage = await create();
    opened.push(storage);
    await storage.init();
    return storage;
  };
  const request = (overrides = {}) => ({ filePath: source, sizeBytes: pdf.length, checksumSha256: sha256(pdf), ...overrides });
  const reasonOf = async (promise) => {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(PrivateStorageError);
      return error.reason;
    }
    return 'RESOLVED';
  };

  describe(`B4 storage contract — ${label}`, () => {
    beforeEach(async () => {
      await reset();
      root = makeTestRoot();
      pdf = syntheticPdf({ text: `QA TEST DOCUMENT C6-T4 ${label}` });
      source = path.join(root, 'validated-upload.part');
      fs.writeFileSync(source, pdf);
    });
    afterEach(async () => {
      while (opened.length) await opened.pop().close();
      removeTestRoot(root);
    });

    it('init proves the store works; isReady follows it; nothing is usable before init or after close', async () => {
      const storage = await create();
      opened.push(storage);
      expect(storage.isReady).toBe(false);
      expect(await reasonOf(storage.storePrivateResume(request()))).toBe('NOT_READY');
      await storage.init();
      expect(storage.isReady).toBe(true);
      await storage.close();
      expect(storage.isReady).toBe(false);
      for (const call of [() => storage.storePrivateResume(request()), () => storage.statPrivateObject('resumes/' + 'a'.repeat(32) + '/' + 'b'.repeat(32)), () => storage.listPrivateObjects()]) {
        expect(await reasonOf(call())).toBe('NOT_READY');
      }
    });

    it('stores the exact bytes under a new server-generated key, with the same length and SHA-256', async () => {
      const storage = await ready();
      const stored = await storage.storePrivateResume(request());
      expect(stored).toEqual({
        storageProvider: storage.provider,
        storageKey: expect.stringMatching(/^resumes\/[0-9a-f]{32}\/[0-9a-f]{32}$/),
        sizeBytes: pdf.length,
        checksumSha256: sha256(pdf),
        storedAt: expect.any(Date),
      });
      const bytes = await readBack(storage, stored.storageKey);
      expect(bytes.equals(pdf)).toBe(true);
      expect(sha256(bytes)).toBe(stored.checksumSha256);
      expect(await storage.statPrivateObject(stored.storageKey)).toEqual({ exists: true, sizeBytes: pdf.length });
      // The source (the upload's temporary file) is left for its owner.
      expect(fs.existsSync(source)).toBe(true);
    });

    it('every store gets a distinct key', async () => {
      const storage = await ready();
      const keys = new Set();
      for (let i = 0; i < 5; i += 1) keys.add((await storage.storePrivateResume(request())).storageKey);
      expect(keys.size).toBe(5);
      for (const key of keys) expect(isResumeStorageKey(key)).toBe(true);
    });

    it.each([
      ['a checksum of other bytes', () => ({ checksumSha256: sha256(Buffer.from('other bytes')) })],
      ['a declared size one byte short', () => ({ sizeBytes: pdf.length - 1 })],
      ['a declared size one byte long', () => ({ sizeBytes: pdf.length + 1 })],
    ])('an integrity failure (%s) stores nothing', async (_label, change) => {
      const storage = await ready();
      expect(await reasonOf(storage.storePrivateResume(request(change())))).toBe('INTEGRITY_MISMATCH');
      expect((await storage.listPrivateObjects()).objects).toEqual([]);
    });

    it('an unreadable source is SOURCE_UNREADABLE and stores nothing', async () => {
      const storage = await ready();
      expect(await reasonOf(storage.storePrivateResume(request({ filePath: path.join(root, 'missing.part') })))).toBe('SOURCE_UNREADABLE');
      expect((await storage.listPrivateObjects()).objects).toEqual([]);
    });

    it.each([
      ['a relative path', { filePath: 'relative.part' }],
      ['size 0', { sizeBytes: 0 }],
      ['size over the limit', { sizeBytes: 5 * 1024 * 1024 + 1 }],
      ['an upper-case checksum', { checksumSha256: 'A'.repeat(64) }],
    ])('an invalid request (%s) is INVALID_REQUEST', async (_label, change) => {
      const storage = await ready();
      expect(await reasonOf(storage.storePrivateResume(request(change)))).toBe('INVALID_REQUEST');
    });

    it('deletes one stored object; a second delete is NOT_FOUND; stat then reports it absent', async () => {
      const storage = await ready();
      const { storageKey } = await storage.storePrivateResume(request());
      expect(await storage.deletePrivateObject(storageKey)).toEqual({ deleted: true });
      expect(await storage.deletePrivateObject(storageKey)).toEqual({ deleted: false, reason: 'NOT_FOUND' });
      expect(await storage.statPrivateObject(storageKey)).toEqual({ exists: false });
      expect(await readBack(storage, storageKey)).toBeNull();
    });

    it.each(['../etc/passwd', 'resumes/x/y', `resumes/${'a'.repeat(32)}/../${'b'.repeat(30)}`, `RESUMES/${'a'.repeat(32)}/${'b'.repeat(32)}`, '', null])(
      'refuses an invalid key (%j) for delete and stat, before touching the store',
      async (key) => {
        const storage = await ready();
        expect(await reasonOf(storage.deletePrivateObject(key))).toBe('INVALID_KEY');
        expect(await reasonOf(storage.statPrivateObject(key))).toBe('INVALID_KEY');
      },
    );

    it('a missing object: stat says absent, delete says NOT_FOUND', async () => {
      const storage = await ready();
      const key = `resumes/${'0'.repeat(32)}/${'f'.repeat(32)}`;
      expect(await storage.statPrivateObject(key)).toEqual({ exists: false });
      expect(await storage.deletePrivateObject(key)).toEqual({ deleted: false, reason: 'NOT_FOUND' });
    });

    it('lists exactly the stored objects with their sizes and times, for reconciliation', async () => {
      const storage = await ready();
      const a = await storage.storePrivateResume(request());
      const b = await storage.storePrivateResume(request());
      await storage.deletePrivateObject(a.storageKey);
      const listing = await storage.listPrivateObjects();
      expect(listing.objects.map((o) => o.storageKey)).toEqual([b.storageKey]);
      expect(listing.objects[0]).toEqual({ storageKey: b.storageKey, sizeBytes: pdf.length, modifiedAt: expect.any(Date) });
      expect(listing.partials).toEqual([]);
    });

    it('reconciliation through this driver keeps referenced and recent objects and deletes only an old orphan', async () => {
      const storage = await ready();
      const referenced = await storage.storePrivateResume(request());
      const orphan = await storage.storePrivateResume(request());
      const later = () => new Date(Date.now() + 100 * 3600 * 1000);
      const findReferencedKeys = async (keys) => new Set(keys.filter((key) => key === referenced.storageKey));
      const dry = await reconcileOrphanObjects({ storage, findReferencedKeys, clock: later });
      expect([dry.objects, dry.referenced, dry.possibleOrphans.length, dry.deleted]).toEqual([2, 1, 1, 0]);
      // Too recent at the real time: kept.
      const now = await reconcileOrphanObjects({ storage, findReferencedKeys, mode: RECONCILE_MODES.DELETE, confirmed: true });
      expect(now.possibleOrphans[0].action).toBe('KEEP_TOO_RECENT');
      const run = await reconcileOrphanObjects({ storage, findReferencedKeys, mode: RECONCILE_MODES.DELETE, confirmed: true, clock: later });
      expect(run.deleted).toBe(1);
      expect(await storage.statPrivateObject(orphan.storageKey)).toEqual({ exists: false });
      expect(await storage.statPrivateObject(referenced.storageKey)).toEqual({ exists: true, sizeBytes: pdf.length });
    });

    it('no failure message carries a key or a path', async () => {
      const storage = await ready();
      const { storageKey } = await storage.storePrivateResume(request());
      const messages = [];
      for (const call of [() => storage.storePrivateResume(request({ checksumSha256: '0'.repeat(64) })), () => storage.deletePrivateObject('../x'), () => storage.storePrivateResume(request({ filePath: path.join(root, 'missing.part') }))]) {
        try {
          await call();
        } catch (error) {
          messages.push(error.message);
        }
      }
      expect(messages).toHaveLength(3);
      for (const message of messages) {
        expect(message).not.toContain(storageKey);
        expect(message).not.toContain(root);
        expect(message).toMatch(/^private storage \w+ failed: [A-Z_]+$/);
      }
    });
  });
}
