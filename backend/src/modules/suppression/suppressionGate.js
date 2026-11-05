import { hexValuesMatch } from './suppressionKeys.js';

/**
 * The send-path suppression check for candidate acknowledgements (design rev 8
 * §3.2, §4.4, §4.5.1; OD-2026-11-04-02). It runs AFTER the r9 claim and BEFORE
 * the Notification Service is called, for the acknowledgement channel only;
 * the internal notification never passes through it.
 *
 * Fail closed, never skipped — there is no blind send:
 *
 *   coverage incomplete       -> FAILED / SUPPRESSION_COVERAGE_INCOMPLETE  (CONFIGURATION)
 *   (any reason below; it applies to EVERY acknowledgement, suppressed or not,
 *    because an entry under an unusable key could match any address)
 *   suppressed                -> FAILED / RECIPIENT_SUPPRESSED             (PERMANENT)
 *   read failed or timed out  -> FAILED / SUPPRESSION_CHECK_UNAVAILABLE    (TRANSIENT)
 *   register changed during   -> FAILED / SUPPRESSION_CHECK_UNAVAILABLE    (TRANSIENT;
 *   the check (rev 8.3)          reason REGISTER_CHANGED: an alias prune became
 *                                visible between the reads, so they may not
 *                                describe one state; the normal retry re-checks)
 *   none of these             -> PROCEED (the unchanged r9 delivery)
 *
 * PROCEED needs the register to CONFIRM a stable view (`registerChanged ===
 * false`): a register that cannot say so never authorises a send.
 *
 * Coverage is COMPLETE only when ALL of these hold:
 *   - a current key is configured;
 *   - every configured key (current and verify-only previous) has a key
 *     document that is ACTIVE and whose check value matches the configured
 *     bytes (constant-time);
 *   - every key id that holds ACTIVE entries is configured;
 *   - no key document is RECOVERING (controlled recovery blocks sending until
 *     `recover-key --complete`, even when no entry is left under that id —
 *     the SUP-21 correction of OD-2026-11-04-02);
 *   - the bounded reads did not hit their limits.
 */

export const COVERAGE_REASONS = Object.freeze({
  SUPPRESSION_NOT_CONFIGURED: 'SUPPRESSION_NOT_CONFIGURED',
  CURRENT_KEY_MISSING: 'CURRENT_KEY_MISSING',
  KEY_NOT_CONFIGURED: 'KEY_NOT_CONFIGURED',
  KEY_CHECK_MISSING: 'KEY_CHECK_MISSING',
  KEY_MATERIAL_MISMATCH: 'KEY_MATERIAL_MISMATCH',
  KEY_NOT_TRUSTED: 'KEY_NOT_TRUSTED',
  KEY_RECOVERING: 'KEY_RECOVERING',
  COVERAGE_READ_LIMIT: 'COVERAGE_READ_LIMIT',
});

export const GATE_DECISIONS = Object.freeze({
  PROCEED: 'PROCEED',
  SUPPRESSED: 'SUPPRESSED',
  COVERAGE_INCOMPLETE: 'COVERAGE_INCOMPLETE',
  UNAVAILABLE: 'UNAVAILABLE',
});

/**
 * Pure coverage decision.
 *
 * @param {{ activeKeyIds: string[], keyDocuments: Array<{ _id: string, check: string|null, state: string }>, limitReached?: boolean, keyring: ReturnType<import('./suppressionKeys.js').createKeyring> }} input
 * @returns {{ complete: boolean, problems: Array<{ keyId: string|null, reason: string }>, keys: Array<{ keyId: string, configured: boolean, role: string|null, document: string, check: string }> }}
 */
export function assessCoverage({ activeKeyIds, keyDocuments, limitReached = false, keyring }) {
  const problems = [];
  const documents = new Map((keyDocuments ?? []).map((document) => [String(document._id), document]));
  if (!keyring?.currentKeyId) problems.push({ keyId: null, reason: COVERAGE_REASONS.CURRENT_KEY_MISSING });
  if (limitReached) problems.push({ keyId: null, reason: COVERAGE_REASONS.COVERAGE_READ_LIMIT });

  const keys = [];
  for (const keyId of keyring?.keyIds ?? []) {
    const document = documents.get(keyId);
    let check = 'MISSING';
    if (!document) problems.push({ keyId, reason: COVERAGE_REASONS.KEY_CHECK_MISSING });
    else if (document.state !== 'ACTIVE') problems.push({ keyId, reason: COVERAGE_REASONS.KEY_NOT_TRUSTED });
    else if (!document.check) problems.push({ keyId, reason: COVERAGE_REASONS.KEY_CHECK_MISSING });
    else if (!hexValuesMatch(document.check, keyring.checkValueFor(keyId))) {
      check = 'MISMATCH';
      problems.push({ keyId, reason: COVERAGE_REASONS.KEY_MATERIAL_MISMATCH });
    } else check = 'MATCH';
    keys.push({ keyId, configured: true, role: keyId === keyring.currentKeyId ? 'CURRENT' : 'PREVIOUS', document: document?.state ?? 'NONE', check });
  }
  for (const keyId of activeKeyIds ?? []) {
    if (keyring?.has(keyId)) continue;
    problems.push({ keyId, reason: COVERAGE_REASONS.KEY_NOT_CONFIGURED });
    keys.push({ keyId, configured: false, role: null, document: documents.get(keyId)?.state ?? 'NONE', check: 'NOT_CONFIGURED' });
  }
  for (const document of documents.values()) {
    if (document.state === 'RECOVERING') problems.push({ keyId: String(document._id), reason: COVERAGE_REASONS.KEY_RECOVERING });
  }
  return { complete: problems.length === 0, problems, keys };
}

/**
 * @param {object} deps
 * @param {ReturnType<import('./suppressionRegister.js').createSuppressionRegister> | null} deps.register
 * @param {ReturnType<import('./suppressionKeys.js').createKeyring>} deps.keyring
 */
export function createSuppressionGate({ register, keyring }) {
  const incomplete = (problems) => ({ decision: GATE_DECISIONS.COVERAGE_INCOMPLETE, errorCode: 'SUPPRESSION_COVERAGE_INCOMPLETE', problems });
  const unavailable = (reason) => ({ decision: GATE_DECISIONS.UNAVAILABLE, errorCode: 'SUPPRESSION_CHECK_UNAVAILABLE', reason });

  return Object.freeze({
    keyring,

    /**
     * The check for ONE acknowledgement. Never throws.
     *
     * @param {{ emailNormalized: string }} input the stored, normalised candidate address (Doc 10 section 84)
     */
    async checkAcknowledgement({ emailNormalized }) {
      if (!register) return incomplete([{ keyId: null, reason: COVERAGE_REASONS.SUPPRESSION_NOT_CONFIGURED }]);
      // No current key: nothing can be checked, so nothing is sent (no read needed to know that).
      if (!keyring?.currentKeyId) return incomplete([{ keyId: null, reason: COVERAGE_REASONS.CURRENT_KEY_MISSING }]);
      if (typeof emailNormalized !== 'string' || emailNormalized.length === 0) return unavailable('NO_STORED_ADDRESS');
      let read;
      try {
        read = await register.readForAcknowledgement({ pairs: keyring.lookupPairs(emailNormalized) });
      } catch (error) {
        return unavailable(error?.reason === 'timeout' ? 'TIMEOUT' : 'READ_FAILED');
      }
      const coverage = assessCoverage({ ...read, keyring });
      if (!coverage.complete) return incomplete(coverage.problems);
      if (read.match) return { decision: GATE_DECISIONS.SUPPRESSED, errorCode: 'RECIPIENT_SUPPRESSED', suppressionId: String(read.match._id) };
      // Rev 8.3 (§9.6): no clock decides this — only the prune stamps read before and after.
      if (read.registerChanged !== false) return unavailable('REGISTER_CHANGED');
      return { decision: GATE_DECISIONS.PROCEED };
    },

    /** Read-only coverage (the retry summary and `coverage`). Rejects when the register cannot be read. */
    async coverage() {
      if (!register) return { complete: false, problems: [{ keyId: null, reason: COVERAGE_REASONS.SUPPRESSION_NOT_CONFIGURED }], keys: [] };
      return assessCoverage({ ...(await register.readCoverageInputs()), keyring });
    },
  });
}
