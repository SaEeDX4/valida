import mongoose from 'mongoose';
import { restrictToValidatedSaves } from './writeGuards.js';
import { DIGEST_PATTERN, KEY_ID_PATTERN } from '../modules/suppression/suppressionKeys.js';

/**
 * The recipient-suppression register — a Doc 10 addition approved with
 * RECIPIENT_SUPPRESSION_DESIGN.md rev 8 (OD-2026-11-04-02).
 *
 *   recipient_suppressions        §3.1: one document per (key id, address digest, scope)
 *   recipient_suppression_keys    §4.5.1: one key check value per key id
 *
 * NO plaintext address, name, DSN text, provider reply text or subject is ever
 * stored here: the lookup is a keyed HMAC (§4.1) and every other field is a
 * fixed token, a bounded reference or an internal id.
 *
 * Writes: validated document saves only (writeGuards), CONDITIONAL on
 * `version` (Mongoose optimistic concurrency: the save filter carries the
 * loaded version and a mismatch is a VersionError, never a silent overwrite),
 * durable (`w: majority, j: true`, set per operation by the suppression
 * register). Arrays are bounded; at the history cap further actions are
 * REFUSED rather than dropping entries.
 */

export const SUPPRESSION_SCOPES = Object.freeze(['APPLICATION_ACKNOWLEDGEMENT']);
export const SUPPRESSION_STATES = Object.freeze(['ACTIVE', 'LIFTED']);
export const SUPPRESSION_REASONS = Object.freeze(['INVALID_RECIPIENT_CONFIRMED', 'COMPLAINT_CONFIRMED', 'PROVIDER_SUPPRESSION_CONFIRMED']);
export const SUPPRESSION_BASIS_KINDS = Object.freeze(['RELAY_REFUSAL', 'ASYNC_BOUNCE', 'COMPLAINT', 'PROVIDER_NOTICE']);
export const HISTORY_ACTIONS = Object.freeze(['ADD', 'DUPLICATE', 'LIFT', 'REAPPLY', 'REKEY', 'FORGET_SOURCE', 'RELEASE_UNRECOVERABLE']);
export const KEY_DOCUMENT_STATES = Object.freeze(['ACTIVE', 'RECOVERING', 'RETIRED']);
export const RECOVERY_REASONS = Object.freeze(['LOST', 'UNTRUSTED']);

export const MAX_SOURCES = 10;
export const MAX_HISTORY = 20;
/**
 * Rev 8.2 (B7 r3 review correction): the lookups an entry can currently be
 * matched under — its primary `lookup` plus the earlier lookups a key move
 * left behind (aliases), until they are pruned after ALIAS_QUIET_PERIOD_MS.
 */
export const MAX_LOOKUPS = 8;
/**
 * An alias is pruned only when it has been an alias for at least this long.
 * It must exceed, by a wide margin, the longest window over which one
 * send-path check reads the register (SUPPRESSION_LOOKUP_TIMEOUT_MS ≤ 10 s)
 * plus any clock difference between operator processes: then no check can
 * have read coverage before a move and its lookup after the prune.
 */
export const ALIAS_QUIET_PERIOD_MS = 10 * 60 * 1000;

/** §3.1 — the R3 evidence-reference pattern, with no "@". */
export const EVIDENCE_REF_PATTERN = /^[A-Za-z0-9._:/#-]{1,80}$/;
/** An owner-decision identifier. */
export const DECISION_REF_PATTERN = /^OD-\d{4}-\d{2}-\d{2}-\d{2}$/;
/** A standard enhanced status code (RFC 3463), never provider text. */
export const STATUS_CODE_PATTERN = /^[245]\.\d{1,3}\.\d{1,3}$/;
/** The r9 Message-ID token: 32 hex characters derived from the event and Application id. */
export const MESSAGE_TOKEN_PATTERN = /^[0-9a-f]{32}$/;
/** An operator identifier token (§3.4) — never an email address. */
export const ACTOR_PATTERN = /^[a-z0-9][a-z0-9._-]{1,39}$/;
const REASON_TOKEN = /^[A-Z][A-Z0-9_]{1,63}$/;
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,80}$/;

const sourceSchema = new mongoose.Schema(
  {
    applicationId: { type: mongoose.Schema.Types.ObjectId, required: true },
    attempt: { type: Number, default: null, min: 1, validate: { validator: (value) => value === null || Number.isInteger(value), message: 'attempt must be an integer' } },
    messageToken: { type: String, default: null, match: MESSAGE_TOKEN_PATTERN },
  },
  { _id: false },
);

const lookupEntrySchema = new mongoose.Schema(
  {
    keyId: { type: String, required: true, match: KEY_ID_PATTERN },
    digest: { type: String, required: true, match: DIGEST_PATTERN },
    // null for the primary lookup; the time it stopped being primary for an alias.
    retiredAt: { type: Date, default: null },
  },
  { _id: false },
);

const historySchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    action: { type: String, required: true, enum: HISTORY_ACTIONS },
    actor: { type: String, required: true, match: ACTOR_PATTERN },
    reason: { type: String, default: null, match: REASON_TOKEN },
    evidenceRef: { type: String, default: null, match: EVIDENCE_REF_PATTERN },
    decisionRef: { type: String, default: null, match: DECISION_REF_PATTERN },
    requestId: { type: String, default: null, match: REQUEST_ID },
  },
  { _id: false },
);

const recipientSuppressionSchema = new mongoose.Schema(
  {
    lookup: {
      keyId: { type: String, required: true, match: KEY_ID_PATTERN },
      digest: { type: String, required: true, match: DIGEST_PATTERN },
    },
    /*
     * Rev 8.2 — every lookup the entry can be matched under: the primary (also
     * in `lookup`, retiredAt null) and the aliases a key move left behind. The
     * send path matches ONLY through this array and computes coverage from its
     * key ids, so a move never makes an entry unmatchable for a sender that
     * holds the old key, and never hides the old key from a sender that lacks it.
     */
    lookups: {
      type: [lookupEntrySchema],
      default: undefined,
      validate: [(items) => Array.isArray(items) && items.length >= 1 && items.length <= MAX_LOOKUPS, `1 to ${MAX_LOOKUPS} lookups`],
    },
    scope: { type: String, required: true, enum: SUPPRESSION_SCOPES },
    state: { type: String, required: true, enum: SUPPRESSION_STATES },
    reason: { type: String, required: true, enum: SUPPRESSION_REASONS },
    basis: {
      kind: { type: String, required: true, enum: SUPPRESSION_BASIS_KINDS },
      statusCode: { type: String, default: null, match: STATUS_CODE_PATTERN },
      evidenceRef: { type: String, required: true, match: EVIDENCE_REF_PATTERN },
    },
    sources: {
      type: [sourceSchema],
      default: [],
      validate: [(items) => items.length <= MAX_SOURCES, `at most ${MAX_SOURCES} sources`],
    },
    duplicateReports: { type: Number, required: true, default: 0, min: 0 },
    history: {
      type: [historySchema],
      default: [],
      validate: [(items) => items.length >= 1 && items.length <= MAX_HISTORY, `1 to ${MAX_HISTORY} history entries`],
    },
  },
  {
    timestamps: true,
    strict: 'throw',
    minimize: false,
    versionKey: 'version',
    optimisticConcurrency: true,
  },
);

/*
 * Rev 8.2 — `lookups` holds the primary exactly once (retiredAt null, equal to
 * `lookup`) and distinct aliases. A new entry derives it from `lookup` when
 * none is given.
 */
recipientSuppressionSchema.pre('validate', function lookupsInvariant() {
  if (this.isNew && (!Array.isArray(this.lookups) || this.lookups.length === 0) && this.lookup?.keyId) {
    this.lookups = [{ keyId: this.lookup.keyId, digest: this.lookup.digest, retiredAt: null }];
  }
  const items = this.lookups ?? [];
  const primaries = items.filter((item) => item.retiredAt === null || item.retiredAt === undefined);
  if (primaries.length !== 1 || primaries[0].keyId !== this.lookup?.keyId || primaries[0].digest !== this.lookup?.digest) {
    this.invalidate('lookups', 'lookups must hold the primary lookup exactly once');
  }
  if (new Set(items.map((item) => `${item.keyId}:${item.digest}`)).size !== items.length) this.invalidate('lookups', 'lookups must be distinct');
});

/* A history entry, once written, is never rewritten or dropped (SUP-14): only appends are valid. */
const historyFingerprint = (entries) => JSON.stringify(entries.map((entry) => (typeof entry.toObject === 'function' ? entry.toObject() : entry)));
recipientSuppressionSchema.pre('validate', function keepHistoryAppendOnly() {
  if (this.isNew) return;
  const loaded = this.$locals.loadedHistory;
  if (!Array.isArray(loaded)) return;
  if (this.history.length < loaded.length || historyFingerprint(this.history.slice(0, loaded.length)) !== historyFingerprint(loaded)) {
    this.invalidate('history', 'history entries are never removed or rewritten');
  }
});
recipientSuppressionSchema.post('init', function rememberHistory() {
  this.$locals.loadedHistory = this.history.map((entry) => entry.toObject());
});
recipientSuppressionSchema.post('save', function rememberSavedHistory() {
  this.$locals.loadedHistory = this.history.map((entry) => entry.toObject());
});

restrictToValidatedSaves(recipientSuppressionSchema, { model: 'RecipientSuppression' });

export const RecipientSuppression =
  mongoose.models.RecipientSuppression ?? mongoose.model('RecipientSuppression', recipientSuppressionSchema, 'recipient_suppressions');

const recoverySchema = new mongoose.Schema(
  {
    decisionRef: { type: String, required: true, match: DECISION_REF_PATTERN },
    evidenceRef: { type: String, required: true, match: EVIDENCE_REF_PATTERN },
    reason: { type: String, required: true, enum: RECOVERY_REASONS },
    startedAt: { type: Date, required: true },
    startedBy: { type: String, required: true, match: ACTOR_PATTERN },
    startCount: { type: Number, required: true, min: 0 },
    completedAt: { type: Date, default: null },
    completedBy: { type: String, default: null, match: ACTOR_PATTERN },
  },
  { _id: false },
);

const recipientSuppressionKeySchema = new mongoose.Schema(
  {
    _id: { type: String, required: true, match: KEY_ID_PATTERN },
    check: { type: String, default: null, match: DIGEST_PATTERN },
    state: { type: String, required: true, enum: KEY_DOCUMENT_STATES },
    recovery: { type: recoverySchema, default: null },
    createdBy: { type: String, required: true, match: ACTOR_PATTERN },
    requestId: { type: String, default: null, match: REQUEST_ID },
  },
  {
    timestamps: true,
    strict: 'throw',
    minimize: false,
    versionKey: 'version',
    optimisticConcurrency: true,
  },
);

/*
 * §4.5.1 — an ACTIVE key document always carries its check value; only
 * recover-key creates a document without one, and only as RECOVERING. A
 * RECOVERING or RETIRED document carries its recovery record. RETIRED is
 * permanent; RECOVERING only moves to RETIRED; a check value never changes.
 */
recipientSuppressionKeySchema.pre('validate', function keyDocumentInvariants() {
  if (this.state === 'ACTIVE' && !this.check) this.invalidate('check', 'an ACTIVE key document needs its check value');
  if (this.state !== 'ACTIVE' && !this.recovery) this.invalidate('recovery', 'a RECOVERING or RETIRED key document needs its recovery record');
  if (this.isNew) return;
  if (this.isModified('check')) this.invalidate('check', 'a check value is never changed');
  const before = this.$locals.loadedState;
  if (before === 'RETIRED' && this.state !== 'RETIRED') this.invalidate('state', 'RETIRED is permanent');
  if (before === 'RECOVERING' && !['RECOVERING', 'RETIRED'].includes(this.state)) this.invalidate('state', 'RECOVERING only moves to RETIRED');
});
recipientSuppressionKeySchema.post('init', function rememberState() {
  this.$locals.loadedState = this.state;
});

restrictToValidatedSaves(recipientSuppressionKeySchema, { model: 'RecipientSuppressionKey' });

export const RecipientSuppressionKey =
  mongoose.models.RecipientSuppressionKey ?? mongoose.model('RecipientSuppressionKey', recipientSuppressionKeySchema, 'recipient_suppression_keys');
