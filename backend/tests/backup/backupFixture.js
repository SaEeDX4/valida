import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { s3Request } from '../../src/integrations/storage/s3/s3Http.js';
import { startMoto } from '../s3/motoServer.js';

/**
 * C6-T6 — the backup double and test-side helpers. The helpers that DAMAGE
 * or INSPECT (removing every version of an object, listing versions,
 * creating restore targets) use the test-only `qa-fixture` user through
 * botocore in the double's own Python — never the tooling under test.
 */
export const BACKUP_SETUP_ACTIONS = 39;
const PYTHON = () => process.env.VALIDA_TEST_MOTO_PYTHON;

export async function startBackupMoto(options = {}) {
  return startMoto({ ...options, setupScript: new URL('./backup_moto_setup.py', import.meta.url), setupActions: BACKUP_SETUP_ACTIONS });
}

/** An endpoint in the shape s3Request takes, for `user` on `bucket`. */
export function endpointFor(moto, bucket, user, { url = moto.endpoint, timeoutMs = 3_000 } = {}) {
  const keys = moto.users[user];
  return { url: new URL(url), region: 'us-east-1', bucket, urlStyle: 'path', timeoutMs, accessKeyId: keys.accessKeyId, secretAccessKey: keys.secretAccessKey };
}

/** The role environment the CLI reads (scripts/backup.mjs). */
export function roleEnv(moto, { endpoint = moto.endpoint, restoreBucket } = {}) {
  const u = moto.users;
  return {
    APP_ENV: 'local',
    NODE_ENV: 'test',
    BACKUP_S3_ENDPOINT: endpoint,
    BACKUP_S3_REGION: 'us-east-1',
    BACKUP_S3_TIMEOUT_MS: '3000',
    BACKUP_PRIMARY_BUCKET: moto.buckets.primary,
    BACKUP_COPY_BUCKET: moto.buckets.copy,
    BACKUP_LOG_BUCKET: moto.buckets.log,
    ...(restoreBucket ? { BACKUP_RESTORE_BUCKET: restoreBucket } : {}),
    BACKUP_COPIER_ACCESS_KEY_ID: u['qa-backup-copier'].accessKeyId,
    BACKUP_COPIER_SECRET_ACCESS_KEY: u['qa-backup-copier'].secretAccessKey,
    BACKUP_MANIFEST_ACCESS_KEY_ID: u['qa-backup-manifest'].accessKeyId,
    BACKUP_MANIFEST_SECRET_ACCESS_KEY: u['qa-backup-manifest'].secretAccessKey,
    BACKUP_LOG_WRITER_ACCESS_KEY_ID: u['qa-backup-log-writer'].accessKeyId,
    BACKUP_LOG_WRITER_SECRET_ACCESS_KEY: u['qa-backup-log-writer'].secretAccessKey,
    BACKUP_RESTORER_ACCESS_KEY_ID: u['qa-backup-restorer'].accessKeyId,
    BACKUP_RESTORER_SECRET_ACCESS_KEY: u['qa-backup-restorer'].secretAccessKey,
  };
}

export const resumeKey = () => `resumes/${randomBytes(16).toString('hex')}/${randomBytes(16).toString('hex')}`;
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Writes a primary object as the API's driver does (x-amz-meta-sha256), with the API's own user. */
export async function putPrimary(moto, key, bytes, { sha = sha256(bytes) } = {}) {
  const r = await s3Request(endpointFor(moto, moto.buckets.primary, 'qa-app'), {
    method: 'PUT',
    key,
    headers: { 'content-type': 'application/octet-stream', 'if-none-match': '*', 'x-amz-meta-sha256': sha },
    body: Readable.from([bytes]),
    contentLength: bytes.length,
    payloadSha256: sha256(bytes),
  });
  if (r.kind !== 'response' || r.status !== 200) throw new Error(`fixture put failed (${r.status ?? r.kind})`);
  return r.headers['x-amz-version-id'];
}

function boto(script, args) {
  return execFileSync(PYTHON(), ['-I', '-c', script, ...args], { encoding: 'utf8' });
}
const PRELUDE = `
import sys, json, boto3
e, k, s = sys.argv[1:4]
c = boto3.client('s3', endpoint_url=e, region_name='us-east-1', aws_access_key_id=k, aws_secret_access_key=s)
`;
const fixtureArgs = (moto) => [moto.endpoint, moto.users['qa-fixture'].accessKeyId, moto.users['qa-fixture'].secretAccessKey];

/** Every version and delete marker in a bucket under a prefix: [{ key, versionId, latest, deleteMarker }]. */
export function listVersions(moto, bucket, prefix = '') {
  const out = boto(`${PRELUDE}
b, p = sys.argv[4:6]
r = c.list_object_versions(Bucket=b, Prefix=p)
out = [{'key': v['Key'], 'versionId': v['VersionId'], 'latest': v['IsLatest'], 'deleteMarker': False} for v in r.get('Versions', [])]
out += [{'key': v['Key'], 'versionId': v['VersionId'], 'latest': v['IsLatest'], 'deleteMarker': True} for v in r.get('DeleteMarkers', [])]
print(json.dumps(out))`, [...fixtureArgs(moto), bucket, prefix]);
  return JSON.parse(out);
}

/** Removes every version of a primary object, with no log entry (rehearsal D's damage). */
export function destroyPrimaryObject(moto, key) {
  boto(`${PRELUDE}
b, key = sys.argv[4:6]
for v in c.list_object_versions(Bucket=b, Prefix=key).get('Versions', []):
    if v['Key'] == key: c.delete_object(Bucket=b, Key=key, VersionId=v['VersionId'])
for v in c.list_object_versions(Bucket=b, Prefix=key).get('DeleteMarkers', []):
    if v['Key'] == key: c.delete_object(Bucket=b, Key=key, VersionId=v['VersionId'])
print('ok')`, [...fixtureArgs(moto), moto.buckets.primary, key]);
}

/** A NEW, empty, versioned restore-target bucket. */
export function createRestoreBucket(moto, name) {
  boto(`${PRELUDE}
b = sys.argv[4]
c.create_bucket(Bucket=b)
c.put_bucket_versioning(Bucket=b, VersioningConfiguration={'Status': 'Enabled'})
print('ok')`, [...fixtureArgs(moto), name]);
}

/** Tries to remove a version as the test-side superuser: 'DELETED' or the error code. */
export function tryDeleteVersion(moto, bucket, key, versionId) {
  return boto(`${PRELUDE}
b, key, v = sys.argv[4:7]
try:
    c.delete_object(Bucket=b, Key=key, VersionId=v); print('DELETED')
except Exception as err:
    print(getattr(err, 'response', {}).get('Error', {}).get('Code', 'ERROR'))`, [...fixtureArgs(moto), bucket, key, versionId]).trim();
}

/** The bytes of an object, read independently. */
export function readIndependently(moto, bucket, key) {
  const out = boto(`${PRELUDE}
import base64
b, key = sys.argv[4:6]
print(base64.b64encode(c.get_object(Bucket=b, Key=key)['Body'].read()).decode())`, [...fixtureArgs(moto), bucket, key]);
  return Buffer.from(out.trim(), 'base64');
}
