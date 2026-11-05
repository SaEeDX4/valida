import net from 'node:net';
import mongoose from 'mongoose';

/**
 * B7 SUP-12 / §3.5 investigation — a TCP bridge in front of every
 * replica-set member, so a test can PARTITION the set without root, iptables
 * or a MongoDB test binary (the role mongobridge plays in MongoDB's own tests).
 *
 * The set's configuration names the BRIDGE addresses, so every connection to
 * a member (from another member or from a driver) passes through its bridge.
 * Each new connection is identified from its first message, the handshake:
 *
 *   another mongod   `hostInfo: "<host>:<listening port>"`  → "node:<name>"
 *   a driver         `client.application.name` (appName)   → "app:<name>"
 *
 * `partition(rule)` applies `rule(source, destination)` to every current and
 * future connection:
 *   'blackhole'  the bytes are read and dropped, nothing is forwarded and the
 *                socket stays open — requests simply time out, as in a real
 *                partition (the side that sends them keeps its last view);
 *   'refuse'     the connection is closed at once (new ones right after the
 *                handshake) — the side that opened it fails fast and moves on
 *                (for example a secondary choosing a new sync source);
 *   false        forwarded normally.
 * `heal()` destroys every affected connection, so both sides reconnect cleanly.
 *
 * Test infrastructure only; synthetic data; never used by the application.
 */
const { BSON } = mongoose.mongo;
const OP_MSG = 2013;
const OP_QUERY = 2004;

function handshakeDocument(message) {
  const opCode = message.readInt32LE(12);
  let offset;
  if (opCode === OP_MSG) {
    if (message.readUInt8(20) !== 0) return null;
    offset = 21;
  } else if (opCode === OP_QUERY) {
    offset = message.indexOf(0, 20) + 1 + 8; // flags, collection name, skip, return
  } else {
    return null;
  }
  const length = message.readInt32LE(offset);
  return BSON.deserialize(message.subarray(offset, offset + length));
}

/**
 * @param {{ nodes: Array<{ name: string, real: string, bridgePort: number }> }} options
 */
export async function startPartitionBridge({ nodes }) {
  const nodeByRealPort = new Map(nodes.map((node) => [Number(node.real.split(':')[1]), node.name]));
  const identities = new Map(); // source -> count (evidence)
  const pipes = new Set();
  let rule = () => false;
  const verdict = (source, destination) => {
    const value = rule(source, destination);
    return value === true ? 'blackhole' : value || false;
  };
  const cutOff = (pipe) => {
    pipe.client.destroy();
    pipe.upstream?.destroy();
  };

  const identify = (message) => {
    let document = null;
    try {
      document = handshakeDocument(message);
    } catch {
      document = null;
    }
    if (typeof document?.hostInfo === 'string') {
      const port = Number(document.hostInfo.split(':').pop());
      if (nodeByRealPort.has(port)) return `node:${nodeByRealPort.get(port)}`;
    }
    const appName = document?.client?.application?.name;
    if (typeof appName === 'string') return `app:${appName}`;
    if (process.env.PARTITION_BRIDGE_DEBUG) console.log('bridge: unidentified handshake', JSON.stringify({ opCode: message.readInt32LE(12), keys: document ? Object.keys(document) : null, client: document?.client ?? null }));
    return 'unknown';
  };

  const servers = await Promise.all(
    nodes.map(
      (node) =>
        new Promise((resolve, reject) => {
          const [host, port] = node.real.split(':');
          const server = net.createServer((client) => {
            const pipe = { source: null, destination: node.name, client, upstream: null, blackholed: false, affected: false };
            pipes.add(pipe);
            let head = Buffer.alloc(0);
            client.on('data', (chunk) => {
              if (pipe.blackholed) return; // dropped: nothing reaches the member
              if (pipe.upstream) {
                pipe.upstream.write(chunk);
                return;
              }
              head = Buffer.concat([head, chunk]);
              if (head.length < 4 || head.length < head.readInt32LE(0)) return;
              pipe.source = identify(head.subarray(0, head.readInt32LE(0)));
              identities.set(pipe.source, (identities.get(pipe.source) ?? 0) + 1);
              const action = verdict(pipe.source, node.name);
              if (action === 'refuse') {
                cutOff(pipe);
                return;
              }
              if (action === 'blackhole') {
                pipe.blackholed = true;
                pipe.affected = true;
                return;
              }
              pipe.upstream = net.connect(Number(port), host);
              pipe.upstream.on('data', (data) => {
                if (!pipe.blackholed) client.write(data);
              });
              pipe.upstream.on('error', () => client.destroy());
              pipe.upstream.on('close', () => client.destroy());
              pipe.upstream.write(head);
            });
            client.on('error', () => {});
            client.on('close', () => {
              pipe.upstream?.destroy();
              pipes.delete(pipe);
            });
          });
          server.on('error', reject);
          server.listen(node.bridgePort, '127.0.0.1', () => resolve(server));
        }),
    ),
  );

  return {
    identities: () => Object.fromEntries(identities),
    /** Applies `next(source, destination)` → 'blackhole' | 'refuse' | false to every current and future connection. */
    partition(next) {
      rule = next;
      for (const pipe of pipes) {
        if (!pipe.source) continue;
        const action = verdict(pipe.source, pipe.destination);
        if (action === 'refuse') cutOff(pipe);
        else if (action === 'blackhole') {
          pipe.blackholed = true;
          pipe.affected = true;
        }
      }
    },
    /** Ends the partition: every affected connection is destroyed so both sides reconnect. */
    heal() {
      rule = () => false;
      for (const pipe of pipes) if (pipe.affected || pipe.blackholed) cutOff(pipe);
    },
    async close() {
      for (const pipe of pipes) {
        pipe.client.destroy();
        pipe.upstream?.destroy();
      }
      await Promise.all(servers.map((server) => new Promise((resolve) => server.close(() => resolve()))));
    },
  };
}
