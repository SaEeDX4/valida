import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  renderRoute, installJobsService, installApplicationsService, resetServices,
  httpError, networkError, pending, testJob,
} from '../test/renderRoute.jsx';
import { findAccessibilityViolations } from '../test/axe.js';
import { APPLY, applyTitle, applyHeading, successBody } from './ApplyPage.content.js';

const SLUG = 'cybersecurity-specialist';
const PATH = `/careers/${SLUG}/apply`;

const serveJob = (job) => installJobsService({ getPublishedJobBySlug: async () => ({ job }) });

const pdf = (name = 'resume.pdf', size = 1024) => {
  const file = new File(['x'], name, { type: 'application/pdf' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

async function fillRequiredFields(user) {
  await user.type(screen.getByLabelText(/Full Name/), 'Jane Doe');
  await user.type(screen.getByLabelText(/Email Address/), 'jane@example.com');
  await user.upload(screen.getByLabelText(/Upload Resume/), pdf());
}

const submitButton = () => screen.getByRole('button', { name: new RegExp(APPLY.submit, 'i') });
/* After a failed submission the canonical action becomes "Try Again" (Doc 06
   section 145), so the retry path looks for that label. */
const retryButton = () => screen.getByRole('button', { name: new RegExp(APPLY.failure.cta, 'i') });

beforeEach(() => {
  window.scrollTo = vi.fn();
});
afterEach(() => resetServices());

describe('Apply — eligibility gate', () => {
  it('renders the active form only for an OPEN job with a form configuration', async () => {
    serveJob(testJob());
    renderRoute(PATH);
    expect(await screen.findByRole('heading', { level: 1, name: applyHeading('Cybersecurity Specialist') })).toBeTruthy();
    expect(screen.getByLabelText(/Full Name/)).toBeTruthy();
  });

  it('renders no form for a CLOSED job and never reconstructs one', async () => {
    serveJob(testJob({ applicationStatus: 'CLOSED', applicationForm: null }));
    const { container } = renderRoute(PATH);
    await screen.findByTestId('apply-not-accepting');
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it('shows the neutral unavailable state for an unknown job, with no form', async () => {
    installJobsService({
      getPublishedJobBySlug: async () => {
        throw httpError(404, 'JOB_NOT_FOUND');
      },
    });
    const { container } = renderRoute(PATH);
    const block = await screen.findByTestId('apply-unavailable');
    expect(within(block).getByText(APPLY.unavailable.heading)).toBeTruthy();
    expect(container.querySelector('form')).toBeNull();
    expect(container.textContent).not.toMatch(/draft|archived|mongo|_id/i);
  });

  it('shows a loading state while the job is fetched', () => {
    installJobsService({ getPublishedJobBySlug: pending });
    renderRoute(PATH);
    expect(screen.getByTestId('apply-loading')).toBeTruthy();
  });

  it('is marked noindex, follow', async () => {
    serveJob(testJob());
    renderRoute(PATH);

    await screen.findByRole('heading', {
      level: 1,
      name: applyHeading('Cybersecurity Specialist'),
    });

    await waitFor(() => {
      expect(
        document
          .querySelector('meta[name="robots"]')
          ?.getAttribute('content'),
      ).toBe('noindex, follow');

      expect(document.title).toBe(applyTitle('Cybersecurity Specialist'));
    });
  });
});

describe('Apply — canonical structure and copy', () => {
  beforeEach(() => serveJob(testJob()));

  it('renders the canonical eyebrow, intro and job context', async () => {
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText(APPLY.eyebrow)).toBeTruthy();
    expect(screen.getByText(APPLY.intro)).toBeTruthy();
    expect(screen.getByText(APPLY.jobContextLabel)).toBeTruthy();
  });

  it('provides a Back to Role link with the canonical accessible name', async () => {
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    const back = screen.getByRole('link', { name: 'Back to Cybersecurity Specialist' });
    expect(back.getAttribute('href')).toBe(`/careers/${SLUG}`);
  });

  it('links to the Privacy Notice', async () => {
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('link', { name: APPLY.privacy.linkLabel }).getAttribute('href')).toBe('/privacy');
  });

  it('renders no unpopulated template token', async () => {
    const { container } = renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    expect(container.textContent).not.toMatch(/\{job\.|\{file\.|\{allowedFileTypes\}|\{maxFileSize\}/);
  });
});

describe('Apply — conditional fields', () => {
  it('omits phone and message when the job configuration disables them', async () => {
    serveJob(testJob());
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByLabelText(/Phone Number/)).toBeNull();
    expect(screen.queryByLabelText(/^Message/)).toBeNull();
  });

  it('renders phone and message when the configuration enables them', async () => {
    serveJob(testJob({
      applicationForm: {
        ...testJob().applicationForm,
        phone: { enabled: true, required: false },
        message: { enabled: true, required: false, maxLength: 5000 },
      },
    }));
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByLabelText(/Phone Number/)).toBeTruthy();
    expect(screen.getByLabelText(/Message/)).toBeTruthy();
  });

  it('applies the configured message maxLength rather than a duplicated constant', async () => {
    serveJob(testJob({
      applicationForm: {
        ...testJob().applicationForm,
        message: { enabled: true, required: false, maxLength: 1200 },
      },
    }));
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByLabelText(/Message/).getAttribute('maxlength')).toBe('1200');
  });

  it('renders no screening section when the job configures none', async () => {
    serveJob(testJob());
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText(APPLY.screening.heading)).toBeNull();
  });

  it('renders all four supported screening types from real configuration', async () => {
    serveJob(testJob({
      applicationForm: {
        ...testJob().applicationForm,
        screeningQuestions: [
          { id: 'a', type: 'SHORT_TEXT', prompt: 'Short question', required: true, options: [] },
          { id: 'b', type: 'LONG_TEXT', prompt: 'Long question', required: false, options: [] },
          { id: 'c', type: 'YES_NO', prompt: 'Yes or no question', required: true, options: [] },
          {
            id: 'd', type: 'SINGLE_SELECT', prompt: 'Select question', required: true,
            options: [
              { optionId: 'one', label: 'One' },
              { optionId: 'two', label: 'Two' },
            ],
          },
        ],
      },
    }));
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByLabelText(/Short question/)).toBeTruthy();
    expect(screen.getByLabelText(/Long question/)).toBeTruthy();
    expect(screen.getByRole('radiogroup')).toBeTruthy();
    const select = screen.getByLabelText(/Select question/);
    expect(select.tagName).toBe('SELECT');
    // Values are option IDENTIFIERS; the visible text is the label (Doc 10).
    expect([...select.options].map((o) => o.value)).toEqual(['', 'one', 'two']);
    expect([...select.options].map((o) => o.textContent)).toEqual(['Select an option', 'One', 'Two']);
  });

  it('derives screening control ids from the question id, not the array index', async () => {
    serveJob(testJob({
      applicationForm: {
        ...testJob().applicationForm,
        screeningQuestions: [
          { id: 'stable-question-id', type: 'SHORT_TEXT', prompt: 'Question', required: false, options: [] },
        ],
      },
    }));
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByLabelText(/Question/).id).toBe('screening-stable-question-id');
  });

  it('ignores an unsupported screening type rather than guessing', async () => {
    serveJob(testJob({
      applicationForm: {
        ...testJob().applicationForm,
        screeningQuestions: [{ id: 'x', type: 'FILE_UPLOAD', prompt: 'Unsupported', required: true, options: [] }],
      },
    }));
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByLabelText(/Unsupported/)).toBeNull();
  });
});

describe('Apply — client validation', () => {
  beforeEach(() => serveJob(testJob()));

  it('does not show errors before the candidate submits', async () => {
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByTestId('validation-summary')).toBeNull();
    expect(screen.queryByText('Enter your full name.')).toBeNull();
  });

  it('blocks submission and shows the canonical summary when required fields are empty', async () => {
    const user = userEvent.setup();
    const submitApplication = vi.fn();
    installApplicationsService({ submitApplication });
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await user.click(submitButton());

    const summary = await screen.findByTestId('validation-summary');
    expect(within(summary).getByText(APPLY.validationSummary.heading)).toBeTruthy();
    expect(within(summary).getByText(APPLY.validationSummary.body)).toBeTruthy();
    expect(submitApplication).not.toHaveBeenCalled();
  });

  it('moves focus to the validation summary', async () => {
    const user = userEvent.setup();
    installApplicationsService({ submitApplication: vi.fn() });
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await user.click(submitButton());
    const summary = await screen.findByTestId('validation-summary');
    await waitFor(() => expect(document.activeElement).toBe(summary));
  });

  it('associates each error with its own control, not colour alone', async () => {
    const user = userEvent.setup();
    installApplicationsService({ submitApplication: vi.fn() });
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await user.click(submitButton());
    const email = screen.getByLabelText(/Email Address/);
    expect(email.getAttribute('aria-invalid')).toBe('true');
    const describedBy = email.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy.split(' ').pop()).textContent).toContain(
      'Enter your email address.',
    );
  });

  it('lists invalid fields in the summary as in-page links', async () => {
    const user = userEvent.setup();
    installApplicationsService({ submitApplication: vi.fn() });
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await user.click(submitButton());
    const summary = await screen.findByTestId('validation-summary');
    const links = within(summary).getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
    expect(links.map((l) => l.getAttribute('href'))).toContain('#apply-email');
  });

  it('rejects a syntactically invalid email', async () => {
    const user = userEvent.setup();
    installApplicationsService({ submitApplication: vi.fn() });
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await user.type(screen.getByLabelText(/Full Name/), 'Jane Doe');
    await user.type(screen.getByLabelText(/Email Address/), 'not-an-email');
    await user.upload(screen.getByLabelText(/Upload Resume/), pdf());
    await user.click(submitButton());
    // The message appears on the field AND in the error summary, by design:
    // the summary must identify each invalid field and link to it.
    expect((await screen.findAllByText('Enter a valid email address.')).length).toBeGreaterThanOrEqual(2);
  });

  it('requires a resume', async () => {
    const user = userEvent.setup();
    installApplicationsService({ submitApplication: vi.fn() });
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await user.type(screen.getByLabelText(/Full Name/), 'Jane Doe');
    await user.type(screen.getByLabelText(/Email Address/), 'jane@example.com');
    await user.click(submitButton());
    expect((await screen.findAllByText('Upload your resume to continue.')).length).toBeGreaterThanOrEqual(2);
  });

  it('requires an answer to a required screening question', async () => {
    resetServices();
    serveJob(testJob({
      applicationForm: {
        ...testJob().applicationForm,
        screeningQuestions: [{ id: 'q1', type: 'SHORT_TEXT', prompt: 'Required question', required: true, options: [] }],
      },
    }));
    installApplicationsService({ submitApplication: vi.fn() });
    const user = userEvent.setup();
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequiredFields(user);
    await user.click(submitButton());
    expect((await screen.findAllByText('Answer this question to continue.')).length).toBeGreaterThanOrEqual(2);
  });
});

describe('Apply — resume selection', () => {
  beforeEach(() => serveJob(testJob()));

  it('uses a real native file input', async () => {
    const { container } = renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeTruthy();
    expect(input.getAttribute('accept')).toBe('.pdf,.docx');
    expect(screen.getByLabelText(/Upload Resume/)).toBe(input);
  });

  it('shows the instruction built from the job configuration', async () => {
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText(/Accepted file types: \.pdf, \.docx\. Maximum size: 5 MB\./)).toBeTruthy();
  });

  it('reports a selected file and offers Replace and Remove', async () => {
    const user = userEvent.setup();
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await user.upload(screen.getByLabelText(/Upload Resume/), pdf('cv.pdf'));
    expect(screen.getByText('Selected: cv.pdf')).toBeTruthy();
    expect(screen.getByText(APPLY.resume.valid)).toBeTruthy();
    // The picker is the input's <label>, not a scripted button, so there is
    // exactly one focus stop for this control.
    expect(screen.getByText(/Replace File/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Remove/ })).toBeTruthy();
  });

  it('removes a selected file', async () => {
    const user = userEvent.setup();
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await user.upload(screen.getByLabelText(/Upload Resume/), pdf('cv.pdf'));
    await user.click(screen.getByRole('button', { name: /Remove/ }));
    expect(screen.queryByText('Selected: cv.pdf')).toBeNull();
    expect(screen.getByText(/Choose File/)).toBeTruthy();
  });

  it('rejects a disallowed extension even when the accept filter is bypassed', async () => {
    // applyAccept: false simulates a file that got past the picker's accept
    // filter. accept is UX only (Doc 13), so the app's own check must catch it.
    const user = userEvent.setup({ applyAccept: false });
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    const bad = new File(['x'], 'resume.exe', { type: 'application/octet-stream' });
    await user.upload(screen.getByLabelText(/Upload Resume/), bad);
    expect(
      await screen.findByText("This file type isn't accepted. Choose a supported resume file."),
    ).toBeTruthy();
    // And the submit path must refuse it too.
    expect(screen.getByLabelText(/Upload Resume/).getAttribute('aria-invalid')).toBe('true');
  });

  it('rejects a file above the configured limit', async () => {
    const user = userEvent.setup();
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await user.upload(screen.getByLabelText(/Upload Resume/), pdf('big.pdf', 5242881));
    expect(
      await screen.findByText('This file is larger than the allowed limit. Choose a smaller file.'),
    ).toBeTruthy();
  });

  it('makes no malware, signature or storage claim', async () => {
    const user = userEvent.setup();
    const { container } = renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await user.upload(screen.getByLabelText(/Upload Resume/), pdf());
    const text = container.querySelector('main').textContent;
    [/clean/i, /malware/i, /virus/i, /scanned/i, /verified/i, /secure(ly)? stored/i, /signature/i]
      .forEach((p) => expect(text).not.toMatch(p));
  });

  it('handles a very long filename without breaking layout semantics', async () => {
    const user = userEvent.setup();
    const longName = `${'a'.repeat(180)}.pdf`;
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await user.upload(screen.getByLabelText(/Upload Resume/), pdf(longName));
    expect(screen.getByText(`Selected: ${longName}`)).toBeTruthy();
  });
});

describe('Apply — submission transport', () => {
  beforeEach(() => serveJob(testJob()));

  it('posts FormData with only the supported logical fields', async () => {
    const user = userEvent.setup();
    const submitApplication = vi.fn().mockResolvedValue({ data: {} });
    installApplicationsService({ submitApplication });
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequiredFields(user);
    await user.click(submitButton());

    await waitFor(() => expect(submitApplication).toHaveBeenCalled());
    const [slug, formData] = submitApplication.mock.calls[0];
    expect(slug).toBe(SLUG);
    expect(formData).toBeInstanceOf(FormData);
    expect(formData.get('fullName')).toBe('Jane Doe');
    expect(formData.get('email')).toBe('jane@example.com');
    expect(formData.get('resume')).toBeInstanceOf(File);
    // No client-controlled operational fields.
    ['jobId', 'id', 'status', 'submittedAt', 'createdAt', 'storageKey', 'notificationStatus']
      .forEach((field) => expect(formData.get(field)).toBeNull());
    // Disabled fields are not transmitted at all.
    expect(formData.get('phone')).toBeNull();
    expect(formData.get('message')).toBeNull();
  });

  it('sends an Idempotency-Key and never a manual multipart boundary', async () => {
    const user = userEvent.setup();
    const submitApplication = vi.fn().mockResolvedValue({ data: {} });
    installApplicationsService({ submitApplication });
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequiredFields(user);
    await user.click(submitButton());

    await waitFor(() => expect(submitApplication).toHaveBeenCalled());
    const [, , options] = submitApplication.mock.calls[0];
    expect(options.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(JSON.stringify(options)).not.toMatch(/boundary/i);
    expect(window.location.search).not.toMatch(/Idempotency/i);
  });

  it('blocks a duplicate submission while a request is in flight', async () => {
    const user = userEvent.setup();
    let resolveRequest;
    const submitApplication = vi.fn(() => new Promise((resolve) => { resolveRequest = resolve; }));
    installApplicationsService({ submitApplication });
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequiredFields(user);

    const button = submitButton();
    await user.click(button);
    await user.click(button);
    await user.click(button);

    expect(submitApplication).toHaveBeenCalledTimes(1);

    /*
     * Settling the request inside act() so the resulting state update is
     * flushed before the test ends. Resolving it bare left React updating
     * ApplyFlow after teardown, which is what produced the act() warning.
     * The canonical success payload is used so the component follows its real
     * success path rather than an artificial one.
     */
    await act(async () => {
      resolveRequest({
        data: {
          status: 'RECEIVED',
          job: { title: 'Cybersecurity Specialist', slug: SLUG },
          submittedAt: '2026-09-12T12:00:00.000Z',
        },
      });
    });
  });

  it('blocks a duplicate submission fired in the same tick, before any re-render', async () => {
    const user = userEvent.setup();
    const submitApplication = vi.fn(() => new Promise(() => {}));
    installApplicationsService({ submitApplication });
    const { container } = renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequiredFields(user);

    // Both submit events are dispatched inside ONE act(), so React does not
    // flush state between them. The loading/disabled button state and the
    // isSubmitting check cannot have taken effect yet, which leaves the
    // synchronous in-flight ref as the only thing that can stop the second
    // request. Using fireEvent twice would not test this: RTL flushes state
    // after each call, so the second would be caught by the re-rendered state.
    const form = container.querySelector('form');
    const submitEvent = () => new Event('submit', { bubbles: true, cancelable: true });
    await act(async () => {
      form.dispatchEvent(submitEvent());
      form.dispatchEvent(submitEvent());
    });

    await waitFor(() => expect(submitApplication).toHaveBeenCalled());
    expect(submitApplication).toHaveBeenCalledTimes(1);
  });

  it('reuses the key for a retry of the same logical submission', async () => {
    const user = userEvent.setup();
    const submitApplication = vi.fn().mockRejectedValue(networkError());
    installApplicationsService({ submitApplication });
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequiredFields(user);
    await user.click(submitButton());
    await screen.findByTestId('apply-failed');

    await user.click(retryButton());
    await waitFor(() => expect(submitApplication).toHaveBeenCalledTimes(2));
    const first = submitApplication.mock.calls[0][2].idempotencyKey;
    const second = submitApplication.mock.calls[1][2].idempotencyKey;
    expect(second).toBe(first);
  });

  it('uses a new key once the candidate changes the submission', async () => {
    const user = userEvent.setup();
    const submitApplication = vi.fn().mockRejectedValue(networkError());
    installApplicationsService({ submitApplication });
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequiredFields(user);
    await user.click(submitButton());
    await screen.findByTestId('apply-failed');

    await user.type(screen.getByLabelText(/Email Address/), '.uk');
    await user.click(retryButton());
    await waitFor(() => expect(submitApplication).toHaveBeenCalledTimes(2));
    expect(submitApplication.mock.calls[1][2].idempotencyKey).not.toBe(
      submitApplication.mock.calls[0][2].idempotencyKey,
    );
  });

  it('shows the submitting state and announces it', async () => {
    const user = userEvent.setup();
    installApplicationsService({ submitApplication: () => new Promise(() => {}) });
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequiredFields(user);
    await user.click(submitButton());
    expect(await screen.findByText(APPLY.submittingStatus)).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(APPLY.submitting) })).toBeTruthy();
  });

  it('keeps the entered data while submitting', async () => {
    const user = userEvent.setup();
    installApplicationsService({ submitApplication: () => new Promise(() => {}) });
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequiredFields(user);
    await user.click(submitButton());
    expect(screen.getByLabelText(/Full Name/).value).toBe('Jane Doe');
    expect(screen.getByLabelText(/Email Address/).value).toBe('jane@example.com');
  });
});

describe('Apply — outcome mapping', () => {
  beforeEach(() => serveJob(testJob()));

  it('shows success ONLY after the service resolves', async () => {
    const user = userEvent.setup();
    installApplicationsService({ submitApplication: async () => ({ data: { id: 'x' } }) });
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequiredFields(user);
    await user.click(submitButton());

    const success = await screen.findByTestId('apply-success');
    expect(within(success).getByText(APPLY.success.eyebrow)).toBeTruthy();
    expect(within(success).getByRole('heading', { level: 1, name: APPLY.success.heading })).toBeTruthy();
    expect(within(success).getByText(successBody('Cybersecurity Specialist'))).toBeTruthy();
  });

  it('makes no prohibited promise in the success copy', async () => {
    const user = userEvent.setup();
    installApplicationsService({ submitApplication: async () => ({ data: {} }) });
    const { container } = renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequiredFields(user);
    await user.click(submitButton());
    await screen.findByTestId('apply-success');
    const text = container.querySelector('main').textContent;
    [/interview is confirmed/i, /within \d+ (business )?days/i, /next stage/i, /shortlist/i]
      .forEach((p) => expect(text).not.toMatch(p));
  });

  it.each([
    ['network failure', () => networkError()],
    ['HTTP 500', () => httpError(500, 'INTERNAL_ERROR')],
    ['HTTP 502', () => httpError(502, null)],
  ])('never shows success on %s', async (_label, makeError) => {
    const user = userEvent.setup();
    installApplicationsService({
      submitApplication: async () => {
        throw makeError();
      },
    });
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequiredFields(user);
    await user.click(submitButton());

    expect(await screen.findByTestId('apply-failed')).toBeTruthy();
    expect(screen.queryByTestId('apply-success')).toBeNull();
    expect(screen.queryByText(APPLY.success.eyebrow)).toBeNull();
  });

  it('preserves entered data after a failure', async () => {
    const user = userEvent.setup();
    installApplicationsService({
      submitApplication: async () => {
        throw networkError();
      },
    });
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequiredFields(user);
    await user.click(submitButton());
    await screen.findByTestId('apply-failed');
    expect(screen.getByLabelText(/Full Name/).value).toBe('Jane Doe');
    expect(screen.getByLabelText(/Email Address/).value).toBe('jane@example.com');
    expect(screen.getByText('Selected: resume.pdf')).toBeTruthy();
  });

  it('maps server field errors onto the right controls', async () => {
    const user = userEvent.setup();
    installApplicationsService({
      submitApplication: async () => {
        throw httpError(422, 'VALIDATION_FAILED', {
          message: 'Some information needs to be corrected.',
          fieldErrors: [{ field: 'email', code: 'INVALID_EMAIL', message: 'Enter a valid email address.' }],
        });
      },
    });
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequiredFields(user);
    await user.click(submitButton());
    await waitFor(() => expect(screen.getByLabelText(/Email Address/).getAttribute('aria-invalid')).toBe('true'));
    // The message appears on the field and in the summary, as with client
    // validation.
    expect((await screen.findAllByText('Enter a valid email address.')).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId('apply-success')).toBeNull();
  });

  it('shows the dedicated closed state for 409 JOB_NOT_ACCEPTING_APPLICATIONS', async () => {
    const user = userEvent.setup();
    installApplicationsService({
      submitApplication: async () => {
        throw httpError(409, 'JOB_NOT_ACCEPTING_APPLICATIONS');
      },
    });
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequiredFields(user);
    await user.click(submitButton());

    const block = await screen.findByTestId('apply-closed-during');
    expect(within(block).getByText(APPLY.closedDuringApplication.heading)).toBeTruthy();
    expect(within(block).getByText(APPLY.closedDuringApplication.body)).toBeTruthy();
    // Not folded into the generic failure, and certainly not success.
    expect(screen.queryByTestId('apply-failed')).toBeNull();
    expect(screen.queryByTestId('apply-success')).toBeNull();
  });

  it('shows the safe rate-limit copy for 429 without exposing thresholds', async () => {
    const user = userEvent.setup();
    installApplicationsService({
      submitApplication: async () => {
        throw httpError(429, 'RATE_LIMITED');
      },
    });
    const { container } = renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequiredFields(user);
    await user.click(submitButton());
    expect(await screen.findByTestId('apply-ratelimited')).toBeTruthy();
    expect(screen.getByText(APPLY.rateLimited)).toBeTruthy();
    // Targets rate-limit threshold language specifically. A bare "per hour"
    // would now match the compensation fact in the Job context summary.
    expect(container.textContent).not.toMatch(
      /\d+\s*(requests?|attempts?|submissions?)\s*per\b|rate limit of|threshold|retry after \d+/i,
    );
  });

  it('leaks no internal error detail on failure', async () => {
    const user = userEvent.setup();
    installApplicationsService({
      submitApplication: async () => {
        throw httpError(500, 'INTERNAL_ERROR');
      },
    });
    const { container } = renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequiredFields(user);
    await user.click(submitButton());
    await screen.findByTestId('apply-failed');
    expect(container.textContent).not.toMatch(/stack|ECONNREFUSED|at \/|mongo|storage key/i);
  });
});

describe('Apply — personal data handling', () => {
  it('writes no candidate data to browser storage or the URL', async () => {
    serveJob(testJob());
    const user = userEvent.setup();
    const setLocal = vi.spyOn(Storage.prototype, 'setItem');
    installApplicationsService({ submitApplication: async () => ({ data: {} }) });
    renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequiredFields(user);
    await user.click(submitButton());
    await screen.findByTestId('apply-success');

    expect(setLocal).not.toHaveBeenCalled();
    expect(window.location.href).not.toMatch(/jane@example\.com|Jane%20Doe|Jane\+Doe/);
    setLocal.mockRestore();
  });
});

describe('Apply — accessibility', () => {
  it('has no axe violations on the initial form', async () => {
    serveJob(testJob());
    const { container } = renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });

  it('has no axe violations with validation errors shown', async () => {
    serveJob(testJob());
    installApplicationsService({ submitApplication: vi.fn() });
    const user = userEvent.setup();
    const { container } = renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await user.click(submitButton());
    await screen.findByTestId('validation-summary');
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });

  it('has no axe violations on the success state', async () => {
    serveJob(testJob());
    installApplicationsService({ submitApplication: async () => ({ data: {} }) });
    const user = userEvent.setup();
    const { container } = renderRoute(PATH);
    await screen.findByRole('heading', { level: 1 });
    await fillRequiredFields(user);
    await user.click(submitButton());
    await screen.findByTestId('apply-success');
    expect(await findAccessibilityViolations(container)).toEqual([]);
  });
});
