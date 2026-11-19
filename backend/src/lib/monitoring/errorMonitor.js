import http from 'node:http';
import https from 'node:https';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeErrorSummary } from '../safeError.js';

/**
 * C6-T6 — error monitoring for the API and the document server (D-4a:
 * Sentry; C6 plan r3 §4.5; Doc 13 §213: "Error monitoring must not
 * automatically ingest request bodies, passwords, resume data, candidate
 * PII"; Doc 17 §407).
 *
 * This module holds no package import: each service passes the Sentry SDK
 * from its OWN dependencies (`sdk`, see lib/monitoring/sentrySdk.js and
 * frontend/server/monitoringSdk.js), because on the host the document
 * server is installed from frontend/ alone.
 *
 * WHAT AN EVENT CAN CONTAIN — an allowlist, rebuilt, never a scrub
 *
 * The SDK is never given the thrown value to describe. The event is built
 * here from fixed tables, by the same rule as lib/safeError.js ("nothing
 * derived from a thrown value's own text reaches a log"), and then rebuilt
 * again in `beforeSend` from the same allowlist, so nothing the SDK or a
 * future integration adds can pass through:
 *
 *   exception type   the built-in class (instanceof), or `Error`
 *   exception value  fixed text: "Unexpected <type>" (plus a code from
 *                    safeError's short allowlist)
 *   stack frames     the file RELATIVE to the repository
 *                    (`app:///backend/src/...`), and only a file that exists
 *                    there; line, column, in_app. No function name, no
 *                    source line, no variable, no absolute path. Frames are
 *                    parsed only from the part
 *                    of `error.stack` that V8 wrote AFTER the error's own
 *                    first line, and only when that first line is exactly
 *                    `name: message` — so a message cannot forge a frame.
 *   tags             service, kind (fixed), status (a number), request_id
 *                    only when it is a UUID (the API's own form; a
 *                    client-supplied X-Request-ID of any other form is
 *                    dropped)
 *   release          the full commit SHA (RENDER_GIT_COMMIT), when set
 *   environment      APP_ENV
 *   server_name      the service's fixed name — never the host name
 *   contexts         runtime name and version only
 *
 * Never: the request (URL, query, headers, cookies, body), the user, the
 * error's message, cause, or own properties, breadcrumbs, `extra`, local
 * variables, environment variables, modules, traces. No integration is
 * installed (no request, console, HTTP or local-variable instrumentation),
 * `sendDefaultPii` is false, client reports are off and tracing is static.
 *
 * DELIVERY never changes an application outcome: capture is synchronous
 * and returns at once; the SDK's transport queues at most 64 events and
 * sends each with one bounded attempt. A failure is logged once when
 * delivery starts failing and once when it recovers — a fixed reason
 * (`unreachable`, `timeout`, `status`), never the DSN, host or response.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
/** The repository root: backend/src/lib/monitoring → ../../../.. */
export const REPOSITORY_ROOT = path.resolve(here, '..', '..', '..', '..');

export const MONITOR_KINDS = Object.freeze(['request', 'uncaught', 'operator_test']);
const LEVEL_FOR_KIND = Object.freeze({ request: 'error', uncaught: 'fatal', operator_test: 'info' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SAFE_TYPE = /^(?:[A-Za-z]{1,40}|non-error:[a-z]{1,12})$/;
const SAFE_CODE = /^[A-Z]{2,16}$/;
const SAFE_SDK = /^[A-Za-z0-9_.:/ -]{1,64}$/;
const SAFE_SERVICE = /^[a-z][a-z0-9-]{1,40}$/;
const SAFE_ENVIRONMENT = /^(?:local|review|production|test)$/;
const RELEASE = /^[0-9a-f]{40}$/;
const EVENT_ID = /^[0-9a-f]{32}$/;
const MAX_FRAMES = 50;
export const DEFAULT_DELIVERY_TIMEOUT_MS = 5_000;

/** The value used for an event's exception: fixed text from the classification. */
export function classifiedValue({ type, code }, kind) {
  if (kind === 'operator_test') return 'Operator test event (contains no application data)';
  return `Unexpected ${type}${code ? ` (${code})` : ''}`;
}

/** Repository-relative file name, `node:` built-in, or a fixed placeholder. */
const SAFE_RELATIVE = /^[A-Za-z0-9_.@/+-]{1,240}$/;
const existing = new Map();
/** Only a file that exists in the repository is named: a forged frame names none. */
function existsInRepository(root, posix) {
  const key = `${root}\u0000${posix}`;
  if (!existing.has(key)) {
    if (existing.size > 2_000) existing.clear();
    let found = false;
    try {
      found = statSync(path.join(root, ...posix.split('/'))).isFile();
    } catch {
      found = false;
    }
    existing.set(key, found);
  }
  return existing.get(key);
}

export function safeFilename(filename, root = REPOSITORY_ROOT) {
  if (typeof filename !== 'string' || filename === '') return '<unknown>';
  if (filename === '<outside>' || filename === '<unknown>') return filename;
  if (/^node:[a-z_/]{1,80}$/.test(filename)) return filename;
  if (filename.startsWith('app:///')) {
    const posix = filename.slice('app:///'.length);
    return SAFE_RELATIVE.test(posix) && !posix.split('/').includes('..') && existsInRepository(root, posix) ? filename : '<unknown>';
  }
  let file = filename;
  if (file.startsWith('file://')) {
    try {
      file = fileURLToPath(file);
    } catch {
      return '<unknown>';
    }
  }
  if (!path.isAbsolute(file)) return '<unknown>';
  const relative = path.relative(root, path.normalize(file));
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return '<outside>';
  const posix = relative.split(path.sep).join('/');
  return SAFE_RELATIVE.test(posix) && existsInRepository(root, posix) ? `app:///${posix}` : '<unknown>';
}

function safeFrame(frame, root) {
  if (!frame || typeof frame !== 'object') return null;
  // No function name: it is text from the stack, which a forged or
  // replaced stack controls. File (existing, repository-relative), line and
  // column locate the code without carrying any text.
  const out = { filename: safeFilename(frame.filename, root) };
  if (Number.isInteger(frame.lineno) && frame.lineno >= 0) out.lineno = frame.lineno;
  if (Number.isInteger(frame.colno) && frame.colno >= 0) out.colno = frame.colno;
  out.in_app = out.filename.startsWith('app:///') && !out.filename.includes('/node_modules/');
  return out;
}

/**
 * The stack frames V8 wrote, without the error's own first line(s). If the
 * stack does not begin exactly with `name: message` (the message, name or
 * stack was changed after construction), no frame is kept.
 */
export function framesFromError(error, stackParser, root = REPOSITORY_ROOT) {
  if (!(error instanceof Error) || typeof error.stack !== 'string' || typeof stackParser !== 'function') return [];
  let header;
  try {
    const name = error.name === undefined ? 'Error' : String(error.name);
    const message = error.message === undefined ? '' : String(error.message);
    header = message === '' ? name : name === '' ? message : `${name}: ${message}`;
  } catch {
    return [];
  }
  if (!error.stack.startsWith(header) || error.stack.charAt(header.length) !== '\n') return [];
  const body = error.stack.slice(header.length + 1);
  let parsed;
  try {
    parsed = stackParser(body);
  } catch {
    return [];
  }
  return parsed.slice(-MAX_FRAMES).map((frame) => safeFrame(frame, root)).filter(Boolean);
}

function safeTags(tags) {
  const out = {};
  if (typeof tags?.service === 'string' && SAFE_SERVICE.test(tags.service)) out.service = tags.service;
  if (MONITOR_KINDS.includes(tags?.kind)) out.kind = tags.kind;
  if (typeof tags?.status === 'string' && /^[1-5][0-9]{2}$/.test(tags.status)) out.status = tags.status;
  if (typeof tags?.request_id === 'string' && UUID.test(tags.request_id)) out.request_id = tags.request_id;
  return out;
}

function safeException(values, root) {
  if (!Array.isArray(values) || values.length === 0) return undefined;
  const [first] = values;
  const type = typeof first?.type === 'string' && SAFE_TYPE.test(first.type) ? first.type : 'Error';
  const known = /^Unexpected [A-Za-z:-]{1,52}(?: \([A-Z]{2,16}\))?$|^Operator test event \(contains no application data\)$/;
  const value = typeof first?.value === 'string' && known.test(first.value) ? first.value : `Unexpected ${type}`;
  const mechanism = {
    type: typeof first?.mechanism?.type === 'string' && /^valida\.(?:request|uncaught|operator_test)$/.test(first.mechanism.type) ? first.mechanism.type : 'valida.request',
    handled: first?.mechanism?.handled !== false,
  };
  const out = { type, value, mechanism };
  const frames = first?.stacktrace?.frames;
  if (Array.isArray(frames) && frames.length > 0) {
    out.stacktrace = { frames: frames.slice(-MAX_FRAMES).map((frame) => safeFrame(frame, root)).filter(Boolean) };
  }
  return { values: [out] };
}

/**
 * The allowlist, applied to any event about to leave the process. Exported
 * so the rule itself is tested; used as the SDK's `beforeSend`.
 */
export function rebuildSafeEvent(event, root = REPOSITORY_ROOT) {
  if (!event || typeof event !== 'object') return null;
  const out = {};
  if (typeof event.event_id === 'string' && EVENT_ID.test(event.event_id)) out.event_id = event.event_id;
  if (typeof event.timestamp === 'number' && Number.isFinite(event.timestamp)) out.timestamp = event.timestamp;
  out.platform = 'node';
  out.level = ['error', 'fatal', 'info'].includes(event.level) ? event.level : 'error';
  if (typeof event.server_name === 'string' && SAFE_SERVICE.test(event.server_name)) out.server_name = event.server_name;
  if (typeof event.release === 'string' && RELEASE.test(event.release)) out.release = event.release;
  if (typeof event.environment === 'string' && SAFE_ENVIRONMENT.test(event.environment)) out.environment = event.environment;
  if (event.sdk && typeof event.sdk.name === 'string' && SAFE_SDK.test(event.sdk.name) && typeof event.sdk.version === 'string' && SAFE_SDK.test(event.sdk.version)) {
    out.sdk = { name: event.sdk.name, version: event.sdk.version };
  }
  out.tags = safeTags(event.tags);
  const exception = safeException(event.exception?.values, root);
  if (!exception) return null;
  out.exception = exception;
  const runtime = event.contexts?.runtime;
  if (runtime && runtime.name === 'node' && typeof runtime.version === 'string' && /^v\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(runtime.version)) {
    out.contexts = { runtime: { name: 'node', version: runtime.version } };
  }
  return out;
}

/** One bounded attempt per envelope; never follows redirects; no proxy. */
function deliveryRequest(url, headers, timeoutMs, report) {
  const target = new URL(url);
  const client = target.protocol === 'https:' ? https : http;
  return (request) =>
    new Promise((resolve, reject) => {
      let settled = false;
      const finish = (outcome, value) => {
        if (settled) return;
        settled = true;
        report(outcome);
        if (outcome.delivered) resolve(value);
        else if (value) resolve(value);
        else reject(new Error('delivery failed'));
      };
      const req = client.request(
        target,
        { method: 'POST', headers: { 'content-type': 'application/x-sentry-envelope', ...headers }, agent: false },
        (res) => {
          res.resume();
          res.on('error', () => {});
          const status = res.statusCode ?? 0;
          const value = { statusCode: status, headers: { 'retry-after': res.headers['retry-after'] ?? null, 'x-sentry-rate-limits': res.headers['x-sentry-rate-limits'] ?? null } };
          finish({ delivered: status >= 200 && status < 300, reason: 'status', status }, value);
        },
      );
      req.setTimeout(timeoutMs, () => {
        finish({ delivered: false, reason: 'timeout' });
        req.destroy();
      });
      req.on('error', () => finish({ delivered: false, reason: 'unreachable' }));
      req.end(request.body);
    });
}

const DISABLED = Object.freeze({
  state: 'disabled',
  captureUnexpected: () => null,
  flush: async () => true,
  close: async () => true,
  delivery: () => Object.freeze({ attempts: 0, delivered: 0, failed: 0, last: null }),
});

/** A monitor that does nothing, for code paths given none. */
export const DISABLED_ERROR_MONITOR = DISABLED;

/**
 * @param {object} options
 * @param {object} options.monitoring  config/errorMonitoring.js result
 * @param {object} options.release     config/releaseIdentity.js result
 * @param {string} options.environment APP_ENV
 * @param {string} options.service     'valida-api' or 'valida-documents'
 * @param {object} options.sdk         { ServerRuntimeClient, createTransport, createStackParser, nodeStackLineParser, Scope }
 * @param {object} [options.logger]    pino-style ({ warn, info })
 */
export function createErrorMonitor({ monitoring, release, environment, service, sdk, logger, deliveryTimeoutMs = DEFAULT_DELIVERY_TIMEOUT_MS, root = REPOSITORY_ROOT } = {}) {
  if (monitoring?.state !== 'enabled' || typeof monitoring.dsn !== 'string') return DISABLED;
  if (!SAFE_SERVICE.test(service ?? '')) throw new TypeError('a fixed service name is required');
  const stackParser = sdk.createStackParser(sdk.nodeStackLineParser());
  const stats = { attempts: 0, delivered: 0, failed: 0, last: null };
  let failing = false;
  const report = (outcome) => {
    stats.attempts += 1;
    stats.last = outcome.delivered ? { delivered: true, status: outcome.status } : { delivered: false, reason: outcome.reason, ...(outcome.status ? { status: outcome.status } : {}) };
    if (outcome.delivered) {
      stats.delivered += 1;
      if (failing) {
        failing = false;
        logger?.info?.({ errorMonitorDelivery: 'restored', service }, 'error monitor delivery restored');
      }
    } else {
      stats.failed += 1;
      if (!failing) {
        failing = true;
        logger?.warn?.({ errorMonitorDelivery: 'failing', reason: outcome.reason, ...(outcome.status ? { status: outcome.status } : {}), service }, 'error monitor delivery failing');
      }
    }
  };

  const client = new sdk.ServerRuntimeClient({
    dsn: monitoring.dsn,
    release: release?.sha ?? undefined,
    environment,
    serverName: service,
    platform: 'node',
    runtime: { name: 'node', version: process.version },
    integrations: [],
    defaultIntegrations: false,
    sendDefaultPii: false,
    sendClientReports: false,
    attachStacktrace: false,
    maxBreadcrumbs: 0,
    traceLifecycle: 'static',
    stackParser,
    beforeSend: (event) => rebuildSafeEvent(event, root),
    beforeSendTransaction: () => null,
    transport: (options) => sdk.createTransport(options, deliveryRequest(options.url, options.headers, deliveryTimeoutMs, report)),
  });
  client.init();

  return Object.freeze({
    state: 'enabled',
    /**
     * Records an unexpected failure. Returns the event id, or null.
     * Never throws: monitoring must not change what the caller does next.
     */
    captureUnexpected(error, { kind = 'request', status, requestId } = {}) {
      try {
        const safeKind = MONITOR_KINDS.includes(kind) ? kind : 'request';
        const summary = safeErrorSummary(error);
        const tags = { service, kind: safeKind };
        if (Number.isInteger(status)) tags.status = String(status);
        if (typeof requestId === 'string' && UUID.test(requestId)) tags.request_id = requestId;
        const frames = framesFromError(error, stackParser, root);
        const exception = { type: summary.type, value: classifiedValue(summary, safeKind), mechanism: { type: `valida.${safeKind}`, handled: safeKind !== 'uncaught' } };
        if (frames.length > 0) exception.stacktrace = { frames };
        return client.captureEvent({ level: LEVEL_FOR_KIND[safeKind], tags, exception: { values: [exception] } }, {}, new sdk.Scope()) ?? null;
      } catch {
        return null;
      }
    },
    flush: (timeoutMs = 2_000) => client.flush(timeoutMs).catch(() => false),
    close: (timeoutMs = 2_000) => client.close(timeoutMs).catch(() => false),
    delivery: () => Object.freeze({ ...stats, last: stats.last ? { ...stats.last } : null }),
  });
}

/**
 * Process-level capture for the service entry points: an uncaught
 * exception (and, under Node's default `--unhandled-rejections=throw`, an
 * unhandled rejection) is logged by classification, captured, flushed within
 * a bound, and the process exits 1 — what Node would have done, now with a
 * record. `processRef` and `exit` exist for tests.
 */
export function installCrashCapture({ monitor = DISABLED, logger, flushTimeoutMs = 2_000 }, { processRef = process, exit = (code) => processRef.exit(code) } = {}) {
  let handling = false;
  const handler = (error) => {
    if (handling) return;
    handling = true;
    try {
      logger?.fatal?.({ err: safeErrorSummary(error) }, 'uncaught exception');
    } catch {
      /* logging must not prevent the exit */
    }
    monitor.captureUnexpected(error, { kind: 'uncaught' });
    Promise.resolve(monitor.flush(flushTimeoutMs))
      .catch(() => false)
      .finally(() => exit(1));
  };
  processRef.on('uncaughtException', handler);
  return handler;
}

/**
 * The operator's test event (plan §8.5: "a test error event with the
 * release tag and no personal data"). Returns what the receiver answered.
 */
export async function sendOperatorTestEvent(monitor, { flushTimeoutMs = 10_000 } = {}) {
  if (monitor.state !== 'enabled') return { sent: false, reason: 'disabled' };
  const eventId = monitor.captureUnexpected(new Error('operator test event'), { kind: 'operator_test' });
  await monitor.flush(flushTimeoutMs);
  const delivery = monitor.delivery();
  return { sent: true, eventId, delivered: delivery.last?.delivered === true, last: delivery.last };
}
