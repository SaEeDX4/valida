import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTestDatabaseTarget } from '../../backend/scripts/test-database.mjs';
import { BACKEND_DIR, FRONTEND_DIR, REPO_ROOT } from './paths.js';
import { RunDirectoryRefused, createRunSubdirectories, verifyRunDirectory } from './runDirectory.js';
import { loopbackProblem, reachFromOtherInterfaces } from './loopback.js';
import { baseEnvironment, runNode, startNode, stopChild, waitForHttp, waitForReadyLine } from './processes.js';
import {
  C5_BACKEND_ORIGIN, C5_BACKEND_PORT, C5_LAB_ORIGIN, C5_LAB_PORT, C5_SITE_ORIGIN, C5_SITE_PORT, C5_SITE_URL,
  c5BackendEnvironment,
} from './c5Stack.js';
import { documentServerEnvironment } from './stackConfig.js';

/**
 * Starts the C5 integrated-site stack, once per run (playwright.c5.config.js):
 *
 *   1. refuses unless MONGODB_TEST_URI names a disposable database
 *      (backend/scripts/test-database.mjs), then drops it and applies the
 *      indexes. NO Job is provisioned here: the first case records the EMPTY
 *      Careers state against the real, empty API, then provisions the
 *      synthetic C5 Jobs (fixtures/c5-jobs) through the backend's own CLI;
 *   2. builds the frontend ONCE, as production is built, into the run's new,
 *      empty dist/ (VITE_ALLOW_INDEXING=true, VITE_PUBLIC_SITE_URL, the API
 *      origin). NODE_ENV and APP_ENV are not inherited;
 *   3. starts the real backend on 127.0.0.1 (support/backendLauncher.mjs),
 *      the C4 document server serving that build, and the lab-only
 *      compression proxy in front of it (support/c5LabCompression.mjs); each
 *      reports the address it actually listens on, and each port is checked
 *      to be refused on every other interface.
 *
 * The run directory is the C3 one (support/runDirectory.js): new, exclusive,
 * outside the repository. Returns the teardown; the evidence is kept.
 */
export default async function c5GlobalSetup() {
  const guard = checkTestDatabaseTarget({ env: process.env });
  if (!guard.ok) throw new Error(`E2E refused: ${guard.reason}`);

  const runDir = verifyRunDirectory({ repoRoot: REPO_ROOT });
  const dirs = createRunSubdirectories(runDir);
  const setupLog = path.join(dirs.logs, 'setup.log');

  const { MongoClient } = createRequire(path.join(BACKEND_DIR, 'package.json'))('mongodb');
  const client = await MongoClient.connect(guard.uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    await client.db(guard.databaseName).dropDatabase();
  } finally {
    await client.close();
  }

  const run = {
    runId: process.env.E2E_RUN_ID,
    kind: 'c5-quality',
    startedAt: new Date().toISOString(),
    git: gitState(),
    node: process.version,
    backendOrigin: C5_BACKEND_ORIGIN,
    siteOrigin: C5_SITE_ORIGIN,
    labOrigin: C5_LAB_ORIGIN,
    siteUrl: C5_SITE_URL,
    databaseName: guard.databaseName,
    dirs,
  };
  writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run, null, 2));
  const env = c5BackendEnvironment({ storageRoot: dirs.storage });

  const children = [];
  const teardown = async () => {
    for (const child of children.reverse()) await stopChild(child);
  };

  try {
    const indexes = await runNode(['scripts/db-indexes.mjs', 'apply'], { cwd: BACKEND_DIR, env, logFile: setupLog, label: 'db:indexes:apply' });
    if (indexes.code !== 0) throw new Error('C5 setup step failed: db:indexes:apply; see logs/setup.log');

    if (readdirSync(dirs.dist).length) throw new RunDirectoryRefused('dist/ is not empty before the build.');
    const vite = path.join(FRONTEND_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
    const build = await runNode([vite, 'build', '--outDir', dirs.dist], {
      cwd: FRONTEND_DIR,
      env: { ...baseEnvironment(), VITE_API_BASE_URL: C5_BACKEND_ORIGIN, VITE_ALLOW_INDEXING: 'true', VITE_PUBLIC_SITE_URL: C5_SITE_URL },
      logFile: path.join(dirs.logs, 'build.log'),
      label: 'vite build (production configuration)',
    });
    if (build.code !== 0) throw new Error('C5 setup: vite build failed; see logs/build.log');

    const launcher = fileURLToPath(new URL('./backendLauncher.mjs', import.meta.url));
    const backend = startNode([launcher], { cwd: BACKEND_DIR, env, logFile: path.join(dirs.logs, 'backend.log') });
    children.push(backend);
    const listening = await waitForReadyLine(backend, { label: 'backend', timeoutMs: 60_000 });
    const problem = loopbackProblem(listening, C5_BACKEND_PORT);
    if (problem) throw new Error(`E2E refused: ${problem}.`);
    await waitForHttp(`${C5_BACKEND_ORIGIN}/api/v1/health`, { child: backend, label: 'backend' });
    run.backendListening = { ...listening, otherInterfaces: await reachFromOtherInterfaces(C5_BACKEND_PORT) };

    const serve = path.join(FRONTEND_DIR, 'server', 'serve.mjs');
    const site = startNode([serve, '--dist', dirs.dist, '--host', '127.0.0.1', '--port', String(C5_SITE_PORT), '--api-origin', C5_BACKEND_ORIGIN,
      // C5_NO_JOB_PRELOAD=1: the comparison run without the Job API preload hint. The lab experiment that injected
      // the link in the proxy (round 2) also runs without the product's own hint, so the two are never doubled.
      ...(process.env.C5_NO_JOB_PRELOAD === '1' || process.env.C5_EXPERIMENT_PRELOAD_JOB_API === '1' ? ['--no-job-preload'] : [])], {
      cwd: FRONTEND_DIR,
      env: documentServerEnvironment(),
      logFile: path.join(dirs.logs, 'documents.log'),
    });
    children.push(site);
    const siteReady = await waitForReadyLine(site, { label: 'document server' });
    const siteProblem = loopbackProblem(siteReady, C5_SITE_PORT);
    if (siteProblem) throw new Error(`E2E refused: document server: ${siteProblem.replace('the backend', 'it')}.`);
    run.documentServer = { ...siteReady, otherInterfaces: await reachFromOtherInterfaces(C5_SITE_PORT) };
    await waitForHttp(`${C5_SITE_ORIGIN}/robots.txt`, { child: site, label: 'document server' });

    const proxyScript = fileURLToPath(new URL('./c5LabCompression.mjs', import.meta.url));
    const labMode = process.env.C5_LAB_COMPRESSION ?? 'precompressed';
    const lab = startNode([proxyScript, '--upstream', C5_SITE_ORIGIN, '--host', '127.0.0.1', '--port', String(C5_LAB_PORT), '--mode', labMode,
      // EXPERIMENT (C5 LCP investigation), off unless asked for: see c5LabCompression.mjs.
      ...(process.env.C5_EXPERIMENT_PRELOAD_JOB_API === '1' ? ['--experiment-preload-job-api', C5_BACKEND_ORIGIN] : [])], {
      cwd: REPO_ROOT,
      env: baseEnvironment(),
      logFile: path.join(dirs.logs, 'lab-compression.log'),
    });
    children.push(lab);
    const labReady = await waitForReadyLine(lab, { label: 'lab compression proxy' });
    const labProblem = loopbackProblem(labReady, C5_LAB_PORT);
    if (labProblem) throw new Error(`E2E refused: lab compression proxy: ${labProblem.replace('the backend', 'it')}.`);
    run.labCompression = { ...labReady, otherInterfaces: await reachFromOtherInterfaces(C5_LAB_PORT) };
    await waitForHttp(`${C5_LAB_ORIGIN}/robots.txt`, { child: lab, label: 'lab compression proxy' });
    // precompressed mode: each fingerprinted script and stylesheet is requested once per encoding now, so no
    // measurement pays for its compression (a host serves these precompressed or from its compressed cache).
    run.labCompression.warmed = [];
    if (labMode === 'precompressed') {
      for (const name of readdirSync(path.join(dirs.dist, 'assets')).filter((f) => /\.(js|css)$/.test(f))) {
        for (const encoding of ['br', 'gzip']) {
          const started = Date.now();
          const response = await fetch(`${C5_LAB_ORIGIN}/assets/${name}`, { headers: { 'Accept-Encoding': encoding } });
          await response.arrayBuffer();
          run.labCompression.warmed.push({ asset: name, encoding, status: response.status, ms: Date.now() - started });
        }
      }
    }

    writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run, null, 2));
    console.log(`\nC5 stack ready. Run directory (evidence, logs): ${runDir}\n`);
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}

function gitState() {
  try {
    const head = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const tree = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
    const status = execFileSync('git', ['-C', REPO_ROOT, 'status', '--porcelain'], { encoding: 'utf8' });
    return { head, tree, uncommittedEntries: status.split('\n').filter(Boolean).length };
  } catch {
    return null;
  }
}
