import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import util from 'node:util';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ConfigurationError, loadConfig } from '../src/config/env.js';
import { signRequest, EMPTY_PAYLOAD_SHA256, uriEncode } from '../src/integrations/storage/s3/sigv4.js';
import { parseListing, errorCodeOf } from '../src/integrations/storage/s3/s3Http.js';
import { S3PrivateStorage } from '../src/integrations/storage/s3PrivateStorage.js';
import { createPrivateStorage, PrivateStorageError, StorageInitializationError, STORAGE_FAILURE_REASONS } from '../src/integrations/storage/privateStorage.js';
import { OFFLINE_TEST_MONGODB_URI } from './helpers.js';
import { formatStartupFailure } from '../src/server.js';
import { syntheticPdf } from './fixtures/resumeFiles.js';
import { makeTestRoot, removeTestRoot } from './fixtures/uploadHarness.js';

/**
 * C6-T4 — the S3-compatible driver, OFFLINE (Node only): the signer against
 * AWS's published example, configuration validation, TLS verification, and
 * the classification of store answers against a small in-process S3 stand-in.
 * The driver against a real S3 implementation (the moto test double, with
 * signature checking) is tests/s3/ — `npm run test:s3`.
 */
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const SECRET = 'qa-unit-secret-0123456789abcdefgh';
const base = { NODE_ENV: 'test', APP_ENV: 'local', MONGODB_URI: OFFLINE_TEST_MONGODB_URI };
const s3 = (overrides = {}) => ({
  ...base,
  RESUME_STORAGE_DRIVER: 's3',
  RESUME_STORAGE_S3_ENDPOINT: 'https://storage.qa-valida.example.test',
  RESUME_STORAGE_S3_REGION: 'eu-central-1',
  RESUME_STORAGE_S3_BUCKET: 'qa-valida-resumes',
  RESUME_STORAGE_S3_ACCESS_KEY_ID: 'QAUNITKEYID0001',
  RESUME_STORAGE_S3_SECRET_ACCESS_KEY: SECRET,
  ...overrides,
});
const failureOf = (env) => {
  try {
    loadConfig(env);
  } catch (error) {
    return error;
  }
  return null;
};

describe('SigV4', () => {
  it("matches AWS's published S3 example (GET Object with a Range header)", () => {
    // AWS S3 API Reference, "Signature Calculations for the Authorization Header", example GET Object.
    const { signature } = signRequest({
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      headers: { range: 'bytes=0-9' },
      payloadSha256: EMPTY_PAYLOAD_SHA256,
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      date: new Date('2013-05-24T00:00:00Z'),
    });
    expect(signature).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });

  it('encodes as RFC 3986 requires (unreserved kept, the rest %XX, slashes only in keys)', () => {
    expect(uriEncode('a b/c~d*')).toBe('a%20b%2Fc~d%2A');
    expect(uriEncode('resumes/abc', { keepSlash: true })).toBe('resumes/abc');
  });
});

describe('configuration (RESUME_STORAGE_DRIVER=s3)', () => {
  it('a complete configuration is accepted; the credentials are in no serialised view', () => {
    const config = loadConfig(s3());
    expect(config.resumeStorage.driver).toBe('s3');
    expect(config.resumeStorage.s3).toMatchObject({ region: 'eu-central-1', bucket: 'qa-valida-resumes', urlStyle: 'path', timeoutMs: 15000 });
    expect(config.resumeStorage.s3.endpoint.href).toBe('https://storage.qa-valida.example.test/');
    for (const text of [JSON.stringify(config), util.inspect(config, { depth: 10 }), JSON.stringify(config.resumeStorage)]) {
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain('QAUNITKEYID0001');
    }
    expect(createPrivateStorage({ config })).toBeInstanceOf(S3PrivateStorage);
  });

  it.each([
    ['endpoint missing', { RESUME_STORAGE_S3_ENDPOINT: undefined }, 'RESUME_STORAGE_S3_ENDPOINT', /is required/],
    ['region missing', { RESUME_STORAGE_S3_REGION: undefined }, 'RESUME_STORAGE_S3_REGION', /is required/],
    ['bucket missing', { RESUME_STORAGE_S3_BUCKET: undefined }, 'RESUME_STORAGE_S3_BUCKET', /is required/],
    ['access key id missing', { RESUME_STORAGE_S3_ACCESS_KEY_ID: undefined }, 'RESUME_STORAGE_S3_ACCESS_KEY_ID', /is required/],
    ['secret missing', { RESUME_STORAGE_S3_SECRET_ACCESS_KEY: '' }, 'RESUME_STORAGE_S3_SECRET_ACCESS_KEY', /is required/],
    ['endpoint with credentials', { RESUME_STORAGE_S3_ENDPOINT: 'https://user:pass@storage.qa-valida.example.test' }, 'RESUME_STORAGE_S3_ENDPOINT', /origin only/],
    ['endpoint with a path', { RESUME_STORAGE_S3_ENDPOINT: 'https://storage.qa-valida.example.test/bucket' }, 'RESUME_STORAGE_S3_ENDPOINT', /origin only/],
    ['endpoint with a query', { RESUME_STORAGE_S3_ENDPOINT: 'https://storage.qa-valida.example.test/?x=1' }, 'RESUME_STORAGE_S3_ENDPOINT', /origin only/],
    ['not a URL', { RESUME_STORAGE_S3_ENDPOINT: 'storage.qa-valida.example.test' }, 'RESUME_STORAGE_S3_ENDPOINT', /origin only/],
    ['ftp', { RESUME_STORAGE_S3_ENDPOINT: 'ftp://storage.qa-valida.example.test' }, 'RESUME_STORAGE_S3_ENDPOINT', /origin only/],
    ['plain http to a remote host', { RESUME_STORAGE_S3_ENDPOINT: 'http://storage.qa-valida.example.test' }, 'RESUME_STORAGE_S3_ENDPOINT', /must use https/],
    ['a bucket name with capitals', { RESUME_STORAGE_S3_BUCKET: 'QA-Resumes' }, 'RESUME_STORAGE_S3_BUCKET', /bucket name/],
    ['a bucket name with ..', { RESUME_STORAGE_S3_BUCKET: 'qa..resumes' }, 'RESUME_STORAGE_S3_BUCKET', /bucket name/],
    ['a region with spaces', { RESUME_STORAGE_S3_REGION: 'eu central' }, 'RESUME_STORAGE_S3_REGION', /region name/],
    ['a short secret', { RESUME_STORAGE_S3_SECRET_ACCESS_KEY: 'short-secret' }, 'RESUME_STORAGE_S3_SECRET_ACCESS_KEY', /16-256/],
    ['a secret with a space', { RESUME_STORAGE_S3_SECRET_ACCESS_KEY: 'qa secret 0123456789abcdef' }, 'RESUME_STORAGE_S3_SECRET_ACCESS_KEY', /16-256/],
    ['an unknown URL style', { RESUME_STORAGE_S3_URL_STYLE: 'host' }, 'RESUME_STORAGE_S3_URL_STYLE', /path/],
    ['a timeout out of range', { RESUME_STORAGE_S3_TIMEOUT_MS: '500' }, 'RESUME_STORAGE_S3_TIMEOUT_MS', /1000 to 120000/],
  ])('refused at start-up: %s (names the variable, never the value)', (_label, change, variable, rule) => {
    const env = s3(change);
    for (const [k, v] of Object.entries(change)) if (v === undefined) delete env[k];
    const error = failureOf(env);
    expect(error).toBeInstanceOf(ConfigurationError);
    const issue = error.issues.find((i) => i.variable === variable);
    expect(issue.rule).toMatch(rule);
    expect(error.message).not.toContain(SECRET);
    expect(error.message).not.toMatch(/user:pass|short-secret|QA-Resumes/);
  });

  it.each([
    ['review', { APP_ENV: 'review', NODE_ENV: 'production' }],
    ['production', { APP_ENV: 'production', NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://qa-valida.example.test', SITE_ACCESS: 'public' }],
    ['local with NODE_ENV=production', { NODE_ENV: 'production' }],
  ])('plain http to a LOOPBACK endpoint is refused under %s: hosted storage always uses TLS (Doc 13 s111)', (_label, change) => {
    const env = s3({ RESUME_STORAGE_S3_ENDPOINT: 'http://127.0.0.1:9000', ...change });
    if (change.APP_ENV === 'review') Object.assign(env, { SITE_ACCESS: 'private', ACCESS_ALLOWLIST: '203.0.113.0/24', CORS_ALLOWED_ORIGINS: 'https://review.qa-valida.example.test' });
    const error = failureOf(env);
    expect(error.issues.map((i) => i.variable)).toContain('RESUME_STORAGE_S3_ENDPOINT');
  });

  it('https in review and production is accepted (the local driver is not)', () => {
    const review = loadConfig(s3({ APP_ENV: 'review', NODE_ENV: 'production', SITE_ACCESS: 'private', ACCESS_ALLOWLIST: '203.0.113.0/24', CORS_ALLOWED_ORIGINS: 'https://review.qa-valida.example.test' }));
    expect(review.resumeStorage.driver).toBe('s3');
    const production = loadConfig(s3({ APP_ENV: 'production', NODE_ENV: 'production', SITE_ACCESS: 'public', CORS_ALLOWED_ORIGINS: 'https://qa-valida.example.test' }));
    expect(production.resumeStorage.driver).toBe('s3');
  });

  it('plain http to loopback is accepted only for a local run (the test double)', () => {
    expect(loadConfig(s3({ RESUME_STORAGE_S3_ENDPOINT: 'http://127.0.0.1:9000' })).resumeStorage.s3.endpoint.protocol).toBe('http:');
  });

  it('S3 settings without the driver are refused: never a silent fallback to disk', () => {
    const env = s3({ RESUME_STORAGE_DRIVER: 'local', RESUME_STORAGE_LOCAL_ROOT: path.join(os.tmpdir(), 'valida-qa-unused-root') });
    const error = failureOf(env);
    expect(error.issues.filter((i) => i.variable.startsWith('RESUME_STORAGE_S3_')).map((i) => i.rule)).toEqual(Array(5).fill(expect.stringMatching(/is not "s3"/)));
  });

  it('the new failure reasons are part of the fixed table', () => {
    for (const reason of ['UNAVAILABLE', 'OUTCOME_UNKNOWN', 'TLS_FAILURE', 'BUCKET_NOT_FOUND', 'PUBLIC_ACCESS', 'PROVIDER_ERROR']) expect(STORAGE_FAILURE_REASONS).toContain(reason);
  });
});

describe('answers from the store (an in-process S3 stand-in)', () => {
  let server;
  let handler;
  let requests = [];
  let root;
  let source;
  let pdf;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requests.push({ method: req.method, url: req.url });
      handler(req, res);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));
  afterEach(() => {
    requests = [];
    if (root) removeTestRoot(root);
    root = undefined;
  });
  const storage = (overrides = {}) => {
    root = makeTestRoot();
    pdf = syntheticPdf();
    source = path.join(root, 'validated.part');
    fs.writeFileSync(source, pdf);
    return createPrivateStorage({ config: loadConfig(s3({ RESUME_STORAGE_S3_ENDPOINT: `http://127.0.0.1:${server.address().port}`, RESUME_STORAGE_S3_TIMEOUT_MS: '1000', ...overrides })) });
  };
  const answer = (res, status, code, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/xml', ...headers });
    res.end(code ? `<Error><Code>${code}</Code></Error>` : '');
  };
  /** A well-behaved store, with per-test overrides of one operation. */
  const store = (overrides = {}) => {
    const objects = new Map();
    handler = (req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const key = req.url;
        const custom = overrides[req.method]?.(req, res, Buffer.concat(chunks), objects);
        if (custom) return;
        if (req.method === 'PUT') {
          objects.set(key, { body: Buffer.concat(chunks), sha: req.headers['x-amz-meta-sha256'] });
          return answer(res, 200);
        }
        if (req.method === 'HEAD') {
          const object = objects.get(key);
          if (!object) return answer(res, 404);
          res.writeHead(200, { 'content-length': object.body.length, 'x-amz-meta-sha256': object.sha });
          return res.end();
        }
        if (req.method === 'GET') return answer(res, 403, 'AccessDenied');
        if (req.method === 'DELETE') {
          objects.delete(key);
          return answer(res, 204);
        }
        return answer(res, 400, 'Unexpected');
      });
    };
    return objects;
  };
  const req = () => ({ filePath: source, sizeBytes: pdf.length, checksumSha256: sha256(pdf) });
  const reasonOf = async (promise) => {
    try {
      await promise;
    } catch (error) {
      return error.reason;
    }
    return 'RESOLVED';
  };

  it.each([
    ['403 AccessDenied', 403, 'AccessDenied', 'PERMISSION_DENIED'],
    ['404 NoSuchBucket', 404, 'NoSuchBucket', 'BUCKET_NOT_FOUND'],
    ['400 InvalidArgument', 400, 'InvalidArgument', 'PROVIDER_ERROR'],
    ['503 SlowDown', 503, 'SlowDown', 'UNAVAILABLE'],
  ])('init refused by the store: %s -> %s', async (_label, status, code, reason) => {
    store({ PUT: (_q, res) => (answer(res, status, code), true) });
    const s = storage();
    const error = await s.init().catch((e) => e);
    expect(error).toBeInstanceOf(StorageInitializationError);
    expect(error.reason).toBe(reason);
    expect(s.isReady).toBe(false);
  });

  it('a store answer 400 BadDigest to a résumé PUT is INTEGRITY_MISMATCH', async () => {
    const objects = store();
    const s = storage();
    await s.init();
    store({ PUT: (_q, res) => (answer(res, 400, 'BadDigest'), true) });
    expect(await reasonOf(s.storePrivateResume(req()))).toBe('INTEGRITY_MISMATCH');
    expect(objects.size).toBe(0);
  });

  it('a store that keeps a different length than it acknowledged: INTEGRITY_MISMATCH, and the driver deletes ITS OWN object', async () => {
    const s = storage();
    store();
    await s.init();
    const objects = store({
      PUT: (q, res, body, map) => {
        map.set(q.url, { body: body.subarray(1), sha: q.headers['x-amz-meta-sha256'] });
        answer(res, 200);
        return true;
      },
    });
    expect(await reasonOf(s.storePrivateResume(req()))).toBe('INTEGRITY_MISMATCH');
    const methods = requests.map((r) => r.method);
    expect(methods.slice(-3)).toEqual(['PUT', 'HEAD', 'DELETE']);
    expect(new Set(requests.slice(-3).map((r) => r.url)).size).toBe(1);
    expect(objects.size).toBe(0);
  });

  it('a hanging store: the PUT times out (uncertain), the HEAD resolves it as absent -> UNAVAILABLE', async () => {
    const s = storage();
    store();
    await s.init();
    store({ PUT: () => true });
    expect(await reasonOf(s.storePrivateResume(req()))).toBe('UNAVAILABLE');
  });

  it('every failure message is fixed text: no endpoint, bucket, key or credential', async () => {
    store({ PUT: (_q, res) => (answer(res, 403, 'AccessDenied'), true) });
    const s = storage();
    const error = await s.init().catch((e) => e);
    expect(error.message).toBe('private storage initialisation failed: PERMISSION_DENIED');
    expect(util.inspect(s)).not.toMatch(/qa-valida-resumes|127\.0\.0\.1|qa-unit-secret|QAUNITKEYID/);
  });

  it('an invalid driver configuration object is refused by the constructor', () => {
    expect(() => new S3PrivateStorage({ s3: { endpoint: 'not-a-url' } })).toThrow(StorageInitializationError);
  });
});

describe('TLS: an endpoint whose certificate is not trusted is refused, and nothing is sent', () => {
  let server;
  let dir;
  let received = 0;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'valida-c6t4-tls-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], { stdio: 'ignore' });
    server = https.createServer({ key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) }, (_req, res) => {
      received += 1;
      res.writeHead(200);
      res.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a self-signed certificate: init fails with TLS_FAILURE; the server never receives a request', async () => {
    const config = loadConfig(s3({ RESUME_STORAGE_S3_ENDPOINT: `https://127.0.0.1:${server.address().port}` }));
    const storage = createPrivateStorage({ config });
    const error = await storage.init().catch((e) => e);
    expect(error).toBeInstanceOf(StorageInitializationError);
    expect(error.reason).toBe('TLS_FAILURE');
    expect(received).toBe(0);
    expect(storage.isReady).toBe(false);
    // The start-up message gives the S3 advice, never the local-directory advice, and no endpoint.
    expect(error.driver).toBe('s3');
    const message = formatStartupFailure(error);
    expect(message).toContain('(TLS_FAILURE)');
    expect(message).toContain('RESUME_STORAGE_S3_ENDPOINT');
    expect(message).toContain('no fallback to local storage');
    expect(message).not.toContain('RESUME_STORAGE_LOCAL_ROOT');
    expect(message).not.toContain(String(server.address().port));
  });
});

describe('listing and error documents are parsed safely', () => {
  it('parses ListObjectsV2, entities and continuation', () => {
    const xml = '<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>a&amp;b</NextContinuationToken><Contents><Key>resumes/x&lt;y</Key><Size>12</Size><LastModified>2026-11-16T00:00:00.000Z</LastModified></Contents></ListBucketResult>';
    expect(parseListing(xml)).toEqual({ entries: [{ key: 'resumes/x<y', size: 12, lastModified: new Date('2026-11-16T00:00:00.000Z') }], truncated: true, nextToken: 'a&b' });
    expect(errorCodeOf('<Error><Code>NoSuchKey</Code></Error>')).toBe('NoSuchKey');
    expect(errorCodeOf('<Error><Code>bad code with spaces</Code></Error>')).toBeNull();
  });
});
