import { argon2 as argon2Callback, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ADMIN_POLICY, ARGON2_BASELINE } from '../../../config/adminAuth.js';
import { isCommonPassword } from './commonPasswords.js';

/**
 * Password hashing and policy — Doc 11 sections 33-46, 58-59, 265.
 *
 * Argon2id through Node's built-in implementation (no native add-on), stored in
 * the standard PHC encoding: $argon2id$v=19$m=<KiB>,t=<passes>,p=<lanes>$<salt>$<tag>
 * (s36). A unique 16-byte random salt per hash (s37); no pepper (s38, optional).
 * Plaintext is never stored, logged or returned (s39).
 */

const argon2 = promisify(argon2Callback);
const TAG_LENGTH = 32;
const SALT_LENGTH = 16;
const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

const b64 = (bytes) => bytes.toString('base64').replace(/=+$/, '');
const unb64 = (text) => Buffer.from(text, 'base64');

async function derive(password, salt, { memoryKiB, passes, parallelism }) {
  return argon2('argon2id', {
    message: Buffer.from(password, 'utf8'),
    nonce: salt,
    parallelism,
    tagLength: TAG_LENGTH,
    memory: memoryKiB,
    passes,
  });
}

export async function hashPassword(password, params = ARGON2_BASELINE) {
  const salt = randomBytes(SALT_LENGTH);
  const tag = await derive(password, salt, params);
  return `$argon2id$v=19$m=${params.memoryKiB},t=${params.passes},p=${params.parallelism}$${b64(salt)}$${b64(tag)}`;
}

export function parseHash(encoded) {
  const match = typeof encoded === 'string' ? PHC.exec(encoded) : null;
  if (!match) return null;
  return {
    params: { memoryKiB: Number(match[1]), passes: Number(match[2]), parallelism: Number(match[3]) },
    salt: unb64(match[4]),
    tag: unb64(match[5]),
  };
}

/** @returns {Promise<boolean>} */
export async function verifyPassword(password, encoded) {
  const parsed = parseHash(encoded);
  if (!parsed || typeof password !== 'string') return false;
  const tag = await derive(password, parsed.salt, parsed.params);
  return tag.length === parsed.tag.length && timingSafeEqual(tag, parsed.tag);
}

/** s46 — stored parameters below the current standard. */
export function needsRehash(encoded, params = ARGON2_BASELINE) {
  const parsed = parseHash(encoded);
  if (!parsed) return true;
  return parsed.params.memoryKiB < params.memoryKiB || parsed.params.passes < params.passes || parsed.params.parallelism !== params.parallelism;
}

/*
 * s59 — an unknown login email still costs one full Argon2id verification, so
 * response time does not reveal whether an account exists.
 */
let dummyHash = null;
export async function dummyVerify(password, params = ARGON2_BASELINE) {
  dummyHash ??= await hashPassword(randomBytes(24).toString('base64'), params);
  await verifyPassword(typeof password === 'string' ? password : '', dummyHash);
  return false;
}

/**
 * s41-44 — 12 to 128 characters, any characters, no composition rules, never
 * truncated, not a common password and not built from the account's own email.
 * @returns {null | { code: string, message: string }}
 */
export function passwordPolicyProblem(password, { email } = {}) {
  if (typeof password !== 'string') return { code: 'PASSWORD_REQUIRED', message: 'Enter a password.' };
  const length = [...password].length;
  if (length < ADMIN_POLICY.passwordMinLength) {
    return { code: 'PASSWORD_TOO_SHORT', message: `Use at least ${ADMIN_POLICY.passwordMinLength} characters.` };
  }
  if (length > ADMIN_POLICY.passwordMaxLength) {
    return { code: 'PASSWORD_TOO_LONG', message: `Use at most ${ADMIN_POLICY.passwordMaxLength} characters.` };
  }
  if (isCommonPassword(password)) {
    return { code: 'PASSWORD_TOO_COMMON', message: 'This password is too common or too predictable. Choose another.' };
  }
  const local = typeof email === 'string' ? email.split('@')[0].toLowerCase() : '';
  if (local.length >= 4 && password.toLowerCase().includes(local)) {
    return { code: 'PASSWORD_CONTAINS_EMAIL', message: 'The password must not contain your email name.' };
  }
  return null;
}
