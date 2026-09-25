import pino from 'pino';

/**
 * Structured logger — 09_BACKEND_API_SPEC.md section 11, Doc 13.
 *
 * Production emits JSON, one object per line, for machine ingestion.
 *
 * PRIVACY (Doc 13)
 * Request and response BODIES are never logged, so a resume, a candidate's
 * name or an email address cannot reach a log line through the normal path.
 * The redaction list below is defence in depth for the headers that carry
 * credentials, in case a future call site logs a raw request object.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["proxy-authorization"]',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  'token',
  '*.token',
  /*
   * Defence in depth. Every B1 call site already reduces errors with
   * safeErrorSummary, which never includes these fields. Censoring them here
   * as well means that if a future call site ever passes a raw Error, the
   * message and stack — the most likely carriers of a connection string,
   * credential or filesystem path — still cannot reach the log.
   *
   * This is a backstop, not the control: path redaction cannot see a secret
   * embedded in free text under some other key, which is why the summariser
   * exists.
   */
  'err.message',
  'err.stack',
  'err.cause',
  '*.err.message',
  '*.err.stack',
  'error.message',
  'error.stack',
];

/**
 * @param {object}  [options]
 * @param {object}  [options.destination] Optional pino destination stream.
 *   Used by tests to capture the REAL serialised output — the bytes that would
 *   reach a log file — rather than the arguments passed in, which pino has not
 *   yet run its serialisers or redaction over.
 */
export function createLogger({ level = 'info', appEnv = 'local', isProduction = false, destination } = {}) {
  const options = {
    level,
    base: { service: 'valida-backend', appEnv },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    // Human-readable timestamps in logs; ISO is what log platforms expect.
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: isProduction ? undefined : { level: (label) => ({ level: label }) },
  };

  return destination ? pino(options, destination) : pino(options);
}
