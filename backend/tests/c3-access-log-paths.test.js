import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildConnectedApp, capturingLogger, testConfig } from './helpers.js';

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

describe('access log: matched routes are unchanged (C3)', () => {
  it('a matched route keeps its exact path (without the query), the request id and the status', async () => {
    const { app, log } = appWithLog();
    const list = await request(app).get('/api/v1/jobs?page=1&limit=5');
    const refused = await request(app).get(`/api/v1/jobs?email=${QUERY_MARKER}`);
    const detail = await request(app).get('/api/v1/jobs/qa-unknown-role');
    const health = await request(app).get('/api/v1/health');
    expect([list.status, refused.status, detail.status, health.status]).toEqual([200, 422, 404, 200]);
    expect(lineFor(log, list.headers['x-request-id']).req).toEqual({ id: list.headers['x-request-id'], method: 'GET', path: '/api/v1/jobs', routeMatched: true });
    // The list route refuses an unknown query parameter (422): matched, so the path is kept — the query never is.
    expect(lineFor(log, refused.headers['x-request-id'])).toMatchObject({ req: { path: '/api/v1/jobs', routeMatched: true }, res: { statusCode: 422 } });
    // Matched by GET /jobs/:jobSlug; the Job does not exist, so the route answers 404 — the path is still the route's.
    expect(lineFor(log, detail.headers['x-request-id'])).toMatchObject({ req: { path: '/api/v1/jobs/qa-unknown-role', routeMatched: true }, res: { statusCode: 404 } });
    expect(lineFor(log, health.headers['x-request-id']).req).toMatchObject({ path: '/api/v1/health', routeMatched: true });
    expect(log.output()).not.toContain(QUERY_MARKER);
  });
});
