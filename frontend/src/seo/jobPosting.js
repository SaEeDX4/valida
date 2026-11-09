import {
  formatCompensation,
  formatEnumLabel,
  formatJobDate,
  formatJobDeadline,
  formatWeeklyHours,
  isJobOpen,
  toContentList,
} from '../features/jobs/utils/formatJob.js';
import { eligibleWorkCountryNames } from '../features/jobs/utils/eligibleWorkCountries.js';
import { JOB_DETAIL } from '../pages/JobDetailPage.content.js';
import { jobRoute } from '../routes/paths.js';
import { SITE_NAME, absoluteUrl } from './siteConfig.js';

/**
 * JobPosting structured data for ONE open Job Detail page (C4).
 *
 * Doc 16 sections 124-141 and SEO-025…035; Google's JobPosting documentation
 * (developers.google.com/search/docs/data-types/job-posting, checked during
 * C4): "all information in the markup must be visible on the job page", one
 * job per page, on the most detailed page, removed when the job closes.
 *
 * Every property is derived from the same public Job DTO, and with the same
 * formatting helpers, that the Job Detail page renders — nothing is looked up
 * elsewhere, inferred, defaulted or invented. A property that cannot be
 * stated truthfully is LEFT OUT; when the posting as a whole cannot be,
 * nothing is emitted and the reason is returned (`withheld`).
 *
 * LOCATION. Google needs, for a fully remote job, the countries from which
 * the employee may work (applicantLocationRequirements, at least one country,
 * with jobLocationType TELECOMMUTE) and, otherwise, a structured workplace
 * address (jobLocation).
 *   - Fully remote: the Job's explicit eligible remote-work countries
 *     (OD-2026-11-09-02; eligibleWorkCountries.js) — the SAME names, in the
 *     same order, as the visible "Eligible Remote-Work Countries" row. Without
 *     an explicit list the whole JobPosting is withheld
 *     (NO_APPLICANT_ELIGIBILITY). `location` (the physical job location), the
 *     visitor's regional view, a hiring market, a publication country and the
 *     occupational reference are never used to infer one.
 *   - Hybrid / on-site: the public DTO carries the workplace as display text
 *     only, not an address, so the JobPosting stays withheld
 *     (NO_STRUCTURED_WORKPLACE).
 */

/**
 * Why no JobPosting is emitted:
 *   NOT_OPEN                  a retained CLOSED Job (Doc 16 sections 123, 140).
 *   NO_SITE                   no canonical origin configured (absolute URLs needed).
 *   REGIONAL_PRESENTATION     the Job declares hiring markets: its visible location
 *                             and pay then depend on the visitor's region, so no
 *                             single markup can match what every visitor sees.
 *                             The public API sends none; only QA data does.
 *   NO_TITLE, NO_PUBLISHED_AT, NO_DESCRIPTION
 *                             a required property would be missing.
 *   NO_APPLICANT_ELIGIBILITY  fully remote, and the Job states no eligible
 *                             remote-work countries (absent or empty list).
 *   NO_STRUCTURED_WORKPLACE   hybrid / on-site, and the public DTO has no
 *                             structured workplace address (see above).
 */
export const JOB_POSTING_WITHHELD = Object.freeze({
  NOT_OPEN: 'NOT_OPEN',
  NO_SITE: 'NO_SITE',
  REGIONAL_PRESENTATION: 'REGIONAL_PRESENTATION',
  NO_TITLE: 'NO_TITLE',
  NO_PUBLISHED_AT: 'NO_PUBLISHED_AT',
  NO_DESCRIPTION: 'NO_DESCRIPTION',
  NO_APPLICANT_ELIGIBILITY: 'NO_APPLICANT_ELIGIBILITY',
  NO_STRUCTURED_WORKPLACE: 'NO_STRUCTURED_WORKPLACE',
});

/** The exact input each location reason waits for (C4 handoff). */
export const JOB_POSTING_MISSING_INPUT = Object.freeze({
  NO_APPLICANT_ELIGIBILITY:
    'The Job\'s explicit eligible remote-work countries (eligibleWorkCountries, OD-2026-11-09-02): at least one ISO 3166-1 ' +
    'alpha-2 code, approved for that vacancy and provisioned on the Job. Nothing else establishes them.',
  NO_STRUCTURED_WORKPLACE:
    'A structured workplace address in the public Job DTO (at least addressCountry; Doc 09 amendment) for jobLocation.',
});

/** The approved master logo (public/brand/README.md); 1254 x 1254, inside Google's 0.75-2.5 ratio. */
export const ORGANIZATION_LOGO_PATH = '/brand/valida-logo-approved-dark-1254.png';

/**
 * Valida employment types -> Google's case-sensitive values.
 *
 * FIXED_TERM and CONTRACT are deliberately absent. Google offers CONTRACTOR
 * (an independent contractor) and TEMPORARY, and Valida's "Contract" and
 * "Fixed term" are employment terms that may be neither. A wrong value would
 * misstate the vacancy, and employmentType is optional, so for those two it is
 * omitted (SEO-032).
 */
export const EMPLOYMENT_TYPE_MAP = Object.freeze({
  FULL_TIME: 'FULL_TIME',
  PART_TIME: 'PART_TIME',
  TEMPORARY: 'TEMPORARY',
  INTERNSHIP: 'INTERN',
  OTHER: 'OTHER',
});

/** Google's baseSalary units for the units the Job model allows (Doc 10 section 36). */
const SALARY_UNITS = new Set(['HOUR', 'MONTH', 'YEAR']);

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/** HTML text escaping for the description markup (the only HTML Google reads: p, ul, li). */
export function escapeHtmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The description as Google reads it, built from the sections the page shows,
 * in the page's order and with the page's own headings (Doc 06 section 99).
 * A section without data is absent here exactly as it is absent on the page.
 */
export function jobPostingDescription(job) {
  const parts = [];
  const about = typeof job?.description === 'string' ? job.description.trim() : '';
  if (about) {
    parts.push(`<p>${escapeHtmlText(JOB_DETAIL.labels.about)}</p>`, `<p>${escapeHtmlText(about)}</p>`);
  }
  for (const [label, items] of [
    [JOB_DETAIL.labels.responsibilities, toContentList(job?.responsibilities)],
    [JOB_DETAIL.labels.requirements, toContentList(job?.requirements)],
    [JOB_DETAIL.labels.preferredQualifications, toContentList(job?.preferredQualifications)],
  ]) {
    if (items.length === 0) continue;
    parts.push(
      `<p>${escapeHtmlText(label)}</p>`,
      `<ul>${items.map((item) => `<li>${escapeHtmlText(item)}</li>`).join('')}</ul>`,
    );
  }
  return parts.join('');
}

/**
 * Google: for a TELECOMMUTE job "the job description must clearly state that
 * the job is 100% remote". The page states it in Employment Details, so the
 * description repeats exactly those two visible rows, with the page's labels.
 */
function remoteDescription(job, names) {
  const items = [
    // The Doc 06 section 97 label, as buildRegionalJobFacts renders it.
    `Work Arrangement: ${formatEnumLabel(job.workArrangement)}`,
    `${JOB_DETAIL.labels.eligibleWorkCountries}: ${names.join(', ')}`,
  ];
  return `<p>${escapeHtmlText(JOB_DETAIL.labels.employmentDetails)}</p><ul>${items
    .map((item) => `<li>${escapeHtmlText(item)}</li>`)
    .join('')}</ul>`;
}

/** baseSalary only when the page shows the Job's own compensation (same helper, same rule). */
function baseSalary(compensation) {
  if (!formatCompensation(compensation)) return null;
  if (!SALARY_UNITS.has(compensation.unit)) return null;
  return {
    '@type': 'MonetaryAmount',
    currency: compensation.currency,
    value: { '@type': 'QuantitativeValue', value: compensation.amount, unitText: compensation.unit },
  };
}

/**
 * Every JobPosting property except the location ones, from the public DTO.
 * Returns { properties, withheld }: exactly one is non-null.
 *
 * Dates use the predicates that decide the visible "Date Posted" and
 * "Applications Close" rows (formatJob.js): datePosted exists exactly when the
 * page shows Date Posted, validThrough exactly when it shows Applications Close
 * — no closing date, no validThrough (Doc 16 sections 128-130). Both carry the
 * instant as the API sent it (UTC); the page shows the same instant in UTC.
 */
export function jobPostingProperties(job, { siteOrigin } = {}) {
  const withheld = (reason) => ({ properties: null, withheld: reason });
  if (!isNonEmptyString(job?.title)) return withheld(JOB_POSTING_WITHHELD.NO_TITLE);
  if (!formatJobDate(job.publishedAt)) return withheld(JOB_POSTING_WITHHELD.NO_PUBLISHED_AT);
  const description = jobPostingDescription(job);
  if (!description) return withheld(JOB_POSTING_WITHHELD.NO_DESCRIPTION);

  const properties = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description,
    datePosted: job.publishedAt,
  };
  if (formatJobDeadline(job.closesAt)) properties.validThrough = job.closesAt;
  const employmentType = EMPLOYMENT_TYPE_MAP[job.employmentType];
  if (employmentType) properties.employmentType = employmentType;
  properties.hiringOrganization = {
    '@type': 'Organization',
    // The name the page shows under the title. No sameAs: no official profile
    // is recorded as Valida-controlled (Doc 16 sections 145-146, SEO-037).
    name: SITE_NAME,
    url: absoluteUrl(siteOrigin, '/'),
    logo: absoluteUrl(siteOrigin, ORGANIZATION_LOGO_PATH),
  };
  const salary = baseSalary(job.compensation);
  if (salary) properties.baseSalary = salary;
  const hours = formatWeeklyHours(job.weeklyHours);
  if (hours) properties.workHours = hours;
  /*
   * directApply (Doc 16 section 136, SEO-033). Google defines direct apply by
   * the steps the candidate must take; Valida's flow is one "Apply for This
   * Role" action from this page to a single form on the same site, with no
   * account, no login and no redirect to another site (C3 E2E, accepted at
   * f07ea35).
   */
  properties.directApply = true;
  properties.url = absoluteUrl(siteOrigin, jobRoute(job.slug));
  return { properties, withheld: null };
}

/**
 * The JobPosting for a public Job DTO, or why there is none.
 * Returns { jsonLd, withheld }: exactly one of them is non-null.
 *
 * Emitted only for an open, fully remote Job with an explicit list of eligible
 * remote-work countries (see the module comment); every other open Job ends at
 * a location reason, and nothing is built from an inferred location.
 */
export function buildJobPosting(job, { siteOrigin } = {}) {
  const withheld = (reason) => ({ jsonLd: null, withheld: reason });
  if (!isJobOpen(job)) return withheld(JOB_POSTING_WITHHELD.NOT_OPEN);
  if (!siteOrigin) return withheld(JOB_POSTING_WITHHELD.NO_SITE);
  if (Array.isArray(job.hiringMarkets) && job.hiringMarkets.length > 0) {
    return withheld(JOB_POSTING_WITHHELD.REGIONAL_PRESENTATION);
  }
  const mapped = jobPostingProperties(job, { siteOrigin });
  if (mapped.withheld) return withheld(mapped.withheld);
  if (job.workArrangement !== 'FULLY_REMOTE') return withheld(JOB_POSTING_WITHHELD.NO_STRUCTURED_WORKPLACE);

  const names = eligibleWorkCountryNames(job);
  if (names.length === 0) return withheld(JOB_POSTING_WITHHELD.NO_APPLICANT_ELIGIBILITY);
  const { url, ...rest } = mapped.properties;
  return {
    jsonLd: {
      ...rest,
      description: `${rest.description}${remoteDescription(job, names)}`,
      jobLocationType: 'TELECOMMUTE',
      applicantLocationRequirements: names.map((name) => ({ '@type': 'Country', name })),
      url,
    },
    withheld: null,
  };
}
