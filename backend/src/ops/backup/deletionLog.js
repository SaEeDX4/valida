import { randomUUID } from 'node:crypto';
import { BackupStoreError, getObject, listKeys, putNewObject } from './backupStore.js';

/**
 * C6-T6 — the deletion log (C6 plan r3 §5.1, §5.4; D-9).
 *
 * Append-only, in the log bucket, apart from the database and both résumé
 * buckets. Each entry is its OWN object, written with If-None-Match (never
 * over another) by the log-writer credential, which may create objects
 * under `deletion-log/` and nothing else; the bucket carries a retention
 * lock, so an entry cannot be removed or replaced while the lock runs.
 *
 * An entry holds no applicant data: the Application id, the one-way object
 * reference (storageContract.storageObjectRef), the time, a fixed reason and
 * the identifier of the authorisation. It is written BEFORE the record and
 * the object are removed (authorisedDeletion.js).
 *
 * Reading the log is all-or-nothing: an entry that cannot be listed, read
 * or parsed makes the whole log UNAVAILABLE, and a restore then cannot pass
 * its gate (restore.js).
 */
export const DELETION_LOG_PREFIX = 'deletion-log/';
export const DELETION_LOG_SCHEMA = 'valida.deletion-log.v1';
const OBJECT_ID = /^[0-9a-f]{24}$/;
const OBJECT_REF = /^[0-9a-f]{32}$/;
const AUTHORISATION = /^[A-Za-z0-9._-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class DeletionLogUnavailable extends Error {
  constructor(reason) {
    super(`the deletion log is unavailable (${reason})`);
    this.name = 'DeletionLogUnavailable';
    this.reason = reason;
  }
}

export function validEntry(entry) {
  return (
    entry &&
    entry.schema === DELETION_LOG_SCHEMA &&
    typeof entry.entryId === 'string' &&
    UUID.test(entry.entryId) &&
    typeof entry.applicationId === 'string' &&
    OBJECT_ID.test(entry.applicationId) &&
    (entry.objectRef === null || (typeof entry.objectRef === 'string' && OBJECT_REF.test(entry.objectRef))) &&
    typeof entry.loggedAt === 'string' &&
    !Number.isNaN(new Date(entry.loggedAt).getTime()) &&
    entry.reason === 'AUTHORISED_DELETION' &&
    typeof entry.authorisation === 'string' &&
    AUTHORISATION.test(entry.authorisation)
  );
}

/** Appends one entry. Throws unless the store confirms a NEW object. */
export async function appendDeletionEntry(logEndpoint, { applicationId, objectRef, authorisation, now = new Date() }) {
  const entry = { schema: DELETION_LOG_SCHEMA, entryId: randomUUID(), applicationId: String(applicationId), objectRef: objectRef ?? null, loggedAt: now.toISOString(), reason: 'AUTHORISED_DELETION', authorisation };
  if (!validEntry(entry)) throw new TypeError('invalid deletion-log entry');
  const key = `${DELETION_LOG_PREFIX}${entry.loggedAt.replace(/[-:.]/g, '')}-${entry.entryId}.json`;
  const written = await putNewObject(logEndpoint, key, Buffer.from(`${JSON.stringify(entry)}\n`), { contentType: 'application/json' });
  if (!written.created) throw new BackupStoreError('put', 'CONFLICT');
  return entry;
}

/** Every entry, oldest first. Any failure: DeletionLogUnavailable. */
export async function readDeletionLog(logEndpoint) {
  let keys;
  try {
    keys = await listKeys(logEndpoint, DELETION_LOG_PREFIX);
  } catch (error) {
    throw new DeletionLogUnavailable(error instanceof BackupStoreError ? error.reason : 'UNAVAILABLE');
  }
  const entries = [];
  for (const { key } of keys) {
    let object;
    try {
      object = await getObject(logEndpoint, key);
    } catch (error) {
      throw new DeletionLogUnavailable(error instanceof BackupStoreError ? error.reason : 'UNAVAILABLE');
    }
    let entry;
    try {
      entry = JSON.parse(object.bytes.toString('utf8'));
    } catch {
      throw new DeletionLogUnavailable('ENTRY_INVALID');
    }
    if (!validEntry(entry)) throw new DeletionLogUnavailable('ENTRY_INVALID');
    entries.push(entry);
  }
  const ids = new Set(entries.map((e) => e.entryId));
  if (ids.size !== entries.length) throw new DeletionLogUnavailable('ENTRY_INVALID');
  return entries.sort((a, b) => a.loggedAt.localeCompare(b.loggedAt) || a.entryId.localeCompare(b.entryId));
}
