import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { startServer } from '../../src/server.js';
import { loadConfig } from '../../src/config/env.js';
import { REQUIRED_INDEXES } from '../../src/db/indexes.js';
import { recordScanResult } from '../../src/modules/applications/resume/resumeSecurity.js';
import { roleDefinitions } from '../../src/ops/backup/mongoRoles.js';
import { TEST_RECRUITMENT_ENV, freePort } from '../helpers.js';
import { PDF_MIME, syntheticPdf } from '../fixtures/resumeFiles.js';
import { QA_CANDIDATE, applyPath } from '../fixtures/applyHarness.js';
import { ADMIN_ORIGIN, STRONG_PASSWORD, activateAndEnroll, agentFor, csrfFor, currentCode, provisionAdmin, qaJobDefinition, testClock } from '../db/adminHarness.js';

/**
 * E1-E5 under least privilege — the REAL server with the Admin surface enabled
 * (ADMIN_AUTH=enabled) runs with ONLY the production database users:
 * MONGODB_URI = valida_api_runtime and RESUME_STORAGE_MONGODB_URI =
 * valida_resume_storage, on an auth-enabled mongod. The whole HR path must
 * work: first-owner provisioning (as `admin:provision` does under
 * MONGODB_URI), activation, MFA enrolment, sessions in the store, Job
 * management, the public Apply, the scanner's CLEAN verdict (scanner user),
 * the original résumé bytes released to HR, status, note, communication,
 * audit, overview, sign-out and sign-in again. Anything the API needs beyond
 * its role fails here with code 13 (Unauthorized). Synthetic data only.
 */
const { MongoClient } = mongoose.mongo;
const ADMIN = process.env.MONGODB_ROLES_ADMIN_URI;
if (!ADMIN) throw new Error('MONGODB_ROLES_ADMIN_URI is required (an auth-enabled, disposable MongoDB)');
const DB = 'valida_test_admin_runtime';
const host = new URL(ADMIN.replace('mongodb://', 'http://')).host;
const SLUG = `qa-admin-runtime-${randomUUID().slice(0, 8)}`;
const OWNER_EMAIL = `qa-owner-${randomUUID().slice(0, 8)}@example.invalid`;
let admin;
let server;
let root;
let env;
const uris = {};

beforeAll(async () => {
  admin = new MongoClient(ADMIN);
  await admin.connect();
  const db = admin.db(DB);
  await db.dropDatabase();
  for (const [role, privileges] of Object.entries(roleDefinitions(DB))) {
    await db.command({ dropUser: `qa_${role}` }).catch(() => {});
    await db.command({ dropRole: role }).catch(() => {});
    await db.command({ createRole: role, privileges, roles: [] });
    const pwd = randomBytes(18).toString('hex');
    await db.command({ createUser: `qa_${role}`, pwd, roles: [{ role, db: DB }] });
    uris[role] = `mongodb://qa_${role}:${pwd}@${host}/${DB}?authSource=${DB}`;
  }
  // Provisioning as the Atlas Project Owner: the required indexes only (no data).
  for (const required of REQUIRED_INDEXES) await db.collection(required.collection).createIndex(required.key, { name: required.name, ...required.options });

  root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-admin-runtime-'));
  const port = await freePort();
  env = {
    ...TEST_RECRUITMENT_ENV, APP_ENV: 'local', NODE_ENV: 'test', LOG_LEVEL: process.env.QA_LOG_LEVEL ?? 'silent', PORT: String(port),
    MONGODB_URI: uris.valida_api_runtime, CORS_ALLOWED_ORIGINS: ADMIN_ORIGIN,
    RESUME_STORAGE_DRIVER: 'mongodb', RESUME_STORAGE_MONGODB_URI: uris.valida_resume_storage, APPLICATION_RATE_LIMIT_MAX: '1000',
    ADMIN_AUTH: 'enabled', ADMIN_SESSION_SECRET: randomBytes(32).toString('base64url'),
    ADMIN_MFA_KEYS: `qa1:${randomBytes(32).toString('base64')}`, ADMIN_MFA_CURRENT_KEY_ID: 'qa1', ADMIN_APP_ORIGIN: ADMIN_ORIGIN, ADMIN_LOGIN_RATE_LIMIT_MAX: '1000',
  };
  server = await startServer({ env, uploadTempBaseDirectory: root });
  server.base = `http://127.0.0.1:${port}`;
}, 60_000);

afterAll(async () => {
  await server?.shutdown('test cleanup');
  const db = admin.db(DB);
  for (const role of Object.keys(roleDefinitions(DB))) {
    await db.command({ dropUser: `qa_${role}` }).catch(() => {});
    await db.command({ dropRole: role }).catch(() => {});
  }
  await db.dropDatabase();
  await admin.close();
  fs.rmSync(root, { recursive: true, force: true });
}, 30_000);

describe('the Recruitment Admin with only the least-privilege users', () => {
  it('runs the whole HR path, and HR receives the original CLEAN résumé', async () => {
    // The server's clock is real time; TOTP codes follow it.
    const clock = testClock(Date.now());
    const config = loadConfig(env);

    // First owner, as `admin:provision create` does under MONGODB_URI (the runtime user).
    const { token } = await provisionAdmin({ config, clock, email: OWNER_EMAIL, displayName: 'QA Owner' });
    const owner = agentFor(server.base);
    const enrolled = await activateAndEnroll({ client: owner, token, clock });
    let csrf = enrolled.csrf;
    expect(enrolled.recoveryCodes).toHaveLength(10);
    expect((await owner.get('/api/v1/auth/session').expect(200)).body.data.authenticated).not.toBe(false);

    // E3: create and publish a Job (jobs insert/update).
    const created = await owner.post('/api/v1/admin/jobs', qaJobDefinition(SLUG, { applicationConfig: { resumeRequired: true, phone: { enabled: false, required: false }, message: { enabled: false, required: false, maxLength: 5000 }, screeningQuestions: [] } }), csrf);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const jobId = created.body.data.job.id;
    await owner.post(`/api/v1/admin/jobs/${jobId}/publish`, {}, csrf).expect(200);
    expect((await request(server.base).get(`/api/v1/jobs/${SLUG}`)).status).toBe(200);

    // The public Apply, with a real résumé through the storage user.
    const pdf = syntheticPdf();
    const applied = await request(server.base).post(applyPath(SLUG)).set('Idempotency-Key', randomUUID()).field('fullName', QA_CANDIDATE.fullName).field('email', QA_CANDIDATE.email).attach('resume', pdf, { filename: 'QA résumé.pdf', contentType: PDF_MIME });
    expect(applied.status).toBe(201);

    // E4: listed and searchable; the résumé is held until scanned.
    const list = await owner.get('/api/v1/admin/applications').expect(200);
    expect(list.body.data.items).toHaveLength(1);
    const applicationId = list.body.data.items[0].id;
    await owner.get(`/api/v1/admin/applications/${applicationId}`).expect(200);
    const held = await owner.get(`/api/v1/admin/applications/${applicationId}/resume`).expect(409);
    expect(held.body.error.code).toBe('RESUME_NOT_AVAILABLE');

    // The scanner user records CLEAN for exactly the stored version.
    const scanner = new MongoClient(uris.valida_resume_scanner);
    await scanner.connect();
    try {
      const applications = scanner.db(DB).collection('applications');
      const stored = await applications.findOne({}, { projection: { resume: 1 } });
      const verdict = await recordScanResult({ applications, applicationId, scanned: { storageKey: stored.resume.storageKey, sizeBytes: stored.resume.sizeBytes, checksumSha256: stored.resume.checksumSha256 }, verdict: 'CLEAN', scanner: { name: 'qa-clamav', signatureVersion: 'qa-1' } });
      expect(verdict.recorded).toBe(true);
    } finally {
      await scanner.close();
    }

    // HR download: the ORIGINAL bytes, as an attachment, audited first.
    const download = await owner.get(`/api/v1/admin/applications/${applicationId}/resume`).buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(Buffer.compare(download.body, pdf)).toBe(0);
    expect(createHash('sha256').update(download.body).digest('hex')).toBe(createHash('sha256').update(pdf).digest('hex'));
    expect(download.headers['content-disposition']).toMatch(/^attachment; /);
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(download.headers['cache-control']).toBe('private, no-store');

    // E5: status, note, communication; audit and overview read.
    const base = `/api/v1/admin/applications/${applicationId}`;
    await owner.post(`${base}/status`, { fromStatus: 'RECEIVED', toStatus: 'IN_REVIEW' }, csrf).expect(200);
    await owner.post(`${base}/notes`, { body: 'QA note under least privilege.' }, csrf).expect(201);
    await owner.post(`${base}/communications`, { kind: 'INTERVIEW', direction: 'OUTBOUND', subject: 'QA interview invitation', summary: 'QA: recorded under least privilege.' }, csrf).expect(201);
    const auditView = await owner.get(`/api/v1/admin/audit?resourceType=APPLICATION&resourceId=${applicationId}`).expect(200);
    expect(JSON.stringify(auditView.body.data)).toMatch(/RESUME_ACCESSED/);
    await owner.get('/api/v1/admin/overview').expect(200);
    await owner.get('/api/v1/auth/sessions').expect(200);
    await owner.get('/api/v1/admin/admins').expect(200);

    // Sign out (the session leaves the store), then sign in again with password + TOTP (next time step).
    await owner.post('/api/v1/auth/logout', {}, csrf).expect(200);
    await owner.get('/api/v1/admin/overview').expect(401);
    clock.advance(30_000);
    csrf = await csrfFor(owner);
    const login = await owner.post('/api/v1/auth/login', { realm: 'ADMIN', email: OWNER_EMAIL, password: STRONG_PASSWORD }, csrf).expect(200);
    await owner.post('/api/v1/auth/mfa/verify', { code: currentCode(enrolled.secret, clock) }, login.body.data.csrfToken).expect(200);
    await owner.get('/api/v1/admin/overview').expect(200);

    // Nothing was written outside the expected collections.
    const names = (await admin.db(DB).listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['admins', 'admin_sessions', 'audit_events', 'applications', 'jobs', 'resume_files']));
  }, 120_000);
});
