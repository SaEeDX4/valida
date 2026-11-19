import { describe, it, expect, inject, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { syntheticPdf } from '../fixtures/resumeFiles.js';
import { startFaultProxy } from '../s3/faultProxy.js';
import { loadConfig } from '../../src/config/env.js';
import { createPrivateStorage } from '../../src/integrations/storage/privateStorage.js';
import { storageObjectRef } from '../../src/integrations/storage/storageContract.js';
import { deleteApplicationAuthorised } from '../../src/ops/backup/authorisedDeletion.js';
import { readDeletionLog } from '../../src/ops/backup/deletionLog.js';
import { endpointFor, listVersions, putPrimary, readIndependently, resumeKey, sha256 } from './backupFixture.js';

/**
 * C6-T6 correction — the authorised deletion with the REAL storage driver
 * (S3PrivateStorage, the API's own token, version-bound deletes) and the
 * REAL log writer, against the moto double, faults injected by the proxy in
 * front of the store. The Application collection is a stand-in here (the
 * command against a real database: e2e/c6/c6-t6-deletion-retry.mjs).
 */
const moto = inject('backupMoto');
const B = moto.buckets;
const logWriter = endpointFor(moto, B.log, 'qa-backup-log-writer');
const logReader = endpointFor(moto, B.log, 'qa-backup-restorer');
let proxy;
let storage;

function collection(records, faults) {
  return {
    async findOne({ _id }) {
      const r = records.get(String(_id));
      return r ? structuredClone(r) : null;
    },
    async deleteOne({ _id }) {
      if (faults.shift() === 'throw') throw Object.assign(new Error('qa'), { name: 'MongoNetworkError' });
      return { deletedCount: records.delete(String(_id)) ? 1 : 0 };
    },
  };
}

async function application() {
  const id = randomBytes(12).toString('hex');
  const bytes = syntheticPdf({ text: `QA TEST DOCUMENT C6-T6 deletion ${id}` });
  const key = resumeKey();
  await putPrimary(moto, key, bytes);
  const records = new Map([[id, { _id: id, resume: { storageKey: key, sizeBytes: bytes.length, checksumSha256: sha256(bytes) } }]]);
  return { id, key, bytes, records, dbFaults: [] };
}
const run = (a) => deleteApplicationAuthorised({ applicationId: a.id, authorisation: 'QA-T6-CORRECTION', applications: collection(a.records, a.dbFaults), storage, log: logWriter });
const versionsOf = (key) => listVersions(moto, B.primary, key).filter((v) => v.key === key);
const entriesFor = async (id) => (await readDeletionLog(logReader)).filter((e) => e.applicationId === id);

beforeEach(async () => {
  proxy = await startFaultProxy({ upstream: moto.endpoint });
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_ENV: 'local',
    MONGODB_URI: 'mongodb://127.0.0.1:9/valida_test_unused',
    RESUME_STORAGE_DRIVER: 's3',
    RESUME_STORAGE_S3_ENDPOINT: proxy.endpoint,
    RESUME_STORAGE_S3_REGION: 'us-east-1',
    RESUME_STORAGE_S3_BUCKET: B.primary,
    RESUME_STORAGE_S3_ACCESS_KEY_ID: moto.users['qa-app'].accessKeyId,
    RESUME_STORAGE_S3_SECRET_ACCESS_KEY: moto.users['qa-app'].secretAccessKey,
    RESUME_STORAGE_S3_TIMEOUT_MS: '2000',
  });
  storage = createPrivateStorage({ config });
  proxy.setPlan({ '*': ['pass'] });
  await storage.init();
  proxy.log.length = 0;
});
afterEach(async () => {
  await storage?.close();
  await proxy?.close();
});

describe('authorised deletion — the real driver and log, faults at the store', () => {
  it('the store refuses the DELETE (503) after the log entry: record kept, object kept; the retry finishes', async () => {
    const a = await application();
    proxy.setPlan({ DELETE: ['status:503', 'pass'] });
    const first = await run(a);
    expect(first).toMatchObject({ status: 'INCOMPLETE', object: 'UNCERTAIN', recordRemoved: false });
    expect(a.records.has(a.id)).toBe(true);
    expect(versionsOf(a.key)).toHaveLength(1);
    const retry = await run(a);
    expect(retry).toMatchObject({ status: 'COMPLETE', object: 'DELETED', recordRemoved: true });
    expect(versionsOf(a.key)).toEqual([]); // no version and no delete marker: removed by version
    expect((await entriesFor(a.id)).map((e) => e.objectRef)).toEqual([storageObjectRef(a.key), storageObjectRef(a.key)]);
  });

  it('the DELETE happens but its answer is lost: UNCERTAIN, record kept; the retry sees 404 and finishes', async () => {
    const a = await application();
    proxy.setPlan({ DELETE: ['lose-answer', 'pass'] });
    const first = await run(a);
    expect(first).toMatchObject({ status: 'INCOMPLETE', object: 'UNCERTAIN', recordRemoved: false });
    expect(versionsOf(a.key)).toEqual([]); // it did happen
    expect(a.records.has(a.id)).toBe(true);
    const retry = await run(a);
    expect(retry).toMatchObject({ status: 'COMPLETE', object: 'ABSENT', recordRemoved: true });
  });

  it('the database fails after the object is removed: the retry confirms the object absent and removes the record', async () => {
    const a = await application();
    a.dbFaults.push('throw');
    const first = await run(a);
    expect(first).toMatchObject({ status: 'INCOMPLETE', object: 'DELETED', reason: 'DATABASE_UNAVAILABLE', recordRemoved: false });
    const retry = await run(a);
    expect(retry).toMatchObject({ status: 'COMPLETE', object: 'ABSENT', recordRemoved: true });
    expect(a.records.size).toBe(0);
  });

  it('repeated completion touches nothing; an unrelated object later written under the same key survives', async () => {
    const a = await application();
    expect((await run(a)).status).toBe('COMPLETE');
    const unrelated = syntheticPdf({ text: 'QA TEST DOCUMENT C6-T6 an unrelated replacement' });
    await putPrimary(moto, a.key, unrelated);
    const entriesBefore = (await entriesFor(a.id)).length;
    proxy.log.length = 0;
    const again = await run(a);
    expect(again).toMatchObject({ status: 'NO_RECORD', object: 'NOT_TOUCHED' });
    expect(proxy.log.filter((e) => e.method === 'DELETE')).toEqual([]);
    expect(readIndependently(moto, B.primary, a.key).equals(unrelated)).toBe(true);
    expect((await entriesFor(a.id)).length).toBe(entriesBefore);
  });

  it('a record whose key now holds a different object: that object is not removed (bound on the same HEAD as the DELETE), the record is kept', async () => {
    const a = await application();
    // The key now holds other bytes (every version of the original removed, then a new one written).
    for (const v of versionsOf(a.key)) await storage.deletePrivateObject(a.key); // eslint-disable-line no-await-in-loop
    const other = syntheticPdf({ text: 'QA TEST DOCUMENT C6-T6 not the recorded object' });
    await putPrimary(moto, a.key, other);
    proxy.log.length = 0;
    const result = await run(a);
    expect(result).toMatchObject({ status: 'OBJECT_MISMATCH', object: 'NOT_THE_RECORDED_OBJECT', recordRemoved: false });
    expect(proxy.log.filter((e) => e.method === 'DELETE')).toEqual([]);
    expect(readIndependently(moto, B.primary, a.key).equals(other)).toBe(true);
    expect(a.records.has(a.id)).toBe(true);
  });

  it('nothing returned names the storage key', async () => {
    const a = await application();
    proxy.setPlan({ DELETE: ['status:503', 'pass'] });
    const outputs = [await run(a), await run(a), await run(a)];
    expect(JSON.stringify(outputs)).not.toContain(a.key);
  });
});
