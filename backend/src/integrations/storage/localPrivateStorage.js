import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { RESUME_UPLOAD_POLICY } from '../../config/resumePolicy.js';
import { APPLICATION_ROOT, checkResolvedLocalStorageRoot } from '../../config/env.js';
import {
  STORAGE_PROVIDERS,
  generateResumeStorageKey,
  isResumeStorageKey,
  PrivateStorageError,
  StorageInitializationError,
  classifyStorageError,
} from './storageContract.js';

/**
 * LOCAL PRIVATE STORAGE — DEVELOPMENT AND TEST ONLY (Milestone B4).
 *
 * Doc 09 section 107 / Doc 15 section 38: "Development may use a clearly
 * development-only private local adapter outside static/public directories.
 * Production must reject accidental development storage configuration."
 *
 * It writes REAL bytes to a real disk, so everything it does can be verified
 * directly (Doc 18 section 121): the object exists, its size and SHA-256 match,
 * it survives a new process, and nothing serves it over HTTP. It is not a
 * mock. It is also not production storage — a hosted instance's disk is
 * ephemeral (Doc 15 sections 76-77) — which is why configuration refuses it
 * outside APP_ENV=local, and why this class refuses to be constructed there
 * as well (defence in depth).
 *
 * LAYOUT under the configured root (outside the repository and any
 * web-served directory — config/env.js enforces that):
 *
 *   <root>/                         0700
 *   <root>/resumes/                 0700
 *   <root>/resumes/<id>/            0700, one directory per object
 *   <root>/resumes/<id>/<fileKey>   0600, the resume bytes
 *
 * <id>/<fileKey> is the server-generated storage key (storageContract.js).
 * A path is only ever derived from a key that matches the strict key
 * pattern, so no caller-supplied value — least of all the candidate's
 * filename — can choose or escape a location (Doc 13 section 79).
 *
 * WRITES are all-or-nothing. The object directory is created exclusively
 * (a key collision is detected, never overwritten); bytes go to a
 * `<fileKey>.partial-<random>` file opened exclusively, are hashed and
 * counted while written, flushed to disk, checked against the expected size
 * and SHA-256, and only then renamed into place and the directory synced.
 * Any failure removes what was written and rejects: a partial or unverified
 * object is never reported as stored (Doc 09 section 137).
 *
 * PERMISSIONS: on POSIX the directories are 0700 and files 0600, and init()
 * refuses a root that other users can access. On Windows, mode bits do not
 * express access control; privacy relies on the root's inherited ACL — use a
 * directory inside the developer's own profile (see backend/README.md).
 *
 * CONFINEMENT TO REAL LOCATIONS (B4 review r1, finding 2). Checking a path
 * as written, or only its final component, is not enough: a link in an
 * ANCESTOR (a symbolic link, or a junction on Windows) redirects everything
 * below it. r1 could therefore be configured through an innocent alias into
 * a "public" directory, and could delete a file outside storage through a
 * linked object directory. Now:
 *
 *   - init() resolves where the root really leads (config/env.js,
 *     checkResolvedLocalStorageRoot) and refuses a public or repository
 *     location BEFORE creating anything; it then pins the root's real path
 *     and checks it again, so a link swapped in between is caught too;
 *   - every later path is built from that pinned real path, and before the
 *     adapter writes, reads, renames or deletes anything in a directory it
 *     proves the directory is a real directory (not a link or junction —
 *     lstat) that resolves to exactly the expected location (realpath, which
 *     covers every ancestor at once). A directory that fails is never used:
 *     the operation fails with PATH_ESCAPES_STORAGE and nothing outside is
 *     touched — cleanup of a failed write included.
 *
 * Node has no openat()/O_NOFOLLOW for directories, so a local process that
 * can swap directories inside the storage root in the instant between the
 * check and the use is not excluded; such a process already has write access
 * to the private root. The checks close every persistent redirection (a link
 * that is there when the adapter looks), which is what the review reproduced.
 */
const OBJECTS_DIRECTORY = 'resumes';
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;
/** fsync on a directory is not supported by every filesystem; those report one of these. */
const DIRECTORY_SYNC_UNSUPPORTED = new Set(['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM', 'EBADF']);

const defaultOperations = Object.freeze({
  mkdir: fsp.mkdir,
  lstat: fsp.lstat,
  realpath: fsp.realpath,
  chmod: fsp.chmod,
  rename: fsp.rename,
  rm: fsp.rm,
  rmdir: fsp.rmdir,
  unlink: fsp.unlink,
  open: fsp.open,
  readFile: fsp.readFile,
  writeFile: fsp.writeFile,
  createWriteStream: fs.createWriteStream,
});

export class LocalPrivateStorage {
  #root;
  /** The object directory inside the root's REAL path — pinned by init(). */
  #objectsDirectory = null;
  #applicationRoot;
  #state = 'created';
  #logger;
  #clock;
  #ops;
  #platform;
  #syncDirectories;
  #maxBytes;
  #generateKey;

  /**
   * @param {object} options
   * @param {string} options.root       absolute storage root (validated by config/env.js)
   * @param {string} options.appEnv     must be 'local'
   * @param {string} options.nodeEnv    must not be 'production'
   * @param {object} [options.logger]
   * @param {Function} [options.clock]  source of storedAt
   * @param {object} [options.operations] TEST SEAM: replaces individual filesystem
   *   operations to inject failures. Production never passes it.
   * @param {Function} [options.generateKey] TEST SEAM for key-collision tests.
   * @param {string} [options.applicationRoot] the repository the root must stay
   *   out of; defaults to the real one (tests use a synthetic stand-in).
   * @param {boolean} [options.syncDirectories] whether the object directory is
   *   fsync'ed after the rename. Defaults to the platform's capability (not on
   *   Windows). TEST SEAM (r3): lets a test exercise a failure AFTER the object
   *   is in place on every platform, without pretending to be another OS —
   *   which would also switch the POSIX permission checks on for a Windows
   *   directory whose mode bits carry no access-control meaning.
   */
  constructor({
    root,
    appEnv,
    nodeEnv,
    logger,
    clock = () => new Date(),
    operations = {},
    platform = process.platform,
    maxBytes = RESUME_UPLOAD_POLICY.maxBytes,
    generateKey = generateResumeStorageKey,
    applicationRoot = APPLICATION_ROOT,
    syncDirectories = platform !== 'win32',
  } = {}) {
    if (appEnv !== 'local' || nodeEnv === 'production') {
      throw new StorageInitializationError('DEVELOPMENT_ONLY');
    }
    if (typeof root !== 'string' || !path.isAbsolute(root)) {
      throw new StorageInitializationError('INVALID_REQUEST');
    }
    this.#root = path.resolve(root);
    this.#applicationRoot = applicationRoot;
    this.#logger = logger;
    this.#clock = clock;
    this.#ops = { ...defaultOperations, ...operations };
    this.#platform = platform;
    this.#syncDirectories = syncDirectories === true;
    this.#maxBytes = maxBytes;
    this.#generateKey = generateKey;
  }

  get provider() {
    return STORAGE_PROVIDERS.LOCAL_DEVELOPMENT;
  }

  get isReady() {
    return this.#state === 'ready';
  }

  /**
   * Makes the storage usable, or throws StorageInitializationError: refuses a
   * root whose real location is forbidden (FORBIDDEN_LOCATION) before creating
   * anything, creates the root and object directory privately, verifies they
   * are real, private directories, pins the real path, and writes, reads back
   * and removes a probe object. Readiness is reported from this real outcome,
   * never assumed.
   */
  async init() {
    if (this.#state === 'ready') return;
    if (this.#state === 'closed') throw new StorageInitializationError('NOT_READY');
    try {
      // 1. Where the root really leads is checked BEFORE anything is created.
      this.#assertAllowedLocation(this.#root);
      await this.#ops.mkdir(this.#root, { recursive: true, mode: 0o700 });
      // 2. The root itself is a real, private directory — not a link.
      await this.#assertPrivateDirectory(this.#root, { tighten: false });
      // 3. Pin its real path, and check THAT again: a link swapped into an
      //    ancestor between step 1 and the creation is caught here.
      const realRoot = await this.#ops.realpath(this.#root);
      this.#assertAllowedLocation(realRoot);
      const objectsDirectory = path.join(realRoot, OBJECTS_DIRECTORY);
      await this.#ops.mkdir(objectsDirectory, { recursive: true, mode: 0o700 });
      await this.#assertPrivateDirectory(objectsDirectory, { tighten: true });
      this.#objectsDirectory = objectsDirectory;
      await this.#assertConfinedDirectory(objectsDirectory, 'initialisation');
      await this.#probe();
    } catch (error) {
      this.#objectsDirectory = null;
      if (error instanceof PrivateStorageError && !(error instanceof StorageInitializationError)) {
        throw new StorageInitializationError(error.reason, error);
      }
      if (error instanceof StorageInitializationError) throw error;
      // At initialisation, "exists" / "not a directory" means the configured
      // path (or a parent) is a file — not a key collision. Windows can report
      // the same situation as "not found" (ERROR_PATH_NOT_FOUND) when a parent
      // is a file or a drive does not exist.
      if (error?.code === 'EEXIST' || error?.code === 'ENOTDIR' || error?.code === 'ENOENT') {
        throw new StorageInitializationError('NOT_A_DIRECTORY', error);
      }
      throw new StorageInitializationError(classifyStorageError(error), error);
    }
    this.#state = 'ready';
  }

  /**
   * Copies an already validated file into private storage.
   *
   * `filePath` is the upload's server-owned temporary file; nothing the
   * client sent is used to name the object. Size and SHA-256 are verified
   * again while copying, so what is stored is exactly what was validated.
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

    // The source is opened first, so an unreadable source is known for what
    // it is — not confused with a failure of the storage side.
    let source;
    try {
      source = await this.#ops.open(filePath, 'r');
    } catch (error) {
      throw new PrivateStorageError('store', 'SOURCE_UNREADABLE', error);
    }

    let reserved;
    try {
      reserved = await this.#reserveObjectDirectory();
    } catch (error) {
      await source.close().catch(() => {});
      throw error;
    }
    const { storageKey, directory } = reserved;
    const finalPath = this.#objectPath(storageKey, 'store');
    const partialPath = `${finalPath}.partial-${randomBytes(8).toString('hex')}`;
    let renamed = false;

    try {
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
      });
      // The read stream owns the handle from here and closes it (autoClose).
      await pipeline(
        source.createReadStream(),
        meter,
        this.#ops.createWriteStream(partialPath, { flags: 'wx', mode: 0o600, flush: true }),
      );
      if (count !== sizeBytes || hash.digest('hex') !== checksumSha256) {
        throw new PrivateStorageError('store', 'INTEGRITY_MISMATCH');
      }
      // Still the object directory it was? Only then is the object published.
      await this.#assertConfinedDirectory(directory, 'store');
      await this.#ops.rename(partialPath, finalPath);
      renamed = true;
      await this.#syncDirectory(directory);
      return {
        storageProvider: this.provider,
        storageKey,
        sizeBytes,
        checksumSha256,
        storedAt: this.#clock(),
      };
    } catch (error) {
      await source.close().catch(() => {});
      await this.#discardFailedWrite({ storageKey, directory, partialPath, finalPath, renamed });
      if (error instanceof PrivateStorageError) throw error;
      throw new PrivateStorageError('store', classifyStorageError(error), error);
    }
  }

  /**
   * Deletes ONE object, named by a valid resume storage key. Anything else is
   * refused before the filesystem is touched, and the object's directory is
   * proven to be a real directory at its expected real location first, so
   * this can never remove a file outside the object directory — not through
   * a crafted key, not through a linked parent — nor a directory.
   */
  async deletePrivateObject(storageKey) {
    this.#assertReady('delete');
    const target = this.#objectPath(storageKey, 'delete');
    // The object's directory must really be inside storage — a linked or
    // swapped directory would make this unlink a file somewhere else.
    if (!(await this.#assertConfinedDirectory(path.dirname(target), 'delete'))) {
      return { deleted: false, reason: 'NOT_FOUND' };
    }
    let stat;
    try {
      stat = await this.#ops.lstat(target);
    } catch (error) {
      if (error?.code === 'ENOENT') return { deleted: false, reason: 'NOT_FOUND' };
      throw new PrivateStorageError('delete', classifyStorageError(error), error);
    }
    if (!stat.isFile()) throw new PrivateStorageError('delete', 'NOT_A_FILE');
    try {
      await this.#ops.unlink(target);
    } catch (error) {
      if (error?.code === 'ENOENT') return { deleted: false, reason: 'NOT_FOUND' };
      throw new PrivateStorageError('delete', classifyStorageError(error), error);
    }
    // The per-object directory, removed only if it is now empty.
    await this.#ops.rmdir(path.dirname(target)).catch(() => {});
    return { deleted: true };
  }

  /** Existence and size of one object — for integrity checks and reconciliation. */
  async statPrivateObject(storageKey) {
    this.#assertReady('stat');
    const target = this.#objectPath(storageKey, 'stat');
    if (!(await this.#assertConfinedDirectory(path.dirname(target), 'stat'))) return { exists: false };
    try {
      const stat = await this.#ops.lstat(target);
      if (!stat.isFile()) throw new PrivateStorageError('stat', 'NOT_A_FILE');
      return { exists: true, sizeBytes: stat.size };
    } catch (error) {
      if (error?.code === 'ENOENT') return { exists: false };
      if (error instanceof PrivateStorageError) throw error;
      throw new PrivateStorageError('stat', classifyStorageError(error), error);
    }
  }

  async close() {
    this.#state = 'closed';
  }

  // ------------------------------------------------------------ internals --

  #assertReady(operation) {
    if (this.#state !== 'ready') throw new PrivateStorageError(operation, 'NOT_READY');
  }

  /** The ONLY way a filesystem path is derived from a key. */
  #objectPath(storageKey, operation) {
    if (!isResumeStorageKey(storageKey)) throw new PrivateStorageError(operation, 'INVALID_KEY');
    const [, id, fileKey] = storageKey.split('/');
    const target = path.join(this.#objectsDirectory, id, fileKey);
    // Defence in depth: the key pattern already excludes separators and dots.
    if (path.relative(this.#objectsDirectory, target) !== path.join(id, fileKey)) {
      throw new PrivateStorageError(operation, 'INVALID_KEY');
    }
    return target;
  }

  /** Creates a fresh object directory; an existing one is a collision, never reused. */
  async #reserveObjectDirectory() {
    // The object directory itself must still be where init() pinned it.
    if (!(await this.#assertConfinedDirectory(this.#objectsDirectory, 'store'))) {
      throw new PrivateStorageError('store', 'NOT_A_DIRECTORY');
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const storageKey = this.#generateKey();
      const directory = path.dirname(this.#objectPath(storageKey, 'store'));
      try {
        await this.#ops.mkdir(directory, { mode: 0o700 });
      } catch (error) {
        if (error?.code === 'EEXIST') continue;
        throw new PrivateStorageError('store', classifyStorageError(error), error);
      }
      // Freshly created by us — and still ours before a byte goes in.
      await this.#assertConfinedDirectory(directory, 'store');
      return { storageKey, directory };
    }
    throw new PrivateStorageError('store', 'KEY_COLLISION');
  }

  async #discardFailedWrite({ storageKey, directory, partialPath, finalPath, renamed }) {
    const leftovers = [];
    // Cleanup is confined like everything else: through a directory that no
    // longer resolves to its place in storage, nothing is removed.
    let confined = false;
    try {
      confined = await this.#assertConfinedDirectory(directory, 'store');
    } catch {
      leftovers.push('unverifiable');
    }
    if (confined) {
      const remove = async (target) => {
        try {
          await this.#ops.rm(target, { force: true });
        } catch {
          leftovers.push(target === partialPath ? 'partial' : 'object');
        }
      };
      await remove(partialPath);
      if (renamed) await remove(finalPath);
      await this.#ops.rmdir(directory).catch(() => {});
    }
    if (leftovers.length > 0) {
      /*
       * The write failed AND its cleanup failed. Nothing was reported as
       * stored, and the bytes stay private, but reconciliation must be able to
       * find them (Doc 09 section 119, Doc 10 section 207): the server-generated
       * key identifies the object directory. No path or filename is logged.
       */
      this.#logger?.error(
        { event: 'private_storage_cleanup_incomplete', storageKey, leftovers },
        'private storage could not remove a failed write',
      );
    }
  }

  /** Refuses a root whose REAL location is public or inside the repository. */
  #assertAllowedLocation(candidate) {
    if (checkResolvedLocalStorageRoot(candidate, { applicationRoot: this.#applicationRoot }) !== null) {
      throw new StorageInitializationError('FORBIDDEN_LOCATION');
    }
  }

  #samePath(a, b) {
    // NTFS compares names case-insensitively (by upper-casing); realpath
    // returns the stored case. Every path compared here was built from the
    // pinned real root plus lower-case hex, so an exact match is the norm.
    return this.#platform === 'win32' ? a.toUpperCase() === b.toUpperCase() : a === b;
  }

  /**
   * Proves `directory` is a real directory (lstat: not a symbolic link or
   * Windows junction) that resolves to exactly itself (realpath: no link in
   * ANY ancestor either). Every directory path the adapter uses is built from
   * the pinned real root, so "resolves to itself" means "is where it must be".
   *
   * @returns {Promise<boolean>} false when it does not exist
   * @throws {PrivateStorageError} PATH_ESCAPES_STORAGE when it exists elsewhere or is not a directory
   */
  async #assertConfinedDirectory(directory, operation) {
    let stat;
    let real;
    try {
      stat = await this.#ops.lstat(directory);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new PrivateStorageError(operation, 'PATH_ESCAPES_STORAGE');
      real = await this.#ops.realpath(directory);
    } catch (error) {
      if (error instanceof PrivateStorageError) throw error;
      if (error?.code === 'ENOENT') return false;
      // ENOTDIR: an ancestor is no longer a directory — not where it must be.
      if (error?.code === 'ENOTDIR' || error?.code === 'ELOOP') throw new PrivateStorageError(operation, 'PATH_ESCAPES_STORAGE', error);
      throw new PrivateStorageError(operation, classifyStorageError(error), error);
    }
    if (!this.#samePath(real, directory)) throw new PrivateStorageError(operation, 'PATH_ESCAPES_STORAGE');
    return true;
  }

  async #assertPrivateDirectory(directory, { tighten }) {
    const stat = await this.#ops.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new StorageInitializationError('NOT_A_DIRECTORY');
    }
    if (this.#platform === 'win32') return;
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
      throw new StorageInitializationError('PERMISSIONS_TOO_OPEN');
    }
    if ((stat.mode & 0o077) !== 0) {
      if (!tighten) throw new StorageInitializationError('PERMISSIONS_TOO_OPEN');
      // Our own object directory: restore the intended mode.
      await this.#ops.chmod(directory, 0o700);
    }
  }

  async #probe() {
    const probePath = path.join(this.#objectsDirectory, `.probe-${randomBytes(8).toString('hex')}`);
    const content = Buffer.from(`valida private storage probe ${randomBytes(8).toString('hex')}`);
    try {
      await this.#ops.writeFile(probePath, content, { flag: 'wx', mode: 0o600, flush: true });
      const readBack = await this.#ops.readFile(probePath);
      if (!readBack.equals(content)) throw new StorageInitializationError('PROBE_MISMATCH');
    } finally {
      await this.#ops.rm(probePath, { force: true }).catch(() => {});
    }
  }

  async #syncDirectory(directory) {
    // Windows cannot open a directory for fsync; NTFS journals the rename.
    if (!this.#syncDirectories) return;
    let handle;
    try {
      handle = await this.#ops.open(directory, 'r');
      await handle.sync();
    } catch (error) {
      if (!DIRECTORY_SYNC_UNSUPPORTED.has(error?.code)) throw error;
    } finally {
      await handle?.close().catch(() => {});
    }
  }
}
