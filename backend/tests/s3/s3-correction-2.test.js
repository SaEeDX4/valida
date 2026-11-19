import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PrivateStorageError, StorageInitializationError, storageObjectRef } from '../../src/integrations/storage/privateStorage.js';
import { S3PrivateStorage } from '../../src/integrations/storage/s3PrivateStorage.js';
import { capturingLogger } from '../helpers.js';
import { syntheticPdf } from '../fixtures/resumeFiles.js';
import { makeTestRoot, removeTestRoot } from '../fixtures/uploadHarness.js';
import { applyRequest, createApplyEnvironment, qaJob, recordingTransport } from '../fixtures/applyHarness.js';
import { emptyBucket, headObject, listKeys, listVersions, moto, putObject, readObject, s3Config } from './s3Fixture.js';
import { startFaultProxy } from './faultProxy.js';

/**
 * C6-T4 correction 2 — a deletion that follows an ownership observation is
 * bound to the exact object GENERATION observed.
 *
 * Every test places a SYNTHETIC REPLACEMENT — the same bytes, a different
 * ownership marker, written by a writer outside the driver (unconditional PUT,
 * test-side credentials) — AFTER the driver's final ownership observation and
 * BEFORE its deletion would take effect: the fault proxy lets the store
 * answer, places the replacement, and only then hands the answer to the
 * driver. The replacement must survive.
 *
 * Synthetic bytes and credentials only.
 */
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const KEY = `resumes/${'e5'.repeat(16)}/${'f6'.repeat(16)}`;
const FOREIGN = 'f'.repeat(32);
let root;
let source;
let altered;
let pdf;
let proxy;
let env;
const opened = [];

beforeEach(async () => {
  await emptyBucket();
  root = makeTestRoot();
  pdf = syntheticPdf({ text: 'QA TEST DOCUMENT C6-T4 correction 2' });
  source = path.join(root, 'validated-upload.part');
  fs.writeFileSync(source, pdf);
  // Same length, different bytes: what the driver reads when the source changes under it.
  altered = path.join(root, 'changed-while-sent.part');
  fs.writeFileSync(altered, Buffer.alloc(pdf.length, 0x53));
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

async function driver({ bucket, keys = [KEY], logger, changedSource = false, init = true } = {}) {
  const queue = [...keys];
  const s3 = s3Config({ RESUME_STORAGE_S3_ENDPOINT: proxy.endpoint, RESUME_STORAGE_S3_TIMEOUT_MS: '2000', ...(bucket ? { RESUME_STORAGE_S3_BUCKET: bucket } : {}) }).resumeStorage.s3;
  const storage = new S3PrivateStorage({ s3, logger, generateKey: () => queue.shift(), ...(changedSource ? { openFile: (_p, flags) => open(altered, flags) } : {}) });
  opened.push(storage);
  if (init) {
    proxy.setPlan({ '*': ['pass'] });
    await storage.init();
  }
  proxy.log.length = 0;
  return storage;
}
const request = () => ({ filePath: source, sizeBytes: pdf.length, checksumSha256: sha256(pdf) });
const reasonOf = async (promise) => {
  try {
    await promise;
    return 'STORED';
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateStorageError);
    return error.reason;
  }
};
const entries = (log) => log.output().split('\n').filter(Boolean).map((line) => JSON.parse(line));

/**
 * A HEAD plan step that lets the store answer, records the generation it
 * reported, then places the synthetic replacement (same bytes as stored,
 * FOREIGN marker) before the driver sees the answer.
 */
function observeThenReplace(seen, { key = KEY, bucket, strip = [] } = {}) {
  return {
    afterUpstream: async (status, headers) => {
      seen.observedVersion = headers['x-amz-version-id'] ?? null;
      seen.observedStatus = status;
      const stored = await readObject(key, { bucket });
      seen.replacementBytes = stored;
      seen.replacement = await putObject(key, stored, { sha256: headers['x-amz-meta-sha256'] ?? sha256(stored), attempt: FOREIGN }, { bucket, as: 'fixture' });
    },
    stripHeaders: strip,
  };
}
async function expectReplacementSurvived(seen, { key = KEY, bucket } = {}) {
  const current = await headObject(key, { bucket });
  expect(current).toMatchObject({ exists: true, metadata: expect.objectContaining({ attempt: FOREIGN }) });
  expect((await readObject(key, { bucket })).equals(seen.replacementBytes)).toBe(true);
  if (seen.replacement.versionId) expect(current.versionId).toBe(seen.replacement.versionId);
}

/* ------------------------------------------- 1. failed or uncertain uploads -- */

describe('uploads: a deletion after an ownership observation removes only the generation observed', () => {
  it('lost answer + local integrity error (#discardIfOwn): the DELETE names the observed version; the replacement survives', async () => {
    const storage = await driver({ changedSource: true });
    const seen = {};
    proxy.setPlan({ PUT: ['lose-answer'], HEAD: [observeThenReplace(seen)], '*': ['pass'] });
    expect(await reasonOf(storage.storePrivateResume(request()))).toBe('INTEGRITY_MISMATCH');
    await expectReplacementSurvived(seen);
    expect(seen.observedStatus).toBe(200);
    expect(seen.observedVersion).toBeTruthy();
    const deletes = proxy.log.filter((e) => e.method === 'DELETE');
    expect(deletes).toEqual([expect.objectContaining({ versionId: seen.observedVersion })]);
    // This attempt's own generation is gone; the replacement is the only version left.
    expect(await headObject(KEY, { versionId: seen.observedVersion })).toEqual({ exists: false });
    expect((await listVersions()).versions.map((v) => v.versionId)).toEqual([seen.replacement.versionId]);
  });

  it('lost answer, own object incomplete (#resolveUncertain -> #deleteOwn): bound DELETE; the replacement survives', async () => {
    const storage = await driver();
    const seen = {};
    // The HEAD's recorded SHA-256 is withheld, so this attempt's object reads as incomplete.
    proxy.setPlan({ PUT: ['lose-answer'], HEAD: [observeThenReplace(seen, { strip: ['x-amz-meta-sha256'] })], '*': ['pass'] });
    expect(await reasonOf(storage.storePrivateResume(request()))).toBe('INTEGRITY_MISMATCH');
    await expectReplacementSurvived(seen);
    expect(proxy.log.filter((e) => e.method === 'DELETE')).toEqual([expect.objectContaining({ versionId: seen.observedVersion })]);
  });

  it('no version to bind to: NOTHING is deleted; the object is preserved and its one-way reference logged; the generic failure stands', async () => {
    const log = capturingLogger();
    const storage = await driver({ changedSource: true, logger: log.logger });
    const seen = {};
    proxy.setPlan({ PUT: ['lose-answer'], HEAD: [observeThenReplace(seen, { strip: ['x-amz-version-id'] })], '*': ['pass'] });
    expect(await reasonOf(storage.storePrivateResume(request()))).toBe('INTEGRITY_MISMATCH');
    await expectReplacementSurvived(seen);
    expect(proxy.log.some((e) => e.method === 'DELETE')).toBe(false);
    expect(entries(log)).toContainEqual(expect.objectContaining({ event: 'storage_discard_skipped', outcome: 'NO_DELETE_BINDING', objectRef: storageObjectRef(KEY) }));
    expect(log.output()).not.toContain(KEY);
  });

  it('no version to bind to, no replacement: this attempt\'s wrong object is PRESERVED (not deleted) for reconciliation', async () => {
    const storage = await driver({ changedSource: true });
    proxy.setPlan({ PUT: ['lose-answer'], HEAD: [{ stripHeaders: ['x-amz-version-id'] }], '*': ['pass'] });
    expect(await reasonOf(storage.storePrivateResume(request()))).toBe('INTEGRITY_MISMATCH');
    expect(proxy.log.some((e) => e.method === 'DELETE')).toBe(false);
    const kept = await headObject(KEY);
    expect(kept.exists).toBe(true);
    expect(kept.metadata.attempt).toMatch(/^[0-9a-f]{32}$/);
    expect(kept.metadata.attempt).not.toBe(FOREIGN);
  });

  it('POSITIVE CONTROL: lost answer, this attempt\'s object complete: recovered as stored; nothing deleted', async () => {
    const storage = await driver();
    proxy.setPlan({ PUT: ['lose-answer'], '*': ['pass'] });
    expect(await reasonOf(storage.storePrivateResume(request()))).toBe('STORED');
    expect(proxy.log.some((e) => e.method === 'DELETE')).toBe(false);
    expect((await readObject(KEY)).equals(pdf)).toBe(true);
  });

  it('through Apply (lost answer, source changed while sent): 503, no Application, the replacement survives', async () => {
    const storage = await driver({ changedSource: true });
    env = await createApplyEnvironment({ jobs: [qaJob()], transport: recordingTransport('accept'), storage });
    const seen = {};
    proxy.setPlan({ PUT: ['lose-answer'], HEAD: [observeThenReplace(seen)], '*': ['pass'] });
    const response = await applyRequest(env.app, { resume: { data: pdf, filename: 'qa.pdf', contentType: 'application/pdf' } });
    expect(response.status).toBe(503);
    await expectReplacementSurvived(seen);
    expect(env.applications.all()).toEqual([]);
    expect(proxy.log.filter((e) => e.method === 'DELETE')).toEqual([expect.objectContaining({ versionId: seen.observedVersion })]);
  });

  it('deletePrivateObject (compensation, retention, reconciliation): bound to the version its HEAD saw; a later replacement survives', async () => {
    const storage = await driver();
    proxy.setPlan({ '*': ['pass'] });
    await storage.storePrivateResume(request());
    const seen = {};
    proxy.log.length = 0;
    proxy.setPlan({ HEAD: [observeThenReplace(seen)], '*': ['pass'] });
    expect(await storage.deletePrivateObject(KEY)).toEqual({ deleted: true });
    await expectReplacementSurvived(seen);
    expect(proxy.log.filter((e) => e.method === 'DELETE')).toEqual([expect.objectContaining({ versionId: seen.observedVersion })]);
  });

  it('a normal deletion on the versioned store leaves NO copy behind (no noncurrent version, no delete marker)', async () => {
    const storage = await driver();
    proxy.setPlan({ '*': ['pass'] });
    await storage.storePrivateResume(request());
    expect(await storage.deletePrivateObject(KEY)).toEqual({ deleted: true });
    expect(await listVersions()).toEqual({ versions: [], deleteMarkers: [] });
  });
});

/* ---------------------------------------------------- 2. the start-up probe -- */

describe('start-up: the probe is removed by its own generation, and cleanup is confirmed before readiness', () => {
  const probeKeys = (bucket) => listKeys('resumes/', { bucket });

  it('POSITIVE CONTROL — a private, versioned store: ready; the probe DELETE named its version; nothing left (no version, no marker)', async () => {
    const storage = await driver({ init: false });
    proxy.setPlan({ '*': ['pass'] });
    await storage.init();
    expect(storage.isReady).toBe(true);
    const deletes = proxy.log.filter((e) => e.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].versionId).toBeTruthy();
    expect(await listVersions()).toEqual({ versions: [], deleteMarkers: [] });
  });

  it('a store that cannot bind a deletion (versioning off): NOT ready (DELETE_BINDING_UNAVAILABLE); no DELETE; the probe preserved and its reference logged', async () => {
    const log = capturingLogger();
    const storage = await driver({ bucket: moto().unversionedBucket, init: false, logger: log.logger });
    proxy.setPlan({ '*': ['pass'] });
    const error = await storage.init().catch((e) => e);
    expect(error).toBeInstanceOf(StorageInitializationError);
    expect(error.reason).toBe('DELETE_BINDING_UNAVAILABLE');
    expect(error.message).toBe('private storage initialisation failed: DELETE_BINDING_UNAVAILABLE');
    expect(storage.isReady).toBe(false);
    expect(proxy.log.some((e) => e.method === 'DELETE')).toBe(false);
    const left = await probeKeys(moto().unversionedBucket);
    expect(left).toHaveLength(1);
    const events = entries(log);
    expect(events).toContainEqual(expect.objectContaining({ event: 'storage_capability_missing', capability: 'VERSION_BOUND_DELETE' }));
    expect(events).toContainEqual(expect.objectContaining({ event: 'storage_probe_cleanup_unconfirmed', step: 'NO_DELETE_BINDING', objectRef: storageObjectRef(left[0]) }));
    expect(log.output()).not.toContain(left[0]);
  });

  it('a replacement placed after the final ownership observation (after the anonymous read, before the DELETE): it survives; NOT ready (PROBE_CLEANUP_FAILED)', async () => {
    const log = capturingLogger();
    const storage = await driver({ init: false, logger: log.logger });
    const seen = {};
    let probeKey = null;
    proxy.setPlan({
      '*': [
        (req) => {
          if (req.method === 'PUT') probeKey = decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/').slice(2).join('/'));
          if (!req.anonymous) return 'pass';
          return {
            afterUpstream: async () => {
              const stored = await readObject(probeKey);
              seen.replacementBytes = stored;
              seen.replacement = await putObject(probeKey, stored, { attempt: FOREIGN }, { as: 'fixture' });
            },
          };
        },
      ],
    });
    const error = await storage.init().catch((e) => e);
    expect(error).toBeInstanceOf(StorageInitializationError);
    expect(error.reason).toBe('PROBE_CLEANUP_FAILED');
    expect(storage.isReady).toBe(false);
    await expectReplacementSurvived(seen, { key: probeKey });
    expect(proxy.log.find((e) => e.anonymous)).toMatchObject({ upstreamStatus: 403 });
    const deletes = proxy.log.filter((e) => e.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].versionId).toBeTruthy();
    expect(deletes[0].versionId).not.toBe(seen.replacement.versionId);
    expect(entries(log)).toContainEqual(expect.objectContaining({ event: 'storage_probe_cleanup_unconfirmed', step: 'KEY_OCCUPIED' }));
  });

  it('after an UNCERTAIN probe PUT, a replacement placed after the HEAD that observed ownership survives the bound cleanup; NOT ready', async () => {
    const storage = await driver({ init: false });
    const seen = {};
    let probeKey = null;
    let heads = 0;
    proxy.setPlan({
      '*': [
        (req) => {
          if (req.method === 'PUT') {
            probeKey = decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/').slice(2).join('/'));
            return 'lose-answer';
          }
          if (req.method === 'HEAD' && (heads += 1) === 1) return observeThenReplace(seen, { key: probeKey });
          return 'pass';
        },
      ],
    });
    const error = await storage.init().catch((e) => e);
    expect(error).toBeInstanceOf(StorageInitializationError);
    expect(storage.isReady).toBe(false);
    await expectReplacementSurvived(seen, { key: probeKey });
    expect(proxy.log.filter((e) => e.method === 'DELETE')).toEqual([expect.objectContaining({ versionId: seen.observedVersion })]);
  });

  it('cleanup unconfirmed — the bound DELETE answers 204 but the version is still there: NOT ready (PROBE_CLEANUP_FAILED)', async () => {
    const storage = await driver({ init: false });
    proxy.setPlan({ DELETE: [{ respond: { status: 204 } }], '*': ['pass'] });
    const error = await storage.init().catch((e) => e);
    expect(error.reason).toBe('PROBE_CLEANUP_FAILED');
    expect(storage.isReady).toBe(false);
    expect((await listVersions()).versions).toHaveLength(1);
  });
});
