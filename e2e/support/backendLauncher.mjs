import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Starts the REAL backend for the E2E run, bound to loopback (C3, GPT finding 2).
 *
 * `node src/server.js` (npm start) listens on every interface — the production
 * default, unchanged. The backend's existing startServer option `listenHost`
 * binds a test server to one interface; the live smoke test already uses it.
 * This launcher does exactly what server.js does when run directly — start,
 * then install the signal handlers — with listenHost '127.0.0.1', and then
 * reports the address the socket ACTUALLY listens on, read from the server
 * itself (server.address()), not from the URL the suite uses.
 *
 * Started by globalSetup with cwd = backend/ and the run's environment. Never
 * reads backend/.env (no --env-file).
 */
const backendDir = process.cwd();
const { formatStartupFailure, installSignalHandlers, startServer } = await import(pathToFileURL(path.join(backendDir, 'src', 'server.js')).href);

try {
  const started = await startServer({ listenHost: '127.0.0.1' });
  installSignalHandlers(started);
  const { address, family, port } = started.server.address();
  process.stdout.write(`READY ${JSON.stringify({ address, family, port })}\n`);
} catch (error) {
  console.error(formatStartupFailure(error));
  process.exit(1);
}
