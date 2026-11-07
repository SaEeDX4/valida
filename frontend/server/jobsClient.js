import { isUsableJobDetail, isUsableJobListItem, isValidJobSlug } from '../src/features/jobs/api/jobContract.js';

/**
 * Server-side reads of the PUBLIC Jobs API for the document server (C4).
 *
 * The document server decides a Job page's HTTP status and its metadata from
 * the same public endpoints, and the same contract checks
 * (src/features/jobs/api/jobContract.js), that the browser uses
 * (src/features/jobs/api/jobsApi.js). It has no other data source: no database
 * access, no private fields, no admin route. What it can know about a Job is
 * exactly what any visitor's browser can.
 *
 * Outcomes, mirroring the Job Detail page's states (C2):
 *   OK           a usable public Job (OPEN or CLOSED) — page 200;
 *   NOT_FOUND    HTTP 404 / JOB_NOT_FOUND: unknown, Draft or Archived, which the
 *                API never distinguishes (Doc 09 sections 46, 61) — page 404;
 *   UNAVAILABLE  anything else: network failure, timeout, 5xx, rate limit,
 *                malformed or unreadable data — page 503, NEVER 404, so an
 *                outage is not reported as a removed role (Doc 16 section 259).
 */

export const JOB_OUTCOME = Object.freeze({ OK: 'OK', NOT_FOUND: 'NOT_FOUND', UNAVAILABLE: 'UNAVAILABLE' });

/** Page size for the sitemap's walk through GET /api/v1/jobs (the API's maximum, Doc 09). */
export const LIST_PAGE_LIMIT = 50;
/** Upper bound on pages walked for one sitemap: 100 x 50 = 5000 open roles. */
export const MAX_LIST_PAGES = 100;

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

export function normalizeApiOrigin(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  const path = url.pathname.replace(/\/+$/, '').replace(/\/api\/v\d+$/, '');
  if (path) return null;
  return url.origin;
}

export function createJobsClient({ apiOrigin, fetchImpl = globalThis.fetch, timeoutMs = 5_000 } = {}) {
  const origin = normalizeApiOrigin(apiOrigin);
  if (!origin) throw new Error('createJobsClient needs the API origin (scheme, host and port only)');

  async function readJson(pathname) {
    let response;
    try {
      response = await fetchImpl(`${origin}${pathname}`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { status: 0, body: null };
    }
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }

  return {
    origin,

    /** GET /api/v1/jobs/:jobSlug */
    async getJob(slug) {
      if (!isValidJobSlug(slug)) return { outcome: JOB_OUTCOME.NOT_FOUND };
      const { status, body } = await readJson(`/api/v1/jobs/${encodeURIComponent(slug)}`);
      if (status === 404 || body?.error?.code === 'JOB_NOT_FOUND') return { outcome: JOB_OUTCOME.NOT_FOUND };
      if (status !== 200 || body?.success !== true || !isUsableJobDetail(body.data)) {
        return { outcome: JOB_OUTCOME.UNAVAILABLE, status };
      }
      return { outcome: JOB_OUTCOME.OK, job: body.data };
    },

    /**
     * Every OPEN Job's slug, walking GET /api/v1/jobs page by page. Any failed
     * or unreadable page makes the whole result UNAVAILABLE: a sitemap that
     * silently missed roles would be worse than none.
     */
    async listOpenJobSlugs() {
      const slugs = [];
      for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
        const { status, body } = await readJson(`/api/v1/jobs?page=${page}&limit=${LIST_PAGE_LIMIT}`);
        const items = body?.data?.items;
        const pagination = body?.data?.pagination;
        if (status !== 200 || body?.success !== true || !Array.isArray(items) || !isPlainObject(pagination)) {
          return { outcome: JOB_OUTCOME.UNAVAILABLE, status };
        }
        if (!items.every(isUsableJobListItem)) return { outcome: JOB_OUTCOME.UNAVAILABLE, status };
        slugs.push(...items.map((item) => item.slug));
        const totalPages = Number.isInteger(pagination.totalPages) ? pagination.totalPages : 0;
        if (page >= totalPages || items.length === 0) return { outcome: JOB_OUTCOME.OK, slugs };
      }
      return { outcome: JOB_OUTCOME.UNAVAILABLE, status: 200 };
    },
  };
}
