import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  renderRoute, installJobsService, installApplicationsService, resetServices, httpError, testJob,
} from '../test/renderRoute.jsx';
import {
  resolveVisitorRegion, regionLabel, INTERNATIONAL_REGION, COUNTRY_LABELS,
  SELECTABLE_REGIONS, MARKET,
} from '../features/jobs/markets.js';
import resolveJobMarketPresentation, {
  COMPENSATION_UNAVAILABLE,
} from '../features/jobs/utils/resolveJobMarketPresentation.js';

/** Regression coverage for A5 Browser QA Correction Cycle 7. */
const SLUG = 'cybersecurity-specialist';
const SYNTHETIC = '[DEV FIXTURE]';

const marketJob = (over = {}) =>
  testJob({
    employmentType: undefined,
    schedule: undefined,
    hiringMarkets: [
      { marketId: MARKET.CANADA, countries: ['CA'], locationLabel: 'British Columbia, Canada', compensation: { currency: 'CAD', amount: 35, unit: 'HOUR', gross: true } },
      { marketId: MARKET.EUROPE, countries: ['DE'], claimPrefix: SYNTHETIC, compensation: { currency: 'EUR', amount: 28, unit: 'HOUR', gross: true } },
      { marketId: MARKET.INTERNATIONAL, international: true, claimPrefix: SYNTHETIC, compensation: null },
    ],
    ...over,
  });

const serveJob = (job) => installJobsService({ getPublishedJobBySlug: async () => ({ job }) });
const detailsFacts = () =>
  screen.getByRole('heading', { name: 'Employment Details' }).closest('aside').querySelector('dl');

beforeEach(() => {
  window.scrollTo = vi.fn();
});
afterEach(() => resetServices());

// ---------------------------------------------------------------- finding 1 --
describe('unlisted countries fall back to International (finding 1)', () => {
  it.each([
    ['DE', 'DE'],
    ['CA', 'CA'],
    ['BR', 'BR'],
  ])('?region=%s stays a specific view because it is catalogued', (param, expected) => {
    expect(resolveVisitorRegion({ regionParam: param })).toBe(expected);
  });

  it.each(['MX', 'ZA', 'NZ', 'KR'])('?region=%s falls back to International', (param) => {
    expect(resolveVisitorRegion({ regionParam: param })).toBe(INTERNATIONAL_REGION);
  });

  it('falls back for an unlisted browser locale region', () => {
    expect(resolveVisitorRegion({ locales: ['es-MX'] })).toBe(INTERNATIONAL_REGION);
    expect(resolveVisitorRegion({ locales: ['ko-KR', 'de-DE'] })).toBe('DE');
  });

  it('never exposes a raw country code as a label', () => {
    expect(regionLabel('MX')).toBeNull();
    expect(regionLabel(INTERNATIONAL_REGION)).toBe('International');
    // Every resolvable region has a real name.
    ['MX', 'ZA', 'XX'].forEach((code) => {
      const resolved = resolveVisitorRegion({ regionParam: code });
      expect(regionLabel(resolved)).toBeTruthy();
    });
  });

  it('always leaves the selector holding a value it actually offers', async () => {
    serveJob(marketJob());
    renderRoute(`/careers/${SLUG}?region=MX`);
    await screen.findByRole('heading', { level: 1 });
    const select = screen.getByLabelText('Change regional view');
    const values = [...select.options].map((o) => o.value);
    expect(values).toContain(select.value);
    expect(select.value).toBe(INTERNATIONAL_REGION);
  });

  it('offers only catalogued regions, each with a real name', () => {
    SELECTABLE_REGIONS.forEach((code) => expect(COUNTRY_LABELS[code]).toBeTruthy());
  });
});

// ---------------------------------------------------------------- finding 2 --
describe('synthetic market claims are visibly synthetic (finding 2)', () => {
  it('marks a synthetic market location and compensation', () => {
    const p = resolveJobMarketPresentation(marketJob(), 'DE');
    expect(p.locationLabel).toBe(`${SYNTHETIC} Germany`);
    expect(p.compensationLabel).toBe(`${SYNTHETIC} EUR 28.00 gross per hour`);
  });

  it('does NOT mark the source-established Canada claim', () => {
    const p = resolveJobMarketPresentation(marketJob(), 'CA');
    expect(p.locationLabel).toBe('British Columbia, Canada');
    expect(p.compensationLabel).toBe('CAD 35.00 gross per hour');
    expect(p.locationLabel).not.toContain(SYNTHETIC);
    expect(p.compensationLabel).not.toContain(SYNTHETIC);
  });

  it('leaves the neutral fallback unmarked — it is canonical, not a claim', () => {
    const p = resolveJobMarketPresentation(marketJob(), 'BR');
    expect(p.compensationLabel).toBe(COMPENSATION_UNAVAILABLE);
    expect(p.compensationLabel).not.toContain(SYNTHETIC);
    expect(p.locationLabel).toBe(`${SYNTHETIC} International`);
  });

  it.each([
    ['Job Detail', `/careers/${SLUG}?region=DE`],
  ])('shows the marker on %s', async (_label, path) => {
    serveJob(marketJob());
    renderRoute(path);
    await screen.findByRole('heading', { level: 1 });
    const facts = detailsFacts();
    expect(within(facts).getByText(`${SYNTHETIC} Germany`)).toBeTruthy();
    expect(within(facts).getByText(`${SYNTHETIC} EUR 28.00 gross per hour`)).toBeTruthy();
  });

  it('shows the marker on the Careers row', async () => {
    installJobsService({ getPublishedJobs: async () => ({ items: [marketJob()] }) });
    renderRoute('/careers?region=DE');
    const list = await screen.findByTestId('careers-job-list');
    expect(list.textContent).toContain(`${SYNTHETIC} Germany`);
    expect(list.textContent).toContain(`${SYNTHETIC} EUR 28.00`);
  });

  it('shows the marker on the Apply context', async () => {
    serveJob(marketJob());
    renderRoute(`/careers/${SLUG}/apply?region=DE`);
    await screen.findByRole('heading', { level: 1 });
    const facts = screen.getByTestId('apply-context-facts');
    expect(facts.textContent).toContain(`${SYNTHETIC} Germany`);
  });

  it('keeps the marker literal out of production source', () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), '..');
    const production = [
      join(src, 'features', 'jobs', 'utils', 'resolveJobMarketPresentation.js'),
      join(src, 'features', 'jobs', 'markets.js'),
      join(src, 'features', 'jobs', 'components', 'JobRow.jsx'),
      join(src, 'pages', 'JobDetailPage.jsx'),
      join(src, 'pages', 'ApplyPage.jsx'),
    ];
    // The literal originates only in DEV fixture data; production merely passes
    // an optional value through.
    production.forEach((file) => expect(readFileSync(file, 'utf8')).not.toContain('DEV FIXTURE'));
  });

  it('marks the real dev fixture markets but not Canada', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'dev', 'fixtures', 'devJobFixtures.js'),
      'utf8',
    );
    const openJob = src.slice(src.indexOf('const openJob'), src.indexOf('const secondJob'));
    const canada = openJob.slice(openJob.indexOf("marketId: 'CANADA'"), openJob.indexOf("marketId: 'UNITED_STATES'"));
    // Target the actual assignment; the block carries a comment explaining
    // why no marker is set, which mentions the property name.
    expect(canada).not.toContain('claimPrefix: SYNTHETIC');
    expect(openJob.slice(openJob.indexOf("marketId: 'UNITED_STATES'"))).toContain('claimPrefix: SYNTHETIC');
  });
});

// ---------------------------------------------------------------- finding 3 --
describe('every Careers return link preserves the region (finding 3)', () => {
  const careersHref = (el) => el.getAttribute('href');

  it('preserves it on the Job Detail breadcrumb', async () => {
    serveJob(marketJob());
    renderRoute(`/careers/${SLUG}?region=DE`);
    await screen.findByRole('heading', { level: 1 });
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(careersHref(within(crumbs).getByRole('link', { name: 'Careers' }))).toBe('/careers?region=DE');
  });

  it('preserves it on a closed role Careers CTA', async () => {
    serveJob(marketJob({ applicationStatus: 'CLOSED', applicationForm: null }));
    renderRoute(`/careers/${SLUG}?region=DE`);
    await screen.findByTestId('job-closed-banner');
    screen.getAllByRole('link', { name: 'View Open Roles' }).forEach((link) =>
      expect(careersHref(link)).toBe('/careers?region=DE'),
    );
  });

  it('preserves it on the Job unavailable CTA', async () => {
    installJobsService({
      getPublishedJobBySlug: async () => {
        throw httpError(404, 'JOB_NOT_FOUND');
      },
    });
    renderRoute(`/careers/${SLUG}?region=DE`);
    const block = await screen.findByTestId('job-unavailable');
    expect(careersHref(within(block).getByRole('link', { name: 'View Open Roles' }))).toBe('/careers?region=DE');
    // Home is unrelated to the regional flow and stays clean.
    expect(careersHref(within(block).getByRole('link', { name: 'Go to Home' }))).toBe('/');
  });

  it('preserves it on the Job error CTA', async () => {
    installJobsService({
      getPublishedJobBySlug: async () => {
        throw httpError(503, 'SERVICE_UNAVAILABLE');
      },
    });
    renderRoute(`/careers/${SLUG}?region=DE`);
    const block = await screen.findByTestId('job-error');
    expect(careersHref(within(block).getByRole('link', { name: 'Back to Careers' }))).toBe('/careers?region=DE');
  });

  it('preserves it on the Apply success CTA', async () => {
    serveJob(marketJob());
    installApplicationsService({
      submitApplication: async () => ({
        data: { status: 'RECEIVED', job: { title: 'T', slug: SLUG }, submittedAt: '2026-09-12T12:00:00.000Z' },
      }),
    });
    const user = userEvent.setup();
    renderRoute(`/careers/${SLUG}/apply?region=DE`);
    await screen.findByRole('heading', { level: 1 });
    await user.type(screen.getByLabelText(/Full Name/), 'Jane Doe');
    await user.type(screen.getByLabelText(/Email Address/), 'jane@example.com');
    const pdf = new File(['x'], 'resume.pdf', { type: 'application/pdf' });
    Object.defineProperty(pdf, 'size', { value: 1024 });
    await user.upload(screen.getByLabelText(/Choose File|Replace File|Upload Resume/), pdf);
    await user.click(screen.getByRole('button', { name: /Submit Application/i }));

    const success = await screen.findByTestId('apply-success');
    expect(careersHref(within(success).getByRole('link', { name: 'Back to Careers' }))).toBe('/careers?region=DE');
    expect(careersHref(within(success).getByRole('link', { name: 'Go to Home' }))).toBe('/');
  });

  it('preserves it on the Apply unavailable CTA', async () => {
    installJobsService({
      getPublishedJobBySlug: async () => {
        throw httpError(404, 'JOB_NOT_FOUND');
      },
    });
    renderRoute(`/careers/${SLUG}/apply?region=DE`);
    const block = await screen.findByTestId('apply-unavailable');
    expect(careersHref(within(block).getByRole('link', { name: 'View Open Roles' }))).toBe('/careers?region=DE');
  });

  it('leaves URLs clean when no explicit region is set', async () => {
    serveJob(marketJob());
    renderRoute(`/careers/${SLUG}`);
    await screen.findByRole('heading', { level: 1 });
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(careersHref(within(crumbs).getByRole('link', { name: 'Careers' }))).toBe('/careers');
    expect(
      careersHref(screen.getAllByRole('link', { name: 'Apply for This Role' })[0]),
    ).toBe(`/careers/${SLUG}/apply`);
  });

  it('adds no region to unrelated Home or Privacy links', async () => {
    serveJob(marketJob());
    renderRoute(`/careers/${SLUG}/apply?region=DE`);
    await screen.findByRole('heading', { level: 1 });
    expect(careersHref(screen.getByRole('link', { name: 'Privacy Notice' }))).toBe('/privacy');
  });
});
