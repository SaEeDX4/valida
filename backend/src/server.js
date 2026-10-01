import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { loadConfig, ConfigurationError } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { Readiness, DEPENDENCY_STATE } from './modules/health/readiness.js';
import { safeErrorSummary } from './lib/safeError.js';
import { mongoDatabase, DatabaseConnectionError } from './db/mongoose.js';
import { createPrivateStorage, StorageInitializationError } from './integrations/storage/privateStorage.js';
import { TempUploadArea } from './lib/multipart/tempUploadArea.js';
import { serveUnlessConnectionClosing } from './lib/http/stagedClose.js';

/**
 * Backend process entry point — Doc 09 section 8, Doc 15 section 50.
 *
 * Owns validated startup, the listening socket, signal handling and graceful
 * shutdown. The application itself is built in app.js.
 *
 * ENVIRONMENT LOADING
 * backend/.env is read by the Node runtime via --env-file-if-exists in the npm
 * scripts, using Node 24's native support. No dotenv dependency is required.
 *
 * Startup fails loudly on invalid configuration rather than serving traffic in
 * a half-configured state.
 */

/**
 * Runs `task` and settles within `ms` milliseconds whatever it does.
 *
 * Resolves (never rejects) with one of:
 *   { status: 'closed' }              — the task finished;
 *   { status: 'failed', error }       — it threw or rejected;
 *   { status: 'timed_out' }           — it did not finish in time. The task is
 *                                        abandoned, not cancelled: a hung
 *                                        driver call cannot be cancelled, but it
 *                                        can no longer hold shutdown open.
 *
 * The deadline timer is deliberately NOT unref'ed. A never-settling promise
 * holds no event-loop handle, so with an unref'ed timer the process could run
 * out of work and exit — with code 0, before the timeout fired and before the
 * incomplete cleanup was logged or turned into exit code 1 (correction cycle
 * 2, finding 2). The timer is cleared as soon as the task settles, so it never
 * delays an exit that is otherwise ready.
 */
export function settleWithin(task, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ status: 'timed_out' }), Math.max(0, ms));
    Promise.resolve()
      .then(task)
      .then(
        () => {
          clearTimeout(timer);
          resolve({ status: 'closed' });
        },
        (error) => {
          clearTimeout(timer);
          resolve({ status: 'failed', error });
        },
      );
  });
}

/**
 * Starts the server.
 *
 * Returns handles instead of calling process.exit, so an integration test can
 * start and stop a real server without terminating the test runner.
 *
 * `database` is the connector used to reach MongoDB. It defaults to the real
 * Mongoose connector and production never overrides it, so `npm start` always
 * connects to the database named by MONGODB_URI. The parameter exists so the
 * HTTP lifecycle tests can run without a MongoDB server; persistence and
 * uniqueness are proven only by the real-database suite (tests/db).
 */
export async function startServer({
  env = process.env,
  database = mongoDatabase,
  // Bounds the dependency cleanup after a failed startup (see below).
  cleanupTimeoutMs = 10_000,
  // Tests pass a capturing logger to assert what is written; production never does.
  logger: injectedLogger,
  // B4 test seams: where the per-process temporary upload area is created
  // (default: the OS temporary directory), and a replacement storage factory
  // for startup-failure tests. Production passes neither.
  uploadTempBaseDirectory,
  storageFactory = createPrivateStorage,
} = {}) {
  const config = loadConfig(env);
  const logger =
    injectedLogger ??
    createLogger({
      level: config.logLevel,
      appEnv: config.appEnv,
      isProduction: config.isProduction,
    });
  const readiness = new Readiness();

  /*
   * Cleanup functions run during graceful shutdown, one list per server
   * instance. B4 registers the temporary upload area and the resume storage,
   * B2 the MongoDB close. A module-level list (the B1 shape) would be shared by every server
   * started in the same process, so one instance's shutdown could close — or
   * fail to close — another instance's dependencies.
   */
  const shutdownHooks = [];
  const onShutdown = (name, handler) => {
    shutdownHooks.push({ name, handler });
  };

  /**
   * Runs every registered cleanup within ONE shared deadline, so a dependency
   * whose close never settles (a hung driver, an unreachable server) cannot
   * hold shutdown open. Each hook is still started, in order; each outcome is
   * reported honestly and safely — a classified error, never a raw message.
   */
  async function runShutdownHooks(budgetMs) {
    const deadline = Date.now() + budgetMs;
    const outcome = { closed: [], failed: [], timedOut: [] };
    for (const { name, handler } of shutdownHooks) {
      const remainingMs = Math.max(0, deadline - Date.now());
      const result = await settleWithin(handler, remainingMs);
      if (result.status === 'closed') {
        outcome.closed.push(name);
        logger.info({ dependency: name }, 'dependency closed');
      } else if (result.status === 'failed') {
        outcome.failed.push(name);
        logger.error({ dependency: name, err: safeErrorSummary(result.error) }, 'dependency failed to close');
      } else {
        outcome.timedOut.push(name);
        logger.error({ dependency: name, timeoutMs: budgetMs }, 'dependency close timed out');
      }
    }
    return outcome;
  }

  readiness.set('configuration', DEPENDENCY_STATE.READY);

  /*
   * B4 — private resume storage, before anything else is opened.
   *
   * When storage is configured it must genuinely work: init() creates and
   * checks the private directories and writes, reads back and removes a probe
   * object. If that fails, startup fails — a backend that listens with
   * broken storage would accept Applications it cannot store. Only then is
   * `resumeStorage` reported ready, and the per-process temporary upload area
   * (owner-only, randomly named) is created for the multipart parser.
   *
   * When NO storage is configured (config/env.js explains when that is
   * correct), the backend still starts and serves the Jobs API, and the
   * dependency is reported honestly: `unavailable` for a local process that
   * simply has not configured it, `not_implemented` for a deployed one, whose
   * production provider does not exist until C6. Either way overall
   * readiness answers 503 — as it must while notifications (B6) are absent.
   */
  const resumeStorage = storageFactory({ config, logger });
  let uploadArea = null;
  if (resumeStorage) {
    await resumeStorage.init();
    try {
      uploadArea = await TempUploadArea.create({ baseDirectory: uploadTempBaseDirectory, logger });
    } catch (error) {
      await resumeStorage.close();
      throw error;
    }
    readiness.set('resumeStorage', DEPENDENCY_STATE.READY);
    onShutdown('uploadTemp', () => uploadArea.close());
    onShutdown('resumeStorage', () => resumeStorage.close());
  } else {
    const deployed = config.appEnv !== 'local' || config.nodeEnv === 'production';
    const state = deployed ? DEPENDENCY_STATE.NOT_IMPLEMENTED : DEPENDENCY_STATE.UNAVAILABLE;
    readiness.set('resumeStorage', state);
    logger.warn(
      { dependency: 'resumeStorage', state },
      'private resume storage is not configured; applications cannot be accepted',
    );
  }

  /*
   * B2 — connect to MongoDB before the socket opens.
   *
   * Startup fails if the database is unreachable: a backend that listens
   * without its database would accept traffic it cannot serve. connectDatabase
   * sets the `database` readiness dependency from the real connection events
   * and keeps it current if the connection drops later.
   *
   * Notifications (B6) remain not_implemented, so overall readiness still
   * answers the canonical 503 "Service is not ready." Marking a dependency
   * ready to obtain a 200 would be a false claim.
   */
  try {
    await database.connect({ config, logger, readiness });
  } catch (error) {
    // Storage and the upload area are already open; close them before failing.
    readiness.beginShutdown();
    await runShutdownHooks(cleanupTimeoutMs);
    throw error;
  }
  onShutdown('mongodb', () => database.disconnect({ logger, readiness }));

  /*
   * The storage and upload area are handed to the application for the Apply
   * route (B5). No B4 route uses them: B4 adds no public upload endpoint.
   */
  const app = createApp({ config, logger, readiness, resumeStorage, uploadArea });
  /*
   * B4 r3: a request pipelined behind an upload refused before its body was
   * read (413/503, connection closed in stages) never reaches the app
   * (RFC 9112 section 9.6; lib/http/stagedClose.js). Outside the app, so the
   * Express middleware order (Doc 09 section 13) is unchanged.
   */
  const server = http.createServer(serveUnlessConnectionClosing(app));

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (error) {
    /*
     * The socket could not be bound (a port already in use, for instance).
     * The database is already connected by now, so close it before failing:
     * a rejected startServer must not leave an open connection behind.
     */
    readiness.beginShutdown();
    // Bounded like shutdown: a hanging close must not turn a failed start
    // into a process that never exits.
    await runShutdownHooks(cleanupTimeoutMs);
    throw error;
  }

  // appEnv is already in the logger's base fields; repeating it here produced
  // a duplicated key in every startup line.
  logger.info(
    {
      port: config.port,
      nodeEnv: config.nodeEnv,
      readiness: readiness.describe(),
    },
    'backend listening',
  );

  server.on('error', (error) => {
    logger.error({ err: safeErrorSummary(error) }, 'server error');
  });

  /**
   * Graceful shutdown.
   *
   * Order matters:
   *   1. mark readiness unavailable, so a load balancer stops sending new work
   *      before the socket closes and in-flight requests are cut off;
   *   2. stop accepting connections and let open requests finish — at most
   *      `timeoutMs`, after which remaining connections are closed;
   *   3. run dependency hooks (B2: close the MongoDB connection) — together at
   *      most `dependencyTimeoutMs` (default: the same as `timeoutMs`);
   *   4. resolve with an outcome, leaving the caller to decide about exiting.
   *
   * The whole sequence is therefore bounded by timeoutMs + dependencyTimeoutMs,
   * whatever a connection or a dependency does. Nothing that did not finish is
   * reported as closed: the outcome's `clean` is true only when the HTTP server
   * closed in time and every dependency closed successfully.
   *
   * Calling it again while or after it runs resolves undefined and does
   * nothing.
   */
  let shuttingDown = false;
  async function shutdown(reason, { timeoutMs = 10_000, dependencyTimeoutMs = timeoutMs } = {}) {
    if (shuttingDown) return undefined;
    shuttingDown = true;

    logger.info({ reason }, 'shutdown started');
    readiness.beginShutdown();

    const http = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        logger.warn({ timeoutMs }, 'shutdown timed out waiting for connections; closing them');
        server.closeAllConnections?.();
        resolve('timed_out');
      }, timeoutMs);
      // Kept referenced for the same reason as in settleWithin: the deadline
      // itself must keep the process alive until the outcome is reported. It
      // is cleared the moment the server closes.

      server.close(() => {
        clearTimeout(timer);
        resolve('closed');
      });
      // Idle keep-alive sockets would otherwise hold the server open.
      server.closeIdleConnections?.();
    });

    const dependencies = await runShutdownHooks(dependencyTimeoutMs);
    const clean = http === 'closed' && dependencies.failed.length === 0 && dependencies.timedOut.length === 0;

    if (clean) {
      logger.info({ reason }, 'shutdown complete');
    } else {
      logger.error(
        { reason, http, failed: dependencies.failed, timedOut: dependencies.timedOut },
        'shutdown finished with incomplete cleanup',
      );
    }
    return { reason, clean, http, dependencies };
  }

  return { app, server, config, logger, readiness, shutdown, onShutdown, resumeStorage, uploadArea };
}

/**
 * Wires process signals to a running server.
 *
 * Kept separate from startServer so importing the module in a test neither
 * registers global signal handlers nor risks exiting the test runner.
 *
 * The exit code is honest: 0 only when shutdown reports a clean finish, 1 when
 * any cleanup failed or timed out, or when a second signal arrives before
 * shutdown has finished (the operator is forcing the exit). `processRef` exists
 * so this can be tested without a real signal or a real exit.
 */
export function installSignalHandlers({ shutdown, logger }, { processRef = process } = {}) {
  let handling = false;
  const handle = (signal) => {
    if (handling) {
      logger.warn({ signal }, 'second signal received; exiting before shutdown finished');
      processRef.exit(1);
      return;
    }
    handling = true;
    shutdown(signal)
      .then((outcome) => processRef.exit(outcome?.clean ? 0 : 1))
      .catch((error) => {
        logger.error({ err: safeErrorSummary(error) }, 'shutdown failed');
        processRef.exit(1);
      });
  };
  processRef.on('SIGINT', () => handle('SIGINT'));
  processRef.on('SIGTERM', () => handle('SIGTERM'));
}

/**
 * Is this module the process entry point?
 *
 * Exported so it can be tested directly.
 *
 * process.argv[1] is a FILESYSTEM PATH while import.meta.url is a file URL, so
 * the two can only be compared after converting one. The previous
 * `file://${process.argv[1]}` template did that incorrectly and broke on
 * Windows, where argv[1] looks like C:\ME\valida\backend\src\server.js:
 * the naive form produces "file://C:\ME\..." while the real URL is
 * "file:///C:/ME/.../server.js" — different drive-letter prefix, backslashes
 * instead of slashes, and no percent-encoding. They never matched, so
 * `npm start` started nothing on Windows and exited silently.
 *
 * pathToFileURL performs the platform-correct conversion: drive letters,
 * separators and characters needing percent-encoding (a space in the path, for
 * instance) are all handled by Node itself. No dependency is required.
 */
export function isMainModule(moduleUrl = import.meta.url, entryPath = process.argv[1]) {
  if (!entryPath) return false;
  try {
    return moduleUrl === pathToFileURL(entryPath).href;
  } catch {
    // An unconvertible argv[1] means this was not launched as a script.
    return false;
  }
}

/**
 * The single line written to stderr when startup fails.
 *
 * Startup failures happen before a logger exists, so stderr is the only
 * channel, and what is written depends on whether the text is safe BY
 * CONSTRUCTION:
 *
 * - A ConfigurationError is. Every word comes from the fixed rule table in
 *   config/env.js and no environment value is interpolated, so it is printed in
 *   full and tells an operator exactly what to fix.
 * - A DatabaseConnectionError carries only fixed text. The driver error behind
 *   it quotes hosts and sometimes the URI with its credentials, so none of that
 *   is printed — only which variable to check.
 * - Anything else is an arbitrary exception whose message and stack may carry
 *   a connection string, a credential or a filesystem path, so only the bounded
 *   classification is printed. Never error.message, never the stack.
 *
 * Exported so its wording can be tested without spawning a process.
 */
export function formatStartupFailure(error) {
  if (error instanceof ConfigurationError) {
    return `[valida-backend] failed to start:\n${error.message}`;
  }
  if (error instanceof DatabaseConnectionError) {
    return (
      '[valida-backend] failed to start: the database connection could not be established. ' +
      'Check that MONGODB_URI names a reachable MongoDB server. ' +
      'Detail is withheld because it may contain configuration values or credentials.'
    );
  }
  if (error instanceof StorageInitializationError) {
    // `reason` is a fixed token (integrations/storage/storageContract.js); the
    // path is never printed.
    return (
      `[valida-backend] failed to start: the private resume storage could not be initialised (${error.reason}). ` +
      'Check that RESUME_STORAGE_LOCAL_ROOT names a directory this user can create and write, ' +
      'that is not a link, that does not lead (through any link or junction) into the repository ' +
      'or a public, static or web-served directory, and (on Linux/macOS) that no other user can ' +
      'access (mode 700).'
    );
  }
  const { type, code } = safeErrorSummary(error);
  return (
    `[valida-backend] failed to start: ${type}${code ? ` (${code})` : ''}. ` +
    'Detail is withheld because it may contain configuration values or credentials.'
  );
}

/*
 * Only run when executed directly, never when imported by a test.
 * Importing this module must have no side effect beyond defining functions.
 */
if (isMainModule()) {
  try {
    const started = await startServer();
    installSignalHandlers(started);
  } catch (error) {
    console.error(formatStartupFailure(error));
    process.exit(1);
  }
}
