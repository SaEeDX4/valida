import { describe, it, expect, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { storageObjectRef } from '../src/integrations/storage/storageContract.js';
import { deleteApplicationAuthorised } from '../src/ops/backup/authorisedDeletion.js';
import { appendDeletionEntry } from '../src/ops/backup/deletionLog.js';

// The log writer is replaced by a capturing stand-in (the real one is a signed PUT).
vi.mock('../src/ops/backup/deletionLog.js', () => ({ appendDeletionEntry: vi.fn() }));

/**
 * C6-T6 correction (Astra's finding) — an authorised deletion interrupted
 * after its log entry must be finishable by a retry, and a retry must never
 * remove an object that is not the one the Application recorded.
 *
 * Stand-ins: an `applications` collection, the storage driver's
 * deletePrivateObject (honouring the `expect` binding), and the log writer
 * (via a log endpoint whose appends are captured). The real driver and store
 * are exercised in tests/backup/authorised-deletion.test.js and the
 * command in e2e/c6/c6-t6-deletion-retry.mjs.
 */
const hex = (n) => randomBytes(n).toString('hex');
const key = () => `resumes/${hex(16)}/${hex(16)}`;

function world({ objectSha } = {}) {
  const id = hex(12);
  const storageKey = key();
  const resume = { storageKey, sizeBytes: 1234, checksumSha256: 'a'.repeat(64) };
  const records = new Map([[id, { _id: id, resume }]]);
  const objects = new Map([[storageKey, { sizeBytes: 1234, sha256: objectSha ?? resume.checksumSha256 }]]);
  const faults = { deleteObject: [], deleteRecord: [], append: [] };
  const appended = [];
  const storageCalls = [];
  const applications = {
    async findOne({ _id }) {
      const r = records.get(String(_id));
      return r ? structuredClone(r) : null;
    },
    async deleteOne({ _id }) {
      const fault = faults.deleteRecord.shift();
      if (fault === 'throw') throw Object.assign(new Error('qa database unavailable'), { name: 'MongoNetworkError' });
      return { deletedCount: records.delete(String(_id)) ? 1 : 0 };
    },
  };
  const storage = {
    async deletePrivateObject(storageKey, options) {
      storageCalls.push({ storageKey, expect: options?.expect ?? null });
      const fault = faults.deleteObject.shift();
      if (fault === 'throw') throw Object.assign(new Error('qa'), { name: 'PrivateStorageError', reason: 'UNAVAILABLE' });
      const present = objects.get(storageKey);
      if (!present) return { deleted: false, reason: 'NOT_FOUND' };
      const expectation = options?.expect;
      if (expectation && (present.sizeBytes !== expectation.sizeBytes || present.sha256 !== expectation.checksumSha256)) return { deleted: false, reason: 'NOT_THE_EXPECTED_OBJECT' };
      objects.delete(storageKey);
      // A lost answer: the store removed it, the caller never heard.
      if (fault === 'lose-answer') throw Object.assign(new Error('qa'), { name: 'PrivateStorageError', reason: 'OUTCOME_UNKNOWN' });
      return { deleted: true };
    },
  };
  appendDeletionEntry.mockImplementation(async (_log, entry) => {
    if (faults.append.shift() === 'throw') throw Object.assign(new Error('qa'), { name: 'BackupStoreError', reason: 'UNAVAILABLE' });
    const written = { entryId: hex(8), loggedAt: new Date().toISOString(), ...entry };
    appended.push(written);
    return written;
  });
  const run = () => deleteApplicationAuthorised({ applicationId: id, authorisation: 'QA-CORRECTION', applications, storage, log: {} });
  return { id, storageKey, resume, records, objects, faults, appended, storageCalls, run };
}

describe('authorised deletion: a partial failure is finished by a retry', () => {
  it('storage fails after the log entry: the record is KEPT; the retry removes the object, then the record', async () => {
    const w = world();
    w.faults.deleteObject.push('throw');
    const first = await w.run();
    expect(first).toMatchObject({ status: 'INCOMPLETE', object: 'UNCERTAIN', recordRemoved: false });
    expect(w.records.has(w.id)).toBe(true);
    expect(w.objects.has(w.storageKey)).toBe(true);
    expect(w.appended).toHaveLength(1);
    const retry = await w.run();
    expect(retry).toMatchObject({ status: 'COMPLETE', object: 'DELETED', recordRemoved: true, objectRef: storageObjectRef(w.storageKey) });
    expect(w.records.has(w.id)).toBe(false);
    expect(w.objects.has(w.storageKey)).toBe(false);
    // Every entry names the object, so a restore removes it whichever run it reads.
    expect(w.appended.map((e) => e.objectRef)).toEqual([storageObjectRef(w.storageKey), storageObjectRef(w.storageKey)]);
  });

  it('the deletion answer is lost: reported as UNCERTAIN, record kept; the retry sees the object absent and finishes', async () => {
    const w = world();
    w.faults.deleteObject.push('lose-answer');
    const first = await w.run();
    expect(first).toMatchObject({ status: 'INCOMPLETE', object: 'UNCERTAIN', reason: 'OUTCOME_UNKNOWN', recordRemoved: false });
    expect(w.records.has(w.id)).toBe(true);
    const retry = await w.run();
    expect(retry).toMatchObject({ status: 'COMPLETE', object: 'ABSENT', recordRemoved: true });
    expect(w.records.has(w.id)).toBe(false);
  });

  it('the database fails after the object is removed: the retry finds the record, confirms the object absent, removes the record', async () => {
    const w = world();
    w.faults.deleteRecord.push('throw');
    const first = await w.run();
    expect(first).toMatchObject({ status: 'INCOMPLETE', object: 'DELETED', recordRemoved: false, reason: 'DATABASE_UNAVAILABLE' });
    expect(w.objects.has(w.storageKey)).toBe(false);
    expect(w.records.has(w.id)).toBe(true);
    const retry = await w.run();
    expect(retry).toMatchObject({ status: 'COMPLETE', object: 'ABSENT', recordRemoved: true });
  });

  it('the log entry cannot be written: nothing is deleted', async () => {
    const w = world();
    w.faults.append.push('throw');
    await expect(w.run()).rejects.toMatchObject({ reason: 'UNAVAILABLE' });
    expect(w.records.has(w.id)).toBe(true);
    expect(w.objects.has(w.storageKey)).toBe(true);
    expect(w.storageCalls).toHaveLength(0);
  });
});

describe('authorised deletion: repeated completion, and an unrelated replacement is never removed', () => {
  it('after completion, a repeat touches nothing — not even an object later written under the same key — and logs nothing', async () => {
    const w = world();
    expect((await w.run()).status).toBe('COMPLETE');
    // An unrelated object appears under the same key afterwards.
    w.objects.set(w.storageKey, { sizeBytes: 99, sha256: 'b'.repeat(64) });
    const again = await w.run();
    expect(again).toMatchObject({ status: 'NO_RECORD', recordRemoved: false, object: 'NOT_TOUCHED' });
    expect(w.objects.get(w.storageKey)).toEqual({ sizeBytes: 99, sha256: 'b'.repeat(64) });
    expect(w.storageCalls).toHaveLength(1);
    expect(w.appended).toHaveLength(1);
  });

  it('the object under the key is not the one the record states: it is left alone and the record is kept', async () => {
    const w = world({ objectSha: 'c'.repeat(64) });
    const result = await w.run();
    expect(result).toMatchObject({ status: 'OBJECT_MISMATCH', object: 'NOT_THE_RECORDED_OBJECT', recordRemoved: false });
    expect(w.objects.has(w.storageKey)).toBe(true);
    expect(w.records.has(w.id)).toBe(true);
    // The deletion was bound to the recorded size and checksum.
    expect(w.storageCalls[0].expect).toEqual({ sizeBytes: 1234, checksumSha256: 'a'.repeat(64) });
  });

  it('the result never carries the storage key', async () => {
    const w = world();
    w.faults.deleteObject.push('throw');
    const outputs = [await w.run(), await w.run()];
    expect(JSON.stringify(outputs)).not.toContain(w.storageKey);
  });
});
