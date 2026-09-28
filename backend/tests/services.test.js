import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { Job } from '../src/models/Job.js';
import {
  checkPublishReadiness, effectiveApplicationStatus, applyJobEdit, ALLOWED_TRANSITIONS, JobLifecycleError,
} from '../src/modules/jobs/job.service.js';
import {
  buildApplication, buildJobSnapshot, buildScreeningAnswer, hashIdempotencyKey, buildRequestFingerprint,
} from '../src/modules/applications/application.service.js';

/** A Job complete enough to publish. */
const publishableJob = (overrides = {}) =>
  new Job({
    title: 'Cybersecurity Specialist',
    slug: 'cybersecurity-specialist',
    location: { displayName: 'British Columbia, Canada', countryCode: 'CA' },
    workArrangement: 'FULLY_REMOTE',
    employmentType: 'PART_TIME',
    schedule: '30 hours per week',
    weeklyHours: 30,
    compensation: { currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: true },
    description: 'Approved role description.',
    responsibilities: ['Responsibility one.'],
    requirements: ['Requirement one.'],
    ...overrides,
  });

describe('publish readiness (Doc 10 section 64)', () => {
  it('accepts a complete Job', () => {
    expect(checkPublishReadiness(publishableJob())).toEqual({ ready: true, missing: [] });
  });

  it('lists everything an empty draft is missing', () => {
    const { ready, missing } = checkPublishReadiness(new Job({ title: 'Draft Title', slug: 'draft' }));
    expect(ready).toBe(false);
    expect(missing).toEqual(
      expect.arrayContaining([
        'location.displayName', 'location.countryCode', 'workArrangement',
        'employmentType', 'weeklyHours', 'compensation', 'description',
        'responsibilities', 'requirements',
      ]),
    );
  });

  it.each([
    ['location.displayName', { location: { countryCode: 'CA' } }],
    ['workArrangement', { workArrangement: null }],
    ['employmentType', { employmentType: null }],
    ['description', { description: '   ' }],
    ['responsibilities', { responsibilities: [] }],
    ['requirements', { requirements: [] }],
  ])('blocks publication when %s is incomplete', (field, overrides) => {
    const { ready, missing } = checkPublishReadiness(publishableJob(overrides));
    expect(ready).toBe(false);
    expect(missing.some((entry) => entry.includes(field.split('.')[0]))).toBe(true);
  });

  it('requires a complete compensation object, not a partial one', () => {
    const partial = publishableJob({ compensation: { currency: 'CAD' } });
    expect(checkPublishReadiness(partial).missing).toContain('compensation');
  });

  it('accepts weeklyHours alone as adequate schedule information', () => {
    const job = publishableJob({ schedule: null });
    expect(checkPublishReadiness(job).ready).toBe(true);
  });
});

describe('lifecycle transitions (Doc 10 section 58)', () => {
  it('permits exactly the canonical transitions', () => {
    expect(ALLOWED_TRANSITIONS).toEqual({
      DRAFT: ['PUBLISHED', 'ARCHIVED'],
      PUBLISHED: ['CLOSED'],
      CLOSED: ['PUBLISHED', 'ARCHIVED'],
      ARCHIVED: [],
    });
  });

  it('treats ARCHIVED as terminal', () => {
    expect(ALLOWED_TRANSITIONS.ARCHIVED).toHaveLength(0);
  });
});

describe('effective application status (Doc 10 section 63)', () => {
  const now = new Date('2026-06-01T12:00:00.000Z');
  const past = new Date('2026-05-01T00:00:00.000Z');
  const future = new Date('2026-07-01T00:00:00.000Z');

  it('is OPEN when published, live and not yet closing', () => {
    expect(effectiveApplicationStatus(publishableJob({ status: 'PUBLISHED', publishedAt: past }), now)).toBe('OPEN');
  });

  it('is CLOSED once closesAt has passed, even while stored as PUBLISHED', () => {
    const job = publishableJob({ status: 'PUBLISHED', publishedAt: past, closesAt: past });
    expect(job.status).toBe('PUBLISHED');
    expect(effectiveApplicationStatus(job, now)).toBe('CLOSED');
  });

  it('is OPEN while closesAt is still in the future', () => {
    expect(effectiveApplicationStatus(publishableJob({ status: 'PUBLISHED', publishedAt: past, closesAt: future }), now)).toBe('OPEN');
  });

  it.each(['DRAFT', 'CLOSED', 'ARCHIVED'])('is CLOSED for status %s', (status) => {
    expect(effectiveApplicationStatus(publishableJob({ status, publishedAt: past }), now)).toBe('CLOSED');
  });

  it('is CLOSED before a future publication time', () => {
    expect(effectiveApplicationStatus(publishableJob({ status: 'PUBLISHED', publishedAt: future }), now)).toBe('CLOSED');
  });
});

describe('controlled edits prevent mass assignment', () => {
  it.each(['status', 'publishedAt', 'closedAt', 'archivedAt', '_id', 'createdAt'])(
    'refuses to set %s through an edit payload',
    (field) => {
      expect(() => applyJobEdit(publishableJob(), { [field]: 'x' })).toThrow(JobLifecycleError);
    },
  );

  it('applies an allowed field', () => {
    const job = applyJobEdit(publishableJob(), { title: 'Updated Title' });
    expect(job.title).toBe('Updated Title');
  });

  it('refuses a slug edit once published', () => {
    const job = publishableJob({ status: 'PUBLISHED', publishedAt: new Date() });
    expect(() => applyJobEdit(job, { slug: 'renamed' })).toThrow(/SLUG_IMMUTABLE/);
  });

  it('allows a slug edit while never published', () => {
    expect(applyJobEdit(publishableJob(), { slug: 'new-draft-slug' }).slug).toBe('new-draft-slug');
  });
});

describe('job snapshot (Doc 10 sections 77-80)', () => {
  it('flattens location to the public display string', () => {
    expect(buildJobSnapshot(publishableJob()).location).toBe('British Columbia, Canada');
  });

  it('carries the full compensation shape', () => {
    expect(buildJobSnapshot(publishableJob()).compensation).toEqual({
      currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: true,
    });
  });

  it('nulls compensation fields when the Job published none', () => {
    const snapshot = buildJobSnapshot(publishableJob({ compensation: {} }));
    expect(snapshot.compensation).toEqual({ currency: null, amountMinor: null, unit: null, gross: null });
  });
});

describe('idempotency hashing (Doc 10 sections 112-116)', () => {
  it('hashes the key rather than storing it', () => {
    const key = 'b3f1c2d4-aaaa-4bbb-8ccc-ddddeeeeffff';
    const hash = hashIdempotencyKey(key);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(key);
  });

  it('is deterministic and distinct per key', () => {
    expect(hashIdempotencyKey('a')).toBe(hashIdempotencyKey('a'));
    expect(hashIdempotencyKey('a')).not.toBe(hashIdempotencyKey('b'));
  });

  it('canonicalizes the fingerprint across whitespace and case', () => {
    const one = buildRequestFingerprint({ jobId: 'j1', fullName: ' Jane   Doe ', emailNormalized: 'A@B.COM' });
    const two = buildRequestFingerprint({ jobId: 'j1', fullName: 'jane doe', emailNormalized: 'a@b.com' });
    expect(one).toBe(two);
  });

  it('changes when the submission meaningfully changes', () => {
    const base = { jobId: 'j1', fullName: 'Jane Doe', emailNormalized: 'a@b.com' };
    expect(buildRequestFingerprint(base)).not.toBe(buildRequestFingerprint({ ...base, emailNormalized: 'c@d.com' }));
    expect(buildRequestFingerprint(base)).not.toBe(buildRequestFingerprint({ ...base, jobId: 'j2' }));
  });

  it('is order-independent across screening answers', () => {
    const answers = [
      { questionId: 'b', textValue: 'two' },
      { questionId: 'a', textValue: 'one' },
    ];
    const forward = buildRequestFingerprint({ jobId: 'j', fullName: 'n', emailNormalized: 'e@x.com', screeningAnswers: answers });
    const reversed = buildRequestFingerprint({ jobId: 'j', fullName: 'n', emailNormalized: 'e@x.com', screeningAnswers: [...answers].reverse() });
    expect(forward).toBe(reversed);
  });

  it('stores no copy of the candidate payload', () => {
    const fingerprint = buildRequestFingerprint({ jobId: 'j', fullName: 'Jane Doe', emailNormalized: 'jane@example.com' });
    expect(fingerprint).not.toMatch(/Jane|example\.com/);
  });
});

describe('screening answer snapshots', () => {
  it('records the chosen option label at submission time', () => {
    const question = {
      questionId: 'q1', type: 'SINGLE_SELECT', prompt: 'Pick one',
      options: [{ optionId: 'o1', label: 'Option One' }, { optionId: 'o2', label: 'Option Two' }],
    };
    expect(buildScreeningAnswer(question, 'o2')).toEqual({
      questionId: 'q1', promptSnapshot: 'Pick one', typeSnapshot: 'SINGLE_SELECT',
      textValue: null, booleanValue: null, optionId: 'o2', optionLabelSnapshot: 'Option Two',
    });
  });

  it('leaves the other value fields null per type', () => {
    const short = buildScreeningAnswer({ questionId: 'q', type: 'SHORT_TEXT', prompt: 'p' }, '  hi  ');
    expect(short).toMatchObject({ textValue: 'hi', booleanValue: null, optionId: null });
    const yesNo = buildScreeningAnswer({ questionId: 'q', type: 'YES_NO', prompt: 'p' }, true);
    expect(yesNo).toMatchObject({ booleanValue: true, textValue: null, optionId: null });
  });
});

describe('application construction', () => {
  it('builds a valid Application with truthful defaults', async () => {
    const job = publishableJob();
    job._id = new mongoose.Types.ObjectId();
    const application = buildApplication({
      job,
      candidate: { fullName: 'Jane Doe', email: 'Jane@Example.com' },
      resume: {
        storageProvider: 'S3_COMPATIBLE', storageKey: 'resumes/k1', originalFilename: 'cv.pdf',
        extension: '.pdf', mimeType: 'application/pdf', sizeBytes: 2048, checksumSha256: 'c'.repeat(64), storedAt: new Date('2026-09-20T10:00:00.000Z'),
      },
      idempotencyKey: 'client-key',
    });

    await expect(application.validate()).resolves.toBeUndefined();
    expect(application.status).toBe('RECEIVED');
    expect(application.resume.scanStatus).toBe('NOT_SCANNED');
    expect(application.notifications.internal.status).toBe('PENDING');
    expect(application.notifications.candidateAcknowledgement.status).toBe('NOT_REQUIRED');
    expect(application.candidate.emailNormalized).toBe('jane@example.com');
    expect(application.jobId).toBe(job._id);
  });

  it('marks candidate acknowledgement PENDING only when enabled', () => {
    const job = publishableJob();
    job._id = new mongoose.Types.ObjectId();
    const application = buildApplication({
      job,
      candidate: { fullName: 'Jane Doe', email: 'a@b.com' },
      resume: {
        storageProvider: 'S3_COMPATIBLE', storageKey: 'k', originalFilename: 'cv.pdf',
        extension: '.pdf', mimeType: 'application/pdf', sizeBytes: 10, checksumSha256: 'd'.repeat(64), storedAt: new Date('2026-09-20T10:00:00.000Z'),
      },
      idempotencyKey: 'k',
      candidateAcknowledgementEnabled: true,
    });
    expect(application.notifications.candidateAcknowledgement.status).toBe('PENDING');
    // Still never SENT — B6 owns delivery.
    expect(application.notifications.candidateAcknowledgement.sentAt).toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * Doc 10 sections 43, 108 and 114 — reconciled after the first B2 draft.
 * ---------------------------------------------------------------------- */

describe('publish readiness requires a resume (Doc 10 section 43)', () => {
  it('refuses to publish a Job whose configuration does not require a resume', () => {
    const job = publishableJob({ applicationConfig: { resumeRequired: false } });
    expect(checkPublishReadiness(job).missing).toContain('applicationConfig.resumeRequired');
  });
});

describe('request fingerprint covers every section 114 input', () => {
  const base = {
    jobId: 'job-1',
    fullName: 'Jane Doe',
    emailNormalized: 'jane@example.com',
    phone: '+370 600 00000',
    message: 'Hello.\nSecond line.',
    screeningAnswers: [{ questionId: 'q1', textValue: 'Answer', booleanValue: null, optionId: null }],
    resumeChecksumSha256: 'a'.repeat(64),
  };
  const fingerprint = (overrides = {}) => buildRequestFingerprint({ ...base, ...overrides });

  it.each([
    ['jobId', { jobId: 'job-2' }],
    ['full name', { fullName: 'Janet Doe' }],
    ['email', { emailNormalized: 'janet@example.com' }],
    ['phone', { phone: '+370 600 00001' }],
    ['phone being absent', { phone: null }],
    ['message', { message: 'A different message.' }],
    ['a screening answer', { screeningAnswers: [{ questionId: 'q1', textValue: 'Other' }] }],
    ['the resume file', { resumeChecksumSha256: 'b'.repeat(64) }],
  ])('changes when the %s changes', (_label, overrides) => {
    expect(fingerprint(overrides)).not.toBe(fingerprint());
  });

  it('is stable across transport-level differences in the same content', () => {
    expect(
      fingerprint({
        fullName: '  Jane   Doe ',
        emailNormalized: 'JANE@EXAMPLE.COM',
        phone: ' +370 600 00000 ',
        message: '  Hello.\r\nSecond line.  ',
        resumeChecksumSha256: 'A'.repeat(64),
      }),
    ).toBe(fingerprint());
  });

  it('treats canonically equivalent Unicode names as the same name', () => {
    const composed = 'Ólafsdóttir';
    const decomposed = composed.normalize('NFD');
    expect(decomposed).not.toBe(composed);
    expect(fingerprint({ fullName: decomposed })).toBe(fingerprint({ fullName: composed }));
  });

  it('is what buildApplication stores, including the resume checksum', () => {
    const job = publishableJob();
    job._id = new mongoose.Types.ObjectId();
    const resume = (checksum) => ({
      storageProvider: 'S3_COMPATIBLE', storageKey: `resumes/${checksum[0]}`, originalFilename: 'cv.pdf',
      extension: '.pdf', mimeType: 'application/pdf', sizeBytes: 10, checksumSha256: checksum,
      storedAt: new Date('2026-09-20T10:00:00.000Z'),
    });
    const build = (checksum) => buildApplication({
      job, candidate: { fullName: 'Jane Doe', email: 'jane@example.com' }, resume: resume(checksum), idempotencyKey: 'same-key',
    });
    const first = build('a'.repeat(64));
    const second = build('b'.repeat(64));
    expect(first.idempotency.keyHash).toBe(second.idempotency.keyHash);
    expect(first.idempotency.requestFingerprintHash).not.toBe(second.idempotency.requestFingerprintHash);
    // Never the raw content.
    expect(first.idempotency.requestFingerprintHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('application construction uses controlled inputs', () => {
  const job = publishableJob();
  job._id = new mongoose.Types.ObjectId();
  const resume = {
    storageProvider: 'S3_COMPATIBLE', storageKey: 'resumes/k9', originalFilename: 'cv.pdf',
    extension: '.pdf', mimeType: 'application/pdf', sizeBytes: 10, checksumSha256: 'e'.repeat(64),
  };

  it('does not invent a storage time', async () => {
    const application = buildApplication({
      job, candidate: { fullName: 'Jane Doe', email: 'jane@example.com' }, resume, idempotencyKey: 'k',
    });
    const error = await application.validate().then(() => null, (caught) => caught);
    expect(Object.keys(error.errors)).toContain('resume.storedAt');
  });

  it('copies screening answers field by field, dropping anything else', async () => {
    const application = buildApplication({
      job,
      candidate: { fullName: 'Jane Doe', email: 'jane@example.com' },
      resume: { ...resume, storedAt: new Date() },
      idempotencyKey: 'k',
      screeningAnswers: [{
        questionId: '0c1b7a52-3f6e-4b5c-9d21-7e8f9a0b1c2d', promptSnapshot: 'Why?', typeSnapshot: 'SHORT_TEXT', textValue: 'Because.',
        status: 'HIRED', isAdmin: true,
      }],
    });
    await expect(application.validate()).resolves.toBeUndefined();
    const stored = application.toObject().screeningAnswers[0];
    expect(stored).not.toHaveProperty('status');
    expect(stored).not.toHaveProperty('isAdmin');
    expect(application.status).toBe('RECEIVED');
  });
});
