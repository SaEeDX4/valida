import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Shared test setup.
 *
 * jsdom does not implement matchMedia. Components that read a media query
 * (usePrefersReducedMotion) need it, so a controllable stub is installed here
 * and defaults to "no preference". Individual tests override it via
 * setReducedMotion() below.
 */
export function setReducedMotion(matches) {
  window.matchMedia = (query) => ({
    matches: query.includes('prefers-reduced-motion') ? matches : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

setReducedMotion(false);

afterEach(() => {
  cleanup();
  setReducedMotion(false);
});
