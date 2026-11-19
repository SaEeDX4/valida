import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoPrivateStorage } from '../../src/integrations/storage/mongoPrivateStorage.js';
import { deletionJournal, mongoJournalStore } from '../../src/ops/backup/deletionJournal.js';
import { deleteApplicationDurably } from '../../src/ops/backup/durableDeletion.js';
import { cli, connect, createLiveUsers, oplogMark, parts, requireAdmins, restoreInto, seed, tmpdir, writesSince } from './recoveryFixture.js';

/**
 * Atlas-native (2026-11-18) — the decisive recovery case, with NO external provider:
 * the deletion journal is the insert-only `deletion_journal` collection in the live
 * cluster (BACKUP_JOURNAL_STORE=mongodb), the anchor is kept by the owner outside Atlas.
 *
 *   1. snapshot  →  2. authorised deletion of an Application AND its résumé AFTER the snapshot
 *   →  3. restore the OLDER snapshot into an isolated target  →  4. the gate re-applies the
 *   deletion and both stay inaccessible on the target BEFORE any service user exists there.
 *
 * And when trustworthy history is not available (live journal lost or unreachable, only an older
 * copy of it, a copy altered, or the journal pointed at the target itself) the gate fails with ZERO
 * writes and the target stays closed: the deleted applicant is still in it, so it must never serve.
 * Synthetic data only. Every command runs as its own process with the least-privilege users.
 */
const { ObjectId } = mongoose.mongo;
const ADMIN = requireAdmins();
const NS = `qa-an-${randomBytes(3).toString('hex')}`;
const LIVE_DB = `valida_test_an_${randomBytes(3).toString('hex')}`;
const LIVE_SET = parts(ADMIN.live).setName;
const COLLECTIONS = ['applications', 'resume_files', 'deletion_journal'];
let live;
let target;
let users;
let work;
let n = 0;
const state = {};

const mongoJournal = (extra = {}) => ({ APP_ENV: 'local', NODE_ENV: 'test', BACKUP_JOURNAL_STORE: 'mongodb', BACKUP_JOURNAL_NAMESPACE: NS, ...extra });
const writer = () => mongoJournal({ RECOVERY_OPERATOR_MONGODB_URI: users.valida_deletion_operator });
const reader = () => mongoJournal({ RECOVERY_JOURNAL_MONGODB_URI: users.valida_journal_reader });

/** A simulated Atlas snapshot: EVERY collection, the journal's own copy included. */
async function atlasSnapshot() {
  const out = {};
  for (const name of COLLECTIONS) out[name] = await live.db(LIVE_DB).collection(name).find({}).toArray();
  return out;
}
async function preparedTarget(snap) {
  n += 1;
  const db = `valida_test_rst_an_${n}_${randomBytes(2).toString('hex')}`;
  await restoreInto(target, db, snap);
  const targetId = randomBytes(16).toString('hex');
  const writerFile = path.join(work, `writer-${n}.uri`);
  const prep = await cli(['prepare-target', '--target-id', targetId, '--expires-hours', '4', '--writer-uri-out', writerFile], {
    RECOVERY_TARGET_ADMIN_MONGODB_URI: ADMIN.target, RECOVERY_LIVE_REPLICA_SET: LIVE_SET, RECOVERY_RESTORED_DATABASE: db,
  });
  expect(prep.code, prep.stderr).toBe(0);
  return { db, targetId, writerUri: fs.readFileSync(writerFile, 'utf8').trim() };
}
const gateEnv = (t, extra = {}) => ({
  ...reader(), RECOVERY_RESTORED_MONGODB_URI: t.writerUri, RECOVERY_RESTORE_TARGET_ID: t.targetId,
  RECOVERY_LIVE_REPLICA_SET: LIVE_SET, RECOVERY_LIVE_MONGODB_URI: users.valida_api_runtime, ...extra,
});
const appCount = (db, id) => target.db(db).collection('applications').countDocuments({ _id: new ObjectId(id) });
const fileCount = (db, key) => target.db(db).collection('resume_files').countDocuments({ _id: key });
/** No database user on the target may serve the application until the gate says VERIFIED. */
async function serviceUsers(db) {
  const { users: list } = await target.db(db).command({ usersInfo: 1 });
  return list.filter((u) => !u.user.startsWith('valida_restore_')).length;
}
async function zeroWrites(fn) {
  const [lm, tm] = [await oplogMark(live), await oplogMark(target)];
  const result = await fn();
  expect(await writesSince(live, lm, `${LIVE_DB}.`)).toBe(0);
  expect(await writesSince(target, tm, 'valida_test_rst_an_')).toBe(0);
  return result;
}

beforeAll(async () => {
  live = await connect(ADMIN.live);
  target = await connect(ADMIN.target);
  expect(LIVE_SET).not.toBe(parts(ADMIN.target).setName);
  users = await createLiveUsers(live, ADMIN.live, LIVE_DB);
  work = tmpdir();
});
afterAll(async () => {
  await live.db(LIVE_DB).dropDatabase().catch(() => {});
  const dbs = await target.db('admin').admin().listDatabases();
  for (const { name } of dbs.databases) if (name.startsWith('valida_test_rst_an_')) await target.db(name).dropDatabase();
  await live.close();
  await target.close();
  fs.rmSync(work, { recursive: true, force: true });
});

describe('Atlas-native recovery: the journal in the live cluster', () => {
  it('the journal is insert-only for its writer and invisible to the API user', async () => {
    const init = await cli(['journal-init'], writer());
    expect(init.code, init.stderr).toBe(0);
    expect(init.out.checkpoint.count).toBe(0);
    state.anchor0 = init.out.anchor;
    const op = await connect(users.valida_deletion_operator);
    const api = await connect(users.valida_api_runtime);
    try {
      const j = op.db().collection('deletion_journal');
      expect(await j.countDocuments({})).toBe(1);
      await expect(j.updateOne({}, { $set: { bytes: 'x' } })).rejects.toMatchObject({ code: 13 });
      await expect(j.deleteOne({})).rejects.toMatchObject({ code: 13 });
      await expect(j.replaceOne({}, { bytes: 'x' })).rejects.toMatchObject({ code: 13 });
      await expect(op.db().collection('deletion_journal').drop()).rejects.toMatchObject({ code: 13 });
      await expect(api.db().collection('deletion_journal').findOne({})).rejects.toMatchObject({ code: 13 });
    } finally {
      await op.close();
      await api.close();
    }
  });

  it('DECISIVE: a deletion after the snapshot stays deleted when the older snapshot is restored into an isolated target', async () => {
    const ids = await seed(live, LIVE_DB, 3);
    state.ids = ids;
    const victim = await live.db(LIVE_DB).collection('applications').findOne({ _id: new ObjectId(ids[0]) });
    state.victimKey = victim.resume.storageKey;
    state.s0 = await atlasSnapshot(); // the older snapshot: applicant and résumé present
    state.export0 = path.join(work, 'journal-0.json');
    expect((await cli(['journal-export', '--out', state.export0], reader())).out.anchor).toBe(state.anchor0);

    // The authorised deletion, AFTER the snapshot: journal entry + checkpoint first, then résumé, then record.
    const d = await cli(['delete-application', '--application', ids[0], '--authorisation', 'QA-AN-1', '--confirm'], writer());
    expect(d.code, d.stderr).toBe(0);
    expect(d.out).toMatchObject({ status: 'COMPLETE', object: 'DELETED', recordRemoved: true, checkpoint: { count: 1 } });
    expect(d.stdout).not.toMatch(/mongodb:\/\/|resumes\//);
    state.anchor1 = d.out.anchor; // the owner records this OUTSIDE Atlas
    expect(await live.db(LIVE_DB).collection('applications').countDocuments({ _id: new ObjectId(ids[0]) })).toBe(0);
    expect(await live.db(LIVE_DB).collection('resume_files').countDocuments({ _id: state.victimKey })).toBe(0);
    state.export1 = path.join(work, 'journal-1.json');
    const ex = await cli(['journal-export', '--out', state.export1], reader());
    expect(ex.out).toMatchObject({ anchor: state.anchor1, objects: 3 });
    // The export carries ids, the opaque résumé reference and digests only: no applicant field, no storage key.
    const exportText = Buffer.concat(JSON.parse(fs.readFileSync(state.export1, 'utf8')).objects.map((o) => Buffer.from(o.bytes, 'base64'))).toString();
    expect(exportText).not.toContain(state.victimKey);
    expect(exportText).not.toMatch(/@|keyHash|checksumSha256/);

    // Restore the OLDER snapshot into an isolated target: the applicant is back in the raw restore.
    const t = await preparedTarget(state.s0);
    expect(await appCount(t.db, ids[0])).toBe(1);
    expect(await fileCount(t.db, state.victimKey)).toBe(1);
    expect(await serviceUsers(t.db)).toBe(0); // closed: nothing can serve from it

    const r = await cli(['restore-verify', '--snapshot-id', 'qa-an-s0', '--anchor', state.anchor1], gateEnv(t));
    expect(r.code, r.stderr).toBe(0);
    expect(r.out).toMatchObject({
      verdict: 'RECOVERY VERIFIED', applied: { applications: 1, files: 1, alreadyAbsent: 0 }, missing: 0, mismatched: 0,
      history: { checkpointed: 1, pending: 0, checkpoint: { count: 1 }, freshness: 'LIVE_JOURNAL' }, target: { database: t.db, targetId: t.targetId },
    });
    // Both inaccessible BEFORE service resumes: record gone, résumé gone, the storage driver refuses it.
    expect(await appCount(t.db, ids[0])).toBe(0);
    expect(await fileCount(t.db, state.victimKey)).toBe(0);
    for (const id of ids.slice(1)) expect(await appCount(t.db, id)).toBe(1);
    const p = parts(ADMIN.target);
    const storage = new MongoPrivateStorage({ uri: `mongodb://${encodeURIComponent(p.user)}:${encodeURIComponent(p.pwd)}@${p.host}/${t.db}?authSource=admin&replicaSet=${p.setName}`, mode: 'read-only' });
    await storage.init();
    try {
      const expectVersion = { sizeBytes: victim.resume.sizeBytes, checksumSha256: victim.resume.checksumSha256 };
      expect(await storage.readPrivateObject(state.victimKey, { expect: expectVersion })).toEqual({ found: false });
      expect(await storage.statPrivateObject(state.victimKey)).toEqual({ exists: false });
    } finally {
      await storage.close();
    }
    expect(await serviceUsers(t.db)).toBe(0); // still closed until the owner opens it after VERIFIED
  });

  it('live cluster lost, offline export of the newest checkpoint kept: closed until the owner attests it, then VERIFIED from the export alone', async () => {
    const t = await preparedTarget(state.s0);
    const lost = gateEnv(t, { RECOVERY_JOURNAL_MONGODB_URI: undefined, RECOVERY_LIVE_MONGODB_URI: undefined });
    const closed = await zeroWrites(() => cli(['restore-verify', '--snapshot-id', 'qa-an-s0', '--anchor', state.anchor1, '--journal-file', state.export1], lost));
    expect(closed.out).toMatchObject({ verdict: 'RECOVERY FAILED', reasons: ['DELETION_HISTORY_FRESHNESS_UNKNOWN'], history: { freshness: 'EXPORT_ONLY' } });
    expect(await appCount(t.db, state.ids[0])).toBe(1);
    const r = await cli(['restore-verify', '--snapshot-id', 'qa-an-s0', '--anchor', state.anchor1, '--journal-file', state.export1, '--owner-attestation', 'QA-OWNER-REC-AN'], lost);
    expect(r.code, r.stderr).toBe(0);
    expect(r.out).toMatchObject({ verdict: 'RECOVERY VERIFIED', applied: { applications: 1, files: 1 }, history: { freshness: 'OWNER_ATTESTED_EXPORT', attestation: 'QA-OWNER-REC-AN' } });
    expect(await appCount(t.db, state.ids[0])).toBe(0);
    expect(await fileCount(t.db, state.victimKey)).toBe(0);
  });

  it('no trustworthy history: the gate fails with ZERO writes and the target stays closed with the applicant still in it', async () => {
    const t = await preparedTarget(state.s0);
    // The snapshot's own journal copy (what is left if the live cluster AND every export are lost) is older than the anchor.
    const snapJournal = path.join(work, 'journal-from-snapshot.json');
    fs.writeFileSync(snapJournal, JSON.stringify({ schema: 'valida.deletion-journal.export.v1', objects: state.s0.deletion_journal.map((d) => ({ key: d._id, bytes: Buffer.from(d.bytes.buffer).toString('base64') })) }));
    const dead = 'mongodb://qa:qa@127.0.0.1:1/valida?authSource=admin&replicaSet=none';
    const tampered = path.join(work, 'journal-tampered.json');
    const json = JSON.parse(fs.readFileSync(state.export1, 'utf8'));
    const entry = json.objects.find((o) => o.key.includes('/entries/'));
    entry.bytes = Buffer.from(Buffer.from(entry.bytes, 'base64').toString().replace('QA-AN-1', 'QA-AN-9')).toString('base64');
    fs.writeFileSync(tampered, JSON.stringify(json));
    const cases = [
      ['only the snapshot\'s own (older) journal copy', ['--journal-file', snapJournal], {}, 'DELETION_HISTORY_STALE'],
      ['an older offline export', ['--journal-file', state.export0], {}, 'DELETION_HISTORY_STALE'],
      ['the live journal unreachable', [], { RECOVERY_JOURNAL_MONGODB_URI: dead, RECOVERY_LIVE_MONGODB_URI: undefined }, 'DELETION_HISTORY_UNAVAILABLE'],
      ['an altered export', ['--journal-file', tampered], {}, 'DELETION_HISTORY_TAMPERED'],
    ];
    for (const [label, args, env, reason] of cases) {
      const r = await zeroWrites(() => cli(['restore-verify', '--snapshot-id', 'qa-an-s0', '--anchor', state.anchor1, ...args], gateEnv(t, env)));
      expect(r.code, label).toBe(1);
      expect(r.out, label).toMatchObject({ verdict: 'RECOVERY FAILED', reasons: [reason] });
    }
    // The journal pointed at the restore target itself is refused before anything is read or written there.
    const self = await zeroWrites(() => cli(['restore-verify', '--snapshot-id', 'qa-an-s0', '--anchor', state.anchor1], gateEnv(t, { RECOVERY_JOURNAL_MONGODB_URI: t.writerUri })));
    expect(self.code).toBe(1);
    expect(self.out).toMatchObject({ verdict: 'RECOVERY REFUSED' });
    expect(self.out.reasons.join(' ')).toMatch(/URI_OVERLAP/);
    // Closed: the deleted applicant is still present in this target, and nothing may serve from it.
    expect(await appCount(t.db, state.ids[0])).toBe(1);
    expect(await fileCount(t.db, state.victimKey)).toBe(1);
    expect(await serviceUsers(t.db)).toBe(0);
  });

  it('a journal rewritten inside Atlas (account-level compromise) is detected against the owner anchor', async () => {
    // Test-side superuser stands in for someone with Atlas project rights: rewrites history to hide the deletion.
    const j = live.db(LIVE_DB).collection('deletion_journal');
    const original = await j.find({}).toArray();
    await j.deleteMany({ _id: { $not: /checkpoints\/0000000000\.json$/ } });
    const t = await preparedTarget(state.s0);
    const r = await zeroWrites(() => cli(['restore-verify', '--snapshot-id', 'qa-an-s0', '--anchor', state.anchor1], gateEnv(t)));
    expect(r.out).toMatchObject({ verdict: 'RECOVERY FAILED', reasons: ['DELETION_HISTORY_STALE'] });
    // A changed document under the same key: its stored digest no longer matches.
    await j.deleteMany({});
    await j.insertMany(original.map((d) => (d._id.includes('/entries/') ? { ...d, bytes: Buffer.from(Buffer.from(d.bytes.buffer).toString().replace('QA-AN-1', 'QA-AN-9')) } : d)));
    const r2 = await zeroWrites(() => cli(['restore-verify', '--snapshot-id', 'qa-an-s0', '--anchor', state.anchor1], gateEnv(t)));
    expect(r2.out).toMatchObject({ verdict: 'RECOVERY FAILED', reasons: ['DELETION_HISTORY_TAMPERED'] });
    await j.deleteMany({});
    await j.insertMany(original);
  });

  it('Atlas path: prepare-target --atlas-users writes only the authorisation and prints the role; a console-created user passes the gate', async () => {
    n += 1;
    const db = `valida_test_rst_an_${n}_${randomBytes(2).toString('hex')}`;
    await restoreInto(target, db, state.s0);
    const targetId = randomBytes(16).toString('hex');
    const tm = await oplogMark(target);
    const prep = await cli(['prepare-target', '--target-id', targetId, '--expires-hours', '4', '--atlas-users'], {
      RECOVERY_TARGET_ADMIN_MONGODB_URI: ADMIN.target, RECOVERY_LIVE_REPLICA_SET: LIVE_SET, RECOVERY_RESTORED_DATABASE: db,
    });
    expect(prep.code, prep.stderr).toBe(0);
    expect(await writesSince(target, tm, `${db}.`)).toBe(1); // the authorisation document only
    expect(await target.db(db).command({ usersInfo: 1 })).toMatchObject({ users: [] });
    const { roleName, actions } = prep.out.atlasCustomRole;
    expect(actions.map((a) => `${a.resources[0].collection}:${a.action}`).sort()).toEqual(['applications:FIND', 'applications:REMOVE', 'restore_authorization:FIND', 'resume_files:FIND', 'resume_files:REMOVE']);
    // The owner's console step, simulated: the printed role, one user with it.
    const camel = (a) => a.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    await target.db(db).command({ createRole: roleName, privileges: actions.map((a) => ({ resource: a.resources[0], actions: [camel(a.action)] })), roles: [] });
    const pwd = randomBytes(18).toString('hex');
    await target.db(db).command({ createUser: `${roleName}_u`, pwd, roles: [{ role: roleName, db }] });
    const p = parts(ADMIN.target);
    const t = { db, targetId, writerUri: `mongodb://${roleName}_u:${pwd}@${p.host}/${db}?authSource=${db}&replicaSet=${p.setName}` };
    const r = await cli(['restore-verify', '--snapshot-id', 'qa-an-s0', '--anchor', state.anchor1], gateEnv(t));
    expect(r.code, r.stderr).toBe(0);
    expect(r.out).toMatchObject({ verdict: 'RECOVERY VERIFIED', applied: { applications: 1, files: 1 } });
    expect(await appCount(db, state.ids[0])).toBe(0);
  });

  // The outstanding case (owner, 2026-11-18): a deletion completes, but the process stops before its new
  // checkpoint is captured outside Atlas; the live journal is then unavailable and the owner supplies the
  // previous matching export and checkpoint. Freshness cannot be established: the target stays closed.
  it('OUTSTANDING: deletion complete, new checkpoint never captured, live journal unavailable, previous export + checkpoint supplied: closed, zero writes', async () => {
    const d2 = await cli(['delete-application', '--application', state.ids[1], '--authorisation', 'QA-AN-2', '--confirm'], writer());
    expect(d2.out).toMatchObject({ status: 'COMPLETE', recordRemoved: true, checkpoint: { count: 2 } });
    // Interrupted here: anchor 2 and its export are NOT captured. The owner still holds anchor 1 + export 1, which match each other.
    const key2 = state.s0.applications.find((a) => String(a._id) === state.ids[1]).resume.storageKey;
    const t = await preparedTarget(state.s0);
    const dead = 'mongodb://qa:qa@127.0.0.1:1/valida?authSource=admin&replicaSet=none';
    const cases = [
      ['previous export + previous checkpoint, live journal unavailable', ['--journal-file', state.export1], { RECOVERY_JOURNAL_MONGODB_URI: undefined, RECOVERY_LIVE_MONGODB_URI: undefined }, 'DELETION_HISTORY_FRESHNESS_UNKNOWN'],
      ['previous export + previous checkpoint, live journal configured but unreachable', ['--journal-file', state.export1], { RECOVERY_JOURNAL_MONGODB_URI: dead, RECOVERY_LIVE_MONGODB_URI: undefined }, 'DELETION_HISTORY_FRESHNESS_UNKNOWN'],
      ['previous checkpoint, live journal unreachable', [], { RECOVERY_JOURNAL_MONGODB_URI: dead, RECOVERY_LIVE_MONGODB_URI: undefined }, 'DELETION_HISTORY_UNAVAILABLE'],
    ];
    for (const [label, args, env, reason] of cases) {
      const r = await zeroWrites(() => cli(['restore-verify', '--snapshot-id', 'qa-an-s0', '--anchor', state.anchor1, ...args], gateEnv(t, env)));
      expect(r.code, label).toBe(1);
      expect(r.out, label).toMatchObject({ verdict: 'RECOVERY FAILED', reasons: [reason] });
    }
    // Closed: the applicant deleted after the uncaptured checkpoint is still in the target; nothing may serve from it.
    expect(await appCount(t.db, state.ids[1])).toBe(1);
    expect(await fileCount(t.db, key2)).toBe(1);
    expect(await serviceUsers(t.db)).toBe(0);
    // Once the live journal is reachable again, freshness is established there: the old anchor is a prefix of its head.
    const ok = await cli(['restore-verify', '--snapshot-id', 'qa-an-s0', '--anchor', state.anchor1], gateEnv(t));
    expect(ok.code, ok.stderr).toBe(0);
    expect(ok.out).toMatchObject({ verdict: 'RECOVERY VERIFIED', applied: { applications: 2, files: 2 }, history: { checkpoint: { count: 2 }, freshness: 'LIVE_JOURNAL' } });
    expect(await appCount(t.db, state.ids[1])).toBe(0);
    expect(await fileCount(t.db, key2)).toBe(0);
  });

  it('OUTSTANDING (variant): the process is interrupted after the entry and BEFORE the checkpoint is written: nothing deleted; export path closed; live path applies the pending entry', async () => {
    const op = await connect(users.valida_deletion_operator);
    const storage = new MongoPrivateStorage({ uri: users.valida_deletion_operator, mode: 'deletion' });
    await storage.init();
    try {
      const raw = op.db().collection('deletion_journal');
      // The interruption: every checkpoint write fails (the process is gone before it reaches the server).
      const interrupted = new Proxy(raw, {
        get(target2, prop) {
          if (prop === 'insertOne') {
            return async (doc, options) => {
              if (String(doc._id).includes('/checkpoints/')) throw Object.assign(new Error('interrupted'), { name: 'MongoNetworkError' });
              return target2.insertOne(doc, options);
            };
          }
          const value = target2[prop];
          return typeof value === 'function' ? value.bind(target2) : value;
        },
      });
      const journal = deletionJournal(mongoJournalStore(interrupted), { namespace: NS });
      const result = await deleteApplicationDurably({ applicationId: state.ids[2], authorisation: 'QA-AN-3', applications: op.db().collection('applications'), storage, journal });
      expect(result.status).toBe('INCOMPLETE');
    } finally {
      await storage.close();
      await op.close();
    }
    expect(await live.db(LIVE_DB).collection('applications').countDocuments({ _id: new ObjectId(state.ids[2]) })).toBe(1); // nothing deleted
    const t = await preparedTarget(state.s0);
    const closed = await zeroWrites(() => cli(['restore-verify', '--snapshot-id', 'qa-an-s0', '--anchor', state.anchor1, '--journal-file', state.export1], gateEnv(t, { RECOVERY_JOURNAL_MONGODB_URI: undefined, RECOVERY_LIVE_MONGODB_URI: undefined })));
    expect(closed.out).toMatchObject({ verdict: 'RECOVERY FAILED', reasons: ['DELETION_HISTORY_FRESHNESS_UNKNOWN'] });
    expect(await serviceUsers(t.db)).toBe(0);
    const ok = await cli(['restore-verify', '--snapshot-id', 'qa-an-s0', '--anchor', state.anchor1], gateEnv(t));
    expect(ok.out).toMatchObject({ verdict: 'RECOVERY VERIFIED', applied: { applications: 3 }, history: { checkpointed: 2, pending: 1, freshness: 'LIVE_JOURNAL' } });
  });
});
