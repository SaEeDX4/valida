import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkTestDatabaseTarget, readDotEnvMongoUri } from '../scripts/test-database.mjs';
import { plainText, hasVTControlSequences, withColourMode, COLOUR_MODES } from './fixtures/terminalOutput.js';

/**
 * The destructive-test safety guard (B2 correction, finding 2) — OFFLINE.
 *
 * Proven without ever running destructive tests against a real database: the
 * decision function is exercised directly, and the three entry points that use
 * it — verify:b2, test:db and the restart-persistence child — are launched with
 * refused targets that point at 127.0.0.1:1, a port nothing listens on. Even if
 * the guard were broken, nothing could be written or dropped anywhere.
 */
const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = (env, dotEnvPath = null) => checkTestDatabaseTarget({ env, dotEnvPath });
const TEST = 'mongodb://127.0.0.1:27017/valida_test';

describe('checkTestDatabaseTarget — the reviewer example', () => {
  it('refuses APP_ENV/NODE_ENV=production with MONGODB_URI and MONGODB_TEST_URI both on valida_latest', () => {
    const result = check({
      APP_ENV: 'production',
      NODE_ENV: 'production',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/valida_latest',
      MONGODB_TEST_URI: 'mongodb://127.0.0.1:27017/valida_latest',
    });
    expect(result.ok).toBe(false);
  });

  it('refuses each of its three problems on its own', () => {
    // 1. "latest" merely contains "test"; it is not a disposable test database.
    expect(check({ MONGODB_TEST_URI: 'mongodb://127.0.0.1:27017/valida_latest' }).reason).toMatch(/explicitly disposable/);
    // 2. A production launching context.
    expect(check({ APP_ENV: 'production', MONGODB_TEST_URI: TEST }).reason).toMatch(/production/);
    expect(check({ NODE_ENV: 'production', MONGODB_TEST_URI: TEST }).reason).toMatch(/production/);
    // 3. The same database as the application.
    expect(check({ MONGODB_URI: TEST, MONGODB_TEST_URI: TEST }).reason).toMatch(/same database as MONGODB_URI/);
  });
});

describe('checkTestDatabaseTarget — database naming', () => {
  it.each(['valida_test', 'valida_test_ci', 'valida_test_saeed2', 'valida_test_run_42'])('accepts %s', (name) => {
    expect(check({ MONGODB_TEST_URI: `mongodb://127.0.0.1:27017/${name}` })).toEqual({
      ok: true, uri: `mongodb://127.0.0.1:27017/${name}`, databaseName: name,
    });
  });

  it.each([
    'valida', 'valida_dev', 'valida_production', 'valida_latest', 'valida_testing', 'test', 'test_valida',
    'contest', 'VALIDA_TEST', 'valida_test_', 'valida_test_prod', 'valida_test_main', 'valida_test_live',
    'valida_test_Staging', 'admin', 'local', 'config',
  ])('refuses %s', (name) => {
    expect(check({ MONGODB_TEST_URI: `mongodb://127.0.0.1:27017/${name}` }).ok).toBe(false);
  });

  it('refuses a URI that names no database, rather than using the driver default', () => {
    expect(check({ MONGODB_TEST_URI: 'mongodb://127.0.0.1:27017' }).reason).toMatch(/name its database explicitly/);
    expect(check({ MONGODB_TEST_URI: 'mongodb://127.0.0.1:27017/?replicaSet=rs0' }).ok).toBe(false);
  });

  it('refuses an unset or malformed MONGODB_TEST_URI', () => {
    expect(check({}).reason).toMatch(/not set/);
    expect(check({ MONGODB_TEST_URI: 'http://127.0.0.1/valida_test' }).reason).toMatch(/not a valid MongoDB/);
    expect(check({ MONGODB_TEST_URI: 'mongodb+srv://a.example,b.example/valida_test' }).ok).toBe(false);
  });

  it('accepts replica-set and SRV test targets (finding 3 parser)', () => {
    expect(check({ MONGODB_TEST_URI: 'mongodb://db1.example:27017,db2.example:27017/valida_test?replicaSet=rs0' }).ok).toBe(true);
    expect(check({ MONGODB_TEST_URI: 'mongodb+srv://cluster0.example.net/valida_test_ci?retryWrites=true' }).ok).toBe(true);
  });
});

describe('checkTestDatabaseTarget — separation from the application database', () => {
  it('refuses the application database name even on another host', () => {
    expect(check({ MONGODB_URI: 'mongodb://prod.example:27017/valida_test', MONGODB_TEST_URI: TEST }).ok).toBe(false);
  });

  it('accepts a different application database', () => {
    expect(check({ MONGODB_URI: 'mongodb://127.0.0.1:27017/valida_dev', MONGODB_TEST_URI: TEST }).ok).toBe(true);
    // No database in MONGODB_URI means the driver default "test", which differs.
    expect(check({ MONGODB_URI: 'mongodb://127.0.0.1:27017', MONGODB_TEST_URI: TEST }).ok).toBe(true);
  });

  it('refuses when the application URI cannot be parsed, because separation cannot be confirmed', () => {
    expect(check({ MONGODB_URI: 'not-a-uri', MONGODB_TEST_URI: TEST }).reason).toMatch(/cannot be confirmed/);
  });

  it('also compares with MONGODB_URI in backend/.env', () => {
    const dir = mkdtempSync(join(tmpdir(), 'valida-guard-'));
    try {
      const dotEnv = join(dir, '.env');
      writeFileSync(dotEnv, '# local\nMONGODB_URI="mongodb://127.0.0.1:27017/valida_test"\n');
      expect(check({ MONGODB_TEST_URI: TEST }, dotEnv).reason).toMatch(/backend\/\.env/);
      writeFileSync(dotEnv, 'MONGODB_URI=mongodb://127.0.0.1:27017/valida_dev\n');
      expect(check({ MONGODB_TEST_URI: TEST }, dotEnv).ok).toBe(true);
      expect(check({ MONGODB_TEST_URI: TEST }, join(dir, 'missing.env')).ok).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never quotes a connection string in a refusal', () => {
    const secret = 'mongodb://admin:s3cr3t@db.example:27017/valida_latest?appName=AKIAEXAMPLE';
    const reasons = [
      check({ MONGODB_TEST_URI: secret }).reason,
      check({ MONGODB_URI: secret.replace('valida_latest', 'valida_test'), MONGODB_TEST_URI: secret.replace('valida_latest', 'valida_test') }).reason,
      check({ APP_ENV: 'production', MONGODB_TEST_URI: secret }).reason,
    ];
    reasons.forEach((reason) =>
      [/s3cr3t/, /admin:/, /db\.example/, /AKIAEXAMPLE/, /mongodb:\/\//].forEach((pattern) =>
        expect(reason, `leaked ${pattern}`).not.toMatch(pattern),
      ),
    );
  });
});

describe('backend/.env inspection fails closed (correction cycle 2, finding 3)', () => {
  const withTempDir = (run) => {
    const dir = mkdtempSync(join(tmpdir(), 'valida-dotenv-'));
    try {
      return run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  /** A refusal names the problem only: no path, raw error code, contents or URI. */
  const leakFree = (reason, dir) => {
    expect(reason).not.toContain(dir);
    [/EISDIR|ENOTDIR|EACCES|ENOENT/, /s3cr3t/, /mongodb:\/\//].forEach((pattern) =>
      expect(reason, `leaked ${pattern}`).not.toMatch(pattern),
    );
  };

  it('accepts a genuinely missing backend/.env', () => {
    withTempDir((dir) => {
      expect(readDotEnvMongoUri(join(dir, '.env'))).toEqual({ status: 'absent' });
      expect(check({ MONGODB_TEST_URI: TEST }, join(dir, '.env')).ok).toBe(true);
    });
  });

  it("refuses when backend/.env is a directory (the reviewer's EISDIR case)", () => {
    withTempDir((dir) => {
      expect(readDotEnvMongoUri(dir)).toEqual({ status: 'unreadable' });
      const result = check({ MONGODB_TEST_URI: 'mongodb://127.0.0.1:1/valida_test' }, dir);
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/backend\/\.env could not be inspected/);
      leakFree(result.reason, dir);
    });
  });

  it('refuses when the path runs through a file (not a genuine absence)', () => {
    withTempDir((dir) => {
      const file = join(dir, 'not-a-directory');
      writeFileSync(file, 'x');
      const throughFile = join(file, '.env');
      expect(readDotEnvMongoUri(throughFile)).toEqual({ status: 'unreadable' });
      const result = check({ MONGODB_TEST_URI: TEST }, throughFile);
      expect(result.ok).toBe(false);
      leakFree(result.reason, dir);
    });
  });

  /*
   * Correction cycle 4 — Windows reports ENOENT (not Linux's ENOTDIR) for a
   * path whose parent is a regular file, so ENOENT alone must not count as a
   * missing .env. These simulate that platform answer deterministically: only
   * the stat of the TARGET path is replaced; every other path, including the
   * parent, is inspected on the real filesystem.
   */
  const enoent = () => Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
  const simulatedFileSystem = (target, failures = {}) => ({
    statSync: (path) => {
      if (path === target) throw enoent();
      if (failures[path]) throw failures[path];
      return statSync(path);
    },
    readFileSync,
  });

  it('refuses ENOENT for the file when its parent is a regular file (Windows behaviour, simulated)', () => {
    withTempDir((dir) => {
      const file = join(dir, 'not-a-directory');
      writeFileSync(file, 'MONGODB_URI=mongodb://admin:s3cr3t@127.0.0.1:27017/valida_test\n');
      const throughFile = join(file, '.env');
      const fileSystem = simulatedFileSystem(throughFile);

      expect(readDotEnvMongoUri(throughFile, fileSystem)).toEqual({ status: 'unreadable' });
      const result = checkTestDatabaseTarget({
        env: { MONGODB_TEST_URI: 'mongodb://127.0.0.1:1/valida_test' },
        dotEnvPath: throughFile,
        fileSystem,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/backend\/\.env could not be inspected/);
      leakFree(result.reason, dir);
    });
  });

  it('refuses ENOENT for the file when its parent cannot be inspected', () => {
    withTempDir((dir) => {
      const target = join(dir, '.env');
      const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      const fileSystem = simulatedFileSystem(target, { [dir]: denied });
      expect(readDotEnvMongoUri(target, fileSystem)).toEqual({ status: 'unreadable' });
      const result = checkTestDatabaseTarget({ env: { MONGODB_TEST_URI: TEST }, dotEnvPath: target, fileSystem });
      expect(result.ok).toBe(false);
      leakFree(result.reason, dir);
    });
  });

  it('refuses a .env path whose parent directory does not exist', () => {
    withTempDir((dir) => {
      const target = join(dir, 'no-such-directory', '.env');
      expect(readDotEnvMongoUri(target)).toEqual({ status: 'unreadable' });
      expect(check({ MONGODB_TEST_URI: TEST }, target).ok).toBe(false);
    });
  });

  it('still accepts ENOENT when the parent is confirmed to be a directory', () => {
    withTempDir((dir) => {
      const nested = join(dir, 'backend');
      mkdirSync(nested);
      const target = join(nested, '.env');
      // Simulated ENOENT and the real missing file agree.
      expect(readDotEnvMongoUri(target, simulatedFileSystem(target))).toEqual({ status: 'absent' });
      expect(readDotEnvMongoUri(target)).toEqual({ status: 'absent' });
      expect(check({ MONGODB_TEST_URI: TEST }, target).ok).toBe(true);
    });
  });

  it('refuses when backend/.env holds a MONGODB_URI that cannot be parsed, without quoting it', () => {
    withTempDir((dir) => {
      const dotEnv = join(dir, '.env');
      writeFileSync(dotEnv, 'MONGODB_URI=mongodb://admin:s3cr3t@host:99999/valida\n');
      const result = check({ MONGODB_TEST_URI: TEST }, dotEnv);
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/MONGODB_URI in backend\/\.env is not a valid connection string/);
      leakFree(result.reason, dir);
    });
  });

  it('reads a regular backend/.env and keeps the same-database refusal', () => {
    withTempDir((dir) => {
      const dotEnv = join(dir, '.env');
      writeFileSync(dotEnv, 'PORT=4000\nMONGODB_URI=mongodb://127.0.0.1:27017/valida_test\n');
      expect(readDotEnvMongoUri(dotEnv)).toEqual({ status: 'read', value: 'mongodb://127.0.0.1:27017/valida_test' });
      expect(check({ MONGODB_TEST_URI: TEST }, dotEnv).reason).toMatch(/same database as MONGODB_URI in backend\/\.env/);
      writeFileSync(dotEnv, 'PORT=4000\n');
      expect(readDotEnvMongoUri(dotEnv)).toEqual({ status: 'read', value: undefined });
      expect(check({ MONGODB_TEST_URI: TEST }, dotEnv).ok).toBe(true);
    });
  });
});

describe('every destructive entry point refuses before touching a database', () => {
  // The reviewer's context, pointed at a port nothing listens on.
  const UNSAFE = {
    APP_ENV: 'production',
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb://127.0.0.1:1/valida_latest',
    MONGODB_TEST_URI: 'mongodb://127.0.0.1:1/valida_latest',
    MONGODB_CONNECT_TIMEOUT_MS: '1000',
  };
  /*
   * r8: `output` is the child's text with VT control sequences removed (fixtures/terminalOutput.js) — every
   * assertion below, positive or negative, runs on it; `raw` is what the child wrote. `colour` makes the
   * child's colouring explicit ('plain' or 'coloured'); without it the child decides (Windows: coloured).
   */
  const launch = (args, extraEnv = {}, colour = null) => {
    const environment = { ...process.env, ...UNSAFE, ...extraEnv };
    const result = spawnSync(process.execPath, args, {
      cwd: backendRoot,
      env: colour ? withColourMode(environment, colour) : environment,
      encoding: 'utf8',
      timeout: 60_000,
    });
    const raw = `${result.stdout}${result.stderr}`;
    return { code: result.status, raw, output: plainText(raw) };
  };

  it('verify:b2 refuses immediately and runs nothing', () => {
    const { code, output } = launch(['scripts/verify-b2.mjs']);
    expect(code).toBe(1);
    expect(output).toMatch(/B2 VERIFICATION REFUSED/);
    expect(output).toMatch(/Nothing was run and no database was contacted/);
    expect(output).not.toMatch(/offline suite|index apply|database suite/);
  }, 60_000);

  it('verify:b2 also refuses a name that merely contains "test", outside production', () => {
    const { code, output } = launch(['scripts/verify-b2.mjs'], { APP_ENV: 'local', NODE_ENV: 'development' });
    expect(code).toBe(1);
    expect(output).toMatch(/explicitly disposable/);
  }, 60_000);

  /*
   * test:db — the test runner itself, refusing in its global setup.
   *
   * B6 r7: with vitest >= 5.0.4 and vite 8.3.5 the runner's own error printer
   * failed while printing this refusal (vite's source-map lookup received the
   * global-setup module's code as a Buffer), so the reason was replaced by
   * "Startup Error: TypeError: code.charCodeAt is not a function" — the run
   * still exited 1, but nobody could see why. A refusal is only useful if it is
   * reported, so each case also requires that the RUNNER reported the guard's
   * own error (no runner crash), and that no connection string or credential
   * appears anywhere in the output.
   */
  const CREDENTIALS = 'qa-guard-user:qa-guard-secret';
  const REFUSALS = [
    ['the launching environment declares production', {}, /\[test:db\] Refusing to run: the launching environment declares production/],
    [
      'a database name that is not explicitly disposable (credentials in the URI)',
      { APP_ENV: 'local', NODE_ENV: 'development', MONGODB_URI: 'mongodb://127.0.0.1:1/valida_app', MONGODB_TEST_URI: `mongodb://${CREDENTIALS}@127.0.0.1:1/valida` },
      /\[test:db\] Refusing to run: the MONGODB_TEST_URI database must be an explicitly disposable test/,
    ],
    [
      'the same database as the application (credentials in both URIs)',
      { APP_ENV: 'local', NODE_ENV: 'development', MONGODB_URI: `mongodb://${CREDENTIALS}@127.0.0.1:1/valida_test`, MONGODB_TEST_URI: `mongodb://${CREDENTIALS}@127.0.0.1:1/valida_test` },
      /\[test:db\] Refusing to run: MONGODB_TEST_URI names the same database as MONGODB_URI in the environment/,
    ],
    ['no test database at all', { APP_ENV: 'local', NODE_ENV: 'development', MONGODB_TEST_URI: '' }, /\[test:db\] MONGODB_TEST_URI is not set\./],
  ];
  /*
   * r8 (the first Windows run): the runner COLOURS its output there even when it is piped, and the literal
   * `Error: [test:db] ` was split by escape sequences. Every case now runs with the child's colours forced
   * ON and forced OFF, and asserts on the normalised text; the coloured run must really contain escape
   * sequences (so that form is exercised on every platform), the plain run none.
   */
  it.each(COLOUR_MODES.flatMap((colour) => REFUSALS.map(([label, extraEnv, reason]) => [label, colour, extraEnv, reason])))('test:db aborts in its global setup — %s (%s output): nonzero exit, the guard\'s own reason reported by the runner, no test file loaded, nothing disclosed', (_case, colour, extraEnv, reason) => {
    const { code, raw, output } = launch(['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.db.config.js'], extraEnv, colour);
    expect(hasVTControlSequences(raw), `${colour} output`).toBe(colour === 'coloured');
    expect(code).not.toBe(0);
    expect(output).toMatch(reason);
    // The runner reported the guard's error itself — it did not crash while reporting it.
    expect(output).toMatch(/Error: \[test:db\] /);
    expect(output).not.toMatch(/Startup Error|charCodeAt|is not a function/);
    // No database test file was collected or run.
    expect(output).not.toMatch(/database\.test\.js|index-commands|restart-persistence|server-lifecycle|b6-notifications|b5-apply/);
    // Sanitised: no connection string, user name or password.
    expect(output).not.toMatch(/mongodb:\/\/|qa-guard-user|qa-guard-secret|127\.0\.0\.1:1\b/);
  }, 60_000);

  it('the restart-persistence child refuses and exits 2 without connecting', () => {
    const { code, output } = launch(['tests/db/fixtures/persistence-child.mjs', 'write', 'guardcheck']);
    expect(code).toBe(2);
    expect(output).toMatch(/persistence-child refused: Refusing to run/);
    expect(output).not.toMatch(/write failed/);
  }, 60_000);

  it('the restart-persistence child ignores an application MONGODB_URI and refuses without a test target', () => {
    const { code, output } = launch(['tests/db/fixtures/persistence-child.mjs', 'write', 'guardcheck'], {
      APP_ENV: 'local', NODE_ENV: 'development', MONGODB_TEST_URI: '',
    });
    expect(code).toBe(2);
    expect(output).toMatch(/MONGODB_TEST_URI is not set/);
  }, 60_000);
});

describe('r8 — terminal output is normalised before it is judged (fixtures/terminalOutput.js)', () => {
  // The form the runner writes when its colours are on (here with FORCE_COLOR; on Windows by default): "Error" wrapped in SGR codes.
  const coloured = '\u001b[31m\u001b[1mError\u001b[22m: [test:db] Refusing to run: the launching environment declares production\u001b[39m';

  it('the coloured refusal does not match literally, and does once the escape sequences are removed', () => {
    expect(coloured).not.toMatch(/Error: \[test:db\] /);
    expect(plainText(coloured)).toMatch(/^Error: \[test:db\] Refusing to run: the launching environment declares production$/);
    expect(hasVTControlSequences(coloured)).toBe(true);
    expect(hasVTControlSequences(plainText(coloured))).toBe(false);
  });

  it('a disclosure split by escape sequences passes a "must not contain" check on the raw text, and is caught on the normalised text', () => {
    const leaked = 'connecting to mongo\u001b[1mdb://qa-guard-user:\u001b[22mqa-guard-secret@127.0.0.1:1/valida';
    expect(leaked).not.toMatch(/mongodb:\/\/|qa-guard-user:qa-guard-secret/); // the raw check would be fooled …
    expect(plainText(leaked)).toMatch(/mongodb:\/\//); // … the normalised one is not
    expect(plainText(leaked)).toMatch(/qa-guard-user:qa-guard-secret/);
  });

  it('withColourMode makes the colouring explicit and never leaves both switches set', () => {
    const base = { KEEP: 'x', NO_COLOR: '1', FORCE_COLOR: '0' };
    expect(withColourMode(base, 'plain')).toEqual({ KEEP: 'x', NO_COLOR: '1' });
    expect(withColourMode(base, 'coloured')).toEqual({ KEEP: 'x', FORCE_COLOR: '1' });
    expect(() => withColourMode(base, 'auto')).toThrow(TypeError);
  });
});
