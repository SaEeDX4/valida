import mongoose from 'mongoose';
import { isSyntacticallyValidEmail, normalizeEmail } from './Application.js';

/**
 * Admin — Doc 10 sections 142-146, Doc 11 sections 23-31, 65-68, 90-91, 138-141 (E1).
 *
 * The recruitment administration identity. Never deleted while referenced by
 * audit history (Doc 11 s207): offboarding is status DISABLED.
 *
 * Secrets are never stored in a recoverable form:
 *   - password: an Argon2id encoded hash (s33-36);
 *   - activation and reset tokens: SHA-256 of a 32-byte random token (s29, s124);
 *   - MFA secret: AES-256-GCM ciphertext under a server key named by keyId (s66-68);
 *   - recovery codes: SHA-256 of ~128-bit random codes (s80).
 * Every one of them is `select: false`: a query must ask for it by name.
 */

export const ADMIN_STATUSES = ['ACTIVE', 'DISABLED'];
export const ADMIN_ROLES = ['ADMIN_OWNER', 'RECRUITMENT_ADMIN'];

const recoveryCodeSchema = new mongoose.Schema(
  {
    hash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    usedAt: { type: Date, default: null },
  },
  { _id: false },
);

const mfaSchema = new mongoose.Schema(
  {
    required: { type: Boolean, required: true, default: true },
    enabled: { type: Boolean, required: true, default: false },
    method: { type: String, enum: ['TOTP', null], default: null },
    secretCiphertext: { type: String, default: null, select: false },
    encryptionKeyId: { type: String, default: null, maxlength: 32 },
    enrolledAt: { type: Date, default: null },
    lastUsedTimeStep: { type: Number, default: null },
    recoveryCodes: { type: [recoveryCodeSchema], default: [], select: false },
    // A pending enrolment (s69-71, s262): the candidate secret until verified.
    pendingSecretCiphertext: { type: String, default: null, select: false },
    pendingEncryptionKeyId: { type: String, default: null, maxlength: 32 },
    pendingExpiresAt: { type: Date, default: null },
  },
  { _id: false },
);

const authenticationSchema = new mongoose.Schema(
  {
    passwordHash: { type: String, default: null, select: false },
    passwordChangedAt: { type: Date, default: null },
    emailVerifiedAt: { type: Date, default: null },
    authVersion: { type: Number, required: true, default: 1, min: 1, validate: Number.isInteger },
    activationTokenHash: { type: String, default: null, select: false },
    activationExpiresAt: { type: Date, default: null },
    resetTokenHash: { type: String, default: null, select: false },
    resetTokenExpiresAt: { type: Date, default: null },
    failedLoginCount: { type: Number, required: true, default: 0, min: 0 },
    lastFailedLoginAt: { type: Date, default: null },
    lockedUntil: { type: Date, default: null },
  },
  { _id: false },
);

const adminSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, maxlength: 254, validate: { validator: isSyntacticallyValidEmail, message: 'must be a valid email' } },
    emailNormalized: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    displayName: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
    status: { type: String, required: true, enum: ADMIN_STATUSES, default: 'ACTIVE' },
    roles: {
      type: [{ type: String, enum: ADMIN_ROLES }],
      required: true,
      validate: [(roles) => roles.length >= 1 && new Set(roles).size === roles.length, 'roles must be a non-empty set'],
    },
    authentication: { type: authenticationSchema, default: () => ({}) },
    mfa: { type: mfaSchema, default: () => ({}) },
    lastLoginAt: { type: Date, default: null },
    createdByAdminId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, strict: 'throw', minimize: false },
);

adminSchema.pre('validate', function deriveNormalizedEmail() {
  if (typeof this.email === 'string') this.emailNormalized = normalizeEmail(this.email);
});

export const Admin = mongoose.models.Admin ?? mongoose.model('Admin', adminSchema, 'admins');
export { adminSchema };
