import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import tls from 'node:tls';
import { inspect } from 'node:util';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSmtpTransport, classifySmtpFailure, messageReference, smtpDiagnostic } from '../src/integrations/notifications/smtpTransport.js';
import crypto from 'node:crypto';
import { createTestCertificates, derInteger } from './fixtures/testCertificates.js';
import { startLocalSmtpServer, headersOf, closedPort } from './fixtures/localSmtpServer.js';
import { startScriptedSmtpServer } from './fixtures/scriptedSmtpServer.js';

/**
 * B6 r4 — the SMTP adapter against a LOCAL SMTP TEST SERVER.
 *
 * The adapter is the real production code: nodemailer's SMTP client over a
 * real TCP/TLS socket, real certificate and host-name verification, real SMTP
 * replies. The server is `smtp-server` on localhost with an in-memory TEST
 * certificate (fixtures/testCertificates.js). This is protocol evidence only:
 * NOT Titan, NOT Bluehost, NOT delivery. Synthetic data only.
 */
const USERNAME = 'notifications@qa-valida.example.test';
const PASSWORD = 'qa-app-password-marker-0123';
const RECIPIENT = 'recruitment@qa-valida.example.test';

let certificates;
beforeAll(() => {
  certificates = createTestCertificates();
});

const servers = [];
afterEach(async () => {
  while (servers.length) await servers.pop().stop();
});

async function server({ mode = 'implicit-tls', certificate = certificates.localhost, behaviour = {} } = {}) {
  const local = await startLocalSmtpServer({ mode, certificate, credentials: { username: USERNAME, password: PASSWORD }, behaviour });
  servers.push(local);
  return local;
}

const transport = (port, options = {}) =>
  createSmtpTransport({
    host: 'localhost',
    port,
    security: 'implicit-tls',
    username: USERNAME,
    password: PASSWORD,
    timeoutMs: 3_000,
    trustedCa: certificates.ca,
    ...options,
  });

const message = (overrides = {}) => ({
  event: 'APPLICATION_RECEIVED_INTERNAL',
  from: { address: USERNAME, name: 'Valida Careers' },
  to: [RECIPIENT],
  replyTo: 'careers@qa-valida.example.test',
  subject: 'New application: QA Synthetic Apply Role',
  text: 'QA synthetic text part',
  html: '<p>QA synthetic html part</p>',
  tracking: { opens: false, links: false },
  metadata: { event: 'APPLICATION_RECEIVED_INTERNAL', applicationId: '65f0c0ffee0000000000abcd' },
  ...overrides,
});
const KEY = 'APPLICATION_RECEIVED_INTERNAL/65f0c0ffee0000000000abcd';

/** The rejection of a call (fails the test if it resolved). */
async function rejectionOf(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

describe('relay acceptance over verified TLS (LOCAL TEST SERVER — not Titan)', () => {
  it('implicit TLS: one message submitted as the authenticated mailbox; the right headers; SENT means accepted by the relay', async () => {
    const local = await server({ behaviour: { dsn: true } });
    const smtp = transport(local.port);
    await expect(smtp.send(message(), { idempotencyKey: KEY })).resolves.toBeUndefined();

    expect(local.record.authAttempts).toEqual([{ username: USERNAME, matched: true, secure: true }]);
    expect(local.record.messages).toHaveLength(1);
    const [received] = local.record.messages;
    expect(received.mailFrom).toBe(USERNAME);
    expect(received.rcptTo).toEqual([RECIPIENT]);
    // DSN (where offered): failure/delay reports with headers only, matched by ENVID.
    expect(received.dsn).toMatchObject({ ret: 'HDRS', envid: messageReference(KEY) });
    const headers = headersOf(received.raw);
    expect(headers.get('from')).toEqual([`Valida Careers <${USERNAME}>`]);
    expect(headers.get('to')).toEqual([RECIPIENT]);
    expect(headers.get('reply-to')).toEqual(['careers@qa-valida.example.test']);
    expect(headers.get('message-id')).toEqual([`<${messageReference(KEY)}.b6@qa-valida.example.test>`]);
    expect(headers.get('auto-submitted')).toEqual(['auto-generated']);
    expect(headers.has('x-mailer')).toBe(false);
    expect(headers.get('content-type')[0]).toMatch(/^multipart\/alternative/);
    const body = received.raw.toString('utf8');
    expect(body).toContain('QA synthetic text part');
    expect(body).toContain('QA synthetic html part');
    expect(body).not.toMatch(/<img|https?:\/\/|tracking/i);

    await settle();
    expect(smtp.openSessions).toBe(0);
    expect(local.record.closed).toBe(local.record.connections);
  });

  it('STARTTLS (required): the login happens only after the upgrade', async () => {
    const local = await server({ mode: 'starttls' });
    const smtp = transport(local.port, { security: 'starttls' });
    await smtp.send(message(), { idempotencyKey: KEY });
    expect(local.record.authAttempts).toEqual([{ username: USERNAME, matched: true, secure: true }]);
    expect(local.record.messages).toHaveLength(1);
  });

  it('the Message-ID is the same for every attempt of one logical message (correlation, not exactly-once) and differs between messages', async () => {
    const local = await server();
    const smtp = transport(local.port);
    await smtp.send(message(), { idempotencyKey: KEY });
    await smtp.send(message(), { idempotencyKey: KEY });
    await smtp.send(message(), { idempotencyKey: 'APPLICATION_ACKNOWLEDGEMENT/65f0c0ffee0000000000abcd' });
    const ids = local.record.messages.map((received) => headersOf(received.raw).get('message-id')[0]);
    // Two submissions of the same logical message are two emails: SMTP has no idempotency.
    expect(local.record.messages).toHaveLength(3);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it('verify(): connects, secures and authenticates — and submits nothing', async () => {
    const local = await server();
    const smtp = transport(local.port);
    await expect(smtp.verify()).resolves.toBeUndefined();
    expect(local.record.authAttempts).toHaveLength(1);
    expect(local.record.mailFrom).toHaveLength(0);
    expect(local.record.messages).toHaveLength(0);
  });
});

describe('no insecure fallback: the channel is verified before any credential is sent', () => {
  it.each([
    ['a certificate from an untrusted CA', 'untrusted', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'],
    ['a certificate for another host name', 'wrongHost', 'ERR_TLS_CERT_ALTNAME_INVALID'],
    ['an expired certificate', 'expired', 'CERT_HAS_EXPIRED'],
  ])('implicit TLS with %s: TLS_FAILED (refused by certificate verification itself), no login attempted', async (_label, which, verificationCode) => {
    const local = await server({ certificate: certificates[which] });
    const error = await rejectionOf(transport(local.port).send(message(), { idempotencyKey: KEY }));
    // r8: the TLS phase was reached — the TCP connection arrived, the handshake never completed.
    expect(local.record.tcpConnections).toBe(1);
    expect(local.record.connections).toBe(0);
    expect(error.notificationCode).toBe('TLS_FAILED');
    expect(error.notificationDiagnostic.phase).toBe('connect');
    // The handshake itself refused it (not merely the adapter's second check afterwards).
    expect(error.notificationDiagnostic.errorCode).toBe(verificationCode);
    expect(local.record.authAttempts).toHaveLength(0);
    expect(local.record.messages).toHaveLength(0);
  });

  it('STARTTLS with an untrusted certificate: TLS_FAILED, no login attempted', async () => {
    const local = await server({ mode: 'starttls', certificate: certificates.untrusted });
    const error = await rejectionOf(transport(local.port, { security: 'starttls' }).send(message(), { idempotencyKey: KEY }));
    // r8: the session was reached (connected and greeted) before the upgrade failed on the certificate.
    expect(local.record.tcpConnections).toBe(1);
    expect(local.record.connections).toBe(1);
    expect(error.notificationCode).toBe('TLS_FAILED');
    expect(error.notificationDiagnostic.errorCode).toBe('UNABLE_TO_VERIFY_LEAF_SIGNATURE');
    expect(local.record.authAttempts).toHaveLength(0);
  });

  it('a server that does not support STARTTLS: TLS_FAILED — never a plaintext login, although that server would allow one', async () => {
    const local = await server({ mode: 'starttls', behaviour: { noSTARTTLS: true } });
    const error = await rejectionOf(transport(local.port, { security: 'starttls' }).send(message(), { idempotencyKey: KEY }));
    expect(error.notificationCode).toBe('TLS_FAILED');
    expect(error.notificationDiagnostic.phase).toBe('session');
    expect(local.record.authAttempts).toHaveLength(0);
    expect(local.record.mailFrom).toHaveLength(0);
  });

  it('a server that supports STARTTLS without advertising it: the upgrade is still REQUIRED and happens before the login', async () => {
    const local = await server({ mode: 'starttls', behaviour: { hideSTARTTLS: true } });
    await transport(local.port, { security: 'starttls' }).send(message(), { idempotencyKey: KEY });
    expect(local.record.authAttempts).toEqual([{ username: USERNAME, matched: true, secure: true }]);
  });

  it('implicit TLS against a plaintext SMTP server: TLS_FAILED, nothing exchanged in clear', async () => {
    const local = await server({ mode: 'plaintext' });
    const error = await rejectionOf(transport(local.port).send(message(), { idempotencyKey: KEY }));
    expect(error.notificationCode).toBe('TLS_FAILED');
    expect(local.record.authAttempts).toHaveLength(0);
  });

  it('a server that offers only TLS older than 1.2: refused (TLS_FAILED)', async () => {
    const local = await server({ behaviour: { tlsVersions: { minVersion: 'TLSv1', maxVersion: 'TLSv1.1', ciphers: 'DEFAULT@SECLEVEL=0' } } });
    const error = await rejectionOf(transport(local.port).send(message(), { idempotencyKey: KEY }));
    expect(error.notificationCode).toBe('TLS_FAILED');
    expect(local.record.authAttempts).toHaveLength(0);
  });

  it('TLS older than 1.2 is refused by the ADAPTER itself, even where the process default allows it (r4 review)', async () => {
    const local = await server({ behaviour: { tlsVersions: { minVersion: 'TLSv1', maxVersion: 'TLSv1.1', ciphers: 'DEFAULT@SECLEVEL=0' } } });
    const defaultMinimum = tls.DEFAULT_MIN_VERSION;
    tls.DEFAULT_MIN_VERSION = 'TLSv1';
    try {
      // Control: with the process default lowered, a plain client DOES negotiate TLS 1.1 with this server …
      const control = await new Promise((resolve) => {
        const socket = tls.connect({ host: 'localhost', port: local.port, ca: certificates.ca, servername: 'localhost', ciphers: 'DEFAULT@SECLEVEL=0' }, () => {
          resolve(socket.getProtocol());
          socket.destroy();
        });
        socket.on('error', (error) => resolve(`error ${error.code}`));
      });
      expect(control).toBe('TLSv1.1');
      // … the adapter does not (its own minVersion: TLSv1.2).
      const error = await rejectionOf(transport(local.port).send(message(), { idempotencyKey: KEY }));
      expect(error.notificationCode).toBe('TLS_FAILED');
      expect(local.record.authAttempts).toHaveLength(0);
    } finally {
      tls.DEFAULT_MIN_VERSION = defaultMinimum;
    }
  });

  it('NODE_TLS_REJECT_UNAUTHORIZED=0 does not switch verification off — implicit TLS and STARTTLS', async () => {
    const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    const warnings = process.listeners('warning');
    process.removeAllListeners('warning');
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    try {
      for (const mode of ['implicit-tls', 'starttls']) {
        const local = await server({ mode, certificate: certificates.untrusted });
        const error = await rejectionOf(transport(local.port, { security: mode }).send(message(), { idempotencyKey: KEY }));
        expect(error.notificationCode, mode).toBe('TLS_FAILED');
        expect(local.record.authAttempts, mode).toHaveLength(0);
      }
    } finally {
      if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
      for (const listener of warnings) process.on('warning', listener);
    }
  });
});

describe('authentication', () => {
  it('refused credentials: PROVIDER_AUTH_FAILED (configuration); the latch stops every further login until restart', async () => {
    const local = await server();
    let latched = 0;
    const smtp = transport(local.port, { password: 'qa-wrong-password-marker', onAuthenticationRejected: () => (latched += 1) });
    const first = await rejectionOf(smtp.send(message(), { idempotencyKey: KEY }));
    expect(first.notificationCode).toBe('PROVIDER_AUTH_FAILED');
    expect(first.notificationDiagnostic).toEqual({ phase: 'auth', replyCode: 535, enhancedStatus: '5.7.8', errorCode: 'EAUTH' });
    expect(latched).toBe(1);
    expect(smtp.authenticationRejected).toBe(true);
    const connections = local.record.connections;

    const second = await rejectionOf(smtp.send(message(), { idempotencyKey: KEY }));
    const third = await rejectionOf(smtp.verify());
    expect(second.notificationCode).toBe('PROVIDER_AUTH_FAILED');
    expect(third.notificationCode).toBe('PROVIDER_AUTH_FAILED');
    expect(second.notificationDiagnostic.errorCode).toBe('AUTH_LATCHED');
    // No new connection, no new login: the relay is not asked again.
    expect(local.record.connections).toBe(connections);
    expect(local.record.authAttempts).toHaveLength(1);
    expect(latched).toBe(1);
    expect(local.record.messages).toHaveLength(0);
  });

  it('concurrent sessions with refused credentials: ONE login reaches the relay; every session fails PROVIDER_AUTH_FAILED (r4 review R1)', async () => {
    // The refusal is answered late, so every session is connected and ready to log in before it arrives.
    const local = await server({ behaviour: { authDelayMs: 300 } });
    let latched = 0;
    const smtp = transport(local.port, { password: 'qa-wrong-password-marker', onAuthenticationRejected: () => (latched += 1) });
    const errors = await Promise.all(Array.from({ length: 6 }, () => rejectionOf(smtp.send(message(), { idempotencyKey: KEY }))));
    expect(errors.map((error) => error.notificationCode)).toEqual(Array(6).fill('PROVIDER_AUTH_FAILED'));
    expect(local.record.authAttempts).toHaveLength(1);
    expect(errors.filter((error) => error.notificationDiagnostic.errorCode === 'AUTH_LATCHED')).toHaveLength(5);
    expect(latched).toBe(1);
    expect(local.record.messages).toHaveLength(0);
    await settle();
    expect(smtp.openSessions).toBe(0);
  });

  it('concurrent sessions with valid credentials: logins are serialised (never two at once), every message is accepted', async () => {
    const local = await server({ behaviour: { authDelayMs: 100 } });
    const smtp = transport(local.port);
    await Promise.all(Array.from({ length: 6 }, (_, index) => smtp.send(message(), { idempotencyKey: `${KEY}-${index}` })));
    expect(local.record.authAttempts).toHaveLength(6);
    expect(local.record.maxAuthInFlight).toBe(1);
    expect(local.record.messages).toHaveLength(6);
  });

  it('a session that dies while logging in or while waiting for its turn never blocks later logins', async () => {
    const local = await server({ behaviour: { authDelayMs: 300 } });
    const smtp = transport(local.port, { timeoutMs: 10_000 });
    const loggingIn = new AbortController();
    const waiting = new AbortController();
    const first = rejectionOf(smtp.send(message(), { signal: loggingIn.signal, idempotencyKey: KEY }));
    const second = rejectionOf(smtp.send(message(), { signal: waiting.signal, idempotencyKey: KEY }));
    const third = smtp.send(message(), { idempotencyKey: KEY });
    while (local.record.authAttempts.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    // The first is in its login, the second waits for its turn: abort both.
    waiting.abort();
    loggingIn.abort();
    expect((await second).notificationCode).toBe('PROVIDER_UNAVAILABLE');
    expect((await first).notificationCode).toBe('PROVIDER_UNAVAILABLE');
    // The third gets its turn and completes.
    await expect(third).resolves.toBeUndefined();
    await expect(smtp.send(message(), { idempotencyKey: KEY })).resolves.toBeUndefined();
    expect(local.record.messages).toHaveLength(2);
  });

  it('a temporary authentication failure (454) is transient and does not latch', async () => {
    const local = await server({ behaviour: { auth: { code: 454, text: '4.7.0 Temporary authentication failure' } } });
    const smtp = transport(local.port);
    expect((await rejectionOf(smtp.send(message(), { idempotencyKey: KEY }))).notificationCode).toBe('PROVIDER_UNAVAILABLE');
    expect((await rejectionOf(smtp.send(message(), { idempotencyKey: KEY }))).notificationCode).toBe('PROVIDER_UNAVAILABLE');
    expect(local.record.authAttempts).toHaveLength(2);
    expect(smtp.authenticationRejected).toBe(false);
  });

  it('the password never appears in an error, a diagnostic or a view of the adapter', async () => {
    const local = await server();
    const smtp = transport(local.port, { password: 'qa-wrong-password-marker' });
    const error = await rejectionOf(smtp.send(message(), { idempotencyKey: KEY }));
    for (const view of [error.message, JSON.stringify(error), JSON.stringify(error.notificationDiagnostic), inspect(error, { depth: 5 }), inspect(smtp, { depth: 5 }), JSON.stringify(smtp)]) {
      expect(view).not.toContain('qa-wrong-password-marker');
      expect(view).not.toContain(PASSWORD);
      expect(view).not.toContain(USERNAME);
      expect(view).not.toContain(RECIPIENT);
    }
  });
});

describe('definitive refusals before the message body (nothing submitted)', () => {
  it.each([
    ['MAIL FROM refused (553)', { mailFrom: { code: 553, text: '5.7.1 Sender address not owned by user' } }, 'SENDER_NOT_VERIFIED'],
    ['MAIL FROM deferred (451)', { mailFrom: { code: 451, text: '4.7.1 Try again later' } }, 'PROVIDER_UNAVAILABLE'],
    ['recipient unknown (550 5.1.1)', { rcptTo: { code: 550, text: '5.1.1 User unknown' } }, 'INVALID_RECIPIENT'],
    ['recipient refused by policy (550 5.7.1)', { rcptTo: { code: 550, text: '5.7.1 Relaying denied' } }, 'PROVIDER_REJECTED'],
    ['recipient deferred (452)', { rcptTo: { code: 452, text: '4.5.3 Too many recipients' } }, 'PROVIDER_UNAVAILABLE'],
    ['connection dropped at RCPT TO', { rcptTo: 'disconnect' }, 'PROVIDER_UNAVAILABLE'],
  ])('%s -> %s', async (_label, behaviour, code) => {
    const local = await server({ behaviour });
    const error = await rejectionOf(transport(local.port).send(message(), { idempotencyKey: KEY }));
    expect(error.notificationCode).toBe(code);
    expect(error.notificationDiagnostic.phase).toBe('envelope');
    expect(local.record.messages).toHaveLength(0);
  });

  it('a message over the advertised SIZE is refused before MAIL FROM (PROVIDER_REJECTED, permanent)', async () => {
    const local = await server({ behaviour: { size: 200 } });
    const error = await rejectionOf(transport(local.port).send(message(), { idempotencyKey: KEY }));
    expect(error.notificationCode).toBe('PROVIDER_REJECTED');
    expect(local.record.mailFrom).toHaveLength(0);
  });

  it('From other than the authenticated mailbox: SENDER_NOT_VERIFIED, no connection made', async () => {
    const local = await server();
    const error = await rejectionOf(transport(local.port).send(message({ from: { address: 'careers@qa-valida.example.test', name: 'X' } }), { idempotencyKey: KEY }));
    expect(error.notificationCode).toBe('SENDER_NOT_VERIFIED');
    expect(local.record.connections).toBe(0);
  });

  it('nothing listening: PROVIDER_UNAVAILABLE (transient) with a constant network code', async () => {
    const port = await closedPort();
    const error = await rejectionOf(transport(port).send(message(), { idempotencyKey: KEY }));
    expect(error.notificationCode).toBe('PROVIDER_UNAVAILABLE');
    expect(error.notificationDiagnostic.phase).toBe('connect');
    expect(error.notificationDiagnostic.errorCode).toBe('ECONNREFUSED');
  });
});

describe('after the body: only the final reply is definitive; otherwise OUTCOME_UNKNOWN', () => {
  it.each([
    ['final reply 554 (rejected)', { code: 554, text: '5.7.1 Message rejected' }, 'PROVIDER_REJECTED'],
    ['final reply 451 (deferred)', { code: 451, text: '4.3.0 Try again later' }, 'PROVIDER_UNAVAILABLE'],
  ])('%s -> %s', async (_label, data, code) => {
    const local = await server({ behaviour: { data } });
    const error = await rejectionOf(transport(local.port).send(message(), { idempotencyKey: KEY }));
    expect(error.notificationCode).toBe(code);
    expect(error.notificationDiagnostic.phase).toBe('data');
  });

  it('the connection drops after the whole body was sent, before any reply: OUTCOME_UNKNOWN (the relay MAY have it)', async () => {
    const local = await server({ behaviour: { data: 'disconnect-after-body' } });
    const error = await rejectionOf(transport(local.port).send(message(), { idempotencyKey: KEY }));
    expect(local.record.messages).toHaveLength(1);
    expect(error.notificationCode).toBe('OUTCOME_UNKNOWN');
    expect(error.notificationDiagnostic.phase).toBe('data');
  });

  it('an abort while waiting for the final reply: OUTCOME_UNKNOWN, settled at once, socket destroyed', async () => {
    const local = await server({ behaviour: { data: 'hang-after-body' } });
    const smtp = transport(local.port, { timeoutMs: 10_000 });
    const controller = new AbortController();
    const sending = rejectionOf(smtp.send(message(), { signal: controller.signal, idempotencyKey: KEY }));
    while (local.record.messages.length === 0) await new Promise((resolve) => setTimeout(resolve, 10));
    const aborted = Date.now();
    controller.abort();
    const error = await sending;
    expect(Date.now() - aborted).toBeLessThan(200);
    expect(error.notificationCode).toBe('OUTCOME_UNKNOWN');
    await settle();
    expect(smtp.openSessions).toBe(0);
    expect(local.record.closed).toBe(local.record.connections);
  });

  it('STARTTLS: an abort after the upgrade, while waiting for the final reply, is OUTCOME_UNKNOWN and closes the connection', async () => {
    const local = await server({ mode: 'starttls', behaviour: { data: 'hang-after-body' } });
    const smtp = transport(local.port, { security: 'starttls', timeoutMs: 10_000 });
    const controller = new AbortController();
    const sending = rejectionOf(smtp.send(message(), { signal: controller.signal, idempotencyKey: KEY }));
    while (local.record.messages.length === 0) await new Promise((resolve) => setTimeout(resolve, 10));
    const aborted = Date.now();
    controller.abort();
    const error = await sending;
    expect(Date.now() - aborted).toBeLessThan(200);
    expect(error.notificationCode).toBe('OUTCOME_UNKNOWN');
    await settle();
    expect(smtp.openSessions).toBe(0);
    expect(local.record.closed).toBe(local.record.connections);
  });

  it('the adapter\'s own inactivity timeout while waiting for the final reply: OUTCOME_UNKNOWN', async () => {
    const local = await server({ behaviour: { data: 'hang-after-body' } });
    const error = await rejectionOf(transport(local.port, { timeoutMs: 400 }).send(message(), { idempotencyKey: KEY }));
    expect(error.notificationCode).toBe('OUTCOME_UNKNOWN');
  });
});

describe('exact replies on the wire (SCRIPTED LOCAL server, sequential dialogue — not Titan) (r4 review)', () => {
  async function scripted(options) {
    const local = await startScriptedSmtpServer({ certificate: options.plaintext ? undefined : certificates.localhost, ...options });
    servers.push(local);
    return local;
  }

  it.each([
    ['DATA command refused (554), before any body', { DATA: '554 5.7.1 Transaction refused' }, 'PROVIDER_REJECTED', 'envelope'],
    ['DATA command deferred (451), before any body', { DATA: '451 4.3.0 Try again later' }, 'PROVIDER_UNAVAILABLE', 'envelope'],
    ['connection dropped at the DATA command, before any body', { DATA: 'drop' }, 'PROVIDER_UNAVAILABLE', 'envelope'],
    ['recipient unknown (550 5.1.1)', { RCPT: '550 5.1.1 User unknown' }, 'INVALID_RECIPIENT', 'envelope'],
    ['a refusing greeting (554)', { greeting: '554 5.3.2 No SMTP service here' }, 'PROVIDER_UNAVAILABLE', 'session'],
    ['final reply 554 after the body', { final: '554 5.7.1 Message rejected' }, 'PROVIDER_REJECTED', 'data'],
    ['final reply 451 after the body', { final: '451 4.3.0 Try again later' }, 'PROVIDER_UNAVAILABLE', 'data'],
    ['connection lost after the body, no final reply', { final: 'drop' }, 'OUTCOME_UNKNOWN', 'data'],
  ])('%s -> %s', async (_label, replies, code, phase) => {
    const local = await scripted({ replies });
    const error = await rejectionOf(transport(local.port).send(message(), { idempotencyKey: KEY }));
    expect(error.notificationCode).toBe(code);
    expect(error.notificationDiagnostic.phase).toBe(phase);
    // Before the body nothing was submitted; after it, exactly one copy reached the server.
    expect(local.record.bodies.filter((body) => body.length > 0)).toHaveLength(phase === 'data' ? 1 : 0);
  });

  it.each([
    ['refused (502): it cannot be secured', '502 5.5.1 STARTTLS not supported', 'TLS_FAILED'],
    ['temporarily unavailable (454, RFC 3207): transient', '454 4.7.0 TLS not available due to temporary reason', 'PROVIDER_UNAVAILABLE'],
  ])('required STARTTLS %s -> %s; no AUTH is ever sent in clear', async (_label, STARTTLS, code) => {
    const local = await scripted({ plaintext: true, starttls: true, replies: { STARTTLS } });
    const error = await rejectionOf(transport(local.port, { security: 'starttls' }).send(message(), { idempotencyKey: KEY }));
    expect(error.notificationCode).toBe(code);
    expect(error.notificationDiagnostic).toMatchObject({ phase: 'session', errorCode: 'ETLS' });
    expect(local.record.events).not.toContain('AUTH');
  });
});

describe('bounded and cancellable before the body (nothing submitted)', () => {
  it('a server that accepts TCP but never greets: an abort ends it as PROVIDER_UNAVAILABLE and closes the socket', async () => {
    const local = await server({ behaviour: { greeting: 'hang' } });
    const smtp = transport(local.port, { security: 'starttls', timeoutMs: 10_000 });
    const controller = new AbortController();
    const sending = rejectionOf(smtp.send(message(), { signal: controller.signal, idempotencyKey: KEY }));
    while (local.record.connections === 0) await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    const error = await sending;
    expect(error.notificationCode).toBe('PROVIDER_UNAVAILABLE');
    expect(error.notificationDiagnostic.phase).toBe('session');
    await settle();
    expect(local.record.closed).toBe(1);
    expect(smtp.openSessions).toBe(0);
  });

  it('the same server without an abort: the adapter\'s own greeting timeout ends it (PROVIDER_UNAVAILABLE)', async () => {
    const local = await server({ behaviour: { greeting: 'hang' } });
    const started = Date.now();
    const error = await rejectionOf(transport(local.port, { security: 'starttls', timeoutMs: 300 }).send(message(), { idempotencyKey: KEY }));
    expect(error.notificationCode).toBe('PROVIDER_UNAVAILABLE');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('an implicit-TLS server that never completes the handshake: bounded, PROVIDER_UNAVAILABLE', async () => {
    const local = await server({ behaviour: { greeting: 'hang' } });
    const error = await rejectionOf(transport(local.port, { timeoutMs: 300 }).send(message(), { idempotencyKey: KEY }));
    expect(error.notificationCode).toBe('PROVIDER_UNAVAILABLE');
    expect(error.notificationDiagnostic).toMatchObject({ phase: 'connect', errorCode: 'CONNECT_TIMEOUT' });
  });

  it('an abort while the TLS handshake is pending leaves nothing behind: the process can exit at once (no timer or socket kept alive)', async () => {
    // A separate process: it starts a send to a listener that never completes
    // the handshake (bound 30 s), aborts it, stops the listener — and must then
    // exit by itself, long before the 30 s bound.
    const transportUrl = new URL('../src/integrations/notifications/smtpTransport.js', import.meta.url).href;
    const source = `
      import net from 'node:net';
      import { createSmtpTransport } from ${JSON.stringify(transportUrl)};
      const sockets = new Set();
      const listener = net.createServer((socket) => { sockets.add(socket); socket.on('error', () => {}); });
      await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
      const smtp = createSmtpTransport({ host: 'localhost', port: listener.address().port, username: 'n@qa.example.test', password: 'x', timeoutMs: 30000 });
      const controller = new AbortController();
      const sending = smtp.send({ event: 'E', from: { address: 'n@qa.example.test', name: 'QA' }, to: ['r@qa.example.test'], subject: 's', text: 't', html: '<p>t</p>' }, { signal: controller.signal, idempotencyKey: 'E/1' }).catch((error) => error.notificationCode);
      while (sockets.size === 0) await new Promise((resolve) => setTimeout(resolve, 10));
      controller.abort();
      console.log(await sending);
      for (const socket of sockets) socket.destroy();
      listener.close();
    `;
    const started = Date.now();
    const { code, output } = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', source], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
      let text = '';
      child.stdout.on('data', (chunk) => (text += chunk));
      child.stderr.on('data', (chunk) => (text += chunk));
      child.on('close', (exitCode) => resolve({ code: exitCode, output: text }));
    });
    expect(output.trim()).toBe('PROVIDER_UNAVAILABLE');
    expect(code).toBe(0);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 40_000);

  it('an already-aborted signal: nothing is opened', async () => {
    const local = await server();
    const controller = new AbortController();
    controller.abort();
    const error = await rejectionOf(transport(local.port).send(message(), { signal: controller.signal, idempotencyKey: KEY }));
    expect(error.notificationCode).toBe('PROVIDER_UNAVAILABLE');
    expect(local.record.connections).toBe(0);
  });

  it('close(): stops a session in progress and refuses new ones', async () => {
    const local = await server({ behaviour: { greeting: 'hang' } });
    const smtp = transport(local.port, { security: 'starttls', timeoutMs: 10_000 });
    const sending = rejectionOf(smtp.send(message(), { idempotencyKey: KEY }));
    while (local.record.connections === 0) await new Promise((resolve) => setTimeout(resolve, 10));
    await smtp.close();
    expect((await sending).notificationCode).toBe('PROVIDER_UNAVAILABLE');
    expect(smtp.openSessions).toBe(0);
    expect((await rejectionOf(smtp.send(message(), { idempotencyKey: KEY }))).notificationCode).toBe('PROVIDER_UNAVAILABLE');
    expect(local.record.connections).toBe(1);
  });
});

describe('classification and diagnostics are pure and value-free', () => {
  it.each([
    [{ code: 'ABORTED' }, 'connect', 'PROVIDER_UNAVAILABLE'],
    [{ code: 'ABORTED' }, 'envelope', 'PROVIDER_UNAVAILABLE'],
    [{ code: 'ABORTED' }, 'data', 'OUTCOME_UNKNOWN'],
    [{ code: 'ECONNREFUSED' }, 'connect', 'PROVIDER_UNAVAILABLE'],
    // r4 review R2: a local or multi-address connect failure is not a TLS failure.
    [{ code: 'EAFNOSUPPORT' }, 'connect', 'PROVIDER_UNAVAILABLE'],
    [{ code: 'EACCES' }, 'connect', 'PROVIDER_UNAVAILABLE'],
    [{ code: 'EMFILE' }, 'connect', 'PROVIDER_UNAVAILABLE'],
    [{ code: 'ERR_TLS_HANDSHAKE_TIMEOUT' }, 'connect', 'PROVIDER_UNAVAILABLE'],
    [{ code: 'CONNECT_TIMEOUT' }, 'connect', 'PROVIDER_UNAVAILABLE'],
    [{ code: 'TLS_UNAUTHORIZED' }, 'connect', 'TLS_FAILED'],
    [{ code: 'ERR_SSL_WRONG_VERSION_NUMBER' }, 'connect', 'TLS_FAILED'],
    [{ code: 'ETLS', responseCode: 454, response: '454 4.7.0 TLS not available' }, 'session', 'PROVIDER_UNAVAILABLE'],
    [{ code: 'ETLS', responseCode: 502 }, 'session', 'TLS_FAILED'],
    [{ code: 'ETLS' }, 'session', 'PROVIDER_UNAVAILABLE'],
    [{ code: 'TLS_NOT_ESTABLISHED' }, 'session', 'TLS_FAILED'],
    [{ code: 'AUTH_LATCHED' }, 'auth', 'PROVIDER_AUTH_FAILED'],
    [{ code: 'EENVELOPE', command: 'API' }, 'envelope', 'PROVIDER_ERROR'],
    [{ code: 'CERT_HAS_EXPIRED' }, 'connect', 'TLS_FAILED'],
    [{ code: 'ESOCKET', originalCode: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }, 'session', 'TLS_FAILED'],
    [{ code: 'ESOCKET', originalCode: 'ERR_TLS_CERT_ALTNAME_INVALID' }, 'session', 'TLS_FAILED'],
    [{ code: 'ESOCKET', originalCode: 'ECONNRESET' }, 'session', 'PROVIDER_UNAVAILABLE'],
    [{ code: 'ECONNECTION', responseCode: 421 }, 'session', 'PROVIDER_UNAVAILABLE'],
    [{ code: 'EAUTH', responseCode: 535 }, 'auth', 'PROVIDER_AUTH_FAILED'],
    [{ code: 'EAUTH' }, 'auth', 'PROVIDER_AUTH_FAILED'],
    [{ code: 'EAUTH', responseCode: 454 }, 'auth', 'PROVIDER_UNAVAILABLE'],
    [{ code: 'ETIMEDOUT' }, 'auth', 'PROVIDER_UNAVAILABLE'],
    [{ code: 'EENVELOPE', command: 'MAIL FROM', responseCode: 550 }, 'envelope', 'SENDER_NOT_VERIFIED'],
    [{ code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550, response: '550 5.1.1 x' }, 'envelope', 'INVALID_RECIPIENT'],
    [{ code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550, response: '550 5.7.1 x' }, 'envelope', 'PROVIDER_REJECTED'],
    [{ code: 'EENVELOPE', command: 'DATA', responseCode: 554 }, 'envelope', 'PROVIDER_REJECTED'],
    [{ code: 'EENVELOPE', command: 'DATA', responseCode: 451 }, 'envelope', 'PROVIDER_UNAVAILABLE'],
    [{ code: 'ECONNECTION', responseCode: 421 }, 'envelope', 'PROVIDER_UNAVAILABLE'],
    [{ code: 'EMESSAGE', command: 'DATA', responseCode: 250 }, 'data', 'OUTCOME_UNKNOWN'],
    [{ code: 'ECONNECTION', responseCode: 421 }, 'data', 'OUTCOME_UNKNOWN'],
    [{ code: 'ETIMEDOUT' }, 'data', 'OUTCOME_UNKNOWN'],
    [{}, 'data', 'OUTCOME_UNKNOWN'],
    [{}, 'envelope', 'PROVIDER_UNAVAILABLE'],
  ])('%j in %s -> %s', (error, phase, code) => {
    expect(classifySmtpFailure(error, phase)).toBe(code);
  });

  it('diagnostics keep fixed tokens only — never reply text, addresses or the message', () => {
    const error = Object.assign(new Error('550 5.1.1 <victim@qa.example.test>: Recipient address rejected'), {
      code: 'EENVELOPE',
      responseCode: 550,
      response: '550 5.1.1 <victim@qa.example.test>: Recipient address rejected',
      command: 'RCPT TO',
    });
    expect(smtpDiagnostic(error, 'envelope')).toEqual({ phase: 'envelope', replyCode: 550, enhancedStatus: '5.1.1', errorCode: 'EENVELOPE' });
    expect(smtpDiagnostic({ code: 'lower-case or@address', response: 'free text' }, 'auth')).toEqual({ phase: 'auth' });
  });

  it('constructor arguments are validated (no IP literal: the certificate is checked against the name)', () => {
    const valid = { host: 'smtp.qa.example.test', port: 465, security: 'implicit-tls', username: USERNAME, password: 'x', timeoutMs: 1000 };
    expect(() => createSmtpTransport(valid)).not.toThrow();
    for (const bad of [{ host: '203.0.113.5' }, { host: '' }, { port: 0 }, { security: 'plain' }, { username: 'nobody' }, { password: '' }, { timeoutMs: 0 }]) {
      expect(() => createSmtpTransport({ ...valid, ...bad }), JSON.stringify(bad)).toThrow(TypeError);
    }
  });
});

describe('test fixture: the in-memory certificates are valid DER whatever the random serial (r4 clean-run finding)', () => {
  it('INTEGERs are minimal: redundant leading zero bytes removed, one 0x00 added before a set high bit', () => {
    expect(derInteger(Buffer.from([0x02])).toString('hex')).toBe('020102');
    expect(derInteger(Buffer.from([0x00, 0x12, 0x34])).toString('hex')).toBe('02021234');
    expect(derInteger(Buffer.from([0x00, 0x00, 0x92])).toString('hex')).toBe('02020092');
    expect(derInteger(Buffer.from([0x92, 0x01])).toString('hex')).toBe('0203009201');
    expect(derInteger(Buffer.from([0x00])).toString('hex')).toBe('020100');
  });

  it('serials that start with 0x00 (1 in 512 random CA serials before the fix) still give parseable, trusted certificates', async () => {
    const certificates = createTestCertificates({ serialBytes: () => Buffer.from([0x00, 0x12, ...crypto.randomBytes(10)]) });
    for (const pem of [certificates.ca, certificates.localhost.cert, certificates.wrongHost.cert]) expect(() => new crypto.X509Certificate(pem)).not.toThrow();
    const local = await startLocalSmtpServer({ certificate: certificates.localhost, credentials: { username: USERNAME, password: PASSWORD } });
    servers.push(local);
    const smtp = createSmtpTransport({ host: 'localhost', port: local.port, security: 'implicit-tls', username: USERNAME, password: PASSWORD, timeoutMs: 3_000, trustedCa: certificates.ca });
    await expect(smtp.verify()).resolves.toBeUndefined();
  });

  it('the default serials are positive with a non-zero first byte', () => {
    for (let index = 0; index < 50; index += 1) {
      const serial = new crypto.X509Certificate(createTestCertificates().ca).serialNumber;
      expect(serial.length).toBe(24);
      expect(Number.parseInt(serial.slice(0, 2), 16)).toBeGreaterThanOrEqual(1);
      expect(Number.parseInt(serial.slice(0, 2), 16)).toBeLessThanOrEqual(0x7f);
    }
  });
});
