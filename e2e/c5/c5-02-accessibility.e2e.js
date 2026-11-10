import path from 'node:path';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { BACKEND_DIR, FIXTURES_DIR, FRONTEND_DIR } from '../support/paths.js';
import { C5_SITE_ORIGIN, C5_SLUGS } from '../support/c5Stack.js';
import {
  ROUTES, axe, ensureJobs, openRoute, waitForStill, focusProbe, headingProblems, layoutProbe, motionProbe, record, settle, shot, structureProbe, writeText,
} from './c5Support.js';

/**
 * C5 — accessibility of the integrated site (Doc 16 sections 8-58 and 267;
 * Doc 17 sections 244-257). Chromium only (Playwright's build); every
 * emulation is labelled EMULATED. What only a person with a real screen
 * reader, browser or device can establish is NOT claimed here: it is the
 * manual checklist of the C5 handoff (NVDA with Chrome and Firefox, other
 * browsers, real devices, OS text scaling).
 */

const RESUME_PDF = path.join(BACKEND_DIR, 'tests', 'fixtures', 'resumes', 'qa-libreoffice.pdf');
const AXE_PATH = path.join(FRONTEND_DIR, 'node_modules', 'axe-core', 'axe.min.js');
const OPEN_TITLE = JSON.parse(readFileSync(path.join(FIXTURES_DIR, 'c5-jobs', `${C5_SLUGS.open}.json`), 'utf8')).title;


/** Tabs (or Shift+Tabs) through the page, probing every stop, until focus comes back round. */
async function traverse(page, { backwards = false, maxStops = 120 } = {}) {
  const stops = [];
  const key = backwards ? 'Shift+Tab' : 'Tab';
  let first = null;
  for (let i = 0; i < maxStops; i += 1) {
    await page.keyboard.press(key);
    await waitForStill(page);
    const probe = await focusProbe(page);
    const id = `${probe.tag}|${probe.name}|${probe.rect?.top + (await page.evaluate(() => scrollY))}`;
    if (probe.tag === 'body') break;
    if (first === null) first = id;
    else if (id === first) break;
    stops.push(probe);
  }
  return stops;
}
const focusFailures = (stops) => stops.filter((s) => !s.indicator || !s.inViewport || s.hiddenUnderHeader).map((s) => ({ tag: s.tag, name: s.name, indicator: s.indicator, inViewport: s.inViewport, hiddenUnderHeader: s.hiddenUnderHeader, rect: s.rect }));

test('C5-06 axe-core (WCAG 2.0/2.1/2.2 A and AA) on every public route at 360 and 1440 CSS px', async ({ page }) => {
  await ensureJobs();
  const results = {};
  for (const [name, pathname] of ROUTES) {
    results[name] = {};
    for (const width of [360, 1440]) {
      await page.setViewportSize({ width, height: width === 360 ? 800 : 900 });
      await openRoute(page, pathname);
      results[name][width] = await axe(page);
    }
  }
  // The mobile navigation, open.
  await page.setViewportSize({ width: 390, height: 844 });
  await openRoute(page, '/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  results['mobile-menu-open'] = { 390: await axe(page) };
  // WCAG 2.5.3 Label in Name: axe's rule for it is "experimental" and outside the tags above, so it is run on its own and RECORDED.
  const labelInName = {};
  for (const [name, pathname, width] of [['home', '/', 390], ['careers', '/careers', 390], ['careers', '/careers', 1440], ['apply-open', `/careers/${C5_SLUGS.open}/apply`, 1440]]) {
    await page.setViewportSize({ width, height: 900 });
    await openRoute(page, pathname);
    await page.addScriptTag({ path: AXE_PATH });
    labelInName[`${name}@${width}`] = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'rule', values: ['label-content-name-mismatch'] } })).violations.flatMap((v) => v.nodes.map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 160) }))));
  }
  record('C5-06', { observation: 'REAL (axe-core in Chromium)', axeVersion: results.home[360].version, tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'], results, labelInName: { rule: 'label-content-name-mismatch (axe experimental; WCAG 2.5.3, Level A)', gating: false, why: 'The accessible names involved are canonical Doc 06 copy; escalated under Doc 00 change control (C5 handoff). Recorded, not gated.', results: labelInName } });
  const violations = Object.entries(results).flatMap(([name, byWidth]) => Object.entries(byWidth).flatMap(([w, r]) => r.violations.map((v) => `${name}@${w}: ${v.id} (${v.nodes})`)));
  expect(violations).toEqual([]);
});

test('C5-07 Structure on every route: lang, title, one main, landmarks, one h1, heading order, skip link first, no positive tabindex', async ({ page }) => {
  await ensureJobs();
  const results = {};
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [name, pathname] of ROUTES) {
    await openRoute(page, pathname);
    const structure = await structureProbe(page);
    const counts = await page.evaluate(() => ({
      main: document.querySelectorAll('main').length,
      positiveTabindex: [...document.querySelectorAll('[tabindex]')].filter((el) => Number(el.getAttribute('tabindex')) > 0).length,
      firstFocusable: (() => {
        const el = document.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
        return el ? `${el.tagName.toLowerCase()} "${el.textContent.trim()}" -> ${el.getAttribute('href')}` : null;
      })(),
      imagesWithoutAlt: [...document.images].filter((img) => !img.hasAttribute('alt')).length,
      // Every list in the design is drawn without default markers; a marker left on hangs outside its column (C5 F1).
      // A marker is drawn only for an element displayed as a list-item (a grid or flex li draws none).
      listsWithDefaultMarkers: [...new Set([...document.querySelectorAll('li')].filter((li) => getComputedStyle(li).display === 'list-item' && getComputedStyle(li).listStyleType !== 'none').map((li) => `${li.parentElement.tagName.toLowerCase()}.${String(li.parentElement.className).split(' ')[0]}`))],
    }));
    results[name] = { ...structure, ...counts, headingProblems: headingProblems(structure.headings) };
  }
  record('C5-07', { observation: 'REAL', results });
  for (const [name, r] of Object.entries(results)) {
    expect.soft(r.lang, name).toBe('en');
    expect.soft(r.main, name).toBe(1);
    expect.soft(r.positiveTabindex, name).toBe(0);
    expect.soft(r.imagesWithoutAlt, name).toBe(0);
    expect.soft(r.listsWithDefaultMarkers, name).toEqual([]);
    expect.soft(r.firstFocusable, name).toBe('a "Skip to main content" -> #main-content');
    expect.soft(r.headingProblems, name).toEqual([]);
  }
});

test('C5-08 Keyboard at 1440 and 390 CSS px: skip link, full Tab and Shift+Tab order, focus visible and not hidden by the sticky header', async ({ page }) => {
  await ensureJobs();
  const results = {};
  const pages = [['home', '/'], ['careers', '/careers'], ['job-open', `/careers/${C5_SLUGS.open}`], ['job-closed', `/careers/${C5_SLUGS.closed}`], ['apply-open', `/careers/${C5_SLUGS.open}/apply`], ['privacy', '/privacy'], ['not-found', '/qa-c5-no-such-page']];
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    for (const [name, pathname] of pages) {
      await page.setViewportSize({ width, height });
      await openRoute(page, pathname);
      // Skip link: first stop, visible when focused, moves focus to <main>.
      await page.keyboard.press('Tab');
      await waitForStill(page);
      const skip = await focusProbe(page);
      await page.keyboard.press('Enter');
      const afterSkip = await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName.toLowerCase());
      await openRoute(page, pathname);
      const forward = await traverse(page);
      await openRoute(page, pathname);
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
      await page.locator('footer a, footer button').last().focus().catch(() => {});
      const backward = await traverse(page, { backwards: true });
      results[`${name}@${width}`] = {
        skip, afterSkip,
        forwardStops: forward.length, forward,
        backwardStops: backward.length,
        forwardFailures: focusFailures(forward),
        backwardFailures: focusFailures(backward),
        backwardPartlyObscured: backward.filter((s) => s.obscured && !s.hiddenUnderHeader).map((s) => `${s.tag} "${s.name}"`),
      };
    }
  }
  record('C5-08', { observation: 'REAL (Chromium keyboard events)', results });
  for (const [name, r] of Object.entries(results)) {
    expect.soft(r.skip.name, name).toBe('Skip to main content');
    expect.soft(r.skip.inViewport && r.skip.indicator, name).toBe(true);
    expect.soft(r.afterSkip, name).toBe('main-content');
    expect.soft(r.forwardFailures, `${name} forward`).toEqual([]);
    expect.soft(r.backwardFailures, `${name} backward`).toEqual([]);
  }
});

test('C5-09 Mobile navigation by keyboard: expanded state, Escape, focus restoration, navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRoute(page, '/');
  const trigger = page.getByRole('button', { name: 'Open navigation' });
  let stops = 0;
  while (!(await trigger.evaluate((el) => el === document.activeElement)) && stops < 10) {
    await page.keyboard.press('Tab');
    stops += 1;
  }
  const beforeOpen = { tabsToTrigger: stops, expanded: await trigger.getAttribute('aria-expanded') };
  await page.keyboard.press('Enter');
  const close = page.getByRole('button', { name: 'Close navigation' });
  await expect(close).toHaveAttribute('aria-expanded', 'true');
  const panelId = await close.getAttribute('aria-controls');
  const panelVisible = await page.locator(`#${panelId}`).isVisible();
  const openShot = await shot(page, 'kbd-mobile-menu-open-390', { fullPage: false });
  const inPanel = [];
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    await waitForStill(page);
    inPanel.push(await focusProbe(page));
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveAttribute('aria-expanded', 'false');
  await waitForStill(page);
  const afterEscape = await focusProbe(page);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await waitForStill(page);
  const target = await focusProbe(page);
  await page.keyboard.press('Enter');
  await page.waitForURL((url) => url.pathname !== '/');
  await settle(page);
  const afterNavigate = { url: new URL(page.url()).pathname, focus: await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName.toLowerCase()), menuExpanded: await page.getByRole('button', { name: /navigation/ }).getAttribute('aria-expanded') };
  record('C5-09', { observation: 'REAL (Chromium keyboard events)', beforeOpen, panelVisible, openShot, inPanel, afterEscape, target, afterNavigate });
  expect(beforeOpen.expanded).toBe('false');
  expect(panelVisible).toBe(true);
  expect(inPanel.every((s) => s.indicator && s.inViewport)).toBe(true);
  expect(afterEscape.name).toBe('Open navigation');
  expect(afterNavigate.focus).toBe('main-content');
  expect(afterNavigate.menuExpanded).toBe('false');
});

test('C5-10 Keyboard only: Careers -> Job Detail -> Apply, validation summary, error links, every field, the file chooser, submit, success', async ({ page }) => {
  await ensureJobs();
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRoute(page, '/careers');
  const journey = [];
  const tabTo = async (predicate, label, max = 60) => {
    for (let i = 0; i < max; i += 1) {
      await page.keyboard.press('Tab');
      await waitForStill(page);
      const probe = await focusProbe(page);
      if (predicate(probe)) {
        journey.push({ step: label, tabs: i + 1, probe });
        return probe;
      }
    }
    throw new Error(`keyboard: never reached ${label}`);
  };
  await tabTo((p) => p.tag === 'a' && `View ${OPEN_TITLE} role`.startsWith(p.name) && p.name.startsWith('View QA C5 Synthetic Principal'), 'Careers: the role row');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/careers/${C5_SLUGS.open}$`));
  await settle(page);
  journey.push({ step: 'Job Detail: focus after navigation', focus: await page.evaluate(() => document.activeElement?.id) });
  await tabTo((p) => p.name === 'Apply for This Role', 'Job Detail: Apply for This Role');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/careers/${C5_SLUGS.open}/apply$`));
  await settle(page);
  journey.push({ step: 'Apply: focus after navigation', focus: await page.evaluate(() => document.activeElement?.id) });

  // Submit the empty form from the keyboard.
  await tabTo((p) => p.name === 'Submit Application', 'Apply: Submit Application (empty form)');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Review the highlighted fields.')).toBeVisible();
  const summaryFocus = await page.evaluate(() => ({ testid: document.activeElement?.getAttribute('data-testid'), tabindex: document.activeElement?.getAttribute('tabindex') }));
  journey.push({ step: 'Apply: focus after the failed submission', focus: summaryFocus });
  const summaryShot = await shot(page, 'kbd-apply-summary-1440', { fullPage: false });
  // The first error link in the summary moves focus to its field.
  await page.keyboard.press('Tab');
  await waitForStill(page);
  const firstLink = await focusProbe(page);
  await page.keyboard.press('Enter');
  await waitForStill(page);
  const afterLink = await focusProbe(page);
  journey.push({ step: 'Apply: first summary link, then Enter', link: firstLink, afterLink });
  const linkShot = await shot(page, 'kbd-apply-after-summary-link-1440', { fullPage: false });

  // Fill every field by keyboard, from the top of the form.
  await page.getByLabel('Full Name').focus();
  await page.keyboard.type('QA C5 Keyboard Candidate');
  await page.keyboard.press('Tab');
  await page.keyboard.type('qa+c5-keyboard@example.test');
  await page.keyboard.press('Tab');
  await page.keyboard.type('+1 555 0100 2026');
  const fileProbe = await tabTo((p) => p.type === 'file', 'Apply: resume control');
  // Enter, then Space if Enter opened nothing (a harness flake seen once with Enter in headless Chromium); bounded, and recorded.
  let chooser = null;
  const chooserKeys = [];
  for (const key of ['Enter', 'Space']) {
    const chooserPromise = page.waitForEvent('filechooser', { timeout: 5_000 }).catch(() => null);
    await page.keyboard.press(key);
    chooser = await chooserPromise;
    chooserKeys.push({ key, opened: Boolean(chooser) });
    if (chooser) break;
  }
  expect(chooser, 'the file chooser opens from the keyboard').not.toBeNull();
  // The operating system's file dialog itself is outside the page: the file is supplied to the chooser the keyboard opened.
  await chooser.setFiles({ name: 'qa-c5-keyboard-resume.pdf', mimeType: 'application/pdf', buffer: readFileSync(RESUME_PDF) });
  await expect(page.getByText('Resume ready to submit.')).toBeVisible();
  journey.push({ step: 'Apply: file chooser opened from the keyboard', fileProbe, chooserKeys });
  await tabTo((p) => p.name === 'Message', 'Apply: Message');
  await page.keyboard.type('QA TEST DATA (C5 keyboard): synthetic message.');
  await tabTo((p) => p.type === 'radio', 'Apply: first radio');
  await page.keyboard.press('Space');
  const radio = await page.evaluate(() => document.activeElement?.checked);
  await tabTo((p) => p.tag === 'select', 'Apply: single select');
  await page.keyboard.press('ArrowDown');
  const selectValue = await page.evaluate(() => document.activeElement?.selectedIndex);
  await tabTo((p) => p.name === 'Submit Application', 'Apply: Submit Application (completed form)');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Thank you for applying.' })).toBeVisible();
  const successFocus = await page.evaluate(() => ({ tag: document.activeElement?.tagName.toLowerCase(), id: document.activeElement?.id, text: document.activeElement?.textContent?.trim().slice(0, 60) }));
  journey.push({ step: 'Apply: success', radioChecked: radio, selectIndex: selectValue, focus: successFocus });
  const successShot = await shot(page, 'kbd-apply-success-1440', { fullPage: false });
  record('C5-10', { observation: 'REAL (Chromium keyboard events; real backend submission). The OS file dialog is supplied through Playwright\'s file chooser', journey, screenshots: [summaryShot, linkShot, successShot] });
  expect(summaryFocus.testid).toBe('validation-summary');
  expect(afterLink.tag).not.toBe('body');
  expect(afterLink.hiddenUnderHeader).toBe(false);
  expect(journey.every((j) => !j.probe || (j.probe.indicator && j.probe.inViewport))).toBe(true);
});

test('C5-11 Screen-reader proxies: accessibility tree of every route and Apply state, live regions and error associations', async ({ page }) => {
  await ensureJobs();
  await page.setViewportSize({ width: 1440, height: 900 });
  const files = {};
  for (const [name, pathname] of ROUTES) {
    await openRoute(page, pathname);
    files[name] = writeText('aria', `${name}.yaml`, await page.locator('body').ariaSnapshot());
  }
  await openRoute(page, `/careers/${C5_SLUGS.open}/apply`);
  const liveBefore = await page.evaluate(() => [...document.querySelectorAll('[role="status"], [role="alert"], [aria-live]')].map((el) => ({ role: el.getAttribute('role'), live: el.getAttribute('aria-live'), text: el.textContent.trim().slice(0, 60) })));
  await page.getByRole('button', { name: 'Submit Application' }).click();
  await expect(page.getByText('Review the highlighted fields.')).toBeVisible();
  files['apply-validation'] = writeText('aria', 'apply-validation.yaml', await page.locator('body').ariaSnapshot());
  const liveAfter = await page.evaluate(() => [...document.querySelectorAll('[role="status"], [role="alert"], [aria-live]')].filter((el) => el.textContent.trim()).map((el) => ({ role: el.getAttribute('role'), live: el.getAttribute('aria-live'), text: el.textContent.trim().slice(0, 80) })));
  const associations = await page.evaluate(() => [...document.querySelectorAll('input, select, textarea, [role="radiogroup"]')].filter((el) => el.type !== 'hidden').map((el) => ({
    control: el.getAttribute('name') || el.id || el.getAttribute('role'),
    labelled: Boolean(el.labels?.length || el.getAttribute('aria-labelledby') || el.getAttribute('aria-label') || el.closest('fieldset')?.querySelector('legend')),
    required: el.required || el.getAttribute('aria-required') === 'true',
    invalid: el.getAttribute('aria-invalid'),
    describedBy: (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map((id) => ({ id, exists: Boolean(document.getElementById(id)), text: document.getElementById(id)?.textContent.trim().slice(0, 80) ?? null })),
    autocomplete: el.getAttribute('autocomplete'),
  })));
  record('C5-11', { observation: 'REAL DOM and Chromium accessibility tree (a proxy: a real screen reader stays a manual check)', files, liveBefore, liveAfterFailedSubmit: liveAfter, associations });
  const invalidWithoutMessage = associations.filter((a) => a.invalid === 'true' && !a.describedBy.some((d) => d.exists && d.text));
  expect(invalidWithoutMessage).toEqual([]);
  expect(associations.every((a) => a.labelled)).toBe(true);
});

test('C5-12 Text at 200% (browser font-size setting) and page zoom 200% (EMULATED): layout, overflow, function', async ({ page, context }) => {
  await ensureJobs();
  const results = { fontSetting: {}, zoom: {} };
  // (a) The browser's default font size doubled (16 -> 32 px), as Chrome's font-size setting does.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 26 } });
  for (const [width, height] of [[1280, 900], [390, 844]]) {
    for (const [name, pathname] of [['home', '/'], ['careers', '/careers'], ['job-open', `/careers/${C5_SLUGS.open}`], ['apply-open', `/careers/${C5_SLUGS.open}/apply`], ['privacy', '/privacy']]) {
      await page.setViewportSize({ width, height });
      await openRoute(page, pathname);
      const sizes = await page.evaluate(() => ({ root: getComputedStyle(document.documentElement).fontSize, body: getComputedStyle(document.body).fontSize, h1: getComputedStyle(document.querySelector('h1')).fontSize }));
      results.fontSetting[`${name}@${width}`] = { sizes, layout: await layoutProbe(page), screenshot: await shot(page, `text200-${name}-${width}`) };
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await openRoute(page, `/careers/${C5_SLUGS.open}/apply`);
  await page.getByRole('button', { name: 'Submit Application' }).click();
  await expect(page.getByText('Review the highlighted fields.')).toBeVisible();
  results.fontSetting['apply-validation@390'] = { layout: await layoutProbe(page), screenshot: await shot(page, 'text200-apply-validation-390') };
  await cdp.send('Page.setFontSizes', { fontSizes: { standard: 16, fixed: 13 } });

  // (b) Page zoom 200% of a 1280x900 window = a 640x450 CSS px viewport at device scale 2.
  const zoomed = await context.browser().newContext({ viewport: { width: 640, height: 450 }, deviceScaleFactor: 2, locale: 'en-CA' });
  const zpage = await zoomed.newPage();
  try {
    for (const [name, pathname] of [['home', '/'], ['careers', '/careers'], ['job-open', `/careers/${C5_SLUGS.open}`], ['apply-open', `/careers/${C5_SLUGS.open}/apply`]]) {
      await openRoute(zpage, `${C5_SITE_ORIGIN}${pathname}`);
      results.zoom[name] = { layout: await layoutProbe(zpage), header: await zpage.evaluate(() => Math.round(document.querySelector('header').getBoundingClientRect().height)), screenshot: await shot(zpage, `zoom200-${name}`) };
    }
    // Function at 200%: the mobile navigation opens, the Apply form validates.
    await openRoute(zpage, `${C5_SITE_ORIGIN}/`);
    const menu = zpage.getByRole('button', { name: 'Open navigation' });
    results.zoom.menuButtonVisible = await menu.isVisible();
    if (results.zoom.menuButtonVisible) {
      await menu.click();
      results.zoom.menuExpanded = await zpage.getByRole('button', { name: 'Close navigation' }).getAttribute('aria-expanded');
    }
    await openRoute(zpage, `${C5_SITE_ORIGIN}/careers/${C5_SLUGS.open}/apply`);
    await zpage.getByRole('button', { name: 'Submit Application' }).click();
    results.zoom.applyValidates = await zpage.getByText('Review the highlighted fields.').isVisible();
  } finally {
    await zoomed.close();
  }
  record('C5-12', { observation: 'EMULATED (Chromium font-size setting via CDP Page.setFontSizes; page zoom as the equivalent CSS viewport at device scale 2)', results });
  const problems = [
    ...Object.entries(results.fontSetting).filter(([, r]) => r.layout.horizontalScroll || r.layout.outsideCount || r.layout.clippedCount).map(([n]) => `text200 ${n}`),
    ...Object.entries(results.zoom).filter(([, r]) => r?.layout && (r.layout.horizontalScroll || r.layout.outsideCount || r.layout.clippedCount)).map(([n]) => `zoom200 ${n}`),
  ];
  expect(problems).toEqual([]);
  expect(results.zoom.applyValidates).toBe(true);
});

test('C5-13 Reflow at 320 CSS px (400% zoom of 1280 px, EMULATED): no two-dimensional scrolling, header share of a 256 px-high viewport', async ({ browser }) => {
  await ensureJobs();
  const ctx = await browser.newContext({ viewport: { width: 320, height: 256 }, deviceScaleFactor: 4, locale: 'en-CA' });
  const zpage = await ctx.newPage();
  const results = {};
  try {
    const base = C5_SITE_ORIGIN;
    for (const [name, pathname] of ROUTES) {
      await openRoute(zpage, `${base}${pathname}`);
      const header = await zpage.evaluate(() => {
        const h = document.querySelector('header');
        const r = h.getBoundingClientRect();
        return { height: Math.round(r.height), position: getComputedStyle(h).position, share: Math.round((r.height / innerHeight) * 100) };
      });
      results[name] = { layout: await layoutProbe(zpage), header, screenshot: await shot(zpage, `reflow320-${name}`, { fullPage: false }) };
    }
    await openRoute(zpage, `${base}/careers/${C5_SLUGS.open}/apply`);
    await zpage.getByRole('button', { name: 'Submit Application' }).click();
    await expect(zpage.getByText('Review the highlighted fields.')).toBeVisible();
    results['apply-validation'] = { layout: await layoutProbe(zpage), screenshot: await shot(zpage, 'reflow320-apply-validation') };
  } finally {
    await ctx.close();
  }
  record('C5-13', { observation: 'EMULATED (320x256 CSS px viewport at device scale 4)', results });
  const problems = Object.entries(results).filter(([, r]) => r.layout.horizontalScroll || r.layout.outsideCount || r.layout.clippedCount).map(([n]) => n);
  expect(problems).toEqual([]);
});

test('C5-14 Reduced motion (EMULATED prefers-reduced-motion: reduce): no running animation or transition, instant scrolling', async ({ page }) => {
  await ensureJobs();
  const results = {};
  for (const mode of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion: mode });
    results[mode] = {};
    for (const [name, pathname] of [['home', '/'], ['careers', '/careers'], ['job-open', `/careers/${C5_SLUGS.open}`], ['apply-open', `/careers/${C5_SLUGS.open}/apply`]]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openRoute(page, pathname);
      results[mode][name] = await motionProbe(page);
    }
    // The loading skeleton, held.
    let release;
    const released = new Promise((resolve) => { release = resolve; });
    const matcher = (url) => new URL(url).pathname === '/api/v1/jobs';
    await page.route(matcher, async (route) => { await released; await route.continue(); });
    await page.goto('/careers', { waitUntil: 'load' });
    await expect(page.getByText('Loading open roles…')).toHaveCount(1);
    results[mode]['careers-loading'] = await motionProbe(page);
    release();
    await expect(page.getByRole('link', { name: /^View .+ role$/ }).first()).toBeVisible();
    await page.unroute(matcher, { behavior: 'wait' });
  }
  await page.emulateMedia({ reducedMotion: null });
  record('C5-14', { observation: 'EMULATED (Chromium media emulation)', results });
  for (const [name, r] of Object.entries(results.reduce)) {
    expect.soft(r.scrollBehavior, name).toBe('auto');
    expect.soft(r.running, name).toBe(0);
    expect.soft(r.moving.filter((m) => m.animation), name).toEqual([]);
  }
});

test('C5-15 Non-text contrast of form controls, buttons and the focus ring (computed colours)', async ({ page }) => {
  await ensureJobs();
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRoute(page, `/careers/${C5_SLUGS.open}/apply`);
  const measure = () => page.evaluate(() => {
    const rgb = (value) => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r, g, b, a };
    };
    const lum = ({ r, g, b }) => {
      const c = [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100; };
    const backgroundOf = (el) => {
      for (let node = el.parentElement; node; node = node.parentElement) {
        const c = rgb(getComputedStyle(node).backgroundColor);
        if (c && c.a > 0) return c;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };
    const rows = [];
    const add = (label, el, colour) => {
      if (!el) return;
      const bg = backgroundOf(el);
      const own = rgb(getComputedStyle(el).backgroundColor);
      const fill = own && own.a > 0 ? blend(own, bg) : bg;
      const fg = blend(rgb(colour), fill);
      rows.push({ label, colour, against: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`, ratioToSurroundings: ratio(blend(rgb(colour), bg), bg), ratioToOwnFill: ratio(fg, fill) });
    };
    const input = document.querySelector('input[type="text"], input[type="email"], input:not([type])');
    add('text input border', input, getComputedStyle(input).borderTopColor);
    const fillBg = rgb(getComputedStyle(input).backgroundColor);
    rows.push({ label: 'text input fill vs page', colour: getComputedStyle(input).backgroundColor, ratioToSurroundings: fillBg && fillBg.a > 0 ? ratio(blend(fillBg, backgroundOf(input)), backgroundOf(input)) : 1 });
    const select = document.querySelector('select');
    add('select border', select, getComputedStyle(select).borderTopColor);
    const textarea = document.querySelector('textarea');
    add('textarea border', textarea, getComputedStyle(textarea).borderTopColor);
    const picker = document.querySelector('input[type="file"] + label');
    add('resume picker border', picker, getComputedStyle(picker).borderTopColor);
    const submit = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Submit Application');
    const sb = rgb(getComputedStyle(submit).backgroundColor);
    rows.push({ label: 'primary button fill vs page', colour: getComputedStyle(submit).backgroundColor, ratioToSurroundings: ratio(blend(sb, backgroundOf(submit)), backgroundOf(submit)) });
    const focusColour = getComputedStyle(document.documentElement).getPropertyValue('--color-focus').trim();
    const probe = document.createElement('div');
    probe.style.color = focusColour;
    document.body.appendChild(probe);
    const focus = getComputedStyle(probe).color;
    probe.remove();
    add('focus ring (--color-focus)', input, focus);
    return rows;
  });
  const apply = await measure();
  await page.getByRole('button', { name: 'Submit Application' }).click();
  await expect(page.getByText('Review the highlighted fields.')).toBeVisible();
  const invalid = await page.evaluate(() => {
    const el = document.querySelector('[aria-invalid="true"]');
    return { control: el?.getAttribute('name'), border: el ? getComputedStyle(el).borderTopColor : null };
  });
  record('C5-15', { observation: 'REAL computed colours (opaque blending; gradients and images are not modelled)', requirement: 'WCAG 1.4.11: 3:1 for the visual information needed to identify a component or state', apply, invalidStateBorder: invalid });
  const identifying = apply.filter((r) => /border|ring|fill vs page/.test(r.label));
  expect(identifying.some((r) => r.label === 'focus ring (--color-focus)' && r.ratioToSurroundings >= 3)).toBe(true);
  expect(identifying.filter((r) => /input border|select border|textarea border/.test(r.label)).every((r) => r.ratioToSurroundings >= 3 || apply.find((x) => x.label === 'text input fill vs page').ratioToSurroundings >= 3)).toBe(true);
});

test('C5-15b Text contrast where axe needs review (text over the Home gradients): measured from rendered pixels', async ({ page }) => {
  await ensureJobs();
  const results = {};
  for (const [width, height] of [[360, 800], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await openRoute(page, '/');
    await page.addScriptTag({ path: AXE_PATH });
    const targets = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] }, resultTypes: ['incomplete'] })).incomplete.flatMap((v) => v.nodes.map((n) => n.target.join(' '))));
    const rows = [];
    for (const target of targets) {
      const el = page.locator(target).first();
      await el.scrollIntoViewIfNeeded();
      await waitForStill(page);
      const info = await el.evaluate((node) => {
        const r = node.getBoundingClientRect();
        const s = getComputedStyle(node);
        // The content box: the text's own background, without the element's border or padding edge.
        const px = (v) => parseFloat(v) || 0;
        const left = px(s.borderLeftWidth) + px(s.paddingLeft);
        const top = px(s.borderTopWidth) + px(s.paddingTop);
        const width = r.width - left - px(s.borderRightWidth) - px(s.paddingRight);
        const height = r.height - top - px(s.borderBottomWidth) - px(s.paddingBottom);
        return { x: r.left + left, y: r.top + top, width, height, color: s.color, fontSize: s.fontSize, fontWeight: s.fontWeight, text: node.textContent.trim().slice(0, 40) };
      });
      // Two captures of the same box: as rendered, and with every glyph made transparent. Pixels that differ
      // are where text is drawn; the contrast is taken against the background at exactly those pixels, so a
      // decoration in the same box that no text covers (a rule, a border, a glow) does not count.
      const clip = { x: Math.max(0, info.x), y: Math.max(0, info.y), width: Math.max(1, Math.min(info.width, width - Math.max(0, info.x))), height: Math.max(1, info.height) };
      // animations: 'disabled' ends running transitions (buttons fade their colour over 180 ms).
      const withText = await page.screenshot({ clip, animations: 'disabled' });
      const hide = await page.addStyleTag({ content: '* { color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }' });
      const background = await page.screenshot({ clip, animations: 'disabled' });
      await hide.evaluate((tag) => tag.remove());
      const ratio = await page.evaluate(async ({ a64, b64, color }) => {
        const pixels = async (b) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b}`;
          await img.decode();
          const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          return ctx.getImageData(0, 0, img.width, img.height).data;
        };
        const [shown, bare] = [await pixels(a64), await pixels(b64)];
        const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
        const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
        const [r, g, b] = color.match(/[\d.]+/g).map(Number);
        const fg = lum(r, g, b);
        const ratios = [];
        for (let i = 0; i < bare.length; i += 4) {
          const changed = Math.abs(shown[i] - bare[i]) + Math.abs(shown[i + 1] - bare[i + 1]) + Math.abs(shown[i + 2] - bare[i + 2]) > 24;
          if (!changed) continue;
          const bg = lum(bare[i], bare[i + 1], bare[i + 2]);
          const [hi, lo] = fg > bg ? [fg, bg] : [bg, fg];
          ratios.push((hi + 0.05) / (lo + 0.05));
        }
        ratios.sort((x, y) => x - y);
        const at = (q) => (ratios.length ? Math.round(ratios[Math.min(ratios.length - 1, Math.floor(q * ratios.length))] * 100) / 100 : null);
        return { glyphPixels: ratios.length, worst: at(0), p05: at(0.05), median: at(0.5) };
      }, { a64: withText.toString('base64'), b64: background.toString('base64'), color: info.color });
      const large = parseFloat(info.fontSize) >= 24 || (parseFloat(info.fontSize) >= 18.66 && Number(info.fontWeight) >= 700);
      rows.push({ target, text: info.text, color: info.color, fontSize: info.fontSize, required: large ? 3 : 4.5, ...ratio });
    }
    results[width] = rows;
  }
  record('C5-15b', { observation: 'REAL rendered pixels in Chromium: the ratio between the text colour and the background at each pixel where text is drawn (rendered minus text-hidden capture of the content box); worst, 5th percentile and median', results });
  for (const [width, rows] of Object.entries(results)) for (const r of rows) expect.soft(r.worst, `${width} ${r.target}`).toBeGreaterThanOrEqual(r.required);
});

test('C5-16 Forced colours (EMULATED Windows contrast themes): focus indicator and form boundaries remain', async ({ page }) => {
  await ensureJobs();
  await page.emulateMedia({ forcedColors: 'active' });
  await page.setViewportSize({ width: 1440, height: 900 });
  const shots = {};
  for (const [name, pathname] of [['home', '/'], ['apply-open', `/careers/${C5_SLUGS.open}/apply`]]) {
    await openRoute(page, pathname);
    shots[name] = await shot(page, `forced-colors-${name}-1440`, { fullPage: false });
  }
  await page.getByLabel('Full Name').focus();
  await page.keyboard.press('Tab');
  await waitForStill(page);
  const focused = await focusProbe(page);
  await page.getByRole('button', { name: 'Submit Application' }).click();
  await expect(page.getByText('Review the highlighted fields.')).toBeVisible();
  shots['apply-validation'] = await shot(page, 'forced-colors-apply-validation-1440');
  await page.emulateMedia({ forcedColors: null });
  record('C5-16', { observation: 'EMULATED (Chromium forced-colors emulation; a real Windows contrast theme is a manual check)', shots, focused });
  expect(focused.indicator).toBe(true);
});
