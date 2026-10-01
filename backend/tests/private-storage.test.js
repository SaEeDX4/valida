import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { LocalPrivateStorage } from '../src/integrations/storage/localPrivateStorage.js';
import {
  createPrivateStorage, generateResumeStorageKey, isResumeStorageKey, PrivateStorageError, StorageInitializationError,
  STORAGE_FAILURE_REASONS, classifyStorageError,
} from '../src/integrations/storage/privateStorage.js';
import { capturingLogger, buildApp, testConfig } from './helpers.js';
import { syntheticPdf } from './fixtures/resumeFiles.js';
import { makeTestRoot, removeTestRoot, listFiles } from './fixtures/uploadHarness.js';

/**
 * B4 — local private storage adapter, against the REAL filesystem.
 *
 * Doc 09 sections 101-107 and 119, Doc 10 sections 94-97, Doc 13 sections
 * 66-69, 79, 229 and 233, Doc 17 sections 105, 112-113 and 125-126, Doc 18
 * section 121. Every test uses its own fresh root under the OS temporary
 * directory; filesystem failures are injected through the adapter's
 * documented test seam, never by touching real system directories.
 */
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const isPosix = process.platform !== 'win32';

let root;
let storageRoot;
let source;
let pdf;

beforeEach(() => {
  root = makeTestRoot();
  storageRoot = path.join(root, 'store');
  pdf = syntheticPdf();
  source = path.join(root, 'validated-upload.part');
  fs.writeFileSync(source, pdf);
});

afterEach(() => {
  removeTestRoot(root);
});

const newStorage = (options = {}) =>
  new LocalPrivateStorage({ root: storageRoot, appEnv: 'local', nodeEnv: 'test', ...options });

const request_ = () => ({ filePath: source, sizeBytes: pdf.length, checksumSha256: sha256(pdf) });
const objectPath = (key) => path.join(storageRoot, ...key.split('/'));
const objects = () => listFiles(path.join(storageRoot, 'resumes'));

describe('development-only by construction (Doc 09 section 107)', () => {
  it.each([
    ['APP_ENV=production', { appEnv: 'production', nodeEnv: 'production' }],
    ['APP_ENV=review', { appEnv: 'review', nodeEnv: 'production' }],
    ['NODE_ENV=production with APP_ENV=local', { appEnv: 'local', nodeEnv: 'production' }],
  ])('refuses to be constructed for %s', (_label, environment) => {
    expect(() => newStorage(environment)).toThrow(StorageInitializationError);
    try {
      newStorage(environment);
    } catch (error) {
      expect(error.reason).toBe('DEVELOPMENT_ONLY');
    }
    expect(fs.existsSync(storageRoot)).toBe(false);
  });

  it('refuses a relative root', () => {
    expect(() => new LocalPrivateStorage({ root: 'relative/store', appEnv: 'local', nodeEnv: 'test' })).toThrow(StorageInitializationError);
  });

  it('the factory builds nothing when no driver is configured', () => {
    expect(createPrivateStorage({ config: testConfig() })).toBeNull();
  });
});

describe('initialisation proves the storage works', () => {
  it('creates private directories and leaves no probe behind', async () => {
    const storage = newStorage();
    expect(storage.isReady).toBe(false);
    await storage.init();
    expect(storage.isReady).toBe(true);
    expect(storage.provider).toBe('LOCAL_DEVELOPMENT');
    expect(fs.readdirSync(path.join(storageRoot, 'resumes'))).toEqual([]);
    if (isPosix) {
      expect(fs.statSync(storageRoot).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(storageRoot, 'resumes')).mode & 0o777).toBe(0o700);
    }
  });

  it('fails when the root is a file, not a directory', async () => {
    fs.writeFileSync(storageRoot, 'not a directory');
    await expect(newStorage().init()).rejects.toMatchObject({ name: 'StorageInitializationError', reason: 'NOT_A_DIRECTORY' });
  });

  it('fails when a parent of the root is a file', async () => {
    const parentFile = path.join(root, 'plain-file');
    fs.writeFileSync(parentFile, 'x');
    const storage = new LocalPrivateStorage({ root: path.join(parentFile, 'store'), appEnv: 'local', nodeEnv: 'test' });
    await expect(storage.init()).rejects.toMatchObject({ reason: 'NOT_A_DIRECTORY' });
  });

  it('classifies ENOENT from creating the root (Windows: a parent is a file or the drive is missing) as NOT_A_DIRECTORY', async () => {
    const storage = newStorage({
      operations: {
        mkdir: async () => {
          throw Object.assign(new Error('QA simulated ERROR_PATH_NOT_FOUND'), { code: 'ENOENT' });
        },
      },
    });
    await expect(storage.init()).rejects.toMatchObject({ reason: 'NOT_A_DIRECTORY' });
  });

  it.runIf(isPosix)('fails when the root is a symbolic link', async () => {
    const real = path.join(root, 'real');
    fs.mkdirSync(real, { mode: 0o700 });
    fs.symlinkSync(real, storageRoot);
    await expect(newStorage().init()).rejects.toMatchObject({ reason: 'NOT_A_DIRECTORY' });
  });

  it.runIf(isPosix)('fails when other users can access the root (POSIX mode check)', async () => {
    fs.mkdirSync(storageRoot, { mode: 0o755 });
    fs.chmodSync(storageRoot, 0o755);
    await expect(newStorage().init()).rejects.toMatchObject({ reason: 'PERMISSIONS_TOO_OPEN' });
  });

  it('fails, with a fixed reason, when the probe cannot be written', async () => {
    const storage = newStorage({
      operations: {
        writeFile: async () => {
          throw Object.assign(new Error(`QA: cannot write ${storageRoot}`), { code: 'EACCES' });
        },
      },
    });
    const error = await storage.init().catch((caught) => caught);
    expect(error).toBeInstanceOf(StorageInitializationError);
    expect(error.reason).toBe('PERMISSION_DENIED');
    expect(error.message).not.toContain(storageRoot);
    expect(storage.isReady).toBe(false);
  });

  it('is not usable before init or after close', async () => {
    const storage = newStorage();
    await expect(storage.storePrivateResume(request_())).rejects.toMatchObject({ reason: 'NOT_READY' });
    await storage.init();
    await storage.close();
    await expect(storage.storePrivateResume(request_())).rejects.toMatchObject({ reason: 'NOT_READY' });
    await expect(storage.init()).rejects.toMatchObject({ reason: 'NOT_READY' });
  });
});

describe('storing persists the exact bytes (Doc 18 section 121: object persisted)', () => {
  it('writes the file under a generated key, with the same size and SHA-256', async () => {
    const storage = newStorage({ clock: () => new Date('2026-09-28T12:00:00.000Z') });
    await storage.init();
    const stored = await storage.storePrivateResume(request_());
    expect(stored).toEqual({
      storageProvider: 'LOCAL_DEVELOPMENT',
      storageKey: expect.stringMatching(/^resumes\/[0-9a-f]{32}\/[0-9a-f]{32}$/),
      sizeBytes: pdf.length,
      checksumSha256: sha256(pdf),
      storedAt: new Date('2026-09-28T12:00:00.000Z'),
    });
    const onDisk = fs.readFileSync(objectPath(stored.storageKey));
    expect(onDisk.equals(pdf)).toBe(true);
    expect(sha256(onDisk)).toBe(stored.checksumSha256);
    expect(await storage.statPrivateObject(stored.storageKey)).toEqual({ exists: true, sizeBytes: pdf.length });
    if (isPosix) expect(fs.statSync(objectPath(stored.storageKey)).mode & 0o777).toBe(0o600);
    // Only the object — no partial file, no probe.
    expect(objects()).toEqual([stored.storageKey.slice('resumes/'.length).split('/').join(path.sep)]);
    // The source (the upload's temporary file) is left for its owner to remove.
    expect(fs.existsSync(source)).toBe(true);
  });

  it('survives a NEW adapter instance on the same root', async () => {
    const first = newStorage();
    await first.init();
    const stored = await first.storePrivateResume(request_());
    await first.close();

    const second = newStorage();
    await second.init();
    expect(await second.statPrivateObject(stored.storageKey)).toEqual({ exists: true, sizeBytes: pdf.length });
    expect(sha256(fs.readFileSync(objectPath(stored.storageKey)))).toBe(sha256(pdf));
  });

  it('survives the PROCESS that wrote it: a child stores, this process finds the exact bytes', async () => {
    const child = spawnSync(
      process.execPath,
      [path.join(import.meta.dirname, 'fixtures', 'storage-child.mjs'), storageRoot, source, sha256(pdf), String(pdf.length)],
      { encoding: 'utf8', timeout: 30_000 },
    );
    expect(child.status).toBe(0);
    const stored = JSON.parse(child.stdout.trim());
    expect(stored.pid).not.toBe(process.pid);

    const reader = newStorage();
    await reader.init();
    expect(await reader.statPrivateObject(stored.storageKey)).toEqual({ exists: true, sizeBytes: pdf.length });
    expect(fs.readFileSync(objectPath(stored.storageKey)).equals(pdf)).toBe(true);
    // And the new process can remove it (B5 compensation works across restarts).
    expect(await reader.deletePrivateObject(stored.storageKey)).toEqual({ deleted: true });
    expect(objects()).toEqual([]);
  }, 30_000);

  it('gives every object a distinct key (Doc 17 section 105)', async () => {
    const storage = newStorage();
    await storage.init();
    const keys = [];
    for (let index = 0; index < 50; index += 1) keys.push((await storage.storePrivateResume(request_())).storageKey);
    expect(new Set(keys).size).toBe(50);
    expect(objects()).toHaveLength(50);
  });

  it('never overwrites: a colliding key is detected and a new one generated', async () => {
    const storage = newStorage();
    await storage.init();
    const existing = await storage.storePrivateResume(request_());
    const fresh = generateResumeStorageKey();
    const keys = [existing.storageKey, existing.storageKey, fresh];
    const colliding = newStorage({ generateKey: () => keys.shift() });
    await colliding.init();

    const other = Buffer.from(`${pdf.toString('latin1')}%QA other\n`, 'latin1');
    fs.writeFileSync(source, other);
    const stored = await colliding.storePrivateResume({ filePath: source, sizeBytes: other.length, checksumSha256: sha256(other) });
    expect(stored.storageKey).toBe(fresh);
    // The first object is untouched.
    expect(fs.readFileSync(objectPath(existing.storageKey)).equals(pdf)).toBe(true);
  });

  it('gives up after repeated collisions rather than overwriting', async () => {
    const storage = newStorage();
    await storage.init();
    const existing = await storage.storePrivateResume(request_());
    const colliding = newStorage({ generateKey: () => existing.storageKey });
    await colliding.init();
    await expect(colliding.storePrivateResume(request_())).rejects.toMatchObject({ reason: 'KEY_COLLISION' });
    expect(fs.readFileSync(objectPath(existing.storageKey)).equals(pdf)).toBe(true);
  });
});

describe('failed or unverifiable writes store nothing (Doc 09 section 137, Doc 13 section 229)', () => {
  const failure = (code) => Object.assign(new Error(`QA simulated failure at ${storageRoot}`), { code });

  it.each([
    ['a wrong checksum', () => ({ ...request_(), checksumSha256: '0'.repeat(64) }), 'INTEGRITY_MISMATCH'],
    ['a declared size smaller than the file', () => ({ ...request_(), sizeBytes: pdf.length - 1 }), 'INTEGRITY_MISMATCH'],
    ['a declared size larger than the file', () => ({ ...request_(), sizeBytes: pdf.length + 1 }), 'INTEGRITY_MISMATCH'],
    ['a missing source file', () => ({ ...request_(), filePath: path.join(root, 'missing.part') }), 'SOURCE_UNREADABLE'],
    ['a relative source path', () => ({ ...request_(), filePath: 'validated-upload.part' }), 'INVALID_REQUEST'],
    ['a size over 5 MiB', () => ({ ...request_(), sizeBytes: 5_242_881 }), 'INVALID_REQUEST'],
    ['an empty file', () => ({ ...request_(), sizeBytes: 0 }), 'INVALID_REQUEST'],
    ['an upper-case checksum', () => ({ ...request_(), checksumSha256: sha256(pdf).toUpperCase() }), 'INVALID_REQUEST'],
  ])('%s is refused and leaves nothing', async (_label, build, reason) => {
    const storage = newStorage();
    await storage.init();
    await expect(storage.storePrivateResume(build())).rejects.toMatchObject({ name: 'PrivateStorageError', reason });
    expect(objects()).toEqual([]);
    expect(fs.readdirSync(path.join(storageRoot, 'resumes'))).toEqual([]);
  });

  it.each([
    ['disk full while writing', 'createWriteStream', 'ENOSPC', 'NO_SPACE'],
    ['permission denied while writing', 'createWriteStream', 'EACCES', 'PERMISSION_DENIED'],
    ['read-only filesystem', 'mkdir', 'EROFS', 'READ_ONLY'],
    ['the final rename fails', 'rename', 'EIO', 'IO_ERROR'],
  ])('%s: rejected, partial data removed', async (_label, operation, code, reason) => {
    const real = { rename: fs.promises.rename, mkdir: fs.promises.mkdir };
    const operations = {
      createWriteStream: operation === 'createWriteStream' ? () => { throw failure(code); } : undefined,
      rename: operation === 'rename' ? async () => { throw failure(code); } : undefined,
      mkdir: operation === 'mkdir'
        ? async (target, options) => {
          // Let init() build the root; fail only the per-object directory.
          if (path.dirname(target) === path.join(storageRoot, 'resumes')) throw failure(code);
          return real.mkdir(target, options);
        }
        : undefined,
    };
    const storage = newStorage({ operations: Object.fromEntries(Object.entries(operations).filter(([, value]) => value)) });
    await storage.init();
    const error = await storage.storePrivateResume(request_()).catch((caught) => caught);
    expect(error).toBeInstanceOf(PrivateStorageError);
    expect(error.reason).toBe(reason);
    expect(error.message).not.toContain(storageRoot);
    expect(objects()).toEqual([]);
  });

  it('a failure AFTER the object is in place (directory sync) removes the object too', async () => {
    /*
     * r3: this test used to force `platform: 'linux'` to reach the directory
     * sync. On Windows that also switched on the POSIX permission check for a
     * real Windows directory, whose mode bits mean nothing there, so init()
     * failed (PERMISSIONS_TOO_OPEN) before the injected failure was reached
     * (B4 r2 Windows run). The sync step is now enabled on its own, the real
     * platform keeps its own permission rules, and the test proves the object
     * really was in place before the failure — on every OS.
     */
    let renamedInto = null;
    let directoryOpens = 0;
    const storage = newStorage({
      syncDirectories: true,
      operations: {
        rename: async (from, to) => {
          await fs.promises.rename(from, to);
          renamedInto = to;
        },
        // The source file opens normally; opening the object DIRECTORY to
        // sync it fails.
        open: async (target, flags) => {
          if (target === source) return fs.promises.open(target, flags);
          directoryOpens += 1;
          expect(fs.statSync(renamedInto).size).toBe(pdf.length); // the object IS in place now
          throw failure('EIO');
        },
      },
    });
    await storage.init();
    await expect(storage.storePrivateResume(request_())).rejects.toMatchObject({ reason: 'IO_ERROR' });
    expect(directoryOpens).toBe(1);
    expect(fs.existsSync(renamedInto)).toBe(false);
    expect(objects()).toEqual([]);
  });

  it('under Windows rules, Windows-style mode bits do not block start-up, and the post-rename failure still cleans up', async () => {
    // On a real Windows directory lstat reports mode bits like 0o40666, which
    // express no access control; the Windows rules must not read them as
    // "open to other users". Simulated here on every OS by reporting such
    // bits; the real Windows run exercises the genuine metadata.
    const storage = newStorage({
      platform: 'win32',
      syncDirectories: true,
      operations: {
        lstat: async (target, options) => {
          const stat = await fs.promises.lstat(target, options);
          return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { mode: stat.isDirectory() ? 0o40666 : 0o100666 });
        },
        open: async (target, flags) => {
          if (target === source) return fs.promises.open(target, flags);
          throw failure('EIO');
        },
      },
    });
    await storage.init();
    expect(storage.isReady).toBe(true);
    await expect(storage.storePrivateResume(request_())).rejects.toMatchObject({ reason: 'IO_ERROR' });
    expect(objects()).toEqual([]);
  });

  it('by default the directory sync follows the platform: skipped on Windows, performed elsewhere', async () => {
    const opened = [];
    const storage = newStorage({
      operations: {
        open: async (target, flags) => {
          if (target !== source) opened.push('directory');
          return fs.promises.open(target, flags);
        },
      },
    });
    await storage.init();
    await storage.storePrivateResume(request_());
    expect(opened).toEqual(process.platform === 'win32' ? [] : ['directory']);
  });

  it('a mid-stream write failure leaves no partial object', async () => {
    const { Writable } = await import('node:stream');
    let written = 0;
    const storage = newStorage({
      operations: {
        createWriteStream: (target, options) => {
          const real = fs.createWriteStream(target, options);
          return new Writable({
            write(chunk, encoding, callback) {
              written += chunk.length;
              if (written > 100) {
                callback(failure('ENOSPC'));
                return;
              }
              real.write(chunk, encoding, callback);
            },
            final(callback) {
              real.end(callback);
            },
            destroy(error, callback) {
              // Report "destroyed" only once the real file handle is closed,
              // as fs.WriteStream itself does (matters on Windows).
              real.once('close', () => callback(error));
              real.destroy();
            },
          });
        },
      },
    });
    await storage.init();
    await expect(storage.storePrivateResume(request_())).rejects.toMatchObject({ reason: 'NO_SPACE' });
    expect(objects()).toEqual([]);
    expect(fs.readdirSync(path.join(storageRoot, 'resumes'))).toEqual([]);
  });

  it('when even the cleanup fails, it is logged with the key (no path) and still rejected', async () => {
    const log = capturingLogger();
    const storage = newStorage({
      logger: log.logger,
      operations: {
        rename: async () => {
          throw failure('EIO');
        },
        rm: async () => {
          throw failure('EBUSY');
        },
      },
    });
    await storage.init();
    await expect(storage.storePrivateResume(request_())).rejects.toMatchObject({ reason: 'IO_ERROR' });
    const output = log.output();
    expect(output).toContain('"event":"private_storage_cleanup_incomplete"');
    expect(output).toMatch(/"storageKey":"resumes\/[0-9a-f]{32}\/[0-9a-f]{32}"/);
    expect(output).not.toContain(storageRoot);
    expect(output).not.toContain('QA simulated');
  });
});

describe('deletion is confined to valid objects (Doc 09 section 119, Doc 13 sections 79 and 233)', () => {
  let storage;
  beforeEach(async () => {
    storage = newStorage();
    await storage.init();
  });

  it('deletes a stored object and its directory; a second delete reports NOT_FOUND', async () => {
    const stored = await storage.storePrivateResume(request_());
    expect(await storage.deletePrivateObject(stored.storageKey)).toEqual({ deleted: true });
    expect(fs.existsSync(path.dirname(objectPath(stored.storageKey)))).toBe(false);
    expect(await storage.deletePrivateObject(stored.storageKey)).toEqual({ deleted: false, reason: 'NOT_FOUND' });
    expect(await storage.statPrivateObject(stored.storageKey)).toEqual({ exists: false });
  });

  it.each([
    '../../etc/passwd',
    'resumes/../../../outside',
    `resumes/${'a'.repeat(32)}/../../x`,
    '/etc/passwd',
    'C:\\Windows\\win.ini',
    `resumes\\${'a'.repeat(32)}\\${'b'.repeat(32)}`,
    `resumes/${'A'.repeat(32)}/${'b'.repeat(32)}`,
    `resumes/${'a'.repeat(31)}/${'b'.repeat(32)}`,
    `other/${'a'.repeat(32)}/${'b'.repeat(32)}`,
    '',
    null,
    { toString: () => 'resumes/x' },
  ])('refuses the invalid key %j without touching the filesystem', async (key) => {
    let touched = 0;
    const count = (fn) => async (...args) => {
      touched += 1;
      return fn(...args);
    };
    const spied = newStorage({ operations: { lstat: count(fs.promises.lstat), unlink: count(fs.promises.unlink) } });
    await spied.init();
    touched = 0;
    await expect(spied.deletePrivateObject(key)).rejects.toMatchObject({ reason: 'INVALID_KEY' });
    expect(touched).toBe(0);
  });

  it('refuses to delete something that is not a regular file (a directory planted at an object path)', async () => {
    const key = generateResumeStorageKey();
    fs.mkdirSync(objectPath(key), { recursive: true });
    await expect(storage.deletePrivateObject(key)).rejects.toMatchObject({ reason: 'NOT_A_FILE' });
    expect(fs.existsSync(objectPath(key))).toBe(true);
  });

  it.runIf(isPosix)('never follows a symbolic link planted at an object path', async () => {
    const outside = path.join(root, 'outside.txt');
    fs.writeFileSync(outside, 'must survive');
    const key = generateResumeStorageKey();
    fs.mkdirSync(path.dirname(objectPath(key)), { recursive: true });
    fs.symlinkSync(outside, objectPath(key));
    await expect(storage.deletePrivateObject(key)).rejects.toMatchObject({ reason: 'NOT_A_FILE' });
    expect(fs.readFileSync(outside, 'utf8')).toBe('must survive');
  });

  it('a delete failure is reported, never swallowed', async () => {
    const stored = await storage.storePrivateResume(request_());
    const failing = newStorage({
      operations: {
        unlink: async () => {
          throw Object.assign(new Error('QA'), { code: 'EACCES' });
        },
      },
    });
    await failing.init();
    await expect(failing.deletePrivateObject(stored.storageKey)).rejects.toMatchObject({ reason: 'PERMISSION_DENIED' });
    expect(fs.existsSync(objectPath(stored.storageKey))).toBe(true);
  });
});

describe('privacy (Doc 17 sections 125-126, Doc 18 sections 118 and 121)', () => {
  it('a stored object cannot be fetched over HTTP by its key or any path', async () => {
    const storage = newStorage();
    await storage.init();
    const { storageKey } = await storage.storePrivateResume(request_());
    const app = buildApp();
    const [, id, fileKey] = storageKey.split('/');
    for (const url of [
      `/${storageKey}`,
      `/api/v1/${storageKey}`,
      `/api/v1/resumes/${id}`,
      `/api/v1/resumes/${id}/${fileKey}`,
      `/uploads/${fileKey}`,
      `/public/uploads/${fileKey}`,
      `/private-resumes/${storageKey}`,
      `/api/v1/applications/${id}/resume`,
    ]) {
      const response = await request(app).get(url);
      expect(response.status, url).toBe(404);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.text).not.toContain(QA_PDF_MARKER);
      expect(response.body.error.code).toBe('API_ROUTE_NOT_FOUND');
    }
  });

  it('no storage key or path appears in any failure message', async () => {
    const storage = newStorage();
    await storage.init();
    const error = await storage.storePrivateResume({ ...request_(), checksumSha256: '0'.repeat(64) }).catch((caught) => caught);
    expect(error.message).toBe('private storage store failed: INTEGRITY_MISMATCH');
  });
});

describe('contract helpers', () => {
  it('generates 256-bit lowercase-hex keys', () => {
    const keys = Array.from({ length: 1000 }, () => generateResumeStorageKey());
    expect(new Set(keys).size).toBe(1000);
    keys.forEach((key) => expect(isResumeStorageKey(key)).toBe(true));
  });

  it('classifies filesystem errors by exact code only', () => {
    expect(classifyStorageError(Object.assign(new Error('x'), { code: 'ENOSPC' }))).toBe('NO_SPACE');
    expect(classifyStorageError(Object.assign(new Error('x'), { code: 'mongodb://secret' }))).toBe('IO_ERROR');
    expect(classifyStorageError(null)).toBe('IO_ERROR');
    expect(STORAGE_FAILURE_REASONS).toContain(new PrivateStorageError('store', 'NOT_A_REASON').reason);
  });
});

const QA_PDF_MARKER = 'QA TEST DOCUMENT';
