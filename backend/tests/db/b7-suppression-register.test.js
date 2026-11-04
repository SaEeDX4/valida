import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Application } from '../../src/models/Application.js';
import { RecipientSuppression, MAX_HISTORY } from '../../src/models/RecipientSuppression.js';
import { createApplicationRepository } from '../../src/modules/applications/application.repository.js';
import { createApplicationNotifier, runNotificationRetry, staleAfterMs } from '../../src/modules/applications/application.notifications.js';
import { NOTIFICATION_EVENTS } from '../../src/integrations/notifications/notificationService.js';
import { createSuppressionGate } from '../../src/modules/suppression/suppressionGate.js';
import { createSuppressionRegister, SuppressionWriteUnknown } from '../../src/modules/suppression/suppressionRegister.js';
import { messageTokenFor, SuppressionRefused } from '../../src/modules/suppression/suppressionOperations.js';
import { syntheticKeyring } from '../fixtures/suppressionDoubles.js';
import { QA_OPERATOR, realSuppression, registerKeys } from './fixtures/suppression.js';
import {
  HR,
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
  watchRegisterWrites,
} from './fixtures/suppressionHarness.js';
import { requireTestDatabase, assertConnectedToTestDatabase } from './testDatabase.js';

/**
 * B7 — recipient suppression, SUP-1…15 (RECIPIENT_SUPPRESSION_DESIGN.md rev 8
 * §8; approved by OD-2026-11-04-02), against the REAL register in a disposable
 * MongoDB and the REAL SMTP adapter submitting to a LOCAL SMTP TEST SERVER
 * that counts RCPT commands and accepted messages. Synthetic data and keys
 * only; nothing leaves this machine.
 */
const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const POLICY = Object.freeze({ maxAttempts: 5, baseDelayMs: 60_000, staleMs: staleAfterMs({ notificationTimeoutMs: 10_000, databaseTimeoutMs: 5_000 }) });
const EVIDENCE = 'BNC-2026-11-04-01';
const evidence = (entry) => {
  if (process.env.VALIDA_B7_EVIDENCE_FILE) fs.appendFileSync(process.env.VALIDA_B7_EVIDENCE_FILE, `${JSON.stringify(entry)}\n`);
};
const address = (label) => `qa.${label}.${randomUUID().slice(0, 8)}@qa-valida.example.test`;
const refuse = (server, email, code = 550, text = '5.1.1 Mailbox unavailable (QA)') => server.refusals.set(email.toLowerCase(), { code, text });

let server;
let env;
let suppression;
let fixture;
let hasFailPoints;

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
  suppression = realSuppression();
  await registerKeys(suppression);
  fixture = suppressionApp({ server, intake: env.intake, gate: suppression.gate, log: env.log });
  server.refusals.clear();
});
afterEach(async () => {
  await failPointOff();
  await fixture.transport.close?.();
  await env.intake.cleanup();
});

const add = (applicationId) => suppression.operations.addFromRefusal({ applicationId: String(applicationId), evidenceRef: EVIDENCE, apply: true, actor: QA_OPERATOR });
const registerCount = () => RecipientSuppression.countDocuments({});
const logLines = () => env.log.lines.flatMap((chunk) => String(chunk).split('\n')).filter(Boolean).map((line) => JSON.parse(line));

/** A refused first acknowledgement and its registration: the address is then suppressed. */
async function suppressedAddress(label = 'suppressed') {
  const email = address(label);
  refuse(server, email);
  const first = await applyAs(fixture.app, email);
  expect(first.response.status).toBe(201);
  expect(await add(first.id)).toMatchObject({ result: 'ADDED' });
  server.refusals.delete(email.toLowerCase());
  return { email, first };
}

describe('SUP-1 / SUP-2 — a confirmed permanent refusal suppresses later acknowledgements', () => {
  it('SUP-1: a 5.1.1 RCPT refusal, registered with add --from-refusal → a distinct Application returns 201, its acknowledgement is FAILED / RECIPIENT_SUPPRESSED with ZERO submissions, and the internal notification is sent', async () => {
    const email = address('sup1');
    refuse(server, email);
    const first = await applyAs(fixture.app, email);
    expect(first.response.status).toBe(201);
    const firstState = (await channels(first.id)).candidateAcknowledgement;
    expect(firstState).toMatchObject({ status: 'FAILED', lastErrorCode: 'INVALID_RECIPIENT', lastStatusCode: '5.1.1' });
    expect(server.counter.rcptTo(email)).toBe(1);
    expect(server.counter.messagesTo(email)).toBe(0);

    const added = await add(first.id);
    expect(added).toMatchObject({ result: 'ADDED', keyId: suppression.keyring.currentKeyId });
    const [entry] = await RecipientSuppression.find({}).lean();
    expect(entry).toMatchObject({ state: 'ACTIVE', scope: 'APPLICATION_ACKNOWLEDGEMENT', reason: 'INVALID_RECIPIENT_CONFIRMED', basis: { kind: 'RELAY_REFUSAL', statusCode: '5.1.1', evidenceRef: EVIDENCE } });
    expect(entry.sources).toEqual([{ applicationId: first.id, attempt: 1, messageToken: messageTokenFor(NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT, first.id) }]);

    server.refusals.delete(email.toLowerCase()); // the relay would accept now — suppression must stop it anyway
    const hrBefore = server.counter.messagesTo(HR);
    const second = await applyAs(fixture.app, email);
    expect(second.response.status).toBe(201);
    expect(second.response.body.data.applicationId ?? second.id).toBeTruthy();
    const secondState = await channels(second.id);
    expect(secondState.candidateAcknowledgement).toMatchObject({ status: 'FAILED', lastErrorCode: 'RECIPIENT_SUPPRESSED', attemptCount: 1 });
    expect(secondState.internal).toMatchObject({ status: 'SENT' });
    expect(server.counter.rcptTo(email)).toBe(1); // unchanged: no submission at all for the second one
    expect(server.counter.messagesTo(email)).toBe(0);
    expect(server.counter.messagesTo(HR)).toBe(hrBefore + 1);
    const suppressedLog = logLines().find((line) => line.event === 'notification_suppressed');
    expect(suppressedLog).toMatchObject({ applicationId: String(second.id), channel: 'candidateAcknowledgement', suppressionId: String(entry._id) });
    evidence({ test: 'SUP-1', rcptToAddress: server.counter.rcptTo(email), messagesToAddress: server.counter.messagesTo(email), second: secondState.candidateAcknowledgement.lastErrorCode });
  });

  it('SUP-2: add --from-bounce with the correlated Message-ID token, an eligible status and a matching SENT acknowledgement → the same outcome', async () => {
    const email = address('sup2');
    const first = await applyAs(fixture.app, email);
    expect((await channels(first.id)).candidateAcknowledgement.status).toBe('SENT');
    expect(server.counter.messagesTo(email)).toBe(1);
    const added = await suppression.operations.addFromBounce({
      messageToken: messageTokenFor(NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT, first.id),
      status: '5.1.1',
      dsnReceived: new Date(),
      evidenceRef: EVIDENCE,
      apply: true,
      actor: QA_OPERATOR,
    });
    expect(added).toMatchObject({ result: 'ADDED' });
    expect((await RecipientSuppression.findOne({}).lean()).basis).toEqual({ kind: 'ASYNC_BOUNCE', statusCode: '5.1.1', evidenceRef: EVIDENCE });
    const second = await applyAs(fixture.app, email);
    expect(second.response.status).toBe(201);
    expect((await channels(second.id)).candidateAcknowledgement).toMatchObject({ status: 'FAILED', lastErrorCode: 'RECIPIENT_SUPPRESSED' });
    expect(server.counter.messagesTo(email)).toBe(1);
    expect(server.counter.rcptTo(email)).toBe(1);
  });
});

describe('SUP-3 / SUP-7 / SUP-9 — what can never suppress (each refused, nothing written)', () => {
  it('SUP-3: 4.x.x, mailbox full (5.2.2), TIMEOUT, OUTCOME_UNKNOWN and a stale attempt are refused by add', async () => {
    const full = address('sup3full');
    refuse(server, full, 552, '5.2.2 Mailbox full (QA)');
    const fullApp = await applyAs(fixture.app, full);
    expect((await channels(fullApp.id)).candidateAcknowledgement).toMatchObject({ lastErrorCode: 'INVALID_RECIPIENT', lastStatusCode: '5.2.2' });
    await expect(add(fullApp.id)).rejects.toMatchObject({ code: 'STATUS_NOT_ELIGIBLE' });

    const temporary = address('sup3temp');
    refuse(server, temporary, 450, '4.2.1 Try again later (QA)');
    const temporaryApp = await applyAs(fixture.app, temporary);
    expect((await channels(temporaryApp.id)).candidateAcknowledgement.lastErrorCode).toBe('PROVIDER_UNAVAILABLE');
    await expect(add(temporaryApp.id)).rejects.toMatchObject({ code: 'NOT_A_RELAY_REFUSAL' });

    // TIMEOUT / OUTCOME_UNKNOWN: stored states the adapter records for an uncertain submission.
    for (const code of ['TIMEOUT', 'OUTCOME_UNKNOWN']) {
      const application = await Application.findById(temporaryApp.id);
      application.notifications.candidateAcknowledgement.lastErrorCode = code;
      await application.save();
      await expect(add(temporaryApp.id)).rejects.toMatchObject({ code: 'NOT_A_RELAY_REFUSAL' });
    }
    // 4.x.x through the bounce path, and a stale attempt (outside the window).
    const sent = await applyAs(fixture.app, address('sup3sent'));
    const token = messageTokenFor(NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT, sent.id);
    const bounce = (status, dsnReceived, windowDays) => suppression.operations.addFromBounce({ messageToken: token, status, dsnReceived, windowDays, evidenceRef: EVIDENCE, apply: true, actor: QA_OPERATOR });
    await expect(bounce('4.2.2', new Date())).rejects.toMatchObject({ code: 'STATUS_NOT_ELIGIBLE' });
    await expect(bounce('5.2.2', new Date())).rejects.toMatchObject({ code: 'STATUS_NOT_ELIGIBLE' });
    await expect(bounce('5.1.1', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), 1)).rejects.toMatchObject({ code: 'NO_MATCH' });
    expect(await registerCount()).toBe(0);
  });

  it('SUP-7: sender-side failures never suppress the recipient — 5.7.x at RCPT (real relay refusal), MAIL FROM refusal, authentication, quota or rate refusals', async () => {
    const policy = address('sup7policy');
    refuse(server, policy, 550, '5.7.1 Relaying denied (QA)');
    const policyApp = await applyAs(fixture.app, policy);
    expect((await channels(policyApp.id)).candidateAcknowledgement).toMatchObject({ lastErrorCode: 'PROVIDER_REJECTED', lastStatusCode: '5.7.1' });
    await expect(add(policyApp.id)).rejects.toMatchObject({ code: 'NOT_A_RELAY_REFUSAL' });
    // Stored outcomes of the other sender-side failures (as the adapter records them).
    for (const [code, status] of [['SENDER_NOT_VERIFIED', '5.7.1'], ['PROVIDER_AUTH_FAILED', '5.7.8'], ['RATE_LIMITED', '4.7.0'], ['PROVIDER_UNAVAILABLE', '4.3.2']]) {
      const application = await Application.findById(policyApp.id);
      Object.assign(application.notifications.candidateAcknowledgement, { status: 'FAILED', lastErrorCode: code, lastStatusCode: status });
      await application.save();
      await expect(add(policyApp.id)).rejects.toMatchObject({ code: 'NOT_A_RELAY_REFUSAL' });
    }
    expect(await registerCount()).toBe(0);
  });

  it('SUP-9: uncorrelated or conflicting evidence cannot suppress — no match, a match on the INTERNAL channel, a channel not SENT, a missing or ineligible status, an out-of-window time', async () => {
    const sent = await applyAs(fixture.app, address('sup9sent'));
    const refusedEmail = address('sup9refused');
    refuse(server, refusedEmail);
    const notSent = await applyAs(fixture.app, refusedEmail);
    const bounce = (messageToken, overrides = {}) =>
      suppression.operations.addFromBounce({ messageToken, status: '5.1.1', dsnReceived: new Date(), evidenceRef: EVIDENCE, apply: true, actor: QA_OPERATOR, ...overrides });
    await expect(bounce('0'.repeat(32))).rejects.toMatchObject({ code: 'NO_MATCH' });
    await expect(bounce(messageTokenFor(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, sent.id))).rejects.toMatchObject({ code: 'INTERNAL_CHANNEL_MATCH' });
    await expect(bounce(messageTokenFor(NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT, notSent.id))).rejects.toMatchObject({ code: 'CHANNEL_NOT_SENT' });
    await expect(bounce(messageTokenFor(NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT, sent.id), { status: undefined })).rejects.toMatchObject({ code: 'STATUS_NOT_ELIGIBLE' });
    await expect(bounce(messageTokenFor(NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT, sent.id), { status: '5.7.1' })).rejects.toMatchObject({ code: 'STATUS_NOT_ELIGIBLE' });
    await expect(bounce(messageTokenFor(NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT, sent.id), { dsnReceived: new Date(Date.now() + 60 * 60 * 1000) })).rejects.toMatchObject({ code: 'INVALID_DSN_TIME' });
    await expect(bounce(messageTokenFor(NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT, sent.id), { dsnReceived: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000), windowDays: 30 })).rejects.toMatchObject({ code: 'NO_MATCH' });
    // A refusal without an eligible status (no enhanced status at all) cannot be registered either.
    const bare = address('sup9bare');
    refuse(server, bare, 550, 'Mailbox unavailable (QA, no enhanced status)');
    const bareApp = await applyAs(fixture.app, bare);
    expect((await channels(bareApp.id)).candidateAcknowledgement).toMatchObject({ lastErrorCode: 'INVALID_RECIPIENT', lastStatusCode: null });
    await expect(add(bareApp.id)).rejects.toMatchObject({ code: 'STATUS_NOT_ELIGIBLE' });
    expect(await registerCount()).toBe(0);
  });
});

describe('SUP-4 / SUP-15 — suppression never touches acceptance, the internal notification, replay or idempotency', () => {
  it('SUP-4: suppressed address — 201, internal notification sent; a replay with the same key returns the stored result and sends nothing', async () => {
    const { email } = await suppressedAddress('sup4');
    const hrBefore = server.counter.messagesTo(HR);
    const rcptBefore = server.counter.totalRcpt();
    const first = await applyAs(fixture.app, email);
    expect(first.response.status).toBe(201);
    expect((await channels(first.id)).internal.status).toBe('SENT');
    const replay = await applyAs(fixture.app, email, { key: first.key });
    expect(replay.response.status).toBe(200);
    expect(replay.response.body.data).toEqual(first.response.body.data);
    expect(await Application.countDocuments({})).toBe(2);
    expect(server.counter.messagesTo(HR)).toBe(hrBefore + 1);
    expect(server.counter.totalRcpt()).toBe(rcptBefore + 1); // the one internal RCPT; nothing for the candidate, nothing on replay
  });

  it('SUP-15: N new Applications with a suppressed address → ZERO additional acknowledgements, N 201s, N internal notifications', async () => {
    const { email } = await suppressedAddress('sup15');
    const N = 5;
    const hrBefore = server.counter.messagesTo(HR);
    const rcptBefore = server.counter.rcptTo(email);
    const statuses = [];
    for (let index = 0; index < N; index += 1) statuses.push((await applyAs(fixture.app, email)).response.status);
    expect(statuses).toEqual(Array(N).fill(201));
    expect(server.counter.rcptTo(email)).toBe(rcptBefore);
    expect(server.counter.messagesTo(email)).toBe(0);
    expect(server.counter.messagesTo(HR)).toBe(hrBefore + N);
    expect(await Application.countDocuments({ 'notifications.candidateAcknowledgement.lastErrorCode': 'RECIPIENT_SUPPRESSED' })).toBe(N);
    evidence({ test: 'SUP-15', N, additionalAcknowledgementSubmissions: server.counter.rcptTo(email) - rcptBefore, internal: server.counter.messagesTo(HR) - hrBefore });
  });
});

describe('SUP-5 — lift: authorised, reasoned, evidenced, audited; nothing is ever resent', () => {
  it('requires an operator, a valid reason and evidence; keeps history; every retry flag leaves RECIPIENT_SUPPRESSED channels untouched; a later new Application is acknowledged', async () => {
    const { email } = await suppressedAddress('sup5');
    const blocked = await applyAs(fixture.app, email);
    const [entry] = await RecipientSuppression.find({}).lean();
    const lift = (overrides) => suppression.operations.lift({ suppressionId: String(entry._id), reason: 'ADDRESS_CONFIRMED_VALID', evidenceRef: EVIDENCE, apply: true, actor: QA_OPERATOR, ...overrides });
    await expect(lift({ actor: 'qa-intruder' })).rejects.toMatchObject({ code: 'UNKNOWN_OPERATOR' });
    await expect(lift({ reason: 'BECAUSE' })).rejects.toMatchObject({ code: 'INVALID_REASON' });
    await expect(lift({ evidenceRef: undefined })).rejects.toMatchObject({ code: 'INVALID_EVIDENCE_REF' });
    expect(await lift({ apply: false })).toEqual({ result: 'WOULD_LIFT', suppressionId: String(entry._id) });
    expect((await RecipientSuppression.findById(entry._id).lean()).state).toBe('ACTIVE');
    expect(await lift()).toEqual({ result: 'LIFTED', suppressionId: String(entry._id), resent: 0 });
    const lifted = await RecipientSuppression.findById(entry._id).lean();
    expect(lifted.state).toBe('LIFTED');
    expect(lifted.history.map((item) => item.action)).toEqual(['ADD', 'LIFT']);
    expect(lifted.history[1]).toMatchObject({ actor: QA_OPERATOR, reason: 'ADDRESS_CONFIRMED_VALID', evidenceRef: EVIDENCE });

    const rcptBefore = server.counter.rcptTo(email);
    const notifier = createApplicationNotifier({ applications: createApplicationRepository({ timeoutMs: 5_000 }), notifications: fixture.notificationService, clock: () => new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), logger: env.log.logger, suppression: suppression.gate });
    for (const flags of [{}, { includeUncertain: true }, { includeConfiguration: true }, { includeUncertain: true, includeConfiguration: true }]) {
      await runNotificationRetry({ applications: createApplicationRepository({ timeoutMs: 5_000 }), notifier, clock: () => new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), policy: POLICY, send: true, ...flags });
    }
    expect((await channels(blocked.id)).candidateAcknowledgement).toMatchObject({ status: 'FAILED', lastErrorCode: 'RECIPIENT_SUPPRESSED', attemptCount: 1 });
    expect(server.counter.rcptTo(email)).toBe(rcptBefore);
    const later = await applyAs(fixture.app, email);
    expect((await channels(later.id)).candidateAcknowledgement.status).toBe('SENT');
    expect(server.counter.messagesTo(email)).toBe(1);
  });
});

describe('SUP-6 — no plaintext address or digest in logs or the register; forget', () => {
  it('logs and register documents hold no address or digest; forget removes the source (retention) or deletes the entry (privacy request)', async () => {
    const { email, first } = await suppressedAddress('sup6');
    await applyAs(fixture.app, email);
    const digest = suppression.keyring.digestUnder(suppression.keyring.currentKeyId, email.toLowerCase());
    const raw = JSON.stringify(await mongoose.connection.db.collection('recipient_suppressions').find({}).toArray());
    expect(raw).not.toContain(email.toLowerCase());
    expect(raw).not.toContain(email.split('@')[0]);
    const logs = env.log.output();
    for (const forbidden of [email.toLowerCase(), email.split('@')[0], digest, suppression.keyring.checkValueFor(suppression.keyring.currentKeyId)]) expect(logs).not.toContain(forbidden);

    // RETENTION: the source goes, the entry stays ACTIVE without one.
    const second = await Application.findOne({ _id: { $ne: first.id } }, { _id: 1 }).lean();
    await suppression.operations.addFromRefusal({ applicationId: String(first.id), evidenceRef: EVIDENCE, apply: true, actor: QA_OPERATOR });
    expect(await suppression.operations.forget({ applicationId: String(first.id), reason: 'RETENTION', evidenceRef: EVIDENCE, apply: true, actor: QA_OPERATOR })).toMatchObject({ result: 'DONE', items: [{ result: 'SOURCE_REMOVED', sourcesLeft: 0 }] });
    const kept = await RecipientSuppression.findOne({}).lean();
    expect(kept).toMatchObject({ state: 'ACTIVE', sources: [] });
    expect(kept.history.at(-1)).toMatchObject({ action: 'FORGET_SOURCE', reason: 'RETENTION' });
    expect(second).toBeTruthy();

    // PRIVACY_REQUEST on an entry whose last source is this Application: the entry is deleted.
    const other = await suppressedAddress('sup6b');
    expect(await suppression.operations.forget({ applicationId: String(other.first.id), reason: 'PRIVACY_REQUEST', evidenceRef: EVIDENCE, apply: true, actor: QA_OPERATOR })).toMatchObject({ items: [{ result: 'DELETED' }] });
    expect(await RecipientSuppression.countDocuments({ 'sources.applicationId': other.first.id })).toBe(0);
    expect(await registerCount()).toBe(1);
    // …which re-enables acknowledgements to that address.
    const after = await applyAs(fixture.app, other.email);
    expect((await channels(after.id)).candidateAcknowledgement.status).toBe('SENT');
  });
});

describe('SUP-8 — duplicate reports are idempotent', () => {
  it('the same source → ALREADY_ACTIVE with no write; a new source → one appended source and duplicateReports + 1; concurrent duplicates → one document', async () => {
    const { email, first } = await suppressedAddress('sup8');
    const before = await RecipientSuppression.findOne({}).lean();
    expect(await add(first.id)).toMatchObject({ result: 'ALREADY_ACTIVE' });
    expect((await RecipientSuppression.findOne({}).lean()).version).toBe(before.version);

    refuse(server, email);
    // Lift the suppression so a second real refusal can be recorded for a new Application, then re-add both.
    const second = await applyAs(fixture.app, email);
    expect((await channels(second.id)).candidateAcknowledgement.lastErrorCode).toBe('RECIPIENT_SUPPRESSED');
    // A second refused Application of the same address (refusal recorded on the channel by the relay).
    await suppression.operations.lift({ suppressionId: String(before._id), reason: 'ENTERED_IN_ERROR', evidenceRef: EVIDENCE, apply: true, actor: QA_OPERATOR });
    const third = await applyAs(fixture.app, email);
    expect((await channels(third.id)).candidateAcknowledgement.lastStatusCode).toBe('5.1.1');
    expect(await add(third.id)).toMatchObject({ result: 'REAPPLIED' });
    const fourth = await applyAs(fixture.app, address('sup8other'));
    expect(fourth.response.status).toBe(201);

    // New source for an ACTIVE entry: appended once.
    const reapplied = await RecipientSuppression.findOne({}).lean();
    expect(reapplied.state).toBe('ACTIVE');
    expect(reapplied.history.map((item) => item.action)).toEqual(['ADD', 'LIFT', 'REAPPLY']);
    const thirdAgain = await add(first.id);
    expect(thirdAgain).toMatchObject({ result: 'ALREADY_ACTIVE' });

    // Concurrent first registrations of a NEW address from two refused Applications converge on one document.
    const fresh = address('sup8concurrent');
    refuse(server, fresh);
    const a = await applyAs(fixture.app, fresh);
    // A second Application whose acknowledgement was refused the same way (the first add has not happened yet).
    const b = await applyAs(fixture.app, fresh);
    const results = await Promise.all([add(a.id), add(b.id)]);
    expect(results.map((result) => result.result).sort()).toEqual(['ADDED', 'DUPLICATE']);
    const merged = await RecipientSuppression.find({ 'sources.applicationId': { $in: [a.id, b.id] } }).lean();
    expect(merged).toHaveLength(1);
    expect(merged[0].sources.map((source) => String(source.applicationId)).sort()).toEqual([String(a.id), String(b.id)].sort());
    expect(merged[0].duplicateReports).toBe(1);
  });
});

describe('SUP-10 — normalisation merges only case and surrounding whitespace', () => {
  it('Upper/lower case and outer whitespace are one address; dots, +tags and non-ASCII local parts stay distinct', async () => {
    const base = `qa.sup10.${randomUUID().slice(0, 6)}`;
    const email = `${base}@qa-valida.example.test`;
    refuse(server, email);
    const first = await applyAs(fixture.app, email);
    await add(first.id);
    server.refusals.clear();
    for (const variant of [email.toUpperCase(), `  ${email}  `]) {
      const application = await applyAs(fixture.app, variant);
      expect(application.response.status).toBe(201);
      expect((await channels(application.id)).candidateAcknowledgement.lastErrorCode).toBe('RECIPIENT_SUPPRESSED');
    }
    for (const distinct of [`${base.replace(/\./g, '')}@qa-valida.example.test`, `${base}+tag@qa-valida.example.test`]) {
      const application = await applyAs(fixture.app, distinct);
      expect((await channels(application.id)).candidateAcknowledgement.status).toBe('SENT');
    }
    // Non-ASCII local parts (the B2 validator decides acceptance): their digests are never folded together.
    const keyring = suppression.keyring;
    const id = keyring.currentKeyId;
    expect(keyring.digestUnder(id, 'jörg@qa-valida.example.test')).not.toBe(keyring.digestUnder(id, 'jorg@qa-valida.example.test'));
    expect(keyring.digestUnder(id, 'a.b@x.test')).not.toBe(keyring.digestUnder(id, 'ab@x.test'));
    expect(keyring.digestUnder(id, 'a+t@x.test')).not.toBe(keyring.digestUnder(id, 'a@x.test'));
  });
});

describe('SUP-11 (corrected, rev 8) — an unreadable register is TRANSIENT; a missing key is CONFIGURATION', () => {
  it('register read failure (real server error, fail point) → no SMTP, SUPPRESSION_CHECK_UNAVAILABLE (TRANSIENT); 201; internal unaffected; a later normal retry runs a fresh check', async (context) => {
    if (!hasFailPoints) context.skip('NOT RUN: mongod without enableTestCommands (failCommand fail point)');
    const email = address('sup11');
    // A non-retryable server error (code 2), so the driver does not retry the read.
    await failPoint({ failCommands: ['distinct'], errorCode: 2 }, { times: 1 });
    const blocked = await applyAs(fixture.app, email);
    expect(blocked.response.status).toBe(201);
    const state = await channels(blocked.id);
    expect(state.candidateAcknowledgement).toMatchObject({ status: 'FAILED', lastErrorCode: 'SUPPRESSION_CHECK_UNAVAILABLE' });
    expect(state.internal.status).toBe('SENT');
    expect(server.counter.rcptTo(email)).toBe(0);
    expect(logLines().find((line) => line.event === 'notification_suppression_check_unavailable')).toMatchObject({ reason: 'READ_FAILED' });
    // The normal (automatic) retry: the register is readable again → a fresh check → delivered.
    const notifier = createApplicationNotifier({ applications: createApplicationRepository({ timeoutMs: 5_000 }), notifications: fixture.notificationService, clock: () => new Date(Date.now() + 10 * 60 * 1000), logger: env.log.logger, suppression: suppression.gate });
    const report = await runNotificationRetry({ applications: createApplicationRepository({ timeoutMs: 5_000 }), notifier, clock: () => new Date(Date.now() + 10 * 60 * 1000), policy: POLICY, send: true });
    expect(report.results.SENT).toBe(1);
    expect((await channels(blocked.id)).candidateAcknowledgement).toMatchObject({ status: 'SENT', attemptCount: 2 });
  });

  it('register read TIMEOUT (the server holds the read past the bound, fail point) → SUPPRESSION_CHECK_UNAVAILABLE, nothing sent', async (context) => {
    if (!hasFailPoints) context.skip('NOT RUN: mongod without enableTestCommands (failCommand fail point)');
    const tight = createSuppressionGate({ register: createSuppressionRegister({ timeoutMs: 300 }), keyring: suppression.keyring });
    const slowFixture = suppressionApp({ server, intake: env.intake, gate: tight, log: env.log });
    const email = address('sup11slow');
    await failPoint({ failCommands: ['distinct'], blockConnection: true, blockTimeMS: 1_500 }, { times: 1 });
    const blocked = await applyAs(slowFixture.app, email);
    expect(blocked.response.status).toBe(201);
    expect((await channels(blocked.id)).candidateAcknowledgement.lastErrorCode).toBe('SUPPRESSION_CHECK_UNAVAILABLE');
    expect(logLines().find((line) => line.event === 'notification_suppression_check_unavailable')).toMatchObject({ reason: 'TIMEOUT' });
    expect(server.counter.rcptTo(email)).toBe(0);
    await slowFixture.transport.close?.();
  });

  it('a MISSING KEY (no current key configured) → no SMTP, SUPPRESSION_COVERAGE_INCOMPLETE (CONFIGURATION): never due automatically, only with --include-configuration once coverage is restored', async () => {
    const keyless = createSuppressionGate({ register: suppression.register, keyring: syntheticKeyring(null) });
    const keylessFixture = suppressionApp({ server, intake: env.intake, gate: keyless, log: env.log });
    const email = address('sup11key');
    const blocked = await applyAs(keylessFixture.app, email);
    expect(blocked.response.status).toBe(201);
    expect(await channels(blocked.id)).toMatchObject({ internal: { status: 'SENT' }, candidateAcknowledgement: { status: 'FAILED', lastErrorCode: 'SUPPRESSION_COVERAGE_INCOMPLETE' } });
    expect(server.counter.rcptTo(email)).toBe(0);
    const later = () => new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const notifier = createApplicationNotifier({ applications: createApplicationRepository({ timeoutMs: 5_000 }), notifications: fixture.notificationService, clock: later, logger: env.log.logger, suppression: suppression.gate });
    const automatic = await runNotificationRetry({ applications: createApplicationRepository({ timeoutMs: 5_000 }), notifier, clock: later, policy: POLICY, send: true });
    expect(automatic.due).toBe(0);
    const operator = await runNotificationRetry({ applications: createApplicationRepository({ timeoutMs: 5_000 }), notifier, clock: later, policy: POLICY, send: true, includeConfiguration: true });
    expect(operator.results.SENT).toBe(1);
    expect((await channels(blocked.id)).candidateAcknowledgement.status).toBe('SENT');
    await keylessFixture.transport.close?.();
  });

  it('a failed add leaves no partial document (the write is refused by the server, fail point)', async (context) => {
    if (!hasFailPoints) context.skip('NOT RUN: mongod without enableTestCommands (failCommand fail point)');
    const email = address('sup11add');
    refuse(server, email);
    const first = await applyAs(fixture.app, email);
    await failPoint({ failCommands: ['insert'], errorCode: 2 }, { times: 1 });
    await expect(add(first.id)).rejects.toBeInstanceOf(SuppressionWriteUnknown);
    expect(await registerCount()).toBe(0);
    expect(await add(first.id)).toMatchObject({ result: 'ADDED' });
    expect(await registerCount()).toBe(1);
  });
});

describe('SUP-12 — concurrency at the send boundary', () => {
  it('a lookup that starts after a committed add is suppressed; a send whose lookup completed earlier is submitted ONCE and is not recalled (exact counts)', async () => {
    const email = address('sup12');
    refuse(server, email);
    const refused = await applyAs(fixture.app, email);
    server.refusals.clear();
    // Hold the in-flight Application between its (completed) lookup and its send.
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    let readDone;
    const lookupDone = new Promise((resolve) => {
      readDone = resolve;
    });
    const pausing = {
      ...suppression.register,
      async readForAcknowledgement(input) {
        const result = await suppression.register.readForAcknowledgement(input);
        readDone();
        await held;
        return result;
      },
      readCoverageInputs: suppression.register.readCoverageInputs,
    };
    const pausedFixture = suppressionApp({ server, intake: env.intake, gate: createSuppressionGate({ register: pausing, keyring: suppression.keyring }), log: env.log });
    const inFlight = applyAs(pausedFixture.app, email);
    await lookupDone; // its lookup has completed (nothing registered yet)
    expect(await add(refused.id)).toMatchObject({ result: 'ADDED' }); // committed (w: majority) now
    release();
    const early = await inFlight;
    const late = await applyAs(fixture.app, email);
    expect((await channels(early.id)).candidateAcknowledgement.status).toBe('SENT');
    expect((await channels(late.id)).candidateAcknowledgement.lastErrorCode).toBe('RECIPIENT_SUPPRESSED');
    expect(server.counter.messagesTo(email)).toBe(1);
    expect(server.counter.rcptTo(email)).toBe(2); // the first (refused) attempt and the early one; none for the late one
    await pausedFixture.transport.close?.();
  });
});

describe('SUP-13 — unauthorised or malformed operator actions are rejected', () => {
  it('unknown operator; missing --apply (dry run, no write); evidence reference invalid or containing "@"; history cap reached', async () => {
    const email = address('sup13');
    refuse(server, email);
    const refused = await applyAs(fixture.app, email);
    await expect(suppression.operations.addFromRefusal({ applicationId: String(refused.id), evidenceRef: EVIDENCE, apply: true, actor: 'qa-unknown' })).rejects.toMatchObject({ code: 'UNKNOWN_OPERATOR' });
    await expect(suppression.operations.addFromRefusal({ applicationId: String(refused.id), evidenceRef: EVIDENCE, apply: true })).rejects.toMatchObject({ code: 'UNKNOWN_OPERATOR' });
    expect(await suppression.operations.addFromRefusal({ applicationId: String(refused.id), evidenceRef: EVIDENCE })).toMatchObject({ result: 'WOULD_ADD' });
    for (const evidenceRef of ['operator@example.test', 'has space', '', 'x'.repeat(81)]) {
      await expect(suppression.operations.addFromRefusal({ applicationId: String(refused.id), evidenceRef, apply: true, actor: QA_OPERATOR })).rejects.toMatchObject({ code: 'INVALID_EVIDENCE_REF' });
    }
    expect(await registerCount()).toBe(0);
    // History cap: an entry with MAX_HISTORY entries refuses a further action and keeps every entry.
    await add(refused.id);
    const entry = await RecipientSuppression.findOne({});
    while (entry.history.length < MAX_HISTORY) entry.history.push({ at: new Date(), action: 'DUPLICATE', actor: QA_OPERATOR, reason: 'INVALID_RECIPIENT_CONFIRMED', evidenceRef: EVIDENCE, decisionRef: null, requestId: null });
    await entry.save();
    await expect(suppression.operations.lift({ suppressionId: String(entry._id), reason: 'ENTERED_IN_ERROR', evidenceRef: EVIDENCE, apply: true, actor: QA_OPERATOR })).rejects.toMatchObject({ code: 'HISTORY_CAP_REACHED' });
    const after = await RecipientSuppression.findById(entry._id).lean();
    expect(after).toMatchObject({ state: 'ACTIVE' });
    expect(after.history).toHaveLength(MAX_HISTORY);
  });
});

describe('SUP-14 — durable writes, restart safety and audit integrity', () => {
  it('every register write is w: majority, j: true; a connection killed during the conditional write leaves the entry unchanged or fully changed, and a re-run completes it once', async (context) => {
    if (!hasFailPoints) context.skip('NOT RUN: mongod without enableTestCommands (failCommand fail point)');
    const watch = watchRegisterWrites();
    const { first } = await suppressedAddress('sup14');
    const entry = await RecipientSuppression.findOne({}).lean();
    // Twice: the attempt AND the driver's retryable-write retry are both cut off.
    await failPoint({ failCommands: ['update'], closeConnection: true }, { times: 2 });
    const lift = () => suppression.operations.lift({ suppressionId: String(entry._id), reason: 'ENTERED_IN_ERROR', evidenceRef: EVIDENCE, apply: true, actor: QA_OPERATOR });
    await expect(lift()).rejects.toBeInstanceOf(SuppressionWriteUnknown);
    const between = await RecipientSuppression.findById(entry._id).lean();
    expect(between.state === 'ACTIVE' ? between.history.length === 1 : between.history.length === 2).toBe(true);
    if (between.state === 'ACTIVE') expect(await lift()).toMatchObject({ result: 'LIFTED' });
    else await expect(lift()).rejects.toMatchObject({ code: 'NOT_ACTIVE' });
    const final = await RecipientSuppression.findById(entry._id).lean();
    expect(final.state).toBe('LIFTED');
    expect(final.history.map((item) => item.action)).toEqual(['ADD', 'LIFT']);
    watch.stop();
    expect(watch.writes.length).toBeGreaterThan(0);
    for (const write of watch.writes) expect(write.writeConcern).toMatchObject({ w: 'majority', j: true });
    expect(first.id).toBeTruthy();
  });

  it('version conflicts are retried safely; history entries are never rewritten or removed', async () => {
    const { email } = await suppressedAddress('sup14b');
    const stale = await RecipientSuppression.findOne({});
    const fresh = await RecipientSuppression.findOne({});
    fresh.duplicateReports += 1;
    await fresh.save();
    stale.duplicateReports += 5;
    await expect(stale.save()).rejects.toBeInstanceOf(mongoose.Error.VersionError);
    // Two operators record notices for two OTHER Applications of the address at the same time:
    // both target the same document; the loser of each race re-reads and retries — both land.
    const x = await applyAs(fixture.app, email);
    const y = await applyAs(fixture.app, email);
    const results = await Promise.all(
      [x.id, y.id].map((id) => suppression.operations.addComplaint({ applicationId: String(id), kind: 'PROVIDER_NOTICE', evidenceRef: EVIDENCE, apply: true, actor: QA_OPERATOR })),
    );
    expect(results.map((result) => result.result)).toEqual(['DUPLICATE', 'DUPLICATE']);
    const merged = await RecipientSuppression.findById(stale._id).lean();
    expect(merged.sources.map((source) => String(source.applicationId))).toEqual(expect.arrayContaining([String(x.id), String(y.id)]));
    expect(merged.duplicateReports).toBe(3);
    expect(merged.history.map((item) => item.action)).toEqual(['ADD', 'DUPLICATE', 'DUPLICATE']);
    const loaded = await RecipientSuppression.findById(stale._id);
    loaded.history.pop();
    await expect(loaded.save()).rejects.toBeInstanceOf(mongoose.Error.ValidationError);
    const rewritten = await RecipientSuppression.findById(stale._id);
    rewritten.history[0].actor = 'qa-someone-else';
    await expect(rewritten.save()).rejects.toBeInstanceOf(mongoose.Error.ValidationError);
  });
});

describe('the operator command refuses before writing without the unique register index', () => {
  it('add refuses (INDEXES_MISSING) when the unique lookup index is absent', async () => {
    const email = address('noindex');
    refuse(server, email);
    const refused = await applyAs(fixture.app, email);
    assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
    await mongoose.connection.db.collection('recipient_suppressions').dropIndex('suppression_lookup_unique');
    try {
      await expect(add(refused.id)).rejects.toMatchObject({ code: 'INDEXES_MISSING' });
      expect(await registerCount()).toBe(0);
    } finally {
      await mongoose.connection.db.collection('recipient_suppressions').createIndex({ 'lookup.keyId': 1, 'lookup.digest': 1, scope: 1 }, { name: 'suppression_lookup_unique', unique: true });
    }
    expect(SuppressionRefused).toBeTruthy();
  });
});
