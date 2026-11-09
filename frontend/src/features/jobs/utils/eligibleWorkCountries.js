import { countryName } from '../countryNames.js';

/**
 * Eligible remote-work countries — owner decision OD-2026-11-09-02.
 *
 * The public Job Detail DTO carries `eligibleWorkCountries`: the ISO 3166-1
 * alpha-2 codes of the countries from which Valida has approved an employee to
 * perform that remote role, in the order the Job states them. This module turns
 * them into the visible "Eligible Remote-Work Countries" row and the country
 * names the JobPosting repeats, so the page and the markup cannot disagree.
 *
 * FOUR CONCEPTS STAY INDEPENDENT:
 *   - the physical job location   `job.location`, shown as Location;
 *   - the recruitment audience    not a Job field (OD-2026-11-09-01);
 *   - the regional presentation   the visitor's selector (markets.js), which
 *                                 changes how location and pay are presented;
 *   - eligible work countries     this field, and nothing else.
 * Nothing here reads the visitor's region, `location`, a hiring market, the
 * occupational reference or anything else: a country is named only because
 * the Job lists it. An absent or empty list names none, and states nothing.
 */

/**
 * Is a DTO's eligibleWorkCountries usable? Absent is (a response from before
 * the field existed, read as none). Present, it must be a list of known codes,
 * each at most once — anything else is a malformed contract, never a partial
 * claim.
 */
export function isUsableEligibleWorkCountries(value) {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  const seen = new Set();
  for (const code of value) {
    if (countryName(code) === null || seen.has(code)) return false;
    seen.add(code);
  }
  return true;
}

/**
 * The country names this Job states, in its order — only for a FULLY_REMOTE
 * Job with an explicit, non-empty list. Otherwise [] (no claim at all).
 */
export function eligibleWorkCountryNames(job) {
  if (job?.workArrangement !== 'FULLY_REMOTE') return [];
  const codes = Array.isArray(job?.eligibleWorkCountries) ? job.eligibleWorkCountries : [];
  if (!isUsableEligibleWorkCountries(codes)) return [];
  return codes.map(countryName);
}

/**
 * The visible Employment Details row, or no row. The label comes from the
 * page copy (JobDetailPage.content.js), like the date rows.
 */
export function buildEligibleWorkCountriesFacts(job, labels) {
  const names = eligibleWorkCountryNames(job);
  return names.length > 0 ? [{ label: labels.eligibleWorkCountries, value: names.join(', ') }] : [];
}
