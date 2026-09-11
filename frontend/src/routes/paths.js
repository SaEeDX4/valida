/**
 * Canonical route constants.
 *
 * Doc 08 section 17: avoid repeated literal path construction across
 * components. Every navigation target in the application resolves through this
 * module so a path can never drift between the router and a link.
 *
 * Doc 04 sections 47-49: canonical URLs are lowercase, hyphen-separated, and
 * carry no trailing slash.
 */
export const ROUTES = {
  HOME: '/',
  ABOUT: '/about',
  CAREERS: '/careers',
  JOB_DETAIL: '/careers/:jobSlug',
  APPLY: '/careers/:jobSlug/apply',
  PRIVACY: '/privacy',
  LEGAL: '/legal',
  NOT_FOUND: '*',
};

/**
 * Builds a Job Detail path from a slug.
 *
 * Doc 08 section 18: dynamic slug values must be URL-encoded. API data is not
 * assumed safe for direct path interpolation, so encoding happens here rather
 * than at each call site.
 */
export function jobRoute(slug) {
  return `/careers/${encodeURIComponent(String(slug ?? ''))}`;
}

/** Builds an Apply path from a slug, with the same encoding guarantee. */
export function applyRoute(slug) {
  return `${jobRoute(slug)}/apply`;
}
