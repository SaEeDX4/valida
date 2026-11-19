import {
  DELEGATION_OUTCOMES,
  establishClientAddress,
  isAddressListed,
  parseAccessAllowlist,
  readDelegatedVisitor,
} from './recruitmentAccess.js';

/**
 * C6-T3 — SITE ACCESS: whether a whole environment is private.
 * C6 plan revision 3, sections 4.6.2-4.6.5; the owner's C6-T3 authorisation.
 *
 * ONE module for BOTH services: the API (middleware/siteAccess.js) and the
 * frontend document server (frontend/server/siteAccess.js import it), so the
 * configuration rule and the admission rule cannot differ between them.
 *
 *   SITE_ACCESS=private   every route of the service answers 403 to a client
 *                         whose address is not in ACCESS_ALLOWLIST, before
 *                         any other work. Two exact exceptions: GET and HEAD
 *                         of the liveness path (API /api/v1/health, document
 *                         server /healthz). Every response carries
 *                         `Cache-Control: private, no-store` and no validator.
 *   SITE_ACCESS=public    the site is open; Jobs are governed by the
 *                         recruitment mode (C6-T1) as before.
 *
 * UNLIKE THE RECRUITMENT MODE, A WRONG VALUE STOPS THE SERVICE (plan 4.6.2):
 * a silent fallback here could expose Review or close the public site. The
 * service refuses to start, before it listens, with a fixed problem code:
 *
 *   APP_ENV       SITE_ACCESS absent   "public"            "private"
 *                 or empty
 *   local         public (default)     public              private (needs a valid list)
 *   review        REFUSED              REFUSED             private (needs a valid list)
 *   production    REFUSED              public              REFUSED
 *
 *   Production requires the explicit literal "public" (correction 1, plan
 *   4.6.2): the public site is never the result of a missing variable.
 *
 *   Any value other than exactly "private" or "public" (case, padding, a
 *   typo) is refused in every environment. "private" with an absent or
 *   invalid ACCESS_ALLOWLIST (the C6-T1 range policy) is refused.
 *
 * The allowlist is ACCESS_ALLOWLIST, the same list and the same parser as the
 * `testers` recruitment mode. It is held non-enumerably and never logged.
 */

export const SITE_ACCESS_MODES = Object.freeze(['private', 'public']);

/** Why a configuration is refused. Fixed strings: safe to print. */
export const SITE_ACCESS_PROBLEMS = Object.freeze({
  APP_ENV_INVALID: 'APP_ENV_INVALID',
  SITE_ACCESS_INVALID: 'SITE_ACCESS_INVALID',
  REVIEW_REQUIRES_PRIVATE: 'REVIEW_REQUIRES_PRIVATE',
  PRODUCTION_REQUIRES_PUBLIC: 'PRODUCTION_REQUIRES_PUBLIC',
  PRIVATE_ALLOWLIST_ABSENT: 'PRIVATE_ALLOWLIST_ABSENT',
  PRIVATE_ALLOWLIST_INVALID: 'PRIVATE_ALLOWLIST_INVALID',
});

/** What an operator reads for each problem — never the configured value. */
export const SITE_ACCESS_PROBLEM_TEXT = Object.freeze({
  APP_ENV_INVALID: 'APP_ENV must be one of: local, review, production',
  SITE_ACCESS_INVALID: 'SITE_ACCESS must be exactly "private" or "public"',
  REVIEW_REQUIRES_PRIVATE: 'APP_ENV=review requires SITE_ACCESS=private',
  PRODUCTION_REQUIRES_PUBLIC: 'APP_ENV=production requires SITE_ACCESS=public, written explicitly',
  PRIVATE_ALLOWLIST_ABSENT: 'SITE_ACCESS=private requires ACCESS_ALLOWLIST',
  PRIVATE_ALLOWLIST_INVALID: 'SITE_ACCESS=private requires a valid ACCESS_ALLOWLIST (C6-T1 range policy)',
});

/** The variable a problem is reported against. */
export const SITE_ACCESS_PROBLEM_VARIABLE = Object.freeze({
  APP_ENV_INVALID: 'APP_ENV',
  SITE_ACCESS_INVALID: 'SITE_ACCESS',
  REVIEW_REQUIRES_PRIVATE: 'SITE_ACCESS',
  PRODUCTION_REQUIRES_PUBLIC: 'SITE_ACCESS',
  PRIVATE_ALLOWLIST_ABSENT: 'ACCESS_ALLOWLIST',
  PRIVATE_ALLOWLIST_INVALID: 'ACCESS_ALLOWLIST',
});

const APP_ENVS = new Set(['local', 'review', 'production']);

function refused(problem) {
  return Object.freeze({ ok: false, problem });
}

/**
 * Resolves APP_ENV, SITE_ACCESS and ACCESS_ALLOWLIST. Pure and total.
 *
 * @returns {{ ok: true, mode: 'private'|'public', configured: 'default'|'explicit', allowlistEntries: number }
 *         | { ok: false, problem: string }}
 *   On success, the parsed ranges are a non-enumerable `allowlist` property.
 */
export function resolveSiteAccess({ siteAccess, allowlist, appEnv = 'local' } = {}) {
  try {
    if (!APP_ENVS.has(appEnv)) return refused(SITE_ACCESS_PROBLEMS.APP_ENV_INVALID);
    const absent = siteAccess === undefined || siteAccess === null || siteAccess === '';
    if (!absent && (typeof siteAccess !== 'string' || !SITE_ACCESS_MODES.includes(siteAccess))) {
      return refused(SITE_ACCESS_PROBLEMS.SITE_ACCESS_INVALID);
    }
    // Only a local run has a default (public). Review requires "private" and
    // production requires "public", each written explicitly.
    if (appEnv === 'review' && siteAccess !== 'private') return refused(SITE_ACCESS_PROBLEMS.REVIEW_REQUIRES_PRIVATE);
    if (appEnv === 'production' && siteAccess !== 'public') return refused(SITE_ACCESS_PROBLEMS.PRODUCTION_REQUIRES_PUBLIC);
    const mode = absent ? 'public' : siteAccess;

    let ranges = null;
    let allowlistEntries = 0;
    if (mode === 'private') {
      const parsed = parseAccessAllowlist(allowlist);
      if (!parsed.ok) {
        return refused(parsed.problem === 'ABSENT' ? SITE_ACCESS_PROBLEMS.PRIVATE_ALLOWLIST_ABSENT : SITE_ACCESS_PROBLEMS.PRIVATE_ALLOWLIST_INVALID);
      }
      ranges = parsed.ranges;
      allowlistEntries = parsed.size;
    }
    const result = { ok: true, mode, configured: absent ? 'default' : 'explicit', allowlistEntries };
    // Non-enumerable: absent from spreads, JSON, util.inspect and log lines.
    Object.defineProperty(result, 'allowlist', { value: ranges, enumerable: false });
    return Object.freeze(result);
  } catch {
    return refused(SITE_ACCESS_PROBLEMS.SITE_ACCESS_INVALID);
  }
}

/** The public site, as an unconfigured local run has it. */
export const PUBLIC_SITE_ACCESS = resolveSiteAccess({});

/** The start-up description. No address, no configured value. */
export function describeSiteAccess(site) {
  return {
    siteAccess: site?.mode ?? 'public',
    siteAccessConfiguration: site?.configured ?? 'default',
    siteAccessAllowlistEntries: site?.allowlistEntries ?? 0,
  };
}

export const isPrivateSite = (site) => site?.ok === true && site.mode === 'private';

/** The response header every private-site response carries. */
export const PRIVATE_CACHE_CONTROL = 'private, no-store';

/** Conditional request headers: dropped on a private site, so nothing is answered 304. */
export const CONDITIONAL_REQUEST_HEADERS = Object.freeze(['if-none-match', 'if-modified-since', 'if-match', 'if-unmodified-since', 'if-range']);

/**
 * The liveness exception: GET or HEAD of EXACTLY `path` — no query string,
 * no trailing slash, no other spelling. `rawUrl` is the request target as
 * received (req.url before any routing).
 */
export function isLivenessRequest({ method, rawUrl, path }) {
  return (method === 'GET' || method === 'HEAD') && rawUrl === path;
}

export const SITE_ADMISSION = Object.freeze({
  EXEMPT: 'EXEMPT',
  ADMITTED: 'ADMITTED',
  DENIED: 'DENIED',
});

/** Why a request was denied. Fixed strings, for the log. */
export const SITE_DENIAL_REASONS = Object.freeze({
  CLIENT_NOT_LISTED: 'SITE_CLIENT_NOT_LISTED',
  DELEGATION_REJECTED: 'SITE_DELEGATION_REJECTED',
  DELEGATED_VISITOR_NOT_LISTED: 'SITE_DELEGATED_VISITOR_NOT_LISTED',
  DELEGATION_ROUTE: 'SITE_DELEGATION_ROUTE_NOT_APPROVED',
  DECISION_FAILED: 'SITE_DECISION_FAILED',
});

/**
 * The admission decision for one request to a PRIVATE site. Total: any
 * failure is DENIED.
 *
 * @param {object} input
 * @param {object} input.site            a successful resolveSiteAccess result, mode private
 * @param {string} input.method
 * @param {string} input.rawUrl          the request target as received
 * @param {string} input.livenessPath    the one exempt path
 * @param {number|false} input.trustedHops
 * @param {string} [input.socketAddress]
 * @param {string} [input.forwardedFor]
 * @param {object} [input.delegated]     API only: the delegation headers' reading
 *                                       ({ headers, delegation, approvedRoute }). The document
 *                                       server never reads delegation headers.
 * @returns {{ admission: string, reason: string | null }}
 */
export function decideSiteAdmission({ site, method, rawUrl, livenessPath, trustedHops, socketAddress, forwardedFor, delegated = null }) {
  try {
    if (isLivenessRequest({ method, rawUrl, path: livenessPath })) return { admission: SITE_ADMISSION.EXEMPT, reason: null };
    if (!isPrivateSite(site)) return { admission: SITE_ADMISSION.DENIED, reason: SITE_DENIAL_REASONS.DECISION_FAILED };

    if (delegated) {
      // T2 delegation: admission follows the AUTHENTICATED end visitor, never
      // the caller. A request carrying either delegation header is decided
      // from the delegation only — a rejected one from a listed service peer
      // is denied — and only on its approved routes.
      const reading = readDelegatedVisitor({ delegation: delegated.delegation, method, headers: delegated.headers });
      if (reading.attempted) {
        if (!delegated.approvedRoute) return { admission: SITE_ADMISSION.DENIED, reason: SITE_DENIAL_REASONS.DELEGATION_ROUTE };
        if (reading.outcome !== DELEGATION_OUTCOMES.ACCEPTED) {
          return {
            admission: SITE_ADMISSION.DENIED,
            reason: reading.outcome === DELEGATION_OUTCOMES.ACCEPTED_UNLISTED ? SITE_DENIAL_REASONS.DELEGATED_VISITOR_NOT_LISTED : SITE_DENIAL_REASONS.DELEGATION_REJECTED,
          };
        }
        return isAddressListed(site.allowlist, reading.clientAddress)
          ? { admission: SITE_ADMISSION.ADMITTED, reason: null }
          : { admission: SITE_ADMISSION.DENIED, reason: SITE_DENIAL_REASONS.DELEGATED_VISITOR_NOT_LISTED };
      }
    }

    const clientAddress = establishClientAddress({ trustedHops, socketAddress, forwardedFor });
    return isAddressListed(site.allowlist, clientAddress)
      ? { admission: SITE_ADMISSION.ADMITTED, reason: null }
      : { admission: SITE_ADMISSION.DENIED, reason: SITE_DENIAL_REASONS.CLIENT_NOT_LISTED };
  } catch {
    return { admission: SITE_ADMISSION.DENIED, reason: SITE_DENIAL_REASONS.DECISION_FAILED };
  }
}

/**
 * Makes every response on `res` carry `Cache-Control: private, no-store` and
 * no `ETag` or `Last-Modified`, whatever later code sets — enforced at the
 * moment the head is written, so it also covers errors, redirects, static
 * files and headers passed to writeHead directly.
 */
export function enforcePrivateResponseHeaders(res) {
  const writeHead = res.writeHead;
  res.writeHead = function writeHeadPrivate(statusCode, ...rest) {
    const headersArg = rest.find((value) => value !== null && typeof value === 'object');
    if (headersArg && !Array.isArray(headersArg)) {
      for (const name of Object.keys(headersArg)) {
        const lower = name.toLowerCase();
        if (lower === 'etag' || lower === 'last-modified' || lower === 'cache-control') delete headersArg[name];
      }
    }
    this.removeHeader('ETag');
    this.removeHeader('Last-Modified');
    this.setHeader('Cache-Control', PRIVATE_CACHE_CONTROL);
    return writeHead.call(this, statusCode, ...rest);
  };
}
