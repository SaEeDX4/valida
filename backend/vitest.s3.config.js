import { defineConfig } from 'vitest/config';

/**
 * C6-T4 — the S3-compatible driver against a local S3 test double (moto
 * server). Requires VALIDA_TEST_MOTO_PYTHON (backend/README.md). Separate from
 * the offline suite, which stays runnable with Node alone.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/s3/**/*.test.js'],
    globalSetup: ['tests/s3/globalSetup.js'],
    // One double, one bucket: files run one after another.
    fileParallelism: false,
    restoreMocks: true,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
