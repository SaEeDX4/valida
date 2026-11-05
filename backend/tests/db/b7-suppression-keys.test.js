import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import crypto, { randomUUID } from 'node:crypto';
import { RecipientSuppression, RecipientSuppressionKey } from '../../src/models/RecipientSuppression.js';
import { createApplicationRepository } from '../../src/modules/applications/application.repository.js';
import { createApplicationNotifier, runNotificationRetry, staleAfterMs } from '../../src/modules/applications/application.notifications.js';
import { createKeyring } from '../../src/modules/suppression/suppressionKeys.js';
import { SuppressionWriteUnknown } from '../../src/modules/suppression/suppressionRegister.js';
import { createSuppressionOperations } from '../../src/modules/suppression/suppressionOperations.js';
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
import { requireTestDatabase, assertConnectedToTestDatabase } from './testDatabase.js';

/**
 * B7 — key lifecycle, key-material integrity and controlled recovery:
 * SUP-16, SUP-18…SUP-23 (RECIPIENT_SUPPRESSION_DESIGN.md rev 8 §4.2, §4.4,
 * §4.5.1, §8; approved by OD-2026-11-04-02, including the SUP-21 correction:
 * releasing source-less entries never restores eligibility while a key is
 * RECOVERING). Real register in a disposable MongoDB; the real SMTP adapter
 * against a LOCAL SMTP TEST SERVER that counts submissions; SYNTHETIC key
 * bytes only, generated here.
 */
const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const POLICY = Object.freeze({ maxAttempts: 5, baseDelayMs: 60_000, staleMs: staleAfterMs({ notificationTimeoutMs: 10_000, databaseTimeoutMs: 5_000 }) });
const EVIDENCE = 'KEY-2026-11-04-01';
const DECISION = 'OD-2026-11-04-99';
const address = (label) => `qa.${label}.${randomUUID().slice(0, 8)}@qa-valida.example.test`;
const bytes = () => crypto.randomBytes(32);

let server;
let env;
let hasFailPoints;
const opened = [];

/** One configuration "world": a keyring, the real register and operations over it, and an app using it. */
function world(current, previous = [], { clock } = {}) {
  const keyring = createKeyring({
    current: current ? { keyId: current[0], key: current[1] } : null,
    previous: previous.map(([keyId, key]) => ({ keyId, key })),
  });
  const suppression = realSuppression({ keyring, ...(clock ? { clock } : {}) });
  const fixture = suppressionApp({ server, intake: env.intake, gate: suppression.gate, log: env.log });
  opened.push(fixture);
  const ops = suppression.operations;
  const as = (overrides) => ({ apply: true, actor: QA_OPERATOR, ...overrides });
  return {
    keyring,
    args: [current, previous],
    ops,
    gate: suppression.gate,
    register: suppression.register,
    app: fixture.app,
    notificationService: fixture.notificationService,
    apply: (email) => applyAs(fixture.app, email),
    registerKey: (keyId) => ops.keyRegister(as({ keyId })),
    addRefusal: (id) => ops.addFromRefusal(as({ applicationId: String(id), evidenceRef: EVIDENCE })),
    recover: (overrides) => ops.recoverKey(as({ decisionRef: DECISION, evidenceRef: EVIDENCE, confirmKeyUnavailable: true, ...overrides })),
    resolve: (overrides) => ops.resolveUnrecoverable(as({ decisionRef: DECISION, evidenceRef: EVIDENCE, confirmKeyUnavailable: true, ...overrides })),
    rekey: (overrides) => ops.rekey(as(overrides)),
    coverage: () => ops.coverage(),
    retry: (flags = {}) => {
      const later = () => new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      const notifier = createApplicationNotifier({ applications: createApplicationRepository({ timeoutMs: 5_000 }), notifications: fixture.notificationService, clock: later, logger: env.log.logger, suppression: suppression.gate });
      return runNotificationRetry({ applications: createApplicationRepository({ timeoutMs: 5_000 }), notifier, clock: later, policy: POLICY, send: true, ...flags });
    },
  };
}

/** An address refused 5.1.1 once and registered in world `w`: suppressed from now on. */
async function suppress(w, label, { sourceless = false } = {}) {
  const email = address(label);
  server.refusals.set(email.toLowerCase(), { code: 550, text: '5.1.1 Mailbox unavailable (QA)' });
  const first = await w.apply(email);
  expect(first.response.status).toBe(201);
  const added = await w.addRefusal(first.id);
  expect(added.result).toBe('ADDED');
  server.refusals.delete(email.toLowerCase());
  if (sourceless) {
    await w.ops.forget({ applicationId: String(first.id), reason: 'RETENTION', evidenceRef: EVIDENCE, apply: true, actor: QA_OPERATOR });
  }
  return { email, first, suppressionId: added.suppressionId };
}

const ackOf = async (id) => (await channels(id)).candidateAcknowledgement;
/** The register exactly as stored, for "nothing changed" assertions. */
const snapshot = async () => JSON.stringify(await RecipientSuppression.find({}).sort({ _id: 1 }).lean());

/** Applies a suppressed and an unsuppressed address and expects both acknowledgements BLOCKED (zero submissions). */
async function expectBlocked(w, suppressedEmail) {
  const unsuppressed = address('fresh');
  const rcptBefore = server.counter.totalRcpt();
  const hrBefore = server.counter.messagesTo('recruitment@qa-valida.example.test');
  for (const email of [suppressedEmail, unsuppressed]) {
    const application = await w.apply(email);
    expect(application.response.status).toBe(201);
    const state = await channels(application.id);
    expect(state.internal.status).toBe('SENT');
    expect(state.candidateAcknowledgement).toMatchObject({ status: 'FAILED', lastErrorCode: 'SUPPRESSION_COVERAGE_INCOMPLETE' });
  }
  expect(server.counter.totalRcpt() - rcptBefore).toBe(2); // the two internal notifications only
  expect(server.counter.messagesTo('recruitment@qa-valida.example.test') - hrBefore).toBe(2);
  expect(server.counter.rcptTo(unsuppressed)).toBe(0);
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

describe('SUP-16 — rotation without loss of coverage (verified rekey)', () => {
  it('old key verify-only: a k1 address is still suppressed; rekey moves every entry with a source; a second run changes nothing; source-less entries stay under k1, matched; k1 not safe to retire; nothing lifted', async () => {
    const K1 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const withSource = await suppress(w1, 'sup16a');
    const sourceless = await suppress(w1, 'sup16b', { sourceless: true });

    const w2 = world(['k2', bytes()], [['k1', K1]]);
    expect(await w2.registerKey('k2')).toEqual({ result: 'REGISTERED', keyId: 'k2' });
    expect((await ackOf((await w2.apply(withSource.email)).id)).lastErrorCode).toBe('RECIPIENT_SUPPRESSED');
    expect(server.counter.messagesTo(withSource.email)).toBe(0);
    const k1Before = (await w2.coverage()).keys.find((key) => key.keyId === 'k1');
    expect(k1Before).toMatchObject({ role: 'PREVIOUS', check: 'MATCH', activeEntries: 2, safeToRetire: false });

    expect(await w2.rekey({ apply: false })).toMatchObject({ result: 'DRY_RUN', wouldMove: 1, withoutSource: 1, moved: 0 });
    expect(await w2.rekey()).toMatchObject({ result: 'DONE', moved: 1, withoutSource: 1, digestMismatch: 0, conflict: 0, coverage: 'COVERAGE_COMPLETE' });
    expect(await w2.rekey()).toMatchObject({ moved: 0, withoutSource: 1 });
    expect((await RecipientSuppression.findById(withSource.suppressionId).lean()).lookup.keyId).toBe('k2');
    expect((await RecipientSuppression.findById(sourceless.suppressionId).lean()).lookup.keyId).toBe('k1');
    expect((await RecipientSuppression.findById(withSource.suppressionId).lean()).history.at(-1)).toMatchObject({ action: 'REKEY', reason: 'ROTATION' });
    for (const email of [withSource.email, sourceless.email]) expect((await ackOf((await w2.apply(email)).id)).lastErrorCode).toBe('RECIPIENT_SUPPRESSED');
    expect((await w2.coverage()).keys.find((key) => key.keyId === 'k1')).toMatchObject({ activeEntries: 1, safeToRetire: false });
    expect(await RecipientSuppression.countDocuments({ state: 'LIFTED' })).toBe(0);
    // Ordinary rotation never writes SOURCE_UNVERIFIED (SUP-23a).
    expect(await RecipientSuppression.countDocuments({ 'history.reason': 'SOURCE_UNVERIFIED' })).toBe(0);
  });
});


describe('SUP-18 / SUP-20 — a missing historical key blocks every acknowledgement; nothing is lifted', () => {
  it('SUP-18: verify-only key removed while ACTIVE entries remain (and a "lost" current key replaced) → blocked; register unchanged; restored → normal; blocked channels only with --include-configuration', async () => {
    const K1 = bytes();
    const K2 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const target = await suppress(w1, 'sup18');
    const before = await snapshot();

    // The lost current key replaced by a new one; k1 is no longer configured.
    const lost = world(['k2', K2]);
    await lost.registerKey('k2');
    const keyDocumentsBefore = await RecipientSuppressionKey.countDocuments({});
    const blockedSuppressed = await lost.apply(target.email);
    const blockedFresh = await lost.apply(address('sup18fresh'));
    for (const application of [blockedSuppressed, blockedFresh]) {
      expect(application.response.status).toBe(201);
      expect(await channels(application.id)).toMatchObject({ internal: { status: 'SENT' }, candidateAcknowledgement: { status: 'FAILED', lastErrorCode: 'SUPPRESSION_COVERAGE_INCOMPLETE' } });
    }
    expect(server.counter.rcptTo(target.email)).toBe(1); // only the original refusal
    expect((await lost.coverage()).problems).toEqual([{ keyId: 'k1', reason: 'KEY_NOT_CONFIGURED' }]);
    expect(await snapshot()).toBe(before);
    expect(await RecipientSuppressionKey.countDocuments({})).toBe(keyDocumentsBefore);

    // k1 restored (verify-only next to k2): normal again.
    const restored = world(['k2', K2], [['k1', K1]]);
    expect((await restored.coverage()).result).toBe('COVERAGE_COMPLETE');
    expect((await ackOf((await restored.apply(target.email)).id)).lastErrorCode).toBe('RECIPIENT_SUPPRESSED');
    expect((await ackOf((await restored.apply(address('sup18ok'))).id)).status).toBe('SENT');
    // The earlier blocked channels: never automatically; only an operator run with --include-configuration.
    expect((await restored.retry()).due).toBe(0);
    const operator = await restored.retry({ includeConfiguration: true });
    expect(operator.due).toBe(2);
    expect((await ackOf(blockedSuppressed.id)).lastErrorCode).toBe('RECIPIENT_SUPPRESSED');
    expect((await ackOf(blockedFresh.id)).status).toBe('SENT');
    expect(server.counter.messagesTo(target.email)).toBe(0);
  });

  it('SUP-20: coverage reports a key with ACTIVE entries as not safe to retire; removing it anyway gives the SUP-18 behaviour; resolve-unrecoverable refuses entries that still have a source', async () => {
    const K1 = bytes();
    const K2 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const target = await suppress(w1, 'sup20');
    const both = world(['k2', K2], [['k1', K1]]);
    await both.registerKey('k2');
    expect((await both.coverage()).keys.find((key) => key.keyId === 'k1')).toMatchObject({ safeToRetire: false, activeEntries: 1 });
    const before = await snapshot();
    const retired = world(['k2', K2]);
    await expectBlocked(retired, target.email);
    await expect(retired.resolve({ keyId: 'k1', expectedCount: 1 })).rejects.toMatchObject({ code: 'ENTRY_HAS_SOURCE' });
    expect(await snapshot()).toBe(before);
  });
});

describe('SUP-19 — an interrupted rekey loses no coverage', () => {
  it('killed after k of n writes: every entry wholly under k1 or k2, all still suppressed, coverage complete; re-runs finish and then change nothing; a digest mismatch and a unique-index conflict stay under k1 and keep it required', async (context) => {
    if (!hasFailPoints) context.skip('NOT RUN: mongod without enableTestCommands (failCommand fail point)');
    const K1 = bytes();
    const K2 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const targets = [];
    for (const label of ['sup19a', 'sup19b', 'sup19c']) targets.push(await suppress(w1, label));
    // A digest-mismatch entry: under k1, its source names an Application of ANOTHER address.
    const other = await w1.apply(address('sup19other'));
    const mismatch = await RecipientSuppression.findById(targets[0].suppressionId);
    const mismatched = new RecipientSuppression({
      lookup: { keyId: 'k1', digest: w1.keyring.digestUnder('k1', address('sup19ghost')) },
      scope: 'APPLICATION_ACKNOWLEDGEMENT',
      state: 'ACTIVE',
      reason: 'INVALID_RECIPIENT_CONFIRMED',
      basis: { kind: 'RELAY_REFUSAL', statusCode: '5.1.1', evidenceRef: EVIDENCE },
      sources: [{ applicationId: other.id, attempt: 1, messageToken: null }],
      history: [{ at: new Date(), action: 'ADD', actor: QA_OPERATOR, reason: 'INVALID_RECIPIENT_CONFIRMED', evidenceRef: EVIDENCE }],
    });
    await mismatched.save();
    expect(mismatch).toBeTruthy();
    // A unique-index conflict: the third address is ALSO already registered under k2.
    const conflictEntry = new RecipientSuppression({
      lookup: { keyId: 'k2', digest: createKeyring({ current: { keyId: 'k2', key: K2 } }).digestUnder('k2', targets[2].email.toLowerCase()) },
      scope: 'APPLICATION_ACKNOWLEDGEMENT',
      state: 'ACTIVE',
      reason: 'INVALID_RECIPIENT_CONFIRMED',
      basis: { kind: 'RELAY_REFUSAL', statusCode: '5.1.1', evidenceRef: EVIDENCE },
      sources: [],
      history: [{ at: new Date(), action: 'ADD', actor: QA_OPERATOR, reason: 'INVALID_RECIPIENT_CONFIRMED', evidenceRef: EVIDENCE }],
    });
    const both = world(['k2', K2], [['k1', K1]]);
    await both.registerKey('k2');
    await conflictEntry.save();

    // Kill the SECOND rekey write (and its driver retry): the first entry has moved, the rest have not.
    await failPoint({ failCommands: ['update'], closeConnection: true }, { skip: 1 });
    await expect(both.rekey()).rejects.toBeInstanceOf(SuppressionWriteUnknown);
    await failPointOff();
    const keyIds = (await RecipientSuppression.find({ _id: { $in: targets.map((target) => target.suppressionId) } }).lean()).map((entry) => entry.lookup.keyId);
    expect(keyIds.filter((keyId) => keyId === 'k2')).toHaveLength(1);
    expect(keyIds.every((keyId) => keyId === 'k1' || keyId === 'k2')).toBe(true);
    expect((await both.coverage()).result).toBe('COVERAGE_COMPLETE');
    for (const target of targets) expect((await ackOf((await both.apply(target.email)).id)).lastErrorCode).toBe('RECIPIENT_SUPPRESSED');

    const second = await both.rekey();
    expect(second).toMatchObject({ moved: 1, digestMismatch: 1, conflict: 1 });
    const third = await both.rekey();
    expect(third).toMatchObject({ moved: 0, digestMismatch: 1, conflict: 1 });
    expect((await RecipientSuppression.findById(mismatched._id).lean()).lookup.keyId).toBe('k1');
    expect((await RecipientSuppression.findById(targets[2].suppressionId).lean()).lookup.keyId).toBe('k1');
    expect((await both.coverage()).keys.find((key) => key.keyId === 'k1')).toMatchObject({ activeEntries: 2, safeToRetire: false });
  });
});

describe('SUP-21 — audited resolution of unrecoverable entries (with the OD-2026-11-04-02 correction)', () => {
  it('refusals; then exactly the expected entries LIFTED with one RELEASE_UNRECOVERABLE each; zero submissions; coverage complete; the next Application acknowledged; earlier channels unchanged', async () => {
    const K1 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const a = await suppress(w1, 'sup21a', { sourceless: true });
    const b = await suppress(w1, 'sup21b', { sourceless: true });
    const K2 = bytes();
    const w2 = world(['k2', K2]);
    await w2.registerKey('k2');
    const blocked = await w2.apply(address('sup21blocked'));
    expect((await ackOf(blocked.id)).lastErrorCode).toBe('SUPPRESSION_COVERAGE_INCOMPLETE');
    const before = await snapshot();
    expect(await w2.resolve({ keyId: 'k1', expectedCount: 2, apply: false })).toEqual({ result: 'WOULD_RELEASE', keyId: 'k1', entries: 2 });
    for (const [overrides, code] of [
      [{ actor: 'qa-intruder' }, 'UNKNOWN_OPERATOR'],
      [{ confirmKeyUnavailable: false }, 'CONFIRMATION_REQUIRED'],
      [{ decisionRef: 'OD-2026-11-4-1' }, 'INVALID_DECISION_REF'],
      [{ decisionRef: undefined }, 'INVALID_DECISION_REF'],
      [{ evidenceRef: 'someone@example.test' }, 'INVALID_EVIDENCE_REF'],
      [{ expectedCount: 3 }, 'COUNT_MISMATCH'],
    ]) {
      await expect(w2.resolve({ keyId: 'k1', expectedCount: 2, ...overrides })).rejects.toMatchObject({ code });
    }
    await expect(world(['k2', K2], [['k1', K1]]).resolve({ keyId: 'k1', expectedCount: 2 })).rejects.toMatchObject({ code: 'KEY_CONFIGURED' });
    expect(await snapshot()).toBe(before);

    const rcptBefore = server.counter.totalRcpt();
    const result = await w2.resolve({ keyId: 'k1', expectedCount: 2 });
    expect(result).toMatchObject({ result: 'RELEASED', released: 2, resent: 0, keyState: 'ACTIVE', coverage: 'COVERAGE_COMPLETE' });
    expect(server.counter.totalRcpt()).toBe(rcptBefore);
    for (const entry of await RecipientSuppression.find({ _id: { $in: [a.suppressionId, b.suppressionId] } }).lean()) {
      expect(entry.state).toBe('LIFTED');
      expect(entry.history.filter((item) => item.action === 'RELEASE_UNRECOVERABLE')).toEqual([expect.objectContaining({ actor: QA_OPERATOR, decisionRef: DECISION, evidenceRef: EVIDENCE })]);
    }
    expect((await ackOf((await w2.apply(address('sup21next'))).id)).status).toBe('SENT');
    expect((await ackOf(blocked.id)).lastErrorCode).toBe('SUPPRESSION_COVERAGE_INCOMPLETE'); // unchanged; nothing resent
  });

  it('CORRECTION: while the key is RECOVERING, releasing its source-less entries does NOT restore eligibility; sending resumes only after recover-key --complete and complete coverage', async () => {
    const K1 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const withSource = await suppress(w1, 'sup21c');
    const sourceless = await suppress(w1, 'sup21d', { sourceless: true });
    const w2 = world(['k2', bytes()]);
    await w2.registerKey('k2');
    expect(await w2.recover({ keyId: 'k1', expectedCount: 2, reason: 'LOST' })).toMatchObject({ result: 'RECOVERY_RUN', moved: 1, withoutSource: 1, activeEntriesLeft: 1 });
    const released = await w2.resolve({ keyId: 'k1', expectedCount: 1 });
    expect(released).toMatchObject({ result: 'RELEASED', released: 1, keyState: 'RECOVERING', coverage: 'COVERAGE_INCOMPLETE' });
    // KEY_RECOVERING blocks (the correction); the moved entry's k1 alias also shows k1 as not configured (rev 8.2).
    expect(released.problems).toEqual(expect.arrayContaining([{ keyId: 'k1', reason: 'KEY_RECOVERING' }]));
    expect(released.problems).toEqual(expect.arrayContaining([{ keyId: 'k1', reason: 'KEY_NOT_CONFIGURED' }]));
    await expectBlocked(w2, withSource.email);
    // The moved entry keeps a k1 alias (rev 8.2); completion prunes it at once, stamped (rev 8.3: no waiting period).
    expect(await w2.recover({ keyId: 'k1', complete: true })).toMatchObject({ result: 'COMPLETED', keyState: 'RETIRED', coverage: 'COVERAGE_COMPLETE', aliasesPruned: 1 });
    expect((await RecipientSuppression.findById(withSource.suppressionId).lean()).pruneSeq).toBeGreaterThan(0);
    expect((await ackOf((await w2.apply(address('sup21after'))).id)).status).toBe('SENT');
    expect((await ackOf((await w2.apply(withSource.email)).id)).lastErrorCode).toBe('RECIPIENT_SUPPRESSED');
    expect((await RecipientSuppression.findById(sourceless.suppressionId).lean()).state).toBe('LIFTED');
  });
});

describe('SUP-22 — key-material integrity (synthetic keys)', () => {
  it('22a restart: entries and the check value written under k1 with K1; the process restarts with k1 and wrong bytes K1′ → every acknowledgement blocked; coverage reports KEY_MATERIAL_MISMATCH k1; nothing lifted or written', async () => {
    const w1 = world(['k1', bytes()]);
    await w1.registerKey('k1');
    const target = await suppress(w1, 'sup22a');
    const before = await snapshot();
    const restarted = world(['k1', bytes()]);
    await expectBlocked(restarted, target.email);
    expect(await restarted.coverage()).toMatchObject({ result: 'COVERAGE_INCOMPLETE', problems: [{ keyId: 'k1', reason: 'KEY_MATERIAL_MISMATCH' }] });
    expect(await snapshot()).toBe(before);
    const blockedLog = env.log.output();
    expect(blockedLog).toContain('"reason":"KEY_MATERIAL_MISMATCH"');
  });

  it('22b restore: the database restored from a snapshot made under key generation 1 while the secret store holds generation 2 under the same id → blocked; the matching bytes restored → complete and the address matched again', async () => {
    const generation1 = bytes();
    const w1 = world(['k1', generation1]);
    await w1.registerKey('k1');
    const target = await suppress(w1, 'sup22b');
    const dump = {
      recipient_suppressions: await mongoose.connection.db.collection('recipient_suppressions').find({}).toArray(),
      recipient_suppression_keys: await mongoose.connection.db.collection('recipient_suppression_keys').find({}).toArray(),
    };
    assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
    for (const [collection, documents] of Object.entries(dump)) {
      await mongoose.connection.db.collection(collection).deleteMany({});
      await mongoose.connection.db.collection(collection).insertMany(documents); // the restore
    }
    await expectBlocked(world(['k1', bytes()]), target.email); // generation 2 bytes under the same id
    const matching = world(['k1', generation1]);
    expect((await matching.coverage()).result).toBe('COVERAGE_COMPLETE');
    expect((await ackOf((await matching.apply(target.email)).id)).lastErrorCode).toBe('RECIPIENT_SUPPRESSED');
  });

  it('22c rotation: current k2 correct, verify-only k1 with wrong bytes → blocked and rekey refuses; with the correct k1 bytes the rekey runs and ends with coverage complete', async () => {
    const K1 = bytes();
    const K2 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const target = await suppress(w1, 'sup22c');
    const wrong = world(['k2', K2], [['k1', bytes()]]);
    await wrong.registerKey('k2');
    await expectBlocked(wrong, target.email);
    await expect(wrong.rekey()).rejects.toMatchObject({ code: 'COVERAGE_INCOMPLETE', details: { problems: [{ keyId: 'k1', reason: 'KEY_MATERIAL_MISMATCH' }] } });
    const right = world(['k2', K2], [['k1', K1]]);
    expect(await right.rekey()).toMatchObject({ moved: 1, coverage: 'COVERAGE_COMPLETE' });
  });

  it('22d missing check: a configured key with ACTIVE entries but no check value → blocked (KEY_CHECK_MISSING); key-register for an id that already has a check value refuses; add refuses while the current key has no check value', async () => {
    const K1 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const target = await suppress(w1, 'sup22d');
    await expect(w1.registerKey('k1')).rejects.toMatchObject({ code: 'KEY_ID_ALREADY_USED' });
    assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
    await RecipientSuppressionKey.deleteOne({ _id: 'k1' });
    const missing = world(['k1', K1]);
    await expectBlocked(missing, target.email);
    expect((await missing.coverage()).problems).toEqual([{ keyId: 'k1', reason: 'KEY_CHECK_MISSING' }]);
    const unregistered = world(['k3', bytes()]);
    const refused = address('sup22dadd');
    server.refusals.set(refused.toLowerCase(), { code: 550, text: '5.1.1 Mailbox unavailable (QA)' });
    const application = await unregistered.apply(refused);
    // The acknowledgement was blocked by the gate (no check value), so it was never refused by the relay:
    await expect(unregistered.addRefusal(application.id)).rejects.toMatchObject({ code: 'NOT_A_RELAY_REFUSAL' });
    // …and an eligible stored refusal is refused for the missing check value itself.
    const eligible = await w1.apply(address('sup22delig'));
    expect(eligible.response.status).toBe(201);
    const stored = await mongoose.model('Application').findById(application.id);
    Object.assign(stored.notifications.candidateAcknowledgement, { status: 'FAILED', lastErrorCode: 'INVALID_RECIPIENT', lastStatusCode: '5.1.1' });
    await stored.save();
    await expect(unregistered.addRefusal(application.id)).rejects.toMatchObject({ code: 'CURRENT_KEY_NOT_REGISTERED' });
  });

  it('22e correct material: all checks match → coverage complete; a suppressed address is matched under EVERY configured key; a non-suppressed address proceeds to the unchanged delivery', async () => {
    const K1 = bytes();
    const K2 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const underK1 = await suppress(w1, 'sup22e1');
    const both = world(['k2', K2], [['k1', K1]]);
    await both.registerKey('k2');
    const underK2 = await suppress(both, 'sup22e2');
    expect((await RecipientSuppression.findById(underK2.suppressionId).lean()).lookup.keyId).toBe('k2');
    expect((await both.coverage()).result).toBe('COVERAGE_COMPLETE');
    for (const email of [underK1.email, underK2.email]) expect((await ackOf((await both.apply(email)).id)).lastErrorCode).toBe('RECIPIENT_SUPPRESSED');
    const fresh = address('sup22efresh');
    expect((await ackOf((await both.apply(fresh)).id)).status).toBe('SENT');
    expect(server.counter.messagesTo(fresh)).toBe(1);
  });

  it('22f comparison and output: a stored check value of the wrong length is a MISMATCH (blocked), never an exception; no command result or log prints a key, a check value or a digest', async () => {
    const K1 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const target = await suppress(w1, 'sup22f');
    const check = w1.keyring.checkValueFor('k1');
    const digest = w1.keyring.digestUnder('k1', target.email.toLowerCase());
    const outputs = [await w1.coverage(), await w1.ops.list({}), await w1.ops.check({ applicationId: String(target.first.id) })];
    assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
    await mongoose.connection.db.collection('recipient_suppression_keys').updateOne({ _id: 'k1' }, { $set: { check: check.slice(0, 40) } }); // corrupted (bypasses the schema)
    const corrupted = await w1.coverage();
    expect(corrupted).toMatchObject({ result: 'COVERAGE_INCOMPLETE', problems: [{ keyId: 'k1', reason: 'KEY_MATERIAL_MISMATCH' }] });
    await expectBlocked(w1, target.email);
    const printed = JSON.stringify([...outputs, corrupted]) + env.log.output();
    for (const secret of [check, digest, K1.toString('base64'), K1.toString('hex'), target.email.toLowerCase()]) expect(printed).not.toContain(secret);
  });

  it('22g missing check under existing entries (rev 8): K1′ under k1 blocked; key-register k1 refused with K1′ AND with K1 and writes nothing; also refused for an id with LIFTED-only entries and for RECOVERING / RETIRED ids; eligibility returns only through recovery', async () => {
    const K1 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const target = await suppress(w1, 'sup22g');
    assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
    await RecipientSuppressionKey.deleteOne({ _id: 'k1' }); // deleted / absent after a partial restore
    const wrong = world(['k1', bytes()]);
    await expectBlocked(wrong, target.email);
    const keyDocumentsBefore = await RecipientSuppressionKey.countDocuments({});
    await expect(wrong.registerKey('k1')).rejects.toMatchObject({ code: 'KEY_ID_ALREADY_USED' });
    await expect(world(['k1', K1]).registerKey('k1')).rejects.toMatchObject({ code: 'KEY_ID_ALREADY_USED' });
    expect(await RecipientSuppressionKey.countDocuments({})).toBe(keyDocumentsBefore);
    await expectBlocked(wrong, target.email);

    // An id with LIFTED entries only is also "already used" (built directly: with k1 unusable, no
    // acknowledgement can reach the relay to produce a real refusal — the gate blocks it first).
    const K5 = bytes();
    await new RecipientSuppression({
      lookup: { keyId: 'k5', digest: createKeyring({ current: { keyId: 'k5', key: K5 } }).digestUnder('k5', address('sup22glifted')) },
      scope: 'APPLICATION_ACKNOWLEDGEMENT',
      state: 'LIFTED',
      reason: 'INVALID_RECIPIENT_CONFIRMED',
      basis: { kind: 'RELAY_REFUSAL', statusCode: '5.1.1', evidenceRef: EVIDENCE },
      sources: [],
      history: [
        { at: new Date(), action: 'ADD', actor: QA_OPERATOR, reason: 'INVALID_RECIPIENT_CONFIRMED', evidenceRef: EVIDENCE },
        { at: new Date(), action: 'LIFT', actor: QA_OPERATOR, reason: 'ENTERED_IN_ERROR', evidenceRef: EVIDENCE },
      ],
    }).save();
    await expect(world(['k5', K5]).registerKey('k5')).rejects.toMatchObject({ code: 'KEY_ID_ALREADY_USED' });
    // RECOVERING / RETIRED key documents (no entries): refused too.
    for (const state of ['RECOVERING', 'RETIRED']) {
      const keyId = `k-${state.toLowerCase()}`;
      await new RecipientSuppressionKey({ _id: keyId, check: null, state, recovery: { decisionRef: DECISION, evidenceRef: EVIDENCE, reason: 'UNTRUSTED', startedAt: new Date(), startedBy: QA_OPERATOR, startCount: 0 }, createdBy: QA_OPERATOR }).save();
      await expect(world([keyId, bytes()]).registerKey(keyId)).rejects.toMatchObject({ code: 'KEY_ID_ALREADY_USED' });
      await RecipientSuppressionKey.deleteOne({ _id: keyId });
    }
    // Eligibility returns only through SUP-23: recover k1 under a fresh current key.
    const fresh = world(['k2', bytes()]);
    await fresh.registerKey('k2');
    expect(await fresh.recover({ keyId: 'k1', expectedCount: 1, reason: 'UNTRUSTED' })).toMatchObject({ moved: 1, activeEntriesLeft: 0 });
    expect(await fresh.recover({ keyId: 'k1', complete: true })).toMatchObject({ result: 'COMPLETED', coverage: 'COVERAGE_COMPLETE' });
    expect((await ackOf((await fresh.apply(target.email)).id)).lastErrorCode).toBe('RECIPIENT_SUPPRESSED');
  });
});

describe('SUP-23 — controlled recovery (rev 8)', () => {
  it('23a ordinary rotation stays verified: rekey refuses and writes nothing with incomplete coverage, a missing or mismatching check, an ACTIVE entry under an unconfigured id, or a RECOVERING key document', async () => {
    const K1 = bytes();
    const K2 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    await suppress(w1, 'sup23a');
    const before = await snapshot();
    const unconfigured = world(['k2', K2]);
    await unconfigured.registerKey('k2');
    await expect(unconfigured.rekey()).rejects.toMatchObject({ code: 'COVERAGE_INCOMPLETE', details: { problems: [{ keyId: 'k1', reason: 'KEY_NOT_CONFIGURED' }] } });
    await expect(world(['k2', K2], [['k1', bytes()]]).rekey()).rejects.toMatchObject({ details: { problems: [{ keyId: 'k1', reason: 'KEY_MATERIAL_MISMATCH' }] } });
    await expect(world(['k3', bytes()], [['k1', K1]]).rekey()).rejects.toMatchObject({ details: { problems: [{ keyId: 'k3', reason: 'KEY_CHECK_MISSING' }] } });
    expect(await snapshot()).toBe(before); // the refused runs wrote nothing
    await unconfigured.recover({ keyId: 'k1', expectedCount: 1, reason: 'LOST', limit: 1, apply: true });
    const afterRecovery = await snapshot();
    // Rev 8.2: the moved entry still holds a k1 alias, so k1 is also reported as not configured.
    await expect(unconfigured.rekey()).rejects.toMatchObject({ code: 'COVERAGE_INCOMPLETE', details: { problems: [{ keyId: 'k1', reason: 'KEY_NOT_CONFIGURED' }, { keyId: 'k1', reason: 'KEY_RECOVERING' }] } });
    expect(await snapshot()).toBe(afterRecovery);
    // rekey never wrote anything; only recover-key wrote SOURCE_UNVERIFIED.
    const reasons = (await RecipientSuppression.find({}).lean()).flatMap((entry) => entry.history.filter((item) => item.action === 'REKEY').map((item) => item.reason));
    expect(reasons).toEqual(['SOURCE_UNVERIFIED']);
  });

  it('23b recovery refusals: dry run (counts, no write), unknown operator, invalid references, no confirmation, id still configured, current key missing / unverified / same id, first-run count, a different decision later, a RETIRED id', async () => {
    const K1 = bytes();
    const K2 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    await suppress(w1, 'sup23b');
    const w2 = world(['k2', K2]);
    await w2.registerKey('k2');
    const before = await snapshot();
    const keysBefore = JSON.stringify(await RecipientSuppressionKey.find({}).lean());
    expect(await w2.recover({ keyId: 'k1', expectedCount: 1, reason: 'LOST', apply: false })).toEqual({ result: 'WOULD_START_RECOVERY', keyId: 'k1', activeEntries: 1 });
    for (const [overrides, code] of [
      [{ actor: 'qa-intruder' }, 'UNKNOWN_OPERATOR'],
      [{ decisionRef: 'OD-x' }, 'INVALID_DECISION_REF'],
      [{ evidenceRef: 'a b' }, 'INVALID_EVIDENCE_REF'],
      [{ confirmKeyUnavailable: false }, 'CONFIRMATION_REQUIRED'],
      [{ expectedCount: 2 }, 'COUNT_MISMATCH'],
      [{ reason: undefined }, 'RECOVERY_REASON_REQUIRED'],
      [{ complete: true }, 'NOT_RECOVERING'],
    ]) {
      await expect(w2.recover({ keyId: 'k1', expectedCount: 1, reason: 'LOST', ...overrides })).rejects.toMatchObject({ code });
    }
    await expect(world(['k2', K2], [['k1', K1]]).recover({ keyId: 'k1', expectedCount: 1, reason: 'LOST' })).rejects.toMatchObject({ code: 'KEY_STILL_CONFIGURED' });
    await expect(world(null).recover({ keyId: 'k1', expectedCount: 1, reason: 'LOST' })).rejects.toMatchObject({ code: 'CURRENT_KEY_MISSING' });
    await expect(world(['k2', bytes()]).recover({ keyId: 'k1', expectedCount: 1, reason: 'LOST' })).rejects.toMatchObject({ code: 'CURRENT_KEY_NOT_VERIFIED' });
    await expect(world(['k9', bytes()]).recover({ keyId: 'k1', expectedCount: 1, reason: 'LOST' })).rejects.toMatchObject({ code: 'CURRENT_KEY_NOT_REGISTERED' });
    expect(await snapshot()).toBe(before);
    expect(JSON.stringify(await RecipientSuppressionKey.find({}).lean())).toBe(keysBefore);
    // Started under one decision: a later run under another decision is refused; a RETIRED id cannot be recovered again.
    await w2.recover({ keyId: 'k1', expectedCount: 1, reason: 'LOST' });
    await expect(w2.recover({ keyId: 'k1', decisionRef: 'OD-2026-11-04-98' })).rejects.toMatchObject({ code: 'DECISION_REF_MISMATCH' });
    await w2.recover({ keyId: 'k1', complete: true });
    await expect(w2.recover({ keyId: 'k1', expectedCount: 0, reason: 'LOST' })).rejects.toMatchObject({ code: 'KEY_RETIRED' });
  });

  it('23c/23d blocked throughout and durable: lost current key; recovery started; killed after k of n; all with a source moved; source-less left — every stage blocks both addresses; re-runs complete; one REKEY / SOURCE_UNVERIFIED each, with the decision', async (context) => {
    if (!hasFailPoints) context.skip('NOT RUN: mongod without enableTestCommands (failCommand fail point)');
    const K1 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const targets = [];
    for (const label of ['sup23c1', 'sup23c2', 'sup23c3']) targets.push(await suppress(w1, label));
    const sourceless = await suppress(w1, 'sup23c4', { sourceless: true });
    // Lost current key: k1 gone, a fresh k2.
    const w2 = world(['k2', bytes()]);
    await w2.registerKey('k2');
    await expectBlocked(w2, targets[0].email); // before recovery
    // Recovery started; the SECOND move (and its driver retry) is killed.
    // k1 had a key document, so starting recovery UPDATES it (ACTIVE -> RECOVERING): that update and the
    // first move pass; the second move (and every later update, the driver's retry included) is cut off.
    await failPoint({ failCommands: ['update'], closeConnection: true }, { skip: 2 });
    await expect(w2.recover({ keyId: 'k1', expectedCount: 4, reason: 'LOST' })).rejects.toBeInstanceOf(SuppressionWriteUnknown);
    await failPointOff();
    expect((await RecipientSuppressionKey.findById('k1').lean()).state).toBe('RECOVERING');
    const placed = (await RecipientSuppression.find({ _id: { $in: targets.map((target) => target.suppressionId) } }).lean()).map((entry) => entry.lookup.keyId);
    expect(placed.every((keyId) => keyId === 'k1' || keyId === 'k2')).toBe(true);
    expect(placed.filter((keyId) => keyId === 'k2')).toHaveLength(1); // k = 1 of n = 3 moved, wholly
    await expectBlocked(w2, targets[0].email); // interrupted
    await expectBlocked(w2, targets[2].email);
    const rerun = await w2.recover({ keyId: 'k1' });
    expect(rerun).toMatchObject({ result: 'RECOVERY_RUN', withoutSource: 1, activeEntriesLeft: 1 });
    expect(await w2.recover({ keyId: 'k1' })).toMatchObject({ moved: 0, withoutSource: 1, activeEntriesLeft: 1 });
    await expectBlocked(w2, targets[1].email); // all with a source moved, the source-less one remains
    for (const target of targets) {
      const entry = await RecipientSuppression.findById(target.suppressionId).lean();
      expect(entry.lookup.keyId).toBe('k2');
      expect(entry.history.filter((item) => item.action === 'REKEY')).toEqual([expect.objectContaining({ reason: 'SOURCE_UNVERIFIED', decisionRef: DECISION, evidenceRef: EVIDENCE, actor: QA_OPERATOR })]);
    }
    expect((await RecipientSuppression.findById(sourceless.suppressionId).lean()).lookup.keyId).toBe('k1');
  });

  it('23d version conflicts during recovery are left for the re-run, never overwritten', async () => {
    const w1 = world(['k1', bytes()]);
    await w1.registerKey('k1');
    const target = await suppress(w1, 'sup23d');
    const w2 = world(['k2', bytes()]);
    await w2.registerKey('k2');
    // A concurrent writer changes the entry between recover-key's read and its save.
    const racing = {
      ...w2.register,
      async save(document) {
        if (document.collection?.name === 'recipient_suppressions' && document.lookup?.keyId === 'k2' && !racing.done) {
          racing.done = true;
          const other = await RecipientSuppression.findById(document._id);
          other.duplicateReports += 1;
          await other.save();
        }
        return w2.register.save(document);
      },
    };
    const ops = createSuppressionOperations({ register: racing, keyring: w2.keyring, operatorIds: [QA_OPERATOR] });
    const first = await ops.recoverKey({ keyId: 'k1', decisionRef: DECISION, evidenceRef: EVIDENCE, confirmKeyUnavailable: true, expectedCount: 1, reason: 'LOST', apply: true, actor: QA_OPERATOR });
    expect(first).toMatchObject({ moved: 0, versionConflict: 1, activeEntriesLeft: 1 });
    expect((await RecipientSuppression.findById(target.suppressionId).lean()).duplicateReports).toBe(1); // the concurrent change kept
    expect(await ops.recoverKey({ keyId: 'k1', decisionRef: DECISION, evidenceRef: EVIDENCE, confirmKeyUnavailable: true, apply: true, actor: QA_OPERATOR })).toMatchObject({ moved: 1, activeEntriesLeft: 0 });
    const moved = await RecipientSuppression.findById(target.suppressionId).lean();
    expect(moved).toMatchObject({ duplicateReports: 1, lookup: { keyId: 'k2' } });
  });

  it('23e unresolved entries are preserved: source-less entries and conflicts stay ACTIVE under k1 and are reported; --complete refuses; SUPERSEDED only while the address is ACTIVE under the current key; CONFLICT_LIFTED left unchanged', async () => {
    const K1 = bytes();
    const K2 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const conflictActive = await suppress(w1, 'sup23eA');
    const conflictLifted = await suppress(w1, 'sup23eL');
    const sourceless = await suppress(w1, 'sup23eS', { sourceless: true });
    const ring2 = createKeyring({ current: { keyId: 'k2', key: K2 } });
    const k2Entry = (email, state) =>
      new RecipientSuppression({
        lookup: { keyId: 'k2', digest: ring2.digestUnder('k2', email.toLowerCase()) },
        scope: 'APPLICATION_ACKNOWLEDGEMENT',
        state,
        reason: 'INVALID_RECIPIENT_CONFIRMED',
        basis: { kind: 'RELAY_REFUSAL', statusCode: '5.1.1', evidenceRef: EVIDENCE },
        sources: [],
        history: [{ at: new Date(), action: 'ADD', actor: QA_OPERATOR, reason: 'INVALID_RECIPIENT_CONFIRMED', evidenceRef: EVIDENCE }],
      }).save();
    const w2 = world(['k2', K2]);
    await w2.registerKey('k2');
    await k2Entry(conflictActive.email, 'ACTIVE');
    await k2Entry(conflictLifted.email, 'LIFTED');
    // Not in recovery yet: SUPERSEDED is refused.
    await expect(w2.ops.lift({ suppressionId: conflictActive.suppressionId, reason: 'SUPERSEDED', evidenceRef: EVIDENCE, apply: true, actor: QA_OPERATOR })).rejects.toMatchObject({ code: 'NOT_IN_RECOVERY' });

    const run = await w2.recover({ keyId: 'k1', expectedCount: 3, reason: 'LOST' });
    expect(run).toMatchObject({ moved: 0, withoutSource: 1, conflictActive: 1, conflictLifted: 1, activeEntriesLeft: 3 });
    for (const entry of [conflictActive, conflictLifted, sourceless]) expect((await RecipientSuppression.findById(entry.suppressionId).lean())).toMatchObject({ state: 'ACTIVE', lookup: { keyId: 'k1' } });
    await expect(w2.recover({ keyId: 'k1', complete: true })).rejects.toMatchObject({ code: 'ENTRIES_REMAIN', details: { activeEntries: 3 } });
    await expect(w2.resolve({ keyId: 'k1', expectedCount: 1 })).rejects.toMatchObject({ code: 'ENTRY_HAS_SOURCE' });
    // SUPERSEDED: refused for the LIFTED conflict, accepted for the ACTIVE one (the address stays suppressed under k2).
    await expect(w2.ops.lift({ suppressionId: conflictLifted.suppressionId, reason: 'SUPERSEDED', evidenceRef: EVIDENCE, apply: true, actor: QA_OPERATOR })).rejects.toMatchObject({ code: 'NOT_SUPERSEDED' });
    expect(await w2.ops.lift({ suppressionId: conflictActive.suppressionId, reason: 'SUPERSEDED', evidenceRef: EVIDENCE, apply: true, actor: QA_OPERATOR })).toMatchObject({ result: 'LIFTED' });
    expect((await ackOf((await w2.apply(address('probe'))).id)).lastErrorCode).toBe('SUPPRESSION_COVERAGE_INCOMPLETE');
    // CONFLICT_LIFTED stays unchanged until an explicit operator decision with evidence.
    expect((await w2.recover({ keyId: 'k1' }))).toMatchObject({ conflictLifted: 1, withoutSource: 1 });
    expect((await RecipientSuppression.findById(conflictLifted.suppressionId).lean())).toMatchObject({ state: 'ACTIVE', lookup: { keyId: 'k1' } });
  });

  it('23f completion: --complete retires k1 and coverage is complete; a recovered address is RECIPIENT_SUPPRESSED, a fresh one SENT; earlier blocked channels only with --include-configuration; configuring k1 again blocks (KEY_NOT_TRUSTED) and key-register k1 is refused', async () => {
    const K1 = bytes();
    const K2 = bytes();
    const w1 = world(['k1', K1]);
    await w1.registerKey('k1');
    const target = await suppress(w1, 'sup23f');
    const w2 = world(['k2', K2]);
    await w2.registerKey('k2');
    const blocked = await w2.apply(address('sup23fblocked'));
    await w2.recover({ keyId: 'k1', expectedCount: 1, reason: 'LOST' });
    const completed = await w2.recover({ keyId: 'k1', complete: true });
    expect(completed).toMatchObject({ result: 'COMPLETED', keyState: 'RETIRED', coverage: 'COVERAGE_COMPLETE', problems: [], aliasesPruned: 1 });
    expect((await RecipientSuppressionKey.findById('k1').lean())).toMatchObject({ state: 'RETIRED', recovery: { decisionRef: DECISION, reason: 'LOST', completedBy: QA_OPERATOR } });
    const recovered = await w2.apply(target.email);
    expect((await ackOf(recovered.id)).lastErrorCode).toBe('RECIPIENT_SUPPRESSED');
    expect(server.counter.messagesTo(target.email)).toBe(0);
    expect((await ackOf((await w2.apply(address('sup23ffresh'))).id)).status).toBe('SENT');
    expect((await w2.retry()).due).toBe(0);
    expect((await w2.retry({ includeConfiguration: true })).results.SENT).toBe(1);
    expect((await ackOf(blocked.id)).status).toBe('SENT');
    const again = world(['k2', K2], [['k1', K1]]);
    expect((await again.coverage()).problems).toEqual([{ keyId: 'k1', reason: 'KEY_NOT_TRUSTED' }]);
    await expectBlocked(again, target.email);
    await expect(world(['k1', K1]).registerKey('k1')).rejects.toMatchObject({ code: 'KEY_ID_ALREADY_USED' });
  });
});
