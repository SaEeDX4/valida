import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { roleDefinitions } from '../../src/ops/backup/mongoRoles.js';

/**
 * Proposed (MongoDB-native) — LOCAL EVIDENCE that the operational roles cannot
 * alter the deletion log or a stored résumé version. An auth-enabled local
 * mongod enforces the same role model Atlas custom roles create; confirming the
 * same in Atlas (Flex) is a Review check (decision sheet).
 */
const { MongoClient, Binary } = mongoose.mongo;
const ADMIN = process.env.MONGODB_ROLES_ADMIN_URI;
if (!ADMIN) throw new Error('MONGODB_ROLES_ADMIN_URI is required (an auth-enabled, disposable MongoDB)');
const DB = 'valida_test_roles';
const host = new URL(ADMIN.replace('mongodb://', 'http://')).host;
let admin;
const clients = {};
const users = {};

const unauthorized = (p) => expect(p).rejects.toMatchObject({ code: 13 });

beforeAll(async () => {
  admin = new MongoClient(ADMIN);
  await admin.connect();
  const db = admin.db(DB);
  await db.dropDatabase();
  for (const [role, privileges] of Object.entries(roleDefinitions(DB))) {
    await db.command({ createRole: role, privileges, roles: [] });
    const pwd = randomBytes(18).toString('hex');
    await db.command({ createUser: `qa_${role}`, pwd, roles: [{ role, db: DB }] });
    users[role] = pwd;
    clients[role] = new MongoClient(`mongodb://qa_${role}:${pwd}@${host}/${DB}?authSource=${DB}`);
    await clients[role].connect();
  }
  await db.collection('resume_files').insertOne({ _id: 'resumes/seed', sizeBytes: 1, checksumSha256: 'a'.repeat(64), data: new Binary(Buffer.from('x')) });
  await db.collection('applications').insertOne({ _id: 'qa-app', resume: { scanStatus: 'NOT_SCANNED' } });
});
afterAll(async () => {
  for (const c of Object.values(clients)) await c.close();
  const db = admin.db(DB);
  for (const role of Object.keys(roleDefinitions(DB))) {
    await db.command({ dropUser: `qa_${role}` }).catch(() => {});
    await db.command({ dropRole: role }).catch(() => {});
  }
  await db.dropDatabase();
  await admin.close();
});

const col = (role, name) => clients[role].db(DB).collection(name);

describe('r2: no live role can forge a restore authorisation or destroy a collection', () => {
  // The deletion history is no longer in this database (it is the independent journal); what a live role must
  // never be able to do is mark a database as an authorised restore target, or drop what a restore would check.
  it('no live role can write restore_authorization, drop a collection or the database', async () => {
    for (const role of Object.keys(roleDefinitions(DB))) {
      await unauthorized(col(role, 'restore_authorization').insertOne({ targetId: 'qa-forged' }));
      await unauthorized(col(role, 'applications').drop());
      await unauthorized(col(role, 'resume_files').drop());
      await unauthorized(clients[role].db(DB).dropDatabase());
    }
  });
});

describe('stored résumé versions are immutable to operational roles', () => {
  it('the storage user can insert, read and remove a version, but never update one', async () => {
    const files = col('valida_resume_storage', 'resume_files');
    await files.insertOne({ _id: 'resumes/qa', sizeBytes: 1, checksumSha256: 'b'.repeat(64), data: new Binary(Buffer.from('y')) });
    await unauthorized(files.updateOne({ _id: 'resumes/seed' }, { $set: { data: new Binary(Buffer.from('z')) } }));
    await unauthorized(files.replaceOne({ _id: 'resumes/seed' }, { sizeBytes: 9 }));
    expect((await files.deleteOne({ _id: 'resumes/qa' })).deletedCount).toBe(1);
    await unauthorized(col('valida_resume_storage', 'applications').findOne({}));
  });
  it('the API runtime cannot read résumé bytes; the scanner can read them and update an Application, not a résumé', async () => {
    await unauthorized(col('valida_api_runtime', 'resume_files').findOne({}));
    expect(await col('valida_resume_scanner', 'resume_files').findOne({ _id: 'resumes/seed' })).toBeTruthy();
    await unauthorized(col('valida_resume_scanner', 'resume_files').updateOne({ _id: 'resumes/seed' }, { $set: { sizeBytes: 2 } }));
    expect((await col('valida_resume_scanner', 'applications').updateOne({ _id: 'qa-app' }, { $set: { 'resume.scanStatus': 'PENDING' } })).matchedCount).toBe(1);
  });
});
