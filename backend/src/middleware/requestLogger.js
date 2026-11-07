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
 *
 * C3 (GPT finding 3): a path that NO ROUTE MATCHED is not logged raw either.
 * Anyone can put anything in a URL — C3's public-access probes put a private
 * storage key there, and the access log wrote it out. When no route handled
 * the request (every 404, and every request answered before routing: rate
 * limit, CORS, body parsing), the log gets the path's SHAPE: the API's own
 * route words are kept and every other segment becomes `{segment}`, e.g.
 * `/api/v1/jobs/{segment}/applications`. `routeMatched` says which form a line
 * holds. A path a route did match is logged exactly as before; its parameters
 * are values that route accepts, such as a public Job slug.
 */

/**
 * The words that make up the API's routes (app.js and the module routers). A
 * segment equal to one of them is kept in an unmatched path's shape; any other
 * segment is replaced. Kept here rather than imported: app.js imports this
 * module.
 */
const ROUTE_WORDS = new Set(['api', 'v1', 'health', 'ready', 'jobs', 'applications']);
/** Segments written for an unmatched path; the rest are counted, not written. */
const MAX_SHAPE_SEGMENTS = 12;

export function unmatchedPathShape(path) {
  if (typeof path !== 'string') return undefined;
  const segments = path.split('/');
  // A normal path starts with '/', so the first element is the empty string before it.
  const leading = segments[0] === '' ? segments.shift() : null;
  const shown = segments.slice(0, MAX_SHAPE_SEGMENTS).map((segment) => {
    if (segment === '') return '';
    const word = segment.toLowerCase();
    return ROUTE_WORDS.has(word) ? word : '{segment}';
  });
  const hidden = segments.length - shown.length;
  if (hidden > 0) shown.push(`{+${hidden} more}`);
  return (leading === null ? '' : '/') + shown.join('/');
}

export function requestLogger(logger) {
  return pinoHttp({
    logger,
    // The id is already generated and validated upstream.
    genReqId: (req) => req.id,
    quietReqLogger: true,
    /*
     * C3: the request is described when the response FINISHES, not when it
     * arrives. pino-http would otherwise bind `req` to a child logger as the
     * request comes in — serialised then, before routing — so the serialiser
     * could never know whether a route matched. With quietResLogger the
     * completion line is written by the reqId-only logger, and `req` is added
     * to that line here, once, after routing. The line keeps its fields: reqId,
     * req, res, responseTime (and err on a failure).
     */
    quietResLogger: true,
    customSuccessObject: (req, _res, value) => ({ req, ...value }),
    customErrorObject: (req, _res, _error, value) => ({ req, ...value }),
    customLogLevel(_req, res, error) {
      if (error || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {
      req(req) {
        const path = typeof req.url === 'string' ? req.url.split('?')[0] : req.url;
        // Express sets req.route on the raw request when a route handles it. The
        // line is written when the response finishes, so routing is over by then.
        const routeMatched = Boolean((req.raw ?? req).route);
        return { id: req.id, method: req.method, path: routeMatched ? path : unmatchedPathShape(path), routeMatched };
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
