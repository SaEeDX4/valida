import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Application } from '../src/models/Application.js';
import { createApplicationRepository } from '../src/modules/applications/application.repository.js';
import { buildApplication } from '../src/modules/applications/application.service.js';
import { DatabaseUnavailableError } from '../src/modules/jobs/job.repository.js';
import { QA_CANDIDATE, qaJob } from './fixtures/applyHarness.js';
import { fakeApplicationCollection } from './fixtures/collectionAdapter.js';

/**
 * B6 r3 — notification CLAIM OWNERSHIP (the defect found by the Windows /
 * MongoDB 8.0.9 run of r2: a claimant that LOST the race could still record
 * an outcome, because its local copy carried the attempt it had tried to
 * claim and that attempt matched the winner's).
 *
 * Real: the Application model (B2 validation, write guards), Mongoose's
 * document save (delta, `doc.$where`, write concern, DocumentNotFoundError,
 * the 'save' event) and the real application repository. Simulated: ONLY the
 * final collection adapter (tests/fixtures/collectionAdapter.js), which
 * applies each update atomically. The same race against a real MongoDB is
 * tests/db/b6-notifications.test.js ("two concurrent claims ...").
 */
const T = new Date('2026-10-06T10:00:00.000Z');
const later = (ms) => new Date(T.getTime() + ms);

let fake;
let restore;
let repository;
beforeEach(() => {
  fake = fakeApplicationCollection(Application);
  restore = fake.install();
  // The repository's connection check needs an open connection; nothing else is read from the model here.
  repository = createApplicationRepository({ model: { db: { readyState: 1 } }, timeoutMs: 300 });
});
afterEach(() => restore());

/** A valid, stored Application (B5 builder), notification state as created. */
function storedApplication({ acknowledgement = false } = {}) {
  const job = qaJob();
  return fake.seed(
    buildApplication({
      job,
      candidate: { fullName: QA_CANDIDATE.fullName, email: QA_CANDIDATE.email },
      resume: {
        storageProvider: 'LOCAL_DEVELOPMENT',
        storageKey: `resumes/qa/${Math.random().toString(16).slice(2)}`,
        originalFilename: 'qa-resume.pdf',
        extension: '.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        checksumSha256: 'a'.repeat(64),
        storedAt: T,
      },
      idempotencyKey: `qa-key-${Math.random().toString(16).slice(2)}`,
      submittedAt: T,
      candidateAcknowledgementEnabled: acknowledgement,
    }),
  );
}
const internalOf = (id) => fake.stored(id).notifications.internal;
const ownerAndLoser = (results, first, second) => (results[0] === 'CLAIMED' ? [first, second] : [second, first]);

describe('only the claimant that acquired an attempt can record its outcome', () => {
  it.each([
    ['identical claim timestamps', 0],
    ['claim timestamps 1 ms apart', 1],
  ])('race with %s: one CLAIMED, one LOST; the LOSER recording first is refused without any write; the winner still records SENT', async (_label, deltaMs) => {
    const id = storedApplication();
    const [first, second] = [fake.hydrate(id), fake.hydrate(id)];
    const results = await Promise.all([
      repository.claimNotificationAttempts(first, ['internal'], { now: T }),
      repository.claimNotificationAttempts(second, ['internal'], { now: later(deltaMs) }),
    ]);
    expect([...results].sort()).toEqual(['CLAIMED', 'LOST']);
    const [winner, loser] = ownerAndLoser(results, first, second);
    const afterClaim = fake.stored(id);
    expect(afterClaim.notifications.internal).toMatchObject({ status: 'PENDING', attemptCount: 1, lastErrorCode: 'ATTEMPT_IN_PROGRESS' });

    const writesBefore = fake.updates.length;
    expect(await repository.recordNotificationOutcomes(loser, { internal: { status: 'FAILED', errorCode: 'TIMEOUT' } })).toBe('LOST');
    expect(fake.updates.length).toBe(writesBefore); // refused before anything is sent to the database
    expect(fake.stored(id)).toEqual(afterClaim);

    expect(await repository.recordNotificationOutcomes(winner, { internal: { status: 'SENT', sentAt: later(5) } })).toBe('RECORDED');
    expect(internalOf(id)).toMatchObject({ status: 'SENT', attemptCount: 1, lastErrorCode: null, sentAt: later(5) });
  });

  it('a claim that FAILED (nothing written) authorizes nothing; a fresh copy can still claim and record', async () => {
    const id = storedApplication();
    const failed = fake.hydrate(id);
    fake.script('fail-before');
    await expect(repository.claimNotificationAttempts(failed, ['internal'], { now: T })).rejects.toMatchObject({ name: 'DatabaseUnavailableError', reason: 'write_failed' });
    const before = fake.stored(id);
    expect(before.notifications.internal).toMatchObject({ status: 'PENDING', attemptCount: 0, lastErrorCode: null });

    const writes = fake.updates.length;
    expect(await repository.recordNotificationOutcomes(failed, { internal: { status: 'SENT', sentAt: later(1) } })).toBe('LOST');
    expect(fake.updates.length).toBe(writes);
    expect(fake.stored(id)).toEqual(before);

    const fresh = fake.hydrate(id);
    expect(await repository.claimNotificationAttempts(fresh, ['internal'], { now: later(2) })).toBe('CLAIMED');
    expect(await repository.recordNotificationOutcomes(fresh, { internal: { status: 'SENT', sentAt: later(3) } })).toBe('RECORDED');
    expect(internalOf(id)).toMatchObject({ status: 'SENT', attemptCount: 1 });
  });

  it.each([
    ['the server applied it but the connection failed before the answer', 'fail-after', 'write_failed'],
    ['the server applied it but never answered within the bound', 'hang-after', 'timeout'],
  ])('an UNCONFIRMED claim (%s) authorizes nothing: the attempt stays ATTEMPT_IN_PROGRESS (uncertain), unchanged', async (_label, behaviour, reason) => {
    const id = storedApplication();
    const unconfirmed = fake.hydrate(id);
    fake.script(behaviour);
    const error = await repository.claimNotificationAttempts(unconfirmed, ['internal'], { now: T }).catch((caught) => caught);
    expect(error).toBeInstanceOf(DatabaseUnavailableError);
    expect(error.reason).toBe(reason);
    const applied = fake.stored(id);
    expect(applied.notifications.internal).toMatchObject({ status: 'PENDING', attemptCount: 1, lastErrorCode: 'ATTEMPT_IN_PROGRESS' });

    const writes = fake.updates.length;
    for (const outcome of [{ status: 'SENT', sentAt: later(1) }, { status: 'FAILED', errorCode: 'TIMEOUT' }]) {
      expect(await repository.recordNotificationOutcomes(unconfirmed, { internal: outcome })).toBe('LOST');
    }
    expect(fake.updates.length).toBe(writes);
    expect(fake.stored(id)).toEqual(applied);
  });

  it('a stale previous claimant cannot overwrite a newer attempt (operator re-claim after the stale threshold)', async () => {
    const id = storedApplication();
    const old = fake.hydrate(id);
    expect(await repository.claimNotificationAttempts(old, ['internal'], { now: T })).toBe('CLAIMED');
    // The attempt went stale; an operator's --include-uncertain run claims attempt 2 from a fresh copy.
    const newer = fake.hydrate(id);
    expect(await repository.claimNotificationAttempts(newer, ['internal'], { now: later(60_000) })).toBe('CLAIMED');
    expect(internalOf(id)).toMatchObject({ attemptCount: 2, lastErrorCode: 'ATTEMPT_IN_PROGRESS' });

    const afterReclaim = fake.stored(id);
    expect(await repository.recordNotificationOutcomes(old, { internal: { status: 'SENT', sentAt: later(1) } })).toBe('LOST');
    expect(fake.stored(id)).toEqual(afterReclaim);
    expect(await repository.recordNotificationOutcomes(newer, { internal: { status: 'FAILED', errorCode: 'PROVIDER_UNAVAILABLE' } })).toBe('RECORDED');
    expect(internalOf(id)).toMatchObject({ status: 'FAILED', attemptCount: 2, lastErrorCode: 'PROVIDER_UNAVAILABLE' });
  });

  it('channel ownership is isolated: two claimants of different channels each record only their own', async () => {
    const id = storedApplication({ acknowledgement: true });
    const [internalOwner, acknowledgementOwner] = [fake.hydrate(id), fake.hydrate(id)];
    expect(
      await Promise.all([
        repository.claimNotificationAttempts(internalOwner, ['internal'], { now: T }),
        repository.claimNotificationAttempts(acknowledgementOwner, ['candidateAcknowledgement'], { now: T }),
      ]),
    ).toEqual(['CLAIMED', 'CLAIMED']);
    const afterClaims = fake.stored(id);

    // Not its channel / more than its channels / an empty set: refused, nothing written, the claim kept.
    const writes = fake.updates.length;
    expect(await repository.recordNotificationOutcomes(internalOwner, { candidateAcknowledgement: { status: 'SENT', sentAt: later(1) } })).toBe('LOST');
    expect(
      await repository.recordNotificationOutcomes(internalOwner, {
        internal: { status: 'SENT', sentAt: later(1) },
        candidateAcknowledgement: { status: 'SENT', sentAt: later(1) },
      }),
    ).toBe('LOST');
    expect(await repository.recordNotificationOutcomes(acknowledgementOwner, {})).toBe('LOST');
    expect(fake.updates.length).toBe(writes);
    expect(fake.stored(id)).toEqual(afterClaims);

    expect(await repository.recordNotificationOutcomes(internalOwner, { internal: { status: 'SENT', sentAt: later(2) } })).toBe('RECORDED');
    expect(await repository.recordNotificationOutcomes(acknowledgementOwner, { candidateAcknowledgement: { status: 'FAILED', errorCode: 'SUPPRESSED' } })).toBe('RECORDED');
    const final = fake.stored(id).notifications;
    expect(final.internal).toMatchObject({ status: 'SENT', attemptCount: 1, lastErrorCode: null });
    expect(final.candidateAcknowledgement).toMatchObject({ status: 'FAILED', attemptCount: 1, lastErrorCode: 'SUPPRESSED' });
    // Each record wrote only its own channel's paths.
    const recordUpdates = fake.updates.slice(-2).map(({ update }) => Object.keys(update.$set ?? {}).filter((path) => path !== 'updatedAt'));
    expect(recordUpdates[0].every((path) => path.startsWith('notifications.internal'))).toBe(true);
    expect(recordUpdates[1].every((path) => path.startsWith('notifications.candidateAcknowledgement'))).toBe(true);
  });

  it('a document is single-use: the LOSER cannot claim again with its copy, even though that copy now matches the winner\'s in-progress state', async () => {
    const id = storedApplication();
    const [first, second] = [fake.hydrate(id), fake.hydrate(id)];
    const results = await Promise.all([
      repository.claimNotificationAttempts(first, ['internal'], { now: T }),
      repository.claimNotificationAttempts(second, ['internal'], { now: T }),
    ]);
    const [, loser] = ownerAndLoser(results, first, second);
    const afterClaim = fake.stored(id);
    const writes = fake.updates.length;
    // Without the rule, the loser's copy ({ PENDING, 1, ATTEMPT_IN_PROGRESS }) would match and claim attempt 2 while the winner sends.
    expect(await repository.claimNotificationAttempts(loser, ['internal'], { now: later(1) })).toBe('LOST');
    expect(fake.updates.length).toBe(writes);
    expect(fake.stored(id)).toEqual(afterClaim);
  });

  it('nothing to claim: a channel that is SENT or NOT_REQUIRED is not claimed (LOST, no write); invalid channel lists are refused', async () => {
    const id = storedApplication();
    const owner = fake.hydrate(id);
    expect(await repository.claimNotificationAttempts(owner, ['internal'], { now: T })).toBe('CLAIMED');
    expect(await repository.recordNotificationOutcomes(owner, { internal: { status: 'SENT', sentAt: later(1) } })).toBe('RECORDED');
    const sent = fake.stored(id);
    const writes = fake.updates.length;
    expect(await repository.claimNotificationAttempts(fake.hydrate(id), ['internal'], { now: later(2) })).toBe('LOST');
    expect(await repository.claimNotificationAttempts(fake.hydrate(id), ['candidateAcknowledgement'], { now: later(2) })).toBe('LOST'); // NOT_REQUIRED
    expect(fake.updates.length).toBe(writes);
    expect(fake.stored(id)).toEqual(sent);
    for (const channels of [[], ['internal', 'internal'], ['other'], 'internal']) {
      await expect(repository.claimNotificationAttempts(fake.hydrate(id), channels, { now: later(3) })).rejects.toThrow(TypeError);
    }
  });

  it('one claim authorizes ONE record, of the attempt it acquired — whatever the caller later did to its copy', async () => {
    const id = storedApplication();
    const owner = fake.hydrate(id);
    expect(await repository.claimNotificationAttempts(owner, ['internal'], { now: T })).toBe('CLAIMED');
    // A caller bug: the copy's attempt is changed after the claim. The record still targets attempt 1 and writes attempt 1.
    owner.notifications.internal.attemptCount = 7;
    owner.notifications.internal.lastAttemptAt = later(999);
    expect(await repository.recordNotificationOutcomes(owner, { internal: { status: 'SENT', sentAt: later(5) } })).toBe('RECORDED');
    expect(internalOf(id)).toMatchObject({ status: 'SENT', attemptCount: 1, lastAttemptAt: T, sentAt: later(5) });
    const afterRecord = fake.stored(id);
    const writes = fake.updates.length;
    expect(await repository.recordNotificationOutcomes(owner, { internal: { status: 'FAILED', errorCode: 'TIMEOUT' } })).toBe('LOST');
    expect(await repository.claimNotificationAttempts(owner, ['internal'], { now: later(10) })).toBe('LOST');
    expect(fake.updates.length).toBe(writes);
    expect(fake.stored(id)).toEqual(afterRecord);
  });
});
