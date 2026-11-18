#!/usr/bin/env node
/**
 * Proposed (MongoDB-native launch change, r2) — authorised deletion and the
 * restore gate when résumés live in MongoDB and the deletion history lives in
 * the independent, locked journal (src/ops/backup/deletionJournal.js).
 *
 * Journal (S3 API, the accepted C6-T6 log bucket): BACKUP_S3_ENDPOINT,
 * BACKUP_S3_REGION, BACKUP_LOG_BUCKET [, BACKUP_S3_URL_STYLE, BACKUP_S3_TIMEOUT_MS]
 * and the role's own key pair: BACKUP_JOURNAL_WRITER_* or BACKUP_JOURNAL_READER_*;
 * BACKUP_JOURNAL_NAMESPACE (default `production`; `review` for the Review environment).
 *
 *   journal-init                  writer. Writes checkpoint 0 once (provisioning); prints the anchor
 *   delete-application --application <id> --authorisation <ref> --confirm
 *                                 writer + RECOVERY_OPERATOR_MONGODB_URI (role valida_deletion_operator).
 *                                 Journal entry + checkpoint first (read back), then the résumé
 *                                 version, then the record. Prints the checkpoint: the owner records
 *                                 it as the new anchor
 *   journal-head                  reader. The newest verified checkpoint
 *   journal-export --out <file>   reader. The whole verified journal as one JSON file
 *   prepare-target --target-id <id> --expires-hours <h> --writer-uri-out <file> [--mode snapshot|load]
 *                                 OWNER, with RECOVERY_TARGET_ADMIN_MONGODB_URI (an admin of the NEW
 *                                 temporary cluster only). Refuses the live replica set; writes the
 *                                 restore_authorization document; creates role valida_restore_writer
 *                                 and its user; writes the writer URI to the file (mode 0600)
 *   restore-verify --snapshot-id <id> --anchor <count>:<sha256> [--journal-file <file>] [--report <file>]
 *                                 RECOVERY_RESTORED_MONGODB_URI (the restore writer), RECOVERY_RESTORE_TARGET_ID,
 *                                 RECOVERY_LIVE_REPLICA_SET; optional RECOVERY_LIVE_MONGODB_URI (any live
 *                                 user: only `hello` is sent there, to detect an alias). The history comes
 *                                 from the journal (reader) unless --journal-file names an export. The
 *                                 target is positively identified BEFORE the first write (restoreTarget.js)
 *
 *   backup-create                 (r3, D-MN-2) RECOVERY_BACKUP_READER_MONGODB_URI (role valida_backup_reader),
 *                                 BACKUP_RECIPIENT_PUBLIC_KEYS (>= 2 PEM public keys), BACKUP_DUMP_WRITER_* and
 *                                 BACKUP_COPY_BUCKET. One snapshot read, encrypted, written, read back. Prints the
 *                                 backup id, recovery point and the manifest SHA-256 for the owner record
 *   backup-restore --backup-id <id> --manifest-sha256 <sha> --private-key-file <pem> --anchor <count>:<sha256>
 *                  [--journal-file <file>]   (target prepared with --mode load; BACKUP_DUMP_READER_*;
 *                                 RECOVERY_PRIVATE_KEY_PASSPHRASE; RECOVERY_BACKUP_MAX_AGE_DAYS, default 35)
 *                                 Verifies target, history and recovery material BEFORE the first write; loads
 *                                 the copy into the EMPTY target; replays deletions; verifies
 *
 * One JSON line on stdout (ids, counts, checkpoint digests; never a key, URI,
 * credential or applicant field). Exit codes: 0 done / RECOVERY VERIFIED;
 * 1 INCOMPLETE, NOT_STARTED, OBJECT_MISMATCH or RECOVERY FAILED / REFUSED;
 * 2 refused before doing anything (the variable or argument is named, never its value).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import { MongoPrivateStorage } from '../src/integrations/storage/mongoPrivateStorage.js';
import { BackupConfigurationError, resolveBackupRole } from '../src/ops/backup/backupConfig.js';
import { deletionJournal, exportJournalStore, s3JournalStore } from '../src/ops/backup/deletionJournal.js';
import { deleteApplicationDurably } from '../src/ops/backup/durableDeletion.js';
import { runMongoRestore } from '../src/ops/backup/mongoRestore.js';
import { restoreTargetRoleDefinitions } from '../src/ops/backup/mongoRoles.js';
import { RECOVERY_COLLECTIONS, RESTORE_AUTHORIZATION_COLLECTION, uriIdentity } from '../src/ops/backup/restoreTarget.js';
import { createRecoveryCopy, restoreRecoveryCopy, s3RecoveryStore } from '../src/ops/backup/recoveryCopy.js';
import { safeErrorSummary } from '../src/lib/safeError.js';

const { MongoClient } = mongoose.mongo;
const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    application: { type: 'string' },
    authorisation: { type: 'string' },
    confirm: { type: 'boolean', default: false },
    'snapshot-id': { type: 'string' },
    anchor: { type: 'string' },
    'journal-file': { type: 'string' },
    report: { type: 'string' },
    out: { type: 'string' },
    'target-id': { type: 'string' },
    'expires-hours': { type: 'string' },
    'writer-uri-out': { type: 'string' },
    mode: { type: 'string' },
    'backup-id': { type: 'string' },
    'manifest-sha256': { type: 'string' },
    'private-key-file': { type: 'string' },
  },
});
const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const refuse = (message) => {
  process.stderr.write(`recovery ${command ?? ''}: ${message}\n`);
  process.exit(2);
};
function uriOf(variable) {
  const value = process.env[variable];
  if (!value || !/^mongodb(\+srv)?:\/\//.test(value)) refuse(`${variable} is required (a mongodb:// or mongodb+srv:// URI)`);
  return value;
}
function parseAnchor(value) {
  const match = /^(0|[1-9][0-9]{0,9}):([a-f0-9]{64})$/.exec(value ?? '');
  if (!match) refuse('--anchor is required as <count>:<sha256>: the newest checkpoint in the owner record');
  return { count: Number(match[1]), sha256: match[2] };
}
function namespace() {
  const ns = process.env.BACKUP_JOURNAL_NAMESPACE ?? 'production';
  if (!/^[a-z0-9-]{1,32}$/.test(ns)) refuse('BACKUP_JOURNAL_NAMESPACE must be 1-32 lowercase letters, digits or hyphens');
  return ns;
}
const journalFor = (role) => deletionJournal(s3JournalStore(resolveBackupRole(role).endpoints.log), { namespace: namespace() });
async function client(uri) {
  const c = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await c.connect();
  return c;
}
const anchorOf = (checkpoint) => `${checkpoint.count}:${checkpoint.sha256}`;

try {
  if (command === 'journal-init') {
    const { checkpoint } = await journalFor('journal-writer').init();
    print({ command, checkpoint, anchor: anchorOf(checkpoint) });
  } else if (command === 'delete-application') {
    if (!values.confirm) refuse('an authorised deletion needs --confirm (and --application, --authorisation)');
    if (!/^[0-9a-f]{24}$/.test(values.application ?? '')) refuse('--application is required (24 hex)');
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(values.authorisation ?? '')) refuse('--authorisation is required: the identifier of the decision that authorises this deletion');
    const uri = uriOf('RECOVERY_OPERATOR_MONGODB_URI');
    const journal = journalFor('journal-writer');
    const storage = new MongoPrivateStorage({ uri, mode: 'deletion' });
    await storage.init();
    const c = await client(uri);
    try {
      const result = await deleteApplicationDurably({ applicationId: values.application, authorisation: values.authorisation, applications: c.db().collection('applications'), storage, journal });
      print({ command, ...result, ...(result.checkpoint ? { anchor: anchorOf(result.checkpoint) } : {}) });
      process.exitCode = result.status === 'COMPLETE' || result.status === 'NO_RECORD' ? 0 : 1;
    } finally {
      await c.close();
      await storage.close();
    }
  } else if (command === 'journal-head' || command === 'journal-export') {
    if (command === 'journal-export' && !values.out) refuse('--out <file> is required');
    const journal = journalFor('journal-reader');
    if (command === 'journal-export') {
      const { exported, checkpoint } = await journal.export();
      writeFileSync(values.out, `${JSON.stringify(exported)}\n`, { mode: 0o600 });
      print({ command, checkpoint, anchor: anchorOf(checkpoint), objects: exported.objects.length });
    } else {
      const { checkpoint, entries, pending } = await journal.readHistory();
      print({ command, checkpoint, anchor: anchorOf(checkpoint), entries: entries.length, pending: pending.length });
    }
  } else if (command === 'prepare-target') {
    const targetId = values['target-id'];
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(targetId ?? '')) refuse('--target-id is required (16-64 letters, digits, - or _; generate it and record it in the owner record)');
    const hours = Number(values['expires-hours'] ?? '');
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) refuse('--expires-hours is required (1-168)');
    if (!values['writer-uri-out']) refuse('--writer-uri-out <file> is required');
    const mode = values.mode ?? 'snapshot';
    if (!['snapshot', 'load'].includes(mode)) refuse('--mode must be snapshot (a restored Atlas snapshot) or load (an empty target for a recovery copy)');
    const liveSet = process.env.RECOVERY_LIVE_REPLICA_SET;
    if (!liveSet) refuse('RECOVERY_LIVE_REPLICA_SET is required');
    const adminUri = uriOf('RECOVERY_TARGET_ADMIN_MONGODB_URI');
    const restoredUri = process.env.RECOVERY_RESTORED_DATABASE;
    if (!/^[A-Za-z0-9_-]{1,63}$/.test(restoredUri ?? '')) refuse('RECOVERY_RESTORED_DATABASE is required (the restored database name)');
    const c = await client(adminUri);
    try {
      const hello = await c.db('admin').command({ hello: 1 });
      if (!hello.setName) refuse('the target is not a replica set');
      if (hello.setName === liveSet) refuse('RECOVERY_TARGET_ADMIN_MONGODB_URI is the LIVE replica set: nothing was written');
      const db = c.db(restoredUri);
      if ((await db.collection(RESTORE_AUTHORIZATION_COLLECTION).countDocuments({})) > 0) refuse('the target already holds a restore authorisation: use a new restore target');
      if (mode === 'load') {
        for (const name of RECOVERY_COLLECTIONS) if ((await db.collection(name).countDocuments({}, { limit: 1 })) > 0) refuse('--mode load needs an EMPTY target database: nothing was written');
      }
      await db.collection(RESTORE_AUTHORIZATION_COLLECTION).insertOne({ targetId, setName: hello.setName, database: restoredUri, mode, purpose: 'valida-restore', authorisedAt: new Date(), expiresAt: new Date(Date.now() + hours * 3_600_000) }, { writeConcern: { w: 'majority', j: true } });
      const roles = restoreTargetRoleDefinitions(restoredUri, mode);
      for (const [role, privileges] of Object.entries(roles)) {
        await db.command({ createRole: role, privileges, roles: [] });
      }
      const roleName = Object.keys(roles)[0];
      const pwd = randomBytes(24).toString('hex');
      const user = `${roleName}_${targetId.slice(0, 8)}`;
      await db.command({ createUser: user, pwd, roles: [{ role: roleName, db: restoredUri }] });
      const id = uriIdentity(adminUri.replace(/\/[^/?]*(\?|$)/, `/${restoredUri}$1`));
      const scheme = adminUri.startsWith('mongodb+srv://') ? 'mongodb+srv' : 'mongodb';
      writeFileSync(values['writer-uri-out'], `${scheme}://${user}:${pwd}@${id.hosts.join(',')}/${restoredUri}?authSource=${restoredUri}${hello.setName && scheme === 'mongodb' ? `&replicaSet=${hello.setName}` : ''}\n`, { mode: 0o600 });
      print({ command, setName: hello.setName, database: restoredUri, mode, writerUser: user, expiresHours: hours });
    } finally {
      await c.close();
    }
  } else if (command === 'backup-create') {
    // The daily independent recovery copy (D-MN-2). Holds only PUBLIC keys: it cannot read any copy.
    const uri = uriOf('RECOVERY_BACKUP_READER_MONGODB_URI');
    const pems = (process.env.BACKUP_RECIPIENT_PUBLIC_KEYS ?? '').match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/g) ?? [];
    if (pems.length < 2) refuse('BACKUP_RECIPIENT_PUBLIC_KEYS must hold at least two PEM public keys (the owner key and the sealed recovery key)');
    const store = s3RecoveryStore(resolveBackupRole('backup-dump-writer').endpoints.copy);
    const c = await client(uri);
    try {
      const result = await createRecoveryCopy({ client: c, db: c.db(), store, recipients: pems, namespace: namespace() });
      print({ command, ...result });
    } finally {
      await c.close();
    }
  } else if (command === 'backup-restore') {
    const backupId = values['backup-id'];
    if (!/^\d{8}T\d{6}Z-[0-9a-f]{8}$/.test(backupId ?? '')) refuse('--backup-id is required (as printed by backup-create)');
    if (!/^[0-9a-f]{64}$/.test(values['manifest-sha256'] ?? '')) refuse('--manifest-sha256 is required: the digest printed by backup-create and kept in the owner record');
    if (!values['private-key-file']) refuse('--private-key-file is required (the owner key or the sealed recovery key)');
    const anchor = parseAnchor(values.anchor);
    const targetUri = uriOf('RECOVERY_RESTORED_MONGODB_URI');
    if (!process.env.RECOVERY_RESTORE_TARGET_ID) refuse('RECOVERY_RESTORE_TARGET_ID is required');
    if (!process.env.RECOVERY_LIVE_REPLICA_SET) refuse('RECOVERY_LIVE_REPLICA_SET is required');
    const maxAgeDays = Number(process.env.RECOVERY_BACKUP_MAX_AGE_DAYS ?? 35);
    if (!Number.isInteger(maxAgeDays) || maxAgeDays < 1 || maxAgeDays > 400) refuse('RECOVERY_BACKUP_MAX_AGE_DAYS must be 1-400');
    const privateKey = readFileSync(values['private-key-file'], 'utf8');
    const history = values['journal-file'] ? deletionJournal(exportJournalStore(JSON.parse(readFileSync(values['journal-file'], 'utf8'))), { namespace: namespace() }) : journalFor('journal-reader');
    const store = s3RecoveryStore(resolveBackupRole('backup-dump-reader').endpoints.copy);
    const liveUri = process.env.RECOVERY_LIVE_MONGODB_URI ?? null;
    const target = await client(targetUri);
    let live = null;
    try {
      if (liveUri) live = await client(liveUri).catch(() => null);
      const report = await restoreRecoveryCopy({
        targetClient: target, targetUri, liveUris: [liveUri, process.env.RECOVERY_OPERATOR_MONGODB_URI, process.env.MONGODB_URI], liveClient: live,
        store, namespace: namespace(), backupId, expectedManifestSha256: values['manifest-sha256'], privateKey, passphrase: process.env.RECOVERY_PRIVATE_KEY_PASSPHRASE,
        history, anchor, maxAgeDays,
      });
      if (values.report) writeFileSync(values.report, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
      print({ command, backupId, verdict: report.verdict, reasons: report.reasons, recoveryPoint: report.recoveryPoint, target: report.target, history: report.history, loaded: report.loaded, applied: report.applied, checked: report.checked, missing: report.missing.length, mismatched: report.mismatched.length, orphans: report.orphans });
      process.exitCode = report.verdict === 'RECOVERY VERIFIED' ? 0 : 1;
    } finally {
      await target.close();
      await live?.close();
    }
  } else if (command === 'restore-verify') {
    const snapshotId = values['snapshot-id'];
    if (!/^[A-Za-z0-9._:-]{1,64}$/.test(snapshotId ?? '')) refuse('--snapshot-id is required (the Atlas snapshot id or time)');
    const anchor = parseAnchor(values.anchor);
    const targetUri = uriOf('RECOVERY_RESTORED_MONGODB_URI');
    if (!process.env.RECOVERY_RESTORE_TARGET_ID) refuse('RECOVERY_RESTORE_TARGET_ID is required');
    if (!process.env.RECOVERY_LIVE_REPLICA_SET) refuse('RECOVERY_LIVE_REPLICA_SET is required');
    const history = values['journal-file'] ? deletionJournal(exportJournalStore(JSON.parse(readFileSync(values['journal-file'], 'utf8'))), { namespace: namespace() }) : journalFor('journal-reader');
    const liveUri = process.env.RECOVERY_LIVE_MONGODB_URI ?? null;
    const target = await client(targetUri);
    let live = null;
    try {
      if (liveUri) live = await client(liveUri).catch(() => null);
      const report = await runMongoRestore({
        targetClient: target, targetUri, liveUris: [liveUri, process.env.RECOVERY_OPERATOR_MONGODB_URI, process.env.MONGODB_URI], liveClient: live,
        history, anchor, snapshot: { id: snapshotId },
      });
      // A live cluster that cannot be reached (a disaster) leaves the alias check to the replica-set name.
      const notes = liveUri && !live ? ['LIVE_UNREACHABLE: alias checked by replica-set name and authorisation only'] : [];
      if (values.report) writeFileSync(values.report, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
      print({ command, snapshot: report.snapshot, verdict: report.verdict, reasons: report.reasons, notes, target: report.target, history: report.history, applied: report.applied, checked: report.checked, missing: report.missing.length, mismatched: report.mismatched.length, orphans: report.orphans });
      process.exitCode = report.verdict === 'RECOVERY VERIFIED' ? 0 : 1;
    } finally {
      await target.close();
      await live?.close();
    }
  } else {
    refuse('usage: mongo-recovery.mjs journal-init | delete-application | journal-head | journal-export | prepare-target | restore-verify | backup-create | backup-restore');
  }
} catch (error) {
  if (error instanceof BackupConfigurationError) refuse(error.message);
  const { type, code } = safeErrorSummary(error);
  const named = ['PrivateStorageError', 'StorageInitializationError', 'DeletionLogUnavailable', 'BackupStoreError'].includes(error?.name);
  process.stderr.write(`recovery ${command}: failed (${named ? `${error.name} ${error.reason}` : `${type}${code ? ` ${code}` : ''}`})\n`);
  process.exitCode = 1;
}
