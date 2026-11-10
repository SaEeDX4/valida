// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveSeoConfig } from '../src/seo/siteConfig.js';
import { startDocumentServer } from './documentServer.js';
import { createJobsClient, normalizeApiOrigin } from './jobsClient.js';
import { canonicalRedirect, checkTemplate, matchRoute } from './renderDocument.js';

/**
 * C4 — the document server over real HTTP: a temporary build directory, a
 * stand-in Jobs API on 127.0.0.1 that answers with the real envelope and DTO
 * shapes (Doc 09), and the server itself. SYNTHETIC DATA ONLY.
 *
 * The real backend + MongoDB run of the same server is the C4 stack
 * verification (e2e/seo/), not this file.
 */

const SITE = 'https://cybervalida.com';

const form = {
  phone: { enabled: false, required: false },
  message: { enabled: false, required: false, maxLength: 5000 },
  resume: { required: true, maxBytes: 5242880, allowedExtensions: ['.pdf', '.docx'] },
  screeningQuestions: [],
};
const job = (slug, overrides = {}) => ({
  title: `QA Synthetic Role ${slug}`,
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
  ...overrides,
});
const JOBS = {
  'qa-open': job('qa-open'),
  'qa-closed': job('qa-closed', { applicationStatus: 'CLOSED', applicationForm: null }),
  'qa-malformed': job('qa-malformed', { applicationForm: null }), // OPEN without a form: the client calls it malformed
  // OD-2026-11-09-02: an explicit list makes an otherwise qualifying remote Job carry a JobPosting.
  'qa-eligible': job('qa-eligible', { eligibleWorkCountries: ['NZ', 'DE'] }),
  'qa-eligible-closed': job('qa-eligible-closed', { eligibleWorkCountries: ['NZ'], applicationStatus: 'CLOSED', applicationForm: null }),
  'qa-bad-eligibility': job('qa-bad-eligibility', { eligibleWorkCountries: ['nz'] }), // malformed contract
};
const OPEN_LIST = Array.from({ length: 53 }, (_, index) => `qa-list-${String(index).padStart(2, '0')}`);

let api;
let apiOrigin;
let apiMode = 'ok';
const apiRequests = [];

function envelope(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

let tmp;
let dist;
const servers = [];

async function documentServer(seo) {
  const server = await startDocumentServer({
    distDir: dist,
    config: resolveSeoConfig(seo),
    jobs: createJobsClient({ apiOrigin, timeoutMs: 2_000 }),
    port: 0,
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

let indexed;
let review;

beforeAll(async () => {
  api = createServer((req, res) => {
    apiRequests.push(req.url);
    const url = new URL(req.url, 'http://api.invalid');
    if (apiMode === 'down') return envelope(res, 503, { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'x' } });
    if (url.pathname === '/api/v1/jobs') {
      const page = Number(url.searchParams.get('page'));
      const limit = Number(url.searchParams.get('limit'));
      const slice = OPEN_LIST.slice((page - 1) * limit, page * limit);
      return envelope(res, 200, {
        success: true,
        data: { items: slice.map((slug) => ({ ...job(slug), applicationForm: undefined })), pagination: { page, limit, total: OPEN_LIST.length, totalPages: Math.ceil(OPEN_LIST.length / limit) } },
        meta: { requestId: 'qa' },
      });
    }
    const match = /^\/api\/v1\/jobs\/([^/]+)$/.exec(url.pathname);
    if (match && JOBS[decodeURIComponent(match[1])]) return envelope(res, 200, { success: true, data: JOBS[decodeURIComponent(match[1])], meta: { requestId: 'qa' } });
    return envelope(res, 404, { success: false, error: { code: 'JOB_NOT_FOUND', message: 'x' }, meta: { requestId: 'qa' } });
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  apiOrigin = `http://127.0.0.1:${api.address().port}`;

  tmp = mkdtempSync(path.join(os.tmpdir(), 'valida-c4-docserver-'));
  dist = path.join(tmp, 'dist');
  mkdirSync(path.join(dist, 'assets'), { recursive: true });
  mkdirSync(path.join(dist, 'brand'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>Valida</title>\n<!--valida:head-->\n</head><body><div id="root"></div></body></html>');
  writeFileSync(path.join(dist, 'assets', 'index-abc123.js'), 'console.log("qa")');
  writeFileSync(path.join(dist, 'brand', 'valida-logo-approved-dark-1254.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(path.join(dist, 'valida-seo.json'), '{}');
  writeFileSync(path.join(dist, '.hidden'), 'secret-ish');
  writeFileSync(path.join(tmp, 'outside.txt'), 'outside the build');
  symlinkSync(path.join(tmp, 'outside.txt'), path.join(dist, 'assets', 'link.txt'));

  indexed = await documentServer({ siteUrl: SITE, allowIndexing: 'true' });
  review = await documentServer({ siteUrl: SITE });
});

afterAll(async () => {
  for (const server of servers) await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => api.close(resolve));
  rmSync(tmp, { recursive: true, force: true });
});

const get = (base, pathname, init) => fetch(`${base}${pathname}`, { redirect: 'manual', ...init });

/** A request whose path is sent exactly as written (fetch would resolve "." and ".." segments first). */
function rawGet(base, rawPath) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port, path: rawPath, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}
const headOf = (html) => html.slice(0, html.indexOf('</head>'));
const jsonLdOf = (html) => [...html.matchAll(/<script type="application\/ld\+json" data-valida-structured-data="JobPosting">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

describe('documents: status and head in the initial HTML (Doc 16 sections 114-123)', () => {
  it.each([
    ['/', 200, 'Valida | Cybersecurity &amp; Secure Technology', `${SITE}/`],
    ['/about', 200, 'About Valida | Security-First Technology', `${SITE}/about`],
    ['/careers', 200, 'Careers at Valida | Open Technology &amp; Cybersecurity Roles', `${SITE}/careers`],
    ['/privacy', 200, 'Privacy Notice | Valida', `${SITE}/privacy`],
    ['/legal', 200, 'Legal Information | Valida', `${SITE}/legal`],
  ])('%s -> %i, its own title and canonical, no robots', async (pathname, status, title, href) => {
    const response = await get(indexed, pathname);
    const html = await response.text();
    expect(response.status).toBe(status);
    expect(headOf(html)).toContain(`<title>${title}</title>`);
    expect(headOf(html)).toContain(`<link rel="canonical" href="${href}">`);
    expect(headOf(html)).toContain(`<meta property="og:url" content="${href}">`);
    // OD-2026-11-09-02, revised by OD-2026-11-09-03: the social card, absolute on the approved origin, with its dimensions and alt text.
    expect(headOf(html)).toContain(`<meta property="og:image" content="${SITE}/social/valida-social-card-v2-1200x630.png">`);
    expect(headOf(html)).toContain('<meta property="og:image:width" content="1200">');
    expect(headOf(html)).toContain('<meta property="og:image:height" content="630">');
    expect(headOf(html)).toContain(
      '<meta property="og:image:alt" content="Valida logo with the headline &quot;Secure systems. Deliberate engineering.&quot; and the line &quot;Valida is a technology company focused on cybersecurity, secure technology, and security engineering.&quot;">',
    );
    expect(headOf(html)).not.toMatch(/name="robots"|valida:head|application\/ld\+json/);
    expect(response.headers.get('x-robots-tag')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    // OD-2026-11-09-03: the sharing description is the route's own search description, except on Home.
    const metaContent = (selector) => [...headOf(html).matchAll(new RegExp(`<meta ${selector} content="([^"]*)">`, 'g'))].map((match) => match[1]);
    const description = metaContent('name="description"');
    const ogDescription = metaContent('property="og:description"');
    expect([description.length, ogDescription.length]).toEqual([1, 1]);
    if (pathname === '/') {
      expect(description[0]).toBe('Valida is a Lithuanian technology company focused on cybersecurity, secure technology, security engineering, and modern digital systems.');
      expect(ogDescription[0]).toBe('Valida is a technology company focused on cybersecurity, secure technology, security engineering, and modern digital systems.');
    } else {
      expect(ogDescription).toEqual(description);
    }
  });

  it('an open Job: 200, its title and canonical, indexable — and NO JobPosting (no explicit eligible remote-work countries)', async () => {
    const response = await get(indexed, '/careers/qa-open');
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(headOf(html)).toContain('<title>QA Synthetic Role qa-open | Careers at Valida</title>');
    expect(headOf(html)).toContain(`<link rel="canonical" href="${SITE}/careers/qa-open">`);
    expect(headOf(html)).not.toContain('name="robots"');
    expect(jsonLdOf(html)).toEqual([]);
  });

  it('OD-2026-11-09-02: an open fully remote Job with an explicit list: TELECOMMUTE JobPosting in the initial HTML, the same countries', async () => {
    const response = await get(indexed, '/careers/qa-eligible');
    const html = await response.text();
    expect(response.status).toBe(200);
    const [posting] = jsonLdOf(html);
    expect(posting).toMatchObject({
      '@type': 'JobPosting',
      jobLocationType: 'TELECOMMUTE',
      applicantLocationRequirements: [{ '@type': 'Country', name: 'New Zealand' }, { '@type': 'Country', name: 'Germany' }],
      url: `${SITE}/careers/qa-eligible`,
    });
    expect(jsonLdOf(html)).toHaveLength(1);
  });

  it('OD-2026-11-09-02: a closed Job with a list has no JobPosting; a malformed list is a 503, never a partial claim', async () => {
    const closed = await get(indexed, '/careers/qa-eligible-closed');
    expect(closed.status).toBe(200);
    expect(jsonLdOf(await closed.text())).toEqual([]);
    const malformed = await get(indexed, '/careers/qa-bad-eligibility');
    expect(malformed.status).toBe(503);
    expect(jsonLdOf(await malformed.text())).toEqual([]);
  });

  it('a retained closed Job: 200, "noindex, follow" (meta and header), no JobPosting, no canonical', async () => {
    const response = await get(indexed, '/careers/qa-closed');
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(headOf(html)).toContain('<meta name="robots" content="noindex, follow">');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, follow');
    expect(jsonLdOf(html)).toEqual([]);
    expect(headOf(html)).not.toContain('rel="canonical"');
  });

  it.each([
    ['an unknown slug', '/careers/qa-no-such-role'],
    ['an invalid slug (never sent to the API)', '/careers/qa_not%20a%20slug'],
    ['an unknown public route', '/qa-no-such-page'],
    ['a reserved private namespace', '/admin'],
    ['too many segments', '/careers/qa-open/apply/extra'],
  ])('%s: 404, the branded page, "noindex, follow" — never a soft 404', async (_label, pathname) => {
    const before = apiRequests.length;
    const response = await get(indexed, pathname);
    const html = await response.text();
    expect(response.status).toBe(404);
    expect(headOf(html)).toContain('<title>Page Not Found | Valida</title>');
    expect(headOf(html)).toContain('<meta name="robots" content="noindex, follow">');
    expect(html).toContain('<div id="root"></div>');
    if (pathname.includes('%20')) expect(apiRequests.length).toBe(before);
  });

  it('Apply: open and closed 200, unknown 404 — always "noindex, follow", never JobPosting', async () => {
    const open = await get(indexed, '/careers/qa-open/apply');
    const closed = await get(indexed, '/careers/qa-closed/apply');
    const unknown = await get(indexed, '/careers/qa-no-such-role/apply');
    expect([open.status, closed.status, unknown.status]).toEqual([200, 200, 404]);
    const [openHtml, closedHtml, unknownHtml] = await Promise.all([open.text(), closed.text(), unknown.text()]);
    expect(headOf(openHtml)).toContain('<title>Apply for QA Synthetic Role qa-open | Valida</title>');
    expect(headOf(unknownHtml)).toContain('<title>Apply | Valida</title>');
    for (const html of [openHtml, closedHtml, unknownHtml]) {
      expect(headOf(html)).toContain('<meta name="robots" content="noindex, follow">');
      expect(jsonLdOf(html)).toEqual([]);
      expect(headOf(html)).not.toContain('rel="canonical"');
    }
  });

  it('malformed Job data or an API failure: 503 with Retry-After — not a 404 (Doc 16 section 259)', async () => {
    const malformed = await get(indexed, '/careers/qa-malformed');
    expect(malformed.status).toBe(503);
    expect(malformed.headers.get('retry-after')).toBe('60');
    expect(headOf(await malformed.text())).toContain('<title>Careers at Valida</title>');
    apiMode = 'down';
    try {
      const down = await get(indexed, '/careers/qa-open');
      const downApply = await get(indexed, '/careers/qa-open/apply');
      expect([down.status, downApply.status]).toEqual([503, 503]);
      expect(jsonLdOf(await down.text())).toEqual([]);
    } finally {
      apiMode = 'ok';
    }
  });

  it('a review build: same statuses, every document "noindex, nofollow", no canonical or JobPosting', async () => {
    for (const [pathname, status] of [['/', 200], ['/careers/qa-open', 200], ['/careers/qa-closed', 200], ['/qa-no-such-page', 404]]) {
      const response = await get(review, pathname);
      const html = await response.text();
      expect(response.status, pathname).toBe(status);
      expect(headOf(html)).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(headOf(html)).not.toMatch(/rel="canonical"|og:|application\/ld\+json/);
    }
  });
});

describe('URL conventions (Doc 04 sections 47-49)', () => {
  it.each([
    ['/about/', '/about'],
    ['/About', '/about'],
    ['/careers//qa-open', '/careers/qa-open'],
    ['/Careers/QA-Open/?region=CA', '/careers/qa-open?region=CA'],
    ['//qa.example.test/x', '/qa.example.test/x'],
  ])('%s -> 301 %s (same origin, query kept)', async (pathname, location) => {
    const response = await get(indexed, pathname);
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe(location);
  });

  /*
   * C4 review finding (Astra): the raw target "/\outside.example/A" got a 301
   * whose Location ("/\outside.example/a") a browser resolves to
   * https://outside.example/a — "\" counts as "/" in WHATWG URL parsing. The
   * requests below are sent byte for byte (rawGet): fetch() would rewrite
   * the backslash before sending.
   */
  it.each([
    ['the reported target', '/\\outside.example/A'],
    ['with a trailing slash', '/\\outside.example/a/'],
    ['two backslashes', '/\\\\outside.example/A'],
    ['backslash then slash', '/\\/outside.example/A'],
    ['slash then backslash after a segment', '/About/\\outside.example'],
    ['a dot segment', '/About/../x'],
  ])('raw %s (%s): never a redirect off this origin — no Location, the 404 page', async (_label, rawPath) => {
    const response = await rawGet(indexed, rawPath);
    expect(response.status).toBe(404);
    expect(response.headers.location).toBeUndefined();
    expect(response.body).toContain('<title>Page Not Found | Valida</title>');
  });

  it('positive control: an ordinary canonical redirect still works, keeps its query and stays on this origin', async () => {
    for (const [rawPath, location] of [
      ['/About?region=CA&utm_source=qa', '/about?region=CA&utm_source=qa'],
      ['/careers/QA-Open/?region=CA', '/careers/qa-open?region=CA'],
      ['/%5Coutside.example/A', '/%5coutside.example/a'],
    ]) {
      const response = await rawGet(indexed, rawPath);
      expect([response.status, response.headers.location], rawPath).toEqual([301, location]);
      expect(new URL(response.headers.location, indexed).origin, rawPath).toBe(new URL(indexed).origin);
      expect(new URL(response.headers.location, SITE).origin, rawPath).toBe(SITE);
    }
  });

  it('every Location the helper can return resolves to the same origin', () => {
    const base = 'https://cybervalida.com';
    for (const target of ['/A', '/a/', '//a', '///a/B', '/\\a', '/\\\\a', '/a\\b', '/%2F%2Fa/B', '/a/./B', '/a/../B', '/\ta', '/a b', '/é/A', '/a:b/C', '/@a/B']) {
      const location = canonicalRedirect(target, '?q=1');
      if (location === null) continue;
      expect(location.startsWith('/') && !location.startsWith('//'), target).toBe(true);
      expect(new URL(location, base).origin, target).toBe(base);
    }
    expect(canonicalRedirect('/\\outside.example/A')).toBeNull();
    expect(canonicalRedirect('/About', '?x=1')).toBe('/about?x=1');
  });

  it('pure helpers', () => {
    expect(canonicalRedirect('/')).toBeNull();
    expect(canonicalRedirect('/careers/qa-open')).toBeNull();
    expect(matchRoute('/careers')).toEqual({ kind: 'static', path: '/careers' });
    expect(matchRoute('/careers/x/apply')).toEqual({ kind: 'apply', slug: 'x' });
    expect(checkTemplate('<title>a</title><!--valida:head-->')).toEqual([]);
    expect(checkTemplate('<title>a</title>')).toHaveLength(1);
    expect(normalizeApiOrigin('http://127.0.0.1:4000/api/v1')).toBe('http://127.0.0.1:4000');
    expect(normalizeApiOrigin('http://127.0.0.1:4000/other')).toBeNull();
    expect(normalizeApiOrigin('file:///etc')).toBeNull();
  });
});

describe('sitemap.xml and robots.txt (Doc 16 sections 103-113)', () => {
  it('the sitemap walks every page of open Jobs (53 over 2 pages) after the five static routes', async () => {
    const response = await get(indexed, '/sitemap.xml');
    const xml = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/xml; charset=utf-8');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.slice(0, 5)).toEqual([`${SITE}/`, `${SITE}/about`, `${SITE}/careers`, `${SITE}/privacy`, `${SITE}/legal`]);
    expect(locs.slice(5)).toEqual(OPEN_LIST.map((slug) => `${SITE}/careers/${slug}`));
    expect(xml).not.toMatch(/qa-closed|lastmod|apply/);
  });

  it('the sitemap is 503 when the Jobs API fails — never a sitemap silently missing roles', async () => {
    apiMode = 'down';
    try {
      const response = await get(indexed, '/sitemap.xml');
      expect(response.status).toBe(503);
    } finally {
      apiMode = 'ok';
    }
  });

  it('a review build has no sitemap and a robots.txt without one', async () => {
    expect((await get(review, '/sitemap.xml')).status).toBe(404);
    const robots = await get(review, '/robots.txt');
    expect(robots.status).toBe(200);
    expect(await robots.text()).not.toMatch(/Sitemap:|Disallow:/);
  });

  it('production robots.txt names the canonical sitemap', async () => {
    const robots = await get(indexed, '/robots.txt');
    expect(robots.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await robots.text()).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });
});

describe('static files and request safety', () => {
  it('serves build assets with the right type; fingerprinted assets are immutable', async () => {
    const js = await get(indexed, '/assets/index-abc123.js');
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const logo = await get(indexed, '/brand/valida-logo-approved-dark-1254.png');
    expect([logo.status, logo.headers.get('content-type'), logo.headers.get('cache-control')]).toEqual([200, 'image/png', 'no-cache']);
  });

  it.each([
    ['a missing asset', '/assets/missing.js'],
    ['a symlink out of the build', '/assets/link.txt'],
    ['an encoded traversal', '/assets/..%2f..%2foutside.txt'],
    ['a raw dot-dot segment', '/assets/../../outside.txt'],
    ['an encoded dot-dot segment', '/assets/%2e%2e/%2e%2e/outside.txt'],
    ['an encoded backslash', '/assets/..%5c..%5coutside.txt'],
    ['a NUL byte', '/assets/index-abc123.js%00.png'],
  ])('%s: never anything outside the build', async (_label, rawPath) => {
    const response = await rawGet(indexed, rawPath);
    expect(response.status).toBe(404);
    expect(response.body).not.toContain('outside the build');
    expect(response.body).not.toContain('console.log');
  });

  it.each(['/valida-seo.json', '/index.html', '/.hidden', '/%2ehidden', '/brand/%2e%2e/valida-seo.json'])('%s is never served as a file', async (rawPath) => {
    const response = await rawGet(indexed, rawPath);
    expect(response.status).toBe(404);
    expect(response.body).not.toContain('secret-ish');
    expect(response.body).not.toBe('{}');
  });

  it('only GET and HEAD; HEAD sends headers without a body', async () => {
    const post = await get(indexed, '/careers', { method: 'POST' });
    expect([post.status, post.headers.get('allow')]).toEqual([405, 'GET, HEAD']);
    const head = await get(indexed, '/careers/qa-open', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });
});
