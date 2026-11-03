import {
  applicationJobNotFound,
  applicationUnavailable,
  idempotencyKeyReused,
  jobNotAcceptingApplications,
  validationFailed,
} from '../../errors/AppError.js';
import { DatabaseUnavailableError } from '../jobs/job.repository.js';
import { publicApplicationStatus } from '../jobs/job.visibility.js';
import { isValidPublicSlug } from '../jobs/job.validation.js';
import { buildApplication, hashIdempotencyKey } from './application.service.js';
import { ApplicationIndexesMissingError } from './application.repository.js';
import {
  fingerprintAgainstExisting,
  parseScreeningAnswers,
  validateCandidateFields,
  validateJobDrivenFields,
} from './application.validation.js';
import { validateResumeUpload } from './resume/resumeValidation.js';
import { discardStoredResume, storeValidatedResume } from './resume/resumeStorage.js';
import { storageObjectRef } from '../../integrations/storage/privateStorage.js';
import { safeErrorSummary } from '../../lib/safeError.js';

/**
 * Application submission — Milestone B5, the real Apply backend.
 *
 * Governed by 18_IMPLEMENTATION_ROADMAP.md sections 122-132,
 * 09_BACKEND_API_SPEC.md sections 71-150, 10_DATA_MODEL.md sections 71-132
 * and 207-209, 12_CAREERS_APPLICATIONS.md sections 56-69 (APP-001..010),
 * 13_SECURITY_PRIVACY_THREAT_MODEL.md sections 48-50 and 118-121.
 *
 * THE SEQUENCE (Doc 09 section 109; Doc 18 section 125)
 *
 *   1. candidate fields and the shape of screeningAnswers      422
 *   2. EXISTING KEY: an Application already created with this
 *      Idempotency-Key? same fingerprint -> replay              200 replayed
 *                       different fingerprint                  409 IDEMPOTENCY_KEY_REUSED
 *   3. Job by slug; effective state at the server clock        404 / 409
 *   4. Job-driven fields: phone, message, screening answers     422
 *   5. resume file (B4 validator)                               415 / 413 / 422
 *   6. the unique Application indexes are in place (fail closed)503
 *   7. store the resume privately (B4)                          503 on failure
 *   8. RE-CHECK the Job's state: a fresh read, evaluated at a
 *      fresh server time taken AFTER it — that instant becomes
 *      submittedAt                                              409 / 404, object removed
 *   9. persist the Application (validated B2 save)
 *  10. notification step (bounded; never affects acceptance)
 *  11. 201
 *
 * Step 2 deliberately precedes the Job checks. Doc 09 section 121: a client
 * whose response was lost retries with the same key and must receive the
 * ORIGINAL success — also when the Job has closed in between (the
 * Application WAS accepted while it was open). For a key that has produced no
 * Application yet, the order is exactly Doc 09 section 109. Step 2 needs the
 * resume checksum (part of the fingerprint, Doc 10 section 114), so it runs
 * only for a request that carries a file; one without a file can never be a
 * replay and continues to the ordinary "resume required" answer. A replay's
 * file still passes the B4 validator first (Doc 09 section 109 validates the
 * resume before the idempotency check): a retry is answered only for a file
 * that would be accepted.
 *
 * Step 8 closes the closing-time race (Doc 09 section 115): the Job may close
 * while the upload is stored, or while its state is being read. The state is
 * read again, fresh, after storage and immediately before the insert; THEN the
 * server clock is read, and the returned state is evaluated at that instant,
 * which becomes the Application's submittedAt (r2, r1 review finding 3: a time
 * sampled before the read could be stale by the read's duration). Every
 * Application is therefore recorded with a submittedAt before its Job's
 * closesAt, on a state read no earlier than storage. (An administrative close
 * that commits during that read is not seen — there is no cross-collection
 * transaction. Such a close stamps its closedAt before its own save commits,
 * so the Application's submittedAt can then be later than the Job's closedAt,
 * by at most the read's duration plus the close's save time.)
 *
 * REPLAYS ARE SUCCESS CLAIMS (r2, r1 review finding 2). A replay — and a 409
 * for a conflicting reuse — is answered only from a record confirmed by a read
 * with read concern "majority". A record visible to an ordinary read but not
 * (yet) majority-confirmed is answered 503 (`application_replay_unconfirmed`):
 * nothing is stored for the request, and a later retry replays once the record
 * is confirmed. This applies to the early existing-key lookup and to every
 * race path that answers with the winner.
 *
 * FROM STEP 7 ON, EVERY OUTCOME ACCOUNTS FOR THE STORED OBJECT:
 *
 *   persisted (or proven persisted)        kept — referenced by its Application
 *   PROVEN not persisted (nothing sent,    compensation: deleted (Doc 09
 *   or the driver says no write was        section 119); if deletion fails the
 *   performed)                             object stays private and an orphan
 *                                          event names its object reference
 *   lost the idempotency race (another     deleted; the winner is replayed
 *   Application with this key and ANOTHER  (Doc 09 section 120)
 *   object is read back)
 *   OUTCOME UNKNOWN (any other failure)    read back by key hash (read concern
 *                                          "majority"): found ours -> success;
 *                                          found another -> deleted + replay;
 *                                          otherwise KEPT (it may belong to a
 *                                          persisted Application), a
 *                                          reconciliation event names its
 *                                          object reference,
 *                                          and the answer is 503 — neither
 *                                          success nor failure is claimed.
 *
 * An object is deleted only on proof that no Application references it.
 *
 * LOGS carry the request id, fixed reason tokens, the internal Application id
 * after persistence, the Job slug, the notification outcome and — only on a
 * reconciliation path — the object's one-way reference (storageObjectRef).
 * Never the candidate's name, email, phone, message, answers, filename, the
 * Idempotency-Key or its hash, a storage key or a path (Doc 09 sections
 * 22 and 149-150; Doc 13 sections 81 and 118-119; SEC-026).
 *
 * RECONCILIATION (Doc 10 sections 207-209; Doc 15 sections 200-204; the
 * command itself is deferred). An object is an orphan when it exists in
 * private storage and no Application references it. The reconciliation
 * process lists private storage, checks each key against
 * Application.resume.storageKey in MongoDB, and treats an unreferenced object
 * older than the safety window as a possible orphan. It needs no log to do
 * that; the events below let an operator connect an incident (request id,
 * reason) to the one object concerned, through the reference.
 */

/** The public result of an accepted or replayed Application. */
function resultFrom(record, replayed) {
  return {
    replayed,
    status: record.status ?? 'RECEIVED',
    job: { title: record.jobSnapshot.title, slug: record.jobSnapshot.slug },
    submittedAt: record.submittedAt,
  };
}

/**
 * @param {object} deps
 * @param {ReturnType<import('../jobs/job.repository.js').createJobRepository>} deps.jobs
 * @param {ReturnType<import('./application.repository.js').createApplicationRepository>} deps.applications
 * @param {object | null} deps.storage the private resume storage (B4), or null when not configured
 * @param {ReturnType<import('./application.notifications.js').createApplicationNotifier>} deps.notifier the B6 notification cycle
 * @param {() => Date} deps.clock the server clock (Doc 09 section 187)
 * @param {object} deps.logger
 */
export function createApplicationSubmissionService({ jobs, applications, storage, notifier, clock, logger }) {
  /*
   * Follow-ups of an abandoned (timed-out) insert: when it finally settles,
   * its real outcome is logged and, if it is then proven not persisted, its
   * object is removed. Best effort, in process memory: never awaited by a
   * request, and not awaited at shutdown — one still pending when the process
   * stops is simply dropped, which is safe because the object is then KEPT
   * and the earlier `application_persistence_ambiguous` event names it for
   * reconciliation. drainFollowUps() exists for tests.
   */
  const followUps = new Set();
  const track = (promise) => {
    const guarded = promise.catch(() => {});
    followUps.add(guarded);
    guarded.finally(() => followUps.delete(guarded));
  };

  async function submit({ jobSlug, idempotencyKey, upload, requestId }) {
    const context = { reqId: requestId, jobSlug: isValidPublicSlug(jobSlug) ? jobSlug : undefined };

    /** A database READ that fails is a dependency outage: 503, nothing to compensate. */
    async function read(operation, reason) {
      try {
        return await operation();
      } catch (error) {
        if (error instanceof DatabaseUnavailableError) {
          logger.error({ ...context, dependency: 'database', reason: error.reason }, 'application read failed');
          throw applicationUnavailable(error, { reason });
        }
        throw error;
      }
    }

    /** Compensation for a stored object whose Application is NOT persisted. Never throws. */
    async function compensate(storageKey, why) {
      const outcome = await discardStoredResume({ storage, storageKey, logger, requestId });
      logger.warn({ ...context, event: 'application_not_accepted', reason: why, compensation: outcome }, 'application not accepted after its resume was stored');
      return outcome;
    }

    // 1. ---------------------------------------------- candidate fields --
    const candidate = validateCandidateFields(upload.fields);
    const answers = parseScreeningAnswers(upload.fields.screeningAnswers);
    const shapeErrors = [...candidate.fieldErrors, ...answers.fieldErrors];
    if (shapeErrors.length > 0) {
      const error = validationFailed(shapeErrors);
      error.reason = 'APPLICATION_FIELDS_INVALID';
      throw error;
    }

    const keyHash = hashIdempotencyKey(idempotencyKey);

    /** Step 2 and the race path: an Application with this key already exists. */
    function answerExisting(existing) {
      const sameJob = existing.jobSnapshot?.slug === jobSlug;
      const fingerprint = sameJob
        ? fingerprintAgainstExisting({
            existing,
            candidate: candidate.value,
            fields: upload.fields,
            answers: answers.value,
            resumeChecksumSha256: upload.file.checksumSha256,
          })
        : null;
      if (fingerprint === null || fingerprint !== existing.idempotency?.requestFingerprintHash) {
        throw idempotencyKeyReused();
      }
      // Doc 09 sections 79, 126, 135: the original logical success; nothing is
      // created, stored or notified.
      logger.info({ ...context, event: 'application_replayed', applicationId: String(existing._id) }, 'idempotent replay');
      return resultFrom(existing, true);
    }

    /**
     * Answers from an existing Application only once it is DURABLY confirmed:
     * `record` came from an ordinary read unless `confirmed` says it came from
     * a majority read; otherwise it is read again with read concern "majority"
     * and must be the same record. Unconfirmed: 503, no claim either way.
     */
    async function answerConfirmed(record, { confirmed = false } = {}) {
      let durable = confirmed ? record : null;
      if (!confirmed) {
        const found = await read(() => applications.findByKeyHash(keyHash, { majority: true }), 'DATABASE_READ_FAILED');
        if (found && String(found._id) === String(record._id)) durable = found;
      }
      if (!durable) {
        logger.warn(
          { ...context, event: 'application_replay_unconfirmed', reason: 'REPLAY_UNCONFIRMED', applicationId: String(record._id) },
          'an Application exists for this key but is not yet confirmed durable; no replay is claimed',
        );
        throw applicationUnavailable(undefined, { reason: 'APPLICATION_PERSISTENCE_UNCONFIRMED' });
      }
      return answerExisting(durable);
    }

    // 2. ------------------------------------------------ existing key --
    if (upload.file) {
      const existing = await read(() => applications.findByKeyHash(keyHash), 'DATABASE_READ_FAILED');
      if (existing) {
        await validateResumeUpload(upload); // B4 restrictions apply to a retry's file too
        return answerConfirmed(existing);
      }
    }

    // 3. --------------------------------------------------------- Job --
    if (!isValidPublicSlug(jobSlug)) throw applicationJobNotFound({ reason: 'JOB_SLUG_INVALID' });
    const job = await read(() => jobs.findJobForApplication({ slug: jobSlug, now: clock() }), 'DATABASE_READ_FAILED');
    // Evaluated at a server time taken after the read (re-checked in step 8).
    const status = publicApplicationStatus(job, clock());
    if (status === null) throw applicationJobNotFound();
    if (status !== 'OPEN') throw jobNotAcceptingApplications();

    // 4. --------------------------------------------- Job-driven fields --
    const driven = validateJobDrivenFields({ job, fields: upload.fields, answers: answers.value });
    if (driven.fieldErrors.length > 0) {
      const error = validationFailed(driven.fieldErrors);
      error.reason = 'APPLICATION_FIELDS_INVALID';
      throw error;
    }

    // 5. ------------------------------------------------------ resume --
    const validated = await validateResumeUpload(upload);

    // 6. ------------------------------------------ unique indexes (DATA-066) --
    try {
      await applications.assertUniqueIndexes();
    } catch (error) {
      if (error instanceof ApplicationIndexesMissingError) {
        logger.error({ ...context, reason: error.reason }, 'applications refused: required unique indexes are missing (run db:indexes:apply)');
        throw applicationUnavailable(error, { reason: error.reason });
      }
      if (error instanceof DatabaseUnavailableError) {
        logger.error({ ...context, dependency: 'database', reason: error.reason }, 'application read failed');
        throw applicationUnavailable(error, { reason: 'DATABASE_READ_FAILED' });
      }
      throw error;
    }

    // 7. ----------------------------------------------------- storage --
    let resume;
    try {
      resume = await storeValidatedResume({ storage, validated });
    } catch (error) {
      // B4 already removed any partial object; nothing is stored.
      throw applicationUnavailable(error.cause ?? error, { reason: error.reason ?? 'RESUME_STORAGE_FAILED' });
    }
    const { storageKey } = resume;

    // 8. ------------------------------------- eligibility, re-checked --
    let current;
    try {
      current = await jobs.findJobEligibility({ jobId: job._id });
    } catch (error) {
      await compensate(storageKey, 'ELIGIBILITY_RECHECK_FAILED');
      if (error instanceof DatabaseUnavailableError) throw applicationUnavailable(error, { reason: 'DATABASE_READ_FAILED' });
      throw error;
    }
    // The acceptance instant: server time taken AFTER the read. The returned
    // state is evaluated at exactly this instant, and it becomes submittedAt.
    const submittedAt = clock();
    const currentStatus = publicApplicationStatus(current, submittedAt);
    if (currentStatus !== 'OPEN') {
      await compensate(storageKey, 'JOB_CLOSED_DURING_SUBMISSION');
      throw currentStatus === null
        ? applicationJobNotFound({ reason: 'JOB_UNAVAILABLE_DURING_SUBMISSION' })
        : jobNotAcceptingApplications({ reason: 'JOB_CLOSED_DURING_SUBMISSION' });
    }

    // 9. ----------------------------------------------------- persist --
    const document = buildApplication({
      job,
      candidate: {
        fullName: candidate.value.fullName,
        email: candidate.value.email,
        phone: driven.value.phone,
        message: driven.value.message,
      },
      screeningAnswers: driven.value.screeningAnswers,
      resume,
      idempotencyKey,
      submittedAt,
    });
    // B6 — Doc 10 section 121: with candidate acknowledgement enabled, its
    // channel starts PENDING; otherwise it stays NOT_REQUIRED (the model's default).
    if (notifier.acknowledgementEnabled) document.notifications.candidateAcknowledgement.status = 'PENDING';

    /**
     * Who holds this idempotency key now? OURS (the record references our
     * object), OTHER (another request's Application), NOT_FOUND, UNCONFIRMED
     * or READ_FAILED. Never throws.
     *
     * OURS — the basis of a success answer — is only ever returned from a
     * read with read concern "majority" (a write visible only on a replica
     * set's primary could still be rolled back); an ordinary read that finds
     * our record is confirmed that way first, and is UNCONFIRMED otherwise.
     * OTHER needs no such confirmation: the unique index means our insert
     * cannot be persisted alongside it.
     */
    async function ownerOfKey({ majority = false } = {}) {
      try {
        const record = await applications.findByKeyHash(keyHash, { majority });
        if (!record) return { state: 'NOT_FOUND', record: null };
        if (record.resume?.storageKey !== storageKey) return { state: 'OTHER', record };
        if (majority) return { state: 'OURS', record };
        const confirmed = await applications.findByKeyHash(keyHash, { majority: true });
        return confirmed?.resume?.storageKey === storageKey
          ? { state: 'OURS', record: confirmed }
          : { state: 'UNCONFIRMED', record: null };
      } catch {
        return { state: 'READ_FAILED', record: null };
      }
    }

    /** The object may belong to a persisted Application: it is kept and named — by its one-way reference — for reconciliation. */
    function keptForReconciliation(event, details, message) {
      logger.error({ ...context, event, objectRef: storageObjectRef(storageKey), ...details }, message);
    }

    const insert = await applications.insert(document);
    let accepted = null; // the persisted record: { _id, status, jobSnapshot, submittedAt }
    let updatable = null; // a document through which notification state can be recorded

    switch (insert.kind) {
      case 'CREATED':
        accepted = document;
        updatable = document;
        break;

      case 'DUPLICATE_KEY_HASH': {
        // Doc 09 section 120 — another request with this key won the race. The
        // winner is read FIRST: the object is removed only once an Application
        // with this key is seen to reference ANOTHER object.
        const owner = await ownerOfKey();
        if (owner.state === 'OURS') {
          logger.warn({ ...context, event: 'application_persistence_confirmed', reason: insert.reason, applicationId: String(owner.record._id) }, 'duplicate key refusal: the recorded Application is ours');
          accepted = owner.record;
          break;
        }
        if (owner.state === 'OTHER') {
          // The server refused ours (unique index): its object is unreferenced.
          // The winner is answered only once majority-confirmed.
          await compensate(storageKey, 'IDEMPOTENCY_RACE_LOST');
          return answerConfirmed(owner.record);
        }
        keptForReconciliation(
          'application_persistence_ambiguous',
          { reason: insert.reason, readBack: owner.state },
          'idempotency race lost but the winner could not be read; stored resume kept for reconciliation; no success claimed',
        );
        throw applicationUnavailable(undefined, { reason: 'IDEMPOTENCY_WINNER_NOT_FOUND' });
      }

      case 'DUPLICATE_OTHER': {
        /*
         * A duplicate-key refusal that could not be attributed to the
         * idempotency index (the server did not say which index refused it).
         * Not persisted — but the object may be referenced by ANOTHER
         * Application, so it is only removed when that is proven false: an
         * Application with this key exists with another object, AND no
         * Application references ours. Then it was the idempotency race after
         * all. Anything else keeps the object.
         */
        const owner = await ownerOfKey();
        if (owner.state === 'OURS') {
          logger.warn({ ...context, event: 'application_persistence_confirmed', reason: insert.reason, applicationId: String(owner.record._id) }, 'duplicate key refusal: the recorded Application is ours');
          accepted = owner.record;
          break;
        }
        if (owner.state === 'OTHER') {
          let referenced = true;
          try {
            referenced = await applications.isStorageKeyReferenced(storageKey);
          } catch {
            referenced = true; // unknown: keep
          }
          if (referenced === false) {
            await compensate(storageKey, 'IDEMPOTENCY_RACE_LOST');
            return answerConfirmed(owner.record);
          }
        }
        keptForReconciliation(
          'application_storage_key_conflict',
          { reason: insert.reason, readBack: owner.state },
          'application not accepted: a unique index refused it and the owner could not be established; stored resume kept for reconciliation',
        );
        throw applicationUnavailable(undefined, { reason: 'APPLICATION_UNIQUE_CONFLICT' });
      }

      case 'NOT_PERSISTED':
        // Proven: nothing was sent, or the driver reports no write performed.
        await compensate(storageKey, `APPLICATION_NOT_PERSISTED_${insert.reason}`);
        throw applicationUnavailable(undefined, { reason: 'APPLICATION_PERSISTENCE_FAILED' });

      case 'INVALID':
        // Proven to fail before anything was sent: a defect, not an outage.
        await compensate(storageKey, `APPLICATION_INVALID_${insert.reason}`);
        throw insert.error;

      case 'AMBIGUOUS': {
        const owner = await ownerOfKey({ majority: true });
        if (owner.state === 'OURS') {
          // Proven persisted after all.
          logger.warn({ ...context, event: 'application_persistence_confirmed', reason: insert.reason, applicationId: String(owner.record._id) }, 'ambiguous insert confirmed by read-back');
          accepted = owner.record;
          break;
        }
        if (owner.state === 'OTHER') {
          // Another request with this key is the persisted Application; ours
          // can no longer be inserted (unique index), so its object is unreferenced.
          await compensate(storageKey, 'IDEMPOTENCY_RACE_LOST_AFTER_AMBIGUITY');
          return answerConfirmed(owner.record, { confirmed: true }); // read with read concern "majority"
        }
        keptForReconciliation(
          'application_persistence_ambiguous',
          {
            reason: insert.reason,
            readBack: owner.state,
            ...(insert.error === undefined ? {} : { err: safeErrorSummary(insert.error) }),
          },
          'application persistence outcome unknown; stored resume kept for reconciliation; no success claimed',
        );
        if (insert.settled) {
          track(
            insert.settled.then(async (kind) => {
              let resolved = kind;
              if (kind === 'DUPLICATE_KEY_HASH') {
                const late = await ownerOfKey();
                resolved = late.state === 'OTHER' ? 'NOT_PERSISTED' : late.state === 'OURS' ? 'CREATED' : 'UNKNOWN';
              }
              if (resolved === 'CREATED') {
                logger.warn({ ...context, event: 'application_persistence_resolved', outcome: 'PERSISTED' }, 'abandoned insert completed: the Application exists (notification left PENDING)');
              } else if (resolved === 'NOT_PERSISTED') {
                const compensation = await discardStoredResume({ storage, storageKey, logger, requestId });
                logger.warn({ ...context, event: 'application_persistence_resolved', outcome: 'NOT_PERSISTED', compensation }, 'abandoned insert proven not persisted: stored resume compensated');
              } else {
                keptForReconciliation(
                  'application_persistence_resolved',
                  { outcome: 'UNKNOWN', settledAs: kind },
                  'abandoned insert outcome still unknown; stored resume kept for reconciliation',
                );
              }
            }),
          );
        }
        throw applicationUnavailable(undefined, { reason: 'APPLICATION_PERSISTENCE_UNCONFIRMED' });
      }

      default:
        throw new Error('unexpected insert outcome');
    }

    // 10. ------------------------------------------------ notification --
    // B6: one claim / send / record cycle (application.notifications.js) for
    // the channels this acceptance made due. It can never undo the
    // Application (Doc 09 section 132); it runs only here, never on a replay
    // (section 135), and every provider call in it is bounded (section 136).
    const applicationId = String(accepted._id);
    let notification = { attempted: false, reason: 'NOT_CONFIGURED' };
    if (notifier.configured) {
      try {
        updatable ??= await applications.loadForUpdate(accepted._id);
      } catch {
        updatable = null;
      }
      if (updatable) {
        try {
          notification = await notifier.notifyAccepted(updatable, { requestId });
        } catch {
          // notifyAccepted never throws by contract; if it ever did, nothing is assumed sent.
          notification = { attempted: false, reason: 'NOTIFICATION_STEP_FAILED' };
        }
      } else {
        notification = { attempted: false, reason: 'APPLICATION_NOT_LOADED' };
      }
      if (notification.reason === 'APPLICATION_NOT_LOADED' || notification.reason === 'NOTIFICATION_STEP_FAILED') {
        logger.error(
          { ...context, event: 'notification_not_attempted', applicationId, reason: notification.reason },
          'the notification step did not run for the accepted application; its notification state stays as stored for the retry command',
        );
      }
    }
    const outcomeOf = (channel) => notification.outcomes?.[channel];
    logger.info(
      {
        ...context,
        event: 'application_accepted',
        applicationId,
        notification: outcomeOf('internal')?.status ?? 'NOT_ATTEMPTED',
        notificationReason: outcomeOf('internal')?.errorCode ?? (notification.attempted ? undefined : notification.reason),
        acknowledgement: outcomeOf('candidateAcknowledgement')?.status ?? (notifier.acknowledgementEnabled ? 'NOT_ATTEMPTED' : 'NOT_REQUIRED'),
      },
      'application accepted',
    );

    return resultFrom(accepted, false);
  }

  return Object.freeze({
    submit,
    /** Resolves when every pending follow-up has settled (tests only; see `track`). */
    async drainFollowUps() {
      await Promise.allSettled([...followUps]);
    },
  });
}
