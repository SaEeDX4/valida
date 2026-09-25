import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp, testConfig } from './helpers.js';

const HEALTH = '/api/v1/health';

describe('security headers', () => {
  it('does not advertise the framework', async () => {
    const response = await request(buildApp()).get(HEALTH);
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('sets the expected Helmet headers', async () => {
    const { headers } = await request(buildApp()).get(HEALTH);
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['strict-transport-security']).toBeTruthy();
    expect(headers['cross-origin-resource-policy']).toBe('same-origin');
    // JSON-only API: nothing may be rendered or embedded.
    expect(headers['content-security-policy']).toMatch(/default-src 'none'/);
    expect(headers['content-security-policy']).toMatch(/frame-ancestors 'none'/);
  });

  it('applies the headers to errors too', async () => {
    const { headers } = await request(buildApp()).get('/api/v1/nope');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-powered-by']).toBeUndefined();
  });
});

describe('CORS allowlist', () => {
  const app = () => buildApp({ config: testConfig({ corsAllowedOrigins: ['http://localhost:5173'] }) });

  it('grants an allowed origin', async () => {
    const response = await request(app()).get(HEALTH).set('Origin', 'http://localhost:5173');
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-expose-headers']).toMatch(/X-Request-ID/i);
  });

  it.each([
    'http://evil.example',
    'https://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5173.evil.example',
    'null',
  ])('does not grant %s', async (origin) => {
    const response = await request(app()).get(HEALTH).set('Origin', origin);
    // No allow-origin header: the browser blocks the response.
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never echoes an arbitrary origin back', async () => {
    const response = await request(app()).get(HEALTH).set('Origin', 'http://attacker.example');
    expect(response.headers['access-control-allow-origin']).not.toBe('http://attacker.example');
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('never combines credentials with the allowlist', async () => {
    const response = await request(app()).get(HEALTH).set('Origin', 'http://localhost:5173');
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('answers a preflight from an allowed origin', async () => {
    const response = await request(app())
      .options(HEALTH)
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET');
    expect(response.status).toBeLessThan(300);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('does not grant a preflight from a disallowed origin', async () => {
    const response = await request(app())
      .options(HEALTH)
      .set('Origin', 'http://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves a client that sends no Origin at all', async () => {
    // curl, server-to-server and platform probes send none.
    const response = await request(app()).get(HEALTH);
    expect(response.status).toBe(200);
  });
});

describe('general rate limit', () => {
  const limited = (max) =>
    buildApp({ config: testConfig({ rateLimit: { windowMs: 60_000, max } }) });

  it('returns a safe structured 429 once the limit is exceeded', async () => {
    const app = limited(3);
    // Health is exempt, so a non-exempt path is used.
    for (let i = 0; i < 3; i += 1) {
      const allowed = await request(app).get('/api/v1/nope');
      expect(allowed.status).toBe(404);
    }
    const blocked = await request(app).get('/api/v1/nope');
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        // Exact canonical copy.
        message: 'Too many attempts were received in a short period. Please wait and try again.',
      },
      meta: { requestId: expect.any(String) },
    });
    expect(blocked.text).not.toMatch(/<html|Too many requests, please try again later/);
  });

  it('advertises the standard rate-limit headers', async () => {
    const response = await request(limited(5)).get('/api/v1/nope');
    expect(response.headers['ratelimit-limit'] ?? response.headers.ratelimit).toBeTruthy();
  });

  it('exempts the health endpoints so platform probes cannot self-limit', async () => {
    const app = limited(2);
    for (let i = 0; i < 8; i += 1) {
      const response = await request(app).get(HEALTH);
      expect(response.status).toBe(200);
    }
  });

  it('exempts readiness as well', async () => {
    const app = limited(2);
    for (let i = 0; i < 6; i += 1) {
      const response = await request(app).get('/api/v1/health/ready');
      expect(response.status).toBe(503);
    }
  });
});
