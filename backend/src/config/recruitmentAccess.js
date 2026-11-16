import net from 'node:net';

/**
 * Recruitment access — Milestone C6, task C6-T1.
 *
 * Decision record: docs/review/OWNER_DECISION_2026-11-15-01_C6_T1_RECRUITMENT_MODE.md
 * (Doc 00 section 5; recorded against Doc 13, access control, and Doc 15,
 * environment configuration). Design: C6 plan revision 3, section 4.6.1.
 *
 * WHAT THIS DECIDES
 * Who may see and use Jobs through the public API: the Jobs list, Job Detail
 * and application submission. It adds a condition in front of the accepted
 * Job lifecycle (Doc 09 sections 48-70, 77-78, 186-190); it never replaces it.
 * A client that is let through meets exactly the rules it met before.
 *
 *   closed   nobody. The list is empty, a Job and a submission are answered
 *            like an unknown Job.
 *   testers  the above for everyone except clients whose address is inside
 *            ACCESS_ALLOWLIST, who see and use the real state.
 *   public   everyone, as accepted in Releases B and C.
 *
 * THE RULE THAT MATTERS: CLOSED UNLESS PROVEN OTHERWISE
 * This module never throws on bad input and never stops the process. A value
 * that is absent, empty, misspelt, in the wrong letter case, padded with
 * spaces, or incomplete resolves to `closed`, with a reason code. A typo can
 * therefore shut recruitment; it cannot open it. `public` additionally
 * requires APP_ENV=production and RECRUITMENT_PUBLIC_AUTHORISATION carrying
 * the identifier of an owner decision record, so that one mistyped or copied
 * variable can never make recruitment public, and the running system names
 * the decision it relies on.
 *
 * WHAT IS NEVER WRITTEN ANYWHERE
 * The allowlist holds testers' network addresses. They are kept in a
 * non-enumerable property, so they are absent from any spread, JSON form,
 * util.inspect output or log line. Only the NUMBER of entries is reported.
 * Reason codes come from the fixed table below; no configured value is echoed.
 */

export const RECRUITMENT_MODES = Object.freeze(['closed', 'testers', 'public']);

/** Why the effective mode is what it is. Fixed strings: nothing from the environment. */
export const RECRUITMENT_REASONS = Object.freeze({
  MODE_ABSENT: 'MODE_ABSENT',
  MODE_INVALID: 'MODE_INVALID',
  MODE_CLOSED: 'MODE_CLOSED',
  MODE_TESTERS: 'MODE_TESTERS',
  MODE_PUBLIC: 'MODE_PUBLIC',
  TESTERS_ALLOWLIST_ABSENT: 'TESTERS_ALLOWLIST_ABSENT',
  TESTERS_ALLOWLIST_INVALID: 'TESTERS_ALLOWLIST_INVALID',
  PUBLIC_NOT_PRODUCTION: 'PUBLIC_NOT_PRODUCTION',
  PUBLIC_AUTHORISATION_ABSENT: 'PUBLIC_AUTHORISATION_ABSENT',
  PUBLIC_AUTHORISATION_INVALID: 'PUBLIC_AUTHORISATION_INVALID',
});

/** The project's owner-decision identifier, e.g. OD-2026-11-15-01. The form is checked, not the decision. */
export const PUBLIC_AUTHORISATION_PATTERN = /^OD-20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])-\d{2}$/;

/** Input bounds: a list is a handful of networks, not a routing table. */
export const ALLOWLIST_MAX_ENTRIES = 50;
const ALLOWLIST_MAX_LENGTH = 4096;
/**
 * The shortest prefixes accepted. A range such as 0.0.0.0/0 or ::/0 would make
 * `testers` mean "everyone" — public by another name, without the decision
 * record `public` requires. Such an entry invalidates the whole list.
 */
export const ALLOWLIST_MIN_PREFIX = Object.freeze({ ipv4: 8, ipv6: 16 });

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/**
 * The address in the one form the list is compared in.
 *
 * Returns `{ address, family }` or null. An IPv4-mapped IPv6 address
 * (`::ffff:203.0.113.7`, what a dual-stack socket reports for an IPv4 peer) is
 * reduced to its IPv4 form. Anything that is not a plain address — a zone
 * identifier, a port, a host name, a list — is null, and null is never listed.
 */
export function normaliseClientAddress(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 45) return null;
  // net.isIP accepts a scoped address ("fe80::1%eth0"). A zone names an
  // interface of THIS machine, not a client; it is never an address here.
  if (value.includes('%')) return null;
  const mapped = IPV4_MAPPED.exec(value);
  const address = mapped ? mapped[1] : value;
  const version = net.isIP(address);
  if (version === 4) return { address, family: 'ipv4' };
  if (version === 6) return { address, family: 'ipv6' };
  return null;
}

/**
 * Parses ACCESS_ALLOWLIST: comma-separated addresses or CIDR ranges, IPv4 or
 * IPv6. All or nothing: one bad entry makes the whole list invalid, so a
 * partly understood list is never applied.
 *
 * @returns {{ ok: true, blockList: net.BlockList, size: number } | { ok: false, problem: 'ABSENT' | 'INVALID' }}
 */
export function parseAccessAllowlist(value) {
  if (value === undefined || value === null || value === '') return { ok: false, problem: 'ABSENT' };
  if (typeof value !== 'string' || value.length > ALLOWLIST_MAX_LENGTH) return { ok: false, problem: 'INVALID' };
  const entries = value.split(',').map((entry) => entry.trim());
  if (entries.length === 0 || entries.length > ALLOWLIST_MAX_ENTRIES || entries.some((entry) => entry === '')) {
    return { ok: false, problem: 'INVALID' };
  }

  const blockList = new net.BlockList();
  const seen = new Set();
  for (const entry of entries) {
    const slash = entry.indexOf('/');
    const addressPart = slash === -1 ? entry : entry.slice(0, slash);
    const prefixPart = slash === -1 ? null : entry.slice(slash + 1);
    // The list is written by a person: an IPv4-mapped form is not accepted
    // here, so each network has exactly one spelling.
    const version = net.isIP(addressPart);
    if (version === 0 || addressPart.includes('%') || IPV4_MAPPED.test(addressPart)) return { ok: false, problem: 'INVALID' };
    const family = version === 4 ? 'ipv4' : 'ipv6';
    const maxPrefix = version === 4 ? 32 : 128;
    let prefix = maxPrefix;
    if (prefixPart !== null) {
      if (!/^\d{1,3}$/.test(prefixPart)) return { ok: false, problem: 'INVALID' };
      prefix = Number(prefixPart);
      if (prefix > maxPrefix || prefix < ALLOWLIST_MIN_PREFIX[family]) return { ok: false, problem: 'INVALID' };
    }
    const key = `${family}:${addressPart.toLowerCase()}/${prefix}`;
    if (seen.has(key)) return { ok: false, problem: 'INVALID' };
    seen.add(key);
    try {
      blockList.addSubnet(addressPart, prefix, family);
    } catch {
      return { ok: false, problem: 'INVALID' };
    }
  }
  return { ok: true, blockList, size: entries.length };
}

function closed(configured, reason) {
  return { mode: 'closed', configured, reason, authorisationRef: null, allowlist: null, allowlistEntries: 0 };
}

/**
 * Resolves the three variables to the effective mode. Pure and total: every
 * input, including nonsense, produces a result, and every unrecognised input
 * produces `closed`.
 *
 * @param {object} input
 * @param {unknown} input.mode            RECRUITMENT_MODE, exactly as set
 * @param {unknown} input.authorisation   RECRUITMENT_PUBLIC_AUTHORISATION
 * @param {unknown} input.allowlist       ACCESS_ALLOWLIST
 * @param {unknown} input.appEnv          the validated APP_ENV
 */
export function resolveRecruitmentAccess({ mode, authorisation, allowlist, appEnv } = {}) {
  let resolved;
  try {
    resolved = resolve({ mode, authorisation, allowlist, appEnv });
  } catch {
    // Unreachable by construction; kept so that a defect here can only close.
    resolved = closed('invalid', RECRUITMENT_REASONS.MODE_INVALID);
  }
  const { allowlist: blockList, ...visible } = resolved;
  const result = { ...visible };
  // Non-enumerable: absent from spreads, JSON, util.inspect and log lines.
  Object.defineProperty(result, 'allowlist', { value: blockList, enumerable: false });
  return Object.freeze(result);
}

function resolve({ mode, authorisation, allowlist, appEnv }) {
  if (mode === undefined || mode === null || mode === '') return closed('absent', RECRUITMENT_REASONS.MODE_ABSENT);
  // Exact match only: no trimming, no case folding. "Public", " public" and
  // "public " are all invalid.
  if (typeof mode !== 'string' || !RECRUITMENT_MODES.includes(mode)) return closed('invalid', RECRUITMENT_REASONS.MODE_INVALID);

  if (mode === 'closed') return closed('valid', RECRUITMENT_REASONS.MODE_CLOSED);

  if (mode === 'testers') {
    const parsed = parseAccessAllowlist(allowlist);
    if (!parsed.ok) {
      return closed('invalid', parsed.problem === 'ABSENT' ? RECRUITMENT_REASONS.TESTERS_ALLOWLIST_ABSENT : RECRUITMENT_REASONS.TESTERS_ALLOWLIST_INVALID);
    }
    return { mode: 'testers', configured: 'valid', reason: RECRUITMENT_REASONS.MODE_TESTERS, authorisationRef: null, allowlist: parsed.blockList, allowlistEntries: parsed.size };
  }

  // mode === 'public'
  if (appEnv !== 'production') return closed('invalid', RECRUITMENT_REASONS.PUBLIC_NOT_PRODUCTION);
  if (authorisation === undefined || authorisation === null || authorisation === '') {
    return closed('invalid', RECRUITMENT_REASONS.PUBLIC_AUTHORISATION_ABSENT);
  }
  if (typeof authorisation !== 'string' || !PUBLIC_AUTHORISATION_PATTERN.test(authorisation)) {
    return closed('invalid', RECRUITMENT_REASONS.PUBLIC_AUTHORISATION_INVALID);
  }
  // The allowlist plays no part in `public`: it is neither needed nor read.
  return { mode: 'public', configured: 'valid', reason: RECRUITMENT_REASONS.MODE_PUBLIC, authorisationRef: authorisation, allowlist: null, allowlistEntries: 0 };
}

/** What a request without any usable configuration gets. */
export const CLOSED_RECRUITMENT_ACCESS = resolveRecruitmentAccess({});

/** The audience a request belongs to. `none` may not see or use Jobs. */
export const RECRUITMENT_AUDIENCE = Object.freeze({ NONE: 'none', TESTER: 'tester', PUBLIC: 'public' });

/**
 * The decision for one request. Total: any failure is `none`.
 *
 * @param {object} access         a result of resolveRecruitmentAccess
 * @param {unknown} clientAddress the address Express derived (req.ip), honouring TRUST_PROXY
 */
export function decideRecruitmentAudience(access, clientAddress) {
  try {
    if (access?.mode === 'public') return RECRUITMENT_AUDIENCE.PUBLIC;
    if (access?.mode !== 'testers') return RECRUITMENT_AUDIENCE.NONE;
    const client = normaliseClientAddress(clientAddress);
    const blockList = access.allowlist;
    if (!client || !(blockList instanceof net.BlockList)) return RECRUITMENT_AUDIENCE.NONE;
    return blockList.check(client.address, client.family) ? RECRUITMENT_AUDIENCE.TESTER : RECRUITMENT_AUDIENCE.NONE;
  } catch {
    return RECRUITMENT_AUDIENCE.NONE;
  }
}

/**
 * The start-up description: the effective mode and why. Safe to log as it is —
 * it holds no address and no configured value except a well-formed decision
 * identifier, which is public by nature.
 */
export function describeRecruitmentAccess(access) {
  return {
    recruitmentMode: access?.mode ?? 'closed',
    recruitmentConfiguration: access?.configured ?? 'absent',
    recruitmentReason: access?.reason ?? RECRUITMENT_REASONS.MODE_ABSENT,
    recruitmentAuthorisation: access?.authorisationRef ?? null,
    recruitmentAllowlistEntries: access?.allowlistEntries ?? 0,
  };
}
