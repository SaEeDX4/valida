import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOME_META } from '../../pages/HomePage.content.js';
import { describeHead, renderHeadTags } from '../../seo/head.js';
import { jobDetailHead } from '../../seo/routeHeads.js';
import { resolveSeoConfig } from '../../seo/siteConfig.js';
import { httpError, installJobsService, networkError, renderRoute, resetServices, testJob } from '../../test/renderRoute.jsx';

/**
 * C4 — the browser side of the head: canonical, Open Graph and JobPosting, on
 * top of the A4-A6 title / description / robots ownership.
 *
 * The suite runs as an indexable build with no canonical origin
 * (vitest.config.js); each test here sets the configuration it is about with
 * vi.stubEnv. "https://cybervalida.com" is the approved canonical origin
 * (OD-2026-11-09-01); nothing is served on it. All Jobs are synthetic (testJob).
 */

const SITE = 'https://cybervalida.com';

const q = (selector) => [...document.head.querySelectorAll(selector)];
const robots = () => q('meta[name="robots"]').map((tag) => tag.getAttribute('content'));
const canonical = () => q('link[rel="canonical"]').map((tag) => tag.getAttribute('href'));
const openGraph = () => q('meta[property^="og:"]').map((tag) => [tag.getAttribute('property'), tag.getAttribute('content')]);
const jsonLd = () => q('script[type="application/ld+json"]').map((tag) => JSON.parse(tag.textContent));

function clearHead() {
  q('meta[name="description"], meta[name="robots"], link[rel="canonical"], meta[property^="og:"], script[type="application/ld+json"]').forEach((tag) => tag.remove());
  document.title = '';
}

function production() {
  vi.stubEnv('VITE_ALLOW_INDEXING', 'true');
  vi.stubEnv('VITE_PUBLIC_SITE_URL', SITE);
}

const careersService = (overrides = {}) => ({
  getPublishedJobs: async () => ({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }),
  getPublishedJobBySlug: async () => ({ job: testJob() }),
  ...overrides,
});

/** The visible "Employment Details" facts, label -> text. */
function visibleFacts() {
  const list = screen.getByRole('heading', { name: 'Employment Details' }).parentElement.querySelector('dl');
  return Object.fromEntries(
    [...list.querySelectorAll('div')].map((row) => [row.querySelector('dt').textContent, row.querySelector('dd').textContent]),
  );
}

beforeEach(() => {
  window.scrollTo = vi.fn();
  clearHead();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetServices();
  clearHead();
});

describe('C4 — review build (the default): every page "noindex, nofollow" (Doc 16 section 82, SEO-020)', () => {
  it.each(['/', '/about', '/careers', '/privacy', '/legal', '/careers/cybersecurity-specialist', '/no-such-page'])('%s', async (path) => {
    vi.stubEnv('VITE_ALLOW_INDEXING', '');
    vi.stubEnv('VITE_PUBLIC_SITE_URL', SITE);
    installJobsService(careersService());
    renderRoute(path);
    await waitFor(() => expect(document.title).not.toBe(''));
    await waitFor(() => expect(robots()).toEqual(['noindex, nofollow']));
    expect(canonical()).toEqual([]);
    expect(openGraph()).toEqual([]);
    expect(jsonLd()).toEqual([]);
  });
});

describe('C4 — production build: canonical and Open Graph on indexable pages (Doc 16 sections 89-97)', () => {
  it('Home: self-canonical on the root, the five Open Graph tags, no robots, no JobPosting', async () => {
    production();
    renderRoute('/');
    await waitFor(() => expect(canonical()).toEqual([`${SITE}/`]));
    expect(robots()).toEqual([]);
    expect(openGraph()).toEqual([
      ['og:type', 'website'],
      ['og:site_name', 'Valida'],
      ['og:title', HOME_META.title],
      ['og:description', HOME_META.description],
      ['og:url', `${SITE}/`],
    ]);
    expect(jsonLd()).toEqual([]);
  });

  it('the canonical never carries the query (region view, tracking): one URL per page (Doc 16 section 93, SEO-039)', async () => {
    production();
    installJobsService(careersService());
    renderRoute('/careers?region=CA&utm_source=qa');
    await waitFor(() => expect(canonical()).toEqual([`${SITE}/careers`]));
    expect(openGraph().find(([property]) => property === 'og:url')[1]).toBe(`${SITE}/careers`);
  });
});

describe('C4 — Job lifecycle in the browser (Doc 16 sections 121-141)', () => {
  it('open Job WITH a deadline: Date Posted and Applications Close shown in UTC; indexable and canonical; no JobPosting', async () => {
    production();
    const job = testJob({ publishedAt: '2026-11-01T02:00:00.000Z', closesAt: '2027-03-31T23:59:59.000Z' });
    installJobsService(careersService({ getPublishedJobBySlug: async () => ({ job }) }));
    renderRoute(`/careers/${job.slug}`);
    await screen.findByRole('heading', { level: 1, name: job.title });
    await waitFor(() => expect(canonical()).toEqual([`${SITE}/careers/${job.slug}`]));

    const facts = visibleFacts();
    // Owner decision OD-2026-11-07-01. 02:00 UTC is 31 October in Vancouver; the page shows the UTC date.
    expect(facts['Date Posted']).toBe('1 November 2026');
    expect(facts['Applications Close']).toBe('31 March 2027, 23:59 UTC');
    const times = [...document.querySelectorAll('dd time')].map((time) => time.getAttribute('dateTime'));
    expect(times).toEqual([job.publishedAt, job.closesAt]);
    expect(facts.Location).toBe(job.location);
    expect(facts['Work Arrangement']).toBe('Fully remote');
    // C4 correction: job.location is the workplace, not where applicants may be — no JobPosting is emitted.
    expect(jsonLd()).toEqual([]);
    expect(robots()).toEqual([]);
    expect(screen.getAllByRole('link', { name: 'Apply for This Role' }).length).toBeGreaterThan(0);
  });

  it('open Job WITHOUT a deadline: Date Posted only — the whole Applications Close row is absent', async () => {
    production();
    const job = testJob({ publishedAt: '2026-09-10T18:00:00.000Z', closesAt: null });
    installJobsService(careersService({ getPublishedJobBySlug: async () => ({ job }) }));
    renderRoute(`/careers/${job.slug}`);
    await screen.findByRole('heading', { level: 1, name: job.title });
    const facts = visibleFacts();
    expect(facts['Date Posted']).toBe('10 September 2026');
    expect(Object.keys(facts)).not.toContain('Applications Close');
    expect(screen.queryByText('Applications Close')).toBeNull();
  });

  it('retained closed Job: visible closed state, no Apply action, "noindex, follow", no JobPosting, no canonical (SEO-024, 025)', async () => {
    production();
    const job = testJob({ applicationStatus: 'CLOSED', applicationForm: null });
    installJobsService(careersService({ getPublishedJobBySlug: async () => ({ job }) }));
    renderRoute(`/careers/${job.slug}`);
    await screen.findByTestId('job-closed-banner');
    await waitFor(() => expect(robots()).toEqual(['noindex, follow']));
    expect(screen.queryByRole('link', { name: 'Apply for This Role' })).toBeNull();
    expect(jsonLd()).toEqual([]);
    expect(canonical()).toEqual([]);
    expect(openGraph()).toEqual([]);
    // The accepted closed page is unchanged: no date rows, so no closing date can contradict the closed state.
    expect(Object.keys(visibleFacts())).not.toContain('Date Posted');
    expect(screen.queryByText('Applications Close')).toBeNull();
  });

  it('unknown / Draft / Archived Job (404): the neutral unavailable state, "noindex, follow", no JobPosting', async () => {
    production();
    installJobsService(careersService({ getPublishedJobBySlug: async () => { throw httpError(404, 'JOB_NOT_FOUND'); } }));
    renderRoute('/careers/qa-no-such-role');
    await screen.findByTestId('job-unavailable');
    await waitFor(() => expect(document.title).toBe('Page Not Found | Valida'));
    expect(robots()).toEqual(['noindex, follow']);
    expect([...jsonLd(), ...canonical()]).toEqual([]);
  });

  it('Jobs API failure: the error state, not a 404 and not indexable, no JobPosting', async () => {
    production();
    installJobsService(careersService({ getPublishedJobBySlug: async () => { throw networkError(); } }));
    renderRoute('/careers/qa-role');
    await screen.findByTestId('job-error');
    await waitFor(() => expect(robots()).toEqual(['noindex, follow']));
    expect(document.title).toBe('Careers at Valida');
    expect([...jsonLd(), ...canonical()]).toEqual([]);
  });

  it('Apply for an open Job: "noindex, follow", never JobPosting or a canonical (SEO-017, Doc 16 section 125)', async () => {
    production();
    const job = testJob();
    installJobsService(careersService({ getPublishedJobBySlug: async () => ({ job }) }));
    renderRoute(`/careers/${job.slug}/apply`);
    await waitFor(() => expect(document.title).toBe(`Apply for ${job.title} | Valida`));
    expect(robots()).toEqual(['noindex, follow']);
    expect([...jsonLd(), ...canonical()]).toEqual([]);
    expect(openGraph()).toEqual([]);
  });

  it('client navigation Job -> Careers moves the canonical; a stale JobPosting script is removed by the mounted route', async () => {
    production();
    const job = testJob();
    // A JobPosting left in the head by an earlier build or route must never survive (Doc 16 section 125).
    document.head.insertAdjacentHTML('beforeend', '<script type="application/ld+json" data-valida-structured-data="JobPosting">{"@type":"JobPosting"}</script>');
    installJobsService(careersService({ getPublishedJobBySlug: async () => ({ job }) }));
    const user = userEvent.setup();

    renderRoute(`/careers/${job.slug}`);
    await screen.findByRole('heading', { level: 1, name: job.title });
    await waitFor(() => expect(jsonLd()).toEqual([]));
    expect(canonical()).toEqual([`${SITE}/careers/${job.slug}`]);

    await user.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Careers' }));
    await screen.findByRole('heading', { level: 1, name: /Work on technology/ });
    await waitFor(() => expect(canonical()).toEqual([`${SITE}/careers`]));
    expect(jsonLd()).toEqual([]);
    expect(robots()).toEqual([]);
  });

  it('Job Detail -> Apply by the Apply action: canonical removed, "noindex, follow" set, no JobPosting', async () => {
    production();
    const job = testJob();
    installJobsService(careersService({ getPublishedJobBySlug: async () => ({ job }) }));
    const user = userEvent.setup();
    renderRoute(`/careers/${job.slug}`);
    await waitFor(() => expect(canonical()).toEqual([`${SITE}/careers/${job.slug}`]));
    await user.click(screen.getAllByRole('link', { name: 'Apply for This Role' })[0]);
    await waitFor(() => expect(document.title).toBe(`Apply for ${job.title} | Valida`));
    expect(jsonLd()).toEqual([]);
    expect(canonical()).toEqual([]);
    expect(robots()).toEqual(['noindex, follow']);
  });
});

describe('C4 — the browser adopts the head the server already wrote', () => {
  it('server-rendered tags for an open Job are reused, never duplicated', async () => {
    production();
    const job = testJob();
    // What the document server writes into the initial HTML for this route (server/renderDocument.js).
    const serverHead = describeHead(jobDetailHead(job), resolveSeoConfig({ siteUrl: SITE, allowIndexing: 'true' }));
    document.title = serverHead.title;
    document.head.insertAdjacentHTML('beforeend', renderHeadTags(serverHead));
    expect(serverHead.jsonLd).toBeNull();
    expect(canonical()).toHaveLength(1);

    installJobsService(careersService({ getPublishedJobBySlug: async () => ({ job }) }));
    renderRoute(`/careers/${job.slug}`);
    await screen.findByRole('heading', { level: 1, name: job.title });
    await waitFor(() => expect(q('meta[name="description"]')).toHaveLength(1));
    expect(canonical()).toEqual([`${SITE}/careers/${job.slug}`]);
    expect(openGraph()).toHaveLength(5);
    expect(new Set(openGraph().map(([property]) => property)).size).toBe(5);
    expect(jsonLd()).toEqual([]);
  });
});
