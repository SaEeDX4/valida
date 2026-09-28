import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AWAITABLE_FIELDS,
  CONTENT_FIELDS,
  MATERIAL_FIELDS,
  canonicalJobContent,
  parseJobDefinition,
  planJobProvisioning,
  resolveScreeningQuestions,
} from '../src/modules/jobs/job.provisioning.js';
import {
  QA_NOW,
  QA_OPTION_A,
  QA_OPTION_B,
  QA_QUESTION_ID,
  QA_SELECT_QUESTION_ID,
  at,
  minutes,
  syntheticDefinition,
  syntheticQuestions,
} from './fixtures/jobFixtures.js';

/**
 * Job provisioning — OFFLINE part.
 *
 * Definition validation, planning, screening-identifier resolution, the real
 * initial role's definition, and the CLI's argument/input handling (which
 * refuses before contacting any database). Writing to MongoDB — create,
 * update, re-run, lifecycle, duplicate slugs, indexes — is proven against a
 * real database in tests/db/job-provisioning.test.js.
 */

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const REAL_ROLE_FILE = join(backendRoot, 'provisioning', 'jobs', 'cybersecurity-specialist.json');
const readRealRole = () => JSON.parse(readFileSync(REAL_ROLE_FILE, 'utf8'));

const parse = (raw) => {
  const result = parseJobDefinition(raw);
  if (!result.ok) throw new Error(`definition invalid: ${result.errors.join('; ')}`);
  return result.definition;
};

/** A stored Job as provisioning would read it (plain object). */
const storedFrom = (raw, extra = {}) => {
  const definition = parse(raw);
  return {
    slug: definition.slug,
    ...definition,
    closesAt: definition.closesAt,
    applicationConfig: {
      ...definition.applicationConfig,
      screeningQuestions: definition.applicationConfig.screeningQuestions.map((question) => ({
        ...question,
        questionId: question.questionId ?? QA_QUESTION_ID,
      })),
    },
    status: 'DRAFT',
    publishedAt: null,
    ...extra,
  };
};

describe('the real initial role definition (Doc 10 s70, Doc 12 ss44-45, Doc 18 s110)', () => {
  it('is a valid definition', () => {
    expect(parseJobDefinition(readRealRole()).ok).toBe(true);
  });

  it('carries exactly the source-established planning data', () => {
    const role = parse(readRealRole());
    expect(role).toMatchObject({
      slug: 'cybersecurity-specialist',
      title: 'Cybersecurity Specialist',
      internalOccupationalReference: 'NOC 21220',
      location: { displayName: 'British Columbia, Canada', countryCode: 'CA', regionCode: 'BC', locality: null },
      workArrangement: 'FULLY_REMOTE',
      weeklyHours: 30,
      compensation: { currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: true },
    });
  });

  it('stays DRAFT, invents nothing, and declares every approval-dependent field AWAITING INPUT', () => {
    const role = parse(readRealRole());
    expect(role.status).toBe('DRAFT');
    expect(role).toMatchObject({
      employmentType: null,
      schedule: null,
      description: '',
      responsibilities: [],
      requirements: [],
      preferredQualifications: [],
      closesAt: null,
    });
    expect(role.applicationConfig.screeningQuestions).toEqual([]);
    expect(role.awaitingInput).toEqual([
      'employmentType',
      'schedule',
      'description',
      'responsibilities',
      'requirements',
      'preferredQualifications',
      'screeningQuestions',
      'closesAt',
    ]);
  });

  it('plans a DRAFT that is not public and not publish-ready', () => {
    const plan = planJobProvisioning({ current: null, definition: parse(readRealRole()), now: QA_NOW });
    expect(plan).toMatchObject({ action: 'create', transition: null, refusals: [], publicAfter: 'NOT_PUBLIC' });
    expect(plan.readiness).toEqual({
      ready: false,
      missing: ['employmentType', 'description', 'responsibilities', 'requirements'],
    });
  });

  it('cannot be published by changing its status alone', () => {
    const plan = planJobProvisioning({
      current: null,
      definition: parse({ ...readRealRole(), status: 'PUBLISHED' }),
      now: QA_NOW,
    });
    expect(plan.refusals.map((refusal) => refusal.code)).toEqual(['AWAITING_INPUT', 'NOT_PUBLISH_READY']);
  });

  it('cannot be published by emptying awaitingInput while content is missing', () => {
    const plan = planJobProvisioning({
      current: null,
      definition: parse({ ...readRealRole(), status: 'PUBLISHED', awaitingInput: [] }),
      now: QA_NOW,
    });
    expect(plan.refusals.map((refusal) => refusal.code)).toEqual(['NOT_PUBLISH_READY']);
  });
});

describe('definition validation (before any database access)', () => {
  it('accepts a complete synthetic definition and normalises it', () => {
    const result = parseJobDefinition(syntheticDefinition({ title: '  QA Synthetic Provisioned Role  ' }));
    expect(result.ok).toBe(true);
    expect(result.definition.title).toBe('QA Synthetic Provisioned Role');
  });

  it('converts closesAt to a Date and requires an explicit offset', () => {
    expect(parse(syntheticDefinition({ closesAt: '2026-11-01T00:00:00-07:00' })).closesAt.toISOString()).toBe(
      '2026-11-01T07:00:00.000Z',
    );
    expect(parseJobDefinition(syntheticDefinition({ closesAt: '2026-11-01' })).ok).toBe(false);
    expect(parseJobDefinition(syntheticDefinition({ closesAt: '2026-11-01T00:00:00' })).ok).toBe(false);
  });

  const invalid = [
    ['an unknown top-level key', { status: 'DRAFT', publishedAt: '2026-01-01T00:00:00Z' }],
    ['a mass-assignment attempt on lifecycle timestamps', { closedAt: null }],
    ['an unknown status', { status: 'LIVE' }],
    ['an invalid slug', { slug: 'Not A Slug' }],
    ['a slug over 120 characters', { slug: 'a'.repeat(121) }],
    ['a short title', { title: 'QA' }],
    ['a currency without a verified exponent', { compensation: { currency: 'USD', amountMinor: 3500, unit: 'HOUR', gross: true } }],
    ['a fractional minor amount', { compensation: { currency: 'CAD', amountMinor: 35.5, unit: 'HOUR', gross: true } }],
    ['a negative minor amount', { compensation: { currency: 'CAD', amountMinor: -1, unit: 'HOUR', gross: true } }],
    ['a float money value in major units', { compensation: { currency: 'CAD', amount: 35, unit: 'HOUR', gross: true } }],
    ['zero weekly hours', { weeklyHours: 0 }],
    ['169 weekly hours', { weeklyHours: 169 }],
    ['a lowercase country code', { location: { displayName: 'QA', countryCode: 'ca', regionCode: null, locality: null } }],
    ['an unknown employment type', { employmentType: 'GIG' }],
    ['a whitespace-only list item', { responsibilities: ['   '] }],
    ['51 responsibilities', { responsibilities: Array.from({ length: 51 }, (_, i) => `QA item ${i}`) }],
    ['an over-long description', { description: 'x'.repeat(10_001) }],
    ['an empty-string optional field (use null)', { schedule: '' }],
    ['a missing field', { title: undefined }],
    ['an unknown awaitingInput entry', { awaitingInput: ['salaryBand'] }],
    ['a duplicate awaitingInput entry', { awaitingInput: ['description', 'description'] }],
  ];
  it.each(invalid)('refuses %s', (_label, overrides) => {
    const raw = syntheticDefinition(overrides);
    const result = parseJobDefinition(raw);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  const config = (changes) => ({
    applicationConfig: {
      resumeRequired: true,
      phone: { enabled: false, required: false },
      message: { enabled: false, required: false, maxLength: 5000 },
      screeningQuestions: [],
      ...changes,
    },
  });
  it.each([
    ['a Job without a required resume', config({ resumeRequired: false })],
    ['phone required while disabled', config({ phone: { enabled: false, required: true } })],
    ['message required while disabled', config({ message: { enabled: false, required: true, maxLength: 100 } })],
    ['a message longer than 5000', config({ message: { enabled: true, required: false, maxLength: 5001 } })],
    ['21 screening questions', config({ screeningQuestions: Array.from({ length: 21 }, (_, i) => ({ type: 'SHORT_TEXT', prompt: `QA ${i}`, required: false, options: [] })) })],
    ['SINGLE_SELECT with one option', config({ screeningQuestions: [{ type: 'SINGLE_SELECT', prompt: 'QA?', required: false, options: [{ label: 'only' }] }] })],
    ['options on a text question', config({ screeningQuestions: [{ type: 'SHORT_TEXT', prompt: 'QA?', required: false, options: [{ label: 'x' }, { label: 'y' }] }] })],
    ['duplicate option labels', config({ screeningQuestions: [{ type: 'SINGLE_SELECT', prompt: 'QA?', required: false, options: [{ label: 'x' }, { label: 'x' }] }] })],
    ['two questions with the same type and prompt', config({ screeningQuestions: [{ type: 'YES_NO', prompt: 'QA?', required: false, options: [] }, { type: 'YES_NO', prompt: 'QA?', required: true, options: [] }] })],
    ['a non-canonical questionId', config({ screeningQuestions: [{ questionId: 'Q1', type: 'YES_NO', prompt: 'QA?', required: false, options: [] }] })],
    ['an uppercase UUID', config({ screeningQuestions: [{ questionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'.toUpperCase(), type: 'YES_NO', prompt: 'QA?', required: false, options: [] }] })],
    ['a repeated questionId', config({ screeningQuestions: [{ questionId: QA_QUESTION_ID, type: 'YES_NO', prompt: 'QA 1?', required: false, options: [] }, { questionId: QA_QUESTION_ID, type: 'YES_NO', prompt: 'QA 2?', required: false, options: [] }] })],
    ['an unsupported question type', config({ screeningQuestions: [{ type: 'FILE_UPLOAD', prompt: 'QA?', required: false, options: [] }] })],
  ])('refuses %s', (_label, overrides) => {
    expect(parseJobDefinition(syntheticDefinition(overrides)).ok).toBe(false);
  });

  it('reports errors by path', () => {
    const result = parseJobDefinition(syntheticDefinition({ weeklyHours: 0, slug: 'BAD' }));
    expect(result.errors.some((error) => error.startsWith('weeklyHours:'))).toBe(true);
    expect(result.errors.some((error) => error.startsWith('slug:'))).toBe(true);
  });

  it('covers every content field, and treats only the Doc 12 section 41 fields as material', () => {
    expect(CONTENT_FIELDS).toHaveLength(14);
    expect(AWAITABLE_FIELDS).toContain('screeningQuestions');
    expect(MATERIAL_FIELDS).toEqual([
      'compensation', 'weeklyHours', 'workArrangement', 'location', 'employmentType', 'responsibilities', 'requirements',
    ]);
  });
});

describe('planning (pure — no database)', () => {
  const plan = (current, raw, extra = {}) =>
    planJobProvisioning({ current, definition: parse(raw), now: QA_NOW, ...extra });

  it('creates a DRAFT and reports it will not be public', () => {
    expect(plan(null, syntheticDefinition())).toMatchObject({
      action: 'create',
      transition: null,
      refusals: [],
      publicAfter: 'NOT_PUBLIC',
      readiness: { ready: true, missing: [] },
    });
  });

  it('may create and publish a complete Job in one run, as one DRAFT -> PUBLISHED transition', () => {
    const result = plan(null, syntheticDefinition({ status: 'PUBLISHED' }));
    expect(result).toMatchObject({
      action: 'create',
      transition: { from: 'DRAFT', to: 'PUBLISHED' },
      requiresConfirmation: { lifecycle: true, materialChange: false },
      refusals: [],
      publicAfter: 'OPEN',
    });
  });

  it.each(['CLOSED', 'ARCHIVED'])('refuses to create a Job directly as %s', (status) => {
    expect(plan(null, syntheticDefinition({ status })).refusals.map((r) => r.code)).toEqual(['INVALID_INITIAL_STATUS']);
  });

  it('reports "unchanged" when the stored Job already matches — re-running is a no-op', () => {
    const raw = syntheticDefinition();
    expect(plan(storedFrom(raw), raw)).toMatchObject({ action: 'unchanged', changes: [], transition: null, refusals: [] });
  });

  it('lists exactly the fields that differ', () => {
    const raw = syntheticDefinition();
    const result = plan(storedFrom(raw), syntheticDefinition({ title: 'QA Synthetic Renamed Role', weeklyHours: 20 }));
    expect(result.action).toBe('update');
    expect(result.changes).toEqual(['title', 'weeklyHours']);
    expect(result.materialChanges).toEqual(['weeklyHours']);
    expect(result.requiresConfirmation.materialChange).toBe(false);
  });

  it('requires a separate confirmation for a material change once Applications exist', () => {
    const raw = syntheticDefinition();
    const result = plan(
      storedFrom(raw, { status: 'PUBLISHED', publishedAt: at(-minutes(60)) }),
      syntheticDefinition({ status: 'PUBLISHED', compensation: { currency: 'CAD', amountMinor: 4000, unit: 'HOUR', gross: true } }),
      { applicationCount: 2 },
    );
    expect(result.materialChanges).toEqual(['compensation']);
    expect(result.requiresConfirmation.materialChange).toBe(true);
  });

  it.each([
    ['DRAFT', 'CLOSED'],
    ['PUBLISHED', 'DRAFT'],
    ['PUBLISHED', 'ARCHIVED'],
    ['CLOSED', 'DRAFT'],
  ])('refuses the undocumented transition %s -> %s', (from, to) => {
    const raw = syntheticDefinition();
    const result = plan(storedFrom(raw, { status: from, publishedAt: from === 'DRAFT' ? null : at(-minutes(60)) }), syntheticDefinition({ status: to }));
    expect(result.refusals.map((r) => r.code)).toContain('INVALID_TRANSITION');
  });

  it.each([
    ['DRAFT', 'PUBLISHED'],
    ['DRAFT', 'ARCHIVED'],
    ['PUBLISHED', 'CLOSED'],
    ['CLOSED', 'PUBLISHED'],
    ['CLOSED', 'ARCHIVED'],
  ])('plans the documented transition %s -> %s as one confirmed step', (from, to) => {
    const raw = syntheticDefinition();
    const result = plan(storedFrom(raw, { status: from, publishedAt: from === 'DRAFT' ? null : at(-minutes(60)) }), syntheticDefinition({ status: to }));
    expect(result.refusals).toEqual([]);
    expect(result.transition).toEqual({ from, to });
    expect(result.requiresConfirmation.lifecycle).toBe(true);
  });

  it('reopening keeps the first publication date, so the Job is OPEN again at once', () => {
    const raw = syntheticDefinition();
    const result = plan(storedFrom(raw, { status: 'CLOSED', publishedAt: at(-minutes(600)) }), syntheticDefinition({ status: 'PUBLISHED' }));
    expect(result.publicAfter).toBe('OPEN');
  });

  it('treats ARCHIVED as terminal: any change or transition is refused, an identical definition is a no-op', () => {
    const raw = syntheticDefinition({ status: 'ARCHIVED' });
    const archived = storedFrom(raw, { status: 'ARCHIVED' });
    expect(plan(archived, raw).action).toBe('unchanged');
    expect(plan(archived, syntheticDefinition({ status: 'ARCHIVED', title: 'QA Synthetic Changed' })).refusals.map((r) => r.code)).toEqual(['ARCHIVED_IS_TERMINAL']);
    expect(plan(archived, syntheticDefinition({ status: 'PUBLISHED' })).refusals.map((r) => r.code)).toContain('ARCHIVED_IS_TERMINAL');
  });

  it('refuses to publish while anything is AWAITING INPUT', () => {
    const result = plan(null, syntheticDefinition({ status: 'PUBLISHED', awaitingInput: ['closesAt'] }));
    expect(result.refusals.map((r) => r.code)).toEqual(['AWAITING_INPUT']);
  });

  it('refuses to publish content that still contains placeholder text', () => {
    for (const text of ['AWAITING INPUT', '[DEV FIXTURE] synthetic', 'Lorem ipsum dolor']) {
      const result = plan(null, syntheticDefinition({ status: 'PUBLISHED', requirements: [text] }));
      expect(result.refusals.map((r) => r.code)).toEqual(['PLACEHOLDER_CONTENT']);
    }
  });

  it('refuses to publish or reopen with a closing time that is not in the future', () => {
    for (const closesAt of [QA_NOW.toISOString(), at(-1).toISOString()]) {
      expect(plan(null, syntheticDefinition({ status: 'PUBLISHED', closesAt })).refusals.map((r) => r.code)).toEqual([
        'CLOSES_AT_NOT_FUTURE',
      ]);
    }
    expect(plan(null, syntheticDefinition({ status: 'PUBLISHED', closesAt: at(1).toISOString() })).refusals).toEqual([]);
  });

  it('keeps a PUBLISHED Job publish-ready: an edit that removes required content is refused', () => {
    const raw = syntheticDefinition({ status: 'PUBLISHED' });
    const result = plan(storedFrom(raw, { status: 'PUBLISHED', publishedAt: at(-minutes(60)) }), syntheticDefinition({ status: 'PUBLISHED', requirements: [] }));
    expect(result.refusals.map((r) => r.code)).toEqual(['NOT_PUBLISH_READY']);
  });

  it('reports an expired PUBLISHED Job as publicly CLOSED', () => {
    const raw = syntheticDefinition({ status: 'PUBLISHED', closesAt: at(-1).toISOString() });
    const result = plan(storedFrom(raw, { status: 'PUBLISHED', publishedAt: at(-minutes(60)) }), raw);
    expect(result).toMatchObject({ action: 'unchanged', publicAfter: 'CLOSED', refusals: [] });
  });
});

describe('screening identifier preservation (Doc 10 sections 48, 53)', () => {
  const stored = [
    {
      questionId: QA_QUESTION_ID,
      type: 'YES_NO',
      prompt: 'QA TEST DATA: can you work remotely?',
      required: true,
      options: [],
    },
    {
      questionId: QA_SELECT_QUESTION_ID,
      type: 'SINGLE_SELECT',
      prompt: 'QA TEST DATA: preferred start window?',
      required: false,
      options: [
        { optionId: QA_OPTION_A, label: 'QA option A' },
        { optionId: QA_OPTION_B, label: 'QA option B' },
      ],
    },
  ];
  const desired = () => parse(syntheticDefinition({ applicationConfig: { ...syntheticDefinition().applicationConfig, screeningQuestions: syntheticQuestions() } })).applicationConfig.screeningQuestions;

  it('new questions and options get no identifier here (the server generates them)', () => {
    const result = resolveScreeningQuestions([], desired());
    expect(result.ok).toBe(true);
    expect(result.questions.map((q) => q.questionId)).toEqual([undefined, undefined]);
    expect(result.questions[1].options.map((o) => o.optionId)).toEqual([undefined, undefined]);
  });

  it('a definition without identifiers keeps the stored ones by type + prompt and by label', () => {
    const result = resolveScreeningQuestions(stored, desired());
    expect(result.questions.map((q) => q.questionId)).toEqual([QA_QUESTION_ID, QA_SELECT_QUESTION_ID]);
    expect(result.questions[1].options.map((o) => o.optionId)).toEqual([QA_OPTION_A, QA_OPTION_B]);
  });

  it('reordering keeps identifiers; a new option alongside keeps the existing ones', () => {
    const [yesNo, select] = desired();
    select.options = [{ label: 'QA option B' }, { label: 'QA option C' }, { label: 'QA option A' }];
    const result = resolveScreeningQuestions(stored, [select, yesNo]);
    expect(result.questions.map((q) => q.questionId)).toEqual([QA_SELECT_QUESTION_ID, QA_QUESTION_ID]);
    expect(result.questions[0].options.map((o) => o.optionId)).toEqual([QA_OPTION_B, undefined, QA_OPTION_A]);
  });

  it('an explicit identifier keeps a question whose prompt is reworded', () => {
    const [yesNo] = desired();
    const result = resolveScreeningQuestions(stored, [{ ...yesNo, questionId: QA_QUESTION_ID, prompt: 'QA TEST DATA: reworded?' }]);
    expect(result.questions[0].questionId).toBe(QA_QUESTION_ID);
  });

  it('a reworded prompt WITHOUT an identifier is a new question', () => {
    const [yesNo, select] = desired();
    const result = resolveScreeningQuestions(stored, [{ ...yesNo, prompt: 'QA TEST DATA: reworded?' }, select]);
    expect(result.questions.map((q) => q.questionId)).toEqual([undefined, QA_SELECT_QUESTION_ID]);
  });

  it('an explicit identifier is claimed before any content match', () => {
    const [yesNo] = desired();
    const result = resolveScreeningQuestions(stored, [
      { ...yesNo }, // same content as the stored question, no id
      { ...yesNo, prompt: 'QA TEST DATA: other?', questionId: QA_QUESTION_ID },
    ]);
    expect(result.questions.map((q) => q.questionId)).toEqual([undefined, QA_QUESTION_ID]);
  });

  it('refuses identifiers the Job does not have — a definition can never invent one', () => {
    const [yesNo, select] = desired();
    const unknownQuestion = resolveScreeningQuestions(stored, [{ ...yesNo, questionId: '55555555-5555-4555-8555-555555555555' }]);
    expect(unknownQuestion.ok).toBe(false);
    expect(unknownQuestion.errors.map((e) => e.code)).toEqual(['UNKNOWN_QUESTION_ID']);

    const unknownOption = resolveScreeningQuestions(stored, [
      { ...select, options: [{ label: 'x', optionId: '66666666-6666-4666-8666-666666666666' }, { label: 'y' }] },
    ]);
    expect(unknownOption.errors.map((e) => e.code)).toEqual(['UNKNOWN_OPTION_ID']);

    const optionOnNewQuestion = resolveScreeningQuestions([], [{ ...select, options: [{ label: 'x', optionId: QA_OPTION_A }, { label: 'y' }] }]);
    expect(optionOnNewQuestion.errors.map((e) => e.code)).toEqual(['UNKNOWN_OPTION_ID']);
  });

  it('an unchanged definition resolves to identical canonical content', () => {
    const raw = syntheticDefinition({ applicationConfig: { ...syntheticDefinition().applicationConfig, screeningQuestions: syntheticQuestions() } });
    const current = { ...parse(raw), status: 'DRAFT', publishedAt: null };
    current.applicationConfig = { ...current.applicationConfig, screeningQuestions: stored };
    const result = planJobProvisioning({ current, definition: parse(raw), now: QA_NOW });
    expect(result.action).toBe('unchanged');
    expect(canonicalJobContent(current).applicationConfig.screeningQuestions.map((q) => q.questionId)).toEqual([
      QA_QUESTION_ID,
      QA_SELECT_QUESTION_ID,
    ]);
  });
});

describe('the provisioning CLI refuses before contacting any database', () => {
  /**
   * The launching environment minus every MONGODB_* variable (compared without
   * case, as Windows does), so nothing here can reach a database unless a test
   * provides a target explicitly. backend/.env is not loaded: the script is
   * run without --env-file.
   */
  const withoutDatabaseVariables = () =>
    Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^MONGODB_/i.test(key)));
  const run = (args, env = {}) => {
    const result = spawnSync(process.execPath, ['scripts/provision-job.mjs', ...args], {
      cwd: backendRoot,
      env: { ...withoutDatabaseVariables(), ...env },
      encoding: 'utf8',
      timeout: 60_000,
    });
    return { code: result.status, output: `${result.stdout}${result.stderr}` };
  };
  const withTempDefinition = (raw, fn) => {
    const dir = mkdtempSync(join(tmpdir(), 'valida-b3-'));
    try {
      const file = join(dir, 'definition.json');
      writeFileSync(file, typeof raw === 'string' ? raw : JSON.stringify(raw));
      return fn(file, dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it.each([
    [[]],
    [['publish', '--file', 'x.json']],
    [['plan']],
    [['plan', '--file']],
    [['plan', '--file', 'a.json', '--file', 'b.json']],
    [['plan', '--file', 'a.json', '--confirm-lifecycle']],
    [['apply', '--file', 'a.json', '--force']],
  ])('usage error %j exits 2', (args) => {
    const { code, output } = run(args);
    expect(code).toBe(2);
    expect(output).toMatch(/Usage:/);
  }, 60_000);

  it('a missing file, a directory or invalid JSON exits 1', () => {
    expect(run(['plan', '--file', 'does/not/exist.json']).output).toMatch(/not found or not readable/);
    withTempDefinition('{}', (_file, dir) => {
      const { code, output } = run(['plan', '--file', dir]);
      expect(code).toBe(1);
      expect(output).toMatch(/not a regular file/);
    });
    withTempDefinition('{ not json', (file) => {
      const { code, output } = run(['plan', '--file', file]);
      expect(code).toBe(1);
      expect(output).toMatch(/not valid JSON/);
    });
  }, 60_000);

  it('an invalid definition is refused before configuration is even read', () => {
    withTempDefinition(syntheticDefinition({ compensation: { currency: 'USD', amountMinor: 1, unit: 'HOUR', gross: true } }), (file) => {
      const { code, output } = run(['apply', '--file', file]); // no MONGODB_URI at all
      expect(code).toBe(1);
      expect(output).toMatch(/INVALID DEFINITION — nothing was read from or written to the database/);
      expect(output).toMatch(/compensation\.currency/);
      expect(output).not.toMatch(/MONGODB_URI/);
    });
  }, 60_000);

  it('a valid definition without MONGODB_URI fails with the value-free configuration message', () => {
    const { code, output } = run(['plan', '--file', REAL_ROLE_FILE]);
    expect(code).toBe(1);
    expect(output).toMatch(/MONGODB_URI: is required/);
  }, 60_000);

  it('an unreachable database fails with a bounded message that never prints the connection string', () => {
    const uri = 'mongodb://qa-operator:qa-s3cr3t@127.0.0.1:1/valida_provision_probe';
    const { code, output } = run(['apply', '--file', REAL_ROLE_FILE], {
      APP_ENV: 'local',
      NODE_ENV: 'test',
      MONGODB_URI: uri,
      MONGODB_CONNECT_TIMEOUT_MS: '1000',
    });
    expect(code).toBe(1);
    expect(output).toMatch(/could not be reached\. Nothing was written/);
    expect(output).not.toContain('qa-s3cr3t');
    expect(output).not.toMatch(/mongodb:\/\//);
  }, 60_000);
});
