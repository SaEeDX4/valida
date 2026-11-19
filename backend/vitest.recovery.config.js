import { defineConfig } from 'vitest/config';

/**
 * Proposed (MongoDB-native r2) — the recovery suite: the durable deletion
 * journal in the locked log bucket (the C6-T6 moto double, VALIDA_TEST_MOTO_PYTHON)
 * and the restore gate between TWO disposable auth-enabled replica sets:
 *   MONGODB_RECOVERY_LIVE_ADMIN_URI    the stand-in for the live cluster
 *   MONGODB_RECOVERY_TARGET_ADMIN_URI  the stand-in for the temporary restore target
 * Both must be replica sets with different names. It never skips: without them it fails.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/recovery/**/*.test.js'],
    globalSetup: ['tests/backup/globalSetup.js'],
    fileParallelism: false,
    restoreMocks: true,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
