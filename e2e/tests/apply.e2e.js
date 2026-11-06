import { readFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  IDENTITY, PNG_AS_PDF, RESUMES, api, applicationCount, applicationEvidence, applicationsFor, axe, backendCli,
  backendEvents, backendLog, candidate, closeDatabase, eventually, hashIdempotencyKey, jobBySlug, keyRef,
  messageEvidence, messagesForApplication, rcptLog, record, run, sha256, shot, smtpSessions, storageObjects,
  storedObjectFor, suppressionEntries,
} from '../support/evidence.js';
import { BACKEND_ORIGIN, FRONTEND_ORIGIN, REPO_ROOT, isInside } from '../support/paths.js';

/**
 * C3 — Real Apply Integration: the critical E2E suite (Doc 17 sections
 * 197-213; Doc 18 sections 157-162).
 *
 * Every case runs a real browser against the production build, the real
 * Express backend, the disposable MongoDB database, the private local
 * storage and the local SMTP test server. Each record says how it was
 * observed:
 *
 *   REAL             nothing between the browser and the backend is altered;
 *   HOLD             the real request is delayed in the browser, then sent
 *                    unchanged (to photograph the in-flight state);
 *   FAULT INJECTION  the browser is taken offline, or the real server's
 *                    answer is dropped before the page sees it.
 *
 * The cases run in order and share one stack; every count is taken as a
 * before/after difference or by the case's own unique synthetic candidate.
 */
test.describe.configure({ mode: 'serial' });
test.afterAll(closeDatabase);

const OPEN = () => run().jobs['qa-e2e-apply-open'];
const DURING = () => run().jobs['qa-e2e-close-during'];
const DURING_CLOSED = () => run().jobs['qa-e2e-close-during.closed'];
const APPLY_PATH = /\/api\/v1\/jobs\/[^/]+\/applications$/;
const ALLOWED_FIELDS = ['fullName', 'email', 'phone', 'message', 'screeningAnswers', 'resume'];
const seen = { candidates: [], keys: [], probePaths: [] };

/**
 * Every Apply POST the page makes: headers, status, body, failure.
 *
 * The multipart FIELD NAMES cannot be read from the network: Chromium does
 * not hand a multipart body that carries a file to the automation layer
 * (request.postDataBuffer() is null). So a page-side recorder, installed
 * before the page loads, notes the keys of every FormData the application
 * passes to fetch — keys and file sizes only, never values — and changes
 * nothing about the request. formFields(page) reads them back, in order.
 */
async function trackApply(page) {
  await page.addInitScript(() => {
    const original = window.fetch;
    window.__e2eFormFields = [];
    window.fetch = function recordingFetch(input, init) {
      if (init?.body instanceof FormData) {
        window.__e2eFormFields.push([...init.body.entries()].map(([key, value]) => (value instanceof File ? `${key} (file, ${value.size} bytes)` : key)));
      }
      return original.apply(this, arguments);
    };
  });
  const posts = [];
  const byRequest = new Map();
  page.on('request', (request) => {
    if (request.method() !== 'POST' || !APPLY_PATH.test(new URL(request.url()).pathname)) return;
    const headers = request.headers();
    const entry = { at: new Date().toISOString(), path: new URL(request.url()).pathname, contentType: headers['content-type']?.split(';')[0] ?? null, idempotencyKey: headers['idempotency-key'] ?? null, status: null, body: null, failure: null };
    posts.push(entry);
    byRequest.set(request, entry);
    if (entry.idempotencyKey) seen.keys.push(entry.idempotencyKey);
  });
  page.on('response', async (response) => {
    const entry = byRequest.get(response.request());
    if (!entry) return;
    entry.status = response.status();
    try {
      entry.body = await response.json();
    } catch {
      entry.body = null;
    }
  });
  page.on('requestfailed', (request) => {
    const entry = byRequest.get(request);
    if (entry) entry.failure = request.failure()?.errorText ?? 'failed';
  });
  return posts;
}
/** The FormData keys the application handed to fetch, one array per submission. */
const formFields = (page) => page.evaluate(() => window.__e2eFormFields ?? []);
const fieldName = (entry) => entry.split(' ')[0];

/** The evidence view of tracked POSTs: the key only as a short reference. */
const postsEvidence = (posts) => posts.map(({ idempotencyKey, body, ...rest }) => ({ ...rest, idempotencyKeyRef: keyRef(idempotencyKey), body }));

function trackConsole(page) {
  const lines = [];
  page.on('console', (message) => ['error', 'warning'].includes(message.type()) && lines.push(`${message.type()}: ${message.text().slice(0, 160)}`));
  page.on('pageerror', (error) => lines.push(`pageerror: ${String(error).slice(0, 160)}`));
  return lines;
}

async function openApply(page, job) {
  await page.goto(`/careers/${job.slug}/apply`);
  await expect(page.getByRole('heading', { level: 1, name: `Apply for ${job.title}` })).toBeVisible();
}

async function fillForm(page, person, { resume = RESUMES.pdf, full = true } = {}) {
  await page.getByLabel('Full Name').fill(person.fullName);
  await page.getByLabel('Email Address').fill(person.email);
  if (full) {
    await page.getByLabel('Phone Number').fill(person.phone);
    await page.getByLabel('Message').fill(person.message);
    await page.locator('fieldset', { has: page.locator('legend', { hasText: 'can you work the synthetic schedule?' }) }).getByLabel('Yes', { exact: true }).check();
    await page.getByLabel('QA TEST DATA (E2E): preferred synthetic start window?').selectOption({ label: 'QA option early' });
  }
  await page.locator('input[type="file"][name="resume"]').setInputFiles(resume);
  seen.candidates.push(person);
}

const submitButton = (page) => page.getByRole('button', { name: /^(Submit Application|Try Again|Submitting…)$/ });
const valueOf = (page, label) => page.getByLabel(label).inputValue();

/** The channel states of an Application, as stored. */
const channels = (doc) => ({
  internal: { status: doc.notifications.internal.status, attemptCount: doc.notifications.internal.attemptCount, sentAt: doc.notifications.internal.sentAt ?? null, lastErrorCode: doc.notifications.internal.lastErrorCode ?? null },
  candidateAcknowledgement: { status: doc.notifications.candidateAcknowledgement.status, attemptCount: doc.notifications.candidateAcknowledgement.attemptCount, sentAt: doc.notifications.candidateAcknowledgement.sentAt ?? null, lastErrorCode: doc.notifications.candidateAcknowledgement.lastErrorCode ?? null, lastStatusCode: doc.notifications.candidateAcknowledgement.lastStatusCode ?? null },
});

// =============================================================================
test('C3-01 QA-P1-E2E-001..004 — Home → Careers → Job → Apply → resume → submit → success, with database, storage and notification evidence', async ({ page }) => {
  const job = OPEN();
  const person = candidate('Happy');
  const posts = await trackApply(page);
  const consoleLines = trackConsole(page);
  const screenshots = {};

  // Home → Careers → Job → Apply, by the visible links (QA-P1-E2E-001..003).
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Careers' }).click();
  await expect(page).toHaveURL(/\/careers$/);
  await page.getByRole('link', { name: `View ${job.title} role` }).click();
  await expect(page).toHaveURL(new RegExp(`/careers/${job.slug}$`));
  await expect(page.getByRole('heading', { level: 1, name: job.title })).toBeVisible();
  await page.getByRole('link', { name: 'Apply for This Role' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/careers/${job.slug}/apply$`));
  await expect(page.getByRole('heading', { level: 1, name: `Apply for ${job.title}` })).toBeVisible();
  screenshots.form = await shot(page, '01-form');
  const axeForm = await axe(page);

  // Client validation is UX only: nothing reaches the server (Doc 18 section 159).
  await submitButton(page).click();
  await expect(page.getByText('Review the highlighted fields.')).toBeVisible();
  const clientErrors = await page.locator('[aria-invalid="true"]').count();
  screenshots.validation = await shot(page, '02-validation');
  const axeValidation = await axe(page);
  expect(posts, 'client validation sends nothing').toHaveLength(0);

  await fillForm(page, person);
  await expect(page.getByText('Resume ready to submit.')).toBeVisible();
  // Every corrected field drops its earlier message, so nothing stays flagged (D-C3-01, D-C3-02).
  await expect(page.getByText('Review the highlighted fields.')).toHaveCount(0);
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
  screenshots.selectedResume = await shot(page, '03-selected-resume');

  const responsePromise = page.waitForResponse((response) => response.request().method() === 'POST' && APPLY_PATH.test(new URL(response.url()).pathname));
  await submitButton(page).click();
  const response = await responsePromise;
  await expect(page.getByTestId('apply-success')).toBeVisible();
  await expect(page.getByText(`Your application for ${job.title} has been received.`)).toBeVisible();
  screenshots.success = await shot(page, '05-success');
  const axeSuccess = await axe(page);

  // ---- the request and the response (Doc 09 sections 73-82, 125, 147-148)
  expect(posts).toHaveLength(1);
  const [post] = posts;
  expect(post.contentType).toBe('multipart/form-data');
  expect(post.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const [sentFields] = await formFields(page);
  expect(sentFields.map(fieldName).every((field) => ALLOWED_FIELDS.includes(field)), `only the allowlisted fields: ${sentFields}`).toBe(true);
  expect(sentFields.map(fieldName).sort()).toEqual(['email', 'fullName', 'message', 'phone', 'resume', 'screeningAnswers']);
  expect(sentFields).toContain(`resume (file, ${readFileSync(RESUMES.pdf).length} bytes)`);
  expect(response.status()).toBe(201);
  expect(response.headers()['cache-control']).toBe('no-store');
  const body = await response.json();
  expect(body.data).toEqual({ status: 'RECEIVED', job: { title: job.title, slug: job.slug }, submittedAt: expect.stringMatching(/Z$/) });
  expect(body.meta.replayed).toBe(false);
  const bodyText = JSON.stringify(body);
  for (const value of [person.email, person.fullName, person.phone, 'qa-libreoffice.pdf']) expect(bodyText).not.toContain(value);

  // ---- MongoDB (Doc 17 section 205; Doc 10 sections 71-125)
  const [application, ...extra] = await applicationsFor(person.email);
  expect(extra).toHaveLength(0);
  const jobDoc = await jobBySlug(job.slug);
  const resumeBytes = readFileSync(RESUMES.pdf);
  expect(String(application.jobId)).toBe(String(jobDoc._id));
  expect(application.status).toBe('RECEIVED');
  expect(application.submittedAt.toISOString()).toBe(body.data.submittedAt);
  expect(application.idempotency.keyHash).toBe(hashIdempotencyKey(post.idempotencyKey));
  expect(application.jobSnapshot).toMatchObject({ title: job.title, slug: job.slug, location: jobDoc.location.displayName, workArrangement: jobDoc.workArrangement, employmentType: jobDoc.employmentType, weeklyHours: jobDoc.weeklyHours, compensation: { currency: 'CAD', amountMinor: 4321, unit: 'HOUR', gross: true } });
  expect(application.candidate).toMatchObject({ fullName: person.fullName, email: person.email, emailNormalized: person.email.toLowerCase(), phone: person.phone });
  // The internal line break is kept (Doc 09 section 86). The browser's multipart/form-data encoding sends it as CRLF
  // (HTML standard), and the server stores the value as received, so compare with line breaks normalised.
  expect(application.candidate.message.replace(/\r\n/g, '\n')).toBe(person.message);
  const messageLineBreak = application.candidate.message.includes('\r\n') ? 'CRLF' : 'LF';
  expect(application.screeningAnswers.map((answer) => [answer.typeSnapshot, answer.booleanValue ?? answer.optionLabelSnapshot ?? answer.textValue])).toEqual([['YES_NO', true], ['SINGLE_SELECT', 'QA option early']]);
  expect(application.resume).toMatchObject({ extension: '.pdf', mimeType: 'application/pdf', sizeBytes: resumeBytes.length, checksumSha256: sha256(resumeBytes), scanStatus: 'NOT_SCANNED', scanCheckedAt: null, originalFilename: 'qa-libreoffice.pdf' });
  expect(application.notifications.internal).toMatchObject({ status: 'SENT', attemptCount: 1 });
  expect(application.notifications.internal.sentAt).toBeInstanceOf(Date);
  expect(application.notifications.candidateAcknowledgement).toMatchObject({ status: 'SENT', attemptCount: 1 });

  // ---- private storage (Doc 17 section 206; Doc 09 sections 101-108, 204)
  const stored = storedObjectFor(application.resume.storageKey);
  expect(stored).toMatchObject({ exists: true, sizeBytes: resumeBytes.length, sha256: application.resume.checksumSha256 });
  if (process.platform !== 'win32') expect(stored.mode).toBe('600');
  expect(isInside(REPO_ROOT, run().storageRoot)).toBe(false);
  const publicAttempts = [];
  for (const url of [`${FRONTEND_ORIGIN}/${application.resume.storageKey}`, `${BACKEND_ORIGIN}/${application.resume.storageKey}`, `${BACKEND_ORIGIN}/api/v1/${application.resume.storageKey}`]) {
    seen.probePaths.push(new URL(url).pathname); // this suite's own probe: the backend access-logs its path (C3-09)
    const attempt = await fetch(url);
    const bytes = Buffer.from(await attempt.arrayBuffer());
    publicAttempts.push({ url: url.replace(application.resume.storageKey, '<storageKey>'), status: attempt.status, contentType: attempt.headers.get('content-type'), servedTheResume: bytes.equals(resumeBytes), startsWithPdfMagic: bytes.subarray(0, 4).toString('latin1') === '%PDF' });
  }
  expect(publicAttempts.every((attempt) => !attempt.servedTheResume && !attempt.startsWithPdfMagic)).toBe(true);

  // ---- notification attempt and result, independently of the UI (Doc 17 section 207)
  const mail = await eventually(() => {
    const found = messagesForApplication(String(application._id));
    return found.internal.length && found.acknowledgement.length ? found : null;
  });
  expect(mail.internal).toHaveLength(1);
  expect(mail.acknowledgement).toHaveLength(1);
  const [internalMail] = mail.internal;
  const [ackMail] = mail.acknowledgement;
  expect(internalMail.rcptTo).toEqual([IDENTITY.internalRecipient]);
  expect(ackMail.rcptTo).toEqual([person.email]);
  for (const message of [internalMail, ackMail]) {
    expect(message.mailFrom).toBe(IDENTITY.smtpUsername);
    expect(message.headers.from[0]).toContain(IDENTITY.smtpUsername);
    expect(message.headers['auto-submitted']?.[0]).toBe('auto-generated');
    expect(message.parts.filter((part) => part.disposition === 'attachment'), 'no attachment').toHaveLength(0);
    expect(message.parts.some((part) => ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(part.contentType)), 'the resume is never sent').toBe(false);
    expect(message.raw.includes(resumeBytes.subarray(0, 64))).toBe(false);
  }
  expect(ackMail.headers['reply-to']?.[0]).toContain(IDENTITY.replyTo);
  const sessions = smtpSessions();
  expect(sessions.logins.length).toBeGreaterThan(0);
  expect(sessions.logins.every((login) => login.matched && login.secure)).toBe(true);

  record('C3-01-happy-path', {
    observation: 'REAL',
    requirement: 'Doc 18 sections 158, 160; Doc 17 sections 198-207 (QA-P1-E2E-001..004)',
    navigation: ['/', '/careers', `/careers/${job.slug}`, `/careers/${job.slug}/apply`],
    clientValidation: { postsSent: 0, invalidControls: clientErrors },
    request: postsEvidence(posts),
    formFieldsHandedToFetch: sentFields,
    response: { status: response.status(), cacheControl: response.headers()['cache-control'], body },
    application: applicationEvidence(application),
    checks: { keyHashMatchesHeader: true, jobIdMatchesSlug: true, submittedAtMatchesResponse: true, checksumMatchesFile: true, messageLineBreakAsStored: messageLineBreak },
    storage: { stored, publicAttempts, storageRootInsideRepository: false },
    notification: { internal: messageEvidence(internalMail), acknowledgement: messageEvidence(ackMail), smtpLogins: sessions.logins.length, allLoginsOverTls: true },
    axe: { form: axeForm, validation: axeValidation, success: axeSuccess },
    console: consoleLines,
    screenshots,
  });
  expect([...axeForm, ...axeValidation, ...axeSuccess].filter((violation) => ['serious', 'critical'].includes(violation.impact))).toEqual([]);
});

// =============================================================================
test('C3-02 Doc 17 section 211 — rapid double submission creates one Application (browser), and a same-key race creates one (API)', async ({ page }) => {
  const job = OPEN();
  const person = candidate('Double');
  const posts = await trackApply(page);
  const consoleLines = trackConsole(page);
  await openApply(page, job);
  await fillForm(page, person, { resume: RESUMES.docx });

  // HOLD: the real request is delayed 1.5 s in the browser, then sent unchanged.
  await page.route(APPLY_PATH, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });
  const button = submitButton(page);
  await button.dblclick();
  await button.click({ force: true }).catch(() => {}); // a third activation while the request is open
  await expect(page.getByRole('button', { name: 'Submitting…' })).toBeVisible();
  const busy = await page.getByRole('button', { name: 'Submitting…' }).evaluate((element) => ({ disabled: element.disabled, ariaBusy: element.getAttribute('aria-busy'), ariaDisabled: element.getAttribute('aria-disabled') }));
  const submitShot = await shot(page, '04-submit');
  await expect(page.getByTestId('apply-success')).toBeVisible();
  await page.unroute(APPLY_PATH);

  expect(posts, 'one request for three activations').toHaveLength(1);
  const browserApps = await applicationsFor(person.email);
  expect(browserApps).toHaveLength(1);
  expect(browserApps[0].resume).toMatchObject({ extension: '.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const browserMail = await eventually(() => {
    const found = messagesForApplication(String(browserApps[0]._id));
    return found.internal.length && found.acknowledgement.length ? found : null;
  });
  expect(browserMail.internal).toHaveLength(1);
  expect(browserMail.acknowledgement).toHaveLength(1);

  // API: two simultaneous requests with ONE key (Doc 09 section 120; Doc 17 section 108).
  const racer = candidate('Race');
  const detail = (await api(`/api/v1/jobs/${job.slug}`)).body.data;
  const [yesNo, select] = detail.applicationForm.screeningQuestions;
  const raceKey = randomUUID();
  seen.keys.push(raceKey);
  seen.candidates.push(racer);
  const form = () => {
    const data = new FormData();
    data.append('fullName', racer.fullName);
    data.append('email', racer.email);
    data.append('screeningAnswers', JSON.stringify([{ questionId: yesNo.id, answer: true }, { questionId: select.id, answer: select.options[1].optionId }]));
    data.append('resume', new Blob([readFileSync(RESUMES.pdf)], { type: 'application/pdf' }), 'qa-libreoffice.pdf');
    return data;
  };
  const race = await Promise.all([0, 1].map(() => api(`/api/v1/jobs/${job.slug}/applications`, { method: 'POST', headers: { 'Idempotency-Key': raceKey }, body: form() })));
  const raceApps = await applicationsFor(racer.email);
  expect(race.map((result) => result.status).sort()).toEqual([200, 201]);
  expect(race.find((result) => result.status === 200).body.meta.replayed).toBe(true);
  expect(raceApps).toHaveLength(1);
  const raceMail = await eventually(() => {
    const found = messagesForApplication(String(raceApps[0]._id));
    return found.internal.length && found.acknowledgement.length ? found : null;
  });
  await new Promise((resolve) => setTimeout(resolve, 500)); // any late duplicate would be flushed by now
  const raceMailFinal = messagesForApplication(String(raceApps[0]._id));
  expect(raceMailFinal.internal).toHaveLength(1);
  expect(raceMailFinal.acknowledgement).toHaveLength(1);
  const objectsForRacer = storageObjects().filter((object) => object.sha256 === raceApps[0].resume.checksumSha256);

  record('C3-02-double-submit', {
    observation: 'HOLD (browser part: the real request delayed 1.5 s, then sent unchanged); REAL (API race)',
    requirement: 'Doc 17 sections 108, 211; Doc 09 sections 78, 120; Doc 08 section 107',
    browser: { activations: 3, requests: postsEvidence(posts), buttonWhileInFlight: busy, applications: browserApps.length, internalMessages: browserMail.internal.length, acknowledgements: browserMail.acknowledgement.length, applicationId: String(browserApps[0]._id) },
    apiRace: {
      idempotencyKeyRef: keyRef(raceKey),
      responses: race.map((result) => ({ status: result.status, replayed: result.body?.meta?.replayed ?? null, data: result.body?.data ?? null })),
      applications: raceApps.length,
      applicationId: String(raceApps[0]._id),
      internalMessages: raceMailFinal.internal.length,
      acknowledgements: raceMailFinal.acknowledgement.length,
      objectsWithThatChecksum: objectsForRacer.length,
      note: 'Both racers upload the same file; the loser\'s object is deleted (compensation), so one object remains for the one Application unless another case stored the same fixture.',
    },
    console: consoleLines,
    screenshots: { submit: submitShot },
  });
  expect(raceMail).toBeTruthy();
});

// =============================================================================
test('C3-03 Doc 17 section 209 — network failure: no false success, data kept; Try Again reuses the key and succeeds once', async ({ page, context }) => {
  const job = OPEN();
  const person = candidate('Offline');
  const posts = await trackApply(page);
  const consoleLines = trackConsole(page);
  await openApply(page, job);
  await fillForm(page, person);
  const countBefore = await applicationCount();

  // FAULT INJECTION: the browser goes offline; the request cannot leave it.
  await context.setOffline(true);
  await submitButton(page).click();
  await expect(page.getByTestId('apply-failed')).toBeVisible();
  await expect(page.getByTestId('apply-success')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
  const kept = { fullName: await valueOf(page, 'Full Name'), email: await valueOf(page, 'Email Address'), phone: await valueOf(page, 'Phone Number'), message: await valueOf(page, 'Message') };
  expect(kept).toEqual({ fullName: person.fullName, email: person.email, phone: person.phone, message: person.message });
  const failureShot = await shot(page, '07-network-failure');
  const axeFailure = await axe(page);
  expect(await applicationCount()).toBe(countBefore);
  expect(await applicationsFor(person.email)).toHaveLength(0);

  await context.setOffline(false);
  await page.getByRole('button', { name: 'Try Again' }).click();
  await expect(page.getByTestId('apply-success')).toBeVisible();
  const apps = await applicationsFor(person.email);
  expect(apps).toHaveLength(1);
  expect(posts).toHaveLength(2);
  expect(posts[0].failure).toBeTruthy();
  expect(posts[1].status).toBe(201);
  expect(posts[1].idempotencyKey).toBe(posts[0].idempotencyKey);
  expect(apps[0].idempotency.keyHash).toBe(hashIdempotencyKey(posts[0].idempotencyKey));

  record('C3-03-network-failure', {
    observation: 'FAULT INJECTION (browser offline emulation: context.setOffline); backend, database and storage REAL',
    requirement: 'Doc 17 section 209; Doc 08 sections 109-110, 114; Doc 18 section 160',
    requests: postsEvidence(posts),
    whileOffline: { failureAlertShown: true, successShown: false, tryAgainShown: true, valuesKept: kept, applicationsCreated: 0 },
    afterTryAgain: { applications: apps.length, sameIdempotencyKey: true, applicationId: String(apps[0]._id) },
    axe: { failure: axeFailure },
    console: consoleLines,
    screenshots: { networkFailure: failureShot },
  });
});

// =============================================================================
test('C3-04 Doc 09 section 121, Doc 17 section 200 — response lost after acceptance: the retry keeps the key and replays; one Application, no second notification', async ({ page }) => {
  const job = OPEN();
  const person = candidate('Lost');
  const posts = await trackApply(page);
  const consoleLines = trackConsole(page);
  await openApply(page, job);
  await fillForm(page, person);

  // FAULT INJECTION, at the Chromium DevTools Fetch domain's RESPONSE stage: the browser sends its own real
  // request (with the real file) to the real server; when the server's real answer arrives it is failed with
  // ConnectionReset before the page sees it. (Playwright's route.fetch() cannot be used: Chromium does not give
  // the automation layer a multipart body that carries a file, so a re-sent copy would arrive without it.)
  const cdp = await page.context().newCDPSession(page);
  let lost = null;
  let resolveLost;
  const lostArrived = new Promise((resolve) => {
    resolveLost = resolve;
  });
  cdp.on('Fetch.requestPaused', async (event) => {
    if (event.request.method !== 'POST' || lost) {
      await cdp.send('Fetch.continueResponse', { requestId: event.requestId });
      return;
    }
    const answer = await cdp.send('Fetch.getResponseBody', { requestId: event.requestId });
    lost = { status: event.responseStatusCode, body: JSON.parse(answer.base64Encoded ? Buffer.from(answer.body, 'base64').toString('utf8') : answer.body) };
    await cdp.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'ConnectionReset' });
    await cdp.send('Fetch.disable');
    resolveLost();
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `*/api/v1/jobs/${job.slug}/applications`, requestStage: 'Response' }] });
  await submitButton(page).click();
  await lostArrived;
  await expect(page.getByTestId('apply-failed')).toBeVisible();
  await expect(page.getByTestId('apply-success')).toHaveCount(0);
  const lostShot = await shot(page, '08-response-lost');
  expect(lost.status, JSON.stringify(lost.body)).toBe(201);
  const afterFirst = await applicationsFor(person.email);
  expect(afterFirst).toHaveLength(1);
  const id = String(afterFirst[0]._id);
  const mailAfterFirst = await eventually(() => {
    const found = messagesForApplication(id);
    return found.internal.length && found.acknowledgement.length ? found : null;
  });

  await page.getByRole('button', { name: 'Try Again' }).click();
  await expect(page.getByTestId('apply-success')).toBeVisible();
  const replayShot = await shot(page, '09-replayed-success');
  await new Promise((resolve) => setTimeout(resolve, 500));
  const afterRetry = await applicationsFor(person.email);
  const mailAfterRetry = messagesForApplication(id);

  expect(posts).toHaveLength(2);
  expect(posts[1].idempotencyKey).toBe(posts[0].idempotencyKey);
  expect(posts[1].status).toBe(200);
  expect(posts[1].body.meta.replayed).toBe(true);
  expect(posts[1].body.data).toEqual(lost.body.data);
  expect(afterRetry).toHaveLength(1);
  expect(String(afterRetry[0]._id)).toBe(id);
  expect(mailAfterRetry.internal).toHaveLength(1);
  expect(mailAfterRetry.acknowledgement).toHaveLength(1);
  const replayEvents = backendEvents((entry) => entry.event === 'application_replayed' && entry.applicationId === id);
  expect(replayEvents).toHaveLength(1);
  expect(channels(afterRetry[0]).internal.attemptCount).toBe(1);

  record('C3-04-response-loss-retry', {
    observation: 'FAULT INJECTION (Chromium DevTools Fetch, Response stage: the real 201 was failed with ConnectionReset before the page saw it); the request, backend, database, storage and SMTP REAL',
    requirement: 'Doc 09 sections 75, 79, 121, 126, 135; Doc 17 section 200; Doc 12 sections 63-65',
    firstAttempt: { serverStatus: lost.status, serverBody: lost.body, pageSaw: posts[0].failure },
    retry: { status: posts[1].status, replayed: posts[1].body.meta.replayed, sameLogicalResult: true },
    requests: postsEvidence(posts),
    sameIdempotencyKey: true,
    applications: afterRetry.length,
    applicationId: id,
    notifications: { stored: channels(afterRetry[0]), internalMessages: mailAfterRetry.internal.length, acknowledgements: mailAfterRetry.acknowledgement.length, messagesBeforeRetry: mailAfterFirst.internal.length + mailAfterFirst.acknowledgement.length },
    backendReplayEvents: replayEvents.map(({ event, applicationId, reqId }) => ({ event, applicationId, reqId })),
    console: consoleLines,
    screenshots: { responseLost: lostShot, replayedSuccess: replayShot },
  });
});

// =============================================================================
test('C3-05 Doc 17 section 210 — server validation is shown in the form (a PNG named .pdf passes the browser, not the server)', async ({ page }) => {
  const job = OPEN();
  const person = candidate('Invalid');
  const posts = await trackApply(page);
  const consoleLines = trackConsole(page);
  await openApply(page, job);
  await fillForm(page, person, { resume: PNG_AS_PDF });
  await expect(page.getByText('Resume ready to submit.')).toBeVisible(); // the client accepted it (UX only)
  const objectsBefore = storageObjects().length;
  const countBefore = await applicationCount();

  await submitButton(page).click();
  await expect(page.getByText('Review the highlighted fields.')).toBeVisible();
  await expect(page.getByText("We couldn't process this file. Remove it and try another file.").first()).toBeVisible();
  await expect(page.getByTestId('apply-success')).toHaveCount(0);
  const resumeInvalid = await page.locator('input[type="file"][name="resume"]').getAttribute('aria-invalid');
  const summaryFocused = await page.evaluate(() => document.activeElement?.textContent?.includes('Review the highlighted fields.') ?? false);
  const serverShot = await shot(page, '10-server-validation');
  const axeServer = await axe(page);

  expect(posts).toHaveLength(1);
  expect(posts[0].status).toBe(422);
  expect(posts[0].body.error).toMatchObject({ code: 'INVALID_RESUME_FILE', fieldErrors: [{ field: 'resume', code: 'INVALID_RESUME_FILE' }] });
  expect(resumeInvalid).toBe('true');
  expect(await valueOf(page, 'Full Name')).toBe(person.fullName);
  expect(await valueOf(page, 'Email Address')).toBe(person.email);
  expect(await applicationCount()).toBe(countBefore);
  expect(storageObjects().length).toBe(objectsBefore);
  expect(rcptLog().some((entry) => entry.address === person.email)).toBe(false);

  record('C3-05-server-validation', {
    observation: 'REAL',
    requirement: 'Doc 17 section 210; Doc 18 section 159; Doc 08 sections 98, 112-114; Doc 09 sections 141, 146',
    clientAcceptedFile: true,
    requests: postsEvidence(posts),
    ui: { summaryShown: true, summaryFocused, resumeFieldInvalid: resumeInvalid, valuesKept: true, successShown: false },
    sideEffects: { applicationsCreated: 0, objectsStored: storageObjects().length - objectsBefore, messagesToCandidate: 0 },
    axe: { serverValidation: axeServer },
    console: consoleLines,
    screenshots: { serverValidation: serverShot },
  });
});

// =============================================================================
test('C3-06 Doc 17 section 208 — open Apply, the Job closes in the backend, submit: controlled rejection', async ({ page }) => {
  const job = DURING();
  const person = candidate('Closed');
  const posts = await trackApply(page);
  const consoleLines = trackConsole(page);
  await openApply(page, job);
  const before = (await api(`/api/v1/jobs/${job.slug}`)).body.data.applicationStatus;
  expect(before).toBe('OPEN');
  await fillForm(page, person, { full: false });

  // The Job is closed by the real provisioning CLI while the form is open.
  const close = await backendCli('jobs:provision:apply (close)', ['scripts/provision-job.mjs', 'apply', '--file', DURING_CLOSED().file, '--confirm-lifecycle']);
  expect(close.exitCode).toBe(0);
  const detailAfter = await api(`/api/v1/jobs/${job.slug}`);
  const listAfter = await api('/api/v1/jobs');
  expect(detailAfter.body.data).toMatchObject({ applicationStatus: 'CLOSED', applicationForm: null });
  expect(listAfter.body.data.items.map((item) => item.slug)).not.toContain(job.slug);
  const objectsBefore = storageObjects().length;
  const countBefore = await applicationCount();

  await submitButton(page).click();
  await expect(page.getByTestId('apply-closed-during')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Applications for this role have closed.' })).toBeVisible();
  await expect(page.getByTestId('apply-success')).toHaveCount(0);
  await expect(page.locator('form')).toHaveCount(0);
  const closedShot = await shot(page, '06-closed-during-apply');
  const axeClosed = await axe(page);

  expect(posts).toHaveLength(1);
  expect(posts[0].status).toBe(409);
  expect(posts[0].body.error.code).toBe('JOB_NOT_ACCEPTING_APPLICATIONS');
  expect(await applicationCount()).toBe(countBefore);
  expect(await applicationsFor(person.email)).toHaveLength(0);
  expect(storageObjects().length).toBe(objectsBefore);
  expect(rcptLog().some((entry) => entry.address === person.email)).toBe(false);
  const jobDoc = await jobBySlug(job.slug);

  record('C3-06-closed-during-apply', {
    observation: 'REAL (the Job closed through the real provisioning CLI while the form was open)',
    requirement: 'Doc 17 sections 96, 208; Doc 12 sections 30-31; Doc 09 sections 114-115; Doc 08 section 111',
    beforeSubmit: { formShown: true, apiStatusBefore: before },
    closedBy: { command: close.label, exitCode: close.exitCode, stdout: close.stdout.split('\n').slice(-8) },
    apiAfterClose: { detail: { status: detailAfter.status, applicationStatus: detailAfter.body.data.applicationStatus, applicationForm: detailAfter.body.data.applicationForm }, listed: false },
    storedJob: { status: jobDoc.status, closedAt: jobDoc.closedAt },
    requests: postsEvidence(posts),
    ui: { closedStateShown: true, formRetired: true, successShown: false },
    sideEffects: { applicationsCreated: 0, objectsStored: storageObjects().length - objectsBefore, messagesToCandidate: 0 },
    axe: { closed: axeClosed },
    console: consoleLines,
    screenshots: { closedDuringApply: closedShot },
  });
});

// =============================================================================
test('C3-07 Doc 09 section 201, Doc 12 section 63 — the acknowledgement is refused by the mail server: the Application stays accepted', async ({ page }) => {
  const job = OPEN();
  const person = { ...candidate('Refused'), email: IDENTITY.refusedCandidate };
  const posts = await trackApply(page);
  const consoleLines = trackConsole(page);
  await openApply(page, job);
  await fillForm(page, person);
  await submitButton(page).click();
  await expect(page.getByTestId('apply-success')).toBeVisible();
  const refusedShot = await shot(page, '11-success-with-refused-acknowledgement');

  const [application] = await applicationsFor(person.email);
  const state = channels(application);
  expect(posts[0].status).toBe(201);
  expect(state.internal).toMatchObject({ status: 'SENT', attemptCount: 1 });
  expect(state.candidateAcknowledgement).toMatchObject({ status: 'FAILED', attemptCount: 1, lastErrorCode: 'INVALID_RECIPIENT', lastStatusCode: '5.1.1' });
  const mail = messagesForApplication(String(application._id));
  expect(mail.internal).toHaveLength(1);
  expect(mail.acknowledgement).toHaveLength(0);
  expect(rcptLog().filter((entry) => entry.address === person.email)).toEqual([{ address: person.email, refused: true }]);
  expect(storedObjectFor(application.resume.storageKey).exists).toBe(true);

  record('C3-07-acknowledgement-refused', {
    observation: 'REAL (the local SMTP test server refuses this one synthetic recipient at RCPT with 550 5.1.1)',
    requirement: 'Doc 09 sections 132-133, 201; Doc 12 sections 63, 117; Doc 17 section 110; SEC-086',
    response: { status: posts[0].status, body: posts[0].body },
    ui: { successShown: true, toldToReapply: false },
    application: applicationEvidence(application),
    notifications: { stored: state, internalMessages: mail.internal.length, acknowledgementsAccepted: mail.acknowledgement.length, rcptForCandidate: rcptLog().filter((entry) => entry.address === person.email) },
    console: consoleLines,
    screenshots: { success: refusedShot },
  });
});

// =============================================================================
test('C3-08 B7 — the refusal is recorded as a suppression; the next acknowledgement to that address is suppressed (no SMTP), the Application accepted', async ({ page }) => {
  const job = OPEN();
  const [refusedApp] = await applicationsFor(IDENTITY.refusedCandidate);
  const add = await backendCli('suppression add --from-refusal', ['scripts/ops-notifications-suppression.mjs', 'add', '--from-refusal', '--application', String(refusedApp._id), '--evidence-ref', 'QA-E2E-C3-REFUSAL', '--apply', '--operator', IDENTITY.suppressionOperator]);
  expect(add.exitCode).toBe(0);
  const entries = await suppressionEntries();
  expect(entries.filter((entry) => entry.state === 'ACTIVE')).toHaveLength(1);
  const rcptBefore = rcptLog().filter((entry) => entry.address === IDENTITY.refusedCandidate).length;

  // A new, intentional Application from the same address (new key): not refused as a duplicate (APP-008).
  const person = { ...candidate('Suppressed'), email: IDENTITY.refusedCandidate };
  const posts = await trackApply(page);
  const consoleLines = trackConsole(page);
  await openApply(page, job);
  await fillForm(page, person);
  await submitButton(page).click();
  await expect(page.getByTestId('apply-success')).toBeVisible();

  const apps = await applicationsFor(IDENTITY.refusedCandidate);
  expect(apps).toHaveLength(2);
  const second = apps[1];
  const state = channels(second);
  expect(posts[0].status).toBe(201);
  expect(state.internal).toMatchObject({ status: 'SENT', attemptCount: 1 });
  expect(state.candidateAcknowledgement).toMatchObject({ status: 'FAILED', lastErrorCode: 'RECIPIENT_SUPPRESSED' });
  await new Promise((resolve) => setTimeout(resolve, 500));
  expect(rcptLog().filter((entry) => entry.address === IDENTITY.refusedCandidate).length, 'no SMTP attempt to the suppressed address').toBe(rcptBefore);
  const mail = messagesForApplication(String(second._id));
  expect(mail.internal).toHaveLength(1);
  expect(mail.acknowledgement).toHaveLength(0);
  const suppressedEvents = backendEvents((entry) => entry.event === 'notification_suppressed' && entry.applicationId === String(second._id));
  expect(suppressedEvents).toHaveLength(1);

  record('C3-08-suppressed-acknowledgement', {
    observation: 'REAL (synthetic suppression key registered by the real CLI at set-up; the refusal recorded by the real CLI)',
    requirement: 'B7 suppression gate (RECIPIENT_SUPPRESSION_DESIGN.md rev 8 §3.2; OD-2026-11-04-02); Doc 12 sections 66, 117; APP-008',
    operatorStep: { command: add.label, exitCode: add.exitCode, stdout: add.stdout.split('\n').slice(-8) },
    register: entries.map((entry) => ({ state: entry.state, keyId: entry.lookup?.keyId, reason: entry.reason, basis: entry.basis, history: (entry.history ?? []).map((item) => item.action) })),
    secondApplication: { status: posts[0].status, applicationId: String(second._id), notifications: state, internalMessages: mail.internal.length, acknowledgementsSent: mail.acknowledgement.length, smtpAttemptsToAddress: rcptLog().filter((entry) => entry.address === IDENTITY.refusedCandidate).length - rcptBefore },
    backendEvents: suppressedEvents.map(({ event, applicationId, channel, suppressionId }) => ({ event, applicationId, channel, suppressionId })),
    console: consoleLines,
  });
});

// =============================================================================
test('C3-09 Doc 09 section 205, Doc 17 section 406 — the backend log holds no candidate data, key, storage key or secret', async () => {
  // The backend access-logs every request path. C3-01 deliberately requested /<storageKey> and
  // /api/v1/<storageKey> (both 404) to prove there is no public route, so exactly those access-log lines
  // carry a key — put there by this suite, not by the application. They are excluded by path, and counted.
  const lines = backendLog().split('\n');
  const isProbe = (line) => {
    try {
      return seen.probePaths.includes(JSON.parse(line).req?.path);
    } catch {
      return false;
    }
  };
  const probeLines = lines.filter(isProbe);
  const log = lines.filter((line) => !isProbe(line)).join('\n');
  const applications = [];
  for (const person of seen.candidates) applications.push(...(await applicationsFor(person.email)));
  const forbidden = [
    ...new Set([
      ...seen.candidates.flatMap((person) => [person.email, person.fullName, person.phone, person.message.split('\n')[0]]),
      ...seen.keys,
      ...seen.keys.map((key) => hashIdempotencyKey(key)),
      ...applications.map((application) => application.resume.storageKey),
      ...applications.map((application) => application.resume.originalFilename),
      process.env.E2E_SMTP_PASSWORD,
      process.env.E2E_SUPPRESSION_HMAC_KEY,
      process.env.MONGODB_TEST_URI,
    ]),
  ].filter(Boolean);
  const found = forbidden.filter((value) => log.includes(value));
  const events = backendEvents((entry) => typeof entry.event === 'string');
  const counts = events.reduce((total, entry) => ({ ...total, [entry.event]: (total[entry.event] ?? 0) + 1 }), {});

  record('C3-09-log-privacy', {
    observation: 'REAL (the whole backend log of this run)',
    requirement: 'Doc 09 sections 149-150, 205; Doc 13 sections 118-119, 281; Doc 17 section 406',
    logBytes: Buffer.byteLength(log),
    excludedProbeLines: { count: probeLines.length, statuses: probeLines.map((line) => JSON.parse(line).res?.statusCode), reason: "this suite's own public-access probes of C3-01 (paths containing a storage key, answered 404)" },
    valuesChecked: forbidden.length,
    valuesFound: found.length,
    eventCounts: counts,
    applicationsReviewed: applications.length,
    candidates: seen.candidates.length,
    idempotencyKeys: seen.keys.length,
  });
  expect(found).toEqual([]);
  // Exactly the two backend probes (the third C3-01 probe went to the preview server), both refused.
  expect(probeLines.map((line) => JSON.parse(line).res?.statusCode)).toEqual([404, 404]);
  expect(statSync(run().dirs.logs).isDirectory()).toBe(true);
});
