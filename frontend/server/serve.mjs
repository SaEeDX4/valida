#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { CANONICAL_ORIGIN, resolveSeoConfig } from '../src/seo/siteConfig.js';
import { startDocumentServer } from './documentServer.js';
import { createJobsClient } from './jobsClient.js';

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

const apiOrigin = values['api-origin'] ?? manifest.apiBaseUrl;
let jobs;
try {
  jobs = createJobsClient({ apiOrigin });
} catch {
  fail('an API origin is required (--api-origin), scheme, host and port only');
}

const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) fail('--port must be a port number');

const log = values.quiet ? () => {} : (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`);
const server = await startDocumentServer({ distDir, config, jobs, host: values.host, port, log });
const address = server.address();
process.stdout.write(
  `READY ${JSON.stringify({
    address: address.address,
    family: address.family,
    port: address.port,
    indexing: config.indexing,
    siteOrigin: config.siteOrigin,
    apiOrigin: jobs.origin,
  })}\n`,
);

const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
