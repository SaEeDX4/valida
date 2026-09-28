/**
 * Application error model — 09_BACKEND_API_SPEC.md sections 20-23.
 *
 * Every error the API returns is one of these. `message` is SAFE, user-facing
 * text that may be sent to a client; nothing else may reach a response body.
 *
 * `cause` carries the original technical error. It is retained so a call site
 * can inspect it programmatically, but it is NOT logged: a parser cause quotes
 * the offending fragment of the request body, and a driver cause embeds the
 * connection string. Logs record the canonical code, the status, a bounded
 * error classification and the requestId — see lib/safeError.js.
 */

/**
 * Canonical error codes used so far: B1 (the first six) and B3 (the public
 * Jobs API — VALIDATION_FAILED and JOB_NOT_FOUND, Doc 09 sections 21-23, 51,
 * 61, 69).
 */
export const ERROR_CODES = {
  API_ROUTE_NOT_FOUND: 'API_ROUTE_NOT_FOUND',
  MALFORMED_REQUEST: 'MALFORMED_REQUEST',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
};

export class AppError extends Error {
  /**
   * @param {object} options
   * @param {number} options.status      HTTP status to send.
   * @param {string} options.code        Canonical machine-readable code.
   * @param {string} options.message     SAFE text. Assume a stranger reads it.
   * @param {unknown} [options.cause]    Internal detail. Never sent, never logged.
   * @param {Array<{field: string, code: string, message: string}>} [options.fieldErrors]
   *   Doc 09 section 21. Every entry must be built from fixed, server-side text:
   *   it is sent to the client verbatim.
   */
  constructor({ status, code, message, cause, fieldErrors }) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.expected = true; // distinguishes handled errors from crashes
    if (cause !== undefined) this.cause = cause;
    if (Array.isArray(fieldErrors)) {
      this.fieldErrors = fieldErrors.map(({ field, code: fieldCode, message: fieldMessage }) => ({
        field,
        code: fieldCode,
        message: fieldMessage,
      }));
    }
  }
}

export const notFound = () =>
  new AppError({
    status: 404,
    code: ERROR_CODES.API_ROUTE_NOT_FOUND,
    message: 'The requested API route does not exist.',
  });

export const malformedRequest = (cause) =>
  new AppError({
    status: 400,
    code: ERROR_CODES.MALFORMED_REQUEST,
    message: 'The request body could not be read as valid JSON.',
    cause,
  });

export const payloadTooLarge = (cause) =>
  new AppError({
    status: 413,
    code: ERROR_CODES.PAYLOAD_TOO_LARGE,
    message: 'The request body is larger than the allowed limit.',
    cause,
  });

export const rateLimited = () =>
  new AppError({
    status: 429,
    code: ERROR_CODES.RATE_LIMITED,
    message: 'Too many attempts were received in a short period. Please wait and try again.',
  });

/**
 * Doc 09 section 42. Also used when a required dependency — for the public Jobs
 * API, MongoDB — cannot serve a request (sections 57 and 70): the frontend must
 * see a failure, never an empty success.
 */
export const serviceUnavailable = (cause) =>
  new AppError({
    status: 503,
    code: ERROR_CODES.SERVICE_UNAVAILABLE,
    message: 'Service is not ready.',
    cause,
  });

/** Doc 09 section 21 — the canonical field-validation failure (HTTP 422). */
export const validationFailed = (fieldErrors) =>
  new AppError({
    status: 422,
    code: ERROR_CODES.VALIDATION_FAILED,
    message: 'Some information needs to be corrected.',
    fieldErrors,
  });

/**
 * Doc 09 sections 46, 61 and 69 — one response for an unknown, malformed,
 * Draft, Archived or not-yet-published Job, so a caller cannot tell them apart.
 */
export const jobNotFound = () =>
  new AppError({
    status: 404,
    code: ERROR_CODES.JOB_NOT_FOUND,
    message: "This role isn't available.",
  });
