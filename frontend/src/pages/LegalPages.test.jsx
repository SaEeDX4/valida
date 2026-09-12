import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

  it('omits Questions or Requests while no approved contact mechanism exists', () => {
    const { container } = renderAt('/privacy');
    const main = container.querySelector('main');
    // The canonical section points readers at a published contact method that
    // does not exist. Showing it partially would either mislead or leak
    // internal roadmap wording, so the whole section is withheld.
    expect(main.textContent).not.toMatch(/Questions or Requests/);
    expect(screen.queryByRole('heading', { name: 'Questions or Requests' })).toBeNull();
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

  it('offers no fake contact method in place of the omitted section', () => {
    const { container } = renderAt('/privacy');
    const main = container.querySelector('main');
    expect(main.textContent).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(main.textContent).not.toMatch(/\bcontact us\b/i);
    expect(within(main).queryByRole('link', { name: /contact/i })).toBeNull();
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

  it('omits the unsupported published-contact-method sentence', () => {
    const { container } = renderAt('/privacy');
    // No official contact method is published yet, so directing a data subject
    // to one would be untrue (Doc 06 section 169).
    expect(container.querySelector('main').textContent).not.toMatch(
      /use the current official contact method published/i,
    );
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
