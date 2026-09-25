import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // Integration tests bind sockets and exercise a shared rate limiter;
    // running files sequentially keeps them deterministic.
    fileParallelism: false,
    restoreMocks: true,
  },
});
