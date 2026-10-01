import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startServer } from '../../src/server.js';
import { freePort } from '../helpers.js';
import { makeTestRoot, removeTestRoot, listFiles } from '../fixtures/uploadHarness.js';
import { requireTestDatabase } from './testDatabase.js';

/**
 * B4 — resume storage in the REAL backend lifecycle, against a REAL MongoDB.
 *
 * startServer with its production MongoDB connector, and `node src/server.js`
 * spawned as `npm start` runs it, both with the development storage driver
 * pointed at a fresh temporary test root (never a developer's configured
 * storage). Proves: storage is initialised before the server listens and
 * reported ready, overall readiness still answers the canonical 503 while B6
 * is absent, and graceful shutdown closes the upload area, the storage and
 * MongoDB and reports a clean exit.
 */
const { uri: TEST_URI } = requireTestDatabase();
const backendRoot = path.join(import.meta.dirname, '..', '..');
const stateOf = (readiness, name) => readiness.describe().dependencies.find((d) => d.name === name).state;

let root;
let storageRoot;
let tempBase;
const running = [];

beforeEach(() => {
  root = makeTestRoot();
  storageRoot = path.join(root, 'private-resumes');
  tempBase = path.join(root, 'tmp');
  fs.mkdirSync(tempBase);
});
afterEach(async () => {
  while (running.length) await running.pop().shutdown('test cleanup');
  removeTestRoot(root);
});

const storageEnv = () => ({ RESUME_STORAGE_DRIVER: 'local', RESUME_STORAGE_LOCAL_ROOT: storageRoot });

describe('startServer with real MongoDB and real local storage', () => {
  it('initialises storage, reports it ready, and still answers the canonical 503 (B6 absent)', async () => {
    const port = await freePort();
    const handle = await startServer({
      env: { APP_ENV: 'local', NODE_ENV: 'test', LOG_LEVEL: 'silent', PORT: String(port), MONGODB_URI: TEST_URI, ...storageEnv() },
      uploadTempBaseDirectory: tempBase,
    });
    running.push(handle);
    expect(stateOf(handle.readiness, 'database')).toBe('ready');
    expect(stateOf(handle.readiness, 'resumeStorage')).toBe('ready');
    expect(stateOf(handle.readiness, 'notifications')).toBe('not_implemented');
    const ready = await request(`http://127.0.0.1:${port}`).get('/api/v1/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.body.error).toEqual({ code: 'SERVICE_UNAVAILABLE', message: 'Service is not ready.' });
    expect(fs.statSync(path.join(storageRoot, 'resumes')).isDirectory()).toBe(true);
  }, 30_000);

  it('graceful shutdown closes the upload area, the storage and MongoDB — clean', async () => {
    const port = await freePort();
    const handle = await startServer({
      env: { APP_ENV: 'local', NODE_ENV: 'test', LOG_LEVEL: 'silent', PORT: String(port), MONGODB_URI: TEST_URI, ...storageEnv() },
      uploadTempBaseDirectory: tempBase,
    });
    fs.writeFileSync(handle.uploadArea.reserveFile().path, 'QA in-flight');
    const outcome = await handle.shutdown('SIGTERM');
    expect(outcome).toMatchObject({ clean: true, http: 'closed', dependencies: { closed: ['uploadTemp', 'resumeStorage', 'mongodb'], failed: [], timedOut: [] } });
    expect(fs.readdirSync(tempBase)).toEqual([]);
    expect(listFiles(storageRoot)).toEqual([]);
  }, 30_000);
});

describe('node src/server.js with storage configured', () => {
  it('starts, logs storage ready without its path, and serves the canonical 503 readiness', async () => {
    const port = await freePort();
    const child = spawn(process.execPath, ['src/server.js'], {
      cwd: backendRoot,
      env: {
        ...process.env,
        APP_ENV: 'local',
        LOG_LEVEL: 'info',
        PORT: String(port),
        MONGODB_URI: TEST_URI,
        CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
        TMPDIR: tempBase,
        TEMP: tempBase,
        TMP: tempBase,
        ...storageEnv(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 20_000);
        const onData = (chunk) => {
          output += chunk;
          if (/backend listening/.test(output)) {
            clearTimeout(timer);
            resolve();
          }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.on('exit', () => {
          clearTimeout(timer);
          reject(new Error(`server exited:\n${output}`));
        });
      });
      expect(output).toMatch(/"name":"resumeStorage","owner":"B4","required":true,"state":"ready"/);
      expect(output).not.toContain(storageRoot);
      expect(output).not.toContain(tempBase);
      const ready = await request(`http://127.0.0.1:${port}`).get('/api/v1/health/ready');
      expect(ready.status).toBe(503);
    } finally {
      child.kill('SIGTERM');
      await new Promise((resolve) => (child.exitCode !== null ? resolve() : child.once('exit', resolve)));
    }
  }, 30_000);
});
