import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoPrivateStorage, RESUME_FILES_COLLECTION } from '../../src/integrations/storage/mongoPrivateStorage.js';
import { generateResumeStorageKey } from '../../src/integrations/storage/storageContract.js';
import { recordScanResult, retrieveResumeForReview, scanApplicationResume } from '../../src/modules/applications/resume/resumeSecurity.js';
import { syntheticPdf } from '../fixtures/resumeFiles.js';
import { requireTestDatabase } from './testDatabase.js';

/**
 * Proposed (MongoDB-native launch change) — real MongoDB, synthetic data only.
 *
 * LOCAL EVIDENCE: a single local mongod. What only real Atlas (Flex) can show —
 * replica-set majority/journal acknowledgement, snapshot restore, custom-role
 * enforcement in Atlas — is listed in the decision sheet as a Review check.
 */
const { uri: TEST_URI, databaseName: DB } = requireTestDatabase();
const { MongoClient, Binary, ObjectId } = mongoose.mongo;
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
let client;
let db;
let restoredDb;
let tmp;

const APPS = 'qa_mn_applications';

function tempFile(bytes) {
  const file = path.join(tmp, randomBytes(8).toString('hex'));
  fs.writeFileSync(file, bytes);
  return file;
}

async function readyStorage(options = {}) {
  const storage = new MongoPrivateStorage({ uri: TEST_URI, ...options });
  await storage.init();
  return storage;
}

/** A client whose resume_files collection injects faults around a real collection. */
function faultyClientFactory(faults) {
  return (uri) => {
    const real = new MongoClient(uri);
    return {
      connect: () => real.connect(),
      close: () => real.close(),
      db: () => ({
        collection: (name) => {
          const c = real.db().collection(name);
          return new Proxy(c, {
            get(target, prop) {
              if (prop === 'insertOne') {
                return async (doc, opts) => {
                  // A store that silently overwrites (no unique _id) would ACK the probe's second insert.
                  if (doc.probe && doc.attempt === 'overwrite' && faults.probeOverwriteAcked) return { acknowledged: true, insertedId: doc._id };
                  const f = doc.probe ? null : faults.insert.shift();
                  // An acknowledgement for a write that did not happen (a lying or misrouted ACK).
                  if (f === 'ack-without-write') return { acknowledged: true, insertedId: doc._id };
                  if (f === 'network-before') throw Object.assign(new Error('qa'), { name: 'MongoNetworkError' });
                  const r = await target.insertOne(doc, opts);
                  if (f === 'network-after') throw Object.assign(new Error('qa'), { name: 'MongoNetworkError' });
                  return r;
                };
              }
              if (prop === 'findOne') {
                return async (...args) => {
                  if (faults.find.shift() === 'fail') throw Object.assign(new Error('qa'), { name: 'MongoNetworkError' });
                  return target.findOne(...args);
                };
              }
              const v = target[prop];
              return typeof v === 'function' ? v.bind(target) : v;
            },
          });
        },
      }),
    };
  };
}

beforeAll(async () => {
  client = new MongoClient(TEST_URI);
  await client.connect();
  db = client.db(DB);
  restoredDb = client.db(`${DB}_mnrestored`);
  expect(DB).toMatch(/^valida_test/);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-mn-'));
});
afterAll(async () => {
  await db.collection(RESUME_FILES_COLLECTION).deleteMany({});
  await db.collection(APPS).drop().catch(() => {});
  await restoredDb.dropDatabase();
  await client.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
  await db.collection(RESUME_FILES_COLLECTION).deleteMany({});
  await db.collection(APPS).deleteMany({});
});

describe('MongoPrivateStorage: upload, integrity, immutability', () => {
  it('init proves the store (probe written, read back, overwrite refused, deleted) and leaves nothing', async () => {
    const storage = await readyStorage();
    expect(storage.isReady).toBe(true);
    expect(await db.collection(RESUME_FILES_COLLECTION).countDocuments({})).toBe(0);
    await storage.close();
  });

  it('stores one immutable document per version; the bytes are exact; no URL, no key in the result beyond the record fields', async () => {
    const storage = await readyStorage();
    const pdf = syntheticPdf();
    const stored = await storage.storePrivateResume({ filePath: tempFile(pdf), sizeBytes: pdf.length, checksumSha256: sha256(pdf) });
    expect(Object.keys(stored).sort()).toEqual(['checksumSha256', 'sizeBytes', 'storageKey', 'storageProvider', 'storedAt']);
    expect(stored.storageProvider).toBe('MONGODB');
    const doc = await db.collection(RESUME_FILES_COLLECTION).findOne({ _id: stored.storageKey });
    expect(sha256(Buffer.from(doc.data.buffer))).toBe(sha256(pdf));
    expect(doc.sizeBytes).toBe(pdf.length);
    const read = await storage.readPrivateObject(stored.storageKey, { expect: { sizeBytes: pdf.length, checksumSha256: sha256(pdf) } });
    expect(read.found && read.bytes.equals(pdf)).toBe(true);
    await storage.close();
  });

  it('upload validation: a file that does not match its validated size or checksum stores NOTHING; over 5 MiB is refused', async () => {
    const storage = await readyStorage();
    const pdf = syntheticPdf();
    await expect(storage.storePrivateResume({ filePath: tempFile(pdf), sizeBytes: pdf.length, checksumSha256: sha256(Buffer.from('other')) })).rejects.toMatchObject({ reason: 'INTEGRITY_MISMATCH' });
    await expect(storage.storePrivateResume({ filePath: tempFile(pdf), sizeBytes: pdf.length + 1, checksumSha256: sha256(pdf) })).rejects.toMatchObject({ reason: 'INTEGRITY_MISMATCH' });
    await expect(storage.storePrivateResume({ filePath: tempFile(pdf), sizeBytes: 5 * 1024 * 1024 + 1, checksumSha256: sha256(pdf) })).rejects.toMatchObject({ reason: 'INVALID_REQUEST' });
    expect(await db.collection(RESUME_FILES_COLLECTION).countDocuments({})).toBe(0);
    await storage.close();
  });

  it('a 5 MiB résumé (the approved maximum) is one document, well under the 16 MiB BSON limit', async () => {
    const storage = await readyStorage();
    const big = Buffer.concat([syntheticPdf(), randomBytes(5 * 1024 * 1024 - syntheticPdf().length)]);
    const stored = await storage.storePrivateResume({ filePath: tempFile(big), sizeBytes: big.length, checksumSha256: sha256(big) });
    const [{ size }] = await db.collection(RESUME_FILES_COLLECTION).aggregate([{ $match: { _id: stored.storageKey } }, { $project: { size: { $bsonSize: '$$ROOT' } } }]).toArray();
    expect(size).toBeGreaterThan(5 * 1024 * 1024);
    expect(size).toBeLessThan(16 * 1024 * 1024);
    await storage.close();
  });

  it('no overwrite: a key collision is retried under a NEW key; the existing version is untouched', async () => {
    const fixed = generateResumeStorageKey();
    const keys = [fixed, fixed, generateResumeStorageKey()];
    let probeKey = true;
    const storage = await readyStorage({ generateKey: () => (probeKey ? ((probeKey = false), generateResumeStorageKey()) : keys.shift()) });
    const a = syntheticPdf();
    const b = Buffer.concat([syntheticPdf(), Buffer.from('%QA second\n')]);
    const first = await storage.storePrivateResume({ filePath: tempFile(a), sizeBytes: a.length, checksumSha256: sha256(a) });
    const second = await storage.storePrivateResume({ filePath: tempFile(b), sizeBytes: b.length, checksumSha256: sha256(b) });
    expect(first.storageKey).toBe(fixed);
    expect(second.storageKey).not.toBe(fixed);
    const kept = await db.collection(RESUME_FILES_COLLECTION).findOne({ _id: fixed });
    expect(sha256(Buffer.from(kept.data.buffer))).toBe(sha256(a));
    await storage.close();
  });
});

describe('MongoPrivateStorage: interrupted writes', () => {
  it('network error AFTER the insert: resolved by reading back the attempt marker -> stored once', async () => {
    const faults = { insert: ['network-after'], find: [] };
    const storage = await readyStorage({ clientFactory: faultyClientFactory(faults) });
    const pdf = syntheticPdf();
    const stored = await storage.storePrivateResume({ filePath: tempFile(pdf), sizeBytes: pdf.length, checksumSha256: sha256(pdf) });
    expect(await db.collection(RESUME_FILES_COLLECTION).countDocuments({})).toBe(1);
    expect(await db.collection(RESUME_FILES_COLLECTION).countDocuments({ _id: stored.storageKey })).toBe(1);
    await storage.close();
  });

  it('network error BEFORE the insert: nothing stored -> retried under a new key -> stored once', async () => {
    const faults = { insert: ['network-before'], find: [] };
    const storage = await readyStorage({ clientFactory: faultyClientFactory(faults) });
    const pdf = syntheticPdf();
    await storage.storePrivateResume({ filePath: tempFile(pdf), sizeBytes: pdf.length, checksumSha256: sha256(pdf) });
    expect(await db.collection(RESUME_FILES_COLLECTION).countDocuments({})).toBe(1);
    await storage.close();
  });

  it('an acknowledged insert whose bytes cannot be read back is never reported as stored (INTEGRITY_MISMATCH)', async () => {
    const faults = { insert: ['ack-without-write'], find: [] };
    const storage = await readyStorage({ clientFactory: faultyClientFactory(faults) });
    const pdf = syntheticPdf();
    await expect(storage.storePrivateResume({ filePath: tempFile(pdf), sizeBytes: pdf.length, checksumSha256: sha256(pdf) })).rejects.toMatchObject({ reason: 'INTEGRITY_MISMATCH' });
    expect(await db.collection(RESUME_FILES_COLLECTION).countDocuments({})).toBe(0);
    await storage.close();
  });

  it("mode 'deletion' (the operator's store) proves read access only, writes no probe, and refuses to store", async () => {
    const storage = new MongoPrivateStorage({ uri: TEST_URI, mode: 'deletion' });
    await storage.init();
    expect(await db.collection(RESUME_FILES_COLLECTION).countDocuments({})).toBe(0);
    const pdf = syntheticPdf();
    await expect(storage.storePrivateResume({ filePath: tempFile(pdf), sizeBytes: pdf.length, checksumSha256: sha256(pdf) })).rejects.toMatchObject({ reason: 'PERMISSION_DENIED' });
    expect(await db.collection(RESUME_FILES_COLLECTION).countDocuments({})).toBe(0);
    await storage.close();
  });

  it('init refuses a store that does not refuse an overwrite of an existing key (PROBE_MISMATCH) and leaves no probe', async () => {
    const storage = new MongoPrivateStorage({ uri: TEST_URI, clientFactory: faultyClientFactory({ insert: [], find: [], probeOverwriteAcked: true }) });
    await expect(storage.init()).rejects.toMatchObject({ reason: 'PROBE_MISMATCH' });
    expect(await db.collection(RESUME_FILES_COLLECTION).countDocuments({})).toBe(0);
    await storage.close().catch(() => {});
  });

  it('outcome unknowable (insert and read-back both fail): OUTCOME_UNKNOWN, never a claimed success', async () => {
    const faults = { insert: ['network-after'], find: ['ok', 'fail'] };
    const storage = await readyStorage({ clientFactory: faultyClientFactory(faults) });
    const pdf = syntheticPdf();
    await expect(storage.storePrivateResume({ filePath: tempFile(pdf), sizeBytes: pdf.length, checksumSha256: sha256(pdf) })).rejects.toMatchObject({ reason: 'OUTCOME_UNKNOWN' });
    await storage.close();
  });
});

describe('MongoPrivateStorage: exact-version deletion', () => {
  it('deletes only the recorded version; another version under the key is left alone; absent is NOT_FOUND', async () => {
    const storage = await readyStorage();
    const pdf = syntheticPdf();
    const s = await storage.storePrivateResume({ filePath: tempFile(pdf), sizeBytes: pdf.length, checksumSha256: sha256(pdf) });
    expect(await storage.deletePrivateObject(s.storageKey, { expect: { sizeBytes: pdf.length, checksumSha256: sha256(Buffer.from('x')) } })).toEqual({ deleted: false, reason: 'NOT_THE_EXPECTED_OBJECT' });
    expect(await storage.deletePrivateObject(s.storageKey, { expect: { sizeBytes: pdf.length + 1, checksumSha256: sha256(pdf) } })).toEqual({ deleted: false, reason: 'NOT_THE_EXPECTED_OBJECT' });
    expect(await db.collection(RESUME_FILES_COLLECTION).countDocuments({ _id: s.storageKey })).toBe(1);
    expect(await storage.deletePrivateObject(s.storageKey, { expect: { sizeBytes: pdf.length, checksumSha256: sha256(pdf) } })).toEqual({ deleted: true });
    expect(await storage.deletePrivateObject(s.storageKey, { expect: { sizeBytes: pdf.length, checksumSha256: sha256(pdf) } })).toEqual({ deleted: false, reason: 'NOT_FOUND' });
    await storage.close();
  });
});

/** An Application-shaped record bound to a stored version (synthetic). */
async function application(storage, { scanStatus = 'NOT_SCANNED', bytes = syntheticPdf() } = {}) {
  const s = await storage.storePrivateResume({ filePath: tempFile(bytes), sizeBytes: bytes.length, checksumSha256: sha256(bytes) });
  const _id = new ObjectId();
  await db.collection(APPS).insertOne({ _id, resume: { storageProvider: s.storageProvider, storageKey: s.storageKey, sizeBytes: s.sizeBytes, checksumSha256: s.checksumSha256, originalFilename: 'qa-resume.pdf', extension: '.pdf', mimeType: 'application/pdf', scanStatus, scanCheckedAt: null, storedAt: s.storedAt } });
  return { id: String(_id), stored: s, bytes };
}

describe('scan-result binding, quarantine and private HR retrieval (service; the Admin route is Phase 3)', () => {
  const scanner = (verdict) => ({ name: 'qa-scanner', scan: async () => (verdict === 'throw' ? Promise.reject(new Error('qa')) : { verdict, signatureVersion: 'qa-sig-1' }) });

  it('no scan: NOT_SCANNED is never released; a result for other bytes is refused (BINDING_MISMATCH)', async () => {
    const storage = await readyStorage();
    const app = await application(storage);
    const audit = [];
    expect(await retrieveResumeForReview({ applications: db.collection(APPS), storage, applicationId: app.id, audit: async (e) => audit.push(e) })).toEqual({ released: false, reason: 'NOT_RELEASABLE', scanStatus: 'NOT_SCANNED' });
    const other = { ...app.stored, checksumSha256: sha256(Buffer.from('not the stored bytes')) };
    expect(await recordScanResult({ applications: db.collection(APPS), applicationId: app.id, scanned: other, verdict: 'CLEAN', scanner: { name: 'qa', signatureVersion: '1' } })).toEqual({ recorded: false, reason: 'BINDING_MISMATCH' });
    expect((await db.collection(APPS).findOne({})).resume.scanStatus).toBe('NOT_SCANNED');
    await expect(recordScanResult({ applications: db.collection(APPS), applicationId: app.id, scanned: app.stored, verdict: 'CLEAN' })).rejects.toThrow(/scanner name/);
    expect(audit).toEqual([]);
    await storage.close();
  });

  it('a scanner failure is FAILED, never CLEAN', async () => {
    const storage = await readyStorage();
    const app = await application(storage);
    expect(await scanApplicationResume({ applications: db.collection(APPS), storage, scanner: scanner('throw'), applicationId: app.id })).toMatchObject({ recorded: true, scanStatus: 'FAILED' });
    expect((await db.collection(APPS).findOne({})).resume.scanCheckedAt).toBeInstanceOf(Date);
    await storage.close();
  });

  it('CLEAN, bound to the scanned bytes, is released with safe headers, and only after the audit is written', async () => {
    const storage = await readyStorage();
    const app = await application(storage);
    expect(await scanApplicationResume({ applications: db.collection(APPS), storage, scanner: scanner('CLEAN'), applicationId: app.id })).toMatchObject({ recorded: true, scanStatus: 'CLEAN' });
    const order = [];
    const out = await retrieveResumeForReview({ applications: db.collection(APPS), storage, applicationId: app.id, audit: async (e) => order.push(e.event) });
    expect(out.released).toBe(true);
    expect(out.bytes.equals(app.bytes)).toBe(true);
    expect(out.headers).toMatchObject({ 'Content-Disposition': 'attachment', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
    expect(order).toEqual(['RESUME_ACCESSED']);
    // An audit failure releases nothing.
    await expect(retrieveResumeForReview({ applications: db.collection(APPS), storage, applicationId: app.id, audit: async () => { throw new Error('qa audit down'); } })).rejects.toThrow('qa audit down');
    await storage.close();
  });

  it('quarantine: an infected result is QUARANTINED, not released, and no later result makes it CLEAN', async () => {
    const storage = await readyStorage();
    const app = await application(storage);
    expect(await scanApplicationResume({ applications: db.collection(APPS), storage, scanner: scanner('INFECTED'), applicationId: app.id })).toMatchObject({ recorded: true, scanStatus: 'QUARANTINED' });
    expect(await retrieveResumeForReview({ applications: db.collection(APPS), storage, applicationId: app.id, audit: async () => {} })).toMatchObject({ released: false, reason: 'NOT_RELEASABLE', scanStatus: 'QUARANTINED' });
    expect(await recordScanResult({ applications: db.collection(APPS), applicationId: app.id, scanned: app.stored, verdict: 'CLEAN', scanner: { name: 'qa', signatureVersion: '2' } })).toMatchObject({ recorded: false, reason: 'TRANSITION_REFUSED', scanStatus: 'QUARANTINED' });
    expect(await db.collection(RESUME_FILES_COLLECTION).countDocuments({ _id: app.stored.storageKey })).toBe(1); // kept, private, traceable
    await storage.close();
  });

  it('bytes altered in the store after the scan are never released (INTEGRITY_MISMATCH)', async () => {
    const storage = await readyStorage();
    const app = await application(storage, { scanStatus: 'CLEAN' });
    const altered = Buffer.from(app.bytes);
    altered[altered.length - 2] ^= 0xff;
    await db.collection(RESUME_FILES_COLLECTION).updateOne({ _id: app.stored.storageKey }, { $set: { data: new Binary(altered) } });
    await expect(retrieveResumeForReview({ applications: db.collection(APPS), storage, applicationId: app.id, audit: async () => {} })).rejects.toMatchObject({ reason: 'INTEGRITY_MISMATCH' });
    await storage.close();
  });
});

// r2: authorised deletion and the restore gate moved to tests/recovery/ (the durable journal and the
// positively identified restore target need the moto double and two replica sets).
