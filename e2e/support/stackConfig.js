import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BACKEND_ORIGIN, BACKEND_PORT, FRONTEND_ORIGIN } from './paths.js';
import { baseEnvironment } from './processes.js';

/**
 * The synthetic configuration of an E2E run (Doc 17 sections 25-27: every
 * address is on a reserved, non-routable *.example.test domain).
 *
 * The two synthetic secrets — the local SMTP test login and the suppression
 * HMAC key — are generated per run by globalSetup and passed to the workers
 * through the environment only (E2E_SMTP_PASSWORD, E2E_SUPPRESSION_HMAC_KEY);
 * they are never written to the run directory, a log or an evidence file.
 */
export const IDENTITY = Object.freeze({
  smtpUsername: 'careers-qa@valida-e2e.example.test',
  fromName: 'Valida Careers QA',
  replyTo: 'careers-reply-qa@valida-e2e.example.test',
  internalRecipient: 'recruitment-qa@valida-e2e.example.test',
  /** Refused at RCPT by the local SMTP test server: the notification partial-failure case. */
  refusedCandidate: 'qa+e2e-refused@example.test',
  allowlist: '@example.test,@valida-e2e.example.test',
  suppressionKeyId: 'qa-e2e-k1',
  suppressionOperator: 'qa-e2e-operator',
});

/** The run's facts (no secrets), written by globalSetup. */
export function readRun() {
  return JSON.parse(readFileSync(path.join(process.env.E2E_RUN_DIR, 'run.json'), 'utf8'));
}

/**
 * The backend's environment — for the server AND for every backend CLI the
 * run uses (indexes, Job provisioning, suppression operations), so all of
 * them see one configuration.
 *
 *   NODE_ENV=development, APP_ENV=local   the only environment in which
 *       acknowledgements may be enabled at all: production refuses them at
 *       start-up (ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP), and that is unchanged.
 *   APPLICATION_RATE_LIMIT_MAX=100        the suite submits more than the
 *       production default of 10 per 15 minutes from one address. The limit
 *       itself is verified by the backend suites (B5, B7).
 */
export function backendEnvironment({ run, smtpPassword = process.env.E2E_SMTP_PASSWORD, suppressionKey = process.env.E2E_SUPPRESSION_HMAC_KEY }) {
  return {
    ...baseEnvironment(),
    NODE_ENV: 'development',
    APP_ENV: 'local',
    PORT: String(BACKEND_PORT),
    LOG_LEVEL: 'info',
    TRUST_PROXY: 'false',
    MONGODB_URI: process.env.MONGODB_TEST_URI,
    CORS_ALLOWED_ORIGINS: FRONTEND_ORIGIN,
    APPLICATION_RATE_LIMIT_MAX: '100',
    RESUME_STORAGE_DRIVER: 'local',
    RESUME_STORAGE_LOCAL_ROOT: run.storageRoot,
    TRANSACTIONAL_EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'localhost',
    SMTP_PORT: String(run.smtp.port),
    SMTP_SECURITY: 'implicit-tls',
    SMTP_USERNAME: IDENTITY.smtpUsername,
    SMTP_PASSWORD: smtpPassword,
    TRANSACTIONAL_FROM_ADDRESS: IDENTITY.smtpUsername,
    TRANSACTIONAL_FROM_NAME: IDENTITY.fromName,
    TRANSACTIONAL_REPLY_TO: IDENTITY.replyTo,
    RECRUITMENT_NOTIFICATION_RECIPIENT: IDENTITY.internalRecipient,
    APPLICATION_ACKNOWLEDGEMENT_ENABLED: 'true',
    EMAIL_RECIPIENT_ALLOWLIST: IDENTITY.allowlist,
    SUPPRESSION_HMAC_KEY: suppressionKey,
    SUPPRESSION_HMAC_KEY_ID: IDENTITY.suppressionKeyId,
    SUPPRESSION_OPERATOR_IDS: IDENTITY.suppressionOperator,
    // The local SMTP test server's CA (a certificate, not a key): Node's standard extra-CA mechanism.
    NODE_EXTRA_CA_CERTS: run.smtp.caFile,
  };
}

export { BACKEND_ORIGIN, FRONTEND_ORIGIN };
