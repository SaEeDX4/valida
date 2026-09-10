import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vitest configuration.
 *
 * Canonical stack per 17_QA_TEST_PLAN.md sections 10-16:
 *   Vitest + React Testing Library for component behaviour,
 *   axe-core for accessibility automation.
 *
 * `css: true` processes real CSS Modules during tests so class names resolve
 * as they do in the browser, rather than tests running against a stub.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    css: true,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
  },
});
