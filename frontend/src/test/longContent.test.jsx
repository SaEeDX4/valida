import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoute, installJobsService, resetServices, testJob } from './renderRoute.jsx';
import { MARKET } from '../features/jobs/markets.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const readCss = (relative) => readFileSync(join(SRC, relative), 'utf8');

/**
 * A6 long-content resilience.
 *
 * Unbounded strings — job titles, filenames, market lists — are the realistic
 * overflow sources. jsdom performs no layout, so these tests prove two things
 * it CAN observe: the content renders intact (not truncated or dropped), and it
 * lands inside an element whose stylesheet permits wrapping. Pixel-level
 * overflow at 320/360px remains a browser check in the A6 QA matrix.
 */
const LONG_TITLE =
  'Principal Cybersecurity and Secure Platform Infrastructure Engineering Specialist for Distributed Systems';
const LONG_FILE = `${'a-very-long-resume-file-name-without-any-spaces-'.repeat(4)}final.pdf`;

beforeEach(() => {
  window.scrollTo = vi.fn();
});
afterEach(() => resetServices());

describe('A6 — long job titles', () => {
  it('renders a long title intact on Careers', async () => {
    installJobsService({ getPublishedJobs: async () => ({ items: [testJob({ title: LONG_TITLE })] }) });
    renderRoute('/careers');
    const list = await screen.findByTestId('careers-job-list');
    expect(within(list).getByRole('heading', { level: 3, name: LONG_TITLE })).toBeTruthy();
  });

  it('renders a long title intact on Job Detail and keeps the Apply action', async () => {
    installJobsService({ getPublishedJobBySlug: async () => ({ job: testJob({ title: LONG_TITLE }) }) });
    renderRoute('/careers/cybersecurity-specialist');
    expect(await screen.findByRole('heading', { level: 1, name: LONG_TITLE })).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Apply for This Role' }).length).toBeGreaterThan(0);
  });

  it('renders a long title intact in the Apply heading and context', async () => {
    installJobsService({ getPublishedJobBySlug: async () => ({ job: testJob({ title: LONG_TITLE }) }) });
    renderRoute('/careers/cybersecurity-specialist/apply');
    expect(await screen.findByRole('heading', { level: 1, name: `Apply for ${LONG_TITLE}` })).toBeTruthy();
  });
});

describe('A6 — long filenames', () => {
  it('shows a long resume filename in full', async () => {
    installJobsService({ getPublishedJobBySlug: async () => ({ job: testJob() }) });
    const user = userEvent.setup();
    const { container } = renderRoute('/careers/cybersecurity-specialist/apply');
    await screen.findByRole('heading', { level: 1 });
    const file = new File(['x'], LONG_FILE, { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: 1024 });
    await user.upload(container.querySelector('input[type="file"]'), file);
    expect(screen.getByText(`Selected: ${LONG_FILE}`)).toBeTruthy();
  });
});

describe('A6 — long market lists', () => {
  it('renders every supported market for an unsupported visitor', async () => {
    const markets = ['CA', 'US', 'DE', 'FR', 'NL', 'IE', 'LT', 'ES'].map((code, i) => ({
      marketId: i === 0 ? MARKET.CANADA : i === 1 ? MARKET.UNITED_STATES : MARKET.EUROPE,
      countries: [code],
      locationLabel: `Supported market ${code}`,
      compensation: null,
    }));
    installJobsService({ getPublishedJobBySlug: async () => ({ job: testJob({ hiringMarkets: markets }) }) });
    renderRoute('/careers/cybersecurity-specialist?region=BR');
    await screen.findByRole('heading', { level: 1 });
    const facts = screen.getByRole('heading', { name: 'Employment Details' }).closest('aside').querySelector('dl');
    ['CA', 'US', 'DE', 'ES'].forEach((code) => expect(facts.textContent).toContain(`Supported market ${code}`));
  });
});

describe('A6 — the elements holding unbounded strings are allowed to wrap', () => {
  /**
   * The class names are CSS-module hashes, so the check reads the rule that
   * applies through the stylesheet the component imports.
   */
  it('JobRow titles and facts wrap', () => {
    const css = readCss('features/jobs/components/JobRow.module.css');
    expect(css).toMatch(/\.title\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.facts\s*\{[^}]*flex-wrap:\s*wrap/);
  });

  it('the resume filename wraps', () => {
    const css = readCss('features/applications/components/ResumeField.module.css');
    expect(css).toMatch(/\.fileName\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });

  it('Job Detail titles and fact values wrap', () => {
    const css = readCss('pages/JobDetailPage.module.css');
    expect(css).toMatch(/\.title\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.factValue\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
});
