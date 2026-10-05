import mongoose from 'mongoose';
import { Job } from '../../models/Job.js';
import { PUBLIC_LIST_SORT, openJobsFilter, publicDetailFilter } from './job.visibility.js';

/**
 * Public Job reads — 09_BACKEND_API_SPEC.md sections 29, 48-70;
 * 10_DATA_MODEL.md sections 63, 67.
 *
 * The only database access the public Jobs API performs. Two properties matter
 * more than anything else here:
 *
 * 1. QUERIES ARE BUILT, NEVER PASSED THROUGH. Every filter comes from
 *    job.visibility.js with fixed operators; the only request-derived values
 *    are a validated slug (bound with $eq), a validated skip/limit and the
 *    server clock. Projections name the fields a DTO may need and exclude _id,
 *    so an internal field is never even read into memory for a public request.
 *
 * 2. A DATABASE FAILURE IS NEVER AN EMPTY RESULT. If MongoDB is not connected,
 *    does not answer within the configured bound, or the driver reports a
 *    failure, a DatabaseUnavailableError is thrown and the API answers 503 —
 *    never `items: []`, which the Careers page would render as "no open roles"
 *    (Doc 09 section 57, Doc 12 section 51).
 *
 *    The connection state is checked before querying because Mongoose would
 *    otherwise BUFFER the command while disconnected and hold the request
 *    open. A bounded deadline covers a server that is connected but
 *    unresponsive; the same bound is sent to MongoDB as maxTimeMS. An
 *    abandoned query cannot be cancelled, but it can no longer hold the
 *    request open, and its eventual outcome is absorbed.
 */

/** Raised when MongoDB cannot serve a public read. `reason` is a fixed classification. */
export class DatabaseUnavailableError extends Error {
  /** @param {'disconnected' | 'timeout' | 'query_failed'} reason */
  constructor(reason) {
    super('The database is unavailable.');
    this.name = 'DatabaseUnavailableError';
    this.reason = reason;
  }
}

/** Fields read for a list row. Nothing internal is selected. */
export const LIST_PROJECTION = Object.freeze({
  _id: 0,
  title: 1,
  slug: 1,
  status: 1,
  'location.displayName': 1,
  workArrangement: 1,
  employmentType: 1,
  schedule: 1,
  weeklyHours: 1,
  compensation: 1,
  publishedAt: 1,
  closesAt: 1,
});

/** Fields read for a detail page: the list fields plus role content and form configuration. */
export const DETAIL_PROJECTION = Object.freeze({
  ...LIST_PROJECTION,
  description: 1,
  responsibilities: 1,
  requirements: 1,
  preferredQualifications: 1,
  'applicationConfig.phone': 1,
  'applicationConfig.message': 1,
  'applicationConfig.screeningQuestions': 1,
});

/**
 * Errors that mean "the database could not serve this", as opposed to a defect
 * in this code. Mongoose's cast/validation/strict errors are programming
 * errors and surface as 500, not as a dependency outage.
 */
function isDatabaseFailure(error) {
  if (error instanceof mongoose.mongo.MongoError) return true;
  if (error instanceof mongoose.Error) {
    return !(
      error instanceof mongoose.Error.CastError ||
      error instanceof mongoose.Error.ValidationError ||
      error instanceof mongoose.Error.ValidatorError ||
      error instanceof mongoose.Error.StrictModeError
    );
  }
  return false;
}

/**
 * B5 — the Job fields the Apply workflow reads: the public-visibility fields,
 * the snapshot fields (Doc 10 section 77) and the application configuration.
 * Unlike the public DTO projections it includes `_id`, which the Application
 * references (Doc 10 section 74). It is used only server-side: no response
 * ever carries it (Doc 09 section 127).
 */
export const APPLICATION_JOB_PROJECTION = Object.freeze({
  _id: 1,
  title: 1,
  slug: 1,
  status: 1,
  publishedAt: 1,
  closesAt: 1,
  'location.displayName': 1,
  workArrangement: 1,
  employmentType: 1,
  schedule: 1,
  weeklyHours: 1,
  compensation: 1,
  applicationConfig: 1,
});

/** B5 — the lifecycle fields that decide whether a Job accepts Applications at an instant. */
export const ELIGIBILITY_PROJECTION = Object.freeze({ _id: 1, status: 1, publishedAt: 1, closesAt: 1 });

/**
 * Runs `operation` against a connected database within `timeoutMs`.
 * Rejects with DatabaseUnavailableError on disconnection, timeout or driver
 * failure; any other error is re-thrown unchanged.
 *
 * Exported for the B5 Application repository's READS (same semantics). Not
 * for writes: an abandoned write has an unknown outcome, which a read does not.
 */
export function runBounded(model, operation, timeoutMs) {
  if (model.db?.readyState !== 1) {
    return Promise.reject(new DatabaseUnavailableError('disconnected'));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new DatabaseUnavailableError('timeout'));
    }, timeoutMs);
    Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          if (settled) return; // late result of an abandoned query: ignored
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          if (settled) return; // late failure of an abandoned query: absorbed
          settled = true;
          clearTimeout(timer);
          reject(isDatabaseFailure(error) ? new DatabaseUnavailableError('query_failed') : error);
        },
      );
  });
}

/**
 * @param {object} [options]
 * @param {import('mongoose').Model} [options.model]  the Job model (tests may pass a stand-in)
 * @param {number} [options.queryTimeoutMs]           bound per public read (MONGODB_QUERY_TIMEOUT_MS)
 */
export function createJobRepository({ model = Job, queryTimeoutMs = 5_000 } = {}) {
  return Object.freeze({
    /**
     * One page of effectively OPEN Jobs, in canonical order, plus the total.
     *
     * The count runs first; a page past the end is answered from it without
     * sending an enormous skip to the server.
     *
     * @returns {Promise<{ total: number, jobs: object[] }>}
     */
    listOpenJobs({ now, skip, limit }) {
      const filter = openJobsFilter(now);
      return runBounded(
        model,
        async () => {
          const total = await model.countDocuments(filter).maxTimeMS(queryTimeoutMs);
          if (total === 0 || skip >= total) return { total, jobs: [] };
          const jobs = await model
            .find(filter, LIST_PROJECTION)
            .sort(PUBLIC_LIST_SORT)
            .skip(skip)
            .limit(limit)
            .maxTimeMS(queryTimeoutMs)
            .lean();
          return { total, jobs };
        },
        queryTimeoutMs,
      );
    },

    /**
     * The Job at a public slug, if it can be public at all at `now`
     * (PUBLISHED or CLOSED, publishedAt <= now). DRAFT, ARCHIVED and
     * not-yet-published Jobs are excluded by the query itself.
     *
     * @returns {Promise<object | null>}
     */
    findPublicJobBySlug({ slug, now }) {
      const filter = publicDetailFilter(slug, now);
      return runBounded(
        model,
        () => model.findOne(filter, DETAIL_PROJECTION).maxTimeMS(queryTimeoutMs).lean(),
        queryTimeoutMs,
      );
    },

    /**
     * B5 — the Job an Application at this public slug would be for, with the
     * same visibility filter as the public detail (Doc 09 sections 110-114):
     * DRAFT, ARCHIVED and not-yet-published Jobs are not selected at all.
     * Whether it is still accepting Applications is decided by the caller with
     * publicApplicationStatus() against the same `now`.
     *
     * @returns {Promise<object | null>}
     */
    findJobForApplication({ slug, now }) {
      const filter = publicDetailFilter(slug, now);
      return runBounded(
        model,
        () => model.findOne(filter, APPLICATION_JOB_PROJECTION).maxTimeMS(queryTimeoutMs).lean(),
        queryTimeoutMs,
      );
    },

    /**
     * B5 — a FRESH read of one Job's lifecycle state, immediately before an
     * Application for it is persisted (Doc 09 section 115, closing-time race).
     * The id is the server's own (from findJobForApplication), bound with $eq.
     *
     * @returns {Promise<object | null>} null when the Job no longer exists
     */
    findJobEligibility({ jobId }) {
      return runBounded(
        model,
        () => model.findOne({ _id: { $eq: jobId } }, ELIGIBILITY_PROJECTION).maxTimeMS(queryTimeoutMs).lean(),
        queryTimeoutMs,
      );
    },
  });
}
