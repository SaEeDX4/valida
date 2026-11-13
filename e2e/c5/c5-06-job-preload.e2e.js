import { expect, test } from '@playwright/test';
import { C5_BACKEND_ORIGIN, C5_LAB_ORIGIN, C5_SITE_ORIGIN, C5_SLUGS } from '../support/c5Stack.js';
import { MISSING_JOB_SLUG, ROUTES, ensureJobs, record, run } from './c5Support.js';

/**
 * C5-22 — the Job API preload hint in a real browser (frontend/server/renderDocument.js jobApiPreloadTag).
 *
 * The document server writes, on Job Detail and Apply documents whose Job read the API has just answered (the Job,
 * or "not found"),
 *   <link rel="preload" as="fetch" crossorigin="anonymous" href="{API}/api/v1/jobs/{slug}">
 * so the browser requests the Job while the script is still downloading (C5 LCP). This case observes, in
 * Playwright's Chromium against the real backend:
 *   - which documents carry a hint, and that it is that Job's public GET and nothing else;
 *   - REUSE: one network request for the Job per document load (the preload), which the page's own fetch() is
 *     handed - not a second request; the request is a CORS GET without credentials;
 *   - that nothing stale is reused afterwards (client-side navigation makes its own request);
 *   - that the page is correct when the hint is absent or ignored, and when the hinted request fails.
 * Chromium only; other engines are part of the open manual checks. A browser that does not support or does not
 * match the hint makes the page's ordinary request, which the "hint ignored" part exercises.
 */

const JOB_API = (slug) => `${C5_BACKEND_ORIGIN}/api/v1/jobs/${slug}`;
const TAG = (slug) => `<link rel="preload" as="fetch" crossorigin="anonymous" href="${JOB_API(slug)}">`;
const PRELOADS = /<link rel="preload"[^>]*>/g;

/** A fresh context (cold cache) whose API requests are recorded from the network layer (CDP) and from Playwright. */
async function observe(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-CA' });
  // A cookie for the API's host: it must never be sent (apiClient.js credentials "same-origin"; the hint is anonymous).
  await context.addCookies([{ name: 'qa_c5_canary', value: 'must-not-be-sent', url: C5_BACKEND_ORIGIN }]);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const network = [];
  const byId = new Map();
  // The wire headers arrive in their own event, before or after requestWillBeSent.
  const wireHeaders = new Map();
  cdp.on('Network.requestWillBeSent', (e) => {
    if (!e.request.url.startsWith(`${C5_BACKEND_ORIGIN}/`)) return;
    const entry = { url: e.request.url, method: e.request.method, initiator: e.initiator?.type ?? null, resourceType: e.type ?? null, status: null, headers: wireHeaders.get(e.requestId) ?? null };
    byId.set(e.requestId, entry);
    network.push(entry);
  });
  cdp.on('Network.requestWillBeSentExtraInfo', (e) => {
    const headers = Object.fromEntries(Object.entries(e.headers).map(([k, v]) => [k.toLowerCase(), v]));
    wireHeaders.set(e.requestId, headers);
    const entry = byId.get(e.requestId);
    if (entry) entry.headers = headers;
  });
  cdp.on('Network.responseReceived', (e) => {
    const entry = byId.get(e.requestId);
    if (entry) entry.status = e.response.status;
  });
  const consoleMessages = [];
  page.on('console', (m) => consoleMessages.push({ type: m.type(), text: m.text().slice(0, 300) }));
  const jobRequests = (slug) => network.filter((r) => r.url === JOB_API(slug));
  return { context, page, network, consoleMessages, jobRequests, origin };
}
const safeHeaders = (h) => (h ? { origin: h.origin ?? null, 'sec-fetch-mode': h['sec-fetch-mode'] ?? null, 'sec-fetch-dest': h['sec-fetch-dest'] ?? null, cookie: h.cookie ? 'PRESENT' : null, authorization: h.authorization ? 'PRESENT' : null } : null);
const summarise = (requests) => requests.map((r) => ({ url: r.url, method: r.method, initiator: r.initiator, resourceType: r.resourceType, status: r.status, headers: safeHeaders(r.headers) }));
const resourceEntries = (page, url) => page.evaluate((u) => performance.getEntriesByType('resource').filter((e) => e.name === u).map((e) => ({ initiatorType: e.initiatorType, startTime: Math.round(e.startTime), responseEnd: Math.round(e.responseEnd), transferSize: e.transferSize })), url);

test('C5-22 Job API preload hint: where it is written, request reuse, no credentials, and correctness without it', async ({ browser, request }) => {
  await ensureJobs();
  const enabled = run().documentServer?.jobApiPreload ?? null;
  test.skip(enabled === null, 'The document server runs with --no-job-preload (comparison run): nothing to observe.');
  const out = { observation: 'REAL (Playwright Chromium, real backend, cold context per load)', browserVersion: browser.version(), jobApiPreload: enabled, documents: {}, reuse: {}, afterwards: {}, hintIgnored: {}, failure: {} };

  // 1. Which documents carry a hint (both origins: the document server and the lab proxy in front of it).
  for (const origin of [C5_SITE_ORIGIN, C5_LAB_ORIGIN]) {
    for (const [name, pathname] of ROUTES) {
      const response = await request.get(`${origin}${pathname}`);
      const html = await response.text();
      out.documents[`${name} @ ${origin}`] = { status: response.status(), preloads: html.match(PRELOADS) ?? [], inHead: (html.slice(0, html.indexOf('</head>')).match(PRELOADS) ?? []).length };
    }
  }
  const expected = { 'job-open': C5_SLUGS.open, 'job-hybrid': C5_SLUGS.hybrid, 'job-closed': C5_SLUGS.closed, 'job-missing': MISSING_JOB_SLUG, 'apply-open': C5_SLUGS.open, 'apply-closed': C5_SLUGS.closed };
  for (const [key, doc] of Object.entries(out.documents)) {
    const slug = expected[key.split(' @ ')[0]];
    expect.soft(doc.preloads, key).toEqual(slug ? [TAG(slug)] : []);
    if (slug) expect.soft(doc.inHead, key).toBe(1);
  }

  // 2. Reuse. One network request for the Job per document load; the page renders the Job from it.
  for (const [name, pathname, slug] of [
    ['job-open', `/careers/${C5_SLUGS.open}`, C5_SLUGS.open, null],
    ['apply-open', `/careers/${C5_SLUGS.open}/apply`, C5_SLUGS.open],
    ['job-closed', `/careers/${C5_SLUGS.closed}`, C5_SLUGS.closed],
  ]) {
    for (const origin of [C5_LAB_ORIGIN, C5_SITE_ORIGIN]) {
      const o = await observe(browser, origin);
      try {
        const response = await o.page.goto(`${origin}${pathname}`, { waitUntil: 'load' });
        await expect(o.page.locator('h1').first()).toBeVisible();
        await expect(o.page.getByText(/^Loading (open roles|role details)…$/)).toHaveCount(0);
        const h1 = (await o.page.locator('h1').first().innerText()).trim();
        // Chromium warns about a preload that nothing used a few seconds after load; wait past that.
        await o.page.waitForTimeout(6000);
        const requests = o.jobRequests(slug);
        const entry = { documentStatus: response.status(), h1, jobApiRequestsOnTheNetwork: requests.length, requests: summarise(requests), resourceTiming: await resourceEntries(o.page, JOB_API(slug)), otherApiRequests: summarise(o.network.filter((r) => r.url !== JOB_API(slug))), preloadWarnings: o.consoleMessages.filter((m) => /preload/i.test(m.text)), consoleErrors: o.consoleMessages.filter((m) => m.type === 'error') };
        out.reuse[`${name} @ ${origin}`] = entry;
        expect.soft(entry.documentStatus, `${name} @ ${origin}`).toBe(200);
        expect.soft(entry.jobApiRequestsOnTheNetwork, `${name} @ ${origin}: ONE request for the Job (the preload, reused by the page)`).toBe(1);
        expect.soft(requests[0]?.status, `${name} @ ${origin}`).toBe(200);
        expect.soft(requests[0]?.method).toBe('GET');
        expect.soft(requests[0]?.headers?.['sec-fetch-mode'], 'CORS mode, as the page\'s fetch()').toBe('cors');
        expect.soft(requests[0]?.headers?.cookie, 'no cookie is sent to the API').toBeUndefined();
        expect.soft(requests[0]?.headers?.authorization).toBeUndefined();
        expect.soft(entry.preloadWarnings, 'no "preloaded but not used" warning').toEqual([]);
        expect.soft(entry.consoleErrors).toEqual([]);
        expect.soft(entry.otherApiRequests.filter((r) => r.method !== 'GET'), 'nothing but GETs').toEqual([]);
        expect.soft(h1.length).toBeGreaterThan(0);
      } finally {
        await o.context.close();
      }
    }
  }

  // 3. Afterwards nothing stale is reused: a client-side navigation (no document, so no hint) makes its own request.
  {
    const o = await observe(browser, C5_LAB_ORIGIN);
    try {
      await o.page.goto(`${C5_LAB_ORIGIN}/careers/${C5_SLUGS.open}`, { waitUntil: 'load' });
      await expect(o.page.getByRole('link', { name: 'Apply for This Role' }).first()).toBeVisible();
      const before = o.jobRequests(C5_SLUGS.open).length;
      await o.page.getByRole('link', { name: 'Apply for This Role' }).first().click();
      await expect(o.page.getByRole('button', { name: 'Submit Application' })).toBeVisible();
      const afterApply = o.jobRequests(C5_SLUGS.open).length;
      // And from Careers to a role: no document load, no hint, the ordinary request.
      await o.page.goto(`${C5_LAB_ORIGIN}/careers`, { waitUntil: 'load' });
      await o.page.getByRole('link', { name: /^View Role: / }).first().click();
      await expect(o.page.getByRole('link', { name: 'Apply for This Role' }).first()).toBeVisible();
      const viaCareers = o.network.filter((r) => /\/api\/v1\/jobs\/[a-z0-9-]+$/.test(r.url)).length;
      out.afterwards = { documentLoad: before, afterClientNavigationToApply: afterApply, jobRequestsIncludingCareersToRole: viaCareers, requests: summarise(o.network) };
      expect.soft(before, 'document load: one request').toBe(1);
      expect.soft(afterApply, 'Apply (client-side) made its own request: the preloaded response is not served again').toBe(2);
      expect.soft(viaCareers, 'Careers -> role (client-side) made its own request').toBe(3);
    } finally {
      await o.context.close();
    }
  }

  // 4. A missing Job (Detail and Apply): the API's "not found" is preloaded and handed to the page's request too -
  //    one request, 404, the page's not-found state; nothing is warned about as unused.
  out.missingJob = {};
  for (const [name, pathname] of [['job-missing', `/careers/${MISSING_JOB_SLUG}`], ['apply-missing', `/careers/${MISSING_JOB_SLUG}/apply`]]) {
    const o = await observe(browser, C5_LAB_ORIGIN);
    try {
      const response = await o.page.goto(`${C5_LAB_ORIGIN}${pathname}`, { waitUntil: 'load' });
      await expect(o.page.locator('h1').first()).toBeVisible();
      await expect(o.page.getByText(/^Loading (open roles|role details)…$/)).toHaveCount(0);
      await o.page.waitForTimeout(6000);
      const requests = o.jobRequests(MISSING_JOB_SLUG);
      out.missingJob[name] = { documentStatus: response.status(), h1: (await o.page.locator('h1').first().innerText()).trim(), requests: summarise(requests), resourceTiming: await resourceEntries(o.page, JOB_API(MISSING_JOB_SLUG)), preloadWarnings: o.consoleMessages.filter((m) => /preload/i.test(m.text)), console: o.consoleMessages };
      expect.soft(out.missingJob[name].documentStatus, name).toBe(404);
      expect.soft(requests.map((r) => [r.status, r.initiator]), `${name}: ONE request (the preload, reused)`).toEqual([[404, 'parser']]);
      expect.soft(requests[0]?.headers?.cookie, name).toBeUndefined();
      expect.soft(out.missingJob[name].h1, name).toMatch(/isn.t available/);
      expect.soft(out.missingJob[name].preloadWarnings, name).toEqual([]);
    } finally {
      await o.context.close();
    }
  }

  // 5. The hint ignored: the same documents with the link removed before the browser sees it (what a browser
  //    without preload support, or one that cannot match it, effectively gets). The page is the same.
  for (const [name, pathname, slug, status] of [['job-open', `/careers/${C5_SLUGS.open}`, C5_SLUGS.open, 200], ['apply-open', `/careers/${C5_SLUGS.open}/apply`, C5_SLUGS.open, 200], ['job-missing', `/careers/${MISSING_JOB_SLUG}`, MISSING_JOB_SLUG, 404]]) {
    const o = await observe(browser, C5_LAB_ORIGIN);
    try {
      // Chromium places a document fulfilled by the test in the public address space and would then refuse its
      // requests to 127.0.0.1 (Local Network Access) - a property of this interception, not of the site.
      await o.context.grantPermissions(['local-network-access'], { origin: C5_LAB_ORIGIN });
      await o.page.route(`${C5_LAB_ORIGIN}${pathname}`, async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()).replace(PRELOADS, '') });
      });
      await o.page.goto(`${C5_LAB_ORIGIN}${pathname}`, { waitUntil: 'load' });
      await expect(o.page.locator('h1').first()).toBeVisible();
      await expect(o.page.getByText(/^Loading (open roles|role details)…$/)).toHaveCount(0);
      const requests = o.jobRequests(slug);
      out.hintIgnored[name] = { h1: (await o.page.locator('h1').first().innerText()).trim(), linkInDocument: await o.page.locator('link[rel="preload"]').count(), requests: summarise(requests), console: o.consoleMessages };
      expect.soft(out.hintIgnored[name].linkInDocument, name).toBe(0);
      expect.soft(requests.map((r) => [r.status, r.initiator]), `${name}: the page's ordinary request`).toEqual([[status, 'script']]);
      expect.soft(out.hintIgnored[name].h1, `${name}: same heading as with the hint`).toBe((out.reuse[`${name} @ ${C5_LAB_ORIGIN}`] ?? out.missingJob[name]).h1);
    } finally {
      await o.context.close();
    }
  }

  // 6. The hinted request fails in the browser (the API unreachable from the visitor, or answering 503, while the
  //    server could read it): the page shows its error state, never the role and never "not found"; Try Again
  //    makes a NEW request and recovers.
  for (const [mode, failWith] of [['unreachable', (route) => route.abort('connectionrefused')], ['503', (route) => route.fulfill({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': C5_LAB_ORIGIN }, body: JSON.stringify({ success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'QA simulated outage' } }) })]]) {
    const o = await observe(browser, C5_LAB_ORIGIN);
    try {
      let failing = true;
      let intercepted = 0;
      await o.page.route(JOB_API(C5_SLUGS.open), (route) => {
        if (!failing) return route.continue();
        intercepted += 1;
        return failWith(route);
      });
      const response = await o.page.goto(`${C5_LAB_ORIGIN}/careers/${C5_SLUGS.open}`, { waitUntil: 'load' });
      const retry = o.page.getByRole('button', { name: 'Try Again' });
      await expect(retry).toBeVisible();
      const errorH1 = (await o.page.locator('h1').first().innerText()).trim();
      failing = false;
      await retry.click();
      await expect(o.page.getByRole('link', { name: 'Apply for This Role' }).first()).toBeVisible();
      out.failure[mode] = { documentStatus: response.status(), failedRequestsIntercepted: intercepted, errorHeading: errorH1, recoveredHeading: (await o.page.locator('h1').first().innerText()).trim(), networkRequestsForTheJob: summarise(o.jobRequests(C5_SLUGS.open)) };
      expect.soft(out.failure[mode].documentStatus).toBe(200);
      expect.soft(errorH1, `${mode}: an error state, not the role`).not.toBe(out.reuse[`job-open @ ${C5_LAB_ORIGIN}`].h1);
      expect.soft(errorH1, `${mode}: not "not found"`).not.toMatch(/not found/i);
      expect.soft(out.failure[mode].recoveredHeading, `${mode}: Try Again recovers`).toBe(out.reuse[`job-open @ ${C5_LAB_ORIGIN}`].h1);
    } finally {
      await o.context.close();
    }
  }
  record('C5-22', out);
});
