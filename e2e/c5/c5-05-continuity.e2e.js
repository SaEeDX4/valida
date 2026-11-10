import path from 'node:path';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { BACKEND_DIR } from '../support/paths.js';
import { C5_SLUGS } from '../support/c5Stack.js';
import { MISSING_JOB_SLUG, ensureJobs, focusProbe, record, settle, shot, waitForStill } from './c5Support.js';

/**
 * C5-21 — keyboard continuity when an outcome replaces the activated control, and the footer's return after a
 * loading state resolves (F4 keeps the footer unpainted only while content is pending). Chromium keyboard events
 * against the real stack; the error states are FAULT (a request aborted), recovered for REAL. A real screen reader
 * and physical devices stay on the manual checklist.
 */

const RESUME_PDF = path.join(BACKEND_DIR, 'tests', 'fixtures', 'resumes', 'qa-libreoffice.pdf');
const jobsList = (url) => new URL(url).pathname === '/api/v1/jobs';
const jobBySlug = (slug) => (url) => new URL(url).pathname === `/api/v1/jobs/${slug}`;
const applications = (slug) => (url) => new URL(url).pathname === `/api/v1/jobs/${slug}/applications`;

const active = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return { tag: el?.tagName.toLowerCase(), id: el?.id || null, text: (el?.getAttribute('aria-label') || el?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80), tabindex: el?.getAttribute('tabindex') };
});
const liveRegions = (page) => page.evaluate(() => [...document.querySelectorAll('[role="status"], [role="alert"], [aria-live]')]
  .filter((el) => el.textContent.trim())
  .map((el) => ({ role: el.getAttribute('role'), live: el.getAttribute('aria-live'), text: el.textContent.trim().slice(0, 100) })));
const footerState = (page) => page.evaluate(() => {
  const footer = document.querySelector('footer');
  const link = footer?.querySelector('a[href]');
  const r = link?.getBoundingClientRect();
  link?.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r2 = link?.getBoundingClientRect();
  const hit = r2 ? document.elementFromPoint(r2.left + r2.width / 2, r2.top + r2.height / 2) : null;
  return {
    visibility: footer ? getComputedStyle(footer).visibility : null,
    pendingMarker: Boolean(document.querySelector('[data-content-pending]')),
    firstLink: link ? { text: link.textContent.trim(), width: Math.round(r.width), clickable: Boolean(hit && (hit === link || link.contains(hit))) } : null,
  };
});

async function tabUntil(page, predicate, max = 80) {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    await waitForStill(page);
    const probe = await focusProbe(page);
    if (predicate(probe)) return probe;
  }
  throw new Error('keyboard: target never reached');
}
async function nextTab(page) {
  await page.keyboard.press('Tab');
  await waitForStill(page);
  return focusProbe(page);
}

test('C5-21 Keyboard continuity after Try Again recovery and Apply success; the footer returns after loading resolves', async ({ page }) => {
  await ensureJobs();
  await page.setViewportSize({ width: 1440, height: 900 });
  const out = { recovery: {}, apply: {}, footer: {} };

  // ---- Try Again recovery, by keyboard: Careers and Job Detail (FAULT, then REAL) ----
  for (const [name, pathname, matcher] of [['careers', '/careers', jobsList], ['job', `/careers/${C5_SLUGS.open}`, jobBySlug(C5_SLUGS.open)]]) {
    await page.route(matcher, (route) => route.abort('failed'));
    await page.goto(pathname, { waitUntil: 'load' });
    await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
    await settle(page);
    await tabUntil(page, (p) => p.tag === 'button' && p.name === 'Try Again');
    await page.unroute(matcher);
    await page.keyboard.press('Enter');
    if (name === 'careers') await expect(page.getByRole('link', { name: /^View Role: / }).first()).toBeVisible();
    else await expect(page.getByRole('link', { name: 'Apply for This Role' }).first()).toBeVisible();
    await waitForStill(page);
    const landed = await active(page);
    const live = await liveRegions(page);
    const shotPath = await shot(page, `continuity-${name}-recovered-1440`, { fullPage: false });
    const next = await nextTab(page);
    out.recovery[name] = { observation: 'FAULT then REAL', landed, nextTab: { tag: next.tag, name: next.name, indicator: next.indicator, inViewport: next.inViewport }, liveRegionsAfter: live, screenshot: shotPath };
  }

  // ---- Apply: network failure (FAULT), Try Again by keyboard, success (REAL) ----
  const slug = C5_SLUGS.open;
  await page.goto(`/careers/${slug}/apply`, { waitUntil: 'load' });
  await settle(page);
  await page.getByLabel('Full Name').fill('QA C5 Continuity Candidate');
  await page.getByLabel('Email Address').fill('qa+c5-continuity@example.test');
  await page.locator('input[type="file"]').setInputFiles({ name: 'qa-c5-continuity.pdf', mimeType: 'application/pdf', buffer: readFileSync(RESUME_PDF) });
  await expect(page.getByText('Resume ready to submit.')).toBeVisible();
  await page.getByRole('radiogroup').first().getByRole('radio').first().check();
  await page.locator('select').last().selectOption({ index: 1 });
  const post = applications(slug);
  await page.route(post, (route) => route.abort('failed'));
  await page.getByRole('button', { name: 'Submit Application' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
  out.apply.afterFailure = await active(page);
  await page.unroute(post);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Thank you for applying.' })).toBeVisible();
  await waitForStill(page);
  out.apply.landed = await active(page);
  out.apply.liveRegionsAfter = await liveRegions(page);
  out.apply.screenshot = await shot(page, 'continuity-apply-success-1440', { fullPage: false });
  const afterSuccess = await nextTab(page);
  out.apply.nextTab = { tag: afterSuccess.tag, name: afterSuccess.name, indicator: afterSuccess.indicator, inViewport: afterSuccess.inViewport };
  out.apply.footerAfterSuccess = await footerState(page);

  // ---- Footer: hidden only while pending; back after success, unavailable and error ----
  const hold = async (matcher, pathname) => {
    let release;
    const released = new Promise((resolve) => { release = resolve; });
    await page.route(matcher, async (route) => { await released; await route.continue(); });
    await page.goto(pathname, { waitUntil: 'load' });
    await page.waitForSelector('[data-content-pending]');
    const during = await footerState(page);
    release();
    return { during, done: () => page.unroute(matcher, { behavior: 'wait' }) };
  };
  for (const [name, pathname, matcher, ready] of [
    ['job-success', `/careers/${C5_SLUGS.open}`, jobBySlug(C5_SLUGS.open), (p) => p.getByRole('link', { name: 'Apply for This Role' }).first()],
    ['job-unavailable', `/careers/${MISSING_JOB_SLUG}`, jobBySlug(MISSING_JOB_SLUG), (p) => p.getByRole('heading', { level: 1 })],
    ['apply-success-load', `/careers/${C5_SLUGS.open}/apply`, jobBySlug(C5_SLUGS.open), (p) => p.getByRole('button', { name: 'Submit Application' })],
    ['apply-unavailable', `/careers/${MISSING_JOB_SLUG}/apply`, jobBySlug(MISSING_JOB_SLUG), (p) => p.getByRole('heading', { level: 1 })],
  ]) {
    const h = await hold(matcher, pathname);
    await expect(ready(page)).toBeVisible();
    await h.done();
    await waitForStill(page);
    out.footer[name] = { observation: 'HOLD then REAL', during: h.during, after: await footerState(page) };
  }
  for (const [name, pathname, matcher] of [['job-error', `/careers/${C5_SLUGS.open}`, jobBySlug(C5_SLUGS.open)], ['apply-error', `/careers/${C5_SLUGS.open}/apply`, jobBySlug(C5_SLUGS.open)]]) {
    let release;
    const released = new Promise((resolve) => { release = resolve; });
    await page.route(matcher, async (route) => { await released; await route.abort('failed'); });
    await page.goto(pathname, { waitUntil: 'load' });
    await page.waitForSelector('[data-content-pending]');
    const during = await footerState(page);
    release();
    await expect(page.getByRole('button', { name: 'Try Again' })).toBeVisible();
    await page.unroute(matcher, { behavior: 'wait' });
    await waitForStill(page);
    out.footer[name] = { observation: 'HOLD then FAULT', during, after: await footerState(page) };
  }

  record('C5-21', out);
  for (const [name, r] of Object.entries(out.recovery)) {
    expect.soft(r.landed.tag, `${name}: focus lands on a heading`).toMatch(/^h[12]$/);
    expect.soft(r.landed.tabindex, `${name}: programmatic target, not a Tab stop`).toBe('-1');
    expect.soft(r.nextTab.tag, `${name}: the next Tab is a control after the heading`).not.toBe('body');
    expect.soft(r.nextTab.indicator && r.nextTab.inViewport, `${name}: next stop visible`).toBe(true);
  }
  expect.soft(out.recovery.careers.landed.text).toBe('Open Roles');
  expect.soft(out.recovery.job.landed.id).toBe('job-title');
  expect.soft(out.apply.afterFailure.text, 'focus stays on the retry button after a failure').toBe('Try Again');
  expect.soft(out.apply.landed.text).toBe('Thank you for applying.');
  expect.soft(out.apply.nextTab.name).toBe('Back to Careers');
  // No duplicate announcement: the focused heading's text is in no live region.
  expect.soft(out.apply.liveRegionsAfter.filter((l) => l.text.includes('Thank you for applying.'))).toEqual([]);
  for (const [name, r] of Object.entries(out.footer)) {
    expect.soft(r.during.visibility, `${name}: footer unpainted while pending`).toBe('hidden');
    expect.soft(r.after.visibility, `${name}: footer back`).toBe('visible');
    expect.soft(r.after.pendingMarker, `${name}: no pending marker left`).toBe(false);
    expect.soft(r.after.firstLink?.clickable, `${name}: footer link reachable`).toBe(true);
  }
  expect.soft(out.apply.footerAfterSuccess.visibility).toBe('visible');
});
