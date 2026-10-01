import { RESUME_FILENAME_MAX_LENGTH } from '../../../config/resumePolicy.js';

/**
 * Original-filename normalisation — Milestone B4.
 *
 * Doc 09 section 101, Doc 10 section 98, Doc 13 sections 65 and 79.
 *
 * The candidate's filename is kept ONLY as display metadata
 * (Application.resume.originalFilename, at most 255 characters). It never
 * names, locates or authorises anything: storage keys are generated
 * server-side and temporary files are randomly named. Normalisation therefore
 * aims to keep a legitimate name recognisable — including non-Latin scripts —
 * while removing everything that could mislead a person or break a later
 * consumer (an Admin list, a Content-Disposition header in E4):
 *
 *   1. Unicode NFC, and lone surrogates replaced (toWellFormed);
 *   2. only the last path segment is kept — "/" and "\" both separate
 *      segments, so "../../x.pdf" and "C:\Users\a\x.pdf" become "x.pdf";
 *   3. tab, CR and LF become spaces; other control characters (C0, DEL,
 *      C1) are removed, and so are invisible formatting characters that can
 *      disguise a name: bidirectional overrides, embeddings, isolates and
 *      marks (the "resume\u202Efdp.exe" trick), the zero-width space, word
 *      joiners and the byte-order mark. The zero-width JOINER and NON-JOINER
 *      (U+200D, U+200C) are kept: Persian and Indic text and emoji sequences
 *      need them;
 *   4. characters Windows forbids in file names (< > : " / \ | ? *) become
 *      "_" — a colon would otherwise name an NTFS alternate data stream;
 *   5. whitespace runs collapse to one space; leading dots and spaces and
 *      trailing dots and spaces are trimmed (Windows drops trailing ones);
 *   6. a Windows reserved device name (CON, NUL, COM1, LPT1, ...) as the
 *      base name is prefixed with "_";
 *   7. the result is cut to 255 UTF-16 code units — the unit Mongoose's
 *      maxlength counts — keeping the extension and never splitting a
 *      grapheme (an emoji or a letter with its accents).
 *
 * Returns '' when nothing usable remains; the validator then refuses the
 * file because it has no accepted extension.
 */
const WHITESPACE_CONTROL = /[\t\n\v\f\r]/g;
const INVISIBLE_OR_CONTROL =
  /[\u0000-\u001f\u007f-\u009f\u061c\u180e\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\ufff9-\ufffb]/g;
const WINDOWS_FORBIDDEN = /[<>:"|?*]/g;
const RESERVED_DEVICE_NAMES = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

export function normalizeOriginalFilename(raw, { maxLength = RESUME_FILENAME_MAX_LENGTH } = {}) {
  if (typeof raw !== 'string') return '';
  let name = raw.toWellFormed().normalize('NFC');

  // 2. Last path segment only, whichever separator was used.
  const segments = name.split(/[\\/]/);
  name = segments[segments.length - 1];

  // 3-5.
  name = name
    .replace(WHITESPACE_CONTROL, ' ')
    .replace(INVISIBLE_OR_CONTROL, '')
    .replace(WINDOWS_FORBIDDEN, '_')
    .replace(/\s+/gu, ' ')
    .replace(/^[\s.]+/u, '');
  name = trimTrailingDotsAndSpace(name);
  if (name === '' || name === '..' || name === '.') return '';

  // 6.
  const dot = name.indexOf('.');
  const base = dot === -1 ? name : name.slice(0, dot);
  if (RESERVED_DEVICE_NAMES.test(base.trim())) name = `_${name}`;

  // 7.
  return truncatePreservingExtension(name, maxLength);
}

/** The lower-case final extension (".pdf"), or '' when there is none. */
export function extensionOf(filename) {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return '';
  return filename.slice(dot).toLowerCase();
}

function truncatePreservingExtension(name, maxLength) {
  if (name.length <= maxLength) return name;
  const extension = extensionOf(name);
  // Keep a plausible extension (at most 16 code units); otherwise cut plainly.
  const keep = extension && extension.length <= 16 ? name.slice(name.length - extension.length) : '';
  const stem = keep ? name.slice(0, name.length - keep.length) : name;
  const budget = maxLength - keep.length;

  let result = '';
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (const { segment } of segmenter.segment(stem)) {
    if (result.length + segment.length > budget) break;
    result += segment;
  }
  return `${trimTrailingDotsAndSpace(result)}${keep}`;
}

/**
 * Removes trailing dots and white space in LINEAR time. The regex
 * /[\s.]+$/ is quadratic on a long run of dots not at the end (each start
 * position rescans the run) — found in review; a filename header can be
 * up to 16 KiB.
 */
function trimTrailingDotsAndSpace(value) {
  let end = value.length;
  while (end > 0 && (value[end - 1] === '.' || /\s/u.test(value[end - 1]))) end -= 1;
  return value.slice(0, end);
}
