import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { FRONTEND_ORIGIN, resolveRunDirectory } from './support/paths.js';

/**
 * Valida critical browser E2E — Doc 17 sections 197-214, Doc 18 section 161.
 *
 * One worker, in order: the cases share one backend, one database and one
 * SMTP test server, and several of them count records and messages.
 * No retries: a flaky critical test is a defect (Doc 17 sections 381-382).
 *
 * Run (from e2e/, with a disposable database):
 *   MONGODB_TEST_URI=mongodb://127.0.0.1:27017/valida_test_e2e npm run test:e2e
 * See e2e/README.md.
 */
const runDir = resolveRunDirectory();

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.js',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  globalSetup: './support/globalSetup.js',
  outputDir: path.join(runDir, 'output', 'playwright'),
  reporter: [['list'], ['json', { outputFile: path.join(runDir, 'output', 'report.json') }]],
  use: {
    baseURL: FRONTEND_ORIGIN,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    // Screenshots are for people: 2x (they are full-page and taken explicitly).
    deviceScaleFactor: 2,
    locale: 'en-CA',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
