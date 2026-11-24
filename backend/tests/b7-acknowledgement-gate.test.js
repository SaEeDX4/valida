import { describe, it, expect } from 'vitest';
import { ConfigurationError, checkNotificationSettings, loadConfig } from '../src/config/env.js';

/**
 * B7 — gate G-SUP enforced by configuration (Doc 14 section 120; OD-2026-10-26-01
 * D2a; OD-2026-11-02-03 item 5; Doc 13 section 235 fail closed). Production
 * refuses to start with candidate acknowledgements enabled unless the recipient-
 * suppression key, its id and the operator tokens are all configured. Outside
 * production the B6 behaviour is unchanged (allowlisted test recipients only).
 * Synthetic values only.
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
// C6-T3 correction 1: production requires SITE_ACCESS=public explicitly.
const production = { ...smtp, APP_ENV: 'production', NODE_ENV: 'production', CORS_ALLOWED_ORIGINS: 'https://valida.example.test', SITE_ACCESS: 'public' };
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

const KEY_RULE = 'SUPPRESSION_HMAC_KEY:ACKNOWLEDGEMENT_REQUIRES_SUPPRESSION_KEY';
const OPERATORS_RULE = 'SUPPRESSION_OPERATOR_IDS:ACKNOWLEDGEMENT_REQUIRES_SUPPRESSION_OPERATORS';
const SYNTHETIC_KEY = Buffer.alloc(32, 7).toString('base64');
const suppression = { SUPPRESSION_HMAC_KEY: SYNTHETIC_KEY, SUPPRESSION_HMAC_KEY_ID: 'qa2026a', SUPPRESSION_OPERATOR_IDS: 'qa-operator' };
const startupError = (env) => {
  try {
    loadConfig(env);
  } catch (caught) {
    return caught;
  }
  return null;
};

describe('G-SUP: production candidate acknowledgements need recipient suppression', () => {
  it('pure rule: each missing part of the suppression configuration is refused, and missing settings fail closed', () => {
    expect(rules(complete, true)).toEqual([KEY_RULE, OPERATORS_RULE]);
    expect(rules({ ...complete, suppressionKeyConfigured: true }, true)).toEqual([OPERATORS_RULE]);
    expect(rules({ ...complete, suppressionOperatorsConfigured: true }, true)).toEqual([KEY_RULE]);
    expect(rules({ ...complete, suppressionKeyConfigured: true, suppressionOperatorsConfigured: true }, true)).toEqual([]);
    expect(rules({ ...complete, acknowledgementEnabled: false }, true)).toEqual([]);
  });

  it('start-up accepts production acknowledgements with the complete suppression configuration', () => {
    const config = loadConfig({ ...production, ...suppression, APPLICATION_ACKNOWLEDGEMENT_ENABLED: 'true' });
    expect(config.notifications.acknowledgementEnabled).toBe(true);
  });

  it.each(Object.keys(suppression))('start-up refuses production acknowledgements without %s, and never prints a secret', (variable) => {
    const error = startupError({ ...production, ...suppression, [variable]: '', APPLICATION_ACKNOWLEDGEMENT_ENABLED: 'true' });
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error.message).toMatch(/gate G-SUP/);
    expect(error.message).not.toContain(SECRET);
    expect(error.message).not.toContain(SYNTHETIC_KEY);
  });

  it('start-up refuses a malformed suppression key', () => {
    const error = startupError({ ...production, ...suppression, SUPPRESSION_HMAC_KEY: 'too-short', APPLICATION_ACKNOWLEDGEMENT_ENABLED: 'true' });
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error.message).toContain('SUPPRESSION_HMAC_KEY');
  });

  it('without candidate acknowledgements production needs no suppression key', () => {
    expect(loadConfig(production).notifications.acknowledgementEnabled).toBe(false);
  });

  it('pure rule: outside production the B6 behaviour is unchanged (allowlisted test recipients)', () => {
    expect(rules({ ...complete, recipientAllowlist: ['@qa.example.test'] }, false)).toEqual([]);
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
