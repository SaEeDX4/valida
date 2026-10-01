import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { Application } from '../src/models/Application.js';
import { RESUME_UPLOAD_POLICY } from '../src/config/resumePolicy.js';
import { capturingLogger, silentLogger } from './helpers.js';
import {
  QA_MARKER, PDF_MIME, DOCX_MIME, syntheticPdf, syntheticDocx, syntheticPdfOfSize, buildZip, docxEntries,
  CONTENT_TYPES, contentTypesXml, PNG_BYTES, EXECUTABLE_BYTES, OLE2_BYTES,
} from './fixtures/resumeFiles.js';
import {
  INTAKE_PATH, buildIntakeApp, createIntakeEnvironment, multipartBody, resumePart,
} from './fixtures/uploadHarness.js';

/**
 * B4 — the Doc 17 file matrix (sections 115-127) through REAL HTTP.
 *
 * Every request goes through the real application stack via the test-only
 * harness route (tests/fixtures/uploadHarness.js), into REAL local private
 * storage on disk in a fresh temporary test root. Nothing is mocked: an
 * accepted file is asserted byte-for-byte on disk, and a refused one is
 * asserted to have left NO stored object and NO temporary file.
 *
 * All files are synthetic (Doc 17 section 29).
 */
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const fixture = (name) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'resumes', name));

let env;
let harness;
let log;

beforeEach(async () => {
  log = capturingLogger();
  env = await createIntakeEnvironment({ logger: log.logger });
  harness = buildIntakeApp({ storage: env.storage, uploadArea: env.uploadArea, logger: log.logger });
});

afterEach(async () => {
  await env.cleanup();
});

/** POSTs one resume with supertest's multipart support. */
const upload = (data, filename, contentType, fields = {}) => {
  const req = request(harness.app).post(INTAKE_PATH);
  for (const [name, value] of Object.entries(fields)) req.field(name, value);
  return req.attach('resume', data, { filename, contentType });
};

/** POSTs a raw multipart body. */
const sendRaw = ({ body, contentType }) =>
  request(harness.app).post(INTAKE_PATH).set('Content-Type', contentType).send(body);

/** Nothing stored, no temporary file left, and the response reveals nothing internal. */
function expectNothingKept(response) {
  expect(env.storedObjects()).toEqual([]);
  expect(env.tempFiles()).toEqual([]);
  expect(env.uploadArea.ownedCount).toBe(0);
  const raw = JSON.stringify(response.body);
  // Internal classification tokens are for the log only.
  expect(raw).not.toMatch(/"reason"|"detected"|"cause"/);
  expect(raw).not.toContain(env.root);
  expect(raw).not.toMatch(/resumes\/[0-9a-f]{32}/);
  expect(raw).not.toMatch(/"stack"|\.js:\d+/);
}

const expectFileError = (response, status, code, fieldCode) => {
  expect(response.status).toBe(status);
  expect(response.body.success).toBe(false);
  expect(response.body.error.code).toBe(code);
  expect(response.body.error.fieldErrors).toEqual([expect.objectContaining({ field: 'resume', code: fieldCode })]);
  expect(response.body.meta.requestId).toEqual(expect.any(String));
  expectNothingKept(response);
};

describe('accepted resumes are really stored (Doc 17 sections 116-117, Doc 18 section 121)', () => {
  it('a valid PDF: 201, bytes and SHA-256 on disk equal the upload, metadata fits the Application model', async () => {
    const pdf = syntheticPdf();
    const response = await upload(pdf, 'qa-resume.pdf', PDF_MIME);
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ success: true, data: { received: true }, meta: { requestId: expect.any(String) } });

    const [{ metadata }] = harness.captured;
    expect(metadata).toEqual({
      storageProvider: 'LOCAL_DEVELOPMENT',
      storageKey: expect.stringMatching(/^resumes\/[0-9a-f]{32}\/[0-9a-f]{32}$/),
      originalFilename: 'qa-resume.pdf',
      extension: '.pdf',
      mimeType: PDF_MIME,
      sizeBytes: pdf.length,
      checksumSha256: sha256(pdf),
      scanStatus: 'NOT_SCANNED',
      scanCheckedAt: null,
      storedAt: expect.any(Date),
    });

    // The object on disk is exactly the upload.
    const objectPath = path.join(env.storageRoot, ...metadata.storageKey.split('/'));
    const onDisk = fs.readFileSync(objectPath);
    expect(onDisk.equals(pdf)).toBe(true);
    expect(sha256(onDisk)).toBe(metadata.checksumSha256);
    expect(env.storedObjects()).toEqual([metadata.storageKey.slice('resumes/'.length)].map((key) => key.split('/').join(path.sep)));
    // The temporary file is gone.
    expect(env.tempFiles()).toEqual([]);

    // The metadata validates as an Application's resume subdocument.
    const application = new Application({
      jobId: new mongoose.Types.ObjectId(),
      jobSnapshot: { title: 'QA Role', slug: 'qa-role' },
      candidate: { fullName: 'QA Candidate', email: 'qa@example.invalid' },
      resume: metadata,
      idempotency: { keyHash: 'k'.repeat(64), requestFingerprintHash: 'f'.repeat(64) },
    });
    await expect(application.validate()).resolves.toBeUndefined();
    expect(application.resume.scanStatus).toBe('NOT_SCANNED');
  });

  it('a valid synthetic DOCX: 201 and stored', async () => {
    const docx = syntheticDocx();
    const response = await upload(docx, 'qa-resume.docx', DOCX_MIME);
    expect(response.status).toBe(201);
    const [{ metadata }] = harness.captured;
    expect(metadata).toMatchObject({ extension: '.docx', mimeType: DOCX_MIME, sizeBytes: docx.length, checksumSha256: sha256(docx) });
    expect(fs.readFileSync(path.join(env.storageRoot, ...metadata.storageKey.split('/'))).equals(docx)).toBe(true);
  });

  it.each([
    ['qa-libreoffice.docx', DOCX_MIME],
    ['qa-pandoc.docx', DOCX_MIME],
    ['qa-python-docx.docx', DOCX_MIME],
    ['qa-libreoffice.pdf', PDF_MIME],
    ['qa-chromium-print.pdf', PDF_MIME],
    ['qa-reportlab.pdf', PDF_MIME],
    ['qa-qpdf-linearized-objstm.pdf', PDF_MIME],
  ])('a file written by a real authoring tool (%s) is accepted', async (name, mime) => {
    const bytes = fixture(name);
    const response = await upload(bytes, name, mime);
    expect(response.status).toBe(201);
    expect(harness.captured[0].metadata.checksumSha256).toBe(sha256(bytes));
  });

  it('accepts a file of exactly 5,242,880 bytes', async () => {
    const pdf = syntheticPdfOfSize(RESUME_UPLOAD_POLICY.maxBytes);
    const response = await upload(pdf, 'qa-max.pdf', PDF_MIME);
    expect(response.status).toBe(201);
    expect(harness.captured[0].metadata.sizeBytes).toBe(5_242_880);
  });

  it('two uploads of the same file get distinct, unpredictable storage keys', async () => {
    const pdf = syntheticPdf();
    await upload(pdf, 'same.pdf', PDF_MIME).expect(201);
    await upload(pdf, 'same.pdf', PDF_MIME).expect(201);
    const [first, second] = harness.captured.map(({ metadata }) => metadata.storageKey);
    expect(first).not.toBe(second);
    expect(env.storedObjects()).toHaveLength(2);
  });
});

describe('wrong type: 415 UNSUPPORTED_MEDIA_TYPE (Doc 17 section 115, Doc 09 section 140)', () => {
  it.each([
    ['an executable extension', EXECUTABLE_BYTES, 'qa.exe', 'application/pdf', 'EXTENSION_NOT_ALLOWED'],
    ['an image extension', PNG_BYTES, 'qa.png', 'application/pdf', 'EXTENSION_NOT_ALLOWED'],
    ['legacy .doc', fixture('qa-libreoffice-legacy.doc'), 'qa.doc', 'application/msword', 'EXTENSION_LEGACY_WORD'],
    ['macro-enabled .docm', fixture('qa-libreoffice-macro-format.docm'), 'qa.docm', DOCX_MIME, 'EXTENSION_MACRO_OR_TEMPLATE'],
    ['a template .dotx', fixture('qa-libreoffice-template.dotx'), 'qa.dotx', DOCX_MIME, 'EXTENSION_MACRO_OR_TEMPLATE'],
    ['no extension', syntheticPdf(), 'resume', PDF_MIME, 'EXTENSION_MISSING'],
    ['a double extension ending .exe', EXECUTABLE_BYTES, 'resume.pdf.exe', PDF_MIME, 'EXTENSION_NOT_ALLOWED'],
  ])('refuses %s', async (_label, bytes, filename, mime, reason) => {
    const response = await upload(bytes, filename, mime);
    expectFileError(response, 415, 'UNSUPPORTED_MEDIA_TYPE', 'UNSUPPORTED_FILE_TYPE');
    expect(response.body.error.message).toBe("This file type isn't accepted. Choose a supported resume file.");
    expect(log.output()).toContain(`"reason":"${reason}"`);
  });

  it.each([
    ['image/png', 'MIME_NOT_ALLOWED'],
    ['application/octet-stream', 'MIME_NOT_ALLOWED'],
    ['text/plain', 'MIME_NOT_ALLOWED'],
    ['application/x-msdownload', 'MIME_NOT_ALLOWED'],
  ])('refuses a .pdf declared as %s (wrong MIME)', async (mime, reason) => {
    expectFileError(await upload(syntheticPdf(), 'qa.pdf', mime), 415, 'UNSUPPORTED_MEDIA_TYPE', 'UNSUPPORTED_FILE_TYPE');
    expect(log.output()).toContain(`"reason":"${reason}"`);
  });

  it('refuses a file part with no Content-Type at all', async () => {
    // busboy reports a part without Content-Type as text/plain: still refused.
    const response = await sendRaw(multipartBody([{ name: 'resume', filename: 'qa.pdf', data: syntheticPdf() }]));
    expectFileError(response, 415, 'UNSUPPORTED_MEDIA_TYPE', 'UNSUPPORTED_FILE_TYPE');
  });

  it.each([
    ['a PDF extension with the DOCX MIME type', syntheticPdf(), 'qa.pdf', DOCX_MIME],
    ['a DOCX extension with the PDF MIME type', syntheticDocx(), 'qa.docx', PDF_MIME],
  ])('refuses %s (extension/MIME mismatch)', async (_label, bytes, filename, mime) => {
    expectFileError(await upload(bytes, filename, mime), 415, 'UNSUPPORTED_MEDIA_TYPE', 'UNSUPPORTED_FILE_TYPE');
    expect(log.output()).toContain('"reason":"EXTENSION_MIME_MISMATCH"');
  });

  it('accepts MIME parameters and case variations of an allowed type', async () => {
    expect((await upload(syntheticPdf(), 'qa.PDF', 'Application/PDF; charset=binary')).status).toBe(201);
    expect(harness.captured[0].metadata).toMatchObject({ extension: '.pdf', mimeType: PDF_MIME, originalFilename: 'qa.PDF' });
  });
});

describe('wrong content: 422 INVALID_RESUME_FILE (Doc 17 sections 118-120, Doc 09 section 141)', () => {
  const MESSAGE = "We couldn't process this file. Remove it and try another file.";

  it.each([
    ['an executable renamed .pdf', EXECUTABLE_BYTES, 'resume.pdf', PDF_MIME, 'PDF_HEADER_MISSING', 'PE_EXECUTABLE'],
    ['a PNG renamed .pdf', PNG_BYTES, 'resume.pdf', PDF_MIME, 'PDF_HEADER_MISSING', 'PNG'],
    ['a DOCX renamed .pdf', syntheticDocx(), 'resume.pdf', PDF_MIME, 'PDF_HEADER_MISSING', 'ZIP'],
    ['a truncated PDF (malformed)', syntheticPdf().subarray(0, 300), 'resume.pdf', PDF_MIME, 'PDF_EOF_MISSING', 'PDF'],
    ['a PDF with a ZIP appended (polyglot)', Buffer.concat([syntheticPdf(), syntheticDocx()]), 'resume.pdf', PDF_MIME, 'PDF_TRAILING_DATA', 'PDF'],
    ['an arbitrary ZIP renamed .docx', buildZip([{ name: 'notes.txt', data: QA_MARKER }]), 'resume.docx', DOCX_MIME, 'DOCX_CONTENT_TYPES_MISSING', 'ZIP'],
    ['an executable renamed .docx', EXECUTABLE_BYTES, 'resume.docx', DOCX_MIME, 'ZIP_END_RECORD_MISSING', 'PE_EXECUTABLE'],
    ['a legacy .doc renamed .docx', fixture('qa-libreoffice-legacy.doc'), 'resume.docx', DOCX_MIME, 'ZIP_END_RECORD_MISSING', 'OLE2_COMPOUND'],
    ['an OLE2 (encrypted Office) file renamed .docx', OLE2_BYTES, 'resume.docx', DOCX_MIME, 'ZIP_END_RECORD_MISSING', 'OLE2_COMPOUND'],
    ['a macro-enabled .docm renamed .docx', fixture('qa-libreoffice-macro-format.docm'), 'resume.docx', DOCX_MIME, 'DOCX_MACRO_ENABLED', 'ZIP'],
    ['a template renamed .docx', fixture('qa-libreoffice-template.dotx'), 'resume.docx', DOCX_MIME, 'DOCX_TEMPLATE', 'ZIP'],
    ['a spreadsheet renamed .docx', fixture('qa-libreoffice-sheet.xlsx'), 'resume.docx', DOCX_MIME, 'DOCX_NOT_WORD_DOCUMENT', 'ZIP'],
    ['an ODF document renamed .docx', fixture('qa-pandoc.odt'), 'resume.docx', DOCX_MIME, 'DOCX_CONTENT_TYPES_MISSING', 'ZIP'],
    ['a PDF renamed .docx', syntheticPdf(), 'resume.docx', DOCX_MIME, 'ZIP_END_RECORD_MISSING', 'PDF'],
  ])('refuses %s', async (_label, bytes, filename, mime, reason, detected) => {
    const response = await upload(bytes, filename, mime);
    expectFileError(response, 422, 'INVALID_RESUME_FILE', 'INVALID_RESUME_FILE');
    expect(response.body.error.message).toBe(MESSAGE);
    // The log says why — with fixed tokens only.
    expect(log.output()).toContain(`"reason":"${reason}"`);
    expect(log.output()).toContain(`"detected":"${detected}"`);
  });

  it('refuses a DOCX that carries a VBA project even with a doctored content type', async () => {
    const entries = [
      ...docxEntries(),
      { name: 'word/vbaProject.bin', data: Buffer.from('QA-NOT-REAL-VBA') },
    ];
    const response = await upload(buildZip(entries), 'resume.docx', DOCX_MIME);
    expectFileError(response, 422, 'INVALID_RESUME_FILE', 'INVALID_RESUME_FILE');
    expect(log.output()).toContain('"reason":"DOCX_MACRO_CONTENT"');
  });

  it('refuses a zero-byte file (Doc 17 section 122)', async () => {
    const response = await upload(Buffer.alloc(0), 'empty.pdf', PDF_MIME);
    expectFileError(response, 422, 'INVALID_RESUME_FILE', 'INVALID_RESUME_FILE');
    expect(log.output()).toContain('"reason":"RESUME_EMPTY"');
  });
});

describe('size (Doc 17 section 121, Doc 09 section 139)', () => {
  it('refuses 5,242,881 bytes with 413 FILE_TOO_LARGE and keeps nothing', async () => {
    const response = await upload(syntheticPdfOfSize(RESUME_UPLOAD_POLICY.maxBytes + 1), 'big.pdf', PDF_MIME);
    expectFileError(response, 413, 'FILE_TOO_LARGE', 'FILE_TOO_LARGE');
    expect(response.body.error.message).toBe('This file is larger than the allowed limit. Choose a smaller file.');
  });
  // Over-limit REQUEST bodies (declared or streamed) and aborted uploads are
  // tested over a raw socket in tests/upload-abort-limits.test.js.
});

describe('filenames (Doc 17 sections 123-124, Doc 13 sections 65 and 79)', () => {
  it.each([
    ['../../resume.pdf', 'resume.pdf'],
    ['..\\..\\resume.pdf', 'resume.pdf'],
    ['C:\\Windows\\System32\\resume.pdf', 'resume.pdf'],
    ['/etc/passwd/../resume.pdf', 'resume.pdf'],
    ['\\\\server\\share\\resume.pdf', 'resume.pdf'],
  ])('a dangerous filename (%s) never chooses a location', async (raw, expected) => {
    const response = await sendRaw(multipartBody([resumePart(syntheticPdf(), raw, PDF_MIME)]));
    expect(response.status).toBe(201);
    const [{ metadata }] = harness.captured;
    expect(metadata.originalFilename).toBe(expected);
    // The object is under the storage root, named by the generated key only.
    expect(metadata.storageKey).toMatch(/^resumes\/[0-9a-f]{32}\/[0-9a-f]{32}$/);
    expect(env.storedObjects()).toHaveLength(1);
    expect(env.storedObjects()[0]).not.toMatch(/resume|passwd|System32/i);
    // Nothing was created anywhere else: the test root holds exactly the
    // storage root and the temporary base, and no file named after the
    // client's filename appeared next to it.
    expect(fs.readdirSync(env.root).sort()).toEqual(['private-resumes', 'tmp']);
    expect(fs.readdirSync(path.dirname(env.root))).not.toContain('resume.pdf');
    expect(fs.existsSync(path.join(env.storageRoot, 'resume.pdf'))).toBe(false);
  });

  it('a very long filename is bounded to 255 characters and keeps its extension', async () => {
    const response = await upload(syntheticPdf(), `${'a'.repeat(1000)}.pdf`, PDF_MIME);
    expect(response.status).toBe(201);
    const { originalFilename } = harness.captured[0].metadata;
    expect(originalFilename.length).toBeLessThanOrEqual(255);
    expect(originalFilename.endsWith('.pdf')).toBe(true);
  });

  it.each([
    ['Persian', 'رزومه-آزمایشی.pdf', PDF_MIME, syntheticPdf],
    ['Japanese', '履歴書_テスト.docx', DOCX_MIME, syntheticDocx],
    ['accented (decomposed NFD input)', 'Re\u0301sume\u0301 (QA).pdf', PDF_MIME, syntheticPdf],
    ['emoji', 'qa-resume-📄.pdf', PDF_MIME, syntheticPdf],
  ])('a legitimate %s filename is processed and preserved (NFC)', async (_label, name, mime, build) => {
    const response = await sendRaw(
      multipartBody([
        { name: 'resume', rawDisposition: `form-data; name="resume"; filename*=UTF-8''${encodeURIComponent(name)}`, contentType: mime, data: build() },
      ]),
    );
    expect(response.status).toBe(201);
    expect(harness.captured[0].metadata.originalFilename).toBe(name.normalize('NFC'));
  });

  it('a bidirectional-override name cannot disguise an executable', async () => {
    // Displays as "resumeexe.pdf" in a bidi-aware UI; really ends in ".exe".
    const response = await sendRaw(
      multipartBody([
        { name: 'resume', rawDisposition: `form-data; name="resume"; filename*=UTF-8''${encodeURIComponent('resume\u202Efdp.exe')}`, contentType: PDF_MIME, data: EXECUTABLE_BYTES },
      ]),
    );
    expectFileError(response, 415, 'UNSUPPORTED_MEDIA_TYPE', 'UNSUPPORTED_FILE_TYPE');
  });
});

describe('exactly one file named resume (Doc 17 section 115, Doc 09 sections 94 and 142)', () => {
  it('refuses two files with 422 and keeps neither', async () => {
    const response = await sendRaw(
      multipartBody([resumePart(syntheticPdf(), 'a.pdf', PDF_MIME), resumePart(syntheticPdf(), 'b.pdf', PDF_MIME)]),
    );
    expectFileError(response, 422, 'VALIDATION_FAILED', 'SINGLE_FILE_REQUIRED');
  });

  it('refuses a request with no resume: 422 RESUME_REQUIRED', async () => {
    const response = await sendRaw(multipartBody([{ name: 'fullName', value: 'QA Candidate' }]));
    expectFileError(response, 422, 'VALIDATION_FAILED', 'RESUME_REQUIRED');
    expect(response.body.error.fieldErrors[0].message).toBe('Upload your resume to continue.');
  });

  it('treats a resume sent as plain text as missing', async () => {
    const response = await sendRaw(multipartBody([{ name: 'resume', value: '%PDF-1.4 not a file part' }]));
    expectFileError(response, 422, 'VALIDATION_FAILED', 'RESUME_REQUIRED');
    expect(log.output()).toContain('"reason":"RESUME_SENT_AS_TEXT"');
  });

  it('refuses a file under another field name (the bytes are discarded, never stored)', async () => {
    const response = await sendRaw(
      multipartBody([{ name: 'cv', filename: 'qa.pdf', contentType: PDF_MIME, data: syntheticPdf() }]),
    );
    expect(response.status).toBe(422);
    expect(response.body.error.fieldErrors).toEqual([expect.objectContaining({ field: 'form', code: 'UNSUPPORTED_FIELD' })]);
    expectNothingKept(response);
  });
});

describe('text fields are bounded and allowlisted (Doc 09 sections 104 and 145)', () => {
  const pdf = () => resumePart(syntheticPdf(), 'qa.pdf', PDF_MIME);

  it('passes allowed fields through to the caller', async () => {
    const response = await sendRaw(
      multipartBody([{ name: 'fullName', value: 'QA Candidate' }, { name: 'email', value: 'qa@example.invalid' }, pdf()]),
    );
    expect(response.status).toBe(201);
    expect({ ...harness.captured[0].fields }).toEqual({ fullName: 'QA Candidate', email: 'qa@example.invalid' });
  });

  it('refuses a client attempt to set scanStatus=CLEAN, and never records CLEAN (Doc 17 sections 102 and 127)', async () => {
    const response = await sendRaw(multipartBody([{ name: 'scanStatus', value: 'CLEAN' }, pdf()]));
    expect(response.status).toBe(422);
    expect(response.body.error.fieldErrors).toEqual([expect.objectContaining({ field: 'form', code: 'UNSUPPORTED_FIELD' })]);
    expectNothingKept(response);
    // And an accepted upload is always NOT_SCANNED.
    await upload(syntheticPdf(), 'qa.pdf', PDF_MIME).expect(201);
    expect(harness.captured[0].metadata).toMatchObject({ scanStatus: 'NOT_SCANNED', scanCheckedAt: null });
  });

  it.each(['storageKey', 'status', 'jobId', '__proto__', 'constructor'])(
    'refuses the unexpected field %s without echoing its name',
    async (name) => {
      const response = await sendRaw(multipartBody([{ name, value: 'x' }, pdf()]));
      expect(response.status).toBe(422);
      expect(response.body.error.fieldErrors).toEqual([
        { field: 'form', code: 'UNSUPPORTED_FIELD', message: "This form contains information that isn't accepted." },
      ]);
      expectNothingKept(response);
    },
  );

  it('refuses a repeated field', async () => {
    const response = await sendRaw(multipartBody([{ name: 'email', value: 'a@example.invalid' }, { name: 'email', value: 'b@example.invalid' }, pdf()]));
    expect(response.status).toBe(422);
    expect(response.body.error.fieldErrors).toEqual([expect.objectContaining({ field: 'email', code: 'DUPLICATE_FIELD' })]);
    expectNothingKept(response);
  });

  it('refuses a field longer than its transport limit', async () => {
    const response = await sendRaw(multipartBody([{ name: 'fullName', value: 'x'.repeat(481) }, pdf()]));
    expect(response.status).toBe(422);
    expect(response.body.error.fieldErrors).toEqual([expect.objectContaining({ field: 'fullName', code: 'TOO_LONG' })]);
    expectNothingKept(response);
  });

  it('refuses more parts than the form has fields', async () => {
    const parts = Array.from({ length: 8 }, (_unused, index) => ({ name: 'fullName', value: `v${index}` }));
    const response = await sendRaw(multipartBody([...parts, pdf()]));
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expectNothingKept(response);
  });
});

describe('malformed requests (Doc 09 sections 24 and 73)', () => {
  it('refuses a JSON body with 415 and reads nothing', async () => {
    const response = await request(harness.app).post(INTAKE_PATH).send({ resume: 'x' });
    expect(response.status).toBe(415);
    expect(response.body.error).toEqual({ code: 'UNSUPPORTED_MEDIA_TYPE', message: 'This request must be sent as multipart form data.' });
    expectNothingKept(response);
  });

  it('refuses multipart without a boundary with 400', async () => {
    const response = await request(harness.app).post(INTAKE_PATH).set('Content-Type', 'multipart/form-data').send('x');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MALFORMED_REQUEST');
    expectNothingKept(response);
  });

  it('refuses a body that ends without its closing boundary (truncated upload) with 400', async () => {
    const whole = multipartBody([resumePart(syntheticPdf(), 'qa.pdf', PDF_MIME)], { close: false });
    const response = await sendRaw({ body: whole.body.subarray(0, whole.body.length - 200), contentType: whole.contentType });
    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({ code: 'MALFORMED_REQUEST', message: 'The request could not be read as valid multipart form data.' });
    expectNothingKept(response);
  });

  it('refuses a part header containing a bare line feed (header injection) — the part is dropped', async () => {
    const response = await sendRaw(
      multipartBody([{ name: 'resume', rawDisposition: 'form-data; name="resume"; filename="qa\nX-Injected: 1.pdf"', contentType: PDF_MIME, data: syntheticPdf() }]),
    );
    expect(response.status).toBe(422);
    expect(response.body.error.fieldErrors[0].code).toBe('RESUME_REQUIRED');
    expectNothingKept(response);
  });
});

describe('a bare line feed inside another part header line', () => {
  it('makes the parser ignore that line: the type falls back to text/plain and the file is refused (415)', async () => {
    const { body, contentType } = multipartBody([
      { name: 'resume', filename: 'qa.pdf', contentType: 'application/pdf\nX-Injected: 1', data: syntheticPdf() },
    ]);
    const response = await sendRaw({ body, contentType });
    expectFileError(response, 415, 'UNSUPPORTED_MEDIA_TYPE', 'UNSUPPORTED_FILE_TYPE');
  });
});

describe('storage failures never report success (Doc 09 section 137, Doc 17 section 112)', () => {
  it('a storage write failure answers 503 and leaves no object and no temporary file', async () => {
    const failing = await createIntakeEnvironment({
      logger: silentLogger(),
      storageOptions: {
        operations: {
          createWriteStream: () => {
            const error = Object.assign(new Error('QA simulated: no space left'), { code: 'ENOSPC' });
            throw error;
          },
        },
      },
    });
    try {
      const failingHarness = buildIntakeApp({ storage: failing.storage, uploadArea: failing.uploadArea, logger: log.logger });
      const response = await request(failingHarness.app).post(INTAKE_PATH).attach('resume', syntheticPdf(), { filename: 'qa.pdf', contentType: PDF_MIME });
      expect(response.status).toBe(503);
      expect(response.body.error).toEqual({ code: 'SERVICE_UNAVAILABLE', message: 'Service is not ready.' });
      expect(failingHarness.captured).toEqual([]);
      expect(failing.storedObjects()).toEqual([]);
      expect(failing.tempFiles()).toEqual([]);
      expect(log.output()).toContain('"reason":"RESUME_STORAGE_NO_SPACE"');
      expect(log.output()).not.toContain('QA simulated');
    } finally {
      await failing.cleanup();
    }
  });

  it('storage that is not ready answers 503 without storing', async () => {
    await env.storage.close();
    const response = await upload(syntheticPdf(), 'qa.pdf', PDF_MIME);
    expect(response.status).toBe(503);
    expect(log.output()).toContain('"reason":"RESUME_STORAGE_NOT_READY"');
    expectNothingKept(response);
  });
});

describe('log hygiene', () => {
  it('logs no filename, content, path or storage key for accepted or refused uploads', async () => {
    await upload(syntheticPdf(), 'qa-secret-name-marker.pdf', PDF_MIME).expect(201);
    await upload(EXECUTABLE_BYTES, 'qa-other-secret-marker.pdf', PDF_MIME).expect(422);
    const output = log.output();
    expect(output).not.toContain('secret-name-marker');
    expect(output).not.toContain('other-secret-marker');
    expect(output).not.toContain(QA_MARKER);
    expect(output).not.toContain(env.root);
    expect(output).not.toMatch(/resumes\/[0-9a-f]{32}/);
  });
});

describe('the multipart content types a DOCX package declares are exact', () => {
  it('a DOCX whose main part declares the generic XML type is refused', async () => {
    const entries = docxEntries();
    entries[0] = { name: '[Content_Types].xml', data: contentTypesXml({ mainType: 'application/xml' }) };
    const response = await upload(buildZip(entries), 'resume.docx', DOCX_MIME);
    expectFileError(response, 422, 'INVALID_RESUME_FILE', 'INVALID_RESUME_FILE');
    expect(CONTENT_TYPES.DOCX).not.toBe('application/xml');
  });
});
