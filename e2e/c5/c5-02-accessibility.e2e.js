import path from 'node:path';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { BACKEND_DIR, FIXTURES_DIR, FRONTEND_DIR } from '../support/paths.js';
import { C5_SITE_ORIGIN, C5_SLUGS } from '../support/c5Stack.js';
import { judgeReducedMotion } from './motionJudge.js';
import {
  ROUTES, axe, ensureJobs, openRoute, publishedJobs, waitForStill, focusProbe, headingProblems, layoutProbe, motionObserve, motionProbe, MOTION_RECORDER, record, settle, shot, structureProbe, writeText,
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
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  results['mobile-menu-open'] = { 390: await axe(page) };
  // ---------------------------------------------------------------- WCAG 2.5.3 Label in Name (OD-2026-11-10-01)
  // axe's rule for it (label-content-name-mismatch) is "experimental" and outside the tags above, so it runs on its
  // own, on every route at both widths and with the menu open, and it GATES the case. Every raw finding is kept.
  //
  // ONE documented exception, and only for the exact reviewed nodes. A Careers role is one whole-row link
  // (JobRow.jsx: ul[data-testid="careers-job-list"] > li > a). Its visible text is the title, the role's facts and
  // "View Role"; axe's heuristic asks for ALL of that text in the accessible name, and reports the link. The owner
  // approved the name "View Role: {title}" (OD-2026-11-10-01). A finding is set aside ONLY when the reported node
  //   - is itself that link (not a descendant of it, not another control in the list), and
  //   - links to a Job the public API lists, and its name AS CHROMIUM COMPUTES IT is exactly "View Role: " + that
  //     Job's title from the API, and its one visible heading is that title, and its one visible call to action is
  //     "View Role", and it contains no focusable descendant.
  // Any other finding - a row whose name or label drifted, any other control inside the list, anything inside a row -
  // stays a gate failure. The negative controls below prove each of those.
  //
  // WHAT THIS IS NOT. Setting the finding aside records that the row carries the APPROVED COPY; it is not a WCAG
  // 2.5.3 conformance determination, and an automated rule passing or being set aside proves no conformance. The
  // manual reading (the name starts with the visible call to action and contains the visible title; the facts are
  // supplementary text of the same link) and the speech-input and screen-reader checks are in the C5 record and
  // remain OPEN until a person performs them.
  const cdp = await page.context().newCDPSession(page);
  const computedName = async (locator) => {
    await locator.evaluate((el) => el.setAttribute('data-c5-name-probe', ''));
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-c5-name-probe]' });
    const { node } = await cdp.send('DOM.describeNode', { nodeId });
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { backendNodeId: node.backendNodeId, fetchRelatives: false });
    await locator.evaluate((el) => el.removeAttribute('data-c5-name-probe'));
    return nodes[0]?.name?.value ?? null;
  };
  const listedJobs = (await publishedJobs()).jobs.map((j) => ({ slug: j.slug, title: j.title }));
  /** The rule's raw findings in the current page, each with the DOM facts the exception is judged on. */
  const rawLabelFindings = () => page.evaluate(async () => {
    const result = await window.axe.run(document, { runOnly: { type: 'rule', values: ['label-content-name-mismatch'] } });
    const text = (el) => el.innerText.replace(/\s+/g, ' ').trim();
    let index = 0;
    return result.violations.flatMap((v) => v.nodes.map((n) => {
      const el = n.target.length === 1 && typeof n.target[0] === 'string' ? document.querySelector(n.target[0]) : null;
      const isRowLink = Boolean(el) && el.matches('ul[data-testid="careers-job-list"] > li > a[href]');
      const probe = el ? String(index += 1) : null;
      if (el) el.setAttribute('data-c5-label-node', probe);
      return {
        rule: v.id,
        impact: n.impact,
        target: n.target.map(String).join(' '),
        html: n.html.slice(0, 400),
        failureSummary: n.failureSummary,
        checks: [...n.any, ...n.all, ...n.none].map((c) => ({ id: c.id, message: c.message, data: c.data ?? null })),
        probe,
        row: isRowLink ? {
          href: el.getAttribute('href'),
          headings: [...el.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(text),
          callsToAction: [...el.querySelectorAll(':scope > [aria-hidden="true"]')].map(text),
          focusableDescendants: el.querySelectorAll('a, button, input, select, textarea, summary, [tabindex], [role="button"], [role="link"]').length,
        } : null,
      };
    }));
  });
  /** Judges each raw finding: `approved` is true only for an exact reviewed JobRow link (see above). */
  const labelFindings = async () => {
    const found = await rawLabelFindings();
    for (const n of found) {
      const reasons = [];
      if (!n.row) reasons.push('the reported node is not a Careers JobRow link (ul[data-testid="careers-job-list"] > li > a)');
      else {
        const job = listedJobs.find((j) => n.row.href === `/careers/${j.slug}`);
        n.row.computedName = await computedName(page.locator(`[data-c5-label-node="${n.probe}"]`));
        if (!job) reasons.push(`its href ${n.row.href} is not a Job the public API lists`);
        else {
          n.row.apiTitle = job.title;
          if (n.row.computedName !== `View Role: ${job.title}`) reasons.push(`its computed name is ${JSON.stringify(n.row.computedName)}, not "View Role: " + the Job's title`);
          if (n.row.headings.length !== 1 || n.row.headings[0] !== job.title) reasons.push(`its visible heading is ${JSON.stringify(n.row.headings)}, not the Job's title`);
        }
        if (n.row.callsToAction.length !== 1 || n.row.callsToAction[0] !== 'View Role') reasons.push(`its visible call to action is ${JSON.stringify(n.row.callsToAction)}, not "View Role"`);
        if (n.row.focusableDescendants !== 0) reasons.push('it contains a focusable descendant');
      }
      n.approved = reasons.length === 0;
      n.notApprovedBecause = reasons;
    }
    await page.evaluate(() => document.querySelectorAll('[data-c5-label-node]').forEach((el) => el.removeAttribute('data-c5-label-node')));
    return found;
  };
  const gating = (found) => found.filter((n) => !n.approved);

  const labelInName = {};
  for (const [name, pathname] of ROUTES) {
    for (const width of [360, 1440]) {
      await page.setViewportSize({ width, height: width === 360 ? 800 : 900 });
      await openRoute(page, pathname);
      await page.addScriptTag({ path: AXE_PATH });
      labelInName[`${name}@${width}`] = await labelFindings();
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await openRoute(page, '/');
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.addScriptTag({ path: AXE_PATH });
  labelInName['mobile-menu-open@390'] = await labelFindings();

  // ------------------------------------------------------------------------------------------ negative controls
  // Each puts ONE regression into the live DOM, runs the same rule and the same judgement, and restores the DOM.
  // `gating` must then contain the injected node: the gate would fail. None is ever left in place.
  const controls = {};
  const control = async (id, description, inject, expectTarget) => {
    await page.evaluate(inject.fn, inject.arg);
    const found = await labelFindings();
    await page.evaluate(() => {
      document.querySelectorAll('[data-c5-injected]').forEach((el) => el.remove());
      document.querySelectorAll('[data-c5-restore-label]').forEach((el) => {
        const old = el.getAttribute('data-c5-restore-label');
        if (old === '__c5_none__') el.removeAttribute('aria-label');
        else el.setAttribute('aria-label', old);
        el.removeAttribute('data-c5-restore-label');
      });
    });
    const failing = gating(found);
    controls[id] = { description, injected: inject.arg ?? null, gateWouldFail: failing.length > 0, caught: failing.filter(expectTarget).map((n) => ({ target: n.target, html: n.html.slice(0, 200), isJobRowLink: Boolean(n.row), computedName: n.row?.computedName ?? null, notApprovedBecause: n.notApprovedBecause })), allGating: failing.map((n) => n.target), approvedCount: found.length - failing.length };
  };
  // (c) the Menu toggle's old name is put back (the round-2 control, now through the same judgement).
  await page.keyboard.press('Escape');
  await control('menu-name-regression', 'aria-label="Open navigation" on the Menu toggle (visible label "Menu")', {
    fn: () => { const t = document.querySelector('header button[aria-controls]'); t.setAttribute('data-c5-restore-label', t.getAttribute('aria-label') ?? '__c5_none__'); t.setAttribute('aria-label', 'Open navigation'); },
  }, (n) => /button/.test(n.html) && n.html.includes('Open navigation'));

  await page.setViewportSize({ width: 1440, height: 900 });
  await openRoute(page, '/careers');
  await page.addScriptTag({ path: AXE_PATH });
  const careersBaseline = await labelFindings();
  const relabelFirstRow = (label) => { const a = document.querySelector('ul[data-testid="careers-job-list"] > li > a'); a.setAttribute('data-c5-restore-label', a.getAttribute('aria-label') ?? '__c5_none__'); a.setAttribute('aria-label', label); };
  // (a) a regression in a JobRow's name: unrelated wording, the title dropped, another role's title, the name removed.
  await control('jobrow-name-unrelated', 'the first JobRow link named "Open role" (neither the call to action nor the title)', { fn: relabelFirstRow, arg: 'Open role' }, (n) => Boolean(n.row) && n.row.computedName === 'Open role');
  await control('jobrow-name-without-title', 'the first JobRow link named "View Role" only', { fn: relabelFirstRow, arg: 'View Role' }, (n) => Boolean(n.row) && n.row.computedName === 'View Role');
  const otherTitle = listedJobs.at(-1).title;
  await control('jobrow-name-other-role', "the first JobRow link named with ANOTHER role's title", { fn: relabelFirstRow, arg: `View Role: ${otherTitle} (QA wrong)` }, (n) => Boolean(n.row) && n.row.computedName === `View Role: ${otherTitle} (QA wrong)`);
  await control('jobrow-visible-cta-changed', 'the first JobRow\'s visible call to action changed to "View Role now" (name unchanged)', {
    fn: () => { const cta = document.querySelector('ul[data-testid="careers-job-list"] > li > a > [aria-hidden="true"]'); const marker = document.createElement('span'); marker.setAttribute('data-c5-injected', ''); marker.textContent = ' now'; cta.append(marker); },
  }, (n) => Boolean(n.row) && n.notApprovedBecause.some((r) => r.includes('call to action')));
  // (b) an unrelated mismatched control INSIDE the Careers list is not exempted: a button in a list item, a link that
  // is not a role, and a control inside a row link (which also withdraws that row's own exception).
  await control('unrelated-button-in-list', 'a button "Save role" named "Dismiss" inside a Careers list item', {
    fn: () => { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-c5-injected', ''); b.setAttribute('aria-label', 'Dismiss'); b.textContent = 'Save role'; document.querySelector('ul[data-testid="careers-job-list"] > li').append(b); },
  }, (n) => !n.row && n.html.includes('Dismiss'));
  await control('non-role-link-in-list', 'a list item > link to /about named "Elsewhere" with the visible text "About Valida" appended to the Careers list', {
    fn: () => { const li = document.createElement('li'); li.setAttribute('data-c5-injected', ''); const a = document.createElement('a'); a.href = '/about'; a.setAttribute('aria-label', 'Elsewhere'); a.textContent = 'About Valida'; li.append(a); document.querySelector('ul[data-testid="careers-job-list"]').append(li); },
  }, (n) => Boolean(n.row) && n.row.href === '/about');
  await control('control-inside-row', 'a focusable role="button" "Details" named "Close" inside the first JobRow link', {
    fn: () => { const s = document.createElement('span'); s.setAttribute('data-c5-injected', ''); s.setAttribute('role', 'button'); s.tabIndex = 0; s.setAttribute('aria-label', 'Close'); s.textContent = 'Details'; document.querySelector('ul[data-testid="careers-job-list"] > li > a > div').append(s); },
  }, (n) => (!n.row && n.html.includes('Close')) || (Boolean(n.row) && n.notApprovedBecause.includes('it contains a focusable descendant')));
  // The DOM is as it was: the same findings, all approved, as before the controls.
  const careersAfterControls = await labelFindings();

  // The approved names themselves, as Chromium computes them (CDP Accessibility).
  const names = {};
  await page.setViewportSize({ width: 390, height: 844 });
  await openRoute(page, '/');
  const toggle = page.locator('header button[aria-controls]');
  names.menuClosed = { name: await computedName(toggle), expanded: await toggle.getAttribute('aria-expanded'), visible: (await toggle.innerText()).trim() };
  await toggle.click();
  names.menuOpen = { name: await computedName(toggle), expanded: await toggle.getAttribute('aria-expanded'), visible: (await toggle.innerText()).trim() };
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRoute(page, '/careers');
  const rows = page.locator('[data-testid="careers-job-list"] a');
  names.careersRows = [];
  for (let i = 0; i < (await rows.count()); i += 1) {
    const row = rows.nth(i);
    names.careersRows.push({ name: await computedName(row), title: (await row.locator('h3').innerText()).trim(), cta: (await row.locator('[aria-hidden="true"]').first().innerText()).trim() });
  }
  await openRoute(page, `/careers/${C5_SLUGS.open}/apply`);
  const back = page.locator('main a[href^="/careers/"]').first();
  names.applyBack = { name: await computedName(back), visible: (await back.innerText()).trim() };
  const summariseFindings = (found) => ({ reported: found.length, approvedJobRowLinks: found.filter((n) => n.approved).length, gating: gating(found).length });
  record('C5-06', {
    observation: 'REAL (axe-core in Chromium; names from the Chromium accessibility tree)',
    axeVersion: results.home[360].version,
    tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
    results,
    labelInName: {
      rule: 'label-content-name-mismatch (axe experimental; WCAG 2.5.3, Level A)',
      decision: 'OD-2026-11-10-01',
      gating: 'every finding gates EXCEPT a finding on an exact reviewed Careers JobRow link: the reported node is ul[data-testid="careers-job-list"] > li > a, it links to a Job the public API lists, Chromium computes its name as "View Role: " + that Job\'s API title, its one visible heading is that title, its one visible call to action is "View Role", and it has no focusable descendant',
      interpretation: 'Setting those findings aside records that the row carries the copy the owner approved (OD-2026-11-10-01). It is NOT a WCAG 2.5.3 conformance determination and proves no conformance: the rule is a heuristic, the manual reading is in docs/qa/C5_INTEGRATED_SITE_QUALITY.md, and speech-input and screen-reader verification remain OPEN.',
      listedJobs,
      summary: Object.fromEntries(Object.entries(labelInName).map(([k, v]) => [k, summariseFindings(v)])),
      rawFindings: labelInName,
      negativeControls: { baselineOnCareers: summariseFindings(careersBaseline), afterControlsOnCareers: summariseFindings(careersAfterControls), controls },
    },
    names,
  });
  expect.soft(Object.entries(labelInName).map(([k, v]) => [k, gating(v)]).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.map((x) => `${x.target} (${x.notApprovedBecause.join('; ')})`).join(', ')}`), 'WCAG 2.5.3 label in name (axe): findings that are not exact reviewed JobRow links').toEqual([]);
  // The exception is used only where the reviewed rows are: on Careers, at most once per listed Job.
  for (const [key, found] of Object.entries(labelInName)) {
    const approved = found.filter((n) => n.approved);
    if (!key.startsWith('careers@')) expect.soft(approved.map((n) => n.target), `${key}: no exception outside Careers`).toEqual([]);
    else expect.soft(new Set(approved.map((n) => n.row.href)).size === approved.length && approved.length <= listedJobs.length, `${key}: at most one exception per listed Job`).toBe(true);
  }
  for (const [id, c] of Object.entries(controls)) {
    expect.soft(c.gateWouldFail, `negative control ${id}: the gate fails`).toBe(true);
    expect.soft(c.caught.length, `negative control ${id}: the injected node is among the gate failures`).toBeGreaterThan(0);
  }
  expect.soft(Object.keys(controls).sort()).toEqual(['control-inside-row', 'jobrow-name-other-role', 'jobrow-name-unrelated', 'jobrow-name-without-title', 'jobrow-visible-cta-changed', 'menu-name-regression', 'non-role-link-in-list', 'unrelated-button-in-list']);
  expect.soft(summariseFindings(careersAfterControls), 'the controls left nothing behind').toEqual(summariseFindings(careersBaseline));
  expect.soft(gating(careersBaseline), 'Careers before the controls').toEqual([]);
  expect.soft(names.menuClosed).toEqual({ name: 'Menu', expanded: 'false', visible: 'Menu' });
  expect.soft(names.menuOpen).toEqual({ name: 'Menu', expanded: 'true', visible: 'Menu' });
  expect.soft(names.careersRows.length, 'multiple jobs listed').toBeGreaterThanOrEqual(2);
  for (const row of names.careersRows) {
    // The approved name, which contains both visible parts of the row's label: the call to action and the title.
    expect.soft(row.name).toBe(`View Role: ${row.title}`);
    expect.soft(row.cta).toBe('View Role');
    expect.soft(row.name.startsWith(row.cta), 'name starts with the visible call to action').toBe(true);
    expect.soft(row.name.includes(row.title), 'name contains the visible title').toBe(true);
  }
  expect.soft(new Set(names.careersRows.map((r) => r.name)).size, 'unique row names').toBe(names.careersRows.length);
  expect.soft(names.applyBack.visible).toBe('Back to Role');
  expect.soft(names.applyBack.name).toBe(`Back to Role: ${OPEN_TITLE}`);
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
  const trigger = page.getByRole('button', { name: 'Menu', exact: true });
  let stops = 0;
  while (!(await trigger.evaluate((el) => el === document.activeElement)) && stops < 10) {
    await page.keyboard.press('Tab');
    stops += 1;
  }
  const beforeOpen = { tabsToTrigger: stops, expanded: await trigger.getAttribute('aria-expanded') };
  await page.keyboard.press('Enter');
  const close = page.getByRole('button', { name: 'Menu', exact: true });
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
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveAttribute('aria-expanded', 'false');
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
  const afterNavigate = { url: new URL(page.url()).pathname, focus: await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName.toLowerCase()), menuExpanded: await page.getByRole('button', { name: 'Menu', exact: true }).getAttribute('aria-expanded', { timeout: 10_000 }) };
  record('C5-09', { observation: 'REAL (Chromium keyboard events)', beforeOpen, panelVisible, openShot, inPanel, afterEscape, target, afterNavigate });
  expect(beforeOpen.expanded).toBe('false');
  expect(panelVisible).toBe(true);
  expect(inPanel.every((s) => s.indicator && s.inViewport)).toBe(true);
  expect(afterEscape.name).toBe('Menu');
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
  await tabTo((p) => p.tag === 'a' && `View Role: ${OPEN_TITLE}`.startsWith(p.name) && p.name.startsWith('View Role: QA C5 Synthetic Principal'), 'Careers: the role row');
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

/**
 * Chromium's screenshot path does not render the CDP font-size setting (the captured image shows default-size
 * text). The visual is therefore captured with the equivalent root size set in CSS (html { font-size: 32px },
 * the site sizes text in rem), and the case records that the computed sizes and the layout are the same both ways.
 */
async function text200Shot(page, name) {
  const read = () => page.evaluate(() => ({ root: getComputedStyle(document.documentElement).fontSize, body: getComputedStyle(document.body).fontSize, h1: getComputedStyle(document.querySelector('h1')).fontSize }));
  const viaSetting = await read();
  const tag = await page.addStyleTag({ content: 'html { font-size: 32px !important; }' });
  await settle(page);
  const viaCss = await read();
  const layoutViaCss = await layoutProbe(page);
  const screenshot = await shot(page, name);
  await tag.evaluate((node) => node.remove());
  return { screenshot, capture: 'html { font-size: 32px } (equivalent root size; see text200Shot)', sizesEqual: JSON.stringify(viaSetting) === JSON.stringify(viaCss), sizesViaCss: viaCss, layoutViaCss };
}

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
      results.fontSetting[`${name}@${width}`] = { sizes, layout: await layoutProbe(page), ...(await text200Shot(page, `text200-${name}-${width}`)) };
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await openRoute(page, `/careers/${C5_SLUGS.open}/apply`);
  await page.getByRole('button', { name: 'Submit Application' }).click();
  await expect(page.getByText('Review the highlighted fields.')).toBeVisible();
  results.fontSetting['apply-validation@390'] = { layout: await layoutProbe(page), ...(await text200Shot(page, 'text200-apply-validation-390')) };
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
    const menu = zpage.getByRole('button', { name: 'Menu', exact: true });
    results.zoom.menuButtonVisible = await menu.isVisible();
    if (results.zoom.menuButtonVisible) {
      await menu.click();
      results.zoom.menuExpanded = await zpage.getByRole('button', { name: 'Menu', exact: true }).getAttribute('aria-expanded');
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
    ...Object.entries(results.fontSetting).filter(([, r]) => r.layoutViaCss.horizontalScroll || r.layoutViaCss.outsideCount || r.layoutViaCss.clippedCount).map(([n]) => `text200 (css) ${n}`),
    ...Object.entries(results.fontSetting).filter(([n, r]) => n !== 'apply-validation@390' && !r.sizesEqual).map(([n]) => `text200 sizes differ ${n}`),
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

test('C5-14 Reduced motion (EMULATED prefers-reduced-motion: reduce): no perceptible or persistent motion, instant scrolling, content available', async ({ page }, testInfo) => {
  // Doc 16 sections 58-59, Doc 17 section 255, Doc 18 section 170. What is judged, and why, is in motionJudge.js.
  // OLD criterion (rounds 1-3): at one instant after the page settled, document.getAnimations().length === 0,
  //   html scroll-behavior "auto", and no element DECLARING AN ANIMATION longer than 10 ms (declared transitions
  //   were recorded but not asserted).
  // NEW criterion: every effect seen on any frame since the document started, and through a bounded frame-by-frame
  //   watch, must be the reduced-motion rule's own instantaneous completion (a CSS transition/animation of exactly
  //   the rule's declared duration, no delay, one iteration, not filling) AND must be gone when the watch ends with
  //   the page quiet; no element may declare an animation OR a transition beyond the rule; scrolling is instant;
  //   the heading, footer and its links are visible afterwards. The old instant reading is still recorded.
  await ensureJobs();
  await page.addInitScript(MOTION_RECORDER);
  const results = {};
  const frameNow = () => page.evaluate(() => window.__c5motion.frame);
  const look = async (options) => {
    const legacy = await motionProbe(page);
    const observation = await motionObserve(page, options);
    return { legacyInstant: { running: legacy.running, runningDetail: legacy.runningDetail, declaredOver10ms: legacy.moving }, observation, verdict: judgeReducedMotion(observation) };
  };
  const jobApi = (url) => new URL(url).pathname === `/api/v1/jobs/${C5_SLUGS.open}`;
  for (const mode of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion: mode });
    results[mode] = {};
    for (const [name, pathname] of [['home', '/'], ['careers', '/careers'], ['job-open', `/careers/${C5_SLUGS.open}`], ['apply-open', `/careers/${C5_SLUGS.open}/apply`]]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openRoute(page, pathname);
      results[mode][name] = await look();
    }
    // Job Detail read the moment its content is there, without waiting for the page to settle first: everything
    // since the document started is in the recorder (with the preload hint the Job arrives as the script runs).
    await page.goto(`/careers/${C5_SLUGS.open}`, { waitUntil: 'commit' });
    await expect(page.getByRole('link', { name: 'Apply for This Role' }).first()).toBeVisible();
    results[mode]['job-open-at-content'] = await look();
    // The Careers loading skeleton, held (HOLD), then its content.
    {
      let release;
      const released = new Promise((resolve) => { release = resolve; });
      const matcher = (url) => new URL(url).pathname === '/api/v1/jobs';
      await page.route(matcher, async (route) => { await released; await route.continue(); });
      await page.goto('/careers', { waitUntil: 'load' });
      await expect(page.getByText('Loading open roles…')).toHaveCount(1);
      results[mode]['careers-loading'] = await look();
      const mark = await frameNow();
      release();
      await expect(page.getByRole('link', { name: /^View Role: / }).first()).toBeVisible();
      results[mode]['careers-content-after-loading'] = await look({ sinceFrame: mark });
      await page.unroute(matcher, { behavior: 'wait' });
    }
    // Job Detail, loading held (HOLD), then its content: the footer is unpainted while the Job is pending (F4) and
    // returns when it arrives - the loading-to-content change the r3 failures coincided with, made deterministic.
    {
      let release;
      const released = new Promise((resolve) => { release = resolve; });
      await page.route(jobApi, async (route) => { await released; await route.continue(); });
      await page.goto(`/careers/${C5_SLUGS.open}`, { waitUntil: 'load' });
      await expect(page.getByText('Loading role details…')).toHaveCount(1);
      results[mode]['job-loading'] = await look();
      const mark = await frameNow();
      release();
      await expect(page.getByRole('link', { name: 'Apply for This Role' }).first()).toBeVisible();
      results[mode]['job-content-after-loading'] = await look({ sinceFrame: mark });
      await page.unroute(jobApi, { behavior: 'wait' });
    }
  }

  // --------------------------------------------------------------------------------------------- controls
  // On Job Detail under reduced motion. Each control puts ONE effect into the live page and is observed and judged
  // exactly as the page is. Nothing is cancelled before it is judged; the injected node is removed afterwards.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRoute(page, `/careers/${C5_SLUGS.open}`);
  await page.addStyleTag({ content: '@keyframes c5blink { from { opacity: 1; } to { opacity: 0.4; } }' });
  const controls = {};
  const control = async (id, description, inject, { mustFail, reason }) => {
    const mark = (await frameNow()) + 1;
    await page.evaluate((controlId) => {
      const el = document.createElement('div');
      el.id = `c5-injected-${controlId}`;
      el.textContent = 'QA C5 control';
      document.querySelector('main').append(el);
    }, id);
    await page.locator(`#c5-injected-${id}`).evaluate(inject);
    const observation = await motionObserve(page, { sinceFrame: mark });
    const verdict = judgeReducedMotion(observation);
    const mine = (text) => text.includes(`div#c5-injected-${id}`);
    controls[id] = {
      description, expected: mustFail ? 'FAIL' : 'PASS', verdict: verdict.pass ? 'PASS' : 'FAIL',
      failuresNamingTheInjectedEffect: verdict.failures.filter((f) => mine(f) && !f.startsWith('declared motion')),
      declaredFindingsNamingIt: verdict.failures.filter((f) => mine(f) && f.startsWith('declared motion')),
      otherFailures: verdict.failures.filter((f) => !mine(f)),
      permittedNamingIt: verdict.permitted.filter((e) => mine(e.where)),
      effects: observation.effects.filter((e) => mine(e.where)), finalStillPresent: observation.final.filter((e) => mine(e.where)).length,
      framesObserved: observation.framesObserved, quiet: observation.quiet, reasonExpected: reason ? String(reason) : null,
    };
    await page.evaluate((controlId) => document.getElementById(`c5-injected-${controlId}`)?.remove(), id);
  };
  // Sustained motion.
  await control('sustained-transform', 'a script animation moving an element (transform) for 2 s, repeating without end',
    (el) => { el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(40px)' }], { duration: 2000, iterations: Infinity }); },
    { mustFail: true, reason: /not a CSS transition or animation/ });
  await control('sustained-opacity', 'a CSS transition of opacity over 3 s (declared !important, so it overrides the reduced-motion rule)',
    (el) => { el.style.setProperty('transition', 'opacity 3s linear', 'important'); getComputedStyle(el).opacity; el.style.opacity = '0.2'; },
    { mustFail: true, reason: /duration is 3000 ms/ });
  // A short effect, repeated.
  await control('short-repeated-indefinitely', 'a 0.01 ms CSS animation repeated without end',
    (el) => { el.style.setProperty('animation', 'c5blink 0.01ms linear infinite', 'important'); },
    { mustFail: true, reason: /Infinity iterations/ });
  await control('short-repeated-meaningful-total', 'a 5 ms CSS animation repeated 400 times (2 s in all)',
    (el) => { el.style.setProperty('animation', 'c5blink 5ms linear 400', 'important'); },
    { mustFail: true, reason: /400 iterations/ });
  // Delayed, and persistent.
  await control('delayed', 'a 0.01 ms CSS transition that starts after a 2 s delay',
    (el) => { el.style.setProperty('transition', 'opacity 0.01ms linear 2s', 'important'); getComputedStyle(el).opacity; el.style.opacity = '0.2'; },
    { mustFail: true, reason: /delay of 2000 ms/ });
  await control('persistent', 'a 0.01 ms CSS animation that keeps its end state applied (fill forwards) and so never goes away',
    (el) => { el.style.setProperty('animation', 'c5blink 0.01ms linear 1 forwards', 'important'); },
    { mustFail: true, reason: /keeps filling|still present/ });
  // The intended behaviour: an ordinary style change under the site's rule is a 0.01 ms transition that completes.
  await control('intended-instant-transition', 'an ordinary element whose opacity changes: the reduced-motion rule makes it a 0.01 ms transition',
    (el) => { getComputedStyle(el).opacity; el.style.opacity = '0.5'; },
    { mustFail: false });
  // The site's own controls: hovering and focusing the primary action (it declares colour and transform transitions).
  const hoverMark = (await frameNow()) + 1;
  const apply = page.getByRole('link', { name: 'Apply for This Role' }).first();
  await apply.hover();
  await apply.focus();
  const hover = await motionObserve(page, { sinceFrame: hoverMark });
  const hoverVerdict = judgeReducedMotion(hover);
  controls['site-hover-and-focus'] = { description: 'hover and focus on "Apply for This Role"', expected: 'PASS', verdict: hoverVerdict.pass ? 'PASS' : 'FAIL', failures: hoverVerdict.failures, permitted: hoverVerdict.permitted, effects: hover.effects, actionStillVisible: await apply.isVisible(), actionEnabled: await apply.isEnabled() };
  await page.mouse.move(0, 0);
  // After the controls the page is as it was.
  const afterControls = await look({ sinceFrame: (await frameNow()) + 1 });

  // The one effect the site produces: when the Job arrives, the footer's visibility change is inherited one DOM level
  // per frame, each level a 0.01 ms transition. It is recorded as a cascade and bounded by its own mechanism: it may
  // not take more frames than the nesting levels it passes through (no repetition, nothing drawn out).
  const cascade = (r) => {
    const seen = r.observation.effects;
    if (!seen.length) return null;
    const first = Math.min(...seen.map((e) => e.firstFrame)); const last = Math.max(...seen.map((e) => e.lastFrame));
    const depths = seen.map((e) => e.depth);
    return { effects: seen.length, outsideTheFooter: seen.filter((e) => !e.where.startsWith('footer')).map((e) => e.where), properties: [...new Set(seen.map((e) => `${e.kind} ${e.name}`))], firstFrame: first, lastFrame: last, frames: last - first + 1, nestingLevels: Math.max(...depths) - Math.min(...depths) + 1, repeated: seen.filter((e) => e.runs > 1).map((e) => ({ where: e.where, startedInFrames: e.runFrames })) };
  };
  for (const name of ['job-open-at-content', 'job-content-after-loading']) {
    const c = cascade(results.reduce[name]);
    results.reduce[name].cascade = c;
    // Held, the footer's return always happens after a painted pending state. On a direct load with the preload hint
    // the Job can be there before the first frame, and then the footer is never hidden at all: no cascade to see.
    if (name === 'job-content-after-loading') expect.soft(c, `${name}: the footer's return was observed`).not.toBeNull();
    if (!c) continue;
    expect.soft(c.outsideTheFooter, `${name}: only the footer`).toEqual([]);
    expect.soft(c.properties, `${name}: only visibility transitions`).toEqual(['CSSTransition visibility']);
    expect.soft(c.frames, `${name}: no more frames than nesting levels`).toBeLessThanOrEqual(c.nestingLevels);
  }
  await page.emulateMedia({ reducedMotion: null });
  record(testInfo.repeatEachIndex ? `C5-14-repeat-${testInfo.repeatEachIndex}` : 'C5-14', {
    observation: 'EMULATED (Chromium media emulation); effects recorded on every animation frame from the start of each document',
    criterion: {
      old: 'at one instant after settling: document.getAnimations().length === 0; html scroll-behavior "auto"; no element declaring an ANIMATION longer than 10 ms (declared transitions recorded, not asserted)',
      new: 'every effect seen on any frame, and through a bounded frame-by-frame watch (at most 90 frames, ending after 3 consecutive frames with no effect), must be the reduced-motion rule\'s own instantaneous completion - a CSS transition or animation of exactly the duration that rule declares, no delay, no end delay, one iteration, not filling - and must be gone when the watch ends with the page quiet; no element may declare an animation OR a transition beyond the rule; scroll-behavior is "auto"; the heading, the footer and its links are visible afterwards',
      notAStandard: 'The permitted duration is the value the site\'s own rule declares (base.css), read from the page. No numeric threshold is chosen here and none is an accessibility standard. The 90-frame bound limits the observation; it is not a tolerance for motion.',
    },
    results, controls, afterControls,
  });

  // The observation itself must be real under both settings.
  for (const [mode, byPage] of Object.entries(results)) for (const [name, r] of Object.entries(byPage)) expect.soft(r.observation, `${mode} ${name}: observed`).not.toBeNull();
  // Positive control on the site itself: with no preference, Home's decorative motion is seen and would fail.
  expect.soft(results['no-preference'].home.verdict.pass, 'no-preference Home: the decorative motion is detected').toBe(false);
  expect.soft(results['no-preference'].home.observation.reducedMotionApplies).toBe(false);
  // The gate.
  for (const [name, r] of Object.entries(results.reduce)) {
    expect.soft(r.observation.reducedMotionApplies, name).toBe(true);
    expect.soft(r.verdict.failures, `reduce ${name}`).toEqual([]);
    // The former assertions, kept: instant scrolling, and nothing declared (now transitions as well as animations).
    expect.soft(r.observation.scrollBehavior, name).toBe('auto');
    expect.soft(r.observation.declaredBeyondRule, name).toEqual([]);
    expect.soft(r.legacyInstant.declaredOver10ms, `${name}: nothing declared over 10 ms, animation or transition`).toEqual([]);
  }
  // The loading states are what they claim to be.
  expect.soft(results.reduce['job-loading'].observation.pending, 'Job Detail held: pending').toBe(true);
  expect.soft(results.reduce['job-loading'].observation.availability.footer, 'the footer is unpainted while the Job is pending (F4)').toBe(false);
  expect.soft(results.reduce['job-content-after-loading'].observation.pending).toBe(false);
  expect.soft(results.reduce['job-content-after-loading'].observation.availability, 'after loading: heading, footer and links visible').toMatchObject({ h1: true, footer: true });
  expect.soft(results.reduce['job-content-after-loading'].observation.availability.footerLinksShown).toBe(results.reduce['job-content-after-loading'].observation.availability.footerLinks);
  // The controls.
  for (const [id, c] of Object.entries(controls)) {
    expect.soft(c.verdict, `control ${id}`).toBe(c.expected);
    if (c.expected === 'FAIL') {
      expect.soft(c.failuresNamingTheInjectedEffect.length, `control ${id}: the injected effect itself is named, from observation`).toBeGreaterThan(0);
      expect.soft(c.failuresNamingTheInjectedEffect.join(' | '), `control ${id}: for the expected reason`).toMatch(new RegExp(c.reasonExpected.slice(1, -1)));
    }
  }
  expect.soft(controls['intended-instant-transition'].permittedNamingIt.length, 'the intended 0.01 ms transition was seen, permitted and finished').toBeGreaterThan(0);
  expect.soft(controls['intended-instant-transition'].finalStillPresent).toBe(0);
  expect.soft(controls['site-hover-and-focus']).toMatchObject({ actionStillVisible: true, actionEnabled: true });
  expect.soft(Object.keys(controls).sort()).toEqual(['delayed', 'intended-instant-transition', 'persistent', 'short-repeated-indefinitely', 'short-repeated-meaningful-total', 'site-hover-and-focus', 'sustained-opacity', 'sustained-transform']);
  expect.soft(afterControls.verdict.failures, 'after the controls the page passes again').toEqual([]);
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
