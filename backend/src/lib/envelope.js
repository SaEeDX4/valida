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

/** { success: false, error: { code, message }, meta: { requestId } } */
export function errorEnvelope({ code, message }, requestId) {
  return { success: false, error: { code, message }, meta: { requestId } };
}
