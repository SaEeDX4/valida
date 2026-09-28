import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mongoose from 'mongoose';
import { requireTestDatabase, assertConnectedToTestDatabase } from './testDatabase.js';

/**
 * Persistence across a backend PROCESS restart — B2 authorization section 6,
 * Doc 10 section 231.
 *
 * Process A writes a synthetic Job and Application through the backend's own
 * configuration, connection code, models and services, then EXITS. Process B —
 * a fresh Node process with its own connection — reads the same records back
 * by id without recreating or reseeding anything. A reconnect inside one
 * process would not prove this; two processes do.
 */
const { uri: TEST_URI, databaseName: TEST_DATABASE } = requireTestDatabase();
const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const runId = randomUUID().slice(0, 8);

function child(args) {
  // The child gets the LAUNCHING environment unchanged — no MONGODB_URI
  // override. It runs the same safety guard itself and connects only to the
  // approved MONGODB_TEST_URI.
  const result = spawnSync(process.execPath, ['tests/db/fixtures/persistence-child.mjs', ...args], {
    cwd: backendRoot,
    env: process.env,
    encoding: 'utf8',
    timeout: 60_000,
  });
  const line = result.stdout.trim().split('\n').pop();
  return { code: result.status, stderr: result.stderr, report: line ? JSON.parse(line) : null };
}

afterAll(async () => {
  // Remove only this run's synthetic records, in the test database.
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 10_000, autoIndex: false, autoCreate: false });
  assertConnectedToTestDatabase(mongoose.connection, TEST_DATABASE);
  const job = await mongoose.connection.db.collection('jobs').findOne({ slug: `restart-proof-${runId}` });
  if (job) await mongoose.connection.db.collection('applications').deleteMany({ jobId: job._id });
  await mongoose.connection.db.collection('jobs').deleteMany({ slug: `restart-proof-${runId}` });
  await mongoose.disconnect();
}, 30_000);

describe('persistence across a backend process restart', () => {
  it('reads back, in a fresh process, exactly what an exited process wrote', () => {
    const written = child(['write', runId]);
    expect(written.code, written.stderr).toBe(0);
    const { jobId, applicationId } = written.report;
    expect(jobId).toMatch(/^[a-f0-9]{24}$/);
    expect(applicationId).toMatch(/^[a-f0-9]{24}$/);

    const read = child(['read', runId, jobId, applicationId]);
    expect(read.code, read.stderr).toBe(0);

    // Two different processes.
    expect(read.report.pid).not.toBe(written.report.pid);
    expect(read.report.database).toBe(written.report.database);

    expect(read.report.job).toEqual({
      slug: `restart-proof-${runId}`,
      status: 'PUBLISHED',
      publishedAt: '2026-09-01T00:00:00.000Z',
      amountMinor: 3500,
      createdAt: true,
    });
    expect(read.report.application).toEqual({
      jobIdMatches: true,
      status: 'RECEIVED',
      snapshotTitle: 'Restart Proof Role',
      snapshotSlug: `restart-proof-${runId}`,
      emailNormalized: `synthetic+${runId}@example.test`,
      scanStatus: 'NOT_SCANNED',
      storageKey: `synthetic/restart-proof/${runId}`,
      submittedAt: '2026-09-01T00:05:00.000Z',
      keyHashIsHex64: true,
      internalNotification: 'PENDING',
    });
    // Nothing was recreated: still exactly one of each.
    expect(read.report.counts).toEqual({ jobsWithSlug: 1, applicationsForJob: 1 });

    // Safe, synthetic evidence line for the review package.
    console.log(
      `[restart evidence] written by pid ${written.report.pid}, read by pid ${read.report.pid}, ` +
        `database "${read.report.database}", job ${jobId} (${read.report.job.status}), ` +
        `application ${applicationId} (${read.report.application.status})`,
    );
  }, 120_000);
});
