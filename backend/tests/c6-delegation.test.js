import { describe, it, expect, afterEach, vi } from 'vitest';
import util from 'node:util';
import request from 'supertest';
import { loadConfig } from '../src/config/env.js';
import {
  DELEGATION_OUTCOMES,
  DELEGATION_REASONS,
  RECRUITMENT_AUDIENCE,
  SERVICE_KEY_MIN_LENGTH,
  decideRecruitmentAudience,
  establishClientAddress,
  isUsableServiceKey,
  normaliseClientAddress,
  parseTrustedHops,
  readDelegatedVisitor,
  resolveRecruitmentAccess,
  resolveServiceDelegation,
} from '../src/config/recruitmentAccess.js';
import { OFFLINE_TEST_MONGODB_URI } from './helpers.js';
import { CLIENT_ADDRESS_CASES, TRUST_PROXY_VALUES } from './fixtures/clientAddressCases.js';
import { applyRequest, createApplyEnvironment, qaJob, recordingTransport } from './fixtures/applyHarness.js';

/**
 * C6-T2 — the API side of visitor delegation (config/recruitmentAccess.js,
 * "DELEGATION"; middleware/recruitmentAccess.js; middleware/noValidators.js).
 *
 * The real app with real local storage and in-memory repositories, as in
 * c6-recruitment-http.test.js. Every request here comes from 127.0.0.1.
 * Synthetic keys and documentation addresses only.
 */
const SLUG = 'qa-synthetic-apply-role';
const JOBS = '/api/v1/jobs';
const KEY = 'qa-c6t2-unit-key-0123456789abcdef0123456789abcdef';
const OTHER_KEY = 'qa-c6t2-unit-key-ffffffffffffffffffffffffffffffff';
const LISTED = '203.0.113.7';
const UNLISTED = '192.0.2.44';
const OD = 'OD-2026-11-15-01';

const testers = (allowlist) => resolveRecruitmentAccess({ mode: 'testers', allowlist, appEnv: 'local' });
const publicMode = () => resolveRecruitmentAccess({ mode: 'public', authorisation: OD, appEnv: 'production' });
const delegationWith = (key = KEY) => resolveServiceDelegation({ key });

let env;
afterEach(async () => {
  await env?.cleanup();
  env = undefined;
  vi.restoreAllMocks();
});

async function app({ access, delegation = delegationWith(), trustProxy = false }) {
  const transport = recordingTransport('accept');
  env = await createApplyEnvironment({ jobs: [qaJob()], transport, configOverrides: { trustProxy, recruitment: access, serviceDelegation: delegation } });
  env.jobs.listOpenJobs = async () => ({ total: 1, jobs: [...env.jobs.jobs.values()] });
  env.jobs.findPublicJobBySlug = async ({ slug }) => [...env.jobs.jobs.values()].find((job) => job.slug === slug) ?? null;
  return { app: env.app, transport };
}
const delegate = (visitor, key = KEY) => ({ ...(key === null ? {} : { 'x-valida-internal-key': key }), ...(visitor === null ? {} : { 'x-valida-visitor-address': visitor }) });
const isTester = (response) => response.headers['x-valida-audience'] === 'tester';
const itemsOf = (response) => response.body?.data?.items ?? null;

/* ---------------------------------------------------- the shared rules -- */

describe('one address rule for both services — the shared case table', () => {
  it.each(CLIENT_ADDRESS_CASES.map((c) => [c.name, c]))('%s', (_name, c) => {
    expect(establishClientAddress({ trustedHops: c.trustedHops, socketAddress: c.socketAddress, forwardedFor: c.forwardedFor })).toBe(c.expected);
  });

  it.each(CLIENT_ADDRESS_CASES.filter((c) => c.http).map((c) => [c.name, c]))('over HTTP, a direct request: %s', async (_name, c) => {
    // The allowlist holds exactly the address the case expects, in its one accepted spelling
    // (a mapped client is listed by its IPv4 form, T1 correction 1), or nothing that could match.
    const listedAddress = c.expected === null ? '198.51.100.99' : normaliseClientAddress(c.expected).address;
    const { app: application } = await app({ access: testers(listedAddress), trustProxy: c.trustedHops });
    const call = request(application).get(JOBS);
    const response = await (c.forwardedFor === undefined ? call : call.set('X-Forwarded-For', c.forwardedFor));
    expect(isTester(response)).toBe(c.expected !== null);
    expect(itemsOf(response)).toHaveLength(c.expected !== null ? 1 : 0);
  });

  it.each(TRUST_PROXY_VALUES.map(([value, expected]) => [String(JSON.stringify(value)), value, expected]))(
    'TRUST_PROXY %s: the shared rule and the backend configuration agree',
    (_label, value, expected) => {
      expect(parseTrustedHops(value)).toBe(expected);
      const base = { NODE_ENV: 'test', APP_ENV: 'local', PORT: '4100', MONGODB_URI: OFFLINE_TEST_MONGODB_URI };
      const environment = value === undefined ? base : { ...base, TRUST_PROXY: value };
      if (expected === null) expect(() => loadConfig(environment)).toThrow();
      else expect(loadConfig(environment).trustProxy).toBe(expected);
    },
  );
});

describe('INTERNAL_SERVICE_KEY — resolved without ever stopping the backend, and never shown', () => {
  it.each([
    ['absent', undefined, DELEGATION_REASONS.KEY_ABSENT],
    ['empty', '', DELEGATION_REASONS.KEY_ABSENT],
    ['too short', 'x'.repeat(SERVICE_KEY_MIN_LENGTH - 1), DELEGATION_REASONS.KEY_INVALID],
    ['too long', 'x'.repeat(513), DELEGATION_REASONS.KEY_INVALID],
    ['containing a space', `${'x'.repeat(20)} ${'x'.repeat(20)}`, DELEGATION_REASONS.KEY_INVALID],
    ['containing a non-ASCII letter', `${'x'.repeat(40)}é`, DELEGATION_REASONS.KEY_INVALID],
    ['containing a control character', `${'x'.repeat(40)}\n`, DELEGATION_REASONS.KEY_INVALID],
    ['not a string', 12345678901234567890123456789012345, DELEGATION_REASONS.KEY_INVALID],
  ])('%s: delegation disabled', (_label, key, reason) => {
    const delegation = resolveServiceDelegation({ key });
    expect(delegation).toMatchObject({ enabled: false, reason });
    expect(delegation.digest).toBeNull();
  });

  it('a usable key enables delegation; the key is in no serialised form, and only a digest is kept', () => {
    const delegation = resolveServiceDelegation({ key: KEY });
    expect(delegation).toMatchObject({ enabled: true, reason: DELEGATION_REASONS.ENABLED });
    expect(isUsableServiceKey(KEY)).toBe(true);
    for (const form of [JSON.stringify(delegation), util.inspect(delegation, { depth: 5 }), JSON.stringify({ ...delegation }), String(Object.keys(delegation))]) {
      expect(form).not.toContain(KEY);
    }
    expect(delegation.digest.toString('utf8')).not.toContain(KEY);
    expect(Object.isFrozen(delegation)).toBe(true);
  });

  it('loadConfig: an unusable key does not throw; the configuration never shows the key', () => {
    const base = { NODE_ENV: 'test', APP_ENV: 'local', PORT: '4100', MONGODB_URI: OFFLINE_TEST_MONGODB_URI };
    expect(loadConfig({ ...base, INTERNAL_SERVICE_KEY: 'short' }).serviceDelegation).toMatchObject({ enabled: false, reason: DELEGATION_REASONS.KEY_INVALID });
    const config = loadConfig({ ...base, INTERNAL_SERVICE_KEY: KEY });
    expect(config.serviceDelegation.enabled).toBe(true);
    expect(`${JSON.stringify(config)}${util.inspect(config, { depth: 10 })}`).not.toContain(KEY);
  });
});

describe('readDelegatedVisitor — the decision table', () => {
  const enabled = delegationWith();
  const read = (headers, method = 'GET', delegation = enabled) => readDelegatedVisitor({ delegation, method, headers });

  it('neither header: not a delegation — the request is decided directly', () => {
    expect(read({ 'x-forwarded-for': LISTED })).toEqual({ attempted: false, outcome: DELEGATION_OUTCOMES.NOT_ATTEMPTED, clientAddress: null });
  });

  it.each([
    ['the key and a listed visitor', delegate(LISTED), DELEGATION_OUTCOMES.ACCEPTED, LISTED],
    ['the key and an IPv6 visitor', delegate('2001:db8:10::1'), DELEGATION_OUTCOMES.ACCEPTED, '2001:db8:10::1'],
    ['the key and "unlisted"', delegate('unlisted'), DELEGATION_OUTCOMES.ACCEPTED_UNLISTED, null],
    ['no key, a listed visitor', delegate(LISTED, null), DELEGATION_OUTCOMES.REJECTED_KEY_ABSENT, null],
    ['an empty key', delegate(LISTED, ''), DELEGATION_OUTCOMES.REJECTED_KEY_ABSENT, null],
    ['a wrong key of the same length', delegate(LISTED, OTHER_KEY), DELEGATION_OUTCOMES.REJECTED_KEY_MISMATCH, null],
    ['the key with one more character', delegate(LISTED, `${KEY}x`), DELEGATION_OUTCOMES.REJECTED_KEY_MISMATCH, null],
    ['the key with one character fewer', delegate(LISTED, KEY.slice(0, -1)), DELEGATION_OUTCOMES.REJECTED_KEY_MISMATCH, null],
    ['the key sent twice (Node joins them)', delegate(LISTED, `${KEY}, ${KEY}`), DELEGATION_OUTCOMES.REJECTED_KEY_MISMATCH, null],
    ['an over-long key', delegate(LISTED, 'k'.repeat(4096)), DELEGATION_OUTCOMES.REJECTED_KEY_MISMATCH, null],
    ['the key, no visitor', delegate(null), DELEGATION_OUTCOMES.REJECTED_VISITOR_ABSENT, null],
    ['the key, an empty visitor', delegate(''), DELEGATION_OUTCOMES.REJECTED_VISITOR_ABSENT, null],
    ['the key, a visitor with a port', delegate(`${LISTED}:443`), DELEGATION_OUTCOMES.REJECTED_VISITOR_INVALID, null],
    ['the key, two visitors', delegate(`${UNLISTED}, ${LISTED}`), DELEGATION_OUTCOMES.REJECTED_VISITOR_INVALID, null],
    ['the key, a padded visitor', delegate(` ${LISTED}`), DELEGATION_OUTCOMES.REJECTED_VISITOR_INVALID, null],
    ['the key, a host name', delegate('tester.example'), DELEGATION_OUTCOMES.REJECTED_VISITOR_INVALID, null],
    ['the key, a zone identifier', delegate('fe80::1%eth0'), DELEGATION_OUTCOMES.REJECTED_VISITOR_INVALID, null],
    ['the key, "Unlisted" in another case', delegate('Unlisted'), DELEGATION_OUTCOMES.REJECTED_VISITOR_INVALID, null],
    ['the key, an over-long visitor', delegate('1'.repeat(100)), DELEGATION_OUTCOMES.REJECTED_VISITOR_INVALID, null],
  ])('%s', (_label, headers, outcome, clientAddress) => {
    expect(read(headers)).toEqual({ attempted: true, outcome, clientAddress });
  });

  it.each([['POST'], ['PUT'], ['PATCH'], ['DELETE'], ['OPTIONS']])('%s with valid delegation headers is refused: no submission privilege', (method) => {
    expect(read(delegate(LISTED), method)).toEqual({ attempted: true, outcome: DELEGATION_OUTCOMES.REJECTED_METHOD, clientAddress: null });
  });

  it('HEAD is a read', () => {
    expect(read(delegate(LISTED), 'HEAD').outcome).toBe(DELEGATION_OUTCOMES.ACCEPTED);
  });

  it('delegation disabled at the API: every attempt is rejected, the right key included', () => {
    expect(read(delegate(LISTED), 'GET', resolveServiceDelegation({})).outcome).toBe(DELEGATION_OUTCOMES.REJECTED_DISABLED);
    expect(read(delegate(LISTED), 'GET', { enabled: true, digest: 'not-a-buffer' }).outcome).toBe(DELEGATION_OUTCOMES.REJECTED_DISABLED);
    expect(readDelegatedVisitor({ delegation: undefined, method: 'GET', headers: delegate(LISTED) }).outcome).toBe(DELEGATION_OUTCOMES.REJECTED_DISABLED);
  });

  it('an accepted delegation never gives more than the visitor would get directly', () => {
    const access = testers(LISTED);
    const accepted = read(delegate(LISTED));
    expect(decideRecruitmentAudience(access, accepted.clientAddress)).toBe(decideRecruitmentAudience(access, LISTED));
    const unlisted = read(delegate(UNLISTED));
    expect(decideRecruitmentAudience(access, unlisted.clientAddress)).toBe(RECRUITMENT_AUDIENCE.NONE);
  });
});

/* ---------------------------------------------------------------- HTTP -- */

describe('over HTTP — a delegated read is decided from the visitor, never from the caller', () => {
  it('the caller (127.0.0.1) is NOT listed; a delegated listed visitor gets the tester view; an unlisted one does not', async () => {
    const { app: application } = await app({ access: testers(`${LISTED},2001:db8:10::/48`) });
    expect(isTester(await request(application).get(JOBS))).toBe(false);
    const listed = await request(application).get(JOBS).set(delegate(LISTED));
    expect(isTester(listed)).toBe(true);
    expect(itemsOf(listed)).toHaveLength(1);
    const detail = await request(application).get(`${JOBS}/${SLUG}`).set(delegate(LISTED));
    expect(detail.status).toBe(200);
    expect(isTester(detail)).toBe(true);
    const unlisted = await request(application).get(`${JOBS}/${SLUG}`).set(delegate(UNLISTED));
    expect(unlisted.status).toBe(404);
    expect(isTester(unlisted)).toBe(false);
  });

  it('the caller IS listed (loopback): every invalid delegation gets the unlisted view, never the caller\'s', async () => {
    const { app: application } = await app({ access: testers('127.0.0.1/32,::1/128') });
    // Control: a direct request from the listed caller is a tester.
    expect(isTester(await request(application).get(JOBS))).toBe(true);
    for (const headers of [delegate(UNLISTED), delegate('unlisted'), delegate(LISTED, null), delegate(LISTED, OTHER_KEY), delegate(null), delegate('127.0.0.1:80'), delegate('not-an-address')]) {
      const list = await request(application).get(JOBS).set(headers);
      expect(list.status).toBe(200);
      expect(isTester(list)).toBe(false);
      expect(itemsOf(list)).toEqual([]);
      expect((await request(application).get(`${JOBS}/${SLUG}`).set(headers)).status).toBe(404);
    }
  });

  it('a delegated read with TRUST_PROXY set: the forwarding chain is not consulted at all', async () => {
    const { app: application } = await app({ access: testers(LISTED), trustProxy: 1 });
    // The chain names a listed client, the delegation an unlisted one: the delegation decides.
    const response = await request(application).get(JOBS).set('X-Forwarded-For', LISTED).set(delegate(UNLISTED));
    expect(isTester(response)).toBe(false);
    // And a broken delegation does not fall back to the chain.
    expect(isTester(await request(application).get(JOBS).set('X-Forwarded-For', LISTED).set(delegate(LISTED, OTHER_KEY)))).toBe(false);
    // Without delegation headers, the chain decides as in T1.
    expect(isTester(await request(application).get(JOBS).set('X-Forwarded-For', LISTED))).toBe(true);
  });

  it('delegation disabled at the API: the right key is rejected, the listed caller is not used', async () => {
    const { app: application } = await app({ access: testers('127.0.0.1/32'), delegation: resolveServiceDelegation({}) });
    expect(isTester(await request(application).get(JOBS).set(delegate('127.0.0.1')))).toBe(false);
  });

  it('a delegation grants NO submission — refused before the body, nothing stored, written or sent — in testers and in public', async () => {
    for (const access of [testers(`${LISTED},127.0.0.1/32`), publicMode()]) {
      const { app: application, transport } = await app({ access });
      const response = await applyRequest(application).set(delegate(LISTED));
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('JOB_NOT_FOUND');
      expect(response.headers.connection).toBe('close');
      expect(isTester(response)).toBe(false);
      await env.submission.drainFollowUps();
      expect(env.applications.all()).toHaveLength(0);
      expect(env.storedObjects()).toHaveLength(0);
      expect(env.tempFiles()).toHaveLength(0);
      expect(transport.calls).toHaveLength(0);
      // Only the visitor header, or only the key, is also a delegation attempt.
      expect((await applyRequest(application).set('X-Valida-Visitor-Address', LISTED)).status).toBe(404);
      expect((await applyRequest(application).set('X-Valida-Internal-Key', KEY)).status).toBe(404);
      await env.cleanup();
      env = undefined;
    }
  });

  it('POSITIVE CONTROL — the same submission without delegation headers is accepted (listed caller)', async () => {
    const { app: application } = await app({ access: testers('127.0.0.1/32,::1/128') });
    const response = await applyRequest(application);
    expect(response.status).toBe(201);
    await env.submission.drainFollowUps();
    expect(env.applications.all()).toHaveLength(1);
    expect(env.applications.all()[0].notifications.candidateAcknowledgement.status).toBe('NOT_REQUIRED');
  });

  it('public mode: any delegated read, valid or not, gets the public view', async () => {
    const { app: application } = await app({ access: publicMode() });
    for (const headers of [delegate(LISTED), delegate('unlisted'), delegate(LISTED, OTHER_KEY), delegate(null)]) {
      const response = await request(application).get(`${JOBS}/${SLUG}`).set(headers);
      expect(response.status).toBe(200);
      expect(isTester(response)).toBe(false);
    }
  });

  it('closed mode: a valid delegation of a listed visitor changes nothing', async () => {
    const { app: application } = await app({ access: resolveRecruitmentAccess({ mode: 'closed' }) });
    expect(itemsOf(await request(application).get(JOBS).set(delegate(LISTED)))).toEqual([]);
    expect((await request(application).get(`${JOBS}/${SLUG}`).set(delegate(LISTED))).status).toBe(404);
  });

  it('a rejected delegation is logged by its reason code only — no key, no address', async () => {
    const { app: application } = await app({ access: testers(LISTED) });
    await request(application).get(JOBS).set(delegate(LISTED, OTHER_KEY));
    await request(application).get(JOBS).set(delegate(`${LISTED}:1`));
    await request(application).get(JOBS).set(delegate(LISTED));
    const lines = env.log.output().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    const rejected = lines.filter((entry) => entry.event === 'recruitment.delegation_rejected');
    expect(rejected.map((entry) => entry.outcome)).toEqual([DELEGATION_OUTCOMES.REJECTED_KEY_MISMATCH, DELEGATION_OUTCOMES.REJECTED_VISITOR_INVALID]);
    const output = env.log.output();
    for (const forbidden of [KEY, OTHER_KEY, LISTED, 'x-valida-internal-key']) expect(output).not.toContain(forbidden);
  });

  it('the CORS policy does not let a browser send the delegation headers', async () => {
    const { app: application } = await app({ access: testers(LISTED) });
    const preflight = await request(application)
      .options(JOBS)
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'x-valida-internal-key, x-valida-visitor-address');
    const allowed = (preflight.headers['access-control-allow-headers'] ?? '').toLowerCase();
    expect(allowed).not.toContain('x-valida-internal-key');
    expect(allowed).not.toContain('x-valida-visitor-address');
  });
});

describe('Jobs responses carry no validator and are never answered 304', () => {
  const conditional = { 'If-None-Match': '*', 'If-Modified-Since': new Date(Date.now() + 60_000).toUTCString() };

  it.each([
    ['the list, for a tester', testers('127.0.0.1/32'), JOBS, 200],
    ['the Job, for a tester', testers('127.0.0.1/32'), `${JOBS}/${SLUG}`, 200],
    ['an unknown Job', testers('127.0.0.1/32'), `${JOBS}/qa-no-such-role`, 404],
    ['the list, refused', testers(LISTED), JOBS, 200],
    ['the Job, refused', testers(LISTED), `${JOBS}/${SLUG}`, 404],
    ['the Job, public', publicMode(), `${JOBS}/${SLUG}`, 200],
  ])('%s: no ETag, no Last-Modified; a conditional GET with the earlier ETag gets the full answer', async (_label, access, path, status) => {
    const { app: application } = await app({ access });
    const first = await request(application).get(path);
    expect(first.status).toBe(status);
    expect(first.headers.etag).toBeUndefined();
    expect(first.headers['last-modified']).toBeUndefined();
    expect(first.headers['cache-control']).toBe('no-store');
    for (const headers of [conditional, { 'If-None-Match': 'W/"anything"' }]) {
      const again = await request(application).get(path).set(headers);
      expect(again.status).toBe(status);
      expect(again.headers.etag).toBeUndefined();
      expect(JSON.stringify(again.body)).toBe(JSON.stringify({ ...first.body, meta: again.body.meta }));
    }
  });

  it('outside /api/v1/jobs nothing changed: health still has its accepted headers', async () => {
    const { app: application } = await app({ access: testers(LISTED) });
    const health = await request(application).get('/api/v1/health');
    expect(health.status).toBe(200);
  });
});

describe('start-up states whether delegation is available — never the key', () => {
  it('the description', async () => {
    const { describeRecruitmentAccess } = await import('../src/config/recruitmentAccess.js');
    expect(describeRecruitmentAccess(testers(LISTED), delegationWith())).toMatchObject({ recruitmentDelegation: 'enabled', recruitmentDelegationReason: 'DELEGATION_ENABLED' });
    expect(describeRecruitmentAccess(testers(LISTED), resolveServiceDelegation({ key: 'short' }))).toMatchObject({ recruitmentDelegation: 'disabled', recruitmentDelegationReason: 'DELEGATION_KEY_INVALID' });
    expect(JSON.stringify(describeRecruitmentAccess(testers(LISTED), delegationWith()))).not.toContain(KEY);
  });
});
