import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import util from 'node:util';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import SMTPConnection from 'nodemailer/lib/smtp-connection';
import MailComposer from 'nodemailer/lib/mail-composer';
import { createTestCertificates } from './fixtures/testCertificates.js';
import { startScriptedSmtpServer } from './fixtures/scriptedSmtpServer.js';
import { startLocalSmtpServer } from './fixtures/localSmtpServer.js';

/**
 * B6 r4 review — the NODEMAILER CONTRACT the SMTP adapter relies on.
 *
 * The adapter (src/integrations/notifications/smtpTransport.js) uses two
 * nodemailer modules directly instead of nodemailer's high-level transport,
 * because it must own the socket (cancellation), know the SMTP phase reached
 * (outcome classification) and refuse any insecure fallback. Both modules are
 * documented, standalone-usable parts of nodemailer, imported by their
 * documented paths, which nodemailer's package.json "exports" map lists:
 *   - SMTPConnection  require("nodemailer/lib/smtp-connection")
 *     https://nodemailer.com/extras/smtp-connection
 *   - MailComposer    require("nodemailer/lib/mail-composer")
 *     https://nodemailer.com/extras/mailcomposer
 *   - error fields (code, response, responseCode, command, originalCode) and
 *     codes (EAUTH, EENVELOPE, EMESSAGE, ETLS, ESOCKET, ECONNECTION,
 *     ETIMEDOUT, EPROTOCOL): https://nodemailer.com/errors
 *
 * Neither page states a stability guarantee for these fields, and the
 * "body read only after DATA 354" behaviour is observed, not documented. So
 * every behaviour the adapter depends on is pinned HERE, on the wire, against
 * the exact pinned version: an upgrade that changes any of it fails this file
 * before it can change an outcome classification.
 *
 * The servers are LOCAL TEST SERVERS on localhost (scripted dialogue /
 * smtp-server) with in-memory test certificates: NOT Titan, NOT delivery.
 *
 * r8 (the first Windows run): every test here that opened a connection failed
 * on Windows with ESOCKET / ECONNREFUSED. These clients use SMTPConnection
 * directly, so nodemailer resolves the host name with its OWN resolver and
 * connects to ONE of its addresses — which need not be the address the local
 * server listens on (listen('localhost') takes Node's first answer; on Windows
 * typically ::1). The clients now connect to the address the server ACTUALLY
 * listens on and present 'localhost' as the TLS server name, so the certificate
 * chain and the host name are verified exactly as before. Each test first
 * establishes, from the server's own record, that it reached its SMTP / TLS
 * phase: a refused connection reaches none, and never counts as a result.
 */
const require = createRequire(import.meta.url);
const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let certificates;
beforeAll(() => {
  certificates = createTestCertificates();
});
const servers = [];
afterEach(async () => {
  while (servers.length) await servers.pop().stop();
});

/** r8 — the TLS server name the test certificates are issued for, independent of the TCP address. */
const TLS_NAME = 'localhost';
/** Where a contract client connects: the fixture's ACTUAL listening address, with 'localhost' as the TLS name. */
const addressing = (local) => ({ host: local.host, port: local.port, servername: TLS_NAME });
const verifiedTls = () => ({ ca: certificates.ca, servername: TLS_NAME, rejectUnauthorized: true, minVersion: 'TLSv1.2' });
/** Node's certificate-verification codes the adapter classifies as TLS_FAILED — and nothing else. */
const CERTIFICATE_CODES = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT']);
/** Is this error a certificate verdict? A connection-level failure (ECONNREFUSED, …) never is. */
const isCertificateVerdict = (error) => Boolean(error) && (CERTIFICATE_CODES.has(error.originalCode) || CERTIFICATE_CODES.has(error.code));
/** The SMTP session began on the server: for implicit TLS only after a COMPLETED handshake. */
function expectSessionReached(record) {
  expect(record.tcpConnections, 'a TCP connection reached the local server').toBeGreaterThanOrEqual(1);
  expect(record.connections, 'the SMTP session began (implicit TLS: after a completed handshake)').toBe(1);
}
/** A nodemailer logger that keeps the SMTP transaction (debug: true), to show which phase the CLIENT reached. */
function transactionLog() {
  const lines = [];
  const logger = Object.fromEntries(['trace', 'debug', 'info', 'warn', 'error', 'fatal'].map((level) => [level, (data, message, ...args) => lines.push({ tnx: data?.tnx, text: util.format(message ?? '', ...args) })]));
  return { logger, lines };
}

describe('the dependency and the module paths', () => {
  // r7: 10.1.2 -> 10.1.4, the smallest release outside GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w and
  // GHSA-85x2-q946-cp5h (addressparser; >=3.0.0 <10.1.4). The behaviours below are re-verified on it.
  it('the installed nodemailer is exactly the pinned 10.1.4 (package.json and lockfile agree)', () => {
    const installed = require('nodemailer/package.json');
    const manifest = JSON.parse(readFileSync(path.join(BACKEND, 'package.json'), 'utf8'));
    const lock = JSON.parse(readFileSync(path.join(BACKEND, 'package-lock.json'), 'utf8'));
    expect(installed.version).toBe('10.1.4');
    expect(manifest.dependencies.nodemailer).toBe('10.1.4');
    expect(lock.packages['node_modules/nodemailer'].version).toBe('10.1.4');
  });

  it('the two modules are entries of nodemailer\'s public "exports" map (not deep file paths)', () => {
    const { exports } = require('nodemailer/package.json');
    for (const entry of ['./lib/smtp-connection', './lib/mail-composer']) {
      expect(exports[entry]?.import, entry).toMatch(/^\.\/dist\/esm\//);
    }
  });

  it('application code imports nodemailer ONLY by those two documented paths, and only in the SMTP adapter', () => {
    const found = new Map();
    const walk = (directory) => {
      for (const name of readdirSync(directory)) {
        const file = path.join(directory, name);
        if (statSync(file).isDirectory()) walk(file);
        else if (file.endsWith('.js') || file.endsWith('.mjs')) {
          for (const match of readFileSync(file, 'utf8').matchAll(/from\s+['"](nodemailer[^'"]*)['"]|import\(\s*['"](nodemailer[^'"]*)['"]|require\(\s*['"](nodemailer[^'"]*)['"]/g)) {
            const specifier = match[1] ?? match[2] ?? match[3];
            found.set(specifier, [...(found.get(specifier) ?? []), path.relative(BACKEND, file).split(path.sep).join('/')]);
          }
        }
      }
    };
    walk(path.join(BACKEND, 'src'));
    walk(path.join(BACKEND, 'scripts'));
    expect([...found.keys()].sort()).toEqual(['nodemailer/lib/mail-composer', 'nodemailer/lib/smtp-connection']);
    for (const files of found.values()) expect(files).toEqual(['src/integrations/notifications/smtpTransport.js']);
  });

  it('SMTPConnection has the documented methods and the documented `secure` property (false before any connection)', () => {
    for (const method of ['connect', 'login', 'send', 'quit', 'close']) expect(typeof SMTPConnection.prototype[method], method).toBe('function');
    const connection = new SMTPConnection({ host: 'localhost', port: 25, secure: false, logger: false });
    expect(connection.secure).toBe(false);
  });
});

/**
 * One SMTP transaction with SMTPConnection used exactly as the adapter uses
 * it, against a scripted local server. Resolves with what the adapter would
 * observe — including failures nodemailer reports ONLY through its 'error'
 * event (connect / greeting / STARTTLS), which the adapter handles.
 */
async function transaction({ replies = {}, pipelining = false, plaintext = false, socketTimeout = 2_000 } = {}) {
  const local = await startScriptedSmtpServer({ certificate: plaintext ? undefined : certificates.localhost, pipelining, starttls: plaintext, replies });
  servers.push(local);
  const connection = new SMTPConnection({
    ...addressing(local),
    secure: !plaintext,
    requireTLS: plaintext,
    opportunisticTLS: false,
    tls: verifiedTls(),
    connectionTimeout: 2_000,
    greetingTimeout: 2_000,
    socketTimeout,
    logger: false,
  });
  const observed = { reads: 0, serverEventsAtFirstRead: null, errorEvents: [], connected: false };
  const outcome = await new Promise((resolve) => {
    connection.on('error', (error) => {
      observed.errorEvents.push(error.code);
      // Give a pending callback the chance to report first (as in the adapter, the first report wins).
      setTimeout(() => resolve({ via: 'error-event', error }), 100);
    });
    connection.connect(() => {
      observed.connected = true;
      observed.secureAfterConnect = connection.secure;
      connection.login({ user: 'notifications@qa-valida.example.test', pass: 'qa-contract-marker' }, (loginError) => {
        if (loginError) return resolve({ via: 'login', error: loginError });
        const body = new Readable({
          read() {
            observed.reads += 1;
            if (observed.serverEventsAtFirstRead === null) observed.serverEventsAtFirstRead = [...local.record.events];
            this.push('Subject: QA contract\r\n\r\nQA synthetic body\r\n');
            this.push(null);
          },
        });
        return connection.send({ from: 'notifications@qa-valida.example.test', to: ['recruitment@qa-valida.example.test'] }, body, (error, info) =>
          resolve(error ? { via: 'send', error } : { via: 'send', info }),
        );
      });
    });
  });
  try {
    connection.close();
  } catch {
    // already closed
  }
  return { ...outcome, ...observed, server: local.record };
}

const fields = (error) => ({ code: error.code, command: error.command, responseCode: error.responseCode });

describe.each([
  ['sequential dialogue', false],
  ['PIPELINING dialogue', true],
])('SMTPConnection on the wire — %s (scripted LOCAL server, not Titan)', (_label, pipelining) => {
  it('accepted: `secure` is true over TLS; the body is read ONCE and only after the server answered DATA', async () => {
    const result = await transaction({ pipelining });
    expectSessionReached(result.server);
    expect(result.server.events).toEqual(expect.arrayContaining(['EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'BODY']));
    expect(result.secureAfterConnect).toBe(true);
    expect(result.info.accepted).toEqual(['recruitment@qa-valida.example.test']);
    expect(result.reads).toBe(1);
    expect(result.serverEventsAtFirstRead.at(-1)).toBe('DATA');
    expect(result.server.bodies).toHaveLength(1);
  });

  it.each([
    ['MAIL FROM refused', { MAIL: '553 5.7.1 Sender address not owned by user' }, { code: 'EENVELOPE', command: 'MAIL FROM', responseCode: 553 }],
    ['RCPT TO refused', { RCPT: '550 5.1.1 User unknown' }, { code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550 }],
    ['DATA command refused (before the body)', { DATA: '554 5.7.1 Transaction refused' }, { code: 'EENVELOPE', command: 'DATA', responseCode: 554 }],
    ['DATA command deferred (before the body)', { DATA: '451 4.3.0 Try again later' }, { code: 'EENVELOPE', command: 'DATA', responseCode: 451 }],
  ])('%s: EENVELOPE with the command and reply code; the body is NEVER read; nothing reaches the server', async (_name, replies, expected) => {
    const result = await transaction({ replies, pipelining });
    expectSessionReached(result.server);
    expect(result.server.events).toContain(expected.command.split(' ')[0]);
    expect(result.via).toBe('send');
    expect(fields(result.error)).toEqual(expected);
    expect(result.reads).toBe(0);
    expect(result.server.bodies.every((body) => body.length === 0)).toBe(true);
  });

  it.each([
    ['rejected', '554 5.7.1 Message rejected', 554],
    ['deferred', '451 4.3.0 Try again later', 451],
  ])('an explicit final reply after the body (%s): EMESSAGE, command DATA, with the reply code', async (_name, final, responseCode) => {
    const result = await transaction({ replies: { final }, pipelining });
    expectSessionReached(result.server);
    expect(result.server.events).toContain('BODY');
    expect(fields(result.error)).toEqual({ code: 'EMESSAGE', command: 'DATA', responseCode });
    expect(result.reads).toBe(1);
  });

  it('NO final reply after the body (connection lost): never EMESSAGE, no reply code — distinguishable from a refusal', async () => {
    const result = await transaction({ replies: { final: 'drop' }, pipelining });
    expectSessionReached(result.server);
    expect(result.server.bodies).toHaveLength(1);
    expect(result.error.code).toBe('ECONNECTION');
    expect(result.error.responseCode).toBeUndefined();
  });

  it('NO final reply after the body (server silent): ETIMEDOUT, no reply code', async () => {
    const result = await transaction({ replies: { final: 'hang' }, pipelining, socketTimeout: 400 });
    expectSessionReached(result.server);
    expect(result.server.events).toContain('BODY');
    expect(result.error.code).toBe('ETIMEDOUT');
    expect(result.error.responseCode).toBeUndefined();
  });

  it.each([
    ['refused', '535 5.7.8 Authentication credentials invalid', 535],
    ['temporary', '454 4.7.0 Temporary authentication failure', 454],
  ])('authentication %s: EAUTH with the reply code', async (_name, AUTH, responseCode) => {
    const result = await transaction({ replies: { AUTH }, pipelining });
    expectSessionReached(result.server);
    expect(result.server.events).toContain('AUTH');
    expect(result.via).toBe('login');
    expect(fields(result.error)).toEqual({ code: 'EAUTH', command: 'AUTH PLAIN', responseCode });
    expect(result.server.events).not.toContain('MAIL');
  });
});

describe('failures reported only through the \'error\' event (the adapter listens to it)', () => {
  it('a refusing greeting: EPROTOCOL with the reply code; the connect callback is never called', async () => {
    const result = await transaction({ replies: { greeting: '554 5.3.2 No SMTP service here' } });
    expectSessionReached(result.server); // the handshake completed; the refusing greeting was sent
    expect(result.via).toBe('error-event');
    expect(fields(result.error)).toEqual({ code: 'EPROTOCOL', command: 'CONN', responseCode: 554 });
    expect(result.connected).toBe(false);
  });

  it.each([
    ['refused', '502 5.5.1 STARTTLS not supported', 502],
    ['temporarily unavailable', '454 4.7.0 TLS not available due to temporary reason', 454],
  ])('required STARTTLS %s: ETLS with the reply code; never connected, never encrypted, no AUTH sent', async (_name, STARTTLS, responseCode) => {
    const result = await transaction({ plaintext: true, replies: { STARTTLS } });
    expectSessionReached(result.server);
    expect(result.server.events).toContain('STARTTLS');
    expect(result.via).toBe('error-event');
    expect(fields(result.error)).toEqual({ code: 'ETLS', command: 'STARTTLS', responseCode });
    expect(result.connected).toBe(false);
    expect(result.server.events).not.toContain('AUTH');
  });

  it.each([
    ['untrusted', 'untrusted', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'],
    ['wrong host', 'wrongHost', 'ERR_TLS_CERT_ALTNAME_INVALID'],
    ['expired', 'expired', 'CERT_HAS_EXPIRED'],
  ])('a STARTTLS certificate that fails verification (%s): ESOCKET carrying Node\'s certificate code as originalCode; no login', async (_name, which, originalCode) => {
    const local = await startLocalSmtpServer({ mode: 'starttls', certificate: certificates[which], credentials: { username: 'u@qa-valida.example.test', password: 'qa-contract-marker' } });
    servers.push(local);
    const log = transactionLog();
    const connection = new SMTPConnection({
      ...addressing(local),
      secure: false,
      requireTLS: true,
      tls: verifiedTls(),
      connectionTimeout: 2_000,
      greetingTimeout: 2_000,
      socketTimeout: 2_000,
      logger: log.logger,
      debug: true,
    });
    const error = await new Promise((resolve) => {
      connection.on('error', resolve);
      connection.connect(() => resolve(null));
    });
    connection.close();
    // First: the TLS phase was REACHED — the server accepted the connection and greeted, the client asked for
    // STARTTLS and the server agreed. Only then is the error a certificate verdict (never ECONNREFUSED).
    expect(local.record.tcpConnections).toBe(1);
    expect(local.record.connections).toBe(1);
    const client = log.lines.filter((line) => line.tnx === 'client').map((line) => line.text);
    const server = log.lines.filter((line) => line.tnx === 'server').map((line) => line.text);
    expect(client).toContain('STARTTLS');
    expect(server.some((text) => text.startsWith('220 ') && /TLS/i.test(text))).toBe(true);
    expect(isCertificateVerdict(error)).toBe(true);
    expect({ code: error.code, originalCode: error.originalCode }).toEqual({ code: 'ESOCKET', originalCode });
    expect(connection.secure).toBe(false);
    expect(local.record.authAttempts).toHaveLength(0);
  });
});

/** Connection-level failures: the client never reached the server, so no SMTP or TLS phase was tested. */
const CONNECTION_FAILURE_CODES = ['ECONNREFUSED', 'EAFNOSUPPORT', 'EADDRNOTAVAIL', 'ENETUNREACH', 'EHOSTUNREACH'];
/** How long a deliberately misdirected client may wait for its refusal (Windows retries the SYN before reporting it). */
const REFUSAL_WAIT_MS = 15_000;

describe('r8 — local addressing is deterministic, and a connection failure never stands in for a TLS result', () => {
  /** Replaces a method for the duration of `run`, restoring it afterwards whatever happens. */
  async function withStubs(stubs, run) {
    const originals = stubs.map(([object, method]) => [object, method, object[method]]);
    for (const [object, method, replacement] of stubs) object[method] = replacement;
    try {
      return await run();
    } finally {
      for (const [object, method, original] of originals) object[method] = original;
    }
  }

  it('the local servers report the address they ACTUALLY listen on, and a TLS handshake verified for the name localhost succeeds there', async () => {
    const scripted = await startScriptedSmtpServer({ certificate: certificates.localhost });
    servers.push(scripted);
    const local = await startLocalSmtpServer({ mode: 'implicit-tls', certificate: certificates.localhost, credentials: { username: 'u@qa-valida.example.test', password: 'qa-contract-marker' } });
    servers.push(local);
    for (const server of [scripted, local]) {
      expect(net.isIP(server.host), `${server.host} is an address, not a name`).not.toBe(0);
      expect(server.family).toBe(net.isIPv6(server.host) ? 'IPv6' : 'IPv4');
      const handshake = await new Promise((resolve) => {
        const socket = tls.connect({ host: server.host, port: server.port, ...verifiedTls() }, () => {
          resolve({ authorized: socket.authorized, protocol: socket.getProtocol() });
          socket.destroy();
        });
        socket.on('error', (error) => resolve({ error: error.code }));
      });
      expect(handshake).toMatchObject({ authorized: true });
      expect(['TLSv1.2', 'TLSv1.3']).toContain(handshake.protocol);
    }
  });

  it('a client whose OWN resolver gives the server name another address (the Windows failure, simulated on every platform) fails BEFORE any SMTP or TLS phase and is no certificate verdict; the actual address with the TLS name localhost completes the verified session', async () => {
    const local = await startScriptedSmtpServer({ certificate: certificates.localhost });
    servers.push(local);
    // The other loopback family — where this server is NOT listening (Windows: server on ::1, nodemailer on 127.0.0.1).
    const elsewhere = local.family === 'IPv6' ? '127.0.0.1' : '::1';
    const alias = `qa-r8-${randomBytes(4).toString('hex')}.localhost`; // unique: nodemailer caches resolutions by name
    const original4 = dns.Resolver.prototype.resolve4;
    const original6 = dns.Resolver.prototype.resolve6;
    const originalLookup = dns.lookup;
    const misdirected = await withStubs(
      [
        [dns.Resolver.prototype, 'resolve4', function resolve4(hostname, ...rest) {
          if (hostname !== alias) return original4.call(this, hostname, ...rest);
          return setImmediate(() => rest.at(-1)(null, net.isIPv4(elsewhere) ? [elsewhere] : []));
        }],
        [dns.Resolver.prototype, 'resolve6', function resolve6(hostname, ...rest) {
          if (hostname !== alias) return original6.call(this, hostname, ...rest);
          return setImmediate(() => rest.at(-1)(null, net.isIPv6(elsewhere) ? [elsewhere] : []));
        }],
        [dns, 'lookup', function lookup(hostname, options, callback) {
          if (hostname !== alias) return originalLookup.call(this, hostname, options, callback);
          const family = net.isIPv6(elsewhere) ? 6 : 4;
          const done = typeof options === 'function' ? options : callback;
          return setImmediate(() => (options?.all ? done(null, [{ address: elsewhere, family }]) : done(null, elsewhere, family)));
        }],
      ],
      async () => {
        // Windows reports a refused loopback connection only after re-sending the SYN (a second or more), so this
        // attempt gets a generous connection timeout: the result must be the refusal itself, not a timeout.
        const connection = new SMTPConnection({ host: alias, port: local.port, servername: TLS_NAME, secure: true, tls: verifiedTls(), connectionTimeout: REFUSAL_WAIT_MS, greetingTimeout: 2_000, socketTimeout: 2_000, logger: false });
        const error = await new Promise((resolve) => {
          connection.on('error', resolve);
          connection.connect(() => resolve(null));
        });
        connection.close();
        return error;
      },
    );
    expect(misdirected, 'the misdirected client must fail').not.toBeNull();
    expect(CONNECTION_FAILURE_CODES).toContain(misdirected.originalCode ?? misdirected.code);
    expect(isCertificateVerdict(misdirected)).toBe(false);
    expect(local.record).toMatchObject({ tcpConnections: 0, connections: 0, tlsClientErrors: [] });

    const direct = new SMTPConnection({ ...addressing(local), secure: true, tls: verifiedTls(), connectionTimeout: 2_000, greetingTimeout: 2_000, socketTimeout: 2_000, logger: false });
    const connected = await new Promise((resolve) => {
      direct.on('error', (error) => resolve(error));
      direct.connect(() => resolve(true));
    });
    expect(connected).toBe(true);
    expect(direct.secure).toBe(true);
    direct.close();
    expectSessionReached(local.record);
  }, REFUSAL_WAIT_MS + 10_000);

  it('connecting by address does not weaken host-name verification: implicit TLS with a certificate for another name is refused DURING the handshake (ERR_TLS_CERT_ALTNAME_INVALID)', async () => {
    const local = await startScriptedSmtpServer({ certificate: certificates.wrongHost });
    servers.push(local);
    const connection = new SMTPConnection({ ...addressing(local), secure: true, tls: verifiedTls(), connectionTimeout: 2_000, greetingTimeout: 2_000, socketTimeout: 2_000, logger: false });
    const error = await new Promise((resolve) => {
      connection.on('error', resolve);
      connection.connect(() => resolve(null));
    });
    connection.close();
    // Reached: the TCP connection; not reached: an SMTP session (the handshake never completed).
    expect(local.record.tcpConnections).toBe(1);
    expect(local.record.connections).toBe(0);
    expect(isCertificateVerdict(error)).toBe(true);
    expect(error.originalCode ?? error.code).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
  });

  it('a certificate that names ONLY localhost (no address — as for ::1 on Windows) verifies at the actual address, because the name checked is the TLS name', async () => {
    const local = await startScriptedSmtpServer({ certificate: certificates.localhostNameOnly });
    servers.push(local);
    const connection = new SMTPConnection({ ...addressing(local), secure: true, tls: verifiedTls(), connectionTimeout: 2_000, greetingTimeout: 2_000, socketTimeout: 2_000, logger: false });
    const connected = await new Promise((resolve) => {
      connection.on('error', (error) => resolve(error));
      connection.connect(() => resolve(true));
    });
    expect(connected).toBe(true);
    expect(connection.secure).toBe(true);
    connection.close();
    expectSessionReached(local.record);
    expect(local.record.tlsClientErrors).toEqual([]);
  });

  it('the identity verified is the TLS server NAME, not the TCP address: a valid certificate for localhost (which also lists 127.0.0.1) is refused when another name is expected, at the very same address', async () => {
    // If the address were what is verified, the 127.0.0.1 entry would let this pass on IPv4 — and on a Windows
    // machine listening on ::1 (not in the certificate) the positive tests would fail; neither is the case.
    const local = await startScriptedSmtpServer({ certificate: certificates.localhost });
    servers.push(local);
    const otherName = 'wrong-host.example.test';
    const connection = new SMTPConnection({ host: local.host, port: local.port, servername: otherName, secure: true, tls: { ...verifiedTls(), servername: otherName }, connectionTimeout: 2_000, greetingTimeout: 2_000, socketTimeout: 2_000, logger: false });
    const error = await new Promise((resolve) => {
      connection.on('error', resolve);
      connection.connect(() => resolve(null));
    });
    connection.close();
    expect(local.record.tcpConnections).toBe(1);
    expect(local.record.connections).toBe(0);
    expect(isCertificateVerdict(error)).toBe(true);
    expect(error.originalCode ?? error.code).toBe('ERR_TLS_CERT_ALTNAME_INVALID');
  });

  it('isCertificateVerdict: only Node\'s certificate codes count — a refused, unreachable or reset connection never does', () => {
    expect(isCertificateVerdict({ code: 'ESOCKET', originalCode: 'CERT_HAS_EXPIRED' })).toBe(true);
    expect(isCertificateVerdict({ code: 'ESOCKET', originalCode: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' })).toBe(true);
    for (const code of [...CONNECTION_FAILURE_CODES, 'ECONNRESET', 'ETIMEDOUT']) {
      expect(isCertificateVerdict({ code: 'ESOCKET', originalCode: code }), code).toBe(false);
      expect(isCertificateVerdict({ code }), code).toBe(false);
    }
    expect(isCertificateVerdict(null)).toBe(false);
  });
});

describe('MailComposer (documented options the adapter uses)', () => {
  it('build() returns a Promise of the message; Message-ID, Date and custom headers are as given; no X-Mailer', async () => {
    const built = new MailComposer({
      from: { name: 'Valida Careers', address: 'notifications@qa-valida.example.test' },
      to: 'recruitment@qa-valida.example.test',
      replyTo: 'careers@qa-valida.example.test',
      subject: 'QA contract',
      text: 'QA synthetic text',
      html: '<p>QA synthetic html</p>',
      messageId: '<0123456789abcdef0123456789abcdef.b6@qa-valida.example.test>',
      date: new Date('2026-10-16T12:00:00Z'),
      headers: { 'Auto-Submitted': 'auto-generated' },
      xMailer: false,
      disableFileAccess: true,
      disableUrlAccess: true,
      textEncoding: 'quoted-printable',
    })
      .compile()
      .build();
    expect(typeof built.then).toBe('function');
    const head = (await built).toString('utf8').split('\r\n\r\n')[0];
    expect(head).toContain('Message-ID: <0123456789abcdef0123456789abcdef.b6@qa-valida.example.test>');
    expect(head).toContain('Date: Fri, 16 Oct 2026 12:00:00 +0000');
    expect(head).toContain('Auto-Submitted: auto-generated');
    expect(head).toContain('Reply-To: careers@qa-valida.example.test');
    expect(head).not.toMatch(/^X-Mailer:/im);
  });

  it('disableFileAccess / disableUrlAccess: content pointing at a file or a URL is refused — nothing read, nothing fetched', async () => {
    const probes = [];
    const listener = net.createServer((socket) => {
      probes.push(1);
      socket.destroy();
    });
    await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
    const base = { from: 'notifications@qa-valida.example.test', to: 'recruitment@qa-valida.example.test', subject: 'QA', disableFileAccess: true, disableUrlAccess: true };
    try {
      await expect(new MailComposer({ ...base, text: { path: path.join(BACKEND, 'package.json') } }).compile().build()).rejects.toMatchObject({ code: 'EFILEACCESS' });
      await expect(new MailComposer({ ...base, html: { href: `http://127.0.0.1:${listener.address().port}/qa` } }).compile().build()).rejects.toMatchObject({ code: 'EURLACCESS' });
      expect(probes).toHaveLength(0);
    } finally {
      await new Promise((resolve) => listener.close(resolve));
    }
  });
});
