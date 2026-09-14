import { apiRequest, ApiError, API_ERROR_TYPE } from '../../../services/api/apiClient.js';

/**
 * Applications API module (Doc 09 sections 71-90).
 *
 * POST /api/v1/jobs/:jobSlug/applications, multipart/form-data.
 */

/**
 * Generates one high-entropy Idempotency-Key for one logical submission
 * (Doc 09 sections 74-76: 16-128 printable characters, no whitespace).
 *
 * crypto.randomUUID is preferred; the fallback uses crypto.getRandomValues and
 * is still cryptographically random. Math.random is never used for this.
 */
export function createIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Submits one application.
 *
 * The caller supplies the FormData and the Idempotency-Key, because key
 * lifecycle is a submission-flow decision (a transport retry of the same
 * logical submission must reuse the key) rather than a transport detail.
 *
 * Content-Type is deliberately NOT set: the browser must generate the
 * multipart boundary itself. Setting it manually produces a body the server
 * cannot parse.
 */
export async function submitApplication(jobSlug, formData, { idempotencyKey, signal } = {}) {
  const result = await apiRequest(`/api/v1/jobs/${encodeURIComponent(jobSlug)}/applications`, {
    method: 'POST',
    body: formData,
    headers: { 'Idempotency-Key': idempotencyKey },
    signal,
  });

  /*
   * The canonical success contract is checked before this resolves.
   *
   * A bare `{ success: true, data: {} }` must NEVER reach the success screen:
   * telling a candidate their application was received when the server did not
   * say so is the single worst failure this milestone can have. Doc 09 sections
   * 124-126 define the candidate-facing result — status RECEIVED plus the job
   * it belongs to — for both the 201 first submission and the 200 idempotent
   * replay, whose body is the same apart from meta.replayed.
   *
   * Anything else is a malformed response, not a success.
   */
  if (!isValidApplicationResult(result.data)) {
    throw new ApiError({
      type: API_ERROR_TYPE.MALFORMED,
      message: 'The server response could not be read.',
      requestId: result.requestId ?? null,
    });
  }

  return result;
}

/** Minimum canonical candidate-facing success payload (Doc 09 sections 124-126). */
export function isValidApplicationResult(data) {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
  if (data.status !== 'RECEIVED') return false;

  const job = data.job;
  if (typeof job !== 'object' || job === null || Array.isArray(job)) return false;
  if (typeof job.slug !== 'string' || !job.slug.trim()) return false;
  if (typeof job.title !== 'string' || !job.title.trim()) return false;

  /*
   * submittedAt is part of the canonical candidate-facing payload (Doc 09
   * sections 125-126), so a response without a usable timestamp is not the
   * defined success result. It must be a parseable instant, not merely a
   * non-empty string.
   *
   * No public Application ID is required: the contract deliberately does not
   * expose one, and demanding it would reject valid responses.
   */
  if (!isIsoUtcTimestamp(data.submittedAt)) return false;

  return true;
}

/**
 * Canonical ISO-8601 UTC instant, e.g. 2026-09-10T18:45:00.000Z
 *
 * Date.parse alone is far too permissive: it happily accepts "September 10,
 * 2026", "09/10/2026" and a date-only "2026-09-10", none of which is the
 * timestamp form the API contract defines. So the syntax is checked first, and
 * the value is then round-tripped to reject inputs that look right but are not
 * real instants — month 13, day 32, hour 24, 30 February.
 *
 * Fractional seconds are optional; the trailing Z is not, because the contract
 * is UTC and an offset-bearing or naive timestamp is a different thing.
 */
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export function isIsoUtcTimestamp(value) {
  if (typeof value !== 'string' || !ISO_UTC_PATTERN.test(value)) return false;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;

  /*
   * Round-trip guard. JavaScript normalises some impossible values rather than
   * rejecting them — new Date('2026-02-30T00:00:00Z') yields 2 March — so
   * comparing the canonical serialisation back to the input is what actually
   * catches 2026-02-30, 2026-13-01 and hour 24.
   *
   * The input's fractional part is padded to the three digits toISOString()
   * always emits, so a valid ".12Z" is compared as ".120Z" rather than being
   * rejected for a formatting difference.
   */
  const normalised = value.replace(
    /(?:\.(\d{1,3}))?Z$/,
    (_match, fraction) => `.${(fraction ?? '').padEnd(3, '0')}Z`,
  );
  return parsed.toISOString() === normalised;
}
