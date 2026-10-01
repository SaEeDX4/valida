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
 * Canonical error codes used so far: B1 (the first six), B3 (the public Jobs
 * API — VALIDATION_FAILED and JOB_NOT_FOUND, Doc 09 sections 21-23, 51, 61,
 * 69) and B4 (resume files — UNSUPPORTED_MEDIA_TYPE, INVALID_RESUME_FILE and
 * FILE_TOO_LARGE, Doc 09 sections 23, 139-141).
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
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  INVALID_RESUME_FILE: 'INVALID_RESUME_FILE',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
};

/**
 * Internal classifications an AppError may carry for the LOG (B4).
 *
 * `reason` and `detected` say why a request was refused — "the .pdf file is
 * really a Windows executable" — which an operator needs and a client must
 * not get. They are never sent. To keep the log value-safe they must be one of
 * the fixed tokens written in this codebase: the constructor drops anything
 * that is not an upper-case token, so a caller cannot route request data
 * (a filename, a field name, a driver message) into a log line through them.
 */
const INTERNAL_TOKEN = /^[A-Z][A-Z0-9_]{0,63}$/;

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
   * @param {string} [options.reason]    Internal classification token. Logged, never sent.
   * @param {string} [options.detected]  Internal token (e.g. the real file format). Logged, never sent.
   * @param {boolean} [options.closeConnection] Ask the error handler to close the
   *   connection after responding — used when the request body was NOT read
   *   (an over-limit upload), so an unread remainder is never processed as a new request.
   *   The close is staged (lib/http/stagedClose.js) so the response is not lost.
   */
  constructor({ status, code, message, cause, fieldErrors, reason, detected, closeConnection }) {
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
    if (typeof reason === 'string' && INTERNAL_TOKEN.test(reason)) this.reason = reason;
    if (typeof detected === 'string' && INTERNAL_TOKEN.test(detected)) this.detected = detected;
    if (closeConnection === true) this.closeConnection = true;
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

export const payloadTooLarge = (cause, { reason, closeConnection } = {}) =>
  new AppError({
    status: 413,
    code: ERROR_CODES.PAYLOAD_TOO_LARGE,
    message: 'The request body is larger than the allowed limit.',
    cause,
    reason,
    closeConnection,
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
export const serviceUnavailable = (cause, { reason, closeConnection } = {}) =>
  new AppError({
    status: 503,
    code: ERROR_CODES.SERVICE_UNAVAILABLE,
    message: 'Service is not ready.',
    cause,
    reason,
    // B4 review r1 (finding 3): a server-side temporary-storage failure in the
    // middle of an upload answers at once, with the request body unread —
    // the connection is closed so that remainder is never processed as a request
    // (closed in stages, B4 r3, so the client still receives this 503).
    closeConnection,
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

/*
 * ---------------------------------------------------------------------------
 * B4 — multipart requests and resume files (Doc 09 sections 73, 94-105,
 * 139-145; user-facing wording from Doc 06 sections 126-128 and 139).
 *
 * File problems are reported on the `resume` field so the Apply form (C3) can
 * show them next to the file control. Every message below is fixed text; no
 * filename, MIME type, field name supplied by the client, size or storage
 * detail is ever interpolated.
 * ---------------------------------------------------------------------------
 */

/** The multipart field that carries the resume — Doc 09 section 94. */
export const RESUME_FIELD = 'resume';

/** Doc 06 section 126. */
export const RESUME_TYPE_MESSAGE = "This file type isn't accepted. Choose a supported resume file.";
/** Doc 06 section 127. */
export const RESUME_TOO_LARGE_MESSAGE = 'This file is larger than the allowed limit. Choose a smaller file.';
/** Doc 06 section 128. */
export const RESUME_PROCESSING_MESSAGE = "We couldn't process this file. Remove it and try another file.";
/** Doc 06 section 139. */
export const RESUME_REQUIRED_MESSAGE = 'Upload your resume to continue.';

/**
 * Doc 09 section 73 — the Apply request must be multipart/form-data. A JSON,
 * urlencoded or text body is an unsupported request media type (Doc 09
 * section 24: 415), not a field error.
 */
export const unsupportedRequestMediaType = () =>
  new AppError({
    status: 415,
    code: ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
    message: 'This request must be sent as multipart form data.',
    reason: 'REQUEST_NOT_MULTIPART',
  });

/** Doc 09 section 140 — an extension or declared MIME type outside the allowlist, or the two disagree. */
export const unsupportedResumeType = ({ reason, detected } = {}) =>
  new AppError({
    status: 415,
    code: ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
    message: RESUME_TYPE_MESSAGE,
    fieldErrors: [{ field: RESUME_FIELD, code: 'UNSUPPORTED_FILE_TYPE', message: RESUME_TYPE_MESSAGE }],
    reason,
    detected,
  });

/** Doc 09 section 139 — the resume exceeds 5 MiB. */
export const resumeTooLarge = ({ reason = 'RESUME_OVER_MAX_BYTES', closeConnection } = {}) =>
  new AppError({
    status: 413,
    code: ERROR_CODES.FILE_TOO_LARGE,
    message: RESUME_TOO_LARGE_MESSAGE,
    fieldErrors: [{ field: RESUME_FIELD, code: 'FILE_TOO_LARGE', message: RESUME_TOO_LARGE_MESSAGE }],
    reason,
    closeConnection,
  });

/**
 * Doc 09 section 141 — extension and MIME look permitted but the content is
 * not a valid file of that type (a renamed executable or image, an arbitrary
 * ZIP, a legacy or macro-enabled Word file, a damaged document, an empty file).
 */
export const invalidResumeFile = ({ reason, detected } = {}) =>
  new AppError({
    status: 422,
    code: ERROR_CODES.INVALID_RESUME_FILE,
    message: RESUME_PROCESSING_MESSAGE,
    fieldErrors: [{ field: RESUME_FIELD, code: 'INVALID_RESUME_FILE', message: RESUME_PROCESSING_MESSAGE }],
    reason,
    detected,
  });

/** Doc 09 section 142 — no resume file in the request. */
export const resumeRequired = ({ reason = 'RESUME_MISSING' } = {}) =>
  new AppError({
    status: 422,
    code: ERROR_CODES.VALIDATION_FAILED,
    message: 'Some information needs to be corrected.',
    fieldErrors: [{ field: RESUME_FIELD, code: 'RESUME_REQUIRED', message: RESUME_REQUIRED_MESSAGE }],
    reason,
  });

/**
 * The multipart body could not be parsed (no boundary, a truncated body, a
 * malformed part header). Distinct wording from the JSON variant above.
 */
export const malformedMultipart = (cause, { reason = 'MULTIPART_MALFORMED' } = {}) =>
  new AppError({
    status: 400,
    code: ERROR_CODES.MALFORMED_REQUEST,
    message: 'The request could not be read as valid multipart form data.',
    cause,
    reason,
  });

/**
 * The client disconnected before the upload finished. The response cannot be
 * delivered; this exists so the failure is logged as a classified 400 and the
 * request is never treated as a successful upload.
 */
export const uploadInterrupted = () =>
  new AppError({
    status: 400,
    code: ERROR_CODES.MALFORMED_REQUEST,
    message: 'The upload was interrupted before it completed.',
    reason: 'CLIENT_ABORTED',
  });
