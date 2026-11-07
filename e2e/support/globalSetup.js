import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTestDatabaseTarget } from '../../backend/scripts/test-database.mjs';
import {
  BACKEND_DIR, BACKEND_ORIGIN, BACKEND_PORT, FIXTURES_DIR, FRONTEND_DIR, FRONTEND_ORIGIN, FRONTEND_PORT, REPO_ROOT,
} from './paths.js';
import { RunDirectoryRefused, createRunSubdirectories, verifyRunDirectory } from './runDirectory.js';
import { loopbackProblem, reachFromOtherInterfaces } from './loopback.js';
import { baseEnvironment, runNode, startNode, stopChild, waitForHttp, waitForReadyLine } from './processes.js';
import { IDENTITY, backendEnvironment } from './stackConfig.js';

/**
 * Starts the whole E2E stack, once per run (Doc 17 section 199: "running
 * frontend; running Express backend; real test MongoDB; real test storage
 * adapter"):
 *
 *   1. refuses unless MONGODB_TEST_URI names an explicitly disposable
 *      database (valida_test or valida_test_<suffix>) — the backend's own
 *      guard, scripts/test-database.mjs — then drops that database;
 *   2. starts the local SMTP test server (support/smtpCapture.mjs);
 *   3. applies the indexes, provisions the synthetic Jobs and registers the
 *      synthetic suppression key — through the backend's own CLIs;
 *   4. builds the frontend for production (vite build, NODE_ENV unset) with
 *      VITE_API_BASE_URL pointing at the backend, into the run's NEW, empty
 *      dist/ (never emptied: nothing else is ever in it);
 *   5. starts the backend bound to 127.0.0.1 (support/backendLauncher.mjs)
 *      and checks the address its socket actually listens on, then starts
 *      `vite preview`.
 *
 * Before step 1, the run directory is verified again (support/runDirectory.js):
 * the configuration created it, new, outside the repository by its canonical
 * location. Its subdirectories are created here, each one exclusively.
 *
 * Returns the teardown. The run directory, with the evidence, is kept.
 */
export default async function globalSetup() {
  const guard = checkTestDatabaseTarget({ env: process.env });
  if (!guard.ok) throw new Error(`E2E refused: ${guard.reason}`);

  const runDir = verifyRunDirectory({ repoRoot: REPO_ROOT });
  const dirs = createRunSubdirectories(runDir);
  const setupLog = path.join(dirs.logs, 'setup.log');

  // Per-run synthetic secrets: environment only, never written down.
  process.env.E2E_SMTP_PASSWORD = randomBytes(18).toString('base64url');
  process.env.E2E_SUPPRESSION_HMAC_KEY = randomBytes(32).toString('base64');

  // 1. -------------------------------------------------- disposable database --
  const { MongoClient } = createRequire(path.join(BACKEND_DIR, 'package.json'))('mongodb');
  const client = await MongoClient.connect(guard.uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    await client.db(guard.databaseName).dropDatabase();
  } finally {
    await client.close();
  }

  // 2. ---------------------------------------------------- SMTP test server --
  const caFile = path.join(dirs.smtp, 'qa-test-ca.pem');
  const smtpChild = startNode([fileURLToPath(new URL('./smtpCapture.mjs', import.meta.url))], {
    cwd: BACKEND_DIR,
    env: {
      ...baseEnvironment(),
      E2E_SMTP_USERNAME: IDENTITY.smtpUsername,
      E2E_SMTP_PASSWORD: process.env.E2E_SMTP_PASSWORD,
      E2E_SMTP_CAPTURE_DIR: dirs.smtp,
      E2E_SMTP_CA_FILE: caFile,
      E2E_SMTP_REJECT_RECIPIENTS: IDENTITY.refusedCandidate,
    },
    logFile: path.join(dirs.logs, 'smtp.log'),
  });
  const children = [smtpChild];
  const teardown = async () => {
    for (const child of children.reverse()) await stopChild(child);
  };

  try {
    const smtp = await waitForReadyLine(smtpChild, { label: 'SMTP test server' });

    const jobFiles = readdirSync(path.join(FIXTURES_DIR, 'jobs')).filter((name) => name.endsWith('.json')).sort();
    const jobs = Object.fromEntries(
      jobFiles.map((name) => {
        const definition = JSON.parse(readFileSync(path.join(FIXTURES_DIR, 'jobs', name), 'utf8'));
        return [name.replace(/\.json$/, ''), { file: path.join(FIXTURES_DIR, 'jobs', name), slug: definition.slug, status: definition.status, title: definition.title }];
      }),
    );

    const run = {
      runId: process.env.E2E_RUN_ID,
      startedAt: new Date().toISOString(),
      git: gitState(),
      frontendOrigin: FRONTEND_ORIGIN,
      backendOrigin: BACKEND_ORIGIN,
      databaseName: guard.databaseName,
      storageRoot: dirs.storage,
      dirs,
      smtp: { port: smtp.port, caFile, captureDir: dirs.smtp, ...IDENTITY },
      jobs,
    };
    writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run, null, 2));
    const env = backendEnvironment({ run });

    // 3. ------------------------------- indexes, Jobs, suppression key (CLIs) --
    const step = async (label, args) => {
      const result = await runNode(args, { cwd: BACKEND_DIR, env, logFile: setupLog, label });
      if (result.code !== 0) throw new Error(`E2E setup step failed: ${label} (exit ${result.code}); see logs/setup.log`);
      return result;
    };
    await step('db:indexes:apply', ['scripts/db-indexes.mjs', 'apply']);
    for (const [name, job] of Object.entries(jobs)) {
      if (name.endsWith('.closed')) continue; // applied by the closed-during-Apply case itself
      await step(`jobs:provision:apply ${name}`, ['scripts/provision-job.mjs', 'apply', '--file', job.file, '--confirm-lifecycle']);
    }
    await step('suppression key-register', ['scripts/ops-notifications-suppression.mjs', 'key-register', '--key-id', IDENTITY.suppressionKeyId, '--apply', '--operator', IDENTITY.suppressionOperator]);
    const coverage = await step('suppression coverage', ['scripts/ops-notifications-suppression.mjs', 'coverage']);
    if (!/COVERAGE_COMPLETE/.test(coverage.stdout)) throw new Error('E2E setup: suppression coverage is not complete after key-register; see logs/setup.log');

    // 4. ------------------------------------------------- production build --
    const vite = path.join(FRONTEND_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
    // dist/ was created empty, above. No --emptyOutDir: the build never deletes anything (C3, GPT finding 1).
    if (readdirSync(dirs.dist).length) throw new RunDirectoryRefused('dist/ is not empty before the build.');
    // NODE_ENV and APP_ENV are not inherited (baseEnvironment): `vite build` is a production build (C1).
    const build = await runNode([vite, 'build', '--outDir', dirs.dist], {
      cwd: FRONTEND_DIR,
      env: { ...baseEnvironment(), VITE_API_BASE_URL: BACKEND_ORIGIN },
      logFile: path.join(dirs.logs, 'build.log'),
      label: 'vite build',
    });
    if (build.code !== 0) throw new Error('E2E setup: the production build failed; see logs/build.log');

    // 5. ------------------------------------------------- backend, preview --
    // The real backend (startServer), bound to 127.0.0.1 with its existing listenHost option (C3, GPT finding 2).
    const launcher = fileURLToPath(new URL('./backendLauncher.mjs', import.meta.url));
    const backend = startNode([launcher], { cwd: BACKEND_DIR, env, logFile: path.join(dirs.logs, 'backend.log') });
    children.push(backend);
    const listening = await waitForReadyLine(backend, { label: 'backend', timeoutMs: 60_000 });
    // What the socket ACTUALLY listens on, reported by the server itself. Nothing proceeds otherwise.
    const problem = loopbackProblem(listening, BACKEND_PORT);
    if (problem) throw new Error(`E2E refused: ${problem}.`);
    const external = await reachFromOtherInterfaces(BACKEND_PORT);
    if (external.some((attempt) => attempt.result === 'connected')) {
      throw new Error(`E2E refused: the backend port answers on a non-loopback address (${JSON.stringify(external)}).`);
    }
    await waitForHttp(`${BACKEND_ORIGIN}/api/v1/health`, { child: backend, label: 'backend' });
    run.backendListening = { ...listening, otherInterfaces: external };
    writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run, null, 2));

    const preview = startNode([vite, 'preview', '--outDir', dirs.dist, '--port', String(FRONTEND_PORT), '--strictPort', '--host', '127.0.0.1'], {
      cwd: FRONTEND_DIR,
      env: baseEnvironment(),
      logFile: path.join(dirs.logs, 'preview.log'),
    });
    children.push(preview);
    await waitForHttp(`${FRONTEND_ORIGIN}/`, { child: preview, label: 'vite preview' });

    console.log(`\nE2E stack ready. Run directory (evidence, logs, storage): ${runDir}\n`);
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}

/** HEAD and whether the working tree is clean — recorded with the evidence; null when git is unavailable. */
function gitState() {
  try {
    const head = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const status = execFileSync('git', ['-C', REPO_ROOT, 'status', '--porcelain'], { encoding: 'utf8' });
    return { head, uncommittedEntries: status.split('\n').filter(Boolean).length };
  } catch {
    return null;
  }
}
