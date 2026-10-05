import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PDF_MIME, DOCX_MIME, syntheticPdf, syntheticPdfOfSize, EXECUTABLE_BYTES, PNG_BYTES } from './fixtures/resumeFiles.js';
import {
  QA_LONG_QUESTION_ID,
  QA_NOW,
  QA_OPTION_A,
  QA_SELECT_QUESTION_ID,
  QA_TEXT_QUESTION_ID,
  QA_YES_NO_QUESTION_ID,
  applyPath,
  applyRequest,
  createApplyEnvironment,
  qaAnswers,
  qaJob,
} from './fixtures/applyHarness.js';

/**
 * B5 — request validation and Job eligibility over HTTP (Doc 09 sections
 * 74-115 and 139-146; Doc 06 sections 134-144; Doc 17 sections 91-102, 115-124).
 *
 * Every refusal is checked for: the exact status and canonical code, the exact
 * frontend-mappable field paths and Doc 06 wording, NO Application, NO stored
 * object and NO temporary file left behind.
 */
let env;
beforeEach(async () => {
  env = await createApplyEnvironment();
});
afterEach(async () => {
  await env.cleanup();
});

function expectNothingKept() {
  expect(env.applications.all()).toEqual([]);
  expect(env.storedObjects()).toEqual([]);
  expect(env.tempFiles()).toEqual([]);
}

const VALIDATION = { code: 'VALIDATION_FAILED', message: 'Some information needs to be corrected.' };

describe('the Idempotency-Key header (Doc 09 sections 74-76)', () => {
  it('missing: 400 IDEMPOTENCY_KEY_REQUIRED, before the body is read', async () => {
    const response = await applyRequest(env.app, { key: null });
    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'This request must include an Idempotency-Key header.' });
    expect(response.headers.connection).toBe('close');
    expectNothingKept();
  });

  it.each([
    ['too short (15)', 'a'.repeat(15)],
    ['too long (129)', 'a'.repeat(129)],
    ['containing a space', 'qa key with spaces 0123456789'],
    ['containing a non-ASCII character', `qa-key-${'é'.repeat(16)}`],
  ])('%s: 400 INVALID_IDEMPOTENCY_KEY', async (_label, key) => {
    const response = await applyRequest(env.app, { key });
    expect(response.status).toBe(400);
    expect(response.body.error).toEqual({ code: 'INVALID_IDEMPOTENCY_KEY', message: 'The Idempotency-Key header is not valid.' });
    expectNothingKept();
  });

  it.each([
    ['16 visible ASCII characters', 'Aa0!#$%&*+-.^_`|'],
    ['128 characters', 'k'.repeat(128)],
    ['a UUID v4 (the preferred format)', randomUUID()],
  ])('accepts %s', async (_label, key) => {
    const response = await applyRequest(env.app, { key });
    expect(response.status).toBe(201);
  });
});

describe('protocol', () => {
  it('a JSON body is 415 UNSUPPORTED_MEDIA_TYPE (Doc 09 section 73)', async () => {
    const response = await request(env.app)
      .post(applyPath('qa-synthetic-apply-role'))
      .set('Idempotency-Key', randomUUID())
      .send({ fullName: 'QA Synthetic Candidate', email: 'qa@example.invalid' });
    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expectNothingKept();
  });

  it('GET on the Apply path stays the canonical API 404 (only POST is routed)', async () => {
    const response = await request(env.app).get(applyPath('qa-synthetic-apply-role'));
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('API_ROUTE_NOT_FOUND');
  });
});

describe('candidate fields (Doc 09 sections 83-84; Doc 06 sections 135-137)', () => {
  it.each([
    ['fullName missing', { fullName: null }, [{ field: 'fullName', code: 'REQUIRED', message: 'Enter your full name.' }]],
    ['fullName blank', { fullName: '   ' }, [{ field: 'fullName', code: 'REQUIRED', message: 'Enter your full name.' }]],
    ['fullName 1 character', { fullName: ' Q ' }, [{ field: 'fullName', code: 'TOO_SHORT', message: 'Enter your full name.' }]],
    ['fullName 121 characters', { fullName: 'Q'.repeat(121) }, [{ field: 'fullName', code: 'TOO_LONG', message: 'Enter your full name.' }]],
    ['fullName with a control character', { fullName: 'QA\u0000Candidate' }, [{ field: 'fullName', code: 'INVALID_CHARACTERS', message: 'Enter your full name.' }]],
    ['email missing', { email: null }, [{ field: 'email', code: 'REQUIRED', message: 'Enter your email address.' }]],
    ['email invalid', { email: 'qa-not-an-email' }, [{ field: 'email', code: 'INVALID_EMAIL', message: 'Enter a valid email address.' }]],
    ['email with spaces inside', { email: 'qa user@example.invalid' }, [{ field: 'email', code: 'INVALID_EMAIL', message: 'Enter a valid email address.' }]],
    ['email over 254 characters', { email: `${'q'.repeat(64)}@${'d'.repeat(186)}.invalid` }, [{ field: 'email', code: 'INVALID_EMAIL', message: 'Enter a valid email address.' }]],
    [
      'both missing',
      { fullName: null, email: null },
      [
        { field: 'fullName', code: 'REQUIRED', message: 'Enter your full name.' },
        { field: 'email', code: 'REQUIRED', message: 'Enter your email address.' },
      ],
    ],
  ])('%s: 422 with frontend-mappable field errors', async (_label, fields, fieldErrors) => {
    const response = await applyRequest(env.app, { fields });
    expect(response.status).toBe(422);
    expect(response.body.error).toEqual({ ...VALIDATION, fieldErrors });
    expectNothingKept();
  });

  it.each([
    ['a non-Latin name', '李 小龍'],
    ['an accented name', 'Zoë Åsa Núñez-QA'],
    ['a two-character name', 'QA'],
    ['a 120-character name', 'Q'.repeat(120)],
  ])('accepts %s (no English-only alphabet rule)', async (_label, fullName) => {
    const response = await applyRequest(env.app, { fields: { fullName } });
    expect(response.status).toBe(201);
    expect(env.applications.all()[0].candidate.fullName).toBe(fullName);
  });

  it('a 254-character email is accepted and stored with its normalised form (trim + lowercase only)', async () => {
    const email = ` ${'Q'.repeat(64)}@${'D'.repeat(181)}.INVALID `;
    const response = await applyRequest(env.app, { fields: { email } });
    expect(response.status).toBe(201);
    const [record] = env.applications.all();
    expect(record.candidate.email).toBe(email.trim());
    expect(record.candidate.emailNormalized).toBe(email.trim().toLowerCase());
  });

  it('a field over its transport bound is refused while streaming (B4 parser): 422 TOO_LONG', async () => {
    const response = await applyRequest(env.app, { fields: { fullName: 'Q'.repeat(481) } });
    expect(response.status).toBe(422);
    expect(response.body.error.fieldErrors).toEqual([{ field: 'fullName', code: 'TOO_LONG', message: 'This field is longer than the allowed limit.' }]);
    expectNothingKept();
  });
});

describe('client-supplied server fields are refused, never persisted (Doc 09 sections 27-28, 82, 123; Doc 17 sections 101-102)', () => {
  it.each(['status', 'scanStatus', 'jobId', 'submittedAt', 'storageKey', 'notifications', 'idempotencyKey', '__proto__'])(
    'a multipart field %s is 422 UNSUPPORTED_FIELD and nothing is created',
    async (name) => {
      const response = await applyRequest(env.app, { fields: { [name]: name === 'status' ? 'SELECTED' : 'CLEAN' } });
      expect(response.status).toBe(422);
      expect(response.body.error.fieldErrors).toEqual([
        { field: 'form', code: 'UNSUPPORTED_FIELD', message: "This form contains information that isn't accepted." },
      ]);
      expectNothingKept();
    },
  );
});

describe('Job-driven fields (Doc 09 sections 85-86; Doc 06 sections 134, 138)', () => {
  const configure = (applicationConfig) => {
    const [job] = [...env.jobs.jobs.values()];
    env.jobs.update(job._id, { applicationConfig: { ...job.applicationConfig, ...applicationConfig } });
  };

  it('phone disabled but supplied: 422 FIELD_NOT_ACCEPTED (preferred policy: reject); an empty value counts as absent', async () => {
    configure({ phone: { enabled: false, required: false } });
    const refused = await applyRequest(env.app, { fields: { phone: '+1 555 010 0199' } });
    expect(refused.status).toBe(422);
    expect(refused.body.error.fieldErrors).toEqual([{ field: 'phone', code: 'FIELD_NOT_ACCEPTED', message: "This form contains information that isn't accepted." }]);
    expect((await applyRequest(env.app, { fields: { phone: '   ' } })).status).toBe(201);
    expect(env.applications.all()[0].candidate.phone).toBeNull();
  });

  it('phone required but missing: 422 REQUIRED; optional and missing: accepted with null', async () => {
    configure({ phone: { enabled: true, required: true } });
    const refused = await applyRequest(env.app);
    expect(refused.body.error.fieldErrors).toEqual([{ field: 'phone', code: 'REQUIRED', message: 'This field is required.' }]);
    configure({ phone: { enabled: true, required: false } });
    expect((await applyRequest(env.app)).status).toBe(201);
  });

  it.each(['12345', '123456789012345678901234567890123', 'call me maybe', '+1 555 CALL QA', '++++++++++'])(
    'phone %j is 422 INVALID_PHONE',
    async (phone) => {
      const response = await applyRequest(env.app, { fields: { phone } });
      expect(response.status).toBe(422);
      expect(response.body.error.fieldErrors).toEqual([{ field: 'phone', code: 'INVALID_PHONE', message: 'Enter a valid phone number.' }]);
    },
  );

  it.each(['+370 612 34567', '(604) 555-0123', '+44 20 7946 0958', '06.12.34.56.78', '5550123'])('accepts the international phone %j', async (phone) => {
    expect((await applyRequest(env.app, { fields: { phone } })).status).toBe(201);
  });

  it('message: disabled+supplied refused; required+missing refused; over the Job maximum refused; internal newlines kept', async () => {
    configure({ message: { enabled: false, required: false, maxLength: 5000 } });
    expect((await applyRequest(env.app, { fields: { message: 'QA' } })).body.error.fieldErrors).toEqual([
      { field: 'message', code: 'FIELD_NOT_ACCEPTED', message: "This form contains information that isn't accepted." },
    ]);
    configure({ message: { enabled: true, required: true, maxLength: 20 } });
    expect((await applyRequest(env.app)).body.error.fieldErrors).toEqual([{ field: 'message', code: 'REQUIRED', message: 'This field is required.' }]);
    expect((await applyRequest(env.app, { fields: { message: 'Q'.repeat(21) } })).body.error.fieldErrors).toEqual([
      { field: 'message', code: 'TOO_LONG', message: 'This field is longer than the allowed limit.' },
    ]);
    const accepted = await applyRequest(env.app, { fields: { message: '  QA line 1\r\nQA line 2\n  ' } });
    expect(accepted.status).toBe(201);
    expect(env.applications.all()[0].candidate.message).toBe('QA line 1\r\nQA line 2');
  });
});

describe('screening answers (Doc 09 sections 87-93, 144, 146; Doc 06 section 140)', () => {
  const answerError = (questionId, code, message = 'Answer this question to continue.') => ({
    field: `screeningAnswers.${questionId}`,
    code,
    message,
  });
  const NOT_ACCEPTED = "This form contains information that isn't accepted.";

  it.each([
    ['malformed JSON', '[{"questionId": '],
    ['an object instead of an array', '{"questionId":"x","answer":true}'],
    ['an item with an extra key', JSON.stringify([{ questionId: QA_YES_NO_QUESTION_ID, answer: true, status: 'SELECTED' }])],
    ['an item without answer', JSON.stringify([{ questionId: QA_YES_NO_QUESTION_ID }])],
    ['an answer that is an object', JSON.stringify([{ questionId: QA_YES_NO_QUESTION_ID, answer: { $ne: null } }])],
    ['a questionId that is not a string', JSON.stringify([{ questionId: 7, answer: true }])],
  ])('%s: 422 on screeningAnswers, parser text never exposed', async (_label, answers) => {
    const response = await applyRequest(env.app, { answers });
    expect(response.status).toBe(422);
    expect(response.body.error.fieldErrors).toEqual([{ field: 'screeningAnswers', code: 'INVALID_SCREENING_ANSWERS', message: NOT_ACCEPTED }]);
    expect(JSON.stringify(response.body)).not.toMatch(/Unexpected|JSON|position/);
    expectNothingKept();
  });

  it('a question answered twice: DUPLICATE_ANSWER; more than 20 answers: TOO_MANY_ANSWERS', async () => {
    const twice = await applyRequest(env.app, { answers: [...qaAnswers(), { questionId: QA_YES_NO_QUESTION_ID, answer: false }] });
    expect(twice.body.error.fieldErrors).toEqual([{ field: 'screeningAnswers', code: 'DUPLICATE_ANSWER', message: NOT_ACCEPTED }]);
    const many = Array.from({ length: 21 }, (_, index) => ({ questionId: `qa-${index}`, answer: null }));
    const tooMany = await applyRequest(env.app, { answers: many });
    expect(tooMany.body.error.fieldErrors).toEqual([{ field: 'screeningAnswers', code: 'TOO_MANY_ANSWERS', message: NOT_ACCEPTED }]);
  });

  it('an answer to a question the Job does not have: one UNKNOWN_QUESTION error; the client id is never echoed', async () => {
    const response = await applyRequest(env.app, { answers: [...qaAnswers(), { questionId: 'qa-client-made-up-question', answer: 'QA' }] });
    expect(response.status).toBe(422);
    expect(response.body.error.fieldErrors).toEqual([{ field: 'screeningAnswers', code: 'UNKNOWN_QUESTION', message: NOT_ACCEPTED }]);
    expect(JSON.stringify(response.body)).not.toContain('qa-client-made-up-question');
  });

  it('a required question unanswered (absent, null or blank): ANSWER_REQUIRED on its server path', async () => {
    for (const answers of [[], [{ questionId: QA_YES_NO_QUESTION_ID, answer: null }]]) {
      const response = await applyRequest(env.app, { answers });
      expect(response.status).toBe(422);
      expect(response.body.error.fieldErrors).toEqual([answerError(QA_YES_NO_QUESTION_ID, 'ANSWER_REQUIRED')]);
    }
  });

  it.each([
    ['YES_NO given a string', QA_YES_NO_QUESTION_ID, 'yes', 'INVALID_ANSWER'],
    ['YES_NO given "true" as text', QA_YES_NO_QUESTION_ID, 'true', 'INVALID_ANSWER'],
    ['SINGLE_SELECT with an option of another question', QA_SELECT_QUESTION_ID, QA_YES_NO_QUESTION_ID, 'INVALID_ANSWER'],
    ['SINGLE_SELECT given a boolean', QA_SELECT_QUESTION_ID, true, 'INVALID_ANSWER'],
    ['SHORT_TEXT given a boolean', QA_TEXT_QUESTION_ID, false, 'INVALID_ANSWER'],
  ])('%s: %s, with the "isn\'t accepted" wording (not the "answer this question" prompt)', async (_label, questionId, answer, code) => {
    const answers = qaAnswers().filter((item) => item.questionId !== questionId);
    const response = await applyRequest(env.app, { answers: [...answers, { questionId, answer }] });
    expect(response.status).toBe(422);
    expect(response.body.error.fieldErrors).toEqual([answerError(questionId, code, NOT_ACCEPTED)]);
    expectNothingKept();
  });

  it('an OPTIONAL single-select submitted blank ("" — an unselected <select>) is "not answered": accepted, nothing stored for it', async () => {
    const response = await applyRequest(env.app, {
      answers: [
        { questionId: QA_YES_NO_QUESTION_ID, answer: true },
        { questionId: QA_SELECT_QUESTION_ID, answer: '' },
      ],
    });
    expect(response.status).toBe(201);
    const [record] = env.applications.all();
    expect(record.screeningAnswers.find((item) => item.questionId === QA_SELECT_QUESTION_ID)).toBeUndefined();
  });

  it('SHORT_TEXT over 1000 and LONG_TEXT over 3000 characters: TOO_LONG; at the limits: accepted', async () => {
    const tooLong = await applyRequest(env.app, {
      answers: [
        { questionId: QA_YES_NO_QUESTION_ID, answer: true },
        { questionId: QA_TEXT_QUESTION_ID, answer: 'Q'.repeat(1001) },
        { questionId: QA_LONG_QUESTION_ID, answer: 'Q'.repeat(3001) },
      ],
    });
    expect(tooLong.body.error.fieldErrors).toEqual([
      answerError(QA_TEXT_QUESTION_ID, 'TOO_LONG', 'This field is longer than the allowed limit.'),
      answerError(QA_LONG_QUESTION_ID, 'TOO_LONG', 'This field is longer than the allowed limit.'),
    ]);
    const atLimits = await applyRequest(env.app, {
      answers: [
        { questionId: QA_YES_NO_QUESTION_ID, answer: false },
        { questionId: QA_SELECT_QUESTION_ID, answer: QA_OPTION_A },
        { questionId: QA_TEXT_QUESTION_ID, answer: 'Q'.repeat(1000) },
        { questionId: QA_LONG_QUESTION_ID, answer: `QA line\n${'Q'.repeat(2992)}` },
      ],
    });
    expect(atLimits.status).toBe(201);
  });

  it('an optional question may be left unanswered (blank text is "no answer"); a NoSQL-operator-shaped string is just text', async () => {
    const response = await applyRequest(env.app, {
      answers: [
        { questionId: QA_YES_NO_QUESTION_ID, answer: true },
        { questionId: QA_TEXT_QUESTION_ID, answer: '   ' },
        { questionId: QA_LONG_QUESTION_ID, answer: '{"$gt": ""} <script>alert(1)</script>' },
      ],
    });
    expect(response.status).toBe(201);
    const [record] = env.applications.all();
    expect(record.screeningAnswers.map((answer) => answer.questionId)).toEqual([QA_YES_NO_QUESTION_ID, QA_LONG_QUESTION_ID]);
    expect(record.screeningAnswers[1].textValue).toBe('{"$gt": ""} <script>alert(1)</script>');
  });
});

describe('Job eligibility (Doc 09 sections 110-115; Doc 17 sections 91-96)', () => {
  const NOT_AVAILABLE = { code: 'JOB_NOT_FOUND', message: "This application isn't available." };
  const CLOSED = { code: 'JOB_NOT_ACCEPTING_APPLICATIONS', message: 'Applications for this role have closed.' };
  const setJob = (patch) => {
    const [job] = [...env.jobs.jobs.values()];
    env.jobs.update(job._id, patch);
  };

  it.each([
    ['an unknown slug', 'qa-no-such-role'],
    ['a malformed slug', 'QA_Bad_Slug'],
    ['an over-long slug', 'q'.repeat(121)],
    ['malformed percent-encoding', '%E0%A4%A'],
  ])('%s: 404 JOB_NOT_FOUND with the Doc 06 section 142 wording', async (_label, slug) => {
    const response = await applyRequest(env.app, { slug });
    expect(response.status).toBe(404);
    expect(response.body.error).toEqual(NOT_AVAILABLE);
    expectNothingKept();
  });

  it.each([
    ['DRAFT', { status: 'DRAFT', publishedAt: null }],
    ['ARCHIVED', { status: 'ARCHIVED' }],
    ['PUBLISHED but not yet (publishedAt in the future)', { publishedAt: new Date(QA_NOW.getTime() + 1) }],
  ])('a %s Job is indistinguishable from an unknown one: 404', async (_label, patch) => {
    setJob(patch);
    const response = await applyRequest(env.app);
    expect(response.status).toBe(404);
    expect(response.body.error).toEqual(NOT_AVAILABLE);
    expectNothingKept();
  });

  it.each([
    ['CLOSED', { status: 'CLOSED', closedAt: QA_NOW }],
    ['PUBLISHED whose closesAt has passed', { closesAt: new Date(QA_NOW.getTime() - 1) }],
    ['PUBLISHED whose closesAt is exactly now (closesAt > now is required)', { closesAt: QA_NOW }],
  ])('a %s Job: 409 JOB_NOT_ACCEPTING_APPLICATIONS', async (_label, patch) => {
    setJob(patch);
    const response = await applyRequest(env.app);
    expect(response.status).toBe(409);
    expect(response.body.error).toEqual(CLOSED);
    expectNothingKept();
  });

  it('a PUBLISHED Job whose closesAt is 1 ms after now is open', async () => {
    setJob({ closesAt: new Date(QA_NOW.getTime() + 1) });
    expect((await applyRequest(env.app)).status).toBe(201);
  });

  it('candidate-field errors come before the Job checks (Doc 09 section 109 order)', async () => {
    setJob({ status: 'CLOSED' });
    const response = await applyRequest(env.app, { fields: { email: 'qa-invalid' } });
    expect(response.status).toBe(422);
  });
});

describe('the resume (B4 rules preserved; Doc 09 sections 94-100, 139-142; Doc 17 section 115)', () => {
  it('missing: 422 VALIDATION_FAILED on resume with the Doc 06 section 139 wording', async () => {
    const response = await applyRequest(env.app, { resume: null });
    expect(response.status).toBe(422);
    expect(response.body.error).toEqual({
      ...VALIDATION,
      fieldErrors: [{ field: 'resume', code: 'RESUME_REQUIRED', message: 'Upload your resume to continue.' }],
    });
    expectNothingKept();
  });

  it.each([
    ['a .doc', { data: syntheticPdf(), filename: 'qa.doc', contentType: 'application/msword' }, 415, 'UNSUPPORTED_MEDIA_TYPE'],
    ['a PDF declared as DOCX', { data: syntheticPdf(), filename: 'qa.pdf', contentType: DOCX_MIME }, 415, 'UNSUPPORTED_MEDIA_TYPE'],
    ['an executable renamed .pdf', { data: EXECUTABLE_BYTES, filename: 'qa.pdf', contentType: PDF_MIME }, 422, 'INVALID_RESUME_FILE'],
    ['a PNG renamed .pdf', { data: PNG_BYTES, filename: 'qa.pdf', contentType: PDF_MIME }, 422, 'INVALID_RESUME_FILE'],
    ['an empty file', { data: Buffer.alloc(0), filename: 'qa.pdf', contentType: PDF_MIME }, 422, 'INVALID_RESUME_FILE'],
  ])('%s: %s %s, nothing stored', async (_label, resume, status, code) => {
    const response = await applyRequest(env.app, { resume });
    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);
    expectNothingKept();
  });

  it('over 5 MiB: 413 FILE_TOO_LARGE on resume, nothing stored', async () => {
    const response = await applyRequest(env.app, {
      resume: { data: syntheticPdfOfSize(5 * 1024 * 1024 + 1), filename: 'qa.pdf', contentType: PDF_MIME },
    });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('FILE_TOO_LARGE');
    expectNothingKept();
  });

  it('a dangerous filename never controls the storage path; its safe form is kept as metadata only', async () => {
    const response = await applyRequest(env.app, {
      resume: { data: syntheticPdf(), filename: '../../qa-resume.pdf', contentType: PDF_MIME },
    });
    expect(response.status).toBe(201);
    const [record] = env.applications.all();
    expect(record.resume.originalFilename).not.toContain('..');
    expect(record.resume.storageKey).toMatch(/^resumes\/[0-9a-f]{32}\/[0-9a-f]{32}$/);
  });

  it('two files: 422 SINGLE_FILE_REQUIRED (B4), nothing stored', async () => {
    const response = await applyRequest(env.app).attach('resume', syntheticPdf(), { filename: 'qa2.pdf', contentType: PDF_MIME });
    expect(response.status).toBe(422);
    expect(response.body.error.fieldErrors).toEqual([{ field: 'resume', code: 'SINGLE_FILE_REQUIRED', message: 'Upload only one file.' }]);
    expectNothingKept();
  });
});
