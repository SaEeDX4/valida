import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP — RFC 6238 over HMAC-SHA-1, 30-second steps, 6 digits (Doc 11 s72),
 * a window of the current step ±1 (s73), and replay refusal: a step at or
 * before the last one used is never accepted again (s74).
 *
 * Implemented here rather than through a dependency: it is ~40 lines over
 * node:crypto and is checked against the RFC 6238 appendix B test vectors.
 */

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_SECRET_BYTES = 20; // 160 bits, the RFC 4226 recommendation for SHA-1
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new TypeError('invalid base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

export function timeStep(nowMs) {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

export function totpAt(secretBase32, step, { digits = TOTP_DIGITS, algorithm = 'sha1' } = {}) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac(algorithm, base32Decode(secretBase32)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** s189 — accepts "123 456" and "123-456"; anything else is simply wrong. */
export function normaliseTotpInput(input) {
  const compact = String(input ?? '').replace(/[\s-]/g, '');
  return /^\d{6}$/.test(compact) ? compact : null;
}

/**
 * @returns {{ ok: true, step: number } | { ok: false }}
 */
export function verifyTotp(secretBase32, input, { nowMs, lastUsedStep = null }) {
  const code = normaliseTotpInput(input);
  if (code === null) return { ok: false };
  const current = timeStep(nowMs);
  let matched = null;
  for (const step of [current - 1, current, current + 1]) {
    const expected = Buffer.from(totpAt(secretBase32, step));
    // Every candidate is compared, so timing does not reveal a near match.
    if (timingSafeEqual(expected, Buffer.from(code)) && matched === null) matched = step;
  }
  if (matched === null) return { ok: false };
  if (lastUsedStep !== null && matched <= lastUsedStep) return { ok: false };
  return { ok: true, step: matched };
}

export function otpauthUri({ secretBase32, accountName, issuer = 'Valida' }) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
