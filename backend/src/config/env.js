import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
 * MONGODB_CONNECT_TIMEOUT_MS; B3 added MONGODB_QUERY_TIMEOUT_MS (optional);
 * B4 added RESUME_STORAGE_DRIVER and RESUME_STORAGE_LOCAL_ROOT (optional —
 * see the private storage section below). Transactional email (B6) and
 * PUBLIC_SITE_URL (Release C) are recorded in .env.example as future
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

/*
 * ---------------------------------------------------------------------------
 * Private resume storage — Milestone B4 (Doc 09 sections 105-107, Doc 15
 * sections 38, 76-77, 97-103).
 *
 * RESUME_STORAGE_DRIVER selects the storage integration. B4 implements one:
 *
 *   local — the DEVELOPMENT-ONLY private adapter: resume bytes are written to
 *           RESUME_STORAGE_LOCAL_ROOT on this machine's disk. Accepted only
 *           when APP_ENV=local and NODE_ENV is not production. A review or
 *           production deployment that sets it is refused at startup (Doc 09
 *           section 107): a hosted instance's disk is ephemeral (Doc 15
 *           sections 76-77), so "stored" resumes would silently disappear.
 *
 * The production provider (managed private object storage, Doc 15 sections
 * 97-106) is selected at deployment, Milestone C6, and is AWAITING INPUT.
 * Until it exists, leaving the driver unset is the only valid production
 * setting: the service starts, serves the Jobs API, and reports resume
 * storage as not ready — so /health/ready stays 503 and no Application can be
 * accepted (Doc 15 section 221). It never pretends to store anything.
 *
 * An empty value (`RESUME_STORAGE_DRIVER=` copied from a template) is the
 * same as unset.
 * ---------------------------------------------------------------------------
 */
const emptyAsUnset = (schema) => z.preprocess((value) => (value === '' ? undefined : value), schema);

/**
 * The repository (application) directory: this file is
 * <root>/backend/src/config/env.js. The local storage root must lie outside
 * it — the Vite dev server can serve files from the repository, and a git
 * working tree is one `git add .` away from committing candidate resumes.
 */
export const APPLICATION_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Directory names that conventionally hold web-served files. A private
 * storage root must not sit inside one (Doc 09 section 105, Doc 13 sections
 * 68-69). Compared case-insensitively, so Windows' shared C:\Users\Public is
 * refused too.
 */
const PUBLIC_DIRECTORY_NAMES = new Set(['public', 'public_html', 'static', 'www', 'wwwroot', 'htdocs', 'dist']);

/**
 * Checks a local storage root. Returns null when acceptable, otherwise a
 * RULE_TEXT sentinel — never the value, which is a filesystem path.
 *
 * `pathApi` defaults to the platform's path module; tests pass path.win32 or
 * path.posix to check both platforms' rules from either platform.
 */
export function checkLocalStorageRoot(
  value,
  { pathApi = path, applicationRoot = APPLICATION_ROOT, caseInsensitive = process.platform === 'darwin' } = {},
) {
  if (typeof value !== 'string' || value.trim() === '') return 'RESUME_STORAGE_LOCAL_ROOT_REQUIRED';
  if (/[\u0000-\u001f]/.test(value)) return 'RESUME_STORAGE_LOCAL_ROOT_NOT_ABSOLUTE';

  if (pathApi === path.win32) {
    // A drive-letter or UNC path only. "\data" (current drive) and
    // "C:data" (drive-relative) depend on the process's working directory,
    // and a colon after the drive letter would name an NTFS alternate stream.
    const driveOrUnc = /^[A-Za-z]:[\\/]/.test(value) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+/.test(value);
    if (!driveOrUnc || value.indexOf(':', 2) !== -1) return 'RESUME_STORAGE_LOCAL_ROOT_NOT_ABSOLUTE';
  } else if (!pathApi.isAbsolute(value)) {
    return 'RESUME_STORAGE_LOCAL_ROOT_NOT_ABSOLUTE';
  }

  const resolved = pathApi.resolve(value);
  const { root } = pathApi.parse(resolved);
  const segments = resolved.slice(root.length).split(pathApi.sep).filter(Boolean);
  if (segments.length === 0) return 'RESUME_STORAGE_LOCAL_ROOT_FILESYSTEM_ROOT';
  if (segments.some((segment) => PUBLIC_DIRECTORY_NAMES.has(segment.toLowerCase()))) {
    return 'RESUME_STORAGE_LOCAL_ROOT_PUBLIC_DIRECTORY';
  }

  // path.win32.relative compares case-insensitively; path.posix exactly —
  // so on macOS, whose default file system ignores case, both sides are
  // lower-cased first ("/Users/me/Valida" is the same folder as ".../valida").
  const fold = pathApi !== path.win32 && caseInsensitive ? (value_) => value_.toLowerCase() : (value_) => value_;
  const application = pathApi.resolve(applicationRoot);
  const isWithin = (parent, child) => {
    const relative = pathApi.relative(fold(parent), fold(child));
    return relative === '' || (!relative.startsWith('..') && !pathApi.isAbsolute(relative));
  };
  if (isWithin(application, resolved) || isWithin(resolved, application)) {
    return 'RESUME_STORAGE_LOCAL_ROOT_INSIDE_APPLICATION';
  }
  return null;
}

/**
 * Where a path REALLY leads — B4 review r1, finding 2.
 *
 * The lexical rules above look at the path as written. A link anywhere in it
 * — a symbolic link on any platform, or a junction on Windows — can make an
 * innocent-looking path lead into a public directory or the repository
 * ("<alias>/private-resumes" where <alias> points at a folder named
 * "public"). So the longest EXISTING prefix of the path is resolved through
 * every link with the operating system's own resolver (fs.realpathSync.native:
 * realpath(3) on POSIX, GetFinalPathNameByHandle on Windows, which follows
 * junctions and symbolic links and expands 8.3 short names), and the part
 * that does not exist yet is appended. Returns null when the path cannot be
 * resolved safely: an existing component cannot be read, a link is broken
 * (a dangling link would be created THROUGH), or links loop.
 */
const isMissing = (error) => error?.code === 'ENOENT' || error?.code === 'ENOTDIR';

export function resolveStorageLocation(value, { realpath = fs.realpathSync.native, lstat = fs.lstatSync } = {}) {
  let current = path.resolve(value);
  const notYetCreated = [];
  for (;;) {
    try {
      return path.join(realpath(current), ...notYetCreated);
    } catch (error) {
      if (!isMissing(error)) return null;
    }
    // Missing — unless the name exists as a broken link. (A component that is
    // a file surfaces as ENOTDIR on POSIX and ENOENT on Windows; both walk up
    // to it, and creating the directory then fails at initialisation.)
    try {
      lstat(current);
      return null;
    } catch (error) {
      if (!isMissing(error)) return null;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    notYetCreated.unshift(path.basename(current));
    current = parent;
  }
}

/**
 * The storage-root rules applied to the RESOLVED location, compared with the
 * resolved application root as well as the written one. Returns null or a
 * RULE_TEXT sentinel. Used by loadConfig, and again by the local storage
 * adapter immediately before it creates anything (and after, on the real
 * directory it created), so a link cannot redirect it between the two.
 */
export function checkResolvedLocalStorageRoot(value, { applicationRoot = APPLICATION_ROOT, realpath, lstat } = {}) {
  const location = resolveStorageLocation(value, { realpath, lstat });
  if (location === null) return 'RESUME_STORAGE_LOCAL_ROOT_UNRESOLVED';
  const applications = [path.resolve(applicationRoot)];
  const realApplication = resolveStorageLocation(applicationRoot, { realpath, lstat });
  if (realApplication !== null) applications.push(realApplication);
  for (const application of applications) {
    const problem = checkLocalStorageRoot(location, { applicationRoot: application });
    if (problem) return problem;
  }
  return null;
}

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

  /*
   * Upper bound on one public read against MongoDB — Milestone B3.
   *
   * A request for Jobs must end in a bounded time even when the database is
   * slow or unresponsive, and must then fail with 503 rather than hang or
   * return an empty success (Doc 09 sections 57 and 70). Also sent to the
   * server as maxTimeMS. Exact value is deployment tuning (Doc 13 section 56).
   */
  MONGODB_QUERY_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(5_000),

  // Private resume storage — Milestone B4. See the section above.
  RESUME_STORAGE_DRIVER: emptyAsUnset(z.enum(['local']).optional()),
  // Only its presence is checked here; its rules are applied below, where the
  // failure can be reported without echoing the path.
  RESUME_STORAGE_LOCAL_ROOT: emptyAsUnset(z.string().optional()),
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
  MONGODB_QUERY_TIMEOUT_MS: 'must be an integer between 500 and 60000 (milliseconds)',
  MONGODB_URI_REQUIRED:
    'is required — the backend connects to MongoDB from Milestone B2 and will ' +
    'not start without it',
  CORS_REQUIRED_IN_PRODUCTION:
    'is required when APP_ENV=production; list the exact frontend origins allowed ' +
    'to call this API',
  RESUME_STORAGE_DRIVER:
    'must be "local" (development only) or left unset; the production private-storage ' +
    'provider is selected at deployment (Milestone C6)',
  RESUME_STORAGE_LOCAL_NOT_ALLOWED:
    'is "local", which is development-only and is refused unless APP_ENV=local and ' +
    'NODE_ENV is not production — a deployed instance must use real private object storage',
  RESUME_STORAGE_LOCAL_ROOT_REQUIRED: 'is required when RESUME_STORAGE_DRIVER=local',
  RESUME_STORAGE_LOCAL_ROOT_WITHOUT_DRIVER:
    'is set but RESUME_STORAGE_DRIVER is not "local"; set both, or neither',
  RESUME_STORAGE_LOCAL_ROOT_NOT_ABSOLUTE:
    'must be an absolute path (on Windows, with a drive letter such as C:\\ or a UNC share)',
  RESUME_STORAGE_LOCAL_ROOT_FILESYSTEM_ROOT: 'must be a dedicated directory, not a filesystem or drive root',
  RESUME_STORAGE_LOCAL_ROOT_PUBLIC_DIRECTORY:
    'must not be inside a public, static or web-served directory (public, public_html, ' +
    'static, www, wwwroot, htdocs, dist)',
  RESUME_STORAGE_LOCAL_ROOT_INSIDE_APPLICATION:
    'must be outside the Valida repository (and must not contain it), so resumes can ' +
    'never be served by a development server or committed to git',
  RESUME_STORAGE_LOCAL_ROOT_UNRESOLVED:
    'must resolve to a real location: every existing part of the path must be readable, ' +
    'and no link in it may be broken or circular (links are followed, and the rules above ' +
    'apply to where the path really leads)',
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
    // B4: the storage root is a filesystem path; it is kept out of any
    // accidental serialisation too.
    if (key === 'resumeStorage' && value?.localRoot) view[key] = { ...value, localRoot: REDACTED };
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

  /*
   * B4 — private resume storage. The development-only local driver is
   * refused in any deployed or production-mode process (Doc 09 section 107),
   * and its root must be a safe, dedicated, private location. Every failure is
   * a fixed sentinel: the path itself is never echoed.
   */
  const storageDriver = config.RESUME_STORAGE_DRIVER ?? null;
  const storageRoot = config.RESUME_STORAGE_LOCAL_ROOT ?? null;
  if (storageDriver === 'local') {
    if (config.APP_ENV !== 'local' || config.NODE_ENV === 'production') {
      missing.push({ variable: 'RESUME_STORAGE_DRIVER', rule: RULE_TEXT.RESUME_STORAGE_LOCAL_NOT_ALLOWED });
    }
    // The path as written, then — if that passes — where it really leads.
    const rootProblem = checkLocalStorageRoot(storageRoot) ?? checkResolvedLocalStorageRoot(storageRoot);
    if (rootProblem) {
      missing.push({ variable: 'RESUME_STORAGE_LOCAL_ROOT', rule: RULE_TEXT[rootProblem] });
    }
  } else if (storageRoot !== null) {
    missing.push({ variable: 'RESUME_STORAGE_LOCAL_ROOT', rule: RULE_TEXT.RESUME_STORAGE_LOCAL_ROOT_WITHOUT_DRIVER });
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
    databaseQueryTimeoutMs: config.MONGODB_QUERY_TIMEOUT_MS,
    rateLimit: Object.freeze({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      max: config.RATE_LIMIT_MAX,
    }),
    // General JSON body limit — Doc 09. Fixed, not configurable: raising it is
    // a security decision, not a deployment knob.
    jsonBodyLimit: '100kb',
    /*
     * B4 — private resume storage. `driver` is null when no storage is
     * configured (the only valid state for a deployed instance until the
     * production provider exists, C6). The root is resolved to its absolute
     * form. It is not a secret, but it is a filesystem path, so it is never
     * logged or sent in a response (Doc 09 section 22).
     */
    resumeStorage: Object.freeze({
      driver: storageDriver,
      localRoot: storageDriver === 'local' ? path.resolve(storageRoot) : null,
    }),
  });
}
