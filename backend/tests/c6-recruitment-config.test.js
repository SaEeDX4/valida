import { describe, it, expect } from 'vitest';
import net from 'node:net';
import util from 'node:util';
import { loadConfig } from '../src/config/env.js';
import {
  ALLOWLIST_MAX_ENTRIES,
  CLOSED_RECRUITMENT_ACCESS,
  PUBLIC_AUTHORISATION_PATTERN,
  RECRUITMENT_AUDIENCE,
  RECRUITMENT_REASONS,
  decideRecruitmentAudience,
  describeRecruitmentAccess,
  normaliseClientAddress,
  parseAccessAllowlist,
  resolveRecruitmentAccess,
} from '../src/config/recruitmentAccess.js';
import { OFFLINE_TEST_MONGODB_URI } from './helpers.js';

/**
 * C6-T1 — recruitment access: configuration and the per-request decision.
 *
 * Pure functions, no server. Synthetic addresses only: the documentation
 * ranges 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (RFC 5737) and
 * 2001:db8::/32 (RFC 3849), plus loopback.
 *
 * The rule under test: whatever is not exactly right resolves to `closed`.
 */
const LISTED = '203.0.113.0/24,2001:db8:10::/48';
const OD = 'OD-2026-11-15-01';

describe('the effective mode — every configuration that is not exactly right is closed', () => {
  it.each([
    ['RECRUITMENT_MODE absent', {}, 'absent', RECRUITMENT_REASONS.MODE_ABSENT],
    ['RECRUITMENT_MODE undefined', { mode: undefined }, 'absent', RECRUITMENT_REASONS.MODE_ABSENT],
    ['RECRUITMENT_MODE null', { mode: null }, 'absent', RECRUITMENT_REASONS.MODE_ABSENT],
    ['RECRUITMENT_MODE empty', { mode: '' }, 'absent', RECRUITMENT_REASONS.MODE_ABSENT],
    ['an unknown word', { mode: 'open' }, 'invalid', RECRUITMENT_REASONS.MODE_INVALID],
    ['"true"', { mode: 'true' }, 'invalid', RECRUITMENT_REASONS.MODE_INVALID],
    ['"1"', { mode: '1' }, 'invalid', RECRUITMENT_REASONS.MODE_INVALID],
    ['wrong letter case: "Public"', { mode: 'Public', authorisation: OD, appEnv: 'production' }, 'invalid', RECRUITMENT_REASONS.MODE_INVALID],
    ['wrong letter case: "PUBLIC"', { mode: 'PUBLIC', authorisation: OD, appEnv: 'production' }, 'invalid', RECRUITMENT_REASONS.MODE_INVALID],
    ['wrong letter case: "Testers"', { mode: 'Testers', allowlist: LISTED }, 'invalid', RECRUITMENT_REASONS.MODE_INVALID],
    ['a leading space', { mode: ' public', authorisation: OD, appEnv: 'production' }, 'invalid', RECRUITMENT_REASONS.MODE_INVALID],
    ['a trailing space', { mode: 'public ', authorisation: OD, appEnv: 'production' }, 'invalid', RECRUITMENT_REASONS.MODE_INVALID],
    ['a trailing newline', { mode: 'public\n', authorisation: OD, appEnv: 'production' }, 'invalid', RECRUITMENT_REASONS.MODE_INVALID],
    ['quotes left in the value', { mode: '"public"', authorisation: OD, appEnv: 'production' }, 'invalid', RECRUITMENT_REASONS.MODE_INVALID],
    ['a typo', { mode: 'pubic', authorisation: OD, appEnv: 'production' }, 'invalid', RECRUITMENT_REASONS.MODE_INVALID],
    ['two values', { mode: 'testers,public', allowlist: LISTED, authorisation: OD, appEnv: 'production' }, 'invalid', RECRUITMENT_REASONS.MODE_INVALID],
    ['a number', { mode: 1 }, 'invalid', RECRUITMENT_REASONS.MODE_INVALID],
    ['a boolean', { mode: true }, 'invalid', RECRUITMENT_REASONS.MODE_INVALID],
    ['an object', { mode: { toString: () => 'public' }, authorisation: OD, appEnv: 'production' }, 'invalid', RECRUITMENT_REASONS.MODE_INVALID],
    ['an array', { mode: ['public'], authorisation: OD, appEnv: 'production' }, 'invalid', RECRUITMENT_REASONS.MODE_INVALID],

    ['testers without a list', { mode: 'testers' }, 'invalid', RECRUITMENT_REASONS.TESTERS_ALLOWLIST_ABSENT],
    ['testers with an empty list', { mode: 'testers', allowlist: '' }, 'invalid', RECRUITMENT_REASONS.TESTERS_ALLOWLIST_ABSENT],
    ['testers with an unparsable list', { mode: 'testers', allowlist: 'office' }, 'invalid', RECRUITMENT_REASONS.TESTERS_ALLOWLIST_INVALID],
    ['testers with one bad entry among good ones', { mode: 'testers', allowlist: '203.0.113.0/24,not-an-address' }, 'invalid', RECRUITMENT_REASONS.TESTERS_ALLOWLIST_INVALID],
    ['testers listing everyone (IPv4)', { mode: 'testers', allowlist: '0.0.0.0/0' }, 'invalid', RECRUITMENT_REASONS.TESTERS_ALLOWLIST_INVALID],
    ['testers listing everyone (IPv6)', { mode: 'testers', allowlist: '::/0' }, 'invalid', RECRUITMENT_REASONS.TESTERS_ALLOWLIST_INVALID],

    ['public outside production: local', { mode: 'public', authorisation: OD, appEnv: 'local' }, 'invalid', RECRUITMENT_REASONS.PUBLIC_NOT_PRODUCTION],
    ['public outside production: review', { mode: 'public', authorisation: OD, appEnv: 'review' }, 'invalid', RECRUITMENT_REASONS.PUBLIC_NOT_PRODUCTION],
    ['public with no APP_ENV at all', { mode: 'public', authorisation: OD }, 'invalid', RECRUITMENT_REASONS.PUBLIC_NOT_PRODUCTION],
    ['public without an authorisation', { mode: 'public', appEnv: 'production' }, 'invalid', RECRUITMENT_REASONS.PUBLIC_AUTHORISATION_ABSENT],
    ['public with an empty authorisation', { mode: 'public', authorisation: '', appEnv: 'production' }, 'invalid', RECRUITMENT_REASONS.PUBLIC_AUTHORISATION_ABSENT],
    ['public with a malformed authorisation: "yes"', { mode: 'public', authorisation: 'yes', appEnv: 'production' }, 'invalid', RECRUITMENT_REASONS.PUBLIC_AUTHORISATION_INVALID],
    ['public with a malformed authorisation: "true"', { mode: 'public', authorisation: 'true', appEnv: 'production' }, 'invalid', RECRUITMENT_REASONS.PUBLIC_AUTHORISATION_INVALID],
    ['public with a lower-case identifier', { mode: 'public', authorisation: 'od-2026-11-15-01', appEnv: 'production' }, 'invalid', RECRUITMENT_REASONS.PUBLIC_AUTHORISATION_INVALID],
    ['public with an impossible date', { mode: 'public', authorisation: 'OD-2026-13-40-01', appEnv: 'production' }, 'invalid', RECRUITMENT_REASONS.PUBLIC_AUTHORISATION_INVALID],
    ['public with a padded identifier', { mode: 'public', authorisation: ` ${OD}`, appEnv: 'production' }, 'invalid', RECRUITMENT_REASONS.PUBLIC_AUTHORISATION_INVALID],
    ['public with an identifier and trailing text', { mode: 'public', authorisation: `${OD} approved`, appEnv: 'production' }, 'invalid', RECRUITMENT_REASONS.PUBLIC_AUTHORISATION_INVALID],
    ['public with a non-string authorisation', { mode: 'public', authorisation: 20261115, appEnv: 'production' }, 'invalid', RECRUITMENT_REASONS.PUBLIC_AUTHORISATION_INVALID],
  ])('%s -> closed', (_label, input, configured, reason) => {
    const access = resolveRecruitmentAccess(input);
    expect(access.mode).toBe('closed');
    expect(access.configured).toBe(configured);
    expect(access.reason).toBe(reason);
    expect(access.authorisationRef).toBeNull();
    expect(access.allowlistEntries).toBe(0);
    expect(access.allowlist).toBeNull();
    // And nobody is let through, whatever their address.
    for (const address of ['127.0.0.1', '::1', '203.0.113.7', '2001:db8:10::1']) {
      expect(decideRecruitmentAudience(access, address)).toBe(RECRUITMENT_AUDIENCE.NONE);
    }
  });

  it('no argument at all is closed, and so is the shared closed constant', () => {
    expect(resolveRecruitmentAccess().mode).toBe('closed');
    expect(CLOSED_RECRUITMENT_ACCESS.mode).toBe('closed');
    expect(CLOSED_RECRUITMENT_ACCESS.reason).toBe(RECRUITMENT_REASONS.MODE_ABSENT);
  });

  it('"closed", stated explicitly, is closed and counts as a valid configuration', () => {
    const access = resolveRecruitmentAccess({ mode: 'closed', allowlist: LISTED, authorisation: OD, appEnv: 'production' });
    expect(access).toMatchObject({ mode: 'closed', configured: 'valid', reason: RECRUITMENT_REASONS.MODE_CLOSED });
    expect(decideRecruitmentAudience(access, '203.0.113.7')).toBe(RECRUITMENT_AUDIENCE.NONE);
  });

  it('"testers" with a valid list is testers; the authorisation plays no part', () => {
    const access = resolveRecruitmentAccess({ mode: 'testers', allowlist: LISTED, appEnv: 'local' });
    expect(access).toMatchObject({ mode: 'testers', configured: 'valid', reason: RECRUITMENT_REASONS.MODE_TESTERS, authorisationRef: null, allowlistEntries: 2 });
    for (const appEnv of ['local', 'review', 'production']) {
      expect(resolveRecruitmentAccess({ mode: 'testers', allowlist: LISTED, appEnv }).mode).toBe('testers');
    }
  });

  it('"public" needs production AND a well-formed owner-decision identifier — and then it is public', () => {
    const access = resolveRecruitmentAccess({ mode: 'public', authorisation: OD, appEnv: 'production' });
    expect(access).toMatchObject({ mode: 'public', configured: 'valid', reason: RECRUITMENT_REASONS.MODE_PUBLIC, authorisationRef: OD, allowlistEntries: 0 });
    expect(access.allowlist).toBeNull();
    expect(decideRecruitmentAudience(access, '198.51.100.9')).toBe(RECRUITMENT_AUDIENCE.PUBLIC);
    expect(decideRecruitmentAudience(access, undefined)).toBe(RECRUITMENT_AUDIENCE.PUBLIC);
  });

  it('"public" ignores the allowlist entirely — even an unparsable one', () => {
    expect(resolveRecruitmentAccess({ mode: 'public', authorisation: OD, appEnv: 'production', allowlist: 'nonsense' }).mode).toBe('public');
  });

  it('the identifier pattern accepts the project form and nothing looser', () => {
    for (const good of ['OD-2026-11-15-01', 'OD-2027-01-31-12', 'OD-2099-12-01-00']) expect(PUBLIC_AUTHORISATION_PATTERN.test(good)).toBe(true);
    for (const bad of ['OD-2026-11-15', 'OD-2026-11-15-1', 'OD-2026-11-15-001', 'OD-1999-11-15-01', 'OD-2026-00-15-01', 'OD-2026-11-32-01', 'XD-2026-11-15-01', 'OD_2026_11_15_01', '']) {
      expect(PUBLIC_AUTHORISATION_PATTERN.test(bad)).toBe(false);
    }
  });

  it('the result is frozen: a caller cannot switch the mode afterwards', () => {
    const access = resolveRecruitmentAccess({});
    expect(Object.isFrozen(access)).toBe(true);
    expect(() => {
      'use strict';
      access.mode = 'public';
    }).toThrow();
    expect(access.mode).toBe('closed');
  });
});

describe('ACCESS_ALLOWLIST — addresses and CIDR ranges, all or nothing', () => {
  it.each([
    ['one IPv4 address', '203.0.113.7', 1],
    ['one IPv4 range', '203.0.113.0/24', 1],
    ['one IPv6 address', '2001:db8::1', 1],
    ['one IPv6 range', '2001:db8:10::/48', 1],
    ['mixed, with spaces after the commas', '203.0.113.7, 198.51.100.0/24, 2001:db8::/32', 3],
    ['loopback, both families', '127.0.0.1/32,::1/128', 2],
    ['the shortest IPv4 prefix allowed', '10.0.0.0/8', 1],
    ['the shortest IPv6 prefix allowed', '2001::/16', 1],
  ])('accepts %s', (_label, value, size) => {
    const parsed = parseAccessAllowlist(value);
    expect(parsed.ok).toBe(true);
    expect(parsed.size).toBe(size);
    // The parsed form: one frozen range per entry (an internal detail; it replaced net.BlockList in correction 1).
    expect(Object.isFrozen(parsed.ranges)).toBe(true);
    expect(parsed.ranges).toHaveLength(size);
  });

  it.each([
    ['undefined', undefined, 'ABSENT'],
    ['null', null, 'ABSENT'],
    ['empty', '', 'ABSENT'],
    ['only spaces', '   ', 'INVALID'],
    ['a host name', 'office.example.test', 'INVALID'],
    ['a trailing comma', '203.0.113.7,', 'INVALID'],
    ['a doubled comma', '203.0.113.7,,198.51.100.1', 'INVALID'],
    ['an address with a port', '203.0.113.7:443', 'INVALID'],
    ['an octet out of range', '203.0.113.256', 'INVALID'],
    ['a prefix above 32', '203.0.113.0/33', 'INVALID'],
    ['a prefix above 128', '2001:db8::/129', 'INVALID'],
    ['a negative prefix', '203.0.113.0/-1', 'INVALID'],
    ['a non-numeric prefix', '203.0.113.0/24a', 'INVALID'],
    ['an empty prefix', '203.0.113.0/', 'INVALID'],
    ['a netmask instead of a prefix', '203.0.113.0/255.255.255.0', 'INVALID'],
    ['everyone, IPv4', '0.0.0.0/0', 'INVALID'],
    ['half the internet, IPv4', '0.0.0.0/1', 'INVALID'],
    ['a prefix just too short, IPv4', '10.0.0.0/7', 'INVALID'],
    ['everyone, IPv6', '::/0', 'INVALID'],
    ['a prefix just too short, IPv6', '2000::/15', 'INVALID'],
    ['an IPv4-mapped spelling', '::ffff:203.0.113.7', 'INVALID'],
    ['an IPv6 zone identifier', 'fe80::1%eth0', 'INVALID'],
    ['a range written with a dash', '203.0.113.1-203.0.113.9', 'INVALID'],
    ['a wildcard', '203.0.113.*', 'INVALID'],
    ['the same entry twice', '203.0.113.7,203.0.113.7', 'INVALID'],
    ['one good and one bad entry', '203.0.113.7,nope', 'INVALID'],
    ['a number', 2130706433, 'INVALID'],
    ['an array', ['203.0.113.7'], 'INVALID'],
    ['more entries than allowed', Array.from({ length: ALLOWLIST_MAX_ENTRIES + 1 }, (_, i) => `203.0.113.${i}`).join(','), 'INVALID'],
    ['an over-long value', `203.0.113.7,${' '.repeat(5000)}198.51.100.1`, 'INVALID'],
  ])('refuses %s', (_label, value, problem) => {
    expect(parseAccessAllowlist(value)).toEqual({ ok: false, problem });
  });

  it('exactly the maximum number of entries is accepted', () => {
    const value = Array.from({ length: ALLOWLIST_MAX_ENTRIES }, (_, i) => `203.0.113.${i}`).join(',');
    expect(parseAccessAllowlist(value)).toMatchObject({ ok: true, size: ALLOWLIST_MAX_ENTRIES });
  });
});

describe('the client address — one form, or not an address', () => {
  it.each([
    ['IPv4', '203.0.113.7', { address: '203.0.113.7', family: 'ipv4' }],
    ['IPv6', '2001:db8::1', { address: '2001:db8::1', family: 'ipv6' }],
    ['IPv6 loopback', '::1', { address: '::1', family: 'ipv6' }],
    ['IPv4-mapped IPv6 (a dual-stack socket)', '::ffff:203.0.113.7', { address: '203.0.113.7', family: 'ipv4' }],
    ['IPv4-mapped, upper case', '::FFFF:127.0.0.1', { address: '127.0.0.1', family: 'ipv4' }],
  ])('%s', (_label, value, expected) => {
    expect(normaliseClientAddress(value)).toEqual(expected);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty', ''],
    ['a host name', 'localhost'],
    ['an address with a port', '203.0.113.7:8080'],
    ['a bracketed IPv6 address', '[2001:db8::1]'],
    ['a zone identifier', 'fe80::1%eth0'],
    ['a list', '203.0.113.7, 198.51.100.1'],
    ['a padded address', ' 203.0.113.7'],
    ['an octet out of range', '203.0.113.999'],
    ['an IPv4-mapped form with a bad IPv4 part', '::ffff:999.0.0.1'],
    ['a number', 2130706433],
    ['an object', {}],
    ['an over-long string', '1'.repeat(46)],
  ])('%s is not an address', (_label, value) => {
    expect(normaliseClientAddress(value)).toBeNull();
  });
});

describe('the decision for one request', () => {
  const testers = resolveRecruitmentAccess({ mode: 'testers', allowlist: '203.0.113.0/24,198.51.100.7,2001:db8:10::/48,127.0.0.1/32,::1/128' });

  it.each([
    ['an address inside a listed IPv4 range', '203.0.113.7'],
    ['the first address of the range', '203.0.113.0'],
    ['the last address of the range', '203.0.113.255'],
    ['a listed single IPv4 address', '198.51.100.7'],
    ['the same IPv4 address as a dual-stack socket reports it', '::ffff:198.51.100.7'],
    ['an address inside a listed IPv6 range', '2001:db8:10:ffff::1'],
    ['IPv4 loopback', '127.0.0.1'],
    ['IPv4 loopback, mapped', '::ffff:127.0.0.1'],
    ['IPv6 loopback', '::1'],
  ])('%s is a tester', (_label, address) => {
    expect(decideRecruitmentAudience(testers, address)).toBe(RECRUITMENT_AUDIENCE.TESTER);
  });

  it.each([
    ['the neighbour of a listed single address', '198.51.100.8'],
    ['an address outside the listed IPv6 range', '2001:db8:11::1'],
    ['another loopback address', '127.0.0.2'],
    ['an unrelated address', '192.0.2.44'],
    ['no address', undefined],
    ['an empty address', ''],
    ['a list containing a listed address', '203.0.113.7, 192.0.2.44'],
    ['a listed address with a port', '203.0.113.7:443'],
    ['a host name', 'localhost'],
    ['an object', { toString: () => '203.0.113.7' }],
  ])('%s is nobody', (_label, address) => {
    expect(decideRecruitmentAudience(testers, address)).toBe(RECRUITMENT_AUDIENCE.NONE);
  });

  it('the edges of a range are exact: the first and last address are in, their neighbours are out', () => {
    // A /26 inside a documentation range, so that its neighbours are documentation addresses too.
    const access = resolveRecruitmentAccess({ mode: 'testers', allowlist: '192.0.2.64/26' });
    expect(decideRecruitmentAudience(access, '192.0.2.63')).toBe(RECRUITMENT_AUDIENCE.NONE);
    expect(decideRecruitmentAudience(access, '192.0.2.64')).toBe(RECRUITMENT_AUDIENCE.TESTER);
    expect(decideRecruitmentAudience(access, '192.0.2.127')).toBe(RECRUITMENT_AUDIENCE.TESTER);
    expect(decideRecruitmentAudience(access, '192.0.2.128')).toBe(RECRUITMENT_AUDIENCE.NONE);
  });

  it('an IPv4 entry never matches an IPv6 address with the same bits, and the reverse', () => {
    const access = resolveRecruitmentAccess({ mode: 'testers', allowlist: '10.0.0.0/8' });
    expect(decideRecruitmentAudience(access, '10.1.2.3')).toBe(RECRUITMENT_AUDIENCE.TESTER);
    expect(decideRecruitmentAudience(access, 'a00::1')).toBe(RECRUITMENT_AUDIENCE.NONE);
  });

  it.each([
    ['no access object', undefined],
    ['null', null],
    ['an empty object', {}],
    ['an unknown mode', { mode: 'open' }],
    ['"testers" without a list', { mode: 'testers' }],
    ['"testers" with something that is not a list', { mode: 'testers', allowlist: { check: () => true } }],
    ['"Public" in the wrong case', { mode: 'Public' }],
  ])('a damaged access object (%s) lets nobody through', (_label, access) => {
    expect(decideRecruitmentAudience(access, '203.0.113.7')).toBe(RECRUITMENT_AUDIENCE.NONE);
  });

  it('an error inside the check is answered as nobody, never as a failure', () => {
    const exploding = { mode: 'testers', allowlist: new net.BlockList() };
    Object.defineProperty(exploding, 'allowlist', {
      get() {
        throw new Error('QA: the check failed');
      },
    });
    expect(() => decideRecruitmentAudience(exploding, '203.0.113.7')).not.toThrow();
    expect(decideRecruitmentAudience(exploding, '203.0.113.7')).toBe(RECRUITMENT_AUDIENCE.NONE);

    const explodingMode = {};
    Object.defineProperty(explodingMode, 'mode', {
      get() {
        throw new Error('QA: the check failed');
      },
    });
    expect(decideRecruitmentAudience(explodingMode, '203.0.113.7')).toBe(RECRUITMENT_AUDIENCE.NONE);
  });
});

describe('loadConfig — the three variables never stop the backend and never appear in a serialised view', () => {
  const base = { NODE_ENV: 'test', APP_ENV: 'local', PORT: '4100', MONGODB_URI: OFFLINE_TEST_MONGODB_URI };
  const production = {
    NODE_ENV: 'production',
    APP_ENV: 'production',
    PORT: '4100',
    MONGODB_URI: OFFLINE_TEST_MONGODB_URI,
    CORS_ALLOWED_ORIGINS: 'https://qa-valida.example.test',
  };

  it('with none of them set, the configuration loads and recruitment is closed', () => {
    const config = loadConfig(base);
    expect(config.recruitment).toMatchObject({ mode: 'closed', configured: 'absent', reason: RECRUITMENT_REASONS.MODE_ABSENT });
  });

  it.each([
    ['a misspelt mode', { RECRUITMENT_MODE: 'publik' }],
    ['a mode in the wrong case', { RECRUITMENT_MODE: 'TESTERS', ACCESS_ALLOWLIST: '203.0.113.7' }],
    ['testers with a broken list', { RECRUITMENT_MODE: 'testers', ACCESS_ALLOWLIST: '203.0.113.7;198.51.100.1' }],
    ['public outside production', { RECRUITMENT_MODE: 'public', RECRUITMENT_PUBLIC_AUTHORISATION: OD }],
  ])('%s does not throw; it closes', (_label, extra) => {
    let config;
    expect(() => {
      config = loadConfig({ ...base, ...extra });
    }).not.toThrow();
    expect(config.recruitment.mode).toBe('closed');
    expect(config.recruitment.configured).toBe('invalid');
  });

  it('production with a valid authorisation is public; the same variables in review are closed', () => {
    const variables = { RECRUITMENT_MODE: 'public', RECRUITMENT_PUBLIC_AUTHORISATION: OD };
    expect(loadConfig({ ...production, ...variables }).recruitment).toMatchObject({ mode: 'public', authorisationRef: OD });
    expect(loadConfig({ ...production, APP_ENV: 'review', SITE_ACCESS: 'private', ACCESS_ALLOWLIST: '203.0.113.0/24', ...variables }).recruitment).toMatchObject({ mode: 'closed', reason: RECRUITMENT_REASONS.PUBLIC_NOT_PRODUCTION });
  });

  it('production without any recruitment variable is closed — production is not public by default', () => {
    expect(loadConfig(production).recruitment).toMatchObject({ mode: 'closed', configured: 'absent' });
  });

  it('the tester addresses are in no serialised form of the configuration', () => {
    const marker = '198.51.100.77';
    const config = loadConfig({ ...base, RECRUITMENT_MODE: 'testers', ACCESS_ALLOWLIST: `${marker},203.0.113.0/24,2001:db8:77::/48` });
    expect(config.recruitment.mode).toBe('testers');
    expect(config.recruitment.allowlistEntries).toBe(3);
    expect(decideRecruitmentAudience(config.recruitment, marker)).toBe(RECRUITMENT_AUDIENCE.TESTER);

    const forms = [
      JSON.stringify(config),
      JSON.stringify(config.recruitment),
      util.inspect(config, { depth: 10, showHidden: false }),
      util.inspect(config.recruitment, { depth: 10 }),
      JSON.stringify({ ...config }),
      JSON.stringify({ ...config.recruitment }),
      String(Object.keys(config.recruitment)),
      JSON.stringify(describeRecruitmentAccess(config.recruitment)),
    ];
    for (const form of forms) {
      expect(form).not.toContain(marker);
      expect(form).not.toContain('203.0.113');
      expect(form).not.toContain('2001:db8:77');
    }
    // A spread copy has no list at all, so it lets nobody through: a copy cannot widen access.
    expect(decideRecruitmentAudience({ ...config.recruitment }, marker)).toBe(RECRUITMENT_AUDIENCE.NONE);
  });

  it('a rejected value is not echoed anywhere', () => {
    const secretLooking = 'pub1ic-s3cr3t-marker';
    const config = loadConfig({ ...base, RECRUITMENT_MODE: secretLooking, RECRUITMENT_PUBLIC_AUTHORISATION: 'auth-s3cr3t-marker', ACCESS_ALLOWLIST: 'list-s3cr3t-marker' });
    const everything = `${JSON.stringify(config)}${util.inspect(config, { depth: 10 })}${JSON.stringify(describeRecruitmentAccess(config.recruitment))}`;
    expect(everything).not.toContain('s3cr3t-marker');
  });
});

describe('the start-up description', () => {
  it('states the effective mode and the reason, with prefixed field names', () => {
    expect(describeRecruitmentAccess(resolveRecruitmentAccess({}))).toEqual({
      recruitmentMode: 'closed',
      recruitmentConfiguration: 'absent',
      recruitmentReason: 'MODE_ABSENT',
      recruitmentAuthorisation: null,
      recruitmentAllowlistEntries: 0,
      // C6-T2: no delegation object given — described as disabled.
      recruitmentDelegation: 'disabled',
      recruitmentDelegationReason: 'DELEGATION_KEY_ABSENT',
    });
    expect(describeRecruitmentAccess(resolveRecruitmentAccess({ mode: 'testers', allowlist: LISTED }))).toEqual({
      recruitmentMode: 'testers',
      recruitmentConfiguration: 'valid',
      recruitmentReason: 'MODE_TESTERS',
      recruitmentAuthorisation: null,
      recruitmentAllowlistEntries: 2,
      recruitmentDelegation: 'disabled',
      recruitmentDelegationReason: 'DELEGATION_KEY_ABSENT',
    });
    expect(describeRecruitmentAccess(resolveRecruitmentAccess({ mode: 'public', authorisation: OD, appEnv: 'production' }))).toEqual({
      recruitmentMode: 'public',
      recruitmentConfiguration: 'valid',
      recruitmentReason: 'MODE_PUBLIC',
      recruitmentAuthorisation: OD,
      recruitmentAllowlistEntries: 0,
      // C6-T2: no delegation object given — described as disabled.
      recruitmentDelegation: 'disabled',
      recruitmentDelegationReason: 'DELEGATION_KEY_ABSENT',
    });
  });

  it('a missing access object is described as closed', () => {
    expect(describeRecruitmentAccess(undefined)).toMatchObject({ recruitmentMode: 'closed', recruitmentReason: 'MODE_ABSENT' });
  });
});
