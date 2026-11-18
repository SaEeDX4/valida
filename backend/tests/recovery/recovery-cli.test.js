import { describe, it, expect, inject, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { listVersions, readIndependently, tryDeleteVersion } from '../backup/backupFixture.js';
import {
  adminUriFor, cli, connect, createLiveUsers, journalEnv, oplogMark, parts, requireAdmins, restoreInto, seed, snapshot, tmpdir, writesSince,
} from './recoveryFixture.js';

/**
 * Proposed (MongoDB-native r2) — findings 1 and 2, end to end, every command
 * as its own process with the least-privilege users:
 *   - the journal (independent locked bucket, moto double) holds the replay
 *     record and checkpoint BEFORE a deletion is reported complete, and
 *     survives the loss of the whole primary database;
 *   - restores from older snapshots re-apply later deletions; stale,
 *     incomplete or tampered history is refused; an empty history (genesis)
 *     restores;
 *   - the restore target is positively identified before the first write; a
 *     live, aliased, ambiguous, unauthorised, over-privileged or incompletely
 *     configured target is refused with ZERO writes (oplog oracle on both
 *     clusters), on the journal path and on the offline-export path.
 */
const { ObjectId } = mongoose.mongo;
const moto = inject('backupMoto');
const ADMIN = requireAdmins();
const NS = `qa-${randomBytes(4).toString('hex')}`;
const LIVE_DB = `valida_test_live_${randomBytes(3).toString('hex')}`;
const LIVE_SET = parts(ADMIN.live).setName;
let live;
let target;
let users;
let work;
let n = 0;
const writer = () => journalEnv(moto, 'writer', { namespace: NS });
const reader = () => journalEnv(moto, 'reader', { namespace: NS });

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
  for (const { name } of dbs.databases) if (name.startsWith('valida_test_rst_')) await target.db(name).dropDatabase();
  await live.close();
  await target.close();
  fs.rmSync(work, { recursive: true, force: true });
});

/** A fresh restore target database holding `snap`, prepared by the owner command. */
async function preparedTarget(snap, { expiresHours = '4' } = {}) {
  n += 1;
  const db = `valida_test_rst_${n}_${randomBytes(2).toString('hex')}`;
  await restoreInto(target, db, snap);
  const targetId = randomBytes(16).toString('hex');
  const writerFile = path.join(work, `writer-${n}.uri`);
  const prep = await cli(['prepare-target', '--target-id', targetId, '--expires-hours', expiresHours, '--writer-uri-out', writerFile], {
    RECOVERY_TARGET_ADMIN_MONGODB_URI: ADMIN.target, RECOVERY_LIVE_REPLICA_SET: LIVE_SET, RECOVERY_RESTORED_DATABASE: db,
  });
  expect(prep.code, prep.stderr).toBe(0);
  return { db, targetId, writerUri: fs.readFileSync(writerFile, 'utf8').trim() };
}
const restoreEnv = (t, extra = {}) => ({ ...reader(), RECOVERY_RESTORED_MONGODB_URI: t.writerUri, RECOVERY_RESTORE_TARGET_ID: t.targetId, RECOVERY_LIVE_REPLICA_SET: LIVE_SET, RECOVERY_LIVE_MONGODB_URI: users.valida_api_runtime, ...extra });
const del = (id, auth) => cli(['delete-application', '--application', id, '--authorisation', auth, '--confirm'], { ...writer(), RECOVERY_OPERATOR_MONGODB_URI: users.valida_deletion_operator });
const count = (client, db, id) => client.db(db).collection('applications').countDocuments({ _id: new ObjectId(id) });

/** Runs `fn` and asserts it wrote NOTHING to the live database or to any restore target. */
async function zeroWrites(fn) {
  const [lm, tm] = [await oplogMark(live), await oplogMark(target)];
  const result = await fn();
  expect(await writesSince(live, lm, `${LIVE_DB}.`)).toBe(0);
  expect(await writesSince(target, tm, 'valida_test_rst_')).toBe(0);
  return result;
}

describe('the durable deletion history (finding 2)', () => {
  const state = {};

  it('an uninitialised journal is refused (never read as an empty history), with zero writes', async () => {
    const ids = await seed(live, LIVE_DB, 4);
    state.ids = ids;
    state.s0 = await snapshot(live, LIVE_DB); // before any deletion
    const t = await preparedTarget(state.s0);
    const r = await zeroWrites(() => cli(['restore-verify', '--snapshot-id', 'qa-s0', '--anchor', `0:${'0'.repeat(64)}`], restoreEnv(t)));
    expect(r.code).toBe(1);
    expect(r.out).toMatchObject({ verdict: 'RECOVERY FAILED', reasons: ['DELETION_HISTORY_NOT_INITIALISED'] });
    // A delete is refused too: nothing is deleted without a durable history.
    const d = await del(ids[0], 'QA-AUTH-0');
    expect(d.out).toMatchObject({ status: 'NOT_STARTED', reason: 'NOT_INITIALISED' });
    expect(await count(live, LIVE_DB, ids[0])).toBe(1);
  });

  it('genesis: a restore BEFORE the first deletion is VERIFIED on the intended target', async () => {
    const init = await cli(['journal-init'], writer());
    expect(init.code, init.stderr).toBe(0);
    expect(init.out.checkpoint.count).toBe(0);
    state.anchor0 = init.out.anchor;
    expect((await cli(['journal-init'], writer())).out.anchor).toBe(state.anchor0); // idempotent
    const t = await preparedTarget(state.s0);
    const r = await cli(['restore-verify', '--snapshot-id', 'qa-s0', '--anchor', state.anchor0], restoreEnv(t));
    expect(r.code, r.stderr).toBe(0);
    expect(r.out).toMatchObject({ verdict: 'RECOVERY VERIFIED', applied: { applications: 0, files: 0, alreadyAbsent: 0 }, checked: 4, missing: 0, target: { database: t.db, targetId: t.targetId } });
  });

  it('a deletion is reported COMPLETE only with its entry and checkpoint in the locked journal; both are undeletable', async () => {
    const d = await del(state.ids[0], 'QA-AUTH-1');
    expect(d.code, d.stderr).toBe(0);
    expect(d.out).toMatchObject({ status: 'COMPLETE', object: 'DELETED', recordRemoved: true, checkpoint: { count: 1 } });
    expect(d.stdout).not.toMatch(/resumes\/|mongodb:\/\//);
    state.anchor1 = d.out.anchor;
    const entryKey = `deletion-journal/${NS}/entries/${state.ids[0]}.json`;
    const cpKey = `deletion-journal/${NS}/checkpoints/0000000001.json`;
    expect(JSON.parse(readIndependently(moto, moto.buckets.log, entryKey).toString())).toMatchObject({ applicationId: state.ids[0], authorisation: 'QA-AUTH-1' });
    expect(JSON.parse(readIndependently(moto, moto.buckets.log, cpKey).toString())).toMatchObject({ count: 1 });
    for (const key of [entryKey, cpKey]) {
      const versions = listVersions(moto, moto.buckets.log, key);
      expect(versions).toHaveLength(1);
      // Even the test-side superuser cannot remove a COMPLIANCE-locked version.
      expect(tryDeleteVersion(moto, moto.buckets.log, key, versions[0].versionId)).toBe('AccessDenied');
    }
    expect(await count(live, LIVE_DB, state.ids[0])).toBe(0);
  });

  it('a retry of a completed deletion writes no second entry and reports it complete', async () => {
    const again = await del(state.ids[0], 'QA-AUTH-1');
    expect(again.out).toMatchObject({ status: 'COMPLETE', resumed: 'ALREADY_DELETED', checkpoint: { count: 1 } });
    expect(listVersions(moto, moto.buckets.log, `deletion-journal/${NS}/entries/`)).toHaveLength(1);
    // The same id under a DIFFERENT authorisation is not silently accepted.
    const conflict = await del(state.ids[0], 'QA-AUTH-OTHER');
    expect(conflict.out.status).toBe('COMPLETE'); // the record is gone: nothing more to delete, the original entry stands
    expect(JSON.parse(readIndependently(moto, moto.buckets.log, `deletion-journal/${NS}/entries/${state.ids[0]}.json`).toString()).authorisation).toBe('QA-AUTH-1');
  });

  it('older snapshots never resurrect a deleted applicant, even after the primary database is lost', async () => {
    state.s1 = await snapshot(live, LIVE_DB); // after deletion 1
    const d2 = await del(state.ids[1], 'QA-AUTH-2');
    expect(d2.out).toMatchObject({ status: 'COMPLETE', checkpoint: { count: 2 } });
    state.anchor2 = d2.out.anchor;
    // Export the journal now (2 entries), for the offline path.
    state.export2 = path.join(work, 'journal-2.json');
    expect((await cli(['journal-export', '--out', state.export2], reader())).out.anchor).toBe(state.anchor2);

    // Loss of the primary database: every collection gone.
    await live.db(LIVE_DB).collection('applications').drop();
    await live.db(LIVE_DB).collection('resume_files').drop();

    // The OLDEST snapshot (before any deletion): both deletions re-applied.
    const t0 = await preparedTarget(state.s0);
    const r0 = await cli(['restore-verify', '--snapshot-id', 'qa-s0', '--anchor', state.anchor2], restoreEnv(t0));
    expect(r0.code, r0.stderr).toBe(0);
    expect(r0.out).toMatchObject({ verdict: 'RECOVERY VERIFIED', applied: { applications: 2, files: 2, alreadyAbsent: 0 }, checked: 2, history: { checkpointed: 2, pending: 0, checkpoint: { count: 2 } } });
    for (const id of state.ids.slice(0, 2)) expect(await count(target, t0.db, id)).toBe(0);
    for (const id of state.ids.slice(2)) expect(await count(target, t0.db, id)).toBe(1);

    // The middle snapshot, from the offline export (live journal not consulted).
    const t1 = await preparedTarget(state.s1);
    const r1 = await cli(['restore-verify', '--snapshot-id', 'qa-s1', '--anchor', state.anchor2, '--journal-file', state.export2], { ...restoreEnv(t1), BACKUP_JOURNAL_READER_ACCESS_KEY_ID: undefined, BACKUP_JOURNAL_READER_SECRET_ACCESS_KEY: undefined });
    expect(r1.code, r1.stderr).toBe(0);
    expect(r1.out).toMatchObject({ verdict: 'RECOVERY VERIFIED', applied: { applications: 1, files: 1, alreadyAbsent: 1 }, checked: 2 });
    expect(await count(target, t1.db, state.ids[1])).toBe(0);

    // Put the live database back (test side) for the remaining tests.
    await restoreInto(live, LIVE_DB, state.s0);
    await live.db(LIVE_DB).collection('applications').deleteMany({ _id: { $in: state.ids.slice(0, 2).map((i) => new ObjectId(i)) } });
  });

  it('stale, incomplete, gapped or tampered history is refused with zero writes', async () => {
    // A third deletion makes the 2-entry export STALE against the newest anchor.
    const d3 = await del(state.ids[2], 'QA-AUTH-3');
    expect(d3.out).toMatchObject({ status: 'COMPLETE', checkpoint: { count: 3 } });
    state.anchor3 = d3.out.anchor;
    const doctor = (mutate) => {
      const file = path.join(work, `doctored-${randomBytes(3).toString('hex')}.json`);
      const json = JSON.parse(fs.readFileSync(state.export2, 'utf8'));
      mutate(json);
      fs.writeFileSync(file, JSON.stringify(json));
      return file;
    };
    const cases = [
      ['stale export (anchor 3, export holds 2)', state.export2, state.anchor3, 'DELETION_HISTORY_STALE'],
      ['stale anchor for the export', state.export2, `2:${'a'.repeat(64)}`, 'DELETION_HISTORY_STALE'],
      ['an entry missing', doctor((j) => { j.objects = j.objects.filter((o) => !o.key.endsWith(`${state.ids[1]}.json`)); }), state.anchor2, 'DELETION_HISTORY_INCOMPLETE'],
      ['a checkpoint missing', doctor((j) => { j.objects = j.objects.filter((o) => !o.key.endsWith('0000000001.json')); }), state.anchor2, 'DELETION_HISTORY_GAP'],
      ['an entry altered', doctor((j) => { const o = j.objects.find((x) => x.key.endsWith(`${state.ids[0]}.json`)); o.bytes = Buffer.from(Buffer.from(o.bytes, 'base64').toString().replace('QA-AUTH-1', 'QA-AUTH-9')).toString('base64'); }), state.anchor2, 'DELETION_HISTORY_TAMPERED'],
      ['genesis missing', doctor((j) => { j.objects = j.objects.filter((o) => !o.key.endsWith('0000000000.json')); }), state.anchor2, 'DELETION_HISTORY_NOT_INITIALISED'],
    ];
    const t = await preparedTarget(state.s0);
    for (const [label, file, anchor, reason] of cases) {
      const r = await zeroWrites(() => cli(['restore-verify', '--snapshot-id', 'qa', '--anchor', anchor, '--journal-file', file], restoreEnv(t)));
      expect(r.out, label).toMatchObject({ verdict: 'RECOVERY FAILED', reasons: [reason] });
    }
    // The live journal itself is current: with the newest anchor it verifies on the same target.
    const ok = await cli(['restore-verify', '--snapshot-id', 'qa-s0', '--anchor', state.anchor3], restoreEnv(t));
    expect(ok.out).toMatchObject({ verdict: 'RECOVERY VERIFIED', applied: { applications: 3 } });
  });
});

describe('restore safety: the target is positively identified before the first write (finding 1)', () => {
  let t;
  beforeAll(async () => {
    t = await preparedTarget(await snapshot(live, LIVE_DB));
  });
  const anchor = () => /* the newest */ undefined;

  async function refused(env, args, reason, { exit = 1 } = {}) {
    const head = await cli(['journal-head'], reader());
    const r = await zeroWrites(() => cli(['restore-verify', '--snapshot-id', 'qa', '--anchor', head.out.anchor, ...args], env));
    expect(r.code, `${reason}: ${r.stderr}`).toBe(exit);
    if (reason) expect(r.out).toMatchObject({ verdict: 'RECOVERY REFUSED', reasons: [reason] });
    expect(r.stdout + r.stderr).not.toMatch(/mongodb:\/\/|resumes\//);
    return r;
  }
  const offline = async () => {
    const file = path.join(work, `journal-${randomBytes(3).toString('hex')}.json`);
    await cli(['journal-export', '--out', file], reader());
    return ['--journal-file', file];
  };
  const liveAdminAsTarget = () => adminUriFor(ADMIN.live, LIVE_DB);
  const { host: liveHost } = parts(ADMIN.live);
  const aliasHost = liveHost.replace('127.0.0.1', 'localhost');

  it('the live cluster as the target (by address, and by replica-set name without the live URI): refused, zero writes, both history paths', async () => {
    void anchor;
    for (const args of [[], await offline()]) {
      await refused(restoreEnv(t, { RECOVERY_RESTORED_MONGODB_URI: users.valida_deletion_operator }), args, 'TARGET_URI_OVERLAP');
      await refused(restoreEnv(t, { RECOVERY_RESTORED_MONGODB_URI: users.valida_deletion_operator, RECOVERY_LIVE_MONGODB_URI: undefined }), args, 'TARGET_TARGET_IS_LIVE');
    }
  });

  it('an alias of the live cluster (another host name for the same server): refused, zero writes', async () => {
    const alias = users.valida_deletion_operator.replace(liveHost, aliasHost);
    for (const args of [[], await offline()]) {
      await refused(restoreEnv(t, { RECOVERY_RESTORED_MONGODB_URI: alias }), args, 'TARGET_TARGET_IS_LIVE');
      // Even if the owner mistakenly wrote an authorisation into live, the set name still refuses it.
      await refused(restoreEnv(t, { RECOVERY_RESTORED_MONGODB_URI: alias.replace(/replicaSet=[^&]+/, `replicaSet=${LIVE_SET}`), RECOVERY_LIVE_MONGODB_URI: undefined }), args, 'TARGET_TARGET_IS_LIVE');
    }
  });

  it('an unauthorised, ambiguous, mismatched or expired target: refused, zero writes', async () => {
    // Unauthorised: a restored database with no owner authorisation, reached with an over-broad admin.
    const bare = `valida_test_rst_bare_${randomBytes(2).toString('hex')}`;
    await restoreInto(target, bare, await snapshot(live, LIVE_DB));
    await refused(restoreEnv(t, { RECOVERY_RESTORED_MONGODB_URI: adminUriFor(ADMIN.target, bare) }), [], 'TARGET_NOT_AUTHORISED');
    // Mismatched target id.
    await refused(restoreEnv(t, { RECOVERY_RESTORE_TARGET_ID: randomBytes(16).toString('hex') }), [], 'TARGET_TARGET_ID_MISMATCH');
    // Ambiguous: a second authorisation document (test side).
    const amb = await preparedTarget(await snapshot(live, LIVE_DB));
    await target.db(amb.db).collection('restore_authorization').insertOne({ targetId: amb.targetId, setName: 'x', database: amb.db, expiresAt: new Date(Date.now() + 3_600_000) });
    for (const args of [[], await offline()]) await refused(restoreEnv(amb), args, 'TARGET_AMBIGUOUS');
    // Expired.
    const exp = await preparedTarget(await snapshot(live, LIVE_DB));
    await target.db(exp.db).collection('restore_authorization').updateOne({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    await refused(restoreEnv(exp), [], 'TARGET_EXPIRED');
  });

  it('a live URI that does not reach the configured live set is refused (LIVE_IDENTITY_MISMATCH), zero writes', async () => {
    await refused(restoreEnv(t, { RECOVERY_LIVE_MONGODB_URI: t.writerUri }), [], 'TARGET_URI_OVERLAP'); // a "live" URI naming the target itself
    await refused(restoreEnv(t, { RECOVERY_LIVE_REPLICA_SET: 'rslive-mistyped' }), [], 'TARGET_LIVE_IDENTITY_MISMATCH');
  });

  it('an over-privileged writer on the RIGHT target is refused (target-scoped writer permissions)', async () => {
    for (const args of [[], await offline()]) await refused(restoreEnv(t, { RECOVERY_RESTORED_MONGODB_URI: adminUriFor(ADMIN.target, t.db) }), args, 'TARGET_WRITER_NOT_SCOPED');
    // The restore role PLUS one extra privilege (insert on applications, or readWrite elsewhere) is refused too.
    for (const extra of [[{ role: 'readWrite', db: 'valida_test_other' }], [{ role: 'readWrite', db: t.db }]]) {
      const user = `qa_broad_${randomBytes(3).toString('hex')}`;
      const pwd = randomBytes(18).toString('hex');
      await target.db(t.db).command({ createUser: user, pwd, roles: [{ role: 'valida_restore_writer', db: t.db }, ...extra] });
      const uri = t.writerUri.replace(/\/\/[^@]+@/, `//${user}:${pwd}@`);
      await refused(restoreEnv(t, { RECOVERY_RESTORED_MONGODB_URI: uri }), [], 'TARGET_WRITER_NOT_SCOPED');
    }
    // And the scoped writer cannot write anywhere else on the target cluster, nor on live.
    const w = await connect(t.writerUri);
    try {
      await expect(w.db(t.db).collection('applications').insertOne({ qa: 1 })).rejects.toMatchObject({ code: 13 });
      await expect(w.db(t.db).collection('restore_authorization').deleteMany({})).rejects.toMatchObject({ code: 13 });
      await expect(w.db('valida_test_other').collection('applications').deleteMany({})).rejects.toMatchObject({ code: 13 });
    } finally {
      await w.close();
    }
    const onLive = t.writerUri.replace(parts(ADMIN.target).host, liveHost).replace(/replicaSet=[^&]+/, `replicaSet=${LIVE_SET}`);
    await expect(connect(onLive)).rejects.toThrow(); // the writer does not exist on the live cluster
  });

  it('incomplete configuration is refused before connecting (exit 2), on both history paths', async () => {
    const file = (await offline())[1];
    const base = restoreEnv(t);
    const head = (await cli(['journal-head'], reader())).out.anchor;
    for (const [label, env, args] of [
      ['no target id', { ...base, RECOVERY_RESTORE_TARGET_ID: undefined }, []],
      ['no live set name', { ...base, RECOVERY_LIVE_REPLICA_SET: undefined }, []],
      ['no target URI', { ...base, RECOVERY_RESTORED_MONGODB_URI: undefined }, []],
      ['offline without anchor', base, ['--journal-file', file, '--no-anchor']],
    ]) {
      const a = args.includes('--no-anchor') ? ['--journal-file', file] : ['--anchor', head, ...args];
      const r = await zeroWrites(() => cli(['restore-verify', '--snapshot-id', 'qa', ...a], env));
      expect(r.code, label).toBe(2);
    }
    // A target URI that names no database.
    const r = await zeroWrites(() => cli(['restore-verify', '--snapshot-id', 'qa', '--anchor', head], { ...base, RECOVERY_RESTORED_MONGODB_URI: t.writerUri.replace(`/${t.db}?`, '/?') }));
    expect(r.out).toMatchObject({ verdict: 'RECOVERY REFUSED', reasons: ['TARGET_CONFIG_INCOMPLETE'] });
  });

  it('prepare-target refuses the live cluster with zero writes', async () => {
    const lm = await oplogMark(live);
    const r = await cli(['prepare-target', '--target-id', randomBytes(16).toString('hex'), '--expires-hours', '2', '--writer-uri-out', path.join(work, 'nope.uri')], {
      RECOVERY_TARGET_ADMIN_MONGODB_URI: ADMIN.live, RECOVERY_LIVE_REPLICA_SET: LIVE_SET, RECOVERY_RESTORED_DATABASE: LIVE_DB,
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/LIVE replica set: nothing was written/);
    expect(await writesSince(live, lm, '')).toBe(0);
    expect(fs.existsSync(path.join(work, 'nope.uri'))).toBe(false);
  });

  it('the intended target, correctly configured, recovers (journal path and offline path)', async () => {
    const head = (await cli(['journal-head'], reader())).out.anchor;
    const ok = await cli(['restore-verify', '--snapshot-id', 'qa-ok', '--anchor', head], restoreEnv(t));
    expect(ok.code, ok.stderr).toBe(0);
    expect(ok.out).toMatchObject({ verdict: 'RECOVERY VERIFIED', target: { database: t.db, targetId: t.targetId, setName: parts(ADMIN.target).setName } });
    const t2 = await preparedTarget(state0());
    const off = await cli(['restore-verify', '--snapshot-id', 'qa-ok2', '--anchor', head, ...(await offline())], restoreEnv(t2));
    expect(off.out).toMatchObject({ verdict: 'RECOVERY VERIFIED' });
  });
});

describe('the restore gate still checks every remaining résumé (r1 behaviour, now on a positively identified target)', () => {
  it('a missing and an altered résumé on the restored copy: RECOVERY FAILED (MISSING_1, MISMATCH_1)', async () => {
    await seed(live, LIVE_DB, 2);
    const snap = await snapshot(live, LIVE_DB);
    const [a, b] = snap.applications;
    snap.resume_files = snap.resume_files.filter((f) => f._id !== a.resume.storageKey).map((f) => (f._id === b.resume.storageKey ? { ...f, data: new mongoose.mongo.Binary(Buffer.from('%PDF-1.4 altered')) } : f));
    const t = await preparedTarget(snap);
    const head = (await cli(['journal-head'], reader())).out.anchor;
    const r = await cli(['restore-verify', '--snapshot-id', 'qa-bad', '--anchor', head], restoreEnv(t));
    expect(r.code).toBe(1);
    expect(r.out).toMatchObject({ verdict: 'RECOVERY FAILED', reasons: ['MISSING_1', 'MISMATCH_1'], missing: 1, mismatched: 1 });
  });
});

let cached;
function state0() {
  return cached;
}
beforeAll(async () => {
  cached = await snapshot(live, LIVE_DB);
});
