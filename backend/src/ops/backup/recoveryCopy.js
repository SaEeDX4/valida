import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, constants, privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { REQUIRED_INDEXES } from '../../db/indexes.js';
import { BackupStoreError, getObject, putNewObject } from './backupStore.js';
import { DeletionLogUnavailable } from './deletionLog.js';
import { identifyRestoreTarget, RECOVERY_COLLECTIONS } from './restoreTarget.js';
import { freshnessRefused, replayAndVerify } from './mongoRestore.js';

/**
 * Proposed (MongoDB-native r3, owner decision D-MN-2) — the INDEPENDENT,
 * ENCRYPTED recovery copy of the applicant data, outside Atlas.
 *
 * Recovery point. Every data collection is read inside ONE snapshot session
 * (readConcern "snapshot"): all collections as they stood at a single cluster
 * time T. A submission or deletion that commits after T is not in the copy
 * (a submission after T is lost — that is the RPO); a deletion after T is in
 * the deletion journal and is re-applied on restore.
 *
 * Encryption. A fresh 256-bit data key per copy; the plaintext (every
 * document as BSON, framed with its collection name) is encrypted with
 * AES-256-GCM in 1 MiB chunks. Each chunk's nonce is the copy's random prefix
 * + the chunk index; its additional data binds the manifest core, the index
 * and a final-chunk flag, so a reordered, dropped, truncated or extended
 * payload fails authentication. The data key is wrapped (RSA-OAEP-SHA256) for
 * AT LEAST TWO recipients — the owner's key and a sealed recovery key — so the
 * loss of one private key does not lose the backups. The dumping job holds
 * only PUBLIC keys; it cannot read any copy, including its own.
 *
 * Objects (S3 API; a compliance-locked bucket of its own in production, with
 * retention and expiry stated in the decision sheet):
 *   encrypted-backups/<namespace>/<backupId>/payload.bin
 *   encrypted-backups/<namespace>/<backupId>/manifest.json  (written LAST: its presence = complete copy)
 * The manifest names the payload's size and SHA-256. The manifest's own
 * SHA-256 is NOT inside it (no self-reference): it is printed by the dump and
 * recorded by the owner; a restore requires it.
 */
export const RECOVERY_COPY_SCHEMA = 'valida.recovery-copy.v1';
const PREFIX = 'encrypted-backups/';
const CHUNK = 1024 * 1024;
const NAMESPACE = /^[a-z0-9-]{1,32}$/;
const BACKUP_ID = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;

export class RecoveryCopyError extends Error {
  constructor(reason) {
    super(`recovery copy: ${reason}`);
    this.name = 'RecoveryCopyError';
    this.reason = reason;
  }
}

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const keyIdOf = (publicKey) => sha256((publicKey?.type === 'public' ? publicKey : createPublicKey(publicKey)).export({ type: 'spki', format: 'der' }));
const canonical = (value) => Buffer.from(JSON.stringify(value), 'utf8');
const keysFor = (namespace, backupId) => ({ payload: `${PREFIX}${namespace}/${backupId}/payload.bin`, manifest: `${PREFIX}${namespace}/${backupId}/manifest.json` });
const nonceOf = (prefix, index) => Buffer.concat([prefix, Buffer.from([index >>> 24, (index >>> 16) & 255, (index >>> 8) & 255, index & 255])]);
const aadOf = (coreDigest, index, final) => Buffer.concat([coreDigest, nonceOf(Buffer.alloc(0), index), Buffer.from([final ? 1 : 0])]);

/** The S3 store over the accepted backupStore operations (writer or reader credential). */
export function s3RecoveryStore(endpoint) {
  return {
    get: async (key) => (await getObject(endpoint, key)).bytes,
    putNew: async (key, bytes, contentType) => (await putNewObject(endpoint, key, bytes, { contentType, metadata: { sha256: sha256(bytes) } })).created,
  };
}

/**
 * Reads every data collection at ONE cluster time and returns the framed plaintext.
 * `hooks.betweenCollections(name)` exists for the concurrency test only.
 */
export async function readAtRecoveryPoint(db, client, { hooks = {} } = {}) {
  const session = client.startSession({ snapshot: true });
  try {
    const parts = [];
    const collections = {};
    for (const name of RECOVERY_COLLECTIONS) {
      const records = [];
      for await (const doc of db.collection(name).find({}, { session, sort: { _id: 1 } })) records.push(mongoose.mongo.BSON.serialize({ c: name, d: doc }));
      const bytes = Buffer.concat(records);
      collections[name] = { count: records.length, plaintextSha256: sha256(bytes) };
      parts.push(bytes);
      if (hooks.betweenCollections) await hooks.betweenCollections(name);
    }
    // Consistency AT the recovery point (both collections from the same snapshot): every Application's
    // recorded résumé version is in the copy; résumés without an Application are counted (interrupted
    // submissions, B5) and left for the restore gate's orphan report.
    const fileKeys = new Set();
    const apps = [];
    for (let at = 0; at < parts[1].length;) {
      const size = parts[1].readInt32LE(at);
      fileKeys.add(mongoose.mongo.BSON.deserialize(parts[1].subarray(at, at + size)).d._id);
      at += size;
    }
    for (let at = 0; at < parts[0].length;) {
      const size = parts[0].readInt32LE(at);
      apps.push(mongoose.mongo.BSON.deserialize(parts[0].subarray(at, at + size)).d.resume?.storageKey);
      at += size;
    }
    const referenced = new Set(apps);
    const consistency = { applicationsWithoutFile: apps.filter((k) => !fileKeys.has(k)).length, filesWithoutApplication: [...fileKeys].filter((k) => !referenced.has(k)).length };
    const t = session.snapshotTime;
    if (!t) throw new RecoveryCopyError('NO_SNAPSHOT_TIME');
    const recoveryPoint = { clusterTime: { t: t.high ?? t.t, i: t.low ?? t.i }, wallClock: new Date((t.high ?? t.t) * 1000).toISOString() };
    return { plaintext: Buffer.concat(parts), collections, recoveryPoint, consistency };
  } finally {
    await session.endSession();
  }
}

/** Encrypts the plaintext for the recipients; returns { manifest (object), payload (Buffer) }. */
export function sealRecoveryCopy({ plaintext, collections, recoveryPoint, consistency, recipients, namespace, backupId, createdAt }) {
  const ids = recipients.map((r) => keyIdOf(r));
  if (recipients.length < 2 || new Set(ids).size !== recipients.length) throw new RecoveryCopyError('TWO_DISTINCT_RECIPIENT_KEYS_REQUIRED');
  const dataKey = randomBytes(32);
  const noncePrefix = randomBytes(8);
  const chunks = Math.max(1, Math.ceil(plaintext.length / CHUNK));
  const core = {
    schema: RECOVERY_COPY_SCHEMA, namespace, backupId, createdAt, recoveryPoint, collections, consistency,
    cipher: { alg: 'AES-256-GCM', chunkSize: CHUNK, chunks, noncePrefix: noncePrefix.toString('hex'), plaintextSize: plaintext.length },
    recipients: recipients.map((publicKey, n) => ({
      keyId: ids[n], alg: 'RSA-OAEP-SHA256',
      wrappedKey: publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, dataKey).toString('base64'),
    })),
  };
  const coreDigest = createHash('sha256').update(canonical(core)).digest();
  const out = [];
  for (let index = 0; index < chunks; index += 1) {
    const final = index === chunks - 1;
    const cipher = createCipheriv('aes-256-gcm', dataKey, nonceOf(noncePrefix, index));
    cipher.setAAD(aadOf(coreDigest, index, final));
    const ct = Buffer.concat([cipher.update(plaintext.subarray(index * CHUNK, (index + 1) * CHUNK)), cipher.final()]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(ct.length);
    out.push(len, ct, cipher.getAuthTag());
  }
  dataKey.fill(0);
  const payload = Buffer.concat(out);
  const manifest = { ...core, payload: { sizeBytes: payload.length, sha256: sha256(payload) } };
  return { manifest, payload };
}

/** Verifies and decrypts; returns the documents per collection. Throws RecoveryCopyError(reason). Writes nothing. */
export function openRecoveryCopy({ manifestBytes, payloadBytes, expectedManifestSha256, privateKey, passphrase, now = new Date(), maxAgeDays = 35 }) {
  if (!/^[0-9a-f]{64}$/.test(expectedManifestSha256 ?? '')) throw new RecoveryCopyError('MANIFEST_DIGEST_REQUIRED');
  if (sha256(manifestBytes) !== expectedManifestSha256) throw new RecoveryCopyError('MANIFEST_UNVERIFIED');
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    throw new RecoveryCopyError('MANIFEST_INVALID');
  }
  const { payload: payloadMeta, ...core } = manifest;
  if (core.schema !== RECOVERY_COPY_SCHEMA || !core.cipher || !Array.isArray(core.recipients) || !payloadMeta) throw new RecoveryCopyError('MANIFEST_INVALID');
  const created = Date.parse(core.createdAt);
  if (Number.isNaN(created) || created > now.getTime() + 5 * 60_000) throw new RecoveryCopyError('MANIFEST_INVALID');
  if (now.getTime() - created > maxAgeDays * 86_400_000) throw new RecoveryCopyError('BACKUP_EXPIRED');
  if (!payloadBytes) throw new RecoveryCopyError('PAYLOAD_MISSING');
  if (payloadBytes.length !== payloadMeta.sizeBytes || sha256(payloadBytes) !== payloadMeta.sha256) throw new RecoveryCopyError('PAYLOAD_MISMATCH');

  let keyObject;
  try {
    keyObject = createPrivateKey({ key: privateKey, passphrase });
  } catch {
    throw new RecoveryCopyError('PRIVATE_KEY_UNUSABLE');
  }
  const myId = keyIdOf(createPublicKey(keyObject));
  const recipient = core.recipients.find((r) => r.keyId === myId);
  if (!recipient) throw new RecoveryCopyError('NO_MATCHING_KEY');
  let dataKey;
  try {
    dataKey = privateDecrypt({ key: keyObject, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(recipient.wrappedKey, 'base64'));
  } catch {
    throw new RecoveryCopyError('KEY_UNWRAP_FAILED');
  }
  const coreDigest = createHash('sha256').update(canonical(core)).digest();
  const noncePrefix = Buffer.from(core.cipher.noncePrefix, 'hex');
  const parts = [];
  let offset = 0;
  for (let index = 0; index < core.cipher.chunks; index += 1) {
    if (offset + 4 > payloadBytes.length) throw new RecoveryCopyError('PAYLOAD_TRUNCATED');
    const len = payloadBytes.readUInt32BE(offset);
    const end = offset + 4 + len + 16;
    if (end > payloadBytes.length) throw new RecoveryCopyError('PAYLOAD_TRUNCATED');
    const decipher = createDecipheriv('aes-256-gcm', dataKey, nonceOf(noncePrefix, index));
    decipher.setAAD(aadOf(coreDigest, index, index === core.cipher.chunks - 1));
    decipher.setAuthTag(payloadBytes.subarray(offset + 4 + len, end));
    try {
      parts.push(Buffer.concat([decipher.update(payloadBytes.subarray(offset + 4, offset + 4 + len)), decipher.final()]));
    } catch {
      throw new RecoveryCopyError('PAYLOAD_TAMPERED');
    }
    offset = end;
  }
  dataKey.fill(0);
  if (offset !== payloadBytes.length) throw new RecoveryCopyError('PAYLOAD_TAMPERED');
  const plaintext = Buffer.concat(parts);
  if (plaintext.length !== core.cipher.plaintextSize) throw new RecoveryCopyError('PAYLOAD_TAMPERED');

  const documents = Object.fromEntries(RECOVERY_COLLECTIONS.map((n) => [n, []]));
  const raw = Object.fromEntries(RECOVERY_COLLECTIONS.map((n) => [n, []]));
  for (let at = 0; at < plaintext.length;) {
    const size = plaintext.readInt32LE(at);
    const record = mongoose.mongo.BSON.deserialize(plaintext.subarray(at, at + size), { promoteBuffers: false });
    if (!RECOVERY_COLLECTIONS.includes(record.c)) throw new RecoveryCopyError('CONTENT_MISMATCH');
    documents[record.c].push(record.d);
    raw[record.c].push(plaintext.subarray(at, at + size));
    at += size;
  }
  for (const name of RECOVERY_COLLECTIONS) {
    const expected = core.collections?.[name];
    if (!expected || expected.count !== documents[name].length || expected.plaintextSha256 !== sha256(Buffer.concat(raw[name]))) throw new RecoveryCopyError('CONTENT_MISMATCH');
  }
  return { manifest, documents };
}

/** Dump: one snapshot read, sealed for the recipients, written (payload, then manifest) and read back. */
export async function createRecoveryCopy({ client, db, store, recipients, namespace = 'production', now = new Date(), hooks }) {
  if (!NAMESPACE.test(namespace)) throw new RecoveryCopyError('NAMESPACE_INVALID');
  const backupId = `${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}-${randomBytes(4).toString('hex')}`;
  const { plaintext, collections, recoveryPoint, consistency } = await readAtRecoveryPoint(db, client, { hooks });
  const { manifest, payload } = sealRecoveryCopy({ plaintext, collections, recoveryPoint, consistency, recipients, namespace, backupId, createdAt: now.toISOString() });
  plaintext.fill(0);
  const keys = keysFor(namespace, backupId);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`, 'utf8');
  for (const [key, bytes, type] of [[keys.payload, payload, 'application/octet-stream'], [keys.manifest, manifestBytes, 'application/json']]) {
    const created = await store.putNew(key, bytes, type).catch((error) => {
      throw new RecoveryCopyError(error instanceof BackupStoreError ? `STORE_${error.reason}` : 'STORE_UNAVAILABLE');
    });
    if (!created) throw new RecoveryCopyError('KEY_COLLISION');
    const back = await store.get(key);
    if (sha256(back) !== sha256(bytes)) throw new RecoveryCopyError('READ_BACK_MISMATCH');
  }
  return { backupId, namespace, recoveryPoint, consistency, collections: Object.fromEntries(Object.entries(collections).map(([k, v]) => [k, v.count])), payloadBytes: payload.length, manifestSha256: sha256(manifestBytes) };
}

/**
 * Restore to an EMPTY, positively identified target (mode 'load'), then deletion replay.
 * Nothing is written unless the target, the deletion history AND the recovery material all verify.
 */
export async function restoreRecoveryCopy({ targetClient, targetUri, liveUris = [], liveClient = null, env = process.env, store, namespace = 'production', backupId, expectedManifestSha256, privateKey, passphrase, history, anchor = null, freshness = { established: false, basis: 'UNSPECIFIED' }, now = new Date(), maxAgeDays = 35 }) {
  const report = { backupId, recoveryPoint: null, target: null, history: null, loaded: null, applied: { applications: 0, files: 0, alreadyAbsent: 0 }, checked: 0, missing: [], mismatched: [], orphans: 0, verdict: null, reasons: [] };
  const target = await identifyRestoreTarget({ targetClient, targetUri, liveUris, liveClient, env, now, mode: 'load' });
  if (!target.ok) {
    report.verdict = 'RECOVERY REFUSED';
    report.reasons.push(`TARGET_${target.reason}`);
    return report;
  }
  report.target = target.identity;
  let entries;
  try {
    const verified = await history.readHistory({ anchor });
    entries = [...verified.entries, ...verified.pending];
    report.history = { checkpointed: verified.entries.length, pending: verified.pending.length, checkpoint: verified.checkpoint, anchorChecked: Boolean(anchor) };
  } catch (error) {
    report.verdict = 'RECOVERY FAILED';
    report.reasons.push(`DELETION_HISTORY_${error instanceof DeletionLogUnavailable ? error.reason : 'UNAVAILABLE'}`);
    return report;
  }
  if (freshnessRefused(freshness, report)) return report;
  let opened;
  try {
    if (!NAMESPACE.test(namespace) || !BACKUP_ID.test(backupId ?? '')) throw new RecoveryCopyError('BACKUP_ID_INVALID');
    const keys = keysFor(namespace, backupId);
    const fetch = async (key, missing) => {
      try {
        return await store.get(key);
      } catch (error) {
        if (error instanceof BackupStoreError && error.reason === 'NOT_FOUND') throw new RecoveryCopyError(missing);
        throw new RecoveryCopyError('STORE_UNAVAILABLE');
      }
    };
    const manifestBytes = await fetch(keys.manifest, 'MANIFEST_MISSING');
    const payloadBytes = await fetch(keys.payload, 'PAYLOAD_MISSING');
    opened = openRecoveryCopy({ manifestBytes, payloadBytes, expectedManifestSha256, privateKey, passphrase, now, maxAgeDays });
  } catch (error) {
    report.verdict = 'RECOVERY FAILED';
    report.reasons.push(`RECOVERY_MATERIAL_${error instanceof RecoveryCopyError ? error.reason : 'UNREADABLE'}`);
    return report;
  }
  report.recoveryPoint = opened.manifest.recoveryPoint;

  // Load (the only inserts), then the indexes, then the deletion replay and verification.
  const db = targetClient.db(target.identity.database);
  report.loaded = {};
  for (const name of RECOVERY_COLLECTIONS) {
    const docs = opened.documents[name];
    for (let i = 0; i < docs.length; i += 100) await db.collection(name).insertMany(docs.slice(i, i + 100), { ordered: true, writeConcern: { w: 'majority', j: true } });
    report.loaded[name] = docs.length;
  }
  for (const required of REQUIRED_INDEXES.filter((r) => RECOVERY_COLLECTIONS.includes(r.collection))) {
    await db.collection(required.collection).createIndex(required.key, { name: required.name, ...required.options });
  }
  await replayAndVerify(db, entries, report);
  return report;
}
