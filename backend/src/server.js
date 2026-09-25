import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { loadConfig, ConfigurationError } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { Readiness, DEPENDENCY_STATE } from './modules/health/readiness.js';
import { safeErrorSummary } from './lib/safeError.js';

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

/** Hooks each later milestone registers to close its own dependency. */
const shutdownHooks = [];

/**
 * Registers a cleanup function run during graceful shutdown.
 *
 * B2 will register the MongoDB connection close here, B4 the storage client.
 * B1 registers nothing: there is no connection to close, and faking one would
 * report a clean database shutdown that never happened.
 */
export function onShutdown(name, handler) {
  shutdownHooks.push({ name, handler });
}

/**
 * Starts the server.
 *
 * Returns handles instead of calling process.exit, so an integration test can
 * start and stop a real server without terminating the test runner.
 */
export async function startServer({ env = process.env } = {}) {
  const config = loadConfig(env);
  const logger = createLogger({
    level: config.logLevel,
    appEnv: config.appEnv,
    isProduction: config.isProduction,
  });
  const readiness = new Readiness();

  // Configuration is the one dependency B1 genuinely satisfies. database,
  // resumeStorage and notifications stay not_implemented until B2/B4/B6, so
  // readiness correctly reports 503 at this baseline.
  readiness.set('configuration', DEPENDENCY_STATE.READY);

  const app = createApp({ config, logger, readiness });
  const server = http.createServer(app);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

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
   *   2. stop accepting connections and let open requests finish;
   *   3. run dependency hooks (none in B1);
   *   4. resolve, leaving the caller to decide about exiting.
   *
   * A timeout bounds the wait so a stuck connection cannot block shutdown for
   * ever.
   */
  let shuttingDown = false;
  async function shutdown(reason, { timeoutMs = 10_000 } = {}) {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ reason }, 'shutdown started');
    readiness.beginShutdown();

    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        logger.warn({ timeoutMs }, 'shutdown timed out waiting for connections; closing anyway');
        resolve();
      }, timeoutMs);
      timer.unref?.();

      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
      // Idle keep-alive sockets would otherwise hold the server open.
      server.closeIdleConnections?.();
    });

    for (const { name, handler } of shutdownHooks) {
      try {
        await handler();
        logger.info({ dependency: name }, 'dependency closed');
      } catch (error) {
        logger.error({ dependency: name, err: safeErrorSummary(error) }, 'dependency failed to close');
      }
    }

    logger.info({ reason }, 'shutdown complete');
  }

  return { app, server, config, logger, readiness, shutdown };
}

/**
 * Wires process signals to a running server.
 *
 * Kept separate from startServer so importing the module in a test neither
 * registers global signal handlers nor risks exiting the test runner.
 */
export function installSignalHandlers({ shutdown, logger }) {
  const handle = (signal) => {
    shutdown(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        logger.error({ err: safeErrorSummary(error) }, 'shutdown failed');
        process.exit(1);
      });
  };
  process.on('SIGINT', () => handle('SIGINT'));
  process.on('SIGTERM', () => handle('SIGTERM'));
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

/*
 * Only run when executed directly, never when imported by a test.
 * Importing this module must have no side effect beyond defining functions.
 */
if (isMainModule()) {
  try {
    const started = await startServer();
    installSignalHandlers(started);
  } catch (error) {
    /*
     * Startup failed before a logger existed, so stderr is the only channel.
     * What is written depends on whether the message is safe BY CONSTRUCTION.
     *
     * A ConfigurationError is: every word of it comes from the fixed rule table
     * in config/env.js and no environment value is ever interpolated, so it can
     * be printed in full and tells an operator exactly what to fix.
     *
     * Anything else is an arbitrary exception whose message and stack may carry
     * a connection string, a credential or a filesystem path, so only the
     * bounded classification is printed. Never error.message, never the stack.
     */
    if (error instanceof ConfigurationError) {
      console.error(`[valida-backend] failed to start:\n${error.message}`);
    } else {
      const { type, code } = safeErrorSummary(error);
      console.error(
        `[valida-backend] failed to start: ${type}${code ? ` (${code})` : ''}. ` +
          'Detail is withheld because it may contain configuration values or credentials.',
      );
    }
    process.exit(1);
  }
}
