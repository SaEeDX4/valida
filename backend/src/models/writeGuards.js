/**
 * Write-path restriction shared by the Job and Application models.
 *
 * THE ONLY SUPPORTED WRITE PATH is a fully validated document save:
 * `new Model(...).save()`, `Model.create(...)` or `doc.save()` on a loaded
 * document — normally through the Job and Application services. That is where
 * every rule lives: schema validation (enums, limits, patterns, min/max) and
 * the models' pre('validate') invariants (Job lifecycle and publish readiness,
 * slug and first-publication immutability, Application submission history).
 *
 * Every Mongoose operation that would write WITHOUT running those rules is
 * rejected before anything reaches the database:
 *
 *   - query updates and replacements — updateOne, updateMany,
 *     findOneAndUpdate (and findByIdAndUpdate), replaceOne,
 *     findOneAndReplace, and doc.updateOne(). Document hooks do not run for
 *     them, and update validators cannot enforce cross-field invariants and
 *     ignore operators such as $inc;
 *   - bulkWrite (and bulkSave, which uses it) — its update operations are not
 *     validated at all;
 *   - insertMany — its options can skip validation (`lean`), and the save
 *     hooks that close that gap do not run for it;
 *   - a save whose options could switch validation off, narrow it or skip part
 *     of the document. Mongoose decides by PROPERTY PRESENCE and then coerces
 *     the value (`'validateBeforeSave' in options` → `!!value`), so an
 *     explicitly present `validateBeforeSave: undefined` — or `0`, `''`,
 *     `null` — disables validation just as `false` does. The guard therefore
 *     uses presence too: if one of these options is present at all, it must
 *     hold exactly the full-validation value — `validateBeforeSave: true`,
 *     `validateModifiedOnly: false`, `timestamps: true` (Doc 10 section 12
 *     requires timestamps). `pathsToSave` is refused whenever it is present,
 *     whatever its value. Mongoose first copies the caller's options into its
 *     own SaveOptions object and both its validation decision and this guard
 *     read that same copy, so a getter or an inherited property cannot answer
 *     one way to Mongoose and another way here;
 *   - aggregation pipelines on these models containing a write stage
 *     ($out / $merge).
 *
 * Reads and deletes are unaffected. The raw driver (`Model.collection.*`)
 * bypasses Mongoose entirely and is not a supported write path.
 *
 * A later milestone that needs an atomic update (for example B6 recording a
 * notification attempt) must add a narrowly scoped, explicitly validated
 * helper here, reviewed on its own — not re-open general query updates.
 */

export const REJECTED_QUERY_WRITE_OPERATIONS = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
];

const WRITE_STAGES = ['$out', '$merge'];

/**
 * Save options that change what is validated or saved, and the only value each
 * may hold when present. `pathsToSave` has no acceptable value.
 */
const FULL_VALIDATION_SAVE_OPTIONS = [
  ['validateBeforeSave', true],
  ['validateModifiedOnly', false],
  ['timestamps', true],
  ['pathsToSave', undefined],
];

/** Presence-based, like Mongoose: `key in options` counts even when the value is undefined. */
function hasOnlyFullValidationOptions(options) {
  return FULL_VALIDATION_SAVE_OPTIONS.every(([key, required]) => {
    if (!(key in options)) return true;
    if (key === 'pathsToSave') return false;
    return options[key] === required;
  });
}

/** Raised when a write would bypass the validated document-save path. */
export class UnsupportedWriteError extends Error {
  constructor(model, operation) {
    super(
      `${model} is written only through a validated document save; ` +
        `${operation} is not a supported write path`,
    );
    this.name = 'UnsupportedWriteError';
    this.code = 'UNSUPPORTED_WRITE_PATH';
    this.model = model;
    this.operation = operation;
  }
}

/**
 * Installs the restriction on a schema.
 *
 * @param {mongoose.Schema} schema
 * @param {{ model: string }} options
 */
export function restrictToValidatedSaves(schema, { model }) {
  schema.pre(REJECTED_QUERY_WRITE_OPERATIONS, function rejectQueryWrite() {
    throw new UnsupportedWriteError(model, this.op);
  });

  schema.pre('bulkWrite', function rejectBulkWrite() {
    throw new UnsupportedWriteError(model, 'bulkWrite');
  });

  schema.pre('insertMany', function rejectInsertMany() {
    throw new UnsupportedWriteError(model, 'insertMany');
  });

  // Mongoose passes the save options to pre('save') middleware — after it has
  // already decided whether to validate. An option that is ABSENT keeps the
  // full default behaviour; a PRESENT one must be exactly the full-validation
  // value, or the save is refused before anything reaches the database.
  schema.pre('save', function requireFullValidation(options) {
    // Mongoose ignores a missing or non-object options value (full validation).
    if (options === null || typeof options !== 'object') return;
    if (!hasOnlyFullValidationOptions(options)) {
      throw new UnsupportedWriteError(model, 'save without full validation');
    }
  });

  schema.pre('aggregate', function rejectAggregateWrites() {
    const writes = this.pipeline().some((stage) => WRITE_STAGES.some((name) => name in stage));
    if (writes) throw new UnsupportedWriteError(model, 'aggregate with $out/$merge');
  });
}
