import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { buildRobotsTxt, buildSitemapXml } from '../src/seo/discovery.js';
import { JOB_OUTCOME } from './jobsClient.js';
import { canonicalRedirect, checkTemplate, renderDocument } from './renderDocument.js';
import { establishVisitorAddress } from './visitorAddress.js';
import {
  CONDITIONAL_REQUEST_HEADERS,
  DOCUMENT_LIVENESS_PATH,
  PUBLIC_SITE_ACCESS,
  SITE_ADMISSION,
  decideSiteAdmission,
  enforcePrivateResponseHeaders,
  isPrivateSite,
} from './siteAccess.js';

/**
 * The local reference document server (C4).
 *
 * WHAT IT IS. A small Node http server (no dependency added) that serves a
 * production build of the frontend the way Doc 16 needs public routes to be
 * served: each document with its real HTTP status and its metadata already in
 * the initial HTML (renderDocument.js), /sitemap.xml built from the live open
 * Jobs, /robots.txt, and the built static assets.
 *
 * WHAT IT IS NOT. A hosting decision. Doc 16 section 101 and Doc 15 select the
 * production mechanism at C6 (managed static/CDN hosting is preferred, Doc 15
 * section 63). This server is the host-independent, tested implementation of
 * the behaviour; C6 either deploys it or reproduces it on the chosen host
 * (edge function / HTML transformation) from the same src/seo modules, and the
 * production checks are repeated there. Compression, TLS, the www/apex
 * redirect and the frontend Content-Security-Policy are C6 hosting concerns and
 * are not done here.
 *
 * SAFETY
 *   - GET and HEAD only; anything else is 405.
 *   - Static files only from the build directory: every path segment is
 *     decoded and checked, the resolved real path must stay inside the build
 *     directory, only regular files are served, dotfiles and the build's own
 *     index.html and SEO manifest are never served as files.
 *   - The only outbound requests are the public Jobs API reads (jobsClient.js).
 *   - Nothing from the request (query, headers, cookies) is logged or sent on.
 *     C6-T2: the one thing derived from a request and sent on is the
 *     visitor's ADDRESS, established by the API's own rule from the socket
 *     and X-Forwarded-For under TRUST_PROXY (visitorAddress.js). The
 *     X-Valida-* headers a request arrives with are never read and never
 *     passed on, so a visitor cannot name another address or present a key.
 *     The address is not logged.
 *   - C6-T3: GET/HEAD of exactly /healthz is the liveness check: 200, empty
 *     body, in every mode. With SITE_ACCESS=private (siteAccess.js) every
 *     other request from a visitor whose address is not listed is answered
 *     403 "Forbidden" FIRST — before the method check, redirects, robots.txt,
 *     the sitemap, static files and documents — and every response carries
 *     `Cache-Control: private, no-store` and no validator.
 */

const CONTENT_TYPES = Object.freeze({
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
});

/** Namespaces that only ever hold files: an unknown path there is a plain 404, not the branded page. */
const FILE_NAMESPACES = ['/assets/', '/brand/'];
/** Files of the build that are never served as files. */
const NEVER_SERVED = new Set(['index.html', 'valida-seo.json']);

export async function loadTemplate(distDir) {
  const template = await readFile(path.join(distDir, 'index.html'), 'utf8');
  const problems = checkTemplate(template);
  if (problems.length > 0) throw new Error(`document server refused the build: ${problems.join('; ')}`);
  return template;
}

/**
 * The real path of a static file inside `distDir` for a request path, or null.
 * Exported for tests.
 */
export async function resolveStaticFile(distRoot, pathname) {
  const rawSegments = pathname.split('/').slice(1);
  if (rawSegments.length === 0 || rawSegments.some((segment) => segment === '')) return null;
  const segments = [];
  for (const raw of rawSegments) {
    let segment;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (segment === '.' || segment === '..' || segment.startsWith('.') || /[\\/\0:]/.test(segment)) return null;
    segments.push(segment);
  }
  if (segments.length === 1 && NEVER_SERVED.has(segments[0])) return null;
  const candidate = path.join(distRoot, ...segments);
  if (!candidate.startsWith(distRoot + path.sep)) return null;
  try {
    const info = await lstat(candidate);
    if (!info.isFile()) return null;
    const real = await realpath(candidate);
    if (!real.startsWith(distRoot + path.sep)) return null;
    return real;
  } catch {
    return null;
  }
}

function send(res, method, status, headers, body = '') {
  const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  res.writeHead(status, { ...headers, 'content-length': String(payload.length) });
  res.end(method === 'HEAD' ? undefined : payload);
}

/**
 * The request handler. `config` is the build's SEO configuration
 * ({ indexing, siteOrigin }); `jobs` the server-side Jobs client;
 * `jobApiPreloadBase` the browser-facing API base for the Job preload hint
 * (renderDocument.js jobApiPreloadTag), null for none.
 */
const BODILESS_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function createDocumentHandler({ distDir, config, jobs, jobApiPreloadBase = null, trustedHops = false, site = PUBLIC_SITE_ACCESS, log = () => {} }) {
  const privateSite = isPrivateSite(site);
  const distRoot = await realpath(distDir);
  const template = await loadTemplate(distRoot);

  return async function handle(req, res) {
    const started = process.hrtime.bigint();
    const method = req.method;
    let routeKind = 'unknown';
    const finish = () =>
      log({ event: 'request', method, status: res.statusCode, route: routeKind, ms: Number((process.hrtime.bigint() - started) / 1_000_000n) });
    res.on('finish', finish);

    try {
      const rawTarget = typeof req.url === 'string' ? req.url : '';

      // C6-T3 — site access, before anything else.
      if (privateSite) {
        enforcePrivateResponseHeaders(res);
        for (const name of CONDITIONAL_REQUEST_HEADERS) delete req.headers[name];
        const { admission } = decideSiteAdmission({
          site,
          method,
          rawUrl: rawTarget,
          livenessPath: DOCUMENT_LIVENESS_PATH,
          trustedHops,
          socketAddress: req.socket?.remoteAddress,
          forwardedFor: req.headers?.['x-forwarded-for'],
        });
        if (admission === SITE_ADMISSION.DENIED) {
          routeKind = 'denied';
          const headers = { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' };
          if (!config.indexing) headers['x-robots-tag'] = 'noindex, nofollow';
          // A request that may carry a body: its body is never read, and the
          // connection is not reused after this answer.
          if (!BODILESS_METHODS.has(method)) headers.connection = 'close';
          send(res, method, 403, headers, 'Forbidden');
          return;
        }
      }

      if ((method === 'GET' || method === 'HEAD') && rawTarget === DOCUMENT_LIVENESS_PATH) {
        routeKind = 'liveness';
        send(res, method, 200, { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }, '');
        return;
      }

      if (method !== 'GET' && method !== 'HEAD') {
        routeKind = 'method';
        send(res, method, 405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' }, 'Method Not Allowed');
        return;
      }
      const target = typeof req.url === 'string' ? req.url : '/';
      if (!target.startsWith('/')) {
        routeKind = 'bad';
        send(res, method, 400, { 'content-type': 'text/plain; charset=utf-8' }, 'Bad Request');
        return;
      }
      const queryAt = target.indexOf('?');
      const pathname = queryAt === -1 ? target : target.slice(0, queryAt);
      const search = queryAt === -1 ? '' : target.slice(queryAt);

      if (pathname === '/robots.txt') {
        routeKind = 'robots';
        const headers = { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' };
        if (!config.indexing) headers['x-robots-tag'] = 'noindex, nofollow';
        send(res, method, 200, headers, buildRobotsTxt(config));
        return;
      }

      if (pathname === '/sitemap.xml') {
        routeKind = 'sitemap';
        // Review builds have no sitemap: review URLs are never listed (Doc 16 section 106).
        if (!config.indexing || !config.siteOrigin) {
          send(res, method, 404, { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex, nofollow' }, 'Not Found');
          return;
        }
        const listed = await jobs.listOpenJobSlugs();
        if (listed.outcome !== JOB_OUTCOME.OK) {
          send(res, method, 503, { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '60', 'cache-control': 'no-store' }, 'Service Unavailable');
          return;
        }
        const { xml } = buildSitemapXml({ siteOrigin: config.siteOrigin, openJobSlugs: listed.slugs });
        send(res, method, 200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' }, xml);
        return;
      }

      const file = await resolveStaticFile(distRoot, pathname);
      if (file) {
        routeKind = 'asset';
        const info = await lstat(file);
        const extension = path.extname(file).toLowerCase();
        const headers = {
          'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
          'content-length': String(info.size),
          'x-content-type-options': 'nosniff',
          // Doc 16 section 208: fingerprinted build assets are immutable; anything else is revalidated.
          'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        };
        if (!config.indexing) headers['x-robots-tag'] = 'noindex, nofollow';
        res.writeHead(200, headers);
        if (method === 'HEAD') {
          res.end();
          return;
        }
        createReadStream(file).pipe(res);
        return;
      }

      if (FILE_NAMESPACES.some((prefix) => pathname.startsWith(prefix))) {
        routeKind = 'asset';
        send(res, method, 404, { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex' }, 'Not Found');
        return;
      }

      const location = canonicalRedirect(pathname, search);
      if (location) {
        routeKind = 'redirect';
        send(res, method, 301, { location, 'cache-control': 'no-cache' }, '');
        return;
      }

      // C6-T2: who is asking, for the API to decide what they may see.
      const visitor = establishVisitorAddress(req, trustedHops);
      const document = await renderDocument(pathname, { template, config, jobs, jobApiPreloadBase, visitor });
      routeKind = document.route.kind;
      send(res, method, document.status, document.headers, document.body);
    } catch {
      routeKind = 'error';
      if (!res.headersSent) send(res, method, 500, { 'content-type': 'text/plain; charset=utf-8' }, 'Internal Server Error');
      else res.destroy();
    }
  };
}

export async function startDocumentServer({ distDir, config, jobs, jobApiPreloadBase = null, trustedHops = false, site = PUBLIC_SITE_ACCESS, host = '127.0.0.1', port = 4173, log }) {
  const handle = await createDocumentHandler({ distDir, config, jobs, jobApiPreloadBase, trustedHops, site, log });
  const server = createServer((req, res) => {
    handle(req, res);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}
