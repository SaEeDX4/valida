/**
 * TEST FIXTURE — one side of the restart-persistence proof.
 *
 * Run as its own Node process by tests/db/restart-persistence.test.js:
 *
 *   node tests/db/fixtures/persistence-child.mjs write <runId>
 *   node tests/db/fixtures/persistence-child.mjs read  <runId> <jobId> <applicationId>
 *
 * It uses the backend's own configuration, connection code, models and
 * services, does its one job and exits.
 *
 * SAFETY. Before connecting, it runs the same fail-closed guard as verify:b2
 * and test:db (scripts/test-database.mjs) on the environment it was launched
 * with, and it connects ONLY to the approved MONGODB_TEST_URI — never to
 * whatever MONGODB_URI happens to say. Run directly with a production or
 * application database, it refuses and exits 2 without connecting. `write` creates synthetic records; `read` only
 * reads — it never recreates or reseeds anything — and prints what it found.
 *
 * Output is a single JSON line of SAFE fields: identifiers, statuses and
 * synthetic values. No connection string is ever printed.
 */
import mongoose from 'mongoose';
import { checkTestDatabaseTarget } from '../../../scripts/test-database.mjs';
import { loadConfig } from '../../../src/config/env.js';
import { createLogger } from '../../../src/lib/logger.js';
import { Readiness } from '../../../src/modules/health/readiness.js';
import { connectDatabase, disconnectDatabase } from '../../../src/db/mongoose.js';
import { Job } from '../../../src/models/Job.js';
import { Application } from '../../../src/models/Application.js';
import { publishJob } from '../../../src/modules/jobs/job.service.js';
import { buildApplication } from '../../../src/modules/applications/application.service.js';

const [mode, runId, jobId, applicationId] = process.argv.slice(2);

const target = checkTestDatabaseTarget({ env: process.env });
if (!target.ok) {
  console.error(`persistence-child refused: ${target.reason}`);
  process.exit(2);
}
// The application configuration, pointed at the approved test database only.
const config = loadConfig({ ...process.env, MONGODB_URI: target.uri });
const logger = createLogger({ level: 'silent' });
const readiness = new Readiness();

async function write() {
  const draft = await new Job({
    title: 'Restart Proof Role',
    slug: `restart-proof-${runId}`,
    location: { displayName: 'Synthetic Location', countryCode: 'CA' },
    workArrangement: 'FULLY_REMOTE',
    employmentType: 'OTHER',
    schedule: 'Synthetic schedule',
    weeklyHours: 30,
    compensation: { currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: true },
    description: 'Synthetic description for the restart-persistence test.',
    responsibilities: ['Synthetic responsibility.'],
    requirements: ['Synthetic requirement.'],
  }).save();
  const job = await publishJob(draft, { now: new Date('2026-09-01T00:00:00.000Z') });

  const application = await buildApplication({
    job,
    candidate: { fullName: 'Synthetic Candidate', email: `synthetic+${runId}@example.test` },
    resume: {
      storageProvider: 'SYNTHETIC_TEST',
      storageKey: `synthetic/restart-proof/${runId}`,
      originalFilename: 'synthetic.pdf',
      extension: '.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      checksumSha256: 'c'.repeat(64),
      storedAt: new Date('2026-09-01T00:00:00.000Z'),
    },
    idempotencyKey: `restart-proof-${runId}`,
    submittedAt: new Date('2026-09-01T00:05:00.000Z'),
  }).save();

  return { jobId: String(job._id), applicationId: String(application._id) };
}

async function read() {
  const job = await Job.findById(jobId).lean();
  const application = await Application.findById(applicationId).lean();
  return {
    job: job && {
      slug: job.slug,
      status: job.status,
      publishedAt: job.publishedAt?.toISOString() ?? null,
      amountMinor: job.compensation?.amountMinor ?? null,
      createdAt: job.createdAt instanceof Date,
    },
    application: application && {
      jobIdMatches: String(application.jobId) === jobId,
      status: application.status,
      snapshotTitle: application.jobSnapshot?.title ?? null,
      snapshotSlug: application.jobSnapshot?.slug ?? null,
      emailNormalized: application.candidate?.emailNormalized ?? null,
      scanStatus: application.resume?.scanStatus ?? null,
      storageKey: application.resume?.storageKey ?? null,
      submittedAt: application.submittedAt?.toISOString() ?? null,
      keyHashIsHex64: /^[a-f0-9]{64}$/.test(application.idempotency?.keyHash ?? ''),
      internalNotification: application.notifications?.internal?.status ?? null,
    },
    counts: {
      jobsWithSlug: await Job.countDocuments({ slug: `restart-proof-${runId}` }),
      applicationsForJob: await Application.countDocuments({ jobId }),
    },
  };
}

try {
  await connectDatabase({ config, logger, readiness });
  const result = mode === 'write' ? await write() : await read();
  console.log(JSON.stringify({ mode, pid: process.pid, database: mongoose.connection.name, ...result }));
  await disconnectDatabase({ logger, readiness });
  process.exit(0);
} catch (error) {
  // A classified line only; driver messages may contain connection details.
  console.error(`persistence-child ${mode} failed: ${error?.name === 'ValidationError' ? 'ValidationError' : 'Error'}`);
  process.exit(1);
}
