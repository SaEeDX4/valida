#!/usr/bin/env node
/**
 * C6-T6 — the two approved restore rehearsals, run through the ACTUAL tooling
 * on a disposable local stack (C6 plan r3 §5.6 as corrected by r3 correction
 * 1: a DAMAGED and a HEALTHY snapshot).
 *
 *   VALIDA_TEST_MOTO_PYTHON=<python with moto[server]> \
 *   VALIDA_TEST_MONGOD=<path to mongod 8> \
 *     node c6/c6-t6-backup-rehearsal.mjs --out <evidence directory>
 *
 * WHAT RUNS
 *   - a disposable MongoDB 8 started by this script WITH ACCESS CONTROL, one
 *     user per role: the API (readWrite on the live database), the manifest
 *     (read only), the restorer and the throwaway API (the restore databases
 *     only), and a test-side root that plays the database provider;
 *   - a fresh local S3-compatible double per rehearsal (moto server,
 *     signature-checked, scoped policies: backend/tests/backup/backup_moto_setup.py),
 *     with the versioned primary bucket, the locked copy and log buckets, and
 *     new restore-target buckets;
 *   - the real API (backend/src/server.js) with RESUME_STORAGE_DRIVER=s3, and
 *     the local SMTP test server so readiness can be ready;
 *   - the real commands: scripts/backup.mjs copy | manifest | delete-application
 *     | restore, db-indexes, provision-job;
 *   - an INDEPENDENT reader (botocore, test-side) for byte checks.
 *
 * WHAT IS A STAND-IN, AND SAID SO
 *   - The database provider's snapshot is a copy of the live database taken
 *     at T by the test-side root user, and "restore into a new cluster" is a
 *     copy of that into a new database on the same local server.
 *   - The hourly schedule is replaced by explicit copy runs at stated times.
 *   - Retention locks are the double's (COMPLIANCE, 1 day).
 *   Provider versioning, version-specific permissions and deletion,
 *   retention-lock enforcement, real scheduling and hosted recovery times
 *   remain hosted checks.
 *
 * EVIDENCE HYGIENE. Synthetic data only. No credential, connection string,
 * storage key or applicant field is written to the evidence; objects are
 * named by their one-way reference.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DOCX_MIME, PDF_MIME, syntheticDocx, syntheticPdf } from '../../backend/tests/fixtures/resumeFiles.js';
import { createRestoreBucket, destroyPrimaryObject, endpointFor, readIndependently, roleEnv, startBackupMoto } from '../../backend/tests/backup/backupFixture.js';
import { startFaultProxy } from '../../backend/tests/s3/faultProxy.js';
import { storageObjectRef } from '../../backend/src/integrations/storage/storageContract.js';
import { anonymousGetStatus, listKeys } from '../../backend/src/ops/backup/backupStore.js';
import { BACKEND_DIR, FIXTURES_DIR } from '../support/paths.js';
import { baseEnvironment, runNode, startNode, stopChild, waitForReadyLine } from '../support/processes.js';

const { values: args } = parseArgs({ options: { label: { type: 'string', default: 'run' }, out: { type: 'string' } } });
const OUT = path.resolve(args.out ?? path.join(os.tmpdir(), `valida-c6-t6-rehearsal-${args.label}`));
for (const dir of ['http', 'logs', 'reports']) mkdirSync(path.join(OUT, dir), { recursive: true });
const PYTHON = process.env.VALIDA_TEST_MOTO_PYTHON;
const MONGOD = process.env.VALIDA_TEST_MONGOD;
if (!PYTHON || !MONGOD) {
  console.error('refused: VALIDA_TEST_MOTO_PYTHON and VALIDA_TEST_MONGOD are required');
  process.exit(2);
}
const BASE = Number(process.env.C6T6_BASE_PORT ?? 4400);
const API_PORT = BASE;
const RESTORED_API_PORT = BASE + 1;
const MONGO_PORT = BASE + 10;
const SLUG = 'qa-c4-open-remote';
const LIVE_DB = 'valida_test_c6t6_live';
const IDENTITY = { user: 'careers-qa@valida-e2e.example.test', internal: 'recruitment-qa@valida-e2e.example.test' };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const secret = () => `qa-${randomBytes(18).toString('hex')}`;
const PASSWORDS = { root: secret(), app: secret(), manifest: secret(), restorer: secret(), rehearsalApi: secret(), smtp: secret() };

const secrets = Object.values(PASSWORDS);
const storageKeys = [];
const sanitise = (text) => {
  let out = String(text);
  for (const value of [...secrets, ...storageKeys]) if (value) out = out.split(value).join('[REDACTED]');
  return out.replace(/mongodb:\/\/[^@\s"]+@/g, 'mongodb://[REDACTED]@');
};
const results = [];
function check(id, area, description, expected, actual, pass) {
  results.push({ id, area, description, expected, actual: sanitise(typeof actual === 'string' ? actual : JSON.stringify(actual)), pass: Boolean(pass) });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${description}\n`);
}
const timeline = [];
const mark = (rehearsal, event, extra = {}) => {
  const at = new Date();
  timeline.push({ rehearsal, event, at: at.toISOString(), ...extra });
  return at;
};

/* ------------------------------------------------------------- mongod -- */

const mongoUri = (user, password, db) => `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${MONGO_PORT}/${db}?authSource=admin`;
const portOpen = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
let mongodChild;
let mongoDir;
async function startMongod() {
  mongoDir = mkdtempSync(path.join(os.tmpdir(), 'valida-c6t6-mongo-'));
  mongodChild = spawn(MONGOD, ['--auth', '--port', String(MONGO_PORT), '--bind_ip', '127.0.0.1', '--dbpath', mongoDir, '--quiet'], { stdio: 'ignore' });
  const deadline = Date.now() + 30_000;
  while (!(await portOpen(MONGO_PORT))) {
    if (Date.now() > deadline) throw new Error('mongod did not start');
    await new Promise((r) => setTimeout(r, 100));
  }
}

/* --------------------------------------------------------------- http -- */

let exchangeCount = 0;
function exchange(name, { port = API_PORT, method = 'GET', target, headers = {}, body, note = '' }) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path: target, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        exchangeCount += 1;
        const file = `${String(exchangeCount).padStart(3, '0')}-${name}.txt`;
        writeFileSync(path.join(OUT, 'http', file), sanitise(`# ${name}\n\n${method} ${target} (port ${port})\n${note}\n\nHTTP/1.1 ${res.statusCode}\n${Object.entries(res.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${text}\n`));
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode, headers: res.headers, json, file });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
function multipart(label, file) {
  const boundary = `----qa${randomBytes(8).toString('hex')}`;
  const parts = [
    ['fullName', `QA Synthetic Applicant ${label}`],
    ['email', `qa+c6t6-${label.toLowerCase()}@valida-e2e.example.test`],
    ['screeningAnswers', '[]'],
  ].map(([n, v]) => Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`));
  const body = Buffer.concat([...parts, Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="resume"; filename="qa-c6t6-${label}.${file.ext}"\r\nContent-Type: ${file.mime}\r\n\r\n`), file.bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
const resumeFor = (label, kind) =>
  kind === 'docx'
    ? { bytes: syntheticDocx({ text: `QA TEST DOCUMENT C6-T6 ${label} ${randomUUID()} - NOT A REAL CANDIDATE` }), mime: DOCX_MIME, ext: 'docx' }
    : { bytes: syntheticPdf({ text: `QA TEST DOCUMENT C6-T6 ${label} ${randomUUID()} - NOT A REAL CANDIDATE` }), mime: PDF_MIME, ext: 'pdf' };

/* ---------------------------------------------------------- processes -- */

const children = new Set();
const launcher = fileURLToPath(new URL('../support/backendLauncher.mjs', import.meta.url));
let smtp;
let smtpDir;
function apiEnv({ port, mongo, bucket, user, moto, mode, extra = {} }) {
  return {
    ...baseEnvironment(),
    NODE_ENV: 'development',
    APP_ENV: 'local',
    PORT: String(port),
    LOG_LEVEL: 'info',
    TRUST_PROXY: 'false',
    MONGODB_URI: mongo,
    CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:4173',
    RECRUITMENT_MODE: mode,
    ACCESS_ALLOWLIST: '127.0.0.1/32',
    APPLICATION_RATE_LIMIT_MAX: '100',
    RESUME_STORAGE_DRIVER: 's3',
    RESUME_STORAGE_S3_ENDPOINT: moto.endpoint,
    RESUME_STORAGE_S3_REGION: 'us-east-1',
    RESUME_STORAGE_S3_BUCKET: bucket,
    RESUME_STORAGE_S3_ACCESS_KEY_ID: moto.users[user].accessKeyId,
    RESUME_STORAGE_S3_SECRET_ACCESS_KEY: moto.users[user].secretAccessKey,
    RESUME_STORAGE_S3_TIMEOUT_MS: '3000',
    TRANSACTIONAL_EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'localhost',
    SMTP_PORT: String(smtp.port),
    SMTP_SECURITY: 'implicit-tls',
    SMTP_USERNAME: IDENTITY.user,
    SMTP_PASSWORD: PASSWORDS.smtp,
    TRANSACTIONAL_FROM_ADDRESS: IDENTITY.user,
    TRANSACTIONAL_REPLY_TO: 'careers-reply-qa@valida-e2e.example.test',
    RECRUITMENT_NOTIFICATION_RECIPIENT: IDENTITY.internal,
    APPLICATION_ACKNOWLEDGEMENT_ENABLED: 'false',
    EMAIL_RECIPIENT_ALLOWLIST: '@valida-e2e.example.test',
    NODE_EXTRA_CA_CERTS: path.join(smtpDir, 'qa-test-ca.pem'),
    ...extra,
  };
}
async function startApi(label, env) {
  const child = startNode([launcher], { cwd: BACKEND_DIR, env, logFile: path.join(OUT, 'logs', `api-${label}.log`) });
  children.add(child);
  await waitForReadyLine(child, { label: `api (${label})`, timeoutMs: 60_000 });
  return child;
}
async function stop(child) {
  if (!child) return;
  await stopChild(child);
  children.delete(child);
}
async function backup(label, command, cliArgs, env) {
  const r = await runNode(['scripts/backup.mjs', command, ...cliArgs], { cwd: BACKEND_DIR, env: { ...baseEnvironment(), ...env }, logFile: path.join(OUT, 'logs', `backup-${label}.log`), label: `backup ${command} ${label}` });
  let summary = null;
  try {
    summary = JSON.parse(r.stdout.trim().split('\n').pop());
  } catch {
    summary = null;
  }
  return { code: r.code, summary, stderr: r.stderr };
}

/* ------------------------------------------------- the provider stand-in -- */

const backendRequire = createRequire(path.join(BACKEND_DIR, 'package.json'));
const mongoose = backendRequire('mongoose');
let root;
/** The provider's snapshot (stand-in): every collection, its documents and indexes, at this moment. */
async function copyDatabase(from, to) {
  const source = root.useDb(from, { useCache: false }).db;
  const target = root.useDb(to, { useCache: false }).db;
  await target.dropDatabase();
  for (const { name } of await source.listCollections({}, { nameOnly: true }).toArray()) {
    const docs = await source.collection(name).find({}).toArray();
    await target.createCollection(name);
    if (docs.length) await target.collection(name).insertMany(docs);
    const indexes = (await source.collection(name).indexes()).filter((ix) => ix.name !== '_id_');
    if (indexes.length) await target.collection(name).createIndexes(indexes.map(({ v, ns, ...spec }) => spec));
  }
}
const live = () => root.useDb(LIVE_DB, { useCache: true }).db.collection('applications');

/* --------------------------------------------------------------- run -- */

let motoD;
let motoH;
try {
  await startMongod();
  // The first user, through the localhost exception; then everything authenticates.
  const bootstrap = await mongoose.createConnection(`mongodb://127.0.0.1:${MONGO_PORT}/admin`, { serverSelectionTimeoutMS: 10_000 }).asPromise();
  await bootstrap.db.command({ createUser: 'qa-root', pwd: PASSWORDS.root, roles: ['root'] });
  await bootstrap.close();
  root = await mongoose.createConnection(mongoUri('qa-root', PASSWORDS.root, 'admin'), { serverSelectionTimeoutMS: 10_000 }).asPromise();
  const restoreDbs = ['valida_test_c6t6_restore_d', 'valida_test_c6t6_restore_h', 'valida_test_c6t6_restore_h2'];
  await root.db.command({ createUser: 'qa-api', pwd: PASSWORDS.app, roles: [{ role: 'readWrite', db: LIVE_DB }] });
  await root.db.command({ createUser: 'qa-backup-manifest', pwd: PASSWORDS.manifest, roles: [{ role: 'read', db: LIVE_DB }] });
  await root.db.command({ createUser: 'qa-backup-restorer', pwd: PASSWORDS.restorer, roles: restoreDbs.map((db) => ({ role: 'readWrite', db })) });
  await root.db.command({ createUser: 'qa-rehearsal-api', pwd: PASSWORDS.rehearsalApi, roles: restoreDbs.map((db) => ({ role: 'readWrite', db })) });

  smtpDir = mkdtempSync(path.join(os.tmpdir(), 'valida-c6t6-smtp-'));
  const smtpChild = startNode([fileURLToPath(new URL('../support/smtpCapture.mjs', import.meta.url))], {
    cwd: BACKEND_DIR,
    env: { ...baseEnvironment(), E2E_SMTP_USERNAME: IDENTITY.user, E2E_SMTP_PASSWORD: PASSWORDS.smtp, E2E_SMTP_CAPTURE_DIR: smtpDir, E2E_SMTP_CA_FILE: path.join(smtpDir, 'qa-test-ca.pem'), E2E_SMTP_REJECT_RECIPIENTS: '' },
    logFile: path.join(OUT, 'logs', 'smtp.log'),
  });
  children.add(smtpChild);
  smtp = await waitForReadyLine(smtpChild, { label: 'SMTP test server' });

  const appMongo = mongoUri('qa-api', PASSWORDS.app, LIVE_DB);
  const manifestMongo = mongoUri('qa-backup-manifest', PASSWORDS.manifest, LIVE_DB);

  /* ---------------- the database boundary (read-only manifest user) ---- */
  {
    const conn = await mongoose.createConnection(manifestMongo, { serverSelectionTimeoutMS: 10_000 }).asPromise();
    let readOk = false;
    let writeCode = null;
    try {
      await conn.db.collection('applications').countDocuments();
      readOk = true;
      await conn.db.collection('applications').insertOne({ qa: 'must be refused' });
    } catch (error) {
      writeCode = error?.codeName ?? 'ERROR';
    }
    await conn.close();
    check('M1', 'access', "The manifest's database user can read Applications and cannot write them (MongoDB access control)", 'read ok; insert refused (Unauthorized)', { readOk, writeCode }, readOk && writeCode === 'Unauthorized');
  }

  /** Fresh live database, indexes, the synthetic Job. */
  async function freshLive(label) {
    await root.useDb(LIVE_DB, { useCache: false }).db.dropDatabase();
    const env = { ...baseEnvironment(), APP_ENV: 'local', NODE_ENV: 'development', MONGODB_URI: appMongo };
    for (const step of [['scripts/db-indexes.mjs', 'apply'], ['scripts/provision-job.mjs', 'apply', '--file', path.join(FIXTURES_DIR, 'seo-jobs', `${SLUG}.json`), '--confirm-lifecycle']]) {
      const r = await runNode(step, { cwd: BACKEND_DIR, env, logFile: path.join(OUT, 'logs', `setup-${label}.log`), label: step.join(' ') });
      if (r.code !== 0) throw new Error(`setup failed: ${step.join(' ')}`);
    }
  }
  /** Submits one synthetic application through the real API; returns what was sent and stored. */
  async function submit(rehearsal, label, kind = 'pdf', port = API_PORT, db = live) {
    const file = resumeFor(label, kind);
    const { body, contentType } = multipart(label, file);
    const response = await exchange(`${rehearsal}-submit-${label}`, { port, method: 'POST', target: `/api/v1/jobs/${SLUG}/applications`, headers: { 'content-type': contentType, 'content-length': String(body.length), 'idempotency-key': randomUUID() }, body, note: `[multipart: synthetic ${kind} résumé, ${file.bytes.length} bytes, SHA-256 ${sha256(file.bytes)}]` });
    const record = (await db().find({}).sort({ _id: -1 }).limit(1).toArray())[0];
    storageKeys.push(record.resume.storageKey);
    const at = mark(rehearsal, `submitted ${label}`);
    return { label, status: response.status, id: String(record._id), key: record.resume.storageKey, objectRef: storageObjectRef(record.resume.storageKey), sizeBytes: file.bytes.length, checksumSha256: sha256(file.bytes), storedSize: record.resume.sizeBytes, storedSha: record.resume.checksumSha256, at };
  }
  const expectedFile = (name, apps) => {
    const file = path.join(OUT, 'reports', `${name}-submission-checksums.json`);
    writeFileSync(file, `${JSON.stringify(apps.map(({ id, label, objectRef, sizeBytes, checksumSha256 }) => ({ applicationId: id, label, objectRef, sizeBytes, checksumSha256 })), null, 2)}\n`);
    return file;
  };
  const labels = (rows, apps) => rows.map((row) => ({ ...row, label: apps.find((a) => a.id === row.applicationId || a.objectRef === row.objectRef)?.label ?? '?' }));
  const roleEnvFor = (moto, extra = {}) => ({ ...roleEnv(moto), ...extra });

  /* =========================================== REHEARSAL D: damaged ==== */
  motoD = await startBackupMoto({ python: PYTHON });
  for (const u of Object.values(motoD.users)) secrets.push(u.accessKeyId, u.secretAccessKey);
  await freshLive('D');
  let api = await startApi('D-live', apiEnv({ port: API_PORT, mongo: appMongo, bucket: motoD.buckets.primary, user: 'qa-app', moto: motoD, mode: 'testers' }));
  const D = {};
  for (const label of ['P', 'Q', 'R', 'F']) D[label] = await submit('D', label, 'pdf');
  check('D1', 'rehearsal D', 'P, Q, R and F submitted through the real API as a listed tester; each record states the size and SHA-256 of the bytes sent', '4 × 201; record = sent', Object.values(D).map((a) => ({ label: a.label, status: a.status, objectRef: a.objectRef, match: a.storedSize === a.sizeBytes && a.storedSha === a.checksumSha256 })), Object.values(D).every((a) => a.status === 201 && a.storedSize === a.sizeBytes && a.storedSha === a.checksumSha256));
  // The damage: F's primary object removed directly, every version, NO log entry, before any copy.
  destroyPrimaryObject(motoD, D.F.key);
  mark('D', 'F removed from the primary (no log entry; the unexplained case)');
  await stop(api);
  const TD = mark('D', 'snapshot S_D taken (stand-in)');
  await copyDatabase(LIVE_DB, 'valida_test_c6t6_snapshot_d');
  await new Promise((r) => setTimeout(r, 20));
  const dCopy = await backup('D-copy', 'copy', [], roleEnvFor(motoD));
  mark('D', 'copy run after S_D', { complete: dCopy.summary?.complete });
  const dManifest = await backup('D-manifest', 'manifest', ['--snapshot-id', 'S_D', '--snapshot-time', TD.toISOString(), '--report', path.join(OUT, 'reports', 'D-manifest.json')], roleEnvFor(motoD, { BACKUP_MANIFEST_MONGODB_URI: manifestMongo }));
  check('D2', 'rehearsal D', 'The copy after S_D completes (P, Q, R copied; F has no primary object to copy)', 'complete; 3 copied', dCopy.summary, dCopy.code === 0 && dCopy.summary?.complete === true && dCopy.summary?.copied === 3);
  check('D3', 'rehearsal D', "S_D's manifest (from the LIVE database): PRELIMINARY: DEFECT FOUND (1), naming F; P, Q, R OK", 'state DEFECT FOUND (1); the defect is F, copy ABSENT, primary NO', { state: dManifest.summary?.state, defects: labels(dManifest.summary?.defects ?? [], Object.values(D)), ok: dManifest.summary?.ok }, dManifest.code === 1 && dManifest.summary?.state === 'PRELIMINARY: DEFECT FOUND (1)' && dManifest.summary?.defects?.[0]?.objectRef === D.F.objectRef && dManifest.summary?.defects?.[0]?.primaryHoldsGoodObject === 'NO' && dManifest.summary?.ok === 3);
  check('D4', 'rehearsal D', 'The same-day report (plan §5.3) holds the id, the one-way reference, the creation time and the finding — no applicant field, no storage key', 'fields only', dManifest.summary?.defects, (dManifest.summary?.defects ?? []).every((d) => Object.keys(d).every((k) => ['applicationId', 'objectRef', 'createdAt', 'sizeBytes', 'checksumSha256', 'copy', 'primaryHoldsGoodObject'].includes(k))));

  // Restore S_D into a new database and a new bucket.
  const LD = mark('D', 'loss declared; restore of S_D begins');
  await copyDatabase('valida_test_c6t6_snapshot_d', 'valida_test_c6t6_restore_d');
  createRestoreBucket(motoD, 'qa-valida-restore-d');
  const dRestore = await backup('D-restore', 'restore', ['--snapshot-id', 'S_D', '--snapshot-time', TD.toISOString(), '--expected', expectedFile('D', Object.values(D)), '--report', path.join(OUT, 'reports', 'D-restore.json')], roleEnvFor(motoD, { BACKUP_RESTORE_BUCKET: 'qa-valida-restore-d', BACKUP_RESTORE_MONGODB_URI: mongoUri('qa-backup-restorer', PASSWORDS.restorer, 'valida_test_c6t6_restore_d') }));
  const dReport = JSON.parse(readFileSync(path.join(OUT, 'reports', 'D-restore.json'), 'utf8'));
  mark('D', 'restore of S_D finished', { verdict: dReport.verdict });
  check('D5', 'rehearsal D', 'Reconcile (dry run) of the restored S_D: P, Q, R OK; F MISSING-UNEXPLAINED', 'OK 3, MISSING-UNEXPLAINED 1 (F)', { counts: dReport.reconcileBefore.counts, unexplained: labels(dReport.reconcileBefore.applications.filter((a) => a.state === 'MISSING-UNEXPLAINED'), Object.values(D)) }, dReport.reconcileBefore.counts.OK === 3 && dReport.reconcileBefore.counts['MISSING-UNEXPLAINED'] === 1 && dReport.reconcileBefore.applications.find((a) => a.state === 'MISSING-UNEXPLAINED')?.applicationId === D.F.id);
  check('D6', 'rehearsal D', 'The deletion log is read and applied (empty: nothing to remove); the gate REFUSES: verdict RECOVERY FAILED; the restored system stays closed and is not eligible for reopening', 'RECOVERY FAILED; MISSING_UNEXPLAINED_1; mode closed; eligible false; exit 1', { verdict: dReport.verdict, reasons: dReport.reasons, restoredSystem: dReport.restoredSystem, deletionLog: dReport.deletionLog, exit: dRestore.code }, dRestore.code === 1 && dReport.verdict === 'RECOVERY FAILED' && dReport.reasons.includes('MISSING_UNEXPLAINED_1') && dReport.restoredSystem.mode === 'closed' && dReport.restoredSystem.eligibleForOwnerReopening === false && dReport.deletionLog.available === true);
  // The restored API, as it must run after a failed verdict: closed.
  api = await startApi('D-restored-closed', apiEnv({ port: RESTORED_API_PORT, mongo: mongoUri('qa-rehearsal-api', PASSWORDS.rehearsalApi, 'valida_test_c6t6_restore_d'), bucket: 'qa-valida-restore-d', user: 'qa-rehearsal-api', moto: motoD, mode: 'closed' }));
  const dJobs = await exchange('D-restored-jobs-as-tester', { port: RESTORED_API_PORT, target: '/api/v1/jobs' });
  const dApply = await exchange('D-restored-apply-as-tester', { port: RESTORED_API_PORT, method: 'POST', target: `/api/v1/jobs/${SLUG}/applications`, headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': '0', 'idempotency-key': randomUUID() } });
  await stop(api);
  check('D7', 'rehearsal D', 'The API on the restored S_D runs closed: the Jobs list is empty and an application is refused (404) even for a listed tester', 'list empty; 404', { jobs: dJobs.json?.data?.items?.length, apply: dApply.status }, dJobs.status === 200 && dJobs.json?.data?.items?.length === 0 && dApply.status === 404);
  await motoD.stop();
  motoD = null;

  /* =========================================== REHEARSAL H: healthy ==== */
  motoH = await startBackupMoto({ python: PYTHON });
  for (const u of Object.values(motoH.users)) secrets.push(u.accessKeyId, u.secretAccessKey);
  await freshLive('H');
  const liveApiEnv = apiEnv({ port: API_PORT, mongo: appMongo, bucket: motoH.buckets.primary, user: 'qa-app', moto: motoH, mode: 'testers' });
  api = await startApi('H-live', liveApiEnv);
  const H = {};
  for (const [label, kind] of [['A', 'pdf'], ['B', 'pdf'], ['C', 'pdf'], ['D', 'docx'], ['E', 'docx']]) H[label] = await submit('H', label, kind);
  check('H1', 'rehearsal H', 'A–E (3 PDF, 2 DOCX) submitted through the real API; the checksums of the bytes SENT are kept outside the system (H1)', '5 × 201; record = sent', Object.values(H).map((a) => ({ label: a.label, status: a.status, objectRef: a.objectRef, sha256: a.checksumSha256 })), Object.values(H).every((a) => a.status === 201 && a.storedSha === a.checksumSha256 && a.storedSize === a.sizeBytes));
  const hCopy1 = await backup('H-copy-1', 'copy', [], roleEnvFor(motoH));
  const copy1At = mark('H', 'copy run 1', { complete: hCopy1.summary?.complete });
  const TH = mark('H', 'snapshot S_H taken (stand-in)');
  await copyDatabase(LIVE_DB, 'valida_test_c6t6_snapshot_h');
  await new Promise((r) => setTimeout(r, 20));
  const hCopy2 = await backup('H-copy-2', 'copy', [], roleEnvFor(motoH));
  const copy2At = mark('H', 'copy run 2 (after S_H)', { complete: hCopy2.summary?.complete });
  const hManifest = await backup('H-manifest', 'manifest', ['--snapshot-id', 'S_H', '--snapshot-time', TH.toISOString(), '--report', path.join(OUT, 'reports', 'H-manifest.json')], roleEnvFor(motoH, { BACKUP_MANIFEST_MONGODB_URI: manifestMongo }));
  check('H2', 'rehearsal H', "S_H's manifest: PRELIMINARY: NO DEFECT FOUND (5 OK); the deletion log is empty; basis LIVE_DATABASE", 'NO DEFECT FOUND; 5; 0 deletions', hManifest.summary, hManifest.code === 0 && hManifest.summary?.state === 'PRELIMINARY: NO DEFECT FOUND' && hManifest.summary?.ok === 5 && hManifest.summary?.deletionsAfterSnapshot === 0 && hManifest.summary?.basis === 'LIVE_DATABASE');

  // After T: delete B (authorised, log first); submit G with the copy paused, delete it; submit I and copy it.
  await stop(api);
  // The authorised deletion runs with the API's own configuration (its database and storage
  // credential) plus the log-writer role — the backup copier's token is not involved.
  const runDelete = (label, id) => backup(`H-delete-${label}`, 'delete-application', ['--application', id, '--authorisation', 'QA-REHEARSAL-H', '--confirm'], { ...liveApiEnv, ...roleEnvFor(motoH) });
  const delB = await runDelete('B', H.B.id);
  mark('H', 'B deleted (authorised; log entry first)');
  api = await startApi('H-live-2', liveApiEnv);
  H.G = await submit('H', 'G', 'pdf');
  await stop(api);
  const delG = await runDelete('G', H.G.id);
  mark('H', 'G deleted (authorised; never copied)');
  api = await startApi('H-live-3', liveApiEnv);
  H.I = await submit('H', 'I', 'pdf');
  await stop(api);
  const hCopy3 = await backup('H-copy-3', 'copy', [], roleEnvFor(motoH));
  const copy3At = mark('H', 'copy run 3 (I copied)', { complete: hCopy3.summary?.complete });
  check('H3', 'rehearsal H', 'B and G removed by the authorised-deletion command: the log entry first, then the record, then the exact object version (the API storage driver)', 'two entries; records removed; objects DELETED', { B: delB.summary, G: delG.summary }, delB.code === 0 && delG.code === 0 && delB.summary?.recordRemoved && delG.summary?.recordRemoved && delB.summary?.object === 'DELETED' && delG.summary?.object === 'DELETED');
  check('H4', 'rehearsal H', 'Copy runs: 1 copies A–E, 2 (after S_H) copies nothing new, 3 copies I; G was never copied (the exposure between copies)', 'complete ×3; copied 5, 0, 1', [hCopy1.summary?.copied, hCopy2.summary?.copied, hCopy3.summary?.copied], [hCopy1, hCopy2, hCopy3].every((r) => r.code === 0 && r.summary?.complete) && hCopy1.summary.copied === 5 && hCopy2.summary.copied === 0 && hCopy3.summary.copied === 1);
  const hManifest2 = await backup('H-manifest-2', 'manifest', ['--snapshot-id', 'S_H', '--snapshot-time', TH.toISOString(), '--report', path.join(OUT, 'reports', 'H-manifest-after-deletions.json')], roleEnvFor(motoH, { BACKUP_MANIFEST_MONGODB_URI: manifestMongo }));
  check('H5', 'rehearsal H', "S_H's manifest re-run after the deletions: still NO DEFECT FOUND; the two deletions after T are listed. (Preliminary: B's record is gone from the live database, so the manifest sees 4, not 5 — the limit of a live-database manifest)", 'NO DEFECT FOUND; 4; 2 deletions', hManifest2.summary, hManifest2.summary?.state === 'PRELIMINARY: NO DEFECT FOUND' && hManifest2.summary?.applicationsAtOrBeforeSnapshot === 4 && hManifest2.summary?.deletionsAfterSnapshot === 2);

  // The loss, and the restore of S_H itself.
  const LH = mark('H', 'loss declared; restore of S_H begins');
  const restoreStartedAt = Date.now();
  await copyDatabase('valida_test_c6t6_snapshot_h', 'valida_test_c6t6_restore_h');
  const dbRestoredMs = Date.now() - restoreStartedAt;
  createRestoreBucket(motoH, 'qa-valida-restore-h');
  const restoreEnv = (bucket, db, extra = {}) => roleEnvFor(motoH, { BACKUP_RESTORE_BUCKET: bucket, BACKUP_RESTORE_MONGODB_URI: mongoUri('qa-backup-restorer', PASSWORDS.restorer, db), ...extra });
  const hExpected = expectedFile('H', ['A', 'B', 'C', 'D', 'E'].map((l) => H[l]));
  const hRestore = await backup('H-restore', 'restore', ['--snapshot-id', 'S_H', '--snapshot-time', TH.toISOString(), '--expected', hExpected, '--report', path.join(OUT, 'reports', 'H-restore.json')], restoreEnv('qa-valida-restore-h', 'valida_test_c6t6_restore_h'));
  const hReport = JSON.parse(readFileSync(path.join(OUT, 'reports', 'H-restore.json'), 'utf8'));
  const restoreFinishedAt = mark('H', 'restore tool finished', { verdict: hReport.verdict });
  const all = Object.values(H);
  check('H6', 'rehearsal H', 'Reconcile (dry run) of the restored S_H: A–E OK; objects without a record: I (accepted after T — the measured loss)', 'OK 5; no missing, no mismatch; without record [I]', { counts: hReport.reconcileBefore.counts, withoutRecord: hReport.reconcileBefore.objectsWithoutRecord.map((ref) => all.find((a) => a.objectRef === ref)?.label ?? '?') }, hReport.reconcileBefore.counts.OK === 5 && hReport.reconcileBefore.counts['MISSING-UNEXPLAINED'] === 0 && hReport.reconcileBefore.counts.MISMATCH === 0 && JSON.stringify(hReport.reconcileBefore.objectsWithoutRecord) === JSON.stringify([H.I.objectRef]));
  check('H7', 'rehearsal H', 'The whole deletion log replayed: 2 entries applied, 0 failed (B: record and object removed; G: nothing in the snapshot to remove)', 'entries 2; failed 0; records removed 1; objects removed 1', hReport.deletionLogApplied, hReport.deletionLog.available && hReport.deletionLogApplied.entries === 2 && hReport.deletionLogApplied.failed.length === 0 && hReport.deletionLogApplied.recordsRemoved === 1 && hReport.deletionLogApplied.objectsRemoved === 1);
  check('H8', 'rehearsal H', 'Reconcile again: MISSING-UNEXPLAINED 0, MISMATCH 0 (A, C, D, E OK)', 'OK 4; 0; 0', hReport.reconcileAfter.counts, hReport.reconcileAfter.counts.OK === 4 && hReport.reconcileAfter.counts['MISSING-UNEXPLAINED'] === 0 && hReport.reconcileAfter.counts.MISMATCH === 0);
  const independent = ['A', 'C', 'D', 'E'].map((l) => {
    const bytes = readIndependently(motoH, 'qa-valida-restore-h', H[l].key);
    return { label: l, byteLength: bytes.length, sha256: sha256(bytes), equalsSubmission: bytes.length === H[l].sizeBytes && sha256(bytes) === H[l].checksumSha256 };
  });
  check('H9', 'rehearsal H', 'Every remaining résumé (A, C, D, E) verified by its bytes: length and SHA-256 equal the restored record AND the checksum taken at submission (H1) — by the tool and by an independent reader', '4 rows, all equal', { tool: labels(hReport.bytesVerified, all), independent }, hReport.bytesVerified.length === 4 && hReport.bytesVerified.every((r) => r.matchesRecord && r.matchesSubmission === true) && independent.every((r) => r.equalsSubmission));
  const restoredKeys = (await listKeys(endpointFor(motoH, 'qa-valida-restore-h', 'qa-fixture'), 'resumes/')).map((e) => storageObjectRef(e.key));
  const restoredDb = root.useDb('valida_test_c6t6_restore_h', { useCache: false }).db.collection('applications');
  const deletedRecords = await restoredDb.countDocuments({ _id: { $in: [H.B.id, H.G.id].map((id) => new mongoose.Types.ObjectId(id)) } });
  check('H10', 'rehearsal H', 'Deleted data stays deleted: no record and no object for B or G in the restored system', 'records 0; objects 0', { records: deletedRecords, objects: restoredKeys.filter((r) => r === H.B.objectRef || r === H.G.objectRef).length, toolCheck: hReport.deletedStaysDeleted }, deletedRecords === 0 && !restoredKeys.includes(H.B.objectRef) && !restoredKeys.includes(H.G.objectRef) && hReport.deletedStaysDeleted.resurrected.length === 0);
  check('H11', 'rehearsal H', 'Verdict: RECOVERY VERIFIED; the restored system is still closed, and only now eligible for the owner to reopen', 'RECOVERY VERIFIED; closed; eligible true; exit 0', { verdict: hReport.verdict, reasons: hReport.reasons, restoredSystem: hReport.restoredSystem, exit: hRestore.code }, hRestore.code === 0 && hReport.verdict === 'RECOVERY VERIFIED' && hReport.restoredSystem.mode === 'closed' && hReport.restoredSystem.eligibleForOwnerReopening === true);

  // Indexes, privacy, readiness — then the (simulated) owner reopening to testers, one new application.
  const indexes = await runNode(['scripts/db-indexes.mjs', 'check'], { cwd: BACKEND_DIR, env: { ...baseEnvironment(), APP_ENV: 'local', NODE_ENV: 'development', MONGODB_URI: mongoUri('qa-rehearsal-api', PASSWORDS.rehearsalApi, 'valida_test_c6t6_restore_h') }, logFile: path.join(OUT, 'logs', 'H-indexes.log'), label: 'db-indexes check (restored S_H)' });
  const anonymous = await anonymousGetStatus(endpointFor(motoH, 'qa-valida-restore-h', 'qa-fixture'), H.A.key);
  const restoredEnv = (mode) => apiEnv({ port: RESTORED_API_PORT, mongo: mongoUri('qa-rehearsal-api', PASSWORDS.rehearsalApi, 'valida_test_c6t6_restore_h'), bucket: 'qa-valida-restore-h', user: 'qa-rehearsal-api', moto: motoH, mode });
  api = await startApi('H-restored-closed', restoredEnv('closed'));
  const ready = await exchange('H-restored-readiness', { port: RESTORED_API_PORT, target: '/api/v1/health/ready' });
  const closedJobs = await exchange('H-restored-jobs-closed', { port: RESTORED_API_PORT, target: '/api/v1/jobs' });
  const readyAt = mark('H', 'restored API ready (closed)');
  await stop(api);
  check('H12', 'rehearsal H', 'Restored S_H: db-indexes check clean; an unauthenticated read of a restored object refused; readiness 200 in closed mode; Jobs list empty for a listed tester', 'exit 0; 403; 200; 0 items', { indexes: indexes.code, anonymous, readiness: ready.status, jobs: closedJobs.json?.data?.items?.length }, indexes.code === 0 && anonymous === 403 && ready.status === 200 && closedJobs.json?.data?.items?.length === 0);
  mark('H', 'the owner authorises reopening to testers (simulated in this rehearsal, on the VERIFIED verdict)');
  api = await startApi('H-restored-testers', restoredEnv('testers'));
  const testerJobs = await exchange('H-restored-jobs-testers', { port: RESTORED_API_PORT, target: '/api/v1/jobs' });
  const restoredDbFn = () => root.useDb('valida_test_c6t6_restore_h', { useCache: true }).db.collection('applications');
  const J = await submit('H', 'J-after-restore', 'pdf', RESTORED_API_PORT, restoredDbFn);
  const firstApplicationAt = J.at;
  await stop(api);
  check('H13', 'rehearsal H', 'Switched to testers: the Job is listed for a listed tester and one new synthetic application is accepted on the restored system', 'list 1; 201', { jobs: testerJobs.json?.data?.items?.length, apply: J.status }, testerJobs.json?.data?.items?.length === 1 && J.status === 201);

  // An unavailable deletion log prevents reopening.
  await copyDatabase('valida_test_c6t6_snapshot_h', 'valida_test_c6t6_restore_h2');
  createRestoreBucket(motoH, 'qa-valida-restore-h2');
  const proxy = await startFaultProxy({ upstream: motoH.endpoint });
  proxy.setPlan({ '*': [({ url }) => (url.startsWith(`/${motoH.buckets.log}`) ? { respond: { status: 503, body: '<Error><Code>ServiceUnavailable</Code></Error>' } } : 'pass')] });
  const h2 = await backup('H-restore-log-unavailable', 'restore', ['--snapshot-id', 'S_H', '--snapshot-time', TH.toISOString(), '--report', path.join(OUT, 'reports', 'H-restore-log-unavailable.json')], restoreEnv('qa-valida-restore-h2', 'valida_test_c6t6_restore_h2', { BACKUP_S3_ENDPOINT: proxy.endpoint }));
  await proxy.close();
  const h2Report = JSON.parse(readFileSync(path.join(OUT, 'reports', 'H-restore-log-unavailable.json'), 'utf8'));
  const h2Db = root.useDb('valida_test_c6t6_restore_h2', { useCache: false }).db.collection('applications');
  const bInH2 = await h2Db.countDocuments({ _id: new mongoose.Types.ObjectId(H.B.id) });
  check('H14', 'rehearsal H', 'The same healthy snapshot with the deletion log UNAVAILABLE (its store answering 503): RECOVERY FAILED, nothing replayed, not eligible for reopening — B is still in the restored data, which is exactly why it must stay closed', 'FAILED; DELETION_LOG_UNAVAILABLE; eligible false; B present', { verdict: h2Report.verdict, reasons: h2Report.reasons, restoredSystem: h2Report.restoredSystem, bRecordPresent: bInH2, exit: h2.code }, h2.code === 1 && h2Report.verdict === 'RECOVERY FAILED' && h2Report.reasons.some((r) => r.startsWith('DELETION_LOG_UNAVAILABLE')) && h2Report.restoredSystem.eligibleForOwnerReopening === false && bInH2 === 1);

  // Measured (local, synthetic; not a hosted figure, not a target).
  const measured = {
    snapshotUsed: { id: 'S_H', takenAt: TH.toISOString(), kind: 'local stand-in for the provider snapshot (a copy of the live database at T)' },
    rpo: { meaning: 'age of S_H at the moment of loss', ms: LH - TH },
    exposureBetweenCopies: {
      designBound: 'up to one hour between scheduled runs, plus a run’s own duration (D-9: hourly)',
      copyRuns: [{ run: 1, at: copy1At.toISOString() }, { run: 2, at: copy2At.toISOString() }, { run: 3, at: copy3At.toISOString() }],
      neverCopied: { application: 'G', submittedAt: H.G.at.toISOString(), note: 'submitted and deleted between copy runs; had it been lost instead of deleted, no copy would have existed' },
      copiedLate: { application: 'I', submittedAt: H.I.at.toISOString(), copiedByRun: 3, exposedMs: copy3At - H.I.at },
    },
    rto: {
      meaning: 'from the loss to the restored API accepting an application, after the owner’s reopening',
      databaseRestoredMs: dbRestoredMs,
      restoreToolMs: restoreFinishedAt - LH - dbRestoredMs,
      restoreToolSteps: hReport.timings,
      toReadyClosedMs: readyAt - LH,
      toFirstApplicationMs: firstApplicationAt - LH,
    },
    damaged: { snapshot: 'S_D', verdict: dReport.verdict, lossToVerdictMs: new Date(dReport.completedAt) - LD },
    environment: 'local: one machine, a disposable MongoDB 8 and the moto S3 double; synthetic data. Not a hosted measurement',
  };
  writeFileSync(path.join(OUT, 'reports', 'measured.json'), `${JSON.stringify(measured, null, 2)}\n`);
  check('X1', 'measured', 'RPO and RTO of this LOCAL run are recorded, with the snapshot used and the exposure between copies', 'measured.json written', { rpoMs: measured.rpo.ms, toFirstApplicationMs: measured.rto.toFirstApplicationMs, iExposedMs: measured.exposureBetweenCopies.copiedLate.exposedMs }, measured.rpo.ms > 0 && measured.rto.toFirstApplicationMs > 0);
} catch (error) {
  check('RUN', 'harness', 'The rehearsal ran to completion', 'no exception', `${error?.name}: ${sanitise(error?.message ?? '')}`, false);
} finally {
  for (const child of [...children]) await stop(child);
  await motoD?.stop();
  await motoH?.stop();
  await root?.close().catch(() => {});
  if (mongodChild && mongodChild.exitCode === null) {
    await new Promise((resolve) => {
      mongodChild.once('exit', resolve);
      mongodChild.kill('SIGTERM');
    });
  }
  if (mongoDir) rmSync(mongoDir, { recursive: true, force: true });
}

writeFileSync(path.join(OUT, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`);
// Evidence hygiene: no credential, connection string or storage key anywhere in OUT.
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(OUT);
const leaks = files.filter((file) => {
  const text = readFileSync(file, 'utf8');
  return [...secrets, ...storageKeys].some((s) => s && text.includes(s)) || /mongodb:\/\/[^\s"[]+:[^\s"@]+@/.test(text) || /resumes\/[0-9a-f]{32}\/[0-9a-f]{32}/.test(text);
});
for (const file of leaks) writeFileSync(file, sanitise(readFileSync(file, 'utf8')));
check('K1', 'evidence', 'No credential, connection string or storage key in any evidence file (found ones are redacted and the check fails)', '0 files', { files: files.length, leaks: leaks.map((f) => path.relative(OUT, f)) }, leaks.length === 0);
writeFileSync(path.join(OUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
const failed = results.filter((r) => !r.pass);
process.stdout.write(`\n${results.length - failed.length}/${results.length} passed\n`);
process.exit(failed.length ? 1 : 0);
