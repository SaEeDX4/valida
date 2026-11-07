import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { E2E_DIR, REPO_ROOT } from '../support/paths.js';
import { RUN_TOKEN_FILE, RunDirectoryRefused, createRunDirectory, createRunSubdirectories, isInside, verifyRunDirectory } from '../support/runDirectory.js';

/**
 * C3 r2, GPT finding 1 — every E2E run gets a FRESH, EXCLUSIVELY created run
 * directory, validated by its CANONICAL location before Playwright, Vite or the
 * setup can write or clean anything.
 *
 * Run: `npm run test:guards` (from e2e/). Needs no database, browser or server.
 * The process-level cases start the real Playwright runner (`playwright test`)
 * and prove it stops in the configuration — before its output directory is
 * cleaned and before the setup runs.
 */

const scratch = [];
const tempDir = (label) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), `valida-guard-${label}-`));
  scratch.push(dir);
  return realpathSync.native(dir);
};
const inRepo = (...parts) => path.join(REPO_ROOT, ...parts);
const unique = (label) => `${label}-${randomBytes(4).toString('hex')}`;
after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** A directory listing with sizes and contents, to prove nothing changed. */
function snapshot(dir) {
  const entries = [];
  const walk = (current) => {
    for (const name of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, name.name);
      if (name.isDirectory()) {
        entries.push(`${path.relative(dir, full)}/`);
        walk(full);
      } else entries.push(`${path.relative(dir, full)} ${readFileSync(full, 'utf8')}`);
    }
  };
  walk(dir);
  return entries.sort();
}

/** An existing directory that already holds a dist/ with a sentinel file, and Playwright's output directory with another. */
function existingRunDirectory() {
  const dir = path.join(tempDir('existing'), 'earlier-run');
  mkdirSync(path.join(dir, 'dist'), { recursive: true });
  writeFileSync(path.join(dir, 'dist', 'SENTINEL.txt'), 'C3 r2 sentinel: must survive');
  mkdirSync(path.join(dir, 'output', 'playwright'), { recursive: true });
  writeFileSync(path.join(dir, 'output', 'playwright', 'SENTINEL.txt'), 'C3 r2 sentinel: Playwright must not clean this');
  return dir;
}

/** A symbolic link — on Windows a directory junction — resolving to `target`. */
function linkTo(target) {
  const link = path.join(tempDir('link'), 'link-into-repo');
  symlinkSync(target, link, 'junction');
  return link;
}

const create = (E2E_RUN_DIR, options = {}) => createRunDirectory({ env: E2E_RUN_DIR === undefined ? {} : { E2E_RUN_DIR }, repoRoot: REPO_ROOT, ...options });
const refused = (fn, pattern) => assert.throws(fn, (error) => error instanceof RunDirectoryRefused && pattern.test(error.message));

describe('isInside: canonical containment, not a "starts with .." test', () => {
  const root = path.join(path.sep, 'srv', 'repo');
  for (const [candidate, expected] of [
    [root, true],
    [path.join(root, '..qa'), true],
    [path.join(root, 'e2e', '..qa'), true],
    [path.join(root, '...'), true],
    [path.join(root, 'a', '..', 'b'), true],
    [path.join(root, '..'), false],
    [path.join(root, '..', 'repo-other'), false],
    [`${root}..qa`, false],
    [path.join(path.sep, 'tmp', 'run'), false],
  ]) {
    it(`${candidate} -> ${expected ? 'inside' : 'outside'}`, () => assert.equal(isInside(root, candidate), expected));
  }
  it('Windows paths (path.win32 on any platform): "..qa" inside, another drive outside, case ignored', () => {
    const repo = 'C:\\ME\\valida';
    assert.equal(isInside(repo, 'C:\\ME\\valida\\..qa', path.win32), true);
    assert.equal(isInside(repo, 'c:\\me\\VALIDA\\e2e\\..qa', path.win32), true);
    assert.equal(isInside(repo, 'C:\\ME\\valida..qa', path.win32), false);
    assert.equal(isInside(repo, 'C:\\ME', path.win32), false);
    assert.equal(isInside(repo, 'D:\\valida-e2e\\run', path.win32), false);
  });
});

describe('createRunDirectory refuses, and creates nothing', () => {
  it('an in-repo directory named "..qa" (the repository root, and below e2e/)', () => {
    for (const target of [inRepo(unique('..qa')), inRepo('e2e', unique('..qa'))]) {
      refused(() => create(target), /inside the repository/);
      assert.equal(existsSync(target), false, `${target} was not created`);
    }
  });

  it('a path through a symlink / junction that resolves into the repository', () => {
    for (const target of [REPO_ROOT, E2E_DIR]) {
      const link = linkTo(target);
      const name = unique('qa-run');
      refused(() => create(path.join(link, name)), /inside the repository/);
      assert.equal(existsSync(path.join(target, name)), false, 'nothing was created inside the repository');
      // The link itself exists, so it is refused as well (it is inside, and it is not new).
      refused(() => create(link), /inside the repository|already exists/);
    }
  });

  it('an existing directory holding dist/ with a sentinel file: the sentinel survives, nothing is added', () => {
    const dir = existingRunDirectory();
    const before = snapshot(dir);
    refused(() => create(dir), /already exists/);
    assert.deepEqual(snapshot(dir), before);
    assert.equal(readFileSync(path.join(dir, 'dist', 'SENTINEL.txt'), 'utf8'), 'C3 r2 sentinel: must survive');
  });

  it('a dangling link at the path (mkdir would otherwise create through it)', () => {
    const parent = tempDir('dangling');
    const missingTarget = path.join(parent, 'not-there');
    const link = path.join(parent, 'dangling');
    symlinkSync(missingTarget, link, 'junction');
    refused(() => create(link), /already exists|could not be created/);
    assert.equal(existsSync(missingTarget), false);
  });

  it('a missing parent (no recursive creation)', () => {
    const target = path.join(tempDir('noparent'), 'missing', 'run');
    refused(() => create(target), /parent of E2E_RUN_DIR must already exist/);
    assert.equal(existsSync(path.dirname(target)), false);
  });

  it('a default location inside the repository (TMPDIR pointing into it)', () => {
    const base = path.join(E2E_DIR, 'valida-e2e');
    assert.equal(existsSync(base), false);
    refused(() => create(undefined, { tmpdir: E2E_DIR }), /inside the repository/);
    assert.equal(existsSync(base), false, 'the default base was not created inside the repository');
  });
});

describe('createRunDirectory creates a NEW directory, once', () => {
  it('E2E_RUN_DIR: created, private, with its token; the same path again is refused', () => {
    const target = path.join(tempDir('fresh'), 'run-1');
    const { runDir, runId, token } = create(target);
    assert.equal(runDir, target);
    assert.equal(runId, 'run-1');
    assert.equal(readFileSync(path.join(runDir, RUN_TOKEN_FILE), 'utf8'), token);
    if (process.platform !== 'win32') assert.equal((statSync(runDir).mode & 0o777).toString(8), '700');
    refused(() => create(target), /already exists/);
  });

  it('through a link that resolves OUTSIDE the repository: the canonical path is used', () => {
    const outside = tempDir('outside');
    const link = linkTo(outside);
    const { runDir } = create(path.join(link, 'run-2'));
    assert.equal(runDir, path.join(outside, 'run-2'));
  });

  it('default: <tmp>/valida-e2e/<timestamp>-XXXXXX, a new one each time', () => {
    const tmp = tempDir('default');
    const first = create(undefined, { tmpdir: tmp });
    const second = create(undefined, { tmpdir: tmp });
    assert.notEqual(first.runDir, second.runDir);
    for (const { runDir } of [first, second]) assert.equal(path.dirname(runDir), path.join(tmp, 'valida-e2e'));
  });
});

describe('verifyRunDirectory and createRunSubdirectories (the setup re-checks)', () => {
  const fresh = () => {
    const created = create(path.join(tempDir('verify'), 'run'));
    return { ...created, env: { E2E_RUN_DIR: created.runDir, E2E_RUN_DIR_TOKEN: created.token } };
  };

  it('accepts the directory this run created', () => {
    const { runDir, env } = fresh();
    assert.equal(verifyRunDirectory({ env, repoRoot: REPO_ROOT }), runDir);
  });

  it('refuses a wrong token, a token issued to another process, a missing token', () => {
    const { env } = fresh();
    refused(() => verifyRunDirectory({ env: { ...env, E2E_RUN_DIR_TOKEN: `${'0'.repeat(32)}.${process.pid}` }, repoRoot: REPO_ROOT }), /token does not match/);
    refused(() => verifyRunDirectory({ env, repoRoot: REPO_ROOT, processRef: { pid: 1, ppid: 0 } }), /another run/);
    refused(() => verifyRunDirectory({ env: { E2E_RUN_DIR: env.E2E_RUN_DIR }, repoRoot: REPO_ROOT }), /not created by this run/);
  });

  it('refuses the directory after it was replaced by a link', () => {
    const { runDir, env } = fresh();
    rmSync(runDir, { recursive: true });
    symlinkSync(tempDir('swap'), runDir, 'junction');
    refused(() => verifyRunDirectory({ env, repoRoot: REPO_ROOT }), /not a plain directory/);
  });

  it('creates every subdirectory exclusively; a pre-existing dist/ with a sentinel is refused and survives', () => {
    const { runDir } = fresh();
    mkdirSync(path.join(runDir, 'dist'));
    writeFileSync(path.join(runDir, 'dist', 'SENTINEL.txt'), 'C3 r2 sentinel: must survive');
    const before = snapshot(runDir);
    refused(() => createRunSubdirectories(runDir), /not new: it already holds dist/);
    assert.deepEqual(snapshot(runDir), before);
  });

  it('a new run directory gets new, empty subdirectories (output/ may already exist: Playwright owns it)', () => {
    const { runDir } = fresh();
    mkdirSync(path.join(runDir, 'output'));
    const dirs = createRunSubdirectories(runDir);
    assert.deepEqual(Object.keys(dirs), ['logs', 'smtp', 'storage', 'output', 'dist']);
    for (const dir of Object.values(dirs)) assert.deepEqual(readdirSync(dir), []);
    refused(() => createRunSubdirectories(runDir), /not new/);
  });
});

describe('the real Playwright runner stops in the configuration: nothing is written or cleaned', () => {
  const cli = path.join(E2E_DIR, 'node_modules', '@playwright', 'test', 'cli.js');
  const runPlaywright = (E2E_RUN_DIR) => {
    const env = {};
    for (const name of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PLAYWRIGHT_BROWSERS_PATH']) {
      if (process.env[name] !== undefined) env[name] = process.env[name];
    }
    // A guard-valid, unreachable database: even if the configuration let the run through, nothing real is touched.
    Object.assign(env, { E2E_RUN_DIR, MONGODB_TEST_URI: 'mongodb://127.0.0.1:9/valida_test_guard' });
    const result = spawnSync(process.execPath, [cli, 'test'], { cwd: E2E_DIR, env, encoding: 'utf8', timeout: 60_000 });
    return { code: result.status, output: `${result.stdout}\n${result.stderr}` };
  };

  it('an existing directory with dist/ and output/playwright/ sentinels: both survive, nothing is added', () => {
    const dir = existingRunDirectory();
    const before = snapshot(dir);
    const { code, output } = runPlaywright(dir);
    assert.notEqual(code, 0);
    assert.match(output, /E2E refused: E2E_RUN_DIR already exists/);
    assert.deepEqual(snapshot(dir), before);
  });

  it('an in-repo "..qa": refused, not created', () => {
    const target = inRepo(unique('..qa'));
    const { code, output } = runPlaywright(target);
    assert.notEqual(code, 0);
    assert.match(output, /E2E refused: E2E_RUN_DIR resolves inside the repository/);
    assert.equal(existsSync(target), false);
  });

  it('a symlink / junction into the repository: refused, nothing created in the repository', () => {
    const name = unique('qa-run');
    const { code, output } = runPlaywright(path.join(linkTo(REPO_ROOT), name));
    assert.notEqual(code, 0);
    assert.match(output, /E2E refused: E2E_RUN_DIR resolves inside the repository/);
    assert.equal(existsSync(inRepo(name)), false);
  });
});
