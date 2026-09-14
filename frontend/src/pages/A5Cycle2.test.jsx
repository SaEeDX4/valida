import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  renderRoute, installJobsService, installApplicationsService, resetServices,
  httpError, networkError, testJob,
} from '../test/renderRoute.jsx';
import { APPLY } from './ApplyPage.content.js';
import { JOB_DETAIL } from './JobDetailPage.content.js';

/** Regression coverage for A5 Correction Cycle 2, findings 1, 2, 4, 5. */
const SLUG = 'cybersecurity-specialist';
const JOB_PATH = `/careers/${SLUG}`;
const APPLY_PATH = `${JOB_PATH}/apply`;

const serveJob = (job) => installJobsService({ getPublishedJobBySlug: async () => ({ job }) });
const pdf = () => {
  const f = new File(['x'], 'resume.pdf', { type: 'application/pdf' });
  Object.defineProperty(f, 'size', { value: 1024 });
  return f;
};
const submitButton = () => screen.getByRole('button', { name: new RegExp(APPLY.submit, 'i') });
const retryButton = () => screen.getByRole('button', { name: new RegExp(APPLY.failure.cta, 'i') });

async function fillRequired(user) {
  await user.type(screen.getByLabelText(/Full Name/), 'Jane Doe');
  await user.type(screen.getByLabelText(/Email Address/), 'jane@example.com');
  await user.upload(screen.getByLabelText(/Choose File|Replace File|Upload Resume/), pdf());
}

beforeEach(() => {
  window.scrollTo = vi.fn();
});
afterEach(() => resetServices());

// ---------------------------------------------------------------- finding 1 --
describe('Job Detail order follows the canonical mobile sequence (finding 1)', () => {
  /** Position of a node in document order. */
  const indexOf = (container, node) =>
    [...container.querySelectorAll('*')].indexOf(node);

  it('places key facts and the Apply CTA before the role content', async () => {
    serveJob(testJob());
    const { container } = renderRoute(JOB_PATH);
    await screen.findByRole('heading', { level: 1 });

    const title = screen.getByRole('heading', { level: 1, name: 'Cybersecurity Specialist' });
    const facts = screen.getByRole('heading', { name: JOB_DETAIL.labels.employmentDetails });
    const [primaryApply] = screen.getAllByRole('link', { name: JOB_DETAIL.primaryCta });
    const content = screen.getByRole('heading', { name: JOB_DETAIL.labels.responsibilities });

    // DOM order IS the mobile order: title -> facts -> Apply -> content.
    expect(indexOf(container, title)).toBeLessThan(indexOf(container, facts));
    expect(indexOf(container, facts)).toBeLessThan(indexOf(container, primaryApply));
    expect(indexOf(container, primaryApply)).toBeLessThan(indexOf(container, content));
  });

  it('repeats the Apply CTA after the content', async () => {
    serveJob(testJob());
    const { container } = renderRoute(JOB_PATH);
    await screen.findByRole('heading', { level: 1 });
    const content = screen.getByRole('heading', { name: JOB_DETAIL.labels.requirements });
    const applyLinks = screen.getAllByRole('link', { name: JOB_DETAIL.primaryCta });
    expect(applyLinks.length).toBeGreaterThanOrEqual(2);
    const last = applyLinks[applyLinks.length - 1];
    expect(indexOf(container, content)).toBeLessThan(indexOf(container, last));
  });

  it('does not duplicate the job facts to force the order', async () => {
    serveJob(testJob());
    const { container } = renderRoute(JOB_PATH);
    await screen.findByRole('heading', { level: 1 });
    // Location appears exactly once: the order comes from DOM order plus CSS
    // placement, not from a second hidden copy of the facts.
    expect(container.querySelectorAll('dl').length).toBe(1);
    expect(screen.getAllByText('British Columbia, Canada')).toHaveLength(1);
  });

  it('puts the closed state early and offers no Apply CTA', async () => {
    serveJob(testJob({ applicationStatus: 'CLOSED', applicationForm: null }));
    const { container } = renderRoute(JOB_PATH);
    await screen.findByTestId('job-closed-banner');

    const facts = screen.getByRole('heading', { name: JOB_DETAIL.labels.employmentDetails });
    const content = screen.getByRole('heading', { name: JOB_DETAIL.labels.responsibilities });
    expect(indexOf(container, facts)).toBeLessThan(indexOf(container, content));
    expect(screen.queryByRole('link', { name: JOB_DETAIL.primaryCta })).toBeNull();
    expect(container.querySelector(`a[href="${APPLY_PATH}"]`)).toBeNull();
  });
});

// ---------------------------------------------------------------- finding 2 --
describe('Apply preserves job context metadata (finding 2)', () => {
  it('renders the canonical label, title, company and supplied facts', async () => {
    serveJob(testJob());
    renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByText(APPLY.jobContextLabel)).toBeTruthy();
    const facts = screen.getByTestId('apply-context-facts');
    expect(within(facts).getByText('British Columbia, Canada')).toBeTruthy();
    expect(within(facts).getByText('Fully remote')).toBeTruthy();
    expect(within(facts).getByText('30 hours per week')).toBeTruthy();
    expect(within(facts).getByText('CAD 35.00 gross per hour')).toBeTruthy();
  });

  it('omits metadata the API did not supply, inventing nothing', async () => {
    serveJob(testJob({ compensation: undefined, weeklyHours: undefined, employmentType: undefined }));
    renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });

    const facts = screen.getByTestId('apply-context-facts');
    expect(facts.textContent).toContain('British Columbia, Canada');
    expect(facts.textContent).not.toMatch(/CAD|hours per week|Part time/);
    expect(facts.textContent).not.toMatch(/not specified|N\/A|TBD|unknown|—/i);
  });

  it('renders no facts list at all when the job supplies none', async () => {
    serveJob(testJob({
      location: undefined, workArrangement: undefined, employmentType: undefined,
      weeklyHours: undefined, compensation: undefined, schedule: undefined,
    }));
    renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByTestId('apply-context-facts')).toBeNull();
  });

  it('stays a compact summary rather than a second Job Detail page', async () => {
    serveJob(testJob());
    renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });
    // The role's long-form content belongs on Job Detail, not here.
    expect(screen.queryByRole('heading', { name: JOB_DETAIL.labels.responsibilities })).toBeNull();
    expect(screen.queryByRole('heading', { name: JOB_DETAIL.labels.requirements })).toBeNull();
  });
});

// ---------------------------------------------------------------- finding 4 --
describe('required YES_NO exposes semantic required state (finding 4)', () => {
  const withYesNo = (required) =>
    testJob({
      applicationForm: {
        ...testJob().applicationForm,
        screeningQuestions: [
          { id: 'yn', type: 'YES_NO', prompt: 'Do you have the right to work?', required, options: [] },
        ],
      },
    });

  it('marks a required group aria-required', async () => {
    serveJob(withYesNo(true));
    renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });
    const group = screen.getByRole('radiogroup');
    expect(group.getAttribute('aria-required')).toBe('true');
  });

  it('does not mark an optional group required', async () => {
    serveJob(withYesNo(false));
    renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('radiogroup').getAttribute('aria-required')).toBeNull();
  });

  it('keeps native radios and the visible required indication', async () => {
    serveJob(withYesNo(true));
    const { container } = renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    // Scoped to this question's fieldset: other required fields on the form
    // carry the same visually hidden marker.
    const fieldset = screen.getByRole('radiogroup').closest('fieldset');
    expect(within(fieldset).getByText('(required)')).toBeTruthy();
    expect(fieldset.querySelector('legend').textContent).toContain('right to work');
  });

  it('associates the error with the group when unanswered', async () => {
    serveJob(withYesNo(true));
    installApplicationsService({ submitApplication: vi.fn() });
    const user = userEvent.setup();
    renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequired(user);
    await user.click(submitButton());

    const group = await screen.findByRole('radiogroup');
    await waitFor(() => expect(group.getAttribute('aria-invalid')).toBe('true'));
    const describedBy = group.getAttribute('aria-describedby');
    expect(document.getElementById(describedBy).textContent).toMatch(/Answer this question/);
  });
});

// ---------------------------------------------------------------- finding 5 --
describe('IDEMPOTENCY_KEY_REUSED gets a new key (finding 5)', () => {
  it('retries with a DIFFERENT key after a reuse conflict', async () => {
    serveJob(testJob());
    const submitApplication = vi.fn().mockRejectedValue(httpError(409, 'IDEMPOTENCY_KEY_REUSED'));
    installApplicationsService({ submitApplication });
    const user = userEvent.setup();
    renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequired(user);
    await user.click(submitButton());
    await screen.findByTestId('apply-failed');

    await user.click(retryButton());
    await waitFor(() => expect(submitApplication).toHaveBeenCalledTimes(2));
    const first = submitApplication.mock.calls[0][2].idempotencyKey;
    const second = submitApplication.mock.calls[1][2].idempotencyKey;
    // Retrying the rejected key would fail with the same 409 forever.
    expect(second).not.toBe(first);
  });

  it('still reuses the key after a plain network failure', async () => {
    serveJob(testJob());
    const submitApplication = vi.fn().mockRejectedValue(networkError());
    installApplicationsService({ submitApplication });
    const user = userEvent.setup();
    renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequired(user);
    await user.click(submitButton());
    await screen.findByTestId('apply-failed');

    await user.click(retryButton());
    await waitFor(() => expect(submitApplication).toHaveBeenCalledTimes(2));
    expect(submitApplication.mock.calls[1][2].idempotencyKey).toBe(
      submitApplication.mock.calls[0][2].idempotencyKey,
    );
  });

  it('does not report a closed role and keeps the entered data', async () => {
    serveJob(testJob());
    installApplicationsService({
      submitApplication: async () => {
        throw httpError(409, 'IDEMPOTENCY_KEY_REUSED');
      },
    });
    const user = userEvent.setup();
    renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequired(user);
    await user.click(submitButton());
    await screen.findByTestId('apply-failed');

    expect(screen.queryByTestId('apply-closed-during')).toBeNull();
    expect(screen.getByLabelText(/Full Name/).value).toBe('Jane Doe');
    expect(screen.getByText('Selected: resume.pdf')).toBeTruthy();
  });
});
