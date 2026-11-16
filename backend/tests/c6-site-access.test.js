import { describe, it, expect, afterEach, vi } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import util from 'node:util';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { ConfigurationError, loadConfig } from '../src/config/env.js';
import { resolveRecruitmentAccess, resolveServiceDelegation } from '../src/config/recruitmentAccess.js';
import {
  PRIVATE_CACHE_CONTROL,
  SITE_ACCESS_PROBLEMS,
  SITE_ADMISSION,
  SITE_DENIAL_REASONS,
  decideSiteAdmission,
  describeSiteAccess,
  isLivenessRequest,
  resolveSiteAccess,
} from '../src/config/siteAccess.js';
import { SITE_ACCESS_DENIED_MESSAGE } from '../src/errors/AppError.js';
import { serveUnlessConnectionClosing } from '../src/lib/http/stagedClose.js';
import { startServer } from '../src/server.js';
import etag from 'etag';
import { OFFLINE_TEST_MONGODB_URI, buildApp, capturingLogger, freePort, offlineDatabase, testConfig } from './helpers.js';
import { applyPath, applyRequest, createApplyEnvironment, qaJob, recordingTransport } from './fixtures/applyHarness.js';

/**
 * C6-T3 — whole-site private access in the API (config/siteAccess.js,
 * middleware/siteAccess.js). The real app with real local storage and
 * in-memory repositories; every request comes from 127.0.0.1 unless a
 * forwarding header says otherwise. Documentation addresses and synthetic
 * keys only.
 */
const SLUG = 'qa-synthetic-apply-role';
const JOBS = '/api/v1/jobs';
const KEY = 'qa-c6t3-unit-key-0123456789abcdef0123456789abcdef';
const WRONG_KEY = 'qa-c6t3-unit-key-ffffffffffffffffffffffffffffffff';
const LISTED = '203.0.113.7';
const UNLISTED = '192.0.2.44';
const LOOPBACK_LIST = '127.0.0.1/32,203.0.113.0/24';
const REMOTE_LIST = '203.0.113.0/24';

const site = (allowlist, appEnv = 'local') => resolveSiteAccess({ siteAccess: 'private', allowlist, appEnv });
const publicSite = () => resolveSiteAccess({ siteAccess: 'public' });
const testers = (allowlist) => resolveRecruitmentAccess({ mode: 'testers', allowlist, appEnv: 'local' });
const closed = () => resolveRecruitmentAccess({});
const delegate = (visitor, key = KEY) => ({ ...(key === null ? {} : { 'x-valida-internal-key': key }), ...(visitor === null ? {} : { 'x-valida-visitor-address': visitor }) });

let env;
let server;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
  }
  await env?.cleanup();
  env = undefined;
  vi.restoreAllMocks();
});

async function app({ siteAccess, recruitment = closed(), trustProxy = false, delegation = resolveServiceDelegation({ key: KEY }) }) {
  const transport = recordingTransport('accept');
  env = await createApplyEnvironment({
    jobs: [qaJob()],
    transport,
    configOverrides: { trustProxy, siteAccess, recruitment, serviceDelegation: delegation },
  });
  const reads = { list: 0, detail: 0 };
  env.jobs.listOpenJobs = async () => {
    reads.list += 1;
    return { total: 1, jobs: [...env.jobs.jobs.values()] };
  };
  env.jobs.findPublicJobBySlug = async ({ slug }) => {
    reads.detail += 1;
    return [...env.jobs.jobs.values()].find((job) => job.slug === slug) ?? null;
  };
  const storageSpies = ['storePrivateResume', 'deletePrivateObject', 'statPrivateObject', 'listPrivateObjects'].map((name) => vi.spyOn(env.storage, name));
  const reserve = vi.spyOn(env.intake.uploadArea, 'reserveFile');
  return {
    app: env.app,
    sideEffects: () => ({
      jobReads: reads.list + reads.detail,
      applyLookups: env.jobs.calls.findJobForApplication,
      applicationInserts: env.applications.calls.insert,
      storageCalls: storageSpies.reduce((total, spy) => total + spy.mock.calls.length, 0),
      temporaryFiles: reserve.mock.calls.length + env.tempFiles().length,
      notificationSends: transport.calls.length,
    }),
  };
}
const NOTHING = { jobReads: 0, applyLookups: 0, applicationInserts: 0, storageCalls: 0, temporaryFiles: 0, notificationSends: 0 };

function expectDenied(response) {
  expect(response.status).toBe(403);
  expect(response.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
  expect(response.headers.etag).toBeUndefined();
  expect(response.headers['last-modified']).toBeUndefined();
  expect(response.headers['access-control-allow-origin']).toBeUndefined();
  if (response.request?.method !== 'HEAD') {
    expect(response.body).toEqual({ success: false, error: { code: 'AUTHORIZATION_DENIED', message: SITE_ACCESS_DENIED_MESSAGE }, meta: { requestId: expect.any(String) } });
  }
}

/* --------------------------------------------------------- configuration -- */

describe('configuration — APP_ENV x SITE_ACCESS x ACCESS_ALLOWLIST', () => {
  const LIST = '203.0.113.0/24';
  it.each([
    // [appEnv, SITE_ACCESS, allowlist, expected mode or problem]
    ['local', undefined, undefined, 'public'],
    ['local', '', undefined, 'public'],
    ['local', 'public', undefined, 'public'],
    ['local', 'private', LIST, 'private'],
    ['local', 'private', undefined, SITE_ACCESS_PROBLEMS.PRIVATE_ALLOWLIST_ABSENT],
    ['local', 'private', '', SITE_ACCESS_PROBLEMS.PRIVATE_ALLOWLIST_ABSENT],
    ['local', 'private', '0.0.0.0/0', SITE_ACCESS_PROBLEMS.PRIVATE_ALLOWLIST_INVALID],
    ['local', 'private', '203.0.113.7,office', SITE_ACCESS_PROBLEMS.PRIVATE_ALLOWLIST_INVALID],
    ['local', 'private', '::ffff:203.0.113.7', SITE_ACCESS_PROBLEMS.PRIVATE_ALLOWLIST_INVALID],
    ['review', 'private', LIST, 'private'],
    ['review', undefined, LIST, SITE_ACCESS_PROBLEMS.REVIEW_REQUIRES_PRIVATE],
    ['review', 'public', LIST, SITE_ACCESS_PROBLEMS.REVIEW_REQUIRES_PRIVATE],
    ['review', 'private', undefined, SITE_ACCESS_PROBLEMS.PRIVATE_ALLOWLIST_ABSENT],
    ['review', 'private', '10.0.0.0/7', SITE_ACCESS_PROBLEMS.PRIVATE_ALLOWLIST_INVALID],
    // Correction 1 (plan 4.6.2): production requires the explicit literal "public".
    ['production', undefined, undefined, SITE_ACCESS_PROBLEMS.PRODUCTION_REQUIRES_PUBLIC],
    ['production', '', undefined, SITE_ACCESS_PROBLEMS.PRODUCTION_REQUIRES_PUBLIC],
    ['production', 'public', undefined, 'public'],
    ['production', 'public', LIST, 'public'],
    ['production', 'private', LIST, SITE_ACCESS_PROBLEMS.PRODUCTION_REQUIRES_PUBLIC],
    ['local', 'Private', LIST, SITE_ACCESS_PROBLEMS.SITE_ACCESS_INVALID],
    ['local', ' private', LIST, SITE_ACCESS_PROBLEMS.SITE_ACCESS_INVALID],
    ['local', 'true', LIST, SITE_ACCESS_PROBLEMS.SITE_ACCESS_INVALID],
    ['review', 'PRIVATE', LIST, SITE_ACCESS_PROBLEMS.SITE_ACCESS_INVALID],
    ['production', 'publik', LIST, SITE_ACCESS_PROBLEMS.SITE_ACCESS_INVALID],
    ['staging', 'private', LIST, SITE_ACCESS_PROBLEMS.APP_ENV_INVALID],
  ])('APP_ENV=%s SITE_ACCESS=%j ACCESS_ALLOWLIST=%j -> %s', (appEnv, siteAccess, allowlist, expected) => {
    const result = resolveSiteAccess({ appEnv, siteAccess, allowlist });
    if (expected === 'public' || expected === 'private') {
      expect(result).toMatchObject({ ok: true, mode: expected });
    } else {
      expect(result).toEqual({ ok: false, problem: expected });
    }
  });

  const base = { NODE_ENV: 'test', APP_ENV: 'local', MONGODB_URI: OFFLINE_TEST_MONGODB_URI };
  const reviewBase = { NODE_ENV: 'production', APP_ENV: 'review', MONGODB_URI: OFFLINE_TEST_MONGODB_URI, CORS_ALLOWED_ORIGINS: 'https://review.valida.example' };

  it('loadConfig: local without SITE_ACCESS is the public site — the development workflow is unchanged', () => {
    expect(loadConfig(base).siteAccess).toMatchObject({ ok: true, mode: 'public', configured: 'default' });
  });

  it.each([
    ['review without SITE_ACCESS', { ...reviewBase }, 'SITE_ACCESS'],
    ['review with public', { ...reviewBase, SITE_ACCESS: 'public' }, 'SITE_ACCESS'],
    ['review private without a list', { ...reviewBase, SITE_ACCESS: 'private' }, 'ACCESS_ALLOWLIST'],
    ['review private with a list that breaks the range policy', { ...reviewBase, SITE_ACCESS: 'private', ACCESS_ALLOWLIST: '198.51.100.250/4' }, 'ACCESS_ALLOWLIST'],
    ['production private', { ...reviewBase, APP_ENV: 'production', SITE_ACCESS: 'private', ACCESS_ALLOWLIST: REMOTE_LIST }, 'SITE_ACCESS'],
    ['production without SITE_ACCESS', { ...reviewBase, APP_ENV: 'production' }, 'SITE_ACCESS'],
    ['production with an empty SITE_ACCESS', { ...reviewBase, APP_ENV: 'production', SITE_ACCESS: '' }, 'SITE_ACCESS'],
    ['an invalid value', { ...base, SITE_ACCESS: 'priv4te-marker' }, 'SITE_ACCESS'],
  ])('loadConfig refuses %s, naming the variable and never the value', (_label, input, variable) => {
    let error;
    try {
      loadConfig(input);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error.issues.map((issue) => issue.variable)).toContain(variable);
    expect(error.message).not.toMatch(/priv4te-marker|198\.51\.100\.250|203\.0\.113/);
  });

  it('loadConfig: review, private, valid list — accepted; the list is in no serialised view', () => {
    const marker = '198.51.100.77';
    const config = loadConfig({ ...reviewBase, SITE_ACCESS: 'private', ACCESS_ALLOWLIST: `${marker},203.0.113.0/24` });
    expect(config.siteAccess).toMatchObject({ ok: true, mode: 'private', configured: 'explicit', allowlistEntries: 2 });
    for (const form of [JSON.stringify(config), JSON.stringify(config.siteAccess), util.inspect(config, { depth: 10 }), util.inspect(config.siteAccess)]) {
      expect(form).not.toContain(marker);
    }
    expect(describeSiteAccess(config.siteAccess)).toEqual({ siteAccess: 'private', siteAccessConfiguration: 'explicit', siteAccessAllowlistEntries: 2 });
  });
});

describe('start-up refuses before listening', () => {
  const started = [];
  afterEach(async () => {
    while (started.length) await started.pop().shutdown('test cleanup');
  });
  const startEnv = (port, extra) => ({ NODE_ENV: 'test', APP_ENV: 'local', PORT: String(port), LOG_LEVEL: 'info', CORS_ALLOWED_ORIGINS: 'http://localhost:5173', MONGODB_URI: OFFLINE_TEST_MONGODB_URI, ...extra });
  const portOpen = (port) =>
    new Promise((resolve) => {
      const socket = net.connect({ port, host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });

  it.each([
    ['review, no SITE_ACCESS', { APP_ENV: 'review', NODE_ENV: 'production' }],
    ['production, private', { APP_ENV: 'production', NODE_ENV: 'production', SITE_ACCESS: 'private', ACCESS_ALLOWLIST: REMOTE_LIST }],
    ['production, SITE_ACCESS absent', { APP_ENV: 'production', NODE_ENV: 'production' }],
    ['production, SITE_ACCESS empty', { APP_ENV: 'production', NODE_ENV: 'production', SITE_ACCESS: '' }],
    ['local, private without a list', { SITE_ACCESS: 'private' }],
  ])('%s: startServer rejects and the port is never bound', async (_label, extra) => {
    const port = await freePort();
    await expect(startServer({ env: startEnv(port, extra), database: offlineDatabase(), logger: capturingLogger().logger })).rejects.toBeInstanceOf(ConfigurationError);
    expect(await portOpen(port)).toBe(false);
  });

  it('a private site starts and logs one line: mode and entry count, never an address', async () => {
    const port = await freePort();
    const log = capturingLogger();
    const handle = await startServer({ env: startEnv(port, { SITE_ACCESS: 'private', ACCESS_ALLOWLIST: `127.0.0.1/32,${REMOTE_LIST}` }), database: offlineDatabase(), logger: log.logger });
    started.push(handle);
    const line = log
      .output()
      .split('\n')
      .filter(Boolean)
      .map((entry) => JSON.parse(entry))
      .find((entry) => entry.msg === 'site access');
    expect(line).toMatchObject({ level: 'info', siteAccess: 'private', siteAccessConfiguration: 'explicit', siteAccessAllowlistEntries: 2 });
    expect(log.output()).not.toMatch(/203\.0\.113|127\.0\.0\.1\/32/);
    const live = await request(`http://127.0.0.1:${port}`).get('/api/v1/health');
    expect(live.status).toBe(200);
    expect(live.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
  });
});

/* ------------------------------------------------------ the pure decision -- */

describe('the admission decision', () => {
  it('liveness is exactly GET or HEAD of the exact target', () => {
    expect(isLivenessRequest({ method: 'GET', rawUrl: '/api/v1/health', path: '/api/v1/health' })).toBe(true);
    expect(isLivenessRequest({ method: 'HEAD', rawUrl: '/api/v1/health', path: '/api/v1/health' })).toBe(true);
    for (const rawUrl of ['/api/v1/health/', '/api/v1/health?probe=1', '/API/v1/health', '/api/v1/health/ready', '//api/v1/health', '/api/v1/health%2F']) {
      expect(isLivenessRequest({ method: 'GET', rawUrl, path: '/api/v1/health' }), rawUrl).toBe(false);
    }
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']) {
      expect(isLivenessRequest({ method, rawUrl: '/api/v1/health', path: '/api/v1/health' }), method).toBe(false);
    }
  });

  it('a failure inside the decision denies', () => {
    const throwing = { get ok() { throw new Error('boom'); } };
    expect(decideSiteAdmission({ site: throwing, method: 'GET', rawUrl: '/', livenessPath: '/healthz', trustedHops: false, socketAddress: '127.0.0.1' })).toEqual({
      admission: SITE_ADMISSION.DENIED,
      reason: SITE_DENIAL_REASONS.DECISION_FAILED,
    });
  });
});

/* -------------------------------------------------------- over HTTP: deny -- */

describe('private site, unlisted client: refused first, everywhere', () => {
  const ROUTES = [
    ['GET', '/api/v1/health/ready'],
    ['GET', '/api/v1/health/'],
    ['GET', '/api/v1/health?probe=1'],
    ['GET', '/API/V1/HEALTH'],
    ['POST', '/api/v1/health'],
    ['DELETE', '/api/v1/health'],
    ['GET', JOBS],
    ['HEAD', JOBS],
    ['GET', `${JOBS}/${SLUG}`],
    ['GET', '/api/v1/no-such-route'],
    ['GET', '/'],
    ['GET', '/robots.txt'],
    ['PUT', `${JOBS}/${SLUG}`],
  ];

  it.each(ROUTES)('%s %s -> 403, canonical envelope, private no-store, nothing done', async (method, path) => {
    const { app: application, sideEffects } = await app({ siteAccess: site(REMOTE_LIST), recruitment: testers('127.0.0.1/32') });
    const response = await request(application)[method.toLowerCase()](path).set('Origin', 'http://localhost:5173');
    expectDenied(response);
    expect(response.headers['x-valida-audience']).toBeUndefined();
    expect(sideEffects()).toEqual(NOTHING);
  });

  it('a CORS preflight is refused before CORS answers it', async () => {
    const { app: application } = await app({ siteAccess: site(REMOTE_LIST) });
    const response = await request(application)
      .options(applyPath(SLUG))
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'idempotency-key');
    expectDenied(response);
    expect(response.headers['access-control-allow-methods']).toBeUndefined();
  });

  it('only GET/HEAD of exactly /api/v1/health pass — with private, no-store', async () => {
    const { app: application } = await app({ siteAccess: site(REMOTE_LIST) });
    const get = await request(application).get('/api/v1/health');
    const head = await request(application).head('/api/v1/health');
    for (const response of [get, head]) {
      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
      expect(response.headers.etag).toBeUndefined();
    }
    expect(get.body).toMatchObject({ success: true });
  });

  it('a complete submission (multipart, real socket): 403, the connection closed, no storage, record or email', async () => {
    const { app: application, sideEffects } = await app({ siteAccess: site(REMOTE_LIST), recruitment: testers('127.0.0.1/32') });
    server = http.createServer(serveUnlessConnectionClosing(application));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const socket = net.connect({ port, host: '127.0.0.1', allowHalfOpen: true });
    const received = [];
    socket.on('data', (chunk) => received.push(chunk));
    socket.on('error', () => {});
    await new Promise((resolve) => socket.once('connect', resolve));
    // Headers only: a 5 MiB upload is announced and not one byte of it is sent.
    socket.write(
      `POST ${applyPath(SLUG)} HTTP/1.1\r\nHost: qa\r\nContent-Type: multipart/form-data; boundary=----qa\r\n` +
        `Idempotency-Key: ${randomUUID()}\r\nContent-Length: ${5 * 1024 * 1024}\r\n\r\n`,
    );
    const text = () => Buffer.concat(received).toString('latin1');
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && !/\r\n\r\n\{.*\}$/s.test(text())) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(text()).toMatch(/^HTTP\/1\.1 403 /);
    expect(text()).toMatch(/\r\nConnection: close\r\n/i);
    expect(text()).toMatch(/\r\nCache-Control: private, no-store\r\n/i);
    expect(text()).toContain('"code":"AUTHORIZATION_DENIED"');
    expect(sideEffects()).toEqual(NOTHING);
    socket.destroy();
  });

  it('a supertest submission with a real file: 403, nothing stored', async () => {
    const { app: application, sideEffects } = await app({ siteAccess: site(REMOTE_LIST), recruitment: testers('127.0.0.1/32') });
    const response = await applyRequest(application, { slug: SLUG });
    expectDenied(response);
    expect(response.headers.connection).toBe('close');
    expect(sideEffects()).toEqual(NOTHING);
  });

  it.each([
    ['no forwarding header', undefined],
    ['a chain shorter than the hop count', undefined, 2],
    ['an unlisted client behind the proxy', `${LISTED}, ${UNLISTED}`],
    ['a malformed proxy entry', `${LISTED}, not-an-address`],
  ])('TRUST_PROXY: %s -> denied', async (_label, forwardedFor, hops = 1) => {
    const { app: application } = await app({ siteAccess: site(REMOTE_LIST), trustProxy: hops });
    const call = request(application).get(JOBS);
    const response = await (forwardedFor === undefined ? call : call.set('X-Forwarded-For', forwardedFor));
    expectDenied(response);
  });
});

/* ------------------------------------------------------- over HTTP: admit -- */

describe('private site, listed client: admitted, and nothing more', () => {
  it('TRUST_PROXY=1, a listed client: admitted; recruitment closed still lists no Job', async () => {
    const { app: application, sideEffects } = await app({ siteAccess: site(REMOTE_LIST), trustProxy: 1 });
    const list = await request(application).get(JOBS).set('X-Forwarded-For', LISTED);
    expect(list.status).toBe(200);
    expect(list.body.data.items).toEqual([]);
    expect(list.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
    const detail = await request(application).get(`${JOBS}/${SLUG}`).set('X-Forwarded-For', LISTED);
    expect(detail.status).toBe(404);
    expect(detail.body.error.code).toBe('JOB_NOT_FOUND');
    const submission = await applyRequest(application, { slug: SLUG }).set('X-Forwarded-For', LISTED);
    expect(submission.status).toBe(404);
    expect(sideEffects()).toMatchObject({ applicationInserts: 0, storageCalls: 0, notificationSends: 0 });
  });

  it('listed for the site, testers listing the same client: the tester view, private no-store, no validator', async () => {
    const { app: application } = await app({ siteAccess: site(LOOPBACK_LIST), recruitment: testers('127.0.0.1/32') });
    const first = await request(application).get(`${JOBS}/${SLUG}`);
    expect(first.status).toBe(200);
    expect(first.headers['x-valida-audience']).toBe('tester');
    expect(first.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
    expect(first.headers.etag).toBeUndefined();
    const conditional = await request(application).get(`${JOBS}/${SLUG}`).set('If-None-Match', '*').set('If-Modified-Since', new Date().toUTCString());
    expect(conditional.status).toBe(200);
  });

  it('readiness, the unknown route and errors keep their status, with private no-store', async () => {
    const { app: application } = await app({ siteAccess: site(LOOPBACK_LIST) });
    const ready = await request(application).get('/api/v1/health/ready');
    expect([200, 503]).toContain(ready.status);
    const unknown = await request(application).get('/api/v1/no-such-route');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('API_ROUTE_NOT_FOUND');
    const malformed = await request(application).get(`${JOBS}?page=0`);
    expect(malformed.status).toBe(422);
    for (const response of [ready, unknown, malformed]) {
      expect(response.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
      expect(response.headers.etag).toBeUndefined();
    }
  });

  it('a conditional request carrying the exact validator Express would compute is still answered in full — never 304', async () => {
    // A stable 200 response outside /api/v1/jobs (whose T2 policy also drops
    // conditionals), on a test-only route: only the site rule can prevent a 304.
    const application = buildApp({
      config: testConfig({ siteAccess: site(LOOPBACK_LIST) }),
      registerTestRoutes: (api) => api.get('/qa-stable', (_req, res) => res.json({ qa: 'stable' })),
    });
    const first = await request(application).get('/api/v1/qa-stable');
    expect(first.status).toBe(200);
    expect(first.headers.etag).toBeUndefined();
    const validator = etag(Buffer.from(first.text), { weak: true });
    const conditional = await request(application).get('/api/v1/qa-stable').set('If-None-Match', validator);
    expect(conditional.status).toBe(200);
    expect(conditional.text).toBe(first.text);
    // Control: on a PUBLIC site the same validator does produce a 304, so the request above is a real test.
    const open = buildApp({ config: testConfig({ siteAccess: publicSite() }), registerTestRoutes: (api) => api.get('/qa-stable', (_req, res) => res.json({ qa: 'stable' })) });
    expect((await request(open).get('/api/v1/qa-stable').set('If-None-Match', validator)).status).toBe(304);
  });

  it('a submission from a listed client goes through the ordinary Apply rules (positive control: 201)', async () => {
    const { app: application, sideEffects } = await app({ siteAccess: site(LOOPBACK_LIST), recruitment: testers('127.0.0.1/32') });
    const response = await applyRequest(application, { slug: SLUG });
    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe(PRIVATE_CACHE_CONTROL);
    expect(sideEffects().applicationInserts).toBe(1);
  });
});

/* -------------------------------------------------------- delegation (T2) -- */

describe('delegated Jobs reads: admission follows the authenticated end visitor', () => {
  // The caller (127.0.0.1) is LISTED for the site in every case below.
  const setup = () => app({ siteAccess: site(LOOPBACK_LIST), recruitment: testers(REMOTE_LIST) });

  it('a valid delegation for a listed visitor: admitted, and the API decides as that visitor (tester view)', async () => {
    const { app: application } = await setup();
    const response = await request(application).get(`${JOBS}/${SLUG}`).set(delegate(LISTED));
    expect(response.status).toBe(200);
    expect(response.headers['x-valida-audience']).toBe('tester');
    const list = await request(application).get(`${JOBS}?page=1&limit=50`).set(delegate(LISTED));
    expect(list.status).toBe(200);
  });

  it.each([
    ['a valid key for an unlisted visitor', delegate(UNLISTED)],
    ['a valid key for "unlisted"', delegate('unlisted')],
    ['a wrong key', delegate(LISTED, WRONG_KEY)],
    ['no key', delegate(LISTED, null)],
    ['a key and no visitor', delegate(null)],
    ['a malformed visitor', delegate('203.0.113.7:443')],
  ])('%s from a LISTED service peer: denied', async (_label, headers) => {
    const { app: application, sideEffects } = await setup();
    expectDenied(await request(application).get(`${JOBS}/${SLUG}`).set(headers));
    expect(sideEffects().jobReads).toBe(0);
  });

  it.each([
    ['readiness', 'get', '/api/v1/health/ready'],
    ['an unknown route', 'get', '/api/v1/other'],
    ['a submission', 'post', applyPath(SLUG)],
    ['a PUT on a Job', 'put', `${JOBS}/${SLUG}`],
  ])('a valid delegation outside its approved routes (%s): denied', async (_label, method, path) => {
    const { app: application, sideEffects } = await setup();
    expectDenied(await request(application)[method](path).set(delegate(LISTED)));
    expect(sideEffects()).toEqual(NOTHING);
  });

  it('delegation disabled (no key configured): every delegated read is denied, even from a listed peer', async () => {
    const { app: application } = await app({ siteAccess: site(LOOPBACK_LIST), recruitment: testers(REMOTE_LIST), delegation: resolveServiceDelegation({}) });
    expectDenied(await request(application).get(JOBS).set(delegate(LISTED)));
  });

  it('liveness stays reachable whatever headers it carries', async () => {
    const { app: application } = await setup();
    expect((await request(application).get('/api/v1/health').set(delegate(UNLISTED, WRONG_KEY))).status).toBe(200);
  });
});

/* ------------------------------------------------------------ public site -- */

describe('public site: the accepted T2 behaviour, unchanged', () => {
  it('no 403 anywhere; Jobs no-store; health not private', async () => {
    const { app: application } = await app({ siteAccess: publicSite(), recruitment: testers(REMOTE_LIST) });
    const jobs = await request(application).get(JOBS);
    expect(jobs.status).toBe(200);
    expect(jobs.headers['cache-control']).toBe('no-store');
    const ready = await request(application).get('/api/v1/health/ready');
    expect(ready.status).not.toBe(403);
    expect(ready.headers['cache-control']).not.toBe(PRIVATE_CACHE_CONTROL);
    const unknown = await request(application).get('/api/v1/other');
    expect(unknown.status).toBe(404);
  });

  it('a configuration without a siteAccess entry is the public site', async () => {
    const { app: application } = await app({ siteAccess: undefined });
    expect((await request(application).get('/api/v1/other')).status).toBe(404);
  });
});
