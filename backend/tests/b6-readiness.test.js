import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { startServer, formatStartupFailure } from '../src/server.js';
import { freePort, fakeMongoose, offlineDatabase, OFFLINE_TEST_MONGODB_URI, capturingLogger } from './helpers.js';
import { makeTestRoot, removeTestRoot } from './fixtures/uploadHarness.js';
import { recordingTransport } from './fixtures/applyHarness.js';

/**
 * B6 — the notifications dependency in startup, readiness and shutdown
 * (Doc 09 sections 39-42; Doc 15 sections 117, 146 and 221).
 *
 * The HTTP lifecycle and readiness run for real; MongoDB is the offline
 * stand-in (tests/helpers.js) and storage is real local storage. A transport
 * is INJECTED through startServer's test seam: this proves how readiness
 * follows the transport's verify(), and NOTHING about a real provider — an
 * injected transport is not production readiness evidence (Doc 15 section
 * 146; Doc 17 section 388). Production has no transport in B6 r1 (provider
 * AWAITING INPUT), so it reports `not_implemented` and answers 503.
 */
let root;
const handles = [];

beforeEach(() => {
  root = makeTestRoot();
  fs.mkdirSync(path.join(root, 'tmp'));
});

afterEach(async () => {
  while (handles.length) await handles.pop().shutdown('test cleanup');
  removeTestRoot(root);
});

async function start({ transport, env = {}, logger } = {}) {
  const port = await freePort();
  const handle = await startServer({
    env: {
      NODE_ENV: 'test',
      APP_ENV: 'local',
      PORT: String(port),
      LOG_LEVEL: 'silent',
      MONGODB_URI: OFFLINE_TEST_MONGODB_URI,
      RESUME_STORAGE_DRIVER: 'local',
      RESUME_STORAGE_LOCAL_ROOT: path.join(root, 'private-resumes'),
      NOTIFICATION_TIMEOUT_MS: '200',
      RECRUITMENT_NOTIFICATION_RECIPIENT: 'recruitment@qa-valida.example.test',
      TRANSACTIONAL_FROM_ADDRESS: 'careers@notify.qa-valida.example.test',
      ...env,
    },
    database: offlineDatabase(),
    logger,
    uploadTempBaseDirectory: path.join(root, 'tmp'),
    ...(transport === undefined ? {} : { notificationTransportFactory: () => transport }),
  });
  handles.push(handle);
  return { ...handle, port };
}

const stateOf = (handle) => handle.readiness.describe().dependencies.find((d) => d.name === 'notifications').state;
const ready = (handle) => request(`http://127.0.0.1:${handle.port}`).get('/api/v1/health/ready');

describe('readiness follows the notification dependency truthfully', () => {
  it('no provider (production composition today): not_implemented, and /health/ready is 503 although everything else is ready', async () => {
    const log = capturingLogger();
    const handle = await start({ logger: log.logger });
    expect(stateOf(handle)).toBe('not_implemented');
    for (const name of ['configuration', 'database', 'resumeStorage']) {
      expect(handle.readiness.describe().dependencies.find((d) => d.name === name).state).toBe('ready');
    }
    const response = await ready(handle);
    expect(response.status).toBe(503);
    expect(response.text).not.toMatch(/notifications|provider|email/i);
    expect(log.output()).toMatch(/no transactional email provider is configured \(AWAITING INPUT\)/);
  });

  it('an injected transport that verifies (TEST DOUBLE): ready only after verify() succeeded; /health/ready 200', async () => {
    const transport = recordingTransport('accept', { verify: 'ok' });
    const handle = await start({ transport });
    expect(transport.verifyCalls).toBe(1);
    expect(stateOf(handle)).toBe('ready');
    expect(handle.readiness.isReady()).toBe(true);
    expect((await ready(handle)).status).toBe(200);
    // Readiness is not an email: verification sends nothing.
    expect(transport.calls).toHaveLength(0);
  });

  it.each([
    ['refused credentials', 'PROVIDER_AUTH_FAILED', 'PROVIDER_AUTH_FAILED'],
    ['an unverified sender', 'SENDER_NOT_VERIFIED', 'SENDER_NOT_VERIFIED'],
    ['an unclassified error (its text is never logged)', new Error('raw provider text secret-QA'), 'PROVIDER_ERROR'],
    ['a verification that hangs (bounded)', 'hang', 'TIMEOUT'],
    ['a transport that cannot be verified at all', null, 'NOT_VERIFIABLE'],
  ])('verification fails with %s: unavailable, 503, a fixed reason logged', async (_label, verify, reason) => {
    const log = capturingLogger();
    const started = Date.now();
    const handle = await start({ transport: recordingTransport('accept', { verify }), logger: log.logger });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(stateOf(handle)).toBe('unavailable');
    expect((await ready(handle)).status).toBe(503);
    const [entry] = log
      .output()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((line) => line.dependency === 'notifications' && line.reason);
    expect(entry.reason).toBe(reason);
    expect(log.output()).not.toContain('secret-QA');
  });

  it('graceful shutdown closes the transport', async () => {
    let closed = 0;
    const transport = { ...recordingTransport('accept'), close: async () => (closed += 1) };
    const handle = await start({ transport });
    handles.pop();
    const outcome = await handle.shutdown('SIGTERM');
    expect(outcome.clean).toBe(true);
    expect(outcome.dependencies.closed).toContain('notifications');
    expect(closed).toBe(1);
  });
});

/*
 * r2 (GPT review finding 2): the notification initialisation runs after the
 * storage, the temporary upload area and the database connection were
 * opened. A failure there must run the registered cleanup — once, within the
 * startup cleanup deadline — and reject with the ORIGINAL error.
 */
describe('a failure while initialising notifications runs the startup cleanup (r2)', () => {
  const FACTORY_ERROR = 'qa transport factory failure qa-secret-marker';

  async function failingStart({ database = offlineDatabase(fakeMongoose()), factory, cleanupTimeoutMs = 2_000, wrapLogger = (logger) => logger } = {}) {
    const log = capturingLogger();
    const thrown = new Error(FACTORY_ERROR);
    const started = Date.now();
    const error = await startServer({
      env: {
        NODE_ENV: 'test',
        APP_ENV: 'local',
        PORT: String(await freePort()),
        LOG_LEVEL: 'silent',
        MONGODB_URI: OFFLINE_TEST_MONGODB_URI,
        RESUME_STORAGE_DRIVER: 'local',
        RESUME_STORAGE_LOCAL_ROOT: path.join(root, 'private-resumes'),
      },
      database,
      logger: wrapLogger(log.logger),
      uploadTempBaseDirectory: path.join(root, 'tmp'),
      cleanupTimeoutMs,
      notificationTransportFactory:
        factory ??
        (() => {
          throw thrown;
        }),
    }).then(
      () => null,
      (caught) => caught,
    );
    const entries = log
      .output()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { error, thrown, elapsedMs: Date.now() - started, database, entries, output: log.output() };
  }
  const dependencyEvents = (entries, message) => entries.filter((entry) => entry.msg === message).map((entry) => entry.dependency);

  it('a throwing transport factory: rejects with the ORIGINAL error; the database is disconnected once; the real temporary upload directory is removed; storage closed', async () => {
    const { error, thrown, database, entries, output } = await failingStart();
    expect(error).toBe(thrown);
    expect(database.instance.connectCalls).toBe(1);
    expect(database.instance.connection.closeCalls).toBe(1);
    expect(fs.readdirSync(path.join(root, 'tmp'))).toEqual([]);
    expect(dependencyEvents(entries, 'dependency closed')).toEqual(['uploadTemp', 'resumeStorage', 'mongodb']);
    // The private storage root exists and holds no object or probe.
    expect(fs.readdirSync(path.join(root, 'private-resumes', 'resumes'))).toEqual([]);
    // Safe startup formatting: the error's message is never printed.
    expect(formatStartupFailure(error)).toMatch(/^\[valida-backend\] failed to start: Error\. Detail is withheld/);
    expect(formatStartupFailure(error)).not.toContain('qa-secret-marker');
    expect(output).not.toContain('qa-secret-marker');
  });

  it('a transport that was created is closed too, when a LATER initialisation step fails (fault injected into the readiness log line)', async () => {
    let closed = 0;
    const transport = { ...recordingTransport('accept', { verify: 'PROVIDER_AUTH_FAILED' }), close: async () => (closed += 1) };
    const { error, entries } = await failingStart({
      factory: () => transport,
      // The step after the transport exists is made to throw: logging the failed verification.
      wrapLogger: (logger) => {
        const wrapped = Object.create(logger);
        wrapped.error = function error(object, message) {
          if (message === 'the transactional email provider could not be verified') throw new Error(FACTORY_ERROR);
          return logger.error(object, message);
        };
        return wrapped;
      },
    });
    expect(error?.message).toBe(FACTORY_ERROR);
    expect(closed).toBe(1);
    expect(dependencyEvents(entries, 'dependency closed')).toEqual(['uploadTemp', 'resumeStorage', 'mongodb', 'notifications']);
    expect(fs.readdirSync(path.join(root, 'tmp'))).toEqual([]);
  });

  it('a logger that throws while the cleanup reports: every hook still runs and the ORIGINAL error is kept (r2 re-review)', async () => {
    const { error, thrown, database } = await failingStart({
      wrapLogger: (logger) => {
        const wrapped = Object.create(logger);
        wrapped.info = function info(object, message) {
          if (message === 'dependency closed') throw new Error('qa logger failure');
          return logger.info(object, message);
        };
        return wrapped;
      },
    });
    expect(error).toBe(thrown);
    expect(database.instance.connection.closeCalls).toBe(1);
    expect(fs.readdirSync(path.join(root, 'tmp'))).toEqual([]);
  });

  it('a database close that REJECTS during the cleanup: still the original error; the other dependencies are closed; the failure is logged safely', async () => {
    const database = offlineDatabase(fakeMongoose());
    database.instance.connection.close = async () => {
      throw new Error('qa close failure mongodb://qa-user:qa-password@127.0.0.1');
    };
    const { error, thrown, entries, output } = await failingStart({ database });
    expect(error).toBe(thrown);
    expect(fs.readdirSync(path.join(root, 'tmp'))).toEqual([]);
    expect(dependencyEvents(entries, 'dependency closed')).toEqual(['uploadTemp', 'resumeStorage']);
    expect(dependencyEvents(entries, 'dependency failed to close')).toEqual(['mongodb']);
    expect(output).not.toMatch(/qa-password|qa-user/);
  });

  it('a database close that HANGS during the cleanup: bounded by cleanupTimeoutMs, still the original error', async () => {
    const database = offlineDatabase(fakeMongoose());
    database.instance.connection.close = () => new Promise(() => {});
    const { error, thrown, elapsedMs, entries } = await failingStart({ database, cleanupTimeoutMs: 300 });
    expect(error).toBe(thrown);
    expect(elapsedMs).toBeLessThan(3_000);
    expect(fs.readdirSync(path.join(root, 'tmp'))).toEqual([]);
    expect(dependencyEvents(entries, 'dependency close timed out')).toEqual(['mongodb']);
  });
});
