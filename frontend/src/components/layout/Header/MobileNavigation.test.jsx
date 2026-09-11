import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import MobileNavigation from './MobileNavigation.jsx';
import { findAccessibilityViolations } from '../../../test/axe.js';

/**
 * Mobile navigation behaviour — Doc 05 sections 16-19, Doc 08 sections 25-27.
 *
 * Rendered standalone so the header's viewport toggle cannot hide it. That
 * toggle is Header's concern and is covered there; this file covers the menu's
 * own behaviour.
 */
function renderMenu(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <MobileNavigation />
      <Routes>
        <Route path="/" element={<h1>Home page</h1>} />
        <Route path="/about" element={<h1>About page</h1>} />
        <Route path="/careers" element={<h1>Careers page</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

const trigger = () => screen.getByRole('button', { name: /navigation/i });

beforeEach(() => {
  window.scrollTo = vi.fn();
  document.body.style.overflow = '';
});

describe('mobile navigation', () => {
  it('starts closed with aria-expanded=false', () => {
    renderMenu();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
  });

  it('uses the canonical trigger label (Doc 06 section 9)', () => {
    renderMenu();
    expect(trigger().getAttribute('aria-label')).toBe('Open navigation');
    expect(trigger().textContent).toContain('Menu');
  });

  it('opens the panel and updates aria-expanded and the label', async () => {
    renderMenu();
    await userEvent.click(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-label')).toBe('Close navigation');
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeTruthy();
  });

  it('points aria-controls at the panel it actually opens', async () => {
    renderMenu();
    await userEvent.click(trigger());
    const controlled = trigger().getAttribute('aria-controls');
    expect(document.getElementById(controlled)).toBeTruthy();
  });

  it('contains the primary routes and the CTA (Doc 05 section 17)', async () => {
    renderMenu();
    await userEvent.click(trigger());
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(
      within(nav).getAllByRole('link').map((link) => link.textContent.trim()),
    ).toEqual(['Home', 'About', 'Careers']);
    expect(screen.getByRole('link', { name: 'Explore Careers' })).toBeTruthy();
  });

  it('moves focus to the first navigation link when it opens (Doc 05 sections 15, 18)', async () => {
    renderMenu();
    await userEvent.click(trigger());
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    // A real link, not a tabIndex={-1} wrapper, so the shared focus-visible
    // ring can actually be shown to a keyboard user.
    expect(document.activeElement).toBe(within(nav).getByRole('link', { name: 'Home' }));
  });

  it('does not park focus on a non-indicating wrapper', async () => {
    renderMenu();
    await userEvent.click(trigger());
    const panel = document.getElementById(trigger().getAttribute('aria-controls'));
    expect(document.activeElement).not.toBe(panel);
    expect(panel.getAttribute('tabindex')).toBeNull();
  });

  it('returns focus to the trigger when closed by Escape (Doc 08 section 27)', async () => {
    renderMenu();
    await userEvent.click(trigger());
    // Focus is inside the panel at this point.
    expect(document.activeElement).not.toBe(trigger());
    await userEvent.keyboard('{Escape}');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
  });

  it('restores focus after Escape even when focus moved deeper into the menu', async () => {
    renderMenu();
    await userEvent.click(trigger());
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    within(nav).getByRole('link', { name: 'Careers' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on Escape (Doc 05 section 18)', async () => {
    renderMenu();
    await userEvent.click(trigger());
    await userEvent.keyboard('{Escape}');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
  });

  it('returns focus to the trigger when closed by the button (Doc 08 section 27)', async () => {
    renderMenu();
    await userEvent.click(trigger());
    await userEvent.click(trigger());
    expect(document.activeElement).toBe(trigger());
  });

  it('closes when a route is selected (Doc 05 section 18)', async () => {
    renderMenu();
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole('link', { name: 'About' }));
    expect(screen.getByRole('heading', { name: 'About page' })).toBeTruthy();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes when the link for the CURRENT route is activated', async () => {
    // Already on /careers: the pathname never changes, so a pathname-dependent
    // effect alone would leave the menu open.
    renderMenu('/careers');
    await userEvent.click(trigger());
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    await userEvent.click(within(nav).getByRole('link', { name: 'Careers' }));
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
  });

  it('returns focus to the trigger after activating the current route', async () => {
    renderMenu('/careers');
    await userEvent.click(trigger());
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    await userEvent.click(within(nav).getByRole('link', { name: 'Careers' }));
    // No navigation occurred, so nothing else claims focus; it must not be lost
    // to <body> along with the unmounted link.
    expect(document.activeElement).toBe(trigger());
  });

  it('closes when the CTA for the current route is activated', async () => {
    renderMenu('/careers');
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole('link', { name: 'Explore Careers' }));
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes when Home is activated while already on Home', async () => {
    renderMenu('/');
    await userEvent.click(trigger());
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    await userEvent.click(within(nav).getByRole('link', { name: 'Home' }));
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('still closes on genuine navigation to a different route', async () => {
    renderMenu('/');
    await userEvent.click(trigger());
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    await userEvent.click(within(nav).getByRole('link', { name: 'Careers' }));
    expect(screen.getByRole('heading', { name: 'Careers page' })).toBeTruthy();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('locks background scrolling while open (Doc 08 section 26)', async () => {
    renderMenu();
    expect(document.body.style.overflow).toBe('');
    await userEvent.click(trigger());
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('restores the previous overflow value on close, not a blank one', async () => {
    document.body.style.overflow = 'auto';
    renderMenu();
    await userEvent.click(trigger());
    expect(document.body.style.overflow).toBe('hidden');
    await userEvent.click(trigger());
    expect(document.body.style.overflow).toBe('auto');
  });

  it('never leaves the body locked after unmount (Doc 08 section 26)', async () => {
    const view = renderMenu();
    await userEvent.click(trigger());
    expect(document.body.style.overflow).toBe('hidden');
    view.unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('keeps panel links out of the tab order while closed', async () => {
    renderMenu();
    // The panel is unmounted, not merely hidden, so no invisible tab stop exists.
    expect(screen.queryByRole('link', { name: 'About' })).toBeNull();
  });

  it('opens by keyboard', async () => {
    renderMenu();
    trigger().focus();
    await userEvent.keyboard('{Enter}');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('marks the current route inside the panel', async () => {
    renderMenu('/careers');
    await userEvent.click(trigger());
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'Careers' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('has no axe violations when closed', async () => {
    const { container } = renderMenu();
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });

  it('has no axe violations when open', async () => {
    const { container } = renderMenu();
    await userEvent.click(trigger());
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });
});
