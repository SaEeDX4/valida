import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PrivateStorageError, StorageInitializationError, storageObjectRef } from '../../src/integrations/storage/privateStorage.js';
import { reconcileOrphanObjects, RECONCILE_MODES } from '../../src/integrations/storage/orphanReconciliation.js';
import { S3PrivateStorage } from '../../src/integrations/storage/s3PrivateStorage.js';
import { capturingLogger } from '../helpers.js';
import { syntheticPdf } from '../fixtures/resumeFiles.js';
import { makeTestRoot, removeTestRoot } from '../fixtures/uploadHarness.js';
import { applyRequest, createApplyEnvironment, qaJob, recordingTransport } from '../fixtures/applyHarness.js';
import { emptyBucket, headObject, listKeys, moto, putObject, readObject, s3Config } from './s3Fixture.js';
import { startFaultProxy } from './faultProxy.js';

/**
 * C6-T4 correction 1 — regressions for Astra's three findings, against the
 * local S3 test double (moto) behind the fault-injecting proxy:
 *
 *   1. OWNERSHIP after an uncertain PUT: a matching key, length and digest do
 *      not identify the write attempt. An object this attempt did not write is
 *      never adopted and never deleted, on every uncertain path.
 *   2. The start-up PRIVACY check is conclusive: a representative résumé key,
 *      an explicit anonymous denial required, cleanup confirmed.
 *   3. RECONCILIATION never acts on an incomplete or invalid listing.
 *
 * Synthetic bytes and credentials only.
 */
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const KEY_A = `resumes/${'a1'.repeat(16)}/${'b2'.repeat(16)}`;
const KEY_B = `resumes/${'c3'.repeat(16)}/${'d4'.repeat(16)}`;
let root;
let source;
let pdf;
let proxy;
let env;
const opened = [];

beforeEach(async () => {
  await emptyBucket();
  root = makeTestRoot();
  pdf = syntheticPdf({ text: 'QA TEST DOCUMENT C6-T4 correction 1' });
  source = path.join(root, 'validated-upload.part');
  fs.writeFileSync(source, pdf);
  proxy = await startFaultProxy({ upstream: moto().endpoint });
});
afterEach(async () => {
  while (opened.length) await opened.pop().close();
  await proxy?.close();
  proxy = undefined;
  await env?.cleanup();
  env = undefined;
  removeTestRoot(root);
});

/** A driver behind the proxy, built directly so the test seams reach it. */
async function driver({ keys = null, logger, listPageSize, init = true } = {}) {
  const queue = keys ? [...keys] : null;
  const s3 = s3Config({ RESUME_STORAGE_S3_ENDPOINT: proxy.endpoint, RESUME_STORAGE_S3_TIMEOUT_MS: '2000' }).resumeStorage.s3;
  const storage = new S3PrivateStorage({ s3, logger, ...(queue ? { generateKey: () => queue.shift() } : {}), ...(listPageSize ? { listPageSize } : {}) });
  opened.push(storage);
  if (init) {
    proxy.setPlan({ '*': ['pass'] });
    await storage.init();
  }
  proxy.log.length = 0;
  return storage;
}
const request = (overrides = {}) => ({ filePath: source, sizeBytes: pdf.length, checksumSha256: sha256(pdf), ...overrides });
async function outcome(promise) {
  try {
    return { stored: await promise };
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateStorageError);
    return { reason: error.reason };
  }
}
const logEntries = (log) => log.output().split('\n').filter(Boolean).map((line) => JSON.parse(line));

/* ------------------------------------------------- 1. ownership of a write -- */

describe('finding 1 — an object this attempt did not write is never adopted or deleted', () => {
  it('a PRE-EXISTING object with IDENTICAL bytes and the conditional PUT answer lost: not adopted, not deleted', async () => {
    await putObject(KEY_A, pdf, { sha256: sha256(pdf) });
    const before = await headObject(KEY_A);
    const storage = await driver({ keys: [KEY_A] });
    proxy.setPlan({ PUT: ['lose-answer'], '*': ['pass'] });
    const result = await outcome(storage.storePrivateResume(request()));
    // The double refused the conditional PUT (412); the client never saw it.
    expect(proxy.log.find((e) => e.method === 'PUT')).toMatchObject({ mode: 'lose-answer', upstreamStatus: 412 });
    expect(result.stored).toBeUndefined();
    expect(proxy.log.some((e) => e.method === 'DELETE')).toBe(false);
    expect(await headObject(KEY_A)).toEqual(before);
    expect((await readObject(KEY_A)).equals(pdf)).toBe(true);
  });

  it('a PRE-EXISTING object with DIFFERENT bytes and the conditional PUT answer lost: not adopted, not deleted', async () => {
    const other = Buffer.alloc(pdf.length, 0x51);
    await putObject(KEY_A, other, { sha256: sha256(pdf) });
    const before = await headObject(KEY_A);
    const storage = await driver({ keys: [KEY_A] });
    proxy.setPlan({ PUT: ['lose-answer'], '*': ['pass'] });
    const result = await outcome(storage.storePrivateResume(request()));
    expect(result.stored).toBeUndefined();
    expect(proxy.log.some((e) => e.method === 'DELETE')).toBe(false);
    expect(await headObject(KEY_A)).toEqual(before);
    expect((await readObject(KEY_A)).equals(other)).toBe(true);
  });

  it('a LOCAL integrity error on the uncertain path with a pre-existing object under the key: the object is not deleted', async () => {
    // The validated checksum names the pre-existing bytes; the file being sent differs: the local digest fails.
    const existing = syntheticPdf({ text: 'QA TEST DOCUMENT C6-T4 pre-existing' });
    await putObject(KEY_A, existing, { sha256: sha256(existing) });
    fs.writeFileSync(source, Buffer.alloc(existing.length, 0x52));
    const before = await headObject(KEY_A);
    const storage = await driver({ keys: [KEY_A] });
    proxy.setPlan({ PUT: ['lose-answer'], '*': ['pass'] });
    const result = await outcome(storage.storePrivateResume({ filePath: source, sizeBytes: existing.length, checksumSha256: sha256(existing) }));
    expect(result.reason).toBe('INTEGRITY_MISMATCH');
    expect(proxy.log.some((e) => e.method === 'DELETE')).toBe(false);
    expect(await headObject(KEY_A)).toEqual(before);
  });

  it('POSITIVE CONTROL: this attempt stored the file and its answer was lost: adopted (the ownership marker is its own)', async () => {
    const storage = await driver({ keys: [KEY_B] });
    proxy.setPlan({ PUT: ['lose-answer'], '*': ['pass'] });
    const result = await outcome(storage.storePrivateResume(request()));
    expect(proxy.log.find((e) => e.method === 'PUT')).toMatchObject({ upstreamStatus: 200 });
    expect(result.stored).toMatchObject({ storageKey: KEY_B, sizeBytes: pdf.length, checksumSha256: sha256(pdf) });
    expect((await readObject(KEY_B)).equals(pdf)).toBe(true);
    expect((await headObject(KEY_B)).metadata.attempt).toMatch(/^[0-9a-f]{32}$/);
  });

  it('every attempt carries a FRESH marker: two stores of the same bytes have different markers', async () => {
    const storage = await driver({ keys: [KEY_A, KEY_B] });
    proxy.setPlan({ '*': ['pass'] });
    await storage.storePrivateResume(request());
    await storage.storePrivateResume(request());
    const [a, b] = [await headObject(KEY_A), await headObject(KEY_B)];
    expect(a.metadata.attempt).toMatch(/^[0-9a-f]{32}$/);
    expect(b.metadata.attempt).toMatch(/^[0-9a-f]{32}$/);
    expect(a.metadata.attempt).not.toBe(b.metadata.attempt);
  });

  it('ABSENT only AT OBSERVATION: a timed-out PUT that lands later is reported as absent-at-observation, then found as an unreferenced object', async () => {
    const log = capturingLogger();
    const storage = await driver({ keys: [KEY_B], logger: log.logger });
    proxy.setPlan({ PUT: ['reset-then-forward:600'], '*': ['pass'] });
    const result = await outcome(storage.storePrivateResume(request()));
    expect(result.reason).toBe('UNAVAILABLE');
    const line = logEntries(log).find((e) => e.event === 'storage_write_outcome_resolved' || e.event === 'storage_write_outcome_unobserved');
    expect(line).toMatchObject({ outcome: 'ABSENT_AT_OBSERVATION', objectRef: storageObjectRef(KEY_B) });
    expect(log.output()).not.toContain(KEY_B);
    // The late write lands after the client gave up.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(await listKeys('resumes/')).toEqual([KEY_B]);
    const none = async () => new Set();
    const dry = await reconcileOrphanObjects({ storage, findReferencedKeys: none });
    expect(dry.possibleOrphans).toEqual([expect.objectContaining({ ref: storageObjectRef(KEY_B), action: 'KEEP_TOO_RECENT' })]);
  });

  it('through Apply: a pre-existing identical object under the generated key -> 503, no Application, the object untouched', async () => {
    await putObject(KEY_A, pdf, { sha256: sha256(pdf) });
    const before = await headObject(KEY_A);
    const storage = await driver({ keys: [KEY_A] });
    env = await createApplyEnvironment({ jobs: [qaJob()], transport: recordingTransport('accept'), storage });
    proxy.setPlan({ PUT: ['lose-answer'], '*': ['pass'] });
    const response = await applyRequest(env.app, { resume: { data: pdf, filename: 'qa.pdf', contentType: 'application/pdf' } });
    expect(response.status).toBe(503);
    expect(env.applications.all()).toEqual([]);
    expect(await headObject(KEY_A)).toEqual(before);
    expect(proxy.log.some((e) => e.method === 'DELETE')).toBe(false);
  });
});

/* -------------------------------------------- 2. the start-up privacy check -- */

describe('finding 2 — the start-up privacy check is conclusive', () => {
  const initReason = async (plan) => {
    const storage = await driver({ init: false });
    proxy.setPlan(plan);
    try {
      await storage.init();
    } catch (error) {
      expect(error).toBeInstanceOf(StorageInitializationError);
      return error.reason;
    }
    return 'READY';
  };
  const anonymousUnder = (prefix, mode) => (req) => (req.anonymous && req.url.includes(`/${moto().bucket}/${prefix}`) ? mode : 'pass');

  it('CONTROL — a private store: ready; the probe used a résumé-shaped key and was removed (nothing left)', async () => {
    expect(await initReason({ '*': ['pass'] })).toBe('READY');
    const anon = proxy.log.filter((e) => e.anonymous);
    expect(anon).toHaveLength(1);
    expect(await listKeys('')).toEqual([]);
    const put = proxy.log.find((e) => e.method === 'PUT');
    expect(put).toBeDefined();
  });

  it('the résumé prefix is anonymously readable while a separate probe prefix is private: NOT ready (PUBLIC_ACCESS)', async () => {
    expect(await initReason({ '*': [anonymousUnder('resumes/', { respond: { status: 200, body: 'public' } })] })).toBe('PUBLIC_ACCESS');
    expect(await listKeys('')).toEqual([]);
  });

  it.each([
    ['a redirect (307)', { respond: { status: 307, headers: { location: 'https://elsewhere.example.test/' } } }],
    ['a server error (500)', { respond: { status: 500, body: '<Error><Code>InternalError</Code></Error>' } }],
    ['a 404 (not a denial)', { respond: { status: 404, body: '<Error><Code>NoSuchKey</Code></Error>' } }],
    ['a reset', 'reset'],
    ['a timeout', 'hang'],
  ])('an inconclusive anonymous answer — %s — is NOT ready (PUBLIC_ACCESS_UNVERIFIED)', async (_label, mode) => {
    expect(await initReason({ '*': [(req) => (req.anonymous ? mode : 'pass')] })).toBe('PUBLIC_ACCESS_UNVERIFIED');
    expect(await listKeys('')).toEqual([]);
  });

  it.each([
    ['the DELETE fails (500)', { DELETE: [{ respond: { status: 500, body: '<Error><Code>InternalError</Code></Error>' } }], '*': ['pass'] }],
    ['the DELETE is reset', { DELETE: ['reset'], '*': ['pass'] }],
    ['the DELETE answers 204 but the object is still there', { DELETE: [{ respond: { status: 204 } }], '*': ['pass'] }],
  ])('cleanup that cannot be confirmed — %s — is NOT ready (PROBE_CLEANUP_FAILED), with a sanitised message', async (_label, plan) => {
    const storage = await driver({ init: false });
    proxy.setPlan(plan);
    const error = await storage.init().catch((e) => e);
    expect(error).toBeInstanceOf(StorageInitializationError);
    expect(error.reason).toBe('PROBE_CLEANUP_FAILED');
    expect(error.message).toBe('private storage initialisation failed: PROBE_CLEANUP_FAILED');
    expect(storage.isReady).toBe(false);
  });
});

/* ------------------------------------------------- 3. reconciliation inputs -- */

describe('finding 3 — reconciliation never acts on an incomplete or invalid listing', () => {
  const later = () => new Date(Date.now() + 100 * 3600 * 1000);
  const none = async () => new Set();
  const rewriteList = (fn) => (req) => (req.method === 'GET' && req.url.includes('list-type=2') ? { rewrite: (_s, body) => fn(body) } : 'pass');
  async function listingReason(storage) {
    try {
      await storage.listPrivateObjects();
    } catch (error) {
      expect(error).toBeInstanceOf(PrivateStorageError);
      return error.reason;
    }
    return 'LISTED';
  }
  async function withObjects(n) {
    for (let i = 0; i < n; i += 1) await putObject(`resumes/${i.toString(16).padStart(32, '0')}/${'e'.repeat(32)}`, Buffer.from(`qa ${i}`));
  }

  it('CONTROL — a legitimate empty bucket lists as empty', async () => {
    const storage = await driver();
    expect(await storage.listPrivateObjects()).toEqual({ objects: [], partials: [], unexpected: 0, notConfined: 0 });
  });

  it('CONTROL — a multi-page listing (page size 2, five objects) lists every object once', async () => {
    await withObjects(5);
    const storage = await driver({ listPageSize: 2 });
    proxy.setPlan({ '*': ['pass'] });
    const listing = await storage.listPrivateObjects();
    expect(listing.objects).toHaveLength(5);
    expect(new Set(listing.objects.map((o) => o.storageKey)).size).toBe(5);
    expect(proxy.log.filter((e) => e.method === 'GET').length).toBe(3);
  });

  it.each([
    ['not a ListBucketResult document', () => '<html><body>maintenance</body></html>'],
    ['an empty body', () => ''],
    ['another bucket\'s listing', (body) => body.replace(/<Name>[^<]*<\/Name>/, '<Name>qa-someone-else</Name>')],
    ['a different prefix', (body) => body.replace(/<Prefix>[^<]*<\/Prefix>/, '<Prefix>other/</Prefix>')],
    ['a key outside the requested prefix', (body) => body.replace(/<Key>resumes\//, '<Key>elsewhere/')],
    ['a KeyCount that disagrees with the entries', (body) => body.replace(/<KeyCount>\d+<\/KeyCount>/, '<KeyCount>7</KeyCount>')],
    ['no IsTruncated', (body) => body.replace(/<IsTruncated>[^<]*<\/IsTruncated>/, '')],
    ['truncated without a continuation token', (body) => body.replace(/<IsTruncated>false<\/IsTruncated>/, '<IsTruncated>true</IsTruncated>')],
    ['an entry without a size', (body) => body.replace(/<Size>\d+<\/Size>/, '')],
    ['more entries than MaxKeys', (body) => body.replace(/<MaxKeys>\d+<\/MaxKeys>/, '<MaxKeys>1</MaxKeys>')],
  ])('a listing that is %s: controlled failure (LISTING_INVALID), no report', async (_label, fn) => {
    await withObjects(2);
    const storage = await driver();
    proxy.setPlan({ '*': [rewriteList(fn)] });
    expect(await listingReason(storage)).toBe('LISTING_INVALID');
    await expect(reconcileOrphanObjects({ storage, findReferencedKeys: none })).rejects.toBeInstanceOf(PrivateStorageError);
  });

  it('an earlier VALID page cannot lead to deletion when a later page is invalid', async () => {
    await withObjects(3);
    const storage = await driver({ listPageSize: 2 });
    let pages = 0;
    proxy.setPlan({
      '*': [
        (req) => {
          if (!(req.method === 'GET' && req.url.includes('list-type=2'))) return 'pass';
          pages += 1;
          return pages === 1 ? 'pass' : { rewrite: () => '<ListBucketResult><broken' };
        },
      ],
    });
    await expect(reconcileOrphanObjects({ storage, findReferencedKeys: none, mode: RECONCILE_MODES.DELETE, confirmed: true, clock: later })).rejects.toMatchObject({ reason: 'LISTING_INVALID' });
    expect(proxy.log.some((e) => e.method === 'DELETE' || e.method === 'HEAD')).toBe(false);
    expect(await listKeys('resumes/')).toHaveLength(3);
  });

  it('a repeated continuation token (a loop) is refused', async () => {
    await withObjects(3);
    const storage = await driver({ listPageSize: 2 });
    let token = null;
    proxy.setPlan({
      '*': [
        rewriteList((body) => {
          const match = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(body);
          if (match && token === null) token = match[1];
          return token ? body.replace(/<IsTruncated>false<\/IsTruncated>/, '<IsTruncated>true</IsTruncated>').replace(/(<\/ListBucketResult>)/, (m) => (body.includes('NextContinuationToken') ? m : `<NextContinuationToken>${token}</NextContinuationToken>${m}`)) : body;
        }),
      ],
    });
    expect(await listingReason(storage)).toBe('LISTING_INVALID');
  });
});
