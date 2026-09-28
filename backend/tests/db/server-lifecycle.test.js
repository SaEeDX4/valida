import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'node:net';
import { startServer } from '../../src/server.js';
import { freePort } from '../helpers.js';
import { requireTestDatabase } from './testDatabase.js';

/**
 * Backend startup and shutdown against a REAL MongoDB.
 *
 * The offline suite drives the same code with an in-memory stand-in for the
 * Mongoose module. These tests use no stand-in: startServer is called with its
 * production default connector, and `node src/server.js` is spawned exactly as
 * `npm start` runs it. They carry the two B1 proofs that need a database from
 * B2 onward — the script really listens, and a busy port produces only a
 * bounded message — plus the real connect/close lifecycle.
 */
// Judged on the launching environment BEFORE any child below is given
// MONGODB_URI = the test target (including the production-mode child).
const { uri: TEST_URI } = requireTestDatabase();
const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const stateOf = (readiness, name) => readiness.describe().dependencies.find((d) => d.name === name).state;

const running = [];
afterEach(async () => {
  while (running.length) await running.pop().shutdown('test cleanup');
});

async function startAgainstTestDatabase() {
  const port = await freePort();
  const handle = await startServer({
    env: { APP_ENV: 'local', NODE_ENV: 'test', LOG_LEVEL: 'silent', PORT: String(port), MONGODB_URI: TEST_URI },
  });
  running.push(handle);
  return { ...handle, port };
}

describe('startServer with the real MongoDB connector', () => {
  it('connects before listening and reports the database ready', async () => {
    const { readiness, server } = await startAgainstTestDatabase();
    expect(server.listening).toBe(true);
    expect(mongoose.connection.readyState).toBe(1);
    expect(stateOf(readiness, 'database')).toBe('ready');
  }, 30_000);

  it('still answers the canonical 503, because B4 and B6 are not implemented', async () => {
    const { port } = await startAgainstTestDatabase();
    const base = `http://127.0.0.1:${port}`;
    expect((await request(base).get('/api/v1/health')).status).toBe(200);
    const ready = await request(base).get('/api/v1/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.error).toEqual({ code: 'SERVICE_UNAVAILABLE', message: 'Service is not ready.' });
  }, 30_000);

  it('closes the MongoDB connection during graceful shutdown and reports it clean', async () => {
    const { readiness, shutdown } = await startAgainstTestDatabase();
    const outcome = await shutdown('SIGTERM');
    running.pop();
    expect(outcome).toMatchObject({ clean: true, http: 'closed', dependencies: { closed: ['mongodb'], failed: [], timedOut: [] } });
    expect(mongoose.connection.readyState).toBe(0);
    expect(stateOf(readiness, 'database')).toBe('unavailable');
  }, 30_000);
});

/** Spawns `node src/server.js` and collects output until `until` matches or the process exits. */
function runServerScript(env, { until, timeoutMs = 20_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['src/server.js'], {
      cwd: backendRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ output, code, child });
    };
    const onData = (chunk) => {
      output += chunk;
      if (until && until.test(output)) finish(null);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => finish(code));
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
}

describe('running src/server.js directly against MongoDB', () => {
  it('connects to the database and starts listening (the B1 Windows direct-run regression)', async () => {
    const port = await freePort();
    const { output, child } = await runServerScript(
      { APP_ENV: 'local', LOG_LEVEL: 'info', PORT: String(port), MONGODB_URI: TEST_URI, CORS_ALLOWED_ORIGINS: 'http://localhost:5173' },
      { until: /backend listening/ },
    );
    try {
      expect(output).toMatch(/database connected/);
      expect(output).toMatch(/backend listening/);
      expect(output).toMatch(new RegExp(`"port":${port}`));
      const ready = await request(`http://127.0.0.1:${port}`).get('/api/v1/health/ready');
      expect(ready.status).toBe(503);
      // The connection string never reaches the log.
      expect(output).not.toContain(TEST_URI);
      expect(output).not.toMatch(/mongodb(\+srv)?:\/\//);
    } finally {
      child.kill('SIGTERM');
    }
  }, 30_000);

  it('also runs in production mode against the isolated test database', async () => {
    // The safety guard judges the LAUNCHING environment; a child started in
    // production mode against the approved test database is legitimate.
    const port = await freePort();
    const { output, child } = await runServerScript(
      {
        APP_ENV: 'production', NODE_ENV: 'production', LOG_LEVEL: 'info', PORT: String(port),
        MONGODB_URI: TEST_URI, CORS_ALLOWED_ORIGINS: 'https://valida.lt',
      },
      { until: /backend listening/ },
    );
    try {
      expect(output).toMatch(/database connected/);
      expect(output).toMatch(/backend listening/);
      const ready = await request(`http://127.0.0.1:${port}`).get('/api/v1/health/ready');
      expect(ready.status).toBe(503);
      expect(ready.body.error.message).toBe('Service is not ready.');
      expect(output).not.toMatch(/mongodb(\+srv)?:\/\//);
    } finally {
      child.kill('SIGTERM');
    }
  }, 30_000);

  it('prints only a bounded classification when the port is already in use', async () => {
    const port = await freePort();
    const blocker = createServer();
    await new Promise((resolve) => blocker.listen(port, resolve));
    try {
      const { output, code } = await runServerScript({
        APP_ENV: 'local', LOG_LEVEL: 'silent', PORT: String(port), MONGODB_URI: TEST_URI,
        CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
      });
      expect(code).toBe(1);
      expect(output).toMatch(/failed to start: Error \(EADDRINUSE\)/);
      expect(output).toMatch(/Detail is withheld/);
      expect(output).not.toMatch(/address already in use/);
      expect(output).not.toMatch(/at [A-Za-z]+ \(/);
      expect(output).not.toMatch(/node_modules|src[\\/]server\.js:/);
      expect(output).not.toMatch(/mongodb(\+srv)?:\/\//);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  }, 30_000);
});
