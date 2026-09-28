/**
 * TEST FIXTURE — a real Node process for the bounded-cleanup regressions
 * (correction cycle 2, finding 2). Run by tests/server.test.js:
 *
 *   node tests/fixtures/shutdown-child.mjs <scenario> <port>
 *
 * scenario:
 *   shutdown-hang    start, then SIGTERM; the database disconnect never settles
 *   shutdown-normal  start, then SIGTERM; normal disconnect
 *   startup-hang     the port is taken (by the parent); cleanup never settles
 *   startup-normal   the port is taken; normal cleanup
 *
 * It deliberately adds NO timers, intervals or other handles of its own: the
 * process must stay alive only because of what the server code itself holds,
 * so an unref'ed deadline that lets the event loop drain early is exposed.
 * The real installSignalHandlers is used with the real process object; its
 * SIGTERM listener is invoked with process.emit, which works identically on
 * Windows (where a real SIGTERM cannot be delivered to a handler).
 */
import { startServer, installSignalHandlers, formatStartupFailure } from '../../src/server.js';
import { offlineDatabase } from '../helpers.js';

const [scenario, port] = process.argv.slice(2);
const connector = offlineDatabase();
const database = scenario.endsWith('-hang')
  ? { ...connector, disconnect: () => new Promise(() => {}) }
  : connector;

const env = {
  APP_ENV: 'local',
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
  PORT: port,
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  // Satisfies configuration only; the offline connector never connects.
  MONGODB_URI: 'mongodb://127.0.0.1:27017/valida_test',
};

if (scenario.startsWith('shutdown-')) {
  const handle = await startServer({ env, database });
  installSignalHandlers({
    shutdown: (signal) => handle.shutdown(signal, { timeoutMs: 50, dependencyTimeoutMs: 50 }),
    logger: handle.logger,
  });
  process.emit('SIGTERM', 'SIGTERM');
} else {
  // Mirrors the direct-run catch block in src/server.js.
  try {
    await startServer({ env, database, cleanupTimeoutMs: 50 });
    console.error('unexpected: the server started although its port was taken');
    process.exit(3);
  } catch (error) {
    console.error(formatStartupFailure(error));
    process.exit(1);
  }
}
