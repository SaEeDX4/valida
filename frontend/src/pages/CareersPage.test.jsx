import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoute, installJobsService, resetServices, httpError, networkError, pending, testJob } from '../test/renderRoute.jsx';
import { findAccessibilityViolations } from '../test/axe.js';
import { CAREERS_META, CAREERS_HERO, OPEN_ROLES } from './CareersPage.content.js';

beforeEach(() => {
  window.scrollTo = vi.fn();
});
afterEach(() => resetServices());

describe('Careers — canonical content', () => {
  it('renders the canonical H1 and hero copy', async () => {
    installJobsService({ getPublishedJobs: async () => ({ items: [] }) });
    renderRoute('/careers');
    expect(screen.getByRole('heading', { level: 1, name: CAREERS_HERO.heading })).toBeTruthy();
    expect(screen.getByText(CAREERS_HERO.body)).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('careers-empty')).toBeTruthy());
  });

  it('renders exactly one H1 and the canonical Open Roles heading', async () => {
    installJobsService({ getPublishedJobs: async () => ({ items: [] }) });
    const { container } = renderRoute('/careers');
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: OPEN_ROLES.heading })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('careers-empty')).toBeTruthy());
  });

  it('sets the canonical title and description', async () => {
    installJobsService({ getPublishedJobs: async () => ({ items: [] }) });
    renderRoute('/careers');
    expect(document.title).toBe(CAREERS_META.title);
    expect(document.querySelector('meta[name="description"]').getAttribute('content')).toBe(
      CAREERS_META.description,
    );
    await waitFor(() => expect(screen.getByTestId('careers-empty')).toBeTruthy());
  });
});

describe('Careers — data states', () => {
  it('shows the loading state while the request is in flight', () => {
    installJobsService({ getPublishedJobs: pending });
    renderRoute('/careers');
    expect(screen.getByTestId('careers-loading')).toBeTruthy();
    expect(screen.getByText(OPEN_ROLES.loadingStatus)).toBeTruthy();
    // Hero and static context stay visible during loading.
    expect(screen.getByRole('heading', { level: 1, name: CAREERS_HERO.heading })).toBeTruthy();
  });

  it('puts no fake title inside the loading skeletons', () => {
    installJobsService({ getPublishedJobs: pending });
    const { container } = renderRoute('/careers');
    const skeleton = screen.getByTestId('careers-loading');
    expect(skeleton.textContent.replace(OPEN_ROLES.loadingStatus, '').trim()).toBe('');
    expect(container.textContent).not.toMatch(/Cybersecurity Specialist/);
  });

  it('renders one published role', async () => {
    installJobsService({ getPublishedJobs: async () => ({ items: [testJob()] }) });
    renderRoute('/careers');
    const list = await screen.findByTestId('careers-job-list');
    // Direct children only: each JobRow nests a fact list of its own.
    expect(list.children).toHaveLength(1);
    expect(within(list).getByRole('heading', { level: 3, name: 'Cybersecurity Specialist' })).toBeTruthy();
  });

  it('renders multiple roles with distinct accessible links to the right routes', async () => {
    installJobsService({
      getPublishedJobs: async () => ({
        items: [testJob(), testJob({ title: 'Platform Engineer', slug: 'platform-engineer' })],
      }),
    });
    renderRoute('/careers');
    const list = await screen.findByTestId('careers-job-list');
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links.map((l) => l.getAttribute('aria-label'))).toEqual([
      'View Cybersecurity Specialist role',
      'View Platform Engineer role',
    ]);
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/careers/cybersecurity-specialist',
      '/careers/platform-engineer',
    ]);
  });

  it('uses semantic list markup for roles', async () => {
    installJobsService({ getPublishedJobs: async () => ({ items: [testJob()] }) });
    renderRoute('/careers');
    const list = await screen.findByTestId('careers-job-list');
    expect(list.tagName).toBe('UL');
    expect(list.querySelector('li')).toBeTruthy();
  });

  it('omits facts the API did not supply instead of inventing them', async () => {
    installJobsService({
      getPublishedJobs: async () => ({
        items: [testJob({ compensation: undefined, weeklyHours: undefined, employmentType: undefined })],
      }),
    });
    renderRoute('/careers');
    const list = await screen.findByTestId('careers-job-list');
    expect(list.textContent).not.toMatch(/CAD|hours per week|Part time|not specified|N\/A|—/i);
    expect(list.textContent).toContain('British Columbia, Canada');
  });

  it('shows the empty state ONLY for a successful response with zero items', async () => {
    installJobsService({ getPublishedJobs: async () => ({ items: [] }) });
    renderRoute('/careers');
    const empty = await screen.findByTestId('careers-empty');
    expect(within(empty).getByText(OPEN_ROLES.empty.heading)).toBeTruthy();
    expect(screen.queryByTestId('careers-error')).toBeNull();
  });
});

describe('Careers — failures are never empty states', () => {
  it.each([
    ['503 service unavailable', () => httpError(503, 'SERVICE_UNAVAILABLE')],
    ['network failure', () => networkError()],
    ['malformed payload', () => httpError(200, null)],
  ])('shows the error state for %s', async (_label, makeError) => {
    installJobsService({
      getPublishedJobs: async () => {
        throw makeError();
      },
    });
    renderRoute('/careers');
    const errorBlock = await screen.findByTestId('careers-error');
    expect(within(errorBlock).getByText(OPEN_ROLES.error.heading)).toBeTruthy();
    // The decisive assertion: a failure must never read as "no open roles".
    expect(screen.queryByTestId('careers-empty')).toBeNull();
    expect(screen.queryByText(OPEN_ROLES.empty.heading)).toBeNull();
  });

  it('retries with a genuinely new request and can recover', async () => {
    let calls = 0;
    installJobsService({
      getPublishedJobs: async () => {
        calls += 1;
        if (calls === 1) throw httpError(503, 'SERVICE_UNAVAILABLE');
        return { items: [testJob()] };
      },
    });
    renderRoute('/careers');
    const errorBlock = await screen.findByTestId('careers-error');
    await userEvent.click(within(errorBlock).getByRole('button', { name: OPEN_ROLES.error.retry }));
    await screen.findByTestId('careers-job-list');
    expect(calls).toBe(2);
  });

  it('does not retry on its own', async () => {
    let calls = 0;
    installJobsService({
      getPublishedJobs: async () => {
        calls += 1;
        throw httpError(503, 'SERVICE_UNAVAILABLE');
      },
    });
    renderRoute('/careers');
    await screen.findByTestId('careers-error');
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(calls).toBe(1);
  });

  it('states no role count when loading fails', async () => {
    installJobsService({
      getPublishedJobs: async () => {
        throw networkError();
      },
    });
    const { container } = renderRoute('/careers');
    await screen.findByTestId('careers-error');
    expect(container.querySelector('main').textContent).not.toMatch(/\b0 roles?\b|\bno positions\b/i);
  });
});

describe('Careers — accessibility', () => {
  it('has no axe violations with roles listed', async () => {
    installJobsService({ getPublishedJobs: async () => ({ items: [testJob()] }) });
    const { container } = renderRoute('/careers');
    await screen.findByTestId('careers-job-list');
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });

  it('has no axe violations in the error state', async () => {
    installJobsService({
      getPublishedJobs: async () => {
        throw networkError();
      },
    });
    const { container } = renderRoute('/careers');
    await screen.findByTestId('careers-error');
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });
});
