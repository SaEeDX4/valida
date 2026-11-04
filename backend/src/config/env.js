import fs from 'node:fs';
import net from 'node:net';
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
 * see the private storage section below); B5 added the Apply rate limit
 * (APPLICATION_RATE_LIMIT_WINDOW_MS, APPLICATION_RATE_LIMIT_MAX) and the bound
 * on the notification step (NOTIFICATION_TIMEOUT_MS). B6 adds transactional
 * email (Doc 14 section 180): TRANSACTIONAL_EMAIL_PROVIDER ("none" by default;
 * r4: "smtp" for the selected provider, Bluehost Professional Email / Titan,
 * with the SMTP_* settings), the sending identity and recipients, the
 * acknowledgement switch, the development recipient allowlist and the retry
 * policy — see the transactional email section below. PUBLIC_SITE_URL (Release C) is recorded
 * in .env.example as a future variable but is deliberately NOT read here:
 * requiring a variable nothing uses would imply the capability exists.
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

/*
 * Transactional email — Milestone B6 (Doc 14 sections 93-114, 180-186).
 *
 * One plain address, nothing else: no display name, no comment, no list, no
 * whitespace or line break (Doc 14 section 144: no header injection through
 * configuration either). Deliberately narrower than RFC 5322.
 */
export const PLAIN_EMAIL_ADDRESS =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const DOMAIN_NAME = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const emailAddress = (sentinel) =>
  emptyAsUnset(
    z
      .string()
      .refine((value) => value.length <= 254 && PLAIN_EMAIL_ADDRESS.test(value), { message: sentinel })
      .transform((value) => value.toLowerCase())
      .optional(),
  );
/**
 * Display name: printable text only — no quotes, angle brackets, backslash,
 * address-list punctuation (, ; : @), C0/C1 control, zero-width, line /
 * paragraph separator or bidirectional formatting characters — so it can be
 * placed in a From header verbatim.
 */
// eslint-disable-next-line no-control-regex
const DISPLAY_NAME = /^[^"<>\\,;:@\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]{1,64}$/;
/** "a@x.test,@example.test" -> exact addresses and whole domains (written with a leading @). */
const recipientAllowlist = emptyAsUnset(
  z
    .string()
    .transform((value) => value.split(',').map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0))
    .refine(
      (entries) =>
        entries.length > 0 &&
        entries.length <= 50 &&
        entries.every((entry) => (entry.startsWith('@') ? DOMAIN_NAME.test(entry.slice(1)) : entry.length <= 254 && PLAIN_EMAIL_ADDRESS.test(entry))),
      { message: 'EMAIL_RECIPIENT_ALLOWLIST_INVALID' },
    )
    .optional(),
);
const booleanFlag = emptyAsUnset(
  z
    .enum(['true', 'false'], { message: 'BOOLEAN_FLAG' })
    .transform((value) => value === 'true')
    .optional(),
);

/**
 * Providers this build can actually talk to. r4: the owner selected Bluehost
 * Professional Email (powered by Titan), whose only programmatic interface is
 * authenticated SMTP submission — "smtp" (integrations/notifications/smtpTransport.js).
 */
export const TRANSACTIONAL_EMAIL_PROVIDERS = Object.freeze(['none', 'smtp']);

/*
 * SMTP submission settings — r4 (Doc 14 sections 109-111, 131, 152-153, 179).
 *
 *   SMTP_HOST      the relay's DNS name (never an IP literal: the certificate
 *                  is verified against the name). Titan: smtp.titan.email.
 *   SMTP_SECURITY  implicit-tls (default; port 465) | starttls (port 587, with
 *                  STARTTLS REQUIRED). There is no plaintext mode.
 *   SMTP_PORT      default 465 for implicit-tls, 587 for starttls.
 *   SMTP_USERNAME  the sending mailbox; TRANSACTIONAL_FROM_ADDRESS must equal it.
 *   SMTP_PASSWORD  a SECRET (with Titan 2FA: an app password). Only its
 *                  presence and shape are checked; it is never echoed,
 *                  logged or serialised.
 */
const SMTP_HOSTNAME = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const smtpHost = emptyAsUnset(
  z
    .string()
    .refine((value) => SMTP_HOSTNAME.test(value) && net.isIP(value) === 0, { message: 'SMTP_HOST' })
    .transform((value) => value.toLowerCase())
    .optional(),
);
// eslint-disable-next-line no-control-regex
const smtpPassword = emptyAsUnset(z.string().max(512).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), { message: 'SMTP_PASSWORD' }).optional());
const SMTP_VARIABLES = Object.freeze({
  smtpHost: 'SMTP_HOST',
  smtpPort: 'SMTP_PORT',
  smtpSecurity: 'SMTP_SECURITY',
  smtpUsername: 'SMTP_USERNAME',
  smtpPasswordSet: 'SMTP_PASSWORD',
});

/**
 * The transactional-email rules that depend on more than one variable — B6.
 * Pure, and exported so every branch is tested, including the ones only a
 * future provider value can reach. Returns [{ variable, rule }] with RULE_TEXT
 * keys only (never a value).
 *
 *   - An API key without a provider is a misconfiguration (it would be ignored).
 *   - Candidate acknowledgement (Doc 09 section 130; Doc 14 sections 98-101,
 *     113) needs an operational identity: a real provider, a From address and
 *     the careers Reply-To. Otherwise it stays NOT_REQUIRED.
 *   - A real provider needs its credentials, a From address and the
 *     recruitment recipient (Doc 09 section 129; Doc 14 section 181:
 *     configuration, never source). An API provider authenticates with its
 *     key; "smtp" (r4) with SMTP_HOST / SMTP_USERNAME / SMTP_PASSWORD, uses no
 *     API key, and sends only as the authenticated mailbox (From must equal
 *     SMTP_USERNAME). SMTP settings without the smtp provider are refused.
 *   - Outside production a real provider may only reach allowlisted test
 *     recipients (Doc 14 sections 182-183; Doc 15 section 39). In production
 *     an allowlist is refused: it would silently drop real candidates' mail
 *     (Doc 14 section 184: refuse clearly unsafe test configuration).
 */
export function checkNotificationSettings(settings, { isProduction }) {
  const problems = [];
  const realProvider = settings.provider !== 'none';
  const smtpProvider = settings.provider === 'smtp';
  if (!realProvider && settings.apiKey) {
    problems.push({ variable: 'TRANSACTIONAL_EMAIL_API_KEY', rule: 'TRANSACTIONAL_EMAIL_API_KEY_WITHOUT_PROVIDER' });
  }
  // r4 — SMTP settings belong to the smtp provider only: a password lying
  // around in a configuration that does not use it is refused, not ignored.
  if (!smtpProvider) {
    for (const [key, variable] of Object.entries(SMTP_VARIABLES)) {
      if (settings[key]) problems.push({ variable, rule: 'SMTP_SETTING_WITHOUT_SMTP_PROVIDER' });
    }
  } else {
    if (settings.apiKey) problems.push({ variable: 'TRANSACTIONAL_EMAIL_API_KEY', rule: 'TRANSACTIONAL_EMAIL_API_KEY_NOT_USED_BY_SMTP' });
    if (!settings.smtpHost) problems.push({ variable: 'SMTP_HOST', rule: 'SMTP_REQUIRES_HOST' });
    if (!settings.smtpUsername) problems.push({ variable: 'SMTP_USERNAME', rule: 'SMTP_REQUIRES_USERNAME' });
    if (!settings.smtpPasswordSet) problems.push({ variable: 'SMTP_PASSWORD', rule: 'SMTP_REQUIRES_PASSWORD' });
    // The relay authenticates the mailbox; it is the only sender it can be trusted to accept.
    if (settings.smtpUsername && settings.fromAddress && settings.fromAddress.toLowerCase() !== settings.smtpUsername.toLowerCase()) {
      problems.push({ variable: 'TRANSACTIONAL_FROM_ADDRESS', rule: 'FROM_MUST_BE_SMTP_USERNAME' });
    }
    // 465 is implicit TLS and 587 is STARTTLS by convention; the opposite pairing is a typo that would only fail later.
    const security = settings.smtpSecurity ?? 'implicit-tls';
    if ((security === 'implicit-tls' && settings.smtpPort === 587) || (security === 'starttls' && settings.smtpPort === 465)) {
      problems.push({ variable: 'SMTP_PORT', rule: 'SMTP_PORT_SECURITY_MISMATCH' });
    }
  }
  if (settings.acknowledgementEnabled) {
    if (!realProvider) {
      problems.push({ variable: 'APPLICATION_ACKNOWLEDGEMENT_ENABLED', rule: 'ACKNOWLEDGEMENT_REQUIRES_PROVIDER' });
    }
    if (!settings.replyTo) {
      problems.push({ variable: 'TRANSACTIONAL_REPLY_TO', rule: 'ACKNOWLEDGEMENT_REQUIRES_REPLY_TO' });
    }
    if (!settings.fromAddress) {
      problems.push({ variable: 'TRANSACTIONAL_FROM_ADDRESS', rule: 'ACKNOWLEDGEMENT_REQUIRES_FROM' });
    }
    // B7 — gate G-SUP (Doc 14 section 120; OD-2026-10-26-01 D2a; OD-2026-11-02-03
    // item 5): production candidate acknowledgements stay disabled until the
    // recipient-suppression check exists and has passed its acceptance tests.
    // There is no suppression check in this build, so production refuses the
    // switch outright (fail closed, Doc 13 section 235). This is the minimal
    // form of the design's start-up refusal (RECIPIENT_SUPPRESSION_DESIGN.md
    // section 3.2); it chooses none of that design's PROPOSED details.
    if (isProduction) {
      problems.push({ variable: 'APPLICATION_ACKNOWLEDGEMENT_ENABLED', rule: 'ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP' });
    }
  }
  if (realProvider) {
    // An API provider authenticates with its key; SMTP with SMTP_USERNAME / SMTP_PASSWORD (above).
    if (!smtpProvider && !settings.apiKey) problems.push({ variable: 'TRANSACTIONAL_EMAIL_API_KEY', rule: 'PROVIDER_REQUIRES_API_KEY' });
    if (!settings.fromAddress && !settings.acknowledgementEnabled) {
      problems.push({ variable: 'TRANSACTIONAL_FROM_ADDRESS', rule: 'PROVIDER_REQUIRES_FROM' });
    }
    if (!settings.internalRecipient) {
      problems.push({ variable: 'RECRUITMENT_NOTIFICATION_RECIPIENT', rule: 'PROVIDER_REQUIRES_RECIPIENT' });
    }
    if (!isProduction && !settings.recipientAllowlist) {
      problems.push({ variable: 'EMAIL_RECIPIENT_ALLOWLIST', rule: 'ALLOWLIST_REQUIRED_OUTSIDE_PRODUCTION' });
    }
  }
  if (isProduction && settings.recipientAllowlist) {
    problems.push({ variable: 'EMAIL_RECIPIENT_ALLOWLIST', rule: 'ALLOWLIST_REFUSED_IN_PRODUCTION' });
  }
  // The required internal notification must be able to pass the allowlist.
  if (!isProduction && settings.recipientAllowlist && settings.internalRecipient) {
    const recipient = settings.internalRecipient.toLowerCase();
    const domain = recipient.slice(recipient.lastIndexOf('@'));
    if (!settings.recipientAllowlist.some((entry) => entry === recipient || entry === domain)) {
      problems.push({ variable: 'RECRUITMENT_NOTIFICATION_RECIPIENT', rule: 'INTERNAL_RECIPIENT_NOT_ALLOWLISTED' });
    }
  }
  return problems;
}

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

  /*
   * Apply rate limit — Milestone B5, Doc 09 section 34: "10 Application
   * submission attempts per 15 minutes per effective client IP", a
   * configuration-driven starting policy to be reviewed once real traffic
   * exists. Stricter than the general limit (BE-045) and counted separately.
   */
  APPLICATION_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(86_400_000).default(900_000),
  APPLICATION_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100_000).default(10),

  /*
   * Upper bound on the notification step of one Application — Milestone B5,
   * Doc 09 section 136: a notification provider that hangs must not hold the
   * API request open. The accepted Application is answered when the bound
   * expires; the notification is then recorded as FAILED (TIMEOUT).
   */
  // Default 5000; r4: 10000 (and at least 10000) with TRANSACTIONAL_EMAIL_PROVIDER=smtp — see below.
  NOTIFICATION_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).optional(),

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

  // Transactional email — B6. See the section above.
  TRANSACTIONAL_EMAIL_PROVIDER: emptyAsUnset(z.enum(TRANSACTIONAL_EMAIL_PROVIDERS).optional()),
  // A secret: only its presence is checked; it is never echoed, logged or serialised.
  TRANSACTIONAL_EMAIL_API_KEY: emptyAsUnset(z.string().max(512).optional()),
  TRANSACTIONAL_FROM_ADDRESS: emailAddress('TRANSACTIONAL_FROM_ADDRESS'),
  TRANSACTIONAL_FROM_NAME: emptyAsUnset(z.string().regex(DISPLAY_NAME, { message: 'TRANSACTIONAL_FROM_NAME' }).optional()),
  TRANSACTIONAL_REPLY_TO: emailAddress('TRANSACTIONAL_REPLY_TO'),
  RECRUITMENT_NOTIFICATION_RECIPIENT: emailAddress('RECRUITMENT_NOTIFICATION_RECIPIENT'),
  APPLICATION_ACKNOWLEDGEMENT_ENABLED: booleanFlag,
  EMAIL_RECIPIENT_ALLOWLIST: recipientAllowlist,
  // r4 — SMTP submission (TRANSACTIONAL_EMAIL_PROVIDER=smtp). See the section above.
  SMTP_HOST: smtpHost,
  SMTP_PORT: emptyAsUnset(port.optional()),
  SMTP_SECURITY: emptyAsUnset(z.enum(['implicit-tls', 'starttls']).optional()),
  SMTP_USERNAME: emailAddress('SMTP_USERNAME'),
  // A secret: only presence and shape are checked; never echoed, logged or serialised.
  SMTP_PASSWORD: smtpPassword,
  NOTIFICATION_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  NOTIFICATION_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(60_000),
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
  APPLICATION_RATE_LIMIT_WINDOW_MS: 'must be an integer between 1000 and 86400000 (milliseconds)',
  APPLICATION_RATE_LIMIT_MAX: 'must be an integer between 1 and 100000',
  NOTIFICATION_TIMEOUT_MS: 'must be an integer between 100 and 60000 (milliseconds)',
  TRANSACTIONAL_EMAIL_PROVIDER:
    'must be "none", "smtp" or left unset — "smtp" is the integration for the selected provider ' +
    '(Bluehost Professional Email, powered by Titan)',
  SMTP_HOST: 'must be the SMTP relay\'s DNS host name (not an IP address), e.g. smtp.titan.email',
  SMTP_PORT: 'must be an integer between 1 and 65535',
  SMTP_SECURITY: 'must be "implicit-tls" (port 465) or "starttls" (port 587); there is no plaintext mode',
  SMTP_USERNAME: 'must be one plain email address — the sending mailbox',
  SMTP_PASSWORD: 'must be at most 512 characters without control characters (the value is never shown)',
  SMTP_SETTING_WITHOUT_SMTP_PROVIDER:
    'is set but TRANSACTIONAL_EMAIL_PROVIDER is not "smtp"; remove it, or set the provider it belongs to',
  TRANSACTIONAL_EMAIL_API_KEY_NOT_USED_BY_SMTP:
    'is set but the smtp provider authenticates with SMTP_USERNAME / SMTP_PASSWORD; remove it',
  SMTP_REQUIRES_HOST: 'is required when TRANSACTIONAL_EMAIL_PROVIDER=smtp',
  SMTP_REQUIRES_USERNAME: 'is required when TRANSACTIONAL_EMAIL_PROVIDER=smtp',
  SMTP_REQUIRES_PASSWORD: 'is required when TRANSACTIONAL_EMAIL_PROVIDER=smtp (with Titan 2FA: an app password)',
  FROM_MUST_BE_SMTP_USERNAME:
    'must be the same mailbox as SMTP_USERNAME — the relay authenticates that mailbox, and it is the only sender used',
  SMTP_TIMEOUT_TOO_SHORT:
    'must be at least 10000 (milliseconds) when TRANSACTIONAL_EMAIL_PROVIDER=smtp — one SMTP session ' +
    '(connect, TLS, login, envelope, message, the relay\'s final reply) must fit in it; a shorter bound ' +
    'turns slow but successful submissions into OUTCOME_UNKNOWN',
  SMTP_PORT_SECURITY_MISMATCH:
    'does not match SMTP_SECURITY: port 587 is STARTTLS (SMTP_SECURITY=starttls) and port 465 is implicit TLS (implicit-tls)',
  TRANSACTIONAL_EMAIL_API_KEY: 'must be at most 512 characters',
  TRANSACTIONAL_EMAIL_API_KEY_WITHOUT_PROVIDER:
    'is set but TRANSACTIONAL_EMAIL_PROVIDER is "none"; remove it, or configure the provider it belongs to',
  TRANSACTIONAL_FROM_ADDRESS: 'must be one plain email address (no display name, list or whitespace)',
  TRANSACTIONAL_FROM_NAME:
    'must be 1-64 printable characters without quotes, angle brackets, backslashes, , ; : @, ' +
    'control or bidirectional formatting characters',
  TRANSACTIONAL_REPLY_TO: 'must be one plain email address (no display name, list or whitespace)',
  RECRUITMENT_NOTIFICATION_RECIPIENT: 'must be one plain email address (no display name, list or whitespace)',
  APPLICATION_ACKNOWLEDGEMENT_ENABLED: 'must be "true" or "false"',
  BOOLEAN_FLAG: 'must be "true" or "false"',
  EMAIL_RECIPIENT_ALLOWLIST: 'must be a comma-separated list of 1-50 email addresses or @domains',
  EMAIL_RECIPIENT_ALLOWLIST_INVALID: 'must be a comma-separated list of 1-50 email addresses or @domains',
  NOTIFICATION_RETRY_MAX_ATTEMPTS: 'must be an integer between 1 and 20',
  NOTIFICATION_RETRY_BASE_DELAY_MS: 'must be an integer between 1000 and 86400000 (milliseconds)',
  ACKNOWLEDGEMENT_REQUIRES_PROVIDER:
    'is "true", but candidate acknowledgement needs an operational transactional email ' +
    'provider (TRANSACTIONAL_EMAIL_PROVIDER is "none")',
  ACKNOWLEDGEMENT_REQUIRES_REPLY_TO:
    'is required when APPLICATION_ACKNOWLEDGEMENT_ENABLED=true — candidates must be able to ' +
    'reply to the recruitment mailbox',
  ACKNOWLEDGEMENT_REQUIRES_FROM: 'is required when APPLICATION_ACKNOWLEDGEMENT_ENABLED=true',
  ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP:
    'must be "false" in production: candidate acknowledgements stay disabled until recipient ' +
    'suppression is implemented and accepted (gate G-SUP)',
  PROVIDER_REQUIRES_API_KEY: 'is required when a transactional email provider is configured',
  PROVIDER_REQUIRES_FROM: 'is required when a transactional email provider is configured',
  PROVIDER_REQUIRES_RECIPIENT:
    'is required when a transactional email provider is configured (the internal ' +
    'new-application notification goes there)',
  ALLOWLIST_REQUIRED_OUTSIDE_PRODUCTION:
    'is required outside production when a transactional email provider is configured, so ' +
    'development and review cannot email real candidates',
  INTERNAL_RECIPIENT_NOT_ALLOWLISTED:
    'is not covered by EMAIL_RECIPIENT_ALLOWLIST — the internal new-application notification ' +
    'could never be sent; add it (or its @domain) to the allowlist',
  ALLOWLIST_REFUSED_IN_PRODUCTION:
    'must not be set when APP_ENV=production — it would silently drop real candidates\' mail',
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
    // B6: the transactional email API key is a secret; r4: so is the SMTP password.
    if (key === 'notifications' && value) {
      const notifications = { ...value };
      if (notifications.apiKey) notifications.apiKey = REDACTED;
      if (notifications.smtp?.password) notifications.smtp = { ...notifications.smtp, password: REDACTED };
      view[key] = notifications;
    }
  }
  return view;
}

/**
 * r4 — gives a settings object NON-enumerable serialisation guards that
 * replace the named secret fields, so the object is safe to log or stringify
 * even on its own (not only through the whole config). Non-enumerable: a
 * spread or an equality check sees the plain fields only.
 */
function withRedactedSerialisation(object, secretKeys) {
  const view = function redactedView() {
    const copy = { ...this };
    for (const key of secretKeys) if (copy[key]) copy[key] = REDACTED;
    return copy;
  };
  Object.defineProperty(object, 'toJSON', { value: view, enumerable: false });
  Object.defineProperty(object, Symbol.for('nodejs.util.inspect.custom'), { value: view, enumerable: false });
  return object;
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

  // B6 — transactional email (see checkNotificationSettings).
  const notificationSettings = {
    provider: config.TRANSACTIONAL_EMAIL_PROVIDER ?? 'none',
    apiKey: config.TRANSACTIONAL_EMAIL_API_KEY ?? null,
    fromAddress: config.TRANSACTIONAL_FROM_ADDRESS ?? null,
    fromName: config.TRANSACTIONAL_FROM_NAME ?? 'Valida Careers',
    replyTo: config.TRANSACTIONAL_REPLY_TO ?? null,
    internalRecipient: config.RECRUITMENT_NOTIFICATION_RECIPIENT ?? null,
    acknowledgementEnabled: config.APPLICATION_ACKNOWLEDGEMENT_ENABLED ?? false,
    recipientAllowlist: config.EMAIL_RECIPIENT_ALLOWLIST ?? null,
  };
  // r4 — SMTP: presence only for the password (the rules never see the secret).
  const smtpSettings = {
    smtpHost: config.SMTP_HOST ?? null,
    smtpPort: config.SMTP_PORT ?? null,
    smtpSecurity: config.SMTP_SECURITY ?? null,
    smtpUsername: config.SMTP_USERNAME ?? null,
    smtpPasswordSet: Boolean(config.SMTP_PASSWORD),
  };
  for (const problem of checkNotificationSettings({ ...notificationSettings, ...smtpSettings }, { isProduction })) {
    missing.push({ variable: problem.variable, rule: RULE_TEXT[problem.rule] });
  }
  /*
   * r4 (review R5): one SMTP session — connect, TLS, greeting, login,
   * envelope, the message and the relay's final reply — must fit in the
   * notification bound. With SMTP the default is 10000 and anything shorter
   * is refused: a bound that expires while the relay is still answering
   * makes a successful submission OUTCOME_UNKNOWN (operator, duplicate risk).
   */
  const SMTP_MINIMUM_TIMEOUT_MS = 10_000;
  const notificationTimeoutMs = config.NOTIFICATION_TIMEOUT_MS ?? (notificationSettings.provider === 'smtp' ? SMTP_MINIMUM_TIMEOUT_MS : 5_000);
  if (notificationSettings.provider === 'smtp' && notificationTimeoutMs < SMTP_MINIMUM_TIMEOUT_MS) {
    missing.push({ variable: 'NOTIFICATION_TIMEOUT_MS', rule: RULE_TEXT.SMTP_TIMEOUT_TOO_SHORT });
  }
  const smtpSecurity = smtpSettings.smtpSecurity ?? 'implicit-tls';
  const smtp =
    notificationSettings.provider === 'smtp'
      ? Object.freeze(
          withRedactedSerialisation(
            {
              host: smtpSettings.smtpHost,
              port: smtpSettings.smtpPort ?? (smtpSecurity === 'starttls' ? 587 : 465),
              security: smtpSecurity,
              username: smtpSettings.smtpUsername,
              password: config.SMTP_PASSWORD,
            },
            ['password'],
          ),
        )
      : null;

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
    // B5 — Doc 09 section 34.
    applicationRateLimit: Object.freeze({
      windowMs: config.APPLICATION_RATE_LIMIT_WINDOW_MS,
      max: config.APPLICATION_RATE_LIMIT_MAX,
    }),
    // B5 — Doc 09 section 136.
    notificationTimeoutMs,
    /*
     * B6 — transactional email (Doc 14 sections 93-114, 180-186). The API key
     * is a secret: it is carried for the transport only and is replaced in
     * every serialised view of the configuration.
     */
    notifications: Object.freeze(
      withRedactedSerialisation(
        {
          ...notificationSettings,
          recipientAllowlist: notificationSettings.recipientAllowlist ? Object.freeze([...notificationSettings.recipientAllowlist]) : null,
          // r4: null unless TRANSACTIONAL_EMAIL_PROVIDER=smtp. The password is
          // carried for the transport only and redacted in every serialised view.
          smtp,
          retry: Object.freeze({
            maxAttempts: config.NOTIFICATION_RETRY_MAX_ATTEMPTS,
            baseDelayMs: config.NOTIFICATION_RETRY_BASE_DELAY_MS,
          }),
        },
        ['apiKey'],
      ),
    ),
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
