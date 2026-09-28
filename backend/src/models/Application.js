import mongoose from 'mongoose';
import { WORK_ARRANGEMENTS, EMPLOYMENT_TYPES, COMPENSATION_UNITS, UUID_PATTERN } from './Job.js';
import { restrictToValidatedSaves } from './writeGuards.js';

/**
 * Application model — 10_DATA_MODEL.md sections 71-133.
 *
 * One accepted submission to one Job. Two properties drive the design:
 *
 * 1. HISTORICAL TRUTH. The Job may change after someone applies, so the
 *    Application stores a snapshot of what was shown at submission time
 *    alongside the live jobId (sections 76-78, 89-93). The snapshot is never
 *    rewritten when the Job changes.
 *
 * 2. NO FALSE CLAIMS. Defaults never assert something the system has not done:
 *    resume.scanStatus starts NOT_SCANNED, never CLEAN (section 105), and
 *    notification statuses start PENDING or NOT_REQUIRED, never SENT
 *    (sections 120-121).
 *
 * 3. SUBMISSION HISTORY IS IMMUTABLE (sections 136-138). Once saved, the Job
 *    relationship, job snapshot, candidate submission, screening answers,
 *    original resume metadata, submittedAt and idempotency hashes cannot be
 *    changed by a document save. Operational state (status, notification
 *    delivery, scan result, retention) stays updatable through a validated
 *    save for later milestones (section 139). Every write path that would skip
 *    validation — query updates, bulkWrite, insertMany, unvalidated saves — is
 *    rejected (see writeGuards.js).
 */

export const APPLICATION_STATUSES = ['RECEIVED'];
export const RESUME_SCAN_STATUSES = ['NOT_SCANNED', 'PENDING', 'CLEAN', 'QUARANTINED', 'FAILED'];
export const NOTIFICATION_STATUSES = ['NOT_REQUIRED', 'PENDING', 'SENT', 'FAILED'];
export const RESUME_EXTENSIONS = ['.pdf', '.docx'];
export const RESUME_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
/** Doc 09 / Doc 10 section 101 — Phase 1 maximum resume size, 5 MiB. */
export const RESUME_MAX_BYTES = 5_242_880;
/** Doc 10 section 91 — screening answer length limits by type. */
export const SCREENING_TEXT_LIMITS = { SHORT_TEXT: 1000, LONG_TEXT: 3000 };

const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Doc 09 section 84 / Doc 10 section 225 — a syntactically valid address.
 *
 * Deliberately structural and provider-neutral: one "@", a non-empty local
 * part of at most 64 characters, and a dotted domain, with no whitespace or
 * control characters. Non-ASCII (internationalised) addresses are allowed. No
 * mailbox verification is attempted (Doc 09 section 84).
 */
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
export function isSyntacticallyValidEmail(value) {
  return typeof value === 'string' && EMAIL_PATTERN.test(value) && !CONTROL_CHARACTERS.test(value);
}
const emailValidator = {
  validator: isSyntacticallyValidEmail,
  message: 'must be a syntactically valid email address',
};

/**
 * Submission-history paths — Doc 10 sections 136-138. Never changed after the
 * Application is first saved.
 */
export const SUBMISSION_HISTORY_PATHS = [
  'jobId',
  'jobSnapshot',
  'candidate',
  'screeningAnswers',
  'resume.storageProvider',
  'resume.storageKey',
  'resume.originalFilename',
  'resume.extension',
  'resume.mimeType',
  'resume.sizeBytes',
  'resume.checksumSha256',
  'resume.storedAt',
  'submittedAt',
  'idempotency',
];

/** Doc 10 section 84 — trim + lowercase, and nothing else. */
export function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

const snapshotCompensationSchema = new mongoose.Schema(
  {
    // Doc 10 section 80 — recorded only when the Job published compensation.
    currency: { type: String, default: null, match: [/^[A-Z]{3}$/, 'currency must be a 3-letter uppercase code'] },
    amountMinor: {
      type: Number,
      default: null,
      min: 0,
      validate: {
        validator: (value) => value === null || Number.isInteger(value),
        message: 'amountMinor must be an integer number of minor units',
      },
    },
    unit: { type: String, default: null, enum: [...COMPENSATION_UNITS, null] },
    gross: { type: Boolean, default: null },
  },
  { _id: false },
);

const jobSnapshotSchema = new mongoose.Schema(
  {
    // Doc 10 sections 77-80.
    title: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, trim: true, maxlength: 120 },
    // Section 79 — the public DISPLAY location, as a plain string.
    location: { type: String, default: null, maxlength: 160 },
    workArrangement: { type: String, default: null, enum: [...WORK_ARRANGEMENTS, null] },
    employmentType: { type: String, default: null, enum: [...EMPLOYMENT_TYPES, null] },
    schedule: { type: String, default: null, maxlength: 240 },
    weeklyHours: { type: Number, default: null, max: 168 },
    compensation: { type: snapshotCompensationSchema, default: () => ({}) },
  },
  { _id: false },
);

const candidateSchema = new mongoose.Schema(
  {
    /*
     * Doc 10 section 82 — 2 to 120 characters, trimmed, and explicitly NOT
     * restricted to the English alphabet. A regex like /^[A-Za-z ]+$/ would
     * reject a large share of real names.
     */
    fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    email: { type: String, required: true, trim: true, maxlength: 254, validate: emailValidator },
    /*
     * Section 84 — trim + lowercase only. No provider-specific transformation:
     * stripping dots or +tags would alter addresses that are genuinely
     * distinct at some providers, and would be a claim about identity the
     * system cannot make (section 85).
     */
    emailNormalized: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      validate: emailValidator,
    },
    phone: { type: String, trim: true, maxlength: 32, default: null },
    // Doc 09 section 86 — surrounding whitespace trimmed, internal newlines kept.
    message: { type: String, trim: true, maxlength: 5000, default: null },
  },
  { _id: false },
);

const screeningAnswerSchema = new mongoose.Schema(
  {
    // Doc 10 sections 89-93 — the question text and option label are snapshot
    // at submission so a later Job edit cannot rewrite history.
    // The Job question's identifier, which is a UUID (Doc 10 section 48).
    questionId: { type: String, required: true, match: [UUID_PATTERN, 'questionId must be a UUID'] },
    promptSnapshot: { type: String, required: true, maxlength: 1000 },
    typeSnapshot: {
      type: String,
      required: true,
      enum: ['SHORT_TEXT', 'LONG_TEXT', 'YES_NO', 'SINGLE_SELECT'],
    },
    textValue: { type: String, default: null, maxlength: 3000 },
    booleanValue: { type: Boolean, default: null },
    optionId: { type: String, default: null, match: [UUID_PATTERN, 'optionId must be a UUID'] },
    optionLabelSnapshot: { type: String, default: null, maxlength: 500 },
  },
  { _id: false },
);

/*
 * Each answer type uses its own value field and leaves the others null
 * (sections 91-93). Enforced so a stored answer cannot be ambiguous.
 */
screeningAnswerSchema.pre('validate', function enforceAnswerShape() {
  const type = this.typeSnapshot;

  if (type === 'SHORT_TEXT' || type === 'LONG_TEXT') {
    if (typeof this.textValue !== 'string' || this.textValue.length === 0) {
      this.invalidate('textValue', `${type} requires textValue`);
    } else if (this.textValue.length > SCREENING_TEXT_LIMITS[type]) {
      this.invalidate('textValue', `${type} allows at most ${SCREENING_TEXT_LIMITS[type]} characters`);
    }
    if (this.booleanValue !== null || this.optionId !== null) {
      this.invalidate('textValue', `${type} must leave booleanValue and optionId null`);
    }
  }

  if (type === 'YES_NO') {
    if (typeof this.booleanValue !== 'boolean') {
      this.invalidate('booleanValue', 'YES_NO requires a boolean booleanValue');
    }
    if (this.textValue !== null || this.optionId !== null) {
      this.invalidate('booleanValue', 'YES_NO must leave textValue and optionId null');
    }
  }

  if (type === 'SINGLE_SELECT') {
    if (typeof this.optionId !== 'string' || this.optionId.length === 0) {
      this.invalidate('optionId', 'SINGLE_SELECT requires optionId');
    }
    if (typeof this.optionLabelSnapshot !== 'string' || this.optionLabelSnapshot.length === 0) {
      this.invalidate('optionLabelSnapshot', 'SINGLE_SELECT requires optionLabelSnapshot');
    }
    if (this.textValue !== null || this.booleanValue !== null) {
      this.invalidate('optionId', 'SINGLE_SELECT must leave textValue and booleanValue null');
    }
  }

});

const resumeSchema = new mongoose.Schema(
  {
    // Doc 10 sections 94-108.
    storageProvider: { type: String, required: true, trim: true, maxlength: 60 },
    /*
     * Section 96 — generated server-side and never derived from the
     * candidate's filename, so an uploaded name cannot influence the storage
     * path. Unique across the collection (section 97).
     */
    storageKey: { type: String, required: true, trim: true, maxlength: 512 },
    originalFilename: { type: String, required: true, trim: true, maxlength: 255 },
    extension: { type: String, required: true, enum: RESUME_EXTENSIONS },
    mimeType: { type: String, required: true, enum: RESUME_MIME_TYPES },
    sizeBytes: {
      type: Number,
      required: true,
      min: [1, 'sizeBytes must be greater than 0'],
      max: [RESUME_MAX_BYTES, 'sizeBytes must not exceed the Phase 1 maximum'],
      validate: {
        validator: Number.isInteger,
        message: 'sizeBytes must be an integer',
      },
    },
    checksumSha256: {
      type: String,
      required: true,
      match: [CHECKSUM_PATTERN, 'checksumSha256 must be 64 lowercase hexadecimal characters'],
    },
    /*
     * Section 105 — NOT_SCANNED until a real scanning integration reports
     * otherwise. Defaulting to CLEAN would assert a security property nothing
     * has verified.
     */
    scanStatus: { type: String, required: true, enum: RESUME_SCAN_STATUSES, default: 'NOT_SCANNED' },
    // Section 107 — set only when an actual scan attempt happened.
    scanCheckedAt: { type: Date, default: null },
    /*
     * Section 108 — a Date, set when the object was durably accepted into
     * private storage. Required: an Application is only accepted after storage
     * succeeds (section 106), so a record without it would claim a stored file
     * that may not exist.
     */
    storedAt: { type: Date, required: true },
  },
  { _id: false },
);

const notificationChannelSchema = new mongoose.Schema(
  {
    // Doc 10 sections 118-122.
    status: { type: String, required: true, enum: NOTIFICATION_STATUSES, default: 'PENDING' },
    attemptCount: { type: Number, required: true, default: 0, min: 0 },
    lastAttemptAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    /*
     * Section 122 — a SAFE operational classification only. Never a provider
     * secret, a full provider response or any part of the candidate's email.
     */
    lastErrorCode: { type: String, default: null, maxlength: 80 },
  },
  { _id: false },
);

const applicationSchema = new mongoose.Schema(
  {
    // Doc 10 sections 73-75.
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
    jobSnapshot: { type: jobSnapshotSchema, required: true },
    candidate: { type: candidateSchema, required: true },
    screeningAnswers: {
      type: [screeningAnswerSchema],
      default: [],
      validate: [(items) => items.length <= 20, 'at most 20 screening answers are allowed'],
    },
    resume: { type: resumeSchema, required: true },

    // Section 109 — RECEIVED is the only Phase 1 status. Later recruitment
    // stages are added in a controlled schema update, not invented now.
    status: { type: String, required: true, enum: APPLICATION_STATUSES, default: 'RECEIVED' },

    idempotency: {
      // Section 112 — a hash of the client key; the raw key is not retained.
      keyHash: { type: String, required: true, trim: true, maxlength: 128 },
      // Sections 114-116 — a fingerprint of the canonical submission content,
      // never a second copy of the candidate payload.
      requestFingerprintHash: { type: String, required: true, trim: true, maxlength: 128 },
    },

    notifications: {
      internal: { type: notificationChannelSchema, default: () => ({ status: 'PENDING', attemptCount: 0 }) },
      candidateAcknowledgement: {
        type: notificationChannelSchema,
        // Section 121 — NOT_REQUIRED unless acknowledgement is enabled. B6
        // owns delivery; nothing here may claim a message was sent.
        default: () => ({ status: 'NOT_REQUIRED', attemptCount: 0 }),
      },
    },

    // Sections 123-124 — the business timestamp, distinct from createdAt.
    submittedAt: { type: Date, required: true, default: () => new Date() },

    /*
     * Sections 125-126 — structure only. Both values stay null until a real
     * retention policy is approved; inventing "30 days" would be a privacy
     * claim nobody has made.
     */
    retention: {
      policyVersion: { type: String, default: null, maxlength: 40 },
      retainUntil: { type: Date, default: null },
    },
  },
  {
    timestamps: true,
    strict: 'throw',
    minimize: false,
  },
);

/* One answer per question: a duplicate questionId would make the record ambiguous. */
applicationSchema.pre('validate', function enforceOneAnswerPerQuestion() {
  const questionIds = (this.screeningAnswers ?? []).map((answer) => answer.questionId);
  if (new Set(questionIds).size !== questionIds.length) {
    this.invalidate('screeningAnswers', 'each question may be answered at most once');
  }
});

/*
 * emailNormalized is always DERIVED from email (section 84), never taken from
 * the caller, so the two cannot disagree. Only on creation: afterwards the
 * candidate submission is immutable.
 */
applicationSchema.pre('validate', function deriveNormalizedEmail() {
  if (this.isNew && typeof this.candidate?.email === 'string') {
    this.candidate.emailNormalized = normalizeEmail(this.candidate.email);
  }
});

/* Sections 136-138 — a saved submission's history cannot be rewritten by save. */
applicationSchema.pre('validate', function protectSubmissionHistory() {
  if (this.isNew) return;
  for (const path of SUBMISSION_HISTORY_PATHS) {
    if (this.isModified(path)) {
      this.invalidate(path, `${path} is part of the submission history and cannot be changed`);
    }
  }
});

/*
 * Written only through a fully validated document save, so the history rule
 * above and every schema limit (enums, attemptCount >= 0, ...) always apply.
 */
restrictToValidatedSaves(applicationSchema, { model: 'Application' });

export const Application =
  mongoose.models.Application ?? mongoose.model('Application', applicationSchema, 'applications');
export { applicationSchema };
