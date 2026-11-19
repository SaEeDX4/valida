import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import util from 'node:util';
import { StorageInitializationError, PrivateStorageError, storageObjectRef } from '../../src/integrations/storage/privateStorage.js';
import { reconcileOrphanObjects, RECONCILE_MODES } from '../../src/integrations/storage/orphanReconciliation.js';
import { signRequest } from '../../src/integrations/storage/s3/sigv4.js';
import { startServer } from '../../src/server.js';
import { ConfigurationError } from '../../src/config/env.js';
import { capturingLogger, freePort, offlineDatabase, OFFLINE_TEST_MONGODB_URI } from '../helpers.js';
import { syntheticPdf, PDF_MIME } from '../fixtures/resumeFiles.js';
import { makeTestRoot, removeTestRoot } from '../fixtures/uploadHarness.js';
import { applyRequest, createApplyEnvironment, qaJob, recordingTransport } from '../fixtures/applyHarness.js';
import { emptyBucket, listKeys, moto, readObject, s3Config, s3Env, s3Storage } from './s3Fixture.js';
import { S3PrivateStorage } from '../../src/integrations/storage/s3PrivateStorage.js';
import { startFaultProxy } from './faultProxy.js';

/**
 * C6-T4 — the S3-compatible driver against the local S3 test double (moto
 * server, signature-checked and authorised after set-up), with a
 * fault-injecting proxy for lost answers, resets and refusals, and through
 * the REAL Apply service (createApp) with the in-memory Job and Application
 * repositories of the B5 suite (their fault seams drive the database side).
 * Synthetic bytes and credentials only. Object keys never appear in
 * assertions on logs or responses except to prove their absence.
 */
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
let root;
let source;
let pdf;
let proxy;
let env;
const opened = [];

beforeEach(async () => {
  await emptyBucket();
  root = makeTestRoot();
  pdf = syntheticPdf({ text: 'QA TEST DOCUMENT C6-T4 driver' });
  source = path.join(root, 'validated-upload.part');
  fs.writeFileSync(source, pdf);
});
afterEach(async () => {
  while (opened.length) await opened.pop().close();
  await proxy?.close();
  proxy = undefined;
  await env?.cleanup();
  env = undefined;
  removeTestRoot(root);
});

const request = (overrides = {}) => ({ filePath: source, sizeBytes: pdf.length, checksumSha256: sha256(pdf), ...overrides });
async function ready(overrides = {}, options = {}) {
  const storage = s3Storage(overrides, options);
  opened.push(storage);
  await storage.init();
  return storage;
}
async function initReason(overrides = {}, options = {}) {
  const storage = s3Storage(overrides, options);
  opened.push(storage);
  try {
    await storage.init();
  } catch (error) {
    expect(error).toBeInstanceOf(StorageInitializationError);
    return error.reason;
  }
  return 'READY';
}
async function storeReason(storage, req = request()) {
  try {
    await storage.storePrivateResume(req);
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateStorageError);
    return error.reason;
  }
  return 'STORED';
}
const resumeKeys = async () => listKeys('resumes/');
const closedPort = async () => freePort();

/* --------------------------------------------------------------- signing -- */

describe('the signer agrees with an independent implementation (botocore) and with the double', () => {
  it('produces the same SigV4 signature as botocore for the same request', () => {
    const date = new Date('2026-11-16T12:34:56.000Z');
    const input = {
      method: 'PUT',
      host: '127.0.0.1:9000',
      path: '/qa-valida-resumes/resumes/0123456789abcdef0123456789abcdef/fedcba9876543210fedcba9876543210',
      query: {},
      headers: { 'content-length': '1234', 'content-type': 'application/octet-stream', 'if-none-match': '*', 'x-amz-meta-sha256': 'a'.repeat(64) },
      payloadSha256: 'a'.repeat(64),
      region: 'us-east-1',
      accessKeyId: 'QAEXAMPLEKEYID01',
      secretAccessKey: 'qa-example-secret-0123456789abcdef',
      date,
    };
    const ours = signRequest(input).signature;
    // botocore's generic SigV4 signer with service "s3": it signs the given
    // X-Amz-Content-SHA256 as the payload hash, as our signer does.
    const script = `
import sys, json, datetime
import botocore.auth as A
from botocore.awsrequest import AWSRequest
from botocore.credentials import Credentials
i = json.loads(sys.argv[1])
A.get_current_datetime = lambda: datetime.datetime(2026, 11, 16, 12, 34, 56)
headers = dict(i['headers']); headers['X-Amz-Content-SHA256'] = i['payloadSha256']
req = AWSRequest(method=i['method'], url='http://' + i['host'] + i['path'], headers=headers)
A.SigV4Auth(Credentials(i['accessKeyId'], i['secretAccessKey']), 's3', i['region']).add_auth(req)
print(req.headers['Authorization'].split('Signature=')[1])
`;
    const theirs = execFileSync(process.env.VALIDA_TEST_MOTO_PYTHON, ['-c', script, JSON.stringify(input)], { encoding: 'utf8' }).trim();
    expect(theirs).toBe(ours);
  });

  it('the double checks signatures: a wrong secret is refused at start-up (PERMISSION_DENIED), never accepted', async () => {
    expect(await initReason({ RESUME_STORAGE_S3_SECRET_ACCESS_KEY: 'qa-wrong-secret-0123456789abcdef' })).toBe('PERMISSION_DENIED');
  });
});

/* ------------------------------------------------------- start-up (init) -- */

describe('start-up fails closed: no readiness, never a fallback to disk', () => {
  it.each([
    ['credentials without any permission', () => ({ RESUME_STORAGE_S3_ACCESS_KEY_ID: moto().denied.accessKeyId, RESUME_STORAGE_S3_SECRET_ACCESS_KEY: moto().denied.secretAccessKey }), 'PERMISSION_DENIED'],
    ['scoped credentials pointed at another bucket', () => ({ RESUME_STORAGE_S3_BUCKET: moto().otherBucket }), 'PERMISSION_DENIED'],
    ['an endpoint where nothing listens', async () => ({ RESUME_STORAGE_S3_ENDPOINT: `http://127.0.0.1:${await closedPort()}` }), 'UNAVAILABLE'],
  ])('%s -> %s', async (_label, overrides, reason) => {
    expect(await initReason(await overrides())).toBe(reason);
    expect(await resumeKeys()).toEqual([]);
  });

  it('a store that serves an anonymous read of the probe is refused (PUBLIC_ACCESS)', async () => {
    proxy = await startFaultProxy({ upstream: moto().endpoint });
    // The anonymous GET is the only GET init sends: answer it 200.
    proxy.setPlan({ GET: ['status:200'] });
    expect(await initReason({ RESUME_STORAGE_S3_ENDPOINT: proxy.endpoint })).toBe('PUBLIC_ACCESS');
    // C6-T4 correction 1: the probe uses a résumé key; nothing is left anywhere.
    expect(await listKeys('')).toEqual([]);
  });

  it('the real server refuses to start, before listening, when the store refuses (startServer)', async () => {
    const port = await freePort();
    const log = capturingLogger();
    await expect(
      startServer({ env: { ...s3Env({ RESUME_STORAGE_S3_ACCESS_KEY_ID: moto().denied.accessKeyId, RESUME_STORAGE_S3_SECRET_ACCESS_KEY: moto().denied.secretAccessKey }), PORT: String(port), LOG_LEVEL: 'info', CORS_ALLOWED_ORIGINS: 'http://localhost:5173' }, database: offlineDatabase(), logger: log.logger }),
    ).rejects.toMatchObject({ name: 'StorageInitializationError', reason: 'PERMISSION_DENIED' });
    const open = await new Promise((resolve) => {
      const socket = net.connect({ port, host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    expect(open).toBe(false);
    expect(log.output()).not.toContain(moto().denied.secretAccessKey);
  });

  it('a working store starts the real server and reports resumeStorage ready', async () => {
    const port = await freePort();
    const handle = await startServer({ env: { ...s3Env(), PORT: String(port), LOG_LEVEL: 'silent', CORS_ALLOWED_ORIGINS: 'http://localhost:5173' }, database: offlineDatabase(), logger: capturingLogger().logger });
    try {
      expect(handle.readiness.describe().dependencies.find((d) => d.name === 'resumeStorage').state).toBe('ready');
      expect(handle.resumeStorage.provider).toBe('S3_COMPATIBLE');
    } finally {
      await handle.shutdown('test cleanup');
    }
  });
});

/* ------------------------------------------------- the outcome of a write -- */

describe('the outcome of a write: proven failures and lost answers', () => {
  const viaProxy = async (plan, options = {}) => {
    proxy = await startFaultProxy({ upstream: moto().endpoint });
    const storage = await ready({ RESUME_STORAGE_S3_ENDPOINT: proxy.endpoint }, options);
    proxy.setPlan(plan);
    proxy.log.length = 0;
    return storage;
  };

  it('PROVEN failure — the store refuses the PUT (403): PERMISSION_DENIED, nothing stored, no follow-up request', async () => {
    const storage = await viaProxy({ PUT: ['status:403'] });
    expect(await storeReason(storage)).toBe('PERMISSION_DENIED');
    expect(proxy.log.map((e) => e.method)).toEqual(['PUT']);
    expect(await resumeKeys()).toEqual([]);
  });

  it('PROVEN failure — nothing listens: UNAVAILABLE, nothing stored', async () => {
    const storage = await ready();
    // Point the SAME driver's endpoint at a dead port by closing a proxy it uses.
    const dead = await viaProxy({ '*': ['pass'] });
    await proxy.close();
    proxy = undefined;
    expect(await storeReason(dead)).toBe('UNAVAILABLE');
    expect(storage.isReady).toBe(true);
    expect(await resumeKeys()).toEqual([]);
  });

  it('LOST ANSWER — the PUT was applied, its answer lost: resolved by HEAD -> stored, exact bytes; logged with the object reference only', async () => {
    const log = capturingLogger();
    const storage = await viaProxy({ PUT: ['lose-answer'], HEAD: ['pass'] }, { logger: log.logger });
    const stored = await storage.storePrivateResume(request());
    expect(proxy.log.map((e) => [e.method, e.mode, e.upstreamStatus])).toEqual([
      ['PUT', 'lose-answer', 200],
      ['HEAD', 'pass', 200],
    ]);
    expect((await readObject(stored.storageKey)).equals(pdf)).toBe(true);
    const entries = log.output().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(entries.find((e) => e.event === 'storage_write_outcome_resolved')).toMatchObject({ outcome: 'STORED', why: 'ANSWER_LOST', objectRef: storageObjectRef(stored.storageKey) });
    expect(log.output()).not.toContain(stored.storageKey);
  });

  it('LOST ANSWER and the store then unreachable: OUTCOME_UNKNOWN; the object exists, unreferenced, for reconciliation', async () => {
    const log = capturingLogger();
    const storage = await viaProxy({ PUT: ['lose-answer'], HEAD: ['reset'] }, { logger: log.logger });
    expect(await storeReason(storage)).toBe('OUTCOME_UNKNOWN');
    const keys = await resumeKeys();
    expect(keys).toHaveLength(1);
    const entries = log.output().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(entries.find((e) => e.event === 'storage_write_outcome_unknown')).toMatchObject({ objectRef: storageObjectRef(keys[0]), why: 'ANSWER_LOST' });
    expect(log.output()).not.toContain(keys[0]);
    // What reconciliation does next: lists it, keeps it while recent, deletes it once old and unreferenced.
    const direct = await ready();
    const none = async () => new Set();
    const dry = await reconcileOrphanObjects({ storage: direct, findReferencedKeys: none });
    expect(dry.possibleOrphans).toEqual([expect.objectContaining({ ref: storageObjectRef(keys[0]), action: 'KEEP_TOO_RECENT' })]);
    const later = () => new Date(Date.now() + 100 * 3600 * 1000);
    const run = await reconcileOrphanObjects({ storage: direct, findReferencedKeys: none, mode: RECONCILE_MODES.DELETE, confirmed: true, clock: later });
    expect(run.deleted).toBe(1);
    expect(await resumeKeys()).toEqual([]);
  });

  it('a 5xx without the write reaching the store: resolved by HEAD -> absent -> UNAVAILABLE, nothing stored', async () => {
    const storage = await viaProxy({ PUT: ['status:500'], HEAD: ['pass'] });
    expect(await storeReason(storage)).toBe('UNAVAILABLE');
    expect(proxy.log.map((e) => e.method)).toEqual(['PUT', 'HEAD']);
    expect(await resumeKeys()).toEqual([]);
  });

  it('a reset before the store saw the PUT: UNAVAILABLE after the HEAD finds nothing', async () => {
    const storage = await viaProxy({ PUT: ['reset'], HEAD: ['pass'] });
    expect(await storeReason(storage)).toBe('UNAVAILABLE');
    expect(await resumeKeys()).toEqual([]);
  });

  it('an outage (every connection reset) then recovery: OUTCOME_UNKNOWN with nothing stored, then the next write succeeds with no restart', async () => {
    const storage = await viaProxy({ '*': ['reset'] });
    // A reset after connecting cannot prove the PUT was not applied, and the
    // HEAD is reset too: the honest answer is OUTCOME_UNKNOWN.
    expect(await storeReason(storage)).toBe('OUTCOME_UNKNOWN');
    expect(await resumeKeys()).toEqual([]);
    proxy.setPlan({ '*': ['pass'] });
    const stored = await storage.storePrivateResume(request());
    expect((await readObject(stored.storageKey)).equals(pdf)).toBe(true);
  });

  it('never overwrites: a generated key that already exists gets 412, a new key is used, the existing object is unchanged', async () => {
    const first = await ready();
    const existing = await first.storePrivateResume(request());
    const other = syntheticPdf({ text: 'QA TEST DOCUMENT C6-T4 second' });
    fs.writeFileSync(source, other);
    const keys = [existing.storageKey, `resumes/${'1'.repeat(32)}/${'2'.repeat(32)}`];
    // The key generator is a constructor test seam (the factory never passes one).
    const storage = new S3PrivateStorage({ s3: s3Config().resumeStorage.s3, generateKey: () => keys.shift() });
    opened.push(storage);
    await storage.init();
    const stored = await storage.storePrivateResume({ filePath: source, sizeBytes: other.length, checksumSha256: sha256(other) });
    expect(stored.storageKey).toBe(`resumes/${'1'.repeat(32)}/${'2'.repeat(32)}`);
    expect((await readObject(existing.storageKey)).equals(pdf)).toBe(true);
    expect((await readObject(stored.storageKey)).equals(other)).toBe(true);
  });

  it('the driver and the configuration never serialise the credentials or the endpoint', async () => {
    const storage = await ready();
    const m = moto();
    for (const text of [JSON.stringify(storage), util.inspect(storage), JSON.stringify(storage.provider)]) {
      expect(text).not.toContain(m.app.secretAccessKey);
      expect(text).not.toContain(m.app.accessKeyId);
      expect(text).not.toContain(m.endpoint);
    }
  });
});

/* ------------------------------------------- through the real Apply service -- */

describe('Apply through the real application with the S3 driver (object-first persistence)', () => {
  const UNAVAILABLE = { code: 'SERVICE_UNAVAILABLE', message: "We couldn't submit your application right now. Please try again." };
  async function apply(storage) {
    env = await createApplyEnvironment({ jobs: [qaJob()], transport: recordingTransport('accept'), storage });
    return env;
  }
  const events = (name) => env.log.output().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.event === name);
  const exposes = (response, keys) => {
    const text = JSON.stringify(response.body) + JSON.stringify(response.headers);
    return keys.some((key) => text.includes(key)) || text.includes('S3_COMPATIBLE') || text.includes(moto().app.accessKeyId) || text.includes(moto().endpoint);
  };

  it('accepted: 201; one Application whose résumé metadata matches the object byte for byte; nothing private in the response', async () => {
    await apply(await ready());
    const response = await applyRequest(env.app);
    expect(response.status).toBe(201);
    const [record] = env.applications.all();
    expect(record.resume).toMatchObject({ storageProvider: 'S3_COMPATIBLE', sizeBytes: expect.any(Number), checksumSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const bytes = await readObject(record.resume.storageKey);
    expect(bytes.length).toBe(record.resume.sizeBytes);
    expect(sha256(bytes)).toBe(record.resume.checksumSha256);
    expect(await resumeKeys()).toEqual([record.resume.storageKey]);
    expect(exposes(response, [record.resume.storageKey])).toBe(false);
  });

  it('storage PROVEN failure (the store refuses): 503, no Application, no object, nothing to reconcile', async () => {
    proxy = await startFaultProxy({ upstream: moto().endpoint });
    const storage = await ready({ RESUME_STORAGE_S3_ENDPOINT: proxy.endpoint });
    proxy.setPlan({ PUT: ['status:403'] });
    await apply(storage);
    const response = await applyRequest(env.app);
    expect(response.status).toBe(503);
    expect(response.body.error).toEqual(UNAVAILABLE);
    expect(env.applications.all()).toEqual([]);
    expect(await resumeKeys()).toEqual([]);
    expect(env.tempFiles()).toEqual([]);
  });

  it('storage LOST ANSWER, resolved: 201, one Application referencing the one object', async () => {
    proxy = await startFaultProxy({ upstream: moto().endpoint });
    const storage = await ready({ RESUME_STORAGE_S3_ENDPOINT: proxy.endpoint });
    proxy.setPlan({ PUT: ['lose-answer'], HEAD: ['pass'] });
    await apply(storage);
    const response = await applyRequest(env.app);
    expect(response.status).toBe(201);
    const [record] = env.applications.all();
    expect(await resumeKeys()).toEqual([record.resume.storageKey]);
  });

  it('storage outcome UNKNOWN: 503, no Application; the possible object stays, unreferenced, and reconciliation removes it only when old', async () => {
    proxy = await startFaultProxy({ upstream: moto().endpoint });
    const storage = await ready({ RESUME_STORAGE_S3_ENDPOINT: proxy.endpoint });
    await apply(storage);
    // A successful submission first: its object must survive everything below.
    proxy.setPlan({ '*': ['pass'] });
    expect((await applyRequest(env.app)).status).toBe(201);
    const [winner] = env.applications.all();
    proxy.setPlan({ PUT: ['lose-answer'], HEAD: ['reset'] });
    const response = await applyRequest(env.app);
    expect(response.status).toBe(503);
    expect(env.applications.all()).toHaveLength(1);
    const keys = await resumeKeys();
    expect(keys).toHaveLength(2);
    const orphanKey = keys.find((k) => k !== winner.resume.storageKey);
    proxy.setPlan({ '*': ['pass'] });
    const findReferencedKeys = async (list) => new Set(list.filter((k) => env.applications.all().some((r) => r.resume.storageKey === k)));
    const later = () => new Date(Date.now() + 100 * 3600 * 1000);
    const run = await reconcileOrphanObjects({ storage, findReferencedKeys, mode: RECONCILE_MODES.DELETE, confirmed: true, clock: later });
    expect([run.referenced, run.deleted]).toEqual([1, 1]);
    expect(await resumeKeys()).toEqual([winner.resume.storageKey]);
    expect(orphanKey).not.toBe(winner.resume.storageKey);
  });

  it('database PROVEN not persisted after the object is stored: 503; compensation deletes exactly that object', async () => {
    await apply(await ready());
    env.applications.nextInsert = { kind: 'NOT_PERSISTED', reason: 'DISCONNECTED' };
    const response = await applyRequest(env.app);
    expect(response.status).toBe(503);
    expect(env.applications.all()).toEqual([]);
    expect(await resumeKeys()).toEqual([]);
    expect(events('resume_compensation')).toEqual([expect.objectContaining({ outcome: 'DELETED' })]);
  });

  it('database outcome AMBIGUOUS (nothing found on read-back): 503; the object is KEPT for reconciliation, never deleted', async () => {
    await apply(await ready());
    env.applications.nextInsert = { kind: 'AMBIGUOUS', reason: 'SERVER_ERROR', persist: false };
    const response = await applyRequest(env.app);
    expect(response.status).toBe(503);
    expect(env.applications.all()).toEqual([]);
    expect(await resumeKeys()).toHaveLength(1);
    expect(events('resume_compensation')).toEqual([]);
  });

  it('concurrent submissions with one Idempotency-Key: one Application; only the losers\' own objects are removed; the winner\'s remains', async () => {
    await apply(await ready());
    let open;
    env.applications.insertGate = new Promise((resolve) => {
      open = resolve;
    });
    const key = randomUUID();
    const resume = { data: syntheticPdf(), filename: 'qa-resume.pdf', contentType: PDF_MIME };
    const pending = Array.from({ length: 4 }, () => applyRequest(env.app, { key, resume }).then((r) => r));
    while (env.applications.calls.insert < 4) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await resumeKeys()).toHaveLength(4);
    open();
    const statuses = (await Promise.all(pending)).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 201]);
    const [record] = env.applications.all();
    expect(await resumeKeys()).toEqual([record.resume.storageKey]);
  });
});
