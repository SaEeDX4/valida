import { describe, it, expect } from 'vitest';
import {
  validateFullName, validateEmail, validatePhone, validateApplication, validateScreeningAnswer,
} from './applicationValidation.js';
import {
  validateResumeFile, buildAcceptAttribute, buildResumeInstruction, formatBytes, getFileExtension,
} from './resumeValidation.js';
import buildApplicationFormData from '../utils/buildApplicationFormData.js';
import { createIdempotencyKey } from '../api/applicationsApi.js';

const resumeConfig = { required: true, maxBytes: 5242880, allowedExtensions: ['.pdf', '.docx'] };
const fileOf = (name, size = 100) => {
  const file = new File(['x'], name);
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

describe('field rules mirror the API contract', () => {
  it('enforces the canonical full-name bounds', () => {
    expect(validateFullName('  ')).toBe('Enter your full name.');
    expect(validateFullName('A')).toBe('Enter your full name.');
    expect(validateFullName('Jo')).toBeNull();
    expect(validateFullName('x'.repeat(120))).toBeNull();
    expect(validateFullName('x'.repeat(121))).toBe('Enter your full name.');
  });

  it('accepts non-Latin names — no English-only alphabet rule', () => {
    expect(validateFullName('李雷')).toBeNull();
    expect(validateFullName('Þórunn Ólafsdóttir')).toBeNull();
    expect(validateFullName('Шервин')).toBeNull();
  });

  it('validates email syntactically and by length only', () => {
    expect(validateEmail('')).toBe('Enter your email address.');
    expect(validateEmail('nope')).toBe('Enter a valid email address.');
    expect(validateEmail('a@b')).toBe('Enter a valid email address.');
    expect(validateEmail('jane@example.com')).toBeNull();
    expect(validateEmail(`${'a'.repeat(250)}@example.com`)).toBe('Enter a valid email address.');
  });

  it('accepts international phone formats rather than a North-America rule', () => {
    expect(validatePhone('+370 600 12345', { required: true })).toBeNull();
    expect(validatePhone('+1 (604) 555-0100', { required: true })).toBeNull();
    expect(validatePhone('+81 3-1234-5678', { required: true })).toBeNull();
    expect(validatePhone('123', { required: true })).toBe('Enter a valid phone number.');
  });

  it('treats phone as optional unless the job requires it', () => {
    expect(validatePhone('', { required: false })).toBeNull();
    expect(validatePhone('', { required: true })).toBe('This field is required.');
  });
});

describe('whole-form validation follows the job configuration', () => {
  const base = {
    values: { fullName: 'Jane Doe', email: 'jane@example.com', screeningAnswers: {} },
    hasResume: true,
    resumeError: null,
  };

  it('passes a minimal valid form', () => {
    expect(validateApplication({ ...base, applicationForm: { resume: { required: true } } })).toEqual({});
  });

  it('ignores disabled fields entirely', () => {
    const errors = validateApplication({
      ...base,
      values: { ...base.values, phone: '', message: '' },
      applicationForm: { phone: { enabled: false, required: true }, resume: { required: true } },
    });
    expect(errors.phone).toBeUndefined();
  });

  it('requires an answer only for required screening questions', () => {
    const errors = validateApplication({
      ...base,
      applicationForm: {
        resume: { required: true },
        screeningQuestions: [
          { id: 'a', type: 'SHORT_TEXT', required: true },
          { id: 'b', type: 'SHORT_TEXT', required: false },
        ],
      },
    });
    expect(errors['screening:a']).toBe('Answer this question to continue.');
    expect(errors['screening:b']).toBeUndefined();
  });

  it('rejects a select answer outside the configured options', () => {
    const errors = validateApplication({
      ...base,
      values: { ...base.values, screeningAnswers: { s: 'Injected' } },
      applicationForm: {
        resume: { required: true },
        screeningQuestions: [{ id: 's', type: 'SINGLE_SELECT', required: true, options: ['One', 'Two'] }],
      },
    });
    expect(errors['screening:s']).toBeTruthy();
  });
});

describe('resume checks use configured values only', () => {
  it('builds accept and the instruction from configuration', () => {
    expect(buildAcceptAttribute(resumeConfig)).toBe('.pdf,.docx');
    expect(buildResumeInstruction(resumeConfig)).toBe(
      'Accepted file types: .pdf, .docx. Maximum size: 5 MB.',
    );
  });

  it('adapts when a job configures different constraints', () => {
    const other = { allowedExtensions: ['.pdf'], maxBytes: 1048576 };
    expect(buildAcceptAttribute(other)).toBe('.pdf');
    expect(buildResumeInstruction(other)).toBe('Accepted file types: .pdf. Maximum size: 1 MB.');
  });

  it('accepts a configured extension and rejects others', () => {
    expect(validateResumeFile(fileOf('cv.pdf'), resumeConfig)).toBeNull();
    expect(validateResumeFile(fileOf('cv.DOCX'), resumeConfig)).toBeNull();
    expect(validateResumeFile(fileOf('cv.exe'), resumeConfig)).toMatch(/isn't accepted/);
    expect(validateResumeFile(fileOf('cv'), resumeConfig)).toMatch(/isn't accepted/);
  });

  it('rejects a file above the configured limit', () => {
    expect(validateResumeFile(fileOf('cv.pdf', 5242880), resumeConfig)).toBeNull();
    expect(validateResumeFile(fileOf('cv.pdf', 5242881), resumeConfig)).toMatch(/larger than the allowed limit/);
  });

  it('reports an empty file neutrally, with no security verdict', () => {
    const message = validateResumeFile(fileOf('cv.pdf', 0), resumeConfig);
    expect(message).toMatch(/couldn't process this file/);
    expect(message).not.toMatch(/malware|virus|scan|clean|signature/i);
  });

  it('formats sizes and extensions predictably', () => {
    expect(formatBytes(5242880)).toBe('5 MB');
    expect(formatBytes(512)).toBe('512 B');
    expect(getFileExtension('a.b.PDF')).toBe('.pdf');
    expect(getFileExtension('noext')).toBeNull();
  });
});

describe('multipart payload', () => {
  const form = {
    phone: { enabled: true, required: false },
    message: { enabled: true, required: false, maxLength: 5000 },
    resume: { required: true },
    screeningQuestions: [{ id: 'q1', type: 'SHORT_TEXT', required: true }],
  };

  it('sends only supported logical fields', () => {
    const fd = buildApplicationFormData({
      values: {
        fullName: '  Jane Doe  ', email: ' jane@example.com ', phone: '+370 600 12345',
        message: 'Line one\nLine two', screeningAnswers: { q1: 'Answer' },
      },
      applicationForm: form,
      resumeFile: fileOf('cv.pdf'),
    });
    expect(fd.get('fullName')).toBe('Jane Doe');
    expect(fd.get('email')).toBe('jane@example.com');
    expect(fd.get('phone')).toBe('+370 600 12345');
    // Candidate line breaks are preserved.
    expect(fd.get('message')).toBe('Line one\nLine two');
    expect(JSON.parse(fd.get('screeningAnswers'))).toEqual([{ questionId: 'q1', answer: 'Answer' }]);
    expect(fd.get('resume')).toBeInstanceOf(File);
    [...fd.keys()].forEach((key) =>
      expect(['fullName', 'email', 'phone', 'message', 'screeningAnswers', 'resume']).toContain(key),
    );
  });

  it('omits fields the job configuration disables', () => {
    const fd = buildApplicationFormData({
      values: { fullName: 'Jane Doe', email: 'jane@example.com', phone: '+370 600', message: 'hi' },
      applicationForm: { phone: { enabled: false }, message: { enabled: false }, resume: {} },
      resumeFile: null,
    });
    expect(fd.get('phone')).toBeNull();
    expect(fd.get('message')).toBeNull();
    expect(fd.get('resume')).toBeNull();
  });
});

describe('idempotency key', () => {
  it('produces a UUID-shaped high-entropy key', () => {
    const key = createIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(key.length).toBeGreaterThanOrEqual(16);
    expect(key.length).toBeLessThanOrEqual(128);
    expect(key).not.toMatch(/\s/);
  });

  it('never repeats', () => {
    const keys = new Set(Array.from({ length: 200 }, createIdempotencyKey));
    expect(keys.size).toBe(200);
  });
});

describe('application success contract (finding 3)', () => {
  it('rejects an empty data payload', async () => {
    const { isValidApplicationResult } = await import('../api/applicationsApi.js');
    expect(isValidApplicationResult({})).toBe(false);
  });

  it('rejects a status other than RECEIVED', async () => {
    const { isValidApplicationResult } = await import('../api/applicationsApi.js');
    expect(isValidApplicationResult({ status: 'PENDING', job: { slug: 's', title: 't' } })).toBe(false);
    expect(isValidApplicationResult({ status: '', job: { slug: 's', title: 't' } })).toBe(false);
  });

  it('rejects a missing or malformed job block', async () => {
    const { isValidApplicationResult } = await import('../api/applicationsApi.js');
    expect(isValidApplicationResult({ status: 'RECEIVED' })).toBe(false);
    expect(isValidApplicationResult({ status: 'RECEIVED', job: {} })).toBe(false);
    expect(isValidApplicationResult({ status: 'RECEIVED', job: { slug: 's' } })).toBe(false);
  });

  it('accepts the canonical first-submission and replay payloads', async () => {
    const { isValidApplicationResult } = await import('../api/applicationsApi.js');
    // Doc 09 sections 125-126: the replay body is the same apart from meta.
    const canonical = {
      status: 'RECEIVED',
      job: { title: 'Cybersecurity Specialist', slug: 'cybersecurity-specialist' },
      submittedAt: '2026-09-10T18:45:00.000Z',
    };
    expect(isValidApplicationResult(canonical)).toBe(true);
  });
});

describe('YES_NO transport is boolean (finding 4)', () => {
  const form = {
    resume: {},
    screeningQuestions: [
      { id: 'yn', type: 'YES_NO', required: true },
      { id: 'txt', type: 'SHORT_TEXT', required: true },
    ],
  };

  it('serialises YES_NO as a JSON boolean, never the on-screen label', () => {
    const fd = buildApplicationFormData({
      values: {
        fullName: 'Jane Doe', email: 'jane@example.com',
        screeningAnswers: { yn: true, txt: 'text answer' },
      },
      applicationForm: form,
      resumeFile: null,
    });
    const answers = JSON.parse(fd.get('screeningAnswers'));
    const yesNo = answers.find((a) => a.questionId === 'yn');
    expect(typeof yesNo.answer).toBe('boolean');
    expect(yesNo.answer).toBe(true);
    expect(yesNo.answer).not.toBe('Yes');
  });

  it('serialises a false answer rather than dropping it', () => {
    const fd = buildApplicationFormData({
      values: { fullName: 'J D', email: 'j@e.com', screeningAnswers: { yn: false, txt: 'x' } },
      applicationForm: form,
      resumeFile: null,
    });
    const answers = JSON.parse(fd.get('screeningAnswers'));
    expect(answers.find((a) => a.questionId === 'yn').answer).toBe(false);
  });

  it('keeps text answers as strings', () => {
    const fd = buildApplicationFormData({
      values: { fullName: 'J D', email: 'j@e.com', screeningAnswers: { yn: true, txt: 'text answer' } },
      applicationForm: form,
      resumeFile: null,
    });
    const answers = JSON.parse(fd.get('screeningAnswers'));
    expect(typeof answers.find((a) => a.questionId === 'txt').answer).toBe('string');
  });

  it('treats a missing required boolean as unanswered', () => {
    const errors = validateApplication({
      values: { fullName: 'Jane Doe', email: 'jane@example.com', screeningAnswers: {} },
      applicationForm: form, hasResume: true, resumeError: null,
    });
    expect(errors['screening:yn']).toBe('Answer this question to continue.');
  });

  it('accepts false as a real answer', () => {
    const errors = validateApplication({
      values: { fullName: 'Jane Doe', email: 'jane@example.com', screeningAnswers: { yn: false, txt: 'a' } },
      applicationForm: form, hasResume: true, resumeError: null,
    });
    expect(errors['screening:yn']).toBeUndefined();
  });
});

describe('Job DTO contract hardening', () => {
  it('requires title, slug and OPEN status for a usable list row', async () => {
    const { isUsableJobListItem } = await import('../../jobs/api/jobsApi.js');
    const open = (extra) => ({ title: 'T', slug: 's', applicationStatus: 'OPEN', ...extra });
    expect(isUsableJobListItem(open())).toBe(true);
    expect(isUsableJobListItem(open({ title: undefined }))).toBe(false);
    expect(isUsableJobListItem(open({ slug: undefined }))).toBe(false);
    expect(isUsableJobListItem(open({ title: '  ' }))).toBe(false);
    expect(isUsableJobListItem(null)).toBe(false);
  });

  it('requires a recognised applicationStatus for a usable detail state', async () => {
    const { isUsableJobDetail } = await import('../../jobs/api/jobsApi.js');
    const form = {
      phone: { enabled: false, required: false },
      message: { enabled: false, required: false, maxLength: 5000 },
      resume: { required: true, maxBytes: 5242880, allowedExtensions: ['.pdf', '.docx'] },
      screeningQuestions: [],
    };
    // An OPEN Job must also carry a usable applicationForm (Correction Cycle 2,
    // finding 3) — status alone is no longer sufficient.
    expect(isUsableJobDetail({ title: 'T', slug: 's', applicationStatus: 'OPEN', applicationForm: form })).toBe(true);
    expect(isUsableJobDetail({ title: 'T', slug: 's', applicationStatus: 'CLOSED', applicationForm: null })).toBe(true);
    expect(isUsableJobDetail({ title: 'T', slug: 's', applicationStatus: 'DRAFT', applicationForm: null })).toBe(false);
    expect(isUsableJobDetail({ title: 'T', slug: 's' })).toBe(false);
  });
});


describe('OPEN/CLOSED application form contract (cycle 2, finding 3)', () => {
  const validForm = () => ({
    phone: { enabled: true, required: false },
    message: { enabled: true, required: false, maxLength: 5000 },
    resume: { required: true, maxBytes: 5242880, allowedExtensions: ['.pdf', '.docx'] },
    screeningQuestions: [],
  });
  const openJob = (applicationForm) => ({
    title: 'T', slug: 's', applicationStatus: 'OPEN', applicationForm,
  });

  it('accepts an OPEN job with a complete form', async () => {
    const { isUsableJobDetail } = await import('../../jobs/api/jobsApi.js');
    expect(isUsableJobDetail(openJob(validForm()))).toBe(true);
  });

  it.each([
    ['null form', null],
    ['missing form', undefined],
    ['empty form', {}],
    ['no resume block', { resume: undefined }],
  ])('rejects an OPEN job with %s', async (_label, form) => {
    const { isUsableJobDetail } = await import('../../jobs/api/jobsApi.js');
    expect(isUsableJobDetail(openJob(form))).toBe(false);
  });

  it.each([
    ['missing maxBytes', { required: true, allowedExtensions: ['.pdf'] }],
    ['non-positive maxBytes', { required: true, maxBytes: 0, allowedExtensions: ['.pdf'] }],
    ['empty extension list', { required: true, maxBytes: 100, allowedExtensions: [] }],
    ['malformed extension', { required: true, maxBytes: 100, allowedExtensions: ['pdf'] }],
    ['non-boolean required', { required: 'yes', maxBytes: 100, allowedExtensions: ['.pdf'] }],
  ])('rejects an OPEN job whose resume config has %s', async (_label, resume) => {
    const { isUsableJobDetail } = await import('../../jobs/api/jobsApi.js');
    expect(isUsableJobDetail(openJob({ ...validForm(), resume }))).toBe(false);
  });

  it('rejects screening questions that cannot be rendered', async () => {
    const { isUsableJobDetail } = await import('../../jobs/api/jobsApi.js');
    const bad = [
      [{ id: '', type: 'SHORT_TEXT', prompt: 'p', required: true }],
      [{ id: 'a', type: 'FILE_UPLOAD', prompt: 'p', required: true }],
      [{ id: 'a', type: 'SHORT_TEXT', prompt: '', required: true }],
      [{ id: 'a', type: 'SHORT_TEXT', prompt: 'p', required: 'yes' }],
      [{ id: 'a', type: 'SINGLE_SELECT', prompt: 'p', required: true, options: [] }],
      [{ id: 'a', type: 'SINGLE_SELECT', prompt: 'p', required: true, options: [{ optionId: 'x', label: 'X' }] }],
    ];
    bad.forEach((screeningQuestions) =>
      expect(isUsableJobDetail(openJob({ ...validForm(), screeningQuestions }))).toBe(false),
    );
  });

  it('rejects more screening questions than Phase 1 allows', async () => {
    const { isUsableJobDetail } = await import('../../jobs/api/jobsApi.js');
    const { MAX_SCREENING_QUESTIONS } = await import('../screeningContract.js');
    const make = (n) =>
      Array.from({ length: n }, (_, i) => ({
        // Non-SINGLE_SELECT types must carry an explicit empty options array
        // (Cycle 5, finding 1).
        id: `q${i}`, type: 'SHORT_TEXT', prompt: 'p', required: false, options: [],
      }));
    expect(isUsableJobDetail(openJob({ ...validForm(), screeningQuestions: make(MAX_SCREENING_QUESTIONS) }))).toBe(true);
    expect(isUsableJobDetail(openJob({ ...validForm(), screeningQuestions: make(MAX_SCREENING_QUESTIONS + 1) }))).toBe(false);
  });

  it('requires a CLOSED job to carry a null form', async () => {
    const { isUsableJobDetail } = await import('../../jobs/api/jobsApi.js');
    const closed = (applicationForm) => ({ title: 'T', slug: 's', applicationStatus: 'CLOSED', applicationForm });
    expect(isUsableJobDetail(closed(null))).toBe(true);
    expect(isUsableJobDetail(closed(validForm()))).toBe(false);
    expect(isUsableJobDetail(closed(undefined))).toBe(false);
  });

  it('rejects a list row that is not explicitly OPEN', async () => {
    const { isUsableJobListItem } = await import('../../jobs/api/jobsApi.js');
    expect(isUsableJobListItem({ title: 'T', slug: 's', applicationStatus: 'OPEN' })).toBe(true);
    // GET /api/v1/jobs represents roles accepting applications, so a status-less
    // or closed row must never appear under "Open Roles".
    expect(isUsableJobListItem({ title: 'T', slug: 's' })).toBe(false);
    expect(isUsableJobListItem({ title: 'T', slug: 's', applicationStatus: 'CLOSED' })).toBe(false);
    ['DRAFT', 'ARCHIVED', 'PAUSED', '', null, 'open'].forEach((applicationStatus) =>
      expect(isUsableJobListItem({ title: 'T', slug: 's', applicationStatus })).toBe(false),
    );
  });
});

describe('screening text limits (cycle 2 alignment)', () => {
  const q = (type) => ({ id: 'q', type, required: true, prompt: 'p' });

  it('accepts 1000 and rejects 1001 characters for SHORT_TEXT', () => {
    expect(validateScreeningAnswer(q('SHORT_TEXT'), 'a'.repeat(1000))).toBeNull();
    expect(validateScreeningAnswer(q('SHORT_TEXT'), 'a'.repeat(1001))).toMatch(/1000 characters or fewer/);
  });

  it('accepts 3000 and rejects 3001 characters for LONG_TEXT', () => {
    expect(validateScreeningAnswer(q('LONG_TEXT'), 'a'.repeat(3000))).toBeNull();
    expect(validateScreeningAnswer(q('LONG_TEXT'), 'a'.repeat(3001))).toMatch(/3000 characters or fewer/);
  });

  it('leaves SINGLE_SELECT and YES_NO behaviour unchanged', () => {
    const select = {
      id: 's', type: 'SINGLE_SELECT', required: true,
      options: [{ optionId: 'one', label: 'One' }, { optionId: 'two', label: 'Two' }],
    };
    // The answer is the optionId; the label is display text and is rejected.
    expect(validateScreeningAnswer(select, 'one')).toBeNull();
    expect(validateScreeningAnswer(select, 'One')).toMatch(/Answer this question/);
    expect(validateScreeningAnswer(select, 'Other')).toMatch(/Answer this question/);
    expect(validateScreeningAnswer({ id: 'y', type: 'YES_NO', required: true }, false)).toBeNull();
  });

  it('keeps the limits in one shared module', async () => {
    const { SCREENING_TEXT_MAX_LENGTH } = await import('../screeningContract.js');
    expect(SCREENING_TEXT_MAX_LENGTH.SHORT_TEXT).toBe(1000);
    expect(SCREENING_TEXT_MAX_LENGTH.LONG_TEXT).toBe(3000);
  });
});

describe('success DTO requires a usable submittedAt (cycle 2)', () => {
  const base = { status: 'RECEIVED', job: { title: 'T', slug: 's' } };

  it('accepts a canonical ISO timestamp', async () => {
    const { isValidApplicationResult } = await import('../api/applicationsApi.js');
    expect(isValidApplicationResult({ ...base, submittedAt: '2026-09-10T18:45:00.000Z' })).toBe(true);
  });

  it.each([
    ['missing', undefined],
    ['empty', '   '],
    ['unparseable', 'not-a-date'],
    ['non-string', 1757530000000],
  ])('rejects a %s submittedAt', async (_label, submittedAt) => {
    const { isValidApplicationResult } = await import('../api/applicationsApi.js');
    expect(isValidApplicationResult({ ...base, submittedAt })).toBe(false);
  });

  it('does not require a public application id', async () => {
    const { isValidApplicationResult } = await import('../api/applicationsApi.js');
    expect(isValidApplicationResult({ ...base, submittedAt: '2026-09-10T18:45:00.000Z', id: undefined })).toBe(true);
  });
});


describe('Cycle 3 — public Jobs LIST is OPEN-only (finding 1)', () => {
  const row = (applicationStatus) => ({ title: 'Role', slug: 'role', applicationStatus });

  it.each([
    ['OPEN', 'OPEN', true],
    ['missing status', undefined, false],
    ['CLOSED', 'CLOSED', false],
    ['DRAFT', 'DRAFT', false],
    ['ARCHIVED', 'ARCHIVED', false],
  ])('list row with %s -> %s', async (_label, status, expected) => {
    const { isUsableJobListItem } = await import('../../jobs/api/jobsApi.js');
    expect(isUsableJobListItem(row(status))).toBe(expected);
  });

  it('does not break retained CLOSED Job Detail validation', async () => {
    const { isUsableJobDetail } = await import('../../jobs/api/jobsApi.js');
    // The detail contract must keep accepting CLOSED: retained closed Job URLs
    // remain valid and must continue to resolve.
    expect(isUsableJobDetail({
      title: 'Role', slug: 'role', applicationStatus: 'CLOSED', applicationForm: null,
    })).toBe(true);
  });

  it('treats one malformed row as a malformed payload, not an empty list', async () => {
    const { getPublishedJobs } = await import('../../jobs/api/jobsApi.js');
    const body = {
      success: true,
      data: { items: [row('OPEN'), row('CLOSED')] },
      meta: { requestId: 'r' },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ));
    // Not a partially filtered list and not an empty state.
    await expect(getPublishedJobs()).rejects.toMatchObject({ type: 'MALFORMED' });
    vi.unstubAllGlobals();
  });
});

describe('Cycle 3 — OPEN resume and screening contract (finding 2)', () => {
  const form = (overrides = {}) => ({
    phone: { enabled: false, required: false },
    message: { enabled: false, required: false, maxLength: 5000 },
    resume: { required: true, maxBytes: 5242880, allowedExtensions: ['.pdf', '.docx'] },
    screeningQuestions: [],
    ...overrides,
  });
  const openJob = (applicationForm) => ({
    title: 'T', slug: 's', applicationStatus: 'OPEN', applicationForm,
  });
  const check = async (applicationForm) => {
    const { isUsableJobDetail } = await import('../../jobs/api/jobsApi.js');
    return isUsableJobDetail(openJob(applicationForm));
  };

  it('accepts the canonical Phase 1 resume configuration', async () => {
    expect(await check(form())).toBe(true);
    expect(await check(form({ resume: { required: true, maxBytes: 1048576, allowedExtensions: ['.pdf'] } }))).toBe(true);
  });

  it('rejects resume.required false — Phase 1 always requires a resume', async () => {
    expect(await check(form({ resume: { required: false, maxBytes: 1000, allowedExtensions: ['.pdf'] } }))).toBe(false);
  });

  it.each([
    ['.exe only', ['.exe']],
    ['.pdf plus .exe', ['.pdf', '.exe']],
    ['.doc', ['.doc']],
    ['.docm', ['.docm']],
    ['.jpg', ['.jpg']],
    ['.zip', ['.zip']],
  ])('rejects unsupported extensions: %s', async (_label, allowedExtensions) => {
    expect(await check(form({ resume: { required: true, maxBytes: 1000, allowedExtensions } }))).toBe(false);
  });

  it('compares extensions case-insensitively without broadening the set', async () => {
    expect(await check(form({ resume: { required: true, maxBytes: 1000, allowedExtensions: ['.PDF', '.DocX'] } }))).toBe(true);
    expect(await check(form({ resume: { required: true, maxBytes: 1000, allowedExtensions: ['.EXE'] } }))).toBe(false);
  });

  it('rejects a maxBytes above the canonical Phase 1 maximum', async () => {
    expect(await check(form({ resume: { required: true, maxBytes: 5242880, allowedExtensions: ['.pdf'] } }))).toBe(true);
    expect(await check(form({ resume: { required: true, maxBytes: 5242881, allowedExtensions: ['.pdf'] } }))).toBe(false);
    expect(await check(form({ resume: { required: true, maxBytes: 0, allowedExtensions: ['.pdf'] } }))).toBe(false);
  });

  it.each([
    ['an empty array', [], true],
    ['undefined', undefined, false],
    ['null', null, false],
    ['an object', {}, false],
    ['a string', 'none', false],
  ])('screeningQuestions as %s -> %s', async (_label, screeningQuestions, expected) => {
    expect(await check(form({ screeningQuestions }))).toBe(expected);
  });

  it('retains the Cycle 2 OPEN/CLOSED form relationship', async () => {
    const { isUsableJobDetail } = await import('../../jobs/api/jobsApi.js');
    expect(await check(null)).toBe(false);
    expect(isUsableJobDetail({ title: 'T', slug: 's', applicationStatus: 'CLOSED', applicationForm: null })).toBe(true);
    expect(isUsableJobDetail({ title: 'T', slug: 's', applicationStatus: 'CLOSED', applicationForm: form() })).toBe(false);
  });
});

describe('Cycle 3 — submittedAt must be ISO-8601 UTC (finding 3)', () => {
  const withTimestamp = (submittedAt) => ({
    status: 'RECEIVED', job: { title: 'T', slug: 's' }, submittedAt,
  });

  it.each([
    ['2026-09-10T18:45:00.000Z', true],
    ['2026-09-10T18:45:00Z', true],
  ])('accepts canonical UTC form %s', async (submittedAt, expected) => {
    const { isValidApplicationResult } = await import('../api/applicationsApi.js');
    expect(isValidApplicationResult(withTimestamp(submittedAt))).toBe(expected);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['garbage', 'not-a-timestamp'],
    ['locale long form', 'September 10, 2026'],
    ['slash date', '09/10/2026'],
    ['date only', '2026-09-10'],
    ['short month name', '10 Sep 2026'],
    ['offset instead of UTC', '2026-09-10T18:45:00+02:00'],
    ['naive local time', '2026-09-10T18:45:00'],
    ['impossible calendar day', '2026-02-30T00:00:00.000Z'],
    ['impossible month', '2026-13-01T00:00:00.000Z'],
    ['impossible hour', '2026-09-10T24:00:00.000Z'],
    ['impossible second', '2026-09-10T18:45:60.000Z'],
    ['non-string', 1757530000000],
  ])('rejects %s', async (_label, submittedAt) => {
    const { isValidApplicationResult } = await import('../api/applicationsApi.js');
    expect(isValidApplicationResult(withTimestamp(submittedAt))).toBe(false);
  });

  it('still requires no public application id', async () => {
    const { isValidApplicationResult } = await import('../api/applicationsApi.js');
    expect(isValidApplicationResult(withTimestamp('2026-09-10T18:45:00.000Z'))).toBe(true);
  });
});

describe('Cycle 4 — SINGLE_SELECT uses option identifiers (finding 1)', () => {
  const form = (screeningQuestions) => ({
    phone: { enabled: false, required: false },
    message: { enabled: false, required: false, maxLength: 5000 },
    resume: { required: true, maxBytes: 5242880, allowedExtensions: ['.pdf', '.docx'] },
    screeningQuestions,
  });
  const openJob = (questions) => ({
    title: 'T', slug: 's', applicationStatus: 'OPEN', applicationForm: form(questions),
  });
  const select = (options) => [
    { id: 'q', type: 'SINGLE_SELECT', prompt: 'Pick one', required: true, options },
  ];
  const check = async (questions) => {
    const { isUsableJobDetail } = await import('../../jobs/api/jobsApi.js');
    return isUsableJobDetail(openJob(questions));
  };
  const twoOptions = [
    { optionId: 'a', label: 'Option A' },
    { optionId: 'b', label: 'Option B' },
  ];

  it('accepts canonical { optionId, label } options', async () => {
    expect(await check(select(twoOptions))).toBe(true);
  });

  it('rejects legacy plain-string options', async () => {
    expect(await check(select(['Option A', 'Option B']))).toBe(false);
  });

  it('rejects an option missing optionId or label', async () => {
    expect(await check(select([{ label: 'A' }, { optionId: 'b', label: 'B' }]))).toBe(false);
    expect(await check(select([{ optionId: 'a' }, { optionId: 'b', label: 'B' }]))).toBe(false);
    expect(await check(select([{ optionId: '  ', label: 'A' }, { optionId: 'b', label: 'B' }]))).toBe(false);
  });

  it('rejects duplicate optionIds', async () => {
    expect(await check(select([
      { optionId: 'dup', label: 'A' },
      { optionId: 'dup', label: 'B' },
    ]))).toBe(false);
  });

  it('rejects a one-option SINGLE_SELECT', async () => {
    expect(await check(select([{ optionId: 'only', label: 'Only' }]))).toBe(false);
    expect(await check(select([]))).toBe(false);
  });

  it('rejects more than 50 options', async () => {
    const many = (n) => Array.from({ length: n }, (_, i) => ({ optionId: `o${i}`, label: `L${i}` }));
    expect(await check(select(many(50)))).toBe(true);
    expect(await check(select(many(51)))).toBe(false);
  });

  it.each(['SHORT_TEXT', 'LONG_TEXT', 'YES_NO'])(
    'rejects %s carrying a non-empty options array',
    async (type) => {
      expect(await check([{ id: 'q', type, prompt: 'p', required: false, options: twoOptions }])).toBe(false);
      expect(await check([{ id: 'q', type, prompt: 'p', required: false, options: [] }])).toBe(true);
    },
  );

  it('validates an answer against optionId, rejecting the label', () => {
    const question = { id: 'q', type: 'SINGLE_SELECT', required: true, options: twoOptions };
    expect(validateScreeningAnswer(question, 'a')).toBeNull();
    expect(validateScreeningAnswer(question, 'Option A')).toMatch(/Answer this question/);
    expect(validateScreeningAnswer(question, 'unknown')).toMatch(/Answer this question/);
  });

  it('transports the optionId in screeningAnswers, never the label', () => {
    const fd = buildApplicationFormData({
      values: { fullName: 'Jane Doe', email: 'jane@example.com', screeningAnswers: { q: 'a' } },
      applicationForm: form(select(twoOptions)),
      resumeFile: null,
    });
    const answers = JSON.parse(fd.get('screeningAnswers'));
    expect(answers).toEqual([{ questionId: 'q', answer: 'a' }]);
    expect(fd.get('screeningAnswers')).not.toContain('Option A');
  });
});

describe('Cycle 4 — phone/message config consistency', () => {
  const base = {
    resume: { required: true, maxBytes: 5242880, allowedExtensions: ['.pdf'] },
    screeningQuestions: [],
  };
  const check = async (extra) => {
    const { isUsableJobDetail } = await import('../../jobs/api/jobsApi.js');
    return isUsableJobDetail({
      title: 'T', slug: 's', applicationStatus: 'OPEN', applicationForm: { ...base, ...extra },
    });
  };

  it('rejects phone required while disabled', async () => {
    expect(await check({ phone: { enabled: false, required: true } })).toBe(false);
    expect(await check({ phone: { enabled: true, required: true } })).toBe(true);
    expect(await check({ phone: { enabled: false, required: false } })).toBe(true);
  });

  it('rejects message required while disabled', async () => {
    expect(await check({ message: { enabled: false, required: true, maxLength: 100 } })).toBe(false);
    expect(await check({ message: { enabled: true, required: true, maxLength: 100 } })).toBe(true);
  });

  it('rejects a message maxLength above the Phase 1 maximum', async () => {
    expect(await check({ message: { enabled: true, required: false, maxLength: 5000 } })).toBe(true);
    expect(await check({ message: { enabled: true, required: false, maxLength: 5001 } })).toBe(false);
    expect(await check({ message: { enabled: true, required: false, maxLength: 0 } })).toBe(false);
    // A smaller job-specific limit stays valid.
    expect(await check({ message: { enabled: true, required: false, maxLength: 500 } })).toBe(true);
  });
});

describe('Cycle 5 — non-SINGLE_SELECT options must be an explicit [] (finding 1)', () => {
  const form = (screeningQuestions) => ({
    phone: { enabled: false, required: false },
    message: { enabled: false, required: false, maxLength: 5000 },
    resume: { required: true, maxBytes: 5242880, allowedExtensions: ['.pdf', '.docx'] },
    screeningQuestions,
  });
  const check = async (question) => {
    const { isUsableJobDetail } = await import('../../jobs/api/jobsApi.js');
    return isUsableJobDetail({
      title: 'T', slug: 's', applicationStatus: 'OPEN', applicationForm: form([question]),
    });
  };
  const base = (type) => ({ id: 'q', type, prompt: 'Prompt', required: false });

  it.each(['SHORT_TEXT', 'LONG_TEXT', 'YES_NO'])('%s with [] is valid', async (type) => {
    expect(await check({ ...base(type), options: [] })).toBe(true);
  });

  it.each(['SHORT_TEXT', 'LONG_TEXT', 'YES_NO'])('%s with options missing is invalid', async (type) => {
    expect(await check(base(type))).toBe(false);
  });

  it.each(['SHORT_TEXT', 'LONG_TEXT', 'YES_NO'])('%s with null options is invalid', async (type) => {
    expect(await check({ ...base(type), options: null })).toBe(false);
  });

  it.each(['SHORT_TEXT', 'LONG_TEXT', 'YES_NO'])('%s with a non-empty array is invalid', async (type) => {
    expect(await check({ ...base(type), options: [{ optionId: 'a', label: 'A' }] })).toBe(false);
  });

  it.each(['SHORT_TEXT', 'LONG_TEXT', 'YES_NO'])('%s with an object for options is invalid', async (type) => {
    expect(await check({ ...base(type), options: {} })).toBe(false);
  });

  it('leaves the SINGLE_SELECT option contract unchanged', async () => {
    const options = [
      { optionId: 'a', label: 'A' },
      { optionId: 'b', label: 'B' },
    ];
    expect(await check({ id: 'q', type: 'SINGLE_SELECT', prompt: 'P', required: true, options })).toBe(true);
    expect(await check({ id: 'q', type: 'SINGLE_SELECT', prompt: 'P', required: true, options: [] })).toBe(false);
  });
});
