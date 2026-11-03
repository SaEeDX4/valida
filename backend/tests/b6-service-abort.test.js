import { describe, it, expect } from 'vitest';
import { NOTIFICATION_EVENTS, createNotificationService } from '../src/integrations/notifications/notificationService.js';

/**
 * B6 r4 — the bound on one provider call ends the call; it does not abandon it.
 *
 * Up to r3 the service answered TIMEOUT the moment the bound expired and left
 * the transport call running ("a call that settles after the bound is
 * absorbed"). With a real SMTP connection that is an unfinished send: the
 * socket may still be writing the message. r4: at the bound the signal aborts,
 * the service WAITS (bounded by abortGraceMs) for the transport to stop, and
 * records what the transport established:
 *   - it stopped before handing the message over -> its definitive code
 *     (e.g. PROVIDER_UNAVAILABLE, transient: nothing was submitted);
 *   - it may have handed it over -> OUTCOME_UNKNOWN (never retried automatically);
 *   - the relay accepted it after all -> SENT (the truth, not TIMEOUT);
 *   - it does not stop within the grace period -> TIMEOUT (uncertain).
 *
 * Every transport here is a TEST DOUBLE: it proves the service's handling of
 * the contract, not that any email was sent.
 */
const RECIPIENTS = Object.freeze({
  fromAddress: 'notifications@qa-valida.example.test',
  fromName: 'Valida Careers',
  replyTo: 'careers@qa-valida.example.test',
  internalRecipient: 'recruitment@qa-valida.example.test',
});
const input = () => ({
  applicationId: '65f0c0ffee0000000000abcd',
  job: { title: 'QA Synthetic Apply Role', slug: 'qa-synthetic-apply-role' },
  submittedAt: new Date('2026-09-01T12:34:56.789Z'),
  candidateEmail: 'qa.candidate@qa-valida.example.test',
});
const service = (transport, options = {}) =>
  createNotificationService({ transport, timeoutMs: 80, abortGraceMs: 400, ...RECIPIENTS, ...options });

/**
 * A transport that, like the SMTP adapter, notices the abort and needs a
 * moment to tear its connection down before it settles with `onAbort()`.
 */
function abortAwareTransport(onAbort, { teardownMs = 40 } = {}) {
  const transport = {
    name: 'qa-abort-aware',
    running: 0,
    settledAfterAbort: false,
    send: (_message, { signal }) =>
      new Promise((resolve, reject) => {
        transport.running += 1;
        signal.addEventListener('abort', () => {
          setTimeout(() => {
            transport.running -= 1;
            transport.settledAfterAbort = true;
            try {
              resolve(onAbort());
            } catch (error) {
              reject(error);
            }
          }, teardownMs);
        });
      }),
  };
  return transport;
}
const failWith = (notificationCode) => () => {
  throw Object.assign(new Error('qa transport stopped'), { notificationCode });
};

describe('B6 r4: a timed-out provider call is stopped and awaited, not abandoned', () => {
  it('the transport stopped before submitting: its definitive code is recorded, and nothing is still running', async () => {
    const transport = abortAwareTransport(failWith('PROVIDER_UNAVAILABLE'));
    const outcome = await service(transport).deliver(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, input());
    expect(transport.settledAfterAbort).toBe(true);
    expect(transport.running).toBe(0);
    expect(outcome).toMatchObject({ status: 'FAILED', errorCode: 'PROVIDER_UNAVAILABLE', errorClass: 'TRANSIENT' });
  });

  it('the transport may have submitted: OUTCOME_UNKNOWN (UNCERTAIN), never a transient code', async () => {
    const transport = abortAwareTransport(failWith('OUTCOME_UNKNOWN'));
    const outcome = await service(transport).deliver(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, input());
    expect(transport.running).toBe(0);
    expect(outcome).toMatchObject({ status: 'FAILED', errorCode: 'OUTCOME_UNKNOWN', errorClass: 'UNCERTAIN' });
  });

  it('the relay accepted it while the bound expired: SENT is recorded (the truth), not TIMEOUT', async () => {
    const transport = abortAwareTransport(() => undefined);
    const outcome = await service(transport).deliver(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, input());
    expect(transport.running).toBe(0);
    expect(outcome).toMatchObject({ status: 'SENT' });
  });

  it('a transport that does not stop within the grace period: TIMEOUT (UNCERTAIN), still bounded', async () => {
    const transport = { name: 'qa-ignores-abort', send: () => new Promise(() => {}) };
    const started = Date.now();
    const outcome = await service(transport).deliver(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, input());
    const elapsed = Date.now() - started;
    expect(outcome).toMatchObject({ status: 'FAILED', errorCode: 'TIMEOUT', errorClass: 'UNCERTAIN' });
    expect(elapsed).toBeGreaterThanOrEqual(80 + 400 - 20);
    expect(elapsed).toBeLessThan(80 + 400 + 1_000);
  });

  it('after the bound, an error without a contract code is TIMEOUT (uncertain) — not PROVIDER_ERROR, not transient', async () => {
    const transport = abortAwareTransport(() => {
      throw new DOMException('This operation was aborted', 'AbortError');
    });
    const outcome = await service(transport).deliver(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, input());
    expect(outcome).toMatchObject({ status: 'FAILED', errorCode: 'TIMEOUT', errorClass: 'UNCERTAIN' });
  });

  it('verify(): a timed-out check is stopped and awaited too', async () => {
    let running = 0;
    const transport = {
      name: 'qa-verify',
      send: async () => undefined,
      verify: ({ signal }) =>
        new Promise((_resolve, reject) => {
          running += 1;
          signal.addEventListener('abort', () =>
            setTimeout(() => {
              running -= 1;
              reject(Object.assign(new Error('qa'), { notificationCode: 'PROVIDER_UNAVAILABLE' }));
            }, 40),
          );
        }),
    };
    expect(await service(transport).verify()).toEqual({ ok: false, reason: 'TIMEOUT' });
    expect(running).toBe(0);
  });

  it('abortGraceMs is validated', () => {
    expect(() => service({ name: 'x', send: async () => undefined }, { abortGraceMs: -1 })).toThrow(TypeError);
    expect(() => service({ name: 'x', send: async () => undefined }, { abortGraceMs: 1.5 })).toThrow(TypeError);
  });
});
