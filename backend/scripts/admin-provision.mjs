#!/usr/bin/env node
/**
 * Secure initial Admin provisioning — Doc 11 sections 25-32 (E1; OD-2026-11-21-01).
 *
 * The only way to create the FIRST Admin (no public signup, s25; no default
 * password, s27). Run by the owner on a trusted machine against the target
 * database. It creates an ACTIVE account with no password and issues a
 * one-time activation token (32 random bytes, SHA-256 stored, 8-hour expiry):
 *
 *   - when transactional email is configured, the link is EMAILED to the
 *     account's own address (s28, s49: email ownership is proven by using it);
 *   - otherwise, with --print-link, the link is printed to THIS terminal only,
 *     for the operator to open themselves. Never pass it through chat or tickets.
 *
 * Usage:
 *   node --env-file=<env> scripts/admin-provision.mjs create --email <address> --name "<display name>" [--role ADMIN_OWNER|RECRUITMENT_ADMIN] [--print-link]
 *   node --env-file=<env> scripts/admin-provision.mjs reissue --email <address> [--print-link]
 *   node --env-file=<env> scripts/admin-provision.mjs status --email <address>
 *
 * Needs MONGODB_URI and the ADMIN_* settings (ADMIN_AUTH=enabled). Nothing
 * secret is logged; the token appears only in the printed link, and only with --print-link.
 */
import mongoose from 'mongoose';
import { ConfigurationError, loadConfig } from '../src/config/env.js';
import { Admin, ADMIN_ROLES } from '../src/models/Admin.js';
import { normalizeEmail, isSyntacticallyValidEmail } from '../src/models/Application.js';
import { createAuditWriter } from '../src/modules/admin/audit.js';
import { issueActivation } from '../src/modules/admin/admins.routes.js';
import { createNotificationService, notificationServiceOptions } from '../src/integrations/notifications/notificationService.js';
import { createNotificationTransport } from '../src/integrations/notifications/transport.js';
import { safeErrorSummary } from '../src/lib/safeError.js';

const USAGE = [
  'Usage:',
  '  node scripts/admin-provision.mjs create  --email <address> --name "<display name>" [--role ADMIN_OWNER|RECRUITMENT_ADMIN] [--print-link]',
  '  node scripts/admin-provision.mjs reissue --email <address> [--print-link]',
  '  node scripts/admin-provision.mjs status  --email <address>',
].join('\n');

function usage(message) {
  if (message) console.error(`${message}\n`);
  console.error(USAGE);
  process.exit(2);
}

export function parseArgs(argv) {
  const [mode, ...rest] = argv;
  if (!['create', 'reissue', 'status'].includes(mode)) usage('The first argument must be "create", "reissue" or "status".');
  const options = { mode, email: null, name: null, role: 'ADMIN_OWNER', printLink: false };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const take = () => {
      if (i + 1 >= rest.length) usage(`${arg} needs a value.`);
      i += 1;
      return rest[i];
    };
    if (arg === '--email') options.email = take();
    else if (arg === '--name' && mode === 'create') options.name = take();
    else if (arg === '--role' && mode === 'create') options.role = take();
    else if (arg === '--print-link' && mode !== 'status') options.printLink = true;
    else usage(`Unsupported argument for ${mode}: ${String(arg).slice(0, 40)}`);
  }
  if (!options.email || !isSyntacticallyValidEmail(options.email)) usage('--email <address> is required and must be valid.');
  if (mode === 'create' && (!options.name || options.name.trim().length === 0 || options.name.length > 120)) usage('--name is required (1-120 characters).');
  if (!ADMIN_ROLES.includes(options.role)) usage(`--role must be one of ${ADMIN_ROLES.join(', ')}.`);
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error('Configuration is incomplete:');
      for (const problem of error.issues ?? []) console.error(`  ${problem.variable}: ${problem.rule}`);
      process.exit(1);
    }
    throw error;
  }
  if (!config.adminAuth?.enabled) usage('ADMIN_AUTH=enabled and its ADMIN_* settings are required.');

  await mongoose.connect(config.mongodbUri, { serverSelectionTimeoutMS: config.databaseConnectTimeoutMs });
  const clock = () => new Date();
  const audit = createAuditWriter({ clock });
  const transport = createNotificationTransport({ config });
  const notifications = createNotificationService({ transport, timeoutMs: config.notificationTimeoutMs, clock, ...notificationServiceOptions(config.notifications) });
  try {
    const existing = await Admin.findOne({ emailNormalized: normalizeEmail(options.email) });
    if (options.mode === 'status') {
      if (!existing) return console.log('No Admin with that email.');
      console.log(JSON.stringify({ status: existing.status, roles: existing.roles, activated: Boolean(existing.authentication.emailVerifiedAt), mfaEnabled: existing.mfa.enabled, activationExpiresAt: existing.authentication.activationExpiresAt }, null, 2));
      return;
    }
    let admin = existing;
    if (options.mode === 'create') {
      if (existing) usage('An Admin with that email already exists. Use "reissue" for a new activation link.');
      admin = new Admin({ email: options.email, displayName: options.name.trim(), roles: [options.role], status: 'ACTIVE' });
      await admin.save();
      await audit.record({ actor: { type: 'SYSTEM' }, action: 'ADMIN_ACCOUNT_CREATED', resource: { type: 'ADMIN', id: admin._id }, metadata: { roles: [options.role] } });
    } else {
      if (!existing) usage('No Admin with that email.');
      if (existing.authentication.emailVerifiedAt) usage('That account is already activated. Use the password reset in the Admin sign-in page.');
    }
    const result = await issueActivation({ admin, adminAuth: config.adminAuth, notifications: options.printLink ? null : notifications, clock });
    await audit.record({ actor: { type: 'SYSTEM' }, action: 'ADMIN_ACTIVATION_ISSUED', resource: { type: 'ADMIN', id: admin._id }, metadata: { outcome: options.printLink ? 'PRINTED' : result.delivery } });
    if (options.printLink) {
      console.log('One-time activation link (valid 8 hours; open it yourself, do not share it):');
      console.log(`${config.adminAuth.appOrigin}/admin/activate#token=${result.token}`);
    } else if (result.delivery === 'SENT') {
      console.log(`Activation link emailed to the account's address (accepted by the provider; delivery is not confirmed).`);
    } else {
      console.log(`The activation email was not sent (${result.delivery}). Re-run with --print-link on a trusted terminal, or fix the email settings.`);
      process.exitCode = 1;
    }
  } finally {
    await notifications.close?.();
    await mongoose.disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('admin-provision.mjs')) {
  main().catch((error) => {
    console.error('Provisioning failed:', JSON.stringify(safeErrorSummary(error)));
    process.exit(1);
  });
}
