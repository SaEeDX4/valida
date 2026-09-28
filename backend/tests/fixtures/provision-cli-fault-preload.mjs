/**
 * TEST-ONLY PRELOAD for the provisioning CLI — offline fault injection.
 *
 * Loaded only by tests/jobs-provisioning-outcomes.test.js, as
 *   node --import <this file> scripts/provision-job.mjs …
 * and only with VALIDA_TEST_PROVISION_FAULT set: without it this module throws
 * before touching anything, so it can never be activated by accident.
 *
 * It replaces the database adapter underneath the UNMODIFIED CLI: mongoose's
 * connect/disconnect and the `jobs` / `applications` collection methods (see
 * fakeJobStore.js). The CLI's argument handling, definition validation,
 * configuration loading, provisioning, reporting and exit codes all run as in
 * production. Nothing connects to any server. This is not persistence
 * evidence.
 */
import mongoose from 'mongoose';
import { Job } from '../../src/models/Job.js';
import { Application } from '../../src/models/Application.js';
import { installFakeJobsCollection } from './fakeJobStore.js';

const scenario = process.env.VALIDA_TEST_PROVISION_FAULT;
if (!scenario) {
  throw new Error('provision-cli-fault-preload is test-only and requires VALIDA_TEST_PROVISION_FAULT');
}

const networkError = () => new mongoose.mongo.MongoNetworkError('stand-in: connection reset mongodb://stand-in-secret@db');
const selectionError = () =>
  new mongoose.Error.MongooseServerSelectionError('stand-in: server selection timed out mongodb://stand-in-secret@db');

/** Each scenario fails at exactly one point; every other call behaves normally. */
const SCENARIOS = {
  // Publication of a freshly inserted DRAFT is rejected: the update matched nothing.
  'publish-rejected': { updateOne: () => ({ result: { acknowledged: true, matchedCount: 0, modifiedCount: 0 } }) },
  // Publication of a freshly inserted DRAFT gets no acknowledgement.
  'publish-unknown': {
    updateOne: () => {
      throw networkError();
    },
  },
  // The insert is acknowledged; the read-back (second findOne) cannot reach the server.
  'readback-fails': {
    findOne: (call) => {
      if (call >= 2) throw selectionError();
    },
  },
  // The insert itself gets no acknowledgement.
  'insert-unknown': {
    insertOne: () => {
      throw networkError();
    },
  },
  // The very first read fails, before any write.
  'read-fails': {
    findOne: () => {
      throw selectionError();
    },
  },
  // Everything succeeds; closing the connection afterwards fails.
  'disconnect-fails': {},
  // Everything succeeds; producing the report fails (the database name cannot be read).
  'report-fails': {},
  // Everything succeeds.
  none: {},
};

if (!Object.hasOwn(SCENARIOS, scenario)) throw new Error(`unknown fault scenario: ${scenario}`);

installFakeJobsCollection(Job.collection, { faults: SCENARIOS[scenario] });
Application.collection.countDocuments = async () => 0;

mongoose.connect = async () => {
  mongoose.connection.readyState = 1;
  if (scenario === 'report-fails') {
    Object.defineProperty(mongoose.connection, 'name', {
      configurable: true,
      get() {
        throw networkError();
      },
    });
  } else {
    mongoose.connection.name = 'valida_offline_standin';
  }
  return mongoose;
};
mongoose.disconnect = async () => {
  if (scenario === 'disconnect-fails') throw networkError();
  mongoose.connection.readyState = 0;
};
