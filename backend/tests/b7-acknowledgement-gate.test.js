import { describe, it, expect } from 'vitest';
import { ConfigurationError, checkNotificationSettings, loadConfig } from '../src/config/env.js';

/**
 * B7 — gate G-SUP enforced by configuration (Doc 14 section 120; OD-2026-10-26-01
 * D2a; OD-2026-11-02-03 item 5; Doc 13 section 235 fail closed). Until recipient
 * suppression exists and is accepted, production refuses to start with
 * candidate acknowledgements enabled. Outside production the B6 behaviour is
 * unchanged (allowlisted test recipients only). Synthetic values only.
 */
const SECRET = 'qa-b7-gsup-secret-marker';
const smtp = {
  MONGODB_URI: 'mongodb://127.0.0.1:27017/valida_test',
  TRANSACTIONAL_EMAIL_PROVIDER: 'smtp',
  SMTP_HOST: 'smtp.qa-relay.example.test',
  SMTP_USERNAME: 'notifications@qa-valida.example.test',
  SMTP_PASSWORD: SECRET,
  TRANSACTIONAL_FROM_ADDRESS: 'notifications@qa-valida.example.test',
  TRANSACTIONAL_REPLY_TO: 'careers@qa-valida.example.test',
  RECRUITMENT_NOTIFICATION_RECIPIENT: 'hr@qa-valida.example.test',
};
const production = { ...smtp, APP_ENV: 'production', NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://valida.example.test' };
const complete = {
  provider: 'smtp',
  apiKey: null,
  fromAddress: 'n@qa.example.test',
  replyTo: 'careers@qa.example.test',
  internalRecipient: 'hr@qa.example.test',
  acknowledgementEnabled: true,
  recipientAllowlist: null,
  smtpHost: 'smtp.qa.example.test',
  smtpPort: null,
  smtpSecurity: null,
  smtpUsername: 'n@qa.example.test',
  smtpPasswordSet: true,
};
const rules = (settings, isProduction) => checkNotificationSettings(settings, { isProduction }).map(({ variable, rule }) => `${variable}:${rule}`);

describe('G-SUP: production candidate acknowledgements stay disabled', () => {
  it('pure rule: an otherwise complete production identity with acknowledgements on is refused with the G-SUP rule only', () => {
    expect(rules(complete, true)).toEqual(['APPLICATION_ACKNOWLEDGEMENT_ENABLED:ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP']);
    expect(rules({ ...complete, acknowledgementEnabled: false }, true)).toEqual([]);
  });

  it('pure rule: outside production the B6 behaviour is unchanged (allowlisted test recipients)', () => {
    expect(rules({ ...complete, recipientAllowlist: ['@qa.example.test'] }, false)).toEqual([]);
  });

  it('start-up refuses APP_ENV=production with APPLICATION_ACKNOWLEDGEMENT_ENABLED=true, naming the gate and never the secret', () => {
    let error;
    try {
      loadConfig({ ...production, APPLICATION_ACKNOWLEDGEMENT_ENABLED: 'true' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error.message).toMatch(/APPLICATION_ACKNOWLEDGEMENT_ENABLED: must be "false" in production: .*gate G-SUP/);
    expect(error.message).not.toContain(SECRET);
  });

  it('the same production configuration starts with acknowledgements off; the internal notification stays available', () => {
    const config = loadConfig({ ...production, APPLICATION_ACKNOWLEDGEMENT_ENABLED: 'false' });
    expect(config.notifications.acknowledgementEnabled).toBe(false);
    expect(config.notifications.provider).toBe('smtp');
    expect(loadConfig(production).notifications.acknowledgementEnabled).toBe(false);
  });

  it('outside production acknowledgements can still be enabled for allowlisted QA recipients', () => {
    const config = loadConfig({ ...smtp, EMAIL_RECIPIENT_ALLOWLIST: '@qa-valida.example.test', APPLICATION_ACKNOWLEDGEMENT_ENABLED: 'true' });
    expect(config.notifications.acknowledgementEnabled).toBe(true);
  });
});
