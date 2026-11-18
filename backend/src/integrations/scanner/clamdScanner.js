import net from 'node:net';
import { createHash } from 'node:crypto';

/**
 * Proposed (MongoDB-native r2, finding 3) — the malware scanner: a client for
 * ClamAV's daemon (clamd) over TCP (Doc 13 sections 70-74).
 *
 * Protocol (clamd(8)): null-terminated commands with the "z" prefix.
 *   zVERSION\0  -> "ClamAV <engine>/<signature version>/<signature date>\0"
 *   zINSTREAM\0 then chunks <uint32 big-endian length><bytes>, ended by a
 *   zero-length chunk -> "stream: OK\0" | "stream: <name> FOUND\0" | "... ERROR\0"
 *
 * Strict by design — anything that is not an exact, complete, expected answer
 * is an ERROR, never a verdict:
 *   - CLEAN only for exactly "stream: OK"; INFECTED only for "stream: <name> FOUND";
 *   - a response that is partial (no terminator), oversized, has extra lines,
 *     or names an error -> ScannerError (MALFORMED_RESPONSE / SCANNER_ERROR);
 *   - connect / overall timeouts and resets -> ScannerError (TIMEOUT / UNAVAILABLE);
 *   - the signature set must be identifiable (engine/version/date parse) and
 *     FRESH (date within maxSignatureAgeHours, not in the future beyond the
 *     allowed skew) -> otherwise UNKNOWN_SIGNATURES / STALE_SIGNATURES;
 *   - the signature version is read before and after the scan; if it changed
 *     (a reload in between) the result is not attributable -> SIGNATURES_CHANGED.
 *
 * clamd prints the signature date with ctime() in ITS time zone; run clamd with
 * TZ=UTC (the default here is to read the date as UTC).
 *
 * Nothing about the file (name, key, applicant) is sent to clamd: only bytes.
 */
export class ScannerError extends Error {
  constructor(reason, detail) {
    super(`scanner: ${reason}`);
    this.name = 'ScannerError';
    this.reason = reason;
    if (detail !== undefined) this.detail = detail;
  }
}

export const SCANNER_FAILURE_REASONS = Object.freeze([
  'UNAVAILABLE', 'TIMEOUT', 'MALFORMED_RESPONSE', 'SCANNER_ERROR', 'UNKNOWN_SIGNATURES', 'STALE_SIGNATURES', 'SIGNATURES_CHANGED', 'TOO_LARGE', 'INVALID_REQUEST',
]);

const MAX_RESPONSE_BYTES = 1024;
const CHUNK = 64 * 1024;
const VERSION_RE = /^ClamAV (\d+\.\d+\.\d+)\/(\d{1,9})\/([A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \d{4})$/;
const FOUND_RE = /^stream: ([A-Za-z0-9._:/+-]{1,200}) FOUND$/;
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/** "Wed Nov 18 13:15:56 2026" (ctime) -> Date, read as UTC. */
function parseCtimeUtc(text) {
  const m = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(text);
  if (!m || !(m[1] in MONTHS)) return null;
  const d = new Date(Date.UTC(Number(m[6]), MONTHS[m[1]], Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseVersion(text) {
  const m = VERSION_RE.exec(text);
  if (!m) return null;
  const signatureDate = parseCtimeUtc(m[3]);
  if (!signatureDate) return null;
  return { engine: m[1], signatureVersion: m[2], signatureDate };
}

export function parseScanResponse(text) {
  if (text === 'stream: OK') return { verdict: 'CLEAN' };
  const found = FOUND_RE.exec(text);
  if (found) return { verdict: 'INFECTED', signature: found[1] };
  if (/ERROR$/.test(text)) throw new ScannerError('SCANNER_ERROR');
  throw new ScannerError('MALFORMED_RESPONSE');
}

export function createClamdScanner({
  host = '127.0.0.1',
  port = 3310,
  connectTimeoutMs = 3_000,
  scanTimeoutMs = 30_000,
  maxSignatureAgeHours = 48,
  maxFutureSkewMinutes = 60,
  maxStreamBytes = 6 * 1024 * 1024,
  clock = () => new Date(),
  connect = (options) => net.connect(options),
} = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ScannerError('INVALID_REQUEST');
  if (!(maxSignatureAgeHours > 0)) throw new ScannerError('INVALID_REQUEST');

  /** One command on one connection: write `payload` parts, read one \0-terminated reply. */
  function exchange(writeParts, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const chunks = [];
      let length = 0;
      const socket = connect({ host, port });
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        clearTimeout(overallTimer);
        socket.destroy();
        if (error) reject(error);
        else resolve(value);
      };
      const connectTimer = setTimeout(() => finish(new ScannerError('TIMEOUT', 'connect')), connectTimeoutMs);
      const overallTimer = setTimeout(() => finish(new ScannerError('TIMEOUT', 'response')), timeoutMs);
      socket.on('connect', () => {
        clearTimeout(connectTimer);
        for (const part of writeParts) socket.write(part);
      });
      socket.on('data', (data) => {
        chunks.push(data);
        length += data.length;
        if (length > MAX_RESPONSE_BYTES) return finish(new ScannerError('MALFORMED_RESPONSE', 'oversized'));
        const all = Buffer.concat(chunks);
        const end = all.indexOf(0);
        if (end !== -1) {
          if (end !== all.length - 1) return finish(new ScannerError('MALFORMED_RESPONSE', 'trailing'));
          const text = all.subarray(0, end).toString('utf8');
          if (/[\r\n]/.test(text)) return finish(new ScannerError('MALFORMED_RESPONSE', 'multiline'));
          return finish(null, text);
        }
        return undefined;
      });
      // Closed before a terminated reply: partial or no answer.
      socket.on('end', () => finish(new ScannerError(length ? 'MALFORMED_RESPONSE' : 'UNAVAILABLE', length ? 'truncated' : 'closed')));
      socket.on('close', () => finish(new ScannerError(length ? 'MALFORMED_RESPONSE' : 'UNAVAILABLE', length ? 'truncated' : 'closed')));
      socket.on('error', () => finish(new ScannerError('UNAVAILABLE', 'socket')));
    });
  }

  async function version() {
    const text = await exchange([Buffer.from('zVERSION\0')], connectTimeoutMs + 5_000);
    const parsed = parseVersion(text);
    if (!parsed) throw new ScannerError('UNKNOWN_SIGNATURES');
    const now = clock().getTime();
    const ageMs = now - parsed.signatureDate.getTime();
    if (ageMs < -maxFutureSkewMinutes * 60_000) throw new ScannerError('UNKNOWN_SIGNATURES', 'future');
    if (ageMs > maxSignatureAgeHours * 3_600_000) throw new ScannerError('STALE_SIGNATURES');
    return { ...parsed, ageHours: Math.max(0, ageMs / 3_600_000) };
  }

  /**
   * @returns {{ verdict: 'CLEAN'|'INFECTED', signature?, engine, signatureVersion, signatureDate, sentBytes, sentSha256 }}
   */
  async function scan(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new ScannerError('INVALID_REQUEST');
    if (bytes.length > maxStreamBytes) throw new ScannerError('TOO_LARGE');
    const before = await version();
    const parts = [Buffer.from('zINSTREAM\0')];
    const hash = createHash('sha256');
    let sent = 0;
    for (let offset = 0; offset < bytes.length; offset += CHUNK) {
      const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + CHUNK));
      const header = Buffer.alloc(4);
      header.writeUInt32BE(chunk.length, 0);
      parts.push(header, chunk);
      hash.update(chunk);
      sent += chunk.length;
    }
    parts.push(Buffer.alloc(4)); // zero-length chunk: end of stream
    const result = parseScanResponse(await exchange(parts, scanTimeoutMs));
    const after = await version();
    if (after.signatureVersion !== before.signatureVersion || after.engine !== before.engine) throw new ScannerError('SIGNATURES_CHANGED');
    return { ...result, engine: before.engine, signatureVersion: before.signatureVersion, signatureDate: before.signatureDate, sentBytes: sent, sentSha256: hash.digest('hex') };
  }

  return { name: 'clamav', version, scan };
}
