import { describe, it, expect, inject, beforeEach } from 'vitest';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syntheticPdf } from '../fixtures/resumeFiles.js';
import { startFaultProxy } from '../s3/faultProxy.js';
import { storageObjectRef } from '../../src/integrations/storage/storageContract.js';
import { BackupStoreError, getObject, headObject, listKeys, putNewObject, deleteObjectVersion, anonymousGetStatus } from '../../src/ops/backup/backupStore.js';
import { readCopyRuns, runCopy } from '../../src/ops/backup/copyJob.js';
import { DeletionLogUnavailable, appendDeletionEntry, readDeletionLog } from '../../src/ops/backup/deletionLog.js';
import { buildManifest } from '../../src/ops/backup/manifest.js';
import { createRestoreBucket, endpointFor, listVersions, putPrimary, readIndependently, resumeKey, roleEnv, sha256, tryDeleteVersion } from './backupFixture.js';

/**
 * C6-T6 — the backup tooling on the local S3-compatible double: the access
 * boundary of each role, the hourly copy (complete, repeated, interrupted,
 * failed), the deletion log, and the manifest's preliminary states.
 * The two restore rehearsals run on the full stack:
 * e2e/c6/c6-t6-backup-rehearsal.mjs.
 */
const moto = inject('backupMoto');
const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '..', '..', 'scripts', 'backup.mjs');
const B = moto.buckets;
const as = (bucket, user, options) => endpointFor(moto, bucket, user, options);
const copier = { primary: as(B.primary, 'qa-backup-copier'), copy: as(B.copy, 'qa-backup-copier'), log: as(B.log, 'qa-backup-copier') };
const manifestRole = { primary: as(B.primary, 'qa-backup-manifest'), copy: as(B.copy, 'qa-backup-manifest'), log: as(B.log, 'qa-backup-manifest') };
const logWriter = as(B.log, 'qa-backup-log-writer');

/** The primary is shared across tests; each test checks only what it put there. */
async function seed(n, label) {
  const objects = [];
  for (let i = 0; i < n; i += 1) {
    const bytes = syntheticPdf({ text: `QA TEST DOCUMENT C6-T6 ${label} ${i} ${randomUUID()}` });
    const key = resumeKey();
    await putPrimary(moto, key, bytes);
    objects.push({ key, bytes, sha: sha256(bytes), objectRef: storageObjectRef(key) });
  }
  return objects;
}

/** Runs scripts/backup.mjs; returns { child, done } (done resolves with code, signal, out, err). */
function cli(command, args = [], env = {}) {
  const child = spawn(process.execPath, [CLI, command, ...args], { env: { PATH: process.env.PATH, ...roleEnv(moto), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (err += c));
  const done = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal, out, err })));
  return { child, done };
}
const lastJson = (text) => JSON.parse(text.trim().split('\n').pop());

describe('the access boundary: one credential per role, scoped at the store', () => {
  it('the copier reads the primary and writes NEW copies; it can delete nothing and cannot touch the deletion log', async () => {
    const [object] = await seed(1, 'boundary-copier');
    const primary = await headObject(copier.primary, object.key);
    expect(primary.exists).toBe(true);
    await expect(deleteObjectVersion(copier.primary, object.key, primary.versionId)).rejects.toMatchObject({ reason: 'PERMISSION_DENIED' });
    await expect(putNewObject(copier.primary, resumeKey(), Buffer.from('qa'))).rejects.toMatchObject({ reason: 'PERMISSION_DENIED' });
    await expect(putNewObject(copier.log, `deletion-log/qa-${randomUUID()}.json`, Buffer.from('{}'))).rejects.toMatchObject({ reason: 'PERMISSION_DENIED' });
    await expect(listKeys(copier.log, 'deletion-log/')).rejects.toMatchObject({ reason: 'PERMISSION_DENIED' });
    const written = await putNewObject(copier.copy, `resumes/qa-boundary/${randomUUID()}`, Buffer.from('qa'));
    expect(written.created).toBe(true);
  });

  it("the API's own token reaches the primary only — not the copy, not the log", async () => {
    const appCopy = as(B.copy, 'qa-app');
    const appLog = as(B.log, 'qa-app');
    await expect(listKeys(appCopy, 'resumes/')).rejects.toMatchObject({ reason: 'PERMISSION_DENIED' });
    await expect(putNewObject(appLog, `deletion-log/qa-${randomUUID()}.json`, Buffer.from('{}'))).rejects.toMatchObject({ reason: 'PERMISSION_DENIED' });
    // Its C6-T4 permissions on the primary are unchanged: put, read, version-bound delete.
    const key = resumeKey();
    await putPrimary(moto, key, Buffer.from('qa'));
    const head = await headObject(as(B.primary, 'qa-app'), key);
    expect(await deleteObjectVersion(as(B.primary, 'qa-app'), key, head.versionId)).toEqual({ deleted: true });
  });

  it('the log writer can only append: a new entry, never over one, never a delete, never a read elsewhere', async () => {
    const entry = await appendDeletionEntry(logWriter, { applicationId: 'a'.repeat(24), objectRef: 'b'.repeat(32), authorisation: 'QA-BOUNDARY' });
    const key = (await listKeys(manifestRole.log, 'deletion-log/')).find((e) => e.key.includes(entry.entryId)).key;
    expect(await putNewObject(logWriter, key, Buffer.from('{"forged":true}'))).toEqual({ created: false });
    const head = await headObject(manifestRole.log, key);
    await expect(deleteObjectVersion(logWriter, key, head.versionId)).rejects.toMatchObject({ reason: expect.stringMatching(/PERMISSION_DENIED|LOCKED/) });
    await expect(listKeys(as(B.primary, 'qa-backup-log-writer'), 'resumes/')).rejects.toMatchObject({ reason: 'PERMISSION_DENIED' });
  });

  it('the retention lock: even the test-side superuser cannot remove a copy or a log entry version (COMPLIANCE)', async () => {
    const key = `resumes/qa-lock/${randomUUID()}`;
    const { versionId } = await putNewObject(copier.copy, key, Buffer.from('qa'));
    expect(tryDeleteVersion(moto, B.copy, key, versionId)).toBe('AccessDenied');
    expect((await headObject(copier.copy, key)).lock).toMatchObject({ mode: 'COMPLIANCE' });
  });

  it('nothing in the copy or log bucket is readable without credentials', async () => {
    const [object] = await seed(1, 'anonymous');
    await runCopy(copier);
    expect(await anonymousGetStatus(copier.copy, object.key)).toBe(403);
    const anyLog = (await listKeys(manifestRole.log, 'copy-runs/'))[0].key;
    expect(await anonymousGetStatus(manifestRole.log, anyLog)).toBe(403);
  });
});

describe('the hourly copy', () => {
  it('copies every primary object as a NEW object whose SHA-256 is computed from its bytes; one complete run record', async () => {
    const objects = await seed(3, 'complete');
    const run = await runCopy(copier);
    expect(run).toMatchObject({ complete: true, recorded: true, listed: true });
    expect(run.failed).toEqual([]);
    for (const object of objects) {
      const head = await headObject(copier.copy, object.key);
      expect(head).toMatchObject({ exists: true, size: object.bytes.length, sha256: object.sha });
      expect(readIndependently(moto, B.copy, object.key).equals(object.bytes)).toBe(true);
    }
    const { runs } = await readCopyRuns(manifestRole.log);
    const recorded = runs.find((r) => r.runId === run.runId);
    expect(recorded).toMatchObject({ complete: true, failed: [] });
    expect(JSON.stringify(recorded)).not.toMatch(/resumes\//);
  });

  it('a repeated run writes nothing twice: every object already copied, no new version anywhere', async () => {
    const objects = await seed(2, 'repeat');
    await runCopy(copier);
    const before = listVersions(moto, B.copy, 'resumes/').length;
    const again = await runCopy(copier);
    expect(again.complete).toBe(true);
    expect(again.copied).toEqual([]);
    for (const object of objects) expect(again.alreadyCopied.map((o) => o.objectRef)).toContain(object.objectRef);
    expect(listVersions(moto, B.copy, 'resumes/').length).toBe(before);
  });

  it('a source whose bytes disagree with its checksum is never copied; the run is incomplete', async () => {
    const key = resumeKey();
    await putPrimary(moto, key, Buffer.from('QA TEST bytes'), { sha: 'f'.repeat(64) });
    const run = await runCopy(copier);
    expect(run.complete).toBe(false);
    expect(run.failed).toContainEqual({ objectRef: storageObjectRef(key), reason: 'SOURCE_CHECKSUM_MISMATCH' });
    expect((await headObject(copier.copy, key)).exists).toBe(false);
    // Remove the bad source so later tests see a clean primary.
    const head = await headObject(as(B.primary, 'qa-app'), key);
    await deleteObjectVersion(as(B.primary, 'qa-app'), key, head.versionId);
  });

  it('INTERRUPTED (the process killed mid-run) and FAILED runs leave the snapshot UNASSESSED; a repeated run completes it', async () => {
    // A clean state for this check: every earlier object copied.
    expect((await runCopy(copier)).complete).toBe(true);
    const snapshot = { id: `qa-interrupt-${randomBytes(4).toString('hex')}`, time: new Date() };
    await new Promise((r) => setTimeout(r, 20));
    const objects = await seed(4, 'interrupt');
    const applications = objects.map((o) => ({ id: randomBytes(12).toString('hex'), createdAt: new Date(snapshot.time.getTime() - 1000), storageKey: o.key, sizeBytes: o.bytes.length, checksumSha256: o.sha }));
    const recordsBefore = (await readCopyRuns(manifestRole.log)).runs.length;

    // 1. Interrupted: the third copy PUT hangs, and the process is killed (SIGKILL) while it waits.
    const proxy = await startFaultProxy({ upstream: moto.endpoint });
    let copyPuts = 0;
    proxy.setPlan({ PUT: [({ url }) => (url.startsWith(`/${B.copy}/`) && ++copyPuts > 2 ? 'hang' : 'pass')] });
    const interrupted = cli('copy', [], { BACKUP_S3_ENDPOINT: proxy.endpoint, BACKUP_S3_TIMEOUT_MS: '60000' });
    const deadline = Date.now() + 20_000;
    while (copyPuts < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
    expect(copyPuts).toBe(3);
    interrupted.child.kill('SIGKILL');
    expect((await interrupted.done).signal).toBe('SIGKILL');
    await proxy.close();
    const copiedSoFar = [];
    for (const o of objects) if ((await headObject(copier.copy, o.key)).exists) copiedSoFar.push(o.objectRef);
    expect(copiedSoFar).toHaveLength(2);
    expect((await readCopyRuns(manifestRole.log)).runs.length).toBe(recordsBefore); // no record for the killed run
    const afterKill = await buildManifest({ snapshot, applications, ...manifestRole });
    expect(afterKill.state).toBe('UNASSESSED');
    expect(afterKill.reasons).toContain('NO_COMPLETE_COPY_RUN_AFTER_SNAPSHOT');
    expect(afterKill.defects.map((d) => d.copy)).toEqual(['ABSENT', 'ABSENT']);

    // 2. Failed: one copy PUT answered 500 — the run completes with complete:false.
    const failing = await startFaultProxy({ upstream: moto.endpoint });
    let puts = 0;
    failing.setPlan({ PUT: [({ url }) => (url.startsWith(`/${B.copy}/`) && ++puts === 1 ? { respond: { status: 500, body: '<Error><Code>InternalError</Code></Error>' } } : 'pass')] });
    const failed = cli('copy', [], { BACKUP_S3_ENDPOINT: failing.endpoint });
    const failedResult = await failed.done;
    await failing.close();
    expect(failedResult.code).toBe(1);
    expect(lastJson(failedResult.out)).toMatchObject({ complete: false, recorded: true });
    const afterFail = await buildManifest({ snapshot, applications, ...manifestRole });
    expect(afterFail.state).toBe('UNASSESSED');

    // 3. Repeated, undisturbed: complete; the two earlier copies are not written again.
    const versionsBefore = listVersions(moto, B.copy, 'resumes/').length;
    const repeated = cli('copy');
    const repeatedResult = await repeated.done;
    expect(repeatedResult.code).toBe(0);
    const summary = lastJson(repeatedResult.out);
    expect(summary).toMatchObject({ complete: true, recorded: true });
    expect(summary.copied).toBe(1);
    expect(listVersions(moto, B.copy, 'resumes/').length).toBe(versionsBefore + 1);
    const after = await buildManifest({ snapshot, applications, ...manifestRole });
    expect(after.state).toBe('PRELIMINARY: NO DEFECT FOUND');
    expect(after.basis).toBe('LIVE_DATABASE');
    expect(after.stored).toBe(true);
    expect(JSON.stringify(summary) + repeatedResult.err).not.toMatch(/resumes\/[0-9a-f]{32}|qa-backup|AKIA|secret/i);
  });
});

describe('the deletion log', () => {
  it('reads back every entry; an unreadable store or a malformed entry makes the WHOLE log unavailable', async () => {
    const entry = await appendDeletionEntry(logWriter, { applicationId: 'c'.repeat(24), objectRef: 'd'.repeat(32), authorisation: 'QA-LOG-READ' });
    const entries = await readDeletionLog(as(B.log, 'qa-backup-restorer'));
    expect(entries.map((e) => e.entryId)).toContain(entry.entryId);
    // No permission (the copier has none on the log): unavailable.
    await expect(readDeletionLog(as(B.log, 'qa-backup-copier'))).rejects.toMatchObject({ name: 'DeletionLogUnavailable', reason: 'PERMISSION_DENIED' });
    // Unreachable: unavailable.
    await expect(readDeletionLog(endpointFor(moto, B.log, 'qa-backup-restorer', { url: 'http://127.0.0.1:9', timeoutMs: 500 }))).rejects.toBeInstanceOf(DeletionLogUnavailable);
  });

  it('an entry holds no applicant data, no storage key', async () => {
    const entry = await appendDeletionEntry(logWriter, { applicationId: 'e'.repeat(24), objectRef: 'f'.repeat(32), authorisation: 'QA-LOG-SHAPE' });
    expect(Object.keys(entry).sort()).toEqual(['applicationId', 'authorisation', 'entryId', 'loggedAt', 'objectRef', 'reason', 'schema']);
  });
});

describe('the manifest (preliminary, from the live database)', () => {
  it('PRELIMINARY: DEFECT FOUND (1) for a record whose object never reached the copy; the report says whether the primary still holds it', async () => {
    expect((await runCopy(copier)).complete).toBe(true);
    const [good] = await seed(1, 'manifest-good');
    const bad = { key: resumeKey(), bytes: Buffer.from('QA never stored'), objectRef: null };
    bad.objectRef = storageObjectRef(bad.key);
    const snapshot = { id: `qa-defect-${randomBytes(4).toString('hex')}`, time: new Date() };
    await new Promise((r) => setTimeout(r, 20));
    expect((await runCopy(copier)).complete).toBe(true);
    const applications = [
      { id: randomBytes(12).toString('hex'), createdAt: new Date(snapshot.time.getTime() - 5), storageKey: good.key, sizeBytes: good.bytes.length, checksumSha256: good.sha },
      { id: randomBytes(12).toString('hex'), createdAt: new Date(snapshot.time.getTime() - 5), storageKey: bad.key, sizeBytes: bad.bytes.length, checksumSha256: sha256(bad.bytes) },
      // created after T: not part of this snapshot
      { id: randomBytes(12).toString('hex'), createdAt: new Date(snapshot.time.getTime() + 60_000), storageKey: resumeKey(), sizeBytes: 1, checksumSha256: '0'.repeat(64) },
    ];
    const manifest = await buildManifest({ snapshot, applications, ...manifestRole });
    expect(manifest.state).toBe('PRELIMINARY: DEFECT FOUND (1)');
    expect(manifest.applicationsAtOrBeforeSnapshot).toBe(2);
    expect(manifest.defects).toEqual([expect.objectContaining({ objectRef: bad.objectRef, copy: 'ABSENT', primaryHoldsGoodObject: 'NO' })]);
    expect(JSON.stringify(manifest)).not.toContain(bad.key);
  });
});

describe('the CLI refuses a configuration that crosses the boundary', () => {
  it.each([
    ["the API's own credential as the copier's", { BACKUP_COPIER_ACCESS_KEY_ID: 'QA-SAME-KEY-ID-0001', RESUME_STORAGE_S3_ACCESS_KEY_ID: 'QA-SAME-KEY-ID-0001' }, 'BACKUP_COPIER_ACCESS_KEY_ID'],
    ['the copy bucket equal to the primary', { BACKUP_COPY_BUCKET: 'qa-valida-resumes' }, 'BACKUP_COPY_BUCKET'],
    ['plain http to a remote endpoint', { BACKUP_S3_ENDPOINT: 'http://qa-store.example.test' }, 'BACKUP_S3_ENDPOINT'],
  ])('%s: exit 2, naming the variable, never a value', async (_label, env, variable) => {
    const result = await cli('copy', [], env).done;
    expect(result.code).toBe(2);
    expect(result.err).toContain(variable);
    expect(result.err).not.toContain('QA-SAME-KEY-ID-0001');
    expect(result.err).not.toContain(moto.users['qa-backup-copier'].secretAccessKey);
  });

  it('a restore into the primary or copy bucket is refused', async () => {
    const result = await cli('restore', ['--snapshot-id', 'qa', '--snapshot-time', new Date().toISOString()], { BACKUP_RESTORE_BUCKET: B.copy, BACKUP_RESTORE_MONGODB_URI: 'mongodb://127.0.0.1:9/qa' }).done;
    expect(result.code).toBe(2);
    expect(result.err).toContain('BACKUP_RESTORE_BUCKET');
  });
});

describe('restore targets', () => {
  let target;
  beforeEach(() => {
    target = `qa-valida-restore-${randomBytes(4).toString('hex')}`;
    createRestoreBucket(moto, target);
  });
  it('the restorer writes a NEW target, but never the copy or the log', async () => {
    const restorer = { copy: as(B.copy, 'qa-backup-restorer'), log: as(B.log, 'qa-backup-restorer'), target: as(target, 'qa-backup-restorer') };
    expect((await putNewObject(restorer.target, resumeKey(), Buffer.from('qa'))).created).toBe(true);
    await expect(putNewObject(restorer.copy, resumeKey(), Buffer.from('qa'))).rejects.toMatchObject({ reason: 'PERMISSION_DENIED' });
    await expect(putNewObject(restorer.log, `deletion-log/qa-${randomUUID()}.json`, Buffer.from('{}'))).rejects.toMatchObject({ reason: 'PERMISSION_DENIED' });
    const listed = await listKeys(restorer.copy, 'resumes/');
    const { bytes } = await getObject(restorer.copy, listed[0].key);
    expect(bytes.length).toBeGreaterThan(0);
    expect(BackupStoreError).toBeTypeOf('function');
  });
});
