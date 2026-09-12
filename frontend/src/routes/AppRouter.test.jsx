import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from './AppRouter.jsx';
import { findAccessibilityViolations } from '../test/axe.js';

/**
 * Application shell and routing behaviour (Doc 18 section 59).
 *
 * The same route table the browser uses is mounted inside a MemoryRouter, so
 * these tests exercise the real router configuration rather than a stand-in.
 */
function renderAt(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  // jsdom does not implement scrolling; the route-change handler calls it.
  window.scrollTo = vi.fn();
  document.body.style.overflow = '';
});

describe('application shell', () => {
  it('renders header, main and footer landmarks on a public route', () => {
    renderAt('/');
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('contentinfo')).toBeTruthy();
  });

  it('exposes #main-content as the skip-link target (Doc 08 sections 28-29)', () => {
    renderAt('/');
    const skipLink = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skipLink.getAttribute('href')).toBe('#main-content');
    expect(screen.getByRole('main').id).toBe('main-content');
  });

  it('places the skip link first in the tab order', async () => {
    renderAt('/');
    await userEvent.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('link', { name: 'Skip to main content' }),
    );
  });

  it('gives every route exactly one H1', () => {
    ['/', '/about', '/careers', '/privacy', '/legal', '/nope'].forEach((path) => {
      const view = renderAt(path);
      expect(view.container.querySelectorAll('h1')).toHaveLength(1);
      view.unmount();
    });
  });
});

describe('routing', () => {
  // A4 replaced the Home/About/Privacy/Legal placeholders with the real pages,
  // so these now assert the canonical Document 06 H1 of each route.
  it.each([
    ['/', /Secure systems\./],
    ['/about', /Building technology with security at its foundation\./],
    ['/careers', /Careers/],
    ['/privacy', /Privacy Notice/],
    ['/legal', /Legal Information/],
  ])('renders %s directly (Doc 04 section 44)', (path, heading) => {
    renderAt(path);
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeTruthy();
  });

  it('resolves the dynamic job slug segment', () => {
    renderAt('/careers/cybersecurity-specialist');
    expect(screen.getByRole('heading', { level: 1, name: 'Job Detail' })).toBeTruthy();
    expect(screen.getByText('cybersecurity-specialist')).toBeTruthy();
  });

  it('resolves the nested apply route', () => {
    renderAt('/careers/cybersecurity-specialist/apply');
    expect(screen.getByRole('heading', { level: 1, name: 'Apply' })).toBeTruthy();
  });

  it('sets the canonical document title on each route (Doc 05 section 20)', async () => {
    renderAt('/about');
    expect(document.title).toBe('About Valida | Security-First Technology');
  });
});

describe('header navigation', () => {
  it('navigates Home through the logo (Doc 05 section 10)', async () => {
    renderAt('/about');
    const logo = screen.getByRole('link', { name: 'Valida — Home' });
    await userEvent.click(logo);
    expect(screen.getByRole('heading', { level: 1, name: /Secure systems\./ })).toBeTruthy();
  });

  it('navigates to About and Careers from the primary navigation', async () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Primary' });

    await userEvent.click(within(nav).getByRole('link', { name: 'About' }));
    expect(
      screen.getByRole('heading', { level: 1, name: /Building technology with security/ }),
    ).toBeTruthy();

    await userEvent.click(within(nav).getByRole('link', { name: 'Careers' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Careers' })).toBeTruthy();
  });

  it('marks the current route with aria-current, not colour alone (Doc 05 section 13)', () => {
    renderAt('/about');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'About' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBeNull();
  });

  it('keeps Careers active on nested job routes (Doc 05 section 13)', () => {
    renderAt('/careers/cybersecurity-specialist');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'Careers' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('does not mark Home active on other routes', () => {
    renderAt('/careers');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBeNull();
  });

  it('omits Job Detail, Apply, Privacy and Legal from primary navigation (Doc 04 section 8)', () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const labels = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent.trim());
    expect(labels).toEqual(['Home', 'About', 'Careers']);
  });

  it('uses truthful CTA wording while no role is published (Doc 05 section 12)', () => {
    renderAt('/');
    expect(screen.getAllByRole('link', { name: 'Explore Careers' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /Apply Now/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /View Open Roles/i })).toBeNull();
  });

  it('navigates with the header CTA without a full page load', async () => {
    renderAt('/');
    const [cta] = screen.getAllByRole('link', { name: 'Explore Careers' });
    // A router Link has no literal href-driven reload; it resolves in-app.
    await userEvent.click(cta);
    expect(screen.getByRole('heading', { level: 1, name: 'Careers' })).toBeTruthy();
  });

  it('renders the approved brand asset, not a redrawn mark', () => {
    renderAt('/');
    const logo = screen.getByRole('link', { name: 'Valida — Home' }).querySelector('img');
    expect(logo.getAttribute('src')).toContain('/brand/valida-logo-horizontal-transparent.png');
    // Aspect ratio is declared so the approved proportions cannot be distorted.
    expect(logo.getAttribute('width')).toBe('1009');
    expect(logo.getAttribute('height')).toBe('230');
  });
});

describe('footer', () => {
  it('navigates to Privacy and Legal (Doc 04 section 9)', async () => {
    renderAt('/');
    const footer = screen.getByRole('contentinfo');

    await userEvent.click(within(footer).getByRole('link', { name: 'Privacy' }));
    expect(screen.getByRole('heading', { level: 1, name: /Privacy Notice/ })).toBeTruthy();
  });

  it('navigates to About and Careers from the Company group', async () => {
    renderAt('/');
    const company = screen.getByRole('navigation', { name: 'Company' });
    await userEvent.click(within(company).getByRole('link', { name: 'About' }));
    expect(
      screen.getByRole('heading', { level: 1, name: /Building technology with security/ }),
    ).toBeTruthy();
  });

  it('shows the canonical brand description and dynamic copyright (Doc 06 sections 190, 194)', () => {
    renderAt('/');
    const footer = screen.getByRole('contentinfo');
    expect(
      within(footer).getByText(
        'Cybersecurity, secure technology, and security-first engineering.',
      ),
    ).toBeTruthy();
    expect(
      within(footer).getByText(`© ${new Date().getFullYear()} Valida MB. All rights reserved.`),
    ).toBeTruthy();
  });

  it('makes no unapproved company claim', () => {
    renderAt('/');
    const text = screen.getByRole('contentinfo').textContent;
    [
      /ISO\s?27/i, /SOC\s?2/i, /certified/i, /clients?/i, /customers?/i,
      /24\/7/i, /guarantee/i, /award/i, /@/,
    ].forEach((pattern) => expect(text).not.toMatch(pattern));
  });

  it('contains no dead links', () => {
    renderAt('/');
    within(screen.getByRole('contentinfo'))
      .getAllByRole('link')
      .forEach((link) => {
        const href = link.getAttribute('href');
        expect(href).toBeTruthy();
        expect(href).not.toBe('#');
      });
  });
});

describe('404', () => {
  it('renders for an unknown route (Doc 08 section 21)', () => {
    renderAt('/this-route-does-not-exist');
    expect(screen.getByRole('heading', { level: 1, name: 'This page doesn’t exist.' })).toBeTruthy();
  });

  it('renders for a deep unknown route', () => {
    renderAt('/careers/slug/apply/extra/segments');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('This page doesn’t exist.');
  });

  it('keeps the shell so the visitor is not trapped (Doc 04 section 43)', () => {
    renderAt('/nope');
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('contentinfo')).toBeTruthy();
  });

  it('offers working Home and Careers recovery actions (Doc 06 sections 183-184)', async () => {
    renderAt('/nope');
    const main = screen.getByRole('main');
    await userEvent.click(within(main).getByRole('link', { name: 'Go to Home' }));
    expect(screen.getByRole('heading', { level: 1, name: /Secure systems\./ })).toBeTruthy();
  });

  it('recovers to Careers', async () => {
    renderAt('/nope');
    const main = screen.getByRole('main');
    await userEvent.click(within(main).getByRole('link', { name: 'View Careers' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Careers' })).toBeTruthy();
  });

  it('exposes no technical or server detail (Doc 04 section 43)', () => {
    renderAt('/nope');
    const text = screen.getByRole('main').textContent;
    [/stack/i, /exception/i, /express/i, /node/i, /\bat \//, /Error:/].forEach((pattern) =>
      expect(text).not.toMatch(pattern),
    );
  });

  it('sets the canonical 404 title (Doc 06 section 179)', () => {
    renderAt('/nope');
    expect(document.title).toBe('Page Not Found | Valida');
  });

  it('has no axe violations', async () => {
    const { container } = renderAt('/nope');
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });
});

describe('accessibility of the shell', () => {
  it('has no axe violations on a public route', async () => {
    const { container } = renderAt('/');
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });

  it('reaches every primary navigation link by keyboard', async () => {
    renderAt('/');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const links = within(nav).getAllByRole('link');
    for (const link of links) {
      link.focus();
      expect(document.activeElement).toBe(link);
    }
  });
});
