import { isUsableJobDetail, isUsableJobListItem, isValidJobSlug } from '../src/features/jobs/api/jobContract.js';
import { DELEGATION_HEADERS, UNLISTED_VISITOR, isUsableServiceKey } from './visitorAddress.js';

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
 * C6-T2 — ON WHOSE BEHALF. Every read names the visitor it is made for
 * (visitorAddress.js), with the server-only INTERNAL_SERVICE_KEY, so that the
 * API decides it as it would decide that visitor's own request — never as a
 * request from the document server's own, possibly listed, address:
 *
 *   X-Valida-Visitor-Address   the visitor's address, or `unlisted`
 *   X-Valida-Internal-Key      INTERNAL_SERVICE_KEY, when one is configured
 *
 * The visitor header is sent even without a key, so the API still treats the
 * read as a delegation, finds it unauthenticated and gives the unlisted view.
 * The sitemap's reads always ask for `unlisted`: the public view, whoever
 * asked for the sitemap.
 *
 * WHERE THE KEY GOES. Only to the configured API origin: the URL is that
 * origin plus a fixed path, and `redirect: 'error'` means a redirect — to any
 * origin — is never followed, so the key cannot be carried elsewhere. The key
 * is never logged, never put in a document, a preload hint or an error.
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

export function createJobsClient({ apiOrigin, serviceKey = null, fetchImpl = globalThis.fetch, timeoutMs = 5_000 } = {}) {
  const origin = normalizeApiOrigin(apiOrigin);
  if (!origin) throw new Error('createJobsClient needs the API origin (scheme, host and port only)');
  // An unusable key is not sent: the read then carries the visitor header
  // only, and the API answers it with the unlisted view.
  const key = isUsableServiceKey(serviceKey) ? serviceKey : null;

  async function readJson(pathname, visitor) {
    const headers = { accept: 'application/json', [DELEGATION_HEADERS.visitor]: typeof visitor === 'string' && visitor ? visitor : UNLISTED_VISITOR };
    if (key) headers[DELEGATION_HEADERS.key] = key;
    let response;
    try {
      response = await fetchImpl(`${origin}${pathname}`, {
        method: 'GET',
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { status: 0, body: null, tester: false };
    }
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body, tester: response.headers?.get?.('x-valida-audience') === 'tester' };
  }

  return {
    origin,
    /** Whether reads are authenticated (a usable key is configured). Never the key. */
    delegation: key ? 'enabled' : 'disabled',

    /**
     * GET /api/v1/jobs/:jobSlug, for `visitor` (an address, or null for the
     * unlisted view). `tester` is true when the API answered with the tester
     * view for this visitor (X-Valida-Audience: tester).
     */
    async getJob(slug, { visitor = null } = {}) {
      if (!isValidJobSlug(slug)) return { outcome: JOB_OUTCOME.NOT_FOUND, tester: false };
      const { status, body, tester } = await readJson(`/api/v1/jobs/${encodeURIComponent(slug)}`, visitor);
      if (status === 404 || body?.error?.code === 'JOB_NOT_FOUND') return { outcome: JOB_OUTCOME.NOT_FOUND, tester };
      if (status !== 200 || body?.success !== true || !isUsableJobDetail(body.data)) {
        return { outcome: JOB_OUTCOME.UNAVAILABLE, status, tester: false };
      }
      return { outcome: JOB_OUTCOME.OK, job: body.data, tester };
    },

    /**
     * Every OPEN Job's slug IN THE PUBLIC VIEW, walking GET /api/v1/jobs page
     * by page. Any failed or unreadable page makes the whole result
     * UNAVAILABLE: a sitemap that silently missed roles would be worse than
     * none. C6-T2: always read as `unlisted`, so a tester-only Job is never
     * listed, whoever asked for the sitemap.
     */
    async listOpenJobSlugs() {
      const slugs = [];
      for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
        const { status, body } = await readJson(`/api/v1/jobs?page=${page}&limit=${LIST_PAGE_LIMIT}`, null);
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
