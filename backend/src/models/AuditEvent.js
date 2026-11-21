import mongoose from 'mongoose';

/**
 * AuditEvent — Doc 10 sections 147-155, Doc 11 sections 177, 198-202, Doc 12 s103 (E1/E5).
 *
 * Append-only: created by the server, never edited or deleted through the
 * application (every query-write and document re-save is refused here).
 * Minimal, structured metadata only — never a password, token, TOTP value,
 * recovery code, note body, candidate message or résumé (s202).
 * No TTL: retention is not invented (Doc 10 s155).
 */

export const AUDIT_ACTOR_TYPES = ['ADMIN', 'SYSTEM'];
export const AUDIT_RESOURCE_TYPES = ['ADMIN', 'JOB', 'APPLICATION', 'SESSION'];

export const AUDIT_ACTIONS = Object.freeze([
  // Doc 11 s198
  'ADMIN_ACCOUNT_CREATED',
  'ADMIN_ACCOUNT_DISABLED',
  'ADMIN_ACCOUNT_ENABLED',
  'ADMIN_ROLE_CHANGED',
  'ADMIN_ACTIVATION_ISSUED',
  'ADMIN_ACTIVATED',
  'AUTH_LOGIN_SUCCESS',
  'AUTH_LOGIN_FAILED',
  'AUTH_ACCOUNT_LOCKED',
  'AUTH_LOGOUT',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET_COMPLETED',
  'MFA_ENROLLED',
  'MFA_FAILED',
  'MFA_RECOVERY_CODE_USED',
  'MFA_RECOVERY_CODES_REGENERATED',
  'MFA_RESET',
  'SESSION_REVOKED',
  'SESSIONS_REVOKED_OTHERS',
  // E3 — Doc 12 s36, s40
  'JOB_CREATED',
  'JOB_UPDATED',
  'JOB_PUBLISHED',
  'JOB_REOPENED',
  'JOB_CLOSED',
  'JOB_ARCHIVED',
  // E4/E5 — Doc 11 s177, Doc 12 s88-103
  'RESUME_ACCESSED',
  'APPLICATION_STATUS_CHANGED',
  'APPLICATION_NOTE_ADDED',
  'APPLICATION_COMMUNICATION_RECORDED',
]);

const auditEventSchema = new mongoose.Schema(
  {
    actor: {
      type: { type: String, required: true, enum: AUDIT_ACTOR_TYPES },
      id: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    action: { type: String, required: true, enum: AUDIT_ACTIONS },
    resource: {
      type: { type: String, required: true, enum: AUDIT_RESOURCE_TYPES },
      id: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    requestId: { type: String, default: null, maxlength: 128 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    occurredAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw', minimize: false },
);

/* Append-only: no update path of any kind. */
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  auditEventSchema.pre(operation, function refuseAuditMutation() {
    throw new Error(`AuditEvent is append-only; ${operation} is not permitted`);
  });
}
auditEventSchema.pre('save', function refuseResave() {
  if (!this.isNew) throw new Error('AuditEvent is append-only; an existing event cannot be saved again');
});

export const AuditEvent = mongoose.models.AuditEvent ?? mongoose.model('AuditEvent', auditEventSchema, 'audit_events');
export { auditEventSchema };
