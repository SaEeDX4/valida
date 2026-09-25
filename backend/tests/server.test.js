import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { startServer, isMainModule } from '../src/server.js';
import { createApp } from '../src/app.js';
import { freePort } from './helpers.js';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Startup, listening and graceful shutdown — Doc 09 section 8, Doc 15.
 *
 * startServer returns handles instead of calling process.exit, so a real
 * server can be started and stopped inside the test runner without killing it.
 * Signal wiring lives in installSignalHandlers and is deliberately not invoked
 * here — registering global SIGINT handlers from a test would be unsafe.
 */
const started = [];

async function start(overrides = {}) {
  const port = await freePort();
  const handle = await startServer({
    env: {
      NODE_ENV: 'test',
      APP_ENV: 'local',
      PORT: String(port),
      LOG_LEVEL: 'silent',
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
      ...overrides,
    },
  });
  started.push(handle);
  return { ...handle, port };
}

afterEach(async () => {
  while (started.length) {
    const handle = started.pop();
    await handle.shutdown('test cleanup');
  }
});

describe('app factory', () => {
  it('builds an app without opening a socket', () => {
    const app = createApp();
    expect(typeof app).toBe('function');
    // An Express app is a request handler, not a server: no listening side effect.
    expect(app.listen).toBeTypeOf('function');
    expect(app.address).toBeUndefined();
  });
});

describe('startServer', () => {
  it('listens and serves health on the configured port', async () => {
    const { server, port } = await start();
    expect(server.listening).toBe(true);
    expect(server.address().port).toBe(port);

    const response = await request(`http://127.0.0.1:${port}`).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ok');
  });

  it('marks configuration ready but not the unimplemented dependencies', async () => {
    const { readiness } = await start();
    const state = readiness.describe();
    expect(state.dependencies.find((d) => d.name === 'configuration').state).toBe('ready');
    ['database', 'resumeStorage', 'notifications'].forEach((name) => {
      expect(state.dependencies.find((d) => d.name === name).state).toBe('not_implemented');
    });
    expect(readiness.isReady()).toBe(false);
  });

  it('serves a truthful 503 readiness at the B1 baseline', async () => {
    const { port } = await start();
    const response = await request(`http://127.0.0.1:${port}`).get('/api/v1/health/ready');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('refuses to start on invalid configuration', async () => {
    await expect(
      startServer({ env: { APP_ENV: 'production', NODE_ENV: 'production' } }),
    ).rejects.toThrow(/CORS_ALLOWED_ORIGINS: is required when APP_ENV=production/);
  });

  it('rejects rather than leaving a half-started process when the port is taken', async () => {
    const { port } = await start();
    await expect(start({ PORT: String(port) })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    // The failed attempt registered nothing to clean up.
    started.pop();
  });
});

describe('graceful shutdown', () => {
  it('marks readiness unavailable before closing', async () => {
    const { readiness, shutdown } = await start();
    expect(readiness.isShuttingDown).toBe(false);

    const shutdownPromise = shutdown('SIGTERM');
    // Readiness flips first, so a load balancer stops sending new work before
    // the socket goes away.
    expect(readiness.isShuttingDown).toBe(true);
    expect(readiness.isReady()).toBe(false);

    await shutdownPromise;
    started.pop();
  });

  it('closes the HTTP server', async () => {
    const { server, shutdown } = await start();
    expect(server.listening).toBe(true);
    await shutdown('SIGTERM');
    expect(server.listening).toBe(false);
    started.pop();
  });

  it('stops answering after shutdown', async () => {
    const { port, shutdown } = await start();
    await shutdown('SIGTERM');
    started.pop();
    await expect(request(`http://127.0.0.1:${port}`).get('/api/v1/health')).rejects.toThrow();
  });

  it('is idempotent', async () => {
    const { shutdown } = await start();
    await shutdown('first');
    await expect(shutdown('second')).resolves.toBeUndefined();
    started.pop();
  });

  it('does not terminate the test process', async () => {
    // startServer must never call process.exit: that is the caller's decision,
    // wired only in installSignalHandlers for a real process.
    const { shutdown } = await start();
    await shutdown('SIGTERM');
    started.pop();
    expect(process.exitCode).toBeUndefined();
  });
});


describe('direct-run detection', () => {
  /*
   * The entry-point check compares a FILE URL with a FILESYSTEM PATH, so the
   * conversion has to be platform-correct. The previous `file://${argv[1]}`
   * template happened to match on POSIX but never on Windows, where argv[1] is
   * C:\\...\\server.js: the naive form yields "file://C:\\..." against a real
   * URL of "file:///C:/.../server.js". `npm start` therefore started nothing.
   */
  const serverPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.js');
  const serverUrl = pathToFileURL(serverPath).href;

  it('recognises the module when it is the entry point', () => {
    expect(isMainModule(serverUrl, serverPath)).toBe(true);
  });

  it('does not recognise a different entry point', () => {
    expect(isMainModule(serverUrl, join(dirname(serverPath), 'app.js'))).toBe(false);
  });

  it('returns false when there is no entry path, as when imported', () => {
    expect(isMainModule(serverUrl, undefined)).toBe(false);
    expect(isMainModule(serverUrl, '')).toBe(false);
  });

  it('handles an entry path containing characters that need encoding', () => {
    // A checkout under "C:\\My Projects\\..." or "/home/a b/" must still match.
    const spaced = join(dirname(serverPath), 'a b', 'server.js');
    expect(isMainModule(pathToFileURL(spaced).href, spaced)).toBe(true);
    // The naive template would not have matched this.
    expect(pathToFileURL(spaced).href).not.toBe(`file://${spaced}`);
  });

  it('is not fooled by a path that merely looks similar', () => {
    expect(isMainModule(serverUrl, `${serverPath}.bak`)).toBe(false);
  });
});

describe('running the module directly', () => {
  /** Runs a command and resolves with its combined output once it exits. */
  const run = (args, env) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, args, {
        cwd: join(dirname(fileURLToPath(import.meta.url)), '..'),
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      // Give it time to bind, then stop it.
      const timer = setTimeout(() => child.kill('SIGTERM'), 1500);
      child.on('exit', () => {
        clearTimeout(timer);
        resolve(output);
      });
    });

  it('starts listening when executed as a script', async () => {
    const port = await freePort();
    const output = await run(['src/server.js'], {
      PORT: String(port),
      LOG_LEVEL: 'info',
      APP_ENV: 'local',
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
    });
    // This is the regression that matters: `npm start` must actually start.
    expect(output).toMatch(/backend listening/);
    expect(output).toMatch(new RegExp(`"port":${port}`));
  }, 15_000);

  it('starts nothing when the module is merely imported', async () => {
    const output = await run(['--input-type=module', '-e', "await import('./src/server.js');"], {
      PORT: '4999',
      APP_ENV: 'local',
      CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
    });
    expect(output).not.toMatch(/backend listening/);
  }, 15_000);
});


describe('startup failure output never leaks values (correction cycle 2, finding 2)', () => {
  const SECRET = 'https://user:s3cr3t@example.com/path?token=AKIAEXAMPLE';

  /** Runs the server as a real process and returns its combined output. */
  const runToExit = (env) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, ['src/server.js'], {
        cwd: join(dirname(fileURLToPath(import.meta.url)), '..'),
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      const timer = setTimeout(() => child.kill('SIGTERM'), 4000);
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ output, code });
      });
    });

  it('prints the variable and rule but never the rejected value', async () => {
    const { output, code } = await runToExit({
      APP_ENV: 'production',
      NODE_ENV: 'production',
      PORT: '4318',
      CORS_ALLOWED_ORIGINS: SECRET,
    });

    expect(code).toBe(1);
    // Useful: which variable, and what the rule is.
    expect(output).toMatch(/CORS_ALLOWED_ORIGINS/);
    expect(output).toMatch(/canonical origin/);
    // Never the value.
    [/s3cr3t/, /AKIAEXAMPLE/, /user:/, /token=/, /example\.com/].forEach((pattern) =>
      expect(output, `leaked ${pattern}`).not.toMatch(pattern),
    );
  }, 20_000);

  it('never prints a raw message or stack for a non-configuration failure', async () => {
    // Occupy a port so the bind fails with a genuine runtime error.
    const port = await freePort();
    const { createServer } = await import('node:net');
    const blocker = createServer();
    await new Promise((resolve) => blocker.listen(port, resolve));

    try {
      const { output, code } = await runToExit({
        APP_ENV: 'local',
        PORT: String(port),
        LOG_LEVEL: 'silent',
        CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
      });

      expect(code).toBe(1);
      // A bounded classification an operator can act on.
      expect(output).toMatch(/failed to start: Error \(EADDRINUSE\)/);
      expect(output).toMatch(/Detail is withheld/);
      // No raw text: Node's message for this is "listen EADDRINUSE: address
      // already in use :::PORT", and a stack would follow.
      expect(output).not.toMatch(/address already in use/);
      expect(output).not.toMatch(/at [A-Za-z]+ \(/);
      expect(output).not.toMatch(/node_modules|\/tmp\/|src\/server\.js:/);
    } finally {
      await new Promise((resolve) => blocker.close(resolve));
    }
  }, 20_000);
});
