import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { ALLOWED_TRANSITIONS, checkPublishReadiness } from '../modules/jobs/job.rules.js';
import { restrictToValidatedSaves } from './writeGuards.js';

/**
 * Job model — 10_DATA_MODEL.md sections 17-70.
 *
 * DRAFT FLEXIBILITY IS THE CENTRAL DESIGN CONSTRAINT (Doc 10 section 65).
 * A Draft may legitimately be incomplete — no location, employment type,
 * compensation, description, responsibilities or requirements — because real
 * editing workflows save half-finished records. So the schema requires only
 * what is needed to identify the Job at all (title, slug), and the fuller
 * requirements are enforced at PUBLICATION by the Job service.
 *
 * Putting publish requirements in `required: true` would make it impossible to
 * save a draft; putting them nowhere would let an incomplete Job go public.
 * The split is deliberate.
 *
 * LIFECYCLE SAFETY NET. The Job service (modules/jobs/job.service.js) is the
 * intended way to publish, close and archive. The same rules are ALSO checked
 * here on every save, from the shared pure module job.rules.js, so a direct
 * `job.status = 'PUBLISHED'; job.save()` cannot skip them: a new Job starts
 * as DRAFT, only documented transitions are accepted, a PUBLISHED Job must be
 * publish-ready, and publishedAt and a published slug never change. Every
 * write path that would skip these checks — query updates, bulkWrite,
 * insertMany, unvalidated saves — is rejected (see writeGuards.js).
 */

export const WORK_ARRANGEMENTS = ['FULLY_REMOTE', 'HYBRID', 'ON_SITE'];
export const EMPLOYMENT_TYPES = [
  'FULL_TIME', 'PART_TIME', 'FIXED_TERM', 'CONTRACT', 'TEMPORARY', 'INTERNSHIP', 'OTHER',
];
export const COMPENSATION_UNITS = ['HOUR', 'MONTH', 'YEAR'];
export const JOB_STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED'];
export const SCREENING_TYPES = ['SHORT_TEXT', 'LONG_TEXT', 'YES_NO', 'SINGLE_SELECT'];

/** Doc 10 section 21 — lowercase, URL-safe, no leading/trailing hyphen. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Doc 10 sections 48 and 53 — screening question and option identifiers are
 * server-generated UUIDs. Accepted only in the canonical lowercase text form
 * (RFC 9562 layout, versions 1-8), which is what crypto.randomUUID produces,
 * so two spellings of one identifier cannot coexist.
 */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * The identifiers each screening question and option had when its Job was
 * loaded or last saved, keyed by the subdocument itself. Used to refuse an
 * in-place rewrite of an existing identifier while still allowing questions and
 * options to be added, removed or reordered. (Mongoose's isModified cannot
 * tell these apart: adding an option marks every existing option modified.)
 */
const ORIGINAL_SCREENING_IDS = new WeakMap();

function rememberScreeningIds(job) {
  for (const question of job.applicationConfig?.screeningQuestions ?? []) {
    ORIGINAL_SCREENING_IDS.set(question, question.questionId);
    for (const option of question.options ?? []) ORIGINAL_SCREENING_IDS.set(option, option.optionId);
  }
}

/** Doc 10 section 14 — ISO-style uppercase currency code. */
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

const contentListLimit = [
  (items) => !items || items.length <= 50,
  'may contain at most 50 items',
];

/** Doc 10 sections 39-41 — each entry 1-1000 characters. */
const contentItem = {
  type: String,
  trim: true,
  minlength: 1,
  maxlength: 1000,
};

const locationSchema = new mongoose.Schema(
  {
    // Doc 10 sections 25-28. Not required at schema level: a Draft may have no
    // location yet. Publication readiness enforces displayName + countryCode.
    displayName: { type: String, trim: true, maxlength: 160, default: null },
    countryCode: {
      type: String,
      trim: true,
      uppercase: true,
      match: [/^[A-Z]{2}$/, 'countryCode must be two uppercase letters'],
      default: null,
    },
    regionCode: { type: String, trim: true, maxlength: 20, default: null },
    locality: { type: String, trim: true, maxlength: 120, default: null },
  },
  { _id: false },
);

const compensationSchema = new mongoose.Schema(
  {
    // Doc 10 sections 33-37.
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      match: [CURRENCY_PATTERN, 'currency must be a three-letter uppercase code'],
      default: null,
    },
    /*
     * Integer MINOR units — Doc 10 section 13. CAD $35.00 is stored as 3500.
     * Never a float: binary floating point cannot represent every decimal
     * amount exactly, and money must round-trip precisely.
     */
    amountMinor: {
      type: Number,
      min: 0,
      validate: {
        validator: (value) => value === null || value === undefined || Number.isInteger(value),
        message: 'amountMinor must be an integer number of minor units',
      },
      default: null,
    },
    unit: { type: String, enum: [...COMPENSATION_UNITS, null], default: null },
    gross: { type: Boolean, default: null },
  },
  { _id: false },
);

const screeningOptionSchema = new mongoose.Schema(
  {
    // Doc 10 sections 53-54. A server-generated UUID, so the public identifier
    // is never an embedded subdocument _id.
    optionId: {
      type: String,
      required: true,
      default: () => randomUUID(),
      match: [UUID_PATTERN, 'optionId must be a UUID'],
    },
    label: { type: String, required: true, trim: true, minlength: 1, maxlength: 500 },
  },
  { _id: false },
);

const screeningQuestionSchema = new mongoose.Schema(
  {
    // Doc 10 sections 48-55.
    questionId: {
      type: String,
      required: true,
      default: () => randomUUID(),
      match: [UUID_PATTERN, 'questionId must be a UUID'],
    },
    type: { type: String, required: true, enum: SCREENING_TYPES },
    prompt: { type: String, required: true, trim: true, minlength: 1, maxlength: 1000 },
    required: { type: Boolean, required: true, default: false },
    options: {
      type: [screeningOptionSchema],
      default: [],
      validate: [(items) => items.length <= 50, 'a question may have at most 50 options'],
    },
  },
  { _id: false },
);

/*
 * Doc 10 section 55 — type consistency.
 * SINGLE_SELECT needs at least two options; every other type must have none.
 * A one-option select is not a choice, and options on a free-text question
 * would be silently ignored by the form.
 */
screeningQuestionSchema.pre('validate', function enforceTypeConsistency() {
  const options = this.options ?? [];
  if (this.type === 'SINGLE_SELECT') {
    if (options.length < 2) {
      this.invalidate('options', 'SINGLE_SELECT requires at least 2 options');
    }
  } else if (options.length > 0) {
    this.invalidate('options', `${this.type} must not define options`);
  }

  // Doc 10 section 53 — an option identifier is unique within its question.
  const optionIds = options.map((option) => option.optionId);
  if (new Set(optionIds).size !== optionIds.length) {
    this.invalidate('options', 'optionId values must be unique within a question');
  }

  /*
   * Doc 10 sections 48 and 53 — identifiers stay stable while the question or
   * option exists. On a question loaded from the database, the identifier of
   * that question and of its existing options cannot be rewritten in place.
   * (Replacing the list is how a question is removed or added; identifiers the
   * caller carries over are kept exactly.)
   */
  const originalQuestionId = ORIGINAL_SCREENING_IDS.get(this);
  if (originalQuestionId !== undefined && originalQuestionId !== this.questionId) {
    this.invalidate('questionId', 'questionId is stable and cannot be changed');
  }
  options.forEach((option, index) => {
    const originalOptionId = ORIGINAL_SCREENING_IDS.get(option);
    if (originalOptionId !== undefined && originalOptionId !== option.optionId) {
      this.invalidate(`options.${index}.optionId`, 'optionId is stable and cannot be changed');
    }
  });
});

const applicationConfigSchema = new mongoose.Schema(
  {
    // Doc 10 sections 42-47.
    resumeRequired: { type: Boolean, required: true, default: true },
    phone: {
      enabled: { type: Boolean, required: true, default: false },
      required: { type: Boolean, required: true, default: false },
    },
    message: {
      enabled: { type: Boolean, required: true, default: false },
      required: { type: Boolean, required: true, default: false },
      maxLength: { type: Number, required: true, default: 5000, min: 1, max: 5000 },
    },
    screeningQuestions: {
      type: [screeningQuestionSchema],
      default: [],
      validate: [(items) => items.length <= 20, 'at most 20 screening questions are allowed'],
    },
  },
  { _id: false },
);

/*
 * Doc 10 sections 44-45 — a field cannot be required while disabled, because
 * the form would demand an answer it never renders.
 */
/* Doc 10 section 48 — a question identifier is unique within its Job. */
applicationConfigSchema.pre('validate', function enforceUniqueQuestionIds() {
  const questionIds = (this.screeningQuestions ?? []).map((question) => question.questionId);
  if (new Set(questionIds).size !== questionIds.length) {
    this.invalidate('screeningQuestions', 'questionId values must be unique within a Job');
  }
});

applicationConfigSchema.pre('validate', function enforceToggleConsistency() {
  if (this.phone?.required && !this.phone?.enabled) {
    this.invalidate('phone.required', 'phone.required requires phone.enabled');
  }
  if (this.message?.required && !this.message?.enabled) {
    this.invalidate('message.required', 'message.required requires message.enabled');
  }
});

const jobSchema = new mongoose.Schema(
  {
    // Doc 10 sections 19-20.
    title: { type: String, required: true, trim: true, minlength: 3, maxlength: 160 },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 120,
      match: [SLUG_PATTERN, 'slug must be lowercase, URL-safe and hyphen-separated'],
    },
    // Doc 10 section 23 — internal only; never exposed publicly.
    internalOccupationalReference: { type: String, trim: true, maxlength: 100, default: null },

    location: { type: locationSchema, default: () => ({}) },
    workArrangement: { type: String, enum: [...WORK_ARRANGEMENTS, null], default: null },
    employmentType: { type: String, enum: [...EMPLOYMENT_TYPES, null], default: null },
    schedule: { type: String, trim: true, maxlength: 240, default: null },
    weeklyHours: {
      type: Number,
      default: null,
      // Doc 10 section 32 — strictly greater than 0 (fractional allowed), at most 168.
      validate: {
        validator: (value) => value === null || value === undefined || value > 0,
        message: 'weeklyHours must be greater than 0',
      },
      max: [168, 'weeklyHours must not exceed 168'],
    },
    compensation: { type: compensationSchema, default: () => ({}) },

    description: { type: String, trim: true, maxlength: 10000, default: '' },
    responsibilities: { type: [contentItem], default: [], validate: contentListLimit },
    requirements: { type: [contentItem], default: [], validate: contentListLimit },
    preferredQualifications: { type: [contentItem], default: [], validate: contentListLimit },

    applicationConfig: { type: applicationConfigSchema, default: () => ({}) },

    // Doc 10 sections 56-62.
    status: { type: String, required: true, enum: JOB_STATUSES, default: 'DRAFT' },
    publishedAt: { type: Date, default: null },
    closesAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
  },
  {
    // Doc 10 section 12 — createdAt / updatedAt as BSON dates.
    timestamps: true,
    // Reject unknown keys instead of silently discarding them, so a typo in a
    // write path fails loudly rather than losing data.
    strict: 'throw',
    minimize: false,
  },
);

/*
 * Persisted lifecycle state, captured when a document is loaded or saved, so
 * the validation hook below can compare the proposed change with what is
 * actually stored rather than with an in-memory value the caller may have set.
 */
function rememberPersistedLifecycle() {
  this.$locals.persisted = { status: this.status, publishedAt: this.publishedAt ?? null };
  rememberScreeningIds(this);
}
jobSchema.post('init', rememberPersistedLifecycle);
jobSchema.post('save', rememberPersistedLifecycle);

jobSchema.pre('validate', function enforceLifecycle() {
  const persisted = this.$locals.persisted;

  // Doc 10 sections 57-58 — every Job begins as a DRAFT.
  if (this.isNew && this.status !== 'DRAFT') {
    this.invalidate('status', 'a new Job starts as DRAFT; publish it through the Job service');
  }

  // Doc 10 section 58 — only the documented transitions; ARCHIVED is terminal.
  if (!this.isNew && persisted && this.isModified('status') && this.status !== persisted.status) {
    if (!ALLOWED_TRANSITIONS[persisted.status]?.includes(this.status)) {
      this.invalidate('status', `transition ${persisted.status} -> ${this.status} is not permitted`);
    }
  }

  // Doc 10 section 64 — a PUBLISHED Job is always publish-ready, including
  // after later edits, and it always carries its first-publication date.
  if (this.status === 'PUBLISHED') {
    for (const field of checkPublishReadiness(this).missing) {
      this.invalidate(field.includes(' ') ? 'status' : field, `${field} is required while PUBLISHED`);
    }
    if (!(this.publishedAt instanceof Date)) {
      this.invalidate('publishedAt', 'a PUBLISHED Job must record publishedAt');
    }
  }

  // Doc 10 section 59 — the first-publication timestamp is never changed or erased.
  const firstPublished = persisted?.publishedAt ?? null;
  if (!this.isNew && firstPublished && this.isModified('publishedAt')) {
    const current = this.publishedAt instanceof Date ? this.publishedAt.getTime() : null;
    if (current !== firstPublished.getTime()) {
      this.invalidate('publishedAt', 'publishedAt records the first publication and cannot be changed');
    }
  }

  // Doc 10 section 22 — the slug is immutable once the Job has been published.
  if (!this.isNew && firstPublished && this.isModified('slug')) {
    this.invalidate('slug', 'slug is immutable once the Job has been published');
  }
});

/*
 * A Job is written only through a fully validated document save, so the
 * lifecycle and readiness rules above always run. Query updates, bulkWrite,
 * insertMany and unvalidated saves are rejected before reaching the database.
 */
restrictToValidatedSaves(jobSchema, { model: 'Job' });

export const Job = mongoose.models.Job ?? mongoose.model('Job', jobSchema, 'jobs');
export { jobSchema };
