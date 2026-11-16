#!/usr/bin/env node
/**
 * C6-T4 — S3-compatible private résumé storage, checked on the ACTUAL local stack.
 *
 *   MONGODB_TEST_URI=mongodb://127.0.0.1:27017/valida_test_c6t4 \
 *   VALIDA_TEST_MOTO_PYTHON=<python with moto[server]> \
 *     node c6/c6-t4-stack.mjs --label final --out <evidence directory>
 *
 * WHAT RUNS
 *   - the real backend (`backend/src/server.js` through e2e/support/backendLauncher.mjs)
 *     with RESUME_STORAGE_DRIVER=s3, against a disposable MongoDB database;
 *   - the local S3-compatible test double: moto's server (signature-checked,
 *     authorised by a scoped policy after set-up), behind a fault-injecting
 *     proxy the run controls (backend/tests/s3/faultProxy.js);
 *   - the local SMTP test server of the C3 suite, so readiness can be fully
 *     ready and every notification is observable;
 *   - the real provisioning CLI (Jobs) and the real reconciliation CLI
 *     (`scripts/storage-reconcile.mjs`, npm run ops:storage:reconcile);
 *   - an INDEPENDENT reader of the double (botocore, in the double's Python)
 *     for byte-for-byte checks — never the driver under test.
 *
 * EVIDENCE HYGIENE. No storage key, credential, endpoint secret or applicant
 * field is written to the evidence: objects are named by their one-way
 * reference (storageObjectRef), bytes by their SHA-256. Synthetic data only.
 *
 * WHAT IT DOES NOT SHOW. A real provider: its access policy, encryption at
 * rest, region or jurisdiction, durability and restore. Those are hosted
 * verification (C6 plan sections 3.4 and 5).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import net from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { checkTestDatabaseTarget } from '../../backend/scripts/test-database.mjs';
import { syntheticPdf } from '../../backend/tests/fixtures/resumeFiles.js';
import { startMoto } from '../../backend/tests/s3/motoServer.js';
import { startFaultProxy } from '../../backend/tests/s3/faultProxy.js';
import { storageObjectRef } from '../../backend/src/integrations/storage/storageContract.js';
import { BACKEND_DIR, FIXTURES_DIR } from '../support/paths.js';
import { baseEnvironment, runNode, startNode, stopChild, waitForReadyLine } from '../support/processes.js';

const { values: args } = parseArgs({ options: { label: { type: 'string', default: 'run' }, out: { type: 'string' } } });
const OUT = path.resolve(args.out ?? path.join(os.tmpdir(), `valida-c6-t4-${args.label}`));
for (const dir of ['http', 'logs', 'startup', 'smtp']) mkdirSync(path.join(OUT, dir), { recursive: true });

const guard = checkTestDatabaseTarget({ env: process.env, dotEnvPath: null });
if (!guard.ok) {
  console.error(`refused: ${guard.reason}`);
  process.exit(2);
}
const PYTHON = process.env.VALIDA_TEST_MOTO_PYTHON;
if (!PYTHON) {
  console.error('refused: VALIDA_TEST_MOTO_PYTHON is not set');
  process.exit(2);
}
const MONGODB_URI = guard.uri;
const API_PORT = Number(process.env.C6T4_BASE_PORT ?? 4380);
const API = `http://127.0.0.1:${API_PORT}`;
const SLUG = 'qa-c4-open-remote';
const SMTP_PASSWORD = `qa-${randomBytes(12).toString('hex')}`;
const IDENTITY = { user: 'careers-qa@valida-e2e.example.test', internal: 'recruitment-qa@valida-e2e.example.test' };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const secrets = [];
const sanitise = (text) => {
  let out = String(text);
  for (const secret of secrets) if (secret) out = out.split(secret).join('[REDACTED]');
  return out;
};
const results = [];
function check(id, area, description, expected, actual, pass) {
  results.push({ id, area, description, expected, actual: sanitise(typeof actual === 'string' ? actual : JSON.stringify(actual)), pass: Boolean(pass) });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${description}\n`);
}

/* ------------------------------------------------------------------ http -- */

let exchangeCount = 0;
function exchange(name, { method = 'GET', target, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: API_PORT, method, path: target, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        exchangeCount += 1;
        const file = `${String(exchangeCount).padStart(3, '0')}-${name}.txt`;
        const shownHeaders = Object.entries(headers).filter(([k]) => k !== 'content-type').map(([k, v]) => `${k}: ${v}`);
        writeFileSync(
          path.join(OUT, 'http', file),
          sanitise(`# ${name}\n\n${method} ${target} HTTP/1.1\n${shownHeaders.join('\n')}${body ? `\n[multipart body: ${body.length} bytes; synthetic résumé SHA-256 ${pdfSha}]` : ''}\n\n` +
            `HTTP/1.1 ${res.statusCode}\n${Object.entries(res.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${text}\n`),
        );
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: text, json, file });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const pdf = syntheticPdf({ text: 'QA TEST DOCUMENT C6-T4 stack - NOT A REAL CANDIDATE' });
const pdfSha = sha256(pdf);
function applyBody() {
  const boundary = `----qa${randomBytes(8).toString('hex')}`;
  const parts = [
    ['fullName', 'QA Synthetic Applicant C6T4'],
    ['email', 'qa+c6t4@valida-e2e.example.test'],
    ['screeningAnswers', '[]'],
  ].map(([n, v]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`));
  const body = Buffer.concat([...parts, Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="resume"; filename="qa-c6t4.pdf"\r\nContent-Type: application/pdf\r\n\r\n`), pdf, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
const apply = (name, key = randomUUID()) => {
  const { body, contentType } = applyBody();
  return exchange(name, { method: 'POST', target: `/api/v1/jobs/${SLUG}/applications`, headers: { 'content-type': contentType, 'content-length': String(body.length), 'idempotency-key': key }, body });
};
/** Nothing private in a public response: no key, provider name, credential or endpoint. */
const exposes = (response, keys) => {
  const text = response.body + JSON.stringify(response.headers);
  return keys.some((k) => text.includes(k)) || /S3_COMPATIBLE|LOCAL_DEVELOPMENT|resumes\/[0-9a-f]{32}/.test(text) || secrets.some((s) => s && text.includes(s));
};

/* ----------------------------------------------------- the independent reader -- */

let moto;
function readStore() {
  const script = `
import sys, json, hashlib, boto3
e, b, k, s = sys.argv[1:5]
c = boto3.client('s3', endpoint_url=e, region_name='us-east-1', aws_access_key_id=k, aws_secret_access_key=s)
out = []
for o in c.list_objects_v2(Bucket=b, Prefix='resumes/').get('Contents', []):
    body = c.get_object(Bucket=b, Key=o['Key'])['Body'].read()
    head = c.head_object(Bucket=b, Key=o['Key'])
    ref = hashlib.sha256(('valida:storage-object-ref:v1:' + o['Key']).encode()).hexdigest()[:32]
    out.append({'ref': ref, 'size': len(body), 'sha256': hashlib.sha256(body).hexdigest(), 'metaSha256': head.get('Metadata', {}).get('sha256'), 'contentLength': head['ContentLength']})
print(json.dumps(sorted(out, key=lambda x: x['ref'])))
`;
  return JSON.parse(execFileSync(PYTHON, ['-c', script, moto.endpoint, moto.bucket, moto.app.accessKeyId, moto.app.secretAccessKey], { encoding: 'utf8' }));
}
function anonymousRead(ref) {
  // An anonymous GET of a stored object (by key, resolved here from the listing; never written to evidence).
  const script = `
import sys, boto3, urllib.request, urllib.error, hashlib
e, b, k, s, ref = sys.argv[1:6]
c = boto3.client('s3', endpoint_url=e, region_name='us-east-1', aws_access_key_id=k, aws_secret_access_key=s)
key = next(o['Key'] for o in c.list_objects_v2(Bucket=b, Prefix='resumes/')['Contents'] if hashlib.sha256(('valida:storage-object-ref:v1:' + o['Key']).encode()).hexdigest()[:32] == ref)
try:
    urllib.request.urlopen(e + '/' + b + '/' + key); print(200)
except urllib.error.HTTPError as err:
    print(err.code)
`;
  return Number(execFileSync(PYTHON, ['-c', script, moto.endpoint, moto.bucket, moto.app.accessKeyId, moto.app.secretAccessKey, ref], { encoding: 'utf8' }).trim());
}

/* ----------------------------------------------------------------- processes -- */

const children = new Set();
const launcher = fileURLToPath(new URL('../support/backendLauncher.mjs', import.meta.url));
let smtp;
let smtpDir;
function backendEnv(endpoint, extra = {}) {
  return {
    ...baseEnvironment(),
    NODE_ENV: 'development',
    APP_ENV: 'local',
    PORT: String(API_PORT),
    LOG_LEVEL: 'info',
    TRUST_PROXY: 'false',
    MONGODB_URI,
    CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
    RECRUITMENT_MODE: 'testers',
    ACCESS_ALLOWLIST: '127.0.0.1/32',
    APPLICATION_RATE_LIMIT_MAX: '100',
    RESUME_STORAGE_DRIVER: 's3',
    RESUME_STORAGE_S3_ENDPOINT: endpoint,
    RESUME_STORAGE_S3_REGION: 'us-east-1',
    RESUME_STORAGE_S3_BUCKET: moto.bucket,
    RESUME_STORAGE_S3_ACCESS_KEY_ID: moto.app.accessKeyId,
    RESUME_STORAGE_S3_SECRET_ACCESS_KEY: moto.app.secretAccessKey,
    RESUME_STORAGE_S3_TIMEOUT_MS: '3000',
    TRANSACTIONAL_EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'localhost',
    SMTP_PORT: String(smtp.port),
    SMTP_SECURITY: 'implicit-tls',
    SMTP_USERNAME: IDENTITY.user,
    SMTP_PASSWORD,
    TRANSACTIONAL_FROM_ADDRESS: IDENTITY.user,
    TRANSACTIONAL_REPLY_TO: 'careers-reply-qa@valida-e2e.example.test',
    RECRUITMENT_NOTIFICATION_RECIPIENT: IDENTITY.internal,
    APPLICATION_ACKNOWLEDGEMENT_ENABLED: 'false',
    EMAIL_RECIPIENT_ALLOWLIST: '@valida-e2e.example.test',
    NODE_EXTRA_CA_CERTS: path.join(smtpDir, 'qa-test-ca.pem'),
    ...extra,
  };
}
async function startBackend(label, env) {
  const child = startNode([launcher], { cwd: BACKEND_DIR, env, logFile: path.join(OUT, 'logs', `backend-${label}.log`) });
  children.add(child);
  await waitForReadyLine(child, { label: `backend (${label})`, timeoutMs: 60_000 });
  return child;
}
async function stop(child) {
  if (!child) return;
  await stopChild(child);
  children.delete(child);
}
const portOpen = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
/** Starts the backend expecting a refusal; returns { exitCode, portOpened, output }. */
function expectRefusal(label, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [launcher], { cwd: BACKEND_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let opened = false;
    const poll = setInterval(async () => {
      if (await portOpen(API_PORT)) opened = true;
    }, 25);
    const timer = setTimeout(() => child.kill('SIGTERM'), 60_000);
    child.stdout.on('data', (c) => (output += c));
    child.stderr.on('data', (c) => (output += c));
    child.on('close', (code) => {
      clearInterval(poll);
      clearTimeout(timer);
      writeFileSync(path.join(OUT, 'startup', `${label}.log`), sanitise(output));
      resolve({ exitCode: code, portOpened: opened, output: sanitise(output) });
    });
  });
}
const reconcileCli = (label, cliArgs, env) => runNode(['scripts/storage-reconcile.mjs', ...cliArgs], { cwd: BACKEND_DIR, env, logFile: path.join(OUT, 'logs', `reconcile-${label}.log`), label: `reconcile ${label}` });
const smtpMessages = () => readdirSync(smtpDir).filter((f) => f.endsWith('.eml')).length;
const backendLog = (label) => readFileSync(path.join(OUT, 'logs', `backend-${label}.log`), 'utf8');

/* ------------------------------------------------------------------- the run -- */

let proxy;
let mongoose;
try {
  // 0. The double, the proxy, SMTP, the database, the Job.
  moto = await startMoto({ python: PYTHON });
  secrets.push(moto.app.secretAccessKey, moto.app.accessKeyId, moto.denied.secretAccessKey, moto.denied.accessKeyId, SMTP_PASSWORD);
  proxy = await startFaultProxy({ upstream: moto.endpoint });
  smtpDir = mkdtempSync(path.join(os.tmpdir(), 'valida-c6t4-smtp-'));
  const smtpChild = startNode([fileURLToPath(new URL('../support/smtpCapture.mjs', import.meta.url))], {
    cwd: BACKEND_DIR,
    env: { ...baseEnvironment(), E2E_SMTP_USERNAME: IDENTITY.user, E2E_SMTP_PASSWORD: SMTP_PASSWORD, E2E_SMTP_CAPTURE_DIR: smtpDir, E2E_SMTP_CA_FILE: path.join(smtpDir, 'qa-test-ca.pem'), E2E_SMTP_REJECT_RECIPIENTS: '' },
    logFile: path.join(OUT, 'logs', 'smtp.log'),
  });
  children.add(smtpChild);
  smtp = await waitForReadyLine(smtpChild, { label: 'SMTP test server' });

  const backendRequire = createRequire(path.join(BACKEND_DIR, 'package.json'));
  mongoose = backendRequire('mongoose');
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.db.databaseName !== guard.databaseName) throw new Error('unexpected database');
  await mongoose.connection.db.dropDatabase();
  const scriptEnv = { ...baseEnvironment(), APP_ENV: 'local', NODE_ENV: 'development', MONGODB_URI };
  for (const step of [['scripts/db-indexes.mjs', 'apply'], ['scripts/provision-job.mjs', 'apply', '--file', path.join(FIXTURES_DIR, 'seo-jobs', 'qa-c4-open-remote.json'), '--confirm-lifecycle']]) {
    const r = await runNode(step, { cwd: BACKEND_DIR, env: scriptEnv, logFile: path.join(OUT, 'logs', 'setup.log'), label: step.join(' ') });
    if (r.code !== 0) throw new Error(`setup failed: ${step.join(' ')}`);
  }
  const applications = () => mongoose.connection.db.collection('applications');
  const count = () => applications().countDocuments();

  /* ====================================================== S: START-UP ==== */
  const refusals = [
    ['S1', 'credentials without permission', backendEnv(proxy.endpoint, { RESUME_STORAGE_S3_ACCESS_KEY_ID: moto.denied.accessKeyId, RESUME_STORAGE_S3_SECRET_ACCESS_KEY: moto.denied.secretAccessKey }), /resume storage could not be initialised \(PERMISSION_DENIED\)/],
    ['S2', 'a wrong secret (signature refused)', backendEnv(proxy.endpoint, { RESUME_STORAGE_S3_SECRET_ACCESS_KEY: `qa-wrong-${randomBytes(12).toString('hex')}` }), /\(PERMISSION_DENIED\)/],
    ['S3', 'the store unreachable', backendEnv(`http://127.0.0.1:${API_PORT + 9}`), /\(UNAVAILABLE\)/],
    ['S4', 'an incomplete S3 configuration', backendEnv(proxy.endpoint, { RESUME_STORAGE_S3_BUCKET: '' }), /RESUME_STORAGE_S3_BUCKET: is required/],
    ['S5', 'plain http to the store in review', backendEnv(proxy.endpoint, { APP_ENV: 'review', NODE_ENV: 'production', SITE_ACCESS: 'private', ACCESS_ALLOWLIST: '127.0.0.1/32' }), /RESUME_STORAGE_S3_ENDPOINT: must use https/],
  ];
  for (const [id, label, env, pattern] of refusals) {
    const r = await expectRefusal(`${id}-${label.replace(/\W+/g, '-')}`, env);
    // A storage refusal must give the S3 advice, never the local-directory advice.
    const storageRefusal = /could not be initialised/.test(r.output);
    const adviceOk = !storageRefusal || (r.output.includes('RESUME_STORAGE_S3_ENDPOINT') && !r.output.includes('RESUME_STORAGE_LOCAL_ROOT'));
    check(id, 'start-up', `The backend refuses to start, before listening, with ${label} (no fallback to disk)`, `exit 1; port never open; output matches ${pattern}; S3 advice only; no credential printed`,
      { exitCode: r.exitCode, portOpened: r.portOpened, output: r.output.trim().split('\n').slice(-1).join(' | ') }, r.exitCode === 1 && !r.portOpened && pattern.test(r.output) && adviceOk && !r.output.includes('[REDACTED]'));
  }

  proxy.setPlan({ '*': ['pass'] });
  let backend = await startBackend('main', backendEnv(proxy.endpoint));
  const ready = await exchange('readiness', { target: '/api/v1/health/ready' });
  check('S6', 'readiness', 'With a working store the backend starts and readiness is 200 (the start-up probe wrote, checked and deleted a probe object; an anonymous read of it was refused)', '200; no probe object left',
    { status: ready.status, probeObjectsLeft: JSON.parse(execFileSync(PYTHON, ['-c', `import sys,boto3;c=boto3.client('s3',endpoint_url=sys.argv[1],region_name='us-east-1',aws_access_key_id=sys.argv[3],aws_secret_access_key=sys.argv[4]);print(len(c.list_objects_v2(Bucket=sys.argv[2],Prefix='probes/').get('Contents',[])))`, moto.endpoint, moto.bucket, moto.app.accessKeyId, moto.app.secretAccessKey], { encoding: 'utf8' })) },
    ready.status === 200);

  /* ======================================================= A: APPLY ====== */
  const before1 = { apps: await count(), objects: readStore(), mail: smtpMessages() };
  const a1 = await apply('A1-accepted');
  await new Promise((r) => setTimeout(r, 1000));
  const record = await applications().findOne({}, { projection: { _id: 0, 'resume.storageProvider': 1, 'resume.storageKey': 1, 'resume.sizeBytes': 1, 'resume.checksumSha256': 1, 'resume.scanStatus': 1, status: 1 } });
  const after1 = { apps: await count(), objects: readStore(), mail: smtpMessages() };
  const recordRef = storageObjectRef(record.resume.storageKey);
  const stored1 = after1.objects.find((o) => o.ref === recordRef);
  check('A1', 'apply', 'Accepted: 201; one Application; its object read back independently (botocore) is byte for byte the uploaded file — length, SHA-256 and stored metadata agree; one internal notification', '201; apps +1; object size = record size = upload size; sha256 = record checksum = upload sha256; mail +1; nothing private in the response',
    { status: a1.status, record: { storageProvider: record.resume.storageProvider, objectRef: recordRef, sizeBytes: record.resume.sizeBytes, checksumMatchesUpload: record.resume.checksumSha256 === pdfSha, scanStatus: record.resume.scanStatus, status: record.status }, object: stored1, apps: [before1.apps, after1.apps], mail: [before1.mail, after1.mail], responseExposesPrivate: exposes(a1, [record.resume.storageKey]) },
    a1.status === 201 && after1.apps === before1.apps + 1 && record.resume.storageProvider === 'S3_COMPATIBLE' && stored1 && stored1.size === pdf.length && stored1.size === record.resume.sizeBytes && stored1.sha256 === pdfSha && stored1.sha256 === record.resume.checksumSha256 && stored1.metaSha256 === pdfSha && after1.mail === before1.mail + 1 && !exposes(a1, [record.resume.storageKey]));
  const anon = anonymousRead(recordRef);
  check('A2', 'privacy', 'The stored object is not publicly readable: an anonymous GET is refused by the store', '403', { status: anon }, anon === 403);

  // Proven storage failure.
  proxy.setPlan({ PUT: ['status:403'], '*': ['pass'] });
  const b2 = { apps: await count(), objects: readStore().length, mail: smtpMessages() };
  const a3 = await apply('A3-storage-refused');
  await new Promise((r) => setTimeout(r, 500));
  const c2 = { apps: await count(), objects: readStore().length, mail: smtpMessages() };
  check('A3', 'persistence', 'PROVEN storage failure (the store refuses the PUT): 503; no Application, no object, no email; nothing for reconciliation', '503 SERVICE_UNAVAILABLE; apps, objects and mail unchanged',
    { status: a3.status, code: a3.json?.error?.code, before: b2, after: c2 }, a3.status === 503 && a3.json?.error?.code === 'SERVICE_UNAVAILABLE' && c2.apps === b2.apps && c2.objects === b2.objects && c2.mail === b2.mail);

  // Lost answer, resolved.
  proxy.setPlan({ PUT: ['lose-answer'], '*': ['pass'] });
  const b3 = { apps: await count(), objects: readStore().length };
  const a4 = await apply('A4-lost-answer-resolved');
  const c3 = { apps: await count(), objects: readStore().length };
  check('A4', 'persistence', 'LOST ANSWER after the write: the driver verifies the object (HEAD: length and SHA-256) -> 201; one Application referencing one new object', '201; apps +1; objects +1',
    { status: a4.status, before: b3, after: c3, resolvedLogged: /storage_write_outcome_resolved/.test(backendLog('main')) }, a4.status === 201 && c3.apps === b3.apps + 1 && c3.objects === b3.objects + 1 && /"outcome":"STORED"/.test(backendLog('main')));

  // Lost answer, unresolved.
  proxy.setPlan({ PUT: ['lose-answer'], HEAD: ['reset'], '*': ['pass'] });
  const b4 = { apps: await count(), objects: readStore() };
  const a5 = await apply('A5-outcome-unknown');
  proxy.setPlan({ '*': ['pass'] });
  const c4 = { apps: await count(), objects: readStore() };
  const referenced = new Set((await applications().find({}, { projection: { 'resume.storageKey': 1 } }).toArray()).map((d) => storageObjectRef(d.resume.storageKey)));
  const orphans = c4.objects.filter((o) => !referenced.has(o.ref));
  const unknownLine = backendLog('main').split('\n').find((l) => l.includes('storage_write_outcome_unknown')) ?? '';
  check('A5', 'persistence', 'LOST ANSWER and the store then unreachable: 503 (never a fake success); no Application; the possible object is present, UNREFERENCED, and its one-way reference is logged for reconciliation', '503; apps unchanged; exactly one unreferenced object whose ref matches the log line',
    { status: a5.status, apps: [b4.apps, c4.apps], objects: [b4.objects.length, c4.objects.length], unreferenced: orphans.map((o) => o.ref), logged: unknownLine.replace(/"time":\d+,/, '').slice(0, 300) },
    a5.status === 503 && c4.apps === b4.apps && orphans.length === 1 && unknownLine.includes(orphans[0].ref));

  // What reconciliation does next (the real CLI).
  const cliEnv = { ...backendEnv(proxy.endpoint), LOG_LEVEL: 'info' };
  const dry = await reconcileCli('dry-run', [], cliEnv);
  const dryLog = readFileSync(path.join(OUT, 'logs', 'reconcile-dry-run.log'), 'utf8');
  check('R1', 'reconciliation', 'The reconciliation CLI (dry run) lists the unreferenced object by its reference as a possible orphan, kept while recent; referenced objects counted, untouched', `exit 0; ${c4.objects.length} objects; ${c4.objects.length - 1} referenced; 1 possible orphan (KEEP_TOO_RECENT) = the logged ref`,
    { exit: dry.code, tail: sanitise(dryLog).split('\n').filter((l) => /objects:|possible|KEEP|DELETE|ref/.test(l)).slice(0, 6) }, dry.code === 0 && dryLog.includes(orphans[0].ref) && dryLog.includes(`objects: ${c4.objects.length}; referenced by an Application: ${c4.objects.length - 1}; possible orphans: 1`));
  const del = await reconcileCli('delete', ['--delete', '--confirm-delete'], cliEnv);
  const afterDelete = readStore();
  check('R2', 'reconciliation', 'The reconciliation CLI with --delete --confirm-delete deletes NOTHING younger than the 24 h floor: every object, referenced or not, is still there (deletion of an old orphan is proven in tests/s3 with an injected clock)', `exit 0; ${c4.objects.length} objects remain`, { exit: del.code, objects: afterDelete.length }, del.code === 0 && afterDelete.length === c4.objects.length);

  // Concurrency against the real database.
  const key = randomUUID();
  const b5 = { apps: await count(), objects: readStore().length };
  const [r1, r2] = await Promise.all([apply('A6-concurrent-1', key), apply('A6-concurrent-2', key)]);
  const c5 = { apps: await count(), objects: readStore().length };
  check('A6', 'persistence', 'Two concurrent submissions with one Idempotency-Key (real MongoDB unique index): one Application; the loser removed only ITS OWN object; the winner\'s object remains', 'statuses [200, 201]; apps +1; objects +1',
    { statuses: [r1.status, r2.status].sort(), apps: [b5.apps, c5.apps], objects: [b5.objects, c5.objects] }, JSON.stringify([r1.status, r2.status].sort()) === '[200,201]' && c5.apps === b5.apps + 1 && c5.objects === b5.objects + 1);

  // Outage after start, then recovery.
  proxy.setPlan({ '*': ['reset'] });
  const b6 = { apps: await count() };
  const a7 = await apply('A7-outage');
  const readyDuring = await exchange('readiness-during-outage', { target: '/api/v1/health/ready' });
  proxy.setPlan({ '*': ['pass'] });
  const a8 = await apply('A8-recovered');
  const c6 = { apps: await count() };
  check('A7', 'persistence', 'Storage outage after start-up: 503 with no Application; when the store returns, the next submission is accepted with no restart', 'outage 503; recovered 201; apps +1 in total',
    { outage: a7.status, recovered: a8.status, apps: [b6.apps, c6.apps], readinessDuringOutage: readyDuring.status }, a7.status === 503 && a8.status === 201 && c6.apps === b6.apps + 1);

  // Every referenced object, byte for byte.
  const all = readStore();
  const docs = await applications().find({}, { projection: { 'resume.storageKey': 1, 'resume.sizeBytes': 1, 'resume.checksumSha256': 1 } }).toArray();
  const mismatches = docs.filter((d) => {
    const o = all.find((x) => x.ref === storageObjectRef(d.resume.storageKey));
    return !o || o.size !== d.resume.sizeBytes || o.sha256 !== d.resume.checksumSha256;
  });
  check('A8', 'integrity', 'Every Application\'s object exists and matches its record byte for byte (independent read)', '0 mismatches', { applications: docs.length, objects: all.length, mismatches: mismatches.length }, mismatches.length === 0 && docs.length > 0);

  await stop(backend);
  backend = null;

  /* ======================================================= K: HYGIENE ===== */
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(OUT);
  const allKeys = (await applications().find({}, { projection: { 'resume.storageKey': 1 } }).toArray()).map((d) => d.resume.storageKey);
  const leaks = files.filter((f) => {
    const text = readFileSync(f, 'utf8');
    return secrets.some((s) => s && text.includes(s)) || allKeys.some((k) => text.includes(k)) || /resumes\/[0-9a-f]{32}\/[0-9a-f]{32}/.test(text);
  });
  check('K1', 'evidence', 'No credential, SMTP password or storage key appears in any evidence file (logs, HTTP, start-up output)', '0 files', { files: files.length, leaks: leaks.map((f) => path.relative(OUT, f)) }, leaks.length === 0);
  const logText = readdirSync(path.join(OUT, 'logs')).filter((f) => f.startsWith('backend-')).map((f) => readFileSync(path.join(OUT, 'logs', f), 'utf8')).join('\n');
  check('K2', 'evidence', 'The backend log carries no applicant field (name, email) and no résumé content', 'none found', { name: logText.includes('QA Synthetic Applicant C6T4'), email: logText.includes('qa+c6t4@'), content: logText.includes('QA TEST DOCUMENT C6-T4') }, !logText.includes('QA Synthetic Applicant C6T4') && !logText.includes('qa+c6t4@') && !logText.includes('QA TEST DOCUMENT C6-T4'));
} catch (error) {
  check('X', 'harness', 'The stack check ran to completion', 'no error', sanitise(String(error?.stack ?? error)), false);
} finally {
  for (const child of [...children]) await stop(child);
  await proxy?.close();
  await moto?.stop();
  await mongoose?.disconnect().catch(() => {});
  const failed = results.filter((r) => !r.pass).length;
  writeFileSync(path.join(OUT, 'results.json'), `${JSON.stringify({ label: args.label, database: guard.databaseName, checks: results.length, failed, results }, null, 2)}\n`);
  process.stdout.write(`\n${results.length} checks, ${results.length - failed} passed, ${failed} failed. Evidence: ${OUT}\n`);
  process.exit(failed === 0 ? 0 : 1);
}
