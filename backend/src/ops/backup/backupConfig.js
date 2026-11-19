/**
 * C6-T6 — configuration of the backup tooling (D-9; C6 plan r3 §5; the r3
 * correction 1 on the restore rehearsal).
 *
 * THE BACKUP TOOLING HAS ITS OWN ACCESS BOUNDARY. None of these tools reads
 * the API's storage credential (RESUME_STORAGE_S3_*), and each role has its
 * own credential, scoped at the provider to exactly what it does:
 *
 *   role          variables                         may (provider policy)
 *   copier        BACKUP_COPIER_ACCESS_KEY_ID/…     read the primary bucket; write NEW
 *                                                   objects in the copy bucket; write
 *                                                   copy-run records in the log bucket.
 *                                                   Nothing is ever deleted
 *   manifest      BACKUP_MANIFEST_ACCESS_KEY_ID/…   read the copy bucket and the log
 *                 BACKUP_MANIFEST_MONGODB_URI       bucket, HEAD the primary; write
 *                 (a READ-ONLY database user)       manifests. Reads Applications
 *   log-writer    BACKUP_LOG_WRITER_ACCESS_KEY_ID/… append deletion-log entries (new
 *                                                   objects only; the bucket is locked)
 *   restorer      BACKUP_RESTORER_ACCESS_KEY_ID/…   read the copy and log buckets; write
 *                 BACKUP_RESTORE_MONGODB_URI        the NEW restore-target bucket and the
 *                                                   restored database
 *
 * Shared, not secret: BACKUP_S3_ENDPOINT, BACKUP_S3_REGION, BACKUP_S3_URL_STYLE,
 * BACKUP_S3_TIMEOUT_MS, BACKUP_PRIMARY_BUCKET, BACKUP_COPY_BUCKET,
 * BACKUP_LOG_BUCKET, BACKUP_RESTORE_BUCKET.
 *
 * Rules (each refusal names the variable, never its value):
 *   - the endpoint is an origin; https, except a loopback endpoint when
 *     APP_ENV=local and NODE_ENV is not production (the API's own rule);
 *   - the buckets a role uses are all different (a copy in the primary, a
 *     log beside what it protects, or a restore over live data is refused);
 *   - a role's access key id must differ from RESUME_STORAGE_S3_ACCESS_KEY_ID
 *     when that is set: the backup never runs on the application's token.
 */
const LOOPBACK = new Set(['127.0.0.1', '[::1]', 'localhost']);
const REGION = /^[a-z0-9-]{1,32}$/;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const KEY_ID = /^[A-Za-z0-9._-]{8,128}$/;
const SECRET = /^[\x21-\x7e]{16,256}$/;

export const BACKUP_ROLES = Object.freeze({
  copier: { prefix: 'BACKUP_COPIER', buckets: ['primary', 'copy', 'log'] },
  manifest: { prefix: 'BACKUP_MANIFEST', buckets: ['primary', 'copy', 'log'] },
  'log-writer': { prefix: 'BACKUP_LOG_WRITER', buckets: ['log'] },
  restorer: { prefix: 'BACKUP_RESTORER', buckets: ['copy', 'log', 'restore'] },
  // Proposed (MongoDB-native r2): the durable deletion journal in the locked log bucket
  // (deletionJournal.js). Writer: create/read/list under deletion-journal/ only. Reader: read/list.
  'journal-writer': { prefix: 'BACKUP_JOURNAL_WRITER', buckets: ['log'] },
  'journal-reader': { prefix: 'BACKUP_JOURNAL_READER', buckets: ['log'] },
  // r3 (D-MN-2): the encrypted recovery copies, in their own locked bucket (BACKUP_COPY_BUCKET), prefix
  // encrypted-backups/. Writer: create/read only (no delete, no listing needed); reader: read.
  'backup-dump-writer': { prefix: 'BACKUP_DUMP_WRITER', buckets: ['copy'] },
  'backup-dump-reader': { prefix: 'BACKUP_DUMP_READER', buckets: ['copy'] },
});
const BUCKET_VARIABLE = Object.freeze({ primary: 'BACKUP_PRIMARY_BUCKET', copy: 'BACKUP_COPY_BUCKET', log: 'BACKUP_LOG_BUCKET', restore: 'BACKUP_RESTORE_BUCKET' });

export class BackupConfigurationError extends Error {
  constructor(problems) {
    super(`backup configuration refused:\n${problems.map((p) => `  ${p.variable}: ${p.rule}`).join('\n')}`);
    this.name = 'BackupConfigurationError';
    this.problems = problems;
  }
}

/**
 * @returns {{ role, endpoints: { primary?, copy?, log?, restore? } }} each endpoint in the
 *   shape s3Http.s3Request takes. Secrets are non-enumerable.
 */
export function resolveBackupRole(role, env = process.env) {
  const spec = BACKUP_ROLES[role];
  if (!spec) throw new TypeError('unknown backup role');
  const problems = [];
  const problem = (variable, rule) => problems.push({ variable, rule });

  let url = null;
  const endpointText = env.BACKUP_S3_ENDPOINT;
  if (!endpointText) problem('BACKUP_S3_ENDPOINT', 'is required');
  else {
    try {
      url = new URL(endpointText);
    } catch {
      url = null;
    }
    const originOnly = url && !url.username && !url.password && (url.pathname === '/' || url.pathname === '') && !url.search && !url.hash && !endpointText.includes('?');
    if (!originOnly || (url.protocol !== 'https:' && url.protocol !== 'http:')) {
      problem('BACKUP_S3_ENDPOINT', 'must be an origin (scheme, host, optional port)');
      url = null;
    } else if (url.protocol === 'http:' && !(LOOPBACK.has(url.hostname) && (env.APP_ENV ?? 'local') === 'local' && env.NODE_ENV !== 'production')) {
      problem('BACKUP_S3_ENDPOINT', 'must use https://; plain http:// only for a loopback endpoint when APP_ENV=local');
      url = null;
    } else url = new URL(url.origin);
  }
  const region = env.BACKUP_S3_REGION;
  if (!region || !REGION.test(region)) problem('BACKUP_S3_REGION', 'is required: 1-32 lowercase letters, digits or hyphens');
  const urlStyle = env.BACKUP_S3_URL_STYLE || 'path';
  if (urlStyle !== 'path' && urlStyle !== 'virtual') problem('BACKUP_S3_URL_STYLE', 'must be "path" (default) or "virtual"');
  let timeoutMs = 15_000;
  if (env.BACKUP_S3_TIMEOUT_MS) {
    timeoutMs = Number(env.BACKUP_S3_TIMEOUT_MS);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 120_000) problem('BACKUP_S3_TIMEOUT_MS', 'must be a whole number of milliseconds from 500 to 120000');
  }

  const accessKeyId = env[`${spec.prefix}_ACCESS_KEY_ID`];
  const secretAccessKey = env[`${spec.prefix}_SECRET_ACCESS_KEY`];
  if (!accessKeyId || !KEY_ID.test(accessKeyId)) problem(`${spec.prefix}_ACCESS_KEY_ID`, 'is required: 8-128 letters, digits, dots, hyphens or underscores');
  if (!secretAccessKey || !SECRET.test(secretAccessKey)) problem(`${spec.prefix}_SECRET_ACCESS_KEY`, 'is required: 16-256 visible ASCII characters');
  if (accessKeyId && env.RESUME_STORAGE_S3_ACCESS_KEY_ID && accessKeyId === env.RESUME_STORAGE_S3_ACCESS_KEY_ID) {
    problem(`${spec.prefix}_ACCESS_KEY_ID`, "must not be the application's storage credential (RESUME_STORAGE_S3_ACCESS_KEY_ID): the backup has its own access boundary");
  }

  const names = {};
  for (const which of spec.buckets) {
    const variable = BUCKET_VARIABLE[which];
    const value = env[variable];
    if (!value || !BUCKET.test(value) || value.includes('..')) problem(variable, 'is required: a bucket name (3-63 lowercase letters, digits, dots or hyphens)');
    else names[which] = value;
  }
  const used = Object.entries(names);
  for (let i = 0; i < used.length; i += 1) {
    for (let j = i + 1; j < used.length; j += 1) {
      if (used[i][1] === used[j][1]) problem(BUCKET_VARIABLE[used[j][0]], `must differ from ${BUCKET_VARIABLE[used[i][0]]}`);
    }
  }
  // The restore target is never live data, whichever role is configured.
  if (names.restore && [env.BACKUP_PRIMARY_BUCKET, env.BACKUP_COPY_BUCKET, env.BACKUP_LOG_BUCKET, env.RESUME_STORAGE_S3_BUCKET].includes(names.restore)) {
    problem('BACKUP_RESTORE_BUCKET', 'must be a NEW bucket: not the primary, copy or log bucket, nor the API bucket');
  }
  if (problems.length) throw new BackupConfigurationError(problems);

  const endpoints = {};
  for (const [which, bucket] of used) {
    const endpoint = { url, region, bucket, urlStyle, timeoutMs, role };
    Object.defineProperty(endpoint, 'accessKeyId', { value: accessKeyId, enumerable: false });
    Object.defineProperty(endpoint, 'secretAccessKey', { value: secretAccessKey, enumerable: false });
    endpoints[which] = Object.freeze(endpoint);
  }
  return Object.freeze({ role, endpoints: Object.freeze(endpoints) });
}

/** A MongoDB URI variable for a role; refused when it is the application's own. */
export function resolveBackupDatabase(variable, env = process.env) {
  const uri = env[variable];
  if (!uri || !/^mongodb(\+srv)?:\/\//.test(uri)) throw new BackupConfigurationError([{ variable, rule: 'is required: a mongodb:// or mongodb+srv:// URI' }]);
  if (variable === 'BACKUP_RESTORE_MONGODB_URI' && env.MONGODB_URI && uri === env.MONGODB_URI) {
    throw new BackupConfigurationError([{ variable, rule: "must be the NEW restore-target database, never the application's MONGODB_URI" }]);
  }
  return uri;
}
