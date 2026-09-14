/**
 * ============================================================================
 * CONTROLLED DEVELOPMENT FIXTURES — NOT PRODUCTION DATA
 * ============================================================================
 *
 * Synthetic data used only to review A5 UI states before Release B exists.
 * This module is never imported by production code: it is reachable only from
 * src/dev/installDevFixtures.js, which itself runs only when BOTH
 * import.meta.env.DEV and VITE_ENABLE_A5_FIXTURES are true.
 *
 * FIELD PROVENANCE (Doc 06 sections 107-108)
 * Only these values are source-established for the planned role:
 *   title, workArrangement, location, weeklyHours, compensation.
 * The Master Prompt establishes NO approved responsibilities, requirements,
 * preferred qualifications, employment type, schedule wording or screening
 * questions. Everything below in those fields is therefore clearly-marked
 * synthetic placeholder text and must never be published as real Job content.
 * A real Job record approved by Saeed supplies them before publication.
 */

/** Prefix that makes fixture-only content unmistakable on screen. */
const SYNTHETIC = '[DEV FIXTURE]';

const openJob = {
  title: 'Cybersecurity Specialist',
  slug: 'cybersecurity-specialist',
  location: 'British Columbia, Canada',
  workArrangement: 'FULLY_REMOTE',
  /*
   * employmentType is DELIBERATELY ABSENT.
   *
   * Browser QA showed this fixture rendering "Employment Type / Part time" as
   * though it were an approved public fact. The exact public employment type
   * is NOT source-established — only the title, Canada context, 30 hours/week
   * and CAD 35.00/hour are — and 30 hours a week does not make a role part
   * time. Omitting the field is the honest option: the UI renders the row only
   * when a Job explicitly supplies a value. A clearly synthetic employment type
   * is exercised on the [DEV FIXTURE] roles below instead.
   */
  schedule: `${SYNTHETIC} synthetic schedule wording`,
  weeklyHours: 30,
  compensation: { currency: 'CAD', amount: 35, unit: 'HOUR', gross: true },
  /*
   * Declared hiring markets. Each market lists the countries it ACTUALLY
   * supports and carries its own compensation — no value is converted from
   * another market, and no country is eligible unless it appears here.
   *
   * Only the Canada figure is source-established. The US and Eurozone amounts
   * are synthetic, present solely to exercise the per-market interface, and are
   * marked as such in the fixture labels.
   */
  hiringMarkets: [
    {
      marketId: 'CANADA',
      countries: ['CA'],
      // Explicit label: this market is province-specific.
      locationLabel: 'British Columbia, Canada',
      // NO claimPrefix: the Canada context and CAD 35.00/hour are
      // source-established, and marking them synthetic would be equally untrue.
      compensation: { currency: 'CAD', amount: 35, unit: 'HOUR', gross: true },
    },
    {
      marketId: 'UNITED_STATES',
      countries: ['US'],
      /*
       * claimPrefix marks BOTH this market's location and its compensation as
       * synthetic wherever they are rendered — Careers row, Employment Details
       * and Apply context. Without it a QA screenshot of this role could be
       * mistaken for a real Valida US offer, since the title itself is not
       * prefixed.
       */
      claimPrefix: SYNTHETIC,
      compensation: { currency: 'USD', amount: 30, unit: 'HOUR', gross: true },
    },
    {
      marketId: 'EUROPE',
      // Explicit allowlist. Being European does not make a country eligible.
      countries: ['DE', 'FR', 'NL', 'IE', 'LT'],
      claimPrefix: SYNTHETIC,
      // Synthetic EUR amount; deliberately NOT a conversion of the CAD figure.
      compensation: { currency: 'EUR', amount: 28, unit: 'HOUR', gross: true },
    },
    {
      marketId: 'INTERNATIONAL',
      international: true,
      // The eligibility itself is synthetic, so the location is marked. The
      // compensation stays the neutral canonical "Location-dependent", which
      // is not a claim and is therefore never marked.
      claimPrefix: SYNTHETIC,
      compensation: null,
    },
  ],
  description: `${SYNTHETIC} Synthetic role description used to review the Job Detail layout. This is not approved Valida Job content.`,
  responsibilities: [
    `${SYNTHETIC} Synthetic responsibility one.`,
    `${SYNTHETIC} Synthetic responsibility two, written long enough to exercise wrapping behaviour on narrow viewports and confirm that a lengthy bullet does not create horizontal overflow.`,
  ],
  requirements: [`${SYNTHETIC} Synthetic requirement one.`, `${SYNTHETIC} Synthetic requirement two.`],
  preferredQualifications: [`${SYNTHETIC} Synthetic preferred qualification.`],
  publishedAt: '2026-09-10T18:00:00.000Z',
  closesAt: null,
  applicationStatus: 'OPEN',
  applicationForm: {
    phone: { enabled: true, required: false },
    message: { enabled: true, required: false, maxLength: 5000 },
    resume: { required: true, maxBytes: 5242880, allowedExtensions: ['.pdf', '.docx'] },
    screeningQuestions: [
      { id: 'q-short', type: 'SHORT_TEXT', prompt: `${SYNTHETIC} Short text question?`, required: true, options: [] },
      { id: 'q-long', type: 'LONG_TEXT', prompt: `${SYNTHETIC} Long text question?`, required: false, options: [] },
      { id: 'q-yesno', type: 'YES_NO', prompt: `${SYNTHETIC} Yes or no question?`, required: true, options: [] },
      {
        id: 'q-select',
        type: 'SINGLE_SELECT',
        prompt: `${SYNTHETIC} Single select question?`,
        required: true,
        // Canonical option shape: stable identifier plus display label (Doc 10).
        options: [
          { optionId: 'opt-a', label: `${SYNTHETIC} Option A` },
          { optionId: 'opt-b', label: `${SYNTHETIC} Option B` },
          { optionId: 'opt-c', label: `${SYNTHETIC} Option C` },
        ],
      },
    ],
  },
};

/** A second role, used to review list rendering with more than one item. */
const secondJob = {
  title: `${SYNTHETIC} Platform Engineer`,
  slug: 'dev-fixture-platform-engineer',
  location: 'British Columbia, Canada',
  workArrangement: 'FULLY_REMOTE',
  employmentType: 'FULL_TIME',
  weeklyHours: 40,
  compensation: { currency: 'CAD', amount: 48, unit: 'HOUR', gross: true },
  publishedAt: '2026-09-11T09:00:00.000Z',
  closesAt: null,
  applicationStatus: 'OPEN',
  /*
   * Canada and Switzerland only, and NO international option — the fixture that
   * exercises the unsupported-visitor case. A visitor in Brazil must be shown
   * the real supported markets, never told the role is in Brazil.
   *
   * Switzerland also proves the currency model is per market: a European
   * country that does not use EUR.
   */
  hiringMarkets: [
    { marketId: 'CANADA', countries: ['CA'], claimPrefix: SYNTHETIC, compensation: { currency: 'CAD', amount: 48, unit: 'HOUR', gross: true } },
    { marketId: 'EUROPE', countries: ['CH'], locationLabel: 'Switzerland', claimPrefix: SYNTHETIC, compensation: { currency: 'CHF', amount: 55, unit: 'HOUR', gross: true } },
  ],
  /*
   * An OPEN Job must carry a usable applicationForm (Doc 09 sections 64-65);
   * the service contract check now enforces that. This minimal configuration
   * keeps the fixture valid without adding synthetic screening content.
   */
  applicationForm: {
    phone: { enabled: false, required: false },
    message: { enabled: false, required: false, maxLength: 5000 },
    resume: { required: true, maxBytes: 5242880, allowedExtensions: ['.pdf', '.docx'] },
    screeningQuestions: [],
  },
};

/** A role with an unusually long title, to review truncation and wrapping. */
const longTitleJob = {
  ...secondJob,
  title: `${SYNTHETIC} Senior Principal Cybersecurity and Secure Platform Infrastructure Engineering Specialist`,
  slug: 'dev-fixture-long-title-role',
};

const closedJob = {
  ...openJob,
  title: `${SYNTHETIC} Closed Role`,
  slug: 'dev-fixture-closed-role',
  closesAt: '2026-09-01T00:00:00.000Z',
  applicationStatus: 'CLOSED',
  // Doc 09 section 65: a closed Job carries no form configuration.
  applicationForm: null,
};

export const DEV_JOBS = { openJob, secondJob, longTitleJob, closedJob };

export const DEV_JOB_SCENARIOS = {
  'jobs-one': { items: [openJob] },
  'jobs-many': { items: [openJob, secondJob, longTitleJob] },
  'jobs-empty': { items: [] },
  'jobs-loading': { pending: true },
  'jobs-error': { error: { status: 503, code: 'SERVICE_UNAVAILABLE' } },
  'job-open': { job: openJob },
  'job-closed': { job: closedJob },
  'job-notfound': { error: { status: 404, code: 'JOB_NOT_FOUND' } },
  'job-error': { error: { status: 503, code: 'SERVICE_UNAVAILABLE' } },
  'job-loading': { pending: true },
};
