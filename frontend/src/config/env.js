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

/** Public site origin, used by A4 metadata. Not fabricated. */
export const PUBLIC_SITE_URL = (import.meta.env.VITE_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '');

/**
 * Controlled development fixtures (A5 QA only).
 *
 * TWO independent conditions must both hold:
 *   1. import.meta.env.DEV — true only in a dev server, never in a build;
 *   2. VITE_ENABLE_A5_FIXTURES === 'true' — explicit, opt-in, default off.
 *
 * Vite statically replaces import.meta.env.DEV with `false` in a production
 * build, so this function folds to `false` and the fixture modules are never
 * reachable from the production graph.
 *
 * Critically, nothing about a failing request can flip this. A fixture can
 * never appear because an API call failed — that is the difference between QA
 * tooling and fake recruitment data.
 */
export function areDevFixturesEnabled() {
  return import.meta.env.DEV === true && import.meta.env.VITE_ENABLE_A5_FIXTURES === 'true';
}
