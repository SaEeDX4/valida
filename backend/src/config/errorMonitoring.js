/**
 * C6-T6 — error-monitoring configuration (D-4a: Sentry; C6 plan r3 §4.5,
 * §10 step 2e). Shared by the API (config/env.js) and the document server
 * (frontend/server/serve.mjs), like the release and site-access rules.
 *
 *   SENTRY_DSN absent or empty  → monitoring DISABLED. The service starts
 *                                  exactly as before and sends nothing.
 *   a well-formed DSN            → ENABLED.
 *   anything else                → the service REFUSES TO START, naming the
 *                                  variable and the rule, never the value.
 *
 * A well-formed DSN is `https://<public key>@<host>[:<port>]/<project id>`:
 *   - the public key is 32 lowercase hexadecimal characters (Sentry's form);
 *   - no password, no query, no fragment, no path other than one numeric
 *     project id;
 *   - `http://` only for a loopback host (127.0.0.1, ::1, localhost) when
 *     APP_ENV=local and NODE_ENV is not production — the same exception the
 *     API already makes for its other loopback test endpoints. Review and
 *     Production deliver over HTTPS only.
 *
 * The DSN is treated as a secret (plan §4.3): it is kept as a NON-ENUMERABLE
 * property, so it is in no serialised view of the configuration, and nothing
 * here or in the start-up line prints it. The start-up line says only
 * whether monitoring is enabled and over which kind of transport.
 */
export const MONITORING_DSN_VARIABLE = 'SENTRY_DSN';
export const MONITORING_DSN_RULE =
  'must be a Sentry DSN of the form https://<32-hex public key>@<host>/<numeric project id>, with no password, query or fragment; ' +
  'plain http:// is accepted only for a loopback receiver when APP_ENV=local and NODE_ENV is not production';

const LOOPBACK = new Set(['127.0.0.1', '[::1]', 'localhost']);
const PUBLIC_KEY = /^[0-9a-f]{32}$/;
const PROJECT_PATH = /^\/[1-9][0-9]{0,18}$/;

export function resolveErrorMonitoring({ dsn, appEnv = 'local', nodeEnv } = {}) {
  if (dsn === undefined || dsn === '') return Object.freeze({ ok: true, state: 'disabled' });
  const refused = Object.freeze({ ok: false, variable: MONITORING_DSN_VARIABLE, rule: MONITORING_DSN_RULE });
  if (typeof dsn !== 'string' || dsn.length > 512 || /\s/.test(dsn)) return refused;
  let url;
  try {
    url = new URL(dsn);
  } catch {
    return refused;
  }
  if (url.password !== '' || url.search !== '' || url.hash !== '' || dsn.includes('?') || dsn.includes('#')) return refused;
  if (!PUBLIC_KEY.test(url.username)) return refused;
  if (!PROJECT_PATH.test(url.pathname)) return refused;
  let transport;
  if (url.protocol === 'https:') transport = 'https';
  else if (url.protocol === 'http:' && LOOPBACK.has(url.hostname) && appEnv === 'local' && nodeEnv !== 'production') {
    transport = 'loopback-http';
  } else return refused;

  const resolved = { ok: true, state: 'enabled', transport };
  Object.defineProperty(resolved, 'dsn', { value: dsn, enumerable: false });
  return Object.freeze(resolved);
}

/** The start-up line: never the DSN, its key or its host. */
export function describeErrorMonitoring(monitoring) {
  return {
    errorMonitoring: monitoring?.state ?? 'disabled',
    errorMonitoringTransport: monitoring?.state === 'enabled' ? monitoring.transport : null,
  };
}
