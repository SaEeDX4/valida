import mongoose from 'mongoose';

/**
 * B6 r3 — a stand-in for the FINAL collection adapter only.
 *
 * Everything above it is real: the Application model and its B2 validation
 * and write guards, Mongoose's document save (delta, `doc.$where`, write
 * concern, DocumentNotFoundError, the 'save' event), and the real
 * application repository. Only `Model.collection.updateOne` is replaced by an
 * in-memory store that applies one update ATOMICALLY (match and apply in one
 * synchronous step, as a MongoDB server does for a single document), after
 * yielding once so that concurrent saves really interleave.
 *
 * Not MongoDB evidence: it proves what the repository and Mongoose send and
 * how they react to the answers. The same races against a real MongoDB are in
 * tests/db/b6-notifications.test.js.
 *
 * Supported: equality filters on (dotted) paths, including `_id`; `$set`,
 * `$unset` and `$inc` updates. Anything else is a test defect and throws.
 */
const { BSON, MongoNetworkError } = mongoose.mongo;

const clone = (value) => BSON.deserialize(BSON.serialize(value), { promoteValues: true });
const valueAt = (object, path) => path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);
const same = (actual, expected) => {
  if (expected === null || expected === undefined) return actual === null || actual === undefined;
  if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
  if (expected?._bsontype === 'ObjectId' || expected?._bsontype === 'ObjectID') return actual?._bsontype !== undefined && String(actual) === String(expected);
  if (typeof expected === 'object') throw new Error(`fake collection: unsupported filter operand ${JSON.stringify(expected)}`);
  return actual === expected;
};
function setPath(object, path, value) {
  const keys = path.split('.');
  let target = object;
  for (const key of keys.slice(0, -1)) {
    if (target[key] === null || typeof target[key] !== 'object') target[key] = {};
    target = target[key];
  }
  target[keys.at(-1)] = value;
}
function unsetPath(object, path) {
  const keys = path.split('.');
  const parent = valueAt(object, keys.slice(0, -1).join('.')) ?? (keys.length === 1 ? object : undefined);
  if (parent && typeof parent === 'object') delete parent[keys.at(-1)];
}

/**
 * @returns the fake, with:
 *   seed(document)          stores a validated Application (its toObject()) and returns its id
 *   hydrate(id)             an independent Mongoose document of the stored record (Model.hydrate)
 *   stored(id)              a deep copy of the stored record
 *   updates                 every updateOne call received: { filter, update, options }
 *   script(...behaviours)   behaviour of the next calls, in order:
 *                           'apply' | 'fail-before' (nothing written, error) |
 *                           'fail-after' (written, then error) | 'hang-after' (written, never answers)
 *   install(Model)          replaces Model.collection.updateOne; returns a restore function
 */
export function fakeApplicationCollection(Model) {
  const records = new Map();
  const updates = [];
  const behaviours = [];

  async function updateOne(filter, update, options) {
    updates.push({ filter: clone(filter), update: clone(update), options });
    const behaviour = behaviours.shift() ?? 'apply';
    // Yield once: a concurrent save gets to send its own update meanwhile.
    await new Promise((resolve) => setImmediate(resolve));
    if (behaviour === 'fail-before') throw new MongoNetworkError('qa: connection reset before the write');

    // Match and apply atomically (one synchronous step).
    const record = records.get(String(filter._id));
    const matched = Boolean(record) && Object.entries(filter).every(([path, expected]) => same(valueAt(record, path), expected));
    if (matched) {
      for (const [operator, fields] of Object.entries(update)) {
        for (const [path, value] of Object.entries(fields)) {
          if (operator === '$set') setPath(record, path, clone({ v: value }).v);
          else if (operator === '$unset') unsetPath(record, path);
          else if (operator === '$inc') setPath(record, path, (valueAt(record, path) ?? 0) + value);
          else throw new Error(`fake collection: unsupported update operator ${operator}`);
        }
      }
    }
    if (behaviour === 'fail-after') throw new MongoNetworkError('qa: connection reset after the write');
    if (behaviour === 'hang-after') return new Promise(() => {});
    return { acknowledged: true, matchedCount: matched ? 1 : 0, modifiedCount: matched ? 1 : 0, upsertedCount: 0, upsertedId: null };
  }

  return {
    updates,
    seed(document) {
      const record = clone(document.toObject({ depopulate: true }));
      records.set(String(record._id), record);
      return String(record._id);
    },
    hydrate(id) {
      return Model.hydrate(clone(records.get(String(id))));
    },
    stored(id) {
      return clone(records.get(String(id)));
    },
    script(...next) {
      behaviours.push(...next);
    },
    install() {
      const collection = Model.collection;
      const own = Object.getOwnPropertyDescriptor(collection, 'updateOne');
      collection.updateOne = updateOne;
      return () => {
        if (own) Object.defineProperty(collection, 'updateOne', own);
        else delete collection.updateOne;
      };
    },
  };
}
