import { apiRequest, ApiError, API_ERROR_TYPE } from '../../../services/api/apiClient.js';
import { isUsableHiringMarketList } from '../markets.js';
import {
  isSupportedScreeningType,
  MAX_SCREENING_QUESTIONS,
  isUsableSelectOptionList,
} from '../../applications/screeningContract.js';

/**
 * Jobs API module (Doc 09 sections 48-70).
 *
 * The only place in the frontend that knows the Jobs endpoint paths. Pages,
 * components and hooks never call fetch directly.
 */

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/** Public application states a Job DETAIL may legitimately report (Doc 09 s44). */
const PUBLIC_APPLICATION_STATUS = new Set(['OPEN', 'CLOSED']);

/** Phase 1 resume formats (Doc 09 section 86, Doc 12). Compared lowercased. */
const SUPPORTED_RESUME_EXTENSIONS = new Set(['.pdf', '.docx']);

/** Phase 1 maximum resume size: 5 MiB (Doc 09 section 86). */
const MAX_RESUME_BYTES = 5 * 1024 * 1024;

/** Phase 1 maximum optional message length (Doc 09 section 85). */
const MAX_MESSAGE_LENGTH = 5000;

/**
 * A phone/message toggle block, where present, must be internally consistent:
 * both flags boolean, and never required while disabled.
 */
function isUsableOptionalFieldConfig(config) {
  if (config === undefined || config === null) return true;
  if (!isPlainObject(config)) return false;
  if (config.enabled !== undefined && !isBoolean(config.enabled)) return false;
  if (config.required !== undefined && !isBoolean(config.required)) return false;
  if (config.required === true && config.enabled !== true) return false;
  return true;
}

/**
 * Minimum shape for a usable public list row.
 *
 * A row needs a title to show and a slug to navigate to. Without either it
 * would render an undefined heading or a broken link, so the item is not a
 * usable public row and the response is treated as malformed rather than
 * silently rendering damaged UI.
 *
 * This is a minimum-viability check, not a schema framework: optional fields
 * stay optional and are simply omitted when absent.
 */
function hasUsableJobIdentity(job) {
  return isPlainObject(job) && isNonEmptyString(job.title) && isNonEmptyString(job.slug);
}

/**
 * Minimum shape for a usable row in the public Jobs LIST.
 *
 * GET /api/v1/jobs represents roles currently accepting applications, so a row
 * must state applicationStatus === 'OPEN'. A row that omits the status, or that
 * reports CLOSED, must never appear under the Careers "Open Roles" heading —
 * that would tell a candidate a role is open when the payload does not say so.
 *
 * This is deliberately stricter than the DETAIL contract below: a retained
 * CLOSED Job Detail URL is valid and must keep working, so the two checks are
 * separate rather than one reused rule.
 */
export function isUsableJobListItem(item) {
  return (
    hasUsableJobIdentity(item) &&
    item.applicationStatus === 'OPEN' &&
    isUsableHiringMarketList(item.hiringMarkets)
  );
}

const isBoolean = (v) => typeof v === 'boolean';
const isPositiveFinite = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * A resume configuration the Apply form can render safely.
 *
 * The accepted extensions and the size ceiling are not decoration: they drive
 * the instruction text, the `accept` attribute and the client-side checks. If
 * any of them is missing the form would present an incomplete file contract, so
 * the whole response is treated as malformed instead.
 */
function isUsableResumeConfig(resume) {
  if (!isPlainObject(resume)) return false;

  // Phase 1 always requires exactly one resume (Doc 12). A configuration that
  // says otherwise is not a Phase 1 contract.
  if (resume.required !== true) return false;

  if (!isPositiveFinite(resume.maxBytes)) return false;
  /*
   * The client must never advertise a larger ceiling than the backend accepts:
   * doing so would let a candidate select a file, pass every client check, and
   * then be rejected after upload. A smaller job-specific limit is allowed.
   */
  if (resume.maxBytes > MAX_RESUME_BYTES) return false;

  if (!Array.isArray(resume.allowedExtensions) || resume.allowedExtensions.length === 0) {
    return false;
  }
  /*
   * Only the supported Phase 1 resume formats. A syntactically valid extension
   * is not enough — .exe, .zip, .jpg, .doc and .docm are all well-formed and
   * all unsupported, and accepting them would drive both the `accept`
   * attribute and the client-side check from a contract the backend will not
   * honour. One unsupported entry invalidates the whole list.
   */
  return resume.allowedExtensions.every(
    (ext) => typeof ext === 'string' && SUPPORTED_RESUME_EXTENSIONS.has(ext.toLowerCase()),
  );
}

/** Optional phone/message blocks must be usable when present. */
function isUsableToggleConfig(config, { withMaxLength = false } = {}) {
  if (config === undefined || config === null) return true;
  if (!isPlainObject(config)) return false;
  if (!isBoolean(config.enabled)) return false;
  if (config.required !== undefined && !isBoolean(config.required)) return false;
  if (withMaxLength && config.maxLength !== undefined && !isPositiveFinite(config.maxLength)) {
    return false;
  }
  return true;
}

/** One screening question the form can actually render (Doc 09 sections 66-67). */
function isUsableScreeningQuestion(question) {
  if (!isPlainObject(question)) return false;
  if (!isNonEmptyString(question.id)) return false;
  if (!isSupportedScreeningType(question.type)) return false;
  if (!isNonEmptyString(question.prompt)) return false;
  if (!isBoolean(question.required)) return false;
  if (question.type === 'SINGLE_SELECT') {
    // Canonical option objects: { optionId, label }, 2-50 entries, unique ids.
    if (!isUsableSelectOptionList(question.options)) return false;
  } else if (!Array.isArray(question.options) || question.options.length !== 0) {
    /*
     * Type consistency (Doc 10): only SINGLE_SELECT carries options. Every
     * other type must present an EXPLICIT empty array.
     *
     * Requiring `options: []` rather than merely tolerating its absence is the
     * point: a missing, null or object-valued `options` is an incomplete
     * configuration, and accepting it would let a payload that never states
     * type consistency pass as if it had. A populated array on a text or
     * yes/no question is malformed outright.
     */
    return false;
  }
  return true;
}

/**
 * An application form configuration the Apply page can render safely.
 *
 * Proportional validation, not a schema framework: it checks only what the UI
 * genuinely depends on.
 */
export function isUsableApplicationForm(form) {
  if (!isPlainObject(form)) return false;
  if (!isUsableResumeConfig(form.resume)) return false;

  /*
   * Config consistency (Doc 10). A field cannot be required while disabled:
   * that configuration asks for a value the form will never render, so every
   * submission would fail server validation with no way for the candidate to
   * fix it. Reject the configuration rather than render an unwinnable form.
   */
  if (!isUsableOptionalFieldConfig(form.phone)) return false;
  if (!isUsableOptionalFieldConfig(form.message)) return false;

  // Phase 1 caps the message at 5000 characters; a smaller job-specific limit
  // is allowed. Advertising a larger one would let a candidate type past what
  // the backend accepts.
  if (form.message !== undefined && form.message !== null) {
    const { maxLength } = form.message;
    if (maxLength !== undefined) {
      if (!isPositiveFinite(maxLength) || maxLength > MAX_MESSAGE_LENGTH) return false;
    }
  }
  if (!isUsableToggleConfig(form.phone)) return false;
  if (!isUsableToggleConfig(form.message, { withMaxLength: true })) return false;

  /*
   * screeningQuestions is mandatory for an OPEN form and must be an array.
   * An empty array is valid and means "no questions"; undefined or null is an
   * incomplete contract, not an empty one, and the difference matters because
   * a missing array would silently render a form with no questions when the
   * Job may well define some.
   */
  const questions = form.screeningQuestions;
  if (!Array.isArray(questions)) return false;
  if (questions.length > MAX_SCREENING_QUESTIONS) return false;
  if (!questions.every(isUsableScreeningQuestion)) return false;

  return true;
}

/**
 * Minimum shape for a usable public Job Detail state.
 *
 * Beyond title, slug and a recognised applicationStatus, the form contract is
 * checked against the status (Doc 09 sections 64-65):
 *
 *   OPEN   -> applicationForm must be present AND usable. Accepting an OPEN Job
 *             with a null or broken form would make Apply tell the candidate
 *             the role is closed or unavailable — a false statement about a
 *             role that is in fact open — or render a form whose file rules are
 *             incomplete.
 *   CLOSED -> applicationForm must be null. Anything else is contradictory.
 *
 * A failure here becomes MALFORMED, which the pages render as a retryable error
 * — never an active form, a fake closed state or a not-found claim.
 */
export function isUsableJobDetail(job) {
  // Identity only — deliberately NOT the list check, which is OPEN-only. A
  // retained CLOSED Job Detail URL is valid and must continue to resolve.
  if (!hasUsableJobIdentity(job)) return false;

  /*
   * Hiring markets are optional — a Job that declares none is presented from
   * its own location and compensation fields. But a DECLARED configuration
   * must be usable, because the whole regional presentation rests on it: a
   * malformed market entry could otherwise leave a visitor with no location at
   * all, or with an international fallback that was never actually declared.
   */
  if (!isUsableHiringMarketList(job.hiringMarkets)) return false;
  if (!PUBLIC_APPLICATION_STATUS.has(job.applicationStatus)) return false;

  if (job.applicationStatus === 'OPEN') return isUsableApplicationForm(job.applicationForm);
  return job.applicationForm === null;
}

/**
 * Canonical public slug shape (Doc 09 section 60).
 * Validated client-side purely to avoid issuing a request that cannot succeed;
 * the server remains authoritative.
 */
export const JOB_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidJobSlug(slug) {
  return typeof slug === 'string' && slug.length > 0 && slug.length <= 120 && JOB_SLUG_PATTERN.test(slug);
}

/**
 * GET /api/v1/jobs
 *
 * Returns `{ items, pagination }`. A successful response carrying an empty
 * array is a valid result and is returned as such — the caller distinguishes
 * "no roles" from "could not load", and this module never conflates them.
 *
 * The shape is defensively normalised so a malformed payload cannot crash the
 * Careers page; a response without a usable items array is rejected as an
 * error rather than silently rendered as empty.
 */
export async function getPublishedJobs({ signal } = {}) {
  const { data, requestId } = await apiRequest('/api/v1/jobs', { signal });

  if (!Array.isArray(data.items)) {
    throw new ApiError({
      type: API_ERROR_TYPE.MALFORMED,
      message: 'The list of roles could not be read.',
      requestId,
    });
  }

  /*
   * Contract check. A response whose rows cannot be rendered is malformed, not
   * empty — dropping unusable rows silently would turn a broken payload into
   * "no open roles", which is exactly the conflation this milestone forbids.
   */
  if (!data.items.every(isUsableJobListItem)) {
    throw new ApiError({
      type: API_ERROR_TYPE.MALFORMED,
      message: 'The list of roles could not be read.',
      requestId,
    });
  }

  return {
    items: data.items,
    pagination: isPlainObject(data.pagination) ? data.pagination : null,
    requestId,
  };
}

/**
 * GET /api/v1/jobs/:jobSlug
 *
 * Returns the public Job DTO. An unknown, draft, archived or otherwise
 * nonpublic slug produces a 404 JOB_NOT_FOUND from the server, which surfaces
 * as an ApiError — the caller maps that to the safe "unavailable" state
 * without ever learning which internal state caused it (Doc 09 sections 46, 61).
 */
export async function getPublishedJobBySlug(jobSlug, { signal } = {}) {
  const { data, requestId } = await apiRequest(
    `/api/v1/jobs/${encodeURIComponent(jobSlug)}`,
    { signal },
  );

  // Malformed detail data becomes an error state, never a broken page or a
  // false "unavailable" claim about a role that may well exist.
  if (!isUsableJobDetail(data)) {
    throw new ApiError({
      type: API_ERROR_TYPE.MALFORMED,
      message: 'This role could not be read.',
      requestId,
    });
  }

  return { job: data, requestId };
}
