import cors from 'cors';

/**
 * CORS — Doc 13.
 *
 * An explicit allowlist. There is no wildcard: the configuration schema
 * rejects "*" outright, and production must name its origins or fail to start.
 *
 * A disallowed origin receives NO Access-Control-Allow-Origin header, rather
 * than an error response. That is the correct behaviour: the browser then
 * blocks the response, while non-browser clients (curl, server-to-server,
 * health probes) which send no Origin at all keep working normally. Returning
 * 403 instead would break those callers for no security gain, since CORS is a
 * browser policy and not an authentication mechanism.
 *
 * credentials is deliberately false: Phase 1 has no cookie or session, and
 * credentials can never be combined with a wildcard.
 */
export function corsMiddleware(allowedOrigins) {
  const allowed = new Set(allowedOrigins);

  return cors({
    origin(origin, callback) {
      // No Origin header: a non-browser client. Nothing to authorise.
      if (!origin) return callback(null, true);
      callback(null, allowed.has(origin));
    },
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Request-ID', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-ID'],
    maxAge: 600,
  });
}
