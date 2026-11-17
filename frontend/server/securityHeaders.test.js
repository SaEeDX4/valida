// @vitest-environment node
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveSiteAccess } from '../../backend/src/config/siteAccess.js';
import { resolveReleaseIdentity } from '../../backend/src/config/releaseIdentity.js';
import { resolveSeoConfig } from '../src/seo/siteConfig.js';
import { startDocumentServer } from './documentServer.js';
import { createJobsClient } from './jobsClient.js';
import { PERMISSIONS_POLICY, RELEASE_HEADER, buildContentSecurityPolicy, documentSecurityHeaders } from './securityHeaders.js';

/**
 * C6-T5 — the document server's enforced Content-Security-Policy, its other
 * security headers and the release header, on every kind of response, over
 * real HTTP (a temporary build directory and a stand-in Jobs API on
 * 127.0.0.1). The browser's enforcement of the same policy is proven in
 * Chromium by e2e/c6/c6-t5-stack.mjs. SYNTHETIC DATA ONLY.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = 'https://cybervalida.com';
const SHA = '0123456789abcdef0123456789abcdef01234567';
const FORGED = 'ffffffffffffffffffffffffffffffffffffffff';
const RELEASE = resolveReleaseIdentity({ RENDER_GIT_COMMIT: SHA });
const releaseHeader = RELEASE_HEADER.toLowerCase();

let api;
let apiOrigin;
let tmp;
let dist;
const servers = [];

const job = {
  title: 'QA Synthetic Role',
  slug: 'qa-open',
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
  applicationForm: { phone: { enabled: false, required: false }, message: { enabled: false, required: false, maxLength: 5000 }, resume: { required: true, maxBytes: 5242880, allowedExtensions: ['.pdf', '.docx'] }, screeningQuestions: [] },
};

async function documentServer({ seo = { siteUrl: SITE }, ...extra } = {}) {
  const server = await startDocumentServer({
    distDir: dist,
    config: resolveSeoConfig(seo),
    jobs: createJobsClient({ apiOrigin, timeoutMs: 2_000 }),
    jobApiPreloadBase: 'https://api.cybervalida.com',
    browserApiBase: 'https://api.cybervalida.com',
    release: RELEASE,
    port: 0,
    ...extra,
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

function raw(base, rawPath, { method = 'GET', headers = {} } = {}) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port, path: rawPath, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

const EXPECTED_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self' https://api.cybervalida.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

function expectSecurityHeaders(headers, { release = SHA } = {}) {
  expect(headers['content-security-policy']).toBe(EXPECTED_CSP);
  expect(headers['content-security-policy-report-only']).toBeUndefined();
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['permissions-policy']).toBe(PERMISSIONS_POLICY);
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['strict-transport-security']).toBeUndefined();
  if (release === null) expect(headers[releaseHeader]).toBeUndefined();
  else expect(headers[releaseHeader]).toBe(release);
}

let indexedBase;
let reviewBase;
let privateBase;
let brokenBase;

beforeAll(async () => {
  api = createServer((req, res) => {
    const url = new URL(req.url, 'http://api.invalid');
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/api/v1/jobs') {
      return send(200, { success: true, data: { items: [{ ...job, applicationForm: undefined }], pagination: { page: 1, limit: 50, total: 1, totalPages: 1 } }, meta: { requestId: 'qa' } });
    }
    if (url.pathname === '/api/v1/jobs/qa-open') return send(200, { success: true, data: job, meta: { requestId: 'qa' } });
    return send(404, { success: false, error: { code: 'JOB_NOT_FOUND', message: 'x' }, meta: { requestId: 'qa' } });
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  apiOrigin = `http://127.0.0.1:${api.address().port}`;

  tmp = mkdtempSync(path.join(os.tmpdir(), 'valida-c6t5-headers-'));
  dist = path.join(tmp, 'dist');
  mkdirSync(path.join(dist, 'assets'), { recursive: true });
  mkdirSync(path.join(dist, 'brand'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>Valida</title>\n<!--valida:head-->\n</head><body><div id="root"></div></body></html>');
  writeFileSync(path.join(dist, 'assets', 'index-qa.js'), 'console.log("qa")');
  writeFileSync(path.join(dist, 'brand', 'qa.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(path.join(dist, 'valida-seo.json'), JSON.stringify({ indexing: false, siteOrigin: null, apiBaseUrl: 'https://api.cybervalida.com' }));

  indexedBase = await documentServer({ seo: { siteUrl: SITE, allowIndexing: 'true' } });
  reviewBase = await documentServer();
  privateBase = await documentServer({ site: resolveSiteAccess({ siteAccess: 'private', allowlist: '203.0.113.0/24', appEnv: 'local' }) });
  // A Jobs client whose sitemap read throws: the server's own 500.
  brokenBase = await documentServer({
    seo: { siteUrl: SITE, allowIndexing: 'true' },
    jobs: {
      listOpenJobSlugs: async () => {
        throw new Error('qa failure');
      },
    },
  });
});

afterAll(async () => {
  for (const server of servers) await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => api.close(resolve));
  rmSync(tmp, { recursive: true, force: true });
});

describe('the policy', () => {
  it('names the build API origin in connect-src and nothing broader', () => {
    expect(buildContentSecurityPolicy('https://api.cybervalida.com')).toBe(EXPECTED_CSP);
    expect(buildContentSecurityPolicy('')).toContain("connect-src 'self';");
    const policy = buildContentSecurityPolicy('http://127.0.0.1:4000');
    expect(policy).toContain("connect-src 'self' http://127.0.0.1:4000;");
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|\*|https:(?!\/)|data:|upgrade-insecure-requests/);
  });

  it.each(['https://api.cybervalida.com/api', 'api.cybervalida.com', 'javascript:alert(1)', 'https://user:pw@api.cybervalida.com', undefined, null])(
    'refuses a build API base it cannot name: %j',
    (base) => {
      expect(() => buildContentSecurityPolicy(base)).toThrow(/plain origin/);
    },
  );

  it('the header set is frozen and contains no HSTS', () => {
    const headers = documentSecurityHeaders({ browserApiBase: '' });
    expect(Object.isFrozen(headers)).toBe(true);
    expect(Object.keys(headers)).toEqual(['content-security-policy', 'x-content-type-options', 'referrer-policy', 'permissions-policy', 'x-frame-options']);
  });
});

describe('every kind of response carries the headers (QA-040)', () => {
  it.each([
    ['a document (200)', () => indexedBase, '/', 200],
    ['a Job document (200)', () => indexedBase, '/careers/qa-open', 200],
    ['an Apply document (200)', () => indexedBase, '/careers/qa-open/apply', 200],
    ['an unknown Job (404 document)', () => indexedBase, '/careers/qa-unknown', 404],
    ['an unknown path (404 document)', () => indexedBase, '/qa-unknown-path', 404],
    ['a redirect to the canonical form (301)', () => indexedBase, '/About', 301],
    ['robots.txt', () => indexedBase, '/robots.txt', 200],
    ['the sitemap', () => indexedBase, '/sitemap.xml', 200],
    ['the sitemap of a review build (404)', () => reviewBase, '/sitemap.xml', 404],
    ['a built asset', () => indexedBase, '/assets/index-qa.js', 200],
    ['an unknown asset (404)', () => indexedBase, '/assets/qa-missing.js', 404],
    ['a brand file', () => indexedBase, '/brand/qa.png', 200],
    ['liveness', () => indexedBase, '/healthz', 200],
    ['a target that is not a path (400)', () => indexedBase, '*', 400],
    ['a private-site refusal (403)', () => privateBase, '/', 403],
    ['a private-site refusal of an asset (403)', () => privateBase, '/assets/index-qa.js', 403],
    ['private liveness (200)', () => privateBase, '/healthz', 200],
    ['the server\'s own error (500)', () => brokenBase, '/sitemap.xml', 500],
  ])('%s', async (_label, base, target, status) => {
    const response = await raw(base(), target);
    expect(response.status).toBe(status);
    expectSecurityHeaders(response.headers);
  });

  it('a method other than GET/HEAD (405), and HEAD', async () => {
    const post = await raw(indexedBase, '/', { method: 'POST' });
    expect(post.status).toBe(405);
    expectSecurityHeaders(post.headers);
    const head = await raw(indexedBase, '/', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expectSecurityHeaders(head.headers);
  });

  it('a redirect keeps its own headers alongside (Location, no-cache)', async () => {
    const response = await raw(indexedBase, '/About');
    expect(response.headers.location).toBe('/about');
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('the private refusal keeps its own private cache rule', async () => {
    const response = await raw(privateBase, '/');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.body).toBe('Forbidden');
  });
});

describe('the release header', () => {
  it('a request cannot set it: a forged X-Valida-Release is overwritten', async () => {
    const response = await raw(indexedBase, '/', { headers: { [RELEASE_HEADER]: FORGED } });
    expect(response.headers[releaseHeader]).toBe(SHA);
  });

  it('unset: no header on any response, even when the request sends one', async () => {
    const base = await documentServer({ release: resolveReleaseIdentity({}) });
    for (const target of ['/', '/robots.txt', '/assets/index-qa.js', '/qa-unknown', '/healthz']) {
      const response = await raw(base, target, { headers: { [RELEASE_HEADER]: FORGED } });
      expectSecurityHeaders(response.headers, { release: null });
    }
  });

  it('a handler given no release at all sends none', async () => {
    const base = await documentServer({ release: null });
    const response = await raw(base, '/');
    expect(response.headers[releaseHeader]).toBeUndefined();
  });
});

describe('start-up through serve.mjs (real process)', () => {
  /** Runs serve.mjs on the temporary build; resolves with the READY line or the exit. */
  function serve(env, manifest) {
    if (manifest) writeFileSync(path.join(dist, 'valida-seo.json'), JSON.stringify(manifest));
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(here, 'serve.mjs'), '--dist', dist, '--port', '0', '--api-origin', apiOrigin, '--quiet'], {
        env: { PATH: process.env.PATH, APP_ENV: 'local', ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk) => {
        out += chunk;
        const line = out.split('\n').find((text) => text.startsWith('READY '));
        if (line) {
          const ready = JSON.parse(line.slice(6));
          child.kill('SIGTERM');
          resolve({ ready, err });
        }
      });
      child.stderr.on('data', (chunk) => {
        err += chunk;
      });
      child.on('exit', (code) => resolve({ code, out, err }));
    });
  }
  const manifest = { indexing: false, siteOrigin: null, apiBaseUrl: 'https://api.cybervalida.com' };

  it('a valid RENDER_GIT_COMMIT: starts; READY states the release and the enforced policy', async () => {
    const result = await serve({ RENDER_GIT_COMMIT: SHA }, manifest);
    expect(result.ready).toMatchObject({ release: SHA, releaseState: 'configured', contentSecurityPolicy: EXPECTED_CSP });
  });

  it('absent: ordinary local start-up; READY says unset', async () => {
    const result = await serve({}, manifest);
    expect(result.ready).toMatchObject({ release: null, releaseState: 'unset' });
  });

  it.each([['uppercase', SHA.toUpperCase()], ['abbreviated', SHA.slice(0, 7)], ['a tag', 'v1.0.0-qa']])(
    'malformed (%s): refused before listening, naming the variable and not the value',
    async (_label, value) => {
      const result = await serve({ RENDER_GIT_COMMIT: value }, manifest);
      expect(result.code).toBe(1);
      expect(result.out).not.toContain('READY');
      expect(result.err).toContain('RENDER_GIT_COMMIT');
      expect(result.err).not.toContain(value);
    },
  );

  it('a build whose API base the policy cannot name: refused before listening', async () => {
    const result = await serve({}, { ...manifest, apiBaseUrl: 'https://api.cybervalida.com/v1' });
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/Content-Security-Policy cannot name it/);
    writeFileSync(path.join(dist, 'valida-seo.json'), JSON.stringify(manifest));
  });
});
