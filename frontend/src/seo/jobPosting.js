import { formatCompensation, formatWeeklyHours, isJobOpen, toContentList } from '../features/jobs/utils/formatJob.js';
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
 * Every property below is derived from the same public Job DTO, and with the
 * same formatting helpers, that the Job Detail page renders — nothing is
 * looked up elsewhere, inferred, defaulted or invented. When a property cannot
 * be stated truthfully it is LEFT OUT; when the posting as a whole cannot be,
 * nothing is emitted and the reason is returned (`withheld`).
 *
 * Withheld (no JobPosting at all):
 *   NOT_OPEN               a retained CLOSED Job (Doc 16 sections 123, 140).
 *   NO_SITE                no canonical origin configured (absolute URLs needed).
 *   REGIONAL_PRESENTATION  the Job declares hiring markets: its visible location
 *                          and pay then depend on the visitor's region, so no
 *                          single markup can match what every visitor sees.
 *                          The public API sends none; only QA data does.
 *   NOT_FULLY_REMOTE       hybrid / on-site: Google needs a structured postal
 *                          address (jobLocation), and the public DTO carries the
 *                          location as display text only (Doc 09). Emitting a
 *                          guessed address is not allowed.
 *   NO_PUBLISHED_AT, NO_TITLE, NO_LOCATION, NO_DESCRIPTION
 *                          a required property would be missing.
 *
 * Left out when not stateable:
 *   validThrough    only from a real closesAt (Doc 16 sections 129-130).
 *   employmentType  only where Google has an unambiguous value (see below).
 *   baseSalary      only when the visible compensation is the Job's own.
 */

export const JOB_POSTING_WITHHELD = Object.freeze({
  NOT_OPEN: 'NOT_OPEN',
  NO_SITE: 'NO_SITE',
  REGIONAL_PRESENTATION: 'REGIONAL_PRESENTATION',
  NOT_FULLY_REMOTE: 'NOT_FULLY_REMOTE',
  NO_PUBLISHED_AT: 'NO_PUBLISHED_AT',
  NO_TITLE: 'NO_TITLE',
  NO_LOCATION: 'NO_LOCATION',
  NO_DESCRIPTION: 'NO_DESCRIPTION',
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

function isoDate(value) {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : value;
}

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
 * Builds the JobPosting for a public Job DTO.
 * Returns { jsonLd, withheld }: exactly one of them is non-null.
 */
export function buildJobPosting(job, { siteOrigin } = {}) {
  const withheld = (reason) => ({ jsonLd: null, withheld: reason });

  if (!isJobOpen(job)) return withheld(JOB_POSTING_WITHHELD.NOT_OPEN);
  if (!siteOrigin) return withheld(JOB_POSTING_WITHHELD.NO_SITE);
  if (Array.isArray(job.hiringMarkets) && job.hiringMarkets.length > 0) {
    return withheld(JOB_POSTING_WITHHELD.REGIONAL_PRESENTATION);
  }
  if (job.workArrangement !== 'FULLY_REMOTE') return withheld(JOB_POSTING_WITHHELD.NOT_FULLY_REMOTE);
  if (!isNonEmptyString(job.title)) return withheld(JOB_POSTING_WITHHELD.NO_TITLE);
  const datePosted = isoDate(job.publishedAt);
  if (!datePosted) return withheld(JOB_POSTING_WITHHELD.NO_PUBLISHED_AT);
  if (!isNonEmptyString(job.location)) return withheld(JOB_POSTING_WITHHELD.NO_LOCATION);
  const description = jobPostingDescription(job);
  if (!description) return withheld(JOB_POSTING_WITHHELD.NO_DESCRIPTION);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description,
    datePosted,
  };
  const validThrough = isoDate(job.closesAt);
  if (validThrough) jsonLd.validThrough = validThrough;
  const employmentType = EMPLOYMENT_TYPE_MAP[job.employmentType];
  if (employmentType) jsonLd.employmentType = employmentType;

  jsonLd.hiringOrganization = {
    '@type': 'Organization',
    // The name the page shows under the title. No sameAs: no official profile
    // is recorded as Valida-controlled (Doc 16 sections 145-146, SEO-037).
    name: SITE_NAME,
    url: absoluteUrl(siteOrigin, '/'),
    logo: absoluteUrl(siteOrigin, ORGANIZATION_LOGO_PATH),
  };

  // Fully remote (Doc 16 sections 131-132). The eligible area is the location
  // the page shows, as text: the public DTO exposes no country or region code,
  // so none is asserted separately.
  jsonLd.jobLocationType = 'TELECOMMUTE';
  jsonLd.applicantLocationRequirements = { '@type': 'AdministrativeArea', name: job.location };

  const salary = baseSalary(job.compensation);
  if (salary) jsonLd.baseSalary = salary;
  const hours = formatWeeklyHours(job.weeklyHours);
  if (hours) jsonLd.workHours = hours;

  /*
   * directApply (Doc 16 section 136, SEO-033). Google defines direct apply by
   * the steps the candidate must take; Valida's flow is one "Apply for This
   * Role" action from this page to a single form on the same site, with no
   * account, no login and no redirect to another site (C3 E2E, accepted at
   * f07ea35).
   */
  jsonLd.directApply = true;
  jsonLd.url = absoluteUrl(siteOrigin, jobRoute(job.slug));

  return { jsonLd, withheld: null };
}
