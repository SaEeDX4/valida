import { describe, it, expect, inject, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoPrivateStorage } from '../../src/integrations/storage/mongoPrivateStorage.js';
import { deletionJournal, s3JournalStore } from '../../src/ops/backup/deletionJournal.js';
import { deleteApplicationDurably } from '../../src/ops/backup/durableDeletion.js';
import { createRecoveryCopy, openRecoveryCopy, RecoveryCopyError, s3RecoveryStore, sealRecoveryCopy, sha256 } from '../../src/ops/backup/recoveryCopy.js';
import { putNewObject } from '../../src/ops/backup/backupStore.js';
import { endpointFor, listVersions, readIndependently, tryDeleteVersion } from '../backup/backupFixture.js';
import {
  cli, connect, createLiveUsers, journalEnv, oplogMark, parts, requireAdmins, seed, tmpdir, writesSince,
} from './recoveryFixture.js';

/**
 * Proposed (MongoDB-native r3, owner decision D-MN-2) — the independent,
 * encrypted recovery copy: consistent at one recovery point, written with
 * isolated credentials, readable with either of two keys (owner, sealed
 * recovery key), restored to an EMPTY authorised target, then the deletion
 * history replayed. Incomplete or unverifiable recovery material is refused
 * with ZERO writes. The CLI runs as its own process with least-privilege users.
 */
const { ObjectId, Binary } = mongoose.mongo;
const moto = inject('backupMoto');
const ADMIN = requireAdmins();
const LIVE_DB = `valida_test_bk_${randomBytes(3).toString('hex')}`;
const LIVE_SET = parts(ADMIN.live).setName;
const NS = `qa-bk-${randomBytes(4).toString('hex')}`;
let live;
let target;
let users;
let work;
let n = 0;
const keyPair = (passphrase) => generateKeyPairSync('rsa', {
  modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: passphrase ? { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase } : { type: 'pkcs8', format: 'pem' },
});
const OWNER = keyPair();
const RECOVERY_PASS = randomBytes(12).toString('hex');
const RECOVERY = keyPair(RECOVERY_PASS);
const STRANGER = keyPair();
const files = {};

const dumpEnv = () => ({
  APP_ENV: 'local', NODE_ENV: 'test', BACKUP_S3_ENDPOINT: moto.endpoint, BACKUP_S3_REGION: 'us-east-1', BACKUP_S3_TIMEOUT_MS: '5000', BACKUP_COPY_BUCKET: moto.buckets.copy,
  BACKUP_JOURNAL_NAMESPACE: NS, RECOVERY_BACKUP_READER_MONGODB_URI: users.valida_backup_reader,
  BACKUP_DUMP_WRITER_ACCESS_KEY_ID: moto.users['qa-dump-writer'].accessKeyId, BACKUP_DUMP_WRITER_SECRET_ACCESS_KEY: moto.users['qa-dump-writer'].secretAccessKey,
  BACKUP_RECIPIENT_PUBLIC_KEYS: `${OWNER.publicKey}\n${RECOVERY.publicKey}`,
});
const journalWriter = () => journalEnv(moto, 'writer', { namespace: NS });
const restoreEnv = (t, extra = {}) => ({
  ...journalEnv(moto, 'reader', { namespace: NS }), BACKUP_COPY_BUCKET: moto.buckets.copy,
  BACKUP_DUMP_READER_ACCESS_KEY_ID: moto.users['qa-dump-reader'].accessKeyId, BACKUP_DUMP_READER_SECRET_ACCESS_KEY: moto.users['qa-dump-reader'].secretAccessKey,
  RECOVERY_RESTORED_MONGODB_URI: t.writerUri, RECOVERY_RESTORE_TARGET_ID: t.targetId, RECOVERY_LIVE_REPLICA_SET: LIVE_SET, RECOVERY_LIVE_MONGODB_URI: users.valida_api_runtime, ...extra,
});

async function emptyTarget(mode = 'load') {
  n += 1;
  const db = `valida_test_rst_bk_${n}_${randomBytes(2).toString('hex')}`;
  const targetId = randomBytes(16).toString('hex');
  const writerFile = path.join(work, `writer-${n}.uri`);
  const prep = await cli(['prepare-target', '--target-id', targetId, '--expires-hours', '2', '--writer-uri-out', writerFile, '--mode', mode], {
    RECOVERY_TARGET_ADMIN_MONGODB_URI: ADMIN.target, RECOVERY_LIVE_REPLICA_SET: LIVE_SET, RECOVERY_RESTORED_DATABASE: db,
  });
  expect(prep.code, prep.stderr).toBe(0);
  return { db, targetId, writerUri: fs.readFileSync(writerFile, 'utf8').trim() };
}
const restore = (t, backup, { key = files.owner, anchor, extra = {}, args = [] } = {}) => cli(
  ['backup-restore', '--backup-id', backup.backupId, '--manifest-sha256', backup.manifestSha256, '--private-key-file', key, '--anchor', anchor, ...args],
  restoreEnv(t, extra),
);
async function zeroWrites(fn) {
  const [lm, tm] = [await oplogMark(live), await oplogMark(target)];
  const result = await fn();
  expect(await writesSince(live, lm, `${LIVE_DB}.`)).toBe(0);
  expect(await writesSince(target, tm, 'valida_test_rst_bk_')).toBe(0);
  return result;
}

beforeAll(async () => {
  live = await connect(ADMIN.live);
  target = await connect(ADMIN.target);
  users = await createLiveUsers(live, ADMIN.live, LIVE_DB);
  work = tmpdir();
  for (const [name, pem] of [['owner', OWNER.privateKey], ['recovery', RECOVERY.privateKey], ['stranger', STRANGER.privateKey]]) {
    files[name] = path.join(work, `${name}.pem`);
    fs.writeFileSync(files[name], pem, { mode: 0o600 });
  }
  await live.db(LIVE_DB).collection('jobs').insertOne({ slug: 'qa-job', title: 'QA TEST DATA job', status: 'PUBLISHED' });
  await live.db(LIVE_DB).collection('recipient_suppressions').insertOne({ keyRef: 'qa', reason: 'QA' });
  await live.db(LIVE_DB).collection('recipient_suppression_keys').insertOne({ keyId: 'qa-k1', createdAt: new Date() });
  expect((await cli(['journal-init'], journalWriter())).code).toBe(0);
});
afterAll(async () => {
  await live.db(LIVE_DB).dropDatabase();
  const dbs = await target.db('admin').admin().listDatabases();
  for (const { name } of dbs.databases) if (name.startsWith('valida_test_rst_bk_')) await target.db(name).dropDatabase();
  await live.close();
  await target.close();
  fs.rmSync(work, { recursive: true, force: true });
});

const state = {};
describe('the encrypted recovery copy (D-MN-2)', () => {
  it('backup-create: one snapshot read, encrypted for two keys, written with isolated credentials, locked, read back', async () => {
    state.ids = await seed(live, LIVE_DB, 3);
    const r = await cli(['backup-create'], dumpEnv());
    expect(r.code, r.stderr).toBe(0);
    expect(r.out).toMatchObject({ collections: { applications: 3, resume_files: 3, jobs: 1, recipient_suppressions: 1, recipient_suppression_keys: 1 }, consistency: { applicationsWithoutFile: 0, filesWithoutApplication: 0 } });
    expect(r.out.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.out.recoveryPoint.clusterTime.t).toBeGreaterThan(0);
    expect(r.stdout).not.toMatch(/mongodb:\/\/|PRIVATE KEY|resumes\//);
    state.b1 = r.out;
    const base = `encrypted-backups/${NS}/${r.out.backupId}`;
    const payload = readIndependently(moto, moto.buckets.copy, `${base}/payload.bin`);
    const manifest = readIndependently(moto, moto.buckets.copy, `${base}/manifest.json`);
    expect(sha256(manifest)).toBe(r.out.manifestSha256); // the digest the owner records is the manifest's — and it is not inside it
    expect(manifest.toString()).not.toContain(r.out.manifestSha256);
    // Ciphertext only: no plaintext marker, no candidate field, no résumé bytes.
    expect(payload.includes(Buffer.from('QA TEST DATA'))).toBe(false);
    expect(payload.includes(Buffer.from('%PDF'))).toBe(false);
    for (const key of [`${base}/payload.bin`, `${base}/manifest.json`]) {
      const versions = listVersions(moto, moto.buckets.copy, key);
      expect(versions).toHaveLength(1);
      expect(tryDeleteVersion(moto, moto.buckets.copy, key, versions[0].versionId)).toBe('AccessDenied');
    }
  });

  it('isolated credentials: the dump job cannot delete or write the journal, the journal writer cannot touch backups, the backup reader cannot write the database', async () => {
    const dumpWriter = endpointFor(moto, moto.buckets.copy, 'qa-dump-writer');
    const journalW = endpointFor(moto, moto.buckets.copy, 'qa-journal-writer');
    const dumpOnLog = endpointFor(moto, moto.buckets.log, 'qa-dump-writer');
    await expect(putNewObject(journalW, `encrypted-backups/${NS}/forged/manifest.json`, Buffer.from('{}'))).rejects.toMatchObject({ reason: 'PERMISSION_DENIED' });
    await expect(putNewObject(dumpOnLog, `deletion-journal/${NS}/entries/forged.json`, Buffer.from('{}'))).rejects.toMatchObject({ reason: 'PERMISSION_DENIED' });
    await expect(putNewObject(dumpWriter, 'outside/x.bin', Buffer.from('x'))).rejects.toMatchObject({ reason: 'PERMISSION_DENIED' });
    const reader = await connect(users.valida_backup_reader);
    try {
      await expect(reader.db().collection('applications').insertOne({ qa: 1 })).rejects.toMatchObject({ code: 13 });
      await expect(reader.db().collection('applications').deleteMany({})).rejects.toMatchObject({ code: 13 });
    } finally {
      await reader.close();
    }
  });

  it('restores to an EMPTY authorised target, then replays a deletion made after the recovery point; the owner key and the sealed recovery key both work', async () => {
    const del = await cli(['delete-application', '--application', state.ids[0], '--authorisation', 'QA-AUTH-BK1', '--confirm'], { ...journalWriter(), RECOVERY_OPERATOR_MONGODB_URI: users.valida_deletion_operator });
    expect(del.out).toMatchObject({ status: 'COMPLETE' });
    state.anchor = del.out.anchor;
    for (const [key, extra] of [[files.owner, {}], [files.recovery, { RECOVERY_PRIVATE_KEY_PASSPHRASE: RECOVERY_PASS }]]) {
      const t = await emptyTarget();
      const r = await restore(t, state.b1, { key, anchor: state.anchor, extra });
      expect(r.code, r.stderr).toBe(0);
      expect(r.out).toMatchObject({
        verdict: 'RECOVERY VERIFIED', recoveryPoint: state.b1.recoveryPoint, target: { mode: 'load', database: t.db },
        loaded: { applications: 3, resume_files: 3, jobs: 1, recipient_suppressions: 1, recipient_suppression_keys: 1 },
        applied: { applications: 1, files: 1 }, checked: 2, missing: 0, mismatched: 0, orphans: 0,
      });
      const tdb = target.db(t.db);
      expect(await tdb.collection('applications').countDocuments({ _id: new ObjectId(state.ids[0]) })).toBe(0); // not resurrected
      expect(await tdb.collection('applications').countDocuments({})).toBe(2);
      const names = (await tdb.collection('applications').listIndexes().toArray()).map((i) => i.name);
      expect(names.length).toBeGreaterThan(1); // the required indexes were created
    }
  });

  it('a submission and a deletion committing DURING the dump: the copy is consistent at its recovery point; the restore replays the deletion and the new submission is not in it', async () => {
    const [keep, victim] = await seed(live, LIVE_DB, 2);
    const journal = deletionJournal(s3JournalStore(endpointFor(moto, moto.buckets.log, 'qa-journal-writer')), { namespace: NS });
    const storage = new MongoPrivateStorage({ uri: users.valida_deletion_operator, mode: 'deletion' });
    await storage.init();
    const op = await connect(users.valida_deletion_operator);
    const reader = await connect(users.valida_backup_reader);
    let late;
    try {
      const store = s3RecoveryStore(endpointFor(moto, moto.buckets.copy, 'qa-dump-writer'));
      const result = await createRecoveryCopy({
        client: reader, db: reader.db(), store, recipients: [OWNER.publicKey, RECOVERY.publicKey], namespace: NS,
        hooks: {
          // After the Applications were read and BEFORE the résumés are read, at the same snapshot:
          betweenCollections: async (name) => {
            if (name !== 'applications') return;
            [late] = await seed(live, LIVE_DB, 1); // a new submission (file + record)
            const d = await deleteApplicationDurably({ applicationId: victim, authorisation: 'QA-AUTH-BK2', applications: op.db().collection('applications'), storage, journal });
            expect(d.status).toBe('COMPLETE'); // a deletion (journal, file, record)
          },
        },
      });
      // Both collections from the same instant: the deleted applicant's file is still in the copy, the new file is not.
      expect(result.consistency).toEqual({ applicationsWithoutFile: 0, filesWithoutApplication: 0 });
      state.b2 = result;
      state.anchor = `${(await journal.readHistory()).checkpoint.count}:${(await journal.readHistory()).checkpoint.sha256}`;
    } finally {
      await storage.close();
      await op.close();
      await reader.close();
    }
    const t = await emptyTarget();
    const r = await restore(t, state.b2, { anchor: state.anchor });
    expect(r.code, r.stderr).toBe(0);
    expect(r.out).toMatchObject({ verdict: 'RECOVERY VERIFIED', missing: 0, orphans: 0 });
    const tdb = target.db(t.db);
    expect(await tdb.collection('applications').countDocuments({ _id: new ObjectId(victim) })).toBe(0);
    expect(await tdb.collection('applications').countDocuments({ _id: new ObjectId(keep) })).toBe(1);
    expect(await tdb.collection('applications').countDocuments({ _id: new ObjectId(late) })).toBe(0); // after the recovery point: the RPO
  });

  it('incomplete or unverifiable recovery material, an unsuitable target or stale history: refused with ZERO writes', async () => {
    const t = await emptyTarget();
    const b = state.b2;
    const doctored = async (mutate) => {
      // A doctored copy under a fresh id, written with the dump writer (its own credential can do this; a restore must catch it).
      const id = `${b.backupId.slice(0, 16)}-${randomBytes(4).toString('hex')}`;
      const base = `encrypted-backups/${NS}/${b.backupId}`;
      let payload = readIndependently(moto, moto.buckets.copy, `${base}/payload.bin`);
      let manifest = JSON.parse(readIndependently(moto, moto.buckets.copy, `${base}/manifest.json`).toString());
      ({ payload, manifest } = mutate({ payload, manifest }));
      const mBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
      const w = endpointFor(moto, moto.buckets.copy, 'qa-dump-writer');
      if (payload) await putNewObject(w, `encrypted-backups/${NS}/${id}/payload.bin`, payload);
      await putNewObject(w, `encrypted-backups/${NS}/${id}/manifest.json`, mBytes);
      return { backupId: id, manifestSha256: sha256(mBytes) };
    };
    const cases = [
      ['manifest digest not the recorded one', { ...b, manifestSha256: 'a'.repeat(64) }, {}, 'RECOVERY_MATERIAL_MANIFEST_UNVERIFIED'],
      ['no such copy', { ...b, backupId: `${b.backupId.slice(0, 16)}-00000000` }, {}, 'RECOVERY_MATERIAL_MANIFEST_MISSING'],
      ['payload missing (manifest only)', await doctored(({ manifest }) => ({ payload: null, manifest })), {}, 'RECOVERY_MATERIAL_PAYLOAD_MISSING'],
      ['payload truncated', await doctored(({ payload, manifest }) => ({ payload: payload.subarray(0, payload.length - 100), manifest })), {}, 'RECOVERY_MATERIAL_PAYLOAD_MISMATCH'],
      ['payload truncated with a matching manifest', await doctored(({ payload, manifest }) => { const p = payload.subarray(0, payload.length - 100); return { payload: p, manifest: { ...manifest, payload: { sizeBytes: p.length, sha256: sha256(p) } } }; }), {}, 'RECOVERY_MATERIAL_PAYLOAD_TRUNCATED'],
      ['one ciphertext byte altered with a matching manifest', await doctored(({ payload, manifest }) => { const p = Buffer.from(payload); p[40] ^= 1; return { payload: p, manifest: { ...manifest, payload: { sizeBytes: p.length, sha256: sha256(p) } } }; }), {}, 'RECOVERY_MATERIAL_PAYLOAD_TAMPERED'],
      ['manifest content altered (recovery point)', await doctored(({ payload, manifest }) => ({ payload, manifest: { ...manifest, recoveryPoint: { ...manifest.recoveryPoint, wallClock: new Date().toISOString() } } })), {}, 'RECOVERY_MATERIAL_PAYLOAD_TAMPERED'],
      ['a key that is not a recipient', b, { key: files.stranger }, 'RECOVERY_MATERIAL_NO_MATCHING_KEY'],
      ['the recovery key without its passphrase', b, { key: files.recovery }, 'RECOVERY_MATERIAL_PRIVATE_KEY_UNUSABLE'],
      ['stale deletion history (anchor beyond the journal)', b, { anchor: `99:${'0'.repeat(64)}` }, 'DELETION_HISTORY_STALE'],
    ];
    for (const [label, backup, opts, reason] of cases) {
      const r = await zeroWrites(() => restore(t, backup, { anchor: opts.anchor ?? state.anchor, key: opts.key ?? files.owner }));
      expect(r.code, label).toBe(1);
      expect(r.out, label).toMatchObject({ verdict: 'RECOVERY FAILED', reasons: [reason] });
    }
    // The target was never touched: it is still empty and still usable.
    const ok = await restore(t, b, { anchor: state.anchor });
    expect(ok.out.verdict).toBe('RECOVERY VERIFIED');
  });

  it('a target that is not empty, authorised for the other mode, or live: refused with zero writes', async () => {
    const full = await emptyTarget();
    await target.db(full.db).collection('jobs').insertOne({ qa: 'already here' });
    const snap = await emptyTarget('snapshot');
    for (const [t, extra, reason] of [
      [full, {}, 'TARGET_TARGET_NOT_EMPTY'],
      [snap, {}, 'TARGET_AUTHORISATION_FOR_OTHER_MODE'],
      [full, { RECOVERY_RESTORED_MONGODB_URI: users.valida_deletion_operator }, 'TARGET_URI_OVERLAP'],
    ]) {
      const r = await zeroWrites(() => restore(t, state.b2, { anchor: state.anchor, extra }));
      expect(r.out).toMatchObject({ verdict: 'RECOVERY REFUSED', reasons: [reason] });
    }
    // prepare-target refuses a non-empty database for load mode, writing nothing.
    const db = `valida_test_rst_bk_full_${randomBytes(2).toString('hex')}`;
    await target.db(db).collection('applications').insertOne({ qa: 1 });
    const tm = await oplogMark(target);
    const prep = await cli(['prepare-target', '--target-id', randomBytes(16).toString('hex'), '--expires-hours', '1', '--writer-uri-out', path.join(work, 'x.uri'), '--mode', 'load'], {
      RECOVERY_TARGET_ADMIN_MONGODB_URI: ADMIN.target, RECOVERY_LIVE_REPLICA_SET: LIVE_SET, RECOVERY_RESTORED_DATABASE: db,
    });
    expect(prep.code).toBe(2);
    expect(await writesSince(target, tm, db)).toBe(0);
  });
});

describe('the sealed format (offline)', () => {
  const material = () => {
    const plaintext = Buffer.concat([mongoose.mongo.BSON.serialize({ c: 'jobs', d: { _id: new ObjectId(), qa: 'x', data: new Binary(randomBytes(3 * 1024 * 1024)) } })]);
    const collections = { applications: { count: 0, plaintextSha256: sha256(Buffer.alloc(0)) }, resume_files: { count: 0, plaintextSha256: sha256(Buffer.alloc(0)) }, jobs: { count: 1, plaintextSha256: sha256(plaintext) }, recipient_suppressions: { count: 0, plaintextSha256: sha256(Buffer.alloc(0)) }, recipient_suppression_keys: { count: 0, plaintextSha256: sha256(Buffer.alloc(0)) } };
    return sealRecoveryCopy({ plaintext, collections, recoveryPoint: { clusterTime: { t: 1, i: 1 }, wallClock: new Date().toISOString() }, consistency: { applicationsWithoutFile: 0, filesWithoutApplication: 0 }, recipients: [OWNER.publicKey, RECOVERY.publicKey], namespace: 'qa', backupId: '20261118T000000Z-00000000', createdAt: new Date().toISOString() });
  };
  const open = (manifest, payload, extra = {}) => {
    const mBytes = Buffer.from(JSON.stringify(manifest));
    return openRecoveryCopy({ manifestBytes: mBytes, payloadBytes: payload, expectedManifestSha256: sha256(mBytes), privateKey: OWNER.privateKey, ...extra });
  };
  const reason = (fn) => {
    try {
      fn();
    } catch (error) {
      expect(error).toBeInstanceOf(RecoveryCopyError);
      return error.reason;
    }
    return 'OPENED';
  };
  const reframe = (manifest, payload) => ({ ...manifest, payload: { sizeBytes: payload.length, sha256: sha256(payload) } });

  it('opens a multi-chunk copy; refuses one recipient, reordered or dropped chunks, and an expired copy', () => {
    const { manifest, payload } = material();
    expect(manifest.cipher.chunks).toBe(4);
    expect(open(manifest, payload).documents.jobs).toHaveLength(1);
    expect(reason(() => sealRecoveryCopy({ plaintext: Buffer.alloc(0), collections: {}, recoveryPoint: {}, recipients: [OWNER.publicKey], namespace: 'qa', backupId: 'x', createdAt: '' }))).toBe('TWO_DISTINCT_RECIPIENT_KEYS_REQUIRED');
    // Split into framed chunks, then swap two and drop the last.
    const chunks = [];
    for (let at = 0; at < payload.length;) {
      const len = payload.readUInt32BE(at);
      chunks.push(payload.subarray(at, at + 4 + len + 16));
      at += 4 + len + 16;
    }
    const swapped = Buffer.concat([chunks[1], chunks[0], ...chunks.slice(2)]);
    expect(reason(() => open(reframe(manifest, swapped), swapped))).toBe('PAYLOAD_TAMPERED');
    const dropped = Buffer.concat(chunks.slice(0, 3));
    expect(reason(() => open(reframe(manifest, dropped), dropped))).toBe('PAYLOAD_TRUNCATED');
    const extended = Buffer.concat([payload, chunks[3]]);
    expect(reason(() => open(reframe(manifest, extended), extended))).toBe('PAYLOAD_TAMPERED');
    expect(reason(() => open(manifest, payload, { now: new Date(Date.now() + 36 * 86_400_000) }))).toBe('BACKUP_EXPIRED');
    expect(reason(() => open({ ...manifest, collections: { ...manifest.collections, jobs: { ...manifest.collections.jobs, count: 2 } } }, payload))).toBe('PAYLOAD_TAMPERED');
  });
});
