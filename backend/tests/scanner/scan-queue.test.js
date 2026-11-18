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
import { createClamdScanner, ScannerError } from '../../src/integrations/scanner/clamdScanner.js';
import { retrieveResumeForReview } from '../../src/modules/applications/resume/resumeSecurity.js';
import { SCAN_ATTEMPTS_COLLECTION, attemptId, backlog, runScanBatch } from '../../src/modules/applications/resume/scanQueue.js';
import { syntheticPdf } from '../fixtures/resumeFiles.js';
import { requireTestDatabase } from '../db/testDatabase.js';

/**
 * Proposed (MongoDB-native r3) — the scan queue is starvation-free and bounded,
 * against the REAL clamd and a real MongoDB replica set:
 *   - an old batch that fails on every run (its stored bytes are altered, so
 *     every attempt is INTEGRITY_MISMATCH — a real, deterministic failure)
 *     never keeps a NEW clean submission from being scanned in the next run;
 *   - failed résumés stay FAILED and are never released;
 *   - retries follow the exponential backoff and stop at the bound (EXHAUSTED);
 *   - the backlog alert (exit 3) fires for an exhausted item or a stale backlog;
 *   - a scanner outage records nothing (before the batch) or opens the circuit
 *     after one item (during the batch) without charging file attempts;
 *   - two concurrent workers never scan or record the same item twice.
 * Synthetic data only.
 */
const run = promisify(execFile);
const { uri: TEST_URI, databaseName: DB } = requireTestDatabase();
const { MongoClient, ObjectId } = mongoose.mongo;
const SCRIPT = path.resolve('scripts/resume-scan.mjs');
const CLAMD_PORT = Number(process.env.CLAMD_TEST_PORT ?? 3310);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
let client;
let db;
let storage;
let scanner;
let tmp;
const apps = () => db.collection('applications');
const attempts = () => db.collection(SCAN_ATTEMPTS_COLLECTION);
const T0 = new Date(Date.UTC(2026, 10, 18, 12, 0));
const at = (min) => new Date(T0.getTime() + min * 60_000);

async function seed({ storedAt, scanStatus = 'NOT_SCANNED', corrupt = false } = {}) {
  const bytes = Buffer.concat([syntheticPdf(), Buffer.from(`%qa-${randomBytes(4).toString('hex')}`)]);
  const file = path.join(tmp, randomBytes(6).toString('hex'));
  fs.writeFileSync(file, bytes);
  const s = await storage.storePrivateResume({ filePath: file, sizeBytes: bytes.length, checksumSha256: sha256(bytes) });
  const _id = new ObjectId();
  await apps().insertOne({ _id, idempotency: { keyHash: randomBytes(32).toString('hex') }, resume: { storageProvider: s.storageProvider, storageKey: s.storageKey, sizeBytes: s.sizeBytes, checksumSha256: s.checksumSha256, originalFilename: 'qa.pdf', extension: '.pdf', mimeType: 'application/pdf', scanStatus, scanCheckedAt: null, storedAt } });
  if (corrupt) {
    // Test side: the stored bytes no longer match the record, so EVERY scan attempt fails (INTEGRITY_MISMATCH).
    const flipped = Buffer.from(bytes);
    flipped[flipped.length - 1] ^= 0xff;
    await db.collection(RESUME_FILES_COLLECTION).updateOne({ _id: s.storageKey }, { $set: { data: new mongoose.mongo.Binary(flipped) } });
  }
  return String(_id);
}
const status = async (id) => (await apps().findOne({ _id: new ObjectId(id) })).resume.scanStatus;
const attemptOf = async (id) => {
  const a = await apps().findOne({ _id: new ObjectId(id) });
  return attempts().findOne({ _id: attemptId(id, a.resume.checksumSha256) });
};
async function worker(env) {
  try {
    const { stdout } = await run(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH, RESUME_SCANNER_MONGODB_URI: TEST_URI, CLAMD_PORT: String(CLAMD_PORT), ...env }, timeout: 60_000 });
    return { code: 0, out: JSON.parse(stdout.trim()), raw: stdout };
  } catch (error) {
    return { code: error.code, out: error.stdout?.trim() ? JSON.parse(error.stdout.trim()) : null, raw: `${error.stdout}${error.stderr}` };
  }
}
const batch = (now, options) => runScanBatch({ applications: apps(), attempts: attempts(), storage, scanner, now: () => now, options });

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-scanq-'));
  client = new MongoClient(TEST_URI);
  await client.connect();
  db = client.db(DB);
  storage = new MongoPrivateStorage({ uri: TEST_URI });
  await storage.init();
  scanner = createClamdScanner({ host: '127.0.0.1', port: CLAMD_PORT, maxSignatureAgeHours: 48 });
});
afterAll(async () => {
  for (const c of ['applications', RESUME_FILES_COLLECTION, SCAN_ATTEMPTS_COLLECTION]) await db.collection(c).deleteMany({});
  await storage.close();
  await client.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
  for (const c of ['applications', RESUME_FILES_COLLECTION, SCAN_ATTEMPTS_COLLECTION]) await db.collection(c).deleteMany({});
});

describe('starvation-free selection (real clamd)', () => {
  it('a new clean submission is scanned in the next run while an older batch fails on every run', async () => {
    const options = { batchSize: 4, newShare: 0.5, maxAttempts: 50, backoffBaseMinutes: 1, backoffCapMinutes: 1 };
    const old = [];
    for (let i = 0; i < 10; i += 1) old.push(await seed({ storedAt: at(-600 + i), corrupt: true }));
    // Five runs with only the failing batch: each run fills its batch with them; they fail and come due again.
    for (let r = 0; r < 5; r += 1) {
      const s = await batch(at(r * 2), options);
      expect(s).toMatchObject({ selected: 4, clean: 0, failed: 4, failures: { INTEGRITY_MISMATCH: 4 } });
    }
    // A new, clean submission arrives — the newest résumé of all.
    const fresh = await seed({ storedAt: at(10) });
    const s = await batch(at(12), options);
    expect(s).toMatchObject({ selected: 4, newSelected: 1, retrySelected: 3, clean: 1, failed: 3 });
    expect(await status(fresh)).toBe('CLEAN'); // by the REAL clamd, in the first run after it arrived
    // Every old résumé is still FAILED and held: never released.
    for (const id of old) {
      expect(await status(id)).toBe('FAILED');
      const r = await retrieveResumeForReview({ applications: apps(), storage, applicationId: id, audit: async () => {} });
      expect(r).toMatchObject({ released: false, reason: 'NOT_RELEASABLE', scanStatus: 'FAILED' });
    }
  });

  it('the worker process (one run, real clamd): new work is taken first even when more retries are due than the batch holds', async () => {
    const old = [];
    for (let i = 0; i < 6; i += 1) old.push(await seed({ storedAt: new Date(Date.now() - (60 - i) * 60_000), corrupt: true }));
    // They have already failed and are due again now.
    for (const id of old) {
      const a = await apps().findOne({ _id: new ObjectId(id) });
      await apps().updateOne({ _id: a._id }, { $set: { 'resume.scanStatus': 'FAILED', 'resume.scanCheckedAt': new Date() } });
      await attempts().insertOne({ _id: attemptId(id, a.resume.checksumSha256), applicationId: a._id, storageKey: a.resume.storageKey, checksumSha256: a.resume.checksumSha256, attempts: 1, infraFailures: 0, lastAttemptAt: new Date(), nextAttemptAt: new Date(Date.now() - 1000), lastFailure: 'INTEGRITY_MISMATCH', exhausted: false, resolved: false, leaseUntil: null, leaseOwner: null });
    }
    const fresh = await seed({ storedAt: new Date() });
    const r = await worker({ SCANNER_BATCH_SIZE: '3' });
    expect(r.code).toBe(0);
    expect(r.out.run).toMatchObject({ selected: 3, newSelected: 1, retrySelected: 2, clean: 1, failed: 2 });
    expect(r.out.backlog).toMatchObject({ unscanned: 0, failedHeld: 6, exhausted: 0, alert: false });
    expect(await status(fresh)).toBe('CLEAN');
    expect(r.raw).not.toMatch(/resumes\/|mongodb:\/\/|qa\.pdf|[0-9a-f]{24}/);
  });
});

describe('bounded retries with exponential backoff', () => {
  it('retries only when due (base * 2^(n-1), capped), then EXHAUSTED: held FAILED, never retried, alerted', async () => {
    const options = { batchSize: 5, maxAttempts: 3, backoffBaseMinutes: 10, backoffCapMinutes: 15 };
    const id = await seed({ storedAt: at(-1), corrupt: true });
    expect(await batch(at(0), options)).toMatchObject({ selected: 1, failed: 1, exhaustedNow: 0 });
    expect(await attemptOf(id)).toMatchObject({ attempts: 1, nextAttemptAt: at(10), exhausted: false });
    expect(await batch(at(9), options)).toMatchObject({ selected: 0 }); // not yet due
    expect(await batch(at(10), options)).toMatchObject({ selected: 1, failed: 1 });
    expect(await attemptOf(id)).toMatchObject({ attempts: 2, nextAttemptAt: at(25) }); // min(15, 10*2) = 15
    expect(await batch(at(24), options)).toMatchObject({ selected: 0 });
    expect(await batch(at(25), options)).toMatchObject({ selected: 1, failed: 1, exhaustedNow: 1 });
    expect(await attemptOf(id)).toMatchObject({ attempts: 3, exhausted: true });
    expect(await batch(at(10_000), options)).toMatchObject({ selected: 0 }); // never again automatically
    expect(await status(id)).toBe('FAILED');
    expect(await backlog({ applications: apps(), attempts: attempts(), now: at(30), options })).toMatchObject({ exhausted: 1, failedHeld: 1, alert: true, reasons: ['EXHAUSTED_HELD'] });
  });

  it('an exhausted résumé makes the worker exit 3 (BACKLOG_ALERT) with counts only', async () => {
    const id = await seed({ storedAt: new Date(), corrupt: true });
    const r1 = await worker({ SCANNER_MAX_ATTEMPTS: '1' });
    expect(r1.code).toBe(3);
    expect(r1.out.run).toMatchObject({ failed: 1, exhaustedNow: 1 });
    expect(r1.out.backlog).toMatchObject({ exhausted: 1, alert: true, reasons: ['EXHAUSTED_HELD'] });
    expect(await status(id)).toBe('FAILED');
    expect(r1.raw).not.toMatch(/resumes\/|mongodb:\/\/|[0-9a-f]{24}/);
  });

  it('an unscanned résumé older than the threshold makes the worker exit 3 (UNSCANNED_TOO_OLD), even with the scanner down', async () => {
    await seed({ storedAt: new Date(Date.now() - 200 * 60_000) });
    const closed = net.createServer();
    await new Promise((res) => closed.listen(0, '127.0.0.1', res));
    const port = String(closed.address().port);
    await new Promise((res) => closed.close(res));
    const r = await worker({ CLAMD_PORT: port, SCANNER_BACKLOG_MAX_AGE_MINUTES: '120' });
    expect(r.code).toBe(3);
    expect(r.out).toMatchObject({ scanner: { unusable: 'UNAVAILABLE' }, run: null, backlog: { unscanned: 1, alert: true, reasons: ['UNSCANNED_TOO_OLD'] } });
    expect(r.out.backlog.oldestUnscannedMinutes).toBeGreaterThanOrEqual(199);
  });
});

describe('scanner outages do not burn file attempts', () => {
  it('scanner unreachable before the batch: exit 1, nothing recorded, no attempts record written', async () => {
    const ids = [await seed({ storedAt: new Date() }), await seed({ storedAt: new Date() })];
    const closed = net.createServer();
    await new Promise((res) => closed.listen(0, '127.0.0.1', res));
    const port = String(closed.address().port);
    await new Promise((res) => closed.close(res));
    const r = await worker({ CLAMD_PORT: port });
    expect(r.code).toBe(1);
    expect(r.out).toMatchObject({ scanner: { unusable: 'UNAVAILABLE' }, run: null });
    for (const id of ids) expect(await status(id)).toBe('NOT_SCANNED');
    expect(await attempts().countDocuments({})).toBe(0);
  });

  it('scanner failing during the batch: ONE item held FAILED (infra, attempt not charged), circuit open, the rest untouched; it recovers later', async () => {
    const ids = [];
    for (let i = 0; i < 4; i += 1) ids.push(await seed({ storedAt: at(i) }));
    const down = { name: 'clamd', scan: async () => { throw new ScannerError('UNAVAILABLE', 'socket'); } };
    const s = await runScanBatch({ applications: apps(), attempts: attempts(), storage, scanner: down, now: () => at(10), options: { batchSize: 4, backoffBaseMinutes: 5 } });
    expect(s).toMatchObject({ selected: 4, claimed: 1, failed: 1, failures: { UNAVAILABLE: 1 }, circuitOpen: true });
    expect(await status(ids[0])).toBe('FAILED');
    expect(await attemptOf(ids[0])).toMatchObject({ attempts: 0, infraFailures: 1, lastFailure: 'UNAVAILABLE', leaseUntil: null, nextAttemptAt: at(15) });
    for (const id of ids.slice(1)) expect(await status(id)).toBe('NOT_SCANNED');
    // The real scanner is back: every résumé ends CLEAN.
    const r = await batch(at(20), { batchSize: 4 });
    expect(r).toMatchObject({ clean: 4, failed: 0 });
    for (const id of ids) expect(await status(id)).toBe('CLEAN');
  });

  it('a file that breaks the scanner every time is still bounded: 2 x maxAttempts infrastructure failures exhaust it', async () => {
    const id = await seed({ storedAt: at(0) });
    const down = { name: 'clamd', scan: async () => { throw new ScannerError('TIMEOUT', 'response'); } };
    const options = { batchSize: 1, maxAttempts: 2, backoffBaseMinutes: 1 };
    let last;
    for (let i = 0; i < 4; i += 1) last = await runScanBatch({ applications: apps(), attempts: attempts(), storage, scanner: down, now: () => at(i * 2), options });
    expect(last.exhaustedNow).toBe(1);
    expect(await attemptOf(id)).toMatchObject({ attempts: 0, infraFailures: 4, exhausted: true });
    expect(await status(id)).toBe('FAILED');
  });
});

describe('concurrent workers', () => {
  it('two workers at once: every résumé scanned and recorded exactly once (real clamd)', async () => {
    const ids = [];
    for (let i = 0; i < 8; i += 1) ids.push(await seed({ storedAt: at(i) }));
    const options = { batchSize: 8 };
    const [a, b] = await Promise.all([batch(at(30), options), batch(at(30), options)]);
    expect(a.clean + b.clean).toBe(8);
    expect(a.claimed + b.claimed).toBe(8); // each item claimed by exactly one worker
    expect([a.notRecorded, b.notRecorded]).toEqual([{}, {}]); // nobody recorded over the other
    expect(await attempts().countDocuments({ resolved: true, outcome: 'CLEAN' })).toBe(8);
    for (const id of ids) expect(await status(id)).toBe('CLEAN');
  });

  it('a crashed worker\'s lease expires and the item is claimed again', async () => {
    const id = await seed({ storedAt: at(0) });
    const a = await apps().findOne({ _id: new ObjectId(id) });
    await attempts().insertOne({ _id: attemptId(id, a.resume.checksumSha256), applicationId: a._id, storageKey: a.resume.storageKey, checksumSha256: a.resume.checksumSha256, attempts: 0, infraFailures: 0, lastAttemptAt: null, nextAttemptAt: at(0), lastFailure: null, exhausted: false, resolved: false, leaseUntil: at(15), leaseOwner: 'crashed' });
    expect(await batch(at(10), { leaseMinutes: 15 })).toMatchObject({ selected: 0 }); // still leased
    expect(await batch(at(16), { leaseMinutes: 15 })).toMatchObject({ selected: 1, clean: 1 });
    expect(await status(id)).toBe('CLEAN');
  });
});
