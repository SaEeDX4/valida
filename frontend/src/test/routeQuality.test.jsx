import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  renderRoute, installJobsService, installApplicationsService, resetServices,
  httpError, networkError, pending, testJob,
} from './renderRoute.jsx';
import { findAccessibilityViolations } from './axe.js';

/**
 * A6 route-level quality sweep.
 *
 * A2-A5 exercised accessibility one primitive or one page-state at a time.
 * This suite runs the checks across whole rendered routes, which is where
 * landmark duplication, heading-order breaks and cross-component relationships
 * actually surface.
 *
 * axe cannot evaluate colour contrast under jsdom (no canvas), so contrast is
 * covered separately by the independent computed gate in styles/contrast.test.js.
 * A green axe result here is therefore NOT a claim of full WCAG conformance.
 */

const OPEN_JOB = () => testJob();
const CLOSED_JOB = () => testJob({ applicationStatus: 'CLOSED', applicationForm: null });

/** Every public route/state A6 must sweep, with the service each one needs. */
const ROUTES = [
  ['Home', '/', () => {}],
  ['About', '/about', () => {}],
  ['Privacy', '/privacy', () => {}],
  ['Legal', '/legal', () => {}],
  ['404', '/no-such-route', () => {}],
  ['Careers — jobs', '/careers', () => installJobsService({ getPublishedJobs: async () => ({ items: [OPEN_JOB()] }) })],
  ['Careers — empty', '/careers', () => installJobsService({ getPublishedJobs: async () => ({ items: [] }) })],
  ['Careers — error', '/careers', () => installJobsService({ getPublishedJobs: async () => { throw networkError(); } })],
  ['Careers — loading', '/careers', () => installJobsService({ getPublishedJobs: pending })],
  ['Job Detail — open', '/careers/cybersecurity-specialist', () => installJobsService({ getPublishedJobBySlug: async () => ({ job: OPEN_JOB() }) })],
  ['Job Detail — closed', '/careers/cybersecurity-specialist', () => installJobsService({ getPublishedJobBySlug: async () => ({ job: CLOSED_JOB() }) })],
  ['Job Detail — unavailable', '/careers/nope', () => installJobsService({ getPublishedJobBySlug: async () => { throw httpError(404, 'JOB_NOT_FOUND'); } })],
  ['Job Detail — error', '/careers/cybersecurity-specialist', () => installJobsService({ getPublishedJobBySlug: async () => { throw networkError(); } })],
  ['Apply — default', '/careers/cybersecurity-specialist/apply', () => installJobsService({ getPublishedJobBySlug: async () => ({ job: OPEN_JOB() }) })],
];

/**
 * Waits for the route to settle into its rendered state.
 *
 * It must look for a heading INSIDE <main>. The footer always renders its own
 * "Company" and "Legal" headings, so waiting for any heading resolved
 * immediately — before Apply's job request finished — and the late state update
 * then landed outside act(). Every settled route state renders a heading in
 * main, including the intentional Careers loading state, whose hero is present
 * while the list loads.
 */
async function settle() {
  await waitFor(
    () => {
      const main = document.querySelector('main');
      expect(main?.querySelector('h1, h2')).toBeTruthy();
    },
    { timeout: 3000 },
  );
}

beforeEach(() => {
  window.scrollTo = vi.fn();
});
afterEach(() => resetServices());

describe('A6 — route-level accessibility sweep', () => {
  it.each(ROUTES)('%s has no axe violations', async (_label, path, install) => {
    install();
    const { container } = renderRoute(path);
    await settle();
    const violations = await findAccessibilityViolations(container);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});

describe('A6 — landmark and heading structure', () => {
  it.each(ROUTES)('%s exposes exactly one banner, main and contentinfo', async (_label, path, install) => {
    install();
    const { container } = renderRoute(path);
    await settle();
    expect(container.querySelectorAll('header')).toHaveLength(1);
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelectorAll('footer')).toHaveLength(1);
  });

  it.each(ROUTES)('%s has exactly one H1 and never skips a heading level', async (_label, path, install) => {
    install();
    const { container } = renderRoute(path);
    await settle();
    const main = container.querySelector('main');
    /*
     * EXACTLY one. "At most one" also passed a page with no primary heading at
     * all, so it could not detect the regression that matters most. Every
     * settled state in ROUTES renders a canonical H1; the two states that
     * legitimately do not are covered explicitly in the loading-state suite.
     */
    expect(main.querySelectorAll('h1')).toHaveLength(1);

    const levels = [...main.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => Number(h.tagName[1]));
    levels.forEach((level, index) => {
      if (index > 0) expect(level - levels[index - 1]).toBeLessThanOrEqual(1);
    });
  });

  it.each(ROUTES)('%s keeps the skip link first and pointing at main', async (_label, path, install) => {
    install();
    const { container } = renderRoute(path);
    await settle();
    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skip.getAttribute('href')).toBe('#main-content');
    expect(container.querySelector('main').id).toBe('main-content');
    // First focusable element in the document.
    const focusable = container.querySelectorAll('a[href], button, input, select, textarea');
    expect(focusable[0]).toBe(skip);
  });

  it.each(ROUTES)('%s renders no empty link or button name', async (_label, path, install) => {
    install();
    const { container } = renderRoute(path);
    await settle();
    [...container.querySelectorAll('a[href], button')].forEach((el) => {
      const name = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim();
      expect(name.length, `empty accessible name on <${el.tagName.toLowerCase()}>`).toBeGreaterThan(0);
    });
  });

  it.each(ROUTES)('%s has no dead href', async (_label, path, install) => {
    install();
    const { container } = renderRoute(path);
    await settle();
    [...container.querySelectorAll('a')].forEach((a) => {
      const href = a.getAttribute('href');
      if (href === null) return; // an intentionally disabled navigating control
      expect(href).not.toBe('#');
      expect(href).not.toBe('');
      expect(href).not.toMatch(/javascript:/i);
    });
  });
});

describe('A6 — form control relationships on Apply', () => {
  it('labels every visible control and wires every error', async () => {
    installJobsService({ getPublishedJobBySlug: async () => ({ job: OPEN_JOB() }) });
    installApplicationsService({ submitApplication: vi.fn() });
    const user = userEvent.setup();
    const { container } = renderRoute('/careers/cybersecurity-specialist/apply');
    await screen.findByRole('heading', { level: 1 });

    // Every control has an accessible name before any interaction.
    [...container.querySelectorAll('input, select, textarea')].forEach((el) => {
      if (el.type === 'radio') return; // named by its fieldset legend
      const labelled =
        el.getAttribute('aria-label') ||
        (el.id && container.querySelector(`label[for="${el.id}"]`));
      expect(labelled, `unlabelled control #${el.id || el.name}`).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: /Submit Application/i }));
    await screen.findByTestId('validation-summary');

    // Every invalid control points at a message that exists in the document.
    [...container.querySelectorAll('[aria-invalid="true"]')].forEach((el) => {
      const describedBy = el.getAttribute('aria-describedby');
      expect(describedBy, 'aria-invalid without aria-describedby').toBeTruthy();
      const targets = describedBy.split(' ').map((id) => document.getElementById(id));
      expect(targets.some(Boolean)).toBe(true);
    });
  });

  it('uses autocomplete on the identity fields', async () => {
    installJobsService({ getPublishedJobBySlug: async () => ({ job: OPEN_JOB() }) });
    renderRoute('/careers/cybersecurity-specialist/apply');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByLabelText(/Full Name/).getAttribute('autocomplete')).toBe('name');
    expect(screen.getByLabelText(/Email Address/).getAttribute('autocomplete')).toBe('email');
  });

  it('keeps the file input keyboard reachable with no drag-only upload route', async () => {
    installJobsService({ getPublishedJobBySlug: async () => ({ job: OPEN_JOB() }) });
    const { container } = renderRoute('/careers/cybersecurity-specialist/apply');
    await screen.findByRole('heading', { level: 1 });
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeTruthy();
    // Not removed from the tab order, and driven by a real label.
    expect(input.getAttribute('tabindex')).toBeNull();
    expect(container.querySelector(`label[for="${input.id}"]`)).toBeTruthy();
    // No drag-and-drop-only affordance exists.
    expect(container.querySelector('[ondrop]')).toBeNull();
  });
});


/**
 * EXPLICIT EXCEPTION — transient loading states with no H1.
 *
 * Job Detail and Apply load their Job before anything role-specific can be
 * shown. Their only possible H1 is the job title, which is not known yet, and
 * truth control forbids a placeholder or fake title (Doc 05 section 54, Doc 06
 * section 103). Generic invented heading copy would be equally non-canonical.
 *
 * So these two states deliberately render no H1 and communicate through the
 * canonical live-region status instead. They are listed here by name. The
 * boundary is enforced by the ROUTES suite, where every other state must have
 * EXACTLY one H1 — not by a test on this list itself, which would only test
 * the test.
 *
 * Careers is NOT an exception — its hero H1 renders while the list loads.
 */
const LOADING_WITHOUT_H1 = [
  ['Job Detail — loading', '/careers/cybersecurity-specialist', 'Loading role details…'],
  ['Apply — loading', '/careers/cybersecurity-specialist/apply', 'Loading role details…'],
];

describe('A6 — explicit H1 exception for transient loading states', () => {
  it.each(LOADING_WITHOUT_H1)('%s renders no H1 rather than a fake title', (_label, path) => {
    installJobsService({ getPublishedJobBySlug: pending });
    const { container } = renderRoute(path);
    const main = container.querySelector('main');
    expect(main.querySelectorAll('h1')).toHaveLength(0);
    // No invented role name leaks into the loading state.
    expect(main.textContent).not.toMatch(/Cybersecurity Specialist/);
  });

  it.each(LOADING_WITHOUT_H1)('%s is never silent — it announces the canonical status', (_label, path, status) => {
    installJobsService({ getPublishedJobBySlug: pending });
    renderRoute(path);
    const region = screen.getByText(status);
    expect(region.closest('[role="status"]')).toBeTruthy();
  });

  it.each(LOADING_WITHOUT_H1)('%s has no axe violations', async (_label, path) => {
    installJobsService({ getPublishedJobBySlug: pending });
    const { container } = renderRoute(path);
    const violations = await findAccessibilityViolations(container);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

});
