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
import { noStore } from './middleware/noStore.js';
import { recruitmentAccessGate } from './middleware/recruitmentAccess.js';
import { CLOSED_RECRUITMENT_ACCESS, DISABLED_SERVICE_DELEGATION } from './config/recruitmentAccess.js';
import { noValidators } from './middleware/noValidators.js';
import { siteAccessGate } from './middleware/siteAccess.js';
import { PUBLIC_SITE_ACCESS } from './config/siteAccess.js';
import { healthRouter } from './modules/health/health.routes.js';
import { Readiness } from './modules/health/readiness.js';
import { jobsRouter } from './modules/jobs/job.routes.js';
import { createJobRepository } from './modules/jobs/job.repository.js';
import { applicationsRouter } from './modules/applications/application.routes.js';
import { createApplicationRepository } from './modules/applications/application.repository.js';
import { createApplicationSubmissionService } from './modules/applications/application.submission.js';
import { createNotificationService, notificationServiceOptions } from './integrations/notifications/notificationService.js';
import { createApplicationNotifier } from './modules/applications/application.notifications.js';
import { createSuppressionGate } from './modules/suppression/suppressionGate.js';
import { createSuppressionRegister } from './modules/suppression/suppressionRegister.js';
import { keyringFromConfig } from './modules/suppression/suppressionKeys.js';

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
 *   4. security headers before any response body can be produced — including
 *                       the Jobs `Cache-Control: no-store` policy (B3), so it
 *                       also covers responses that parsing or rate limiting
 *                       end early (400, 413, 429)
 *   4a. site access     C6-T3: on a private site, every request but liveness
 *                       is admitted or answered 403 HERE — before the Jobs
 *                       cache policy, CORS (preflight too), the recruitment
 *                       gate, body parsing, rate limiting and routing. Every
 *                       response is then `private, no-store`, no validators
 *   5. CORS             before the body is read, so preflight is cheap
 *   5b. recruitment     the access gate on /api/v1/jobs (C6-T1): a client who
 *                       may not use Jobs is answered before any body is read
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
   * Public Job reads (B3). Production uses the real MongoDB repository over
   * the process-wide Mongoose connection that server.js opens. Offline tests
   * may pass a stand-in to exercise the HTTP contract; persistence and query
   * behaviour are proven only by the real-database suite (tests/db).
   */
  jobRepository = createJobRepository({ queryTimeoutMs: config?.databaseQueryTimeoutMs }),
  /**
   * The server clock that decides publication and closing (Doc 09 section
   * 187). Production uses the real time; tests inject a fixed instant to
   * check the exact publishedAt/closesAt boundaries (Doc 17 section 39).
   */
  clock = () => new Date(),
  /**
   * Test-only hook to mount extra routes on the API router.
   *
   * This exists so the safe-500 path can be tested through the real error
   * handler without shipping a debug or crash endpoint. It is never called by
   * server.js, so production has no such route and no added attack surface.
   *
   * B4: it receives `{ resumeStorage, uploadArea, logger }` as a second
   * argument, so the reusable multipart and resume components can be tested
   * through the real middleware stack (request id, security headers, rate
   * limit, error handler) without adding an upload endpoint to the product.
   */
  registerTestRoutes,
  /**
   * B4 — the private resume storage and the per-process temporary upload
   * area, created and initialised by server.js (null when storage is not
   * configured). B5's Apply route consumes them.
   */
  resumeStorage = null,
  uploadArea = null,
  /**
   * B5 — Application persistence (validated B2 saves over the process-wide
   * Mongoose connection). Offline tests may pass a stand-in to drive failure
   * paths; persistence, the unique indexes and concurrency are proven only by
   * the real-database suite.
   */
  applicationRepository = createApplicationRepository({ timeoutMs: config?.databaseQueryTimeoutMs }),
  /**
   * B5/B6 — the Notification Service. server.js passes the one built from
   * the configured transport (r4: the SMTP adapter when
   * TRANSACTIONAL_EMAIL_PROVIDER=smtp). This default has none: nothing is
   * attempted and nothing is claimed sent. Tests inject transports.
   */
  notificationService = createNotificationService({
    transport: null,
    timeoutMs: config?.notificationTimeoutMs ?? 5_000,
    clock,
    ...notificationServiceOptions(config?.notifications),
  }),
  /**
   * B7 — the recipient-suppression check for candidate acknowledgements
   * (design rev 8 §3.2; OD-2026-11-04-02): the real register over the
   * process-wide Mongoose connection and the configured keys. Without a
   * current key every acknowledgement fails closed. Offline tests inject a
   * stand-in; the register itself is proven by the real-database suite.
   */
  suppressionGate = createSuppressionGate({
    register: createSuppressionRegister({ timeoutMs: config?.suppression?.lookupTimeoutMs ?? 2_000, writeTimeoutMs: config?.databaseQueryTimeoutMs }),
    keyring: keyringFromConfig(config?.suppression),
  }),
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

  /*
   * 4a. Site access — C6-T3 (middleware/siteAccess.js). A no-op on a public
   * site. On a private one it admits or refuses every request before any
   * other work, and makes every response `private, no-store` without
   * validators. A configuration object without a `siteAccess` entry is the
   * public site of a local run (config/env.js always supplies one).
   */
  app.use(
    siteAccessGate({
      site: config.siteAccess ?? PUBLIC_SITE_ACCESS,
      trustedHops: config.trustProxy ?? false,
      delegation: config.serviceDelegation ?? DISABLED_SERVICE_DELEGATION,
    }),
  );

  /*
   * 4b. Jobs cache policy — Doc 09 section 58. Mounted here, with the other
   * response headers and BEFORE CORS, body parsing and rate limiting, so that
   * every response on /api/v1/jobs carries `Cache-Control: no-store` — also the
   * 400/413 a malformed or oversized body produces and the 429 of the rate
   * limiter, which end the request before the Jobs router is reached.
   */
  app.use(`${API_BASE_PATH}/jobs`, noStore());
  // C6-T2: Jobs responses depend on who asks. No ETag or Last-Modified is
  // sent and no conditional request is answered 304 (middleware/noValidators.js).
  app.use(`${API_BASE_PATH}/jobs`, noValidators());

  // 5. CORS, from the explicit allowlist.
  app.use(corsMiddleware(config.corsAllowedOrigins));

  /*
   * 5b. Recruitment access gate — C6-T1 (middleware/recruitmentAccess.js).
   * After CORS, so a refusal still carries the CORS headers a browser needs to
   * read it; BEFORE body parsing and rate limiting, so a client who may not use
   * Jobs is refused with the body unread. A configuration object without a
   * `recruitment` entry is treated as closed. The gate takes the same
   * TRUST_PROXY value as step 1, and applies it more strictly than req.ip: a
   * forwarding chain shorter than the hop count is an unknown client.
   */
  app.use(
    `${API_BASE_PATH}/jobs`,
    recruitmentAccessGate({
      access: config.recruitment ?? CLOSED_RECRUITMENT_ACCESS,
      trustedHops: config.trustProxy ?? false,
      delegation: config.serviceDelegation ?? DISABLED_SERVICE_DELEGATION,
      // C6-T2: a rejected delegated read is logged by its fixed reason code
      // only — never a header value, a key or an address.
      onDelegationRejected: ({ outcome }) => logger.warn({ event: 'recruitment.delegation_rejected', outcome }, 'delegated Jobs read rejected'),
    }),
  );

  // 6. JSON body parsing with the general 100 KB limit. A malformed body or an
  //    oversized one becomes a controlled envelope in the error handler.
  app.use(express.json({ limit: config.jsonBodyLimit }));

  const api = express.Router();

  // 7. General public rate limiting, scoped to the API router.
  app.use(API_BASE_PATH, generalRateLimit(config.rateLimit));

  // 8. Routes.
  api.use('/health', healthRouter({ readiness, logger }));
  // B3 — public Jobs API (Doc 09 sections 48-70).
  api.use('/jobs', jobsRouter({ repository: jobRepository, clock, logger }));
  // B5 — Apply (Doc 09 sections 71-150): POST /jobs/:jobSlug/applications only.
  // B6 — the claim / send / record cycle shared with ops:notifications:retry.
  const notifier = createApplicationNotifier({ applications: applicationRepository, notifications: notificationService, clock, logger, suppression: suppressionGate });
  const applicationSubmission = createApplicationSubmissionService({
    jobs: jobRepository,
    applications: applicationRepository,
    storage: resumeStorage,
    notifier,
    clock,
    logger,
  });
  app.locals.applicationSubmission = applicationSubmission;
  api.use(
    '/jobs',
    applicationsRouter({ service: applicationSubmission, uploadArea, resumeStorage, rateLimit: config.applicationRateLimit ?? { windowMs: 900_000, max: 10 } }),
  );

  if (typeof registerTestRoutes === 'function') {
    registerTestRoutes(api, { resumeStorage, uploadArea, logger });
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
