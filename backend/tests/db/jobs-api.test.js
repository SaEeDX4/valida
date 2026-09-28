import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Job } from '../../src/models/Job.js';
import { Application } from '../../src/models/Application.js';
import { REQUIRED_INDEXES } from '../../src/db/indexes.js';
import { applyJobEdit, archiveJob, closeJob, publishJob } from '../../src/modules/jobs/job.service.js';
import { LIST_PROJECTION } from '../../src/modules/jobs/job.repository.js';
import { PUBLIC_LIST_SORT, openJobsFilter } from '../../src/modules/jobs/job.visibility.js';
import { buildConnectedApp, capturingLogger, freePort } from '../helpers.js';
import { QA_NOW, at, minutes } from '../fixtures/jobFixtures.js';
import { requireTestDatabase, assertConnectedToTestDatabase } from './testDatabase.js';

/**
 * REAL-DATABASE SUITE — public Jobs API (Milestone B3).
 *
 * Doc 09 sections 48-70, 192-194, 213; Doc 18 sections 107-112; Doc 17
 * sections 83-89 (QA-P1-API-001, QA-P1-API-002).
 *
 * Every Job below is written through the approved B2 path (validated save,
 * publishJob / closeJob / archiveJob) into the isolated test database, and
 * every response is produced by the production repository querying MongoDB
 * through the full Express stack. Nothing here is stubbed: this is the
 * evidence that the Careers data is real and DB-backed, that MongoDB selects
 * exactly the open Jobs, and that the effective-closing boundaries hold in the
 * database query itself.
 *
 * The server clock is injected (QA_NOW) so the exact publishedAt / closesAt
 * boundaries can be tested (Doc 17 section 39).
 */
const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

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

const connect = () =>
  mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false });

beforeAll(async () => {
  await connect();
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  await applyRequiredIndexes();
}, 30_000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 1) await connect();
  await clearJobsAndApplications();
  await mongoose.disconnect();
});

beforeEach(clearJobsAndApplications);

// ------------------------------------------------------ synthetic Jobs --

const QUESTION_PROMPT = 'QA TEST DATA: can you work the stated hours?';
const SELECT_PROMPT = 'QA TEST DATA: preferred start window?';

const content = (slug, overrides = {}) => ({
  title: `QA Synthetic ${slug}`,
  slug,
  internalOccupationalReference: 'NOC 21220 QA-INTERNAL',
  location: { displayName: 'QA Region, Canada', countryCode: 'CA', regionCode: 'QA' },
  workArrangement: 'FULLY_REMOTE',
  employmentType: 'CONTRACT',
  schedule: 'QA TEST DATA schedule wording',
  weeklyHours: 30,
  compensation: { currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: true },
  description: 'QA TEST DATA description.',
  responsibilities: ['QA TEST DATA responsibility.'],
  requirements: ['QA TEST DATA requirement.'],
  applicationConfig: {
    phone: { enabled: true, required: false },
    message: { enabled: true, required: false, maxLength: 1500 },
    screeningQuestions: [
      { type: 'YES_NO', prompt: QUESTION_PROMPT, required: true },
      { type: 'SINGLE_SELECT', prompt: SELECT_PROMPT, required: false, options: [{ label: 'QA A' }, { label: 'QA B' }] },
    ],
  },
  ...overrides,
});

const draftJob = (slug, overrides) => new Job(content(slug, overrides)).save();

async function publishedJob(slug, { publishedAt = at(-minutes(60)), ...overrides } = {}) {
  const job = await draftJob(slug, overrides);
  await publishJob(job, { now: publishedAt });
  return job;
}

async function closedJob(slug, overrides) {
  const job = await publishedJob(slug, overrides);
  await closeJob(job, { now: at(-minutes(10)) });
  return job;
}

async function archivedAfterClosing(slug) {
  const job = await closedJob(slug);
  await archiveJob(job, { now: at(-minutes(5)) });
  return job;
}

async function archivedDraft(slug) {
  const job = await draftJob(slug);
  await archiveJob(job, { now: at(-minutes(5)) });
  return job;
}

const app = (options = {}) => buildConnectedApp({ clock: () => QA_NOW, ...options });
const list = (query = '') => request(app()).get(`/api/v1/jobs${query}`);
const detail = (slug) => request(app()).get(`/api/v1/jobs/${slug}`);
const slugsOf = (response) => response.body.data.items.map((item) => item.slug);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const INTERNAL_TEXT = [
  'NOC 21220', 'QA-INTERNAL', 'internalOccupationalReference', '"_id"', '__v', 'createdAt', 'updatedAt',
  'closedAt', 'archivedAt', 'amountMinor', 'resumeRequired', 'countryCode', 'regionCode', 'questionId',
];

// --------------------------------------------------------- the list --

describe('GET /api/v1/jobs over MongoDB', () => {
  it('zero Jobs in the database -> 200 with an empty list (never 404)', async () => {
    const response = await list();
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data).toEqual({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
  });

  it('QA-P1-API-001: returns the open Job, read from MongoDB, as the exact public DTO', async () => {
    await publishedJob('qa-open-role', { publishedAt: at(-minutes(90)) });

    const response = await list();
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      items: [
        {
          title: 'QA Synthetic qa-open-role',
          slug: 'qa-open-role',
          location: 'QA Region, Canada',
          workArrangement: 'FULLY_REMOTE',
          employmentType: 'CONTRACT',
          schedule: 'QA TEST DATA schedule wording',
          weeklyHours: 30,
          compensation: { currency: 'CAD', amount: 35, unit: 'HOUR', gross: true },
          publishedAt: at(-minutes(90)).toISOString(),
          closesAt: null,
          applicationStatus: 'OPEN',
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    INTERNAL_TEXT.forEach((text) => expect(response.text).not.toContain(text));
  });

  it('reflects a change made in MongoDB on the next request — nothing is hard-coded or cached', async () => {
    const job = await publishedJob('qa-live-role');
    expect((await list()).body.data.items[0].title).toBe('QA Synthetic qa-live-role');

    applyJobEdit(job, { title: 'QA Synthetic Retitled Role', compensation: { currency: 'CAD', amountMinor: 3650, unit: 'HOUR', gross: true } });
    await job.save();

    const after = await list();
    expect(after.body.data.items[0]).toMatchObject({
      title: 'QA Synthetic Retitled Role',
      compensation: { currency: 'CAD', amount: 36.5, unit: 'HOUR', gross: true },
    });

    await closeJob(job, { now: at(-1) });
    expect((await list()).body.data.items).toEqual([]);
  });

  it('lists only effectively OPEN Jobs: Draft, Closed, Archived, expired and future Jobs are excluded', async () => {
    await publishedJob('qa-open-earlier', { publishedAt: at(-minutes(60)) });
    await publishedJob('qa-open-later', { publishedAt: at(-minutes(30)), closesAt: at(minutes(120)) });
    await draftJob('qa-draft');
    await closedJob('qa-closed');
    await archivedDraft('qa-archived-draft');
    await archivedAfterClosing('qa-archived-closed');
    await publishedJob('qa-expired', { closesAt: at(-minutes(1)) });
    await publishedJob('qa-future', { publishedAt: at(minutes(30)) });

    expect(await Job.countDocuments({})).toBe(8);
    const response = await list();
    expect(response.status).toBe(200);
    expect(slugsOf(response)).toEqual(['qa-open-later', 'qa-open-earlier']);
    expect(response.body.data.pagination).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
    response.body.data.items.forEach((item) => expect(item.applicationStatus).toBe('OPEN'));
  });

  it('applies the effective-closing boundaries in the database query itself', async () => {
    await publishedJob('qa-published-exactly-now', { publishedAt: QA_NOW });
    await publishedJob('qa-closes-exactly-now', { closesAt: QA_NOW });
    await publishedJob('qa-closes-one-ms-later', { closesAt: at(1) });
    await publishedJob('qa-published-one-ms-later', { publishedAt: at(1) });

    const response = await list();
    expect(slugsOf(response).sort()).toEqual(['qa-closes-one-ms-later', 'qa-published-exactly-now']);

    // The detail endpoint labels the same boundaries consistently.
    expect((await detail('qa-published-exactly-now')).body.data.applicationStatus).toBe('OPEN');
    expect((await detail('qa-closes-one-ms-later')).body.data.applicationStatus).toBe('OPEN');
    const closesNow = await detail('qa-closes-exactly-now');
    expect(closesNow.status).toBe(200);
    expect(closesNow.body.data).toMatchObject({ applicationStatus: 'CLOSED', applicationForm: null });
    expect((await detail('qa-published-one-ms-later')).status).toBe(404);
  });

  it('sorts publishedAt DESC then createdAt DESC and paginates with correct totals', async () => {
    await publishedJob('qa-tie-created-first', { publishedAt: at(-minutes(240)) });
    await pause(15);
    await publishedJob('qa-tie-created-second', { publishedAt: at(-minutes(240)) });
    await publishedJob('qa-three-hours', { publishedAt: at(-minutes(180)) });
    await publishedJob('qa-one-hour', { publishedAt: at(-minutes(60)) });
    await publishedJob('qa-two-hours', { publishedAt: at(-minutes(120)) });

    const expectedOrder = ['qa-one-hour', 'qa-two-hours', 'qa-three-hours', 'qa-tie-created-second', 'qa-tie-created-first'];
    expect(slugsOf(await list())).toEqual(expectedOrder);

    const pages = [];
    for (const page of [1, 2, 3]) {
      const response = await list(`?page=${page}&limit=2`);
      expect(response.body.data.pagination).toEqual({ page, limit: 2, total: 5, totalPages: 3 });
      pages.push(...slugsOf(response));
    }
    expect(pages).toEqual(expectedOrder);

    const beyond = await list('?page=4&limit=2');
    expect(beyond.status).toBe(200);
    expect(beyond.body.data).toEqual({ items: [], pagination: { page: 4, limit: 2, total: 5, totalPages: 3 } });
  });

  it('rejects invalid pagination and injection-shaped parameters with 422, exposing nothing', async () => {
    await draftJob('qa-hidden-draft');
    for (const query of ['?page=0', '?limit=51', '?page[$gt]=0', '?status=DRAFT', '?slug[$ne]=x', '?limit=5&limit=6']) {
      const response = await list(query);
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.text).not.toContain('qa-hidden-draft');
    }
  });

  it('uses the public_listing index for the open-Jobs query (Doc 10 section 67)', async () => {
    await publishedJob('qa-indexed-role');
    const explanation = await Job.find(openJobsFilter(QA_NOW), LIST_PROJECTION)
      .sort(PUBLIC_LIST_SORT)
      .explain('queryPlanner');
    // MongoDB's own plan report: the classic winningPlan tree, or for the
    // slot-based engine winningPlan.queryPlan — both carry stage/indexName.
    const winningPlan = JSON.stringify((Array.isArray(explanation) ? explanation[0] : explanation).queryPlanner?.winningPlan);
    expect(winningPlan).toMatch(/"stage":"IXSCAN"/);
    expect(winningPlan).toMatch(/"indexName":"public_listing"/);
    expect(winningPlan).not.toMatch(/COLLSCAN/);
  });
});

// ------------------------------------------------------- the detail --

describe('GET /api/v1/jobs/:jobSlug over MongoDB', () => {
  it('QA-P1-API-002: an OPEN Job returns its complete detail, with stored screening identifiers', async () => {
    const job = await publishedJob('qa-detail-open', { closesAt: at(minutes(600)) });
    const [yesNo, select] = job.applicationConfig.screeningQuestions;

    const response = await detail('qa-detail-open');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data).toEqual({
      title: 'QA Synthetic qa-detail-open',
      slug: 'qa-detail-open',
      location: 'QA Region, Canada',
      workArrangement: 'FULLY_REMOTE',
      employmentType: 'CONTRACT',
      schedule: 'QA TEST DATA schedule wording',
      weeklyHours: 30,
      compensation: { currency: 'CAD', amount: 35, unit: 'HOUR', gross: true },
      description: 'QA TEST DATA description.',
      responsibilities: ['QA TEST DATA responsibility.'],
      requirements: ['QA TEST DATA requirement.'],
      preferredQualifications: [],
      publishedAt: at(-minutes(60)).toISOString(),
      closesAt: at(minutes(600)).toISOString(),
      applicationStatus: 'OPEN',
      applicationForm: {
        phone: { enabled: true, required: false },
        message: { enabled: true, required: false, maxLength: 1500 },
        resume: { required: true, maxBytes: 5242880, allowedExtensions: ['.pdf', '.docx'] },
        screeningQuestions: [
          { id: yesNo.questionId, type: 'YES_NO', prompt: QUESTION_PROMPT, required: true, options: [] },
          {
            id: select.questionId,
            type: 'SINGLE_SELECT',
            prompt: SELECT_PROMPT,
            required: false,
            options: select.options.map((option) => ({ optionId: option.optionId, label: option.label })),
          },
        ],
      },
    });
    expect(yesNo.questionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    INTERNAL_TEXT.forEach((text) => expect(response.text).not.toContain(text));
    expect(response.text).not.toContain(String(job._id));
  });

  it('a retained CLOSED Job keeps its public detail with applicationStatus CLOSED and applicationForm null', async () => {
    await closedJob('qa-detail-closed');
    const response = await detail('qa-detail-closed');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      slug: 'qa-detail-closed',
      description: 'QA TEST DATA description.',
      responsibilities: ['QA TEST DATA responsibility.'],
      applicationStatus: 'CLOSED',
      applicationForm: null,
    });
  });

  it('an expired PUBLISHED Job keeps its public detail as CLOSED', async () => {
    await publishedJob('qa-detail-expired', { closesAt: at(-minutes(1)) });
    const response = await detail('qa-detail-expired');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ applicationStatus: 'CLOSED', applicationForm: null });
  });

  it('Draft, Archived, future-unpublished, unknown and invalid slugs give the identical 404', async () => {
    await draftJob('qa-detail-draft');
    await archivedDraft('qa-detail-archived-draft');
    await archivedAfterClosing('qa-detail-archived-closed');
    await publishedJob('qa-detail-future', { publishedAt: at(minutes(5)) });

    const bodies = new Set();
    for (const slug of [
      'qa-detail-draft',
      'qa-detail-archived-draft',
      'qa-detail-archived-closed',
      'qa-detail-future',
      'qa-never-existed',
      'QA-DETAIL-DRAFT',
      '%7B%22%24ne%22%3Anull%7D',
      '%E0%A4%A',
    ]) {
      const response = await detail(slug);
      expect(response.status, slug).toBe(404);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body.error).toEqual({ code: 'JOB_NOT_FOUND', message: "This role isn't available." });
      expect(response.text).not.toMatch(/QA Synthetic|QA TEST DATA|DRAFT|ARCHIVED|NOC/);
      const { meta, ...rest } = response.body;
      bodies.add(JSON.stringify(rest));
    }
    expect(bodies.size).toBe(1);
  });
});

// ------------------------------------------------- database failure --

describe('database failure over the real connection', () => {
  it('with MongoDB disconnected, list and detail answer 503 promptly — never an empty success', async () => {
    await publishedJob('qa-outage-role');
    const { logger, output } = capturingLogger();
    const outageApp = app({ logger });
    await mongoose.disconnect();
    try {
      for (const path of ['/api/v1/jobs', '/api/v1/jobs/qa-outage-role']) {
        const started = Date.now();
        const response = await request(outageApp).get(path);
        expect(response.status).toBe(503);
        expect(response.body).toEqual({
          success: false,
          error: { code: 'SERVICE_UNAVAILABLE', message: 'Service is not ready.' },
          meta: { requestId: expect.any(String) },
        });
        expect(Date.now() - started).toBeLessThan(2000);
      }
      expect(output()).toContain('"reason":"disconnected"');
      expect(output()).not.toContain(TEST_URI);
    } finally {
      await connect();
    }
    // Recovered: the same app serves again once the connection returns.
    const recovered = await request(outageApp).get('/api/v1/jobs');
    expect(recovered.status).toBe(200);
    expect(slugsOf(recovered)).toEqual(['qa-outage-role']);
  }, 30_000);
});

// ------------------------------------------- the real server process --

/** Spawns `node src/server.js` and resolves once it logs that it is listening. */
function startServerProcess(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/server.js'], {
      cwd: backendRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timer = setTimeout(() => reject(new Error('server did not start')), 20_000);
    const onData = (chunk) => {
      output += chunk;
      if (/backend listening/.test(output)) {
        clearTimeout(timer);
        resolve({ child, output: () => output });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', () => {
      clearTimeout(timer);
      reject(new Error('server exited before listening'));
    });
  });
}

describe('`node src/server.js` serves Jobs from MongoDB', () => {
  it('returns a Job seeded in the test database through the real server, while readiness stays 503', async () => {
    await publishedJob('qa-server-role', { publishedAt: new Date(Date.now() - minutes(5)) });
    await draftJob('qa-server-draft');

    const port = await freePort();
    const { child, output } = await startServerProcess({
      APP_ENV: 'local',
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      PORT: String(port),
      MONGODB_URI: TEST_URI,
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
    });
    try {
      const base = `http://127.0.0.1:${port}`;
      const listed = await request(base).get('/api/v1/jobs');
      expect(listed.status).toBe(200);
      expect(listed.body.data.items.map((item) => item.slug)).toEqual(['qa-server-role']);

      const shown = await request(base).get('/api/v1/jobs/qa-server-role');
      expect(shown.status).toBe(200);
      expect(shown.body.data.applicationStatus).toBe('OPEN');

      expect((await request(base).get('/api/v1/jobs/qa-server-draft')).status).toBe(404);
      expect((await request(base).get('/api/v1/health/ready')).status).toBe(503);

      expect(output()).not.toContain(TEST_URI);
      expect(output()).not.toMatch(/mongodb(\+srv)?:\/\//);
    } finally {
      child.kill('SIGTERM');
    }
  }, 40_000);
});
