import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import request from 'supertest';
import { syntheticPdf, PDF_MIME } from './fixtures/resumeFiles.js';
import { QA_TEXT_QUESTION_ID, applyRequest, createApplyEnvironment, qaAnswers } from './fixtures/applyHarness.js';
import { QA_MONITOR_KEY, closedPortDsn, startMonitoringReceiver } from './fixtures/monitoringReceiver.js';
import { MONITORING_DSN_VARIABLE, describeErrorMonitoring, resolveErrorMonitoring } from '../src/config/errorMonitoring.js';
import {
  REPOSITORY_ROOT,
  createErrorMonitor,
  framesFromError,
  installCrashCapture,
  rebuildSafeEvent,
  safeFilename,
  sendOperatorTestEvent,
} from '../src/lib/monitoring/errorMonitor.js';
import { SENTRY_SDK } from '../src/lib/monitoring/sentrySdk.js';
import { ConfigurationError, loadConfig } from '../src/config/env.js';
import { formatStartupFailure, startServer } from '../src/server.js';
import { OFFLINE_TEST_MONGODB_URI, buildApp, capturingLogger, freePort, offlineDatabase } from './helpers.js';

/**
 * C6-T6 — error monitoring (D-4a: Sentry; C6 plan r3 §4.5; Doc 13 §213;
 * Doc 17 §407: "Trigger synthetic error. Verify provider does not capture
 * prohibited sensitive values").
 *
 * The receiver is a local HTTP stand-in for Sentry's ingest endpoint; the
 * SDK, its transport and the serialisation are the real ones. Every
 * assertion about content is made on the BYTES the receiver got.
 */
const SHA = '4c1f0e9a2b3d5e6f708192a3b4c5d6e7f8091a2b';

// Synthetic markers, one per category the owner named.
const MARK = Object.freeze({
  applicantName: 'QaMarkerApplicantNameZx41',
  applicantEmail: 'qa.marker.applicant.zx41@example.test',
  resumeBytes: 'QA-MARKER-RESUME-BYTES-ZX41',
  resumeFilename: 'qa-marker-resume-zx41.pdf',
  resumeKey: 'resumes/qamarkerkeyzx41',
  credential: 'mongodb+srv://qa-marker-user:QA-MARKER-PASSWORD-ZX41@qa-cluster.example.test',
  cookie: 'QA-MARKER-COOKIE-ZX41',
  authorization: 'QA-MARKER-AUTHORIZATION-ZX41',
  query: 'QA-MARKER-QUERY-ZX41',
  requestId: 'QA-MARKER-REQUEST-ID-ZX41',
  answer: 'QA-MARKER-ANSWER-ZX41',
  errorProperty: 'QA-MARKER-ERROR-PROPERTY-ZX41',
  cause: 'QA-MARKER-CAUSE-ZX41',
});
const ALL_MARKERS = Object.values(MARK);

function expectNoMarker(text) {
  for (const marker of ALL_MARKERS) expect(text).not.toContain(marker);
  // No absolute path of this machine either.
  expect(text).not.toContain(REPOSITORY_ROOT);
}

/** The failure the application meets: a defect whose text carries everything it should not. */
function poisonedError() {
  const error = new TypeError(
    `cannot read eligibility for ${MARK.applicantName} <${MARK.applicantEmail}> key=${MARK.resumeKey} via ${MARK.credential}`,
    { cause: new Error(MARK.cause) },
  );
  error.config = { password: MARK.credential, cookie: MARK.cookie };
  error.detail = MARK.errorProperty;
  return error;
}

const enabled = (dsn, appEnv = 'local') => resolveErrorMonitoring({ dsn, appEnv, nodeEnv: 'test' });
const release = { ok: true, sha: SHA, state: 'configured' };

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

async function receiver(options) {
  const r = await startMonitoringReceiver(options);
  cleanups.push(() => r.close());
  return r;
}

function monitorFor(dsn, { logger, environment = 'local', sha = release, deliveryTimeoutMs } = {}) {
  const monitor = createErrorMonitor({ monitoring: enabled(dsn), release: sha, environment, service: 'valida-api', sdk: SENTRY_SDK, logger, deliveryTimeoutMs });
  cleanups.push(() => monitor.close(1_000));
  return monitor;
}

describe('configuration (SENTRY_DSN)', () => {
  const valid = `https://${QA_MONITOR_KEY}@o0.ingest.de.sentry.io/4500000000000001`;
  const loopback = `http://${QA_MONITOR_KEY}@127.0.0.1:9/7`;

  it.each([
    ['absent', undefined, 'local', { ok: true, state: 'disabled' }],
    ['empty', '', 'production', { ok: true, state: 'disabled' }],
    ['https', valid, 'production', { ok: true, state: 'enabled', transport: 'https' }],
    ['https in review', valid, 'review', { ok: true, state: 'enabled', transport: 'https' }],
    ['loopback http, local', loopback, 'local', { ok: true, state: 'enabled', transport: 'loopback-http' }],
  ])('%s', (_label, dsn, appEnv, expected) => {
    expect({ ...resolveErrorMonitoring({ dsn, appEnv, nodeEnv: 'test' }) }).toEqual(expected);
  });

  it.each([
    ['loopback http in review', loopback, 'review', 'test'],
    ['loopback http in production', loopback, 'production', 'production'],
    ['loopback http with NODE_ENV=production', loopback, 'local', 'production'],
    ['http to a non-loopback host', `http://${QA_MONITOR_KEY}@ingest.example.test/7`, 'local', 'test'],
    ['a password (legacy secret key)', `https://${QA_MONITOR_KEY}:QA-SECRET@o0.ingest.example.test/7`, 'production', 'production'],
    ['a query', `${valid}?token=QA`, 'production', 'production'],
    ['a fragment', `${valid}#x`, 'production', 'production'],
    ['no public key', 'https://o0.ingest.example.test/7', 'production', 'production'],
    ['a public key of the wrong form', 'https://QA-NOT-A-KEY@o0.ingest.example.test/7', 'production', 'production'],
    ['a non-numeric project', `https://${QA_MONITOR_KEY}@o0.ingest.example.test/project`, 'production', 'production'],
    ['an extra path segment', `https://${QA_MONITOR_KEY}@o0.ingest.example.test/api/7`, 'production', 'production'],
    ['another scheme', `ftp://${QA_MONITOR_KEY}@o0.ingest.example.test/7`, 'production', 'production'],
    ['not a URL', 'QA-NOT-A-DSN', 'local', 'test'],
    ['surrounding space', ` ${valid}`, 'production', 'production'],
  ])('refused: %s', (_label, dsn, appEnv, nodeEnv) => {
    expect(resolveErrorMonitoring({ dsn, appEnv, nodeEnv })).toEqual({ ok: false, variable: MONITORING_DSN_VARIABLE, rule: expect.any(String) });
  });

  it('the DSN is not enumerable: it is in no serialised view; the start-up line holds no part of it', () => {
    const monitoring = resolveErrorMonitoring({ dsn: valid, appEnv: 'production', nodeEnv: 'production' });
    expect(monitoring.dsn).toBe(valid);
    expect(JSON.stringify(monitoring)).not.toContain(QA_MONITOR_KEY);
    expect(JSON.stringify(describeErrorMonitoring(monitoring))).toBe('{"errorMonitoring":"enabled","errorMonitoringTransport":"https"}');
    expect(describeErrorMonitoring(resolveErrorMonitoring({}))).toEqual({ errorMonitoring: 'disabled', errorMonitoringTransport: null });
  });

  it('loadConfig: malformed refuses start-up naming SENTRY_DSN, never the value; the config serialises without the DSN', () => {
    const base = { NODE_ENV: 'test', APP_ENV: 'local', MONGODB_URI: OFFLINE_TEST_MONGODB_URI };
    const error = (() => {
      try {
        loadConfig({ ...base, SENTRY_DSN: 'https://QA-NOT-A-KEY@qa.example.test/x' });
      } catch (caught) {
        return caught;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error.message).toContain('SENTRY_DSN');
    expect(error.message).not.toContain('QA-NOT-A-KEY');
    const config = loadConfig({ ...base, SENTRY_DSN: loopback });
    expect(config.monitoring.state).toBe('enabled');
    expect(JSON.stringify(config)).not.toContain(QA_MONITOR_KEY);
    expect(loadConfig(base).monitoring.state).toBe('disabled');
  });
});

describe('the event allowlist', () => {
  it('rebuildSafeEvent keeps only the allowlisted fields, whatever an event carries', () => {
    const hostile = {
      event_id: 'a'.repeat(32),
      timestamp: 1,
      level: 'error',
      server_name: 'valida-api',
      release: SHA,
      environment: 'local',
      sdk: { name: 'sentry.javascript.core', version: '11.10.0', integrations: [MARK.cookie] },
      tags: { service: 'valida-api', kind: 'request', status: '500', request_id: MARK.requestId, email: MARK.applicantEmail },
      request: { url: `https://api.example.test/?t=${MARK.query}`, headers: { cookie: MARK.cookie, authorization: MARK.authorization }, data: MARK.resumeBytes },
      user: { email: MARK.applicantEmail, ip_address: '203.0.113.9' },
      extra: { body: MARK.applicantName },
      breadcrumbs: [{ message: MARK.answer }],
      contexts: { runtime: { name: 'node', version: 'v24.21.0' }, trace: { trace_id: 'x' }, os: { name: MARK.credential } },
      fingerprint: [MARK.resumeKey],
      modules: { [MARK.resumeFilename]: '1' },
      exception: {
        values: [
          {
            type: 'TypeError',
            value: `${MARK.applicantName} ${MARK.credential}`,
            mechanism: { type: 'generic', handled: true, data: { cookie: MARK.cookie } },
            stacktrace: {
              frames: [
                { filename: path.join(REPOSITORY_ROOT, 'backend', 'src', 'app.js'), function: 'handle', lineno: 3, colno: 4, context_line: MARK.answer, vars: { email: MARK.applicantEmail }, abs_path: REPOSITORY_ROOT },
                { filename: '/somewhere/else.js', function: `fn ${MARK.applicantEmail}`, lineno: 1 },
              ],
            },
          },
          { type: 'Error', value: MARK.cause },
        ],
      },
    };
    const safe = rebuildSafeEvent(hostile);
    expectNoMarker(JSON.stringify(safe));
    expect(safe).toEqual({
      event_id: 'a'.repeat(32),
      timestamp: 1,
      platform: 'node',
      level: 'error',
      server_name: 'valida-api',
      release: SHA,
      environment: 'local',
      sdk: { name: 'sentry.javascript.core', version: '11.10.0' },
      tags: { service: 'valida-api', kind: 'request', status: '500' },
      contexts: { runtime: { name: 'node', version: 'v24.21.0' } },
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'Unexpected TypeError',
            mechanism: { type: 'valida.request', handled: true },
            stacktrace: {
              frames: [
                { filename: 'app:///backend/src/app.js', lineno: 3, colno: 4, in_app: true },
                { filename: '<outside>', lineno: 1, in_app: false },
              ],
            },
          },
        ],
      },
    });
  });

  it('a message cannot forge a stack frame; a changed message or name drops every frame; frames carry no text', () => {
    const parser = SENTRY_SDK.createStackParser(SENTRY_SDK.nodeStackLineParser());
    const forged = new Error(`ok\n    at ${MARK.applicantName} (${path.join(REPOSITORY_ROOT, MARK.resumeFilename)}:1:1)`);
    const frames = framesFromError(forged, parser);
    expect(frames.length).toBeGreaterThan(0);
    expectNoMarker(JSON.stringify(frames));
    // V8 formats the stack lazily: a message changed before the first read is
    // part of the header, so it is still removed whole.
    const lazy = new Error('x');
    lazy.message = `x\n    at ${MARK.applicantName} (${path.join(REPOSITORY_ROOT, 'f.js')}:1:1)`;
    expect(framesFromError(lazy, parser).length).toBeGreaterThan(0);
    expectNoMarker(JSON.stringify(framesFromError(lazy, parser)));
    // Changed after the stack was formatted: the header no longer matches — no frame.
    const renamed = new Error('x');
    void renamed.stack;
    renamed.message = MARK.applicantEmail;
    expect(framesFromError(renamed, parser)).toEqual([]);
    const relabelled = new Error('x');
    void relabelled.stack;
    relabelled.name = MARK.credential;
    expect(framesFromError(relabelled, parser)).toEqual([]);
    // Even a stack replaced by hand cannot carry text: a frame has no function
    // name, and only a file that exists in the repository is named.
    const replaced = new Error('x');
    replaced.stack = `Error: x\n    at ${MARK.applicantName} (${path.join(REPOSITORY_ROOT, `${MARK.resumeFilename}`)}:1:1)`;
    expect(framesFromError(replaced, parser)).toEqual([{ filename: '<unknown>', lineno: 1, colno: 1, in_app: false }]);
  });

  it('file names: repository-relative, node: built-ins kept, anything else a placeholder', () => {
    expect(safeFilename(path.join(REPOSITORY_ROOT, 'frontend', 'server', 'documentServer.js'))).toBe('app:///frontend/server/documentServer.js');
    expect(safeFilename(`file://${path.join(REPOSITORY_ROOT, 'backend', 'src', 'app.js')}`)).toBe('app:///backend/src/app.js');
    expect(safeFilename(path.join(REPOSITORY_ROOT, 'backend', 'src', 'qa-absent.js'))).toBe('<unknown>');
    expect(safeFilename('node:internal/process/task_queues')).toBe('node:internal/process/task_queues');
    expect(safeFilename('/etc/passwd')).toBe('<outside>');
    expect(safeFilename('relative.js')).toBe('<unknown>');
    expect(safeFilename(path.join(REPOSITORY_ROOT, `x ${MARK.applicantName}?.js`))).toBe('<unknown>');
  });
});

describe('the API: a representative unexpected failure, through the real error handler, SDK and transport', () => {
  async function poisonedSubmission({ monitor, requestId = MARK.requestId } = {}) {
    const env = await createApplyEnvironment({ errorMonitor: monitor });
    cleanups.push(() => env.cleanup());
    env.jobs.beforeEligibility = async () => {
      throw poisonedError();
    };
    const pdf = syntheticPdf({ text: `QA TEST DOCUMENT ${MARK.resumeBytes}` });
    let call = applyRequest(env.app, {
      fields: { fullName: MARK.applicantName, email: MARK.applicantEmail },
      answers: qaAnswers().map((answer) => (answer.questionId === QA_TEXT_QUESTION_ID ? { ...answer, answer: MARK.answer } : answer)),
      resume: { data: pdf, filename: MARK.resumeFilename, contentType: PDF_MIME },
    });
    // supertest builds the URL from the path; the query and headers are added here.
    call.url = `${call.url}?token=${MARK.query}&email=${encodeURIComponent(MARK.applicantEmail)}`;
    call = call.set('Cookie', `session=${MARK.cookie}`).set('Authorization', `Bearer ${MARK.authorization}`);
    if (requestId) call = call.set('X-Request-ID', requestId);
    const response = await call;
    return { env, response };
  }

  it('one event; release SHA, environment, service; no applicant, résumé, key, credential, cookie, authorization, URL or request field', async () => {
    const r = await receiver();
    const log = capturingLogger();
    const monitor = monitorFor(r.dsn, { logger: log.logger });
    const { env, response } = await poisonedSubmission({ monitor });

    // The application outcome is the accepted one: a generic 500, nothing stored.
    expect(response.body).toMatchObject({ success: false });
    expect(response.status).toBe(500);
    expect(response.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred. Please try again.' });
    expect(env.applications.all()).toEqual([]);

    await monitor.flush(2_000);
    expect(r.requests).toHaveLength(1);
    const [event] = r.events();
    expect(event).toMatchObject({
      level: 'error',
      platform: 'node',
      release: SHA,
      environment: 'local',
      server_name: 'valida-api',
      tags: { service: 'valida-api', kind: 'request', status: '500' },
    });
    expect(event.tags.request_id).toBeUndefined(); // a client-supplied, non-UUID id is not sent
    expect(event.exception.values).toHaveLength(1);
    expect(event.exception.values[0]).toMatchObject({ type: 'TypeError', value: 'Unexpected TypeError', mechanism: { type: 'valida.request', handled: true } });
    const frames = event.exception.values[0].stacktrace.frames;
    expect(frames.some((frame) => frame.filename === 'app:///backend/tests/c6-t6-error-monitoring.test.js' && frame.in_app)).toBe(true);
    for (const frame of frames) {
      expect(Object.keys(frame).every((key) => ['filename', 'lineno', 'colno', 'in_app'].includes(key))).toBe(true);
      expect(frame.filename).toMatch(/^(?:app:\/\/\/|node:|<outside>$|<unknown>$)/);
    }
    // The application's own frames are there, located by file and line.
    expect(frames.some((frame) => frame.filename === 'app:///backend/src/modules/applications/application.submission.js' || frame.filename.startsWith('app:///backend/src/'))).toBe(true);
    expect(Object.keys(event).sort()).toEqual(['contexts', 'environment', 'event_id', 'exception', 'level', 'platform', 'release', 'server_name', 'tags', 'timestamp']);

    // The serialized payload — every byte the receiver got.
    const raw = r.raw();
    expectNoMarker(raw);
    expect(raw).not.toMatch(/resumes\/[0-9a-f]{32}/);
    expect(raw).not.toContain('Bearer');
    expect(raw.toLowerCase()).not.toContain('"cookie"');
    expect(raw).not.toMatch(/"request":\{/);
    expect(raw).not.toMatch(/"user":/);
    expect(raw).not.toContain('breadcrumbs');
    // Nor does the log (unchanged B1/B7 rule) — except the client's own
    // X-Request-ID, which the accepted B1 middleware echoes as reqId when it
    // has the allowed form. The monitor is stricter: only a UUID is sent.
    const logText = env.log.output().split(MARK.requestId).join('');
    expectNoMarker(logText);
  });

  it('a server-generated (UUID) request id is sent, so the event correlates with the log line and the client response', async () => {
    const r = await receiver();
    const monitor = monitorFor(r.dsn);
    const { response } = await poisonedSubmission({ monitor, requestId: null });
    await monitor.flush(2_000);
    const [event] = r.events();
    expect(event.tags.request_id).toBe(response.body.meta.requestId);
    expect(response.headers['x-request-id']).toBe(event.tags.request_id);
  });

  it('handled outcomes are not sent: 404, 400 and a refused submission', async () => {
    const r = await receiver();
    const monitor = monitorFor(r.dsn);
    const app = buildApp({ errorMonitor: monitor });
    expect((await request(app).get('/api/v1/qa-unknown')).status).toBe(404);
    expect((await request(app).post('/api/v1/jobs/qa-x/applications').set('Content-Type', 'application/json').send('{')).status).toBeGreaterThanOrEqual(400);
    await monitor.flush(1_000);
    expect(r.requests).toHaveLength(0);
  });
});

describe('disabled and unavailable monitoring change no outcome', () => {
  it('disabled (no SENTRY_DSN): the same 500, nothing sent anywhere', async () => {
    const r = await receiver();
    const monitor = createErrorMonitor({ monitoring: resolveErrorMonitoring({}), release, environment: 'local', service: 'valida-api', sdk: SENTRY_SDK });
    expect(monitor.state).toBe('disabled');
    const env = await createApplyEnvironment({ errorMonitor: monitor });
    cleanups.push(() => env.cleanup());
    env.jobs.beforeEligibility = async () => {
      throw poisonedError();
    };
    const response = await applyRequest(env.app);
    expect(response.status).toBe(500);
    expect(await monitor.flush()).toBe(true);
    expect(r.requests).toHaveLength(0);
    expect(await sendOperatorTestEvent(monitor)).toEqual({ sent: false, reason: 'disabled' });
  });

  it.each([
    ['nothing listening', async () => closedPortDsn()],
    ['a receiver that never answers', async () => (await receiver({ behaviour: 'hang' })).dsn],
    ['a receiver that refuses (HTTP 503)', async () => (await receiver({ behaviour: { status: 503 } })).dsn],
  ])('unavailable — %s: the response is the same and prompt; one bounded attempt; one fixed warning', async (label, dsnFor) => {
    const dsn = await dsnFor();
    const log = capturingLogger();
    const monitor = monitorFor(dsn, { logger: log.logger, deliveryTimeoutMs: 300 });
    const env = await createApplyEnvironment({ errorMonitor: monitor });
    cleanups.push(() => env.cleanup());
    env.jobs.beforeEligibility = async () => {
      throw poisonedError();
    };
    const started = Date.now();
    const first = await applyRequest(env.app);
    const second = await applyRequest(env.app);
    expect(first.status).toBe(500);
    expect(second.status).toBe(500);
    expect(Date.now() - started).toBeLessThan(2_000);
    await monitor.flush(2_000);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const delivery = monitor.delivery();
    expect(delivery.delivered).toBe(0);
    expect(delivery.failed).toBeGreaterThanOrEqual(1);
    const warnings = log
      .output()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.errorMonitorDelivery === 'failing');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toBe(label.startsWith('nothing') ? 'unreachable' : label.includes('never') ? 'timeout' : 'status');
    const text = log.output();
    expect(text).not.toContain(QA_MONITOR_KEY);
    expect(text).not.toMatch(/127\.0\.0\.1:\d+/);
    expectNoMarker(text);
  });
});

describe('start-up (startServer) with monitoring', () => {
  const started = [];
  afterEach(async () => {
    while (started.length) await started.pop().shutdown('test cleanup');
  });
  const baseEnv = async () => ({
    NODE_ENV: 'test',
    APP_ENV: 'local',
    PORT: String(await freePort()),
    LOG_LEVEL: 'silent',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
    MONGODB_URI: OFFLINE_TEST_MONGODB_URI,
    RENDER_GIT_COMMIT: SHA,
  });
  const lines = (log) =>
    log
      .output()
      .split('\n')
      .filter(Boolean)
      .map((text) => JSON.parse(text));

  it('enabled: starts, states it in one line without the DSN; health and readiness answer as before', async () => {
    const r = await receiver();
    const log = capturingLogger();
    const env = { ...(await baseEnv()), SENTRY_DSN: r.dsn };
    const handle = await startServer({ env, database: offlineDatabase(), logger: log.logger });
    started.push(handle);
    expect((await fetch(`http://127.0.0.1:${env.PORT}/api/v1/health`)).status).toBe(200);
    expect(lines(log).find((entry) => entry.msg === 'error monitoring')).toMatchObject({ errorMonitoring: 'enabled', errorMonitoringTransport: 'loopback-http' });
    expect(log.output()).not.toContain(QA_MONITOR_KEY);
    expect(handle.errorMonitor.state).toBe('enabled');
    // The operator's test event (plan §8.5) through the running process's monitor.
    const result = await sendOperatorTestEvent(handle.errorMonitor);
    expect(result).toMatchObject({ sent: true, delivered: true });
    const [event] = r.events();
    expect(event).toMatchObject({ level: 'info', release: SHA, environment: 'local', server_name: 'valida-api', tags: { kind: 'operator_test' } });
    expect(event.exception.values[0].value).toBe('Operator test event (contains no application data)');
    expect(r.requests).toHaveLength(1);
  });

  it('disabled (absent): ordinary start-up is unchanged; the line says disabled', async () => {
    const log = capturingLogger();
    const env = await baseEnv();
    const handle = await startServer({ env, database: offlineDatabase(), logger: log.logger });
    started.push(handle);
    expect((await fetch(`http://127.0.0.1:${env.PORT}/api/v1/health`)).status).toBe(200);
    expect(lines(log).find((entry) => entry.msg === 'error monitoring')).toMatchObject({ errorMonitoring: 'disabled', errorMonitoringTransport: null });
  });

  it('unreachable receiver: start-up is unchanged (nothing is sent at start-up)', async () => {
    const log = capturingLogger();
    const env = { ...(await baseEnv()), SENTRY_DSN: await closedPortDsn() };
    const handle = await startServer({ env, database: offlineDatabase(), logger: log.logger });
    started.push(handle);
    expect((await fetch(`http://127.0.0.1:${env.PORT}/api/v1/health`)).status).toBe(200);
  });

  it('malformed: refused before any database connection or socket; the failure names SENTRY_DSN, never the value', async () => {
    const database = offlineDatabase();
    const env = { ...(await baseEnv()), SENTRY_DSN: `http://${QA_MONITOR_KEY}@qa-remote.example.test/7` };
    const error = await startServer({ env, database }).catch((caught) => caught);
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(database.instance.connectCalls).toBe(0);
    const text = formatStartupFailure(error);
    expect(text).toContain('SENTRY_DSN');
    expect(text).not.toContain(QA_MONITOR_KEY);
    expect(text).not.toContain('qa-remote.example.test');
    await expect(fetch(`http://127.0.0.1:${env.PORT}/api/v1/health`)).rejects.toThrow();
  });
});

describe('process-level capture (installCrashCapture)', () => {
  it('an uncaught exception: logged by classification, captured as fatal, flushed, then exit 1', async () => {
    const r = await receiver();
    const log = capturingLogger();
    const monitor = monitorFor(r.dsn, { logger: log.logger });
    const listeners = {};
    const processRef = { on: (name, fn) => (listeners[name] = fn) };
    const exited = new Promise((resolve) => installCrashCapture({ monitor, logger: log.logger }, { processRef, exit: resolve }));
    listeners.uncaughtException(poisonedError());
    expect(await exited).toBe(1);
    const [event] = r.events();
    expect(event).toMatchObject({ level: 'fatal', release: SHA, tags: { kind: 'uncaught' } });
    expect(event.exception.values[0]).toMatchObject({ type: 'TypeError', value: 'Unexpected TypeError', mechanism: { type: 'valida.uncaught', handled: false } });
    expectNoMarker(r.raw());
    expectNoMarker(log.output());
    expect(log.output()).toContain('uncaught exception');
  });

  it('a non-Error throw is classified by typeof only', async () => {
    const r = await receiver();
    const monitor = monitorFor(r.dsn);
    monitor.captureUnexpected(`${MARK.applicantEmail}`, { kind: 'request', status: 500, requestId: randomUUID() });
    await monitor.flush(2_000);
    const [event] = r.events();
    expect(event.exception.values[0]).toMatchObject({ type: 'non-error:string', value: 'Unexpected non-error:string' });
    expect(event.exception.values[0].stacktrace).toBeUndefined();
    expectNoMarker(r.raw());
  });
});

describe('the operator test-event command (plan §8.5)', () => {
  const script = path.join(REPOSITORY_ROOT, 'backend', 'scripts', 'monitoring-test-event.mjs');
  function run(env) {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [script], { env: { PATH: process.env.PATH, APP_ENV: 'local', NODE_ENV: 'test', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk) => (out += chunk));
      child.stderr.on('data', (chunk) => (err += chunk));
      child.on('exit', (code) => resolve({ code, out, err }));
    });
  }

  it('delivered: exit 0; one event with the release; the output names no DSN', async () => {
    const r = await receiver();
    const result = await run({ SENTRY_DSN: r.dsn, RENDER_GIT_COMMIT: SHA });
    expect(result.code).toBe(0);
    const line = JSON.parse(result.out.trim());
    expect(line).toMatchObject({ service: 'valida-api', environment: 'local', release: SHA, sent: true, delivered: true, receiver: { delivered: true, status: 200 } });
    expect(result.out + result.err).not.toContain(QA_MONITOR_KEY);
    expect(r.events()).toHaveLength(1);
    expect(r.events()[0]).toMatchObject({ release: SHA, server_name: 'valida-api', tags: { kind: 'operator_test' } });
  });

  it('not delivered (nothing listening): exit 1, reason stated', async () => {
    const result = await run({ SENTRY_DSN: await closedPortDsn(), RENDER_GIT_COMMIT: SHA });
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out.trim())).toMatchObject({ sent: true, delivered: false, receiver: { delivered: false, reason: 'unreachable' } });
  });

  it('disabled: exit 1, nothing sent; malformed: exit 2 naming the variable only', async () => {
    expect(JSON.parse((await run({})).out.trim())).toMatchObject({ sent: false, reason: 'disabled' });
    const bad = await run({ SENTRY_DSN: 'QA-NOT-A-DSN' });
    expect(bad.code).toBe(2);
    expect(bad.out).toContain('SENTRY_DSN');
    expect(bad.out).not.toContain('QA-NOT-A-DSN');
  });
});
