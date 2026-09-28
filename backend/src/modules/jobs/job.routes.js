import { Router } from 'express';
import { jobNotFound } from '../../errors/AppError.js';
import { createJobsController } from './job.controller.js';

/**
 * Public Jobs routes — 09_BACKEND_API_SPEC.md sections 16, 48-70.
 *
 *   GET /api/v1/jobs           open Jobs, paginated
 *   GET /api/v1/jobs/:jobSlug  one public Job (OPEN or retained CLOSED)
 *
 * No authentication (Doc 09 section 49). Read-only: no other method is
 * routed here, so anything else falls through to the canonical JSON 404.
 * The general public rate limit mounted on /api/v1 applies.
 *
 * `Cache-Control: no-store` (Doc 09 section 58) is applied in app.js, ahead of
 * body parsing and rate limiting, so it covers every response on this path —
 * including those that end before this router runs (see middleware/noStore.js).
 */
export function jobsRouter({ repository, clock, logger }) {
  const router = Router();
  const controller = createJobsController({ repository, clock, logger });

  router.get('/', controller.listJobs);
  router.get('/:jobSlug', controller.getJob);

  /*
   * A slug whose percent-encoding is malformed ("/jobs/%E0%A4%A") makes the
   * router's own parameter decoding throw a URIError before any handler runs.
   * Left alone it would surface as a 500; it is an invalid slug, so it is
   * answered exactly like any other unavailable role (Doc 09 section 61).
   * Every other error continues to the central handler unchanged.
   */
  // eslint-disable-next-line no-unused-vars -- Express needs the 4-argument signature.
  router.use((error, _req, _res, next) => {
    if (error instanceof URIError) {
      next(jobNotFound());
      return;
    }
    next(error);
  });

  return router;
}
