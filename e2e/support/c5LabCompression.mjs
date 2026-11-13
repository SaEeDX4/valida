#!/usr/bin/env node
/**
 * C5 LAB-ONLY compression proxy (Doc 16 sections 157 and 268, Doc 17 sections 276-290).
 *
 *   node support/c5LabCompression.mjs --upstream http://127.0.0.1:4203 --host 127.0.0.1 --port 4204
 *
 * The C4 document server serves the build's files as they are. A production
 * host compresses text responses (Doc 16 section 268: verified at the host, in
 * C6). Throttled lab measurements against the uncompressed local server would
 * be charged for bytes no visitor downloads, so the C5 lab runs are made
 * against BOTH: the document server directly ("as served locally") and this
 * proxy ("lab compression"). This proxy:
 *
 *   - forwards GET and HEAD to the upstream unchanged (method, path, headers);
 *   - compresses a text response (HTML, JavaScript, CSS, JSON, SVG, XML,
 *     plain text) with Brotli or gzip when the request accepts it, sets
 *     Content-Encoding and Vary: Accept-Encoding, and drops Content-Length;
 *   - passes everything else (fonts, PNG, 304s, errors) through untouched,
 *     with every upstream header, Cache-Control included.
 *
 * --mode precompressed (default): the compressed bytes of an immutable response
 *   (Cache-Control: immutable, i.e. the fingerprinted /assets/ files) are kept
 *   and reused, as a host that serves precompressed or cached-compressed assets
 *   does. The first request for each asset pays the compression once; the C5
 *   setup makes that request before any measurement.
 * --mode on-demand: every response is compressed again on every request, as the
 *   first C5 runs did. Brotli quality 11 on the main script costs about 0.67 s
 *   of proxy CPU per request on the C5 machine, which those runs' LCP included.
 *
 * --experiment-preload-job-api <API origin> (EXPERIMENT, off by default; C5 LCP
 *   investigation): on /careers/<slug> and /careers/<slug>/apply documents it
 *   adds <link rel="preload" as="fetch" crossorigin="anonymous"> for that Job's
 *   API URL to the head, so the browser requests the Job while the script is
 *   still downloading. It measures a PROPOSED product change (the document
 *   server would emit this link); the product itself does not do this.
 *   Round 3: the product now writes the link itself (frontend/server/
 *   renderDocument.js jobApiPreloadTag). This experiment is kept as it ran. It
 *   rewrote ONLY status-200 documents (see below: a non-200 response is passed
 *   through untouched), so it never added the link to the missing-Job document:
 *   its "no improvement" there showed nothing about a preloaded 404.
 *
 * It is NOT the production host, proves nothing about the host's compression
 * or caching, and is never part of the product. It listens on 127.0.0.1 only
 * and prints "READY {json}" with the address it actually listens on.
 */
import { request as httpRequest, createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { constants, createBrotliCompress, createGzip } from 'node:zlib';

const { values } = parseArgs({
  options: { upstream: { type: 'string' }, host: { type: 'string', default: '127.0.0.1' }, port: { type: 'string' }, mode: { type: 'string', default: 'precompressed' }, 'experiment-preload-job-api': { type: 'string' } },
});
const upstream = new URL(values.upstream ?? '');
if (upstream.protocol !== 'http:' || upstream.hostname !== '127.0.0.1') {
  console.error('c5LabCompression: --upstream must be http://127.0.0.1:<port>');
  process.exit(2);
}
if (values.host !== '127.0.0.1') {
  console.error('c5LabCompression: --host must be 127.0.0.1');
  process.exit(2);
}

if (!['precompressed', 'on-demand'].includes(values.mode)) {
  console.error('c5LabCompression: --mode must be precompressed or on-demand');
  process.exit(2);
}
/** precompressed mode: path + encoding -> { headers, body } of an immutable response. */
const stored = new Map();

const TEXT = /^(text\/|application\/(javascript|json|xml|manifest\+json|ld\+json)|image\/svg\+xml)/i;

function chooseEncoding(acceptEncoding = '') {
  const accepted = acceptEncoding.toLowerCase();
  if (/\bbr\b/.test(accepted)) return 'br';
  if (/\bgzip\b/.test(accepted)) return 'gzip';
  return null;
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const wanted = chooseEncoding(req.headers['accept-encoding']);
  const hit = values.mode === 'precompressed' && req.method === 'GET' && wanted ? stored.get(`${wanted} ${req.url}`) : null;
  if (hit) {
    res.writeHead(200, { ...hit.headers, 'content-length': String(hit.body.length) });
    res.end(hit.body);
    return;
  }
  const headers = { ...req.headers, host: upstream.host };
  const forward = httpRequest(
    { hostname: upstream.hostname, port: upstream.port, path: req.url, method: req.method, headers },
    (up) => {
      const type = up.headers['content-type'] ?? '';
      const encoding = up.statusCode === 200 && req.method === 'GET' && !up.headers['content-encoding'] && TEXT.test(type)
        ? chooseEncoding(req.headers['accept-encoding'])
        : null;
      if (!encoding) {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
        return;
      }
      const jobRoute = values['experiment-preload-job-api'] && /^text\/html/i.test(type) ? /^\/careers\/([a-z0-9-]+)(?:\/apply)?(?:\?.*)?$/.exec(req.url) : null;
      const out = { ...up.headers, 'content-encoding': encoding, vary: up.headers.vary ? `${up.headers.vary}, Accept-Encoding` : 'Accept-Encoding' };
      delete out['content-length'];
      res.writeHead(up.statusCode, out);
      const compressor = encoding === 'br'
        ? createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })
        : createGzip({ level: 9 });
      const keep = values.mode === 'precompressed' && /\bimmutable\b/i.test(up.headers['cache-control'] ?? '');
      const chunks = [];
      compressor.on('data', (chunk) => { if (keep) chunks.push(chunk); });
      compressor.on('end', () => { if (keep) stored.set(`${encoding} ${req.url}`, { headers: out, body: Buffer.concat(chunks) }); });
      if (jobRoute) {
        const parts = [];
        up.on('data', (chunk) => parts.push(chunk));
        up.on('end', () => {
          const link = `<link rel="preload" as="fetch" crossorigin="anonymous" href="${values['experiment-preload-job-api']}/api/v1/jobs/${jobRoute[1]}">`;
          compressor.pipe(res);
          compressor.end(Buffer.concat(parts).toString('utf8').replace('</head>', `${link}</head>`));
        });
        return;
      }
      up.pipe(compressor).pipe(res);
    },
  );
  forward.on('error', () => {
    if (!res.headersSent) res.writeHead(502).end();
    else res.destroy();
  });
  req.pipe(forward);
});

server.listen(Number(values.port), values.host, () => {
  const address = server.address();
  process.stdout.write(`READY ${JSON.stringify({ address: address.address, family: address.family, port: address.port, upstream: upstream.origin, mode: values.mode, experimentPreloadJobApi: values['experiment-preload-job-api'] ?? null, labOnly: true })}\n`);
});
const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
