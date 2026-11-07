import { apiRequest, ApiError, API_ERROR_TYPE } from '../../../services/api/apiClient.js';
import { isUsableJobDetail, isUsableJobListItem } from './jobContract.js';

/**
 * Jobs API module (Doc 09 sections 48-70).
 *
 * The only place in the frontend that knows the Jobs endpoint paths. Pages,
 * components and hooks never call fetch directly.
 *
 * The contract checks live in jobContract.js (C4) and are re-exported here.
 */

export {
  isUsableApplicationForm,
  isUsableJobDetail,
  isUsableJobListItem,
  isValidJobSlug,
  JOB_SLUG_PATTERN,
} from './jobContract.js';

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

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
