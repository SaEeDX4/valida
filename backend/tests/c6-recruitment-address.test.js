import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { RECRUITMENT_AUDIENCE, RECRUITMENT_REASONS, decideRecruitmentAudience, normaliseClientAddress, parseAccessAllowlist, resolveRecruitmentAccess } from '../src/config/recruitmentAccess.js';
import { applyRequest, createApplyEnvironment, qaJob, recordingTransport } from './fixtures/applyHarness.js';

/**
 * C6-T1 correction 1 — tester-address validation (C6 plan revision 3, section
 * 4.6.3). Two gaps found in review of e7f09af, each with its regressions.
 *
 * GAP 1 — an incomplete forwarding chain.
 *   With TRUST_PROXY = n hops, Express falls back when X-Forwarded-For holds
 *   fewer than n entries: with none it returns the socket peer, with too few
 *   it returns the leftmost entry. Either can be a listed address although no
 *   proxy vouched for it — a request that reached the backend around the
 *   proxy, or a client-supplied header. The rule is: fewer than n entries
 *   means the client address is unknown, and unknown is unlisted.
 *
 * GAP 2 — IPv4-mapped IPv6 spellings.
 *   The allowlist refused "::ffff:203.0.113.7" by its text, so the same
 *   address written "::ffff:cb00:7107" or "0:0:0:0:0:ffff:cb00:7107" was
 *   accepted — and "::ffff:0:0/96", which is ALL of IPv4, passed the IPv6
 *   prefix limit. The policy now applies to the parsed VALUE.
 *
 * Synthetic data and documentation addresses only (RFC 5737, RFC 3849).
 * 203.0.113.7 is cb00:7107 in hexadecimal; 203.0.113.8 is cb00:7108.
 */
const SLUG = 'qa-synthetic-apply-role';
const JOBS = '/api/v1/jobs';
const LISTED = '203.0.113.7';
const UNLISTED = '192.0.2.44';
const PROXY = '198.51.100.200';
const testers = (allowlist) => resolveRecruitmentAccess({ mode: 'testers', allowlist, appEnv: 'local' });

let env;
afterEach(async () => {
  await env?.cleanup();
  env = undefined;
});

async function app(access, trustProxy) {
  const transport = recordingTransport('accept');
  env = await createApplyEnvironment({ jobs: [qaJob()], transport, configOverrides: { trustProxy, recruitment: access } });
  env.jobs.listOpenJobs = async () => ({ total: 1, jobs: [...env.jobs.jobs.values()] });
  env.jobs.findPublicJobBySlug = async ({ slug }) => [...env.jobs.jobs.values()].find((job) => job.slug === slug) ?? null;
  return { app: env.app, transport };
}

const isTester = (response) => response.headers['x-valida-audience'] === 'tester';
async function expectUnlisted(application, forwarded) {
  const get = request(application).get(JOBS);
  const list = await (forwarded === undefined ? get : get.set('X-Forwarded-For', forwarded));
  expect(list.status).toBe(200);
  expect(isTester(list)).toBe(false);
  expect(list.body.data.items).toEqual([]);
}
async function expectTester(application, forwarded) {
  const get = request(application).get(JOBS);
  const list = await (forwarded === undefined ? get : get.set('X-Forwarded-For', forwarded));
  expect(list.status).toBe(200);
  expect(isTester(list)).toBe(true);
  expect(list.body.data.items.map((item) => item.slug)).toEqual([SLUG]);
}

/* ---------------------------------------------------------------- GAP 1 -- */

describe('GAP 1 — with a trusted-hop count, an incomplete forwarding chain is an unknown client', () => {
  // Loopback is LISTED here on purpose: the socket peer of every request in
  // this suite would match the allowlist if it were ever used as the client.
  const LOOPBACK_AND_REMOTE = `127.0.0.1/32,::1/128,${LISTED}`;

  it('1 hop, no X-Forwarded-For at all: unlisted, although the socket peer is on the list', async () => {
    const { app: application, transport } = await app(testers(LOOPBACK_AND_REMOTE), 1);
    await expectUnlisted(application, undefined);
    expect((await request(application).get(`${JOBS}/${SLUG}`)).status).toBe(404);
    const submission = await applyRequest(application);
    expect(submission.status).toBe(404);
    expect(submission.body.error.code).toBe('JOB_NOT_FOUND');
    expect(env.applications.all()).toHaveLength(0);
    expect(env.storedObjects()).toHaveLength(0);
    expect(env.tempFiles()).toHaveLength(0);
    expect(transport.calls).toHaveLength(0);
  });

  it('1 hop, an empty X-Forwarded-For: unlisted', async () => {
    const { app: application } = await app(testers(LOOPBACK_AND_REMOTE), 1);
    await expectUnlisted(application, '');
    await expectUnlisted(application, ' ');
    await expectUnlisted(application, ',');
  });

  it('2 hops, one entry — a listed address: unlisted (the chain is one short)', async () => {
    const { app: application } = await app(testers(LOOPBACK_AND_REMOTE), 2);
    await expectUnlisted(application, LISTED);
    expect((await applyRequest(application).set('X-Forwarded-For', LISTED)).status).toBe(404);
  });

  it('3 hops, two entries: unlisted, whichever of them is listed', async () => {
    const { app: application } = await app(testers(LOOPBACK_AND_REMOTE), 3);
    await expectUnlisted(application, `${LISTED}, ${PROXY}`);
    await expectUnlisted(application, `${PROXY}, ${LISTED}`);
    await expectUnlisted(application, `${LISTED}, ${LISTED}`);
  });

  it('2 hops, no header: unlisted', async () => {
    const { app: application } = await app(testers(LOOPBACK_AND_REMOTE), 2);
    await expectUnlisted(application, undefined);
  });

  it('an entry at or to the right of the client position that is not an address: unlisted', async () => {
    const { app: application } = await app(testers(LOOPBACK_AND_REMOTE), 2);
    await expectUnlisted(application, `${LISTED}, not-a-proxy`);
    await expectUnlisted(application, `not-an-address, ${PROXY}`);
    await expectUnlisted(application, `${LISTED}, `);
  });
});

describe('GAP 1 — a full-length chain still identifies the client', () => {
  const REMOTE_ONLY = `${LISTED},2001:db8:10::/48`;

  it('1 hop, one entry', async () => {
    const { app: application } = await app(testers(REMOTE_ONLY), 1);
    await expectTester(application, LISTED);
    await expectUnlisted(application, UNLISTED);
  });

  it('2 hops, exactly two entries: the left one is the client', async () => {
    const { app: application } = await app(testers(REMOTE_ONLY), 2);
    await expectTester(application, `${LISTED}, ${PROXY}`);
    await expectUnlisted(application, `${UNLISTED}, ${PROXY}`);
  });

  it('2 hops, three entries: the entry two from the right is the client; what the client put in front is ignored', async () => {
    const { app: application } = await app(testers(REMOTE_ONLY), 2);
    await expectTester(application, `${UNLISTED}, ${LISTED}, ${PROXY}`);
    await expectUnlisted(application, `${LISTED}, ${UNLISTED}, ${PROXY}`);
    // Text in front of the client position is client-supplied and may be anything.
    await expectTester(application, `anything-at-all, ${LISTED}, ${PROXY}`);
  });

  it('3 hops, exactly three entries', async () => {
    const { app: application } = await app(testers(REMOTE_ONLY), 3);
    await expectTester(application, `${LISTED}, ${PROXY}, 198.51.100.201`);
    await expectUnlisted(application, `${UNLISTED}, ${LISTED}, ${PROXY}`);
  });

  it('an IPv6 client, and an IPv4 client reported in a mapped form by a proxy', async () => {
    const { app: application } = await app(testers(REMOTE_ONLY), 1);
    await expectTester(application, '2001:db8:10::beef');
    await expectTester(application, `::ffff:${LISTED}`);
    await expectTester(application, '::ffff:cb00:7107');
    await expectUnlisted(application, '::ffff:cb00:7108');
  });

  it('POSITIVE CONTROL — an authorised tester behind one hop reaches the accepted flow: list, Job, application', async () => {
    const { app: application, transport } = await app(testers(REMOTE_ONLY), 1);
    await expectTester(application, LISTED);
    const detail = await request(application).get(`${JOBS}/${SLUG}`).set('X-Forwarded-For', LISTED);
    expect(detail.status).toBe(200);
    expect(detail.body.data.slug).toBe(SLUG);
    const submitted = await applyRequest(application).set('X-Forwarded-For', LISTED);
    expect(submitted.status).toBe(201);
    expect(submitted.body.data).toMatchObject({ status: 'RECEIVED', job: { slug: SLUG } });
    expect(isTester(submitted)).toBe(true);
    await env.submission.drainFollowUps();
    expect(env.applications.all()).toHaveLength(1);
    expect(env.storedObjects()).toHaveLength(1);
    expect(env.tempFiles()).toHaveLength(0);
    expect(transport.calls).toHaveLength(1);
    expect(env.applications.all()[0].notifications.candidateAcknowledgement.status).toBe('NOT_REQUIRED');
  });
});

describe('GAP 1 — with proxy trust disabled, the socket peer decides, exactly as before', () => {
  it('a listed socket peer is a tester, with or without a forwarding header', async () => {
    const { app: application } = await app(testers('127.0.0.1/32,::1/128'), false);
    await expectTester(application, undefined);
    await expectTester(application, UNLISTED);
    await expectTester(application, 'not-an-address');
    const submitted = await applyRequest(application);
    expect(submitted.status).toBe(201);
  });

  it('an unlisted socket peer is nobody, whatever the header says', async () => {
    const { app: application } = await app(testers(LISTED), false);
    await expectUnlisted(application, undefined);
    await expectUnlisted(application, LISTED);
    await expectUnlisted(application, `${LISTED}, ${LISTED}`);
  });
});

/* ---------------------------------------------------------------- GAP 2 -- */

describe('GAP 2 — an IPv4-mapped allowlist entry is refused in every spelling', () => {
  it.each([
    ['dotted, compact', '::ffff:203.0.113.7'],
    ['dotted, upper case', '::FFFF:203.0.113.7'],
    ['hexadecimal', '::ffff:cb00:7107'],
    ['hexadecimal, upper case', '::FFFF:CB00:7107'],
    ['expanded, hexadecimal', '0:0:0:0:0:ffff:cb00:7107'],
    ['expanded with leading zeros', '0000:0000:0000:0000:0000:ffff:cb00:7107'],
    ['expanded, dotted tail', '0:0:0:0:0:ffff:203.0.113.7'],
    ['partly compressed', '0::ffff:cb00:7107'],
    ['with a /128 prefix', '::ffff:cb00:7107/128'],
    ['a mapped range', '::ffff:cb00:7100/120'],
    ['ALL of IPv4, as a mapped /96', '::ffff:0:0/96'],
    ['ALL of IPv4, expanded', '0:0:0:0:0:ffff::/96'],
    ['an IPv6 range that contains the mapped block', '::/16'],
    ['another IPv6 range that contains the mapped block', '0:0:0:0:0:ffff::/80'],
    ['a range ending inside the mapped block', '::ffff:0:0/97'],
  ])('%s', (_label, entry) => {
    expect(parseAccessAllowlist(entry)).toEqual({ ok: false, problem: 'INVALID' });
    expect(parseAccessAllowlist(`203.0.113.0/24,${entry}`)).toEqual({ ok: false, problem: 'INVALID' });
  });

  it('an invalid entry closes the ENTIRE tester configuration — the valid entries beside it admit nobody', async () => {
    const access = resolveRecruitmentAccess({ mode: 'testers', allowlist: `127.0.0.1/32,::1/128,${LISTED},::ffff:cb00:7107`, appEnv: 'local' });
    expect(access).toMatchObject({ mode: 'closed', configured: 'invalid', reason: RECRUITMENT_REASONS.TESTERS_ALLOWLIST_INVALID, allowlistEntries: 0 });
    for (const address of ['127.0.0.1', '::1', LISTED, `::ffff:${LISTED}`, '::ffff:cb00:7107']) {
      expect(decideRecruitmentAudience(access, address)).toBe(RECRUITMENT_AUDIENCE.NONE);
    }
    // And through the real API: the loopback client, listed by a valid entry, is refused.
    const { app: application } = await app(access, false);
    await expectUnlisted(application, undefined);
    expect((await request(application).get(`${JOBS}/${SLUG}`)).status).toBe(404);
    expect((await applyRequest(application)).status).toBe(404);
    expect(env.applications.all()).toHaveLength(0);
  });

  it('"::ffff:0:0/96" cannot make every IPv4 client a tester', () => {
    const access = resolveRecruitmentAccess({ mode: 'testers', allowlist: '::ffff:0:0/96', appEnv: 'local' });
    expect(access.mode).toBe('closed');
    for (const address of ['192.0.2.1', '198.51.100.9', LISTED, '127.0.0.1']) {
      expect(decideRecruitmentAudience(access, address)).toBe(RECRUITMENT_AUDIENCE.NONE);
    }
  });

  it('the range limits are unchanged and are applied to the parsed value', () => {
    // IPv4: /8 is the broadest range accepted. IPv6: /16.
    expect(parseAccessAllowlist('10.0.0.0/8').ok).toBe(true);
    expect(parseAccessAllowlist('10.0.0.0/7').ok).toBe(false);
    expect(parseAccessAllowlist('2001::/16').ok).toBe(true);
    expect(parseAccessAllowlist('2001:0000:0000:0000:0000:0000:0000:0000/16').ok).toBe(true);
    expect(parseAccessAllowlist('2000::/15').ok).toBe(false);
    expect(parseAccessAllowlist('0.0.0.0/0').ok).toBe(false);
    expect(parseAccessAllowlist('::/0').ok).toBe(false);
  });
});

describe('GAP 2 — one address, one meaning: equivalent spellings are treated alike', () => {
  it.each([
    ['dotted mapped', '::ffff:203.0.113.7'],
    ['dotted mapped, upper case', '::FFFF:203.0.113.7'],
    ['hexadecimal mapped', '::ffff:cb00:7107'],
    ['hexadecimal mapped, upper case', '::FFFF:CB00:7107'],
    ['expanded mapped', '0:0:0:0:0:ffff:cb00:7107'],
    ['expanded mapped with leading zeros', '0000:0000:0000:0000:0000:ffff:cb00:7107'],
    ['expanded mapped, dotted tail', '0:0:0:0:0:ffff:203.0.113.7'],
  ])('a client reported as %s is the IPv4 client 203.0.113.7', (_label, address) => {
    expect(normaliseClientAddress(address)).toEqual({ address: LISTED, family: 'ipv4' });
    expect(decideRecruitmentAudience(testers(LISTED), address)).toBe(RECRUITMENT_AUDIENCE.TESTER);
    expect(decideRecruitmentAudience(testers('203.0.113.0/24'), address)).toBe(RECRUITMENT_AUDIENCE.TESTER);
    expect(decideRecruitmentAudience(testers('203.0.113.8'), address)).toBe(RECRUITMENT_AUDIENCE.NONE);
    expect(decideRecruitmentAudience(testers('2001:db8::/32'), address)).toBe(RECRUITMENT_AUDIENCE.NONE);
  });

  it('the neighbouring mapped address is a different client', () => {
    for (const address of ['::ffff:cb00:7108', '0:0:0:0:0:ffff:cb00:7108', '::ffff:203.0.113.8']) {
      expect(decideRecruitmentAudience(testers(LISTED), address)).toBe(RECRUITMENT_AUDIENCE.NONE);
    }
  });

  it('an IPv6 address is the same client however it is written', () => {
    const access = testers('2001:db8:10::/48');
    for (const address of ['2001:db8:10::1', '2001:0db8:0010:0000:0000:0000:0000:0001', '2001:DB8:10:0:0:0:0:1', '2001:db8:10::0.0.0.1']) {
      expect(decideRecruitmentAudience(access, address)).toBe(RECRUITMENT_AUDIENCE.TESTER);
    }
    expect(decideRecruitmentAudience(access, '2001:0db8:0011:0000:0000:0000:0000:0001')).toBe(RECRUITMENT_AUDIENCE.NONE);
  });

  it('an allowlist entry means the same however it is written', () => {
    for (const entry of ['2001:db8:10::/48', '2001:0DB8:0010:0000:0000:0000:0000:0000/48', '2001:db8:10:0:0:0:0:0/48']) {
      const access = testers(entry);
      expect(access.mode).toBe('testers');
      expect(decideRecruitmentAudience(access, '2001:db8:10:ffff::1')).toBe(RECRUITMENT_AUDIENCE.TESTER);
      expect(decideRecruitmentAudience(access, '2001:db8:11::1')).toBe(RECRUITMENT_AUDIENCE.NONE);
    }
  });

  it.each([
    ['the same IPv6 address, compact and expanded', '2001:db8::1,2001:0db8:0:0:0:0:0:1'],
    ['the same IPv6 address in two letter cases', '2001:db8::a,2001:DB8::A'],
    ['the same IPv6 range, compact and expanded', '2001:db8:10::/48,2001:db8:10:0:0:0:0:0/48'],
    ['the same IPv4 range named by two of its addresses', '203.0.113.0/24,203.0.113.7/24'],
    ['an address and its own /32', '203.0.113.7,203.0.113.7/32'],
    ['an IPv6 address and its own /128', '2001:db8::1,2001:db8::1/128'],
  ])('a duplicate by VALUE is refused: %s', (_label, value) => {
    expect(parseAccessAllowlist(value)).toEqual({ ok: false, problem: 'INVALID' });
    expect(testers(value).mode).toBe('closed');
  });

  it('addresses that only look related are not confused', () => {
    // "::203.0.113.7" (IPv4-compatible, long deprecated) is an IPv6 address, not the IPv4 client.
    expect(normaliseClientAddress('::203.0.113.7')).toEqual({ address: '::cb00:7107', family: 'ipv6' });
    expect(decideRecruitmentAudience(testers(LISTED), '::203.0.113.7')).toBe(RECRUITMENT_AUDIENCE.NONE);
    // The NAT64 well-known prefix is likewise not IPv4.
    expect(decideRecruitmentAudience(testers(LISTED), '64:ff9b::cb00:7107')).toBe(RECRUITMENT_AUDIENCE.NONE);
    // An IPv4 entry never admits an IPv6 client and an IPv6 entry never admits an IPv4 client.
    expect(decideRecruitmentAudience(testers('10.0.0.0/8'), 'a00::1')).toBe(RECRUITMENT_AUDIENCE.NONE);
    expect(decideRecruitmentAudience(testers('a00::/16'), '10.0.0.1')).toBe(RECRUITMENT_AUDIENCE.NONE);
  });

  it('a normalised IPv6 address is written in one canonical form', () => {
    expect(normaliseClientAddress('2001:0DB8:0000:0000:0000:0000:0000:0001')).toEqual({ address: '2001:db8::1', family: 'ipv6' });
    expect(normaliseClientAddress('2001:db8::1')).toEqual({ address: '2001:db8::1', family: 'ipv6' });
    expect(normaliseClientAddress('::1')).toEqual({ address: '::1', family: 'ipv6' });
    expect(normaliseClientAddress('0:0:0:0:0:0:0:1')).toEqual({ address: '::1', family: 'ipv6' });
  });
});
