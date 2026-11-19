// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resolveSeoConfig } from '../src/seo/siteConfig.js';
import { CLIENT_ADDRESS_CASES, TRUST_PROXY_VALUES } from '../../backend/tests/fixtures/clientAddressCases.js';
import { startDocumentServer } from './documentServer.js';
import { createJobsClient } from './jobsClient.js';
import { parseTrustedHops } from './visitorAddress.js';

/**
 * C6-T2 — the document server's side of visitor delegation, over real HTTP.
 *
 * A stand-in Jobs API on 127.0.0.1 RECORDS what the document server sends and
 * answers as the real API decides: the tester view only for a valid key and a
 * listed delegated visitor, the unlisted view otherwise. The real API's side
 * is backend/tests/c6-delegation.test.js; both run the same address table
 * (backend/tests/fixtures/clientAddressCases.js). The two real services
 * together, with real proxies' behaviour simulated, are e2e/c6/c6-t2-stack.mjs.
 *
 * SYNTHETIC DATA AND KEYS ONLY. Documentation addresses (RFC 5737, RFC 3849).
 */
const SITE = 'https://cybervalida.com';
const KEY = 'qa-c6t2-docserver-key-0123456789abcdef0123456789';
const LISTED = '203.0.113.7';
const UNLISTED = '192.0.2.44';
const LISTED_SET = new Set([LISTED, '2001:db8:10::beef', '127.0.0.1']);

const form = {
  phone: { enabled: false, required: false },
  message: { enabled: false, required: false, maxLength: 5000 },
  resume: { required: true, maxBytes: 5242880, allowedExtensions: ['.pdf', '.docx'] },
  screeningQuestions: [],
};
const job = (slug) => ({
  title: `QA Synthetic Tester Role ${slug}`,
  slug,
  location: 'QA Region, Canada',
  workArrangement: 'FULLY_REMOTE',
  employmentType: 'FULL_TIME',
  schedule: null,
  weeklyHours: 40,
  compensation: { currency: 'CAD', amount: 50, unit: 'HOUR', gross: true },
  description: 'QA TEST DATA',
  responsibilities: ['QA one'],
  requirements: ['QA two'],
  preferredQualifications: [],
  publishedAt: '2026-11-02T10:00:00.000Z',
  closesAt: null,
  applicationStatus: 'OPEN',
  applicationForm: form,
  eligibleWorkCountries: ['NZ'],
});
const SLUG = 'qa-tester-only';

let api;
let apiOrigin;
let apiMode = 'decide';
const apiRequests = [];
let collector;
let collectorOrigin;
const collected = [];
let redirecting;
let redirectingOrigin;

function envelope(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

let tmp;
let dist;
const servers = [];

async function documentServer({ key = KEY, trustedHops = false, origin = apiOrigin, seo = { siteUrl: SITE, allowIndexing: 'true' }, log } = {}) {
  const server = await startDocumentServer({
    distDir: dist,
    config: resolveSeoConfig(seo),
    jobs: createJobsClient({ apiOrigin: origin, serviceKey: key, timeoutMs: 2_000 }),
    jobApiPreloadBase: 'https://api.qa-valida.example.test',
    trustedHops,
    port: 0,
    log,
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

beforeAll(async () => {
  api = createServer((req, res) => {
    const visitor = req.headers['x-valida-visitor-address'] ?? null;
    const keyHeader = req.headers['x-valida-internal-key'];
    apiRequests.push({ url: req.url, visitor, key: keyHeader === undefined ? 'absent' : keyHeader === KEY ? 'the key' : 'another value', forwarded: req.headers['x-forwarded-for'] ?? null });
    if (apiMode === 'down') return envelope(res, 503, { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'x' } });
    // The real API's rule, reduced to this test's addresses.
    const tester = keyHeader === KEY && LISTED_SET.has(visitor);
    const audience = tester ? { 'x-valida-audience': 'tester' } : {};
    const url = new URL(req.url, 'http://api.invalid');
    if (url.pathname === '/api/v1/jobs') {
      const items = tester ? [{ ...job(SLUG), applicationForm: undefined }] : [];
      return envelope(res, 200, { success: true, data: { items, pagination: { page: 1, limit: 50, total: items.length, totalPages: items.length ? 1 : 0 } }, meta: { requestId: 'qa' } }, audience);
    }
    if (url.pathname === `/api/v1/jobs/${SLUG}` && tester) return envelope(res, 200, { success: true, data: job(SLUG), meta: { requestId: 'qa' } }, audience);
    return envelope(res, 404, { success: false, error: { code: 'JOB_NOT_FOUND', message: 'x' }, meta: { requestId: 'qa' } }, audience);
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  apiOrigin = `http://127.0.0.1:${api.address().port}`;

  collector = createServer((req, res) => {
    collected.push({ url: req.url, key: req.headers['x-valida-internal-key'] === undefined ? 'absent' : 'present' });
    envelope(res, 200, { success: true, data: job(SLUG) });
  });
  await new Promise((resolve) => collector.listen(0, '127.0.0.1', resolve));
  collectorOrigin = `http://127.0.0.1:${collector.address().port}`;

  redirecting = createServer((req, res) => {
    res.writeHead(req.url.includes('?') ? 307 : 302, { location: `${collectorOrigin}${req.url}` });
    res.end();
  });
  await new Promise((resolve) => redirecting.listen(0, '127.0.0.1', resolve));
  redirectingOrigin = `http://127.0.0.1:${redirecting.address().port}`;

  tmp = mkdtempSync(path.join(os.tmpdir(), 'valida-c6t2-docserver-'));
  dist = path.join(tmp, 'dist');
  mkdirSync(path.join(dist, 'assets'), { recursive: true });
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>Valida</title>\n<!--valida:head-->\n</head><body><div id="root"></div></body></html>');
  writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log("qa")');
  writeFileSync(path.join(dist, 'valida-seo.json'), '{}');
});

afterEach(() => {
  apiMode = 'decide';
  apiRequests.length = 0;
  collected.length = 0;
});

afterAll(async () => {
  for (const server of [...servers, api, collector, redirecting]) await new Promise((resolve) => server.close(resolve));
  rmSync(tmp, { recursive: true, force: true });
});

/** A request sent exactly as written, with exactly these headers. */
function get(base, target, headers = {}) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port, path: target, method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}
const lastSent = () => apiRequests[apiRequests.length - 1];

/* ----------------------------------------- the visitor the server names -- */

describe('the visitor the document server establishes — the same table as the API', () => {
  it.each(CLIENT_ADDRESS_CASES.filter((c) => c.http).map((c) => [c.name, c]))('%s', async (_name, c) => {
    if (typeof c.trustedHops !== 'number' && c.trustedHops !== false) return;
    const base = await documentServer({ trustedHops: c.trustedHops });
    await get(base, `/careers/${SLUG}`, c.forwardedFor === undefined ? {} : { 'x-forwarded-for': c.forwardedFor });
    expect(lastSent().visitor).toBe(c.expected ?? 'unlisted');
    expect(lastSent().key).toBe('the key');
  });

  it('TRUST_PROXY: the document server reads the variable with the backend\'s own rule', () => {
    for (const [value, expected] of TRUST_PROXY_VALUES) expect(parseTrustedHops(value)).toBe(expected);
  });

  it('visitor-supplied delegation headers are neither read nor passed on — even with the right key', async () => {
    const base = await documentServer({ trustedHops: 1 });
    const response = await get(base, `/careers/${SLUG}`, {
      'x-forwarded-for': UNLISTED,
      'x-valida-visitor-address': LISTED,
      'x-valida-internal-key': KEY,
      'x-valida-audience': 'tester',
    });
    expect(lastSent().visitor).toBe(UNLISTED);
    expect(response.status).toBe(404);
    expect(response.headers['x-valida-audience']).toBeUndefined();
  });

  it('a short forwarding chain from a LISTED socket peer (127.0.0.1) is an unknown visitor', async () => {
    const base = await documentServer({ trustedHops: 1 });
    const response = await get(base, `/careers/${SLUG}`);
    expect(lastSent().visitor).toBe('unlisted');
    expect(response.status).toBe(404);
    // With proxy trust disabled the same listed peer is the visitor (T1).
    const direct = await documentServer({ trustedHops: false });
    expect((await get(direct, `/careers/${SLUG}`)).status).toBe(200);
  });
});

describe('the key: sent only when usable, only to the API origin', () => {
  it.each([
    ['no key', null],
    ['an empty key', ''],
    ['an unusable (short) key', 'short'],
    ['a key with a space', `${KEY.slice(0, 20)} ${KEY.slice(21)}`],
  ])('%s: no key header, but the visitor header is still sent — so the API answers with the unlisted view', async (_label, key) => {
    const base = await documentServer({ key, trustedHops: false });
    const response = await get(base, `/careers/${SLUG}`);
    expect(lastSent().key).toBe('absent');
    expect(lastSent().visitor).toBe('127.0.0.1');
    expect(response.status).toBe(404);
    expect(createJobsClient({ apiOrigin, serviceKey: key }).delegation).toBe('disabled');
  });

  it('a usable key is sent, and the client says only that delegation is enabled', async () => {
    expect(createJobsClient({ apiOrigin, serviceKey: KEY }).delegation).toBe('enabled');
    expect(JSON.stringify(createJobsClient({ apiOrigin, serviceKey: KEY }))).not.toContain(KEY);
  });

  it('an API origin that REDIRECTS (302 for a Job, 307 for the sitemap) to another origin: never followed; the key never reaches it; 503', async () => {
    const base = await documentServer({ origin: redirectingOrigin, trustedHops: false });
    const job302 = await get(base, `/careers/${SLUG}`);
    const apply = await get(base, `/careers/${SLUG}/apply`);
    const sitemap = await get(base, '/sitemap.xml');
    expect(collected).toEqual([]);
    expect([job302.status, apply.status, sitemap.status]).toEqual([503, 503, 503]);
    expect(job302.headers['retry-after']).toBe('60');
  });

  it('the key is in no document, no header and no log line', async () => {
    const lines = [];
    const base = await documentServer({ trustedHops: 1, log: (entry) => lines.push(JSON.stringify(entry)) });
    const bodies = [];
    for (const target of ['/careers', `/careers/${SLUG}`, `/careers/${SLUG}/apply`, '/sitemap.xml', '/']) {
      for (const forwarded of [LISTED, UNLISTED]) {
        const response = await get(base, target, { 'x-forwarded-for': forwarded });
        bodies.push(response.body, JSON.stringify(response.headers));
      }
    }
    expect(bodies.join('\n')).not.toContain(KEY);
    expect(lines.length).toBeGreaterThan(0);
    const log = lines.join('\n');
    for (const forbidden of [KEY, LISTED, UNLISTED]) expect(log).not.toContain(forbidden);
  });
});

/* ------------------------------------------------------------ documents -- */

describe('documents agree with the API, for each visitor', () => {
  it('a listed visitor: Job Detail 200 with its head and the tester header; Apply 200', async () => {
    const base = await documentServer({ trustedHops: 1 });
    const detail = await get(base, `/careers/${SLUG}`, { 'x-forwarded-for': LISTED });
    expect(detail.status).toBe(200);
    expect(detail.body).toContain(`<title>QA Synthetic Tester Role ${SLUG}`);
    expect(detail.headers['x-valida-audience']).toBe('tester');
    expect(detail.headers['cache-control']).toBe('private, no-store');
    expect(detail.body).toContain(`<link rel="preload" as="fetch" crossorigin="anonymous" href="https://api.qa-valida.example.test/api/v1/jobs/${SLUG}">`);
    const apply = await get(base, `/careers/${SLUG}/apply`, { 'x-forwarded-for': LISTED });
    expect(apply.status).toBe(200);
    expect(apply.headers['x-valida-audience']).toBe('tester');
  });

  it('an unlisted visitor: 404, no tester header, no title, no JobPosting', async () => {
    const base = await documentServer({ trustedHops: 1 });
    for (const target of [`/careers/${SLUG}`, `/careers/${SLUG}/apply`]) {
      const response = await get(base, target, { 'x-forwarded-for': UNLISTED });
      expect(response.status).toBe(404);
      expect(response.headers['x-valida-audience']).toBeUndefined();
      expect(response.body).not.toContain('QA Synthetic Tester Role');
      expect(response.body).not.toContain('application/ld+json');
      expect(response.headers['cache-control']).toBe('private, no-store');
    }
  });

  it('the sitemap is the PUBLIC view whoever asks: read as "unlisted", the tester-only Job never listed', async () => {
    const base = await documentServer({ trustedHops: 1 });
    for (const forwarded of [LISTED, UNLISTED]) {
      apiRequests.length = 0;
      const sitemap = await get(base, '/sitemap.xml', { 'x-forwarded-for': forwarded });
      expect(sitemap.status).toBe(200);
      expect(sitemap.body).not.toContain(SLUG);
      expect(apiRequests.every((r) => r.visitor === 'unlisted' && r.key === 'the key')).toBe(true);
      expect(sitemap.headers['cache-control']).toBe('no-cache');
      expect(sitemap.headers['x-valida-audience']).toBeUndefined();
    }
  });

  it('a backend failure is a 503, never the empty or missing answer', async () => {
    const base = await documentServer({ trustedHops: 1 });
    apiMode = 'down';
    for (const target of [`/careers/${SLUG}`, `/careers/${SLUG}/apply`]) {
      const response = await get(base, target, { 'x-forwarded-for': LISTED });
      expect(response.status).toBe(503);
      expect(response.headers['retry-after']).toBe('60');
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers['x-valida-audience']).toBeUndefined();
    }
    expect((await get(base, '/sitemap.xml', { 'x-forwarded-for': LISTED })).status).toBe(503);
  });

  it('indexing disabled (review build): the same visitor rules, every page noindex, nofollow, no sitemap', async () => {
    const base = await documentServer({ trustedHops: 1, seo: { siteUrl: SITE } });
    const listed = await get(base, `/careers/${SLUG}`, { 'x-forwarded-for': LISTED });
    expect(listed.status).toBe(200);
    expect(listed.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(listed.body).not.toContain('application/ld+json');
    expect((await get(base, `/careers/${SLUG}`, { 'x-forwarded-for': UNLISTED })).status).toBe(404);
    expect((await get(base, '/sitemap.xml', { 'x-forwarded-for': LISTED })).status).toBe(404);
  });
});

describe('caching: one visitor\'s document is never another\'s', () => {
  const recruitmentTargets = ['/careers', `/careers/${SLUG}`, `/careers/${SLUG}/apply`];

  it.each([
    ['listed, then unlisted', LISTED, UNLISTED],
    ['unlisted, then listed', UNLISTED, LISTED],
  ])('%s, with conditional requests: private, no-store; no ETag or Last-Modified; never 304; each gets its own view', async (_label, first, second) => {
    const base = await documentServer({ trustedHops: 1 });
    for (const target of recruitmentTargets) {
      const a = await get(base, target, { 'x-forwarded-for': first });
      const b = await get(base, target, { 'x-forwarded-for': second, 'if-none-match': '*', 'if-modified-since': new Date(Date.now() + 60_000).toUTCString() });
      for (const response of [a, b]) {
        expect(response.status).not.toBe(304);
        expect(response.headers.etag).toBeUndefined();
        expect(response.headers['last-modified']).toBeUndefined();
        expect(response.headers['cache-control']).toBe('private, no-store');
      }
      if (target !== '/careers') {
        const listedResponse = first === LISTED ? a : b;
        const unlistedResponse = first === LISTED ? b : a;
        expect(listedResponse.status).toBe(200);
        expect(unlistedResponse.status).toBe(404);
        expect(unlistedResponse.body).not.toContain('QA Synthetic Tester Role');
      } else {
        expect(a.body).toBe(b.body);
      }
    }
  });

  it('documents that do not depend on recruitment keep no-cache; fingerprinted assets keep public, immutable', async () => {
    const base = await documentServer({ trustedHops: 1 });
    for (const target of ['/', '/about', '/privacy', '/legal', '/no-such-page']) {
      expect((await get(base, target, { 'x-forwarded-for': LISTED })).headers['cache-control']).toBe('no-cache');
    }
    const asset = await get(base, '/assets/index-abc123.js', { 'x-forwarded-for': LISTED });
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(asset.headers.etag).toBeUndefined();
  });
});
