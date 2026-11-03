import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Job } from '../../src/models/Job.js';
import { Application } from '../../src/models/Application.js';
import { createTestCertificates } from '../fixtures/testCertificates.js';
import { startLocalSmtpServer, headersOf } from '../fixtures/localSmtpServer.js';
import { parseMime, headerValue, leaves } from '../fixtures/mimeInspect.js';
import { requireTestDatabase, assertConnectedToTestDatabase } from './testDatabase.js';
import { syntheticApplication } from './fixtures/syntheticApplication.js';

// The run's naming contract, stated here independently of scripts/smoke-lifecycle.mjs.
const smokeJobSlug = (runId) => `qa-smoke-${runId}`;
const smokeStoragePrefix = (runId) => `valida-smoke-storage-${runId}-`;
const ownershipRecordName = (runId) => `valida-smoke-run-${runId}.json`;
const OWNERSHIP_COLLECTION = 'valida_smoke_runs';

/**
 * B6 r4/r5/r6 — REHEARSAL of the opt-in live smoke test (scripts/notifications-smoke.mjs)
 * end to end, as a real process, against the REAL test database — with the
 * LOCAL SMTP TEST SERVER standing in for Titan. The child trusts the local
 * TEST CA through Node's NODE_EXTRA_CA_CERTS only, and its OS temporary
 * directory is this test's own directory (so its resume files and ownership
 * record can be checked).
 *
 * Proves the script itself: the real server composition — listening on
 * loopback only (r5) — a synthetic QA job and Application, both notifications
 * submitted once, the replay sending nothing, the bounce exercise reported
 * as what was ESTABLISHED (r5), the dry-run retry assessment, a confirmed
 * cleanup of exactly its own records and only then of its files (r5), and —
 * r6 — that --cleanup-run deletes NOTHING unless the run's ownership is
 * proven (record, database target, marker), finds the run's Applications even
 * when their Job is gone, and is harmless when repeated (regressions A–E).
 * It is NOT Titan evidence: the owner runs the same script against Titan.
 */
const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const OTHER_PERMITTED_URI = TEST_URI.replace(/\/([^/?]+)(\?|$)/, `/${TEST_DATABASE}_r6other$2`);
// The same database name reached through another server address (127.0.0.1 <-> localhost): a different target.
const SAME_NAME_OTHER_TARGET_URI = TEST_URI.includes('127.0.0.1') ? TEST_URI.replace('127.0.0.1', 'localhost') : TEST_URI.includes('localhost') ? TEST_URI.replace('localhost', '127.0.0.1') : null;
const backendRoot = path.join(import.meta.dirname, '..', '..');
const USERNAME = 'notifications@qa-valida.example.test';
const PASSWORD = 'qa-smoke-rehearsal-password-marker';
const HR = 'recruitment@qa-valida.example.test';
const INBOX = 'qa.inbox@qa-valida.example.test';
const BOUNCE = 'qa.bounce@qa-valida.example.test';

let directory;
let caFile;
let certificates;
const relays = [];
beforeAll(async () => {
  certificates = createTestCertificates();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'valida-smoke-rehearsal-'));
  caFile = path.join(directory, 'qa-test-ca.pem');
  fs.writeFileSync(caFile, certificates.ca);
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5_000 });
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
});
afterEach(async () => {
  while (relays.length) await relays.pop().stop();
});
afterAll(async () => {
  await mongoose.disconnect();
  fs.rmSync(directory, { recursive: true, force: true });
});

async function relay(behaviour) {
  const local = await startLocalSmtpServer({ certificate: certificates.localhost, credentials: { username: USERNAME, password: PASSWORD }, behaviour });
  relays.push(local);
  return local;
}

function run(args, port, testUri = TEST_URI) {
  const appDatabase = TEST_URI.replace(/\/[^/?]+(\?|$)/, '/valida_dev$1');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/notifications-smoke.mjs', ...args], {
      cwd: backendRoot,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        // The child's OS temporary directory is this test's directory (Linux and Windows).
        TMPDIR: directory,
        TEMP: directory,
        TMP: directory,
        NODE_EXTRA_CA_CERTS: caFile,
        MONGODB_URI: appDatabase,
        MONGODB_TEST_URI: testUri,
        TRANSACTIONAL_EMAIL_PROVIDER: 'smtp',
        SMTP_HOST: 'localhost',
        SMTP_PORT: String(port ?? 1),
        SMTP_USERNAME: USERNAME,
        SMTP_PASSWORD: PASSWORD,
        TRANSACTIONAL_FROM_ADDRESS: USERNAME,
        TRANSACTIONAL_REPLY_TO: 'careers@qa-valida.example.test',
        RECRUITMENT_NOTIFICATION_RECIPIENT: HR,
        EMAIL_RECIPIENT_ALLOWLIST: '@qa-valida.example.test',
        NOTIFICATION_TIMEOUT_MS: '10000',
      },
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('close', (code) => resolve({ code, output }));
  });
}

const storageDirectoriesOf = (runId) => fs.readdirSync(directory).filter((name) => name.startsWith(smokeStoragePrefix(runId)));
const filesUnder = (root) =>
  fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'));
const recordFile = (runId) => path.join(directory, ownershipRecordName(runId));
const ownershipRecordOf = (runId) => JSON.parse(fs.readFileSync(recordFile(runId), 'utf8'));
const markerOf = (runId) => mongoose.connection.collection(OWNERSHIP_COLLECTION).findOne({ _id: runId });
/** The run's records, found by the RECORDED Job id (independently of the slug; remembered, as a test may remove the record file). */
const recordedJobIds = new Map();
const recordsOf = async (runId) => {
  if (!recordedJobIds.has(runId)) recordedJobIds.set(runId, ownershipRecordOf(runId).jobId);
  const jobId = recordedJobIds.get(runId);
  const jobs = await Job.find({ _id: jobId }).lean();
  const applications = await Application.find({ jobId }).lean();
  return { jobs, applications };
};
/** Everything a refused cleanup must leave exactly as it was. */
async function snapshot(runId) {
  const { jobs, applications } = await recordsOf(runId);
  const [storage] = storageDirectoriesOf(runId);
  return { jobs: jobs.length, applications: applications.length, storage: storage ?? null, files: storage ? filesUnder(path.join(directory, storage)).length : 0, marker: Boolean(await markerOf(runId)) };
}
async function keptRun(local, name) {
  const evidenceFile = path.join(directory, `evidence-${name}.json`);
  const kept = await run(['--candidate-recipient', INBOX, '--confirm-live-email', '--keep-records', '--evidence', evidenceFile], local.port);
  expect(kept.code).toBe(0);
  return JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
}

describe('B6 live smoke script — full rehearsal (real test database, LOCAL SMTP TEST SERVER — not Titan)', () => {
  it('sends each notification once, replays without sending, reports an explicit bounce refusal as such, listens on loopback only, and confirms its cleanup — records, files, then ownership', async () => {
    const local = await relay({ rcptTo: (address) => (address === BOUNCE ? { code: 550, text: '5.1.1 QA bounce recipient does not exist' } : null) });
    const evidenceFile = path.join(directory, 'evidence-normal.json');
    const jobsBefore = await Job.countDocuments({});
    const applicationsBefore = await Application.countDocuments({});

    const { code, output } = await run(['--candidate-recipient', INBOX, '--bounce-recipient', BOUNCE, '--confirm-live-email', '--evidence', evidenceFile], local.port);
    expect(output).toMatch(/AUTOMATED RESULT: PASS/);
    expect(code).toBe(0);

    // What reached the relay: internal x2 (both Applications), acknowledgement x1 (the bounce recipient was refused at RCPT TO).
    const recipients = local.record.messages.map((received) => received.rcptTo[0]).sort();
    expect(recipients).toEqual([HR, HR, INBOX].sort());
    const acknowledgement = local.record.messages.find((received) => received.rcptTo[0] === INBOX);
    expect(headersOf(acknowledgement.raw).get('reply-to')).toEqual(['careers@qa-valida.example.test']);
    // B6 Stage 2 (b6-2): the approved copy contains non-ASCII characters, so the mail library encodes the
    // subject (RFC 2047) and the bodies (quoted-printable, soft-wrapped). The title is checked where it is
    // read: the decoded Subject and the decoded plain-text and HTML parts — each must carry it.
    const acknowledgementMime = parseMime(acknowledgement.raw);
    expect(headerValue(acknowledgementMime, 'subject')).toMatch(/QA SMOKE TEST ROLE - NOT A REAL VACANCY/);
    for (const type of ['text/plain', 'text/html']) {
      expect(leaves(acknowledgementMime).find((leaf) => leaf.type === type).text).toMatch(/QA SMOKE TEST ROLE - NOT A REAL VACANCY/);
    }

    const evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
    expect(evidence.automatedResult).toBe('PASS');
    // r5 finding 4: the server's ACTUAL listening address.
    expect(evidence.listen).toEqual({ address: '127.0.0.1', port: 'as chosen' });
    expect(evidence.checks['the test server listens on loopback only (127.0.0.1)'].ok).toBe(true);
    expect(evidence.checks['replay sent nothing more (submissions unchanged, attempt counts unchanged)'].ok).toBe(true);
    // r5 finding 3: an explicit 5xx refusal is reported as exactly that.
    expect(evidence.bounceTest).toMatchObject({ outcome: 'REJECTED_BY_RELAY', relayAcceptance: 'rejected', bounceVerification: 'NOT_EXERCISED', replyCode: 550 });
    expect(output).toMatch(/explicitly REFUSED it during submission \(SMTP 5xx\)/);
    expect(evidence.sends.map((entry) => entry.result).sort()).toEqual(['ACCEPTED_BY_RELAY', 'ACCEPTED_BY_RELAY', 'ACCEPTED_BY_RELAY', 'FAILED:INVALID_RECIPIENT']);
    // r5 findings 1-2 and r6: every lifecycle step confirmed; ownership proven, then released.
    expect(evidence.shutdown).toEqual({ clean: true });
    expect(evidence.cleanup).toMatchObject({ records: 'REMOVED', complete: true, ownership: 'VERIFIED', confirmed: { applicationsDeleted: 2, jobsDeleted: 1 } });
    expect(evidence.storage.files).toBe('REMOVED');
    expect(evidence.lifecycle.failures).toEqual([]);
    expect(evidence.lifecycle.steps.map((step) => step.name)).toEqual([
      'server shut down cleanly',
      'synthetic records removed (confirmed by the database)',
      'resume files removed (confirmed)',
      'ownership record marked RELEASING (records and files confirmed removed)',
      'ownership marker released (confirmed)',
      'ownership record marked CLEANED',
    ]);
    expect(evidence.ownership).toMatchObject({ record: ownershipRecordName(evidence.runId), database: TEST_DATABASE, target: expect.stringMatching(/^[0-9a-f]{16}$/), marker: 'WRITTEN' });
    expect(ownershipRecordOf(evidence.runId)).toMatchObject({ state: 'CLEANED', markerRelease: 'released', recordsRemovedAt: expect.any(String), confirmed: { applicationsDeleted: 2, jobsDeleted: 1 } });
    expect(await markerOf(evidence.runId)).toBeNull();
    expect(storageDirectoriesOf(evidence.runId)).toEqual([]);
    const text = JSON.stringify(evidence);
    const databaseServer = TEST_URI.slice(TEST_URI.indexOf('://') + 3).split('/')[0].split('@').pop();
    for (const secret of [PASSWORD, INBOX, BOUNCE, HR, USERNAME, 'QA Smoke Candidate', directory, databaseServer]) expect(text).not.toContain(secret);
    expect(output).not.toContain(PASSWORD);
    expect(fs.readFileSync(recordFile(evidence.runId), 'utf8')).not.toMatch(/password|qa-smoke-rehearsal/i);

    // Exactly its own records were removed; nothing else in the test database was touched.
    expect(await Job.countDocuments({})).toBe(jobsBefore);
    expect(await Application.countDocuments({})).toBe(applicationsBefore);
    expect(await Job.countDocuments({ slug: smokeJobSlug(evidence.runId) })).toBe(0);

    // E: a later --cleanup-run of the same (already cleaned) run is harmless and says so.
    const again = await run(['--cleanup-run', evidence.runId]);
    expect(again.code, again.output).toBe(0);
    expect(again.output).toMatch(/ALREADY CLEANED \(recorded .+\): nothing to do\./);
    expect(await Job.countDocuments({})).toBe(jobsBefore);
    expect(await Application.countDocuments({})).toBe(applicationsBefore);
  }, 120_000);

  it('an UNKNOWN bounce-test outcome (the connection is lost after the body) is reported as unknown and inconclusive — never as a refusal — and is not retried', async () => {
    const local = await relay({ data: (recipients) => (recipients.includes(BOUNCE) ? 'disconnect-after-body' : 'accept') });
    const evidenceFile = path.join(directory, 'evidence-unknown.json');

    const { code, output } = await run(['--candidate-recipient', INBOX, '--bounce-recipient', BOUNCE, '--confirm-live-email', '--evidence', evidenceFile], local.port);
    expect(code).toBe(0);
    const evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
    expect(evidence.bounceTest).toMatchObject({ outcome: 'UNKNOWN', relayAcceptance: 'unknown', bounceVerification: 'INCONCLUSIVE', recorded: { status: 'FAILED', code: 'OUTCOME_UNKNOWN' } });
    expect(output).toMatch(/OUTCOME UNKNOWN: the relay may or may not have accepted it, so a bounce MAY still arrive/);
    expect(output).toMatch(/bounce exercise: UNKNOWN — bounce verification INCONCLUSIVE/);
    // r6 review decision: an INCONCLUSIVE bounce next to an automated PASS is never presented as bounce / delivery verification or B6 acceptance.
    expect(output).toMatch(/AUTOMATED RESULT: PASS[^\n]*\n {2}\(automated checks and lifecycle steps only — this is NOT mailbox delivery, bounce verification or B6 acceptance\)/);
    expect(evidence).toMatchObject({ automatedResult: 'PASS', automatedResultScope: expect.stringMatching(/not mailbox delivery, bounce verification or B6 acceptance/) });
    expect(output).toMatch(/a bounce MAY arrive \(acceptance unknown\)/);
    expect(output).not.toMatch(/refused it at submission|no bounce message is expected/);
    // Submitted once, never retried (the dry run finds it not due: uncertain outcomes are operator-only).
    expect(local.record.messages.filter((received) => received.rcptTo.includes(BOUNCE))).toHaveLength(1);
    expect(evidence.checks['dry-run retry assessment of the bounce test (informational; nothing is sent)']).toEqual({ due: [] });
    expect(evidence.cleanup).toMatchObject({ records: 'REMOVED', complete: true });
  }, 120_000);

  it('E: --keep-records keeps the records AND their files with an ACTIVE ownership; --cleanup-run removes them after proving ownership; a repeat is ALREADY CLEANED', async () => {
    const local = await relay({});
    const evidence = await keptRun(local, 'kept');
    const { runId } = evidence;
    expect(evidence.cleanup).toEqual({ records: 'KEPT', reason: '--keep-records' });
    expect(evidence.storage).toMatchObject({ files: 'RETAINED' });
    expect(ownershipRecordOf(runId)).toMatchObject({ state: 'ACTIVE', database: { name: TEST_DATABASE } });
    expect(await markerOf(runId)).toMatchObject({ nonce: ownershipRecordOf(runId).database.nonce });

    // Consistent: every kept Application's resume object is still in the kept storage directory.
    const { jobs, applications } = await recordsOf(runId);
    expect(jobs).toHaveLength(1);
    expect(applications).toHaveLength(1);
    expect(ownershipRecordOf(runId).applicationIds).toEqual(applications.map((application) => String(application._id)));
    const directories = storageDirectoriesOf(runId);
    expect(directories).toEqual([ownershipRecordOf(runId).storageDirectory]);
    const objects = filesUnder(path.join(directory, directories[0]));
    for (const application of applications) expect(objects.some((name) => name.endsWith(application.resume.storageKey))).toBe(true);

    const cleanup = await run(['--cleanup-run', runId]);
    expect(cleanup.output).toMatch(/ownership: VERIFIED/);
    expect(cleanup.output).toMatch(/deleted:\s+1 Application\(s\), 1 job\(s\) \(confirmed by the database\)/);
    expect(cleanup.output).toMatch(/CLEANUP COMPLETE \(confirmed\)/);
    expect(cleanup.code).toBe(0);
    expect(await recordsOf(runId)).toEqual({ jobs: [], applications: [] });
    expect(storageDirectoriesOf(runId)).toEqual([]);
    expect(await markerOf(runId)).toBeNull();
    expect(ownershipRecordOf(runId).state).toBe('CLEANED');
    expect(local.record.messages).toHaveLength(2);

    const again = await run(['--cleanup-run', runId]);
    expect(again.code).toBe(0);
    expect(again.output).toMatch(/ALREADY CLEANED \(recorded .+\): nothing to do\./);
  }, 180_000);

  it('A, B, D: another permitted test database, the same name on another target, a database without the marker, a missing, corrupted or inconsistent ownership record — every one REFUSED, nothing deleted; then the right target cleans up', async () => {
    const local = await relay({});
    const { runId } = await keptRun(local, 'refusals');
    const before = await snapshot(runId);
    expect(before).toMatchObject({ jobs: 1, applications: 1, marker: true });
    expect(before.files).toBeGreaterThanOrEqual(1);
    const refusedWith = async (code, testUri = TEST_URI, unchanged = before) => {
      const result = await run(['--cleanup-run', runId], undefined, testUri);
      expect(result.code, result.output).toBe(1);
      expect(result.output).toMatch(new RegExp(`REFUSED \\(${code}\\)`));
      expect(result.output).toMatch(/Nothing was deleted; every file was kept\./);
      expect(await snapshot(runId)).toEqual(unchanged);
    };

    // A — another PERMITTED test database (r5: "CLEANUP COMPLETE" and the files removed).
    await refusedWith('TARGET_MISMATCH', OTHER_PERMITTED_URI);
    // B — the same database name through another server address.
    if (SAME_NAME_OTHER_TARGET_URI) await refusedWith('TARGET_MISMATCH', SAME_NAME_OTHER_TARGET_URI);
    // B — the same name and address, but no ownership marker in it (as on another server, or after it was released).
    const marker = await markerOf(runId);
    await mongoose.connection.collection(OWNERSHIP_COLLECTION).deleteOne({ _id: runId });
    await refusedWith('OWNERSHIP_MARKER_ABSENT', TEST_URI, { ...before, marker: false });
    await mongoose.connection.collection(OWNERSHIP_COLLECTION).insertOne(marker);
    // D — the ownership record missing (as for every run made before r6), then corrupted.
    const saved = fs.readFileSync(recordFile(runId), 'utf8');
    fs.rmSync(recordFile(runId));
    await refusedWith('OWNERSHIP_RECORD_MISSING');
    fs.writeFileSync(recordFile(runId), saved.replace(/"nonce": "[0-9a-f]{32}"/, '"nonce": "not-a-nonce"'));
    await refusedWith('OWNERSHIP_RECORD_INVALID');
    fs.writeFileSync(recordFile(runId), saved.slice(0, Math.floor(saved.length / 2)));
    await refusedWith('OWNERSHIP_RECORD_INVALID');
    // D — inconsistent: a well-formed record whose nonce is not the marker's, or that names another (missing) directory of the run.
    fs.writeFileSync(recordFile(runId), saved.replace(/"nonce": "[0-9a-f]{32}"/, `"nonce": "${'0'.repeat(32)}"`));
    await refusedWith('OWNERSHIP_MARKER_MISMATCH');
    fs.writeFileSync(recordFile(runId), saved.replace(/"storageDirectory": "[^"]+"/, `"storageDirectory": "${smokeStoragePrefix(runId)}zzzzzz"`));
    await refusedWith('OWNERSHIP_RECORD_INCONSISTENT');
    fs.writeFileSync(recordFile(runId), saved);
    expect(await markerOf(runId)).toMatchObject({ storageDirectory: before.storage });

    // The right target, the record restored: complete.
    const cleanup = await run(['--cleanup-run', runId]);
    expect(cleanup.code, cleanup.output).toBe(0);
    expect(await snapshot(runId)).toEqual({ jobs: 0, applications: 0, storage: null, files: 0, marker: false });
  }, 240_000);

  it('C: the parent Job is deleted while its Application survives — --cleanup-run still finds the Application by the recorded Job id and removes it before the files (r5 left it behind)', async () => {
    const local = await relay({});
    const { runId } = await keptRun(local, 'orphan');
    const { jobId } = ownershipRecordOf(runId);
    await Job.collection.deleteOne({ _id: new mongoose.Types.ObjectId(jobId) });
    expect(await snapshot(runId)).toMatchObject({ jobs: 0, applications: 1, marker: true });

    const cleanup = await run(['--cleanup-run', runId]);
    expect(cleanup.code, cleanup.output).toBe(0);
    expect(cleanup.output).toMatch(/the run's Job missing; 1 synthetic Application\(s\) by the recorded Job id \(1 without their Job/);
    expect(cleanup.output).toMatch(/deleted:\s+1 Application\(s\), 0 job\(s\)/);
    expect(await snapshot(runId)).toEqual({ jobs: 0, applications: 0, storage: null, files: 0, marker: false });
  }, 180_000);

  it('C: the parent Job is gone and an Application linked to it is NOT synthetic — INCOMPLETE (exit 1), that record untouched, the files KEPT; once it is gone the run completes', async () => {
    const local = await relay({});
    const { runId } = await keptRun(local, 'orphan-foreign');
    const { jobId } = ownershipRecordOf(runId);
    await Job.collection.deleteOne({ _id: new mongoose.Types.ObjectId(jobId) });
    const foreign = new mongoose.Types.ObjectId();
    // r9: a complete, valid Application (its own idempotency key hash and resume storage key) through the validated
    // save — not a bare document inserted into the collection, which lacks both uniquely indexed fields and so is
    // refused by MongoDB (E11000, dup key: null) as soon as any other such document exists.
    await syntheticApplication({ _id: foreign, jobId: new mongoose.Types.ObjectId(jobId), jobSnapshot: { title: 'QA rehearsal: a record linked to the run\'s Job', slug: smokeJobSlug(runId) }, fullName: 'Not a smoke candidate' }).save();
    try {
      const before = await snapshot(runId);
      expect(before).toMatchObject({ jobs: 0, applications: 2, marker: true });

      const incomplete = await run(['--cleanup-run', runId]);
      expect(incomplete.code, incomplete.output).toBe(1);
      expect(incomplete.output).toMatch(/NOT TOUCHED: 0 job\(s\) and 1 Application\(s\) linked to this run are not positively the run's/);
      expect(incomplete.output).toMatch(/INCOMPLETE \(RECORDS_REMAIN\): records of this run remain or could not be removed, so its resume files were KEPT/);
      expect(incomplete.output).not.toMatch(/CLEANUP COMPLETE/);
      // The run's own synthetic Application went; the foreign one, the files and the ownership stayed.
      expect(await snapshot(runId)).toEqual({ ...before, applications: 1 });
      expect(await Application.collection.countDocuments({ _id: foreign })).toBe(1);
      expect(ownershipRecordOf(runId).state).toBe('ACTIVE');
    } finally {
      await Application.collection.deleteOne({ _id: foreign });
    }
    const cleanup = await run(['--cleanup-run', runId]);
    expect(cleanup.code, cleanup.output).toBe(0);
    expect(await snapshot(runId)).toEqual({ jobs: 0, applications: 0, storage: null, files: 0, marker: false });
  }, 180_000);
});
