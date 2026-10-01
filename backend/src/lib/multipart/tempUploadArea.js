import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Owned temporary upload files — Milestone B4.
 *
 * Doc 09 section 105 / Doc 13 sections 255-256: if temporary local files are
 * used while an upload is processed they must be outside any web root, have
 * restrictive permissions and random names, and be deleted after completion
 * or failure; temporary uploads must be bounded and failed files cleaned.
 *
 * One area per server process: a directory created with mkdtemp (unique,
 * owner-only, 0700) in the OS temporary directory — never in the repository
 * and never in a served directory. Inside it, each upload reserves ONE file
 * named `up-<128-bit random hex>.part`; the client's filename plays no part.
 *
 * CONFINEMENT. The area deletes only what it owns:
 *   - release(file) accepts only the exact handle objects reserveFile()
 *     returned (tracked in a Set). A path string, or a handle from another
 *     area, is refused — so no caller can turn release() into "delete any
 *     path";
 *   - close() removes the files it still owns and then its own directory,
 *     which succeeds only when that directory is empty;
 *   - the start-up sweep of areas abandoned by a crashed process touches only
 *     sibling directories matching this module's own name pattern, that are
 *     real directories (not links), owned by this user (POSIX), older than
 *     `staleAfterMs`, AND whose owner process is no longer running — each
 *     area records its creator's process id in an `.owner` marker, and an
 *     area whose owner is alive (or whose liveness cannot be ruled out) is
 *     never touched, however idle it has been (review finding: age alone
 *     would let a second process delete a running process's area). Inside a
 *     swept area it removes only upload-pattern files and the marker, then
 *     the directory if that left it empty.
 *
 * SELF-HEALING. If something outside the backend deletes the area directory
 * (an OS temporary-file cleaner such as Windows Storage Sense), the next
 * reservation recreates it, owner-only, instead of every later upload failing.
 *
 * NO LINKED OR SWAPPED AREA (B4 review r1, findings 2 and 3). The area
 * remembers the identity (device and inode / file index) of the directory it
 * created. Before it reserves, releases or cleans up, it checks that the path
 * is still THAT directory — not a symbolic link, a Windows junction, a file,
 * or another directory put in its place. If it is not, nothing is created or
 * deleted through it: reservation throws (the upload is answered with a 503,
 * never a 400), and cleanup is skipped and logged. Cleanup failures are
 * logged as bounded events (a fixed event name and an error code, never a
 * path); release() never throws for them, so a response is never lost to a
 * cleanup problem, and the file stays owned so close() tries again.
 *
 * Files are bounded by the multipart parser (one file per request, 5 MiB);
 * this module bounds their lifetime.
 */
const AREA_PREFIX = 'valida-upload-';
const AREA_PATTERN = /^valida-upload-[A-Za-z0-9]{6}$/;
const FILE_PATTERN = /^up-[0-9a-f]{32}\.part$/;
const OWNER_MARKER = '.owner';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Writes this process's id into an area's owner marker (exclusively created). */
function writeOwnerMarker(directory) {
  fs.writeFileSync(path.join(directory, OWNER_MARKER), String(process.pid), { flag: 'wx', mode: 0o600 });
}

/**
 * Is the process that created an area still running? Reads the marker; a
 * missing or unreadable marker means "unknown owner" (an area from an older
 * build or a process that died while creating it) and returns false. Any
 * doubt about a recorded owner returns TRUE, so the sweep never deletes an
 * area that might be in use. process.kill(pid, 0) only tests for existence
 * (no signal is sent) and works on Windows as well.
 */
async function ownerIsAlive(directory) {
  let pid;
  try {
    const text = await fsp.readFile(path.join(directory, OWNER_MARKER), 'utf8');
    if (!/^\d{1,10}$/.test(text.trim())) return false;
    pid = Number(text.trim());
  } catch (error) {
    return error?.code !== 'ENOENT';
  }
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // ESRCH: no such process. EPERM: it exists but belongs to someone else.
    return error?.code !== 'ESRCH';
  }
}

/** Device and inode (file index on Windows), exact as BigInt. */
const identityOf = (directory) => {
  const stat = fs.lstatSync(directory, { bigint: true });
  return { dev: stat.dev, ino: stat.ino };
};

/** A bounded token for a cleanup-failure log: an errno code, never a message or path. */
const errorCodeOf = (error) => (typeof error?.code === 'string' && /^E[A-Z0-9]{1,30}$/.test(error.code) ? error.code : 'IO_ERROR');

/** Thrown by reserveFile() when the area cannot be used; `reason` is a fixed token. */
export class UploadAreaUnavailableError extends Error {
  constructor(reason, cause) {
    super(reason === 'AREA_CLOSED' ? 'temporary upload area is closed' : `temporary upload area unavailable (${reason})`);
    this.name = 'UploadAreaUnavailableError';
    this.reason = reason;
    if (cause !== undefined) this.cause = cause;
  }
}

export class TempUploadArea {
  #directory;
  #identity;
  #logger;
  #owned = new Set();
  #released = new WeakSet();
  #closed = false;

  constructor(directory, { logger } = {}) {
    this.#directory = directory;
    this.#identity = identityOf(directory);
    this.#logger = logger;
  }

  /**
   * Creates the area and sweeps areas left behind by earlier processes.
   *
   * @param {object} [options]
   * @param {string} [options.baseDirectory] defaults to os.tmpdir()
   * @param {object} [options.logger]
   * @param {number} [options.staleAfterMs]  default 24 hours
   * @param {Function} [options.now]
   */
  static async create({ baseDirectory = os.tmpdir(), logger, staleAfterMs = DAY_MS, now = Date.now } = {}) {
    const directory = await fsp.mkdtemp(path.join(baseDirectory, AREA_PREFIX));
    if (process.platform !== 'win32') await fsp.chmod(directory, 0o700);
    writeOwnerMarker(directory);
    const area = new TempUploadArea(directory, { logger });
    const swept = await sweepAbandonedAreas({ baseDirectory, keep: directory, staleAfterMs, now });
    if (swept.files > 0 || swept.areas > 0) {
      logger?.info({ event: 'upload_temp_sweep', ...swept }, 'removed temporary uploads abandoned by an earlier process');
    }
    return area;
  }

  /** The area directory. Internal: never logged, never sent. */
  get directory() {
    return this.#directory;
  }

  get ownedCount() {
    return this.#owned.size;
  }

  get isClosed() {
    return this.#closed;
  }

  /**
   * Is the path still the directory this area created?
   * 'ok' | 'missing' (deleted from outside) | 'replaced' (a link, junction,
   * file or different directory now occupies it).
   */
  #inspectDirectory() {
    let stat;
    try {
      stat = fs.lstatSync(this.#directory, { bigint: true });
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return 'missing';
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) return 'replaced';
    if (stat.dev !== this.#identity.dev || stat.ino !== this.#identity.ino) return 'replaced';
    return 'ok';
  }

  /**
   * Reserves a new, randomly named file path owned by this area. Synchronous,
   * so a multipart parser can attach the writer before any upload data is
   * buffered. The writer must create the file exclusively (flag 'wx').
   *
   * Throws UploadAreaUnavailableError when the area is closed, has been
   * replaced, or cannot be recreated — a server-side condition.
   */
  reserveFile() {
    if (this.#closed) throw new UploadAreaUnavailableError('AREA_CLOSED');
    let state;
    try {
      state = this.#inspectDirectory();
    } catch (error) {
      throw new UploadAreaUnavailableError(errorCodeOf(error), error);
    }
    if (state === 'replaced') throw new UploadAreaUnavailableError('AREA_REPLACED');
    if (state === 'missing') {
      // Removed from outside (a temporary-file cleaner): recreate it privately.
      // Not recursive — if its parent is gone too, that is a real failure.
      try {
        fs.mkdirSync(this.#directory, { mode: 0o700 });
        writeOwnerMarker(this.#directory);
        this.#identity = identityOf(this.#directory);
      } catch (error) {
        throw new UploadAreaUnavailableError(errorCodeOf(error), error);
      }
    }
    const file = Object.freeze({
      path: path.join(this.#directory, `up-${randomBytes(16).toString('hex')}.part`),
    });
    this.#owned.add(file);
    return file;
  }

  owns(file) {
    return this.#owned.has(file);
  }

  /**
   * Deletes one owned file. Idempotent for an already-released handle
   * (returns false). A filesystem failure is logged and returns false — the
   * handle stays owned and close() retries it; it never throws for that.
   */
  async release(file) {
    if (!this.#owned.has(file)) {
      // Releasing twice is harmless; anything this area never issued is refused.
      if (file !== null && typeof file === 'object' && this.#released.has(file)) return false;
      throw new TypeError('release() accepts only a file handle issued by this upload area');
    }
    try {
      if (this.#inspectDirectory() === 'replaced') {
        this.#logCleanupIncomplete('AREA_REPLACED');
        return false;
      }
      await fsp.rm(file.path, { force: true });
    } catch (error) {
      this.#logCleanupIncomplete(errorCodeOf(error));
      return false;
    }
    this.#owned.delete(file);
    this.#released.add(file);
    return true;
  }

  /** Removes every file still owned, then the area directory. */
  async close() {
    this.#closed = true;
    let state;
    try {
      state = this.#inspectDirectory();
    } catch {
      state = 'replaced';
    }
    if (state === 'replaced') {
      // Never delete through a path that is no longer this area's directory.
      this.#logCleanupIncomplete('AREA_REPLACED');
      throw new Error('temporary upload area cleanup incomplete (replaced)');
    }
    const failures = [];
    for (const file of [...this.#owned]) {
      try {
        await fsp.rm(file.path, { force: true });
        this.#owned.delete(file);
        this.#released.add(file);
      } catch {
        failures.push('file');
      }
    }
    try {
      await removeOwnedFilesAndDirectory(this.#directory);
    } catch {
      failures.push('directory');
    }
    if (failures.length > 0) {
      throw new Error(`temporary upload area cleanup incomplete (${failures.length})`);
    }
  }

  #logCleanupIncomplete(reason) {
    this.#logger?.warn(
      { event: 'upload_temp_cleanup_incomplete', reason, owned: this.#owned.size },
      'a temporary upload file could not be removed now; it is retried when the server stops',
    );
  }
}

/** Removes upload-pattern files from an area directory, then the directory if empty. */
async function removeOwnedFilesAndDirectory(directory) {
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
  let removed = 0;
  for (const entry of entries) {
    if (entry.isFile() && FILE_PATTERN.test(entry.name)) {
      await fsp.rm(path.join(directory, entry.name), { force: true });
      removed += 1;
    } else if (entry.isFile() && entry.name === OWNER_MARKER) {
      await fsp.rm(path.join(directory, entry.name), { force: true });
    }
  }
  try {
    await fsp.rmdir(directory);
  } catch (error) {
    // Something that is not ours is inside: leave it rather than delete it.
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTEMPTY' && error?.code !== 'EEXIST') throw error;
  }
  return removed;
}

async function sweepAbandonedAreas({ baseDirectory, keep, staleAfterMs, now }) {
  const result = { areas: 0, files: 0 };
  let entries;
  try {
    entries = await fsp.readdir(baseDirectory, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (!AREA_PATTERN.test(entry.name)) continue;
    const candidate = path.join(baseDirectory, entry.name);
    if (candidate === keep) continue;
    try {
      const stat = await fsp.lstat(candidate);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) continue;
      if (now() - stat.mtimeMs < staleAfterMs) continue;
      if (await ownerIsAlive(candidate)) continue;
      result.files += await removeOwnedFilesAndDirectory(candidate);
      result.areas += 1;
    } catch {
      // Best effort: an area that cannot be inspected or cleaned is left alone.
    }
  }
  return result;
}
