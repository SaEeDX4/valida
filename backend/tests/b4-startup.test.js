import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { startServer, formatStartupFailure } from '../src/server.js';
import { StorageInitializationError } from '../src/integrations/storage/privateStorage.js';
import { ConfigurationError } from '../src/config/env.js';
import { freePort, offlineDatabase, fakeMongoose, OFFLINE_TEST_MONGODB_URI, capturingLogger } from './helpers.js';
import { makeTestRoot, removeTestRoot, listFiles } from './fixtures/uploadHarness.js';

/**
 * B4 — resume storage in startup, readiness and shutdown (Doc 09 sections
 * 39-42 and 165, Doc 15 sections 117 and 221).
 *
 * The HTTP lifecycle runs for real; MongoDB is the offline stand-in (see
 * tests/helpers.js) because this file proves the STORAGE wiring. The same
 * lifecycle over a real MongoDB, as a real process, is in
 * tests/db/b4-storage-lifecycle.test.js.
 */
let root;
let storageRoot;
let tempBase;
const handles = [];

beforeEach(() => {
  root = makeTestRoot();
  storageRoot = path.join(root, 'private-resumes');
  tempBase = path.join(root, 'tmp');
  fs.mkdirSync(tempBase);
});

afterEach(async () => {
  while (handles.length) await handles.pop().shutdown('test cleanup');
  removeTestRoot(root);
});

async function start({ env = {}, database = offlineDatabase(), logger, storageFactory } = {}) {
  const port = await freePort();
  const handle = await startServer({
    env: {
      NODE_ENV: 'test',
      APP_ENV: 'local',
      PORT: String(port),
      LOG_LEVEL: 'silent',
      MONGODB_URI: OFFLINE_TEST_MONGODB_URI,
      ...env,
    },
    database,
    logger,
    storageFactory,
    uploadTempBaseDirectory: tempBase,
  });
  handles.push(handle);
  return { ...handle, port, database };
}

const withStorage = { RESUME_STORAGE_DRIVER: 'local' };
const stateOf = (readiness, name) => readiness.describe().dependencies.find((d) => d.name === name).state;

describe('configured storage is initialised for real before the server listens', () => {
  it('reports resumeStorage ready — and /health/ready still answers the exact canonical 503 (B6 absent)', async () => {
    const handle = await start({ env: { ...withStorage, RESUME_STORAGE_LOCAL_ROOT: storageRoot } });
    expect(stateOf(handle.readiness, 'resumeStorage')).toBe('ready');
    expect(stateOf(handle.readiness, 'database')).toBe('ready');
    expect(stateOf(handle.readiness, 'notifications')).toBe('not_implemented');
    expect(handle.readiness.isReady()).toBe(false);

    const response = await request(`http://127.0.0.1:${handle.port}`).get('/api/v1/health/ready');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Service is not ready.' },
      meta: { requestId: expect.any(String) },
    });
    // The public response never names the dependency or the path.
    expect(response.text).not.toMatch(/resumeStorage|notifications|private-resumes/);

    // The storage really exists, privately, and holds no probe or object.
    expect(fs.statSync(path.join(storageRoot, 'resumes')).isDirectory()).toBe(true);
    expect(listFiles(storageRoot)).toEqual([]);
    expect(handle.resumeStorage.isReady).toBe(true);
    expect(fs.readdirSync(tempBase)).toHaveLength(1);
  });

  it('the Jobs API and liveness keep working exactly as in B3', async () => {
    const handle = await start({ env: { ...withStorage, RESUME_STORAGE_LOCAL_ROOT: storageRoot } });
    const live = await request(`http://127.0.0.1:${handle.port}`).get('/api/v1/health');
    expect(live.status).toBe(200);
    expect(live.body.data).toEqual({ status: 'ok' });
  });

  it('graceful shutdown closes the upload area (removing its directory) and the storage, and reports clean', async () => {
    const log = capturingLogger();
    const handle = await start({ env: { ...withStorage, RESUME_STORAGE_LOCAL_ROOT: storageRoot }, logger: log.logger });
    const leftover = handle.uploadArea.reserveFile();
    fs.writeFileSync(leftover.path, 'QA in-flight upload');
    handles.pop();
    const outcome = await handle.shutdown('SIGTERM');
    expect(outcome.clean).toBe(true);
    expect(outcome.dependencies.closed).toEqual(['uploadTemp', 'resumeStorage', 'mongodb']);
    expect(fs.readdirSync(tempBase)).toEqual([]);
    expect(handle.resumeStorage.isReady).toBe(false);
    expect(handle.readiness.isReady()).toBe(false);
    expect(log.output()).not.toContain(storageRoot);
    expect(log.output()).not.toContain(tempBase);
  });
});

describe('storage that does not work stops startup (no listening with broken storage)', () => {
  it('a root that is a file fails startup before the database is contacted', async () => {
    fs.writeFileSync(storageRoot, 'not a directory');
    const database = offlineDatabase();
    const error = await start({ env: { ...withStorage, RESUME_STORAGE_LOCAL_ROOT: storageRoot }, database }).catch((caught) => caught);
    expect(error).toBeInstanceOf(StorageInitializationError);
    expect(database.instance.connectCalls).toBe(0);
    expect(fs.readdirSync(tempBase)).toEqual([]);

    const line = formatStartupFailure(error);
    expect(line).toContain('the private resume storage could not be initialised (NOT_A_DIRECTORY)');
    expect(line).toContain('RESUME_STORAGE_LOCAL_ROOT');
    expect(line).not.toContain(storageRoot);
  });

  it('when the database then fails, the storage and upload area opened before it are closed', async () => {
    const database = offlineDatabase(fakeMongoose({ failConnect: true }));
    await expect(start({ env: { ...withStorage, RESUME_STORAGE_LOCAL_ROOT: storageRoot }, database })).rejects.toThrow();
    // The temporary upload area created during startup was removed again.
    expect(fs.readdirSync(tempBase)).toEqual([]);
  });

  it('when the upload area cannot be created, the storage is closed and startup fails', async () => {
    let storage;
    const factory = (args) => {
      storage = { isReady: true, init: async () => {}, close: async () => { storage.isReady = false; } };
      return storage;
    };
    const unwritable = path.join(root, 'missing', 'deeper');
    const port = await freePort();
    await expect(
      startServer({
        env: { NODE_ENV: 'test', APP_ENV: 'local', PORT: String(port), LOG_LEVEL: 'silent', MONGODB_URI: OFFLINE_TEST_MONGODB_URI },
        database: offlineDatabase(),
        storageFactory: factory,
        uploadTempBaseDirectory: unwritable,
      }),
    ).rejects.toThrow();
    expect(storage.isReady).toBe(false);
  });
});

describe('without storage configuration the dependency is reported truthfully', () => {
  it('local: resumeStorage unavailable (with a warning), the service still starts', async () => {
    const log = capturingLogger();
    const handle = await start({ logger: log.logger });
    expect(stateOf(handle.readiness, 'resumeStorage')).toBe('unavailable');
    expect(handle.resumeStorage).toBeNull();
    expect(handle.uploadArea).toBeNull();
    expect(fs.readdirSync(tempBase)).toEqual([]);
    expect(log.output()).toContain('private resume storage is not configured; applications cannot be accepted');
  });

  it('deployed (APP_ENV=review): resumeStorage not_implemented — the production provider arrives with C6', async () => {
    const handle = await start({ env: { APP_ENV: 'review', NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://review.valida.example' } });
    expect(stateOf(handle.readiness, 'resumeStorage')).toBe('not_implemented');
    const response = await request(`http://127.0.0.1:${handle.port}`).get('/api/v1/health/ready');
    expect(response.status).toBe(503);
  });

  it('production with the development driver never starts', async () => {
    await expect(
      start({
        env: {
          APP_ENV: 'production',
          NODE_ENV: 'production',
          CORS_ALLOWED_ORIGINS: 'https://valida.example',
          ...withStorage,
          RESUME_STORAGE_LOCAL_ROOT: storageRoot,
        },
      }),
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(fs.existsSync(storageRoot)).toBe(false);
  });
});
