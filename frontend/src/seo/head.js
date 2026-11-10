import { buildJobPosting, escapeHtmlText } from './jobPosting.js';
import { SITE_NAME, absoluteUrl } from './siteConfig.js';
import { SOCIAL_CARD } from './socialCard.js';

/**
 * One description of a page's <head> metadata, shared by the browser
 * (components/seo/PageMeta.jsx) and the document server (frontend/server/), so
 * the initial HTML and the settled browser state are computed by the same code
 * from the same inputs (Doc 16 sections 97-99, SEO-007).
 *
 * Input (what a page states about itself; see routeHeads.js):
 *   title        Document 06 title.
 *   description  Document 06 description, when the route has one: the
 *                search description (<meta name="description">) and, unless
 *                socialDescription is given, og:description.
 *   socialDescription  the route's social-sharing description, when it differs
 *                from its search description: og:description only (Home,
 *                OD-2026-11-09-03). Never used without Open Graph.
 *   robots       the route's own directive ('noindex, follow' for Apply, 404,
 *                retained closed Jobs and error states); absent = indexable.
 *   path         the route's canonical PATH (no query, no trailing slash).
 *   jobPosting   the public Job DTO, on an open Job Detail page only.
 *
 * Output: { title, description, robots, canonical, openGraph, jsonLd }.
 *
 * Rules:
 *   - A non-indexed (review) build gives EVERY page "noindex, nofollow"
 *     (Doc 16 section 82, SEO-020) and no canonical, Open Graph or JobPosting.
 *   - Only an indexable page — no robots directive of its own — gets a
 *     canonical URL, Open Graph and structured data (Doc 16 sections 89, 94,
 *     124). A noindex page carrying a canonical would send mixed signals.
 *   - Without a configured canonical origin there is no canonical, no og:url —
 *     and so no Open Graph set — and no JobPosting: none of them can be built
 *     without an absolute URL.
 *   - Every page with Open Graph also carries the default social card
 *     (socialCard.js; OD-2026-11-09-02, revised by OD-2026-11-09-03):
 *     og:image as an absolute URL on the canonical origin, og:image:width,
 *     og:image:height and og:image:alt (Doc 16 sections 94-97).
 *   - og:description is the route's social-sharing description when it has
 *     one, otherwise its search description (OD-2026-11-09-03).
 */

export const ROBOTS = Object.freeze({
  NOINDEX_FOLLOW: 'noindex, follow',
  REVIEW: 'noindex, nofollow',
});

export function describeHead({ title, description, socialDescription, robots, path, jobPosting } = {}, config = {}) {
  const indexing = config.indexing === true;
  const siteOrigin = config.siteOrigin ?? null;
  const ownRobots = typeof robots === 'string' && robots.trim() ? robots.trim() : null;
  const effectiveRobots = indexing ? ownRobots : ROBOTS.REVIEW;
  const indexable = indexing && ownRobots === null;
  const cleanDescription = typeof description === 'string' && description.trim() ? description.trim() : null;
  const cleanSocialDescription =
    typeof socialDescription === 'string' && socialDescription.trim() ? socialDescription.trim() : null;
  const sharingDescription = cleanSocialDescription ?? cleanDescription;

  const canonical = indexable ? absoluteUrl(siteOrigin, path) : null;

  const openGraph = canonical
    ? [
        ['og:type', 'website'],
        ['og:site_name', SITE_NAME],
        ['og:title', title],
        ...(sharingDescription ? [['og:description', sharingDescription]] : []),
        ['og:url', canonical],
        ['og:image', absoluteUrl(siteOrigin, SOCIAL_CARD.path)],
        ['og:image:width', String(SOCIAL_CARD.width)],
        ['og:image:height', String(SOCIAL_CARD.height)],
        ['og:image:alt', SOCIAL_CARD.alt],
      ].filter(([, content]) => typeof content === 'string' && content.length > 0)
    : [];

  const jsonLd = canonical && jobPosting ? buildJobPosting(jobPosting, { siteOrigin }).jsonLd : null;

  return {
    title: typeof title === 'string' ? title : '',
    description: cleanDescription,
    robots: effectiveRobots,
    canonical,
    openGraph,
    jsonLd,
  };
}

/**
 * JSON for an inline <script type="application/ld+json">. JSON.stringify alone
 * is not safe inside HTML: "</script>" or "<!--" in a Job's text would end the
 * element. <, > and & are written as \u escapes (still the same JSON), and so
 * are U+2028/U+2029.
 */
export function serializeJsonLd(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Attribute selector values the browser uses to find the tags it owns (PageMeta). */
export const HEAD_SELECTORS = Object.freeze({
  description: 'meta[name="description"]',
  robots: 'meta[name="robots"]',
  canonical: 'link[rel="canonical"]',
  openGraph: 'meta[property^="og:"]',
  jsonLd: 'script[type="application/ld+json"][data-valida-structured-data]',
});

/**
 * The head tags (everything except <title>) as HTML, for the document server.
 * Same tags, attributes and order the browser reconciles.
 */
export function renderHeadTags(head) {
  const tags = [];
  if (head.description) tags.push(`<meta name="description" content="${escapeHtmlText(head.description)}">`);
  if (head.robots) tags.push(`<meta name="robots" content="${escapeHtmlText(head.robots)}">`);
  if (head.canonical) tags.push(`<link rel="canonical" href="${escapeHtmlText(head.canonical)}">`);
  for (const [property, content] of head.openGraph) {
    tags.push(`<meta property="${escapeHtmlText(property)}" content="${escapeHtmlText(content)}">`);
  }
  if (head.jsonLd) {
    tags.push(`<script type="application/ld+json" data-valida-structured-data="JobPosting">${serializeJsonLd(head.jsonLd)}</script>`);
  }
  return tags.join('\n    ');
}
