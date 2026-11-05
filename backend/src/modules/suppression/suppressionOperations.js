import mongoose from 'mongoose';
import { Application } from '../../models/Application.js';
import { messageReference } from '../../integrations/notifications/smtpTransport.js';
import { NOTIFICATION_EVENTS } from '../../integrations/notifications/notificationService.js';
import { REQUIRED_INDEXES, diffIndexes } from '../../db/indexes.js';
import {
  ACTOR_PATTERN,
  DECISION_REF_PATTERN,
  EVIDENCE_REF_PATTERN,
  MAX_HISTORY,
  MAX_LOOKUPS,
  MAX_SOURCES,
  MESSAGE_TOKEN_PATTERN,
  RECOVERY_REASONS,
} from '../../models/RecipientSuppression.js';
import { runBounded } from '../jobs/job.repository.js';
import { assessCoverage } from './suppressionGate.js';
import { KEY_ID_PATTERN, hexValuesMatch } from './suppressionKeys.js';
import { SUPPRESSION_SCOPE, SuppressionWriteConflict, SuppressionWriteUnknown } from './suppressionRegister.js';

/**
 * `npm run ops:notifications:suppression -- <subcommand>` — the operator
 * workflow of RECIPIENT_SUPPRESSION_DESIGN.md rev 8 §3.4, §4.2-§4.5
 * (approved: OD-2026-11-04-02). Pure of process concerns: the script parses
 * arguments, connects and prints; this module decides and writes.
 *
 * DRY RUN BY DEFAULT. A write needs `apply: true` AND an `actor` listed in
 * SUPPRESSION_OPERATOR_IDS. Every refusal is a SuppressionRefused with a fixed
 * code, raised BEFORE anything is written. Every write is one document, a
 * validated save, conditional on its loaded version and durable
 * (suppressionRegister.js). A version conflict re-reads and retries (at most
 * three times); a write whose outcome is unknown stops the run (re-running is
 * safe: every subcommand is idempotent).
 *
 * Output carries internal ids, key ids, counts and fixed tokens only — never
 * an address, a digest, a check value or a key (§3.4, §4.3).
 */

export const ELIGIBLE_STATUS_CODES = Object.freeze(['5.1.1', '5.1.2', '5.1.3', '5.1.10']);
export const LIFT_REASONS = Object.freeze(['ADDRESS_CONFIRMED_VALID', 'ENTERED_IN_ERROR', 'SUPERSEDED']);
export const FORGET_REASONS = Object.freeze(['PRIVACY_REQUEST', 'RETENTION']);
export const COMPLAINT_KINDS = Object.freeze({ COMPLAINT: 'COMPLAINT_CONFIRMED', PROVIDER_NOTICE: 'PROVIDER_SUPPRESSION_CONFIRMED' });
export const OPERATION_LIMITS = Object.freeze({
  list: 500,
  batch: 500,
  bounceCandidates: 5_000,
  bounceWindowDays: 30,
  defaultBounceWindowDays: 7,
  dsnClockSkewMs: 5 * 60 * 1000,
});
/** Duplicate reports stop adding history entries here, keeping the last slots for LIFT / REKEY / release (§3.1). */
export const HISTORY_NEAR_CAP = MAX_HISTORY - 3;
const MAX_CONFLICT_RETRIES = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A refusal: nothing was written. */
export class SuppressionRefused extends Error {
  constructor(code, details = {}) {
    super(`refused: ${code}`);
    this.name = 'SuppressionRefused';
    this.code = code;
    this.details = details;
  }
}

const refuse = (code, details) => {
  throw new SuppressionRefused(code, details);
};

/** The `(keyId, digest)` pairs as a `lookups` match (rev 8.2: primary and aliases). */
const lookupsMatch = (pairs) => ({ $or: pairs.map(({ keyId, digest }) => ({ lookups: { $elemMatch: { keyId: { $eq: keyId }, digest: { $eq: digest } } } })) });
const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

/** The r9 Message-ID token of one Application's message for one event (smtpTransport.messageReference). */
export const messageTokenFor = (event, applicationId) => messageReference(`${event}/${String(applicationId)}`);

/**
 * @param {object} deps
 * @param {ReturnType<import('./suppressionRegister.js').createSuppressionRegister>} deps.register
 * @param {ReturnType<import('./suppressionKeys.js').createKeyring>} deps.keyring
 * @param {string[]} deps.operatorIds SUPPRESSION_OPERATOR_IDS
 * @param {() => Date} [deps.clock]
 * @param {import('mongoose').Model} [deps.applicationModel]
 * @param {number} [deps.timeoutMs] bound on each Application read
 */
export function createSuppressionOperations({ register, keyring, operatorIds = [], clock = () => new Date(), applicationModel = Application, timeoutMs = 5_000 }) {
  const ApplicationModel = applicationModel;
  const readApplication = (id, projection) =>
    runBounded(ApplicationModel, () => ApplicationModel.findOne({ _id: { $eq: id } }, projection).maxTimeMS(timeoutMs).lean(), timeoutMs);

  /** The write context: who, and with which request id. */
  function writer({ apply, actor, requestId }) {
    if (!apply) return null;
    if (typeof actor !== 'string' || !ACTOR_PATTERN.test(actor) || !operatorIds.includes(actor)) refuse('UNKNOWN_OPERATOR');
    return { actor, requestId: requestId ?? `ops-suppression-${clock().getTime()}` };
  }

  const history = (write, action, { reason = null, evidenceRef = null, decisionRef = null } = {}) => ({
    at: clock(),
    action,
    actor: write.actor,
    reason,
    evidenceRef,
    decisionRef,
    requestId: write.requestId,
  });

  const requireEvidenceRef = (value) => {
    if (typeof value !== 'string' || !EVIDENCE_REF_PATTERN.test(value)) refuse('INVALID_EVIDENCE_REF');
    return value;
  };
  const requireDecisionRef = (value) => {
    if (typeof value !== 'string' || !DECISION_REF_PATTERN.test(value)) refuse('INVALID_DECISION_REF');
    return value;
  };
  const requireApplicationId = (value) => {
    if (typeof value !== 'string' || !mongoose.isValidObjectId(value) || !/^[0-9a-f]{24}$/i.test(value)) refuse('INVALID_APPLICATION_ID');
    return new mongoose.Types.ObjectId(value);
  };
  const requireKeyId = (value) => {
    if (typeof value !== 'string' || !KEY_ID_PATTERN.test(value)) refuse('INVALID_KEY_ID');
    return value;
  };

  /** The unique register index must exist before anything is written (concurrent adds converge on it). */
  async function requireIndexes() {
    const required = REQUIRED_INDEXES.filter((index) => index.collection === 'recipient_suppressions');
    const { missing, incompatible } = diffIndexes(required, { recipient_suppressions: await register.listIndexes() });
    if (missing.length > 0 || incompatible.length > 0) refuse('INDEXES_MISSING', { indexes: [...missing, ...incompatible.map((entry) => entry.requirement)].map((index) => index.name) });
  }

  /** Coverage as the send path would see it now. */
  async function currentCoverage() {
    return assessCoverage({ ...(await register.readCoverageInputs()), keyring });
  }

  /** The current key is configured AND its key document is ACTIVE with a matching check value (§4.5.1). */
  async function requireVerifiedCurrentKey() {
    const keyId = keyring.currentKeyId;
    if (!keyId) refuse('CURRENT_KEY_MISSING');
    const document = await register.findKeyDocument(keyId);
    if (!document) refuse('CURRENT_KEY_NOT_REGISTERED', { keyId });
    if (document.state !== 'ACTIVE' || !hexValuesMatch(document.check, keyring.checkValueFor(keyId))) refuse('CURRENT_KEY_NOT_VERIFIED', { keyId });
    return keyId;
  }

  /** The first source whose Application still exists, with its stored normalised address (§4.2). */
  async function usableSource(entry) {
    for (const source of entry.sources ?? []) {
      const application = await readApplication(source.applicationId, { 'candidate.emailNormalized': 1 });
      if (application?.candidate?.emailNormalized) return { source, emailNormalized: application.candidate.emailNormalized };
    }
    return null;
  }

  const refuseAtHistoryCap = (entry) => {
    if (entry.history.length >= MAX_HISTORY) refuse('HISTORY_CAP_REACHED', { suppressionId: String(entry._id) });
  };

  /** Runs `attempt` again (fresh reads) after a version conflict; at most MAX_CONFLICT_RETRIES times. */
  async function retryOnConflict(attempt) {
    for (let round = 1; ; round += 1) {
      try {
        return await attempt();
      } catch (error) {
        if (!(error instanceof SuppressionWriteConflict) || round >= MAX_CONFLICT_RETRIES) throw error;
      }
    }
  }

  /**
   * Records a confirmed suppression for one stored address (the three `add`
   * variants). Idempotent: the same source again is ALREADY_ACTIVE; a new
   * source is a DUPLICATE report; a LIFTED entry under the current key is
   * REAPPLIED; otherwise a new entry is ADDED under the current key.
   */
  async function upsert({ emailNormalized, source, reason, basis, write }) {
    const currentKeyId = await requireVerifiedCurrentKey();
    await requireIndexes();
    const pairs = keyring.lookupPairs(emailNormalized);
    return retryOnConflict(async () => {
      const existing = await register.findEntries({ scope: { $eq: SUPPRESSION_SCOPE }, ...lookupsMatch(pairs) }, { limit: pairs.length + 1 });
      const active = existing.find((entry) => entry.state === 'ACTIVE' && entry.lookup.keyId === currentKeyId) ?? existing.find((entry) => entry.state === 'ACTIVE');
      if (active) {
        if (active.sources.some((item) => String(item.applicationId) === String(source.applicationId))) return { result: 'ALREADY_ACTIVE', suppressionId: String(active._id) };
        // §3.1: AT the history cap every further action is refused (B7 r3 review) — nothing is written.
        refuseAtHistoryCap(active);
        if (!write) return { result: 'WOULD_RECORD_DUPLICATE', suppressionId: String(active._id) };
        // §3.1: once the cap is NEAR, a duplicate report only increments duplicateReports.
        const nearCap = active.history.length >= HISTORY_NEAR_CAP;
        const sourceAdded = !nearCap && active.sources.length < MAX_SOURCES;
        if (sourceAdded) active.sources.push(source);
        active.duplicateReports += 1;
        if (!nearCap) active.history.push(history(write, 'DUPLICATE', { reason, evidenceRef: basis.evidenceRef }));
        await register.save(active);
        return { result: 'DUPLICATE', suppressionId: String(active._id), sourceAdded, historyAdded: !nearCap };
      }
      const lifted = existing.find((entry) => entry.state === 'LIFTED' && entry.lookup.keyId === currentKeyId);
      if (lifted) {
        // §3.1: refused AT the cap — in a dry run too, so the dry run reports what --apply would do.
        refuseAtHistoryCap(lifted);
        if (!write) return { result: 'WOULD_REAPPLY', suppressionId: String(lifted._id) };
        lifted.state = 'ACTIVE';
        lifted.reason = reason;
        lifted.basis = basis;
        if (!lifted.sources.some((item) => String(item.applicationId) === String(source.applicationId)) && lifted.sources.length < MAX_SOURCES) lifted.sources.push(source);
        lifted.history.push(history(write, 'REAPPLY', { reason, evidenceRef: basis.evidenceRef }));
        await register.save(lifted);
        return { result: 'REAPPLIED', suppressionId: String(lifted._id) };
      }
      if (!write) return { result: 'WOULD_ADD', keyId: currentKeyId };
      const digest = keyring.digestUnder(currentKeyId, emailNormalized);
      const entry = register.newEntry({
        lookup: { keyId: currentKeyId, digest },
        lookups: [{ keyId: currentKeyId, digest, retiredAt: null }],
        scope: SUPPRESSION_SCOPE,
        state: 'ACTIVE',
        reason,
        basis,
        sources: [source],
        duplicateReports: 0,
        history: [history(write, 'ADD', { reason, evidenceRef: basis.evidenceRef })],
      });
      // A concurrent add of the same address collides on the unique index:
      // that is a version-style conflict — re-read and handled as a duplicate.
      await register.save(entry);
      return { result: 'ADDED', suppressionId: String(entry._id), keyId: currentKeyId };
    });
  }

  /**
   * Rev 8.2 — moves an entry's PRIMARY lookup to `(keyId, digest)` and keeps
   * the old one as an alias, so the entry stays matchable under its old key
   * until the alias is pruned. `retiredAt` is informational only (rev 8.3: no
   * decision reads it). Returns false when the entry already holds
   * MAX_LOOKUPS lookups (left unchanged: prune first). A move does not change
   * `pruneSeq`: one key change between the send path's reads is harmless.
   */
  function moveLookup(entry, keyId, digest) {
    const lookups = entry.lookups.map((item) => ({ keyId: item.keyId, digest: item.digest, retiredAt: item.retiredAt ?? null }));
    const existing = lookups.find((item) => item.keyId === keyId && item.digest === digest);
    if (!existing && lookups.length >= MAX_LOOKUPS) return false;
    const now = clock();
    for (const item of lookups) if (item.retiredAt === null) item.retiredAt = now;
    if (existing) existing.retiredAt = null;
    else lookups.push({ keyId, digest, retiredAt: null });
    entry.lookups = lookups;
    entry.lookup = { keyId, digest };
    return true;
  }

  /**
   * Removes aliases (optionally only those under `keyId`), never a primary
   * lookup. Rev 8.3 (§9.6): no age or clock decides it. Each pruned entry is
   * stamped with a fresh prune sequence, allocated AFTER the entry was read and
   * saved in the same conditional, durable write as the removal, so any
   * send-path check that overlaps it sees the stamp change and does not
   * PROCEED. Bounded (`limit` entries); no history entry (no suppression
   * decision changes).
   */
  async function pruneAliases({ write, limit, keyId = null }) {
    const alias = { retiredAt: { $ne: null }, ...(keyId ? { keyId: { $eq: keyId } } : {}) };
    const entries = await register.findEntries({ lookups: { $elemMatch: alias } }, { limit });
    let pruned = 0;
    let waiting = 0;
    for (const entry of entries) {
      const keep = entry.lookups.filter((item) => item.retiredAt === null || (keyId !== null && item.keyId !== keyId));
      const removed = entry.lookups.length - keep.length;
      if (removed === 0) continue;
      if (!write) {
        waiting += removed;
        continue;
      }
      entry.pruneSeq = await register.allocatePruneSeq();
      entry.lookups = keep.map((item) => ({ keyId: item.keyId, digest: item.digest, retiredAt: item.retiredAt ?? null }));
      try {
        await register.save(entry);
        pruned += removed;
      } catch (error) {
        if (!(error instanceof SuppressionWriteConflict)) throw error;
      }
    }
    return { pruned, prunable: waiting };
  }

  const requireCursor = (after) => {
    if (after === undefined || after === null) return null;
    if (typeof after !== 'string' || !OBJECT_ID_HEX.test(after)) refuse('INVALID_CURSOR');
    return new mongoose.Types.ObjectId(after);
  };

  /**
   * One bounded, resumable pass (B7 r3 review): examines at most `limit`
   * entries in `_id` order after the cursor, so entries that stay unresolved
   * can never hold back later ones — the next run continues from `nextAfter`.
   * An unknown write stops the pass with `resumeAfter`: the last entry fully
   * handled before it (the failed one is examined again; every step is
   * idempotent).
   */
  async function boundedPass({ filter, after, limit, handle }) {
    const cursor = requireCursor(after);
    const entries = await register.findEntries({ ...filter, ...(cursor ? { _id: { $gt: cursor } } : {}) }, { limit, sort: { _id: 1 } });
    let lastHandled = cursor ? String(cursor) : null;
    for (const entry of entries) {
      try {
        await handle(entry);
      } catch (error) {
        if (error instanceof SuppressionWriteUnknown) error.resumeAfter = lastHandled;
        throw error;
      }
      lastHandled = String(entry._id);
    }
    return { examined: entries.length, nextAfter: entries.length === limit ? lastHandled : null };
  }

  const acknowledgementSource = (applicationId, channel) => ({
    applicationId,
    attempt: Number.isInteger(channel?.attemptCount) && channel.attemptCount >= 1 ? channel.attemptCount : null,
    messageToken: messageTokenFor(NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT, applicationId),
  });

  return Object.freeze({
    /** `list [--state] [--limit ≤ 500]` — never an address or digest. */
    async list({ state = null, limit = 50 } = {}) {
      if (state !== null && !['ACTIVE', 'LIFTED'].includes(state)) refuse('INVALID_STATE');
      if (!Number.isInteger(limit) || limit < 1 || limit > OPERATION_LIMITS.list) refuse('INVALID_LIMIT');
      const entries = await register.findEntries(state ? { state: { $eq: state } } : {}, { limit, sort: { updatedAt: -1, _id: 1 } });
      return {
        entries: entries.map((entry) => ({
          suppressionId: String(entry._id),
          state: entry.state,
          keyId: entry.lookup.keyId,
          reason: entry.reason,
          basis: { kind: entry.basis.kind, statusCode: entry.basis.statusCode, evidenceRef: entry.basis.evidenceRef },
          sourceApplicationIds: entry.sources.map((source) => String(source.applicationId)),
          duplicateReports: entry.duplicateReports,
          historyEntries: entry.history.length,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        })),
      };
    },

    /** `check --application <id>` — ACTIVE / LIFTED / NONE for that Application's stored address. */
    async check({ applicationId }) {
      const id = requireApplicationId(applicationId);
      const application = await readApplication(id, { 'candidate.emailNormalized': 1 });
      if (!application) refuse('APPLICATION_NOT_FOUND');
      const coverage = await currentCoverage();
      if (!keyring.currentKeyId) return { state: 'UNKNOWN', coverage: coverage.complete ? 'COVERAGE_COMPLETE' : 'COVERAGE_INCOMPLETE', problems: coverage.problems };
      const pairs = keyring.lookupPairs(application.candidate.emailNormalized);
      const entries = await register.findEntries({ scope: { $eq: SUPPRESSION_SCOPE }, ...lookupsMatch(pairs) }, { limit: pairs.length + 1 });
      const active = entries.find((entry) => entry.state === 'ACTIVE');
      const found = active ?? entries[0] ?? null;
      return {
        state: found ? found.state : 'NONE',
        ...(found ? { suppressionId: String(found._id), keyId: found.lookup.keyId } : {}),
        coverage: coverage.complete ? 'COVERAGE_COMPLETE' : 'COVERAGE_INCOMPLETE',
        problems: coverage.problems,
      };
    },

    /** `add --from-refusal --application <id> --evidence-ref <ref>` (SUP-1). */
    async addFromRefusal({ applicationId, evidenceRef, apply = false, actor, requestId }) {
      const id = requireApplicationId(applicationId);
      requireEvidenceRef(evidenceRef);
      const write = writer({ apply, actor, requestId });
      const application = await readApplication(id, { 'candidate.emailNormalized': 1, 'notifications.candidateAcknowledgement': 1 });
      if (!application) refuse('APPLICATION_NOT_FOUND');
      const channel = application.notifications?.candidateAcknowledgement;
      if (channel?.status !== 'FAILED' || channel.lastErrorCode !== 'INVALID_RECIPIENT') refuse('NOT_A_RELAY_REFUSAL');
      if (!ELIGIBLE_STATUS_CODES.includes(channel.lastStatusCode)) refuse('STATUS_NOT_ELIGIBLE');
      return upsert({
        emailNormalized: application.candidate.emailNormalized,
        source: acknowledgementSource(id, channel),
        reason: 'INVALID_RECIPIENT_CONFIRMED',
        basis: { kind: 'RELAY_REFUSAL', statusCode: channel.lastStatusCode, evidenceRef },
        write,
      });
    },

    /**
     * `add --from-bounce --message-token <32 hex> --status <x.y.z> --dsn-received <ISO> --evidence-ref <ref> [--window-days ≤ 30]` (SUP-2).
     * The address comes from the ONE matched Application — never typed in.
     */
    async addFromBounce({ messageToken, status, dsnReceived, evidenceRef, windowDays = OPERATION_LIMITS.defaultBounceWindowDays, apply = false, actor, requestId }) {
      if (typeof messageToken !== 'string' || !MESSAGE_TOKEN_PATTERN.test(messageToken)) refuse('INVALID_MESSAGE_TOKEN');
      if (!ELIGIBLE_STATUS_CODES.includes(status)) refuse('STATUS_NOT_ELIGIBLE');
      requireEvidenceRef(evidenceRef);
      if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > OPERATION_LIMITS.bounceWindowDays) refuse('INVALID_WINDOW');
      const received = dsnReceived instanceof Date ? dsnReceived : new Date(dsnReceived);
      if (Number.isNaN(received.getTime()) || received.getTime() > clock().getTime() + OPERATION_LIMITS.dsnClockSkewMs) refuse('INVALID_DSN_TIME');
      const write = writer({ apply, actor, requestId });
      const window = { $gte: new Date(received.getTime() - windowDays * DAY_MS), $lte: received };
      const candidates = await runBounded(
        ApplicationModel,
        () =>
          ApplicationModel.find(
            { $or: [{ 'notifications.candidateAcknowledgement.lastAttemptAt': window }, { 'notifications.internal.lastAttemptAt': window }] },
            { _id: 1, 'notifications.candidateAcknowledgement': 1, 'notifications.internal.lastAttemptAt': 1 },
          )
            .limit(OPERATION_LIMITS.bounceCandidates + 1)
            .maxTimeMS(timeoutMs)
            .lean(),
        timeoutMs,
      );
      if (candidates.length > OPERATION_LIMITS.bounceCandidates) refuse('TOO_MANY_CANDIDATES');
      const inWindow = (time) => time instanceof Date && time >= window.$gte && time <= window.$lte;
      if (candidates.some((row) => inWindow(row.notifications?.internal?.lastAttemptAt) && messageTokenFor(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, row._id) === messageToken)) {
        refuse('INTERNAL_CHANNEL_MATCH');
      }
      const matches = candidates.filter(
        (row) => inWindow(row.notifications?.candidateAcknowledgement?.lastAttemptAt) && messageTokenFor(NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT, row._id) === messageToken,
      );
      if (matches.length === 0) refuse('NO_MATCH');
      if (matches.length > 1) refuse('MULTIPLE_MATCHES');
      const [match] = matches;
      if (match.notifications.candidateAcknowledgement.status !== 'SENT') refuse('CHANNEL_NOT_SENT');
      const application = await readApplication(match._id, { 'candidate.emailNormalized': 1 });
      if (!application) refuse('APPLICATION_NOT_FOUND');
      return upsert({
        emailNormalized: application.candidate.emailNormalized,
        source: acknowledgementSource(match._id, match.notifications.candidateAcknowledgement),
        reason: 'INVALID_RECIPIENT_CONFIRMED',
        basis: { kind: 'ASYNC_BOUNCE', statusCode: status, evidenceRef },
        write,
      });
    },

    /** `add --complaint --application <id> --kind COMPLAINT|PROVIDER_NOTICE --evidence-ref <ref>` (operator-attested notice). */
    async addComplaint({ applicationId, kind, evidenceRef, apply = false, actor, requestId }) {
      const id = requireApplicationId(applicationId);
      if (!Object.hasOwn(COMPLAINT_KINDS, kind)) refuse('INVALID_KIND');
      requireEvidenceRef(evidenceRef);
      const write = writer({ apply, actor, requestId });
      const application = await readApplication(id, { 'candidate.emailNormalized': 1, 'notifications.candidateAcknowledgement': 1 });
      if (!application) refuse('APPLICATION_NOT_FOUND');
      return upsert({
        emailNormalized: application.candidate.emailNormalized,
        source: acknowledgementSource(id, application.notifications?.candidateAcknowledgement),
        reason: COMPLAINT_KINDS[kind],
        basis: { kind: kind === 'COMPLAINT' ? 'COMPLAINT' : 'PROVIDER_NOTICE', statusCode: null, evidenceRef },
        write,
      });
    },

    /**
     * `lift --suppression <id> --reason ADDRESS_CONFIRMED_VALID|ENTERED_IN_ERROR|SUPERSEDED --evidence-ref <ref>` (SUP-5).
     * Nothing is ever resent. SUPERSEDED closes a controlled-recovery conflict only while
     * the address stays ACTIVE under the current key (§3.4, §4.2).
     */
    async lift({ suppressionId, reason, evidenceRef, apply = false, actor, requestId }) {
      if (typeof suppressionId !== 'string' || !/^[0-9a-f]{24}$/i.test(suppressionId)) refuse('INVALID_SUPPRESSION_ID');
      if (!LIFT_REASONS.includes(reason)) refuse('INVALID_REASON');
      requireEvidenceRef(evidenceRef);
      const write = writer({ apply, actor, requestId });
      return retryOnConflict(async () => {
        const entry = await register.findEntry({ _id: { $eq: new mongoose.Types.ObjectId(suppressionId) } });
        if (!entry) refuse('SUPPRESSION_NOT_FOUND');
        if (entry.state !== 'ACTIVE') refuse('NOT_ACTIVE');
        if (reason === 'SUPERSEDED') {
          const keyDocument = await register.findKeyDocument(entry.lookup.keyId);
          if (keyDocument?.state !== 'RECOVERING') refuse('NOT_IN_RECOVERY');
          const currentKeyId = await requireVerifiedCurrentKey();
          const usable = await usableSource(entry);
          if (!usable) refuse('NOT_SUPERSEDED');
          const replacement = await register.findEntry({
            'lookup.keyId': { $eq: currentKeyId },
            'lookup.digest': { $eq: keyring.digestUnder(currentKeyId, usable.emailNormalized) },
            scope: { $eq: SUPPRESSION_SCOPE },
            state: { $eq: 'ACTIVE' },
          });
          if (!replacement || String(replacement._id) === String(entry._id)) refuse('NOT_SUPERSEDED');
        }
        refuseAtHistoryCap(entry);
        if (!write) return { result: 'WOULD_LIFT', suppressionId };
        entry.state = 'LIFTED';
        entry.history.push(history(write, 'LIFT', { reason, evidenceRef }));
        await register.save(entry);
        return { result: 'LIFTED', suppressionId, resent: 0 };
      });
    },

    /** `forget --application <id> --reason PRIVACY_REQUEST|RETENTION --evidence-ref <ref>` (§4.3, SUP-6). */
    async forget({ applicationId, reason, evidenceRef, apply = false, actor, requestId }) {
      const id = requireApplicationId(applicationId);
      if (!FORGET_REASONS.includes(reason)) refuse('INVALID_REASON');
      requireEvidenceRef(evidenceRef);
      const write = writer({ apply, actor, requestId });
      const entries = await register.findEntries({ 'sources.applicationId': { $eq: id } }, { limit: OPERATION_LIMITS.batch });
      const items = [];
      for (const entry of entries) {
        const remaining = entry.sources.filter((source) => String(source.applicationId) !== String(id));
        const deletes = remaining.length === 0 && reason === 'PRIVACY_REQUEST';
        if (!write) {
          items.push({ suppressionId: String(entry._id), result: deletes ? 'WOULD_DELETE' : 'WOULD_REMOVE_SOURCE' });
          continue;
        }
        if (deletes) {
          await register.removeIfUnchanged(entry);
          items.push({ suppressionId: String(entry._id), result: 'DELETED' });
          continue;
        }
        refuseAtHistoryCap(entry);
        entry.sources = remaining;
        entry.history.push(history(write, 'FORGET_SOURCE', { reason, evidenceRef }));
        await register.save(entry);
        items.push({ suppressionId: String(entry._id), result: 'SOURCE_REMOVED', sourcesLeft: remaining.length });
      }
      return { result: items.length === 0 ? 'NOTHING_TO_FORGET' : 'DONE', items };
    },

    /** `coverage` — read-only (§3.4, §4.4; rev 8.2 counts aliases). */
    async coverage() {
      const [coverage, counts] = await Promise.all([currentCoverage(), register.activeCountsByKey()]);
      const byKey = new Map(counts.map((row) => [row._id, row]));
      const keys = coverage.keys.map((key) => {
        const count = byKey.get(key.keyId);
        const active = count?.active ?? 0;
        const aliases = count?.aliases ?? 0;
        return {
          ...key,
          activeEntries: active,
          activeListingSource: count?.listingSource ?? 0,
          aliasEntries: aliases,
          // A previous key may be removed only when no ACTIVE entry can still be matched under it.
          ...(key.role === 'PREVIOUS' ? { safeToRetire: active === 0 && aliases === 0 } : {}),
        };
      });
      return { result: coverage.complete ? 'COVERAGE_COMPLETE' : 'COVERAGE_INCOMPLETE', problems: coverage.problems, keys };
    },

    /** `key-register --key-id <id>` — fresh key ids only (§4.5.1 rev 8; SUP-22d, SUP-22g). */
    async keyRegister({ keyId, apply = false, actor, requestId }) {
      requireKeyId(keyId);
      if (!keyring.has(keyId)) refuse('KEY_NOT_CONFIGURED');
      const write = writer({ apply, actor, requestId });
      // Any entry — any state, primary OR alias lookup — makes the id "already used".
      if ((await register.countEntries({ $or: [{ 'lookup.keyId': { $eq: keyId } }, { 'lookups.keyId': { $eq: keyId } }] })) > 0) refuse('KEY_ID_ALREADY_USED');
      if (await register.findKeyDocument(keyId)) refuse('KEY_ID_ALREADY_USED');
      if (!write) return { result: 'WOULD_REGISTER', keyId };
      try {
        await register.save(register.newKeyDocument({ _id: keyId, check: keyring.checkValueFor(keyId), state: 'ACTIVE', recovery: null, createdBy: write.actor, requestId: write.requestId }));
      } catch (error) {
        // Registered concurrently: never overwritten.
        if (error instanceof SuppressionWriteConflict) refuse('KEY_ID_ALREADY_USED');
        throw error;
      }
      return { result: 'REGISTERED', keyId };
    },

    /**
     * `rekey [--limit ≤ 500] [--after <suppression id>]` — ORDINARY, VERIFIED
     * rotation only (§4.2 rev 8; SUP-16, SUP-19, SUP-23a). Refused unless
     * coverage is complete; every entry is confirmed under its old key before
     * it moves; never SOURCE_UNVERIFIED. Rev 8.2: a move keeps the old lookup
     * as an alias; aliases left by earlier runs are pruned first (rev 8.3: no
     * waiting period — the prune stamp protects the send path).
     * Bounded and resumable (SUP-25): `limit` entries examined after `after`.
     */
    async rekey({ limit = OPERATION_LIMITS.batch, after = null, apply = false, actor, requestId } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > OPERATION_LIMITS.batch) refuse('INVALID_LIMIT');
      requireCursor(after);
      const write = writer({ apply, actor, requestId });
      const before = await currentCoverage();
      if (!before.complete) refuse('COVERAGE_INCOMPLETE', { problems: before.problems });
      const currentKeyId = keyring.currentKeyId;
      const { pruned, prunable } = await pruneAliases({ write, limit });
      const counts = { moved: 0, wouldMove: 0, withoutSource: 0, digestMismatch: 0, conflict: 0, versionConflict: 0, historyCap: 0, lookupCap: 0 };
      const pass = await boundedPass({
        filter: { state: { $eq: 'ACTIVE' }, scope: { $eq: SUPPRESSION_SCOPE }, 'lookup.keyId': { $ne: currentKeyId } },
        after,
        limit,
        handle: async (entry) => {
          const usable = await usableSource(entry);
          if (!usable) return void (counts.withoutSource += 1);
          if (!hexValuesMatch(keyring.digestUnder(entry.lookup.keyId, usable.emailNormalized), entry.lookup.digest)) return void (counts.digestMismatch += 1);
          const digest = keyring.digestUnder(currentKeyId, usable.emailNormalized);
          if (await register.findEntry({ 'lookup.keyId': { $eq: currentKeyId }, 'lookup.digest': { $eq: digest }, scope: { $eq: SUPPRESSION_SCOPE } })) return void (counts.conflict += 1);
          if (entry.history.length >= MAX_HISTORY) return void (counts.historyCap += 1);
          if (!write) return void (counts.wouldMove += 1);
          if (!moveLookup(entry, currentKeyId, digest)) return void (counts.lookupCap += 1);
          entry.history.push(history(write, 'REKEY', { reason: 'ROTATION' }));
          try {
            await register.save(entry);
            counts.moved += 1;
          } catch (error) {
            if (!(error instanceof SuppressionWriteConflict)) throw error;
            counts[error.kind === 'DUPLICATE_KEY' ? 'conflict' : 'versionConflict'] += 1;
          }
        },
      });
      const after_ = await currentCoverage();
      const remaining = await register.countEntries({ state: { $eq: 'ACTIVE' }, scope: { $eq: SUPPRESSION_SCOPE }, 'lookup.keyId': { $ne: currentKeyId } });
      return {
        result: write ? 'DONE' : 'DRY_RUN',
        currentKeyId,
        ...counts,
        examined: pass.examined,
        nextAfter: pass.nextAfter,
        aliasesPruned: pruned,
        aliasesPrunable: prunable,
        remainingUnderPreviousKeys: remaining,
        coverage: after_.complete ? 'COVERAGE_COMPLETE' : 'COVERAGE_INCOMPLETE',
      };
    },

    /**
     * `recover-key` — CONTROLLED RECOVERY of a lost or untrusted key (§4.2 rev 8; SUP-23).
     * First run: marks the id RECOVERING (permanently untrusted). Every run with
     * `apply` moves each ACTIVE entry that has a source to the current key
     * (REKEY / SOURCE_UNVERIFIED), keeping the old lookup as an alias (rev 8.2),
     * in bounded, resumable passes (`limit`, `after`; SUP-25). `complete` prunes
     * the id's aliases (rev 8.3: at once, stamped) and retires the id when no
     * ACTIVE entry can be matched under it any more.
     * Acknowledgements stay blocked until then (suppressionGate: a RECOVERING
     * key document — and any lookup under an unconfigured id — makes coverage
     * incomplete).
     */
    async recoverKey({ keyId, decisionRef, evidenceRef, confirmKeyUnavailable = false, expectedCount, reason, limit = OPERATION_LIMITS.batch, after = null, complete = false, apply = false, actor, requestId }) {
      requireKeyId(keyId);
      requireDecisionRef(decisionRef);
      requireEvidenceRef(evidenceRef);
      if (confirmKeyUnavailable !== true) refuse('CONFIRMATION_REQUIRED');
      if (!Number.isInteger(limit) || limit < 1 || limit > OPERATION_LIMITS.batch) refuse('INVALID_LIMIT');
      requireCursor(after);
      const write = writer({ apply, actor, requestId });
      if (keyring.has(keyId)) refuse('KEY_STILL_CONFIGURED');
      const currentKeyId = await requireVerifiedCurrentKey();
      if (currentKeyId === keyId) refuse('KEY_STILL_CONFIGURED');

      const activeUnder = { state: { $eq: 'ACTIVE' }, scope: { $eq: SUPPRESSION_SCOPE }, 'lookup.keyId': { $eq: keyId } };
      const matchableUnder = { state: { $eq: 'ACTIVE' }, scope: { $eq: SUPPRESSION_SCOPE }, 'lookups.keyId': { $eq: keyId } };
      let keyDocument = await register.findKeyDocument(keyId);
      if (keyDocument?.state === 'RETIRED') refuse('KEY_RETIRED');
      const firstRun = keyDocument?.state !== 'RECOVERING';
      if (!firstRun && keyDocument.recovery?.decisionRef !== decisionRef) refuse('DECISION_REF_MISMATCH');

      if (complete) {
        if (firstRun) refuse('NOT_RECOVERING');
        const left = await register.countEntries(activeUnder);
        if (left > 0) refuse('ENTRIES_REMAIN', { activeEntries: left });
        const { pruned, prunable } = await pruneAliases({ write, limit, keyId });
        const aliasesLeft = await register.countEntries(matchableUnder);
        if (!write) return { result: 'WOULD_COMPLETE', keyId, aliasesPrunable: prunable, aliasesWaiting: aliasesLeft - prunable };
        // Aliases beyond this batch (--limit) or in a write conflict: run --complete again.
        if (aliasesLeft > 0) refuse('ALIASES_PENDING', { aliasEntries: aliasesLeft, aliasesPruned: pruned });
        await retryOnConflict(async () => {
          const fresh = await register.findKeyDocument(keyId);
          if (fresh?.state !== 'RECOVERING') refuse('NOT_RECOVERING');
          fresh.state = 'RETIRED';
          fresh.recovery = { ...fresh.recovery.toObject(), completedAt: clock(), completedBy: write.actor };
          await register.save(fresh);
        });
        const after_ = await currentCoverage();
        return { result: 'COMPLETED', keyId, keyState: 'RETIRED', aliasesPruned: pruned, coverage: after_.complete ? 'COVERAGE_COMPLETE' : 'COVERAGE_INCOMPLETE', problems: after_.problems };
      }

      if (firstRun) {
        if (!RECOVERY_REASONS.includes(reason)) refuse('RECOVERY_REASON_REQUIRED');
        const count = await register.countEntries(activeUnder);
        if (expectedCount !== count) refuse('COUNT_MISMATCH', { activeEntries: count });
        if (!write) return { result: 'WOULD_START_RECOVERY', keyId, activeEntries: count };
        const recovery = { decisionRef, evidenceRef, reason, startedAt: clock(), startedBy: write.actor, startCount: count, completedAt: null, completedBy: null };
        if (keyDocument) {
          keyDocument.state = 'RECOVERING';
          keyDocument.recovery = recovery;
        } else {
          keyDocument = register.newKeyDocument({ _id: keyId, check: null, state: 'RECOVERING', recovery, createdBy: write.actor, requestId: write.requestId });
        }
        try {
          await register.save(keyDocument);
        } catch (error) {
          if (error instanceof SuppressionWriteConflict) refuse('CONCURRENT_KEY_CHANGE');
          throw error;
        }
      }

      const counts = { moved: 0, wouldMove: 0, withoutSource: 0, conflictActive: 0, conflictLifted: 0, versionConflict: 0, historyCap: 0, lookupCap: 0 };
      const pass = await boundedPass({
        filter: activeUnder,
        after,
        limit,
        handle: async (entry) => {
          const usable = await usableSource(entry);
          if (!usable) return void (counts.withoutSource += 1);
          const digest = keyring.digestUnder(currentKeyId, usable.emailNormalized);
          const existing = await register.findEntry({ 'lookup.keyId': { $eq: currentKeyId }, 'lookup.digest': { $eq: digest }, scope: { $eq: SUPPRESSION_SCOPE } });
          if (existing) return void (counts[existing.state === 'ACTIVE' ? 'conflictActive' : 'conflictLifted'] += 1);
          if (entry.history.length >= MAX_HISTORY) return void (counts.historyCap += 1);
          if (!write) return void (counts.wouldMove += 1);
          if (!moveLookup(entry, currentKeyId, digest)) return void (counts.lookupCap += 1);
          entry.history.push(history(write, 'REKEY', { reason: 'SOURCE_UNVERIFIED', evidenceRef, decisionRef }));
          try {
            await register.save(entry);
            counts.moved += 1;
          } catch (error) {
            if (!(error instanceof SuppressionWriteConflict)) throw error;
            if (error.kind === 'DUPLICATE_KEY') counts.conflictActive += 1;
            else counts.versionConflict += 1;
          }
        },
      });
      const left = await register.countEntries(activeUnder);
      const after_ = await currentCoverage();
      return {
        result: write ? 'RECOVERY_RUN' : 'DRY_RUN',
        keyId,
        keyState: write ? 'RECOVERING' : keyDocument?.state ?? 'NONE',
        ...counts,
        examined: pass.examined,
        nextAfter: pass.nextAfter,
        activeEntriesLeft: left,
        coverage: after_.complete ? 'COVERAGE_COMPLETE' : 'COVERAGE_INCOMPLETE',
      };
    },

    /**
     * `resolve-unrecoverable --key-id <id> --expected-count <n> --confirm-key-unavailable --decision-ref <OD-…> --evidence-ref <ref>`
     * (§4.4; SUP-21). Releases ACTIVE entries under an unavailable key that have
     * no remaining source. Nothing is resent. While the key is RECOVERING,
     * sending stays blocked until `recover-key --complete` (OD-2026-11-04-02).
     */
    async resolveUnrecoverable({ keyId, expectedCount, confirmKeyUnavailable = false, decisionRef, evidenceRef, apply = false, actor, requestId }) {
      requireKeyId(keyId);
      requireDecisionRef(decisionRef);
      requireEvidenceRef(evidenceRef);
      if (confirmKeyUnavailable !== true) refuse('CONFIRMATION_REQUIRED');
      if (!Number.isInteger(expectedCount) || expectedCount < 1) refuse('INVALID_EXPECTED_COUNT');
      const write = writer({ apply, actor, requestId });
      if (keyring.has(keyId)) refuse('KEY_CONFIGURED');
      const activeUnder = { state: { $eq: 'ACTIVE' }, scope: { $eq: SUPPRESSION_SCOPE }, 'lookup.keyId': { $eq: keyId } };
      const entries = await register.findEntries(activeUnder, { limit: OPERATION_LIMITS.batch + 1 });
      if (entries.length > OPERATION_LIMITS.batch) refuse('TOO_MANY_ENTRIES');
      for (const entry of entries) {
        if (await usableSource(entry)) refuse('ENTRY_HAS_SOURCE', { suppressionId: String(entry._id) });
        refuseAtHistoryCap(entry);
      }
      if (entries.length !== expectedCount) refuse('COUNT_MISMATCH', { activeEntries: entries.length });
      if (!write) return { result: 'WOULD_RELEASE', keyId, entries: entries.length };
      let released = 0;
      for (const entry of entries) {
        entry.state = 'LIFTED';
        entry.history.push(history(write, 'RELEASE_UNRECOVERABLE', { reason: 'KEY_UNAVAILABLE', evidenceRef, decisionRef }));
        await register.save(entry);
        released += 1;
      }
      const keyDocument = await register.findKeyDocument(keyId);
      const after = await currentCoverage();
      return {
        result: 'RELEASED',
        keyId,
        released,
        resent: 0,
        keyState: keyDocument?.state ?? 'NONE',
        coverage: after.complete ? 'COVERAGE_COMPLETE' : 'COVERAGE_INCOMPLETE',
        problems: after.problems,
      };
    },
  });
}
