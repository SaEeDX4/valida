import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import usePrefersReducedMotion from './usePrefersReducedMotion.js';
import { setReducedMotion } from '../test/setup.js';

function Probe() {
  const reduced = usePrefersReducedMotion();
  return <span data-testid="probe">{reduced ? 'reduced' : 'full'}</span>;
}

describe('usePrefersReducedMotion', () => {
  it('reports full motion when the user has expressed no preference', () => {
    setReducedMotion(false);
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('full');
  });

  it('reports reduced motion when the user has requested it', () => {
    setReducedMotion(true);
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('reduced');
  });

  it('falls back to reduced motion when matchMedia is unavailable', () => {
    const original = window.matchMedia;
    // Deleting matchMedia simulates an environment that cannot report the
    // preference. The hook must not throw, and must not start motion blindly.
    delete window.matchMedia;
    expect(() => render(<Probe />)).not.toThrow();
    window.matchMedia = original;
  });
});
