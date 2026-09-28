import { z } from 'zod';
import { SLUG_PATTERN } from '../../models/Job.js';

/**
 * Public Jobs request validation — 09_BACKEND_API_SPEC.md sections 27, 29,
 * 50-52, 60-61; 13_SECURITY_PRIVACY_THREAT_MODEL.md sections 44-46.
 *
 * QUERY PARAMETERS
 *   GET /api/v1/jobs          accepts `page` and `limit` only.
 *   GET /api/v1/jobs/:jobSlug accepts none.
 * Anything else is rejected with 422 VALIDATION_FAILED (Doc 09 section 27:
 * unexpected operational fields are rejected rather than silently accepted),
 * so no parameter — `status`, `includeDrafts`, an operator-shaped key — can
 * reach the query, and no client value ever becomes a MongoDB operator.
 *
 * page   positive whole number, minimum 1, default 1;
 * limit  positive whole number, 1-50, default 20.
 * Each must be ONE plain decimal string of digits: repeated parameters
 * (`?page=1&page=2`), signs, decimals, exponents, whitespace and empty values
 * are all invalid rather than coerced.
 *
 * FIELD ERRORS are built only from the fixed table below. Neither a rejected
 * value nor an unrecognised parameter name is echoed back.
 */

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;

/** Doc 09 section 60 — maximum public slug length. */
export const MAX_SLUG_LENGTH = 120;

const FIELD_ERRORS = Object.freeze({
  page: { field: 'page', code: 'INVALID_PAGE', message: 'page must be a whole number of at least 1.' },
  limit: {
    field: 'limit',
    code: 'INVALID_LIMIT',
    message: `limit must be a whole number from 1 to ${MAX_LIMIT}.`,
  },
  listQuery: {
    field: 'query',
    code: 'UNSUPPORTED_PARAMETER',
    message: 'Only the page and limit query parameters are supported.',
  },
  detailQuery: {
    field: 'query',
    code: 'UNSUPPORTED_PARAMETER',
    message: 'This endpoint does not accept query parameters.',
  },
});

/** A single decimal string, converted to a safe integer within [min, max]. */
const wholeNumber = (min, max) =>
  z
    .string()
    .regex(/^[0-9]+$/)
    .transform(Number)
    .refine((value) => Number.isSafeInteger(value) && value >= min && value <= max);

const listQuerySchema = z
  .object({
    page: wholeNumber(1, Number.MAX_SAFE_INTEGER).optional(),
    limit: wholeNumber(1, MAX_LIMIT).optional(),
  })
  .strict();

/** One entry per problem, in a fixed order (page, limit, then unsupported parameters). */
function fieldErrorsFrom(issues, unknownKeyError) {
  const found = new Set();
  for (const issue of issues) {
    const key = String(issue.path[0] ?? '');
    found.add(issue.code !== 'unrecognized_keys' && (key === 'page' || key === 'limit') ? key : 'query');
  }
  return [
    ...(found.has('page') ? [FIELD_ERRORS.page] : []),
    ...(found.has('limit') ? [FIELD_ERRORS.limit] : []),
    ...(found.has('query') ? [unknownKeyError] : []),
  ].map((entry) => ({ ...entry }));
}

/**
 * @param {Record<string, unknown>} query  req.query (Express 5 "simple" parser)
 * @returns {{ ok: true, value: { page: number, limit: number } } | { ok: false, fieldErrors: object[] }}
 */
export function parseListQuery(query) {
  const result = listQuerySchema.safeParse({ ...(query ?? {}) });
  if (!result.success) {
    return { ok: false, fieldErrors: fieldErrorsFrom(result.error.issues, FIELD_ERRORS.listQuery) };
  }
  return {
    ok: true,
    value: { page: result.data.page ?? DEFAULT_PAGE, limit: result.data.limit ?? DEFAULT_LIMIT },
  };
}

/** The detail endpoint takes no query parameters at all. */
export function parseDetailQuery(query) {
  if (query && Object.keys(query).length > 0) {
    return { ok: false, fieldErrors: [{ ...FIELD_ERRORS.detailQuery }] };
  }
  return { ok: true };
}

/**
 * Doc 09 section 60 — lowercase letters, digits and single hyphens, no
 * leading/trailing hyphen, at most 120 characters. The same pattern the Job
 * model enforces on write, so every stored slug is addressable and nothing
 * else is looked up.
 */
export function isValidPublicSlug(slug) {
  return typeof slug === 'string' && slug.length > 0 && slug.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(slug);
}
