/**
 * SYNTHETIC B3 TEST DATA — never production content.
 *
 * Every title, slug and text below is unmistakably synthetic (Doc 17 sections
 * 25-26): "QA Synthetic" titles, "qa-" slugs and "QA TEST DATA" content. None
 * of it is approved role content, and none of it is ever provisioned outside
 * an isolated test database.
 */

/** A fixed server instant for time-dependent tests (Doc 17 section 39). */
export const QA_NOW = new Date('2026-10-01T12:00:00.000Z');

export const minutes = (count) => count * 60_000;
export const at = (offsetMs) => new Date(QA_NOW.getTime() + offsetMs);

/** Stable screening identifiers used by fixtures (canonical lowercase UUIDs). */
export const QA_QUESTION_ID = '11111111-1111-4111-8111-111111111111';
export const QA_SELECT_QUESTION_ID = '22222222-2222-4222-8222-222222222222';
export const QA_OPTION_A = '33333333-3333-4333-8333-333333333333';
export const QA_OPTION_B = '44444444-4444-4444-8444-444444444444';

/**
 * A stored Job as a lean read returns it — deliberately carrying EVERY
 * internal field, plus an unknown one, so DTO tests can prove none leaks.
 */
export function storedJob(overrides = {}) {
  return {
    _id: { toString: () => '65f0c0ffee0000000000abcd' },
    __v: 3,
    title: 'QA Synthetic Security Analyst',
    slug: 'qa-synthetic-security-analyst',
    internalOccupationalReference: 'NOC 99999 QA-INTERNAL',
    location: { displayName: 'QA Region, Canada', countryCode: 'CA', regionCode: 'QA', locality: 'QA City' },
    workArrangement: 'FULLY_REMOTE',
    employmentType: 'CONTRACT',
    schedule: 'QA TEST DATA schedule wording',
    weeklyHours: 30,
    compensation: { currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: true },
    description: 'QA TEST DATA description.',
    responsibilities: ['QA TEST DATA responsibility.'],
    requirements: ['QA TEST DATA requirement.'],
    preferredQualifications: [],
    applicationConfig: {
      resumeRequired: true,
      phone: { enabled: true, required: false },
      message: { enabled: true, required: true, maxLength: 2000 },
      screeningQuestions: [
        {
          _id: 'embedded-subdocument-id',
          questionId: QA_QUESTION_ID,
          type: 'YES_NO',
          prompt: 'QA TEST DATA: are you able to work the stated hours?',
          required: true,
          options: [],
        },
        {
          questionId: QA_SELECT_QUESTION_ID,
          type: 'SINGLE_SELECT',
          prompt: 'QA TEST DATA: preferred start window?',
          required: false,
          options: [
            { _id: 'embedded-option-id', optionId: QA_OPTION_A, label: 'QA option A' },
            { optionId: QA_OPTION_B, label: 'QA option B' },
          ],
        },
      ],
    },
    status: 'PUBLISHED',
    publishedAt: new Date('2026-09-20T09:30:00.000Z'),
    closesAt: null,
    closedAt: null,
    archivedAt: null,
    createdAt: new Date('2026-09-19T08:00:00.000Z'),
    updatedAt: new Date('2026-09-20T09:30:00.000Z'),
    internalNotes: 'QA-INTERNAL-NOTE must never be public',
    ...overrides,
  };
}

/** A complete, publishable synthetic definition (raw JSON shape). */
export function syntheticDefinition(overrides = {}) {
  return {
    slug: 'qa-synthetic-provisioned-role',
    status: 'DRAFT',
    awaitingInput: [],
    notes: ['QA TEST DATA — synthetic definition for automated tests only.'],
    title: 'QA Synthetic Provisioned Role',
    internalOccupationalReference: 'NOC 99999 QA-INTERNAL',
    location: { displayName: 'QA Region, Canada', countryCode: 'CA', regionCode: 'QA', locality: null },
    workArrangement: 'FULLY_REMOTE',
    employmentType: 'CONTRACT',
    schedule: 'QA TEST DATA schedule wording',
    weeklyHours: 30,
    compensation: { currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: true },
    description: 'QA TEST DATA description.',
    responsibilities: ['QA TEST DATA responsibility.'],
    requirements: ['QA TEST DATA requirement.'],
    preferredQualifications: [],
    applicationConfig: {
      resumeRequired: true,
      phone: { enabled: false, required: false },
      message: { enabled: false, required: false, maxLength: 5000 },
      screeningQuestions: [],
    },
    closesAt: null,
    ...overrides,
  };
}

/** Screening questions for definitions — no identifiers (the server generates them). */
export function syntheticQuestions() {
  return [
    { type: 'YES_NO', prompt: 'QA TEST DATA: can you work remotely?', required: true, options: [] },
    {
      type: 'SINGLE_SELECT',
      prompt: 'QA TEST DATA: preferred start window?',
      required: false,
      options: [{ label: 'QA option A' }, { label: 'QA option B' }],
    },
  ];
}
