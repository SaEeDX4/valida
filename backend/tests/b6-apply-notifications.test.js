import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { hashIdempotencyKey } from '../src/modules/applications/application.service.js';
import { PDF_MIME, syntheticPdf } from './fixtures/resumeFiles.js';
import {
  QA_CANDIDATE,
  QA_NOTIFICATION_OPTIONS,
  QA_NOW,
  applyRequest,
  createApplyEnvironment,
  dbUnavailable,
  recordingTransport,
} from './fixtures/applyHarness.js';

/**
 * B6 — the Apply workflow with both notification events (Doc 09 sections
 * 128-136; Doc 12 sections 116-117; Doc 14 sections 112-121).
 *
 * The real app (middleware, B4 parser and validation, REAL local private
 * storage, submission service, notifier, Notification Service, templates) with
 * the in-memory repositories (conditional semantics, see applyHarness.js) and
 * a TEST-DOUBLE transport. Proves what reaches the provider boundary and what
 * is recorded — never that an email was delivered (Doc 17 section 388).
 */
let env;
afterEach(async () => {
  await env?.cleanup();
  env = undefined;
});

const ACCEPTED_BODY = (response) => ({
  success: true,
  data: { status: 'RECEIVED', job: { title: 'QA Synthetic Apply Role', slug: 'qa-synthetic-apply-role' }, submittedAt: QA_NOW.toISOString() },
  meta: { requestId: response.headers['x-request-id'], replayed: false },
});
const events = (name) =>
  env.log
    .output()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.event === name);
const record = () => env.applications.all()[0];

describe('candidate acknowledgement ENABLED (provider double, identity configured)', () => {
  it('created with BOTH channels PENDING (durable acceptance first), then each sent once to its own recipient', async () => {
    const transport = recordingTransport('accept');
    const states = [];
    env = await createApplyEnvironment({ transport, notificationOptions: { acknowledgementEnabled: true } });
    // The state that was durably accepted, before any notification work.
    const insert = env.applications.insert.bind(env.applications);
    env.applications.insert = async (document) => {
      states.push(JSON.parse(JSON.stringify(document.notifications)));
      return insert(document);
    };
    const response = await applyRequest(env.app);
    expect(response.status).toBe(201);
    expect(response.body).toEqual(ACCEPTED_BODY(response));
    expect(states).toEqual([
      {
        internal: { status: 'PENDING', attemptCount: 0, lastAttemptAt: null, sentAt: null, lastErrorCode: null, lastStatusCode: null },
        candidateAcknowledgement: { status: 'PENDING', attemptCount: 0, lastAttemptAt: null, sentAt: null, lastErrorCode: null, lastStatusCode: null },
      },
    ]);
    expect(record().notifications).toEqual({
      internal: { status: 'SENT', attemptCount: 1, lastAttemptAt: QA_NOW, sentAt: QA_NOW, lastErrorCode: null, lastStatusCode: null },
      candidateAcknowledgement: { status: 'SENT', attemptCount: 1, lastAttemptAt: QA_NOW, sentAt: QA_NOW, lastErrorCode: null, lastStatusCode: null },
    });
    const byEvent = Object.fromEntries(transport.calls.map((message) => [message.event, message]));
    expect(Object.keys(byEvent).sort()).toEqual(['APPLICATION_ACKNOWLEDGEMENT', 'APPLICATION_RECEIVED_INTERNAL']);
    expect(byEvent.APPLICATION_RECEIVED_INTERNAL.to).toEqual([QA_NOTIFICATION_OPTIONS.internalRecipient]);
    expect(byEvent.APPLICATION_ACKNOWLEDGEMENT.to).toEqual([QA_CANDIDATE.email]);
    expect(byEvent.APPLICATION_ACKNOWLEDGEMENT.replyTo).toBe(QA_NOTIFICATION_OPTIONS.replyTo);
    // No resume, link or candidate data in the internal email; no tracking anywhere.
    for (const message of transport.calls) {
      expect(message.tracking).toEqual({ opens: false, links: false });
      expect(message.html).not.toMatch(/<a\s|https?:/i);
      // Stage 2: the only image is the approved logo, inline (CID).
      expect(message.html.match(/<img\b[^>]*>/g)).toEqual([expect.stringContaining('src="cid:valida-logo.b6@cybervalida.com"')]);
      expect(JSON.stringify(message)).not.toMatch(/%PDF|qa-resume|resumes\//);
    }
    expect(JSON.stringify(byEvent.APPLICATION_RECEIVED_INTERNAL)).not.toContain(QA_CANDIDATE.email);
    expect(JSON.stringify(byEvent.APPLICATION_RECEIVED_INTERNAL)).not.toContain(QA_CANDIDATE.fullName);
    expect(events('application_accepted')).toEqual([expect.objectContaining({ notification: 'SENT', acknowledgement: 'SENT' })]);
  });

  it('partial failure: internal accepted, acknowledgement suppressed — 201 with the SAME body; each channel recorded truthfully', async () => {
    const transport = recordingTransport((message) => (message.event === 'APPLICATION_ACKNOWLEDGEMENT' ? 'SUPPRESSED' : 'accept'));
    env = await createApplyEnvironment({ transport, notificationOptions: { acknowledgementEnabled: true } });
    const response = await applyRequest(env.app);
    expect(response.status).toBe(201);
    expect(response.body).toEqual(ACCEPTED_BODY(response));
    expect(record().notifications.internal).toMatchObject({ status: 'SENT', attemptCount: 1 });
    expect(record().notifications.candidateAcknowledgement).toMatchObject({ status: 'FAILED', attemptCount: 1, lastErrorCode: 'SUPPRESSED', sentAt: null });
    expect(env.storedObjects()).toHaveLength(1);
    expect(events('application_accepted')).toEqual([expect.objectContaining({ notification: 'SENT', acknowledgement: 'FAILED' })]);
  });

  it('both time out: answered within the bounds (in parallel), both FAILED / TIMEOUT, the Application and resume kept', async () => {
    const transport = recordingTransport('hang');
    env = await createApplyEnvironment({ transport, notificationTimeoutMs: 200, notificationOptions: { acknowledgementEnabled: true } });
    const started = Date.now();
    const response = await applyRequest(env.app);
    expect(response.status).toBe(201);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(record().notifications.internal).toMatchObject({ status: 'FAILED', attemptCount: 1, lastErrorCode: 'TIMEOUT', lastStatusCode: null });
    expect(record().notifications.candidateAcknowledgement).toMatchObject({ status: 'FAILED', attemptCount: 1, lastErrorCode: 'TIMEOUT', lastStatusCode: null });
    expect(transport.signals.every((signal) => signal.aborted)).toBe(true);
    expect(env.storedObjects()).toHaveLength(1);
  });

  it('the development allowlist blocks the candidate address before the provider (RECIPIENT_NOT_ALLOWED)', async () => {
    const transport = recordingTransport('accept');
    env = await createApplyEnvironment({
      transport,
      notificationOptions: { acknowledgementEnabled: true, recipientAllowlist: [QA_NOTIFICATION_OPTIONS.internalRecipient] },
    });
    expect((await applyRequest(env.app)).status).toBe(201);
    expect(transport.calls.map((message) => message.event)).toEqual(['APPLICATION_RECEIVED_INTERNAL']);
    expect(record().notifications.candidateAcknowledgement).toMatchObject({ status: 'FAILED', attemptCount: 1, lastErrorCode: 'RECIPIENT_NOT_ALLOWED', lastStatusCode: null });
  });

  it('a replay sends nothing — neither event — and changes no notification state (Doc 09 section 135)', async () => {
    const transport = recordingTransport('accept');
    env = await createApplyEnvironment({ transport, notificationOptions: { acknowledgementEnabled: true } });
    const key = randomUUID();
    const resume = { data: syntheticPdf(), filename: 'qa-resume.pdf', contentType: PDF_MIME };
    expect((await applyRequest(env.app, { key, resume })).status).toBe(201);
    const after = JSON.stringify(record().notifications);
    const replay = await applyRequest(env.app, { key, resume });
    expect(replay.status).toBe(200);
    expect(replay.body.meta.replayed).toBe(true);
    expect(transport.calls).toHaveLength(2);
    expect(JSON.stringify(record().notifications)).toBe(after);
    expect(env.applications.calls.claimNotificationAttempts).toBe(1);
  });

  it('a replay of an Application whose notification FAILED does not retry it either', async () => {
    const transport = recordingTransport('PROVIDER_UNAVAILABLE');
    env = await createApplyEnvironment({ transport, notificationOptions: { acknowledgementEnabled: true } });
    const key = randomUUID();
    const resume = { data: syntheticPdf(), filename: 'qa-resume.pdf', contentType: PDF_MIME };
    await applyRequest(env.app, { key, resume });
    expect((await applyRequest(env.app, { key, resume })).status).toBe(200);
    expect(transport.calls).toHaveLength(2);
    expect(record().notifications.internal).toMatchObject({ status: 'FAILED', attemptCount: 1 });
  });
});

describe('candidate acknowledgement DISABLED (the default)', () => {
  it('NOT_REQUIRED from the start; only the internal event is sent', async () => {
    const transport = recordingTransport('accept');
    env = await createApplyEnvironment({ transport });
    expect((await applyRequest(env.app)).status).toBe(201);
    expect(record().notifications.candidateAcknowledgement).toEqual({ status: 'NOT_REQUIRED', attemptCount: 0, lastAttemptAt: null, sentAt: null, lastErrorCode: null, lastStatusCode: null });
    expect(transport.calls.map((message) => message.event)).toEqual(['APPLICATION_RECEIVED_INTERNAL']);
    expect(events('application_accepted')).toEqual([expect.objectContaining({ notification: 'SENT', acknowledgement: 'NOT_REQUIRED' })]);
  });

  it('the switch alone does nothing without a transport: still NOT_REQUIRED, nothing attempted (production today)', async () => {
    env = await createApplyEnvironment({ transport: null, notificationOptions: { acknowledgementEnabled: true } });
    expect((await applyRequest(env.app)).status).toBe(201);
    expect(record().notifications).toEqual({
      internal: { status: 'PENDING', attemptCount: 0, lastAttemptAt: null, sentAt: null, lastErrorCode: null, lastStatusCode: null },
      candidateAcknowledgement: { status: 'NOT_REQUIRED', attemptCount: 0, lastAttemptAt: null, sentAt: null, lastErrorCode: null, lastStatusCode: null },
    });
    expect(env.applications.calls.claimNotificationAttempts).toBe(0);
    expect(events('application_accepted')).toEqual([expect.objectContaining({ notification: 'NOT_ATTEMPTED', notificationReason: 'NOT_CONFIGURED', acknowledgement: 'NOT_REQUIRED' })]);
  });
});

describe('the Application is never undone by notification work (Doc 09 section 132; Doc 14 section 119)', () => {
  it.each([
    [
      'persistence confirmed by the read-back: notified through a freshly loaded record',
      (applications) => (applications.nextInsert = { kind: 'AMBIGUOUS', reason: 'SERVER_ERROR', persist: true }),
      'SENT',
      1,
    ],
    [
      'persistence confirmed by the read-back, and the reload for the notification fails',
      (applications) => {
        applications.nextInsert = { kind: 'AMBIGUOUS', reason: 'SERVER_ERROR', persist: true };
        applications.faults.loadForUpdate = dbUnavailable('timeout');
      },
      'NOT_ATTEMPTED',
      0,
    ],
    ['the claim fails', (applications) => (applications.faults.claimNotification = dbUnavailable('timeout')), 'NOT_ATTEMPTED', 0],
    ['the outcome cannot be recorded', (applications) => (applications.faults.recordNotification = dbUnavailable('timeout')), 'SENT', 1],
  ])('%s: still 201 with the same body; the record and the resume stay', async (_label, inject, logged, sends) => {
    const transport = recordingTransport('accept');
    env = await createApplyEnvironment({ transport });
    inject(env.applications);
    const response = await applyRequest(env.app);
    expect(response.status).toBe(201);
    expect(response.body).toEqual(ACCEPTED_BODY(response));
    expect(env.applications.all()).toHaveLength(1);
    expect(env.storedObjects()).toHaveLength(1);
    expect(transport.calls).toHaveLength(sends);
    expect(events('application_accepted')).toEqual([expect.objectContaining({ notification: logged })]);
    // What is stored is what happened: one claimed attempt counted, or none (nothing was claimed).
    expect(env.applications.all()[0].notifications.internal.attemptCount).toBe(logged === 'NOT_ATTEMPTED' ? 0 : 1);
  });
});

describe('log privacy across both events (Doc 09 sections 149-150; Doc 14 section 115; Doc 13 section 118)', () => {
  it('r2: an email-shaped or opaque identifier returned by the provider never appears in the logs of the real Apply composition', async () => {
    for (const value of ['reviewer@example.invalid', 'opaque-SECRET-token-7f3a9c0e1b2d']) {
      await env?.cleanup();
      const transport = recordingTransport('accept');
      const send = transport.send;
      transport.send = async (...args) => {
        await send(...args);
        return { providerMessageId: value, MessageID: value, response: { To: value } };
      };
      env = await createApplyEnvironment({ transport, notificationOptions: { acknowledgementEnabled: true } });
      const response = await applyRequest(env.app);
      expect(response.status).toBe(201);
      expect(transport.calls).toHaveLength(2);
      expect(record().notifications.internal.status).toBe('SENT');
      expect(env.log.output()).not.toContain(value);
      expect(JSON.stringify(record().notifications)).not.toContain(value);
      expect(JSON.stringify(response.body)).not.toContain(value);
      expect(events('notification_attempted')).toHaveLength(2);
    }
  });

  it('no recipient address, candidate data, filename, Idempotency-Key, key hash, storage key, subject or body is logged', async () => {
    const transport = recordingTransport((message, callNumber) => (callNumber === 1 ? 'accept' : new Error(`raw provider text ${message.to[0]} secret-QA`)));
    env = await createApplyEnvironment({ transport, notificationOptions: { acknowledgementEnabled: true } });
    const key = randomUUID();
    const resume = { data: syntheticPdf(), filename: 'qa-private-filename-marker.pdf', contentType: PDF_MIME };
    await applyRequest(env.app, { key, resume, fields: { phone: QA_CANDIDATE.phone, message: 'QA-PRIVATE-MESSAGE-MARKER' } });
    await applyRequest(env.app, { key, resume, fields: { phone: QA_CANDIDATE.phone, message: 'QA-PRIVATE-MESSAGE-MARKER' } });
    const output = env.log.output();
    for (const marker of [
      QA_CANDIDATE.fullName,
      QA_CANDIDATE.email,
      QA_CANDIDATE.email.toLowerCase(),
      QA_CANDIDATE.phone,
      'QA-PRIVATE-MESSAGE-MARKER',
      'qa-private-filename-marker',
      QA_NOTIFICATION_OPTIONS.internalRecipient,
      QA_NOTIFICATION_OPTIONS.replyTo,
      QA_NOTIFICATION_OPTIONS.fromAddress,
      'raw provider text',
      'secret-QA',
      'New application —',
      'Thank you for applying',
      key,
      hashIdempotencyKey(key),
      `APPLICATION_RECEIVED_INTERNAL/`,
      env.intake.storageRoot,
    ]) {
      expect(output, marker).not.toContain(marker);
    }
    expect(output).not.toMatch(/resumes\/[0-9a-f]{32}/);
    // What IS logged: fixed tokens, the internal id, the provider token, the attempt number.
    const attempted = events('notification_attempted');
    expect(attempted).toHaveLength(2);
    for (const entry of attempted) {
      expect(Object.keys(entry).sort()).toEqual(
        expect.arrayContaining(['applicationId', 'attempt', 'channel', 'notificationEvent', 'outcome', 'provider', 'reqId', 'trigger']),
      );
      expect(entry.provider).toBe('qa-test-double');
    }
    expect(attempted.find((entry) => entry.outcome === 'FAILED')).toMatchObject({ errorCode: 'PROVIDER_ERROR', errorClass: 'UNCERTAIN' });
  });
});
