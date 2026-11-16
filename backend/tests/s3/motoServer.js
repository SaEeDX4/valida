import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';

/**
 * C6-T4 — the local S3-compatible test double: moto's server mode (Python),
 * started for a test run and set up by moto_setup.py. Requires
 * VALIDA_TEST_MOTO_PYTHON: a Python interpreter with `moto[server]` installed
 * (see backend/README.md, "S3-compatible storage (C6-T4)"). Never a real
 * provider; synthetic credentials only.
 */
export const SETUP_ACTIONS = 12; // moto_setup.py numbers its actions (C6-T4 correction 2: 12)

async function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export async function startMoto({ python = process.env.VALIDA_TEST_MOTO_PYTHON, port } = {}) {
  if (!python) {
    throw new Error('VALIDA_TEST_MOTO_PYTHON is not set: point it at a Python with moto[server] installed (backend/README.md, "S3-compatible storage (C6-T4)")');
  }
  const chosen = port ?? (await freePort());
  const child = spawn(python, ['-m', 'moto.server', '-H', '127.0.0.1', '-p', String(chosen)], {
    env: { ...process.env, INITIAL_NO_AUTH_ACTION_COUNT: String(SETUP_ACTIONS), MOTO_ALLOW_NONEXISTENT_REGION: 'false' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const endpoint = `http://127.0.0.1:${chosen}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    const up = await new Promise((resolve) => {
      const socket = net.connect({ port: chosen, host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (up) break;
    if (child.exitCode !== null || Date.now() > deadline) throw new Error(`moto server did not start: ${stderr.slice(-500)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const setupScript = new URL('./moto_setup.py', import.meta.url).pathname;
  const out = execFileSync(python, [setupScript, endpoint], { encoding: 'utf8' });
  const setup = JSON.parse(out.trim().split('\n').pop());
  return {
    endpoint,
    port: chosen,
    ...setup,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      }),
  };
}
