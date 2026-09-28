import { readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { parseMongoUri } from '../src/db/connectionString.js';

/**
 * Safety guard for everything that WRITES TO, DELETES FROM or DROPS INDEXES IN
 * a database during verification: `npm run verify:b2`, `npm run test:db` (its
 * global setup and every test file) and the restart-persistence child process.
 *
 * It FAILS CLOSED. A target is accepted only when every rule below holds, and
 * it is judged on the ORIGINATING environment — the one the command was
 * launched with — before any child process is given an overridden
 * MONGODB_URI. The rules:
 *
 *   1. MONGODB_TEST_URI is set and is a valid MongoDB connection string
 *      (parsed by the driver-aware parser used by runtime configuration, so
 *      replica-set and SRV forms work);
 *   2. it names its database explicitly (no silent fallback to "test");
 *   3. the database name is explicitly disposable: exactly `valida_test`, or
 *      `valida_test_` followed by lowercase letters/digits/underscores (for
 *      example `valida_test_ci`). A name that merely CONTAINS "test" — such as
 *      `valida_latest` — is refused;
 *   4. no segment of the name marks it as production (`prod`, `production`,
 *      `live`, `staging`, `main`);
 *   5. the originating environment does not declare production
 *      (APP_ENV=production or NODE_ENV=production);
 *   6. it is not the application's own database: its name differs from the
 *      database named by MONGODB_URI in the environment AND in backend/.env
 *      (a missing database name there means the driver default, "test"). If
 *      either of those values cannot be parsed — or backend/.env exists but
 *      cannot be read as a file — the separation cannot be confirmed and the
 *      target is refused. Only a genuinely MISSING backend/.env — ENOENT for
 *      the file AND its containing directory confirmed to exist as a directory
 *      — counts as "no application database configured there".
 *
 * Refusal messages never include a connection string: it may carry
 * credentials.
 */

export const TEST_DATABASE_NAME_PATTERN = /^valida_test(?:_[a-z0-9]+)*$/;
const PRODUCTION_NAME_SEGMENTS = new Set(['prod', 'production', 'live', 'staging', 'main']);
const DEFAULT_DOT_ENV = fileURLToPath(new URL('../.env', import.meta.url));

const REAL_FILE_SYSTEM = Object.freeze({ statSync, readFileSync });

/** True only when the path's containing directory can be confirmed to be a directory. */
function containingDirectoryExists(path, stat) {
  try {
    return stat(dirname(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Reads MONGODB_URI from a .env file, failing closed.
 *
 * @param {string | null | undefined} path
 * @param {{ statSync: Function, readFileSync: Function }} [fileSystem] the real
 *   node:fs functions; tests substitute them only to simulate platform
 *   behaviour deterministically.
 * @returns {{ status: 'absent' }                    — a genuinely missing file: ENOENT, and its
 *                                                     containing directory exists as a directory
 *         | { status: 'read', value?: string }      — a regular file that was read and parsed
 *         | { status: 'unreadable' }}               — anything else: a directory, a path through a
 *                                                     non-directory, a missing or unverifiable parent,
 *                                                     a permission error, an I/O error, content that
 *                                                     cannot be parsed
 * Never returns or reports the file's contents or the raw filesystem error.
 */
export function readDotEnvMongoUri(path, fileSystem = REAL_FILE_SYSTEM) {
  if (!path) return { status: 'absent' };
  let stats;
  try {
    stats = fileSystem.statSync(path);
  } catch (error) {
    if (error?.code !== 'ENOENT') return { status: 'unreadable' };
    /*
     * ENOENT alone does not prove the file is simply absent. On Windows a path
     * whose parent is a regular file ("C:\app\notes.txt\.env") also reports
     * ENOENT, where Linux reports ENOTDIR. Absence is accepted only once the
     * containing directory is positively confirmed to be a directory; a
     * non-directory, missing or uninspectable parent fails closed.
     */
    return containingDirectoryExists(path, fileSystem.statSync) ? { status: 'absent' } : { status: 'unreadable' };
  }
  if (!stats.isFile()) return { status: 'unreadable' };
  try {
    return { status: 'read', value: parseEnv(fileSystem.readFileSync(path, 'utf8')).MONGODB_URI };
  } catch {
    // The file existed a moment ago (stat succeeded), so even ENOENT here is a
    // race or an I/O problem, not a confirmed absence.
    return { status: 'unreadable' };
  }
}

/**
 * @param {{ env?: Record<string, string | undefined>, dotEnvPath?: string | null, fileSystem?: object }} context
 *   env — the ORIGINATING environment; dotEnvPath — the backend .env to compare
 *   against (null to skip, for isolated unit tests); fileSystem — see
 *   readDotEnvMongoUri (tests only).
 * @returns {{ ok: true, uri: string, databaseName: string } | { ok: false, reason: string }}
 */
export function checkTestDatabaseTarget({
  env = process.env,
  dotEnvPath = DEFAULT_DOT_ENV,
  fileSystem = REAL_FILE_SYSTEM,
} = {}) {
  const refuse = (reason) => ({ ok: false, reason });
  const uri = env.MONGODB_TEST_URI;

  if (!uri) return refuse('MONGODB_TEST_URI is not set.');

  if (env.APP_ENV === 'production' || env.NODE_ENV === 'production') {
    return refuse(
      'Refusing to run: the launching environment declares production (APP_ENV or NODE_ENV is ' +
        '"production"). Destructive database checks never run from a production context.',
    );
  }

  const target = parseMongoUri(uri);
  if (!target.valid) return refuse('MONGODB_TEST_URI is not a valid MongoDB connection string.');
  if (!target.databaseName) {
    return refuse('MONGODB_TEST_URI must name its database explicitly, for example /valida_test.');
  }

  const name = target.databaseName;
  if (!TEST_DATABASE_NAME_PATTERN.test(name)) {
    return refuse(
      'Refusing to run: the MONGODB_TEST_URI database must be an explicitly disposable test ' +
        'database named "valida_test" or "valida_test_<suffix>" (lowercase letters, digits, ' +
        'underscores). The database checks delete records and drop indexes.',
    );
  }
  if (name.split('_').some((segment) => PRODUCTION_NAME_SEGMENTS.has(segment))) {
    return refuse('Refusing to run: the MONGODB_TEST_URI database name marks it as production.');
  }

  const dotEnv = readDotEnvMongoUri(dotEnvPath, fileSystem);
  if (dotEnv.status === 'unreadable') {
    return refuse(
      'Refusing to run: backend/.env could not be inspected — it is neither a readable file nor ' +
        'confirmed missing from an existing directory — so the test database cannot be confirmed ' +
        'to be separate from the application database.',
    );
  }

  const applicationTargets = [
    ['MONGODB_URI in the environment', env.MONGODB_URI],
    ['MONGODB_URI in backend/.env', dotEnv.value],
  ];
  for (const [source, value] of applicationTargets) {
    if (value === undefined || value === '') continue;
    const application = parseMongoUri(value);
    if (!application.valid) {
      return refuse(
        `Refusing to run: ${source} is not a valid connection string, so the test database ` +
          'cannot be confirmed to be separate from the application database.',
      );
    }
    if ((application.databaseName ?? 'test') === name) {
      return refuse(
        `Refusing to run: MONGODB_TEST_URI names the same database as ${source}. ` +
          'The test database must be separate from the application database.',
      );
    }
  }

  return { ok: true, uri, databaseName: name };
}
