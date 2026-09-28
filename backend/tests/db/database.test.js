import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Job } from '../../src/models/Job.js';
import { Application } from '../../src/models/Application.js';
import { REQUIRED_INDEXES, diffIndexes } from '../../src/db/indexes.js';
import {
  publishJob, closeJob, archiveJob, JobLifecycleError,
} from '../../src/modules/jobs/job.service.js';
import { buildApplication } from '../../src/modules/applications/application.service.js';
import { UnsupportedWriteError } from '../../src/models/writeGuards.js';
import { requireTestDatabase, assertConnectedToTestDatabase } from './testDatabase.js';

/**
 * REAL-DATABASE SUITE.
 *
 * Everything here needs a running MongoDB, because it proves things a mock
 * cannot: that a document survives a write and a reconnect, that a unique
 * index actually rejects a duplicate, and that two concurrent inserts produce
 * one winner and one error.
 *
 * Run through `npm run verify:b2`, which fails when MONGODB_TEST_URI is absent
 * or unreachable rather than skipping these.
 */
// Fails this file (never skips it) unless MONGODB_TEST_URI is an explicitly
// disposable test database, judged on the launching environment.
const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();

/** Every destructive step first re-checks the live connection's database name. */
async function clearSuiteCollections() {
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  await Job.deleteMany({});
  await Application.deleteMany({});
}

const publishableJobFields = (overrides = {}) => ({
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
  ...overrides,
});

const resumeFields = (overrides = {}) => ({
  storageProvider: 'S3_COMPATIBLE',
  storageKey: `resumes/${Math.random().toString(16).slice(2)}`,
  originalFilename: 'cv.pdf',
  extension: '.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 4096,
  checksumSha256: 'a'.repeat(64),
  // Required from B2 (Doc 10 section 108): the storage step's acceptance time.
  storedAt: new Date('2026-09-20T10:00:00.000Z'),
  ...overrides,
});

async function applyRequiredIndexes() {
  for (const required of REQUIRED_INDEXES) {
    await mongoose.connection.db
      .collection(required.collection)
      .createIndex(required.key, { name: required.name, ...required.options });
  }
}

beforeAll(async () => {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false });
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  await applyRequiredIndexes();
}, 30_000);

afterAll(async () => {
  // Remove only the documents of the two collections this suite uses; never
  // drop the database.
  await clearSuiteCollections();
  await mongoose.disconnect();
});

beforeEach(clearSuiteCollections);

describe('database connection', () => {
  it('is connected and reports a database name', () => {
    expect(mongoose.connection.readyState).toBe(1);
    expect(mongoose.connection.name).toBeTruthy();
  });
});

describe('required indexes exist in the real database', () => {
  it('reports every required index as present and compatible', async () => {
    const actual = {
      jobs: await mongoose.connection.db.collection('jobs').indexes(),
      applications: await mongoose.connection.db.collection('applications').indexes(),
    };
    const { satisfied, missing, incompatible } = diffIndexes(REQUIRED_INDEXES, actual);
    expect(missing, `missing: ${missing.map((index) => index.name).join(', ')}`).toHaveLength(0);
    expect(incompatible).toHaveLength(0);
    expect(satisfied).toHaveLength(REQUIRED_INDEXES.length);
  });

  it('creates no TTL index on applications', async () => {
    const indexes = await mongoose.connection.db.collection('applications').indexes();
    indexes.forEach((index) => expect(index.expireAfterSeconds).toBeUndefined());
  });
});

describe('Job persistence', () => {
  it('saves and re-reads a draft with its defaults', async () => {
    const saved = await new Job({ title: 'Draft Role', slug: 'draft-role' }).save();
    const found = await Job.findById(saved._id).lean();

    expect(found.status).toBe('DRAFT');
    expect(found.applicationConfig.resumeRequired).toBe(true);
    expect(found.createdAt).toBeInstanceOf(Date);
    expect(found.updatedAt).toBeInstanceOf(Date);
  });

  it('stores money as an integer and returns it unchanged', async () => {
    const saved = await new Job(publishableJobFields()).save();
    const found = await Job.findById(saved._id).lean();
    expect(found.compensation.amountMinor).toBe(3500);
    expect(Number.isInteger(found.compensation.amountMinor)).toBe(true);
  });

  it('survives a disconnect and reconnect', async () => {
    const saved = await new Job(publishableJobFields({ slug: 'persisted-role' })).save();

    await mongoose.disconnect();
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false });

    const found = await Job.findById(saved._id).lean();
    expect(found).toBeTruthy();
    expect(found.slug).toBe('persisted-role');
    expect(found.compensation.amountMinor).toBe(3500);
  }, 30_000);
});

describe('screening identifiers survive persistence (finding 5)', () => {
  it('keeps generated question and option UUIDs across save, reload and an ordinary edit', async () => {
    const saved = await new Job(publishableJobFields({
      slug: 'screening-role',
      applicationConfig: {
        screeningQuestions: [
          { type: 'SINGLE_SELECT', prompt: 'Pick one', options: [{ label: 'A' }, { label: 'B' }] },
          { type: 'YES_NO', prompt: 'Available soon?' },
        ],
      },
    })).save();
    const idsOf = (job) => job.applicationConfig.screeningQuestions.map((question) => [
      question.questionId, ...question.options.map((option) => option.optionId),
    ]);
    const original = idsOf(saved);

    const loaded = await Job.findById(saved._id);
    expect(idsOf(loaded)).toEqual(original);
    loaded.applicationConfig.screeningQuestions[0].prompt = 'Pick exactly one';
    await loaded.save();

    const reloaded = await Job.findById(saved._id).lean();
    expect(idsOf(reloaded)).toEqual(original);
    expect(reloaded.applicationConfig.screeningQuestions[0].prompt).toBe('Pick exactly one');
  });

  it('refuses to persist duplicate question identifiers', async () => {
    const duplicate = new Job(publishableJobFields({
      slug: 'duplicate-questions',
      applicationConfig: {
        screeningQuestions: [
          { questionId: 'same-not-a-uuid', type: 'SHORT_TEXT', prompt: 'One?' },
          { questionId: 'same-not-a-uuid', type: 'SHORT_TEXT', prompt: 'Two?' },
        ],
      },
    }));
    await expect(duplicate.save()).rejects.toMatchObject({ name: 'ValidationError' });
    expect(await Job.countDocuments({ slug: 'duplicate-questions' })).toBe(0);
  });
});

describe('Job slug uniqueness is enforced by the database', () => {
  it('rejects a second Job with the same slug', async () => {
    await new Job({ title: 'First Role', slug: 'duplicate-slug' }).save();
    const duplicate = new Job({ title: 'Second Role', slug: 'duplicate-slug' });

    const error = await duplicate.save().then(() => null, (caught) => caught);
    expect(error, 'a duplicate slug must be rejected').toBeTruthy();
    expect(error.code).toBe(11000);
    expect(await Job.countDocuments({ slug: 'duplicate-slug' })).toBe(1);
  });

  it('allows the same slug again once the original is removed', async () => {
    const first = await new Job({ title: 'First Role', slug: 'reusable-slug' }).save();
    await Job.deleteOne({ _id: first._id });
    await expect(new Job({ title: 'Second Role', slug: 'reusable-slug' }).save()).resolves.toBeTruthy();
  });

  it('keeps exactly one winner when two identical slugs race', async () => {
    const results = await Promise.allSettled([
      new Job({ title: 'Racer A', slug: 'race-slug' }).save(),
      new Job({ title: 'Racer B', slug: 'race-slug' }).save(),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await Job.countDocuments({ slug: 'race-slug' })).toBe(1);
  });
});

describe('Job lifecycle against the database', () => {
  it('refuses to publish an incomplete draft', async () => {
    const draft = await new Job({ title: 'Incomplete Draft', slug: 'incomplete-draft' }).save();
    const error = await publishJob(draft).then(() => null, (caught) => caught);

    expect(error).toBeInstanceOf(JobLifecycleError);
    expect(error.code).toBe('NOT_PUBLISH_READY');
    expect((await Job.findById(draft._id).lean()).status).toBe('DRAFT');
  });

  it('publishes a complete draft and stamps publishedAt', async () => {
    const draft = await new Job(publishableJobFields()).save();
    await publishJob(draft);

    const found = await Job.findById(draft._id).lean();
    expect(found.status).toBe('PUBLISHED');
    expect(found.publishedAt).toBeInstanceOf(Date);
  });

  it('preserves the original publishedAt when a closed Job is reopened', async () => {
    const draft = await new Job(publishableJobFields({ slug: 'reopened-role' })).save();
    const firstPublish = new Date('2026-01-01T00:00:00.000Z');
    await publishJob(draft, { now: firstPublish });
    await closeJob(draft);
    await publishJob(draft, { now: new Date('2026-06-01T00:00:00.000Z') });

    const found = await Job.findById(draft._id).lean();
    expect(found.status).toBe('PUBLISHED');
    // Doc 10 section 59 — the historical first-publication timestamp stands.
    expect(found.publishedAt.toISOString()).toBe(firstPublish.toISOString());
    expect(found.closedAt).toBeNull();
  });

  it('refuses every transition out of ARCHIVED', async () => {
    const draft = await new Job(publishableJobFields({ slug: 'archived-role' })).save();
    await archiveJob(draft);

    for (const attempt of [publishJob, closeJob, archiveJob]) {
      const error = await attempt(draft).then(() => null, (caught) => caught);
      expect(error?.code).toBe('INVALID_TRANSITION');
    }
    expect((await Job.findById(draft._id).lean()).status).toBe('ARCHIVED');
  });

  it('refuses to change the slug of a published Job', async () => {
    const draft = await new Job(publishableJobFields({ slug: 'immutable-slug' })).save();
    await publishJob(draft);

    draft.slug = 'renamed-slug';
    const error = await draft.save().then(() => null, (caught) => caught);
    expect(error, 'a published slug must be immutable').toBeTruthy();
    expect((await Job.findById(draft._id).lean()).slug).toBe('immutable-slug');
  });
});

describe('Application persistence', () => {
  const persistApplication = async (job, overrides = {}) => {
    const application = buildApplication({
      job,
      candidate: { fullName: 'Jane Doe', email: 'Jane@Example.com' },
      resume: resumeFields(overrides.resume),
      idempotencyKey: overrides.idempotencyKey ?? `key-${Math.random()}`,
    });
    return application.save();
  };

  it('saves an Application and links it to its Job', async () => {
    const job = await new Job(publishableJobFields()).save();
    const saved = await persistApplication(job);
    const found = await Application.findById(saved._id).lean();

    expect(found.jobId.toString()).toBe(job._id.toString());
    expect(found.status).toBe('RECEIVED');
    expect(found.resume.scanStatus).toBe('NOT_SCANNED');
    expect(found.notifications.internal.status).toBe('PENDING');
    expect(found.notifications.candidateAcknowledgement.status).toBe('NOT_REQUIRED');
    expect(found.candidate.emailNormalized).toBe('jane@example.com');
    expect(found.retention.retainUntil).toBeNull();
    expect(found.submittedAt).toBeInstanceOf(Date);
    expect(found.createdAt).toBeInstanceOf(Date);
  });

  it('keeps the job snapshot unchanged after the Job is edited', async () => {
    const job = await new Job(publishableJobFields({ slug: 'snapshot-role' })).save();
    const saved = await persistApplication(job);

    job.title = 'Completely Different Title';
    job.compensation.amountMinor = 9900;
    await job.save();

    const found = await Application.findById(saved._id).lean();
    // Doc 10 section 78 — history records what the candidate applied to.
    expect(found.jobSnapshot.title).toBe('Cybersecurity Specialist');
    expect(found.jobSnapshot.compensation.amountMinor).toBe(3500);
    expect(found.jobSnapshot.location).toBe('British Columbia, Canada');
  });

  it('allows many Applications for one Job', async () => {
    const job = await new Job(publishableJobFields({ slug: 'many-applicants' })).save();
    await persistApplication(job);
    await persistApplication(job);
    expect(await Application.countDocuments({ jobId: job._id })).toBe(2);
  });

  it('allows the same candidate to apply to two different Jobs', async () => {
    const first = await new Job(publishableJobFields({ slug: 'role-one' })).save();
    const second = await new Job(publishableJobFields({ slug: 'role-two' })).save();
    await persistApplication(first);
    await persistApplication(second);
    // Doc 10 section 129 — the email/job index is deliberately NOT unique.
    expect(await Application.countDocuments({ 'candidate.emailNormalized': 'jane@example.com' })).toBe(2);
  });
});

describe('same candidate, separate intentional submissions (Doc 09 section 81)', () => {
  it('stores two Applications from one email to one Job when the keys differ', async () => {
    const job = await new Job(publishableJobFields({ slug: 'resubmission-role' })).save();
    for (const [key, storageKey] of [['first-key', 'resumes/first'], ['second-key', 'resumes/second']]) {
      await buildApplication({
        job,
        candidate: { fullName: 'Jane Doe', email: 'jane@example.com' },
        resume: resumeFields({ storageKey }),
        idempotencyKey: key,
      }).save();
    }
    // The email/job index is not unique: only the idempotency key deduplicates.
    expect(
      await Application.countDocuments({ jobId: job._id, 'candidate.emailNormalized': 'jane@example.com' }),
    ).toBe(2);
  });
});

describe('Application unique constraints are enforced by the database', () => {
  const applicationFor = (job, { idempotencyKey, storageKey }) =>
    buildApplication({
      job,
      candidate: { fullName: 'Jane Doe', email: 'jane@example.com' },
      resume: resumeFields({ storageKey }),
      idempotencyKey,
    });

  it('rejects a duplicate idempotency key hash', async () => {
    const job = await new Job(publishableJobFields({ slug: 'idem-role' })).save();
    await applicationFor(job, { idempotencyKey: 'same-key', storageKey: 'resumes/one' }).save();

    const error = await applicationFor(job, { idempotencyKey: 'same-key', storageKey: 'resumes/two' })
      .save()
      .then(() => null, (caught) => caught);

    expect(error?.code).toBe(11000);
    expect(await Application.countDocuments({})).toBe(1);
  });

  it('creates exactly one Application when the same key is submitted concurrently', async () => {
    const job = await new Job(publishableJobFields({ slug: 'race-role' })).save();
    const results = await Promise.allSettled([
      applicationFor(job, { idempotencyKey: 'race-key', storageKey: 'resumes/a' }).save(),
      applicationFor(job, { idempotencyKey: 'race-key', storageKey: 'resumes/b' }).save(),
    ]);

    // This is the protection a mock cannot demonstrate: the database itself
    // serialises the two writes.
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await Application.countDocuments({})).toBe(1);
  });

  it('rejects a duplicate resume storage key', async () => {
    const job = await new Job(publishableJobFields({ slug: 'storage-role' })).save();
    await applicationFor(job, { idempotencyKey: 'key-one', storageKey: 'resumes/shared' }).save();

    const error = await applicationFor(job, { idempotencyKey: 'key-two', storageKey: 'resumes/shared' })
      .save()
      .then(() => null, (caught) => caught);

    expect(error?.code).toBe(11000);
    expect(await Application.countDocuments({})).toBe(1);
  });
});

describe('lifecycle and history rules hold against the real database', () => {
  it('refuses a direct save that would publish an incomplete Job', async () => {
    const draft = await new Job({ title: 'Incomplete Draft', slug: 'direct-publish' }).save();
    draft.status = 'PUBLISHED';
    draft.publishedAt = new Date();
    await expect(draft.save()).rejects.toMatchObject({ name: 'ValidationError' });
    expect((await Job.findById(draft._id).lean()).status).toBe('DRAFT');
  });

  it('refuses a query update that would publish or rename a Job', async () => {
    const draft = await new Job(publishableJobFields({ slug: 'query-guarded' })).save();
    await expect(Job.updateOne({ _id: draft._id }, { $set: { status: 'PUBLISHED' } })).rejects.toBeInstanceOf(
      UnsupportedWriteError,
    );
    await expect(Job.updateOne({ _id: draft._id }, { $set: { slug: 'renamed' } })).rejects.toBeInstanceOf(
      UnsupportedWriteError,
    );
    const found = await Job.findById(draft._id).lean();
    expect(found.status).toBe('DRAFT');
    expect(found.slug).toBe('query-guarded');
  });

  it('refuses to rewrite submission history by save or by query, leaving the record unchanged', async () => {
    const job = await new Job(publishableJobFields({ slug: 'history-role' })).save();
    const saved = await buildApplication({
      job,
      candidate: { fullName: 'Jane Doe', email: 'jane@example.com' },
      resume: resumeFields({ storageKey: 'resumes/history' }),
      idempotencyKey: 'history-key',
    }).save();

    const loaded = await Application.findById(saved._id);
    loaded.jobSnapshot.title = 'Rewritten Title';
    await expect(loaded.save()).rejects.toMatchObject({ name: 'ValidationError' });

    await expect(
      Application.updateOne({ _id: saved._id }, { $set: { 'resume.storageKey': 'resumes/elsewhere' } }),
    ).rejects.toBeInstanceOf(UnsupportedWriteError);

    const found = await Application.findById(saved._id).lean();
    expect(found.jobSnapshot.title).toBe('Cybersecurity Specialist');
    expect(found.resume.storageKey).toBe('resumes/history');
  });

  it('records notification state only through a validated save', async () => {
    const job = await new Job(publishableJobFields({ slug: 'notification-role' })).save();
    const saved = await buildApplication({
      job,
      candidate: { fullName: 'Jane Doe', email: 'jane@example.com' },
      resume: resumeFields({ storageKey: 'resumes/notification' }),
      idempotencyKey: 'notification-key',
    }).save();

    const loaded = await Application.findById(saved._id);
    loaded.notifications.internal.status = 'FAILED';
    loaded.notifications.internal.lastErrorCode = 'PROVIDER_TIMEOUT';
    loaded.notifications.internal.attemptCount += 1;
    await loaded.save();

    const invalid = await Application.findById(saved._id);
    invalid.notifications.internal.status = 'MAYBE';
    await expect(invalid.save()).rejects.toMatchObject({ name: 'ValidationError' });

    const found = await Application.findById(saved._id).lean();
    expect(found.notifications.internal).toMatchObject({ status: 'FAILED', attemptCount: 1, lastErrorCode: 'PROVIDER_TIMEOUT' });
  });

  it("rejects the reviewer's four query bypasses and leaves the stored records unchanged", async () => {
    const draft = await new Job(publishableJobFields({ slug: 'bypass-role' })).save();
    const job = await publishJob(draft);
    const application = await buildApplication({
      job,
      candidate: { fullName: 'Jane Doe', email: 'jane@example.com' },
      resume: resumeFields({ storageKey: 'resumes/bypass' }),
      idempotencyKey: 'bypass-key',
    }).save();

    await expect(Job.updateOne({ _id: job._id, status: 'PUBLISHED' }, { $set: { description: '' } }))
      .rejects.toBeInstanceOf(UnsupportedWriteError);
    await expect(Job.updateOne({ _id: job._id, status: 'PUBLISHED' }, { $set: { 'applicationConfig.resumeRequired': false } }))
      .rejects.toBeInstanceOf(UnsupportedWriteError);
    await expect(Application.updateOne({ _id: application._id }, { $inc: { 'notifications.internal.attemptCount': -99 } }))
      .rejects.toBeInstanceOf(UnsupportedWriteError);
    await expect(Application.bulkWrite([
      { updateOne: { filter: { _id: application._id }, update: { $set: { 'notifications.internal.status': 'INVALID_STATUS' } } } },
    ])).rejects.toBeInstanceOf(UnsupportedWriteError);

    const storedJob = await Job.findById(job._id).lean();
    expect(storedJob.description).toBe('Approved role description.');
    expect(storedJob.applicationConfig.resumeRequired).toBe(true);
    const storedApplication = await Application.findById(application._id).lean();
    expect(storedApplication.notifications.internal).toMatchObject({ status: 'PENDING', attemptCount: 0 });
  });
});

describe('schema validation is enforced on write, not only in memory', () => {
  it('refuses to persist an Application with a malformed email address', async () => {
    const job = await new Job(publishableJobFields({ slug: 'email-role' })).save();
    const application = buildApplication({
      job,
      candidate: { fullName: 'Jane Doe', email: 'not-an-email' },
      resume: resumeFields(),
      idempotencyKey: 'email-key',
    });
    await expect(application.save()).rejects.toMatchObject({ name: 'ValidationError' });
    expect(await Application.countDocuments({})).toBe(0);
  });

  it('refuses to persist an Application with an unsupported resume type', async () => {
    const job = await new Job(publishableJobFields({ slug: 'validation-role' })).save();
    const application = buildApplication({
      job,
      candidate: { fullName: 'Jane Doe', email: 'jane@example.com' },
      resume: resumeFields({ extension: '.exe', mimeType: 'application/x-msdownload' }),
      idempotencyKey: 'validation-key',
    });

    await expect(application.save()).rejects.toBeTruthy();
    expect(await Application.countDocuments({})).toBe(0);
  });

  it('refuses to persist a Job with an out-of-range weeklyHours', async () => {
    await expect(new Job({ title: 'Bad Hours', slug: 'bad-hours', weeklyHours: 200 }).save()).rejects.toBeTruthy();
    expect(await Job.countDocuments({ slug: 'bad-hours' })).toBe(0);
  });
});
