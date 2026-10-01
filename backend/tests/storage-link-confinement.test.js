import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import {
  loadConfig, ConfigurationError, APPLICATION_ROOT, checkLocalStorageRoot, checkResolvedLocalStorageRoot,
} from '../src/config/env.js';
import { LocalPrivateStorage } from '../src/integrations/storage/localPrivateStorage.js';
import { StorageInitializationError } from '../src/integrations/storage/privateStorage.js';
import { capturingLogger } from './helpers.js';
import { syntheticPdf } from './fixtures/resumeFiles.js';
import { makeTestRoot, removeTestRoot, listFiles } from './fixtures/uploadHarness.js';

/**
 * B4 review r1, FINDING 2 — storage confinement against REAL locations.
 *
 * r1 checked the storage root as written and each object path by its final
 * component. A link in an ANCESTOR bypassed both: an innocent alias pointing
 * at a directory named "public" was accepted as the root and written into,
 * and a linked object directory let deletePrivateObject() remove a file
 * outside storage.
 *
 * Everything here runs on the REAL filesystem in a fresh test root. Links are
 * created with fs.symlinkSync(target, link, 'junction'):
 *   - on Linux and macOS the type is ignored and a directory SYMBOLIC LINK is
 *     created — that is what the Linux run of this file exercises;
 *   - on Windows the same call creates a JUNCTION (no administrator right or
 *     Developer Mode needed), so the Windows run exercises junctions. The
 *     Windows run is separate evidence and is recorded as pending until it is
 *     actually performed; the Linux results say nothing about Windows.
 * One extra case needs a Windows directory SYMBOLIC link, which Windows only
 * lets privileged users create; it reports itself skipped (never silently)
 * where that is not possible.
 *
 * No test writes into, or links to, the repository: the "repository" cases
 * use a synthetic stand-in directory inside the test root (and one check
 * that resolves the real APPLICATION_ROOT without creating anything). Every
 * link is created inside the fresh test root, and removeTestRoot unlinks
 * links before deleting, never following one.
 */
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const linkDirectory = (target, link) => fs.symlinkSync(target, link, 'junction');
const hex = () => randomBytes(16).toString('hex');

let root;
let source;
let pdf;

beforeEach(() => {
  root = makeTestRoot();
  pdf = syntheticPdf();
  source = path.join(root, 'validated-upload.part');
  fs.writeFileSync(source, pdf);
});

afterEach(() => {
  removeTestRoot(root);
});

const storeRequest = () => ({ filePath: source, sizeBytes: pdf.length, checksumSha256: sha256(pdf) });
const newStorage = (storageRoot, options = {}) =>
  new LocalPrivateStorage({ root: storageRoot, appEnv: 'local', nodeEnv: 'test', ...options });

const configFor = (storageRoot) =>
  loadConfig({
    NODE_ENV: 'development',
    APP_ENV: 'local',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/valida_test',
    RESUME_STORAGE_DRIVER: 'local',
    RESUME_STORAGE_LOCAL_ROOT: storageRoot,
  });
const configFailure = (storageRoot) => {
  try {
    configFor(storageRoot);
  } catch (error) {
    return error;
  }
  return null;
};

async function initFailure(storage) {
  try {
    await storage.init();
  } catch (error) {
    return error;
  }
  return null;
}

/** A synthetic file outside storage, and a check that it is untouched. */
function outsideFile(directory, name, content = 'QA OUTSIDE FILE - MUST SURVIVE') {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, name);
  fs.writeFileSync(file, content);
  return { file, survived: () => fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content };
}

describe('configuration resolves the root through links (review reproduction A)', () => {
  it('an innocently named link to a directory named "public" is refused as a public location', () => {
    fs.mkdirSync(path.join(root, 'public'));
    linkDirectory(path.join(root, 'public'), path.join(root, 'innocent'));
    const storageRoot = path.join(root, 'innocent', 'private-resumes');
    const error = configFailure(storageRoot);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error.issues).toEqual([expect.objectContaining({ variable: 'RESUME_STORAGE_LOCAL_ROOT' })]);
    expect(error.message).toMatch(/public, static or web-served/);
    expect(error.message).not.toContain(root);
    expect(listFiles(path.join(root, 'public'))).toEqual([]);
  });

  it('a link to a web-served directory deeper in the path is refused too', () => {
    fs.mkdirSync(path.join(root, 'site', 'wwwroot', 'app'), { recursive: true });
    linkDirectory(path.join(root, 'site', 'wwwroot', 'app'), path.join(root, 'data'));
    expect(configFailure(path.join(root, 'data', 'resumes-qa'))?.message).toMatch(/public, static or web-served/);
  });

  it('a link into the repository is refused (checked against a synthetic stand-in; the real repository is never linked)', () => {
    const repository = path.join(root, 'repository-stand-in');
    fs.mkdirSync(path.join(repository, 'backend'), { recursive: true });
    linkDirectory(path.join(repository, 'backend'), path.join(root, 'innocent'));
    const storageRoot = path.join(root, 'innocent', 'private-resumes');
    expect(checkLocalStorageRoot(storageRoot, { applicationRoot: repository })).toBeNull(); // as written it looks fine
    expect(checkResolvedLocalStorageRoot(storageRoot, { applicationRoot: repository })).toBe('RESUME_STORAGE_LOCAL_ROOT_INSIDE_APPLICATION');
    expect(listFiles(repository)).toEqual([]);
  });

  it('on a case-insensitive file system (macOS) the repository comparison ignores case', () => {
    const options = { pathApi: path.posix, applicationRoot: '/Users/qa/valida' };
    expect(checkLocalStorageRoot('/Users/QA/VALIDA/private-storage', { ...options, caseInsensitive: true })).toBe(
      'RESUME_STORAGE_LOCAL_ROOT_INSIDE_APPLICATION',
    );
    expect(checkLocalStorageRoot('/Users/QA/VALIDA/private-storage', { ...options, caseInsensitive: false })).toBeNull();
    // And a root that CONTAINS the repository, in another case.
    expect(checkLocalStorageRoot('/USERS/qa', { ...options, caseInsensitive: true })).toBe('RESUME_STORAGE_LOCAL_ROOT_INSIDE_APPLICATION');
  });

  it('the real repository location is compared as resolved, too', () => {
    // No link to the repository is created: the check resolves APPLICATION_ROOT itself.
    expect(checkResolvedLocalStorageRoot(path.join(APPLICATION_ROOT, 'backend', 'qa-storage-must-not-exist'))).toBe(
      'RESUME_STORAGE_LOCAL_ROOT_INSIDE_APPLICATION',
    );
    expect(fs.existsSync(path.join(APPLICATION_ROOT, 'backend', 'qa-storage-must-not-exist'))).toBe(false);
  });

  it('a broken link in the path is refused (it would be created through)', () => {
    linkDirectory(path.join(root, 'does-not-exist'), path.join(root, 'dangling'));
    expect(configFailure(path.join(root, 'dangling', 'private-resumes'))?.message).toMatch(/must resolve to a real location/);
  });

  it('a link to a legitimate private directory is accepted — links are followed, not banned', () => {
    fs.mkdirSync(path.join(root, 'real-private'));
    linkDirectory(path.join(root, 'real-private'), path.join(root, 'alias'));
    expect(configFor(path.join(root, 'alias', 'private-resumes')).resumeStorage.driver).toBe('local');
  });
});

describe('initialisation refuses a forbidden REAL location before creating anything', () => {
  it('the review reproduction, constructed directly (bypassing configuration): no byte reaches "public"', async () => {
    fs.mkdirSync(path.join(root, 'public'));
    linkDirectory(path.join(root, 'public'), path.join(root, 'innocent'));
    const storage = newStorage(path.join(root, 'innocent', 'private-resumes'));
    const error = await initFailure(storage);
    expect(error).toBeInstanceOf(StorageInitializationError);
    expect(error.reason).toBe('FORBIDDEN_LOCATION');
    expect(storage.isReady).toBe(false);
    expect(fs.readdirSync(path.join(root, 'public'))).toEqual([]);
    await expect(storage.storePrivateResume(storeRequest())).rejects.toMatchObject({ reason: 'NOT_READY' });
  });

  it('a link into the (synthetic) repository is refused, and nothing is created in it', async () => {
    const repository = path.join(root, 'repository-stand-in');
    fs.mkdirSync(path.join(repository, 'backend'), { recursive: true });
    linkDirectory(path.join(repository, 'backend'), path.join(root, 'innocent'));
    const storage = newStorage(path.join(root, 'innocent', 'private-resumes'), { applicationRoot: repository });
    expect((await initFailure(storage))?.reason).toBe('FORBIDDEN_LOCATION');
    expect(listFiles(repository)).toEqual([]);
    expect(fs.readdirSync(path.join(repository, 'backend'))).toEqual([]);
  });

  it('a link swapped into an ancestor WHILE the root is being created is caught by the second check', async () => {
    fs.mkdirSync(path.join(root, 'public'));
    fs.mkdirSync(path.join(root, 'a'));
    const realMkdir = fs.promises.mkdir;
    let swapped = false;
    const storage = newStorage(path.join(root, 'a', 'b', 'private-resumes'), {
      operations: {
        // The first check passes; then, just before the root is created, "a" becomes a link to "public".
        mkdir: async (target, options) => {
          if (!swapped) {
            swapped = true;
            fs.renameSync(path.join(root, 'a'), path.join(root, 'a-moved'));
            linkDirectory(path.join(root, 'public'), path.join(root, 'a'));
          }
          return realMkdir(target, options);
        },
      },
    });
    expect((await initFailure(storage))?.reason).toBe('FORBIDDEN_LOCATION');
    expect(storage.isReady).toBe(false);
    // Empty directories may have been created through the link; no object, probe or file ever is.
    expect(listFiles(path.join(root, 'public'))).toEqual([]);
  });

  it('a root under a linked ancestor that leads somewhere private works end to end', async () => {
    fs.mkdirSync(path.join(root, 'real-private'));
    linkDirectory(path.join(root, 'real-private'), path.join(root, 'alias'));
    const storage = newStorage(path.join(root, 'alias', 'private-resumes'));
    await storage.init();
    const stored = await storage.storePrivateResume(storeRequest());
    // The bytes are in the REAL private directory.
    const realObject = path.join(root, 'real-private', 'private-resumes', ...stored.storageKey.split('/'));
    expect(sha256(fs.readFileSync(realObject))).toBe(sha256(pdf));
    expect(await storage.statPrivateObject(stored.storageKey)).toEqual({ exists: true, sizeBytes: pdf.length });
    expect(await storage.deletePrivateObject(stored.storageKey)).toEqual({ deleted: true });
    expect(fs.existsSync(realObject)).toBe(false);
  });
});

describe('store, stat, delete and cleanup never act through a linked parent', () => {
  let storageRoot;
  let storage;
  let log;

  beforeEach(async () => {
    storageRoot = path.join(root, 'private-resumes');
    log = capturingLogger();
    storage = newStorage(storageRoot, { logger: log.logger });
    await storage.init();
  });

  it('review reproduction B: resumes/<id> linked to an outside directory — delete refuses and the outside file survives', async () => {
    const id = hex();
    const fileKey = hex();
    const outside = outsideFile(path.join(root, 'outside'), fileKey);
    linkDirectory(path.join(root, 'outside'), path.join(storageRoot, 'resumes', id));

    await expect(storage.deletePrivateObject(`resumes/${id}/${fileKey}`)).rejects.toMatchObject({ reason: 'PATH_ESCAPES_STORAGE' });
    expect(outside.survived()).toBe(true);
    // Nor does stat report (or size) the outside file as a stored object.
    await expect(storage.statPrivateObject(`resumes/${id}/${fileKey}`)).rejects.toMatchObject({ reason: 'PATH_ESCAPES_STORAGE' });
  });

  it('the whole object directory swapped for a link after start-up — delete, stat and store all refuse', async () => {
    const stored = await storage.storePrivateResume(storeRequest());
    const [, id, fileKey] = stored.storageKey.split('/');
    // Move the real object directory away and put a link to a look-alike in its place.
    fs.renameSync(path.join(storageRoot, 'resumes'), path.join(root, 'moved-away'));
    const outside = outsideFile(path.join(root, 'lookalike', id), fileKey);
    linkDirectory(path.join(root, 'lookalike'), path.join(storageRoot, 'resumes'));

    await expect(storage.deletePrivateObject(stored.storageKey)).rejects.toMatchObject({ reason: 'PATH_ESCAPES_STORAGE' });
    await expect(storage.statPrivateObject(stored.storageKey)).rejects.toMatchObject({ reason: 'PATH_ESCAPES_STORAGE' });
    await expect(storage.storePrivateResume(storeRequest())).rejects.toMatchObject({ reason: 'PATH_ESCAPES_STORAGE' });
    expect(outside.survived()).toBe(true);
    // Nothing new was written — not even a directory — through the link.
    expect(listFiles(path.join(root, 'lookalike'))).toEqual([path.join(id, fileKey)]);
    expect(fs.readdirSync(path.join(root, 'lookalike'))).toEqual([id]);
  });

  it('an ANCESTOR of the root swapped for a link — delete refuses; the look-alike outside survives', async () => {
    const base = path.join(root, 'base');
    const nested = newStorage(path.join(base, 'private-resumes'));
    await nested.init();
    const stored = await nested.storePrivateResume(storeRequest());
    const [, id, fileKey] = stored.storageKey.split('/');
    fs.renameSync(base, path.join(root, 'base-moved'));
    const outside = outsideFile(path.join(root, 'elsewhere', 'private-resumes', 'resumes', id), fileKey);
    linkDirectory(path.join(root, 'elsewhere'), base);

    await expect(nested.deletePrivateObject(stored.storageKey)).rejects.toMatchObject({ reason: 'PATH_ESCAPES_STORAGE' });
    expect(outside.survived()).toBe(true);
    // The genuine object, moved with its directory, is untouched too.
    expect(sha256(fs.readFileSync(path.join(root, 'base-moved', 'private-resumes', ...stored.storageKey.split('/'))))).toBe(sha256(pdf));
  });

  it('a file planted where an object directory should be is not treated as one', async () => {
    const id = hex();
    fs.writeFileSync(path.join(storageRoot, 'resumes', id), 'QA not a directory');
    await expect(storage.deletePrivateObject(`resumes/${id}/${hex()}`)).rejects.toMatchObject({ reason: 'PATH_ESCAPES_STORAGE' });
    expect(fs.readFileSync(path.join(storageRoot, 'resumes', id), 'utf8')).toBe('QA not a directory');
  });

  it('an object directory swapped for a link AFTER the bytes are written: nothing is published, and cleanup deletes nothing through the link', async () => {
    let outside;
    let movedTo;
    const swapping = newStorage(path.join(root, 'swap-store'), {
      logger: log.logger,
      operations: {
        createWriteStream: (target, options) => {
          const stream = fs.createWriteStream(target, options);
          // 'close', not 'finish': the file must be closed first, or Windows
          // cannot rename the directory that holds it.
          stream.once('close', () => {
            // After the write, before publication: swap the object directory.
            const directory = path.dirname(target);
            movedTo = path.join(root, `moved-${path.basename(directory)}`);
            fs.renameSync(directory, movedTo);
            outside = outsideFile(path.join(root, 'swap-outside'), path.basename(target));
            linkDirectory(path.join(root, 'swap-outside'), directory);
          });
          return stream;
        },
      },
    });
    await swapping.init();
    await expect(swapping.storePrivateResume(storeRequest())).rejects.toMatchObject({ reason: 'PATH_ESCAPES_STORAGE' });
    expect(outside.survived()).toBe(true);
    expect(listFiles(path.join(root, 'swap-outside'))).toHaveLength(1);
    // The partial file is still in the real (moved) directory — reported, never deleted blindly.
    expect(listFiles(movedTo)).toHaveLength(1);
    expect(log.output()).toContain('"event":"private_storage_cleanup_incomplete"');
    expect(log.output()).toContain('"leftovers":["unverifiable"]');
    expect(log.output()).not.toContain(root);
  });

  it('ordinary behaviour is unchanged: store, stat and delete a real object', async () => {
    const stored = await storage.storePrivateResume(storeRequest());
    expect(await storage.statPrivateObject(stored.storageKey)).toEqual({ exists: true, sizeBytes: pdf.length });
    expect(await storage.deletePrivateObject(stored.storageKey)).toEqual({ deleted: true });
    expect(await storage.deletePrivateObject(stored.storageKey)).toEqual({ deleted: false, reason: 'NOT_FOUND' });
    expect(listFiles(path.join(storageRoot, 'resumes'))).toEqual([]);
  });
});

describe('Windows directory symbolic links (not junctions)', () => {
  it('a Windows directory symbolic link as the object directory is refused like a junction', async (context) => {
    if (process.platform !== 'win32') context.skip('Windows only; POSIX symbolic links are covered above');
    const storageRoot = path.join(root, 'private-resumes');
    const storage = newStorage(storageRoot);
    await storage.init();
    const id = hex();
    const fileKey = hex();
    const outside = outsideFile(path.join(root, 'outside'), fileKey);
    try {
      fs.symlinkSync(path.join(root, 'outside'), path.join(storageRoot, 'resumes', id), 'dir');
    } catch (error) {
      if (error?.code === 'EPERM') context.skip('creating a directory symbolic link needs Developer Mode or administrator rights');
      throw error;
    }
    await expect(storage.deletePrivateObject(`resumes/${id}/${fileKey}`)).rejects.toMatchObject({ reason: 'PATH_ESCAPES_STORAGE' });
    expect(outside.survived()).toBe(true);
  });
});
