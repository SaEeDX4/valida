/**
 * LOCAL SMTP CAPTURE SERVER for the E2E run — a child process. TEST ONLY.
 *
 * It runs the backend's own B6 test server (backend/tests/fixtures/
 * localSmtpServer.js: the maintained `smtp-server` package) with a TEST
 * certificate for "localhost" issued, in memory, by a throwaway test CA
 * (backend/tests/fixtures/testCertificates.js). The CA certificate — public,
 * never a key — is written to a file so the backend process can trust it
 * through Node's standard NODE_EXTRA_CA_CERTS; the backend's SMTP adapter is
 * unchanged and still verifies the chain and the host name.
 *
 * WHAT IT PROVES: the backend's real SMTP adapter connected over TLS,
 * verified the server, logged in, and submitted each message, which this
 * server accepted (250) or refused (as configured below). It is NOT Titan or
 * Bluehost and proves nothing about DNS, SPF, DKIM, DMARC, deliverability or
 * inbox placement. Nothing it receives leaves the machine.
 *
 * Each accepted or refused message is written to the capture directory as
 * <n>.eml (the raw message) and <n>.json (envelope and disposition). The
 * password is never written anywhere; auth.json records only whether each
 * login matched and was made over TLS.
 *
 * Environment (set by globalSetup):
 *   E2E_SMTP_USERNAME / E2E_SMTP_PASSWORD   the synthetic login it accepts
 *   E2E_SMTP_CAPTURE_DIR                    where messages are written
 *   E2E_SMTP_CA_FILE                        where the test CA certificate is written
 *   E2E_SMTP_REJECT_RECIPIENTS              comma-separated addresses refused at RCPT
 *                                           with 550 5.1.1 (the partial-failure case)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startLocalSmtpServer } from '../../backend/tests/fixtures/localSmtpServer.js';
import { createTestCertificates } from '../../backend/tests/fixtures/testCertificates.js';

const { E2E_SMTP_USERNAME: username, E2E_SMTP_PASSWORD: password, E2E_SMTP_CAPTURE_DIR: captureDir, E2E_SMTP_CA_FILE: caFile } = process.env;
if (!username || !password || !captureDir || !caFile) {
  console.error('smtpCapture: missing configuration');
  process.exit(2);
}
const rejected = new Set(
  (process.env.E2E_SMTP_REJECT_RECIPIENTS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),
);

mkdirSync(captureDir, { recursive: true });
const certificates = createTestCertificates();
writeFileSync(caFile, certificates.ca);

const server = await startLocalSmtpServer({
  mode: 'implicit-tls',
  certificate: certificates.localhost,
  credentials: { username, password },
  behaviour: {
    rcptTo: (address) =>
      rejected.has(String(address).toLowerCase())
        ? { code: 550, text: '5.1.1 QA local test server: recipient refused (synthetic partial-failure case)' }
        : null,
  },
});

let written = 0;
let rcptWritten = 0;
function flush() {
  const { record } = server;
  while (written < record.messages.length) {
    const message = record.messages[written];
    written += 1;
    const base = path.join(captureDir, String(written).padStart(4, '0'));
    writeFileSync(`${base}.eml`, message.raw);
    writeFileSync(
      `${base}.json`,
      JSON.stringify(
        {
          index: written,
          receivedAt: new Date().toISOString(),
          mailFrom: message.mailFrom,
          rcptTo: message.rcptTo,
          dsn: message.dsn,
          disposition: message.disposition,
          sizeBytes: message.raw.length,
        },
        null,
        2,
      ),
    );
  }
  // Every RCPT the server saw, accepted or refused, in order (a refused RCPT has no message).
  if (rcptWritten !== record.rcptTo.length) {
    rcptWritten = record.rcptTo.length;
    writeFileSync(path.join(captureDir, 'rcpt.json'), JSON.stringify(record.rcptTo.map((address) => ({ address, refused: rejected.has(address.toLowerCase()) })), null, 2));
  }
  writeFileSync(
    path.join(captureDir, 'auth.json'),
    JSON.stringify(
      {
        tcpConnections: record.tcpConnections,
        sessions: record.connections,
        logins: record.authAttempts.map(({ username: user, matched, secure }) => ({ username: user, matched, secure })),
        mailFrom: record.mailFrom.map(({ address, secure, user }) => ({ address, secure, authenticatedAs: user })),
      },
      null,
      2,
    ),
  );
}
const timer = setInterval(flush, 50);

async function stop() {
  clearInterval(timer);
  flush();
  await server.stop();
  process.exit(0);
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

console.log(`READY ${JSON.stringify({ port: server.port, family: server.family })}`);
