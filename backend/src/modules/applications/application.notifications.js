import {
  CHANNEL_EVENTS,
  ERROR_CODE_CLASSES,
  FAILURE_CLASSES,
  NOTIFICATION_OUTCOMES,
  classifyErrorCode,
} from '../../integrations/notifications/notificationService.js';

/**
 * Application notifications — Milestone B6: WHEN a notification is due, the
 * claim / send / record cycle, and the retry policy.
 *
 * Governed by 09_BACKEND_API_SPEC.md sections 128-136, 10_DATA_MODEL.md
 * sections 117-122, 14_EMAIL_DNS_IDENTITY.md sections 113, 119-121 and 166,
 * 12_CAREERS_APPLICATIONS.md sections 116-117, 13_SECURITY_PRIVACY_THREAT_MODEL.md
 * SEC-086.
 *
 * ONE CYCLE FOR EVERY ATTEMPT — the first one, right after the Application is
 * durably accepted (Doc 09 section 128), and every retry
 * (ops:notifications:retry, Doc 09 section 134):
 *
 *   1. CLAIM the attempt in MongoDB (conditional validated save; see
 *      application.repository.js). LOST -> another process has it: nothing is
 *      sent. Claim outcome unknown -> nothing is sent.
 *   2. SEND each claimed channel through the Notification Service, bounded.
 *   3. RECORD each outcome (conditional). If that fails, the claim's
 *      ATTEMPT_IN_PROGRESS stays — the attempt reads as UNCERTAIN, so it is
 *      never re-sent automatically (a send that may have happened is not
 *      repeated blindly).
 *
 * Nothing here can undo or change the Application itself: only the
 * notification channels are written (Doc 09 section 132; Doc 14 section 119;
 * SEC-086). A replay never reaches this module (Doc 09 section 135).
 *
 * RETRY POLICY (assessChannel; Doc 14 sections 120-121)
 *   UNATTEMPTED        PENDING, never attempted                -> due (after a short grace period)
 *   IN_FLIGHT          ATTEMPT_IN_PROGRESS, recent             -> not due (someone is sending)
 *   UNCERTAIN          ATTEMPT_IN_PROGRESS that went stale, or
 *                      FAILED with an UNCERTAIN code           -> due ONLY with includeUncertain
 *   TRANSIENT_DUE      FAILED, TRANSIENT, backoff elapsed      -> due
 *   TRANSIENT_WAITING  FAILED, TRANSIENT, backoff running      -> not due
 *   CONFIGURATION      FAILED, CONFIGURATION code              -> due ONLY with includeConfiguration
 *   PERMANENT          FAILED, PERMANENT code                  -> never
 *   EXHAUSTED          attemptCount reached the maximum        -> never (counted in the state summary)
 *   DISABLED           acknowledgement no longer enabled       -> never (reported)
 *   SENT / NOT_REQUIRED                                        -> nothing to do
 *   UNSUPPORTED        a state outside the schema (no channel
 *                      state, an unknown status, a non-integer
 *                      or negative attemptCount, or a non-date
 *                      time where the time decides)            -> never (reported; inspect by hand)
 * An unrecognised or missing CODE is not unsupported: it is UNCERTAIN.
 * Backoff: baseDelayMs x 2^(attempts - 1), at most 6 hours.
 */

export const NOTIFICATION_CHANNELS = Object.freeze(['internal', 'candidateAcknowledgement']);

const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;

export const CHANNEL_CATEGORIES = Object.freeze({
  NOT_REQUIRED: 'NOT_REQUIRED',
  SENT: 'SENT',
  DISABLED: 'DISABLED',
  UNATTEMPTED: 'UNATTEMPTED',
  IN_FLIGHT: 'IN_FLIGHT',
  UNCERTAIN: 'UNCERTAIN',
  TRANSIENT_DUE: 'TRANSIENT_DUE',
  TRANSIENT_WAITING: 'TRANSIENT_WAITING',
  CONFIGURATION: 'CONFIGURATION',
  PERMANENT: 'PERMANENT',
  EXHAUSTED: 'EXHAUSTED',
  UNSUPPORTED: 'UNSUPPORTED',
});

const CHANNEL_STATUSES = Object.freeze(['PENDING', 'FAILED', 'SENT', 'NOT_REQUIRED']);
const isValidDate = (value) => value instanceof Date && !Number.isNaN(value.getTime());

/** Delay before retry number `attemptCount + 1` after a transient failure. */
export function backoffMs(attemptCount, baseDelayMs) {
  const exponent = Math.max(0, attemptCount - 1);
  return Math.min(baseDelayMs * 2 ** Math.min(exponent, 30), MAX_BACKOFF_MS);
}

/**
 * An attempt still marked in progress after this long was interrupted: the
 * request or process that claimed it is gone (every send is bounded by
 * NOTIFICATION_TIMEOUT_MS, every write by MONGODB_QUERY_TIMEOUT_MS).
 */
export function staleAfterMs({ notificationTimeoutMs, databaseTimeoutMs = 5_000 }) {
  return Math.max(60_000, 2 * (notificationTimeoutMs + 2 * databaseTimeoutMs));
}

/**
 * Pure retry decision for one channel.
 *
 * @returns {{ category: string, due: boolean }}
 */
export function assessChannel(
  state,
  {
    channel,
    now,
    submittedAt,
    acknowledgementEnabled,
    maxAttempts,
    baseDelayMs,
    staleMs,
    graceMs = staleMs,
    includeUncertain = false,
    includeConfiguration = false,
  },
) {
  const result = (category, due = false) => ({ category, due });
  if (state === null || typeof state !== 'object' || !CHANNEL_STATUSES.includes(state.status)) return result(CHANNEL_CATEGORIES.UNSUPPORTED);
  const status = state.status;
  if (status === 'NOT_REQUIRED') return result(CHANNEL_CATEGORIES.NOT_REQUIRED);
  if (status === 'SENT') return result(CHANNEL_CATEGORIES.SENT);
  if (channel === 'candidateAcknowledgement' && !acknowledgementEnabled) return result(CHANNEL_CATEGORIES.DISABLED);

  const attempts = state.attemptCount;
  if (!Number.isInteger(attempts) || attempts < 0) return result(CHANNEL_CATEGORIES.UNSUPPORTED);
  const rawLastAttemptAt = state.lastAttemptAt ?? null;
  // Only where the time decides (an attempt in progress, a transient backoff)
  // does a non-date lastAttemptAt make the state unsupported.
  const lastAttemptAtUsable = rawLastAttemptAt === null || isValidDate(rawLastAttemptAt);
  const lastAttemptAt = rawLastAttemptAt === null || !lastAttemptAtUsable ? null : rawLastAttemptAt.getTime();
  const code = state.lastErrorCode ?? null;
  const nowMs = now.getTime();

  if (status === 'PENDING' && attempts === 0 && code === null) {
    // A brand-new Application is notified by its own request; the retry
    // command leaves it alone for a grace period instead of racing it.
    if (!isValidDate(submittedAt)) return result(CHANNEL_CATEGORIES.UNSUPPORTED);
    const age = nowMs - submittedAt.getTime();
    return result(CHANNEL_CATEGORIES.UNATTEMPTED, age >= graceMs);
  }

  let errorClass;
  if (code === 'ATTEMPT_IN_PROGRESS') {
    if (!lastAttemptAtUsable) return result(CHANNEL_CATEGORIES.UNSUPPORTED);
    if (lastAttemptAt !== null && nowMs - lastAttemptAt < staleMs) return result(CHANNEL_CATEGORIES.IN_FLIGHT);
    errorClass = FAILURE_CLASSES.UNCERTAIN;
  } else if (status === 'FAILED') {
    errorClass = classifyErrorCode(code);
  } else {
    // PENDING with an attempt but no in-progress marker: not a state this
    // code writes. Treated as uncertain — never sent automatically.
    errorClass = FAILURE_CLASSES.UNCERTAIN;
  }

  if (errorClass === FAILURE_CLASSES.PERMANENT) return result(CHANNEL_CATEGORIES.PERMANENT);
  if (attempts >= maxAttempts) return result(CHANNEL_CATEGORIES.EXHAUSTED);
  if (errorClass === FAILURE_CLASSES.UNCERTAIN) return result(CHANNEL_CATEGORIES.UNCERTAIN, includeUncertain);
  if (errorClass === FAILURE_CLASSES.CONFIGURATION) return result(CHANNEL_CATEGORIES.CONFIGURATION, includeConfiguration);
  // TRANSIENT
  if (!lastAttemptAtUsable) return result(CHANNEL_CATEGORIES.UNSUPPORTED);
  const waitedEnough = lastAttemptAt === null || nowMs - lastAttemptAt >= backoffMs(attempts, baseDelayMs);
  return waitedEnough ? result(CHANNEL_CATEGORIES.TRANSIENT_DUE, true) : result(CHANNEL_CATEGORIES.TRANSIENT_WAITING);
}

/**
 * @param {object} deps
 * @param {ReturnType<import('./application.repository.js').createApplicationRepository>} deps.applications
 * @param {ReturnType<import('../../integrations/notifications/notificationService.js').createNotificationService>} deps.notifications
 * @param {() => Date} deps.clock
 * @param {object} deps.logger
 */
export function createApplicationNotifier({ applications, notifications, clock, logger }) {
  /**
   * One claim / send / record cycle for the given channels of one loaded
   * Application document. Never throws.
   *
   * @returns {Promise<{ attempted: false, reason: string } | { attempted: true, outcomes: Record<string, object>, recorded: boolean }>}
   */
  async function attempt(document, channels, { requestId, trigger }) {
    const applicationId = String(document._id);
    const context = { reqId: requestId, applicationId, trigger };
    if (!notifications.configured) return { attempted: false, reason: 'NOT_CONFIGURED' };
    if (channels.length === 0) return { attempted: false, reason: 'NOTHING_DUE' };

    // 1. Claim.
    let claim;
    try {
      claim = await applications.claimNotificationAttempts(document, channels, { now: clock() });
    } catch {
      logger.error({ ...context, event: 'notification_claim_failed', channels }, 'notification attempt could not be claimed; nothing was sent');
      return { attempted: false, reason: 'CLAIM_FAILED' };
    }
    if (claim !== 'CLAIMED') {
      logger.warn({ ...context, event: 'notification_claim_lost', channels }, 'another process holds this notification attempt; nothing was sent');
      return { attempted: false, reason: 'CLAIM_LOST' };
    }

    // 2. Send — every claimed channel, each bounded, in parallel.
    const input = {
      applicationId,
      job: { title: document.jobSnapshot?.title, slug: document.jobSnapshot?.slug },
      submittedAt: document.submittedAt,
      candidateEmail: document.candidate?.email,
    };
    const results = await Promise.all(
      channels.map(async (channel) => {
        let outcome;
        try {
          outcome = await notifications.deliver(CHANNEL_EVENTS[channel], input);
        } catch {
          outcome = null;
        }
        if (!outcome || outcome.status === NOTIFICATION_OUTCOMES.NOT_ATTEMPTED) {
          outcome = { status: NOTIFICATION_OUTCOMES.FAILED, errorCode: 'INTERNAL_ERROR', errorClass: classifyErrorCode('INTERNAL_ERROR') };
        }
        return [channel, outcome];
      }),
    );
    const outcomes = Object.fromEntries(results);

    // 3. Record.
    let recorded = false;
    try {
      recorded = (await applications.recordNotificationOutcomes(document, outcomes)) === 'RECORDED';
    } catch {
      recorded = false;
    }

    for (const [channel, outcome] of results) {
      const entry = {
        ...context,
        event: 'notification_attempted',
        channel,
        notificationEvent: CHANNEL_EVENTS[channel],
        attempt: document.notifications[channel].attemptCount,
        outcome: outcome.status,
        errorCode: outcome.errorCode,
        errorClass: outcome.errorClass,
        // r4: value-free tokens only (phase, numeric SMTP reply code, enhanced
        // status, constant error code), re-validated by the service — never a
        // reply text, an address or anything the provider chose freely.
        ...(outcome.diagnostic ? { diagnostic: outcome.diagnostic } : {}),
        // The adapter's fixed provider token. No provider-returned identifier
        // is ever logged: correlation is by reqId, applicationId, channel and
        // attempt (r2).
        provider: notifications.providerName,
      };
      if (outcome.status === NOTIFICATION_OUTCOMES.SENT) logger.info(entry, 'notification accepted by the provider (not a delivery confirmation)');
      else logger.warn(entry, 'notification attempt failed');
    }
    if (!recorded) {
      logger.error(
        {
          ...context,
          event: 'notification_state_unrecorded',
          outcomes: Object.fromEntries(results.map(([channel, outcome]) => [channel, outcome.status])),
        },
        'notification outcome could not be recorded; the attempt stays ATTEMPT_IN_PROGRESS (uncertain) and is not re-sent automatically',
      );
    }
    return { attempted: true, outcomes, recorded };
  }

  return Object.freeze({
    get configured() {
      return notifications.configured;
    },
    get acknowledgementEnabled() {
      return notifications.acknowledgementEnabled;
    },

    /**
     * The FIRST attempt for a just-accepted Application (Doc 09 section 128):
     * every channel that is PENDING and has never been attempted.
     */
    async notifyAccepted(document, { requestId } = {}) {
      const channels = NOTIFICATION_CHANNELS.filter((channel) => {
        const state = document.notifications?.[channel];
        if (!state || state.status !== 'PENDING' || (state.attemptCount ?? 0) !== 0 || state.lastErrorCode) return false;
        return channel === 'internal' || notifications.acknowledgementEnabled;
      });
      return attempt(document, channels, { requestId, trigger: 'ACCEPTED' });
    },

    /** One retry cycle for the channels the caller found due (see assessChannel). */
    async retry(document, channels, { requestId } = {}) {
      return attempt(document, channels, { requestId, trigger: 'RETRY' });
    },
  });
}

/** Stored codes of one class (the claim marker is matched separately). */
const codesOf = (errorClass) =>
  Object.entries(ERROR_CODE_CLASSES)
    .filter(([code, codeClass]) => codeClass === errorClass && code !== 'ATTEMPT_IN_PROGRESS')
    .map(([code]) => code);

/**
 * The retry scan's MongoDB filter: EXACTLY the channels assessChannel finds
 * DUE at `now`, for every state a channel can hold — including states this
 * code never writes (a missing or unrecognised code, e.g. from an older
 * adapter; a PENDING channel attempted without the in-progress marker). So
 * rows that cannot be due in this run (waiting out a backoff, inside the
 * grace period, permanent, exhausted, or uncertain / configuration failures
 * the operator did not include) never fill the bounded scan and hide due
 * ones, and every state assessChannel would retry can be reached.
 *
 * Unknown and missing codes are UNCERTAIN (classifyErrorCode): like every
 * uncertain outcome they are selected ONLY with includeUncertain — never by
 * an automatic run.
 *
 * One clause per transient attempt count (0 <= attempts < maxAttempts <= 20)
 * expresses the backoff. MongoDB null semantics are relied on deliberately:
 * `{ f: null }` matches null or missing, `$nin: [null, ...]` excludes both,
 * `$lte` never matches null or a value of another type (a non-date time).
 * States outside the schema are UNSUPPORTED in assessChannel and match no
 * clause here. assessChannel remains the authority: every row
 * is re-assessed, and re-assessed again after it is loaded for its claim.
 * Equivalence is proven by an exhaustive offline property test and against
 * the database in tests/db/b6-notifications.test.js.
 */
export function notificationDueFilter({
  now,
  policy,
  acknowledgementEnabled = false,
  includeUncertain = false,
  includeConfiguration = false,
  graceMs = policy.staleMs,
}) {
  const before = (ms) => new Date(now.getTime() - ms);
  // Exact integers (never a range): a negative, fractional or non-numeric
  // attemptCount is UNSUPPORTED in assessChannel and must not match here.
  const attemptCounts = (from) => Array.from({ length: Math.max(0, policy.maxAttempts - from) }, (_, index) => from + index);
  const belowLimit = { $in: attemptCounts(0) };
  const transientCodes = codesOf(FAILURE_CLASSES.TRANSIENT);
  const classifiedNotUncertain = [
    ...transientCodes,
    ...codesOf(FAILURE_CLASSES.PERMANENT),
    ...codesOf(FAILURE_CLASSES.CONFIGURATION),
  ];
  const clauses = [];
  for (const channel of NOTIFICATION_CHANNELS) {
    if (channel === 'candidateAcknowledgement' && !acknowledgementEnabled) continue;
    const field = (name) => `notifications.${channel}.${name}`;
    const status = field('status');
    const code = field('lastErrorCode');
    const attempts = field('attemptCount');
    const lastAttemptAt = field('lastAttemptAt');

    // Never attempted, past the grace period.
    clauses.push({ [status]: 'PENDING', [attempts]: 0, [code]: null, submittedAt: { $lte: before(graceMs) } });

    // Transient, backoff elapsed (or no attempt time recorded).
    for (let count = 0; count < policy.maxAttempts; count += 1) {
      clauses.push({
        [status]: 'FAILED',
        [code]: { $in: transientCodes },
        [attempts]: count,
        [lastAttemptAt]: { $lte: before(backoffMs(count, policy.baseDelayMs)) },
      });
    }
    clauses.push({ [status]: 'FAILED', [code]: { $in: transientCodes }, [attempts]: belowLimit, [lastAttemptAt]: null });

    if (includeConfiguration) {
      clauses.push({ [status]: 'FAILED', [code]: { $in: codesOf(FAILURE_CLASSES.CONFIGURATION) }, [attempts]: belowLimit });
    }

    if (includeUncertain) {
      // FAILED with an uncertain, unrecognised or missing code.
      clauses.push({ [status]: 'FAILED', [code]: { $nin: [...classifiedNotUncertain, 'ATTEMPT_IN_PROGRESS'] }, [attempts]: belowLimit });
      // An interrupted attempt: the in-progress marker went stale (or has no time).
      for (const time of [{ $lte: before(policy.staleMs) }, null]) {
        clauses.push({ [status]: { $in: ['PENDING', 'FAILED'] }, [code]: 'ATTEMPT_IN_PROGRESS', [attempts]: belowLimit, [lastAttemptAt]: time });
      }
      // PENDING in a state this code does not write: any other code, or attempted without a marker.
      clauses.push({ [status]: 'PENDING', [code]: { $nin: [null, 'ATTEMPT_IN_PROGRESS'] }, [attempts]: belowLimit });
      clauses.push({ [status]: 'PENDING', [code]: null, [attempts]: { $in: attemptCounts(1) } });
    }
  }
  return { $or: clauses };
}

/** Bounds of one retry run (ops:notifications:retry). */
export const RETRY_LIMITS = Object.freeze({ defaultLimit: 50, maxLimit: 500 });

/**
 * One controlled retry run (Doc 09 section 134; Doc 14 sections 120-121) —
 * the core of `npm run ops:notifications:retry`, testable without a process.
 *
 * Scans at most `limit` Applications with a channel DUE now
 * (notificationDueFilter; the scan reads notification state only — no
 * candidate data), assesses every channel with assessChannel and, only when
 * `send` is true, runs one
 * claim / send / record cycle per Application for the channels that are due.
 * Each due Application is re-loaded and re-assessed right before its claim;
 * the claim itself is conditional, so a concurrent run, a concurrent request
 * or a state change since the scan makes it LOST and nothing is sent.
 *
 * Never throws for one Application's failure: it is counted and the run goes
 * on. A failed scan rejects (the caller reports it; nothing was sent).
 *
 * @returns {Promise<{ now: Date, send: boolean, scanned: number, categories: object, due: number, results: object, items: object[] }>}
 *   `items` carries internal Application ids, channel names and fixed tokens only.
 */
export async function runNotificationRetry({
  applications,
  notifier,
  clock,
  policy,
  send = false,
  limit = RETRY_LIMITS.defaultLimit,
  includeUncertain = false,
  includeConfiguration = false,
  requestId = 'ops-notifications-retry',
}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > RETRY_LIMITS.maxLimit) {
    throw new RangeError(`limit must be an integer from 1 to ${RETRY_LIMITS.maxLimit}`);
  }
  if (send && !notifier.configured) throw new NotificationsNotConfiguredError();

  const now = clock();
  const assessment = (state, channel, submittedAt) =>
    assessChannel(state, {
      channel,
      now,
      submittedAt,
      acknowledgementEnabled: notifier.acknowledgementEnabled,
      maxAttempts: policy.maxAttempts,
      baseDelayMs: policy.baseDelayMs,
      staleMs: policy.staleMs,
      includeUncertain,
      includeConfiguration,
    });

  const rows = await applications.findNotificationCandidates({
    limit,
    filter: notificationDueFilter({ now, policy, acknowledgementEnabled: notifier.acknowledgementEnabled, includeUncertain, includeConfiguration }),
  });
  const categories = Object.fromEntries(NOTIFICATION_CHANNELS.map((channel) => [channel, {}]));
  const results = { SENT: 0, FAILED: 0, CLAIM_LOST: 0, CLAIM_FAILED: 0, NOT_ATTEMPTED: 0, UNRECORDED: 0, NOT_LOADED: 0, NO_LONGER_DUE: 0 };
  const items = [];
  let due = 0;

  for (const row of rows) {
    const dueChannels = [];
    for (const channel of NOTIFICATION_CHANNELS) {
      const { category, due: channelDue } = assessment(row.notifications?.[channel], channel, row.submittedAt);
      categories[channel][category] = (categories[channel][category] ?? 0) + 1;
      if (channelDue) dueChannels.push(channel);
    }
    if (dueChannels.length === 0) continue;
    due += 1;
    const applicationId = String(row._id);
    if (!send) {
      items.push({ applicationId, channels: dueChannels, action: 'WOULD_SEND' });
      continue;
    }

    let document;
    try {
      document = await applications.loadForUpdate(row._id);
    } catch {
      document = null;
    }
    if (!document) {
      results.NOT_LOADED += 1;
      items.push({ applicationId, channels: dueChannels, action: 'NOT_LOADED' });
      continue;
    }
    // Re-assessed on the freshly loaded state.
    const channels = dueChannels.filter((channel) => assessment(document.notifications?.[channel], channel, document.submittedAt).due);
    if (channels.length === 0) {
      results.NO_LONGER_DUE += 1;
      items.push({ applicationId, channels: dueChannels, action: 'NO_LONGER_DUE' });
      continue;
    }
    const outcome = await notifier.retry(document, channels, { requestId });
    if (!outcome.attempted) {
      const key = outcome.reason === 'CLAIM_LOST' || outcome.reason === 'CLAIM_FAILED' ? outcome.reason : 'NOT_ATTEMPTED';
      results[key] += 1;
      items.push({ applicationId, channels, action: key });
      continue;
    }
    const perChannel = {};
    for (const [channel, channelOutcome] of Object.entries(outcome.outcomes)) {
      results[channelOutcome.status === NOTIFICATION_OUTCOMES.SENT ? 'SENT' : 'FAILED'] += 1;
      perChannel[channel] = channelOutcome.status === NOTIFICATION_OUTCOMES.SENT ? 'SENT' : `FAILED:${channelOutcome.errorCode}`;
    }
    if (!outcome.recorded) results.UNRECORDED += 1;
    items.push({ applicationId, channels, action: outcome.recorded ? 'ATTEMPTED' : 'ATTEMPTED_UNRECORDED', outcomes: perChannel });
  }

  return { now, send, scanned: rows.length, limitReached: rows.length === limit, categories, due, results, items };
}

/** `--send` without a configured provider transport. */
export class NotificationsNotConfiguredError extends Error {
  constructor() {
    super('No transactional email provider is configured; nothing can be sent.');
    this.name = 'NotificationsNotConfiguredError';
  }
}
