import { describe, it, expect } from 'vitest';
import {
  CHANNEL_CATEGORIES,
  NotificationsNotConfiguredError,
  RETRY_LIMITS,
  assessChannel,
  backoffMs,
  createApplicationNotifier,
  notificationDueFilter,
  runNotificationRetry,
  staleAfterMs,
} from '../src/modules/applications/application.notifications.js';
import { ERROR_CODE_CLASSES, createNotificationService } from '../src/integrations/notifications/notificationService.js';
import { capturingLogger } from './helpers.js';
import { QA_NOTIFICATION_OPTIONS, dbUnavailable, matchesFilter, memoryApplicationRepository, recordingTransport } from './fixtures/applyHarness.js';

/**
 * B6 — the claim / send / record cycle and the retry policy, offline
 * (Doc 09 sections 128-136; Doc 14 sections 119-121; Doc 10 sections 117-122).
 *
 * The repository is the in-memory stand-in with the real repository's
 * CONDITIONAL semantics (tests/fixtures/applyHarness.js); the same cycle over
 * a real MongoDB — including the claim race — is in
 * tests/db/b6-notifications.test.js. Transports are TEST DOUBLES: nothing here
 * is evidence that an email was sent.
 */
const MINUTE = 60_000;
const T0 = new Date('2026-10-05T12:00:00.000Z');
const at = (ms) => new Date(T0.getTime() + ms);
const POLICY = Object.freeze({ maxAttempts: 5, baseDelayMs: MINUTE, staleMs: staleAfterMs({ notificationTimeoutMs: 5_000, databaseTimeoutMs: 5_000 }) });

const state = (overrides = {}) => ({ status: 'PENDING', attemptCount: 0, lastAttemptAt: null, sentAt: null, lastErrorCode: null, ...overrides });
const NOT_REQUIRED = () => state({ status: 'NOT_REQUIRED' });

let sequence = 0;
/** Puts a synthetic Application record into the memory repository. */
function seed(repo, { internal = state(), candidateAcknowledgement = NOT_REQUIRED(), submittedAt = T0 } = {}) {
  sequence += 1;
  const _id = `65f0c0ffee00000000${String(sequence).padStart(6, '0')}`;
  repo.records.set(`qa-key-hash-${sequence}`, {
    _id,
    submittedAt,
    jobSnapshot: { title: 'QA Synthetic Apply Role', slug: 'qa-synthetic-apply-role' },
    candidate: { fullName: 'QA Synthetic Candidate', email: 'qa.candidate@qa-valida.example.test' },
    resume: { storageKey: `resumes/qa/${sequence}` },
    notifications: { internal, candidateAcknowledgement },
  });
  return _id;
}
const stored = (repo, id) => repo.all().find((record) => String(record._id) === String(id)).notifications;

function setup({ transport = recordingTransport('accept'), acknowledgementEnabled = false, now = T0, repo = memoryApplicationRepository() } = {}) {
  const log = capturingLogger();
  let clockNow = now;
  const clock = () => clockNow;
  const notifications = createNotificationService({ transport, timeoutMs: 200, clock, ...QA_NOTIFICATION_OPTIONS, acknowledgementEnabled });
  const notifier = createApplicationNotifier({ applications: repo, notifications, clock, logger: log.logger });
  const events = (name) =>
    log
      .output()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.event === name);
  return { repo, notifier, transport, log, events, clock, setNow: (value) => (clockNow = value) };
}

describe('the retry policy (assessChannel)', () => {
  const assess = (channelState, options = {}) =>
    assessChannel(channelState, { channel: 'internal', now: at(10 * MINUTE), submittedAt: T0, acknowledgementEnabled: true, ...POLICY, ...options });

  it('backoff doubles from the base delay, capped at 6 hours; stale threshold covers a full bounded attempt', () => {
    expect([1, 2, 3, 4].map((attempts) => backoffMs(attempts, MINUTE))).toEqual([MINUTE, 2 * MINUTE, 4 * MINUTE, 8 * MINUTE]);
    expect(backoffMs(40, MINUTE)).toBe(6 * 60 * MINUTE);
    expect(staleAfterMs({ notificationTimeoutMs: 5_000, databaseTimeoutMs: 5_000 })).toBe(60_000);
    expect(staleAfterMs({ notificationTimeoutMs: 60_000, databaseTimeoutMs: 5_000 })).toBe(140_000);
  });

  it.each([
    ['SENT', state({ status: 'SENT', attemptCount: 1, sentAt: T0 }), {}, 'SENT', false],
    ['NOT_REQUIRED', NOT_REQUIRED(), {}, 'NOT_REQUIRED', false],
    ['never attempted, old enough', state(), {}, 'UNATTEMPTED', true],
    ['never attempted, inside the grace period (its own request is notifying it)', state(), { now: at(10_000) }, 'UNATTEMPTED', false],
    ['in progress, recent', state({ attemptCount: 1, lastAttemptAt: at(9.5 * MINUTE), lastErrorCode: 'ATTEMPT_IN_PROGRESS' }), {}, 'IN_FLIGHT', false],
    ['in progress, stale (interrupted)', state({ attemptCount: 1, lastAttemptAt: at(0), lastErrorCode: 'ATTEMPT_IN_PROGRESS' }), {}, 'UNCERTAIN', false],
    ['in progress, stale, operator includes uncertain', state({ attemptCount: 1, lastAttemptAt: at(0), lastErrorCode: 'ATTEMPT_IN_PROGRESS' }), { includeUncertain: true }, 'UNCERTAIN', true],
    ['timeout', state({ status: 'FAILED', attemptCount: 1, lastAttemptAt: at(0), lastErrorCode: 'TIMEOUT' }), {}, 'UNCERTAIN', false],
    ['transient, backoff elapsed', state({ status: 'FAILED', attemptCount: 2, lastAttemptAt: at(7 * MINUTE), lastErrorCode: 'PROVIDER_UNAVAILABLE' }), {}, 'TRANSIENT_DUE', true],
    ['transient, backoff running', state({ status: 'FAILED', attemptCount: 3, lastAttemptAt: at(7 * MINUTE), lastErrorCode: 'RATE_LIMITED' }), {}, 'TRANSIENT_WAITING', false],
    ['configuration', state({ status: 'FAILED', attemptCount: 1, lastAttemptAt: at(0), lastErrorCode: 'SENDER_NOT_VERIFIED' }), {}, 'CONFIGURATION', false],
    ['configuration, operator includes it', state({ status: 'FAILED', attemptCount: 1, lastAttemptAt: at(0), lastErrorCode: 'PROVIDER_AUTH_FAILED' }), { includeConfiguration: true }, 'CONFIGURATION', true],
    ['suppressed (permanent)', state({ status: 'FAILED', attemptCount: 1, lastAttemptAt: at(0), lastErrorCode: 'SUPPRESSED' }), { includeUncertain: true, includeConfiguration: true }, 'PERMANENT', false],
    ['invalid recipient (permanent)', state({ status: 'FAILED', attemptCount: 1, lastAttemptAt: at(0), lastErrorCode: 'INVALID_RECIPIENT' }), {}, 'PERMANENT', false],
    ['transient at the attempt limit', state({ status: 'FAILED', attemptCount: 5, lastAttemptAt: at(0), lastErrorCode: 'PROVIDER_UNAVAILABLE' }), {}, 'EXHAUSTED', false],
    ['uncertain at the attempt limit, even when included', state({ status: 'FAILED', attemptCount: 5, lastAttemptAt: at(0), lastErrorCode: 'TIMEOUT' }), { includeUncertain: true }, 'EXHAUSTED', false],
    ['an unknown stored code', state({ status: 'FAILED', attemptCount: 1, lastAttemptAt: at(0), lastErrorCode: 'SOMETHING_ELSE' }), {}, 'UNCERTAIN', false],
  ])('%s -> %s', (_label, channelState, options, category, due) => {
    expect(assess(channelState, options)).toEqual({ category, due });
  });

  it('the acknowledgement channel is DISABLED (never sent) once acknowledgements are switched off', () => {
    expect(assess(state(), { channel: 'candidateAcknowledgement', acknowledgementEnabled: false })).toEqual({ category: CHANNEL_CATEGORIES.DISABLED, due: false });
    expect(assess(state(), { channel: 'candidateAcknowledgement', acknowledgementEnabled: true })).toEqual({ category: 'UNATTEMPTED', due: true });
  });

  /*
   * r2: EVERY state a channel can hold — not only the states this code
   * writes. Includes unrecognised / legacy codes, FAILED without a code,
   * PENDING with an attempt but no in-progress marker, an in-progress marker
   * without a time or on a FAILED channel, attempt counts above the limit,
   * and times exactly on the grace / backoff / stale boundaries.
   */
  it('the scan filter selects EXACTLY the channels assessChannel finds due — every possible state, every option', () => {
    const now = at(10 * MINUTE);
    // Every stored code, plus unrecognised ones — including inherited JavaScript property names and a non-string.
    const codes = [null, 'ATTEMPT_IN_PROGRESS', 'LEGACY_PROVIDER_ERROR', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 5, ...Object.keys(ERROR_CODE_CLASSES).filter((code) => code !== 'ATTEMPT_IN_PROGRESS')];
    const ago = (ms) => new Date(now.getTime() - ms);
    const lastAttempts = [null, at(0), ago(MINUTE), ago(MINUTE - 1), ago(2 * MINUTE), ago(2 * MINUTE - 1), ago(4 * MINUTE), ago(8 * MINUTE), ago(16 * MINUTE + 1), ago(1)];
    const states = [];
    for (const status of ['PENDING', 'FAILED', 'SENT', 'NOT_REQUIRED']) {
      for (const attemptCount of [0, 1, 2, 3, 4, 5, 6]) {
        for (const lastErrorCode of codes) {
          for (const lastAttemptAt of lastAttempts) states.push(state({ status, attemptCount, lastErrorCode, lastAttemptAt }));
        }
      }
    }
    // States outside the schema (reachable only by a raw write): UNSUPPORTED, never selected.
    const withoutAttemptCount = state({ status: 'FAILED', lastErrorCode: 'PROVIDER_UNAVAILABLE', lastAttemptAt: at(0) });
    delete withoutAttemptCount.attemptCount;
    for (const status of ['PENDING', 'FAILED']) {
      for (const lastErrorCode of [null, 'PROVIDER_UNAVAILABLE', 'TIMEOUT', 'ATTEMPT_IN_PROGRESS', 'SENDER_NOT_VERIFIED']) {
        for (const odd of [{ attemptCount: -1 }, { attemptCount: 1.5 }, { attemptCount: '1' }, { attemptCount: null }, { lastAttemptAt: '2026-10-05T12:00:00.000Z' }, { lastAttemptAt: 0 }, { lastAttemptAt: new Date('invalid') }]) {
          states.push(state({ status, attemptCount: 1, lastErrorCode, lastAttemptAt: at(0), ...odd }));
        }
      }
    }
    states.push(undefined, null, state({ status: 'BOGUS', attemptCount: 1, lastErrorCode: 'PROVIDER_UNAVAILABLE', lastAttemptAt: at(0) }), withoutAttemptCount);
    const mismatches = [];
    let checked = 0;
    let due = 0;
    for (const options of [{}, { includeUncertain: true }, { includeConfiguration: true }, { includeUncertain: true, includeConfiguration: true }]) {
      for (const acknowledgementEnabled of [false, true]) {
        const filter = notificationDueFilter({ now, policy: POLICY, acknowledgementEnabled, ...options });
        for (const submittedAt of [T0, ago(MINUTE), ago(MINUTE - 1), null, new Date('invalid')]) {
          for (const channelState of states) {
            for (const channel of ['internal', 'candidateAcknowledgement']) {
              const other = channel === 'internal' ? 'candidateAcknowledgement' : 'internal';
              const record = { submittedAt, notifications: { [channel]: channelState, [other]: NOT_REQUIRED() } };
              const assessed = assessChannel(channelState, { channel, now, submittedAt, acknowledgementEnabled, ...POLICY, ...options });
              if (matchesFilter(record, filter) !== assessed.due) mismatches.push({ channel, channelState, options, acknowledgementEnabled, assessed });
              checked += 1;
              due += assessed.due ? 1 : 0;
            }
          }
        }
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(checked).toBeGreaterThan(200_000);
    expect(due).toBeGreaterThan(1_000);
    // r8: an exhaustive, CPU-bound check (> 200,000 comparisons) that takes 4-5 s on a slower host — at the edge of
    // vitest's default 5 s budget, where it timed out in complete runs. Its own budget; no assertion changed.
  }, 60_000);

  it('states outside the schema are UNSUPPORTED — never due, whatever the operator includes (r2 re-review; a non-date time only where the time decides)', () => {
    const options = { channel: 'internal', now: at(24 * 60 * MINUTE), submittedAt: T0, acknowledgementEnabled: true, ...POLICY, includeUncertain: true, includeConfiguration: true };
    for (const odd of [undefined, null, state({ status: 'BOGUS' }), state({ status: 'FAILED', attemptCount: -1, lastErrorCode: 'PROVIDER_UNAVAILABLE', lastAttemptAt: at(0) }), state({ status: 'FAILED', attemptCount: 1.5, lastErrorCode: 'TIMEOUT', lastAttemptAt: at(0) }), state({ status: 'FAILED', attemptCount: 1, lastErrorCode: 'PROVIDER_UNAVAILABLE', lastAttemptAt: 'yesterday' }), state({ status: 'PENDING', attemptCount: 1, lastErrorCode: 'ATTEMPT_IN_PROGRESS', lastAttemptAt: 'yesterday' })]) {
      expect(assessChannel(odd, options), JSON.stringify(odd)).toEqual({ category: 'UNSUPPORTED', due: false });
    }
    expect(assessChannel(state(), { ...options, submittedAt: null })).toEqual({ category: 'UNSUPPORTED', due: false });
  });

  it('an unrecognised code named like a built-in JavaScript property is UNCERTAIN too — a run without --include-uncertain never sends it (r2 re-review)', async () => {
    const { repo, notifier, transport, setNow } = setup({ acknowledgementEnabled: true });
    const later = at(24 * 60 * MINUTE);
    const ids = [];
    for (const code of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      // The internal channel is due (never attempted) and selects the row; the acknowledgement holds the odd code.
      ids.push(seed(repo, { candidateAcknowledgement: state({ status: 'FAILED', attemptCount: 1, lastAttemptAt: at(0), lastErrorCode: code }) }));
    }
    setNow(later);
    const report = await runNotificationRetry({ applications: repo, notifier, clock: () => later, policy: POLICY, send: true });
    expect(report.categories.candidateAcknowledgement).toEqual({ UNCERTAIN: 4 });
    expect(transport.calls.map((message) => message.event)).toEqual(Array(4).fill('APPLICATION_RECEIVED_INTERNAL'));
    for (const id of ids) expect(stored(repo, id).candidateAcknowledgement).toMatchObject({ status: 'FAILED', attemptCount: 1 });
  });

  it('an unrecognised (legacy) FAILED code is UNCERTAIN: never selected automatically; reachable only with includeUncertain (r2)', () => {
    const now = at(30 * 24 * 60 * MINUTE);
    const legacy = state({ status: 'FAILED', attemptCount: 1, lastErrorCode: 'LEGACY_PROVIDER_ERROR', lastAttemptAt: at(0) });
    const record = { submittedAt: T0, notifications: { internal: legacy, candidateAcknowledgement: NOT_REQUIRED() } };
    for (const includeUncertain of [false, true]) {
      const assessed = assessChannel(legacy, { channel: 'internal', now, submittedAt: T0, acknowledgementEnabled: false, ...POLICY, includeUncertain });
      expect(assessed).toEqual({ category: 'UNCERTAIN', due: includeUncertain });
      expect(matchesFilter(record, notificationDueFilter({ now, policy: POLICY, includeUncertain }))).toBe(includeUncertain);
    }
  });
});

describe('the first attempt (notifyAccepted)', () => {
  it('not configured: nothing claimed, nothing written', async () => {
    const { repo, notifier } = setup({ transport: null });
    const id = seed(repo);
    expect(await notifier.notifyAccepted(await repo.loadForUpdate(id))).toEqual({ attempted: false, reason: 'NOT_CONFIGURED' });
    expect(repo.calls.claimNotificationAttempts).toBe(0);
    expect(stored(repo, id).internal).toEqual(state());
  });

  it('only never-attempted PENDING channels; the acknowledgement only when enabled', async () => {
    const { repo, notifier, transport } = setup({ acknowledgementEnabled: false });
    const id = seed(repo, { candidateAcknowledgement: state() });
    const result = await notifier.notifyAccepted(await repo.loadForUpdate(id));
    expect(Object.keys(result.outcomes)).toEqual(['internal']);
    expect(transport.calls).toHaveLength(1);
    expect(stored(repo, id).candidateAcknowledgement).toEqual(state());
  });

  it('both channels, in parallel: each recorded with its own outcome; one attempt each', async () => {
    const { repo, notifier, transport } = setup({ acknowledgementEnabled: true });
    const id = seed(repo, { candidateAcknowledgement: state() });
    const result = await notifier.notifyAccepted(await repo.loadForUpdate(id));
    expect(result).toMatchObject({ attempted: true, recorded: true });
    expect(stored(repo, id)).toEqual({
      internal: { status: 'SENT', attemptCount: 1, lastAttemptAt: T0, sentAt: T0, lastErrorCode: null },
      candidateAcknowledgement: { status: 'SENT', attemptCount: 1, lastAttemptAt: T0, sentAt: T0, lastErrorCode: null },
    });
    expect(transport.calls.map((message) => [message.event, message.to[0]])).toEqual([
      ['APPLICATION_RECEIVED_INTERNAL', QA_NOTIFICATION_OPTIONS.internalRecipient],
      ['APPLICATION_ACKNOWLEDGEMENT', 'qa.candidate@qa-valida.example.test'],
    ]);
  });

  it('partial failure: the internal email accepted, the acknowledgement suppressed — each channel tells its own truth', async () => {
    const transport = recordingTransport((message) => (message.event === 'APPLICATION_ACKNOWLEDGEMENT' ? 'SUPPRESSED' : 'accept'));
    const { repo, notifier, events } = setup({ transport, acknowledgementEnabled: true });
    const id = seed(repo, { candidateAcknowledgement: state() });
    await notifier.notifyAccepted(await repo.loadForUpdate(id));
    expect(stored(repo, id)).toEqual({
      internal: { status: 'SENT', attemptCount: 1, lastAttemptAt: T0, sentAt: T0, lastErrorCode: null },
      candidateAcknowledgement: { status: 'FAILED', attemptCount: 1, lastAttemptAt: T0, sentAt: null, lastErrorCode: 'SUPPRESSED' },
    });
    expect(events('notification_attempted').map(({ channel, outcome, errorCode, errorClass }) => ({ channel, outcome, errorCode, errorClass }))).toEqual([
      { channel: 'internal', outcome: 'SENT', errorCode: undefined, errorClass: undefined },
      { channel: 'candidateAcknowledgement', outcome: 'FAILED', errorCode: 'SUPPRESSED', errorClass: 'PERMANENT' },
    ]);
  });

  it('a Notification Service that misbehaves (answers NOT_ATTEMPTED, or throws) is recorded as INTERNAL_ERROR, never left in progress', async () => {
    const { repo } = setup();
    for (const deliver of [async () => ({ status: 'NOT_ATTEMPTED', reason: 'x' }), async () => Promise.reject(new Error('qa: deliver threw'))]) {
      const id = seed(repo);
      const broken = createApplicationNotifier({
        applications: repo,
        notifications: { configured: true, acknowledgementEnabled: false, providerName: 'qa', deliver },
        clock: () => T0,
        logger: capturingLogger().logger,
      });
      expect(await broken.notifyAccepted(await repo.loadForUpdate(id))).toMatchObject({ attempted: true, recorded: true });
      expect(stored(repo, id).internal).toMatchObject({ status: 'FAILED', attemptCount: 1, lastErrorCode: 'INTERNAL_ERROR' });
    }
  });

  it('a transport that throws an unclassified error is PROVIDER_ERROR (uncertain) — recorded, not retried automatically', async () => {
    const { repo, notifier } = setup({ transport: recordingTransport(new Error('qa: transport threw')) });
    const id = seed(repo);
    await notifier.notifyAccepted(await repo.loadForUpdate(id));
    expect(stored(repo, id).internal).toMatchObject({ status: 'FAILED', attemptCount: 1, lastErrorCode: 'PROVIDER_ERROR' });
  });
});

/*
 * r2 (GPT review finding 1): a provider-returned identifier can be anything —
 * including an email address — and no format check proves otherwise. The
 * REAL Notification Service, the REAL notifier and the REAL pino logger
 * (capturingLogger serialises exactly what a log file would receive) are
 * composed here; only the transport is a double.
 */
describe('provider-returned identifiers never reach logs, outcomes, stored state or reports (r2)', () => {
  const RETURNED = [
    'reviewer@example.invalid',
    'Reviewer.Name+tag@Example.Invalid',
    '<0100018f.qa-reviewer@email.provider.example.invalid>',
    'opaque-SECRET-token-7f3a9c0e1b2d',
    'qa.candidate@qa-valida.example.test',
  ];
  const returningTransport = (value) => {
    const transport = {
      name: 'qa-test-double',
      calls: [],
      async send(message) {
        transport.calls.push(message);
        return { providerMessageId: value, MessageID: value, id: value, response: { To: value, ErrorCode: 0, Message: `OK ${value}` } };
      },
      async verify() {},
    };
    return transport;
  };

  it.each(RETURNED)('%s — first attempt (both channels) and a retry run', async (value) => {
    const transport = returningTransport(value);
    const { repo, notifier, log, setNow } = setup({ transport, acknowledgementEnabled: true });
    const first = seed(repo, { candidateAcknowledgement: state() });
    const retried = seed(repo, { internal: state({ status: 'FAILED', attemptCount: 1, lastAttemptAt: at(0), lastErrorCode: 'PROVIDER_UNAVAILABLE' }) });

    const accepted = await notifier.notifyAccepted(await repo.loadForUpdate(first), { requestId: 'qa-request-1' });
    const later = at(24 * 60 * MINUTE);
    setNow(later);
    const report = await runNotificationRetry({ applications: repo, notifier, clock: () => later, policy: POLICY, send: true });

    expect(transport.calls).toHaveLength(3);
    expect(report.results.SENT).toBe(1);
    const output = log.output();
    for (const text of [output, JSON.stringify(accepted), JSON.stringify(report), JSON.stringify(repo.all().map((record) => record.notifications))]) {
      expect(text).not.toContain(value);
      expect(text.toLowerCase()).not.toContain(value.toLowerCase());
    }
    // Correlation stays possible through Valida's own identifiers.
    const attempted = output
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.event === 'notification_attempted');
    expect(attempted).toHaveLength(3);
    for (const entry of attempted) {
      expect(entry).not.toHaveProperty('providerMessageId');
      expect(entry).toMatchObject({ applicationId: expect.any(String), channel: expect.any(String), notificationEvent: expect.any(String), attempt: expect.any(Number), outcome: 'SENT', provider: 'qa-test-double' });
    }
    expect(attempted.map((entry) => [entry.applicationId, entry.channel, entry.attempt]).sort()).toEqual(
      [
        [String(first), 'candidateAcknowledgement', 1],
        [String(first), 'internal', 1],
        [String(retried), 'internal', 2],
      ].sort(),
    );
  });
});

describe('concurrency and duplicate-send risk (the conditional claim)', () => {
  it('two concurrent attempts on the same Application: exactly one claims and sends; the other sends NOTHING', async () => {
    const { repo, notifier, transport, events } = setup();
    const id = seed(repo, { internal: state({ status: 'FAILED', attemptCount: 1, lastAttemptAt: at(-60 * MINUTE), lastErrorCode: 'PROVIDER_UNAVAILABLE' }) });
    const [first, second] = [await repo.loadForUpdate(id), await repo.loadForUpdate(id)];
    const results = await Promise.all([notifier.retry(first, ['internal']), notifier.retry(second, ['internal'])]);
    expect(results.map((result) => result.attempted).sort()).toEqual([false, true]);
    expect(results.find((result) => !result.attempted).reason).toBe('CLAIM_LOST');
    expect(transport.calls).toHaveLength(1);
    expect(stored(repo, id).internal).toMatchObject({ status: 'SENT', attemptCount: 2 });
    expect(events('notification_claim_lost')).toHaveLength(1);
  });

  it('a stale copy (loaded before another attempt) can neither claim nor overwrite the recorded outcome', async () => {
    const { repo, notifier, transport } = setup();
    const id = seed(repo);
    const stale = await repo.loadForUpdate(id);
    await notifier.notifyAccepted(await repo.loadForUpdate(id));
    expect(stored(repo, id).internal.status).toBe('SENT');
    expect(await notifier.notifyAccepted(stale)).toEqual({ attempted: false, reason: 'CLAIM_LOST' });
    expect(await repo.recordNotificationOutcomes(stale, { internal: { status: 'FAILED', errorCode: 'TIMEOUT' } })).toBe('LOST');
    expect(stored(repo, id).internal).toMatchObject({ status: 'SENT', attemptCount: 1 });
    expect(transport.calls).toHaveLength(1);
  });

  it('the claim cannot be written (database): nothing is sent; the state is unchanged', async () => {
    const { repo, notifier, transport, events } = setup();
    const id = seed(repo);
    repo.faults.claimNotification = dbUnavailable('timeout');
    expect(await notifier.notifyAccepted(await repo.loadForUpdate(id))).toEqual({ attempted: false, reason: 'CLAIM_FAILED' });
    expect(transport.calls).toHaveLength(0);
    expect(stored(repo, id).internal).toEqual(state());
    expect(events('notification_claim_failed')).toHaveLength(1);
  });

  it('the claim was applied but its acknowledgement was lost: nothing is sent; the attempt reads as uncertain (counted, not sent)', async () => {
    const { repo, notifier, transport, events } = setup();
    const id = seed(repo);
    repo.faults.claimNotificationAppliedThenFails = dbUnavailable('timeout');
    expect(await notifier.notifyAccepted(await repo.loadForUpdate(id))).toEqual({ attempted: false, reason: 'CLAIM_FAILED' });
    expect(transport.calls).toHaveLength(0);
    expect(stored(repo, id).internal).toEqual(state({ attemptCount: 1, lastAttemptAt: T0, lastErrorCode: 'ATTEMPT_IN_PROGRESS' }));
    expect(events('notification_claim_failed')).toHaveLength(1);
    // Never re-sent automatically; an operator's --include-uncertain run picks it up after the stale threshold.
    repo.faults.claimNotificationAppliedThenFails = null;
    const later = at(POLICY.staleMs + 1);
    expect((await runNotificationRetry({ applications: repo, notifier, clock: () => later, policy: POLICY })).due).toBe(0);
    expect((await runNotificationRetry({ applications: repo, notifier, clock: () => later, policy: POLICY, includeUncertain: true })).due).toBe(1);
  });

  it('the outcome cannot be recorded: the claim stays ATTEMPT_IN_PROGRESS and is never re-sent automatically', async () => {
    const { repo, notifier, transport, events, setNow } = setup();
    const id = seed(repo);
    repo.faults.recordNotification = dbUnavailable('timeout');
    const result = await notifier.notifyAccepted(await repo.loadForUpdate(id));
    expect(result).toMatchObject({ attempted: true, recorded: false, outcomes: { internal: { status: 'SENT' } } });
    expect(stored(repo, id).internal).toEqual(state({ attemptCount: 1, lastAttemptAt: T0, lastErrorCode: 'ATTEMPT_IN_PROGRESS' }));
    expect(events('notification_state_unrecorded')).toEqual([expect.objectContaining({ outcomes: { internal: 'SENT' } })]);
    // A retry run neither during nor after the stale threshold sends it again.
    repo.faults.recordNotification = null;
    setNow(at(POLICY.staleMs + 1));
    const report = await runNotificationRetry({ applications: repo, notifier, clock: () => at(POLICY.staleMs + 1), policy: POLICY, send: true });
    expect(report.due).toBe(0);
    expect(transport.calls).toHaveLength(1);
  });
});

describe('runNotificationRetry (ops:notifications:retry)', () => {
  const later = at(24 * 60 * MINUTE);
  // One clock for the run and the notifier, as in the command.
  const retry = (context, options = {}, now = later) => {
    context.setNow(now);
    return runNotificationRetry({ applications: context.repo, notifier: context.notifier, clock: context.clock, policy: POLICY, ...options });
  };

  function population(context) {
    const { repo } = context;
    return {
      unattempted: seed(repo, { submittedAt: at(-MINUTE) }),
      transient: seed(repo, { internal: state({ status: 'FAILED', attemptCount: 1, lastAttemptAt: at(0), lastErrorCode: 'PROVIDER_UNAVAILABLE' }) }),
      timeout: seed(repo, { internal: state({ status: 'FAILED', attemptCount: 1, lastAttemptAt: at(0), lastErrorCode: 'TIMEOUT' }) }),
      configuration: seed(repo, { internal: state({ status: 'FAILED', attemptCount: 1, lastAttemptAt: at(0), lastErrorCode: 'SENDER_NOT_VERIFIED' }) }),
      suppressed: seed(repo, { internal: state({ status: 'FAILED', attemptCount: 1, lastAttemptAt: at(0), lastErrorCode: 'SUPPRESSED' }) }),
      exhausted: seed(repo, { internal: state({ status: 'FAILED', attemptCount: 5, lastAttemptAt: at(0), lastErrorCode: 'PROVIDER_UNAVAILABLE' }) }),
      sent: seed(repo, { internal: state({ status: 'SENT', attemptCount: 1, lastAttemptAt: at(0), sentAt: at(0) }) }),
    };
  }

  it('dry run: reports what is due, writes and sends nothing', async () => {
    const context = setup();
    const ids = population(context);
    const before = JSON.stringify(context.repo.all());
    const report = await retry(context);
    expect(report).toMatchObject({ send: false, scanned: 2, due: 2, limitReached: false });
    expect(report.categories.internal).toEqual({ UNATTEMPTED: 1, TRANSIENT_DUE: 1 });
    expect(report.items).toEqual([
      { applicationId: ids.unattempted, channels: ['internal'], action: 'WOULD_SEND' },
      { applicationId: ids.transient, channels: ['internal'], action: 'WOULD_SEND' },
    ]);
    expect(JSON.stringify(context.repo.all())).toBe(before);
    expect(context.transport.calls).toHaveLength(0);
    expect(context.repo.calls.claimNotificationAttempts).toBe(0);
  });

  it('--send: only eligible notifications; PERMANENT, EXHAUSTED, UNCERTAIN and CONFIGURATION are left alone', async () => {
    const context = setup();
    const ids = population(context);
    const report = await retry(context, { send: true });
    expect(report.results).toEqual({ SENT: 2, FAILED: 0, CLAIM_LOST: 0, CLAIM_FAILED: 0, NOT_ATTEMPTED: 0, UNRECORDED: 0, NOT_LOADED: 0, NO_LONGER_DUE: 0 });
    expect(stored(context.repo, ids.unattempted).internal).toMatchObject({ status: 'SENT', attemptCount: 1 });
    expect(stored(context.repo, ids.transient).internal).toMatchObject({ status: 'SENT', attemptCount: 2, sentAt: later });
    for (const untouched of ['timeout', 'configuration', 'suppressed', 'exhausted']) {
      expect(stored(context.repo, ids[untouched]).internal.attemptCount, untouched).toBe(untouched === 'exhausted' ? 5 : 1);
      expect(stored(context.repo, ids[untouched]).internal.status, untouched).toBe('FAILED');
    }
    expect(context.transport.calls).toHaveLength(2);
    // Running again finds nothing due: no duplicate.
    expect((await retry(context, { send: true })).due).toBe(0);
    expect(context.transport.calls).toHaveLength(2);
  });

  it('--include-uncertain / --include-configuration widen the run explicitly; permanent stays excluded', async () => {
    const context = setup();
    const ids = population(context);
    const report = await retry(context, { send: true, includeUncertain: true, includeConfiguration: true });
    expect(report.results.SENT).toBe(4);
    expect(stored(context.repo, ids.timeout).internal).toMatchObject({ status: 'SENT', attemptCount: 2 });
    expect(stored(context.repo, ids.configuration).internal).toMatchObject({ status: 'SENT', attemptCount: 2 });
    expect(stored(context.repo, ids.suppressed).internal).toMatchObject({ status: 'FAILED', attemptCount: 1 });
  });

  it('a transient failure again: recorded FAILED with the next attempt count, then waits for its backoff', async () => {
    const context = setup({ transport: recordingTransport('RATE_LIMITED') });
    const id = seed(context.repo, { internal: state({ status: 'FAILED', attemptCount: 1, lastAttemptAt: at(0), lastErrorCode: 'PROVIDER_UNAVAILABLE' }) });
    expect((await retry(context, { send: true })).results.FAILED).toBe(1);
    expect(stored(context.repo, id).internal).toMatchObject({ status: 'FAILED', attemptCount: 2, lastAttemptAt: later, lastErrorCode: 'RATE_LIMITED' });
    const soon = await retry(context, { send: true }, new Date(later.getTime() + MINUTE));
    // Waiting out its backoff: not even scanned (it cannot be due in this run).
    expect(soon.scanned).toBe(0);
    expect(soon.due).toBe(0);
    expect(assessChannel(stored(context.repo, id).internal, { channel: 'internal', now: new Date(later.getTime() + MINUTE), submittedAt: T0, acknowledgementEnabled: false, ...POLICY })).toEqual({ category: 'TRANSIENT_WAITING', due: false });
  });

  it('bounded: --limit caps the scan, oldest first; refuses limits outside 1..500', async () => {
    const context = setup();
    const ids = [3, 1, 2].map((minutes) => seed(context.repo, { submittedAt: at(-minutes * MINUTE) }));
    const report = await retry(context, { limit: 2 });
    expect(report.items.map((item) => item.applicationId)).toEqual([ids[0], ids[2]]);
    expect(report.limitReached).toBe(true);
    for (const limit of [0, RETRY_LIMITS.maxLimit + 1, 1.5]) await expect(retry(context, { limit })).rejects.toThrow(RangeError);
  });

  it('rows that are not due (backoff running, grace period, permanent, exhausted, uncertain) never fill the bounded scan', async () => {
    const context = setup();
    for (let i = 0; i < 3; i += 1) {
      seed(context.repo, { submittedAt: at(-60 * MINUTE + i), internal: state({ status: 'FAILED', attemptCount: 3, lastAttemptAt: at(24 * 60 * MINUTE - MINUTE), lastErrorCode: 'RATE_LIMITED' }) });
      seed(context.repo, { submittedAt: at(-60 * MINUTE + i), internal: state({ status: 'FAILED', attemptCount: 1, lastAttemptAt: at(0), lastErrorCode: 'SUPPRESSED' }) });
      seed(context.repo, { submittedAt: at(-60 * MINUTE + i), internal: state({ status: 'FAILED', attemptCount: 5, lastAttemptAt: at(0), lastErrorCode: 'PROVIDER_UNAVAILABLE' }) });
      seed(context.repo, { submittedAt: at(-60 * MINUTE + i), internal: state({ status: 'FAILED', attemptCount: 1, lastAttemptAt: at(0), lastErrorCode: 'TIMEOUT' }) });
    }
    const due = seed(context.repo, { submittedAt: at(0), internal: state({ status: 'FAILED', attemptCount: 1, lastAttemptAt: at(0), lastErrorCode: 'PROVIDER_UNAVAILABLE' }) });
    const report = await retry(context, { limit: 1 });
    expect(report.items).toEqual([{ applicationId: due, channels: ['internal'], action: 'WOULD_SEND' }]);
    const summary = await context.repo.summarizeNotificationStates({ maxAttempts: POLICY.maxAttempts });
    expect(summary.internal.exhausted).toBe(3);
  });

  it('acknowledgements: retried only while enabled; never created for an Application accepted while disabled', async () => {
    const enabled = setup({ acknowledgementEnabled: true });
    const pendingAck = seed(enabled.repo, { internal: state({ status: 'SENT', attemptCount: 1, sentAt: at(0), lastAttemptAt: at(0) }), candidateAcknowledgement: state({ status: 'FAILED', attemptCount: 1, lastAttemptAt: at(0), lastErrorCode: 'PROVIDER_UNAVAILABLE' }) });
    const neverRequired = seed(enabled.repo, { internal: state({ status: 'FAILED', attemptCount: 1, lastAttemptAt: at(0), lastErrorCode: 'PROVIDER_UNAVAILABLE' }) });
    await retry(enabled, { send: true });
    expect(stored(enabled.repo, pendingAck).candidateAcknowledgement).toMatchObject({ status: 'SENT', attemptCount: 2 });
    expect(stored(enabled.repo, neverRequired).candidateAcknowledgement).toEqual(NOT_REQUIRED());
    expect(enabled.transport.calls.map((message) => message.event).sort()).toEqual(['APPLICATION_ACKNOWLEDGEMENT', 'APPLICATION_RECEIVED_INTERNAL']);

    const disabled = setup({ acknowledgementEnabled: false });
    const stillPending = seed(disabled.repo, { internal: state({ status: 'SENT', attemptCount: 1, sentAt: at(0), lastAttemptAt: at(0) }), candidateAcknowledgement: state({ status: 'FAILED', attemptCount: 1, lastAttemptAt: at(0), lastErrorCode: 'PROVIDER_UNAVAILABLE' }) });
    const report = await retry(disabled, { send: true });
    expect(report.due).toBe(0);
    expect(stored(disabled.repo, stillPending).candidateAcknowledgement.status).toBe('FAILED');
    expect(disabled.transport.calls).toHaveLength(0);
  });

  it('--send without a provider is refused before anything is read', async () => {
    const context = setup({ transport: null });
    seed(context.repo);
    await expect(retry(context, { send: true })).rejects.toBeInstanceOf(NotificationsNotConfiguredError);
    expect(context.repo.calls.findNotificationCandidates).toBe(0);
    // A dry run still reports.
    expect((await retry(context)).due).toBe(1);
  });

  it('two concurrent runs: every due notification is sent exactly once', async () => {
    const context = setup();
    const ids = [seed(context.repo, { submittedAt: at(-MINUTE) }), seed(context.repo, { submittedAt: at(-MINUTE) })];
    const reports = await Promise.all([retry(context, { send: true }), retry(context, { send: true })]);
    expect(context.transport.calls).toHaveLength(2);
    const total = (key) => reports.reduce((sum, report) => sum + report.results[key], 0);
    expect(total('SENT')).toBe(2);
    expect(total('SENT') + total('CLAIM_LOST') + total('NO_LONGER_DUE')).toBe(4);
    for (const id of ids) expect(stored(context.repo, id).internal).toMatchObject({ status: 'SENT', attemptCount: 1 });
  });

  it('one Application failing to load does not stop the run; it is counted', async () => {
    const context = setup();
    seed(context.repo, { submittedAt: at(-MINUTE) });
    context.repo.faults.loadForUpdate = dbUnavailable('timeout');
    const report = await retry(context, { send: true });
    expect(report.results.NOT_LOADED).toBe(1);
    expect(context.transport.calls).toHaveLength(0);
  });

  it('the report and the logs carry internal ids and fixed tokens only', async () => {
    const context = setup({ transport: recordingTransport('SUPPRESSED') });
    population(context);
    const report = await retry(context, { send: true });
    const output = `${JSON.stringify(report)}\n${context.log.output()}`;
    for (const marker of ['QA Synthetic Candidate', 'qa.candidate@', QA_NOTIFICATION_OPTIONS.internalRecipient, 'resumes/qa', 'qa-key-hash']) {
      expect(output).not.toContain(marker);
    }
  });
});
