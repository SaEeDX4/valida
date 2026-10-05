import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { hashIdempotencyKey } from '../src/modules/applications/application.service.js';
import { PDF_MIME, DOCX_MIME, syntheticPdf, syntheticDocx, syntheticPdfOfSize, EXECUTABLE_BYTES } from './fixtures/resumeFiles.js';
import {
  QA_CANDIDATE,
  QA_LONG_QUESTION_ID,
  QA_NOW,
  QA_OPTION_A,
  QA_OPTION_B,
  QA_SELECT_QUESTION_ID,
  QA_TEXT_QUESTION_ID,
  QA_YES_NO_QUESTION_ID,
  applyRequest,
  createApplyEnvironment,
  qaAnswers,
  qaJob,
} from './fixtures/applyHarness.js';

/**
 * B5 — POST /api/v1/jobs/:jobSlug/applications through the REAL app (offline).
 *
 * Real: middleware stack, B4 multipart + resume validation, local private
 * storage (fresh temp root), submission service, notification boundary.
 * In-memory: the Job and Application repositories (see applyHarness.js) —
 * persistence, unique indexes and concurrency against MongoDB are proven in
 * tests/db/b5-apply.test.js.
 */
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

let env;
afterEach(async () => {
  await env?.cleanup();
  env = undefined;
});

describe('a valid Application', () => {
  beforeEach(async () => {
    env = await createApplyEnvironment();
  });

  it('is accepted with 201 and EXACTLY the Doc 09 section 125 body', async () => {
    const response = await applyRequest(env.app);
    expect(response.status).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    expect(response.body).toEqual({
      success: true,
      data: {
        status: 'RECEIVED',
        job: { title: 'QA Synthetic Apply Role', slug: 'qa-synthetic-apply-role' },
        submittedAt: QA_NOW.toISOString(),
      },
      meta: { requestId: response.headers['x-request-id'], replayed: false },
    });
  });

  it('persists one Application with the snapshot, normalised candidate data and server-derived resume metadata', async () => {
    const pdf = syntheticPdf();
    const key = randomUUID();
    const response = await applyRequest(env.app, {
      key,
      fields: { phone: `  ${QA_CANDIDATE.phone}  `, message: `  ${QA_CANDIDATE.message}  ` },
      resume: { data: pdf, filename: 'QA résumé final.pdf', contentType: PDF_MIME },
    });
    expect(response.status).toBe(201);
    const [record] = env.applications.all();
    expect(env.applications.all()).toHaveLength(1);

    const job = [...env.jobs.jobs.values()][0];
    expect(String(record.jobId)).toBe(String(job._id));
    expect(record.jobSnapshot).toEqual({
      title: 'QA Synthetic Apply Role',
      slug: 'qa-synthetic-apply-role',
      location: 'QA Region, Canada',
      workArrangement: 'FULLY_REMOTE',
      employmentType: 'PART_TIME',
      schedule: 'QA TEST DATA schedule',
      weeklyHours: 30,
      compensation: { currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: true },
    });
    expect(record.candidate).toEqual({
      fullName: QA_CANDIDATE.fullName,
      email: QA_CANDIDATE.email,
      emailNormalized: QA_CANDIDATE.email.toLowerCase(),
      phone: QA_CANDIDATE.phone,
      message: QA_CANDIDATE.message,
    });
    expect(record.screeningAnswers).toEqual([
      {
        questionId: QA_YES_NO_QUESTION_ID,
        promptSnapshot: 'QA TEST DATA: can you work the stated hours?',
        typeSnapshot: 'YES_NO',
        textValue: null,
        booleanValue: true,
        optionId: null,
        optionLabelSnapshot: null,
      },
      {
        questionId: QA_SELECT_QUESTION_ID,
        promptSnapshot: 'QA TEST DATA: preferred start window?',
        typeSnapshot: 'SINGLE_SELECT',
        textValue: null,
        booleanValue: null,
        optionId: QA_OPTION_B,
        optionLabelSnapshot: 'QA option B',
      },
      {
        questionId: QA_TEXT_QUESTION_ID,
        promptSnapshot: 'QA TEST DATA: short answer?',
        typeSnapshot: 'SHORT_TEXT',
        textValue: 'QA TEST DATA short',
        booleanValue: null,
        optionId: null,
        optionLabelSnapshot: null,
      },
    ]);
    expect(record.status).toBe('RECEIVED');
    expect(record.submittedAt).toEqual(QA_NOW);
    // Doc 10 sections 94-108 — server-derived, NOT_SCANNED, never CLEAN.
    expect(record.resume).toMatchObject({
      storageProvider: 'LOCAL_DEVELOPMENT',
      originalFilename: 'QA résumé final.pdf',
      extension: '.pdf',
      mimeType: PDF_MIME,
      sizeBytes: pdf.length,
      checksumSha256: sha256(pdf),
      scanStatus: 'NOT_SCANNED',
      scanCheckedAt: null,
    });
    expect(record.resume.storageKey).toMatch(/^resumes\/[0-9a-f]{32}\/[0-9a-f]{32}$/);
    expect(record.resume.storedAt).toBeInstanceOf(Date);
    // Doc 10 sections 112-116 — hashes only; the raw key is not retained.
    expect(record.idempotency.keyHash).toBe(hashIdempotencyKey(key));
    expect(record.idempotency.requestFingerprintHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(record)).not.toContain(key);
    // B5 has no provider: nothing attempted, nothing claimed.
    expect(record.notifications.internal).toMatchObject({ status: 'PENDING', attemptCount: 0, sentAt: null, lastErrorCode: null });
    expect(record.notifications.candidateAcknowledgement).toMatchObject({ status: 'NOT_REQUIRED', attemptCount: 0 });
    expect(record.retention).toEqual({ policyVersion: null, retainUntil: null });

    // The private object holds exactly the uploaded bytes; no temporary file remains.
    const stored = fs.readFileSync(path.join(env.intake.storageRoot, ...record.resume.storageKey.split('/')));
    expect(stored.equals(pdf)).toBe(true);
    expect(env.storedObjects()).toHaveLength(1);
    expect(env.tempFiles()).toEqual([]);
  });

  it('accepts a DOCX resume and a Job without phone, message or questions', async () => {
    env.jobs.put(
      qaJob(
        {
          slug: 'qa-minimal-role',
          applicationConfig: {
            resumeRequired: true,
            phone: { enabled: false, required: false },
            message: { enabled: false, required: false, maxLength: 5000 },
            screeningQuestions: [],
          },
        },
        { questions: false },
      ),
    );
    const response = await applyRequest(env.app, {
      slug: 'qa-minimal-role',
      answers: null,
      resume: { data: syntheticDocx(), filename: 'qa.docx', contentType: DOCX_MIME },
    });
    expect(response.status).toBe(201);
    const record = env.applications.all().find((item) => item.jobSnapshot.slug === 'qa-minimal-role');
    expect(record.candidate.phone).toBeNull();
    expect(record.candidate.message).toBeNull();
    expect(record.screeningAnswers).toEqual([]);
    expect(record.resume.extension).toBe('.docx');
  });

  it('the response never echoes candidate data, the file name, the storage key or internal identifiers', async () => {
    const response = await applyRequest(env.app, { fields: { phone: QA_CANDIDATE.phone, message: QA_CANDIDATE.message } });
    const text = JSON.stringify(response.body);
    const [record] = env.applications.all();
    for (const secret of [
      QA_CANDIDATE.email,
      QA_CANDIDATE.email.toLowerCase(),
      QA_CANDIDATE.fullName,
      QA_CANDIDATE.phone,
      'QA TEST DATA message',
      'qa-resume.pdf',
      record.resume.storageKey,
      String(record._id),
      String(record.jobId),
      'LOCAL_DEVELOPMENT',
      record.idempotency.keyHash,
    ]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe('idempotency', () => {
  beforeEach(async () => {
    env = await createApplyEnvironment();
  });

  it('the same key and the same submission replay the original result: 200, replayed, nothing new', async () => {
    const key = randomUUID();
    const pdf = syntheticPdf();
    const resume = { data: pdf, filename: 'qa-resume.pdf', contentType: PDF_MIME };
    const first = await applyRequest(env.app, { key, resume });
    const second = await applyRequest(env.app, { key, resume });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual(first.body.data);
    expect(second.body.meta.replayed).toBe(true);
    expect(env.applications.all()).toHaveLength(1);
    expect(env.storedObjects()).toHaveLength(1);
    expect(env.tempFiles()).toEqual([]);
  });

  it.each([
    ['another email', { fields: { email: 'qa.other@example.invalid' } }],
    ['another name', { fields: { fullName: 'QA Other Candidate' } }],
    ['another phone', { fields: { phone: '+1 555 010 0100' } }],
    ['another answer', { answers: [{ questionId: QA_YES_NO_QUESTION_ID, answer: false }] }],
    ['another resume file', { resume: { data: syntheticPdf({ text: 'QA TEST DOCUMENT - OTHER FILE' }), filename: 'qa-resume.pdf', contentType: PDF_MIME } }],
  ])('the same key with %s is 409 IDEMPOTENCY_KEY_REUSED, and nothing is created or stored', async (_label, change) => {
    const key = randomUUID();
    expect((await applyRequest(env.app, { key })).status).toBe(201);
    const conflict = await applyRequest(env.app, { key, ...change });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toEqual({
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: 'This Idempotency-Key was already used for a different submission. Use a new key for a new application.',
    });
    expect(env.applications.all()).toHaveLength(1);
    expect(env.storedObjects()).toHaveLength(1);
    expect(env.tempFiles()).toEqual([]);
  });

  it('the same key for ANOTHER Job is a conflict, not a second Application', async () => {
    const second = qaJob({ slug: 'qa-second-role' });
    env.jobs.put(second);
    const key = randomUUID();
    expect((await applyRequest(env.app, { key })).status).toBe(201);
    const conflict = await applyRequest(env.app, { key, slug: 'qa-second-role' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(env.applications.all()).toHaveLength(1);
  });

  it('a retry after the response was lost replays the original success — even after the Job has closed (Doc 09 section 121)', async () => {
    const key = randomUUID();
    const resume = { data: syntheticPdf(), filename: 'qa-resume.pdf', contentType: PDF_MIME };
    const first = await applyRequest(env.app, { key, resume });
    expect(first.status).toBe(201);
    const job = [...env.jobs.jobs.values()][0];
    env.jobs.update(job._id, { status: 'CLOSED', closedAt: QA_NOW });
    const retry = await applyRequest(env.app, { key, resume });
    expect(retry.status).toBe(200);
    expect(retry.body.meta.replayed).toBe(true);
    expect(retry.body.data).toEqual(first.body.data);
    // A NEW key for the closed Job is refused.
    const fresh = await applyRequest(env.app, { resume });
    expect(fresh.status).toBe(409);
    expect(fresh.body.error.code).toBe('JOB_NOT_ACCEPTING_APPLICATIONS');
    expect(env.applications.all()).toHaveLength(1);
  });

  it('a retry whose file the B4 validator would refuse (the same bytes renamed .exe) is refused, not replayed (Doc 09 section 109: the resume is validated before the idempotency check)', async () => {
    const key = randomUUID();
    const pdf = syntheticPdf();
    expect((await applyRequest(env.app, { key, resume: { data: pdf, filename: 'qa-resume.pdf', contentType: PDF_MIME } })).status).toBe(201);
    const retry = await applyRequest(env.app, { key, resume: { data: pdf, filename: 'qa-resume.exe', contentType: 'application/octet-stream' } });
    expect(retry.status).toBe(415);
    expect(retry.body.success).toBe(false);
    expect(retry.body.meta.replayed).toBeUndefined();
    expect(env.applications.all()).toHaveLength(1);
    expect(env.storedObjects()).toHaveLength(1);
    expect(env.tempFiles()).toEqual([]);
    expect(env.log.output()).not.toContain('application_replayed');
  });

  it('a replay is not notified again (Doc 09 section 135)', async () => {
    await env.cleanup();
    const { recordingTransport } = await import('./fixtures/applyHarness.js');
    const transport = recordingTransport('accept');
    env = await createApplyEnvironment({ transport });
    const key = randomUUID();
    const resume = { data: syntheticPdf(), filename: 'qa-resume.pdf', contentType: PDF_MIME };
    expect((await applyRequest(env.app, { key, resume })).status).toBe(201);
    expect((await applyRequest(env.app, { key, resume })).status).toBe(200);
    expect(transport.calls).toHaveLength(1);
  });

  it('a different key with the same email is a second Application, not a duplicate (Doc 09 section 81, APP-008)', async () => {
    expect((await applyRequest(env.app)).status).toBe(201);
    expect((await applyRequest(env.app)).status).toBe(201);
    const records = env.applications.all();
    expect(records).toHaveLength(2);
    expect(records[0].candidate.emailNormalized).toBe(records[1].candidate.emailNormalized);
    expect(env.storedObjects()).toHaveLength(2);
  });

  it('concurrent requests with one key: one Application, one stored object; the losers replay (Doc 09 section 120)', async () => {
    let open;
    env.applications.insertGate = new Promise((resolve) => {
      open = resolve;
    });
    const key = randomUUID();
    const resume = { data: syntheticPdf(), filename: 'qa-resume.pdf', contentType: PDF_MIME };
    const pending = Array.from({ length: 5 }, () => applyRequest(env.app, { key, resume }).then((r) => r));
    // All five have stored their resume and reached the insert before any insert runs.
    while (env.applications.calls.insert < 5) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(env.storedObjects()).toHaveLength(5);
    open();
    const responses = await Promise.all(pending);
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 201]);
    expect(responses.every((r) => r.body.data.submittedAt === QA_NOW.toISOString())).toBe(true);
    expect(env.applications.all()).toHaveLength(1);
    // The losers removed their own objects; the winner's remains and is the referenced one.
    expect(env.storedObjects()).toHaveLength(1);
    const [record] = env.applications.all();
    expect(env.storedObjects()[0].split(path.sep).join('/')).toBe(record.resume.storageKey.replace(/^resumes\//, ''));
    expect(env.tempFiles()).toEqual([]);
  });

  it('concurrent requests with one key but DIFFERENT content: one Application; the losers are 409', async () => {
    let open;
    env.applications.insertGate = new Promise((resolve) => {
      open = resolve;
    });
    const key = randomUUID();
    const a = applyRequest(env.app, { key }).then((r) => r);
    const b = applyRequest(env.app, { key, fields: { fullName: 'QA Different Name' } }).then((r) => r);
    while (env.applications.calls.insert < 2) await new Promise((resolve) => setTimeout(resolve, 5));
    open();
    const statuses = (await Promise.all([a, b])).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(env.applications.all()).toHaveLength(1);
    expect(env.storedObjects()).toHaveLength(1);
  });
});
