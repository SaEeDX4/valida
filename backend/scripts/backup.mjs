#!/usr/bin/env node
/**
 * C6-T6 — the backup and restore commands (D-9; C6 plan r3 §5; backend/src/ops/backup/).
 *
 *   npm run ops:backup:copy                                  the hourly copy (copier role)
 *   npm run ops:backup:manifest -- --snapshot-id <id> --snapshot-time <ISO>
 *                                                            the per-snapshot manifest (manifest role)
 *   npm run ops:backup:delete-application -- --application <id> --authorisation <ref> --confirm
 *                                                            an authorised deletion, log first
 *                                                            (log-writer role + the API's own configuration)
 *   npm run ops:backup:restore -- --snapshot-id <id> --snapshot-time <ISO> [--expected <file>] [--report <file>]
 *                                                            restore + gate (restorer role)
 *
 * Every command prints one JSON line (ids, one-way references, counts —
 * never a key, credential, endpoint or applicant field). Exit codes:
 *   copy      0 complete, 1 incomplete or failed
 *   manifest  0 PRELIMINARY: NO DEFECT FOUND, 1 any other state (the CI job fails: the alert)
 *   restore   0 RECOVERY VERIFIED, 1 RECOVERY FAILED
 *   any       2 configuration refused (the variable is named, never its value)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import mongoose from 'mongoose';
import { BackupConfigurationError, resolveBackupDatabase, resolveBackupRole } from '../src/ops/backup/backupConfig.js';
import { runCopy } from '../src/ops/backup/copyJob.js';
import { buildManifest } from '../src/ops/backup/manifest.js';
import { runRestore } from '../src/ops/backup/restore.js';
import { deleteApplicationAuthorised } from '../src/ops/backup/authorisedDeletion.js';
import { loadConfig } from '../src/config/env.js';
import { createPrivateStorage } from '../src/integrations/storage/privateStorage.js';
import { safeErrorSummary } from '../src/lib/safeError.js';

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    'snapshot-id': { type: 'string' },
    'snapshot-time': { type: 'string' },
    application: { type: 'string' },
    authorisation: { type: 'string' },
    confirm: { type: 'boolean', default: false },
    expected: { type: 'string' },
    report: { type: 'string' },
  },
});
const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const refuse = (message) => {
  process.stderr.write(`backup ${command ?? ''}: ${message}\n`);
  process.exit(2);
};
function snapshotArg() {
  const id = values['snapshot-id'];
  const time = new Date(values['snapshot-time'] ?? '');
  if (!id || !/^[A-Za-z0-9._-]{1,64}$/.test(id)) refuse('--snapshot-id is required (1-64 letters, digits, dots, hyphens, underscores)');
  if (Number.isNaN(time.getTime())) refuse('--snapshot-time is required (an ISO 8601 time, from the database provider)');
  return { id, time };
}
async function connect(uri) {
  return mongoose.createConnection(uri, { serverSelectionTimeoutMS: 10_000 }).asPromise();
}

try {
  if (command === 'copy') {
    const { endpoints } = resolveBackupRole('copier');
    const result = await runCopy({ primary: endpoints.primary, copy: endpoints.copy, log: endpoints.log });
    const { copied, alreadyCopied, failed, ...summary } = result;
    print({ command, ...summary, copied: copied.length, alreadyCopied: alreadyCopied.length, failed });
    process.exitCode = result.complete ? 0 : 1;
  } else if (command === 'manifest') {
    const snapshot = snapshotArg();
    const { endpoints } = resolveBackupRole('manifest');
    const connection = await connect(resolveBackupDatabase('BACKUP_MANIFEST_MONGODB_URI'));
    try {
      const rows = await connection.db
        .collection('applications')
        .find({ createdAt: { $lte: snapshot.time } }, { projection: { createdAt: 1, 'resume.storageKey': 1, 'resume.sizeBytes': 1, 'resume.checksumSha256': 1 } })
        .toArray();
      const applications = rows.map((r) => ({ id: String(r._id), createdAt: r.createdAt, storageKey: r.resume?.storageKey, sizeBytes: r.resume?.sizeBytes, checksumSha256: r.resume?.checksumSha256 }));
      const manifest = await buildManifest({ snapshot, applications, primary: endpoints.primary, copy: endpoints.copy, log: endpoints.log });
      if (values.report) writeFileSync(values.report, `${JSON.stringify(manifest, null, 2)}\n`);
      print({ command, snapshot: manifest.snapshot, state: manifest.state, reasons: manifest.reasons, applicationsAtOrBeforeSnapshot: manifest.applicationsAtOrBeforeSnapshot, ok: manifest.ok, defects: manifest.defects, deletionsAfterSnapshot: manifest.deletionsAfterSnapshot?.length ?? null, stored: manifest.stored, basis: manifest.basis });
      process.exitCode = manifest.state === 'PRELIMINARY: NO DEFECT FOUND' && manifest.stored ? 0 : 1;
    } finally {
      await connection.close();
    }
  } else if (command === 'delete-application') {
    if (!values.confirm) refuse('an authorised deletion needs --confirm (and --application, --authorisation)');
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(values.authorisation ?? '')) refuse('--authorisation is required: the identifier of the decision that authorises this deletion');
    const { endpoints } = resolveBackupRole('log-writer');
    const config = loadConfig(process.env);
    const storage = createPrivateStorage({ config });
    if (!storage) refuse('the API storage (RESUME_STORAGE_DRIVER) is not configured');
    await storage.init();
    const connection = await connect(config.mongodbUri);
    try {
      const result = await deleteApplicationAuthorised({ applicationId: values.application, authorisation: values.authorisation, applications: connection.db.collection('applications'), storage, log: endpoints.log });
      print({ command, ...result });
    } finally {
      await connection.close();
      await storage.close();
    }
  } else if (command === 'restore') {
    const snapshot = snapshotArg();
    const { endpoints } = resolveBackupRole('restorer');
    let expected = null;
    if (values.expected) {
      const list = JSON.parse(readFileSync(values.expected, 'utf8'));
      expected = new Map(list.map((row) => [row.applicationId, { sizeBytes: row.sizeBytes, checksumSha256: row.checksumSha256 }]));
    }
    const connection = await connect(resolveBackupDatabase('BACKUP_RESTORE_MONGODB_URI'));
    try {
      const report = await runRestore({ applications: connection.db.collection('applications'), copy: endpoints.copy, target: endpoints.restore, log: endpoints.log, snapshot, expected });
      if (values.report) writeFileSync(values.report, `${JSON.stringify(report, null, 2)}\n`);
      print({ command, snapshot: report.snapshot, verdict: report.verdict, reasons: report.reasons, restoredSystem: report.restoredSystem, reconcileBefore: report.reconcileBefore.counts, reconcileAfter: report.reconcileAfter?.counts ?? null, deletionLog: report.deletionLog, timings: report.timings });
      process.exitCode = report.verdict === 'RECOVERY VERIFIED' ? 0 : 1;
    } finally {
      await connection.close();
    }
  } else {
    refuse('usage: backup.mjs copy | manifest | delete-application | restore');
  }
} catch (error) {
  if (error instanceof BackupConfigurationError) refuse(error.message);
  // Fixed text only: the classification, never the message (it may hold a URI).
  const { type, code } = safeErrorSummary(error);
  process.stderr.write(`backup ${command}: failed (${error?.name === 'BackupStoreError' || error?.name === 'DeletionLogUnavailable' ? `${error.name} ${error.reason}` : `${type}${code ? ` ${code}` : ''}`})\n`);
  process.exitCode = 1;
}
