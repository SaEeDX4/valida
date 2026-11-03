import { PLAIN_EMAIL_ADDRESS } from '../../config/env.js';
import { renderApplicationAcknowledgement, renderApplicationReceivedInternal, singleLine } from './templates.js';

/**
 * Notification Service — Milestone B5 (the boundary); B6 (events, templates,
 * classification, the provider boundary).
 *
 * Governed by 09_BACKEND_API_SPEC.md sections 128-136 and 189-190,
 * 10_DATA_MODEL.md sections 117-122, 14_EMAIL_DNS_IDENTITY.md sections
 * 93-121, 135-144, 163-167 and 180-186, 13_SECURITY_PRIVACY_THREAT_MODEL.md
 * sections 125-127 and SEC-049/085/086.
 *
 *   Backend business event -> Notification Service -> transport -> provider
 *   (Doc 14 section 110)
 *
 * This module renders ONE message for one event, applies the recipient
 * safeguards, calls the transport within a bounded time and CLASSIFIES the
 * outcome. It never throws, never touches the database and never decides
 * whether a message is due — the Application notifier
 * (modules/applications/application.notifications.js) owns state, claims and
 * retries.
 *
 * THE TRANSPORT CONTRACT (one adapter per provider, Doc 14 section 163)
 *   transport.name                      a fixed provider token (never a secret)
 *   transport.verify({ signal })        REQUIRED for readiness; resolves when
 *                                       the provider credentials/identity are
 *                                       usable — readiness turns `ready` only
 *                                       after it (a transport without one is
 *                                       NOT_VERIFIABLE, never ready)
 *   transport.send(message, { signal, idempotencyKey }) -> Promise<unknown>
 *     resolves  the provider ACCEPTED the message. Not delivery (Doc 14
 *               section 166): SENT means "handed to the provider". The
 *               resolved VALUE IS DISCARDED — a provider message id or any
 *               response body is never returned, stored or logged (r2): no
 *               format check can establish that a provider-chosen identifier
 *               carries no personal data (an address-shaped id passes any
 *               "token" pattern). Correlation uses Valida's own identifiers —
 *               the internal Application id, the event and the attempt
 *               number — which are also sent to the provider as message
 *               metadata, so the provider's own records can be searched by
 *               them.
 *     rejects   with an error whose `notificationCode` is one of
 *               TRANSPORT_ERROR_CODES; anything else is PROVIDER_ERROR
 *               (UNCERTAIN). Nothing from an error's text is ever kept.
 *   `signal` aborts when the bound expires. On abort a transport must STOP
 *   (close its connection) and settle promptly (r4): reject with a
 *   definitive code when it knows the message was NOT handed over (e.g.
 *   PROVIDER_UNAVAILABLE), with OUTCOME_UNKNOWN when it may have been, or
 *   resolve only if the provider accepted it. The service waits for that, at
 *   most abortGraceMs; a transport that does not stop in time is recorded
 *   TIMEOUT (uncertain). A rejection without a contract code after the bound
 *   is TIMEOUT too. `idempotencyKey` ("<event>/<applicationId>") is stable for
 *   one logical message, so an adapter whose provider supports idempotent
 *   requests can make a retry of an uncertain attempt safe (SMTP has no such
 *   mechanism: the SMTP adapter derives a stable Message-ID from it, a
 *   correlation aid only — never exactly-once).
 *
 * PROVIDER (r4). TRANSACTIONAL_EMAIL_PROVIDER=smtp selects the SMTP adapter
 * (smtpTransport.js) for the owner-selected provider (Bluehost Professional
 * Email, powered by Titan). "none" (the default) has no transport: nothing is
 * attempted, nothing is claimed sent, and readiness reports the dependency
 * not implemented. Tests inject test doubles to exercise everything up to the
 * provider call; the SMTP adapter itself is tested against a labelled local
 * SMTP test server — neither is evidence about Titan.
 */

export const NOTIFICATION_EVENTS = Object.freeze({
  APPLICATION_RECEIVED_INTERNAL: 'APPLICATION_RECEIVED_INTERNAL',
  APPLICATION_ACKNOWLEDGEMENT: 'APPLICATION_ACKNOWLEDGEMENT',
});

/** Application notification channel (Doc 10 section 117) -> event (Doc 14 section 112). */
export const CHANNEL_EVENTS = Object.freeze({
  internal: NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL,
  candidateAcknowledgement: NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT,
});

/** The outcome of one delivery attempt. */
export const NOTIFICATION_OUTCOMES = Object.freeze({
  SENT: 'SENT',
  FAILED: 'FAILED',
  NOT_ATTEMPTED: 'NOT_ATTEMPTED',
});

/**
 * How a failure may be retried (Doc 14 sections 120-121).
 *   TRANSIENT       the provider did not accept it, for a passing reason:
 *                   retried automatically, with backoff, up to the attempt limit.
 *   PERMANENT       retrying cannot help (invalid or suppressed recipient, a
 *                   rejected message, a recipient blocked by the safety
 *                   allowlist): never retried.
 *   CONFIGURATION   our side is wrong (credentials, sender identity, a
 *                   template defect): retried only by an operator, after the
 *                   fix (ops:notifications:retry --include-configuration).
 *   UNCERTAIN       the provider MAY have accepted it (a timeout, an outcome
 *                   the transport could not establish, an interrupted
 *                   attempt). Retrying could send it twice: never automatic;
 *                   only by an operator who accepts that risk
 *                   (--include-uncertain).
 */
export const FAILURE_CLASSES = Object.freeze({
  TRANSIENT: 'TRANSIENT',
  PERMANENT: 'PERMANENT',
  CONFIGURATION: 'CONFIGURATION',
  UNCERTAIN: 'UNCERTAIN',
});

/**
 * Every code that may be stored as `lastErrorCode` (Doc 10 section 122: a
 * SAFE operational classification — never a provider response, a secret or
 * any message content) and its class.
 */
export const ERROR_CODE_CLASSES = Object.freeze({
  PROVIDER_UNAVAILABLE: FAILURE_CLASSES.TRANSIENT,
  RATE_LIMITED: FAILURE_CLASSES.TRANSIENT,
  INVALID_RECIPIENT: FAILURE_CLASSES.PERMANENT,
  SUPPRESSED: FAILURE_CLASSES.PERMANENT,
  PROVIDER_REJECTED: FAILURE_CLASSES.PERMANENT,
  RECIPIENT_NOT_ALLOWED: FAILURE_CLASSES.PERMANENT,
  PROVIDER_AUTH_FAILED: FAILURE_CLASSES.CONFIGURATION,
  SENDER_NOT_VERIFIED: FAILURE_CLASSES.CONFIGURATION,
  // r4 (SMTP): the connection to the relay could not be secured — a
  // certificate or host-name failure, an unsupported TLS version, or STARTTLS
  // refused. Nothing was sent and no credential left the process. It may be
  // an attack or a misconfiguration, so an operator investigates first.
  TLS_FAILED: FAILURE_CLASSES.CONFIGURATION,
  TEMPLATE_ERROR: FAILURE_CLASSES.CONFIGURATION,
  // Our own configuration, detected before the provider is called: no usable
  // From address, or no usable / allowlisted INTERNAL recipient. Retried by
  // an operator after the fix — never lost as "permanent".
  SENDER_NOT_CONFIGURED: FAILURE_CLASSES.CONFIGURATION,
  RECIPIENT_NOT_CONFIGURED: FAILURE_CLASSES.CONFIGURATION,
  TIMEOUT: FAILURE_CLASSES.UNCERTAIN,
  OUTCOME_UNKNOWN: FAILURE_CLASSES.UNCERTAIN,
  PROVIDER_ERROR: FAILURE_CLASSES.UNCERTAIN,
  INTERNAL_ERROR: FAILURE_CLASSES.UNCERTAIN,
  // Written BEFORE a send (the claim). Still present later = the attempt was
  // interrupted after it may have reached the provider.
  ATTEMPT_IN_PROGRESS: FAILURE_CLASSES.UNCERTAIN,
});

/** The codes a transport may report. */
export const TRANSPORT_ERROR_CODES = Object.freeze([
  'PROVIDER_UNAVAILABLE',
  'RATE_LIMITED',
  'INVALID_RECIPIENT',
  'SUPPRESSED',
  'PROVIDER_REJECTED',
  'PROVIDER_AUTH_FAILED',
  'SENDER_NOT_VERIFIED',
  'TLS_FAILED',
  'OUTCOME_UNKNOWN',
  'PROVIDER_ERROR',
]);

/** The class of a stored code; anything unrecognised is treated as UNCERTAIN (never retried automatically). */
export function classifyErrorCode(code) {
  // Own keys only: an inherited name ('constructor', 'toString', '__proto__')
  // is an unrecognised code like any other (r2 re-review).
  return typeof code === 'string' && Object.hasOwn(ERROR_CODE_CLASSES, code) ? ERROR_CODE_CLASSES[code] : FAILURE_CLASSES.UNCERTAIN;
}

/**
 * r4 — value-free diagnostics a transport may attach to a rejection
 * (`notificationDiagnostic`), re-validated here whatever the transport sent:
 * the phase reached, a numeric reply code, an enhanced status code and a
 * constant error token. Anything else is dropped. Diagnostics are LOGGED for
 * the operator, never stored (Doc 10 section 122 stores the code only).
 */
const DIAGNOSTIC_PHASES = Object.freeze(['connect', 'session', 'auth', 'envelope', 'data']);
export function safeDiagnostic(raw) {
  if (raw === null || typeof raw !== 'object') return undefined;
  const diagnostic = {};
  if (DIAGNOSTIC_PHASES.includes(raw.phase)) diagnostic.phase = raw.phase;
  if (Number.isInteger(raw.replyCode) && raw.replyCode >= 200 && raw.replyCode <= 599) diagnostic.replyCode = raw.replyCode;
  if (typeof raw.enhancedStatus === 'string' && /^[245]\.\d{1,3}\.\d{1,3}$/.test(raw.enhancedStatus)) diagnostic.enhancedStatus = raw.enhancedStatus;
  if (typeof raw.errorCode === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(raw.errorCode)) diagnostic.errorCode = raw.errorCode;
  return Object.keys(diagnostic).length > 0 ? Object.freeze(diagnostic) : undefined;
}

/**
 * One plain mailbox, safe to hand to a provider as a single recipient: no
 * display name, comment, list, quote, angle bracket, whitespace or control
 * character (Doc 14 section 144; SEC-049). Stricter than the B2 Apply
 * validator on purpose: an address B2 accepted but this refuses is recorded
 * INVALID_RECIPIENT and never reaches the provider.
 */
export function isDeliverableAddress(address) {
  return typeof address === 'string' && address.length <= 254 && PLAIN_EMAIL_ADDRESS.test(address);
}

/** Is `address` allowed by the (development/review) recipient allowlist? */
export function isAllowedRecipient(address, allowlist) {
  if (!allowlist) return true;
  const lower = String(address).toLowerCase();
  const domain = lower.slice(lower.lastIndexOf('@'));
  return allowlist.some((entry) => (entry.startsWith('@') ? entry === domain : entry === lower));
}

const TIMEOUT = Symbol('timeout');

/** Waits for `promise` at most `ms`; resolves TIMEOUT when the wait ends first. */
function settleWithin(promise, ms) {
  let timer;
  const expired = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

/** Default wait for a transport to stop after its bound expired: short, and never longer than the bound itself. */
export function defaultAbortGraceMs(timeoutMs) {
  return Math.min(timeoutMs, 1_000);
}

/** The Notification Service options taken from config.notifications (never the API key — that belongs to the transport). */
export function notificationServiceOptions(settings) {
  if (!settings) return {};
  return {
    fromAddress: settings.fromAddress ?? null,
    fromName: settings.fromName ?? 'Valida Careers',
    replyTo: settings.replyTo ?? null,
    internalRecipient: settings.internalRecipient ?? null,
    acknowledgementEnabled: settings.acknowledgementEnabled === true,
    recipientAllowlist: settings.recipientAllowlist ?? null,
  };
}

/**
 * @param {object} options
 * @param {null | { name: string, send: Function, verify?: Function, close?: Function }} [options.transport]
 *   null until a provider is approved and integrated.
 * @param {number} options.timeoutMs NOTIFICATION_TIMEOUT_MS — bound on one provider call
 * @param {number} [options.abortGraceMs] r4: how long to wait, after the bound
 *   expired and the call was aborted, for the transport to STOP and report
 *   what it established (default: min(timeoutMs, 1000)). One provider call is
 *   therefore bounded by timeoutMs + abortGraceMs in every case.
 * @param {() => Date} [options.clock]
 * @param {string|null} [options.fromAddress] TRANSACTIONAL_FROM_ADDRESS
 * @param {string} [options.fromName] TRANSACTIONAL_FROM_NAME
 * @param {string|null} [options.replyTo] TRANSACTIONAL_REPLY_TO
 * @param {string|null} [options.internalRecipient] RECRUITMENT_NOTIFICATION_RECIPIENT
 * @param {boolean} [options.acknowledgementEnabled] APPLICATION_ACKNOWLEDGEMENT_ENABLED
 * @param {string[]|null} [options.recipientAllowlist] EMAIL_RECIPIENT_ALLOWLIST
 */
export function createNotificationService({
  transport = null,
  timeoutMs,
  abortGraceMs,
  clock = () => new Date(),
  fromAddress = null,
  fromName = 'Valida Careers',
  replyTo = null,
  internalRecipient = null,
  acknowledgementEnabled = false,
  recipientAllowlist = null,
} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('createNotificationService: timeoutMs is required');
  const graceMs = abortGraceMs ?? defaultAbortGraceMs(timeoutMs);
  if (!Number.isInteger(graceMs) || graceMs < 0) throw new TypeError('createNotificationService: abortGraceMs must be a non-negative integer');

  /**
   * Runs one transport call within the bound (r4).
   *
   * At the bound the signal aborts and the call is NOT abandoned: the service
   * waits — at most `graceMs` more — for the transport to stop and report what
   * it established (a transport that holds a connection closes it on abort).
   *
   * @returns {Promise<{ settled: true, timedOut: boolean, ok: true, value: unknown }
   *                 | { settled: true, timedOut: boolean, ok: false, error: unknown }
   *                 | { settled: false, timedOut: true }>}
   */
  async function bounded(call) {
    const controller = new AbortController();
    const running = Promise.resolve()
      .then(() => call(controller.signal))
      .then(
        (value) => ({ settled: true, ok: true, value }),
        (error) => ({ settled: true, ok: false, error }),
      );
    const first = await settleWithin(running, timeoutMs);
    if (first !== TIMEOUT) return { ...first, timedOut: false };
    controller.abort();
    const after = await settleWithin(running, graceMs);
    // Still running after the grace period: nothing more can be learned or
    // done from here. The outcome is UNCERTAIN (TIMEOUT), never transient.
    if (after === TIMEOUT) return { settled: false, timedOut: true };
    return { ...after, timedOut: true };
  }

  /** The stored code for a transport rejection. After the bound, only a contract code counts — anything else is TIMEOUT (uncertain). */
  function failureCode(error, timedOut) {
    if (TRANSPORT_ERROR_CODES.includes(error?.notificationCode)) return error.notificationCode;
    return timedOut ? 'TIMEOUT' : 'PROVIDER_ERROR';
  }

  function render(event, input) {
    if (event === NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL) return renderApplicationReceivedInternal(input);
    if (event === NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT) return renderApplicationAcknowledgement(input);
    throw new TypeError('unknown notification event');
  }

  return Object.freeze({
    /** Whether a transport exists. In B6 r1 production never has one. */
    get configured() {
      return transport !== null;
    },

    /** The transport's fixed provider token, for logs (null without one). */
    get providerName() {
      return transport === null ? null : singleLine(transport.name ?? 'unnamed').slice(0, 40);
    },

    /**
     * Candidate acknowledgement is ON only with a transport AND the explicit
     * switch (Doc 09 section 130; Doc 14 section 113). Configuration already
     * refuses the switch without an operational identity.
     */
    get acknowledgementEnabled() {
      // Configuration already refuses the switch without these; checked again here.
      return transport !== null && acknowledgementEnabled === true && isDeliverableAddress(replyTo) && isDeliverableAddress(fromAddress);
    },

    /**
     * Checks the transport within the bound. Readiness turns `ready` only
     * after this succeeds. Never throws.
     * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
     */
    async verify() {
      if (transport === null) return { ok: false, reason: 'NOT_CONFIGURED' };
      // Nothing verified is not "ready" (Doc 15 section 146).
      if (typeof transport.verify !== 'function') return { ok: false, reason: 'NOT_VERIFIABLE' };
      const result = await bounded((signal) => transport.verify({ signal }));
      // A check that needed the bound is not a pass, whatever it reports afterwards.
      if (result.timedOut) return { ok: false, reason: 'TIMEOUT' };
      if (result.ok) return { ok: true };
      const diagnostic = safeDiagnostic(result.error?.notificationDiagnostic);
      return { ok: false, reason: failureCode(result.error, false), ...(diagnostic ? { diagnostic } : {}) };
    },

    /**
     * Delivers ONE message for one Application event. Never throws.
     *
     * @param {'APPLICATION_RECEIVED_INTERNAL' | 'APPLICATION_ACKNOWLEDGEMENT'} event
     * @param {{ applicationId: string, job: { title: string, slug: string }, submittedAt: Date, candidateEmail?: string }} input
     * @returns {Promise<{ status: 'SENT', attemptedAt: Date, sentAt: Date }
     *                 | { status: 'FAILED', attemptedAt: Date, errorCode: string, errorClass: string }
     *                 | { status: 'NOT_ATTEMPTED', reason: string }>}
     */
    async deliver(event, input) {
      if (transport === null) return { status: NOTIFICATION_OUTCOMES.NOT_ATTEMPTED, reason: 'NOT_CONFIGURED' };
      const attemptedAt = clock();
      const failed = (errorCode, diagnostic) => ({
        status: NOTIFICATION_OUTCOMES.FAILED,
        attemptedAt,
        errorCode,
        errorClass: classifyErrorCode(errorCode),
        ...(diagnostic ? { diagnostic } : {}),
      });

      if (!isDeliverableAddress(fromAddress)) return failed('SENDER_NOT_CONFIGURED');
      const toCandidate = event === NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT;
      const recipient = toCandidate ? input.candidateEmail : internalRecipient;
      // The internal recipient is OUR configuration: a missing, malformed or
      // non-allowlisted one is a configuration failure (retried after the
      // fix). A candidate's address that cannot be used is permanent.
      if (!isDeliverableAddress(recipient)) return failed(toCandidate ? 'INVALID_RECIPIENT' : 'RECIPIENT_NOT_CONFIGURED');
      // Doc 14 sections 182-183: outside production only allowlisted test recipients.
      if (!isAllowedRecipient(recipient, recipientAllowlist)) return failed(toCandidate ? 'RECIPIENT_NOT_ALLOWED' : 'RECIPIENT_NOT_CONFIGURED');

      let rendered;
      try {
        rendered = render(event, input);
      } catch {
        return failed('TEMPLATE_ERROR');
      }

      const message = Object.freeze({
        event,
        from: Object.freeze({ address: fromAddress, name: fromName }),
        to: Object.freeze([recipient]),
        replyTo: isDeliverableAddress(replyTo) ? replyTo : null,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        // Doc 14 section 138: no open or click tracking.
        tracking: Object.freeze({ opens: false, links: false }),
        // Safe identifiers only — never candidate data.
        metadata: Object.freeze({ event, applicationId: String(input.applicationId) }),
      });
      const idempotencyKey = `${event}/${String(input.applicationId)}`;

      const result = await bounded((signal) => transport.send(message, { signal, idempotencyKey }));
      if (!result.settled) return failed('TIMEOUT');
      // Accepted — also when the acceptance arrived while the bound expired:
      // the relay has the message, so SENT is the truth. Whatever the provider
      // returned is deliberately not kept (see the contract above).
      if (result.ok) return { status: NOTIFICATION_OUTCOMES.SENT, attemptedAt, sentAt: clock() };
      return failed(failureCode(result.error, result.timedOut), safeDiagnostic(result.error?.notificationDiagnostic));
    },

    /** Closes the transport, if it holds resources. */
    async close() {
      if (transport && typeof transport.close === 'function') await transport.close();
    },
  });
}
