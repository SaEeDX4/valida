import { applicationJobNotFound, notFound } from '../errors/AppError.js';
import { RECRUITMENT_AUDIENCE, decideRecruitmentAudience } from '../config/recruitmentAccess.js';

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
 *   1. Decides the request's audience once, from the address Express derived
 *      under the validated TRUST_PROXY setting (req.ip), and records it on
 *      the request. The controllers act on that record and treat a MISSING
 *      record as "none", so a route that is ever mounted without this gate is
 *      closed, not open.
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

export function recruitmentAccessGate({ access }) {
  return function recruitmentAccessMiddleware(req, res, next) {
    let audience = RECRUITMENT_AUDIENCE.NONE;
    try {
      audience = decideRecruitmentAudience(access, req.ip);
    } catch {
      // decideRecruitmentAudience is total; if reading req.ip itself throws,
      // the request is answered as closed.
      audience = RECRUITMENT_AUDIENCE.NONE;
    }
    req[RECRUITMENT_ACCESS] = Object.freeze({ audience });

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
