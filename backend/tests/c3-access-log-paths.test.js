import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildConnectedApp, capturingLogger, testConfig } from './helpers.js';
import { applyRequest, createApplyEnvironment, qaJob } from './fixtures/applyHarness.js';

/**
 * C3 correction (GPT finding 3) — the access log never records a raw path that
 * no route matched.
 *
 * A storage key looks like `resumes/<32 hex>/<32 hex>`. Nothing in the API
 * hands one out (B4), but anyone can PUT one in a URL: C3's own public-access
 * probes requested `/<storageKey>` and `/api/v1/<storageKey>`, and the access
 * log wrote both paths out in full. A request that reaches no route — every
 * 404, and every request answered before routing (rate limit, CORS, body
 * parsing) — is now logged by the SHAPE of its path: the API's own route words
 * are kept, every other segment is replaced. A request that a route did match
 * keeps its path exactly as before, and every line keeps the request id, the
 * method and the status.
 */

const SEGMENT_A = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
const SEGMENT_B = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const STORAGE_KEY = `resumes/${SEGMENT_A}/${SEGMENT_B}`;
const QUERY_MARKER = 'qa-c3-query-marker@example.test';

const repository = {
  async listOpenJobs() {
    return { total: 0, jobs: [] };
  },
  async findPublicJobBySlug() {
    return null;
  },
};
const clock = () => new Date('2026-11-06T12:00:00.000Z');

function appWithLog(configOverrides) {
  const log = capturingLogger();
  const app = buildConnectedApp({
    jobRepository: repository,
    clock,
    logger: log.logger,
    ...(configOverrides ? { config: testConfig(configOverrides) } : {}),
  });
  return { app, log };
}

/** The access-log lines pino actually WROTE (after serialisers and redaction). */
function accessLines(log) {
  return log.lines
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.req && entry.res);
}

function lineFor(log, requestId) {
  const lines = accessLines(log).filter((entry) => entry.req.id === requestId);
  expect(lines, `one access-log line for request ${requestId}`).toHaveLength(1);
  return lines[0];
}

function expectNoKeyMaterial(log) {
  const output = log.output();
  for (const value of [STORAGE_KEY, SEGMENT_A, SEGMENT_B, QUERY_MARKER]) expect(output, value).not.toContain(value);
}

describe('access log: unmatched paths are logged by shape, never raw (C3, GPT finding 3)', () => {
  it('GET /<storageKey> (404): no key segment is written; id, method, status and the unmatched flag are', async () => {
    const { app, log } = appWithLog();
    const response = await request(app).get(`/${STORAGE_KEY}`);
    expect(response.status).toBe(404);
    const entry = lineFor(log, response.headers['x-request-id']);
    expect(entry.req).toEqual({ id: response.headers['x-request-id'], method: 'GET', path: '/{segment}/{segment}/{segment}', routeMatched: false });
    expect(entry.res).toEqual({ statusCode: 404 });
    expectNoKeyMaterial(log);
  });

  it('GET /api/v1/<storageKey>?email=… (404): the API prefix is kept, the key and the query are not', async () => {
    const { app, log } = appWithLog();
    const response = await request(app).get(`/api/v1/${STORAGE_KEY}?email=${QUERY_MARKER}`);
    expect(response.status).toBe(404);
    const entry = lineFor(log, response.headers['x-request-id']);
    expect(entry.req.path).toBe('/api/v1/{segment}/{segment}/{segment}');
    expect(entry.req.routeMatched).toBe(false);
    expectNoKeyMaterial(log);
  });

  it('a near-miss under a real route keeps the route words: GET /api/v1/jobs/<a>/<b> and GET on the POST-only Apply route', async () => {
    const { app, log } = appWithLog();
    const twoSegments = await request(app).get(`/api/v1/jobs/${SEGMENT_A}/${SEGMENT_B}`);
    const wrongMethod = await request(app).get(`/api/v1/jobs/${SEGMENT_A}/applications`);
    expect([twoSegments.status, wrongMethod.status]).toEqual([404, 404]);
    expect(lineFor(log, twoSegments.headers['x-request-id']).req.path).toBe('/api/v1/jobs/{segment}/{segment}');
    expect(lineFor(log, wrongMethod.headers['x-request-id']).req.path).toBe('/api/v1/jobs/{segment}/applications');
    expectNoKeyMaterial(log);
  });

  it('a request answered before routing (general rate limit, 429) is logged by shape too, with its status', async () => {
    const { app, log } = appWithLog({ rateLimit: Object.freeze({ windowMs: 60_000, max: 1 }) });
    await request(app).get('/api/v1/jobs');
    const limited = await request(app).post(`/api/v1/jobs/${SEGMENT_A}/applications`);
    expect(limited.status).toBe(429);
    const entry = lineFor(log, limited.headers['x-request-id']);
    expect(entry.req).toMatchObject({ method: 'POST', path: '/api/v1/jobs/{segment}/applications', routeMatched: false });
    expect(entry.res.statusCode).toBe(429);
    expectNoKeyMaterial(log);
  });

  it('a very long unmatched path is bounded: at most 12 segments are written, then a count', async () => {
    const { app, log } = appWithLog();
    const response = await request(app).get(`/${Array.from({ length: 20 }, () => SEGMENT_A).join('/')}`);
    expect(response.status).toBe(404);
    expect(lineFor(log, response.headers['x-request-id']).req.path).toBe(`${'/{segment}'.repeat(12)}/{+8 more}`);
    expectNoKeyMaterial(log);
  });
});

describe('access log: matched routes (C3; templates since r3)', () => {
  it('a static route keeps its path (never the query); a dynamic one is its template; request id and status kept', async () => {
    const { app, log } = appWithLog();
    const list = await request(app).get('/api/v1/jobs?page=1&limit=5');
    const refused = await request(app).get(`/api/v1/jobs?email=${QUERY_MARKER}`);
    const detail = await request(app).get('/api/v1/jobs/qa-unknown-role');
    const health = await request(app).get('/api/v1/health');
    expect([list.status, refused.status, detail.status, health.status]).toEqual([200, 422, 404, 200]);
    expect(lineFor(log, list.headers['x-request-id']).req).toEqual({ id: list.headers['x-request-id'], method: 'GET', path: '/api/v1/jobs', routeMatched: true });
    // The list route refuses an unknown query parameter (422): matched, so the path is kept — the query never is.
    expect(lineFor(log, refused.headers['x-request-id'])).toMatchObject({ req: { path: '/api/v1/jobs', routeMatched: true }, res: { statusCode: 422 } });
    // Matched by GET /jobs/:jobSlug; the Job does not exist, so the route answers 404. The line holds the route's
    // TEMPLATE, not the value in it (C3 r3).
    expect(lineFor(log, detail.headers['x-request-id'])).toMatchObject({ req: { path: '/api/v1/jobs/:jobSlug', routeMatched: true }, res: { statusCode: 404 } });
    expect(log.output()).not.toContain('qa-unknown-role');
    expect(lineFor(log, health.headers['x-request-id']).req).toMatchObject({ path: '/api/v1/health', routeMatched: true });
    expect(log.output()).not.toContain(QUERY_MARKER);
  });
});

/*
 * C3 r3 — a value in a ROUTE PARAMETER is never written either.
 *
 * Express sets req.route as soon as a route PATTERN matches, before the
 * controller validates :jobSlug. So `GET /api/v1/jobs/<anything>` counts as
 * matched whatever <anything> is — an e-mail address, a storage key segment —
 * and r2 logged that path raw. A matched route is now logged by its TEMPLATE
 * (`/api/v1/jobs/:jobSlug`, `/api/v1/jobs/:jobSlug/applications`), which tells
 * Job Detail from Apply and holds no request value.
 */
const MARKER_STEM = 'qa-c3-route-marker';
const EMAIL_MARKER = `${MARKER_STEM}@example.test`;
const PARAMETER_VALUES = [
  ['an e-mail address', EMAIL_MARKER],
  ['the same, percent-encoded', encodeURIComponent(EMAIL_MARKER)],
  ['a well-formed but unknown slug', `${MARKER_STEM}-example-test`],
];
/** Every form of the marker contains the stem: one check covers raw, encoded and decoded. */
const expectNoMarker = (output) => expect(output).not.toContain(MARKER_STEM);

describe('access log: a route parameter is logged as its template, never its value (C3 r3)', () => {
  it('Job Detail: GET /api/v1/jobs/<value> -> 404, each line /api/v1/jobs/:jobSlug with id, method and status', async () => {
    const { app, log } = appWithLog();
    for (const [label, value] of PARAMETER_VALUES) {
      const response = await request(app).get(`/api/v1/jobs/${value}`);
      expect(response.status, label).toBe(404);
      const entry = lineFor(log, response.headers['x-request-id']);
      expect(entry.req, label).toEqual({ id: response.headers['x-request-id'], method: 'GET', path: '/api/v1/jobs/:jobSlug', routeMatched: true });
      expect(entry.res, label).toEqual({ statusCode: 404 });
    }
    expectNoMarker(log.output());
  });

  it('Apply: POST /api/v1/jobs/<value>/applications, refused (no key, unknown Job, Apply rate limit) -> each line /api/v1/jobs/:jobSlug/applications', async () => {
    const env = await createApplyEnvironment({ configOverrides: { applicationRateLimit: Object.freeze({ windowMs: 900_000, max: 4 }) } });
    try {
      const refused = [];
      refused.push(['no Idempotency-Key', await applyRequest(env.app, { slug: EMAIL_MARKER, key: null }), 400]);
      for (const [label, value] of PARAMETER_VALUES) refused.push([label, await applyRequest(env.app, { slug: value }), 404]);
      // The fifth request within the window: the Apply route's own limiter (inside the route) answers 429.
      refused.push(['the Apply rate limit', await applyRequest(env.app, { slug: EMAIL_MARKER }), 429]);
      for (const [label, response, status] of refused) {
        expect(response.status, label).toBe(status);
        const entry = lineFor(env.log, response.headers['x-request-id']);
        expect(entry.req, label).toEqual({ id: response.headers['x-request-id'], method: 'POST', path: '/api/v1/jobs/:jobSlug/applications', routeMatched: true });
        expect(entry.res.statusCode, label).toBe(status);
      }
      expectNoMarker(env.log.output());
    } finally {
      await env.cleanup();
    }
  });

  it('a successful Apply is logged by its template too, and Job Detail stays distinguishable from Apply', async () => {
    const env = await createApplyEnvironment({ jobs: [qaJob()] });
    try {
      const accepted = await applyRequest(env.app);
      const detail = await request(env.app).get(`/api/v1/jobs/${EMAIL_MARKER}`);
      expect([accepted.status, detail.status]).toEqual([201, 404]);
      expect(lineFor(env.log, accepted.headers['x-request-id'])).toMatchObject({ req: { method: 'POST', path: '/api/v1/jobs/:jobSlug/applications', routeMatched: true }, res: { statusCode: 201 } });
      expect(lineFor(env.log, detail.headers['x-request-id'])).toMatchObject({ req: { method: 'GET', path: '/api/v1/jobs/:jobSlug', routeMatched: true }, res: { statusCode: 404 } });
      expectNoMarker(env.log.output());
    } finally {
      await env.cleanup();
    }
  });
});
