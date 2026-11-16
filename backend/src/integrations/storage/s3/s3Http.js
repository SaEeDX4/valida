import http from 'node:http';
import https from 'node:https';
import { canonicalQueryString, signRequest, uriEncode, EMPTY_PAYLOAD_SHA256 } from './sigv4.js';

/**
 * One signed request to an S3-compatible endpoint — C6-T4.
 *
 * Exactly one attempt, never a retry, with a timeout on the whole exchange.
 * For a request with a body, the outcome is classified so the caller can
 * tell "nothing was sent" from "it may have been written":
 *
 *   { kind: 'response', status, headers, body, overflow } an answer arrived
 *   { kind: 'not-sent', code }                        no connection was established
 *                                                     (refused, unresolved, TLS failed):
 *                                                     the request cannot have taken effect
 *   { kind: 'uncertain', code }                       connected, then lost (reset, timeout,
 *                                                     malformed answer): it MAY have taken effect
 *
 * TLS: https uses Node's default verification against the system CA store.
 * There is no option to disable it. Plain http is accepted only for a
 * loopback endpoint in a local run (config/env.js enforces that rule).
 *
 * The response body is read up to `maxBody` bytes (an error document or a
 * listing); an object's content is never read by this driver.
 */

/** Error codes that mean the TCP or TLS connection was never established. */
const NOT_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL', 'ERR_INVALID_URL']);

export function isTlsError(code) {
  return (
    typeof code === 'string' &&
    (code.startsWith('ERR_TLS') ||
      code.startsWith('ERR_SSL') ||
      /CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)|DEPTH_ZERO|HOSTNAME|ALTNAME/.test(code))
  );
}

/**
 * @param {object} endpoint  { url: URL, region, bucket, urlStyle, accessKeyId, secretAccessKey, timeoutMs }
 * @param {object} request   { method, key?, query?, headers?, body?: Readable, contentLength?, payloadSha256?, anonymous?, maxBody? }
 */
export function s3Request(endpoint, { method, key = null, query = {}, headers = {}, body = null, contentLength = 0, payloadSha256 = EMPTY_PAYLOAD_SHA256, anonymous = false, maxBody = 1024 * 1024 }) {
  const { url, bucket, urlStyle } = endpoint;
  const virtual = urlStyle === 'virtual';
  const hostname = virtual ? `${bucket}.${url.hostname}` : url.hostname;
  const host = url.port ? `${hostname}:${url.port}` : hostname;
  const objectPath = key === null ? '' : `/${uriEncode(key, { keepSlash: true })}`;
  const path = virtual ? objectPath || '/' : `/${uriEncode(bucket)}${objectPath}`;
  // The query is sent exactly as it is signed.
  const search = Object.keys(query).length ? `?${canonicalQueryString(query)}` : '';

  const baseHeaders = { ...headers, 'content-length': String(contentLength) };
  const finalHeaders = anonymous
    ? { ...baseHeaders, host }
    : signRequest({ method, host, path, query, headers: baseHeaders, payloadSha256, region: endpoint.region, accessKeyId: endpoint.accessKeyId, secretAccessKey: endpoint.secretAccessKey }).headers;

  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    let settled = false;
    let connected = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        servername: virtual ? hostname : url.hostname,
        method,
        path: `${path}${search}`,
        headers: finalHeaders,
        agent: false,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size <= maxBody) chunks.push(chunk);
        });
        res.on('end', () => {
          const bytes = Buffer.concat(chunks);
          // `overflow`: the answer was longer than maxBody and was cut; a caller that
          // needs the whole document (a listing) must treat it as invalid.
          settle({ kind: 'response', status: res.statusCode, headers: res.headers, body: bytes.toString('utf8'), bytes, overflow: size > maxBody });
        });
        res.on('error', () => settle({ kind: connected ? 'uncertain' : 'not-sent', code: 'RESPONSE_ABORTED' }));
      },
    );
    const timer = setTimeout(() => {
      settle({ kind: connected ? 'uncertain' : 'not-sent', code: 'TIMEOUT' });
      req.destroy();
    }, endpoint.timeoutMs);
    req.on('socket', (socket) => {
      const mark = () => {
        connected = true;
      };
      if (url.protocol === 'https:') socket.once('secureConnect', mark);
      else socket.once('connect', mark);
    });
    req.on('error', (error) => {
      const code = typeof error?.code === 'string' ? error.code : 'UNKNOWN';
      if (!connected && (NOT_SENT_CODES.has(code) || isTlsError(code))) settle({ kind: 'not-sent', code });
      else settle({ kind: connected ? 'uncertain' : 'not-sent', code });
    });
    if (body) {
      body.on('error', (error) => {
        settle({ kind: connected ? 'uncertain' : 'not-sent', code: error?.reason ?? error?.code ?? 'SOURCE_ERROR' });
        req.destroy();
      });
      body.pipe(req);
    } else {
      req.end();
    }
  });
}

/** The S3 error code in an XML error document, or null. */
export function errorCodeOf(xml) {
  const match = /<Code>([A-Za-z0-9.]{1,64})<\/Code>/.exec(xml ?? '');
  return match ? match[1] : null;
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const decode = (text) => text.replace(/&(amp|lt|gt|quot|apos);/g, (entity) => ENTITIES[entity]);

/** Parses a ListObjectsV2 answer: { entries: [{ key, size, lastModified }], truncated, nextToken }. */
export function parseListing(xml) {
  const entries = [];
  for (const block of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(block[1]);
    const size = /<Size>(\d+)<\/Size>/.exec(block[1]);
    const modified = /<LastModified>([^<]+)<\/LastModified>/.exec(block[1]);
    entries.push({ key: key ? decode(key[1]) : null, size: size ? Number(size[1]) : null, lastModified: modified ? new Date(modified[1]) : null });
  }
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml);
  return { entries, truncated, nextToken: token ? decode(token[1]) : null };
}

/**
 * C6-T4 correction 1, finding 3 — a STRICT ListObjectsV2 page, for the only
 * caller that acts on a listing (orphan reconciliation). Returns
 *   { ok: true, entries: [{ key, size, lastModified }], truncated, nextToken }
 * or { ok: false, why } — never a partial or guessed listing. The document
 * must be one ListBucketResult with exactly one Name (the bucket), Prefix
 * (the requested prefix), KeyCount (the number of entries), MaxKeys (at most
 * the requested page size, and not fewer than the entries) and IsTruncated
 * ('true' or 'false'); a truncated page must carry a NextContinuationToken;
 * an echoed ContinuationToken must be the one sent; every entry must have
 * exactly one Key under the prefix, one Size and one valid LastModified; no
 * CommonPrefixes and no EncodingType (neither is requested). `why` is a fixed
 * label for tests and operator logs; it never contains document text.
 */
export function parseListObjectsV2(xml, { bucket, prefix, pageSize, continuationToken = null }) {
  const fail = (why) => ({ ok: false, why });
  if (typeof xml !== 'string') return fail('NOT_A_DOCUMENT');
  const doc = xml.trim().replace(/^<\?xml[^>]*\?>\s*/, '');
  const root = /^<ListBucketResult(?:\s+xmlns="[^"]*")?\s*>([\s\S]*)<\/ListBucketResult>$/.exec(doc);
  if (!root) return fail('NOT_A_LISTING');
  const inner = root[1];
  if (/<ListBucketResult[\s>]/.test(inner)) return fail('NOT_A_LISTING');
  const opens = (inner.match(/<Contents>/g) ?? []).length;
  const closes = (inner.match(/<\/Contents>/g) ?? []).length;
  const blocks = [...inner.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => m[1]);
  if (opens !== closes || blocks.length !== opens) return fail('MALFORMED_ENTRY');
  const top = inner.replace(/<Contents>[\s\S]*?<\/Contents>/g, '');
  const one = (name) => {
    const found = [...top.matchAll(new RegExp(`<${name}>([^<]*)</${name}>|<${name}\\s*/>`, 'g'))];
    return found.length === 1 ? decode(found[0][1] ?? '') : found.length === 0 ? undefined : null;
  };
  if (/<CommonPrefixes[\s>]/.test(top) || /<EncodingType[\s>]/.test(top)) return fail('UNREQUESTED_ELEMENT');
  const name = one('Name');
  if (name !== bucket) return fail('WRONG_BUCKET');
  if (one('Prefix') !== prefix) return fail('WRONG_PREFIX');
  const truncatedText = one('IsTruncated');
  if (truncatedText !== 'true' && truncatedText !== 'false') return fail('NO_TRUNCATION_STATE');
  const truncated = truncatedText === 'true';
  const keyCount = one('KeyCount');
  if (typeof keyCount !== 'string' || !/^\d+$/.test(keyCount) || Number(keyCount) !== blocks.length) return fail('KEY_COUNT_MISMATCH');
  const maxKeys = one('MaxKeys');
  if (typeof maxKeys !== 'string' || !/^\d+$/.test(maxKeys) || Number(maxKeys) > pageSize || blocks.length > Number(maxKeys)) return fail('OVER_PAGE_LIMIT');
  const echoed = one('ContinuationToken');
  if (echoed === null || (echoed !== undefined && echoed !== continuationToken)) return fail('WRONG_CONTINUATION');
  const next = one('NextContinuationToken');
  if (next === null) return fail('MALFORMED_TOKEN');
  if (truncated && !next) return fail('TRUNCATED_WITHOUT_TOKEN');
  const entries = [];
  for (const block of blocks) {
    const keys = [...block.matchAll(/<Key>([^<]*)<\/Key>/g)];
    const sizes = [...block.matchAll(/<Size>([^<]*)<\/Size>/g)];
    const dates = [...block.matchAll(/<LastModified>([^<]*)<\/LastModified>/g)];
    if (keys.length !== 1 || sizes.length !== 1 || dates.length !== 1) return fail('MALFORMED_ENTRY');
    const key = decode(keys[0][1]);
    if (!key.startsWith(prefix)) return fail('ENTRY_OUTSIDE_PREFIX');
    if (!/^\d+$/.test(sizes[0][1]) || !Number.isSafeInteger(Number(sizes[0][1]))) return fail('MALFORMED_ENTRY');
    const lastModified = new Date(dates[0][1]);
    if (Number.isNaN(lastModified.getTime())) return fail('MALFORMED_ENTRY');
    entries.push({ key, size: Number(sizes[0][1]), lastModified });
  }
  return { ok: true, entries, truncated, nextToken: truncated ? next : null };
}
