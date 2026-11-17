import http from 'node:http';

/**
 * C6-T6 — a local stand-in for the Sentry ingest endpoint. It records the
 * EXACT bytes each service sends (what would leave the process) and parses
 * the envelopes, so tests assert on the serialized payload itself, not on
 * the objects handed to the SDK.
 *
 * behaviour: 'accept' (200), { status: n }, or 'hang' (never answers).
 * Used by the backend suite, the document-server suite and the C6-T6 stack.
 */
export const QA_MONITOR_KEY = '0123456789abcdef0123456789abcdef';

export function parseEnvelope(text) {
  const lines = text.split('\n');
  const header = JSON.parse(lines[0]);
  const items = [];
  for (let i = 1; i + 1 < lines.length; i += 2) {
    if (lines[i] === '') break;
    items.push({ header: JSON.parse(lines[i]), payload: JSON.parse(lines[i + 1]) });
  }
  return { header, items };
}

export async function startMonitoringReceiver({ behaviour = 'accept', projectId = 7 } = {}) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      requests.push({ method: req.method, url: req.url, headers: { ...req.headers }, body });
      if (behaviour === 'hang') return;
      res.statusCode = typeof behaviour === 'object' ? behaviour.status : 200;
      res.setHeader('content-type', 'application/json');
      res.end('{}');
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    dsn: `http://${QA_MONITOR_KEY}@127.0.0.1:${port}/${projectId}`,
    requests,
    /** Every byte received, as one string (request line, headers and bodies). */
    raw: () => requests.map((r) => `${r.method} ${r.url}\n${JSON.stringify(r.headers)}\n${r.body.toString('latin1')}`).join('\n---\n'),
    envelopes: () => requests.map((r) => parseEnvelope(r.body.toString('utf8'))),
    events: () => requests.flatMap((r) => parseEnvelope(r.body.toString('utf8')).items.filter((item) => item.header.type === 'event').map((item) => item.payload)),
    async waitFor(count, timeoutMs = 5_000) {
      const deadline = Date.now() + timeoutMs;
      while (requests.length < count && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      return requests.length >= count;
    },
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** A loopback port with nothing listening (bound, read, released). */
export async function closedPortDsn(projectId = 7) {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return `http://${QA_MONITOR_KEY}@127.0.0.1:${port}/${projectId}`;
}
