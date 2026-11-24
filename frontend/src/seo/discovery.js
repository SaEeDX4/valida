import { isValidJobSlug } from '../features/jobs/api/jobContract.js';
import { ROUTES, jobRoute } from '../routes/paths.js';
import { absoluteUrl } from './siteConfig.js';

/**
 * /sitemap.xml and /robots.txt (C4) — Doc 16 sections 103-113, SEO-008…016.
 *
 * Both are built per request by the document server from live data, so
 * publishing, closing or archiving a Job changes the sitemap at once
 * (section 108, SEO-012) with no rebuild.
 */

/** Doc 16 section 105: the six indexable static routes. */
export const SITEMAP_STATIC_PATHS = Object.freeze([ROUTES.HOME, ROUTES.ABOUT, ROUTES.CAREERS, ROUTES.PRIVACY, ROUTES.LEGAL, ROUTES.CONTACT]);

const xmlEscape = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/**
 * The sitemap: the static routes plus the Job Detail URL of every OPEN Job.
 *
 * `openJobSlugs` comes from GET /api/v1/jobs, which lists OPEN Jobs only —
 * Draft, Archived and Closed are never in it (sections 106-107). Apply, 404,
 * API and review URLs are never added (section 106). No <lastmod>: the public
 * API exposes no content-modification time, and the build time or request time
 * would be the meaningless timestamp section 109 forbids (SEO-013).
 *
 * A slug outside the public slug shape is skipped rather than written; the
 * caller is told how many were.
 */
export function buildSitemapXml({ siteOrigin, openJobSlugs = [] }) {
  if (!siteOrigin) throw new Error('buildSitemapXml needs the canonical origin');
  const seen = new Set();
  const jobPaths = [];
  let skipped = 0;
  for (const slug of openJobSlugs) {
    if (!isValidJobSlug(slug)) {
      skipped += 1;
      continue;
    }
    if (seen.has(slug)) continue; // one vacancy, one URL (SEO-039)
    seen.add(slug);
    jobPaths.push(jobRoute(slug));
  }
  const urls = [...SITEMAP_STATIC_PATHS, ...jobPaths].map((path) => absoluteUrl(siteOrigin, path));
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((loc) => `  <url><loc>${xmlEscape(loc)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
  return { xml, urls, skipped };
}

/**
 * robots.txt.
 *
 * Indexed (production) build:
 *   - nothing public is disallowed: not Home, About, Careers, Job Detail, Apply
 *     (it must stay crawlable for its noindex to be seen), CSS, JavaScript or
 *     the brand images (section 113, SEO-015);
 *   - /admin/ and /employee/ are discouraged (section 112). They are not
 *     protected by this file — authentication is the control (sections 83,
 *     SEO-016);
 *   - /api/ is discouraged EXCEPT the public Jobs read API, which the browser
 *     calls to render Careers and Job Detail. Blocking it would leave a
 *     rendering crawler with an error state instead of the role (section 113).
 *     A crawler only follows links; nothing here invites a POST;
 *   - the Sitemap line points at the canonical sitemap (section 111).
 *
 * Non-indexed (review) build: no Sitemap line (review URLs are never listed,
 * section 106) and NO blanket "Disallow: /". Every response is
 * "noindex, nofollow" instead (meta and X-Robots-Tag): Google documents that a
 * noindex rule is only seen on a page it is allowed to crawl.
 */
export function buildRobotsTxt({ indexing, siteOrigin }) {
  if (!indexing || !siteOrigin) {
    return [
      '# Valida: non-indexed build (review / testing). Every response carries',
      '# "noindex, nofollow"; crawling is not blocked so that the directive is seen.',
      'User-agent: *',
      'Allow: /',
      '',
    ].join('\n');
  }
  return [
    'User-agent: *',
    'Allow: /api/v1/jobs',
    'Disallow: /api/',
    'Disallow: /admin/',
    'Disallow: /employee/',
    '',
    `Sitemap: ${absoluteUrl(siteOrigin, '/sitemap.xml')}`,
    '',
  ].join('\n');
}
