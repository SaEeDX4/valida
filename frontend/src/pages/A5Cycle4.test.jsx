import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  renderRoute, installJobsService, installApplicationsService, resetServices, httpError, testJob,
} from '../test/renderRoute.jsx';
import { APPLY } from './ApplyPage.content.js';

/** Cycle 4 regression coverage: findings 1 (UI), 2 and 3. */
const SLUG = 'cybersecurity-specialist';
const APPLY_PATH = `/careers/${SLUG}/apply`;

const OPTIONS = [
  { optionId: 'opt-remote', label: 'Fully remote' },
  { optionId: 'opt-hybrid', label: 'Hybrid' },
];

const jobWithSelect = () =>
  testJob({
    applicationForm: {
      ...testJob().applicationForm,
      screeningQuestions: [
        { id: 'q-select', type: 'SINGLE_SELECT', prompt: 'Preferred arrangement', required: true, options: OPTIONS },
        { id: 'q-short', type: 'SHORT_TEXT', prompt: 'Short question', required: false, options: [] },
      ],
    },
  });

const serveJob = (job) => installJobsService({ getPublishedJobBySlug: async () => ({ job }) });
const pdf = () => {
  const f = new File(['x'], 'resume.pdf', { type: 'application/pdf' });
  Object.defineProperty(f, 'size', { value: 1024 });
  return f;
};
const submitButton = () => screen.getByRole('button', { name: new RegExp(APPLY.submit, 'i') });

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
describe('SINGLE_SELECT renders labels and transports optionIds (finding 1)', () => {
  it('shows labels while using identifiers as option values', async () => {
    serveJob(jobWithSelect());
    renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });

    const select = screen.getByLabelText(/Preferred arrangement/);
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Select an option', 'Fully remote', 'Hybrid',
    ]);
    expect([...select.options].map((o) => o.value)).toEqual(['', 'opt-remote', 'opt-hybrid']);
  });

  it('stores the optionId in state when the candidate chooses a label', async () => {
    serveJob(jobWithSelect());
    const user = userEvent.setup();
    renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });

    const select = screen.getByLabelText(/Preferred arrangement/);
    await user.selectOptions(select, 'opt-hybrid');
    expect(select.value).toBe('opt-hybrid');
  });

  it('submits the optionId in multipart screeningAnswers, never the label', async () => {
    serveJob(jobWithSelect());
    const submitApplication = vi.fn().mockResolvedValue({ data: {} });
    installApplicationsService({ submitApplication });
    const user = userEvent.setup();
    renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });

    await fillRequired(user);
    await user.selectOptions(screen.getByLabelText(/Preferred arrangement/), 'opt-hybrid');
    await user.click(submitButton());

    await waitFor(() => expect(submitApplication).toHaveBeenCalled());
    const formData = submitApplication.mock.calls[0][1];
    const answers = JSON.parse(formData.get('screeningAnswers'));
    expect(answers).toContainEqual({ questionId: 'q-select', answer: 'opt-hybrid' });
    expect(formData.get('screeningAnswers')).not.toContain('Hybrid');
  });

  it('blocks submission when nothing is selected for a required question', async () => {
    serveJob(jobWithSelect());
    const submitApplication = vi.fn();
    installApplicationsService({ submitApplication });
    const user = userEvent.setup();
    renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });

    await fillRequired(user);
    await user.click(submitButton());
    expect(submitApplication).not.toHaveBeenCalled();
    expect((await screen.findAllByText('Answer this question to continue.')).length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------- finding 2 --
describe('server screening errors attach to the right control (finding 2)', () => {
  const serverError = (field) =>
    installApplicationsService({
      submitApplication: async () => {
        throw httpError(422, 'VALIDATION_FAILED', {
          message: 'INTERNAL: db constraint on applications.screening',
          fieldErrors: [{ field, code: 'INVALID', message: 'Answer this question to continue.' }],
        });
      },
    });

  const submitWithSelection = async (user) => {
    await fillRequired(user);
    await user.selectOptions(screen.getByLabelText(/Preferred arrangement/), 'opt-remote');
    await user.click(submitButton());
  };

  it('maps screeningAnswers.<id> onto the screening control', async () => {
    serveJob(jobWithSelect());
    serverError('screeningAnswers.q-select');
    const user = userEvent.setup();
    renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });
    await submitWithSelection(user);

    const select = screen.getByLabelText(/Preferred arrangement/);
    await waitFor(() => expect(select.getAttribute('aria-invalid')).toBe('true'));
  });

  it('points the validation summary at the real screening control', async () => {
    serveJob(jobWithSelect());
    serverError('screeningAnswers.q-select');
    const user = userEvent.setup();
    renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });
    await submitWithSelection(user);

    const summary = await screen.findByTestId('validation-summary');
    const link = within(summary).getAllByRole('link')[0];
    const target = document.getElementById(link.getAttribute('href').slice(1));
    expect(target).toBeTruthy();
    expect(target).toBe(screen.getByLabelText(/Preferred arrangement/));
  });

  it('gives a server screening error the same summary and focus behaviour', async () => {
    serveJob(jobWithSelect());
    serverError('screeningAnswers.q-select');
    const user = userEvent.setup();
    renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });
    await submitWithSelection(user);

    const summary = await screen.findByTestId('validation-summary');
    expect(within(summary).getByText(APPLY.validationSummary.heading)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(summary));
  });

  it('creates no broken anchor for an unknown server field path', async () => {
    serveJob(jobWithSelect());
    serverError('internal.db.column');
    const user = userEvent.setup();
    const { container } = renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });
    await submitWithSelection(user);

    // Nothing mappable, so this becomes a plain failure rather than a summary
    // whose links point nowhere.
    expect(await screen.findByTestId('apply-failed')).toBeTruthy();
    expect(screen.queryByTestId('validation-summary')).toBeNull();
    expect(container.textContent).not.toMatch(/internal\.db\.column|constraint/);
  });

  it('never renders the raw internal server message', async () => {
    serveJob(jobWithSelect());
    serverError('email');
    const user = userEvent.setup();
    const { container } = renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });
    await submitWithSelection(user);
    await screen.findByTestId('validation-summary');
    expect(container.textContent).not.toMatch(/INTERNAL:|db constraint/);
  });
});

// ---------------------------------------------------------------- finding 3 --
describe('dev fixtures are installed before the first render (finding 3)', () => {
  const mainSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'main.jsx'),
    'utf8',
  );

  it('awaits the fixture installer inside the DEV-gated branch', () => {
    expect(mainSource).toMatch(
      /if \(import\.meta\.env\.DEV && import\.meta\.env\.VITE_ENABLE_A5_FIXTURES === 'true'\)/,
    );
    expect(mainSource).toMatch(/await import\('\.\/dev\/installDevFixtures\.js'\)/);
  });

  it('renders only after installation, inside an async bootstrap', () => {
    // Ordering is what removes the race: install, then render.
    const installIndex = mainSource.indexOf('installDevFixtures()');
    const renderIndex = mainSource.indexOf('createRoot(');
    expect(installIndex).toBeGreaterThan(-1);
    expect(renderIndex).toBeGreaterThan(installIndex);
    expect(mainSource).toMatch(/async function bootstrap\(\)/);
    expect(mainSource).toMatch(/bootstrap\(\);/);
  });

  it('does not render in a floating then() alongside the import', () => {
    // The previous shape started the import and rendered immediately after.
    expect(mainSource).not.toMatch(/import\('\.\/dev\/installDevFixtures\.js'\)\.then/);
  });

  it('keeps the fixture module out of the static import graph', () => {
    expect(mainSource).not.toMatch(/^import .*installDevFixtures/m);
  });
});

// ---------------------------------------------------------- cycle 5, finding 2
describe('server screening errors only target configured questions (cycle 5)', () => {
  const jobWithQuestion = () =>
    testJob({
      applicationForm: {
        ...testJob().applicationForm,
        screeningQuestions: [
          { id: 'q-known', type: 'SHORT_TEXT', prompt: 'Known question', required: false, options: [] },
        ],
      },
    });

  const failWith = (fieldErrors) =>
    installApplicationsService({
      submitApplication: async () => {
        throw httpError(422, 'VALIDATION_FAILED', {
          message: 'Some information needs to be corrected.',
          fieldErrors,
        });
      },
    });

  it('attaches an error for a configured question and links to its control', async () => {
    installJobsService({ getPublishedJobBySlug: async () => ({ job: jobWithQuestion() }) });
    failWith([{ field: 'screeningAnswers.q-known', code: 'REQUIRED', message: 'Answer this question to continue.' }]);
    const user = userEvent.setup();
    renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequired(user);
    await user.click(submitButton());

    const control = await screen.findByLabelText(/Known question/);
    await waitFor(() => expect(control.getAttribute('aria-invalid')).toBe('true'));

    const summary = screen.getByTestId('validation-summary');
    const link = within(summary)
      .getAllByRole('link')
      .find((a) => a.getAttribute('href') === '#screening-q-known');
    expect(link).toBeTruthy();
    expect(document.getElementById('screening-q-known')).toBeTruthy();
  });

  it('creates no anchor for a question the active form does not configure', async () => {
    installJobsService({ getPublishedJobBySlug: async () => ({ job: jobWithQuestion() }) });
    failWith([{ field: 'screeningAnswers.q-unknown', code: 'REQUIRED', message: 'Ignored.' }]);
    const user = userEvent.setup();
    const { container } = renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequired(user);
    await user.click(submitButton());

    // Unknown-only errors become the safe form-level failure.
    expect(await screen.findByTestId('apply-failed')).toBeTruthy();
    expect(container.querySelector('a[href="#screening-q-unknown"]')).toBeNull();
    expect(container.textContent).not.toMatch(/screeningAnswers\./);
  });

  it('renders known errors while dropping an unknown path', async () => {
    installJobsService({ getPublishedJobBySlug: async () => ({ job: jobWithQuestion() }) });
    failWith([
      { field: 'email', code: 'INVALID_EMAIL', message: 'Enter a valid email address.' },
      { field: 'screeningAnswers.q-unknown', code: 'REQUIRED', message: 'Ignored.' },
    ]);
    const user = userEvent.setup();
    const { container } = renderRoute(APPLY_PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequired(user);
    await user.click(submitButton());

    await waitFor(() => expect(screen.getByLabelText(/Email Address/).getAttribute('aria-invalid')).toBe('true'));
    expect(container.querySelector('a[href="#screening-q-unknown"]')).toBeNull();
  });
});
