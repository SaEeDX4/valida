import net from 'node:net';
import { SMTPServer } from 'smtp-server';

/**
 * B6 r4 — LOCAL SMTP TEST SERVER. TEST INFRASTRUCTURE ONLY.
 *
 * A real SMTP server (the maintained `smtp-server` package, devDependency)
 * listening on localhost with a TEST certificate from fixtures/testCertificates.js.
 * It lets the SMTP adapter run its real protocol, TLS and failure paths
 * offline. It is NOT Titan, NOT Bluehost and NOT evidence about either: what
 * it accepts proves only that the adapter speaks SMTP correctly and classifies
 * what a server says. Nothing it receives leaves the machine.
 *
 * Synthetic data only (*.example.test). The server keeps the received
 * messages in memory for assertions; it never stores a password (only whether
 * the login matched).
 *
 * @param {object} options
 * @param {'implicit-tls'|'starttls'|'plaintext'} [options.mode]
 * @param {{ cert: string, key: string }} [options.certificate] required unless plaintext
 * @param {{ username: string, password: string }} options.credentials what a correct login is
 * @param {number} [options.port] a fixed port (default: any free port)
 * @param {object} [options.behaviour] per-step behaviour (see below)
 *   auth      'ok' (check credentials) | { code, text }        reply to AUTH
 *   authDelayMs   delay before answering AUTH (a slow login)
 *   mailFrom  null | { code, text }                             reply to MAIL FROM
 *   rcptTo    null | { code, text } | (address) => that
 *   data      'accept' | { code, text } | 'disconnect-after-body' | 'hang-after-body', or (recipients) => one of these
 *   hideSTARTTLS  true: do not advertise STARTTLS (the command still works)
 *   noSTARTTLS    true: STARTTLS is not supported at all (advertised nor accepted)
 *   size      SIZE limit advertised and enforced
 *   dsn       true: advertise DSN
 *   greeting  'normal' | 'hang' (accepts TCP, never says anything)
 *   tlsVersions { minVersion, maxVersion } for the server side
 */
export async function startLocalSmtpServer({ mode = 'implicit-tls', certificate, credentials, behaviour = {}, port: listenPort = 0 } = {}) {
  const record = {
    connections: 0,
    // r8: every accepted TCP connection (implicit TLS: also those whose handshake then failed).
    tcpConnections: 0,
    closed: 0,
    authAttempts: [],
    // Logins being answered right now, and the most at any moment (serialisation evidence).
    authInFlight: 0,
    maxAuthInFlight: 0,
    mailFrom: [],
    rcptTo: [],
    // B6 Stage 2: the RCPT TO parameters (e.g. NOTIFY, ORCPT) with their address, for the envelope privacy test.
    rcptToArgs: [],
    messages: [],
  };
  const reply = (spec) => Object.assign(new Error(spec.text ?? 'QA local server refusal'), { responseCode: spec.code });

  if (behaviour.greeting === 'hang') {
    // A TCP listener that never speaks SMTP: the adapter must not wait forever.
    const sockets = new Set();
    const server = net.createServer((socket) => {
      record.connections += 1;
      record.tcpConnections += 1;
      sockets.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => {
        record.closed += 1;
        sockets.delete(socket);
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
      host: server.address().address,
      family: server.address().family,
      port: server.address().port,
      record,
      async stop() {
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => server.close(() => resolve()));
      },
    };
  }

  const server = new SMTPServer({
    secure: mode === 'implicit-tls',
    ...(mode === 'plaintext' ? {} : { key: certificate.key, cert: certificate.cert }),
    ...(behaviour.tlsVersions ?? {}),
    hideSTARTTLS: mode === 'plaintext' || behaviour.hideSTARTTLS === true || behaviour.noSTARTTLS === true,
    disabledCommands: mode === 'plaintext' || behaviour.noSTARTTLS === true ? ['STARTTLS'] : [],
    // The SERVER would allow a login over plaintext: the tests prove the CLIENT never tries.
    allowInsecureAuth: true,
    authMethods: ['PLAIN', 'LOGIN'],
    hideDSN: behaviour.dsn !== true,
    ...(behaviour.size ? { size: behaviour.size } : {}),
    banner: 'Valida QA local SMTP test server - not Titan',
    logger: false,
    onConnect(_session, callback) {
      record.connections += 1;
      callback();
    },
    onClose() {
      record.closed += 1;
    },
    onAuth(auth, session, callback) {
      const matched = auth.username === credentials.username && auth.password === credentials.password;
      record.authAttempts.push({ username: auth.username, matched, secure: session.secure === true });
      record.authInFlight += 1;
      record.maxAuthInFlight = Math.max(record.maxAuthInFlight, record.authInFlight);
      const answer = () => {
        record.authInFlight -= 1;
        if (behaviour.auth && behaviour.auth !== 'ok') return callback(reply(behaviour.auth));
        if (!matched) return callback(reply({ code: 535, text: '5.7.8 Authentication credentials invalid' }));
        return callback(null, { user: auth.username });
      };
      if (behaviour.authDelayMs) setTimeout(answer, behaviour.authDelayMs);
      else answer();
    },
    onMailFrom(address, session, callback) {
      record.mailFrom.push({ address: address.address, args: address.args ?? {}, user: session.user ?? null, secure: session.secure === true });
      if (behaviour.mailFrom) return callback(reply(behaviour.mailFrom));
      return callback();
    },
    onRcptTo(address, session, callback) {
      record.rcptTo.push(address.address);
      record.rcptToArgs.push({ address: address.address, args: address.args ?? {} });
      const spec = typeof behaviour.rcptTo === 'function' ? behaviour.rcptTo(address.address) : behaviour.rcptTo;
      if (spec === 'disconnect') return destroySession(session);
      if (spec) return callback(reply(spec));
      return callback();
    },
    onData(stream, session, callback) {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        const raw = Buffer.concat(chunks);
        // A function decides per message from its recipients (r5: one bounce recipient can lose its final reply).
        const data = (typeof behaviour.data === 'function' ? behaviour.data(session.envelope.rcptTo.map((entry) => entry.address)) : behaviour.data) ?? 'accept';
        record.messages.push({
          mailFrom: session.envelope.mailFrom.address,
          rcptTo: session.envelope.rcptTo.map((entry) => entry.address),
          dsn: session.envelope.dsn ?? null,
          raw,
          disposition: typeof data === 'string' ? data : `reply-${data.code}`,
        });
        if (stream.sizeExceeded) return callback(reply({ code: 552, text: '5.3.4 Message too big' }));
        if (data === 'disconnect-after-body') return destroySession(session);
        if (data === 'hang-after-body') return undefined;
        if (data !== 'accept') return callback(reply(data));
        return callback(null, 'OK: queued by the QA local test server');
      });
    },
  });

  /** TEST ONLY: drops the TCP connection of `session` (uses the server's connection list). */
  function destroySession(session) {
    for (const connection of server.connections) {
      if (connection.session === session) connection._socket?.destroy();
    }
  }

  server.on('error', () => {});
  server.server.on('connection', () => {
    record.tcpConnections += 1;
  });
  await new Promise((resolve, reject) => {
    server.server.once('error', reject);
    server.listen(listenPort, 'localhost', () => resolve());
  });
  // r8: the address actually listened on (see scriptedSmtpServer.js): a client that does not use the SMTP
  // adapter (which connects through Node's own resolution) must connect here, with 'localhost' as TLS name.
  const { address, family, port } = server.server.address();
  return {
    host: address,
    family,
    port,
    record,
    async stop() {
      for (const connection of server.connections) connection._socket?.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/** Header block of a received message, unfolded, as a Map of lower-case name -> [values]. */
export function headersOf(raw) {
  const text = raw.toString('utf8');
  const end = text.indexOf('\r\n\r\n');
  const block = (end === -1 ? text : text.slice(0, end)).replace(/\r\n[ \t]+/g, ' ');
  const headers = new Map();
  for (const line of block.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    headers.set(name, [...(headers.get(name) ?? []), line.slice(colon + 1).trim()]);
  }
  return headers;
}

/** A port on which nothing listens (bound, then released). */
export async function closedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}
