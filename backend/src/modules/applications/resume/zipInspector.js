import { inflateRaw, crc32 } from 'node:zlib';
import { promisify } from 'node:util';
import { DOCX_INSPECTION_LIMITS } from '../../../config/resumePolicy.js';

/**
 * Bounded, read-only ZIP inspection — Milestone B4.
 *
 * A DOCX is a ZIP package. 13_SECURITY_PRIVACY_THREAT_MODEL.md sections 76-79
 * require its inspection to be bounded — entry count, decompressed size,
 * compression ratio — with no unsafe filesystem extraction, no path traversal
 * and no uncontrolled decompression. This module meets that by construction:
 *
 *   - NOTHING IS EXTRACTED. There is no code path from an entry name to the
 *     filesystem; entries are read through `reader.read(offset, length)`
 *     from the upload's own temporary file, into memory.
 *   - Only the central directory is parsed; only parts the caller names are
 *     inflated, each with zlib's `maxOutputLength` set to the part's declared
 *     size (itself capped), and the output must match that size and the
 *     CRC-32 exactly. A lying header cannot make zlib produce more.
 *   - Every declared size is checked against the limits BEFORE anything is
 *     decompressed: entry count, total declared uncompressed size, and a
 *     per-entry compression ratio (above a small grace size).
 *
 * It is also deliberately STRICT about structure, because an ambiguous ZIP
 * is how a file can be one thing to this check and another to the program
 * that later opens it:
 *
 *   - the end-of-central-directory record must end exactly at end of file
 *     (no trailing data), the central directory must end exactly where it
 *     begins, and the first entry must start at offset 0 (no prepended data
 *     — self-extracting executables and polyglots are refused);
 *   - entries must be contiguous and non-overlapping (overlapping entries
 *     are the "better zip bomb" technique; gaps can hide unreferenced data);
 *   - each local header must agree with its central-directory entry on name
 *     and compression method;
 *   - encrypted entries, compression other than stored/deflate, multi-disk
 *     archives and ZIP64 are refused — none occur in a Word document below
 *     5 MiB;
 *   - entry names must be relative, forward-slash, without "..", NUL, drive
 *     letters or control characters, and unique ignoring ASCII case (OPC
 *     part names are case-insensitive).
 *
 * Failures throw ZipRejection with a fixed reason token.
 */
const inflateRawAsync = promisify(inflateRaw);

const SIGNATURE = Object.freeze({
  LOCAL_HEADER: 0x04034b50,
  CENTRAL_HEADER: 0x02014b50,
  END_OF_CENTRAL_DIRECTORY: 0x06054b50,
  ZIP64_LOCATOR: 0x07064b50,
  DATA_DESCRIPTOR: 0x08074b50,
});

const EOCD_SIZE = 22;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const MAX_COMMENT = 0xffff;

const FLAG_ENCRYPTED = 0x0001;
const FLAG_DATA_DESCRIPTOR = 0x0008;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_UTF8 = 0x0800;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

export class ZipRejection extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'ZipRejection';
    this.reason = reason;
  }
}

const reject = (reason) => {
  throw new ZipRejection(reason);
};

const utf8 = new TextDecoder('utf-8', { fatal: true });

function decodeEntryName(bytes, flags) {
  if (flags & FLAG_UTF8) {
    try {
      return utf8.decode(bytes);
    } catch {
      return reject('ZIP_ENTRY_NAME_INVALID');
    }
  }
  // Not flagged UTF-8 (CP437 by the specification). Only the ASCII bytes
  // matter for the safety rules below; anything else is kept as-is.
  return bytes.toString('latin1');
}

function assertSafeEntryName(name) {
  if (name.length === 0) reject('ZIP_ENTRY_NAME_INVALID');
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  if (/[\u0000-\u001f\u007f\\]/.test(name)) reject('ZIP_ENTRY_PATH_UNSAFE');
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) reject('ZIP_ENTRY_PATH_UNSAFE');
  const segments = name.split('/');
  // A trailing '/' marks a directory entry; empty segments elsewhere are not allowed.
  const body = name.endsWith('/') ? segments.slice(0, -1) : segments;
  if (body.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    reject('ZIP_ENTRY_PATH_UNSAFE');
  }
}

/**
 * Reads and validates the ZIP directory.
 *
 * @param {{ size: number, read: (offset: number, length: number) => Promise<Buffer> }} reader
 * @returns {Promise<{ entries: object[], byName: Map<string, object> }>}
 *   `byName` keys are entry names in lower case.
 */
export async function readZipDirectory(reader, limits = DOCX_INSPECTION_LIMITS) {
  const { size } = reader;
  if (size < EOCD_SIZE) reject('ZIP_TOO_SMALL');

  // --- end of central directory: must end exactly at end of file ---------
  const tailLength = Math.min(size, EOCD_SIZE + MAX_COMMENT);
  const tailStart = size - tailLength;
  const tail = await reader.read(tailStart, tailLength);
  let eocd = -1;
  for (let position = tail.length - EOCD_SIZE; position >= 0; position -= 1) {
    if (tail.readUInt32LE(position) === SIGNATURE.END_OF_CENTRAL_DIRECTORY) {
      const commentLength = tail.readUInt16LE(position + 20);
      if (position + EOCD_SIZE + commentLength === tail.length) {
        eocd = position;
        break;
      }
    }
  }
  if (eocd === -1) reject('ZIP_END_RECORD_MISSING');
  const eocdOffset = tailStart + eocd;

  const diskNumber = tail.readUInt16LE(eocd + 4);
  const directoryDisk = tail.readUInt16LE(eocd + 6);
  const entriesOnDisk = tail.readUInt16LE(eocd + 8);
  const entryCount = tail.readUInt16LE(eocd + 10);
  const directorySize = tail.readUInt32LE(eocd + 12);
  const directoryOffset = tail.readUInt32LE(eocd + 16);

  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    reject('ZIP64_UNSUPPORTED');
  }
  if (eocdOffset >= 20) {
    const locator = await reader.read(eocdOffset - 20, 4);
    if (locator.readUInt32LE(0) === SIGNATURE.ZIP64_LOCATOR) reject('ZIP64_UNSUPPORTED');
  }
  if (diskNumber !== 0 || directoryDisk !== 0 || entriesOnDisk !== entryCount) reject('ZIP_MULTI_DISK');
  if (entryCount === 0) reject('ZIP_EMPTY');
  if (entryCount > limits.maxEntries) reject('ZIP_TOO_MANY_ENTRIES');
  if (directoryOffset + directorySize !== eocdOffset) reject('ZIP_DIRECTORY_MISPLACED');

  // --- central directory --------------------------------------------------
  const directory = await reader.read(directoryOffset, directorySize);
  const entries = [];
  const byName = new Map();
  let totalUncompressed = 0;
  let position = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (position + CENTRAL_HEADER_SIZE > directory.length) reject('ZIP_DIRECTORY_TRUNCATED');
    if (directory.readUInt32LE(position) !== SIGNATURE.CENTRAL_HEADER) reject('ZIP_DIRECTORY_CORRUPT');

    const flags = directory.readUInt16LE(position + 8);
    const method = directory.readUInt16LE(position + 10);
    const crc = directory.readUInt32LE(position + 16);
    const compressedSize = directory.readUInt32LE(position + 20);
    const uncompressedSize = directory.readUInt32LE(position + 24);
    const nameLength = directory.readUInt16LE(position + 28);
    const extraLength = directory.readUInt16LE(position + 30);
    const commentLength = directory.readUInt16LE(position + 32);
    const startDisk = directory.readUInt16LE(position + 34);
    const localHeaderOffset = directory.readUInt32LE(position + 42);

    const recordEnd = position + CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
    if (recordEnd > directory.length) reject('ZIP_DIRECTORY_TRUNCATED');
    if (nameLength > limits.maxEntryNameBytes) reject('ZIP_ENTRY_NAME_INVALID');

    if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) reject('ZIP_ENCRYPTED');
    if (method !== METHOD_STORED && method !== METHOD_DEFLATE) reject('ZIP_UNSUPPORTED_COMPRESSION');
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      reject('ZIP64_UNSUPPORTED');
    }
    if (startDisk !== 0) reject('ZIP_MULTI_DISK');
    if (method === METHOD_STORED && compressedSize !== uncompressedSize) reject('ZIP_SIZE_INCONSISTENT');

    const nameBytes = Buffer.from(directory.subarray(position + CENTRAL_HEADER_SIZE, position + CENTRAL_HEADER_SIZE + nameLength));
    const name = decodeEntryName(nameBytes, flags);
    assertSafeEntryName(name);
    const key = name.toLowerCase();
    if (byName.has(key)) reject('ZIP_DUPLICATE_ENTRY');

    // Bounds on what decompression COULD produce — checked before any is done.
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > limits.maxTotalUncompressedBytes) reject('ZIP_UNCOMPRESSED_TOO_LARGE');
    if (uncompressedSize > limits.ratioGraceBytes && uncompressedSize > compressedSize * limits.maxCompressionRatio) {
      reject('ZIP_COMPRESSION_RATIO');
    }

    const entry = { name, nameBytes, flags, method, crc, compressedSize, uncompressedSize, localHeaderOffset };
    entries.push(entry);
    byName.set(key, entry);
    position = recordEnd;
  }
  if (position !== directory.length) reject('ZIP_DIRECTORY_CORRUPT');

  // --- local headers: agree with the directory, contiguous, no overlap ----
  const ordered = [...entries].sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
  let expectedOffset = 0;
  for (const entry of ordered) {
    if (entry.localHeaderOffset !== expectedOffset) {
      reject(entry.localHeaderOffset < expectedOffset ? 'ZIP_ENTRIES_OVERLAP' : 'ZIP_UNREFERENCED_DATA');
    }
    if (entry.localHeaderOffset + LOCAL_HEADER_SIZE > directoryOffset) reject('ZIP_ENTRY_OUT_OF_BOUNDS');
    const header = await reader.read(entry.localHeaderOffset, LOCAL_HEADER_SIZE);
    if (header.readUInt32LE(0) !== SIGNATURE.LOCAL_HEADER) reject('ZIP_LOCAL_HEADER_INVALID');
    const localMethod = header.readUInt16LE(8);
    const localNameLength = header.readUInt16LE(26);
    const localExtraLength = header.readUInt16LE(28);
    if (localMethod !== entry.method) reject('ZIP_HEADER_MISMATCH');
    if (localNameLength !== entry.nameBytes.length) reject('ZIP_HEADER_MISMATCH');
    const localName = await reader.read(entry.localHeaderOffset + LOCAL_HEADER_SIZE, localNameLength);
    if (!localName.equals(entry.nameBytes)) reject('ZIP_HEADER_MISMATCH');

    entry.dataOffset = entry.localHeaderOffset + LOCAL_HEADER_SIZE + localNameLength + localExtraLength;
    let end = entry.dataOffset + entry.compressedSize;
    if (entry.flags & FLAG_DATA_DESCRIPTOR) {
      // CRC and sizes follow the data, with or without a signature.
      if (end + 4 > directoryOffset) reject('ZIP_ENTRY_OUT_OF_BOUNDS');
      const marker = await reader.read(end, 4);
      end += marker.readUInt32LE(0) === SIGNATURE.DATA_DESCRIPTOR ? 16 : 12;
    }
    if (end > directoryOffset) reject('ZIP_ENTRY_OUT_OF_BOUNDS');
    expectedOffset = end;
  }
  if (expectedOffset !== directoryOffset) reject('ZIP_UNREFERENCED_DATA');

  return { entries, byName };
}

/**
 * Inflates ONE entry into memory, bounded by `maxBytes`, and verifies its
 * size and CRC-32 against the directory.
 */
export async function readZipEntry(reader, entry, maxBytes) {
  if (entry.uncompressedSize > maxBytes) reject('ZIP_PART_TOO_LARGE');
  const compressed = await reader.read(entry.dataOffset, entry.compressedSize);
  let data;
  if (entry.method === METHOD_STORED) {
    data = compressed;
  } else {
    try {
      data = await inflateRawAsync(compressed, { maxOutputLength: Math.max(1, entry.uncompressedSize) });
    } catch {
      // Corrupt deflate data, or more output than declared (RangeError).
      reject('ZIP_PART_CORRUPT');
    }
  }
  if (data.length !== entry.uncompressedSize) reject('ZIP_PART_SIZE_MISMATCH');
  if (crc32(data) >>> 0 !== entry.crc >>> 0) reject('ZIP_PART_CRC_MISMATCH');
  return data;
}
