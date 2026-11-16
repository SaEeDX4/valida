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
 * THE RANGE POLICY — applied to the parsed VALUE of an entry, never to its text.
 *
 * 1. The broadest range an entry may cover is /8 for IPv4 and /16 for IPv6.
 *    A range such as 0.0.0.0/0 or ::/0 would make `testers` mean "everyone" —
 *    public by another name, without the decision record `public` requires.
 * 2. An IPv6 entry may not touch the IPv4-mapped block ::ffff:0:0/96, in any
 *    spelling: "::ffff:203.0.113.7", "::ffff:cb00:7107",
 *    "0:0:0:0:0:ffff:cb00:7107", or a range that contains or lies inside the
 *    block. That block is IPv4 written as IPv6. "::ffff:0:0/96" is ALL of
 *    IPv4 — with an IPv6 prefix of 96, which rule 1 would accept. An IPv4
 *    network has exactly one accepted spelling here: its IPv4 one, under the
 *    IPv4 limit.
 * 3. Two entries with the same value are a mistake in the list, however each
 *    is written: "2001:db8::1" and "2001:0db8:0:0:0:0:0:1", or
 *    "203.0.113.0/24" and "203.0.113.7/24".
 *
 * Any violation invalidates the WHOLE list, and so closes recruitment: a
 * partly understood list is never applied.
 */
export const ALLOWLIST_MIN_PREFIX = Object.freeze({ ipv4: 8, ipv6: 16 });

/** ::ffff:0:0/96 — the IPv4-mapped block: ten zero bytes, then ff ff. */
const MAPPED_PREFIX_BITS = 96;
const MAPPED_PREFIX = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 0, 0, 0, 0]);

/* ------------------------------------------------------- address values -- */

function parseIpv4Bytes(text) {
  // net.isIPv4 has already refused leading zeros, hexadecimal and short forms.
  return Uint8Array.from(text.split('.').map(Number));
}

/** The 16 bytes of an IPv6 address that net.isIPv6 has accepted, or null. */
function parseIpv6Bytes(text) {
  let source = text;
  // A dotted IPv4 tail ("::ffff:203.0.113.7") is the last 32 bits.
  const lastColon = source.lastIndexOf(':');
  const tail = source.slice(lastColon + 1);
  let tailGroups = [];
  if (tail.includes('.')) {
    if (net.isIPv4(tail) === false) return null;
    const [b0, b1, b2, b3] = parseIpv4Bytes(tail);
    tailGroups = [(b0 << 8) | b1, (b2 << 8) | b3];
    source = source.slice(0, lastColon + 1);
    // "1:2:3:4:5:6:" -> "1:2:3:4:5:6", but keep a real "::" intact.
    if (source.endsWith(':') && !source.endsWith('::')) source = source.slice(0, -1);
  }
  const toGroups = (part) => (part === '' ? [] : part.split(':').map((group) => (/^[0-9a-f]{1,4}$/i.test(group) ? parseInt(group, 16) : NaN)));
  let groups;
  const gap = source.indexOf('::');
  if (gap === -1) {
    groups = [...toGroups(source), ...tailGroups];
  } else {
    if (source.indexOf('::', gap + 1) !== -1) return null;
    const head = toGroups(source.slice(0, gap));
    const rest = [...toGroups(source.slice(gap + 2)), ...tailGroups];
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...new Array(missing).fill(0), ...rest];
  }
  if (groups.length !== 8 || groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) return null;
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    bytes[index * 2] = group >> 8;
    bytes[index * 2 + 1] = group & 0xff;
  });
  return bytes;
}

/**
 * An address as a VALUE: `{ family, bytes }`, or null. A scoped address
 * ("fe80::1%eth0") is not an address here: a zone names an interface of this
 * machine, not a client, and net.isIP would accept it.
 */
function parseAddressValue(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > 45 || text.includes('%')) return null;
  const version = net.isIP(text);
  if (version === 4) return { family: 'ipv4', bytes: parseIpv4Bytes(text) };
  if (version === 6) {
    const bytes = parseIpv6Bytes(text);
    return bytes ? { family: 'ipv6', bytes } : null;
  }
  return null;
}

/** True when the first `bits` bits of the two byte arrays are equal. */
function samePrefix(left, right, bits) {
  const whole = bits >> 3;
  for (let index = 0; index < whole; index += 1) if (left[index] !== right[index]) return false;
  const rest = bits & 7;
  if (rest === 0) return true;
  const mask = (0xff << (8 - rest)) & 0xff;
  return (left[whole] & mask) === (right[whole] & mask);
}

/** The bytes with every bit after `bits` cleared: the network a range names. */
function networkOf(bytes, bits) {
  const network = new Uint8Array(bytes.length);
  const whole = bits >> 3;
  network.set(bytes.subarray(0, whole));
  const rest = bits & 7;
  if (rest !== 0) network[whole] = bytes[whole] & ((0xff << (8 - rest)) & 0xff);
  return network;
}

const isMappedValue = (bytes) => samePrefix(bytes, MAPPED_PREFIX, MAPPED_PREFIX_BITS);

function formatValue({ family, bytes }) {
  if (family === 'ipv4') return Array.from(bytes).join('.');
  // RFC 5952: lower case, no leading zeros, the longest run of zero groups
  // (two or more) compressed, the first such run on a tie.
  const groups = [];
  for (let index = 0; index < 16; index += 2) groups.push(((bytes[index] << 8) | bytes[index + 1]).toString(16));
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < 8; ) {
    if (groups[index] !== '0') {
      index += 1;
      continue;
    }
    let end = index;
    while (end < 8 && groups[end] === '0') end += 1;
    if (end - index > bestLength) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  if (bestLength < 2) return groups.join(':');
  return `${groups.slice(0, bestStart).join(':')}::${groups.slice(bestStart + bestLength).join(':')}`;
}

/**
 * The client address in the one form the list is compared in.
 *
 * Returns `{ address, family }` or null. An IPv4-mapped IPv6 address — what a
 * dual-stack socket or a proxy may report for an IPv4 peer — is the IPv4
 * client, IN EVERY SPELLING: "::ffff:203.0.113.7", "::ffff:cb00:7107" and
 * "0:0:0:0:0:ffff:cb00:7107" are all 203.0.113.7. The decision is made on the
 * parsed value, so no spelling can step around an entry or reach one it
 * should not. Other IPv6 addresses are returned in their canonical (RFC 5952)
 * form. Anything that is not a plain address — a zone identifier, a port, a
 * host name, a list — is null, and null is never listed.
 */
export function normaliseClientAddress(value) {
  const parsed = toClientValue(value);
  return parsed ? { address: formatValue(parsed), family: parsed.family } : null;
}

function toClientValue(value) {
  const parsed = parseAddressValue(value);
  if (!parsed) return null;
  if (parsed.family === 'ipv6' && isMappedValue(parsed.bytes)) return { family: 'ipv4', bytes: parsed.bytes.slice(12) };
  return parsed;
}

/** Lists made by parseAccessAllowlist. A hand-made stand-in is not one. */
const PARSED_ALLOWLISTS = new WeakSet();

/**
 * Parses ACCESS_ALLOWLIST: comma-separated addresses or CIDR ranges, IPv4 or
 * IPv6, under the range policy above. All or nothing.
 *
 * @returns {{ ok: true, ranges: ReadonlyArray<object>, size: number } | { ok: false, problem: 'ABSENT' | 'INVALID' }}
 */
export function parseAccessAllowlist(value) {
  if (value === undefined || value === null || value === '') return { ok: false, problem: 'ABSENT' };
  if (typeof value !== 'string' || value.length > ALLOWLIST_MAX_LENGTH) return { ok: false, problem: 'INVALID' };
  const entries = value.split(',').map((entry) => entry.trim());
  if (entries.length === 0 || entries.length > ALLOWLIST_MAX_ENTRIES || entries.some((entry) => entry === '')) {
    return { ok: false, problem: 'INVALID' };
  }

  const INVALID = { ok: false, problem: 'INVALID' };
  const ranges = [];
  const seen = new Set();
  for (const entry of entries) {
    const slash = entry.indexOf('/');
    const addressPart = slash === -1 ? entry : entry.slice(0, slash);
    const prefixPart = slash === -1 ? null : entry.slice(slash + 1);
    const parsed = parseAddressValue(addressPart);
    if (!parsed) return INVALID;
    const { family, bytes } = parsed;
    const maxPrefix = family === 'ipv4' ? 32 : 128;
    let prefix = maxPrefix;
    if (prefixPart !== null) {
      if (!/^\d{1,3}$/.test(prefixPart)) return INVALID;
      prefix = Number(prefixPart);
      // Policy rule 1.
      if (prefix > maxPrefix || prefix < ALLOWLIST_MIN_PREFIX[family]) return INVALID;
    }
    // Policy rule 2: an IPv6 range that overlaps ::ffff:0:0/96 — it lies inside
    // the block, or contains it. Two ranges overlap exactly when they agree on
    // the bits of the shorter prefix.
    if (family === 'ipv6' && samePrefix(bytes, MAPPED_PREFIX, Math.min(prefix, MAPPED_PREFIX_BITS))) return INVALID;
    const network = networkOf(bytes, prefix);
    // Policy rule 3: the same value twice.
    const key = `${family}/${prefix}/${Buffer.from(network).toString('hex')}`;
    if (seen.has(key)) return INVALID;
    seen.add(key);
    ranges.push(Object.freeze({ family, prefix, network }));
  }
  Object.freeze(ranges);
  PARSED_ALLOWLISTS.add(ranges);
  return { ok: true, ranges, size: ranges.length };
}

/**
 * The client address of one request, from the socket and the forwarding
 * header, under the configured number of trusted proxy hops (TRUST_PROXY).
 * C6 plan revision 3, section 4.6.3.
 *
 *   hops = 0 (TRUST_PROXY=false)
 *       The socket's peer. The forwarding header is not read.
 *
 *   hops = n >= 1
 *       X-Forwarded-For must hold AT LEAST n entries. The client is the entry
 *       n from the right; that entry and every entry to its right — the ones
 *       the trusted proxies appended — must be plain addresses. Entries to
 *       the left are client-supplied and ignored.
 *
 *       With FEWER than n entries the address is UNKNOWN (null). Express's
 *       own `req.ip` does not do this: with no header it returns the socket
 *       peer, and with too few entries the leftmost one. Either could be a
 *       listed address that no proxy vouched for — a request that reached
 *       the backend around the proxy, or a header the client wrote.
 *
 * Returns the address text, or null. Null is never listed.
 */
export function establishClientAddress({ trustedHops, socketAddress, forwardedFor } = {}) {
  if (trustedHops === false || trustedHops === 0 || trustedHops === undefined || trustedHops === null) {
    return typeof socketAddress === 'string' && parseAddressValue(socketAddress) ? socketAddress : null;
  }
  if (!Number.isInteger(trustedHops) || trustedHops < 1 || trustedHops > 10) return null;
  if (typeof forwardedFor !== 'string' || forwardedFor.length === 0 || forwardedFor.length > 2048) return null;
  const chain = forwardedFor.split(',').map((entry) => entry.trim());
  if (chain.length < trustedHops) return null;
  const vouchedFor = chain.slice(chain.length - trustedHops);
  if (vouchedFor.some((entry) => parseAddressValue(entry) === null)) return null;
  return vouchedFor[0];
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
  const { allowlist: ranges, ...visible } = resolved;
  const result = { ...visible };
  // Non-enumerable: absent from spreads, JSON, util.inspect and log lines.
  Object.defineProperty(result, 'allowlist', { value: ranges, enumerable: false });
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
    return { mode: 'testers', configured: 'valid', reason: RECRUITMENT_REASONS.MODE_TESTERS, authorisationRef: null, allowlist: parsed.ranges, allowlistEntries: parsed.size };
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
 * @param {unknown} clientAddress the address from establishClientAddress (or any address text)
 */
export function decideRecruitmentAudience(access, clientAddress) {
  try {
    if (access?.mode === 'public') return RECRUITMENT_AUDIENCE.PUBLIC;
    if (access?.mode !== 'testers') return RECRUITMENT_AUDIENCE.NONE;
    const client = toClientValue(clientAddress);
    const ranges = access.allowlist;
    // Only a list this module parsed is used: a stand-in object is not one.
    if (!client || !PARSED_ALLOWLISTS.has(ranges)) return RECRUITMENT_AUDIENCE.NONE;
    // An entry admits a client of its own family only. A mapped client is
    // IPv4 by now, and no IPv6 entry can lie in the mapped block.
    const listed = ranges.some((range) => range.family === client.family && samePrefix(client.bytes, range.network, range.prefix));
    return listed ? RECRUITMENT_AUDIENCE.TESTER : RECRUITMENT_AUDIENCE.NONE;
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
