import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Locations and fixed settings of one E2E run.
 *
 * EVERYTHING A RUN CREATES lives OUTSIDE the repository, in one run directory
 * (default: <os temp>/valida-e2e/<run id>): the production frontend build,
 * the private resume storage, the captured messages, the backend log, the
 * screenshots and the evidence records. Nothing is written into the working
 * tree, so nothing a run produces can be committed by accident. The private
 * storage root must be outside the repository anyway: the backend refuses a
 * RESUME_STORAGE_LOCAL_ROOT inside it (backend/src/config/env.js).
 */
export const E2E_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(E2E_DIR, '..');
export const FRONTEND_DIR = path.join(REPO_ROOT, 'frontend');
export const BACKEND_DIR = path.join(REPO_ROOT, 'backend');
export const FIXTURES_DIR = path.join(E2E_DIR, 'fixtures');

/** Ports: fixed so the build can be pointed at the backend before either starts. Override when busy. */
export const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT ?? 4183);
export const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 4100);
/** 127.0.0.1, never "localhost": on Windows "localhost" may resolve to ::1 first. */
export const FRONTEND_ORIGIN = `http://127.0.0.1:${FRONTEND_PORT}`;
export const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`;

/**
 * The run directory. Decided ONCE, in the runner, when the configuration is
 * first evaluated, and handed to every worker through the environment (a
 * worker evaluates the configuration again and must find the same value).
 */
export function resolveRunDirectory() {
  if (!process.env.E2E_RUN_DIR) {
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    process.env.E2E_RUN_ID = runId;
    process.env.E2E_RUN_DIR = path.join(os.tmpdir(), 'valida-e2e', runId);
  }
  process.env.E2E_RUN_ID ??= path.basename(process.env.E2E_RUN_DIR);
  return process.env.E2E_RUN_DIR;
}

/** True when `candidate` is inside `directory` (or is it). */
export function isInside(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
