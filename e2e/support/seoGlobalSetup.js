import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTestDatabaseTarget } from '../../backend/scripts/test-database.mjs';
import { BACKEND_DIR, FIXTURES_DIR, FRONTEND_DIR, REPO_ROOT } from './paths.js';
import { RunDirectoryRefused, createRunSubdirectories, verifyRunDirectory } from './runDirectory.js';
import { loopbackProblem, reachFromOtherInterfaces } from './loopback.js';
import { baseEnvironment, runNode, startNode, stopChild, waitForHttp, waitForReadyLine } from './processes.js';
import {
  SEO_BACKEND_ORIGIN, SEO_BACKEND_PORT, SEO_INDEXED_ORIGIN, SEO_INDEXED_PORT, SEO_REVIEW_ORIGIN, SEO_REVIEW_PORT,
  SEO_SITE_URL, seoBackendEnvironment,
} from './seoStack.js';

/**
 * Starts the C4 SEO stack, once per run (playwright.seo.config.js):
 *
 *   1. refuses unless MONGODB_TEST_URI names a disposable database
 *      (backend/scripts/test-database.mjs), then drops it;
 *   2. applies the indexes and provisions the synthetic C4 Jobs through the
 *      backend's own CLI (fixtures/seo-jobs): an open remote Job, an open hybrid
 *      Job, a retained closed Job (published, then closed), a Draft, an
 *      Archived Job (created as Draft, then archived) and the "lifecycle" Job
 *      the cases close and archive during the run; and, for OD-2026-11-09-02,
 *      an open remote Job with two explicit eligible countries, an otherwise
 *      identical one without the key, one the cases update and clear, and a
 *      retained closed Job with a list;
 *   3. builds the frontend twice into NEW, empty directories of the run:
 *      dist/ (indexed: VITE_ALLOW_INDEXING=true, VITE_PUBLIC_SITE_URL) and
 *      dist-review/ (no SEO variables). NODE_ENV and APP_ENV are not inherited;
 *   4. starts the real backend on 127.0.0.1 (support/backendLauncher.mjs) and
 *      checks the address it actually listens on, then starts one C4 document
 *      server (frontend/server/serve.mjs) per build, also on 127.0.0.1, and
 *      checks theirs.
 *
 * The run directory is the C3 one (support/runDirectory.js): new, exclusive,
 * outside the repository. Returns the teardown; the evidence is kept.
 */

const SETUP_STEPS = Object.freeze([
  // [file, needs --confirm-lifecycle]
  ['qa-c4-open-remote.json', true],
  ['qa-c4-open-hybrid.json', true],
  ['qa-c4-retained-closed.json', true],
  ['qa-c4-retained-closed.closed.json', true],
  ['qa-c4-draft.json', false],
  ['qa-c4-archived.json', false],
  ['qa-c4-archived.archived.json', true],
  ['qa-c4-lifecycle.json', true],
  // OD-2026-11-09-02 — eligible remote-work countries (synthetic test values).
  ['qa-c4-open-eligible.json', true],
  ['qa-c4-open-eligible-omitted.json', true],
  ['qa-c4-eligibility-updates.json', true],
  ['qa-c4-closed-eligible.json', true],
  ['qa-c4-closed-eligible.closed.json', true],
]);

export default async function seoGlobalSetup() {
  const guard = checkTestDatabaseTarget({ env: process.env });
  if (!guard.ok) throw new Error(`E2E refused: ${guard.reason}`);

  const runDir = verifyRunDirectory({ repoRoot: REPO_ROOT });
  const dirs = createRunSubdirectories(runDir);
  // The review build gets its own NEW directory, created exclusively like the others.
  dirs.distReview = path.join(runDir, 'dist-review');
  mkdirSync(dirs.distReview);
  const setupLog = path.join(dirs.logs, 'setup.log');

  const { MongoClient } = createRequire(path.join(BACKEND_DIR, 'package.json'))('mongodb');
  const client = await MongoClient.connect(guard.uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    await client.db(guard.databaseName).dropDatabase();
  } finally {
    await client.close();
  }

  const fixtureDir = path.join(FIXTURES_DIR, 'seo-jobs');
  const jobs = Object.fromEntries(
    readdirSync(fixtureDir)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => {
        const definition = JSON.parse(readFileSync(path.join(fixtureDir, name), 'utf8'));
        return [name.replace(/\.json$/, ''), { file: path.join(fixtureDir, name), slug: definition.slug, status: definition.status, title: definition.title }];
      }),
  );

  const run = {
    runId: process.env.E2E_RUN_ID,
    kind: 'c4-seo',
    startedAt: new Date().toISOString(),
    git: gitState(),
    backendOrigin: SEO_BACKEND_ORIGIN,
    indexedOrigin: SEO_INDEXED_ORIGIN,
    reviewOrigin: SEO_REVIEW_ORIGIN,
    siteUrl: SEO_SITE_URL,
    databaseName: guard.databaseName,
    dirs,
    jobs,
  };
  writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run, null, 2));
  const env = seoBackendEnvironment({ storageRoot: dirs.storage });

  const children = [];
  const teardown = async () => {
    for (const child of children.reverse()) await stopChild(child);
  };

  try {
    const step = async (label, args) => {
      const result = await runNode(args, { cwd: BACKEND_DIR, env, logFile: setupLog, label });
      if (result.code !== 0) throw new Error(`SEO E2E setup step failed: ${label} (exit ${result.code}); see logs/setup.log`);
      return result;
    };
    await step('db:indexes:apply', ['scripts/db-indexes.mjs', 'apply']);
    for (const [name, confirm] of SETUP_STEPS) {
      await step(`jobs:provision:apply ${name}`, ['scripts/provision-job.mjs', 'apply', '--file', path.join(fixtureDir, name), ...(confirm ? ['--confirm-lifecycle'] : [])]);
    }

    const vite = path.join(FRONTEND_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
    for (const [label, outDir, seoEnv] of [
      ['vite build (indexed)', dirs.dist, { VITE_ALLOW_INDEXING: 'true', VITE_PUBLIC_SITE_URL: SEO_SITE_URL }],
      ['vite build (review)', dirs.distReview, {}],
    ]) {
      if (readdirSync(outDir).length) throw new RunDirectoryRefused(`${path.basename(outDir)}/ is not empty before the build.`);
      const build = await runNode([vite, 'build', '--outDir', outDir], {
        cwd: FRONTEND_DIR,
        env: { ...baseEnvironment(), VITE_API_BASE_URL: SEO_BACKEND_ORIGIN, ...seoEnv },
        logFile: path.join(dirs.logs, 'build.log'),
        label,
      });
      if (build.code !== 0) throw new Error(`SEO E2E setup: ${label} failed; see logs/build.log`);
    }

    const launcher = fileURLToPath(new URL('./backendLauncher.mjs', import.meta.url));
    const backend = startNode([launcher], { cwd: BACKEND_DIR, env, logFile: path.join(dirs.logs, 'backend.log') });
    children.push(backend);
    const listening = await waitForReadyLine(backend, { label: 'backend', timeoutMs: 60_000 });
    const problem = loopbackProblem(listening, SEO_BACKEND_PORT);
    if (problem) throw new Error(`E2E refused: ${problem}.`);
    await waitForHttp(`${SEO_BACKEND_ORIGIN}/api/v1/health`, { child: backend, label: 'backend' });
    run.backendListening = { ...listening, otherInterfaces: await reachFromOtherInterfaces(SEO_BACKEND_PORT) };

    const serve = path.join(FRONTEND_DIR, 'server', 'serve.mjs');
    run.documentServers = {};
    for (const [name, outDir, port] of [['indexed', dirs.dist, SEO_INDEXED_PORT], ['review', dirs.distReview, SEO_REVIEW_PORT]]) {
      const child = startNode([serve, '--dist', outDir, '--host', '127.0.0.1', '--port', String(port), '--api-origin', SEO_BACKEND_ORIGIN], {
        cwd: FRONTEND_DIR,
        env: baseEnvironment(),
        logFile: path.join(dirs.logs, `documents-${name}.log`),
      });
      children.push(child);
      const ready = await waitForReadyLine(child, { label: `document server (${name})` });
      const serverProblem = loopbackProblem(ready, port);
      if (serverProblem) throw new Error(`E2E refused: document server (${name}): ${serverProblem.replace('the backend', 'it')}.`);
      run.documentServers[name] = { ...ready, otherInterfaces: await reachFromOtherInterfaces(port) };
      await waitForHttp(`http://127.0.0.1:${port}/robots.txt`, { child, label: `document server (${name})` });
    }
    writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run, null, 2));
    console.log(`\nC4 SEO stack ready. Run directory (evidence, logs): ${runDir}\n`);
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}

function gitState() {
  try {
    const head = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const status = execFileSync('git', ['-C', REPO_ROOT, 'status', '--porcelain'], { encoding: 'utf8' });
    return { head, uncommittedEntries: status.split('\n').filter(Boolean).length };
  } catch {
    return null;
  }
}
