import { Job } from '../../models/Job.js';
import { ALLOWED_TRANSITIONS, checkPublishReadiness } from './job.rules.js';

export { ALLOWED_TRANSITIONS, checkPublishReadiness };

/**
 * Job lifecycle and publication rules — Doc 10 sections 22, 58, 63-65.
 *
 * These live in a service rather than in schema `required` flags because a
 * Draft is deliberately allowed to be incomplete (section 65): the same field
 * that may be empty while drafting must be present before publication. A
 * schema-level requirement would make drafts unsaveable.
 *
 * B2 provides only the helpers needed to enforce and test the rules. Public
 * endpoints and operational Job provisioning belong to B3.
 */

/** Raised for a rejected lifecycle action. Carries no candidate or secret data. */
export class JobLifecycleError extends Error {
  constructor(code, detail = {}) {
    super(code);
    this.name = 'JobLifecycleError';
    this.code = code;
    Object.assign(this, detail);
  }
}

function assertTransition(from, to) {
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw new JobLifecycleError('INVALID_TRANSITION', { from, to });
  }
}

/**
 * Publishes a Job.
 *
 * publishedAt records the FIRST publication and is never overwritten on
 * reopen (Doc 10 section 59) — it is the historical first-publication
 * timestamp that canonical URLs and external links were created against.
 */
export async function publishJob(job, { now = new Date() } = {}) {
  assertTransition(job.status, 'PUBLISHED');

  const readiness = checkPublishReadiness(job);
  if (!readiness.ready) {
    throw new JobLifecycleError('NOT_PUBLISH_READY', { missing: readiness.missing });
  }

  job.status = 'PUBLISHED';
  if (!job.publishedAt) job.publishedAt = now;
  // Reopening clears the previous closure, but never the first-publish stamp.
  job.closedAt = null;
  await job.save();
  return job;
}

/** Closes a published Job to new applications. */
export async function closeJob(job, { now = new Date() } = {}) {
  assertTransition(job.status, 'CLOSED');
  job.status = 'CLOSED';
  job.closedAt = now;
  await job.save();
  return job;
}

/** Archives a Job. Terminal — nothing may transition out of ARCHIVED. */
export async function archiveJob(job, { now = new Date() } = {}) {
  assertTransition(job.status, 'ARCHIVED');
  job.status = 'ARCHIVED';
  job.archivedAt = now;
  await job.save();
  return job;
}

/**
 * Doc 10 section 63 — effective application status, computed and never stored.
 *
 * A Job can sit in PUBLISHED while being effectively closed because its
 * closesAt has passed; storing the derived value would let it go stale the
 * moment the clock moved.
 */
export function effectiveApplicationStatus(job, now = new Date()) {
  const open =
    job.status === 'PUBLISHED' &&
    job.publishedAt instanceof Date &&
    job.publishedAt <= now &&
    (job.closesAt === null || job.closesAt === undefined || job.closesAt > now);
  return open ? 'OPEN' : 'CLOSED';
}

/**
 * Applies an edit to a Job through a controlled allowlist.
 *
 * Mass assignment is deliberately prevented: status, publishedAt, closedAt,
 * archivedAt and _id are lifecycle state owned by the functions above, and an
 * untrusted payload must not be able to publish a Job by setting a field.
 */
const EDITABLE_FIELDS = new Set([
  'title', 'slug', 'internalOccupationalReference', 'location', 'workArrangement',
  'employmentType', 'schedule', 'weeklyHours', 'compensation', 'description',
  'responsibilities', 'requirements', 'preferredQualifications', 'applicationConfig',
  'closesAt',
]);

export function applyJobEdit(job, patch) {
  for (const [field, value] of Object.entries(patch ?? {})) {
    if (!EDITABLE_FIELDS.has(field)) {
      throw new JobLifecycleError('FIELD_NOT_EDITABLE', { field });
    }
    // Doc 10 section 22 — the slug is immutable once published. Checked here
    // as well as in the schema so the service rejects it before any write.
    if (field === 'slug' && job.publishedAt) {
      throw new JobLifecycleError('SLUG_IMMUTABLE');
    }
    job.set(field, value);
  }
  return job;
}

export { Job };
