import http from 'node:http';
import { createApp } from './app.js';

/**
 * Backend process entry point.
 *
 * Governed by 09_BACKEND_API_SPEC.md section 8.
 *
 * MILESTONE A1 SCOPE
 * A1 delivers process startup and clean termination only. The following are
 * owned by later milestones and are deliberately NOT implemented here:
 *   - B1: environment configuration validation (startup must fail on missing
 *         required production configuration, per 15_DEVOPS_DEPLOYMENT.md s50)
 *   - B1: structured logger initialisation (Pino, per Document 09 section 11)
 *   - B1: full graceful-shutdown semantics with in-flight request draining
 *   - B2: MongoDB connection lifecycle
 *   - B4/B6: storage and notification integration initialisation
 *
 * console logging below is the A1 startup signal only and is replaced by the
 * structured logger in B1. It prints no secrets.
 *
 * ENVIRONMENT LOADING
 * backend/.env is loaded by the Node runtime itself via the
 * --env-file-if-exists flag in the npm scripts (see package.json). This uses
 * Node 24's native env-file support, so no dotenv dependency is required
 * (18_IMPLEMENTATION_ROADMAP.md section 23 — do not add a package when a
 * platform capability already solves the need).
 *
 * "if-exists" is deliberate: the server must still start when no .env file is
 * present, falling back to the defaults below. Enforcing required
 * configuration and failing startup on missing production values is owned by
 * Milestone B1 (15_DEVOPS_DEPLOYMENT.md section 50).
 */

const DEFAULT_PORT = 4000;

const port = Number.parseInt(process.env.PORT ?? '', 10) || DEFAULT_PORT;
const nodeEnv = process.env.NODE_ENV ?? 'development';
const appEnv = process.env.APP_ENV ?? 'local';

const app = createApp();
const server = http.createServer(app);

server.listen(port, () => {
  console.log(
    `[valida-backend] listening on http://localhost:${port} ` +
      `(NODE_ENV=${nodeEnv}, APP_ENV=${appEnv})`,
  );
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `[valida-backend] port ${port} is already in use. ` +
        'Stop the other process or set PORT in backend/.env',
    );
  } else {
    console.error('[valida-backend] server error:', error.message);
  }
  process.exitCode = 1;
});

function shutdown(signal) {
  console.log(`[valida-backend] ${signal} received, closing server`);
  server.close(() => {
    console.log('[valida-backend] server closed');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { server };
