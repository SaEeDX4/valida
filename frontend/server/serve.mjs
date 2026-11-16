#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { CANONICAL_ORIGIN, resolveSeoConfig } from '../src/seo/siteConfig.js';
import { startDocumentServer } from './documentServer.js';
import { createJobsClient } from './jobsClient.js';
import { resolveJobApiPreloadBase } from './renderDocument.js';
import { isUsableServiceKey, parseTrustedHops } from './visitorAddress.js';
import { describeSiteAccess, resolveDocumentSiteAccess } from './siteAccess.js';

/**
 * Serves a production build with the C4 document behaviour (documentServer.js).
 *
 *   npm run build
 *   npm run serve:documents -- --api-origin http://127.0.0.1:4000
 *
 * Options:
 *   --dist <dir>          the build to serve (default: dist/)
 *   --host <address>      default 127.0.0.1 (loopback only)
 *   --port <port>         default 4173
 *   --api-origin <url>    origin of the Valida API for the server's own reads;
 *                         default: the origin compiled into the build
 *                         (VITE_API_BASE_URL). Required when that is empty.
 *   --no-job-preload      do not write the Job API preload hint into Job
 *                         Detail and Apply documents (renderDocument.js
 *                         jobApiPreloadTag). The hint always uses the API
 *                         base compiled into the build, never --api-origin.
 *
 * Environment (C6-T2; read from the environment, never from the command line,
 * so the key is not visible in a process list):
 *   TRUST_PROXY           "false" (default) or the number of proxy hops in
 *                         front of this server, 1-10 — the same variable and
 *                         rule as the backend's. Anything else: refused.
 *   INTERNAL_SERVICE_KEY  the secret shared with the API, 32-512 visible ASCII
 *                         characters. With none, or an unusable one, the
 *                         server still starts; its Jobs reads are then
 *                         unauthenticated, and the API answers every one of
 *                         them with the unlisted (public) view.
 *   APP_ENV               local (default), review or production (C6-T3).
 *   SITE_ACCESS           "private" or "public" (C6-T3; config rule in
 *                         backend/src/config/siteAccess.js). Review requires
 *                         private with a valid ACCESS_ALLOWLIST and a build
 *                         with indexing disabled; production requires public;
 *                         production requires public written explicitly;
 *                         absent is public only in a local run. A wrong or unsafe
 *                         combination: refused, before listening.
 *   ACCESS_ALLOWLIST      the addresses admitted to a private site (the API's
 *                         list and range policy). Never printed.
 *
 * The SEO configuration (canonical origin, indexable or not) is NOT taken from
 * this process's environment: it is read from the build's valida-seo.json, so
 * the server renders exactly the configuration the bundle was built with.
 *
 * Prints `READY {…}` (the address it actually listens on, and its
 * configuration) when ready, then one JSON line per request (method, status,
 * route kind, duration — no path, query or header).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    dist: { type: 'string', default: path.resolve(here, '..', 'dist') },
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '4173' },
    'api-origin': { type: 'string' },
    'no-job-preload': { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
  },
});

function fail(message) {
  process.stderr.write(`serve: ${message}\n`);
  process.exit(1);
}

const distDir = path.resolve(values.dist);
let manifest;
try {
  manifest = JSON.parse(readFileSync(path.join(distDir, 'valida-seo.json'), 'utf8'));
} catch {
  fail(`no valida-seo.json in ${distDir}: serve a build made by this repository's vite.config.js`);
}
const config = resolveSeoConfig({ siteUrl: manifest.siteOrigin ?? '', allowIndexing: manifest.indexing === true });
if (manifest.indexing === true && !config.siteOrigin) {
  fail(`the build is indexable but has no valid canonical origin (${config.siteProblem}; only ${CANONICAL_ORIGIN} is accepted)`);
}

const trustedHops = parseTrustedHops(process.env.TRUST_PROXY);
if (trustedHops === null) fail('TRUST_PROXY must be "false" or a hop count from 1 to 10');
const access = resolveDocumentSiteAccess({
  appEnv: process.env.APP_ENV,
  siteAccess: process.env.SITE_ACCESS,
  allowlist: process.env.ACCESS_ALLOWLIST,
  indexing: config.indexing === true,
});
if (!access.ok) fail(`${access.variable}: ${access.rule}`);
const serviceKey = process.env.INTERNAL_SERVICE_KEY;
const keyState = serviceKey === undefined || serviceKey === '' ? 'absent' : isUsableServiceKey(serviceKey) ? 'usable' : 'unusable';

const apiOrigin = values['api-origin'] ?? manifest.apiBaseUrl;
let jobs;
try {
  jobs = createJobsClient({ apiOrigin, serviceKey });
} catch {
  fail('an API origin is required (--api-origin), scheme, host and port only');
}
if (keyState !== 'usable') {
  process.stderr.write(`serve: INTERNAL_SERVICE_KEY is ${keyState}: Jobs reads are unauthenticated and the API will give every visitor the public view\n`);
}

const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) fail('--port must be a port number');

const log = values.quiet ? () => {} : (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`);
const jobApiPreloadBase = values['no-job-preload'] ? null : resolveJobApiPreloadBase(manifest.apiBaseUrl);
const server = await startDocumentServer({ distDir, config, jobs, jobApiPreloadBase, trustedHops, site: access.site, host: values.host, port, log });
const address = server.address();
process.stdout.write(
  `READY ${JSON.stringify({
    address: address.address,
    family: address.family,
    port: address.port,
    indexing: config.indexing,
    siteOrigin: config.siteOrigin,
    apiOrigin: jobs.origin,
    jobApiPreload: jobApiPreloadBase === null ? null : `${jobApiPreloadBase}/api/v1/jobs/{slug}`,
    trustProxy: trustedHops,
    // Whether reads are authenticated, and why not — never the key.
    delegation: jobs.delegation,
    serviceKey: keyState,
    appEnv: access.appEnv,
    // C6-T3: never the allowlist, only how many entries it has.
    ...describeSiteAccess(access.site),
  })}\n`,
);

const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
