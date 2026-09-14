import {
  MARKET, INTERNATIONAL_REGION, regionLabel, COUNTRY_LABELS,
} from '../markets.js';
import { formatEnumLabel, formatWeeklyHours, formatCompensation } from './formatJob.js';

/**
 * Single source of truth for how a Job is presented to a visitor in a region.
 *
 * Careers rows, Job Detail and the Apply context all call this, so the three
 * surfaces cannot disagree about location, market or compensation. The
 * market decision lives here in data, not in conditional JSX spread across
 * three pages.
 *
 * TRUTH RULES ENCODED HERE
 * - A visitor region is matched against a Job's EXPLICIT country allowlist.
 *   Selecting a country never adds it to a Job.
 * - International applies only when the Job declares international: true.
 * - Compensation is read from the matched market's own configuration. It is
 *   never converted, never derived from another market's currency, and never
 *   invented. Absent compensation shows the neutral canonical fallback.
 * - Employment type is shown only when the Job explicitly supplies one. It is
 *   never inferred from weekly hours.
 */

/** Canonical neutral copy when no approved compensation exists for a market. */
export const COMPENSATION_UNAVAILABLE = 'Location-dependent';

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * Prefixes a market claim with the market's own presentation notice.
 *
 * Production code only passes a value THROUGH; it never supplies one. The
 * notice lives in the data, so a fixture can mark its synthetic location and
 * compensation as such while a real approved market carries no notice at all
 * and renders unchanged. No fixture literal is hard-coded here, which is what
 * keeps the production bundle free of fixture strings.
 */
function withClaimNotice(value, market) {
  if (!isNonEmptyString(value)) return value;
  const notice = market?.claimPrefix;
  return isNonEmptyString(notice) ? `${notice.trim()} ${value}` : value;
}

/** Label for a market, used when telling a visitor where a role IS supported. */
function marketLabel(market) {
  const base = (() => {
    if (isNonEmptyString(market.locationLabel)) return market.locationLabel;
    if (market.marketId === MARKET.INTERNATIONAL) return 'International';
    if (market.marketId === MARKET.CANADA) return 'Canada';
    if (market.marketId === MARKET.UNITED_STATES) return 'United States';
    if (Array.isArray(market.countries)) {
      return market.countries.map((code) => COUNTRY_LABELS[code] ?? code).join(', ');
    }
    return null;
  })();
  return withClaimNotice(base, market);
}

export default function resolveJobMarketPresentation(job, visitorRegion = INTERNATIONAL_REGION) {
  const base = {
    visitorRegion,
    visitorCountryLabel: regionLabel(visitorRegion),
    matchedMarket: null,
    isSupported: false,
    usesInternationalFallback: false,
    locationLabel: null,
    workArrangementLabel: formatEnumLabel(job?.workArrangement),
    // Only rendered when the Job explicitly provides it (browser finding 1).
    employmentTypeLabel: formatEnumLabel(job?.employmentType),
    scheduleLabel: isNonEmptyString(job?.schedule) ? job.schedule : null,
    weeklyHoursLabel: formatWeeklyHours(job?.weeklyHours),
    compensationLabel: null,
    supportedMarketLabels: [],
  };

  const markets = Array.isArray(job?.hiringMarkets) ? job.hiringMarkets : null;

  /*
   * No market configuration: present the Job's own fields exactly as supplied.
   * This is the honest legacy path — the Job simply has not declared markets,
   * so there is nothing region-specific to resolve and nothing to invent.
   */
  if (!markets || markets.length === 0) {
    return {
      ...base,
      locationLabel: isNonEmptyString(job?.location) ? job.location : null,
      compensationLabel: formatCompensation(job?.compensation) ?? null,
    };
  }

  const supportedMarketLabels = markets.map(marketLabel).filter(Boolean);

  // 1. An explicit country match in the Job's own allowlist.
  const matched = markets.find(
    (market) =>
      Array.isArray(market.countries) &&
      visitorRegion !== INTERNATIONAL_REGION &&
      market.countries.includes(visitorRegion),
  );

  if (matched) {
    return {
      ...base,
      matchedMarket: matched,
      isSupported: true,
      // A market may pin an explicit label (a province-specific role); otherwise
      // the visitor's own country name is the honest location for this view.
      locationLabel: withClaimNotice(
        isNonEmptyString(matched.locationLabel) ? matched.locationLabel : regionLabel(visitorRegion),
        matched,
      ),
      // The neutral fallback is canonical copy, not a claim, so it is never
      // marked synthetic.
      compensationLabel: formatCompensation(matched.compensation)
        ? withClaimNotice(formatCompensation(matched.compensation), matched)
        : COMPENSATION_UNAVAILABLE,
      supportedMarketLabels,
    };
  }

  // 2. International, but only when the Job actually declares it.
  const international = markets.find(
    (market) => market.marketId === MARKET.INTERNATIONAL && market.international === true,
  );

  if (international) {
    return {
      ...base,
      matchedMarket: international,
      isSupported: false,
      usesInternationalFallback: true,
      // The role is international — it is NOT located in the visitor's country.
      locationLabel: withClaimNotice('International', international),
      compensationLabel: formatCompensation(international.compensation)
        ? withClaimNotice(formatCompensation(international.compensation), international)
        : COMPENSATION_UNAVAILABLE,
      supportedMarketLabels,
    };
  }

  /*
   * 3. Unsupported. The visitor's country is not a hiring market and the Job
   * offers no international option, so the real supported markets are shown.
   * No market-specific compensation is displayed for an unsupported region.
   */
  return {
    ...base,
    isSupported: false,
    locationLabel: supportedMarketLabels.join(' · ') || null,
    compensationLabel: COMPENSATION_UNAVAILABLE,
    supportedMarketLabels,
  };
}

/**
 * Employment Details rows, in canonical order, with every absent value omitted.
 * Nothing here renders an empty label.
 */
export function buildRegionalJobFacts(presentation) {
  return [
    { label: 'Location', value: presentation.locationLabel },
    { label: 'Work Arrangement', value: presentation.workArrangementLabel },
    { label: 'Employment Type', value: presentation.employmentTypeLabel },
    { label: 'Schedule', value: presentation.scheduleLabel },
    { label: 'Weekly Hours', value: presentation.weeklyHoursLabel },
    { label: 'Compensation', value: presentation.compensationLabel },
  ].filter((fact) => Boolean(fact.value));
}

/** Compact facts for a Careers row: location, arrangement, hours, compensation. */
export function buildRegionalRowFacts(presentation) {
  return [
    presentation.locationLabel,
    presentation.workArrangementLabel,
    presentation.employmentTypeLabel,
    presentation.weeklyHoursLabel,
    presentation.compensationLabel,
  ].filter(Boolean);
}
