import { siteAccessDenied } from '../errors/AppError.js';
import {
  CONDITIONAL_REQUEST_HEADERS,
  SITE_ADMISSION,
  decideSiteAdmission,
  enforcePrivateResponseHeaders,
  isPrivateSite,
} from '../config/siteAccess.js';
import { DISABLED_SERVICE_DELEGATION } from '../config/recruitmentAccess.js';

/**
 * C6-T3 — the site-access gate of the API (config/siteAccess.js).
 *
 * Mounted on EVERY request, after request id, logging and security headers
 * and BEFORE everything else: Jobs cache policy, CORS (preflight included),
 * the recruitment gate, body parsing, rate limiting and every route. On a
 * public site it does nothing at all.
 *
 * On a private site:
 *   - every response carries `Cache-Control: private, no-store` and no ETag
 *     or Last-Modified, enforced when the head is written; conditional
 *     request headers are dropped, so nothing is ever answered 304;
 *   - GET/HEAD of exactly /api/v1/health pass, for the host's liveness check;
 *     readiness (/api/v1/health/ready) is NOT exempt;
 *   - a request carrying a delegation header (C6-T2) is admitted only when
 *     the delegation is valid, on a delegated route (GET/HEAD of the Jobs
 *     list or a Job), and for a LISTED end visitor — never on the strength
 *     of the caller's own address;
 *   - any other request is admitted when its own address (the T1 rule,
 *     TRUST_PROXY) is listed;
 *   - everything else is answered 403 AUTHORIZATION_DENIED, the body unread;
 *     a request that may carry a body also has its connection closed (in
 *     stages, as the T1 gate does).
 *
 * Admission grants nothing else: an admitted request still meets CORS, the
 * recruitment mode, validation and every route's own rules.
 */

export const API_LIVENESS_PATH = '/api/v1/health';

/** GET or HEAD of the Jobs list or of one Job — the routes a delegation may use (C6-T2). */
const DELEGATED_ROUTE = /^\/api\/v1\/jobs(?:\/[^/?#]+)?(?:\?[^#]*)?$/;
const BODILESS_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function siteAccessGate({ site, trustedHops = false, delegation = DISABLED_SERVICE_DELEGATION, onDenied = () => {} }) {
  if (!isPrivateSite(site)) {
    return function publicSite(_req, _res, next) {
      next();
    };
  }
  return function privateSiteGate(req, res, next) {
    enforcePrivateResponseHeaders(res);
    for (const name of CONDITIONAL_REQUEST_HEADERS) delete req.headers[name];

    const rawUrl = typeof req.originalUrl === 'string' ? req.originalUrl : req.url;
    const { admission, reason } = decideSiteAdmission({
      site,
      method: req.method,
      rawUrl,
      livenessPath: API_LIVENESS_PATH,
      trustedHops,
      socketAddress: req.socket?.remoteAddress,
      forwardedFor: req.headers?.['x-forwarded-for'],
      delegated: { headers: req.headers, delegation, approvedRoute: (req.method === 'GET' || req.method === 'HEAD') && DELEGATED_ROUTE.test(rawUrl) },
    });
    if (admission === SITE_ADMISSION.EXEMPT || admission === SITE_ADMISSION.ADMITTED) {
      next();
      return;
    }
    try {
      onDenied({ reason });
    } catch {
      // logging must never change the answer
    }
    next(siteAccessDenied({ reason, closeConnection: !BODILESS_METHODS.has(req.method) }));
  };
}
