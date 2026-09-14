import { API_BASE_URL } from '../../config/env.js';

/**
 * Centralised frontend API boundary (Doc 08 sections 68-80).
 *
 * Owns base URL, request creation, safe response parsing and error
 * normalisation. It contains no page copy, no React, no DOM work and no
 * Careers/Job/Apply presentation decision — those belong to feature modules
 * and components.
 *
 * Native fetch is used deliberately; no HTTP dependency is added.
 */

/** Error categories the UI is allowed to branch on. */
export const API_ERROR_TYPE = {
  /** Request never produced an HTTP response (offline, DNS, CORS, abort). */
  NETWORK: 'NETWORK',
  /** Server responded with a non-2xx status. */
  HTTP: 'HTTP',
  /** A 2xx response whose body could not be parsed or did not match contract. */
  MALFORMED: 'MALFORMED',
};

/**
 * A normalised API failure.
 *
 * Every consumer sees this one shape, so no component has to know whether the
 * failure came from the network stack, an HTTP status or a bad payload.
 *
 * `message` is always a safe, user-presentable string. Stack traces, database
 * errors, storage exceptions and raw server internals are never carried here
 * (Doc 09 section 22, Doc 08 section 121).
 */
export class ApiError extends Error {
  constructor({ type, status = null, code = null, message, fieldErrors = [], requestId = null }) {
    super(message);
    this.name = 'ApiError';
    this.type = type;
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.requestId = requestId;
  }
}

/** Joins the configured base URL with a path without producing a double slash. */
export function buildUrl(path) {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${suffix}`;
}

/** Reads a JSON body without throwing on empty or non-JSON payloads. */
async function readJsonSafely(response) {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Extracts meta.requestId when the server supplied one. */
function readRequestId(body) {
  return isPlainObject(body) && isPlainObject(body.meta) && typeof body.meta.requestId === 'string'
    ? body.meta.requestId
    : null;
}

/**
 * Normalises a server error envelope (Doc 09 sections 20-21).
 *
 * Only known-safe primitives are copied out. A server-supplied message is used
 * when it is a plain string; anything else falls back to a generic message, so
 * a malicious or malformed payload cannot inject arbitrary content into the UI.
 */
function normaliseErrorBody(body, status) {
  const error = isPlainObject(body) && isPlainObject(body.error) ? body.error : {};

  const fieldErrors = Array.isArray(error.fieldErrors)
    ? error.fieldErrors
        .filter((entry) => isPlainObject(entry) && typeof entry.field === 'string')
        .map((entry) => ({
          field: entry.field,
          code: typeof entry.code === 'string' ? entry.code : null,
          message: typeof entry.message === 'string' ? entry.message : null,
        }))
    : [];

  return {
    type: API_ERROR_TYPE.HTTP,
    status,
    code: typeof error.code === 'string' ? error.code : null,
    message:
      typeof error.message === 'string' && error.message.trim()
        ? error.message
        : `Request failed with status ${status}.`,
    fieldErrors,
    requestId: readRequestId(body),
  };
}

/**
 * Performs a request and returns the `data` payload of a success envelope.
 *
 * Throws ApiError for every failure mode. Callers never see a raw Response,
 * a rejected fetch or an unparsed body.
 */
export async function apiRequest(path, { method = 'GET', body, headers = {}, signal } = {}) {
  let response;
  try {
    response = await fetch(buildUrl(path), {
      method,
      headers,
      body,
      signal,
      // Phase 1 has no candidate session; credentials stay off until an
      // authenticated surface exists (Doc 09 section 72).
      credentials: 'same-origin',
    });
  } catch (cause) {
    // No HTTP response at all. This must never be reported as "no results".
    throw new ApiError({
      type: API_ERROR_TYPE.NETWORK,
      message: 'The request could not be completed.',
    });
  }

  const payload = await readJsonSafely(response);

  if (!response.ok) {
    throw new ApiError(normaliseErrorBody(payload, response.status));
  }

  if (!isPlainObject(payload) || payload.success !== true || !isPlainObject(payload.data)) {
    // A 2xx that does not match the canonical envelope is a failure, not an
    // empty result (Doc 09 section 19).
    throw new ApiError({
      type: API_ERROR_TYPE.MALFORMED,
      status: response.status,
      message: 'The server response could not be read.',
      requestId: readRequestId(payload),
    });
  }

  return { data: payload.data, requestId: readRequestId(payload) };
}
