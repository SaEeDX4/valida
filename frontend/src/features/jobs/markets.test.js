import { describe, it, expect } from 'vitest';
import {
  resolveVisitorRegion, INTERNATIONAL_REGION, regionLabel,
  isUsableHiringMarket, isUsableHiringMarketList, MARKET,
} from './markets.js';
import resolveJobMarketPresentation, {
  COMPENSATION_UNAVAILABLE, buildRegionalJobFacts,
} from './utils/resolveJobMarketPresentation.js';

const market = (over = {}) => ({ marketId: MARKET.CANADA, countries: ['CA'], compensation: null, ...over });

const job = (over = {}) => ({
  title: 'Cybersecurity Specialist',
  slug: 'cybersecurity-specialist',
  workArrangement: 'FULLY_REMOTE',
  weeklyHours: 30,
  hiringMarkets: [
    market({ locationLabel: 'British Columbia, Canada', compensation: { currency: 'CAD', amount: 35, unit: 'HOUR', gross: true } }),
    market({ marketId: MARKET.UNITED_STATES, countries: ['US'], compensation: { currency: 'USD', amount: 30, unit: 'HOUR', gross: true } }),
    market({ marketId: MARKET.EUROPE, countries: ['DE', 'FR'], compensation: { currency: 'EUR', amount: 28, unit: 'HOUR', gross: true } }),
    { marketId: MARKET.INTERNATIONAL, international: true, compensation: null },
  ],
  ...over,
});

describe('visitor region resolution', () => {
  it('prefers an explicit region parameter', () => {
    expect(resolveVisitorRegion({ regionParam: 'de', locales: ['en-CA'] })).toBe('DE');
    expect(resolveVisitorRegion({ regionParam: 'INTERNATIONAL' })).toBe(INTERNATIONAL_REGION);
  });

  it('falls back to the browser locale region', () => {
    expect(resolveVisitorRegion({ locales: ['en-CA', 'fr-FR'] })).toBe('CA');
    expect(resolveVisitorRegion({ locales: ['de-DE'] })).toBe('DE');
  });

  it('falls back to INTERNATIONAL when no usable signal exists', () => {
    expect(resolveVisitorRegion({})).toBe(INTERNATIONAL_REGION);
    expect(resolveVisitorRegion({ locales: ['en'] })).toBe(INTERNATIONAL_REGION);
    expect(resolveVisitorRegion({ locales: ['!!broken!!'] })).toBe(INTERNATIONAL_REGION);
  });

  it('accepts a country no Job supports — a visitor may be anywhere', () => {
    expect(resolveVisitorRegion({ regionParam: 'BR' })).toBe('BR');
    expect(regionLabel('BR')).toBe('Brazil');
  });
});

describe('hiring market configuration contract', () => {
  it('requires an explicit country allowlist', () => {
    expect(isUsableHiringMarket(market())).toBe(true);
    expect(isUsableHiringMarket(market({ countries: [] }))).toBe(false);
    expect(isUsableHiringMarket(market({ countries: undefined }))).toBe(false);
    expect(isUsableHiringMarket(market({ countries: ['CANADA'] }))).toBe(false);
  });

  it('never infers international eligibility', () => {
    expect(isUsableHiringMarket({ marketId: MARKET.INTERNATIONAL, international: true })).toBe(true);
    expect(isUsableHiringMarket({ marketId: MARKET.INTERNATIONAL })).toBe(false);
    expect(isUsableHiringMarket({ marketId: MARKET.INTERNATIONAL, international: false })).toBe(false);
  });

  it('treats markets as optional but validates a declared list', () => {
    expect(isUsableHiringMarketList(undefined)).toBe(true);
    expect(isUsableHiringMarketList([market()])).toBe(true);
    expect(isUsableHiringMarketList([])).toBe(false);
    expect(isUsableHiringMarketList([{ marketId: 'GOOD_COUNTRIES', countries: ['DE'] }])).toBe(false);
  });
});

describe('regional presentation — supported markets', () => {
  it('shows the explicit Canada label and CAD for a Canadian view', () => {
    const p = resolveJobMarketPresentation(job(), 'CA');
    expect(p.isSupported).toBe(true);
    expect(p.locationLabel).toBe('British Columbia, Canada');
    expect(p.compensationLabel).toBe('CAD 35.00 gross per hour');
  });

  it('shows the visitor country and USD for a US view', () => {
    const p = resolveJobMarketPresentation(job(), 'US');
    expect(p.isSupported).toBe(true);
    expect(p.locationLabel).toBe('United States');
    expect(p.compensationLabel).toBe('USD 30.00 gross per hour');
  });

  it('shows Germany and EUR for a German view, with no conversion', () => {
    const p = resolveJobMarketPresentation(job(), 'DE');
    expect(p.locationLabel).toBe('Germany');
    expect(p.compensationLabel).toBe('EUR 28.00 gross per hour');
    // The EUR figure is configured, not derived from CAD 35.
    expect(p.compensationLabel).not.toMatch(/35/);
  });

  it('does not assume every European country uses EUR', () => {
    const swiss = job({
      hiringMarkets: [
        market({ marketId: MARKET.EUROPE, countries: ['CH'], locationLabel: 'Switzerland', compensation: { currency: 'CHF', amount: 55, unit: 'HOUR', gross: true } }),
      ],
    });
    const p = resolveJobMarketPresentation(swiss, 'CH');
    expect(p.compensationLabel).toBe('CHF 55.00 gross per hour');
    expect(p.compensationLabel).not.toMatch(/EUR/);
  });

  it('shows the neutral fallback when a supported market has no compensation', () => {
    const noComp = job({ hiringMarkets: [market({ countries: ['CA'], compensation: null })] });
    expect(resolveJobMarketPresentation(noComp, 'CA').compensationLabel).toBe(COMPENSATION_UNAVAILABLE);
  });
});

describe('regional presentation — unsupported visitors', () => {
  it('uses International only when the Job declares it', () => {
    const p = resolveJobMarketPresentation(job(), 'BR');
    expect(p.isSupported).toBe(false);
    expect(p.usesInternationalFallback).toBe(true);
    // The role is international — it is NOT located in Brazil.
    expect(p.locationLabel).toBe('International');
    expect(p.locationLabel).not.toMatch(/Brazil/);
    expect(p.visitorCountryLabel).toBe('Brazil');
  });

  it('gives International no compensation unless one is configured', () => {
    expect(resolveJobMarketPresentation(job(), 'BR').compensationLabel).toBe(COMPENSATION_UNAVAILABLE);
    const withIntl = job({
      hiringMarkets: [
        ...job().hiringMarkets.slice(0, 3),
        { marketId: MARKET.INTERNATIONAL, international: true, compensation: { currency: 'USD', amount: 25, unit: 'HOUR', gross: true } },
      ],
    });
    expect(resolveJobMarketPresentation(withIntl, 'BR').compensationLabel).toBe('USD 25.00 gross per hour');
  });

  it('shows the real supported markets when International is not offered', () => {
    const limited = job({
      hiringMarkets: [
        market({ countries: ['CA'], locationLabel: 'Canada' }),
        market({ marketId: MARKET.EUROPE, countries: ['CH'], locationLabel: 'Switzerland' }),
      ],
    });
    const p = resolveJobMarketPresentation(limited, 'BR');
    expect(p.isSupported).toBe(false);
    expect(p.usesInternationalFallback).toBe(false);
    expect(p.locationLabel).toBe('Canada · Switzerland');
    expect(p.locationLabel).not.toMatch(/Brazil/);
    // No market-specific compensation for an unsupported region.
    expect(p.compensationLabel).toBe(COMPENSATION_UNAVAILABLE);
  });

  it('never turns a selected region into a supported market', () => {
    const limited = job({ hiringMarkets: [market({ countries: ['CA'], locationLabel: 'Canada' })] });
    ['BR', 'IN', 'JP', 'DE'].forEach((region) => {
      expect(resolveJobMarketPresentation(limited, region).isSupported).toBe(false);
    });
    expect(resolveJobMarketPresentation(limited, 'CA').isSupported).toBe(true);
  });
});

describe('truth control in presentation', () => {
  it('never derives an employment type from weekly hours', () => {
    const p = resolveJobMarketPresentation(job({ weeklyHours: 30 }), 'CA');
    expect(p.employmentTypeLabel).toBeNull();
    expect(buildRegionalJobFacts(p).map((f) => f.label)).not.toContain('Employment Type');
    expect(JSON.stringify(p)).not.toMatch(/Part time/i);
  });

  it('renders employment type only when the Job explicitly supplies one', () => {
    const p = resolveJobMarketPresentation(job({ employmentType: 'FULL_TIME' }), 'CA');
    expect(p.employmentTypeLabel).toBe('Full time');
  });

  it('omits every absent fact rather than rendering an empty label', () => {
    const facts = buildRegionalJobFacts(resolveJobMarketPresentation(job({ weeklyHours: undefined }), 'CA'));
    expect(facts.map((f) => f.label)).toEqual(['Location', 'Work Arrangement', 'Compensation']);
    facts.forEach((f) => expect(f.value).toBeTruthy());
  });

  it('presents a Job with no declared markets from its own fields', () => {
    const legacy = { title: 'T', slug: 's', location: 'Vilnius, Lithuania', workArrangement: 'FULLY_REMOTE' };
    const p = resolveJobMarketPresentation(legacy, 'DE');
    expect(p.locationLabel).toBe('Vilnius, Lithuania');
    expect(p.compensationLabel).toBeNull();
  });
});
