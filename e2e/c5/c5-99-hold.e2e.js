import { test } from '@playwright/test';
import { C5_BACKEND_ORIGIN, C5_LAB_ORIGIN, C5_SITE_ORIGIN } from '../support/c5Stack.js';
import { ensureJobs } from './c5Support.js';

/**
 * Keeps the C5 stack up for the MANUAL checklist (docs/qa/C5_INTEGRATED_SITE_QUALITY.md):
 * the same production build, real backend, disposable database and synthetic
 * Jobs, on 127.0.0.1 only. Runs only when C5_HOLD_MINUTES is set; skipped
 * otherwise, so a normal run never waits.
 *
 *   $env:C5_HOLD_MINUTES = "60"
 *   npx playwright test --config playwright.c5.config.js c5/c5-99-hold.e2e.js
 *
 * Ctrl+C (or the time running out) stops the stack; the evidence is kept.
 */
const MINUTES = Number(process.env.C5_HOLD_MINUTES ?? 0);

test('C5-99 Hold the stack for the manual checklist', async () => {
  test.skip(!MINUTES, 'C5_HOLD_MINUTES is not set: nothing to hold.');
  test.setTimeout((MINUTES + 2) * 60_000);
  await ensureJobs();
  console.log(`\nC5 stack held for ${MINUTES} min (Ctrl+C to stop):\n  site ${C5_SITE_ORIGIN}\n  site through the lab compression proxy ${C5_LAB_ORIGIN}\n  API ${C5_BACKEND_ORIGIN}\n`);
  await new Promise((resolve) => setTimeout(resolve, MINUTES * 60_000));
});
