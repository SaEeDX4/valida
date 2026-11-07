import net from 'node:net';
import os from 'node:os';

/**
 * The E2E backend must listen on 127.0.0.1 only (C3, GPT finding 2). The
 * launcher reports the address its socket ACTUALLY listens on
 * (server.address()); the setup checks it here before anything else runs.
 */

/** Null when `listening` is exactly 127.0.0.1:<port> over IPv4; otherwise the reason. */
export function loopbackProblem(listening, port) {
  if (!listening || typeof listening !== 'object') return 'the backend reported no listening address';
  if (listening.address !== '127.0.0.1') return `the backend listens on ${JSON.stringify(listening.address)}, not 127.0.0.1`;
  if (listening.family !== 'IPv4') return `the backend's socket family is ${JSON.stringify(listening.family)}, not IPv4`;
  if (listening.port !== port) return `the backend listens on port ${JSON.stringify(listening.port)}, not ${port}`;
  return null;
}

/**
 * Tries `port` on every non-loopback IPv4 address of this machine. A server
 * bound to 127.0.0.1 refuses them all. Returns [{ interface, result }]; the
 * address itself is not recorded. Empty when the machine has none.
 */
export async function reachFromOtherInterfaces(port, { interfaces = os.networkInterfaces(), timeoutMs = 2_000 } = {}) {
  const addresses = Object.entries(interfaces).flatMap(([name, entries]) =>
    (entries ?? []).filter((entry) => entry.family === 'IPv4' && !entry.internal).map((entry) => ({ name, address: entry.address })),
  );
  const attempts = [];
  for (const { name, address } of addresses) {
    const result = await new Promise((resolve) => {
      const socket = net.connect({ host: address, port });
      socket.setTimeout(timeoutMs, () => {
        socket.destroy();
        resolve('timeout');
      });
      socket.once('connect', () => {
        socket.destroy();
        resolve('connected');
      });
      socket.once('error', (error) => resolve(error.code ?? 'error'));
    });
    attempts.push({ interface: name, result });
  }
  return attempts;
}
