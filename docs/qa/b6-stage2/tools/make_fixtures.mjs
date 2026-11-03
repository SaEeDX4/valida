// Review fixtures for B6 Stage 2 — SYNTHETIC values only. Run with the backend's node_modules.
import fs from 'node:fs';
import path from 'node:path';
const [backendRoot, outDir, logoPreviewRoot, logoPreviewOut] = process.argv.slice(2);
const imp = (root, rel) => import(path.join(root, rel));
const { renderApplicationAcknowledgement, renderApplicationReceivedInternal, TEMPLATE_VERSION } = await imp(backendRoot, 'src/integrations/notifications/templates.js');
const { createNotificationService, NOTIFICATION_EVENTS } = await imp(backendRoot, 'src/integrations/notifications/notificationService.js');
const { createSmtpTransport } = await imp(backendRoot, 'src/integrations/notifications/smtpTransport.js');
const { startLocalSmtpServer } = await imp(backendRoot, 'tests/fixtures/localSmtpServer.js');
const { createTestCertificates } = await imp(backendRoot, 'tests/fixtures/testCertificates.js');

const SYNTHETIC = { applicationId: '0123456789abcdef01234567', job: { title: 'Cybersecurity Specialist', slug: 'cybersecurity-specialist' }, submittedAt: new Date('2026-10-26T15:42:00.000Z'), candidateEmail: 'candidate@synthetic.example.invalid' };
const LONG = { ...SYNTHETIC, job: { title: `${'Principal Offensive Security Engineer, Cloud Infrastructure and Identity Platforms '.repeat(2)}`.slice(0, 160), slug: Array.from({ length: 18 }, (_, i) => `seg${String(i).padStart(3, '0')}`).join('-').slice(0, 120) } };
const write = (name, data) => fs.writeFileSync(path.join(outDir, name), data);
const index = [];
for (const [name, render, values] of [
  ['internal', renderApplicationReceivedInternal, SYNTHETIC],
  ['acknowledgement', renderApplicationAcknowledgement, SYNTHETIC],
  ['internal-long-values', renderApplicationReceivedInternal, LONG],
]) {
  const out = render(values);
  write(`SYNTHETIC-${name}.html`, out.html);
  write(`SYNTHETIC-${name}.txt`, out.text);
  write(`SYNTHETIC-${name}.subject.txt`, `${out.subject}\n`);
  index.push({ name, subject: out.subject, htmlBytes: Buffer.byteLength(out.html), textBytes: Buffer.byteLength(out.text) });
}

// EML: exactly what the REAL adapter submits, captured by the LOCAL SMTP TEST SERVER (not Titan; nothing leaves the machine).
const USERNAME = 'notifications@synthetic.example.invalid';
const PASSWORD = 'synthetic-local-test-password';
const certificates = createTestCertificates();
const local = await startLocalSmtpServer({ certificate: certificates.localhost, credentials: { username: USERNAME, password: PASSWORD }, behaviour: { dsn: true } });
const transport = createSmtpTransport({ host: 'localhost', port: local.port, security: 'implicit-tls', username: USERNAME, password: PASSWORD, timeoutMs: 5000, trustedCa: certificates.ca, clock: () => new Date('2026-10-26T15:42:05.000Z') });
const service = createNotificationService({ transport, timeoutMs: 5000, fromAddress: USERNAME, fromName: 'Valida Careers', replyTo: 'careers@synthetic.example.invalid', internalRecipient: 'hr@synthetic.example.invalid', acknowledgementEnabled: true, recipientAllowlist: null });
for (const [name, event] of [['internal', NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL], ['acknowledgement', NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT]]) {
  const before = local.record.messages.length;
  const outcome = await service.deliver(event, SYNTHETIC);
  if (outcome.status !== 'SENT') throw new Error(`${name}: ${JSON.stringify(outcome)}`);
  const raw = local.record.messages[before].raw;
  write(`SYNTHETIC-${name}.eml`, raw);
  index.find((entry) => entry.name === name).emlBytes = raw.length;
}
await transport.close();
await local.stop();
write('fixtures-index.json', `${JSON.stringify({ templateVersion: TEMPLATE_VERSION, node: process.version, generatedFrom: 'working copy (pre-approval build: no logo)', fixtures: index }, null, 2)}\n`);

// HTML for the WITH-LOGO previews only: rendered by the validated-but-UNAPPLIED logo patch (scratch copy),
// with the CID reference pointed at the candidate file for the browser. Not MIME output; not integration.
if (logoPreviewRoot) {
  const patched = await imp(logoPreviewRoot, 'src/integrations/notifications/templates.js');
  for (const [name, render] of [['internal', patched.renderApplicationReceivedInternal], ['acknowledgement', patched.renderApplicationAcknowledgement]]) {
    const html = render(SYNTHETIC).html.replace('src="cid:valida-logo.b6@cybervalida.com"', 'src="../logo/valida-logo-email-316x72.candidate.png"');
    fs.writeFileSync(path.join(logoPreviewOut, `PREVIEW-ONLY-with-candidate-logo-${name}.html`), html);
  }
}
console.log(JSON.stringify(index, null, 2));
