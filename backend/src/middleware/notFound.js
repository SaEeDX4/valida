import { notFound } from '../errors/AppError.js';

/**
 * API 404 — Doc 09 section 22.
 *
 * Mounted after every API route so an unknown path under /api/v1 produces the
 * canonical JSON envelope. Without it Express replies with an HTML error page,
 * which a JSON client cannot parse and which leaks the framework's default
 * output.
 */
export function apiNotFound() {
  return function apiNotFoundMiddleware(_req, _res, next) {
    next(notFound());
  };
}
