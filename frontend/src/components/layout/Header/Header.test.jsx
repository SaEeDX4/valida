import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import Header from './Header.jsx';

/**
 * Header structure and the mobile panel's containing block.
 *
 * These are deliberately structural assertions rather than visual ones: jsdom
 * performs no layout, so the panel's rendered width cannot be measured here.
 * What CAN be proven is the rule that decides that width — an absolutely
 * positioned box resolves against its nearest positioned ancestor. If any
 * element between the panel and the <header> becomes positioned, the panel
 * silently collapses to that element's width. That is exactly the regression
 * this file guards.
 */
function renderHeader() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Header />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.scrollTo = vi.fn();
  document.body.style.overflow = '';
});

/** Opens the mobile panel directly; the trigger is display:none at this width. */
function openMobilePanel(container) {
  const trigger = container.querySelector('button[aria-controls]');
  act(() => trigger.click());
  return container.querySelector(`#${CSS.escape(trigger.getAttribute('aria-controls'))}`);
}

describe('Header structure', () => {
  it('renders a banner landmark containing the brand link', () => {
    renderHeader();
    const banner = screen.getByRole('banner');
    expect(banner.tagName).toBe('HEADER');
    expect(screen.getByRole('link', { name: 'Valida — Home' })).toBeTruthy();
  });

  it('owns positioning in CSS, with no inline position styles', () => {
    const { container } = renderHeader();
    const header = container.querySelector('header');
    expect(header.getAttribute('style')).toBeNull();

    // Inline styles from approved A2 primitives (Icon sets flex) are fine.
    // What must never appear inline is positioning, because an inline
    // position silently changes which element the mobile panel resolves
    // against.
    const inlinePositioned = [...header.querySelectorAll('[style]')].filter((el) =>
      /position\s*:/i.test(el.getAttribute('style')),
    );
    expect(inlinePositioned).toEqual([]);
  });

  it('establishes the header itself as a positioned containing block', () => {
    const { container } = renderHeader();
    const header = container.querySelector('header');
    // sticky is a positioned value, so it is a containing block for an
    // absolutely positioned descendant.
    expect(getComputedStyle(header).position).toBe('sticky');
  });
});

describe('mobile panel containing block', () => {
  it('is the header, not the Menu button wrapper', () => {
    const { container } = renderHeader();
    const panel = openMobilePanel(container);
    expect(panel).toBeTruthy();
    expect(getComputedStyle(panel).position).toBe('absolute');

    const header = container.querySelector('header');
    const positionedAncestors = [];
    for (let node = panel.parentElement; node && node !== header; node = node.parentElement) {
      if (getComputedStyle(node).position !== 'static') {
        positionedAncestors.push(node.className || node.tagName);
      }
    }

    // Any entry here means the panel resolves against that element instead of
    // the header, collapsing it toward the trigger width.
    expect(positionedAncestors).toEqual([]);
  });

  it('spans the full width of its containing block', () => {
    const { container } = renderHeader();
    const panel = openMobilePanel(container);
    // inset-inline: 0 pins both edges, so the panel takes the header's width
    // rather than shrinking to its content. Read as the logical shorthand:
    // jsdom does not expand it into the per-side longhands.
    expect(getComputedStyle(panel).getPropertyValue('inset-inline')).toBe('0px');
  });

  it('starts below the header without a hard-coded height', () => {
    const { container } = renderHeader();
    const panel = openMobilePanel(container);
    const start = getComputedStyle(panel).getPropertyValue('inset-block-start');
    // 100% of the containing block, so the panel follows the header if it grows.
    expect(start).toBe('100%');
  });

  it('does not widen the page', () => {
    const { container } = renderHeader();
    const panel = openMobilePanel(container);
    expect(getComputedStyle(panel).overflowX).toBe('clip');
  });
});
