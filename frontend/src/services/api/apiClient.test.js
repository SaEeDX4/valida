import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiRequest, buildUrl, ApiError, API_ERROR_TYPE } from './apiClient.js';

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiClient — URL handling', () => {
  it('builds a path against the configured base without doubling slashes', () => {
    expect(buildUrl('/api/v1/jobs')).toMatch(/\/api\/v1\/jobs$/);
    expect(buildUrl('api/v1/jobs')).toMatch(/\/api\/v1\/jobs$/);
    expect(buildUrl('/api/v1/jobs')).not.toMatch(/\/\/api/);
  });

  it('issues a GET by default and sends no manual Content-Type', async () => {
    fetch.mockResolvedValue(jsonResponse({ success: true, data: {} }));
    await apiRequest('/api/v1/jobs');
    const [, init] = fetch.mock.calls[0];
    expect(init.method).toBe('GET');
    expect(init.headers['Content-Type']).toBeUndefined();
  });
});

describe('apiClient — success parsing', () => {
  it('returns the data payload of a canonical envelope', async () => {
    fetch.mockResolvedValue(jsonResponse({ success: true, data: { items: [] }, meta: { requestId: 'r-1' } }));
    const result = await apiRequest('/api/v1/jobs');
    expect(result.data).toEqual({ items: [] });
    expect(result.requestId).toBe('r-1');
  });

  it('treats a 2xx that is not the canonical envelope as malformed, not empty', async () => {
    fetch.mockResolvedValue(jsonResponse({ items: [] }));
    await expect(apiRequest('/api/v1/jobs')).rejects.toMatchObject({
      type: API_ERROR_TYPE.MALFORMED,
    });
  });

  it('treats a non-JSON 2xx body as malformed', async () => {
    fetch.mockResolvedValue(new Response('<html>not json</html>', { status: 200 }));
    await expect(apiRequest('/api/v1/jobs')).rejects.toMatchObject({
      type: API_ERROR_TYPE.MALFORMED,
    });
  });

  it('treats success:false with 200 as malformed', async () => {
    fetch.mockResolvedValue(jsonResponse({ success: false, data: {} }));
    await expect(apiRequest('/api/v1/jobs')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('apiClient — error normalisation', () => {
  it('normalises an HTTP error envelope', async () => {
    fetch.mockResolvedValue(
      jsonResponse(
        { success: false, error: { code: 'JOB_NOT_FOUND', message: "This role isn't available." }, meta: { requestId: 'r-2' } },
        404,
      ),
    );
    await expect(apiRequest('/api/v1/jobs/x')).rejects.toMatchObject({
      type: API_ERROR_TYPE.HTTP,
      status: 404,
      code: 'JOB_NOT_FOUND',
      requestId: 'r-2',
    });
  });

  it('extracts structured field errors', async () => {
    fetch.mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Some information needs to be corrected.',
            fieldErrors: [{ field: 'email', code: 'INVALID_EMAIL', message: 'Enter a valid email address.' }],
          },
        },
        422,
      ),
    );
    const error = await apiRequest('/x').catch((e) => e);
    expect(error.fieldErrors).toEqual([
      { field: 'email', code: 'INVALID_EMAIL', message: 'Enter a valid email address.' },
    ]);
  });

  it('survives an error body that is not JSON', async () => {
    fetch.mockResolvedValue(new Response('gateway timeout', { status: 504 }));
    await expect(apiRequest('/x')).rejects.toMatchObject({ status: 504, type: API_ERROR_TYPE.HTTP });
  });

  it('classifies a rejected fetch as a network error', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(apiRequest('/x')).rejects.toMatchObject({ type: API_ERROR_TYPE.NETWORK });
  });

  it('never leaks a stack trace or internal detail into the message', async () => {
    fetch.mockRejectedValue(new TypeError('connect ECONNREFUSED 127.0.0.1:4000'));
    const error = await apiRequest('/x').catch((e) => e);
    expect(error.message).toBe('The request could not be completed.');
    expect(error.message).not.toMatch(/ECONNREFUSED|at |stack/i);
  });

  it('ignores a non-string server message rather than rendering an object', async () => {
    fetch.mockResolvedValue(jsonResponse({ success: false, error: { message: { evil: true } } }, 500));
    const error = await apiRequest('/x').catch((e) => e);
    expect(typeof error.message).toBe('string');
    expect(error.message).toContain('500');
  });

  it('discards malformed fieldErrors entries', async () => {
    fetch.mockResolvedValue(
      jsonResponse({ success: false, error: { fieldErrors: ['nope', { nofield: 1 }] } }, 422),
    );
    const error = await apiRequest('/x').catch((e) => e);
    expect(error.fieldErrors).toEqual([]);
  });
});

describe('API base URL convention (Correction Cycle 1, finding 1)', () => {
  /**
   * VITE_API_BASE_URL is the backend ORIGIN. The canonical /api/v1 prefix lives
   * in the feature request paths, so it must appear exactly once in the final
   * URL. The earlier .env.example documented an origin that already contained
   * the prefix, which produced /api/v1/api/v1/jobs.
   *
   * config/env.js is imported as a module constant, so these tests assert the
   * joining rule against the real buildUrl with the configured base, and assert
   * the composed path of every real request the app makes.
   */
  it('never produces a duplicated /api/v1 segment', () => {
    ['/api/v1/jobs', '/api/v1/jobs/a-slug', '/api/v1/jobs/a-slug/applications'].forEach((path) => {
      const url = buildUrl(path);
      expect(url).not.toMatch(/\/api\/v1\/api\/v1\//);
      // Exactly one occurrence, not merely "ends with the right thing".
      expect(url.match(/\/api\/v1\//g) ?? []).toHaveLength(1);
    });
  });

  it('joins a non-empty origin to a path with exactly one separator', async () => {
    fetch.mockResolvedValue(jsonResponse({ success: true, data: {} }));
    await apiRequest('/api/v1/jobs');
    const [url] = fetch.mock.calls[0];
    expect(url).not.toMatch(/([^:])\/\//);
    expect(url.endsWith('/api/v1/jobs')).toBe(true);
  });

  it('resolves same-origin when no base is configured', () => {
    // With an empty base the path must stay root-relative and unprefixed.
    const url = buildUrl('/api/v1/jobs');
    expect(url.includes('/api/v1/jobs')).toBe(true);
    expect(url).not.toMatch(/undefined|null/);
  });
});
