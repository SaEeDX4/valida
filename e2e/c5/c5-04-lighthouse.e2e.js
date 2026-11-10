import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { C5_LAB_ORIGIN, C5_SLUGS } from '../support/c5Stack.js';
import { baseEnvironment } from '../support/processes.js';
import { ensureJobs, outputDir, record } from './c5Support.js';

/**
 * C5 — Lighthouse (Doc 16 PERF-037, Doc 17 sections 283-290), LAB only.
 *
 * Lighthouse is NOT a dependency of this repository. The case runs only when
 * C5_LIGHTHOUSE_CLI names a Lighthouse CLI installed elsewhere, for example:
 *
 *   npm install --prefix <folder outside the repository> lighthouse@13.6.0
 *   C5_LIGHTHOUSE_CLI=<folder>/node_modules/lighthouse/cli/index.js
 *
 * and is skipped otherwise, saying so. It drives Playwright's Chromium against
 * the lab compression proxy: mobile = Lighthouse's default configuration
 * (simulated Slow 4G, 4x CPU, Moto G Power emulation); desktop = --preset=desktop.
 * Lighthouse's own version, configuration, benchmark index and user agent are
 * recorded from each report. A score is one input, not the gate (Doc 16).
 */

const CLI = process.env.C5_LIGHTHOUSE_CLI;
const RUNS = Number(process.env.C5_LIGHTHOUSE_RUNS ?? 3);
const CHROME_FLAGS = process.env.C5_LIGHTHOUSE_CHROME_FLAGS ?? '--headless=new';
const PAGES = Object.freeze([
  ['home', '/'],
  ['careers', '/careers'],
  ['job', `/careers/${C5_SLUGS.open}`],
  ['apply', `/careers/${C5_SLUGS.open}/apply`],
]);

function lighthouse(url, outFile, preset) {
  const args = [CLI, url, '--output=json', `--output-path=${outFile}`, `--chrome-flags=${CHROME_FLAGS}`, '--only-categories=performance,accessibility,best-practices,seo', '--quiet'];
  if (preset === 'desktop') args.push('--preset=desktop');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env: { ...baseEnvironment(), CHROME_PATH: chromium.executablePath() }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`lighthouse exited ${code}: ${stderr.slice(-500)}`))));
  });
}

const audit = (report, id) => report.audits[id]?.numericValue ?? null;
const summary = (report) => ({
  lighthouseVersion: report.lighthouseVersion,
  fetchTime: report.fetchTime,
  formFactor: report.configSettings.formFactor,
  throttlingMethod: report.configSettings.throttlingMethod,
  throttling: report.configSettings.throttling,
  screenEmulation: report.configSettings.screenEmulation,
  benchmarkIndex: report.environment?.benchmarkIndex ?? null,
  hostUserAgent: report.environment?.hostUserAgent ?? null,
  scores: Object.fromEntries(Object.entries(report.categories).map(([k, c]) => [k, Math.round(c.score * 100)])),
  metrics: {
    fcp: audit(report, 'first-contentful-paint'),
    lcp: audit(report, 'largest-contentful-paint'),
    tbt: audit(report, 'total-blocking-time'),
    cls: audit(report, 'cumulative-layout-shift'),
    speedIndex: audit(report, 'speed-index'),
  },
  lcpElement: report.audits['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node?.snippet ?? null,
  failedAudits: Object.values(report.audits).filter((a) => a.score !== null && a.score < 0.9 && a.scoreDisplayMode !== 'informative' && a.scoreDisplayMode !== 'notApplicable' && a.scoreDisplayMode !== 'manual').map((a) => `${a.id} (${a.score})`).slice(0, 15),
});

test('C5-19 Lighthouse (lab): Home, Careers, Job Detail and Apply, mobile and desktop presets, repeated runs', async () => {
  test.skip(!CLI, 'C5_LIGHTHOUSE_CLI is not set: Lighthouse is not a repository dependency (see the header of this file). Not run, not claimed.');
  test.setTimeout(3_600_000);
  await ensureJobs();
  const dir = outputDir('lighthouse');
  const results = {};
  for (const preset of ['mobile', 'desktop']) {
    for (const [name, pathname] of PAGES) {
      const runs = [];
      for (let i = 1; i <= RUNS; i += 1) {
        const file = path.join(dir, `${name}-${preset}-${i}.report.json`);
        await lighthouse(`${C5_LAB_ORIGIN}${pathname}`, file, preset);
        runs.push({ report: `lighthouse/${path.basename(file)}`, ...summary(JSON.parse(readFileSync(file, 'utf8'))) });
      }
      const perf = runs.map((r) => r.scores.performance).sort((a, b) => a - b);
      results[`${name}/${preset}`] = { medianPerformance: perf[Math.floor(perf.length / 2)], runs };
    }
  }
  record('C5-19', { observation: 'LAB (Lighthouse against the lab compression proxy on 127.0.0.1)', cli: path.basename(path.dirname(path.dirname(CLI))), chromeFlags: CHROME_FLAGS, chromium: chromium.executablePath().split(path.sep).slice(-3).join('/'), results });
  for (const [key, r] of Object.entries(results)) expect.soft(r.medianPerformance, `${key} Lighthouse performance (PERF-037)`).toBeGreaterThanOrEqual(90);
});
