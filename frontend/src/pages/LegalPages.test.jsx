import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '../routes/AppRouter.jsx';
import { findAccessibilityViolations } from '../test/axe.js';
import { PRIVACY_META, PRIVACY_INTRO, PRIVACY_SECTIONS } from './PrivacyPage.content.js';
import { LEGAL_META, COMPANY_FACTS, LEGAL_SECTIONS } from './LegalPage.content.js';

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.scrollTo = vi.fn();
});

describe('Privacy Notice', () => {
  it('renders the canonical H1 and intro (Doc 06 sections 157-158)', () => {
    renderAt('/privacy');
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Notice' })).toBeTruthy();
    expect(screen.getByText(PRIVACY_INTRO)).toBeTruthy();
  });

  it('renders every canonical section as a semantic H2, in order', () => {
    const { container } = renderAt('/privacy');
    const headings = [...container.querySelectorAll('main h2')].map((h) => h.textContent.trim());
    expect(headings).toEqual(PRIVACY_SECTIONS.map((s) => s.title));
  });

  it('renders every canonical paragraph verbatim', () => {
    renderAt('/privacy');
    PRIVACY_SECTIONS.forEach((section) =>
      section.paragraphs.forEach((p) => expect(screen.getByText(p)).toBeTruthy()),
    );
  });

  it('includes the required subject areas', () => {
    const { container } = renderAt('/privacy');
    const headings = [...container.querySelectorAll('main h2')].map((h) => h.textContent.trim());
    [
      'Who We Are', 'Information We Collect', 'Why We Use Applicant Information',
      'Resume and File Handling', 'Service Providers', 'Security', 'Retention',
      'Data Minimization', 'Changes to This Notice',
    ].forEach((required) => expect(headings).toContain(required));
  });

  it('points privacy questions at the published contact method, with no email of its own (Doc 06 section 167)', () => {
    const { container } = renderAt('/privacy');
    expect(screen.getByRole('heading', { level: 2, name: 'Questions or Requests' })).toBeTruthy();
    expect(container.querySelector('main').textContent).toMatch(/use the current official contact method published on the Valida website/);
    expect(container.querySelector('footer a[href="/contact"]')).toBeTruthy();
  });

  it('exposes no internal roadmap or implementation language to visitors', () => {
    const { container } = renderAt('/privacy');
    const text = container.querySelector('main').textContent;
    [
      /Phase\s?2/i, /AWAITING INPUT/i, /Milestone/i, /roadmap/i,
      /replace this wording/i, /privacy mailbox/i, /operational and verified/i,
      /\bTODO\b/i, /\bA4\b/, /\bA5\b/,
    ].forEach((pattern) => expect(text).not.toMatch(pattern));
  });

  it('invents no provider, retention period, compliance claim or privacy contact', () => {
    const { container } = renderAt('/privacy');
    const text = container.querySelector('main').textContent;
    [
      /\bGDPR\b/, /\bPIPEDA\b/, /\bcompliant\b/i, /\bcompliance with\b/i,
      /\bAWS\b/, /\bGoogle Analytics\b/, /\bCloudflare\b/, /\bMongoDB Atlas\b/,
      /\bdata protection officer\b/i, /\bDPO\b/, /\bcookie/i, /\blawful basis\b/i,
      /\b\d+\s*(days|months|years)\b/i, /\bdata residency\b/i, /\bsubprocessor/i,
      /[\w.+-]+@[\w-]+\.[\w.]+/,
    ].forEach((pattern) => expect(text).not.toMatch(pattern));
  });

  it('uses a constrained reading measure, not full-width legal text', () => {
    const { container } = renderAt('/privacy');
    expect(container.querySelector('main div[class*="prose"]')).toBeTruthy();
  });

  it('sets the canonical title and description', () => {
    renderAt('/privacy');
    expect(document.title).toBe(PRIVACY_META.title);
    expect(document.querySelector('meta[name="description"]').getAttribute('content')).toBe(
      PRIVACY_META.description,
    );
  });

  it('has no axe violations', async () => {
    const { container } = renderAt('/privacy');
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });
});

describe('Legal Information', () => {
  it('renders the canonical H1', () => {
    renderAt('/legal');
    expect(screen.getByRole('heading', { level: 1, name: 'Legal Information' })).toBeTruthy();
  });

  it('renders every verified company fact (Doc 06 section 173)', () => {
    renderAt('/legal');
    COMPANY_FACTS.forEach(({ term, value }) => {
      expect(screen.getByText(term)).toBeTruthy();
      expect(screen.getByText(value)).toBeTruthy();
    });
  });

  it('states the verified company code and registration date exactly', () => {
    renderAt('/legal');
    expect(screen.getByText('308123132')).toBeTruthy();
    expect(screen.getByText('7 September 2026')).toBeTruthy();
    expect(screen.getByText('Valida MB')).toBeTruthy();
    expect(screen.getByText('Shervin Fallahdoust')).toBeTruthy();
    expect(screen.getByText('Lithuanian Mažoji bendrija (MB)')).toBeTruthy();
  });

  it('uses a description list for company facts', () => {
    const { container } = renderAt('/legal');
    const dl = container.querySelector('main dl');
    expect(dl).toBeTruthy();
    expect(dl.querySelectorAll('dt')).toHaveLength(COMPANY_FACTS.length);
    expect(dl.querySelectorAll('dd')).toHaveLength(COMPANY_FACTS.length);
  });

  it('renders every canonical section and paragraph', () => {
    const { container } = renderAt('/legal');
    const headings = [...container.querySelectorAll('main h2')].map((h) => h.textContent.trim());
    expect(headings).toEqual(['Company Information', ...LEGAL_SECTIONS.map((s) => s.title)]);
    LEGAL_SECTIONS.forEach((section) =>
      section.paragraphs.forEach((p) => expect(screen.getByText(p)).toBeTruthy()),
    );
  });

  it('invents no address, VAT number, licence or governing-law clause', () => {
    const { container } = renderAt('/legal');
    const text = container.querySelector('main').textContent;
    [
      /\bVAT\b/i, /\bregistered office\b/i, /\bstreet\b/i, /\bLT-\d/,
      /\bgoverned by the laws\b/i, /\bjurisdiction\b/i, /\bwarrant/i,
      /\blicen[cs]e\b/i, /\bdisclaimer\b/i, /[\w.+-]+@[\w-]+\.[\w.]+/,
      /\+\d{6,}/,
    ].forEach((pattern) => expect(text).not.toMatch(pattern));
  });

  it('sets the canonical title and description', () => {
    renderAt('/legal');
    expect(document.title).toBe(LEGAL_META.title);
    expect(document.querySelector('meta[name="description"]').getAttribute('content')).toBe(
      LEGAL_META.description,
    );
  });

  it('has no axe violations', async () => {
    const { container } = renderAt('/legal');
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });
});

describe('Contact', () => {
  it('publishes exactly the approved email and address, with no apartment number', () => {
    const { container } = renderAt('/contact');
    expect(screen.getByRole('heading', { level: 1, name: 'Contact' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'careers@cybervalida.com' }).getAttribute('href')).toBe('mailto:careers@cybervalida.com');
    expect([...container.querySelectorAll('address span')].map((line) => line.textContent)).toEqual([
      'Valida MB',
      'Arkos g. 1',
      'Avižienių sen.',
      'LT-14180 Klevinės k.',
      'Lithuania',
    ]);
    const text = container.querySelector('main').textContent;
    expect(text).not.toMatch(/\b(apt|apartment|butas|flat|unit)\b/i);
    expect(text).not.toMatch(/\+\d{6,}/);
  });

  it('carries no address in its page metadata', () => {
    renderAt('/contact');
    expect(document.title).toBe('Contact | Valida');
    expect(document.querySelector('meta[name="description"]').getAttribute('content')).not.toMatch(/Arkos|14180/);
  });

  it('has no axe violations', async () => {
    const { container } = renderAt('/contact');
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });
});

describe('PageMeta behaviour across routes', () => {
  it('updates title and description when the route changes', () => {
    const view = renderAt('/privacy');
    expect(document.title).toBe(PRIVACY_META.title);
    view.unmount();
    renderAt('/legal');
    expect(document.title).toBe(LEGAL_META.title);
    expect(document.querySelector('meta[name="description"]').getAttribute('content')).toBe(
      LEGAL_META.description,
    );
  });

  it('keeps exactly one description meta tag', () => {
    renderAt('/privacy');
    expect(document.querySelectorAll('meta[name="description"]')).toHaveLength(1);
  });
});
