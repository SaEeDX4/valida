import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Source-level checks on the global stylesheets.
 *
 * These assert obligations that live in CSS and therefore cannot be observed
 * in jsdom, which applies no stylesheets: that every canonical token from
 * Document 03 / Document 08 exists, and that the global reduced-motion block
 * required by Doc 08 section 65 is actually present.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(join(here, file), 'utf8');

const tokens = read('tokens.css');
const base = read('base.css');
const typography = read('typography.css');

const REQUIRED_COLOR_TOKENS = [
  ['--color-bg-primary', '#05070a'],
  ['--color-bg-secondary', '#080c11'],
  ['--color-bg-tertiary', '#0b1017'],
  ['--color-surface', '#0e151d'],
  ['--color-surface-raised', '#121b25'],
  ['--color-surface-hover', '#16212d'],
  ['--color-text-primary', '#f4f7fa'],
  ['--color-text-secondary', '#b6c0cc'],
  ['--color-text-muted', '#7e8997'],
  ['--color-silver', '#c9d1da'],
  ['--color-accent', '#328fff'],
  ['--color-accent-bright', '#66b3ff'],
  ['--color-accent-deep', '#1768d5'],
  ['--color-focus', '#83c6ff'],
  ['--color-success', '#39c993'],
  ['--color-warning', '#e8b34d'],
  ['--color-error', '#ff667c'],
  ['--color-info', '#5ba9ff'],
];

describe('design tokens', () => {
  it.each(REQUIRED_COLOR_TOKENS)('defines %s with the canonical value %s', (token, value) => {
    expect(tokens).toContain(`${token}: ${value}`);
  });

  it('defines the border tokens from Doc 03 section 8', () => {
    expect(tokens).toContain('--color-border-subtle: rgba(190, 210, 230, 0.12)');
    expect(tokens).toContain('--color-border-medium: rgba(190, 210, 230, 0.2)');
    expect(tokens).toContain('--color-border-strong: rgba(205, 220, 235, 0.3)');
  });

  it('defines the full 4px spacing scale from Doc 03 section 31', () => {
    const scale = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 120, 144, 160];
    scale.forEach((value, index) => {
      expect(tokens).toContain(`--space-${index + 1}: ${value}px`);
    });
  });

  it('defines the canonical radius scale from Doc 03 section 38', () => {
    expect(tokens).toContain('--radius-xs: 4px');
    expect(tokens).toContain('--radius-sm: 8px');
    expect(tokens).toContain('--radius-md: 12px');
    expect(tokens).toContain('--radius-lg: 16px');
    expect(tokens).toContain('--radius-xl: 22px');
    expect(tokens).toContain('--radius-pill: 999px');
  });

  it('defines the motion tokens from Doc 03 section 71 and Doc 08 section 42', () => {
    expect(tokens).toContain('--duration-fast: 120ms');
    expect(tokens).toContain('--duration-standard: 180ms');
    expect(tokens).toContain('--duration-medium: 260ms');
    expect(tokens).toContain('--duration-slow: 420ms');
    expect(tokens).toContain('--ease-standard: cubic-bezier(0.2, 0.8, 0.2, 1)');
  });

  it('defines the canonical page max widths from Doc 03 section 33', () => {
    expect(tokens).toContain('--width-shell: 1600px');
    expect(tokens).toContain('--width-main: 1360px');
    expect(tokens).toContain('--width-standard: 1240px');
    expect(tokens).toContain('--width-narrow: 960px');
    expect(tokens).toContain('--width-reading: 720px');
  });

  it('uses fluid clamp() typography (Doc 03 section 25, VIS-006)', () => {
    ['--text-display', '--text-h1', '--text-h2', '--text-h3', '--text-h4', '--text-body'].forEach(
      (token) => {
        expect(tokens).toMatch(new RegExp(`${token}: clamp\\(`));
      },
    );
  });

  it('declares both canonical font families with working fallbacks', () => {
    expect(tokens).toContain('"Space Grotesk"');
    expect(tokens).toContain('"Inter"');
    expect(tokens).toMatch(/--font-display:[^;]*sans-serif/);
    expect(tokens).toMatch(/--font-body:[^;]*sans-serif/);
  });
});

describe('base stylesheet', () => {
  it('implements the global reduced-motion block (Doc 08 section 65)', () => {
    expect(base).toContain('@media (prefers-reduced-motion: reduce)');
    expect(base).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(base).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });

  it('provides a visible focus indicator and never removes it (Doc 03 section 87)', () => {
    expect(base).toContain(':focus-visible');
    expect(base).toContain('outline: var(--focus-ring-width) solid var(--color-focus)');
    expect(base).not.toMatch(/outline:\s*(none|0)\s*;/);
  });

  it('prevents unintended horizontal overflow (Doc 03 section 84, VIS-019)', () => {
    expect(base).toContain('overflow-x: clip');
    expect(base).toContain('overflow-wrap: break-word');
  });

  it('lets form controls inherit typography (Doc 08 section 48)', () => {
    expect(base).toMatch(/input,\s*\n\s*button,\s*\n\s*textarea,\s*\n\s*select\s*\{\s*\n\s*font: inherit;/);
  });
});

describe('typography stylesheet', () => {
  it('defines every semantic level required by Doc 08 section 46', () => {
    [
      't-display', 't-h1', 't-h2', 't-h3', 't-h4',
      't-body-lg', 't-body', 't-body-sm', 't-caption',
      't-label', 't-nav', 't-button', 't-metadata',
    ].forEach((level) => {
      expect(typography).toContain(`.${level}`);
    });
  });

  it('constrains the reading measure to roughly 60-72 characters (Doc 03 section 27)', () => {
    expect(typography).toMatch(/max-width:\s*6[0-9]ch|max-width:\s*7[0-2]ch/);
  });
});
