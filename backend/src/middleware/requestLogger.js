import pinoHttp from 'pino-http';
import { safeErrorSummary } from '../lib/safeError.js';

/**
 * Structured request logging — Doc 09 section 11, Doc 13.
 *
 * Logs method, path, status, duration and the request id.
 *
 * WHAT IS DELIBERATELY NOT LOGGED
 * - the request body (a resume, a candidate's name and email pass through it);
 * - the query string (it can carry candidate-identifying values);
 * - headers beyond the few named below.
 * Only the PATH is logged, with any query string removed, so an accidental
 * `?email=...` never reaches a log file.
 */
export function requestLogger(logger) {
  return pinoHttp({
    logger,
    // The id is already generated and validated upstream.
    genReqId: (req) => req.id,
    quietReqLogger: true,
    customLogLevel(_req, res, error) {
      if (error || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {
      req(req) {
        const path = typeof req.url === 'string' ? req.url.split('?')[0] : req.url;
        return { id: req.id, method: req.method, path };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
      /*
       * Neither the message nor the stack is logged. pino-http attaches the
       * error automatically on a failed response, and that error's text is the
       * single most likely place for a credential, a connection string or a
       * fragment of the request body to appear.
       */
      err: safeErrorSummary,
    },
  });
}
