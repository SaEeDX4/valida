import { describe, it, expect } from 'vitest';
import {
  CURRENCY_MINOR_UNIT_EXPONENTS,
  MoneyConversionError,
  isSupportedCurrency,
  minorToMajor,
} from '../src/modules/jobs/money.js';
import {
  PublicJobMappingError,
  toPublicApplicationForm,
  toPublicCompensation,
  toPublicJobDetail,
  toPublicJobListItem,
} from '../src/modules/jobs/job.mapper.js';
import {
  PUBLIC_LIST_SORT,
  openJobsFilter,
  publicApplicationStatus,
  publicDetailFilter,
} from '../src/modules/jobs/job.visibility.js';
import { RESUME_UPLOAD_POLICY } from '../src/config/resumePolicy.js';
import {
  QA_NOW,
  QA_OPTION_A,
  QA_OPTION_B,
  QA_QUESTION_ID,
  QA_SELECT_QUESTION_ID,
  at,
  minutes,
  storedJob,
} from './fixtures/jobFixtures.js';

/**
 * B3 public DTOs, money conversion and visibility rules — pure unit tests.
 * Doc 09 sections 44-47, 54, 62-67, 182-186; Doc 10 sections 13-15, 23, 46, 63.
 *
 * These prove the mapping and the rule, not what MongoDB selects: the query
 * side is proven against a real database in tests/db/jobs-api.test.js.
 */

const LIST_KEYS = [
  'title', 'slug', 'location', 'workArrangement', 'employmentType', 'schedule', 'weeklyHours',
  'compensation', 'publishedAt', 'closesAt', 'applicationStatus',
];
const DETAIL_KEYS = [
  'title', 'slug', 'location', 'workArrangement', 'employmentType', 'schedule', 'weeklyHours',
  'compensation', 'description', 'responsibilities', 'requirements', 'preferredQualifications',
  'publishedAt', 'closesAt', 'applicationStatus', 'applicationForm',
];

/** Everything internal the fixture carries; none of it may appear in any public JSON. */
const INTERNAL_MARKERS = [
  '_id', '__v', 'internalOccupationalReference', 'NOC 99999', 'QA-INTERNAL', 'internalNotes',
  'closedAt', 'archivedAt', 'createdAt', 'updatedAt', 'amountMinor', 'countryCode', 'regionCode',
  'locality', 'resumeRequired', 'embedded-subdocument-id', 'embedded-option-id', '65f0c0ffee',
  '"status"', 'questionId',
];

describe('money conversion (Doc 10 sections 13-15)', () => {
  it('uses the ISO 4217 exponent of the only source-established currency, CAD', () => {
    expect(CURRENCY_MINOR_UNIT_EXPONENTS).toEqual({ CAD: 2 });
    expect(isSupportedCurrency('CAD')).toBe(true);
  });

  it.each([
    [3500, 35],
    [3550, 35.5],
    [3599, 35.99],
    [1, 0.01],
    [0, 0],
    [123456789, 1234567.89],
  ])('converts %i minor units to %d exactly', (minor, major) => {
    expect(minorToMajor(minor, 'CAD')).toBe(major);
    expect(JSON.stringify(minorToMajor(minor, 'CAD'))).toBe(String(major));
  });

  it.each(['USD', 'EUR', 'JPY', 'KWD', 'cad', '', null, undefined, 'hasOwnProperty', '__proto__'])(
    'refuses currency %s rather than guessing its exponent',
    (currency) => {
      expect(isSupportedCurrency(currency)).toBe(false);
      expect(() => minorToMajor(3500, currency)).toThrow(MoneyConversionError);
    },
  );

  it.each([35.5, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1, '3500', null])('refuses minor amount %s', (value) => {
    expect(() => minorToMajor(value, 'CAD')).toThrow(MoneyConversionError);
  });
});

describe('public compensation DTO', () => {
  it('maps { currency, amountMinor, unit, gross } to { currency, amount, unit, gross }', () => {
    expect(toPublicCompensation({ currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: true })).toEqual({
      currency: 'CAD',
      amount: 35,
      unit: 'HOUR',
      gross: true,
    });
  });

  it('is null — not a partial object — when the stored compensation is incomplete', () => {
    expect(toPublicCompensation(undefined)).toBeNull();
    expect(toPublicCompensation({ currency: 'CAD', amountMinor: null, unit: 'HOUR', gross: true })).toBeNull();
    expect(toPublicCompensation({ currency: 'CAD', amountMinor: 3500, unit: null, gross: true })).toBeNull();
    expect(toPublicCompensation({ currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: null })).toBeNull();
  });

  it('fails closed on an unsupported currency instead of publishing a wrong wage', () => {
    expect(() => toPublicCompensation({ currency: 'JPY', amountMinor: 3500, unit: 'HOUR', gross: true })).toThrow(
      PublicJobMappingError,
    );
  });
});

describe('public Job list item (Doc 09 section 54)', () => {
  it('has exactly the documented keys, in order, with ISO UTC dates', () => {
    const item = toPublicJobListItem(storedJob(), 'OPEN');
    expect(Object.keys(item)).toEqual(LIST_KEYS);
    expect(item).toEqual({
      title: 'QA Synthetic Security Analyst',
      slug: 'qa-synthetic-security-analyst',
      location: 'QA Region, Canada',
      workArrangement: 'FULLY_REMOTE',
      employmentType: 'CONTRACT',
      schedule: 'QA TEST DATA schedule wording',
      weeklyHours: 30,
      compensation: { currency: 'CAD', amount: 35, unit: 'HOUR', gross: true },
      publishedAt: '2026-09-20T09:30:00.000Z',
      closesAt: null,
      applicationStatus: 'OPEN',
    });
  });

  it('exposes no internal field, identifier or unknown stored property', () => {
    const json = JSON.stringify(toPublicJobListItem(storedJob({ closesAt: at(minutes(60)) }), 'OPEN'));
    INTERNAL_MARKERS.forEach((marker) => expect(json).not.toContain(marker));
    expect(json).toContain('"closesAt":"2026-10-01T13:00:00.000Z"');
  });

  it('refuses to label a list row as anything but OPEN — the list never carries a closed or hidden Job', () => {
    [null, 'CLOSED', undefined].forEach((status) =>
      expect(() => toPublicJobListItem(storedJob(), status)).toThrow(PublicJobMappingError),
    );
  });

  it('keeps a predictable shape when optional values are absent (Doc 09 section 186)', () => {
    const item = toPublicJobListItem(
      storedJob({ location: undefined, employmentType: undefined, schedule: null, weeklyHours: undefined }),
      'OPEN',
    );
    expect(Object.keys(item)).toEqual(LIST_KEYS);
    expect(item).toMatchObject({ location: null, employmentType: null, schedule: null, weeklyHours: null });
  });
});

describe('public Job detail (Doc 09 sections 63-67)', () => {
  it('OPEN: exact keys and the application form built from the Job plus the server resume policy', () => {
    const detail = toPublicJobDetail(storedJob(), 'OPEN');
    expect(Object.keys(detail)).toEqual(DETAIL_KEYS);
    expect(detail.applicationStatus).toBe('OPEN');
    expect(detail.applicationForm).toEqual({
      phone: { enabled: true, required: false },
      message: { enabled: true, required: true, maxLength: 2000 },
      resume: { required: true, maxBytes: 5242880, allowedExtensions: ['.pdf', '.docx'] },
      screeningQuestions: [
        {
          id: QA_QUESTION_ID,
          type: 'YES_NO',
          prompt: 'QA TEST DATA: are you able to work the stated hours?',
          required: true,
          options: [],
        },
        {
          id: QA_SELECT_QUESTION_ID,
          type: 'SINGLE_SELECT',
          prompt: 'QA TEST DATA: preferred start window?',
          required: false,
          options: [
            { optionId: QA_OPTION_A, label: 'QA option A' },
            { optionId: QA_OPTION_B, label: 'QA option B' },
          ],
        },
      ],
    });
    expect(detail.description).toBe('QA TEST DATA description.');
    expect(detail.responsibilities).toEqual(['QA TEST DATA responsibility.']);
    expect(detail.preferredQualifications).toEqual([]);
  });

  it('CLOSED: keeps the role content but carries applicationForm null (Doc 09 section 65)', () => {
    const detail = toPublicJobDetail(storedJob({ status: 'CLOSED' }), 'CLOSED');
    expect(Object.keys(detail)).toEqual(DETAIL_KEYS);
    expect(detail.applicationStatus).toBe('CLOSED');
    expect(detail.applicationForm).toBeNull();
    expect(detail.description).toBe('QA TEST DATA description.');
  });

  it('exposes no internal field, embedded _id or stored-only flag', () => {
    const json = JSON.stringify(toPublicJobDetail(storedJob(), 'OPEN'));
    INTERNAL_MARKERS.forEach((marker) => expect(json).not.toContain(marker));
  });

  it('refuses to map a Job that is not public', () => {
    [null, undefined, 'DRAFT', 'NOT_PUBLIC'].forEach((status) =>
      expect(() => toPublicJobDetail(storedJob(), status)).toThrow(PublicJobMappingError),
    );
  });

  it('never presents a field as required while it is disabled, and caps maxLength at 5000', () => {
    const form = toPublicApplicationForm({
      phone: { enabled: false, required: true },
      message: { enabled: false, required: true, maxLength: 999_999 },
    });
    expect(form.phone).toEqual({ enabled: false, required: false });
    expect(form.message).toEqual({ enabled: false, required: false, maxLength: 5000 });
    expect(form.screeningQuestions).toEqual([]);
  });

  it('gives non-select questions an explicit empty options array', () => {
    const form = toPublicApplicationForm({
      screeningQuestions: [{ questionId: QA_QUESTION_ID, type: 'SHORT_TEXT', prompt: 'QA?', required: false }],
    });
    expect(form.screeningQuestions[0].options).toEqual([]);
  });

  it('advertises the fixed Phase 1 resume policy without exposing it to mutation', () => {
    expect(RESUME_UPLOAD_POLICY).toEqual({ required: true, maxBytes: 5 * 1024 * 1024, allowedExtensions: ['.pdf', '.docx'] });
    expect(Object.isFrozen(RESUME_UPLOAD_POLICY)).toBe(true);
    const form = toPublicApplicationForm({});
    form.resume.allowedExtensions.push('.exe');
    expect(RESUME_UPLOAD_POLICY.allowedExtensions).toEqual(['.pdf', '.docx']);
  });
});

describe('public visibility (Doc 09 sections 44-46, 62; Doc 10 section 63)', () => {
  const job = (overrides) => storedJob({ publishedAt: at(-minutes(60)), closesAt: null, ...overrides });

  it.each([
    ['PUBLISHED, published earlier, no closing time', {}, 'OPEN'],
    ['PUBLISHED at exactly now', { publishedAt: QA_NOW }, 'OPEN'],
    ['PUBLISHED, closes 1 ms after now', { closesAt: at(1) }, 'OPEN'],
    ['PUBLISHED, closes exactly now (effective close)', { closesAt: QA_NOW }, 'CLOSED'],
    ['PUBLISHED, closing time passed (expired)', { closesAt: at(-1) }, 'CLOSED'],
    ['CLOSED, previously public', { status: 'CLOSED', closedAt: at(-1) }, 'CLOSED'],
    ['CLOSED with a future closesAt', { status: 'CLOSED', closesAt: at(minutes(60)) }, 'CLOSED'],
    ['PUBLISHED 1 ms in the future (not yet public)', { publishedAt: at(1) }, null],
    ['CLOSED but its publication is in the future', { status: 'CLOSED', publishedAt: at(1) }, null],
    ['PUBLISHED without publishedAt', { publishedAt: null }, null],
    ['CLOSED without publishedAt', { status: 'CLOSED', publishedAt: null }, null],
    ['DRAFT', { status: 'DRAFT', publishedAt: null }, null],
    ['DRAFT carrying a past publishedAt', { status: 'DRAFT' }, null],
    ['ARCHIVED after being public', { status: 'ARCHIVED', archivedAt: at(-1) }, null],
    ['unknown status', { status: 'SOMETHING_ELSE' }, null],
  ])('%s -> %s', (_label, overrides, expected) => {
    expect(publicApplicationStatus(job(overrides), QA_NOW)).toBe(expected);
  });

  it('treats a missing Job as not public', () => {
    expect(publicApplicationStatus(null, QA_NOW)).toBeNull();
  });

  it('requires a real server Date', () => {
    expect(() => publicApplicationStatus(job({}), '2026-10-01')).toThrow(TypeError);
    expect(() => openJobsFilter(new Date('invalid'))).toThrow(TypeError);
  });

  it('builds the open-list filter from fixed operators and the server clock only', () => {
    expect(openJobsFilter(QA_NOW)).toEqual({
      status: { $eq: 'PUBLISHED' },
      publishedAt: { $lte: QA_NOW },
      $or: [{ closesAt: { $eq: null } }, { closesAt: { $gt: QA_NOW } }],
    });
  });

  it('builds the detail filter with the slug bound by $eq and only PUBLISHED/CLOSED states', () => {
    expect(publicDetailFilter('qa-role', QA_NOW)).toEqual({
      slug: { $eq: 'qa-role' },
      status: { $in: ['PUBLISHED', 'CLOSED'] },
      publishedAt: { $lte: QA_NOW },
    });
    expect(() => publicDetailFilter({ $ne: null }, QA_NOW)).toThrow(TypeError);
  });

  it('sorts publishedAt DESC then createdAt DESC, with _id DESC only as the final tie-break', () => {
    expect(Object.entries(PUBLIC_LIST_SORT)).toEqual([
      ['publishedAt', -1],
      ['createdAt', -1],
      ['_id', -1],
    ]);
  });
});
