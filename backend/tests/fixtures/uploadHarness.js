import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { RESUME_UPLOAD_POLICY } from '../../src/config/resumePolicy.js';
import { successEnvelope } from '../../src/lib/envelope.js';
import { parseMultipartUpload } from '../../src/lib/multipart/multipart.js';
import { TempUploadArea } from '../../src/lib/multipart/tempUploadArea.js';
import { LocalPrivateStorage } from '../../src/integrations/storage/localPrivateStorage.js';
import { validateResumeUpload } from '../../src/modules/applications/resume/resumeValidation.js';
import { storeValidatedResume } from '../../src/modules/applications/resume/resumeStorage.js';
import { buildApp } from '../helpers.js';

/**
 * TEST-ONLY HTTP HARNESS for the B4 multipart and resume components.
 *
 * B4 adds no upload endpoint to the product (the Apply route is B5). To test
 * the reusable components through real HTTP and the real middleware stack
 * (request id, security headers, rate limit, central error handler), this
 * mounts ONE route through createApp's test-only `registerTestRoutes` hook —
 * the same seam B1 uses for its safe-500 test. server.js never passes that
 * hook, so production has no such route.
 *
 * The route runs exactly the sequence B5 will: parse -> validate -> store,
 * releasing the temporary file in `finally`. Its success body is only
 * `{ received: true }`; the internal metadata is captured for assertions and
 * never sent.
 *
 * STORAGE ROOTS are created fresh under the OS temporary directory with the
 * `valida-b4-test-` prefix, and `removeTestRoot` refuses to delete anything
 * else — tests never touch a developer's configured storage, real candidate
 * files or any user directory.
 */
export const TEST_ROOT_PREFIX = 'valida-b4-test-';
export const INTAKE_PATH = '/api/v1/__test__/resume-intake';

/** Text fields the harness accepts — the Apply fields, with transport byte caps. */
export const HARNESS_TEXT_FIELDS = Object.freeze({
  fullName: 120 * 4,
  email: 254 * 4,
  phone: 32 * 4,
  message: 5000 * 4,
  screeningAnswers: 256 * 1024,
});

export function makeTestRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), TEST_ROOT_PREFIX));
}

/**
 * Deletes a directory ONLY if it is a test root this module created.
 *
 * Links inside it (the confinement tests create symbolic links and, on
 * Windows, junctions — some pointing OUTSIDE the root) are removed first, as
 * links, by a walk that never descends into one, so the recursive delete can
 * never follow a link out of the test root, whatever the platform does.
 */
export function removeTestRoot(root) {
  const resolved = path.resolve(root);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith(TEST_ROOT_PREFIX)) {
    throw new Error('refusing to delete a directory that is not a B4 test root');
  }
  const unlinkLinks = (directory) => {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        try {
          fs.unlinkSync(full);
        } catch {
          fs.rmdirSync(full); // a Windows directory junction/link: removes the link only
        }
      } else if (entry.isDirectory()) {
        unlinkLinks(full);
      }
    }
  };
  unlinkLinks(resolved);
  fs.rmSync(resolved, { recursive: true, force: true });
}

/** Every regular file under a directory (relative paths), recursively. */
export function listFiles(directory) {
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.push(path.relative(directory, full));
    }
  };
  if (fs.existsSync(directory)) walk(directory);
  return found.sort();
}

/**
 * A fresh test root with initialised local storage and upload area.
 */
export async function createIntakeEnvironment({ storageOptions = {}, logger } = {}) {
  const root = makeTestRoot();
  const storageRoot = path.join(root, 'private-resumes');
  const tempBase = path.join(root, 'tmp');
  fs.mkdirSync(tempBase, { mode: 0o700 });
  const storage = new LocalPrivateStorage({
    root: storageRoot,
    appEnv: 'local',
    nodeEnv: 'test',
    logger,
    ...storageOptions,
  });
  await storage.init();
  const uploadArea = await TempUploadArea.create({ baseDirectory: tempBase, logger });
  return {
    root,
    storageRoot,
    tempBase,
    storage,
    uploadArea,
    /** Objects persisted in storage (paths relative to the storage root). */
    storedObjects: () => listFiles(path.join(storageRoot, 'resumes')),
    /** Temporary upload files still on disk (the area's `.owner` marker is metadata, not an upload). */
    tempFiles: () => listFiles(tempBase).filter((file) => path.basename(file) !== '.owner'),
    async cleanup() {
      await uploadArea.close().catch(() => {});
      await storage.close();
      removeTestRoot(root);
    },
  };
}

/**
 * The real application with the harness route mounted.
 * `captured` receives the internal metadata of every stored resume.
 */
export function buildIntakeApp({ storage, uploadArea, logger, textFields = HARNESS_TEXT_FIELDS, mode = 'store' } = {}) {
  const captured = [];
  const app = buildApp({
    logger,
    registerTestRoutes: (api, context) => {
      api.post('/__test__/resume-intake', async (req, res, next) => {
        let upload;
        let respond;
        try {
          upload = await parseMultipartUpload(req, {
            uploadArea: context.uploadArea ?? uploadArea,
            fileField: 'resume',
            maxFileBytes: RESUME_UPLOAD_POLICY.maxBytes,
            textFields,
          });
          if (mode === 'parse') {
            const fields = Object.keys(upload.fields);
            respond = () => res.status(200).json(successEnvelope({ fields }, req.id));
          } else {
            const validated = await validateResumeUpload(upload);
            const metadata = await storeValidatedResume({ storage: context.resumeStorage ?? storage, validated });
            captured.push({ metadata, fields: upload.fields });
            respond = () => res.status(201).json(successEnvelope({ received: true }, req.id));
          }
        } catch (error) {
          respond = () => next(error);
        } finally {
          // The temporary file is removed BEFORE the client gets its answer.
          await upload?.release();
        }
        respond();
      });
    },
  });
  return { app, captured };
}

// --------------------------------------------------- raw multipart bodies --

/**
 * Builds a multipart/form-data body byte-for-byte, for cases supertest's
 * helpers cannot express (duplicate fields, raw filenames, truncation).
 *
 * @param {Array<{ name: string, value?: string, filename?: string, contentType?: string,
 *                 data?: Buffer, rawDisposition?: string }>} parts
 */
export function multipartBody(parts, { boundary = `----qa${randomBytes(12).toString('hex')}`, close = true } = {}) {
  const chunks = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    const disposition =
      part.rawDisposition ??
      `form-data; name="${part.name}"${part.filename !== undefined ? `; filename="${part.filename}"` : ''}`;
    chunks.push(Buffer.from(`Content-Disposition: ${disposition}\r\n`, 'utf8'));
    if (part.contentType) chunks.push(Buffer.from(`Content-Type: ${part.contentType}\r\n`));
    chunks.push(Buffer.from('\r\n'));
    chunks.push(part.data ?? Buffer.from(part.value ?? '', 'utf8'));
    chunks.push(Buffer.from('\r\n'));
  }
  if (close) chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

/** A resume part. */
export const resumePart = (data, filename, contentType) => ({ name: 'resume', filename, contentType, data });
