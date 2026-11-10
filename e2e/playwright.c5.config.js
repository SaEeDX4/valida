import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { resolveRunDirectory } from './support/paths.js';
import { C5_SITE_ORIGIN } from './support/c5Stack.js';

/**
 * Valida C5 — integrated site quality: layout, states, accessibility and lab
 * performance against the real stack (Doc 18 sections 168-172; Doc 16
 * sections 153-282; Doc 17 sections 236-290; Doc 05 section 212).
 *
 * Its own configuration, setup and test directory (c5/), so it never runs as
 * part of the C3 or C4 suites. It reuses their run-directory, process and
 * loopback helpers unchanged. The files run in name order, one worker: the
 * first records the empty Careers state, then provisions the synthetic Jobs.
 *
 * Run (from e2e/, with a disposable database):
 *   MONGODB_TEST_URI=mongodb://127.0.0.1:27017/valida_test_c5 npm run test:e2e:c5
 * See e2e/README.md.
 */
const runDir = resolveRunDirectory();

export default defineConfig({
  testDir: './c5',
  testMatch: '**/*.e2e.js',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 600_000,
  expect: { timeout: 15_000 },
  globalSetup: './support/c5GlobalSetup.js',
  outputDir: path.join(runDir, 'output', 'playwright'),
  reporter: [['list'], ['json', { outputFile: path.join(runDir, 'output', 'report.json') }]],
  use: {
    baseURL: C5_SITE_ORIGIN,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'en-CA',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
