/**
 * Client-side application validation.
 *
 * UX ONLY (Doc 13, A5 security boundary). These rules exist so a candidate can
 * correct obvious mistakes before submitting. They prove nothing about
 * eligibility, file safety, Job publication or server acceptance. The backend
 * re-validates everything and remains authoritative.
 *
 * Rules mirror the API contract (Doc 09 sections 83-86) so the client does not
 * reject input the server would accept, or vice versa.
 */

export const FULL_NAME_MIN = 2;
export const FULL_NAME_MAX = 120;
export const EMAIL_MAX = 254;
export const PHONE_MIN = 7;
export const PHONE_MAX = 32;

/**
 * Syntactic email check only.
 *
 * Deliberately permissive: it rejects clearly malformed input without
 * pretending to know whether a mailbox exists. SMTP verification is explicitly
 * out of scope (Doc 09 section 84).
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export function validateFullName(raw) {
  const value = (raw ?? '').trim();
  if (!value || value.length < FULL_NAME_MIN || value.length > FULL_NAME_MAX) {
    // One message for every failure mode: the canonical copy does not
    // distinguish empty from too-short (Doc 06 section 135).
    return 'Enter your full name.';
  }
  return null;
}

export function validateEmail(raw) {
  const value = (raw ?? '').trim();
  if (!value) return 'Enter your email address.'; // Doc 06 section 136
  if (value.length > EMAIL_MAX || !EMAIL_PATTERN.test(value)) {
    return 'Enter a valid email address.'; // Doc 06 section 137
  }
  return null;
}

/**
 * Phone is validated only as a bounded length check.
 *
 * No North-America-only regex and no country-format assumption: an
 * international candidate must not be told their real number is invalid. Doc 06
 * section 138 permits the message only where the rule can accurately support it.
 */
export function validatePhone(raw, { required }) {
  const value = (raw ?? '').trim();
  if (!value) return required ? 'This field is required.' : null;
  if (value.length < PHONE_MIN || value.length > PHONE_MAX) return 'Enter a valid phone number.';
  return null;
}

export function validateMessage(raw, { required, maxLength }) {
  const value = raw ?? '';
  if (!value.trim() && required) return 'This field is required.';
  if (typeof maxLength === 'number' && value.length > maxLength) {
    return `Shorten this to ${maxLength} characters or fewer.`;
  }
  return null;
}

import { maxLengthForQuestion } from '../screeningContract.js';

/**
 * Screening answers are validated only against the Job's own configuration.
 *
 * A YES_NO answer is held as a BOOLEAN, not as the words shown on screen.
 * "Yes" and "No" are UI labels; the logical value that travels to the server is
 * true/false (Doc 09 section 67). Keeping the two separate means a label change
 * can never alter the transported value.
 */
export function validateScreeningAnswer(question, rawAnswer) {
  if (question.type === 'YES_NO') {
    if (typeof rawAnswer === 'boolean') return null;
    return question.required ? 'Answer this question to continue.' : null;
  }

  const answer = typeof rawAnswer === 'string' ? rawAnswer.trim() : '';
  if (!answer) return question.required ? 'Answer this question to continue.' : null;

  /*
   * A SINGLE_SELECT answer is an OPTION IDENTIFIER, never the visible label
   * (Doc 10). Comparing against optionId means the answer survives a label
   * rewording, and it means a label submitted in place of an id is rejected
   * here rather than sent to the server. The backend still re-checks.
   */
  if (question.type === 'SINGLE_SELECT' && Array.isArray(question.options)) {
    const optionIds = question.options
      .filter((option) => option && typeof option.optionId === 'string')
      .map((option) => option.optionId);
    if (!optionIds.includes(answer)) return 'Answer this question to continue.';
  }

  // Canonical length ceiling for the type (Doc 09 sections 90-91), read from
  // the shared contract so the input's maxLength and this check cannot diverge.
  const maxLength = maxLengthForQuestion(question);
  if (maxLength !== null && answer.length > maxLength) {
    return `Shorten this to ${maxLength} characters or fewer.`;
  }
  return null;
}

/**
 * Validates the whole form against the Job's applicationForm configuration.
 * Returns a field -> message map; empty means the form may be submitted.
 */
export function validateApplication({ values, applicationForm, resumeError, hasResume }) {
  const errors = {};
  const form = applicationForm ?? {};

  const fullNameError = validateFullName(values.fullName);
  if (fullNameError) errors.fullName = fullNameError;

  const emailError = validateEmail(values.email);
  if (emailError) errors.email = emailError;

  if (form.phone?.enabled) {
    const phoneError = validatePhone(values.phone, { required: Boolean(form.phone.required) });
    if (phoneError) errors.phone = phoneError;
  }

  if (form.message?.enabled) {
    const messageError = validateMessage(values.message, {
      required: Boolean(form.message.required),
      maxLength: form.message.maxLength,
    });
    if (messageError) errors.message = messageError;
  }

  if (form.resume?.required !== false) {
    if (!hasResume) errors.resume = 'Upload your resume to continue.'; // Doc 06 section 139
    else if (resumeError) errors.resume = resumeError;
  } else if (resumeError) {
    errors.resume = resumeError;
  }

  (Array.isArray(form.screeningQuestions) ? form.screeningQuestions : []).forEach((question) => {
    const error = validateScreeningAnswer(question, values.screeningAnswers?.[question.id]);
    if (error) errors[`screening:${question.id}`] = error;
  });

  return errors;
}
