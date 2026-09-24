import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoute, installJobsService, resetServices, httpError, networkError, pending, testJob } from '../test/renderRoute.jsx';
import { findAccessibilityViolations } from '../test/axe.js';
import { JOB_DETAIL, jobDetailTitle, jobDetailDescription } from './JobDetailPage.content.js';

const SLUG = 'cybersecurity-specialist';
const PATH = `/careers/${SLUG}`;

const serveJob = (job) => installJobsService({ getPublishedJobBySlug: async () => ({ job }) });
const failWith = (error) =>
  installJobsService({
    getPublishedJobBySlug: async () => {
      throw error;
    },
  });

beforeEach(() => {
  window.scrollTo = vi.fn();
});
afterEach(() => resetServices());

describe('Job Detail — loading', () => {
  it('shows a structural skeleton with the accessible status', () => {
    installJobsService({ getPublishedJobBySlug: pending });
    renderRoute(PATH);
    expect(screen.getByTestId('job-loading')).toBeTruthy();
    expect(screen.getByText(JOB_DETAIL.loadingStatus)).toBeTruthy();
  });

  it('shows no fake title, salary or responsibilities while loading', () => {
    installJobsService({ getPublishedJobBySlug: pending });
    const { container } = renderRoute(PATH);
    const text = container.querySelector('main').textContent;
    expect(text).not.toMatch(/Cybersecurity Specialist|CAD|responsibilit/i);
  });
});

describe('Job Detail — open role', () => {
  it('renders the title as the only H1, with the company', async () => {
    serveJob(testJob());
    const { container } = renderRoute(PATH);
    expect(await screen.findByRole('heading', { level: 1, name: 'Cybersecurity Specialist' })).toBeTruthy();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByText('Valida')).toBeTruthy();
  });

  it('renders every fact the API actually supplied', async () => {
    serveJob(testJob());
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    ['Location', 'Work Arrangement', 'Employment Type', 'Weekly Hours', 'Compensation'].forEach((label) =>
      expect(screen.getByText(label)).toBeTruthy(),
    );
    expect(screen.getByText('British Columbia, Canada')).toBeTruthy();
    expect(screen.getByText('Fully remote')).toBeTruthy();
    expect(screen.getByText('30 hours per week')).toBeTruthy();
    expect(screen.getByText('CAD 35.00 gross per hour')).toBeTruthy();
  });

  it('invents no placeholder for facts the API omitted', async () => {
    serveJob(testJob({ compensation: undefined, weeklyHours: undefined, schedule: undefined }));
    const { container } = renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText('Compensation')).toBeNull();
    expect(screen.queryByText('Weekly Hours')).toBeNull();
    expect(screen.queryByText('Schedule')).toBeNull();
    expect(container.textContent).not.toMatch(/not specified|N\/A|TBD|—/i);
  });

  it('renders content sections only when their data exists', async () => {
    // preferredQualifications is empty in the base fixture.
    serveJob(testJob());
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('heading', { name: JOB_DETAIL.labels.responsibilities })).toBeTruthy();
    expect(screen.getByRole('heading', { name: JOB_DETAIL.labels.requirements })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: JOB_DETAIL.labels.preferredQualifications })).toBeNull();
  });

  it('renders Preferred Qualifications when the API supplies them', async () => {
    serveJob(testJob({ preferredQualifications: ['Test fixture preferred item.'] }));
    renderRoute(PATH);
    expect(
      await screen.findByRole('heading', { name: JOB_DETAIL.labels.preferredQualifications }),
    ).toBeTruthy();
  });

  it('omits About the Role when there is no description', async () => {
    serveJob(testJob({ description: '' }));
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('heading', { name: JOB_DETAIL.labels.about })).toBeNull();
  });

  it('uses semantic lists for array content', async () => {
    const { container } = (serveJob(testJob()), renderRoute(PATH));
    await screen.findByRole('heading', { level: 1 });
    const section = screen.getByRole('heading', { name: JOB_DETAIL.labels.responsibilities }).closest('section');
    expect(section.querySelector('ul')).toBeTruthy();
    expect(section.querySelectorAll('li').length).toBeGreaterThan(0);
    expect(container).toBeTruthy();
  });

  it('offers Apply links to the nested apply route, near the top and at the end', async () => {
    serveJob(testJob());
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    const applyLinks = screen.getAllByRole('link', { name: JOB_DETAIL.primaryCta });
    expect(applyLinks.length).toBeGreaterThanOrEqual(2);
    applyLinks.forEach((link) =>
      expect(link.getAttribute('href')).toBe(`/careers/${SLUG}/apply`),
    );
  });

  it('provides a breadcrumb back to Careers', async () => {
    serveJob(testJob());
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: JOB_DETAIL.breadcrumbRoot }).getAttribute('href')).toBe('/careers');
  });

  it('sets the canonical dynamic metadata and stays indexable', async () => {
    serveJob(testJob());
    renderRoute(PATH);

    await screen.findByRole('heading', {
      level: 1,
      name: 'Cybersecurity Specialist',
    });

    await waitFor(() => {
      expect(document.title).toBe(jobDetailTitle('Cybersecurity Specialist'));

      expect(
        document
          .querySelector('meta[name="description"]')
          ?.getAttribute('content'),
      ).toBe(jobDetailDescription('Cybersecurity Specialist'));

      expect(
        document
          .querySelector('meta[name="robots"]')
          ?.getAttribute('content') ?? null,
      ).toBeNull();
    });
  });

  it('never renders an unpopulated template token', async () => {
    serveJob(testJob());
    const { container } = renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    expect(container.textContent).not.toMatch(/\{job\.|\{file\.|\{allowed/);
  });

  it('handles a very long title without losing the Apply action', async () => {
    const longTitle = 'Senior Principal Cybersecurity and Secure Platform Infrastructure Engineering Specialist';
    serveJob(testJob({ title: longTitle }));
    renderRoute(PATH);
    expect(await screen.findByRole('heading', { level: 1, name: longTitle })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: JOB_DETAIL.primaryCta }).length).toBeGreaterThan(0);
  });
});

describe('Job Detail — closed role', () => {
  const closedJob = () =>
    testJob({ applicationStatus: 'CLOSED', applicationForm: null, closesAt: '2026-09-01T00:00:00.000Z' });

  it('shows the Applications Closed status and canonical explanation', async () => {
    serveJob(closedJob());
    renderRoute(PATH);
    expect(await screen.findByTestId('job-closed-banner')).toHaveProperty(
      'textContent',
      JOB_DETAIL.closed.status,
    );
    expect(screen.getByRole('heading', { name: JOB_DETAIL.closed.heading })).toBeTruthy();
  });

  it('removes every Apply CTA and route to the apply form', async () => {
    serveJob(closedJob());
    const { container } = renderRoute(PATH);
    await screen.findByTestId('job-closed-banner');
    expect(screen.queryByRole('link', { name: JOB_DETAIL.primaryCta })).toBeNull();
    expect(container.querySelector(`a[href="/careers/${SLUG}/apply"]`)).toBeNull();
  });

  it('offers View Open Roles instead', async () => {
    serveJob(closedJob());
    renderRoute(PATH);
    await screen.findByTestId('job-closed-banner');
    expect(screen.getAllByRole('link', { name: JOB_DETAIL.closed.cta }).length).toBeGreaterThan(0);
  });

  it('never claims the position is open', async () => {
    serveJob(closedJob());
    const { container } = renderRoute(PATH);
    await screen.findByTestId('job-closed-banner');
    expect(container.querySelector('main').textContent).not.toMatch(/accepting applications now|apply for this role/i);
  });

  it('is marked noindex, follow', async () => {
    serveJob(closedJob());
    renderRoute(PATH);
    await screen.findByTestId('job-closed-banner');
    expect(document.querySelector('meta[name="robots"]').getAttribute('content')).toBe('noindex, follow');
  });
});

describe('Job Detail — unavailable and error', () => {
  it('shows the neutral unavailable state for a 404', async () => {
    failWith(httpError(404, 'JOB_NOT_FOUND'));
    renderRoute(PATH);
    const block = await screen.findByTestId('job-unavailable');
    expect(within(block).getByText(JOB_DETAIL.notFound.heading)).toBeTruthy();
    expect(within(block).getByRole('link', { name: JOB_DETAIL.notFound.primary })).toBeTruthy();
    expect(within(block).getByRole('link', { name: JOB_DETAIL.notFound.secondary })).toBeTruthy();
  });

  it('reveals no internal job state', async () => {
    failWith(httpError(404, 'JOB_NOT_FOUND'));
    const { container } = renderRoute(PATH);
    await screen.findByTestId('job-unavailable');
    const text = container.textContent;
    [/draft/i, /archived/i, /_id/, /mongo/i, /unpublished/i].forEach((p) => expect(text).not.toMatch(p));
  });

  it('shows the error state — not "not found" — for a service failure', async () => {
    failWith(httpError(503, 'SERVICE_UNAVAILABLE'));
    renderRoute(PATH);
    const block = await screen.findByTestId('job-error');
    expect(within(block).getByText(JOB_DETAIL.error.heading)).toBeTruthy();
    expect(screen.queryByTestId('job-unavailable')).toBeNull();
  });

  it('shows the error state for a network failure', async () => {
    failWith(networkError());
    renderRoute(PATH);
    expect(await screen.findByTestId('job-error')).toBeTruthy();
  });

  it('retries with a genuinely new request', async () => {
    let calls = 0;
    installJobsService({
      getPublishedJobBySlug: async () => {
        calls += 1;
        if (calls === 1) throw httpError(503, 'SERVICE_UNAVAILABLE');
        return { job: testJob() };
      },
    });
    renderRoute(PATH);
    const block = await screen.findByTestId('job-error');
    await userEvent.click(within(block).getByRole('button', { name: JOB_DETAIL.error.primary }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Cybersecurity Specialist' })).toBeTruthy();
    expect(calls).toBe(2);
  });

  it('leaks no stack trace or internal error text', async () => {
    failWith(httpError(500, 'INTERNAL_ERROR'));
    const { container } = renderRoute(PATH);
    await screen.findByTestId('job-error');
    expect(container.textContent).not.toMatch(/stack|at \/|Error:|ECONNREFUSED/i);
  });
});

describe('Job Detail — accessibility', () => {
  it('has no axe violations for an open role', async () => {
    serveJob(testJob());
    const { container } = renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });

  it('has no axe violations for a closed role', async () => {
    serveJob(testJob({ applicationStatus: 'CLOSED', applicationForm: null }));
    const { container } = renderRoute(PATH);
    await screen.findByTestId('job-closed-banner');
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });

  it('has no axe violations for the unavailable state', async () => {
    failWith(httpError(404, 'JOB_NOT_FOUND'));
    const { container } = renderRoute(PATH);
    await screen.findByTestId('job-unavailable');
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });
});
