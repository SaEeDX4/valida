#!/usr/bin/env node
/**
 * C6-T5 — enforced Content-Security-Policy, document security headers and
 * the release header, checked on the ACTUAL local stack.
 *
 *   MONGODB_TEST_URI=mongodb://127.0.0.1:27017/valida_test_c6t5 \
 *     node c6/c6-t5-stack.mjs --label final --out <evidence directory>
 *
 * WHAT RUNS
 *   - the real API (`backend/src/server.js`, through e2e/support/backendLauncher.mjs
 *     and, for start-up, directly as `npm start` runs it) and the real
 *     document server (`frontend/server/serve.mjs`) over real production
 *     builds, a disposable MongoDB database, local private résumé storage,
 *     synthetic Jobs written through the B3 provisioning tool;
 *   - Chromium (Playwright) for the rendered pages, the Careers → Job → Apply
 *     flow, and the browser's own enforcement of the policy;
 *   - a PROBE server on 127.0.0.1 — an origin the policy does not allow —
 *     that serves a harmless pixel, a harmless script and a framing page, and
 *     records every request it receives.
 *
 * The release header carries the commit under test (`git rev-parse HEAD`,
 * or C6T5_RELEASE for a work-in-progress run), passed to both services as
 * RENDER_GIT_COMMIT, exactly as the host sets it.
 *
 * PARTS
 *   S  start-up: RENDER_GIT_COMMIT absent / valid / malformed, both services,
 *      and the API through its own entry point.
 *   H  headers on every kind of response of both services (QA-040), the
 *      accepted cache rules unchanged, a forged release header ignored.
 *   B  Chromium: every route renders with no CSP violation and its fonts and
 *      stylesheet loaded; the synthetic Careers → Job → Apply flow submits
 *      (record and object checked); the JobPosting data block is present on
 *      an indexable build and raises no violation; the browser BLOCKS a
 *      disallowed image, script, fetch, inline script and framing, and the
 *      probe proves nothing reached it (with a positive control).
 *   R  a private Review: the refusals carry the headers; liveness too.
 *   E  error responses: the document server's 503 with the API stopped.
 *   K  no service key in any evidence file.
 *
 * SYNTHETIC ONLY. Loopback and documentation addresses; a random key per
 * run, shown as [INTERNAL_SERVICE_KEY]; the genuine vacancy is not touched.
 */
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import net from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { checkTestDatabaseTarget } from '../../backend/scripts/test-database.mjs';
import { syntheticPdf } from '../../backend/tests/fixtures/resumeFiles.js';
import { BACKEND_DIR, FIXTURES_DIR, FRONTEND_DIR, REPO_ROOT } from '../support/paths.js';
import { baseEnvironment, runNode, startNode, stopChild, waitForHttp, waitForReadyLine } from '../support/processes.js';

const { values: args } = parseArgs({ options: { label: { type: 'string', default: 'run' }, out: { type: 'string' } } });
const OUT = path.resolve(args.out ?? path.join(os.tmpdir(), `valida-c6-t5-${args.label}`));
for (const dir of ['http', 'screenshots', 'logs', 'startup', 'browser']) mkdirSync(path.join(OUT, dir), { recursive: true });

const guard = checkTestDatabaseTarget({ env: process.env, dotEnvPath: null });
if (!guard.ok) {
  console.error(`refused: ${guard.reason}`);
  process.exit(2);
}
const MONGODB_URI = guard.uri;

const HEAD = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const CLEAN = execFileSync('git', ['-C', REPO_ROOT, 'status', '--porcelain'], { encoding: 'utf8' }).trim() === '';
const RELEASE = process.env.C6T5_RELEASE ?? HEAD;
if (!/^[0-9a-f]{40}$/.test(RELEASE)) {
  console.error('refused: the release under test is not a full SHA');
  process.exit(2);
}

const BASE_PORT = Number(process.env.C6T5_BASE_PORT ?? 4390);
const PORT = { api: BASE_PORT, site: BASE_PORT + 1, probe: BASE_PORT + 2, startup: BASE_PORT + 3 };
const origin = (port) => `http://127.0.0.1:${port}`;
const API = origin(PORT.api);
const SITE = origin(PORT.site);
const PROBE = origin(PORT.probe);
const KEY = `qa-c6t5-${randomBytes(24).toString('hex')}`;
const FORGED = 'ffffffffffffffffffffffffffffffffffffffff';
const PRIVATE = 'private, no-store';

const SLUGS = { open: 'qa-c4-open-remote', closed: 'qa-c4-retained-closed', draft: 'qa-c4-draft', eligible: 'qa-c4-open-eligible' };
const TITLES = { open: 'QA C4 Synthetic Remote Analyst', closed: 'QA C4 Synthetic Retained Closed Role', eligible: 'QA C4 Synthetic Eligible Remote Analyst' };
const PROVISION = [
  ['qa-c4-open-remote.json', true],
  ['qa-c4-retained-closed.json', true],
  ['qa-c4-retained-closed.closed.json', true],
  ['qa-c4-draft.json', false],
  // OD-2026-11-09-02: explicit eligible work countries make this one carry a JobPosting.
  ['qa-c4-open-eligible.json', true],
];

const EXPECTED_CSP = `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self' ${API}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`;
const EXPECTED_API_CSP = "default-src 'none';frame-ancestors 'none';base-uri 'none';form-action 'none'";
const PERMISSIONS = 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()';

const sanitise = (text) => String(text).split(KEY).join('[INTERNAL_SERVICE_KEY]');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const results = [];
function check(id, area, description, expected, actual, pass) {
  results.push({ id, area, description, expected, actual: sanitise(typeof actual === 'string' ? actual : JSON.stringify(actual)), pass: Boolean(pass) });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${description}\n`);
}

/* ----------------------------------------------------------------- HTTP -- */

let exchangeCount = 0;
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
        const requestLines = [`${method} ${target} HTTP/1.1`, `Host: ${hostname}:${port}`, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), ...(body ? [`[body: ${Buffer.byteLength(body)} bytes]`] : [])];
        const responseLines = [`HTTP/1.1 ${res.statusCode} ${res.statusMessage}`, ...Object.entries(res.headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)];
        const shownBody = text.length > 2000 ? `${text.slice(0, 2000)}\n[… ${text.length - 2000} more characters; body SHA-256 ${sha256(text)}]` : text;
        writeFileSync(path.join(OUT, 'http', file), sanitise(`# ${name}\n\n${requestLines.join('\n')}\n\n${responseLines.join('\n')}\n\n${shownBody}\n`));
        resolve({ status: res.statusCode, headers: res.headers, body: text, file });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const docHeaders = (r) => ({
  status: r.status,
  csp: r.headers['content-security-policy'] === EXPECTED_CSP,
  reportOnly: r.headers['content-security-policy-report-only'] ?? null,
  nosniff: r.headers['x-content-type-options'] === 'nosniff',
  referrer: r.headers['referrer-policy'] ?? null,
  permissions: r.headers['permissions-policy'] === PERMISSIONS,
  frame: r.headers['x-frame-options'] ?? null,
  hsts: r.headers['strict-transport-security'] ?? null,
  release: r.headers['x-valida-release'] ?? null,
  cacheControl: r.headers['cache-control'] ?? null,
  file: r.file,
});
const docOk = (h, release = RELEASE) => h.csp && h.reportOnly === null && h.nosniff && h.referrer === 'strict-origin-when-cross-origin' && h.permissions && h.frame === 'DENY' && h.hsts === null && h.release === release;
const apiHeaders = (r) => ({
  status: r.status,
  csp: r.headers['content-security-policy'] ?? null,
  nosniff: r.headers['x-content-type-options'] ?? null,
  hsts: r.headers['strict-transport-security'] ?? null,
  release: r.headers['x-valida-release'] ?? null,
  cacheControl: r.headers['cache-control'] ?? null,
  file: r.file,
});
const apiOk = (h, release = RELEASE) => h.csp === EXPECTED_API_CSP && h.nosniff === 'nosniff' && h.hsts === null && h.release === release;

function multipart(fields, file) {
  const boundary = `----qa${randomBytes(12).toString('hex')}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="resume"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`), file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

/* --------------------------------------------------------------- probe -- */

// An origin the policy does not allow. Everything it serves is harmless; it
// records every request so the evidence can show that a blocked load never
// left the browser.
const probeHits = [];
const probe = createServer((req, res) => {
  probeHits.push({ path: req.url, referer: req.headers.referer ?? null });
  if (req.url.startsWith('/qa-pixel.png')) {
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    return res.end(Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex'));
  }
  if (req.url.startsWith('/qa-script.js')) {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    return res.end('window.__qaProbeScriptRan = true;');
  }
  if (req.url.startsWith('/qa-data')) {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    return res.end('{"qa":true}');
  }
  if (req.url.startsWith('/qa-control.html')) {
    // POSITIVE CONTROL: a page with no policy loads the same pixel.
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(`<!doctype html><title>qa control</title><img id="px" src="${PROBE}/qa-pixel.png?control">`);
  }
  if (req.url.startsWith('/qa-frame.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(`<!doctype html><title>qa frame</title><iframe id="f" src="${SITE}/about" width="400" height="300"></iframe>`);
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('qa');
});

/* ------------------------------------------------------------ processes -- */

const children = new Set();
const launcher = fileURLToPath(new URL('../support/backendLauncher.mjs', import.meta.url));
const serve = path.join(FRONTEND_DIR, 'server', 'serve.mjs');

function apiEnv(extra) {
  return { ...baseEnvironment(), PORT: String(PORT.api), LOG_LEVEL: 'info', MONGODB_URI, CORS_ALLOWED_ORIGINS: SITE, TRANSACTIONAL_EMAIL_PROVIDER: 'none', ...extra };
}
async function startApi(label, extra) {
  const child = startNode([launcher], { cwd: BACKEND_DIR, env: apiEnv(extra), logFile: path.join(OUT, 'logs', `api-${label}.log`) });
  children.add(child);
  await waitForReadyLine(child, { label: `api (${label})`, timeoutMs: 60_000 });
  await waitForHttp(`${API}/api/v1/health`, { child, label: 'api' });
  return child;
}
async function startSite(label, dist, extra) {
  const env = { ...baseEnvironment(), INTERNAL_SERVICE_KEY: KEY, ...extra };
  const child = startNode([serve, '--dist', dist, '--host', '127.0.0.1', '--port', String(PORT.site), '--api-origin', API], { cwd: FRONTEND_DIR, env, logFile: path.join(OUT, 'logs', `documents-${label}.log`) });
  children.add(child);
  const ready = await waitForReadyLine(child, { label: `document server (${label})` });
  return { child, ready };
}
async function stop(child) {
  if (!child) return;
  await stopChild(child);
  children.delete(child);
}
const portOpen = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
/** Starts a service and reports whether it refused (exit, port never open) or started; for a start, also one header read. */
function startupProbe(label, command, cwd, env, healthPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, command, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    let started = false;
    let opened = false;
    let release;
    const poll = setInterval(async () => {
      if (!started && (await portOpen(PORT.startup))) {
        opened = true;
        started = true;
        try {
          const answer = await fetch(`${origin(PORT.startup)}${healthPath}`, { headers: { 'X-Valida-Release': FORGED } });
          release = answer.headers.get('x-valida-release');
        } catch {
          release = 'unreadable';
        }
        child.kill('SIGTERM');
      }
    }, 25);
    const timer = setTimeout(() => child.kill('SIGTERM'), 60_000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('close', (code) => {
      clearInterval(poll);
      clearTimeout(timer);
      writeFileSync(path.join(OUT, 'startup', `${label}.log`), sanitise(output));
      resolve({ outcome: started ? 'started' : `refused (exit ${code})`, opened, release: release ?? null, output: sanitise(output) });
    });
  });
}

/* -------------------------------------------------------------- browser -- */

/** Opens a page with violation and console capture installed before any script runs. */
async function openPage(browser, name) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.__qaViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__qaViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI, disposition: event.disposition, sample: event.sample || '' });
    });
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const failed = [];
  const responses = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') consoleErrors.push({ type: message.type(), text: message.text().slice(0, 300) });
  });
  page.on('requestfailed', (request) => failed.push({ url: request.url().replace(KEY, '[KEY]'), reason: request.failure()?.errorText ?? null }));
  page.on('response', (response) => responses.push({ url: new URL(response.url()).pathname, status: response.status(), type: response.request().resourceType() }));
  return { context, page, consoleErrors, failed, responses, name };
}
async function pageState(handle) {
  const { page } = handle;
  return page.evaluate(async () => {
    await document.fonts.ready;
    const sheets = [...document.styleSheets].filter((s) => s.href && s.href.includes('/assets/'));
    return {
      violations: window.__qaViolations,
      stylesheetLoaded: sheets.length === 1 && sheets[0].cssRules.length > 0,
      fontsLoaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')),
      jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => {
        try {
          return JSON.parse(s.textContent)['@type'];
        } catch {
          return 'unparsable';
        }
      }),
    };
  });
}
async function renderRoute(browser, name, url, until) {
  const handle = await openPage(browser, name);
  const response = await handle.page.goto(url, { waitUntil: 'domcontentloaded' });
  await handle.page.waitForFunction((text) => document.body.innerText.includes(text), until, { timeout: 20_000 }).catch(() => {});
  await handle.page.waitForLoadState('networkidle').catch(() => {});
  const state = await pageState(handle);
  const text = await handle.page.evaluate(() => document.body.innerText);
  await handle.page.screenshot({ path: path.join(OUT, 'screenshots', `${name}.png`) });
  await handle.context.close();
  return { status: response?.status() ?? null, found: text.includes(until), ...state, consoleErrors: handle.consoleErrors, failed: handle.failed, responses: handle.responses.length };
}

/* ------------------------------------------------------------- the run -- */

let browser;
try {
  await new Promise((resolve) => probe.listen(PORT.probe, '127.0.0.1', resolve));

  // 0. Database, indexes, synthetic Jobs.
  const backendRequire = createRequire(path.join(BACKEND_DIR, 'package.json'));
  const mongoose = backendRequire('mongoose');
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.db.databaseName !== guard.databaseName) throw new Error('connected to an unexpected database');
  await mongoose.connection.db.dropDatabase();
  const scriptEnv = { ...baseEnvironment(), APP_ENV: 'local', NODE_ENV: 'development', MONGODB_URI };
  const step = async (label, stepArgs) => {
    const result = await runNode(stepArgs, { cwd: BACKEND_DIR, env: scriptEnv, logFile: path.join(OUT, 'logs', 'setup.log'), label });
    if (result.code !== 0) throw new Error(`setup step failed: ${label}`);
  };
  await step('db:indexes:apply', ['scripts/db-indexes.mjs', 'apply']);
  for (const [file, confirm] of PROVISION) {
    await step(`provision ${file}`, ['scripts/provision-job.mjs', 'apply', '--file', path.join(FIXTURES_DIR, 'seo-jobs', file), ...(confirm ? ['--confirm-lifecycle'] : [])]);
  }
  const applications = () => mongoose.connection.db.collection('applications').countDocuments();

  // Builds: an ordinary (noindex) build and an indexable one; both call the API directly.
  const builds = mkdtempSync(path.join(os.tmpdir(), 'valida-c6t5-builds-'));
  const dist = { plain: path.join(builds, 'plain'), indexed: path.join(builds, 'indexed') };
  const vite = path.join(FRONTEND_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  for (const [name, extra] of [['plain', {}], ['indexed', { VITE_ALLOW_INDEXING: 'true', VITE_PUBLIC_SITE_URL: 'https://cybervalida.com' }]]) {
    const build = await runNode([vite, 'build', '--outDir', dist[name]], { cwd: FRONTEND_DIR, env: { ...baseEnvironment(), VITE_API_BASE_URL: API, ...extra }, logFile: path.join(OUT, 'logs', `build-${name}.log`), label: `build ${name}` });
    if (build.code !== 0) throw new Error(`build failed: ${name}`);
  }
  const asset = readdirSync(path.join(dist.plain, 'assets')).find((f) => f.endsWith('.js'));
  const built = readFileSync(path.join(dist.plain, 'index.html'), 'utf8');
  check('S0', 'inventory', 'The production build loads only same-origin resources: one module script and one stylesheet from /assets/, icons from /brand/, no inline script or style', 'module script + stylesheet under /assets/; no inline <script> body; no <style>; no style= attribute',
    { scripts: [...built.matchAll(/<script[^>]*>/g)].map((m) => m[0]), stylesheets: [...built.matchAll(/<link rel="stylesheet"[^>]*>/g)].map((m) => m[0]), inlineScriptBodies: [...built.matchAll(/<script[^>]*>([^<]+)<\/script>/g)].length, styleElements: (built.match(/<style/g) ?? []).length, styleAttributes: (built.match(/ style=/g) ?? []).length },
    /<script type="module" crossorigin src="\/assets\/index-[\w-]+\.js"><\/script>/.test(built) && [...built.matchAll(/<script[^>]*>([^<]+)<\/script>/g)].length === 0 && !/<style/.test(built) && !/ style=/.test(built));

  /* ================================================= S: START-UP ===== */
  const apiProbeEnv = (extra) => ({ ...apiEnv({ PORT: String(PORT.startup), APP_ENV: 'local', NODE_ENV: 'development', ...extra }) });
  const siteProbeEnv = (extra) => ({ ...baseEnvironment(), INTERNAL_SERVICE_KEY: KEY, ...extra });
  const MALFORMED = [
    ['uppercase', RELEASE.toUpperCase()],
    ['abbreviated (7)', RELEASE.slice(0, 7)],
    ['a branch name', 'qa-branch-main'],
  ];
  const startups = [
    ['S1', 'absent (an ordinary local run)', {}, 'started', null],
    ['S2', 'the full commit SHA', { RENDER_GIT_COMMIT: RELEASE }, 'started', RELEASE],
    ...MALFORMED.map(([label, value], index) => [`S${3 + index}`, `malformed: ${label}`, { RENDER_GIT_COMMIT: value }, 'refused', value]),
  ];
  for (const [id, label, extra, expected, value] of startups) {
    for (const [service, command, cwd, env, health] of [
      ['api (launcher)', [launcher], BACKEND_DIR, apiProbeEnv(extra), '/api/v1/health'],
      ['api (node src/server.js, as npm start)', ['src/server.js'], BACKEND_DIR, apiProbeEnv(extra), '/api/v1/health'],
      ['documents (serve.mjs)', [serve, '--dist', dist.plain, '--host', '127.0.0.1', '--port', String(PORT.startup), '--api-origin', API], FRONTEND_DIR, siteProbeEnv(extra), '/healthz'],
    ]) {
      const tag = service.startsWith('api (node') ? 'npm-start' : service.startsWith('api') ? 'api' : 'documents';
      const result = await startupProbe(`${id}-${tag}`, command, cwd, env, health);
      const pass =
        expected === 'started'
          ? result.outcome === 'started' && result.release === value
          : result.outcome.startsWith('refused') && !result.opened && result.output.includes('RENDER_GIT_COMMIT') && !result.output.includes(value);
      check(`${id}-${tag}`, 'start-up', `${service}: RENDER_GIT_COMMIT ${label}`, expected === 'started' ? `starts; a response (sent a forged X-Valida-Release) carries ${value === null ? 'no release header' : 'the configured SHA'}` : 'refused before listening; names RENDER_GIT_COMMIT; the value is not printed', { outcome: result.outcome, portEverOpened: result.opened, releaseHeader: result.release, log: `startup/${id}-${tag}.log` }, pass);
    }
  }

  /* ============================== H + B: PUBLIC LOCAL STACK ========== */
  browser = await chromium.launch();
  const storage = mkdtempSync(path.join(os.tmpdir(), 'valida-c6t5-storage-'));
  const listFiles = (dir) => {
    let count = 0;
    const walk = (d) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(d, entry.name));
        else count += 1;
      }
    };
    walk(dir);
    return count;
  };
  const localApi = { APP_ENV: 'local', NODE_ENV: 'development', RECRUITMENT_MODE: 'testers', ACCESS_ALLOWLIST: '127.0.0.1/32', INTERNAL_SERVICE_KEY: KEY, RESUME_STORAGE_DRIVER: 'local', RESUME_STORAGE_LOCAL_ROOT: storage, RENDER_GIT_COMMIT: RELEASE };
  let api = await startApi('local', localApi);
  let site = await startSite('local-plain', dist.plain, { RENDER_GIT_COMMIT: RELEASE });
  const apiLog = readFileSync(path.join(OUT, 'logs', 'api-local.log'), 'utf8').split('\n').find((l) => l.includes('"release identity"')) ?? '';
  check('H0', 'release identity', 'Both start-up lines state the commit under test', `api: "release identity" ${RELEASE}; documents READY: release ${RELEASE}, the enforced policy`, { api: apiLog.replace(/"time":\d+,/, ''), documents: { release: site.ready.release, releaseState: site.ready.releaseState, contentSecurityPolicy: site.ready.contentSecurityPolicy } },
    apiLog.includes(`"release":"${RELEASE}"`) && site.ready.release === RELEASE && site.ready.contentSecurityPolicy === EXPECTED_CSP);

  // H1 — every kind of document-server response.
  const DOC_TARGETS = [
    ['home', '/', 200, 'no-cache'],
    ['about', '/about', 200, 'no-cache'],
    ['careers', '/careers', 200, PRIVATE],
    ['job', `/careers/${SLUGS.open}`, 200, PRIVATE],
    ['apply', `/careers/${SLUGS.open}/apply`, 200, PRIVATE],
    ['closed-job', `/careers/${SLUGS.closed}`, 200, PRIVATE],
    ['draft-job-404', `/careers/${SLUGS.draft}`, 404, PRIVATE],
    ['unknown-path-404', '/qa-unknown-path', 404, 'no-cache'],
    ['privacy', '/privacy', 200, 'no-cache'],
    ['legal', '/legal', 200, 'no-cache'],
    ['redirect-301', '/About', 301, 'no-cache'],
    ['robots', '/robots.txt', 200, 'no-cache'],
    ['sitemap-noindex-404', '/sitemap.xml', 404, null],
    ['asset', `/assets/${asset}`, 200, 'public, max-age=31536000, immutable'],
    ['asset-404', '/assets/qa-missing.js', 404, null],
    ['liveness', '/healthz', 200, 'no-store'],
  ];
  const docRows = [];
  for (const [name, target, status, cache] of DOC_TARGETS) {
    const r = await exchange(`H1-documents-${name}`, SITE, target);
    const h = docHeaders(r);
    docRows.push({ target, ...h, ok: r.status === status && docOk(h) && (cache === null || h.cacheControl === cache) });
  }
  const post = await exchange('H1-documents-post-405', SITE, '/', { method: 'POST', headers: { 'content-length': '0' } });
  docRows.push({ target: 'POST /', ...docHeaders(post), ok: post.status === 405 && docOk(docHeaders(post)) });
  const headReq = await exchange('H1-documents-head', SITE, '/about', { method: 'HEAD' });
  docRows.push({ target: 'HEAD /about', ...docHeaders(headReq), ok: headReq.status === 200 && docOk(docHeaders(headReq)) });
  check('H1', 'headers', 'Document server, every kind of response: the enforced CSP, nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options DENY, no HSTS, the release header — and the accepted status and cache rule unchanged (C4, T2)', 'each row ok', docRows, docRows.every((r) => r.ok));

  // H2 — every kind of API response.
  const apiRows = [];
  for (const [name, target, status, opts] of [
    ['health', '/api/v1/health', 200, {}],
    ['ready-503', '/api/v1/health/ready', 503, {}], // truthful: no email transport in this run
    ['jobs', '/api/v1/jobs', 200, {}],
    ['job', `/api/v1/jobs/${SLUGS.open}`, 200, {}],
    ['job-404', `/api/v1/jobs/${SLUGS.draft}`, 404, {}],
    ['unknown-404', '/api/v1/qa-unknown', 404, {}],
    ['preflight', `/api/v1/jobs/${SLUGS.open}/applications`, 204, { method: 'OPTIONS', headers: { origin: SITE, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,idempotency-key' } }],
    ['json-submission-415', `/api/v1/jobs/${SLUGS.open}/applications`, 415, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '2', 'idempotency-key': randomUUID() }, body: '{}' }],
  ]) {
    const r = await exchange(`H2-api-${name}`, API, target, opts);
    const h = apiHeaders(r);
    apiRows.push({ target, ...h, ok: r.status === status && apiOk(h) });
  }
  check('H2', 'headers', 'API, every kind of response (200, readiness 503, 404, preflight 204, a refused submission 415): exactly the declared CSP, nosniff, no HSTS, the release header', 'each row ok', apiRows, apiRows.every((r) => r.ok));

  // H3 — a request cannot name the release.
  const forgedDoc = await exchange('H3-documents-forged-release', SITE, '/', { headers: { 'X-Valida-Release': FORGED } });
  const forgedApi = await exchange('H3-api-forged-release', API, '/api/v1/health', { headers: { 'X-Valida-Release': FORGED } });
  check('H3', 'release identity', 'A request carrying a forged X-Valida-Release gets the configured commit back from both services', `${RELEASE} on both`, { documents: forgedDoc.headers['x-valida-release'], api: forgedApi.headers['x-valida-release'] }, forgedDoc.headers['x-valida-release'] === RELEASE && forgedApi.headers['x-valida-release'] === RELEASE);

  // H4 — the Jobs API stays no-store with no validators (T2), the release on the delegated read path too.
  const jobsApi = await exchange('H4-api-jobs-cache', API, '/api/v1/jobs');
  check('H4', 'cache', 'The Jobs API keeps its accepted cache rule (no-store, no ETag, no Last-Modified)', 'no-store; no validators', { cacheControl: jobsApi.headers['cache-control'], etag: jobsApi.headers.etag ?? null, lastModified: jobsApi.headers['last-modified'] ?? null }, jobsApi.headers['cache-control'] === 'no-store' && !jobsApi.headers.etag && !jobsApi.headers['last-modified']);

  // B1 — every route renders in Chromium with no violation, fonts and stylesheet loaded.
  const routeRows = [];
  for (const [name, target, until] of [
    ['home', '/', 'Valida'],
    ['about', '/about', 'Valida'],
    ['careers', '/careers', TITLES.open],
    ['job', `/careers/${SLUGS.open}`, TITLES.open],
    ['apply', `/careers/${SLUGS.open}/apply`, 'Submit Application'],
    ['closed-job', `/careers/${SLUGS.closed}`, TITLES.closed],
    ['not-found', '/qa-unknown-path', 'This page doesn’t exist.'],
    ['privacy', '/privacy', 'Privacy'],
    ['legal', '/legal', 'Legal'],
  ]) {
    const r = await renderRoute(browser, `B1-${name}`, `${SITE}${target}`, until);
    routeRows.push({ target, status: r.status, found: r.found, violations: r.violations, stylesheetLoaded: r.stylesheetLoaded, fontsLoaded: r.fontsLoaded, consoleErrors: r.consoleErrors, failed: r.failed, ok: r.found && r.violations.length === 0 && r.stylesheetLoaded && r.fontsLoaded.length > 0 && r.failed.length === 0 && r.consoleErrors.filter((e) => /Content Security Policy|Permissions-Policy|Refused/i.test(e.text)).length === 0 });
  }
  writeFileSync(path.join(OUT, 'browser', 'B1-routes.json'), `${JSON.stringify(routeRows, null, 2)}\n`);
  check('B1', 'browser', 'Chromium: every public route renders under the enforced policy — no CSP violation, no policy console message, no failed request, the stylesheet and self-hosted fonts loaded', 'each route ok', routeRows.map(({ target, status, found, violations, stylesheetLoaded, fontsLoaded, failed, ok }) => ({ target, status, found, violations: violations.length, stylesheetLoaded, fonts: fontsLoaded.length, failed: failed.length, ok })), routeRows.every((r) => r.ok));

  // B2 — the synthetic Careers → Job → Apply flow, end to end.
  {
    const before = { applications: await applications(), storedFiles: listFiles(storage) };
    const handle = await openPage(browser, 'B2-flow');
    const { page } = handle;
    const pdf = syntheticPdf();
    await page.goto(`${SITE}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Careers' }).click();
    await page.getByRole('link', { name: `View Role: ${TITLES.open}` }).click();
    await page.getByRole('heading', { level: 1, name: TITLES.open }).waitFor();
    await page.screenshot({ path: path.join(OUT, 'screenshots', 'B2-1-job.png') });
    await page.getByRole('link', { name: 'Apply for This Role' }).first().click();
    await page.getByRole('heading', { level: 1, name: `Apply for ${TITLES.open}` }).waitFor();
    await page.getByLabel('Full Name').fill('QA Test Candidate C6-T5');
    await page.getByLabel('Email Address').fill('qa+c6t5-001@example.test');
    await page.locator('input[type="file"][name="resume"]').setInputFiles({ name: 'qa-c6t5-resume.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.screenshot({ path: path.join(OUT, 'screenshots', 'B2-2-apply-filled.png') });
    const submission = page.waitForResponse((response) => response.url().endsWith(`/api/v1/jobs/${SLUGS.open}/applications`) && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Submit Application' }).click();
    const answered = await submission;
    await page.getByTestId('apply-success').waitFor({ timeout: 20_000 });
    await page.screenshot({ path: path.join(OUT, 'screenshots', 'B2-3-success.png') });
    const state = await pageState(handle);
    await handle.context.close();
    const after = { applications: await applications(), storedFiles: listFiles(storage) };
    const record = await mongoose.connection.db.collection('applications').findOne({}, { sort: { _id: -1 }, projection: { _id: 0, status: 1, 'job.slug': 1, 'resume.sizeBytes': 1, 'resume.checksumSha256': 1 } });
    check('B2', 'flow', 'Chromium, under the enforced policy: Home → Careers → Job Detail → Apply → submit a synthetic application → success; one record and one private object of the same size and checksum; no violation', '201; success shown; applications +1; stored files +1; size and checksum match; 0 violations',
      { submission: { status: answered.status(), release: answered.headers()['x-valida-release'] ?? null }, before, after, record: { status: record?.status, jobSlug: record?.job?.slug, sizeBytes: record?.resume?.sizeBytes, checksumMatches: record?.resume?.checksumSha256 === sha256(pdf) }, violations: state.violations, failed: handle.failed },
      answered.status() === 201 && after.applications === before.applications + 1 && after.storedFiles === before.storedFiles + 1 && record?.resume?.sizeBytes === pdf.length && record?.resume?.checksumSha256 === sha256(pdf) && state.violations.length === 0 && handle.failed.length === 0);
  }

  // B3 — the browser BLOCKS what the policy disallows; the probe proves nothing left the page.
  {
    const control = await openPage(browser, 'B3-control');
    probeHits.length = 0;
    await control.page.goto(`${PROBE}/qa-control.html`);
    await control.page.waitForFunction(() => document.getElementById('px').complete);
    const controlLoaded = await control.page.evaluate(() => document.getElementById('px').naturalWidth);
    await control.context.close();
    const controlHits = probeHits.filter((h) => h.path.startsWith('/qa-pixel.png')).length;

    probeHits.length = 0;
    const handle = await openPage(browser, 'B3-blocked');
    await handle.page.goto(`${SITE}/about`, { waitUntil: 'networkidle' });
    const attempt = await handle.page.evaluate(async (probeOrigin) => {
      const outcome = {};
      const img = document.createElement('img');
      img.src = `${probeOrigin}/qa-pixel.png?blocked`;
      document.body.append(img);
      outcome.image = await new Promise((resolve) => {
        img.onload = () => resolve('loaded');
        img.onerror = () => resolve('blocked');
        setTimeout(() => resolve('timeout'), 3000);
      });
      const external = document.createElement('script');
      external.src = `${probeOrigin}/qa-script.js`;
      document.body.append(external);
      outcome.externalScript = await new Promise((resolve) => {
        external.onload = () => resolve('ran');
        external.onerror = () => resolve('blocked');
        setTimeout(() => resolve('timeout'), 3000);
      });
      const inline = document.createElement('script');
      inline.textContent = 'window.__qaInlineRan = true;';
      document.body.append(inline);
      await new Promise((r) => setTimeout(r, 100));
      outcome.inlineScript = window.__qaInlineRan === true ? 'ran' : 'blocked';
      try {
        await fetch(`${probeOrigin}/qa-data`);
        outcome.fetch = 'allowed';
      } catch {
        outcome.fetch = 'blocked';
      }
      try {
        // eslint-disable-next-line no-eval
        eval('1');
        outcome.eval = 'ran';
      } catch {
        outcome.eval = 'blocked';
      }
      outcome.probeScriptRan = window.__qaProbeScriptRan === true;
      await new Promise((r) => setTimeout(r, 300));
      outcome.violations = window.__qaViolations;
      return outcome;
    }, PROBE);
    await handle.page.screenshot({ path: path.join(OUT, 'screenshots', 'B3-about-after-blocked-attempts.png') });
    await handle.context.close();
    const blockedHits = [...probeHits];

    // Framing: a page on another origin tries to frame the site.
    const framing = await openPage(browser, 'B3-frame');
    await framing.page.goto(`${PROBE}/qa-frame.html`);
    await framing.page.waitForTimeout(1500);
    const framedText = await framing.page
      .frameLocator('#f')
      .locator('body')
      .innerText({ timeout: 1500 })
      .catch(() => null);
    await framing.page.screenshot({ path: path.join(OUT, 'screenshots', 'B3-framing-refused.png') });
    await framing.context.close();
    const directives = attempt.violations.map((v) => v.directive);
    writeFileSync(path.join(OUT, 'browser', 'B3-blocked.json'), `${JSON.stringify({ control: { loadedWidth: controlLoaded, probeHits: controlHits }, attempt, probeHitsWhileBlocked: blockedHits, framing: { framedText, console: framing.consoleErrors } }, null, 2)}\n`);
    check('B3', 'browser', 'Chromium BLOCKS what the policy disallows: an image, an external script and a fetch to another origin, an inline script, eval, and framing by another origin — and the disallowed origin receives no request (positive control: the same pixel loads, and reaches the probe, from a page without the policy)',
      'control: pixel loaded, 1 probe hit; under the policy: image/script/fetch/inline/eval blocked; violations img-src, script-src-elem, connect-src; 0 probe hits; the framed page not rendered, a frame-ancestors refusal logged',
      { control: { loadedWidth: controlLoaded, probeHits: controlHits }, outcome: { image: attempt.image, externalScript: attempt.externalScript, inlineScript: attempt.inlineScript, fetch: attempt.fetch, eval: attempt.eval, probeScriptRan: attempt.probeScriptRan }, violatedDirectives: directives, probeHitsWhileBlocked: blockedHits.length, framing: { framedText, refusal: framing.consoleErrors.map((e) => e.text).filter((t) => /frame-ancestors/.test(t)) } },
      controlLoaded === 1 && controlHits === 1 && attempt.image === 'blocked' && attempt.externalScript === 'blocked' && attempt.inlineScript === 'blocked' && attempt.fetch === 'blocked' && attempt.eval === 'blocked' && !attempt.probeScriptRan &&
        ['img-src', 'script-src-elem', 'connect-src'].every((d) => directives.includes(d)) && blockedHits.length === 0 && !framedText && framing.consoleErrors.some((e) => /frame-ancestors/.test(e.text)));
  }

  // B4 — an indexable build: JobPosting data block and SEO head, no violation.
  await stop(site.child);
  site = await startSite('local-indexed', dist.indexed, { RENDER_GIT_COMMIT: RELEASE });
  {
    const jobDoc = await exchange('B4-indexed-job-document', SITE, `/careers/${SLUGS.eligible}`);
    const sitemap = await exchange('B4-indexed-sitemap', SITE, '/sitemap.xml');
    const r = await renderRoute(browser, 'B4-indexed-job', `${SITE}/careers/${SLUGS.eligible}`, TITLES.eligible);
    const head = jobDoc.body.slice(0, jobDoc.body.indexOf('</head>'));
    check('B4', 'seo', 'Indexable build under the policy: the Job document keeps its canonical and JobPosting data block in the initial HTML; Chromium raises no violation for it; the sitemap still answers (C4 behaviour unchanged; the full C4 suite is rerun separately)', 'canonical + JobPosting in the head; JSON-LD JobPosting in the page; 0 violations; sitemap 200 with the headers',
      { canonical: /<link rel="canonical" href="https:\/\/cybervalida\.com\/careers\/qa-c4-open-eligible">/.test(head), jsonLdInHead: head.includes('application/ld+json'), pageJsonLd: r.jsonLd, violations: r.violations, sitemap: docHeaders(sitemap) },
      /<link rel="canonical" href="https:\/\/cybervalida\.com\/careers\/qa-c4-open-eligible">/.test(head) && head.includes('"@type":"JobPosting"') && r.jsonLd.includes('JobPosting') && r.violations.length === 0 && sitemap.status === 200 && docOk(docHeaders(sitemap)));
  }

  // E — error responses: the API stopped; the document server answers 503.
  await stop(api);
  api = null;
  {
    const down = await exchange('E1-documents-job-api-down', SITE, `/careers/${SLUGS.open}`);
    const h = docHeaders(down);
    check('E1', 'error', 'With the API stopped, a Job document is 503 with Retry-After — and still carries the policy, the security headers and the release header', '503 + Retry-After; headers ok', { ...h, retryAfter: down.headers['retry-after'] ?? null }, down.status === 503 && Boolean(down.headers['retry-after']) && docOk(h));
  }
  await stop(site.child);

  /* ============================================ R: PRIVATE REVIEW ===== */
  // 127.0.0.1 is NOT on this list: every request of this run is an unlisted visitor's.
  api = await startApi('review', { APP_ENV: 'review', NODE_ENV: 'production', SITE_ACCESS: 'private', ACCESS_ALLOWLIST: '203.0.113.0/24', RECRUITMENT_MODE: 'testers', INTERNAL_SERVICE_KEY: KEY, RENDER_GIT_COMMIT: RELEASE });
  site = await startSite('review', dist.plain, { APP_ENV: 'review', SITE_ACCESS: 'private', ACCESS_ALLOWLIST: '203.0.113.0/24', RENDER_GIT_COMMIT: RELEASE });
  {
    const rows = [];
    for (const [name, base, target, status, kind] of [
      ['documents-home-403', SITE, '/', 403, 'doc'],
      ['documents-job-403', SITE, `/careers/${SLUGS.open}`, 403, 'doc'],
      ['documents-asset-403', SITE, `/assets/${asset}`, 403, 'doc'],
      ['documents-liveness-200', SITE, '/healthz', 200, 'doc'],
      ['api-jobs-403', API, '/api/v1/jobs', 403, 'api'],
      ['api-ready-403', API, '/api/v1/health/ready', 403, 'api'],
      ['api-liveness-200', API, '/api/v1/health', 200, 'api'],
    ]) {
      const r = await exchange(`R1-${name}`, base, target);
      const h = kind === 'doc' ? docHeaders(r) : apiHeaders(r);
      rows.push({ target: `${kind} ${target}`, ...h, ok: r.status === status && (kind === 'doc' ? docOk(h) : apiOk(h)) && (status === 403 ? h.cacheControl === PRIVATE : true) });
    }
    const r = await renderRoute(browser, 'R1-refused-in-chromium', `${SITE}/careers`, 'Forbidden');
    check('R1', 'private review', 'Private Review, unlisted visitor: the 403 refusals of both services (and liveness) carry the headers and the release; the private cache rule is unchanged; in Chromium the page is "Forbidden" with no violation', 'each row ok; Chromium 403, 0 violations',
      { rows, chromium: { status: r.status, found: r.found, violations: r.violations, responses: r.responses } }, rows.every((x) => x.ok) && r.status === 403 && r.found && r.violations.length === 0);
  }
  await stop(site.child);
  await stop(api);
  api = null;

  /* ============================================ K: CREDENTIALS ======== */
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!entry.name.endsWith('.png')) files.push(full);
    }
  };
  walk(OUT);
  const withKey = files.filter((f) => readFileSync(f, 'utf8').includes(KEY));
  check('K1', 'credentials', 'The service key appears in no evidence file', '0 files', `${withKey.length} files`, withKey.length === 0);
  await mongoose.disconnect();
} catch (error) {
  check('X', 'harness', 'The stack check ran to completion', 'no error', String(error?.stack ?? error), false);
} finally {
  await browser?.close().catch(() => {});
  for (const child of [...children]) await stop(child);
  await new Promise((resolve) => probe.close(resolve));
  const failed = results.filter((r) => !r.pass).length;
  writeFileSync(path.join(OUT, 'results.json'), `${JSON.stringify({ label: args.label, release: RELEASE, head: HEAD, worktreeClean: CLEAN, database: guard.databaseName, checks: results.length, failed, results }, null, 2)}\n`);
  process.stdout.write(`\n${results.length} checks, ${results.length - failed} passed, ${failed} failed. Release under test ${RELEASE} (HEAD ${HEAD}, worktree clean: ${CLEAN}). Evidence: ${OUT}\n`);
  process.exit(failed === 0 ? 0 : 1);
}
