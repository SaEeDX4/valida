import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { isResumeStorageKey } from '../../../integrations/storage/storageContract.js';

/**
 * Proposed (MongoDB-native launch change) — the résumé security state
 * (Doc 10 sections 104-107; Doc 11 sections 165-177; Doc 12 sections 161-164;
 * Doc 13 sections 70-74, 80).
 *
 * 1. A scan result is BOUND to the exact bytes scanned. recordScanResult
 *    changes an Application's scanStatus only when its résumé is still the
 *    stored version that was scanned (storage key, size and SHA-256 all equal).
 *    A result for other bytes, or for a record that changed meanwhile, is
 *    refused (BINDING_MISMATCH): nothing is updated.
 * 2. Only a real scanner result can produce CLEAN (Doc 13 section 71): the
 *    result must name the scanner and its signature version. There is no
 *    default to CLEAN, and a scanner failure is FAILED (section 74).
 * 3. QUARANTINED is terminal here: no automatic transition leaves it
 *    (section 73: private, unavailable to ordinary download, traceable).
 *    CLEAN may still become QUARANTINED (a later, better signature set).
 * 4. retrieveResumeForReview — the E4 authorised HR retrieval, as a service
 *    with no route (Phase 3 adds the authenticated Admin route): released only
 *    for scanStatus CLEAN, only after the stored bytes are re-verified against
 *    the recorded size and SHA-256, and only after the access audit is
 *    written (Doc 11 section 177). Safe download headers (Doc 13 section 80).
 */
export const SCAN_STATUSES = Object.freeze(['NOT_SCANNED', 'PENDING', 'CLEAN', 'QUARANTINED', 'FAILED']);
const VERDICTS = new Set(['PENDING', 'CLEAN', 'QUARANTINED', 'FAILED']);

/** The scanStatus values a verdict may replace. */
export const ALLOWED_FROM = Object.freeze({
  PENDING: Object.freeze(['NOT_SCANNED', 'FAILED']),
  CLEAN: Object.freeze(['NOT_SCANNED', 'PENDING', 'FAILED']),
  FAILED: Object.freeze(['NOT_SCANNED', 'PENDING', 'FAILED']),
  QUARANTINED: Object.freeze(['NOT_SCANNED', 'PENDING', 'FAILED', 'CLEAN']),
});

const CHECKSUM = /^[a-f0-9]{64}$/;
const SCANNER_NAME = /^[A-Za-z0-9._ -]{1,64}$/;

export const SAFE_DOWNLOAD_HEADERS = Object.freeze({
  'Content-Disposition': 'attachment',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'private, no-store',
});

/**
 * @returns {{ recorded: true, scanStatus } | { recorded: false, reason: 'NOT_FOUND'|'BINDING_MISMATCH'|'TRANSITION_REFUSED' }}
 */
export async function recordScanResult({ applications, applicationId, scanned, verdict, scanner, now = new Date() }) {
  if (!/^[0-9a-f]{24}$/.test(String(applicationId ?? ''))) throw new TypeError('an Application id (24 hex) is required');
  if (!VERDICTS.has(verdict)) throw new TypeError('verdict must be PENDING, CLEAN, QUARANTINED or FAILED');
  if (!scanned || !isResumeStorageKey(scanned.storageKey) || !Number.isInteger(scanned.sizeBytes) || !CHECKSUM.test(scanned.checksumSha256 ?? '')) {
    throw new TypeError('the scanned version (storageKey, sizeBytes, checksumSha256) is required');
  }
  if (verdict !== 'PENDING' && (!scanner || !SCANNER_NAME.test(scanner.name ?? '') || !SCANNER_NAME.test(scanner.signatureVersion ?? ''))) {
    // No scanner identity, no result: CLEAN can never come from a default.
    throw new TypeError('a result needs the scanner name and signature version');
  }
  const _id = new mongoose.Types.ObjectId(applicationId);
  const binding = { _id, 'resume.storageKey': scanned.storageKey, 'resume.sizeBytes': scanned.sizeBytes, 'resume.checksumSha256': scanned.checksumSha256 };
  const set = { 'resume.scanStatus': verdict };
  // Doc 10 section 107: set only when an actual scan attempt happened. The data model is unchanged; the scanner
  // identity is returned for the security log (Doc 13 section 120), not stored on the record.
  if (verdict !== 'PENDING') set['resume.scanCheckedAt'] = now;
  const result = await applications.updateOne({ ...binding, 'resume.scanStatus': { $in: [...ALLOWED_FROM[verdict]] } }, { $set: set });
  if (result.matchedCount === 1) return { recorded: true, scanStatus: verdict, scanner: verdict === 'PENDING' ? null : { name: scanner.name, signatureVersion: scanner.signatureVersion } };
  const current = await applications.findOne({ _id }, { projection: { 'resume.storageKey': 1, 'resume.sizeBytes': 1, 'resume.checksumSha256': 1, 'resume.scanStatus': 1 } });
  if (!current) return { recorded: false, reason: 'NOT_FOUND' };
  const r = current.resume ?? {};
  if (r.storageKey !== scanned.storageKey || r.sizeBytes !== scanned.sizeBytes || r.checksumSha256 !== scanned.checksumSha256) return { recorded: false, reason: 'BINDING_MISMATCH' };
  return { recorded: false, reason: 'TRANSITION_REFUSED', scanStatus: r.scanStatus };
}

const SIGNATURE_LABEL = /[^A-Za-z0-9._ -]/g;
const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** The signature set as one bounded label ("1.5.4-27812"), never free text from the scanner. */
function signatureLabel(outcome) {
  if (!outcome) return 'unknown';
  const label = outcome.engine ? `${outcome.engine}-${outcome.signatureVersion}` : String(outcome.signatureVersion ?? 'unknown');
  return label.replace(SIGNATURE_LABEL, '_').slice(0, 64) || 'unknown';
}

/**
 * Scans ONE Application's résumé, bound to the EXACT stored version:
 *   1. the recorded version (storage key, size, SHA-256) is read from the record;
 *   2. the bytes are read with readPrivateObject(expect: size + SHA-256) — the
 *      store re-hashes them; altered bytes are INTEGRITY_MISMATCH, not scanned;
 *   3. the bytes handed to the scanner are hashed again here, and a scanner that
 *      reports what it was sent (clamd client: sentBytes, sentSha256) must agree;
 *   4. the verdict is recorded with recordScanResult, which updates the record
 *      only if it still holds that same version (BINDING_MISMATCH otherwise).
 *
 * Only a real "clean" answer becomes CLEAN; "infected" becomes QUARANTINED
 * (terminal). Every failure — timeout, malformed or partial answer, stale or
 * unidentifiable signatures, unreachable scanner, missing or altered bytes,
 * a disagreement about what was scanned — records FAILED (Doc 13 section 74):
 * the file stays held, because only CLEAN is ever released.
 *
 * @returns recordScanResult's answer, plus `reason` (the failure reason) when FAILED.
 */
export async function scanApplicationResume({ applications, storage, scanner, applicationId, now = () => new Date() }) {
  const _id = new mongoose.Types.ObjectId(applicationId);
  const record = await applications.findOne({ _id }, { projection: { resume: 1 } });
  if (!record) return { recorded: false, reason: 'NOT_FOUND' };
  const scanned = { storageKey: record.resume.storageKey, sizeBytes: record.resume.sizeBytes, checksumSha256: record.resume.checksumSha256 };
  const fail = async (reason, outcome = null) => ({
    ...(await recordScanResult({ applications, applicationId, scanned, verdict: 'FAILED', scanner: { name: scanner.name, signatureVersion: signatureLabel(outcome) }, now: now() })),
    failure: reason,
  });
  let read;
  try {
    read = await storage.readPrivateObject(scanned.storageKey, { expect: scanned });
  } catch (error) {
    return fail(typeof error?.reason === 'string' ? error.reason : 'READ_FAILED');
  }
  if (!read.found) return fail('FILE_MISSING');
  if (read.bytes.length !== scanned.sizeBytes || sha256Hex(read.bytes) !== scanned.checksumSha256) return fail('INTEGRITY_MISMATCH');
  let outcome;
  try {
    outcome = await scanner.scan(read.bytes);
  } catch (error) {
    return fail(typeof error?.reason === 'string' ? error.reason : 'SCANNER_FAILED');
  }
  if (outcome?.sentSha256 !== undefined && (outcome.sentSha256 !== scanned.checksumSha256 || outcome.sentBytes !== scanned.sizeBytes)) return fail('SCANNED_BYTES_MISMATCH', outcome);
  if (outcome?.verdict === 'CLEAN') {
    return recordScanResult({ applications, applicationId, scanned, verdict: 'CLEAN', scanner: { name: scanner.name, signatureVersion: signatureLabel(outcome) }, now: now() });
  }
  if (outcome?.verdict === 'INFECTED') {
    return recordScanResult({ applications, applicationId, scanned, verdict: 'QUARANTINED', scanner: { name: scanner.name, signatureVersion: signatureLabel(outcome) }, now: now() });
  }
  return fail('UNEXPECTED_VERDICT', outcome);
}

/**
 * The authorised HR retrieval (E4), as a service. `audit` is required and is
 * awaited BEFORE any byte is returned; if it fails, nothing is released.
 *
 * @returns {{ released: true, bytes, filename, mimeType, headers } | { released: false, reason }}
 */
export async function retrieveResumeForReview({ applications, storage, applicationId, audit }) {
  if (typeof audit !== 'function') throw new TypeError('an audit writer is required');
  if (!/^[0-9a-f]{24}$/.test(String(applicationId ?? ''))) return { released: false, reason: 'NOT_FOUND' };
  const record = await applications.findOne({ _id: new mongoose.Types.ObjectId(applicationId) }, { projection: { resume: 1 } });
  if (!record?.resume) return { released: false, reason: 'NOT_FOUND' };
  const r = record.resume;
  if (r.scanStatus !== 'CLEAN') return { released: false, reason: 'NOT_RELEASABLE', scanStatus: r.scanStatus };
  const read = await storage.readPrivateObject(r.storageKey, { expect: { sizeBytes: r.sizeBytes, checksumSha256: r.checksumSha256 } });
  if (!read.found) return { released: false, reason: 'FILE_MISSING' };
  await audit({ event: 'RESUME_ACCESSED', applicationId: String(applicationId) });
  return {
    released: true,
    bytes: read.bytes,
    filename: r.originalFilename,
    mimeType: r.mimeType,
    headers: { ...SAFE_DOWNLOAD_HEADERS, 'Content-Type': r.mimeType },
  };
}
