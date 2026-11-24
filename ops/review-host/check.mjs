#!/usr/bin/env node
/**
 * C6-T6 — the read-only review-host checker (C6 plan r3 §7.1, §4.6.5).
 *
 *   node check.mjs --site https://<site> --api https://<api> --sha <40-hex commit> \
 *     --mode review|production --perspective listed|unlisted \
 *     [--job <open synthetic Job slug>] [--closed-job <slug>] \
 *     [--listed-sample <an address on the allowlist, for the spoofing rows>] \
 *     [--indexing false|true] [--out <folder>] [--no-browser]
 *
 * WHAT IT DOES
 *   - GET and HEAD requests only. It submits nothing, logs in nowhere, and
 *     follows no redirect by itself.
 *   - Launches Chromium directly (Playwright) for the browser rows (R5, R8);
 *     no global set-up, no database, no server.
 *   - Refuses a non-HTTPS URL (exit 2). `--allow-loopback-http` permits
 *     http://127.0.0.1 or http://localhost only, for exercising the checker
 *     against a local stack; such a run says so in every result.
 *   - Refuses to run without an expected release SHA (exit 2): every run
 *     checks R14.
 *   - Writes one JSON file per check, a summary and the R0/R1–R14 mapping.
 *     Nothing secret is recorded: no address (the --listed-sample value is
 *     never written), no response body (only lengths, digests and flags), no
 *     cookie, no credential.
 *
 * WHERE IT RUNS. Review is private: the owner runs it from a LISTED machine
 * (Node 24, a fresh folder), and again from an UNLISTED network for the
 * public twin of each access and cache row. mapping.json says, for every
 * row, what the checker covers and what is an operator step — and where:
 * a listed machine, an unlisted network, the provider's dashboard or edge,
 * or a real device.
 *
 * Exit: 0 every automated check passed; 1 any failed; 2 refused.
 */
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export const MAPPING = Object.freeze([
  { id: 'R0.1', title: 'G-ACCESS 1 — start-up line: intended SITE_ACCESS and effective RECRUITMENT_MODE; no allowlist printed', automated: [], operator: 'Read the start-up lines of both services in the host log', where: ['host log'] },
  { id: 'R0.2', title: 'G-ACCESS 2 — address probe H1–H3, each hostname', automated: [], operator: 'The address probe with the temporary probe key; the owner compares the chain with their address; then the key is removed', where: ['listed machine', 'host log'] },
  { id: 'R0.3', title: 'G-ACCESS 3 — unlisted, plain', automated: ['R0.3'], operator: 'Run the checker with --perspective unlisted from a network that is not listed (a phone on mobile data, tethered)', where: ['unlisted network'] },
  { id: 'R0.4', title: 'G-ACCESS 4 — unlisted, spoofing forwarding headers and the delegation header', automated: ['R0.4'], operator: 'Same run as R0.3, with --listed-sample set to a listed address', where: ['unlisted network'] },
  { id: 'R0.5', title: 'G-ACCESS 5 — listed: Review loads; Jobs responses carry X-Valida-Audience: tester', automated: ['R0.5'], operator: 'Run the checker with --perspective listed from a listed machine', where: ['listed machine'] },
  { id: 'R0.6', title: 'G-ACCESS 6 — internal key: the document server deployed once with a wrong key gives a listed tester the public view', automated: [], operator: 'Redeploy the document server with a deliberately wrong INTERNAL_SERVICE_KEY; run --perspective listed (R0.5 must then FAIL for documents); restore the key', where: ['host dashboard', 'listed machine'] },
  { id: 'R0.7', title: 'G-ACCESS 7 — edge caching "None" on every service', automated: [], operator: 'Screenshot the caching setting of each service', where: ['host dashboard'] },
  { id: 'R0.8', title: 'G-ACCESS 8 — cache cross-check: listed then unlisted for the same URL, and the reverse', automated: ['R0.8', 'R7'], operator: 'Run the checker listed and, at once, unlisted (and the reverse); both must pass R0.8/R7 and the unlisted run must never see a listed response (R0.3)', where: ['listed machine', 'unlisted network'] },
  { id: 'R0.9', title: 'G-ACCESS 9 — direct submission from an unlisted network: 403 (Review) or 404 (Production) before the body is read', automated: [], operator: 'A POST with a large body (the checker sends no POST): see the runbook command', where: ['unlisted network'] },
  { id: 'R0.10', title: 'G-ACCESS 10 — IPv6', automated: [], operator: 'Rows 3 and 5 from an IPv6 network if one is available; otherwise recorded as untested and no IPv6 range is listed', where: ['IPv6 network'] },
  { id: 'R1', title: 'Statuses', automated: ['R1'], operator: 'Once, by hand: Job routes with the API stopped answer 503 with Retry-After', where: ['listed machine', 'host dashboard'] },
  { id: 'R2', title: 'Heads in the initial HTML', automated: ['R2'], operator: null, where: ['listed machine'] },
  { id: 'R3', title: 'noindex (Review; Production before P8); robots.txt as accepted at C4', automated: ['R3'], operator: null, where: ['listed machine'] },
  { id: 'R4', title: 'Redirects: one 301 to the canonical path form, never a loop', automated: ['R4'], operator: null, where: ['listed machine'] },
  { id: 'R5', title: 'Preload reuse: one Job request per document load; CORS mode; no cookie', automated: ['R5'], operator: 'Also by hand in the network panel', where: ['listed machine'] },
  { id: 'R6', title: 'Compression on HTML, JS, CSS and JSON', automated: ['R6'], operator: 'If absent on the host, the edge does not compress: a document-server change (plan §13)', where: ['provider edge'] },
  { id: 'R7', title: 'Caching: the accepted T2/T3 rules; no cache hit', automated: ['R7'], operator: 'With R0.7 (edge caching None)', where: ['listed machine', 'unlisted network', 'provider edge'] },
  { id: 'R8', title: 'Security headers; the enforced CSP with no violation', automated: ['R8'], operator: 'Console by hand; Safari S12 on real devices', where: ['listed machine', 'real device'] },
  { id: 'R9', title: 'CORS: the site origin allowed, another refused', automated: ['R9'], operator: null, where: ['listed machine'] },
  { id: 'R10', title: 'Proxy trust: the Apply rate limit counts per real client', automated: [], operator: 'By hand, consistent with the hop count established in G-ACCESS (see runbook)', where: ['listed machine', 'host log'] },
  { id: 'R11', title: 'Private storage: an object without credentials is refused; no storage key in any response', automated: ['R11'], operator: 'By hand: an unauthenticated GET of a synthetic object at the provider is refused', where: ['listed machine', 'provider console'] },
  { id: 'R12', title: 'Lab performance on the host (Lighthouse, mobile and desktop, 3 runs each)', automated: [], operator: 'Lighthouse from one stated listed machine; lab figures, not field data', where: ['listed machine'] },
  { id: 'R13', title: 'Log redaction: no marker in the host logs or the error monitor', automated: [], operator: 'A synthetic application with marker fields (by a listed tester); search the host logs and the monitor', where: ['host log', 'error monitor'] },
  { id: 'R14', title: 'Release identity: both services state the deployed SHA', automated: ['R14'], operator: 'Compare with the host deploy record (§8.4 readings 1 and 3)', where: ['listed machine', 'unlisted network', 'host dashboard'] },
]);

const PRIVATE = 'private, no-store';
const RECRUITMENT_PATHS = (job) => ['/careers', ...(job ? [`/careers/${job}`, `/careers/${job}/apply`] : [])];
const STATIC_PAGES = ['/', '/about', '/careers', '/privacy', '/legal', '/contact'];
const CACHE_HIT = (h) => /hit/i.test(h['cf-cache-status'] ?? '') || /hit/i.test(h['x-cache'] ?? '') || /hit/i.test(h['x-render-cache'] ?? '') || (h.age !== undefined && Number(h.age) > 0);
const KEPT_HEADERS = ['cache-control', 'etag', 'last-modified', 'x-valida-release', 'x-valida-audience', 'content-type', 'content-security-policy', 'content-security-policy-report-only', 'x-robots-tag', 'location', 'content-encoding', 'age', 'cf-cache-status', 'x-cache', 'x-render-cache', 'access-control-allow-origin', 'retry-after', 'x-content-type-options', 'referrer-policy', 'x-frame-options', 'permissions-policy', 'strict-transport-security'];

export function parseCheckerArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      site: { type: 'string' },
      api: { type: 'string' },
      sha: { type: 'string' },
      mode: { type: 'string' },
      perspective: { type: 'string' },
      job: { type: 'string' },
      'closed-job': { type: 'string' },
      'listed-sample': { type: 'string' },
      indexing: { type: 'string', default: 'false' },
      out: { type: 'string' },
      'no-browser': { type: 'boolean', default: false },
      'allow-loopback-http': { type: 'boolean', default: false },
    },
  });
  const problems = [];
  const origin = (name) => {
    let url;
    try {
      url = new URL(values[name] ?? '');
    } catch {
      problems.push(`--${name} must be an origin URL`);
      return null;
    }
    if (url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) problems.push(`--${name} must be an origin (scheme, host, optional port)`);
    const loopback = ['127.0.0.1', 'localhost'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback && values['allow-loopback-http'])) problems.push(`--${name} must use https:// (the checker refuses plain http)`);
    return url.origin;
  };
  const site = origin('site');
  const api = origin('api');
  if (!values.sha) problems.push('--sha is required: the expected release (a full 40-character commit SHA); every run checks R14');
  else if (!/^[0-9a-f]{40}$/.test(values.sha)) problems.push('--sha must be a full 40-character lowercase commit SHA');
  if (!['review', 'production'].includes(values.mode)) problems.push('--mode must be review or production');
  if (!['listed', 'unlisted'].includes(values.perspective)) problems.push('--perspective must be listed or unlisted');
  for (const name of ['job', 'closed-job']) if (values[name] && !/^[a-z0-9][a-z0-9-]{0,99}$/.test(values[name])) problems.push(`--${name} must be a Job slug`);
  if (values['listed-sample'] && !/^[0-9a-fA-F.:]{2,45}$/.test(values['listed-sample'])) problems.push('--listed-sample must be an IP address');
  if (!['true', 'false'].includes(values.indexing)) problems.push('--indexing must be true or false');
  return {
    problems,
    options: {
      site,
      api,
      sha: values.sha,
      mode: values.mode,
      perspective: values.perspective,
      job: values.job ?? null,
      closedJob: values['closed-job'] ?? null,
      listedSample: values['listed-sample'] ?? null,
      indexing: values.indexing === 'true',
      out: values.out ?? path.resolve(`review-check-${new Date().toISOString().replace(/[:.]/g, '-')}`),
      browser: !values['no-browser'],
      loopback: Boolean(values['allow-loopback-http']),
    },
  };
}

/** One GET or HEAD, never following a redirect. */
function fetchOnce(base, target, { method = 'GET', headers = {}, timeoutMs = 15_000 } = {}) {
  if (method !== 'GET' && method !== 'HEAD') throw new Error('the checker sends GET and HEAD only');
  const url = new URL(target, base);
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const req = client.request(url, { method, headers: { 'user-agent': 'valida-review-check/1', ...headers }, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        const kept = {};
        for (const name of KEPT_HEADERS) if (res.headers[name] !== undefined) kept[name] = res.headers[name];
        resolve({ ok: true, method, path: url.pathname + url.search, status: res.statusCode, headers: kept, rawHeaders: res.headers, body, bodyLength: body.length, bodySha256: createHash('sha256').update(body).digest('hex') });
      });
      res.on('error', () => resolve({ ok: false, method, path: url.pathname, error: 'RESPONSE_ERROR' }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', (error) => resolve({ ok: false, method, path: url.pathname, error: error.message === 'timeout' ? 'TIMEOUT' : 'UNREACHABLE' }));
    req.end();
  });
}
const shown = (r) => (r.ok ? { method: r.method, path: r.path, status: r.status, headers: r.headers, bodyLength: r.bodyLength } : { method: r.method, path: r.path, error: r.error });

export async function runChecks(o) {
  const results = [];
  const all = { site: [], api: [] };
  const get = async (which, target, extra) => {
    const r = await fetchOnce(which === 'site' ? o.site : o.api, target, extra);
    all[which].push(r);
    return r;
  };
  const record = (id, title, pass, expected, observed, { skipped = false } = {}) => {
    const mapping = MAPPING.find((m) => m.id === id) ?? null;
    results.push({ id, title, perspective: o.perspective, mode: o.mode, environment: o.loopback ? 'local loopback stack (not a host)' : 'hosted', where: mapping?.where ?? [], result: skipped ? 'SKIPPED' : pass ? 'PASS' : 'FAIL', expected, observed });
  };
  const review = o.mode === 'review';
  const unknownJob = `qa-not-a-job-${randomBytes(4).toString('hex')}`;

  if (o.perspective === 'unlisted') {
    // R0.3 — the public twin.
    const site = [];
    for (const p of ['/', '/careers', ...(o.job ? [`/careers/${o.job}`, `/careers/${o.job}/apply`] : []), `/careers/${unknownJob}`, '/robots.txt', '/sitemap.xml']) site.push(await get('site', p));
    const jobs = await get('api', '/api/v1/jobs');
    const jobDetail = o.job ? await get('api', `/api/v1/jobs/${o.job}`) : null;
    const liveness = [await get('site', '/healthz'), await get('api', '/api/v1/health')];
    let pass;
    let expected;
    if (review) {
      expected = 'Review is private: every site route and the Jobs API answer 403 with private, no-store; liveness 200; no X-Valida-Audience';
      pass = site.every((r) => r.ok && r.status === 403 && r.headers['cache-control'] === PRIVATE) && jobs.ok && jobs.status === 403 && (!jobDetail || jobDetail.status === 403) && liveness.every((r) => r.ok && r.status === 200) && ![...site, jobs].some((r) => r.headers?.['x-valida-audience']);
    } else {
      expected = 'Production: the Jobs list is empty, a Job answers 404, no X-Valida-Audience header';
      pass = jobs.ok && jobs.status === 200 && JSON.parse(jobs.body.toString() || '{}')?.data?.items?.length === 0 && (!jobDetail || jobDetail.status === 404) && !jobs.headers['x-valida-audience'];
    }
    record('R0.3', MAPPING[2].title, pass, expected, { site: site.map(shown), api: [jobs, jobDetail].filter(Boolean).map(shown), liveness: liveness.map(shown) });

    // R0.4 — spoofing: every variant must look exactly like R0.3.
    if (o.listedSample) {
      const variants = [
        ['X-Forwarded-For (one listed entry)', { 'x-forwarded-for': o.listedSample }],
        ['X-Forwarded-For (several entries)', { 'x-forwarded-for': `${o.listedSample}, ${o.listedSample}` }],
        ['True-Client-IP', { 'true-client-ip': o.listedSample }],
        ['CF-Connecting-IP', { 'cf-connecting-ip': o.listedSample }],
        ['X-Real-IP', { 'x-real-ip': o.listedSample }],
        ['Forwarded', { forwarded: `for=${o.listedSample}` }],
        ['the delegation address header without a key', { 'x-valida-visitor-address': o.listedSample }],
        ['the delegation headers with a wrong key', { 'x-valida-visitor-address': o.listedSample, 'x-valida-internal-key': `qa-wrong-${randomBytes(16).toString('hex')}` }],
      ];
      const observed = [];
      let pass4 = true;
      for (const [label, headers] of variants) {
        const s = await get('site', '/careers', { headers });
        const a = await get('api', '/api/v1/jobs', { headers });
        const same = review ? s.status === 403 && a.status === 403 : a.status === 200 && JSON.parse(a.body.toString() || '{}')?.data?.items?.length === 0;
        const ok = same && !s.headers?.['x-valida-audience'] && !a.headers?.['x-valida-audience'];
        if (!ok) pass4 = false;
        observed.push({ variant: label, site: s.status, api: a.status, audience: Boolean(s.headers?.['x-valida-audience'] || a.headers?.['x-valida-audience']) });
      }
      record('R0.4', MAPPING[3].title, pass4, 'every variant answered exactly as R0.3 (the listed address used is not recorded)', observed);
    } else record('R0.4', MAPPING[3].title, false, 'needs --listed-sample', null, { skipped: true });
  } else {
    // R0.5 — listed.
    const page = await get('site', '/');
    const jobs = await get('api', '/api/v1/jobs');
    const pass = page.ok && page.status === 200 && jobs.ok && jobs.status === 200 && jobs.headers['x-valida-audience'] === 'tester';
    record('R0.5', MAPPING[4].title, pass, 'the site loads (200); the Jobs list answers 200 with X-Valida-Audience: tester', { site: shown(page), api: shown(jobs) });

    // R1 — statuses.
    const statuses = [];
    for (const p of STATIC_PAGES) statuses.push([p, 200, await get('site', p)]);
    statuses.push([`/careers/${unknownJob}`, 404, await get('site', `/careers/${unknownJob}`)]);
    statuses.push([`/careers/${unknownJob}/apply`, 404, await get('site', `/careers/${unknownJob}/apply`)]);
    statuses.push([`/qa-unknown-${randomBytes(3).toString('hex')}`, 404, await get('site', `/qa-unknown-${randomBytes(3).toString('hex')}`)]);
    if (o.job) {
      statuses.push([`/careers/${o.job}`, 200, await get('site', `/careers/${o.job}`)]);
      statuses.push([`/careers/${o.job}/apply`, 200, await get('site', `/careers/${o.job}/apply`)]);
    }
    if (o.closedJob) statuses.push([`/careers/${o.closedJob}`, 200, await get('site', `/careers/${o.closedJob}`)]);
    record('R1', MAPPING[10].title, statuses.every(([, want, r]) => r.ok && r.status === want), `pages, open Job, its Apply${o.closedJob ? ', closed Job' : ''}: 200; unknown Job, its Apply and an unknown path: 404${o.job ? '' : ' (no --job given: Job routes not checked)'}`, statuses.map(([p, want, r]) => ({ path: p, expected: want, status: r.status ?? r.error })));

    // R2 — heads before any script.
    const heads = [];
    for (const p of [...STATIC_PAGES, ...(o.job ? [`/careers/${o.job}`] : [])]) {
      const r = all.site.find((x) => x.path === p && x.status === 200) ?? (await get('site', p));
      const html = r.body?.toString('utf8') ?? '';
      const scriptAt = html.search(/<script\b(?![^>]*application\/ld\+json)/i);
      const before = scriptAt === -1 ? html : html.slice(0, scriptAt);
      const title = /<title>[^<]+<\/title>/i.test(before);
      const description = /<meta\s+name="description"\s+content="[^"]+"/i.test(before);
      const robots = /<meta\s+name="robots"\s+content="[^"]+"/i.test(before);
      heads.push({ path: p, title, description, robots });
    }
    record('R2', MAPPING[11].title, heads.every((h) => h.title && h.description && h.robots), 'title, description and robots in the initial HTML, before any script', heads);

    // R3 — noindex.
    if (review || !o.indexing) {
      const pages = [];
      for (const p of [...STATIC_PAGES, ...(o.job ? [`/careers/${o.job}`] : [])]) {
        const r = all.site.find((x) => x.path === p && x.status === 200) ?? (await get('site', p));
        const html = r.body?.toString('utf8') ?? '';
        pages.push({ path: p, header: /noindex/.test(r.headers['x-robots-tag'] ?? ''), meta: /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html), canonical: /rel="canonical"/i.test(html), openGraph: /property="og:/i.test(html), structuredData: /application\/ld\+json/i.test(html) });
      }
      const robots = await get('site', '/robots.txt');
      const sitemap = await get('site', '/sitemap.xml');
      // The accepted C4 rule (frontend/src/seo/discovery.js), which governs over the plan's
      // older "robots.txt disallows all": a non-indexed build does NOT block crawling — a
      // noindex is only seen on a page a crawler may fetch — and lists no sitemap.
      const text = robots.body?.toString() ?? '';
      const robotsRule = { blanketDisallow: /^\s*Disallow:\s*\/\s*$/m.test(text), allowAll: /^\s*Allow:\s*\/\s*$/m.test(text), sitemapLine: /^\s*Sitemap:/im.test(text) };
      const robotsOk = robots.status === 200 && /noindex/.test(robots.headers['x-robots-tag'] ?? '') && robotsRule.allowAll && !robotsRule.blanketDisallow && !robotsRule.sitemapLine;
      record('R3', MAPPING[12].title, pages.every((x) => x.header && x.meta && !x.canonical && !x.openGraph && !x.structuredData) && robotsOk && sitemap.status === 404, 'noindex header and meta on every page; no canonical, Open Graph or structured data; robots.txt as accepted at C4 (Allow: /, no blanket Disallow, no Sitemap line, itself noindex); no sitemap (404)', { pages, robots: { status: robots.status, ...robotsRule }, sitemap: sitemap.status });
    } else record('R3', MAPPING[12].title, true, 'indexing on (after P8): not applicable', null, { skipped: true });

    // R4 — redirects.
    const redirects = [];
    for (const p of ['/about/', '/careers/', '/privacy/']) {
      const first = await get('site', p);
      const location = first.headers?.location ?? null;
      const second = location ? await get('site', new URL(location, o.site).pathname) : null;
      redirects.push({ path: p, status: first.status, location, then: second?.status ?? null });
    }
    record('R4', MAPPING[13].title, redirects.every((r) => r.status === 301 && r.location && r.then === 200), 'one 301 to the canonical path form, which answers 200 (no second hop, no loop)', redirects);

    // R6 — compression.
    const html = all.site.find((x) => x.path === '/' && x.status === 200)?.body?.toString('utf8') ?? '';
    const script = /<script[^>]+type="module"[^>]+src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1] ?? null;
    const style = /<link[^>]+rel="stylesheet"[^>]+href="(\/assets\/[^"]+\.css)"/.exec(html)?.[1] ?? /<link[^>]+href="(\/assets\/[^"]+\.css)"[^>]+rel="stylesheet"/.exec(html)?.[1] ?? null;
    const encoded = [];
    for (const [which, p] of [['site', '/'], ['site', script], ['site', style], ['api', '/api/v1/jobs']]) {
      if (!p) continue;
      const r = await get(which, p, { headers: { 'accept-encoding': 'br, gzip' } });
      encoded.push({ service: which, path: p, status: r.status, contentEncoding: r.headers?.['content-encoding'] ?? null });
    }
    record('R6', MAPPING[15].title, encoded.length === 4 && encoded.every((e) => ['br', 'gzip'].includes(e.contentEncoding)), 'br or gzip on HTML, JS, CSS and JSON', encoded);

    // R7 — caching (the accepted T2/T3 contracts).
    const cache = [];
    const assets = [script, style].filter(Boolean);
    for (const p of assets) await get('site', p);
    for (const r of [...all.site, ...all.api]) {
      if (!r.ok) continue;
      const p = r.path.split('?')[0];
      let want;
      if (review) want = (h) => h['cache-control'] === PRIVATE && !h.etag && !h['last-modified'];
      else if (all.api.includes(r) && p.startsWith('/api/v1/jobs')) want = (h) => /no-store/.test(h['cache-control'] ?? '') && !h.etag && !h['last-modified'];
      else if (all.site.includes(r) && p.startsWith('/assets/')) want = (h) => h['cache-control'] === 'public, max-age=31536000, immutable';
      else if (all.site.includes(r) && RECRUITMENT_PATHS(o.job).includes(p) && r.status === 200) want = (h) => h['cache-control'] === PRIVATE && !h.etag && !h['last-modified'];
      else continue;
      cache.push({ service: all.api.includes(r) ? 'api' : 'site', path: p, status: r.status, cacheControl: r.headers['cache-control'] ?? null, etag: Boolean(r.headers.etag), lastModified: Boolean(r.headers['last-modified']), cacheHit: CACHE_HIT(r.rawHeaders), pass: want(r.rawHeaders) && !CACHE_HIT(r.rawHeaders) });
    }
    record('R7', MAPPING[16].title, cache.length > 0 && cache.every((c) => c.pass), review ? 'Review: EVERY response of both services private, no-store, no ETag or Last-Modified, no cache hit' : 'Production (closed/testers): Jobs API no-store without validators; Careers, Job and Apply documents private, no-store; /assets/ one year immutable; no cache hit', cache);

    // R8 — headers.
    const csp = all.site.find((x) => x.path === '/' && x.ok)?.headers['content-security-policy'] ?? '';
    const docHeaders = all.site.filter((x) => x.ok).map((x) => ({ path: x.path, status: x.status, csp: Boolean(x.headers['content-security-policy']), reportOnly: Boolean(x.headers['content-security-policy-report-only']), nosniff: x.headers['x-content-type-options'] === 'nosniff', referrer: x.headers['referrer-policy'] ?? null, frame: x.headers['x-frame-options'] ?? null, hsts: Boolean(x.headers['strict-transport-security']) }));
    const apiCsp = all.api.find((x) => x.ok)?.headers['content-security-policy'] ?? '';
    const cspOk = /default-src 'none'/.test(csp) && /frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp) && !/unsafe-inline|unsafe-eval|\*|https:(?!\/\/)|data:/.test(csp) && new RegExp(`connect-src 'self' ${o.api.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(;|$)`).test(csp);
    let violations = null;
    if (o.browser) violations = await browserChecks(o, { mode: 'csp' });
    const headersOk = docHeaders.every((d) => d.csp && !d.reportOnly && d.nosniff && d.referrer === 'strict-origin-when-cross-origin' && d.frame === 'DENY') && /default-src 'none'/.test(apiCsp) && /frame-ancestors 'none'/.test(apiCsp);
    record('R8', MAPPING[17].title, cspOk && headersOk && (violations === null || violations.violations.length === 0), "the document CSP enforced (no 'unsafe-inline', 'unsafe-eval', wildcard, scheme source; connect-src names the API origin exactly); nosniff, Referrer-Policy, X-Frame-Options DENY on every response; the API's own CSP; no CSP violation in Chromium on any route. HSTS is reported, expected absent until P9", { csp, apiCsp, documents: docHeaders, browser: violations });

    // R5 — preload reuse.
    if (o.job && o.browser) {
      const jobHtml = all.site.find((x) => x.path === `/careers/${o.job}` && x.status === 200)?.body?.toString() ?? '';
      const hint = /<link\s+rel="preload"\s+as="fetch"/i.test(jobHtml);
      const elsewhere = /<link\s+rel="preload"\s+as="fetch"/i.test(all.site.find((x) => x.path === '/about' && x.status === 200)?.body?.toString() ?? '');
      const counted = await browserChecks(o, { mode: 'preload' });
      record('R5', MAPPING[14].title, hint && !elsewhere && counted.loads.every((l) => l.jobRequests === 1 && l.mode === 'cors' && !l.cookie), 'hint on the Job document, not elsewhere; ONE Job request per document load; CORS mode; no cookie', { hintOnJob: hint, hintElsewhere: elsewhere, loads: counted.loads });
    } else record('R5', MAPPING[14].title, false, 'needs --job and the browser', null, { skipped: true });

    // R9 — CORS.
    const allowed = await get('api', '/api/v1/jobs', { headers: { origin: o.site } });
    const other = await get('api', '/api/v1/jobs', { headers: { origin: 'https://qa-not-allowed.invalid' } });
    record('R9', MAPPING[18].title, allowed.headers?.['access-control-allow-origin'] === o.site && !other.headers?.['access-control-allow-origin'], 'the site origin is allowed; another origin gets no Access-Control-Allow-Origin', { allowed: allowed.headers?.['access-control-allow-origin'] ?? null, other: other.headers?.['access-control-allow-origin'] ?? null });
  }

  // R0.8 — address-dependent responses (both perspectives).
  const dependent = [...all.site, ...all.api].filter((r) => r.ok && (review || (all.api.includes(r) && r.path.startsWith('/api/v1/jobs')) || RECRUITMENT_PATHS(o.job).includes(r.path.split('?')[0])));
  record('R0.8', MAPPING[7].title, dependent.length > 0 && dependent.every((r) => /no-store/.test(r.rawHeaders['cache-control'] ?? '') && !r.rawHeaders.etag && !CACHE_HIT(r.rawHeaders)), 'every address-dependent response: no-store, no ETag, no cache-hit indicator (the cross-check needs both perspectives)', dependent.map((r) => ({ path: r.path, status: r.status, cacheControl: r.headers['cache-control'] ?? null, etag: Boolean(r.headers.etag), cacheHit: CACHE_HIT(r.rawHeaders) })));

  // R11 (the automated half) — no storage key in any response.
  const leaked = [...all.site, ...all.api].filter((r) => r.ok && /resumes\/[0-9a-f]{32}/.test(r.body.toString('latin1')));
  record('R11', MAPPING[20].title, leaked.length === 0, 'no storage key in any response body (the unauthenticated object read is an operator step)', { responses: all.site.length + all.api.length, withStorageKey: leaked.map((r) => r.path) });

  // R14 — release identity, every response of both services.
  const releases = (rows) => [...new Set(rows.filter((r) => r.ok).map((r) => r.headers['x-valida-release'] ?? null))];
  const siteReleases = releases(all.site);
  const apiReleases = releases(all.api);
  record('R14', MAPPING[23].title, siteReleases.length === 1 && siteReleases[0] === o.sha && apiReleases.length === 1 && apiReleases[0] === o.sha, `X-Valida-Release equals ${o.sha} on every response of both services`, { site: siteReleases, api: apiReleases, responses: { site: all.site.length, api: all.api.length } });
  return results;
}

async function browserChecks(o, { mode }) {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    return { error: 'playwright is not installed next to the checker (npm ci in ops/review-host)', violations: ['NO_BROWSER'], loads: [] };
  }
  let browser;
  try {
    browser = await playwright.chromium.launch();
  } catch {
    return { error: 'Chromium could not be launched (npx playwright install chromium)', violations: ['NO_BROWSER'], loads: [] };
  }
  try {
    const context = await browser.newContext();
    if (mode === 'csp') {
      const violations = [];
      const routes = [...STATIC_PAGES, ...(o.job ? [`/careers/${o.job}`, `/careers/${o.job}/apply`] : [])];
      for (const route of routes) {
        const page = await context.newPage();
        page.on('console', (msg) => {
          if (msg.type() === 'error' && /Content[- ]Security[- ]Policy|Refused to/i.test(msg.text())) violations.push({ route, text: msg.text().slice(0, 200) });
        });
        await page.goto(new URL(route, o.site).href, { waitUntil: 'networkidle' });
        await page.close();
      }
      return { browser: browser.version(), routes: routes.length, violations };
    }
    const loads = [];
    for (const route of [`/careers/${o.job}`, `/careers/${o.job}/apply`]) {
      const page = await context.newPage();
      const requests = [];
      page.on('request', (request) => {
        if (request.url() === `${o.api}/api/v1/jobs/${o.job}`) requests.push(request);
      });
      await page.goto(new URL(route, o.site).href, { waitUntil: 'networkidle' });
      const first = requests[0];
      const headers = first ? await first.allHeaders() : {};
      loads.push({ route, jobRequests: requests.length, mode: headers['sec-fetch-mode'] ?? null, cookie: Boolean(headers.cookie) });
      await page.close();
    }
    return { browser: browser.version(), loads };
  } finally {
    await browser.close();
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { problems, options } = parseCheckerArgs(argv);
  if (problems.length) {
    process.stderr.write(`review-check refused:\n${problems.map((p) => `  ${p}`).join('\n')}\n`);
    return 2;
  }
  const started = new Date();
  const results = await runChecks(options);
  mkdirSync(path.join(options.out, 'results'), { recursive: true });
  for (const result of results) writeFileSync(path.join(options.out, 'results', `${result.id}.json`), `${JSON.stringify(result, null, 2)}\n`);
  const failed = results.filter((r) => r.result === 'FAIL');
  const summary = {
    checker: 'ops/review-host/check.mjs',
    startedAt: started.toISOString(),
    completedAt: new Date().toISOString(),
    site: options.site,
    api: options.api,
    expectedRelease: options.sha,
    mode: options.mode,
    perspective: options.perspective,
    environment: options.loopback ? 'local loopback stack (not a host)' : 'hosted',
    counts: { pass: results.filter((r) => r.result === 'PASS').length, fail: failed.length, skipped: results.filter((r) => r.result === 'SKIPPED').length },
    results: results.map(({ id, result }) => ({ id, result })),
  };
  writeFileSync(path.join(options.out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(path.join(options.out, 'mapping.json'), `${JSON.stringify(MAPPING, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  return failed.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
