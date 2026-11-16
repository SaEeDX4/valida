#!/usr/bin/env node
/**
 * C6-T2 — visitor-aware Job documents, checked on the ACTUAL local stack.
 *
 *   MONGODB_TEST_URI=mongodb://127.0.0.1:27017/valida_test_c6t2 \
 *     node c6/c6-t2-stack.mjs --label final --out <evidence directory>
 *
 * WHAT RUNS
 *   - the real API (`backend/src/server.js` through e2e/support/backendLauncher.mjs),
 *     against a disposable MongoDB database, with synthetic Jobs written through
 *     the B3 provisioning tool;
 *   - the real document server (`frontend/server/serve.mjs`) over two real
 *     production builds (indexable, and indexing disabled);
 *   - Chromium (Playwright), for the rendered Careers, Job Detail and Apply pages;
 *   - small local HTTP proxies that stand in for a hosting proxy: each appends
 *     the client address it is told to X-Forwarded-For, exactly as a host's
 *     proxy appends the address it received a connection from. Both services
 *     run with TRUST_PROXY=1.
 *
 *     browser / client ──> SITE proxy  (appends the visitor) ──> document server ──> SERVICE proxy (appends 203.0.113.250) ──> API
 *     browser / client ──> API proxy   (appends the visitor) ─────────────────────────────────────────────────────────────> API
 *
 *   The SERVICE proxy makes the document server's OWN address a LISTED one
 *   (203.0.113.250 is inside the allowlist): the case in which a document
 *   server that did not delegate correctly would show the tester view to
 *   everyone.
 *
 * WHAT IT DOES NOT SHOW
 *   A real hosting proxy, real network addresses, a real shared cache. Those
 *   are the hosted G-ACCESS checks (C6 plan revision 3, section 4.6.5), per
 *   hostname, before any synthetic Job is provisioned there.
 *
 * SYNTHETIC ONLY. Visitor addresses are documentation addresses (RFC 5737).
 * The service key is random per run, is never written to any evidence file,
 * and is shown as [INTERNAL_SERVICE_KEY]. The genuine vacancy is not touched.
 *
 * Output: results.json (the expected-versus-actual table), http/*.txt (raw
 * requests and responses, sanitised), screenshots/*.png, logs/*.log.
 * Exit code 0 when every check passes, 1 otherwise.
 */
import { randomBytes, createHash } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { checkTestDatabaseTarget } from '../../backend/scripts/test-database.mjs';
import { BACKEND_DIR, FIXTURES_DIR, FRONTEND_DIR } from '../support/paths.js';
import { baseEnvironment, runNode, startNode, stopChild, waitForHttp, waitForReadyLine } from '../support/processes.js';

const { values: args } = parseArgs({ options: { label: { type: 'string', default: 'run' }, out: { type: 'string' } } });
const OUT = path.resolve(args.out ?? path.join(os.tmpdir(), `valida-c6-t2-${args.label}`));
for (const dir of ['http', 'screenshots', 'logs']) mkdirSync(path.join(OUT, dir), { recursive: true });

/* --------------------------------------------------------------- set-up -- */

const guard = checkTestDatabaseTarget({ env: process.env, dotEnvPath: null });
if (!guard.ok) {
  console.error(`refused: ${guard.reason}`);
  process.exit(2);
}
const MONGODB_URI = guard.uri;

const BASE_PORT = Number(process.env.C6T2_BASE_PORT ?? 4330);
const PORT = {
  api: BASE_PORT,
  siteIndexed: BASE_PORT + 1,
  siteReview: BASE_PORT + 2,
  apiProxy: BASE_PORT + 3,
  siteIndexedProxy: BASE_PORT + 4,
  siteReviewProxy: BASE_PORT + 5,
  serviceProxy: BASE_PORT + 6,
  redirectingApi: BASE_PORT + 7,
  collector: BASE_PORT + 8,
  siteRedirect: BASE_PORT + 9,
};
const origin = (port) => `http://127.0.0.1:${port}`;
const API_PROXY_ORIGIN = origin(PORT.apiProxy);
const SITE = { indexed: origin(PORT.siteIndexedProxy), review: origin(PORT.siteReviewProxy) };
const SITE_URL = 'https://cybervalida.com';

/** Documentation addresses (RFC 5737). The allowlist is 203.0.113.0/24 plus loopback. */
const LISTED = '203.0.113.7';
const UNLISTED = '192.0.2.44';
const SERVICE_EGRESS = '203.0.113.250'; // the document server's own address: LISTED on purpose
const ALLOWLIST = '203.0.113.0/24,127.0.0.1/32';

const KEY = `qa-c6t2-${randomBytes(24).toString('hex')}`;
const WRONG_KEY = `qa-c6t2-${randomBytes(24).toString('hex')}`;
/** A synthetic, well-formed identifier for the local public fixture only. It names no owner decision. */
const FIXTURE_AUTHORISATION = 'OD-2099-12-31-99';

const SLUGS = { openEligible: 'qa-c4-open-eligible', openRemote: 'qa-c4-open-remote', closed: 'qa-c4-retained-closed', draft: 'qa-c4-draft' };
const TITLES = {
  openEligible: 'QA C4 Synthetic Eligible Remote Analyst',
  openRemote: 'QA C4 Synthetic Remote Analyst',
  closed: 'QA C4 Synthetic Retained Closed Role',
  draft: 'QA C4 Synthetic Draft Role',
};
const PROVISION = [
  ['qa-c4-open-eligible.json', true],
  ['qa-c4-open-remote.json', true],
  ['qa-c4-retained-closed.json', true],
  ['qa-c4-retained-closed.closed.json', true],
  ['qa-c4-draft.json', false],
];

const sanitise = (text) => String(text).split(KEY).join('[INTERNAL_SERVICE_KEY]').split(WRONG_KEY).join('[WRONG_KEY]');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const results = [];
function check(id, area, description, expected, actual, pass) {
  results.push({ id, area, description, expected, actual: sanitise(typeof actual === 'string' ? actual : JSON.stringify(actual)), pass: Boolean(pass) });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${description}\n`);
}

/* -------------------------------------------------------------- proxies -- */

const visitor = { address: LISTED };
const proxyLog = { service: [] };

/**
 * A stand-in for a hosting proxy: forwards the request unchanged and appends
 * one address to X-Forwarded-For (keeping whatever the client sent before it).
 */
function startProxy({ port, upstreamPort, appended, record }) {
  const server = createServer((req, res) => {
    const headers = { ...req.headers };
    const add = appended();
    if (add) headers['x-forwarded-for'] = headers['x-forwarded-for'] ? `${headers['x-forwarded-for']}, ${add}` : add;
    if (record) {
      record.push({
        method: req.method,
        path: req.url,
        xForwardedFor: headers['x-forwarded-for'] ?? null,
        visitorHeader: headers['x-valida-visitor-address'] ?? null,
        keyHeader: headers['x-valida-internal-key'] === undefined ? 'absent' : headers['x-valida-internal-key'] === KEY ? 'the configured key' : 'another value',
      });
    }
    const upstream = httpRequest({ host: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url, headers }, (answer) => {
      res.writeHead(answer.statusCode, answer.headers);
      answer.pipe(res);
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('proxy: upstream unavailable');
    });
    req.pipe(upstream);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/* ----------------------------------------------------------------- HTTP -- */

let exchangeCount = 0;
/**
 * One request, sent exactly as given (no client-side normalisation), with the
 * raw exchange written to http/<name>.txt after sanitisation.
 */
function exchange(name, base, target, { method = 'GET', headers = {}, body } = {}) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port, path: target, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        exchangeCount += 1;
        const file = `${String(exchangeCount).padStart(3, '0')}-${name}.txt`;
        const requestLines = [`${method} ${target} HTTP/1.1`, `Host: ${hostname}:${port}`, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`)];
        const responseLines = [`HTTP/1.1 ${res.statusCode} ${res.statusMessage}`, ...Object.entries(res.headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)];
        const shownBody = text.length > 6000 ? `${text.slice(0, 6000)}\n[… ${text.length - 6000} more characters; body SHA-256 ${sha256(text)}]` : text;
        writeFileSync(path.join(OUT, 'http', file), sanitise(`# ${name}\n# via ${base}\n\n${requestLines.join('\n')}\n\n${responseLines.join('\n')}\n\n${shownBody}\n`));
        resolve({ status: res.statusCode, headers: res.headers, body: text, file });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const ALL_SLUGS = Object.values(SLUGS);
const ALL_TITLES = Object.values(TITLES);
/**
 * What a response reveals about Jobs. The C5 preload hint is left out: it
 * repeats the slug of the URL the visitor requested, and is written in the
 * same way for every "not found" (unknown, Draft, Archived, hidden), so it
 * tells a visitor nothing they did not send (renderDocument.js jobApiPreloadTag).
 */
const PRELOAD_TAG = /<link rel="preload" as="fetch" crossorigin="anonymous" href="[^"]+">/g;
function disclosure(body) {
  const text = body.replace(PRELOAD_TAG, '');
  return {
    slugs: ALL_SLUGS.filter((slug) => text.includes(slug)),
    titles: ALL_TITLES.filter((title) => text.includes(title)),
    jsonLd: /application\/ld\+json/.test(text),
  };
}
const discloses = (body) => {
  const d = disclosure(body);
  return d.slugs.length > 0 || d.titles.length > 0 || d.jsonLd;
};
const head = (body) => body.slice(0, Math.max(0, body.indexOf('</head>')));
const preloadHref = (body) => /<link rel="preload" as="fetch" crossorigin="anonymous" href="([^"]+)">/.exec(body)?.[1] ?? null;
const summary = (r) => ({
  status: r.status,
  cacheControl: r.headers['cache-control'] ?? null,
  etag: r.headers.etag ?? null,
  lastModified: r.headers['last-modified'] ?? null,
  audience: r.headers['x-valida-audience'] ?? null,
  robots: r.headers['x-robots-tag'] ?? null,
  retryAfter: r.headers['retry-after'] ?? null,
  bodySha256: sha256(r.body).slice(0, 16),
  disclosure: disclosure(r.body),
  file: r.file,
});

async function apiList(name, base, headers = {}) {
  const r = await exchange(name, base, '/api/v1/jobs?page=1&limit=50', { headers });
  let slugs = null;
  try {
    slugs = JSON.parse(r.body).data.items.map((item) => item.slug);
  } catch {
    slugs = null;
  }
  return { ...r, slugs };
}

/* ------------------------------------------------------------ processes -- */

const children = new Set();
async function startApi({ mode, production = false, key = KEY, label }) {
  const storage = mkdtempSync(path.join(os.tmpdir(), 'valida-c6t2-storage-'));
  const env = {
    ...baseEnvironment(),
    APP_ENV: production ? 'production' : 'local',
    NODE_ENV: production ? 'production' : 'development',
    PORT: String(PORT.api),
    LOG_LEVEL: 'info',
    MONGODB_URI,
    CORS_ALLOWED_ORIGINS: `${SITE.indexed},${SITE.review}`,
    TRUST_PROXY: '1',
    RECRUITMENT_MODE: mode,
    ACCESS_ALLOWLIST: ALLOWLIST,
    RECRUITMENT_PUBLIC_AUTHORISATION: production ? FIXTURE_AUTHORISATION : '',
    // C6-T3 correction 1: production requires SITE_ACCESS=public explicitly.
    ...(production ? { SITE_ACCESS: 'public' } : {}),
    ...(key ? { INTERNAL_SERVICE_KEY: key } : {}),
    ...(production ? {} : { RESUME_STORAGE_DRIVER: 'local', RESUME_STORAGE_LOCAL_ROOT: storage }),
    TRANSACTIONAL_EMAIL_PROVIDER: 'none',
  };
  const launcher = fileURLToPath(new URL('../support/backendLauncher.mjs', import.meta.url));
  const child = startNode([launcher], { cwd: BACKEND_DIR, env, logFile: path.join(OUT, 'logs', `api-${label}.log`) });
  children.add(child);
  await waitForReadyLine(child, { label: `api (${label})`, timeoutMs: 60_000 });
  await waitForHttp(`${origin(PORT.api)}/api/v1/health`, { child, label: 'api' });
  return child;
}

async function startSite({ name, dist, port, apiOrigin = origin(PORT.serviceProxy), key = KEY, label, trustProxy = '1' }) {
  const env = { ...baseEnvironment(), TRUST_PROXY: trustProxy, ...(key ? { INTERNAL_SERVICE_KEY: key } : {}) };
  const child = startNode([path.join(FRONTEND_DIR, 'server', 'serve.mjs'), '--dist', dist, '--host', '127.0.0.1', '--port', String(port), '--api-origin', apiOrigin], {
    cwd: FRONTEND_DIR,
    env,
    logFile: path.join(OUT, 'logs', `documents-${name}-${label}.log`),
  });
  children.add(child);
  const ready = await waitForReadyLine(child, { label: `document server (${name}, ${label})` });
  return { child, ready };
}

async function stop(child) {
  if (!child) return;
  await stopChild(child);
  children.delete(child);
}

/* -------------------------------------------------------------- browser -- */

const MARKERS = {
  careers: { empty: 'No open roles right now.', error: 'Open roles are temporarily unavailable.', loading: 'Loading open roles' },
  job: { notFound: "This role isn't available.", error: "We couldn't load this role.", closed: 'Applications Closed' },
  apply: { unavailable: "This application isn't available.", form: 'Submit Application' },
};

/** What the page settled on: the state, and what Job content (if any) it shows. */
async function rendered(browser, name, pathname, kind) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const apiStatuses = [];
  page.on('response', (response) => {
    if (response.url().startsWith(API_PROXY_ORIGIN)) apiStatuses.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  await page.goto(`${SITE.indexed}${pathname}`, { waitUntil: 'domcontentloaded' });
  const markers = Object.values(MARKERS[kind]).filter((text) => !text.startsWith('Loading'));
  await page
    .waitForFunction(
      ({ markers, titles, kind }) => {
        const text = document.body.innerText;
        if (markers.some((m) => text.includes(m))) return true;
        if (kind === 'careers' && /View Role/.test(text)) return true;
        if (kind === 'job' && titles.some((t) => document.querySelector('h1')?.textContent?.includes(t))) return true;
        return false;
      },
      { markers, titles: ALL_TITLES, kind },
      { timeout: 20_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(300);
  const text = await page.evaluate(() => document.body.innerText);
  const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent ?? null);
  const roleLinks = await page.evaluate(() => [...document.querySelectorAll('a')].map((a) => a.getAttribute('aria-label') ?? a.textContent).filter((t) => /^View Role/.test(t ?? '')));
  let state = 'unknown';
  for (const [stateName, marker] of Object.entries(MARKERS[kind])) if (!marker.startsWith('Loading') && text.includes(marker)) state = stateName;
  if (kind === 'careers' && roleLinks.length > 0) state = 'list';
  if (kind === 'job' && state === 'unknown' && ALL_TITLES.some((t) => h1?.includes(t))) state = 'job';
  const shown = ALL_TITLES.filter((t) => text.includes(t));
  await page.screenshot({ path: path.join(OUT, 'screenshots', `${name}.png`), fullPage: false });
  await context.close();
  return { state, h1, titlesShown: shown, roleLinks, apiStatuses };
}

/* ------------------------------------------------------------ the run -- */

let browser;
const servers = [];
try {
  // 1. A fresh disposable database, indexes, synthetic Jobs through the B3 tool.
  const backendRequire = createRequire(path.join(BACKEND_DIR, 'package.json'));
  const mongoose = backendRequire('mongoose');
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.db.databaseName !== guard.databaseName) throw new Error('connected to an unexpected database');
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  const scriptEnv = { ...baseEnvironment(), APP_ENV: 'local', NODE_ENV: 'development', MONGODB_URI };
  const setupLog = path.join(OUT, 'logs', 'setup.log');
  const step = async (label, stepArgs) => {
    const result = await runNode(stepArgs, { cwd: BACKEND_DIR, env: scriptEnv, logFile: setupLog, label });
    if (result.code !== 0) throw new Error(`setup step failed: ${label}`);
  };
  await step('db:indexes:apply', ['scripts/db-indexes.mjs', 'apply']);
  for (const [file, confirm] of PROVISION) {
    await step(`provision ${file}`, ['scripts/provision-job.mjs', 'apply', '--file', path.join(FIXTURES_DIR, 'seo-jobs', file), ...(confirm ? ['--confirm-lifecycle'] : [])]);
  }

  // 2. Two production builds whose browser code calls the API through the API proxy.
  const builds = mkdtempSync(path.join(os.tmpdir(), 'valida-c6t2-builds-'));
  const dist = { indexed: path.join(builds, 'indexed'), review: path.join(builds, 'review') };
  const vite = path.join(FRONTEND_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  for (const [name, extra] of [['indexed', { VITE_ALLOW_INDEXING: 'true', VITE_PUBLIC_SITE_URL: SITE_URL }], ['review', {}]]) {
    const build = await runNode([vite, 'build', '--outDir', dist[name]], {
      cwd: FRONTEND_DIR,
      env: { ...baseEnvironment(), VITE_API_BASE_URL: API_PROXY_ORIGIN, ...extra },
      logFile: path.join(OUT, 'logs', 'build.log'),
      label: `vite build (${name})`,
      timeoutMs: 300_000,
    });
    if (build.code !== 0) throw new Error(`build failed: ${name}`);
  }
  const builtFiles = (dir) => readdirSync(dir, { recursive: true }).filter((f) => !f.endsWith('/')).map((f) => path.join(dir, f));
  const keyInBuild = [...builtFiles(dist.indexed), ...builtFiles(dist.review)].filter((f) => {
    try {
      return readFileSync(f).includes(KEY);
    } catch {
      return false;
    }
  });
  check('K1', 'credentials', 'The service key is not in any built file (browser code, HTML)', 'no file contains the key', `${keyInBuild.length} files`, keyInBuild.length === 0);

  // 3. Proxies.
  servers.push(await startProxy({ port: PORT.apiProxy, upstreamPort: PORT.api, appended: () => visitor.address }));
  servers.push(await startProxy({ port: PORT.siteIndexedProxy, upstreamPort: PORT.siteIndexed, appended: () => visitor.address }));
  servers.push(await startProxy({ port: PORT.siteReviewProxy, upstreamPort: PORT.siteReview, appended: () => visitor.address }));
  servers.push(await startProxy({ port: PORT.serviceProxy, upstreamPort: PORT.api, appended: () => SERVICE_EGRESS, record: proxyLog.service }));

  browser = await chromium.launch();

  /* ====================================================== CLOSED ===== */
  let api = await startApi({ mode: 'closed', label: 'closed' });
  let siteIndexed = await startSite({ name: 'indexed', dist: dist.indexed, port: PORT.siteIndexed, label: 'closed' });
  let siteReview = await startSite({ name: 'review', dist: dist.review, port: PORT.siteReview, label: 'closed' });

  for (const [who, address] of [['listed', LISTED], ['unlisted', UNLISTED]]) {
    visitor.address = address;
    const careers = await exchange(`closed-${who}-careers`, SITE.indexed, '/careers');
    const job = await exchange(`closed-${who}-job`, SITE.indexed, `/careers/${SLUGS.openEligible}`);
    const apply = await exchange(`closed-${who}-apply`, SITE.indexed, `/careers/${SLUGS.openEligible}/apply`);
    const closedJob = await exchange(`closed-${who}-closed-job`, SITE.indexed, `/careers/${SLUGS.closed}`);
    const sitemap = await exchange(`closed-${who}-sitemap`, SITE.indexed, '/sitemap.xml');
    const list = await apiList(`closed-${who}-api-list`, API_PROXY_ORIGIN);
    const detail = await exchange(`closed-${who}-api-detail`, API_PROXY_ORIGIN, `/api/v1/jobs/${SLUGS.openEligible}`);
    check(`A1-${who}`, 'closed', `closed, ${who} visitor: Careers document 200 and discloses no Job`, '200; no slug, title or JSON-LD', summary(careers), careers.status === 200 && !discloses(careers.body));
    check(`A2-${who}`, 'closed', `closed, ${who}: an OPEN Job's document is 404 and discloses nothing`, '404; no Job in HTML or metadata; private, no-store', summary(job),
      job.status === 404 && !discloses(job.body) && job.headers['cache-control'] === 'private, no-store');
    check(`A3-${who}`, 'closed', `closed, ${who}: its Apply document is 404 and discloses nothing`, '404; no Job; private, no-store', summary(apply),
      apply.status === 404 && !discloses(apply.body) && apply.headers['cache-control'] === 'private, no-store');
    check(`A4-${who}`, 'closed', `closed, ${who}: a CLOSED Job's document is 404`, '404; no Job', summary(closedJob), closedJob.status === 404 && !discloses(closedJob.body));
    check(`A5-${who}`, 'closed', `closed, ${who}: /sitemap.xml lists no Job`, '200; no /careers/<slug> entry', summary(sitemap), sitemap.status === 200 && !/\/careers\/[a-z0-9-]+</.test(sitemap.body));
    check(`A6-${who}`, 'closed', `closed, ${who}: the browser's API read — empty list, Job 404`, 'list []; detail 404; no tester header', { list: list.slugs, detail: detail.status, audience: list.headers['x-valida-audience'] ?? null },
      Array.isArray(list.slugs) && list.slugs.length === 0 && detail.status === 404 && !list.headers['x-valida-audience']);
    const rc = await rendered(browser, `closed-${who}-careers`, '/careers', 'careers');
    const rj = await rendered(browser, `closed-${who}-job`, `/careers/${SLUGS.openEligible}`, 'job');
    const ra = await rendered(browser, `closed-${who}-apply`, `/careers/${SLUGS.openEligible}/apply`, 'apply');
    check(`A7-${who}`, 'closed', `closed, ${who}: rendered Careers is usable with no roles`, 'state empty; no Job title', rc, rc.state === 'empty' && rc.titlesShown.length === 0);
    check(`A8-${who}`, 'closed', `closed, ${who}: rendered Job Detail is "not available"`, 'state notFound', rj, rj.state === 'notFound' && rj.titlesShown.length === 0);
    check(`A9-${who}`, 'closed', `closed, ${who}: rendered Apply is "not available"`, 'state unavailable', ra, ra.state === 'unavailable' && ra.titlesShown.length === 0);
  }
  visitor.address = UNLISTED;
  const reviewSitemap = await exchange('closed-review-sitemap', SITE.review, '/sitemap.xml');
  const reviewJob = await exchange('closed-review-job', SITE.review, `/careers/${SLUGS.openEligible}`);
  check('A10', 'indexing disabled', 'Review build: /sitemap.xml 404 noindex; Job document 404 noindex', 'sitemap 404 + x-robots-tag noindex, nofollow; job 404 + noindex, nofollow',
    { sitemap: summary(reviewSitemap), job: summary(reviewJob) },
    reviewSitemap.status === 404 && /noindex/.test(reviewSitemap.headers['x-robots-tag'] ?? '') && reviewJob.status === 404 && /noindex, nofollow/.test(reviewJob.headers['x-robots-tag'] ?? ''));

  await stop(api);

  /* ====================================================== TESTERS ==== */
  api = await startApi({ mode: 'testers', label: 'testers' });

  // B — listed and unlisted visitors through the proxies.
  for (const [who, address] of [['listed', LISTED], ['unlisted', UNLISTED]]) {
    visitor.address = address;
    const listed = who === 'listed';
    const job = await exchange(`testers-${who}-job`, SITE.indexed, `/careers/${SLUGS.openEligible}`);
    const apply = await exchange(`testers-${who}-apply`, SITE.indexed, `/careers/${SLUGS.openEligible}/apply`);
    const closedJob = await exchange(`testers-${who}-closed-job`, SITE.indexed, `/careers/${SLUGS.closed}`);
    const draft = await exchange(`testers-${who}-draft`, SITE.indexed, `/careers/${SLUGS.draft}`);
    const sitemap = await exchange(`testers-${who}-sitemap`, SITE.indexed, '/sitemap.xml');
    const list = await apiList(`testers-${who}-api-list`, API_PROXY_ORIGIN);
    if (listed) {
      check('B1', 'testers', 'testers, listed visitor: the open Job document is 200 with its title, JobPosting and the tester header', '200; title; JSON-LD; X-Valida-Audience: tester; private, no-store',
        summary(job), job.status === 200 && head(job.body).includes(TITLES.openEligible) && /application\/ld\+json/.test(job.body) && job.headers['x-valida-audience'] === 'tester' && job.headers['cache-control'] === 'private, no-store');
      check('B2', 'testers', 'testers, listed: Apply document 200 noindex; closed Job 200 noindex without JobPosting; Draft 404',
        'apply 200 noindex, follow; closed 200 noindex, follow, no JSON-LD; draft 404',
        { apply: summary(apply), closed: summary(closedJob), draft: summary(draft) },
        apply.status === 200 && apply.headers['x-robots-tag'] === 'noindex, follow' && closedJob.status === 200 && closedJob.headers['x-robots-tag'] === 'noindex, follow' && !/application\/ld\+json/.test(closedJob.body) && draft.status === 404 && !discloses(draft.body));
      const href = preloadHref(job.body);
      check('B3', 'preload', 'testers, listed: the C5 preload hint names the browser-facing API URL and carries no credential',
        `href ${API_PROXY_ORIGIN}/api/v1/jobs/${SLUGS.openEligible}; no key in HTML`, { href, keyInHtml: job.body.includes(KEY) },
        href === `${API_PROXY_ORIGIN}/api/v1/jobs/${SLUGS.openEligible}` && !job.body.includes(KEY));
      check('B4', 'testers', "testers, listed: the browser's own API read lists the open Jobs with the tester header", `[${SLUGS.openEligible}, ${SLUGS.openRemote}] in some order; tester`,
        { slugs: list.slugs, audience: list.headers['x-valida-audience'] ?? null },
        Array.isArray(list.slugs) && list.slugs.length === 2 && list.slugs.includes(SLUGS.openEligible) && list.slugs.includes(SLUGS.openRemote) && list.headers['x-valida-audience'] === 'tester');
    } else {
      check('B5', 'testers', 'testers, UNLISTED visitor (the document server\'s own address IS listed): the open Job document is 404 and discloses nothing',
        '404; no Job; no tester header; private, no-store', summary(job),
        job.status === 404 && !discloses(job.body) && !job.headers['x-valida-audience'] && job.headers['cache-control'] === 'private, no-store');
      check('B6', 'testers', 'testers, unlisted: Apply 404, closed Job 404, Draft 404 — nothing disclosed', 'all 404; no Job',
        { apply: summary(apply), closed: summary(closedJob), draft: summary(draft) },
        [apply, closedJob, draft].every((r) => r.status === 404 && !discloses(r.body) && !r.headers['x-valida-audience']));
      check('B7', 'testers', "testers, unlisted: the browser's own API read is empty (T1)", 'list []; no tester header', { slugs: list.slugs, audience: list.headers['x-valida-audience'] ?? null },
        Array.isArray(list.slugs) && list.slugs.length === 0 && !list.headers['x-valida-audience']);
    }
    check(`B8-${who}`, 'sitemap', `testers, ${who}: /sitemap.xml is the PUBLIC view — no tester-only Job`, '200; no /careers/<slug> entry', summary(sitemap),
      sitemap.status === 200 && !/\/careers\/[a-z0-9-]+</.test(sitemap.body));
    const rc = await rendered(browser, `testers-${who}-careers`, '/careers', 'careers');
    const rj = await rendered(browser, `testers-${who}-job`, `/careers/${SLUGS.openEligible}`, 'job');
    const ra = await rendered(browser, `testers-${who}-apply`, `/careers/${SLUGS.openEligible}/apply`, 'apply');
    if (listed) {
      check('B9', 'testers', 'testers, listed: rendered Careers lists both open Jobs; Job Detail shows the Job; Apply shows the form', 'careers list (2 roles); job; form',
        { careers: rc, job: rj, apply: ra }, rc.state === 'list' && rc.roleLinks.length === 2 && rj.state === 'job' && ra.state === 'form');
    } else {
      check('B10', 'testers', 'testers, unlisted: rendered Careers empty; Job Detail not available; Apply not available', 'empty; notFound; unavailable',
        { careers: rc, job: rj, apply: ra }, rc.state === 'empty' && rj.state === 'notFound' && ra.state === 'unavailable' && [rc, rj, ra].every((r) => r.titlesShown.length === 0));
    }
  }
  // Submissions through the browser's path (API proxy). No record is created: a
  // listed request stops at the Idempotency-Key check, which comes after the gate.
  visitor.address = LISTED;
  const listedPost = await exchange('testers-listed-submit', API_PROXY_ORIGIN, `/api/v1/jobs/${SLUGS.openEligible}/applications`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  visitor.address = UNLISTED;
  const unlistedPost = await exchange('testers-unlisted-submit', API_PROXY_ORIGIN, `/api/v1/jobs/${SLUGS.openEligible}/applications`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  check('B11', 'submission', 'testers: a listed submission reaches the Apply handler; an unlisted one is refused before the body is read (T1)',
    'listed 400 IDEMPOTENCY_KEY_REQUIRED; unlisted 404 JOB_NOT_FOUND, Connection: close',
    { listed: [listedPost.status, JSON.parse(listedPost.body)?.error?.code], unlisted: [unlistedPost.status, JSON.parse(unlistedPost.body)?.error?.code, unlistedPost.headers.connection] },
    listedPost.status === 400 && JSON.parse(listedPost.body).error.code === 'IDEMPOTENCY_KEY_REQUIRED' && unlistedPost.status === 404 && JSON.parse(unlistedPost.body).error.code === 'JOB_NOT_FOUND');

  // What the document server actually sent to the API.
  const sent = proxyLog.service.filter((entry) => entry.path.startsWith('/api/v1/jobs'));
  const jobReads = sent.filter((entry) => entry.path.startsWith(`/api/v1/jobs/${SLUGS.openEligible}`));
  const sitemapReads = sent.filter((entry) => entry.path.startsWith('/api/v1/jobs?'));
  check('B12', 'delegation', 'The document server delegated each Job read with the visitor it established, and the key', 'visitor 203.0.113.7 or 192.0.2.44; key present',
    jobReads.slice(-4), jobReads.length > 0 && jobReads.every((e) => [LISTED, UNLISTED].includes(e.visitorHeader) && e.keyHeader === 'the configured key'));
  check('B13', 'sitemap', "The document server's sitemap reads ask for the public view", 'visitor header "unlisted"; key present', sitemapReads.slice(-2),
    sitemapReads.length > 0 && sitemapReads.every((e) => e.visitorHeader === 'unlisted' && e.keyHeader === 'the configured key'));

  // C — invalid delegation, straight at the API through the SERVICE proxy, whose appended address (203.0.113.250) IS listed.
  const svc = origin(PORT.serviceProxy);
  const control = await apiList('delegation-none-direct-from-listed-peer', svc);
  check('C0', 'delegation', 'Control: a read with NO delegation from the listed service address is a direct T1 request — tester view', `2 Jobs; tester header (shows that 203.0.113.250 is listed)`,
    { slugs: control.slugs, audience: control.headers['x-valida-audience'] ?? null }, Array.isArray(control.slugs) && control.slugs.length === 2 && control.headers['x-valida-audience'] === 'tester');
  const delegationCases = [
    ['C1', 'key and visitor 203.0.113.7 (listed): tester view — positive control', { 'x-valida-internal-key': KEY, 'x-valida-visitor-address': LISTED }, true],
    ['C2', 'key and visitor 192.0.2.44 (unlisted)', { 'x-valida-internal-key': KEY, 'x-valida-visitor-address': UNLISTED }, false],
    ['C3', 'key and visitor "unlisted"', { 'x-valida-internal-key': KEY, 'x-valida-visitor-address': 'unlisted' }, false],
    ['C4', 'MISSING key, listed visitor', { 'x-valida-visitor-address': LISTED }, false],
    ['C5', 'WRONG key, listed visitor', { 'x-valida-internal-key': WRONG_KEY, 'x-valida-visitor-address': LISTED }, false],
    ['C6', 'key, MISSING visitor', { 'x-valida-internal-key': KEY }, false],
    ['C7', 'key, MALFORMED visitor (address with a port)', { 'x-valida-internal-key': KEY, 'x-valida-visitor-address': `${LISTED}:443` }, false],
    ['C8', 'key, MALFORMED visitor (two addresses)', { 'x-valida-internal-key': KEY, 'x-valida-visitor-address': `${UNLISTED}, ${LISTED}` }, false],
    ['C9', 'key, MALFORMED visitor (not an address)', { 'x-valida-internal-key': KEY, 'x-valida-visitor-address': 'tester' }, false],
    ['C10', 'key, visitor an IPv4-mapped spelling of the listed address', { 'x-valida-internal-key': KEY, 'x-valida-visitor-address': '::ffff:cb00:7107' }, true],
  ];
  for (const [id, label, headers, tester] of delegationCases) {
    const r = await apiList(`delegation-${id}`, svc, headers);
    const actual = { status: r.status, slugs: r.slugs, audience: r.headers['x-valida-audience'] ?? null };
    const ok = tester
      ? r.status === 200 && Array.isArray(r.slugs) && r.slugs.length === 2 && r.headers['x-valida-audience'] === 'tester'
      : r.status === 200 && Array.isArray(r.slugs) && r.slugs.length === 0 && !r.headers['x-valida-audience'];
    check(id, 'delegation', `API, delegation ${label}`, tester ? 'tester view (2 Jobs, tester header)' : 'unlisted view (empty list, no tester header)', actual, ok);
  }
  const delegatedDetail = await exchange('delegation-C11-detail-wrong-key', svc, `/api/v1/jobs/${SLUGS.openEligible}`, { headers: { 'x-valida-internal-key': WRONG_KEY, 'x-valida-visitor-address': LISTED } });
  check('C11', 'delegation', 'API, Job Detail with a WRONG key: the unknown-Job answer', '404 JOB_NOT_FOUND', summary(delegatedDetail), delegatedDetail.status === 404);
  const delegatedPost = await exchange('delegation-C12-submission', svc, `/api/v1/jobs/${SLUGS.openEligible}/applications`, {
    method: 'POST',
    headers: { 'x-valida-internal-key': KEY, 'x-valida-visitor-address': LISTED, 'content-type': 'application/json', 'idempotency-key': '11111111-1111-4111-8111-111111111111' },
    body: '{}',
  });
  check('C12', 'delegation', 'API: delegation grants no submission — a POST with the key and a listed visitor is refused before the body', '404 JOB_NOT_FOUND, Connection: close',
    summary(delegatedPost), delegatedPost.status === 404 && JSON.parse(delegatedPost.body).error.code === 'JOB_NOT_FOUND');

  // Visitor-supplied delegation headers at the document server.
  visitor.address = UNLISTED;
  const forged = await exchange('documents-C13-visitor-supplies-delegation', SITE.indexed, `/careers/${SLUGS.openEligible}`, { headers: { 'x-valida-internal-key': KEY, 'x-valida-visitor-address': LISTED } });
  check('C13', 'delegation', 'Document server: an unlisted visitor who sends the delegation headers (even the right key) gets the unlisted view', '404; no Job', summary(forged),
    forged.status === 404 && !discloses(forged.body));
  const forgedSent = proxyLog.service.slice(-1)[0];
  check('C14', 'delegation', 'Document server: the visitor-supplied headers were not passed on — it delegated the address IT established', `visitor ${UNLISTED}`, forgedSent, forgedSent?.visitorHeader === UNLISTED);

  // Insufficient forwarding history: straight to each service, no proxy, from loopback (127.0.0.1 IS listed).
  const directDoc = await exchange('documents-C15-no-forwarding-chain', origin(PORT.siteIndexed), `/careers/${SLUGS.openEligible}`);
  check('C15', 'forwarding', 'Document server, TRUST_PROXY=1, no X-Forwarded-For, listed loopback peer: the unlisted view', '404; no Job', summary(directDoc), directDoc.status === 404 && !discloses(directDoc.body));
  const shortChain = await exchange('documents-C16-short-chain', origin(PORT.siteIndexed), `/careers/${SLUGS.openEligible}`, { headers: { 'x-forwarded-for': '' } });
  check('C16', 'forwarding', 'Document server, TRUST_PROXY=1, an empty X-Forwarded-For: the unlisted view', '404', summary(shortChain), shortChain.status === 404);
  const directApi = await apiList('api-C17-no-forwarding-chain', origin(PORT.api));
  check('C17', 'forwarding', 'API, TRUST_PROXY=1, no X-Forwarded-For, listed loopback peer: unlisted (T1)', 'empty list', { slugs: directApi.slugs }, Array.isArray(directApi.slugs) && directApi.slugs.length === 0);

  // The document server without a key, and with the wrong key: listed visitors get the unlisted view.
  for (const [id, label, key] of [['C18', 'no INTERNAL_SERVICE_KEY', null], ['C19', 'a WRONG INTERNAL_SERVICE_KEY', WRONG_KEY]]) {
    await stop(siteIndexed.child);
    siteIndexed = await startSite({ name: 'indexed', dist: dist.indexed, port: PORT.siteIndexed, key, label: id });
    visitor.address = LISTED;
    const r = await exchange(`documents-${id}`, SITE.indexed, `/careers/${SLUGS.openEligible}`);
    const lastSent = proxyLog.service.slice(-1)[0];
    check(id, 'delegation', `Document server with ${label}: a LISTED visitor gets the unlisted view (fails closed)`, '404; no Job; it still sent its visitor header', { response: summary(r), sent: lastSent },
      r.status === 404 && !discloses(r.body) && lastSent?.visitorHeader === LISTED);
  }
  await stop(siteIndexed.child);
  siteIndexed = await startSite({ name: 'indexed', dist: dist.indexed, port: PORT.siteIndexed, label: 'testers' });

  // Redirects: an API origin that answers with a redirect to ANOTHER origin.
  const collected = [];
  servers.push(await new Promise((resolve) => {
    const s = createServer((req, res) => {
      collected.push({ path: req.url, keyHeader: req.headers['x-valida-internal-key'] === undefined ? 'absent' : 'present' });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"success":true,"data":{}}');
    });
    s.listen(PORT.collector, '127.0.0.1', () => resolve(s));
  }));
  const redirectingRequests = [];
  servers.push(await new Promise((resolve) => {
    const s = createServer((req, res) => {
      redirectingRequests.push({ path: req.url, keyHeader: req.headers['x-valida-internal-key'] === KEY ? 'the configured key' : 'absent or other' });
      const status = req.url.includes('closed') ? 307 : 302;
      res.writeHead(status, { location: `${origin(PORT.collector)}/collect${req.url}` });
      res.end();
    });
    s.listen(PORT.redirectingApi, '127.0.0.1', () => resolve(s));
  }));
  const redirectSite = await startSite({ name: 'redirect', dist: dist.indexed, port: PORT.siteRedirect, apiOrigin: origin(PORT.redirectingApi), label: 'redirect', trustProxy: 'false' });
  const viaRedirect302 = await exchange('documents-C20-api-redirects-302', origin(PORT.siteRedirect), `/careers/${SLUGS.openEligible}`);
  const viaRedirect307 = await exchange('documents-C20-api-redirects-307', origin(PORT.siteRedirect), `/careers/${SLUGS.closed}`);
  const viaRedirectSitemap = await exchange('documents-C20-api-redirects-sitemap', origin(PORT.siteRedirect), '/sitemap.xml');
  check('C20', 'credentials', 'An API origin that redirects (302, 307) to another origin: the document server never follows it, so the key never leaves its origin; the page is 503, not 404',
    'collector received 0 requests; documents 503 + Retry-After; sitemap 503',
    { collector: collected.length, configuredOriginSawKey: redirectingRequests.map((r) => r.keyHeader), job: summary(viaRedirect302), closed: summary(viaRedirect307), sitemap: viaRedirectSitemap.status },
    collected.length === 0 && viaRedirect302.status === 503 && viaRedirect307.status === 503 && viaRedirectSitemap.status === 503);
  await stop(redirectSite.child);

  // D — the same URL for different visitors, both orders, with conditional requests.
  const conditional = (r) => ({
    'if-none-match': r.headers.etag ?? '*',
    'if-modified-since': r.headers['last-modified'] ?? new Date().toUTCString(),
  });
  const targets = [
    ['careers', SITE.indexed, '/careers'],
    ['job', SITE.indexed, `/careers/${SLUGS.openEligible}`],
    ['apply', SITE.indexed, `/careers/${SLUGS.openEligible}/apply`],
    ['sitemap', SITE.indexed, '/sitemap.xml'],
    ['api-list', API_PROXY_ORIGIN, '/api/v1/jobs?page=1&limit=50'],
    ['api-detail', API_PROXY_ORIGIN, `/api/v1/jobs/${SLUGS.openEligible}`],
  ];
  for (const [order, first, second] of [['listed-then-unlisted', LISTED, UNLISTED], ['unlisted-then-listed', UNLISTED, LISTED]]) {
    for (const [name, base, target] of targets) {
      visitor.address = first;
      const a = await exchange(`D-${order}-${name}-1`, base, target);
      visitor.address = second;
      const b = await exchange(`D-${order}-${name}-2-conditional`, base, target, { headers: conditional(a) });
      const c = await exchange(`D-${order}-${name}-3-plain`, base, target);
      visitor.address = first;
      const d = await exchange(`D-${order}-${name}-4-first-again-conditional`, base, target, { headers: conditional(c) });
      const recruitmentPath = ['job', 'apply', 'careers'].includes(name);
      const apiPath = name.startsWith('api');
      const noValidators = [a, b, c, d].every((r) => !r.headers.etag && !r.headers['last-modified']);
      const no304 = [a, b, c, d].every((r) => r.status !== 304);
      const expectedCache = recruitmentPath ? 'private, no-store' : apiPath ? 'no-store' : 'no-cache';
      const cacheOk = [a, b, c, d].every((r) => (r.headers['cache-control'] ?? '') === expectedCache);
      const listedResp = first === LISTED ? a : c;
      const unlistedResp = first === LISTED ? c : a;
      const unlistedConditional = first === LISTED ? b : null;
      let viewOk = true;
      if (name === 'job' || name === 'apply') {
        viewOk = listedResp.status === 200 && listedResp.headers['x-valida-audience'] === 'tester' && unlistedResp.status === 404 && !discloses(unlistedResp.body) && !unlistedResp.headers['x-valida-audience'] && (unlistedConditional ? unlistedConditional.status === 404 && !discloses(unlistedConditional.body) : true);
      } else if (name === 'careers') {
        viewOk = a.status === 200 && c.status === 200 && sha256(a.body) === sha256(c.body) && !discloses(a.body);
      } else if (name === 'sitemap') {
        viewOk = [a, b, c, d].every((r) => r.status === 200 && !/\/careers\/[a-z0-9-]+</.test(r.body)) && sha256(a.body) === sha256(c.body);
      } else if (name === 'api-list') {
        viewOk = JSON.parse(listedResp.body).data.items.length === 2 && JSON.parse(unlistedResp.body).data.items.length === 0 && !unlistedResp.headers['x-valida-audience'];
      } else if (name === 'api-detail') {
        viewOk = listedResp.status === 200 && unlistedResp.status === 404;
      }
      check(`D-${order}-${name}`, 'caching', `Same URL, ${order.replaceAll('-', ' ')}: ${name} (plain and conditional GETs)`,
        `no ETag, no Last-Modified, no 304; Cache-Control: ${expectedCache}; each visitor gets its own view`,
        [a, b, c, d].map(summary), noValidators && no304 && cacheOk && viewOk);
    }
  }
  // A static asset keeps its accepted public caching.
  visitor.address = UNLISTED;
  const asset = readdirSync(path.join(dist.indexed, 'assets')).find((f) => f.endsWith('.js'));
  const assetResponse = await exchange('asset-caching', SITE.indexed, `/assets/${asset}`);
  check('D-asset', 'caching', 'A fingerprinted asset keeps public, immutable caching', 'public, max-age=31536000, immutable', assetResponse.headers['cache-control'], assetResponse.headers['cache-control'] === 'public, max-age=31536000, immutable');

  await stop(api);

  /* ======================================================= PUBLIC ==== */
  api = await startApi({ mode: 'public', production: true, label: 'public-fixture' });
  visitor.address = UNLISTED;
  const pubJob = await exchange('public-unlisted-job', SITE.indexed, `/careers/${SLUGS.openEligible}`);
  const pubApply = await exchange('public-unlisted-apply', SITE.indexed, `/careers/${SLUGS.openEligible}/apply`);
  const pubClosed = await exchange('public-unlisted-closed-job', SITE.indexed, `/careers/${SLUGS.closed}`);
  const pubDraft = await exchange('public-unlisted-draft', SITE.indexed, `/careers/${SLUGS.draft}`);
  const pubSitemap = await exchange('public-sitemap', SITE.indexed, '/sitemap.xml');
  const pubReviewJob = await exchange('public-review-job', SITE.review, `/careers/${SLUGS.openEligible}`);
  const pubReviewSitemap = await exchange('public-review-sitemap', SITE.review, '/sitemap.xml');
  check('E1', 'public', 'public fixture, unlisted visitor: the open Job document 200 with JobPosting, canonical, no robots directive, no tester header',
    '200; JSON-LD; canonical https://cybervalida.com/careers/<slug>; no x-robots-tag; no tester header', summary(pubJob),
    pubJob.status === 200 && /application\/ld\+json/.test(pubJob.body) && head(pubJob.body).includes(`<link rel="canonical" href="${SITE_URL}/careers/${SLUGS.openEligible}">`) && !pubJob.headers['x-robots-tag'] && !pubJob.headers['x-valida-audience']);
  check('E2', 'public', 'public fixture: Apply 200 noindex; closed Job 200 noindex without JobPosting; Draft 404', 'as accepted in C4', { apply: summary(pubApply), closed: summary(pubClosed), draft: summary(pubDraft) },
    pubApply.status === 200 && pubApply.headers['x-robots-tag'] === 'noindex, follow' && pubClosed.status === 200 && !/application\/ld\+json/.test(pubClosed.body) && pubDraft.status === 404);
  const locs = [...pubSitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  check('E3', 'public', 'public fixture: /sitemap.xml lists exactly the open Jobs (not the closed or Draft one), cache-control no-cache', `the 5 static routes + ${SLUGS.openEligible} + ${SLUGS.openRemote}`,
    { status: pubSitemap.status, cacheControl: pubSitemap.headers['cache-control'], jobLocs: locs.filter((l) => l.includes('/careers/')) },
    pubSitemap.status === 200 && locs.includes(`${SITE_URL}/careers/${SLUGS.openEligible}`) && locs.includes(`${SITE_URL}/careers/${SLUGS.openRemote}`) && !locs.some((l) => l.includes(SLUGS.closed) || l.includes(SLUGS.draft)) && pubSitemap.headers['cache-control'] === 'no-cache');
  check('E4', 'indexing disabled', 'public fixture, review build: Job document 200 "noindex, nofollow" without JobPosting or canonical; /sitemap.xml 404',
    'job 200 noindex, nofollow, no JSON-LD, no canonical; sitemap 404', { job: summary(pubReviewJob), sitemap: summary(pubReviewSitemap) },
    pubReviewJob.status === 200 && pubReviewJob.headers['x-robots-tag'] === 'noindex, nofollow' && !/application\/ld\+json/.test(pubReviewJob.body) && !/rel="canonical"/.test(pubReviewJob.body) && pubReviewSitemap.status === 404);
  const rpc = await rendered(browser, 'public-unlisted-careers', '/careers', 'careers');
  const rpj = await rendered(browser, 'public-unlisted-job', `/careers/${SLUGS.openEligible}`, 'job');
  check('E5', 'public', 'public fixture, unlisted visitor: rendered Careers lists the open Jobs; Job Detail shows the Job', 'list (2); job', { careers: rpc, job: rpj }, rpc.state === 'list' && rpc.roleLinks.length === 2 && rpj.state === 'job');

  // E6 — SEO-012 in the public view: publishing, closing and archiving a Job
  // change the sitemap at once. (Moved here from C4-09, whose stack runs in
  // `testers` mode, where the sitemap's public view holds no Job at all.)
  const LIFECYCLE = 'qa-c4-lifecycle';
  const lifecycleEnv = { ...baseEnvironment(), APP_ENV: 'local', NODE_ENV: 'development', MONGODB_URI };
  const lifecycleStates = [];
  for (const [state, file] of [['OPEN', 'qa-c4-lifecycle.json'], ['CLOSED', 'qa-c4-lifecycle.closed.json'], ['ARCHIVED', 'qa-c4-lifecycle.archived.json']]) {
    const run = await runNode(['scripts/provision-job.mjs', 'apply', '--file', path.join(FIXTURES_DIR, 'seo-jobs', file), '--confirm-lifecycle'], { cwd: BACKEND_DIR, env: lifecycleEnv, logFile: path.join(OUT, 'logs', 'setup.log'), label: `provision ${file}` });
    const doc = await exchange(`public-lifecycle-${state.toLowerCase()}-job`, SITE.indexed, `/careers/${LIFECYCLE}`);
    const map = await exchange(`public-lifecycle-${state.toLowerCase()}-sitemap`, SITE.indexed, '/sitemap.xml');
    lifecycleStates.push({ state, provisioned: run.code, status: doc.status, robots: doc.headers['x-robots-tag'] ?? null, inSitemap: map.body.includes(`<loc>${SITE_URL}/careers/${LIFECYCLE}</loc>`) });
  }
  const expectedLifecycle = [
    { state: 'OPEN', provisioned: 0, status: 200, robots: null, inSitemap: true },
    { state: 'CLOSED', provisioned: 0, status: 200, robots: 'noindex, follow', inSitemap: false },
    { state: 'ARCHIVED', provisioned: 0, status: 404, robots: 'noindex, follow', inSitemap: false },
  ];
  check('E6', 'public', 'public fixture: opening, closing and archiving a Job change its document and the sitemap at once (SEO-012)', expectedLifecycle, lifecycleStates,
    JSON.stringify(lifecycleStates) === JSON.stringify(expectedLifecycle));

  /* ====================================================== FAILURE ==== */
  await stop(api);
  api = null;
  const downJob = await exchange('failure-job', SITE.indexed, `/careers/${SLUGS.openEligible}`);
  const downApply = await exchange('failure-apply', SITE.indexed, `/careers/${SLUGS.openEligible}/apply`);
  const downSitemap = await exchange('failure-sitemap', SITE.indexed, '/sitemap.xml');
  const downCareers = await exchange('failure-careers', SITE.indexed, '/careers');
  check('F1', 'failure', 'API down: Job and Apply documents 503 + Retry-After (never 404); sitemap 503; Careers document 200',
    'job 503, apply 503, Retry-After 60; sitemap 503; careers 200',
    { job: summary(downJob), apply: summary(downApply), sitemap: summary(downSitemap), careers: downCareers.status },
    downJob.status === 503 && downJob.headers['retry-after'] === '60' && downApply.status === 503 && downSitemap.status === 503 && downCareers.status === 200);
  const rfc = await rendered(browser, 'failure-careers', '/careers', 'careers');
  const rfj = await rendered(browser, 'failure-job', `/careers/${SLUGS.openEligible}`, 'job');
  check('F2', 'failure', 'API down: rendered Careers shows its ERROR state (not "no open roles"); Job Detail its error state (not "not available")', 'careers error; job error',
    { careers: rfc, job: rfj }, rfc.state === 'error' && rfj.state === 'error');

  /* ============================================== credentials in output == */
  await stop(siteIndexed.child);
  await stop(siteReview.child);
  const leaked = [];
  const addressInLogs = [];
  for (const dir of ['logs', 'http']) {
    for (const file of readdirSync(path.join(OUT, dir))) {
      const text = readFileSync(path.join(OUT, dir, file), 'utf8');
      if (text.includes(KEY) || text.includes(WRONG_KEY)) leaked.push(`${dir}/${file}`);
      if (dir === 'logs' && /^(api|documents)-/.test(file) && (text.includes(LISTED) || text.includes(UNLISTED) || text.includes(SERVICE_EGRESS))) addressInLogs.push(`${dir}/${file}`);
    }
  }
  check('K2', 'credentials', 'The key appears in no log and no raw HTTP file', '0 files', leaked, leaked.length === 0);
  check('K3', 'logs', 'No visitor or service address appears in the API or document-server logs', '0 files', addressInLogs, addressInLogs.length === 0);
} catch (error) {
  check('RUN', 'run', 'The run completed', 'no error', `${error?.stack ?? error}`, false);
} finally {
  await browser?.close().catch(() => {});
  for (const child of [...children]) await stopChild(child).catch(() => {});
  for (const server of servers) await new Promise((resolve) => server.close(resolve));
  try {
    const backendRequire = createRequire(path.join(BACKEND_DIR, 'package.json'));
    const mongoose = backendRequire('mongoose');
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    if (mongoose.connection.db.databaseName === guard.databaseName) await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  } catch {
    // reported by the absence of results
  }
}

const failed = results.filter((r) => !r.pass);
writeFileSync(path.join(OUT, 'results.json'), `${JSON.stringify({ label: args.label, database: guard.databaseName, checks: results.length, failed: failed.length, results }, null, 2)}\n`);
process.stdout.write(`\n${results.length} checks, ${results.length - failed.length} passed, ${failed.length} failed. Evidence: ${OUT}\n`);
process.exit(failed.length === 0 ? 0 : 1);
