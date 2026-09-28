/**
 * Job lifecycle and publication rules — Doc 10 sections 43, 58, 64.
 *
 * Pure functions and constants with no database or model import, so that both
 * the Job model (as a safety net on every save) and the Job service (as the
 * intended write path) apply the SAME rules.
 */

/** Doc 10 section 58 — the only permitted transitions. ARCHIVED is terminal. */
export const ALLOWED_TRANSITIONS = {
  DRAFT: ['PUBLISHED', 'ARCHIVED'],
  PUBLISHED: ['CLOSED'],
  CLOSED: ['PUBLISHED', 'ARCHIVED'],
  ARCHIVED: [],
};

/** Doc 10 section 64 — fields that must be complete before publication. */
export function checkPublishReadiness(job) {
  const missing = [];
  const require = (condition, field) => {
    if (!condition) missing.push(field);
  };

  require(typeof job.title === 'string' && job.title.trim().length >= 3, 'title');
  require(typeof job.slug === 'string' && job.slug.trim().length > 0, 'slug');
  require(Boolean(job.location?.displayName), 'location.displayName');
  require(Boolean(job.location?.countryCode), 'location.countryCode');
  require(Boolean(job.workArrangement), 'workArrangement');
  require(Boolean(job.employmentType), 'employmentType');
  // Section 64 — "schedule and/or adequate schedule information": either the
  // human-readable schedule or weeklyHours satisfies it, but not neither.
  require(Boolean(job.schedule) || typeof job.weeklyHours === 'number', 'schedule or weeklyHours');
  require(typeof job.weeklyHours === 'number' && job.weeklyHours > 0, 'weeklyHours');
  require(
    Boolean(job.compensation?.currency) &&
      Number.isInteger(job.compensation?.amountMinor) &&
      Boolean(job.compensation?.unit) &&
      typeof job.compensation?.gross === 'boolean',
    'compensation',
  );
  require(typeof job.description === 'string' && job.description.trim().length > 0, 'description');
  require(Array.isArray(job.responsibilities) && job.responsibilities.length > 0, 'responsibilities');
  require(Array.isArray(job.requirements) && job.requirements.length > 0, 'requirements');
  // Section 43 — Phase 1 supports no public Job without a resume, so a Job
  // whose configuration does not require one cannot be published.
  require(job.applicationConfig?.resumeRequired === true, 'applicationConfig.resumeRequired');

  return { ready: missing.length === 0, missing };
}
