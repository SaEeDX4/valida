/**
 * Proposed (MongoDB-native r2, finding 1) — positive identification of the
 * authorised, disposable restore target, BEFORE the first write.
 *
 * The restore gate writes (it re-applies deletions). It may only ever write to
 * a temporary cluster restored from a snapshot, which the owner has marked as
 * authorised. Every check below is a READ; a refusal means zero writes,
 * whatever the source of the deletion history (journal store or offline export).
 *
 * Required configuration (refused when incomplete):
 *   RECOVERY_RESTORE_TARGET_ID    the id the owner generated for THIS restore and
 *                                 wrote into the target (owner record)
 *   RECOVERY_LIVE_REPLICA_SET     the live cluster's replica-set name (not secret)
 *   the target URI names its database explicitly
 *
 * Checks, in order:
 *   1. URI_OVERLAP        the target URI's hosts and database differ from every
 *                         live URI given (the API's, the operator's)
 *   2. TARGET_NOT_REPLICA_SET / TARGET_IS_LIVE
 *                         the target answers `hello` as a replica set whose name is
 *                         NOT the live one
 *   3. LIVE_IDENTITY_MISMATCH
 *                         when the live cluster is reachable: its `hello` names the
 *                         configured live set (an alias of live is refused by 2: the
 *                         server itself reports its set name, whatever host name is used)
 *   4. NOT_AUTHORISED / AMBIGUOUS / TARGET_ID_MISMATCH / AUTHORISATION_FOR_OTHER_TARGET / EXPIRED
 *                         the target database holds EXACTLY ONE restore_authorization
 *                         document, written by the owner after the restore, naming this
 *                         target id, this replica set and this database, not expired
 *   5. WRITER_NOT_SCOPED  the connected user's privileges are confined to that one
 *                         database and to the actions of the authorised mode (snapshot:
 *                         find, remove, listIndexes; load: + insert, createIndex); a broader
 *                         user (readWrite, root, any other database or the cluster) is
 *                         refused even on the right target. AUTHORISATION_FOR_OTHER_MODE
 *                         when the owner authorised the other mode
 *   6. TARGET_NOT_EMPTY   (load) every data collection is empty before the first insert
 */
export const RESTORE_AUTHORIZATION_COLLECTION = 'restore_authorization';
const TARGET_ID = /^[A-Za-z0-9_-]{16,64}$/;
const SET_NAME = /^[A-Za-z0-9._-]{1,128}$/;
/** The data collections a recovery copy restores (D-MN-2) and the restore gate checks. */
export const RECOVERY_COLLECTIONS = Object.freeze(['applications', 'resume_files', 'jobs', 'recipient_suppressions', 'recipient_suppression_keys']);
/**
 * Two restore modes, each with its own writer role and its own owner authorisation:
 *   snapshot  the target was restored from an Atlas snapshot; the writer only re-applies deletions
 *   load      (r3, D-MN-2) the target is EMPTY; the loader inserts a decrypted recovery copy, creates the
 *             indexes, then re-applies deletions. The target must be empty before the first write.
 */
const MODES = Object.freeze({
  snapshot: {
    allowed: new Set(['find', 'remove', 'listIndexes']),
    required: [['applications', 'remove'], ['resume_files', 'remove'], [RESTORE_AUTHORIZATION_COLLECTION, 'find']],
  },
  load: {
    allowed: new Set(['find', 'insert', 'remove', 'listIndexes', 'createIndex']),
    required: [
      ['applications', 'insert'], ['applications', 'remove'], ['resume_files', 'insert'], ['resume_files', 'remove'],
      ['jobs', 'insert'], ['recipient_suppressions', 'insert'], ['recipient_suppression_keys', 'insert'], [RESTORE_AUTHORIZATION_COLLECTION, 'find'],
    ],
  },
});

/** Host list + database name of a URI, or null when it names no database. */
export function uriIdentity(uri) {
  const match = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)\/([^?]*)/.exec(uri ?? '');
  if (!match || !match[2]) return null;
  return { hosts: match[1].toLowerCase().split(','), database: decodeURIComponent(match[2]) };
}

const refuse = (reason, detail = null) => ({ ok: false, reason, ...(detail ? { detail } : {}) });

export async function identifyRestoreTarget({ targetClient, targetUri, liveUris = [], liveClient = null, env = process.env, now = new Date(), mode = 'snapshot' }) {
  const rules = MODES[mode];
  if (!rules) throw new TypeError('unknown restore mode');
  const targetId = env.RECOVERY_RESTORE_TARGET_ID;
  const liveSet = env.RECOVERY_LIVE_REPLICA_SET;
  if (!TARGET_ID.test(targetId ?? '')) return refuse('CONFIG_INCOMPLETE', 'RECOVERY_RESTORE_TARGET_ID');
  if (!SET_NAME.test(liveSet ?? '')) return refuse('CONFIG_INCOMPLETE', 'RECOVERY_LIVE_REPLICA_SET');
  const target = uriIdentity(targetUri);
  if (!target) return refuse('CONFIG_INCOMPLETE', 'RECOVERY_RESTORED_MONGODB_URI names no database');

  // 1. Not the live database by its address.
  for (const uri of liveUris.filter(Boolean)) {
    const live = uriIdentity(uri);
    if (!live) continue;
    if (live.hosts.some((h) => target.hosts.includes(h))) return refuse('URI_OVERLAP');
  }

  // 2. The target's own identity.
  let hello;
  try {
    hello = await targetClient.db('admin').command({ hello: 1 });
  } catch {
    return refuse('TARGET_UNREACHABLE');
  }
  if (!hello.setName) return refuse('TARGET_NOT_REPLICA_SET');
  if (hello.setName === liveSet) return refuse('TARGET_IS_LIVE');

  // 3. Not the live cluster under another name.
  if (liveClient) {
    let liveHello;
    try {
      liveHello = await liveClient.db('admin').command({ hello: 1 });
    } catch {
      return refuse('LIVE_UNREACHABLE');
    }
    // The live URI really reaches the configured live set (a mistyped name or a live URI that points at the
    // target would otherwise weaken step 2). An alias of the live cluster — any other host name for the same
    // servers — is already refused by step 2: `hello` is answered by the server itself, so every alias
    // reports the live replica-set name.
    if (liveHello.setName !== liveSet) return refuse('LIVE_IDENTITY_MISMATCH');
  }

  // 4. The owner's authorisation, in the target itself.
  const db = targetClient.db(target.database);
  let marks;
  try {
    marks = await db.collection(RESTORE_AUTHORIZATION_COLLECTION).find({}, { limit: 2 }).toArray();
  } catch {
    return refuse('NOT_AUTHORISED');
  }
  if (marks.length === 0) return refuse('NOT_AUTHORISED');
  if (marks.length > 1) return refuse('AMBIGUOUS');
  const mark = marks[0];
  if (mark.targetId !== targetId) return refuse('TARGET_ID_MISMATCH');
  if (mark.setName !== hello.setName || mark.database !== target.database) return refuse('AUTHORISATION_FOR_OTHER_TARGET');
  if (!(mark.expiresAt instanceof Date) || mark.expiresAt.getTime() <= now.getTime()) return refuse('EXPIRED');
  if ((mark.mode ?? 'snapshot') !== mode) return refuse('AUTHORISATION_FOR_OTHER_MODE');

  // 5. A writer scoped to exactly this database and these actions.
  let status;
  try {
    status = await db.command({ connectionStatus: 1, showPrivileges: true });
  } catch {
    return refuse('WRITER_NOT_SCOPED');
  }
  const users = status.authInfo?.authenticatedUsers ?? [];
  const privileges = status.authInfo?.authenticatedUserPrivileges ?? [];
  if (users.length !== 1) return refuse('WRITER_NOT_SCOPED');
  for (const p of privileges) {
    const r = p.resource ?? {};
    if (r.cluster || r.anyResource || r.db !== target.database || !r.collection) return refuse('WRITER_NOT_SCOPED');
    if (p.actions.some((a) => !rules.allowed.has(a))) return refuse('WRITER_NOT_SCOPED');
  }
  for (const [collection, action] of rules.required) {
    if (!privileges.some((p) => p.resource?.collection === collection && p.actions.includes(action))) return refuse('WRITER_NOT_SCOPED');
  }

  // 6. (load) The target holds nothing to overwrite or mix with: every data collection is empty.
  if (mode === 'load') {
    for (const name of RECOVERY_COLLECTIONS) {
      if ((await db.collection(name).countDocuments({}, { limit: 1 })) > 0) return refuse('TARGET_NOT_EMPTY');
    }
  }
  return { ok: true, identity: { setName: hello.setName, database: target.database, targetId, mode } };
}
