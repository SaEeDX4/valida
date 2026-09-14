import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveService, clearServiceOverrides, SERVICE } from '../services/serviceRegistry.js';
import * as jobsApi from '../features/jobs/api/jobsApi.js';
import { getJobsService } from '../features/jobs/api/jobsService.js';
import { getApplicationsService } from '../features/applications/api/applicationsService.js';
import * as applicationsApi from '../features/applications/api/applicationsApi.js';

/**
 * Production isolation of the controlled development fixtures.
 *
 * The single rule A5 must never break: synthetic Job or Application data must
 * be impossible to reach in production, and impossible to reach by accident in
 * development.
 */
const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(srcDir, relative), 'utf8');

/**
 * Reads a module with comments removed.
 *
 * These guards are about what the CODE does. Documentation that explains why a
 * fixture must never be reachable would otherwise trip a check looking for the
 * word "fixture" — a false positive that would make the guard untrustworthy.
 * Line comments are only stripped when not part of a URL scheme.
 */
const readCode = (relative) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

afterEach(() => clearServiceOverrides());

describe('fixtures cannot become production behaviour', () => {
  it('resolves the real API modules when no override is installed', () => {
    expect(getJobsService()).toBe(jobsApi);
    expect(getApplicationsService()).toBe(applicationsApi);
  });

  it('gates activation on BOTH import.meta.env.DEV and the explicit flag', () => {
    const env = read('config/env.js');
    expect(env).toMatch(/import\.meta\.env\.DEV === true/);
    expect(env).toMatch(/VITE_ENABLE_A5_FIXTURES === 'true'/);
    // Both conditions in one expression: neither alone can enable fixtures.
    expect(env).toMatch(/import\.meta\.env\.DEV === true\s*&&\s*import\.meta\.env\.VITE_ENABLE_A5_FIXTURES === 'true'/);
  });

  it('installs fixtures from exactly one place, behind a statically foldable gate', () => {
    const main = readCode('main.jsx');
    // Written inline, not behind a helper call: Vite replaces
    // import.meta.env.DEV with `false` at build time, so Rollup can eliminate
    // the branch and drop the fixture chunk. A helper call would hide the
    // constant and ship the fixtures.
    expect(main).toMatch(/if \(import\.meta\.env\.DEV && import\.meta\.env\.VITE_ENABLE_A5_FIXTURES === 'true'\)/);
    expect(main).toMatch(/import\('\.\/dev\/installDevFixtures\.js'\)/);
    expect(main).not.toMatch(/^import .*installDevFixtures/m);
  });

  it('is never imported by any production module', () => {
    const productionFiles = [
      'pages/CareersPage.jsx', 'pages/JobDetailPage.jsx', 'pages/ApplyPage.jsx',
      'features/jobs/api/jobsApi.js', 'features/jobs/api/jobsService.js',
      'features/applications/api/applicationsApi.js',
      'features/applications/api/applicationsService.js',
      'features/applications/hooks/useApplicationSubmission.js',
      'services/api/apiClient.js', 'services/serviceRegistry.js',
      'features/jobs/hooks/useAsyncResource.js',
    ];
    productionFiles.forEach((file) => {
      const source = readCode(file);
      expect(source).not.toMatch(/dev\/fixtures|installDevFixtures|devJobFixtures/);
    });
  });

  it('contains no error path that falls back to fixtures', () => {
    // The decisive structural check: no production module may reference a
    // fixture or install an override from a catch block.
    [
      'features/jobs/hooks/useAsyncResource.js',
      'features/applications/hooks/useApplicationSubmission.js',
      'pages/CareersPage.jsx', 'pages/JobDetailPage.jsx', 'pages/ApplyPage.jsx',
    ].forEach((file) => {
      const source = readCode(file);
      expect(source).not.toMatch(/setServiceOverride/);
      expect(source).not.toMatch(/fixture/i);
    });
  });

  it('never activates from a query string alone', () => {
    const installer = read('dev/installDevFixtures.js');
    // The installer reads ?a5= for scenario choice, but it can only run once
    // the DEV + flag gate in main.jsx has already admitted it.
    expect(installer).toMatch(/a5/);
    // The installer itself reads no environment flag: it is admitted or not by
    // the gate in main.jsx, so it can never self-enable.
    expect(readCode('dev/installDevFixtures.js')).not.toMatch(/import\.meta\.env/);
    expect(readCode('main.jsx')).toMatch(/import\.meta\.env\.DEV/);
  });

  it('marks synthetic content unmistakably and claims no approved Job data', () => {
    const fixtures = read('dev/fixtures/devJobFixtures.js');
    expect(fixtures).toMatch(/\[DEV FIXTURE\]/);
    // Doc 06 section 108: these fields are not source-established, so every
    // fixture value for them is prefixed as synthetic.
    expect(fixtures).toMatch(/SYNTHETIC.*synthetic responsibility|synthetic responsibility/i);
    expect(fixtures).toMatch(/NOT source-established/i);
  });

  it('keeps NOC out of every public fixture (Doc 09 section 47)', () => {
    expect(read('dev/fixtures/devJobFixtures.js')).not.toMatch(/\bNOC\b|21220/);
  });
});

describe('service registry seam', () => {
  it('returns the real implementation unless explicitly overridden', () => {
    const real = { marker: 'real' };
    expect(resolveService(SERVICE.JOBS, real)).toBe(real);
  });

  it('only an explicit installer can replace a service', () => {
    const real = { marker: 'real' };
    expect(resolveService(SERVICE.APPLICATIONS, real)).toBe(real);
    clearServiceOverrides();
    expect(resolveService(SERVICE.APPLICATIONS, real)).toBe(real);
  });
});

describe('no applicant data is persisted by design', () => {
  it('uses no browser storage anywhere in the Apply path', () => {
    [
      'pages/ApplyPage.jsx',
      'features/applications/hooks/useApplicationSubmission.js',
      'features/applications/components/ResumeField.jsx',
      'features/applications/utils/buildApplicationFormData.js',
    ].forEach((file) => {
      const source = readCode(file);
      expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/);
    });
  });

  it('logs no candidate data', () => {
    ['pages/ApplyPage.jsx', 'features/applications/hooks/useApplicationSubmission.js']
      .forEach((file) => expect(readCode(file)).not.toMatch(/console\.(log|info|debug|warn|error)/));
  });

  it('keeps scattered fetch calls out of pages and components', () => {
    ['pages/CareersPage.jsx', 'pages/JobDetailPage.jsx', 'pages/ApplyPage.jsx',
     'features/jobs/components/JobRow.jsx', 'features/applications/components/ResumeField.jsx']
      .forEach((file) => expect(readCode(file)).not.toMatch(/\bfetch\(/));
  });

  it('exposes no secret-shaped variable to the browser config', () => {
    const env = readCode('config/env.js');
    expect(env).not.toMatch(/SECRET|PASSWORD|MONGODB|PRIVATE_KEY|TOKEN/i);
  });
});


describe('dev success fixture mirrors the real success contract (cycle 2, finding 6)', () => {
  /**
   * The dev service override bypasses applicationsApi, so without this test the
   * browser QA success screen could be produced by a payload the production
   * contract would reject — exactly the drift finding 6 identified.
   *
   * Running the fixture's own result through the production validator keeps the
   * two in step.
   */
  it('returns a payload the production validator accepts', async () => {
    const { default: installDevFixtures } = await import('./installDevFixtures.js');
    const { getApplicationsService } = await import('../features/applications/api/applicationsService.js');
    const { isValidApplicationResult } = await import('../features/applications/api/applicationsApi.js');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.history.replaceState({}, '', '/careers/x/apply?a5=apply-success');
    installDevFixtures();

    const result = await getApplicationsService().submitApplication('cybersecurity-specialist', new FormData(), {
      idempotencyKey: 'test-key-0000000000',
    });

    expect(isValidApplicationResult(result.data)).toBe(true);
    expect(result.data.status).toBe('RECEIVED');
    expect(result.data.job.slug).toBe('cybersecurity-specialist');
    expect(typeof result.data.submittedAt).toBe('string');
    expect(Number.isNaN(Date.parse(result.data.submittedAt))).toBe(false);
    // The contract deliberately exposes no public Application id.
    expect(result.data.id).toBeUndefined();

    warn.mockRestore();
    window.history.replaceState({}, '', '/');
  }, 15000);
});
