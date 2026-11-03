import { createHash, randomUUID } from 'node:crypto';
import { buildApplication } from '../../../src/modules/applications/application.service.js';
import { STORAGE_PROVIDERS, generateResumeStorageKey, isResumeStorageKey } from '../../../src/integrations/storage/storageContract.js';

/**
 * TEST ONLY (B6 r9) — a complete, valid SYNTHETIC Application for the
 * smoke-cleanup tests on a real database.
 *
 * Built by the production builder (buildApplication) and meant to be saved
 * through the model's validated save, so it has exactly the shape the
 * application writes — including the two uniquely indexed fields:
 *   - idempotency.keyHash  = the production hash of a FRESH synthetic
 *                            Idempotency-Key (the raw key is not kept);
 *   - resume.storageKey    = a FRESH key from the production generator
 *                            (no file is stored for it).
 * Both are new for every call, so no two fixture Applications share either.
 *
 * Why this exists: until r8 these tests inserted bare documents
 * ({ _id, jobId, candidate: { fullName }, status }) straight into the
 * collection. MongoDB indexes a missing field as null, so a second such
 * document violates both unique indexes (E11000 … dup key: null) — found by
 * the first real-MongoDB run; the earlier stand-in (FerretDB) treats missing
 * values as distinct and did not.
 *
 * The validated save does not check that the parent Job exists, so an
 * Application of a deleted or never-created Job is built the same way.
 *
 * Synthetic only: names are chosen by the caller, the address is
 * `qa.cleanup.<id>@example.invalid`, nothing is sent.
 */

/** A 64-character lowercase hexadecimal SHA-256, the shape of every stored hash. */
export const KEY_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** A synthetic resume as the storage step reports it — a fresh storage key, no file behind it. */
export function syntheticResume() {
  const checksumSha256 = createHash('sha256').update(`qa-b6-cleanup-resume:${randomUUID()}`).digest('hex');
  return {
    storageProvider: STORAGE_PROVIDERS.LOCAL_DEVELOPMENT,
    storageKey: generateResumeStorageKey(),
    originalFilename: 'qa-synthetic-resume.pdf',
    extension: '.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    checksumSha256,
    storedAt: new Date(),
  };
}

/**
 * @param {object} options
 * @param {import('mongoose').Types.ObjectId} options._id
 * @param {import('mongoose').Types.ObjectId} options.jobId   the parent Job (it need not exist)
 * @param {{title: string, slug: string}} options.jobSnapshot the Job as the candidate saw it
 * @param {string} options.fullName                          the candidate name (the smoke marker, or another)
 * @returns an UNSAVED Application document — call `.save()`
 */
export function syntheticApplication({ _id, jobId, jobSnapshot, fullName }) {
  const document = buildApplication({
    job: { title: jobSnapshot.title, slug: jobSnapshot.slug, _id: jobId },
    candidate: { fullName, email: `qa.cleanup.${_id}@example.invalid` },
    resume: syntheticResume(),
    idempotencyKey: `qa-b6-cleanup-${randomUUID()}`,
  });
  document._id = _id;
  if (!KEY_HASH_PATTERN.test(document.idempotency.keyHash) || !isResumeStorageKey(document.resume.storageKey)) {
    throw new Error('syntheticApplication: a malformed idempotency key hash or resume storage key');
  }
  return document;
}
