import mongoose from 'mongoose';
import { performance } from 'node:perf_hooks';
import { PRUNE_SEQUENCE_COLLECTION, PRUNE_SEQUENCE_ID, RecipientSuppression, RecipientSuppressionKey } from '../../models/RecipientSuppression.js';
import { DatabaseUnavailableError, runBounded } from '../jobs/job.repository.js';

/**
 * The recipient-suppression register's DATABASE BOUNDARY (design rev 8 §3.1,
 * §3.2, §4.4, §4.5.1; OD-2026-11-04-02).
 *
 * READS (send path and operator command): bounded by `timeoutMs` and sent to
 * the server as maxTimeMS, and ALWAYS from the primary (§3.5): a suppression
 * applies to every lookup that starts after its add was acknowledged by a
 * majority. B7 r5: every read sets readPreference `primary` EXPLICITLY, so a
 * connection-level preference (for example `readPreference=secondaryPreferred`
 * in MONGODB_URI, which configuration accepts) never reaches them. Without a
 * reachable primary a read fails, and the send path fails closed
 * (SUPPRESSION_CHECK_UNAVAILABLE); no secondary is ever asked.
 *
 * CONSISTENCY (rev 8.3, B7 r4 review; design §9.6) — no clock is involved.
 * Coverage and the match are separate reads and may observe the register at
 * different moments. Both read the `lookups` array, so ONE key change between
 * them is harmless: a move only ADDS a lookup (the old one stays as an alias)
 * and a prune only removes an alias (never the primary), so the two observed
 * lookup sets of an entry always share a key. A suppressed address can be
 * missed only if a move AND a prune of the same entry both become visible
 * between the two reads. The prune is conditional on the entry's version,
 * which includes the move, so its operator read the entry after the move was
 * visible — after this check began — and only then allocated its prune
 * sequence from a counter. That value is therefore above every stamp this
 * check saw at its start. So the send path reads the highest prune stamp
 * BEFORE and AFTER its coverage and match reads, and the gate never PROCEEDS
 * when they differ (`registerChanged`; SUPPRESSION_CHECK_UNAVAILABLE, a
 * TRANSIENT outcome the normal retry re-checks). Operator clocks, the age of
 * an alias and when a delayed write becomes visible do not matter (SUP-24,
 * SUP-24b). Adds and lifts never change the stamp, so the §3.5 add-versus-send
 * boundary is unchanged (SUP-12). Works on a standalone server and a replica set.
 *
 * WRITES (operator command only): one document per write, a validated save,
 * conditional on the loaded `version` (optimistic concurrency) and durable —
 * `w: majority, j: true` with `wtimeout` — exactly the Application policy.
 * A write whose outcome cannot be established (timeout, network, write
 * concern error) is reported UNKNOWN: it may have applied, so the command
 * stops and the operator re-runs it (every subcommand is idempotent).
 */

export const SUPPRESSION_SCOPE = 'APPLICATION_ACKNOWLEDGEMENT';
export const SUPPRESSION_WRITE_CONCERN = Object.freeze({ w: 'majority', j: true });
/** Upper bound on key ids / key documents one coverage read accepts; more is treated as incomplete. */
export const COVERAGE_READ_LIMIT = 1_000;
/** The one read preference of every register read (B7 r5; design §3.5). */
export const SUPPRESSION_READ_PREFERENCE = 'primary';
const PRIMARY = SUPPRESSION_READ_PREFERENCE;

/** A write that did not apply because the document changed since it was read. */
export class SuppressionWriteConflict extends Error {
  constructor(kind) {
    super(`suppression write conflict: ${kind}`);
    this.name = 'SuppressionWriteConflict';
    this.kind = kind; // 'VERSION' | 'DUPLICATE_KEY'
  }
}

/** A write whose outcome is unknown (it may have applied). */
export class SuppressionWriteUnknown extends Error {
  constructor(reason) {
    super(`suppression write outcome unknown: ${reason}`);
    this.name = 'SuppressionWriteUnknown';
    this.reason = reason;
  }
}

const isDuplicateKey = (error) => error?.code === 11000 || error?.cause?.code === 11000;

/**
 * @param {{ timeoutMs?: number, writeTimeoutMs?: number, models?: { RecipientSuppression?: import('mongoose').Model, RecipientSuppressionKey?: import('mongoose').Model } }} [options]
 */
export function createSuppressionRegister({ timeoutMs = 2_000, writeTimeoutMs = 5_000, models = {} } = {}) {
  const Suppression = models.RecipientSuppression ?? RecipientSuppression;
  const Keys = models.RecipientSuppressionKey ?? RecipientSuppressionKey;
  const bounded = (model, operation, ms = timeoutMs) => runBounded(model, operation, ms);

  /** Coverage inputs (§4.4, §4.5.1): every key id an ACTIVE entry can be matched under (primary or alias), and every key document. */
  function readCoverageInputs(ms = timeoutMs) {
    return Promise.all([
      bounded(Suppression, () => Suppression.distinct('lookups.keyId', { state: { $eq: 'ACTIVE' }, scope: { $eq: SUPPRESSION_SCOPE } }).read(PRIMARY).maxTimeMS(ms), ms),
      bounded(Keys, () => Keys.find({}, { _id: 1, check: 1, state: 1 }).limit(COVERAGE_READ_LIMIT + 1).read(PRIMARY).maxTimeMS(ms).lean(), ms),
    ]).then(([activeKeyIds, keyDocuments]) => ({
      activeKeyIds: activeKeyIds.slice(0, COVERAGE_READ_LIMIT + 1),
      keyDocuments: keyDocuments.slice(0, COVERAGE_READ_LIMIT),
      limitReached: activeKeyIds.length > COVERAGE_READ_LIMIT || keyDocuments.length > COVERAGE_READ_LIMIT,
    }));
  }

  /**
   * An ACTIVE entry matching any of the `(keyId, digest)` pairs, or null —
   * through `lookups` only (primary and aliases), one index point lookup per pair.
   */
  function findActiveMatch(pairs, ms = timeoutMs) {
    if (pairs.length === 0) return Promise.resolve(null);
    return bounded(
      Suppression,
      () =>
        Suppression.findOne(
          {
            state: { $eq: 'ACTIVE' },
            scope: { $eq: SUPPRESSION_SCOPE },
            $or: pairs.map(({ keyId, digest }) => ({ lookups: { $elemMatch: { keyId: { $eq: keyId }, digest: { $eq: digest } } } })),
          },
          { _id: 1 },
        )
          .read(PRIMARY)
          .maxTimeMS(ms)
          .lean(),
      ms,
    );
  }

  /** Rev 8.3 — the highest prune stamp in the register (0 when none): one index point read. */
  function highestPruneSeq(ms = timeoutMs) {
    return bounded(Suppression, () => Suppression.findOne({}, { _id: 0, pruneSeq: 1 }).sort({ pruneSeq: -1 }).read(PRIMARY).maxTimeMS(ms).lean(), ms).then((document) =>
      Number.isSafeInteger(document?.pruneSeq) ? document.pruneSeq : 0,
    );
  }

  /**
   * Rev 8.3 — allocates the next prune sequence (operator command only). It is
   * called AFTER the entry to be pruned was read, so the value exceeds every
   * stamp visible before that read. The counter is first raised above the
   * highest stored stamp, so a lost or restored counter document can never hand
   * out a value at or below one already in use. Durable (w: majority, j: true);
   * an unknown outcome stops the command (a skipped value is harmless).
   */
  async function allocatePruneSeq() {
    const highest = await highestPruneSeq();
    const native = Suppression.db?.db;
    if (Suppression.db?.readyState !== 1 || !native) throw new SuppressionWriteUnknown('disconnected');
    let allocated;
    try {
      allocated = await runBounded(
        Suppression,
        () =>
          native.collection(PRUNE_SEQUENCE_COLLECTION).findOneAndUpdate(
            { _id: { $eq: PRUNE_SEQUENCE_ID } },
            [{ $set: { value: { $add: [{ $max: [{ $ifNull: ['$value', 0] }, highest] }, 1] } } }],
            { upsert: true, returnDocument: 'after', maxTimeMS: writeTimeoutMs, writeConcern: { ...SUPPRESSION_WRITE_CONCERN, wtimeout: writeTimeoutMs } },
          ),
        writeTimeoutMs + 1_000,
      );
    } catch (error) {
      throw new SuppressionWriteUnknown(error instanceof DatabaseUnavailableError ? error.reason ?? 'unavailable' : 'sequence_failed');
    }
    if (!Number.isSafeInteger(allocated?.value) || allocated.value <= highest) throw new SuppressionWriteUnknown('sequence_invalid');
    return allocated.value;
  }

  /** One durable, conditional save. */
  async function save(document) {
    if (document.constructor?.db?.readyState !== 1) throw new SuppressionWriteUnknown('disconnected');
    let timer;
    const expired = new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new SuppressionWriteUnknown('timeout')), writeTimeoutMs + 1_000);
    });
    try {
      await Promise.race([document.save({ writeConcern: { ...SUPPRESSION_WRITE_CONCERN, wtimeout: writeTimeoutMs } }), expired]);
    } catch (error) {
      if (error instanceof SuppressionWriteUnknown || error instanceof mongoose.Error.ValidationError) throw error;
      if (error instanceof mongoose.Error.VersionError || error instanceof mongoose.Error.DocumentNotFoundError) throw new SuppressionWriteConflict('VERSION');
      if (isDuplicateKey(error)) throw new SuppressionWriteConflict('DUPLICATE_KEY');
      throw new SuppressionWriteUnknown('write_failed');
    } finally {
      clearTimeout(timer);
    }
  }

  /** Deletes one document only if it still has the loaded version (forget, privacy request). */
  async function removeIfUnchanged(document) {
    const model = document.constructor;
    try {
      const result = await runBounded(
        model,
        () => model.deleteOne({ _id: { $eq: document._id }, version: { $eq: document.version } }, { writeConcern: { ...SUPPRESSION_WRITE_CONCERN, wtimeout: writeTimeoutMs } }),
        writeTimeoutMs + 1_000,
      );
      if (result?.acknowledged !== true) throw new SuppressionWriteUnknown('unacknowledged');
      if (result.deletedCount !== 1) throw new SuppressionWriteConflict('VERSION');
    } catch (error) {
      if (error instanceof SuppressionWriteConflict || error instanceof SuppressionWriteUnknown) throw error;
      throw new SuppressionWriteUnknown(error instanceof DatabaseUnavailableError ? error.reason ?? 'unavailable' : 'write_failed');
    }
  }

  return Object.freeze({
    timeoutMs,
    models: Object.freeze({ RecipientSuppression: Suppression, RecipientSuppressionKey: Keys }),

    /**
     * The send-path read (§3.2 steps 1 and 3; rev 8.3 §9.6), bounded by ONE
     * time limit (`timeoutMs`) for all phases together:
     *   1. the highest prune stamp;
     *   2. coverage inputs and the lookup for `pairs`, issued together;
     *   3. the highest prune stamp again.
     * `registerChanged` is true when the two stamps differ: an alias prune
     * became visible during the check, so its coverage and match may not
     * describe one register state, and the gate must not PROCEED. Rejects
     * (DatabaseUnavailableError) when anything could not be read in time.
     */
    async readForAcknowledgement({ pairs }) {
      const deadline = performance.now() + timeoutMs;
      const left = () => {
        const ms = Math.floor(deadline - performance.now());
        if (ms < 1) throw new DatabaseUnavailableError('timeout');
        return ms;
      };
      const before = await highestPruneSeq(left());
      const [coverage, match] = await Promise.all([readCoverageInputs(left()), findActiveMatch(pairs, left())]);
      const after = await highestPruneSeq(left());
      return { ...coverage, match, pruneSeq: { before, after }, registerChanged: before !== after };
    },

    readCoverageInputs,
    findActiveMatch,
    highestPruneSeq,
    allocatePruneSeq,

    /**
     * Per-key counts for `coverage` (read-only): ACTIVE entries whose PRIMARY
     * lookup is under the key, how many of them still list a source, and ACTIVE
     * entries that still hold an ALIAS under it (rev 8.2).
     */
    activeCountsByKey() {
      return bounded(Suppression, () =>
        Suppression.aggregate([
          { $match: { state: 'ACTIVE', scope: SUPPRESSION_SCOPE } },
          { $unwind: '$lookups' },
          {
            $group: {
              _id: '$lookups.keyId',
              active: { $sum: { $cond: [{ $eq: ['$lookups.retiredAt', null] }, 1, 0] } },
              listingSource: { $sum: { $cond: [{ $and: [{ $eq: ['$lookups.retiredAt', null] }, { $gt: [{ $size: '$sources' }, 0] }] }, 1, 0] } },
              aliases: { $sum: { $cond: [{ $eq: ['$lookups.retiredAt', null] }, 0, 1] } },
            },
          },
          { $sort: { _id: 1 } },
          { $limit: COVERAGE_READ_LIMIT },
        ])
          .read(PRIMARY)
          .option({ maxTimeMS: timeoutMs }),
      );
    },

    /** Loads documents for an operator action (full documents: they may be saved). */
    findEntries(filter, { limit = 500, sort = { _id: 1 } } = {}) {
      return bounded(Suppression, () => Suppression.find(filter).sort(sort).limit(limit).read(PRIMARY).maxTimeMS(timeoutMs));
    },
    findEntry(filter) {
      return bounded(Suppression, () => Suppression.findOne(filter).read(PRIMARY).maxTimeMS(timeoutMs));
    },
    countEntries(filter) {
      return bounded(Suppression, () => Suppression.countDocuments(filter).read(PRIMARY).maxTimeMS(timeoutMs));
    },
    findKeyDocument(keyId) {
      return bounded(Keys, () => Keys.findOne({ _id: { $eq: keyId } }).read(PRIMARY).maxTimeMS(timeoutMs));
    },
    listKeyDocuments() {
      return bounded(Keys, () => Keys.find({}).sort({ _id: 1 }).limit(COVERAGE_READ_LIMIT).read(PRIMARY).maxTimeMS(timeoutMs).lean());
    },
    /** The register's indexes as MongoDB reports them (fail closed when the unique one is missing). */
    async listIndexes() {
      try {
        return await bounded(Suppression, () => Suppression.collection.listIndexes({ readPreference: PRIMARY }).toArray());
      } catch (error) {
        // A collection that does not exist yet has no indexes.
        if (error?.codeName === 'NamespaceNotFound' || error?.code === 26) return [];
        throw error;
      }
    },
    newEntry: (fields) => new Suppression(fields),
    newKeyDocument: (fields) => new Keys(fields),
    save,
    removeIfUnchanged,
  });
}
