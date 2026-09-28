/**
 * Canonical response envelopes — 09_BACKEND_API_SPEC.md sections 19-21.
 *
 * Every response the API sends goes through one of these, so the shape the
 * frontend's apiClient validates is produced in exactly one place.
 */

/** { success: true, data, meta: { requestId } } */
export function successEnvelope(data, requestId) {
  return { success: true, data, meta: { requestId } };
}

/**
 * { success: false, error: { code, message }, meta: { requestId } }
 *
 * When field-specific errors exist (Doc 09 section 21) they are added as
 * error.fieldErrors; otherwise the error object keeps exactly its two keys.
 */
export function errorEnvelope({ code, message, fieldErrors }, requestId) {
  const error = { code, message };
  if (Array.isArray(fieldErrors) && fieldErrors.length > 0) error.fieldErrors = fieldErrors;
  return { success: false, error, meta: { requestId } };
}
