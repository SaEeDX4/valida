/**
 * Site identity and indexing configuration for SEO output (C4).
 *
 * Pure JavaScript with no Vite-specific syntax: the browser (through
 * config/env.js), the build (vite.config.js) and the document server
 * (frontend/server/) all call the same functions, so they cannot disagree
 * about the canonical origin or about whether a build may be indexed.
 *
 * Governing rules:
 *   Doc 16 sections 89-93 — one absolute HTTPS self-canonical per indexable
 *     page, on the selected production host, never on a query variant.
 *   Doc 14 section 23 — exactly one public hostname is canonical (apex OR www);
 *     the other redirects. WHICH one is an owner decision; this module only
 *     accepts a single origin and never derives a second one.
 *   Doc 16 section 82, SEO-020 — a review/testing environment is
 *     "noindex, nofollow". Indexing is therefore OFF unless a build says,
 *     explicitly, that it is the production build: VITE_ALLOW_INDEXING=true.
 */

export const SITE_NAME = 'Valida';

/** Allowed spellings of the indexing switch. Anything else is a configuration error. */
export const INDEXING_VALUES = Object.freeze(['true', 'false']);

/**
 * Normalises a configured public site URL to a canonical ORIGIN.
 *
 * Accepted: https://<host> with nothing after it (a single trailing slash is
 * tolerated). The host is lowercased by the URL parser. Refused, with a reason:
 * an empty value, another scheme, credentials, a port, a path, a query or a
 * fragment — a canonical built from any of those would point search engines at
 * a URL that is not the site's public root.
 */
export function normalizeSiteUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return { ok: false, reason: 'SITE_URL_MISSING' };

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'SITE_URL_INVALID' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'SITE_URL_NOT_HTTPS' };
  if (url.username || url.password) return { ok: false, reason: 'SITE_URL_HAS_CREDENTIALS' };
  if (url.port) return { ok: false, reason: 'SITE_URL_HAS_PORT' };
  if (url.pathname !== '/' || url.search || url.hash || /[?#]/.test(raw)) {
    return { ok: false, reason: 'SITE_URL_HAS_PATH' };
  }
  if (!url.hostname || !url.hostname.includes('.')) return { ok: false, reason: 'SITE_URL_INVALID' };
  return { ok: true, origin: url.origin };
}

/**
 * The SEO configuration actually in force.
 *
 *   indexing    true only for VITE_ALLOW_INDEXING === 'true' (or boolean true).
 *               Missing, empty, 'false' — and anything else — mean a
 *               non-indexed (review) build. The build refuses "anything else"
 *               outright (vite.config.js), so a typo cannot ship.
 *   siteOrigin  the canonical origin, or null when none is configured or the
 *               value is not acceptable. Canonical URLs, og:url and JobPosting
 *               need it; without it they are simply not emitted.
 */
export function resolveSeoConfig({ siteUrl, allowIndexing } = {}) {
  const site = normalizeSiteUrl(siteUrl);
  return Object.freeze({
    indexing: allowIndexing === true || allowIndexing === 'true',
    siteOrigin: site.ok ? site.origin : null,
    siteProblem: site.ok ? null : site.reason,
  });
}

/**
 * Build-time check (vite.config.js). Returns the problems that must stop a
 * build; an empty list means the configuration is coherent.
 *
 * A production (indexable) build without a valid canonical origin would ship
 * indexable pages with no canonical URL (SEO-004) — so it is refused rather
 * than built.
 */
export function seoBuildProblems({ siteUrl, allowIndexing } = {}) {
  const problems = [];
  const flag = typeof allowIndexing === 'string' ? allowIndexing.trim() : allowIndexing;
  if (flag !== undefined && flag !== '' && !INDEXING_VALUES.includes(flag)) {
    problems.push('VITE_ALLOW_INDEXING must be "true" or "false" (or unset, which means "false").');
  }
  if (flag === 'true') {
    const site = normalizeSiteUrl(siteUrl);
    if (!site.ok) {
      problems.push(
        `VITE_ALLOW_INDEXING=true needs VITE_PUBLIC_SITE_URL to be the canonical https:// origin with no path (${site.reason}).`,
      );
    }
  }
  return problems;
}

/** Absolute URL of a route path on the canonical origin. The root keeps its slash; nothing else ends in one. */
export function absoluteUrl(siteOrigin, path) {
  if (!siteOrigin || typeof path !== 'string' || !path.startsWith('/')) return null;
  return `${siteOrigin}${path}`;
}
