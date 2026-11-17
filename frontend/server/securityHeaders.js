/**
 * C6-T5 — the document server's security headers and its enforced
 * Content-Security-Policy (C6 plan r3 step 2b; Doc 13 §§33–36, §§146–148;
 * Doc 17 QA-040), and the release header (step 2d; plan §8.4, D-6).
 *
 * THE POLICY, derived from what the production build actually loads
 * (inspected for C6-T5: the built index.html, the bundle and its CSS):
 *
 *   default-src 'none'        nothing is allowed unless named below
 *   script-src 'self'         the one module bundle, /assets/index-*.js. No
 *                             inline script runs: the only inline <script>
 *                             is the JobPosting JSON-LD data block
 *                             (type="application/ld+json"), which a browser
 *                             never executes and CSP does not apply to
 *   style-src 'self'          the one stylesheet, /assets/index-*.css. React
 *                             sets `style` props through the CSSOM, which
 *                             style-src does not restrict; no <style>
 *                             element and no style="" attribute is served
 *   img-src 'self'            /brand/ icons (and the social card, which only
 *                             crawlers fetch)
 *   font-src 'self'           the self-hosted Inter and Space Grotesk files
 *   connect-src 'self' <API>  the bundle's own API origin (VITE_API_BASE_URL,
 *                             recorded in the build's valida-seo.json), for
 *                             its requests and for the Job preload hint
 *                             (<link rel="preload" as="fetch">)
 *   base-uri 'none'           no <base> element
 *   form-action 'none'        the Apply form is submitted by script (fetch),
 *                             never by navigation
 *   frame-ancestors 'none'    no site may frame a page (Doc 13 §33); also
 *                             X-Frame-Options: DENY for older browsers
 *   object-src 'none'         no plugins
 *
 * No 'unsafe-inline', no 'unsafe-eval', no wildcard, no scheme source
 * (Doc 13 §35). The policy is ENFORCED (Content-Security-Policy), not
 * report-only. `upgrade-insecure-requests` is not used: the API origin is
 * named exactly, so an http: request can only be one this build was
 * configured for (a local run); production builds name an https: origin.
 *
 * The other headers, on every response of the server:
 *   X-Content-Type-Options: nosniff
 *   Referrer-Policy: strict-origin-when-cross-origin — another origin (the
 *                    API included) sees at most this site's origin, never
 *                    a path (Doc 13 §147)
 *   Permissions-Policy: the browser capabilities the site does not use are
 *                    disabled (Doc 13 §148): only features every supported
 *                    browser recognises are listed, so none is reported as
 *                    unknown
 *   X-Frame-Options: DENY (legacy companion of frame-ancestors)
 *   X-Valida-Release: the commit, when configured (releaseIdentity.js)
 *
 * NOT here: Strict-Transport-Security. HSTS is activated by the owner at plan
 * step P9, on the production apex, with a short max-age first (Doc 13 §31).
 */
import { RELEASE_HEADER, stampRelease } from '../../backend/src/config/releaseIdentity.js';
import { resolveJobApiPreloadBase } from './renderDocument.js';

export { RELEASE_HEADER };

export const PERMISSIONS_POLICY = 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()';
export const REFERRER_POLICY = 'strict-origin-when-cross-origin';

/**
 * The Content-Security-Policy for a build whose bundle calls `browserApiBase`
 * ('' for a same-origin API, or a plain origin). Throws for anything else:
 * a policy that cannot name the API would block the site's own requests.
 */
export function buildContentSecurityPolicy(browserApiBase) {
  const base = resolveJobApiPreloadBase(browserApiBase);
  if (base === null) throw new Error('the build API base is neither empty nor a plain origin; the Content-Security-Policy cannot name it');
  const connect = base === '' ? "'self'" : `'self' ${base}`;
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    `connect-src ${connect}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
}

/** The fixed headers of every response, for one server instance. */
export function documentSecurityHeaders({ browserApiBase = '' } = {}) {
  return Object.freeze({
    'content-security-policy': buildContentSecurityPolicy(browserApiBase),
    'x-content-type-options': 'nosniff',
    'referrer-policy': REFERRER_POLICY,
    'permissions-policy': PERMISSIONS_POLICY,
    'x-frame-options': 'DENY',
  });
}

/**
 * Stamps the headers on a response before anything else is written. A
 * header set later by writeHead() with the same name replaces it; the
 * document server never does that for these names.
 */
export function applyDocumentSecurityHeaders(res, headers, release) {
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  stampRelease(res, release);
}
