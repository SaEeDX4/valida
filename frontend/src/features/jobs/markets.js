/**
 * Region and hiring-market model.
 *
 * TWO SEPARATE CONCEPTS — the whole point of this module.
 *
 *   1. Visitor regional view  — which country's presentation the visitor is
 *      looking at. A preference, chosen by URL or inferred from browser locale.
 *   2. Job supported hiring markets — where a Job may actually be filled. This
 *      comes from the Job's own configuration and nothing else.
 *
 * A visitor's region NEVER creates eligibility. Selecting "Brazil" does not make
 * a role available in Brazil; it only changes which view is requested. If the
 * Job does not list that country, the UI says so rather than rewriting the role
 * around the visitor.
 *
 * No geolocation, no IP lookup, no country library, no FX. Browser locale is a
 * preference signal, never legal or geographic proof.
 */

/** Presentation groups a Job configuration may declare. */
export const MARKET = {
  CANADA: 'CANADA',
  UNITED_STATES: 'UNITED_STATES',
  EUROPE: 'EUROPE',
  INTERNATIONAL: 'INTERNATIONAL',
};

/** Sentinel for "no specific country" — the rest of the world view. */
export const INTERNATIONAL_REGION = 'INTERNATIONAL';

/**
 * Display names for the country codes the QA fixtures and selector use.
 *
 * Deliberately a short explicit map, not a country package. It exists so the UI
 * can show a real country name; it confers no eligibility whatsoever, and a
 * code being listed here says nothing about where any Job can be filled.
 */
export const COUNTRY_LABELS = {
  CA: 'Canada',
  US: 'United States',
  DE: 'Germany',
  FR: 'France',
  NL: 'Netherlands',
  IE: 'Ireland',
  BE: 'Belgium',
  AT: 'Austria',
  LT: 'Lithuania',
  ES: 'Spain',
  PT: 'Portugal',
  GB: 'United Kingdom',
  CH: 'Switzerland',
  NO: 'Norway',
  SE: 'Sweden',
  DK: 'Denmark',
  PL: 'Poland',
  BR: 'Brazil',
  IN: 'India',
  AU: 'Australia',
  JP: 'Japan',
};

/** Countries offered in the region selector, alphabetical by label. */
export const SELECTABLE_REGIONS = Object.keys(COUNTRY_LABELS).sort((a, b) =>
  COUNTRY_LABELS[a].localeCompare(COUNTRY_LABELS[b]),
);

/**
 * Human label for a region code, including the international sentinel.
 *
 * Returns null rather than the code itself for anything unlisted: a raw "MX"
 * must never be shown to a visitor as if it were a country name.
 */
export function regionLabel(region) {
  if (region === INTERNATIONAL_REGION) return 'International';
  return COUNTRY_LABELS[region] ?? null;
}

const isCountryCode = (value) => typeof value === 'string' && /^[A-Za-z]{2}$/.test(value);

/** A region is a specific view only when we can name it and offer it. */
export function isKnownRegion(region) {
  return region === INTERNATIONAL_REGION || Object.hasOwn(COUNTRY_LABELS, region);
}

/**
 * Resolves the visitor's regional view.
 *
 * Priority, highest first:
 *   1. an explicit ?region= parameter — the visitor's own choice;
 *   2. the browser locale's region subtag, when one can be read;
 *   3. INTERNATIONAL.
 *
 * A country code is only honoured when it is in COUNTRY_LABELS. Anything else —
 * ?region=MX, or a locale of es-MX — resolves to INTERNATIONAL.
 *
 * That boundary matters for three reasons: an unlisted code has no human name,
 * so the UI would otherwise print a raw "MX" at the visitor; the selector would
 * hold a value with no matching option, leaving a control the visitor cannot
 * return to; and International is exactly the right view for a country outside
 * the explicit catalogue. It is a deliberate catalogue, not a world list — no
 * country package is involved.
 *
 * Pure: every input is passed in, so this is fully testable and uses no browser
 * storage.
 */
export function resolveVisitorRegion({ regionParam, locales = [] } = {}) {
  if (typeof regionParam === 'string' && regionParam.trim()) {
    const value = regionParam.trim().toUpperCase();
    if (value === INTERNATIONAL_REGION) return INTERNATIONAL_REGION;
    if (isCountryCode(value) && isKnownRegion(value)) return value;
    // A syntactically valid but unlisted code is not a view we can present.
    return INTERNATIONAL_REGION;
  }

  for (const locale of Array.isArray(locales) ? locales : []) {
    if (typeof locale !== 'string' || !locale) continue;
    try {
      const region = new Intl.Locale(locale).region;
      if (isCountryCode(region) && isKnownRegion(region.toUpperCase())) {
        return region.toUpperCase();
      }
    } catch {
      // A malformed locale string is simply not a usable signal.
    }
  }

  return INTERNATIONAL_REGION;
}

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A hiring market entry is usable when it names a group and its countries. */
export function isUsableHiringMarket(market) {
  if (!isPlainObject(market)) return false;
  if (!Object.values(MARKET).includes(market.marketId)) return false;

  if (market.marketId === MARKET.INTERNATIONAL) {
    // International eligibility is never inferred; it must be declared.
    return market.international === true;
  }

  if (!Array.isArray(market.countries) || market.countries.length === 0) return false;
  if (!market.countries.every(isCountryCode)) return false;
  // Optional presentation notice, e.g. a fixture marking a synthetic claim.
  return market.claimPrefix === undefined || typeof market.claimPrefix === 'string';
}

/** The whole configuration, when a Job chooses to declare markets. */
export function isUsableHiringMarketList(markets) {
  if (markets === undefined || markets === null) return true; // optional
  if (!Array.isArray(markets) || markets.length === 0) return false;
  return markets.every(isUsableHiringMarket);
}
