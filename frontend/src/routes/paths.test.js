import { describe, it, expect } from 'vitest';
import { ROUTES, jobRoute, applyRoute } from './paths.js';

describe('route constants', () => {
  it('defines every canonical Phase 1 route (Doc 04 section 6)', () => {
    expect(ROUTES.HOME).toBe('/');
    expect(ROUTES.ABOUT).toBe('/about');
    expect(ROUTES.CAREERS).toBe('/careers');
    expect(ROUTES.JOB_DETAIL).toBe('/careers/:jobSlug');
    expect(ROUTES.APPLY).toBe('/careers/:jobSlug/apply');
    expect(ROUTES.PRIVACY).toBe('/privacy');
    expect(ROUTES.LEGAL).toBe('/legal');
  });

  it('uses lowercase, hyphenated, trailing-slash-free paths (Doc 04 sections 47-49)', () => {
    Object.values(ROUTES)
      .filter((path) => path !== '*' && path !== '/')
      .forEach((path) => {
        // Dynamic segments such as :jobSlug are parameter names, not public
        // URL text; the value substituted at runtime is what must be lowercase.
        const staticPath = path.replace(/:[A-Za-z0-9]+/g, '');
        expect(staticPath).toBe(staticPath.toLowerCase());
        expect(path.endsWith('/')).toBe(false);
        expect(path).not.toContain('_');
        expect(path).not.toContain('.html');
      });
  });

  it('builds job and apply paths from a slug', () => {
    expect(jobRoute('cybersecurity-specialist')).toBe('/careers/cybersecurity-specialist');
    expect(applyRoute('cybersecurity-specialist')).toBe(
      '/careers/cybersecurity-specialist/apply',
    );
  });

  it('URL-encodes slugs so API data cannot break out of the path (Doc 08 section 18)', () => {
    // A slug containing a slash must not silently create an extra path segment.
    expect(jobRoute('a/b')).toBe('/careers/a%2Fb');
    expect(jobRoute('a b')).toBe('/careers/a%20b');
    expect(jobRoute('../admin')).toBe('/careers/..%2Fadmin');
    expect(applyRoute('a/b')).toBe('/careers/a%2Fb/apply');
  });

  it('does not produce "undefined" in a path when the slug is missing', () => {
    expect(jobRoute(undefined)).toBe('/careers/');
    expect(jobRoute(null)).toBe('/careers/');
  });
});
