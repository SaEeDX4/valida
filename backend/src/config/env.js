import { z } from 'zod';

/**
 * Centralised environment configuration — 15_DEVOPS_DEPLOYMENT.md sections
 * 49-58, 09_BACKEND_API_SPEC.md section 11.
 *
 * One schema, validated once at startup. If required production configuration
 * is missing or malformed the process must fail to start rather than run in a
 * half-configured state (Doc 15 section 50).
 *
 * TRUTHFULNESS RULE
 * This schema knows only about configuration Milestone B1 actually consumes.
 * MONGODB_URI, resume storage and transactional email are recorded in
 * .env.example as future variables but are deliberately NOT required or read
 * here: requiring a variable nothing uses would imply the capability exists.
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
  if (isProduction && (!config.CORS_ALLOWED_ORIGINS || config.CORS_ALLOWED_ORIGINS.length === 0)) {
    throw new ConfigurationError([
      { variable: 'CORS_ALLOWED_ORIGINS', rule: RULE_TEXT.CORS_REQUIRED_IN_PRODUCTION },
    ]);
  }

  const corsAllowedOrigins = config.CORS_ALLOWED_ORIGINS ?? (isProduction ? [] : LOCAL_DEFAULT_ORIGINS);

  return Object.freeze({
    nodeEnv: config.NODE_ENV,
    appEnv: config.APP_ENV,
    isProduction,
    port: config.PORT,
    logLevel: config.LOG_LEVEL,
    trustProxy: config.TRUST_PROXY,
    corsAllowedOrigins: Object.freeze(corsAllowedOrigins),
    rateLimit: Object.freeze({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      max: config.RATE_LIMIT_MAX,
    }),
    // General JSON body limit — Doc 09. Fixed, not configurable: raising it is
    // a security decision, not a deployment knob.
    jsonBodyLimit: '100kb',
  });
}
