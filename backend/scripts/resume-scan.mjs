#!/usr/bin/env node
/**
 * Proposed (MongoDB-native r3) — the résumé scan worker: a starvation-free,
 * bounded queue (src/modules/applications/resume/scanQueue.js).
 *
 *   npm run ops:resume:scan
 *
 *   RESUME_SCANNER_MONGODB_URI        a database user with role valida_resume_scanner ONLY
 *                                     (applications find/update; resume_files find;
 *                                     scan_attempts find/insert/update)
 *   CLAMD_HOST / CLAMD_PORT           the private clamd service (default 127.0.0.1:3310)
 *   SCANNER_MAX_SIGNATURE_AGE_HOURS   optional, default 48 (1-168)
 *   SCANNER_SCAN_TIMEOUT_MS           optional, default 30000 (1000-300000)
 *   SCANNER_BATCH_SIZE                optional, default 50 (1-500)
 *   SCANNER_NEW_SHARE_PERCENT         optional, default 50 (1-100): batch share reserved for NEW résumés
 *   SCANNER_MAX_ATTEMPTS              optional, default 6 (1-20): file-level failures before EXHAUSTED
 *   SCANNER_BACKOFF_BASE_MINUTES      optional, default 15 (1-1440): base * 2^(attempts-1)
 *   SCANNER_BACKOFF_CAP_MINUTES       optional, default 1440 (1-10080)
 *   SCANNER_LEASE_MINUTES             optional, default 15 (1-120): claim lease per item
 *   SCANNER_BACKLOG_MAX_AGE_MINUTES   optional, default 120 (5-10080): alert threshold
 *
 * Before the batch the scanner is checked (reachable, signatures identifiable
 * and fresh). If that fails NOTHING is scanned or recorded and no attempt is
 * charged — the résumés stay as they are, i.e. held.
 *
 * Prints one JSON line: counts and reasons only (no key, URI, id, name or file).
 * Exit 3 BACKLOG_ALERT: the oldest unscanned résumé is older than the threshold,
 *        or a résumé is exhausted (held FAILED, no further automatic retry). The
 *        alert wins over every other outcome: it needs a person.
 * Exit 1: the scanner is unusable, or it failed during the batch (circuit open).
 * Exit 0: otherwise (file-level FAILED results are held and retried with backoff).
 * Exit 2: configuration refused.
 */
import mongoose from 'mongoose';
import { MongoPrivateStorage } from '../src/integrations/storage/mongoPrivateStorage.js';
import { createClamdScanner } from '../src/integrations/scanner/clamdScanner.js';
import { SCAN_ATTEMPTS_COLLECTION, backlog, runScanBatch } from '../src/modules/applications/resume/scanQueue.js';
import { safeErrorSummary } from '../src/lib/safeError.js';

const { MongoClient } = mongoose.mongo;
const refuse = (message) => {
  process.stderr.write(`resume-scan: ${message}\n`);
  process.exit(2);
};
const intVar = (name, fallback, min, max) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) refuse(`${name} must be an integer ${min}-${max}`);
  return Number(raw);
};

const uri = process.env.RESUME_SCANNER_MONGODB_URI;
if (!uri || !/^mongodb(\+srv)?:\/\//.test(uri)) refuse('RESUME_SCANNER_MONGODB_URI is required (a mongodb:// or mongodb+srv:// URI for the scanner user)');
const host = process.env.CLAMD_HOST || '127.0.0.1';
if (!/^[A-Za-z0-9.-]{1,253}$/.test(host)) refuse('CLAMD_HOST must be a host name or IPv4 address');
const port = intVar('CLAMD_PORT', 3310, 1, 65535);
const maxSignatureAgeHours = intVar('SCANNER_MAX_SIGNATURE_AGE_HOURS', 48, 1, 168);
const scanTimeoutMs = intVar('SCANNER_SCAN_TIMEOUT_MS', 30_000, 1_000, 300_000);
const options = {
  batchSize: intVar('SCANNER_BATCH_SIZE', 50, 1, 500),
  newShare: intVar('SCANNER_NEW_SHARE_PERCENT', 50, 1, 100) / 100,
  maxAttempts: intVar('SCANNER_MAX_ATTEMPTS', 6, 1, 20),
  backoffBaseMinutes: intVar('SCANNER_BACKOFF_BASE_MINUTES', 15, 1, 1440),
  backoffCapMinutes: intVar('SCANNER_BACKOFF_CAP_MINUTES', 1440, 1, 10080),
  leaseMinutes: intVar('SCANNER_LEASE_MINUTES', 15, 1, 120),
  backlogMaxAgeMinutes: intVar('SCANNER_BACKLOG_MAX_AGE_MINUTES', 120, 5, 10080),
};
if (options.backoffCapMinutes < options.backoffBaseMinutes) refuse('SCANNER_BACKOFF_CAP_MINUTES must be at least SCANNER_BACKOFF_BASE_MINUTES');

const started = Date.now();
const summary = { command: 'resume-scan', scanner: null, run: null, backlog: null, durationMs: 0 };
let client;
let storage;
try {
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  const applications = client.db().collection('applications');
  const attempts = client.db().collection(SCAN_ATTEMPTS_COLLECTION);
  const scanner = createClamdScanner({ host, port, maxSignatureAgeHours, scanTimeoutMs });
  let usable = true;
  try {
    const v = await scanner.version();
    summary.scanner = { engine: v.engine, signatureVersion: v.signatureVersion, signatureAgeHours: Math.round(v.ageHours * 10) / 10 };
  } catch (error) {
    summary.scanner = { unusable: error?.reason ?? 'UNAVAILABLE' };
    usable = false;
  }
  if (usable) {
    // The scanner user can read résumés (find) but never insert or delete: the read-only storage mode.
    storage = new MongoPrivateStorage({ uri, mode: 'read-only' });
    await storage.init();
    summary.run = await runScanBatch({ applications, attempts, storage, scanner, options });
  }
  summary.backlog = await backlog({ applications, attempts, now: new Date(), options });
  summary.durationMs = Date.now() - started;
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (summary.backlog.alert) process.exitCode = 3;
  else process.exitCode = !usable || summary.run?.circuitOpen ? 1 : 0;
} catch (error) {
  const { type, code } = safeErrorSummary(error);
  process.stderr.write(`resume-scan: failed (${error?.reason ? `${error.name} ${error.reason}` : `${type}${code ? ` ${code}` : ''}`})\n`);
  process.exitCode = 1;
} finally {
  await client?.close().catch(() => {});
  await storage?.close().catch(() => {});
}
