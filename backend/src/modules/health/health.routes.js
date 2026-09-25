import { Router } from 'express';
import { successEnvelope } from '../../lib/envelope.js';
import { serviceUnavailable } from '../../errors/AppError.js';

/**
 * Health and readiness — Doc 09, Doc 15.
 *
 * LIVENESS  GET /api/v1/health
 *   Is the process alive and serving HTTP? No authentication, no database, no
 *   dependency of any kind — a liveness probe that depended on the database
 *   would restart a healthy app during a database blip.
 *
 * READINESS GET /api/v1/health/ready
 *   Should this instance receive traffic? True only when every required
 *   dependency reports ready. At the B1 baseline three of them do not exist
 *   yet, so this correctly answers 503.
 *
 * Neither response contains infrastructure detail, versions or secrets, and
 * the readiness body never names the failing dependency — that would tell an
 * unauthenticated caller which part of the system is down. The detail goes to
 * the internal log instead.
 */
export function healthRouter({ readiness, logger }) {
  const router = Router();

  router.get('/', (req, res) => {
    res.status(200).json(successEnvelope({ status: 'ok' }, req.id));
  });

  router.get('/ready', (req, res, next) => {
    if (!readiness.isReady()) {
      logger.warn({ reqId: req.id, readiness: readiness.describe() }, 'readiness check failed');
      next(serviceUnavailable());
      return;
    }
    res.status(200).json(successEnvelope({ status: 'ready' }, req.id));
  });

  return router;
}
