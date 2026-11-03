import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * The email masthead image — Milestone B6, template version b6-3 (C2),
 * approved by the owner in OD-2026-11-02-01 (exact bytes below).
 *
 * The whole header row as one image: the approved transparent horizontal
 * lockup (frontend/public/brand/valida-logo-horizontal-transparent.png,
 * SHA-256 f274e8ba…3377), resampled ONLY, placed on the canvas colour #05070A
 * at the former logo position; 1200 x 216 px, shown at 600 x 108 CSS px and
 * scaling down with the column on narrow screens. No text is drawn into it.
 * Derivation: docs/qa/b6-stage3/tools/make_f01_candidates.py (C2).
 *
 * It travels inline, as a CID related part: nothing is fetched from anywhere,
 * so it cannot signal an open (Doc 14 section 138).
 *
 * The bytes are pinned: they are read once and must match the approved
 * SHA-256, or composing the message fails (a defect, never a substitute
 * image). The file name and Content-ID are constants and carry no candidate
 * or Application data; they are unchanged from b6-2.
 *
 * The previous asset (b6-2, the dark lockup 316 x 72, SHA-256 b8c54174…341a,
 * OD-2026-10-27-01) is no longer used; its approved bytes are kept in
 * docs/qa/b6-stage2/logo/valida-logo-email-316x72.candidate.png.
 */
export const EMAIL_LOGO = Object.freeze({
  file: 'valida-email-masthead-1200x216.png',
  sha256: 'ac67a2cb7d447a55d89bb3264198743d4114190e259775535215acabba1aea3b',
  contentId: 'valida-logo.b6@cybervalida.com',
  filename: 'valida-logo.png',
  contentType: 'image/png',
  width: 600,
  height: 108,
  alt: 'Valida',
});

let verifiedBytes = null;

/** The approved image bytes; throws if the asset is missing or does not match its approved hash. */
export function emailLogoBytes() {
  if (verifiedBytes) return verifiedBytes;
  const bytes = fs.readFileSync(new URL(`./assets/${EMAIL_LOGO.file}`, import.meta.url));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== EMAIL_LOGO.sha256) {
    throw new Error('email logo asset does not match its approved SHA-256');
  }
  verifiedBytes = bytes;
  return verifiedBytes;
}
