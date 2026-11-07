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
 * holds.
 *
 * C3 r3: a path a route DID match is logged as that route's TEMPLATE, never
 * with the values in it. Express sets req.route as soon as a route PATTERN
 * matches — before the controller validates :jobSlug — so
 * `GET /api/v1/jobs/<anything>` is "matched" whatever <anything> is: an e-mail
 * address, a storage key segment. The line gets `/api/v1/jobs/:jobSlug` or
 * `/api/v1/jobs/:jobSlug/applications` instead: Job Detail and Apply stay
 * distinguishable, and no request value is written. Static routes
 * (`/api/v1/jobs`, `/api/v1/health`) read the same either way.
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

/** Where the matched route's template is kept on the request (see recordRouteTemplate). */
const ROUTE_TEMPLATE = Symbol('valida.accessLog.routeTemplate');

/**
 * The template of a matched route: the router's mount path (`req.baseUrl` when
 * the route matched), written as its shape so that only route words survive,
 * followed by the route's own PATTERN from the code, e.g. `/:jobSlug`. Neither
 * part holds a request value. Undefined when the pattern is not a plain path
 * string (an array or a regular expression): the caller then logs the shape.
 */
export function routeTemplate(baseUrl, route) {
  const pattern = route?.path;
  if (typeof pattern !== 'string' || !pattern.startsWith('/')) return undefined;
  const base = baseUrl ? unmatchedPathShape(baseUrl) : '';
  const prefix = base === '/' ? '' : base;
  if (pattern === '/') return prefix || '/';
  return `${prefix}${pattern}`;
}

/**
 * Records the template at the moment Express assigns req.route — the only time
 * `req.baseUrl` is the matching router's mount path; by the time the response
 * finishes, the routers have restored it. The accessor stores and returns
 * exactly the value Express assigns, so routing behaves as before.
 */
function recordRouteTemplate(req) {
  let route;
  Object.defineProperty(req, 'route', {
    configurable: true,
    enumerable: true,
    get: () => route,
    set(value) {
      route = value;
      req[ROUTE_TEMPLATE] = value ? routeTemplate(req.baseUrl, value) : undefined;
    },
  });
}

export function requestLogger(logger) {
  const logRequest = pinoHttp({
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
        // Express sets req.route on the raw request when a route pattern matches.
        // The line is written when the response finishes, so routing is over by
        // then. A matched route without a usable template falls back to the shape.
        const raw = req.raw ?? req;
        const routeMatched = Boolean(raw.route);
        const logged = routeMatched ? (raw[ROUTE_TEMPLATE] ?? unmatchedPathShape(path)) : unmatchedPathShape(path);
        return { id: req.id, method: req.method, path: logged, routeMatched };
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

  function requestLogging(req, res, next) {
    recordRouteTemplate(req);
    logRequest(req, res, next);
  }
  requestLogging.logger = logRequest.logger;
  return requestLogging;
}
