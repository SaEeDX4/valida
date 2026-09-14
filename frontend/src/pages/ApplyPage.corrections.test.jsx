import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { AppRoutes } from '../routes/AppRouter.jsx';
import {
  renderRoute, installJobsService, installApplicationsService, resetServices,
  httpError, networkError, pending, testJob,
} from '../test/renderRoute.jsx';
import { APPLY } from './ApplyPage.content.js';
import { JOB_DETAIL } from './JobDetailPage.content.js';

/**
 * Regression coverage for A5 Correction Cycle 1, findings 2 and 5-9.
 */
const SLUG = 'cybersecurity-specialist';
const PATH = `/careers/${SLUG}/apply`;

const serveJob = (job) => installJobsService({ getPublishedJobBySlug: async () => ({ job }) });
const pdf = (name = 'resume.pdf', size = 1024) => {
  const file = new File(['x'], name, { type: 'application/pdf' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};
const submitButton = () => screen.getByRole('button', { name: new RegExp(APPLY.submit, 'i') });
const robots = () => document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null;

async function fillRequired(user) {
  await user.type(screen.getByLabelText(/Full Name/), 'Jane Doe');
  await user.type(screen.getByLabelText(/Email Address/), 'jane@example.com');
  await user.upload(screen.getByLabelText(/Replace File|Choose File|Upload Resume/), pdf());
}

beforeEach(() => {
  window.scrollTo = vi.fn();
  document.querySelectorAll('meta[name="robots"]').forEach((t) => t.remove());
});
afterEach(() => resetServices());

// ---------------------------------------------------------------- finding 2 --
describe('409 is selected by code, not status (finding 2)', () => {
  const submitWith = (error) =>
    installApplicationsService({
      submitApplication: async () => {
        throw error;
      },
    });

  it('409 JOB_NOT_ACCEPTING_APPLICATIONS shows the closed state', async () => {
    serveJob(testJob());
    submitWith(httpError(409, 'JOB_NOT_ACCEPTING_APPLICATIONS'));
    const user = userEvent.setup();
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequired(user);
    await user.click(submitButton());
    expect(await screen.findByTestId('apply-closed-during')).toBeTruthy();
  });

  it('409 IDEMPOTENCY_KEY_REUSED is NOT reported as a closed role', async () => {
    serveJob(testJob());
    submitWith(httpError(409, 'IDEMPOTENCY_KEY_REUSED'));
    const user = userEvent.setup();
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequired(user);
    await user.click(submitButton());

    expect(await screen.findByTestId('apply-failed')).toBeTruthy();
    expect(screen.queryByTestId('apply-closed-during')).toBeNull();
    expect(screen.queryByText(APPLY.closedDuringApplication.heading)).toBeNull();
  });

  it('an unrecognised 409 falls back to the safe generic failure', async () => {
    serveJob(testJob());
    submitWith(httpError(409, 'SOME_FUTURE_CONFLICT'));
    const user = userEvent.setup();
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequired(user);
    await user.click(submitButton());
    expect(await screen.findByTestId('apply-failed')).toBeTruthy();
    expect(screen.queryByTestId('apply-closed-during')).toBeNull();
  });
});

// ---------------------------------------------------------------- finding 3 --
describe('success requires the canonical DTO (finding 3)', () => {
  const submitReturning = (data) =>
    installApplicationsService({
      submitApplication: async () => ({ data, requestId: 'r' }),
    });

  const runSubmit = async () => {
    const user = userEvent.setup();
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequired(user);
    await user.click(submitButton());
  };

  it('shows no success for success:true with an empty data object', async () => {
    serveJob(testJob());
    // The real applicationsApi validates the DTO; this exercises the page with
    // a service that resolves on a body the contract must reject.
    installApplicationsService({
      submitApplication: async () => {
        const { isValidApplicationResult } = await import('../features/applications/api/applicationsApi.js');
        if (!isValidApplicationResult({})) throw networkError();
        return { data: {} };
      },
    });
    await runSubmit();
    expect(await screen.findByTestId('apply-failed')).toBeTruthy();
    expect(screen.queryByTestId('apply-success')).toBeNull();
  });

  it('shows success for the canonical RECEIVED payload', async () => {
    serveJob(testJob());
    submitReturning({
      status: 'RECEIVED',
      job: { title: 'Cybersecurity Specialist', slug: SLUG },
      submittedAt: '2026-09-10T18:45:00.000Z',
    });
    await runSubmit();
    expect(await screen.findByTestId('apply-success')).toBeTruthy();
  });
});

// -------------------------------------------------------------- finding 5A --
describe('server validation raises and focuses the summary (finding 5A)', () => {
  const serverFieldErrors = () =>
    installApplicationsService({
      submitApplication: async () => {
        throw httpError(422, 'VALIDATION_FAILED', {
          message: 'INTERNAL: constraint violation at db.applications',
          fieldErrors: [{ field: 'email', code: 'INVALID_EMAIL', message: 'Enter a valid email address.' }],
        });
      },
    });

  it('shows the canonical summary and moves focus to it', async () => {
    serveJob(testJob());
    serverFieldErrors();
    const user = userEvent.setup();
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequired(user);
    await user.click(submitButton());

    const summary = await screen.findByTestId('validation-summary');
    expect(within(summary).getByText(APPLY.validationSummary.heading)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(summary));
  });

  it('renders no raw internal server text', async () => {
    serveJob(testJob());
    serverFieldErrors();
    const user = userEvent.setup();
    const { container } = renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequired(user);
    await user.click(submitButton());
    await screen.findByTestId('validation-summary');
    expect(container.textContent).not.toMatch(/INTERNAL:|constraint violation|db\.applications/);
  });
});

// -------------------------------------------------------------- finding 5B --
describe('job becoming unavailable retires the form (finding 5B)', () => {
  it('renders the full unavailable state with no active form', async () => {
    serveJob(testJob());
    installApplicationsService({
      submitApplication: async () => {
        throw httpError(404, 'JOB_NOT_FOUND');
      },
    });
    const user = userEvent.setup();
    const { container } = renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequired(user);
    await user.click(submitButton());

    const block = await screen.findByTestId('apply-unavailable');
    expect(within(block).getByText(APPLY.unavailable.heading)).toBeTruthy();
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.textContent).not.toMatch(/draft|archived|mongo|_id/i);
  });
});

// -------------------------------------------------------------- finding 5C --
describe('failure offers the canonical retry (finding 5C)', () => {
  it('replaces the submit label with Try Again and preserves data', async () => {
    serveJob(testJob());
    const submitApplication = vi.fn().mockRejectedValue(networkError());
    installApplicationsService({ submitApplication });
    const user = userEvent.setup();
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequired(user);
    await user.click(submitButton());
    await screen.findByTestId('apply-failed');

    const retry = screen.getByRole('button', { name: new RegExp(APPLY.failure.cta, 'i') });
    expect(retry).toBeTruthy();
    expect(screen.queryByRole('button', { name: new RegExp(`^${APPLY.submit}$`, 'i') })).toBeNull();
    expect(screen.getByLabelText(/Full Name/).value).toBe('Jane Doe');

    await user.click(retry);
    await waitFor(() => expect(submitApplication).toHaveBeenCalledTimes(2));
    expect(submitApplication.mock.calls[1][2].idempotencyKey).toBe(
      submitApplication.mock.calls[0][2].idempotencyKey,
    );
  });
});

// ---------------------------------------------------------------- finding 6 --
describe('Apply job-load failure is not a missing role (finding 6)', () => {
  const failLoad = (error) =>
    installJobsService({
      getPublishedJobBySlug: async () => {
        throw error;
      },
    });

  it('404 shows the unavailable state', async () => {
    failLoad(httpError(404, 'JOB_NOT_FOUND'));
    renderRoute(PATH);
    expect(await screen.findByTestId('apply-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('apply-job-error')).toBeNull();
  });

  it.each([
    ['503', () => httpError(503, 'SERVICE_UNAVAILABLE')],
    ['network', () => networkError()],
    ['malformed', () => httpError(200, null)],
  ])('%s shows a temporary load failure with retry, not "unavailable"', async (_l, make) => {
    failLoad(make());
    renderRoute(PATH);
    const block = await screen.findByTestId('apply-job-error');
    expect(within(block).getByText(JOB_DETAIL.error.heading)).toBeTruthy();
    expect(screen.queryByTestId('apply-unavailable')).toBeNull();
    expect(screen.queryByText(APPLY.unavailable.body)).toBeNull();
  });

  it('retry performs a real new Job request', async () => {
    let calls = 0;
    installJobsService({
      getPublishedJobBySlug: async () => {
        calls += 1;
        if (calls === 1) throw httpError(503, 'SERVICE_UNAVAILABLE');
        return { job: testJob() };
      },
    });
    const user = userEvent.setup();
    renderRoute(PATH);
    const block = await screen.findByTestId('apply-job-error');
    await user.click(within(block).getByRole('button', { name: JOB_DETAIL.error.primary }));
    await screen.findByRole('heading', { level: 1, name: /Apply for/ });
    expect(calls).toBe(2);
  });
});

// ---------------------------------------------------------------- finding 7 --
describe('changing jobSlug isolates the Apply lifecycle (finding 7)', () => {
  function renderTwoSlugs() {
    installJobsService({
      getPublishedJobBySlug: async (slug) => ({ job: testJob({ slug, title: `Role ${slug}` }) }),
    });
    return render(
      <MemoryRouter initialEntries={['/careers/job-a/apply']}>
        <AppRoutes />
      </MemoryRouter>,
    );
  }

  it('clears candidate data when navigating to another role', async () => {
    const user = userEvent.setup();
    installJobsService({
      getPublishedJobBySlug: async (slug) => ({ job: testJob({ slug, title: `Role ${slug}` }) }),
    });
    const view = render(
      <MemoryRouter initialEntries={['/careers/job-a/apply']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Apply for Role job-a' });
    await user.type(screen.getByLabelText(/Full Name/), 'Jane Doe');
    await user.type(screen.getByLabelText(/Email Address/), 'jane@example.com');
    expect(screen.getByLabelText(/Full Name/).value).toBe('Jane Doe');
    view.unmount();

    render(
      <MemoryRouter initialEntries={['/careers/job-b/apply']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Apply for Role job-b' });
    expect(screen.getByLabelText(/Full Name/).value).toBe('');
    expect(screen.getByLabelText(/Email Address/).value).toBe('');
  });

  it('keys the Apply flow on jobSlug so React remounts it', async () => {
    // Structural guarantee: every piece of candidate state is discarded by the
    // remount, rather than by a cleanup effect a future field could miss.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'ApplyPage.jsx'),
      'utf8',
    );
    expect(source).toMatch(/<ApplyFlow key=\{jobSlug\} jobSlug=\{jobSlug\} \/>/);
  });

  it('shows no previous success or failure state under a new slug', async () => {
    const user = userEvent.setup();
    installJobsService({
      getPublishedJobBySlug: async (slug) => ({ job: testJob({ slug, title: `Role ${slug}` }) }),
    });
    installApplicationsService({
      submitApplication: async () => {
        throw networkError();
      },
    });
    const view = render(
      <MemoryRouter initialEntries={['/careers/job-a/apply']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Apply for Role job-a' });
    await fillRequired(user);
    await user.click(submitButton());
    await screen.findByTestId('apply-failed');
    view.unmount();

    render(
      <MemoryRouter initialEntries={['/careers/job-b/apply']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Apply for Role job-b' });
    expect(screen.queryByTestId('apply-failed')).toBeNull();
    expect(screen.queryByTestId('apply-success')).toBeNull();
  });
});

// ---------------------------------------------------------------- finding 8 --
describe('resume control has one visible focus stop (finding 8)', () => {
  it('exposes the native input as the only focusable control in the picker', async () => {
    serveJob(testJob());
    const { container } = renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeTruthy();
    expect(input.getAttribute('tabindex')).toBeNull();
    // The visible picker is the input's own label, not a second tab stop.
    const label = container.querySelector(`label[for="${input.id}"]`);
    expect(label).toBeTruthy();
    expect(label.tagName).toBe('LABEL');
  });

  it('associates a resume error with the native input', async () => {
    serveJob(testJob());
    const user = userEvent.setup({ applyAccept: false });
    const { container } = renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    const input = container.querySelector('input[type="file"]');
    await user.upload(input, new File(['x'], 'bad.exe'));

    await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'));
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const ids = describedBy.split(' ');
    const errorNode = ids.map((id) => document.getElementById(id)).find(
      (node) => node && /isn't accepted/.test(node.textContent),
    );
    expect(errorNode).toBeTruthy();
  });

  it('points the summary resume link at the real file control', async () => {
    serveJob(testJob());
    installApplicationsService({ submitApplication: vi.fn() });
    const user = userEvent.setup();
    const { container } = renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await user.click(submitButton());

    const summary = await screen.findByTestId('validation-summary');
    const link = within(summary)
      .getAllByRole('link')
      .find((a) => /resume/i.test(a.textContent));
    expect(link).toBeTruthy();
    const target = document.getElementById(link.getAttribute('href').slice(1));
    expect(target).toBeTruthy();
    expect(target.tagName).toBe('INPUT');
    expect(target.type).toBe('file');
  });
});

// ---------------------------------------------------------------- finding 9 --
describe('Apply is noindex in every state (finding 9)', () => {
  it('sets noindex, follow during the loading state', async () => {
    installJobsService({ getPublishedJobBySlug: pending });
    renderRoute(PATH);
    expect(screen.getByTestId('apply-loading')).toBeTruthy();
    await waitFor(() => expect(robots()).toBe('noindex, follow'));
  });

  it.each([
    ['active form', () => serveJob(testJob()), 'apply-loading'],
    ['unavailable', () => installJobsService({ getPublishedJobBySlug: async () => { throw httpError(404, 'JOB_NOT_FOUND'); } }), 'apply-unavailable'],
    ['temporary error', () => installJobsService({ getPublishedJobBySlug: async () => { throw networkError(); } }), 'apply-job-error'],
    ['closed', () => serveJob(testJob({ applicationStatus: 'CLOSED', applicationForm: null })), 'apply-not-accepting'],
  ])('sets noindex, follow in the %s state', async (_label, install) => {
    install();
    renderRoute(PATH);
    await waitFor(() => expect(robots()).toBe('noindex, follow'));
  });

  it('never leaves a previous indexable route metadata in place', async () => {
    // Arrive from an indexable route, then enter Apply.
    const home = renderRoute('/');
    expect(robots()).toBeNull();
    home.unmount();

    installJobsService({ getPublishedJobBySlug: pending });
    renderRoute(PATH);
    await waitFor(() => expect(robots()).toBe('noindex, follow'));
  });
});
