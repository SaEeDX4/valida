import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  renderRoute, installJobsService, installApplicationsService, resetServices, testJob,
} from '../test/renderRoute.jsx';
import { MARKET } from '../features/jobs/markets.js';
import { COMPENSATION_UNAVAILABLE } from '../features/jobs/utils/resolveJobMarketPresentation.js';

/** Regression coverage for A5 Browser QA Correction Cycle 6. */
const SLUG = 'cybersecurity-specialist';

const regionalJob = (over = {}) =>
  testJob({
    weeklyHours: 30,
    employmentType: undefined,
    schedule: undefined,
    hiringMarkets: [
      { marketId: MARKET.CANADA, countries: ['CA'], locationLabel: 'British Columbia, Canada', compensation: { currency: 'CAD', amount: 35, unit: 'HOUR', gross: true } },
      { marketId: MARKET.UNITED_STATES, countries: ['US'], compensation: { currency: 'USD', amount: 30, unit: 'HOUR', gross: true } },
      { marketId: MARKET.EUROPE, countries: ['DE', 'FR'], compensation: { currency: 'EUR', amount: 28, unit: 'HOUR', gross: true } },
      { marketId: MARKET.INTERNATIONAL, international: true, compensation: null },
    ],
    ...over,
  });

const serveJob = (job) => installJobsService({ getPublishedJobBySlug: async () => ({ job }) });
const serveList = (job) => installJobsService({ getPublishedJobs: async () => ({ items: [job] }) });

const detailsPanel = () =>
  screen.getByRole('heading', { name: 'Employment Details' }).closest('aside');

/*
 * The Employment Details FACT LIST only.
 *
 * The regional badge sits in the same aside and legitimately shows the
 * visitor's own country — that is the "Regional view: Brazil / Hiring market:
 * International" distinction. Assertions about where the ROLE is must therefore
 * target the <dl>, not the whole panel, or they would read the badge.
 */
const detailsFacts = () => detailsPanel().querySelector('dl');

beforeEach(() => {
  window.scrollTo = vi.fn();
});
afterEach(() => resetServices());

// ------------------------------------------------- browser finding 1: claims --
describe('employment type is never an unapproved claim (browser finding 1)', () => {
  it('renders no Employment Type row when the Job supplies none', async () => {
    serveJob(regionalJob());
    renderRoute(`/careers/${SLUG}?region=CA`);
    await screen.findByRole('heading', { level: 1 });
    const panel = detailsPanel();
    expect(within(panel).queryByText('Employment Type')).toBeNull();
    expect(panel.textContent).not.toMatch(/Part time|Full time/i);
  });

  it('does not derive an employment type from 30 hours per week', async () => {
    serveJob(regionalJob({ weeklyHours: 30 }));
    const { container } = renderRoute(`/careers/${SLUG}?region=CA`);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText('30 hours per week')).toBeTruthy();
    expect(container.querySelector('main').textContent).not.toMatch(/Part time/i);
  });

  it('renders it when the Job explicitly provides one', async () => {
    serveJob(regionalJob({ employmentType: 'FULL_TIME' }));
    renderRoute(`/careers/${SLUG}?region=CA`);
    await screen.findByRole('heading', { level: 1 });
    expect(within(detailsPanel()).getByText('Employment Type')).toBeTruthy();
    expect(within(detailsPanel()).getByText('Full time')).toBeTruthy();
  });

  it('keeps the unapproved claim out of the dev fixture', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'dev', 'fixtures', 'devJobFixtures.js'),
      'utf8',
    );
    const openJob = src.slice(src.indexOf('const openJob'), src.indexOf('const secondJob'));
    expect(openJob).not.toMatch(/employmentType:\s*'PART_TIME'/);
  });
});

// -------------------------------------------------- browser finding 2: sticky --
describe('sticky summary clears the header (browser finding 2)', () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'JobDetailPage.module.css'),
    'utf8',
  );

  it('offsets the sticky summary by the real header height', () => {
    expect(css).toMatch(/inset-block-start:\s*calc\(var\(--header-block-size\)/);
    // Not a magic value disconnected from the header.
    expect(css).not.toMatch(/inset-block-start:\s*6\.5rem/);
  });

  it('caps the summary height allowing for the header', () => {
    expect(css).toMatch(/max-block-size:\s*calc\(100dvh - var\(--header-block-size\)/);
  });

  it('keeps the sticky treatment desktop-only', () => {
    const desktop = css.slice(css.indexOf('@media (min-width: 1000px)'));
    expect(desktop).toMatch(/position:\s*sticky/);
    // No sticky rule outside the desktop media query.
    expect(css.slice(0, css.indexOf('@media (min-width: 1000px)'))).not.toMatch(/position:\s*sticky/);
  });

  it('defines the header height token once and uses it in the header', () => {
    const src = join(dirname(fileURLToPath(import.meta.url)), '..');
    expect(readFileSync(join(src, 'styles', 'tokens.css'), 'utf8')).toMatch(/--header-block-size:\s*72px/);
    expect(
      readFileSync(join(src, 'components', 'layout', 'Header', 'Header.module.css'), 'utf8'),
    ).toMatch(/min-block-size:\s*var\(--header-block-size\)/);
  });
});

// ------------------------------------------------------- regional presentation --
describe('regional presentation across surfaces', () => {
  it.each([
    ['CA', 'British Columbia, Canada', 'CAD 35.00 gross per hour'],
    ['US', 'United States', 'USD 30.00 gross per hour'],
    ['DE', 'Germany', 'EUR 28.00 gross per hour'],
  ])('?region=%s presents %s', async (region, location, compensation) => {
    serveJob(regionalJob());
    renderRoute(`/careers/${SLUG}?region=${region}`);
    await screen.findByRole('heading', { level: 1 });
    const facts = detailsFacts();
    expect(within(facts).getByText(location)).toBeTruthy();
    expect(within(facts).getByText(compensation)).toBeTruthy();
  });

  it('falls back to International only when the Job declares it', async () => {
    serveJob(regionalJob());
    renderRoute(`/careers/${SLUG}?region=BR`);
    await screen.findByRole('heading', { level: 1 });
    const facts = detailsFacts();
    expect(within(facts).getByText('International')).toBeTruthy();
    // The ROLE is not in Brazil, even though the badge shows the visitor's view.
    expect(facts.textContent).not.toMatch(/Brazil/);
    expect(within(facts).getByText(COMPENSATION_UNAVAILABLE)).toBeTruthy();
    // Appears in the badge and as the selected <option>; both are correct.
    expect(within(detailsPanel()).getAllByText('Brazil').length).toBeGreaterThan(0);
  });

  it('shows real supported markets when International is not offered', async () => {
    serveJob(regionalJob({
      hiringMarkets: [
        { marketId: MARKET.CANADA, countries: ['CA'], locationLabel: 'Canada', compensation: null },
        { marketId: MARKET.EUROPE, countries: ['CH'], locationLabel: 'Switzerland', compensation: null },
      ],
    }));
    renderRoute(`/careers/${SLUG}?region=BR`);
    await screen.findByRole('heading', { level: 1 });
    const facts = detailsFacts();
    expect(within(facts).getByText('Canada · Switzerland')).toBeTruthy();
    expect(facts.textContent).not.toMatch(/Brazil/);
  });

  it('performs no currency conversion between markets', async () => {
    serveJob(regionalJob());
    renderRoute(`/careers/${SLUG}?region=DE`);
    await screen.findByRole('heading', { level: 1 });
    const facts = detailsFacts();
    // EUR is the configured figure, not CAD 35 converted.
    expect(within(facts).getByText('EUR 28.00 gross per hour')).toBeTruthy();
    expect(facts.textContent).not.toMatch(/CAD/);
  });

  it('uses the same resolver on the Careers row', async () => {
    serveList(regionalJob());
    renderRoute('/careers?region=DE');
    const list = await screen.findByTestId('careers-job-list');
    expect(within(list).getByText('Germany')).toBeTruthy();
    expect(within(list).getByText('EUR 28.00 gross per hour')).toBeTruthy();
    expect(list.textContent).not.toMatch(/Part time/i);
  });

  it('uses the same resolver on the Apply context', async () => {
    serveJob(regionalJob());
    renderRoute(`/careers/${SLUG}/apply?region=DE`);
    await screen.findByRole('heading', { level: 1 });
    const facts = screen.getByTestId('apply-context-facts');
    expect(within(facts).getByText('Germany')).toBeTruthy();
    expect(within(facts).getByText('EUR 28.00 gross per hour')).toBeTruthy();
  });
});

// ------------------------------------------------------ selector + navigation --
describe('region selector and navigation', () => {
  it('is an accessible native select showing the country name as text', async () => {
    serveJob(regionalJob());
    renderRoute(`/careers/${SLUG}?region=DE`);
    await screen.findByRole('heading', { level: 1 });
    const select = screen.getByLabelText('Change regional view');
    expect(select.tagName).toBe('SELECT');
    expect(select.value).toBe('DE');
    // Meaning never depends on the flag emoji.
    expect(within(detailsFacts()).getByText('Germany')).toBeTruthy();
    expect(within(detailsPanel()).getByText('Regional view')).toBeTruthy();
  });

  it('claims no knowledge of the visitor location', async () => {
    serveJob(regionalJob());
    const { container } = renderRoute(`/careers/${SLUG}?region=DE`);
    await screen.findByRole('heading', { level: 1 });
    expect(container.textContent).not.toMatch(/based on your location|we detected|your location is/i);
  });

  it('updates the presentation immediately when the region changes', async () => {
    serveJob(regionalJob());
    const user = userEvent.setup();
    renderRoute(`/careers/${SLUG}?region=CA`);
    await screen.findByRole('heading', { level: 1 });
    expect(within(detailsFacts()).getByText('CAD 35.00 gross per hour')).toBeTruthy();

    await user.selectOptions(screen.getByLabelText('Change regional view'), 'DE');
    await waitFor(() =>
      expect(within(detailsFacts()).getByText('EUR 28.00 gross per hour')).toBeTruthy(),
    );
    expect(within(detailsFacts()).queryByText('CAD 35.00 gross per hour')).toBeNull();
  });

  it('carries the region from Careers into Job Detail', async () => {
    installJobsService({
      getPublishedJobs: async () => ({ items: [regionalJob()] }),
      getPublishedJobBySlug: async () => ({ job: regionalJob() }),
    });
    const user = userEvent.setup();
    renderRoute('/careers?region=DE');
    const list = await screen.findByTestId('careers-job-list');
    const link = within(list).getByRole('link', { name: /View .* role/ });
    expect(link.getAttribute('href')).toContain('region=DE');

    await user.click(link);
    await screen.findByRole('heading', { level: 1, name: 'Cybersecurity Specialist' });
    expect(within(detailsFacts()).getByText('Germany')).toBeTruthy();
  });

  it('carries the region from Job Detail into Apply and back', async () => {
    serveJob(regionalJob());
    const user = userEvent.setup();
    renderRoute(`/careers/${SLUG}?region=DE`);
    await screen.findByRole('heading', { level: 1 });

    const [apply] = screen.getAllByRole('link', { name: 'Apply for This Role' });
    expect(apply.getAttribute('href')).toContain('region=DE');
    await user.click(apply);

    await screen.findByRole('heading', { level: 1, name: /Apply for/ });
    expect(within(screen.getByTestId('apply-context-facts')).getByText('Germany')).toBeTruthy();

    const back = screen.getByRole('link', { name: /Back to Cybersecurity Specialist/ });
    expect(back.getAttribute('href')).toContain('region=DE');
  });

  it('uses no browser storage for the region', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    serveJob(regionalJob());
    const user = userEvent.setup();
    renderRoute(`/careers/${SLUG}?region=CA`);
    await screen.findByRole('heading', { level: 1 });
    await user.selectOptions(screen.getByLabelText('Change regional view'), 'US');
    await waitFor(() => expect(within(detailsFacts()).getByText('United States')).toBeTruthy());
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it('adds no region field to the application payload', async () => {
    serveJob(regionalJob());
    const submitApplication = vi.fn().mockResolvedValue({
      data: { status: 'RECEIVED', job: { title: 'T', slug: SLUG }, submittedAt: '2026-09-12T12:00:00.000Z' },
    });
    installApplicationsService({ submitApplication });
    const user = userEvent.setup();
    renderRoute(`/careers/${SLUG}/apply?region=DE`);
    await screen.findByRole('heading', { level: 1 });
    await user.type(screen.getByLabelText(/Full Name/), 'Jane Doe');
    await user.type(screen.getByLabelText(/Email Address/), 'jane@example.com');
    const pdf = new File(['x'], 'resume.pdf', { type: 'application/pdf' });
    Object.defineProperty(pdf, 'size', { value: 1024 });
    await user.upload(screen.getByLabelText(/Choose File|Replace File|Upload Resume/), pdf);
    await user.click(screen.getByRole('button', { name: /Submit Application/i }));

    await waitFor(() => expect(submitApplication).toHaveBeenCalled());
    const [, formData] = submitApplication.mock.calls[0];
    // Presentation only: the canonical API defines no region field.
    ['region', 'visitorRegion', 'market', 'country'].forEach((field) =>
      expect(formData.get(field)).toBeNull(),
    );
  });
});
