import { defineConfig } from 'vitest/config';

/**
 * Offline suite — no database required.
 *
 * tests/db is excluded deliberately. Those tests need a real MongoDB, and a
 * default command that silently skipped them would let `npm test` report green
 * while persistence and uniqueness were never exercised. They are run by
 * `npm run test:db` and gated by `npm run verify:b2`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: ['tests/db/**', 'node_modules/**'],
    // Integration tests bind sockets and exercise a shared rate limiter;
    // running files sequentially keeps them deterministic.
    fileParallelism: false,
    restoreMocks: true,
  },
});
