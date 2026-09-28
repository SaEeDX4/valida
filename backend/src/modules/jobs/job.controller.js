import { jobNotFound, serviceUnavailable, validationFailed } from '../../errors/AppError.js';
import { successEnvelope } from '../../lib/envelope.js';
import { DatabaseUnavailableError } from './job.repository.js';
import { toPublicJobDetail, toPublicJobListItem } from './job.mapper.js';
import { publicApplicationStatus } from './job.visibility.js';
import { isValidPublicSlug, parseDetailQuery, parseListQuery } from './job.validation.js';

/**
 * Public Jobs controllers — 09_BACKEND_API_SPEC.md sections 48-70.
 *
 * Each request takes ONE server timestamp and uses it for the query and for
 * the status it reports, so a Job cannot be selected as open and labelled
 * closed (or the reverse) within one response.
 */

/**
 * A database outage becomes 503 SERVICE_UNAVAILABLE — never an empty success.
 * The log records only the fixed classification; driver text never reaches it.
 */
function translateDatabaseFailure(error, req, logger) {
  if (error instanceof DatabaseUnavailableError) {
    logger.error({ reqId: req.id, dependency: 'database', reason: error.reason }, 'public jobs read failed');
    return serviceUnavailable(error);
  }
  return error;
}

export function createJobsController({ repository, clock, logger }) {
  /** GET /api/v1/jobs — Doc 09 sections 48-58. */
  async function listJobs(req, res, next) {
    const query = parseListQuery(req.query);
    if (!query.ok) {
      next(validationFailed(query.fieldErrors));
      return;
    }
    const { page, limit } = query.value;
    const now = clock();

    let result;
    try {
      result = await repository.listOpenJobs({ now, skip: (page - 1) * limit, limit });
    } catch (error) {
      next(translateDatabaseFailure(error, req, logger));
      return;
    }

    try {
      const items = result.jobs.map((job) => toPublicJobListItem(job, publicApplicationStatus(job, now)));
      res.status(200).json(
        successEnvelope(
          {
            items,
            pagination: {
              page,
              limit,
              total: result.total,
              totalPages: result.total === 0 ? 0 : Math.ceil(result.total / limit),
            },
          },
          req.id,
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/v1/jobs/:jobSlug — Doc 09 sections 59-70. */
  async function getJob(req, res, next) {
    const query = parseDetailQuery(req.query);
    if (!query.ok) {
      next(validationFailed(query.fieldErrors));
      return;
    }

    const { jobSlug } = req.params;
    // Doc 09 section 61: an invalid slug is answered exactly like an unknown
    // one, and never reaches the database.
    if (!isValidPublicSlug(jobSlug)) {
      next(jobNotFound());
      return;
    }
    const now = clock();

    let job;
    try {
      job = await repository.findPublicJobBySlug({ slug: jobSlug, now });
    } catch (error) {
      next(translateDatabaseFailure(error, req, logger));
      return;
    }

    // The query already excludes non-public Jobs; the status is recomputed so
    // that a record which somehow slipped through is still answered as absent.
    const applicationStatus = publicApplicationStatus(job, now);
    if (applicationStatus === null) {
      next(jobNotFound());
      return;
    }

    try {
      res.status(200).json(successEnvelope(toPublicJobDetail(job, applicationStatus), req.id));
    } catch (error) {
      next(error);
    }
  }

  return { listJobs, getJob };
}
