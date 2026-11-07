import { mkdirSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { BACKEND_DIR, FRONTEND_DIR } from '../support/paths.js';
import { baseEnvironment, runNode, startNode, stopChild, waitForReadyLine } from '../support/processes.js';
import {
  SEO_BACKEND_ORIGIN, SEO_INDEXED_ORIGIN, SEO_REVIEW_ORIGIN, SEO_SITE_URL, readSeoRun, seoBackendEnvironment,
} from '../support/seoStack.js';

/**
 * C4 — SEO against the real stack: the C4 document server serving a
 * production build, the real Express backend, a disposable MongoDB database
 * and synthetic Jobs provisioned through the backend's own CLI.
 *
 * Observation labels in the records:
 *   REAL       an actual HTTP response or browser state of this stack;
 *   SIMULATED  the API made unreachable on purpose (C4-11);
 *   LOCAL ONLY everything is on 127.0.0.1 with a TEST canonical origin. What
 *              only the production host can show (TLS, the apex/www redirect,
 *              CDN behaviour, real crawlers, Search Console, the Rich Results
 *              Test) is C6 and is not claimed here.
 */

const SITE = SEO_SITE_URL;
const run = () => readSeoRun();
const job = (name) => run().jobs[name];

// ------------------------------------------------------------- evidence --
function outputDir(sub) {
  const dir = path.join(run().dirs.output, sub);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function record(caseId, data) {
  writeFileSync(path.join(outputDir('cases'), `${caseId}.json`), JSON.stringify({ caseId, recordedAt: new Date().toISOString(), ...data }, null, 2));
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(outputDir('screenshots'), `${name}.png`), fullPage: true });
  return `screenshots/${name}.png`;
}

// -------------------------------------------------------- head readers --
const decode = (value) =>
  value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The SEO facts of an HTML document's <head>, as a crawler that runs no script reads them. */
function headFacts(html) {
  const head = html.slice(0, html.indexOf('</head>'));
  const metaName = (name) => [...head.matchAll(new RegExp(`<meta name="${name}" content="([^"]*)">`, 'g'))].map((m) => decode(m[1]));
  return {
    title: decode(/<title>([^<]*)<\/title>/.exec(head)?.[1] ?? ''),
    description: metaName('description'),
    robots: metaName('robots'),
    canonical: [...head.matchAll(/<link rel="canonical" href="([^"]*)">/g)].map((m) => decode(m[1])),
    openGraph: [...head.matchAll(/<meta property="(og:[^"]+)" content="([^"]*)">/g)].map((m) => [m[1], decode(m[2])]),
    jsonLd: [...head.matchAll(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1])),
    marker: head.includes('<!--valida:head-->'),
  };
}

/** The same facts from the live DOM, after the page settled. */
const browserHead = (page) =>
  page.evaluate(() => {
    const all = (selector) => [...document.head.querySelectorAll(selector)];
    return {
      title: document.title,
      description: all('meta[name="description"]').map((tag) => tag.getAttribute('content')),
      robots: all('meta[name="robots"]').map((tag) => tag.getAttribute('content')),
      canonical: all('link[rel="canonical"]').map((tag) => tag.getAttribute('href')),
      openGraph: all('meta[property^="og:"]').map((tag) => [tag.getAttribute('property'), tag.getAttribute('content')]),
      jsonLd: all('script[type="application/ld+json"]').map((tag) => JSON.parse(tag.textContent)),
    };
  });

/** The Job page's visible "Employment Details", label -> text. */
const visibleFacts = (page) =>
  page.evaluate(() => {
    const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent === 'Employment Details');
    const list = heading?.parentElement.querySelector('dl');
    return Object.fromEntries([...(list?.querySelectorAll('div') ?? [])].map((row) => [row.querySelector('dt').textContent, row.querySelector('dd').textContent]));
  });

async function fetchDocument(origin, pathname, init = {}) {
  const response = await fetch(`${origin}${pathname}`, { redirect: 'manual', ...init });
  const body = await response.text();
  const headers = Object.fromEntries(['content-type', 'cache-control', 'x-robots-tag', 'retry-after', 'location'].map((name) => [name, response.headers.get(name)]));
  return { status: response.status, headers, body };
}

/** A request whose target is sent exactly as written. */
function rawRequest(origin, target) {
  const { hostname, port } = new URL(origin);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port, path: target, method: 'GET' }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location ?? null }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Independent of the code under test: the instant's UTC date as "1 November 2026", and the deadline to the minute. */
const utcDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
const utcDeadline = (iso) => `${utcDate(iso)}, ${new Date(iso).toISOString().slice(11, 16)} UTC`;

async function apiJob(slug) {
  const response = await fetch(`${SEO_BACKEND_ORIGIN}/api/v1/jobs/${slug}`);
  return { status: response.status, body: await response.json() };
}

async function provision(file) {
  const result = await runNode(['scripts/provision-job.mjs', 'apply', '--file', file, '--confirm-lifecycle'], {
    cwd: BACKEND_DIR,
    env: seoBackendEnvironment({ storageRoot: run().dirs.storage }),
    logFile: path.join(run().dirs.logs, 'cli.log'),
    label: `jobs:provision:apply ${path.basename(file)}`,
  });
  return { file: path.basename(file), exitCode: result.code };
}

const sitemapLocs = async (origin = SEO_INDEXED_ORIGIN) => {
  const response = await fetchDocument(origin, '/sitemap.xml');
  return { status: response.status, contentType: response.headers['content-type'], locs: [...response.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]), lastmod: /lastmod/.test(response.body) };
};

const STATIC = [
  ['/', 'Valida | Cybersecurity & Secure Technology'],
  ['/about', 'About Valida | Security-First Technology'],
  ['/careers', 'Careers at Valida | Open Technology & Cybersecurity Roles'],
  ['/privacy', 'Privacy Notice | Valida'],
  ['/legal', 'Legal Information | Valida'],
];

// ================================================================= cases ==

test('C4-01 initial HTML: status, title, robots, canonical, Open Graph and JobPosting of every public route; redirects stay on this origin', async () => {
  const routes = [
    ...STATIC.map(([pathname]) => ['static', pathname]),
    ['open remote Job', `/careers/${job('qa-c4-open-remote').slug}`],
    ['open hybrid Job', `/careers/${job('qa-c4-open-hybrid').slug}`],
    ['retained closed Job', `/careers/${job('qa-c4-retained-closed').slug}`],
    ['Draft Job', `/careers/${job('qa-c4-draft').slug}`],
    ['Archived Job', `/careers/${job('qa-c4-archived').slug}`],
    ['unknown Job slug', '/careers/qa-c4-no-such-role'],
    // Lowercase on purpose: an uppercase spelling is first redirected to the lowercase path (Doc 04).
    ['invalid Job slug', '/careers/qa_c4%20not-a-slug'],
    ['unknown route', '/qa-c4-no-such-page'],
    ['Apply, open Job', `/careers/${job('qa-c4-open-remote').slug}/apply`],
    ['Apply, closed Job', `/careers/${job('qa-c4-retained-closed').slug}/apply`],
    ['Apply, unknown Job', '/careers/qa-c4-no-such-role/apply'],
  ];
  const observed = [];
  for (const [label, pathname] of routes) {
    const response = await fetchDocument(SEO_INDEXED_ORIGIN, pathname);
    observed.push({ label, path: pathname, status: response.status, headers: response.headers, head: headFacts(response.body) });
  }
  const at = (label) => observed.find((entry) => entry.label === label);

  for (const [pathname, title] of STATIC) {
    const entry = observed.find((item) => item.path === pathname);
    expect(entry.status, pathname).toBe(200);
    expect(entry.head.title).toBe(title);
    expect(entry.head.description).toHaveLength(1);
    expect(entry.head.robots).toEqual([]);
    expect(entry.head.canonical).toEqual([`${SITE}${pathname}`]);
    expect(entry.head.openGraph.map(([property]) => property)).toEqual(['og:type', 'og:site_name', 'og:title', 'og:description', 'og:url']);
    expect(entry.head.jsonLd).toEqual([]);
    expect(entry.head.marker).toBe(false);
    expect(entry.headers['x-robots-tag']).toBeNull();
  }

  const remote = at('open remote Job');
  expect(remote.status).toBe(200);
  expect(remote.head.title).toBe(`${job('qa-c4-open-remote').title} | Careers at Valida`);
  expect(remote.head.robots).toEqual([]);
  expect(remote.head.canonical).toEqual([`${SITE}/careers/qa-c4-open-remote`]);
  // C4 correction: job.location is the workplace, not where applicants may be — JobPosting withheld (NO_APPLICANT_ELIGIBILITY).
  expect(remote.head.jsonLd).toEqual([]);

  // Hybrid: indexable, no JobPosting — the public DTO has no structured workplace address (NO_STRUCTURED_WORKPLACE).
  const hybrid = at('open hybrid Job');
  expect([hybrid.status, hybrid.head.robots, hybrid.head.jsonLd]).toEqual([200, [], []]);
  expect(hybrid.head.canonical).toEqual([`${SITE}/careers/qa-c4-open-hybrid`]);

  const closed = at('retained closed Job');
  expect([closed.status, closed.head.robots, closed.head.jsonLd, closed.head.canonical]).toEqual([200, ['noindex, follow'], [], []]);
  expect(closed.headers['x-robots-tag']).toBe('noindex, follow');

  for (const label of ['Draft Job', 'Archived Job', 'unknown Job slug', 'invalid Job slug', 'unknown route']) {
    const entry = at(label);
    expect(entry.status, label).toBe(404);
    expect(entry.head.title, label).toBe('Page Not Found | Valida');
    expect(entry.head.robots, label).toEqual(['noindex, follow']);
    expect([...entry.head.jsonLd, ...entry.head.canonical], label).toEqual([]);
  }

  expect(at('Apply, open Job').status).toBe(200);
  expect(at('Apply, closed Job').status).toBe(200);
  expect(at('Apply, unknown Job').status).toBe(404);
  for (const label of ['Apply, open Job', 'Apply, closed Job', 'Apply, unknown Job']) {
    expect(at(label).head.robots, label).toEqual(['noindex, follow']);
    expect([...at(label).head.jsonLd, ...at(label).head.canonical], label).toEqual([]);
  }
  expect(at('Apply, open Job').head.title).toBe(`Apply for ${job('qa-c4-open-remote').title} | Valida`);

  const redirects = [];
  for (const [from, to] of [['/about/', '/about'], ['/Careers', '/careers'], ['/careers/QA-C4-Open-Remote?region=CA', '/careers/qa-c4-open-remote?region=CA']]) {
    const response = await fetchDocument(SEO_INDEXED_ORIGIN, from);
    redirects.push({ from, status: response.status, location: response.headers.location });
    expect([response.status, response.headers.location], from).toEqual([301, to]);
  }

  // C4 review finding: raw targets, sent byte for byte (fetch would rewrite "\" first). A Location must
  // always resolve to this origin; the backslash forms get the 404 page and no Location at all.
  const rawRedirects = [];
  for (const [target, expected] of [
    ['/\\outside.example/A', { status: 404, location: null }],
    ['/\\/outside.example/A', { status: 404, location: null }],
    ['/About?region=CA&utm_source=qa', { status: 301, location: '/about?region=CA&utm_source=qa' }],
  ]) {
    const response = await rawRequest(SEO_INDEXED_ORIGIN, target);
    const resolvedOrigin = response.location ? new URL(response.location, SEO_INDEXED_ORIGIN).origin : null;
    rawRedirects.push({ requestTarget: target, status: response.status, location: response.location, resolvedOrigin, resolvedOnCanonicalSite: response.location ? new URL(response.location, SITE).href : null });
    expect({ status: response.status, location: response.location }, target).toEqual(expected);
    if (resolvedOrigin) expect(resolvedOrigin, target).toBe(SEO_INDEXED_ORIGIN);
  }

  record('C4-01-initial-html', { observation: 'REAL (local document server, test canonical origin)', origin: SEO_INDEXED_ORIGIN, routes: observed, redirects, rawRedirects });
});

test('C4-02 sitemap.xml and robots.txt from the live open Jobs', async () => {
  const sitemap = await sitemapLocs();
  expect(sitemap.status).toBe(200);
  expect(sitemap.contentType).toBe('application/xml; charset=utf-8');
  expect(sitemap.locs).toEqual([
    `${SITE}/`, `${SITE}/about`, `${SITE}/careers`, `${SITE}/privacy`, `${SITE}/legal`,
    // GET /api/v1/jobs order (the API's own), each open Job once.
    ...sitemap.locs.slice(5),
  ]);
  expect([...sitemap.locs.slice(5)].sort()).toEqual([`${SITE}/careers/qa-c4-lifecycle`, `${SITE}/careers/qa-c4-open-hybrid`, `${SITE}/careers/qa-c4-open-remote`]);
  for (const excluded of ['qa-c4-retained-closed', 'qa-c4-draft', 'qa-c4-archived', '/apply']) {
    expect(sitemap.locs.some((loc) => loc.includes(excluded)), excluded).toBe(false);
  }
  expect(sitemap.lastmod).toBe(false);

  const robots = await fetchDocument(SEO_INDEXED_ORIGIN, '/robots.txt');
  expect(robots.status).toBe(200);
  expect(robots.body).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  const disallowed = robots.body.split('\n').filter((line) => line.startsWith('Disallow:')).map((line) => line.slice(9).trim());
  expect(disallowed).toEqual(['/api/', '/admin/', '/employee/']);

  // Every asset the built page loads is reachable and not disallowed (Doc 16 section 113).
  const home = await fetchDocument(SEO_INDEXED_ORIGIN, '/');
  const assets = [...home.body.matchAll(/(?:src|href)="(\/(?:assets|brand)\/[^"]+)"/g)].map((m) => m[1]);
  const assetStatus = [];
  for (const asset of assets) {
    const response = await fetchDocument(SEO_INDEXED_ORIGIN, asset, { method: 'HEAD' });
    assetStatus.push({ asset: asset.replace(/-[A-Za-z0-9_-]{8}\./, '-<hash>.'), status: response.status, cacheControl: response.headers['cache-control'] });
    expect(response.status, asset).toBe(200);
    expect(disallowed.some((rule) => asset.startsWith(rule)), asset).toBe(false);
  }
  record('C4-02-sitemap-robots', { observation: 'REAL', sitemap, robots: robots.body, assetStatus });
});

test('C4-03 open Jobs, direct load: initial HTML = settled head; visible dates match the record, with and without a deadline; no JobPosting', async ({ browser }) => {
  // The reader is in Vancouver; the page must still show the instants in UTC, as the record and any markup state them.
  const context = await browser.newContext({ baseURL: SEO_INDEXED_ORIGIN, timezoneId: 'America/Vancouver', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const cases = {};
  try {
    for (const [name, label] of [['qa-c4-open-remote', 'with a deadline'], ['qa-c4-open-hybrid', 'without a deadline']]) {
      const slug = job(name).slug;
      const initial = headFacts((await fetchDocument(SEO_INDEXED_ORIGIN, `/careers/${slug}`)).body);
      const response = await page.goto(`/careers/${slug}`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(job(name).title);
      await expect(page.getByText('Employment Details')).toBeVisible();
      await expect(page.getByText('Date Posted', { exact: true })).toBeVisible();
      const settled = await browserHead(page);
      const facts = await visibleFacts(page);
      const times = await page.$$eval('dd time', (nodes) => nodes.map((node) => node.getAttribute('datetime')));
      const dto = (await apiJob(slug)).body.data;
      const browserZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

      expect(response.status()).toBe(200);
      expect(settled).toEqual({ ...initial, marker: undefined });
      expect(settled.jsonLd).toEqual([]);
      expect(settled.robots).toEqual([]);
      expect(settled.canonical).toEqual([`${SITE}/careers/${slug}`]);
      expect(facts['Date Posted']).toBe(utcDate(dto.publishedAt));
      if (dto.closesAt) {
        expect(facts['Applications Close']).toBe(utcDeadline(dto.closesAt));
        expect(times).toEqual([dto.publishedAt, dto.closesAt]);
      } else {
        expect(Object.keys(facts)).not.toContain('Applications Close');
        await expect(page.getByText('Applications Close')).toHaveCount(0);
        expect(times).toEqual([dto.publishedAt]);
      }
      cases[label] = {
        slug,
        status: response.status(),
        browserTimeZone: browserZone,
        apiDates: { publishedAt: dto.publishedAt, closesAt: dto.closesAt },
        visibleFacts: facts,
        timeElements: times,
        initialHtmlHead: initial,
        browserHead: settled,
        jobPosting: 'withheld',
        withheldReason: dto.workArrangement === 'FULLY_REMOTE' ? 'NO_APPLICANT_ELIGIBILITY' : 'NO_STRUCTURED_WORKPLACE',
        screenshot: await shot(page, `C4-03-open-job-${label.replace(/ /g, '-')}`),
      };
    }
  } finally {
    await context.close();
  }
  expect(cases['with a deadline'].apiDates.closesAt).toBe('2027-03-31T23:59:59.000Z');
  expect(cases['with a deadline'].visibleFacts['Applications Close']).toBe('31 March 2027, 23:59 UTC');
  expect(cases['without a deadline'].apiDates.closesAt).toBeNull();
  record('C4-03-open-job-dates', { observation: 'REAL (browser timezone America/Vancouver)', cases });
});

test('C4-04 refresh keeps the same status and metadata', async ({ page }) => {
  const slug = job('qa-c4-open-remote').slug;
  await page.goto(`/careers/${slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(job('qa-c4-open-remote').title);
  const before = await browserHead(page);
  const reload = await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(job('qa-c4-open-remote').title);
  const after = await browserHead(page);
  expect(reload.status()).toBe(200);
  expect(after).toEqual(before);

  const closedSlug = job('qa-c4-retained-closed').slug;
  await page.goto(`/careers/${closedSlug}`);
  await expect(page.getByTestId('job-closed-banner')).toBeVisible();
  const closedReload = await page.reload();
  await expect(page.getByTestId('job-closed-banner')).toBeVisible();
  expect(closedReload.status()).toBe(200);
  expect((await browserHead(page)).robots).toEqual(['noindex, follow']);
  record('C4-04-refresh', { observation: 'REAL', openJob: { status: reload.status(), before, after }, closedJob: { status: closedReload.status(), head: await browserHead(page) } });
});

test('C4-05 client navigation: the canonical follows the route; no JobPosting anywhere; Apply is noindex', async ({ page }) => {
  const remote = job('qa-c4-open-remote');
  const steps = [];
  const note = async (label) => steps.push({ label, url: new URL(page.url()).pathname, head: await browserHead(page) });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await note('Home (direct)');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Careers', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: /Work on technology/ })).toBeVisible();
  await expect(page.getByRole('link', { name: `View ${remote.title} role` })).toBeVisible();
  await note('Careers (client navigation)');
  await page.getByRole('link', { name: `View ${remote.title} role` }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(remote.title);
  await expect.poll(async () => (await browserHead(page)).canonical).toEqual([`${SITE}/careers/${remote.slug}`]);
  await note('Job Detail (client navigation)');
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Careers' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Work on technology/ })).toBeVisible();
  await expect.poll(async () => (await browserHead(page)).canonical).toEqual([`${SITE}/careers`]);
  await note('Careers again (breadcrumb)');
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(remote.title);
  await expect.poll(async () => (await browserHead(page)).canonical).toEqual([`${SITE}/careers/${remote.slug}`]);
  await note('Job Detail (browser Back)');
  await page.getByRole('link', { name: 'Apply for This Role' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/careers/${remote.slug}/apply`));
  await expect.poll(async () => (await browserHead(page)).robots).toEqual(['noindex, follow']);
  await note('Apply (client navigation)');

  const byLabel = Object.fromEntries(steps.map((step) => [step.label, step.head]));
  expect(byLabel['Home (direct)'].canonical).toEqual([`${SITE}/`]);
  expect(byLabel['Careers (client navigation)'].canonical).toEqual([`${SITE}/careers`]);
  expect(byLabel['Careers (client navigation)'].jsonLd).toEqual([]);
  expect(byLabel['Job Detail (client navigation)'].canonical).toEqual([`${SITE}/careers/${remote.slug}`]);
  expect(byLabel['Careers again (breadcrumb)'].jsonLd).toEqual([]);
  expect(byLabel['Careers again (breadcrumb)'].canonical).toEqual([`${SITE}/careers`]);
  for (const step of steps) expect(step.head.jsonLd, step.label).toEqual([]);
  expect(byLabel['Apply (client navigation)'].jsonLd).toEqual([]);
  expect(byLabel['Apply (client navigation)'].canonical).toEqual([]);
  expect(byLabel['Apply (client navigation)'].openGraph).toEqual([]);
  // The settled browser head of the Job equals the server's initial HTML for that Job.
  const initial = headFacts((await fetchDocument(SEO_INDEXED_ORIGIN, `/careers/${remote.slug}`)).body);
  expect(byLabel['Job Detail (client navigation)']).toEqual({ ...initial, marker: undefined });
  record('C4-05-client-navigation', { observation: 'REAL', steps });
});

test('C4-06 retained closed Job in the browser: closed state, no Apply action, noindex, no JobPosting', async ({ page }) => {
  const closed = job('qa-c4-retained-closed');
  const response = await page.goto(`/careers/${closed.slug}`);
  await expect(page.getByTestId('job-closed-banner')).toHaveText('Applications Closed');
  await expect(page.getByRole('link', { name: 'Apply for This Role' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'This position is no longer accepting applications.' })).toBeVisible();
  const head = await browserHead(page);
  expect(response.status()).toBe(200);
  expect(head.robots).toEqual(['noindex, follow']);
  expect([...head.jsonLd, ...head.canonical]).toEqual([]);
  record('C4-06-closed-job', { observation: 'REAL', status: response.status(), head, screenshot: await shot(page, 'C4-06-closed-job') });
});

test('C4-07 unknown route and unknown Job slug: real 404, the branded page, noindex (Doc 17 section 214)', async ({ page }) => {
  const unknownRoute = await page.goto('/qa-c4-no-such-page');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const routeHead = await browserHead(page);
  const routeShot = await shot(page, 'C4-07-unknown-route-404');
  const unknownJob = await page.goto('/careers/qa-c4-no-such-role');
  await expect(page.getByTestId('job-unavailable')).toBeVisible();
  const jobHead = await browserHead(page);
  const draft = await page.goto(`/careers/${job('qa-c4-draft').slug}`);
  await expect(page.getByTestId('job-unavailable')).toBeVisible();
  const archived = await page.goto(`/careers/${job('qa-c4-archived').slug}`);
  await expect(page.getByTestId('job-unavailable')).toBeVisible();

  expect([unknownRoute.status(), unknownJob.status(), draft.status(), archived.status()]).toEqual([404, 404, 404, 404]);
  for (const head of [routeHead, jobHead]) {
    expect(head.title).toBe('Page Not Found | Valida');
    expect(head.robots).toEqual(['noindex, follow']);
    expect([...head.jsonLd, ...head.canonical]).toEqual([]);
  }
  record('C4-07-404', {
    observation: 'REAL',
    unknownRoute: { status: unknownRoute.status(), head: routeHead, screenshot: routeShot },
    unknownJob: { status: unknownJob.status(), head: jobHead },
    draftJob: draft.status(),
    archivedJob: archived.status(),
  });
});

test('C4-08 open hybrid Job: indexable and canonical, JobPosting withheld (no structured workplace address in the public DTO)', async ({ page }) => {
  const hybrid = job('qa-c4-open-hybrid');
  const response = await page.goto(`/careers/${hybrid.slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(hybrid.title);
  const head = await browserHead(page);
  const facts = await visibleFacts(page);
  expect(response.status()).toBe(200);
  expect(head.robots).toEqual([]);
  expect(head.canonical).toEqual([`${SITE}/careers/${hybrid.slug}`]);
  expect(head.jsonLd).toEqual([]);
  expect(facts['Work Arrangement']).toBe('Hybrid');
  record('C4-08-hybrid-job', { observation: 'REAL', status: response.status(), head, visibleFacts: facts, withheld: 'NO_STRUCTURED_WORKPLACE' });
});

test('C4-09 closing, then archiving, a Job updates its status, robots, canonical, dates and the sitemap at once (SEO-012, SEO-035)', async ({ page }) => {
  const lifecycle = job('qa-c4-lifecycle');
  const url = `/careers/${lifecycle.slug}`;
  const loc = `${SITE}${url}`;
  const snapshot = async (label) => {
    const response = await fetchDocument(SEO_INDEXED_ORIGIN, url);
    const facts = headFacts(response.body);
    const sitemap = await sitemapLocs();
    return { label, status: response.status, robots: facts.robots, canonical: facts.canonical, jsonLd: facts.jsonLd.length, inSitemap: sitemap.locs.includes(loc) };
  };

  const states = [await snapshot('PUBLISHED (open)')];
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(lifecycle.title);
  const openFacts = await visibleFacts(page);
  const closeRun = await provision(path.join(path.dirname(lifecycle.file), 'qa-c4-lifecycle.closed.json'));
  states.push(await snapshot('CLOSED'));
  const browserResponse = await page.goto(url);
  await expect(page.getByTestId('job-closed-banner')).toBeVisible();
  const closedBrowser = await browserHead(page);
  const closedFacts = await visibleFacts(page);
  const archiveRun = await provision(path.join(path.dirname(lifecycle.file), 'qa-c4-lifecycle.archived.json'));
  states.push(await snapshot('ARCHIVED'));

  expect([closeRun.exitCode, archiveRun.exitCode]).toEqual([0, 0]);
  expect(states).toEqual([
    { label: 'PUBLISHED (open)', status: 200, robots: [], canonical: [loc], jsonLd: 0, inSitemap: true },
    { label: 'CLOSED', status: 200, robots: ['noindex, follow'], canonical: [], jsonLd: 0, inSitemap: false },
    { label: 'ARCHIVED', status: 404, robots: ['noindex, follow'], canonical: [], jsonLd: 0, inSitemap: false },
  ]);
  // Open: the deadline is shown. Closed: the accepted closed page, without date rows.
  expect(openFacts['Applications Close']).toBe('15 January 2027, 12:00 UTC');
  expect(Object.keys(closedFacts)).not.toContain('Applications Close');
  expect(Object.keys(closedFacts)).not.toContain('Date Posted');
  expect(browserResponse.status()).toBe(200);
  expect(closedBrowser.jsonLd).toEqual([]);
  expect(closedBrowser.robots).toEqual(['noindex, follow']);
  record('C4-09-lifecycle', { observation: 'REAL (lifecycle changed through the backend provisioning CLI)', provisioning: [closeRun, archiveRun], states, openFacts, closedFacts, closedBrowser });
});

test('C4-10 review build: every response "noindex, nofollow", no canonical, Open Graph, JobPosting or sitemap (SEO-020)', async ({ browser }) => {
  const observed = [];
  for (const pathname of ['/', '/about', '/careers', '/privacy', '/legal', `/careers/${job('qa-c4-open-remote').slug}`, `/careers/${job('qa-c4-retained-closed').slug}`, `/careers/${job('qa-c4-open-remote').slug}/apply`, '/qa-c4-no-such-page']) {
    const response = await fetchDocument(SEO_REVIEW_ORIGIN, pathname);
    const head = headFacts(response.body);
    observed.push({ path: pathname, status: response.status, xRobotsTag: response.headers['x-robots-tag'], head });
    expect(head.robots, pathname).toEqual(['noindex, nofollow']);
    expect(response.headers['x-robots-tag'], pathname).toBe('noindex, nofollow');
    expect([...head.canonical, ...head.openGraph, ...head.jsonLd], pathname).toEqual([]);
  }
  expect(observed.map((entry) => entry.status)).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 404]);
  const robots = await fetchDocument(SEO_REVIEW_ORIGIN, '/robots.txt');
  const sitemap = await fetchDocument(SEO_REVIEW_ORIGIN, '/sitemap.xml');
  expect(robots.body).not.toMatch(/Sitemap:|Disallow:/);
  expect(sitemap.status).toBe(404);

  const context = await browser.newContext({ baseURL: SEO_REVIEW_ORIGIN });
  const page = await context.newPage();
  await page.goto(`/careers/${job('qa-c4-open-remote').slug}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(job('qa-c4-open-remote').title);
  const settled = await browserHead(page);
  await context.close();
  expect(settled.robots).toEqual(['noindex, nofollow']);
  expect([...settled.canonical, ...settled.openGraph, ...settled.jsonLd]).toEqual([]);
  record('C4-10-review-build', { observation: 'REAL', origin: SEO_REVIEW_ORIGIN, documents: observed, robots: robots.body, sitemapStatus: sitemap.status, browserOpenJob: settled });
});

test('C4-11 Jobs API unreachable: Job routes and the sitemap answer 503, never 404; static routes stay 200', async () => {
  // A third document server for the SAME indexed build, pointed at a port where nothing listens.
  const child = startNode([path.join(FRONTEND_DIR, 'server', 'serve.mjs'), '--dist', run().dirs.dist, '--port', '4195', '--api-origin', 'http://127.0.0.1:9'], {
    cwd: FRONTEND_DIR,
    env: baseEnvironment(),
    logFile: path.join(run().dirs.logs, 'documents-api-down.log'),
  });
  try {
    await waitForReadyLine(child, { label: 'document server (API down)' });
    const origin = 'http://127.0.0.1:4195';
    const observed = {};
    for (const pathname of ['/', '/careers', `/careers/${job('qa-c4-open-remote').slug}`, `/careers/${job('qa-c4-open-remote').slug}/apply`, '/sitemap.xml']) {
      const response = await fetchDocument(origin, pathname);
      observed[pathname] = { status: response.status, retryAfter: response.headers['retry-after'], head: pathname.endsWith('.xml') ? null : headFacts(response.body) };
    }
    expect(Object.values(observed).map((entry) => entry.status)).toEqual([200, 200, 503, 503, 503]);
    expect(observed[`/careers/${job('qa-c4-open-remote').slug}`].head.title).toBe('Careers at Valida');
    expect(observed[`/careers/${job('qa-c4-open-remote').slug}`].head.jsonLd).toEqual([]);
    record('C4-11-api-unreachable', { observation: 'SIMULATED (API origin with nothing listening)', observed });
  } finally {
    await stopChild(child);
  }
});
