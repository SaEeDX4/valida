import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  renderRoute, installJobsService, installApplicationsService, resetServices, pending, testJob,
} from '../test/renderRoute.jsx';
import { findAccessibilityViolations } from '../test/axe.js';

/**
 * ApplyLayout (Doc 08 section 23, Doc 05 sections 107-111).
 *
 * Apply renders in a simplified shell; every other route keeps PublicLayout.
 * These tests pin that boundary from both sides, because the failure that
 * matters is silent: the Apply page would still work if it fell back into the
 * marketing shell, it would just stop being distraction-free.
 */
const APPLY = '/careers/cybersecurity-specialist/apply';
const PUBLIC_ROUTES = ['/', '/about', '/careers', '/careers/cybersecurity-specialist', '/privacy', '/legal', '/nope'];

const primaryNav = () => screen.queryByRole('navigation', { name: 'Primary' });
const applicationNav = () => screen.queryByRole('navigation', { name: 'Application' });
const banner = () => screen.getByRole('banner');

beforeEach(() => {
  window.scrollTo = vi.fn();
  installJobsService({
    getPublishedJobs: pending,
    getPublishedJobBySlug: async () => ({ job: testJob() }),
  });
});
afterEach(() => resetServices());

describe('ApplyLayout — the boundary', () => {
  it('renders Apply in the Apply-specific shell', async () => {
    renderRoute(APPLY);
    await screen.findByRole('heading', { level: 1, name: /Apply for/ });
    expect(applicationNav()).toBeTruthy();
    expect(primaryNav()).toBeNull();
  });

  it.each(PUBLIC_ROUTES)('%s still uses PublicLayout', async (path) => {
    const { container } = renderRoute(path);
    // Wait for the route to settle: Job Detail resolves its job asynchronously,
    // and asserting before that lands left a state update outside act().
    await waitFor(() => expect(container.querySelector('main h1')).toBeTruthy());
    expect(primaryNav()).toBeTruthy();
    expect(applicationNav()).toBeNull();
  });

  it('supports direct entry to Apply', async () => {
    const { container } = renderRoute(APPLY);
    await screen.findByRole('heading', { level: 1, name: /Apply for/ });
    expect(container.querySelector('form')).toBeTruthy();
  });
});

describe('ApplyLayout — simplified header', () => {
  it('does not expose the marketing navigation', async () => {
    renderRoute(APPLY);
    await screen.findByRole('heading', { level: 1 });
    const header = banner();
    // None of the primary marketing destinations or the global CTA.
    expect(within(header).queryByRole('link', { name: 'About' })).toBeNull();
    expect(within(header).queryByRole('link', { name: 'Home' })).toBeNull();
    expect(within(header).queryByRole('link', { name: 'Explore Careers' })).toBeNull();
    // No mobile menu either.
    expect(within(header).queryByRole('button', { name: /menu/i })).toBeNull();
  });

  it('keeps only the brand and one way back', async () => {
    renderRoute(APPLY);
    await screen.findByRole('heading', { level: 1 });
    const links = within(banner()).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('aria-label') ?? l.textContent.trim())).toEqual([
      'Valida — Home',
      'Back to Careers',
    ]);
  });

  it('navigates back to Careers from the header', async () => {
    const user = userEvent.setup();
    renderRoute(APPLY);
    await screen.findByRole('heading', { level: 1 });
    await user.click(within(banner()).getByRole('link', { name: 'Back to Careers' }));
    expect(await screen.findByRole('heading', { level: 1, name: /Work on technology/ })).toBeTruthy();
    // Back in the public shell.
    expect(primaryNav()).toBeTruthy();
  });

  it('navigates Home from the brand logo', async () => {
    const user = userEvent.setup();
    renderRoute(APPLY);
    await screen.findByRole('heading', { level: 1 });
    await user.click(within(banner()).getByRole('link', { name: 'Valida — Home' }));
    expect(await screen.findByRole('heading', { level: 1, name: /Secure systems/ })).toBeTruthy();
  });

  it('keeps the job-specific Back to Role link in the page itself', async () => {
    renderRoute(APPLY);
    await screen.findByRole('heading', { level: 1 });
    const main = screen.getByRole('main');
    expect(within(main).getByRole('link', { name: 'Back to Cybersecurity Specialist' })).toBeTruthy();
  });
});

describe('ApplyLayout — region persistence', () => {
  it('carries an explicit region through Back to Careers', async () => {
    renderRoute(`${APPLY}?region=DE`);
    await screen.findByRole('heading', { level: 1 });
    expect(within(banner()).getByRole('link', { name: 'Back to Careers' }).getAttribute('href')).toBe(
      '/careers?region=DE',
    );
  });

  it('keeps the URL clean when no region is set', async () => {
    renderRoute(APPLY);
    await screen.findByRole('heading', { level: 1 });
    expect(within(banner()).getByRole('link', { name: 'Back to Careers' }).getAttribute('href')).toBe('/careers');
  });

  it('keeps the region on the page Back to Role link as well', async () => {
    renderRoute(`${APPLY}?region=DE`);
    await screen.findByRole('heading', { level: 1 });
    const back = within(screen.getByRole('main')).getByRole('link', { name: 'Back to Cybersecurity Specialist' });
    expect(back.getAttribute('href')).toBe('/careers/cybersecurity-specialist?region=DE');
  });

  it('adds no region to the legal links', async () => {
    renderRoute(`${APPLY}?region=DE`);
    await screen.findByRole('heading', { level: 1 });
    const legal = screen.getByRole('navigation', { name: 'Legal' });
    expect(within(legal).getByRole('link', { name: 'Privacy' }).getAttribute('href')).toBe('/privacy');
    expect(within(legal).getByRole('link', { name: 'Legal' }).getAttribute('href')).toBe('/legal');
  });
});

describe('ApplyLayout — reduced footer', () => {
  it('keeps the legal links and ownership line only', async () => {
    renderRoute(APPLY);
    await screen.findByRole('heading', { level: 1 });
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('link', { name: 'Privacy' })).toBeTruthy();
    expect(within(footer).getByRole('link', { name: 'Legal' })).toBeTruthy();
    expect(footer.textContent).toMatch(/Valida MB\. All rights reserved\./);
    // The full marketing footer's Company group and description are absent.
    expect(within(footer).queryByRole('navigation', { name: 'Company' })).toBeNull();
    expect(within(footer).queryByRole('link', { name: 'About' })).toBeNull();
  });
});

describe('ApplyLayout — keyboard and focus', () => {
  it('keeps the skip link first and pointing at main', async () => {
    const { container } = renderRoute(APPLY);
    await screen.findByRole('heading', { level: 1 });
    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skip.getAttribute('href')).toBe('#main-content');
    expect(container.querySelector('main').id).toBe('main-content');
    expect(container.querySelector('a[href], button, input, select, textarea')).toBe(skip);
  });

  it('reaches the brand, then Back to Careers, by keyboard', async () => {
    const user = userEvent.setup();
    renderRoute(APPLY);
    await screen.findByRole('heading', { level: 1 });
    await user.tab(); // skip link
    await user.tab();
    expect(document.activeElement).toBe(within(banner()).getByRole('link', { name: 'Valida — Home' }));
    await user.tab();
    expect(document.activeElement).toBe(within(banner()).getByRole('link', { name: 'Back to Careers' }));
  });

  it('moves focus to main when navigating out of Apply', async () => {
    const user = userEvent.setup();
    renderRoute(APPLY);
    await screen.findByRole('heading', { level: 1 });
    await user.click(within(banner()).getByRole('link', { name: 'Back to Careers' }));
    await screen.findByRole('heading', { level: 1, name: /Work on technology/ });
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('main-content')));
  });
});

describe('ApplyLayout — focus across the layout boundary', () => {
  /*
   * Both directions cross from one shell to the other. Before the single
   * route-change handler was lifted above the layouts, each crossing mounted a
   * fresh handler that treated the navigation as a first render, and focus
   * fell to <body>.
   */
  it('moves focus to main when entering Apply from Job Detail', async () => {
    const user = userEvent.setup();
    renderRoute('/careers/cybersecurity-specialist');
    await screen.findByRole('heading', { level: 1, name: 'Cybersecurity Specialist' });
    const [apply] = screen.getAllByRole('link', { name: 'Apply for This Role' });
    await user.click(apply);
    await screen.findByRole('heading', { level: 1, name: /Apply for/ });
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('main-content')));
    expect(document.activeElement).not.toBe(document.body);
  });

  it('never strands focus on body when leaving Apply', async () => {
    const user = userEvent.setup();
    renderRoute(APPLY);
    await screen.findByRole('heading', { level: 1 });
    await user.click(within(banner()).getByRole('link', { name: 'Valida — Home' }));
    await screen.findByRole('heading', { level: 1, name: /Secure systems/ });
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  });
});

describe('ApplyLayout — accessibility', () => {
  it('has no axe violations with the form loaded', async () => {
    const { container } = renderRoute(APPLY);
    await screen.findByRole('heading', { level: 1 });
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });

  it('has no axe violations with validation errors shown', async () => {
    installApplicationsService({ submitApplication: vi.fn() });
    const user = userEvent.setup();
    const { container } = renderRoute(APPLY);
    await screen.findByRole('heading', { level: 1 });
    await user.click(screen.getByRole('button', { name: /Submit Application/i }));
    await screen.findByTestId('validation-summary');
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });

  it('exposes exactly one banner, main and contentinfo', async () => {
    const { container } = renderRoute(APPLY);
    await screen.findByRole('heading', { level: 1 });
    expect(container.querySelectorAll('header')).toHaveLength(1);
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelectorAll('footer')).toHaveLength(1);
  });
});
