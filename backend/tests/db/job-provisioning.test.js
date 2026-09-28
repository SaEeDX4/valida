import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Job } from '../../src/models/Job.js';
import { Application } from '../../src/models/Application.js';
import { REQUIRED_INDEXES } from '../../src/db/indexes.js';
import { buildApplication } from '../../src/modules/applications/application.service.js';
import { parseJobDefinition, provisionJob } from '../../src/modules/jobs/job.provisioning.js';
import { buildConnectedApp } from '../helpers.js';
import { syntheticDefinition, syntheticQuestions } from '../fixtures/jobFixtures.js';
import { requireTestDatabase, assertConnectedToTestDatabase } from './testDatabase.js';

/**
 * REAL-DATABASE SUITE — controlled Job provisioning (Milestone B3).
 *
 * Doc 18 sections 109-110, Doc 15 sections 171-175, Doc 12 sections 44-47,
 * Doc 10 sections 22, 48-59, 64-70.
 *
 * Every write here goes through provisionJob — and therefore through the
 * approved B2 services and validated saves — into the isolated test database.
 * These tests prove what cannot be shown without MongoDB: records are really
 * created and updated, re-running writes nothing, the unique slug index turns
 * a concurrent duplicate into a refusal rather than a second Job, lifecycle and
 * first-publication rules hold in stored data, and screening identifiers
 * survive re-provisioning. The last group runs the operator CLI itself.
 */
const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REAL_ROLE_FILE = join(backendRoot, 'provisioning', 'jobs', 'cybersecurity-specialist.json');

async function clearJobsAndApplications() {
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  await Job.deleteMany({});
  await Application.deleteMany({});
}

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
  await clearJobsAndApplications();
  await applyRequiredIndexes();
  await mongoose.disconnect();
});

beforeEach(clearJobsAndApplications);

const definitionOf = (raw) => {
  const parsed = parseJobDefinition(raw);
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.definition;
};

let clockTick = Date.parse('2026-10-01T12:00:00.000Z');
/** A strictly increasing server time per run, so timestamps are distinguishable. */
const nextNow = () => new Date((clockTick += 60_000));

const provision = (raw, options = {}) =>
  provisionJob({ definition: definitionOf(raw), apply: true, now: nextNow(), ...options });

const stored = (slug) => Job.findOne({ slug }).lean();
const codes = (result) => result.refusals.map((refusal) => refusal.code);

describe('create, re-run and update', () => {
  it('plan writes nothing', async () => {
    const result = await provisionJob({ definition: definitionOf(syntheticDefinition()), apply: false, now: nextNow() });
    expect(result.outcome).toBe('planned');
    expect(result.plan.action).toBe('create');
    expect(result.refusals).toEqual([]);
    expect(await Job.countDocuments({})).toBe(0);
  });

  it('apply creates exactly one validated DRAFT with the definition content', async () => {
    const result = await provision(syntheticDefinition());
    expect(result.outcome).toBe('created');
    expect(result.writes).toEqual(['created "qa-synthetic-provisioned-role" as DRAFT']);
    expect(result.failure).toBeNull();
    expect(result.readback).toBe('confirmed');
    expect(result.job).toMatchObject({ status: 'DRAFT', publishedAt: null, publicNow: 'NOT_PUBLIC' });

    const job = await stored('qa-synthetic-provisioned-role');
    expect(await Job.countDocuments({})).toBe(1);
    expect(job).toMatchObject({
      title: 'QA Synthetic Provisioned Role',
      internalOccupationalReference: 'NOC 99999 QA-INTERNAL',
      location: { displayName: 'QA Region, Canada', countryCode: 'CA', regionCode: 'QA', locality: null },
      workArrangement: 'FULLY_REMOTE',
      employmentType: 'CONTRACT',
      weeklyHours: 30,
      compensation: { currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: true },
      status: 'DRAFT',
      publishedAt: null,
      closedAt: null,
      archivedAt: null,
    });
    expect(job.createdAt).toBeInstanceOf(Date);
  });

  it('re-applying the same definition is a no-op: "unchanged", one record, updatedAt untouched', async () => {
    await provision(syntheticDefinition());
    const before = await stored('qa-synthetic-provisioned-role');

    for (let run = 0; run < 3; run += 1) {
      const again = await provision(syntheticDefinition());
      expect(again.outcome).toBe('unchanged');
    }
    const after = await stored('qa-synthetic-provisioned-role');
    expect(await Job.countDocuments({})).toBe(1);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.__v).toBe(before.__v);
  });

  it('updates only the fields that changed', async () => {
    await provision(syntheticDefinition());
    const result = await provision(syntheticDefinition({ weeklyHours: 25, schedule: 'QA TEST DATA revised schedule' }));
    expect(result.outcome).toBe('updated');
    expect(result.plan.changes).toEqual(['schedule', 'weeklyHours']);
    const job = await stored('qa-synthetic-provisioned-role');
    expect(job).toMatchObject({ weeklyHours: 25, schedule: 'QA TEST DATA revised schedule', title: 'QA Synthetic Provisioned Role' });
  });

  it('a different slug is a different Job; an existing Job is never renamed by provisioning', async () => {
    await provision(syntheticDefinition());
    await provision(syntheticDefinition({ slug: 'qa-synthetic-second-role' }));
    expect((await Job.find({}).lean()).map((job) => job.slug).sort()).toEqual([
      'qa-synthetic-provisioned-role',
      'qa-synthetic-second-role',
    ]);
  });
});

describe('the real initial role (Doc 18 section 110)', () => {
  const realRole = () => JSON.parse(readFileSync(REAL_ROLE_FILE, 'utf8'));

  it('is provisioned as a DRAFT that the public API does not expose', async () => {
    const result = await provision(realRole());
    expect(result.outcome).toBe('created');
    expect(result.plan.readiness.missing).toEqual(['employmentType', 'description', 'responsibilities', 'requirements']);

    const job = await stored('cybersecurity-specialist');
    expect(job).toMatchObject({
      status: 'DRAFT',
      publishedAt: null,
      title: 'Cybersecurity Specialist',
      internalOccupationalReference: 'NOC 21220',
      employmentType: null,
      schedule: null,
      description: '',
      responsibilities: [],
      requirements: [],
      compensation: { currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: true },
    });

    const app = buildConnectedApp();
    expect((await request(app).get('/api/v1/jobs')).body.data.items).toEqual([]);
    expect((await request(app).get('/api/v1/jobs/cybersecurity-specialist')).status).toBe(404);
  });

  it('cannot be published while its content is AWAITING INPUT — nothing is written', async () => {
    await provision(realRole());
    const before = await stored('cybersecurity-specialist');

    const attempt = await provision({ ...realRole(), status: 'PUBLISHED' }, { confirmLifecycle: true });
    expect(attempt.outcome).toBe('refused');
    expect(codes(attempt)).toEqual(['AWAITING_INPUT', 'NOT_PUBLISH_READY']);

    const after = await stored('cybersecurity-specialist');
    expect(after.status).toBe('DRAFT');
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });
});

describe('lifecycle through the B2 services', () => {
  const slug = 'qa-synthetic-provisioned-role';

  it('publishes only with explicit confirmation, then preserves the first publication through close and reopen', async () => {
    await provision(syntheticDefinition());

    const unconfirmed = await provision(syntheticDefinition({ status: 'PUBLISHED' }));
    expect(unconfirmed.outcome).toBe('refused');
    expect(codes(unconfirmed)).toEqual(['LIFECYCLE_CONFIRMATION_REQUIRED']);
    expect((await stored(slug)).status).toBe('DRAFT');

    const published = await provision(syntheticDefinition({ status: 'PUBLISHED' }), { confirmLifecycle: true });
    expect(published.outcome).toBe('updated');
    const firstPublication = (await stored(slug)).publishedAt;
    expect(firstPublication).toBeInstanceOf(Date);
    expect(published.job.publicNow).toBe('OPEN');

    expect((await provision(syntheticDefinition({ status: 'PUBLISHED' }))).outcome).toBe('unchanged');

    const closed = await provision(syntheticDefinition({ status: 'CLOSED' }), { confirmLifecycle: true });
    expect(closed.outcome).toBe('updated');
    const afterClose = await stored(slug);
    expect(afterClose).toMatchObject({ status: 'CLOSED' });
    expect(afterClose.closedAt).toBeInstanceOf(Date);
    expect(afterClose.publishedAt.getTime()).toBe(firstPublication.getTime());

    const reopened = await provision(syntheticDefinition({ status: 'PUBLISHED' }), { confirmLifecycle: true });
    expect(reopened.outcome).toBe('updated');
    const afterReopen = await stored(slug);
    expect(afterReopen).toMatchObject({ status: 'PUBLISHED', closedAt: null });
    expect(afterReopen.publishedAt.getTime()).toBe(firstPublication.getTime());
    expect(afterReopen.slug).toBe(slug);
  });

  it('creates and publishes a complete Job in one confirmed run, and the public API serves it', async () => {
    const result = await provision(syntheticDefinition({ status: 'PUBLISHED' }), { confirmLifecycle: true });
    expect(result.outcome).toBe('created');
    expect(result.job.status).toBe('PUBLISHED');

    // provisioning's clock is ahead of real time; the API uses the same stored publishedAt.
    const app = buildConnectedApp({ clock: () => new Date(clockTick + 1) });
    const response = await request(app).get(`/api/v1/jobs/${slug}`);
    expect(response.status).toBe(200);
    expect(response.body.data.applicationStatus).toBe('OPEN');
  });

  it('refuses undocumented transitions and never skips a lifecycle step', async () => {
    await provision(syntheticDefinition());
    const skip = await provision(syntheticDefinition({ status: 'CLOSED' }), { confirmLifecycle: true });
    expect(codes(skip)).toEqual(['INVALID_TRANSITION']);
    expect((await stored(slug)).status).toBe('DRAFT');
  });

  it('refuses to publish with a closing time that has already passed', async () => {
    await provision(syntheticDefinition());
    const result = await provision(
      syntheticDefinition({ status: 'PUBLISHED', closesAt: '2020-01-01T00:00:00.000Z' }),
      { confirmLifecycle: true },
    );
    expect(codes(result)).toEqual(['CLOSES_AT_NOT_FUTURE']);
    expect((await stored(slug)).status).toBe('DRAFT');
  });

  it('treats ARCHIVED as terminal: nothing changes it afterwards', async () => {
    await provision(syntheticDefinition());
    expect((await provision(syntheticDefinition({ status: 'ARCHIVED' }), { confirmLifecycle: true })).outcome).toBe('updated');
    const archived = await stored(slug);
    expect(archived.archivedAt).toBeInstanceOf(Date);

    for (const raw of [syntheticDefinition({ status: 'ARCHIVED', title: 'QA Synthetic Changed' }), syntheticDefinition({ status: 'PUBLISHED' })]) {
      const attempt = await provision(raw, { confirmLifecycle: true });
      expect(attempt.outcome).toBe('refused');
      expect(codes(attempt)).toContain('ARCHIVED_IS_TERMINAL');
    }
    const after = await stored(slug);
    expect(after.updatedAt.getTime()).toBe(archived.updatedAt.getTime());
    expect(after.title).toBe('QA Synthetic Provisioned Role');
  });

  it('requires a separate confirmation for a material change once Applications exist', async () => {
    await provision(syntheticDefinition({ status: 'PUBLISHED' }), { confirmLifecycle: true });
    const job = await Job.findOne({ slug });
    await buildApplication({
      job,
      candidate: { fullName: 'QA Test Candidate', email: 'qa+b3-001@example.test' },
      resume: {
        storageProvider: 'QA_TEST',
        storageKey: 'resumes/qa-b3-provisioning/0001',
        originalFilename: 'qa-test.pdf',
        extension: '.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        checksumSha256: 'b'.repeat(64),
        storedAt: new Date(),
      },
      idempotencyKey: 'qa-b3-provisioning-key-0001',
    }).save();

    const raise = syntheticDefinition({
      status: 'PUBLISHED',
      compensation: { currency: 'CAD', amountMinor: 4000, unit: 'HOUR', gross: true },
    });
    const refused = await provision(raise);
    expect(codes(refused)).toEqual(['MATERIAL_CHANGE_CONFIRMATION_REQUIRED']);
    expect((await stored(slug)).compensation.amountMinor).toBe(3500);

    const confirmed = await provision(raise, { confirmMaterialChange: true });
    expect(confirmed.outcome).toBe('updated');
    expect((await stored(slug)).compensation.amountMinor).toBe(4000);
  });
});

describe('effective closing and reopening through closesAt (correction 1, finding 1)', () => {
  const slug = 'qa-synthetic-provisioned-role';
  const T = new Date('2027-01-15T12:00:00.000Z');
  const at = (ms) => new Date(T.getTime() + ms);
  const MINUTE = 60_000;
  const provisionAt = (raw, now, options = {}) =>
    provisionJob({ definition: definitionOf(raw), apply: true, now, ...options });
  const publicApi = () => buildConnectedApp({ clock: () => T });

  /** A PUBLISHED Job first published two hours before T, with the given closing time. */
  async function publishedTwoHoursBefore(closesAt) {
    const created = await provisionAt(
      syntheticDefinition({ status: 'PUBLISHED', closesAt: closesAt ? closesAt.toISOString() : null }),
      at(-120 * MINUTE),
      { confirmLifecycle: true },
    );
    expect(created.outcome).toBe('created');
    return stored(slug);
  }

  it('reproduction: an expired Job reopened by clearing closesAt is refused unconfirmed (nothing stored changes), applied when confirmed', async () => {
    const before = await publishedTwoHoursBefore(at(-MINUTE));
    expect((await request(publicApi()).get(`/api/v1/jobs/${slug}`)).body.data.applicationStatus).toBe('CLOSED');

    const refused = await provisionAt(syntheticDefinition({ status: 'PUBLISHED', closesAt: null }), T);
    expect(refused.outcome).toBe('refused');
    expect(codes(refused)).toEqual(['LIFECYCLE_CONFIRMATION_REQUIRED']);
    expect(refused.plan.effectiveChange).toEqual({ from: 'CLOSED', to: 'OPEN', cause: 'closesAt' });
    const unchanged = await stored(slug);
    expect(unchanged.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(unchanged.closesAt.getTime()).toBe(at(-MINUTE).getTime());
    expect((await request(publicApi()).get('/api/v1/jobs')).body.data.items).toEqual([]);

    const confirmed = await provisionAt(syntheticDefinition({ status: 'PUBLISHED', closesAt: null }), T, { confirmLifecycle: true });
    expect(confirmed.outcome).toBe('updated');
    const after = await stored(slug);
    expect(after.closesAt).toBeNull();
    expect(after.status).toBe('PUBLISHED');
    expect(after.publishedAt.getTime()).toBe(before.publishedAt.getTime());
    const listed = await request(publicApi()).get('/api/v1/jobs');
    expect(listed.body.data.items.map((item) => item.slug)).toEqual([slug]);
  });

  it('inverse: an OPEN Job closed by a past closesAt is refused unconfirmed, applied when confirmed', async () => {
    const before = await publishedTwoHoursBefore(null);
    const past = at(-MINUTE).toISOString();

    const refused = await provisionAt(syntheticDefinition({ status: 'PUBLISHED', closesAt: past }), T);
    expect(codes(refused)).toEqual(['LIFECYCLE_CONFIRMATION_REQUIRED']);
    expect(refused.plan.effectiveChange).toEqual({ from: 'OPEN', to: 'CLOSED', cause: 'closesAt' });
    expect((await stored(slug)).updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect((await request(publicApi()).get('/api/v1/jobs')).body.data.items).toHaveLength(1);

    const confirmed = await provisionAt(syntheticDefinition({ status: 'PUBLISHED', closesAt: past }), T, { confirmLifecycle: true });
    expect(confirmed.outcome).toBe('updated');
    expect((await request(publicApi()).get('/api/v1/jobs')).body.data.items).toEqual([]);
    const detail = await request(publicApi()).get(`/api/v1/jobs/${slug}`);
    expect(detail.body.data).toMatchObject({ applicationStatus: 'CLOSED', applicationForm: null });
  });

  it('boundaries: closesAt exactly now needs confirmation; 1 ms later only schedules the close', async () => {
    const before = await publishedTwoHoursBefore(null);

    const atNow = await provisionAt(syntheticDefinition({ status: 'PUBLISHED', closesAt: T.toISOString() }), T);
    expect(codes(atNow)).toEqual(['LIFECYCLE_CONFIRMATION_REQUIRED']);
    expect((await stored(slug)).updatedAt.getTime()).toBe(before.updatedAt.getTime());

    const later = await provisionAt(syntheticDefinition({ status: 'PUBLISHED', closesAt: at(1).toISOString() }), T);
    expect(later.outcome).toBe('updated');
    expect(later.plan.effectiveChange).toBeNull();
    expect((await stored(slug)).closesAt.getTime()).toBe(at(1).getTime());
    expect((await request(publicApi()).get(`/api/v1/jobs/${slug}`)).body.data.applicationStatus).toBe('OPEN');
  });

  it('an already-expired Job re-applied unchanged writes nothing and needs no confirmation', async () => {
    const closesAt = at(-30 * MINUTE);
    const before = await publishedTwoHoursBefore(closesAt);

    // Open when it was published; expired by T purely through the passage of time.
    const result = await provisionAt(syntheticDefinition({ status: 'PUBLISHED', closesAt: closesAt.toISOString() }), T);
    expect(result.outcome).toBe('unchanged');
    expect(result.plan).toMatchObject({ publicBefore: 'CLOSED', publicAfter: 'CLOSED', effectiveChange: null });
    expect(result.writes).toEqual([]);
    expect((await stored(slug)).updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });
});

describe('duplicate slugs are impossible', () => {
  it('two concurrent provisioning runs for one new slug leave exactly one Job', async () => {
    const results = await Promise.all([provision(syntheticDefinition()), provision(syntheticDefinition())]);
    expect(await Job.countDocuments({ slug: 'qa-synthetic-provisioned-role' })).toBe(1);
    expect(results.filter((result) => result.outcome === 'created')).toHaveLength(1);
    results
      .filter((result) => result.outcome !== 'created')
      .forEach((result) => {
        expect(['refused', 'unchanged']).toContain(result.outcome);
        if (result.outcome === 'refused') expect(codes(result)).toEqual(['DUPLICATE_SLUG']);
      });
  });

  it('refuses to write while the unique slug index is missing, so uniqueness never rests on the lookup alone', async () => {
    assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
    await mongoose.connection.db.collection('jobs').dropIndex('slug_unique');
    try {
      const result = await provision(syntheticDefinition());
      expect(result.outcome).toBe('refused');
      expect(codes(result)).toEqual(['INDEXES_MISSING']);
      expect(await Job.countDocuments({})).toBe(0);
    } finally {
      await applyRequiredIndexes();
    }
  });
});

describe('screening identifiers survive re-provisioning (Doc 10 sections 48, 53)', () => {
  const slug = 'qa-synthetic-provisioned-role';
  const withQuestions = (questions) =>
    syntheticDefinition({ applicationConfig: { ...syntheticDefinition().applicationConfig, screeningQuestions: questions } });
  const idsOf = async () => {
    const job = await stored(slug);
    return job.applicationConfig.screeningQuestions.map((question) => ({
      questionId: question.questionId,
      options: question.options.map((option) => option.optionId),
    }));
  };

  it('generates UUIDs once and keeps them on every later run', async () => {
    await provision(withQuestions(syntheticQuestions()));
    const first = await idsOf();
    first.forEach(({ questionId }) => expect(questionId).toMatch(/^[0-9a-f-]{36}$/));
    expect(first[1].options).toHaveLength(2);

    expect((await provision(withQuestions(syntheticQuestions()))).outcome).toBe('unchanged');
    expect(await idsOf()).toEqual(first);

    // Reordering questions and adding an option keeps every existing identifier.
    const [yesNo, select] = syntheticQuestions();
    select.options = [{ label: 'QA option B' }, { label: 'QA option A' }, { label: 'QA option C' }];
    expect((await provision(withQuestions([select, yesNo]))).outcome).toBe('updated');
    const reordered = await idsOf();
    expect(reordered[0].questionId).toBe(first[1].questionId);
    expect(reordered[1].questionId).toBe(first[0].questionId);
    expect(reordered[0].options.slice(0, 2)).toEqual([first[1].options[1], first[1].options[0]]);
    expect(reordered[0].options[2]).not.toBe(first[1].options[0]);
  });

  it('keeps an identifier through a reworded prompt when the definition names it, and refuses an unknown one', async () => {
    await provision(withQuestions(syntheticQuestions()));
    const [first] = await idsOf();

    const [yesNo, select] = syntheticQuestions();
    const reworded = await provision(withQuestions([{ ...yesNo, questionId: first.questionId, prompt: 'QA TEST DATA: reworded?' }, select]));
    expect(reworded.outcome).toBe('updated');
    expect((await idsOf())[0].questionId).toBe(first.questionId);

    const before = await stored(slug);
    const invented = await provision(
      withQuestions([{ ...yesNo, questionId: '99999999-9999-4999-8999-999999999999' }, select]),
    );
    expect(codes(invented)).toEqual(['UNKNOWN_QUESTION_ID']);
    expect((await stored(slug)).updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });
});

describe('the provisioning CLI against the test database', () => {
  const cli = (args) => {
    const result = spawnSync(process.execPath, ['scripts/provision-job.mjs', ...args], {
      cwd: backendRoot,
      // MONGODB_URI is the APPROVED test target only (guarded at the top of this file).
      env: { ...process.env, MONGODB_URI: TEST_URI, MONGODB_CONNECT_TIMEOUT_MS: '5000' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    return { code: result.status, output: `${result.stdout}${result.stderr}` };
  };

  it('plan, apply and re-apply behave as documented and never print the connection string', () => {
    const dir = mkdtempSync(join(tmpdir(), 'valida-b3-cli-'));
    try {
      const file = join(dir, 'qa-definition.json');
      writeFileSync(file, JSON.stringify(syntheticDefinition({ slug: 'qa-cli-role' })));

      const plan = cli(['plan', '--file', file]);
      expect(plan.code).toBe(0);
      expect(plan.output).toMatch(/PLAN OK — apply would succeed/);
      expect(plan.output).toMatch(new RegExp(`database\\s+: ${TEST_DATABASE}`));

      const created = cli(['apply', '--file', file]);
      expect(created.code).toBe(0);
      expect(created.output).toMatch(/result\s+: CREATED/);

      const again = cli(['apply', '--file', file]);
      expect(again.code).toBe(0);
      expect(again.output).toMatch(/UNCHANGED — the stored Job already matches; nothing was written/);

      writeFileSync(file, JSON.stringify(syntheticDefinition({ slug: 'qa-cli-role', status: 'PUBLISHED' })));
      const unconfirmed = cli(['apply', '--file', file]);
      expect(unconfirmed.code).toBe(1);
      expect(unconfirmed.output).toMatch(/LIFECYCLE_CONFIRMATION_REQUIRED/);

      const published = cli(['apply', '--file', file, '--confirm-lifecycle']);
      expect(published.code).toBe(0);
      expect(published.output).toMatch(/status\s+: PUBLISHED/);

      for (const { output } of [plan, created, again, unconfirmed, published]) {
        expect(output).not.toContain(TEST_URI);
        expect(output).not.toMatch(/mongodb(\+srv)?:\/\//);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('provisions the committed real initial role file as DRAFT through the CLI', async () => {
    const result = cli(['apply', '--file', REAL_ROLE_FILE]);
    expect(result.code).toBe(0);
    expect(result.output).toMatch(/result\s+: CREATED/);
    expect(result.output).toMatch(/awaiting input\s+: employmentType, schedule, description/);
    expect((await stored('cybersecurity-specialist')).status).toBe('DRAFT');

    const publish = cli(['apply', '--file', REAL_ROLE_FILE, '--confirm-lifecycle']);
    expect(publish.code).toBe(0); // status in the file is DRAFT: nothing to publish
    expect(publish.output).toMatch(/UNCHANGED/);
  }, 120_000);
});
