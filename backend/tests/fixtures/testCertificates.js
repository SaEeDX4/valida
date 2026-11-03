import crypto from 'node:crypto';

/**
 * B6 r4 — TEST-ONLY X.509 certificates, generated in memory for each run.
 *
 * The SMTP adapter verifies certificates; proving that needs certificates
 * that pass and certificates that must fail. They are built here with Node's
 * own crypto (P-256 keys, ECDSA-SHA256 signatures, a minimal DER encoder), so
 * no private key is ever written to the repository or to disk, and no
 * certificate tool or extra package is needed — on Windows or Linux.
 *
 * Every name says what it is: "Valida QA Test CA - NOT TRUSTED ANYWHERE".
 * The CA is trusted only by the adapter instances the tests create
 * (trustedCa); nothing else ever sees it.
 */

// ---- minimal DER ------------------------------------------------------------
const lengthBytes = (n) => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
const tlv = (tag, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), lengthBytes(body.length), body]);
};
const sequence = (...parts) => tlv(0x30, ...parts);
const set = (...parts) => tlv(0x31, ...parts);
/**
 * A non-negative DER INTEGER in its MINIMAL form (X.690 8.3.2): redundant
 * leading zero bytes removed, one 0x00 added when the high bit is set.
 * OpenSSL rejects a padded INTEGER ("illegal padding") — and silently drops
 * such a certificate from a `ca` list (r4: a random serial starting 0x00
 * made a whole test file's CA untrusted about once in 512 runs).
 */
export const derInteger = (bytes) => {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0x00 && (bytes[start + 1] & 0x80) === 0) start += 1;
  const value = bytes.subarray(start);
  return tlv(0x02, value[0] & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value);
};
const integer = derInteger;
const objectId = (dotted) => {
  const [first, second, ...rest] = dotted.split('.').map(Number);
  const out = [40 * first + second];
  for (const value of rest) {
    const chunk = [value & 0x7f];
    for (let v = value >> 7; v > 0; v >>= 7) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
};
const utf8String = (text) => tlv(0x0c, Buffer.from(text, 'utf8'));
const time = (date) => {
  const iso = date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const year = date.getUTCFullYear();
  // RFC 5280: UTCTime through 2049, GeneralizedTime from 2050.
  return year < 2050 ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${iso}Z`));
};
const bitString = (bytes, unusedBits = 0) => tlv(0x03, Buffer.from([unusedBits]), bytes);
const octetString = (bytes) => tlv(0x04, bytes);
const boolean = (value) => tlv(0x01, Buffer.from([value ? 0xff : 0x00]));
const explicit = (tagNumber, ...parts) => tlv(0xa0 + tagNumber, ...parts);
const distinguishedName = (commonName) => sequence(set(sequence(objectId('2.5.4.3'), utf8String(commonName))));
const ECDSA_WITH_SHA256 = sequence(objectId('1.2.840.10045.4.3.2'));
const extension = (id, critical, value) => sequence(objectId(id), ...(critical ? [boolean(true)] : []), octetString(value));

const pem = (label, der) => `-----BEGIN ${label}-----\n${der.toString('base64').replace(/(.{64})/g, '$1\n').replace(/\n$/, '')}\n-----END ${label}-----\n`;
const DAY = 24 * 60 * 60 * 1000;

/**
 * @returns {{ cert: string, key: string, keyObject: crypto.KeyObject, keyId: Buffer, subject: string }}
 */
function issue({ subject, issuer = null, ca = false, dnsNames = [], ipAddresses = [], notBefore, notAfter, serial }) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const keyId = crypto.createHash('sha1').update(spki).digest();
  const signer = issuer ?? { keyObject: privateKey, keyId, subject };

  const extensions = [
    extension('2.5.29.19', true, sequence(...(ca ? [boolean(true)] : []))), // basicConstraints
    // keyUsage: CA = keyCertSign + cRLSign (bits 5, 6); leaf = digitalSignature (bit 0)
    extension('2.5.29.15', true, ca ? bitString(Buffer.from([0x06]), 1) : bitString(Buffer.from([0x80]), 7)),
    extension('2.5.29.14', false, octetString(keyId)), // subjectKeyIdentifier
    extension('2.5.29.35', false, sequence(tlv(0x80, signer.keyId))), // authorityKeyIdentifier
  ];
  if (!ca) {
    extensions.push(extension('2.5.29.37', false, sequence(objectId('1.3.6.1.5.5.7.3.1')))); // extKeyUsage: serverAuth
    const names = [
      ...dnsNames.map((name) => tlv(0x82, Buffer.from(name, 'ascii'))),
      ...ipAddresses.map((ip) => tlv(0x87, Buffer.from(ip.split('.').map(Number)))),
    ];
    if (names.length > 0) extensions.push(extension('2.5.29.17', false, sequence(...names))); // subjectAltName
  }

  const tbs = sequence(
    explicit(0, integer(Buffer.from([2]))), // v3
    integer(serial),
    ECDSA_WITH_SHA256,
    distinguishedName(signer.subject),
    sequence(time(notBefore), time(notAfter)),
    distinguishedName(subject),
    spki,
    explicit(3, sequence(...extensions)),
  );
  const signature = crypto.sign('sha256', tbs, signer.keyObject);
  const der = sequence(tbs, ECDSA_WITH_SHA256, bitString(signature));
  return {
    cert: pem('CERTIFICATE', der),
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    keyObject: privateKey,
    keyId,
    subject,
  };
}

/**
 * A complete set for the SMTP TLS tests, generated once per call:
 *   ca            the test CA (trusted only by the adapters the tests create)
 *   localhost     a valid server certificate for "localhost" / 127.0.0.1, issued by ca
 *   wrongHost     issued by ca, but for "wrong-host.example.test" only
 *   expired       issued by ca for localhost, expired yesterday
 *   untrusted     a valid-looking localhost certificate from ANOTHER CA (never trusted)
 *   localhostNameOnly  (r8) valid, issued by ca for the NAME "localhost" only — no address — so it
 *                 verifies only where "localhost" is the name checked, whatever loopback address
 *                 (127.0.0.1 or ::1) the connection uses
 */
/** A random positive serial (RFC 5280 4.1.2.2): 12 bytes, first byte 0x01-0x7f. */
const randomSerial = () => {
  const bytes = crypto.randomBytes(12);
  bytes[0] = (bytes[0] & 0x7f) | 0x01;
  return bytes;
};

/**
 * @param {object} [options]
 * @param {() => Buffer} [options.serialBytes] TEST HOOK: the serial of each certificate (default: randomSerial)
 */
export function createTestCertificates({ serialBytes = randomSerial } = {}) {
  const now = Date.now();
  const valid = { notBefore: new Date(now - DAY), notAfter: new Date(now + 30 * DAY) };
  const ca = issue({ subject: 'Valida QA Test CA - NOT TRUSTED ANYWHERE', ca: true, serial: serialBytes(), ...valid });
  const otherCa = issue({ subject: 'Valida QA Other CA - NEVER TRUSTED', ca: true, serial: serialBytes(), ...valid });
  const localhost = { dnsNames: ['localhost'], ipAddresses: ['127.0.0.1'] };
  return {
    ca: ca.cert,
    localhost: issue({ subject: 'localhost', issuer: ca, serial: serialBytes(), ...localhost, ...valid }),
    wrongHost: issue({ subject: 'wrong-host.example.test', issuer: ca, serial: serialBytes(), dnsNames: ['wrong-host.example.test'], ...valid }),
    expired: issue({ subject: 'localhost', issuer: ca, serial: serialBytes(), ...localhost, notBefore: new Date(now - 30 * DAY), notAfter: new Date(now - DAY) }),
    untrusted: issue({ subject: 'localhost', issuer: otherCa, serial: serialBytes(), ...localhost, ...valid }),
    localhostNameOnly: issue({ subject: 'localhost', issuer: ca, serial: serialBytes(), dnsNames: ['localhost'], ...valid }),
  };
}
