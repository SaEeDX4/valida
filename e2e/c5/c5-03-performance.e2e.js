import { expect, test } from '@playwright/test';
import { C5_LAB_ORIGIN, C5_SITE_ORIGIN, C5_SLUGS } from '../support/c5Stack.js';
import { ensureJobs, record, run } from './c5Support.js';
import { summariseRuns } from './perfStats.js';

/**
 * C5 — LAB performance of the integrated site (Doc 16 sections 153-282,
 * PERF-036/037; Doc 17 sections 276-290). Every number here is a LOCAL LAB
 * measurement in Playwright's Chromium on this machine: it is not field data
 * (CrUX / RUM at p75 needs production traffic, C6/C7), and the lab compression
 * proxy is not the production host (compression and caching at the host are
 * verified in C6).
 *
 * Method, per run: a NEW browser context (cold HTTP cache), Chrome DevTools
 * Protocol throttling applied to that page (Network.emulateNetworkConditions,
 * Emulation.setCPUThrottlingRate), navigation to the page, then the page is
 * left alone until no new LCP candidate or layout shift has appeared for 3 s.
 * LCP, CLS, FCP and long tasks come from the page's own PerformanceObserver
 * entries, installed before any page script runs; transfer sizes from the CDP
 * Network domain (encodedDataLength: bytes on the wire, headers included).
 * After the load metrics are read, scripted real input (Playwright mouse and
 * keyboard, i.e. trusted CDP input events) drives each page's interactions and
 * the Event Timing API records them; INP is reported as the slowest
 * interaction of the run (fewer than 50 interactions).
 */

const KIB = 1024;
/** Chrome DevTools "Slow 4G" (= Lighthouse's applied mobile throttling) and Lighthouse's desktop profile. */
const PROFILES = Object.freeze({
  mobile: {
    context: { viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true, locale: 'en-CA' },
    cpu: 4,
    network: { offline: false, latency: 562.5, downloadThroughput: (1474.56 * 1000) / 8, uploadThroughput: (675 * 1000) / 8 },
    label: 'Mobile: 412x823 CSS px, DPR 1.75, touch; CPU 4x slowdown; Slow 4G (562.5 ms latency, 1474.56 kbit/s down, 675 kbit/s up)',
  },
  desktop: {
    context: { viewport: { width: 1350, height: 940 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false, locale: 'en-CA' },
    cpu: 1,
    network: { offline: false, latency: 40, downloadThroughput: (10240 * 1000) / 8, uploadThroughput: (10240 * 1000) / 8 },
    label: 'Desktop: 1350x940 CSS px, DPR 1; no CPU slowdown; 40 ms latency, 10240 kbit/s',
  },
});
const PAGES = Object.freeze([
  ['home', '/'],
  ['about', '/about'],
  ['careers', '/careers'],
  ['job', `/careers/${C5_SLUGS.open}`],
  ['apply', `/careers/${C5_SLUGS.open}/apply`],
  ['job-missing', '/careers/qa-c5-no-such-role'],
]);
const RUNS = Number(process.env.C5_PERF_RUNS ?? 5);
const REFERENCE_RUNS = Number(process.env.C5_PERF_REFERENCE_RUNS ?? 3);

/** Installed before any page script: buffers the entries the measurements read. */
const OBSERVERS = () => {
  const describe = (el) => {
    if (!el || !el.tagName) return null;
    const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls} "${(el.textContent || el.getAttribute('alt') || '').trim().slice(0, 60)}"`;
  };
  const c5 = { lcp: [], shifts: [], events: [], longtasks: [], paints: [], lastChange: 0 };
  window.__c5perf = c5;
  const observe = (type, onEntry, extra = {}) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(onEntry)).observe({ type, buffered: true, ...extra });
    } catch {
      c5[`unsupported_${type}`] = true;
    }
  };
  observe('largest-contentful-paint', (e) => {
    c5.lastChange = performance.now();
    c5.lcp.push({ startTime: e.startTime, size: e.size, element: describe(e.element), url: e.url || null, renderTime: e.renderTime, loadTime: e.loadTime });
  });
  observe('layout-shift', (e) => {
    c5.lastChange = performance.now();
    c5.shifts.push({ startTime: e.startTime, value: e.value, hadRecentInput: e.hadRecentInput, sources: (e.sources || []).map((s) => describe(s.node)) });
  });
  observe('event', (e) => {
    c5.events.push({ name: e.name, interactionId: e.interactionId, duration: e.duration, startTime: e.startTime, inputDelay: e.processingStart - e.startTime, processing: e.processingEnd - e.processingStart, presentation: e.startTime + e.duration - e.processingEnd, target: describe(e.target) });
  }, { durationThreshold: 16 });
  observe('first-input', (e) => {
    c5.events.push({ name: e.name, interactionId: e.interactionId, duration: e.duration, startTime: e.startTime, firstInput: true });
  });
  observe('longtask', (e) => c5.longtasks.push({ startTime: e.startTime, duration: e.duration }));
  observe('paint', (e) => c5.paints.push({ name: e.name, startTime: e.startTime }));
};

/** CLS as Core Web Vitals defines it: the largest session window (gap < 1 s, window <= 5 s) of shifts without recent input. */
function cumulativeLayoutShift(shifts) {
  let best = 0;
  let current = 0;
  let windowStart = 0;
  let previous = -Infinity;
  for (const s of shifts.filter((x) => !x.hadRecentInput).sort((a, b) => a.startTime - b.startTime)) {
    if (s.startTime - previous > 1000 || s.startTime - windowStart > 5000) {
      current = 0;
      windowStart = s.startTime;
    }
    current += s.value;
    previous = s.startTime;
    best = Math.max(best, current);
  }
  return Math.round(best * 10000) / 10000;
}

const TYPE = (resourceType) => ({ Document: 'document', Script: 'js', Stylesheet: 'css', Font: 'font', Image: 'image', Fetch: 'api', XHR: 'api' }[resourceType] ?? 'other');

async function interact(page, name, profile) {
  const pause = () => page.waitForTimeout(600);
  const steps = [];
  const tap = async (locator, label) => {
    if (profile === 'mobile') await locator.tap();
    else await locator.click();
    steps.push(label);
    await pause();
  };
  if (name === 'home') {
    if (profile === 'mobile') {
      await tap(page.getByRole('button', { name: 'Menu' }), 'open the mobile navigation');
      await tap(page.getByRole('button', { name: 'Menu' }), 'close the mobile navigation');
    }
    await tap(page.getByRole('link', { name: 'Explore Careers' }).first(), 'Explore Careers (client-side navigation to Careers)');
  } else if (name === 'about') {
    if (profile === 'mobile') {
      await tap(page.getByRole('button', { name: 'Menu' }), 'open the mobile navigation');
      await tap(page.getByRole('button', { name: 'Menu' }), 'close the mobile navigation');
    } else {
      await tap(page.getByRole('link', { name: 'Careers' }).first(), 'Careers (client-side navigation)');
    }
  } else if (name === 'careers') {
    await tap(page.getByRole('link', { name: /^View Role: / }).first(), 'a role row (client-side navigation to Job Detail)');
  } else if (name === 'job') {
    await tap(page.getByRole('link', { name: 'Apply for This Role' }).first(), 'Apply for This Role (client-side navigation to Apply)');
  } else if (name === 'apply') {
    await tap(page.getByRole('button', { name: 'Submit Application' }), 'Submit the empty form (client validation, error summary)');
    await tap(page.getByLabel('Full Name'), 'focus Full Name');
    for (const key of ['Q', 'A']) {
      await page.keyboard.press(key);
      steps.push(`type "${key}"`);
      await pause();
    }
    await tap(page.getByRole('radio', { name: 'Yes' }).first(), 'choose a radio answer');
  }
  return steps;
}

async function measure(browser, { origin, profile, name, pathname, interactions = true, repeatView = false }) {
  const p = PROFILES[profile];
  const context = await browser.newContext(p.context);
  await context.addInitScript(OBSERVERS);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const requests = new Map();
  const transfers = [];
  await cdp.send('Network.enable');
  // Request timing for the LCP critical path (document, script, stylesheet, API), on the CDP monotonic clock.
  const started = new Map();
  cdp.on('Network.requestWillBeSent', (e) => started.set(e.requestId, e.timestamp));
  cdp.on('Network.responseReceived', (e) => requests.set(e.requestId, {
    url: e.response.url, type: TYPE(e.type), status: e.response.status, encoding: e.response.headers['content-encoding'] ?? e.response.headers['Content-Encoding'] ?? null, fromCache: e.response.fromDiskCache || e.response.fromServiceWorker || false,
  }));
  cdp.on('Network.loadingFinished', (e) => {
    const r = requests.get(e.requestId);
    if (r) transfers.push({ ...r, bytes: e.encodedDataLength, startedAt: started.get(e.requestId) ?? null, finishedAt: e.timestamp });
  });
  await cdp.send('Network.emulateNetworkConditions', p.network);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: p.cpu });
  try {
    if (repeatView) {
      await page.goto(`${origin}${pathname}`, { waitUntil: 'load' });
      await page.waitForTimeout(1500);
      transfers.length = 0;
      await page.goto(`${origin}${pathname}`, { waitUntil: 'load' });
    } else {
      await page.goto(`${origin}${pathname}`, { waitUntil: 'load' });
    }
    // Quiet: no new LCP candidate or layout shift for 3 s (bounded at 30 s).
    await page.waitForFunction(() => performance.now() - window.__c5perf.lastChange > 3000 && document.readyState === 'complete', null, { timeout: 30_000, polling: 250 });
    const load = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const c5 = window.__c5perf;
      return {
        ttfb: nav ? nav.responseStart : null,
        domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
        loadEvent: nav ? nav.loadEventEnd : null,
        fcp: c5.paints.find((x) => x.name === 'first-contentful-paint')?.startTime ?? null,
        lcpEntries: c5.lcp,
        shifts: c5.shifts,
        longtasks: c5.longtasks,
      };
    });
    const lcp = load.lcpEntries.at(-1) ?? null;
    const tbt = load.longtasks.filter((t) => load.fcp !== null && t.startTime >= load.fcp).reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0);
    const bytes = {};
    for (const t of transfers) bytes[t.type] = (bytes[t.type] ?? 0) + t.bytes;
    const result = {
      page: name, path: pathname, origin, profile, repeatView,
      ttfb: round(load.ttfb), fcp: round(load.fcp), lcp: round(lcp?.startTime), lcpElement: lcp?.element ?? null, lcpUrl: lcp?.url ?? null,
      cls: cumulativeLayoutShift(load.shifts), shiftCount: load.shifts.length, shiftSources: [...new Set(load.shifts.flatMap((s) => s.sources))].slice(0, 6),
      tbtAfterFcp: round(tbt), longTasks: load.longtasks.length,
      transferKiB: Object.fromEntries(Object.entries(bytes).map(([k, v]) => [k, round(v / KIB, 1)])),
      totalKiB: round(transfers.reduce((s, t) => s + t.bytes, 0) / KIB, 1),
      requests: transfers.length,
      // Milliseconds from the document request: when each critical request started and finished.
      criticalPath: (() => {
        const origin0 = transfers.find((t) => t.type === 'document')?.startedAt;
        if (!origin0) return null;
        return transfers.filter((t) => ['document', 'js', 'css', 'api'].includes(t.type)).map((t) => ({ type: t.type, path: new URL(t.url).pathname.replace(/-[A-Za-z0-9_-]{8}\./, '.'), start: round((t.startedAt - origin0) * 1000), end: round((t.finishedAt - origin0) * 1000), kib: round(t.bytes / KIB, 1) }));
      })(),
      encodings: [...new Set(transfers.filter((t) => ['document', 'js', 'css'].includes(t.type)).map((t) => `${t.type}:${t.encoding ?? 'identity'}`))],
    };
    if (interactions && !repeatView) {
      result.interactions = await interact(page, name, profile);
      const events = await page.evaluate(() => window.__c5perf.events);
      const byInteraction = new Map();
      for (const e of events.filter((x) => x.interactionId)) {
        const prev = byInteraction.get(e.interactionId);
        if (!prev || e.duration > prev.duration) byInteraction.set(e.interactionId, e);
      }
      const worst = [...byInteraction.values()].sort((a, b) => b.duration - a.duration);
      result.inp = worst.length ? worst[0].duration : null;
      result.inpEvent = worst[0] ? { name: worst[0].name, target: worst[0].target, inputDelay: round(worst[0].inputDelay), processing: round(worst[0].processing), presentation: round(worst[0].presentation) } : null;
      result.interactionCount = byInteraction.size;
    }
    return result;
  } finally {
    await context.close();
  }
}

const round = (v, d = 0) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d);
test('C5-17 Lab Core Web Vitals and transfer, mobile (Slow 4G, 4x CPU) and desktop, cold cache, against the lab compression proxy', async ({ browser }) => {
  test.setTimeout(3_600_000);
  await ensureJobs();
  const out = { method: 'LAB', origin: C5_LAB_ORIGIN, labCompression: process.env.C5_LAB_COMPRESSION ?? 'precompressed', experimentPreloadJobApi: process.env.C5_EXPERIMENT_PRELOAD_JOB_API === '1', jobApiPreload: run().documentServer?.jobApiPreload ?? null, profiles: Object.fromEntries(Object.entries(PROFILES).map(([k, v]) => [k, v.label])), browserVersion: browser.version(), runsPerPage: RUNS, pages: {} };
  for (const profile of ['mobile', 'desktop']) {
    for (const [name, pathname] of PAGES) {
      const runs = [];
      for (let i = 0; i < RUNS; i += 1) runs.push(await measure(browser, { origin: C5_LAB_ORIGIN, profile, name, pathname }));
      const repeat = await measure(browser, { origin: C5_LAB_ORIGIN, profile, name, pathname, interactions: false, repeatView: true });
      out.pages[`${name}/${profile}`] = { summary: summariseRuns(runs, { expected: RUNS }), repeatView: { totalKiB: repeat.totalKiB, transferKiB: repeat.transferKiB, lcp: repeat.lcp, requests: repeat.requests }, runs };
    }
  }
  record('C5-17', out);
  // Doc 16 targets (field p75 targets, used here as LAB gates only). Only PASS passes: FAIL and INSUFFICIENT
  // (a missing or short sample set) both fail; INP may be NOT_APPLICABLE on a page with no scripted interaction.
  for (const [key, r] of Object.entries(out.pages)) {
    expect.soft(r.summary.lcp.verdict.status, `${key} LCP: ${r.summary.lcp.verdict.reason}`).toBe('PASS');
    expect.soft(r.summary.cls.verdict.status, `${key} CLS: ${r.summary.cls.verdict.reason}`).toBe('PASS');
    expect.soft(['PASS', 'NOT_APPLICABLE'], `${key} INP: ${r.summary.inp.verdict.reason}`).toContain(r.summary.inp.verdict.status);
  }
  const home = out.pages['home/mobile'].summary;
  expect.soft(home.transferKiB.js ?? 0, 'Home JS (lab-compressed)').toBeLessThanOrEqual(220);
  expect.soft(home.transferKiB.css ?? 0, 'Home CSS (lab-compressed)').toBeLessThanOrEqual(70);
  expect.soft(home.transferKiB.font ?? 0, 'Home fonts').toBeLessThanOrEqual(200);
  expect.soft(home.totalKiB.median, 'Home first load').toBeLessThanOrEqual(1.2 * 1024);
});

test('C5-18 Reference: the same mobile runs against the uncompressed local document server (what the host must improve on)', async ({ browser }) => {
  test.setTimeout(3_600_000);
  await ensureJobs();
  const out = { method: 'LAB (uncompressed local document server — NOT representative of production)', origin: C5_SITE_ORIGIN, profile: PROFILES.mobile.label, runsPerPage: REFERENCE_RUNS, pages: {} };
  for (const [name, pathname] of PAGES) {
    const runs = [];
    for (let i = 0; i < REFERENCE_RUNS; i += 1) runs.push(await measure(browser, { origin: C5_SITE_ORIGIN, profile: 'mobile', name, pathname, interactions: false }));
    out.pages[name] = { summary: summariseRuns(runs, { expected: REFERENCE_RUNS }), runs };
  }
  record('C5-18', out);
});
