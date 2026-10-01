import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import {
  startServer, isMainModule, formatStartupFailure, installSignalHandlers, settleWithin,
} from '../src/server.js';
import { createApp } from '../src/app.js';
import { ConfigurationError } from '../src/config/env.js';
import { DatabaseConnectionError } from '../src/db/mongoose.js';
import {
  freePort, testConfig, silentLogger, capturingLogger, fakeMongoose, offlineDatabase, OFFLINE_TEST_MONGODB_URI,
} from './helpers.js';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Startup, listening and graceful shutdown — Doc 09 section 8, Doc 15.
 *
 * startServer returns handles instead of calling process.exit, so a real
 * server can be started and stopped inside the test runner without killing it.
 * Signal wiring lives in installSignalHandlers and is deliberately not invoked
 * here — registering global SIGINT handlers from a test would be unsafe.
 *
 * DATABASE (from B2). startServer connects to MongoDB before it listens. These
 * offline tests inject `offlineDatabase()`, which runs the REAL connect and
 * disconnect code against an in-memory stand-in for the Mongoose module, so
 * the startup, readiness and shutdown wiring is exercised without a server.
 * The same lifecycle against a real MongoDB — including `npm start` actually
 * listening — is proven in tests/db/server-lifecycle.test.js.
 */
const started = [];

async function start(overrides = {}, database = offlineDatabase()) {
  const port = await freePort();
  const handle = await startServer({
    env: {
      NODE_ENV: 'test',
      APP_ENV: 'local',
      PORT: String(port),
      LOG_LEVEL: 'silent',
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
      MONGODB_URI: OFFLINE_TEST_MONGODB_URI,
      ...overrides,
    },
    database,
  });
  started.push(handle);
  return { ...handle, port, database };
}

const stateOf = (readiness, name) => readiness.describe().dependencies.find((d) => d.name === name).state;

afterEach(async () => {
  while (started.length) {
    const handle = started.pop();
    await handle.shutdown('test cleanup');
  }
});

describe('app factory', () => {
  it('builds an app without opening a socket', () => {
    // From B2 configuration must name a database, so the factory is given the
    // test configuration rather than reading process.env.
    const app = createApp({ config: testConfig(), logger: silentLogger() });
    expect(typeof app).toBe('function');
    // An Express app is a request handler, not a server: no listening side effect.
    expect(app.listen).toBeTypeOf('function');
    expect(app.address).toBeUndefined();
  });

  it('opens no database connection when the app is built', () => {
    createApp({ config: testConfig(), logger: silentLogger() });
    // 0 = disconnected. Connecting is the server bootstrap's job, never app.js's.
    expect(mongoose.connection.readyState).toBe(0);
  });
});

describe('startServer', () => {
  it('listens and serves health on the configured port', async () => {
    const { server, port } = await start();
    expect(server.listening).toBe(true);
    expect(server.address().port).toBe(port);

    const response = await request(`http://127.0.0.1:${port}`).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ok');
  });

  it('marks configuration and database ready, unconfigured storage unavailable and B6 not implemented', async () => {
    const { readiness, database } = await start();
    expect(database.instance.connectCalls).toBe(1);
    expect(stateOf(readiness, 'configuration')).toBe('ready');
    // Set by the real connectDatabase from the connection's 'connected' event.
    expect(stateOf(readiness, 'database')).toBe('ready');
    // B4 CHANGE: resume storage now exists. This server was started without
    // storage configuration, so it is reported unavailable — not ready, and no
    // longer "not implemented" (tests/b4-startup.test.js covers the
    // configured and deployed cases).
    expect(stateOf(readiness, 'resumeStorage')).toBe('unavailable');
    expect(stateOf(readiness, 'notifications')).toBe('not_implemented');
    expect(readiness.isReady()).toBe(false);
  });

  it('connects with implicit index building and collection creation disabled', async () => {
    const { database } = await start();
    expect(database.instance.lastConnectOptions).toMatchObject({ autoIndex: false, autoCreate: false });
  });

  it('serves the canonical 503 readiness while storage is unconfigured and B6 is unimplemented', async () => {
    const { port } = await start();
    const response = await request(`http://127.0.0.1:${port}`).get('/api/v1/health/ready');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(response.body.error.message).toBe('Service is not ready.');
  });

  it('reports not ready again when the database connection is lost', async () => {
    const { port, readiness, database } = await start();
    database.instance.connection.readyState = 0;
    database.instance.connection.emit('disconnected');
    expect(stateOf(readiness, 'database')).toBe('unavailable');
    const response = await request(`http://127.0.0.1:${port}`).get('/api/v1/health/ready');
    expect(response.status).toBe(503);
  });

  it('uses the real MongoDB connector when none is injected', async () => {
    // No `database` argument: exactly what `npm start` does. Against a port
    // nothing listens on, the real driver fails and startup is refused — a
    // stand-in that pretended to connect would have resolved instead.
    const port = await freePort();
    await expect(
      startServer({
        env: {
          APP_ENV: 'local',
          LOG_LEVEL: 'silent',
          PORT: String(port),
          MONGODB_URI: 'mongodb://127.0.0.1:1/valida_test',
          MONGODB_CONNECT_TIMEOUT_MS: '1000',
        },
      }),
    ).rejects.toBeInstanceOf(DatabaseConnectionError);
    expect(mongoose.connection.readyState).toBe(0);
  }, 15_000);

  it('refuses to start without MONGODB_URI, before any connection attempt', async () => {
    const database = offlineDatabase();
    await expect(
      startServer({ env: { APP_ENV: 'local', LOG_LEVEL: 'silent' }, database }),
    ).rejects.toThrow(/MONGODB_URI: is required/);
    expect(database.instance.connectCalls).toBe(0);
  });

  it('refuses to start, and never listens, when the database is unreachable', async () => {
    const port = await freePort();
    const database = offlineDatabase(fakeMongoose({ failConnect: true }));
    await expect(
      startServer({
        env: { APP_ENV: 'local', LOG_LEVEL: 'silent', PORT: String(port), MONGODB_URI: OFFLINE_TEST_MONGODB_URI },
        database,
      }),
    ).rejects.toBeInstanceOf(DatabaseConnectionError);

    // The port is still free: nothing was bound.
    const { createServer } = await import('node:net');
    const probe = createServer();
    await new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(port, resolve);
    });
    await new Promise((resolve) => probe.close(resolve));
  });

  it('refuses to start on invalid configuration', async () => {
    await expect(
      startServer({ env: { APP_ENV: 'production', NODE_ENV: 'production' } }),
    ).rejects.toThrow(/CORS_ALLOWED_ORIGINS: is required when APP_ENV=production/);
  });

  it('rejects rather than leaving a half-started process when the port is taken', async () => {
    const { port } = await start();
    const second = offlineDatabase();
    await expect(start({ PORT: String(port) }, second)).rejects.toMatchObject({ code: 'EADDRINUSE' });
    // The failed attempt never reached `started`, and it closed the database
    // connection it had already opened instead of leaving it dangling.
    expect(second.instance.connection.closeCalls).toBe(1);
    expect(second.instance.connection.readyState).toBe(0);
  });
});

describe('graceful shutdown', () => {
  it('marks readiness unavailable before closing', async () => {
    const { readiness, shutdown } = await start();
    expect(readiness.isShuttingDown).toBe(false);

    const shutdownPromise = shutdown('SIGTERM');
    // Readiness flips first, so a load balancer stops sending new work before
    // the socket goes away.
    expect(readiness.isShuttingDown).toBe(true);
    expect(readiness.isReady()).toBe(false);

    await shutdownPromise;
    started.pop();
  });

  it('closes the HTTP server', async () => {
    const { server, shutdown } = await start();
    expect(server.listening).toBe(true);
    await shutdown('SIGTERM');
    expect(server.listening).toBe(false);
    started.pop();
  });

  it('stops answering after shutdown', async () => {
    const { port, shutdown } = await start();
    await shutdown('SIGTERM');
    started.pop();
    await expect(request(`http://127.0.0.1:${port}`).get('/api/v1/health')).rejects.toThrow();
  });

  it('is idempotent', async () => {
    const { shutdown } = await start();
    await shutdown('first');
    await expect(shutdown('second')).resolves.toBeUndefined();
    started.pop();
  });

  it('closes the database connection after the HTTP server', async () => {
    const { server, readiness, database, shutdown } = await start();
    await shutdown('SIGTERM');
    started.pop();
    expect(server.listening).toBe(false);
    expect(database.instance.connection.closeCalls).toBe(1);
    expect(stateOf(readiness, 'database')).toBe('unavailable');
  });

  it('keeps shutdown hooks per server instance', async () => {
    // Two servers in one process: shutting one down must close only its own
    // database connection. A shared, module-level hook list would not.
    const first = await start();
    const second = await start();
    await first.shutdown('SIGTERM');
    expect(first.database.instance.connection.closeCalls).toBe(1);
    expect(second.database.instance.connection.closeCalls).toBe(0);
    expect(stateOf(second.readiness, 'database')).toBe('ready');
  });

  it('does not terminate the test process', async () => {
    // startServer must never call process.exit: that is the caller's decision,
    // wired only in installSignalHandlers for a real process.
    const { shutdown } = await start();
    await shutdown('SIGTERM');
    started.pop();
    expect(process.exitCode).toBeUndefined();
  });
});


describe('direct-run detection', () => {
  /*
   * The entry-point check compares a FILE URL with a FILESYSTEM PATH, so the
   * conversion has to be platform-correct. The previous `file://${argv[1]}`
   * template happened to match on POSIX but never on Windows, where argv[1] is
   * C:\\...\\server.js: the naive form yields "file://C:\\..." against a real
   * URL of "file:///C:/.../server.js". `npm start` therefore started nothing.
   */
  const serverPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.js');
  const serverUrl = pathToFileURL(serverPath).href;

  it('recognises the module when it is the entry point', () => {
    expect(isMainModule(serverUrl, serverPath)).toBe(true);
  });

  it('does not recognise a different entry point', () => {
    expect(isMainModule(serverUrl, join(dirname(serverPath), 'app.js'))).toBe(false);
  });

  it('returns false when there is no entry path, as when imported', () => {
    expect(isMainModule(serverUrl, undefined)).toBe(false);
    expect(isMainModule(serverUrl, '')).toBe(false);
  });

  it('handles an entry path containing characters that need encoding', () => {
    // A checkout under "C:\\My Projects\\..." or "/home/a b/" must still match.
    const spaced = join(dirname(serverPath), 'a b', 'server.js');
    expect(isMainModule(pathToFileURL(spaced).href, spaced)).toBe(true);
    // The naive template would not have matched this.
    expect(pathToFileURL(spaced).href).not.toBe(`file://${spaced}`);
  });

  it('is not fooled by a path that merely looks similar', () => {
    expect(isMainModule(serverUrl, `${serverPath}.bak`)).toBe(false);
  });
});

describe('running the module directly', () => {
  /** Runs a command and resolves with its combined output once it exits. */
  const run = (args, env, killAfterMs = 1500) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, args, {
        cwd: join(dirname(fileURLToPath(import.meta.url)), '..'),
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      // Give it time to bind, then stop it.
      const timer = setTimeout(() => child.kill('SIGTERM'), killAfterMs);
      child.on('exit', () => {
        clearTimeout(timer);
        resolve(output);
      });
    });

  /*
   * B1 proved `npm start` starts by waiting for "backend listening". From B2 the
   * server connects to MongoDB before it listens, so that exact proof needs a
   * real database and now lives in tests/db/server-lifecycle.test.js.
   *
   * Offline, the regression that matters is still provable: executed directly,
   * the module RUNS its startup (here it reaches the database step, which fails
   * against a port nothing listens on), whereas merely importing it runs
   * nothing at all. The Windows bug was a script that silently did nothing.
   */
  const UNREACHABLE_DATABASE = {
    MONGODB_URI: 'mongodb://127.0.0.1:1/valida_test',
    MONGODB_CONNECT_TIMEOUT_MS: '1000',
  };

  it('runs startup when executed as a script', async () => {
    const port = await freePort();
    const output = await run(['src/server.js'], {
      PORT: String(port),
      LOG_LEVEL: 'info',
      APP_ENV: 'local',
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
      ...UNREACHABLE_DATABASE,
    }, 10_000); // exits by itself after the 1 s connect timeout; the long kill timer only guards a hang
    // Startup ran: configuration passed and the database step was attempted.
    expect(output).toMatch(/database connection failed/);
    expect(output).toMatch(/failed to start: the database connection could not be established/);
    // And it did not listen without its database.
    expect(output).not.toMatch(/backend listening/);
  }, 15_000);

  it('starts nothing when the module is merely imported', async () => {
    const output = await run(['--input-type=module', '-e', "await import('./src/server.js');"], {
      PORT: '4999',
      APP_ENV: 'local',
      LOG_LEVEL: 'info',
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
      ...UNREACHABLE_DATABASE,
    });
    // Not merely "did not listen": no startup step ran at all.
    expect(output).not.toMatch(/backend listening|database connection|failed to start/);
  }, 15_000);
});


describe('startup failure output never leaks values (correction cycle 2, finding 2)', () => {
  const SECRET = 'https://user:s3cr3t@example.com/path?token=AKIAEXAMPLE';

  /** Runs the server as a real process and returns its combined output. */
  const runToExit = (env) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, ['src/server.js'], {
        cwd: join(dirname(fileURLToPath(import.meta.url)), '..'),
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      // Every case here exits by itself; this only guards against a hang
      // (Node start-up plus a 1 s database timeout can be slow on Windows).
      const timer = setTimeout(() => child.kill('SIGTERM'), 10_000);
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ output, code });
      });
    });

  it('prints the variable and rule but never the rejected value', async () => {
    const { output, code } = await runToExit({
      APP_ENV: 'production',
      NODE_ENV: 'production',
      PORT: '4318',
      CORS_ALLOWED_ORIGINS: SECRET,
      // Valid, so CORS is the only configuration failure.
      MONGODB_URI: OFFLINE_TEST_MONGODB_URI,
    });

    expect(code).toBe(1);
    // Useful: which variable, and what the rule is.
    expect(output).toMatch(/CORS_ALLOWED_ORIGINS/);
    expect(output).toMatch(/canonical origin/);
    // Never the value.
    [/s3cr3t/, /AKIAEXAMPLE/, /user:/, /token=/, /example\.com/].forEach((pattern) =>
      expect(output, `leaked ${pattern}`).not.toMatch(pattern),
    );
  }, 20_000);

  it('never prints the connection string, credentials or driver text when the database is unreachable', async () => {
    // A secret-bearing URI pointing at a port nothing listens on, so the
    // driver produces a genuine connection error quoting the host.
    const secretUri = 'mongodb://admin:s3cr3t@127.0.0.1:1/valida_test?appName=AKIAEXAMPLE';
    const { output, code } = await runToExit({
      APP_ENV: 'local',
      PORT: String(await freePort()),
      LOG_LEVEL: 'info',
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
      MONGODB_URI: secretUri,
      MONGODB_CONNECT_TIMEOUT_MS: '1000',
    });

    expect(code).toBe(1);
    // A bounded message an operator can act on.
    expect(output).toMatch(/failed to start: the database connection could not be established/);
    expect(output).toMatch(/MONGODB_URI/);
    expect(output).toMatch(/Detail is withheld/);
    // Nothing from the URI or the driver, on stderr or in the JSON log lines.
    [/s3cr3t/, /admin:/, /AKIAEXAMPLE/, /appName/, /127\.0\.0\.1:1\b/, /ECONNREFUSED/, /mongodb:\/\//,
      /at [A-Za-z]+ \(/, /node_modules|\/tmp\/|src\/server\.js:/,
    ].forEach((pattern) => expect(output, `leaked ${pattern}`).not.toMatch(pattern));
  }, 20_000);
});

describe('startup failure text (formatStartupFailure)', () => {
  /*
   * The exact line printed by the direct-run catch block. B1 checked the
   * non-configuration branch by occupying a port and spawning the server; from
   * B2 the process reaches listen only with a database, so that spawn test now
   * runs in tests/db/server-lifecycle.test.js and the wording is pinned here.
   */
  it('prints only a bounded classification for a port already in use', () => {
    const error = new Error('listen EADDRINUSE: address already in use :::4318');
    error.code = 'EADDRINUSE';
    const text = formatStartupFailure(error);
    expect(text).toBe(
      '[valida-backend] failed to start: Error (EADDRINUSE). ' +
        'Detail is withheld because it may contain configuration values or credentials.',
    );
    expect(text).not.toMatch(/address already in use|4318/);
  });

  it('never trusts a hostile error name, code, message or stack', () => {
    const error = new Error('mongodb+srv://admin:s3cr3t@cluster0.example.net');
    error.name = 'mongodb+srv://admin:s3cr3t@cluster0.example.net';
    error.code = 'AKIAEXAMPLE';
    const text = formatStartupFailure(error);
    expect(text).toMatch(/failed to start: Error\. Detail is withheld/);
    [/s3cr3t/, /admin:/, /cluster0/, /AKIAEXAMPLE/, /at [A-Za-z]+ \(/].forEach((pattern) =>
      expect(text, `leaked ${pattern}`).not.toMatch(pattern),
    );
  });

  it('prints a configuration error in full, because it is value-free by construction', () => {
    const error = new ConfigurationError([{ variable: 'MONGODB_URI', rule: 'is required' }]);
    expect(formatStartupFailure(error)).toBe(
      '[valida-backend] failed to start:\nInvalid backend configuration:\n  - MONGODB_URI: is required',
    );
  });

  it('prints fixed text for a database connection failure', () => {
    expect(formatStartupFailure(new DatabaseConnectionError())).toBe(
      '[valida-backend] failed to start: the database connection could not be established. ' +
        'Check that MONGODB_URI names a reachable MongoDB server. ' +
        'Detail is withheld because it may contain configuration values or credentials.',
    );
  });
});

/* -------------------------------------------------------------------------
 * Correction cycle 1, finding 4 — the WHOLE shutdown sequence is bounded,
 * including dependency cleanup and cleanup after a failed start, and a
 * cleanup that fails or times out is reported as such.
 * ---------------------------------------------------------------------- */
describe('bounded shutdown and cleanup', () => {
  const SECRET_MESSAGE = 'close failed for mongodb+srv://admin:s3cr3t@cluster0.example.net/valida';

  /** A connector that really connects (to the stand-in) but whose close misbehaves. */
  const misbehavingDatabase = (disconnect) => {
    const base = offlineDatabase();
    return { ...base, disconnect };
  };
  const hangingDatabase = () => misbehavingDatabase(() => new Promise(() => {}));
  const rejectingDatabase = () => misbehavingDatabase(async () => { throw new Error(SECRET_MESSAGE); });

  async function startWith(database, extra = {}) {
    const port = await freePort();
    const { logger, output } = capturingLogger();
    const handle = await startServer({
      env: { APP_ENV: 'local', LOG_LEVEL: 'info', PORT: String(port), MONGODB_URI: OFFLINE_TEST_MONGODB_URI },
      database,
      logger,
      ...extra,
    });
    return { ...handle, port, output };
  }

  /** Resolves with the value, or with 'STILL_PENDING' once `ms` elapse. */
  const within = (promise, ms) =>
    Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('STILL_PENDING'), ms))]);

  it('reports a clean outcome for a normal shutdown', async () => {
    const { shutdown } = await startWith(offlineDatabase());
    const outcome = await shutdown('SIGTERM');
    expect(outcome).toEqual({
      reason: 'SIGTERM',
      clean: true,
      http: 'closed',
      dependencies: { closed: ['mongodb'], failed: [], timedOut: [] },
    });
  });

  it("does not hang when disconnect() never resolves (the reviewer's reproduction)", async () => {
    const { shutdown, server, output } = await startWith(hangingDatabase());
    const outcome = await within(shutdown('SIGTERM', { timeoutMs: 25 }), 250);
    expect(outcome).not.toBe('STILL_PENDING');
    expect(outcome.clean).toBe(false);
    expect(outcome.dependencies.timedOut).toEqual(['mongodb']);
    expect(server.listening).toBe(false);
    expect(output()).toMatch(/dependency close timed out/);
    expect(output()).toMatch(/shutdown finished with incomplete cleanup/);
    expect(output()).not.toMatch(/"msg":"shutdown complete"/);
  });

  it('reports a rejected disconnect as a failure, with a classified error only', async () => {
    const { shutdown, output } = await startWith(rejectingDatabase());
    const outcome = await shutdown('SIGTERM', { timeoutMs: 1000 });
    expect(outcome.clean).toBe(false);
    expect(outcome.dependencies.failed).toEqual(['mongodb']);
    expect(output()).toMatch(/dependency failed to close/);
    expect(output()).toMatch(/"type":"Error"/);
    [/s3cr3t/, /admin:/, /cluster0/, /mongodb\+srv/].forEach((pattern) =>
      expect(output(), `leaked ${pattern}`).not.toMatch(pattern),
    );
  });

  it('bounds the HTTP phase too, closing a connection that never finishes its request', async () => {
    const { shutdown, port, server } = await startWith(offlineDatabase());
    const { connect } = await import('node:net');
    const socket = connect(port, '127.0.0.1');
    await new Promise((resolve) => socket.once('connect', resolve));
    // Headers never terminated: the connection is busy, not idle.
    socket.write('GET /api/v1/health HTTP/1.1\r\nHost: localhost\r\n');
    socket.on('error', () => {});
    await new Promise((resolve) => setTimeout(resolve, 50));

    const outcome = await within(shutdown('SIGTERM', { timeoutMs: 50 }), 1000);
    expect(outcome).not.toBe('STILL_PENDING');
    expect(outcome.http).toBe('timed_out');
    expect(outcome.clean).toBe(false);
    // Dependencies are still closed after the HTTP phase gave up.
    expect(outcome.dependencies.closed).toEqual(['mongodb']);
    expect(server.listening).toBe(false);
    socket.destroy();
  });

  it('bounds cleanup after a failed start when disconnect() never resolves', async () => {
    const first = await start();
    const { logger, output } = capturingLogger();
    const attempt = startServer({
      env: { APP_ENV: 'local', LOG_LEVEL: 'info', PORT: String(first.port), MONGODB_URI: OFFLINE_TEST_MONGODB_URI },
      database: hangingDatabase(),
      logger,
      cleanupTimeoutMs: 50,
    }).catch((error) => error);
    const result = await within(attempt, 1000);
    expect(result).not.toBe('STILL_PENDING');
    // The ORIGINAL startup failure is reported, not the cleanup problem.
    expect(result.code).toBe('EADDRINUSE');
    expect(output()).toMatch(/dependency close timed out/);
  });

  it('reports a rejected cleanup after a failed start without masking the startup error', async () => {
    const first = await start();
    const { logger, output } = capturingLogger();
    const error = await startServer({
      env: { APP_ENV: 'local', LOG_LEVEL: 'info', PORT: String(first.port), MONGODB_URI: OFFLINE_TEST_MONGODB_URI },
      database: rejectingDatabase(),
      logger,
    }).catch((caught) => caught);
    expect(error.code).toBe('EADDRINUSE');
    expect(output()).toMatch(/dependency failed to close/);
    expect(output()).not.toMatch(/s3cr3t|cluster0/);
  });
});

describe('signal handling exit codes (finding 4)', () => {
  const fakeProcess = () => {
    const handlers = {};
    return {
      handlers,
      exits: [],
      on(signal, handler) { handlers[signal] = handler; },
      exit(code) { this.exits.push(code); },
    };
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

  it('exits 0 only after a clean shutdown', async () => {
    const processRef = fakeProcess();
    installSignalHandlers({ shutdown: async () => ({ clean: true }), logger: silentLogger() }, { processRef });
    processRef.handlers.SIGTERM();
    await settle();
    expect(processRef.exits).toEqual([0]);
  });

  it('exits 1 when cleanup failed or timed out', async () => {
    const processRef = fakeProcess();
    installSignalHandlers({ shutdown: async () => ({ clean: false }), logger: silentLogger() }, { processRef });
    processRef.handlers.SIGINT();
    await settle();
    expect(processRef.exits).toEqual([1]);
  });

  it('exits 1 at once on a second signal while shutdown is still running', async () => {
    const processRef = fakeProcess();
    installSignalHandlers({ shutdown: () => new Promise(() => {}), logger: silentLogger() }, { processRef });
    processRef.handlers.SIGTERM();
    processRef.handlers.SIGINT();
    await settle();
    expect(processRef.exits).toEqual([1]);
  });

  it('exits 1 when shutdown itself throws', async () => {
    const processRef = fakeProcess();
    installSignalHandlers({ shutdown: async () => { throw new Error('boom'); }, logger: silentLogger() }, { processRef });
    processRef.handlers.SIGTERM();
    await settle();
    expect(processRef.exits).toEqual([1]);
  });
});

describe('settleWithin', () => {
  it('settles as closed, failed or timed out — and never rejects', async () => {
    await expect(settleWithin(async () => {}, 100)).resolves.toEqual({ status: 'closed' });
    const failed = await settleWithin(() => { throw new Error('sync throw'); }, 100);
    expect(failed.status).toBe('failed');
    await expect(settleWithin(() => new Promise(() => {}), 20)).resolves.toEqual({ status: 'timed_out' });
  });
});

/* -------------------------------------------------------------------------
 * Correction cycle 2, finding 2 — the cleanup deadline must keep a REAL
 * process alive until the outcome is reported. Vitest's own handles would mask
 * an unref'ed timer, so these run the real server code in a child Node
 * process that holds no handles of its own (tests/fixtures/shutdown-child.mjs).
 * ---------------------------------------------------------------------- */
describe('bounded cleanup in a real child process', () => {
  const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

  function runChild(scenario, port) {
    const started = Date.now();
    return new Promise((resolve) => {
      const child = spawn(process.execPath, ['tests/fixtures/shutdown-child.mjs', scenario, String(port)], {
        cwd: backendRoot,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      // Guards only against a hang; every scenario exits on its own.
      const guard = setTimeout(() => child.kill('SIGKILL'), 20_000);
      child.on('exit', (code, signal) => {
        clearTimeout(guard);
        resolve({ code, signal, output, elapsedMs: Date.now() - started });
      });
    });
  }

  async function withBusyPort(run) {
    const port = await freePort();
    const { createServer } = await import('node:net');
    const blocker = createServer();
    await new Promise((resolve) => blocker.listen(port, resolve));
    try {
      return await run(port);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  }

  it('exits 1 within the budget when disconnect() never settles, and says why', async () => {
    const { code, output, elapsedMs } = await runChild('shutdown-hang', await freePort());
    expect(code, output).toBe(1);
    expect(output).toMatch(/shutdown started/);
    expect(output).toMatch(/dependency close timed out/);
    expect(output).toMatch(/shutdown finished with incomplete cleanup/);
    expect(output).not.toMatch(/"msg":"shutdown complete"/);
    expect(elapsedMs).toBeLessThan(10_000);
  }, 30_000);

  it('exits 0 after a normal shutdown', async () => {
    const { code, output } = await runChild('shutdown-normal', await freePort());
    expect(code, output).toBe(0);
    expect(output).toMatch(/dependency closed/);
    expect(output).toMatch(/"msg":"shutdown complete"/);
    expect(output).not.toMatch(/timed out|incomplete cleanup/);
  }, 30_000);

  it('reports a failed start and exits 1 even when its cleanup never settles', async () => {
    const { code, output } = await withBusyPort((port) => runChild('startup-hang', port));
    expect(code, output).toBe(1);
    expect(output).toMatch(/dependency close timed out/);
    expect(output).toMatch(/failed to start: Error \(EADDRINUSE\)\. Detail is withheld/);
    expect(output).not.toMatch(/unsettled top-level await|address already in use/);
  }, 30_000);

  it('reports a failed start and exits 1 after a normal cleanup', async () => {
    const { code, output } = await withBusyPort((port) => runChild('startup-normal', port));
    expect(code, output).toBe(1);
    expect(output).toMatch(/dependency closed/);
    expect(output).toMatch(/failed to start: Error \(EADDRINUSE\)\. Detail is withheld/);
  }, 30_000);
});
