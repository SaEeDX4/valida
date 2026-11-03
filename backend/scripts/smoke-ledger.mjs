/**
 * B6 live smoke test — the submission LEDGER and the HARD MESSAGE BUDGET
 * (r4 review: bounded live message counts).
 *
 * Wraps the REAL transport the smoke test's server uses. Every submission is
 * recorded in the ledger (masked, by the caller's `describe`), and at most
 * `budget` submissions are ever handed to the relay: one more is refused HERE,
 * before any connection, whatever the cause (a defect that sends twice, a
 * retry that should not happen). The plan the script prints states the same
 * number, so a live run can never send more than the owner agreed to.
 *
 * A refused submission throws an error without a transport code; the
 * notification service records that as PROVIDER_ERROR (uncertain — never
 * retried automatically) and the smoke test reports FAIL.
 */
export function createLedgerTransport({ real, budget, ledger, describe, onRefused }) {
  if (!Number.isInteger(budget) || budget < 1) throw new TypeError('createLedgerTransport: budget must be a positive integer');
  if (!Array.isArray(ledger)) throw new TypeError('createLedgerTransport: ledger must be an array');
  return {
    name: real.name,
    verify: (args) => real.verify(args),
    close: () => real.close(),
    async send(message, args) {
      if (ledger.length >= budget) {
        onRefused?.();
        throw Object.assign(new Error('smoke test message budget reached; nothing was submitted'), { code: 'SMOKE_BUDGET_REACHED' });
      }
      const entry = describe(message, args);
      ledger.push(entry);
      try {
        await real.send(message, args);
        entry.result = 'ACCEPTED_BY_RELAY';
      } catch (error) {
        entry.result = `FAILED:${error?.notificationCode ?? 'UNKNOWN'}`;
        if (error?.notificationDiagnostic) entry.diagnostic = error.notificationDiagnostic;
        throw error;
      }
    },
  };
}

/** The most submissions a live run may make: 1 internal + 1 acknowledgement, and the same again for the bounce test. */
export function smokeMessageBudget({ bounce }) {
  return bounce ? 4 : 2;
}
