import { describe, it, expect } from 'vitest';
import { checkNotificationSettings, loadConfig, ConfigurationError, REDACTED, TRANSACTIONAL_EMAIL_PROVIDERS } from '../src/config/env.js';
import { notificationServiceOptions } from '../src/integrations/notifications/notificationService.js';
import { createNotificationTransport } from '../src/integrations/notifications/transport.js';

/**
 * B6 — transactional email configuration (Doc 14 sections 93-114 and
 * 180-186; Doc 15 section 39; Doc 09 sections 129-130).
 *
 * Synthetic, undeliverable addresses only (*.example.test). Up to r3 the
 * provider was AWAITING INPUT and "none" was the only accepted value; r4 adds
 * "smtp" for the owner-selected provider (Bluehost Professional Email /
 * Titan) — see the SMTP section at the end. The rules an API provider would
 * trigger are still proven on the pure checkNotificationSettings.
 */
const base = { MONGODB_URI: 'mongodb://127.0.0.1:27017/valida_test' };
const production = {
  ...base,
  APP_ENV: 'production',
  NODE_ENV: 'production',
  CORS_ALLOWED_ORIGINS: 'https://valida.lt',
};

function configError(env) {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigurationError);
    return error;
  }
  throw new Error('expected a ConfigurationError');
}

describe('defaults: no provider — nothing is sent, nothing is claimed', () => {
  it('provider "none", no identities, acknowledgement off, retry policy defaults', () => {
    const config = loadConfig(base);
    expect(config.notifications).toEqual({
      provider: 'none',
      apiKey: null,
      fromAddress: null,
      fromName: 'Valida Careers',
      replyTo: null,
      internalRecipient: null,
      acknowledgementEnabled: false,
      recipientAllowlist: null,
      smtp: null,
      retry: { maxAttempts: 5, baseDelayMs: 60_000 },
    });
    expect(Object.isFrozen(config.notifications)).toBe(true);
    expect(createNotificationTransport({ config })).toBeNull();
  });

  it('a production configuration without a provider starts (readiness reports it; see b6-readiness)', () => {
    expect(loadConfig(production).notifications.provider).toBe('none');
  });

  // r4: changed with the provider decision (r1-r3 accepted only "none" while
  // the provider was AWAITING INPUT). Every other value is still refused, and
  // never echoed.
  it('accepted providers: "none" and "smtp" (the selected provider\'s interface); anything else is refused', () => {
    expect(TRANSACTIONAL_EMAIL_PROVIDERS).toEqual(['none', 'smtp']);
    for (const value of ['postmark', 'ses', 'resend', 'SMTP', 'titan', 'smtp-plain']) {
      const error = configError({ ...base, TRANSACTIONAL_EMAIL_PROVIDER: value });
      expect(error.message).toMatch(/TRANSACTIONAL_EMAIL_PROVIDER: must be "none", "smtp" or left unset/);
      expect(error.message).not.toContain(value);
    }
    expect(loadConfig({ ...base, TRANSACTIONAL_EMAIL_PROVIDER: '' }).notifications.provider).toBe('none');
  });
});

describe('addresses: one plain address each — no display name, list or header injection (Doc 14 section 144)', () => {
  it('accepts plain addresses and lowercases them', () => {
    const config = loadConfig({
      ...base,
      TRANSACTIONAL_FROM_ADDRESS: 'Careers@Notify.QA-Valida.example.test',
      TRANSACTIONAL_REPLY_TO: 'careers@qa-valida.example.test',
      RECRUITMENT_NOTIFICATION_RECIPIENT: 'recruitment@qa-valida.example.test',
      TRANSACTIONAL_FROM_NAME: 'Valida Careers QA',
    });
    expect(config.notifications).toMatchObject({
      fromAddress: 'careers@notify.qa-valida.example.test',
      replyTo: 'careers@qa-valida.example.test',
      internalRecipient: 'recruitment@qa-valida.example.test',
      fromName: 'Valida Careers QA',
    });
  });

  it.each([
    ['TRANSACTIONAL_FROM_ADDRESS', 'Valida <careers@qa-valida.example.test>'],
    ['TRANSACTIONAL_FROM_ADDRESS', 'careers@qa-valida.example.test\r\nBcc: victim@qa.example.test'],
    ['TRANSACTIONAL_REPLY_TO', 'a@qa.example.test,b@qa.example.test'],
    ['TRANSACTIONAL_REPLY_TO', 'careers @qa-valida.example.test'],
    ['RECRUITMENT_NOTIFICATION_RECIPIENT', 'recruitment'],
    ['RECRUITMENT_NOTIFICATION_RECIPIENT', 'recruitment@localhost'],
  ])('%s refuses an unsafe value without echoing it', (variable, value) => {
    const error = configError({ ...base, [variable]: value });
    expect(error.message).toContain(`${variable}: must be one plain email address`);
    expect(error.message).not.toContain(value);
    expect(error.message).not.toContain('qa-valida');
  });

  it.each(['Valida "Careers"', 'Valida <Careers>', 'Valida\r\nBcc: x', 'Back\\slash', 'x'.repeat(65), 'Valida, Careers', 'Careers: QA', 'Careers; QA', 'careers@qa', 'QA\u202eX', 'QA\u0085X', 'QA\u2028X', 'QA\u2029X', 'QA\ufeffX', 'QA\u200bX'])(
    'TRANSACTIONAL_FROM_NAME refuses %j',
    (value) => {
      const error = configError({ ...base, TRANSACTIONAL_FROM_NAME: value });
      expect(error.message).toMatch(/TRANSACTIONAL_FROM_NAME: must be 1-64 printable characters without quotes, angle brackets, backslashes, , ; : @, control or bidirectional formatting characters/);
    },
  );

  it('EMAIL_RECIPIENT_ALLOWLIST: addresses and @domains, lowercased; malformed lists are refused', () => {
    expect(loadConfig({ ...base, EMAIL_RECIPIENT_ALLOWLIST: ' QA@Qa-Valida.example.test , @Example.TEST ' }).notifications.recipientAllowlist).toEqual([
      'qa@qa-valida.example.test',
      '@example.test',
    ]);
    for (const value of [',', 'not-an-address', '@', '@localhost', Array.from({ length: 51 }, (_, i) => `qa${i}@qa.example.test`).join(',')]) {
      expect(configError({ ...base, EMAIL_RECIPIENT_ALLOWLIST: value }).message).toMatch(/EMAIL_RECIPIENT_ALLOWLIST: must be a comma-separated list/);
    }
  });

  it('APPLICATION_ACKNOWLEDGEMENT_ENABLED accepts only "true" / "false"', () => {
    expect(loadConfig({ ...base, APPLICATION_ACKNOWLEDGEMENT_ENABLED: 'false' }).notifications.acknowledgementEnabled).toBe(false);
    for (const value of ['yes', '1', 'TRUE']) {
      expect(configError({ ...base, APPLICATION_ACKNOWLEDGEMENT_ENABLED: value }).message).toMatch(/APPLICATION_ACKNOWLEDGEMENT_ENABLED: must be "true" or "false"/);
    }
  });

  it.each([
    ['NOTIFICATION_RETRY_MAX_ATTEMPTS', '0'],
    ['NOTIFICATION_RETRY_MAX_ATTEMPTS', '21'],
    ['NOTIFICATION_RETRY_BASE_DELAY_MS', '999'],
    ['NOTIFICATION_RETRY_BASE_DELAY_MS', 'soon'],
  ])('%s=%s is refused', (variable, value) => {
    expect(configError({ ...base, [variable]: value }).message).toContain(`${variable}: must be an integer`);
  });
});

describe('cross-variable rules (checkNotificationSettings)', () => {
  const settings = (overrides = {}) => ({
    provider: 'none',
    apiKey: null,
    fromAddress: null,
    replyTo: null,
    internalRecipient: null,
    acknowledgementEnabled: false,
    recipientAllowlist: null,
    ...overrides,
  });
  const rules = (overrides, isProduction = false) => checkNotificationSettings(settings(overrides), { isProduction }).map(({ variable, rule }) => `${variable}:${rule}`);

  it('no provider and nothing set: valid', () => {
    expect(rules({})).toEqual([]);
    expect(rules({}, true)).toEqual([]);
  });

  it('an API key without a provider is refused — through loadConfig too, without echoing the key', () => {
    expect(rules({ apiKey: 'k' })).toEqual(['TRANSACTIONAL_EMAIL_API_KEY:TRANSACTIONAL_EMAIL_API_KEY_WITHOUT_PROVIDER']);
    const error = configError({ ...base, TRANSACTIONAL_EMAIL_API_KEY: 'qa-secret-api-key-marker' });
    expect(error.message).toMatch(/TRANSACTIONAL_EMAIL_API_KEY: is set but TRANSACTIONAL_EMAIL_PROVIDER is "none"/);
    expect(error.message).not.toContain('qa-secret-api-key-marker');
  });

  it('candidate acknowledgement cannot be enabled without an operational identity (provider, From, Reply-To)', () => {
    expect(rules({ acknowledgementEnabled: true })).toEqual([
      'APPLICATION_ACKNOWLEDGEMENT_ENABLED:ACKNOWLEDGEMENT_REQUIRES_PROVIDER',
      'TRANSACTIONAL_REPLY_TO:ACKNOWLEDGEMENT_REQUIRES_REPLY_TO',
      'TRANSACTIONAL_FROM_ADDRESS:ACKNOWLEDGEMENT_REQUIRES_FROM',
    ]);
    // Through loadConfig: even with both addresses, "none" means it stays off.
    const error = configError({
      ...base,
      APPLICATION_ACKNOWLEDGEMENT_ENABLED: 'true',
      TRANSACTIONAL_FROM_ADDRESS: 'careers@notify.qa-valida.example.test',
      TRANSACTIONAL_REPLY_TO: 'careers@qa-valida.example.test',
    });
    expect(error.message).toMatch(/APPLICATION_ACKNOWLEDGEMENT_ENABLED: is "true", but candidate acknowledgement needs an operational transactional email provider/);
  });

  it('a real provider (future value) requires its key, a From address, the recruitment recipient and — outside production — an allowlist', () => {
    expect(rules({ provider: 'future' })).toEqual([
      'TRANSACTIONAL_EMAIL_API_KEY:PROVIDER_REQUIRES_API_KEY',
      'TRANSACTIONAL_FROM_ADDRESS:PROVIDER_REQUIRES_FROM',
      'RECRUITMENT_NOTIFICATION_RECIPIENT:PROVIDER_REQUIRES_RECIPIENT',
      'EMAIL_RECIPIENT_ALLOWLIST:ALLOWLIST_REQUIRED_OUTSIDE_PRODUCTION',
    ]);
    const complete = { provider: 'future', apiKey: 'k', fromAddress: 'f@qa.example.test', internalRecipient: 'r@qa.example.test' };
    expect(rules({ ...complete, recipientAllowlist: ['@qa.example.test'] })).toEqual([]);
    expect(rules(complete, true)).toEqual([]);
    expect(rules({ ...complete, acknowledgementEnabled: true, replyTo: 'c@qa.example.test', recipientAllowlist: ['@qa.example.test'] })).toEqual([]);
    // From is reported once even when acknowledgement also needs it.
    expect(rules({ ...complete, fromAddress: null, acknowledgementEnabled: true, replyTo: 'c@qa.example.test', recipientAllowlist: ['@qa.example.test'] })).toEqual([
      'TRANSACTIONAL_FROM_ADDRESS:ACKNOWLEDGEMENT_REQUIRES_FROM',
    ]);
  });

  it('outside production the internal recipient must pass the allowlist — otherwise the required notification could never be sent', () => {
    const complete = { provider: 'future', apiKey: 'k', fromAddress: 'f@qa.example.test', internalRecipient: 'recruitment@corp.example.test' };
    expect(rules({ ...complete, recipientAllowlist: ['@qa.example.test'] })).toEqual(['RECRUITMENT_NOTIFICATION_RECIPIENT:INTERNAL_RECIPIENT_NOT_ALLOWLISTED']);
    expect(rules({ ...complete, recipientAllowlist: ['@corp.example.test'] })).toEqual([]);
    expect(rules({ ...complete, recipientAllowlist: ['recruitment@corp.example.test'] })).toEqual([]);
    expect(rules({ ...complete, internalRecipient: 'Recruitment@Corp.example.test', recipientAllowlist: ['@corp.example.test'] })).toEqual([]);
    const error = configError({ ...base, RECRUITMENT_NOTIFICATION_RECIPIENT: 'recruitment@corp.example.test', EMAIL_RECIPIENT_ALLOWLIST: '@qa.example.test' });
    expect(error.message).toMatch(/RECRUITMENT_NOTIFICATION_RECIPIENT: is not covered by EMAIL_RECIPIENT_ALLOWLIST/);
    expect(error.message).not.toContain('corp.example.test');
  });

  it('an allowlist is refused in production (it would silently drop real candidates\' mail)', () => {
    expect(rules({ recipientAllowlist: ['@qa.example.test'] }, true)).toEqual(['EMAIL_RECIPIENT_ALLOWLIST:ALLOWLIST_REFUSED_IN_PRODUCTION']);
    expect(configError({ ...production, EMAIL_RECIPIENT_ALLOWLIST: '@qa.example.test' }).message).toMatch(
      /EMAIL_RECIPIENT_ALLOWLIST: must not be set when APP_ENV=production/,
    );
  });
});

describe('the API key is a secret', () => {
  it('is redacted from every serialisation of the config, and never handed to the Notification Service', async () => {
    // Reachable only with a provider; constructed directly for the check.
    const config = loadConfig(base);
    const withKey = { ...config.notifications, apiKey: 'qa-secret-api-key-marker' };
    expect(Object.keys(notificationServiceOptions(withKey)).sort()).toEqual([
      'acknowledgementEnabled',
      'fromAddress',
      'fromName',
      'internalRecipient',
      'recipientAllowlist',
      'replyTo',
    ]);
    expect(JSON.stringify(notificationServiceOptions(withKey))).not.toContain('qa-secret-api-key-marker');
    // The serialisation guards survive the spread (see env.js).
    const carrying = { ...config, notifications: Object.freeze(withKey) };
    const { inspect } = await import('node:util');
    expect(JSON.stringify(carrying)).not.toContain('qa-secret-api-key-marker');
    expect(inspect(carrying, { depth: 5 })).not.toContain('qa-secret-api-key-marker');
    expect(JSON.parse(JSON.stringify(carrying)).notifications.apiKey).toBe(REDACTED);
  });
});

/*
 * r4 — SMTP submission (TRANSACTIONAL_EMAIL_PROVIDER=smtp): the owner-selected
 * provider (Bluehost Professional Email, powered by Titan). Placeholder values
 * only; the real app password is never in any test.
 */
describe('SMTP provider configuration (r4)', () => {
  const SECRET = 'qa-smtp-password-marker-QA';
  const smtpEnv = {
    ...base,
    TRANSACTIONAL_EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'SMTP.QA-Relay.example.test',
    SMTP_USERNAME: 'Notifications@QA-Valida.example.test',
    SMTP_PASSWORD: SECRET,
    TRANSACTIONAL_FROM_ADDRESS: 'notifications@qa-valida.example.test',
    RECRUITMENT_NOTIFICATION_RECIPIENT: 'hr@qa-valida.example.test',
    EMAIL_RECIPIENT_ALLOWLIST: '@qa-valida.example.test',
  };

  it('a complete configuration: implicit TLS on 465 by default, lowercased names; the SMTP adapter is built from it', () => {
    const config = loadConfig(smtpEnv);
    expect(config.notifications.provider).toBe('smtp');
    expect({ ...config.notifications.smtp }).toEqual({
      host: 'smtp.qa-relay.example.test',
      port: 465,
      security: 'implicit-tls',
      username: 'notifications@qa-valida.example.test',
      password: SECRET,
    });
    const transport = createNotificationTransport({ config });
    expect(transport.name).toBe('smtp');
    expect(typeof transport.verify).toBe('function');
    expect(loadConfig({ ...smtpEnv, SMTP_SECURITY: 'starttls' }).notifications.smtp).toMatchObject({ security: 'starttls', port: 587 });
    expect(loadConfig({ ...smtpEnv, SMTP_PORT: '2465' }).notifications.smtp.port).toBe(2465);
    // Production: no allowlist needed (or allowed).
    expect(loadConfig({ ...production, ...smtpEnv, EMAIL_RECIPIENT_ALLOWLIST: '' }).notifications.provider).toBe('smtp');
  });

  it('the password is redacted from every view: the config, its notifications, the smtp settings; never in the service options', async () => {
    const config = loadConfig(smtpEnv);
    const { inspect } = await import('node:util');
    for (const view of [
      JSON.stringify(config),
      inspect(config, { depth: 6 }),
      JSON.stringify(config.notifications),
      inspect(config.notifications, { depth: 6 }),
      JSON.stringify(config.notifications.smtp),
      inspect(config.notifications.smtp, { depth: 6 }),
      JSON.stringify(notificationServiceOptions(config.notifications)),
      inspect(createNotificationTransport({ config }), { depth: 6 }),
    ]) {
      expect(view).not.toContain(SECRET);
    }
    expect(JSON.parse(JSON.stringify(config)).notifications.smtp.password).toBe(REDACTED);
    expect(JSON.parse(JSON.stringify(config.notifications.smtp)).password).toBe(REDACTED);
  });

  it.each([
    ['SMTP_HOST', { SMTP_HOST: '' }, /SMTP_HOST: is required when TRANSACTIONAL_EMAIL_PROVIDER=smtp/],
    ['SMTP_USERNAME', { SMTP_USERNAME: '' }, /SMTP_USERNAME: is required when TRANSACTIONAL_EMAIL_PROVIDER=smtp/],
    ['SMTP_PASSWORD', { SMTP_PASSWORD: '' }, /SMTP_PASSWORD: is required when TRANSACTIONAL_EMAIL_PROVIDER=smtp/],
    ['RECRUITMENT_NOTIFICATION_RECIPIENT', { RECRUITMENT_NOTIFICATION_RECIPIENT: '' }, /RECRUITMENT_NOTIFICATION_RECIPIENT: is required when a transactional email provider is configured/],
    ['TRANSACTIONAL_FROM_ADDRESS', { TRANSACTIONAL_FROM_ADDRESS: '' }, /TRANSACTIONAL_FROM_ADDRESS: is required when a transactional email provider is configured/],
    ['EMAIL_RECIPIENT_ALLOWLIST', { EMAIL_RECIPIENT_ALLOWLIST: '' }, /EMAIL_RECIPIENT_ALLOWLIST: is required outside production/],
  ])('requires %s', (_name, overrides, pattern) => {
    const error = configError({ ...smtpEnv, ...overrides });
    expect(error.message).toMatch(pattern);
    expect(error.message).not.toContain(SECRET);
  });

  it('From must be the authenticated mailbox', () => {
    const error = configError({ ...smtpEnv, TRANSACTIONAL_FROM_ADDRESS: 'careers@qa-valida.example.test' });
    expect(error.message).toMatch(/TRANSACTIONAL_FROM_ADDRESS: must be the same mailbox as SMTP_USERNAME/);
    expect(error.message).not.toContain('careers@qa-valida');
  });

  it('refuses: an API key with smtp; SMTP settings without the smtp provider; a host that is an IP literal; an unknown security mode; a port that contradicts the mode', () => {
    expect(configError({ ...smtpEnv, TRANSACTIONAL_EMAIL_API_KEY: 'qa-key-marker' }).message).toMatch(/TRANSACTIONAL_EMAIL_API_KEY: is set but the smtp provider authenticates with SMTP_USERNAME \/ SMTP_PASSWORD/);
    const leftover = configError({ ...base, SMTP_HOST: 'smtp.qa.example.test', SMTP_USERNAME: 'n@qa.example.test', SMTP_PASSWORD: SECRET, SMTP_PORT: '465', SMTP_SECURITY: 'implicit-tls' });
    for (const variable of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURITY', 'SMTP_USERNAME', 'SMTP_PASSWORD']) {
      expect(leftover.message).toContain(`${variable}: is set but TRANSACTIONAL_EMAIL_PROVIDER is not "smtp"`);
    }
    expect(leftover.message).not.toContain(SECRET);
    for (const host of ['203.0.113.10', '::1', 'smtp qa.example.test', 'smtp.example.test:465', 'https://smtp.example.test']) {
      expect(configError({ ...smtpEnv, SMTP_HOST: host }).message).toMatch(/SMTP_HOST: must be the SMTP relay's DNS host name/);
    }
    for (const security of ['none', 'plain', 'tls', 'ssl']) {
      expect(configError({ ...smtpEnv, SMTP_SECURITY: security }).message).toMatch(/SMTP_SECURITY: must be "implicit-tls" \(port 465\) or "starttls" \(port 587\); there is no plaintext mode/);
    }
    expect(configError({ ...smtpEnv, SMTP_PORT: '587' }).message).toMatch(/SMTP_PORT: does not match SMTP_SECURITY/);
    expect(configError({ ...smtpEnv, SMTP_SECURITY: 'starttls', SMTP_PORT: '465' }).message).toMatch(/SMTP_PORT: does not match SMTP_SECURITY/);
  });

  it('the notification bound: 10000 by default with smtp, and nothing shorter (review R5); "none" keeps 5000', () => {
    expect(loadConfig(smtpEnv).notificationTimeoutMs).toBe(10_000);
    expect(loadConfig({ ...smtpEnv, NOTIFICATION_TIMEOUT_MS: '15000' }).notificationTimeoutMs).toBe(15_000);
    expect(configError({ ...smtpEnv, NOTIFICATION_TIMEOUT_MS: '9999' }).message).toMatch(/NOTIFICATION_TIMEOUT_MS: must be at least 10000 \(milliseconds\) when TRANSACTIONAL_EMAIL_PROVIDER=smtp/);
    expect(loadConfig(base).notificationTimeoutMs).toBe(5_000);
    expect(loadConfig({ ...base, NOTIFICATION_TIMEOUT_MS: '200' }).notificationTimeoutMs).toBe(200);
  });

  it('a password with a control character (e.g. a pasted line break) is refused without being shown', () => {
    for (const value of [`${SECRET}\r\n`, `a\u0000b-${SECRET}`, `${'x'.repeat(513)}`]) {
      const error = configError({ ...smtpEnv, SMTP_PASSWORD: value });
      expect(error.message).toMatch(/SMTP_PASSWORD: must be at most 512 characters without control characters \(the value is never shown\)/);
      expect(error.message).not.toContain(SECRET);
    }
  });

  it('pure rules (checkNotificationSettings) for smtp', () => {
    const rules = (overrides, isProduction = false) =>
      checkNotificationSettings(
        {
          provider: 'smtp',
          apiKey: null,
          fromAddress: 'n@qa.example.test',
          replyTo: null,
          internalRecipient: 'hr@qa.example.test',
          acknowledgementEnabled: false,
          recipientAllowlist: ['@qa.example.test'],
          smtpHost: 'smtp.qa.example.test',
          smtpPort: null,
          smtpSecurity: null,
          smtpUsername: 'n@qa.example.test',
          smtpPasswordSet: true,
          ...overrides,
        },
        { isProduction },
      ).map(({ variable, rule }) => `${variable}:${rule}`);
    expect(rules({})).toEqual([]);
    expect(rules({ smtpHost: null, smtpUsername: null, smtpPasswordSet: false })).toEqual([
      'SMTP_HOST:SMTP_REQUIRES_HOST',
      'SMTP_USERNAME:SMTP_REQUIRES_USERNAME',
      'SMTP_PASSWORD:SMTP_REQUIRES_PASSWORD',
    ]);
    expect(rules({ fromAddress: 'N@QA.example.test' })).toEqual([]);
    expect(rules({ acknowledgementEnabled: true, replyTo: 'careers@qa.example.test' })).toEqual([]);
    expect(rules({ provider: 'none', smtpPort: 465 })).toContain('SMTP_PORT:SMTP_SETTING_WITHOUT_SMTP_PROVIDER');
  });
});
