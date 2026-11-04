/**
 * B7 — orphan private-file reconciliation (Doc 15 sections 199-205,
 * OPS-065…067; Doc 17 sections 320-322; Doc 10 sections 207-209).
 *
 * A partial failure can leave a private object without a MongoDB reference
 * (Doc 15 section 199): a storage write whose Application was never persisted,
 * an object kept because its Application's outcome was unknown, or a
 * compensation delete that failed. This module finds such objects and, only
 * when the operator asks for it explicitly, deletes them.
 *
 * Rules:
 *   - DRY RUN by default (section 201): nothing is deleted or written.
 *   - Deletion needs an explicit mode AND a confirmation (section 203).
 *   - A conservative minimum age (section 204): an object younger than
 *     `minAgeMs` is never a deletion candidate, whatever the database says —
 *     it may belong to an Apply request still in flight. The age can be raised
 *     operationally but never set below MIN_AGE_FLOOR_MS.
 *   - In-flight safety beyond the age: immediately before each deletion the
 *     reference is checked AGAIN for that one key; an object referenced by
 *     then is kept.
 *   - Partial files (`.partial-…` leftovers of a failed write) are reported,
 *     never deleted here: their write may still be running, and they are not
 *     objects (the local adapter removes its own leftovers).
 *   - The report (section 202) names objects only by their one-way reference
 *     (storageObjectRef) — never the storage key, never a candidate filename —
 *     and gives counts, ages, the environment and a recommendation.
 *   - Every deletion is logged operationally (section 205) with the one-way
 *     reference and the outcome.
 */
import { storageObjectRef } from './storageContract.js';

const HOUR_MS = 60 * 60 * 1000;
/** Default minimum age before an unreferenced object may be deleted. */
export const DEFAULT_MIN_AGE_MS = 72 * HOUR_MS;
/** The age can be raised, never lowered below this. */
export const MIN_AGE_FLOOR_MS = 24 * HOUR_MS;

export const RECONCILE_MODES = Object.freeze({ DRY_RUN: 'DRY_RUN', DELETE: 'DELETE' });

export class ReconciliationRefused extends Error {
  constructor(reason) {
    super(`reconciliation refused: ${reason}`);
    this.name = 'ReconciliationRefused';
    this.reason = reason;
  }
}

/**
 * @param {object} options
 * @param {{ listPrivateObjects: Function, deletePrivateObject: Function }} options.storage
 * @param {(storageKeys: string[]) => Promise<Set<string>>} options.findReferencedKeys
 *   returns the subset of `storageKeys` referenced by an Application
 * @param {'DRY_RUN'|'DELETE'} [options.mode]
 * @param {boolean} [options.confirmed]  required, and true, for DELETE
 * @param {number} [options.minAgeMs]
 * @param {() => Date} [options.clock]
 * @param {object} [options.logger]
 */
export async function reconcileOrphanObjects({
  storage,
  findReferencedKeys,
  mode = RECONCILE_MODES.DRY_RUN,
  confirmed = false,
  minAgeMs = DEFAULT_MIN_AGE_MS,
  clock = () => new Date(),
  logger,
} = {}) {
  if (!Object.values(RECONCILE_MODES).includes(mode)) throw new ReconciliationRefused('UNKNOWN_MODE');
  if (!Number.isFinite(minAgeMs) || minAgeMs < MIN_AGE_FLOOR_MS) throw new ReconciliationRefused('MIN_AGE_BELOW_FLOOR');
  if (mode === RECONCILE_MODES.DELETE && confirmed !== true) throw new ReconciliationRefused('DELETE_NOT_CONFIRMED');

  const now = clock().getTime();
  const listing = await storage.listPrivateObjects();
  const keys = listing.objects.map((object) => object.storageKey);
  const referenced = keys.length === 0 ? new Set() : await findReferencedKeys(keys);

  const ageHours = (date) => Math.floor((now - date.getTime()) / HOUR_MS);
  const report = {
    mode,
    minAgeHours: minAgeMs / HOUR_MS,
    objects: listing.objects.length,
    referenced: 0,
    possibleOrphans: [],
    partials: listing.partials.map((partial) => ({ ref: storageObjectRef(partial.storageKey), ageHours: ageHours(partial.modifiedAt) })),
    unexpectedEntries: listing.unexpected,
    notConfinedEntries: listing.notConfined,
    deleted: 0,
    keptReferencedOnRecheck: 0,
    deleteFailures: 0,
  };

  for (const object of listing.objects) {
    if (referenced.has(object.storageKey)) {
      report.referenced += 1;
      continue;
    }
    const age = now - object.modifiedAt.getTime();
    const entry = {
      ref: storageObjectRef(object.storageKey),
      ageHours: ageHours(object.modifiedAt),
      sizeBytes: object.sizeBytes,
      eligible: age >= minAgeMs,
      action: age >= minAgeMs ? 'DELETE_CANDIDATE' : 'KEEP_TOO_RECENT',
    };
    report.possibleOrphans.push(entry);
    if (mode !== RECONCILE_MODES.DELETE || !entry.eligible) continue;

    // In-flight safety: the reference is checked again for this one key.
    const recheck = await findReferencedKeys([object.storageKey]);
    if (recheck.has(object.storageKey)) {
      entry.action = 'KEPT_REFERENCED_ON_RECHECK';
      report.keptReferencedOnRecheck += 1;
      logger?.warn({ event: 'storage_orphan_kept', objectRef: entry.ref, reason: 'REFERENCED_ON_RECHECK' }, 'object is referenced; kept');
      continue;
    }
    try {
      const outcome = await storage.deletePrivateObject(object.storageKey);
      entry.action = outcome.deleted ? 'DELETED' : 'ALREADY_GONE';
      if (outcome.deleted) report.deleted += 1;
      logger?.info({ event: 'storage_orphan_deleted', objectRef: entry.ref, ageHours: entry.ageHours, outcome: entry.action }, 'orphan object deleted');
    } catch (error) {
      entry.action = 'DELETE_FAILED';
      report.deleteFailures += 1;
      logger?.error({ event: 'storage_orphan_delete_failed', objectRef: entry.ref, reason: error?.reason ?? 'IO_ERROR' }, 'orphan object could not be deleted');
    }
  }

  const candidates = report.possibleOrphans.filter((entry) => entry.eligible).length;
  report.recommendation =
    mode === RECONCILE_MODES.DELETE
      ? report.deleteFailures > 0
        ? 'Some deletions failed: investigate before running again.'
        : 'Done.'
      : candidates === 0
        ? 'No action: no unreferenced object is older than the minimum age.'
        : `${candidates} unreferenced object(s) older than the minimum age: review, then run with --delete --confirm-delete.`;
  return report;
}

/**
 * The reference lookup against MongoDB: which of `storageKeys` an Application
 * references (`resume.storageKey`, unique index `resume_storageKey_unique`).
 * The keys come from the storage listing and match RESUME_STORAGE_KEY_PATTERN,
 * so they are plain strings in an `$in` — never operators.
 *
 * @param {{ Application: import('mongoose').Model, timeoutMs: number, batchSize?: number }} options
 */
export function createApplicationReferenceLookup({ Application, timeoutMs, batchSize = 500 }) {
  return async function findReferencedKeys(storageKeys) {
    const found = new Set();
    for (let start = 0; start < storageKeys.length; start += batchSize) {
      const batch = storageKeys.slice(start, start + batchSize);
      const documents = await Application.find({ 'resume.storageKey': { $in: batch } }, { 'resume.storageKey': 1, _id: 0 })
        .lean()
        .maxTimeMS(timeoutMs);
      for (const document of documents) found.add(document.resume.storageKey);
    }
    return found;
  };
}

/**
 * `npm run ops:storage:reconcile -- [--delete --confirm-delete] [--min-age-hours N]`
 *
 * @param {string[]} argv
 * @returns {{ help?: true, error?: string, options?: { mode: string, confirmed: boolean, minAgeMs: number } }}
 */
export function parseReconcileArgs(argv) {
  const options = { mode: RECONCILE_MODES.DRY_RUN, confirmed: false, minAgeMs: DEFAULT_MIN_AGE_MS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--delete') options.mode = RECONCILE_MODES.DELETE;
    else if (arg === '--confirm-delete') options.confirmed = true;
    else if (arg === '--min-age-hours') {
      const value = argv[index + 1];
      index += 1;
      if (value === undefined || !/^[0-9]{1,5}$/.test(value)) return { error: '--min-age-hours needs a whole number of hours' };
      options.minAgeMs = Number(value) * HOUR_MS;
      if (options.minAgeMs < MIN_AGE_FLOOR_MS) return { error: `--min-age-hours must be at least ${MIN_AGE_FLOOR_MS / HOUR_MS}` };
    } else return { error: `unknown argument: ${arg}` };
  }
  if (options.confirmed && options.mode !== RECONCILE_MODES.DELETE) return { error: '--confirm-delete is only valid with --delete' };
  if (options.mode === RECONCILE_MODES.DELETE && !options.confirmed) return { error: '--delete needs --confirm-delete as well' };
  return { options };
}
