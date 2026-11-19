import { randomUUID } from 'node:crypto';
import { isResumeStorageKey, storageObjectRef } from '../../integrations/storage/storageContract.js';
import { BackupStoreError, getObject, headObject, listKeys, putNewObject, sha256Hex } from './backupStore.js';

/**
 * C6-T6 — the hourly résumé copy (D-9; C6 plan r3 §5.1).
 *
 * One run:
 *   1. lists every résumé object in the PRIMARY bucket (strict listing);
 *   2. for each, unless the COPY bucket already holds it with a verified
 *      SHA-256: reads its bytes, computes SHA-256 FROM THE BYTES, checks it
 *      against the primary's own stored checksum, and writes the copy as a
 *      NEW object (If-None-Match) carrying that checksum and the source
 *      version; then reads the copy's metadata back to confirm it;
 *   3. only at the end, writes ONE copy-run record in the log bucket, with
 *      `complete: true` only when every object was confirmed.
 *
 * What it never does: delete anything; overwrite a copy (a different copy
 * already under the key is a CONFLICT, reported, left alone — the bucket is
 * locked); copy an object whose bytes disagree with the primary's checksum.
 *
 * An INTERRUPTED run (killed, network lost) writes no record, and a run
 * with any failure records `complete: false`. Neither can make a snapshot
 * assessable: the manifest requires a COMPLETE run that started after the
 * snapshot (manifest.js). A repeated run is safe: confirmed copies are
 * skipped and nothing is written twice.
 *
 * The record names objects by their one-way reference only.
 */
export const COPY_RUN_PREFIX = 'copy-runs/';
export const COPY_RUN_SCHEMA = 'valida.copy-run.v1';
const OBJECT_PREFIX = 'resumes/';

export async function runCopy({ primary, copy, log, clock = () => new Date(), runId = randomUUID(), onObject = () => {} }) {
  const startedAt = clock();
  const outcome = { copied: [], alreadyCopied: [], failed: [] };
  const record = (bucket, objectRef, extra = {}) => {
    outcome[bucket].push({ objectRef, ...extra });
    onObject({ bucket, objectRef, ...extra });
  };

  let entries;
  try {
    entries = await listKeys(primary, OBJECT_PREFIX);
  } catch (error) {
    // Nothing is known: no record is written (an incomplete view is not a run).
    return { runId, complete: false, listed: false, reason: error instanceof BackupStoreError ? error.reason : 'UNAVAILABLE', ...outcome };
  }
  const keys = entries.map((e) => e.key).filter(isResumeStorageKey);
  const unexpected = entries.length - keys.length;

  for (const key of keys) {
    const objectRef = storageObjectRef(key);
    try {
      const existing = await headObject(copy, key);
      if (existing.exists) {
        if (typeof existing.sha256 === 'string' && /^[0-9a-f]{64}$/.test(existing.sha256)) {
          const source = await headObject(primary, key);
          if (source.exists && source.sha256 && source.sha256 !== existing.sha256) record('failed', objectRef, { reason: 'COPY_CONFLICT' });
          else record('alreadyCopied', objectRef);
        } else record('failed', objectRef, { reason: 'COPY_UNVERIFIABLE' });
        continue;
      }
      const source = await getObject(primary, key);
      const digest = sha256Hex(source.bytes);
      if (source.sha256 && source.sha256 !== digest) {
        record('failed', objectRef, { reason: 'SOURCE_CHECKSUM_MISMATCH' });
        continue;
      }
      const metadata = { sha256: digest, 'source-version': source.versionId ?? 'unversioned' };
      const written = await putNewObject(copy, key, source.bytes, { metadata });
      const check = await headObject(copy, key);
      if (!check.exists || check.size !== source.bytes.length || check.sha256 !== digest) {
        record('failed', objectRef, { reason: written.created ? 'COPY_NOT_CONFIRMED' : 'COPY_CONFLICT' });
      } else record(written.created ? 'copied' : 'alreadyCopied', objectRef, { sizeBytes: source.bytes.length });
    } catch (error) {
      record('failed', objectRef, { reason: error instanceof BackupStoreError ? error.reason : 'UNAVAILABLE' });
    }
  }

  const completedAt = clock();
  const complete = outcome.failed.length === 0;
  const run = {
    schema: COPY_RUN_SCHEMA,
    runId,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    complete,
    primaryObjects: keys.length,
    unexpectedKeys: unexpected,
    copied: outcome.copied.length,
    alreadyCopied: outcome.alreadyCopied.length,
    failed: outcome.failed.map(({ objectRef, reason }) => ({ objectRef, reason })),
  };
  let recorded = false;
  try {
    const key = `${COPY_RUN_PREFIX}${run.startedAt.replace(/[-:.]/g, '')}-${runId}.json`;
    recorded = (await putNewObject(log, key, Buffer.from(`${JSON.stringify(run)}\n`), { contentType: 'application/json' })).created;
  } catch {
    recorded = false;
  }
  // A run whose record could not be written is, for every later decision, not a run.
  return { ...run, recorded, complete: complete && recorded, listed: true, ...outcome };
}

/** Every copy-run record (oldest first). Unreadable records are counted, never trusted. */
export async function readCopyRuns(logEndpoint) {
  const keys = await listKeys(logEndpoint, COPY_RUN_PREFIX);
  const runs = [];
  let unreadable = 0;
  for (const { key } of keys) {
    try {
      const run = JSON.parse((await getObject(logEndpoint, key)).bytes.toString('utf8'));
      if (run?.schema === COPY_RUN_SCHEMA && typeof run.startedAt === 'string' && typeof run.complete === 'boolean') runs.push(run);
      else unreadable += 1;
    } catch {
      unreadable += 1;
    }
  }
  runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return { runs, unreadable };
}
