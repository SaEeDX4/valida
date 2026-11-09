// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ISO_3166_1_ALPHA_2 } from '../../../../backend/src/modules/jobs/countryCodes.js';
import { isUsableJobDetail } from './api/jobContract.js';
import { COUNTRY_NAMES, countryName } from './countryNames.js';
import { COUNTRY_LABELS, SELECTABLE_REGIONS } from './markets.js';
import {
  buildEligibleWorkCountriesFacts,
  eligibleWorkCountryNames,
  isUsableEligibleWorkCountries,
} from './utils/eligibleWorkCountries.js';
import { JOB_DETAIL } from '../../pages/JobDetailPage.content.js';

/**
 * Eligible remote-work countries — OD-2026-11-09-02. SYNTHETIC DATA ONLY.
 */

const detail = (overrides = {}) => ({
  title: 'QA Synthetic Remote Role',
  slug: 'qa-synthetic-remote-role',
  workArrangement: 'FULLY_REMOTE',
  applicationStatus: 'CLOSED',
  applicationForm: null,
  ...overrides,
});

describe('one country-code representation across backend and frontend', () => {
  it('the frontend names exactly the codes the backend accepts: ISO 3166-1 alpha-2, 249 codes', () => {
    expect(Object.keys(COUNTRY_NAMES)).toEqual([...ISO_3166_1_ALPHA_2]);
    expect(ISO_3166_1_ALPHA_2).toHaveLength(249);
    for (const code of ISO_3166_1_ALPHA_2) expect(code, code).toMatch(/^[A-Z]{2}$/);
  });

  it('the 21-country regional selector is unchanged, and its labels are the same names', () => {
    expect(SELECTABLE_REGIONS).toEqual([
      'AU', 'AT', 'BE', 'BR', 'CA', 'DK', 'FR', 'DE', 'IN', 'IE', 'JP', 'LT', 'NL', 'NO', 'PL', 'PT', 'ES', 'SE', 'CH', 'GB', 'US',
    ]);
    for (const [code, label] of Object.entries(COUNTRY_LABELS)) expect(countryName(code), code).toBe(label);
  });

  it('countryName names nothing that is not a code', () => {
    for (const value of ['de', 'XX', 'DEU', 'Germany', '', null, undefined, 49, 'toString', '__proto__']) {
      expect(countryName(value), String(value)).toBeNull();
    }
  });
});

describe('the Job Detail contract', () => {
  it('accepts an absent list (an older response) and an explicit one', () => {
    expect(isUsableEligibleWorkCountries(undefined)).toBe(true);
    expect(isUsableEligibleWorkCountries([])).toBe(true);
    expect(isUsableEligibleWorkCountries(['NZ', 'DE'])).toBe(true);
    expect(isUsableJobDetail(detail())).toBe(true);
    expect(isUsableJobDetail(detail({ eligibleWorkCountries: ['NZ', 'DE'] }))).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'DE'],
    ['a lowercase code', ['de']],
    ['an unassigned code', ['XX']],
    ['a duplicate', ['DE', 'DE']],
    ['a name', ['Germany']],
  ])('treats %s as a malformed response, never a partial claim', (_label, value) => {
    expect(isUsableEligibleWorkCountries(value)).toBe(false);
    expect(isUsableJobDetail(detail({ eligibleWorkCountries: value }))).toBe(false);
  });
});

describe('what the page states', () => {
  it('a fully remote Job with a list: one row, the names in the Job\'s order', () => {
    const job = detail({ eligibleWorkCountries: ['NZ', 'DE'] });
    expect(eligibleWorkCountryNames(job)).toEqual(['New Zealand', 'Germany']);
    expect(buildEligibleWorkCountriesFacts(job, JOB_DETAIL.labels)).toEqual([
      { label: 'Eligible Remote-Work Countries', value: 'New Zealand, Germany' },
    ]);
  });

  it('absent, empty or on a non-remote Job: no row and no country at all', () => {
    for (const job of [
      detail(),
      detail({ eligibleWorkCountries: [] }),
      detail({ workArrangement: 'HYBRID', eligibleWorkCountries: ['NZ'] }),
      detail({ workArrangement: 'ON_SITE', eligibleWorkCountries: ['NZ'] }),
      detail({ workArrangement: null, eligibleWorkCountries: ['NZ'] }),
    ]) {
      expect(buildEligibleWorkCountriesFacts(job, JOB_DETAIL.labels), JSON.stringify(job)).toEqual([]);
    }
  });

  it('nothing else is read: location, a hiring market or a visitor region adds no country', () => {
    const job = detail({
      location: 'QA Region, Canada',
      countryCode: 'CA',
      hiringMarkets: [{ marketId: 'CANADA', countries: ['CA'] }],
      region: 'DE',
      internalOccupationalReference: 'NOC 99999',
    });
    expect(eligibleWorkCountryNames(job)).toEqual([]);
  });
});
