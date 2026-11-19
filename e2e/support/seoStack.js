import { readFileSync } from 'node:fs';
import path from 'node:path';
import { baseEnvironment } from './processes.js';
import { LOCAL_RECRUITMENT_ENVIRONMENT } from './stackConfig.js';

/**
 * Fixed settings of the C4 SEO stack run (playwright.seo.config.js). Separate
 * ports from the C3 suite, so the two never meet.
 *
 * Two builds of the SAME commit are served by the C4 document server
 * (frontend/server/serve.mjs), both reading the same real backend:
 *   INDEXED  VITE_ALLOW_INDEXING=true, VITE_PUBLIC_SITE_URL=https://cybervalida.com
 *            — the production configuration, with the approved canonical
 *            origin (OD-2026-11-09-01); it is not served there, only on 127.0.0.1;
 *   REVIEW   no SEO variables — the default review build.
 * Neither is a deployment: everything listens on 127.0.0.1.
 */
export const SEO_BACKEND_PORT = Number(process.env.E2E_SEO_BACKEND_PORT ?? 4110);
export const SEO_INDEXED_PORT = Number(process.env.E2E_SEO_INDEXED_PORT ?? 4193);
export const SEO_REVIEW_PORT = Number(process.env.E2E_SEO_REVIEW_PORT ?? 4194);
export const SEO_BACKEND_ORIGIN = `http://127.0.0.1:${SEO_BACKEND_PORT}`;
export const SEO_INDEXED_ORIGIN = `http://127.0.0.1:${SEO_INDEXED_PORT}`;
export const SEO_REVIEW_ORIGIN = `http://127.0.0.1:${SEO_REVIEW_PORT}`;
export const SEO_SITE_URL = 'https://cybervalida.com';

/** The run's facts (no secrets), written by the setup. */
export function readSeoRun() {
  return JSON.parse(readFileSync(path.join(process.env.E2E_RUN_DIR, 'run.json'), 'utf8'));
}

/**
 * The backend's environment for the run and its CLIs.
 *
 *   NODE_ENV=development, APP_ENV=local      a local run;
 *   TRANSACTIONAL_EMAIL_PROVIDER unset        no mail at all ("none"): C4 submits nothing;
 *   APPLICATION_ACKNOWLEDGEMENT_ENABLED=false acknowledgements stay off;
 *   RATE_LIMIT_MAX=1000                       the document server and the browser both read
 *       the Jobs API from 127.0.0.1, many times a minute; the general limit itself is
 *       verified by the backend suites (B7).
 */
export function seoBackendEnvironment({ storageRoot }) {
  return {
    ...baseEnvironment(),
    NODE_ENV: 'development',
    APP_ENV: 'local',
    // C6-T1: the permitted tester path for a local run (stackConfig.js).
    ...LOCAL_RECRUITMENT_ENVIRONMENT,
    PORT: String(SEO_BACKEND_PORT),
    LOG_LEVEL: 'info',
    TRUST_PROXY: 'false',
    MONGODB_URI: process.env.MONGODB_TEST_URI,
    CORS_ALLOWED_ORIGINS: `${SEO_INDEXED_ORIGIN},${SEO_REVIEW_ORIGIN}`,
    RATE_LIMIT_MAX: '1000',
    RESUME_STORAGE_DRIVER: 'local',
    RESUME_STORAGE_LOCAL_ROOT: storageRoot,
    APPLICATION_ACKNOWLEDGEMENT_ENABLED: 'false',
  };
}
