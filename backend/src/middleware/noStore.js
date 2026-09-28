/**
 * `Cache-Control: no-store` for a route family — Doc 09 section 58.
 *
 * Public Job eligibility and closing state must change the moment the server
 * says so; a cached "open" answer for a closed role, or a cached error for a
 * role that has since opened, would be wrong. The policy covers EVERY response
 * of the family, including those produced before its router runs — a malformed
 * or oversized body (400/413 from the body parser) and a rate-limited request
 * (429) — so it is mounted in app.js ahead of those middlewares, not inside the
 * router.
 */
export function noStore() {
  return function noStoreMiddleware(_req, res, next) {
    res.set('Cache-Control', 'no-store');
    next();
  };
}
