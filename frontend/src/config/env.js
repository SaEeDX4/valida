import { resolveSeoConfig } from '../seo/siteConfig.js';

/**
 * Browser-safe frontend configuration.
 *
 * Doc 08 sections 122-125: everything prefixed VITE_ is compiled into the
 * bundle and is PUBLIC. No API secret, database URI, storage credential or
 * email secret may ever be read here.
 */

/**
 * ORIGIN of the Valida REST API — scheme, host and port only.
 *
 * The canonical /api/v1 prefix belongs to the request paths in the feature API
 * modules, never to this value. Configuring an origin that already contains
 * /api/v1 would produce /api/v1/api/v1/jobs, so any such suffix is stripped
 * defensively here as well as documented in .env.example.
 *
 * Trailing slashes are removed so path joining is unambiguous. There is no
 * fabricated production hostname: when the variable is absent the value is an
 * empty string and requests resolve relative to the current origin, which is
 * correct for a same-origin deployment and honest everywhere else.
 */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '')
  .replace(/\/+$/, '')
  // Defence in depth: a misconfigured origin must not duplicate the prefix.
  .replace(/\/api\/v\d+$/, '');

/**
 * Public site origin as configured (trailing slashes removed). Kept for
 * reference; the SEO code reads it through getSeoConfig() below, which also
 * validates it.
 */
export const PUBLIC_SITE_URL = (import.meta.env.VITE_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '');

/**
 * SEO configuration of this build (C4): the canonical origin and whether the
 * build may be indexed. See src/seo/siteConfig.js.
 *
 *   VITE_PUBLIC_SITE_URL  the ONE canonical https:// origin (Doc 14 section 23):
 *                         https://cybervalida.com (OD-2026-11-09-01). Without
 *                         exactly that value no canonical URL, og:url or
 *                         JobPosting is emitted — nothing is fabricated.
 *   VITE_ALLOW_INDEXING   'true' only for the production build. Unset or
 *                         'false' (the default) is a review build: every page is
 *                         "noindex, nofollow" (Doc 16 section 82, SEO-020).
 *
 * Read on each call, not captured at import: Vite replaces these expressions
 * with literals in a build, and tests can change them with vi.stubEnv.
 */
export function getSeoConfig() {
  return resolveSeoConfig({
    siteUrl: import.meta.env.VITE_PUBLIC_SITE_URL,
    allowIndexing: import.meta.env.VITE_ALLOW_INDEXING,
  });
}

/**
 * Controlled development fixtures (A5 QA only).
 *
 * THREE independent conditions must all hold:
 *   1. import.meta.env.DEV — true in a dev server;
 *   2. import.meta.env.MODE === 'development' — the dev server's mode;
 *   3. VITE_ENABLE_A5_FIXTURES === 'true' — explicit, opt-in, default off.
 *
 * Why MODE as well as DEV (C1): Vite derives DEV from NODE_ENV, not from the
 * command. `vite build` run with NODE_ENV=development in the environment
 * produces a development-mode bundle in which DEV is TRUE, so DEV alone let a
 * production build ship and run the fixtures. MODE comes from the command
 * (`vite build` is mode 'production' whatever NODE_ENV says), and Vite
 * statically replaces it, so in a production build this function folds to
 * `false` and the fixture modules are not reachable from the production graph.
 * Only an explicit `--mode development` build could opt in; that is not the
 * production build.
 *
 * Critically, nothing about a failing request can flip this. A fixture can
 * never appear because an API call failed — that is the difference between QA
 * tooling and fake recruitment data.
 */
export function areDevFixturesEnabled() {
  return (
    import.meta.env.DEV === true &&
    import.meta.env.MODE === 'development' &&
    import.meta.env.VITE_ENABLE_A5_FIXTURES === 'true'
  );
}
