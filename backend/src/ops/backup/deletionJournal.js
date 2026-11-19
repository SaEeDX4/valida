import { createHash } from 'node:crypto';
import { BackupStoreError, getObject, listKeys, putNewObject } from './backupStore.js';
import { DeletionLogUnavailable } from './deletionLog.js';

/**
 * Proposed (MongoDB-native r2, finding 2) — the DURABLE deletion history.
 *
 * The replay record of every authorised deletion, and a verifiable checkpoint
 * of the whole history, live OUTSIDE the primary database: in the accepted
 * C6-T6 log bucket (S3 API, versioned, Object Lock in COMPLIANCE mode, on a
 * provider independent of Atlas). Losing the primary cluster, its snapshots
 * or the Atlas account does not lose the history.
 *
 *   deletion-journal/<namespace>/entries/<applicationId>.json
 *       one per deleted Application: { schema, applicationId, objectRef,
 *       authorisation, reason, loggedAt }. The key is the Application id, so
 *       a retry after a lost acknowledgement finds its own entry (If-None-Match
 *       answers 412) instead of writing a second one.
 *   deletion-journal/<namespace>/checkpoints/<count, 10 digits>.json
 *       { schema, count, entries: [{ applicationId, sha256 }] (in order),
 *         prevCheckpointSha256, writtenAt }. Checkpoint 0 (genesis) is written
 *       once at provisioning: an EMPTY history is then a verified fact, never
 *       confused with a missing one. Checkpoint k+n extends k by the entries
 *       added since, so every checkpoint is a prefix of the next.
 *
 * Writes are NEW objects only (If-None-Match: *). The writer credential may
 * create, read and list under deletion-journal/ and nothing else; the lock
 * makes every version undeletable for the retention period, by anyone,
 * including the account owner (provider claim: a hosted check).
 *
 * Reading verifies, all-or-nothing:
 *   - checkpoints 0..N present and contiguous (else NOT_INITIALISED / GAP);
 *   - each one well formed, chained to its predecessor by SHA-256, and a
 *     prefix-extension of it (else TAMPERED);
 *   - every entry named by checkpoint N exists with exactly that SHA-256
 *     (missing: INCOMPLETE; different: TAMPERED);
 *   - entries beyond checkpoint N (a deletion interrupted before its
 *     checkpoint) are valid entries and are returned as `pending`;
 *   - with an anchor { count, sha256 } (recorded by the owner outside every
 *     system): checkpoint `count` exists with that digest (else STALE).
 */
export const JOURNAL_PREFIX = 'deletion-journal/';
const NAMESPACE = /^[a-z0-9-]{1,32}$/;
export const JOURNAL_ENTRY_SCHEMA = 'valida.deletion-journal.entry.v1';
export const JOURNAL_CHECKPOINT_SCHEMA = 'valida.deletion-journal.checkpoint.v1';
const GENESIS = 'genesis';
const OBJECT_ID = /^[0-9a-f]{24}$/;
const OBJECT_REF = /^[0-9a-f]{32}$/;
const AUTHORISATION = /^[A-Za-z0-9._-]{1,64}$/;
const SHA = /^[0-9a-f]{64}$/;
const MAX_ATTEMPTS = 4;

export const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const encode = (value) => Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');

function validEntry(e) {
  return e && e.schema === JOURNAL_ENTRY_SCHEMA && OBJECT_ID.test(e.applicationId ?? '') && (e.objectRef === null || OBJECT_REF.test(e.objectRef ?? ''))
    && AUTHORISATION.test(e.authorisation ?? '') && e.reason === 'AUTHORISED_DELETION' && typeof e.loggedAt === 'string' && !Number.isNaN(Date.parse(e.loggedAt));
}

/** The S3 store over the accepted backupStore operations. */
export function s3JournalStore(endpoint) {
  return {
    kind: 's3',
    list: async (prefix) => (await listKeys(endpoint, prefix)).map((e) => e.key),
    get: async (key) => (await getObject(endpoint, key)).bytes,
    putNew: async (key, bytes) => (await putNewObject(endpoint, key, bytes, { contentType: 'application/json', metadata: { sha256: sha256Hex(bytes) } })).created,
  };
}

/**
 * Atlas-native (2026-11-18): the journal as an INSERT-ONLY collection in the live
 * cluster (`deletion_journal`, one document per object: { _id: key, bytes, sha256 }).
 * The same verification applies unchanged. The writer role may only find and
 * insert there (mongoRoles.js): it cannot update or remove a journal document.
 * Unlike the S3 store, the history is NOT independent of Atlas; the owner's
 * anchor (and an offline `journal-export`) is what detects a stale or rewritten copy.
 */
export const JOURNAL_COLLECTION = 'deletion_journal';
export function mongoJournalStore(collection) {
  const majority = { writeConcern: { w: 'majority', j: true } };
  const fail = (operation, error) => {
    if (error?.code === 13 || error?.codeName === 'Unauthorized') return new BackupStoreError(operation, 'PERMISSION_DENIED');
    return new BackupStoreError(operation, 'UNAVAILABLE');
  };
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    kind: 'mongodb',
    list: async (prefix) => {
      try {
        const docs = await collection.find({ _id: { $regex: `^${escape(prefix)}` } }, { projection: { _id: 1 }, readConcern: { level: 'majority' } }).sort({ _id: 1 }).toArray();
        return docs.map((d) => d._id);
      } catch (error) {
        throw fail('list', error);
      }
    },
    get: async (key) => {
      let doc;
      try {
        doc = await collection.findOne({ _id: key }, { readConcern: { level: 'majority' } });
      } catch (error) {
        throw fail('get', error);
      }
      if (!doc) throw new BackupStoreError('get', 'NOT_FOUND');
      const bytes = Buffer.from(doc.bytes.buffer ?? doc.bytes);
      if (doc.sha256 !== sha256Hex(bytes)) throw new DeletionLogUnavailable('TAMPERED');
      return bytes;
    },
    putNew: async (key, bytes) => {
      try {
        await collection.insertOne({ _id: key, bytes, sha256: sha256Hex(bytes), storedAt: new Date() }, majority);
        return true;
      } catch (error) {
        if (error?.code === 11000) return false; // the key exists: never overwritten
        throw fail('put', error);
      }
    },
  };
}

/** A read-only store over an export (the offline path). */
export function exportJournalStore(exported) {
  if (!exported || exported.schema !== 'valida.deletion-journal.export.v1' || !Array.isArray(exported.objects)) throw new DeletionLogUnavailable('EXPORT_INVALID');
  const objects = new Map(exported.objects.map((o) => [o.key, Buffer.from(o.bytes, 'base64')]));
  if (objects.size !== exported.objects.length) throw new DeletionLogUnavailable('EXPORT_INVALID');
  return {
    kind: 'export',
    list: async (prefix) => [...objects.keys()].filter((k) => k.startsWith(prefix)).sort(),
    get: async (key) => {
      if (!objects.has(key)) throw new BackupStoreError('get', 'NOT_FOUND');
      return objects.get(key);
    },
    putNew: async () => {
      throw new BackupStoreError('put', 'PERMISSION_DENIED');
    },
  };
}

const unavailable = (error) => new DeletionLogUnavailable(error instanceof DeletionLogUnavailable ? error.reason : error instanceof BackupStoreError ? error.reason : 'UNAVAILABLE');

/**
 * @param store       mongoJournalStore(collection), s3JournalStore(endpoint) or exportJournalStore(json)
 * @param namespace   one journal per environment (e.g. production, review); keys under deletion-journal/<namespace>/
 */
export function deletionJournal(store, { namespace = 'production', clock = () => new Date() } = {}) {
  if (!NAMESPACE.test(namespace)) throw new TypeError('the journal namespace must be 1-32 lowercase letters, digits or hyphens');
  const ENTRIES = `${JOURNAL_PREFIX}${namespace}/entries/`;
  const CHECKPOINTS = `${JOURNAL_PREFIX}${namespace}/checkpoints/`;
  const entryKey = (applicationId) => `${ENTRIES}${applicationId}.json`;
  const checkpointKey = (count) => `${CHECKPOINTS}${String(count).padStart(10, '0')}.json`;
  async function readVerified({ anchor = null } = {}) {
    let entryKeys;
    let checkpointKeys;
    try {
      entryKeys = await store.list(ENTRIES);
      checkpointKeys = await store.list(CHECKPOINTS);
    } catch (error) {
      throw unavailable(error);
    }
    if (checkpointKeys.length === 0) throw new DeletionLogUnavailable('NOT_INITIALISED');
    const checkpoints = [];
    for (const [index, key] of checkpointKeys.entries()) {
      if (key !== checkpointKey(index)) throw new DeletionLogUnavailable(index === 0 && !checkpointKeys.includes(checkpointKey(0)) ? 'NOT_INITIALISED' : 'GAP');
      let bytes;
      try {
        bytes = await store.get(key);
      } catch (error) {
        throw unavailable(error);
      }
      let cp;
      try {
        cp = JSON.parse(bytes.toString('utf8'));
      } catch {
        throw new DeletionLogUnavailable('TAMPERED');
      }
      const prev = checkpoints[index - 1];
      const shapeOk = cp?.schema === JOURNAL_CHECKPOINT_SCHEMA && cp.count === index && Array.isArray(cp.entries) && cp.entries.length === index
        && cp.entries.every((e) => OBJECT_ID.test(e?.applicationId ?? '') && SHA.test(e?.sha256 ?? ''))
        && new Set(cp.entries.map((e) => e.applicationId)).size === index;
      if (!shapeOk) throw new DeletionLogUnavailable('TAMPERED');
      if (cp.prevCheckpointSha256 !== (prev ? prev.sha256 : GENESIS)) throw new DeletionLogUnavailable('TAMPERED');
      if (prev && prev.doc.entries.some((e, i) => cp.entries[i]?.applicationId !== e.applicationId || cp.entries[i]?.sha256 !== e.sha256)) throw new DeletionLogUnavailable('TAMPERED');
      checkpoints.push({ doc: cp, sha256: sha256Hex(bytes) });
    }
    const head = checkpoints[checkpoints.length - 1];
    if (anchor) {
      const at = checkpoints[anchor.count];
      if (!at || at.sha256 !== anchor.sha256) throw new DeletionLogUnavailable('STALE');
    }
    const present = new Set(entryKeys);
    const entries = [];
    for (const { applicationId, sha256 } of head.doc.entries) {
      if (!present.has(entryKey(applicationId))) throw new DeletionLogUnavailable('INCOMPLETE');
      const bytes = await store.get(entryKey(applicationId)).catch((error) => {
        throw unavailable(error);
      });
      if (sha256Hex(bytes) !== sha256) throw new DeletionLogUnavailable('TAMPERED');
      const entry = JSON.parse(bytes.toString('utf8'));
      if (!validEntry(entry) || entry.applicationId !== applicationId) throw new DeletionLogUnavailable('TAMPERED');
      entries.push({ ...entry, sha256 });
    }
    const covered = new Set(head.doc.entries.map((e) => entryKey(e.applicationId)));
    const pending = [];
    for (const key of entryKeys) {
      if (covered.has(key)) continue;
      const bytes = await store.get(key).catch((error) => {
        throw unavailable(error);
      });
      let entry;
      try {
        entry = JSON.parse(bytes.toString('utf8'));
      } catch {
        throw new DeletionLogUnavailable('ENTRY_INVALID');
      }
      if (!validEntry(entry) || key !== entryKey(entry.applicationId)) throw new DeletionLogUnavailable('ENTRY_INVALID');
      pending.push({ ...entry, sha256: sha256Hex(bytes) });
    }
    pending.sort((a, b) => a.loggedAt.localeCompare(b.loggedAt) || a.applicationId.localeCompare(b.applicationId));
    return { entries, pending, checkpoint: { count: head.doc.count, sha256: head.sha256 } };
  }

  /** Writes a NEW object; a lost acknowledgement is resolved by reading the key back. */
  async function putOnce(key, bytes) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let created;
      try {
        created = await store.putNew(key, bytes);
      } catch (error) {
        if (!(error instanceof BackupStoreError) || error.reason !== 'UNAVAILABLE') throw unavailable(error);
        created = null; // the answer was lost: the write may or may not have happened
      }
      if (created === true) return { existing: null };
      let existing;
      try {
        existing = await store.get(key);
      } catch (error) {
        if (error instanceof BackupStoreError && error.reason === 'NOT_FOUND' && created === null) continue; // it did not happen: write again
        throw unavailable(error);
      }
      return { existing };
    }
    throw new DeletionLogUnavailable('UNAVAILABLE');
  }

  return {
    kind: 'journal',
    /** Provisioning: checkpoint 0. Idempotent. */
    async init() {
      const genesis = encode({ schema: JOURNAL_CHECKPOINT_SCHEMA, count: 0, entries: [], prevCheckpointSha256: GENESIS, writtenAt: clock().toISOString() });
      const { existing } = await putOnce(checkpointKey(0), genesis);
      if (existing) {
        const cp = JSON.parse(existing.toString('utf8'));
        if (cp?.schema !== JOURNAL_CHECKPOINT_SCHEMA || cp.count !== 0 || cp.entries?.length !== 0) throw new DeletionLogUnavailable('TAMPERED');
      }
      return readVerified();
    },
    /** The entry for one Application, if the history holds one (verified history). */
    async find(applicationId) {
      const { entries, pending } = await readVerified();
      return [...entries, ...pending].find((e) => e.applicationId === applicationId) ?? null;
    },
    /**
     * Records one deletion DURABLY: the entry, then a checkpoint that covers it,
     * each read back and verified. Only then may anything be deleted.
     * @returns {{ entry, checkpoint: { count, sha256 } }}
     */
    async record({ applicationId, objectRef, authorisation }) {
      const entry = { schema: JOURNAL_ENTRY_SCHEMA, applicationId: String(applicationId), objectRef: objectRef ?? null, authorisation, reason: 'AUTHORISED_DELETION', loggedAt: clock().toISOString() };
      if (!validEntry(entry)) throw new TypeError('invalid deletion-journal entry');
      // Nothing is written into a journal that is not initialised or does not verify.
      try {
        await readVerified();
      } catch (error) {
        error.beforeWrite = true; // definitely nothing written
        throw error;
      }
      const { existing } = await putOnce(entryKey(entry.applicationId), encode(entry));
      if (existing) {
        let stored;
        try {
          stored = JSON.parse(existing.toString('utf8'));
        } catch {
          throw new DeletionLogUnavailable('TAMPERED');
        }
        // A retry of the SAME deletion is fine; a different one under this id is an incident.
        if (!validEntry(stored) || stored.objectRef !== entry.objectRef || stored.authorisation !== entry.authorisation) throw new DeletionLogUnavailable('CONFLICT');
      }
      return this.ensureCheckpointed(entry.applicationId);
    },
    /** Writes the next checkpoint(s) until one covers `applicationId`; verified by reading back. */
    async ensureCheckpointed(applicationId) {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const history = await readVerified();
        const covered = history.entries.find((e) => e.applicationId === applicationId);
        if (covered) return { entry: covered, checkpoint: history.checkpoint };
        if (!history.pending.some((e) => e.applicationId === applicationId)) throw new DeletionLogUnavailable('INCOMPLETE');
        const prevBytes = await store.get(checkpointKey(history.checkpoint.count));
        const prev = JSON.parse(prevBytes.toString('utf8'));
        const next = {
          schema: JOURNAL_CHECKPOINT_SCHEMA,
          count: prev.count + history.pending.length,
          entries: [...prev.entries, ...history.pending.map((e) => ({ applicationId: e.applicationId, sha256: e.sha256 }))],
          prevCheckpointSha256: history.checkpoint.sha256,
          writtenAt: clock().toISOString(),
        };
        // Checkpoints are contiguous: an extension by n entries also writes the n-1 intermediate ones.
        let chainPrev = history.checkpoint.sha256;
        let raced = false;
        for (let k = prev.count + 1; k <= next.count; k += 1) {
          const doc = { ...next, count: k, entries: next.entries.slice(0, k), prevCheckpointSha256: chainPrev };
          const bytes = encode(doc);
          const { existing } = await putOnce(checkpointKey(k), bytes);
          if (existing && sha256Hex(existing) !== sha256Hex(bytes)) {
            raced = true; // another deletion wrote checkpoint k first: re-read and extend that
            break;
          }
          chainPrev = sha256Hex(existing ?? bytes);
        }
        if (raced) continue;
      }
      const history = await readVerified();
      const covered = history.entries.find((e) => e.applicationId === applicationId);
      if (covered) return { entry: covered, checkpoint: history.checkpoint };
      throw new DeletionLogUnavailable('CONTENDED');
    },
    /** The verified history, for the restore gate. */
    readHistory: readVerified,
    /** The whole journal as one JSON document (for an offline copy beside the owner's anchor). */
    async export() {
      const history = await readVerified();
      const keys = [...(await store.list(CHECKPOINTS)), ...(await store.list(ENTRIES))];
      const objects = [];
      for (const key of keys) objects.push({ key, bytes: (await store.get(key)).toString('base64') });
      return { exported: { schema: 'valida.deletion-journal.export.v1', objects }, checkpoint: history.checkpoint };
    },
  };
}
