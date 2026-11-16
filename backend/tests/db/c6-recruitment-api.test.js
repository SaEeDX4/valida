import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/env.js';
import { Job } from '../../src/models/Job.js';
import { Application } from '../../src/models/Application.js';
import { REQUIRED_INDEXES } from '../../src/db/indexes.js';
import { createJobRepository } from '../../src/modules/jobs/job.repository.js';
import { archiveJob, closeJob, publishJob } from '../../src/modules/jobs/job.service.js';
import { createApplicationRepository } from '../../src/modules/applications/application.repository.js';
import { createNotificationService } from '../../src/integrations/notifications/notificationService.js';
import { Readiness, DEPENDENCY_STATE } from '../../src/modules/health/readiness.js';
import { capturingLogger, freePort } from '../helpers.js';
import { syntheticPdf } from '../fixtures/resumeFiles.js';
import { createIntakeEnvironment } from '../fixtures/uploadHarness.js';
import { QA_NOTIFICATION_OPTIONS, applyPath, applyRequest, recordingTransport } from '../fixtures/applyHarness.js';
import { requireTestDatabase, assertConnectedToTestDatabase } from './testDatabase.js';

/**
 * C6-T1 REAL-DATABASE SUITE — recruitment access over a REAL MongoDB.
 *
 * The real app (createApp) with the REAL Job and Application repositories,
 * the real unique indexes, REAL local private storage in a fresh temporary
 * root, and the real notification boundary with a recording transport double
 * (nothing is ever sent). Five synthetic Jobs written through the approved
 * lifecycle service — open, closed, Draft, archived, published in the future —
 * are read in every recruitment mode.
 *
 * What it shows that the offline suite cannot: with real data in the
 * database, a refused client gets nothing and changes nothing; a client that
 * is let through meets exactly the accepted Job lifecycle; and a real
 * `node src/server.js` with no recruitment variable serves no Job although
 * an open one exists.
 *
 * Synthetic data only; only the approved disposable test database is touched.
 */
const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONNECT = { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false };
const JOBS = '/api/v1/jobs';
const OD = 'OD-2026-11-15-01';
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const SLUGS = { open: 'qa-c6-open-role', closed: 'qa-c6-closed-role', draft: 'qa-c6-draft-role', archived: 'qa-c6-archived-role', future: 'qa-c6-future-role' };

function jobDocument(slug) {
  return new Job({
    title: `QA Synthetic ${slug}`,
    slug,
    location: { displayName: 'QA Region, Canada', countryCode: 'CA' },
    workArrangement: 'FULLY_REMOTE',
    employmentType: 'PART_TIME',
    schedule: 'QA TEST DATA schedule',
    weeklyHours: 30,
    compensation: { currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: true },
    description: 'QA TEST DATA description.',
    responsibilities: ['QA TEST DATA responsibility.'],
    requirements: ['QA TEST DATA requirement.'],
    applicationConfig: {
      resumeRequired: true,
      phone: { enabled: true, required: false },
      message: { enabled: true, required: false, maxLength: 2000 },
      screeningQuestions: [
        { questionId: '11111111-1111-4111-8111-111111111111', type: 'YES_NO', prompt: 'QA TEST DATA: can you work the stated hours?', required: true },
        {
          questionId: '22222222-2222-4222-8222-222222222222',
          type: 'SINGLE_SELECT',
          prompt: 'QA TEST DATA: preferred start window?',
          required: false,
          options: [
            { optionId: '33333333-3333-4333-8333-333333333333', label: 'QA option A' },
            { optionId: '44444444-4444-4444-8444-444444444444', label: 'QA option B' },
          ],
        },
        { questionId: '55555555-5555-4555-8555-555555555555', type: 'SHORT_TEXT', prompt: 'QA TEST DATA: short answer?', required: false },
      ],
    },
  });
}

/** One Job in every lifecycle state, written through the B2 lifecycle service. */
async function seedLifecycle() {
  const hourAgo = new Date(Date.now() - 3_600_000);
  const open = await jobDocument(SLUGS.open).save();
  await publishJob(open, { now: hourAgo });
  const closed = await jobDocument(SLUGS.closed).save();
  await publishJob(closed, { now: hourAgo });
  await closeJob(closed, { now: new Date(Date.now() - 600_000) });
  await jobDocument(SLUGS.draft).save();
  const archived = await jobDocument(SLUGS.archived).save();
  await publishJob(archived, { now: hourAgo });
  await closeJob(archived, { now: new Date(Date.now() - 600_000) });
  await archiveJob(archived, { now: new Date(Date.now() - 300_000) });
  const future = await jobDocument(SLUGS.future).save();
  await publishJob(future, { now: new Date(Date.now() + 3_600_000) });
}

async function clearSuiteCollections() {
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  await Application.deleteMany({});
  await Job.deleteMany({});
}

beforeAll(async () => {
  await mongoose.connect(TEST_URI, CONNECT);
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  for (const required of REQUIRED_INDEXES) {
    await mongoose.connection.db.collection(required.collection).createIndex(required.key, { name: required.name, ...required.options });
  }
}, 30_000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(TEST_URI, CONNECT);
  await clearSuiteCollections();
  await mongoose.disconnect();
}, 30_000);

let intake;
let log;
beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(TEST_URI, CONNECT);
  await clearSuiteCollections();
  await seedLifecycle();
  log = capturingLogger();
  intake = await createIntakeEnvironment({ logger: log.logger });
});
afterEach(async () => {
  await intake.cleanup();
});

const LOCAL = { NODE_ENV: 'test', APP_ENV: 'local', PORT: '4100', MONGODB_URI: TEST_URI, CORS_ALLOWED_ORIGINS: 'http://localhost:5173' };
// C6-T3 correction 1: production requires SITE_ACCESS=public explicitly.
const PRODUCTION = { NODE_ENV: 'production', APP_ENV: 'production', PORT: '4100', MONGODB_URI: TEST_URI, CORS_ALLOWED_ORIGINS: 'https://qa-valida.example.test', SITE_ACCESS: 'public' };

/**
 * The configurations under test, each produced by the REAL loader from an
 * environment. `public` is a production configuration: it is tested here in
 * isolation, with the storage and repositories injected, because a
 * production configuration (rightly) has no local storage driver.
 */
const CONFIGURATIONS = {
  'nothing configured': { env: LOCAL, mode: 'closed' },
  'RECRUITMENT_MODE=closed': { env: { ...LOCAL, RECRUITMENT_MODE: 'closed' }, mode: 'closed' },
  'a misspelt mode': { env: { ...LOCAL, RECRUITMENT_MODE: 'pubilc' }, mode: 'closed' },
  'public in a non-production environment': { env: { ...LOCAL, RECRUITMENT_MODE: 'public', RECRUITMENT_PUBLIC_AUTHORISATION: OD }, mode: 'closed' },
  'production with nothing configured': { env: PRODUCTION, mode: 'closed' },
  'production, public without an authorisation': { env: { ...PRODUCTION, RECRUITMENT_MODE: 'public' }, mode: 'closed' },
  'testers, client not listed': { env: { ...LOCAL, RECRUITMENT_MODE: 'testers', ACCESS_ALLOWLIST: '203.0.113.0/24' }, mode: 'testers' },
  'testers, client listed': { env: { ...LOCAL, RECRUITMENT_MODE: 'testers', ACCESS_ALLOWLIST: '127.0.0.1/32,::1/128' }, mode: 'testers' },
  'production, public with an authorisation': { env: { ...PRODUCTION, RECRUITMENT_MODE: 'public', RECRUITMENT_PUBLIC_AUTHORISATION: OD }, mode: 'public' },
};

function realApp(name) {
  const { env, mode } = CONFIGURATIONS[name];
  const config = loadConfig(env);
  expect(config.recruitment.mode).toBe(mode);
  const calls = { jobs: 0, applications: 0 };
  const counted = (repository, counter) =>
    Object.fromEntries(
      Object.entries(repository).map(([key, value]) => [
        key,
        typeof value === 'function'
          ? (...args) => {
              calls[counter] += 1;
              return value(...args);
            }
          : value,
      ]),
    );
  const transport = recordingTransport('accept');
  const readiness = new Readiness();
  readiness.set('configuration', DEPENDENCY_STATE.READY);
  readiness.set('database', DEPENDENCY_STATE.READY);
  const app = createApp({
    config: Object.freeze({ ...config, applicationRateLimit: Object.freeze({ windowMs: 900_000, max: 1000 }) }),
    logger: log.logger,
    readiness,
    jobRepository: counted(createJobRepository({ queryTimeoutMs: 5000 }), 'jobs'),
    applicationRepository: counted(createApplicationRepository({ timeoutMs: 5000 }), 'applications'),
    notificationService: createNotificationService({ transport, timeoutMs: 2000, ...QA_NOTIFICATION_OPTIONS }),
    resumeStorage: intake.storage,
    uploadArea: intake.uploadArea,
  });
  return { app, calls, transport, config };
}

const stateOfTheWorld = async () => ({
  applications: await Application.countDocuments({}),
  jobs: await Job.countDocuments({}),
  objects: intake.storedObjects().length,
  temporaryFiles: intake.tempFiles().length,
});

describe.each([
  ['nothing configured'],
  ['RECRUITMENT_MODE=closed'],
  ['a misspelt mode'],
  ['public in a non-production environment'],
  ['production with nothing configured'],
  ['production, public without an authorisation'],
  ['testers, client not listed'],
])('%s — real Jobs exist, and nobody is served one', (name) => {
  it('the list is empty; every Job, in every lifecycle state, is an unknown Job; the database is never queried', async () => {
    const { app, calls } = realApp(name);
    const list = await request(app).get(JOBS);
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual({ items: [], pagination: { page: 1, limit: expect.any(Number), total: 0, totalPages: 0 } });
    expect(list.headers['x-valida-audience']).toBeUndefined();
    for (const slug of Object.values(SLUGS)) {
      const detail = await request(app).get(`${JOBS}/${slug}`);
      expect(detail.status).toBe(404);
      expect(detail.body.error.code).toBe('JOB_NOT_FOUND');
    }
    expect(calls).toEqual({ jobs: 0, applications: 0 });
  });

  it('a valid submission to the OPEN Job is refused: no Application, no object, no temporary file, no notification, no query', async () => {
    const { app, calls, transport } = realApp(name);
    const before = await stateOfTheWorld();
    const response = await applyRequest(app, { slug: SLUGS.open });
    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ code: 'JOB_NOT_FOUND', message: "This application isn't available." });
    expect(response.headers.connection).toBe('close');
    await app.locals.applicationSubmission.drainFollowUps();
    expect(await stateOfTheWorld()).toEqual(before);
    expect(before).toMatchObject({ applications: 0, objects: 0, temporaryFiles: 0, jobs: 5 });
    expect(calls).toEqual({ jobs: 0, applications: 0 });
    expect(transport.calls).toHaveLength(0);
  });
});

describe.each([
  ['testers, client listed', 'tester'],
  ['production, public with an authorisation', undefined],
])('%s — the accepted Job lifecycle, unchanged', (name, audienceHeader) => {
  it('the list holds only the open Job; closed is served as closed; Draft, archived and future are unknown', async () => {
    const { app } = realApp(name);
    const list = await request(app).get(JOBS);
    expect(list.status).toBe(200);
    expect(list.body.data.items.map((item) => item.slug)).toEqual([SLUGS.open]);
    expect(list.body.data.pagination.total).toBe(1);
    expect(list.headers['x-valida-audience']).toBe(audienceHeader);

    const open = await request(app).get(`${JOBS}/${SLUGS.open}`);
    expect(open.status).toBe(200);
    expect(open.body.data.applicationStatus).toBe('OPEN');
    expect(open.headers['x-valida-audience']).toBe(audienceHeader);

    const closed = await request(app).get(`${JOBS}/${SLUGS.closed}`);
    expect(closed.status).toBe(200);
    expect(closed.body.data.applicationStatus).toBe('CLOSED');

    for (const slug of [SLUGS.draft, SLUGS.archived, SLUGS.future]) {
      const hidden = await request(app).get(`${JOBS}/${slug}`);
      expect(hidden.status).toBe(404);
      expect(hidden.body.error.code).toBe('JOB_NOT_FOUND');
    }
  });

  it('a submission: accepted for the open Job (record and object, checksum intact); refused for the others exactly as before', async () => {
    const { app, transport } = realApp(name);
    const bytes = syntheticPdf();

    const closed = await applyRequest(app, { slug: SLUGS.closed });
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('JOB_NOT_ACCEPTING_APPLICATIONS');
    for (const slug of [SLUGS.draft, SLUGS.archived, SLUGS.future, 'qa-c6-no-such-role']) {
      const refused = await applyRequest(app, { slug });
      expect(refused.status).toBe(404);
      expect(refused.body.error.code).toBe('JOB_NOT_FOUND');
    }
    expect(await stateOfTheWorld()).toMatchObject({ applications: 0, objects: 0, temporaryFiles: 0 });

    const key = randomUUID();
    const accepted = await applyRequest(app, { slug: SLUGS.open, key, resume: { data: bytes, filename: 'qa-resume.pdf', contentType: 'application/pdf' } });
    expect(accepted.status).toBe(201);
    expect(accepted.body.data).toMatchObject({ status: 'RECEIVED', job: { slug: SLUGS.open } });
    expect(accepted.headers['x-valida-audience']).toBe(audienceHeader);
    await app.locals.applicationSubmission.drainFollowUps();

    const records = await Application.find({}).lean();
    expect(records).toHaveLength(1);
    expect(records[0].jobSnapshot.slug).toBe(SLUGS.open);
    expect(records[0].resume.sizeBytes).toBe(bytes.length);
    expect(records[0].resume.checksumSha256).toBe(sha256(bytes));
    const stored = fs.readFileSync(path.join(intake.storageRoot, ...records[0].resume.storageKey.split('/')));
    expect(sha256(stored)).toBe(sha256(bytes));
    expect(await stateOfTheWorld()).toMatchObject({ applications: 1, objects: 1, temporaryFiles: 0 });
    // The internal notification only. Candidate acknowledgements stay disabled.
    expect(transport.calls).toHaveLength(1);
    expect(records[0].notifications.candidateAcknowledgement.status).toBe('NOT_REQUIRED');

    // Idempotent replay, as accepted in B5.
    const replay = await applyRequest(app, { slug: SLUGS.open, key, resume: { data: bytes, filename: 'qa-resume.pdf', contentType: 'application/pdf' } });
    expect(replay.status).toBe(200);
    expect(replay.body.meta.replayed).toBe(true);
    expect(await Application.countDocuments({})).toBe(1);
  });
});

describe('changing the mode changes who is served, not the data', () => {
  it('an Application accepted in testers mode is untouched when the same database is served closed', async () => {
    const listed = realApp('testers, client listed');
    expect((await applyRequest(listed.app, { slug: SLUGS.open })).status).toBe(201);
    await listed.app.locals.applicationSubmission.drainFollowUps();
    const before = await stateOfTheWorld();
    expect(before).toMatchObject({ applications: 1, objects: 1 });

    const closed = realApp('nothing configured');
    expect((await request(closed.app).get(JOBS)).body.data.items).toEqual([]);
    expect((await request(closed.app).get(`${JOBS}/${SLUGS.open}`)).status).toBe(404);
    expect((await applyRequest(closed.app, { slug: SLUGS.open })).status).toBe(404);
    expect(await stateOfTheWorld()).toEqual(before);
    expect(closed.calls).toEqual({ jobs: 0, applications: 0 });
  });
});

/* ------------------------------------------------- the real server process -- */

function startServerProcess(env) {
  return new Promise((resolve, reject) => {
    const inherited = { ...process.env };
    // The launching shell must not decide the mode under test.
    for (const name of ['RECRUITMENT_MODE', 'RECRUITMENT_PUBLIC_AUTHORISATION', 'ACCESS_ALLOWLIST']) delete inherited[name];
    const child = spawn(process.execPath, ['src/server.js'], { cwd: backendRoot, env: { ...inherited, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
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

const recruitmentLine = (output) =>
  output
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .find((entry) => entry.msg === 'recruitment access');

describe('`node src/server.js` against the real database', () => {
  const serverEnv = (port, extra = {}) => ({
    APP_ENV: 'local',
    NODE_ENV: 'development',
    LOG_LEVEL: 'info',
    PORT: String(port),
    MONGODB_URI: TEST_URI,
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
    RESUME_STORAGE_DRIVER: 'local',
    RESUME_STORAGE_LOCAL_ROOT: path.join(intake.root, 'server-private-resumes'),
    ...extra,
  });

  it('with no recruitment variable: it starts, says "closed", and serves no Job although an open one is in the database', async () => {
    const port = await freePort();
    const { child, output } = await startServerProcess(serverEnv(port));
    try {
      const base = `http://127.0.0.1:${port}`;
      expect(recruitmentLine(output())).toMatchObject({ recruitmentMode: 'closed', recruitmentConfiguration: 'absent', recruitmentReason: 'MODE_ABSENT' });
      const list = await request(base).get(JOBS);
      expect(list.status).toBe(200);
      expect(list.body.data.items).toEqual([]);
      expect((await request(base).get(`${JOBS}/${SLUGS.open}`)).status).toBe(404);
      const submission = await request(base)
        .post(applyPath(SLUGS.open))
        .set('Idempotency-Key', randomUUID())
        .field('fullName', 'QA Synthetic Candidate')
        .attach('resume', syntheticPdf(), { filename: 'qa-resume.pdf', contentType: 'application/pdf' });
      expect(submission.status).toBe(404);
      expect(await Application.countDocuments({})).toBe(0);
      expect(fs.existsSync(path.join(intake.root, 'server-private-resumes', 'resumes')) ? fs.readdirSync(path.join(intake.root, 'server-private-resumes', 'resumes')) : []).toEqual([]);
    } finally {
      child.kill('SIGTERM');
    }
  }, 40_000);

  it('with a misspelt mode: it still starts, warns, and is closed', async () => {
    const port = await freePort();
    const { child, output } = await startServerProcess(serverEnv(port, { RECRUITMENT_MODE: 'tester', ACCESS_ALLOWLIST: '127.0.0.1/32' }));
    try {
      expect(recruitmentLine(output())).toMatchObject({ level: 'warn', recruitmentMode: 'closed', recruitmentConfiguration: 'invalid', recruitmentReason: 'MODE_INVALID' });
      expect((await request(`http://127.0.0.1:${port}`).get(JOBS)).body.data.items).toEqual([]);
    } finally {
      child.kill('SIGTERM');
    }
  }, 40_000);

  it('in testers mode, from the listed loopback address: the open Job is served and an application is accepted', async () => {
    const port = await freePort();
    const { child, output } = await startServerProcess(serverEnv(port, { RECRUITMENT_MODE: 'testers', ACCESS_ALLOWLIST: '127.0.0.1/32,::1/128' }));
    try {
      const base = `http://127.0.0.1:${port}`;
      expect(recruitmentLine(output())).toMatchObject({ recruitmentMode: 'testers', recruitmentAllowlistEntries: 2 });
      const list = await request(base).get(JOBS);
      expect(list.body.data.items.map((item) => item.slug)).toEqual([SLUGS.open]);
      expect(list.headers['x-valida-audience']).toBe('tester');
      const submission = await applyRequest(base, { slug: SLUGS.open });
      expect(submission.status).toBe(201);
      expect(await Application.countDocuments({})).toBe(1);
      expect(output()).not.toMatch(/127\.0\.0\.1\/32|::1\/128/);
    } finally {
      child.kill('SIGTERM');
    }
  }, 40_000);

  it('in testers mode, from an address that is NOT listed: nothing is served and nothing is written', async () => {
    const port = await freePort();
    const { child } = await startServerProcess(serverEnv(port, { RECRUITMENT_MODE: 'testers', ACCESS_ALLOWLIST: '203.0.113.0/24' }));
    try {
      const base = `http://127.0.0.1:${port}`;
      const list = await request(base).get(JOBS).set('X-Forwarded-For', '203.0.113.7');
      expect(list.body.data.items).toEqual([]);
      expect(list.headers['x-valida-audience']).toBeUndefined();
      expect((await applyRequest(base, { slug: SLUGS.open }).set('X-Forwarded-For', '203.0.113.7')).status).toBe(404);
      expect(await Application.countDocuments({})).toBe(0);
    } finally {
      child.kill('SIGTERM');
    }
  }, 40_000);
});
