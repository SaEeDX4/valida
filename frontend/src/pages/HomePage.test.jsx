import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '../routes/AppRouter.jsx';
import { findAccessibilityViolations } from '../test/axe.js';
import {
  HOME_META, HERO, POSITIONING, CAPABILITIES, PHILOSOPHY, OPERATING,
  CAREERS_FEATURE, FINAL_CTA,
} from './HomePage.content.js';

function renderHome(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.scrollTo = vi.fn();
});

describe('Home — canonical content', () => {
  it('renders the canonical H1 across both lines (Doc 06 section 14)', () => {
    renderHome();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent.replace(/\s+/g, ' ').trim()).toBe(
      'Secure systems. Deliberate engineering.',
    );
  });

  it('renders exactly one H1', () => {
    const { container } = renderHome();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('renders the canonical hero eyebrow and supporting copy', () => {
    renderHome();
    expect(screen.getByText(HERO.eyebrow)).toBeTruthy();
    expect(screen.getByText(HERO.body)).toBeTruthy();
  });

  it('renders the canonical section sequence in order (Doc 18 section 63)', () => {
    const { container } = renderHome();
    const headings = [...container.querySelectorAll('main h2')].map((h) =>
      h.textContent.trim(),
    );
    expect(headings).toEqual([
      POSITIONING.heading,
      CAPABILITIES.heading,
      PHILOSOPHY.heading,
      OPERATING.heading,
      CAREERS_FEATURE.heading,
      FINAL_CTA.heading,
    ]);
  });

  it('renders all seven canonical capabilities with their exact descriptions', () => {
    renderHome();
    expect(CAPABILITIES.items).toHaveLength(7);
    CAPABILITIES.items.forEach((item) => {
      expect(screen.getByRole('heading', { level: 3, name: item.title })).toBeTruthy();
      expect(screen.getByText(item.body)).toBeTruthy();
    });
  });

  it('renders the three philosophy principles and four operating principles', () => {
    renderHome();
    PHILOSOPHY.principles.forEach((p) =>
      expect(screen.getByRole('heading', { level: 3, name: p.title })).toBeTruthy(),
    );
    OPERATING.principles.forEach((p) =>
      expect(screen.getByRole('heading', { level: 3, name: p.title })).toBeTruthy(),
    );
  });

  it('keeps a linear heading outline with no skipped level', () => {
    const { container } = renderHome();
    const levels = [...container.querySelectorAll('main h1, main h2, main h3')].map((h) =>
      Number(h.tagName[1]),
    );
    levels.forEach((level, i) => {
      if (i > 0) expect(level - levels[i - 1]).toBeLessThanOrEqual(1);
    });
  });
});

describe('Home — claim control (Doc 02)', () => {
  it('makes no customer, certification, metric or track-record claim', () => {
    const { container } = renderHome();
    const text = container.querySelector('main').textContent;
    [
      /\bour clients?\b/i, /\bour customers?\b/i, /\bwe deliver\b/i,
      /\bwe protect customers\b/i, /\bwe have secured\b/i, /\bproven solutions?\b/i,
      /ISO\s?27/i, /SOC\s?2/i, /\bcertified\b/i, /\baward\b/i, /\btestimonial\b/i,
      /\b24\/7\b/i, /\bguarantee\b/i, /\btrusted by\b/i, /\byears of experience\b/i,
    ].forEach((pattern) => expect(text).not.toMatch(pattern));
  });

  it('contains no placeholder or filler copy', () => {
    const { container } = renderHome();
    const text = container.querySelector('main').textContent;
    [/lorem ipsum/i, /coming soon/i, /\bTBD\b/, /placeholder/i, /sample client/i, /demo content/i]
      .forEach((pattern) => expect(text).not.toMatch(pattern));
  });

  it('shows no fake job and no role preview (A4/A5 boundary)', () => {
    const { container } = renderHome();
    const text = container.querySelector('main').textContent;
    // No invented role, and no assertion either way about whether roles exist.
    expect(text).not.toMatch(/Cybersecurity Specialist/i);
    expect(text).not.toMatch(/No open roles/i);
    expect(text).not.toMatch(/apply now/i);
    expect(text).not.toMatch(/\bfull-time\b/i);
  });

  it('uses truthful Careers CTA wording while no role is published', () => {
    renderHome();
    expect(screen.queryByRole('link', { name: 'View Open Roles' })).toBeNull();
    expect(screen.getAllByRole('link', { name: CAREERS_FEATURE.cta }).length).toBeGreaterThan(0);
  });

  it('publishes no contact email, phone or address (truth-controlled omission)', () => {
    const { container } = renderHome();
    const text = container.textContent;
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(text).not.toMatch(/published company contact channel/i);
    expect(screen.queryByRole('link', { name: /contact/i })).toBeNull();
  });

  it('renders the final CTA body without the contact clause', () => {
    renderHome();
    expect(screen.getByText(FINAL_CTA.body)).toBeTruthy();
    expect(FINAL_CTA.body).not.toMatch(/contact/i);
  });
});

describe('Home — interaction', () => {
  it('navigates from the hero primary CTA to Careers', async () => {
    renderHome();
    const main = screen.getByRole('main');
    const [primary] = within(main).getAllByRole('link', { name: HERO.primaryCta });
    await userEvent.click(primary);
    expect(screen.getByRole('heading', { level: 1, name: /Work on technology that is built to be trusted\./ })).toBeTruthy();
  });

  it('navigates from the hero secondary CTA to About', async () => {
    renderHome();
    const main = screen.getByRole('main');
    const [secondary] = within(main).getAllByRole('link', { name: HERO.secondaryCta });
    await userEvent.click(secondary);
    expect(
      screen.getByRole('heading', { level: 1, name: /Building technology with security/ }),
    ).toBeTruthy();
  });

  it('treats capability entries as informational, never as links or buttons', () => {
    const { container } = renderHome();
    const list = container.querySelector('ul[class*="capabilityList"]');
    expect(list).toBeTruthy();
    // Doc 05 section 48: no dead hover cards, nothing that looks clickable.
    expect(list.querySelectorAll('a, button, [role="link"], [role="button"]')).toHaveLength(0);
    expect(list.querySelectorAll('[tabindex]')).toHaveLength(0);
  });

  it('has no dead links anywhere on the page', () => {
    const { container } = renderHome();
    container.querySelectorAll('a').forEach((a) => {
      const href = a.getAttribute('href');
      expect(href).toBeTruthy();
      expect(href).not.toBe('#');
    });
  });
});

describe('Home — visual and accessibility', () => {
  it('keeps the Security Field decorative and nonessential', () => {
    const { container } = renderHome();
    const field = container.querySelector('[aria-hidden="true"] svg[role="presentation"]');
    expect(field).toBeTruthy();
    // Meaning is carried by text: the graphic contributes no words at all.
    expect(field.closest('[aria-hidden="true"]').textContent.trim()).toBe('');
  });

  it('sets the canonical title and description (Doc 06 sections 11-12)', () => {
    renderHome();
    expect(document.title).toBe(HOME_META.title);
    expect(document.querySelector('meta[name="description"]').getAttribute('content')).toBe(
      HOME_META.description,
    );
  });

  it('has no axe violations', async () => {
    const { container } = renderHome();
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });
});
