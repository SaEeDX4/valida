import { AppError, ERROR_CODES, malformedRequest, payloadTooLarge } from '../errors/AppError.js';
import { errorEnvelope } from '../lib/envelope.js';
import { safeErrorSummary } from '../lib/safeError.js';
import { closeAfterResponseInStages } from '../lib/http/stagedClose.js';

/**
 * Central error handler — Doc 09 sections 20-23, Doc 13.
 *
 * The single place any error becomes a response. Its contract:
 *
 *   A handled AppError sends its own safe message.
 *   Anything else becomes a generic 500 INTERNAL_ERROR.
 *
 * NOTHING about an unexpected failure reaches the client: no stack, no file
 * path, no environment variable, no connection string, no provider credential,
 * no driver message.
 *
 * Nor is that detail written to the log. What is recorded is the requestId
 * plus a bounded classification — error type, HTTP status and canonical code —
 * drawn from fixed tables in lib/safeError.js. The requestId appears in both
 * the log and the client's response, which is how an operator correlates a
 * user's report without any raw text being stored.
 */

/** Translates body-parser failures into canonical AppErrors. */
function normalise(error) {
  if (error instanceof AppError) return error;

  // express.json() surfaces these via the `type` property.
  if (error?.type === 'entity.parse.failed') return malformedRequest(error);
  if (error?.type === 'entity.too.large') return payloadTooLarge(error);

  return null;
}

export function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars -- Express identifies the error
  // handler by its four-parameter signature; `next` must stay.
  return function centralErrorHandler(error, req, res, next) {
    const appError = normalise(error);

    if (appError) {
      /*
       * The cause is deliberately NOT logged. For a malformed-JSON failure it
       * is the body-parser error, whose message quotes the offending fragment
       * of the request body — on this API that is candidate data.
       *
       * The canonical code and status already say what went wrong, and the
       * requestId ties the entry to the client's response.
       *
       * B4: `reason` and `detected` are internal classification tokens (why a
       * resume was refused, what its content really was). AppError accepts
       * only fixed upper-case tokens for them, so they are safe to log; they
       * are never part of the response body.
       */
      const entry = {
        reqId: req.id,
        code: appError.code,
        status: appError.status,
        err: safeErrorSummary(appError.cause),
      };
      if (appError.reason) entry.reason = appError.reason;
      if (appError.detected) entry.detected = appError.detected;
      logger.warn(entry, 'request failed');

      if (res.headersSent) {
        // A response already started cannot become an error envelope. If it
        // is still open, destroy it — the same as the unexpected-error path
        // below — so it never hangs half-written. The failure is logged above.
        if (!res.writableEnded) res.destroy();
        return;
      }
      /*
       * An upload answered before its body was read (over the limit, or a
       * server-side temporary-storage failure): close the connection after
       * this response, so nothing that follows on it is processed as another
       * request (the server's request listener refuses any request pipelined
       * behind it) — in stages (RFC 9112 section 9.6, lib/http/stagedClose.js),
       * so the client still receives this response instead of a TCP reset.
       */
      if (appError.closeConnection) {
        res.set('Connection', 'close');
        closeAfterResponseInStages(req, { logger });
      }
      res.status(appError.status).json(
        errorEnvelope(
          { code: appError.code, message: appError.message, fieldErrors: appError.fieldErrors },
          req.id,
        ),
      );
      return;
    }

    /*
     * Unexpected failure.
     *
     * Only safe metadata is recorded — never the message or stack, which are
     * where connection strings, credentials and filesystem paths live. The
     * requestId is the correlation handle: it appears here and in the client's
     * response, so a user's report maps to this exact entry.
     */
    logger.error(
      { reqId: req.id, err: safeErrorSummary(error), status: 500, code: ERROR_CODES.INTERNAL_ERROR },
      'unhandled error',
    );

    if (res.headersSent) {
      // A response is already streaming; the only safe action is to destroy it.
      res.destroy();
      return;
    }

    res.status(500).json(
      errorEnvelope(
        {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'An unexpected error occurred. Please try again.',
        },
        req.id,
      ),
    );
  };
}
