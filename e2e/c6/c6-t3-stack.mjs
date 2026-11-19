#!/usr/bin/env node
/**
 * C6-T3 — whole-site private access, checked on the ACTUAL local stack.
 *
 *   MONGODB_TEST_URI=mongodb://127.0.0.1:27017/valida_test_c6t3 \
 *     node c6/c6-t3-stack.mjs --label final --out <evidence directory>
 *
 * WHAT RUNS
 *   - the real API (`backend/src/server.js` through e2e/support/backendLauncher.mjs)
 *     and the real document server (`frontend/server/serve.mjs`) over real
 *     production builds, against a disposable MongoDB database, with
 *     synthetic Jobs written through the B3 provisioning tool;
 *   - Chromium (Playwright) for the rendered pages;
 *   - local proxies standing in for a host's proxy (each appends the address
 *     it is told to X-Forwarded-For), exactly as in the C6-T2 stack check.
 *     Both services run with TRUST_PROXY=1:
 *
 *     client ──> SITE proxy (appends the visitor) ──> document server ──> SERVICE proxy (appends 203.0.113.250) ──> API
 *     client ──> API proxy  (appends the visitor) ────────────────────────────────────────────────────────────────> API
 *
 *   203.0.113.250, the document server's own egress, is LISTED on purpose:
 *   a delegated read must be admitted for its end visitor, never for its peer.
 *
 * PARTS
 *   S  start-up: every APP_ENV x SITE_ACCESS x allowlist combination, both
 *      services — refused before listening, or started.
 *   R  APP_ENV=review, SITE_ACCESS=private, RECRUITMENT_MODE=testers, a review
 *      (noindex) build: liveness, denials, listed access, delegation, cache
 *      isolation, rendering.
 *   L  APP_ENV=local, SITE_ACCESS=private, with local résumé storage: a listed
 *      visitor completes an application; an unlisted one is refused before the
 *      body is read, with no record, object, temporary file or notification.
 *   K  the service key in no evidence file; no address in any service log.
 *
 * WHAT IT DOES NOT SHOW
 *   A real hosting proxy, real addresses, a real edge cache: gate G-ACCESS,
 *   per hostname, before any synthetic Job is provisioned there.
 *
 * SYNTHETIC ONLY. Documentation addresses (RFC 5737); a random key per run,
 * shown as [INTERNAL_SERVICE_KEY]; the genuine vacancy is not touched.
 */
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import net from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { checkTestDatabaseTarget } from '../../backend/scripts/test-database.mjs';
import { syntheticPdf } from '../../backend/tests/fixtures/resumeFiles.js';
import { BACKEND_DIR, FIXTURES_DIR, FRONTEND_DIR } from '../support/paths.js';
import { baseEnvironment, runNode, startNode, stopChild, waitForHttp, waitForReadyLine } from '../support/processes.js';

const { values: args } = parseArgs({ options: { label: { type: 'string', default: 'run' }, out: { type: 'string' } } });
const OUT = path.resolve(args.out ?? path.join(os.tmpdir(), `valida-c6-t3-${args.label}`));
for (const dir of ['http', 'screenshots', 'logs', 'startup']) mkdirSync(path.join(OUT, dir), { recursive: true });

const guard = checkTestDatabaseTarget({ env: process.env, dotEnvPath: null });
if (!guard.ok) {
  console.error(`refused: ${guard.reason}`);
  process.exit(2);
}
const MONGODB_URI = guard.uri;

const BASE_PORT = Number(process.env.C6T3_BASE_PORT ?? 4360);
const PORT = {
  api: BASE_PORT,
  site: BASE_PORT + 1,
  apiProxy: BASE_PORT + 2,
  siteProxy: BASE_PORT + 3,
  serviceProxy: BASE_PORT + 4,
  probe: BASE_PORT + 5,
};
const origin = (port) => `http://127.0.0.1:${port}`;
const API_PROXY = origin(PORT.apiProxy);
const SITE = origin(PORT.siteProxy);
const SERVICE = origin(PORT.serviceProxy);

const LISTED = '203.0.113.7';
const UNLISTED = '192.0.2.44';
const SERVICE_EGRESS = '203.0.113.250';
const ALLOWLIST = '203.0.113.0/24';
const KEY = `qa-c6t3-${randomBytes(24).toString('hex')}`;
const WRONG_KEY = `qa-c6t3-${randomBytes(24).toString('hex')}`;
const PRIVATE = 'private, no-store';
const DENIAL_MESSAGE = 'We couldn’t complete this request. Please try again.';

const SLUGS = { open: 'qa-c4-open-remote', closed: 'qa-c4-retained-closed', draft: 'qa-c4-draft' };
const TITLES = { open: 'QA C4 Synthetic Remote Analyst', closed: 'QA C4 Synthetic Retained Closed Role', draft: 'QA C4 Synthetic Draft Role' };
const PROVISION = [
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
function startProxy({ port, upstreamPort, appended }) {
  const server = createServer((req, res) => {
    const headers = { ...req.headers };
    const add = appended();
    if (add) headers['x-forwarded-for'] = headers['x-forwarded-for'] ? `${headers['x-forwarded-for']}, ${add}` : add;
    const upstream = httpRequest({ host: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url, headers }, (answer) => {
      res.writeHead(answer.statusCode, answer.headers);
      answer.pipe(res);
    });
    // Send the request head at once, as a real proxy does: an upstream that
    // answers before the body arrives must be able to.
    upstream.flushHeaders();
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
        const shownHeaders = Object.entries(headers).map(([k, v]) => `${k}: ${v}`);
        const requestLines = [`${method} ${target} HTTP/1.1`, `Host: ${hostname}:${port}`, ...shownHeaders, ...(body ? [`[body: ${Buffer.byteLength(body)} bytes]`] : [])];
        const responseLines = [`HTTP/1.1 ${res.statusCode} ${res.statusMessage}`, ...Object.entries(res.headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)];
        const shownBody = text.length > 4000 ? `${text.slice(0, 4000)}\n[… ${text.length - 4000} more characters; body SHA-256 ${sha256(text)}]` : text;
        writeFileSync(path.join(OUT, 'http', file), sanitise(`# ${name}\n# via ${base} (visitor appended by the proxy: ${base === SITE || base === API_PROXY ? visitor.address : base === SERVICE ? SERVICE_EGRESS : 'none'})\n\n${requestLines.join('\n')}\n\n${responseLines.join('\n')}\n\n${shownBody}\n`));
        resolve({ status: res.statusCode, headers: res.headers, body: text, file });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const summary = (r) => ({
  status: r.status,
  cacheControl: r.headers['cache-control'] ?? null,
  etag: r.headers.etag ?? null,
  lastModified: r.headers['last-modified'] ?? null,
  audience: r.headers['x-valida-audience'] ?? null,
  location: r.headers.location ?? null,
  bodyBytes: Buffer.byteLength(r.body),
  bodySha256: sha256(r.body).slice(0, 16),
  file: r.file,
});
const isPrivate = (r) => r.headers['cache-control'] === PRIVATE && !r.headers.etag && !r.headers['last-modified'];
const apiDenied = (r) => {
  if (r.status !== 403 || !isPrivate(r)) return false;
  if (r.body === '') return true; // HEAD
  try {
    const body = JSON.parse(r.body);
    return body.success === false && body.error.code === 'AUTHORIZATION_DENIED' && body.error.message === DENIAL_MESSAGE && Object.keys(body.error).length === 2 && typeof body.meta.requestId === 'string';
  } catch {
    return false;
  }
};
const docDenied = (r, method = 'GET') => r.status === 403 && isPrivate(r) && r.body === (method === 'HEAD' ? '' : 'Forbidden') && r.headers['content-type'] === 'text/plain; charset=utf-8' && !r.headers.location;
const discloses = (body) => Object.values(SLUGS).some((s) => body.includes(s)) || Object.values(TITLES).some((t) => body.includes(t));

/** Headers only: a large body is announced, and not one byte of it is sent. Returns the raw answer. */
function announceLargeUpload(name, port, target) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1', allowHalfOpen: true });
    const received = [];
    let closed = false;
    socket.on('data', (chunk) => received.push(chunk));
    socket.on('close', () => {
      closed = true;
    });
    socket.on('error', () => {});
    socket.once('connect', async () => {
      const head = `POST ${target} HTTP/1.1\r\nHost: qa\r\nContent-Type: multipart/form-data; boundary=----qa\r\nIdempotency-Key: ${randomUUID()}\r\nContent-Length: ${5 * 1024 * 1024}\r\n\r\n`;
      socket.write(head);
      const deadline = Date.now() + 5000;
      const text = () => Buffer.concat(received).toString('latin1');
      while (Date.now() < deadline && !/\r\n\r\n.+/s.test(text())) await new Promise((r) => setTimeout(r, 10));
      await new Promise((r) => setTimeout(r, 300));
      exchangeCount += 1;
      const file = `${String(exchangeCount).padStart(3, '0')}-${name}.txt`;
      writeFileSync(path.join(OUT, 'http', file), sanitise(`# ${name}\n# raw socket to 127.0.0.1:${port}; only the request head was sent (Content-Length announced: 5 MiB, 0 body bytes sent)\n\n${head}\n--- response ---\n${text()}\n--- connection closed by server: ${closed} ---\n`));
      socket.destroy();
      resolve({ text: text(), closed, file });
    });
  });
}

function multipart(fields, file) {
  const boundary = `----qa${randomBytes(12).toString('hex')}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="resume"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`), file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

/* ------------------------------------------------------------ processes -- */

const children = new Set();
const launcher = fileURLToPath(new URL('../support/backendLauncher.mjs', import.meta.url));
const serve = path.join(FRONTEND_DIR, 'server', 'serve.mjs');

function apiEnv(extra) {
  return {
    ...baseEnvironment(),
    PORT: String(PORT.api),
    LOG_LEVEL: 'info',
    MONGODB_URI,
    CORS_ALLOWED_ORIGINS: SITE,
    TRUST_PROXY: '1',
    TRANSACTIONAL_EMAIL_PROVIDER: 'none',
    ...extra,
  };
}

async function startApi(label, extra) {
  const child = startNode([launcher], { cwd: BACKEND_DIR, env: apiEnv(extra), logFile: path.join(OUT, 'logs', `api-${label}.log`) });
  children.add(child);
  await waitForReadyLine(child, { label: `api (${label})`, timeoutMs: 60_000 });
  await waitForHttp(`${origin(PORT.api)}/api/v1/health`, { child, label: 'api' });
  return child;
}

async function startSite(label, dist, extra) {
  const env = { ...baseEnvironment(), TRUST_PROXY: '1', INTERNAL_SERVICE_KEY: KEY, ...extra };
  const child = startNode([serve, '--dist', dist, '--host', '127.0.0.1', '--port', String(PORT.site), '--api-origin', SERVICE], { cwd: FRONTEND_DIR, env, logFile: path.join(OUT, 'logs', `documents-${label}.log`) });
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

/** Starts a service with `env` and reports whether it refused (exit, port never open) or started (READY). */
function startupProbe(label, command, cwd, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, command, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    let ready = false;
    let opened = false;
    const settle = async (outcome) => {
      clearTimeout(timer);
      writeFileSync(path.join(OUT, 'startup', `${label}.log`), sanitise(output));
      resolve({ outcome, output: sanitise(output), opened });
    };
    const poll = setInterval(async () => {
      if (await portOpen(PORT.probe)) {
        opened = true;
        // `node src/server.js` (npm start) prints no READY line: a listening port is the start.
        if (!ready) {
          ready = true;
          child.kill('SIGTERM');
        }
      }
    }, 25);
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, 60_000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (!ready && /READY /.test(output)) {
        ready = true;
        child.kill('SIGTERM');
      }
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('close', async (code) => {
      clearInterval(poll);
      await settle(ready ? 'started' : `refused (exit ${code})`);
    });
  });
}

/* -------------------------------------------------------------- browser -- */

async function rendered(browser, name, pathname, until) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const responses = [];
  page.on('response', (response) => responses.push({ url: new URL(response.url()).pathname, status: response.status() }));
  const response = await page.goto(`${SITE}${pathname}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((text) => document.body.innerText.includes(text), until, { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(300);
  const text = await page.evaluate(() => document.body.innerText);
  await page.screenshot({ path: path.join(OUT, 'screenshots', `${name}.png`) });
  await context.close();
  return { status: response?.status() ?? null, found: text.includes(until), text: text.slice(0, 200), responses };
}

/* ------------------------------------------------------------- the run -- */

let browser;
const servers = [];
try {
  // 0. Database, indexes, synthetic Jobs.
  const backendRequire = createRequire(path.join(BACKEND_DIR, 'package.json'));
  const mongoose = backendRequire('mongoose');
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.db.databaseName !== guard.databaseName) throw new Error('connected to an unexpected database');
  await mongoose.connection.db.dropDatabase();
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
  const applications = () => mongoose.connection.db.collection('applications').countDocuments();

  // Builds: a review build (indexing disabled) and an indexable one (for the refusal check).
  const builds = mkdtempSync(path.join(os.tmpdir(), 'valida-c6t3-builds-'));
  const dist = { review: path.join(builds, 'review'), indexed: path.join(builds, 'indexed') };
  const vite = path.join(FRONTEND_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  for (const [name, extra] of [['review', {}], ['indexed', { VITE_ALLOW_INDEXING: 'true', VITE_PUBLIC_SITE_URL: 'https://cybervalida.com' }]]) {
    const build = await runNode([vite, 'build', '--outDir', dist[name]], { cwd: FRONTEND_DIR, env: { ...baseEnvironment(), VITE_API_BASE_URL: API_PROXY, ...extra }, logFile: path.join(OUT, 'logs', `build-${name}.log`), label: `build ${name}` });
    if (build.code !== 0) throw new Error(`build failed: ${name}`);
  }
  const asset = readdirSync(path.join(dist.review, 'assets')).find((f) => f.endsWith('.js'));

  /* ================================================= S: START-UP ===== */
  const apiProbe = (extra) => ({ ...apiEnv({ PORT: String(PORT.probe), ...extra }) });
  const siteProbe = (extra) => ({ ...baseEnvironment(), TRUST_PROXY: '1', INTERNAL_SERVICE_KEY: KEY, ...extra });
  const REVIEW_API = { APP_ENV: 'review', NODE_ENV: 'production' };
  const STARTUP = [
    ['S1', 'api', 'local, SITE_ACCESS absent (the development default)', { APP_ENV: 'local', NODE_ENV: 'development' }, 'started'],
    ['S2', 'api', 'local, private, valid list', { APP_ENV: 'local', NODE_ENV: 'development', SITE_ACCESS: 'private', ACCESS_ALLOWLIST: ALLOWLIST }, 'started'],
    ['S3', 'api', 'review, private, valid list', { ...REVIEW_API, SITE_ACCESS: 'private', ACCESS_ALLOWLIST: ALLOWLIST }, 'started'],
    ['S4', 'api', 'production, public', { APP_ENV: 'production', NODE_ENV: 'production', SITE_ACCESS: 'public' }, 'started'],
    ['S5', 'api', 'review, SITE_ACCESS absent', { ...REVIEW_API, ACCESS_ALLOWLIST: ALLOWLIST }, 'refused', 'SITE_ACCESS'],
    ['S6', 'api', 'review, public', { ...REVIEW_API, SITE_ACCESS: 'public', ACCESS_ALLOWLIST: ALLOWLIST }, 'refused', 'SITE_ACCESS'],
    ['S7', 'api', 'review, private, no list', { ...REVIEW_API, SITE_ACCESS: 'private' }, 'refused', 'ACCESS_ALLOWLIST'],
    ['S8', 'api', 'review, private, a list broader than /8', { ...REVIEW_API, SITE_ACCESS: 'private', ACCESS_ALLOWLIST: '198.0.0.0/7' }, 'refused', 'ACCESS_ALLOWLIST'],
    ['S9', 'api', 'production, private', { APP_ENV: 'production', NODE_ENV: 'production', SITE_ACCESS: 'private', ACCESS_ALLOWLIST: ALLOWLIST }, 'refused', 'SITE_ACCESS'],
    ['S10', 'api', 'local, "Private" (wrong case)', { APP_ENV: 'local', NODE_ENV: 'development', SITE_ACCESS: 'Private', ACCESS_ALLOWLIST: ALLOWLIST }, 'refused', 'SITE_ACCESS'],
    // Correction 1 (plan 4.6.2): production requires the explicit literal "public".
    ['S20', 'api', 'production, SITE_ACCESS absent', { APP_ENV: 'production', NODE_ENV: 'production' }, 'refused', 'SITE_ACCESS'],
    ['S21', 'api', 'production, SITE_ACCESS empty', { APP_ENV: 'production', NODE_ENV: 'production', SITE_ACCESS: '' }, 'refused', 'SITE_ACCESS'],
    ['S22', 'api', 'production, public, RECRUITMENT_MODE=public without its authorisation (independent: starts, recruitment closed)', { APP_ENV: 'production', NODE_ENV: 'production', SITE_ACCESS: 'public', RECRUITMENT_MODE: 'public' }, 'started'],
  ];
  const SITE_STARTUP = [
    ['S11', 'documents', 'local, SITE_ACCESS absent, indexable build', 'indexed', { }, 'started'],
    ['S12', 'documents', 'review, private, valid list, review build', 'review', { APP_ENV: 'review', SITE_ACCESS: 'private', ACCESS_ALLOWLIST: ALLOWLIST }, 'started'],
    ['S13', 'documents', 'production, public, indexable build', 'indexed', { APP_ENV: 'production', SITE_ACCESS: 'public' }, 'started'],
    ['S14', 'documents', 'review, SITE_ACCESS absent', 'review', { APP_ENV: 'review', ACCESS_ALLOWLIST: ALLOWLIST }, 'refused', 'SITE_ACCESS'],
    ['S15', 'documents', 'review, public', 'review', { APP_ENV: 'review', SITE_ACCESS: 'public' }, 'refused', 'SITE_ACCESS'],
    ['S16', 'documents', 'review, private, no list', 'review', { APP_ENV: 'review', SITE_ACCESS: 'private' }, 'refused', 'ACCESS_ALLOWLIST'],
    ['S17', 'documents', 'review, private, an indexable build', 'indexed', { APP_ENV: 'review', SITE_ACCESS: 'private', ACCESS_ALLOWLIST: ALLOWLIST }, 'refused', 'APP_ENV'],
    ['S18', 'documents', 'production, private', 'indexed', { APP_ENV: 'production', SITE_ACCESS: 'private', ACCESS_ALLOWLIST: ALLOWLIST }, 'refused', 'SITE_ACCESS'],
    ['S19', 'documents', 'local, " private" (padded)', 'review', { SITE_ACCESS: ' private', ACCESS_ALLOWLIST: ALLOWLIST }, 'refused', 'SITE_ACCESS'],
    ['S23', 'documents', 'production, SITE_ACCESS absent', 'indexed', { APP_ENV: 'production' }, 'refused', 'SITE_ACCESS'],
    ['S24', 'documents', 'production, SITE_ACCESS empty', 'indexed', { APP_ENV: 'production', SITE_ACCESS: '' }, 'refused', 'SITE_ACCESS'],
  ];
  for (const [id, service, label, extra, expected, variable] of STARTUP) {
    const probe = await startupProbe(`${id}-api`, [launcher], BACKEND_DIR, apiProbe(extra));
    const ok = expected === 'started' ? probe.outcome === 'started' : probe.outcome.startsWith('refused') && !probe.opened && probe.output.includes(variable) && !probe.output.includes('203.0.113') && !probe.output.includes('198.0.0.0');
    check(id, 'start-up', `${service}: ${label}`, expected === 'started' ? 'starts' : `refused before listening, naming ${variable}, no value printed`, { outcome: probe.outcome, portEverOpened: probe.opened, log: `startup/${id}-api.log` }, ok);
  }
  for (const [id, service, label, build, extra, expected, variable] of SITE_STARTUP) {
    const probe = await startupProbe(`${id}-documents`, [serve, '--dist', dist[build], '--host', '127.0.0.1', '--port', String(PORT.probe), '--api-origin', SERVICE], FRONTEND_DIR, siteProbe(extra));
    const ok = expected === 'started' ? probe.outcome === 'started' : probe.outcome.startsWith('refused') && !probe.opened && probe.output.includes(variable) && !probe.output.includes('203.0.113');
    check(id, 'start-up', `${service}: ${label}`, expected === 'started' ? 'starts' : `refused before listening, naming ${variable}, no value printed`, { outcome: probe.outcome, portEverOpened: probe.opened, log: `startup/${id}-documents.log` }, ok);
  }

  // The backend's own entry point, exactly as `npm start` runs it (node src/server.js), not the e2e launcher.
  const ENTRY = [
    ['S25', 'production, SITE_ACCESS absent', { APP_ENV: 'production', NODE_ENV: 'production' }, 'refused', 'SITE_ACCESS'],
    ['S26', 'production, SITE_ACCESS empty', { APP_ENV: 'production', NODE_ENV: 'production', SITE_ACCESS: '' }, 'refused', 'SITE_ACCESS'],
    ['S27', 'production, public (positive control)', { APP_ENV: 'production', NODE_ENV: 'production', SITE_ACCESS: 'public' }, 'started'],
    ['S28', 'local, SITE_ACCESS absent (the accepted default)', { APP_ENV: 'local', NODE_ENV: 'development' }, 'started'],
    ['S29', 'review, private, valid list', { ...REVIEW_API, SITE_ACCESS: 'private', ACCESS_ALLOWLIST: ALLOWLIST }, 'started'],
  ];
  for (const [id, label, extra, expected, variable] of ENTRY) {
    const probe = await startupProbe(`${id}-api-npm-start`, ['src/server.js'], BACKEND_DIR, apiProbe(extra));
    const ok = expected === 'started' ? probe.outcome === 'started' && probe.opened : probe.outcome.startsWith('refused') && !probe.opened && probe.output.includes(variable) && !probe.output.includes('203.0.113');
    check(id, 'start-up', `api via node src/server.js (npm start): ${label}`, expected === 'started' ? 'listens' : `refused before listening, naming ${variable}, no value printed`, { outcome: probe.outcome, portEverOpened: probe.opened, log: `startup/${id}-api-npm-start.log` }, ok);
  }

  /* ========================================= R: PRIVATE REVIEW ======= */
  servers.push(await startProxy({ port: PORT.apiProxy, upstreamPort: PORT.api, appended: () => visitor.address }));
  servers.push(await startProxy({ port: PORT.siteProxy, upstreamPort: PORT.site, appended: () => visitor.address }));
  servers.push(await startProxy({ port: PORT.serviceProxy, upstreamPort: PORT.api, appended: () => SERVICE_EGRESS }));
  browser = await chromium.launch();

  let api = await startApi('review', { ...REVIEW_API, SITE_ACCESS: 'private', ACCESS_ALLOWLIST: ALLOWLIST, RECRUITMENT_MODE: 'testers', INTERNAL_SERVICE_KEY: KEY });
  let site = await startSite('review', dist.review, { APP_ENV: 'review', SITE_ACCESS: 'private', ACCESS_ALLOWLIST: ALLOWLIST });
  const apiLine = readFileSync(path.join(OUT, 'logs', 'api-review.log'), 'utf8').split('\n').find((l) => l.includes('"site access"')) ?? '';
  check('R0', 'start-up', 'Review start-up lines state the site access, never an address', 'api: siteAccess private, 1 entry; documents READY: siteAccess private, appEnv review', { api: apiLine.replace(/"time":\d+,/, ''), documents: site.ready }, /"siteAccess":"private"/.test(apiLine) && /"siteAccessAllowlistEntries":1/.test(apiLine) && site.ready.siteAccess === 'private' && site.ready.appEnv === 'review' && !apiLine.includes('203.0.113') && !JSON.stringify(site.ready).includes('203.0.113'));

  // Liveness: the only exceptions.
  visitor.address = UNLISTED;
  const live = {
    apiGet: await exchange('R-unlisted-api-liveness-GET', API_PROXY, '/api/v1/health'),
    apiHead: await exchange('R-unlisted-api-liveness-HEAD', API_PROXY, '/api/v1/health', { method: 'HEAD' }),
    docGet: await exchange('R-unlisted-doc-liveness-GET', SITE, '/healthz'),
    docHead: await exchange('R-unlisted-doc-liveness-HEAD', SITE, '/healthz', { method: 'HEAD' }),
  };
  check('R1', 'liveness', 'Unlisted: GET/HEAD /api/v1/health and /healthz answer 200 (document body empty), private no-store', '200 x4; private, no-store; no validators; /healthz body ""',
    Object.fromEntries(Object.entries(live).map(([k, r]) => [k, summary(r)])),
    Object.values(live).every((r) => r.status === 200 && isPrivate(r)) && live.docGet.body === '' && live.docHead.body === '' && JSON.parse(live.apiGet.body).success === true);

  const NON_EXEMPT_API = [
    ['GET', '/api/v1/health/ready'], ['GET', '/api/v1/health/'], ['GET', '/api/v1/health?probe=1'], ['GET', '/API/V1/HEALTH'],
    ['POST', '/api/v1/health'], ['DELETE', '/api/v1/health'], ['OPTIONS', '/api/v1/health'],
  ];
  const nonExemptApi = [];
  for (const [method, target] of NON_EXEMPT_API) nonExemptApi.push({ method, target, ...summary(await exchange(`R-unlisted-api-${method}-${target.replace(/[^a-z]/gi, '_')}`, API_PROXY, target, { method })) , ok: undefined });
  check('R2', 'liveness', 'Unlisted: readiness and every other spelling or method of the API liveness path → 403 envelope', '403 AUTHORIZATION_DENIED, private no-store, each', nonExemptApi.map(({ method, target, status, cacheControl }) => ({ method, target, status, cacheControl })),
    nonExemptApi.every((r) => r.status === 403 && r.cacheControl === PRIVATE));
  const NON_EXEMPT_DOC = [['GET', '/healthz/'], ['GET', '/healthz?probe=1'], ['GET', '/HEALTHZ'], ['POST', '/healthz'], ['PUT', '/healthz']];
  const nonExemptDoc = [];
  for (const [method, target] of NON_EXEMPT_DOC) {
    const r = await exchange(`R-unlisted-doc-${method}-${target.replace(/[^a-z]/gi, '_')}`, SITE, target, { method });
    nonExemptDoc.push({ method, target, status: r.status, body: r.body, cacheControl: r.headers['cache-control'], ok: docDenied(r, method) });
  }
  check('R3', 'liveness', 'Unlisted: every other spelling or method of /healthz → 403 Forbidden', '403 "Forbidden", private no-store, each', nonExemptDoc, nonExemptDoc.every((r) => r.ok));

  // Readiness protected; listed sees it.
  visitor.address = LISTED;
  const readyListed = await exchange('R-listed-api-readiness', API_PROXY, '/api/v1/health/ready');
  check('R4', 'liveness', 'Listed: readiness is reachable and reports truthfully (no résumé storage in this Review run → 503), private no-store', '503 SERVICE_UNAVAILABLE, private no-store', summary(readyListed), readyListed.status === 503 && isPrivate(readyListed));

  // Early refusal across both services.
  visitor.address = UNLISTED;
  const DOC_TARGETS = ['/', '/careers', `/careers/${SLUGS.open}`, `/careers/${SLUGS.open}/apply`, '/robots.txt', '/sitemap.xml', `/assets/${asset}`, '/favicon.ico', '/no-such-page', '/Careers/'];
  const docDenials = [];
  for (const target of DOC_TARGETS) {
    const r = await exchange(`R-unlisted-doc-${target.replace(/[^a-z0-9]/gi, '_')}`, SITE, target, { headers: { 'if-none-match': '*' } });
    docDenials.push({ target, status: r.status, body: r.body, location: r.headers.location ?? null, cacheControl: r.headers['cache-control'], discloses: discloses(r.body), ok: docDenied(r) && !discloses(r.body) });
  }
  const docHead = await exchange('R-unlisted-doc-HEAD-careers', SITE, '/careers', { method: 'HEAD' });
  check('R5', 'early refusal', 'Unlisted: every document-server target (pages, Job, Apply, robots, sitemap, asset, unknown, non-canonical) → 403 Forbidden, no redirect, nothing disclosed', '403 "Forbidden" text/plain; HEAD empty; private no-store',
    { gets: docDenials, head: summary(docHead) }, docDenials.every((r) => r.ok) && docDenied(docHead, 'HEAD'));
  const API_TARGETS = [['GET', '/api/v1/jobs'], ['HEAD', '/api/v1/jobs'], ['GET', `/api/v1/jobs/${SLUGS.open}`], ['GET', '/api/v1/no-such-route'], ['GET', '/'], ['PUT', `/api/v1/jobs/${SLUGS.open}`]];
  const apiDenials = [];
  for (const [method, target] of API_TARGETS) {
    const r = await exchange(`R-unlisted-api-${method}-${target.replace(/[^a-z0-9]/gi, '_')}`, API_PROXY, target, { method, headers: { origin: SITE } });
    apiDenials.push({ method, target, status: r.status, cors: r.headers['access-control-allow-origin'] ?? null, audience: r.headers['x-valida-audience'] ?? null, ok: apiDenied(r) && !discloses(r.body) && !r.headers['x-valida-audience'] });
  }
  const preflight = await exchange('R-unlisted-api-preflight', API_PROXY, `/api/v1/jobs/${SLUGS.open}/applications`, { method: 'OPTIONS', headers: { origin: SITE, 'access-control-request-method': 'POST', 'access-control-request-headers': 'idempotency-key' } });
  check('R6', 'early refusal', 'Unlisted: API list, Job, unknown route, root, PUT and a CORS preflight → the canonical 403 envelope, before CORS', '403 {code AUTHORIZATION_DENIED, Doc 06 §188 wording}; no CORS headers; no tester header',
    { requests: apiDenials, preflight: { ...summary(preflight), allowMethods: preflight.headers['access-control-allow-methods'] ?? null } }, apiDenials.every((r) => r.ok) && apiDenied(preflight) && !preflight.headers['access-control-allow-methods']);
  const before = await applications();
  const raw = await announceLargeUpload('R-unlisted-api-submission-head-only', PORT.apiProxy, `/api/v1/jobs/${SLUGS.open}/applications`);
  check('R7', 'early refusal', 'Unlisted submission: 403 while no body byte has been sent; the connection closed; no Application', '403, Connection: close, private no-store, AUTHORIZATION_DENIED; applications unchanged',
    { answered: raw.text.split('\r\n')[0], closed: raw.closed, applicationsBefore: before, applicationsAfter: await applications(), file: raw.file },
    /^HTTP\/1\.1 403 /.test(raw.text) && /\r\nconnection: close\r\n/i.test(raw.text) && /cache-control: private, no-store/i.test(raw.text) && raw.text.includes('AUTHORIZATION_DENIED') && (await applications()) === before);

  // Listed access.
  visitor.address = LISTED;
  const listedDocs = {};
  for (const [name, target] of [['home', '/'], ['careers', '/careers'], ['job', `/careers/${SLUGS.open}`], ['apply', `/careers/${SLUGS.open}/apply`], ['closedJob', `/careers/${SLUGS.closed}`], ['draft', `/careers/${SLUGS.draft}`], ['robots', '/robots.txt'], ['sitemap', '/sitemap.xml'], ['asset', `/assets/${asset}`], ['redirect', '/About/']]) {
    listedDocs[name] = summary(await exchange(`R-listed-doc-${name}`, SITE, target));
  }
  check('R8', 'listed access', 'Listed: documents as accepted for Review (Job 200 with the tester view, Draft 404, sitemap 404 in a review build, a 301), every one private no-store', 'home/careers/job/apply/closed 200; draft 404; robots 200; sitemap 404; asset 200; redirect 301; all private, no-store',
    listedDocs, listedDocs.home.status === 200 && listedDocs.careers.status === 200 && listedDocs.job.status === 200 && listedDocs.job.audience === 'tester' && listedDocs.apply.status === 200 && listedDocs.closedJob.status === 200 && listedDocs.draft.status === 404 && listedDocs.robots.status === 200 && listedDocs.sitemap.status === 404 && listedDocs.asset.status === 200 && listedDocs.redirect.status === 301 && Object.values(listedDocs).every((r) => r.cacheControl === PRIVATE && !r.etag && !r.lastModified));
  const reviewNoindex = await exchange('R-listed-doc-careers-robots-header', SITE, '/careers');
  check('R9', 'listed access', 'Review stays indexing-disabled under private access', 'X-Robots-Tag noindex, nofollow; no canonical; no JSON-LD', { robots: reviewNoindex.headers['x-robots-tag'] ?? null },
    reviewNoindex.headers['x-robots-tag'] === 'noindex, nofollow' && !/rel="canonical"/.test(reviewNoindex.body) && !/application\/ld\+json/.test(reviewNoindex.body));
  const extra = {
    docPost: summary(await exchange('R-listed-doc-POST', SITE, '/careers', { method: 'POST', body: 'x=1' })),
    apiUnknown: summary(await exchange('R-listed-api-unknown', API_PROXY, '/api/v1/no-such-route')),
    apiPut: summary(await exchange('R-listed-api-PUT-job', API_PROXY, `/api/v1/jobs/${SLUGS.open}`, { method: 'PUT' })),
    apiDraft: summary(await exchange('R-listed-api-draft', API_PROXY, `/api/v1/jobs/${SLUGS.draft}`)),
  };
  check('R10', 'listed access', 'Admission grants nothing more: a listed visitor still gets 405 for a document POST, 404 for an unknown route and a PUT, the unknown-Job 404 for a Draft (a closed-Job submission: L4)', 'document POST 405; API unknown 404; PUT 404; Draft 404; all private no-store',
    extra, extra.docPost.status === 405 && extra.apiUnknown.status === 404 && extra.apiPut.status === 404 && extra.apiDraft.status === 404 && Object.values(extra).every((r) => r.cacheControl === PRIVATE));
  const rc = await rendered(browser, 'R-listed-careers', '/careers', TITLES.open);
  const rj = await rendered(browser, 'R-listed-job', `/careers/${SLUGS.open}`, TITLES.open);
  const ra = await rendered(browser, 'R-listed-apply', `/careers/${SLUGS.open}/apply`, 'Submit Application');
  check('R11', 'listed access', 'Listed, in Chromium: Careers lists the open Job, Job Detail shows it, Apply shows the form; the browser\'s own API reads are admitted', 'all found; API reads 200', { careers: rc, job: rj, apply: ra },
    rc.found && rj.found && ra.found && [rc, rj, ra].every((r) => r.responses.filter((x) => x.url.startsWith('/api/v1/')).every((x) => x.status === 200)));
  visitor.address = UNLISTED;
  const ru = await rendered(browser, 'R-unlisted-careers', '/careers', 'Forbidden');
  check('R12', 'early refusal', 'Unlisted, in Chromium: the page is "Forbidden"; no script, asset or API request follows', 'status 403; no /assets/ or /api/ request', ru,
    ru.status === 403 && ru.found && !ru.responses.some((x) => x.url.startsWith('/assets/') || x.url.startsWith('/api/')));

  // Delegation.
  const del = (visitorAddress, key = KEY) => ({ ...(key ? { 'x-valida-internal-key': key } : {}), ...(visitorAddress ? { 'x-valida-visitor-address': visitorAddress } : {}) });
  const D = {
    valid: await exchange('R-delegation-valid-listed-visitor', SERVICE, `/api/v1/jobs/${SLUGS.open}`, { headers: del(LISTED) }),
    validList: await exchange('R-delegation-valid-listed-visitor-list', SERVICE, '/api/v1/jobs?page=1&limit=50', { headers: del(LISTED) }),
    unlistedVisitor: await exchange('R-delegation-unlisted-visitor', SERVICE, `/api/v1/jobs/${SLUGS.open}`, { headers: del(UNLISTED) }),
    unlistedLiteral: await exchange('R-delegation-unlisted-literal', SERVICE, '/api/v1/jobs?page=1&limit=50', { headers: del('unlisted') }),
    wrongKey: await exchange('R-delegation-wrong-key', SERVICE, `/api/v1/jobs/${SLUGS.open}`, { headers: del(LISTED, WRONG_KEY) }),
    noKey: await exchange('R-delegation-no-key', SERVICE, `/api/v1/jobs/${SLUGS.open}`, { headers: del(LISTED, null) }),
    noVisitor: await exchange('R-delegation-no-visitor', SERVICE, `/api/v1/jobs/${SLUGS.open}`, { headers: del(null) }),
    readiness: await exchange('R-delegation-on-readiness', SERVICE, '/api/v1/health/ready', { headers: del(LISTED) }),
    post: await exchange('R-delegation-on-submission', SERVICE, `/api/v1/jobs/${SLUGS.open}/applications`, { method: 'POST', headers: { ...del(LISTED), 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: '{}' }),
    plainPeer: await exchange('R-listed-service-peer-without-delegation', SERVICE, `/api/v1/jobs/${SLUGS.open}`),
  };
  check('R13', 'delegation', 'A valid delegated read for a listed visitor, from the listed service peer: admitted, decided as that visitor (tester view)', '200, X-Valida-Audience tester; list 200; private no-store',
    { detail: summary(D.valid), list: summary(D.validList) }, D.valid.status === 200 && D.valid.headers['x-valida-audience'] === 'tester' && D.validList.status === 200 && isPrivate(D.valid));
  const rejected = ['unlistedVisitor', 'unlistedLiteral', 'wrongKey', 'noKey', 'noVisitor', 'readiness', 'post'];
  check('R14', 'delegation', 'Failed or out-of-scope delegation from a LISTED service peer → denied (unlisted visitor, "unlisted", wrong key, no key, no visitor, readiness, a submission)', '403 AUTHORIZATION_DENIED for each',
    Object.fromEntries(rejected.map((k) => [k, summary(D[k])])), rejected.every((k) => apiDenied(D[k])));
  check('R15', 'delegation', 'The listed service peer without delegation headers is admitted on its own address (a direct request, T1/T3 rule)', '200 tester view (the peer is listed)', summary(D.plainPeer), D.plainPeer.status === 200);

  // The document server's own delegated reads, end to end, and with a wrong key.
  visitor.address = LISTED;
  const viaDoc = await exchange('R-listed-doc-job-delegated', SITE, `/careers/${SLUGS.open}`);
  await stop(site.child);
  site = await startSite('review-wrong-key', dist.review, { APP_ENV: 'review', SITE_ACCESS: 'private', ACCESS_ALLOWLIST: ALLOWLIST, INTERNAL_SERVICE_KEY: WRONG_KEY });
  const viaDocWrong = await exchange('R-listed-doc-job-wrong-key', SITE, `/careers/${SLUGS.open}`);
  await stop(site.child);
  site = await startSite('review', dist.review, { APP_ENV: 'review', SITE_ACCESS: 'private', ACCESS_ALLOWLIST: ALLOWLIST });
  check('R16', 'delegation', 'Through the document server: a listed visitor gets the Job (valid delegation); with a wrong key the API denies the read and the page is 503, never the Job and never 404', 'key right: 200 tester; key wrong: 503 + Retry-After, nothing disclosed',
    { right: summary(viaDoc), wrong: { ...summary(viaDocWrong), retryAfter: viaDocWrong.headers['retry-after'] ?? null } },
    viaDoc.status === 200 && viaDoc.headers['x-valida-audience'] === 'tester' && viaDocWrong.status === 503 && viaDocWrong.headers['retry-after'] === '60' && !discloses(viaDocWrong.body.replace(/<link rel="preload"[^>]+>/g, '')) && isPrivate(viaDocWrong));

  // Cache isolation: the same URL, both orders, with conditional requests.
  const isolation = {};
  for (const [name, base, target] of [['document', SITE, `/careers/${SLUGS.open}`], ['api', API_PROXY, `/api/v1/jobs/${SLUGS.open}`], ['asset', SITE, `/assets/${asset}`], ['doc-liveness', SITE, '/healthz'], ['api-liveness', API_PROXY, '/api/v1/health']]) {
    for (const order of [[LISTED, UNLISTED], [UNLISTED, LISTED]]) {
      const pair = [];
      for (const who of order) {
        visitor.address = who;
        const first = await exchange(`R-isolation-${name}-${who === LISTED ? 'listed' : 'unlisted'}-${order[0] === LISTED ? 'L-then-U' : 'U-then-L'}`, base, target);
        const conditional = await exchange(`R-isolation-${name}-${who === LISTED ? 'listed' : 'unlisted'}-${order[0] === LISTED ? 'L-then-U' : 'U-then-L'}-conditional`, base, target, {
          headers: { 'if-none-match': first.headers.etag ?? '*', 'if-modified-since': new Date(Date.now() + 3_600_000).toUTCString() },
        });
        pair.push({ who: who === LISTED ? 'listed' : 'unlisted', first: summary(first), conditional: summary(conditional) });
      }
      isolation[`${name}:${order[0] === LISTED ? 'listed→unlisted' : 'unlisted→listed'}`] = pair;
    }
  }
  const allPrivate = Object.values(isolation).flat().every((p) => [p.first, p.conditional].every((r) => r.cacheControl === PRIVATE && !r.etag && !r.lastModified && r.status !== 304));
  const separated = Object.entries(isolation).every(([key, pair]) => {
    const listed = pair.find((p) => p.who === 'listed');
    const unlisted = pair.find((p) => p.who === 'unlisted');
    if (key.includes('liveness')) return listed.first.status === 200 && unlisted.first.status === 200 && listed.conditional.status === 200 && unlisted.conditional.status === 200;
    return listed.first.status === 200 && unlisted.first.status === 403 && unlisted.conditional.status === 403 && listed.conditional.status === 200 && listed.first.bodySha256 !== unlisted.first.bodySha256;
  });
  check('R17', 'cache isolation', 'Same document, API URL, asset and liveness paths, listed then unlisted and the reverse, each with If-None-Match and If-Modified-Since: no 304, no validator, private no-store everywhere; the unlisted visitor never receives the listed content', 'listed 200 / unlisted 403 in both orders; conditionals answered in full; liveness 200 for both',
    isolation, allPrivate && separated);

  await stop(site.child);
  await stop(api);

  /* ================================ L: LOCAL PRIVATE, WITH STORAGE ==== */
  const storage = mkdtempSync(path.join(os.tmpdir(), 'valida-c6t3-storage-'));
  const listFiles = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length : 0);
  api = await startApi('local-private', { APP_ENV: 'local', NODE_ENV: 'development', SITE_ACCESS: 'private', ACCESS_ALLOWLIST: ALLOWLIST, RECRUITMENT_MODE: 'testers', INTERNAL_SERVICE_KEY: KEY, RESUME_STORAGE_DRIVER: 'local', RESUME_STORAGE_LOCAL_ROOT: storage });
  site = await startSite('local-private', dist.review, { SITE_ACCESS: 'private', ACCESS_ALLOWLIST: ALLOWLIST });
  const pdf = syntheticPdf();
  const form = () => multipart({ fullName: 'QA Synthetic Applicant C6T3', email: 'qa+c6t3@example.test', screeningAnswers: '[]' }, { filename: 'qa-c6t3-resume.pdf', contentType: 'application/pdf', data: pdf });

  visitor.address = UNLISTED;
  const logBefore = readFileSync(path.join(OUT, 'logs', 'api-local-private.log'), 'utf8').length;
  const beforeU = { applications: await applications(), storedFiles: listFiles(storage) };
  const deniedForm = form();
  const deniedFull = await exchange('L-unlisted-full-submission', API_PROXY, `/api/v1/jobs/${SLUGS.open}/applications`, { method: 'POST', headers: { 'content-type': deniedForm.contentType, 'idempotency-key': randomUUID(), 'content-length': String(deniedForm.body.length) }, body: deniedForm.body });
  const deniedHead = await announceLargeUpload('L-unlisted-submission-head-only', PORT.apiProxy, `/api/v1/jobs/${SLUGS.open}/applications`);
  await new Promise((r) => setTimeout(r, 500));
  const afterU = { applications: await applications(), storedFiles: listFiles(storage) };
  const newLines = readFileSync(path.join(OUT, 'logs', 'api-local-private.log'), 'utf8').slice(logBefore).split('\n').filter(Boolean);
  const notificationLines = newLines.filter((l) => /notification|acknowledg/i.test(l));
  check('L1', 'early refusal', 'Unlisted, local private site with real storage: a complete multipart submission and a head-only one → 403; no Application, no stored object, no notification attempt', '403 x2; applications and stored files unchanged; no notification log line',
    { full: summary(deniedFull), headOnly: { answered: deniedHead.text.split('\r\n')[0], closed: deniedHead.closed }, before: beforeU, after: afterU, apiLogLinesDuringDenials: newLines.length, notificationLines: notificationLines.length },
    apiDenied(deniedFull) && /^HTTP\/1\.1 403 /.test(deniedHead.text) && afterU.applications === beforeU.applications && afterU.storedFiles === beforeU.storedFiles && notificationLines.length === 0);

  visitor.address = LISTED;
  const okForm = form();
  const accepted = await exchange('L-listed-submission', API_PROXY, `/api/v1/jobs/${SLUGS.open}/applications`, { method: 'POST', headers: { 'content-type': okForm.contentType, 'idempotency-key': randomUUID(), 'content-length': String(okForm.body.length) }, body: okForm.body });
  const afterL = { applications: await applications(), storedFiles: listFiles(storage) };
  const stored = await mongoose.connection.db.collection('applications').findOne({}, { projection: { _id: 0, status: 1, 'job.slug': 1, 'resume.sizeBytes': 1, 'resume.checksumSha256': 1 } });
  check('L2', 'listed access', 'Listed: an application is accepted end to end — HTTP 201, one Application record, one private object of the same size and checksum', '201; applications +1; stored files +1; record size and checksum = the upload',
    { response: summary(accepted), after: afterL, record: { status: stored?.status, jobSlug: stored?.job?.slug, sizeBytes: stored?.resume?.sizeBytes, checksumMatches: stored?.resume?.checksumSha256 === sha256(pdf) } },
    accepted.status === 201 && isPrivate(accepted) && afterL.applications === beforeU.applications + 1 && afterL.storedFiles === beforeU.storedFiles + 1 && stored?.resume?.sizeBytes === pdf.length && stored?.resume?.checksumSha256 === sha256(pdf));
  const closedForm = form();
  const closedSubmit = await exchange('L-listed-submission-closed-job', API_PROXY, `/api/v1/jobs/${SLUGS.closed}/applications`, { method: 'POST', headers: { 'content-type': closedForm.contentType, 'idempotency-key': randomUUID(), 'content-length': String(closedForm.body.length) }, body: closedForm.body });
  let closedCode = null;
  try {
    closedCode = JSON.parse(closedSubmit.body).error.code;
  } catch {
    closedCode = null;
  }
  const afterClosed = { applications: await applications(), storedFiles: listFiles(storage) };
  check('L4', 'listed access', 'Admission grants nothing more: a listed visitor\'s submission to a closed Job is refused by the ordinary Apply rule', '409 JOB_NOT_ACCEPTING_APPLICATIONS; no new Application or object',
    { response: summary(closedSubmit), code: closedCode, after: afterClosed }, closedSubmit.status === 409 && closedCode === 'JOB_NOT_ACCEPTING_APPLICATIONS' && afterClosed.applications === afterL.applications && afterClosed.storedFiles === afterL.storedFiles);
  const raf = await rendered(browser, 'L-listed-apply-form', `/careers/${SLUGS.open}/apply`, 'Submit Application');
  check('L3', 'listed access', 'Listed, in Chromium on the local private site: the Apply form loads with its API read admitted', 'form found; API reads 200', raf, raf.found && raf.responses.filter((x) => x.url.startsWith('/api/v1/')).every((x) => x.status === 200));
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
  const withKey = files.filter((f) => {
    const text = readFileSync(f, 'utf8');
    return text.includes(KEY) || text.includes(WRONG_KEY);
  });
  check('K1', 'credentials', 'The service key appears in no evidence file (logs, HTTP, start-up output)', '0 files', `${withKey.length} files`, withKey.length === 0);
  const logs = readdirSync(path.join(OUT, 'logs')).filter((f) => f.startsWith('api-') || f.startsWith('documents-'));
  const withAddress = logs.filter((f) => /203\.0\.113\.|192\.0\.2\./.test(readFileSync(path.join(OUT, 'logs', f), 'utf8')));
  check('K2', 'logs', 'No visitor, tester or service address appears in any API or document-server log', '0 files', { checked: logs.length, withAddress }, withAddress.length === 0);
  await mongoose.disconnect();
} catch (error) {
  check('X', 'harness', 'The stack check ran to completion', 'no error', String(error?.stack ?? error), false);
} finally {
  await browser?.close().catch(() => {});
  for (const child of [...children]) await stop(child);
  for (const server of servers) await new Promise((resolve) => server.close(resolve));
  const failed = results.filter((r) => !r.pass).length;
  writeFileSync(path.join(OUT, 'results.json'), `${JSON.stringify({ label: args.label, database: guard.databaseName, checks: results.length, failed, results }, null, 2)}\n`);
  process.stdout.write(`\n${results.length} checks, ${results.length - failed} passed, ${failed} failed. Evidence: ${OUT}\n`);
  process.exit(failed === 0 ? 0 : 1);
}
