import fsp from 'node:fs/promises';
import { RESUME_FORMATS, RESUME_UPLOAD_POLICY } from '../../../config/resumePolicy.js';
import {
  invalidResumeFile,
  resumeRequired,
  resumeTooLarge,
  serviceUnavailable,
  unsupportedResumeType,
} from '../../../errors/AppError.js';
import { extensionOf, normalizeOriginalFilename } from './filename.js';
import { fileHandleReader, ReadOutOfRangeError } from './byteReader.js';
import { identifySignature } from './fileSignature.js';
import { inspectDocx } from './docxInspector.js';
import { inspectPdf } from './pdfInspector.js';

/**
 * Resume validation — Milestone B4.
 *
 * Governed by 09_BACKEND_API_SPEC.md sections 94-103 and 139-142,
 * 10_DATA_MODEL.md sections 94-105, 13_SECURITY_PRIVACY_THREAT_MODEL.md
 * sections 57-79, 17_QA_TEST_PLAN.md sections 115-127.
 *
 * Takes the result of parseMultipartUpload and decides whether its file is an
 * acceptable Phase 1 resume. Defence in depth (Doc 13 section 58) — every
 * layer must agree, none is trusted alone:
 *
 *   present    exactly one file in `resume`      else 422 VALIDATION_FAILED
 *   extension  .pdf or .docx (from the normalised
 *              name; .doc, .docm, .exe ... refused) else 415 UNSUPPORTED_MEDIA_TYPE
 *   MIME       declared type allowed AND the one
 *              that matches the extension           else 415 UNSUPPORTED_MEDIA_TYPE
 *   size       1 .. 5,242,880 bytes                 empty: 422 INVALID_RESUME_FILE
 *                                                   over:  413 FILE_TOO_LARGE
 *   content    PDF or DOCX structure of the SAME
 *              format as the extension              else 422 INVALID_RESUME_FILE
 *
 * The order is fixed so that the response is deterministic: a type the
 * policy does not accept is a 415 whatever its content; content is only
 * inspected for a file that claims an accepted type.
 *
 * On success it returns the validated metadata. The temporary file stays in
 * place (still owned by the upload area) for storage; the CALLER releases
 * it. On failure the error carries internal `reason`/`detected` tokens for
 * the log — the response is only the fixed Doc 06 wording.
 */
const MIME_TOKEN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;
const ACCEPTED_MIME_TYPES = new Set(Object.values(RESUME_FORMATS).map(({ mimeType }) => mimeType));

/** Why an extension is refused — for the log only. */
function extensionReason(extension) {
  if (extension === '') return 'EXTENSION_MISSING';
  if (extension === '.doc' || extension === '.dot') return 'EXTENSION_LEGACY_WORD';
  if (['.docm', '.dotm', '.dotx'].includes(extension)) return 'EXTENSION_MACRO_OR_TEMPLATE';
  return 'EXTENSION_NOT_ALLOWED';
}

/** "Application/PDF; charset=binary" -> "application/pdf"; anything malformed -> ''. */
export function normalizeDeclaredMimeType(value) {
  if (typeof value !== 'string') return '';
  const type = value.split(';', 1)[0].trim().toLowerCase();
  return MIME_TOKEN.test(type) ? type : '';
}

/**
 * @param {Awaited<ReturnType<import('../../../lib/multipart/multipart.js').parseMultipartUpload>>} upload
 * @returns {Promise<Readonly<{
 *   tempPath: string, sizeBytes: number, checksumSha256: string,
 *   extension: '.pdf' | '.docx', mimeType: string, originalFilename: string,
 *   format: 'PDF' | 'DOCX' }>>}
 */
export async function validateResumeUpload(upload) {
  const file = upload?.file ?? null;
  if (!file) {
    throw resumeRequired({ reason: upload?.fileFieldSentAsText ? 'RESUME_SENT_AS_TEXT' : 'RESUME_MISSING' });
  }

  // Extension — from the normalised name, so "x.pdf " or "x.PDF" behave.
  const originalFilename = normalizeOriginalFilename(file.clientFilename);
  const extension = extensionOf(originalFilename);
  const format = Object.hasOwn(RESUME_FORMATS, extension) ? RESUME_FORMATS[extension] : null;
  if (!format) throw unsupportedResumeType({ reason: extensionReason(extension) });

  // Declared MIME type — one signal, never trusted alone (Doc 13 section 61).
  const declared = normalizeDeclaredMimeType(file.clientMimeType);
  if (!ACCEPTED_MIME_TYPES.has(declared)) {
    throw unsupportedResumeType({ reason: declared ? 'MIME_NOT_ALLOWED' : 'MIME_MISSING' });
  }
  if (declared !== format.mimeType) throw unsupportedResumeType({ reason: 'EXTENSION_MIME_MISMATCH' });

  // Size.
  if (!Number.isInteger(file.sizeBytes) || file.sizeBytes <= 0) {
    throw invalidResumeFile({ reason: 'RESUME_EMPTY', detected: 'EMPTY' });
  }
  if (file.sizeBytes > RESUME_UPLOAD_POLICY.maxBytes) throw resumeTooLarge();

  // Content — the structure of the format the extension claims.
  let handle;
  try {
    handle = await fsp.open(file.path, 'r');
  } catch (error) {
    throw serviceUnavailable(error, { reason: 'UPLOAD_TEMP_UNREADABLE' });
  }
  try {
    const { size } = await handle.stat();
    if (size !== file.sizeBytes) throw serviceUnavailable(undefined, { reason: 'UPLOAD_TEMP_INCONSISTENT' });
    const reader = fileHandleReader(handle, size);
    const detected = identifySignature(await reader.read(0, Math.min(size, 16)));
    let result;
    try {
      result = format.format === 'PDF' ? await inspectPdf(reader) : await inspectDocx(reader);
    } catch (error) {
      // A window outside the file means the document's own offsets are corrupt.
      if (error instanceof ReadOutOfRangeError) result = { ok: false, reason: 'STRUCTURE_OUT_OF_RANGE' };
      else throw error;
    }
    if (!result.ok) throw invalidResumeFile({ reason: result.reason, detected });
  } finally {
    await handle.close().catch(() => {});
  }

  return Object.freeze({
    tempPath: file.path,
    sizeBytes: file.sizeBytes,
    checksumSha256: file.checksumSha256,
    extension,
    mimeType: format.mimeType,
    originalFilename,
    format: format.format,
  });
}
