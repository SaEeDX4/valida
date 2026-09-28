import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';
import { Readiness, DEPENDENCY_STATE } from '../src/modules/health/readiness.js';
import { connectDatabase, disconnectDatabase } from '../src/db/mongoose.js';

/**
 * Test helpers.
 *
 * Every test builds the REAL application through createApp with injected
 * dependencies, so the full middleware stack is exercised. Nothing here
 * replaces production behaviour with a test-only path.
 */

/** Silent logger: tests assert on responses, not on log noise. */
export const silentLogger = () => createLogger({ level: 'silent' });

/**
 * A real logger whose output is captured.
 *
 * Returns the logger plus the lines pino actually WRITES, after its
 * serialisers and redaction have run. Asserting on these is what proves what
 * would reach a log file — inspecting the arguments handed to logger.error()
 * would examine objects pino has not processed yet, and would report leaks
 * that never get written.
 */
export function capturingLogger() {
  const lines = [];
  const logger = createLogger({
    level: 'trace',
    destination: { write: (chunk) => lines.push(chunk) },
  });
  return { logger, lines, output: () => lines.join('') };
}

/**
 * Connection string used by OFFLINE tests to satisfy configuration.
 *
 * Required from B2, because startup connects to MongoDB. The offline suite
 * never opens it: createApp does not connect, and startServer is given the
 * offline stand-in below. Only tests/db connects, and it uses MONGODB_TEST_URI.
 */
export const OFFLINE_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27017/valida_test';

export function testConfig(overrides = {}) {
  const base = loadConfig({
    NODE_ENV: 'test',
    APP_ENV: 'local',
    // A concrete port: the schema rejects 0 on purpose, because a production
    // deployment that set PORT=0 would silently bind a random port. Tests that
    // actually listen discover a free port instead (see freePort below).
    PORT: '4100',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
    MONGODB_URI: OFFLINE_TEST_MONGODB_URI,
  });
  return Object.freeze({ ...base, ...overrides });
}

/**
 * App with only configuration ready — the state before the database has
 * connected, or after it is lost. Readiness must answer 503.
 */
export function buildApp(options = {}) {
  const readiness = options.readiness ?? new Readiness();
  if (!options.readiness) readiness.set('configuration', DEPENDENCY_STATE.READY);
  return createApp({
    config: options.config ?? testConfig(),
    logger: options.logger ?? silentLogger(),
    readiness,
    registerTestRoutes: options.registerTestRoutes,
    // B3: undefined keeps createApp's production defaults (the real MongoDB
    // repository and the real clock).
    jobRepository: options.jobRepository,
    clock: options.clock,
  });
}

/**
 * App in the state a running B2 server reaches: configuration and database
 * ready, resume storage (B4) and notifications (B6) still not implemented.
 * Readiness must still answer the canonical 503.
 */
export function buildConnectedApp(options = {}) {
  const readiness = new Readiness();
  readiness.set('configuration', DEPENDENCY_STATE.READY);
  readiness.set('database', DEPENDENCY_STATE.READY);
  return buildApp({ ...options, readiness });
}

/** App whose every required dependency is explicitly ready. */
export function buildReadyApp(options = {}) {
  return buildApp({ ...options, readiness: Readiness.fullyReadyForTests() });
}


/**
 * Finds a free TCP port by letting the OS assign one and releasing it.
 *
 * Used by the server integration test so it never collides with a developer's
 * running backend or another test run.
 */
export async function freePort() {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * OFFLINE STAND-IN FOR THE MONGOOSE MODULE — not evidence of persistence.
 *
 * Lets the HTTP lifecycle tests (startup, readiness, shutdown) run without a
 * MongoDB server. It is driven through the REAL connectDatabase and
 * disconnectDatabase, so those tests still exercise the production event
 * wiring, readiness updates and shutdown ordering. What it cannot show —
 * that data is written, survives a restart or is rejected by a unique index —
 * is proven only by the real-database suite in tests/db.
 *
 * It never records the connection string it is given.
 */
export function fakeMongoose({ failConnect = false } = {}) {
  const listeners = {};
  const connection = {
    readyState: 0,
    closeCalls: 0,
    on(event, handler) {
      (listeners[event] ??= []).push(handler);
    },
    off(event, handler) {
      listeners[event] = (listeners[event] ?? []).filter((candidate) => candidate !== handler);
    },
    emit(event, ...args) {
      [...(listeners[event] ?? [])].forEach((handler) => handler(...args));
    },
    listenerCount(event) {
      return (listeners[event] ?? []).length;
    },
    async close() {
      this.closeCalls += 1;
      this.readyState = 0;
      this.emit('disconnected');
    },
  };
  return {
    connection,
    connectCalls: 0,
    lastConnectOptions: null,
    async connect(_uri, options) {
      this.connectCalls += 1;
      this.lastConnectOptions = options;
      if (failConnect) {
        // Shaped like a real driver error: it quotes the host, as drivers do.
        const error = new Error('connect ECONNREFUSED 127.0.0.1:27017');
        error.name = 'MongooseServerSelectionError';
        throw error;
      }
      connection.readyState = 1;
      connection.emit('connected');
    },
  };
}

/** A startServer database connector backed by fakeMongoose. */
export function offlineDatabase(instance = fakeMongoose()) {
  return {
    instance,
    connect: (args) => connectDatabase({ ...args, mongooseInstance: instance }),
    disconnect: (args) => disconnectDatabase({ ...args, mongooseInstance: instance }),
  };
}
