import mongoose from 'mongoose';

/**
 * MongoDB connection-string inspection — used by runtime configuration and by
 * the test-database safety guard, so both accept exactly the same URIs.
 *
 * WHY NOT the WHATWG URL parser. A MongoDB connection string is not a URL:
 * `mongodb://db1:27017,db2:27017/valida?replicaSet=rs0` (a replica set) has a
 * comma-separated host list, which `new URL()` rejects. The authority on what
 * the backend can connect to is the installed MongoDB driver, so validation is
 * delegated to its own parser — the MongoClient constructor parses and
 * validates the string (scheme, host list, SRV rules, escaping, options)
 * WITHOUT opening a connection or performing a DNS lookup.
 *
 * NOTHING FROM THE STRING IS EVER RETURNED IN AN ERROR. Driver parse errors
 * quote hosts and sometimes credentials, so this module reports only
 * `valid: false`; callers attach their own value-free wording.
 *
 * (B1's CORS origins are real URLs and keep their strict WHATWG validation.)
 */

/** MongoDB database names must be shorter than 64 bytes. */
const MAX_DATABASE_NAME_BYTES = 63;

/**
 * Characters MongoDB forbids in database names. This is the Windows set, which
 * is a superset of the Unix one, so a name accepted here is valid on both.
 */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_DATABASE_NAME_CHARACTERS = /[/\\. "$*<>:|?\u0000]/;

/**
 * @returns {{ valid: false } | {
 *   valid: true,
 *   databaseName: string | null,   // the database named in the path, or null if none
 *   isSrv: boolean,
 *   hostCount: number,
 * }}
 */
export function parseMongoUri(uri) {
  if (typeof uri !== 'string' || uri.length === 0 || /\s/.test(uri)) return { valid: false };

  let options;
  try {
    options = new mongoose.mongo.MongoClient(uri).options;
  } catch {
    return { valid: false };
  }

  /*
   * The driver reports a database name even when the string names none (it
   * falls back to "test"), so the EXPLICIT name is read from the path. The
   * driver has already rejected unescaped reserved characters in the userinfo,
   * so the first "/" before any "?" is the start of the path.
   */
  const beforeQuery = uri.slice(uri.indexOf('://') + 3).split('?')[0];
  const slash = beforeQuery.indexOf('/');
  let databaseName = null;
  if (slash !== -1 && slash < beforeQuery.length - 1) {
    try {
      databaseName = decodeURIComponent(beforeQuery.slice(slash + 1));
    } catch {
      return { valid: false };
    }
    // Cross-check with the driver, and apply MongoDB's own naming rules.
    if (
      databaseName !== options.dbName ||
      FORBIDDEN_DATABASE_NAME_CHARACTERS.test(databaseName) ||
      Buffer.byteLength(databaseName, 'utf8') > MAX_DATABASE_NAME_BYTES
    ) {
      return { valid: false };
    }
  }

  return {
    valid: true,
    databaseName,
    isSrv: Boolean(options.srvHost),
    hostCount: options.srvHost ? 1 : options.hosts.length,
  };
}
