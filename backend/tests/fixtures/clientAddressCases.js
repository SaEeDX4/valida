/**
 * C6-T2 — ONE table of client-address cases, exercised against BOTH services:
 *
 *   backend/tests/c6-delegation.test.js           the API, deciding a direct request
 *   frontend/server/visitorDelegation.test.js     the document server, establishing
 *                                                 the visitor it delegates
 *
 * Each case is a socket peer, a TRUST_PROXY value and an X-Forwarded-For
 * header, with the address both services must establish (null = unknown,
 * which is unlisted and is sent by the document server as `unlisted`).
 *
 * `http: true` marks the cases whose socket is the loopback address a test
 * connection really has (127.0.0.1), so they can also be sent over HTTP.
 * Documentation addresses only (RFC 5737, RFC 3849).
 */
export const CLIENT_ADDRESS_CASES = Object.freeze([
  // TRUST_PROXY=false: the socket peer; the header is never read.
  { name: 'no proxy trust, no header', trustedHops: false, socketAddress: '127.0.0.1', forwardedFor: undefined, expected: '127.0.0.1', http: true },
  { name: 'no proxy trust, a listed address in the header is ignored', trustedHops: false, socketAddress: '127.0.0.1', forwardedFor: '203.0.113.7', expected: '127.0.0.1', http: true },
  { name: 'no proxy trust, an IPv6 socket peer', trustedHops: false, socketAddress: '2001:db8:10::1', forwardedFor: '203.0.113.7', expected: '2001:db8:10::1', http: false },
  { name: 'no proxy trust, a dual-stack mapped socket peer', trustedHops: false, socketAddress: '::ffff:203.0.113.7', forwardedFor: undefined, expected: '::ffff:203.0.113.7', http: false },
  { name: 'no proxy trust, no socket address', trustedHops: false, socketAddress: undefined, forwardedFor: '203.0.113.7', expected: null, http: false },

  // TRUST_PROXY=1.
  { name: '1 hop, one entry', trustedHops: 1, socketAddress: '127.0.0.1', forwardedFor: '203.0.113.7', expected: '203.0.113.7', http: true },
  { name: '1 hop, the client put a listed address in front', trustedHops: 1, socketAddress: '127.0.0.1', forwardedFor: '203.0.113.7, 192.0.2.44', expected: '192.0.2.44', http: true },
  { name: '1 hop, an IPv6 client', trustedHops: 1, socketAddress: '127.0.0.1', forwardedFor: '2001:db8:10::beef', expected: '2001:db8:10::beef', http: true },
  { name: '1 hop, a hexadecimal mapped client', trustedHops: 1, socketAddress: '127.0.0.1', forwardedFor: '::ffff:cb00:7107', expected: '::ffff:cb00:7107', http: true },
  { name: '1 hop, NO header (incomplete chain)', trustedHops: 1, socketAddress: '127.0.0.1', forwardedFor: undefined, expected: null, http: true },
  { name: '1 hop, an empty header', trustedHops: 1, socketAddress: '127.0.0.1', forwardedFor: '', expected: null, http: true },
  { name: '1 hop, a blank header', trustedHops: 1, socketAddress: '127.0.0.1', forwardedFor: ' ', expected: null, http: true },
  { name: '1 hop, the proxy-appended entry is not an address', trustedHops: 1, socketAddress: '127.0.0.1', forwardedFor: '203.0.113.7, not-an-address', expected: null, http: true },
  { name: '1 hop, an address with a port', trustedHops: 1, socketAddress: '127.0.0.1', forwardedFor: '203.0.113.7:443', expected: null, http: true },
  { name: '1 hop, a zone identifier', trustedHops: 1, socketAddress: '127.0.0.1', forwardedFor: 'fe80::1%eth0', expected: null, http: true },

  // TRUST_PROXY=2.
  { name: '2 hops, exactly two entries', trustedHops: 2, socketAddress: '127.0.0.1', forwardedFor: '203.0.113.7, 198.51.100.200', expected: '203.0.113.7', http: true },
  { name: '2 hops, three entries; the leftmost is client-supplied', trustedHops: 2, socketAddress: '127.0.0.1', forwardedFor: 'anything, 192.0.2.44, 198.51.100.200', expected: '192.0.2.44', http: true },
  { name: '2 hops, ONE entry (incomplete chain)', trustedHops: 2, socketAddress: '127.0.0.1', forwardedFor: '203.0.113.7', expected: null, http: true },
  { name: '2 hops, the second proxy entry is not an address', trustedHops: 2, socketAddress: '127.0.0.1', forwardedFor: '203.0.113.7, proxy', expected: null, http: true },
  { name: '2 hops, no header', trustedHops: 2, socketAddress: '127.0.0.1', forwardedFor: undefined, expected: null, http: true },

  // Out-of-range trust values are never used to read the header.
  { name: 'an invalid hop count (11)', trustedHops: 11, socketAddress: '127.0.0.1', forwardedFor: '203.0.113.7', expected: null, http: false },
  { name: 'an invalid hop count (0)', trustedHops: 0, socketAddress: '127.0.0.1', forwardedFor: '203.0.113.7', expected: '127.0.0.1', http: false },
]);

/** TRUST_PROXY text values, and what the shared rule makes of them (null = refused at start-up). */
export const TRUST_PROXY_VALUES = Object.freeze([
  [undefined, false],
  ['false', false],
  ['1', 1],
  ['2', 2],
  ['10', 10],
  ['01', 1],
  [' 1', 1],
  ['1.0', 1],
  ['', null],
  ['0', null],
  ['11', null],
  ['-1', null],
  ['1.5', null],
  ['true', null],
  ['False', null],
  ['one', null],
]);
