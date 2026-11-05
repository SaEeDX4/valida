import crypto from 'node:crypto';
import { createKeyring } from '../../src/modules/suppression/suppressionKeys.js';
import { createSuppressionGate } from '../../src/modules/suppression/suppressionGate.js';

/**
 * B7 — SYNTHETIC suppression keys and an IN-MEMORY register double for the
 * offline suites. The double implements only the send-path reads with the
 * real register's contract; it proves the notifier's and gate's logic, never
 * the database behaviour (that is tests/db/b7-suppression-*.test.js).
 */

/** A synthetic 32-byte key — random per call unless a seed byte is given. Never a real key. */
export const syntheticKey = (seed) => (seed === undefined ? crypto.randomBytes(32) : Buffer.alloc(32, seed));

/** A keyring of synthetic keys: `syntheticKeyring('qa-k1')`, or with verify-only previous ids. */
export function syntheticKeyring(currentKeyId = 'qa-k1', previousKeyIds = [], { seed } = {}) {
  return createKeyring({
    current: currentKeyId ? { keyId: currentKeyId, key: syntheticKey(seed) } : null,
    previous: previousKeyIds.map((keyId, index) => ({ keyId, key: syntheticKey(seed === undefined ? undefined : seed + index + 1) })),
  });
}

/**
 * The send-path reads of the register, in memory.
 *
 * @param {{ entries?: Array<{ _id: string, keyId: string, digest: string, state?: string }>, keyDocuments?: Array<{ _id: string, check: string|null, state: string }>, fail?: Error|null, delayMs?: number }} [options]
 */
export function memorySuppressionRegister({ entries = [], keyDocuments = [], fail = null, delayMs = 0 } = {}) {
  const state = { entries: [...entries], keyDocuments: [...keyDocuments], fail, delayMs, reads: 0 };
  const wait = () => (state.delayMs > 0 ? new Promise((resolve) => setTimeout(resolve, state.delayMs)) : Promise.resolve());
  const coverageInputs = () => ({
    activeKeyIds: [...new Set(state.entries.filter((entry) => (entry.state ?? 'ACTIVE') === 'ACTIVE').map((entry) => entry.keyId))],
    keyDocuments: state.keyDocuments.map((document) => ({ ...document })),
    limitReached: false,
  });
  return {
    state,
    async readCoverageInputs() {
      state.reads += 1;
      await wait();
      if (state.fail) throw state.fail;
      return coverageInputs();
    },
    async readForAcknowledgement({ pairs }) {
      state.reads += 1;
      await wait();
      if (state.fail) throw state.fail;
      const match = state.entries.find((entry) => (entry.state ?? 'ACTIVE') === 'ACTIVE' && pairs.some((pair) => pair.keyId === entry.keyId && pair.digest === entry.digest));
      return { ...coverageInputs(), match: match ? { _id: match._id } : null, registerChanged: state.registerChanged ?? false };
    },
  };
}

/** Key documents that make every key of `keyring` verified (ACTIVE, matching check value). */
export const registeredKeyDocuments = (keyring) => keyring.keyIds.map((keyId) => ({ _id: keyId, check: keyring.checkValueFor(keyId), state: 'ACTIVE' }));

/**
 * A gate with COMPLETE coverage and an empty register: every acknowledgement
 * PROCEEDS — the B6 behaviour, for suites that are not about suppression.
 */
export function openSuppressionGate({ keyring = syntheticKeyring() } = {}) {
  const register = memorySuppressionRegister({ keyDocuments: registeredKeyDocuments(keyring) });
  return Object.freeze({ ...createSuppressionGate({ register, keyring }), register });
}
