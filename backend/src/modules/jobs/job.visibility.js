import { effectiveApplicationStatus } from './job.service.js';

/**
 * Public visibility of Jobs — 09_BACKEND_API_SPEC.md sections 43-47, 52, 62;
 * 10_DATA_MODEL.md section 63; 12_CAREERS_APPLICATIONS.md sections 12-17.
 *
 * The server alone decides what the public may see, from the stored lifecycle
 * state and the SERVER clock (Doc 09 section 187). There is no client
 * parameter that widens it.
 *
 *   Careers list   only Jobs whose effective application status is OPEN:
 *                    status PUBLISHED
 *                    AND publishedAt <= now
 *                    AND (closesAt is null OR closesAt > now)
 *
 *   Job detail     OPEN   — as above;
 *                  CLOSED — a PREVIOUSLY PUBLIC Job retained at its stable URL:
 *                             status CLOSED, or status PUBLISHED whose
 *                             closesAt <= now (Doc 09 section 45),
 *                           in both cases with publishedAt <= now — a Job that
 *                           has never been public cannot be "retained";
 *                  not public — everything else: DRAFT, ARCHIVED, a Job whose
 *                           publishedAt is in the future or missing. The API
 *                           answers exactly as it does for an unknown slug.
 *
 * The MongoDB filters below and publicApplicationStatus() express the same
 * rule twice — once for the database to select, once for the mapper to label —
 * and both evaluate against ONE `now` taken per request. The real-database
 * suite checks that they agree at the exact boundaries.
 */

/** Lifecycle states that can ever be shown at a public detail URL. */
export const PUBLIC_DETAIL_STATUSES = Object.freeze(['PUBLISHED', 'CLOSED']);

/** Doc 09 section 53 — publishedAt DESC then createdAt DESC; _id DESC only breaks exact ties, so pages are stable. */
export const PUBLIC_LIST_SORT = Object.freeze({ publishedAt: -1, createdAt: -1, _id: -1 });

function assertDate(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date');
  }
}

/**
 * MongoDB filter for the public Careers list: effectively OPEN Jobs only.
 * Every operator and value is fixed here; nothing comes from the request.
 */
export function openJobsFilter(now) {
  assertDate(now);
  return {
    status: { $eq: 'PUBLISHED' },
    // A Date comparison only matches Date values, so a missing or null
    // publishedAt can never satisfy it (MongoDB type bracketing).
    publishedAt: { $lte: now },
    $or: [{ closesAt: { $eq: null } }, { closesAt: { $gt: now } }],
  };
}

/**
 * MongoDB filter for one public detail lookup. `slug` must already have passed
 * public slug validation; it is still bound with $eq so no value can act as an
 * operator.
 */
export function publicDetailFilter(slug, now) {
  assertDate(now);
  if (typeof slug !== 'string') throw new TypeError('slug must be a string');
  return {
    slug: { $eq: slug },
    status: { $in: [...PUBLIC_DETAIL_STATUSES] },
    publishedAt: { $lte: now },
  };
}

/**
 * The public application status of a stored Job at `now`.
 *
 * @returns {'OPEN' | 'CLOSED' | null} null means "not public" — the caller must
 *   answer exactly as for an unknown Job.
 */
export function publicApplicationStatus(job, now) {
  assertDate(now);
  if (!job || !(job.publishedAt instanceof Date) || job.publishedAt > now) return null;
  if (job.status === 'PUBLISHED') return effectiveApplicationStatus(job, now);
  if (job.status === 'CLOSED') return 'CLOSED';
  return null;
}
