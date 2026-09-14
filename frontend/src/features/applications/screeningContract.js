/**
 * Canonical Phase 1 screening contract — the single source for these values.
 *
 * Doc 09 sections 67, 88, 90, 91. Kept in one module so the rendering layer,
 * the validation layer and the Job DTO contract check cannot drift apart.
 * The backend remains authoritative; these limits exist so a candidate is told
 * about a problem before submitting rather than after.
 */

export const SCREENING_TYPES = Object.freeze(['SHORT_TEXT', 'LONG_TEXT', 'YES_NO', 'SINGLE_SELECT']);

/** Doc 09 section 88 — maximum questions attached to one Job. */
export const MAX_SCREENING_QUESTIONS = 20;

/** Doc 09 sections 90-91 — answer length ceilings by question type. */
export const SCREENING_TEXT_MAX_LENGTH = Object.freeze({
  SHORT_TEXT: 1000,
  LONG_TEXT: 3000,
});

/** Maximum answer length for a question, or null when length does not apply. */
export function maxLengthForQuestion(question) {
  return SCREENING_TEXT_MAX_LENGTH[question?.type] ?? null;
}

export function isSupportedScreeningType(type) {
  return SCREENING_TYPES.includes(type);
}

/**
 * SINGLE_SELECT option bounds (Doc 10).
 *
 * A single-choice question with fewer than two options is not a choice, and
 * Phase 1 caps the list at 50.
 */
export const MIN_SELECT_OPTIONS = 2;
export const MAX_SELECT_OPTIONS = 50;

/**
 * Canonical option shape: a stable identifier plus display text (Doc 10).
 *
 * The two are deliberately distinct. optionId is what the candidate's answer
 * refers to and what is transmitted; label is display only and may be reworded
 * without changing any stored answer.
 */
export function isUsableSelectOption(option) {
  return (
    typeof option === 'object' &&
    option !== null &&
    !Array.isArray(option) &&
    typeof option.optionId === 'string' &&
    option.optionId.trim().length > 0 &&
    typeof option.label === 'string' &&
    option.label.trim().length > 0
  );
}

/** Validates the whole option list for a SINGLE_SELECT question. */
export function isUsableSelectOptionList(options) {
  if (!Array.isArray(options)) return false;
  if (options.length < MIN_SELECT_OPTIONS || options.length > MAX_SELECT_OPTIONS) return false;
  if (!options.every(isUsableSelectOption)) return false;
  // Duplicate identifiers would make an answer ambiguous.
  const ids = options.map((option) => option.optionId);
  return new Set(ids).size === ids.length;
}
