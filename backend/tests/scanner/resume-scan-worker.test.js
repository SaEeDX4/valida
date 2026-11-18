import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoPrivateStorage, RESUME_FILES_COLLECTION } from '../../src/integrations/storage/mongoPrivateStorage.js';
import { SCAN_ATTEMPTS_COLLECTION, attemptId } from '../../src/modules/applications/resume/scanQueue.js';
import { syntheticDocx, syntheticPdf } from '../fixtures/resumeFiles.js';
import { requireTestDatabase } from '../db/testDatabase.js';

/**
 * Proposed (MongoDB-native r2, finding 3) — scripts/resume-scan.mjs as a
 * separate process, against the REAL clamd and a real MongoDB: one batch,
 * oldest first; verdicts recorded; already-decided résumés untouched; with the
 * scanner unusable NOTHING is recorded and the run fails visibly.
 */
const run = promisify(execFile);
const { uri: TEST_URI, databaseName: DB } = requireTestDatabase();
const { MongoClient, ObjectId } = mongoose.mongo;
const SCRIPT = path.resolve('scripts/resume-scan.mjs');
const CLAMD_PORT = String(process.env.CLAMD_TEST_PORT ?? 3310);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const EICAR = Buffer.from(['X5O!P%@AP[4\\PZX54(P^)7CC)7}', '$EICAR-STANDARD-ANTIVIRUS-', 'TEST-FILE!$H+H*'].join(''), 'latin1');
let client;
let db;
let storage;
let tmp;

async function seed(bytes, scanStatus, storedAt) {
  const file = path.join(tmp, randomBytes(6).toString('hex'));
  fs.writeFileSync(file, bytes);
  const s = await storage.storePrivateResume({ filePath: file, sizeBytes: bytes.length, checksumSha256: sha256(bytes) });
  const _id = new ObjectId();
  await db.collection('applications').insertOne({ _id, idempotency: { keyHash: randomBytes(32).toString('hex') }, resume: { storageProvider: s.storageProvider, storageKey: s.storageKey, sizeBytes: s.sizeBytes, checksumSha256: s.checksumSha256, originalFilename: 'qa.pdf', extension: '.pdf', mimeType: 'application/pdf', scanStatus, scanCheckedAt: null, storedAt } });
  return String(_id);
}
async function worker(env) {
  try {
    const { stdout } = await run(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH, RESUME_SCANNER_MONGODB_URI: TEST_URI, CLAMD_PORT, ...env }, timeout: 60_000 });
    return { code: 0, out: JSON.parse(stdout.trim()), raw: stdout };
  } catch (error) {
    return { code: error.code, out: error.stdout?.trim() ? JSON.parse(error.stdout.trim()) : null, raw: `${error.stdout}${error.stderr}` };
  }
}
const status = async (id) => (await db.collection('applications').findOne({ _id: new ObjectId(id) })).resume.scanStatus;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-scanw-'));
  client = new MongoClient(TEST_URI);
  await client.connect();
  db = client.db(DB);
  storage = new MongoPrivateStorage({ uri: TEST_URI });
  await storage.init();
});
afterAll(async () => {
  await db.collection('applications').deleteMany({});
  await db.collection(RESUME_FILES_COLLECTION).deleteMany({});
  await db.collection(SCAN_ATTEMPTS_COLLECTION).deleteMany({});
  await storage.close();
  await client.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
  await db.collection('applications').deleteMany({});
  await db.collection(RESUME_FILES_COLLECTION).deleteMany({});
  await db.collection(SCAN_ATTEMPTS_COLLECTION).deleteMany({});
});

describe('resume-scan.mjs (separate process, real clamd)', () => {
  it('scans new résumés oldest first, records CLEAN / QUARANTINED, leaves decided ones alone, prints no key or URI', async () => {
    const base = Date.now() - 30 * 60_000; // recent: under the 120-minute backlog alert
    const t = (m) => new Date(base + m * 60_000);
    const benign = await seed(syntheticPdf(), 'NOT_SCANNED', t(1));
    const eicar = await seed(EICAR, 'NOT_SCANNED', t(2));
    const docx = await seed(syntheticDocx(), 'PENDING', t(3));
    const decided = await seed(syntheticPdf(), 'CLEAN', t(0));
    const later = await seed(syntheticPdf(), 'NOT_SCANNED', t(9));
    const r = await worker({ SCANNER_BATCH_SIZE: '3' });
    expect(r.code).toBe(0);
    expect(r.out).toMatchObject({ run: { selected: 3, newSelected: 3, clean: 2, quarantined: 1, failed: 0 }, scanner: { engine: expect.stringMatching(/^\d+\.\d+\.\d+$/) } });
    expect([await status(benign), await status(eicar), await status(docx), await status(decided), await status(later)]).toEqual(['CLEAN', 'QUARANTINED', 'CLEAN', 'CLEAN', 'NOT_SCANNED']);
    expect(r.raw).not.toMatch(/resumes\/|mongodb:\/\/|qa\.pdf/);
  });

  it('scanner unusable (unreachable) -> exit 1, NOTHING recorded: the résumés stay unscanned and held', async () => {
    const closed = net.createServer();
    await new Promise((res) => closed.listen(0, '127.0.0.1', res));
    const port = String(closed.address().port);
    await new Promise((res) => closed.close(res));
    const id = await seed(syntheticPdf(), 'NOT_SCANNED', new Date());
    const r = await worker({ CLAMD_PORT: port });
    expect(r.code).toBe(1);
    expect(r.out).toMatchObject({ scanner: { unusable: 'UNAVAILABLE' }, run: null });
    expect(await status(id)).toBe('NOT_SCANNED');
    expect(await db.collection('applications').countDocuments({ 'resume.scanCheckedAt': { $ne: null } })).toBe(0);
  });

  it('a FAILED résumé is retried only when its attempts record says it is due', async () => {
    const id = await seed(syntheticPdf(), 'FAILED', new Date());
    const a = await db.collection('applications').findOne({ _id: new ObjectId(id) });
    const _id = attemptId(id, a.resume.checksumSha256);
    await db.collection(SCAN_ATTEMPTS_COLLECTION).insertOne({ _id, applicationId: a._id, storageKey: a.resume.storageKey, checksumSha256: a.resume.checksumSha256, attempts: 1, infraFailures: 0, lastAttemptAt: new Date(), nextAttemptAt: new Date(Date.now() + 30 * 60_000), lastFailure: 'TIMEOUT', exhausted: false, resolved: false, leaseUntil: null, leaseOwner: null });
    expect((await worker({})).out.run).toMatchObject({ selected: 0 });
    await db.collection(SCAN_ATTEMPTS_COLLECTION).updateOne({ _id }, { $set: { nextAttemptAt: new Date(Date.now() - 1000) } });
    expect((await worker({})).out.run).toMatchObject({ selected: 1, retrySelected: 1, clean: 1 });
    expect(await status(id)).toBe('CLEAN');
  });

  it('a FAILED résumé with no attempts record (failed before the queue existed) is a due retry', async () => {
    const id = await seed(syntheticPdf(), 'FAILED', new Date());
    expect((await worker({})).out.run).toMatchObject({ selected: 1, retrySelected: 1, clean: 1 });
    expect(await status(id)).toBe('CLEAN');
  });

  it('refuses incomplete or malformed configuration (exit 2), naming the variable only', async () => {
    expect((await worker({ RESUME_SCANNER_MONGODB_URI: '' })).code).toBe(2);
    const bad = await worker({ CLAMD_PORT: '99999' });
    expect(bad.code).toBe(2);
    expect(bad.raw).toMatch(/CLAMD_PORT/);
    for (const [name, value] of [['SCANNER_MAX_ATTEMPTS', '0'], ['SCANNER_NEW_SHARE_PERCENT', '101'], ['SCANNER_BACKOFF_CAP_MINUTES', '1'], ['SCANNER_BACKLOG_MAX_AGE_MINUTES', 'x']]) {
      const r = await worker({ [name]: value, ...(name === 'SCANNER_BACKOFF_CAP_MINUTES' ? { SCANNER_BACKOFF_BASE_MINUTES: '10' } : {}) });
      expect(r.code, name).toBe(2);
      expect(r.raw).toMatch(new RegExp(name));
    }
  });
});
