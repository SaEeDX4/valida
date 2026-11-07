import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { resolveRunDirectory } from './support/paths.js';
import { SEO_INDEXED_ORIGIN } from './support/seoStack.js';

/**
 * Valida C4 SEO stack verification — Doc 16 sections 77-152 and 262-266,
 * Doc 17 sections 214 and 258-273, Doc 18 section 167.
 *
 * Its own configuration, setup and test directory (seo/), so it never runs as
 * part of the C3 suite and the C3 suite never runs here. It reuses the C3 run
 * directory, process and loopback helpers unchanged.
 *
 * Run (from e2e/, with a disposable database):
 *   MONGODB_TEST_URI=mongodb://127.0.0.1:27017/valida_test_seo npm run test:e2e:seo
 * See e2e/README.md.
 */
const runDir = resolveRunDirectory();

export default defineConfig({
  testDir: './seo',
  testMatch: '**/*.e2e.js',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  globalSetup: './support/seoGlobalSetup.js',
  outputDir: path.join(runDir, 'output', 'playwright'),
  reporter: [['list'], ['json', { outputFile: path.join(runDir, 'output', 'report.json') }]],
  use: {
    baseURL: SEO_INDEXED_ORIGIN,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: 'en-CA',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
