import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';
import { Readiness, DEPENDENCY_STATE } from '../src/modules/health/readiness.js';

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

export function testConfig(overrides = {}) {
  const base = loadConfig({
    NODE_ENV: 'test',
    APP_ENV: 'local',
    // A concrete port: the schema rejects 0 on purpose, because a production
    // deployment that set PORT=0 would silently bind a random port. Tests that
    // actually listen discover a free port instead (see freePort below).
    PORT: '4100',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  });
  return Object.freeze({ ...base, ...overrides });
}

/** App at the honest B1 baseline: configuration ready, the rest not implemented. */
export function buildApp(options = {}) {
  const readiness = options.readiness ?? new Readiness();
  if (!options.readiness) readiness.set('configuration', DEPENDENCY_STATE.READY);
  return createApp({
    config: options.config ?? testConfig(),
    logger: options.logger ?? silentLogger(),
    readiness,
    registerTestRoutes: options.registerTestRoutes,
  });
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
