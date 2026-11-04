import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import crypto, { randomUUID } from 'node:crypto';
import { ALIAS_QUIET_PERIOD_MS, MAX_HISTORY, RecipientSuppression } from '../../src/models/RecipientSuppression.js';
import { createKeyring } from '../../src/modules/suppression/suppressionKeys.js';
import { createSuppressionGate } from '../../src/modules/suppression/suppressionGate.js';
import { SuppressionWriteUnknown } from '../../src/modules/suppression/suppressionRegister.js';
import { QA_OPERATOR, realSuppression } from './fixtures/suppression.js';
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
 * B7 r3 review corrections (design rev 8.2), against the REAL register in a
 * disposable MongoDB, the REAL SMTP adapter and a LOCAL SMTP submission
 * counter; synthetic data and keys only.
 *
 *   SUP-24  a consistent authorisation view under key migration: for every
 *           sender keyring, every order of the two send-path reads and a key
 *           move or alias prune placed EXACTLY between them, a suppressed
 *           address is never acknowledged (zero submissions);
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
const LATER = () => new Date(Date.now() + ALIAS_QUIET_PERIOD_MS + 60_000);

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

/**
 * A sender gate whose two send-path reads run in a FIXED order with `between`
 * executed exactly between them (once): the controlled interleaving.
 */
function steeredGate(register, keyring, order, between, probe = {}) {
  let fired = false;
  const steered = {
    readCoverageInputs: register.readCoverageInputs,
    async readForAcknowledgement({ pairs }) {
      const first = order === 'coverage-first' ? await register.readCoverageInputs() : { match: await register.findActiveMatch(pairs) };
      if (!fired) {
        fired = true;
        probe.ran = true;
        await between();
      }
      const second = order === 'coverage-first' ? { match: await register.findActiveMatch(pairs) } : await register.readCoverageInputs();
      return { ...first, ...second };
    },
  };
  return createSuppressionGate({ register: steered, keyring });
}

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

describe('SUP-24 — a consistent authorisation view under key migration (rev 8.2)', () => {
  const SENDERS = ['old {k1}', 'both {k2,k1}', 'new {k2}'];
  const ORDERS = ['coverage-first', 'match-first'];
  const STEPS = ['move k1→k2 between the reads', 'move k1→k2 and an immediate prune attempt between the reads', 'prune the k1 alias between the reads'];
  const cases = SENDERS.flatMap((sender) => ORDERS.flatMap((order) => STEPS.map((step) => [sender, order, step])));

  it.each(cases)('sender %s, %s, %s → never PROCEED for a suppressed address; zero acknowledgement submissions', async (sender, order, step) => {
    const K1 = bytes();
    const K2 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const target = await suppress(w1, 'sup24');
    const operator = world(['k2', K2], [['k1', K1]]);
    await operator.registerKey('k2');
    if (step.startsWith('prune')) {
      expect(await operator.rekey()).toMatchObject({ moved: 1 }); // moved long before; its alias is pruned between the reads
    }
    const pruner = world(['k2', K2], [['k1', K1]], { clock: LATER });
    const steps = [];
    const between = step.startsWith('move')
      ? async () => {
          steps.push(await operator.rekey());
          if (step.includes('immediate prune')) steps.push(await operator.rekey()); // the alias is too recent to prune
        }
      : async () => steps.push(await pruner.rekey());
    const senderRing =
      sender === 'old {k1}'
        ? createKeyring({ current: { keyId: 'k1', key: K1 } })
        : sender === 'both {k2,k1}'
          ? createKeyring({ current: { keyId: 'k2', key: K2 }, previous: [{ keyId: 'k1', key: K1 }] })
          : createKeyring({ current: { keyId: 'k2', key: K2 } });
    const probe = {};
    const senderWorld = world(['k2', K2], [], { gate: steeredGate(operator.register, senderRing, order, between, probe) });
    const rcptBefore = server.counter.rcptTo(target.email);
    const application = await senderWorld.apply(target.email);
    expect(application.response.status).toBe(201);
    expect(server.counter.rcptTo(target.email)).toBe(rcptBefore); // zero submissions for the suppressed address
    expect(server.counter.messagesTo(target.email)).toBe(0);
    const ack = (await channels(application.id)).candidateAcknowledgement;
    expect(['RECIPIENT_SUPPRESSED', 'SUPPRESSION_COVERAGE_INCOMPLETE']).toContain(ack.lastErrorCode);
    expect(ack.status).toBe('FAILED');
    // The interleaving really happened, and the step did what it says.
    expect(probe.ran).toBe(true);
    if (step.startsWith('prune')) expect(steps).toEqual([expect.objectContaining({ aliasesPruned: 1 })]);
    else expect(steps[0]).toMatchObject({ moved: 1 });
    const stored = await RecipientSuppression.findById(target.suppressionId).lean();
    expect(stored).toMatchObject({ state: 'ACTIVE', lookup: { keyId: 'k2' } });
    expect(stored.lookups.map((item) => item.keyId).sort()).toEqual(step.startsWith('prune') ? ['k2'] : ['k1', 'k2']);
  });

  it.each(ORDERS)('control (%s): the same steered gate DOES acknowledge an address that is not suppressed — the zero above is not vacuous', async (order) => {
    const K1 = bytes();
    const K2 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    await suppress(w1, 'sup24other');
    const operator = world(['k2', K2], [['k1', K1]]);
    await operator.registerKey('k2');
    const probe = {};
    const senderRing = createKeyring({ current: { keyId: 'k2', key: K2 }, previous: [{ keyId: 'k1', key: K1 }] });
    const between = async () => expect(await operator.rekey()).toMatchObject({ moved: 1 });
    const senderWorld = world(['k2', K2], [], { gate: steeredGate(operator.register, senderRing, order, between, probe) });
    const email = address('sup24free');
    const application = await senderWorld.apply(email);
    expect(application.response.status).toBe(201);
    expect(probe.ran).toBe(true);
    expect((await channels(application.id)).candidateAcknowledgement).toMatchObject({ status: 'SENT' });
    expect(server.counter.rcptTo(email)).toBe(1);
  });

  it('the move keeps the old lookup as an alias and the prune removes only aliases older than the quiet period', async () => {
    const K1 = bytes();
    const K2 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const target = await suppress(w1, 'sup24alias');
    const operator = world(['k2', K2], [['k1', K1]]);
    await operator.registerKey('k2');
    await operator.rekey();
    const moved = await RecipientSuppression.findById(target.suppressionId).lean();
    expect(moved.lookup.keyId).toBe('k2');
    expect(moved.lookups.map((item) => [item.keyId, item.retiredAt === null])).toEqual([['k1', false], ['k2', true]]);
    expect(await operator.rekey()).toMatchObject({ moved: 0, aliasesPruned: 0, aliasesPrunable: 0 }); // too recent
    expect((await world(['k2', K2], [['k1', K1]], { clock: LATER }).rekey({ apply: false })).aliasesPrunable).toBe(1);
    expect(await world(['k2', K2], [['k1', K1]], { clock: LATER }).rekey()).toMatchObject({ aliasesPruned: 1 });
    const pruned = await RecipientSuppression.findById(target.suppressionId).lean();
    expect(pruned.lookups.map((item) => item.keyId)).toEqual(['k2']);
    expect(pruned.history.map((item) => item.action)).toEqual(['ADD', 'REKEY']); // pruning writes no history
    // Only now may k1 be retired from configuration.
    const coverage = await operator.ops.coverage();
    expect(coverage.keys.find((key) => key.keyId === 'k1')).toMatchObject({ activeEntries: 0, aliasEntries: 0, safeToRetire: true });
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
    expect(await world(['k2', K2], [['k1', K1]], { clock: LATER }).rekey()).toMatchObject({ aliasesPruned: 1 });
    const pruned = await RecipientSuppression.findById(target.suppressionId).lean();
    expect(pruned.history).toEqual(moved.history);
    expect(pruned.lookups.map((item) => item.keyId)).toEqual(['k2']);
    // Any recorded action is still refused at the cap.
    await expect(operator.ops.lift({ suppressionId: target.suppressionId, reason: 'ADDRESS_CONFIRMED_VALID', evidenceRef: EVIDENCE, apply: true, actor: QA_OPERATOR })).rejects.toMatchObject({ code: 'HISTORY_CAP_REACHED' });
  });
});
