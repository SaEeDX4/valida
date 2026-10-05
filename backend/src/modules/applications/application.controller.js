import {
  AppError,
  ERROR_CODES,
  applicationUnavailable,
  idempotencyKeyRequired,
  invalidIdempotencyKey,
} from '../../errors/AppError.js';
import { RESUME_UPLOAD_POLICY } from '../../config/resumePolicy.js';
import { parseMultipartUpload } from '../../lib/multipart/multipart.js';
import { APPLICATION_TEXT_FIELDS, validateIdempotencyKeyHeader } from './application.validation.js';

/**
 * POST /api/v1/jobs/:jobSlug/applications — Milestone B5 (Doc 09 sections 71-150).
 *
 * HTTP only: the protocol header, the bounded multipart parse (B4) and the
 * response. Every business decision is the submission service's.
 *
 * Before the body is read:
 *   - the Apply rate limit (route middleware, application.routes.js);
 *   - the Idempotency-Key header (Doc 09 sections 74-76)   400;
 *   - private storage configured at all                    503.
 * Each of these answers with the body unread, so it asks the error handler to
 * close the connection in stages (lib/http/stagedClose.js): the upload is
 * never processed as another request, and the client still gets the answer.
 *
 * The temporary file the parser created is released in `finally`, BEFORE the
 * response is sent, whatever the outcome (B4: no temporary file outlives the
 * request the client sees completed).
 *
 * Every 503 on this route carries the Apply wording of Doc 06 section 146
 * (Doc 09 section 137: "approved frontend-compatible failure messaging"),
 * including the B4 temporary-storage 503s, whose classification and
 * connection handling are kept unchanged.
 */

/** The success envelope — Doc 09 sections 125-127. Nothing internal, nothing the candidate sent. */
export function applicationResultEnvelope(result, requestId) {
  return {
    success: true,
    data: {
      status: result.status,
      job: { title: result.job.title, slug: result.job.slug },
      submittedAt: new Date(result.submittedAt).toISOString(),
    },
    meta: { requestId, replayed: result.replayed === true },
  };
}

/** A 503 from any layer keeps its reason and connection handling, with the Apply wording. */
function applyWording(error) {
  if (error instanceof AppError && error.status === 503 && error.code === ERROR_CODES.SERVICE_UNAVAILABLE) {
    return applicationUnavailable(error.cause, { reason: error.reason, closeConnection: error.closeConnection });
  }
  return error;
}

export function createApplicationsController({ service, uploadArea, resumeStorage }) {
  async function submitApplication(req, res, next) {
    const key = validateIdempotencyKeyHeader(req.headers['idempotency-key']);
    if (!key.ok) {
      next(key.problem === 'MISSING' ? idempotencyKeyRequired({ closeConnection: true }) : invalidIdempotencyKey({ closeConnection: true }));
      return;
    }
    // No private storage configured (config/env.js): an Application cannot be stored.
    if (!uploadArea || !resumeStorage) {
      next(applicationUnavailable(undefined, { reason: 'RESUME_STORAGE_NOT_CONFIGURED', closeConnection: true }));
      return;
    }

    let upload;
    try {
      upload = await parseMultipartUpload(req, {
        uploadArea,
        fileField: 'resume',
        maxFileBytes: RESUME_UPLOAD_POLICY.maxBytes,
        textFields: APPLICATION_TEXT_FIELDS,
      });
    } catch (error) {
      next(applyWording(error));
      return;
    }

    let result;
    let failure;
    try {
      result = await service.submit({ jobSlug: req.params.jobSlug, idempotencyKey: key.key, upload, requestId: req.id });
    } catch (error) {
      failure = error;
    } finally {
      await upload.release();
    }
    if (failure) {
      next(applyWording(failure));
      return;
    }
    res.status(result.replayed ? 200 : 201).json(applicationResultEnvelope(result, req.id));
  }

  return { submitApplication };
}
