import mongoose from 'mongoose';
import { RecipientSuppression, RecipientSuppressionKey } from '../../../src/models/RecipientSuppression.js';
import { createSuppressionGate } from '../../../src/modules/suppression/suppressionGate.js';
import { createSuppressionRegister } from '../../../src/modules/suppression/suppressionRegister.js';
import { createSuppressionOperations } from '../../../src/modules/suppression/suppressionOperations.js';
import { syntheticKeyring } from '../../fixtures/suppressionDoubles.js';
import { assertConnectedToTestDatabase } from '../testDatabase.js';

/**
 * B7 — the REAL suppression register over the disposable test database, with
 * SYNTHETIC keys only (never a real key). `operatorIds` are synthetic tokens.
 */
export const QA_OPERATOR = 'qa-operator';

export function realSuppression({ keyring = syntheticKeyring(), timeoutMs = 5_000, clock } = {}) {
  const register = createSuppressionRegister({ timeoutMs, writeTimeoutMs: timeoutMs });
  const gate = createSuppressionGate({ register, keyring });
  const operations = createSuppressionOperations({ register, keyring, operatorIds: [QA_OPERATOR], timeoutMs, ...(clock ? { clock } : {}) });
  return { keyring, register, gate, operations };
}

/** Registers every configured key of `suppression` (fresh ids) through the real operator path. */
export async function registerKeys(suppression) {
  for (const keyId of suppression.keyring.keyIds) await suppression.operations.keyRegister({ keyId, apply: true, actor: QA_OPERATOR });
}

/** Empties both suppression collections — test database only. */
export async function clearSuppression(databaseName) {
  assertConnectedToTestDatabase(mongoose.connection, databaseName);
  await RecipientSuppression.deleteMany({});
  await RecipientSuppressionKey.deleteMany({});
}
