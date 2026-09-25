import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { errorEnvelope } from '../lib/envelope.js';
import { ERROR_CODES } from '../errors/AppError.js';

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
 * The Apply-specific limiter (10 per 15 minutes) is NOT implemented here: the
 * Apply endpoint arrives in B5 and will bring its own stricter limiter.
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
