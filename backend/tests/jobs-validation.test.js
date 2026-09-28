import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LIMIT,
  DEFAULT_PAGE,
  MAX_LIMIT,
  isValidPublicSlug,
  parseDetailQuery,
  parseListQuery,
} from '../src/modules/jobs/job.validation.js';

/**
 * Public Jobs input validation — Doc 09 sections 27, 50-52, 60-61; Doc 13
 * sections 44-46; Doc 17 sections 80-82.
 */

const PAGE_ERROR = { field: 'page', code: 'INVALID_PAGE', message: 'page must be a whole number of at least 1.' };
const LIMIT_ERROR = { field: 'limit', code: 'INVALID_LIMIT', message: 'limit must be a whole number from 1 to 50.' };
const UNSUPPORTED = {
  field: 'query',
  code: 'UNSUPPORTED_PARAMETER',
  message: 'Only the page and limit query parameters are supported.',
};

describe('GET /api/v1/jobs query parameters', () => {
  it('defaults to page 1, limit 20, and caps limit at 50', () => {
    expect([DEFAULT_PAGE, DEFAULT_LIMIT, MAX_LIMIT]).toEqual([1, 20, 50]);
    expect(parseListQuery({})).toEqual({ ok: true, value: { page: 1, limit: 20 } });
    expect(parseListQuery(undefined)).toEqual({ ok: true, value: { page: 1, limit: 20 } });
  });

  it.each([
    [{ page: '1', limit: '1' }, { page: 1, limit: 1 }],
    [{ page: '2', limit: '50' }, { page: 2, limit: 50 }],
    [{ page: '9007199254740991' }, { page: Number.MAX_SAFE_INTEGER, limit: 20 }],
    [{ limit: '7' }, { page: 1, limit: 7 }],
    [{ page: '03' }, { page: 3, limit: 20 }],
  ])('accepts %j', (query, value) => {
    expect(parseListQuery(query)).toEqual({ ok: true, value });
  });

  it.each(['0', '-1', '+1', '1.5', '1e2', ' 1', '1 ', '', 'abc', '0x10', '9007199254740992', '١'])(
    'rejects page=%j with the page field error',
    (page) => {
      expect(parseListQuery({ page })).toEqual({ ok: false, fieldErrors: [PAGE_ERROR] });
    },
  );

  it.each(['0', '51', '100', '-5', '2.0', '', 'ten'])('rejects limit=%j with the limit field error', (limit) => {
    expect(parseListQuery({ limit })).toEqual({ ok: false, fieldErrors: [LIMIT_ERROR] });
  });

  it('rejects a repeated parameter instead of choosing one of its values', () => {
    expect(parseListQuery({ page: ['1', '2'] })).toEqual({ ok: false, fieldErrors: [PAGE_ERROR] });
    expect(parseListQuery({ limit: ['5', '5'] })).toEqual({ ok: false, fieldErrors: [LIMIT_ERROR] });
  });

  it('rejects object-shaped values that could otherwise become query operators', () => {
    expect(parseListQuery({ page: { $gt: '0' } })).toEqual({ ok: false, fieldErrors: [PAGE_ERROR] });
  });

  it.each([
    { status: 'DRAFT' },
    { includeArchived: 'true' },
    { 'page[$gt]': '0' },
    { sort: 'createdAt' },
    { $where: '1' },
    JSON.parse('{"__proto__": "x"}'),
    { constructor: 'x' },
  ])('rejects unsupported parameter %j so no client value can widen the list', (query) => {
    expect(parseListQuery(query)).toEqual({ ok: false, fieldErrors: [UNSUPPORTED] });
  });

  it('reports every problem once, and never echoes a value or an unknown name', () => {
    const result = parseListQuery({ page: '0', limit: '99', secretName: 'secret-value', other: 'x' });
    expect(result).toEqual({ ok: false, fieldErrors: [PAGE_ERROR, LIMIT_ERROR, UNSUPPORTED] });
    expect(JSON.stringify(result)).not.toMatch(/secret|other|99/);
  });
});

describe('GET /api/v1/jobs/:jobSlug query parameters', () => {
  it('accepts none', () => {
    expect(parseDetailQuery({})).toEqual({ ok: true });
    expect(parseDetailQuery(undefined)).toEqual({ ok: true });
    expect(parseDetailQuery({ preview: 'true' })).toEqual({
      ok: false,
      fieldErrors: [{ field: 'query', code: 'UNSUPPORTED_PARAMETER', message: 'This endpoint does not accept query parameters.' }],
    });
  });
});

describe('public slug validation (Doc 09 section 60)', () => {
  it.each(['cybersecurity-specialist', 'a', '0', 'qa-role-2', 'a'.repeat(120)])('accepts %s', (slug) => {
    expect(isValidPublicSlug(slug)).toBe(true);
  });

  it.each([
    '',
    'a'.repeat(121),
    'Cybersecurity-Specialist',
    '-leading',
    'trailing-',
    'double--hyphen',
    'under_score',
    'with space',
    'dot.slug',
    'slug/extra',
    '..',
    'café',
    '%2F',
    '{"$ne":null}',
    'slug\u0000',
  ])('rejects %j', (slug) => {
    expect(isValidPublicSlug(slug)).toBe(false);
  });

  it.each([null, undefined, 42, ['a'], { $ne: null }])('rejects the non-string %j', (slug) => {
    expect(isValidPublicSlug(slug)).toBe(false);
  });
});
