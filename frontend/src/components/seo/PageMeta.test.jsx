import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '../../routes/AppRouter.jsx';
import { HOME_META } from '../../pages/HomePage.content.js';
import { ABOUT_META } from '../../pages/AboutPage.content.js';
import { PRIVACY_META } from '../../pages/PrivacyPage.content.js';
import { LEGAL_META } from '../../pages/LegalPage.content.js';

/**
 * Route metadata ownership.
 *
 * The route currently on screen owns the description. These tests exercise the
 * transition that used to leave a stale tag behind: an A4 route that publishes
 * a description followed by a route that does not.
 */
function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

const descriptionTags = () => [...document.querySelectorAll('meta[name="description"]')];
const descriptionContent = () => descriptionTags()[0]?.getAttribute('content') ?? null;

beforeEach(() => {
  window.scrollTo = vi.fn();
  descriptionTags().forEach((tag) => tag.remove());
});

describe('PageMeta — description ownership', () => {
  it('sets the description on an A4 route', () => {
    renderAt('/');
    expect(descriptionContent()).toBe(HOME_META.description);
    expect(descriptionTags()).toHaveLength(1);
  });

  it('leaves no stale description when navigating Home -> 404', () => {
    const home = renderAt('/');
    expect(descriptionContent()).toBe(HOME_META.description);
    home.unmount();

    renderAt('/this-route-does-not-exist');
    // The 404 publishes no description, so none may remain from Home.
    expect(descriptionTags()).toHaveLength(0);
  });

  it.each([
    ['/', () => HOME_META.description],
    ['/about', () => ABOUT_META.description],
    ['/privacy', () => PRIVACY_META.description],
    ['/legal', () => LEGAL_META.description],
  ])('leaves no stale description when navigating %s -> Careers placeholder', (path, expected) => {
    const first = renderAt(path);
    expect(descriptionContent()).toBe(expected());
    first.unmount();

    renderAt('/careers');
    expect(descriptionTags()).toHaveLength(0);
  });

  it('updates cleanly between two A4 routes and keeps exactly one tag', () => {
    const home = renderAt('/');
    expect(descriptionContent()).toBe(HOME_META.description);
    home.unmount();

    const about = renderAt('/about');
    expect(descriptionContent()).toBe(ABOUT_META.description);
    expect(descriptionTags()).toHaveLength(1);
    about.unmount();

    renderAt('/legal');
    expect(descriptionContent()).toBe(LEGAL_META.description);
    expect(descriptionTags()).toHaveLength(1);
  });

  it('recovers if duplicate description tags already exist', () => {
    for (let i = 0; i < 3; i += 1) {
      const stray = document.createElement('meta');
      stray.setAttribute('name', 'description');
      stray.setAttribute('content', `stray-${i}`);
      document.head.appendChild(stray);
    }
    renderAt('/about');
    expect(descriptionTags()).toHaveLength(1);
    expect(descriptionContent()).toBe(ABOUT_META.description);
  });

  it('removes every stale tag when moving to a route without a description', () => {
    renderAt('/legal').unmount();
    const stray = document.createElement('meta');
    stray.setAttribute('name', 'description');
    stray.setAttribute('content', 'stale');
    document.head.appendChild(stray);

    renderAt('/careers/some-slug');
    expect(descriptionTags()).toHaveLength(0);
  });

  it('always sets the document title, including on routes without a description', () => {
    renderAt('/nope');
    expect(document.title).toBe('Page Not Found | Valida');
  });
});
