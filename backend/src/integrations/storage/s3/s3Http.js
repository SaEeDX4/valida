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
 *   { kind: 'response', status, headers, body }      an answer arrived
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
          settle({ kind: 'response', status: res.statusCode, headers: res.headers, body: bytes.toString('utf8'), bytes });
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
