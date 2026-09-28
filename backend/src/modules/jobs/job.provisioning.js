import mongoose from 'mongoose';
import { z } from 'zod';
import {
  Job,
  COMPENSATION_UNITS,
  EMPLOYMENT_TYPES,
  JOB_STATUSES,
  SCREENING_TYPES,
  SLUG_PATTERN,
  UUID_PATTERN,
  WORK_ARRANGEMENTS,
} from '../../models/Job.js';
import { Application } from '../../models/Application.js';
import { REQUIRED_INDEXES, diffIndexes } from '../../db/indexes.js';
import { ALLOWED_TRANSITIONS, checkPublishReadiness } from './job.rules.js';
import { JobLifecycleError, applyJobEdit, archiveJob, closeJob, publishJob } from './job.service.js';
import { UnsupportedWriteError } from '../../models/writeGuards.js';
import { safeErrorSummary } from '../../lib/safeError.js';
import { SUPPORTED_CURRENCIES } from './money.js';
import { publicApplicationStatus } from './job.visibility.js';

/**
 * Controlled server-side Job provisioning — 18_IMPLEMENTATION_ROADMAP.md
 * sections 109-110, 12_CAREERS_APPLICATIONS.md sections 44-47,
 * 15_DEVOPS_DEPLOYMENT.md sections 171-175, 10_DATA_MODEL.md sections 22,
 * 48-59, 64-70, 213.
 *
 * Until the protected Recruitment Admin exists (Release E), this is how a real
 * Job is created and maintained: an operator writes a JOB DEFINITION — a JSON
 * file describing the complete desired state of one Job — and runs
 * `scripts/provision-job.mjs plan` to see what would change, then `apply` to
 * make exactly that change. No public endpoint exists for it (Doc 15 s175),
 * and changing a wage, status, closing date or content never requires editing
 * frontend source (Doc 12 s47).
 *
 * SAFETY PROPERTIES
 *
 * - Validated input. A definition is parsed against a strict schema before any
 *   database access: unknown keys, wrong types, out-of-range values, a
 *   currency without a verified minor-unit exponent, duplicate screening
 *   prompts or option labels are all refused.
 *
 * - One Job per slug, safe to re-run. The slug identifies the Job. `apply`
 *   compares the definition with the stored Job and writes only when something
 *   differs; re-applying the same definition reports `unchanged` and writes
 *   nothing. Slug uniqueness is guaranteed by the database (`slug_unique`), not
 *   by the lookup alone: `apply` refuses to write unless the required jobs
 *   indexes exist, and a concurrent create that loses the race is reported as a
 *   duplicate slug, never as a second Job.
 *
 * - The approved B2 write path only. New Jobs are created with a fully
 *   validated `save()` and always start as DRAFT; edits go through
 *   `applyJobEdit` (the mass-assignment allowlist); lifecycle changes go through
 *   `publishJob` / `closeJob` / `archiveJob`. The Job model's own rules then run
 *   on every save: permitted transitions only, publish readiness, publishedAt
 *   never changed once set, slug immutable once published, screening
 *   identifiers never rewritten in place. Nothing here uses a query update,
 *   bulkWrite or insertMany, and nothing relaxes a write guard.
 *
 * - Intentional lifecycle changes. Publishing, closing, reopening and archiving
 *   are applied only with an explicit confirmation flag, only as ONE documented
 *   transition per run, and publication additionally requires that the
 *   definition declares no `awaitingInput`, that the content is publish-ready,
 *   that no placeholder marker remains and that any closing time is in the
 *   future. The same confirmation is required when an edit changes what the
 *   public sees without a status change — a closesAt that closes an open Job
 *   now, or removes/moves a passed closing time and so reopens it. A Job that
 *   simply expired on schedule and is re-applied unchanged needs nothing: the
 *   passage of time is not an operator action. ARCHIVED is terminal: an
 *   archived Job is never modified.
 *
 * - Truthful outcomes. Every acknowledged write is recorded; a failed step is
 *   reported as certainly not applied only when that is established, otherwise
 *   as unknown. A partial run (created as DRAFT, publication rejected) is
 *   reported as incomplete and nothing is rolled back or deleted; re-applying
 *   the same definition completes it.
 *
 * - No silent material change. When Applications already exist for a Job, a
 *   change to its compensation, hours, work arrangement, location, employment
 *   type, responsibilities or requirements requires a separate explicit
 *   confirmation (Doc 12 sections 41-42).
 *
 * - Stable screening identifiers. Server-generated question/option UUIDs are
 *   preserved across runs: a question in the definition keeps the identifier
 *   of the stored question it names (explicit `questionId`) or, when it gives
 *   none, of the stored question with the same type and prompt; the same for
 *   options by `optionId` or label. A question or option that matches nothing
 *   is new and receives a fresh server-generated UUID. A definition can never
 *   invent an identifier (Doc 10 section 48).
 *
 * - AWAITING INPUT stays unpublished. `awaitingInput` lists the content still
 *   waiting for approval; while it is non-empty the Job cannot be published.
 */

/** Content fields a definition sets, in the order they are compared and reported. */
export const CONTENT_FIELDS = Object.freeze([
  'title',
  'internalOccupationalReference',
  'location',
  'workArrangement',
  'employmentType',
  'schedule',
  'weeklyHours',
  'compensation',
  'description',
  'responsibilities',
  'requirements',
  'preferredQualifications',
  'applicationConfig',
  'closesAt',
]);

/** Fields that may be declared as awaiting approved input. */
export const AWAITABLE_FIELDS = Object.freeze([...CONTENT_FIELDS, 'screeningQuestions']);

/** Doc 12 section 41 — a change to any of these alters the substance of the vacancy. */
export const MATERIAL_FIELDS = Object.freeze([
  'compensation',
  'weeklyHours',
  'workArrangement',
  'location',
  'employmentType',
  'responsibilities',
  'requirements',
]);

/** Text that must never be published as real role content. */
const PLACEHOLDER_MARKERS = [/AWAITING INPUT/i, /\[DEV FIXTURE\]/i, /lorem ipsum/i];

const JOBS_REQUIRED_INDEXES = REQUIRED_INDEXES.filter((index) => index.collection === 'jobs');

// --------------------------------------------------------------- schema --

const trimmedText = (min, max) => z.string().trim().min(min).max(max);
const optionalText = (max) => z.string().trim().min(1).max(max).nullable();
const contentList = z.array(trimmedText(1, 1000)).max(50);
const uuid = z.string().regex(UUID_PATTERN, 'must be a lowercase UUID generated by the server');

const optionDefinition = z
  .object({
    optionId: uuid.optional(),
    label: trimmedText(1, 500),
  })
  .strict();

const questionDefinition = z
  .object({
    questionId: uuid.optional(),
    type: z.enum(SCREENING_TYPES),
    prompt: trimmedText(1, 1000),
    required: z.boolean(),
    options: z.array(optionDefinition).max(50),
  })
  .strict()
  .superRefine((question, ctx) => {
    if (question.type === 'SINGLE_SELECT' && question.options.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'SINGLE_SELECT requires at least 2 options' });
    }
    if (question.type !== 'SINGLE_SELECT' && question.options.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: `${question.type} must not define options` });
    }
    const labels = question.options.map((option) => option.label);
    if (new Set(labels).size !== labels.length) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'option labels must be unique within a question' });
    }
    const ids = question.options.map((option) => option.optionId).filter(Boolean);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'optionId values must be unique within a question' });
    }
  });

const applicationConfigDefinition = z
  .object({
    // Doc 10 section 43 — Phase 1 always requires a resume.
    resumeRequired: z.literal(true),
    phone: z.object({ enabled: z.boolean(), required: z.boolean() }).strict(),
    message: z
      .object({ enabled: z.boolean(), required: z.boolean(), maxLength: z.number().int().min(1).max(5000) })
      .strict(),
    screeningQuestions: z.array(questionDefinition).max(20),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (config.phone.required && !config.phone.enabled) {
      ctx.addIssue({ code: 'custom', path: ['phone', 'required'], message: 'phone.required requires phone.enabled' });
    }
    if (config.message.required && !config.message.enabled) {
      ctx.addIssue({
        code: 'custom',
        path: ['message', 'required'],
        message: 'message.required requires message.enabled',
      });
    }
    const signatures = config.screeningQuestions.map((question) => `${question.type}\u0000${question.prompt}`);
    if (new Set(signatures).size !== signatures.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['screeningQuestions'],
        message: 'two screening questions have the same type and prompt',
      });
    }
    const ids = config.screeningQuestions.map((question) => question.questionId).filter(Boolean);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['screeningQuestions'], message: 'questionId values must be unique' });
    }
  });

export const jobDefinitionSchema = z
  .object({
    slug: z.string().max(120).regex(SLUG_PATTERN, 'must be lowercase letters, digits and single hyphens'),
    /** The desired lifecycle state after this run. */
    status: z.enum(JOB_STATUSES),
    /** Content still waiting for approved input. While non-empty the Job cannot be published. */
    awaitingInput: z
      .array(z.enum(AWAITABLE_FIELDS))
      .refine((items) => new Set(items).size === items.length, 'awaitingInput entries must be unique'),
    /** Human-readable provenance notes. Never stored and never published. */
    notes: z.array(z.string().max(1000)).max(50).optional(),

    title: trimmedText(3, 160),
    internalOccupationalReference: optionalText(100),
    location: z
      .object({
        displayName: optionalText(160),
        countryCode: z.string().regex(/^[A-Z]{2}$/, 'must be two uppercase letters').nullable(),
        regionCode: optionalText(20),
        locality: optionalText(120),
      })
      .strict(),
    workArrangement: z.enum(WORK_ARRANGEMENTS).nullable(),
    employmentType: z.enum(EMPLOYMENT_TYPES).nullable(),
    schedule: optionalText(240),
    weeklyHours: z.number().gt(0).max(168).nullable(),
    compensation: z
      .object({
        currency: z.enum(SUPPORTED_CURRENCIES).nullable(),
        amountMinor: z
          .number()
          .int()
          .min(0)
          .refine(Number.isSafeInteger, 'must be a safe integer number of minor units')
          .nullable(),
        unit: z.enum(COMPENSATION_UNITS).nullable(),
        gross: z.boolean().nullable(),
      })
      .strict(),
    description: z.string().trim().max(10_000),
    responsibilities: contentList,
    requirements: contentList,
    preferredQualifications: contentList,
    applicationConfig: applicationConfigDefinition,
    closesAt: z
      .iso.datetime({ offset: true })
      .transform((value) => new Date(value))
      .nullable(),
  })
  .strict();

/**
 * Validates a parsed JSON value as a Job definition.
 *
 * @returns {{ ok: true, definition: object } | { ok: false, errors: string[] }}
 */
export function parseJobDefinition(raw) {
  const result = jobDefinitionSchema.safeParse(raw);
  if (result.success) return { ok: true, definition: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => `${issue.path.length ? issue.path.join('.') : '(definition)'}: ${issue.message}`),
  };
}

// ------------------------------------------------------ canonical content --

const nullIfEmpty = (value) => (value === undefined || value === null ? null : value);

/**
 * The comparable content of a stored Job (a Mongoose document or a plain
 * object), in exactly the shape a definition resolves to.
 */
export function canonicalJobContent(job) {
  const source = typeof job?.toObject === 'function' ? job.toObject({ depopulate: true }) : job ?? {};
  const config = source.applicationConfig ?? {};
  return {
    title: nullIfEmpty(source.title),
    internalOccupationalReference: nullIfEmpty(source.internalOccupationalReference),
    location: {
      displayName: nullIfEmpty(source.location?.displayName),
      countryCode: nullIfEmpty(source.location?.countryCode),
      regionCode: nullIfEmpty(source.location?.regionCode),
      locality: nullIfEmpty(source.location?.locality),
    },
    workArrangement: nullIfEmpty(source.workArrangement),
    employmentType: nullIfEmpty(source.employmentType),
    schedule: nullIfEmpty(source.schedule),
    weeklyHours: nullIfEmpty(source.weeklyHours),
    compensation: {
      currency: nullIfEmpty(source.compensation?.currency),
      amountMinor: nullIfEmpty(source.compensation?.amountMinor),
      unit: nullIfEmpty(source.compensation?.unit),
      gross: nullIfEmpty(source.compensation?.gross),
    },
    description: source.description ?? '',
    responsibilities: [...(source.responsibilities ?? [])],
    requirements: [...(source.requirements ?? [])],
    preferredQualifications: [...(source.preferredQualifications ?? [])],
    applicationConfig: {
      resumeRequired: config.resumeRequired ?? true,
      phone: { enabled: config.phone?.enabled === true, required: config.phone?.required === true },
      message: {
        enabled: config.message?.enabled === true,
        required: config.message?.required === true,
        maxLength: config.message?.maxLength ?? 5000,
      },
      screeningQuestions: (config.screeningQuestions ?? []).map((question) => ({
        questionId: question.questionId,
        type: question.type,
        prompt: question.prompt,
        required: question.required === true,
        options: (question.options ?? []).map((option) => ({ optionId: option.optionId, label: option.label })),
      })),
    },
    closesAt: source.closesAt instanceof Date ? source.closesAt.toISOString() : null,
  };
}

/**
 * Carries stored screening identifiers over to the definition's questions and
 * options; anything unmatched is new and gets no identifier here (the model
 * generates a UUID on save).
 *
 * @returns {{ ok: true, questions: object[] } | { ok: false, errors: {code: string, message: string}[] }}
 */
export function resolveScreeningQuestions(existingQuestions, desiredQuestions) {
  const errors = [];
  const existing = existingQuestions ?? [];
  const byId = new Map(existing.map((question) => [question.questionId, question]));

  // Explicit identifiers claim their stored question first, so a content
  // match can never take an identifier the definition names elsewhere.
  const claimed = new Set(desiredQuestions.map((question) => question.questionId).filter(Boolean));

  const questions = desiredQuestions.map((desired, index) => {
    const where = `applicationConfig.screeningQuestions.${index}`;
    let match = null;
    if (desired.questionId) {
      match = byId.get(desired.questionId) ?? null;
      if (!match) {
        errors.push({
          code: 'UNKNOWN_QUESTION_ID',
          message:
            `${where}.questionId does not identify a stored question of this Job. Omit questionId for a new ` +
            'question: identifiers are generated by the server.',
        });
      }
    } else {
      match =
        existing.find(
          (stored) =>
            !claimed.has(stored.questionId) && stored.type === desired.type && stored.prompt === desired.prompt,
        ) ?? null;
      if (match) claimed.add(match.questionId);
    }

    const storedOptions = match?.options ?? [];
    const optionsById = new Map(storedOptions.map((option) => [option.optionId, option]));
    const claimedOptions = new Set(desired.options.map((option) => option.optionId).filter(Boolean));
    const options = desired.options.map((option, optionIndex) => {
      if (option.optionId) {
        if (!optionsById.has(option.optionId)) {
          errors.push({
            code: 'UNKNOWN_OPTION_ID',
            message:
              `${where}.options.${optionIndex}.optionId does not identify a stored option of that question. ` +
              'Omit optionId for a new option.',
          });
        }
        return { optionId: option.optionId, label: option.label };
      }
      const stored = storedOptions.find(
        (candidate) => !claimedOptions.has(candidate.optionId) && candidate.label === option.label,
      );
      if (stored) {
        claimedOptions.add(stored.optionId);
        return { optionId: stored.optionId, label: option.label };
      }
      return { optionId: undefined, label: option.label };
    });

    return {
      questionId: match?.questionId,
      type: desired.type,
      prompt: desired.prompt,
      required: desired.required,
      options,
    };
  });

  return errors.length ? { ok: false, errors } : { ok: true, questions };
}

/** The content the definition asks for, with screening identifiers resolved. */
function desiredContent(definition, screeningQuestions) {
  return {
    title: definition.title,
    internalOccupationalReference: definition.internalOccupationalReference,
    location: { ...definition.location },
    workArrangement: definition.workArrangement,
    employmentType: definition.employmentType,
    schedule: definition.schedule,
    weeklyHours: definition.weeklyHours,
    compensation: { ...definition.compensation },
    description: definition.description,
    responsibilities: [...definition.responsibilities],
    requirements: [...definition.requirements],
    preferredQualifications: [...definition.preferredQualifications],
    applicationConfig: {
      resumeRequired: true,
      phone: { ...definition.applicationConfig.phone },
      message: { ...definition.applicationConfig.message },
      screeningQuestions,
    },
    closesAt: definition.closesAt ? definition.closesAt.toISOString() : null,
  };
}

const sameValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/** Converts one desired field to the value the Job model stores. */
function modelValue(field, value) {
  if (field === 'closesAt') return value === null ? null : new Date(value);
  if (field === 'applicationConfig') {
    return {
      resumeRequired: true,
      phone: { ...value.phone },
      message: { ...value.message },
      screeningQuestions: value.screeningQuestions.map((question) => ({
        // An omitted questionId/optionId lets the model generate a UUID.
        ...(question.questionId ? { questionId: question.questionId } : {}),
        type: question.type,
        prompt: question.prompt,
        required: question.required,
        options: question.options.map((option) => ({
          ...(option.optionId ? { optionId: option.optionId } : {}),
          label: option.label,
        })),
      })),
    };
  }
  if (Array.isArray(value)) return [...value];
  if (value && typeof value === 'object') return { ...value };
  return value;
}

function placeholderFields(content) {
  const texts = [
    ['title', [content.title]],
    ['schedule', [content.schedule]],
    ['location', [content.location.displayName]],
    ['description', [content.description]],
    ['responsibilities', content.responsibilities],
    ['requirements', content.requirements],
    ['preferredQualifications', content.preferredQualifications],
    [
      'applicationConfig',
      content.applicationConfig.screeningQuestions.flatMap((question) => [
        question.prompt,
        ...question.options.map((option) => option.label),
      ]),
    ],
  ];
  return texts
    .filter(([, values]) => values.some((value) => typeof value === 'string' && PLACEHOLDER_MARKERS.some((re) => re.test(value))))
    .map(([field]) => field);
}

// ----------------------------------------------------------------- plan --

/**
 * Decides what applying `definition` would do to `current` (null when no Job
 * has the slug). Pure: reads nothing and writes nothing.
 *
 * @param {object} args
 * @param {object | null} args.current            stored Job (document or plain object)
 * @param {object} args.definition                parsed definition
 * @param {Date} args.now                         server time for this run
 * @param {number} [args.applicationCount]        Applications referencing the Job
 */
export function planJobProvisioning({ current, definition, now, applicationCount = 0 }) {
  const refusals = [];
  const currentContent = current ? canonicalJobContent(current) : null;

  const resolution = resolveScreeningQuestions(
    currentContent?.applicationConfig.screeningQuestions ?? [],
    definition.applicationConfig.screeningQuestions,
  );
  if (!resolution.ok) refusals.push(...resolution.errors);
  const desired = desiredContent(definition, resolution.ok ? resolution.questions : []);

  const changes = currentContent
    ? CONTENT_FIELDS.filter((field) => !sameValue(currentContent[field], desired[field]))
    : [...CONTENT_FIELDS];
  const newScreeningIdentifiers = desired.applicationConfig.screeningQuestions.reduce(
    (count, question) => count + (question.questionId ? 0 : 1) + question.options.filter((option) => !option.optionId).length,
    0,
  );

  // Lifecycle: at most one documented transition per run.
  const from = current ? current.status : null;
  const to = definition.status;
  let transition = null;
  if (!current) {
    if (to === 'PUBLISHED') transition = { from: 'DRAFT', to: 'PUBLISHED' };
    else if (to !== 'DRAFT') {
      refusals.push({
        code: 'INVALID_INITIAL_STATUS',
        message: `a new Job starts as DRAFT and can only be published in the same run, not created as ${to}`,
      });
    }
  } else if (from === 'ARCHIVED') {
    if (to !== 'ARCHIVED' || changes.length > 0) {
      refusals.push({ code: 'ARCHIVED_IS_TERMINAL', message: 'this Job is ARCHIVED; an archived Job is never modified' });
    }
  } else if (from !== to) {
    if (ALLOWED_TRANSITIONS[from]?.includes(to)) transition = { from, to };
    else {
      refusals.push({
        code: 'INVALID_TRANSITION',
        message: `${from} -> ${to} is not a permitted lifecycle transition (one documented step per run)`,
      });
    }
  }

  const readiness = checkPublishReadiness({ ...desired, slug: definition.slug });
  if (to === 'PUBLISHED') {
    if (definition.awaitingInput.length > 0) {
      refusals.push({
        code: 'AWAITING_INPUT',
        message: `the definition declares content still AWAITING INPUT (${definition.awaitingInput.join(', ')}); it cannot be PUBLISHED`,
      });
    }
    if (!readiness.ready) {
      refusals.push({ code: 'NOT_PUBLISH_READY', message: `publication requires: ${readiness.missing.join(', ')}` });
    }
    const placeholders = placeholderFields(desired);
    if (placeholders.length > 0) {
      refusals.push({
        code: 'PLACEHOLDER_CONTENT',
        message: `placeholder text must not be published (found in: ${placeholders.join(', ')})`,
      });
    }
    if (transition && desired.closesAt !== null && new Date(desired.closesAt) <= now) {
      refusals.push({
        code: 'CLOSES_AT_NOT_FUTURE',
        message: 'closesAt must be null or in the future when a Job is published or reopened',
      });
    }
  }

  const materialChanges = current ? changes.filter((field) => MATERIAL_FIELDS.includes(field)) : [];

  /*
   * EFFECTIVE PUBLIC STATE, before and after this run, both at the same `now`.
   *
   * A stored transition is not the only way an operator opens or closes a
   * vacancy: editing closesAt on a PUBLISHED Job closes it (a closing time at or
   * before now) or reopens it (removing or moving a passed closing time into the
   * future) with no status change at all. Whatever this run would do to what the
   * public sees therefore needs the same explicit confirmation as a transition.
   *
   * Both sides are evaluated at the same instant with the same stored
   * publishedAt, so a change is reported only when THIS RUN causes it. A Job
   * that expired on schedule since the last run, re-applied unchanged, is
   * CLOSED before and after: no change, no confirmation, no write.
   */
  const publicBefore = current ? publicApplicationStatus(current, now) ?? 'NOT_PUBLIC' : 'NOT_PUBLIC';
  const afterState = {
    status: current && from === 'ARCHIVED' ? 'ARCHIVED' : to,
    publishedAt: current?.publishedAt ?? (to === 'PUBLISHED' ? now : null),
    closesAt: desired.closesAt ? new Date(desired.closesAt) : null,
  };
  const publicAfter = publicApplicationStatus(afterState, now) ?? 'NOT_PUBLIC';
  const effectiveChange =
    publicBefore === publicAfter
      ? null
      : { from: publicBefore, to: publicAfter, cause: transition ? 'lifecycle transition' : 'closesAt' };

  const action = !current ? 'create' : changes.length > 0 || transition ? 'update' : 'unchanged';

  return {
    slug: definition.slug,
    action,
    currentStatus: from,
    desiredStatus: to,
    changes: action === 'unchanged' ? [] : changes,
    materialChanges,
    transition,
    requiresConfirmation: {
      // Any stored transition, and any change this run makes to what the
      // public sees (OPEN / CLOSED / not public), is applied only when confirmed.
      lifecycle: Boolean(transition) || Boolean(effectiveChange),
      materialChange: applicationCount > 0 && materialChanges.length > 0,
    },
    applicationCount,
    newScreeningIdentifiers,
    readiness,
    awaitingInput: [...definition.awaitingInput],
    publicBefore,
    publicAfter,
    effectiveChange,
    refusals,
    desired,
  };
}

// ---------------------------------------------------------------- apply --

/** Summarises a stored Job for the operator — no internal ids except screening UUIDs. */
function describeJob(job, now) {
  const plain = typeof job?.toObject === 'function' ? job.toObject() : job;
  return {
    slug: plain.slug,
    status: plain.status,
    publishedAt: plain.publishedAt instanceof Date ? plain.publishedAt.toISOString() : null,
    closesAt: plain.closesAt instanceof Date ? plain.closesAt.toISOString() : null,
    closedAt: plain.closedAt instanceof Date ? plain.closedAt.toISOString() : null,
    archivedAt: plain.archivedAt instanceof Date ? plain.archivedAt.toISOString() : null,
    publicNow: publicApplicationStatus(plain, now) ?? 'NOT_PUBLIC',
    screeningQuestions: (plain.applicationConfig?.screeningQuestions ?? []).map((question) => ({
      questionId: question.questionId,
      prompt: question.prompt,
      options: (question.options ?? []).map((option) => ({ optionId: option.optionId, label: option.label })),
    })),
  };
}

/** Are the jobs indexes the uniqueness guarantee depends on present? */
async function jobIndexesReady(model) {
  let actual = [];
  try {
    actual = await model.collection.indexes();
  } catch {
    actual = []; // the collection does not exist yet
  }
  const { missing, incompatible } = diffIndexes(JOBS_REQUIRED_INDEXES, { jobs: actual });
  return missing.length === 0 && incompatible.length === 0;
}

const isDuplicateKey = (error) => error?.code === 11000 || error?.cause?.code === 11000;

/**
 * Was this failed write step certainly NOT applied?
 *
 * Only errors that establish it are listed: a rejection raised before anything
 * is sent (Mongoose validation, the Job lifecycle rules, the write guards, a
 * strict-mode refusal), or an explicit server answer that nothing changed (a
 * duplicate-key rejection; an update that matched no document). Anything else —
 * a network error, a timeout, an unreachable server, an unknown error — leaves
 * the outcome UNKNOWN: the request may have reached the database and been
 * applied even though no acknowledgement came back.
 */
function certainlyNotApplied(error) {
  return (
    error instanceof mongoose.Error.ValidationError ||
    error instanceof mongoose.Error.StrictModeError ||
    error instanceof mongoose.Error.DocumentNotFoundError ||
    error instanceof JobLifecycleError ||
    error instanceof UnsupportedWriteError ||
    isDuplicateKey(error)
  );
}

/** Safe, bounded description of a failed step: fixed codes, no driver text. */
function failureDetail(error) {
  if (isDuplicateKey(error)) {
    return [
      {
        code: 'DUPLICATE_SLUG',
        message: 'another Job with this slug was written concurrently; nothing was duplicated — run plan again',
      },
    ];
  }
  if (error instanceof mongoose.Error.ValidationError && error.errors) {
    return Object.values(error.errors).map((detail) => ({
      code: 'MODEL_VALIDATION',
      message: `${detail.path}: ${detail.kind === 'user defined' ? detail.message : detail.kind}`,
    }));
  }
  if (error instanceof JobLifecycleError) {
    return [{ code: error.code, message: error.missing ? `missing: ${error.missing.join(', ')}` : error.code }];
  }
  if (error instanceof mongoose.Error.DocumentNotFoundError) {
    return [
      {
        code: 'JOB_CHANGED_CONCURRENTLY',
        message: 'the stored Job no longer matched (changed or removed by someone else); this step was not applied',
      },
    ];
  }
  if (error instanceof UnsupportedWriteError || error instanceof mongoose.Error.StrictModeError) {
    return [{ code: 'WRITE_REJECTED', message: 'the model rejected this write before it was sent' }];
  }
  const { type, code } = safeErrorSummary(error);
  return [
    {
      code: 'DATABASE_DID_NOT_CONFIRM',
      message: `the database did not confirm this step (${type}${code ? `, ${code}` : ''}); detail withheld`,
    },
  ];
}

/** Guidance printed whenever the final stored state is not simply "as planned". */
export const RECONCILIATION_GUIDANCE =
  'Nothing was rolled back or deleted. Run the same `plan` command to see what is stored now; ' +
  're-running `apply` with the same definition is safe — it writes only what still differs.';

/**
 * Plans and, when `apply` is true, performs the provisioning of one Job.
 *
 * WHAT IS REPORTED IS WHAT IS KNOWN. Every write the database acknowledges is
 * recorded in `writes`; a failed step is recorded in `failure` with
 * `applied: 'no'` only when that is established (see certainlyNotApplied),
 * otherwise `applied: 'unknown'`. The outcome follows from those facts:
 *
 *   planned     plan mode — nothing is ever written;
 *   unchanged   the stored Job already matches — nothing was written;
 *   refused     refused before any write, or the only write was certainly not
 *               applied — nothing was written (`refusals` says why);
 *   created /   every step acknowledged and the stored result read back;
 *   updated
 *   incomplete  at least one write was acknowledged and a later step was
 *               certainly not applied (for example: created as DRAFT, then the
 *               publication was rejected) — nothing is rolled back;
 *   unconfirmed a write's result is unknown, or writes were acknowledged but
 *               the stored result could not be read back.
 *
 * Nothing is ever deleted to "undo" a partial run: the created Job stays, and
 * re-applying the same definition completes it.
 *
 * THROWING. provisionJob throws only while READING, before any write is
 * attempted (the connection check, the stored-Job lookup, the Application
 * count, the index check). From the first write attempt on, every failure is
 * captured in the returned result. A caller may therefore state that nothing
 * was written when provisionJob throws.
 *
 * @returns {Promise<{
 *   outcome: 'planned' | 'unchanged' | 'refused' | 'created' | 'updated' | 'incomplete' | 'unconfirmed',
 *   plan: object,
 *   refusals: {code: string, message: string}[],
 *   writes: string[],
 *   failure: null | { step: string, applied: 'no' | 'unknown', detail: {code: string, message: string}[] },
 *   readback: 'not_needed' | 'confirmed' | 'missing' | 'failed',
 *   job?: object,
 * }>}
 */
export async function provisionJob({
  definition,
  apply = false,
  now = new Date(),
  confirmLifecycle = false,
  confirmMaterialChange = false,
  model = Job,
  applicationModel = Application,
}) {
  if (model.db?.readyState !== 1) {
    throw new Error('provisionJob requires an open database connection');
  }

  // ------------------------------------------------ read phase (may throw) --
  const current = await model.findOne({ slug: { $eq: definition.slug } });
  const applicationCount = current
    ? await applicationModel.countDocuments({ jobId: { $eq: current._id } })
    : 0;
  const plan = planJobProvisioning({ current, definition, now, applicationCount });

  const refusals = [...plan.refusals];
  if (plan.action !== 'unchanged' && !(await jobIndexesReady(model))) {
    refusals.push({
      code: 'INDEXES_MISSING',
      message:
        'the required jobs indexes (slug_unique, public_listing) are missing or incompatible; ' +
        'run `npm run db:indexes:apply` first so slug uniqueness is enforced by the database',
    });
  }

  const result = (outcome, extra = {}) => ({
    outcome,
    plan,
    refusals,
    writes: [],
    failure: null,
    readback: 'not_needed',
    ...extra,
  });

  if (!apply) {
    return result('planned', { job: current ? describeJob(current, now) : undefined });
  }

  // ------------------------------------ confirmations (still before writes) --
  if (plan.requiresConfirmation.lifecycle && !confirmLifecycle) {
    const effect = plan.effectiveChange
      ? `public effect ${plan.effectiveChange.from} -> ${plan.effectiveChange.to} (${plan.effectiveChange.cause})`
      : null;
    const change = plan.transition ? `${plan.transition.from} -> ${plan.transition.to}` : null;
    refusals.push({
      code: 'LIFECYCLE_CONFIRMATION_REQUIRED',
      message: `${[change, effect].filter(Boolean).join('; ')} is applied only with --confirm-lifecycle`,
    });
  }
  if (plan.requiresConfirmation.materialChange && !confirmMaterialChange) {
    refusals.push({
      code: 'MATERIAL_CHANGE_CONFIRMATION_REQUIRED',
      message:
        `${plan.applicationCount} Application(s) exist and the definition changes ` +
        `${plan.materialChanges.join(', ')}; Doc 12 prefers closing this Job and creating a new one. ` +
        'Apply only with --confirm-material-change if this is a genuine correction.',
    });
  }
  if (refusals.length > 0) return result('refused');

  if (plan.action === 'unchanged') {
    return result('unchanged', { job: describeJob(current, now) });
  }

  return executeWrites({ model, definition, current, plan, now, refusals, result });
}

/**
 * The write phase. Never throws: every outcome, including an unexpected error,
 * is returned as a result that states exactly what is known.
 */
async function executeWrites({ model, definition, current, plan, now, refusals, result }) {
  const { desired } = plan;
  const writes = [];
  let failure = null;
  let jobId = current?._id ?? null;

  const attempt = async (step, action) => {
    try {
      await action();
      return true;
    } catch (error) {
      failure = { step, applied: certainlyNotApplied(error) ? 'no' : 'unknown', detail: failureDetail(error) };
      return false;
    }
  };

  try {
    if (!current) {
      // Always saved as DRAFT first: the model refuses any other initial state.
      let job;
      const created = await attempt(`create "${definition.slug}" as DRAFT`, async () => {
        const fields = { slug: definition.slug };
        for (const field of CONTENT_FIELDS) fields[field] = modelValue(field, desired[field]);
        job = new model(fields);
        jobId = job._id;
        await job.save();
      });
      if (created) {
        writes.push(`created "${definition.slug}" as DRAFT`);
        if (plan.transition) {
          const published = await attempt('publish it (DRAFT -> PUBLISHED)', () => publishJob(job, { now }));
          if (published) writes.push('published it (DRAFT -> PUBLISHED)');
        }
      }
    } else {
      const description = plan.transition
        ? `update "${definition.slug}" (${plan.transition.from} -> ${plan.transition.to})`
        : `update "${definition.slug}"`;
      const updated = await attempt(description, async () => {
        const patch = {};
        for (const field of plan.changes) patch[field] = modelValue(field, desired[field]);
        applyJobEdit(current, patch);
        // One validated document save, through the B2 lifecycle services.
        if (plan.transition?.to === 'PUBLISHED') await publishJob(current, { now });
        else if (plan.transition?.to === 'CLOSED') await closeJob(current, { now });
        else if (plan.transition?.to === 'ARCHIVED') await archiveJob(current, { now });
        else await current.save();
      });
      if (updated) writes.push(description.replace(/^update/, 'updated'));
    }
  } catch (error) {
    // Defensive: `attempt` already captures step failures. Anything reaching
    // here happened around a write, so its effect is not established.
    failure = { step: 'provisioning', applied: 'unknown', detail: failureDetail(error) };
  }

  // A write that was certainly not applied, with nothing written before it:
  // the database holds exactly what it held before this run.
  if (failure && failure.applied === 'no' && writes.length === 0) {
    refusals.push(...failure.detail);
    return result('refused', { failure });
  }

  // Read back whatever may have changed, to show the stored state.
  let job;
  let readback = 'not_needed';
  if (jobId && (writes.length > 0 || failure?.applied === 'unknown')) {
    try {
      const stored = await model.findById(jobId).lean();
      if (stored) {
        job = describeJob(stored, now);
        readback = 'confirmed';
      } else {
        readback = 'missing';
      }
    } catch {
      readback = 'failed';
    }
  }

  let outcome;
  if (!failure) outcome = readback === 'confirmed' ? (current ? 'updated' : 'created') : 'unconfirmed';
  else if (failure.applied === 'no') outcome = 'incomplete';
  else outcome = 'unconfirmed';

  return result(outcome, { writes, failure, readback, job });
}
