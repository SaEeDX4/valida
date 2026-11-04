import crypto from 'node:crypto';

/**
 * Recipient suppression — keyed lookup values and key material integrity
 * (RECIPIENT_SUPPRESSION_DESIGN.md rev 8, §4.1, §4.2, §4.5.1; approved by
 * OD-2026-11-04-02).
 *
 *   address digest  HMAC-SHA-256(key, "valida-suppression-v1\0" + emailNormalized)
 *   key check value HMAC-SHA-256(key, "valida-suppression-keycheck-v1\0" + keyId)
 *
 * The two use different domains, so a check value can never equal an entry
 * digest. `emailNormalized` is exactly Doc 10 section 84 (trim + lowercase,
 * done by the Application model): no further rewriting, so distinct addresses
 * are never merged.
 *
 * Key BYTES never leave this module: the keyring keeps them in a closure and
 * serialises (JSON, util.inspect) to key ids only.
 */

export const ADDRESS_DIGEST_DOMAIN = 'valida-suppression-v1\0';
export const KEY_CHECK_DOMAIN = 'valida-suppression-keycheck-v1\0';
/** A short, non-secret key identifier (stored with each digest). */
export const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
/** An address digest or a key check value. */
export const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
export const MIN_KEY_BYTES = 32;
export const MAX_KEY_BYTES = 128;
/** Verify-only previous keys (rotation). */
export const MAX_PREVIOUS_KEYS = 8;

const hmacHex = (key, domain, value) => crypto.createHmac('sha256', key).update(domain, 'utf8').update(String(value), 'utf8').digest('hex');

/** The lookup digest of one normalised address under one key. */
export function addressDigest(key, emailNormalized) {
  if (typeof emailNormalized !== 'string' || emailNormalized.length === 0) throw new TypeError('addressDigest: emailNormalized is required');
  return hmacHex(key, ADDRESS_DIGEST_DOMAIN, emailNormalized);
}

/** The non-secret check value that binds key bytes to their key id (§4.5.1). */
export function keyCheckValue(key, keyId) {
  if (!KEY_ID_PATTERN.test(String(keyId))) throw new TypeError('keyCheckValue: invalid key id');
  return hmacHex(key, KEY_CHECK_DOMAIN, keyId);
}

/**
 * Constant-time equality of two hex values (§4.5.1, SUP-22f). Anything that
 * is not a well-formed 64-character hex string — a null, a wrong length, a
 * different type — is a MISMATCH, never an exception.
 */
export function hexValuesMatch(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') return false;
  if (!DIGEST_PATTERN.test(expected) || !DIGEST_PATTERN.test(actual)) return false;
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(actual, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Decodes one base64 key (standard or URL-safe alphabet, optional padding).
 * Returns null for anything that is not 32-128 bytes of clean base64.
 */
export function decodeKey(value) {
  if (typeof value !== 'string') return null;
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  const bytes = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  // Round-trip check: rejects stray characters Buffer would silently skip.
  const canonical = bytes.toString('base64').replace(/=+$/, '');
  if (canonical !== value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')) return null;
  if (bytes.length < MIN_KEY_BYTES || bytes.length > MAX_KEY_BYTES) return null;
  return bytes;
}

/**
 * The configured keys: one current key and any verify-only previous keys.
 *
 * @param {{ current?: { keyId: string, key: Buffer } | null, previous?: Array<{ keyId: string, key: Buffer }> }} [keys]
 */
export function createKeyring({ current = null, previous = [] } = {}) {
  const bytes = new Map();
  const add = (entry) => {
    if (!entry || !KEY_ID_PATTERN.test(entry.keyId) || !Buffer.isBuffer(entry.key) || entry.key.length < MIN_KEY_BYTES) {
      throw new TypeError('createKeyring: every key needs a valid key id and at least 32 key bytes');
    }
    if (bytes.has(entry.keyId)) throw new TypeError('createKeyring: key ids must be distinct');
    bytes.set(entry.keyId, Buffer.from(entry.key));
  };
  if (current) add(current);
  for (const entry of previous ?? []) add(entry);
  const currentKeyId = current?.keyId ?? null;
  const keyIds = Object.freeze([...bytes.keys()]);
  const view = () => ({ currentKeyId, keyIds: [...keyIds] });

  const keyring = {
    /** The key id new entries are written under; null when no current key is configured. */
    currentKeyId,
    /** Every configured key id (current first). */
    keyIds,
    previousKeyIds: Object.freeze(keyIds.filter((keyId) => keyId !== currentKeyId)),
    has: (keyId) => bytes.has(keyId),
    /** The digest of `emailNormalized` under one configured key. */
    digestUnder(keyId, emailNormalized) {
      const key = bytes.get(keyId);
      if (!key) throw new TypeError('digestUnder: key id not configured');
      return addressDigest(key, emailNormalized);
    },
    /** `(keyId, digest)` under EVERY configured key (§3.2 step 2). */
    lookupPairs(emailNormalized) {
      return keyIds.map((keyId) => ({ keyId, digest: addressDigest(bytes.get(keyId), emailNormalized) }));
    },
    /** The check value the configured bytes of `keyId` produce. */
    checkValueFor(keyId) {
      const key = bytes.get(keyId);
      if (!key) throw new TypeError('checkValueFor: key id not configured');
      return keyCheckValue(key, keyId);
    },
    toJSON: view,
    [Symbol.for('nodejs.util.inspect.custom')]: view,
  };
  return Object.freeze(keyring);
}

/** The keyring of a loaded configuration (`config.suppression`); empty when none is configured. */
export function keyringFromConfig(suppression) {
  if (!suppression) return createKeyring();
  return createKeyring({ current: suppression.current ?? null, previous: suppression.previous ?? [] });
}
