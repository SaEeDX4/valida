import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '../routes/AppRouter.jsx';
import { findAccessibilityViolations } from '../test/axe.js';
import {
  ABOUT_META, ABOUT_HERO, ABOUT_SECTIONS, ABOUT_PRINCIPLES, ABOUT_RND, ABOUT_CAREERS,
} from './AboutPage.content.js';

function renderAbout() {
  return render(
    <MemoryRouter initialEntries={['/about']}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.scrollTo = vi.fn();
});

describe('About — canonical content', () => {
  it('renders the canonical H1 (Doc 06 section 57)', () => {
    renderAbout();
    expect(screen.getByRole('heading', { level: 1, name: ABOUT_HERO.heading })).toBeTruthy();
  });

  it('renders exactly one H1', () => {
    const { container } = renderAbout();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('renders the canonical hero eyebrow and lead', () => {
    renderAbout();
    expect(screen.getByText(ABOUT_HERO.eyebrow)).toBeTruthy();
    expect(screen.getByText(ABOUT_HERO.body)).toBeTruthy();
  });

  it('renders every canonical section heading and paragraph in order', () => {
    const { container } = renderAbout();
    ABOUT_SECTIONS.forEach((section) => {
      expect(screen.getByRole('heading', { level: 2, name: section.heading })).toBeTruthy();
      section.paragraphs.forEach((p) => expect(screen.getByText(p)).toBeTruthy());
    });
    const headings = [...container.querySelectorAll('main h2')].map((h) => h.textContent.trim());
    expect(headings.slice(0, 3)).toEqual(ABOUT_SECTIONS.map((s) => s.heading));
  });

  it('renders the four canonical principles with exact bodies', () => {
    renderAbout();
    expect(ABOUT_PRINCIPLES).toHaveLength(4);
    ABOUT_PRINCIPLES.forEach((p) => {
      expect(screen.getByRole('heading', { level: 3, name: p.title })).toBeTruthy();
      expect(screen.getByText(p.body)).toBeTruthy();
    });
  });

  it('renders the R&D direction section', () => {
    renderAbout();
    expect(screen.getByRole('heading', { level: 2, name: ABOUT_RND.heading })).toBeTruthy();
    expect(screen.getByText(ABOUT_RND.body)).toBeTruthy();
  });

  it('keeps a linear heading outline', () => {
    const { container } = renderAbout();
    const levels = [...container.querySelectorAll('main h1, main h2, main h3')].map((h) =>
      Number(h.tagName[1]),
    );
    levels.forEach((level, i) => {
      if (i > 0) expect(level - levels[i - 1]).toBeLessThanOrEqual(1);
    });
  });

  it('flips columns visually without changing DOM reading order', () => {
    const { container } = renderAbout();
    // The alternating layout must not reorder content for assistive tech: the
    // heading still precedes its own body in the DOM.
    container.querySelectorAll('section[class*="editorial"]').forEach((section) => {
      const heading = section.querySelector('h2');
      const firstParagraph = section.querySelector('p:not([class*="eyebrow"])');
      if (heading && firstParagraph) {
        expect(
          heading.compareDocumentPosition(firstParagraph) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
    });
  });
});

describe('About — claim control (Doc 02)', () => {
  it('fabricates no history, office, headcount, customer or credential', () => {
    const { container } = renderAbout();
    const text = container.querySelector('main').textContent;
    [
      /\bfounded in\b/i, /\bsince 19\d\d\b/, /\bsince 20\d\d\b/, /\boffices?\b/i,
      /\bheadquarter/i, /\bemployees\b/i, /\bteam of \d+/i, /\bour clients?\b/i,
      /\bcustomers?\b/i, /\bpartners\b/i, /\bawards?\b/i, /\bcertified\b/i,
      /ISO\s?27/i, /SOC\s?2/i, /\btestimonial/i, /\bglobal presence\b/i,
      /\bmilestone/i, /\bcase stud/i,
    ].forEach((pattern) => expect(text).not.toMatch(pattern));
  });

  it('contains no placeholder copy and no contact details', () => {
    const { container } = renderAbout();
    const text = container.querySelector('main').textContent;
    [/lorem ipsum/i, /coming soon/i, /\bTBD\b/, /placeholder/i].forEach((p) =>
      expect(text).not.toMatch(p),
    );
    expect(container.textContent).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });

  it('uses no photography of people, offices or facilities', () => {
    const { container } = renderAbout();
    // Only the approved brand mark in the footer may be an image.
    [...container.querySelectorAll('main img')].forEach((img) => {
      expect(img.getAttribute('src')).toMatch(/\/brand\//);
    });
  });
});

describe('About — interaction, meta and accessibility', () => {
  it('navigates from the Careers CTA to Careers', async () => {
    renderAbout();
    const main = screen.getByRole('main');
    await userEvent.click(within(main).getByRole('link', { name: ABOUT_CAREERS.cta }));
    expect(screen.getByRole('heading', { level: 1, name: /Careers/ })).toBeTruthy();
  });

  it('has no dead links', () => {
    const { container } = renderAbout();
    container.querySelectorAll('a').forEach((a) => {
      expect(a.getAttribute('href')).toBeTruthy();
      expect(a.getAttribute('href')).not.toBe('#');
    });
  });

  it('sets the canonical title and description (Doc 06 sections 54-55)', () => {
    renderAbout();
    expect(document.title).toBe(ABOUT_META.title);
    expect(document.querySelector('meta[name="description"]').getAttribute('content')).toBe(
      ABOUT_META.description,
    );
  });

  it('does not reuse the Home hero Security Field', () => {
    const { container } = renderAbout();
    // Doc 05 section 64: About must not duplicate the Home hero.
    expect(container.querySelector('main svg[role="presentation"]')).toBeNull();
  });

  it('has no axe violations', async () => {
    const { container } = renderAbout();
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });
});
