import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

/**
 * Child-process helpers for the E2E stack. Node itself runs every child
 * (process.execPath + a script path): no shell, no npm, so the same code
 * works on Windows and Linux and no command line is ever interpreted.
 */

/**
 * The environment a child starts from: only what the operating system and
 * Node need to run. NOTHING else is inherited — not MONGODB_URI, not an SMTP
 * password, not a VITE_* value from the developer's shell — so a child sees
 * exactly the configuration the run sets and nothing it might pick up by
 * accident. (The backend children are also started without --env-file, so
 * backend/.env is never read.)
 */
const INHERITED = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR', 'ComSpec', 'COMSPEC',
  'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'TZ',
];
export function baseEnvironment() {
  const env = {};
  for (const name of INHERITED) if (process.env[name] !== undefined) env[name] = process.env[name];
  return env;
}

/** Runs a Node script to completion; its output goes to `logFile` (appended) and is returned. */
export function runNode(args, { cwd, env, logFile, label, timeoutMs = 120_000 }) {
  return new Promise((resolve, reject) => {
    const log = logFile ? createWriteStream(logFile, { flags: 'a' }) : null;
    log?.write(`\n=== ${label ?? args.join(' ')} (${new Date().toISOString()})\n`);
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      log?.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      log?.write(chunk);
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${label ?? 'child'} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      log?.write(`=== exit ${code}\n`);
      log?.end();
      resolve({ code, stdout, stderr });
    });
  });
}

/** Starts a long-running Node child whose output is appended to `logFile`. */
export function startNode(args, { cwd, env, logFile }) {
  const log = createWriteStream(logFile, { flags: 'a' });
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.on('close', () => log.end());
  return child;
}

/** Resolves with the JSON after "READY " on the child's stdout. */
export function waitForReadyLine(child, { timeoutMs = 20_000, label = 'child' } = {}) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`${label} did not report READY within ${timeoutMs} ms`)), timeoutMs);
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const match = /READY (\{.*\})/.exec(buffer);
      if (match) {
        clearTimeout(timer);
        resolve(JSON.parse(match[1]));
      }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      reject(new Error(`${label} exited (code ${code}) before it was ready`));
    });
  });
}

/** Polls `url` until it answers 200 (or the child exits, or time runs out). */
export async function waitForHttp(url, { child, timeoutMs = 30_000, label = url } = {}) {
  const deadline = Date.now() + timeoutMs;
  let exited = null;
  child?.on('close', (code) => {
    exited = code;
  });
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`${label} exited (code ${exited}) before answering`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${label} did not answer 200 within ${timeoutMs} ms`);
}

/** Stops a child and waits for it to exit (bounded). */
export async function stopChild(child, { timeoutMs = 10_000 } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, timeoutMs);
    child.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}
