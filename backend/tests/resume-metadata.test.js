import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  Application, RESUME_EXTENSIONS, RESUME_MAX_BYTES, RESUME_MIME_TYPES, RESUME_SCAN_STATUSES,
} from '../src/models/Application.js';
import { RESUME_FORMATS, RESUME_UPLOAD_POLICY, RESUME_FILENAME_MAX_LENGTH } from '../src/config/resumePolicy.js';
import {
  buildResumeMetadata, discardStoredResume, storeValidatedResume, INITIAL_SCAN_STATE,
} from '../src/modules/applications/resume/resumeStorage.js';
import { AppError, ERROR_CODES, invalidResumeFile, resumeTooLarge, unsupportedResumeType, resumeRequired } from '../src/errors/AppError.js';
import { capturingLogger } from './helpers.js';
import { syntheticPdf } from './fixtures/resumeFiles.js';
import { createIntakeEnvironment } from './fixtures/uploadHarness.js';

/**
 * B4 — resume metadata for the approved Application model (Doc 10 sections
 * 94-108), the scan-state rule (Doc 10 section 105, Doc 13 section 71, Doc 17
 * section 127) and compensation (Doc 09 section 119, Doc 17 section 113).
 */
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

describe('one policy: advertised (B3), enforced (B4) and persisted (B2) agree', () => {
  it('the B3 public policy object is unchanged', () => {
    expect(RESUME_UPLOAD_POLICY).toEqual({ required: true, maxBytes: 5 * 1024 * 1024, allowedExtensions: ['.pdf', '.docx'] });
  });

  it('enforced formats, model enums and limits are the same values', () => {
    expect(Object.keys(RESUME_FORMATS)).toEqual([...RESUME_UPLOAD_POLICY.allowedExtensions]);
    expect(Object.keys(RESUME_FORMATS)).toEqual(RESUME_EXTENSIONS);
    expect(Object.values(RESUME_FORMATS).map(({ mimeType }) => mimeType)).toEqual(RESUME_MIME_TYPES);
    expect(RESUME_UPLOAD_POLICY.maxBytes).toBe(RESUME_MAX_BYTES);
    expect(RESUME_MAX_BYTES).toBe(5_242_880);
    expect(RESUME_FILENAME_MAX_LENGTH).toBe(Application.schema.path('resume.originalFilename').options.maxlength);
  });
});

describe('metadata built from a real stored file fits the Application model exactly', () => {
  let env;
  beforeEach(async () => {
    env = await createIntakeEnvironment();
  });
  afterEach(async () => {
    await env.cleanup();
  });

  const validatedFrom = (bytes) => {
    const file = env.uploadArea.reserveFile();
    fs.writeFileSync(file.path, bytes);
    return {
      tempPath: file.path,
      sizeBytes: bytes.length,
      checksumSha256: sha256(bytes),
      extension: '.pdf',
      mimeType: 'application/pdf',
      originalFilename: 'qa-resume.pdf',
      format: 'PDF',
    };
  };

  it('stores, then returns every Doc 10 section 94 field and nothing else', async () => {
    const bytes = syntheticPdf();
    const metadata = await storeValidatedResume({ storage: env.storage, validated: validatedFrom(bytes) });
    expect(Object.keys(metadata).sort()).toEqual(
      ['storageProvider', 'storageKey', 'originalFilename', 'extension', 'mimeType', 'sizeBytes', 'checksumSha256', 'scanStatus', 'scanCheckedAt', 'storedAt'].sort(),
    );
    expect(Object.keys(metadata).sort()).toEqual(
      Object.keys(Application.schema.path('resume').schema.paths).filter((key) => key !== '_id').sort(),
    );
    const application = new Application({
      jobId: new mongoose.Types.ObjectId(),
      jobSnapshot: { title: 'QA Role', slug: 'qa-role' },
      candidate: { fullName: 'QA Candidate', email: 'qa@example.invalid' },
      resume: metadata,
      idempotency: { keyHash: 'k'.repeat(64), requestFingerprintHash: 'f'.repeat(64) },
    });
    await expect(application.validate()).resolves.toBeUndefined();
    expect(application.resume.toObject()).toEqual(metadata);
    expect(fs.readFileSync(path.join(env.storageRoot, ...metadata.storageKey.split('/'))).equals(bytes)).toBe(true);
  });

  it('never records CLEAN: the scan state is always NOT_SCANNED with no check time (Doc 17 section 127)', () => {
    const stored = { storageProvider: 'LOCAL_DEVELOPMENT', storageKey: 'resumes/a/b', sizeBytes: 1, checksumSha256: 'a'.repeat(64), storedAt: new Date() };
    // Even if a caller smuggles a scan result into either input, it is ignored.
    const metadata = buildResumeMetadata(
      { originalFilename: 'x.pdf', extension: '.pdf', mimeType: 'application/pdf', scanStatus: 'CLEAN', scanCheckedAt: new Date() },
      { ...stored, scanStatus: 'CLEAN' },
    );
    expect(metadata.scanStatus).toBe('NOT_SCANNED');
    expect(metadata.scanCheckedAt).toBeNull();
    expect(INITIAL_SCAN_STATE).toEqual({ scanStatus: 'NOT_SCANNED', scanCheckedAt: null });
    expect(Object.isFrozen(INITIAL_SCAN_STATE)).toBe(true);
    expect(RESUME_SCAN_STATUSES).toContain('NOT_SCANNED');
  });

  it('storage that is not ready -> 503, nothing stored', async () => {
    await env.storage.close();
    const error = await storeValidatedResume({ storage: env.storage, validated: validatedFrom(syntheticPdf()) }).catch((caught) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(503);
    expect(error.reason).toBe('RESUME_STORAGE_NOT_READY');
    expect(env.storedObjects()).toEqual([]);
  });

  it('no storage at all -> 503', async () => {
    const error = await storeValidatedResume({ storage: null, validated: validatedFrom(syntheticPdf()) }).catch((caught) => caught);
    expect(error.status).toBe(503);
  });
});

describe('compensation: discardStoredResume (Doc 09 section 119)', () => {
  let env;
  let log;
  beforeEach(async () => {
    log = capturingLogger();
    env = await createIntakeEnvironment({ logger: log.logger });
  });
  afterEach(async () => {
    await env.cleanup();
  });

  const storeOne = async () => {
    const file = env.uploadArea.reserveFile();
    const bytes = syntheticPdf();
    fs.writeFileSync(file.path, bytes);
    return env.storage.storePrivateResume({ filePath: file.path, sizeBytes: bytes.length, checksumSha256: sha256(bytes) });
  };

  it('DELETED: the stored object is really removed', async () => {
    const { storageKey } = await storeOne();
    expect(await discardStoredResume({ storage: env.storage, storageKey, logger: log.logger, requestId: 'qa-req' })).toBe('DELETED');
    expect(env.storedObjects()).toEqual([]);
    expect(log.output()).toContain('"outcome":"DELETED"');
  });

  it('ABSENT: an object that is already gone', async () => {
    const { storageKey } = await storeOne();
    await env.storage.deletePrivateObject(storageKey);
    expect(await discardStoredResume({ storage: env.storage, storageKey, logger: log.logger })).toBe('ABSENT');
  });

  it('ORPHANED: a failed delete never throws, never claims deletion, and logs the key for reconciliation', async () => {
    const { storageKey } = await storeOne();
    const failing = {
      deletePrivateObject: async () => {
        throw Object.assign(new Error(`QA simulated failure at ${env.storageRoot}`), { code: 'EACCES' });
      },
    };
    expect(await discardStoredResume({ storage: failing, storageKey, logger: log.logger, requestId: 'qa-req' })).toBe('ORPHANED');
    const output = log.output();
    expect(output).toContain('"outcome":"ORPHANED"');
    expect(output).toContain(`"storageKey":"${storageKey}"`);
    expect(output).toContain('"reason":"PERMISSION_DENIED"');
    expect(output).not.toContain(env.storageRoot);
    expect(output).not.toContain('QA simulated');
    // The object is still there and still private.
    expect(env.storedObjects()).toHaveLength(1);
  });

  it('REFUSED: an invalid key never reaches storage', async () => {
    let called = false;
    const spy = { deletePrivateObject: async () => { called = true; return { deleted: true }; } };
    for (const storageKey of ['../../etc/passwd', '/tmp/x', null, 'resumes/x/y']) {
      expect(await discardStoredResume({ storage: spy, storageKey, logger: log.logger })).toBe('REFUSED');
    }
    expect(called).toBe(false);
  });
});

describe('B4 error responses: fixed wording (Doc 06 sections 126-128 and 139) and internal-only reasons', () => {
  it.each([
    [unsupportedResumeType({ reason: 'MIME_NOT_ALLOWED' }), 415, ERROR_CODES.UNSUPPORTED_MEDIA_TYPE, "This file type isn't accepted. Choose a supported resume file."],
    [resumeTooLarge(), 413, ERROR_CODES.FILE_TOO_LARGE, 'This file is larger than the allowed limit. Choose a smaller file.'],
    [invalidResumeFile({ reason: 'PDF_HEADER_MISSING' }), 422, ERROR_CODES.INVALID_RESUME_FILE, "We couldn't process this file. Remove it and try another file."],
  ])('%#: status, code and resume field error', (error, status, code, message) => {
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
    expect(error.fieldErrors).toEqual([{ field: 'resume', code: expect.any(String), message }]);
  });

  it('a missing resume is VALIDATION_FAILED with the Doc 06 section 139 message', () => {
    expect(resumeRequired().fieldErrors).toEqual([{ field: 'resume', code: 'RESUME_REQUIRED', message: 'Upload your resume to continue.' }]);
  });

  it('only fixed upper-case tokens can become a logged reason (request data is dropped)', () => {
    const error = new AppError({ status: 422, code: 'X', message: 'x', reason: '../../resume-of-jane.pdf', detected: 'mongodb://user:pw@h' });
    expect(error.reason).toBeUndefined();
    expect(error.detected).toBeUndefined();
    const valid = new AppError({ status: 422, code: 'X', message: 'x', reason: 'PDF_HEADER_MISSING', detected: 'PE_EXECUTABLE' });
    expect(valid.reason).toBe('PDF_HEADER_MISSING');
    expect(valid.detected).toBe('PE_EXECUTABLE');
  });
});

describe('error handler: an AppError after the response started', () => {
  it('destroys the half-written response instead of leaving it open, and still logs the failure', async () => {
    const { default: request } = await import('supertest');
    const { buildApp } = await import('./helpers.js');
    const log = capturingLogger();
    const app = buildApp({
      logger: log.logger,
      registerTestRoutes: (api) => {
        api.get('/__test__/half-written', (req, res, next) => {
          res.status(200).set('Content-Type', 'text/plain');
          res.write('partial ');
          next(invalidResumeFile({ reason: 'PDF_HEADER_MISSING' }));
        });
      },
    });
    const outcome = await request(app).get('/api/v1/__test__/half-written').then(
      (response) => ({ completed: true, response }),
      (error) => ({ completed: false, error }),
    );
    // The client never receives a normal, finished response.
    expect(outcome.completed).toBe(false);
    expect(log.output()).toContain('"reason":"PDF_HEADER_MISSING"');
  });
});
