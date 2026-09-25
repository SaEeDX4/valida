/**
 * Safe error summarisation for logs — Doc 13.
 *
 * THE RULE: nothing derived from a thrown value's own text reaches a log.
 * Not `message`, not `stack`, not `cause` — and not `name` or `code` either.
 *
 * Those properties routinely carry what must never be recorded. A driver
 * failure embeds the whole connection string, credentials included; a JSON
 * parse failure quotes the offending fragment of the request body, which on
 * this API is candidate data; a stack exposes absolute filesystem paths.
 *
 * WHY name AND code ARE ALSO UNTRUSTED
 * Both are ordinary writable string properties. Any library — or anything that
 * can influence what a library throws — may set them to arbitrary text:
 *
 *   error.name = 'mongodb+srv://admin:s3cr3t@cluster0.example.net'
 *   error.code = 'AKIAEXAMPLE'
 *
 * A shape-matching regex cannot tell a genuine Node system code from a
 * credential that happens to look like one, so pattern-matching is not used.
 *
 * Instead every value this module emits comes from a FIXED TABLE in this file.
 * The type is decided by `instanceof` against the built-in error classes, and
 * the code must be an exact member of a short allowlist of Node conditions B1
 * can actually encounter. Anything unrecognised is reported as the generic
 * 'Error' with no code. A hostile value cannot pass through, because no value
 * from the error object is ever copied into the output.
 *
 * Pino's path-based redaction is not a substitute: it censors known FIELDS,
 * and cannot see a secret sitting inside free text.
 *
 * Correlation is preserved through the requestId, which appears both here and
 * in the client's response — that is how a reported failure is traced without
 * the raw detail being logged at all.
 */

/**
 * Built-in error classes, most specific first.
 *
 * instanceof, not `name`: the class identity is determined by the runtime and
 * cannot be forged by assigning to a property. A custom subclass falls through
 * to its nearest built-in ancestor, which for almost all of them is Error.
 */
const ERROR_TYPES = [
  [TypeError, 'TypeError'],
  [RangeError, 'RangeError'],
  [SyntaxError, 'SyntaxError'],
  [ReferenceError, 'ReferenceError'],
  [EvalError, 'EvalError'],
  [URIError, 'URIError'],
  [AggregateError, 'AggregateError'],
];

/**
 * Node condition codes B1 genuinely needs for operations.
 *
 * Deliberately short and justified rather than "any uppercase string":
 *   EADDRINUSE / EACCES / EADDRNOTAVAIL — the socket bind failures server.js
 *     can hit at startup, and the ones an operator must be able to diagnose;
 *   ECONNRESET / EPIPE — a client disconnecting mid-response.
 *
 * B1 opens no outbound connections, so outbound codes are not listed. Each
 * entry is matched by exact equality against this table; the error's own
 * string is never copied out.
 */
const SAFE_CODES = new Set(['EADDRINUSE', 'EACCES', 'EADDRNOTAVAIL', 'ECONNRESET', 'EPIPE']);

/**
 * Reduces any thrown value to metadata that is safe to log.
 *
 * Deliberately omits message, stack, cause, and every other own property.
 *
 * @returns {{type: string, code?: string}} values drawn only from the fixed
 *   tables above.
 */
export function safeErrorSummary(error) {
  if (error === null || error === undefined) {
    return { type: 'unknown' };
  }

  if (!(error instanceof Error)) {
    // A non-Error throw. Record only the JavaScript typeof — never the value,
    // which could be a string containing anything, including a request body.
    return { type: `non-error:${typeof error}` };
  }

  const match = ERROR_TYPES.find(([ErrorClass]) => error instanceof ErrorClass);
  const summary = { type: match ? match[1] : 'Error' };

  /*
   * Exact membership only. `SAFE_CODES.has(...)` returns a boolean; the string
   * written to the log is then taken from the allowlist itself, so even an
   * exotic String object or a property with a matching valueOf cannot inject
   * text.
   */
  if (typeof error.code === 'string' && SAFE_CODES.has(error.code)) {
    summary.code = [...SAFE_CODES].find((code) => code === error.code);
  }

  return summary;
}
