import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import crypto, { randomUUID } from 'node:crypto';
import { MAX_HISTORY, PRUNE_SEQUENCE_COLLECTION, RecipientSuppression } from '../../src/models/RecipientSuppression.js';
import { createKeyring } from '../../src/modules/suppression/suppressionKeys.js';
import { createSuppressionGate } from '../../src/modules/suppression/suppressionGate.js';
import { createSuppressionRegister, SuppressionWriteUnknown } from '../../src/modules/suppression/suppressionRegister.js';
import { createApplicationRepository } from '../../src/modules/applications/application.repository.js';
import { createApplicationNotifier, runNotificationRetry, staleAfterMs } from '../../src/modules/applications/application.notifications.js';
import { QA_OPERATOR, realSuppression } from './fixtures/suppression.js';
import { steeredRegister } from './fixtures/suppressionInterleave.js';
import {
  applyAs,
  channels,
  clearAll,
  connectAndIndex,
  failPoint,
  failPointOff,
  failPointsAvailable,
  newEnvironment,
  publishedJob,
  startSubmissionServer,
  suppressionApp,
} from './fixtures/suppressionHarness.js';
import { requireTestDatabase } from './testDatabase.js';

/**
 * B7 r3 / r4 review corrections (design rev 8.2, rev 8.3), against the REAL
 * register in a disposable MongoDB, the REAL SMTP adapter and a LOCAL SMTP
 * submission counter; synthetic data and keys only.
 *
 *   SUP-24  a consistent authorisation view under key migration: for every
 *           sender keyring, every order of the two send-path reads and a key
 *           move and / or alias prune placed EXACTLY between them — through the
 *           REAL `readForAcknowledgement` (tests/db/fixtures/suppressionInterleave.js
 *           only delays when its queries start) — a suppressed address is never
 *           acknowledged (zero submissions);
 *   SUP-24b the exact r3 regression (clock skew; a late move; a move the server
 *           really applies late): no clock or delay can permit a submission;
 *   SUP-25  bounded, resumable rekey / recover-key passes: an unresolved
 *           prefix longer than the batch never holds later entries back;
 *           interruption and resumption;
 *   SUP-13b the duplicate-report path honours the history cap.
 */
const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const EVIDENCE = 'REV-2026-11-04-03';
const DECISION = 'OD-2026-11-04-97';
const address = (label) => `qa.${label}.${randomUUID().slice(0, 8)}@qa-valida.example.test`;
const bytes = () => crypto.randomBytes(32);
const logLines = () => env.log.lines.flatMap((chunk) => String(chunk).split('\n')).filter(Boolean).map((line) => JSON.parse(line));
const POLICY = Object.freeze({ maxAttempts: 5, baseDelayMs: 60_000, staleMs: staleAfterMs({ notificationTimeoutMs: 10_000, databaseTimeoutMs: 5_000 }) });
const MINUTE = 60_000;

let server;
let env;
let hasFailPoints;
const opened = [];

function world(current, previous = [], { clock, gate } = {}) {
  const keyring = createKeyring({
    current: current ? { keyId: current[0], key: current[1] } : null,
    previous: previous.map(([keyId, key]) => ({ keyId, key })),
  });
  const suppression = realSuppression({ keyring, ...(clock ? { clock } : {}) });
  const fixture = suppressionApp({ server, intake: env.intake, gate: gate ?? suppression.gate, log: env.log });
  opened.push(fixture);
  const as = (overrides) => ({ apply: true, actor: QA_OPERATOR, ...overrides });
  return {
    keyring,
    register: suppression.register,
    ops: suppression.operations,
    apply: (email) => applyAs(fixture.app, email),
    registerKey: (keyId) => suppression.operations.keyRegister(as({ keyId })),
    addRefusal: (id) => suppression.operations.addFromRefusal(as({ applicationId: String(id), evidenceRef: EVIDENCE })),
    rekey: (overrides) => suppression.operations.rekey(as(overrides)),
    recover: (overrides) => suppression.operations.recoverKey(as({ decisionRef: DECISION, evidenceRef: EVIDENCE, confirmKeyUnavailable: true, ...overrides })),
  };
}

async function suppress(w, label) {
  const email = address(label);
  server.refusals.set(email.toLowerCase(), { code: 550, text: '5.1.1 Mailbox unavailable (QA)' });
  const first = await w.apply(email);
  const added = await w.addRefusal(first.id);
  expect(added.result).toBe('ADDED');
  server.refusals.delete(email.toLowerCase());
  return { email, first, suppressionId: added.suppressionId };
}

/** A source-less ACTIVE entry under `keyId` (an unresolved record for rekey / recover-key). */
async function sourcelessEntry(keyring, keyId) {
  const entry = new RecipientSuppression({
    lookup: { keyId, digest: keyring.digestUnder(keyId, address('ghost')) },
    scope: 'APPLICATION_ACKNOWLEDGEMENT',
    state: 'ACTIVE',
    reason: 'INVALID_RECIPIENT_CONFIRMED',
    basis: { kind: 'RELAY_REFUSAL', statusCode: '5.1.1', evidenceRef: EVIDENCE },
    sources: [],
    history: [{ at: new Date(), action: 'ADD', actor: QA_OPERATOR, reason: 'INVALID_RECIPIENT_CONFIRMED', evidenceRef: EVIDENCE }],
  });
  await entry.save();
  return String(entry._id);
}

/** A sender: the real app with the real gate over a STEERED real register (fixed read order, `between` exactly between). */
function steeredSender(keyring, order, between, probe) {
  return world(['k2', crypto.randomBytes(32)], [], { gate: createSuppressionGate({ register: steeredRegister({ order, between, probe }), keyring }) });
}
const unavailableReasons = () => logLines().filter((line) => line.event === 'notification_suppression_check_unavailable').map((line) => line.reason);

beforeAll(async () => {
  await connectAndIndex(TEST_URI, TEST_DATABASE);
  server = await startSubmissionServer();
  hasFailPoints = await failPointsAvailable();
}, 30_000);
afterAll(async () => {
  await clearAll(TEST_DATABASE);
  await server.local.stop();
  await mongoose.disconnect();
}, 30_000);
beforeEach(async () => {
  await clearAll(TEST_DATABASE);
  await publishedJob();
  env = await newEnvironment();
  server.refusals.clear();
});
afterEach(async () => {
  await failPointOff();
  while (opened.length) await opened.pop().transport.close?.();
  await env.intake.cleanup();
});

describe('SUP-24 — a consistent authorisation view under key migration (rev 8.2, rev 8.3; the real send-path read)', () => {
  const SENDERS = ['old {k1}', 'both {k2,k1}', 'new {k2}'];
  const ORDERS = ['coverage-first', 'match-first'];
  const STEPS = ['move k1→k2 between the reads', 'move k1→k2 and an immediate prune between the reads', 'prune the k1 alias between the reads'];
  const cases = SENDERS.flatMap((sender) => ORDERS.flatMap((order) => STEPS.map((step) => [sender, order, step])));
  const ringFor = (sender, K1, K2) =>
    sender === 'old {k1}'
      ? createKeyring({ current: { keyId: 'k1', key: K1 } })
      : sender === 'both {k2,k1}'
        ? createKeyring({ current: { keyId: 'k2', key: K2 }, previous: [{ keyId: 'k1', key: K1 }] })
        : createKeyring({ current: { keyId: 'k2', key: K2 } });

  it.each(cases)('sender %s, %s, %s → never PROCEED for a suppressed address; zero acknowledgement submissions', async (sender, order, step) => {
    const K1 = bytes();
    const K2 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const target = await suppress(w1, 'sup24');
    const operator = world(['k2', K2], [['k1', K1]]);
    await operator.registerKey('k2');
    if (step.startsWith('prune')) expect(await operator.rekey()).toMatchObject({ moved: 1 }); // moved before the check began
    const steps = [];
    const between = async () => {
      steps.push(await operator.rekey()); // a move, or (for "prune") the prune of the earlier move's alias
      if (step.includes('immediate prune')) steps.push(await operator.rekey()); // rev 8.3: no waiting period — it prunes at once
    };
    const probe = {};
    const senderWorld = steeredSender(ringFor(sender, K1, K2), order, between, probe);
    const rcptBefore = server.counter.rcptTo(target.email);
    const application = await senderWorld.apply(target.email);
    expect(application.response.status).toBe(201);
    expect(server.counter.rcptTo(target.email)).toBe(rcptBefore); // zero submissions for the suppressed address
    expect(server.counter.messagesTo(target.email)).toBe(0);
    const ack = (await channels(application.id)).candidateAcknowledgement;
    expect(ack.status).toBe('FAILED');
    expect(['RECIPIENT_SUPPRESSED', 'SUPPRESSION_COVERAGE_INCOMPLETE', 'SUPPRESSION_CHECK_UNAVAILABLE']).toContain(ack.lastErrorCode);
    // An UNAVAILABLE outcome here is the rev 8.3 stability check — never a timeout or a failed read.
    expect(unavailableReasons()).toEqual(ack.lastErrorCode === 'SUPPRESSION_CHECK_UNAVAILABLE' ? ['REGISTER_CHANGED'] : []);
    // The interleaving really happened through the real register, and each step did what it says.
    expect(probe.error).toBeNull();
    expect(probe.ran).toBe(true);
    const between_ = probe.order.indexOf('between');
    if (order === 'coverage-first') {
      expect(between_).toBeGreaterThan(Math.max(probe.order.indexOf('coverage-ids'), probe.order.indexOf('coverage-keys')));
      expect(probe.order.indexOf('match')).toBeGreaterThan(between_);
    } else {
      expect(between_).toBeGreaterThan(probe.order.indexOf('match'));
      expect(Math.min(probe.order.indexOf('coverage-ids'), probe.order.indexOf('coverage-keys'))).toBeGreaterThan(between_);
    }
    if (step.startsWith('prune')) expect(steps).toEqual([expect.objectContaining({ moved: 0, aliasesPruned: 1 })]);
    else expect(steps[0]).toMatchObject({ moved: 1 });
    if (step.includes('immediate prune')) expect(steps[1]).toMatchObject({ aliasesPruned: 1 });
    const stored = await RecipientSuppression.findById(target.suppressionId).lean();
    expect(stored).toMatchObject({ state: 'ACTIVE', lookup: { keyId: 'k2' } });
    expect(stored.lookups.map((item) => item.keyId).sort()).toEqual(step === STEPS[0] ? ['k1', 'k2'] : ['k2']);
  });

  it.each(ORDERS)('positive control (%s): with a key MOVE of another entry between the reads, the same real path DOES acknowledge an unsuppressed address — the zero above is not vacuous', async (order) => {
    const K1 = bytes();
    const K2 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    await suppress(w1, 'sup24other');
    const operator = world(['k2', K2], [['k1', K1]]);
    await operator.registerKey('k2');
    const probe = {};
    const between = async () => expect(await operator.rekey()).toMatchObject({ moved: 1 });
    const senderWorld = steeredSender(createKeyring({ current: { keyId: 'k2', key: K2 }, previous: [{ keyId: 'k1', key: K1 }] }), order, between, probe);
    const email = address('sup24free');
    const application = await senderWorld.apply(email);
    expect(application.response.status).toBe(201);
    expect(probe.error).toBeNull();
    expect(probe.ran).toBe(true);
    expect((await channels(application.id)).candidateAcknowledgement).toMatchObject({ status: 'SENT' });
    expect(server.counter.rcptTo(email)).toBe(1);
    expect(server.counter.messagesTo(email)).toBe(1);
  });

  it('cost and recovery: an alias PRUNE of another entry between the reads defers an unsuppressed acknowledgement (TRANSIENT, REGISTER_CHANGED, zero sent); the normal retry re-checks and sends it once', async () => {
    const K1 = bytes();
    const K2 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    await suppress(w1, 'sup24cost');
    const operator = world(['k2', K2], [['k1', K1]]);
    await operator.registerKey('k2');
    expect(await operator.rekey()).toMatchObject({ moved: 1 });
    const probe = {};
    const ring = createKeyring({ current: { keyId: 'k2', key: K2 }, previous: [{ keyId: 'k1', key: K1 }] });
    const senderWorld = steeredSender(ring, 'coverage-first', async () => expect(await operator.rekey()).toMatchObject({ aliasesPruned: 1 }), probe);
    const email = address('sup24deferred');
    const application = await senderWorld.apply(email);
    expect(application.response.status).toBe(201);
    expect(probe.error).toBeNull();
    expect((await channels(application.id)).candidateAcknowledgement).toMatchObject({ status: 'FAILED', lastErrorCode: 'SUPPRESSION_CHECK_UNAVAILABLE' });
    expect(unavailableReasons()).toEqual(['REGISTER_CHANGED']);
    expect(server.counter.rcptTo(email)).toBe(0);
    // The normal (automatic) retry, through the real, unsteered register: a fresh, stable check → sent once.
    const gate = createSuppressionGate({ register: createSuppressionRegister({ timeoutMs: 5_000, writeTimeoutMs: 5_000 }), keyring: ring });
    const retryFixture = suppressionApp({ server, intake: env.intake, gate, log: env.log });
    opened.push(retryFixture);
    const notifier = createApplicationNotifier({ applications: createApplicationRepository({ timeoutMs: 5_000 }), notifications: retryFixture.notificationService, clock: () => new Date(Date.now() + 10 * MINUTE), logger: env.log.logger, suppression: gate });
    const report = await runNotificationRetry({ applications: createApplicationRepository({ timeoutMs: 5_000 }), notifier, clock: () => new Date(Date.now() + 10 * MINUTE), policy: POLICY, send: true });
    expect(report.results.SENT).toBe(1);
    expect((await channels(application.id)).candidateAcknowledgement).toMatchObject({ status: 'SENT', attemptCount: 2 });
    expect(server.counter.rcptTo(email)).toBe(1);
  });

  it('the move keeps the old lookup as an alias; the next run prunes it at once whatever the operator clocks, stamping a strictly increasing prune sequence', async () => {
    const K1 = bytes();
    const K2 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const target = await suppress(w1, 'sup24alias');
    const other = await suppress(w1, 'sup24alias2');
    const operator = world(['k2', K2], [['k1', K1]], { clock: () => new Date(Date.now() - 11 * MINUTE) });
    await operator.registerKey('k2');
    expect(await operator.rekey()).toMatchObject({ moved: 2, aliasesPruned: 0 });
    const moved = await RecipientSuppression.findById(target.suppressionId).lean();
    expect(moved).toMatchObject({ lookup: { keyId: 'k2' }, pruneSeq: 0 });
    expect(moved.lookups.map((item) => [item.keyId, item.retiredAt === null])).toEqual([['k1', false], ['k2', true]]);
    expect((await operator.rekey({ apply: false })).aliasesPrunable).toBe(2); // the dry run reports, writes nothing
    expect((await RecipientSuppression.findById(target.suppressionId).lean()).lookups).toHaveLength(2);
    // A different operator, clock 11 minutes AHEAD: no clock decides anything any more.
    expect(await world(['k2', K2], [['k1', K1]], { clock: () => new Date(Date.now() + 11 * MINUTE) }).rekey()).toMatchObject({ aliasesPruned: 2 });
    const [a, b] = await Promise.all([target, other].map((item) => RecipientSuppression.findById(item.suppressionId).lean()));
    for (const pruned of [a, b]) {
      expect(pruned.lookups.map((item) => item.keyId)).toEqual(['k2']);
      expect(pruned.history.map((item) => item.action)).toEqual(['ADD', 'REKEY']); // pruning writes no history
    }
    expect([a.pruneSeq, b.pruneSeq].sort()).toEqual([1, 2]); // fresh, distinct values from the one counter
    expect(await mongoose.connection.db.collection(PRUNE_SEQUENCE_COLLECTION).findOne({})).toMatchObject({ _id: 'alias-prune', value: 2 });
    const coverage = await operator.ops.coverage();
    expect(coverage.keys.find((key) => key.keyId === 'k1')).toMatchObject({ activeEntries: 0, aliasEntries: 0, safeToRetire: true });
  });

  it('a stored prune stamp never goes back: a save that lowers it is refused by validation and nothing is written', async () => {
    const K1 = bytes();
    const K2 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const target = await suppress(w1, 'sup24mono');
    const operator = world(['k2', K2], [['k1', K1]]);
    await operator.registerKey('k2');
    await operator.rekey();
    await operator.rekey();
    const entry = await RecipientSuppression.findById(target.suppressionId);
    expect(entry.pruneSeq).toBe(1);
    const before = JSON.stringify(entry.toObject());
    entry.pruneSeq = 0;
    await expect(entry.save()).rejects.toThrow(/pruneSeq never decreases/);
    expect(JSON.stringify((await RecipientSuppression.findById(target.suppressionId)).toObject())).toBe(before);
  });

  it('the counter is raised above the highest stored stamp: a lost counter document never hands out a value already in use', async () => {
    const K1 = bytes();
    const K2 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const first = await suppress(w1, 'sup24seq1');
    const second = await suppress(w1, 'sup24seq2');
    const operator = world(['k2', K2], [['k1', K1]]);
    await operator.registerKey('k2');
    await operator.rekey({ limit: 1 }); // moves the first only
    expect(await operator.rekey()).toMatchObject({ aliasesPruned: 1, moved: 1 }); // prunes the first (stamp 1), moves the second
    expect((await RecipientSuppression.findById(first.suppressionId).lean()).pruneSeq).toBe(1);
    await mongoose.connection.db.collection(PRUNE_SEQUENCE_COLLECTION).deleteMany({}); // the counter is lost (for example a partial restore)
    expect(await operator.rekey()).toMatchObject({ aliasesPruned: 1 });
    expect((await RecipientSuppression.findById(second.suppressionId).lean()).pruneSeq).toBe(2); // above the stored 1, not 1 again
  });
});

describe('SUP-24b — the exact r3 regression: clock skew and a late move (real register, real send path)', () => {
  /**
   * An old-key sender ({k1}) reads coverage; operator A moves the ACTIVE
   * suppression k1 → k2; operator B immediately attempts pruning; then the
   * sender reads the match. On r3 the prune's decision used operator clocks
   * (retiredAt stamped by A, compared by B), so B's clock 11 minutes ahead —
   * or A's stamp 11 minutes older than the move becoming visible — let the
   * alias be removed inside the sender's read window.
   */
  const SKEWS = [
    ['operator B clock 11 minutes AHEAD', { a: 0, b: 11 * MINUTE }],
    ['operator A clock 11 minutes BEHIND (its move becomes visible 11 minutes after its stamp)', { a: -11 * MINUTE, b: 0 }],
  ];

  it.each(SKEWS)('%s → zero acknowledgement submissions for the suppressed address', async (_label, skew) => {
    const K1 = bytes();
    const K2 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const target = await suppress(w1, 'sup24b');
    const setup = world(['k2', K2], [['k1', K1]]);
    await setup.registerKey('k2');
    const operatorA = world(['k2', K2], [['k1', K1]], { clock: () => new Date(Date.now() + skew.a) });
    const operatorB = world(['k2', K2], [['k1', K1]], { clock: () => new Date(Date.now() + skew.b) });
    const steps = [];
    const between = async () => {
      steps.push(await operatorA.rekey()); // A: move k1 → k2
      steps.push(await operatorB.rekey()); // B: the immediate prune attempt
    };
    const probe = {};
    const sender = steeredSender(createKeyring({ current: { keyId: 'k1', key: K1 } }), 'coverage-first', between, probe);
    const rcptBefore = server.counter.rcptTo(target.email);

    const application = await sender.apply(target.email);

    expect(application.response.status).toBe(201);
    expect(server.counter.rcptTo(target.email)).toBe(rcptBefore); // ZERO submissions for the suppressed address
    expect(server.counter.messagesTo(target.email)).toBe(0);
    const ack = (await channels(application.id)).candidateAcknowledgement;
    expect(ack.status).toBe('FAILED');
    // The ordering really happened: coverage (pre-move: only k1) → A's move → B's prune → match (k1 gone).
    expect(probe.error).toBeNull();
    expect(probe.coverageKeyIds).toEqual(['k1']);
    expect(probe.order.indexOf('between')).toBeGreaterThan(Math.max(probe.order.indexOf('coverage-ids'), probe.order.indexOf('coverage-keys')));
    expect(probe.order.indexOf('match')).toBeGreaterThan(probe.order.indexOf('between'));
    expect(probe.matched).toBe(false);
    expect(steps[0]).toMatchObject({ moved: 1 });
    expect(steps[1]).toMatchObject({ aliasesPruned: 1 });
    const stored = await RecipientSuppression.findById(target.suppressionId).lean();
    expect(stored).toMatchObject({ state: 'ACTIVE', lookup: { keyId: 'k2' } });
    expect(stored.lookups.map((item) => item.keyId)).toEqual(['k2']);
    // Refused because the register changed inside the read window — never PROCEED.
    expect(ack.lastErrorCode).toBe('SUPPRESSION_CHECK_UNAVAILABLE');
    expect(unavailableReasons()).toEqual(['REGISTER_CHANGED']);
  });

  it('a move the SERVER applies late (fail point holds the write) while the sender reads coverage; then B (clock 11 minutes ahead) prunes at once; then the match → zero submissions', async (context) => {
    if (!hasFailPoints) return context.skip('NOT RUN: mongod without enableTestCommands (failCommand fail point)');
    const K1 = bytes();
    const K2 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const target = await suppress(w1, 'sup24late');
    const setup = world(['k2', K2], [['k1', K1]]);
    await setup.registerKey('k2');
    const operatorA = world(['k2', K2], [['k1', K1]]);
    const operatorB = world(['k2', K2], [['k1', K1]], { clock: () => new Date(Date.now() + 11 * MINUTE) });
    // Hold A's next update (its move) at the server for 2.5 s, then let it apply normally.
    const admin = mongoose.connection.db.admin();
    const armed = await admin.command({ configureFailPoint: 'failCommand', mode: { times: 1 }, data: { failCommands: ['update'], blockConnection: true, blockTimeMS: 2_500 } });
    const moving = operatorA.rekey();
    await admin.command({ waitForFailPoint: 'failCommand', timesEntered: armed.count + 1, maxTimeMS: 10_000 });
    const steps = [];
    const between = async () => {
      steps.push(await moving); // A's late move has now become visible
      steps.push(await operatorB.rekey()); // B prunes at once
    };
    const probe = {};
    const sender = steeredSender(createKeyring({ current: { keyId: 'k1', key: K1 } }), 'coverage-first', between, probe);
    const rcptBefore = server.counter.rcptTo(target.email);
    const application = await sender.apply(target.email);
    expect(application.response.status).toBe(201);
    expect(server.counter.rcptTo(target.email)).toBe(rcptBefore);
    expect(server.counter.messagesTo(target.email)).toBe(0);
    expect(probe.error).toBeNull();
    expect(probe.coverageKeyIds).toEqual(['k1']); // coverage was read while the move was still held at the server
    expect(probe.matched).toBe(false);
    expect(steps[0]).toMatchObject({ moved: 1 });
    expect(steps[1]).toMatchObject({ aliasesPruned: 1 });
    expect((await channels(application.id)).candidateAcknowledgement).toMatchObject({ status: 'FAILED', lastErrorCode: 'SUPPRESSION_CHECK_UNAVAILABLE' });
    expect(unavailableReasons()).toEqual(['REGISTER_CHANGED']);
    expect((await RecipientSuppression.findById(target.suppressionId).lean()).lookups.map((item) => item.keyId)).toEqual(['k2']);
  });
});

describe('SUP-25 — bounded, resumable rekey and recover-key passes', () => {
  it('rekey: an unresolved prefix longer than the batch never holds later entries back; an interrupted pass resumes from its cursor; unresolved entries and history are preserved', async (context) => {
    const K1 = bytes();
    const K2 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const blocked = [];
    for (let index = 0; index < 6; index += 1) blocked.push(await sourcelessEntry(w1.keyring, 'k1'));
    const eligible = [];
    for (const label of ['sup25a', 'sup25b', 'sup25c']) eligible.push(await suppress(w1, label));
    const operator = world(['k2', K2], [['k1', K1]]);
    await operator.registerKey('k2');
    const before = JSON.stringify(await RecipientSuppression.find({ _id: { $in: blocked } }).sort({ _id: 1 }).lean());

    const first = await operator.rekey({ limit: 5 });
    expect(first).toMatchObject({ examined: 5, moved: 0, withoutSource: 5, nextAfter: blocked[4] });
    // Without the cursor the same prefix comes back; WITH it the pass reaches the eligible entries.
    expect(await operator.rekey({ limit: 5 })).toMatchObject({ examined: 5, moved: 0, nextAfter: blocked[4] });
    if (hasFailPoints) {
      // Interruption: the second move (and the driver's retry) is cut off.
      await failPoint({ failCommands: ['update'], closeConnection: true }, { skip: 1 });
      const interrupted = await operator.rekey({ limit: 5, after: blocked[4] }).catch((error) => error);
      await failPointOff();
      expect(interrupted).toBeInstanceOf(SuppressionWriteUnknown);
      expect(interrupted.resumeAfter).toBe(eligible[0].suppressionId); // the last entry fully handled
      expect(await operator.rekey({ limit: 5, after: interrupted.resumeAfter })).toMatchObject({ moved: 2, examined: 2, nextAfter: null });
    } else {
      context.annotate?.('interruption NOT RUN: mongod without enableTestCommands');
      expect(await operator.rekey({ limit: 5, after: blocked[4] })).toMatchObject({ moved: 3, nextAfter: null });
    }
    for (const target of eligible) {
      const entry = await RecipientSuppression.findById(target.suppressionId).lean();
      expect(entry.lookup.keyId).toBe('k2');
      expect(entry.history.filter((item) => item.action === 'REKEY')).toHaveLength(1);
    }
    expect(JSON.stringify(await RecipientSuppression.find({ _id: { $in: blocked } }).sort({ _id: 1 }).lean())).toBe(before);
    await expect(operator.rekey({ after: 'not-an-id' })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });

  it('recover-key: the same for a lost key — the unresolved prefix is preserved and reported, later entries move, an interruption resumes', async () => {
    const K1 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const blocked = [];
    for (let index = 0; index < 6; index += 1) blocked.push(await sourcelessEntry(w1.keyring, 'k1'));
    const eligible = [];
    for (const label of ['sup25r1', 'sup25r2', 'sup25r3']) eligible.push(await suppress(w1, label));
    const w2 = world(['k2', bytes()]);
    await w2.registerKey('k2');
    const first = await w2.recover({ keyId: 'k1', expectedCount: 9, reason: 'LOST', limit: 5 });
    expect(first).toMatchObject({ examined: 5, moved: 0, withoutSource: 5, nextAfter: blocked[4], activeEntriesLeft: 9 });
    if (hasFailPoints) {
      await failPoint({ failCommands: ['update'], closeConnection: true }, { skip: 1 });
      const interrupted = await w2.recover({ keyId: 'k1', limit: 5, after: blocked[4] }).catch((error) => error);
      await failPointOff();
      expect(interrupted).toBeInstanceOf(SuppressionWriteUnknown);
      expect(interrupted.resumeAfter).toBe(eligible[0].suppressionId);
      expect(await w2.recover({ keyId: 'k1', limit: 5, after: interrupted.resumeAfter })).toMatchObject({ moved: 2, nextAfter: null, activeEntriesLeft: 6 });
    } else {
      expect(await w2.recover({ keyId: 'k1', limit: 5, after: blocked[4] })).toMatchObject({ moved: 3, nextAfter: null, activeEntriesLeft: 6 });
    }
    for (const target of eligible) {
      const entry = await RecipientSuppression.findById(target.suppressionId).lean();
      expect(entry.lookup.keyId).toBe('k2');
      expect(entry.history.filter((item) => item.action === 'REKEY')).toEqual([expect.objectContaining({ reason: 'SOURCE_UNVERIFIED', decisionRef: DECISION })]);
    }
    expect(await RecipientSuppression.countDocuments({ _id: { $in: blocked }, state: 'ACTIVE', 'lookup.keyId': 'k1' })).toBe(6);
  });
});

describe('recover-key --complete prunes the lost key\'s aliases in bounded runs (rev 8.3: no waiting period)', () => {
  it('aliases beyond --limit → ALIASES_PENDING with what was pruned; the next run completes; sending stays blocked until then', async () => {
    const K1 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const first = await suppress(w1, 'supcomplete1');
    const second = await suppress(w1, 'supcomplete2');
    const w2 = world(['k2', bytes()]);
    await w2.registerKey('k2');
    expect(await w2.recover({ keyId: 'k1', expectedCount: 2, reason: 'LOST' })).toMatchObject({ moved: 2, activeEntriesLeft: 0 });
    await expect(w2.recover({ keyId: 'k1', complete: true, limit: 1 })).rejects.toMatchObject({ code: 'ALIASES_PENDING', details: { aliasEntries: 1, aliasesPruned: 1 } });
    const blocked = await w2.apply(address('supcompleteblocked'));
    expect((await channels(blocked.id)).candidateAcknowledgement.lastErrorCode).toBe('SUPPRESSION_COVERAGE_INCOMPLETE');
    expect(await w2.recover({ keyId: 'k1', complete: true, limit: 1 })).toMatchObject({ result: 'COMPLETED', keyState: 'RETIRED', aliasesPruned: 1, coverage: 'COVERAGE_COMPLETE' });
    for (const target of [first, second]) {
      const entry = await RecipientSuppression.findById(target.suppressionId).lean();
      expect(entry.lookups.map((item) => item.keyId)).toEqual(['k2']);
      expect(entry.pruneSeq).toBeGreaterThan(0);
      expect((await channels((await w2.apply(target.email)).id)).candidateAcknowledgement.lastErrorCode).toBe('RECIPIENT_SUPPRESSED');
    }
  });
});

describe('SUP-13b — the duplicate-report path honours the history cap (§3.1)', () => {
  it('near the cap a duplicate only increments duplicateReports; AT the cap it is refused and nothing is written', async () => {
    const w1 = world(['k1', bytes()]);
    await w1.registerKey('k1');
    const target = await suppress(w1, 'sup13b');
    const others = [];
    for (let index = 0; index < 2; index += 1) others.push((await w1.apply(target.email)).id); // suppressed Applications of the address
    const entry = await RecipientSuppression.findById(target.suppressionId);
    while (entry.history.length < MAX_HISTORY - 3) entry.history.push({ at: new Date(), action: 'DUPLICATE', actor: QA_OPERATOR, reason: 'INVALID_RECIPIENT_CONFIRMED', evidenceRef: EVIDENCE, decisionRef: null, requestId: null });
    await entry.save();
    const notice = (id) => w1.ops.addComplaint({ applicationId: String(id), kind: 'PROVIDER_NOTICE', evidenceRef: EVIDENCE, apply: true, actor: QA_OPERATOR });

    const nearCap = await notice(others[0]);
    expect(nearCap).toMatchObject({ result: 'DUPLICATE', sourceAdded: false, historyAdded: false });
    const afterNear = await RecipientSuppression.findById(target.suppressionId).lean();
    expect(afterNear).toMatchObject({ duplicateReports: 1 });
    expect(afterNear.history).toHaveLength(MAX_HISTORY - 3);
    expect(afterNear.sources).toHaveLength(1);

    const full = await RecipientSuppression.findById(target.suppressionId);
    while (full.history.length < MAX_HISTORY) full.history.push({ at: new Date(), action: 'DUPLICATE', actor: QA_OPERATOR, reason: 'INVALID_RECIPIENT_CONFIRMED', evidenceRef: EVIDENCE, decisionRef: null, requestId: null });
    await full.save();
    const atCap = JSON.stringify(await RecipientSuppression.findById(target.suppressionId).lean());
    await expect(w1.ops.addComplaint({ applicationId: String(others[1]), kind: 'PROVIDER_NOTICE', evidenceRef: EVIDENCE, apply: false })).rejects.toMatchObject({ code: 'HISTORY_CAP_REACHED' }); // the dry run says so too
    await expect(notice(others[1])).rejects.toMatchObject({ code: 'HISTORY_CAP_REACHED' });
    expect(JSON.stringify(await RecipientSuppression.findById(target.suppressionId).lean())).toBe(atCap);
    // The same source again is still a no-op answer, not a write.
    expect(await notice(target.first.id)).toMatchObject({ result: 'ALREADY_ACTIVE' });
  });

  it('a LIFTED entry at the cap is not re-applied (dry run and --apply refuse; nothing written)', async () => {
    const w1 = world(['k1', bytes()]);
    await w1.registerKey('k1');
    const target = await suppress(w1, 'sup13c');
    const entry = await RecipientSuppression.findById(target.suppressionId);
    while (entry.history.length < MAX_HISTORY - 1) entry.history.push({ at: new Date(), action: 'DUPLICATE', actor: QA_OPERATOR, reason: 'INVALID_RECIPIENT_CONFIRMED', evidenceRef: EVIDENCE, decisionRef: null, requestId: null });
    await entry.save();
    expect(await w1.ops.lift({ suppressionId: target.suppressionId, reason: 'ADDRESS_CONFIRMED_VALID', evidenceRef: EVIDENCE, apply: true, actor: QA_OPERATOR })).toMatchObject({ result: 'LIFTED' });
    const lifted = JSON.stringify(await RecipientSuppression.findById(target.suppressionId).lean());
    expect(JSON.parse(lifted).history).toHaveLength(MAX_HISTORY);
    const again = (await w1.apply(target.email)).id;
    for (const apply of [false, true]) {
      await expect(w1.ops.addComplaint({ applicationId: String(again), kind: 'PROVIDER_NOTICE', evidenceRef: EVIDENCE, apply, actor: QA_OPERATOR })).rejects.toMatchObject({ code: 'HISTORY_CAP_REACHED' });
    }
    expect(JSON.stringify(await RecipientSuppression.findById(target.suppressionId).lean())).toBe(lifted);
  });

  it('alias pruning records no history action, so it is not refused at the cap (rev 8.2): the history stays exactly as it was', async () => {
    const K1 = bytes();
    const K2 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const target = await suppress(w1, 'sup13d');
    const entry = await RecipientSuppression.findById(target.suppressionId);
    while (entry.history.length < MAX_HISTORY - 1) entry.history.push({ at: new Date(), action: 'DUPLICATE', actor: QA_OPERATOR, reason: 'INVALID_RECIPIENT_CONFIRMED', evidenceRef: EVIDENCE, decisionRef: null, requestId: null });
    await entry.save();
    const operator = world(['k2', K2], [['k1', K1]]);
    await operator.registerKey('k2');
    expect(await operator.rekey()).toMatchObject({ moved: 1 }); // the REKEY entry is the 20th
    const moved = await RecipientSuppression.findById(target.suppressionId).lean();
    expect(moved.history).toHaveLength(MAX_HISTORY);
    expect(await operator.rekey()).toMatchObject({ aliasesPruned: 1 });
    const pruned = await RecipientSuppression.findById(target.suppressionId).lean();
    expect(pruned.history).toEqual(moved.history);
    expect(pruned.lookups.map((item) => item.keyId)).toEqual(['k2']);
    // Any recorded action is still refused at the cap.
    await expect(operator.ops.lift({ suppressionId: target.suppressionId, reason: 'ADDRESS_CONFIRMED_VALID', evidenceRef: EVIDENCE, apply: true, actor: QA_OPERATOR })).rejects.toMatchObject({ code: 'HISTORY_CAP_REACHED' });
  });
});
