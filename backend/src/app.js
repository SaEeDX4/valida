import express from 'express';

/**
 * Builds and returns the Express application.
 *
 * Governed by 09_BACKEND_API_SPEC.md sections 5 and 7.
 *
 * This module MUST NOT:
 *   - open the listening socket;
 *   - contain deployment-specific boot logic.
 * Keeping those in server.js is what allows integration tests (Supertest, per
 * Document 17) to import the application cleanly in later milestones.
 *
 * MILESTONE A1 SCOPE
 * A1 delivers a startable Express foundation only. The following are owned by
 * Milestone B1 and are deliberately NOT implemented here:
 *   - /api/v1 router mounting
 *   - environment configuration validation
 *   - security headers, CORS, rate limiting, request-size limits
 *   - request ID and structured request logging
 *   - health and readiness endpoints
 *   - structured error handler and safe 404 handler
 *
 * Until B1 mounts routes, every request correctly returns Express's default
 * 404. That is the accurate state of the system, not a placeholder response.
 */
export function createApp() {
  const app = express();

  // Do not advertise the server framework. Full security header policy is
  // implemented in B1 per 13_SECURITY_PRIVACY_THREAT_MODEL.md.
  app.disable('x-powered-by');

  return app;
}

export default createApp;
