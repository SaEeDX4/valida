#!/usr/bin/env node
/**
 * C6-T6 — the read-only review-host checker (ops/review-host/check.mjs),
 * exercised against the ACTUAL local stack.
 *
 *   MONGODB_TEST_URI=mongodb://127.0.0.1:27017/valida_test_c6t6_checker \
 *     node c6/c6-t6-review-checker.mjs --out <evidence directory>
 *
 * The real API and document server over a real production build, a
 * disposable database and synthetic Jobs; the checker runs as the owner
 * would run it, as a separate process, with `--allow-loopback-http` (the
 * only difference from a hosted run, stated in every result it writes).
 *
 * The client address on loopback is 127.0.0.1. "Listed" and "unlisted" are
 * therefore produced by the allowlist: 127.0.0.1/32 (listed) or a
 * documentation range (unlisted).
 *
 *   C1  Review-like, listed, correct SHA: every automated row passes except
 *       R6 — this document server does not compress (the host's edge must;
 *       plan §13). That FAIL is the expected, honest local result.
 *   C2  Review-like, unlisted, with spoofing: R0.3, R0.4, R0.8, R11, R14 pass.
 *   C3  A missing SHA argument: refused, exit 2.
 *   C4  A mismatched SHA: R14 FAILS (exit 1).
 *   C5  Services that state no release: R14 FAILS.
 *   C6  A misconfigured Review (SITE_ACCESS public) seen from an unlisted
 *       network: R0.3 FAILS — the checker detects the wrong access response.
 *   C7  The same, from a listed machine: R7 FAILS — the checker detects the
 *       wrong cache response (no-cache documents, immutable assets).
 *   C8  Production-like (public site, testers): the accepted T2 cache
 *       contract — R7 passes (Jobs API no-store without validators; Careers,
 *       Job, Apply private, no-store; assets one year immutable).
 *   C9  Production-like from an unlisted network: R0.3 passes (empty list,
 *       no audience header).
 *   K1  No service key in any evidence file.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { checkTestDatabaseTarget } from '../../backend/scripts/test-database.mjs';
import { BACKEND_DIR, FIXTURES_DIR, FRONTEND_DIR, REPO_ROOT } from '../support/paths.js';
import { baseEnvironment, runNode, startNode, stopChild, waitForHttp, waitForReadyLine } from '../support/processes.js';

const { values: args } = parseArgs({ options: { label: { type: 'string', default: 'run' }, out: { type: 'string' } } });
const OUT = path.resolve(args.out ?? path.join(os.tmpdir(), `valida-c6-t6-checker-${args.label}`));
for (const dir of ['logs', 'runs']) mkdirSync(path.join(OUT, dir), { recursive: true });
const guard = checkTestDatabaseTarget({ env: process.env, dotEnvPath: null });
if (!guard.ok) {
  console.error(`refused: ${guard.reason}`);
  process.exit(2);
}
const MONGODB_URI = guard.uri;
const HEAD = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const RELEASE = process.env.C6T6_RELEASE ?? HEAD;
const OTHER = 'f'.repeat(40) === RELEASE ? 'e'.repeat(40) : 'f'.repeat(40);
const BASE = Number(process.env.C6T6_CHECKER_BASE_PORT ?? 4420);
const API = `http://127.0.0.1:${BASE}`;
const SITE = `http://127.0.0.1:${BASE + 1}`;
const KEY = `qa-c6t6-${randomBytes(24).toString('hex')}`;
const LISTED = '127.0.0.1/32';
const UNLISTED = '203.0.113.0/24';
const CHECKER = path.join(REPO_ROOT, 'ops', 'review-host', 'check.mjs');

const results = [];
function check(id, description, expected, actual, pass) {
  results.push({ id, description, expected, actual: JSON.stringify(actual).split(KEY).join('[KEY]'), pass: Boolean(pass) });
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${description}\n`);
}

const children = new Set();
const launcher = fileURLToPath(new URL('../support/backendLauncher.mjs', import.meta.url));
const serve = path.join(FRONTEND_DIR, 'server', 'serve.mjs');
async function stack(label, { site, allowlist, release = RELEASE, mode = 'testers' }) {
  const common = { ...baseEnvironment(), APP_ENV: 'local', SITE_ACCESS: site, ACCESS_ALLOWLIST: allowlist, ...(release ? { RENDER_GIT_COMMIT: release } : {}), INTERNAL_SERVICE_KEY: KEY };
  const api = startNode([launcher], { cwd: BACKEND_DIR, env: { ...common, NODE_ENV: 'development', PORT: String(BASE), LOG_LEVEL: 'info', MONGODB_URI, CORS_ALLOWED_ORIGINS: SITE, TRANSACTIONAL_EMAIL_PROVIDER: 'none', RECRUITMENT_MODE: mode }, logFile: path.join(OUT, 'logs', `api-${label}.log`) });
  children.add(api);
  await waitForReadyLine(api, { label: `api ${label}`, timeoutMs: 60_000 });
  await waitForHttp(`${API}/api/v1/health`, { child: api, label: 'api' });
  const documents = startNode([serve, '--dist', DIST, '--host', '127.0.0.1', '--port', String(BASE + 1), '--api-origin', API], { cwd: FRONTEND_DIR, env: common, logFile: path.join(OUT, 'logs', `documents-${label}.log`) });
  children.add(documents);
  await waitForReadyLine(documents, { label: `documents ${label}` });
  return async () => {
    for (const child of [documents, api]) {
      await stopChild(child);
      children.delete(child);
    }
  };
}
async function runChecker(label, extra) {
  const out = path.join(OUT, 'runs', label);
  const argv = [CHECKER, '--site', SITE, '--api', API, '--allow-loopback-http', '--out', out, ...extra];
  const r = await runNode(argv, { cwd: path.join(REPO_ROOT, 'ops', 'review-host'), env: { ...baseEnvironment(), ...(process.env.PLAYWRIGHT_BROWSERS_PATH ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {}) }, logFile: path.join(OUT, 'logs', `checker-${label}.log`), label: `checker ${label}`, timeoutMs: 300_000 });
  let summary = null;
  try {
    summary = JSON.parse(readFileSync(path.join(out, 'summary.json'), 'utf8'));
  } catch {
    summary = null;
  }
  const byId = Object.fromEntries((summary?.results ?? []).map((x) => [x.id, x.result]));
  return { code: r.code, stderr: r.stderr, summary, byId, detail: (id) => JSON.parse(readFileSync(path.join(out, 'results', `${id}.json`), 'utf8')) };
}
const job = ['--job', 'qa-c4-open-remote', '--closed-job', 'qa-c4-retained-closed'];

let DIST;
let mongoose;
try {
  const backendRequire = createRequire(path.join(BACKEND_DIR, 'package.json'));
  mongoose = backendRequire('mongoose');
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  if (mongoose.connection.db.databaseName !== guard.databaseName) throw new Error('unexpected database');
  await mongoose.connection.db.dropDatabase();
  const scriptEnv = { ...baseEnvironment(), APP_ENV: 'local', NODE_ENV: 'development', MONGODB_URI };
  for (const step of [['scripts/db-indexes.mjs', 'apply'], ...[['qa-c4-open-remote.json', true], ['qa-c4-retained-closed.json', true], ['qa-c4-retained-closed.closed.json', true]].map(([f, c]) => ['scripts/provision-job.mjs', 'apply', '--file', path.join(FIXTURES_DIR, 'seo-jobs', f), ...(c ? ['--confirm-lifecycle'] : [])])]) {
    const r = await runNode(step, { cwd: BACKEND_DIR, env: scriptEnv, logFile: path.join(OUT, 'logs', 'setup.log'), label: step.join(' ') });
    if (r.code !== 0) throw new Error(`setup failed: ${step.join(' ')}`);
  }
  DIST = path.join(mkdtempSync(path.join(os.tmpdir(), 'valida-c6t6-build-')), 'dist');
  const vite = path.join(FRONTEND_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  const build = await runNode([vite, 'build', '--outDir', DIST], { cwd: FRONTEND_DIR, env: { ...baseEnvironment(), VITE_API_BASE_URL: API }, logFile: path.join(OUT, 'logs', 'build.log'), label: 'build' });
  if (build.code !== 0) throw new Error('build failed');

  // C1–C4: a Review-like stack, listed.
  let down = await stack('review-listed', { site: 'private', allowlist: LISTED });
  const c1 = await runChecker('C1-review-listed', ['--sha', RELEASE, '--mode', 'review', '--perspective', 'listed', ...job]);
  const expectedFails = Object.entries(c1.byId).filter(([, r]) => r === 'FAIL').map(([id]) => id);
  check('C1', 'Review-like, listed, the right SHA: every automated row passes except R6 (this document server does not compress; the host edge must)', 'FAIL only [R6]; R0.5 R1 R2 R3 R4 R5 R7 R8 R9 R0.8 R11 R14 PASS', c1.byId, JSON.stringify(expectedFails) === JSON.stringify(['R6']) && ['R0.5', 'R1', 'R2', 'R3', 'R4', 'R5', 'R7', 'R8', 'R9', 'R0.8', 'R11', 'R14'].every((id) => c1.byId[id] === 'PASS'));
  const c3 = await runChecker('C3-missing-sha', ['--mode', 'review', '--perspective', 'listed', ...job]);
  check('C3', 'A run without the expected release SHA is refused before any request', 'exit 2; "--sha is required"', { code: c3.code, stderr: c3.stderr.trim() }, c3.code === 2 && /--sha is required/.test(c3.stderr) && c3.summary === null);
  const c4 = await runChecker('C4-mismatched-sha', ['--sha', OTHER, '--mode', 'review', '--perspective', 'listed', '--no-browser', ...job]);
  check('C4', 'A mismatched SHA: R14 FAILS and the run exits 1', 'R14 FAIL; observed release ≠ expected', { code: c4.code, R14: c4.byId.R14, observed: c4.detail('R14').observed }, c4.code === 1 && c4.byId.R14 === 'FAIL' && c4.detail('R14').observed.site[0] === RELEASE);
  await down();

  // C2: the same Review-like stack, unlisted, with spoofing.
  down = await stack('review-unlisted', { site: 'private', allowlist: UNLISTED });
  const c2 = await runChecker('C2-review-unlisted', ['--sha', RELEASE, '--mode', 'review', '--perspective', 'unlisted', '--listed-sample', '203.0.113.7', ...job]);
  check('C2', 'Review-like, unlisted (with forwarding-header and delegation-header spoofing): R0.3, R0.4, R0.8, R11, R14 pass', 'all PASS; exit 0', c2.byId, c2.code === 0 && ['R0.3', 'R0.4', 'R0.8', 'R11', 'R14'].every((id) => c2.byId[id] === 'PASS'));
  const leakedSample = readdirSync(path.join(OUT, 'runs', 'C2-review-unlisted', 'results')).some((f) => readFileSync(path.join(OUT, 'runs', 'C2-review-unlisted', 'results', f), 'utf8').includes('203.0.113.7'));
  check('C2b', 'The listed address used for spoofing is not written to the results', 'absent', { leaked: leakedSample }, !leakedSample);
  await down();

  // C5: services that state no release.
  down = await stack('no-release', { site: 'private', allowlist: LISTED, release: null });
  const c5 = await runChecker('C5-no-release', ['--sha', RELEASE, '--mode', 'review', '--perspective', 'listed', '--no-browser', ...job]);
  check('C5', 'Services that send no X-Valida-Release: R14 FAILS', 'R14 FAIL; observed [null]', { R14: c5.byId.R14, observed: c5.detail('R14').observed }, c5.byId.R14 === 'FAIL' && c5.detail('R14').observed.site[0] === null);
  await down();

  // C6–C7: a misconfigured Review: SITE_ACCESS public.
  down = await stack('review-misconfigured', { site: 'public', allowlist: UNLISTED });
  const c6 = await runChecker('C6-misconfigured-unlisted', ['--sha', RELEASE, '--mode', 'review', '--perspective', 'unlisted', '--listed-sample', '203.0.113.7', '--no-browser', ...job]);
  check('C6', 'Wrong ACCESS response detected: a Review served publicly, seen from an unlisted network — R0.3 FAILS (pages 200, not 403)', 'R0.3 FAIL; exit 1', { R0_3: c6.byId['R0.3'], statuses: c6.detail('R0.3').observed.site.map((s) => s.status) }, c6.code === 1 && c6.byId['R0.3'] === 'FAIL' && c6.detail('R0.3').observed.site.some((s) => s.status === 200));
  await down();
  down = await stack('review-misconfigured-listed', { site: 'public', allowlist: LISTED });
  const c7 = await runChecker('C7-misconfigured-listed', ['--sha', RELEASE, '--mode', 'review', '--perspective', 'listed', '--no-browser', ...job]);
  const c7rows = c7.detail('R7').observed.filter((row) => !row.pass);
  check('C7', 'Wrong CACHE response detected: the same misconfigured Review from a listed machine — R7 FAILS (documents no-cache, assets immutable instead of private, no-store)', 'R7 FAIL; failing rows include no-cache and immutable', { R7: c7.byId.R7, failing: c7rows.slice(0, 6) }, c7.byId.R7 === 'FAIL' && c7rows.some((r) => r.cacheControl === 'no-cache') && c7rows.some((r) => /immutable/.test(r.cacheControl ?? '')));

  // C8–C9: production-like (public site, recruitment testers) — the accepted T2 cache contract.
  const c8 = await runChecker('C8-production-listed', ['--sha', RELEASE, '--mode', 'production', '--perspective', 'listed', ...job]);
  check('C8', 'Production-like, listed: R7 passes on the accepted T2 contract (Jobs API no-store without validators; Careers, Job, Apply private, no-store; assets one year immutable); R0.5, R1, R5, R8, R14 pass', 'R7 PASS (and the rows named)', c8.byId, ['R0.5', 'R1', 'R5', 'R7', 'R8', 'R14'].every((id) => c8.byId[id] === 'PASS'));
  await down();
  down = await stack('production-unlisted', { site: 'public', allowlist: UNLISTED });
  const c9 = await runChecker('C9-production-unlisted', ['--sha', RELEASE, '--mode', 'production', '--perspective', 'unlisted', '--listed-sample', '203.0.113.7', ...job]);
  check('C9', 'Production-like, unlisted: R0.3 and R0.4 pass (an empty Jobs list, a Job answers 404, no audience header, whatever headers are spoofed)', 'R0.3 PASS; R0.4 PASS', c9.byId, c9.byId['R0.3'] === 'PASS' && c9.byId['R0.4'] === 'PASS' && c9.byId.R14 === 'PASS');
  await down();
} catch (error) {
  check('RUN', 'The exercise ran to completion', 'no exception', `${error?.name}: ${error?.message}`, false);
} finally {
  for (const child of [...children]) await stopChild(child);
  await mongoose?.disconnect().catch(() => {});
}

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
};
walk(OUT);
const leaks = files.filter((f) => readFileSync(f, 'utf8').includes(KEY));
check('K1', 'No service key in any evidence file', '0 files', { files: files.length, leaks: leaks.map((f) => path.relative(OUT, f)) }, leaks.length === 0);
writeFileSync(path.join(OUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
const failed = results.filter((r) => !r.pass);
process.stdout.write(`\n${results.length - failed.length}/${results.length} passed\n`);
process.exit(failed.length ? 1 : 0);
