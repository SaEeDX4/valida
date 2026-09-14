import { setServiceOverride, SERVICE } from '../services/serviceRegistry.js';
import { ApiError, API_ERROR_TYPE } from '../services/api/apiClient.js';
import { DEV_JOBS } from './fixtures/devJobFixtures.js';

/**
 * ============================================================================
 * CONTROLLED DEVELOPMENT FIXTURE INSTALLER — NEVER RUNS IN PRODUCTION
 * ============================================================================
 *
 * Installs synthetic Jobs and Applications services so every A5 UI state can be
 * reviewed in a browser before Release B exists.
 *
 * This module is imported ONLY from a dynamic import inside a
 * `import.meta.env.DEV && ...` branch in main.jsx. Vite replaces that constant
 * with `false` when building, the branch becomes dead code, and neither this
 * file nor the fixture data reaches the production bundle.
 *
 * It cannot be reached by a failing request. There is no code path anywhere
 * that installs an override in response to an error — the only caller is the
 * explicit, opt-in bootstrap.
 *
 * SCENARIO SELECTION
 * The scenario is read from the `?a5=` query parameter, which is convenient
 * for QA but is NOT the security control: the DEV + env-flag gate is. A query
 * string alone can never activate fixtures.
 */

const never = () => new Promise(() => {});

const apiError = ({ status, code }) =>
  new ApiError({
    type: API_ERROR_TYPE.HTTP,
    status,
    code,
    message: 'Development fixture error.',
  });

function readScenario() {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('a5') ?? '';
}

export default function installDevFixtures() {
  // Loud, unmissable signal that the surface is showing synthetic data.
  // eslint-disable-next-line no-console
  console.warn(
    '[Valida] A5 DEVELOPMENT FIXTURES ACTIVE — all Job and Application data on ' +
      'screen is synthetic. This is QA tooling and never runs in production.',
  );

  setServiceOverride(SERVICE.JOBS, {
    async getPublishedJobs() {
      const scenario = readScenario();
      if (scenario === 'jobs-loading') return never();
      if (scenario === 'jobs-error') throw apiError({ status: 503, code: 'SERVICE_UNAVAILABLE' });
      if (scenario === 'jobs-empty') return { items: [], pagination: null, requestId: 'dev' };
      if (scenario === 'jobs-one') {
        return { items: [DEV_JOBS.openJob], pagination: null, requestId: 'dev' };
      }
      return {
        items: [DEV_JOBS.openJob, DEV_JOBS.secondJob, DEV_JOBS.longTitleJob],
        pagination: null,
        requestId: 'dev',
      };
    },

    async getPublishedJobBySlug(slug) {
      const scenario = readScenario();
      if (scenario === 'job-loading') return never();
      if (scenario === 'job-error') throw apiError({ status: 503, code: 'SERVICE_UNAVAILABLE' });
      if (scenario === 'job-notfound') throw apiError({ status: 404, code: 'JOB_NOT_FOUND' });
      if (scenario === 'job-closed' || slug === DEV_JOBS.closedJob.slug) {
        return { job: DEV_JOBS.closedJob, requestId: 'dev' };
      }
      if (slug === DEV_JOBS.secondJob.slug) return { job: DEV_JOBS.secondJob, requestId: 'dev' };
      if (slug === DEV_JOBS.longTitleJob.slug) {
        return { job: DEV_JOBS.longTitleJob, requestId: 'dev' };
      }
      if (slug === DEV_JOBS.openJob.slug) return { job: DEV_JOBS.openJob, requestId: 'dev' };
      throw apiError({ status: 404, code: 'JOB_NOT_FOUND' });
    },
  });

  setServiceOverride(SERVICE.APPLICATIONS, {
    async submitApplication() {
      const scenario = readScenario();
      // A deliberate delay so the submitting state is observable.
      await new Promise((resolve) => setTimeout(resolve, 700));

      if (scenario === 'apply-submitting') return never();
      if (scenario === 'apply-network') {
        throw new ApiError({ type: API_ERROR_TYPE.NETWORK, message: 'Development fixture network failure.' });
      }
      if (scenario === 'apply-closed') {
        throw apiError({ status: 409, code: 'JOB_NOT_ACCEPTING_APPLICATIONS' });
      }
      if (scenario === 'apply-ratelimit') throw apiError({ status: 429, code: 'RATE_LIMITED' });
      if (scenario === 'apply-serverfields') {
        throw new ApiError({
          type: API_ERROR_TYPE.HTTP,
          status: 422,
          code: 'VALIDATION_FAILED',
          message: 'Some information needs to be corrected.',
          fieldErrors: [
            { field: 'email', code: 'INVALID_EMAIL', message: 'Enter a valid email address.' },
            { field: 'fullName', code: 'INVALID_NAME', message: 'Enter your full name.' },
          ],
        });
      }
      /*
       * Success is simulated ONLY under the explicit success scenario, and only
       * in this dev-only module. Production success requires a real API result.
       *
       * The shape mirrors the canonical successful Application response
       * (Doc 09 sections 124-126) so browser QA exercises the same payload the
       * backend will send: status RECEIVED, the job it belongs to, and a
       * submittedAt timestamp. Previously this returned { id: 'dev-fixture' },
       * which the real applicationsApi guard would have rejected — so QA was
       * reviewing a success screen the production contract would never produce.
       *
       * No public Application ID is included: the contract deliberately does
       * not expose one. The timestamp is deterministic so QA screenshots are
       * reproducible.
       */
      if (scenario === 'apply-success') {
        return {
          data: {
            status: 'RECEIVED',
            job: { title: DEV_JOBS.openJob.title, slug: DEV_JOBS.openJob.slug },
            submittedAt: '2026-09-12T12:00:00.000Z',
          },
          requestId: 'dev-fixture-request',
        };
      }
      throw new ApiError({
        type: API_ERROR_TYPE.NETWORK,
        message: 'No fixture scenario selected for submission.',
      });
    },
  });
}
