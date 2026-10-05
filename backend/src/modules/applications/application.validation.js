import { isSyntacticallyValidEmail, normalizeEmail, SCREENING_TEXT_LIMITS } from '../../models/Application.js';
import { buildRequestFingerprint, buildScreeningAnswer } from './application.service.js';

/**
 * Application submission validation — Milestone B5.
 *
 * Governed by 09_BACKEND_API_SPEC.md sections 74-93, 104, 143-146,
 * 10_DATA_MODEL.md sections 81-93 and 114-116, and the user-facing wording of
 * 06_CONTENT_COPY_DECK.md sections 134-140.
 *
 * Three layers, applied in the canonical order of Doc 09 section 109:
 *
 *   validateIdempotencyKeyHeader   the protocol header (before the body is read)
 *   validateCandidateFields        fields every Application has (fullName,
 *                                  email) and the SHAPE of screeningAnswers —
 *                                  needs no Job
 *   validateJobDrivenFields        phone, message and screening answers
 *                                  against the CURRENT Job configuration
 *                                  (Doc 09 section 89: the frontend's question
 *                                  state is not authoritative)
 *
 * Nothing here trusts the client to name anything: every field path in an
 * error is either a fixed field name or `screeningAnswers.<questionId>` built
 * from the SERVER's question identifier, and every message is fixed text — a
 * submitted value is never echoed back (Doc 09 section 148).
 *
 * Character limits count JavaScript string length (UTF-16 code units), the
 * same measure the Application model's `maxlength` validators apply, so a value
 * this module accepts is always one the model accepts.
 */

// ------------------------------------------------------------ transport --

/**
 * The multipart text fields of the Apply request (Doc 09 section 82) and the
 * TRANSPORT cap of each, in UTF-8 bytes, enforced by the B4 parser while
 * streaming. Four bytes per allowed character covers any UTF-8 input with the
 * permitted surrounding whitespace; the character-level business limits below
 * are the real rules. `screeningAnswers` is serialised JSON for at most 20
 * answers of at most 3000 characters (Doc 09 sections 87-91).
 *
 * Total with the 5 MiB file and the 64 KiB multipart allowance: about
 * 5.4 MiB — under the 8 MiB the staged close will drain (lib/http/stagedClose.js).
 */
export const APPLICATION_TEXT_FIELDS = Object.freeze({
  fullName: 120 * 4,
  email: 254 * 4,
  phone: 32 * 4,
  message: 5000 * 4,
  screeningAnswers: 256 * 1024,
});

// ------------------------------------------------------- Idempotency-Key --

/**
 * Doc 09 section 76: a high-entropy printable token of 16-128 characters with
 * no whitespace or control characters — here, visible ASCII only (0x21-0x7E).
 * A UUID v4 (the preferred format, section 74) qualifies. Entropy itself
 * cannot be measured from one value; the length floor excludes trivially
 * short keys. A header sent twice arrives joined with ", " and so contains a
 * space: refused.
 */
export const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{16,128}$/;

/**
 * @param {unknown} value the raw `Idempotency-Key` header value
 * @returns {{ ok: true, key: string } | { ok: false, problem: 'MISSING' | 'INVALID' }}
 */
export function validateIdempotencyKeyHeader(value) {
  if (value === undefined || value === '') return { ok: false, problem: 'MISSING' };
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(value)) return { ok: false, problem: 'INVALID' };
  return { ok: true, key: value };
}

// ---------------------------------------------------------------- texts --

/** Doc 06 sections 134-140, and the approved B4 form wording for unacceptable content. */
export const FIELD_MESSAGES = Object.freeze({
  REQUIRED: 'This field is required.',
  FULL_NAME: 'Enter your full name.',
  EMAIL_REQUIRED: 'Enter your email address.',
  EMAIL_INVALID: 'Enter a valid email address.',
  PHONE_INVALID: 'Enter a valid phone number.',
  TOO_LONG: 'This field is longer than the allowed limit.',
  NOT_ACCEPTED: "This form contains information that isn't accepted.",
  ANSWER_REQUIRED: 'Answer this question to continue.',
});

const fieldError = (field, code, message) => ({ field, code, message });

// eslint-disable-next-line no-control-regex
const SINGLE_LINE_CONTROL = /[\u0000-\u001f\u007f]/;
// Multi-line text keeps tab, line feed and carriage return (Doc 09 section 86:
// meaningful internal newlines are preserved); any other control character is refused.
// eslint-disable-next-line no-control-regex
const MULTI_LINE_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const trimmedOrNull = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

// ----------------------------------------------------- candidate fields --

/**
 * Doc 09 sections 83-84 — the fields every Application has.
 *
 * fullName  required; trimmed; 2-120 characters; any script (no English-only
 *           pattern); no control characters.
 * email     required; trimmed; syntactically valid (the model's structural
 *           rule); at most 254 characters. No mailbox verification.
 *
 * @param {Record<string, string>} fields parsed multipart text fields
 */
export function validateCandidateFields(fields) {
  const fieldErrors = [];

  const fullName = typeof fields.fullName === 'string' ? fields.fullName.trim() : '';
  if (fullName === '') {
    fieldErrors.push(fieldError('fullName', 'REQUIRED', FIELD_MESSAGES.FULL_NAME));
  } else if (SINGLE_LINE_CONTROL.test(fullName)) {
    fieldErrors.push(fieldError('fullName', 'INVALID_CHARACTERS', FIELD_MESSAGES.FULL_NAME));
  } else if (fullName.length < 2) {
    fieldErrors.push(fieldError('fullName', 'TOO_SHORT', FIELD_MESSAGES.FULL_NAME));
  } else if (fullName.length > 120) {
    fieldErrors.push(fieldError('fullName', 'TOO_LONG', FIELD_MESSAGES.FULL_NAME));
  }

  const email = typeof fields.email === 'string' ? fields.email.trim() : '';
  if (email === '') {
    fieldErrors.push(fieldError('email', 'REQUIRED', FIELD_MESSAGES.EMAIL_REQUIRED));
  } else if (email.length > 254 || !isSyntacticallyValidEmail(email)) {
    fieldErrors.push(fieldError('email', 'INVALID_EMAIL', FIELD_MESSAGES.EMAIL_INVALID));
  }

  return { fieldErrors, value: { fullName, email } };
}

// ----------------------------------------------- screening answers shape --

/** Doc 09 section 88 — at most 20 screening questions in Phase 1. */
export const MAX_SCREENING_ANSWERS = 20;
const MAX_QUESTION_ID_LENGTH = 64;

/**
 * Doc 09 sections 87 and 144 — `screeningAnswers` is serialised JSON of the
 * canonical shape `[{ "questionId": "...", "answer": ... }]`.
 *
 * Shape only (no Job needed): an array of at most 20 objects with EXACTLY the
 * keys questionId (a string) and answer (a string, a boolean, or null for "not
 * answered"), each question at most once. Malformed JSON or any other shape is
 * 422 VALIDATION_FAILED on `screeningAnswers` — the parser's own message is
 * never exposed. An absent field is "no answers".
 *
 * @returns {{ fieldErrors: object[], value: Array<{ questionId: string, answer: string | boolean | null }> }}
 */
export function parseScreeningAnswers(raw) {
  if (raw === undefined) return { fieldErrors: [], value: [] };
  const invalid = (code = 'INVALID_SCREENING_ANSWERS') => ({
    fieldErrors: [fieldError('screeningAnswers', code, FIELD_MESSAGES.NOT_ACCEPTED)],
    value: [],
  });

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalid();
  }
  if (!Array.isArray(parsed)) return invalid();
  if (parsed.length > MAX_SCREENING_ANSWERS) return invalid('TOO_MANY_ANSWERS');

  const seen = new Set();
  const value = [];
  for (const item of parsed) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return invalid();
    const keys = Object.keys(item);
    if (keys.length !== 2 || !keys.includes('questionId') || !keys.includes('answer')) return invalid();
    const { questionId, answer } = item;
    if (typeof questionId !== 'string' || questionId.length === 0 || questionId.length > MAX_QUESTION_ID_LENGTH) {
      return invalid();
    }
    if (!(typeof answer === 'string' || typeof answer === 'boolean' || answer === null)) return invalid();
    if (seen.has(questionId)) return invalid('DUPLICATE_ANSWER');
    seen.add(questionId);
    value.push({ questionId, answer });
  }
  return { fieldErrors: [], value };
}

// ------------------------------------------------------ job-driven fields --

/**
 * Doc 09 section 85 — when phone is enabled and supplied: trimmed, 7-32
 * characters, digits plus the usual separators (space + - ( ) . /), at least 7
 * digits. Deliberately international: no North-America-only pattern, no
 * country assumption, no reformatting (Doc 10 section 86).
 */
const PHONE_CHARACTERS = /^[0-9+\-(). /]+$/;
export function isAcceptablePhone(value) {
  if (typeof value !== 'string' || value.length < 7 || value.length > 32) return false;
  if (!PHONE_CHARACTERS.test(value)) return false;
  return (value.match(/[0-9]/g) ?? []).length >= 7;
}

/**
 * Validates one answer against its question.
 *
 * "Not answered" is `null`, or a blank string for a text or single-select
 * question (an unselected <select> submits ""). An answer of the wrong JSON
 * type, or an option that is not one of THIS question's, cannot come from the
 * form: INVALID_ANSWER with the Doc 06 "isn't accepted" wording — never the
 * "answer this question" prompt, which would be wrong for an optional question.
 *
 * @returns {{ answered: boolean, value?: string | boolean, code?: string, message?: string }}
 */
const invalidAnswer = () => ({ answered: false, code: 'INVALID_ANSWER', message: FIELD_MESSAGES.NOT_ACCEPTED });

function checkAnswer(question, answer) {
  if (answer === null) return { answered: false };
  switch (question.type) {
    case 'SHORT_TEXT':
    case 'LONG_TEXT': {
      if (typeof answer !== 'string') return invalidAnswer();
      const text = answer.trim();
      if (text === '') return { answered: false };
      if (MULTI_LINE_CONTROL.test(text)) return { answered: false, code: 'INVALID_CHARACTERS', message: FIELD_MESSAGES.NOT_ACCEPTED };
      if (text.length > SCREENING_TEXT_LIMITS[question.type]) {
        return { answered: false, code: 'TOO_LONG', message: FIELD_MESSAGES.TOO_LONG };
      }
      return { answered: true, value: text };
    }
    case 'YES_NO':
      // Doc 09 section 92 — a JSON boolean; arbitrary strings ("yes", "1") are refused.
      return typeof answer === 'boolean' ? { answered: true, value: answer } : invalidAnswer();
    case 'SINGLE_SELECT':
      // Doc 09 section 93 — the identifier of an option of THIS question.
      if (typeof answer !== 'string') return invalidAnswer();
      if (answer.trim() === '') return { answered: false };
      return (question.options ?? []).some((option) => option.optionId === answer)
        ? { answered: true, value: answer }
        : invalidAnswer();
    default:
      return invalidAnswer();
  }
}

/**
 * Doc 09 sections 85-93 against the Job's CURRENT configuration (BE-031,
 * BE-032).
 *
 * phone / message
 *   disabled — a non-empty value is refused (Doc 09 section 85, "preferred
 *              policy: reject unexpected operational field"); an empty one is
 *              treated as absent.
 *   enabled  — required only when configured; phone must be a plausible
 *              number; message at most the configured maximum (<= 5000),
 *              surrounding whitespace trimmed, internal newlines kept.
 * screening answers
 *   every answer must name a question of THIS Job; each value must match its
 *   question's type; a required question must be answered; text within the
 *   type's limit. Answers are snapshotted with B2's buildScreeningAnswer
 *   (prompt, type and option label as they read now), in the Job's question
 *   order.
 *
 * @param {{ job: object, fields: Record<string, string>, answers: Array<{ questionId: string, answer: unknown }> }} input
 */
export function validateJobDrivenFields({ job, fields, answers }) {
  const config = job.applicationConfig ?? {};
  const fieldErrors = [];

  // Phone.
  let phone = null;
  const phoneValue = trimmedOrNull(fields.phone);
  if (!config.phone?.enabled) {
    if (phoneValue !== null) fieldErrors.push(fieldError('phone', 'FIELD_NOT_ACCEPTED', FIELD_MESSAGES.NOT_ACCEPTED));
  } else if (phoneValue === null) {
    if (config.phone.required) fieldErrors.push(fieldError('phone', 'REQUIRED', FIELD_MESSAGES.REQUIRED));
  } else if (!isAcceptablePhone(phoneValue)) {
    fieldErrors.push(fieldError('phone', 'INVALID_PHONE', FIELD_MESSAGES.PHONE_INVALID));
  } else {
    phone = phoneValue;
  }

  // Message.
  let message = null;
  const messageValue = trimmedOrNull(fields.message);
  if (!config.message?.enabled) {
    if (messageValue !== null) fieldErrors.push(fieldError('message', 'FIELD_NOT_ACCEPTED', FIELD_MESSAGES.NOT_ACCEPTED));
  } else if (messageValue === null) {
    if (config.message.required) fieldErrors.push(fieldError('message', 'REQUIRED', FIELD_MESSAGES.REQUIRED));
  } else if (MULTI_LINE_CONTROL.test(messageValue)) {
    fieldErrors.push(fieldError('message', 'INVALID_CHARACTERS', FIELD_MESSAGES.NOT_ACCEPTED));
  } else if (messageValue.length > Math.min(config.message.maxLength ?? 5000, 5000)) {
    fieldErrors.push(fieldError('message', 'TOO_LONG', FIELD_MESSAGES.TOO_LONG));
  } else {
    message = messageValue;
  }

  // Screening answers.
  const questions = config.screeningQuestions ?? [];
  const byId = new Map(questions.map((question) => [question.questionId, question]));
  const submitted = new Map();
  let unknownReported = false;
  for (const { questionId, answer } of answers) {
    if (!byId.has(questionId)) {
      // The client's identifier is never echoed: one error on the whole field.
      if (!unknownReported) fieldErrors.push(fieldError('screeningAnswers', 'UNKNOWN_QUESTION', FIELD_MESSAGES.NOT_ACCEPTED));
      unknownReported = true;
      continue;
    }
    submitted.set(questionId, answer);
  }
  const screeningAnswers = [];
  for (const question of questions) {
    const path = `screeningAnswers.${question.questionId}`;
    const result = submitted.has(question.questionId) ? checkAnswer(question, submitted.get(question.questionId)) : { answered: false };
    if (result.code) {
      fieldErrors.push(fieldError(path, result.code, result.message));
    } else if (!result.answered) {
      if (question.required) fieldErrors.push(fieldError(path, 'ANSWER_REQUIRED', FIELD_MESSAGES.ANSWER_REQUIRED));
    } else {
      screeningAnswers.push(buildScreeningAnswer(question, result.value));
    }
  }

  return { fieldErrors, value: { phone, message, screeningAnswers } };
}

// ----------------------------------------------------------- idempotency --

/**
 * The request fingerprint of a submission whose key ALREADY has an
 * Application — Doc 10 sections 114-115.
 *
 * Built with B2's buildRequestFingerprint from the same values a first
 * submission would use, interpreted in the EXISTING Application's context: its
 * jobId, and each answer read according to the type the question had when that
 * Application was accepted (typeSnapshot). An identical retry therefore
 * reproduces the stored hash exactly — even if the Job has since closed or its
 * questions changed — while any difference (another Job, name, email, phone,
 * message, answer or resume file) produces a different hash and is a conflict,
 * never a silent replay.
 *
 * @param {object} input
 * @param {{ jobId: unknown, screeningAnswers?: Array<{ questionId: string, typeSnapshot: string }> }} input.existing
 * @param {{ fullName: string, email: string }} input.candidate validated candidate fields
 * @param {Record<string, string>} input.fields raw multipart fields (phone, message as sent)
 * @param {Array<{ questionId: string, answer: unknown }>} input.answers parsed screening answers
 * @param {string} input.resumeChecksumSha256
 */
export function fingerprintAgainstExisting({ existing, candidate, fields, answers, resumeChecksumSha256 }) {
  const typeOf = new Map((existing.screeningAnswers ?? []).map((answer) => [answer.questionId, answer.typeSnapshot]));
  const normalized = [];
  for (const { questionId, answer } of answers) {
    if (answer === null) continue;
    const type = typeOf.get(questionId);
    const entry = { questionId, textValue: null, booleanValue: null, optionId: null };
    if (type === 'YES_NO') {
      entry.booleanValue = typeof answer === 'boolean' ? answer : null;
      if (entry.booleanValue === null) entry.textValue = String(answer);
    } else if (type === 'SINGLE_SELECT') {
      entry.optionId = typeof answer === 'string' ? answer : null;
      if (entry.optionId === null) entry.textValue = String(answer);
    } else {
      // Text questions, and questions the existing Application never answered
      // (which can only produce a mismatch).
      if (typeof answer === 'string') {
        if (answer.trim() === '') continue;
        entry.textValue = answer.trim();
      } else {
        entry.booleanValue = answer;
      }
    }
    normalized.push(entry);
  }
  return buildRequestFingerprint({
    jobId: existing.jobId,
    fullName: candidate.fullName,
    emailNormalized: normalizeEmail(candidate.email),
    phone: trimmedOrNull(fields.phone),
    message: trimmedOrNull(fields.message),
    screeningAnswers: normalized,
    resumeChecksumSha256,
  });
}
