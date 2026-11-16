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
export function directEndpoint() {
  const m = moto();
  return { url: new URL(m.endpoint), region: 'us-east-1', bucket: m.bucket, urlStyle: 'path', timeoutMs: 5000, accessKeyId: m.app.accessKeyId, secretAccessKey: m.app.secretAccessKey };
}

export async function readObject(key) {
  const res = await s3Request(directEndpoint(), { method: 'GET', key, maxBody: 16 * 1024 * 1024 });
  if (res.kind !== 'response' || res.status === 404) return null;
  if (res.status !== 200) throw new Error(`read-back failed: ${res.status}`);
  return res.bytes;
}

export async function listKeys(prefix = '') {
  const res = await s3Request(directEndpoint(), { method: 'GET', query: { 'list-type': '2', prefix }, maxBody: 16 * 1024 * 1024 });
  return parseListing(res.body).entries.map((entry) => entry.key);
}

export async function emptyBucket() {
  for (const key of await listKeys()) await s3Request(directEndpoint(), { method: 'DELETE', key });
}
