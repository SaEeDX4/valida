import express from 'express';
import helmet from 'helmet';
import { loadConfig } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { requestId } from './middleware/requestId.js';
import { requestLogger } from './middleware/requestLogger.js';
import { corsMiddleware } from './middleware/corsMiddleware.js';
import { generalRateLimit } from './middleware/rateLimit.js';
import { apiNotFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './modules/health/health.routes.js';
import { Readiness } from './modules/health/readiness.js';

/** The one public API base path — Doc 09 section 5. */
export const API_BASE_PATH = '/api/v1';

/**
 * Builds and returns the Express application.
 *
 * Governed by 09_BACKEND_API_SPEC.md sections 5 and 7.
 *
 * This module MUST NOT open the listening socket. Keeping `listen` in
 * server.js is what lets Supertest import the app directly, so tests exercise
 * the real middleware stack without binding a port (Doc 17).
 *
 * Everything it needs is injected with a working default, so a test can supply
 * its own configuration, logger or readiness state without touching
 * process.env or reaching into module internals.
 *
 * MIDDLEWARE ORDER (Doc 09 section 7) — the order is the design:
 *   1. trust proxy      before anything reads req.ip
 *   2. request id       so every later log line and error can be correlated
 *   3. request logging  early, so even a rejected request is recorded
 *   4. security headers before any response body can be produced
 *   5. CORS             before the body is read, so preflight is cheap
 *   6. body parsing     with the 100 KB limit
 *   7. rate limiting    after identity, before any route work
 *   8. API routes
 *   9. API 404          only reached when no route matched
 *  10. error handler    last; Express routes all errors here
 */
export function createApp({
  config = loadConfig(),
  logger = createLogger({ level: config?.logLevel, appEnv: config?.appEnv, isProduction: config?.isProduction }),
  readiness = new Readiness(),
  /**
   * Test-only hook to mount extra routes on the API router.
   *
   * This exists so the safe-500 path can be tested through the real error
   * handler without shipping a debug or crash endpoint. It is never called by
   * server.js, so production has no such route and no added attack surface.
   */
  registerTestRoutes,
} = {}) {
  const app = express();

  // 1. Trust proxy. Explicit and validated; false unless configured.
  app.set('trust proxy', config.trustProxy);

  // Never advertise the framework (Doc 13).
  app.disable('x-powered-by');

  // 2. Request id, and X-Request-ID on the response.
  app.use(requestId());

  // 3. Structured request logging.
  app.use(requestLogger(logger));

  /*
   * 4. Security headers.
   *
   * This API serves JSON only, never HTML, so a restrictive CSP costs nothing
   * and blocks any attempt to render an injected document. crossOriginResourcePolicy
   * stays same-origin: nothing here is meant to be embedded by another site.
   */
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  // 5. CORS, from the explicit allowlist.
  app.use(corsMiddleware(config.corsAllowedOrigins));

  // 6. JSON body parsing with the general 100 KB limit. A malformed body or an
  //    oversized one becomes a controlled envelope in the error handler.
  app.use(express.json({ limit: config.jsonBodyLimit }));

  const api = express.Router();

  // 7. General public rate limiting, scoped to the API router.
  app.use(API_BASE_PATH, generalRateLimit(config.rateLimit));

  // 8. Routes.
  api.use('/health', healthRouter({ readiness, logger }));

  if (typeof registerTestRoutes === 'function') {
    registerTestRoutes(api);
  }

  app.use(API_BASE_PATH, api);

  // 9. Unknown route -> canonical JSON 404, never Express HTML. Mounted at the
  //    root so a request outside /api/v1 gets the same safe envelope.
  app.use(apiNotFound());

  // 10. Central error handler.
  app.use(errorHandler(logger));

  return app;
}

export default createApp;
