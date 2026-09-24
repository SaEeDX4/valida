import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  renderRoute, installJobsService, resetServices, pending, testJob,
} from './renderRoute.jsx';
import { MARKET } from '../features/jobs/markets.js';

/**
 * A6 keyboard and focus baseline.
 *
 * Complements the per-component focus tests from A3-A5 (mobile menu Escape and
 * focus return, Apply validation-summary focus, resume focus proxy) with the
 * route-level behaviours those suites do not cover.
 *
 * This proves focus MOVEMENT and ORDER. Whether the focus ring is visible on a
 * real display is a browser check in the A6 QA matrix.
 */
const PUBLIC_ROUTES = ['/', '/about', '/careers', '/privacy', '/legal', '/nope'];

beforeEach(() => {
  window.scrollTo = vi.fn();
  installJobsService({ getPublishedJobs: pending, getPublishedJobBySlug: pending });
});
afterEach(() => resetServices());

describe('A6 — tab order integrity', () => {
  it.each(PUBLIC_ROUTES)('%s uses no positive tabindex anywhere', (path) => {
    const { container } = renderRoute(path);
    // A positive tabindex overrides document order and breaks predictable
    // keyboard navigation.
    const positive = [...container.querySelectorAll('[tabindex]')].filter(
      (el) => Number(el.getAttribute('tabindex')) > 0,
    );
    expect(positive).toEqual([]);
  });

  it.each(PUBLIC_ROUTES)('%s reaches the header navigation by keyboard', async (path) => {
    const user = userEvent.setup();
    renderRoute(path);
    await user.tab(); // skip link
    await user.tab(); // brand logo
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Valida — Home' }));
  });

  it('never leaves keyboard focus on an element hidden from assistive technology', async () => {
    const user = userEvent.setup();
    const { container } = renderRoute('/');
    for (let i = 0; i < 25; i += 1) {
      await user.tab();
      const active = document.activeElement;
      if (!active || active === document.body) break;
      expect(active.closest('[aria-hidden="true"]'), `focus inside aria-hidden: <${active.tagName}>`).toBeNull();
    }
    expect(container).toBeTruthy();
  });
});

describe('A6 — focus on route change', () => {
  it('moves focus to the main landmark after in-app navigation', async () => {
    const user = userEvent.setup();
    renderRoute('/');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    await user.click(within(nav).getByRole('link', { name: 'About' }));
    await screen.findByRole('heading', { level: 1, name: /Building technology/ });
    // Focus is not stranded in the previous page's navigation.
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('main-content')));
  });

  it('keeps main programmatically focusable without adding a tab stop', () => {
    renderRoute('/');
    const main = document.getElementById('main-content');
    expect(main.getAttribute('tabindex')).toBe('-1');
  });
});

describe('A6 — region selector is keyboard operable', () => {
  it('changes the regional view with the keyboard alone', async () => {
    resetServices();
    installJobsService({
      getPublishedJobBySlug: async () => ({
        job: testJob({
          hiringMarkets: [
            { marketId: MARKET.CANADA, countries: ['CA'], locationLabel: 'Canada', compensation: null },
            { marketId: MARKET.EUROPE, countries: ['DE'], compensation: null },
          ],
        }),
      }),
    });
    const user = userEvent.setup();
    renderRoute('/careers/cybersecurity-specialist?region=CA');
    await screen.findByRole('heading', { level: 1 });

    const select = screen.getByLabelText('Change regional view');
    select.focus();
    expect(document.activeElement).toBe(select);
    await user.selectOptions(select, 'DE');
    const facts = screen.getByRole('heading', { name: 'Employment Details' }).closest('aside').querySelector('dl');
    await waitFor(() => expect(within(facts).getByText('Germany')).toBeTruthy());
  });
});
