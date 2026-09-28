import { describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Job, UUID_PATTERN } from '../src/models/Job.js';
import {
  Application, normalizeEmail, RESUME_MAX_BYTES, SUBMISSION_HISTORY_PATHS, isSyntacticallyValidEmail,
} from '../src/models/Application.js';
import { UnsupportedWriteError } from '../src/models/writeGuards.js';
import { publishJob, closeJob, applyJobEdit } from '../src/modules/jobs/job.service.js';

/**
 * Model validation — Doc 10.
 *
 * These run without a database: Mongoose validates documents offline, so field
 * rules, enums, limits and defaults are provable here. Persistence and unique
 * indexes are NOT provable offline and are covered by tests/db.
 */
const validate = (doc) => doc.validate().then(() => null, (error) => error);
const errorsOf = async (doc) => Object.keys((await validate(doc))?.errors ?? {});

/* Screening identifiers are UUIDs (Doc 10 sections 48 and 53). */
const Q1 = '0c1b7a52-3f6e-4b5c-9d21-7e8f9a0b1c2d';
const Q2 = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';
const O1 = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const jobFields = (overrides = {}) => ({
  title: 'Cybersecurity Specialist',
  slug: 'cybersecurity-specialist',
  ...overrides,
});

const resumeFields = (overrides = {}) => ({
  storageProvider: 'S3_COMPATIBLE',
  storageKey: 'resumes/2026/abc123',
  originalFilename: 'jane-doe-cv.pdf',
  extension: '.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 102_400,
  checksumSha256: 'a'.repeat(64),
  // Required from B2 (Doc 10 section 108): the storage step's acceptance time.
  storedAt: new Date('2026-09-20T10:00:00.000Z'),
  ...overrides,
});

const applicationFields = (overrides = {}) => ({
  jobId: new mongoose.Types.ObjectId(),
  jobSnapshot: { title: 'Cybersecurity Specialist', slug: 'cybersecurity-specialist' },
  candidate: { fullName: 'Jane Doe', email: 'Jane@Example.com' },
  resume: resumeFields(),
  idempotency: { keyHash: 'k'.repeat(64), requestFingerprintHash: 'f'.repeat(64) },
  ...overrides,
});

describe('Job — draft flexibility (Doc 10 section 65)', () => {
  it('accepts a minimal draft with only title and slug', async () => {
    expect(await validate(new Job(jobFields()))).toBeNull();
  });

  it('defaults status to DRAFT and applicationConfig sensibly', () => {
    const job = new Job(jobFields());
    expect(job.status).toBe('DRAFT');
    expect(job.applicationConfig.resumeRequired).toBe(true);
    expect(job.applicationConfig.message.maxLength).toBe(5000);
    expect(job.applicationConfig.screeningQuestions).toEqual([]);
    expect(job.publishedAt).toBeNull();
  });

  it.each([
    ['location', 'location.displayName'],
    ['employmentType', 'employmentType'],
    ['compensation', 'compensation.currency'],
  ])('allows an incomplete %s while drafting', async (_label, path) => {
    const job = new Job(jobFields());
    expect(await validate(job)).toBeNull();
    expect(job.get(path)).toBeFalsy();
  });
});

describe('Job — field validation', () => {
  it.each([
    ['title too short', { title: 'ab' }, 'title'],
    ['title too long', { title: 'x'.repeat(161) }, 'title'],
    ['slug with underscore', { slug: 'bad_slug' }, 'slug'],
    ['slug with double hyphen', { slug: 'bad--slug' }, 'slug'],
    ['slug trailing hyphen', { slug: 'bad-' }, 'slug'],
    ['slug with spaces', { slug: 'bad slug' }, 'slug'],
    ['slug leading hyphen', { slug: '-bad' }, 'slug'],
    ['slug too long', { slug: 'a'.repeat(121) }, 'slug'],
    ['unknown workArrangement', { workArrangement: 'REMOTE_ISH' }, 'workArrangement'],
    ['unknown employmentType', { employmentType: 'GIG' }, 'employmentType'],
    ['weeklyHours zero', { weeklyHours: 0 }, 'weeklyHours'],
    ['weeklyHours over 168', { weeklyHours: 169 }, 'weeklyHours'],
    ['countryCode too long', { location: { countryCode: 'CAN' } }, 'location.countryCode'],
    ['description too long', { description: 'x'.repeat(10001) }, 'description'],
  ])('rejects %s', async (_label, overrides, path) => {
    expect(await errorsOf(new Job(jobFields(overrides)))).toContain(path);
  });

  it('normalizes rather than rejects an uppercase slug or country code', async () => {
    // lowercase/uppercase setters run before validation, so mixed-case input is
    // corrected to the canonical stored form instead of failing.
    const job = new Job(jobFields({ slug: '  Cyber-Specialist  ', location: { countryCode: 'ca' } }));
    await validate(job);
    expect(job.slug).toBe('cyber-specialist');
    expect(job.location.countryCode).toBe('CA');
  });

  it('accepts a fractional weeklyHours', async () => {
    expect(await validate(new Job(jobFields({ weeklyHours: 22.5 })))).toBeNull();
  });
});

describe('Job — money as integer minor units (Doc 10 section 13)', () => {
  it('accepts CAD 35.00 as 3500', async () => {
    const job = new Job(jobFields({ compensation: { currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: true } }));
    expect(await validate(job)).toBeNull();
    expect(job.compensation.amountMinor).toBe(3500);
  });

  it.each([
    ['a fractional amount', 35.5],
    ['a negative amount', -1],
  ])('rejects %s', async (_label, amountMinor) => {
    const job = new Job(jobFields({ compensation: { currency: 'CAD', amountMinor, unit: 'HOUR', gross: true } }));
    expect(await errorsOf(job)).toContain('compensation.amountMinor');
  });

  it('rejects a malformed currency code', async () => {
    const job = new Job(jobFields({ compensation: { currency: 'DOLLARS', amountMinor: 100 } }));
    expect(await errorsOf(job)).toContain('compensation.currency');
  });

  it('rejects an unknown compensation unit', async () => {
    const job = new Job(jobFields({ compensation: { currency: 'CAD', amountMinor: 100, unit: 'WEEK' } }));
    expect(await errorsOf(job)).toContain('compensation.unit');
  });
});

describe('Job — content arrays', () => {
  it('rejects more than 50 items', async () => {
    const job = new Job(jobFields({ responsibilities: Array.from({ length: 51 }, () => 'item') }));
    expect(await errorsOf(job)).toContain('responsibilities');
  });

  it('rejects an item over 1000 characters', async () => {
    const job = new Job(jobFields({ requirements: ['x'.repeat(1001)] }));
    expect((await errorsOf(job)).some((path) => path.startsWith('requirements'))).toBe(true);
  });

  it('allows preferredQualifications to be empty', async () => {
    expect(await validate(new Job(jobFields({ preferredQualifications: [] })))).toBeNull();
  });
});

describe('Job — application config consistency (Doc 10 sections 44-45)', () => {
  it.each([
    ['phone', { phone: { enabled: false, required: true } }],
    ['message', { message: { enabled: false, required: true, maxLength: 5000 } }],
  ])('rejects %s required while disabled', async (_label, applicationConfig) => {
    expect(await validate(new Job(jobFields({ applicationConfig })))).not.toBeNull();
  });

  it('rejects a message maxLength above 5000', async () => {
    const job = new Job(jobFields({ applicationConfig: { message: { enabled: true, required: false, maxLength: 5001 } } }));
    expect(await validate(job)).not.toBeNull();
  });
});

describe('Job — screening questions (Doc 10 sections 47-55)', () => {
  const withQuestions = (screeningQuestions) => new Job(jobFields({ applicationConfig: { screeningQuestions } }));

  it('generates a stable UUID questionId and optionId', async () => {
    const job = withQuestions([
      { type: 'SINGLE_SELECT', prompt: 'Pick one', options: [{ label: 'A' }, { label: 'B' }] },
    ]);
    expect(await validate(job)).toBeNull();
    const question = job.applicationConfig.screeningQuestions[0];
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(question.questionId).toMatch(uuid);
    expect(question.options[0].optionId).toMatch(uuid);
    // Stable across re-validation: not regenerated on every touch.
    const first = question.questionId;
    await validate(job);
    expect(job.applicationConfig.screeningQuestions[0].questionId).toBe(first);
  });

  it('requires at least two options for SINGLE_SELECT', async () => {
    expect(await validate(withQuestions([{ type: 'SINGLE_SELECT', prompt: 'p', options: [{ label: 'only' }] }]))).not.toBeNull();
    expect(await validate(withQuestions([{ type: 'SINGLE_SELECT', prompt: 'p', options: [] }]))).not.toBeNull();
  });

  it.each(['SHORT_TEXT', 'LONG_TEXT', 'YES_NO'])('rejects options on %s', async (type) => {
    expect(await validate(withQuestions([{ type, prompt: 'p', options: [{ label: 'x' }] }]))).not.toBeNull();
  });

  it('rejects more than 20 questions', async () => {
    const many = Array.from({ length: 21 }, () => ({ type: 'SHORT_TEXT', prompt: 'p' }));
    expect(await validate(withQuestions(many))).not.toBeNull();
  });

  it('defaults required to false', async () => {
    const job = withQuestions([{ type: 'SHORT_TEXT', prompt: 'p' }]);
    await validate(job);
    expect(job.applicationConfig.screeningQuestions[0].required).toBe(false);
  });
});

describe('Job — slug immutability after publication (Doc 10 section 22)', () => {
  it('allows editing the slug while never published', async () => {
    const job = new Job(jobFields());
    job.isNew = false;
    job.slug = 'new-slug';
    expect(await validate(job)).toBeNull();
  });

  it('rejects editing the slug once published', async () => {
    // Job.hydrate builds the document exactly as a query result would, so the
    // model sees the PERSISTED publishedAt rather than an in-memory value.
    const job = Job.hydrate(jobFields({ status: 'PUBLISHED', publishedAt: new Date() }));
    job.slug = 'renamed-role';
    expect(await errorsOf(job)).toContain('slug');
  });
});

describe('Application — required structure', () => {
  it('accepts a complete application', async () => {
    expect(await validate(new Application(applicationFields()))).toBeNull();
  });

  it.each(['jobId', 'jobSnapshot', 'candidate', 'resume'])('requires %s', async (field) => {
    const fields = applicationFields();
    delete fields[field];
    expect((await errorsOf(new Application(fields))).some((path) => path.startsWith(field))).toBe(true);
  });

  it('defaults status to RECEIVED and rejects any other value', async () => {
    const application = new Application(applicationFields());
    expect(application.status).toBe('RECEIVED');
    expect(await errorsOf(new Application(applicationFields({ status: 'SHORTLISTED' })))).toContain('status');
  });

  it('sets submittedAt and keeps it distinct from createdAt semantics', () => {
    const application = new Application(applicationFields());
    expect(application.submittedAt).toBeInstanceOf(Date);
    // createdAt is a database timestamp applied on save, not at construction.
    expect(application.createdAt).toBeUndefined();
  });

  it('keeps retention structural and null (Doc 10 sections 125-126)', () => {
    const application = new Application(applicationFields());
    expect(application.retention.policyVersion).toBeNull();
    expect(application.retention.retainUntil).toBeNull();
  });

  it('rejects unknown fields rather than silently dropping them', () => {
    expect(() => new Application(applicationFields({ salaryExpectation: 100 }))).toThrow();
  });
});

describe('Application — candidate and email normalization (Doc 10 sections 82-85)', () => {
  it('normalizes with trim and lowercase only', () => {
    expect(normalizeEmail('  Jane.Doe+Tag@Example.COM ')).toBe('jane.doe+tag@example.com');
  });

  it('does not apply provider-specific transformations', () => {
    // Dots and +tags are meaningful at some providers; removing them would
    // alter genuinely distinct addresses.
    const normalized = normalizeEmail('first.last+careers@gmail.com');
    expect(normalized).toContain('.');
    expect(normalized).toContain('+careers');
  });

  it('derives emailNormalized automatically', async () => {
    const application = new Application(applicationFields({ candidate: { fullName: 'Jane Doe', email: ' JANE@Example.com ' } }));
    await validate(application);
    expect(application.candidate.emailNormalized).toBe('jane@example.com');
    expect(application.candidate.email).toBe('JANE@Example.com');
  });

  it.each([
    ['Chinese', '李雷'],
    ['Icelandic', 'Þórunn Ólafsdóttir'],
    ['Cyrillic', 'Шервин Фаллахдуст'],
    ['Arabic', 'محمد عبد الله'],
    ['hyphen and apostrophe', "Anne-Marie O'Brien"],
  ])('accepts a %s candidate name', async (_label, fullName) => {
    const application = new Application(applicationFields({ candidate: { fullName, email: 'a@b.com' } }));
    expect(await validate(application)).toBeNull();
  });

  it.each([
    ['a one-character name', 'J'],
    ['a name over 120 characters', 'x'.repeat(121)],
  ])('rejects %s', async (_label, fullName) => {
    const application = new Application(applicationFields({ candidate: { fullName, email: 'a@b.com' } }));
    expect(await errorsOf(application)).toContain('candidate.fullName');
  });
});

describe('Application — resume metadata (Doc 10 sections 94-108)', () => {
  const withResume = (overrides) => new Application(applicationFields({ resume: resumeFields(overrides) }));

  it('defaults scanStatus to NOT_SCANNED, never CLEAN', () => {
    expect(new Application(applicationFields()).resume.scanStatus).toBe('NOT_SCANNED');
  });

  it('leaves scanCheckedAt null until a scan actually runs', () => {
    expect(new Application(applicationFields()).resume.scanCheckedAt).toBeNull();
  });

  it.each([
    ['an unsupported extension', { extension: '.exe' }, 'resume.extension'],
    ['an unsupported mimeType', { mimeType: 'application/x-msdownload' }, 'resume.mimeType'],
    ['a zero size', { sizeBytes: 0 }, 'resume.sizeBytes'],
    ['a fractional size', { sizeBytes: 10.5 }, 'resume.sizeBytes'],
    ['a size over 5 MiB', { sizeBytes: RESUME_MAX_BYTES + 1 }, 'resume.sizeBytes'],
    ['an uppercase checksum', { checksumSha256: 'A'.repeat(64) }, 'resume.checksumSha256'],
    ['a short checksum', { checksumSha256: 'ab' }, 'resume.checksumSha256'],
    ['an unknown scanStatus', { scanStatus: 'SAFE' }, 'resume.scanStatus'],
  ])('rejects %s', async (_label, overrides, path) => {
    expect(await errorsOf(withResume(overrides))).toContain(path);
  });

  it('accepts exactly 5 MiB and the DOCX type', async () => {
    expect(await validate(withResume({
      sizeBytes: RESUME_MAX_BYTES,
      extension: '.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }))).toBeNull();
  });

  it.each(['storageProvider', 'storageKey', 'originalFilename', 'checksumSha256'])(
    'requires resume.%s',
    async (field) => {
      const resume = resumeFields();
      delete resume[field];
      expect(await errorsOf(new Application(applicationFields({ resume })))).toContain(`resume.${field}`);
    },
  );
});

describe('Application — screening answers (Doc 10 sections 88-93)', () => {
  const withAnswer = (answer) => new Application(applicationFields({ screeningAnswers: [answer] }));
  const base = { questionId: Q1, promptSnapshot: 'Question?', typeSnapshot: 'SHORT_TEXT' };

  it('accepts a SHORT_TEXT answer in textValue', async () => {
    expect(await validate(withAnswer({ ...base, textValue: 'An answer' }))).toBeNull();
  });

  it('enforces the SHORT_TEXT and LONG_TEXT limits', async () => {
    expect(await validate(withAnswer({ ...base, textValue: 'x'.repeat(1000) }))).toBeNull();
    expect(await validate(withAnswer({ ...base, textValue: 'x'.repeat(1001) }))).not.toBeNull();
    const long = { ...base, typeSnapshot: 'LONG_TEXT' };
    expect(await validate(withAnswer({ ...long, textValue: 'x'.repeat(3000) }))).toBeNull();
    expect(await validate(withAnswer({ ...long, textValue: 'x'.repeat(3001) }))).not.toBeNull();
  });

  it('requires booleanValue for YES_NO and nothing else', async () => {
    expect(await validate(withAnswer({ ...base, typeSnapshot: 'YES_NO', booleanValue: false }))).toBeNull();
    expect(await validate(withAnswer({ ...base, typeSnapshot: 'YES_NO' }))).not.toBeNull();
    expect(await validate(withAnswer({ ...base, typeSnapshot: 'YES_NO', booleanValue: true, textValue: 'x' }))).not.toBeNull();
  });

  it('requires optionId and its label snapshot for SINGLE_SELECT', async () => {
    const select = { ...base, typeSnapshot: 'SINGLE_SELECT' };
    expect(await validate(withAnswer({ ...select, optionId: O1, optionLabelSnapshot: 'Option One' }))).toBeNull();
    expect(await validate(withAnswer({ ...select, optionId: O1 }))).not.toBeNull();
    expect(await validate(withAnswer({ ...select, optionLabelSnapshot: 'Option One' }))).not.toBeNull();
  });

  it('requires promptSnapshot so history survives a later question edit', async () => {
    const answer = { questionId: Q1, typeSnapshot: 'SHORT_TEXT', textValue: 'a' };
    expect((await errorsOf(withAnswer(answer))).some((path) => path.includes('promptSnapshot'))).toBe(true);
  });

  it('rejects more than 20 answers', async () => {
    // Distinct, valid UUIDs, so the ONLY problem is the count.
    const answers = Array.from({ length: 21 }, () => ({ ...base, questionId: randomUUID(), textValue: 'a' }));
    expect(await errorsOf(new Application(applicationFields({ screeningAnswers: answers })))).toEqual(['screeningAnswers']);
    expect(await validate(new Application(applicationFields({ screeningAnswers: answers.slice(0, 20) })))).toBeNull();
  });
});

describe('Application — notifications never claim delivery (Doc 10 sections 118-122)', () => {
  it('defaults internal to PENDING with no attempts', () => {
    const { internal } = new Application(applicationFields()).notifications;
    expect(internal.status).toBe('PENDING');
    expect(internal.attemptCount).toBe(0);
    expect(internal.sentAt).toBeNull();
  });

  it('defaults candidate acknowledgement to NOT_REQUIRED', () => {
    expect(new Application(applicationFields()).notifications.candidateAcknowledgement.status).toBe('NOT_REQUIRED');
  });

  it('rejects an unknown notification status', async () => {
    const application = new Application(applicationFields());
    application.notifications.internal.status = 'DELIVERED';
    expect((await errorsOf(application)).some((path) => path.includes('notifications.internal.status'))).toBe(true);
  });
});

/* -------------------------------------------------------------------------
 * Hardening added after reconciling Doc 10 sections 22, 32, 58-59, 64, 84,
 * 108 and 136-138 against the first B2 draft.
 * ---------------------------------------------------------------------- */

/** A publish-ready Job, as a query would return it (Job.hydrate runs init hooks). */
const persistedJob = (overrides = {}) =>
  Job.hydrate({
    _id: new mongoose.Types.ObjectId(),
    title: 'Cybersecurity Specialist',
    slug: 'cybersecurity-specialist',
    location: { displayName: 'British Columbia, Canada', countryCode: 'CA' },
    workArrangement: 'FULLY_REMOTE',
    employmentType: 'PART_TIME',
    schedule: '30 hours per week',
    weeklyHours: 30,
    compensation: { currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: true },
    description: 'Approved role description.',
    responsibilities: ['Responsibility one.'],
    requirements: ['Requirement one.'],
    status: 'DRAFT',
    publishedAt: null,
    ...overrides,
  });

describe('Job — lifecycle safety net on save (Doc 10 sections 58-59, 64)', () => {
  it('rejects a new Job created in any status other than DRAFT', async () => {
    for (const status of ['PUBLISHED', 'CLOSED', 'ARCHIVED']) {
      expect(await errorsOf(new Job(jobFields({ status, publishedAt: new Date() })))).toContain('status');
    }
  });

  it('accepts every documented transition', async () => {
    const cases = [
      ['DRAFT', 'ARCHIVED', {}],
      ['DRAFT', 'PUBLISHED', { publishedAt: new Date() }],
      ['PUBLISHED', 'CLOSED', {}],
      ['CLOSED', 'PUBLISHED', {}],
      ['CLOSED', 'ARCHIVED', {}],
    ];
    for (const [from, to, extra] of cases) {
      const published = from === 'DRAFT' ? null : new Date('2026-09-01T00:00:00.000Z');
      const job = persistedJob({ status: from, publishedAt: published });
      job.status = to;
      Object.assign(job, extra);
      expect(await validate(job), `${from} -> ${to}`).toBeNull();
    }
  });

  it.each([
    ['PUBLISHED', 'DRAFT'],
    ['PUBLISHED', 'ARCHIVED'],
    ['CLOSED', 'DRAFT'],
    ['ARCHIVED', 'PUBLISHED'],
    ['ARCHIVED', 'DRAFT'],
  ])('rejects the undocumented transition %s -> %s', async (from, to) => {
    const job = persistedJob({ status: from, publishedAt: new Date('2026-09-01T00:00:00.000Z') });
    job.status = to;
    expect(await errorsOf(job)).toContain('status');
  });

  it('refuses to publish an incomplete draft even by a direct save', async () => {
    const job = persistedJob({ description: '', responsibilities: [], employmentType: null });
    job.status = 'PUBLISHED';
    job.publishedAt = new Date();
    const errors = await errorsOf(job);
    expect(errors).toEqual(expect.arrayContaining(['description', 'responsibilities', 'employmentType']));
  });

  it('keeps a PUBLISHED Job publish-ready when it is later edited', async () => {
    const job = persistedJob({ status: 'PUBLISHED', publishedAt: new Date('2026-09-01T00:00:00.000Z') });
    job.description = '';
    expect(await errorsOf(job)).toContain('description');
  });

  it('requires publishedAt on a PUBLISHED Job', async () => {
    const job = persistedJob();
    job.status = 'PUBLISHED';
    expect(await errorsOf(job)).toContain('publishedAt');
  });

  it('never changes or erases the first-publication timestamp', async () => {
    const first = new Date('2026-09-01T00:00:00.000Z');
    const moved = persistedJob({ status: 'CLOSED', publishedAt: first });
    moved.publishedAt = new Date('2026-09-10T00:00:00.000Z');
    expect(await errorsOf(moved)).toContain('publishedAt');

    const erased = persistedJob({ status: 'CLOSED', publishedAt: first });
    erased.publishedAt = null;
    expect(await errorsOf(erased)).toContain('publishedAt');
  });

  it('still allows the slug to change while the Job has never been published', async () => {
    const job = persistedJob();
    job.slug = 'renamed-before-publication';
    expect(await validate(job)).toBeNull();
  });

  it('allows the slug to be chosen in the same save that first publishes', async () => {
    const job = persistedJob();
    job.slug = 'final-slug';
    job.status = 'PUBLISHED';
    job.publishedAt = new Date();
    expect(await validate(job)).toBeNull();
  });
});

describe('Job — weeklyHours bounds (Doc 10 section 32)', () => {
  it.each([[0.5, true], [30, true], [168, true], [0, false], [-1, false], [168.5, false]])(
    'weeklyHours %s valid: %s',
    async (hours, valid) => {
      const errors = await errorsOf(new Job(jobFields({ weeklyHours: hours })));
      expect(errors.includes('weeklyHours')).toBe(!valid);
    },
  );
});

describe('Job — query writes cannot bypass the lifecycle (writeGuards)', () => {
  it.each([
    ['publish by updateOne', () => Job.updateOne({}, { $set: { status: 'PUBLISHED' } })],
    ['erase publishedAt', () => Job.updateOne({}, { $unset: { publishedAt: 1 } })],
    ['rename the slug', () => Job.findOneAndUpdate({}, { slug: 'renamed' })],
    ['archive by updateMany', () => Job.updateMany({}, { $set: { status: 'ARCHIVED' } })],
    ['replace the document', () => Job.replaceOne({}, { title: 'Replaced' })],
    ['rename into a protected path', () => Job.updateOne({}, { $rename: { title: 'slug' } })],
    // Mongoose refuses pipeline updates unless explicitly enabled; when they
    // are, the guard still rejects the operation.
    ['use an aggregation pipeline', () => Job.updateOne({}, [{ $set: { title: 'x' } }], { updatePipeline: true })],
    ['bulk-write a status', () => Job.bulkWrite([{ updateOne: { filter: {}, update: { $set: { status: 'CLOSED' } } } }])],
  ])('rejects an attempt to %s', async (_label, run) => {
    // Rejected by middleware before anything is sent to a database.
    await expect(Promise.resolve().then(run)).rejects.toBeInstanceOf(UnsupportedWriteError);
  });

  it('rejects even a query update that touches no lifecycle field', async () => {
    // Correction cycle 1, finding 1: an update validator cannot enforce the
    // cross-field publish-readiness rule, so no query update is supported.
    await expect(Job.updateOne({}, { $set: { title: 'Renamed Role' } })).rejects.toBeInstanceOf(UnsupportedWriteError);
  });
});

describe('Application — email structure (Doc 09 section 84, Doc 10 section 225)', () => {
  it.each([
    'jane@example.com', 'jane.doe+tag@sub.example.co.uk', 'élodie@exemple.fr', 'o\'brien@example.ie',
  ])('accepts %s', (email) => expect(isSyntacticallyValidEmail(email)).toBe(true));

  it.each([
    'no-at-sign', 'a@b', '@example.com', 'a@@example.com', 'a b@example.com', 'a@exa mple.com',
    'a@example..com', 'a@.example.com', `${'x'.repeat(65)}@example.com`, 'a@example.com\u0000',
  ])('rejects %j at the model layer', async (email) => {
    const application = new Application(applicationFields({ candidate: { fullName: 'Jane Doe', email } }));
    expect(await errorsOf(application)).toContain('candidate.email');
  });

  it('derives emailNormalized from email rather than trusting a supplied value', async () => {
    const application = new Application(
      applicationFields({
        candidate: { fullName: 'Jane Doe', email: ' Jane.Doe+Tag@Example.COM ', emailNormalized: 'someone-else@example.com' },
      }),
    );
    expect(await validate(application)).toBeNull();
    expect(application.candidate.emailNormalized).toBe('jane.doe+tag@example.com');
  });

  it('trims a message but keeps its internal line breaks', () => {
    const application = new Application(
      applicationFields({ candidate: { fullName: 'Jane Doe', email: 'a@b.co', message: '  Line one\nLine two  ' } }),
    );
    expect(application.candidate.message).toBe('Line one\nLine two');
  });
});

describe('Application — storage and snapshot structure (Doc 10 sections 77-80, 108)', () => {
  it('requires resume.storedAt, because acceptance follows a successful store', async () => {
    const resume = resumeFields();
    delete resume.storedAt;
    expect(await errorsOf(new Application(applicationFields({ resume })))).toContain('resume.storedAt');
  });

  it.each([
    ['workArrangement', { workArrangement: 'ON_THE_MOON' }],
    ['employmentType', { employmentType: 'GIG' }],
    ['weeklyHours', { weeklyHours: 500 }],
    ['compensation.currency', { compensation: { currency: 'cad' } }],
    ['compensation.amountMinor', { compensation: { amountMinor: 35.5 } }],
    ['compensation.unit', { compensation: { unit: 'DAY' } }],
  ])('validates jobSnapshot.%s', async (path, snapshotOverride) => {
    const application = new Application(
      applicationFields({
        jobSnapshot: { title: 'Cybersecurity Specialist', slug: 'cybersecurity-specialist', ...snapshotOverride },
      }),
    );
    expect(await errorsOf(application)).toContain(`jobSnapshot.${path}`);
  });
});

describe('Application — submission history is immutable (Doc 10 sections 136-138)', () => {
  /** An Application as a query would return it. */
  const persistedApplication = () =>
    Application.hydrate({
      _id: new mongoose.Types.ObjectId(),
      ...applicationFields({
        candidate: { fullName: 'Jane Doe', email: 'jane@example.com', emailNormalized: 'jane@example.com' },
        screeningAnswers: [
          { questionId: Q1, promptSnapshot: 'Why?', typeSnapshot: 'SHORT_TEXT', textValue: 'Because.' },
        ],
      }),
      status: 'RECEIVED',
      submittedAt: new Date('2026-09-20T10:00:00.000Z'),
      notifications: {
        internal: { status: 'PENDING', attemptCount: 0 },
        candidateAcknowledgement: { status: 'NOT_REQUIRED', attemptCount: 0 },
      },
    });

  it('covers every path Doc 10 section 138 lists', () => {
    expect(SUBMISSION_HISTORY_PATHS).toEqual(expect.arrayContaining([
      'jobId', 'jobSnapshot', 'screeningAnswers', 'submittedAt', 'idempotency', 'resume.storageKey',
    ]));
  });

  it.each([
    ['jobId', (a) => { a.jobId = new mongoose.Types.ObjectId(); }],
    ['jobSnapshot', (a) => { a.jobSnapshot.title = 'Rewritten Title'; }],
    ['candidate', (a) => { a.candidate.email = 'other@example.com'; }],
    ['screeningAnswers', (a) => { a.screeningAnswers[0].textValue = 'Edited.'; }],
    ['screeningAnswers', (a) => { a.screeningAnswers.push({ questionId: Q2, promptSnapshot: 'p', typeSnapshot: 'YES_NO', booleanValue: true }); }],
    ['resume.storageKey', (a) => { a.resume.storageKey = 'resumes/other'; }],
    ['resume.checksumSha256', (a) => { a.resume.checksumSha256 = 'b'.repeat(64); }],
    ['submittedAt', (a) => { a.submittedAt = new Date(); }],
    ['idempotency', (a) => { a.idempotency.keyHash = 'z'.repeat(64); }],
  ])('rejects a saved change to %s', async (path, change) => {
    const application = persistedApplication();
    change(application);
    expect(await errorsOf(application)).toContain(path);
  });

  it('still allows the operational state later milestones own', async () => {
    const application = persistedApplication();
    application.notifications.internal.status = 'SENT';
    application.notifications.internal.sentAt = new Date();
    application.resume.scanStatus = 'PENDING';
    application.retention.policyVersion = 'v1';
    expect(await validate(application)).toBeNull();
  });

  it.each([
    ['a snapshot field', { $set: { 'jobSnapshot.title': 'Rewritten' } }],
    ['the Job relationship', { $set: { jobId: new mongoose.Types.ObjectId() } }],
    ['the whole resume object', { $set: { resume: resumeFields() } }],
    ['an answer by position', { $set: { 'screeningAnswers.0.textValue': 'Edited.' } }],
    ['the idempotency hash', { $set: { 'idempotency.keyHash': 'x' } }],
    ['submittedAt', { $currentDate: { submittedAt: true } }],
    ['a renamed-in path', { $rename: { 'retention.policyVersion': 'candidate.fullName' } }],
  ])('rejects a query update to %s', async (_label, update) => {
    await expect(Application.updateOne({}, update)).rejects.toBeInstanceOf(UnsupportedWriteError);
  });

  it('rejects even a query update to operational notification state', async () => {
    await expect(
      Application.updateOne({}, { $set: { 'notifications.internal.status': 'SENT' } }),
    ).rejects.toBeInstanceOf(UnsupportedWriteError);
  });
});

/* -------------------------------------------------------------------------
 * Correction cycle 1, finding 1 — write paths exercised through the public
 * Mongoose API with ONLY the final collection adapter stubbed, exactly as the
 * reviewer did. A rejected write must never reach the adapter; a legitimate,
 * valid document save must.
 * ---------------------------------------------------------------------- */

const ADAPTER_METHODS = [
  'insertOne', 'insertMany', 'updateOne', 'updateMany', 'findOneAndUpdate',
  'replaceOne', 'findOneAndReplace', 'bulkWrite', 'aggregate',
];

/**
 * Replaces the collection adapter methods with recorders; restored after each
 * test. Returns the LIVE array of adapter methods reached — keep the reference
 * (never copy it before the write), or assert the spies with
 * expectAdapterUntouched.
 */
function stubAdapter(Model) {
  const reached = [];
  const results = {
    insertOne: { acknowledged: true, insertedId: new mongoose.Types.ObjectId() },
    updateOne: { acknowledged: true, matchedCount: 1, modifiedCount: 1 },
    aggregate: { toArray: async () => [] },
  };
  for (const method of ADAPTER_METHODS) {
    vi.spyOn(Model.collection, method).mockImplementation(async () => {
      reached.push(method);
      return results[method] ?? { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    });
  }
  return reached;
}

/** Asserts that no stubbed adapter method of the model was called at all. */
function expectAdapterUntouched(Model) {
  for (const method of ADAPTER_METHODS) {
    expect(vi.mocked(Model.collection[method]), `${Model.modelName}.collection.${method}`).not.toHaveBeenCalled();
  }
}

const publishedJob = () =>
  persistedJob({
    status: 'PUBLISHED',
    publishedAt: new Date('2026-09-01T00:00:00.000Z'),
    applicationConfig: { resumeRequired: true, screeningQuestions: [] },
  });

const persistedApplicationDoc = () =>
  Application.hydrate({
    _id: new mongoose.Types.ObjectId(),
    ...applicationFields({ candidate: { fullName: 'Jane Doe', email: 'jane@example.com', emailNormalized: 'jane@example.com' } }),
    status: 'RECEIVED',
    submittedAt: new Date('2026-09-20T10:00:00.000Z'),
    notifications: {
      internal: { status: 'PENDING', attemptCount: 0 },
      candidateAcknowledgement: { status: 'NOT_REQUIRED', attemptCount: 0 },
    },
  });

describe('the reviewer\'s four bypasses are rejected before the adapter', () => {
  it('Job.updateOne({ _id, status: PUBLISHED }, { $set: { description: "" } })', async () => {
    const reached = stubAdapter(Job);
    const job = publishedJob();
    await expect(
      Job.updateOne({ _id: job._id, status: 'PUBLISHED' }, { $set: { description: '' } }),
    ).rejects.toBeInstanceOf(UnsupportedWriteError);
    expect(reached).toEqual([]);
  });

  it('Job.updateOne({ _id, status: PUBLISHED }, { $set: { "applicationConfig.resumeRequired": false } })', async () => {
    const reached = stubAdapter(Job);
    const job = publishedJob();
    await expect(
      Job.updateOne({ _id: job._id, status: 'PUBLISHED' }, { $set: { 'applicationConfig.resumeRequired': false } }),
    ).rejects.toBeInstanceOf(UnsupportedWriteError);
    expect(reached).toEqual([]);
  });

  it('Application.updateOne({ _id }, { $inc: { "notifications.internal.attemptCount": -99 } })', async () => {
    const reached = stubAdapter(Application);
    await expect(
      Application.updateOne({ _id: new mongoose.Types.ObjectId() }, { $inc: { 'notifications.internal.attemptCount': -99 } }),
    ).rejects.toBeInstanceOf(UnsupportedWriteError);
    expect(reached).toEqual([]);
  });

  it('Application.bulkWrite([{ updateOne: { $set: { "notifications.internal.status": "INVALID_STATUS" } } }])', async () => {
    const reached = stubAdapter(Application);
    await expect(
      Application.bulkWrite([
        { updateOne: { filter: { _id: new mongoose.Types.ObjectId() }, update: { $set: { 'notifications.internal.status': 'INVALID_STATUS' } } } },
      ]),
    ).rejects.toBeInstanceOf(UnsupportedWriteError);
    expect(reached).toEqual([]);
  });
});

describe('every other write path that skips validation is rejected before the adapter', () => {
  const id = new mongoose.Types.ObjectId();
  it.each([
    ['Job.updateMany', () => Job.updateMany({}, { $set: { description: '' } })],
    ['Job.findOneAndUpdate', () => Job.findOneAndUpdate({ _id: id }, { $set: { weeklyHours: 500 } })],
    ['Job.findByIdAndUpdate', () => Job.findByIdAndUpdate(id, { status: 'PUBLISHED' })],
    ['Job.replaceOne', () => Job.replaceOne({ _id: id }, { title: 'Replaced', slug: 'replaced' })],
    ['Job.findOneAndReplace', () => Job.findOneAndReplace({ _id: id }, { title: 'Replaced', slug: 'replaced' })],
    ['doc.updateOne() on a Job', () => publishedJob().updateOne({ $set: { description: '' } })],
    ['Job.bulkWrite with only an insertOne', () => Job.bulkWrite([{ insertOne: { document: { title: 'Bulk Role', slug: 'bulk' } } }])],
    ['Job.bulkSave', () => { const job = publishedJob(); job.description = ''; return Job.bulkSave([job]); }],
    ['Job.insertMany', () => Job.insertMany([{ title: 'Many Role', slug: 'many', status: 'PUBLISHED' }])],
    ['Job.insertMany({ lean: true })', () => Job.insertMany([{ title: 'Lean Role', slug: 'lean' }], { lean: true })],
    ['Job.aggregate with $merge', () => Job.aggregate([{ $match: {} }, { $merge: { into: 'jobs' } }])],
    ['Job.aggregate with $out', () => Job.aggregate([{ $match: {} }, { $out: 'jobs' }])],
    ['Application.updateMany', () => Application.updateMany({}, { $set: { 'notifications.internal.status': 'SENT' } })],
    ['Application.findOneAndUpdate', () => Application.findOneAndUpdate({ _id: id }, { $inc: { 'notifications.internal.attemptCount': 1 } })],
    ['Application.replaceOne', () => Application.replaceOne({ _id: id }, { status: 'RECEIVED' })],
    ['Application.insertMany', () => Application.insertMany([applicationFields()])],
    ['Application.aggregate with $merge', () => Application.aggregate([{ $merge: { into: 'applications' } }])],
  ])('%s', async (_label, write) => {
    // Two LIVE recorders (r2 copied them into a new array before the write,
    // so a later adapter call could never have shown up — review finding).
    const jobReached = stubAdapter(Job);
    const applicationReached = stubAdapter(Application);
    await expect(Promise.resolve().then(write)).rejects.toBeInstanceOf(UnsupportedWriteError);
    expect(jobReached).toEqual([]);
    expect(applicationReached).toEqual([]);
    expectAdapterUntouched(Job);
    expectAdapterUntouched(Application);
  });

  it('records adapter calls live, so the assertions above can fail', async () => {
    const jobReached = stubAdapter(Job);
    await Job.collection.updateMany({}, {});
    expect(jobReached).toEqual(['updateMany']);
    expect(vi.mocked(Job.collection.updateMany)).toHaveBeenCalledTimes(1);
  });

  it('a save with validation turned off or narrowed', async () => {
    const reached = stubAdapter(Job);
    const unchecked = publishedJob();
    unchecked.description = '';
    await expect(unchecked.save({ validateBeforeSave: false })).rejects.toBeInstanceOf(UnsupportedWriteError);
    // Narrowed validation is refused even for an otherwise valid change,
    // because it would skip the whole-document invariants.
    const narrowed = publishedJob();
    narrowed.closesAt = new Date('2026-12-31T00:00:00.000Z');
    await expect(narrowed.save({ validateModifiedOnly: true })).rejects.toBeInstanceOf(UnsupportedWriteError);
    await expect(
      Job.create([{ title: 'Unchecked Role', slug: 'unchecked', status: 'PUBLISHED' }], { validateBeforeSave: false }),
    ).rejects.toBeInstanceOf(UnsupportedWriteError);
    expect(reached).toEqual([]);
  });
});

describe('the validated document-save path still works (finding 1 preserves it)', () => {
  it('saves a new draft Job', async () => {
    const reached = stubAdapter(Job);
    await new Job(jobFields()).save();
    expect(reached).toEqual(['insertOne']);
  });

  it('saves a valid edit to a published Job', async () => {
    const reached = stubAdapter(Job);
    const job = publishedJob();
    job.closesAt = new Date('2026-12-31T00:00:00.000Z');
    await job.save();
    expect(reached).toEqual(['updateOne']);
  });

  it('rejects the same invariants by save that the bypasses tried to break', async () => {
    const reached = stubAdapter(Job);
    const emptied = publishedJob();
    emptied.description = '';
    await expect(emptied.save()).rejects.toMatchObject({ name: 'ValidationError' });
    const noResume = publishedJob();
    noResume.applicationConfig.resumeRequired = false;
    await expect(noResume.save()).rejects.toMatchObject({ name: 'ValidationError' });
    expect(reached).toEqual([]);
  });

  it('runs the Job service lifecycle through save', async () => {
    const reached = stubAdapter(Job);
    const draft = persistedJob();
    await publishJob(draft, { now: new Date('2026-09-01T00:00:00.000Z') });
    await closeJob(draft, { now: new Date('2026-09-02T00:00:00.000Z') });
    expect(reached).toEqual(['updateOne', 'updateOne']);
    expect(draft.status).toBe('CLOSED');
  });

  it('records notification state on an Application by a validated save', async () => {
    const reached = stubAdapter(Application);
    const application = persistedApplicationDoc();
    application.notifications.internal.status = 'SENT';
    application.notifications.internal.attemptCount += 1;
    application.notifications.internal.sentAt = new Date();
    await application.save();
    expect(reached).toEqual(['updateOne']);
  });

  it('rejects an invalid notification state or a negative attempt count by save', async () => {
    const reached = stubAdapter(Application);
    const badStatus = persistedApplicationDoc();
    badStatus.notifications.internal.status = 'INVALID_STATUS';
    await expect(badStatus.save()).rejects.toMatchObject({ name: 'ValidationError' });
    const negative = persistedApplicationDoc();
    negative.notifications.internal.attemptCount -= 99;
    await expect(negative.save()).rejects.toMatchObject({ name: 'ValidationError' });
    expect(reached).toEqual([]);
  });

  it('still allows read-only aggregation', async () => {
    const reached = stubAdapter(Job);
    await Job.aggregate([{ $match: { status: 'PUBLISHED' } }]);
    expect(reached).toEqual(['aggregate']);
  });
});

/* -------------------------------------------------------------------------
 * Correction cycle 1, finding 5 — screening identifier integrity
 * (Doc 10 sections 48 and 53).
 * ---------------------------------------------------------------------- */
describe('screening identifiers are UUIDs, unique and stable', () => {
  const U = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
  const question = (overrides = {}) => ({ type: 'SHORT_TEXT', prompt: 'Why this role?', ...overrides });
  const select = (options, overrides = {}) => question({ type: 'SINGLE_SELECT', prompt: 'Pick one', options, ...overrides });
  const withQuestions = (screeningQuestions) => new Job(jobFields({ applicationConfig: { screeningQuestions } }));

  it("rejects the reviewer's case: two questions sharing questionId \"same-not-a-uuid\"", async () => {
    const job = withQuestions([question({ questionId: 'same-not-a-uuid' }), question({ questionId: 'same-not-a-uuid', prompt: 'Other?' })]);
    expect(await validate(job)).not.toBeNull();
  });

  it.each([
    ['a free-form string', 'same-not-a-uuid'],
    ['an uppercase UUID', U(1).toUpperCase().replace(/^1/, 'A')],
    ['a UUID without hyphens', U(1).replaceAll('-', '')],
    ['the nil UUID', '00000000-0000-0000-0000-000000000000'],
    ['a UUID with an invalid variant', '11111111-1111-4111-7111-111111111111'],
  ])('rejects a questionId that is %s', async (_label, questionId) => {
    expect(await errorsOf(withQuestions([question({ questionId })]))).toEqual([
      'applicationConfig.screeningQuestions.0.questionId',
    ]);
  });

  it('rejects an optionId that is not a UUID', async () => {
    const job = withQuestions([select([{ optionId: 'opt-a', label: 'A' }, { label: 'B' }])]);
    expect(await errorsOf(job)).toEqual(['applicationConfig.screeningQuestions.0.options.0.optionId']);
  });

  it('rejects two questions with the same valid UUID in one Job', async () => {
    const job = withQuestions([question({ questionId: U(1) }), question({ questionId: U(1), type: 'YES_NO' })]);
    expect(await errorsOf(job)).toEqual(['applicationConfig.screeningQuestions']);
  });

  it('rejects two options with the same optionId in one question', async () => {
    const job = withQuestions([select([{ optionId: U(2), label: 'A' }, { optionId: U(2), label: 'B' }])]);
    expect(await errorsOf(job)).toEqual(['applicationConfig.screeningQuestions.0.options']);
  });

  it('allows the same optionId in two different questions (option IDs are scoped to a question)', async () => {
    const job = withQuestions([
      select([{ optionId: U(2), label: 'A' }, { optionId: U(3), label: 'B' }], { questionId: U(1) }),
      select([{ optionId: U(2), label: 'C' }, { optionId: U(3), label: 'D' }], { questionId: U(4) }),
    ]);
    expect(await validate(job)).toBeNull();
  });

  it('generates distinct UUIDs when none are supplied', async () => {
    const job = withQuestions([question(), question({ prompt: 'Second?' }), select([{ label: 'A' }, { label: 'B' }])]);
    expect(await validate(job)).toBeNull();
    const questions = job.applicationConfig.screeningQuestions;
    const ids = questions.map((q) => q.questionId);
    expect(new Set(ids).size).toBe(3);
    ids.forEach((id) => expect(id).toMatch(UUID_PATTERN));
    expect(questions[2].options.map((o) => o.optionId).every((id) => UUID_PATTERN.test(id))).toBe(true);
  });

  describe('on a Job loaded from the database', () => {
    const loaded = () =>
      persistedJob({
        applicationConfig: {
          resumeRequired: true,
          screeningQuestions: [
            { questionId: U(1), type: 'SINGLE_SELECT', prompt: 'Pick one', required: false,
              options: [{ optionId: U(2), label: 'A' }, { optionId: U(3), label: 'B' }] },
            { questionId: U(4), type: 'SHORT_TEXT', prompt: 'Why?', required: true, options: [] },
          ],
        },
      });

    it('keeps every identifier through ordinary edits (prompt, label, required, adding an option)', async () => {
      const job = loaded();
      const [first, second] = job.applicationConfig.screeningQuestions;
      first.prompt = 'Pick exactly one';
      first.options[0].label = 'Option A';
      first.options.push({ label: 'C' });
      second.required = false;
      expect(await validate(job)).toBeNull();
      expect(first.questionId).toBe(U(1));
      expect(second.questionId).toBe(U(4));
      expect(first.options.slice(0, 2).map((o) => o.optionId)).toEqual([U(2), U(3)]);
      expect(first.options[2].optionId).toMatch(UUID_PATTERN);
    });

    it('rejects rewriting an existing questionId in place', async () => {
      const job = loaded();
      job.applicationConfig.screeningQuestions[1].questionId = U(5);
      expect(await errorsOf(job)).toEqual(['applicationConfig.screeningQuestions.1.questionId']);
    });

    it('rejects rewriting an existing optionId in place', async () => {
      const job = loaded();
      job.applicationConfig.screeningQuestions[0].options[1].optionId = U(6);
      expect(await errorsOf(job)).toEqual(['applicationConfig.screeningQuestions.0.options.1.optionId']);
    });

    it('keeps the identifiers the service edit path carries over', async () => {
      const job = loaded();
      const current = job.applicationConfig.toObject();
      applyJobEdit(job, {
        applicationConfig: {
          ...current,
          screeningQuestions: [
            { ...current.screeningQuestions[1], prompt: 'Why Valida?' },
            { type: 'YES_NO', prompt: 'Available to start soon?' },
          ],
        },
      });
      expect(await validate(job)).toBeNull();
      const [kept, added] = job.applicationConfig.screeningQuestions;
      expect(kept.questionId).toBe(U(4));
      expect(added.questionId).toMatch(UUID_PATTERN);
      expect(added.questionId).not.toBe(U(1));
    });
  });
});

describe('screening answers reference UUIDs, one answer per question', () => {
  const answer = (overrides = {}) => ({ questionId: Q1, promptSnapshot: 'Why?', typeSnapshot: 'SHORT_TEXT', textValue: 'Because.', ...overrides });
  const withAnswers = (screeningAnswers) => new Application(applicationFields({ screeningAnswers }));

  it('rejects an answer whose questionId is not a UUID', async () => {
    expect(await errorsOf(withAnswers([answer({ questionId: 'q1' })]))).toEqual(['screeningAnswers.0.questionId']);
  });

  it('rejects a SINGLE_SELECT answer whose optionId is not a UUID', async () => {
    const selected = answer({ typeSnapshot: 'SINGLE_SELECT', textValue: null, optionId: 'o1', optionLabelSnapshot: 'Option One' });
    expect(await errorsOf(withAnswers([selected]))).toEqual(['screeningAnswers.0.optionId']);
  });

  it('rejects two answers to the same question', async () => {
    expect(await errorsOf(withAnswers([answer(), answer({ textValue: 'Again.' })]))).toEqual(['screeningAnswers']);
  });

  it('accepts answers to distinct questions', async () => {
    expect(await validate(withAnswers([answer(), answer({ questionId: Q2, typeSnapshot: 'YES_NO', textValue: null, booleanValue: true })]))).toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * Correction cycle 2, finding 1 — save options cannot narrow or disable
 * validation, whatever their type. Real Mongoose pipeline; only the final
 * collection adapter is stubbed.
 * ---------------------------------------------------------------------- */
describe('save options that would skip validation are rejected before the adapter', () => {
  /** The reviewer's invalid document: title too short, weeklyHours not > 0. */
  const invalidJob = () => new Job({ title: 'x', slug: 'synthetic-review-role', weeklyHours: 0 });

  it("rejects the reviewer's case: save({ pathsToSave: ['slug'] })", async () => {
    const reached = stubAdapter(Job);
    await expect(invalidJob().save({ pathsToSave: ['slug'] })).rejects.toBeInstanceOf(UnsupportedWriteError);
    expect(reached).toEqual([]);
    expectAdapterUntouched(Job);
  });

  // Options Mongoose honours by NOT validating (or validating only part of the
  // document): the invalid document would be stored. Only the guard stops it.
  it.each([
    ['validateBeforeSave: 0 (the reviewer\'s coercion case)', { validateBeforeSave: 0 }],
    ['validateBeforeSave: ""', { validateBeforeSave: '' }],
    ['validateBeforeSave: null', { validateBeforeSave: null }],
    ['validateBeforeSave: false', { validateBeforeSave: false }],
    ['pathsToSave: ["slug", "status"] (skips the invalid title and weeklyHours)', { pathsToSave: ['slug', 'status'] }],
  ])('rejects an INVALID document saved with %s', async (_label, options) => {
    const reached = stubAdapter(Job);
    await expect(invalidJob().save(options)).rejects.toBeInstanceOf(UnsupportedWriteError);
    expect(reached).toEqual([]);
    expectAdapterUntouched(Job);
  });

  // Non-canonical values are refused on principle, even for a VALID document
  // Mongoose would accept — so no type coercion can ever decide validation.
  it.each([
    ['validateBeforeSave: "false"', { validateBeforeSave: 'false' }],
    ['validateBeforeSave: 1', { validateBeforeSave: 1 }],
    ['validateModifiedOnly: 1', { validateModifiedOnly: 1 }],
    ['validateModifiedOnly: "yes"', { validateModifiedOnly: 'yes' }],
    ['validateModifiedOnly: true', { validateModifiedOnly: true }],
    ['pathsToSave: []', { pathsToSave: [] }],
    ['pathsToSave: null', { pathsToSave: null }],
    ['timestamps: false', { timestamps: false }],
    ['timestamps: 0', { timestamps: 0 }],
  ])('rejects a VALID new document saved with %s', async (_label, options) => {
    const reached = stubAdapter(Job);
    await expect(new Job(jobFields({ slug: 'valid-role' })).save(options)).rejects.toBeInstanceOf(UnsupportedWriteError);
    expect(reached).toEqual([]);
  });

  it.each([
    ['pathsToSave', { pathsToSave: ['closesAt'] }],
    ['validateModifiedOnly: 1', { validateModifiedOnly: 1 }],
    ['validateBeforeSave: 0', { validateBeforeSave: 0 }],
  ])('rejects an update save of a loaded, published Job with %s', async (_label, options) => {
    const reached = stubAdapter(Job);
    const job = publishedJob();
    job.closesAt = new Date('2026-12-31T00:00:00.000Z');
    await expect(job.save(options)).rejects.toBeInstanceOf(UnsupportedWriteError);
    expect(reached).toEqual([]);
  });

  it('never lets an invalid edit of a published Job reach the adapter, whatever the options', async () => {
    const reached = stubAdapter(Job);
    for (const options of [{ pathsToSave: ['closesAt'] }, { validateBeforeSave: 0 }, { validateModifiedOnly: 1 }, undefined]) {
      const job = publishedJob();
      job.description = '';
      await expect(job.save(options)).rejects.toThrow();
    }
    expect(reached).toEqual([]);
  });

  it('rejects the same options through Model.create and on an Application', async () => {
    const jobReached = stubAdapter(Job);
    const applicationReached = stubAdapter(Application);
    await expect(
      Job.create([{ title: 'x', slug: 'created-role', weeklyHours: 0 }], { validateBeforeSave: 0 }),
    ).rejects.toBeInstanceOf(UnsupportedWriteError);
    const application = persistedApplicationDoc();
    application.notifications.internal.attemptCount = -99;
    await expect(application.save({ pathsToSave: ['notifications'] })).rejects.toBeInstanceOf(UnsupportedWriteError);
    expect(jobReached).toEqual([]);
    expect(applicationReached).toEqual([]);
  });

  it('still saves a valid document with no options or with the explicit full-validation values', async () => {
    const reached = stubAdapter(Job);
    await new Job(jobFields({ slug: 'plain-save' })).save();
    await new Job(jobFields({ slug: 'empty-options' })).save({});
    await new Job(jobFields({ slug: 'explicit-save' })).save({
      validateBeforeSave: true,
      validateModifiedOnly: false,
      timestamps: true,
    });
    expect(reached).toEqual(['insertOne', 'insertOne', 'insertOne']);
  });

  it('still rejects the invalid document through an ordinary save, by validation', async () => {
    const reached = stubAdapter(Job);
    const error = await invalidJob().save().catch((caught) => caught);
    expect(error.name).toBe('ValidationError');
    expect(Object.keys(error.errors)).toEqual(expect.arrayContaining(['title', 'weeklyHours']));
    expect(reached).toEqual([]);
  });
});

/* -------------------------------------------------------------------------
 * Correction cycle 3 — an explicitly PRESENT option is judged by presence,
 * as Mongoose judges it ('validateBeforeSave' in options, then !!value).
 * r3 treated { validateBeforeSave: undefined } as absent while Mongoose
 * treated it as "do not validate". Real Mongoose pipeline; only the final
 * collection adapter is stubbed.
 * ---------------------------------------------------------------------- */
describe('save options are judged by presence, like Mongoose', () => {
  const invalidJob = () => new Job({ title: 'x', slug: 'synthetic-review-role', weeklyHours: 0 });

  it("rejects the reviewer's case: an INVALID document saved with { validateBeforeSave: undefined }", async () => {
    const reached = stubAdapter(Job);
    await expect(invalidJob().save({ validateBeforeSave: undefined })).rejects.toBeInstanceOf(UnsupportedWriteError);
    expect(reached).toEqual([]);
    expectAdapterUntouched(Job);
  });

  it('rejects { validateBeforeSave: undefined } even for a VALID document', async () => {
    const reached = stubAdapter(Job);
    await expect(new Job(jobFields({ slug: 'undefined-options' })).save({ validateBeforeSave: undefined }))
      .rejects.toBeInstanceOf(UnsupportedWriteError);
    expect(reached).toEqual([]);
  });

  it.each([
    ['validateModifiedOnly: undefined', { validateModifiedOnly: undefined }],
    ['timestamps: undefined', { timestamps: undefined }],
    ['pathsToSave: undefined', { pathsToSave: undefined }],
  ])('applies the same presence rule to %s', async (_label, options) => {
    const reached = stubAdapter(Job);
    await expect(new Job(jobFields({ slug: 'present-undefined' })).save(options)).rejects.toBeInstanceOf(UnsupportedWriteError);
    expect(reached).toEqual([]);
  });

  it('cannot be fooled by a getter that answers differently on each read', async () => {
    // Answers "do not validate" to the first read and "validate" afterwards.
    // Mongoose copies the options once and both it and the guard read the
    // copy, so the guard sees exactly the value validation was decided on.
    const reached = stubAdapter(Job);
    let reads = 0;
    const shifty = { get validateBeforeSave() { reads += 1; return reads > 1; } };
    await expect(invalidJob().save(shifty)).rejects.toBeInstanceOf(UnsupportedWriteError);
    expect(reached).toEqual([]);
  });

  it('still fully validates when the options argument is not an object', async () => {
    // Mongoose ignores a non-object options value, so validation runs as normal.
    const reached = stubAdapter(Job);
    for (const options of ['validateBeforeSave', 0, false]) {
      await expect(invalidJob().save(options)).rejects.toMatchObject({ name: 'ValidationError' });
    }
    expect(reached).toEqual([]);
  });

  it('still validates, and rejects the invalid document, when options are omitted, empty or explicitly true', async () => {
    const reached = stubAdapter(Job);
    for (const options of [undefined, {}, { validateBeforeSave: true }, { validateBeforeSave: true, validateModifiedOnly: false, timestamps: true }]) {
      const error = await invalidJob().save(options).catch((caught) => caught);
      expect(error?.name, JSON.stringify(options)).toBe('ValidationError');
      expect(Object.keys(error.errors)).toEqual(expect.arrayContaining(['title', 'weeklyHours']));
    }
    expect(reached).toEqual([]);
  });

  it('rejects { validateBeforeSave: undefined } through Model.create for Job and Application', async () => {
    const jobReached = stubAdapter(Job);
    const applicationReached = stubAdapter(Application);
    await expect(Job.create([{ title: 'x', slug: 'created-role', weeklyHours: 0 }], { validateBeforeSave: undefined }))
      .rejects.toBeInstanceOf(UnsupportedWriteError);
    const invalidApplication = applicationFields({ candidate: { fullName: 'J', email: 'not-an-email' } });
    await expect(Application.create([invalidApplication], { validateBeforeSave: undefined }))
      .rejects.toBeInstanceOf(UnsupportedWriteError);
    expect(jobReached).toEqual([]);
    expect(applicationReached).toEqual([]);
    expectAdapterUntouched(Job);
    expectAdapterUntouched(Application);
  });

  it('rejects { validateBeforeSave: undefined } on a loaded Application with an invalid change', async () => {
    const reached = stubAdapter(Application);
    const application = persistedApplicationDoc();
    application.notifications.internal.attemptCount = -99;
    await expect(application.save({ validateBeforeSave: undefined })).rejects.toBeInstanceOf(UnsupportedWriteError);
    // The same change through an ordinary save is caught by validation.
    const ordinary = persistedApplicationDoc();
    ordinary.notifications.internal.attemptCount = -99;
    await expect(ordinary.save()).rejects.toMatchObject({ name: 'ValidationError' });
    expect(reached).toEqual([]);
  });

  it('still saves valid documents through Model.create and an ordinary Application save', async () => {
    const jobReached = stubAdapter(Job);
    const applicationReached = stubAdapter(Application);
    await Job.create([jobFields({ slug: 'created-valid' })]);
    await Job.create([jobFields({ slug: 'created-valid-explicit' })], { validateBeforeSave: true });
    const application = persistedApplicationDoc();
    application.notifications.internal.attemptCount += 1;
    await application.save();
    expect(jobReached).toEqual(['insertOne', 'insertOne']);
    expect(applicationReached).toEqual(['updateOne']);
  });
});

describe('options Mongoose does not copy are ignored by both', () => {
  it('an inherited validateBeforeSave: false is ignored and the document is fully validated', async () => {
    const reached = stubAdapter(Job);
    const inherited = Object.create({ validateBeforeSave: false });
    await expect(new Job({ title: 'x', slug: 'inherited', weeklyHours: 0 }).save(inherited))
      .rejects.toMatchObject({ name: 'ValidationError' });
    expect(reached).toEqual([]);
  });
});
