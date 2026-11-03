/**
 * Transactional email templates — Milestone B6, template version b6-3
 * (Concept A — Graphite Letter, with the C2 masthead and the P-04 colours).
 *
 * b6-3 (OD-2026-11-02-01, owner approval and sandbox implementation
 * authorisation): the header is the approved C2 masthead image; the header
 * label CAREERS is removed (only it — every other approved word is
 * unchanged); metadata labels and footers use #B6C0CC and the eyebrow
 * #83C6FF (P-04); the Outlook-only wrapper lets the column narrow below
 * 600 px (finding F-03) — see conceptADocument.
 *
 * Governed by 14_EMAIL_DNS_IDENTITY.md sections 112-115 and 135-144,
 * 09_BACKEND_API_SPEC.md sections 129-130 and 188-190,
 * 12_CAREERS_APPLICATIONS.md sections 115-118 and 172,
 * 06_CONTENT_COPY_DECK.md sections 148-153, 03_BRAND_VISUAL_SYSTEM.md
 * sections 16-20, 13_SECURITY_PRIVACY_THREAT_MODEL.md SEC-049; owner
 * decisions OD-2026-10-26-02 (approved copy, timestamp, subject rule, logo
 * choice), OD-2026-10-26-03 (Stage 2 authorisation) and OD-2026-11-02-01
 * (C2 masthead, removal of the header label, P-04 colours); the Concept A
 * specification docs/design/EMAIL_CONCEPT_A_SPEC.md.
 *
 * TEMPLATE SOURCE (Doc 14 section 141). The templates are code in this file:
 * backend-controlled, never editable through any public input. Every dynamic
 * value is treated as untrusted — also the Job title, which is operational
 * data — and is:
 *   - made well-formed (a lone surrogate becomes U+FFFD) and reduced to one
 *     line without control or bidirectional-formatting characters;
 *   - HTML-escaped in the HTML part (SEC-049; Doc 14 section 142);
 *   - bounded by GRAPHEME CLUSTER before it reaches a SUBJECT (Doc 14
 *     sections 143-144: no header injection; spec section 6.2).
 *
 * WHAT THE MESSAGES CONTAIN — the copy approved in OD-2026-10-26-02, exactly.
 *   APPLICATION_RECEIVED_INTERNAL (to the configured recruitment recipient):
 *     the Job title and slug, the submission time (UTC) and the internal
 *     Application reference. No candidate name, email, phone, message,
 *     answers, filename or resume, and no resume link (Doc 09 sections
 *     189-190; Doc 14 section 115).
 *   APPLICATION_ACKNOWLEDGEMENT (to the candidate, only when enabled):
 *     confirms RECEIPT only (Doc 12 sections 116-118, 172) — no interview,
 *     shortlisting, selection or response-time promise (Doc 06 section 153).
 *
 * HTML (spec sections 3-9). One-column presentation tables, inline critical
 * styles, explicit colours on every text element and every text cell, one
 * h1, a hidden preheader, a <=480 px media query as progressive enhancement,
 * an Outlook-only wrapper and font override (conditional comments). No
 * links, scripts, forms, remote resources, web fonts, tracking, CSS
 * variables, Grid, Flexbox or animation (Doc 14 sections 137-138). The
 * plain-text part carries the same information (section 136); the
 * presentational eyebrow is omitted from it.
 *
 * MASTHEAD. One inline CID image (OD-2026-10-26-02: inline delivery; OD-2026-
 * 11-02-01: the C2 asset, emailLogo.js): the whole header row, 600 x 108,
 * alt "Valida" — the approved lockup on the canvas colour, so the mark keeps
 * its dark surface when a client recolours the HTML (Outlook classic light
 * rendering, finding F-01). It scales down with the column on narrow screens.
 * It carries no information that the text lacks (Doc 14 section 137); no text
 * is drawn into it.
 */

import { EMAIL_LOGO } from './emailLogo.js';

export const TEMPLATE_VERSION = 'b6-3';

/** Longest Job title in a subject, in extended grapheme clusters, the ellipsis included (spec section 6.2). */
export const SUBJECT_TITLE_MAX = 120;

// C0/C1 controls, Unicode line/paragraph separators and bidirectional
// formatting characters (which could visually reorder a subject). The zero-
// width joiner (U+200D) is NOT in this set: emoji sequences need it.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** One line of untrusted text: well-formed; controls, line separators and bidi formatting become spaces; whitespace collapsed and trimmed. */
export function singleLine(value) {
  return String(value ?? '')
    .toWellFormed()
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The extended grapheme clusters of a string (Unicode UAX #29, via ICU). */
export function graphemes(value) {
  return Array.from(GRAPHEMES.segment(String(value)), (part) => part.segment);
}

/**
 * The title segment of a SUBJECT (spec section 6.2): one line, at most `max`
 * grapheme clusters INCLUDING the ellipsis. A longer title keeps max - 1
 * clusters, loses trailing white space and gets "…" (U+2026). A cut never
 * splits a cluster (combining marks, ZWJ emoji, flags, keycaps, surrogates).
 */
export function headerText(value, max = SUBJECT_TITLE_MAX) {
  const line = singleLine(value);
  const clusters = graphemes(line);
  if (clusters.length <= max) return line;
  return `${clusters.slice(0, max - 1).join('').trimEnd()}…`;
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML-escapes untrusted text (SEC-049). It is made one line, without controls, first. */
export function escapeHtml(value) {
  return singleLine(value).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

/** The submission time as written in a message: absolute UTC, `YYYY-MM-DD HH:MM:SS` (Doc 09 section 188; OD-2026-10-26-02 option 1). */
export function formatTimestamp(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) throw new TypeError('submittedAt must be a valid date');
  return value.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function requireText(value, name) {
  const text = singleLine(value);
  if (text.length === 0) throw new TypeError(`${name} is required`);
  return text;
}

/* ------------------------------------------------------------------------
 * Concept A — design tokens (spec section 2; frontend tokens.css). Solid
 * colours only: the hairline is the composite of rgba(190,210,230,0.12) over
 * the reading surface.
 * --------------------------------------------------------------------- */
// b6-3 (P-04, OD-2026-11-02-01): metadata labels and footers use the body colour (the former muted
// #7E8997 measured 2.48 : 1 in Outlook classic's light rendering) and the eyebrow #83C6FF (was #66B3FF,
// 3.75 : 1 there). Both new values measured 4.75 : 1 and 4.72 : 1 in that rendering (EV-S3-OC3).
const COLOR = Object.freeze({
  canvas: '#05070A',
  surface: '#080C11',
  text: '#F4F7FA',
  body: '#B6C0CC',
  accent: '#328FFF',
  eyebrow: '#83C6FF',
  hairline: '#1E242B',
});
const FONT_DISPLAY = "'Space Grotesk','Inter','Segoe UI',Arial,Helvetica,sans-serif";
const FONT_BODY = "'Inter','Segoe UI',Arial,Helvetica,sans-serif";
const WRAP = 'word-wrap:break-word;word-break:break-word;';

// Inline style fragments (every text element declares its own colour and font).
const STYLE = Object.freeze({
  eyebrow: `margin:0 0 16px 0;font-family:${FONT_BODY};font-size:12px;line-height:16px;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;color:${COLOR.eyebrow};`,
  h1: `margin:0 0 24px 0;font-family:${FONT_DISPLAY};font-size:32px;line-height:38px;font-weight:600;letter-spacing:-0.01em;color:${COLOR.text};`,
  paragraph: `margin:0;font-family:${FONT_BODY};font-size:16px;line-height:26px;font-weight:400;color:${COLOR.body};${WRAP}`,
  note: `margin:0;font-family:${FONT_BODY};font-size:14px;line-height:22px;font-weight:400;color:${COLOR.body};`,
  footer: `margin:0;font-family:${FONT_BODY};font-size:13px;line-height:20px;font-weight:400;color:${COLOR.body};`,
  metaLabel: `margin:0 0 4px 0;font-family:${FONT_BODY};font-size:12px;line-height:16px;font-weight:400;letter-spacing:0.08em;text-transform:uppercase;color:${COLOR.body};`,
  metaValue: `margin:0;font-family:${FONT_BODY};font-size:15px;line-height:22px;font-weight:400;font-variant-numeric:tabular-nums;color:${COLOR.text};${WRAP}`,
});

const TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

/**
 * The approved masthead, inline (CID): 600 x 108 by attribute (clients that size images by attribute,
 * such as Outlook classic), fluid by style (width 100 %, at most 600 px, height following) so it narrows
 * with the column. Alt-text styling for clients that show the alt text (spec section 7.1). This markup is
 * the one the owner reviewed in Outlook classic (review mockup C2+P04, EV-S3-OC2 / EV-S3-OC3).
 */
const MASTHEAD_IMAGE = `<img src="cid:${EMAIL_LOGO.contentId}" width="${EMAIL_LOGO.width}" height="${EMAIL_LOGO.height}" alt="${EMAIL_LOGO.alt}" style="display:block;width:100%;max-width:${EMAIL_LOGO.width}px;height:auto;border:0;outline:none;text-decoration:none;font-family:${FONT_BODY};font-size:16px;font-weight:600;color:${COLOR.text};">`;

/** A cell that holds text declares its background twice: attribute and inline style (spec section 4). */
function cell(background, style, content, className = '', attributes = '') {
  const classAttribute = className ? ` class="${className}"` : '';
  return `<td${classAttribute}${attributes} bgcolor="${background}" style="background-color:${background};${style}">${content}</td>`;
}

/** The 1 px decorative line itself (spec section 4: decorative, never the only separation of content). */
const HAIRLINE_CELL = `<td height="1" bgcolor="${COLOR.hairline}" style="height:1px;font-size:1px;line-height:1px;mso-line-height-rule:exactly;background-color:${COLOR.hairline};">&nbsp;</td>`;

/**
 * A separator row in the reading surface: 24 px above and below (20 px on
 * mobile). `below: false` leaves the space below to the next row's own
 * padding (the first metadata row).
 */
function hairline({ below = true } = {}) {
  const style = below ? 'padding:24px 40px;' : 'padding:24px 40px 0 40px;';
  const className = below ? 'v-gutter v-sep' : 'v-gutter v-sep-top';
  return `<tr>${cell(COLOR.surface, style, `<table ${TABLE} width="100%" style="width:100%;"><tr>${HAIRLINE_CELL}</tr></table>`, className)}</tr>`;
}

/** One text block in the reading surface (gutters only; spacing comes from the separators). */
function block(content, extraClass = '') {
  return `<tr>${cell(COLOR.surface, 'padding:0 40px;', content, `v-gutter${extraClass ? ` ${extraClass}` : ''}`)}</tr>`;
}

/** The Concept A document around one message's reading-surface rows. */
function conceptADocument({ subject, preheader, bodyRows }) {
  const title = escapeHtml(subject);
  return [
    '<!doctype html>',
    '<html lang="en" dir="ltr">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="dark">',
    '<meta name="supported-color-schemes" content="dark">',
    '<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">',
    `<title>${title}</title>`,
    '<style>',
    ':root{color-scheme:dark;supported-color-schemes:dark;}',
    'body{margin:0;padding:0;width:100%;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}',
    'table{border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;}',
    'img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}',
    '@media only screen and (max-width:480px){',
    '.v-gutter{padding-left:24px !important;padding-right:24px !important;}',
    '.v-top{padding-top:32px !important;}',
    '.v-sep{padding-top:20px !important;padding-bottom:20px !important;}',
    '.v-sep-top,.v-note{padding-top:20px !important;}',
    '.v-meta{padding-top:14px !important;padding-bottom:14px !important;}',
    '.v-bottom{padding-bottom:28px !important;}',
    '.v-h1{font-size:28px !important;line-height:34px !important;margin-bottom:20px !important;}',
    '.v-lead{line-height:25px !important;}',
    '}',
    '</style>',
    '<!--[if mso]><style>h1,p,td{font-family:\'Segoe UI\',Arial,sans-serif !important;}</style><![endif]-->',
    '</head>',
    `<body bgcolor="${COLOR.canvas}" style="margin:0;padding:0;background-color:${COLOR.canvas};">`,
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>`,
    `<table ${TABLE} width="100%" bgcolor="${COLOR.canvas}" style="width:100%;background-color:${COLOR.canvas};">`,
    `<tr><td align="center" bgcolor="${COLOR.canvas}" style="background-color:${COLOR.canvas};">`,
    // Outlook (Word engine) ignores max-width and media queries. b6-2 wrapped the column in a FIXED 600 px
    // table, so whole-message zoom (200 %) in a narrow window scrolled sideways (finding F-03). b6-3: a full-
    // width table whose middle cell asks for 600 px and whose side cells take the rest — 600 px where there is
    // room, narrower where there is not. Its Outlook behaviour must be confirmed in Outlook (Stage 3 A1-OC).
    '<!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td></td><td width="600" style="width:600px;"><![endif]-->',
    `<table ${TABLE} width="100%" align="center" style="width:100%;max-width:600px;margin:0 auto;">`,
    // Header: the C2 masthead image — the whole row (OD-2026-11-02-01).
    `<tr>${cell(COLOR.canvas, 'padding:0;font-size:0;line-height:0;', MASTHEAD_IMAGE)}</tr>`,
    // The single accent rule, flush with the left gutter, at the bottom edge of the header.
    `<tr>${cell(COLOR.canvas, 'padding:0 40px;font-size:0;line-height:0;', [
      `<table ${TABLE} width="64" style="width:64px;"><tr>`,
      `<td width="64" height="2" bgcolor="${COLOR.accent}" style="width:64px;height:2px;font-size:2px;line-height:2px;mso-line-height-rule:exactly;background-color:${COLOR.accent};">&nbsp;</td>`,
      '</tr></table>',
    ].join(''), 'v-gutter')}</tr>`,
    ...bodyRows,
    '</table>',
    '<!--[if mso]></td><td></td></tr></table><![endif]-->',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** Eyebrow, headline and lead — the first reading-surface row. */
function opening({ eyebrow, headline, leadHtml }) {
  return `<tr>${cell(COLOR.surface, 'padding:40px 40px 0 40px;', [
    `<p style="${STYLE.eyebrow}">${eyebrow}</p>`,
    `<h1 class="v-h1" style="${STYLE.h1}">${headline}</h1>`,
    `<p class="v-lead" style="${STYLE.paragraph}">${leadHtml}</p>`,
  ].join(''), 'v-gutter v-top')}</tr>`;
}

/** The closing footer line, with the body's bottom padding. */
function footer(text) {
  return `<tr>${cell(COLOR.surface, 'padding:0 40px 32px 40px;', `<p style="${STYLE.footer}">${text}</p>`, 'v-gutter v-bottom')}</tr>`;
}

/** One metadata row: a label, then its value, in source order; a hairline follows (spec section 3.2). */
function metadataRow(label, valueHtml, breakAll) {
  const valueStyle = breakAll ? `${STYLE.metaValue}word-break:break-all;` : STYLE.metaValue;
  return [
    `<tr>${cell(COLOR.surface, 'padding:0 40px;', [
      `<table ${TABLE} width="100%" style="width:100%;"><tr>`,
      cell(COLOR.surface, 'padding:16px 0;', `<p style="${STYLE.metaLabel}">${label}</p><p style="${valueStyle}">${valueHtml}</p>`, 'v-meta'),
      `</tr><tr>${HAIRLINE_CELL}</tr></table>`,
    ].join(''), 'v-gutter')}</tr>`,
  ].join('');
}

/**
 * APPLICATION_RECEIVED_INTERNAL — the recruitment notification (approved copy,
 * OD-2026-10-26-02; AMD-COPY-EMAIL-02).
 *
 * @param {{ applicationId: string, job: { title: string, slug: string }, submittedAt: Date }} input
 * @returns {{ subject: string, text: string, html: string }}
 */
export function renderApplicationReceivedInternal({ applicationId, job, submittedAt }) {
  const reference = requireText(applicationId, 'applicationId');
  const title = requireText(job?.title, 'job.title');
  const slug = requireText(job?.slug, 'job.slug');
  const received = formatTimestamp(submittedAt);

  const subject = `New application — ${headerText(title)} | Valida`;
  const preheader = 'A new application is recorded in Valida. Candidate details remain private.';
  const note = 'Candidate details and the resume are stored privately in Valida and are not included in this email.';
  const footerLine = 'Valida · Recruitment operations';

  const text = [
    'A new application has arrived.',
    '',
    'The application is recorded in Valida.',
    '',
    `Role: ${title}`,
    `Role identifier: ${slug}`,
    `Received (UTC): ${received}`,
    `Application reference: ${reference}`,
    '',
    note,
    '',
    footerLine,
    '',
  ].join('\n');

  const html = conceptADocument({
    subject,
    preheader,
    bodyRows: [
      opening({ eyebrow: 'RECRUITMENT / NEW APPLICATION', headline: 'A new application has arrived.', leadHtml: 'The application is recorded in Valida.' }),
      hairline({ below: false }),
      metadataRow('Role', escapeHtml(title), false),
      metadataRow('Role identifier', escapeHtml(slug), true),
      metadataRow('Received (UTC)', escapeHtml(received), false),
      metadataRow('Application reference', escapeHtml(reference), true),
      `<tr>${cell(COLOR.surface, 'padding:24px 40px 0 40px;', `<p style="${STYLE.note}">${note}</p>`, 'v-gutter v-note')}</tr>`,
      hairline(),
      footer(footerLine),
    ],
  });
  return { subject, text, html };
}

/**
 * APPLICATION_ACKNOWLEDGEMENT — the candidate confirmation of RECEIPT
 * (approved copy, OD-2026-10-26-02; AMD-COPY-EMAIL-01).
 *
 * @param {{ job: { title: string } }} input
 * @returns {{ subject: string, text: string, html: string }}
 */
export function renderApplicationAcknowledgement({ job }) {
  const title = requireText(job?.title, 'job.title');
  const subject = `Application received — ${headerText(title)} | Valida`;
  const preheader = 'Thank you for applying. Your application has been received.';
  const nextStep = 'If we need more information or decide to move forward, we’ll contact you using the details in your application.';

  const text = [
    'Thank you for applying.',
    '',
    `We’ve received your application for ${title}.`,
    '',
    nextStep,
    '',
    'Valida Careers',
    '',
  ].join('\n');

  const html = conceptADocument({
    subject,
    preheader,
    bodyRows: [
      opening({ eyebrow: 'APPLICATION RECEIVED', headline: 'Thank you for applying.', leadHtml: `We’ve received your application for ${escapeHtml(title)}.` }),
      hairline(),
      block(`<p style="${STYLE.paragraph}">${nextStep}</p>`),
      hairline(),
      footer('Valida Careers'),
    ],
  });
  return { subject, text, html };
}
