import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../../src/app.js';
import { Job } from '../../../src/models/Job.js';
import { Application } from '../../../src/models/Application.js';
import { RecipientSuppression, RecipientSuppressionKey } from '../../../src/models/RecipientSuppression.js';
import { REQUIRED_INDEXES } from '../../../src/db/indexes.js';
import { publishJob } from '../../../src/modules/jobs/job.service.js';
import { createJobRepository } from '../../../src/modules/jobs/job.repository.js';
import { createApplicationRepository } from '../../../src/modules/applications/application.repository.js';
import { createNotificationService } from '../../../src/integrations/notifications/notificationService.js';
import { createSmtpTransport } from '../../../src/integrations/notifications/smtpTransport.js';
import { Readiness, DEPENDENCY_STATE } from '../../../src/modules/health/readiness.js';
import { capturingLogger, testConfig } from '../../helpers.js';
import { createIntakeEnvironment } from '../../fixtures/uploadHarness.js';
import { QA_NOTIFICATION_OPTIONS, applyRequest } from '../../fixtures/applyHarness.js';
import { createTestCertificates } from '../../fixtures/testCertificates.js';
import { startLocalSmtpServer } from '../../fixtures/localSmtpServer.js';
import { assertConnectedToTestDatabase } from '../testDatabase.js';

/**
 * B7 — the SUP acceptance environment (design rev 8 §8): the REAL Express app
 * and Apply workflow, the REAL application repository and suppression register
 * over a disposable MongoDB (replica set where available), the REAL SMTP
 * adapter submitting to a LOCAL SMTP TEST SERVER that counts every RCPT and
 * every message (the "submission counter"). Synthetic data and keys only. Not
 * evidence about Titan or delivery.
 */
export const SMTP_USERNAME = 'notifications@qa-valida.example.test';
export const SMTP_PASSWORD = 'qa-b7-sup-app-password-marker';
export const HR = QA_NOTIFICATION_OPTIONS.internalRecipient;

export const CONNECT = { serverSelectionTimeoutMS: 5_000, autoIndex: false, autoCreate: false, monitorCommands: true };

export async function connectAndIndex(uri, databaseName) {
  await mongoose.connect(uri, CONNECT);
  assertConnectedToTestDatabase(mongoose.connection, databaseName);
  for (const required of REQUIRED_INDEXES) {
    await mongoose.connection.db.collection(required.collection).createIndex(required.key, { name: required.name, ...required.options });
  }
}

export async function clearAll(databaseName) {
  assertConnectedToTestDatabase(mongoose.connection, databaseName);
  await failPointOff();
  await Application.deleteMany({});
  await Job.deleteMany({});
  await RecipientSuppression.deleteMany({});
  await RecipientSuppressionKey.deleteMany({});
}

export async function publishedJob() {
  const job = new Job({
    title: 'QA Synthetic Suppression Role',
    slug: 'qa-synthetic-apply-role',
    location: { displayName: 'QA Region, Canada', countryCode: 'CA' },
    workArrangement: 'FULLY_REMOTE',
    employmentType: 'PART_TIME',
    schedule: 'QA TEST DATA schedule',
    weeklyHours: 30,
    compensation: { currency: 'CAD', amountMinor: 3500, unit: 'HOUR', gross: true },
    description: 'QA TEST DATA description.',
    responsibilities: ['QA TEST DATA responsibility.'],
    requirements: ['QA TEST DATA requirement.'],
    applicationConfig: { resumeRequired: true, phone: { enabled: true, required: false }, message: { enabled: true, required: false, maxLength: 2000 }, screeningQuestions: [] },
  });
  await job.save();
  await publishJob(job, { now: new Date(Date.now() - 60_000) });
  return job;
}

/**
 * The local SMTP test server. `refusals` maps a recipient address to an
 * RCPT reply ({ code, text }) — e.g. 550 "5.1.1 …" for a bad mailbox.
 */
export async function startSubmissionServer() {
  const certificates = createTestCertificates();
  const refusals = new Map();
  const local = await startLocalSmtpServer({
    certificate: certificates.localhost,
    credentials: { username: SMTP_USERNAME, password: SMTP_PASSWORD },
    behaviour: { rcptTo: (address) => refusals.get(address.toLowerCase()) ?? null },
  });
  const counter = {
    /** Messages the relay ACCEPTED for this recipient (DATA completed). */
    messagesTo: (address) => local.record.messages.filter((message) => message.rcptTo.map((entry) => entry.toLowerCase()).includes(address.toLowerCase())).length,
    /** RCPT TO commands for this recipient — any submission attempt reaching the relay. */
    rcptTo: (address) => local.record.rcptTo.filter((entry) => entry.toLowerCase() === address.toLowerCase()).length,
    totalMessages: () => local.record.messages.length,
    totalRcpt: () => local.record.rcptTo.length,
  };
  return { local, certificates, refusals, counter };
}

/** The real app: real repositories, the given suppression gate, the real SMTP adapter. */
export function suppressionApp({ server, intake, gate, log, acknowledgementEnabled = true, clock }) {
  const readiness = new Readiness();
  readiness.set('configuration', DEPENDENCY_STATE.READY);
  readiness.set('database', DEPENDENCY_STATE.READY);
  const transport = createSmtpTransport({
    host: 'localhost',
    port: server.local.port,
    security: 'implicit-tls',
    username: SMTP_USERNAME,
    password: SMTP_PASSWORD,
    timeoutMs: 3_000,
    trustedCa: server.certificates.ca,
  });
  const notificationService = createNotificationService({
    transport,
    timeoutMs: 10_000,
    ...QA_NOTIFICATION_OPTIONS,
    fromAddress: SMTP_USERNAME,
    acknowledgementEnabled,
  });
  const app = createApp({
    config: testConfig({ applicationRateLimit: Object.freeze({ windowMs: 900_000, max: 10_000 }) }),
    logger: log.logger,
    readiness,
    jobRepository: createJobRepository({ queryTimeoutMs: 5_000 }),
    applicationRepository: createApplicationRepository({ timeoutMs: 5_000 }),
    notificationService,
    resumeStorage: intake.storage,
    uploadArea: intake.uploadArea,
    suppressionGate: gate,
    ...(clock ? { clock } : {}),
  });
  return { app, transport, notificationService };
}

/** One Apply for `email`; returns the HTTP response and the new Application id. */
export async function applyAs(app, email, { key = randomUUID() } = {}) {
  const response = await applyRequest(app, { key, fields: { email }, answers: [] });
  await app.locals.applicationSubmission.drainFollowUps();
  let id = null;
  if (response.status === 201) {
    const [latest] = await Application.find({}, { _id: 1 }).sort({ submittedAt: -1, _id: -1 }).limit(1).lean();
    id = latest._id;
  }
  return { response, id, key };
}

export const channels = async (id) => (await Application.findById(id).readConcern('majority').lean()).notifications;

/** MongoDB's own failCommand fail point (mongod --setParameter enableTestCommands=1). */
export async function failPoint(data, mode = { times: 1 }) {
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode, data });
}
export async function failPointOff() {
  try {
    await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' });
  } catch {
    // Not available on this server (enableTestCommands off): the fail-point tests report NOT RUN.
  }
}
export async function failPointsAvailable() {
  try {
    await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' });
    return true;
  } catch {
    return false;
  }
}

/** The write concern of every write command on the register collections (command monitoring). */
export function watchRegisterWrites() {
  const writes = [];
  const client = mongoose.connection.getClient();
  const listener = (event) => {
    if (!['insert', 'update', 'delete'].includes(event.commandName)) return;
    const collection = event.command[event.commandName];
    if (collection === 'recipient_suppressions' || collection === 'recipient_suppression_keys') writes.push({ command: event.commandName, collection, writeConcern: event.command.writeConcern });
  };
  client.on('commandStarted', listener);
  return { writes, stop: () => client.off('commandStarted', listener) };
}

export async function newEnvironment() {
  const log = capturingLogger();
  const intake = await createIntakeEnvironment({ logger: log.logger });
  return { log, intake };
}
