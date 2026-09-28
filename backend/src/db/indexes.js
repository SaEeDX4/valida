/**
 * Required MongoDB indexes — 10_DATA_MODEL.md sections 66-68, 97, 113, 128-132.
 *
 * THE SINGLE SOURCE OF TRUTH for every application-defined index. The check
 * script, the apply script and the tests all read this list, so the definition
 * cannot drift between "what we create" and "what we verify".
 *
 * Indexes are declared HERE rather than with `index: true` on the schema and
 * Mongoose autoIndex. Autoindex builds indexes implicitly on first use, which
 * is unpredictable in production and hides conflicts; an explicit, repeatable
 * command that an operator runs and can inspect is the deployable behaviour
 * (Doc 15).
 *
 * Deliberately NOT here:
 *   - any TTL index on applications (Doc 10 section 127 — deleting only the
 *     MongoDB record would orphan the private resume object);
 *   - { status: 1, submittedAt: -1 } on applications (section 130 — Phase 3);
 *   - any speculative future index.
 */

/** Key order and direction are significant and are compared exactly. */
export const REQUIRED_INDEXES = [
  {
    collection: 'jobs',
    name: 'slug_unique',
    key: { slug: 1 },
    options: { unique: true },
    reason: 'Doc 10 section 66 — public Job identity is the slug; it must be globally unique.',
  },
  {
    collection: 'jobs',
    name: 'public_listing',
    key: { status: 1, publishedAt: -1, closesAt: 1, createdAt: -1 },
    options: {},
    reason: 'Doc 10 section 67 — supports the public Careers listing query.',
  },
  {
    collection: 'applications',
    name: 'job_submittedAt',
    key: { jobId: 1, submittedAt: -1 },
    options: {},
    reason: 'Doc 10 section 128 — listing Applications for one Job, newest first.',
  },
  {
    collection: 'applications',
    name: 'candidateEmail_job_submittedAt',
    key: { 'candidate.emailNormalized': 1, jobId: 1, submittedAt: -1 },
    options: {},
    reason:
      'Doc 10 section 129 — operational duplicate review. Explicitly NOT unique: ' +
      'the same person may legitimately apply to different roles, or reapply.',
  },
  {
    collection: 'applications',
    name: 'idempotency_keyHash_unique',
    key: { 'idempotency.keyHash': 1 },
    options: { unique: true },
    reason:
      'Doc 10 section 113 — the database-level final protection against two ' +
      'concurrent requests creating duplicate Applications from one submission.',
  },
  {
    collection: 'applications',
    name: 'resume_storageKey_unique',
    key: { 'resume.storageKey': 1 },
    options: { unique: true },
    reason: 'Doc 10 section 97 — one stored resume object belongs to one Application.',
  },
];

/** Option keys that make an existing index incompatible if they differ. */
export const SIGNIFICANT_OPTIONS = ['unique', 'sparse', 'partialFilterExpression', 'expireAfterSeconds', 'collation'];

/** Key order matters in a compound index, so the comparison preserves it. */
export function keysEqual(expected, actual) {
  const expectedEntries = Object.entries(expected);
  const actualEntries = Object.entries(actual ?? {});
  if (expectedEntries.length !== actualEntries.length) return false;
  return expectedEntries.every(
    ([field, direction], position) =>
      actualEntries[position][0] === field && Number(actualEntries[position][1]) === Number(direction),
  );
}

/**
 * Compares the significant options of an existing index with what is required.
 *
 * Absent and false are treated as equivalent, because MongoDB omits
 * `unique: false` rather than storing it.
 */
export function optionsCompatible(required, actual) {
  return SIGNIFICANT_OPTIONS.every((option) => {
    const wanted = required[option];
    const found = actual?.[option];
    if (option === 'partialFilterExpression' || option === 'collation') {
      return JSON.stringify(wanted ?? null) === JSON.stringify(found ?? null);
    }
    if (option === 'expireAfterSeconds') {
      // 0 is a real TTL ("expire immediately"), so this is compared by value,
      // not truthiness: any TTL where none is required is incompatible.
      return (wanted ?? null) === (found ?? null);
    }
    return Boolean(wanted) === Boolean(found);
  });
}

/**
 * Compares required indexes against what the database actually reports.
 *
 * Matching is by KEY, not by name: an index created under another name still
 * satisfies the requirement, while an index with the right name but the wrong
 * keys does not.
 *
 * @returns {{satisfied: Array, missing: Array, incompatible: Array}}
 */
export function diffIndexes(required, actualByCollection) {
  const satisfied = [];
  const missing = [];
  const incompatible = [];

  for (const requirement of required) {
    const existing = actualByCollection[requirement.collection] ?? [];
    // MongoDB can hold several indexes on one key pattern (differing, say, in
    // collation), so a compatible one anywhere satisfies the requirement.
    const sameKey = existing.filter((index) => keysEqual(requirement.key, index.key));
    const compatible = sameKey.find((index) => optionsCompatible(requirement.options, index));

    if (compatible) {
      satisfied.push({ requirement, actual: compatible });
    } else if (sameKey.length > 0) {
      incompatible.push({ requirement, actual: sameKey[0] });
    } else {
      missing.push(requirement);
    }
  }

  return { satisfied, missing, incompatible };
}
