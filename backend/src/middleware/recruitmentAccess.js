import { applicationJobNotFound, notFound } from '../errors/AppError.js';
import {
  DELEGATION_OUTCOMES,
  DISABLED_SERVICE_DELEGATION,
  RECRUITMENT_AUDIENCE,
  decideRecruitmentAudience,
  establishClientAddress,
  readDelegatedVisitor,
} from '../config/recruitmentAccess.js';

/**
 * The recruitment access gate — Milestone C6, task C6-T1 (see
 * config/recruitmentAccess.js for the decision record and the modes).
 *
 * Mounted on /api/v1/jobs in app.js AFTER CORS and BEFORE body parsing and
 * rate limiting, so that a client who may not use Jobs is answered:
 *   - before express.json() reads a body;
 *   - before the Apply route's multipart parser creates a temporary file;
 *   - before a Job is looked up, a resume is stored, an Application is
 *     written or a notification is attempted.
 *
 * WHAT IT DOES
 *   1. Decides the request's audience once and records it on the request.
 *      The client address comes from establishClientAddress — NOT from
 *      Express's req.ip. With TRUST_PROXY disabled it is the socket's peer.
 *      With n trusted hops it is the X-Forwarded-For entry n from the right,
 *      and a chain shorter than n means the address is unknown, which is
 *      unlisted; req.ip would fall back to the socket peer or to a
 *      client-supplied entry (C6 plan revision 3, section 4.6.3). The rate
 *      limiters keep using req.ip, unchanged. The controllers act on that record and treat a MISSING
 *      record as "none", so a route that is ever mounted without this gate is
 *      closed, not open.
 *   1b. C6-T2: a request with the delegation headers of the document server is
 *      decided from the visitor it names, after the key is verified; see
 *      readDelegatedVisitor in config/recruitmentAccess.js.
 *   2. For a listed tester in `testers` mode, adds `X-Valida-Audience: tester`.
 *      It gives a visible difference to test against before any Job exists,
 *      and is sent to no one else.
 *   3. For a client who may not use Jobs, ends every request that could carry
 *      a body at once, with the body unread: a submission gets the answer an
 *      unknown Job gets (Doc 09 sections 77, 91: 404 JOB_NOT_FOUND, "This
 *      application isn't available."), anything else the canonical API 404 it
 *      would have got anyway. Both ask the error handler to close the
 *      connection in stages (B7), so the unread upload is discarded within the
 *      server's bounds and is never processed as another request.
 *   4. Lets GET, HEAD and OPTIONS through to the routers. They carry no body;
 *      the Jobs controllers answer them as an empty list or an unknown Job,
 *      after the same query validation and rate limiting as everyone's.
 *
 * It writes nothing to the log: the access log already records method, route
 * template and status, and never a client address.
 */

/** Where the decision is kept on the request. */
export const RECRUITMENT_ACCESS = Symbol('valida.recruitmentAccess');

/** `POST <mount>/:jobSlug/applications`, as Express's own router would match it (case-insensitive, optional trailing slash). */
const SUBMISSION_PATH = /^\/[^/]+\/applications\/?$/i;
const BODILESS_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The audience recorded for this request; `none` when no gate ran. */
export function recruitmentAudience(req) {
  return req?.[RECRUITMENT_ACCESS]?.audience ?? RECRUITMENT_AUDIENCE.NONE;
}

/** True only for a request the gate let through. */
export function mayUseJobs(req) {
  const audience = recruitmentAudience(req);
  return audience === RECRUITMENT_AUDIENCE.TESTER || audience === RECRUITMENT_AUDIENCE.PUBLIC;
}

/** The submission refusal: the unknown-Job answer, body unread, connection closed in stages. */
export function submissionNotAvailable() {
  const error = applicationJobNotFound({ reason: 'RECRUITMENT_ACCESS_DENIED' });
  error.closeConnection = true;
  return error;
}

/**
 * @param {object} options
 * @param {object} options.access       config.recruitment (config/recruitmentAccess.js)
 * @param {false|number} options.trustedHops  the validated TRUST_PROXY
 * @param {object} [options.delegation] config.serviceDelegation (C6-T2): INTERNAL_SERVICE_KEY, resolved
 * @param {function} [options.onDelegationRejected]  called with { outcome } for a rejected delegation; it carries no header value
 */
export function recruitmentAccessGate({ access, trustedHops = false, delegation = DISABLED_SERVICE_DELEGATION, onDelegationRejected = () => {} }) {
  return function recruitmentAccessMiddleware(req, res, next) {
    let audience = RECRUITMENT_AUDIENCE.NONE;
    let outcome = DELEGATION_OUTCOMES.NOT_ATTEMPTED;
    try {
      /*
       * C6-T2 — a request carrying either delegation header is decided ONLY
       * from the delegated visitor (or as unlisted when the delegation is not
       * valid), never from its own socket or forwarding chain: the document
       * server's own address may be listed. A request with neither header is
       * a direct one, decided exactly as in T1.
       */
      const delegated = readDelegatedVisitor({ delegation, method: req.method, headers: req.headers });
      outcome = delegated.outcome;
      const clientAddress = delegated.attempted
        ? delegated.clientAddress
        : establishClientAddress({
            trustedHops,
            socketAddress: req.socket?.remoteAddress,
            forwardedFor: req.headers?.['x-forwarded-for'],
          });
      audience = decideRecruitmentAudience(access, clientAddress);
      // A delegation grants no submission, in any mode: a delegated request
      // with a body is refused like an unlisted client's.
      if (outcome === DELEGATION_OUTCOMES.REJECTED_METHOD) audience = RECRUITMENT_AUDIENCE.NONE;
    } catch {
      // Every function above is total; if reading the request itself throws,
      // the request is answered as closed.
      audience = RECRUITMENT_AUDIENCE.NONE;
    }
    req[RECRUITMENT_ACCESS] = Object.freeze({ audience, delegation: outcome });
    if (outcome.startsWith('REJECTED_')) {
      try {
        onDelegationRejected({ outcome });
      } catch {
        // logging must never change the answer
      }
    }

    if (audience === RECRUITMENT_AUDIENCE.TESTER) res.set('X-Valida-Audience', 'tester');

    if (audience !== RECRUITMENT_AUDIENCE.NONE || BODILESS_METHODS.has(req.method)) {
      next();
      return;
    }

    if (req.method === 'POST' && SUBMISSION_PATH.test(req.path)) {
      next(submissionNotAvailable());
      return;
    }
    const error = notFound();
    error.closeConnection = true;
    next(error);
  };
}
