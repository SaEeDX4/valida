import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { buildApp, silentLogger, capturingLogger } from './helpers.js';

/**
 * Error contract — Doc 09 sections 20-23, Doc 13.
 *
 * The safe-500 path is exercised through the real error handler using the
 * test-only route registrar that createApp accepts. No debug or crash endpoint
 * is added to the production application, so this adds no attack surface.
 */
const boom = (api) => {
  api.get('/test-only/throw', () => {
    const error = new Error(
      'Internal failure: connect ECONNREFUSED mongodb+srv://admin:s3cr3t@cluster0.example.net/valida',
    );
    error.internalDetail = 'AWS_SECRET_ACCESS_KEY=AKIAEXAMPLE';
    throw error;
  });
  api.get('/test-only/async-throw', async () => {
    throw new Error('Async internal failure at /srv/valida/backend/src/secret.js:42');
  });
};

describe('unknown routes', () => {
  it.each([
    '/api/v1/does-not-exist',
    '/api/v1/jobs',
    '/api/v2/health',
    '/',
    '/admin',
  ])('returns the canonical JSON 404 for %s', async (path) => {
    const response = await request(buildApp()).get(path);
    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'API_ROUTE_NOT_FOUND', message: expect.any(String) },
      meta: { requestId: expect.any(String) },
    });
  });

  it('never returns Express HTML', async () => {
    const response = await request(buildApp()).get('/api/v1/nope');
    expect(response.text).not.toMatch(/<html|<pre|Cannot GET/i);
  });

  it('applies to every method', async () => {
    const app = buildApp();
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const response = await request(app)[method]('/api/v1/nope');
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('API_ROUTE_NOT_FOUND');
    }
  });
});

describe('malformed JSON', () => {
  it('returns a controlled 400 MALFORMED_REQUEST', async () => {
    const response = await request(buildApp())
      .post('/api/v1/nope')
      .set('Content-Type', 'application/json')
      .send('{"name": "Jane",}');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MALFORMED_REQUEST');
    expect(response.body.meta.requestId).toBeTruthy();
  });

  it('leaks no parser internals', async () => {
    const response = await request(buildApp())
      .post('/api/v1/nope')
      .set('Content-Type', 'application/json')
      .send('not json at all');

    const body = JSON.stringify(response.body);
    expect(response.status).toBe(400);
    [/JSON\.parse/i, /body-parser/i, /at \//, /node_modules/, /position \d+/i].forEach((pattern) =>
      expect(body).not.toMatch(pattern),
    );
  });
});

describe('body size limit', () => {
  it('rejects a JSON body over 100 KB with a controlled envelope', async () => {
    const oversized = { note: 'x'.repeat(120 * 1024) };
    const response = await request(buildApp())
      .post('/api/v1/nope')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(oversized));

    expect(response.status).toBe(413);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(response.text).not.toMatch(/<html|PayloadTooLargeError/i);
  });

  it('accepts a body under the limit', async () => {
    const response = await request(buildApp())
      .post('/api/v1/nope')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ note: 'x'.repeat(1024) }));
    // Parsed successfully, then correctly 404 — the limit did not reject it.
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('API_ROUTE_NOT_FOUND');
  });
});

describe('unexpected failure', () => {
  it('returns a safe 500 INTERNAL_ERROR', async () => {
    const app = buildApp({ registerTestRoutes: boom, logger: silentLogger() });
    const response = await request(app).get('/api/v1/test-only/throw');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: expect.any(String) },
      meta: { requestId: expect.any(String) },
    });
  });

  it('leaks no stack, path, credential or connection string', async () => {
    const app = buildApp({ registerTestRoutes: boom, logger: silentLogger() });
    const response = await request(app).get('/api/v1/test-only/throw');
    const payload = `${response.text} ${JSON.stringify(response.headers)}`;

    [
      /mongodb\+srv/i,
      /s3cr3t/,
      /AWS_SECRET_ACCESS_KEY/i,
      /AKIAEXAMPLE/,
      /ECONNREFUSED/,
      /at [A-Za-z]+ \(/,
      /\/srv\//,
      /node_modules/,
      /Error:/,
      /stack/i,
    ].forEach((pattern) => expect(payload).not.toMatch(pattern));
  });

  it('handles a rejected async handler the same way', async () => {
    const app = buildApp({ registerTestRoutes: boom, logger: silentLogger() });
    const response = await request(app).get('/api/v1/test-only/async-throw');
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(response.text).not.toMatch(/secret\.js|\/srv\//);
  });

  it('still returns the request id so the failure can be correlated', async () => {
    const app = buildApp({ registerTestRoutes: boom, logger: silentLogger() });
    const response = await request(app).get('/api/v1/test-only/throw');
    expect(response.body.meta.requestId).toBe(response.headers['x-request-id']);
  });

  it('logs safe correlation metadata, never the raw error text', async () => {
    // A real pino logger, spied on: pino-http needs a genuine logger (it calls
    // .child()), so a hand-made stub would exercise a different code path.
    const logger = silentLogger();
    const errorSpy = vi.spyOn(logger, 'error');

    const app = buildApp({ registerTestRoutes: boom, logger });
    const response = await request(app).get('/api/v1/test-only/throw');

    const unhandled = errorSpy.mock.calls.find(([, message]) => message === 'unhandled error');
    expect(unhandled).toBeTruthy();

    const [payload] = unhandled;
    // Correlation: the same id the client received.
    expect(payload.reqId).toBe(response.body.meta.requestId);
    // A useful, safe category for an operator.
    expect(payload.err.type).toBe('Error');
    expect(payload.status).toBe(500);
    expect(payload.code).toBe('INTERNAL_ERROR');
    // The raw message and stack are never recorded.
    expect(payload.err).not.toHaveProperty('message');
    expect(payload.err).not.toHaveProperty('stack');
    expect(payload.err).not.toHaveProperty('cause');
  });

  it('writes no credential, connection string, body content or path to the log', async () => {
    // Asserts on the bytes pino actually writes, after serialisers and
    // redaction — not on the arguments handed to the logger, which pino has
    // not processed yet.
    const { logger, output } = capturingLogger();
    const app = buildApp({ registerTestRoutes: boom, logger });

    await request(app).get('/api/v1/test-only/throw');
    await request(app).get('/api/v1/test-only/async-throw');

    const logged = output();
    expect(logged).toMatch(/unhandled error/);

    [
      /mongodb\+srv/i,
      /s3cr3t/,
      /admin:/,
      /AWS_SECRET_ACCESS_KEY/i,
      /AKIAEXAMPLE/,
      /ECONNREFUSED/,
      /\/srv\//,
      /secret\.js/,
      /node_modules/,
      /at [A-Za-z]+ \(/,
      /"stack"/,
      /Internal failure/,
      /Async internal failure/,
    ].forEach((pattern) => expect(logged, `leaked ${pattern}`).not.toMatch(pattern));
  });

  it('still records the request id and a safe category in the written log', async () => {
    const { logger, output } = capturingLogger();
    const app = buildApp({ registerTestRoutes: boom, logger });
    const response = await request(app).get('/api/v1/test-only/throw');

    const entry = output()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .find((line) => line.msg === 'unhandled error');

    expect(entry).toBeTruthy();
    expect(entry.reqId).toBe(response.body.meta.requestId);
    expect(entry.err).toEqual({ type: 'Error' });
    expect(entry.status).toBe(500);
    expect(entry.code).toBe('INTERNAL_ERROR');
  });

  it('logs no request-body content when JSON is malformed', async () => {
    const { logger, output } = capturingLogger();

    // A body carrying candidate data AND an invalid trailing comma. The
    // parser's message quotes the offending fragment, so this is the realistic
    // path by which candidate data could reach a log.
    await request(buildApp({ logger }))
      .post('/api/v1/nope')
      .set('Content-Type', 'application/json')
      .send('{"fullName":"Jane Candidate","email":"jane@example.com",}');

    const logged = output();
    expect(logged).toMatch(/MALFORMED_REQUEST/);

    [/Jane Candidate/, /jane@example\.com/, /fullName/, /Unexpected token/i, /"stack"/].forEach(
      (pattern) => expect(logged, `leaked ${pattern}`).not.toMatch(pattern),
    );
  });

  it('adds no test-only route to a normally built application', async () => {
    const response = await request(buildApp()).get('/api/v1/test-only/throw');
    expect(response.status).toBe(404);
  });
});
