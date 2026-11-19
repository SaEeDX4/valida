import { defineConfig } from 'vitest/config';

/**
 * C6-T6 — the backup tooling against the local S3-compatible double (moto
 * server, its own buckets and role users: tests/backup/backup_moto_setup.py).
 * Requires VALIDA_TEST_MOTO_PYTHON, like `npm run test:s3`. The rehearsals
 * themselves (database, API, both snapshots) are e2e/c6/c6-t6-backup-rehearsal.mjs.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/backup/**/*.test.js'],
    globalSetup: ['tests/backup/globalSetup.js'],
    fileParallelism: false,
    restoreMocks: true,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
