import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { ADMIN_RESTORE_STATE_COLLECTION, adminStartupGate } from '../../src/modules/admin/restoreRebaseline.js';
import { cli, connect, createLiveUsers, oplogMark, parts, requireAdmins, restoreInto, seed, sha256, tmpdir, writesSince } from './recoveryFixture.js';

/**
 * D-3 (owner, 2026-11-22) — `mongo-recovery.mjs restore-rebaseline` between two
 * auth-enabled replica sets. The applicant-deletion gate (restore-verify) is
 * MANDATORY and runs first, unchanged: on any verdict but RECOVERY VERIFIED the
 * command writes nothing to the Admin and the Admin stays closed. Only after
 * VERIFIED, and only on the verified target cluster, every restored Admin is
 * revoked and one owner gets a fresh activation link (a 0600 file, never
 * stdout). Synthetic data only.
 */
const { ObjectId } = mongoose.mongo;
const ADMIN = requireAdmins();
const NS = `qa-rb-${randomBytes(3).toString('hex')}`;
const LIVE_DB = `valida_test_rb_${randomBytes(3).toString('hex')}`;
const LIVE_SET = parts(ADMIN.live).setName;
const ORIGIN = 'http://localhost:5173';
const OWNER = 'qa-owner-rb@example.invalid';
const RECRUITER = 'qa-recruiter-rb@example.invalid';
let live;
let target;
let users;
let work;
let n = 0;
const state = {};

const mongoJournal = (extra = {}) => ({ APP_ENV: 'local', NODE_ENV: 'test', BACKUP_JOURNAL_STORE: 'mongodb', BACKUP_JOURNAL_NAMESPACE: NS, ...extra });
const writer = () => mongoJournal({ RECOVERY_OPERATOR_MONGODB_URI: users.valida_deletion_operator });
const reader = () => mongoJournal({ RECOVERY_JOURNAL_MONGODB_URI: users.valida_journal_reader });

function adminDoc(email, roles) {
  const now = new Date();
  return {
    _id: new ObjectId(), email, emailNormalized: email, displayName: `QA ${roles[0]}`, status: 'ACTIVE', roles, lastLoginAt: now, createdByAdminId: null,
    authentication: { passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$cWE$cWE', passwordChangedAt: now, emailVerifiedAt: now, authVersion: 3, activationTokenHash: null, activationExpiresAt: null, resetTokenHash: 'a'.repeat(64), resetTokenExpiresAt: new Date(Date.now() + 1_800_000), failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null },
    mfa: { required: true, enabled: true, method: 'TOTP', secretCiphertext: 'qa-ciphertext', encryptionKeyId: 'qa1', enrolledAt: now, lastUsedTimeStep: 1, recoveryCodes: [{ hash: 'b'.repeat(64), usedAt: null }], pendingSecretCiphertext: null, pendingEncryptionKeyId: null, pendingExpiresAt: null },
    createdAt: now, updatedAt: now, __v: 0,
  };
}
async function snapshotAll() {
  const out = {};
  for (const { name } of await live.db(LIVE_DB).listCollections({}, { nameOnly: true }).toArray()) out[name] = await live.db(LIVE_DB).collection(name).find({}).toArray();
  return out;
}
async function preparedTarget(snap) {
  n += 1;
  const db = `valida_test_rst_rb_${n}_${randomBytes(2).toString('hex')}`;
  await restoreInto(target, db, snap);
  const targetId = randomBytes(16).toString('hex');
  const writerFile = path.join(work, `writer-${n}.uri`);
  const prep = await cli(['prepare-target', '--target-id', targetId, '--expires-hours', '4', '--writer-uri-out', writerFile], {
    RECOVERY_TARGET_ADMIN_MONGODB_URI: ADMIN.target, RECOVERY_LIVE_REPLICA_SET: LIVE_SET, RECOVERY_RESTORED_DATABASE: db,
  });
  expect(prep.code, prep.stderr).toBe(0);
  return { db, targetId, writerUri: fs.readFileSync(writerFile, 'utf8').trim(), link: path.join(work, `link-${n}.txt`) };
}
const rebaselineEnv = (t, extra = {}) => ({
  ...reader(), RECOVERY_RESTORED_MONGODB_URI: t.writerUri, RECOVERY_RESTORE_TARGET_ID: t.targetId, RECOVERY_LIVE_REPLICA_SET: LIVE_SET,
  RECOVERY_LIVE_MONGODB_URI: users.valida_api_runtime, RECOVERY_TARGET_ADMIN_MONGODB_URI: ADMIN.target, ADMIN_APP_ORIGIN: ORIGIN, ...extra,
});
const args = (t, extra = []) => ['restore-rebaseline', '--owner', OWNER, '--link-out', t.link, '--snapshot-id', 'qa-rb-s0', '--anchor', state.anchor1, ...extra];
const adminsOf = (db) => target.db(db).collection('admins').find({}).sort({ email: 1 }).toArray();
const TARGET_SET = parts(ADMIN.target).setName;
const gateOn = (db) => adminStartupGate(target.db(db), { expectedReplicaSet: TARGET_SET });

beforeAll(async () => {
  live = await connect(ADMIN.live);
  target = await connect(ADMIN.target);
  users = await createLiveUsers(live, ADMIN.live, LIVE_DB);
  work = tmpdir();
  expect((await cli(['journal-init'], writer())).code).toBe(0);
  state.ids = await seed(live, LIVE_DB, 2);
  await live.db(LIVE_DB).collection('admins').insertMany([adminDoc(OWNER, ['ADMIN_OWNER']), adminDoc(RECRUITER, ['RECRUITMENT_ADMIN'])]);
  // The live anchor (`npm run db:identity:init`): every snapshot carries it.
  await live.db(LIVE_DB).collection('database_identity').insertOne({ _id: 'live', setName: LIVE_SET, database: LIVE_DB, recordedAt: new Date() });
  await live.db(LIVE_DB).collection('admin_sessions').insertMany([{ _id: 'qa-sid-owner', expires: new Date(Date.now() + 3_600_000), session: { principalType: 'ADMIN' } }, { _id: 'qa-sid-recruiter', expires: new Date(Date.now() + 3_600_000), session: { principalType: 'ADMIN' } }]);
  state.s0 = await snapshotAll();
  // After the snapshot: an authorised deletion (the gate must re-apply it) and an Admin revocation (it cannot).
  const d = await cli(['delete-application', '--application', state.ids[0], '--authorisation', 'QA-RB-1', '--confirm'], writer());
  expect(d.code, d.stderr).toBe(0);
  state.anchor1 = d.out.anchor;
  state.export1 = path.join(work, 'journal-1.json');
  expect((await cli(['journal-export', '--out', state.export1], reader())).code).toBe(0);
  await live.db(LIVE_DB).collection('admins').updateOne({ email: RECRUITER }, { $set: { status: 'DISABLED' }, $inc: { 'authentication.authVersion': 1 } });
}, 120_000);

afterAll(async () => {
  await live.db(LIVE_DB).dropDatabase().catch(() => {});
  const dbs = await target.db('admin').admin().listDatabases();
  for (const { name } of dbs.databases) if (name.startsWith('valida_test_rst_rb_')) await target.db(name).dropDatabase();
  await live.close();
  await target.close();
  fs.rmSync(work, { recursive: true, force: true });
});

describe('restore-rebaseline: the deletion gate first, then the Admin', () => {
  it('refuses before anything is read or written when its own inputs are missing', async () => {
    const t = await preparedTarget(state.s0);
    const tm = await oplogMark(target);
    for (const [label, a, env] of [
      ['no --owner', args(t).filter((x, i, all) => x !== '--owner' && all[i - 1] !== '--owner'), rebaselineEnv(t)],
      ['no --link-out', args(t).filter((x, i, all) => x !== '--link-out' && all[i - 1] !== '--link-out'), rebaselineEnv(t)],
      ['no target admin URI', args(t), rebaselineEnv(t, { RECOVERY_TARGET_ADMIN_MONGODB_URI: undefined })],
      ['no ADMIN_APP_ORIGIN', args(t), rebaselineEnv(t, { ADMIN_APP_ORIGIN: undefined })],
    ]) {
      const r = await cli(a, env);
      expect(r.code, label).toBe(2);
    }
    expect(await writesSince(target, tm, `${t.db}.`)).toBe(0);
    expect(fs.existsSync(t.link)).toBe(false);
  });

  it('deletion gate NOT passed (live journal unavailable, export only): verdict FAILED, Admin CLOSED, zero writes, no link', async () => {
    const t = await preparedTarget(state.s0);
    const tm = await oplogMark(target);
    const lm = await oplogMark(live);
    const r = await cli(args(t, ['--journal-file', state.export1]), rebaselineEnv(t, { RECOVERY_JOURNAL_MONGODB_URI: undefined, RECOVERY_LIVE_MONGODB_URI: undefined }));
    expect(r.code).toBe(1);
    expect(r.out).toMatchObject({ command: 'restore-rebaseline', verdict: 'RECOVERY FAILED', reasons: ['DELETION_HISTORY_FRESHNESS_UNKNOWN'], admin: 'CLOSED' });
    expect(await writesSince(target, tm, `${t.db}.`)).toBe(0);
    expect(await writesSince(live, lm, `${LIVE_DB}.`)).toBe(0);
    expect(fs.existsSync(t.link)).toBe(false);
    expect(await gateOn(t.db)).toEqual({ open: false, reason: 'ADMIN_RESTORE_NOT_REBASELINED' });
    // The restored data still holds the deleted applicant AND the revoked recruiter as ACTIVE: closed is the only safe state.
    expect(await target.db(t.db).collection('applications').countDocuments({ _id: new ObjectId(state.ids[0]) })).toBe(1);
    expect((await adminsOf(t.db)).find((a) => a.email === RECRUITER).status).toBe('ACTIVE');
  });

  it('gate VERIFIED but the admin URI names the LIVE cluster: Admin CLOSED, no Admin write anywhere', async () => {
    const t = await preparedTarget(state.s0);
    const before = await adminsOf(t.db);
    const liveAdmins = await live.db(LIVE_DB).collection('admins').find({}).sort({ email: 1 }).toArray();
    const r = await cli(args(t), rebaselineEnv(t, { RECOVERY_TARGET_ADMIN_MONGODB_URI: ADMIN.live }));
    expect(r.code).toBe(1);
    expect(r.out).toMatchObject({ verdict: 'RECOVERY VERIFIED', admin: 'CLOSED', reasons: ['ADMIN_URI_NOT_THE_VERIFIED_TARGET'] });
    expect(await adminsOf(t.db)).toEqual(before);
    expect(await live.db(LIVE_DB).collection('admins').find({}).sort({ email: 1 }).toArray()).toEqual(liveAdmins);
    expect(await target.db(t.db).collection(ADMIN_RESTORE_STATE_COLLECTION).countDocuments({})).toBe(0);
    expect(fs.existsSync(t.link)).toBe(false);
  });

  it('gate VERIFIED on the target: deletion re-applied, every Admin revoked, one owner re-enabled, link in a 0600 file, then the mark', async () => {
    const t = await preparedTarget(state.s0);
    state.t = t;
    const r = await cli(args(t), rebaselineEnv(t));
    expect(r.code, r.stderr).toBe(0);
    expect(r.out).toMatchObject({ verdict: 'RECOVERY VERIFIED', applied: { applications: 1, files: 1 }, history: { freshness: 'LIVE_JOURNAL' }, admin: 'REBASELINED', adminsDisabled: 2, sessionsRemoved: 2 });
    expect(r.stdout).not.toMatch(/token|mongodb:\/\//i);
    // The applicant deletion holds; only then was the Admin touched.
    expect(await target.db(t.db).collection('applications').countDocuments({ _id: new ObjectId(state.ids[0]) })).toBe(0);
    const [owner, recruiter] = await adminsOf(t.db);
    expect(owner).toMatchObject({ email: OWNER, status: 'ACTIVE', authentication: { passwordHash: null, resetTokenHash: null, authVersion: 4, restoreFence: { targetId: t.targetId, epoch: 1 }, activationTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) }, mfa: { enabled: false, secretCiphertext: null, recoveryCodes: [] } });
    expect(recruiter).toMatchObject({ email: RECRUITER, status: 'DISABLED', authentication: { passwordHash: null, activationTokenHash: null, authVersion: 4 }, mfa: { enabled: false, secretCiphertext: null } });
    expect(await target.db(t.db).collection('admin_sessions').countDocuments({})).toBe(0);
    expect(await gateOn(t.db)).toMatchObject({ open: true, basis: 'REBASELINED' });
    const [link] = fs.readFileSync(t.link, 'utf8').split('\n');
    expect(link).toMatch(new RegExp(`^${ORIGIN}/admin/activate#token=[A-Za-z0-9_-]{20,}$`));
    // Delivered BEFORE the marker, and the marker names this attempt, this cluster and this database.
    expect(await target.db(t.db).collection(ADMIN_RESTORE_STATE_COLLECTION).findOne({ _id: t.targetId })).toMatchObject({ state: 'REBASELINED', attempt: r.out.attempt, setName: TARGET_SET, database: t.db });
    expect(owner.authentication.activationTokenHash).toBe(sha256(link.split('#token=')[1]));
    expect(fs.statSync(t.link).mode & 0o777).toBe(0o600);
    // The live cluster was not touched by the re-baseline.
    expect((await live.db(LIVE_DB).collection('admins').findOne({ email: OWNER })).authentication.authVersion).toBe(3);
  });

  it('a FRESH UNMARKED restore (snapshot restored, nothing prepared) is closed on its own cluster: the inherited anchor names the live database', async () => {
    n += 1;
    const db = `valida_test_rst_rb_${n}_${randomBytes(2).toString('hex')}`;
    await restoreInto(target, db, state.s0);
    expect(await gateOn(db)).toEqual({ open: false, reason: 'ADMIN_RESTORE_NOT_REBASELINED' });
    expect(await adminStartupGate(target.db(db), { expectedReplicaSet: LIVE_SET })).toEqual({ open: false, reason: 'ADMIN_DATABASE_IDENTITY_MISMATCH' });
  });

  it('a SECOND-GENERATION restore carrying the older marker is closed; prepare-target ignores the inherited authorisation; only its own re-baseline opens it', async () => {
    // A snapshot of the re-baselined database (its authorisation AND its REBASELINED marker inside), restored elsewhere.
    const snap = {};
    for (const { name } of await target.db(state.t.db).listCollections({}, { nameOnly: true }).toArray()) snap[name] = await target.db(state.t.db).collection(name).find({}).toArray();
    expect(snap[ADMIN_RESTORE_STATE_COLLECTION]).toHaveLength(1);
    const t2 = await preparedTarget(snap); // succeeds: the inherited authorisation is set aside, unchanged
    expect(await target.db(t2.db).collection('restore_authorization').find({}, { projection: { _id: 0, targetId: 1 } }).toArray()).toEqual([{ targetId: t2.targetId }]);
    expect(await target.db(t2.db).collection('restore_authorization_inherited').find({}, { projection: { _id: 0, targetId: 1, movedFor: 1 } }).toArray()).toEqual([{ targetId: state.t.targetId, movedFor: t2.targetId }]);
    expect(await gateOn(t2.db)).toEqual({ open: false, reason: 'ADMIN_RESTORE_NOT_REBASELINED' }); // the older marker does not count
    const r = await cli(args(t2), rebaselineEnv(t2));
    expect(r.code, r.stderr).toBe(0);
    expect(r.out).toMatchObject({ verdict: 'RECOVERY VERIFIED', admin: 'REBASELINED', target: { targetId: t2.targetId, database: t2.db } });
    expect(await gateOn(t2.db)).toMatchObject({ open: true, basis: 'REBASELINED' });
  });

  it('a second run re-verifies the deletion gate and refuses the Admin step (ALREADY_REBASELINED)', async () => {
    const before = await adminsOf(state.t.db);
    fs.rmSync(state.t.link);
    const r = await cli(args(state.t), rebaselineEnv(state.t));
    expect(r.code).toBe(1);
    expect(r.out).toMatchObject({ verdict: 'RECOVERY VERIFIED', applied: { alreadyAbsent: 1 }, admin: 'CLOSED', reasons: ['ADMIN_ALREADY_REBASELINED'] });
    expect(await adminsOf(state.t.db)).toEqual(before);
    expect(fs.existsSync(state.t.link)).toBe(false);
  });
});
