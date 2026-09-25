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

/** Canonical error codes used by Milestone B1. */
export const ERROR_CODES = {
  API_ROUTE_NOT_FOUND: 'API_ROUTE_NOT_FOUND',
  MALFORMED_REQUEST: 'MALFORMED_REQUEST',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};

export class AppError extends Error {
  /**
   * @param {object} options
   * @param {number} options.status      HTTP status to send.
   * @param {string} options.code        Canonical machine-readable code.
   * @param {string} options.message     SAFE text. Assume a stranger reads it.
   * @param {unknown} [options.cause]    Internal detail. Never sent, never logged.
   */
  constructor({ status, code, message, cause }) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.expected = true; // distinguishes handled errors from crashes
    if (cause !== undefined) this.cause = cause;
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

export const serviceUnavailable = () =>
  new AppError({
    status: 503,
    code: ERROR_CODES.SERVICE_UNAVAILABLE,
    message: 'Service is not ready.',
  });
