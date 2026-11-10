import { readFileSync } from 'node:fs';
import path from 'node:path';
import { baseEnvironment } from './processes.js';

/**
 * Fixed settings of the C5 integrated-site quality run (playwright.c5.config.js;
 * Doc 18 sections 168-172, Doc 16 sections 153-282, Doc 17 sections 236-290).
 * Its own ports, so it never meets the C3 or C4 stacks.
 *
 *   SITE  the C4 document server (frontend/server/serve.mjs) serving ONE
 *         production build of the commit under test, built as production is
 *         built (VITE_ALLOW_INDEXING=true, VITE_PUBLIC_SITE_URL=the approved
 *         canonical origin, OD-2026-11-09-01). It serves files as they are,
 *         without compression: compression is the host's job (C6).
 *   LAB   a LAB-ONLY compression proxy in front of SITE
 *         (support/c5LabCompression.mjs). It exists only so throttled lab
 *         measurements are not charged for bytes a production host would
 *         compress; it is not the host and proves nothing about it.
 *
 * Everything listens on 127.0.0.1. Nothing is deployed, nothing is sent.
 */
export const C5_BACKEND_PORT = Number(process.env.E2E_C5_BACKEND_PORT ?? 4120);
export const C5_SITE_PORT = Number(process.env.E2E_C5_SITE_PORT ?? 4203);
export const C5_LAB_PORT = Number(process.env.E2E_C5_LAB_PORT ?? 4204);
export const C5_BACKEND_ORIGIN = `http://127.0.0.1:${C5_BACKEND_PORT}`;
export const C5_SITE_ORIGIN = `http://127.0.0.1:${C5_SITE_PORT}`;
export const C5_LAB_ORIGIN = `http://127.0.0.1:${C5_LAB_PORT}`;
export const C5_SITE_URL = 'https://cybervalida.com';

/** The synthetic C5 Jobs (fixtures/c5-jobs), in provisioning order: [file, needs --confirm-lifecycle]. */
export const C5_JOB_STEPS = Object.freeze([
  ['qa-c5-open-long.json', true],
  ['qa-c5-open-hybrid.json', true],
  ['qa-c5-closed.json', true],
  ['qa-c5-closed.closed.json', true],
]);
export const C5_SLUGS = Object.freeze({ open: 'qa-c5-open-long', hybrid: 'qa-c5-open-hybrid', closed: 'qa-c5-closed' });

/** The run's facts (no secrets), written by the setup. */
export function readC5Run() {
  return JSON.parse(readFileSync(path.join(process.env.E2E_RUN_DIR, 'run.json'), 'utf8'));
}

/**
 * The backend's environment for the run and its CLIs.
 *
 *   NODE_ENV=development, APP_ENV=local       a local run;
 *   TRANSACTIONAL_EMAIL_PROVIDER unset         no mail transport at all ("none"):
 *       an accepted Application keeps its notification PENDING; nothing is sent,
 *       not even to a local test server;
 *   APPLICATION_ACKNOWLEDGEMENT_ENABLED=false  acknowledgements stay off;
 *   RATE_LIMIT_MAX=1000, APPLICATION_RATE_LIMIT_MAX=100
 *       the document server, the browser and the lab measurements read the
 *       API from 127.0.0.1 many times a minute, and the run submits more than
 *       ten synthetic Applications. The limits themselves are verified by the
 *       backend suites (B5, B7); C5 does not change them.
 */
export function c5BackendEnvironment({ storageRoot }) {
  return {
    ...baseEnvironment(),
    NODE_ENV: 'development',
    APP_ENV: 'local',
    PORT: String(C5_BACKEND_PORT),
    LOG_LEVEL: 'info',
    TRUST_PROXY: 'false',
    MONGODB_URI: process.env.MONGODB_TEST_URI,
    CORS_ALLOWED_ORIGINS: `${C5_SITE_ORIGIN},${C5_LAB_ORIGIN}`,
    RATE_LIMIT_MAX: '1000',
    APPLICATION_RATE_LIMIT_MAX: '100',
    RESUME_STORAGE_DRIVER: 'local',
    RESUME_STORAGE_LOCAL_ROOT: storageRoot,
    APPLICATION_ACKNOWLEDGEMENT_ENABLED: 'false',
  };
}
