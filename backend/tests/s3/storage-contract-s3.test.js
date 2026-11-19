import { defineStorageContract } from '../fixtures/storageContract.shared.js';
import { emptyBucket, readObject, s3Storage } from './s3Fixture.js';

/**
 * C6-T4 — the shared B4 storage contract (fixtures/storageContract.shared.js),
 * run against the S3-compatible driver, configured through the real loader
 * and built by the real factory, against the local S3 test double. Bytes are
 * read back by the test, not by the driver (which has no read operation).
 */
defineStorageContract('S3-compatible driver (S3_COMPATIBLE) against the local test double', {
  reset: emptyBucket,
  create: async () => s3Storage(),
  readBack: async (_storage, key) => readObject(key),
});
