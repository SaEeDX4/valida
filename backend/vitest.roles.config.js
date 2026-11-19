import { defineConfig } from 'vitest/config';

/**
 * Proposed (MongoDB-native) — the database-role suite. Requires
 * MONGODB_ROLES_ADMIN_URI: an auth-enabled, DISPOSABLE MongoDB and a user that
 * may create roles and users (locally: the localhost exception's first user).
 * It never skips: without the variable it fails.
 */
export default defineConfig({
  test: { environment: 'node', include: ['tests/mongo-roles/**/*.test.js'], fileParallelism: false, testTimeout: 30_000, hookTimeout: 30_000 },
});
