import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Server-side secret handling for Admin authentication — Doc 11 s29-30, s66-68,
 * s77-80, s110, s123-124, s237.
 */

/** s29-30, s123 — 32 random bytes, URL-safe. Only its SHA-256 is ever stored. */
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/* s77-80 — ten one-time codes of 128 bits each, shown once, stored as SHA-256. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no I, L, O, U, 0, 1: unambiguous when copied by hand

export function generateRecoveryCode() {
  // 26 symbols from a 30-symbol alphabet ≈ 127.6 bits, with rejection sampling (no bias).
  const symbols = [];
  while (symbols.length < 26) {
    for (const byte of randomBytes(32)) {
      if (byte < 240 && symbols.length < 26) symbols.push(CODE_ALPHABET[byte % 30]);
    }
  }
  const raw = symbols.join('');
  return `${raw.slice(0, 5)}-${raw.slice(5, 10)}-${raw.slice(10, 15)}-${raw.slice(15, 20)}-${raw.slice(20)}`;
}

export function normaliseRecoveryCode(input) {
  const compact = String(input ?? '').toUpperCase().replace(/[\s-]/g, '');
  return /^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{26}$/.test(compact) ? compact : null;
}

export function hashRecoveryCode(code) {
  return sha256Hex(`valida-recovery:${normaliseRecoveryCode(code) ?? ''}`);
}

/**
 * s66-68, s237 — the TOTP secret, encrypted with AES-256-GCM under a server key
 * that never touches the database; the record keeps only the key id.
 * Format: v1.<iv b64url>.<tag b64url>.<ciphertext b64url>, the key id bound as AAD.
 */
export function createSecretBox({ keys, currentKeyId }) {
  if (!(keys instanceof Map) || !keys.has(currentKeyId)) throw new TypeError('secret box: a current key is required');
  return Object.freeze({
    currentKeyId,
    seal(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', keys.get(currentKeyId), iv);
      cipher.setAAD(Buffer.from(`valida-mfa:${currentKeyId}`));
      const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
      return { keyId: currentKeyId, ciphertext: ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.') };
    },
    open({ keyId, ciphertext }) {
      const key = keys.get(keyId);
      const parts = String(ciphertext ?? '').split('.');
      if (!key || parts.length !== 4 || parts[0] !== 'v1') throw new Error('MFA_SECRET_UNAVAILABLE');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64url'));
      decipher.setAAD(Buffer.from(`valida-mfa:${keyId}`));
      decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
    },
  });
}
