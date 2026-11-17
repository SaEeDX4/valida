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
import { errorCodeOf, parseListObjectsV2, s3Request } from './s3/s3Http.js';

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
 *     write MAY have happened. The driver asks the store (HEAD of the same
 *     key) and decides by OWNERSHIP (C6-T4 correction 1, finding 1):
 *
 *   OWNERSHIP. A matching key, length and digest do not identify the write
 *   attempt: another writer (or an earlier attempt) can have put identical
 *   bytes there. Every PUT therefore carries a FRESH random marker of its own
 *   (x-amz-meta-attempt, 128 bits, never reused, never logged). After an
 *   uncertain outcome, an object is this attempt's only when its marker is
 *   this attempt's marker:
 *     - own, complete and matching            -> stored (adopted);
 *     - own, wrong (an integrity failure)     -> deleted (it is this write's);
 *     - present, marker absent or different   -> NOT OWNED: never adopted,
 *       never deleted; preserved for reconciliation; OUTCOME_UNKNOWN (the
 *       generic 503 at Apply), logged with the object reference;
 *     - absent                                -> ABSENT_AT_OBSERVATION: only
 *       that nothing was there when the HEAD looked. A timed-out PUT may still
 *       land later; the reference is logged and reconciliation finds it;
 *       UNAVAILABLE;
 *     - the store does not answer             -> OUTCOME_UNKNOWN.
 *   The same check governs the local-integrity paths: the driver deletes only
 *   an object whose marker proves it is this attempt's.
 *
 *   GENERATION-BOUND DELETION (correction 2). An observation of ownership is
 *   not, by itself, a licence to delete: between the HEAD and a DELETE, a
 *   writer outside this driver (one that does not use If-None-Match) could
 *   replace the object, even with identical bytes. A plain DELETE, a second
 *   HEAD, a random key or a content-only ETag cannot tell that replacement
 *   apart. So every deletion names the exact object GENERATION observed —
 *   `DELETE ?versionId=<the version the HEAD reported with this attempt's
 *   marker>` — and removes that generation only; a replacement is a different
 *   version and survives. This needs one provider capability, tracked
 *   explicitly as REQUIRED_CAPABILITIES.VERSION_BOUND_DELETE: bucket
 *   versioning enabled, a version id on PUT and HEAD, and DELETE/HEAD by
 *   version id (s3:GetObjectVersion, s3:DeleteObjectVersion). Where a HEAD
 *   reports no version id, nothing is deleted: the object is preserved, its
 *   one-way reference is logged (`storage_discard_skipped`, outcome
 *   NO_DELETE_BINDING) for reconciliation, and the generic failure stands.
 *   init() refuses to start (DELETE_BINDING_UNAVAILABLE) on a store without
 *   the capability, because its own probe could not be removed safely.
 *
 * WHAT IS NOT VERIFIED LOCALLY
 *   The provider's access policy, encryption at rest, region or jurisdiction,
 *   and restore behaviour need the real provider (C6 plan sections 3.4 and 5).
 *   init() checks, conclusively, that an anonymous request is DENIED reading a
 *   representative résumé key (correction 1, finding 2); that proves the
 *   result for that one key at start-up, not the provider's policy as a whole.
 *   Whether the chosen provider offers VERSION_BOUND_DELETE (and how its
 *   versioning interacts with retention, lifecycle and restore) is a hosted
 *   check, tracked separately.
 */

const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
const OBJECT_PREFIX = 'resumes/';
const MAX_KEY_ATTEMPTS = 3;
const MAX_LIST_PAGES = 10_000;
const MAX_LIST_OBJECTS = 1_000_000;
const DEFAULT_LIST_PAGE_SIZE = 1000;
const ATTEMPT_HEADER = 'x-amz-meta-attempt';
const PROBE_BODY_PREFIX = 'valida synthetic storage probe; contains no personal data; ';
const freshMarker = () => randomBytes(16).toString('hex');
const VERSION_HEADER = 'x-amz-version-id';

/**
 * C6-T4 correction 2 — the provider capabilities this driver relies on,
 * named so they are verified (at start-up) and tracked (hosted check) one by one.
 */
export const REQUIRED_CAPABILITIES = Object.freeze({
  VERSION_BOUND_DELETE: 'VERSION_BOUND_DELETE', // versioning on; version ids on PUT/HEAD; DELETE and HEAD by versionId
});

/** A version id the store can bind an operation to ('null' is S3's word for "unversioned"). */
function boundVersion(headers) {
  const value = headers?.[VERSION_HEADER];
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 && value !== 'null' ? value : null;
}

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

/**
 * The anonymous read of the start-up probe (finding 2): 'DENIED' only for an
 * explicit 401/403 that does not carry the probe's bytes; a 2xx is
 * 'PUBLIC_ACCESS'; everything else is 'PUBLIC_ACCESS_UNVERIFIED'.
 */
function anonymousVerdict(outcome, probeBody) {
  if (outcome.kind !== 'response') return 'PUBLIC_ACCESS_UNVERIFIED';
  if (outcome.status >= 200 && outcome.status < 300) return 'PUBLIC_ACCESS';
  if (outcome.status === 401 || outcome.status === 403) {
    return outcome.bytes && outcome.bytes.includes(probeBody) ? 'PUBLIC_ACCESS' : 'DENIED';
  }
  return 'PUBLIC_ACCESS_UNVERIFIED';
}

export class S3PrivateStorage {
  #endpoint;
  #state = 'created';
  #logger;
  #clock;
  #maxBytes;
  #generateKey;
  #openFile;
  #listPageSize;

  /**
   * @param {object} options
   * @param {object} options.s3          the validated configuration (config/env.js resumeStorage.s3)
   * @param {object} [options.logger]
   * @param {Function} [options.clock]
   * @param {Function} [options.generateKey] TEST SEAM (collisions)
   * @param {Function} [options.openFile]    TEST SEAM (unreadable source)
   * @param {number}   [options.listPageSize] TEST SEAM (multi-page listings), 1..1000
   */
  constructor({ s3, logger, clock = () => new Date(), maxBytes = RESUME_UPLOAD_POLICY.maxBytes, generateKey = generateResumeStorageKey, openFile: openImpl = openFile, listPageSize = DEFAULT_LIST_PAGE_SIZE } = {}) {
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
    if (!Number.isInteger(listPageSize) || listPageSize < 1 || listPageSize > DEFAULT_LIST_PAGE_SIZE) throw new StorageInitializationError('INVALID_REQUEST');
    this.#listPageSize = listPageSize;
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
   * Proves the store works before the service reports it ready (C6-T4,
   * conclusive since correction 1, finding 2):
   *   1. writes a disposable SYNTHETIC probe under a REPRESENTATIVE résumé key
   *      (resumes/{32 hex}/{32 hex}, from the same generator as uploads, so the
   *      same access policy applies to it as to an uploaded résumé), with
   *      If-None-Match and this probe's own ownership marker;
   *   2. checks it with HEAD (length and marker);
   *   3. reads it ANONYMOUSLY and requires an EXPLICIT denial (401 or 403, the
   *      supported provider contract). A 2xx is PUBLIC_ACCESS; anything else —
   *      a redirect, a 404, a 5xx, a reset, a timeout — is inconclusive:
   *      PUBLIC_ACCESS_UNVERIFIED. Neither is ever "ready";
   *   4. deletes it and CONFIRMS the deletion (the DELETE answered 200/204 and a
   *      HEAD then answers 404). Cleanup that cannot be confirmed is
   *      PROBE_CLEANUP_FAILED, unless an earlier step already failed (that
   *      reason is kept; the cleanup failure is logged with the reference).
   * Every failure is a StorageInitializationError with a fixed reason and a
   * sanitised message; there is no fallback to local storage.
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
    const probeKey = generateResumeStorageKey();
    const marker = freshMarker();
    const body = Buffer.from(`${PROBE_BODY_PREFIX}${randomBytes(16).toString('hex')}`, 'utf8');
    const digest = createHash('sha256').update(body).digest('hex');
    const put = await s3Request(this.#endpoint, {
      method: 'PUT',
      key: probeKey,
      headers: { 'content-type': 'application/octet-stream', 'if-none-match': '*', 'x-amz-meta-sha256': digest, [ATTEMPT_HEADER]: marker },
      body: Readable.from([body]),
      contentLength: body.length,
      payloadSha256: digest,
    });
    if (put.kind === 'not-sent') throw new StorageInitializationError(reasonForTransport(put));
    let failure = null;
    if (put.kind !== 'response') failure = new StorageInitializationError(reasonForTransport(put));
    else if (put.status !== 200) {
      // A definite refusal wrote nothing; a 5xx may have.
      if (put.status < 500) throw new StorageInitializationError(reasonForStatus(put.status, errorCodeOf(put.body)));
      failure = new StorageInitializationError(reasonForStatus(put.status, errorCodeOf(put.body)));
    }
    // The generation this probe created, as the store reported it (correction 2).
    let probeVersion = put.kind === 'response' && put.status === 200 ? boundVersion(put.headers) : null;
    if (!failure) {
      try {
        const head = await s3Request(this.#endpoint, { method: 'HEAD', key: probeKey });
        if (head.kind !== 'response') throw new StorageInitializationError(reasonForTransport(head));
        if (head.status !== 200 || Number(head.headers['content-length']) !== body.length || head.headers[ATTEMPT_HEADER] !== marker) throw new StorageInitializationError('PROBE_MISMATCH');
        // The HEAD that saw this probe's marker must name the same generation the PUT reported.
        if (probeVersion !== null && boundVersion(head.headers) !== probeVersion) throw new StorageInitializationError('PROBE_MISMATCH');
        const anonymous = await s3Request(this.#endpoint, { method: 'GET', key: probeKey, anonymous: true, maxBody: 4096 });
        const verdict = anonymousVerdict(anonymous, body);
        if (verdict !== 'DENIED') throw new StorageInitializationError(verdict);
      } catch (error) {
        failure = error;
      }
    }
    if (put.kind === 'response' && put.status === 200 && probeVersion === null) {
      this.#logger?.error({ event: 'storage_capability_missing', capability: REQUIRED_CAPABILITIES.VERSION_BOUND_DELETE }, 'the store reports no object version: a deletion cannot be bound to the object observed');
      this.#logger?.error({ event: 'storage_probe_cleanup_unconfirmed', objectRef: storageObjectRef(probeKey), step: 'NO_DELETE_BINDING' }, 'the start-up probe could not be confirmed removed; left for reconciliation');
      if (failure) throw failure;
      throw new StorageInitializationError('DELETE_BINDING_UNAVAILABLE');
    }
    const cleanup = await this.#removeProbe(probeKey, marker, probeVersion, put.kind !== 'response' || put.status >= 500);
    if (failure) throw failure;
    if (cleanup !== 'CONFIRMED') throw new StorageInitializationError(cleanup);
    this.#state = 'ready';
  }

  /**
   * Removes the probe's OWN generation and confirms it is gone (correction 2).
   * Returns 'CONFIRMED', 'DELETE_BINDING_UNAVAILABLE' (the store gave no
   * version id to bind the deletion to: nothing is deleted, the probe is
   * preserved for reconciliation) or 'PROBE_CLEANUP_FAILED'.
   *   - The DELETE names the version this probe created (from the PUT answer
   *     or, after an uncertain PUT, from a HEAD that showed this probe's
   *     marker); a replacement under the key is another version and survives.
   *   - Confirmed only when a HEAD of that version answers 404 AND the key
   *     holds no current object: a replacement found there is preserved, but
   *     the key is not clean, so start-up is refused (step KEY_OCCUPIED).
   */
  async #removeProbe(probeKey, marker, knownVersion, putUncertain = false) {
    const objectRef = storageObjectRef(probeKey);
    const unconfirmed = (step, reason = 'PROBE_CLEANUP_FAILED') => {
      this.#logger?.error({ event: 'storage_probe_cleanup_unconfirmed', objectRef, step }, 'the start-up probe could not be confirmed removed; left for reconciliation');
      return reason;
    };
    let version = knownVersion;
    if (version === null) {
      const seen = await this.#inspect(probeKey, marker);
      if (seen.state === 'ABSENT') {
        // After a PUT whose answer was lost, "absent" holds only at observation: a late write may land.
        if (putUncertain) this.#logger?.warn({ event: 'storage_write_outcome_unobserved', objectRef, why: 'PROBE', outcome: 'ABSENT_AT_OBSERVATION' }, 'the start-up probe was absent when checked; a late write would be found by reconciliation');
        return putUncertain ? 'CONFIRMED' : unconfirmed('ABSENT_AFTER_WRITE');
      }
      if (seen.state === 'UNKNOWN') return unconfirmed('HEAD');
      if (seen.state === 'NOT_OWNED') return unconfirmed('NOT_OWNED');
      if (seen.versionId === null) {
        this.#logger?.error({ event: 'storage_capability_missing', capability: REQUIRED_CAPABILITIES.VERSION_BOUND_DELETE }, 'the store reports no object version: a deletion cannot be bound to the object observed');
        return unconfirmed('NO_DELETE_BINDING', 'DELETE_BINDING_UNAVAILABLE');
      }
      version = seen.versionId;
    }
    const removed = await s3Request(this.#endpoint, { method: 'DELETE', key: probeKey, query: { versionId: version } });
    if (removed.kind !== 'response' || (removed.status !== 204 && removed.status !== 200)) return unconfirmed('DELETE');
    const gone = await s3Request(this.#endpoint, { method: 'HEAD', key: probeKey, query: { versionId: version } });
    if (gone.kind !== 'response' || gone.status !== 404) return unconfirmed('CONFIRM');
    const current = await s3Request(this.#endpoint, { method: 'HEAD', key: probeKey });
    if (current.kind !== 'response') return unconfirmed('CONFIRM');
    if (current.status !== 404) return unconfirmed(current.status === 200 ? 'KEY_OCCUPIED' : 'CONFIRM');
    return 'CONFIRMED';
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
    // This attempt's own, fresh ownership marker (finding 1).
    const marker = freshMarker();
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
          [ATTEMPT_HEADER]: marker,
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

    const write = { storageKey, sizeBytes, checksumSha256, marker };

    // The source gave more or fewer bytes than validated: the request was cut
    // short. Nothing complete can have been stored; if anything reached the
    // store under this key, it is removed only if it is THIS attempt's.
    if (put.kind !== 'response' && put.code === 'INTEGRITY_MISMATCH') {
      if (put.kind === 'uncertain') await this.#discardIfOwn(write, 'LOCAL_INTEGRITY_MISMATCH');
      throw new PrivateStorageError('store', 'INTEGRITY_MISMATCH');
    }
    if (put.kind === 'not-sent') throw new PrivateStorageError('store', reasonForTransport(put));
    if (put.kind === 'response') {
      if (put.status === 200) {
        if (!localMatches()) {
          await this.#discardIfOwn(write, 'LOCAL_INTEGRITY_MISMATCH');
          throw new PrivateStorageError('store', 'INTEGRITY_MISMATCH');
        }
        // Accepted: still verified, by ownership as well as by content.
        return this.#resolveUncertain(write, 'ACCEPTED');
      }
      if (put.status === 412) return 'COLLISION';
      const reason = reasonForStatus(put.status, errorCodeOf(put.body));
      // A server error after the request was sent leaves the outcome open.
      if (reason === 'UNAVAILABLE' && put.status >= 500) return this.#resolveUncertain(write, 'SERVER_ERROR');
      throw new PrivateStorageError('store', reason);
    }
    // Lost answer: the write may have happened (or a 412 may have been lost).
    if (localDigest !== null && localDigest !== checksumSha256) {
      await this.#discardIfOwn(write, 'LOCAL_INTEGRITY_MISMATCH');
      throw new PrivateStorageError('store', 'INTEGRITY_MISMATCH');
    }
    return this.#resolveUncertain(write, 'ANSWER_LOST');
  }

  /**
   * What is under a key, as far as THIS attempt is concerned:
   *   { state: 'OWN', complete, versionId } | { state: 'NOT_OWNED' } | { state: 'ABSENT' } | { state: 'UNKNOWN' }
   * `complete`: the length and recorded SHA-256 are the expected ones.
   */
  async #inspect(storageKey, marker, sizeBytes = null, checksumSha256 = null) {
    const head = await s3Request(this.#endpoint, { method: 'HEAD', key: storageKey });
    if (head.kind !== 'response') return { state: 'UNKNOWN' };
    if (head.status === 404) return { state: 'ABSENT' };
    if (head.status !== 200) return { state: 'UNKNOWN' };
    if (head.headers[ATTEMPT_HEADER] !== marker) return { state: 'NOT_OWNED' };
    const complete = Number(head.headers['content-length']) === sizeBytes && head.headers['x-amz-meta-sha256'] === checksumSha256;
    // The generation this observation is about: the only one a later deletion may remove.
    return { state: 'OWN', complete, versionId: boundVersion(head.headers) };
  }

  async #resolveUncertain({ storageKey, sizeBytes, checksumSha256, marker }, why) {
    const objectRef = storageObjectRef(storageKey);
    const seen = await this.#inspect(storageKey, marker, sizeBytes, checksumSha256);
    if (seen.state === 'OWN' && seen.complete) {
      if (why !== 'ACCEPTED') this.#logger?.warn({ event: 'storage_write_outcome_resolved', objectRef, why, outcome: 'STORED' }, 'storage write answer was lost; the object is this attempt\'s, present and verified');
      return 'STORED';
    }
    if (seen.state === 'OWN') {
      await this.#deleteOwn(storageKey, seen.versionId, 'STORED_OBJECT_MISMATCH');
      throw new PrivateStorageError('store', 'INTEGRITY_MISMATCH');
    }
    if (seen.state === 'NOT_OWNED') {
      this.#logger?.error({ event: 'storage_write_outcome_unknown', objectRef, why, outcome: 'NOT_OWNED' }, 'an object under the key is not this attempt\'s; it is neither adopted nor deleted, and is left for reconciliation');
      throw new PrivateStorageError('store', 'OUTCOME_UNKNOWN');
    }
    if (seen.state === 'ABSENT') {
      this.#logger?.warn({ event: 'storage_write_outcome_unobserved', objectRef, why, outcome: 'ABSENT_AT_OBSERVATION' }, 'no object was present when checked; the write may still land later, and reconciliation would find it');
      throw new PrivateStorageError('store', 'UNAVAILABLE');
    }
    this.#logger?.error({ event: 'storage_write_outcome_unknown', objectRef, why, outcome: 'UNKNOWN' }, 'storage write outcome unknown; any object is unreferenced and left for reconciliation');
    throw new PrivateStorageError('store', 'OUTCOME_UNKNOWN');
  }

  /** On a local integrity failure: deletes the object only if it is THIS attempt's. */
  async #discardIfOwn({ storageKey, marker }, why) {
    const objectRef = storageObjectRef(storageKey);
    const seen = await this.#inspect(storageKey, marker);
    if (seen.state === 'OWN') return this.#deleteOwn(storageKey, seen.versionId, why);
    if (seen.state === 'ABSENT') {
      this.#logger?.warn({ event: 'storage_write_outcome_unobserved', objectRef, why, outcome: 'ABSENT_AT_OBSERVATION' }, 'no object was present when checked; a late write would be found by reconciliation');
      return undefined;
    }
    this.#logger?.error({ event: 'storage_discard_skipped', objectRef, why, outcome: seen.state }, 'an object under the key is not proven this attempt\'s; it is preserved for reconciliation');
    return undefined;
  }

  /**
   * Deletes the GENERATION a HEAD showed carrying this attempt's marker
   * (correction 2): `DELETE ?versionId=<observed>`. A replacement placed after
   * that observation is another version and is not touched. Without a version
   * id to bind to, nothing is deleted: the object is preserved and its
   * one-way reference logged for reconciliation.
   */
  async #deleteOwn(storageKey, versionId, why) {
    const objectRef = storageObjectRef(storageKey);
    if (versionId === null) {
      this.#logger?.error({ event: 'storage_discard_skipped', objectRef, why, outcome: 'NO_DELETE_BINDING' }, 'the store gave no object version to bind the deletion to; the object is preserved for reconciliation');
      return;
    }
    const result = await s3Request(this.#endpoint, { method: 'DELETE', key: storageKey, query: { versionId } });
    if (result.kind !== 'response' || (result.status !== 204 && result.status !== 200 && result.status !== 404)) {
      this.#logger?.error({ event: 'storage_discard_failed', objectRef, why }, 'a rejected object could not be removed; left for reconciliation');
    }
  }

  /**
   * C6-T6 correction: `expect` ({ sizeBytes, checksumSha256 }), when given,
   * binds the deletion to the object the caller's record describes — checked
   * on the SAME HEAD whose version the DELETE then names, so an object under
   * the key that is not that one is never removed (NOT_THE_EXPECTED_OBJECT).
   * Without `expect` the behaviour is exactly C6-T4's.
   */
  async deletePrivateObject(storageKey, { expect } = {}) {
    this.#assertReady('delete');
    if (!isResumeStorageKey(storageKey)) throw new PrivateStorageError('delete', 'INVALID_KEY');
    const head = await s3Request(this.#endpoint, { method: 'HEAD', key: storageKey });
    if (head.kind !== 'response') throw new PrivateStorageError('delete', reasonForTransport(head));
    if (head.status === 404) return { deleted: false, reason: 'NOT_FOUND' };
    if (head.status !== 200) throw new PrivateStorageError('delete', reasonForStatus(head.status, null));
    if (expect && (Number(head.headers['content-length']) !== expect.sizeBytes || head.headers['x-amz-meta-sha256'] !== expect.checksumSha256)) {
      return { deleted: false, reason: 'NOT_THE_EXPECTED_OBJECT' };
    }
    // Correction 2: the deletion removes the generation the HEAD saw (and so,
    // on a versioned store, leaves no noncurrent copy behind); without a
    // version to bind to it is refused rather than made unconditional.
    const versionId = boundVersion(head.headers);
    if (versionId === null) throw new PrivateStorageError('delete', 'DELETE_BINDING_UNAVAILABLE');
    const result = await s3Request(this.#endpoint, { method: 'DELETE', key: storageKey, query: { versionId } });
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
    const seenKeys = new Set();
    const seenTokens = new Set();
    // Finding 3: any page that is not a complete, valid ListObjectsV2 page for
    // this bucket and prefix fails the WHOLE listing (LISTING_INVALID) — an
    // earlier valid page never yields a partial result to act on.
    const invalid = (why) => {
      this.#logger?.error({ event: 'storage_listing_invalid', why }, 'the object listing was invalid or incomplete; nothing is reported and nothing is deleted');
      return new PrivateStorageError('list', 'LISTING_INVALID');
    };
    let token = null;
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const query = { 'list-type': '2', prefix: OBJECT_PREFIX, 'max-keys': String(this.#listPageSize), ...(token ? { 'continuation-token': token } : {}) };
      const response = await s3Request(this.#endpoint, { method: 'GET', query, maxBody: 8 * 1024 * 1024 });
      if (response.kind !== 'response') throw new PrivateStorageError('list', reasonForTransport(response));
      if (response.status !== 200) throw new PrivateStorageError('list', reasonForStatus(response.status, errorCodeOf(response.body)));
      if (response.overflow) throw invalid('OVER_SIZE_LIMIT');
      const listing = parseListObjectsV2(response.body, { bucket: this.#endpoint.bucket, prefix: OBJECT_PREFIX, pageSize: this.#listPageSize, continuationToken: token });
      if (!listing.ok) throw invalid(listing.why);
      for (const entry of listing.entries) {
        if (seenKeys.has(entry.key)) throw invalid('DUPLICATE_KEY');
        seenKeys.add(entry.key);
        if (seenKeys.size > MAX_LIST_OBJECTS) throw invalid('OVER_OBJECT_LIMIT');
        if (isResumeStorageKey(entry.key)) result.objects.push({ storageKey: entry.key, sizeBytes: entry.size, modifiedAt: entry.lastModified });
        else result.unexpected += 1;
      }
      if (!listing.truncated) return result;
      if (seenTokens.has(listing.nextToken) || listing.nextToken === token) throw invalid('REPEATED_TOKEN');
      seenTokens.add(listing.nextToken);
      token = listing.nextToken;
    }
    throw invalid('OVER_PAGE_LIMIT');
  }

  async close() {
    this.#state = 'closed';
  }

  #assertReady(operation) {
    if (this.#state !== 'ready') throw new PrivateStorageError(operation, 'NOT_READY');
  }
}
