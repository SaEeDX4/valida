import { randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The E2E run directory: FRESH, created EXCLUSIVELY, and verified OUTSIDE the
 * repository by its CANONICAL location — before Playwright, Vite or the setup
 * writes or cleans anything (C3, GPT finding 1).
 *
 * Why each rule:
 * - Canonical location. A path can name the repository without looking like
 *   it: `<repo>/..qa` is inside the repository even though its relative path
 *   starts with "..", and a symlink or a Windows junction elsewhere can resolve
 *   into it. The PARENT is resolved with realpath before anything is created,
 *   and the created directory is resolved again afterwards.
 * - Fresh and exclusive. Playwright empties its output directory at the start
 *   of a run, and a build empties its output directory, so an existing
 *   directory — an earlier run's evidence, or anything else — could lose files.
 *   The directory is created by mkdir without `recursive` (or mkdtemp), which
 *   fails if anything already exists at that path, a dangling link included.
 * - Decided once. Playwright evaluates the configuration in the runner and in
 *   each worker. The runner creates the directory and writes a one-time token
 *   into it (`wx`: exclusive). A later evaluation only VERIFIES — same
 *   canonical path, still a real directory, token present — and only in the
 *   runner or a process the runner started.
 */

export const RUN_TOKEN_FILE = '.valida-e2e-run';

export class RunDirectoryRefused extends Error {
  constructor(reason) {
    super(`E2E refused: ${reason}`);
    this.name = 'RunDirectoryRefused';
  }
}

/**
 * True when `candidate` is `directory` or inside it. A first segment that
 * merely STARTS with ".." (`..qa`) is inside; only ".." itself, or "../…",
 * leaves. Another drive (Windows) gives an absolute relative path: outside.
 * Lexical only: callers pass canonical paths.
 */
export function isInside(directory, candidate, pathApi = path) {
  const relative = pathApi.relative(directory, candidate);
  if (relative === '') return true;
  if (pathApi.isAbsolute(relative)) return false;
  return relative !== '..' && !relative.startsWith(`..${pathApi.sep}`);
}

const canonical = (target) => realpathSync.native(target);

function refuseInside(repoReal, target, what) {
  if (isInside(repoReal, target)) {
    throw new RunDirectoryRefused(`${what} resolves inside the repository (${target}). Private storage and evidence never go into the working tree; choose a directory outside it.`);
  }
}

/** Fails unless `target` is a real directory (not a link) whose canonical path is itself, outside the repository. */
function verifyCreated(repoReal, target) {
  const stat = lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new RunDirectoryRefused(`the run directory is not a plain directory (${target}).`);
  const real = canonical(target);
  if (real !== target) throw new RunDirectoryRefused(`the run directory moved after it was created (${target} now resolves to ${real}).`);
  refuseInside(repoReal, real, 'the run directory');
}

/**
 * Creates the run directory. With E2E_RUN_DIR: exactly that path, which must
 * not exist yet and whose parent must exist; without it: a new
 * `<os temp>/valida-e2e/<timestamp>-XXXXXX` (mkdtemp).
 * Returns { runDir, runId, token }; runDir is canonical.
 */
export function createRunDirectory({ env = process.env, repoRoot, tmpdir = os.tmpdir(), now = new Date() } = {}) {
  const repoReal = canonical(repoRoot);
  let runDir;

  if (env.E2E_RUN_DIR) {
    const requested = path.resolve(env.E2E_RUN_DIR);
    const name = path.basename(requested);
    if (!name || name === '.' || name === '..') throw new RunDirectoryRefused(`E2E_RUN_DIR must name a new directory (${env.E2E_RUN_DIR}).`);
    refuseInside(repoReal, requested, 'E2E_RUN_DIR');
    let parentReal;
    try {
      parentReal = canonical(path.dirname(requested));
    } catch (error) {
      throw new RunDirectoryRefused(`the parent of E2E_RUN_DIR must already exist (${path.dirname(requested)}: ${error.code ?? 'not found'}).`);
    }
    runDir = path.join(parentReal, name);
    refuseInside(repoReal, runDir, 'E2E_RUN_DIR');
    try {
      mkdirSync(runDir, { mode: 0o700 });
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw new RunDirectoryRefused(`E2E_RUN_DIR already exists (${runDir}). Each run needs a NEW directory, so nothing already there can be overwritten or cleaned; choose another name.`);
      }
      throw new RunDirectoryRefused(`E2E_RUN_DIR could not be created (${runDir}: ${error.code ?? error.message}).`);
    }
  } else {
    const tmpReal = canonical(tmpdir);
    const base = path.join(tmpReal, 'valida-e2e');
    refuseInside(repoReal, base, 'the default run location (the OS temporary directory)');
    mkdirSync(base, { recursive: true, mode: 0o700 });
    const baseReal = canonical(base);
    refuseInside(repoReal, baseReal, 'the default run location (the OS temporary directory)');
    runDir = mkdtempSync(path.join(baseReal, `${now.toISOString().replace(/[:.]/g, '-')}-`));
  }

  verifyCreated(repoReal, runDir);
  const token = `${randomBytes(16).toString('hex')}.${process.pid}`;
  writeFileSync(path.join(runDir, RUN_TOKEN_FILE), token, { flag: 'wx', mode: 0o600 });
  return { runDir, runId: path.basename(runDir), token };
}

/**
 * Verifies a directory created by createRunDirectory in this run: the same
 * canonical path, a plain directory outside the repository, holding the token,
 * and checked by the process that created it or one it started.
 */
export function verifyRunDirectory({ env = process.env, repoRoot, processRef = process } = {}) {
  const { E2E_RUN_DIR: runDir, E2E_RUN_DIR_TOKEN: token } = env;
  if (!runDir || !token) throw new RunDirectoryRefused('the run directory was not created by this run (E2E_RUN_DIR_TOKEN missing).');
  const ownerPid = Number(token.split('.').pop());
  if (processRef.pid !== ownerPid && processRef.ppid !== ownerPid) {
    throw new RunDirectoryRefused('the run directory belongs to another run (E2E_RUN_DIR_TOKEN was not issued to this process).');
  }
  const repoReal = canonical(repoRoot);
  if (!path.isAbsolute(runDir)) throw new RunDirectoryRefused(`the run directory is not an absolute path (${runDir}).`);
  verifyCreated(repoReal, runDir);
  let stored;
  try {
    stored = readFileSync(path.join(runDir, RUN_TOKEN_FILE), 'utf8');
  } catch {
    stored = null;
  }
  if (stored !== token) throw new RunDirectoryRefused(`the run directory's token does not match (${runDir}).`);
  return runDir;
}

/** The run directory's subdirectories (key -> name). */
export const RUN_SUBDIRECTORIES = Object.freeze({ logs: 'logs', smtp: 'smtp', storage: 'private-storage', output: 'output', dist: 'dist' });

/**
 * Creates the subdirectories of a verified run directory, each EXCLUSIVELY
 * (mkdir without `recursive` fails if the name exists): dist/ in particular is
 * new and empty, so the build never needs to empty it. Only output/ may exist
 * already — Playwright owns it and may have created it — and then it must be a
 * plain directory. Anything else already there is refused, untouched.
 * Returns { key: absolute path }.
 */
export function createRunSubdirectories(runDir) {
  const unexpected = readdirSync(runDir).filter((name) => name !== RUN_TOKEN_FILE && name !== RUN_SUBDIRECTORIES.output);
  if (unexpected.length) throw new RunDirectoryRefused(`the run directory is not new: it already holds ${unexpected.join(', ')} (${runDir}).`);
  const dirs = {};
  for (const [key, name] of Object.entries(RUN_SUBDIRECTORIES)) {
    const dir = path.join(runDir, name);
    if (key === 'output') {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const stat = lstatSync(dir);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new RunDirectoryRefused(`output/ is not a plain directory (${dir}).`);
    } else {
      mkdirSync(dir, { mode: 0o700 });
    }
    dirs[key] = dir;
  }
  return dirs;
}
