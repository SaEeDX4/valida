import { describeHead, renderHeadTags } from '../src/seo/head.js';
import { escapeHtmlText } from '../src/seo/jobPosting.js';
import {
  APPLY_PENDING_HEAD,
  JOB_ERROR_HEAD,
  NOT_FOUND_HEAD,
  STATIC_HEAD_BY_PATH,
  applyHead,
  jobDetailHead,
} from '../src/seo/routeHeads.js';
import { JOB_OUTCOME } from './jobsClient.js';

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
 *   /careers/:slug  OPEN           200     + JobPosting
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
 * Doc 04 sections 47-49: canonical paths are lowercase, with no trailing slash
 * and no empty segment. A request for another spelling is redirected (301) to
 * the canonical path, keeping its query. Returns null when no redirect is needed.
 */
export function canonicalRedirect(pathname) {
  let normalized = pathname.replace(/\/{2,}/g, '/');
  if (normalized.length > 1) normalized = normalized.replace(/\/+$/, '');
  normalized = normalized.toLowerCase();
  if (!normalized.startsWith('/')) normalized = `/${normalized}`;
  return normalized === pathname ? null : normalized;
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
export async function resolveRouteHead(route, { jobs }) {
  if (route.kind === 'static') return { status: 200, input: STATIC_HEAD_BY_PATH[route.path] };
  if (route.kind === 'notFound') return { status: 404, input: NOT_FOUND_HEAD };

  const slug = safeDecode(route.slug);
  const result = slug === null ? { outcome: JOB_OUTCOME.NOT_FOUND } : await jobs.getJob(slug);

  if (route.kind === 'job') {
    if (result.outcome === JOB_OUTCOME.OK) return { status: 200, input: jobDetailHead(result.job), job: result.job };
    if (result.outcome === JOB_OUTCOME.NOT_FOUND) return { status: 404, input: NOT_FOUND_HEAD };
    return { status: 503, input: JOB_ERROR_HEAD };
  }
  // Apply
  if (result.outcome === JOB_OUTCOME.OK) return { status: 200, input: applyHead(result.job), job: result.job };
  if (result.outcome === JOB_OUTCOME.NOT_FOUND) return { status: 404, input: APPLY_PENDING_HEAD };
  return { status: 503, input: APPLY_PENDING_HEAD };
}

/** The template with this head written into it. */
export function injectHead(template, head) {
  return template
    .replace(TITLE_PATTERN, `<title>${escapeHtmlText(head.title)}</title>`)
    .replace(HEAD_MARKER, renderHeadTags(head));
}

/**
 * Renders the document for a canonical path.
 * Returns { status, headers, body, head, route } — `head` and `route` for tests and evidence.
 */
export async function renderDocument(pathname, { template, config, jobs }) {
  const route = matchRoute(pathname);
  const resolved = await resolveRouteHead(route, { jobs });
  const head = describeHead(resolved.input, config);
  const headers = {
    'content-type': 'text/html; charset=utf-8',
    // Doc 16 section 209: documents are revalidated, so a release is never stuck behind an old shell.
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
  };
  // The same directive as the meta tag, for clients that read only headers.
  if (head.robots) headers['x-robots-tag'] = head.robots;
  if (resolved.status === 503) headers['retry-after'] = '60';
  return { status: resolved.status, headers, body: injectHead(template, head), head, route };
}
