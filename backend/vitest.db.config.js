import { defineConfig } from 'vitest/config';

/**
 * Real-database suite — requires MONGODB_TEST_URI and a running MongoDB.
 *
 * Separate from the offline config so the database tests can never be
 * accidentally included in, or excluded from, the wrong command.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/db/**/*.test.js'],
    // Refuses the whole run unless MONGODB_TEST_URI is an explicitly
    // disposable test database (scripts/test-database.mjs).
    globalSetup: ['tests/db/globalSetup.js'],
    // These share one database; running them sequentially keeps the
    // per-test cleanup deterministic.
    fileParallelism: false,
    restoreMocks: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
