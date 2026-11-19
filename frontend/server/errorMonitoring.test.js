// @vitest-environment node
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { resolveReleaseIdentity } from '../../backend/src/config/releaseIdentity.js';
import { resolveErrorMonitoring } from '../../backend/src/config/errorMonitoring.js';
import { REPOSITORY_ROOT, createErrorMonitor } from '../../backend/src/lib/monitoring/errorMonitor.js';
import { QA_MONITOR_KEY, closedPortDsn, startMonitoringReceiver } from '../../backend/tests/fixtures/monitoringReceiver.js';
import { resolveSeoConfig } from '../src/seo/siteConfig.js';
import { startDocumentServer } from './documentServer.js';
import { SENTRY_SDK } from './monitoringSdk.js';

/**
 * C6-T6 — error monitoring in the document server (D-4a; C6 plan r3 §4.5;
 * Doc 13 §213; Doc 17 §407). The SDK and transport are real; the receiver
 * is a local stand-in for Sentry's ingest endpoint, and every content
 * assertion is made on the bytes it received.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = 'https://cybervalida.com';
const SHA = '9a8b7c6d5e4f30211203f4e5d6c7b8a9f0e1d2c3';
const RELEASE = resolveReleaseIdentity({ RENDER_GIT_COMMIT: SHA });
const EXPECTED_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self' https://api.cybervalida.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

const MARK = Object.freeze({
  applicantName: 'QaMarkerDocApplicantZx52',
  applicantEmail: 'qa.marker.doc.zx52@example.test',
  resumeKey: 'resumes/qamarkerdockeyzx52',
  credential: 'QA-MARKER-DOC-SERVICE-KEY-ZX52',
  cookie: 'QA-MARKER-DOC-COOKIE-ZX52',
  authorization: 'QA-MARKER-DOC-AUTH-ZX52',
  query: 'QA-MARKER-DOC-QUERY-ZX52',
  path: 'qa-marker-doc-path-zx52',
  forwarded: '198.51.100.52',
});
const expectNoMarker = (text) => {
  for (const marker of Object.values(MARK)) expect(text).not.toContain(marker);
  expect(text).not.toContain(REPOSITORY_ROOT);
};

let tmp;
let dist;
const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

beforeAll(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'valida-c6t6-monitor-'));
  dist = path.join(tmp, 'dist');
  mkdirSync(path.join(dist, 'assets'), { recursive: true });
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>Valida</title>\n<!--valida:head-->\n</head><body><div id="root"></div></body></html>');
  writeFileSync(path.join(dist, 'assets', 'index-qa.js'), 'console.log("qa")');
  writeFileSync(path.join(dist, 'valida-seo.json'), JSON.stringify({ indexing: true, siteOrigin: SITE, apiBaseUrl: 'https://api.cybervalida.com' }));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A Jobs client whose reads fail with a defect whose text carries everything it should not. */
const brokenJobs = {
  origin: 'http://127.0.0.1:9',
  delegation: 'enabled',
  async listOpenJobSlugs() {
    const error = new TypeError(`read failed for ${MARK.applicantName} <${MARK.applicantEmail}> ${MARK.resumeKey} key=${MARK.credential}`);
    error.headers = { cookie: MARK.cookie, authorization: MARK.authorization };
    throw error;
  },
  async getJob() {
    throw new RangeError(`${MARK.applicantEmail} ${MARK.credential}`);
  },
};

async function documentServer({ errorMonitor, jobs = brokenJobs } = {}) {
  const server = await startDocumentServer({
    distDir: dist,
    config: resolveSeoConfig({ siteUrl: SITE, allowIndexing: 'true' }),
    jobs,
    browserApiBase: 'https://api.cybervalida.com',
    release: RELEASE,
    trustedHops: 1,
    port: 0,
    errorMonitor,
  });
  cleanups.push(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

function raw(base, rawPath, headers = {}) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port, path: rawPath, method: 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

const poisonedHeaders = {
  cookie: `session=${MARK.cookie}`,
  authorization: `Bearer ${MARK.authorization}`,
  'x-forwarded-for': MARK.forwarded,
  'x-valida-visitor': MARK.forwarded,
  'x-valida-service-key': MARK.credential,
};

async function enabledMonitor(dsn, { logger, deliveryTimeoutMs } = {}) {
  const monitor = createErrorMonitor({
    monitoring: resolveErrorMonitoring({ dsn, appEnv: 'local' }),
    release: RELEASE,
    environment: 'local',
    service: 'valida-documents',
    sdk: SENTRY_SDK,
    logger,
    deliveryTimeoutMs,
  });
  cleanups.push(() => monitor.close(1_000));
  return monitor;
}

describe('the document server: representative unexpected failures, through the real handler, SDK and transport', () => {
  it.each([
    ['the sitemap', `/sitemap.xml?email=${MARK.applicantEmail}&token=${MARK.query}`, 'TypeError'],
    ['a Job document', `/careers/${MARK.path}?token=${MARK.query}`, 'RangeError'],
  ])('%s: a 500 under the enforced policy; one event with the release and nothing about the request', async (_label, url, type) => {
    const receiver = await startMonitoringReceiver();
    cleanups.push(() => receiver.close());
    const monitor = await enabledMonitor(receiver.dsn);
    const base = await documentServer({ errorMonitor: monitor });

    const response = await raw(base, url, poisonedHeaders);
    expect(response.status).toBe(500);
    expect(response.body).toBe('Internal Server Error');
    expect(response.headers['content-security-policy']).toBe(EXPECTED_CSP);
    expect(response.headers['x-valida-release']).toBe(SHA);

    await monitor.flush(2_000);
    expect(receiver.requests).toHaveLength(1);
    const [event] = receiver.events();
    expect(event).toMatchObject({
      level: 'error',
      release: SHA,
      environment: 'local',
      server_name: 'valida-documents',
      tags: { service: 'valida-documents', kind: 'request', status: '500' },
    });
    expect(event.exception.values[0]).toMatchObject({ type, value: `Unexpected ${type}` });
    expect(event.exception.values[0].stacktrace.frames.some((frame) => frame.filename === 'app:///frontend/server/errorMonitoring.test.js')).toBe(true);
    expect(Object.keys(event).sort()).toEqual(['contexts', 'environment', 'event_id', 'exception', 'level', 'platform', 'release', 'server_name', 'tags', 'timestamp']);
    expectNoMarker(receiver.raw());
  });

  it('disabled: the same 500 and headers, nothing sent', async () => {
    const receiver = await startMonitoringReceiver();
    cleanups.push(() => receiver.close());
    const base = await documentServer({ errorMonitor: createErrorMonitor({ monitoring: resolveErrorMonitoring({}), sdk: SENTRY_SDK }) });
    const response = await raw(base, '/sitemap.xml', poisonedHeaders);
    expect(response.status).toBe(500);
    expect(response.headers['content-security-policy']).toBe(EXPECTED_CSP);
    expect(receiver.requests).toHaveLength(0);
  });

  it('unreachable: the same 500, promptly; one fixed warning without the DSN', async () => {
    const warnings = [];
    const monitor = await enabledMonitor(await closedPortDsn(), { logger: { warn: (entry) => warnings.push(entry), info: () => {} }, deliveryTimeoutMs: 300 });
    const base = await documentServer({ errorMonitor: monitor });
    const started = Date.now();
    for (let i = 0; i < 3; i += 1) expect((await raw(base, '/sitemap.xml')).status).toBe(500);
    expect(Date.now() - started).toBeLessThan(2_000);
    await monitor.flush(2_000);
    expect(warnings).toEqual([{ errorMonitorDelivery: 'failing', reason: 'unreachable', service: 'valida-documents' }]);
    expect(JSON.stringify(warnings)).not.toContain(QA_MONITOR_KEY);
  });

  it('ordinary pages are unchanged and send nothing', async () => {
    const receiver = await startMonitoringReceiver();
    cleanups.push(() => receiver.close());
    const monitor = await enabledMonitor(receiver.dsn);
    const ok = { ...brokenJobs, listOpenJobSlugs: async () => ({ outcome: 'ok', slugs: [] }) };
    const base = await documentServer({ errorMonitor: monitor, jobs: ok });
    for (const [url, status] of [['/', 200], ['/about', 200], ['/assets/index-qa.js', 200], ['/qa-unknown', 404]]) {
      const response = await raw(base, url);
      expect(response.status).toBe(status);
      expect(response.headers['content-security-policy']).toBe(EXPECTED_CSP);
    }
    await monitor.flush(1_000);
    expect(receiver.requests).toHaveLength(0);
  });
});

describe('start-up through serve.mjs (real process)', () => {
  function serve(env) {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(here, 'serve.mjs'), '--dist', dist, '--port', '0', '--api-origin', 'http://127.0.0.1:9', '--quiet'], {
        env: { PATH: process.env.PATH, APP_ENV: 'local', RENDER_GIT_COMMIT: SHA, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk) => {
        out += chunk;
        const line = out.split('\n').find((text) => text.startsWith('READY '));
        if (line) {
          child.kill('SIGTERM');
          resolve({ ready: JSON.parse(line.slice(6)), out, err });
        }
      });
      child.stderr.on('data', (chunk) => {
        err += chunk;
      });
      child.on('exit', (code) => resolve({ code, out, err }));
    });
  }

  it('enabled: starts; READY states it without the DSN; the policy is unchanged', async () => {
    const result = await serve({ SENTRY_DSN: `http://${QA_MONITOR_KEY}@127.0.0.1:9/7` });
    expect(result.ready).toMatchObject({ errorMonitoring: 'enabled', errorMonitoringTransport: 'loopback-http', release: SHA, contentSecurityPolicy: EXPECTED_CSP });
    expect(result.out).not.toContain(QA_MONITOR_KEY);
  });

  it('absent: ordinary start-up; READY says disabled', async () => {
    const result = await serve({});
    expect(result.ready).toMatchObject({ errorMonitoring: 'disabled', errorMonitoringTransport: null, contentSecurityPolicy: EXPECTED_CSP });
  });

  it.each([
    ['http to a remote host', `http://${QA_MONITOR_KEY}@qa-remote.example.test/7`, 'local'],
    ['loopback http in production', `http://${QA_MONITOR_KEY}@127.0.0.1:9/7`, 'production'],
    ['not a DSN', 'QA-NOT-A-DSN-ZX52', 'local'],
  ])('malformed (%s): refused before listening, naming SENTRY_DSN and not the value', async (_label, value, appEnv) => {
    const result = await serve({ SENTRY_DSN: value, APP_ENV: appEnv, ...(appEnv === 'production' ? { SITE_ACCESS: 'public' } : {}) });
    expect(result.code).toBe(1);
    expect(result.out).not.toContain('READY');
    expect(result.err).toContain('SENTRY_DSN');
    expect(result.err).not.toContain(value);
    expect(result.err).not.toContain(QA_MONITOR_KEY);
  });
});
