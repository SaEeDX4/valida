// Review fixtures for the b6-3 build (C2 masthead + P-04, OD-2026-11-02-01) — SYNTHETIC values only.
// Derived from docs/qa/b6-stage2/tools/make_fixtures_integrated.mjs; adds the acknowledgement with long values.
// usage: node make_fixtures_b6_3.mjs <backend dir> <fixtures out dir> <previews out dir>
// The EML files are exactly what the REAL adapter submitted to the LOCAL SMTP TEST SERVER (not Titan; nothing leaves the machine).
// The preview HTML is the HTML part OF THAT EML with its cid: reference replaced by a data: URI made from the
// image part OF THE SAME EML — so a browser shows the bytes the message actually carries. Browser previews are
// not email-client evidence.
import fs from 'node:fs';
import path from 'node:path';
const [backendRoot, outDir, previewDir] = process.argv.slice(2);
const imp = (rel) => import(path.join(backendRoot, rel));
const { renderApplicationAcknowledgement, renderApplicationReceivedInternal, TEMPLATE_VERSION } = await imp('src/integrations/notifications/templates.js');
const { createNotificationService, NOTIFICATION_EVENTS } = await imp('src/integrations/notifications/notificationService.js');
const { createSmtpTransport } = await imp('src/integrations/notifications/smtpTransport.js');
const { EMAIL_LOGO } = await imp('src/integrations/notifications/emailLogo.js');
const { startLocalSmtpServer } = await imp('tests/fixtures/localSmtpServer.js');
const { createTestCertificates } = await imp('tests/fixtures/testCertificates.js');
const { parseMime, leaves, structure, headerValue } = await imp('tests/fixtures/mimeInspect.js');
const crypto = await import('node:crypto');

const SYNTHETIC = { applicationId: '0123456789abcdef01234567', job: { title: 'Cybersecurity Specialist', slug: 'cybersecurity-specialist' }, submittedAt: new Date('2026-10-26T15:42:00.000Z'), candidateEmail: 'candidate@synthetic.example.invalid' };
const LONG = { ...SYNTHETIC, job: { title: `${'Principal Offensive Security Engineer, Cloud Infrastructure and Identity Platforms '.repeat(2)}`.slice(0, 160), slug: Array.from({ length: 18 }, (_, i) => `seg${String(i).padStart(3, '0')}`).join('-').slice(0, 120) } };
const write = (dir, name, data) => fs.writeFileSync(path.join(dir, name), data);
const index = [];
for (const [name, render, values] of [
  ['internal', renderApplicationReceivedInternal, SYNTHETIC],
  ['acknowledgement', renderApplicationAcknowledgement, SYNTHETIC],
  ['internal-long-values', renderApplicationReceivedInternal, LONG],
  ['acknowledgement-long-values', renderApplicationAcknowledgement, LONG],
]) {
  const out = render(values);
  write(outDir, `SYNTHETIC-${name}.html`, out.html);
  write(outDir, `SYNTHETIC-${name}.txt`, out.text);
  write(outDir, `SYNTHETIC-${name}.subject.txt`, `${out.subject}\n`);
  index.push({ name, subject: out.subject, htmlBytes: Buffer.byteLength(out.html), textBytes: Buffer.byteLength(out.text) });
}

const USERNAME = 'notifications@synthetic.example.invalid';
const PASSWORD = 'synthetic-local-test-password';
const certificates = createTestCertificates();
const local = await startLocalSmtpServer({ certificate: certificates.localhost, credentials: { username: USERNAME, password: PASSWORD }, behaviour: { dsn: true } });
const transport = createSmtpTransport({ host: 'localhost', port: local.port, security: 'implicit-tls', username: USERNAME, password: PASSWORD, timeoutMs: 5000, trustedCa: certificates.ca, clock: () => new Date('2026-10-26T15:42:05.000Z') });
const service = createNotificationService({ transport, timeoutMs: 5000, fromAddress: USERNAME, fromName: 'Valida Careers', replyTo: 'careers@synthetic.example.invalid', internalRecipient: 'hr@synthetic.example.invalid', acknowledgementEnabled: true, recipientAllowlist: null });
const cases = [['internal', NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, SYNTHETIC], ['acknowledgement', NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT, SYNTHETIC], ['internal-long-values', NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, LONG], ['acknowledgement-long-values', NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT, LONG]];
for (const [name, event, values] of cases) {
  const before = local.record.messages.length;
  const outcome = await service.deliver(event, values);
  if (outcome.status !== 'SENT') throw new Error(`${name}: ${JSON.stringify(outcome)}`);
  const raw = local.record.messages[before].raw;
  write(outDir, `SYNTHETIC-${name}.eml`, raw);
  const mime = parseMime(raw);
  const html = leaves(mime).find((leaf) => leaf.type === 'text/html').text;
  const image = leaves(mime).find((leaf) => leaf.type === 'image/png');
  const cid = headerValue(image, 'content-id').replace(/^<|>$/g, '');
  const dataUri = `data:image/png;base64,${image.bytes.toString('base64')}`;
  const previewHtml = html.split(`cid:${cid}`).join(dataUri);
  write(previewDir, `as-built-${name}.from-eml.html`, previewHtml);
  const entry = index.find((item) => item.name === name);
  Object.assign(entry, {
    emlBytes: raw.length,
    mimeStructure: structure(mime),
    logo: { contentId: cid, sha256: crypto.createHash('sha256').update(image.bytes).digest('hex'), bytes: image.bytes.length, approved: crypto.createHash('sha256').update(image.bytes).digest('hex') === EMAIL_LOGO.sha256 },
  });
}
await transport.close();
await local.stop();
write(outDir, 'fixtures-index.json', `${JSON.stringify({ templateVersion: TEMPLATE_VERSION, node: process.version, generatedFrom: 'b6-3 working copy (C2 masthead + P-04, OD-2026-11-02-01)', approvedImageSha256: EMAIL_LOGO.sha256, fixtures: index }, null, 2)}\n`);
console.log(JSON.stringify(index, null, 2));
