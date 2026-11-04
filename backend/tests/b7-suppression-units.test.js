import { describe, it, expect } from 'vitest';
import util from 'node:util';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import mongoose from 'mongoose';
import {
  ADDRESS_DIGEST_DOMAIN,
  KEY_CHECK_DOMAIN,
  addressDigest,
  createKeyring,
  decodeKey,
  hexValuesMatch,
  keyCheckValue,
} from '../src/modules/suppression/suppressionKeys.js';
import { assessCoverage, createSuppressionGate, COVERAGE_REASONS } from '../src/modules/suppression/suppressionGate.js';
import { createSuppressionOperations, SuppressionRefused, messageTokenFor } from '../src/modules/suppression/suppressionOperations.js';
import { parseSuppressionArgs } from '../scripts/ops-notifications-suppression.mjs';
import { ConfigurationError, loadConfig } from '../src/config/env.js';
import { assessChannel, createApplicationNotifier } from '../src/modules/applications/application.notifications.js';
import { NOTIFICATION_EVENTS, createNotificationService } from '../src/integrations/notifications/notificationService.js';
import { capturingLogger } from './helpers.js';
import { QA_NOTIFICATION_OPTIONS, memoryApplicationRepository, recordingTransport } from './fixtures/applyHarness.js';
import { memorySuppressionRegister, registeredKeyDocuments, syntheticKey, syntheticKeyring } from './fixtures/suppressionDoubles.js';

/**
 * B7 — recipient suppression, OFFLINE units (design rev 8; OD-2026-11-04-02):
 * key handling and secrecy, configuration, the coverage decision, the
 * notifier's fail-closed paths with an in-memory register DOUBLE, the retry
 * classes of the new codes and the operator command's argument parser. The
 * register itself is proven against MongoDB in tests/db/b7-suppression-*.
 */

describe('keys — digests, check values, constant-time comparison (§4.1, §4.5.1; SUP-22f)', () => {
  const key = syntheticKey(1);
  it('address digests and key check values use different HMAC domains and never collide', () => {
    expect(ADDRESS_DIGEST_DOMAIN).not.toBe(KEY_CHECK_DOMAIN);
    expect(addressDigest(key, 'k1')).not.toBe(keyCheckValue(key, 'k1'));
    expect(addressDigest(key, 'qa@x.test')).toMatch(/^[0-9a-f]{64}$/);
    expect(addressDigest(key, 'qa@x.test')).toBe(addressDigest(key, 'qa@x.test'));
    expect(addressDigest(syntheticKey(2), 'qa@x.test')).not.toBe(addressDigest(key, 'qa@x.test'));
    expect(keyCheckValue(key, 'k1')).not.toBe(keyCheckValue(key, 'k2'));
  });

  it('SUP-10: no folding beyond Doc 10 (dots, +tags and non-ASCII stay distinct)', () => {
    const digest = (value) => addressDigest(key, value);
    expect(digest('a.b@x.test')).not.toBe(digest('ab@x.test'));
    expect(digest('a+t@x.test')).not.toBe(digest('a@x.test'));
    expect(digest('jörg@x.test')).not.toBe(digest('jorg@x.test'));
  });

  it('hexValuesMatch: equal values match; anything malformed is a MISMATCH and never throws', () => {
    const check = keyCheckValue(key, 'k1');
    expect(hexValuesMatch(check, check)).toBe(true);
    for (const other of [check.slice(0, 63), `${check}0`, check.toUpperCase(), null, undefined, 42, {}, '', 'z'.repeat(64)]) {
      expect(() => hexValuesMatch(check, other)).not.toThrow();
      expect(hexValuesMatch(check, other)).toBe(false);
    }
  });

  it('decodeKey: 32-128 bytes of clean base64 (standard or URL-safe); anything else null', () => {
    expect(decodeKey(Buffer.alloc(32, 9).toString('base64'))).toHaveLength(32);
    expect(decodeKey(Buffer.alloc(48, 250).toString('base64url'))).toHaveLength(48);
    for (const bad of [Buffer.alloc(31).toString('base64'), Buffer.alloc(129).toString('base64'), 'not base64!', `${Buffer.alloc(32).toString('base64')}\n`, '', null]) expect(decodeKey(bad)).toBeNull();
  });

  it('the keyring serialises to key ids only — never key bytes, digests or check values', () => {
    const keyring = createKeyring({ current: { keyId: 'k2', key }, previous: [{ keyId: 'k1', key: syntheticKey(3) }] });
    const shown = JSON.stringify(keyring) + util.inspect(keyring);
    expect(JSON.parse(JSON.stringify(keyring))).toEqual({ currentKeyId: 'k2', keyIds: ['k2', 'k1'] });
    for (const secret of [key.toString('base64'), key.toString('hex'), keyring.checkValueFor('k2')]) expect(shown).not.toContain(secret);
    expect(keyring.lookupPairs('qa@x.test').map((pair) => pair.keyId)).toEqual(['k2', 'k1']);
    expect(() => createKeyring({ current: { keyId: 'k1', key }, previous: [{ keyId: 'k1', key }] })).toThrow(/distinct/);
    expect(() => createKeyring({ current: { keyId: 'K1', key } })).toThrow();
  });
});

describe('configuration — suppression variables (§4.2, §5)', () => {
  const base = { MONGODB_URI: 'mongodb://127.0.0.1:27017/valida_test' };
  const KEY = Buffer.alloc(32, 77).toString('base64');
  const SECRET = Buffer.alloc(40, 66).toString('base64');
  const failure = (env) => {
    try {
      loadConfig({ ...base, ...env });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      return error.message;
    }
    throw new Error('expected a ConfigurationError');
  };

  it('a valid key, id, verify-only keys and operator tokens load; every serialised view shows ids only', () => {
    const config = loadConfig({ ...base, SUPPRESSION_HMAC_KEY: KEY, SUPPRESSION_HMAC_KEY_ID: 'k2', SUPPRESSION_HMAC_PREVIOUS_KEYS: `k1:${SECRET}`, SUPPRESSION_OPERATOR_IDS: 'op-one,op.two' });
    expect(config.suppression.current.keyId).toBe('k2');
    expect(config.suppression.previous.map((entry) => entry.keyId)).toEqual(['k1']);
    expect(config.suppression.operatorIds).toEqual(['op-one', 'op.two']);
    expect(config.suppression.lookupTimeoutMs).toBe(2_000);
    for (const view of [JSON.stringify(config), JSON.stringify(config.suppression), util.inspect(config.suppression), util.inspect(config)]) {
      expect(view).not.toContain(KEY);
      expect(view).not.toContain(SECRET);
    }
  });

  it('refuses malformed values without ever echoing them', () => {
    const cases = [
      [{ SUPPRESSION_HMAC_KEY: Buffer.alloc(16, 5).toString('base64'), SUPPRESSION_HMAC_KEY_ID: 'k1' }, /SUPPRESSION_HMAC_KEY: must be 32-128 bytes/],
      [{ SUPPRESSION_HMAC_KEY: KEY }, /SUPPRESSION_HMAC_KEY_ID: is required when SUPPRESSION_HMAC_KEY is set/],
      [{ SUPPRESSION_HMAC_KEY_ID: 'k1' }, /SUPPRESSION_HMAC_KEY_ID: is set but SUPPRESSION_HMAC_KEY is not/],
      [{ SUPPRESSION_HMAC_KEY: KEY, SUPPRESSION_HMAC_KEY_ID: 'Bad Id' }, /SUPPRESSION_HMAC_KEY_ID: must be 1-32 characters/],
      [{ SUPPRESSION_HMAC_PREVIOUS_KEYS: `k1:${SECRET}` }, /no current SUPPRESSION_HMAC_KEY/],
      [{ SUPPRESSION_HMAC_KEY: KEY, SUPPRESSION_HMAC_KEY_ID: 'k1', SUPPRESSION_HMAC_PREVIOUS_KEYS: `k1:${SECRET}` }, /must not repeat the current/],
      [{ SUPPRESSION_HMAC_KEY: KEY, SUPPRESSION_HMAC_KEY_ID: 'k2', SUPPRESSION_HMAC_PREVIOUS_KEYS: `k1:${SECRET},k1:${SECRET}` }, /SUPPRESSION_HMAC_PREVIOUS_KEYS: must be a comma-separated list/],
      [{ SUPPRESSION_HMAC_KEY: KEY, SUPPRESSION_HMAC_KEY_ID: 'k2', SUPPRESSION_HMAC_PREVIOUS_KEYS: `k1-${SECRET}` }, /SUPPRESSION_HMAC_PREVIOUS_KEYS: must be a comma-separated list/],
      [{ SUPPRESSION_OPERATOR_IDS: 'operator@example.test' }, /SUPPRESSION_OPERATOR_IDS: must be a comma-separated list/],
      [{ SUPPRESSION_LOOKUP_TIMEOUT_MS: '50' }, /SUPPRESSION_LOOKUP_TIMEOUT_MS/],
    ];
    for (const [env, pattern] of cases) {
      const message = failure(env);
      expect(message).toMatch(pattern);
      expect(message).not.toContain(KEY);
      expect(message).not.toContain(SECRET);
    }
  });

  it('production still refuses candidate acknowledgements outright, with or without a suppression key (G-SUP; OD-2026-11-04-02 item 5)', () => {
    const production = {
      ...base,
      APP_ENV: 'production',
      NODE_ENV: 'production',
      CORS_ALLOWED_ORIGINS: 'https://valida.example.test',
      TRANSACTIONAL_EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.qa.example.test',
      SMTP_USERNAME: 'n@qa.example.test',
      SMTP_PASSWORD: 'qa-secret-marker',
      TRANSACTIONAL_FROM_ADDRESS: 'n@qa.example.test',
      TRANSACTIONAL_REPLY_TO: 'careers@qa.example.test',
      RECRUITMENT_NOTIFICATION_RECIPIENT: 'hr@qa.example.test',
      APPLICATION_ACKNOWLEDGEMENT_ENABLED: 'true',
    };
    expect(failure(production)).toMatch(/gate G-SUP/);
    expect(failure({ ...production, SUPPRESSION_HMAC_KEY: KEY, SUPPRESSION_HMAC_KEY_ID: 'k1', SUPPRESSION_OPERATOR_IDS: 'op-one' })).toMatch(/gate G-SUP/);
  });
});

describe('coverage decision (§3.2, §4.4, §4.5.1; SUP-18, SUP-21 correction, SUP-22)', () => {
  const keyring = syntheticKeyring('k2', ['k1'], { seed: 10 });
  const good = registeredKeyDocuments(keyring);
  const assess = (overrides) => assessCoverage({ activeKeyIds: ['k1', 'k2'], keyDocuments: good, keyring, ...overrides });

  it('complete only when every configured key is ACTIVE and verified, every active key id configured, nothing RECOVERING', () => {
    expect(assess()).toMatchObject({ complete: true, problems: [] });
    expect(assess({ keyring: syntheticKeyring(null) }).problems).toContainEqual({ keyId: null, reason: 'CURRENT_KEY_MISSING' });
    expect(assess({ activeKeyIds: ['k0'] }).problems).toEqual([{ keyId: 'k0', reason: 'KEY_NOT_CONFIGURED' }]);
    expect(assess({ keyDocuments: good.filter((document) => document._id !== 'k1') }).problems).toEqual([{ keyId: 'k1', reason: 'KEY_CHECK_MISSING' }]);
    expect(assess({ keyDocuments: good.map((document) => (document._id === 'k1' ? { ...document, check: 'f'.repeat(64) } : document)) }).problems).toEqual([{ keyId: 'k1', reason: 'KEY_MATERIAL_MISMATCH' }]);
    expect(assess({ keyDocuments: good.map((document) => (document._id === 'k1' ? { ...document, check: 'short' } : document)) }).problems).toEqual([{ keyId: 'k1', reason: 'KEY_MATERIAL_MISMATCH' }]);
    expect(assess({ keyDocuments: good.map((document) => (document._id === 'k1' ? { ...document, state: 'RETIRED' } : document)) }).problems).toEqual([{ keyId: 'k1', reason: 'KEY_NOT_TRUSTED' }]);
    // A RECOVERING key document blocks even when no entry is left under it.
    expect(assess({ activeKeyIds: ['k2'], keyDocuments: [...good, { _id: 'k0', check: null, state: 'RECOVERING' }] }).problems).toEqual([{ keyId: 'k0', reason: 'KEY_RECOVERING' }]);
    expect(assess({ limitReached: true }).problems).toEqual([{ keyId: null, reason: 'COVERAGE_READ_LIMIT' }]);
  });

  it('the gate: incomplete coverage wins over a match; a read failure or timeout is UNAVAILABLE; no register is SUPPRESSION_NOT_CONFIGURED; never throws', async () => {
    const digest = keyring.digestUnder('k1', 'qa@x.test');
    const register = memorySuppressionRegister({ entries: [{ _id: 's1', keyId: 'k1', digest }], keyDocuments: good });
    const gate = createSuppressionGate({ register, keyring });
    expect(await gate.checkAcknowledgement({ emailNormalized: 'qa@x.test' })).toEqual({ decision: 'SUPPRESSED', errorCode: 'RECIPIENT_SUPPRESSED', suppressionId: 's1' });
    expect(await gate.checkAcknowledgement({ emailNormalized: 'other@x.test' })).toEqual({ decision: 'PROCEED' });
    register.state.entries.push({ _id: 's0', keyId: 'k0', digest: 'a'.repeat(64) });
    expect(await gate.checkAcknowledgement({ emailNormalized: 'qa@x.test' })).toMatchObject({ decision: 'COVERAGE_INCOMPLETE', errorCode: 'SUPPRESSION_COVERAGE_INCOMPLETE', problems: [{ keyId: 'k0', reason: 'KEY_NOT_CONFIGURED' }] });
    register.state.fail = Object.assign(new Error('qa'), { reason: 'timeout' });
    expect(await gate.checkAcknowledgement({ emailNormalized: 'qa@x.test' })).toEqual({ decision: 'UNAVAILABLE', errorCode: 'SUPPRESSION_CHECK_UNAVAILABLE', reason: 'TIMEOUT' });
    register.state.fail = new Error('qa: read failed');
    expect(await gate.checkAcknowledgement({ emailNormalized: 'qa@x.test' })).toMatchObject({ reason: 'READ_FAILED' });
    expect(await createSuppressionGate({ register: null, keyring }).checkAcknowledgement({ emailNormalized: 'qa@x.test' })).toMatchObject({ problems: [{ reason: COVERAGE_REASONS.SUPPRESSION_NOT_CONFIGURED }] });
    expect(await gate.checkAcknowledgement({ emailNormalized: '' })).toMatchObject({ decision: 'UNAVAILABLE', reason: 'NO_STORED_ADDRESS' });
  });
});

describe('the notifier fails closed (§3.2; SUP-4, SUP-11)', () => {
  const seed = (repo) => {
    const _id = '65f0c0ffee0000000000b7a1';
    repo.records.set('qa-b7-key', {
      _id,
      submittedAt: new Date('2026-11-04T00:00:00Z'),
      jobSnapshot: { title: 'QA Role', slug: 'qa-role' },
      candidate: { fullName: 'QA', email: 'qa@qa-valida.example.test', emailNormalized: 'qa@qa-valida.example.test' },
      resume: { storageKey: 'resumes/qa/b7' },
      notifications: { internal: { status: 'PENDING', attemptCount: 0, lastAttemptAt: null, sentAt: null, lastErrorCode: null, lastStatusCode: null }, candidateAcknowledgement: { status: 'PENDING', attemptCount: 0, lastAttemptAt: null, sentAt: null, lastErrorCode: null, lastStatusCode: null } },
    });
    return _id;
  };
  const run = async (suppression) => {
    const repo = memoryApplicationRepository();
    const transport = recordingTransport('accept');
    const log = capturingLogger();
    const notifications = createNotificationService({ transport, timeoutMs: 500, ...QA_NOTIFICATION_OPTIONS, acknowledgementEnabled: true });
    const notifier = createApplicationNotifier({ applications: repo, notifications, clock: () => new Date('2026-11-04T00:00:00Z'), logger: log.logger, suppression });
    const id = seed(repo);
    await notifier.notifyAccepted(await repo.loadForUpdate(id));
    const stored = repo.all().find((record) => String(record._id) === id).notifications;
    return { stored, transport, log };
  };

  it('no suppression check configured → the acknowledgement is SUPPRESSION_COVERAGE_INCOMPLETE, never sent; the internal notification is sent', async () => {
    const { stored, transport } = await run(null);
    expect(stored.candidateAcknowledgement).toMatchObject({ status: 'FAILED', lastErrorCode: 'SUPPRESSION_COVERAGE_INCOMPLETE', attemptCount: 1 });
    expect(stored.internal.status).toBe('SENT');
    expect(transport.calls.map((message) => message.event)).toEqual([NOTIFICATION_EVENTS.APPLICATION_RECEIVED_INTERNAL]);
  });

  it('a check that throws → SUPPRESSION_CHECK_UNAVAILABLE, never sent', async () => {
    const { stored, transport, log } = await run({ checkAcknowledgement: async () => Promise.reject(new Error('qa boom')) });
    expect(stored.candidateAcknowledgement.lastErrorCode).toBe('SUPPRESSION_CHECK_UNAVAILABLE');
    expect(transport.calls).toHaveLength(1);
    expect(log.output()).not.toContain('qa boom');
  });

  it('retry classes: RECIPIENT_SUPPRESSED never; SUPPRESSION_CHECK_UNAVAILABLE automatic after backoff; SUPPRESSION_COVERAGE_INCOMPLETE only with includeConfiguration', () => {
    const now = new Date('2026-11-05T00:00:00Z');
    const options = { channel: 'candidateAcknowledgement', now, submittedAt: new Date('2026-11-04T00:00:00Z'), acknowledgementEnabled: true, maxAttempts: 5, baseDelayMs: 60_000, staleMs: 60_000 };
    const state = (code) => ({ status: 'FAILED', attemptCount: 1, lastAttemptAt: new Date('2026-11-04T00:00:00Z'), lastErrorCode: code });
    expect(assessChannel(state('RECIPIENT_SUPPRESSED'), { ...options, includeUncertain: true, includeConfiguration: true })).toEqual({ category: 'PERMANENT', due: false });
    expect(assessChannel(state('SUPPRESSION_CHECK_UNAVAILABLE'), options)).toEqual({ category: 'TRANSIENT_DUE', due: true });
    expect(assessChannel(state('SUPPRESSION_COVERAGE_INCOMPLETE'), options)).toEqual({ category: 'CONFIGURATION', due: false });
    expect(assessChannel(state('SUPPRESSION_COVERAGE_INCOMPLETE'), { ...options, includeConfiguration: true })).toEqual({ category: 'CONFIGURATION', due: true });
  });
});

describe('operator command — arguments and refusals before any database work', () => {
  it('parses subcommands and flags; refuses unknown, repeated or missing values, and an add without exactly one source', () => {
    expect(parseSuppressionArgs(['add', '--from-refusal', '--application', '65f0c0ffee0000000000b7a1', '--evidence-ref', 'BNC-1', '--apply', '--operator', 'op-one'])).toEqual({
      subcommand: 'add',
      flags: { '--from-refusal': true, '--application': '65f0c0ffee0000000000b7a1', '--evidence-ref': 'BNC-1', '--apply': true, '--operator': 'op-one' },
    });
    expect(parseSuppressionArgs(['recover-key', '--key-id', 'k1', '--expected-count', '3', '--complete']).flags).toMatchObject({ '--expected-count': 3, '--complete': true });
    for (const argv of [[], ['nope'], ['list', '--bogus'], ['list', '--limit', '5', '--limit', '6'], ['list', '--limit'], ['list', '--limit', 'ten'], ['add', '--application', 'x'], ['add', '--from-refusal', '--from-bounce']]) {
      expect(() => parseSuppressionArgs(argv)).toThrow(SuppressionRefused);
    }
  });

  it('the script exits 2 on bad arguments without reading configuration or connecting', () => {
    const script = path.join(import.meta.dirname, '..', 'scripts', 'ops-notifications-suppression.mjs');
    const result = spawnSync(process.execPath, [script, 'add', '--from-refusal', '--from-bounce'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/REFUSED: INVALID_ARGUMENTS \(ADD_NEEDS_EXACTLY_ONE_SOURCE\)/);
  });

  it('SUP-9: more than one Application matching a DSN token is refused (MULTIPLE_MATCHES) — unreachable with real ids, proven with a stub read', async () => {
    const id = new mongoose.Types.ObjectId();
    const lastAttemptAt = new Date();
    const row = { _id: id, notifications: { candidateAcknowledgement: { status: 'SENT', lastAttemptAt }, internal: { lastAttemptAt: null } } };
    const stubModel = { db: { readyState: 1 }, find: () => ({ limit: () => ({ maxTimeMS: () => ({ lean: async () => [row, { ...row }] }) }) }) };
    const operations = createSuppressionOperations({ register: {}, keyring: syntheticKeyring(), operatorIds: ['op-one'], applicationModel: stubModel });
    await expect(
      operations.addFromBounce({ messageToken: messageTokenFor(NOTIFICATION_EVENTS.APPLICATION_ACKNOWLEDGEMENT, id), status: '5.1.1', dsnReceived: new Date(), evidenceRef: 'BNC-1' }),
    ).rejects.toMatchObject({ code: 'MULTIPLE_MATCHES' });
  });
});
