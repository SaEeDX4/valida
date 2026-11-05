import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import crypto, { randomUUID } from 'node:crypto';
import { Application } from '../../src/models/Application.js';
import { RecipientSuppression, RecipientSuppressionKey } from '../../src/models/RecipientSuppression.js';
import { createKeyring } from '../../src/modules/suppression/suppressionKeys.js';
import { createSuppressionGate } from '../../src/modules/suppression/suppressionGate.js';
import { createSuppressionRegister } from '../../src/modules/suppression/suppressionRegister.js';
import { createSuppressionOperations } from '../../src/modules/suppression/suppressionOperations.js';
import { createApplicationRepository } from '../../src/modules/applications/application.repository.js';
import { createApplicationNotifier, runNotificationRetry, staleAfterMs } from '../../src/modules/applications/application.notifications.js';
import { applyRequest } from '../fixtures/applyHarness.js';
import { CONNECT, applyAs, clearAll, connectAndIndex, newEnvironment, publishedJob, startSubmissionServer, suppressionApp } from './fixtures/suppressionHarness.js';
import { startPartitionBridge } from './fixtures/partitionBridge.js';
import { requireTestDatabase } from './testDatabase.js';

/**
 * B7 SUP-12 / design §3.5 investigation — a STALE PRIMARY.
 *
 * After the current primary majority-acknowledges a suppression, can an
 * acknowledgement whose suppression lookup starts AFTERWARDS reach SMTP
 * through a former primary that still considers itself writable?
 *
 * Topology: a disposable three-member replica set, every member behind a TCP
 * bridge (tests/db/fixtures/partitionBridge.js), so links can be black-holed —
 * the way a real partition looks to MongoDB. The window is made by cutting in
 * two steps: first A–B (and the sender's links to B and C, and the majority
 * operator's link to A), eight seconds later A–C. B (or C) is elected after
 * electionTimeoutMillis without A, while A still counts C as reachable for
 * about eight seconds more — during which BOTH report isWritablePrimary: true
 * (observed directly on each member, not through the bridge).
 *
 *   SP-1  the claim is obtained BEFORE the partition (majority-acknowledged on
 *         A); the suppression is then majority-acknowledged on the NEW
 *         primary; only then does the sender's suppression lookup start,
 *         served by the stale former primary A;
 *   SP-2  the retry path, its claim attempted DURING the partition, on A;
 *   SP-3  the healthy positive control.
 *
 * Real app, real notifier, real gate and register, real SMTP adapter, a LOCAL
 * SMTP server counting RCPT; synthetic data and synthetic keys only.
 *
 * Runs only with MONGODB_TEST_PARTITION_NODES = three FRESH mongod addresses
 * (`--replSet rs2`, never used for anything else; the test initiates the set
 * with the bridge addresses: real port + 1000). Otherwise NOT RUN.
 */
const { databaseName: TEST_DATABASE } = requireTestDatabase();
const PARTITION_NODES = (process.env.MONGODB_TEST_PARTITION_NODES ?? '').split(',').map((value) => value.trim()).filter(Boolean);
const ENABLED = PARTITION_NODES.length === 3;
const NOT_RUN = 'NOT RUN: needs MONGODB_TEST_PARTITION_NODES (three fresh mongod addresses for a disposable replica set)';
const SET = 'rs2';
const EVIDENCE = 'REV-2026-11-05-02';
const OPERATOR = 'qa-operator';
const POLICY = Object.freeze({ maxAttempts: 5, baseDelayMs: 60_000, staleMs: staleAfterMs({ notificationTimeoutMs: 10_000, databaseTimeoutMs: 5_000 }) });
const address = (label) => `qa.${label}.${randomUUID().slice(0, 8)}@qa-valida.example.test`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const NAMES = ['A', 'B', 'C'];
const nodes = PARTITION_NODES.map((real, index) => ({ name: NAMES[index], real, bridgePort: Number(real.split(':')[1]) + 1000 }));
const nodeByBridge = new Map(nodes.map((node) => [`127.0.0.1:${node.bridgePort}`, node.name]));
const bridgeHosts = nodes.map((node) => `127.0.0.1:${node.bridgePort}`).join(',');

let bridge;
let observers = {};
let controller;
let server;
let env;
let t0 = Date.now();
let timeline = [];
const opened = [];
const mark = (event, detail = {}) => {
  timeline.push({ t: Date.now() - t0, event, ...detail });
  if (process.env.PARTITION_DEBUG) console.log(`[${Date.now() - t0}ms] ${event}`);
};

async function waitFor(check, { timeoutMs, what, intervalMs = 200 }) {
  const started = Date.now();
  for (;;) {
    if (await check().catch(() => false)) return;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(intervalMs);
  }
}

/** What each member says about itself, read DIRECTLY (not through the bridge). */
async function snapshot() {
  const entries = await Promise.all(
    NAMES.map(async (name) => {
      try {
        const admin = observers[name].db.admin();
        const [hello, status] = await Promise.all([admin.command({ hello: 1 }), admin.command({ replSetGetStatus: 1 })]);
        return [name, { writable: hello.isWritablePrimary === true, state: status.members.find((member) => member.self)?.stateStr, term: status.term }];
      } catch (error) {
        return [name, { writable: false, state: `ERROR ${error.codeName ?? 'unreachable'}`, term: null }];
      }
    }),
  );
  return Object.fromEntries(entries);
}

async function waitHealthy() {
  bridge.heal();
  await waitFor(
    async () => {
      const state = await snapshot();
      return state.A.writable && state.B.state === 'SECONDARY' && state.C.state === 'SECONDARY';
    },
    { timeoutMs: 120_000, what: 'A primary with two healthy secondaries', intervalMs: 500 },
  );
  // Everything written so far is on every member.
  await waitFor(
    async () => {
      await controller.db.collection('qa_replication_marker').insertOne({ at: new Date() }, { writeConcern: { w: 3, wtimeout: 10_000 } });
      return true;
    },
    { timeoutMs: 60_000, what: 'replication to all three members', intervalMs: 1_000 },
  );
}

/**
 * Two-step cut; resolves when the stale-primary window is OPEN (both A and a
 * new primary writable). Connections A opens are BLACK-HOLED (A keeps its last
 * view and counts the others as reachable until electionTimeoutMillis passes);
 * connections the others open to A are REFUSED (they fail fast: B and C move
 * their replication to each other at once).
 */
async function openStaleWindow() {
  const rules = new Map();
  const rule = (source, destination) => rules.get(`${source}->${destination}`) ?? false;
  const sever = (y) => {
    rules.set(`node:A->${y}`, 'blackhole');
    rules.set(`node:${y}->A`, 'refuse');
  };
  sever('B');
  rules.set('app:qa-sender->B', 'refuse');
  rules.set('app:qa-sender->C', 'refuse');
  rules.set('app:qa-majority->A', 'refuse');
  bridge.partition(rule);
  mark('partition step 1: A–B cut; sender reaches only A; majority operator cannot reach A');
  await sleep(8_000);
  sever('C');
  bridge.partition(rule);
  mark('partition step 2: A–C cut (A isolated)');
  let state;
  await waitFor(
    async () => {
      state = await snapshot();
      return state.A.writable && (state.B.writable || state.C.writable);
    },
    { timeoutMs: 20_000, what: 'a new primary while A is still writable', intervalMs: 100 },
  );
  const newPrimary = state.B.writable ? 'B' : 'C';
  mark('stale-primary window OPEN', { newPrimary, members: state });
  return { newPrimary, state };
}

/** Records every command of a client: which member served it, and whether it succeeded. */
function monitor(connection, actor) {
  const started = new Map();
  const client = connection.getClient();
  client.on('commandStarted', (event) => {
    const collection = typeof event.command[event.commandName] === 'string' ? event.command[event.commandName] : null;
    if (!['applications', 'recipient_suppressions', 'recipient_suppression_keys', 'recipient_suppression_sequence'].includes(collection)) return;
    started.set(event.requestId, {
      t: Date.now() - t0,
      actor,
      command: event.commandName,
      collection,
      node: nodeByBridge.get(event.address) ?? event.address,
      readConcern: event.command.readConcern?.level ?? null, // as sent on the wire (null: server default)
    });
  });
  const finish = (outcome) => (event) => {
    const entry = started.get(event.requestId);
    if (!entry) return;
    started.delete(event.requestId);
    timeline.push({ ...entry, event: 'command', outcome, durationMs: Date.now() - t0 - entry.t, ...(outcome === 'failed' ? { error: event.failure?.codeName ?? event.failure?.name } : {}) });
  };
  client.on('commandSucceeded', finish('succeeded'));
  client.on('commandFailed', finish('failed'));
}

/** The majority-side operator command (its own connection, appName qa-majority). */
function majorityOperations(keyring) {
  const models = {
    RecipientSuppression: controller.model('RecipientSuppression', RecipientSuppression.schema, 'recipient_suppressions'),
    RecipientSuppressionKey: controller.model('RecipientSuppressionKey', RecipientSuppressionKey.schema, 'recipient_suppression_keys'),
  };
  const register = createSuppressionRegister({ timeoutMs: 10_000, writeTimeoutMs: 10_000, models });
  return createSuppressionOperations({ register, keyring, operatorIds: [OPERATOR], timeoutMs: 10_000, applicationModel: controller.model('Application', Application.schema, 'applications') });
}

/** The sender's real gate, instrumented: optionally held BEFORE its lookup starts; every decision recorded. */
function senderGate(keyring, { hold = null } = {}) {
  const register = createSuppressionRegister({ timeoutMs: 3_000, writeTimeoutMs: 5_000 });
  const held = {
    ...register,
    async readForAcknowledgement(input) {
      if (hold) {
        hold.entered();
        await hold.released;
      }
      mark('sender: suppression lookup START');
      try {
        return await register.readForAcknowledgement(input);
      } finally {
        mark('sender: suppression lookup END');
      }
    },
  };
  const gate = createSuppressionGate({ register: held, keyring });
  const decisions = [];
  return {
    decisions,
    gate: {
      ...gate,
      async checkAcknowledgement(input) {
        const decision = await gate.checkAcknowledgement(input);
        decisions.push(decision);
        mark('sender: gate decision', { decision: decision.decision, errorCode: decision.errorCode ?? null, reason: decision.reason ?? null });
        return decision;
      },
    },
  };
}
function holdPoint() {
  const point = {};
  point.entered = null;
  point.reached = new Promise((resolve) => {
    point.entered = resolve;
  });
  point.released = new Promise((resolve) => {
    point.release = resolve;
  });
  return point;
}
const countOn = (name, collection, filter = {}) => observers[name].useDb(TEST_DATABASE).collection(collection).countDocuments(filter);
const latestApplicationOn = async (name) => (await observers[name].useDb(TEST_DATABASE).collection('applications').find({}, { projection: { _id: 1 } }).sort({ submittedAt: -1, _id: -1 }).limit(1).toArray())[0]?._id;
const refuse = (email, code, text) => server.refusals.set(email.toLowerCase(), { code, text });
const evidence = (label, detail) => console.log(`${label} ${JSON.stringify(detail)}`);

beforeAll(async () => {
  if (!ENABLED) return;
  // Disposable loopback members only; an already-initiated set must be THIS test's own (rs2 on the bridge addresses).
  if (!PARTITION_NODES.every((value) => /^127\.0\.0\.1:\d+$/.test(value))) throw new Error('MONGODB_TEST_PARTITION_NODES must be three 127.0.0.1:<port> addresses of fresh, disposable mongod processes');
  bridge = await startPartitionBridge({ nodes });
  for (const node of nodes) observers[node.name] = await mongoose.createConnection(`mongodb://${node.real}/admin?directConnection=true`, { serverSelectionTimeoutMS: 3_000 }).asPromise();
  try {
    const { config } = await observers.A.db.admin().command({ replSetGetConfig: 1 });
    const hosts = config.members.map((member) => member.host).sort().join(',');
    if (config._id !== SET || hosts !== nodes.map((node) => `127.0.0.1:${node.bridgePort}`).sort().join(',')) {
      throw new Error(`refused: the members already belong to replica set ${config._id} (${hosts}), not this test's disposable ${SET}`);
    }
  } catch (error) {
    if (error.codeName !== 'NotYetInitialized') throw error;
    await observers.A.db.admin().command({
      replSetInitiate: {
        _id: SET,
        members: nodes.map((node, index) => ({ _id: index, host: `127.0.0.1:${node.bridgePort}`, priority: 3 - index })),
        settings: { electionTimeoutMillis: 10_000, catchUpTimeoutMillis: 0 },
      },
    });
  }
  await waitFor(
    async () => {
      const state = await snapshot();
      return state.A.writable && state.B.state === 'SECONDARY' && state.C.state === 'SECONDARY';
    },
    { timeoutMs: 120_000, what: 'the set to elect A', intervalMs: 500 },
  );
  controller = await mongoose.createConnection(`mongodb://${bridgeHosts}/${TEST_DATABASE}?replicaSet=${SET}&appName=qa-majority`, CONNECT).asPromise();
  await waitHealthy();
  await connectAndIndex(`mongodb://${bridgeHosts}/${TEST_DATABASE}?replicaSet=${SET}&appName=qa-sender`, TEST_DATABASE);
  monitor(mongoose.connection, 'sender');
  monitor(controller, 'majority-operator');
  server = await startSubmissionServer();
}, 240_000);
afterAll(async () => {
  if (!ENABLED) return;
  bridge.heal();
  await server?.local.stop();
  await controller?.close();
  await mongoose.disconnect();
  for (const connection of Object.values(observers)) await connection.close();
  await bridge.close();
}, 120_000);
beforeEach(async () => {
  if (!ENABLED) return;
  await waitHealthy();
  await clearAll(TEST_DATABASE);
  await publishedJob();
  env = await newEnvironment();
  server.refusals.clear();
  t0 = Date.now();
  timeline = [];
}, 240_000);
afterEach(async () => {
  if (!ENABLED) return;
  bridge.heal();
  while (opened.length) await opened.pop().transport.close?.();
  await env?.intake.cleanup();
}, 120_000);

describe('SUP-12 / §3.5 — a stale former primary after the majority recorded a suppression', () => {
  it('SP-1 claim BEFORE the partition; suppression majority-acknowledged on the NEW primary; lookup starts afterwards on the stale primary → zero SMTP submissions', async (context) => {
    if (!ENABLED) return context.skip(NOT_RUN);
    const K1 = crypto.randomBytes(32);
    const keyring = createKeyring({ current: { keyId: 'k1', key: K1 } });
    const majority = majorityOperations(keyring);
    expect((await majority.keyRegister({ keyId: 'k1', apply: true, actor: OPERATOR })).result).toBeTruthy();
    const target = address('sp1');
    // A1: the confirmed 5.1.1 refusal the suppression will be recorded from (healthy path).
    refuse(target, 550, '5.1.1 Mailbox unavailable (QA)');
    const plain = suppressionApp({ server, intake: env.intake, gate: senderGate(keyring).gate, log: env.log });
    opened.push(plain);
    const refused = await applyAs(plain.app, target);
    server.refusals.clear();
    // A2: the acknowledgement under test — claimed now (healthy, majority-acknowledged), held before its lookup.
    const hold = holdPoint();
    const instrumented = senderGate(keyring, { hold });
    const held = suppressionApp({ server, intake: env.intake, gate: instrumented.gate, log: env.log });
    opened.push(held);
    // The Apply request awaits its bounded notification attempt, so it is started, not awaited, here.
    const responding = applyRequest(held.app, { key: randomUUID(), fields: { email: target }, answers: [] }).then((response) => response);
    await hold.reached;
    mark('sender: acknowledgement CLAIMED (healthy), held before its suppression lookup');
    const claimed = await latestApplicationOn('A');
    await waitHealthy(); // the claim is on all three members before the partition
    const rcptBefore = server.counter.rcptTo(target);
    let decisionSnapshot = null;
    try {
      const window = await openStaleWindow();
      // The majority records the suppression on the NEW primary (w: majority, j: true).
      const added = await majority.addFromRefusal({ applicationId: String(refused.id), evidenceRef: EVIDENCE, apply: true, actor: OPERATOR });
      expect(added.result).toBe('ADDED');
      mark('majority: suppression ADDED and majority-acknowledged', { suppressionId: added.suppressionId });
      const onNode = Object.fromEntries(await Promise.all(NAMES.map(async (name) => [name, await countOn(name, 'recipient_suppressions')])));
      const before = await snapshot();
      mark('members just before the lookup is released', { members: before, suppressionEntriesPerMember: onNode });
      expect(before.A.writable).toBe(true); // the window is still open
      expect(before[window.newPrimary].writable).toBe(true);
      expect(before[window.newPrimary].term).toBeGreaterThan(before.A.term);
      expect(onNode.A).toBe(0); // the stale primary does not have the suppression
      expect(onNode[window.newPrimary]).toBe(1);
      // Only now does the target lookup start.
      hold.release();
      await waitFor(async () => instrumented.decisions.length > 0, { timeoutMs: 20_000, what: 'the gate decision' });
      decisionSnapshot = await snapshot();
      mark('members right after the gate decision', { members: decisionSnapshot });
      const response = await responding;
      mark('sender: Apply response', { status: response.status });
      await held.app.locals.applicationSubmission.drainFollowUps().catch(() => {});
    } finally {
      hold.release();
      await responding.catch(() => {});
    }
    const rcptAfter = server.counter.rcptTo(target);
    // After the partition heals: the deferred acknowledgement is retried on the healthy set, which now sees the
    // suppression. Its stored state depends on timing: the FAILED / SUPPRESSION_CHECK_UNAVAILABLE outcome is on the
    // majority when A stepped down while the outcome write waited (the driver retried it on the new primary); when
    // the write timed out on A instead, it is rolled back and the claim is a stale attempt (UNCERTAIN, retried only
    // with --include-uncertain). Both are recorded; the retry includes uncertain claims, so either way the gate runs.
    await waitHealthy();
    const storedAfterHeal = await mongoose.connection.collection('applications').findOne({ _id: claimed }, { projection: { _id: 0, 'notifications.candidateAcknowledgement': 1 } });
    const acknowledgementAfterHeal = storedAfterHeal?.notifications?.candidateAcknowledgement ?? null;
    const later = () => new Date(Date.now() + 10 * 60_000);
    const retryGate = senderGate(keyring);
    const applications = createApplicationRepository({ timeoutMs: 2_000 });
    const notifier = createApplicationNotifier({ applications, notifications: held.notificationService, clock: later, logger: env.log.logger, suppression: retryGate.gate });
    mark('after heal: retry run START');
    const retried = await runNotificationRetry({ applications, notifier, clock: later, policy: POLICY, send: true, includeUncertain: true });
    mark('after heal: retry run END', { results: retried.results });
    const rcptAfterRetry = server.counter.rcptTo(target);
    const lookupReads = timeline.filter((entry) => entry.event === 'command' && entry.actor === 'sender' && entry.collection?.startsWith('recipient_suppression') && entry.t >= (timeline.find((item) => item.event === 'sender: suppression lookup START')?.t ?? Infinity));
    evidence('SP-1 EVIDENCE', {
      claimedApplication: String(claimed),
      gateDecision: instrumented.decisions[0],
      rcptToTarget: { before: rcptBefore, after: rcptAfter },
      lookupServedBy: [...new Set(lookupReads.map((entry) => entry.node))],
      lookupReadConcern: [...new Set(lookupReads.map((entry) => entry.readConcern))],
      membersAtDecision: decisionSnapshot,
      afterHeal: {
        storedOnMajority: acknowledgementAfterHeal && { status: acknowledgementAfterHeal.status, attemptCount: acknowledgementAfterHeal.attemptCount, lastErrorCode: acknowledgementAfterHeal.lastErrorCode ?? null },
        retryDue: retried.due, retryResults: retried.results, gateDecision: retryGate.decisions[0] ?? null, rcptToTarget: rcptAfterRetry },
      timeline,
    });
    expect(lookupReads.length).toBeGreaterThan(0);
    expect(new Set(lookupReads.map((entry) => entry.node))).toEqual(new Set(['A'])); // served by the stale former primary
    expect(rcptAfter).toBe(rcptBefore); // ZERO SMTP submissions for the suppressed recipient
    expect(instrumented.decisions[0].decision).not.toBe('PROCEED');
    // r6 (§9.8): the lookup was sent linearizable and failed closed — deferred before SMTP, not a stale PROCEED.
    expect(new Set(lookupReads.map((entry) => entry.readConcern))).toEqual(new Set(['linearizable']));
    expect(instrumented.decisions[0].errorCode).toBe('SUPPRESSION_CHECK_UNAVAILABLE');
    // …and once healed, the deferred acknowledgement ends SUPPRESSED — still zero submissions.
    expect(retryGate.decisions.map((decision) => decision.decision)).toEqual(['SUPPRESSED']);
    expect(rcptAfterRetry).toBe(rcptBefore);
  }, 300_000);

  it('SP-2 the retry path, claim attempted DURING the partition on the stale primary → zero SMTP submissions', async (context) => {
    if (!ENABLED) return context.skip(NOT_RUN);
    const keyring = createKeyring({ current: { keyId: 'k1', key: crypto.randomBytes(32) } });
    const majority = majorityOperations(keyring);
    await majority.keyRegister({ keyId: 'k1', apply: true, actor: OPERATOR });
    const target = address('sp2');
    const plain = suppressionApp({ server, intake: env.intake, gate: senderGate(keyring).gate, log: env.log });
    opened.push(plain);
    refuse(target, 550, '5.1.1 Mailbox unavailable (QA)');
    const refused = await applyAs(plain.app, target);
    refuse(target, 451, '4.3.0 Temporary failure (QA)');
    const transient = await applyAs(plain.app, target); // its acknowledgement is FAILED / TRANSIENT: due for a retry
    server.refusals.clear(); // a retry that reached SMTP would now be ACCEPTED
    await waitHealthy();
    const rcptBefore = server.counter.rcptTo(target);
    const instrumented = senderGate(keyring);
    let report = null;
    try {
      const window = await openStaleWindow();
      expect((await majority.addFromRefusal({ applicationId: String(refused.id), evidenceRef: EVIDENCE, apply: true, actor: OPERATOR })).result).toBe('ADDED');
      mark('majority: suppression ADDED and majority-acknowledged');
      const before = await snapshot();
      expect(before.A.writable).toBe(true);
      expect(before[window.newPrimary].writable).toBe(true);
      mark('members before the retry run', { members: before });
      const applications = createApplicationRepository({ timeoutMs: 2_000 });
      const notifier = createApplicationNotifier({ applications, notifications: plain.notificationService, clock: () => new Date(Date.now() + 10 * 60_000), logger: env.log.logger, suppression: instrumented.gate });
      mark('sender: retry run START');
      report = await runNotificationRetry({ applications, notifier, clock: () => new Date(Date.now() + 10 * 60_000), policy: POLICY, send: true });
      mark('sender: retry run END', { results: report.results });
      mark('members after the retry run', { members: await snapshot() });
    } catch (error) {
      mark('sender: retry run FAILED', { error: error?.name });
    }
    const rcptAfter = server.counter.rcptTo(target);
    evidence('SP-2 EVIDENCE', { transientApplication: String(transient.id), report: report && { due: report.due, results: report.results }, gateDecisions: instrumented.decisions, rcptToTarget: { before: rcptBefore, after: rcptAfter }, timeline });
    expect(rcptAfter).toBe(rcptBefore); // ZERO SMTP submissions
  }, 240_000);

  it('SP-3 positive control on the healthy path: an unsuppressed address is acknowledged ONCE, its lookup served by the primary', async (context) => {
    if (!ENABLED) return context.skip(NOT_RUN);
    const keyring = createKeyring({ current: { keyId: 'k1', key: crypto.randomBytes(32) } });
    await majorityOperations(keyring).keyRegister({ keyId: 'k1', apply: true, actor: OPERATOR });
    const instrumented = senderGate(keyring);
    const plain = suppressionApp({ server, intake: env.intake, gate: instrumented.gate, log: env.log });
    opened.push(plain);
    const email = address('sp3');
    await applyAs(plain.app, email);
    const reads = timeline.filter((entry) => entry.event === 'command' && entry.actor === 'sender' && entry.collection?.startsWith('recipient_suppression'));
    evidence('SP-3 EVIDENCE', {
      gateDecision: instrumented.decisions[0],
      rcptTo: server.counter.rcptTo(email),
      messages: server.counter.messagesTo(email),
      lookupServedBy: [...new Set(reads.map((entry) => entry.node))],
      lookupReadConcern: [...new Set(reads.map((entry) => entry.readConcern))],
      lookupReads: reads.map(({ command, collection, node, readConcern, outcome, durationMs }) => ({ command, collection, node, readConcern, outcome, durationMs })),
      members: await snapshot(),
    });
    expect(instrumented.decisions[0].decision).toBe('PROCEED');
    expect(server.counter.rcptTo(email)).toBe(1);
    expect(server.counter.messagesTo(email)).toBe(1);
    expect(new Set(reads.map((entry) => entry.node))).toEqual(new Set(['A']));
    expect(new Set(reads.map((entry) => entry.readConcern))).toEqual(new Set(['linearizable'])); // r6 (§9.8)
  }, 240_000);
});
