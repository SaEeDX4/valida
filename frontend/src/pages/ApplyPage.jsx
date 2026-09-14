import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import Container from '../components/layout/Container/Container.jsx';
import Section, { SectionEyebrow } from '../components/layout/Section/Section.jsx';
import Button from '../components/ui/Button/Button.jsx';
import TextLink from '../components/ui/TextLink/TextLink.jsx';
import Surface from '../components/ui/Surface/Surface.jsx';
import Field from '../components/ui/Field/Field.jsx';
import TextInput from '../components/ui/TextInput/TextInput.jsx';
import TextArea from '../components/ui/TextArea/TextArea.jsx';
import Alert from '../components/ui/Alert/Alert.jsx';
import StatusMessage from '../components/ui/StatusMessage/StatusMessage.jsx';
import LoadingSkeleton from '../components/ui/LoadingSkeleton/LoadingSkeleton.jsx';
import PageMeta from '../components/seo/PageMeta.jsx';
import ResumeField from '../features/applications/components/ResumeField.jsx';
import ScreeningQuestions from '../features/applications/components/ScreeningQuestions.jsx';
import ValidationSummary from '../features/applications/components/ValidationSummary.jsx';
import useApplicationSubmission, { SUBMIT_STATUS } from '../features/applications/hooks/useApplicationSubmission.js';
import { validateApplication } from '../features/applications/validation/applicationValidation.js';
import { validateResumeFile } from '../features/applications/validation/resumeValidation.js';
import buildApplicationFormData from '../features/applications/utils/buildApplicationFormData.js';
import { getJobsService } from '../features/jobs/api/jobsService.js';
import useAsyncResource, { RESOURCE_STATUS } from '../features/jobs/hooks/useAsyncResource.js';
import { isJobOpen } from '../features/jobs/utils/formatJob.js';
import resolveJobMarketPresentation, {
  buildRegionalJobFacts,
} from '../features/jobs/utils/resolveJobMarketPresentation.js';
import useActiveRegion from '../features/jobs/hooks/useActiveRegion.js';
import { ROUTES, jobRoute } from '../routes/paths.js';
import { APPLY, applyTitle, applyHeading, backToRoleLabel, successBody } from './ApplyPage.content.js';
import { JOB_DETAIL } from './JobDetailPage.content.js';

/** Apply is never indexable, in any state (Doc 16 policy). */
const APPLY_ROBOTS = 'noindex, follow';
import styles from './ApplyPage.module.css';

/**
 * Apply — Doc 18 section 70, Doc 05 sections 107-125, Doc 06 sections 109-153.
 *
 * FLOW: read jobSlug → fetch Job → confirm frontend-visible eligibility →
 * render context + form → client UX validation → POST → mapped state.
 *
 * ELIGIBILITY: the active form renders only when the API reports OPEN and
 * supplies an applicationForm. A CLOSED Job carries applicationForm: null and
 * the form is never reconstructed client-side (Doc 09 section 65). An unknown
 * or nonpublic slug produces the neutral unavailable state without revealing
 * Draft/Archived.
 *
 * SUCCESS: rendered only when useApplicationSubmission reports SUCCESS, which
 * happens only after the application service resolves. No validation pass,
 * timeout, rejection or missing backend can reach it.
 *
 * PERSONAL DATA: form state lives in memory only. Nothing is written to
 * localStorage, sessionStorage or the URL, and no candidate value is logged.
 */
/**
 * Route wrapper.
 *
 * FINDING 7 — per-slug isolation. React reuses the same component instance when
 * only a route parameter changes, so navigating /careers/job-a/apply →
 * /careers/job-b/apply would otherwise carry the previous candidate's name,
 * email, phone, message, screening answers, resume, errors, submission status
 * and idempotency key into a different Job.
 *
 * Keying the inner component on jobSlug makes React unmount and remount it, so
 * every piece of that state is discarded structurally rather than by a cleanup
 * effect that could be forgotten when a new field is added. It also guarantees
 * a previous SUCCESS or FAILED screen cannot linger while the next Job loads.
 *
 * Nothing is persisted to browser storage, so there is nothing else to clear.
 */
export default function ApplyPage() {
  const { jobSlug } = useParams();
  return <ApplyFlow key={jobSlug} jobSlug={jobSlug} />;
}

function ApplyFlow({ jobSlug }) {
  const { region, withRegion } = useActiveRegion();
  const loadJob = useCallback(
    ({ signal }) => getJobsService().getPublishedJobBySlug(jobSlug, { signal }),
    [jobSlug],
  );
  const { status: jobStatus, data, error: jobError, reload: reloadJob } = useAsyncResource(loadJob, [jobSlug]);
  const job = data?.job ?? null;
  const applicationForm = job?.applicationForm ?? null;

  const [values, setValues] = useState({
    fullName: '', email: '', phone: '', message: '', screeningAnswers: {},
  });
  const [touched, setTouched] = useState({});
  const [clientErrors, setClientErrors] = useState({});
  const [resumeFile, setResumeFile] = useState(null);
  const [resumeError, setResumeError] = useState(null);
  const [showSummary, setShowSummary] = useState(false);
  const [resumeInputId, setResumeInputId] = useState(null);
  const summaryRef = useRef(null);

  /*
   * The ids of the screening questions this form actually renders.
   *
   * Passed to the submission hook so a server field error naming a question
   * that is not on screen — backend drift, or a Job reconfigured between load
   * and submit — cannot produce a validation-summary link to an anchor that
   * does not exist. Memoised so the submit callback keeps a stable identity.
   */
  const screeningQuestionIds = useMemo(
    () =>
      (Array.isArray(applicationForm?.screeningQuestions) ? applicationForm.screeningQuestions : [])
        .map((question) => question?.id)
        .filter((id) => typeof id === 'string' && id.trim()),
    [applicationForm],
  );

  const submission = useApplicationSubmission(jobSlug, { screeningQuestionIds });

  // Server field errors override client ones for the same field.
  const errors = useMemo(
    () => ({ ...clientErrors, ...submission.fieldErrors }),
    [clientErrors, submission.fieldErrors],
  );

  /*
   * FINDING 5A — server-side field validation gets the same treatment as
   * client-side: the canonical summary appears and receives focus, so a
   * keyboard or screen-reader user is taken to the problem instead of being
   * left at the submit button with errors further up the page.
   */
  const serverValidationFailed = submission.status === SUBMIT_STATUS.FIELD_ERRORS;
  const summaryVisible = showSummary || serverValidationFailed;

  useEffect(() => {
    if (summaryVisible) summaryRef.current?.focus();
  }, [summaryVisible]);

  const setValue = (name, value) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    // Editing after a failure begins a new logical submission, so the next
    // attempt gets a fresh idempotency key.
    submission.beginNewLogicalSubmission();
  };

  const handleScreeningChange = (questionId, value) => {
    setValues((prev) => ({
      ...prev,
      screeningAnswers: { ...prev.screeningAnswers, [questionId]: value },
    }));
    submission.beginNewLogicalSubmission();
  };

  const handleResumeSelect = (file) => {
    setResumeFile(file);
    // Immediate feedback on selection is appropriate; this is the one field
    // where waiting for submit would waste the candidate's time.
    setResumeError(file ? validateResumeFile(file, applicationForm?.resume) : null);
    submission.beginNewLogicalSubmission();
  };

  const handleBlur = (name) => setTouched((prev) => ({ ...prev, [name]: true }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submission.isSubmitting) return;

    const found = validateApplication({
      values, applicationForm, resumeError, hasResume: Boolean(resumeFile),
    });
    setClientErrors(found);

    if (Object.keys(found).length > 0) {
      setShowSummary(true);
      return;
    }
    setShowSummary(false);

    await submission.submit(
      buildApplicationFormData({ values, applicationForm, resumeFile }),
    );
  };

  // ---------------------------------------------------------------- states --
  if (jobStatus === RESOURCE_STATUS.LOADING) {
    return (
      <>
        {/*
          FINDING 9 — Apply is noindex from the very first render. Without a
          PageMeta here, a direct visit would briefly have no robots directive,
          and an in-app navigation would keep the previous route's metadata
          until the Job resolved.
        */}
        <PageMeta title="Apply | Valida" robots={APPLY_ROBOTS} />
        <Section spacing="lg">
          <Container width="standard">
            <StatusMessage visible={false}>{APPLY.loadingStatus}</StatusMessage>
            <div aria-hidden="true" data-testid="apply-loading">
              <LoadingSkeleton lines={5} label="" />
            </div>
          </Container>
        </Section>
      </>
    );
  }

  /*
   * FINDING 6 — a service failure is not a missing role.
   *
   * Only a genuine 404 / JOB_NOT_FOUND means the role is not published. A
   * network drop, a 503 or a malformed payload says nothing about whether the
   * role exists, and reporting "we couldn't find a published role" for those
   * would be a false statement plus a dead end with no retry.
   */
  const jobNotFound =
    jobStatus === RESOURCE_STATUS.ERROR &&
    (jobError?.status === 404 || jobError?.code === 'JOB_NOT_FOUND');

  if (jobNotFound) {
    return (
      <>
        <PageMeta title="Apply | Valida" robots={APPLY_ROBOTS} />
        <Section spacing="lg">
          <Container width="standard">
            <div className={styles.stateBlock} data-testid="apply-unavailable">
              <h1 className="t-h2">{APPLY.unavailable.heading}</h1>
              <p className="t-body-lg">{APPLY.unavailable.body}</p>
              <Button as={Link} href={withRegion(ROUTES.CAREERS)} variant="primary" size="large">
                {APPLY.unavailable.cta}
              </Button>
            </div>
          </Container>
        </Section>
      </>
    );
  }

  // Temporary failure: canonical Job-load failure copy (Doc 06 section 106)
  // with a real retry, reused because the situation is the same one.
  if (jobStatus === RESOURCE_STATUS.ERROR || !job) {
    return (
      <>
        <PageMeta title="Apply | Valida" robots={APPLY_ROBOTS} />
        <Section spacing="lg">
          <Container width="standard">
            <div className={styles.stateBlock} data-testid="apply-job-error">
              <h1 className="t-h2">{JOB_DETAIL.error.heading}</h1>
              <p className="t-body-lg">{JOB_DETAIL.error.body}</p>
              <div className={styles.actions}>
                <Button variant="primary" size="large" onClick={reloadJob}>
                  {JOB_DETAIL.error.primary}
                </Button>
                <Button as={Link} href={withRegion(ROUTES.CAREERS)} variant="secondary" size="large">
                  {JOB_DETAIL.error.secondary}
                </Button>
              </div>
            </div>
          </Container>
        </Section>
      </>
    );
  }

  // Success — reachable only from a resolved service call.
  if (submission.status === SUBMIT_STATUS.SUCCESS) {
    return (
      <>
        <PageMeta title={applyTitle(job.title)} robots={APPLY_ROBOTS} />
        <Section spacing="lg">
          <Container width="standard">
            <div className={styles.stateBlock} data-testid="apply-success">
              <SectionEyebrow>{APPLY.success.eyebrow}</SectionEyebrow>
              <h1 className="t-h1">{APPLY.success.heading}</h1>
              {/* Announced politely rather than by stealing focus. */}
              <StatusMessage>{successBody(job.title)}</StatusMessage>
              <p className={`t-body-lg ${styles.successBody}`}>{APPLY.success.bodySuffix}</p>
              <div className={styles.actions}>
                <Button as={Link} href={withRegion(ROUTES.CAREERS)} variant="primary" size="large">
                  {APPLY.success.primary}
                </Button>
                <Button as={Link} href={ROUTES.HOME} variant="secondary" size="large">
                  {APPLY.success.secondary}
                </Button>
              </div>
            </div>
          </Container>
        </Section>
      </>
    );
  }

  /*
   * FINDING 5B — the backend now reports the role as unknown or nonpublic.
   * The form must be retired, not left active behind an alert: submitting into
   * a role the server will not accept wastes the candidate's effort. The same
   * neutral copy is used, revealing no Draft/Archived/internal distinction.
   */
  if (submission.status === SUBMIT_STATUS.JOB_UNAVAILABLE) {
    return (
      <>
        <PageMeta title={applyTitle(job.title)} robots={APPLY_ROBOTS} />
        <Section spacing="lg">
          <Container width="standard">
            <div className={styles.stateBlock} data-testid="apply-unavailable">
              <h1 className="t-h2">{APPLY.unavailable.heading}</h1>
              <p className="t-body-lg">{APPLY.unavailable.body}</p>
              <Button as={Link} href={withRegion(ROUTES.CAREERS)} variant="primary" size="large">
                {APPLY.unavailable.cta}
              </Button>
            </div>
          </Container>
        </Section>
      </>
    );
  }

  // The Job closed between page load and submission — its own canonical state.
  if (submission.status === SUBMIT_STATUS.JOB_CLOSED) {
    return (
      <>
        <PageMeta title={applyTitle(job.title)} robots={APPLY_ROBOTS} />
        <Section spacing="lg">
          <Container width="standard">
            <div className={styles.stateBlock} data-testid="apply-closed-during">
              <h1 className="t-h2">{APPLY.closedDuringApplication.heading}</h1>
              <p className="t-body-lg">{APPLY.closedDuringApplication.body}</p>
              <Button as={Link} href={withRegion(ROUTES.CAREERS)} variant="primary" size="large">
                {APPLY.closedDuringApplication.cta}
              </Button>
            </div>
          </Container>
        </Section>
      </>
    );
  }

  // A Job that is not OPEN, or carries no form configuration, gets no form.
  if (!isJobOpen(job) || !applicationForm) {
    return (
      <>
        <PageMeta title={applyTitle(job.title)} robots={APPLY_ROBOTS} />
        <Section spacing="lg">
          <Container width="standard">
            <div className={styles.stateBlock} data-testid="apply-not-accepting">
              <h1 className="t-h2">{APPLY.closedDuringApplication.heading}</h1>
              <p className="t-body-lg">{APPLY.unavailable.body}</p>
              <Button as={Link} href={withRegion(ROUTES.CAREERS)} variant="primary" size="large">
                {APPLY.unavailable.cta}
              </Button>
            </div>
          </Container>
        </Section>
      </>
    );
  }

  /* Canonical retry state: a failed or rate-limited attempt the candidate can
     repeat with the same data. */
  const hasFailedSubmission =
    submission.status === SUBMIT_STATUS.FAILED || submission.status === SUBMIT_STATUS.RATE_LIMITED;

  /*
   * Summary links target the control the candidate must actually fix.
   * The resume entry points at the native file input via a ref-provided id, so
   * following the link lands on a real, focusable control rather than on a
   * non-focusable message element.
   */
  /*
   * The SAME resolver Careers and Job Detail use, so the regional context a
   * candidate saw on the role is exactly what they see while applying.
   *
   * The selected region is presentation only: it is never added to the
   * application payload, because the canonical Application API defines no such
   * field.
   */
  const contextFacts = buildRegionalJobFacts(resolveJobMarketPresentation(job, region));

  const summaryItems = Object.entries(errors).map(([key, message]) => {
    if (key.startsWith('screening:')) {
      return { id: `screening-${key.slice('screening:'.length)}`, message };
    }
    if (key === 'resume') return { id: resumeInputId ?? 'apply-resume', message };
    return { id: `apply-${key}`, message };
  });

  return (
    <>
      <PageMeta
        title={applyTitle(job.title)}
        /* An application form has no search value and must not be indexed. */
        robots={APPLY_ROBOTS}
      />
      <div className={styles.page}>
        <Container width="standard">
          <p className={styles.backRow}>
            <TextLink as={Link} to={withRegion(jobRoute(job.slug))} variant="quiet" aria-label={backToRoleLabel(job.title)}>
              {APPLY.backLink}
            </TextLink>
          </p>

          <div className={styles.header}>
            <SectionEyebrow>{APPLY.eyebrow}</SectionEyebrow>
            <h1 className={`t-h1 ${styles.heading}`}>{applyHeading(job.title)}</h1>
            <p className={`t-body-lg ${styles.intro}`}>{APPLY.intro}</p>
          </div>

          {/*
            Job context summary (Doc 04 Apply IA, Doc 05 section 118).
            Canonical label and title, plus the employment facts the API
            actually supplied, so a candidate on a small screen can confirm the
            role without navigating away from the form.

            buildJobFacts is the same helper Job Detail uses: one formatting
            rule, and a value the API omitted is simply absent — no placeholder,
            no "not specified", nothing invented.
          */}
          <Surface className={styles.context}>
            <p className={`t-label ${styles.contextLabel}`}>{APPLY.jobContextLabel}</p>
            <p className={`t-h4 ${styles.contextValue}`}>{job.title}</p>
            <p className={`t-body-sm ${styles.contextLabel}`}>Valida</p>
            {contextFacts.length > 0 ? (
              <ul className={`t-body-sm ${styles.contextFacts}`} data-testid="apply-context-facts">
                {contextFacts.map((fact) => (
                  <li key={fact.label} className={styles.contextFact}>
                    <span className={styles.contextFactLabel}>{fact.label}:</span>
                    <span className={styles.contextFactValue}>{fact.value}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Surface>

          {summaryVisible && summaryItems.length > 0 ? (
            <ValidationSummary
              ref={summaryRef}
              heading={APPLY.validationSummary.heading}
              body={APPLY.validationSummary.body}
              items={summaryItems}
            />
          ) : null}

          {submission.status === SUBMIT_STATUS.FAILED ? (
            <Alert tone="error" title={APPLY.failure.heading} data-testid="apply-failed">
              {APPLY.failure.body}
            </Alert>
          ) : null}

          {submission.status === SUBMIT_STATUS.RATE_LIMITED ? (
            <Alert tone="warning" title={APPLY.failure.heading} data-testid="apply-ratelimited">
              {APPLY.rateLimited}
            </Alert>
          ) : null}

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <fieldset className={`${styles.group} ${styles.fieldset}`}>
              <legend className={`t-h3 ${styles.groupHeading}`}>{APPLY.yourInformation.heading}</legend>
              <p className={`t-body ${styles.groupIntro}`}>{APPLY.yourInformation.body}</p>

              <div className={styles.fields}>
                <Field
                  id="apply-fullName"
                  label={APPLY.fullName.label}
                  required
                  error={errors.fullName}
                >
                  {(props) => (
                    <TextInput
                      {...props}
                      autoComplete="name"
                      value={values.fullName}
                      onChange={(event) => setValue('fullName', event.target.value)}
                      onBlur={() => handleBlur('fullName')}
                    />
                  )}
                </Field>

                <Field
                  id="apply-email"
                  label={APPLY.email.label}
                  description={APPLY.email.helper}
                  required
                  error={errors.email}
                >
                  {(props) => (
                    <TextInput
                      {...props}
                      type="email"
                      autoComplete="email"
                      value={values.email}
                      onChange={(event) => setValue('email', event.target.value)}
                      onBlur={() => handleBlur('email')}
                    />
                  )}
                </Field>

                {/* Rendered only when the Job's configuration enables it. */}
                {applicationForm.phone?.enabled ? (
                  <Field
                    id="apply-phone"
                    label={APPLY.phone.label}
                    description={APPLY.phone.helper}
                    required={Boolean(applicationForm.phone.required)}
                    optionalText={applicationForm.phone.required ? undefined : 'Optional'}
                    error={errors.phone}
                  >
                    {(props) => (
                      <TextInput
                        {...props}
                        type="tel"
                        autoComplete="tel"
                        value={values.phone}
                        onChange={(event) => setValue('phone', event.target.value)}
                        onBlur={() => handleBlur('phone')}
                      />
                    )}
                  </Field>
                ) : null}
              </div>
            </fieldset>

            <fieldset className={`${styles.group} ${styles.fieldset}`}>
              <legend className={`t-h3 ${styles.groupHeading}`}>{APPLY.resume.heading}</legend>
              <p className={`t-body ${styles.groupIntro}`}>{APPLY.resume.intro}</p>
              {/*
                FINDING 8 — the error is rendered by ResumeField itself, which
                owns the id the native input points at through aria-describedby.
                Keeping it here as well produced a duplicate message and an id
                the input did not reference.
              */}
              <ResumeField
                resumeConfig={applicationForm.resume}
                file={resumeFile}
                error={errors.resume ?? resumeError}
                onSelect={handleResumeSelect}
                onRemove={() => {
                  setResumeFile(null);
                  setResumeError(null);
                }}
                onInputId={setResumeInputId}
              />
            </fieldset>

            {applicationForm.message?.enabled ? (
              <fieldset className={`${styles.group} ${styles.fieldset}`}>
                <legend className={`t-h3 ${styles.groupHeading}`}>{APPLY.message.heading}</legend>
                <Field
                  id="apply-message"
                  label={APPLY.message.label}
                  description={APPLY.message.helper}
                  required={Boolean(applicationForm.message.required)}
                  error={errors.message}
                >
                  {(props) => (
                    <TextArea
                      {...props}
                      /* The limit comes from the Job configuration, never a
                         duplicated constant. */
                      maxLength={applicationForm.message.maxLength}
                      value={values.message}
                      onChange={(event) => setValue('message', event.target.value)}
                    />
                  )}
                </Field>
              </fieldset>
            ) : null}

            {Array.isArray(applicationForm.screeningQuestions) && applicationForm.screeningQuestions.length > 0 ? (
              <fieldset className={`${styles.group} ${styles.fieldset}`}>
                <legend className={`t-h3 ${styles.groupHeading}`}>{APPLY.screening.heading}</legend>
                <p className={`t-body ${styles.groupIntro}`}>{APPLY.screening.intro}</p>
                <div className={styles.fields}>
                  <ScreeningQuestions
                    questions={applicationForm.screeningQuestions}
                    values={values.screeningAnswers}
                    errors={errors}
                    onChange={handleScreeningChange}
                  />
                </div>
              </fieldset>
            ) : null}

            <p className={`t-body-sm ${styles.privacy}`}>
              {APPLY.privacy.body}{' '}
              <TextLink as={Link} to={ROUTES.PRIVACY}>{APPLY.privacy.linkLabel}</TextLink>
            </p>

            <div className={styles.actions}>
              {/*
                FINDING 5C — after a failed submission the canonical action is
                "Try Again", not a submit button that looks like nothing
                happened. It is the same <form> submit, so entered data is
                preserved and the submission hook reuses the same idempotency
                key: a request that did reach the server cannot create a second
                Application.
              */}
              <Button
                type="submit"
                variant="primary"
                size="large"
                className={styles.submit}
                loading={submission.isSubmitting}
              >
                {submission.isSubmitting
                  ? APPLY.submitting
                  : hasFailedSubmission
                    ? APPLY.failure.cta
                    : APPLY.submit}
              </Button>
              <StatusMessage visible={false}>
                {submission.isSubmitting ? APPLY.submittingStatus : ''}
              </StatusMessage>
            </div>
          </form>
        </Container>
      </div>
    </>
  );
}
