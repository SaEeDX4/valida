import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { startServer } from '../../src/server.js';
import { Job } from '../../src/models/Job.js';
import { REQUIRED_INDEXES } from '../../src/db/indexes.js';
import { publishJob } from '../../src/modules/jobs/job.service.js';
import { roleDefinitions } from '../../src/ops/backup/mongoRoles.js';
import { TEST_RECRUITMENT_ENV, freePort } from '../helpers.js';
import { PDF_MIME, syntheticPdf } from '../fixtures/resumeFiles.js';
import { QA_CANDIDATE, applyPath } from '../fixtures/applyHarness.js';

/**
 * Proposed (MongoDB-native) — R-1: the REAL server runs with ONLY the two
 * least-privilege users (MONGODB_URI = valida_api_runtime,
 * RESUME_STORAGE_MONGODB_URI = valida_resume_storage) on an auth-enabled
 * mongod. Start-up, readiness, the public job read and a complete Apply
 * (idempotent replay included) must work; anything the API needs beyond the
 * role fails here with code 13. Provisioning (indexes, the Job) is done by the
 * admin, as the Project Owner does in Atlas. Synthetic data only.
 */
const { MongoClient } = mongoose.mongo;
const ADMIN = process.env.MONGODB_ROLES_ADMIN_URI;
if (!ADMIN) throw new Error('MONGODB_ROLES_ADMIN_URI is required (an auth-enabled, disposable MongoDB)');
const DB = 'valida_test_runtime';
const host = new URL(ADMIN.replace('mongodb://', 'http://')).host;
const SLUG = `qa-runtime-${randomUUID().slice(0, 8)}`;
let admin;
let server;
let root;
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
  // Provisioning as the owner: indexes and one published synthetic Job.
  const adminUriForDb = ADMIN.replace(/\/[^/?]*(\?|$)/, `/${DB}$1`);
  await mongoose.connect(adminUriForDb, { autoIndex: false, autoCreate: false, authSource: 'admin' });
  for (const required of REQUIRED_INDEXES) await mongoose.connection.db.collection(required.collection).createIndex(required.key, { name: required.name, ...required.options });
  await mongoose.connection.db.collection('resume_files').createIndex({ checksumSha256: 1 }, { name: 'qa_noop' }).catch(() => {});
  const job = new Job({
    title: 'QA Synthetic Runtime-role Role', slug: SLUG, location: { displayName: 'QA Region, Canada', countryCode: 'CA' }, workArrangement: 'FULLY_REMOTE', employmentType: 'PART_TIME', weeklyHours: 30,
    compensation: { currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: true }, description: 'QA TEST DATA description.', responsibilities: ['QA TEST DATA responsibility.'], requirements: ['QA TEST DATA requirement.'],
  });
  await job.save();
  await publishJob(job, { now: new Date(Date.now() - 60_000) });
  await mongoose.disconnect();

  root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-runtime-'));
  const port = await freePort();
  server = await startServer({
    env: {
      ...TEST_RECRUITMENT_ENV, APP_ENV: 'local', NODE_ENV: 'test', LOG_LEVEL: process.env.QA_LOG_LEVEL ?? 'silent', PORT: String(port),
      MONGODB_URI: uris.valida_api_runtime, CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
      RESUME_STORAGE_DRIVER: 'mongodb', RESUME_STORAGE_MONGODB_URI: uris.valida_resume_storage, APPLICATION_RATE_LIMIT_MAX: '1000',
    },
    uploadTempBaseDirectory: root,
  });
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

describe('the API with only its two least-privilege users', () => {
  it('starts, is ready, serves the job, accepts an Application and replays it; résumé bytes went through the storage user', async () => {
    // Readiness: database and résumé storage report ready under the two users. (The overall answer is 503 here
    // only because this local run configures no mail provider: notifications = not_implemented, as in B5.)
    expect(server.readiness.describe().dependencies.filter((d) => ['database', 'resumeStorage'].includes(d.name)).map((d) => d.state)).toEqual(['ready', 'ready']);
    expect((await request(server.base).get(`/api/v1/jobs/${SLUG}`)).status).toBe(200);
    const key = randomUUID();
    const pdf = syntheticPdf();
    const send = () => request(server.base).post(applyPath(SLUG)).set('Idempotency-Key', key).field('fullName', QA_CANDIDATE.fullName).field('email', QA_CANDIDATE.email).attach('resume', pdf, { filename: 'qa-resume.pdf', contentType: PDF_MIME });
    const first = await send();
    expect(first.status).toBe(201);
    expect((await send()).status).toBe(200);
    expect(await admin.db(DB).collection('applications').countDocuments({})).toBe(1);
    expect(await admin.db(DB).collection('resume_files').countDocuments({})).toBe(1);
  }, 60_000);
});
