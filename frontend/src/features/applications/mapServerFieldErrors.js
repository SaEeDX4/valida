/**
 * Maps canonical API field paths onto the keys the Apply form uses.
 *
 * Doc 09 defines the server's field paths — fullName, email, phone, message,
 * resume and screeningAnswers.<questionId>. The form keys its screening
 * controls as `screening:<questionId>`, so a raw server path would attach to
 * nothing and the validation summary would link to an id that does not exist.
 *
 * The mapping is deliberately EXPLICIT. Server paths are not turned into DOM
 * ids by string manipulation: an unknown or malformed path is reported as a
 * form-level failure instead, so a future server field can never produce a
 * broken anchor or an error attached to the wrong control.
 *
 * A screening path must also name a question that EXISTS in the Job currently
 * rendered. Syntactic validity is not enough: if the backend drifts, or a Job's
 * configuration changes between page load and submission, an id the form never
 * rendered would otherwise produce a validation-summary link to
 * #screening-<unknown> — an anchor pointing at nothing. The caller therefore
 * supplies the active question ids and anything outside that set is not mapped.
 */

/** Field paths that map one-to-one onto form keys. */
const DIRECT_FIELDS = new Set(['fullName', 'email', 'phone', 'message', 'resume']);

const SCREENING_PREFIX = 'screeningAnswers.';

/**
 * Translates one field path, or returns null when it cannot be mapped safely.
 *
 * `screeningQuestionIds` is the set of question ids the active Job actually
 * configures. A screening path is mapped only when its id is in that set.
 */
export function mapServerFieldPath(field, screeningQuestionIds = new Set()) {
  if (typeof field !== 'string' || !field.trim()) return null;

  if (DIRECT_FIELDS.has(field)) return field;

  if (field.startsWith(SCREENING_PREFIX)) {
    const questionId = field.slice(SCREENING_PREFIX.length).trim();
    // "screeningAnswers." on its own identifies no control.
    if (!questionId) return null;
    // The question must exist in the form on screen, or the summary link would
    // point at an element that was never rendered.
    if (!screeningQuestionIds.has(questionId)) return null;
    return `screening:${questionId}`;
  }

  return null;
}

/**
 * Converts server field errors into control-attached form errors.
 *
 * Pass the active Job's screening question ids so screening paths can be
 * checked against the form actually on screen.
 *
 * Unmappable paths are dropped here; the caller treats an entirely empty result
 * as a form-level failure, so nothing is silently lost. When some paths map and
 * others do not, the mappable ones are still attached to their controls — a
 * single unknown path must not discard real, actionable field errors.
 *
 * Server-supplied messages are used only when they are plain strings; anything
 * else falls back to safe generic wording. Raw internal paths are never shown.
 */
export default function mapServerFieldErrors(entries, { screeningQuestionIds = [] } = {}) {
  const fieldErrors = {};
  const allowedIds = new Set(
    (Array.isArray(screeningQuestionIds) ? screeningQuestionIds : []).filter(
      (id) => typeof id === 'string' && id.trim(),
    ),
  );

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;

    const key = mapServerFieldPath(entry.field, allowedIds);
    if (!key) return;

    fieldErrors[key] =
      typeof entry.message === 'string' && entry.message.trim()
        ? entry.message
        : 'This field needs to be corrected.';
  });

  return fieldErrors;
}
