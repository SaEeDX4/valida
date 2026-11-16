import { inject } from 'vitest';
import { loadConfig } from '../../src/config/env.js';
import { createPrivateStorage } from '../../src/integrations/storage/privateStorage.js';
import { parseListing, s3Request } from '../../src/integrations/storage/s3/s3Http.js';
import { OFFLINE_TEST_MONGODB_URI } from '../helpers.js';

/**
 * C6-T4 — helpers for the S3 suite: configuration through the REAL loader,
 * and test-side access to the double (independent of the driver under test)
 * for reading back bytes and emptying the bucket.
 */
export const moto = () => inject('moto');

export function s3Env(overrides = {}) {
  const m = moto();
  return {
    NODE_ENV: 'test',
    APP_ENV: 'local',
    MONGODB_URI: OFFLINE_TEST_MONGODB_URI,
    RESUME_STORAGE_DRIVER: 's3',
    RESUME_STORAGE_S3_ENDPOINT: m.endpoint,
    RESUME_STORAGE_S3_REGION: 'us-east-1',
    RESUME_STORAGE_S3_BUCKET: m.bucket,
    RESUME_STORAGE_S3_ACCESS_KEY_ID: m.app.accessKeyId,
    RESUME_STORAGE_S3_SECRET_ACCESS_KEY: m.app.secretAccessKey,
    RESUME_STORAGE_S3_TIMEOUT_MS: '5000',
    ...overrides,
  };
}

export function s3Config(overrides = {}) {
  return loadConfig(s3Env(overrides));
}

export function s3Storage(overrides = {}, options = {}) {
  const config = s3Config(overrides);
  return createPrivateStorage({ config, ...options });
}

/** The double, as the test sees it (the app user's credentials, path style). */
export function directEndpoint({ bucket, as = 'app' } = {}) {
  const m = moto();
  const creds = m[as];
  return { url: new URL(m.endpoint), region: 'us-east-1', bucket: bucket ?? m.bucket, urlStyle: 'path', timeoutMs: 5000, accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey };
}

export async function readObject(key, { bucket } = {}) {
  const res = await s3Request(directEndpoint({ bucket, as: 'fixture' }), { method: 'GET', key, maxBody: 16 * 1024 * 1024 });
  if (res.kind !== 'response' || res.status === 404) return null;
  if (res.status !== 200) throw new Error(`read-back failed: ${res.status}`);
  return res.bytes;
}

export async function listKeys(prefix = '', { bucket } = {}) {
  const res = await s3Request(directEndpoint({ bucket }), { method: 'GET', query: { 'list-type': '2', prefix }, maxBody: 16 * 1024 * 1024 });
  return parseListing(res.body).entries.map((entry) => entry.key);
}

/**
 * C6-T4 correction 2: every version and delete marker in a bucket (test-side
 * fixture credentials; the backend's credentials cannot list versions).
 * Returns { versions: [{ key, versionId, isLatest }], deleteMarkers: [...] }.
 */
export async function listVersions({ bucket } = {}) {
  const res = await s3Request(directEndpoint({ bucket, as: 'fixture' }), { method: 'GET', query: { versions: '' }, maxBody: 16 * 1024 * 1024 });
  if (res.kind !== 'response' || res.status !== 200) throw new Error(`version listing failed: ${res.status ?? res.code}`);
  const pick = (tag) =>
    [...res.body.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => ({
      key: /<Key>([^<]*)<\/Key>/.exec(m[1])[1],
      versionId: /<VersionId>([^<]*)<\/VersionId>/.exec(m[1])[1],
      isLatest: /<IsLatest>true<\/IsLatest>/.test(m[1]),
    }));
  return { versions: pick('Version'), deleteMarkers: pick('DeleteMarker') };
}

/** Removes every version and delete marker from both résumé buckets. */
export async function emptyBucket() {
  for (const bucket of [moto().bucket, moto().unversionedBucket]) {
    const { versions, deleteMarkers } = await listVersions({ bucket });
    for (const { key, versionId } of [...versions, ...deleteMarkers]) {
      await s3Request(directEndpoint({ bucket, as: 'fixture' }), { method: 'DELETE', key, query: versionId && versionId !== 'null' ? { versionId } : {} });
    }
  }
}

/** Test-side PUT straight into the double (not through the driver): a pre-existing object. */
export async function putObject(key, bytes, metadata = {}, { bucket, as = 'app' } = {}) {
  const { Readable } = await import('node:stream');
  const { createHash } = await import('node:crypto');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const headers = { 'content-type': 'application/octet-stream' };
  for (const [name, value] of Object.entries(metadata)) headers[`x-amz-meta-${name}`] = value;
  const res = await s3Request(directEndpoint({ bucket, as }), { method: 'PUT', key, headers, body: Readable.from([bytes]), contentLength: bytes.length, payloadSha256: digest });
  if (res.kind !== 'response' || res.status !== 200) throw new Error(`test PUT failed: ${res.status ?? res.code}`);
  return { versionId: res.headers['x-amz-version-id'] ?? null };
}

/** HEAD as the test sees it: { exists, length, lastModified, etag, metadata }. */
export async function headObject(key, { bucket, versionId } = {}) {
  const res = await s3Request(directEndpoint({ bucket, as: 'fixture' }), { method: 'HEAD', key, query: versionId ? { versionId } : {} });
  if (res.status === 404) return { exists: false };
  const metadata = Object.fromEntries(Object.entries(res.headers).filter(([k]) => k.startsWith('x-amz-meta-')).map(([k, v]) => [k.slice(11), v]));
  return { exists: true, length: Number(res.headers['content-length']), lastModified: res.headers['last-modified'], etag: res.headers.etag, versionId: res.headers['x-amz-version-id'] ?? null, metadata };
}
