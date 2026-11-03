import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server.js';
import { NOTIFICATION_EVENTS, createNotificationService } from '../src/integrations/notifications/notificationService.js';
import { createSmtpTransport } from '../src/integrations/notifications/smtpTransport.js';
import { createNotificationTransport } from '../src/integrations/notifications/transport.js';
import { createApplicationNotifier, runNotificationRetry } from '../src/modules/applications/application.notifications.js';
import { createTestCertificates } from './fixtures/testCertificates.js';
import { startLocalSmtpServer, headersOf, closedPort } from './fixtures/localSmtpServer.js';
import { leaves, parseMime } from './fixtures/mimeInspect.js';
import { QA_CANDIDATE, QA_NOTIFICATION_OPTIONS, QA_NOW, applyRequest, createApplyEnvironment } from './fixtures/applyHarness.js';
import { freePort, offlineDatabase, OFFLINE_TEST_MONGODB_URI, capturingLogger } from './helpers.js';
import { makeTestRoot, removeTestRoot } from './fixtures/uploadHarness.js';

/**
 * B6 r4 — the REAL SMTP adapter inside the real Notification Service, the
 * real Apply workflow (offline repositories, real local private storage) and
 * the real startServer, against a LOCAL SMTP TEST SERVER (smtp-server on
 * localhost, in-memory TEST certificate).
 *
 * Evidence of: what the backend submits, how every outcome is recorded, that
 * failures keep the accepted Application, that a replay sends nothing, that
 * uncertain outcomes are never retried automatically, and how readiness
 * follows verification. NOT evidence of Titan, of delivery, of SPF/DKIM/DMARC
 * or of anything outside this machine (Doc 17 sections 387-388).
 */
const USERNAME = 'notifications@qa-valida.example.test';
const PASSWORD = 'qa-app-password-marker-4567';
const HR = QA_NOTIFICATION_OPTIONS.internalRecipient;
const CAREERS = QA_NOTIFICATION_OPTIONS.replyTo;

let certificates;
beforeAll(() => {
  certificates = createTestCertificates();
});
const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

async function localServer(behaviour = {}) {
  const local = await startLocalSmtpServer({ certificate: certificates.localhost, credentials: { username: USERNAME, password: PASSWORD }, behaviour });
  cleanups.push(() => local.stop());
  return local;
}
const smtpTransport = (port, options = {}) =>
  createSmtpTransport({ host: 'localhost', port, security: 'implicit-tls', username: USERNAME, password: PASSWORD, timeoutMs: 3_000, trustedCa: certificates.ca, ...options });

const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
const input = (overrides = {}) => ({
  applicationId: '65f0c0ffee0000000000abcd',
  job: { title: 'QA Synthetic Apply Role', slug: 'qa-synthetic-apply-role' },
  submittedAt: new Date('2026-10-05T12:00:00.000Z'),
  candidateEmail: 'qa.candidate@qa-valida.example.test',
  ...overrides,
});

describe('Notification Service + SMTP adapter (LOCAL TEST SERVER — not Titan)', () => {
  const service = (transport, options = {}) =>
    createNotificationService({ transport, timeoutMs: 3_000, ...QA_NOTIFICATION_OPTIONS, fromAddress: USERNAME, acknowledgementEnabled: true, ...options });

  it('internal notification: SENT = accepted by the relay; to the recruitment recipient; no candidate data in the message', async () => {
    const local = await localServer();
    const outcome = await service(smtpTransport(local.port)).deliver(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, input());
    expect(outcome).toEqual({ status: 'SENT', attemptedAt: expect.any(Date), sentAt: expect.any(Date) });
    const [received] = local.record.messages;
    expect(received.rcptTo).toEqual([HR]);
    const raw = received.raw.toString('utf8');
    expect(raw).not.toContain('qa.candidate');
    // Stage 2 (b6-2): the approved copy is not pure ASCII ('·'), so the text part is quoted-printable and
    // may be soft-wrapped on the wire; the reference is asserted on the DECODED text (and the candidate
    // address on raw and decoded output alike).
    const text = leaves(parseMime(received.raw)).find((leaf) => leaf.type === 'text/plain').text.replace(/\r\n/g, '\n');
    expect(text).not.toContain('qa.candidate');
    expect(text).toContain('Application reference: 65f0c0ffee0000000000abcd\n');
    expect(headersOf(received.raw).get('from')).toEqual([`Valida Careers <${USERNAME}>`]);
  });

  it('candidate acknowledgement: to the candidate, Reply-To the careers address', async () => {
    const local = await localServer();
    const outcome = await service(smtpTransport(local.port)).deliver(NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT, input());
    expect(outcome.status).toBe('SENT');
    const [received] = local.record.messages;
    expect(received.rcptTo).toEqual(['qa.candidate@qa-valida.example.test']);
    expect(headersOf(received.raw).get('reply-to')).toEqual([CAREERS]);
    expect(received.raw.toString('utf8')).toMatch(/Thank you for applying\./);
  });

  it('the bound expires while the relay holds the final reply: OUTCOME_UNKNOWN (uncertain), the session closed — not abandoned, not TIMEOUT', async () => {
    const local = await localServer({ data: 'hang-after-body' });
    const transport = smtpTransport(local.port, { timeoutMs: 10_000 });
    const started = Date.now();
    const outcome = await service(transport, { timeoutMs: 400, abortGraceMs: 400 }).deliver(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, input());
    expect(outcome).toMatchObject({ status: 'FAILED', errorCode: 'OUTCOME_UNKNOWN', errorClass: 'UNCERTAIN', diagnostic: { phase: 'data' } });
    expect(Date.now() - started).toBeLessThan(400 + 400 + 500);
    expect(local.record.messages).toHaveLength(1);
    await settle();
    expect(transport.openSessions).toBe(0);
    expect(local.record.closed).toBe(local.record.connections);
  });

  it('the bound expires before the relay greets: PROVIDER_UNAVAILABLE (transient — nothing was submitted)', async () => {
    const local = await localServer({ greeting: 'hang' });
    const transport = smtpTransport(local.port, { timeoutMs: 10_000, security: 'starttls' });
    const outcome = await service(transport, { timeoutMs: 300 }).deliver(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, input());
    expect(outcome).toMatchObject({ status: 'FAILED', errorCode: 'PROVIDER_UNAVAILABLE', errorClass: 'TRANSIENT' });
    await settle();
    expect(transport.openSessions).toBe(0);
  });

  it('verify(): ok against the relay; refused credentials report a value-free diagnostic', async () => {
    const local = await localServer();
    expect(await service(smtpTransport(local.port)).verify()).toEqual({ ok: true });
    const refused = await service(smtpTransport(local.port, { password: 'qa-wrong-password-marker' })).verify();
    expect(refused).toEqual({ ok: false, reason: 'PROVIDER_AUTH_FAILED', diagnostic: { phase: 'auth', replyCode: 535, enhancedStatus: '5.7.8', errorCode: 'EAUTH' } });
    expect(local.record.messages).toHaveLength(0);
  });
});

describe('Apply -> notifier -> SMTP adapter (LOCAL TEST SERVER — not Titan)', () => {
  let env;
  afterEach(async () => {
    await env?.cleanup();
    env = undefined;
  });
  const record = () => env.applications.all()[0];
  const logLines = () => env.log.output().split('\n').filter(Boolean).map((line) => JSON.parse(line));

  async function environment(local, { transportOptions = {}, acknowledgementEnabled = true } = {}) {
    const transport = smtpTransport(local.port, transportOptions);
    env = await createApplyEnvironment({
      transport,
      notificationTimeoutMs: 3_000,
      notificationOptions: { fromAddress: USERNAME, acknowledgementEnabled },
    });
    return transport;
  }

  it('one Application: exactly two messages (internal + acknowledgement), recorded SENT; a replay sends nothing more', async () => {
    const local = await localServer();
    await environment(local);
    const key = randomUUID();
    const first = await applyRequest(env.app, { key });
    expect(first.status).toBe(201);
    expect(record().notifications).toMatchObject({
      internal: { status: 'SENT', attemptCount: 1, lastErrorCode: null },
      candidateAcknowledgement: { status: 'SENT', attemptCount: 1, lastErrorCode: null },
    });
    expect(local.record.messages).toHaveLength(2);
    const byRecipient = Object.fromEntries(local.record.messages.map((received) => [received.rcptTo[0], received]));
    expect(Object.keys(byRecipient).sort()).toEqual([QA_CANDIDATE.email, HR].sort());
    const internalRaw = byRecipient[HR].raw.toString('utf8');
    expect(internalRaw).not.toContain(QA_CANDIDATE.fullName);
    expect(internalRaw.toLowerCase()).not.toContain(QA_CANDIDATE.email.toLowerCase());
    expect(internalRaw).not.toMatch(/%PDF|qa-resume/);
    expect(headersOf(byRecipient[QA_CANDIDATE.email].raw).get('reply-to')).toEqual([CAREERS]);

    const replay = await applyRequest(env.app, { key });
    expect(replay.status).toBe(200);
    expect(replay.body.meta.replayed).toBe(true);
    expect(local.record.messages).toHaveLength(2);
    expect(env.applications.all()).toHaveLength(1);

    // The log names no address and no provider data.
    const attempted = logLines().filter((line) => line.event === 'notification_attempted');
    expect(attempted).toHaveLength(2);
    expect(JSON.stringify(attempted)).not.toMatch(/@|queued by|OK:/);
  });

  it('the relay drops the connection after the body: 201 all the same; OUTCOME_UNKNOWN recorded; never retried automatically', async () => {
    const local = await localServer({ data: 'disconnect-after-body' });
    const transport = await environment(local, { acknowledgementEnabled: false });
    const response = await applyRequest(env.app);
    expect(response.status).toBe(201);
    expect(record().notifications.internal).toMatchObject({ status: 'FAILED', attemptCount: 1, lastErrorCode: 'OUTCOME_UNKNOWN' });
    expect(env.storedObjects()).toHaveLength(1);
    expect(env.applications.all()).toHaveLength(1);
    const [attempt] = logLines().filter((line) => line.event === 'notification_attempted');
    expect(attempt).toMatchObject({ outcome: 'FAILED', errorCode: 'OUTCOME_UNKNOWN', errorClass: 'UNCERTAIN', diagnostic: { phase: 'data' }, provider: 'smtp' });

    // Retry runs: an automatic run does not touch it; only an operator's explicit choice would.
    const later = new Date(QA_NOW.getTime() + 24 * 60 * 60 * 1000);
    const notifications = createNotificationService({ transport, timeoutMs: 3_000, ...QA_NOTIFICATION_OPTIONS, fromAddress: USERNAME });
    const notifier = createApplicationNotifier({ applications: env.applications, notifications, clock: () => later, logger: env.log.logger });
    const policy = { maxAttempts: 5, baseDelayMs: 60_000, staleMs: 60_000 };
    const automatic = await runNotificationRetry({ applications: env.applications, notifier, clock: () => later, policy, send: true });
    expect(automatic.due).toBe(0);
    expect(local.record.messages).toHaveLength(1);
    const operatorPreview = await runNotificationRetry({ applications: env.applications, notifier, clock: () => later, policy, includeUncertain: true });
    expect(operatorPreview.items).toEqual([expect.objectContaining({ channels: ['internal'], action: 'WOULD_SEND' })]);
    expect(local.record.messages).toHaveLength(1);
  });

  it('a transient refusal is retried by the automatic run once its backoff elapsed — exactly one more message', async () => {
    const behaviour = { mailFrom: { code: 451, text: '4.7.1 Try again later' } };
    const local = await localServer(behaviour);
    const transport = await environment(local, { acknowledgementEnabled: false });
    expect((await applyRequest(env.app)).status).toBe(201);
    expect(record().notifications.internal).toMatchObject({ status: 'FAILED', lastErrorCode: 'PROVIDER_UNAVAILABLE' });
    expect(local.record.messages).toHaveLength(0);

    delete behaviour.mailFrom;
    const later = new Date(QA_NOW.getTime() + 24 * 60 * 60 * 1000);
    const notifications = createNotificationService({ transport, timeoutMs: 3_000, ...QA_NOTIFICATION_OPTIONS, fromAddress: USERNAME });
    const notifier = createApplicationNotifier({ applications: env.applications, notifications, clock: () => later, logger: env.log.logger });
    const run = () => runNotificationRetry({ applications: env.applications, notifier, clock: () => later, policy: { maxAttempts: 5, baseDelayMs: 60_000, staleMs: 60_000 }, send: true });
    expect((await run()).results.SENT).toBe(1);
    expect(record().notifications.internal).toMatchObject({ status: 'SENT', attemptCount: 2 });
    expect(local.record.messages).toHaveLength(1);
    // Nothing is due any more: a second run sends nothing.
    expect((await run()).due).toBe(0);
    expect(local.record.messages).toHaveLength(1);
  });

  it('refused credentials: 201; PROVIDER_AUTH_FAILED (configuration); the next Application does not log in again', async () => {
    const local = await localServer();
    await environment(local, { transportOptions: { password: 'qa-wrong-password-marker' }, acknowledgementEnabled: false });
    expect((await applyRequest(env.app)).status).toBe(201);
    expect((await applyRequest(env.app)).status).toBe(201);
    const records = env.applications.all();
    expect(records.map((stored) => stored.notifications.internal.lastErrorCode)).toEqual(['PROVIDER_AUTH_FAILED', 'PROVIDER_AUTH_FAILED']);
    expect(local.record.authAttempts).toHaveLength(1);
    expect(env.log.output()).not.toContain('qa-wrong-password-marker');
  });

  it('the candidate address is refused by the relay: acknowledgement INVALID_RECIPIENT (never retried); the internal notification SENT', async () => {
    const local = await localServer({ rcptTo: (address) => (address === HR ? null : { code: 550, text: '5.1.1 Mailbox unavailable' }) });
    await environment(local);
    expect((await applyRequest(env.app)).status).toBe(201);
    expect(record().notifications.internal).toMatchObject({ status: 'SENT' });
    expect(record().notifications.candidateAcknowledgement).toMatchObject({ status: 'FAILED', lastErrorCode: 'INVALID_RECIPIENT' });
  });
});

describe('startServer with TRANSACTIONAL_EMAIL_PROVIDER=smtp (LOCAL TEST SERVER — not Titan)', () => {
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

  async function start(port, { env = {}, onTransport = () => {}, recheckDelaysMs } = {}) {
    const log = capturingLogger();
    const httpPort = await freePort();
    const handle = await startServer({
      env: {
        NODE_ENV: 'test',
        APP_ENV: 'local',
        PORT: String(httpPort),
        LOG_LEVEL: 'info',
        MONGODB_URI: OFFLINE_TEST_MONGODB_URI,
        RESUME_STORAGE_DRIVER: 'local',
        RESUME_STORAGE_LOCAL_ROOT: path.join(root, 'private-resumes'),
        NOTIFICATION_TIMEOUT_MS: '10000',
        TRANSACTIONAL_EMAIL_PROVIDER: 'smtp',
        SMTP_HOST: 'localhost',
        SMTP_PORT: String(port),
        SMTP_USERNAME: USERNAME,
        SMTP_PASSWORD: PASSWORD,
        TRANSACTIONAL_FROM_ADDRESS: USERNAME,
        RECRUITMENT_NOTIFICATION_RECIPIENT: HR,
        EMAIL_RECIPIENT_ALLOWLIST: '@qa-valida.example.test',
        ...env,
      },
      database: offlineDatabase(),
      logger: log.logger,
      uploadTempBaseDirectory: path.join(root, 'tmp'),
      ...(recheckDelaysMs ? { notificationRecheckDelaysMs: recheckDelaysMs } : {}),
      // The production factory, with the local test CA added (the only seam).
      notificationTransportFactory: (options) => {
        const transport = createNotificationTransport({ ...options, trustedCa: certificates.ca });
        onTransport(transport);
        return transport;
      },
    });
    handles.push(handle);
    return { handle, log, httpPort };
  }
  const stateOf = (handle) => handle.readiness.describe().dependencies.find((d) => d.name === 'notifications').state;

  it('verifies connection, TLS and login at startup — sends nothing — and says exactly that', async () => {
    const local = await localServer();
    const { handle, log, httpPort } = await start(local.port);
    expect(stateOf(handle)).toBe('ready');
    expect((await request(`http://127.0.0.1:${httpPort}`).get('/api/v1/health/ready')).status).toBe(200);
    expect(local.record.authAttempts).toEqual([{ username: USERNAME, matched: true, secure: true }]);
    expect(local.record.messages).toHaveLength(0);
    expect(log.output()).toMatch(/connection, TLS and authentication verified \(no message sent; relay acceptance and delivery are not verified by this check\)/);
    expect(log.output()).not.toContain(PASSWORD);
  });

  it('refused credentials: unavailable (503) with a value-free reason; the password never logged', async () => {
    const local = await localServer();
    const { handle, log, httpPort } = await start(local.port, { env: { SMTP_PASSWORD: 'qa-wrong-password-marker' } });
    expect(stateOf(handle)).toBe('unavailable');
    expect((await request(`http://127.0.0.1:${httpPort}`).get('/api/v1/health/ready')).status).toBe(503);
    const entries = log.output().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    expect(entries.find((entry) => entry.reason)).toMatchObject({ reason: 'PROVIDER_AUTH_FAILED', diagnostic: { phase: 'auth', replyCode: 535 } });
    expect(entries.some((entry) => entry.event === 'notification_authentication_rejected')).toBe(true);
    expect(log.output()).not.toContain('qa-wrong-password-marker');
  });

  it('an unreachable relay: unavailable (PROVIDER_UNAVAILABLE); the backend still starts', async () => {
    const { handle, log } = await start(await closedPort());
    expect(stateOf(handle)).toBe('unavailable');
    expect(log.output()).toMatch(/"reason":"PROVIDER_UNAVAILABLE"/);
  });

  it('a relay unreachable at startup is checked again in the background (review R4): ready once it answers — nothing sent', async () => {
    const port = await closedPort();
    const { handle, log } = await start(port, { recheckDelaysMs: [150, 150] });
    expect(stateOf(handle)).toBe('unavailable');
    const local = await startLocalSmtpServer({ certificate: certificates.localhost, credentials: { username: USERNAME, password: PASSWORD }, port });
    cleanups.push(() => local.stop());
    const started = Date.now();
    while (stateOf(handle) !== 'ready' && Date.now() - started < 5_000) await new Promise((resolve) => setTimeout(resolve, 25));
    expect(stateOf(handle)).toBe('ready');
    expect(local.record.authAttempts).toHaveLength(1);
    expect(local.record.messages).toHaveLength(0);
    expect(log.output()).toMatch(/transactional email verified on re-check \(no message sent/);
  });

  it('refused credentials at startup are NOT checked again (no further login); neither after shutdown', async () => {
    const local = await localServer();
    const { handle } = await start(local.port, { env: { SMTP_PASSWORD: 'qa-wrong-password-marker' }, recheckDelaysMs: [50] });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(stateOf(handle)).toBe('unavailable');
    expect(local.record.authAttempts).toHaveLength(1);

    const port = await closedPort();
    const { handle: second } = await start(port, { recheckDelaysMs: [200] });
    handles.splice(handles.indexOf(second), 1);
    await second.shutdown('test');
    const late = await startLocalSmtpServer({ certificate: certificates.localhost, credentials: { username: USERNAME, password: PASSWORD }, port });
    cleanups.push(() => late.stop());
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(late.record.connections).toBe(0);
  });

  it('credentials refused LATER (runtime): readiness turns unavailable at once', async () => {
    const behaviour = {};
    const local = await localServer(behaviour);
    let transport;
    const { handle } = await start(local.port, { onTransport: (created) => (transport = created) });
    expect(stateOf(handle)).toBe('ready');
    behaviour.auth = { code: 535, text: '5.7.8 Authentication credentials invalid' };
    await expect(transport.verify()).rejects.toMatchObject({ notificationCode: 'PROVIDER_AUTH_FAILED' });
    expect(stateOf(handle)).toBe('unavailable');
  });

  it('graceful shutdown closes the transport (no session left open)', async () => {
    const local = await localServer();
    let transport;
    const { handle } = await start(local.port, { onTransport: (created) => (transport = created) });
    handles.pop();
    const outcome = await handle.shutdown('SIGTERM');
    expect(outcome.clean).toBe(true);
    expect(outcome.dependencies.closed).toContain('notifications');
    expect(transport.openSessions).toBe(0);
  });
});

describe('ops:notifications:retry --send verifies the relay before touching the database (real process)', () => {
  const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const run = (args, env) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, ['scripts/notifications-retry.mjs', ...args], {
        cwd: backendRoot,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, MONGODB_CONNECT_TIMEOUT_MS: '1000', ...env },
      });
      let output = '';
      child.stdout.on('data', (chunk) => (output += chunk));
      child.stderr.on('data', (chunk) => (output += chunk));
      child.on('close', (code) => resolve({ code, output }));
    });

  it('a relay whose certificate is not publicly trusted (the local test server): REFUSED with TLS_FAILED — no configuration can switch verification off', async () => {
    const local = await localServer();
    const { code, output } = await run(['--send'], {
      MONGODB_URI: 'mongodb://qa-user:qa-db-secret@127.0.0.1:1/valida_test',
      TRANSACTIONAL_EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'localhost',
      SMTP_PORT: String(local.port),
      SMTP_USERNAME: USERNAME,
      SMTP_PASSWORD: PASSWORD,
      TRANSACTIONAL_FROM_ADDRESS: USERNAME,
      RECRUITMENT_NOTIFICATION_RECIPIENT: HR,
      EMAIL_RECIPIENT_ALLOWLIST: '@qa-valida.example.test',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    });
    expect(code).toBe(1);
    expect(output).toMatch(/provider: smtp/);
    expect(output).toMatch(/REFUSED: the provider could not be verified \(TLS_FAILED \{"phase":"connect","errorCode":"[A-Z_]+"\}\)\. Nothing was read, written or sent\./);
    expect(output).not.toMatch(/database:|could not be reached/);
    expect(output).not.toContain(PASSWORD);
    expect(output).not.toContain('qa-db-secret');
    expect(local.record.authAttempts).toHaveLength(0);
  }, 30_000);
});
