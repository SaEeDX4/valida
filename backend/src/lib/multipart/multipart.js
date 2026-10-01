import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Busboy from '@fastify/busboy';
import {
  malformedMultipart,
  payloadTooLarge,
  resumeTooLarge,
  serviceUnavailable,
  unsupportedRequestMediaType,
  uploadInterrupted,
  validationFailed,
} from '../../errors/AppError.js';

/**
 * Bounded multipart/form-data processing — Milestone B4, for the Apply route
 * (B5). Governed by 09_BACKEND_API_SPEC.md sections 73, 82, 94, 104-105 and
 * 145, 13_SECURITY_PRIVACY_THREAT_MODEL.md sections 55-56 and 255-256.
 *
 * WHAT IT GUARANTEES
 *   - Only multipart/form-data is read (anything else: 415, nothing read).
 *   - Memory is bounded: text fields are capped per field; the one file is
 *     streamed to a server-owned temporary file (tempUploadArea.js), hashed
 *     (SHA-256) and counted on the way, never buffered whole.
 *   - Disk is bounded: at most one file, and the parser stops writing it at
 *     `maxFileBytes`.
 *   - The whole request is bounded: a declared Content-Length over
 *     `maxRequestBytes` is refused before a byte is parsed (413, connection
 *     closed in stages — see below); a body that streams past it is cut off
 *     the same way.
 *   - Exactly one file, in `fileField`. A second file, a file under another
 *     name, an unknown text field, a repeated field or an over-long field is
 *     refused (Doc 09 section 145: never silently accepted).
 *   - Malformed bodies (no boundary, truncated, bad part headers) are 400;
 *     a client that disconnects mid-upload is detected; in EVERY failure path
 *     the temporary file is removed before the promise settles.
 *   - A SERVER-side temporary-storage failure — the area cannot reserve a
 *     file, or the temporary file cannot be created or written (disk full,
 *     permissions, the area removed or replaced) — is a 503, never a client
 *     error, and it is acted on the MOMENT it happens (B4 review r1, finding
 *     3). r1 waited for the parser's 'finish', which never comes once the
 *     file stream has been destroyed, so such a request hung. The 503 closes
 *     the connection: the rest of the body is never parsed or stored. It is
 *     read and discarded, within fixed bounds, only so the connection can be
 *     closed without a TCP reset that would erase the response (RFC 9112
 *     section 9.6; lib/http/stagedClose.js, B4 r3). A caller
 *     that receives a result owns the temporary file and must call
 *     `release()` when finished — in a `finally`, and BEFORE sending the
 *     response, so no temporary file outlives the request the client sees
 *     completed (tests/fixtures/uploadHarness.js shows the pattern).
 *
 * WHAT IT DOES NOT DO
 *   It does not judge the file. Extension, declared MIME type, size and
 *   content structure are checked by the resume validator
 *   (modules/applications/resume/resumeValidation.js), and business rules
 *   for the text fields belong to B5. The client's filename is returned only
 *   as raw metadata — it never names anything on disk.
 *
 * PARSER: @fastify/busboy 3.2.2 (see backend/README.md for the selection).
 * `preservePath: false` makes it reduce a filename to its last path segment.
 * Tested behaviour of 3.2.2 with a bare CR or LF in a part header: the part
 * is dropped when it is in the field name, the filename or between header
 * lines; a bare LF inside another header line (e.g. Content-Type) makes that
 * line ignored, so the declared type falls back to text/plain and the file is
 * then refused by the MIME check. Filename normalisation removes control
 * characters regardless.
 */

/** Allowance for multipart boundaries and part headers on top of the payload limits. */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const FORM_FIELD = 'form';

/*
 * Fixed client-facing texts. The field named in an error is either the
 * configured file field, one of the configured text-field names, or the
 * literal 'form' — never a name the client made up.
 */
const FORM_ERRORS = Object.freeze({
  UNSUPPORTED_FIELD: {
    field: FORM_FIELD,
    code: 'UNSUPPORTED_FIELD',
    message: "This form contains information that isn't accepted.",
  },
  TOO_MANY_FIELDS: {
    field: FORM_FIELD,
    code: 'TOO_MANY_FIELDS',
    message: 'This form contains more fields than allowed.',
  },
});

const fieldError = (field, code) => {
  const messages = {
    DUPLICATE_FIELD: 'This field was sent more than once.',
    TOO_LONG: 'This field is longer than the allowed limit.',
    SINGLE_FILE_REQUIRED: 'Upload only one file.',
  };
  return { field, code, message: messages[code] };
};

/**
 * Parses one multipart request.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {object} options
 * @param {import('./tempUploadArea.js').TempUploadArea} options.uploadArea
 * @param {string}  options.fileField     the only field that may carry a file
 * @param {number}  options.maxFileBytes  inclusive maximum file size
 * @param {Record<string, number>} [options.textFields]  allowed text fields
 *   and the maximum UTF-8 byte length of each (a transport bound — B5 applies
 *   the character-level business rules)
 * @param {number}  [options.maxRequestBytes] defaults to the sum of the
 *   limits plus MULTIPART_OVERHEAD_BYTES
 * @returns {Promise<{
 *   fields: Record<string, string>,
 *   file: null | { path: string, sizeBytes: number, checksumSha256: string,
 *                  clientFilename: string | undefined, clientMimeType: string | undefined },
 *   fileFieldSentAsText: boolean,
 *   release: () => Promise<boolean>,
 * }>}
 */
export function parseMultipartUpload(req, { uploadArea, fileField, maxFileBytes, textFields = {}, maxRequestBytes } = {}) {
  if (!uploadArea || typeof fileField !== 'string' || !Number.isInteger(maxFileBytes) || maxFileBytes < 1) {
    return Promise.reject(new TypeError('parseMultipartUpload: uploadArea, fileField and maxFileBytes are required'));
  }
  const fieldLimits = Object.values(textFields);
  const requestLimit =
    maxRequestBytes ?? maxFileBytes + fieldLimits.reduce((sum, bytes) => sum + bytes, 0) + MULTIPART_OVERHEAD_BYTES;

  // Doc 09 section 73 — only multipart/form-data.
  const contentType = req.headers['content-type'];
  if (typeof contentType !== 'string' || !/^multipart\/form-data\s*(;|$)/i.test(contentType)) {
    return Promise.reject(unsupportedRequestMediaType());
  }

  // A declared length over the limit is refused before anything is read.
  const declaredLength = req.headers['content-length'];
  if (declaredLength !== undefined && Number(declaredLength) > requestLimit) {
    return Promise.reject(payloadTooLarge(undefined, { reason: 'REQUEST_OVER_LIMIT', closeConnection: true }));
  }

  let busboy;
  try {
    busboy = new Busboy({
      headers: req.headers,
      preservePath: false,
      limits: {
        fieldNameSize: 100,
        fieldSize: Math.max(1, ...fieldLimits),
        fields: fieldLimits.length,
        fileSize: maxFileBytes,
        files: 1,
        parts: fieldLimits.length + 1,
        headerPairs: 16,
        headerSize: 16 * 1024,
      },
    });
  } catch (error) {
    // No boundary, or an unparseable Content-Type parameter list.
    return Promise.reject(malformedMultipart(error, { reason: 'MULTIPART_BOUNDARY_MISSING' }));
  }

  return new Promise((resolve, reject) => {
    const fields = Object.create(null);
    const seenFields = new Set();
    const fieldErrors = [];
    let firstViolationReason = null;
    let fileFieldSentAsText = false;

    /** @type {null | {handle: object, clientFilename: any, clientMimeType: any, truncated: boolean, sizeBytes?: number, checksumSha256?: string}} */
    let file = null;
    let fileStream = null;
    let writer = null;
    let fileWrite = null;
    let settled = false;
    let received = 0;

    const addViolation = (error, reason) => {
      if (!fieldErrors.some((entry) => entry.field === error.field && entry.code === error.code)) {
        fieldErrors.push(error);
      }
      firstViolationReason ??= reason;
    };

    const detach = () => {
      req.removeListener('data', onData);
      req.removeListener('close', onClose);
      req.removeListener('error', onRequestError);
      req.unpipe(busboy);
    };

    /** Settles with an error, after removing the temporary file. */
    const fail = async (error) => {
      if (settled) return;
      settled = true;
      detach();
      fileStream?.resume();
      writer?.destroy();
      if (fileWrite) await fileWrite.catch(() => {});
      if (file) await uploadArea.release(file.handle).catch(() => {});
      reject(error);
    };

    const onData = (chunk) => {
      received += chunk.length;
      if (received > requestLimit && !settled) {
        fail(payloadTooLarge(undefined, { reason: 'REQUEST_OVER_LIMIT', closeConnection: true }));
      }
    };
    /*
     * A request stream that closes before WE consumed all of it was aborted.
     * `readableEnded`, not `complete`: Node can abort a request whose bytes
     * were all received (a client half-closing its connection) while part of
     * the body is still unread in the stream buffer; that remainder is then
     * discarded, the parser would wait forever, and the temporary file would
     * be left behind.
     */
    const onClose = () => {
      if (!req.readableEnded) fail(uploadInterrupted());
    };
    const onRequestError = () => fail(uploadInterrupted());

    busboy.on('field', (name, value, nameTruncated, valueTruncated) => {
      if (settled) return;
      if (name === fileField) {
        // The file field sent as plain text: there is no file. The resume
        // validator reports that as a missing resume; the text is discarded.
        fileFieldSentAsText = true;
        return;
      }
      if (nameTruncated || !Object.hasOwn(textFields, name)) {
        addViolation(FORM_ERRORS.UNSUPPORTED_FIELD, 'MULTIPART_UNSUPPORTED_FIELD');
        return;
      }
      if (seenFields.has(name)) {
        addViolation(fieldError(name, 'DUPLICATE_FIELD'), 'MULTIPART_DUPLICATE_FIELD');
        return;
      }
      seenFields.add(name);
      if (valueTruncated || Buffer.byteLength(value, 'utf8') > textFields[name]) {
        addViolation(fieldError(name, 'TOO_LONG'), 'MULTIPART_FIELD_TOO_LONG');
        return;
      }
      fields[name] = value;
    });

    busboy.on('file', (name, stream, filename, _transferEncoding, mimeType) => {
      if (settled || name !== fileField || file) {
        // Discard the bytes; they are never written anywhere.
        stream.resume();
        if (!settled && name !== fileField) addViolation(FORM_ERRORS.UNSUPPORTED_FIELD, 'MULTIPART_UNEXPECTED_FILE');
        return;
      }
      let handle;
      try {
        handle = uploadArea.reserveFile();
      } catch (error) {
        // The server cannot hold the file (area removed, replaced or closed):
        // a server-side failure, never "malformed request".
        stream.resume();
        fail(serviceUnavailable(error, { reason: 'UPLOAD_TEMP_RESERVE_FAILED', closeConnection: true }));
        return;
      }
      const current = { handle, clientFilename: filename, clientMimeType: mimeType, truncated: false };
      file = current;
      fileStream = stream;
      stream.on('limit', () => {
        current.truncated = true;
      });
      const hash = createHash('sha256');
      let size = 0;
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          size += chunk.length;
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      writer = fs.createWriteStream(handle.path, { flags: 'wx', mode: 0o600 });
      /*
       * The temporary file failing (it cannot be created, the disk is full)
       * settles the request AT ONCE. Registered before pipeline() so it runs
       * first: the pipeline then destroys the parser's file stream, after
       * which the parser can never emit 'finish'.
       */
      writer.once('error', (error) => {
        fail(serviceUnavailable(error, { reason: 'UPLOAD_TEMP_WRITE_FAILED', closeConnection: true }));
      });
      fileWrite = pipeline(stream, meter, writer).then(() => {
        current.sizeBytes = size;
        current.checksumSha256 = hash.digest('hex');
      });
      fileWrite.catch((error) => {
        /*
         * Any other pipeline failure is the file STREAM failing: the client's
         * body broke off or went bad inside the file. The parser usually
         * reports that too (its 'error' handler settles first); if it does
         * not, settle here rather than wait for a 'finish' that will not come.
         * After fail() has run, this is only the echo of its own clean-up.
         */
        if (!settled) fail(malformedMultipart(error, { reason: 'MULTIPART_FILE_STREAM_FAILED' }));
      });
    });

    busboy.on('filesLimit', () => {
      if (!settled) addViolation(fieldError(fileField, 'SINGLE_FILE_REQUIRED'), 'MULTIPART_MULTIPLE_FILES');
    });
    const tooMany = () => {
      if (!settled) addViolation(FORM_ERRORS.TOO_MANY_FIELDS, 'MULTIPART_TOO_MANY_PARTS');
    };
    busboy.on('fieldsLimit', tooMany);
    busboy.on('partsLimit', tooMany);

    busboy.on('error', (error) => fail(malformedMultipart(error)));

    busboy.on('finish', async () => {
      if (settled) return;
      if (fileWrite) {
        try {
          await fileWrite;
        } catch (error) {
          // Normally already settled by the writer's or the stream's own
          // handler above; never a success either way.
          if (!settled) fail(serviceUnavailable(error, { reason: 'UPLOAD_TEMP_WRITE_FAILED', closeConnection: true }));
          return;
        }
      }
      if (settled) return;
      if (file?.truncated) {
        fail(resumeTooLarge({ reason: 'RESUME_OVER_MAX_BYTES' }));
        return;
      }
      if (fieldErrors.length > 0) {
        const error = validationFailed(fieldErrors);
        error.reason = firstViolationReason;
        fail(error);
        return;
      }
      settled = true;
      detach();
      const completed = file;
      resolve({
        fields,
        file: completed && {
          path: completed.handle.path,
          sizeBytes: completed.sizeBytes,
          checksumSha256: completed.checksumSha256,
          clientFilename: completed.clientFilename,
          clientMimeType: completed.clientMimeType,
        },
        fileFieldSentAsText,
        release: () => (completed ? uploadArea.release(completed.handle) : Promise.resolve(false)),
      });
    });

    req.on('data', onData);
    req.on('close', onClose);
    req.on('error', onRequestError);

    /*
     * The request may already be over by the time this runs (earlier
     * middleware is asynchronous): its 'close' has then been emitted and will
     * not be again. Check the state directly instead of waiting forever.
     */
    if (req.readableEnded) {
      // Something already consumed the body; there is nothing left to parse.
      fail(malformedMultipart(undefined, { reason: 'MULTIPART_BODY_ALREADY_READ' }));
      return;
    }
    if (req.destroyed) {
      fail(uploadInterrupted());
      return;
    }
    req.pipe(busboy);
  });
}
