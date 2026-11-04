import mongoose from 'mongoose';
import { Application } from '../../models/Application.js';
import { UnsupportedWriteError } from '../../models/writeGuards.js';
import { REQUIRED_INDEXES, diffIndexes } from '../../db/indexes.js';
import { DatabaseUnavailableError, runBounded } from '../jobs/job.repository.js';

/**
 * Application persistence for the Apply workflow — Milestone B5.
 *
 * Governed by 09_BACKEND_API_SPEC.md sections 77-80, 116-122 and 138,
 * 10_DATA_MODEL.md sections 111-116, 131-132, 207-209 and 217 (DATA-035,
 * DATA-066).
 *
 * WRITES go through the APPROVED B2 PATH ONLY: a fully validated document
 * save (models/writeGuards.js). This module never uses a query update,
 * insertMany, bulkWrite or the raw driver.
 *
 * Every operation is bounded in time (MONGODB_QUERY_TIMEOUT_MS). For a READ, a
 * failure or a timeout simply means "unavailable" (DatabaseUnavailableError).
 * For the INSERT it does not: a write that was abandoned, or whose
 * connection broke after it was sent, may still have been applied. insert()
 * therefore reports one of five outcomes, and the caller (the submission
 * service) handles each differently:
 *
 *   CREATED              the Application is persisted.
 *   DUPLICATE_KEY_HASH   the unique idempotency index refused it: another
 *                        request with the same key won the race. Ours is NOT
 *                        persisted; its stored resume is referenced by nothing.
 *   DUPLICATE_OTHER      a unique index other than the key hash refused it
 *                        (the storage-key index, or one this code cannot
 *                        identify). Not persisted, but the stored object may
 *                        be referenced by ANOTHER Application — never delete.
 *   NOT_PERSISTED        PROVEN not written — and only then: the connection
 *                        was down so nothing was sent (Mongoose would otherwise
 *                        buffer the command and maybe run it later), or the
 *                        error carries the server's NoWritesPerformed label
 *                        (when the driver retried, the error it finally throws
 *                        carries that label only if every attempt reported
 *                        that no write was performed).
 *   AMBIGUOUS            EVERYTHING ELSE that is not a duplicate key: the
 *                        bound expired while the save was in flight (it may
 *                        still complete — `settled` reports how it ends), the
 *                        network failed after the command was sent, a
 *                        write-concern error, an UNACKNOWLEDGED result (r2),
 *                        no server could be selected, the
 *                        server answered with an error, or an error this code
 *                        does not recognise. A server error or a failed server
 *                        selection is NOT proof that nothing was written: with
 *                        retryable writes (the default on a replica set) the
 *                        driver retries a failed insert once and, when the
 *                        retry fails too, reports the RETRY's error
 *                        (node_modules/mongodb/lib/operations/
 *                        execute_operation.js) — while the first attempt may
 *                        already have been applied. Never treated as success OR
 *                        failure without further evidence.
 *   (INVALID)            a programming error PROVEN to occur before anything
 *                        is sent (schema validation, a forbidden write path):
 *                        rethrown as is, after the caller's compensation — a
 *                        500, never a dependency outage.
 */

/** Fields read to answer an idempotent replay, resolve an ambiguous insert or compare a fingerprint. */
export const REPLAY_PROJECTION = Object.freeze({
  _id: 1,
  jobId: 1,
  status: 1,
  'jobSnapshot.title': 1,
  'jobSnapshot.slug': 1,
  submittedAt: 1,
  'idempotency.requestFingerprintHash': 1,
  'screeningAnswers.questionId': 1,
  'screeningAnswers.typeSnapshot': 1,
  'resume.storageKey': 1,
});

/** The two unique Application indexes idempotency and storage integrity depend on (Doc 10 sections 131-132). */
export const UNIQUE_APPLICATION_INDEXES = Object.freeze(
  REQUIRED_INDEXES.filter((index) => index.collection === 'applications' && index.options?.unique === true),
);

/** The unique index whose violation means "another request with this Idempotency-Key won". */
const KEY_HASH_FIELD = 'idempotency.keyHash';
const KEY_HASH_INDEX = UNIQUE_APPLICATION_INDEXES.find((index) => KEY_HASH_FIELD in index.key)?.name;

/**
 * The Application WRITE-DURABILITY POLICY — B5 r2 (r1 review finding 1).
 *
 * Candidate success requires the Application "persisted successfully in
 * MongoDB" (Doc 09 section 117; APP-005, BE-034). A resolved save is only that
 * when the write was acknowledged durably, so every Application write is sent
 * with this explicit write concern:
 *
 *   w: 'majority'  acknowledged once a majority of the replica set has it (on
 *                  a single server, that server) — not rolled back by a
 *                  failover;
 *   j: true        written to the on-disk journal before it is acknowledged;
 *   wtimeout       MONGODB_QUERY_TIMEOUT_MS, added per call: a write the server
 *                  cannot confirm in time is answered with a write-concern
 *                  error, which is AMBIGUOUS (it may have been applied) —
 *                  never "not persisted".
 *
 * The concern is set on the operation itself, and the driver uses an
 * operation's write concern INSTEAD of the connection default whenever one is
 * given (node_modules/mongodb/lib/utils.js, resolveOptions), so an unsafe
 * MONGODB_URI or client default (w=0, journal=false) cannot weaken an
 * Application write. (If the URI sets timeoutMS — client-side operation
 * timeouts — the driver drops `wtimeout` and that timeout bounds the write
 * instead.) On a host without journaling `j: true` is refused by the server:
 * every insert is then an unknown outcome and answered 503 — fail closed. And the acknowledgement is VERIFIED, not assumed: the
 * insert counts as CREATED only when the driver's result says
 * `acknowledged: true` (Mongoose reports that result with the document's
 * 'save' event); anything else is AMBIGUOUS / UNACKNOWLEDGED — an
 * unacknowledged write may still land, so it is never "not persisted" either.
 */
export const APPLICATION_WRITE_CONCERN = Object.freeze({ w: 'majority', j: true });

/** The policy for one write, bounded by the operation timeout. */
export const applicationWriteConcern = (timeoutMs) => ({ ...APPLICATION_WRITE_CONCERN, wtimeout: timeoutMs });

/** A save that resolved without an acknowledged driver result (r1 finding 1). */
export class UnacknowledgedWriteError extends Error {
  constructor() {
    super('The Application insert was not acknowledged by the server.');
    this.name = 'UnacknowledgedWriteError';
  }
}

/** Raised when the unique Application indexes are not in place: Applications are refused (fail closed). */
export class ApplicationIndexesMissingError extends Error {
  constructor() {
    super('The required unique Application indexes are not in place.');
    this.name = 'ApplicationIndexesMissingError';
    this.reason = 'APPLICATION_INDEXES_MISSING';
  }
}

/** Is this a duplicate-key refusal by the idempotency index? keyPattern first; the index name as a fallback. */
function isKeyHashDuplicate(error) {
  if (error?.keyPattern && typeof error.keyPattern === 'object') return KEY_HASH_FIELD in error.keyPattern;
  const text = typeof error?.message === 'string' ? error.message : '';
  return text.includes(KEY_HASH_FIELD) || (KEY_HASH_INDEX !== undefined && text.includes(KEY_HASH_INDEX));
}

/** Does the error carry the server's NoWritesPerformed label (no attempt performed a write)? */
function noWritesPerformed(error) {
  try {
    return typeof error?.hasErrorLabel === 'function' && error.hasErrorLabel('NoWritesPerformed') === true;
  } catch {
    return false;
  }
}

/**
 * Classifies a failed save. Only fixed tokens leave this function: the
 * error's text is used solely to recognise the duplicate-key index.
 *
 * A failure is NOT_PERSISTED only when that is proven (see the module
 * comment); anything unproven is AMBIGUOUS, so its stored object is never
 * removed on a guess.
 *
 * @returns {{ kind: 'DUPLICATE_KEY_HASH' | 'DUPLICATE_OTHER' | 'NOT_PERSISTED' | 'AMBIGUOUS' | 'INVALID', reason: string }}
 */
export function classifyWriteFailure(error) {
  const { mongo } = mongoose;
  // Raised by the validated save BEFORE any command is built or sent.
  if (error instanceof mongoose.Error.ValidationError) return { kind: 'INVALID', reason: 'VALIDATION' };
  if (error instanceof UnsupportedWriteError) return { kind: 'INVALID', reason: 'UNSUPPORTED_WRITE_PATH' };
  // Resolved, but not acknowledged: it may still have been applied.
  if (error instanceof UnacknowledgedWriteError) return { kind: 'AMBIGUOUS', reason: 'UNACKNOWLEDGED' };
  if (error instanceof mongo.MongoServerError && error.code === 11000) {
    // A unique index refused the document: it was not inserted.
    return isKeyHashDuplicate(error)
      ? { kind: 'DUPLICATE_KEY_HASH', reason: 'DUPLICATE_KEY_HASH' }
      : { kind: 'DUPLICATE_OTHER', reason: 'DUPLICATE_OTHER_INDEX' };
  }
  if (noWritesPerformed(error)) return { kind: 'NOT_PERSISTED', reason: 'NO_WRITES_PERFORMED' };
  if (error instanceof mongo.MongoWriteConcernError) return { kind: 'AMBIGUOUS', reason: 'WRITE_CONCERN' };
  if (error instanceof mongo.MongoServerError) return { kind: 'AMBIGUOUS', reason: 'SERVER_ERROR' };
  if (error instanceof mongo.MongoServerSelectionError || error?.name === 'MongooseServerSelectionError') {
    return { kind: 'AMBIGUOUS', reason: 'SERVER_SELECTION' };
  }
  if (error instanceof mongo.MongoNetworkError) return { kind: 'AMBIGUOUS', reason: 'NETWORK' };
  if (error instanceof mongo.MongoError || error instanceof mongoose.Error) return { kind: 'AMBIGUOUS', reason: 'DRIVER_ERROR' };
  return { kind: 'AMBIGUOUS', reason: 'UNEXPECTED' };
}

/**
 * @param {object} [options]
 * @param {import('mongoose').Model} [options.model] the Application model (tests may pass a stand-in)
 * @param {number} [options.timeoutMs] bound per operation (MONGODB_QUERY_TIMEOUT_MS)
 */
export function createApplicationRepository({ model = Application, timeoutMs = 5_000 } = {}) {
  let indexesVerified = false;

  /*
   * B6 r3 — CLAIM OWNERSHIP. The attempts THIS repository instance acquired,
   * keyed by the document the claim was made through (never exported, never
   * persisted). An entry is created only after the claim's conditional save
   * was acknowledged and matched; it names the exact channels, their attempt
   * numbers and the claim time. recordNotificationOutcomes requires it, so a
   * lost, failed or unconfirmed claim can never record an outcome — even
   * though its local copy may carry an attempt number that the WINNER's
   * stored state matches (the r2 defect). Uniqueness across processes needs
   * no extra state: MongoDB lets only one conditional claim of attempt n
   * match, so at most one process anywhere holds an entry for it.
   */
  const heldClaims = new WeakMap();
  /*
   * A document is used for at most ONE claim. After any claim through it —
   * won, lost, failed or unconfirmed — its local channel state may no longer
   * be what was read, and a second claim conditioned on that state could
   * match someone else's attempt in progress. Load a fresh document instead.
   */
  const claimedThrough = new WeakSet();
  const NOTIFICATION_CHANNEL_NAMES = ['internal', 'candidateAcknowledgement'];

  /**
   * A validated save of an existing Application, conditional on `where`
   * (doc.$where), under the write-durability policy and the time bound.
   * true = applied; false = the condition no longer matched (LOST).
   * Rejects with DatabaseUnavailableError when the outcome is unknown or the
   * database is unavailable — the caller then sends nothing.
   */
  async function conditionalSave(document, where) {
    if (model.db?.readyState !== 1) throw new DatabaseUnavailableError('disconnected');
    // Mongoose reports the number of documents the update matched with the
    // document's 'save' event (emitted before save() resolves). As for the
    // insert (B5 r2), success is claimed only for an ACKNOWLEDGED write that
    // matched the document; a mismatch is DocumentNotFoundError (LOST).
    let matched;
    const onSaved = (_document, numAffected) => {
      matched = numAffected;
    };
    document.$once('save', onSaved);
    document.$where = where;
    const saving = document.save({ writeConcern: applicationWriteConcern(timeoutMs) });
    const settled = saving.then(
      () => {
        if (!(typeof matched === 'number' && matched >= 1)) throw new UnacknowledgedWriteError();
        return true;
      },
      (error) => {
        if (error instanceof mongoose.Error.DocumentNotFoundError) return false;
        throw error;
      },
    );
    // Reset only once the save has settled: it reads $where when it builds its filter.
    settled.catch(() => {}).finally(() => {
      document.$where = null;
      document.removeListener('save', onSaved);
    });
    let timer;
    const expired = new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new DatabaseUnavailableError('timeout')), timeoutMs);
    });
    try {
      return await Promise.race([settled, expired]);
    } catch (error) {
      if (error instanceof DatabaseUnavailableError || error instanceof mongoose.Error.ValidationError) throw error;
      // Anything else (a server or network failure): the write may or may not have applied.
      throw new DatabaseUnavailableError('write_failed');
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    /**
     * The Application created with this idempotency-key hash, if any
     * (REPLAY_PROJECTION). The hash is bound with $eq.
     *
     * `majority: true` reads with read concern "majority": used to resolve an
     * AMBIGUOUS insert, so that success is only ever claimed for a record
     * acknowledged by a majority — on a replica set, a write visible only on
     * the primary could still be rolled back after a failover. (On a single
     * server "majority" is that server.)
     *
     * @param {string} keyHash
     * @param {{ majority?: boolean }} [options]
     * @returns {Promise<object | null>}
     */
    findByKeyHash(keyHash, { majority = false } = {}) {
      if (typeof keyHash !== 'string') return Promise.reject(new TypeError('keyHash must be a string'));
      return runBounded(
        model,
        () => {
          const query = model.findOne({ 'idempotency.keyHash': { $eq: keyHash } }, REPLAY_PROJECTION).maxTimeMS(timeoutMs);
          if (majority) query.readConcern('majority');
          return query.lean();
        },
        timeoutMs,
      );
    },

    /**
     * DATA-066 / Doc 10 section 217: required uniqueness is enforced by MongoDB
     * indexes, not application checks alone. Without the unique key-hash index,
     * two concurrent requests with one Idempotency-Key could both be persisted;
     * without the storage-key index, two Applications could claim one object.
     * So before an Application is accepted, the indexes must be verified to
     * exist (`npm run db:indexes:apply` creates them). Fail closed: 503 until
     * they are. A successful check is remembered for the life of the process.
     */
    async assertUniqueIndexes() {
      if (indexesVerified) return;
      const indexes = await runBounded(
        model,
        async () => {
          try {
            return await model.collection.listIndexes().toArray();
          } catch (error) {
            // The collection does not exist yet: no indexes.
            if (error?.code === 26 || error?.codeName === 'NamespaceNotFound') return [];
            throw error;
          }
        },
        timeoutMs,
      );
      const { missing, incompatible } = diffIndexes(UNIQUE_APPLICATION_INDEXES, { applications: indexes });
      if (missing.length > 0 || incompatible.length > 0) throw new ApplicationIndexesMissingError();
      indexesVerified = true;
    },

    /**
     * Persists a new Application document through the validated save (B2),
     * under the write-durability policy above.
     *
     * @param {import('mongoose').Document} document from buildApplication()
     * @returns {Promise<{ kind: 'CREATED' }
     *   | { kind: 'DUPLICATE_KEY_HASH' | 'DUPLICATE_OTHER' | 'NOT_PERSISTED', reason: string }
     *   | { kind: 'AMBIGUOUS', reason: string, settled: Promise<string> | null, error?: unknown }
     *   | { kind: 'INVALID', reason: string, error: unknown }>}
     *   `settled` (AMBIGUOUS after a timeout only) resolves with the eventual
     *   kind of the abandoned save — 'CREATED' or a failure kind. `error` is
     *   for the caller's SAFE summary (lib/safeError.js) only.
     */
    async insert(document) {
      // Checked first: while disconnected Mongoose would BUFFER the command and
      // possibly run it later — an outcome nobody could account for.
      if (model.db?.readyState !== 1) return { kind: 'NOT_PERSISTED', reason: 'DISCONNECTED' };

      // The driver's insert result, as Mongoose reports it with the document's
      // 'save' event (emitted before save() resolves).
      let insertResult;
      const onSaved = (_document, result) => {
        insertResult = result;
      };
      document.$once('save', onSaved);
      const saving = document
        .save({ writeConcern: applicationWriteConcern(timeoutMs) })
        .then(() => {
          if (insertResult?.acknowledged !== true) throw new UnacknowledgedWriteError();
          return 'CREATED';
        })
        .finally(() => document.removeListener('save', onSaved));
      const settled = saving.then(
        () => 'CREATED',
        (error) => classifyWriteFailure(error).kind,
      );
      let timer;
      const expired = new Promise((resolve) => {
        timer = setTimeout(() => resolve('TIMEOUT'), timeoutMs);
      });
      try {
        const result = await Promise.race([saving, expired]);
        if (result === 'TIMEOUT') return { kind: 'AMBIGUOUS', reason: 'TIMEOUT', settled };
        return { kind: 'CREATED' };
      } catch (error) {
        const classified = classifyWriteFailure(error);
        if (classified.kind === 'AMBIGUOUS') return { ...classified, settled: null, error };
        if (classified.kind === 'INVALID') return { ...classified, error };
        return classified;
      } finally {
        clearTimeout(timer);
      }
    },

    /**
     * Is any Application referencing this storage key? Used before deleting an
     * object whose duplicate-key refusal could not be attributed to an index
     * (some MongoDB-compatible servers do not report which index refused).
     *
     * @returns {Promise<boolean>}
     */
    async isStorageKeyReferenced(storageKey) {
      if (typeof storageKey !== 'string') throw new TypeError('storageKey must be a string');
      const found = await runBounded(
        model,
        () => model.findOne({ 'resume.storageKey': { $eq: storageKey } }, { _id: 1 }).maxTimeMS(timeoutMs).lean(),
        timeoutMs,
      );
      return found !== null;
    },

    /** A fresh, updatable copy of one Application (for recording notification state). */
    loadForUpdate(id) {
      return runBounded(model, () => model.findOne({ _id: { $eq: id } }).maxTimeMS(timeoutMs), timeoutMs);
    },

    /*
     * NOTIFICATION STATE — Milestone B6 (Doc 10 sections 117-122; Doc 09
     * sections 131-134; Doc 14 sections 120-121).
     *
     * Every change goes through the validated document save (B2) under the
     * write-durability policy, and is CONDITIONAL: Mongoose's documented
     * `doc.$where` adds the expected current state to the update's filter, so
     * the write applies only if nobody changed that state in between. A
     * mismatch is Mongoose's DocumentNotFoundError (no document matched) and is
     * reported as LOST — never retried blindly. No schema, enum or index
     * changes: the canonical channel fields carry everything.
     *
     *   claim  (before a send)  PENDING|FAILED, attemptCount n, code c
     *                           -> PENDING, attemptCount n+1, lastAttemptAt now,
     *                              lastErrorCode ATTEMPT_IN_PROGRESS
     *   record (after a send)   attemptCount n+1, ATTEMPT_IN_PROGRESS
     *                           -> SENT (sentAt) | FAILED (safe code)
     *
     * So an attempt is recorded BEFORE anything is sent, two processes can
     * never send the same attempt (only one claim matches), and an attempt
     * that was interrupted after its claim stays visible as
     * ATTEMPT_IN_PROGRESS — an uncertain outcome, never re-sent automatically.
     * Only the claimant that ACQUIRED an attempt can record its outcome
     * (heldClaims, r3).
     */

    /**
     * Claims the next attempt of each channel. Mutates `document`. Only a
     * CLAIMED result (an acknowledged save that matched) makes the caller the
     * owner of those attempts — see heldClaims. A document can be used for
     * one claim only: a second claim through it is LOST, nothing is written;
     * so is a claim of a channel that is not PENDING or FAILED in the copy.
     * (The record filter needs no claim time: every claim increments the
     * attempt number under the conditional save, so attempt n of a channel
     * is acquired at most once.)
     *
     * @param {import('mongoose').Document} document a freshly loaded Application
     * @param {Array<'internal' | 'candidateAcknowledgement'>} channels
     * @param {{ now: Date }} options
     * @returns {Promise<'CLAIMED' | 'LOST'>} rejects with DatabaseUnavailableError if the outcome is unknown
     */
    async claimNotificationAttempts(document, channels, { now }) {
      if (
        !Array.isArray(channels) ||
        channels.length === 0 ||
        new Set(channels).size !== channels.length ||
        !channels.every((channel) => NOTIFICATION_CHANNEL_NAMES.includes(channel))
      ) {
        throw new TypeError('claimNotificationAttempts: channels must be distinct notification channels');
      }
      if (claimedThrough.has(document)) return 'LOST';
      // Only a PENDING or FAILED channel has an attempt to claim; nothing is written otherwise.
      if (!channels.every((channel) => ['PENDING', 'FAILED'].includes(document.notifications?.[channel]?.status))) return 'LOST';
      claimedThrough.add(document);

      const where = {};
      const attempts = {};
      for (const channel of channels) {
        const state = document.notifications[channel];
        where[`notifications.${channel}.status`] = state.status;
        where[`notifications.${channel}.attemptCount`] = state.attemptCount;
        where[`notifications.${channel}.lastErrorCode`] = state.lastErrorCode ?? null;
        state.status = 'PENDING';
        state.attemptCount = state.attemptCount + 1;
        state.lastAttemptAt = now;
        state.lastErrorCode = 'ATTEMPT_IN_PROGRESS';
        // B7: a status code belongs to the attempt that produced it.
        state.lastStatusCode = null;
        attempts[channel] = state.attemptCount;
      }
      // Rejects (no ownership) when the outcome is unknown or the database failed.
      if (!(await conditionalSave(document, where))) return 'LOST';
      heldClaims.set(document, Object.freeze({ attempts: Object.freeze(attempts), claimedAt: now }));
      return 'CLAIMED';
    },

    /**
     * Records the outcome of each claimed attempt. Mutates `document`.
     *
     * AUTHORIZED ONLY BY A HELD CLAIM (r3): `document` must be the document a
     * CLAIMED claim was made through, and `outcomes` must name exactly the
     * channels it acquired. Otherwise — a lost, failed or unconfirmed claim,
     * another channel, or a claim already used — the answer is LOST and
     * NOTHING is written. The write targets the acquired attempt numbers and
     * time (not whatever the copy holds now) and is still conditional on that
     * attempt being in progress, so it cannot overwrite a newer attempt. A
     * claim authorizes one record.
     *
     * @param {import('mongoose').Document} document the document the claim was made on
     * @param {Record<string, { status: 'SENT', sentAt: Date } | { status: 'FAILED', errorCode: string }>} outcomes
     * @returns {Promise<'RECORDED' | 'LOST'>}
     */
    async recordNotificationOutcomes(document, outcomes) {
      const claim = heldClaims.get(document);
      const channels = Object.keys(outcomes ?? {});
      const claimed = claim ? Object.keys(claim.attempts) : [];
      if (!claim || channels.length === 0 || channels.length !== claimed.length || !channels.every((channel) => claimed.includes(channel))) {
        return 'LOST';
      }
      heldClaims.delete(document);

      const where = {};
      for (const [channel, outcome] of Object.entries(outcomes)) {
        const state = document.notifications[channel];
        where[`notifications.${channel}.attemptCount`] = claim.attempts[channel];
        where[`notifications.${channel}.lastErrorCode`] = 'ATTEMPT_IN_PROGRESS';
        // The acquired attempt is what gets recorded.
        state.attemptCount = claim.attempts[channel];
        state.lastAttemptAt = claim.claimedAt;
        if (outcome.status === 'SENT') {
          state.status = 'SENT';
          state.sentAt = outcome.sentAt;
          state.lastErrorCode = null;
          state.lastStatusCode = null;
        } else {
          state.status = 'FAILED';
          state.lastErrorCode = outcome.errorCode;
          // B7: the relay's enhanced status, validated again by the schema.
          state.lastStatusCode = outcome.statusCode ?? null;
        }
      }
      return (await conditionalSave(document, where)) ? 'RECORDED' : 'LOST';
    },

    /**
     * The retry command's scan (Doc 09 section 134): Applications matching
     * `filter` — built by notificationDueFilter
     * (application.notifications.js) from notification-state paths and
     * submittedAt only — oldest first, bounded by `limit` and maxTimeMS. Lean
     * rows with the notification state only: no candidate data. No index
     * covers this filter (Doc 10 defines none for it).
     *
     * @param {{ limit: number, filter: { $or: object[] } }} options
     */
    findNotificationCandidates({ limit, filter }) {
      if (!filter || !Array.isArray(filter.$or) || Object.keys(filter).length !== 1) {
        return Promise.reject(new TypeError('findNotificationCandidates: filter must be a single $or of channel clauses'));
      }
      return runBounded(
        model,
        () =>
          model
            .find(filter, { _id: 1, submittedAt: 1, notifications: 1 })
            .sort({ submittedAt: 1, _id: 1 })
            .limit(limit)
            .maxTimeMS(timeoutMs)
            .lean(),
        timeoutMs,
      );
    },

    /**
     * Counts of every notification state, per channel, for the retry report:
     * what is sent, pending, failed and how (status + fixed code). Read-only
     * aggregation, bounded by maxTimeMS.
     *
     * `exhausted` counts the channels still PENDING / FAILED that reached
     * `maxAttempts` (the retry command no longer attempts them).
     *
     * @param {{ maxAttempts: number }} options
     * @returns {Promise<Record<string, { states: Array<{ status: string, code: string | null, count: number }>, exhausted: number }>>}
     */
    async summarizeNotificationStates({ maxAttempts }) {
      const summary = {};
      for (const channel of ['internal', 'candidateAcknowledgement']) {
        const rows = await runBounded(
          model,
          () =>
            model
              .aggregate([
                { $group: { _id: { status: `$notifications.${channel}.status`, code: `$notifications.${channel}.lastErrorCode` }, count: { $sum: 1 } } },
              ])
              .option({ maxTimeMS: timeoutMs }),
          timeoutMs,
        );
        const exhausted = await runBounded(
          model,
          () =>
            model
              .countDocuments({
                [`notifications.${channel}.status`]: { $in: ['PENDING', 'FAILED'] },
                [`notifications.${channel}.attemptCount`]: { $gte: maxAttempts },
              })
              .maxTimeMS(timeoutMs),
          timeoutMs,
        );
        summary[channel] = {
          states: rows
            .map((row) => ({ status: row._id?.status ?? null, code: row._id?.code ?? null, count: row.count }))
            .sort((a, b) => `${a.status}/${a.code}`.localeCompare(`${b.status}/${b.code}`)),
          exhausted,
        };
      }
      return summary;
    },
  });
}
