import { describeHead, renderHeadTags } from '../src/seo/head.js';
import { isValidJobSlug } from '../src/features/jobs/api/jobContract.js';
import { escapeHtmlText } from '../src/seo/jobPosting.js';
import {
  APPLY_PENDING_HEAD,
  JOB_ERROR_HEAD,
  NOT_FOUND_HEAD,
  STATIC_HEAD_BY_PATH,
  applyHead,
  jobDetailHead,
} from '../src/seo/routeHeads.js';
import { JOB_OUTCOME, normalizeApiOrigin } from './jobsClient.js';

/**
 * The initial HTML of a public route, with its real HTTP status (C4).
 *
 * Doc 16 sections 97-102 (crawler-visible metadata without leaving React/Vite:
 * "controlled server/edge HTML transformation" is one of the listed
 * mechanisms), 114-123 (statuses), 140-141 (closed / archived).
 *
 * The built index.html is the template. Its <title> and its <!--valida:head-->
 * marker are replaced by the head that describeHead() gives for the route —
 * the same function, with the same route heads, that the browser's PageMeta
 * uses — so the metadata in the initial HTML is the metadata the page settles
 * on. The <body> is unchanged: React renders the content, as before.
 *
 *   route                          status  head
 *   / /about /careers /privacy     200     Document 06 title + description,
 *     /legal                               canonical, Open Graph
 *   /careers/:slug  OPEN           200     + JobPosting when its inputs exist
 *                                           (withheld today: src/seo/jobPosting.js)
 *   /careers/:slug  CLOSED         200     "noindex, follow", no JobPosting
 *   /careers/:slug  unknown /      404     "Page Not Found | Valida",
 *     Draft / Archived / bad slug           "noindex, follow"
 *   /careers/:slug  API failure    503     "Careers at Valida", "noindex, follow"
 *   .../apply  OPEN or CLOSED      200     "Apply for … | Valida", "noindex, follow"
 *   .../apply  unknown             404     "Apply | Valida", "noindex, follow"
 *   .../apply  API failure         503     the same
 *   anything else                  404     "Page Not Found | Valida", "noindex, follow"
 *
 * A non-indexed (review) build: the same statuses, every page
 * "noindex, nofollow", no canonical / Open Graph / JobPosting (describeHead).
 *
 * Job Detail and Apply documents whose Job read the API has just answered
 * (200 or 404) also carry one resource hint, jobApiPreloadTag() below (C5).
 */

export const TITLE_PATTERN = /<title>[^<]*<\/title>/;
export const HEAD_MARKER = '<!--valida:head-->';

/** The template must have exactly one <title> and one marker; anything else is refused at start-up. */
export function checkTemplate(template) {
  const titles = template.match(new RegExp(TITLE_PATTERN.source, 'g')) ?? [];
  const markers = template.split(HEAD_MARKER).length - 1;
  const problems = [];
  if (titles.length !== 1) problems.push(`expected exactly one <title> in index.html, found ${titles.length}`);
  if (markers !== 1) problems.push(`expected exactly one ${HEAD_MARKER} marker in index.html, found ${markers}`);
  return problems;
}

/**
 * Characters a request path may contain for it to be redirected: RFC 3986
 * path characters (unreserved, sub-delims, ":", "@", "/" and "%" escapes).
 * Anything else — a backslash above all — is never echoed into a Location.
 */
const REDIRECTABLE_PATH = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/;
const REDIRECT_CHECK_ORIGIN = 'http://redirect-check.invalid';

/**
 * Doc 04 sections 47-49: canonical paths are lowercase, with no trailing slash
 * and no empty segment. A request for another spelling is redirected (301) to
 * the canonical path, keeping its query.
 *
 * Returns the Location to send, or null when there is nothing to redirect —
 * the request then gets its ordinary response (usually the 404 page).
 *
 * The Location is always a path on THIS origin. Browsers resolve a Location
 * with the WHATWG URL rules, under which "\" counts as "/" for http(s): a raw
 * target such as "/\outside.example/A" would otherwise become the
 * scheme-relative "//outside.example/a", i.e. another site (C4 review
 * finding). So:
 *   1. only a path made of RFC 3986 path characters is ever redirected;
 *   2. the result must start with exactly one "/";
 *   3. resolving it must give this origin and exactly this path — which also
 *      refuses dot segments the resolver would rewrite.
 * A target failing any check is not redirected.
 */
export function canonicalRedirect(pathname, search = '') {
  if (typeof pathname !== 'string' || !REDIRECTABLE_PATH.test(pathname)) return null;
  let normalized = pathname.replace(/\/{2,}/g, '/');
  if (normalized.length > 1) normalized = normalized.replace(/\/+$/, '');
  normalized = normalized.toLowerCase();
  if (normalized === pathname) return null;
  if (!normalized.startsWith('/') || normalized.startsWith('//')) return null;
  const location = `${normalized}${search}`;
  let resolved;
  try {
    resolved = new URL(location, REDIRECT_CHECK_ORIGIN);
  } catch {
    return null;
  }
  if (resolved.origin !== REDIRECT_CHECK_ORIGIN || resolved.pathname !== normalized) return null;
  return location;
}

/** Which public route a canonical path is. */
export function matchRoute(pathname) {
  if (Object.hasOwn(STATIC_HEAD_BY_PATH, pathname)) return { kind: 'static', path: pathname };
  const segments = pathname.split('/').slice(1);
  if (segments[0] === 'careers' && segments.length === 2 && segments[1]) return { kind: 'job', slug: segments[1] };
  if (segments[0] === 'careers' && segments.length === 3 && segments[1] && segments[2] === 'apply') {
    return { kind: 'apply', slug: segments[1] };
  }
  return { kind: 'notFound' };
}

function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * Status and head input for a route. `jobs` is the server-side Jobs client
 * (jobsClient.js); it is only called for the two Job routes.
 */
export async function resolveRouteHead(route, { jobs, visitor = null }) {
  if (route.kind === 'static') return { status: 200, input: STATIC_HEAD_BY_PATH[route.path] };
  if (route.kind === 'notFound') return { status: 404, input: NOT_FOUND_HEAD };

  const slug = safeDecode(route.slug);
  // C6-T2: the read is made for this visitor (jobsClient.js); the API decides what it may see.
  const result = slug === null ? { outcome: JOB_OUTCOME.NOT_FOUND, tester: false } : await jobs.getJob(slug, { visitor });
  const tester = result.tester === true;

  if (route.kind === 'job') {
    if (result.outcome === JOB_OUTCOME.OK) return { status: 200, input: jobDetailHead(result.job), job: result.job, tester };
    if (result.outcome === JOB_OUTCOME.NOT_FOUND) return { status: 404, input: NOT_FOUND_HEAD, tester };
    return { status: 503, input: JOB_ERROR_HEAD, tester: false };
  }
  // Apply
  if (result.outcome === JOB_OUTCOME.OK) return { status: 200, input: applyHead(result.job), job: result.job, tester };
  if (result.outcome === JOB_OUTCOME.NOT_FOUND) return { status: 404, input: APPLY_PENDING_HEAD, tester };
  return { status: 503, input: APPLY_PENDING_HEAD, tester: false };
}

/**
 * C6-T2 — the documents whose content depends on who asks, through the
 * recruitment mode and the tester allowlist: Careers (the entry to the
 * recruitment flow), Job Detail and Apply. In every mode and for every
 * answer — 200, 404 or 503 — they are `private, no-store`, so no cache, shared
 * or private, keeps one visitor's document for another. The document server
 * never sends ETag or Last-Modified and never answers 304, so no conditional
 * request can revalidate a copy either. Other documents keep `no-cache`.
 */
export const RECRUITMENT_DOCUMENT_CACHE_CONTROL = 'private, no-store';
export function isRecruitmentRoute(route) {
  return route.kind === 'job' || route.kind === 'apply' || (route.kind === 'static' && route.path === '/careers');
}

/**
 * The browser-facing API base for the preload hint, from the build's own
 * configuration (valida-seo.json `apiBaseUrl`, i.e. VITE_API_BASE_URL — the
 * value the bundle's requests use): '' for a same-origin API, an origin
 * (scheme, host, port) otherwise. Anything else — absent, or not a plain
 * origin — gives null and no hint is written. It is deliberately NOT the
 * server's own --api-origin, which may be an address only the server can reach.
 */
export function resolveJobApiPreloadBase(apiBaseUrl) {
  if (apiBaseUrl === '') return '';
  return normalizeApiOrigin(apiBaseUrl);
}

/**
 * C5 (LCP): the Job page's content waits for GET /api/v1/jobs/:jobSlug, which
 * the bundle requests only after it has been downloaded and run. This hint
 * lets the browser make that one request while the script is still loading:
 *
 *   <link rel="preload" as="fetch" crossorigin="anonymous" href="{API}/api/v1/jobs/{slug}">
 *
 * - Exactly the URL the page's own request uses (jobsApi.js: the same path
 *   and encodeURIComponent), in the request mode it uses (CORS, credentials
 *   "same-origin" — apiClient.js), so the browser can hand the preloaded
 *   response to that request instead of making a second one.
 * - Written ONLY on the two Job routes, for a slug that passes the public slug
 *   contract ([a-z0-9-], no encoding needed; it is HTML-escaped all the same),
 *   and only when the server's own read of that URL has just been ANSWERED by
 *   the public API: with the Job (page 200) or with "not found" (page 404).
 *   In both cases the page makes exactly this request and waits for exactly
 *   this answer before it can show its content, and a browser hands a
 *   preloaded 404 to the page's request just as it does a 200 (observed in
 *   Chromium, e2e C5-22). Every "not found" — unknown, Draft, Archived — gets
 *   the same hint, so the hint tells them apart no more than the API does.
 *   Never when the API is failing or its data is unreadable (503: no extra
 *   request to a struggling API), never for a slug outside the contract (the
 *   API is not asked), never for any other route or endpoint. It is a GET of
 *   public data; no submission and no private route is ever hinted.
 * - A hint, not a dependency: a browser that ignores it, or cannot match it,
 *   makes its request as before; the page's states are decided by that
 *   request's own outcome either way. The API answers `no-store`, so the
 *   preloaded response is used once and never served again later.
 * - `base` is resolveJobApiPreloadBase(); null (the default) disables it.
 */
export function jobApiPreloadTag({ route, resolved, base }) {
  if (base !== '' && (typeof base !== 'string' || normalizeApiOrigin(base) !== base)) return '';
  if (route.kind !== 'job' && route.kind !== 'apply') return '';
  if (!(resolved.status === 200 && resolved.job) && resolved.status !== 404) return '';
  const slug = safeDecode(route.slug);
  if (slug === null || !isValidJobSlug(slug)) return '';
  const href = `${base}/api/v1/jobs/${encodeURIComponent(slug)}`;
  return `<link rel="preload" as="fetch" crossorigin="anonymous" href="${escapeHtmlText(href)}">`;
}

/** The template with this head (and, when given, extra head HTML after it) written into it. */
export function injectHead(template, head, extra = '') {
  return template
    .replace(TITLE_PATTERN, `<title>${escapeHtmlText(head.title)}</title>`)
    .replace(HEAD_MARKER, `${renderHeadTags(head)}${extra}`);
}

/**
 * Renders the document for a canonical path.
 * Returns { status, headers, body, head, route, preload } — `head`, `route` and `preload` for tests and evidence.
 */
export async function renderDocument(pathname, { template, config, jobs, jobApiPreloadBase = null, visitor = null }) {
  const route = matchRoute(pathname);
  const resolved = await resolveRouteHead(route, { jobs, visitor });
  const head = describeHead(resolved.input, config);
  const headers = {
    'content-type': 'text/html; charset=utf-8',
    // Doc 16 section 209: documents are revalidated, so a release is never stuck behind an old shell.
    // C6-T2: the recruitment documents are never stored at all.
    'cache-control': isRecruitmentRoute(route) ? RECRUITMENT_DOCUMENT_CACHE_CONTROL : 'no-cache',
    'x-content-type-options': 'nosniff',
  };
  // C6-T2: the T1 diagnostic, carried through — only when the API answered
  // the delegated read with the tester view for THIS visitor.
  if (resolved.tester === true) headers['x-valida-audience'] = 'tester';
  // The same directive as the meta tag, for clients that read only headers.
  if (head.robots) headers['x-robots-tag'] = head.robots;
  if (resolved.status === 503) headers['retry-after'] = '60';
  const preload = jobApiPreloadTag({ route, resolved, base: jobApiPreloadBase });
  return { status: resolved.status, headers, body: injectHead(template, head, preload), head, route, preload };
}
