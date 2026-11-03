// What the REAL service and adapter do when the logo asset does not match its approved hash.
// usage: node logo_mismatch_probe.mjs <backend dir>   — run against a scratch copy whose asset was replaced (mutation M4).
// Local SMTP test server on loopback, synthetic values; nothing leaves the machine.
import path from 'node:path';
const backendRoot = process.argv[2];
const imp = (rel) => import(path.join(backendRoot, rel));
const { createNotificationService, NOTIFICATION_EVENTS } = await imp('src/integrations/notifications/notificationService.js');
const { createSmtpTransport } = await imp('src/integrations/notifications/smtpTransport.js');
const { startLocalSmtpServer } = await imp('tests/fixtures/localSmtpServer.js');
const { createTestCertificates } = await imp('tests/fixtures/testCertificates.js');
const USERNAME = 'notifications@synthetic.example.invalid', PASSWORD = 'synthetic-local-test-password';
const certificates = createTestCertificates();
const local = await startLocalSmtpServer({ certificate: certificates.localhost, credentials: { username: USERNAME, password: PASSWORD }, behaviour: { dsn: true } });
const transport = createSmtpTransport({ host: 'localhost', port: local.port, security: 'implicit-tls', username: USERNAME, password: PASSWORD, timeoutMs: 5000, trustedCa: certificates.ca });
const service = createNotificationService({ transport, timeoutMs: 5000, fromAddress: USERNAME, fromName: 'Valida Careers', replyTo: 'careers@synthetic.example.invalid', internalRecipient: 'hr@synthetic.example.invalid', acknowledgementEnabled: true, recipientAllowlist: null });
const input = { applicationId: '0123456789abcdef01234567', job: { title: 'Cybersecurity Specialist', slug: 'cybersecurity-specialist' }, submittedAt: new Date('2026-10-26T15:42:00.000Z'), candidateEmail: 'candidate@synthetic.example.invalid' };
for (const event of [NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT]) {
  let outcome;
  try { outcome = await service.deliver(event, input); } catch (error) { outcome = { threw: String(error?.message ?? error) }; }
  console.log(event, JSON.stringify(outcome));
}
console.log('messages that reached the local SMTP server:', local.record.messages.length);
console.log('SMTP sessions that reached MAIL FROM:', local.record.mailFrom.length);
await transport.close();
await local.stop();
