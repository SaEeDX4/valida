import { createSmtpTransport } from './smtpTransport.js';

/**
 * Transactional email transport selection — Milestone B6.
 *
 * Governed by 14_EMAIL_DNS_IDENTITY.md sections 94-95, 109-111, 135, 152-153
 * and 163, 09_BACKEND_API_SPEC.md section 136.
 *
 * One adapter per provider lives behind the Notification Service boundary
 * (Doc 14 section 163). The contract every adapter implements is documented
 * in notificationService.js.
 *
 *   none  (default) no transport: nothing is sent, readiness reports the
 *         dependency `not_implemented`, accepted Applications keep their
 *         notifications PENDING for ops:notifications:retry.
 *   smtp  (r4) authenticated SMTP submission over TLS (smtpTransport.js) —
 *         the interface of the owner-selected provider, Bluehost Professional
 *         Email powered by Titan, which offers no message API (so Doc 14
 *         section 153's app-password exception applies). The credentials come
 *         from configuration (SMTP_USERNAME / SMTP_PASSWORD), server-side only
 *         (Doc 14 sections 109, 111, 179).
 *
 * Adding a provider is one adapter module plus its configuration value — no
 * business logic changes (section 163).
 *
 * A factory that fails must release anything it allocated before throwing:
 * startServer closes only a transport that was returned (r2). The SMTP adapter
 * allocates nothing until its first call.
 *
 * @param {object} options
 * @param {{ notifications: { provider: string, smtp?: object }, notificationTimeoutMs: number }} options.config
 * @param {() => void} [options.onAuthenticationRejected] see smtpTransport.js (the latch)
 * @param {string|Buffer|Array} [options.trustedCa] TEST ONLY — the local SMTP test
 *   server's CA. Never set from configuration; production never passes it.
 * @returns {null | ReturnType<typeof createSmtpTransport>}
 */
export function createNotificationTransport({ config, onAuthenticationRejected, trustedCa } = {}) {
  const provider = config?.notifications?.provider ?? 'none';
  if (provider === 'none') return null;
  if (provider === 'smtp') {
    const smtp = config.notifications.smtp;
    return createSmtpTransport({
      host: smtp.host,
      port: smtp.port,
      security: smtp.security,
      username: smtp.username,
      password: smtp.password,
      timeoutMs: config.notificationTimeoutMs,
      onAuthenticationRejected,
      trustedCa,
    });
  }
  // Unreachable through loadConfig (its enum allows only the values above).
  throw new Error('No adapter exists for the configured transactional email provider.');
}
