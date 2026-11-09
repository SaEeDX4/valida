import { ISO_3166_1_ALPHA_2, isIsoCountryCode } from './countryCodes.js';

/**
 * Eligible remote-work countries — owner decision OD-2026-11-09-02.
 *
 * One optional Job field, `eligibleWorkCountries`: the countries from which
 * Valida has approved an employee to perform that remote role, as ISO 3166-1
 * alpha-2 codes (countryCodes.js) in the order given.
 *
 * Pure rules with no database or model import, shared by the Job model (on
 * every save), the provisioning definition schema (before any database
 * access) and the public DTO mapper, so all three refuse the same input with
 * the same words.
 *
 * Four concepts stay independent: the physical job location (`location`), the
 * recruitment audience, the visitor's regional presentation (the frontend
 * selector) and these countries. Only an explicit list on the Job sets them.
 */

/**
 * OD-2026-11-09-02 — the problem with a list of eligible remote-work countries,
 * or null when it is valid: ISO 3166-1 alpha-2 codes exactly as written
 * (uppercase), each at most once. Shared with the provisioning definition
 * schema, so both layers refuse the same input with the same words.
 */
export function eligibleWorkCountriesProblem(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return 'eligibleWorkCountries must be a list of ISO 3166-1 alpha-2 codes';
  if (value.length > ISO_3166_1_ALPHA_2.length) return 'eligibleWorkCountries lists more codes than exist';
  const seen = new Set();
  for (const code of value) {
    if (!isIsoCountryCode(code)) {
      return `eligibleWorkCountries: ${JSON.stringify(String(code)).slice(0, 12)} is not an uppercase ISO 3166-1 alpha-2 country code`;
    }
    if (seen.has(code)) return `eligibleWorkCountries: ${code} is listed more than once`;
    seen.add(code);
  }
  return null;
}

/**
 * OD-2026-11-09-02 — eligible remote-work countries describe where a REMOTE
 * role may be performed. A list on a hybrid or on-site Job would be a claim
 * the page never makes (it is shown for fully remote Jobs only), so it is
 * refused; a Draft whose work arrangement is not yet set may hold one.
 */
export function eligibleWorkCountriesArrangementProblem(countries, workArrangement) {
  if (!Array.isArray(countries) || countries.length === 0) return null;
  if (workArrangement === null || workArrangement === undefined || workArrangement === 'FULLY_REMOTE') return null;
  return `eligibleWorkCountries apply to a FULLY_REMOTE Job only (workArrangement is ${workArrangement}); clear them with []`;
}

