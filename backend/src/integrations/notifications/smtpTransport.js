import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { Readable } from 'node:stream';
import SMTPConnection from 'nodemailer/lib/smtp-connection';
import MailComposer from 'nodemailer/lib/mail-composer';
import { EMAIL_LOGO, emailLogoBytes } from './emailLogo.js';

/**
 * SMTP transport adapter — Milestone B6 r4.
 *
 * The provider the owner selected (Bluehost Professional Email Plus, powered
 * by Titan) offers authenticated SMTP submission only — no message API, no
 * webhook, no delivery-status feed. This adapter implements the transport
 * contract of notificationService.js over SMTP, using nodemailer's maintained
 * SMTP client (SMTPConnection) and MIME composer (MailComposer). Neither SMTP
 * nor TLS is implemented here.
 *
 * WHAT A RESOLVED send() MEANS: the relay replied 250 to the end of the
 * message — it ACCEPTED the message for onward delivery. It is not delivery
 * (Doc 14 section 166): the relay may still bounce it later, to the sending
 * mailbox (no API reports it). Nothing the server returns (queue id, reply
 * text) is kept.
 *
 * TRANSPORT SECURITY (Doc 14 sections 131, 152-153; SEC — no weakened TLS)
 *   - implicit-tls (default, port 465): TLS from the first byte.
 *   - starttls (port 587): STARTTLS is REQUIRED; a server that does not offer
 *     it, or an upgrade that fails, ends the attempt (TLS_FAILED). There is no
 *     opportunistic or plaintext fallback, and credentials are never sent
 *     before the connection is encrypted.
 *   - TLS 1.2 or newer; the certificate chain AND the host name are verified
 *     (rejectUnauthorized, Node's default checkServerIdentity). The only way
 *     to trust another CA is the `trustedCa` option, used by the tests' local
 *     SMTP server; configuration cannot set it.
 *
 * OUTCOME CLASSIFICATION — by the phase the attempt reached:
 *   connect / session / auth / envelope  nothing was submitted: every failure
 *       is definitive — transient (PROVIDER_UNAVAILABLE), permanent
 *       (INVALID_RECIPIENT, PROVIDER_REJECTED) or configuration
 *       (PROVIDER_AUTH_FAILED, SENDER_NOT_VERIFIED, TLS_FAILED).
 *   data  the server answered DATA (354) and the message body began to flow.
 *       Only the server's final reply is definitive (2xx accepted, 4xx
 *       transient, 5xx rejected). A lost connection, a timeout or an abort
 *       without that reply is OUTCOME_UNKNOWN: the message may have been
 *       accepted, so it is never retried automatically (no duplicate risk).
 *
 * BOUNDS AND CANCELLATION. Every network step has a timeout (the configured
 * notification bound), and the service aborts the call at that bound. On
 * abort the socket is DESTROYED (not ended: nothing queued is flushed by us
 * after the abort) and the call settles at once with the phase's code — the
 * send is stopped, not abandoned.
 *
 * FAILED AUTHENTICATION LATCH. Titan blocks a client IP after repeated failed
 * logins. Logins run one at a time; after one definitive authentication
 * refusal (5xx, or no usable AUTH offered), this adapter attempts no further
 * login until the process restarts (a credential change needs a restart
 * anyway) — neither new sessions nor sessions already waiting for their login
 * turn: every call fails with PROVIDER_AUTH_FAILED, and
 * `onAuthenticationRejected` is called once so readiness can say so.
 *
 * MESSAGE. One recipient per message. From = the authenticated mailbox
 * (enforced by configuration and checked again here). Headers: a stable
 * Message-ID derived from the idempotency key (the same for every attempt of
 * one logical message — a correlation aid, NOT an exactly-once guarantee),
 * Auto-Submitted: auto-generated (RFC 3834: no auto-replies), no X-Mailer.
 * B6 Stage 2: an HTML part that references the approved email logo by its
 * Content-ID gets that logo as ONE inline related part (fixed name and
 * Content-ID, bytes pinned by SHA-256); nothing else is ever attached.
 * The envelope asks, where the server supports DSN (RFC 3461), for
 * failure/delay reports with headers only and an ENVID equal to the
 * Message-ID token, so a bounce can be matched without its content.
 *
 * DIAGNOSTICS. A rejection carries `notificationCode` (the contract) and
 * `notificationDiagnostic`: fixed tokens only — the phase, the numeric SMTP
 * reply code, the enhanced status code (e.g. 5.7.8) and a constant error code
 * (e.g. ECONNREFUSED, CERT_HAS_EXPIRED). Never the reply text (it can name
 * recipients), the password, the username or any message content.
 */

export const SMTP_SECURITY_MODES = Object.freeze(['implicit-tls', 'starttls']);
export const SMTP_DEFAULT_PORTS = Object.freeze({ 'implicit-tls': 465, starttls: 587 });

/**
 * Node / OpenSSL codes of a TLS or certificate failure (chain, name,
 * validity, protocol version) — the channel could not be SECURED. A handshake
 * that merely took too long is not one of them (transient).
 */
const TLS_ERROR_CODE = /^(?:ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_|DEPTH_ZERO_SELF_SIGNED_CERT$|SELF_SIGNED_CERT_IN_CHAIN$|HOSTNAME_MISMATCH$|INVALID_CA$|INVALID_PURPOSE$|PATH_LENGTH_EXCEEDED$|EPROTO$)/;
const isTlsFailureCode = (value) => typeof value === 'string' && value !== 'ERR_TLS_HANDSHAKE_TIMEOUT' && TLS_ERROR_CODE.test(value);
const ERROR_CODE_TOKEN = /^[A-Z][A-Z0-9_]{1,63}$/;
const ENHANCED_STATUS = /^\d{3}[ -]([245]\.\d{1,3}\.\d{1,3})(?:\s|$)/;

/** The derived message reference: hex, 32 characters, the same for every attempt of one logical message. */
export function messageReference(idempotencyKey) {
  return crypto.createHash('sha256').update(String(idempotencyKey)).digest('hex').slice(0, 32);
}

/** A rejection the service understands: a contract code plus value-free diagnostics. */
function transportError(code, diagnostic) {
  const error = new Error(`SMTP transport: ${code}`);
  error.notificationCode = code;
  error.notificationDiagnostic = Object.freeze({ ...diagnostic });
  return error;
}

/** Safe diagnostic tokens of one failure. Never the reply text. */
export function smtpDiagnostic(error, phase) {
  const diagnostic = { phase };
  const replyCode = Number(error?.responseCode);
  if (Number.isInteger(replyCode) && replyCode >= 200 && replyCode <= 599) diagnostic.replyCode = replyCode;
  const enhanced = typeof error?.response === 'string' ? ENHANCED_STATUS.exec(error.response) : null;
  if (enhanced) diagnostic.enhancedStatus = enhanced[1];
  for (const candidate of [error?.originalCode, error?.code]) {
    if (typeof candidate === 'string' && ERROR_CODE_TOKEN.test(candidate)) {
      diagnostic.errorCode = candidate;
      break;
    }
  }
  return diagnostic;
}

/**
 * Pure classification of one SMTP failure by the phase it happened in.
 * @returns {string} a notificationService TRANSPORT_ERROR_CODES value
 */
export function classifySmtpFailure(error, phase) {
  const replyCode = Number(error?.responseCode);
  const hasReply = Number.isInteger(replyCode) && replyCode >= 400 && replyCode <= 599;
  const temporary = hasReply && replyCode < 500;
  const code = error?.code;

  // Our own abort (the bound expired, or the transport is closing): the
  // socket was destroyed. Before the body, nothing was submitted.
  if (code === 'ABORTED') return phase === 'data' ? 'OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE';

  if (phase === 'data') {
    // Only the server's own final reply is definitive here (nodemailer: EMESSAGE).
    if (code === 'EMESSAGE' && hasReply) return temporary ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REJECTED';
    return 'OUTCOME_UNKNOWN';
  }
  if (phase === 'connect') {
    // Only a certificate / TLS failure is TLS_FAILED (r4 review: a local
    // firewall, exhausted descriptors or a multi-address failure reported by
    // its first attempt are not). Anything else here — refused, reset,
    // unreachable, DNS, timeouts, the unrecognised — reached no SMTP session:
    // nothing was submitted and no credential was sent. Transient.
    if (code === 'TLS_UNAUTHORIZED' || isTlsFailureCode(error?.originalCode ?? code)) return 'TLS_FAILED';
    return 'PROVIDER_UNAVAILABLE';
  }
  if (phase === 'session') {
    // Never encrypted after all (the adapter refuses to log in): TLS_FAILED.
    if (code === 'TLS_NOT_ESTABLISHED') return 'TLS_FAILED';
    // STARTTLS answered by the server: 5xx = refused / not supported (it
    // cannot be secured); 4xx (e.g. 454, RFC 3207) = temporarily unavailable.
    if (code === 'ETLS' && hasReply) return temporary ? 'PROVIDER_UNAVAILABLE' : 'TLS_FAILED';
    // The upgrade's socket failed with a certificate / TLS code.
    if (isTlsFailureCode(error?.originalCode)) return 'TLS_FAILED';
    // A connection closed during the upgrade, a greeting refused, a timeout: transient.
    return 'PROVIDER_UNAVAILABLE';
  }
  if (phase === 'auth') {
    // The latch closed while this session waited for its turn to log in.
    if (code === 'AUTH_LATCHED') return 'PROVIDER_AUTH_FAILED';
    if (code === 'EAUTH') return temporary ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_AUTH_FAILED';
    return 'PROVIDER_UNAVAILABLE';
  }
  if (phase === 'envelope') {
    if (code === 'EENVELOPE' && hasReply) {
      if (temporary) return 'PROVIDER_UNAVAILABLE';
      if (error.command === 'MAIL FROM') return 'SENDER_NOT_VERIFIED';
      if (error.command === 'RCPT TO') {
        const enhanced = typeof error.response === 'string' ? ENHANCED_STATUS.exec(error.response) : null;
        return enhanced && enhanced[1].startsWith('5.7.') ? 'PROVIDER_REJECTED' : 'INVALID_RECIPIENT';
      }
      return 'PROVIDER_REJECTED';
    }
    // A size refusal before the message (nodemailer checks the SIZE extension).
    if (code === 'EMESSAGE') return 'PROVIDER_REJECTED';
    // The client's own envelope validation (no server reply): our defect, not
    // the relay's — not retried automatically (uncertain class, operator).
    if (code === 'EENVELOPE' && error.command === 'API') return 'PROVIDER_ERROR';
    // The body never started: whatever else happened, nothing was submitted.
    return 'PROVIDER_UNAVAILABLE';
  }
  return 'PROVIDER_UNAVAILABLE';
}

/**
 * @param {object} options
 * @param {string} options.host SMTP_HOST — a DNS name (validated by configuration)
 * @param {number} options.port SMTP_PORT
 * @param {'implicit-tls'|'starttls'} options.security SMTP_SECURITY
 * @param {string} options.username SMTP_USERNAME — the mailbox; also the only permitted From
 * @param {string} options.password SMTP_PASSWORD — a secret: held in this closure only
 * @param {number} options.timeoutMs bound on each network step (NOTIFICATION_TIMEOUT_MS)
 * @param {string|Buffer|Array} [options.trustedCa] TEST ONLY: an additional trusted CA for the local test server
 * @param {() => void} [options.onAuthenticationRejected] called once when the latch closes
 * @param {() => Date} [options.clock]
 */
export function createSmtpTransport({
  host,
  port,
  security = 'implicit-tls',
  username,
  password,
  timeoutMs,
  trustedCa,
  onAuthenticationRejected,
  clock = () => new Date(),
} = {}) {
  if (typeof host !== 'string' || host.length === 0 || net.isIP(host)) throw new TypeError('createSmtpTransport: host must be a DNS name');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError('createSmtpTransport: port is invalid');
  if (!SMTP_SECURITY_MODES.includes(security)) throw new TypeError('createSmtpTransport: security is invalid');
  if (typeof username !== 'string' || !username.includes('@')) throw new TypeError('createSmtpTransport: username is required');
  if (typeof password !== 'string' || password.length === 0) throw new TypeError('createSmtpTransport: password is required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('createSmtpTransport: timeoutMs is required');

  const senderDomain = username.slice(username.lastIndexOf('@') + 1);
  const tlsOptions = Object.freeze({
    servername: host,
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true,
    ...(trustedCa ? { ca: trustedCa } : {}),
  });

  let closed = false;
  let authenticationRejected = false;
  const sessions = new Set();

  /*
   * ONE LOGIN AT A TIME (r4 review R1). Sessions that connect concurrently
   * (the two channels of one Application, several Applications) queue for
   * their AUTH turn, and the latch is checked again when the turn comes. So
   * after a refused login no queued session sends AUTH: one wrong password
   * costs one failed login at the relay, not one per session. A turn is
   * released when its login answers or its session ends (abort, failure,
   * timeout), so a session that dies while waiting or logging in can never
   * block the queue.
   */
  let loginQueue = Promise.resolve();
  function acquireLoginTurn() {
    let open;
    const turn = new Promise((resolve) => {
      open = resolve;
    });
    const ready = loginQueue;
    loginQueue = ready.then(() => turn);
    let released = false;
    return {
      ready,
      release() {
        if (released) return;
        released = true;
        open();
      },
    };
  }

  function latchAuthentication() {
    if (authenticationRejected) return;
    authenticationRejected = true;
    try {
      onAuthenticationRejected?.();
    } catch {
      // A failing observer must not change the outcome of this attempt.
    }
  }

  /** Opens the TCP (+ implicit TLS) connection this session owns. Resolves the socket. */
  function openSocket(session) {
    return new Promise((resolve, reject) => {
      const implicit = security === 'implicit-tls';
      const socket = implicit ? tls.connect({ host, port, ...tlsOptions }) : net.connect({ host, port });
      session.socket = socket;
      // Absorbs errors no other listener is attached for (between handover and
      // nodemailer's own handlers, or after a deliberate destroy), so a stray
      // socket error can never crash the process. It does not hide anything:
      // nodemailer's handlers still receive every error, and every session is
      // bounded by its timeouts and the service's abort.
      socket.on('error', () => {});
      const timer = setTimeout(() => {
        cleanup();
        socket.destroy();
        reject(Object.assign(new Error('connect timeout'), { code: 'CONNECT_TIMEOUT' }));
      }, timeoutMs);
      const onError = (error) => {
        cleanup();
        socket.destroy();
        reject(error);
      };
      const onReady = () => {
        cleanup();
        if (implicit && (socket.authorized !== true || !['TLSv1.2', 'TLSv1.3'].includes(socket.getProtocol()))) {
          // Defence in depth: rejectUnauthorized already refuses this.
          socket.destroy();
          reject(Object.assign(new Error('TLS not authorized'), { code: 'TLS_UNAUTHORIZED' }));
          return;
        }
        resolve(socket);
      };
      function cleanup() {
        clearTimeout(timer);
        session.cancelConnect = null;
        socket.removeListener('error', onError);
        socket.removeListener(implicit ? 'secureConnect' : 'connect', onReady);
      }
      // An abort while connecting ends this step at once (no timer left behind).
      session.cancelConnect = () => {
        cleanup();
        socket.destroy();
        reject(Object.assign(new Error('aborted'), { code: 'ABORTED' }));
      };
      socket.once('error', onError);
      socket.once(implicit ? 'secureConnect' : 'connect', onReady);
    });
  }

  /**
   * Runs one SMTP session: connect, (STARTTLS,) authenticate, then `work`.
   * Settles exactly once; on abort or failure the socket is destroyed.
   */
  function runSession(signal, work) {
    return new Promise((resolve, reject) => {
      const session = { phase: 'connect', socket: null, connection: null, settled: false };
      sessions.add(session);

      const teardown = () => {
        session.cancelConnect?.();
        session.releaseLogin?.();
        // Destroy first: nothing is flushed on our behalf after a failure or an abort.
        session.socket?.destroy();
        try {
          session.connection?.close();
        } catch {
          // already closed
        }
        sessions.delete(session);
      };
      const fail = (error, phase = session.phase) => {
        if (session.settled) return;
        session.settled = true;
        signal?.removeEventListener('abort', onAbort);
        teardown();
        const code = classifySmtpFailure(error, phase);
        if (code === 'PROVIDER_AUTH_FAILED') latchAuthentication();
        reject(transportError(code, smtpDiagnostic(error, phase)));
      };
      const succeed = (value) => {
        if (session.settled) return;
        session.settled = true;
        signal?.removeEventListener('abort', onAbort);
        // Accepted: end the session politely, bounded; the socket is destroyed
        // if the server does not close it promptly.
        const { connection, socket } = session;
        try {
          connection.quit();
        } catch {
          // ignore
        }
        const closer = setTimeout(() => {
          socket?.destroy();
          sessions.delete(session);
        }, Math.min(timeoutMs, 2_000));
        closer.unref?.();
        socket?.once('close', () => {
          clearTimeout(closer);
          sessions.delete(session);
        });
        resolve(value);
      };
      function onAbort() {
        fail(Object.assign(new Error('aborted'), { code: 'ABORTED' }));
      }
      session.abort = onAbort;

      if (signal?.aborted || closed) {
        fail(Object.assign(new Error('aborted'), { code: 'ABORTED' }));
        return;
      }
      if (authenticationRejected) {
        session.settled = true;
        sessions.delete(session);
        reject(transportError('PROVIDER_AUTH_FAILED', { phase: 'auth', errorCode: 'AUTH_LATCHED' }));
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });

      openSocket(session).then(
        (socket) => {
          if (session.settled) {
            socket.destroy();
            return;
          }
          session.phase = 'session';
          const connection = new SMTPConnection({
            connection: socket,
            secure: security === 'implicit-tls',
            secured: security === 'implicit-tls',
            requireTLS: security === 'starttls',
            ignoreTLS: false,
            opportunisticTLS: false,
            host,
            servername: host,
            port,
            name: senderDomain,
            tls: tlsOptions,
            connectionTimeout: timeoutMs,
            greetingTimeout: timeoutMs,
            socketTimeout: timeoutMs,
            logger: false,
            debug: false,
            transactionLog: false,
          });
          session.connection = connection;
          // nodemailer reports failures through the callbacks AND an 'error'
          // event; the event must be handled or it would be thrown.
          connection.on('error', (error) => fail(error));
          connection.connect((connectError) => {
            if (connectError) return fail(connectError);
            if (session.settled) return undefined;
            if (connection.secure !== true) {
              // Never authenticate over an unencrypted connection.
              return fail(Object.assign(new Error('TLS not established'), { code: 'TLS_NOT_ESTABLISHED' }));
            }
            session.phase = 'auth';
            const turn = acquireLoginTurn();
            session.releaseLogin = turn.release;
            turn.ready.then(() => {
              if (session.settled) return turn.release();
              if (authenticationRejected) {
                turn.release();
                return fail(Object.assign(new Error('authentication latched'), { code: 'AUTH_LATCHED' }));
              }
              connection.login({ user: username, pass: password }, (loginError) => {
                turn.release();
                if (loginError) return fail(loginError);
                if (session.settled) return undefined;
                session.phase = 'envelope';
                return work(session, connection).then(succeed, (error) => fail(error));
              });
              return undefined;
            });
            return undefined;
          });
        },
        (error) => fail(error),
      );
    });
  }

  /** The message, composed once, before any connection is opened. */
  async function compose(message, reference) {
    const usesLogo = typeof message.html === 'string' && message.html.includes(`cid:${EMAIL_LOGO.contentId}`);
    const composer = new MailComposer({
      from: { name: message.from.name, address: message.from.address },
      to: message.to[0],
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      subject: message.subject,
      text: message.text,
      html: message.html,
      messageId: `<${reference}.b6@${senderDomain}>`,
      date: clock(),
      headers: { 'Auto-Submitted': 'auto-generated' },
      ...(usesLogo
        ? {
            attachments: [
              {
                filename: EMAIL_LOGO.filename,
                content: emailLogoBytes(),
                contentType: EMAIL_LOGO.contentType,
                cid: EMAIL_LOGO.contentId,
                contentDisposition: 'inline',
              },
            ],
          }
        : {}),
      xMailer: false,
      disableFileAccess: true,
      disableUrlAccess: true,
      textEncoding: 'quoted-printable',
    });
    return composer.compile().build();
  }

  return Object.freeze({
    name: 'smtp',

    /** Connects, secures and authenticates — then QUIT. Sends nothing. */
    verify({ signal } = {}) {
      return runSession(signal, async () => undefined);
    },

    /**
     * Submits ONE message. Resolves (with nothing) only on the relay's final
     * 2xx reply. See the classification above for every rejection.
     */
    async send(message, { signal, idempotencyKey } = {}) {
      // A message this adapter cannot compose is a defect on our side, found
      // before any connection: PROVIDER_ERROR (uncertain — an operator looks
      // before anything is retried). TEMPLATE_ERROR stays service-only.
      if (!message || !Array.isArray(message.to) || message.to.length !== 1) {
        throw transportError('PROVIDER_ERROR', { phase: 'connect', errorCode: 'MESSAGE_SHAPE' });
      }
      if (String(message.from?.address).toLowerCase() !== username.toLowerCase()) {
        // The authenticated mailbox is the only permitted sender (configuration enforces it too).
        throw transportError('SENDER_NOT_VERIFIED', { phase: 'connect', errorCode: 'FROM_NOT_USERNAME' });
      }
      const reference = messageReference(idempotencyKey ?? `${message.event}/${message.metadata?.applicationId}`);
      let raw;
      try {
        raw = await compose(message, reference);
      } catch {
        throw transportError('PROVIDER_ERROR', { phase: 'connect', errorCode: 'COMPOSE_FAILED' });
      }
      return runSession(signal, (session, connection) =>
        new Promise((resolve, reject) => {
          let started = false;
          // The body is read only after the server answered DATA (354): the
          // first read marks the point after which the outcome can be unknown.
          const body = new Readable({
            read() {
              if (started) return;
              started = true;
              session.phase = 'data';
              this.push(raw);
              this.push(null);
            },
          });
          connection.send(
            {
              from: username,
              to: [message.to[0]],
              size: raw.length,
              dsn: { ret: 'HDRS', envid: reference, notify: ['FAILURE', 'DELAY'] },
            },
            body,
            (error, info) => {
              if (error) return reject(error);
              const accepted = Array.isArray(info?.accepted) ? info.accepted.length : 0;
              if (accepted !== 1) {
                // A final 2xx without the recipient accepted is not something to call SENT.
                return reject(Object.assign(new Error('recipient not accepted'), { code: 'EMESSAGE' }));
              }
              return resolve();
            },
          );
        }),
      );
    },

    /** Stops every session in progress (destroying its socket) and refuses new ones. */
    async close() {
      closed = true;
      for (const session of [...sessions]) {
        if (!session.settled) session.abort();
        else {
          session.socket?.destroy();
          sessions.delete(session);
        }
      }
    },

    /** For tests and diagnostics: sessions still holding a socket. */
    get openSessions() {
      return sessions.size;
    },

    /** True after a definitive authentication refusal (see the latch above). */
    get authenticationRejected() {
      return authenticationRejected;
    },
  });
}
