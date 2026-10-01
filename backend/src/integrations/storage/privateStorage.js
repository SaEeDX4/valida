import { LocalPrivateStorage } from './localPrivateStorage.js';
import { StorageInitializationError } from './storageContract.js';

export {
  STORAGE_PROVIDERS,
  RESUME_STORAGE_KEY_PATTERN,
  generateResumeStorageKey,
  isResumeStorageKey,
  STORAGE_FAILURE_REASONS,
  PrivateStorageError,
  StorageInitializationError,
  classifyStorageError,
} from './storageContract.js';

/**
 * Private file storage boundary — Milestone B4.
 *
 * Governed by 07_TECHNICAL_ARCHITECTURE.md sections 19 and 55-62,
 * 09_BACKEND_API_SPEC.md sections 101-108 and 116-119,
 * 10_DATA_MODEL.md sections 94-97 and 206-209,
 * 13_SECURITY_PRIVACY_THREAT_MODEL.md sections 19, 66-69, 101-111, 229, 233,
 * 15_DEVOPS_DEPLOYMENT.md sections 38, 76-77, 97-106, 199, 221.
 *
 *   Application service  ->  this boundary  ->  one storage integration
 *
 * THE INTERFACE (small and real — Doc 07 section 56, Doc 18 section 377):
 *
 *   provider                       internal Application.resume.storageProvider
 *                                  value (Doc 10 section 95); never sent to a
 *                                  client
 *   isReady                        true once init() succeeded, until close()
 *   init()                         verifies the storage can accept objects;
 *                                  throws StorageInitializationError
 *   storePrivateResume({ filePath, sizeBytes, checksumSha256 })
 *                                  copies an already validated file into
 *                                  private storage under a NEW server-generated
 *                                  key, re-verifying size and SHA-256 while
 *                                  writing; resolves only once the object is
 *                                  durably accepted:
 *                                  { storageProvider, storageKey, sizeBytes,
 *                                    checksumSha256, storedAt }
 *   deletePrivateObject(storageKey)
 *                                  removes ONE object named by a valid resume
 *                                  key — the only deletion there is (B5
 *                                  compensation, Doc 09 section 119):
 *                                  { deleted: true } | { deleted: false,
 *                                  reason: 'NOT_FOUND' }
 *   statPrivateObject(storageKey)  { exists, sizeBytes } — integrity and
 *                                  reconciliation only
 *   close()
 *
 * There is deliberately NO read, list or URL operation. Phase 1 has no
 * resume retrieval at all (Doc 09 section 170): authorized delivery is E4,
 * behind Admin authentication and the scan-status gate (Doc 11 sections
 * 165-174), and a public URL is prohibited outright (Doc 18 section 118).
 *
 * Every failure is a PrivateStorageError whose `reason` comes from the fixed
 * table in storageContract.js, so it can be logged without carrying a path, a
 * key or a provider message.
 */

/**
 * Builds the configured storage integration, or returns null when none is
 * configured (config/env.js explains when that is the correct state).
 *
 * The returned object is not initialised; the caller (server.js) runs
 * init() and reports readiness from the real outcome.
 */
export function createPrivateStorage({ config, logger, clock } = {}) {
  const driver = config?.resumeStorage?.driver ?? null;
  if (driver === null) return null;
  if (driver === 'local') {
    return new LocalPrivateStorage({
      root: config.resumeStorage.localRoot,
      appEnv: config.appEnv,
      nodeEnv: config.nodeEnv,
      logger,
      clock,
    });
  }
  // Unreachable through loadConfig, which accepts only the drivers above.
  throw new StorageInitializationError('INVALID_REQUEST');
}
