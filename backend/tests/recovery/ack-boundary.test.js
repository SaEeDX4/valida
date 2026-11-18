import { describe, it, expect, inject, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoPrivateStorage } from '../../src/integrations/storage/mongoPrivateStorage.js';
import { deletionJournal, s3JournalStore } from '../../src/ops/backup/deletionJournal.js';
import { deleteApplicationDurably } from '../../src/ops/backup/durableDeletion.js';
import { endpointFor, listVersions } from '../backup/backupFixture.js';
import { startFaultProxy } from '../s3/faultProxy.js';
import fs from 'node:fs';
import path from 'node:path';
import { cli, connect, createLiveUsers, journalEnv, parts, requireAdmins, restoreInto, seed, snapshot, tmpdir } from './recoveryFixture.js';

/**
 * Proposed (MongoDB-native r2, finding 2) — interruption and safe retry at
 * every acknowledgement boundary of a durable deletion. The journal is the
 * real deletionJournal over the moto double, reached THROUGH the network
 * fault proxy (the double really processes a request whose answer is lost);
 * the database is the live replica set with the operator's own user.
 *
 * Invariants checked after every interruption:
 *   - nothing is deleted from the database before the entry AND a checkpoint
 *     covering it are durable;
 *   - a retry completes it with exactly ONE entry version and contiguous
 *     checkpoints (no duplicate, no gap);
 *   - the reported status never claims more than happened.
 */
const { ObjectId } = mongoose.mongo;
const moto = inject('backupMoto');
const ADMIN = requireAdmins();
const LIVE_DB = `valida_test_ack_${randomBytes(3).toString('hex')}`;
let live;
let users;
let proxy;
let storage;
let operator;
let journal;
let ns;
let target;
let work;

beforeAll(async () => {
  live = await connect(ADMIN.live);
  target = await connect(ADMIN.target);
  work = tmpdir();
  users = await createLiveUsers(live, ADMIN.live, LIVE_DB);
  proxy = await startFaultProxy({ upstream: moto.endpoint });
  storage = new MongoPrivateStorage({ uri: users.valida_deletion_operator, mode: 'deletion' });
  await storage.init();
  operator = await connect(users.valida_deletion_operator);
});
afterAll(async () => {
  await storage?.close();
  await operator?.close();
  await proxy?.close();
  await live.db(LIVE_DB).dropDatabase();
  await live.close();
  await target.close();
  fs.rmSync(work, { recursive: true, force: true });
});
beforeEach(async () => {
  proxy.setPlan({ '*': ['pass'] });
  ns = `qa-ack-${randomBytes(4).toString('hex')}`;
  journal = deletionJournal(s3JournalStore(endpointFor(moto, moto.buckets.log, 'qa-journal-writer', { url: proxy.endpoint })), { namespace: ns });
  await journal.init();
});

const apps = () => operator.db().collection('applications');
const present = (id) => live.db(LIVE_DB).collection('applications').countDocuments({ _id: new ObjectId(id) });
const files = () => live.db(LIVE_DB).collection('resume_files').countDocuments({});
const entryVersions = (id) => listVersions(moto, moto.buckets.log, `deletion-journal/${ns}/entries/${id}.json`);
const checkpointKeys = () => listVersions(moto, moto.buckets.log, `deletion-journal/${ns}/checkpoints/`).map((v) => v.key);
const run = (id) => deleteApplicationDurably({ applicationId: id, authorisation: 'QA-AUTH-ACK', applications: apps(), storage, journal });
const onPut = (fragment, modes) => {
  let i = 0;
  return ({ url, method }) => (method === 'PUT' && url.includes(fragment) ? modes[Math.min(i++, modes.length - 1)] : 'pass');
};

describe('acknowledgement boundaries', () => {
  it('the entry PUT is processed but its answer is lost: resolved by reading back, ONE entry, COMPLETE', async () => {
    const [id] = await seed(live, LIVE_DB, 1);
    const before = await files();
    proxy.setPlan({ '*': [onPut('/entries/', ['lose-answer', 'pass'])] });
    const r = await run(id);
    expect(r).toMatchObject({ status: 'COMPLETE', object: 'DELETED', recordRemoved: true, checkpoint: { count: 1 } });
    expect(entryVersions(id)).toHaveLength(1);
    expect(checkpointKeys()).toEqual([`deletion-journal/${ns}/checkpoints/0000000000.json`, `deletion-journal/${ns}/checkpoints/0000000001.json`]);
    expect(await present(id)).toBe(0);
    expect(await files()).toBe(before - 1);
    expect(proxy.log.some((e) => e.mode === 'lose-answer' && e.upstreamStatus === 200)).toBe(true);
  });

  it('the checkpoint PUT is processed but its answer is lost: ONE checkpoint 1, COMPLETE', async () => {
    const [id] = await seed(live, LIVE_DB, 1);
    proxy.setPlan({ '*': [onPut('/checkpoints/0000000001', ['lose-answer', 'pass'])] });
    const r = await run(id);
    expect(r).toMatchObject({ status: 'COMPLETE', checkpoint: { count: 1 } });
    expect(listVersions(moto, moto.buckets.log, `deletion-journal/${ns}/checkpoints/0000000001.json`)).toHaveLength(1);
  });

  it('the checkpoint cannot be written: INCOMPLETE (entry recorded), NOTHING deleted; the retry completes it without a second entry', async () => {
    const [id] = await seed(live, LIVE_DB, 1);
    const before = await files();
    proxy.setPlan({ '*': [onPut('/checkpoints/', ['status:503'])] });
    const r1 = await run(id);
    expect(r1).toMatchObject({ status: 'INCOMPLETE', journal: 'ENTRY_WRITTEN', action: 'RETRY_TO_COMPLETE', recordRemoved: false });
    expect(await present(id)).toBe(1);
    expect(await files()).toBe(before);
    proxy.setPlan({ '*': ['pass'] });
    const r2 = await run(id);
    expect(r2).toMatchObject({ status: 'COMPLETE', recordRemoved: true, checkpoint: { count: 1 } });
    expect(entryVersions(id)).toHaveLength(1);
  });

  it('the journal is unreachable before the entry: NOT_STARTED, nothing written anywhere', async () => {
    const [id] = await seed(live, LIVE_DB, 1);
    proxy.setPlan({ '*': ['status:503'] });
    const r = await run(id);
    expect(r).toMatchObject({ status: 'NOT_STARTED', journal: 'NOT_WRITTEN' });
    proxy.setPlan({ '*': ['pass'] });
    expect(entryVersions(id)).toHaveLength(0);
    expect(await present(id)).toBe(1);
  });

  it('the database acknowledgement of the record removal is lost: INCOMPLETE; the retry reports COMPLETE (ALREADY_DELETED) with no new entry', async () => {
    const [id] = await seed(live, LIVE_DB, 1);
    const lossy = {
      findOne: (...a) => apps().findOne(...a),
      deleteOne: async (...a) => {
        await apps().deleteOne(...a); // the server applies it ...
        throw new Error('connection reset'); // ... and the answer is lost
      },
    };
    const r1 = await deleteApplicationDurably({ applicationId: id, authorisation: 'QA-AUTH-ACK', applications: lossy, storage, journal });
    expect(r1).toMatchObject({ status: 'INCOMPLETE', reason: 'RECORD_DELETE_FAILED', object: 'DELETED' });
    const r2 = await run(id);
    expect(r2).toMatchObject({ status: 'COMPLETE', resumed: 'ALREADY_DELETED', checkpoint: { count: 1 } });
    expect(entryVersions(id)).toHaveLength(1);
  });

  it('a deletion interrupted after its entry (pending, no checkpoint) is APPLIED by a restore of an older snapshot', async () => {
    const [id] = await seed(live, LIVE_DB, 1);
    const snap = await snapshot(live, LIVE_DB);
    proxy.setPlan({ '*': [onPut('/checkpoints/', ['status:503'])] });
    expect((await run(id)).status).toBe('INCOMPLETE');
    proxy.setPlan({ '*': ['pass'] });
    const anchor = (await journal.readHistory()).checkpoint;
    const db = `valida_test_rst_ack_${randomBytes(2).toString('hex')}`;
    await restoreInto(target, db, snap);
    const targetId = randomBytes(16).toString('hex');
    const writerFile = path.join(work, `w-${targetId}.uri`);
    expect((await cli(['prepare-target', '--target-id', targetId, '--expires-hours', '1', '--writer-uri-out', writerFile], { RECOVERY_TARGET_ADMIN_MONGODB_URI: ADMIN.target, RECOVERY_LIVE_REPLICA_SET: parts(ADMIN.live).setName, RECOVERY_RESTORED_DATABASE: db })).code).toBe(0);
    const r = await cli(['restore-verify', '--snapshot-id', 'qa-pending', '--anchor', `${anchor.count}:${anchor.sha256}`], {
      ...journalEnv(moto, 'reader', { namespace: ns }), RECOVERY_RESTORED_MONGODB_URI: fs.readFileSync(writerFile, 'utf8').trim(), RECOVERY_RESTORE_TARGET_ID: targetId, RECOVERY_LIVE_REPLICA_SET: parts(ADMIN.live).setName,
    });
    expect(r.out).toMatchObject({ verdict: 'RECOVERY VERIFIED', history: { checkpointed: 0, pending: 1 } });
    expect(await target.db(db).collection('applications').countDocuments({ _id: new ObjectId(id) })).toBe(0);
    await target.db(db).dropDatabase();
    expect((await run(id)).status).toBe('COMPLETE'); // and the live deletion is then completed by the retry
  });

  it('two deletions, each interrupted at a different boundary, leave a contiguous verified history', async () => {
    const [a, b] = await seed(live, LIVE_DB, 2);
    proxy.setPlan({ '*': [onPut('/checkpoints/', ['status:503'])] });
    expect((await run(a)).status).toBe('INCOMPLETE');
    proxy.setPlan({ '*': [onPut('/entries/', ['lose-answer', 'pass'])] });
    // b's checkpoint must also cover the still-pending a: checkpoints 1 and 2 are both written.
    const rb = await run(b);
    expect(rb).toMatchObject({ status: 'COMPLETE', checkpoint: { count: 2 } });
    proxy.setPlan({ '*': ['pass'] });
    expect((await run(a)).status).toBe('COMPLETE');
    const history = await journal.readHistory();
    expect(history.checkpoint.count).toBe(2);
    expect(history.pending).toHaveLength(0);
    expect(history.entries.map((e) => e.applicationId).sort()).toEqual([a, b].sort());
  });
});
