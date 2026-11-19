import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoPrivateStorage, RESUME_FILES_COLLECTION } from '../../src/integrations/storage/mongoPrivateStorage.js';
import { createClamdScanner, parseScanResponse, parseVersion, ScannerError } from '../../src/integrations/scanner/clamdScanner.js';
import { retrieveResumeForReview, scanApplicationResume } from '../../src/modules/applications/resume/resumeSecurity.js';
import { buildZip, docxEntries, syntheticDocx, syntheticPdf, syntheticPdfOfSize } from '../fixtures/resumeFiles.js';
import { requireTestDatabase } from '../db/testDatabase.js';

/**
 * Proposed (MongoDB-native r2, finding 3) — the scanner, against the REAL
 * ClamAV daemon and a real MongoDB. Synthetic documents only; the one
 * "malicious" input is the standard, harmless EICAR anti-virus test string,
 * assembled here at run time so no repository file contains it whole.
 *
 * NOTE ON SIGNATURES: the local run uses a locally built test database in the
 * official CVD container format (unsigned .cud, one signature for the EICAR
 * string), NOT the official Talos database — the network policy of the build
 * environment refuses database.clamav.net. Detection of EICAR by the official
 * database is a hosted check (handoff, scanner section).
 */
const { uri: TEST_URI, databaseName: DB } = requireTestDatabase();
const { MongoClient, Binary, ObjectId } = mongoose.mongo;
const CLAMD = { host: process.env.CLAMD_TEST_HOST ?? '127.0.0.1', port: Number(process.env.CLAMD_TEST_PORT ?? 3310) };
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const EICAR = Buffer.from(['X5O!P%@AP[4\\PZX54(P^)7CC)7}', '$EICAR-STANDARD-ANTIVIRUS-', 'TEST-FILE!$H+H*'].join(''), 'latin1');
const APPS = 'qa_scan_applications';
let client;
let db;
let tmp;
let storage;

function tempFile(bytes) {
  const file = path.join(tmp, randomBytes(8).toString('hex'));
  fs.writeFileSync(file, bytes);
  return file;
}
async function application(bytes, { scanStatus = 'NOT_SCANNED', name = 'qa-resume.pdf' } = {}) {
  const s = await storage.storePrivateResume({ filePath: tempFile(bytes), sizeBytes: bytes.length, checksumSha256: sha256(bytes) });
  const _id = new ObjectId();
  const extension = path.extname(name);
  const mimeType = extension === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf';
  await db.collection(APPS).insertOne({ _id, resume: { storageProvider: s.storageProvider, storageKey: s.storageKey, sizeBytes: s.sizeBytes, checksumSha256: s.checksumSha256, originalFilename: name, extension, mimeType, scanStatus, scanCheckedAt: null, storedAt: s.storedAt } });
  return { id: String(_id), stored: s, bytes };
}
const statusOf = async (id) => (await db.collection(APPS).findOne({ _id: new ObjectId(id) })).resume;
const release = (id, audit = async () => {}) => retrieveResumeForReview({ applications: db.collection(APPS), storage, applicationId: id, audit });
const scan = (id, scanner) => scanApplicationResume({ applications: db.collection(APPS), storage, scanner, applicationId: id });

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-scan-'));
  client = new MongoClient(TEST_URI);
  await client.connect();
  db = client.db(DB);
  storage = new MongoPrivateStorage({ uri: TEST_URI });
  await storage.init();
});
afterAll(async () => {
  await db.collection(APPS).deleteMany({});
  await db.collection(RESUME_FILES_COLLECTION).deleteMany({});
  await storage.close();
  await client.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
beforeEach(async () => {
  await db.collection(APPS).deleteMany({});
  await db.collection(RESUME_FILES_COLLECTION).deleteMany({});
});

describe('the REAL clamd: verdicts bound to the exact stored version', () => {
  const real = () => createClamdScanner(CLAMD);

  it('identifies its signature set (engine / version / date) and it is fresh', async () => {
    const v = await real().version();
    expect(v.engine).toMatch(/^\d+\.\d+\.\d+$/);
    expect(v.signatureVersion).toMatch(/^\d+$/);
    expect(v.ageHours).toBeLessThan(48);
  });

  it('benign synthetic PDF and DOCX -> CLEAN, bound to key + size + SHA-256, then released (audit first)', async () => {
    for (const [bytes, name] of [[syntheticPdf(), 'qa-resume.pdf'], [syntheticDocx(), 'qa-resume.docx']]) {
      const app = await application(bytes, { name });
      const result = await scan(app.id, real());
      expect(result).toMatchObject({ recorded: true, scanStatus: 'CLEAN', scanner: { name: 'clamav' } });
      expect(result.scanner.signatureVersion).toMatch(/^\d+\.\d+\.\d+-\d+$/);
      const r = await statusOf(app.id);
      expect([r.scanStatus, r.storageKey, r.sizeBytes, r.checksumSha256]).toEqual(['CLEAN', app.stored.storageKey, bytes.length, sha256(bytes)]);
      const order = [];
      const out = await release(app.id, async (e) => order.push(e.event));
      expect(out.released).toBe(true);
      expect(out.bytes.equals(bytes)).toBe(true);
      expect(order).toEqual(['RESUME_ACCESSED']);
    }
  });

  it('the EICAR test string in a .pdf-named upload -> INFECTED -> QUARANTINED, kept private, never released', async () => {
    const app = await application(EICAR, { name: 'qa-resume.pdf' });
    expect(await scan(app.id, real())).toMatchObject({ recorded: true, scanStatus: 'QUARANTINED' });
    expect(await release(app.id)).toMatchObject({ released: false, reason: 'NOT_RELEASABLE', scanStatus: 'QUARANTINED' });
    // A later "clean" answer cannot lift the quarantine.
    const lying = { name: 'clamav', scan: async () => ({ verdict: 'CLEAN', engine: '1.5.4', signatureVersion: '1' }) };
    expect(await scan(app.id, lying)).toMatchObject({ recorded: false, reason: 'TRANSITION_REFUSED', scanStatus: 'QUARANTINED' });
    expect(await db.collection(RESUME_FILES_COLLECTION).countDocuments({ _id: app.stored.storageKey })).toBe(1);
  });

  // The DOCX case holds for any signature set (the zip member IS the EICAR file). The mid-file PDF case needs a
  // body signature that matches anywhere: the local test database has one; whether the OFFICIAL database matches
  // EICAR away from offset 0 is not asserted (CLAMD_TEST_SIGNATURES=official in CI) — only the standard test file is.
  const OFFICIAL = process.env.CLAMD_TEST_SIGNATURES === 'official';
  it(`EICAR inside a DOCX (zip) part${OFFICIAL ? '' : ', and at a non-zero offset inside a PDF'} -> QUARANTINED`, async () => {
    const pdf = Buffer.concat([syntheticPdf().subarray(0, 200), EICAR, syntheticPdf().subarray(200)]);
    const docx = buildZip([...docxEntries(), { name: 'word/media/qa.bin', data: EICAR }]);
    for (const [bytes, name] of [[docx, 'qa-resume.docx'], ...(OFFICIAL ? [] : [[pdf, 'qa-resume.pdf']])]) {
      const app = await application(bytes, { name });
      expect(await scan(app.id, real())).toMatchObject({ recorded: true, scanStatus: 'QUARANTINED' });
      expect((await release(app.id)).released).toBe(false);
    }
  });

  it('a 5 MiB benign PDF (the approved maximum) is scanned CLEAN in one stream', async () => {
    const app = await application(syntheticPdfOfSize(5 * 1024 * 1024));
    expect(await scan(app.id, real())).toMatchObject({ recorded: true, scanStatus: 'CLEAN' });
  });

  it('bytes altered in storage are not scanned; FAILED, held', async () => {
    const app = await application(syntheticPdf());
    const altered = Buffer.from(app.bytes);
    altered[10] ^= 0xff;
    await db.collection(RESUME_FILES_COLLECTION).updateOne({ _id: app.stored.storageKey }, { $set: { data: new Binary(altered) } });
    expect(await scan(app.id, real())).toMatchObject({ recorded: true, scanStatus: 'FAILED', failure: 'INTEGRITY_MISMATCH' });
    expect((await release(app.id)).released).toBe(false);
  });

  it('the record changes to another version while the scan runs -> the verdict is refused (BINDING_MISMATCH)', async () => {
    const app = await application(syntheticPdf());
    const next = await storage.storePrivateResume({ filePath: tempFile(syntheticDocx()), sizeBytes: syntheticDocx().length, checksumSha256: sha256(syntheticDocx()) });
    const inner = real();
    const swapping = {
      name: 'clamav',
      scan: async (bytes) => {
        const out = await inner.scan(bytes);
        await db.collection(APPS).updateOne({ _id: new ObjectId(app.id) }, { $set: { 'resume.storageKey': next.storageKey, 'resume.sizeBytes': next.sizeBytes, 'resume.checksumSha256': next.checksumSha256 } });
        return out;
      },
    };
    expect(await scan(app.id, swapping)).toMatchObject({ recorded: false, reason: 'BINDING_MISMATCH' });
    expect((await statusOf(app.id)).scanStatus).toBe('NOT_SCANNED');
  });

  it('a scanner that reports different bytes than were stored is FAILED (SCANNED_BYTES_MISMATCH)', async () => {
    const app = await application(syntheticPdf());
    const inner = real();
    const wrong = { name: 'clamav', scan: async (bytes) => ({ ...(await inner.scan(bytes)), sentSha256: sha256(Buffer.from('other')) }) };
    expect(await scan(app.id, wrong)).toMatchObject({ recorded: true, scanStatus: 'FAILED', failure: 'SCANNED_BYTES_MISMATCH' });
  });
});

/** A fake clamd: answers VERSION with `version` and INSTREAM with `behaviour`. */
async function fakeClamd({ version = 'ClamAV 1.5.4', behaviour = 'ok', versionAfter = null } = {}) {
  let versions = 0;
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    socket.on('error', () => {});
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.subarray(0, 9).toString() === 'zVERSION\0') {
        versions += 1;
        socket.end(`${versions > 1 && versionAfter ? versionAfter : version}\0`);
        return;
      }
      if (buf.subarray(0, 10).toString() !== 'zINSTREAM\0') return;
      // wait for the zero-length terminator
      let off = 10;
      for (;;) {
        if (buf.length < off + 4) return;
        const len = buf.readUInt32BE(off);
        if (len === 0) break;
        if (buf.length < off + 4 + len) return;
        off += 4 + len;
      }
      if (behaviour === 'ok') socket.end('stream: OK\0');
      else if (behaviour === 'found') socket.end('stream: Qa.Test FOUND\0');
      else if (behaviour === 'error') socket.end('INSTREAM size limit exceeded. ERROR\0');
      else if (behaviour === 'malformed') socket.end('stream: MAYBE\0');
      else if (behaviour === 'multiline') socket.end('stream: OK\nstream: OK\0');
      else if (behaviour === 'truncated') socket.end('stream: O');
      else if (behaviour === 'reset') socket.resetAndDestroy();
      else if (behaviour === 'oversized') socket.end(`${'x'.repeat(5000)}\0`);
      // 'timeout': never answer
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
const ctime = (date) => {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = (n) => String(n).padStart(2, '0');
  return `${days[date.getUTCDay()]} ${months[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, ' ')} ${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())} ${date.getUTCFullYear()}`;
};

describe('scanner failures keep the file held (FAILED, never CLEAN, never released)', () => {
  const fresh = () => `ClamAV 1.5.4/27812/${ctime(new Date())}`;
  const cases = [
    ['timeout', { behaviour: 'timeout' }, 'TIMEOUT'],
    ['malformed response', { behaviour: 'malformed' }, 'MALFORMED_RESPONSE'],
    ['multi-line response', { behaviour: 'multiline' }, 'MALFORMED_RESPONSE'],
    ['truncated response', { behaviour: 'truncated' }, 'MALFORMED_RESPONSE'],
    ['oversized response', { behaviour: 'oversized' }, 'MALFORMED_RESPONSE'],
    ['connection reset', { behaviour: 'reset' }, 'UNAVAILABLE'],
    ['scanner ERROR answer', { behaviour: 'error' }, 'SCANNER_ERROR'],
    ['stale signatures (3 days old)', { version: `ClamAV 1.5.4/27800/${ctime(new Date(Date.now() - 72 * 3_600_000))}` }, 'STALE_SIGNATURES'],
    ['unknown signature version (engine only)', { version: 'ClamAV 1.5.4' }, 'UNKNOWN_SIGNATURES'],
    ['signature date in the future', { version: `ClamAV 1.5.4/27900/${ctime(new Date(Date.now() + 5 * 3_600_000))}` }, 'UNKNOWN_SIGNATURES'],
    ['signatures reloaded during the scan', { versionAfter: `ClamAV 1.5.4/27813/${ctime(new Date())}` }, 'SIGNATURES_CHANGED'],
  ];
  for (const [label, options, reason] of cases) {
    it(`${label} -> FAILED (${reason}), not released`, async () => {
      const fake = await fakeClamd({ version: fresh(), ...options });
      try {
        const app = await application(syntheticPdf());
        const scanner = createClamdScanner({ port: fake.port, connectTimeoutMs: 500, scanTimeoutMs: 800 });
        expect(await scan(app.id, scanner)).toMatchObject({ recorded: true, scanStatus: 'FAILED', failure: reason });
        expect((await release(app.id)).released).toBe(false);
      } finally {
        await fake.close();
      }
    });
  }

  it('an unreachable scanner -> FAILED (UNAVAILABLE); a later real scan from FAILED -> CLEAN -> released after the audit', async () => {
    const closed = await fakeClamd();
    const port = closed.port;
    await closed.close();
    const app = await application(syntheticPdf());
    expect(await scan(app.id, createClamdScanner({ port, connectTimeoutMs: 500 }))).toMatchObject({ recorded: true, scanStatus: 'FAILED', failure: 'UNAVAILABLE' });
    expect((await release(app.id)).released).toBe(false);
    expect(await scan(app.id, createClamdScanner(CLAMD))).toMatchObject({ recorded: true, scanStatus: 'CLEAN' });
    const order = [];
    expect((await release(app.id, async (e) => order.push(e.event))).released).toBe(true);
    expect(order).toEqual(['RESUME_ACCESSED']);
  });

  it('an over-limit stream is refused before anything is sent (TOO_LARGE)', async () => {
    await expect(createClamdScanner({ ...CLAMD, maxStreamBytes: 1000 }).scan(Buffer.alloc(1001, 1))).rejects.toMatchObject({ reason: 'TOO_LARGE' });
  });
});

describe('strict parsing (units)', () => {
  it('CLEAN only for exactly "stream: OK"; INFECTED only for "<name> FOUND"', () => {
    expect(parseScanResponse('stream: OK')).toEqual({ verdict: 'CLEAN' });
    expect(parseScanResponse('stream: Win.Test.EICAR_HDB-1 FOUND')).toEqual({ verdict: 'INFECTED', signature: 'Win.Test.EICAR_HDB-1' });
    for (const bad of ['stream: ok', 'stream: OK ', ' stream: OK', 'OK', 'stream: FOUND', 'stream:  FOUND', '']) expect(() => parseScanResponse(bad)).toThrow(ScannerError);
    expect(() => parseScanResponse('stream: Can\'t allocate memory ERROR')).toThrow(expect.objectContaining({ reason: 'SCANNER_ERROR' }));
  });
  it('VERSION: engine, numeric signature version and a ctime date, or nothing', () => {
    expect(parseVersion('ClamAV 1.5.4/27812/Wed Nov 18 13:15:56 2026')).toMatchObject({ engine: '1.5.4', signatureVersion: '27812' });
    expect(parseVersion('ClamAV 1.5.4/27812/Wed Nov 18 13:15:56 2026').signatureDate.toISOString()).toBe('2026-11-18T13:15:56.000Z');
    for (const bad of ['ClamAV 1.5.4', 'ClamAV 1.5.4/x/Wed Nov 18 13:15:56 2026', 'ClamAV 1.5.4/1/yesterday', 'clamav 1.5.4/1/Wed Nov 18 13:15:56 2026']) expect(parseVersion(bad)).toBeNull();
  });
});
