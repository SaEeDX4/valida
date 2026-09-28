import { describe, it, expect } from 'vitest';
import { REQUIRED_INDEXES, keysEqual, optionsCompatible, diffIndexes } from '../src/db/indexes.js';

/**
 * Index definitions and the comparison algorithm — Doc 10.
 *
 * These prove the DEFINITIONS and the diff logic offline. Whether the indexes
 * actually exist in a database is proven in tests/db, which needs a real
 * MongoDB.
 */
const find = (collection, key) =>
  REQUIRED_INDEXES.find(
    (index) => index.collection === collection && JSON.stringify(index.key) === JSON.stringify(key),
  );

describe('required index set', () => {
  it('declares exactly the six required indexes', () => {
    expect(REQUIRED_INDEXES).toHaveLength(6);
  });

  it.each([
    ['jobs', { slug: 1 }, true],
    ['jobs', { status: 1, publishedAt: -1, closesAt: 1, createdAt: -1 }, false],
    ['applications', { jobId: 1, submittedAt: -1 }, false],
    ['applications', { 'candidate.emailNormalized': 1, jobId: 1, submittedAt: -1 }, false],
    ['applications', { 'idempotency.keyHash': 1 }, true],
    ['applications', { 'resume.storageKey': 1 }, true],
  ])('declares %s %j with unique=%s', (collection, key, unique) => {
    const index = find(collection, key);
    expect(index, `missing required index on ${collection}`).toBeTruthy();
    expect(Boolean(index.options.unique)).toBe(unique);
  });

  it('keeps the email/job index NON-unique', () => {
    // Doc 10 section 129 — the same person may legitimately apply to different
    // roles, or reapply to the same one.
    const index = find('applications', { 'candidate.emailNormalized': 1, jobId: 1, submittedAt: -1 });
    expect(index.options.unique).toBeUndefined();
  });

  it('declares no TTL index (Doc 10 section 127)', () => {
    // Deleting only the MongoDB record would orphan the private resume object.
    REQUIRED_INDEXES.forEach((index) => expect(index.options.expireAfterSeconds).toBeUndefined());
  });

  it('declares no speculative Phase 3 status index (Doc 10 section 130)', () => {
    expect(find('applications', { status: 1, submittedAt: -1 })).toBeUndefined();
  });

  it('gives every index a documented reason', () => {
    REQUIRED_INDEXES.forEach((index) => expect(index.reason).toMatch(/Doc 10 section/));
  });
});

describe('key comparison respects order and direction', () => {
  it('accepts an exact match', () => {
    expect(keysEqual({ a: 1, b: -1 }, { a: 1, b: -1 })).toBe(true);
  });

  it('rejects reordered compound keys', () => {
    // A compound index is only usable for the prefix order it was built with.
    expect(keysEqual({ a: 1, b: -1 }, { b: -1, a: 1 })).toBe(false);
  });

  it('rejects a reversed direction', () => {
    expect(keysEqual({ submittedAt: -1 }, { submittedAt: 1 })).toBe(false);
  });

  it('rejects extra or missing fields', () => {
    expect(keysEqual({ a: 1 }, { a: 1, b: 1 })).toBe(false);
    expect(keysEqual({ a: 1, b: 1 }, { a: 1 })).toBe(false);
  });
});

describe('option comparison', () => {
  it('treats absent and false as equivalent', () => {
    expect(optionsCompatible({}, {})).toBe(true);
    expect(optionsCompatible({}, { unique: false })).toBe(true);
  });

  it('detects a missing unique constraint', () => {
    expect(optionsCompatible({ unique: true }, {})).toBe(false);
    expect(optionsCompatible({ unique: true }, { unique: false })).toBe(false);
  });

  it('detects an unexpected unique constraint', () => {
    expect(optionsCompatible({}, { unique: true })).toBe(false);
  });

  it('detects an unexpected TTL', () => {
    expect(optionsCompatible({}, { expireAfterSeconds: 60 })).toBe(false);
  });
});

describe('diff classification', () => {
  const actualFor = (overrides = {}) => ({
    jobs: [
      { name: 'slug_unique', key: { slug: 1 }, unique: true },
      { name: 'public_listing', key: { status: 1, publishedAt: -1, closesAt: 1, createdAt: -1 } },
    ],
    applications: [
      { name: 'job_submittedAt', key: { jobId: 1, submittedAt: -1 } },
      { name: 'email_job', key: { 'candidate.emailNormalized': 1, jobId: 1, submittedAt: -1 } },
      { name: 'idem', key: { 'idempotency.keyHash': 1 }, unique: true },
      { name: 'storage', key: { 'resume.storageKey': 1 }, unique: true },
    ],
    ...overrides,
  });

  it('reports a fully indexed database as satisfied', () => {
    const { satisfied, missing, incompatible } = diffIndexes(REQUIRED_INDEXES, actualFor());
    expect(satisfied).toHaveLength(6);
    expect(missing).toHaveLength(0);
    expect(incompatible).toHaveLength(0);
  });

  it('matches by key, so a differently named index still counts', () => {
    // An operator may have created the index under another name.
    const renamed = actualFor({ jobs: [{ name: 'slug_1', key: { slug: 1 }, unique: true }] });
    const { satisfied } = diffIndexes(REQUIRED_INDEXES, renamed);
    expect(satisfied.some((entry) => entry.actual.name === 'slug_1')).toBe(true);
  });

  it('reports an empty database as all missing', () => {
    const { missing } = diffIndexes(REQUIRED_INDEXES, { jobs: [], applications: [] });
    expect(missing).toHaveLength(6);
  });

  it('reports a non-unique slug index as incompatible, not missing', () => {
    const weakened = actualFor({ jobs: [{ name: 'slug_unique', key: { slug: 1 } }] });
    const { missing, incompatible } = diffIndexes(REQUIRED_INDEXES, weakened);
    expect(incompatible).toHaveLength(1);
    expect(incompatible[0].requirement.collection).toBe('jobs');
    expect(missing.some((index) => JSON.stringify(index.key) === JSON.stringify({ slug: 1 }))).toBe(false);
  });

  it('reports a wrongly ordered compound index as missing', () => {
    const reordered = actualFor({
      applications: [{ name: 'job_submittedAt', key: { submittedAt: -1, jobId: 1 } }],
    });
    const { missing } = diffIndexes(REQUIRED_INDEXES, reordered);
    expect(missing.some((index) => JSON.stringify(index.key) === JSON.stringify({ jobId: 1, submittedAt: -1 }))).toBe(true);
  });
});

describe('index comparison edge cases', () => {
  const slugRequirement = REQUIRED_INDEXES.find((index) => index.name === 'slug_unique');

  it('treats a TTL of 0 as a TTL (it means "expire immediately")', () => {
    expect(optionsCompatible({}, { expireAfterSeconds: 0 })).toBe(false);
    expect(optionsCompatible({}, {})).toBe(true);
  });

  it('is satisfied by a compatible index even when an incompatible one shares the key', () => {
    const actual = {
      jobs: [
        { name: 'slug_ci', key: { slug: 1 }, unique: true, collation: { locale: 'en', strength: 2 } },
        { name: 'slug_1', key: { slug: 1 }, unique: true },
      ],
      applications: [],
    };
    const { satisfied } = diffIndexes([slugRequirement], actual);
    expect(satisfied.map((entry) => entry.actual.name)).toEqual(['slug_1']);
  });

  it('reports an index with the right keys but different options as incompatible, not missing', () => {
    const { missing, incompatible } = diffIndexes([slugRequirement], {
      jobs: [{ name: 'slug_1', key: { slug: 1 } }],
    });
    expect(missing).toHaveLength(0);
    expect(incompatible.map((entry) => entry.actual.name)).toEqual(['slug_1']);
  });
});
