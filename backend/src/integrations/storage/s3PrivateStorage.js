import { createHash, randomBytes } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { open as openFile } from 'node:fs/promises';
import path from 'node:path';
import { RESUME_UPLOAD_POLICY } from '../../config/resumePolicy.js';
import {
  PrivateStorageError,
  STORAGE_PROVIDERS,
  StorageInitializationError,
  generateResumeStorageKey,
  isResumeStorageKey,
  storageObjectRef,
} from './storageContract.js';
import { errorCodeOf, parseListing, s3Request } from './s3/s3Http.js';

/**
 * S3-compatible private résumé storage — C6-T4 (C6 plan revision 3, step 2a).
 *
 * The same B4 interface as LocalPrivateStorage (privateStorage.js): provider,
 * isReady, init, storePrivateResume, deletePrivateObject, statPrivateObject,
 * listPrivateObjects, close. Selected only by RESUME_STORAGE_DRIVER=s3; there
 * is never a fallback to disk. Doc 15 sections 97-106, Doc 13 sections
 * 108-111, Doc 09 sections 101-108.
 *
 * WHAT IS THE SAME AS THE LOCAL DRIVER
 *   - keys: resumes/{32 hex}/{32 hex}, server-generated (storageContract.js);
 *   - size and SHA-256 are verified again while the bytes are sent; what is
 *     stored is exactly what was validated, or nothing is reported stored;
 *   - an object is never overwritten (PUT with If-None-Match: *; a 412 is a
 *     key collision and a new key is generated);
 *   - every failure is a PrivateStorageError with a fixed reason; no key,
 *     endpoint, bucket, credential or provider message reaches a log or an
 *     error message. Where an operator must find one object, the log carries
 *     its one-way reference (storageObjectRef);
 *   - no read, URL or presigned operation: résumés are never retrieved in
 *     Phase 1 (Doc 09 section 170).
 *
 * THE OUTCOME OF A WRITE (object-first persistence, Doc 09 sections 116-119)
 *   - an answer 200: verified (the local hash and count, then a HEAD of the
 *     object for its length and SHA-256 metadata) — stored;
 *   - a definite refusal (4xx), or no connection at all: nothing was written —
 *     the failure is PROVEN;
 *   - a lost answer (reset, timeout) or a 5xx after the request was sent: the
 *     write MAY have happened. The driver asks the store (HEAD of the same,
 *     unique key): the object, complete and matching — stored; absent —
 *     reported as UNAVAILABLE, with the object reference logged in case a late
 *     write lands; the store does not answer — OUTCOME_UNKNOWN, logged with the
 *     reference. Either way no Application is created, the object (if any) is
 *     unreferenced, and reconciliation (orphanReconciliation.js) finds it.
 *   The driver only ever deletes an object under the key IT generated for the
 *   current write, and only when that object is proven wrong (integrity).
 *
 * WHAT IS NOT VERIFIED LOCALLY
 *   The provider's access policy, encryption at rest, region or jurisdiction,
 *   and restore behaviour need the real provider (C6 plan sections 3.4 and 5).
 *   init() does check that an anonymous request cannot read the probe object.
 */

const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
const PROBE_PREFIX = 'probes/';
const OBJECT_PREFIX = 'resumes/';
const MAX_KEY_ATTEMPTS = 3;
const MAX_LIST_PAGES = 10_000;

function reasonForStatus(status, code) {
  if (status === 403 || status === 401) return 'PERMISSION_DENIED';
  if (status === 404 && code === 'NoSuchBucket') return 'BUCKET_NOT_FOUND';
  if (status === 412) return 'KEY_COLLISION';
  if (status === 400 && (code === 'BadDigest' || code === 'XAmzContentSHA256Mismatch' || code === 'InvalidDigest' || code === 'IncompleteBody')) return 'INTEGRITY_MISMATCH';
  if (status === 429 || status >= 500) return 'UNAVAILABLE';
  return 'PROVIDER_ERROR';
}

/** A transport outcome without an answer, as a fixed reason. */
function reasonForTransport(outcome) {
  if (outcome.kind === 'not-sent') return /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO|DEPTH_ZERO|ALTNAME|HOSTNAME/.test(outcome.code) ? 'TLS_FAILURE' : 'UNAVAILABLE';
  return 'UNAVAILABLE';
}

export class S3PrivateStorage {
  #endpoint;
  #state = 'created';
  #logger;
  #clock;
  #maxBytes;
  #generateKey;
  #openFile;

  /**
   * @param {object} options
   * @param {object} options.s3          the validated configuration (config/env.js resumeStorage.s3)
   * @param {object} [options.logger]
   * @param {Function} [options.clock]
   * @param {Function} [options.generateKey] TEST SEAM (collisions)
   * @param {Function} [options.openFile]    TEST SEAM (unreadable source)
   */
  constructor({ s3, logger, clock = () => new Date(), maxBytes = RESUME_UPLOAD_POLICY.maxBytes, generateKey = generateResumeStorageKey, openFile: openImpl = openFile } = {}) {
    const credentials = s3?.credentials;
    if (!s3 || !(s3.endpoint instanceof URL) || typeof s3.bucket !== 'string' || typeof s3.region !== 'string' || !credentials?.accessKeyId || !credentials?.secretAccessKey) {
      throw new StorageInitializationError('INVALID_REQUEST');
    }
    this.#endpoint = Object.freeze({
      url: s3.endpoint,
      region: s3.region,
      bucket: s3.bucket,
      urlStyle: s3.urlStyle === 'virtual' ? 'virtual' : 'path',
      timeoutMs: Number.isInteger(s3.timeoutMs) ? s3.timeoutMs : 15_000,
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    });
    this.#logger = logger;
    this.#clock = clock;
    this.#maxBytes = maxBytes;
    this.#generateKey = generateKey;
    this.#openFile = openImpl;
  }

  /** Never serialise the endpoint or the credentials. */
  toJSON() {
    return { provider: this.provider, isReady: this.isReady };
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `S3PrivateStorage { provider: '${this.provider}', isReady: ${this.isReady} }`;
  }

  get provider() {
    return STORAGE_PROVIDERS.S3_COMPATIBLE;
  }

  get isReady() {
    return this.#state === 'ready';
  }

  /**
   * Proves the store works before the service reports it ready: writes a
   * probe object (If-None-Match), checks it with HEAD, checks that an
   * ANONYMOUS read of it is refused, and deletes it. Any failure — bad
   * credentials, a missing bucket, an unreachable or untrusted (TLS)
   * endpoint, a publicly readable object — is a StorageInitializationError.
   */
  async init() {
    try {
      await this.#init();
    } catch (error) {
      // So the start-up message can give the S3 advice, not the local-directory advice.
      if (error instanceof StorageInitializationError) error.driver = 's3';
      throw error;
    }
  }

  async #init() {
    if (this.#state === 'ready') return;
    if (this.#state === 'closed') throw new StorageInitializationError('NOT_READY');
    const probeKey = `${PROBE_PREFIX}${randomBytes(16).toString('hex')}`;
    const body = Buffer.from(`valida storage probe ${probeKey}`, 'utf8');
    const digest = createHash('sha256').update(body).digest('hex');
    const put = await s3Request(this.#endpoint, {
      method: 'PUT',
      key: probeKey,
      headers: { 'content-type': 'application/octet-stream', 'if-none-match': '*', 'x-amz-meta-sha256': digest },
      body: Readable.from([body]),
      contentLength: body.length,
      payloadSha256: digest,
    });
    if (put.kind !== 'response') throw new StorageInitializationError(reasonForTransport(put));
    if (put.status !== 200) throw new StorageInitializationError(reasonForStatus(put.status, errorCodeOf(put.body)));
    try {
      const head = await s3Request(this.#endpoint, { method: 'HEAD', key: probeKey });
      if (head.kind !== 'response') throw new StorageInitializationError(reasonForTransport(head));
      if (head.status !== 200 || Number(head.headers['content-length']) !== body.length) throw new StorageInitializationError('PROBE_MISMATCH');
      const anonymous = await s3Request(this.#endpoint, { method: 'GET', key: probeKey, anonymous: true, maxBody: 256 });
      if (anonymous.kind === 'response' && anonymous.status >= 200 && anonymous.status < 300) throw new StorageInitializationError('PUBLIC_ACCESS');
    } finally {
      await s3Request(this.#endpoint, { method: 'DELETE', key: probeKey }).catch(() => {});
    }
    this.#state = 'ready';
  }

  /**
   * Stores an already validated file under a NEW key. Resolves only once the
   * object is in the store, complete, with the expected length and SHA-256.
   */
  async storePrivateResume({ filePath, sizeBytes, checksumSha256 } = {}) {
    this.#assertReady('store');
    if (
      typeof filePath !== 'string' ||
      !path.isAbsolute(filePath) ||
      !Number.isInteger(sizeBytes) ||
      sizeBytes < 1 ||
      sizeBytes > this.#maxBytes ||
      typeof checksumSha256 !== 'string' ||
      !CHECKSUM_PATTERN.test(checksumSha256)
    ) {
      throw new PrivateStorageError('store', 'INVALID_REQUEST');
    }
    for (let attempt = 1; attempt <= MAX_KEY_ATTEMPTS; attempt += 1) {
      const storageKey = this.#generateKey();
      if (!isResumeStorageKey(storageKey)) throw new PrivateStorageError('store', 'INVALID_KEY');
      const outcome = await this.#putOnce({ storageKey, filePath, sizeBytes, checksumSha256 });
      if (outcome === 'COLLISION') continue;
      return { storageProvider: this.provider, storageKey, sizeBytes, checksumSha256, storedAt: this.#clock() };
    }
    throw new PrivateStorageError('store', 'KEY_COLLISION');
  }

  /** @returns {'STORED' | 'COLLISION'}; throws PrivateStorageError otherwise. */
  async #putOnce({ storageKey, filePath, sizeBytes, checksumSha256 }) {
    let source;
    try {
      source = await this.#openFile(filePath, 'r');
    } catch (error) {
      throw new PrivateStorageError('store', 'SOURCE_UNREADABLE', error);
    }
    const hash = createHash('sha256');
    let count = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        count += chunk.length;
        if (count > sizeBytes) {
          callback(new PrivateStorageError('store', 'INTEGRITY_MISMATCH'));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
      flush(callback) {
        // Fewer bytes than validated: the source changed. Never sent as complete.
        callback(count === sizeBytes ? null : new PrivateStorageError('store', 'INTEGRITY_MISMATCH'));
      },
    });
    const stream = source.createReadStream();
    stream.on('error', (error) => meter.destroy(error));
    stream.pipe(meter);
    let put;
    try {
      put = await s3Request(this.#endpoint, {
        method: 'PUT',
        key: storageKey,
        headers: {
          'content-type': 'application/octet-stream',
          'if-none-match': '*',
          'x-amz-checksum-sha256': Buffer.from(checksumSha256, 'hex').toString('base64'),
          'x-amz-meta-sha256': checksumSha256,
        },
        body: meter,
        contentLength: sizeBytes,
        // A provider that checks the payload hash refuses any other bytes.
        payloadSha256: checksumSha256,
      });
    } finally {
      await source.close().catch(() => {});
    }
    // What was actually read from the source, when all of it was read.
    const localDigest = count === sizeBytes ? hash.digest('hex') : null;
    const localMatches = () => localDigest === checksumSha256;

    // The source gave more or fewer bytes than validated: the request was cut
    // short. Nothing complete can have been stored; if it got through to the
    // store at all, whatever is there under this write's own key is removed.
    if (put.kind !== 'response' && put.code === 'INTEGRITY_MISMATCH') {
      if (put.kind === 'uncertain') {
        const resolved = await this.#verifyStored(storageKey, sizeBytes, checksumSha256);
        if (resolved === 'MATCH' || resolved === 'MISMATCH') await this.#discardOwnObject(storageKey, 'LOCAL_INTEGRITY_MISMATCH');
      }
      throw new PrivateStorageError('store', 'INTEGRITY_MISMATCH');
    }
    if (put.kind === 'not-sent') throw new PrivateStorageError('store', reasonForTransport(put));
    if (put.kind === 'response') {
      if (put.status === 200) {
        if (!localMatches()) {
          await this.#discardOwnObject(storageKey, 'LOCAL_INTEGRITY_MISMATCH');
          throw new PrivateStorageError('store', 'INTEGRITY_MISMATCH');
        }
        const check = await this.#verifyStored(storageKey, sizeBytes, checksumSha256);
        if (check === 'MATCH') return 'STORED';
        if (check === 'MISMATCH') {
          await this.#discardOwnObject(storageKey, 'STORED_OBJECT_MISMATCH');
          throw new PrivateStorageError('store', 'INTEGRITY_MISMATCH');
        }
        // Accepted, but not visible or not checkable: treat as uncertain.
        return this.#resolveUncertain(storageKey, sizeBytes, checksumSha256, 'ACCEPTED_BUT_UNVERIFIED');
      }
      if (put.status === 412) return 'COLLISION';
      const reason = reasonForStatus(put.status, errorCodeOf(put.body));
      // A server error after the request was sent leaves the outcome open.
      if (reason === 'UNAVAILABLE' && put.status >= 500) return this.#resolveUncertain(storageKey, sizeBytes, checksumSha256, 'SERVER_ERROR');
      throw new PrivateStorageError('store', reason);
    }
    // Lost answer: the write may have happened.
    if (localDigest !== null && localDigest !== checksumSha256) {
      const resolved = await this.#verifyStored(storageKey, sizeBytes, checksumSha256);
      if (resolved === 'MATCH' || resolved === 'MISMATCH') await this.#discardOwnObject(storageKey, 'LOCAL_INTEGRITY_MISMATCH');
      throw new PrivateStorageError('store', 'INTEGRITY_MISMATCH');
    }
    return this.#resolveUncertain(storageKey, sizeBytes, checksumSha256, 'ANSWER_LOST');
  }

  /** 'MATCH' | 'MISMATCH' | 'ABSENT' | 'UNKNOWN' */
  async #verifyStored(storageKey, sizeBytes, checksumSha256) {
    const head = await s3Request(this.#endpoint, { method: 'HEAD', key: storageKey });
    if (head.kind !== 'response') return 'UNKNOWN';
    if (head.status === 404) return 'ABSENT';
    if (head.status !== 200) return 'UNKNOWN';
    const length = Number(head.headers['content-length']);
    const recorded = head.headers['x-amz-meta-sha256'];
    return length === sizeBytes && recorded === checksumSha256 ? 'MATCH' : 'MISMATCH';
  }

  async #resolveUncertain(storageKey, sizeBytes, checksumSha256, why) {
    const objectRef = storageObjectRef(storageKey);
    const state = await this.#verifyStored(storageKey, sizeBytes, checksumSha256);
    if (state === 'MATCH') {
      this.#logger?.warn({ event: 'storage_write_outcome_resolved', objectRef, why, outcome: 'STORED' }, 'storage write answer was lost; the object is present and verified');
      return 'STORED';
    }
    if (state === 'MISMATCH') {
      await this.#discardOwnObject(storageKey, 'STORED_OBJECT_MISMATCH');
      throw new PrivateStorageError('store', 'INTEGRITY_MISMATCH');
    }
    if (state === 'ABSENT') {
      this.#logger?.warn({ event: 'storage_write_outcome_resolved', objectRef, why, outcome: 'ABSENT' }, 'storage write answer was lost; the object is absent (a late write would be found by reconciliation)');
      throw new PrivateStorageError('store', 'UNAVAILABLE');
    }
    this.#logger?.error({ event: 'storage_write_outcome_unknown', objectRef, why }, 'storage write outcome unknown; any object is unreferenced and left for reconciliation');
    throw new PrivateStorageError('store', 'OUTCOME_UNKNOWN');
  }

  /** Deletes the object under a key generated for THIS write — never any other. */
  async #discardOwnObject(storageKey, why) {
    const result = await s3Request(this.#endpoint, { method: 'DELETE', key: storageKey });
    if (result.kind !== 'response' || (result.status !== 204 && result.status !== 200 && result.status !== 404)) {
      this.#logger?.error({ event: 'storage_discard_failed', objectRef: storageObjectRef(storageKey), why }, 'a rejected object could not be removed; left for reconciliation');
    }
  }

  async deletePrivateObject(storageKey) {
    this.#assertReady('delete');
    if (!isResumeStorageKey(storageKey)) throw new PrivateStorageError('delete', 'INVALID_KEY');
    const head = await s3Request(this.#endpoint, { method: 'HEAD', key: storageKey });
    if (head.kind !== 'response') throw new PrivateStorageError('delete', reasonForTransport(head));
    if (head.status === 404) return { deleted: false, reason: 'NOT_FOUND' };
    if (head.status !== 200) throw new PrivateStorageError('delete', reasonForStatus(head.status, null));
    const result = await s3Request(this.#endpoint, { method: 'DELETE', key: storageKey });
    if (result.kind !== 'response') throw new PrivateStorageError('delete', reasonForTransport(result));
    if (result.status === 204 || result.status === 200) return { deleted: true };
    if (result.status === 404) return { deleted: false, reason: 'NOT_FOUND' };
    throw new PrivateStorageError('delete', reasonForStatus(result.status, errorCodeOf(result.body)));
  }

  async statPrivateObject(storageKey) {
    this.#assertReady('stat');
    if (!isResumeStorageKey(storageKey)) throw new PrivateStorageError('stat', 'INVALID_KEY');
    const head = await s3Request(this.#endpoint, { method: 'HEAD', key: storageKey });
    if (head.kind !== 'response') throw new PrivateStorageError('stat', reasonForTransport(head));
    if (head.status === 404) return { exists: false };
    if (head.status !== 200) throw new PrivateStorageError('stat', reasonForStatus(head.status, null));
    return { exists: true, sizeBytes: Number(head.headers['content-length']) };
  }

  /**
   * Every object under resumes/, for orphan reconciliation only: keys, sizes
   * and modification times; no content. An S3 write is atomic, so there are
   * no partial objects; a key that is not a résumé key is counted as
   * unexpected and never touched.
   */
  async listPrivateObjects() {
    this.#assertReady('list');
    const result = { objects: [], partials: [], unexpected: 0, notConfined: 0 };
    let token = null;
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const query = { 'list-type': '2', prefix: OBJECT_PREFIX, 'max-keys': '1000', ...(token ? { 'continuation-token': token } : {}) };
      const response = await s3Request(this.#endpoint, { method: 'GET', query, maxBody: 8 * 1024 * 1024 });
      if (response.kind !== 'response') throw new PrivateStorageError('list', reasonForTransport(response));
      if (response.status !== 200) throw new PrivateStorageError('list', reasonForStatus(response.status, errorCodeOf(response.body)));
      const listing = parseListing(response.body);
      for (const entry of listing.entries) {
        if (isResumeStorageKey(entry.key) && Number.isInteger(entry.size) && entry.lastModified instanceof Date && !Number.isNaN(entry.lastModified.getTime())) {
          result.objects.push({ storageKey: entry.key, sizeBytes: entry.size, modifiedAt: entry.lastModified });
        } else {
          result.unexpected += 1;
        }
      }
      if (!listing.truncated) return result;
      if (!listing.nextToken) throw new PrivateStorageError('list', 'PROVIDER_ERROR');
      token = listing.nextToken;
    }
    throw new PrivateStorageError('list', 'PROVIDER_ERROR');
  }

  async close() {
    this.#state = 'closed';
  }

  #assertReady(operation) {
    if (this.#state !== 'ready') throw new PrivateStorageError(operation, 'NOT_READY');
  }
}
