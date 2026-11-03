import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NOTIFICATION_EVENTS, createNotificationService } from '../src/integrations/notifications/notificationService.js';
import { createSmtpTransport, messageReference } from '../src/integrations/notifications/smtpTransport.js';
import {
  SUBJECT_TITLE_MAX,
  TEMPLATE_VERSION,
  escapeHtml,
  graphemes,
  headerText,
  renderApplicationAcknowledgement,
  renderApplicationReceivedInternal,
} from '../src/integrations/notifications/templates.js';
import { createTestCertificates } from './fixtures/testCertificates.js';
import { startLocalSmtpServer } from './fixtures/localSmtpServer.js';
import { QA_NOTIFICATION_OPTIONS, QA_TEXT_QUESTION_ID, applyRequest, createApplyEnvironment, qaAnswers } from './fixtures/applyHarness.js';
import { PDF_MIME, syntheticPdf } from './fixtures/resumeFiles.js';
import { decodeHtmlEntities, headerValue, leaves, parseMime, structure, surfaces } from './fixtures/mimeInspect.js';
import { EMAIL_LOGO } from '../src/integrations/notifications/emailLogo.js';

/**
 * B6 Stage 2 — template version b6-3 (Concept A — Graphite Letter; C2 masthead and P-04 colours,
 * OD-2026-11-02-01). b6-2 was the first Stage 2 version; T-01…T-12 carried over, T-13 added for b6-3.
 * Tests T-01…T-12 of the Stage 2 plan (IMPLEMENTATION_PLANS_B6_TEMPLATES_B7_SUPPRESSION.md,
 * Part A.3); authorised by OD-2026-10-26-03.
 *
 * What these tests prove: the exact approved copy (OD-2026-10-26-02), the HTML
 * structure rules of the Concept A specification, escaping and header
 * safety, the grapheme subject rule, UTC timestamps, MIME structure and
 * size, unchanged transport headers, UTF-8 round trips and — through the REAL
 * SMTP adapter and the real Apply workflow against a LOCAL SMTP TEST SERVER —
 * the per-message privacy rule on raw AND decoded output and the envelope.
 *
 * What they do NOT prove: how any email client renders the message (Stage 3),
 * delivery, or anything about Titan. The local server is test infrastructure.
 *
 * MASTHEAD: the image approved by the owner (C2, OD-2026-11-02-01) travels inline (CID); its bytes are
 * pinned by SHA-256 (emailLogo.js) and checked on the wire (T-08). The header label CAREERS is gone
 * (T-01, T-13); the footer "Valida Careers" is unchanged.
 */

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_FILE = join(here, '..', 'src', 'integrations', 'notifications', 'templates.js');
const LOGO_FILE = join(here, '..', 'src', 'integrations', 'notifications', 'assets', EMAIL_LOGO.file);
const MESSAGE_STRUCTURE = { 'multipart/alternative': ['text/plain', { 'multipart/related': ['text/html', 'image/png'] }] };
const cp = (...codes) => String.fromCodePoint(...codes);
const unit = (code) => String.fromCharCode(code); // one UTF-16 code unit — may be a lone surrogate

const USERNAME = 'notifications@qa-valida.example.test';
const PASSWORD = 'qa-app-password-marker-4567';
const HR = QA_NOTIFICATION_OPTIONS.internalRecipient;
const CAREERS = QA_NOTIFICATION_OPTIONS.replyTo;

// SYNTHETIC values (the Concept A board's fictional fixture). The real vacancy stays DRAFT.
const SYNTHETIC = Object.freeze({
  applicationId: '0123456789abcdef01234567',
  job: Object.freeze({ title: 'Cybersecurity Specialist', slug: 'cybersecurity-specialist' }),
  submittedAt: new Date('2026-10-26T15:42:00.000Z'),
  candidateEmail: 'qa.candidate@qa-valida.example.test',
});
const input = (overrides = {}) => ({ ...SYNTHETIC, ...overrides });

// The approved copy (OD-2026-10-26-02), exactly as approved.
const INTERNAL_SUBJECT = 'New application — Cybersecurity Specialist | Valida';
const ACK_SUBJECT = 'Application received — Cybersecurity Specialist | Valida';
const INTERNAL_PREHEADER = 'A new application is recorded in Valida. Candidate details remain private.';
const ACK_PREHEADER = 'Thank you for applying. Your application has been received.';
const INTERNAL_TEXT = [
  'A new application has arrived.',
  '',
  'The application is recorded in Valida.',
  '',
  'Role: Cybersecurity Specialist',
  'Role identifier: cybersecurity-specialist',
  'Received (UTC): 2026-10-26 15:42:00',
  'Application reference: 0123456789abcdef01234567',
  '',
  'Candidate details and the resume are stored privately in Valida and are not included in this email.',
  '',
  'Valida · Recruitment operations',
  '',
].join('\n');
const ACK_TEXT = [
  'Thank you for applying.',
  '',
  'We’ve received your application for Cybersecurity Specialist.',
  '',
  'If we need more information or decide to move forward, we’ll contact you using the details in your application.',
  '',
  'Valida Careers',
  '',
].join('\n');

let certificates;
beforeAll(() => {
  certificates = createTestCertificates();
});
const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

async function localServer(behaviour = { dsn: true }) {
  const local = await startLocalSmtpServer({ certificate: certificates.localhost, credentials: { username: USERNAME, password: PASSWORD }, behaviour });
  cleanups.push(() => local.stop());
  return local;
}
const smtpTransport = (port) =>
  createSmtpTransport({ host: 'localhost', port, security: 'implicit-tls', username: USERNAME, password: PASSWORD, timeoutMs: 3_000, trustedCa: certificates.ca });
const service = (transport) => createNotificationService({ transport, timeoutMs: 3_000, ...QA_NOTIFICATION_OPTIONS, fromAddress: USERNAME, acknowledgementEnabled: true });

/** One event through the REAL SMTP adapter to the local test server: the received bytes, parsed. */
async function viaLocalServer(event, values = input()) {
  const local = await localServer();
  const outcome = await service(smtpTransport(local.port)).deliver(event, values);
  expect(outcome.status).toBe('SENT');
  expect(local.record.messages).toHaveLength(1);
  const [received] = local.record.messages;
  return { local, received, mime: parseMime(received.raw) };
}
const partOf = (mime, type) => leaves(mime).find((leaf) => leaf.type === type);
const crlfToLf = (value) => value.replace(/\r\n/g, '\n');

/** The HTML without Outlook conditional comments (they are checked separately). */
const withoutConditional = (html) => html.replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g, '');
/** Visible text chunks of the HTML body, references decoded, whitespace collapsed. */
function htmlTextChunks(html) {
  const body = withoutConditional(html.slice(html.indexOf('<body')));
  return body
    .split(/<[^>]+>/)
    .map((chunk) => decodeHtmlEntities(chunk).replace(/\s+/g, ' ').trim())
    .filter((chunk) => chunk.length > 0);
}

describe('T-01 — the approved copy, exactly (OD-2026-10-26-02)', () => {
  it('template version b6-3', () => {
    expect(TEMPLATE_VERSION).toBe('b6-3');
  });

  it('internal notification: subject, plain text, preheader, labels', () => {
    const rendered = renderApplicationReceivedInternal(input());
    expect(rendered.subject).toBe(INTERNAL_SUBJECT);
    expect(rendered.text).toBe(INTERNAL_TEXT);
    const chunks = htmlTextChunks(rendered.html);
    expect(chunks[0]).toBe(INTERNAL_PREHEADER);
    // b6-3: the header label CAREERS is removed (OD-2026-11-02-01); nothing else changed.
    expect(chunks).not.toContain('CAREERS');
    for (const expected of [
      'RECRUITMENT / NEW APPLICATION',
      'A new application has arrived.',
      'The application is recorded in Valida.',
      'Role',
      'Cybersecurity Specialist',
      'Role identifier',
      'cybersecurity-specialist',
      'Received (UTC)',
      '2026-10-26 15:42:00',
      'Application reference',
      '0123456789abcdef01234567',
      'Candidate details and the resume are stored privately in Valida and are not included in this email.',
      'Valida · Recruitment operations',
    ]) {
      expect(chunks, expected).toContain(expected);
    }
    expect(rendered.html).toContain('<h1 class="v-h1"');
    expect(rendered.html).toMatch(/<h1[^>]*>A new application has arrived\.<\/h1>/);
  });

  it('candidate acknowledgement: subject, plain text, preheader, labels', () => {
    const rendered = renderApplicationAcknowledgement(input());
    expect(rendered.subject).toBe(ACK_SUBJECT);
    expect(rendered.text).toBe(ACK_TEXT);
    const chunks = htmlTextChunks(rendered.html);
    expect(chunks[0]).toBe(ACK_PREHEADER);
    // b6-3: the header label CAREERS is removed (OD-2026-11-02-01); the footer "Valida Careers" stays.
    expect(chunks).toEqual([
      ACK_PREHEADER,
      'APPLICATION RECEIVED',
      'Thank you for applying.',
      'We’ve received your application for Cybersecurity Specialist.',
      'If we need more information or decide to move forward, we’ll contact you using the details in your application.',
      'Valida Careers',
    ]);
    expect(rendered.html).toMatch(/<h1[^>]*>Thank you for applying\.<\/h1>/);
  });

  it('receipt only: no interview, response-time, selection, employment or immigration promise (Doc 06 section 153)', () => {
    for (const rendered of [renderApplicationAcknowledgement(input()), renderApplicationReceivedInternal(input())]) {
      expect(`${rendered.subject}${rendered.text}${rendered.html}`).not.toMatch(/interview|shortlist|selected|within \d|business days|guarantee|visa|immigration|offer/i);
    }
  });
});

describe('T-02 — HTML structure and prohibited resources (spec sections 6, 9)', () => {
  for (const [name, render] of [
    ['internal', renderApplicationReceivedInternal],
    ['acknowledgement', renderApplicationAcknowledgement],
  ]) {
    it(`${name}: lang/dir, one h1, presentation tables, explicit colours, no prohibited element or resource`, () => {
      const { html, subject } = render(input());
      expect(html.startsWith('<!doctype html>\n<html lang="en" dir="ltr">')).toBe(true);
      expect(html).toContain('<meta charset="utf-8">');
      expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
      expect(html).toContain('<meta name="color-scheme" content="dark">');
      expect(html).toContain('<meta name="supported-color-schemes" content="dark">');
      expect(html).toContain('<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">');
      expect(html).toContain(`<title>${escapeHtml(subject)}</title>`);
      // The preheader is the first element in the body, visually hidden.
      expect(html).toMatch(/<body[^>]*>\n<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">/);
      expect(html.match(/<h1\b/g)).toHaveLength(1);
      const tables = html.match(/<table\b[^>]*>/g);
      expect(tables.length).toBeGreaterThan(3);
      for (const table of tables) expect(table, table).toContain('role="presentation"');
      // Every cell (outside the Outlook-only wrapper) declares its background twice.
      for (const td of withoutConditional(html).match(/<td\b[^>]*>/g)) {
        expect(td, td).toMatch(/bgcolor="#[0-9A-F]{6}"/);
        expect(td, td).toMatch(/background-color:#[0-9A-F]{6}/);
      }
      // Every text element declares its own colour and font.
      for (const element of html.match(/<(?:p|h1)\b[^>]*>/g)) {
        expect(element, element).toMatch(/color:#[0-9A-F]{6}/);
        expect(element, element).toMatch(/font-family:/);
      }
      expect(html).not.toMatch(/<(?:script|form|a|iframe|svg|object|embed|video|audio|input|button|link)\b/i);
      expect(html).not.toMatch(/https?:|\/\/|url\(|@import|@font-face|background-image|background=/i);
      expect(html).not.toMatch(/display:\s*(?:flex|grid|inline-flex|inline-grid)|var\(|clamp\(|calc\(|animation|transition|rgba\(/i);
      expect(html).not.toMatch(/\son[a-z]+=/i); // no event handlers
      // The only image is the approved masthead, inline (CID), 600 x 108 by attribute, fluid by style, alt "Valida".
      const images = html.match(/<img\b[^>]*>/g);
      expect(images).toHaveLength(1);
      expect(images[0]).toContain(`src="cid:${EMAIL_LOGO.contentId}"`);
      expect(images[0]).toContain('width="600" height="108" alt="Valida"');
      expect(images[0]).toContain('display:block;width:100%;max-width:600px;height:auto;');
      expect(html.match(/src=/g)).toHaveLength(1);
      // The Outlook-only parts are the column wrapper (open, close) and a font override; nothing else. b6-3: the
      // wrapper is a full-width table whose middle cell asks for 600 px (no fixed 600 px table any more, F-03).
      const conditional = html.match(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g);
      expect(conditional).toHaveLength(3);
      expect(conditional[1]).toBe('<!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td></td><td width="600" style="width:600px;"><![endif]-->');
      expect(conditional[2]).toBe('<!--[if mso]></td><td></td></tr></table><![endif]-->');
      expect(html).not.toMatch(/<table\b[^>]*width="600"/);
      expect(html.length).toBeLessThanOrEqual(20 * 1024);
    });
  }
});

describe('T-03 — HTML and plain text carry the same information', () => {
  const PRESENTATIONAL = new Set(['APPLICATION RECEIVED', 'RECRUITMENT / NEW APPLICATION', 'Role', 'Role identifier', 'Received (UTC)', 'Application reference', INTERNAL_PREHEADER, ACK_PREHEADER]);

  for (const [name, render] of [
    ['internal', renderApplicationReceivedInternal],
    ['acknowledgement', renderApplicationAcknowledgement],
  ]) {
    it(`${name}: every HTML text is in the plain text (labels aside), and every plain-text line is in the HTML`, () => {
      const { html, text } = render(input());
      const chunks = htmlTextChunks(html);
      for (const chunk of chunks) {
        if (PRESENTATIONAL.has(chunk)) continue;
        expect(text, chunk).toContain(chunk);
      }
      for (const line of text.split('\n').filter(Boolean)) {
        const labelled = /^(Role|Role identifier|Received \(UTC\)|Application reference): (.+)$/.exec(line);
        if (labelled) {
          expect(chunks).toContain(labelled[1]);
          expect(chunks).toContain(labelled[2]);
        } else {
          expect(chunks, line).toContain(line);
        }
      }
    });
  }
});

describe('T-04 — escaping, controls, malformed Unicode and header injection', () => {
  const BIDI_AND_SEPARATORS = [0x2028, 0x2029, 0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069];
  const hostileTitle = `QA <script>alert(1)</script> & "x" 'y'\r\nBcc: victim@qa.example.test${cp(0x2028)}${cp(0x202e)}${unit(0)}end${unit(0x85)}`;
  const hostileSlug = `qa-<b>&"'${unit(0x0b)}`;

  it('HTML-escaped, one line, no controls or bidi formatting anywhere it matters', () => {
    for (const rendered of [
      renderApplicationReceivedInternal(input({ job: { title: hostileTitle, slug: hostileSlug } })),
      renderApplicationAcknowledgement(input({ job: { title: hostileTitle } })),
    ]) {
      expect(rendered.subject).not.toMatch(/[\r\n]/);
      expect(rendered.subject).toContain('Bcc: victim@qa.example.test'); // inert text on ONE line
      const subjectCodes = [...rendered.subject].map((character) => character.codePointAt(0));
      for (const code of [...BIDI_AND_SEPARATORS, 0, 0x85]) expect(subjectCodes).not.toContain(code);
      expect(rendered.html).not.toContain('<script>');
      expect(rendered.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot; &#39;y&#39;');
      const textCodes = [...rendered.text].map((character) => character.codePointAt(0));
      for (const code of [...BIDI_AND_SEPARATORS, 0, 0x0b, 0x0d, 0x85]) expect(textCodes).not.toContain(code);
      expect(rendered.html).not.toMatch(/[\r]/);
    }
    expect(renderApplicationReceivedInternal(input({ job: { title: 'Role', slug: hostileSlug } })).html).toContain('qa-&lt;b&gt;&amp;&quot;&#39;');
  });

  it('a lone surrogate becomes U+FFFD; output is always well-formed', () => {
    const title = `A${unit(0xd800)}B${unit(0xdc00)}C`;
    for (const rendered of [renderApplicationAcknowledgement(input({ job: { title } })), renderApplicationReceivedInternal(input({ job: { title, slug: 's' } }))]) {
      expect(rendered.subject.isWellFormed()).toBe(true);
      expect(rendered.text.isWellFormed()).toBe(true);
      expect(rendered.html.isWellFormed()).toBe(true);
      expect(rendered.subject).toContain(`A${cp(0xfffd)}B${cp(0xfffd)}C`);
    }
  });

  it('through the real adapter: the CR/LF title cannot add a header (no Bcc, one Subject)', async () => {
    const { received, mime } = await viaLocalServer(NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT, input({ job: { title: hostileTitle } }));
    expect(mime.headers.filter((entry) => entry.name === 'bcc')).toHaveLength(0);
    expect(mime.headers.filter((entry) => entry.name === 'subject')).toHaveLength(1);
    expect(headerValue(mime, 'subject')).toContain('Bcc: victim@qa.example.test');
    expect(received.rcptTo).toEqual([SYNTHETIC.candidateEmail]);
  });

  it('missing inputs are refused (a defect, never a half-empty email)', () => {
    expect(() => renderApplicationReceivedInternal(input({ job: { title: ' ', slug: 'qa' } }))).toThrow(TypeError);
    expect(() => renderApplicationReceivedInternal(input({ submittedAt: new Date('invalid') }))).toThrow(TypeError);
    expect(() => renderApplicationReceivedInternal(input({ applicationId: '' }))).toThrow(TypeError);
    expect(() => renderApplicationAcknowledgement({ job: null })).toThrow(TypeError);
  });
});

describe('T-05 — the subject rule: 120 grapheme clusters, ellipsis included (spec section 6.2)', () => {
  const SEQUENCES = {
    'emoji ZWJ sequence': cp(0x1f469, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466),
    'regional-indicator flag': cp(0x1f1e8, 0x1f1e6),
    'skin-tone modifier sequence': cp(0x1f44d, 0x1f3fd),
    'keycap sequence': cp(0x31, 0xfe0f, 0x20e3),
    'letter with combining marks': cp(0x65, 0x301, 0x323),
    'Hangul conjoining jamo': cp(0x1100, 0x1161, 0x11a8),
    'astral character': cp(0x1d49c),
  };

  it('exactly 120 clusters: unchanged; 121: 119 + "…"; trailing white space at the cut is removed', () => {
    expect(SUBJECT_TITLE_MAX).toBe(120);
    expect(headerText('x'.repeat(120))).toBe('x'.repeat(120));
    expect(headerText('x'.repeat(121))).toBe(`${'x'.repeat(119)}…`);
    expect(graphemes(headerText('x'.repeat(500)))).toHaveLength(120);
    expect(headerText(`${'y'.repeat(118)}  ${'z'.repeat(10)}`)).toBe(`${'y'.repeat(118)}…`);
  });

  for (const [label, sequence] of Object.entries(SEQUENCES)) {
    it(`${label} at the cut is never split; the result is well-formed`, () => {
      for (const before of [117, 118, 119, 120]) {
        const title = `${'a'.repeat(before)}${sequence}${'b'.repeat(8)}`;
        const cut = headerText(title);
        const clusters = graphemes(cut);
        expect(clusters.length).toBeLessThanOrEqual(120);
        expect(cut.endsWith('…')).toBe(true);
        expect(cut.isWellFormed()).toBe(true);
        // The sequence is either whole or absent — never a fragment of it.
        const kept = clusters.slice(0, -1).join('');
        if (kept.length > before) expect(kept.slice(before, before + sequence.length)).toBe(sequence);
        else expect(kept).toBe('a'.repeat(before).slice(0, kept.length));
        expect(clusters.filter((cluster) => cluster.includes(sequence.slice(0, 1)))).toEqual(kept.includes(sequence) ? [sequence] : []);
      }
    });
  }

  it('the prefix and the " | Valida" suffix are always whole; at most 152 / 147 clusters', () => {
    // No white space at the cut, so the title segment is exactly 120 clusters (119 + the ellipsis).
    const long = `${'Senior'.repeat(40)}${SEQUENCES['emoji ZWJ sequence']}`;
    const ack = renderApplicationAcknowledgement(input({ job: { title: long } }));
    const internal = renderApplicationReceivedInternal(input({ job: { title: long, slug: 'qa' } }));
    expect(ack.subject.startsWith('Application received — ')).toBe(true);
    expect(internal.subject.startsWith('New application — ')).toBe(true);
    for (const subject of [ack.subject, internal.subject]) expect(subject.endsWith('… | Valida')).toBe(true);
    expect(graphemes(ack.subject)).toHaveLength(23 + 120 + 9);
    expect(graphemes(internal.subject)).toHaveLength(18 + 120 + 9);
    // With white space at the cut it is trimmed first, so the segment is shorter — never longer.
    const spaced = renderApplicationAcknowledgement(input({ job: { title: 'Senior '.repeat(40) } })).subject;
    expect(spaced).toBe(`Application received — ${'Senior '.repeat(17).trimEnd()}… | Valida`);
    expect(graphemes(spaced).length).toBeLessThanOrEqual(23 + 120 + 9);
    // The body keeps the FULL title; <title> repeats the subject.
    expect(ack.text).toContain(long.trim());
    expect(internal.text).toContain(`Role: ${long.trim()}`);
    expect(ack.html).toContain(`<title>${escapeHtml(ack.subject)}</title>`);
  });

  it('through the real adapter: the composed Subject header, decoded (strict RFC 2047), equals the rendered subject exactly', async () => {
    for (const title of [
      `${'a'.repeat(118)}${SEQUENCES['emoji ZWJ sequence']}tail`,
      `${'Ingénieur sécurité '.repeat(8)}${SEQUENCES['letter with combining marks']}`,
      'Cybersecurity Specialist',
    ]) {
      const expected = renderApplicationAcknowledgement(input({ job: { title } })).subject;
      const { mime } = await viaLocalServer(NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT, input({ job: { title } }));
      expect(headerValue(mime, 'subject')).toBe(expected);
    }
  });

  it('runtime: grapheme segmentation is available (ICU); versions are reported for the evidence', () => {
    expect(typeof Intl.Segmenter).toBe('function');
    expect(process.versions.icu).toMatch(/^\d+/);
    expect(process.versions.unicode).toMatch(/^\d+/);
  });
});

describe('T-06 — long values wrap; no width over 600 px; no fixed text heights', () => {
  it('a 160-character title, a 120-character slug and a 24-hex reference', () => {
    const title = 'Q'.repeat(160);
    const slug = Array.from({ length: 18 }, (_, index) => `seg${String(index).padStart(3, '0')}`).join('-').slice(0, 120);
    expect(slug).toHaveLength(120);
    const { html, text, subject } = renderApplicationReceivedInternal(input({ job: { title, slug } }));
    expect(text).toContain(title);
    expect(text).toContain(slug);
    expect(subject).toBe(`New application — ${'Q'.repeat(119)}… | Valida`);
    const valueParagraph = (value) => html.match(new RegExp(`<p style="([^"]*)">${value}</p>`))[1];
    expect(valueParagraph(title)).toContain('word-wrap:break-word;word-break:break-word;');
    expect(valueParagraph(slug)).toContain('word-break:break-all;');
    expect(valueParagraph(SYNTHETIC.applicationId)).toContain('word-break:break-all;');
    const ack = renderApplicationAcknowledgement(input({ job: { title } })).html;
    expect(ack).toMatch(/<p class="v-lead" style="[^"]*word-break:break-word;[^"]*">We’ve received your application for Q{160}\.<\/p>/);
    for (const document of [html, ack]) {
      for (const [, width] of document.matchAll(/width="(\d+)"/g)) expect(Number(width)).toBeLessThanOrEqual(600);
      for (const [, width] of document.matchAll(/(?:max-)?width:(\d+)px/g)) expect(Number(width)).toBeLessThanOrEqual(600);
      for (const element of document.match(/<(?:p|h1)\b[^>]*>/g)) expect(element).not.toMatch(/(?<![-\w])height:\s*\d/);
      // Fixed heights exist only on the decorative 1 px hairlines and the 2 px accent rule. b6-3: the masthead image
      // has no fixed CSS height (height:auto, so it scales with the column); 108 is only its HTML attribute.
      for (const [declaration] of document.matchAll(/(?<![-\w])height:\s*\d+px/g)) expect(['height:1px', 'height:2px']).toContain(declaration);
      expect(document.match(/(?<![-\w])height:auto/g)).toHaveLength(1);
    }
  });
});

describe('T-07 — privacy, per message: raw AND decoded output, and the SMTP envelope (copy proposal section 5)', () => {
  it('real Apply -> real adapter -> local test server: internal has no candidate data anywhere; the acknowledgement has the address only as recipient', async () => {
    const local = await localServer();
    const env = await createApplyEnvironment({
      transport: smtpTransport(local.port),
      notificationTimeoutMs: 3_000,
      notificationOptions: { fromAddress: USERNAME, acknowledgementEnabled: true },
    });
    cleanups.push(() => env.cleanup());
    // Unique markers, ASCII and non-ASCII, so the mail library has to encode some of them.
    const MARK = {
      name: `Qzname Markerson ${cp(0x3a8)}${cp(0xe9)}lan`,
      email: 'qzmarker.mail+b6s2@privacy-marker.example.invalid',
      phone: '+1 (555) 010-7731',
      message: `QZMSG message marker ${cp(0xc6, 0xd8, 0xc5)}`,
      answer: `QZANS answer marker ${cp(0xfc, 0xdf)}`,
      filename: `qzfile-marker-r${cp(0xe9)}sum${cp(0xe9)}.pdf`,
    };
    const answers = qaAnswers().map((entry) => (entry.questionId === QA_TEXT_QUESTION_ID ? { ...entry, answer: MARK.answer } : entry));
    const response = await applyRequest(env.app, {
      fields: { fullName: MARK.name, email: MARK.email, phone: MARK.phone, message: MARK.message },
      answers,
      resume: { data: syntheticPdf(), filename: MARK.filename, contentType: PDF_MIME },
    });
    expect(response.status).toBe(201);
    expect(local.record.messages).toHaveLength(2);

    const terms = [
      MARK.name, 'Qzname', 'Markerson', `${cp(0x3a8)}${cp(0xe9)}lan`,
      MARK.email, 'qzmarker.mail+b6s2', 'qzmarker', 'privacy-marker.example.invalid',
      MARK.phone, '010-7731',
      MARK.message, 'QZMSG', `${cp(0xc6, 0xd8, 0xc5)}`,
      MARK.answer, 'QZANS',
      MARK.filename, 'qzfile-marker',
    ].map((term) => term.toLowerCase());
    const hits = (where, value) => terms.filter((term) => String(value).toLowerCase().includes(term)).map((term) => `${where}: ${term}`);

    const byRecipient = Object.fromEntries(local.record.messages.map((received) => [received.rcptTo[0], received]));
    expect(Object.keys(byRecipient).sort()).toEqual([MARK.email, HR].sort());

    for (const [recipient, received] of Object.entries(byRecipient)) {
      const isAcknowledgement = recipient === MARK.email;
      const mime = parseMime(received.raw);
      // Everywhere a value can be: decoded headers and parameters, decoded bodies (HTML also with references decoded)…
      const places = surfaces(mime);
      // …the raw bytes (as UTF-8 and as bytes)…
      const rawText = received.raw.toString('utf8');
      const headerBlock = rawText.slice(0, rawText.indexOf('\r\n\r\n')).replace(/\r\n(?=[ \t])/g, '');
      const rawWithoutTo = `${headerBlock.split('\r\n').filter((line) => !/^to:/i.test(line)).join('\r\n')}${rawText.slice(rawText.indexOf('\r\n\r\n'))}`;
      places.push({ where: 'raw message (UTF-8, To line removed for the acknowledgement)', text: isAcknowledgement ? rawWithoutTo : rawText });
      places.push({ where: 'raw message (bytes)', text: isAcknowledgement ? Buffer.from(rawWithoutTo, 'utf8').toString('latin1') : received.raw.toString('latin1') });
      // …and the envelope: MAIL FROM and its parameters, the DSN envelope, RCPT parameters.
      places.push({ where: 'envelope MAIL FROM', text: received.mailFrom });
      places.push({ where: 'envelope MAIL FROM parameters (all sessions)', text: JSON.stringify(local.record.mailFrom.map((entry) => entry.args)) });
      places.push({ where: 'envelope DSN', text: JSON.stringify(received.dsn ?? {}) });
      const rcptEntries = local.record.rcptToArgs.filter((entry) => entry.address === recipient);
      expect(rcptEntries).toHaveLength(1);
      const rcptArgs = rcptEntries[0].args;
      const orcpt = Object.entries(rcptArgs).find(([name]) => name.toUpperCase() === 'ORCPT');
      if (orcpt) {
        // The documented ORCPT allowance: only the same recipient, for addressing.
        expect(orcpt[1].toLowerCase()).toBe(`rfc822;${recipient}`.toLowerCase());
        places.push({ where: 'envelope RCPT parameters (ORCPT aside)', text: JSON.stringify(Object.fromEntries(Object.entries(rcptArgs).filter(([name]) => name.toUpperCase() !== 'ORCPT'))) });
      } else {
        places.push({ where: 'envelope RCPT parameters', text: JSON.stringify(rcptArgs) });
      }

      const allowed = (place) => isAcknowledgement && place.header === 'to';
      const found = places.filter((place) => !allowed(place)).flatMap((place) => hits(place.where, place.text));
      expect(found, `${isAcknowledgement ? 'acknowledgement' : 'internal'}: candidate data found`).toEqual([]);

      if (isAcknowledgement) {
        // The address appears only where addressing needs it, with no candidate-derived display name.
        expect(headerValue(mime, 'to')).toBe(MARK.email);
        expect(received.rcptTo).toEqual([MARK.email]);
      } else {
        expect(received.rcptTo).toEqual([HR]);
        expect(headerValue(mime, 'to')).toBe(HR);
      }
      // Structure: text, HTML and the one inline logo — nothing else.
      expect(structure(mime)).toEqual(MESSAGE_STRUCTURE);
    }
  });
});

describe('T-08 — MIME structure, the approved logo bytes and size', () => {
  it('alternative(text/plain, related(text/html, image/png)); the logo is the approved file, inline, constant name and Content-ID; HTML <= 20 KB; message <= 40 KB', async () => {
    const approved = fs.readFileSync(LOGO_FILE);
    // The hash the owner approved for b6-3 (C2 masthead, OD-2026-11-02-01), written here independently of the code under test.
    expect(EMAIL_LOGO.sha256).toBe('ac67a2cb7d447a55d89bb3264198743d4114190e259775535215acabba1aea3b');
    expect([EMAIL_LOGO.width, EMAIL_LOGO.height]).toEqual([600, 108]);
    // A PNG of 1200 x 216 px (2x the display size): width and height from the IHDR chunk.
    expect([approved.readUInt32BE(16), approved.readUInt32BE(20)]).toEqual([1200, 216]);
    expect(crypto.createHash('sha256').update(approved).digest('hex')).toBe(EMAIL_LOGO.sha256);
    for (const event of [NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT]) {
      const { received, mime } = await viaLocalServer(event);
      expect(structure(mime)).toEqual(MESSAGE_STRUCTURE);
      for (const leaf of leaves(mime).filter((part) => part.type.startsWith('text/'))) {
        expect(leaf.params.charset).toBe('utf-8');
        expect(leaf.transferEncoding).toBe('quoted-printable');
        expect(leaf.disposition).toBeNull();
      }
      const logo = partOf(mime, 'image/png');
      expect(crypto.createHash('sha256').update(logo.bytes).digest('hex')).toBe(EMAIL_LOGO.sha256);
      expect(logo.bytes.equals(approved)).toBe(true);
      expect(logo.transferEncoding).toBe('base64');
      expect(headerValue(logo, 'content-id')).toBe(`<${EMAIL_LOGO.contentId}>`);
      expect(logo.disposition).toEqual({ value: 'inline', params: { filename: EMAIL_LOGO.filename } });
      expect(logo.params.name).toBe(EMAIL_LOGO.filename);
      expect(Buffer.byteLength(partOf(mime, 'text/html').text)).toBeLessThanOrEqual(20 * 1024);
      expect(received.raw.length).toBeLessThanOrEqual(40 * 1024);
    }
  });

  it('a logo asset that does not match its approved hash is refused — never a substitute image', async () => {
    vi.resetModules();
    const fsModule = await import('node:fs');
    const spy = vi.spyOn(fsModule.default, 'readFileSync').mockReturnValue(Buffer.from('not the approved logo'));
    const { emailLogoBytes } = await import('../src/integrations/notifications/emailLogo.js');
    expect(() => emailLogoBytes()).toThrow(/approved SHA-256/);
    spy.mockRestore();
  });

  it('a message whose HTML does not reference the logo gets no attachment at all', async () => {
    const local = await localServer();
    const transport = smtpTransport(local.port);
    await transport.send(
      {
        event: 'APPLICATION_RECEIVED_INTERNAL',
        from: { address: USERNAME, name: 'Valida Careers' },
        to: [HR],
        replyTo: CAREERS,
        subject: 'QA',
        text: 'QA text',
        html: '<p>QA html</p>',
        metadata: { applicationId: SYNTHETIC.applicationId },
      },
      { idempotencyKey: `APPLICATION_RECEIVED_INTERNAL/${SYNTHETIC.applicationId}` },
    );
    expect(structure(parseMime(local.record.messages[0].raw))).toEqual({ 'multipart/alternative': ['text/plain', 'text/html'] });
  });
});

describe('T-09 — the transport headers and parameters are unchanged', () => {
  it('Message-ID token, Auto-Submitted, From, Reply-To, To, no X-Mailer, DSN parameters, envelope sender', async () => {
    const { received, mime } = await viaLocalServer(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL);
    const reference = messageReference(`APPLICATION_RECEIVED_INTERNAL/${SYNTHETIC.applicationId}`);
    expect(headerValue(mime, 'message-id')).toBe(`<${reference}.b6@qa-valida.example.test>`);
    expect(headerValue(mime, 'auto-submitted')).toBe('auto-generated');
    expect(headerValue(mime, 'from')).toBe(`Valida Careers <${USERNAME}>`);
    expect(headerValue(mime, 'reply-to')).toBe(CAREERS);
    expect(headerValue(mime, 'to')).toBe(HR);
    expect(headerValue(mime, 'x-mailer')).toBeUndefined();
    expect(received.mailFrom).toBe(USERNAME);
    expect(received.dsn).toMatchObject({ ret: 'HDRS', envid: reference });
  });
});

describe('T-10 — the timestamp is UTC whatever the process time zone', () => {
  it('the same text under five TZ values (child processes); milliseconds are dropped, never rounded', () => {
    const moduleUrl = pathToFileURL(TEMPLATES_FILE).href;
    const script = [
      `const t = await import(${JSON.stringify(moduleUrl)});`,
      "const out = t.renderApplicationReceivedInternal({ applicationId: '0123456789abcdef01234567', job: { title: 'Role', slug: 'role' }, submittedAt: new Date('2026-12-31T23:59:59.999Z') });",
      'process.stdout.write(JSON.stringify({ offset: new Date(Date.UTC(2026, 11, 31, 23)).getTimezoneOffset(), text: out.text }));',
    ].join('\n');
    const offsets = new Set();
    for (const zone of ['UTC', 'America/Vancouver', 'Asia/Tehran', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ: zone }, encoding: 'utf8' });
      expect(child.status, child.stderr).toBe(0);
      const result = JSON.parse(child.stdout);
      offsets.add(result.offset);
      expect(result.text, zone).toContain('Received (UTC): 2026-12-31 23:59:59\n');
    }
    expect(offsets.size).toBe(5); // the zones really differed
  });
});

describe('T-11 — UTF-8 round trips through the real adapter', () => {
  it('’ and · in the body, — in the subject: encoded on the wire (7-bit), decoded exactly', async () => {
    for (const [event, expectedText, expectedSubject] of [
      [NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT, ACK_TEXT, ACK_SUBJECT],
      [NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, INTERNAL_TEXT, INTERNAL_SUBJECT],
    ]) {
      const { received, mime } = await viaLocalServer(event);
      expect([...received.raw].every((byte) => byte < 128)).toBe(true);
      expect(mime.headers.find((entry) => entry.name === 'subject').raw).toMatch(/^=\?UTF-8\?[BQ]\?/i);
      expect(headerValue(mime, 'subject')).toBe(expectedSubject);
      expect(crlfToLf(partOf(mime, 'text/plain').text)).toBe(expectedText);
      const rendered = (event === NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT ? renderApplicationAcknowledgement : renderApplicationReceivedInternal)(input());
      expect(crlfToLf(partOf(mime, 'text/html').text)).toBe(rendered.html);
    }
  });
});

describe('T-12 — no test-vacancy label in any template', () => {
  it('neither the template source nor its output carries a test or synthetic label', () => {
    const source = fs.readFileSync(TEMPLATES_FILE, 'utf8');
    for (const label of [/QA SMOKE/i, /TEST ROLE/i, /NOT A REAL VACANCY/i, /\bsynthetic\b/i, /\bQA\b/]) expect(source).not.toMatch(label);
    for (const rendered of [renderApplicationAcknowledgement(input()), renderApplicationReceivedInternal(input())]) {
      expect(`${rendered.subject}${rendered.text}${rendered.html}`).not.toMatch(/QA SMOKE|TEST ROLE|NOT A REAL VACANCY|synthetic|\bQA\b|\btest\b/i);
    }
  });
});

describe('T-13 — b6-3: the C2 masthead and the P-04 colours (OD-2026-11-02-01)', () => {
  for (const [name, render] of [
    ['internal', renderApplicationReceivedInternal],
    ['acknowledgement', renderApplicationAcknowledgement],
  ]) {
    it(`${name}: the header row is the masthead image alone; labels and footer #B6C0CC; eyebrow #83C6FF; no former colour`, () => {
      const { html } = render(input());
      // The first row of the column is one cell on the canvas colour holding only the masthead image.
      const column = html.slice(html.indexOf('max-width:600px;margin:0 auto;">'));
      const headerRow = column.slice(column.indexOf('<tr>'), column.indexOf('</tr>') + 5);
      expect(headerRow).toBe(`<tr><td bgcolor="#05070A" style="background-color:#05070A;padding:0;font-size:0;line-height:0;">${html.match(/<img\b[^>]*>/)[0]}</td></tr>`);
      expect(withoutConditional(html)).not.toMatch(/CAREERS/);
      // P-04.
      const paragraphs = html.match(/<p style="[^"]*">/g);
      const labels = paragraphs.filter((p) => p.includes('letter-spacing:0.08em;text-transform:uppercase;'));
      const footers = paragraphs.filter((p) => p.includes('font-size:13px;line-height:20px;'));
      const eyebrows = paragraphs.filter((p) => p.includes('letter-spacing:0.14em;text-transform:uppercase;'));
      expect(labels).toHaveLength(name === 'internal' ? 4 : 0);
      for (const label of labels) expect(label).toContain('color:#B6C0CC;');
      expect(footers).toHaveLength(1);
      expect(footers[0]).toContain('color:#B6C0CC;');
      expect(eyebrows).toHaveLength(1);
      expect(eyebrows[0]).toContain('color:#83C6FF;');
      expect(html).not.toMatch(/#7E8997|#66B3FF/i);
    });
  }
});
