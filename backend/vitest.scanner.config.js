import { defineConfig } from 'vitest/config';

/**
 * Proposed (MongoDB-native r2, finding 3) — the scanner suite: the REAL ClamAV
 * daemon (CLAMD_TEST_HOST / CLAMD_TEST_PORT, default 127.0.0.1:3310) and a
 * disposable MongoDB (MONGODB_TEST_URI). It never skips: the global setup fails
 * the run when clamd does not answer VERSION or the database target is refused.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/scanner/**/*.test.js'],
    globalSetup: ['tests/scanner/globalSetup.js'],
    fileParallelism: false,
    restoreMocks: true,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
