import net from 'node:net';
import tls from 'node:tls';

/**
 * TEST ONLY — a SCRIPTED SMTP dialogue server on localhost (B6 r4 review). It
 * listens on the first address Node resolves for 'localhost' and reports that
 * address as `host` (r8) — clients must connect to it, not re-resolve the name.
 *
 * NOT Titan, NOT Bluehost, NOT a mail server: it accepts nothing for
 * delivery. Each command is answered with a fixed reply chosen by the test,
 * so a test can pin how nodemailer (and the adapter) react to ONE exact reply
 * on the wire — including replies smtp-server cannot be told to give (a
 * refused DATA command before the body, a refused STARTTLS) and the
 * sequential (non-PIPELINING) dialogue.
 *
 * It advertises AUTH PLAIN only (one-line initial response) and never
 * upgrades STARTTLS: a STARTTLS reply must be a refusal. Implicit TLS uses an
 * in-memory test certificate (fixtures/testCertificates.js).
 *
 * @param {object} options
 * @param {{key:string, cert:string}} [options.certificate] implicit TLS when given; plaintext otherwise
 * @param {boolean} [options.pipelining] advertise PIPELINING
 * @param {boolean} [options.starttls] advertise STARTTLS (plaintext only)
 * @param {object} [options.replies] per step: greeting, AUTH, MAIL, RCPT, DATA, STARTTLS, final —
 *   a reply line ('550 5.1.1 ...'), 'drop' (destroy the connection) or 'hang' (say nothing)
 */
export async function startScriptedSmtpServer({ certificate, pipelining = false, starttls = false, replies = {} } = {}) {
  // connections: SMTP sessions that began (for implicit TLS: only after a COMPLETED handshake).
  // r8: tcpConnections (every accepted TCP connection) and tlsClientErrors (handshakes that failed) show
  // which phase a client actually reached — a refused connection reaches none of them.
  const record = { connections: 0, closed: 0, events: [], bodies: [], tcpConnections: 0, tlsClientErrors: [] };
  const sockets = new Set();

  function handle(socket) {
    record.connections += 1;
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => {
      record.closed += 1;
      sockets.delete(socket);
    });
    socket.setEncoding('utf8');
    const say = (line) => {
      if (!socket.destroyed) socket.write(`${line}\r\n`);
    };
    const act = (reply) => {
      if (reply === 'drop') return socket.destroy();
      if (reply === 'hang') return undefined;
      return say(reply);
    };

    let buffer = '';
    let inData = false;
    let acceptedRecipients = 0;
    act(replies.greeting ?? '220 localhost QA scripted SMTP test server - not Titan');
    socket.on('data', (chunk) => {
      buffer += chunk;
      for (;;) {
        if (socket.destroyed) return;
        if (inData) {
          // The terminator; an empty message is just ".\r\n".
          const empty = buffer.startsWith('.\r\n');
          const end = empty ? -2 : buffer.indexOf('\r\n.\r\n');
          if (end === -1) return;
          record.bodies.push(buffer.slice(0, end + 2));
          buffer = buffer.slice(end + 5);
          inData = false;
          record.events.push('BODY');
          act(replies.final ?? '250 2.0.0 OK QA scripted server (accepts nothing for delivery)');
          continue;
        }
        const eol = buffer.indexOf('\r\n');
        if (eol === -1) return;
        const line = buffer.slice(0, eol);
        buffer = buffer.slice(eol + 2);
        const verb = line.split(/[ :]/, 1)[0].toUpperCase();
        record.events.push(verb);
        switch (verb) {
          case 'EHLO': {
            const lines = ['localhost QA scripted', ...(pipelining ? ['PIPELINING'] : []), ...(starttls ? ['STARTTLS'] : []), 'AUTH PLAIN', 'ENHANCEDSTATUSCODES'];
            lines.forEach((text, index) => say(`250${index === lines.length - 1 ? ' ' : '-'}${text}`));
            break;
          }
          case 'AUTH':
            act(replies.AUTH ?? '235 2.7.0 Authentication successful');
            break;
          case 'MAIL':
            acceptedRecipients = 0;
            act(replies.MAIL ?? '250 2.1.0 OK');
            break;
          case 'RCPT': {
            const reply = replies.RCPT ?? '250 2.1.5 OK';
            if (/^2/.test(reply)) acceptedRecipients += 1;
            act(reply);
            break;
          }
          case 'DATA': {
            // Like a real server: no accepted recipient, no DATA (RFC 5321 3.3).
            const reply = replies.DATA ?? (acceptedRecipients > 0 ? '354 End data with <CR><LF>.<CR><LF>' : '554 5.5.1 No valid recipients');
            if (/^354/.test(reply)) inData = true;
            act(reply);
            break;
          }
          case 'STARTTLS':
            act(replies.STARTTLS ?? '454 4.7.0 TLS not available');
            break;
          case 'RSET':
            say('250 2.0.0 OK');
            break;
          case 'QUIT':
            say('221 2.0.0 Bye');
            socket.end();
            return;
          default:
            say('502 5.5.2 Command not recognized');
        }
      }
    });
  }

  const server = certificate ? tls.createServer({ key: certificate.key, cert: certificate.cert, minVersion: 'TLSv1.2' }, handle) : net.createServer(handle);
  server.on('connection', () => {
    record.tcpConnections += 1;
  });
  server.on('tlsClientError', (error) => {
    record.tlsClientErrors.push(error?.code ?? 'unknown');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, 'localhost', () => resolve());
  });
  // r8: the address this server ACTUALLY listens on (the name 'localhost' may resolve to several addresses —
  // e.g. ::1 and 127.0.0.1 on Windows — and a client's own resolver may pick a different one). Clients connect
  // here and present 'localhost' as the TLS server name, so certificate verification is unchanged.
  const { address, family, port } = server.address();
  return {
    host: address,
    family,
    port,
    record,
    async stop() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
