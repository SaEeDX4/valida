/**
 * No cache validators for a route family — Milestone C6, task C6-T2.
 *
 * Jobs responses depend on WHO asks (the recruitment mode and the tester
 * allowlist, C6-T1). They are already `Cache-Control: no-store` (noStore.js,
 * Doc 09 section 58), so no cache may keep them. This removes the remaining
 * path by which one client's response could be confirmed, or replayed, for
 * another: Express's automatic ETag and the 304 answer it enables.
 *
 *   - The request's conditional headers (If-None-Match, If-Modified-Since,
 *     If-Match, If-Unmodified-Since, If-Range) are dropped before any router
 *     reads them, so Express never finds the request "fresh" and never
 *     answers 304. Every request gets the full answer for ITS visitor.
 *   - ETag and Last-Modified are removed from the response just before its
 *     headers are written, whichever code set them.
 *
 * Mounted in app.js on /api/v1/jobs, next to noStore(), ahead of body parsing
 * and rate limiting, so it covers every response of the family.
 */
const CONDITIONAL_REQUEST_HEADERS = ['if-none-match', 'if-modified-since', 'if-match', 'if-unmodified-since', 'if-range'];

export function noValidators() {
  return function noValidatorsMiddleware(req, res, next) {
    for (const name of CONDITIONAL_REQUEST_HEADERS) delete req.headers[name];
    const writeHead = res.writeHead;
    res.writeHead = function writeHeadWithoutValidators(...args) {
      this.removeHeader('ETag');
      this.removeHeader('Last-Modified');
      return writeHead.apply(this, args);
    };
    next();
  };
}
