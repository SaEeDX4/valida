import { createHash, randomBytes } from 'node:crypto';

/**
 * Private storage contract — Milestone B4: provider identifiers, the storage
 * key format and the fixed failure classification shared by the storage
 * boundary (privateStorage.js) and every integration behind it.
 */

/** Doc 10 section 95 — internal provider identifiers. */
export const STORAGE_PROVIDERS = Object.freeze({
  LOCAL_DEVELOPMENT: 'LOCAL_DEVELOPMENT',
});

/**
 * Storage keys — Doc 09 section 102: `resumes/{generated-identifier}/{generated-file-key}`.
 *
 * Both parts are 128 bits from the CSPRNG, written as lowercase hex. Hex, not
 * base64url: object names become file names on the local adapter, and on a
 * case-insensitive filesystem (Windows NTFS, default macOS APFS) two base64
 * keys differing only in case would name the SAME file. The candidate's
 * filename never contributes (Doc 10 section 96).
 */
export const RESUME_STORAGE_KEY_PATTERN = /^resumes\/[0-9a-f]{32}\/[0-9a-f]{32}$/;

export function generateResumeStorageKey(random = randomBytes) {
  return `resumes/${random(16).toString('hex')}/${random(16).toString('hex')}`;
}

export function isResumeStorageKey(value) {
  return typeof value === 'string' && RESUME_STORAGE_KEY_PATTERN.test(value);
}

/**
 * The object reference used in LOGS instead of a storage key — Milestone B5.
 *
 * A storage key is private: never in a response (Doc 09 section 22, Doc 13
 * sections 237 and 279), "not public metadata" (SEC-026), "not exposed in
 * ordinary application data" (Doc 13 section 81), and not among the fields
 * Doc 09 section 150 lists for Application logs. So no log carries one. Where an operator must be able to
 * find ONE object — an orphan whose deletion failed, or an object kept because
 * its Application's outcome is unknown (Doc 09 section 119: "cleanup/
 * reconciliation process must be able to identify it") — the log carries this
 * reference: the first 128 bits of SHA-256 over the domain-separated key.
 *
 * It is one-way (the key holds 256 random bits) and grants nothing. It is
 * resolved only by something that may already list private storage — the
 * reconciliation process (Doc 10 sections 207-209, Doc 15 sections 200-204),
 * which computes it for each object it lists. A failed local write can leave
 * `<key>.partial-<random>`; the key is that name without the suffix. The key itself stays where it
 * is already protected: in the private store and in MongoDB.
 *
 * @param {string} storageKey
 * @returns {string} 32 lowercase hex characters
 */
export function storageObjectRef(storageKey) {
  return createHash('sha256').update(`valida:storage-object-ref:v1:${storageKey}`, 'utf8').digest('hex').slice(0, 32);
}

/** Fixed failure reasons — the only values a storage failure can log. */
export const STORAGE_FAILURE_REASONS = Object.freeze([
  'NOT_READY',
  'DEVELOPMENT_ONLY',
  'INVALID_KEY',
  'INVALID_REQUEST',
  'INTEGRITY_MISMATCH',
  'SOURCE_UNREADABLE',
  'KEY_COLLISION',
  'NO_SPACE',
  'PERMISSION_DENIED',
  'READ_ONLY',
  'NOT_A_FILE',
  'NOT_A_DIRECTORY',
  'PERMISSIONS_TOO_OPEN',
  'PROBE_MISMATCH',
  'TOO_MANY_OPEN_FILES',
  // B4 review r1, finding 2: the configured root really leads into a public
  // directory or the repository, or a path the adapter is about to use no
  // longer resolves to where it must be (a linked or swapped directory).
  'FORBIDDEN_LOCATION',
  'PATH_ESCAPES_STORAGE',
  'IO_ERROR',
]);

const REASON_SET = new Set(STORAGE_FAILURE_REASONS);

/** A storage operation failed. `reason` is always a member of STORAGE_FAILURE_REASONS. */
export class PrivateStorageError extends Error {
  constructor(operation, reason, cause) {
    const safeReason = REASON_SET.has(reason) ? reason : 'IO_ERROR';
    super(`private storage ${operation} failed: ${safeReason}`);
    this.name = 'PrivateStorageError';
    this.operation = operation;
    this.reason = safeReason;
    if (cause !== undefined) this.cause = cause;
  }
}

/** Startup could not make the configured storage usable. */
export class StorageInitializationError extends PrivateStorageError {
  constructor(reason, cause) {
    super('initialisation', reason, cause);
    this.name = 'StorageInitializationError';
  }
}

/**
 * Maps a filesystem error to a fixed reason by EXACT code membership. The
 * error's own text (which contains the path) is never used.
 */
const FS_CODE_REASONS = new Map([
  ['ENOSPC', 'NO_SPACE'],
  ['EDQUOT', 'NO_SPACE'],
  ['EACCES', 'PERMISSION_DENIED'],
  ['EPERM', 'PERMISSION_DENIED'],
  ['EROFS', 'READ_ONLY'],
  ['EMFILE', 'TOO_MANY_OPEN_FILES'],
  ['ENFILE', 'TOO_MANY_OPEN_FILES'],
  ['ENOTDIR', 'NOT_A_DIRECTORY'],
  ['EISDIR', 'NOT_A_FILE'],
  ['EEXIST', 'KEY_COLLISION'],
]);

export function classifyStorageError(error) {
  if (error instanceof PrivateStorageError) return error.reason;
  const code = typeof error?.code === 'string' ? error.code : '';
  return FS_CODE_REASONS.get(code) ?? 'IO_ERROR';
}
