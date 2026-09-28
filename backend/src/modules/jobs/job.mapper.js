import { RESUME_UPLOAD_POLICY } from '../../config/resumePolicy.js';
import { minorToMajor } from './money.js';

/**
 * Public Job DTOs — 09_BACKEND_API_SPEC.md sections 54, 63-67, 182-186;
 * 10_DATA_MODEL.md sections 15, 23, 46-55.
 *
 * Database documents are NEVER returned directly (Doc 09 section 182). Each DTO
 * is built field by field from an explicit allowlist, so a field added to the
 * model later — or an internal one already there — cannot leak by accident:
 *
 *   never exposed: _id and every embedded _id, internalOccupationalReference
 *   (Doc 10 section 23), status, closedAt, archivedAt, createdAt, updatedAt,
 *   __v, applicationConfig.resumeRequired as stored, location.countryCode /
 *   regionCode / locality, compensation.amountMinor.
 *
 * Shapes are predictable (Doc 09 section 186): absent values become null or
 * an empty array, never a missing key. Dates are ISO 8601 UTC (section 184).
 * Money is converted from exact minor units with the currency's ISO 4217
 * exponent (money.js) — an unsupported currency throws rather than publishing
 * a wrong wage.
 */

const toIsoOrNull = (value) => (value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null);
const stringOrNull = (value) => (typeof value === 'string' && value.length > 0 ? value : null);
const numberOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const stringList = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);

/** Raised when a stored Job cannot be represented truthfully. Carries no Job content. */
export class PublicJobMappingError extends Error {
  constructor(reason) {
    super(`public Job mapping refused: ${reason}`);
    this.name = 'PublicJobMappingError';
    this.reason = reason;
  }
}

/**
 * Doc 10 section 15 mapping: { currency, amountMinor, unit, gross } ->
 * { currency, amount, unit, gross }. Null when the stored compensation is
 * incomplete (only possible for a retained CLOSED Job edited after closing;
 * a PUBLISHED Job is always publish-ready).
 */
export function toPublicCompensation(compensation) {
  const { currency, amountMinor, unit, gross } = compensation ?? {};
  if (
    typeof currency !== 'string' ||
    typeof amountMinor !== 'number' ||
    typeof unit !== 'string' ||
    typeof gross !== 'boolean'
  ) {
    return null;
  }
  try {
    return { currency, amount: minorToMajor(amountMinor, currency), unit, gross };
  } catch (error) {
    throw new PublicJobMappingError(error.reason ?? 'money');
  }
}

/** Fields shared by the list item and the detail, in Doc 09 order. */
function publicSummary(job) {
  return {
    title: job.title,
    slug: job.slug,
    location: stringOrNull(job.location?.displayName),
    workArrangement: stringOrNull(job.workArrangement),
    employmentType: stringOrNull(job.employmentType),
    schedule: stringOrNull(job.schedule),
    weeklyHours: numberOrNull(job.weeklyHours),
    compensation: toPublicCompensation(job.compensation),
  };
}

/**
 * Doc 09 section 54 — one row of GET /api/v1/jobs.
 *
 * The list holds OPEN Jobs only (section 52). The query and this label use the
 * same server timestamp, so anything else means the selection and the rule
 * disagree — a defect, answered with a safe 500 rather than a row the Careers
 * page would present as an open role.
 */
export function toPublicJobListItem(job, applicationStatus) {
  if (applicationStatus !== 'OPEN') throw new PublicJobMappingError('list_item_not_open');
  return {
    ...publicSummary(job),
    publishedAt: toIsoOrNull(job.publishedAt),
    closesAt: toIsoOrNull(job.closesAt),
    applicationStatus,
  };
}

/** Doc 09 section 66 — { id, type, prompt, required, options }. */
function toPublicScreeningQuestion(question) {
  return {
    id: question.questionId,
    type: question.type,
    prompt: question.prompt,
    required: question.required === true,
    // Doc 10 sections 52-55: options exist only on SINGLE_SELECT and are
    // { optionId, label }; every other type carries an explicit empty array.
    options:
      question.type === 'SINGLE_SELECT'
        ? (question.options ?? []).map((option) => ({ optionId: option.optionId, label: option.label }))
        : [],
  };
}

/**
 * Doc 09 section 64 — the form configuration for an OPEN Job: the Job's own
 * applicationConfig combined with the server resume policy (Doc 10 section 46).
 */
export function toPublicApplicationForm(applicationConfig) {
  const config = applicationConfig ?? {};
  const phoneEnabled = config.phone?.enabled === true;
  const messageEnabled = config.message?.enabled === true;
  const storedMaxLength = config.message?.maxLength;
  return {
    phone: {
      enabled: phoneEnabled,
      // A field is never required while disabled (Doc 10 section 44).
      required: phoneEnabled && config.phone?.required === true,
    },
    message: {
      enabled: messageEnabled,
      required: messageEnabled && config.message?.required === true,
      // Doc 10 section 45 — default and ceiling 5000.
      maxLength:
        Number.isInteger(storedMaxLength) && storedMaxLength >= 1 && storedMaxLength <= 5000 ? storedMaxLength : 5000,
    },
    resume: {
      required: RESUME_UPLOAD_POLICY.required,
      maxBytes: RESUME_UPLOAD_POLICY.maxBytes,
      allowedExtensions: [...RESUME_UPLOAD_POLICY.allowedExtensions],
    },
    screeningQuestions: (config.screeningQuestions ?? []).map(toPublicScreeningQuestion),
  };
}

/**
 * Doc 09 sections 63-65 — GET /api/v1/jobs/:jobSlug.
 *
 * An OPEN Job carries its application form. A CLOSED Job carries
 * `applicationForm: null`, so the frontend cannot reconstruct an active form.
 */
export function toPublicJobDetail(job, applicationStatus) {
  if (applicationStatus !== 'OPEN' && applicationStatus !== 'CLOSED') {
    throw new PublicJobMappingError('not_public');
  }
  return {
    ...publicSummary(job),
    description: typeof job.description === 'string' ? job.description : '',
    responsibilities: stringList(job.responsibilities),
    requirements: stringList(job.requirements),
    preferredQualifications: stringList(job.preferredQualifications),
    publishedAt: toIsoOrNull(job.publishedAt),
    closesAt: toIsoOrNull(job.closesAt),
    applicationStatus,
    applicationForm: applicationStatus === 'OPEN' ? toPublicApplicationForm(job.applicationConfig) : null,
  };
}
