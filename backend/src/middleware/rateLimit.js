import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { errorEnvelope } from '../lib/envelope.js';
import { ERROR_CODES, applicationRateLimited } from '../errors/AppError.js';

/**
 * General public API rate limit — Doc 13.
 *
 * Canonical starting policy: 120 requests per 60 seconds per effective client
 * IP, configuration-driven.
 *
 * HEALTH CHECKS ARE EXEMPT, deliberately. A platform liveness probe polling
 * every second would consume the budget and start receiving 429s, the platform
 * would read that as an unhealthy instance and restart it — a self-inflicted
 * outage. The health endpoints touch no database and return no data, so
 * exempting them costs nothing.
 *
 * The Apply-specific limiter (Doc 09 section 34) is applicationRateLimit()
 * below — B5.
 */
export function generalRateLimit({ windowMs, max }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => req.path === '/health' || req.path === '/health/ready',
    /*
     * ipKeyGenerator takes the IP STRING, not the request. It normalises an
     * IPv6 address to its /56 subnet, so a single client cannot rotate through
     * the addresses it already controls to multiply its allowance.
     *
     * req.ip honours the validated `trust proxy` setting, which defaults to
     * false — so an untrusted client cannot spoof its key with an
     * X-Forwarded-For header.
     */
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    handler(req, res) {
      res
        .status(429)
        .json(
          errorEnvelope(
            {
              code: ERROR_CODES.RATE_LIMITED,
              message:
                'Too many attempts were received in a short period. Please wait and try again.',
            },
            req.id,
          ),
        );
    },
  });
}

/**
 * Apply rate limit — Milestone B5, Doc 09 sections 34-35, BE-045.
 *
 * Starting policy: 10 submission ATTEMPTS per 15 minutes per effective client
 * IP (configuration-driven). Mounted on the Apply route only, BEFORE the
 * Idempotency-Key check and before a byte of the upload is read, so every
 * attempt counts — accepted, refused or replayed — and a limited client costs
 * the server no upload processing.
 *
 * Its own counter (a separate limiter instance): Apply attempts do not consume
 * the general read budget's allowance beyond the one request each, and reads
 * cannot exhaust the Apply allowance.
 *
 * A limited request is answered through the central error handler as
 * 429 RATE_LIMITED with `closeConnection`: its upload body has not been read,
 * so — like B4's early 413/503 — the connection is closed in stages
 * (lib/http/stagedClose.js), the unread body is never processed as another
 * request, and the client still receives the 429. The RateLimit headers
 * (draft-7) are set by the limiter before the error is raised.
 *
 * Same key derivation as the general limiter: req.ip under the validated
 * `trust proxy` setting, IPv6 normalised to its /56.
 *
 * LIMITATION (Doc 13 section 54): the counter lives in process memory. With
 * several backend instances each instance counts separately; the deployment
 * design (C6) must account for that before scaling out.
 */
export function applicationRateLimit({ windowMs, max }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    handler(_req, _res, next) {
      next(applicationRateLimited());
    },
  });
}
