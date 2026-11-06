import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { storageObjectRef } from '../../backend/src/integrations/storage/storageContract.js';
import { hashIdempotencyKey } from '../../backend/src/modules/applications/application.service.js';
import { CHANNEL_EVENTS } from '../../backend/src/integrations/notifications/notificationService.js';
import { messageReference } from '../../backend/src/integrations/notifications/smtpTransport.js';
import { BACKEND_DIR, BACKEND_ORIGIN, FRONTEND_DIR, FRONTEND_ORIGIN } from './paths.js';
import { runNode } from './processes.js';
import { IDENTITY, backendEnvironment, readRun } from './stackConfig.js';

/**
 * What the cases observe OUTSIDE the browser: MongoDB, the private storage,
 * the local SMTP test server's captures, the backend log — plus the
 * screenshot and evidence-record helpers.
 *
 * EVIDENCE REDACTION (Doc 13 sections 171-172; Doc 09 section 22): a record
 * never contains a storage key (only its one-way reference, as the backend's
 * own logs use), an Idempotency-Key (only a short hash, enough to show two
 * requests carried the same key), or a secret. The synthetic candidate
 * values are synthetic (*.example.test) by construction.
 */
export const run = () => readRun();

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const keyRef = (key) => (key ? sha256(`e2e-key-ref:${key}`).slice(0, 12) : null);
export { hashIdempotencyKey, storageObjectRef, IDENTITY };

/** A unique synthetic candidate for one case. */
// A short tag that makes each run's synthetic candidates distinct. It is never empty: a run directory whose
// name has no digits (E2E_RUN_DIR=.../run-final) gets a tag from a hash of its name. An empty tag left a
// trailing space in the name, which the server rightly trims, so the stored name differed from the typed one.
export function runTag(runId = process.env.E2E_RUN_ID) {
  const digits = runId.replace(/[^0-9]/g, '').slice(-8);
  return digits || sha256(`e2e-run-tag:${runId}`).slice(0, 8);
}

export function candidate(tag) {
  const suffix = runTag();
  return {
    fullName: `QA E2E Candidate ${tag} ${suffix}`,
    email: `qa+e2e-${tag.toLowerCase()}-${suffix}@example.test`,
    // 555-01xx: reserved fictional numbers. Digits only: the server refuses letters (Doc 09 section 85).
    phone: '+1 555 0100 2026',
    message: `QA TEST DATA (E2E ${tag}): synthetic message.\nSecond line kept.`,
  };
}

// ------------------------------------------------------------------ MongoDB --
const { MongoClient } = createRequire(path.join(BACKEND_DIR, 'package.json'))('mongodb');
let clientPromise = null;
async function database() {
  clientPromise ??= MongoClient.connect(process.env.MONGODB_TEST_URI, { serverSelectionTimeoutMS: 10_000 });
  const client = await clientPromise;
  return client.db(run().databaseName);
}
export async function closeDatabase() {
  if (clientPromise) (await clientPromise).close();
  clientPromise = null;
}
export async function applicationsFor(email) {
  return (await database()).collection('applications').find({ 'candidate.emailNormalized': email.toLowerCase() }).sort({ submittedAt: 1 }).toArray();
}
export async function applicationCount() {
  return (await database()).collection('applications').countDocuments({});
}
export async function jobBySlug(slug) {
  return (await database()).collection('jobs').findOne({ slug });
}
export async function suppressionEntries() {
  return (await database()).collection('recipient_suppressions').find({}, { projection: { state: 1, 'lookup.keyId': 1, reason: 1, 'basis.kind': 1, 'basis.statusCode': 1, history: 1 } }).toArray();
}

/** The safe view of an Application for an evidence record. */
export function applicationEvidence(doc) {
  if (!doc) return null;
  return {
    applicationId: String(doc._id),
    jobId: String(doc.jobId),
    status: doc.status,
    submittedAt: doc.submittedAt?.toISOString?.() ?? doc.submittedAt,
    jobSnapshot: doc.jobSnapshot,
    candidate: { fullName: doc.candidate.fullName, email: doc.candidate.email, emailNormalized: doc.candidate.emailNormalized, phone: doc.candidate.phone, messageLength: doc.candidate.message?.length ?? null },
    screeningAnswers: doc.screeningAnswers,
    resume: {
      objectRef: storageObjectRef(doc.resume.storageKey),
      storageProvider: doc.resume.storageProvider,
      originalFilename: doc.resume.originalFilename,
      extension: doc.resume.extension,
      mimeType: doc.resume.mimeType,
      sizeBytes: doc.resume.sizeBytes,
      checksumSha256: doc.resume.checksumSha256,
      scanStatus: doc.resume.scanStatus,
      scanCheckedAt: doc.resume.scanCheckedAt,
      storedAt: doc.resume.storedAt?.toISOString?.() ?? doc.resume.storedAt,
    },
    idempotency: { keyHashPresent: typeof doc.idempotency?.keyHash === 'string', fingerprintPresent: typeof doc.idempotency?.requestFingerprintHash === 'string' },
    notifications: doc.notifications,
    retention: doc.retention,
  };
}

// ------------------------------------------------------------------ storage --
/** Every object under the private storage root: references, sizes, modes, checksums — never the key. */
export function storageObjects() {
  const root = path.join(run().storageRoot, 'resumes');
  if (!existsSync(root)) return [];
  const objects = [];
  for (const id of readdirSync(root)) {
    const directory = path.join(root, id);
    if (!statSync(directory).isDirectory()) continue;
    for (const name of readdirSync(directory)) {
      const file = path.join(directory, name);
      const stat = statSync(file);
      objects.push({ objectRef: storageObjectRef(`resumes/${id}/${name}`), sizeBytes: stat.size, mode: (stat.mode & 0o777).toString(8), directoryMode: (statSync(directory).mode & 0o777).toString(8), sha256: sha256(readFileSync(file)) });
    }
  }
  return objects;
}
/** The object an Application references (by its key), read from the private root. */
export function storedObjectFor(storageKey) {
  const file = path.join(run().storageRoot, ...storageKey.split('/'));
  if (!existsSync(file)) return { exists: false, objectRef: storageObjectRef(storageKey) };
  const stat = statSync(file);
  return { exists: true, objectRef: storageObjectRef(storageKey), sizeBytes: stat.size, mode: (stat.mode & 0o777).toString(8), sha256: sha256(readFileSync(file)) };
}

// --------------------------------------------------------------------- SMTP --
/** Every message the local SMTP test server accepted, in order: envelope, headers, MIME summary. */
export function capturedMessages() {
  const dir = run().smtp.captureDir;
  return readdirSync(dir)
    .filter((name) => /^\d{4}\.json$/.test(name))
    .sort()
    .map((name) => {
      const meta = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
      const raw = readFileSync(path.join(dir, name.replace(/\.json$/, '.eml')));
      return { ...meta, file: name.replace(/\.json$/, '.eml'), raw, headers: headersOf(raw), parts: mimeParts(raw) };
    });
}
/**
 * The messages of one Application, matched EXACTLY: the SMTP adapter derives
 * each Message-ID from "<event>/<applicationId>" (smtpTransport.js
 * messageReference), so a message belongs to an Application by construction,
 * not by guessing from its content.
 */
export function messagesForApplication(applicationId) {
  const token = (channel) => messageReference(`${CHANNEL_EVENTS[channel]}/${applicationId}`);
  const all = capturedMessages();
  const match = (channel) => all.filter((message) => (message.headers['message-id']?.[0] ?? '').includes(token(channel)));
  return { internal: match('internal'), acknowledgement: match('candidateAcknowledgement') };
}
export const messagesTo = (address) => capturedMessages().filter((message) => message.rcptTo.map((entry) => entry.toLowerCase()).includes(address.toLowerCase()));
/** Every RCPT the server saw (accepted and refused). */
export function rcptLog() {
  const file = path.join(run().smtp.captureDir, 'rcpt.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
}
export function smtpSessions() {
  const file = path.join(run().smtp.captureDir, 'auth.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}
/** Waits (bounded) until `predicate()` holds: the capture is flushed to disk every 50 ms. */
export async function eventually(predicate, { timeoutMs = 5_000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let value = await predicate();
  while (!value && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    value = await predicate();
  }
  return value;
}

function headersOf(raw) {
  const text = raw.toString('utf8');
  const end = text.indexOf('\r\n\r\n');
  const block = (end === -1 ? text : text.slice(0, end)).replace(/\r\n[ \t]+/g, ' ');
  const headers = {};
  for (const line of block.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    (headers[name] ??= []).push(line.slice(colon + 1).trim());
  }
  return headers;
}
/** Content-Type, Content-Disposition and filename of every MIME part header block. */
function mimeParts(raw) {
  const text = raw.toString('utf8');
  const parts = [];
  for (const block of text.split(/\r\n--[^\r\n]+\r\n/).slice(1)) {
    const end = block.indexOf('\r\n\r\n');
    const head = (end === -1 ? block : block.slice(0, end)).replace(/\r\n[ \t]+/g, ' ');
    const type = /^content-type:\s*([^;\r\n]+)/im.exec(head)?.[1]?.trim() ?? null;
    if (!type) continue;
    parts.push({
      contentType: type.toLowerCase(),
      disposition: /^content-disposition:\s*([^;\r\n]+)/im.exec(head)?.[1]?.trim().toLowerCase() ?? null,
      filename: /filename="?([^";\r\n]+)"?/i.exec(head)?.[1] ?? null,
      contentId: /^content-id:\s*(\S+)/im.exec(head)?.[1] ?? null,
    });
  }
  return parts;
}
/** The safe view of one captured message for an evidence record. */
export function messageEvidence(message) {
  const header = (name) => message.headers[name]?.[0] ?? null;
  return {
    file: message.file,
    envelope: { mailFrom: message.mailFrom, rcptTo: message.rcptTo, dsn: message.dsn },
    disposition: message.disposition,
    headers: {
      from: header('from'),
      to: header('to'),
      replyTo: header('reply-to'),
      subject: header('subject'),
      autoSubmitted: header('auto-submitted'),
      messageIdPresent: Boolean(header('message-id')),
      contentType: header('content-type')?.split(';')[0] ?? null,
      xMailer: header('x-mailer'),
    },
    parts: message.parts,
    sizeBytes: message.sizeBytes,
  };
}

// -------------------------------------------------------------- backend log --
export const backendLog = () => readFileSync(path.join(run().dirs.logs, 'backend.log'), 'utf8');
export function backendEvents(filter = () => true) {
  return backendLog()
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((entry) => entry && filter(entry));
}

// --------------------------------------------------------------- backend CLI --
/** Runs one backend CLI with the run's backend configuration; output appended to logs/cli.log. */
export async function backendCli(label, args) {
  const result = await runNode(args, { cwd: BACKEND_DIR, env: backendEnvironment({ run: run() }), logFile: path.join(run().dirs.logs, 'cli.log'), label });
  return { label, exitCode: result.code, stdout: result.stdout.trim() };
}

// ---------------------------------------------------------------------- HTTP --
export async function api(pathname, init = {}) {
  const response = await fetch(`${BACKEND_ORIGIN}${pathname}`, { ...init, headers: { Origin: FRONTEND_ORIGIN, ...(init.headers ?? {}) } });
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: response.status, headers: Object.fromEntries(response.headers), body };
}

// ------------------------------------------------------- screenshots, records --
const outputDir = (sub) => {
  const dir = path.join(run().dirs.output, sub);
  mkdirSync(dir, { recursive: true });
  return dir;
};
export async function shot(page, name) {
  const file = path.join(outputDir('screenshots'), `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return `screenshots/${name}.png`;
}
export function record(caseId, data) {
  writeFileSync(path.join(outputDir('cases'), `${caseId}.json`), JSON.stringify({ caseId, recordedAt: new Date().toISOString(), ...data }, null, 2));
}

const AXE = path.join(FRONTEND_DIR, 'node_modules', 'axe-core', 'axe.min.js');
/** axe-core WCAG 2.x A/AA on the current state: [{ id, impact, nodes }]. */
export async function axe(page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] })).violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })));
}

/** The synthetic resume fixtures (backend/tests/fixtures/resumes: "QA TEST DOCUMENT - NOT A REAL CANDIDATE"). */
export const RESUMES = Object.freeze({
  pdf: path.join(BACKEND_DIR, 'tests', 'fixtures', 'resumes', 'qa-libreoffice.pdf'),
  docx: path.join(BACKEND_DIR, 'tests', 'fixtures', 'resumes', 'qa-python-docx.docx'),
});
/** A 1x1 PNG, named and typed as a PDF: passes the browser's checks, not the server's content check. */
export const PNG_AS_PDF = Object.freeze({
  name: 'qa-e2e-not-really-a.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex'),
});
