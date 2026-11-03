/**
 * DIAGNOSTIC (B6 r8) — which loopback address does each side of the local
 * SMTP contract tests use on THIS machine?
 *
 *   cd backend
 *   node tests/diagnostics/localhost-addressing.mjs
 *
 * Not a test (vitest does not pick it up) and not part of the product. It
 * starts the scripted LOCAL test SMTP server (tests/fixtures/scriptedSmtpServer.js,
 * implicit TLS, in-memory test certificate for the name `localhost`) and
 * reports, one JSON line per step:
 *   1. environment     — Node version, OS, Node's default DNS result order and
 *                        address-family auto-selection;
 *   2. lookup          — what Node's dns.lookup gives for 'localhost' (all
 *                        answers, and the first: the one listen('localhost') binds);
 *   3. nodemailer-dns  — what nodemailer's OWN resolution path sees: the
 *                        dns.Resolver answers for 'localhost' and whether a
 *                        non-loopback IPv4 / IPv6 interface exists (true/false
 *                        only; no interface address is printed);
 *   4. fixture         — the address the test server ACTUALLY listens on;
 *   5. r7-form         — SMTPConnection({ host: 'localhost' }) as the r7 contract
 *                        tests connected: the address nodemailer chose and the result;
 *   6. r8-form         — SMTPConnection({ host: <fixture address>, servername:
 *                        'localhost' }) as r8 connects: the result;
 *   7. node-connect    — Node's own tls.connect({ host: 'localhost' }) as the SMTP
 *                        adapter connects (all answers, family auto-selection).
 * Each connection step also reports what the SERVER saw (TCP connections,
 * SMTP sessions begun, failed handshakes), so a refused connection can never
 * be mistaken for a certificate result.
 *
 * Only loopback addresses, error CODES and fixed tokens are printed — no
 * credential, no message, no interface address, no personal data. Nothing is
 * sent anywhere: every connection is to the local test server, which accepts
 * nothing for delivery and is closed at the end.
 *
 * Exit code: 0 when the r8 form completes a verified TLS session, 1 otherwise.
 * The r7 form is informational: on a machine where nodemailer's resolver and
 * listen('localhost') disagree (the first Windows run), it fails BEFORE any
 * TLS phase — that is the condition r8 removes from the tests.
 */
import dns from 'node:dns';
import net from 'node:net';
import os from 'node:os';
import tls from 'node:tls';
import util from 'node:util';
import SMTPConnection from 'nodemailer/lib/smtp-connection';
import { createTestCertificates } from '../fixtures/testCertificates.js';
import { startScriptedSmtpServer } from '../fixtures/scriptedSmtpServer.js';

const TLS_NAME = 'localhost';
// Generous: Windows reports a refused loopback connection only after re-sending the SYN.
const TIMEOUT_MS = 15_000;
const print = (step, data) => process.stdout.write(`${JSON.stringify({ step, ...data })}\n`);
const isLoopback = (address) => typeof address === 'string' && (address === '::1' || /^127\./.test(address) || /^::ffff:127\./.test(address));
/** Prints an address only when it is a loopback address. */
const safeAddress = (address) => (isLoopback(address) ? address : address ? 'non-loopback (not printed)' : null);
const codeOf = (error) => error?.code ?? error?.name ?? 'unknown';
const settle = (promise) => promise.then((value) => ({ value }), (error) => ({ error: codeOf(error) }));

// 1. environment
print('environment', {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  osRelease: os.release(),
  dnsDefaultResultOrder: typeof dns.getDefaultResultOrder === 'function' ? dns.getDefaultResultOrder() : 'unavailable',
  netAutoSelectFamily: typeof net.getDefaultAutoSelectFamily === 'function' ? net.getDefaultAutoSelectFamily() : 'unavailable',
});

// 2. lookup
const all = await settle(dns.promises.lookup('localhost', { all: true }));
const first = await settle(dns.promises.lookup('localhost'));
print('lookup', {
  all: all.error ? { error: all.error } : all.value.map((entry) => ({ address: safeAddress(entry.address), family: entry.family })),
  first: first.error ? { error: first.error } : { address: safeAddress(first.value.address), family: first.value.family },
});

// 3. nodemailer's resolution path (dns.Resolver, filtered by the families of non-internal interfaces)
const resolver = new dns.promises.Resolver();
const resolved4 = await settle(resolver.resolve4('localhost'));
const resolved6 = await settle(resolver.resolve6('localhost'));
const interfaces = Object.values(os.networkInterfaces()).flat().filter(Boolean);
const familyOf = (entry) => (entry.family === 4 || entry.family === 'IPv4' ? 4 : 6);
print('nodemailer-dns', {
  resolve4: resolved4.error ? { error: resolved4.error } : resolved4.value.map(safeAddress),
  resolve6: resolved6.error ? { error: resolved6.error } : resolved6.value.map(safeAddress),
  nonInternalIPv4: interfaces.some((entry) => !entry.internal && familyOf(entry) === 4),
  nonInternalIPv6: interfaces.some((entry) => !entry.internal && familyOf(entry) === 6),
});

// 4. fixture
const certificates = createTestCertificates();
const verifiedTls = { ca: certificates.ca, servername: TLS_NAME, rejectUnauthorized: true, minVersion: 'TLSv1.2' };
const server = await startScriptedSmtpServer({ certificate: certificates.localhost });
print('fixture', { listening: { address: safeAddress(server.host), family: server.family } });

const serverSaw = (before) => ({
  tcpConnections: server.record.tcpConnections - before.tcpConnections,
  smtpSessionsBegun: server.record.connections - before.connections,
  failedHandshakes: server.record.tlsClientErrors.slice(before.tlsClientErrors).map(String),
});
const snapshot = () => ({ tcpConnections: server.record.tcpConnections, connections: server.record.connections, tlsClientErrors: server.record.tlsClientErrors.length });

/** One SMTPConnection attempt (implicit TLS, certificate verified for 'localhost'); resolves with what it reached. */
async function smtpAttempt(host) {
  const before = snapshot();
  const resolvedAs = [];
  const logger = Object.fromEntries(['trace', 'debug', 'info', 'warn', 'error', 'fatal'].map((level) => [level, (data, message, ...args) => {
    if (data?.tnx === 'dns') resolvedAs.push(util.format(message ?? '', ...args).replace(/^Resolved (\S+) as (\S+).*$/, (_m, name, address) => `${name} -> ${safeAddress(address)}`));
  }]));
  const connection = new SMTPConnection({ host, port: server.port, servername: TLS_NAME, secure: true, tls: verifiedTls, connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS, logger, debug: true });
  const error = await new Promise((resolve) => {
    connection.once('error', resolve);
    connection.connect(() => resolve(null));
  });
  const outcome = error
    ? { result: 'failed', code: error.code ?? null, originalCode: error.originalCode ?? null }
    : { result: 'verified TLS session (greeting received)', secure: connection.secure };
  connection.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { nodemailerResolved: resolvedAs, ...outcome, server: serverSaw(before) };
}

// 5. the r7 form — nodemailer resolves 'localhost' itself
print('r7-form', { host: 'localhost', ...(await smtpAttempt('localhost')) });

// 6. the r8 form — the fixture's actual address, TLS name 'localhost'
const r8 = await smtpAttempt(server.host);
print('r8-form', { host: safeAddress(server.host), ...r8 });

// 7. Node's own connect, as the SMTP adapter does (src/integrations/notifications/smtpTransport.js)
{
  const before = snapshot();
  const outcome = await new Promise((resolve) => {
    const socket = tls.connect({ host: 'localhost', port: server.port, ...verifiedTls, autoSelectFamily: true, timeout: TIMEOUT_MS }, () => {
      // Wait for the server's greeting, so the server too has completed the handshake and begun the session.
      socket.once('data', (greeting) => {
        resolve({ result: socket.authorized ? 'verified TLS session (greeting received)' : 'unverified', greeting: /^220 /.test(String(greeting)), remoteAddress: safeAddress(socket.remoteAddress) });
        socket.end('QUIT\r\n');
      });
    });
    socket.once('error', (error) => resolve({ result: 'failed', code: codeOf(error) }));
    socket.once('timeout', () => {
      resolve({ result: 'failed', code: 'TIMEOUT' });
      socket.destroy();
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  print('node-connect', { host: 'localhost', ...outcome, server: serverSaw(before) });
}

await server.stop();
const ok = r8.result.startsWith('verified') && r8.server.smtpSessionsBegun === 1;
print('summary', { r8FormVerifiedSession: ok, exitCode: ok ? 0 : 1 });
process.exitCode = ok ? 0 : 1;
