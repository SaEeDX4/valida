// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resolveSeoConfig } from '../src/seo/siteConfig.js';
import { startDocumentServer } from './documentServer.js';
import { createJobsClient } from './jobsClient.js';
import { REVIEW_REQUIRES_NOINDEX_BUILD, SITE_ACCESS_PROBLEMS, resolveDocumentSiteAccess } from './siteAccess.js';
import { resolveSiteAccess } from '../../backend/src/config/siteAccess.js';

/**
 * C6-T3 — whole-site private access in the document server, over real HTTP.
 * A stand-in API counts every server-side read: a denied visitor must cause
 * none. The two real services together: e2e/c6/c6-t3-stack.mjs.
 * Documentation addresses only.
 */
const SITE = 'https://cybervalida.com';
const KEY = 'qa-c6t3-docserver-key-0123456789abcdef0123456789';
const LISTED = '203.0.113.7';
const UNLISTED = '192.0.2.44';
const PRIVATE = 'private, no-store';

let api;
let apiOrigin;
const apiRequests = [];
let tmp;
let dist;
const servers = [];

async function documentServer({ siteAccess, allowlist, trustedHops = false, indexing = true } = {}) {
  const site = resolveSiteAccess({ siteAccess, allowlist, appEnv: 'local' });
  if (!site.ok) throw new Error(site.problem);
  const server = await startDocumentServer({
    distDir: dist,
    config: resolveSeoConfig(indexing ? { siteUrl: SITE, allowIndexing: 'true' } : {}),
    jobs: createJobsClient({ apiOrigin, serviceKey: KEY, timeoutMs: 2_000 }),
    jobApiPreloadBase: 'https://api.qa-valida.example.test',
    trustedHops,
    site,
    port: 0,
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

beforeAll(async () => {
  api = createServer((req, res) => {
    apiRequests.push(req.url);
    if (req.url.startsWith('/api/v1/jobs?')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { items: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } }, meta: { requestId: 'qa' } }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: { code: 'JOB_NOT_FOUND', message: 'x' }, meta: { requestId: 'qa' } }));
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  apiOrigin = `http://127.0.0.1:${api.address().port}`;
  tmp = mkdtempSync(path.join(os.tmpdir(), 'valida-c6t3-docserver-'));
  dist = path.join(tmp, 'dist');
  mkdirSync(path.join(dist, 'assets'), { recursive: true });
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>Valida</title>\n<!--valida:head-->\n</head><body><div id="root"></div></body></html>');
  writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log("qa")');
  writeFileSync(path.join(dist, 'favicon.ico'), 'ico');
  writeFileSync(path.join(dist, 'valida-seo.json'), '{}');
});

afterEach(() => {
  apiRequests.length = 0;
});

afterAll(async () => {
  for (const server of [...servers, api]) await new Promise((resolve) => server.close(resolve));
  rmSync(tmp, { recursive: true, force: true });
});

function send(base, target, { method = 'GET', headers = {}, body } = {}) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port, path: target, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function expectPrivateHeaders(response) {
  expect(response.headers['cache-control']).toBe(PRIVATE);
  expect(response.headers.etag).toBeUndefined();
  expect(response.headers['last-modified']).toBeUndefined();
}

describe('start-up configuration', () => {
  it.each([
    [{ appEnv: undefined, siteAccess: undefined, indexing: true }, 'public'],
    [{ appEnv: 'local', siteAccess: 'private', allowlist: '203.0.113.0/24', indexing: true }, 'private'],
    [{ appEnv: 'review', siteAccess: 'private', allowlist: '203.0.113.0/24', indexing: false }, 'private'],
    [{ appEnv: 'production', siteAccess: 'public', indexing: true }, 'public'],
    // Correction 1 (plan 4.6.2): production requires the explicit literal "public".
    [{ appEnv: 'production', siteAccess: undefined, indexing: true }, SITE_ACCESS_PROBLEMS.PRODUCTION_REQUIRES_PUBLIC],
    [{ appEnv: 'production', siteAccess: '', indexing: true }, SITE_ACCESS_PROBLEMS.PRODUCTION_REQUIRES_PUBLIC],
    [{ appEnv: 'review', siteAccess: 'private', allowlist: '203.0.113.0/24', indexing: true }, REVIEW_REQUIRES_NOINDEX_BUILD],
    [{ appEnv: 'review', siteAccess: undefined, indexing: false }, SITE_ACCESS_PROBLEMS.REVIEW_REQUIRES_PRIVATE],
    [{ appEnv: 'review', siteAccess: 'public', indexing: false }, SITE_ACCESS_PROBLEMS.REVIEW_REQUIRES_PRIVATE],
    [{ appEnv: 'review', siteAccess: 'private', allowlist: undefined, indexing: false }, SITE_ACCESS_PROBLEMS.PRIVATE_ALLOWLIST_ABSENT],
    [{ appEnv: 'review', siteAccess: 'private', allowlist: '0.0.0.0/0', indexing: false }, SITE_ACCESS_PROBLEMS.PRIVATE_ALLOWLIST_INVALID],
    [{ appEnv: 'production', siteAccess: 'private', allowlist: '203.0.113.0/24', indexing: true }, SITE_ACCESS_PROBLEMS.PRODUCTION_REQUIRES_PUBLIC],
    [{ appEnv: 'local', siteAccess: 'Private', allowlist: '203.0.113.0/24', indexing: true }, SITE_ACCESS_PROBLEMS.SITE_ACCESS_INVALID],
    [{ appEnv: 'qa', siteAccess: 'public', indexing: true }, SITE_ACCESS_PROBLEMS.APP_ENV_INVALID],
  ])('%j -> %s', (input, expected) => {
    const result = resolveDocumentSiteAccess(input);
    if (expected === 'public' || expected === 'private') expect(result).toMatchObject({ ok: true, site: { mode: expected } });
    else {
      expect(result).toMatchObject({ ok: false, problem: expected });
      expect(result.rule).not.toMatch(/203\.0\.113|0\.0\.0\.0/);
    }
  });
});

describe('private site, unlisted visitor: 403 "Forbidden" before anything else', () => {
  const TARGETS = [
    ['GET', '/'],
    ['GET', '/careers'],
    ['GET', '/careers/qa-any-role'],
    ['GET', '/careers/qa-any-role/apply'],
    ['GET', '/robots.txt'],
    ['GET', '/sitemap.xml'],
    ['GET', '/assets/index-abc123.js'],
    ['GET', '/favicon.ico'],
    ['GET', '/Careers/'],
    ['GET', '/healthz/'],
    ['GET', '/healthz?probe=1'],
    ['GET', '/HEALTHZ'],
    ['POST', '/healthz'],
    ['POST', '/careers/qa-any-role/apply'],
    ['DELETE', '/'],
    ['OPTIONS', '/'],
    ['GET', '/no-such-page'],
  ];
  it.each(TARGETS)('%s %s', async (method, target) => {
    const base = await documentServer({ siteAccess: 'private', allowlist: '203.0.113.0/24' });
    const response = await send(base, target, { method, headers: { 'if-none-match': '*', origin: 'http://localhost:4173' }, body: method === 'POST' ? 'x=1' : undefined });
    expect(response.status).toBe(403);
    expect(response.body).toBe('Forbidden');
    expect(response.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(response.headers.location).toBeUndefined();
    expectPrivateHeaders(response);
    if (method === 'POST') expect(response.headers.connection).toBe('close');
    expect(apiRequests).toEqual([]);
  });

  it('HEAD: 403 with an empty body', async () => {
    const base = await documentServer({ siteAccess: 'private', allowlist: '203.0.113.0/24' });
    const response = await send(base, '/careers', { method: 'HEAD' });
    expect(response.status).toBe(403);
    expect(response.body).toBe('');
    expectPrivateHeaders(response);
  });

  it('a non-canonical path is refused, not redirected (no Location leaks the canonical form)', async () => {
    const base = await documentServer({ siteAccess: 'private', allowlist: '203.0.113.0/24' });
    const response = await send(base, '/About/');
    expect(response.status).toBe(403);
    expect(response.headers.location).toBeUndefined();
  });

  it('GET and HEAD of exactly /healthz: 200, an empty body, private no-store', async () => {
    const base = await documentServer({ siteAccess: 'private', allowlist: '203.0.113.0/24' });
    for (const method of ['GET', 'HEAD']) {
      const response = await send(base, '/healthz', { method });
      expect(response.status).toBe(200);
      expect(response.body).toBe('');
      expect(response.headers['content-length']).toBe('0');
      expectPrivateHeaders(response);
    }
    expect(apiRequests).toEqual([]);
  });

  it.each([
    ['no forwarding header from a listed socket peer', undefined],
    ['an unlisted client behind the proxy', `${LISTED}, ${UNLISTED}`],
    ['a malformed proxy entry', `${LISTED}, proxy`],
  ])('TRUST_PROXY=1: %s -> 403', async (_label, forwardedFor) => {
    const base = await documentServer({ siteAccess: 'private', allowlist: `127.0.0.1/32,${LISTED}/32`, trustedHops: 1 });
    const response = await send(base, '/careers', { headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor } });
    expect(response.status).toBe(403);
  });

  it('delegation headers from a visitor give it nothing', async () => {
    const base = await documentServer({ siteAccess: 'private', allowlist: '203.0.113.0/24' });
    const response = await send(base, '/careers', { headers: { 'x-valida-visitor-address': LISTED, 'x-valida-internal-key': KEY } });
    expect(response.status).toBe(403);
  });
});

describe('private site, listed visitor: the ordinary site, every response private', () => {
  it.each([
    ['/', 200],
    ['/careers', 200],
    ['/careers/qa-any-role', 404],
    ['/robots.txt', 200],
    ['/sitemap.xml', 200],
    ['/assets/index-abc123.js', 200],
    ['/assets/missing.js', 404],
    ['/About/', 301],
    ['/healthz', 200],
  ])('%s -> %i with private, no-store', async (target, status) => {
    const base = await documentServer({ siteAccess: 'private', allowlist: '127.0.0.1/32' });
    const response = await send(base, target, { headers: { 'if-none-match': '*', 'if-modified-since': new Date().toUTCString() } });
    expect(response.status).toBe(status);
    expectPrivateHeaders(response);
  });

  it('a non-GET method from a listed visitor is still 405 (admission grants nothing more)', async () => {
    const base = await documentServer({ siteAccess: 'private', allowlist: '127.0.0.1/32' });
    const response = await send(base, '/careers', { method: 'POST', body: 'x' });
    expect(response.status).toBe(405);
    expectPrivateHeaders(response);
  });

  it('TRUST_PROXY=1 and a listed client behind the proxy: admitted; the visitor is delegated as before', async () => {
    const base = await documentServer({ siteAccess: 'private', allowlist: `${LISTED}/32`, trustedHops: 1 });
    const response = await send(base, '/careers/qa-any-role', { headers: { 'x-forwarded-for': LISTED } });
    expect(response.status).toBe(404);
    expect(apiRequests).toHaveLength(1);
  });

  it('a Review build stays noindex under private access', async () => {
    const base = await documentServer({ siteAccess: 'private', allowlist: '127.0.0.1/32', indexing: false });
    const response = await send(base, '/careers');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect((await send(base, '/sitemap.xml')).status).toBe(404);
  });
});

describe('public site: the accepted T2 behaviour, plus /healthz', () => {
  it('no 403; recruitment documents private no-store; other documents no-cache; assets immutable', async () => {
    const base = await documentServer({ siteAccess: 'public' });
    expect((await send(base, '/careers')).headers['cache-control']).toBe(PRIVATE);
    expect((await send(base, '/about')).headers['cache-control']).toBe('no-cache');
    expect((await send(base, '/assets/index-abc123.js')).headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const live = await send(base, '/healthz');
    expect([live.status, live.body, live.headers['cache-control']]).toEqual([200, '', 'no-store']);
    expect((await send(base, '/healthz', { method: 'POST' })).status).toBe(405);
    // Only the exact target is the liveness check: other spellings are ordinary (unknown) pages.
    for (const target of ['/healthz/', '/healthz?probe=1', '/healthz/x', '/HEALTHZ']) {
      const response = await send(base, target);
      // '/healthz/' and '/HEALTHZ' get the ordinary one-hop redirect to the canonical form; the others are 404.
      expect(response.status, target).toBe(['/healthz/', '/HEALTHZ'].includes(target) ? 301 : 404);
    }
  });
});
