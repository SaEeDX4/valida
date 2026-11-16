import { describe, it, expect, afterEach, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import net from 'node:net';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config/env.js';
import { resolveRecruitmentAccess } from '../src/config/recruitmentAccess.js';
import { serveUnlessConnectionClosing } from '../src/lib/http/stagedClose.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { jobsRouter } from '../src/modules/jobs/job.routes.js';
import { applicationsRouter } from '../src/modules/applications/application.routes.js';
import { startServer } from '../src/server.js';
import { OFFLINE_TEST_MONGODB_URI, capturingLogger, freePort, offlineDatabase, silentLogger } from './helpers.js';
import { PDF_MIME, syntheticPdf } from './fixtures/resumeFiles.js';
import { multipartBody, resumePart } from './fixtures/uploadHarness.js';
import { QA_CANDIDATE, QA_NOW, applyPath, applyRequest, createApplyEnvironment, qaAnswers, qaJob, recordingTransport } from './fixtures/applyHarness.js';

/**
 * C6-T1 — recruitment access at the REAL API entry points.
 *
 * The real application (createApp): the real middleware stack, the real Jobs
 * and Apply routes, the real multipart parser, REAL local private storage in
 * a fresh temporary root, the real submission service and the real
 * notification boundary with a recording transport double. Only the two
 * database repositories are the in-memory stand-ins of the B5 harness, so
 * that every call into them can be counted. The same behaviour against a real
 * MongoDB is in tests/db/c6-recruitment-api.test.js.
 *
 * Synthetic data and documentation addresses only (RFC 5737 / RFC 3849).
 *
 * How the two kinds of client are produced without a second machine:
 *   LISTED    the allowlist contains loopback, where Supertest connects from;
 *             or TRUST_PROXY is a hop count and this test, acting as the
 *             proxy, supplies the forwarded address.
 *   UNLISTED  the allowlist holds only documentation ranges, so the loopback
 *             client is outside it.
 * What that cannot show — that a real hosting proxy forwards addresses the
 * way the hop count assumes — is a hosted check (plan section 4.6.5), not
 * part of this task.
 */
const SLUG = 'qa-synthetic-apply-role';
const JOBS = '/api/v1/jobs';
const LOOPBACK_LIST = '127.0.0.1/32,::1/128';
const REMOTE_LIST = '203.0.113.0/24,2001:db8:10::/48';
const LISTED_REMOTE = '203.0.113.7';
const UNLISTED_REMOTE = '192.0.2.44';
const OD = 'OD-2026-11-15-01';

const testers = (allowlist) => resolveRecruitmentAccess({ mode: 'testers', allowlist, appEnv: 'local' });
const MODES = {
  closedByDefault: () => resolveRecruitmentAccess({}),
  closedExplicit: () => resolveRecruitmentAccess({ mode: 'closed' }),
  closedByTypo: () => resolveRecruitmentAccess({ mode: 'Public', authorisation: OD, appEnv: 'production' }),
  publicOutsideProduction: () => resolveRecruitmentAccess({ mode: 'public', authorisation: OD, appEnv: 'local' }),
  testersListed: () => testers(LOOPBACK_LIST),
  testersUnlisted: () => testers(REMOTE_LIST),
  public: () => resolveRecruitmentAccess({ mode: 'public', authorisation: OD, appEnv: 'production' }),
};

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

/**
 * The real app with one open synthetic Job, and every side effect counted.
 * `recruitment` replaces the configuration's entry; `undefined` removes it.
 */
async function environment(recruitment, { trustProxy = false, jobs = [qaJob()], configOverrides = {}, removeRecruitment = false } = {}) {
  const transport = recordingTransport('accept');
  env = await createApplyEnvironment({
    jobs,
    transport,
    configOverrides: { trustProxy, ...(removeRecruitment ? { recruitment: undefined } : { recruitment }), ...configOverrides },
  });
  // The Jobs reads of the in-memory repository are fixed stubs; give them the
  // same Job the Apply methods hold, and count the calls.
  const reads = { list: 0, detail: 0 };
  env.jobs.listOpenJobs = async () => {
    reads.list += 1;
    const open = [...env.jobs.jobs.values()].filter((job) => job.status === 'PUBLISHED');
    return { total: open.length, jobs: open };
  };
  env.jobs.findPublicJobBySlug = async ({ slug }) => {
    reads.detail += 1;
    return [...env.jobs.jobs.values()].find((job) => job.slug === slug && ['PUBLISHED', 'CLOSED'].includes(job.status)) ?? null;
  };
  const storageSpies = ['storePrivateResume', 'deletePrivateObject', 'statPrivateObject', 'listPrivateObjects'].map((name) => vi.spyOn(env.storage, name));
  const reserve = vi.spyOn(env.intake.uploadArea, 'reserveFile');
  return {
    app: env.app,
    reads,
    transport,
    /** Every counter that must stay at zero when a request is refused. */
    sideEffects: () => ({
      jobListReads: reads.list,
      jobDetailReads: reads.detail,
      jobLookupsForApply: env.jobs.calls.findJobForApplication,
      eligibilityChecks: env.jobs.calls.findJobEligibility,
      applicationLookups: env.applications.calls.findByKeyHash,
      applicationInserts: env.applications.calls.insert,
      applicationsStored: env.applications.all().length,
      storageCalls: storageSpies.reduce((total, spy) => total + spy.mock.calls.length, 0),
      objectsInStorage: env.storedObjects().length,
      temporaryFilesReserved: reserve.mock.calls.length,
      temporaryFilesOnDisk: env.tempFiles().length,
      notificationSends: transport.calls.length,
    }),
  };
}

const NOTHING_HAPPENED = {
  jobListReads: 0,
  jobDetailReads: 0,
  jobLookupsForApply: 0,
  eligibilityChecks: 0,
  applicationLookups: 0,
  applicationInserts: 0,
  applicationsStored: 0,
  storageCalls: 0,
  objectsInStorage: 0,
  temporaryFilesReserved: 0,
  temporaryFilesOnDisk: 0,
  notificationSends: 0,
};

const withoutRequestId = (body) => JSON.parse(JSON.stringify(body, (key, value) => (key === 'requestId' ? undefined : value)));

/* ------------------------------------------------------------------ */

describe.each([
  ['closed by default (nothing configured)', 'closedByDefault'],
  ['closed, stated explicitly', 'closedExplicit'],
  ['closed by a mode in the wrong letter case', 'closedByTypo'],
  ['"public" outside production', 'publicOutsideProduction'],
  ['testers, for a client that is not listed', 'testersUnlisted'],
])('%s — nobody sees or uses a Job', (_label, mode) => {
  it('the Jobs list is an empty page, with the caller\'s own pagination, and the database is not consulted', async () => {
    const { app, sideEffects } = await environment(MODES[mode]());
    const response = await request(app).get(`${JOBS}?page=3&limit=7`);
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({ items: [], pagination: { page: 3, limit: 7, total: 0, totalPages: 0 } });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-valida-audience']).toBeUndefined();
    expect(sideEffects()).toEqual(NOTHING_HAPPENED);
  });

  it('Job Detail is the unknown-Job answer, for a Job that exists and is open', async () => {
    const { app, sideEffects } = await environment(MODES[mode]());
    const response = await request(app).get(`${JOBS}/${SLUG}`);
    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ code: 'JOB_NOT_FOUND', message: "This role isn't available." });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-valida-audience']).toBeUndefined();
    expect(sideEffects()).toEqual(NOTHING_HAPPENED);
  });

  it('a complete, valid submission is refused: nothing is parsed, stored, written or sent', async () => {
    const { app, sideEffects } = await environment(MODES[mode]());
    const response = await applyRequest(app);
    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ code: 'JOB_NOT_FOUND', message: "This application isn't available." });
    expect(response.headers.connection).toBe('close');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-valida-audience']).toBeUndefined();
    expect(sideEffects()).toEqual(NOTHING_HAPPENED);
    await env.submission.drainFollowUps();
    expect(sideEffects()).toEqual(NOTHING_HAPPENED);
  });
});

describe('a refused submission is answered before the body is parsed', () => {
  it('a malformed JSON body is never parsed: a listed client gets 400, a refused one gets 404', async () => {
    const malformed = '{"fullName": "QA", ';
    const listed = await environment(MODES.testersListed());
    const parsed = await request(listed.app).post(applyPath(SLUG)).set('Content-Type', 'application/json').send(malformed);
    expect(parsed.status).toBe(400);
    expect(parsed.body.error.code).toBe('MALFORMED_REQUEST');
    await env.cleanup();

    const refused = await environment(MODES.closedByDefault());
    const response = await request(refused.app).post(applyPath(SLUG)).set('Content-Type', 'application/json').send(malformed);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('JOB_NOT_FOUND');
    expect(refused.sideEffects()).toEqual(NOTHING_HAPPENED);
  });

  it('a JSON body over the 100 KB limit is never measured: a listed client gets 413, a refused one gets 404', async () => {
    const oversized = JSON.stringify({ padding: 'x'.repeat(200 * 1024) });
    const listed = await environment(MODES.testersListed());
    const measured = await request(listed.app).post(applyPath(SLUG)).set('Content-Type', 'application/json').send(oversized);
    expect(measured.status).toBe(413);
    await env.cleanup();

    const refused = await environment(MODES.testersUnlisted());
    const response = await request(refused.app).post(applyPath(SLUG)).set('Content-Type', 'application/json').send(oversized);
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('JOB_NOT_FOUND');
    expect(refused.sideEffects()).toEqual(NOTHING_HAPPENED);
  });

  it('the refusal does not wait for the Idempotency-Key check, the Apply rate limit or the storage check', async () => {
    // No Idempotency-Key (a listed client would get 400), a rate limit of zero
    // remaining and no storage at all: the refused client still gets the same 404.
    const transport = recordingTransport('accept');
    env = await createApplyEnvironment({ withStorage: false, transport, configOverrides: { recruitment: MODES.closedByDefault() } });
    const response = await applyRequest(env.app, { key: null });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('JOB_NOT_FOUND');
    expect(env.applications.calls.insert).toBe(0);
    expect(transport.calls).toHaveLength(0);
  });

  it.each([
    ['closed', 'closedByDefault'],
    ['testers, unlisted', 'testersUnlisted'],
  ])('over a real socket (%s): the answer arrives while NO body byte has been sent, then the connection closes', async (_label, mode) => {
    const { app, sideEffects } = await environment(MODES[mode]());
    server = http.createServer(serveUnlessConnectionClosing(app));
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

    expect(text()).toMatch(/^HTTP\/1\.1 404 /);
    expect(text()).toMatch(/\r\nConnection: close\r\n/i);
    expect(text()).toContain('"code":"JOB_NOT_FOUND"');
    expect(text()).toContain("This application isn't available.");
    expect(sideEffects()).toEqual(NOTHING_HAPPENED);
    socket.destroy();
  });

  it('a complete multipart upload over a real socket: refused, every byte discarded, no temporary file', async () => {
    const { app, sideEffects } = await environment(MODES.closedByDefault());
    server = http.createServer(serveUnlessConnectionClosing(app));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const { body, contentType } = multipartBody([
      { name: 'fullName', value: QA_CANDIDATE.fullName },
      { name: 'email', value: QA_CANDIDATE.email },
      { name: 'screeningAnswers', value: JSON.stringify(qaAnswers()) },
      resumePart(syntheticPdf(), 'qa-resume.pdf', PDF_MIME),
    ]);
    const socket = net.connect({ port, host: '127.0.0.1' });
    const received = [];
    let closed = false;
    socket.on('data', (chunk) => received.push(chunk));
    socket.on('close', () => {
      closed = true;
    });
    socket.on('error', () => {});
    await new Promise((resolve) => socket.once('connect', resolve));
    socket.write(Buffer.concat([Buffer.from(`POST ${applyPath(SLUG)} HTTP/1.1\r\nHost: qa\r\nContent-Type: ${contentType}\r\nIdempotency-Key: ${randomUUID()}\r\nContent-Length: ${body.length}\r\n\r\n`), body]));
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !closed) await new Promise((resolve) => setTimeout(resolve, 10));
    const text = Buffer.concat(received).toString('latin1');
    expect(text).toMatch(/^HTTP\/1\.1 404 /);
    expect((text.match(/HTTP\/1\.1 \d{3}/g) ?? []).length).toBe(1);
    expect(closed).toBe(true);
    expect(sideEffects()).toEqual(NOTHING_HAPPENED);
  });

  it.each([
    ['upper-case path', '/api/v1/JOBS/qa-synthetic-apply-role/APPLICATIONS'],
    ['trailing slash', `${applyPath(SLUG)}/`],
    ['a slug with malformed percent-encoding', '/api/v1/jobs/%E0%A4%A/applications'],
    ['an unknown slug', applyPath('qa-no-such-role')],
  ])('the refusal covers every spelling the router would match (%s)', async (_label, path) => {
    const { app, sideEffects } = await environment(MODES.closedByDefault());
    const response = await request(app).post(path).set('Idempotency-Key', randomUUID()).set('Content-Type', 'application/json').send('{"broken": ');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('JOB_NOT_FOUND');
    expect(response.headers.connection).toBe('close');
    expect(sideEffects()).toEqual(NOTHING_HAPPENED);
  });

  it.each([
    ['PUT', (app) => request(app).put(`${JOBS}/${SLUG}`)],
    ['PATCH', (app) => request(app).patch(`${JOBS}/${SLUG}`)],
    ['DELETE', (app) => request(app).delete(`${JOBS}/${SLUG}`)],
    ['POST to the list', (app) => request(app).post(JOBS)],
    ['POST below a submission path', (app) => request(app).post(`${applyPath(SLUG)}/extra`)],
  ])('any other request that could carry a body (%s) gets the canonical API 404, body unread', async (_label, call) => {
    const { app, sideEffects } = await environment(MODES.closedByDefault());
    const response = await call(app).set('Content-Type', 'application/json').send('{"broken": ');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('API_ROUTE_NOT_FOUND');
    expect(response.headers.connection).toBe('close');
    expect(sideEffects()).toEqual(NOTHING_HAPPENED);
  });
});

describe('what a refused client still gets exactly as before', () => {
  it('query validation: an invalid page is 422, not an empty page', async () => {
    const { app } = await environment(MODES.closedByDefault());
    const response = await request(app).get(`${JOBS}?page=0`);
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('the general rate limit still counts refused reads', async () => {
    const { app } = await environment(MODES.closedByDefault(), { configOverrides: { rateLimit: Object.freeze({ windowMs: 60_000, max: 2 }) } });
    expect((await request(app).get(JOBS)).status).toBe(200);
    expect((await request(app).get(`${JOBS}/${SLUG}`)).status).toBe(404);
    const limited = await request(app).get(JOBS);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  it('a CORS preflight for the submission is answered as before', async () => {
    const { app } = await environment(MODES.closedByDefault());
    const response = await request(app).options(applyPath(SLUG)).set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'idempotency-key');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('a refused submission from an allowed origin still carries the CORS header, so a browser can read the answer', async () => {
    const { app } = await environment(MODES.closedByDefault());
    const response = await applyRequest(app).set('Origin', 'http://localhost:5173');
    expect(response.status).toBe(404);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('health is not behind the gate', async () => {
    const { app } = await environment(MODES.closedByDefault());
    expect((await request(app).get('/api/v1/health')).status).toBe(200);
  });

  it('a refused client cannot tell a hidden Job from one that does not exist', async () => {
    const refused = await environment(MODES.testersUnlisted());
    const hidden = await request(refused.app).get(`${JOBS}/${SLUG}`);
    const missing = await request(refused.app).get(`${JOBS}/qa-no-such-role`);
    const hiddenSubmission = await applyRequest(refused.app);
    const missingSubmission = await applyRequest(refused.app, { slug: 'qa-no-such-role' });
    expect(withoutRequestId(hidden.body)).toEqual(withoutRequestId(missing.body));
    expect(hidden.status).toBe(missing.status);
    expect(withoutRequestId(hiddenSubmission.body)).toEqual(withoutRequestId(missingSubmission.body));
    await env.cleanup();

    // And the bodies are the ones a LISTED client gets for a Job that really does not exist.
    const listed = await environment(MODES.testersListed());
    const reallyMissing = await request(listed.app).get(`${JOBS}/qa-no-such-role`);
    const reallyMissingSubmission = await applyRequest(listed.app, { slug: 'qa-no-such-role' });
    expect(withoutRequestId(hidden.body)).toEqual(withoutRequestId(reallyMissing.body));
    expect(withoutRequestId(hiddenSubmission.body)).toEqual(withoutRequestId(reallyMissingSubmission.body));
    expect(reallyMissingSubmission.status).toBe(404);
  });
});

describe('testers, for a listed client — the accepted behaviour, plus the tester header', () => {
  it('the list, the Job and a submission work, and each Jobs response says "tester"', async () => {
    const { app, reads, transport, sideEffects } = await environment(MODES.testersListed());

    const list = await request(app).get(JOBS);
    expect(list.status).toBe(200);
    expect(list.body.data.items.map((item) => item.slug)).toEqual([SLUG]);
    expect(list.body.data.pagination.total).toBe(1);
    expect(list.headers['x-valida-audience']).toBe('tester');

    const detail = await request(app).get(`${JOBS}/${SLUG}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.slug).toBe(SLUG);
    expect(detail.headers['x-valida-audience']).toBe('tester');
    expect(reads).toEqual({ list: 1, detail: 1 });

    const submitted = await applyRequest(app);
    expect(submitted.status).toBe(201);
    expect(submitted.body.data).toMatchObject({ status: 'RECEIVED', job: { slug: SLUG } });
    expect(submitted.headers['x-valida-audience']).toBe('tester');
    await env.submission.drainFollowUps();
    expect(sideEffects()).toMatchObject({ applicationInserts: 1, applicationsStored: 1, objectsInStorage: 1, temporaryFilesOnDisk: 0 });
    // The internal notification only; acknowledgements stay disabled.
    expect(transport.calls).toHaveLength(1);
    expect(env.applications.all()[0].notifications.candidateAcknowledgement.status).toBe('NOT_REQUIRED');
  });

  it('the header is on a tester\'s error answers too: unknown Job, validation failure, missing key', async () => {
    const { app } = await environment(MODES.testersListed());
    const unknown = await request(app).get(`${JOBS}/qa-no-such-role`);
    expect(unknown.status).toBe(404);
    expect(unknown.headers['x-valida-audience']).toBe('tester');
    const invalid = await request(app).get(`${JOBS}?page=0`);
    expect(invalid.status).toBe(422);
    expect(invalid.headers['x-valida-audience']).toBe('tester');
    const noKey = await applyRequest(app, { key: null });
    expect(noKey.status).toBe(400);
    expect(noKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(noKey.headers['x-valida-audience']).toBe('tester');
  });

  it('the header is only on Jobs responses', async () => {
    const { app } = await environment(MODES.testersListed());
    expect((await request(app).get('/api/v1/health')).headers['x-valida-audience']).toBeUndefined();
    expect((await request(app).get('/api/v1/nothing-here')).headers['x-valida-audience']).toBeUndefined();
  });

  it.each([
    ['a closed Job: its page is still served, and it does not accept applications', { status: 'CLOSED', closedAt: new Date('2026-10-01T00:00:00.000Z') }, 200, 409, 'JOB_NOT_ACCEPTING_APPLICATIONS'],
    ['a Job past its closing time', { closesAt: new Date(QA_NOW.getTime() - 60_000) }, 200, 409, 'JOB_NOT_ACCEPTING_APPLICATIONS'],
    ['a Draft: an unknown Job', { status: 'DRAFT', publishedAt: null }, 404, 404, 'JOB_NOT_FOUND'],
    ['an archived Job: an unknown Job', { status: 'ARCHIVED' }, 404, 404, 'JOB_NOT_FOUND'],
    ['a Job published in the future: an unknown Job', { publishedAt: new Date(QA_NOW.getTime() + 3_600_000) }, null, 404, 'JOB_NOT_FOUND'],
  ])('the Job lifecycle is untouched for a tester — %s', async (_label, overrides, detailStatus, submissionStatus, submissionCode) => {
    const { app, sideEffects } = await environment(MODES.testersListed(), { jobs: [qaJob(overrides)] });
    if (detailStatus !== null) expect((await request(app).get(`${JOBS}/${SLUG}`)).status).toBe(detailStatus);
    const submission = await applyRequest(app);
    expect(submission.status).toBe(submissionStatus);
    expect(submission.body.error.code).toBe(submissionCode);
    await env.submission.drainFollowUps();
    expect(sideEffects()).toMatchObject({ applicationsStored: 0, objectsInStorage: 0, temporaryFilesOnDisk: 0, notificationSends: 0 });
  });
});

describe('public — everyone, exactly as accepted, and no tester header', () => {
  it('the configuration that makes it public is a production one with an owner-decision identifier', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      APP_ENV: 'production',
      PORT: '4100',
      MONGODB_URI: OFFLINE_TEST_MONGODB_URI,
      CORS_ALLOWED_ORIGINS: 'https://qa-valida.example.test',
      // C6-T3 correction 1: production requires SITE_ACCESS=public explicitly.
      SITE_ACCESS: 'public',
      RECRUITMENT_MODE: 'public',
      RECRUITMENT_PUBLIC_AUTHORISATION: OD,
    });
    expect(config.recruitment).toMatchObject({ mode: 'public', authorisationRef: OD });
    // Unchanged safeguard: production candidate acknowledgements stay disabled.
    expect(config.notifications.acknowledgementEnabled).toBe(false);
  });

  it('a client on no list reads the list and the Job and submits an application', async () => {
    const { app, transport, sideEffects } = await environment(MODES.public());
    const list = await request(app).get(JOBS);
    expect(list.status).toBe(200);
    expect(list.body.data.items.map((item) => item.slug)).toEqual([SLUG]);
    expect(list.headers['x-valida-audience']).toBeUndefined();
    const detail = await request(app).get(`${JOBS}/${SLUG}`);
    expect(detail.status).toBe(200);
    expect(detail.headers['x-valida-audience']).toBeUndefined();
    const submitted = await applyRequest(app);
    expect(submitted.status).toBe(201);
    expect(submitted.headers['x-valida-audience']).toBeUndefined();
    await env.submission.drainFollowUps();
    expect(sideEffects()).toMatchObject({ applicationsStored: 1, objectsInStorage: 1, temporaryFilesOnDisk: 0 });
    expect(transport.calls).toHaveLength(1);
  });

  it.each([
    ['a closed Job', { status: 'CLOSED', closedAt: new Date('2026-10-01T00:00:00.000Z') }, 200, 409],
    ['a Draft', { status: 'DRAFT', publishedAt: null }, 404, 404],
  ])('the Job lifecycle is untouched in public — %s', async (_label, overrides, detailStatus, submissionStatus) => {
    const { app } = await environment(MODES.public(), { jobs: [qaJob(overrides)] });
    expect((await request(app).get(`${JOBS}/${SLUG}`)).status).toBe(detailStatus);
    expect((await applyRequest(app)).status).toBe(submissionStatus);
  });
});

describe('the client address behind a proxy (TRUST_PROXY) — simulated locally', () => {
  const listedOnlyRemote = () => testers(REMOTE_LIST);

  it('TRUST_PROXY=false: a forwarded header naming a listed address changes nothing', async () => {
    const { app, sideEffects } = await environment(listedOnlyRemote(), { trustProxy: false });
    const list = await request(app).get(JOBS).set('X-Forwarded-For', LISTED_REMOTE);
    expect(list.body.data.items).toEqual([]);
    expect(list.headers['x-valida-audience']).toBeUndefined();
    expect((await applyRequest(app).set('X-Forwarded-For', LISTED_REMOTE)).status).toBe(404);
    expect(sideEffects()).toEqual(NOTHING_HAPPENED);
  });

  it('one trusted hop: the address the proxy appended decides', async () => {
    const { app } = await environment(listedOnlyRemote(), { trustProxy: 1 });
    const listed = await request(app).get(JOBS).set('X-Forwarded-For', LISTED_REMOTE);
    expect(listed.headers['x-valida-audience']).toBe('tester');
    expect(listed.body.data.items).toHaveLength(1);
    const unlisted = await request(app).get(JOBS).set('X-Forwarded-For', UNLISTED_REMOTE);
    expect(unlisted.headers['x-valida-audience']).toBeUndefined();
    expect(unlisted.body.data.items).toEqual([]);
  });

  it('one trusted hop: a listed address the CLIENT put in front is ignored — only the rightmost entry counts', async () => {
    const { app, sideEffects } = await environment(listedOnlyRemote(), { trustProxy: 1 });
    const spoofed = await request(app).get(JOBS).set('X-Forwarded-For', `${LISTED_REMOTE}, ${UNLISTED_REMOTE}`);
    expect(spoofed.headers['x-valida-audience']).toBeUndefined();
    expect(spoofed.body.data.items).toEqual([]);
    expect((await applyRequest(app).set('X-Forwarded-For', `${LISTED_REMOTE}, ${LISTED_REMOTE}, ${UNLISTED_REMOTE}`)).status).toBe(404);
    expect(sideEffects()).toEqual(NOTHING_HAPPENED);
  });

  it('two trusted hops: the entry two from the right decides', async () => {
    const { app } = await environment(listedOnlyRemote(), { trustProxy: 2 });
    const listed = await request(app).get(JOBS).set('X-Forwarded-For', `${UNLISTED_REMOTE}, ${LISTED_REMOTE}, 198.51.100.200`);
    expect(listed.headers['x-valida-audience']).toBe('tester');
    const unlisted = await request(app).get(JOBS).set('X-Forwarded-For', `${LISTED_REMOTE}, ${UNLISTED_REMOTE}, 198.51.100.200`);
    expect(unlisted.headers['x-valida-audience']).toBeUndefined();
  });

  it('an IPv6 client behind one hop', async () => {
    const { app } = await environment(listedOnlyRemote(), { trustProxy: 1 });
    expect((await request(app).get(JOBS).set('X-Forwarded-For', '2001:db8:10::beef')).headers['x-valida-audience']).toBe('tester');
    expect((await request(app).get(JOBS).set('X-Forwarded-For', '2001:db8:11::beef')).headers['x-valida-audience']).toBeUndefined();
  });

  it.each([
    ['not an address', 'office-network'],
    ['an address with a port', `${LISTED_REMOTE}:443`],
    ['an empty entry', ' '],
  ])('one trusted hop and a forwarded value that is %s: nobody', async (_label, value) => {
    const { app } = await environment(listedOnlyRemote(), { trustProxy: 1 });
    const response = await request(app).get(JOBS).set('X-Forwarded-For', value);
    expect(response.status).toBe(200);
    expect(response.headers['x-valida-audience']).toBeUndefined();
    expect(response.body.data.items).toEqual([]);
  });

  it.each([['True-Client-IP'], ['CF-Connecting-IP'], ['X-Real-IP'], ['X-Client-IP'], ['Forwarded']])('%s is never read', async (header) => {
    const value = header === 'Forwarded' ? `for=${LISTED_REMOTE}` : LISTED_REMOTE;
    for (const trustProxy of [false, 1]) {
      const { app } = await environment(listedOnlyRemote(), { trustProxy });
      const response = await request(app).get(JOBS).set(header, value);
      expect(response.headers['x-valida-audience']).toBeUndefined();
      expect(response.body.data.items).toEqual([]);
      await env.cleanup();
      env = undefined;
    }
  });
});

describe('failing closed', () => {
  it('a configuration object with no recruitment entry at all is closed', async () => {
    const { app, sideEffects } = await environment(undefined, { removeRecruitment: true });
    expect((await request(app).get(JOBS)).body.data.items).toEqual([]);
    expect((await request(app).get(`${JOBS}/${SLUG}`)).status).toBe(404);
    expect((await applyRequest(app)).status).toBe(404);
    expect(sideEffects()).toEqual(NOTHING_HAPPENED);
  });

  it('an access object that throws when it is read answers every request as closed — never a 500', async () => {
    const exploding = {};
    Object.defineProperty(exploding, 'mode', {
      get() {
        throw new Error('QA: the recruitment check failed');
      },
    });
    const { app, sideEffects } = await environment(exploding);
    const list = await request(app).get(JOBS);
    expect(list.status).toBe(200);
    expect(list.body.data.items).toEqual([]);
    expect((await request(app).get(`${JOBS}/${SLUG}`)).status).toBe(404);
    expect((await applyRequest(app)).status).toBe(404);
    expect(sideEffects()).toEqual(NOTHING_HAPPENED);
  });

  it('a hand-made access object claiming "public" in the wrong case, or "testers" with a permissive stand-in list, is closed', async () => {
    for (const forged of [{ mode: 'Public' }, { mode: 'testers', allowlist: { check: () => true } }, { mode: 'testers' }, { mode: 'open' }]) {
      const { app, sideEffects } = await environment(forged);
      expect((await request(app).get(JOBS)).body.data.items).toEqual([]);
      expect((await applyRequest(app)).status).toBe(404);
      expect(sideEffects()).toEqual(NOTHING_HAPPENED);
      await env.cleanup();
      env = undefined;
    }
  });

  it('the routers, mounted WITHOUT the gate, serve nothing', async () => {
    const calls = { list: 0, detail: 0, submit: 0 };
    const repository = {
      async listOpenJobs() {
        calls.list += 1;
        return { total: 1, jobs: [qaJob()] };
      },
      async findPublicJobBySlug() {
        calls.detail += 1;
        return qaJob();
      },
    };
    const service = {
      async submit() {
        calls.submit += 1;
        return { status: 'RECEIVED', job: { title: 'x', slug: SLUG }, submittedAt: new Date(), replayed: false };
      },
    };
    const logger = silentLogger();
    const bare = express();
    bare.use((req, _res, next) => {
      req.id = 'qa-request';
      next();
    });
    bare.use('/api/v1/jobs', jobsRouter({ repository, clock: () => QA_NOW, logger }));
    bare.use('/api/v1/jobs', applicationsRouter({ service, uploadArea: {}, resumeStorage: {}, rateLimit: { windowMs: 60_000, max: 100 } }));
    bare.use(errorHandler(logger));

    const list = await request(bare).get(JOBS);
    expect(list.status).toBe(200);
    expect(list.body.data.items).toEqual([]);
    expect((await request(bare).get(`${JOBS}/${SLUG}`)).status).toBe(404);
    const submission = await request(bare).post(applyPath(SLUG)).set('Idempotency-Key', randomUUID()).field('fullName', 'QA');
    expect(submission.status).toBe(404);
    expect(submission.body.error.code).toBe('JOB_NOT_FOUND');
    expect(calls).toEqual({ list: 0, detail: 0, submit: 0 });
  });
});

describe('logs hold no client address and no configured value', () => {
  it('requests from a listed and an unlisted address leave neither address in the log', async () => {
    const { app } = await environment(testers(REMOTE_LIST), { trustProxy: 1 });
    await request(app).get(JOBS).set('X-Forwarded-For', LISTED_REMOTE);
    await request(app).get(`${JOBS}/${SLUG}`).set('X-Forwarded-For', LISTED_REMOTE);
    await applyRequest(app).set('X-Forwarded-For', LISTED_REMOTE);
    await request(app).get(JOBS).set('X-Forwarded-For', UNLISTED_REMOTE);
    await applyRequest(app).set('X-Forwarded-For', UNLISTED_REMOTE);
    await env.submission.drainFollowUps();
    const output = env.log.output();
    expect(output.length).toBeGreaterThan(0);
    for (const forbidden of [LISTED_REMOTE, UNLISTED_REMOTE, '203.0.113', '2001:db8:10', '127.0.0.1', '::1', 'x-forwarded-for']) {
      expect(output.toLowerCase()).not.toContain(forbidden);
    }
    // The refusal is still visible to an operator, by its fixed classification.
    const refusals = output.split('\n').filter(Boolean).map((line) => JSON.parse(line)).filter((entry) => entry.reason === 'RECRUITMENT_ACCESS_DENIED');
    expect(refusals.length).toBeGreaterThan(0);
  });
});

describe('start-up: one line states the effective mode and why', () => {
  const started = [];
  afterEach(async () => {
    while (started.length) await started.pop().shutdown('test cleanup');
  });

  async function start(extra) {
    const port = await freePort();
    const log = capturingLogger();
    const handle = await startServer({
      env: { NODE_ENV: 'test', APP_ENV: 'local', PORT: String(port), LOG_LEVEL: 'info', CORS_ALLOWED_ORIGINS: 'http://localhost:5173', MONGODB_URI: OFFLINE_TEST_MONGODB_URI, ...extra },
      database: offlineDatabase(),
      logger: log.logger,
    });
    started.push(handle);
    const lines = log.output().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    return { port, output: log.output(), line: lines.find((entry) => entry.msg === 'recruitment access'), lines };
  }

  it('nothing configured: closed, at info level, and the running server serves no Job', async () => {
    const { port, line } = await start({});
    expect(line).toMatchObject({ level: 'info', recruitmentMode: 'closed', recruitmentConfiguration: 'absent', recruitmentReason: 'MODE_ABSENT', recruitmentAllowlistEntries: 0 });
    const list = await request(`http://127.0.0.1:${port}`).get(JOBS);
    expect(list.status).toBe(200);
    expect(list.body.data.items).toEqual([]);
    expect((await request(`http://127.0.0.1:${port}`).get(`${JOBS}/${SLUG}`)).status).toBe(404);
    const submission = await request(`http://127.0.0.1:${port}`).post(applyPath(SLUG)).set('Idempotency-Key', randomUUID()).field('fullName', 'QA');
    expect(submission.status).toBe(404);
  });

  it('a rejected configuration: the server still starts, closed, with a warning — and the value is not printed', async () => {
    const { line, output } = await start({ RECRUITMENT_MODE: 'publ1c-marker', RECRUITMENT_PUBLIC_AUTHORISATION: 'auth-marker', ACCESS_ALLOWLIST: 'list-marker' });
    expect(line).toMatchObject({ level: 'warn', recruitmentMode: 'closed', recruitmentConfiguration: 'invalid', recruitmentReason: 'MODE_INVALID' });
    expect(output).not.toMatch(/publ1c-marker|auth-marker|list-marker/);
  });

  it('"public" outside production: closed, with the reason', async () => {
    const { line } = await start({ RECRUITMENT_MODE: 'public', RECRUITMENT_PUBLIC_AUTHORISATION: OD });
    expect(line).toMatchObject({ level: 'warn', recruitmentMode: 'closed', recruitmentReason: 'PUBLIC_NOT_PRODUCTION', recruitmentAuthorisation: null });
  });

  it('testers: the number of entries is logged, never the entries', async () => {
    const { line, output } = await start({ RECRUITMENT_MODE: 'testers', ACCESS_ALLOWLIST: `${LISTED_REMOTE},198.51.100.0/24,2001:db8:10::/48` });
    expect(line).toMatchObject({ level: 'info', recruitmentMode: 'testers', recruitmentConfiguration: 'valid', recruitmentReason: 'MODE_TESTERS', recruitmentAllowlistEntries: 3 });
    expect(output).not.toMatch(/203\.0\.113|198\.51\.100|2001:db8/);
  });
});
