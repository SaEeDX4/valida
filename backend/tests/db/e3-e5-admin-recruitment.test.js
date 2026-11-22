import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { REQUIRED_INDEXES } from '../../src/db/indexes.js';
import { requireTestDatabase, assertConnectedToTestDatabase } from './testDatabase.js';
import { Application, Job, buildAdminApp, clearAdminCollections, qaJobDefinition, readyAdmin, seedApplication } from './adminHarness.js';

/**
 * E3 Job management, E4 application review and secure résumé access, E5
 * status / notes / audit / communications (Doc 18 §§226-245; Doc 12 §§12-165;
 * Doc 11 §§161-179, §277-279). Synthetic data only.
 */

const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const CONNECT = { serverSelectionTimeoutMS: 5000, autoIndex: false, autoCreate: false };
const audit = () => mongoose.connection.collection('audit_events').find({}).sort({ occurredAt: 1, _id: 1 }).toArray();

beforeAll(async () => {
  await mongoose.connect(TEST_URI, CONNECT);
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  for (const required of REQUIRED_INDEXES) {
    await mongoose.connection.db.collection(required.collection).createIndex(required.key, { name: required.name, ...required.options });
  }
}, 30_000);

afterAll(async () => {
  await clearAdminCollections();
  await mongoose.disconnect();
}, 30_000);

let env;
let owner;
let recruiter;
beforeEach(async () => {
  await clearAdminCollections();
  env = buildAdminApp({ uri: TEST_URI });
  owner = await readyAdmin({ ...env, email: 'qa-owner@example.invalid', displayName: 'QA Owner' });
  recruiter = await readyAdmin({ ...env, email: 'qa-recruiter@example.invalid', roles: ['RECRUITMENT_ADMIN'], displayName: 'QA Recruiter' });
});

async function publishedJob(slug = 'qa-e3-published') {
  const created = await recruiter.client.post('/api/v1/admin/jobs', qaJobDefinition(slug), recruiter.csrf).expect(201);
  await recruiter.client.post(`/api/v1/admin/jobs/${created.body.data.job.id}/publish`, {}, recruiter.csrf).expect(200);
  return Job.findById(created.body.data.job.id);
}

describe('E3 — Job management through the validated provisioning path', () => {
  it('creates a DRAFT, refuses an invalid or duplicate definition, edits, previews and walks the lifecycle', async () => {
    const c = recruiter.client;
    const invalid = await c.post('/api/v1/admin/jobs', { ...qaJobDefinition('qa-e3-role'), weeklyHours: 500, status: 'PUBLISHED' }, recruiter.csrf).expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_FAILED');
    expect(invalid.body.error.fieldErrors.map((f) => f.field)).toContain('weeklyHours');

    // A Draft that is not yet complete can be saved but not published (Doc 12 s25-26).
    const draft = await c.post('/api/v1/admin/jobs', qaJobDefinition('qa-e3-role', { responsibilities: [] }), recruiter.csrf).expect(201);
    const id = draft.body.data.job.id;
    expect(draft.body.data.job.status).toBe('DRAFT'); // never anything else on creation (s19)
    await c.post('/api/v1/admin/jobs', qaJobDefinition('qa-e3-role'), recruiter.csrf).expect(409);
    const detail = await c.get(`/api/v1/admin/jobs/${id}`).expect(200);
    expect(detail.body.data.publishProblems).toContain('responsibilities');
    const refused = await c.post(`/api/v1/admin/jobs/${id}/publish`, {}, recruiter.csrf).expect(409);
    expect(refused.body.error.code).toBe('JOB_CHANGE_REFUSED');

    const edited = await c.patch(`/api/v1/admin/jobs/${id}`, { ...qaJobDefinition('qa-e3-role', { responsibilities: ['QA TEST DATA responsibility.'] }), slug: 'ignored-slug' }, recruiter.csrf).expect(200);
    expect(edited.body.data.changed).toContain('responsibilities');
    expect(edited.body.data.job.slug).toBe('qa-e3-role'); // the slug is never changed by an edit
    const preview = await c.get(`/api/v1/admin/jobs/${id}/preview`).expect(200);
    expect(preview.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(preview.body.data.preview.title).toBe('QA Synthetic Role qa-e3-role');

    const published = await c.post(`/api/v1/admin/jobs/${id}/publish`, {}, recruiter.csrf).expect(200);
    expect(published.body.data.job).toMatchObject({ status: 'PUBLISHED', accepting: true });
    await c.post(`/api/v1/admin/jobs/${id}/publish`, {}, recruiter.csrf).expect(409); // not from PUBLISHED
    await c.post(`/api/v1/admin/jobs/${id}/close`, {}, recruiter.csrf).expect(200);
    const reopened = await c.post(`/api/v1/admin/jobs/${id}/reopen`, {}, recruiter.csrf).expect(200);
    expect(reopened.body.data.job.status).toBe('PUBLISHED');
    const stored = await Job.findById(id).lean();
    expect(stored.publishedAt).toBeInstanceOf(Date); // first publication time kept (s36)
    await c.post(`/api/v1/admin/jobs/${id}/close`, {}, recruiter.csrf).expect(200);
    await c.post(`/api/v1/admin/jobs/${id}/archive`, {}, recruiter.csrf).expect(200);
    await c.patch(`/api/v1/admin/jobs/${id}`, qaJobDefinition('qa-e3-role'), recruiter.csrf).expect(409);

    const actions = (await audit()).filter((e) => e.resource.type === 'JOB').map((e) => e.action);
    expect(actions).toEqual(['JOB_CREATED', 'JOB_UPDATED', 'JOB_PUBLISHED', 'JOB_CLOSED', 'JOB_REOPENED', 'JOB_CLOSED', 'JOB_ARCHIVED']);
  });

  it('requires confirmation for a material change once Applications exist (Doc 12 s41)', async () => {
    const job = await publishedJob();
    await seedApplication({ job, storage: env.resumeStorage });
    const change = qaJobDefinition(job.slug, { weeklyHours: 20 });
    const unconfirmed = await recruiter.client.patch(`/api/v1/admin/jobs/${job._id}`, change, recruiter.csrf).expect(409);
    expect(unconfirmed.body.error.code).toBe('MATERIAL_CHANGE_CONFIRMATION_REQUIRED');
    expect((await Job.findById(job._id).lean()).weeklyHours).toBe(30);
    await recruiter.client.patch(`/api/v1/admin/jobs/${job._id}`, { ...change, confirmMaterialChange: true }, recruiter.csrf).expect(200);
    expect((await Job.findById(job._id).lean()).weeklyHours).toBe(20);
    const list = await recruiter.client.get('/api/v1/admin/jobs').expect(200);
    expect(list.body.data.items[0]).toMatchObject({ slug: job.slug, applicationCount: 1 });
  });
});

describe('E4 — applications and secure résumé review', () => {
  it('lists with server-side search, filters and pagination; a regex in the search is plain text (Doc 12 s149-155)', async () => {
    const job = await publishedJob();
    await seedApplication({ job, storage: env.resumeStorage, fullName: 'Ada QA Lovelace', email: 'ada.qa@example.invalid', submittedAt: new Date('2026-11-18T09:00:00Z') });
    await seedApplication({ job, storage: env.resumeStorage, fullName: 'Grace QA Hopper', email: 'grace.qa@example.invalid', submittedAt: new Date('2026-11-19T09:00:00Z') });
    await seedApplication({ job, storage: env.resumeStorage, fullName: 'Grace QA Hopper', email: 'grace.qa@example.invalid', submittedAt: new Date('2026-11-20T09:00:00Z') });
    const all = await recruiter.client.get('/api/v1/admin/applications?limit=2').expect(200);
    expect(all.body.data.pagination).toMatchObject({ total: 3, totalPages: 2 });
    expect(all.body.data.items[0].submittedAt).toBe('2026-11-20T09:00:00.000Z'); // newest first
    expect(all.body.data.items[0].possibleDuplicate).toBe(true);
    const byName = await recruiter.client.get('/api/v1/admin/applications?q=ada').expect(200);
    expect(byName.body.data.items.map((i) => i.candidateName)).toEqual(['Ada QA Lovelace']);
    const byEmail = await recruiter.client.get('/api/v1/admin/applications?q=grace.qa@').expect(200);
    expect(byEmail.body.data.pagination.total).toBe(2);
    const regex = await recruiter.client.get(`/api/v1/admin/applications?q=${encodeURIComponent('.*')}`).expect(200);
    expect(regex.body.data.pagination.total).toBe(0);
    await recruiter.client.get('/api/v1/admin/applications?status=$ne').expect(400);
    const dated = await recruiter.client.get('/api/v1/admin/applications?from=2026-11-19&to=2026-11-19').expect(200);
    expect(dated.body.data.pagination.total).toBe(1);
  });

  it('shows the full detail without ever exposing the private storage key (Doc 11 s168, Doc 12 s156-159)', async () => {
    const job = await publishedJob();
    const { application } = await seedApplication({ job, storage: env.resumeStorage });
    const res = await recruiter.client.get(`/api/v1/admin/applications/${application._id}`).expect(200);
    const data = res.body.data.application;
    expect(JSON.stringify(res.body)).not.toContain(application.resume.storageKey);
    expect(JSON.stringify(res.body)).not.toMatch(/storageKey|checksumSha256|idempotency/);
    expect(data.resume).toMatchObject({ scanStatus: 'CLEAN', available: true, originalFilename: 'QA résumé.pdf' });
    expect(data.statusHistory).toEqual([expect.objectContaining({ fromStatus: null, toStatus: 'RECEIVED', changedBy: 'System' })]);
    expect(data.appliedRole.title).toBe(job.title);
    expect(res.body.data.allowedNextStatuses.map((s) => s.status)).toEqual(['IN_REVIEW', 'ON_HOLD', 'NOT_SELECTED', 'WITHDRAWN']);
    await recruiter.client.get('/api/v1/admin/applications/000000000000000000000000').expect(404);
    await recruiter.client.get('/api/v1/admin/applications/not-an-id').expect(404);
  });

  it('releases a CLEAN résumé as an attachment and audits the access first (Doc 11 s166, s172-177)', async () => {
    const job = await publishedJob();
    const { application, bytes } = await seedApplication({ job, storage: env.resumeStorage });
    const res = await recruiter.client.get(`/api/v1/admin/applications/${application._id}/resume`).buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(Buffer.compare(res.body, bytes)).toBe(0);
    expect(res.headers['content-type']).toMatch(/^application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="QA r_sum_\.pdf"; filename\*=UTF-8''QA%20r%C3%A9sum%C3%A9\.pdf$/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');
    const events = (await audit()).filter((e) => e.action === 'RESUME_ACCESSED');
    expect(events).toHaveLength(1);
    expect(String(events[0].resource.id)).toBe(String(application._id));
    expect(JSON.stringify(events[0])).not.toMatch(/résumé|example\.invalid|QA Synthetic Candidate/); // no PII in audit (s177)
  });

  it.each(['NOT_SCANNED', 'PENDING', 'QUARANTINED', 'FAILED'])('never releases a résumé whose scan status is %s (Doc 11 s173, s279)', async (scanStatus) => {
    const job = await publishedJob();
    const { application } = await seedApplication({ job, storage: env.resumeStorage, scanStatus });
    const res = await recruiter.client.get(`/api/v1/admin/applications/${application._id}/resume`).expect(409);
    expect(res.body.error.code).toBe('RESUME_NOT_AVAILABLE');
    expect((await audit()).some((e) => e.action === 'RESUME_ACCESSED')).toBe(false);
    const detail = await recruiter.client.get(`/api/v1/admin/applications/${application._id}`).expect(200);
    expect(detail.body.data.application.resume.available).toBe(false);
  });

  it('does not serve a résumé to anyone without a session, and has no public storage path (Doc 11 s274, s278)', async () => {
    const job = await publishedJob();
    const { application } = await seedApplication({ job, storage: env.resumeStorage });
    const request = (await import('supertest')).default;
    await request(env.app).get(`/api/v1/admin/applications/${application._id}/resume`).expect(401);
    await request(env.app).get(`/api/v1/${application.resume.storageKey}`).expect(404);
  });
});

describe('E5 — status, notes, communications and audit', () => {
  it('moves through real stages, refuses invalid jumps, and records an append-only history', async () => {
    const job = await publishedJob();
    const { application } = await seedApplication({ job, storage: env.resumeStorage });
    const url = `/api/v1/admin/applications/${application._id}/status`;
    const c = recruiter.client;
    const jump = await c.post(url, { fromStatus: 'RECEIVED', toStatus: 'SELECTED' }, recruiter.csrf).expect(400);
    expect(jump.body.error.code).toBe('TRANSITION_NOT_ALLOWED');
    await c.post(url, { fromStatus: 'RECEIVED', toStatus: 'IN_REVIEW' }, recruiter.csrf).expect(200);
    await c.post(url, { fromStatus: 'IN_REVIEW', toStatus: 'INTERVIEW' }, recruiter.csrf).expect(200); // no fake SCREENING step (s87)
    await c.post(url, { fromStatus: 'INTERVIEW', toStatus: 'FINAL_REVIEW' }, recruiter.csrf).expect(200);
    await c.post(url, { fromStatus: 'FINAL_REVIEW', toStatus: 'NOT_SELECTED' }, recruiter.csrf).expect(200);
    const stored = await Application.findById(application._id).lean();
    expect(stored.status).toBe('NOT_SELECTED');
    expect(stored.statusHistory.map((h) => `${h.fromStatus}>${h.toStatus}`)).toEqual(['null>RECEIVED', 'RECEIVED>IN_REVIEW', 'IN_REVIEW>INTERVIEW', 'INTERVIEW>FINAL_REVIEW', 'FINAL_REVIEW>NOT_SELECTED']);
    expect(String(stored.statusHistory[1].changedByAdminId)).toBe(String(recruiter.admin._id));
  });

  it('refuses a stale status update instead of overwriting a newer decision (Doc 18 s245)', async () => {
    const job = await publishedJob();
    const { application } = await seedApplication({ job, storage: env.resumeStorage });
    const url = `/api/v1/admin/applications/${application._id}/status`;
    // Both Admins opened the Application while it was RECEIVED.
    await owner.client.post(url, { fromStatus: 'RECEIVED', toStatus: 'IN_REVIEW' }, owner.csrf).expect(200);
    const stale = await recruiter.client.post(url, { fromStatus: 'RECEIVED', toStatus: 'NOT_SELECTED' }, recruiter.csrf).expect(409);
    expect(stale.body.error.code).toBe('STATUS_CONFLICT');
    // Concurrent requests from the same state: exactly one wins.
    const results = await Promise.all([
      owner.client.post(url, { fromStatus: 'IN_REVIEW', toStatus: 'SCREENING' }, owner.csrf),
      recruiter.client.post(url, { fromStatus: 'IN_REVIEW', toStatus: 'ASSESSMENT' }, recruiter.csrf),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const stored = await Application.findById(application._id).lean();
    expect(stored.statusHistory).toHaveLength(3);
  });

  it('lets only an owner reopen a decided Application, and only with a reason (Doc 12 s88-92)', async () => {
    const job = await publishedJob();
    const { application } = await seedApplication({ job, storage: env.resumeStorage });
    const url = `/api/v1/admin/applications/${application._id}/status`;
    await recruiter.client.post(url, { fromStatus: 'RECEIVED', toStatus: 'WITHDRAWN' }, recruiter.csrf).expect(200);
    expect((await recruiter.client.post(url, { fromStatus: 'WITHDRAWN', toStatus: 'IN_REVIEW', reason: 'QA' }, recruiter.csrf).expect(403)).body.error.code).toBe('CORRECTION_REQUIRES_OWNER');
    expect((await owner.client.post(url, { fromStatus: 'WITHDRAWN', toStatus: 'IN_REVIEW' }, owner.csrf).expect(400)).body.error.code).toBe('REASON_REQUIRED');
    await owner.client.post(url, { fromStatus: 'WITHDRAWN', toStatus: 'IN_REVIEW', reason: 'QA: withdrawal was recorded on the wrong Application.' }, owner.csrf).expect(200);
    const stored = await Application.findById(application._id).lean();
    expect(stored.statusHistory.at(-1).reason).toBe('QA: withdrawal was recorded on the wrong Application.');
    const event = (await audit()).filter((e) => e.action === 'APPLICATION_STATUS_CHANGED').at(-1);
    expect(event.metadata).toEqual({ fromStatus: 'WITHDRAWN', toStatus: 'IN_REVIEW', reasonProvided: true });
  });

  it('adds internal notes and recorded communications; the audit never copies their content (Doc 12 s96-114, Doc 11 s202)', async () => {
    const job = await publishedJob();
    const { application } = await seedApplication({ job, storage: env.resumeStorage });
    const base = `/api/v1/admin/applications/${application._id}`;
    const note = await recruiter.client.post(`${base}/notes`, { body: 'QA note: strong portfolio, confirm availability.' }, recruiter.csrf).expect(201);
    expect(note.body.data.note.author).toBe('QA Recruiter');
    await recruiter.client.post(`${base}/notes`, { body: '' }, recruiter.csrf).expect(400);
    await recruiter.client.post(`${base}/notes`, { body: 'x'.repeat(5001) }, recruiter.csrf).expect(400);
    const comm = await recruiter.client
      .post(`${base}/communications`, { kind: 'INTERVIEW', direction: 'OUTBOUND', subject: 'QA interview invitation', summary: 'QA: invited for a 30-minute call via careers@.' }, recruiter.csrf)
      .expect(201);
    expect(comm.body.data.communication).toMatchObject({ status: 'RECORDED_EXTERNAL', channel: 'EMAIL', actorName: 'QA Recruiter' });
    await recruiter.client.post(`${base}/communications`, { kind: 'INTERVIEW', direction: 'OUTBOUND', occurredAt: '2099-01-01T00:00:00Z' }, recruiter.csrf).expect(400);
    await recruiter.client.post(`${base}/communications`, { kind: 'MAGIC', direction: 'OUTBOUND' }, recruiter.csrf).expect(400);

    const detail = await owner.client.get(base).expect(200);
    expect(detail.body.data.application.notes.map((n) => n.body)).toEqual(['QA note: strong portfolio, confirm availability.']);
    expect(detail.body.data.application.communications[0]).toMatchObject({ kind: 'INTERVIEW', subject: 'QA interview invitation' });

    const events = await audit();
    const appEvents = events.filter((e) => e.resource.type === 'APPLICATION');
    expect(appEvents.map((e) => e.action)).toEqual(['APPLICATION_NOTE_ADDED', 'APPLICATION_COMMUNICATION_RECORDED']);
    const raw = JSON.stringify(events);
    expect(raw).not.toMatch(/strong portfolio|interview invitation|30-minute|example\.invalid/);

    // The owner sees it in the audit view; the recruiter cannot.
    const view = await owner.client.get(`/api/v1/admin/audit?resourceType=APPLICATION&resourceId=${application._id}`).expect(200);
    expect(view.body.data.items.map((i) => i.action)).toEqual(['APPLICATION_COMMUNICATION_RECORDED', 'APPLICATION_NOTE_ADDED']);
    expect(view.body.data.items[0].actor).toBe('QA Recruiter');
    await recruiter.client.get('/api/v1/admin/audit').expect(403);
  });

  it('keeps history, notes and communications append-only at the model level', async () => {
    const job = await publishedJob();
    const { application } = await seedApplication({ job, storage: env.resumeStorage });
    await recruiter.client.post(`/api/v1/admin/applications/${application._id}/notes`, { body: 'QA original note.' }, recruiter.csrf).expect(201);
    const doc = await Application.findById(application._id);
    doc.notes[0].body = 'QA rewritten note.';
    await expect(doc.save()).rejects.toThrow(/append-only/);
    const doc2 = await Application.findById(application._id);
    doc2.statusHistory.pop();
    await expect(doc2.save()).rejects.toThrow(/append-only/);
  });

  it('reports only real numbers on the overview (Doc 12 s142-143)', async () => {
    const job = await publishedJob();
    await seedApplication({ job, storage: env.resumeStorage });
    await seedApplication({ job, storage: env.resumeStorage, scanStatus: 'NOT_SCANNED' });
    const res = await recruiter.client.get('/api/v1/admin/overview').expect(200);
    expect(res.body.data).toEqual({
      jobs: { accepting: 1, byStatus: { PUBLISHED: 1 } },
      applications: { total: 2, awaitingReview: 2, byStatus: { RECEIVED: 2 }, resumesAwaitingScan: 1 },
    });
  });
});
