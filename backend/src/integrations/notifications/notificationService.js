/**
 * Notification boundary — Milestone B5 (the boundary); B6 (the provider).
 *
 * Governed by 09_BACKEND_API_SPEC.md sections 128-136 and 189-190,
 * 10_DATA_MODEL.md sections 117-122, 14_EMAIL_DNS_IDENTITY.md sections 110-121,
 * 163-166 and 180-185, 13_SECURITY_PRIVACY_THREAT_MODEL.md sections 125-127.
 *
 * WHAT B5 ESTABLISHES
 *   Backend business event -> Notification Service -> (transport) -> provider
 *   (Doc 14 section 110). The Application workflow calls ONE method,
 *   notifyApplicationReceived(), only after the Application is durably
 *   persisted (Doc 09 section 128), never on an idempotent replay (section
 *   135), and always within a bounded time (section 136). Whatever happens
 *   here, the accepted Application stays accepted (sections 132, APP-006).
 *
 * WHAT B5 DOES NOT HAVE
 *   A transactional email provider. Its selection is AWAITING INPUT (Doc 14
 *   section 94) and its integration is Milestone B6. With no transport
 *   configured the service makes NO attempt and says so — outcome
 *   NOT_ATTEMPTED / NOT_CONFIGURED — so the Application keeps its internal
 *   notification state PENDING with attemptCount 0: "not yet attempted", never
 *   SENT (Doc 10 section 120; Doc 14 section 198: logging "Email sent!" is not
 *   evidence). B6 delivers the PENDING ones when the provider exists.
 *
 * THE TRANSPORT CONTRACT (for B6)
 *   transport.send(message, { signal }) -> Promise
 *     resolves  the provider ACCEPTED the message. That is not delivery
 *               (Doc 14 section 166); the recorded state SENT means "handed to
 *               the provider", and delivery/bounce state is B6's to add.
 *     rejects   with an error whose `notificationCode` may be one of
 *               TRANSPORT_ERROR_CODES; anything else is recorded as
 *               PROVIDER_ERROR. Nothing from the error's text is kept.
 *   `signal` is aborted when the bound expires so a provider call can stop.
 *
 * THE MESSAGE
 *   Event APPLICATION_RECEIVED_INTERNAL (Doc 14 section 112) carrying only the
 *   internal Application id, the Job title and slug and the submission time.
 *   No candidate name, email, phone, message, answers or resume (Doc 09
 *   sections 189-190; Doc 14 section 115): B6 builds the recruiter email from
 *   the stored record under its own privacy rules, and never attaches the
 *   resume.
 */

export const NOTIFICATION_EVENTS = Object.freeze({
  APPLICATION_RECEIVED_INTERNAL: 'APPLICATION_RECEIVED_INTERNAL',
});

/** The outcome of one notification step. */
export const NOTIFICATION_OUTCOMES = Object.freeze({
  SENT: 'SENT',
  FAILED: 'FAILED',
  NOT_ATTEMPTED: 'NOT_ATTEMPTED',
});

/**
 * The only error classifications ever recorded (Doc 10 section 122: a SAFE
 * operational classification — never a provider response, secret or payload).
 */
export const TRANSPORT_ERROR_CODES = Object.freeze([
  'PROVIDER_REJECTED',
  'PROVIDER_UNAVAILABLE',
  'INVALID_RECIPIENT',
  'SUPPRESSED',
  'PROVIDER_ERROR',
]);
const TIMEOUT = 'TIMEOUT';

/**
 * @param {object} options
 * @param {null | { send: (message: object, options: { signal: AbortSignal }) => Promise<unknown> }} [options.transport]
 *   null in B5: no provider exists yet.
 * @param {number} options.timeoutMs NOTIFICATION_TIMEOUT_MS
 * @param {() => Date} [options.clock]
 */
export function createNotificationService({ transport = null, timeoutMs, clock = () => new Date() } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('createNotificationService: timeoutMs is required');

  return Object.freeze({
    /** Whether a transport exists. In B5 it never does in production. */
    get configured() {
      return transport !== null;
    },

    /**
     * The internal "new Application" notification. Never throws.
     *
     * @param {{ applicationId: string, job: { title: string, slug: string }, submittedAt: Date }} summary
     * @returns {Promise<{ status: 'SENT', attemptedAt: Date, sentAt: Date }
     *                 | { status: 'FAILED', attemptedAt: Date, errorCode: string }
     *                 | { status: 'NOT_ATTEMPTED', reason: 'NOT_CONFIGURED' }>}
     */
    async notifyApplicationReceived(summary) {
      if (transport === null) return { status: NOTIFICATION_OUTCOMES.NOT_ATTEMPTED, reason: 'NOT_CONFIGURED' };

      const message = {
        event: NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL,
        applicationId: String(summary.applicationId),
        job: { title: summary.job.title, slug: summary.job.slug },
        submittedAt: summary.submittedAt,
      };
      const attemptedAt = clock();
      const controller = new AbortController();
      let timer;
      const expired = new Promise((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(TIMEOUT);
        }, timeoutMs);
      });
      try {
        const sending = Promise.resolve().then(() => transport.send(message, { signal: controller.signal }));
        // A send that settles after the bound is absorbed: it cannot change the recorded outcome.
        sending.catch(() => {});
        const result = await Promise.race([sending.then(() => 'ACCEPTED'), expired]);
        if (result === TIMEOUT) return { status: NOTIFICATION_OUTCOMES.FAILED, attemptedAt, errorCode: TIMEOUT };
        return { status: NOTIFICATION_OUTCOMES.SENT, attemptedAt, sentAt: clock() };
      } catch (error) {
        const code = TRANSPORT_ERROR_CODES.includes(error?.notificationCode) ? error.notificationCode : 'PROVIDER_ERROR';
        return { status: NOTIFICATION_OUTCOMES.FAILED, attemptedAt, errorCode: code };
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
