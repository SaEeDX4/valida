import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { parseListObjectsV2, s3Request } from '../../integrations/storage/s3/s3Http.js';

/**
 * C6-T6 — the object operations the backup tooling needs, over the same
 * signed single-attempt request as the C6-T4 driver (s3Http.s3Request).
 *
 * Every failure is a BackupStoreError with a fixed reason; no key, endpoint,
 * credential or response body is ever part of it. Listings are strict
 * (s3Http.parseListObjectsV2): an invalid or incomplete page fails the whole
 * listing, so no decision is made on a partial view.
 */
export const BACKUP_STORE_REASONS = Object.freeze(['UNAVAILABLE', 'PERMISSION_DENIED', 'NOT_FOUND', 'CONFLICT', 'LISTING_INVALID', 'TOO_LARGE', 'UNEXPECTED_STATUS']);
const VERSION_HEADER = 'x-amz-version-id';
const PAGE = 1000;
const MAX_PAGES = 1000;
export const MAX_OBJECT_BYTES = 6 * 1024 * 1024;

export class BackupStoreError extends Error {
  constructor(operation, reason) {
    super(`backup store ${operation} failed (${reason})`);
    this.name = 'BackupStoreError';
    this.operation = operation;
    this.reason = BACKUP_STORE_REASONS.includes(reason) ? reason : 'UNEXPECTED_STATUS';
  }
}

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const transportFailure = (operation) => new BackupStoreError(operation, 'UNAVAILABLE');
function statusFailure(operation, status) {
  // A refusal by policy and a refusal by a retention lock both answer 403
  // AccessDenied; they are not told apart here.
  if (status === 401 || status === 403) return new BackupStoreError(operation, 'PERMISSION_DENIED');
  if (status === 404) return new BackupStoreError(operation, 'NOT_FOUND');
  if (status === 409 || status === 412) return new BackupStoreError(operation, 'CONFLICT');
  return new BackupStoreError(operation, 'UNEXPECTED_STATUS');
}
const versionOf = (headers) => {
  const value = headers?.[VERSION_HEADER];
  return typeof value === 'string' && value && value !== 'null' ? value : null;
};

/** { exists: false } or { exists: true, size, sha256 (stored metadata), versionId, lock } */
export async function headObject(endpoint, key) {
  const r = await s3Request(endpoint, { method: 'HEAD', key });
  if (r.kind !== 'response') throw transportFailure('head');
  if (r.status === 404) return { exists: false };
  if (r.status !== 200) throw statusFailure('head', r.status);
  return {
    exists: true,
    size: Number(r.headers['content-length']),
    sha256: typeof r.headers['x-amz-meta-sha256'] === 'string' ? r.headers['x-amz-meta-sha256'] : null,
    sourceVersion: typeof r.headers['x-amz-meta-source-version'] === 'string' ? r.headers['x-amz-meta-source-version'] : null,
    versionId: versionOf(r.headers),
    lock: typeof r.headers['x-amz-object-lock-mode'] === 'string' ? { mode: r.headers['x-amz-object-lock-mode'], retainUntil: r.headers['x-amz-object-lock-retain-until-date'] ?? null } : null,
  };
}

/** The object's bytes, its stored SHA-256 metadata and version. */
export async function getObject(endpoint, key, { versionId } = {}) {
  const r = await s3Request(endpoint, { method: 'GET', key, query: versionId ? { versionId } : {}, maxBody: MAX_OBJECT_BYTES });
  if (r.kind !== 'response') throw transportFailure('get');
  if (r.status !== 200) throw statusFailure('get', r.status);
  if (r.overflow) throw new BackupStoreError('get', 'TOO_LARGE');
  const expected = Number(r.headers['content-length']);
  if (Number.isFinite(expected) && expected !== r.bytes.length) throw new BackupStoreError('get', 'UNAVAILABLE');
  return { bytes: r.bytes, sha256: typeof r.headers['x-amz-meta-sha256'] === 'string' ? r.headers['x-amz-meta-sha256'] : null, versionId: versionOf(r.headers) };
}

/**
 * Writes a NEW object (If-None-Match: *). Returns { created: true, versionId }
 * or { created: false } when the key already exists. Never overwrites.
 */
export async function putNewObject(endpoint, key, bytes, { metadata = {}, contentType = 'application/octet-stream' } = {}) {
  const headers = {
    'content-type': contentType,
    'if-none-match': '*',
    'content-md5': createHash('md5').update(bytes).digest('base64'),
  };
  for (const [name, value] of Object.entries(metadata)) headers[`x-amz-meta-${name}`] = value;
  const r = await s3Request(endpoint, { method: 'PUT', key, headers, body: Readable.from([bytes]), contentLength: bytes.length, payloadSha256: sha256Hex(bytes) });
  if (r.kind !== 'response') throw transportFailure('put');
  if (r.status === 200) return { created: true, versionId: versionOf(r.headers) };
  if (r.status === 412) return { created: false };
  throw statusFailure('put', r.status);
}

/** Every key under `prefix`, all pages, strictly validated. */
export async function listKeys(endpoint, prefix) {
  const out = [];
  const seen = new Set();
  let token = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query = { 'list-type': '2', prefix, 'max-keys': String(PAGE), ...(token ? { 'continuation-token': token } : {}) };
    const r = await s3Request(endpoint, { method: 'GET', query, maxBody: 8 * 1024 * 1024 });
    if (r.kind !== 'response') throw transportFailure('list');
    if (r.status !== 200) throw statusFailure('list', r.status);
    if (r.overflow) throw new BackupStoreError('list', 'LISTING_INVALID');
    const listing = parseListObjectsV2(r.body, { bucket: endpoint.bucket, prefix, pageSize: PAGE, continuationToken: token });
    if (!listing.ok) throw new BackupStoreError('list', 'LISTING_INVALID');
    for (const entry of listing.entries) {
      if (seen.has(entry.key)) throw new BackupStoreError('list', 'LISTING_INVALID');
      seen.add(entry.key);
      out.push(entry);
    }
    if (!listing.truncated) return out;
    if (listing.nextToken === token) throw new BackupStoreError('list', 'LISTING_INVALID');
    token = listing.nextToken;
  }
  throw new BackupStoreError('list', 'LISTING_INVALID');
}

/** Removes exactly the version observed (C6-T4 correction 2); refuses without one. */
export async function deleteObjectVersion(endpoint, key, versionId) {
  if (!versionId) throw new BackupStoreError('delete', 'CONFLICT');
  const r = await s3Request(endpoint, { method: 'DELETE', key, query: { versionId } });
  if (r.kind !== 'response') throw transportFailure('delete');
  if (r.status === 204 || r.status === 200) return { deleted: true };
  if (r.status === 404) return { deleted: false };
  throw statusFailure('delete', r.status);
}

/** An unauthenticated GET: its status (403 expected). */
export async function anonymousGetStatus(endpoint, key) {
  const r = await s3Request(endpoint, { method: 'GET', key, anonymous: true, maxBody: 64 * 1024 });
  if (r.kind !== 'response') throw transportFailure('anonymous-get');
  return r.status;
}

export { sha256Hex };
