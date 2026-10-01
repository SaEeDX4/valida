import { serviceUnavailable } from '../../../errors/AppError.js';
import { classifyStorageError, isResumeStorageKey } from '../../../integrations/storage/privateStorage.js';

/**
 * From a validated upload to Application resume metadata — Milestone B4.
 *
 * Governed by 09_BACKEND_API_SPEC.md sections 102-103, 106-108, 116-119 and
 * 137, 10_DATA_MODEL.md sections 94-108 and 206-209, 13_SECURITY_PRIVACY_
 * THREAT_MODEL.md sections 70-74 and 229.
 *
 * These are the pieces the B5 Apply workflow composes (Doc 09 section 118:
 * validate -> generate key -> store -> persist Application -> ...):
 *
 *   storeValidatedResume   store the validated temporary file privately and
 *                          return the exact `Application.resume` subdocument
 *   buildResumeMetadata    the subdocument, from validation + storage results
 *   discardStoredResume    compensation when the Application is NOT persisted
 *                          after the object was stored (Doc 09 section 119)
 *
 * SCAN STATE. There is no malware scanner yet (AWAITING INPUT, E4). Format
 * validation and a checksum are not a security verdict, so every stored
 * resume is recorded as scanStatus NOT_SCANNED with scanCheckedAt null (Doc 10
 * sections 105 and 107; Doc 13 section 71) — never CLEAN. Nothing here accepts
 * a scan status from anywhere else.
 */
export const INITIAL_SCAN_STATE = Object.freeze({ scanStatus: 'NOT_SCANNED', scanCheckedAt: null });

/**
 * Stores a validated resume.
 *
 * Resolves with the metadata only after storage confirmed the object durably;
 * otherwise rejects with 503 SERVICE_UNAVAILABLE (Doc 09 section 137) — a
 * storage failure is never reported as success, and the storage layer has
 * already removed any partial object.
 */
export async function storeValidatedResume({ storage, validated }) {
  if (!storage || !storage.isReady) {
    throw serviceUnavailable(undefined, { reason: 'RESUME_STORAGE_NOT_READY' });
  }
  let stored;
  try {
    stored = await storage.storePrivateResume({
      filePath: validated.tempPath,
      sizeBytes: validated.sizeBytes,
      checksumSha256: validated.checksumSha256,
    });
  } catch (error) {
    throw serviceUnavailable(error, { reason: `RESUME_STORAGE_${classifyStorageError(error)}` });
  }
  return buildResumeMetadata(validated, stored);
}

/**
 * The `Application.resume` subdocument (Doc 10 section 94), exactly.
 *
 * The storage key and provider are INTERNAL (Doc 10 section 95, Doc 11
 * section 168): this object is for persistence, never for a response.
 */
export function buildResumeMetadata(validated, stored) {
  return {
    storageProvider: stored.storageProvider,
    storageKey: stored.storageKey,
    originalFilename: validated.originalFilename,
    extension: validated.extension,
    mimeType: validated.mimeType,
    sizeBytes: stored.sizeBytes,
    checksumSha256: stored.checksumSha256,
    scanStatus: INITIAL_SCAN_STATE.scanStatus,
    scanCheckedAt: INITIAL_SCAN_STATE.scanCheckedAt,
    storedAt: stored.storedAt,
  };
}

/**
 * Compensation — removes a stored resume whose Application was NOT
 * persisted (Doc 09 section 119, Doc 17 section 113).
 *
 * Never throws: the caller is already on a failure path and must still
 * answer with a controlled error. It resolves with what actually happened:
 *
 *   'DELETED'   the object was removed
 *   'ABSENT'    there was no such object
 *   'ORPHANED'  it could not be removed — it stays private, and an error is
 *               logged with the server-generated storage key so the
 *               reconciliation process can find it (Doc 10 sections 207-209).
 *               No filename or candidate data is logged.
 *
 * Only a valid resume storage key is ever passed to storage; anything else
 * is refused without touching it.
 */
export async function discardStoredResume({ storage, storageKey, logger, requestId }) {
  const context = { reqId: requestId, event: 'resume_compensation' };
  if (!isResumeStorageKey(storageKey)) {
    logger?.error({ ...context, outcome: 'REFUSED', reason: 'INVALID_KEY' }, 'resume compensation refused an invalid storage key');
    return 'REFUSED';
  }
  try {
    const result = await storage.deletePrivateObject(storageKey);
    if (result.deleted) {
      logger?.info({ ...context, outcome: 'DELETED' }, 'stored resume removed after the application was not accepted');
      return 'DELETED';
    }
    logger?.warn({ ...context, outcome: 'ABSENT' }, 'stored resume was already absent during compensation');
    return 'ABSENT';
  } catch (error) {
    logger?.error(
      { ...context, outcome: 'ORPHANED', storageKey, reason: classifyStorageError(error) },
      'resume storage orphan: compensation could not remove the stored resume',
    );
    return 'ORPHANED';
  }
}
