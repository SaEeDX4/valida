import { createRequire } from 'node:module';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { BACKEND_DIR, FIXTURES_DIR } from '../support/paths.js';
import { C5_BACKEND_ORIGIN, C5_SLUGS } from '../support/c5Stack.js';
import {
  BREAKPOINTS, ROUTES, WIDTHS, axe, openRoute, controlsProbe, ensureJobs, layoutProbe, provisionJobs,
  publishedJobs, record, run, settle, shot,
} from './c5Support.js';

/**
 * C5 — the integrated public site at every review width, and its states
 * (Doc 18 sections 168-172; Doc 05 section 212; Doc 03 sections 79 and 84;
 * Doc 16 section 269). Production build, document server, real backend,
 * disposable MongoDB, synthetic Jobs.
 *
 * Each record says how a state was produced: REAL, HOLD (a real request held,
 * then sent unchanged), FAULT (a request made to fail on purpose, then
 * recovered for real). Screenshots are full-page, 1 CSS px = 1 image px.
 */

const HEIGHTS = { 360: 800, 390: 844, 430: 932, 768: 1024, 1024: 768, 1440: 900, 1920: 1080 };
const heightFor = (width) => HEIGHTS[width] ?? 900;


/** Synthetic long values (Doc 03 section 84: long titles, e-mails, errors, file names). */
// Local part 50 characters (the server enforces the 64-character limit), one 59-character domain label.
const LONG_EMAIL = 'qa+c5-long-synthetic-address-wrap-check-0123456789@a-deliberately-long-synthetic-subdomain-for-wrapping-checks.valida-e2e.example.test';
const LONG_FILE = 'qa-c5-synthetic-resume-with-a-deliberately-long-file-name-for-wrapping-checks-0123456789.pdf';
const RESUME_PDF = path.join(BACKEND_DIR, 'tests', 'fixtures', 'resumes', 'qa-libreoffice.pdf');
const PNG_AS_PDF = Object.freeze({
  name: 'qa-c5-not-really-a.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex'),
});

async function atWidths(page, name, { widths = WIDTHS, probeControls = false } = {}) {
  const views = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: heightFor(width) });
    await settle(page);
    const layout = await layoutProbe(page);
    const controls = probeControls ? await controlsProbe(page) : null;
    views.push({
      width,
      screenshot: await shot(page, `${name}-${width}`),
      layout,
      ...(controls ? { controlsBelow24: controls.filter((c) => c.below24), controlsFailing2_5_8: controls.filter((c) => c.fails2_5_8), controlsCovered: controls.filter((c) => c.covered), controlsBelow44: controls.filter((c) => c.below44).length, controlsTotal: controls.length } : {}),
    });
  }
  return views;
}

const overflowFindings = (views) => views.filter((v) => v.layout.horizontalScroll || v.layout.outsideCount || v.layout.clippedCount).map((v) => ({ width: v.width, horizontalScroll: v.layout.horizontalScroll, scrollWidth: v.layout.scrollWidth, outside: v.layout.outside, clipped: v.layout.clipped }));

const isJobsList = (url) => new URL(url).pathname === '/api/v1/jobs';
const isJob = (slug) => (url) => new URL(url).pathname === `/api/v1/jobs/${slug}`;
const isApplication = (slug) => (url) => new URL(url).pathname === `/api/v1/jobs/${slug}/applications`;


test('C5-01 Careers with no published Job: the real empty state at every width, then the synthetic Jobs are provisioned', async ({ page }) => {
  const before = await publishedJobs();
  expect(before.status).toBe(200);
  expect(before.jobs).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await openRoute(page, '/careers')).toBe(200);
  await expect(page.getByText('No open roles right now.')).toBeVisible();
  const views = await atWidths(page, 'careers-empty', { probeControls: true });
  const axeDesktop = await axe(page);
  await page.setViewportSize({ width: 360, height: 800 });
  const axeMobile = await axe(page);

  const steps = await provisionJobs();
  const after = await publishedJobs();
  expect(after.jobs.map((j) => j.slug).sort()).toEqual([C5_SLUGS.open, C5_SLUGS.hybrid].sort());
  record('C5-01', {
    observation: 'REAL',
    apiBefore: { status: before.status, items: before.jobs.length },
    views,
    overflow: overflowFindings(views),
    axe: { 1440: axeDesktop, 360: axeMobile },
    provisioning: steps,
    apiAfter: { status: after.status, published: after.jobs.map((j) => j.slug) },
  });
  expect(axeDesktop.violations).toEqual([]);
  expect(axeMobile.violations).toEqual([]);
});

test('C5-02 Every public route at 360, 390, 430, 768, 1024, 1440 and 1920 CSS px: screenshots, overflow, clipping, targets, obscured controls', async ({ page }) => {
  await ensureJobs();
  const results = {};
  for (const [name, pathname] of ROUTES) {
    const views = [];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: heightFor(width) });
      const status = await openRoute(page, pathname);
      const layout = await layoutProbe(page);
      const controls = await controlsProbe(page);
      views.push({
        width,
        status,
        screenshot: await shot(page, `${name}-${width}`),
        layout,
        controlsTotal: controls.length,
        controlsBelow24: controls.filter((c) => c.below24),
        controlsFailing2_5_8: controls.filter((c) => c.fails2_5_8),
        controlsBelow44: controls.filter((c) => c.below44).map((c) => `${c.tag}:${c.name} ${c.width}x${c.height}`),
        controlsCovered: controls.filter((c) => c.covered),
      });
    }
    results[name] = { path: pathname, views, overflow: overflowFindings(views) };
  }
  record('C5-02', { observation: 'REAL', widths: WIDTHS, routes: results });
  const problems = Object.entries(results).flatMap(([name, r]) => [
    ...r.overflow.map((o) => `${name}@${o.width}: overflow/clip`),
    ...r.views.flatMap((v) => v.controlsFailing2_5_8.map((c) => `${name}@${v.width}: target ${c.tag} "${c.name}" ${c.width}x${c.height}`)),
    ...r.views.flatMap((v) => v.controlsCovered.map((c) => `${name}@${v.width}: covered ${c.tag} "${c.name}" by ${c.coveredBy}`)),
  ]);
  expect(problems).toEqual([]);
});

test('C5-03 Intermediate widths: every 10 px from 320 to 1920, each breakpoint -1/0, and phone landscape', async ({ page }) => {
  await ensureJobs();
  const sweep = [];
  for (let w = 320; w <= 1920; w += 10) sweep.push(w);
  for (const bp of BREAKPOINTS) sweep.push(bp - 1, bp);
  const widths = [...new Set(sweep)].sort((a, b) => a - b);
  const results = {};
  for (const [name, pathname] of ROUTES) {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openRoute(page, pathname);
    const failing = [];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const layout = await layoutProbe(page);
      if (layout.horizontalScroll || layout.outsideCount || layout.clippedCount) failing.push({ width, scrollWidth: layout.scrollWidth, outside: layout.outside.slice(0, 5), clipped: layout.clipped.slice(0, 5) });
    }
    const breakpointShots = [];
    if (['home', 'careers', 'job-open', 'apply-open'].includes(name)) {
      for (const bp of BREAKPOINTS) {
        for (const width of [bp - 1, bp]) {
          await page.setViewportSize({ width, height: 900 });
          await settle(page);
          breakpointShots.push(await shot(page, `bp-${name}-${width}`));
        }
      }
    }
    const landscape = [];
    for (const [width, height] of [[844, 390], [932, 430]]) {
      await page.setViewportSize({ width, height });
      await openRoute(page, pathname);
      landscape.push({ width, height, layout: await layoutProbe(page), screenshot: await shot(page, `landscape-${name}-${width}x${height}`, { fullPage: false }) });
    }
    results[name] = { widthsChecked: widths.length, failing, breakpointShots, landscape };
  }
  record('C5-03', { observation: 'REAL (viewport resized in place; landscape loaded fresh)', range: '320-1920 step 10, plus breakpoints -1/0', breakpoints: BREAKPOINTS, routes: results });
  const problems = Object.entries(results).flatMap(([name, r]) => [
    ...r.failing.map((f) => `${name}@${f.width}`),
    ...r.landscape.filter((l) => l.layout.horizontalScroll || l.layout.outsideCount).map((l) => `${name}@${l.width}x${l.height}`),
  ]);
  expect(problems).toEqual([]);
});

test('C5-04 Careers and Job Detail: loading (HOLD), error (FAULT) and recovery (REAL) at every width', async ({ page }) => {
  await ensureJobs();
  const out = {};
  for (const [name, pathname, matcher, loadingText, errorHeading, readyLocator] of [
    ['careers', '/careers', isJobsList, 'Loading open roles…', 'Open roles are temporarily unavailable.', (p) => p.getByRole('link', { name: /^View Role: / }).first()],
    ['job', `/careers/${C5_SLUGS.open}`, isJob(C5_SLUGS.open), 'Loading role details…', null, (p) => p.getByRole('link', { name: 'Apply for This Role' }).first()],
  ]) {
    // Loading: the real request is held until every width has been captured, then continued unchanged.
    let release;
    const released = new Promise((resolve) => { release = resolve; });
    await page.route(matcher, async (route) => { await released; await route.continue(); });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(pathname, { waitUntil: 'load' });
    await expect(page.getByText(loadingText)).toHaveCount(1);
    const loading = await atWidths(page, `${name}-loading`);
    const loadingAxe = await axe(page);
    const busy = await page.evaluate(() => [...document.querySelectorAll('[role="status"], [aria-live], [aria-busy="true"]')].map((el) => ({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), live: el.getAttribute('aria-live'), busy: el.getAttribute('aria-busy'), text: el.textContent.trim().slice(0, 80) })));
    release();
    await expect(readyLocator(page)).toBeVisible();
    await page.unroute(matcher);

    // Error: the request is aborted (a network failure); then Try Again with the real API.
    await page.route(matcher, (route) => route.abort('failed'));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(pathname, { waitUntil: 'load' });
    const retry = page.getByRole('button', { name: 'Try Again' });
    await expect(retry).toBeVisible();
    const heading = errorHeading ? await page.getByRole('heading', { name: errorHeading }).isVisible() : null;
    const error = await atWidths(page, `${name}-error`, { probeControls: true });
    const errorAxe = await axe(page);
    await page.unroute(matcher);
    await page.setViewportSize({ width: 390, height: 844 });
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(readyLocator(page)).toBeVisible();
    const recovered = await shot(page, `${name}-recovered-390`);
    const focusAfterRecovery = await page.evaluate(() => ({ tag: document.activeElement?.tagName.toLowerCase(), id: document.activeElement?.id || null, text: document.activeElement?.textContent?.trim().slice(0, 60) }));
    out[name] = { loading: { observation: 'HOLD', views: loading, overflow: overflowFindings(loading), axe: loadingAxe, liveRegions: busy }, error: { observation: 'FAULT (request aborted)', expectedHeadingVisible: heading, views: error, overflow: overflowFindings(error), axe: errorAxe }, recovery: { observation: 'REAL', screenshot: recovered, focusAfterRecovery } };
  }
  record('C5-04', out);
  for (const r of Object.values(out)) {
    expect(r.loading.axe.violations).toEqual([]);
    expect(r.error.axe.violations).toEqual([]);
    expect([...r.loading.overflow, ...r.error.overflow]).toEqual([]);
  }
});

test('C5-05 Careers -> Job Detail -> Apply end to end at 390 CSS px: validation, long values, resume, server refusal, submitting, network failure, recovery, success', async ({ page }) => {
  await ensureJobs();
  const states = {};
  const slug = C5_SLUGS.open;
  await page.setViewportSize({ width: 390, height: 844 });
  await openRoute(page, '/careers');
  const title = JSON.parse(readFileSync(path.join(FIXTURES_DIR, 'c5-jobs', `${slug}.json`), 'utf8')).title;
  await page.getByRole('link', { name: `View Role: ${title}` }).click();
  await expect(page).toHaveURL(new RegExp(`/careers/${slug}$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('QA C5 Synthetic Principal');
  await page.getByRole('link', { name: 'Apply for This Role' }).first().click();
  await expect(page).toHaveURL(new RegExp(`/careers/${slug}/apply$`));
  await settle(page);
  states.empty = { observation: 'REAL', views: await atWidths(page, 'apply-empty', { widths: [390] }) };

  // Client validation: submit the empty form.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Submit Application' }).click();
  await expect(page.getByText('Review the highlighted fields.')).toBeVisible();
  const focusAfterSubmit = await page.evaluate(() => ({ tag: document.activeElement?.tagName.toLowerCase(), text: document.activeElement?.textContent?.trim().slice(0, 80) }));
  const invalid = await page.evaluate(() => [...document.querySelectorAll('[aria-invalid="true"]')].map((el) => ({ name: el.getAttribute('name') || el.id, describedBy: (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent.trim().slice(0, 100) ?? `missing #${id}`) })));
  const validationViews = await atWidths(page, 'apply-validation', { probeControls: true });
  states.validation = { observation: 'REAL (client validation)', focusAfterSubmit, invalid, views: validationViews, overflow: overflowFindings(validationViews), axe: await axe(page) };

  // Long values and a resume with a long file name.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Full Name').fill('QA C5 Synthetic Candidate With A Deliberately Long Display Name For Wrapping');
  await page.getByLabel('Email Address').fill(LONG_EMAIL);
  await page.getByLabel('Phone Number').fill('+1 555 0100 2026');
  await page.getByLabel('Message').fill(`QA TEST DATA (C5): synthetic message.\n${'long-unbroken-synthetic-token-'.repeat(6)}end`);
  await page.locator('input[type="file"]').setInputFiles({ name: LONG_FILE, mimeType: 'application/pdf', buffer: readFileSync(RESUME_PDF) });
  await expect(page.getByText('Resume ready to submit.')).toBeVisible();
  await page.getByRole('radiogroup').first().getByRole('radio').first().check();
  await page.locator('select').last().selectOption({ index: 1 });
  const resumeViews = await atWidths(page, 'apply-resume-selected', { probeControls: true });
  states.resumeSelected = { observation: 'REAL (browser-side file checks)', views: resumeViews, overflow: overflowFindings(resumeViews), axe: await axe(page) };

  // Server refusal: a PNG named and typed as a PDF passes the browser, not the server's content check.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('input[type="file"]').setInputFiles(PNG_AS_PDF);
  await expect(page.getByText('Resume ready to submit.')).toBeVisible();
  await page.getByRole('button', { name: 'Submit Application' }).click();
  await expect(page.getByText('Review the highlighted fields.')).toBeVisible();
  const serverInvalid = await page.evaluate(() => [...document.querySelectorAll('[aria-invalid="true"]')].map((el) => ({ name: el.getAttribute('name') || el.id, describedBy: (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent.trim().slice(0, 100) ?? `missing #${id}`) })));
  const focusAfterRefusal = await page.evaluate(() => ({ tag: document.activeElement?.tagName.toLowerCase(), text: document.activeElement?.textContent?.trim().slice(0, 80) }));
  const refusalViews = await atWidths(page, 'apply-server-refusal', { probeControls: true });
  states.serverRefusal = { observation: 'REAL (server content check)', invalid: serverInvalid, focusAfterRefusal, views: refusalViews, overflow: overflowFindings(refusalViews), axe: await axe(page) };

  // Submitting (HOLD), then a network failure (FAULT), then Try Again (REAL) to success.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('input[type="file"]').setInputFiles({ name: LONG_FILE, mimeType: 'application/pdf', buffer: readFileSync(RESUME_PDF) });
  await expect(page.getByText('Resume ready to submit.')).toBeVisible();
  let release;
  const released = new Promise((resolve) => { release = resolve; });
  const applicationRequest = isApplication(slug);
  await page.route(applicationRequest, async (route) => { await released; await route.abort('failed'); });
  await page.getByRole('button', { name: 'Submit Application' }).click();
  await expect(page.getByRole('button', { name: 'Submitting…' })).toBeVisible();
  const submittingViews = await atWidths(page, 'apply-submitting', { widths: [390, 1440] });
  states.submitting = { observation: 'HOLD', views: submittingViews, axe: await axe(page) };
  release();
  await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
  await page.unroute(applicationRequest);
  const networkViews = await atWidths(page, 'apply-network-error', { probeControls: true });
  states.networkError = { observation: 'FAULT (request aborted)', views: networkViews, overflow: overflowFindings(networkViews), axe: await axe(page) };

  const { MongoClient } = createRequire(path.join(BACKEND_DIR, 'package.json'))('mongodb');
  const client = await MongoClient.connect(process.env.MONGODB_TEST_URI);
  const applications = () => client.db(run().databaseName).collection('applications').countDocuments({ 'candidate.emailNormalized': LONG_EMAIL.toLowerCase() });
  try {
    expect(await applications()).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Try Again' }).click();
    await expect(page.getByRole('heading', { name: 'Thank you for applying.' })).toBeVisible();
    const focusAfterSuccess = await page.evaluate(() => ({ tag: document.activeElement?.tagName.toLowerCase(), text: document.activeElement?.textContent?.trim().slice(0, 80) }));
    const successViews = await atWidths(page, 'apply-success', { probeControls: true });
    states.success = { observation: 'REAL (201 from the real backend)', applicationsStored: await applications(), focusAfterSuccess, views: successViews, overflow: overflowFindings(successViews), axe: await axe(page) };
  } finally {
    await client.close();
  }
  record('C5-05', { backend: C5_BACKEND_ORIGIN, states });
  expect(states.success.applicationsStored).toBe(1);
  for (const [name, s] of Object.entries(states)) {
    if (s.axe) expect(s.axe.violations, name).toEqual([]);
    if (s.overflow) expect(s.overflow, name).toEqual([]);
  }
});
