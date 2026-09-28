import { describe, it, expect } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { buildApp, buildConnectedApp, capturingLogger, testConfig } from './helpers.js';
import {
  DETAIL_PROJECTION,
  DatabaseUnavailableError,
  LIST_PROJECTION,
  createJobRepository,
} from '../src/modules/jobs/job.repository.js';
import { QA_NOW, at, minutes, storedJob } from './fixtures/jobFixtures.js';

/**
 * Public Jobs API — HTTP contract, OFFLINE.
 *
 * WHAT THIS FILE PROVES, AND WHAT IT DOES NOT.
 * It drives the real Express app — every middleware, the real router,
 * controller, validation, mapper and central error handler — but most tests
 * give createApp a STAND-IN repository instead of MongoDB. They prove the HTTP
 * contract: envelopes, status codes, headers, validation, error mapping and
 * DTO privacy. They are NOT evidence of what MongoDB selects, sorts or
 * persists; that is proven only by tests/db/jobs-api.test.js against a real
 * database (npm run verify:b3).
 *
 * The "real repository" tests at the end use the production repository with
 * no database connection (or a scripted model) to prove failure handling:
 * a database that is absent, slow or failing yields 503, never an empty list.
 */

const clock = () => QA_NOW;

/** Stand-in repository: returns scripted data and records what it was asked. */
function stubRepository({ jobs = [], total, detail = null, error } = {}) {
  const calls = { list: [], detail: [] };
  return {
    calls,
    async listOpenJobs(args) {
      calls.list.push(args);
      if (error) throw error;
      return { total: total ?? jobs.length, jobs };
    },
    async findPublicJobBySlug(args) {
      calls.detail.push(args);
      if (error) throw error;
      return typeof detail === 'function' ? detail(args) : detail;
    },
  };
}

const appWith = (repository, options = {}) => buildConnectedApp({ jobRepository: repository, clock, ...options });

const openJob = (overrides) => storedJob({ publishedAt: at(-minutes(60)), closesAt: null, ...overrides });

const NOT_FOUND_ERROR = { code: 'JOB_NOT_FOUND', message: "This role isn't available." };
const UNAVAILABLE_ERROR = { code: 'SERVICE_UNAVAILABLE', message: 'Service is not ready.' };

function expectJobsHeaders(response) {
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['content-type']).toMatch(/^application\/json/);
  expect(response.headers['x-request-id']).toBe(response.body.meta.requestId);
  expect(response.headers['x-content-type-options']).toBe('nosniff');
  expect(response.headers['content-security-policy']).toContain("default-src 'none'");
  expect(response.headers['x-powered-by']).toBeUndefined();
}

describe('GET /api/v1/jobs', () => {
  it('QA-P1-API-001: returns open Jobs in the canonical envelope with no-store and a request id', async () => {
    const repository = stubRepository({ jobs: [openJob()] });
    const response = await request(appWith(repository)).get('/api/v1/jobs');

    expect(response.status).toBe(200);
    expectJobsHeaders(response);
    expect(response.body).toEqual({
      success: true,
      data: {
        items: [
          {
            title: 'QA Synthetic Security Analyst',
            slug: 'qa-synthetic-security-analyst',
            location: 'QA Region, Canada',
            workArrangement: 'FULLY_REMOTE',
            employmentType: 'CONTRACT',
            schedule: 'QA TEST DATA schedule wording',
            weeklyHours: 30,
            compensation: { currency: 'CAD', amount: 35, unit: 'HOUR', gross: true },
            publishedAt: '2026-10-01T11:00:00.000Z',
            closesAt: null,
            applicationStatus: 'OPEN',
          },
        ],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      },
      meta: { requestId: expect.any(String) },
    });
    // One server timestamp per request, passed to the query.
    expect(repository.calls.list).toEqual([{ now: QA_NOW, skip: 0, limit: 20 }]);
  });

  it('an empty result is HTTP 200 with an empty array — never 404 (Doc 09 sections 55-56)', async () => {
    const response = await request(appWith(stubRepository())).get('/api/v1/jobs');
    expect(response.status).toBe(200);
    expectJobsHeaders(response);
    expect(response.body.data).toEqual({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
  });

  it('translates page and limit into skip/limit and reports totalPages', async () => {
    const repository = stubRepository({ jobs: [openJob()], total: 11 });
    const response = await request(appWith(repository)).get('/api/v1/jobs?page=3&limit=5');
    expect(response.status).toBe(200);
    expect(repository.calls.list[0]).toEqual({ now: QA_NOW, skip: 10, limit: 5 });
    expect(response.body.data.pagination).toEqual({ page: 3, limit: 5, total: 11, totalPages: 3 });
  });

  it('a page past the end is a valid empty page, not an error', async () => {
    const repository = stubRepository({ jobs: [], total: 3 });
    const response = await request(appWith(repository)).get('/api/v1/jobs?page=99&limit=2');
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ items: [], pagination: { page: 99, limit: 2, total: 3, totalPages: 2 } });
  });

  it.each([
    ['page=0', ['page']],
    ['page=-1', ['page']],
    ['page=1.5', ['page']],
    ['page=abc', ['page']],
    ['page=', ['page']],
    ['page=1&page=2', ['page']],
    ['limit=0', ['limit']],
    ['limit=51', ['limit']],
    ['limit=1e1', ['limit']],
    ['page=0&limit=500', ['page', 'limit']],
    ['status=DRAFT', ['query']],
    ['includeArchived=true', ['query']],
    ['page[$gt]=0', ['query']],
    ['page%5B%24ne%5D=1', ['query']],
    ['__proto__=x', ['query']],
  ])('?%s -> 422 VALIDATION_FAILED and the database is never queried', async (query, fields) => {
    const repository = stubRepository({ jobs: [openJob()] });
    const response = await request(appWith(repository)).get(`/api/v1/jobs?${query}`);
    expect(response.status).toBe(422);
    expectJobsHeaders(response);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Some information needs to be corrected.',
        fieldErrors: fields.map((field) => ({ field, code: expect.any(String), message: expect.any(String) })),
      },
      meta: { requestId: expect.any(String) },
    });
    expect(repository.calls.list).toEqual([]);
  });

  it('never exposes internal fields even when the data layer returns them', async () => {
    const response = await request(appWith(stubRepository({ jobs: [openJob()] }))).get('/api/v1/jobs');
    const text = response.text;
    ['_id', '__v', 'internalOccupationalReference', 'NOC 99999', 'QA-INTERNAL', 'createdAt', 'updatedAt',
      'closedAt', 'archivedAt', 'amountMinor', 'embedded-subdocument-id', 'applicationForm', 'description']
      .forEach((marker) => expect(text).not.toContain(marker));
  });

  it('answers HEAD like GET, with no-store', async () => {
    const response = await request(appWith(stubRepository())).head('/api/v1/jobs');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it.each(['post', 'put', 'patch', 'delete'])('offers no %s write surface — canonical JSON 404', async (method) => {
    const repository = stubRepository();
    const response = await request(appWith(repository))[method]('/api/v1/jobs').send({ status: 'PUBLISHED' });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('API_ROUTE_NOT_FOUND');
    expect(repository.calls.list).toEqual([]);
  });

  it('is covered by the general public rate limit (Doc 09 section 33)', async () => {
    const app = appWith(stubRepository(), { config: testConfig({ rateLimit: Object.freeze({ windowMs: 60_000, max: 2 }) }) });
    expect((await request(app).get('/api/v1/jobs')).status).toBe(200);
    expect((await request(app).get('/api/v1/jobs')).status).toBe(200);
    const limited = await request(app).get('/api/v1/jobs');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.headers['cache-control']).toBe('no-store');
  });
});

describe('Cache-Control: no-store also covers responses that end before the Jobs router (correction 1, finding 3)', () => {
  const limitedApp = (max) =>
    appWith(stubRepository({ jobs: [openJob()], detail: openJob() }), {
      config: testConfig({ rateLimit: Object.freeze({ windowMs: 60_000, max }) }),
    });

  it.each(['/api/v1/jobs', '/api/v1/jobs/qa-synthetic-security-analyst'])(
    '%s: a malformed JSON body -> 400 MALFORMED_REQUEST with no-store',
    async (path) => {
      const repository = stubRepository({ jobs: [openJob()], detail: openJob() });
      const response = await request(appWith(repository))
        .get(path)
        .set('Content-Type', 'application/json')
        .send('{"page": ');
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('MALFORMED_REQUEST');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-request-id']).toBe(response.body.meta.requestId);
      expect(repository.calls.list).toEqual([]);
      expect(repository.calls.detail).toEqual([]);
    },
  );

  it.each(['/api/v1/jobs', '/api/v1/jobs/qa-synthetic-security-analyst'])(
    '%s: a JSON body over the 100 KB limit -> 413 PAYLOAD_TOO_LARGE with no-store',
    async (path) => {
      const repository = stubRepository({ jobs: [openJob()], detail: openJob() });
      const response = await request(appWith(repository))
        .get(path)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ padding: 'x'.repeat(110 * 1024) }));
      expect(response.status).toBe(413);
      expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(repository.calls.list).toEqual([]);
      expect(repository.calls.detail).toEqual([]);
    },
  );

  it.each(['/api/v1/jobs', '/api/v1/jobs/qa-synthetic-security-analyst'])(
    '%s: a rate-limited request -> 429 RATE_LIMITED with no-store',
    async (path) => {
      const app = limitedApp(1);
      expect((await request(app).get(path)).headers['cache-control']).toBe('no-store');
      const limited = await request(app).get(path);
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
      expect(limited.headers['cache-control']).toBe('no-store');
      expect(limited.headers['x-request-id']).toBe(limited.body.meta.requestId);
    },
  );

  it('an unrouted path below /api/v1/jobs (404) and a rejected method carry no-store', async () => {
    const app = appWith(stubRepository());
    for (const response of [
      await request(app).get('/api/v1/jobs/qa-role/unknown'),
      await request(app).post('/api/v1/jobs').send({}),
      await request(app).delete('/api/v1/jobs/qa-role'),
    ]) {
      expect(response.status).toBe(404);
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });

  it('keeps the parser limit, rate limiter and envelopes unchanged — and is scoped to the Jobs path only', async () => {
    const app = appWith(stubRepository());
    const health = await request(app).get('/api/v1/health');
    expect(health.status).toBe(200);
    expect(health.headers['cache-control']).toBeUndefined();
    const lookalike = await request(app).get('/api/v1/jobsx');
    expect(lookalike.status).toBe(404);
    expect(lookalike.headers['cache-control']).toBeUndefined();
    const other = await request(app).post('/api/v1/nope').set('Content-Type', 'application/json').send('{"a":');
    expect(other.status).toBe(400);
    expect(other.headers['cache-control']).toBeUndefined();
    // A body just under the limit is still accepted by the parser and reaches the route.
    const withinLimit = await request(app)
      .get('/api/v1/jobs')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(90 * 1024) }));
    expect(withinLimit.status).toBe(200);
  });
});

describe('GET /api/v1/jobs — dependency and unexpected failures', () => {
  it.each(['disconnected', 'timeout', 'query_failed'])(
    'a database failure (%s) is 503 SERVICE_UNAVAILABLE — never an empty success',
    async (reason) => {
      const { logger, output } = capturingLogger();
      const response = await request(
        appWith(stubRepository({ error: new DatabaseUnavailableError(reason) }), { logger }),
      ).get('/api/v1/jobs');
      expect(response.status).toBe(503);
      expectJobsHeaders(response);
      expect(response.body).toEqual({ success: false, error: UNAVAILABLE_ERROR, meta: { requestId: expect.any(String) } });
      expect(response.body.data).toBeUndefined();
      expect(output()).toContain(`"reason":"${reason}"`);
      expect(output()).toContain('public jobs read failed');
    },
  );

  it('an unexpected failure is a safe 500 with no internal detail in the body or the log', async () => {
    const { logger, output } = capturingLogger();
    const error = new Error('boom at /srv/valida/src/secret.js mongodb://admin:s3cr3t@db.example/valida');
    const response = await request(appWith(stubRepository({ error }), { logger })).get('/api/v1/jobs');
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    [/s3cr3t/, /secret\.js/, /mongodb:\/\//, /boom/].forEach((pattern) => {
      expect(response.text).not.toMatch(pattern);
      expect(output()).not.toMatch(pattern);
    });
  });

  it('a row the data layer returns that is not OPEN at the request time fails closed (safe 500), never listed', async () => {
    const response = await request(appWith(stubRepository({ jobs: [openJob({ status: 'CLOSED' })] }))).get('/api/v1/jobs');
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(response.text).not.toContain('qa-synthetic-security-analyst');
  });

  it('a stored wage that cannot be converted exactly fails closed with a safe 500', async () => {
    const job = openJob({ compensation: { currency: 'JPY', amountMinor: 3500, unit: 'HOUR', gross: true } });
    const response = await request(appWith(stubRepository({ jobs: [job] }))).get('/api/v1/jobs');
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(response.text).not.toMatch(/JPY|3500/);
  });
});

describe('GET /api/v1/jobs/:jobSlug', () => {
  it('QA-P1-API-002: an OPEN Job returns 200 with its detail and application form', async () => {
    const repository = stubRepository({ detail: openJob() });
    const response = await request(appWith(repository)).get('/api/v1/jobs/qa-synthetic-security-analyst');

    expect(response.status).toBe(200);
    expectJobsHeaders(response);
    expect(response.body.success).toBe(true);
    expect(response.body.data.applicationStatus).toBe('OPEN');
    expect(response.body.data.applicationForm.resume).toEqual({
      required: true,
      maxBytes: 5242880,
      allowedExtensions: ['.pdf', '.docx'],
    });
    expect(response.body.data.applicationForm.screeningQuestions.map((question) => question.id)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
    expect(repository.calls.detail).toEqual([{ slug: 'qa-synthetic-security-analyst', now: QA_NOW }]);
  });

  it('a retained CLOSED Job returns 200 with applicationStatus CLOSED and applicationForm null', async () => {
    const response = await request(appWith(stubRepository({ detail: openJob({ status: 'CLOSED' }) }))).get(
      '/api/v1/jobs/qa-synthetic-security-analyst',
    );
    expect(response.status).toBe(200);
    expect(response.body.data.applicationStatus).toBe('CLOSED');
    expect(response.body.data.applicationForm).toBeNull();
    expect(response.body.data.description).toBe('QA TEST DATA description.');
  });

  it('an expired PUBLISHED Job (closesAt passed) is presented as CLOSED', async () => {
    const response = await request(appWith(stubRepository({ detail: openJob({ closesAt: at(-1) }) }))).get(
      '/api/v1/jobs/qa-synthetic-security-analyst',
    );
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ applicationStatus: 'CLOSED', applicationForm: null });
  });

  it('unknown, Draft, Archived and future-unpublished Jobs are indistinguishable 404s', async () => {
    const cases = [
      null, // unknown slug
      openJob({ status: 'DRAFT', publishedAt: null }),
      openJob({ status: 'ARCHIVED' }),
      openJob({ publishedAt: at(minutes(5)) }),
    ];
    const bodies = [];
    for (const detail of cases) {
      const response = await request(appWith(stubRepository({ detail }))).get('/api/v1/jobs/qa-some-role');
      expect(response.status).toBe(404);
      expectJobsHeaders(response);
      expect(response.body.error).toEqual(NOT_FOUND_ERROR);
      const { meta, ...rest } = response.body;
      bodies.push(JSON.stringify(rest));
      expect(response.text).not.toMatch(/QA Synthetic|DRAFT|ARCHIVED|NOC/);
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it.each([
    'Cybersecurity-Specialist',
    '-leading',
    'double--hyphen',
    'a'.repeat(121),
    'under_score',
    'dot.slug',
    '%7B%22%24ne%22%3Anull%7D',
    '%24where',
    'slug%00',
    '%E0%A4%A',
    '%',
  ])('the invalid slug %s is a 404 JOB_NOT_FOUND and never reaches the database', async (slug) => {
    const repository = stubRepository({ detail: openJob() });
    const response = await request(appWith(repository)).get(`/api/v1/jobs/${slug}`);
    expect(response.status).toBe(404);
    expect(response.body.error).toEqual(NOT_FOUND_ERROR);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(repository.calls.detail).toEqual([]);
  });

  it('rejects query parameters with 422 before any lookup', async () => {
    const repository = stubRepository({ detail: openJob() });
    const response = await request(appWith(repository)).get('/api/v1/jobs/qa-some-role?preview=true');
    expect(response.status).toBe(422);
    expect(response.body.error.fieldErrors).toEqual([
      { field: 'query', code: 'UNSUPPORTED_PARAMETER', message: 'This endpoint does not accept query parameters.' },
    ]);
    expect(repository.calls.detail).toEqual([]);
  });

  it('a database failure is 503, not 404 — existence cannot be judged without the database', async () => {
    const response = await request(
      appWith(stubRepository({ error: new DatabaseUnavailableError('query_failed') })),
    ).get('/api/v1/jobs/qa-some-role');
    expect(response.status).toBe(503);
    expect(response.body.error).toEqual(UNAVAILABLE_ERROR);
  });

  it('paths below a Job that no route serves stay the canonical API 404', async () => {
    const response = await request(appWith(stubRepository())).get('/api/v1/jobs/qa-some-role/applications');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('API_ROUTE_NOT_FOUND');
  });
});

/** A scripted stand-in for the Job model, to drive the REAL repository's failure paths. */
function scriptedModel({ readyState = 1, count = () => 0, find = () => [], findOne = () => null } = {}) {
  const captured = {};
  const query = (operation, name) => {
    const chain = {
      sort(value) { captured[`${name}Sort`] = value; return chain; },
      skip(value) { captured.skip = value; return chain; },
      limit(value) { captured.limit = value; return chain; },
      maxTimeMS(value) { captured[`${name}MaxTimeMS`] = value; return chain; },
      lean() { captured[`${name}Lean`] = true; return chain; },
      then(resolve, reject) { return Promise.resolve().then(operation).then(resolve, reject); },
    };
    return chain;
  };
  return {
    captured,
    db: { readyState },
    countDocuments(filter) { captured.countFilter = filter; return query(count, 'count'); },
    find(filter, projection) { captured.findFilter = filter; captured.findProjection = projection; return query(find, 'find'); },
    findOne(filter, projection) {
      captured.findOneFilter = filter;
      captured.findOneProjection = projection;
      return query(findOne, 'findOne');
    },
  };
}

describe('the real repository — failure handling without a working database', () => {
  it('with NO database connection the production app answers 503 at once (no command buffering)', async () => {
    expect(mongoose.connection.readyState).toBe(0);
    const app = buildApp({ clock }); // real repository, real Mongoose, not connected
    for (const path of ['/api/v1/jobs', '/api/v1/jobs/qa-some-role']) {
      const started = Date.now();
      const response = await request(app).get(path);
      expect(response.status).toBe(503);
      expect(response.body.error).toEqual(UNAVAILABLE_ERROR);
      expect(Date.now() - started).toBeLessThan(1000);
    }
  });

  it('rejects with the "disconnected" classification before issuing any query', async () => {
    const model = scriptedModel({ readyState: 0 });
    const repository = createJobRepository({ model, queryTimeoutMs: 1000 });
    await expect(repository.listOpenJobs({ now: QA_NOW, skip: 0, limit: 20 })).rejects.toMatchObject({
      name: 'DatabaseUnavailableError',
      reason: 'disconnected',
    });
    expect(model.captured.countFilter).toBeUndefined();
  });

  it('a query that never answers is abandoned after the bound and reported as a timeout', async () => {
    const model = scriptedModel({ count: () => new Promise(() => {}) });
    const repository = createJobRepository({ model, queryTimeoutMs: 50 });
    const started = Date.now();
    await expect(repository.listOpenJobs({ now: QA_NOW, skip: 0, limit: 20 })).rejects.toMatchObject({ reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('a late failure of an abandoned query is absorbed, not left unhandled', async () => {
    let fail;
    const model = scriptedModel({ findOne: () => new Promise((_resolve, reject) => { fail = reject; }) });
    const repository = createJobRepository({ model, queryTimeoutMs: 20 });
    await expect(repository.findPublicJobBySlug({ slug: 'qa-role', now: QA_NOW })).rejects.toMatchObject({ reason: 'timeout' });
    fail(new mongoose.mongo.MongoNetworkError('late'));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it('a driver failure becomes "query_failed"; its text goes nowhere', async () => {
    const driverError = new mongoose.mongo.MongoNetworkError('connect ECONNREFUSED mongodb://admin:s3cr3t@db.example:27017');
    const model = scriptedModel({ count: () => Promise.reject(driverError) });
    const { logger, output } = capturingLogger();
    const repository = createJobRepository({ model, queryTimeoutMs: 1000 });
    const response = await request(appWith(repository, { logger })).get('/api/v1/jobs');
    expect(response.status).toBe(503);
    expect(output()).toContain('"reason":"query_failed"');
    expect(`${response.text}${output()}`).not.toMatch(/s3cr3t|ECONNREFUSED|mongodb:\/\//);
  });

  it('a programming error (for example a cast error) is not disguised as an outage', async () => {
    const model = scriptedModel({ findOne: () => Promise.reject(new mongoose.Error.CastError('Date', 'x', 'publishedAt')) });
    const repository = createJobRepository({ model, queryTimeoutMs: 1000 });
    const response = await request(appWith(repository)).get('/api/v1/jobs/qa-some-role');
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('builds the list query from the visibility filter, canonical sort, bounded time and a lean read', async () => {
    const model = scriptedModel({ count: () => 3, find: () => [] });
    const repository = createJobRepository({ model, queryTimeoutMs: 1234 });
    await repository.listOpenJobs({ now: QA_NOW, skip: 2, limit: 1 });
    expect(model.captured).toMatchObject({
      countFilter: {
        status: { $eq: 'PUBLISHED' },
        publishedAt: { $lte: QA_NOW },
        $or: [{ closesAt: { $eq: null } }, { closesAt: { $gt: QA_NOW } }],
      },
      countMaxTimeMS: 1234,
      findSort: { publishedAt: -1, createdAt: -1, _id: -1 },
      skip: 2,
      limit: 1,
      findMaxTimeMS: 1234,
      findLean: true,
      findProjection: LIST_PROJECTION,
    });
  });

  it('answers a page past the end from the count, without sending the skip to the server', async () => {
    const model = scriptedModel({ count: () => 3 });
    const repository = createJobRepository({ model, queryTimeoutMs: 1000 });
    expect(await repository.listOpenJobs({ now: QA_NOW, skip: 3, limit: 1 })).toEqual({ total: 3, jobs: [] });
    expect(model.captured.findFilter).toBeUndefined();
  });

  it('reads a single Job with the slug bound by $eq and a public-only projection', async () => {
    const model = scriptedModel();
    const repository = createJobRepository({ model, queryTimeoutMs: 1000 });
    expect(await repository.findPublicJobBySlug({ slug: 'qa-role', now: QA_NOW })).toBeNull();
    expect(model.captured.findOneFilter).toEqual({
      slug: { $eq: 'qa-role' },
      status: { $in: ['PUBLISHED', 'CLOSED'] },
      publishedAt: { $lte: QA_NOW },
    });
    expect(model.captured.findOneProjection).toBe(DETAIL_PROJECTION);
  });

  it('projections never select an identifier or an internal field', () => {
    for (const projection of [LIST_PROJECTION, DETAIL_PROJECTION]) {
      expect(projection._id).toBe(0);
      ['internalOccupationalReference', 'closedAt', 'archivedAt', 'createdAt', 'updatedAt', '__v',
        'applicationConfig', 'applicationConfig.resumeRequired', 'location'].forEach((field) =>
        expect(projection[field]).toBeUndefined());
    }
  });
});
