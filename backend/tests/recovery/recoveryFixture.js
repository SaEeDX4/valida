import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { roleDefinitions } from '../../src/ops/backup/mongoRoles.js';
import { generateResumeStorageKey } from '../../src/integrations/storage/storageContract.js';
import { syntheticPdf } from '../fixtures/resumeFiles.js';

/**
 * Proposed (MongoDB-native r2) — helpers for the recovery suite. The admin
 * clients are TEST-SIDE ONLY (seeding, the simulated snapshot, the zero-write
 * oracle); the commands under test run as separate processes with the
 * least-privilege users. Synthetic data only.
 */
const { MongoClient, Binary, ObjectId } = mongoose.mongo;
const run = promisify(execFile);
export const SCRIPT = path.resolve('scripts/mongo-recovery.mjs');
export const sha256 = (b) => createHash('sha256').update(b).digest('hex');

export function requireAdmins() {
  const live = process.env.MONGODB_RECOVERY_LIVE_ADMIN_URI;
  const target = process.env.MONGODB_RECOVERY_TARGET_ADMIN_URI;
  if (!live || !target) throw new Error('MONGODB_RECOVERY_LIVE_ADMIN_URI and MONGODB_RECOVERY_TARGET_ADMIN_URI are required (two disposable auth-enabled replica sets)');
  return { live, target };
}

export const parts = (uri) => {
  const u = new URL(uri.replace(/^mongodb:\/\//, 'http://'));
  return { user: decodeURIComponent(u.username), pwd: decodeURIComponent(u.password), host: u.host, setName: u.searchParams.get('replicaSet') };
};
/** The same admin URI, pointed at another database (authSource stays admin). */
export const adminUriFor = (uri, db) => uri.replace(/\/[^/?]*(\?|$)/, `/${db}$1`);

export async function connect(uri) {
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await c.connect();
  return c;
}

/** Live roles and users in `db` on the live cluster; returns their URIs. */
export async function createLiveUsers(admin, adminUri, db) {
  const { host, setName } = parts(adminUri);
  const uris = {};
  const d = admin.db(db);
  for (const [role, privileges] of Object.entries(roleDefinitions(db))) {
    await d.command({ createRole: role, privileges, roles: [] });
    const pwd = randomBytes(18).toString('hex');
    await d.command({ createUser: `qa_${role}`, pwd, roles: [{ role, db }] });
    uris[role] = `mongodb://qa_${role}:${pwd}@${host}/${db}?authSource=${db}&replicaSet=${setName}`;
  }
  return uris;
}

/** Seeds n Applications with their résumé documents (admin, test side). */
export async function seed(admin, db, n) {
  const ids = [];
  for (let i = 0; i < n; i += 1) {
    const pdf = Buffer.concat([syntheticPdf(), Buffer.from(`%qa-${randomBytes(4).toString('hex')}`)]);
    const key = generateResumeStorageKey();
    const _id = new ObjectId();
    await admin.db(db).collection('resume_files').insertOne({ _id: key, schema: 'valida.resume-file.v1', sizeBytes: pdf.length, checksumSha256: sha256(pdf), data: new Binary(pdf), storedAt: new Date(), attempt: 'qa' });
    await admin.db(db).collection('applications').insertOne({ _id, idempotency: { keyHash: randomBytes(32).toString('hex') }, resume: { storageProvider: 'MONGODB', storageKey: key, sizeBytes: pdf.length, checksumSha256: sha256(pdf), scanStatus: 'NOT_SCANNED' } });
    ids.push(String(_id));
  }
  return ids;
}

/** A simulated snapshot: the live collections as they are now, kept in memory. */
export async function snapshot(admin, db) {
  const out = {};
  for (const name of ['applications', 'resume_files']) out[name] = await admin.db(db).collection(name).find({}).toArray();
  return out;
}

/** "Restores" a snapshot into a NEW database on the target cluster (test side, admin). */
export async function restoreInto(targetAdmin, db, snap) {
  await targetAdmin.db(db).dropDatabase();
  for (const [name, docs] of Object.entries(snap)) if (docs.length) await targetAdmin.db(db).collection(name).insertMany(docs);
}

/** The newest oplog timestamp of a replica set. */
export async function oplogMark(admin) {
  const [last] = await admin.db('local').collection('oplog.rs').find({}).sort({ $natural: -1 }).limit(1).toArray();
  return last.ts;
}
/** Every write to databases matching `prefix` since `mark` (the zero-write oracle). */
export async function writesSince(admin, mark, prefix) {
  return admin.db('local').collection('oplog.rs').countDocuments({ ts: { $gt: mark }, ns: { $regex: `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` }, op: { $in: ['i', 'u', 'd'] } });
}

export function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qa-recovery-'));
}

export function journalEnv(moto, role, { endpoint = moto.endpoint, namespace } = {}) {
  const user = role === 'writer' ? 'qa-journal-writer' : 'qa-journal-reader';
  const prefix = role === 'writer' ? 'BACKUP_JOURNAL_WRITER' : 'BACKUP_JOURNAL_READER';
  return {
    APP_ENV: 'local', NODE_ENV: 'test',
    BACKUP_S3_ENDPOINT: endpoint, BACKUP_S3_REGION: 'us-east-1', BACKUP_S3_TIMEOUT_MS: '3000', BACKUP_LOG_BUCKET: moto.buckets.log,
    [`${prefix}_ACCESS_KEY_ID`]: moto.users[user].accessKeyId, [`${prefix}_SECRET_ACCESS_KEY`]: moto.users[user].secretAccessKey,
    BACKUP_JOURNAL_NAMESPACE: namespace,
  };
}

/** Runs the recovery CLI as its own process with ONLY `env` (plus PATH). */
export async function cli(args, env) {
  const clean = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== null));
  try {
    const { stdout, stderr } = await run(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH, ...clean }, timeout: 60_000 });
    if (process.env.QA_DEBUG) console.error('CLI', args[0], stdout.trim().replace(/mongodb:\/\/\S*/g, '[uri]'), stderr.trim());
    return { code: 0, out: stdout.trim() ? JSON.parse(stdout.trim().split('\n').pop()) : null, stdout, stderr };
  } catch (error) {
    const text = error.stdout?.trim();
    if (process.env.QA_DEBUG) console.error('CLI', args[0], error.code, (text ?? '').replace(/mongodb:\/\/\S*/g, '[uri]'), (error.stderr ?? '').trim());
    return { code: error.code, out: text ? JSON.parse(text.split('\n').pop()) : null, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}
