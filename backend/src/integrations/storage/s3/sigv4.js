import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4 for the S3 API — C6-T4.
 *
 * Written here rather than taken from an SDK so that the S3-compatible driver
 * (s3PrivateStorage.js) controls every request exactly: one attempt, an
 * explicit timeout, no hidden retry. A hidden retry of a conditional PUT
 * would turn "the first attempt succeeded but its answer was lost" into a
 * 412 that looks like a key collision.
 *
 * The algorithm (AWS "Signature Version 4 signing process"):
 *
 *   CanonicalRequest = Method \n CanonicalURI \n CanonicalQuery \n
 *                      CanonicalHeaders \n SignedHeaders \n PayloadHash
 *   StringToSign     = "AWS4-HMAC-SHA256" \n AmzDate \n Scope \n hex(SHA256(CanonicalRequest))
 *   Scope            = YYYYMMDD/region/s3/aws4_request
 *   SigningKey       = HMAC(HMAC(HMAC(HMAC("AWS4"+secret, date), region), "s3"), "aws4_request")
 *
 * Verified by tests against AWS's published S3 example and, independently,
 * against botocore's signer and moto's signature check (tests/s3/).
 * Nothing here logs; the secret never leaves this module's arguments.
 */

export const EMPTY_PAYLOAD_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const sha256Hex = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value, 'utf8').digest();

/** RFC 3986 encoding as SigV4 requires: unreserved characters stay; everything else is %XX (uppercase). */
export function uriEncode(value, { keepSlash = false } = {}) {
  let out = '';
  for (const byte of Buffer.from(String(value), 'utf8')) {
    const char = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-._~]/.test(char) || (keepSlash && char === '/')) out += char;
    else out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

export function canonicalQueryString(query = {}) {
  return Object.entries(query)
    .map(([key, value]) => [uriEncode(key), uriEncode(value ?? '')])
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

export function toAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

/**
 * Signs one request. Returns the headers to send (the given headers, plus
 * x-amz-date, x-amz-content-sha256 and Authorization).
 *
 * @param {object} input
 * @param {string} input.method
 * @param {string} input.host           Host header value (host[:port])
 * @param {string} input.path           the canonical URI, already encoded (keepSlash)
 * @param {object} [input.query]        raw query parameters
 * @param {object} [input.headers]      headers to sign (names any case)
 * @param {string} [input.payloadSha256] hex SHA-256 of the body; empty body by default
 * @param {string} input.region
 * @param {string} input.accessKeyId
 * @param {string} input.secretAccessKey
 * @param {Date} [input.date]
 */
export function signRequest({ method, host, path, query = {}, headers = {}, payloadSha256 = EMPTY_PAYLOAD_SHA256, region, accessKeyId, secretAccessKey, date = new Date() }) {
  const amzDate = toAmzDate(date);
  const day = amzDate.slice(0, 8);
  const all = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)])), host, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadSha256 };
  const names = Object.keys(all).sort();
  const canonicalHeaders = names.map((name) => `${name}:${all[name].trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, path, canonicalQueryString(query), canonicalHeaders, signedHeaders, payloadSha256].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  return {
    headers: { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` },
    signature,
    canonicalRequest,
    stringToSign,
  };
}
