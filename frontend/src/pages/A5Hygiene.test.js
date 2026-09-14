import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Static hygiene on the files A5 created or rewrote.
 *
 * Same class of guard as A4Hygiene: Doc 08 section 7 makes CSS Modules the
 * styling strategy for scoped page and component styles. Inline style
 * attributes cannot be themed, cannot carry media queries, and drift from the
 * token system.
 *
 * Scoped to A5-owned production files. Locked A1-A4 code is not inspected here
 * and must not be refactored to widen this milestone.
 */
const pagesDir = dirname(fileURLToPath(import.meta.url));
const src = join(pagesDir, '..');

const A5_FILES = [
  'pages/CareersPage.jsx',
  'pages/JobDetailPage.jsx',
  'pages/ApplyPage.jsx',
  'pages/CareersPage.content.js',
  'pages/JobDetailPage.content.js',
  'pages/ApplyPage.content.js',
  'features/jobs/components/JobRow.jsx',
  'features/jobs/api/jobsApi.js',
  'features/jobs/api/jobsService.js',
  'features/jobs/hooks/useAsyncResource.js',
  'features/jobs/utils/formatJob.js',
  'features/applications/components/ResumeField.jsx',
  'features/applications/components/ScreeningQuestions.jsx',
  'features/applications/components/ValidationSummary.jsx',
  'features/applications/hooks/useApplicationSubmission.js',
  'features/applications/api/applicationsApi.js',
  'features/applications/api/applicationsService.js',
  'features/applications/utils/buildApplicationFormData.js',
  'features/applications/validation/applicationValidation.js',
  'features/applications/validation/resumeValidation.js',
  'services/api/apiClient.js',
  'services/serviceRegistry.js',
  'config/env.js',
];

const read = (relative) => readFileSync(join(src, relative), 'utf8');
const readCode = (relative) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('A5 style hygiene', () => {
  it.each(A5_FILES.map((f) => [f, f]))('%s contains no inline style attribute', (_n, file) => {
    expect(readCode(file)).not.toMatch(/style=\{\{/);
  });

  it('pairs every A5 surface with a CSS module', () => {
    [
      'pages/CareersPage.module.css',
      'pages/JobDetailPage.module.css',
      'pages/ApplyPage.module.css',
      'features/jobs/components/JobRow.module.css',
      'features/applications/components/ResumeField.module.css',
      'features/applications/components/ScreeningQuestions.module.css',
      'features/applications/components/ValidationSummary.module.css',
    ].forEach((file) => expect(read(file).length).toBeGreaterThan(0));
  });
});

describe('A5 boundary hygiene', () => {
  it('keeps fetch inside the API client', () => {
    A5_FILES.filter((f) => f !== 'services/api/apiClient.js').forEach((file) =>
      expect(readCode(file)).not.toMatch(/\bfetch\(/),
    );
  });

  it('persists no applicant data to browser storage', () => {
    A5_FILES.forEach((file) =>
      expect(readCode(file)).not.toMatch(/localStorage|sessionStorage|document\.cookie|indexedDB/),
    );
  });

  it('logs nothing from the production application path', () => {
    A5_FILES.forEach((file) => expect(readCode(file)).not.toMatch(/console\.(log|info|debug)/));
  });

  it('never repeats the /api/v1 prefix in the configured origin', () => {
    // The prefix belongs to the request paths, not the base URL.
    expect(readCode('config/env.js')).not.toMatch(/VITE_API_BASE_URL.*api\/v1/);
    ['features/jobs/api/jobsApi.js', 'features/applications/api/applicationsApi.js'].forEach((file) =>
      expect(readCode(file)).toMatch(/\/api\/v1\//),
    );
  });

  it('selects the closed-job state by code, never by bare status 409', () => {
    const code = readCode('features/applications/hooks/useApplicationSubmission.js');
    expect(code).toMatch(/code === 'JOB_NOT_ACCEPTING_APPLICATIONS'/);
    expect(code).not.toMatch(/httpStatus === 409/);
  });
});
