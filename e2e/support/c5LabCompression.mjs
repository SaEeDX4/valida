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
 * It is NOT the production host, proves nothing about the host's compression
 * or caching, and is never part of the product. It listens on 127.0.0.1 only
 * and prints "READY {json}" with the address it actually listens on.
 */
import { request as httpRequest, createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { constants, createBrotliCompress, createGzip } from 'node:zlib';

const { values } = parseArgs({
  options: { upstream: { type: 'string' }, host: { type: 'string', default: '127.0.0.1' }, port: { type: 'string' } },
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
      const out = { ...up.headers, 'content-encoding': encoding, vary: up.headers.vary ? `${up.headers.vary}, Accept-Encoding` : 'Accept-Encoding' };
      delete out['content-length'];
      res.writeHead(up.statusCode, out);
      const compressor = encoding === 'br'
        ? createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })
        : createGzip({ level: 9 });
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
  process.stdout.write(`READY ${JSON.stringify({ address: address.address, family: address.family, port: address.port, upstream: upstream.origin, labOnly: true })}\n`);
});
const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
