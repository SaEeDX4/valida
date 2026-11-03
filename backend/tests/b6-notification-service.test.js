import { describe, it, expect } from 'vitest';
import {
  ERROR_CODE_CLASSES,
  FAILURE_CLASSES,
  NOTIFICATION_EVENTS,
  TRANSPORT_ERROR_CODES,
  classifyErrorCode,
  createNotificationService,
  isAllowedRecipient,
  isDeliverableAddress,
} from '../src/integrations/notifications/notificationService.js';
import {
  TEMPLATE_VERSION,
  escapeHtml,
  headerText,
  renderApplicationAcknowledgement,
  renderApplicationReceivedInternal,
  singleLine,
} from '../src/integrations/notifications/templates.js';
import { recordingTransport } from './fixtures/applyHarness.js';

/**
 * B6 — the Notification Service and its templates, offline.
 *
 * Every transport here is a TEST DOUBLE (Doc 17 section 388): it proves the
 * service's behaviour up to the provider call — rendering, recipient
 * safeguards, the bound, the classification — never that an email was sent or
 * delivered. Synthetic, undeliverable addresses only (*.example.test).
 */
const RECIPIENTS = Object.freeze({
  fromAddress: 'careers@notify.qa-valida.example.test',
  fromName: 'Valida Careers',
  replyTo: 'careers@qa-valida.example.test',
  internalRecipient: 'recruitment@qa-valida.example.test',
});
const APPLICATION_ID = '65f0c0ffee0000000000abcd';
const input = (overrides = {}) => ({
  applicationId: APPLICATION_ID,
  job: { title: 'QA Synthetic Apply Role', slug: 'qa-synthetic-apply-role' },
  submittedAt: new Date('2026-09-01T12:34:56.789Z'),
  candidateEmail: 'qa.candidate@qa-valida.example.test',
  ...overrides,
});
const service = (transport, options = {}) =>
  createNotificationService({ transport, timeoutMs: 200, clock: () => new Date('2026-09-01T12:35:00.000Z'), ...RECIPIENTS, ...options });

describe('templates (Doc 14 sections 136-144; SEC-049)', () => {
  it('APPLICATION_RECEIVED_INTERNAL: role, time, internal reference — text AND html, no candidate data, no links or images', () => {
    const rendered = renderApplicationReceivedInternal(input());
    // B6 Stage 2 (b6-3 since OD-2026-11-02-01; b6-2 before): the approved Concept A copy (OD-2026-10-26-02); details in b6-stage2-templates.test.js.
    expect(TEMPLATE_VERSION).toBe('b6-3');
    expect(rendered.subject).toBe('New application — QA Synthetic Apply Role | Valida');
    expect(rendered.text).toBe(
      [
        'A new application has arrived.',
        '',
        'The application is recorded in Valida.',
        '',
        'Role: QA Synthetic Apply Role',
        'Role identifier: qa-synthetic-apply-role',
        'Received (UTC): 2026-09-01 12:34:56',
        `Application reference: ${APPLICATION_ID}`,
        '',
        'Candidate details and the resume are stored privately in Valida and are not included in this email.',
        '',
        'Valida · Recruitment operations',
        '',
      ].join('\n'),
    );
    expect(rendered.html).toMatch(/^<!doctype html>/);
    expect(rendered.html).toContain('>QA Synthetic Apply Role</p>');
    expect(rendered.html).toContain(`>${APPLICATION_ID}</p>`);
    expect(rendered.html).not.toMatch(/<a\s|<link\s|<script|https?:|url\(/i);
    // Stage 2: the only image is the approved logo, inline (CID) — no remote resource.
    expect(rendered.html.match(/<img\b[^>]*>/g)).toEqual([expect.stringContaining('src="cid:valida-logo.b6@cybervalida.com"')]);
    expect(JSON.stringify(rendered)).not.toMatch(/qa\.candidate|resume\.pdf|storageKey/i);
  });

  it('APPLICATION_ACKNOWLEDGEMENT: the approved Doc 06 receipt copy — receipt only, no promise', () => {
    const rendered = renderApplicationAcknowledgement(input());
    expect(rendered.subject).toBe('Application received — QA Synthetic Apply Role | Valida');
    expect(rendered.text).toContain('Thank you for applying.');
    expect(rendered.text).toContain('We’ve received your application for QA Synthetic Apply Role.');
    expect(rendered.text).toContain('If we need more information or decide to move forward, we’ll contact you using the details in your application.');
    expect(rendered.text).toContain('Valida Careers');
    expect(`${rendered.text}${rendered.html}`).not.toMatch(/interview|shortlist|selected|within \d|business days|guarantee/i);
    expect(rendered.html).not.toMatch(/<a\s|https?:/i);
    expect(rendered.html.match(/<img\b[^>]*>/g)).toEqual([expect.stringContaining('src="cid:valida-logo.b6@cybervalida.com"')]);
    // The acknowledgement does not repeat what the candidate submitted.
    expect(JSON.stringify(rendered)).not.toMatch(/qa\.candidate|65f0c0ffee/);
  });

  it('untrusted text is escaped in HTML, stripped of control characters, and cannot inject a header', () => {
    const hostile = { title: 'QA <script>alert(1)</script> & "x"\r\nBcc: victim@qa.example.test\u2028\u202e', slug: 'qa-<b>' };
    for (const rendered of [renderApplicationReceivedInternal(input({ job: hostile })), renderApplicationAcknowledgement(input({ job: hostile }))]) {
      expect(rendered.subject).not.toMatch(/[\r\n\u2028\u2029\u202a-\u202e\u2066-\u2069]/);
      expect(rendered.subject).toContain('Bcc: victim@qa.example.test'); // inert text on ONE line
      expect(rendered.html).not.toContain('<script>');
      expect(rendered.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;');
      expect(rendered.text).not.toMatch(/\r|\u2028/);
    }
    expect(singleLine('a\u0000b\u0085c\u2029d')).toBe('a b c d');
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });

  it('a long title is bounded in the subject only (the body keeps it whole)', () => {
    const title = 'Q'.repeat(200);
    const rendered = renderApplicationReceivedInternal(input({ job: { title, slug: 'qa' } }));
    expect(rendered.subject).toBe(`New application — ${'Q'.repeat(119)}… | Valida`);
    expect(rendered.text).toContain(title);
    expect(headerText('x'.repeat(120))).toHaveLength(120);
  });

  it('missing inputs are refused (a defect, never a half-empty email)', () => {
    expect(() => renderApplicationReceivedInternal(input({ job: { title: ' ', slug: 'qa' } }))).toThrow(TypeError);
    expect(() => renderApplicationReceivedInternal(input({ submittedAt: new Date('invalid') }))).toThrow(TypeError);
    expect(() => renderApplicationReceivedInternal(input({ applicationId: '' }))).toThrow(TypeError);
    expect(() => renderApplicationAcknowledgement({ job: null })).toThrow(TypeError);
  });
});

describe('classification (Doc 14 sections 120-121; Doc 10 section 122)', () => {
  it('every storable code has a class; anything unknown is UNCERTAIN (never retried automatically)', () => {
    expect(ERROR_CODE_CLASSES).toEqual({
      PROVIDER_UNAVAILABLE: 'TRANSIENT',
      RATE_LIMITED: 'TRANSIENT',
      INVALID_RECIPIENT: 'PERMANENT',
      SUPPRESSED: 'PERMANENT',
      PROVIDER_REJECTED: 'PERMANENT',
      RECIPIENT_NOT_ALLOWED: 'PERMANENT',
      PROVIDER_AUTH_FAILED: 'CONFIGURATION',
      SENDER_NOT_VERIFIED: 'CONFIGURATION',
      // r4 (SMTP): the relay connection could not be secured.
      TLS_FAILED: 'CONFIGURATION',
      TEMPLATE_ERROR: 'CONFIGURATION',
      SENDER_NOT_CONFIGURED: 'CONFIGURATION',
      RECIPIENT_NOT_CONFIGURED: 'CONFIGURATION',
      TIMEOUT: 'UNCERTAIN',
      OUTCOME_UNKNOWN: 'UNCERTAIN',
      PROVIDER_ERROR: 'UNCERTAIN',
      INTERNAL_ERROR: 'UNCERTAIN',
      ATTEMPT_IN_PROGRESS: 'UNCERTAIN',
    });
    expect(classifyErrorCode('SOMETHING_NEW')).toBe(FAILURE_CLASSES.UNCERTAIN);
    expect(classifyErrorCode(null)).toBe(FAILURE_CLASSES.UNCERTAIN);
    // r2 re-review: inherited property names are not codes.
    for (const inherited of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty', 5]) expect(classifyErrorCode(inherited)).toBe(FAILURE_CLASSES.UNCERTAIN);
    // Every code fits the stored field (Doc 10: lastErrorCode maxlength 80).
    for (const code of Object.keys(ERROR_CODE_CLASSES)) expect(code.length).toBeLessThanOrEqual(80);
  });

  it('a transport may report only provider-side codes (never the service-only ones)', () => {
    expect(TRANSPORT_ERROR_CODES).not.toContain('RECIPIENT_NOT_ALLOWED');
    expect(TRANSPORT_ERROR_CODES).not.toContain('TEMPLATE_ERROR');
    expect(TRANSPORT_ERROR_CODES).not.toContain('TIMEOUT');
    expect(TRANSPORT_ERROR_CODES).not.toContain('ATTEMPT_IN_PROGRESS');
    expect(TRANSPORT_ERROR_CODES).not.toContain('SENDER_NOT_CONFIGURED');
    expect(TRANSPORT_ERROR_CODES).not.toContain('RECIPIENT_NOT_CONFIGURED');
  });
});

describe('deliver(): one message, bounded, classified, never throws', () => {
  it('success (TEST DOUBLE): the rendered internal email to the configured recipient; SENT = accepted; nothing the provider returned is kept', async () => {
    const transport = recordingTransport('accept');
    const outcome = await service(transport).deliver(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, input());
    // r2: the double returns { providerMessageId: 'qa-message-1' } — it is discarded.
    expect(outcome).toEqual({
      status: 'SENT',
      attemptedAt: new Date('2026-09-01T12:35:00.000Z'),
      sentAt: new Date('2026-09-01T12:35:00.000Z'),
    });
    expect(transport.calls).toHaveLength(1);
    const [message] = transport.calls;
    expect(message).toEqual({
      event: 'APPLICATION_RECEIVED_INTERNAL',
      from: { address: RECIPIENTS.fromAddress, name: 'Valida Careers' },
      to: [RECIPIENTS.internalRecipient],
      replyTo: RECIPIENTS.replyTo,
      subject: 'New application — QA Synthetic Apply Role | Valida',
      text: renderApplicationReceivedInternal(input()).text,
      html: renderApplicationReceivedInternal(input()).html,
      tracking: { opens: false, links: false },
      metadata: { event: 'APPLICATION_RECEIVED_INTERNAL', applicationId: APPLICATION_ID },
    });
    // The candidate's address is used only for the acknowledgement.
    expect(JSON.stringify(message)).not.toContain('qa.candidate');
    expect(transport.idempotencyKeys).toEqual([`APPLICATION_RECEIVED_INTERNAL/${APPLICATION_ID}`]);
  });

  it('the acknowledgement goes to the candidate, with the careers Reply-To; no attachment field exists', async () => {
    const transport = recordingTransport('accept');
    expect((await service(transport).deliver(NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT, input())).status).toBe('SENT');
    const [message] = transport.calls;
    expect(message.to).toEqual(['qa.candidate@qa-valida.example.test']);
    expect(message.replyTo).toBe(RECIPIENTS.replyTo);
    expect(message).not.toHaveProperty('attachments');
    expect(transport.idempotencyKeys).toEqual([`APPLICATION_ACKNOWLEDGEMENT/${APPLICATION_ID}`]);
  });

  it('r2: WHATEVER the provider returns — an email-shaped id, an opaque token, a response body — is discarded, never returned', async () => {
    for (const returned of [
      { providerMessageId: 'reviewer@example.invalid' },
      { providerMessageId: '<0100018f.qa-reviewer@email.provider.example.invalid>' },
      { providerMessageId: 'opaque-SECRET-token-7f3a9c0e1b2d' },
      { MessageID: 'reviewer@example.invalid', To: 'qa.candidate@qa-valida.example.test', Message: 'OK' },
      'reviewer@example.invalid',
      { providerMessageId: 'x'.repeat(129) },
      undefined,
    ]) {
      const outcome = await service({ name: 'qa', send: async () => returned }).deliver(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, input());
      expect(outcome).toEqual({ status: 'SENT', attemptedAt: expect.any(Date), sentAt: expect.any(Date) });
      expect(JSON.stringify(outcome)).not.toMatch(/reviewer|SECRET|qa\.candidate|MessageID/);
    }
  });

  it.each([
    ['rejection', 'PROVIDER_REJECTED', 'PERMANENT'],
    ['invalid recipient (provider)', 'INVALID_RECIPIENT', 'PERMANENT'],
    ['suppressed recipient', 'SUPPRESSED', 'PERMANENT'],
    ['provider unavailable', 'PROVIDER_UNAVAILABLE', 'TRANSIENT'],
    ['rate limited', 'RATE_LIMITED', 'TRANSIENT'],
    ['credentials refused', 'PROVIDER_AUTH_FAILED', 'CONFIGURATION'],
    ['sender not verified', 'SENDER_NOT_VERIFIED', 'CONFIGURATION'],
    ['outcome unknown', 'OUTCOME_UNKNOWN', 'UNCERTAIN'],
  ])('%s: FAILED with the fixed code and its class', async (_label, code, errorClass) => {
    const outcome = await service(recordingTransport(code)).deliver(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, input());
    expect(outcome).toEqual({ status: 'FAILED', attemptedAt: expect.any(Date), errorCode: code, errorClass });
  });

  it('an unclassified provider error is PROVIDER_ERROR (UNCERTAIN); its text, status or body is never kept', async () => {
    const raw = Object.assign(new Error('550 5.1.1 secret-token-QA qa.candidate@qa-valida.example.test'), { statusCode: 422, body: 'secret-body-QA' });
    const outcome = await service(recordingTransport(raw)).deliver(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, input());
    expect(outcome).toEqual({ status: 'FAILED', attemptedAt: expect.any(Date), errorCode: 'PROVIDER_ERROR', errorClass: 'UNCERTAIN' });
    expect(JSON.stringify(outcome)).not.toMatch(/secret|550|422|qa\.candidate/);
    // A non-Error throw and a forged code are no different.
    expect((await service(recordingTransport('NOT_A_CODE')).deliver(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, input())).errorCode).toBe('PROVIDER_ERROR');
    expect((await service(recordingTransport(null)).deliver(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, input())).errorCode).toBe('PROVIDER_ERROR');
  });

  it('timeout: FAILED / TIMEOUT (UNCERTAIN) at the bound, the signal aborted; a late acceptance cannot change it', async () => {
    let resolveLate;
    const transport = recordingTransport(() => 'hang');
    const lateTransport = {
      name: 'qa-late',
      send: (_message, { signal }) =>
        new Promise((resolve) => {
          resolveLate = () => resolve({ providerMessageId: 'late' });
          transport.signals.push(signal);
        }),
    };
    const started = Date.now();
    const outcome = await service(lateTransport, { timeoutMs: 60 }).deliver(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, input());
    expect(Date.now() - started).toBeLessThan(1000);
    expect(outcome).toMatchObject({ status: 'FAILED', errorCode: 'TIMEOUT', errorClass: 'UNCERTAIN' });
    expect(transport.signals[0].aborted).toBe(true);
    resolveLate();
    await new Promise((resolve) => setImmediate(resolve));
    expect(outcome.status).toBe('FAILED');
  });

  it('a candidate address that cannot be used is INVALID_RECIPIENT (PERMANENT) — never sent', async () => {
    const transport = recordingTransport('accept');
    for (const candidateEmail of [
      '',
      null,
      'a<b@qa.example.test>',
      'x@qa.example.test,victim@qa.example.test',
      'a"b@qa.example.test',
      'x@qa.example.test;z',
      'x@qa.example.test\r\nBcc: victim@qa.example.test',
      'qa\u0085@qa.example.test',
      'qa\u202e@qa.example.test',
      'no-domain@localhost',
      `${'a'.repeat(250)}@qa.example.test`,
    ]) {
      expect(await service(transport).deliver(NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT, input({ candidateEmail })), String(candidateEmail)).toMatchObject({
        status: 'FAILED',
        errorCode: 'INVALID_RECIPIENT',
        errorClass: 'PERMANENT',
      });
    }
    expect(transport.calls).toHaveLength(0);
    expect(isDeliverableAddress('First.Last+tag@Sub.QA-Valida.example.test')).toBe(true);
  });

  it('our own identities missing or unusable are CONFIGURATION failures (retried after the fix), never permanent — never sent', async () => {
    const transport = recordingTransport('accept');
    for (const internalRecipient of [null, '', 'Recruitment <recruitment@qa-valida.example.test>']) {
      expect(await service(transport, { internalRecipient }).deliver(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, input())).toMatchObject({
        status: 'FAILED',
        errorCode: 'RECIPIENT_NOT_CONFIGURED',
        errorClass: 'CONFIGURATION',
      });
    }
    for (const fromAddress of [null, 'careers']) {
      expect(await service(transport, { fromAddress }).deliver(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, input())).toMatchObject({
        errorCode: 'SENDER_NOT_CONFIGURED',
        errorClass: 'CONFIGURATION',
      });
    }
    expect(transport.calls).toHaveLength(0);
  });

  it('the recipient allowlist (development / review) stops anything else before the provider (RECIPIENT_NOT_ALLOWED)', async () => {
    const transport = recordingTransport('accept');
    const allowlisted = service(transport, { recipientAllowlist: ['recruitment@qa-valida.example.test', '@allowed.example.test'] });
    expect((await allowlisted.deliver(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, input())).status).toBe('SENT');
    expect(await allowlisted.deliver(NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT, input())).toMatchObject({ status: 'FAILED', errorCode: 'RECIPIENT_NOT_ALLOWED', errorClass: 'PERMANENT' });
    expect((await allowlisted.deliver(NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT, input({ candidateEmail: 'Someone@Allowed.example.test' }))).status).toBe('SENT');
    expect(transport.calls.map((message) => message.to[0])).toEqual(['recruitment@qa-valida.example.test', 'Someone@Allowed.example.test']);
    // The INTERNAL recipient outside the allowlist is our misconfiguration, not a permanent loss.
    const misconfigured = service(transport, { recipientAllowlist: ['@allowed.example.test'] });
    expect(await misconfigured.deliver(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, input())).toMatchObject({ errorCode: 'RECIPIENT_NOT_CONFIGURED', errorClass: 'CONFIGURATION' });
    expect(transport.calls).toHaveLength(2);
    expect(isAllowedRecipient('a@sub.allowed.example.test', ['@allowed.example.test'])).toBe(false);
    expect(isAllowedRecipient('anyone@x.example.test', null)).toBe(true);
  });

  it('a template defect is TEMPLATE_ERROR (CONFIGURATION) — nothing is sent', async () => {
    const transport = recordingTransport('accept');
    const outcome = await service(transport).deliver(NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL, input({ job: { title: '', slug: '' } }));
    expect(outcome).toMatchObject({ status: 'FAILED', errorCode: 'TEMPLATE_ERROR', errorClass: 'CONFIGURATION' });
    expect(transport.calls).toHaveLength(0);
  });

  it('acknowledgement is enabled only with a transport, the switch, a From address AND the Reply-To', () => {
    expect(service(null, { acknowledgementEnabled: true }).acknowledgementEnabled).toBe(false);
    expect(service(recordingTransport(), { acknowledgementEnabled: false }).acknowledgementEnabled).toBe(false);
    expect(service(recordingTransport(), { acknowledgementEnabled: true }).acknowledgementEnabled).toBe(true);
    expect(service(recordingTransport(), { acknowledgementEnabled: true, replyTo: null }).acknowledgementEnabled).toBe(false);
    expect(service(recordingTransport(), { acknowledgementEnabled: true, fromAddress: null }).acknowledgementEnabled).toBe(false);
  });
});

describe('verify(): readiness evidence comes only from the transport (Doc 15 section 146)', () => {
  it('no transport: NOT_CONFIGURED', async () => {
    expect(await service(null).verify()).toEqual({ ok: false, reason: 'NOT_CONFIGURED' });
  });
  it('ok / fixed failure code / unclassified -> PROVIDER_ERROR / hang -> TIMEOUT', async () => {
    expect(await service(recordingTransport('accept', { verify: 'ok' })).verify()).toEqual({ ok: true });
    expect(await service(recordingTransport('accept', { verify: 'PROVIDER_AUTH_FAILED' })).verify()).toEqual({ ok: false, reason: 'PROVIDER_AUTH_FAILED' });
    expect(await service(recordingTransport('accept', { verify: new Error('raw secret-QA') })).verify()).toEqual({ ok: false, reason: 'PROVIDER_ERROR' });
    const started = Date.now();
    expect(await service(recordingTransport('accept', { verify: 'hang' }), { timeoutMs: 50 }).verify()).toEqual({ ok: false, reason: 'TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(1000);
  });
  it('a transport without verify() is NOT_VERIFIABLE — never ready on trust', async () => {
    expect(await service(recordingTransport('accept', { verify: null })).verify()).toEqual({ ok: false, reason: 'NOT_VERIFIABLE' });
  });
  it('providerName is a bounded single-line token', () => {
    expect(service(recordingTransport('accept', { name: 'qa\r\nX'.repeat(20) })).providerName).not.toMatch(/[\r\n]/);
    expect(service(recordingTransport('accept', { name: 'qa\r\nX'.repeat(20) })).providerName.length).toBeLessThanOrEqual(40);
    expect(service(null).providerName).toBeNull();
  });
});
