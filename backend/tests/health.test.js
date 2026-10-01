import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp, buildReadyApp, buildConnectedApp } from './helpers.js';
import { Readiness, DEPENDENCY_STATE } from '../src/modules/health/readiness.js';

describe('GET /api/v1/health', () => {
  it('returns 200 with the canonical success envelope', async () => {
    const response = await request(buildApp()).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { status: 'ok' },
      meta: { requestId: expect.any(String) },
    });
  });

  it('is alive even when required dependencies are not ready', async () => {
    // Liveness must never depend on the database: a probe that did would
    // restart a healthy process during a database blip.
    const response = await request(buildApp()).get('/api/v1/health');
    expect(response.status).toBe(200);
  });

  it('echoes the request id in the header and the envelope', async () => {
    const response = await request(buildApp()).get('/api/v1/health');
    expect(response.headers['x-request-id']).toBeTruthy();
    expect(response.body.meta.requestId).toBe(response.headers['x-request-id']);
  });

  it('generates a distinct id per request', async () => {
    const app = buildApp();
    const [a, b] = await Promise.all([
      request(app).get('/api/v1/health'),
      request(app).get('/api/v1/health'),
    ]);
    expect(a.body.meta.requestId).not.toBe(b.body.meta.requestId);
  });

  it('reuses a well-formed inbound request id', async () => {
    const inbound = 'trace-abc-123456';
    const response = await request(buildApp()).get('/api/v1/health').set('X-Request-ID', inbound);
    expect(response.headers['x-request-id']).toBe(inbound);
  });

  it.each([
    ['too short', 'abc'],
    ['illegal characters', 'bad id with spaces'],
    ['excessively long', 'a'.repeat(200)],
  ])('replaces an untrusted inbound id: %s', async (_label, inbound) => {
    const response = await request(buildApp()).get('/api/v1/health').set('X-Request-ID', inbound);
    expect(response.headers['x-request-id']).not.toBe(inbound);
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('exposes no infrastructure detail or secrets', async () => {
    const response = await request(buildApp()).get('/api/v1/health');
    const body = JSON.stringify(response.body);
    expect(Object.keys(response.body.data)).toEqual(['status']);
    [/version/i, /uptime/i, /mongo/i, /node/i, /path/i, /env/i].forEach((pattern) =>
      expect(body).not.toMatch(pattern),
    );
  });

  it('is served only under the versioned API base path', async () => {
    const app = buildApp();
    for (const path of ['/health', '/api/health', '/healthz', '/api/v2/health']) {
      const response = await request(app).get(path);
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('API_ROUTE_NOT_FOUND');
    }
  });
});

describe('GET /api/v1/health/ready', () => {
  it('returns 503 when only configuration is ready', async () => {
    // The state before the database connects, or after it is lost.
    const response = await request(buildApp()).get('/api/v1/health/ready');
    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    // Exact canonical copy.
    expect(response.body.error.message).toBe('Service is not ready.');
    expect(response.body.meta.requestId).toBeTruthy();
  });

  it('still returns the canonical 503 with the database connected, because resume storage is not ready here and B6 is unimplemented', async () => {
    // The state a running B2 server reaches. Resume storage and notifications
    // are required and do not exist yet, so claiming ready would be false.
    const response = await request(buildConnectedApp()).get('/api/v1/health/ready');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Service is not ready.' },
      meta: { requestId: expect.any(String) },
    });
  });

  it('never names the failing dependency in the public body', async () => {
    for (const app of [buildApp(), buildConnectedApp()]) {
      const response = await request(app).get('/api/v1/health/ready');
      const body = JSON.stringify(response.body);
      ['database', 'mongo', 'resumeStorage', 'notifications', 'configuration', 'not_implemented'].forEach(
        (leak) => expect(body.toLowerCase()).not.toContain(leak.toLowerCase()),
      );
    }
  });

  it('returns 200 ready only when every required dependency is ready', async () => {
    const response = await request(buildReadyApp()).get('/api/v1/health/ready');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { status: 'ready' },
      meta: { requestId: expect.any(String) },
    });
  });

  it('uses the exact canonical message in every not-ready case', async () => {
    const readiness = Readiness.fullyReadyForTests();
    readiness.beginShutdown();
    const response = await request(buildApp({ readiness })).get('/api/v1/health/ready');
    expect(response.body.error.message).toBe('Service is not ready.');
  });

  it('returns 503 again as soon as one required dependency degrades', async () => {
    const readiness = Readiness.fullyReadyForTests();
    readiness.set('database', DEPENDENCY_STATE.UNAVAILABLE);
    const response = await request(buildApp({ readiness })).get('/api/v1/health/ready');
    expect(response.status).toBe(503);
  });

  it('stops reporting ready once shutdown begins', async () => {
    const readiness = Readiness.fullyReadyForTests();
    readiness.beginShutdown();
    const response = await request(buildApp({ readiness })).get('/api/v1/health/ready');
    expect(response.status).toBe(503);
  });
});

describe('readiness registry', () => {
  it('starts with every canonical dependency required and unimplemented', () => {
    const state = new Readiness().describe();
    expect(state.ready).toBe(false);
    expect(state.dependencies.map((d) => d.name).sort()).toEqual([
      'configuration',
      'database',
      'notifications',
      'resumeStorage',
    ]);
    expect(state.dependencies.every((d) => d.required)).toBe(true);
  });

  it('is not ready when only configuration is ready', () => {
    const readiness = new Readiness();
    readiness.set('configuration', DEPENDENCY_STATE.READY);
    expect(readiness.isReady()).toBe(false);
  });

  it('rejects an unknown dependency or state', () => {
    const readiness = new Readiness();
    expect(() => readiness.set('redis', DEPENDENCY_STATE.READY)).toThrow(/Unknown readiness dependency/);
    expect(() => readiness.set('database', 'green')).toThrow(/Unknown readiness state/);
  });
});
