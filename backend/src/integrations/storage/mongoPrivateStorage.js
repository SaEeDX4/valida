import { createHash, randomBytes } from 'node:crypto';
import { open as openFile } from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { RESUME_UPLOAD_POLICY } from '../../config/resumePolicy.js';
import {
  STORAGE_PROVIDERS,
  PrivateStorageError,
  StorageInitializationError,
  generateResumeStorageKey,
  isResumeStorageKey,
} from './storageContract.js';

const { MongoClient, Binary } = mongoose.mongo;

/**
 * Proposed (MongoDB-native launch change) — private résumé storage IN MongoDB.
 *
 * One immutable document per stored résumé version, in its own collection:
 *
 *   resume_files { _id: <storage key>, sizeBytes, checksumSha256, data: Binary,
 *                  storedAt, attempt, schema }
 *
 * Why one BSON document and not GridFS: the approved maximum is 5 MiB
 * (Doc 13 section 67; Doc 10 section 101), well inside MongoDB's 16 MiB
 * document limit. A single insertOne is atomic — there is never a partial
 * object (GridFS writes chunks, then a files document, and can leave orphan
 * chunks after an interrupted write). Exact-version deletion is one atomic
 * conditional deleteOne. GridFS is needed only above 16 MiB.
 *
 * Guarantees, mapped from the C6-T4 S3 driver:
 *   - private: no URL, no anonymous access path exists; only database users
 *     granted `find` on this collection can read (the storage credential is a
 *     dedicated user, RESUME_STORAGE_MONGODB_URI);
 *   - no overwrite (S3 If-None-Match): the key is the _id; a second insert under
 *     it fails with a duplicate-key error (KEY_COLLISION); the driver never
 *     updates a file document, and the storage role holds no `update` action;
 *   - integrity: size and SHA-256 are re-verified while reading the validated
 *     temporary file, and the stored document is read back and re-hashed
 *     before success is returned;
 *   - durability: write concern majority with journal, so success means the
 *     document is on a majority of the replica set (Doc 10 section 108,
 *     "durably accepted");
 *   - interrupted writes: an insert whose outcome is unknown (a network error
 *     after sending) is resolved by reading the key back and comparing this
 *     attempt's random marker and checksum: stored, absent (retried under a
 *     new key), or OUTCOME_UNKNOWN;
 *   - exact-version deletion (C6-T4 correction 2): deleteOne({ _id, sizeBytes,
 *     checksumSha256 }) removes the document only if it IS the recorded version,
 *     in one atomic operation; otherwise NOT_THE_EXPECTED_OBJECT or NOT_FOUND;
 *   - verified read (new, for E4 HR retrieval and scanning): the bytes are
 *     returned only if their SHA-256 and size equal the expected values.
 */
const COLLECTION = 'resume_files';
const SCHEMA = 'valida.resume-file.v1';
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
const MAX_KEY_ATTEMPTS = 3;
const WRITE_CONCERN = Object.freeze({ w: 'majority', j: true });

function reasonFor(error) {
  if (!error) return 'IO_ERROR';
  if (error.code === 11000) return 'KEY_COLLISION';
  if (error.code === 13 || error.codeName === 'Unauthorized') return 'PERMISSION_DENIED';
  const name = String(error.name ?? '');
  if (/MongoServerSelectionError|MongoNetworkError|MongoNetworkTimeoutError|MongoNotConnectedError|PoolClearedError/.test(name)) return 'UNAVAILABLE';
  return 'PROVIDER_ERROR';
}

/** A network-level failure after the command may have been sent: the outcome is unknown. */
function outcomeUnknown(error) {
  const name = String(error?.name ?? '');
  return /MongoNetworkError|MongoNetworkTimeoutError|PoolClearedError/.test(name) || (typeof error?.hasErrorLabel === 'function' && error.hasErrorLabel('RetryableWriteError'));
}

export class MongoPrivateStorage {
  #uri;
  #client = null;
  #collection = null;
  #state = 'new';
  #logger;
  #clock;
  #maxBytes;
  #generateKey;
  #openFile;
  #clientFactory;
  #mode;

  /**
   * mode 'deletion': for the deletion operator (scripts/mongo-recovery.mjs), whose
   * database role holds find + remove on resume_files and NO insert. init proves
   * read access only; storing is refused.
   * mode 'read-only' (r2): for the scanner (scripts/resume-scan.mjs): find only;
   * storing and deleting are refused. The API always uses mode 'full'.
   */
  constructor({ uri, mode = 'full', logger, clock = () => new Date(), maxBytes = RESUME_UPLOAD_POLICY.maxBytes, generateKey = generateResumeStorageKey, openFile: openImpl = openFile, clientFactory = (u) => new MongoClient(u, { retryWrites: false, serverSelectionTimeoutMS: 10_000 }) } = {}) {
    if (typeof uri !== 'string' || uri.length === 0) throw new StorageInitializationError('INVALID_REQUEST');
    this.#uri = uri;
    this.#logger = logger;
    this.#clock = clock;
    this.#maxBytes = maxBytes;
    this.#generateKey = generateKey;
    this.#openFile = openImpl;
    this.#clientFactory = clientFactory;
    if (!['full', 'deletion', 'read-only'].includes(mode)) throw new StorageInitializationError('INVALID_REQUEST');
    this.#mode = mode;
  }

  toJSON() {
    return { provider: this.provider, isReady: this.isReady };
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `MongoPrivateStorage { provider: '${this.provider}', isReady: ${this.isReady} }`;
  }

  get provider() {
    return STORAGE_PROVIDERS.MONGODB;
  }

  get isReady() {
    return this.#state === 'ready';
  }

  /**
   * Connects with the storage credential and proves the store works: inserts a
   * synthetic probe under a representative key, reads it back and re-hashes it,
   * proves a second insert under the same key is refused, then deletes it by its
   * exact version and confirms it is gone. Any failure: StorageInitializationError.
   */
  async init() {
    try {
      await this.#init();
    } catch (error) {
      if (error instanceof StorageInitializationError) error.driver = 'mongodb';
      throw error;
    }
  }

  async #init() {
    if (this.#state === 'closed') throw new StorageInitializationError('NOT_READY');
    try {
      this.#client = this.#clientFactory(this.#uri);
      await this.#client.connect();
      this.#collection = this.#client.db().collection(COLLECTION);
    } catch (error) {
      throw new StorageInitializationError(reasonFor(error));
    }
    if (this.#mode !== 'full') {
      try {
        await this.#collection.countDocuments({ _id: { $in: [] } });
      } catch (error) {
        throw new StorageInitializationError(reasonFor(error));
      }
      this.#state = 'ready';
      return;
    }
    const key = this.#generateKey();
    const bytes = randomBytes(64);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const marker = randomBytes(16).toString('hex');
    try {
      await this.#collection.insertOne({ _id: key, schema: SCHEMA, probe: true, sizeBytes: bytes.length, checksumSha256: sha, data: new Binary(bytes), storedAt: this.#clock(), attempt: marker }, { writeConcern: WRITE_CONCERN });
    } catch (error) {
      throw new StorageInitializationError(reasonFor(error));
    }
    try {
      const back = await this.#collection.findOne({ _id: key });
      if (!back || back.attempt !== marker || createHash('sha256').update(back.data.buffer).digest('hex') !== sha) throw new StorageInitializationError('PROBE_MISMATCH');
      let refused = false;
      try {
        await this.#collection.insertOne({ _id: key, schema: SCHEMA, probe: true, sizeBytes: 1, checksumSha256: sha, data: new Binary(Buffer.alloc(1)), storedAt: this.#clock(), attempt: 'overwrite' }, { writeConcern: WRITE_CONCERN });
      } catch (error) {
        refused = error?.code === 11000;
        if (!refused) throw new StorageInitializationError(reasonFor(error));
      }
      if (!refused) throw new StorageInitializationError('PROBE_MISMATCH');
    } finally {
      const removed = await this.#collection.deleteOne({ _id: key, attempt: marker, checksumSha256: sha }, { writeConcern: WRITE_CONCERN }).catch(() => null);
      const gone = removed ? (await this.#collection.countDocuments({ _id: key }).catch(() => 1)) === 0 : false;
      if (!gone) {
        this.#logger?.error({ event: 'storage_probe_cleanup_failed' }, 'the start-up probe could not be confirmed removed');
        // eslint-disable-next-line no-unsafe-finally
        throw new StorageInitializationError('PROBE_CLEANUP_FAILED');
      }
    }
    this.#state = 'ready';
  }

  async storePrivateResume({ filePath, sizeBytes, checksumSha256 } = {}) {
    this.#assertReady('store');
    if (this.#mode !== 'full') throw new PrivateStorageError('store', 'PERMISSION_DENIED');
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > this.#maxBytes || typeof checksumSha256 !== 'string' || !CHECKSUM_PATTERN.test(checksumSha256)) {
      throw new PrivateStorageError('store', 'INVALID_REQUEST');
    }
    const bytes = await this.#readVerified(filePath, sizeBytes, checksumSha256);
    for (let attempt = 1; attempt <= MAX_KEY_ATTEMPTS; attempt += 1) {
      const storageKey = this.#generateKey();
      if (!isResumeStorageKey(storageKey)) throw new PrivateStorageError('store', 'INVALID_KEY');
      const storedAt = this.#clock();
      const marker = randomBytes(16).toString('hex');
      let outcome;
      try {
        await this.#collection.insertOne({ _id: storageKey, schema: SCHEMA, sizeBytes, checksumSha256, data: new Binary(bytes), storedAt, attempt: marker }, { writeConcern: WRITE_CONCERN });
        outcome = 'STORED';
      } catch (error) {
        if (error?.code === 11000) {
          outcome = 'COLLISION';
        } else if (outcomeUnknown(error)) {
          outcome = await this.#resolveUncertain(storageKey, marker, checksumSha256);
        } else {
          throw new PrivateStorageError('store', reasonFor(error), error);
        }
      }
      if (outcome === 'COLLISION' || outcome === 'ABSENT') continue;
      await this.#confirmStored(storageKey, marker, sizeBytes, checksumSha256);
      return { storageProvider: this.provider, storageKey, sizeBytes, checksumSha256, storedAt };
    }
    throw new PrivateStorageError('store', 'KEY_COLLISION');
  }

  async #readVerified(filePath, sizeBytes, checksumSha256) {
    let handle;
    try {
      handle = await this.#openFile(filePath, 'r');
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== sizeBytes) throw new PrivateStorageError('store', 'INTEGRITY_MISMATCH');
      const bytes = Buffer.alloc(sizeBytes);
      let offset = 0;
      while (offset < sizeBytes) {
        const { bytesRead } = await handle.read(bytes, offset, sizeBytes - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset !== sizeBytes) throw new PrivateStorageError('store', 'INTEGRITY_MISMATCH');
      // One more byte means the file grew after validation.
      const extra = await handle.read(Buffer.alloc(1), 0, 1, sizeBytes);
      if (extra.bytesRead !== 0) throw new PrivateStorageError('store', 'INTEGRITY_MISMATCH');
      if (createHash('sha256').update(bytes).digest('hex') !== checksumSha256) throw new PrivateStorageError('store', 'INTEGRITY_MISMATCH');
      return bytes;
    } catch (error) {
      if (error instanceof PrivateStorageError) throw error;
      throw new PrivateStorageError('store', 'SOURCE_UNREADABLE', error);
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  /** The insert's outcome is unknown: read the key back. */
  async #resolveUncertain(storageKey, marker, checksumSha256) {
    let found;
    try {
      found = await this.#collection.findOne({ _id: storageKey }, { projection: { attempt: 1, checksumSha256: 1 } });
    } catch {
      throw new PrivateStorageError('store', 'OUTCOME_UNKNOWN');
    }
    if (!found) return 'ABSENT';
    if (found.attempt === marker && found.checksumSha256 === checksumSha256) return 'STORED';
    return 'COLLISION';
  }

  /** Success is returned only after the stored bytes are read back and re-hashed. */
  async #confirmStored(storageKey, marker, sizeBytes, checksumSha256) {
    let doc;
    try {
      doc = await this.#collection.findOne({ _id: storageKey });
    } catch (error) {
      throw new PrivateStorageError('store', 'OUTCOME_UNKNOWN', error);
    }
    const bytes = doc?.data?.buffer;
    if (!doc || doc.attempt !== marker || !bytes || bytes.length !== sizeBytes || createHash('sha256').update(bytes).digest('hex') !== checksumSha256) {
      throw new PrivateStorageError('store', 'INTEGRITY_MISMATCH');
    }
  }

  /**
   * Removes ONE stored version. With `expect` ({ sizeBytes, checksumSha256 }), only
   * the document that IS that version: one atomic conditional delete.
   */
  async deletePrivateObject(storageKey, { expect } = {}) {
    this.#assertReady('delete');
    if (this.#mode === 'read-only') throw new PrivateStorageError('delete', 'PERMISSION_DENIED');
    if (!isResumeStorageKey(storageKey)) throw new PrivateStorageError('delete', 'INVALID_KEY');
    const filter = expect ? { _id: storageKey, sizeBytes: expect.sizeBytes, checksumSha256: expect.checksumSha256 } : { _id: storageKey };
    let result;
    try {
      result = await this.#collection.deleteOne(filter, { writeConcern: WRITE_CONCERN });
    } catch (error) {
      throw new PrivateStorageError('delete', reasonFor(error), error);
    }
    if (result.deletedCount === 1) return { deleted: true };
    let exists;
    try {
      exists = (await this.#collection.countDocuments({ _id: storageKey })) > 0;
    } catch (error) {
      throw new PrivateStorageError('delete', reasonFor(error), error);
    }
    return { deleted: false, reason: exists ? 'NOT_THE_EXPECTED_OBJECT' : 'NOT_FOUND' };
  }

  async statPrivateObject(storageKey) {
    this.#assertReady('stat');
    if (!isResumeStorageKey(storageKey)) throw new PrivateStorageError('stat', 'INVALID_KEY');
    let doc;
    try {
      doc = await this.#collection.findOne({ _id: storageKey }, { projection: { sizeBytes: 1 } });
    } catch (error) {
      throw new PrivateStorageError('stat', reasonFor(error), error);
    }
    return doc ? { exists: true, sizeBytes: doc.sizeBytes } : { exists: false };
  }

  /**
   * The bytes of ONE stored version, only if they are exactly the expected
   * version (size and SHA-256 re-verified on the bytes read). For the E4
   * authorised HR retrieval and for scanning; never a URL.
   */
  async readPrivateObject(storageKey, { expect } = {}) {
    this.#assertReady('read');
    if (!isResumeStorageKey(storageKey)) throw new PrivateStorageError('read', 'INVALID_KEY');
    if (!expect || !Number.isInteger(expect.sizeBytes) || !CHECKSUM_PATTERN.test(expect.checksumSha256 ?? '')) throw new PrivateStorageError('read', 'INVALID_REQUEST');
    let doc;
    try {
      doc = await this.#collection.findOne({ _id: storageKey, sizeBytes: expect.sizeBytes, checksumSha256: expect.checksumSha256 });
    } catch (error) {
      throw new PrivateStorageError('read', reasonFor(error), error);
    }
    if (!doc) return { found: false };
    const bytes = Buffer.from(doc.data.buffer);
    if (bytes.length !== expect.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== expect.checksumSha256) {
      throw new PrivateStorageError('read', 'INTEGRITY_MISMATCH');
    }
    return { found: true, bytes };
  }

  /** Every stored version, for orphan reconciliation and the restore check: keys and sizes, no content. */
  async listPrivateObjects() {
    this.#assertReady('list');
    const result = { objects: [], partials: [], unexpected: 0, notConfined: 0 };
    try {
      for await (const doc of this.#collection.find({}, { projection: { _id: 1, sizeBytes: 1, storedAt: 1, probe: 1 } })) {
        if (doc.probe) continue;
        if (isResumeStorageKey(doc._id)) result.objects.push({ storageKey: doc._id, sizeBytes: doc.sizeBytes, modifiedAt: doc.storedAt });
        else result.unexpected += 1;
      }
    } catch (error) {
      throw new PrivateStorageError('list', reasonFor(error), error);
    }
    return result;
  }

  async close() {
    this.#state = 'closed';
    await this.#client?.close().catch(() => {});
  }

  #assertReady(operation) {
    if (this.#state !== 'ready') throw new PrivateStorageError(operation, 'NOT_READY');
  }
}

export const RESUME_FILES_COLLECTION = COLLECTION;
