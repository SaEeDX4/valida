import { z } from 'zod';
import { parseMongoUri } from '../db/connectionString.js';

/**
 * Centralised environment configuration — 15_DEVOPS_DEPLOYMENT.md sections
 * 49-58, 09_BACKEND_API_SPEC.md section 11.
 *
 * One schema, validated once at startup. If required production configuration
 * is missing or malformed the process must fail to start rather than run in a
 * half-configured state (Doc 15 section 50).
 *
 * TRUTHFULNESS RULE
 * This schema knows only about configuration the backend actually consumes.
 * B1 added the runtime variables; B2 added MONGODB_URI (required) and
 * MONGODB_CONNECT_TIMEOUT_MS. Resume storage (B4), transactional email (B6)
 * and PUBLIC_SITE_URL (Release C) are recorded in .env.example as future
 * variables but are deliberately NOT required or read here: requiring a
 * variable nothing uses would imply the capability exists.
 */

/** Ports outside this range cannot be bound. */
const port = z.coerce.number().int().min(1).max(65535);

/**
 * Is this string a canonical HTTP(S) origin — scheme + host + optional
 * non-default port, and nothing else?
 *
 * Validated with the WHATWG URL parser rather than a regular expression. The
 * previous pattern, /^https?:\/\/[^/\s]+$/, accepted plenty it should not:
 * "https://user:pass@example.com" (userinfo), "https://example.com?token=x"
 * and "https://example.com#f" all contain no slash after the host and matched.
 *
 * The test is then a single comparison: the input must equal `url.origin`.
 * That one equality enforces every rule at once, because `origin` is by
 * definition scheme + host + non-default port and nothing else. It rejects
 * userinfo, path, query, fragment and trailing slash, and it also rejects a
 * redundant default port ("https://example.com:443") and a non-lowercase host,
 * both of which normalise away — a browser never sends either, so such a value
 * would silently never match and look like a CORS bug.
 */
function isCanonicalOrigin(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  // Reject any whitespace outright; the parser would otherwise trim some of it.
  if (/\s/.test(value)) return false;

  let url;
  try {
    url = new URL(value);
  } catch {
    // Unparseable, including "*", a bare host and an out-of-range port.
    return false;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '') return false;
  if (url.hostname === '') return false;

  return value === url.origin;
}

const originList = z
  .string()
  .transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean))
  .superRefine((origins, ctx) => {
    /*
     * The issue message is a fixed SENTINEL, never the rejected value.
     * Interpolating the value would put it into the thrown error, and from
     * there into terminal and hosting logs — and an origin string can carry
     * userinfo credentials or a token in its query. RULE_TEXT below turns each
     * sentinel into safe, value-free wording.
     */
    if (origins.includes('*')) {
      ctx.addIssue({ code: 'custom', message: 'CORS_WILDCARD' });
      return;
    }
    if (!origins.every(isCanonicalOrigin)) {
      ctx.addIssue({ code: 'custom', message: 'CORS_INVALID_ORIGIN' });
    }
  });

/**
 * TRUST_PROXY — Doc 13.
 *
 * Deliberately defaults to `false`. Blindly trusting X-Forwarded-For lets any
 * client spoof its IP, which would let a single attacker bypass the rate limit
 * entirely. The correct production value depends on the actual hosting
 * topology (how many proxies sit in front of the app), so it is explicit
 * configuration, not a guess.
 *
 * Accepted: "false" (default), or a hop count such as "1".
 */
const trustProxy = z
  .string()
  .default('false')
  .superRefine((value, ctx) => {
    if (value === 'false') return;
    const hops = Number(value);
    if (!Number.isInteger(hops) || hops < 1 || hops > 10) {
      ctx.addIssue({ code: 'custom', message: 'TRUST_PROXY_INVALID' });
    }
  })
  .transform((value) => (value === 'false' ? false : Number(value)));

/**
 * MONGODB_URI — Milestone B2.
 *
 * Validated with the MongoDB driver's own connection-string parser (see
 * db/connectionString.js), so every form the driver accepts is accepted here —
 * standalone, replica-set host lists, SRV, IPv6, Unix sockets — and nothing it
 * would reject gets through. The WHATWG URL parser is NOT used: it rejects the
 * comma-separated host list of a replica-set URI.
 *
 * The value is never echoed. A connection string carries the database
 * credentials in its userinfo, so it must never appear in an error message, a
 * log line or terminal output (Doc 13): a failure is reported with the
 * variable name and the fixed MONGODB_URI_INVALID rule only.
 */
const mongodbUri = z.string().superRefine((value, ctx) => {
  if (!parseMongoUri(value).valid) {
    ctx.addIssue({ code: 'custom', message: 'MONGODB_URI_INVALID' });
  }
});

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['local', 'review', 'production']).default('local'),
  PORT: port.default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: trustProxy,

  // Rate limiting — Doc 13. Configuration-driven so a deployment can tighten
  // it without a code change.
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3_600_000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(120),

  // Optional: absent in local, where a default allowlist is supplied below.
  CORS_ALLOWED_ORIGINS: originList.optional(),

  /*
   * Database connection string — Milestone B2.
   *
   * Optional in the SCHEMA so the shape check produces the value-free
   * MONGODB_URI_INVALID message when it is malformed; its presence is then
   * required below, which keeps "missing" and "malformed" as distinct,
   * separately-worded failures.
   */
  MONGODB_URI: mongodbUri.optional(),

  /*
   * How long to wait for the database at startup before failing. Bounded so a
   * misconfigured or unreachable host produces a prompt, classified failure
   * rather than a process that hangs and never reports.
   */
  MONGODB_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(10_000),
});


/**
 * Safe, value-free descriptions of every configuration rule.
 *
 * Every string a configuration failure can produce comes from this table. None
 * of them interpolates anything from the environment, so a rejected value —
 * which may be a credential, a token or a connection string — cannot reach an
 * error message, a terminal or a hosting log.
 */
const RULE_TEXT = {
  NODE_ENV: 'must be one of: development, test, production',
  APP_ENV: 'must be one of: local, review, production',
  PORT: 'must be an integer between 1 and 65535',
  LOG_LEVEL: 'must be one of: fatal, error, warn, info, debug, trace, silent',
  TRUST_PROXY: 'must be "false" or the number of trusted proxy hops (1-10)',
  TRUST_PROXY_INVALID: 'must be "false" or the number of trusted proxy hops (1-10)',
  RATE_LIMIT_WINDOW_MS: 'must be an integer between 1000 and 3600000 (milliseconds)',
  RATE_LIMIT_MAX: 'must be an integer between 1 and 100000',
  CORS_ALLOWED_ORIGINS:
    'must be a comma-separated list of canonical origins, each scheme://host[:port] ' +
    'with no userinfo, path, query, fragment or trailing slash',
  CORS_WILDCARD:
    'must not contain "*" — an allowlist is explicit by definition, and a wildcard ' +
    'would expose the API to every site',
  CORS_INVALID_ORIGIN:
    'contains a value that is not a canonical origin; each entry must be ' +
    'scheme://host[:port] with no userinfo, path, query, fragment or trailing slash',
  MONGODB_URI:
    'must be a valid MongoDB connection string (mongodb:// or mongodb+srv://; standalone, ' +
    'replica-set host list or SRV form) with no whitespace, and any database name must be ' +
    'a valid MongoDB database name',
  MONGODB_URI_INVALID:
    'must be a valid MongoDB connection string (mongodb:// or mongodb+srv://; standalone, ' +
    'replica-set host list or SRV form) with no whitespace, and any database name must be ' +
    'a valid MongoDB database name',
  MONGODB_CONNECT_TIMEOUT_MS: 'must be an integer between 1000 and 120000 (milliseconds)',
  MONGODB_URI_REQUIRED:
    'is required — the backend connects to MongoDB from Milestone B2 and will ' +
    'not start without it',
  CORS_REQUIRED_IN_PRODUCTION:
    'is required when APP_ENV=production; list the exact frontend origins allowed ' +
    'to call this API',
};

/** Maps one Zod issue to safe text, preferring our sentinel over Zod's wording. */
function safeRuleText(issue) {
  if (typeof issue.message === 'string' && RULE_TEXT[issue.message]) {
    return RULE_TEXT[issue.message];
  }
  const variable = String(issue.path[0] ?? '');
  return RULE_TEXT[variable] ?? 'is invalid';
}

/**
 * A configuration failure.
 *
 * Its message is constructed entirely from RULE_TEXT, so it is safe to print
 * to stderr at startup. `issues` carries the variable names and the same safe
 * rule text — never a value.
 */
export class ConfigurationError extends Error {
  constructor(issues) {
    const details = issues.map(({ variable, rule }) => `  - ${variable}: ${rule}`).join('\n');
    super(`Invalid backend configuration:\n${details}`);
    this.name = 'ConfigurationError';
    this.issues = issues;
  }
}

/** Marker written in place of the connection string whenever config is serialised. */
export const REDACTED = '[redacted]';

/**
 * A copy of the configuration that is safe to serialise: the connection string
 * is replaced and the guard functions are dropped.
 */
function redactedConfigView() {
  const view = {};
  for (const [key, value] of Object.entries(this)) {
    if (typeof value === 'function') continue;
    view[key] = key === 'mongodbUri' && value ? REDACTED : value;
  }
  return view;
}

/** Vite dev server and `vite preview`, the only local frontend origins. */
export const LOCAL_DEFAULT_ORIGINS = ['http://localhost:5173', 'http://localhost:4173'];

/**
 * Validates an environment object and returns the typed configuration.
 *
 * Pure: the environment is passed in, so configuration failure is directly
 * testable without mutating process.env.
 *
 * @throws {Error} with a readable, secret-free summary of every problem.
 */
export function loadConfig(env = process.env) {
  const parsed = baseSchema.safeParse(env);

  if (!parsed.success) {
    /*
     * The message is assembled ONLY from the tables above, keyed by variable
     * name and sentinel. Zod's own issue text is never used, because several
     * of its messages quote the received value — and the received value here
     * is an environment variable, which may be a connection string, a token or
     * an origin containing userinfo credentials.
     */
    throw new ConfigurationError(
      parsed.error.issues.map((issue) => ({
        variable: String(issue.path[0] ?? 'configuration'),
        rule: safeRuleText(issue),
      })),
    );
  }

  const config = parsed.data;
  const isProduction = config.APP_ENV === 'production';

  /*
   * Production must name its allowed origins explicitly. Falling back to a
   * localhost default in production would either break the real frontend or,
   * worse, look like it worked while allowing nothing.
   */
  const missing = [];
  if (isProduction && (!config.CORS_ALLOWED_ORIGINS || config.CORS_ALLOWED_ORIGINS.length === 0)) {
    missing.push({ variable: 'CORS_ALLOWED_ORIGINS', rule: RULE_TEXT.CORS_REQUIRED_IN_PRODUCTION });
  }

  /*
   * B2 makes the database a hard startup requirement in every environment.
   * There is no in-memory fallback: silently starting without a database would
   * let the service accept traffic it cannot serve.
   */
  if (!config.MONGODB_URI) {
    missing.push({ variable: 'MONGODB_URI', rule: RULE_TEXT.MONGODB_URI_REQUIRED });
  }

  // Every missing requirement is reported at once, so an operator fixes the
  // environment in one pass rather than one restart per variable.
  if (missing.length > 0) {
    throw new ConfigurationError(missing);
  }

  const corsAllowedOrigins = config.CORS_ALLOWED_ORIGINS ?? (isProduction ? [] : LOCAL_DEFAULT_ORIGINS);

  return Object.freeze({
    /*
     * Serialisation guards. The object carries the database connection string,
     * which includes credentials. Nothing logs the whole config today, but if a
     * future change ever passes it to a logger, JSON.stringify or console.log,
     * the URI is replaced rather than written. Both are own enumerable
     * properties, so they survive the spread that tests use to override values.
     */
    toJSON: redactedConfigView,
    [Symbol.for('nodejs.util.inspect.custom')]: redactedConfigView,

    nodeEnv: config.NODE_ENV,
    appEnv: config.APP_ENV,
    isProduction,
    port: config.PORT,
    logLevel: config.LOG_LEVEL,
    trustProxy: config.TRUST_PROXY,
    corsAllowedOrigins: Object.freeze(corsAllowedOrigins),
    /*
     * The URI is carried in the config object because the connection code
     * needs it. It is never logged, never included in an error and never
     * serialised — see lib/safeError.js and db/mongoose.js.
     */
    mongodbUri: config.MONGODB_URI,
    databaseConnectTimeoutMs: config.MONGODB_CONNECT_TIMEOUT_MS,
    rateLimit: Object.freeze({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      max: config.RATE_LIMIT_MAX,
    }),
    // General JSON body limit — Doc 09. Fixed, not configurable: raising it is
    // a security decision, not a deployment knob.
    jsonBodyLimit: '100kb',
  });
}
