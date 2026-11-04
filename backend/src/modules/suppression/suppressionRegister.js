import mongoose from 'mongoose';
import { RecipientSuppression, RecipientSuppressionKey } from '../../models/RecipientSuppression.js';
import { DatabaseUnavailableError, runBounded } from '../jobs/job.repository.js';

/**
 * The recipient-suppression register's DATABASE BOUNDARY (design rev 8 §3.1,
 * §3.2, §4.4, §4.5.1; OD-2026-11-04-02).
 *
 * READS (send path and operator command): bounded by `timeoutMs` and sent to
 * the server as maxTimeMS, from the primary (the default read preference): a
 * suppression applies to every lookup that starts after its add was
 * acknowledged by a majority (§3.5).
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
  const bounded = (model, operation) => runBounded(model, operation, timeoutMs);

  /** Coverage inputs (§4.4, §4.5.1): the key ids that hold ACTIVE entries, and every key document. */
  function readCoverageInputs() {
    return Promise.all([
      bounded(Suppression, () => Suppression.distinct('lookup.keyId', { state: { $eq: 'ACTIVE' }, scope: { $eq: SUPPRESSION_SCOPE } }).maxTimeMS(timeoutMs)),
      bounded(Keys, () => Keys.find({}, { _id: 1, check: 1, state: 1 }).limit(COVERAGE_READ_LIMIT + 1).maxTimeMS(timeoutMs).lean()),
    ]).then(([activeKeyIds, keyDocuments]) => ({
      activeKeyIds: activeKeyIds.slice(0, COVERAGE_READ_LIMIT + 1),
      keyDocuments: keyDocuments.slice(0, COVERAGE_READ_LIMIT),
      limitReached: activeKeyIds.length > COVERAGE_READ_LIMIT || keyDocuments.length > COVERAGE_READ_LIMIT,
    }));
  }

  /** An ACTIVE entry matching any of the `(keyId, digest)` pairs, or null. */
  function findActiveMatch(pairs) {
    if (pairs.length === 0) return Promise.resolve(null);
    return bounded(Suppression, () =>
      Suppression.findOne(
        {
          state: { $eq: 'ACTIVE' },
          scope: { $eq: SUPPRESSION_SCOPE },
          $or: pairs.map(({ keyId, digest }) => ({ 'lookup.keyId': { $eq: keyId }, 'lookup.digest': { $eq: digest } })),
        },
        { _id: 1 },
      )
        .maxTimeMS(timeoutMs)
        .lean(),
    );
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
     * The send-path read (§3.2 steps 1 and 3): coverage inputs and the lookup
     * for `pairs`, issued together and bounded by ONE time limit. Rejects
     * (DatabaseUnavailableError) when anything could not be read in time.
     */
    async readForAcknowledgement({ pairs }) {
      const [coverage, match] = await Promise.all([readCoverageInputs(), findActiveMatch(pairs)]);
      return { ...coverage, match };
    },

    readCoverageInputs,

    /** Per-key counts for `coverage` (read-only): ACTIVE entries and how many still list a source. */
    activeCountsByKey() {
      return bounded(Suppression, () =>
        Suppression.aggregate([
          { $match: { state: 'ACTIVE', scope: SUPPRESSION_SCOPE } },
          { $group: { _id: '$lookup.keyId', active: { $sum: 1 }, listingSource: { $sum: { $cond: [{ $gt: [{ $size: '$sources' }, 0] }, 1, 0] } } } },
          { $sort: { _id: 1 } },
          { $limit: COVERAGE_READ_LIMIT },
        ]).option({ maxTimeMS: timeoutMs }),
      );
    },

    /** Loads documents for an operator action (full documents: they may be saved). */
    findEntries(filter, { limit = 500, sort = { _id: 1 } } = {}) {
      return bounded(Suppression, () => Suppression.find(filter).sort(sort).limit(limit).maxTimeMS(timeoutMs));
    },
    findEntry(filter) {
      return bounded(Suppression, () => Suppression.findOne(filter).maxTimeMS(timeoutMs));
    },
    countEntries(filter) {
      return bounded(Suppression, () => Suppression.countDocuments(filter).maxTimeMS(timeoutMs));
    },
    findKeyDocument(keyId) {
      return bounded(Keys, () => Keys.findOne({ _id: { $eq: keyId } }).maxTimeMS(timeoutMs));
    },
    listKeyDocuments() {
      return bounded(Keys, () => Keys.find({}).sort({ _id: 1 }).limit(COVERAGE_READ_LIMIT).maxTimeMS(timeoutMs).lean());
    },
    /** The register's indexes as MongoDB reports them (fail closed when the unique one is missing). */
    async listIndexes() {
      try {
        return await bounded(Suppression, () => Suppression.collection.listIndexes().toArray());
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
