import { Router } from 'express';
import { applicationJobNotFound } from '../../errors/AppError.js';
import { applicationRateLimit } from '../../middleware/rateLimit.js';
import { createApplicationsController } from './application.controller.js';

/**
 * Apply route — Milestone B5, 09_BACKEND_API_SPEC.md sections 71-150.
 *
 *   POST /api/v1/jobs/:jobSlug/applications
 *
 * Mounted under /api/v1/jobs next to the read-only Jobs router (B3), so it
 * inherits that path's `Cache-Control: no-store` (Doc 09 section 147; applied
 * in app.js before body parsing and rate limiting) and the general rate limit.
 * No authentication in Phase 1 (section 72). Only POST is routed: a GET on
 * this path stays the canonical API 404.
 *
 * Route middleware, in order (Doc 09 section 13: route-specific upload
 * handling applies only to upload routes):
 *   1. the Apply rate limit (section 34) — before anything is read;
 *   2. the controller: Idempotency-Key, bounded multipart parse, submission.
 */
export function applicationsRouter({ service, uploadArea, resumeStorage, rateLimit }) {
  const router = Router();
  const controller = createApplicationsController({ service, uploadArea, resumeStorage });

  router.post('/:jobSlug/applications', applicationRateLimit(rateLimit), controller.submitApplication);

  /*
   * A slug with malformed percent-encoding makes the router's parameter
   * decoding throw before any handler runs; it is an unavailable role, as on
   * the Jobs routes. The body has not been read: the connection is closed in
   * stages, like every other answer given before the body is read.
   */
  // eslint-disable-next-line no-unused-vars -- Express needs the 4-argument signature.
  router.use((error, _req, _res, next) => {
    if (error instanceof URIError) {
      const notFound = applicationJobNotFound({ reason: 'JOB_SLUG_INVALID' });
      notFound.closeConnection = true;
      next(notFound);
      return;
    }
    next(error);
  });

  return router;
}
