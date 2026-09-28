import mongoose from 'mongoose';
import { jobSchema } from '../../src/models/Job.js';
import { REQUIRED_INDEXES } from '../../src/db/indexes.js';

/**
 * OFFLINE STAND-IN FOR THE `jobs` COLLECTION — NOT PERSISTENCE EVIDENCE.
 *
 * Replaces only the lowest layer: the collection methods Mongoose calls
 * (findOne, insertOne, updateOne, indexes). Everything above it is the real
 * code — the provisioning module, the B2 services, the Job model with its
 * validation, lifecycle hooks and write guards, and Mongoose's own save/cast/
 * hydrate logic. That makes it possible to COUNT the writes a run sends and to
 * INJECT a failure at an exact point (after an acknowledged insert, on the
 * publish update, on the read-back), which a real database cannot be made to
 * do on demand.
 *
 * What it cannot show — that MongoDB stores, indexes or rejects anything — is
 * proven only by tests/db against a real database. Any delete call throws: a
 * provisioning run must never delete or roll back.
 */

/** Deep copy that keeps Dates and ObjectIds as the driver would return them. */
function clone(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (value && value._bsontype === 'ObjectId') return value;
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, clone(inner)]));
  }
  return value;
}

function setPath(target, path, value) {
  const keys = path.split('.');
  let node = target;
  for (const key of keys.slice(0, -1)) {
    if (node[key] === null || typeof node[key] !== 'object') node[key] = {};
    node = node[key];
  }
  node[keys.at(-1)] = clone(value);
}

function getPath(target, path) {
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), target);
}

function unsetPath(target, path) {
  const keys = path.split('.');
  const parent = keys.length > 1 ? getPath(target, keys.slice(0, -1).join('.')) : target;
  if (parent && typeof parent === 'object') delete parent[keys.at(-1)];
}

const same = (left, right) => String(left) === String(right);

/** Supports exactly the filters provisioning sends: { slug: {$eq} }, { _id }, { _id, __v }. */
function matches(doc, filter) {
  return Object.entries(filter ?? {}).every(([key, condition]) => {
    const expected = condition && typeof condition === 'object' && '$eq' in condition ? condition.$eq : condition;
    return same(getPath(doc, key), expected);
  });
}

const JOBS_INDEXES = [
  { v: 2, key: { _id: 1 }, name: '_id_' },
  ...REQUIRED_INDEXES.filter((index) => index.collection === 'jobs').map((index) => ({
    v: 2,
    key: index.key,
    name: index.name,
    ...index.options,
  })),
];

/**
 * Installs the stand-in on a Mongoose collection.
 *
 * @param {object} collection  model.collection (Mongoose NativeCollection)
 * @param {object} [options]
 * @param {Record<string, (callNumber: number, ...args) => (void | {result: object})>} [options.faults]
 *   Per-method hooks run before the operation, with the 1-based call number of
 *   that method. A hook may THROW (the operation fails, nothing is stored) or
 *   return `{ result }` to answer without storing (for example an update that
 *   matched nothing).
 */
export function installFakeJobsCollection(collection, { faults = {}, indexes = JOBS_INDEXES } = {}) {
  const docs = new Map();
  const calls = { findOne: 0, insertOne: 0, updateOne: 0, indexes: 0, delete: 0 };
  const hook = (method, ...args) => faults[method]?.(calls[method], ...args);

  collection.findOne = async (filter) => {
    calls.findOne += 1;
    const override = hook('findOne', filter);
    if (override) return override.result;
    const found = [...docs.values()].find((doc) => matches(doc, filter));
    return found ? clone(found) : null;
  };

  collection.insertOne = async (doc) => {
    calls.insertOne += 1;
    const override = hook('insertOne', doc);
    if (override) return override.result;
    if ([...docs.values()].some((stored) => stored.slug === doc.slug)) {
      const error = new mongoose.mongo.MongoServerError({ message: 'E11000 duplicate key error (stand-in)' });
      error.code = 11000;
      throw error;
    }
    docs.set(String(doc._id), clone(doc));
    return { acknowledged: true, insertedId: doc._id };
  };

  collection.updateOne = async (filter, update) => {
    calls.updateOne += 1;
    const override = hook('updateOne', filter, update);
    if (override) return override.result;
    const stored = [...docs.values()].find((doc) => matches(doc, filter));
    if (!stored) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    for (const [path, value] of Object.entries(update.$set ?? {})) setPath(stored, path, value);
    for (const path of Object.keys(update.$unset ?? {})) unsetPath(stored, path);
    for (const [path, amount] of Object.entries(update.$inc ?? {})) setPath(stored, path, (getPath(stored, path) ?? 0) + amount);
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  };

  collection.indexes = async () => {
    calls.indexes += 1;
    return clone(indexes);
  };

  const refuseDelete = async () => {
    calls.delete += 1;
    throw new Error('a provisioning run must never delete');
  };
  collection.deleteOne = refuseDelete;
  collection.deleteMany = refuseDelete;
  collection.findOneAndDelete = refuseDelete;

  return {
    docs,
    calls,
    /** Writes the stand-in received (successful or not). */
    get writeCalls() {
      return calls.insertOne + calls.updateOne + calls.delete;
    },
    stored: (slug) => {
      const doc = [...docs.values()].find((candidate) => candidate.slug === slug);
      return doc ? clone(doc) : null;
    },
  };
}

/**
 * A Job model on its own Mongoose connection, marked open, whose collection is
 * the stand-in above. Uses the real B2 Job schema (validation, lifecycle hooks,
 * write guards).
 */
export function createFakeJobModel({ faults, applicationCount = 0 } = {}) {
  const connection = mongoose.createConnection();
  const model = connection.model('Job', jobSchema, 'jobs');
  connection.readyState = 1;
  const store = installFakeJobsCollection(model.collection, { faults });
  return {
    model,
    store,
    applicationModel: { countDocuments: async () => applicationCount },
  };
}
