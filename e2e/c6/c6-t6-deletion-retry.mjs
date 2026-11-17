#!/usr/bin/env node
/**
 * C6-T6 correction — the ACTUAL authorised-deletion command
 * (`backend/scripts/backup.mjs delete-application`), interrupted and retried,
 * against the local S3-compatible double and a disposable MongoDB.
 *
 *   VALIDA_TEST_MOTO_PYTHON=<python with moto[server]> \
 *   VALIDA_TEST_MONGOD=<path to mongod 8> \
 *     node c6/c6-t6-deletion-retry.mjs --out <evidence directory>
 *
 * What runs: a MongoDB 8 started here WITH ACCESS CONTROL (the API's user;
 * a user that may read but not remove, for the database fault; a test-side
 * root); the moto double with its scoped users (backend/tests/backup/
 * backup_moto_setup.py); a fault proxy in front of the store; the command as
 * a separate process with the API's configuration (S3 driver, the API's own
 * token) plus the log-writer role.
 *
 *   R1  the store refuses the object DELETE once  → INCOMPLETE, record and object kept; retry COMPLETE
 *   R2  the DELETE happens, its answer is lost    → INCOMPLETE (UNCERTAIN), record kept; retry COMPLETE (ABSENT)
 *   R3  the database refuses the record removal   → INCOMPLETE, object gone, record kept; retry COMPLETE
 *   R4  completion repeated; an unrelated object later under the same key → NO_RECORD; it survives
 *   R5  a record whose key holds a different object → OBJECT_MISMATCH; that object survives; record kept
 *   R6  the log cannot be written                 → nothing deleted
 *   K1  no storage key, credential or connection string in any evidence file
 */
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { syntheticPdf } from '../../backend/tests/fixtures/resumeFiles.js';
import { destroyPrimaryObject, listVersions, putPrimary, readIndependently, resumeKey, roleEnv, sha256, startBackupMoto } from '../../backend/tests/backup/backupFixture.js';
import { startFaultProxy } from '../../backend/tests/s3/faultProxy.js';
import { storageObjectRef } from '../../backend/src/integrations/storage/storageContract.js';
import { BACKEND_DIR } from '../support/paths.js';
import { baseEnvironment, runNode } from '../support/processes.js';

const { values: args } = parseArgs({ options: { out: { type: 'string' } } });
const OUT = path.resolve(args.out ?? path.join(os.tmpdir(), 'valida-c6-t6-deletion-retry'));
mkdirSync(path.join(OUT, 'logs'), { recursive: true });
const PYTHON = process.env.VALIDA_TEST_MOTO_PYTHON;
const MONGOD = process.env.VALIDA_TEST_MONGOD;
if (!PYTHON || !MONGOD) {
  console.error('refused: VALIDA_TEST_MOTO_PYTHON and VALIDA_TEST_MONGOD are required');
  process.exit(2);
}
const MONGO_PORT = Number(process.env.C6T6_DELETION_MONGO_PORT ?? 4440);
const DB = 'valida_test_c6t6_deletion';
const secret = () => `qa-${randomBytes(18).toString('hex')}`;
const PW = { root: secret(), api: secret(), noRemove: secret() };
const secrets = Object.values(PW);
const keys = [];
const sanitise = (text) => {
  let out = String(text);
  for (const v of [...secrets, ...keys]) if (v) out = out.split(v).join('[REDACTED]');
  return out.replace(/mongodb:\/\/[^@\s"]+@/g, 'mongodb://[REDACTED]@');
};
const results = [];
function check(id, description, expected, actual, pass) {
  results.push({ id, description, expected, actual: sanitise(JSON.stringify(actual)), pass: Boolean(pass) });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${description}\n`);
}
const uri = (user, pw) => `mongodb://${user}:${pw}@127.0.0.1:${MONGO_PORT}/${DB}?authSource=admin`;
const portOpen = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });

const mongoose = createRequire(path.join(BACKEND_DIR, 'package.json'))('mongoose');
let mongod;
let mongoDir;
let moto;
let root;
const proxies = [];
let step = 0;
try {
  mongoDir = mkdtempSync(path.join(os.tmpdir(), 'valida-c6t6-del-mongo-'));
  mongod = spawn(MONGOD, ['--auth', '--port', String(MONGO_PORT), '--bind_ip', '127.0.0.1', '--dbpath', mongoDir, '--quiet'], { stdio: 'ignore' });
  for (let i = 0; !(await portOpen(MONGO_PORT)); i += 1) {
    if (i > 300) throw new Error('mongod did not start');
    await new Promise((r) => setTimeout(r, 100));
  }
  const boot = await mongoose.createConnection(`mongodb://127.0.0.1:${MONGO_PORT}/admin`, { serverSelectionTimeoutMS: 10_000 }).asPromise();
  await boot.db.command({ createUser: 'qa-root', pwd: PW.root, roles: ['root'] });
  await boot.close();
  root = await mongoose.createConnection(`mongodb://qa-root:${PW.root}@127.0.0.1:${MONGO_PORT}/admin?authSource=admin`, { serverSelectionTimeoutMS: 10_000 }).asPromise();
  await root.db.command({ createUser: 'qa-api', pwd: PW.api, roles: [{ role: 'readWrite', db: DB }] });
  await root.db.command({ createRole: 'qa-read-no-remove', privileges: [{ resource: { db: DB, collection: '' }, actions: ['find', 'insert', 'update'] }], roles: [] });
  await root.db.command({ createUser: 'qa-no-remove', pwd: PW.noRemove, roles: [{ role: 'qa-read-no-remove', db: 'admin' }] });
  const apps = root.useDb(DB, { useCache: true }).db.collection('applications');

  moto = await startBackupMoto({ python: PYTHON });
  for (const u of Object.values(moto.users)) secrets.push(u.accessKeyId, u.secretAccessKey);
  const storeProxy = await startFaultProxy({ upstream: moto.endpoint });
  const logProxy = await startFaultProxy({ upstream: moto.endpoint });
  proxies.push(storeProxy, logProxy);
  storeProxy.setPlan({ '*': ['pass'] });
  logProxy.setPlan({ '*': ['pass'] });

  async function application(label) {
    const bytes = syntheticPdf({ text: `QA TEST DOCUMENT C6-T6 deletion retry ${label} ${randomBytes(6).toString('hex')}` });
    const key = resumeKey();
    keys.push(key);
    await putPrimary(moto, key, bytes);
    const _id = new mongoose.Types.ObjectId();
    await apps.insertOne({ _id, createdAt: new Date(), resume: { storageKey: key, sizeBytes: bytes.length, checksumSha256: sha256(bytes) }, qaSynthetic: true });
    return { id: String(_id), key, bytes, objectRef: storageObjectRef(key) };
  }
  async function command(label, a, { mongoUser = ['qa-api', PW.api] } = {}) {
    step += 1;
    const env = {
      ...baseEnvironment(),
      ...roleEnv(moto),
      BACKUP_S3_ENDPOINT: logProxy.endpoint,
      APP_ENV: 'local',
      NODE_ENV: 'development',
      MONGODB_URI: uri(...mongoUser),
      TRANSACTIONAL_EMAIL_PROVIDER: 'none',
      RESUME_STORAGE_DRIVER: 's3',
      RESUME_STORAGE_S3_ENDPOINT: storeProxy.endpoint,
      RESUME_STORAGE_S3_REGION: 'us-east-1',
      RESUME_STORAGE_S3_BUCKET: moto.buckets.primary,
      RESUME_STORAGE_S3_ACCESS_KEY_ID: moto.users['qa-app'].accessKeyId,
      RESUME_STORAGE_S3_SECRET_ACCESS_KEY: moto.users['qa-app'].secretAccessKey,
      RESUME_STORAGE_S3_TIMEOUT_MS: '2000',
    };
    const r = await runNode(['scripts/backup.mjs', 'delete-application', '--application', a.id, '--authorisation', 'QA-T6-CORRECTION', '--confirm'], { cwd: BACKEND_DIR, env, logFile: path.join(OUT, 'logs', `${String(step).padStart(2, '0')}-${label}.log`), label });
    let line = null;
    try {
      line = JSON.parse(r.stdout.trim().split('\n').pop());
    } catch {
      line = null;
    }
    return { code: r.code, line, stderr: sanitise(r.stderr.trim()) };
  }
  const state = async (a) => ({ record: (await apps.countDocuments({ _id: new mongoose.Types.ObjectId(a.id) })) === 1, versions: listVersions(moto, moto.buckets.primary, a.key).filter((v) => v.key === a.key).length });
  /** Fault only the object's own DELETE (the driver's start-up probe uses other keys). */
  const once = (a, mode) => {
    let used = false;
    storeProxy.setPlan({ DELETE: [({ url }) => (!used && url.includes(a.key.split('/')[2]) ? ((used = true), mode) : 'pass')] });
  };

  /** DELETEs sent for THIS application's key (the driver's start-up probe deletes its own probe object). */
  const deletesOf = (a) => storeProxy.log.filter((e) => e.method === 'DELETE' && e.path.includes(a.key.split('/')[2])).length;

  // R1
  const a1 = await application('R1');
  once(a1, 'status:503');
  const r1a = await command('R1-first', a1);
  const s1a = await state(a1);
  const r1b = await command('R1-retry', a1);
  const s1b = await state(a1);
  check('R1', 'Store refuses the DELETE once, after the log entry: INCOMPLETE with record and object kept; the retry COMPLETES', 'exit 1 INCOMPLETE {record, 1 version}; exit 0 COMPLETE DELETED {no record, 0 versions}', { first: { code: r1a.code, ...r1a.line, ...s1a }, retry: { code: r1b.code, ...r1b.line, ...s1b } }, r1a.code === 1 && r1a.line?.status === 'INCOMPLETE' && s1a.record && s1a.versions === 1 && r1b.code === 0 && r1b.line?.status === 'COMPLETE' && r1b.line?.object === 'DELETED' && !s1b.record && s1b.versions === 0);

  // R2
  const a2 = await application('R2');
  once(a2, 'lose-answer');
  const r2a = await command('R2-first', a2);
  const s2a = await state(a2);
  const r2b = await command('R2-retry', a2);
  const s2b = await state(a2);
  check('R2', 'The DELETE happens but its answer is lost: reported UNCERTAIN, record kept; the retry sees the object absent and COMPLETES', 'exit 1 INCOMPLETE UNCERTAIN {record, 0 versions}; exit 0 COMPLETE ABSENT {no record}', { first: { code: r2a.code, ...r2a.line, ...s2a }, retry: { code: r2b.code, ...r2b.line, ...s2b } }, r2a.code === 1 && r2a.line?.object === 'UNCERTAIN' && s2a.record && s2a.versions === 0 && r2b.code === 0 && r2b.line?.status === 'COMPLETE' && r2b.line?.object === 'ABSENT' && !s2b.record);
  storeProxy.setPlan({ '*': ['pass'] });

  // R3
  const a3 = await application('R3');
  const r3a = await command('R3-first', a3, { mongoUser: ['qa-no-remove', PW.noRemove] });
  const s3a = await state(a3);
  const r3b = await command('R3-retry', a3);
  const s3b = await state(a3);
  check('R3', 'The database refuses the record removal after the object is removed: INCOMPLETE, record kept; the retry COMPLETES', 'exit 1 INCOMPLETE DELETED DATABASE_UNAVAILABLE {record, 0 versions}; exit 0 COMPLETE ABSENT {no record}', { first: { code: r3a.code, ...r3a.line, ...s3a }, retry: { code: r3b.code, ...r3b.line, ...s3b } }, r3a.code === 1 && r3a.line?.status === 'INCOMPLETE' && r3a.line?.object === 'DELETED' && r3a.line?.reason === 'DATABASE_UNAVAILABLE' && s3a.record && s3a.versions === 0 && r3b.code === 0 && r3b.line?.status === 'COMPLETE' && !s3b.record);

  // R4
  const a4 = await application('R4');
  const r4a = await command('R4-complete', a4);
  const unrelated = syntheticPdf({ text: 'QA TEST DOCUMENT C6-T6 unrelated replacement' });
  await putPrimary(moto, a4.key, unrelated);
  storeProxy.log.length = 0;
  const r4b = await command('R4-repeat', a4);
  const survived = readIndependently(moto, moto.buckets.primary, a4.key).equals(unrelated);
  check('R4', 'Completion repeated after an unrelated object was written under the same key: NO_RECORD, no DELETE sent for its key, the unrelated object survives', 'exit 0 COMPLETE; then exit 0 NO_RECORD; 0 DELETE; survives', { first: { code: r4a.code, status: r4a.line?.status }, repeat: { code: r4b.code, ...r4b.line }, deletes: deletesOf(a4), survived }, r4a.code === 0 && r4a.line?.status === 'COMPLETE' && r4b.code === 0 && r4b.line?.status === 'NO_RECORD' && deletesOf(a4) === 0 && survived);

  // R5
  const a5 = await application('R5');
  // Replace the recorded object's bytes: remove every version test-side, then write other bytes.
  destroyPrimaryObject(moto, a5.key);
  const other = syntheticPdf({ text: 'QA TEST DOCUMENT C6-T6 not the recorded object' });
  await putPrimary(moto, a5.key, other);
  storeProxy.log.length = 0;
  const r5 = await command('R5-mismatch', a5);
  const s5 = await state(a5);
  check('R5', 'A record whose key holds a different object: OBJECT_MISMATCH, no DELETE sent for its key, that object survives, the record is kept', 'exit 1 OBJECT_MISMATCH; 0 DELETE; survives; record', { code: r5.code, ...r5.line, deletes: deletesOf(a5), survived: readIndependently(moto, moto.buckets.primary, a5.key).equals(other), ...s5 }, r5.code === 1 && r5.line?.status === 'OBJECT_MISMATCH' && deletesOf(a5) === 0 && readIndependently(moto, moto.buckets.primary, a5.key).equals(other) && s5.record);

  // R6
  const a6 = await application('R6');
  logProxy.setPlan({ PUT: [{ respond: { status: 503, body: '<Error><Code>ServiceUnavailable</Code></Error>' } }] });
  const r6 = await command('R6-log-unavailable', a6);
  const s6 = await state(a6);
  logProxy.setPlan({ '*': ['pass'] });
  check('R6', 'The deletion-log entry cannot be written: nothing is deleted', 'exit 1; record and 1 version remain', { code: r6.code, stderr: r6.stderr, ...s6 }, r6.code === 1 && s6.record && s6.versions === 1);
} catch (error) {
  check('RUN', 'The exercise ran to completion', 'no exception', `${error?.name}: ${sanitise(error?.message ?? '')}`, false);
} finally {
  for (const p of proxies) await p.close();
  await moto?.stop();
  await root?.close().catch(() => {});
  if (mongod && mongod.exitCode === null) {
    await new Promise((resolve) => {
      mongod.once('exit', resolve);
      mongod.kill('SIGTERM');
    });
  }
  if (mongoDir) rmSync(mongoDir, { recursive: true, force: true });
}

const files = [];
const walk = (d) => readdirSync(d).forEach((n) => (statSync(path.join(d, n)).isDirectory() ? walk(path.join(d, n)) : files.push(path.join(d, n))));
walk(OUT);
const leaks = files.filter((f) => {
  const t = readFileSync(f, 'utf8');
  return [...secrets, ...keys].some((s) => s && t.includes(s)) || /mongodb:\/\/[^\s"[]+:[^\s"@]+@/.test(t) || /resumes\/[0-9a-f]{32}\/[0-9a-f]{32}/.test(t);
});
for (const f of leaks) writeFileSync(f, sanitise(readFileSync(f, 'utf8')));
check('K1', 'No storage key, credential or connection string in any evidence file', '0 files', { files: files.length, leaks: leaks.map((f) => path.relative(OUT, f)) }, leaks.length === 0);
writeFileSync(path.join(OUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
const failed = results.filter((r) => !r.pass);
process.stdout.write(`\n${results.length - failed.length}/${results.length} passed\n`);
process.exit(failed.length ? 1 : 0);
