/**
 * C6-T3 — site access for the document server.
 *
 * The rule is the API's own (backend/src/config/siteAccess.js), imported, not
 * copied: the configuration table, the allowlist and its parser, the address
 * rule (TRUST_PROXY) and the admission decision are the same in both
 * services. See that module for the table. The same deployment note as
 * visitorAddress.js applies (G-ACCESS, H9).
 *
 * Specific to the document server:
 *   - the liveness path is /healthz: GET or HEAD of exactly that target
 *     answers 200 with an empty body, in every site-access mode;
 *   - a denied request is answered 403, plain text "Forbidden" (an empty body
 *     for HEAD);
 *   - it never reads delegation headers: admission is its own visitor's;
 *   - APP_ENV=review also requires a build with indexing disabled, so a
 *     Review document can never be indexable.
 */
import {
  CONDITIONAL_REQUEST_HEADERS,
  PRIVATE_CACHE_CONTROL,
  SITE_ACCESS_PROBLEMS,
  SITE_ACCESS_PROBLEM_TEXT,
  SITE_ACCESS_PROBLEM_VARIABLE,
  SITE_ADMISSION,
  decideSiteAdmission,
  describeSiteAccess,
  enforcePrivateResponseHeaders,
  isPrivateSite,
  PUBLIC_SITE_ACCESS,
  resolveSiteAccess,
} from '../../backend/src/config/siteAccess.js';

export {
  CONDITIONAL_REQUEST_HEADERS,
  PRIVATE_CACHE_CONTROL,
  SITE_ACCESS_PROBLEMS,
  SITE_ADMISSION,
  decideSiteAdmission,
  describeSiteAccess,
  enforcePrivateResponseHeaders,
  isPrivateSite,
  PUBLIC_SITE_ACCESS,
};

export const DOCUMENT_LIVENESS_PATH = '/healthz';

/** A document-server-only problem: an indexable build in Review. */
export const REVIEW_REQUIRES_NOINDEX_BUILD = 'REVIEW_REQUIRES_NOINDEX_BUILD';

const PROBLEM_TEXT = Object.freeze({
  ...SITE_ACCESS_PROBLEM_TEXT,
  [REVIEW_REQUIRES_NOINDEX_BUILD]: 'APP_ENV=review requires a build with indexing disabled (VITE_ALLOW_INDEXING unset or false)',
});
const PROBLEM_VARIABLE = Object.freeze({ ...SITE_ACCESS_PROBLEM_VARIABLE, [REVIEW_REQUIRES_NOINDEX_BUILD]: 'APP_ENV' });

/**
 * The document server's start-up decision, from its environment and the
 * build's indexing flag. A refusal names the variable and a fixed rule —
 * never a value.
 *
 * @returns {{ ok: true, site: object, appEnv: string } | { ok: false, problem: string, variable: string, rule: string }}
 */
export function resolveDocumentSiteAccess({ appEnv, siteAccess, allowlist, indexing }) {
  const env = appEnv === undefined || appEnv === '' ? 'local' : appEnv;
  const site = resolveSiteAccess({ siteAccess, allowlist, appEnv: env });
  const refuse = (problem) => ({ ok: false, problem, variable: PROBLEM_VARIABLE[problem], rule: PROBLEM_TEXT[problem] });
  if (!site.ok) return refuse(site.problem);
  if (env === 'review' && indexing === true) return refuse(REVIEW_REQUIRES_NOINDEX_BUILD);
  return { ok: true, site, appEnv: env };
}
