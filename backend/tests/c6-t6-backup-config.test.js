import { describe, it, expect } from 'vitest';
import { BackupConfigurationError, resolveBackupDatabase, resolveBackupRole } from '../src/ops/backup/backupConfig.js';
import { validEntry } from '../src/ops/backup/deletionLog.js';

/** C6-T6 — the backup tooling's own access boundary, from configuration alone. */
const base = {
  APP_ENV: 'local',
  BACKUP_S3_ENDPOINT: 'http://127.0.0.1:9000',
  BACKUP_S3_REGION: 'us-east-1',
  BACKUP_PRIMARY_BUCKET: 'qa-primary',
  BACKUP_COPY_BUCKET: 'qa-copy',
  BACKUP_LOG_BUCKET: 'qa-log',
  BACKUP_RESTORE_BUCKET: 'qa-restore-1',
  BACKUP_COPIER_ACCESS_KEY_ID: 'QACOPIERKEY01',
  BACKUP_COPIER_SECRET_ACCESS_KEY: 'qa-copier-secret-0123456789',
  BACKUP_RESTORER_ACCESS_KEY_ID: 'QARESTORERKEY1',
  BACKUP_RESTORER_SECRET_ACCESS_KEY: 'qa-restorer-secret-0123456789',
};
const refusal = (role, env) => {
  try {
    resolveBackupRole(role, env);
  } catch (error) {
    expect(error).toBeInstanceOf(BackupConfigurationError);
    return error;
  }
  throw new Error('not refused');
};

describe('resolveBackupRole', () => {
  it('a role gets only its own buckets; secrets are not enumerable', () => {
    const { endpoints } = resolveBackupRole('copier', base);
    expect(Object.keys(endpoints).sort()).toEqual(['copy', 'log', 'primary']);
    expect(JSON.stringify(endpoints)).not.toContain('qa-copier-secret');
    expect(endpoints.copy.accessKeyId).toBe('QACOPIERKEY01');
    expect(Object.keys(resolveBackupRole('restorer', base).endpoints).sort()).toEqual(['copy', 'log', 'restore']);
  });

  it.each([
    ["the application's storage credential", { RESUME_STORAGE_S3_ACCESS_KEY_ID: 'QACOPIERKEY01' }, 'BACKUP_COPIER_ACCESS_KEY_ID'],
    ['copy = primary', { BACKUP_COPY_BUCKET: 'qa-primary' }, 'BACKUP_COPY_BUCKET'],
    ['log = copy', { BACKUP_LOG_BUCKET: 'qa-copy' }, 'BACKUP_LOG_BUCKET'],
    ['http to a remote store', { BACKUP_S3_ENDPOINT: 'http://store.example.test' }, 'BACKUP_S3_ENDPOINT'],
    ['http loopback outside local', { APP_ENV: 'review' }, 'BACKUP_S3_ENDPOINT'],
    ['an endpoint with a path', { BACKUP_S3_ENDPOINT: 'https://store.example.test/bucket' }, 'BACKUP_S3_ENDPOINT'],
    ['no credential', { BACKUP_COPIER_SECRET_ACCESS_KEY: '' }, 'BACKUP_COPIER_SECRET_ACCESS_KEY'],
  ])('copier refused: %s', (_label, change, variable) => {
    const error = refusal('copier', { ...base, ...change });
    expect(error.problems.map((p) => p.variable)).toContain(variable);
    expect(error.message).not.toContain('qa-copier-secret');
  });

  it.each([
    ['the primary', 'qa-primary'],
    ['the copy', 'qa-copy'],
    ['the log', 'qa-log'],
    ["the API's bucket", 'qa-api-bucket'],
  ])('a restore target that is %s is refused', (_label, bucket) => {
    const error = refusal('restorer', { ...base, RESUME_STORAGE_S3_BUCKET: 'qa-api-bucket', BACKUP_RESTORE_BUCKET: bucket });
    expect(error.problems.map((p) => p.variable)).toContain('BACKUP_RESTORE_BUCKET');
  });

  it("the restore database is never the application's", () => {
    expect(() => resolveBackupDatabase('BACKUP_RESTORE_MONGODB_URI', { MONGODB_URI: 'mongodb://h/app', BACKUP_RESTORE_MONGODB_URI: 'mongodb://h/app' })).toThrow(BackupConfigurationError);
    expect(resolveBackupDatabase('BACKUP_RESTORE_MONGODB_URI', { MONGODB_URI: 'mongodb://h/app', BACKUP_RESTORE_MONGODB_URI: 'mongodb://h/restore' })).toBe('mongodb://h/restore');
  });
});

describe('deletion-log entries', () => {
  const entry = { schema: 'valida.deletion-log.v1', entryId: '0b9f6f4e-5d0c-4a59-9d6a-0d1f2c3b4a59', applicationId: 'a'.repeat(24), objectRef: 'b'.repeat(32), loggedAt: '2026-11-17T12:00:00.000Z', reason: 'AUTHORISED_DELETION', authorisation: 'QA-1' };
  it('accepts exactly the schema', () => {
    expect(validEntry(entry)).toBe(true);
    expect(validEntry({ ...entry, objectRef: null })).toBe(true);
    for (const change of [{ schema: 'x' }, { applicationId: 'qa' }, { objectRef: 'resumes/abc' }, { reason: 'OTHER' }, { authorisation: 'has space' }, { loggedAt: 'never' }]) {
      expect(validEntry({ ...entry, ...change })).toBe(false);
    }
  });
});
