import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import crypto, { randomUUID } from 'node:crypto';
import { Application } from '../../src/models/Application.js';
import { PRUNE_SEQUENCE_COLLECTION, RecipientSuppression, RecipientSuppressionKey } from '../../src/models/RecipientSuppression.js';
import { createKeyring } from '../../src/modules/suppression/suppressionKeys.js';
import { createSuppressionGate } from '../../src/modules/suppression/suppressionGate.js';
import { createSuppressionRegister } from '../../src/modules/suppression/suppressionRegister.js';
import { createSuppressionOperations } from '../../src/modules/suppression/suppressionOperations.js';
import { QA_OPERATOR, realSuppression } from './fixtures/suppression.js';
import { CONNECT, applyAs, channels, clearAll, connectAndIndex, newEnvironment, publishedJob, startSubmissionServer, suppressionApp } from './fixtures/suppressionHarness.js';
import { requireTestDatabase } from './testDatabase.js';

/**
 * B7 r5 review correction — the approved primary-read requirement (design
 * §3.5; register header) in suppression AUTHORISATION, against a real MongoDB,
 * the real app and SMTP adapter, a LOCAL SMTP submission counter, synthetic
 * data and keys only.
 *
 * The register under test is bound to a connection opened with the accepted
 * URI setting `readPreference=secondaryPreferred`, exactly as production
 * models inherit their connection's preference. The app's own reads use the
 * ordinary test connection, so only the suppression queries are under test.
 * Command monitoring on that connection records every command the register
 * sends: its name, collection, read preference and the SERVER it went to.
 *
 *   RP-1  an already-suppressed recipient: zero acknowledgement submissions;
 *         all five send-path reads (stamp, coverage key ids, key documents,
 *         match, stamp) select the primary;
 *   RP-2  positive control: an unsuppressed address is acknowledged once, and
 *         its reads select the primary;
 *   RP-3  the operator path: the allocation's highest-stamp read, the entry
 *         and coverage reads and the Application reads select the primary;
 *   RP-4  no primary (a disposable multi-node replica set only): the check
 *         fails closed — no command reaches a secondary, nothing is decided;
 *   RP-5  a stale secondary (same): an already-suppressed recipient is still
 *         suppressed, with zero submissions.
 *
 * RP-4 and RP-5 step the primary down and pause a secondary's replication, so
 * they run only with MONGODB_TEST_DISPOSABLE_TOPOLOGY=1 on a replica set made
 * for the test (otherwise NOT RUN). On a standalone server a read preference
 * has nothing else to select; RP-1…3 still run there.
 */
const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const EVIDENCE = 'REV-2026-11-05-01';
const DISPOSABLE = process.env.MONGODB_TEST_DISPOSABLE_TOPOLOGY === '1';
const SUPPRESSION_COLLECTIONS = new Set(['recipient_suppressions', 'recipient_suppression_keys', PRUNE_SEQUENCE_COLLECTION]);
const address = (label) => `qa.${label}.${randomUUID().slice(0, 8)}@qa-valida.example.test`;
const bytes = () => crypto.randomBytes(32);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The test URI with `readPreference` set (any existing value replaced). */
function withReadPreference(uri, mode) {
  const [base, query = ''] = uri.split('?');
  const params = new URLSearchParams(query);
  params.set('readPreference', mode);
  return `${base}?${params}`;
}

let server;
let env;
let preferred;
let preferredModels;
let topology;
let recording = null;
const opened = [];

async function describeTopology() {
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName) return { kind: 'standalone', primary: hello.me ?? null, secondaries: [] };
  const members = [...(hello.hosts ?? []), ...(hello.passives ?? [])];
  return { kind: 'replicaSet', setName: hello.setName, primary: hello.primary, secondaries: members.filter((host) => host !== hello.primary) };
}

/** Records every command the register's connection starts while `run` executes. */
async function commandsDuring(run) {
  const seen = [];
  recording = seen;
  try {
    await run();
  } finally {
    recording = null;
  }
  return seen;
}
const suppressionCommands = (events) => events.filter((event) => SUPPRESSION_COLLECTIONS.has(event.collection));
const READ_COMMANDS = new Set(['find', 'distinct', 'aggregate', 'count', 'listIndexes']);
const plain = (value) => (value instanceof Map ? Object.fromEntries(value) : (value ?? {}));

/** Records the commands a connection's client starts while `recording` is on. */
function monitor(connection) {
  connection.getClient().on('commandStarted', (event) => {
    if (!recording) return;
    const command = event.command;
    const collection = typeof command[event.commandName] === 'string' ? command[event.commandName] : null;
    let kind = event.commandName;
    if (event.commandName === 'find' && collection === 'recipient_suppressions') kind = plain(command.sort).pruneSeq === -1 ? 'stamp' : plain(command.filter).$or ? 'match' : 'entries';
    if (event.commandName === 'find' && collection === 'recipient_suppression_keys') kind = 'key-documents';
    if (event.commandName === 'distinct' && command.key === 'lookups.keyId') kind = 'coverage-ids';
    recording.push({ name: event.commandName, kind, collection, address: event.address, readPreference: command.$readPreference?.mode ?? 'primary', read: READ_COMMANDS.has(event.commandName) });
  });
}
const modelsOn = (connection) => ({
  RecipientSuppression: connection.model('RecipientSuppression', RecipientSuppression.schema, 'recipient_suppressions'),
  RecipientSuppressionKey: connection.model('RecipientSuppressionKey', RecipientSuppressionKey.schema, 'recipient_suppression_keys'),
  Application: connection.model('Application', Application.schema, 'applications'),
});

/** Every command selected the primary: no non-primary read preference was sent, and (replica set) it went to the primary. */
/** Evidence line: what each command was, where it went and with which read preference (no filters, digests or addresses of people). */
const evidence = (label, events) => console.log(`${label}: ${JSON.stringify(events.map((event) => `${event.name}:${event.kind}@${event.address ?? 'standalone'} readPreference=${event.readPreference}`))}`);

function expectPrimary(events) {
  expect(events.length).toBeGreaterThan(0);
  const offending = events
    .filter((event) => event.readPreference !== 'primary' || (topology.kind === 'replicaSet' && event.address !== topology.primary))
    .map((event) => `${event.name} ${event.collection} (${event.kind}): readPreference=${event.readPreference}, server=${event.address}`);
  expect(offending).toEqual([]);
}

/** The five send-path reads of one acknowledgement check, in order: stamp, {coverage ids, key documents, match}, stamp. */
function expectSendPathReads(events) {
  const kinds = suppressionCommands(events).map((event) => event.kind);
  expect(kinds).toHaveLength(5);
  expect(kinds[0]).toBe('stamp');
  expect(kinds[4]).toBe('stamp');
  expect(kinds.slice(1, 4).sort()).toEqual(['coverage-ids', 'key-documents', 'match']);
}

function world(current, previous = []) {
  const keyring = createKeyring({ current: { keyId: current[0], key: current[1] }, previous: previous.map(([keyId, key]) => ({ keyId, key })) });
  const suppression = realSuppression({ keyring });
  const fixture = suppressionApp({ server, intake: env.intake, gate: suppression.gate, log: env.log });
  opened.push(fixture);
  return { keyring, ops: suppression.operations, app: fixture.app };
}
/** The register, gate and operations bound to the `readPreference=secondaryPreferred` connection. */
function preferredSuppression(keyring, { timeoutMs = 5_000, models = preferredModels } = {}) {
  const register = createSuppressionRegister({ timeoutMs, writeTimeoutMs: timeoutMs, models });
  const gate = createSuppressionGate({ register, keyring });
  const operations = createSuppressionOperations({ register, keyring, operatorIds: [QA_OPERATOR], timeoutMs, applicationModel: models.Application });
  return { register, gate, operations };
}
function preferredSender(keyring) {
  const { gate } = preferredSuppression(keyring);
  const fixture = suppressionApp({ server, intake: env.intake, gate, log: env.log });
  opened.push(fixture);
  return fixture.app;
}

async function suppress(w, label) {
  const email = address(label);
  server.refusals.set(email.toLowerCase(), { code: 550, text: '5.1.1 Mailbox unavailable (QA)' });
  const first = await applyAs(w.app, email);
  expect((await w.ops.addFromRefusal({ applicationId: String(first.id), evidenceRef: EVIDENCE, apply: true, actor: QA_OPERATOR })).result).toBe('ADDED');
  server.refusals.delete(email.toLowerCase());
  return { email, first };
}

/** A direct admin connection to one replica-set member. */
async function direct(host) {
  return mongoose.createConnection(`mongodb://${host}/admin?directConnection=true`, { serverSelectionTimeoutMS: 5_000 }).asPromise();
}
async function waitFor(check, { timeoutMs = 60_000, what }) {
  const started = Date.now();
  for (;;) {
    if (await check().catch(() => false)) return;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(500);
  }
}
/** Replicated to every data-bearing member (used to let a paused secondary catch up). */
async function replicatedEverywhere() {
  const marker = mongoose.connection.db.collection('qa_replication_marker');
  await marker.insertOne({ at: new Date() }, { writeConcern: { w: 3, wtimeout: 30_000 } });
  await marker.deleteMany({}, { writeConcern: { w: 3, wtimeout: 30_000 } });
}

beforeAll(async () => {
  await connectAndIndex(TEST_URI, TEST_DATABASE);
  topology = await describeTopology();
  preferred = await mongoose.createConnection(withReadPreference(TEST_URI, 'secondaryPreferred'), CONNECT).asPromise();
  preferredModels = modelsOn(preferred);
  monitor(preferred);
  server = await startSubmissionServer();
}, 60_000);
afterAll(async () => {
  await clearAll(TEST_DATABASE);
  await server.local.stop();
  await preferred?.close();
  await mongoose.disconnect();
}, 60_000);
beforeEach(async () => {
  await clearAll(TEST_DATABASE);
  await publishedJob();
  env = await newEnvironment();
  server.refusals.clear();
});
afterEach(async () => {
  while (opened.length) await opened.pop().transport.close?.();
  await env.intake.cleanup();
});

describe('RP — suppression authorisation reads the PRIMARY under readPreference=secondaryPreferred (design §3.5)', () => {
  it('reports the topology under test', () => {
    // Evidence only: which servers a non-primary preference could reach.
    console.log(`RP topology: ${JSON.stringify(topology)}`);
    expect(['standalone', 'replicaSet']).toContain(topology.kind);
  });

  it('RP-1 an already-suppressed recipient: zero acknowledgement submissions; the five send-path reads all select the primary', async () => {
    const K1 = bytes();
    const operator = world(['k1', K1]);
    await operator.ops.keyRegister({ keyId: 'k1', apply: true, actor: QA_OPERATOR });
    const target = await suppress(operator, 'rp1');
    const sender = preferredSender(createKeyring({ current: { keyId: 'k1', key: K1 } }));
    const rcptBefore = server.counter.rcptTo(target.email);
    let application;
    const events = await commandsDuring(async () => {
      application = await applyAs(sender, target.email);
    });
    expect(application.response.status).toBe(201);
    evidence('RP-1 commands', suppressionCommands(events));
    console.log(`RP-1 submissions to the suppressed recipient during the check: ${server.counter.rcptTo(target.email) - rcptBefore}`);
    expect(server.counter.rcptTo(target.email)).toBe(rcptBefore); // ZERO submissions
    expect(server.counter.messagesTo(target.email)).toBe(0);
    expect((await channels(application.id)).candidateAcknowledgement).toMatchObject({ status: 'FAILED', lastErrorCode: 'RECIPIENT_SUPPRESSED' });
    expectSendPathReads(events);
    expectPrimary(suppressionCommands(events));
  });

  it('RP-2 positive control: an unsuppressed address is acknowledged ONCE, and its reads select the primary', async () => {
    const K1 = bytes();
    const operator = world(['k1', K1]);
    await operator.ops.keyRegister({ keyId: 'k1', apply: true, actor: QA_OPERATOR });
    await suppress(operator, 'rp2other');
    const sender = preferredSender(createKeyring({ current: { keyId: 'k1', key: K1 } }));
    const email = address('rp2free');
    let application;
    const events = await commandsDuring(async () => {
      application = await applyAs(sender, email);
    });
    expect((await channels(application.id)).candidateAcknowledgement).toMatchObject({ status: 'SENT' });
    expect(server.counter.rcptTo(email)).toBe(1);
    expect(server.counter.messagesTo(email)).toBe(1);
    evidence('RP-2 commands', suppressionCommands(events));
    expectSendPathReads(events);
    expectPrimary(suppressionCommands(events));
  });

  it('RP-3 the operator path: add (Application reads), coverage, and a prune with its allocation (highest-stamp read) all read the primary', async () => {
    const K1 = bytes();
    const K2 = bytes();
    const setup = world(['k1', K1]);
    await setup.ops.keyRegister({ keyId: 'k1', apply: true, actor: QA_OPERATOR });
    const email = address('rp3');
    server.refusals.set(email.toLowerCase(), { code: 550, text: '5.1.1 Mailbox unavailable (QA)' });
    const refused = await applyAs(setup.app, email);
    server.refusals.clear();
    const ops1 = preferredSuppression(createKeyring({ current: { keyId: 'k1', key: K1 } })).operations;
    const addEvents = await commandsDuring(async () => {
      expect((await ops1.addFromRefusal({ applicationId: String(refused.id), evidenceRef: EVIDENCE, apply: true, actor: QA_OPERATOR })).result).toBe('ADDED');
    });
    const rotated = world(['k2', K2], [['k1', K1]]);
    await rotated.ops.keyRegister({ keyId: 'k2', apply: true, actor: QA_OPERATOR });
    expect(await rotated.ops.rekey({ apply: true, actor: QA_OPERATOR })).toMatchObject({ moved: 1 });
    const ops2 = preferredSuppression(createKeyring({ current: { keyId: 'k2', key: K2 }, previous: [{ keyId: 'k1', key: K1 }] })).operations;
    const pruneEvents = await commandsDuring(async () => {
      expect(await ops2.rekey({ apply: true, actor: QA_OPERATOR })).toMatchObject({ aliasesPruned: 1 });
      expect((await ops2.coverage()).result).toBe('COVERAGE_COMPLETE');
    });
    const reads = [...addEvents, ...pruneEvents].filter((event) => event.read);
    expect(reads.some((event) => event.collection === 'applications')).toBe(true); // the add read the stored Application
    expect(pruneEvents.filter((event) => event.kind === 'stamp').length).toBeGreaterThanOrEqual(1); // the allocation's highest-stamp read
    expect(pruneEvents.some((event) => event.name === 'findAndModify' && event.collection === PRUNE_SEQUENCE_COLLECTION)).toBe(true);
    evidence('RP-3 reads', reads);
    expectPrimary(reads);
  });

  it('RP-4 no primary available (disposable multi-node replica set): the check FAILS CLOSED — no suppression command reaches a secondary, nothing is decided', async (context) => {
    if (!DISPOSABLE || topology.kind !== 'replicaSet' || topology.secondaries.length === 0) {
      return context.skip('NOT RUN: needs MONGODB_TEST_DISPOSABLE_TOPOLOGY=1 and a replica set with a readable secondary');
    }
    const admin = await direct(topology.primary);
    const config = (await admin.db.admin().command({ replSetGetConfig: 1 })).config;
    if (config.members.some((member) => member.host !== topology.primary && member.priority > 0)) {
      await admin.close();
      return context.skip('NOT RUN: another member is electable, so stepping the primary down would not leave the set without one');
    }
    const K1 = bytes();
    const operator = world(['k1', K1]);
    await operator.ops.keyRegister({ keyId: 'k1', apply: true, actor: QA_OPERATOR });
    const target = await suppress(operator, 'rp4');
    await replicatedEverywhere(); // the secondary holds the suppression too: a secondary read would DECIDE
    const ring = createKeyring({ current: { keyId: 'k1', key: K1 } });
    const { gate, register } = preferredSuppression(ring, { timeoutMs: 2_000 });
    const normalised = (email) => email.toLowerCase();
    // While the primary is up: decided, from the primary.
    expect((await gate.checkAcknowledgement({ emailNormalized: normalised(target.email) })).errorCode).toBe('RECIPIENT_SUPPRESSED');
    expect((await gate.checkAcknowledgement({ emailNormalized: normalised(address('rp4free')) })).decision).toBe('PROCEED');
    let late;
    try {
      await admin.db.admin().command({ replSetStepDown: 60, secondaryCatchUpPeriodSecs: 0, force: true }).catch(() => {}); // the server drops connections as it steps down
      const secondary = await direct(topology.secondaries[0]);
      await waitFor(async () => !(await secondary.db.admin().command({ hello: 1 })).primary, { what: 'no primary', timeoutMs: 30_000 });
      const counterValue = async () => (await secondary.useDb(TEST_DATABASE).collection(PRUNE_SEQUENCE_COLLECTION).findOne({}))?.value ?? 0;
      const counterBefore = await counterValue();
      const free = address('rp4free');
      const failClosed = async (suppression) => {
        for (const email of [target.email, free]) {
          const outcome = await suppression.gate.checkAcknowledgement({ emailNormalized: normalised(email) });
          console.log(`RP-4 outcome (${email === target.email ? 'suppressed' : 'unsuppressed'} address, connection readyState ${suppression.connection?.readyState ?? 'n/a'}): ${JSON.stringify(outcome)}`);
          expect(outcome).toMatchObject({ decision: 'UNAVAILABLE', errorCode: 'SUPPRESSION_CHECK_UNAVAILABLE' });
          expect(['TIMEOUT', 'READ_FAILED']).toContain(outcome.reason);
        }
        await expect(suppression.register.allocatePruneSeq()).rejects.toBeTruthy();
        await expect(suppression.register.readCoverageInputs()).rejects.toBeTruthy();
      };
      // (a) The connection that was open when the primary left (Mongoose now reports it disconnected).
      const oldEvents = await commandsDuring(() => failClosed({ gate, register, connection: preferred }));
      expect(suppressionCommands(oldEvents)).toEqual([]);
      // (b) A connection opened AFTER the primary left: it reports "connected" (a secondary is reachable),
      //     so only the read preference stands between the check and the readable secondary.
      late = await mongoose.createConnection(withReadPreference(TEST_URI, 'secondaryPreferred'), CONNECT).asPromise();
      monitor(late);
      expect(late.readyState).toBe(1);
      const lateEvents = await commandsDuring(() => failClosed({ ...preferredSuppression(ring, { timeoutMs: 2_000, models: modelsOn(late) }), connection: late }));
      console.log(`RP-4 suppression commands started without a primary: old connection ${suppressionCommands(oldEvents).length}, new connection ${suppressionCommands(lateEvents).length}`);
      expect(suppressionCommands(lateEvents)).toEqual([]); // nothing was sent to the readable secondary
      expect(late.readyState).toBe(1);
      expect(await counterValue()).toBe(counterBefore); // no prune sequence was allocated
      await secondary.close();
    } finally {
      await late?.close().catch(() => {});
      const restore = await direct(topology.primary);
      await restore.db.admin().command({ replSetFreeze: 0 }).catch(() => {});
      await waitFor(async () => (await restore.db.admin().command({ hello: 1 })).isWritablePrimary === true, { what: 'the primary to return', timeoutMs: 60_000 });
      await restore.close();
      await admin.close().catch(() => {});
      await waitFor(async () => (await mongoose.connection.db.admin().command({ hello: 1 })).isWritablePrimary === true, { what: 'the test connection', timeoutMs: 60_000 });
    }
  }, 180_000);

  it('RP-5 a stale secondary (replication paused on it): an already-suppressed recipient is still suppressed — zero submissions; every read went to the primary', async (context) => {
    if (!DISPOSABLE || topology.kind !== 'replicaSet' || topology.secondaries.length === 0) {
      return context.skip('NOT RUN: needs MONGODB_TEST_DISPOSABLE_TOPOLOGY=1 and a replica set with a readable secondary');
    }
    const lagging = await direct(topology.secondaries[0]);
    try {
      await lagging.db.admin().command({ configureFailPoint: 'stopReplProducer', mode: 'off' });
    } catch {
      await lagging.close();
      return context.skip('NOT RUN: the secondary has no test commands (stopReplProducer fail point)');
    }
    const K1 = bytes();
    const operator = world(['k1', K1]);
    await operator.ops.keyRegister({ keyId: 'k1', apply: true, actor: QA_OPERATOR });
    await replicatedEverywhere(); // the secondary has the job and the key document, nothing more
    try {
      await lagging.db.admin().command({ configureFailPoint: 'stopReplProducer', mode: 'alwaysOn' });
      const target = await suppress(operator, 'rp5'); // acknowledged by a majority without the paused secondary
      const onSecondary = await lagging.useDb(TEST_DATABASE).collection('recipient_suppressions').countDocuments({});
      expect(onSecondary).toBe(0); // the paused secondary really does not have the suppression
      console.log(`RP-5 suppression entries on the paused secondary: ${onSecondary}`);
      const sender = preferredSender(createKeyring({ current: { keyId: 'k1', key: K1 } }));
      const rcptBefore = server.counter.rcptTo(target.email);
      let application;
      const events = await commandsDuring(async () => {
        application = await applyAs(sender, target.email);
      });
      console.log(`RP-5 submissions to the suppressed recipient: ${server.counter.rcptTo(target.email) - rcptBefore}`);
      evidence('RP-5 commands', suppressionCommands(events));
      expect(server.counter.rcptTo(target.email)).toBe(rcptBefore); // ZERO submissions
      expect(server.counter.messagesTo(target.email)).toBe(0);
      expect((await channels(application.id)).candidateAcknowledgement).toMatchObject({ status: 'FAILED', lastErrorCode: 'RECIPIENT_SUPPRESSED' });
      expectSendPathReads(events);
      expectPrimary(suppressionCommands(events));
    } finally {
      await lagging.db.admin().command({ configureFailPoint: 'stopReplProducer', mode: 'off' }).catch(() => {});
      await lagging.close();
      await replicatedEverywhere().catch(() => {});
    }
  }, 180_000);
});
