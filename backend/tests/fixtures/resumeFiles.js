import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * SYNTHETIC resume files for the B4 tests — Doc 17 sections 29-31 and 414.
 *
 * Every document built here states that it is a QA test document and not a
 * real candidate; no real resume, name or personal data is used anywhere.
 *
 * Built in code rather than stored as binaries so that each malicious or
 * malformed variant is explicit and reviewable: the ZIP builder can produce
 * a correct Office package or a precisely broken one (lying sizes,
 * mismatched headers, overlapping or hidden data, traversal names, bombs).
 * Files produced by real authoring tools are in tests/fixtures/resumes/.
 */
export const QA_MARKER = 'QA TEST DOCUMENT - NOT A REAL CANDIDATE';

export const PDF_MIME = 'application/pdf';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ---------------------------------------------------------------- PDF -----

/**
 * A small, genuinely valid one-page PDF (qpdf --check accepts both forms).
 *
 * @param {object} [options]
 * @param {boolean} [options.xrefStream] use a cross-reference STREAM (PDF 1.5+)
 *   instead of a classic xref table
 * @param {string}  [options.version]
 * @param {number}  [options.padTo] append a comment inside the file (before
 *   the xref) until the file is at least this many bytes
 */
export function syntheticPdf({ text = QA_MARKER, xrefStream = false, version = xrefStream ? '1.5' : '1.4', padTo = 0 } = {}) {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const chunks = [Buffer.from(`%PDF-${version}\n%\xe2\xe3\xcf\xd3\n`, 'latin1')];
  let length = chunks[0].length;
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(length);
    const chunk = Buffer.from(`${index + 1} 0 obj\n${body}\nendobj\n`, 'latin1');
    chunks.push(chunk);
    length += chunk.length;
  });
  if (padTo > length) {
    // A PDF comment line: legal anywhere between objects.
    const pad = Buffer.from(`%${'Q'.repeat(Math.max(0, padTo - length - 2))}\n`, 'latin1');
    chunks.push(pad);
    length += pad.length;
  }

  const xrefOffset = length;
  if (xrefStream) {
    const count = objects.length + 2; // free entry 0, objects 1-5, the stream itself (6)
    const rows = Buffer.alloc(count * 7);
    const writeRow = (row, type, field2, field3) => {
      rows.writeUInt8(type, row * 7);
      rows.writeUInt32BE(field2, row * 7 + 1);
      rows.writeUInt16BE(field3, row * 7 + 5);
    };
    writeRow(0, 0, 0, 0xffff);
    offsets.forEach((offset, index) => writeRow(index + 1, 1, offset, 0));
    writeRow(objects.length + 1, 1, xrefOffset, 0);
    chunks.push(
      Buffer.from(
        `${objects.length + 1} 0 obj\n<< /Type /XRef /Size ${count} /W [1 4 2] /Root 1 0 R /Length ${rows.length} >>\nstream\n`,
        'latin1',
      ),
      rows,
      Buffer.from(`\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`, 'latin1'),
    );
  } else {
    const table = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n'];
    offsets.forEach((offset) => table.push(`${String(offset).padStart(10, '0')} 00000 n \n`));
    table.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
    chunks.push(Buffer.from(table.join(''), 'latin1'));
  }
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------- ZIP -----

/**
 * Minimal ZIP writer with deliberate tampering hooks.
 *
 * @param {Array<{
 *   name: string, data: Buffer | string, method?: 0 | 8, utf8?: boolean,
 *   localName?: string,            // write a DIFFERENT name in the local header
 *   declaredSize?: number,         // lie about the uncompressed size (both headers)
 *   declaredCrc?: number,          // lie about the CRC-32
 *   compressed?: Buffer,           // raw stored bytes instead of real compression
 *   flags?: number,                // extra general-purpose flags (e.g. 1 = encrypted)
 *   dataDescriptor?: boolean,
 * }>} entries
 * @param {object} [options]
 * @param {Buffer} [options.prepend]   bytes before the first entry
 * @param {Buffer} [options.between]   bytes between the entries and the directory
 * @param {Buffer} [options.append]    bytes after the end record
 * @param {string} [options.comment]
 * @param {boolean} [options.overlap]  point the second entry's directory offset at the first entry
 */
export function buildZip(entries, { prepend, between, append, comment = '', overlap = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = prepend ? prepend.length : 0;
  const firstOffset = offset;

  entries.forEach((entry, index) => {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const method = entry.method ?? 8;
    const compressed = entry.compressed ?? (method === 8 ? deflateRawSync(data) : data);
    const crc = entry.declaredCrc ?? crc32(data) >>> 0;
    const size = entry.declaredSize ?? data.length;
    let flags = entry.flags ?? 0;
    if (entry.utf8) flags |= 0x0800;
    if (entry.dataDescriptor) flags |= 0x0008;
    const name = Buffer.from(entry.name, 'utf8');
    const localName = Buffer.from(entry.localName ?? entry.name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(entry.dataDescriptor ? 0 : crc, 14);
    local.writeUInt32LE(entry.dataDescriptor ? 0 : compressed.length, 18);
    local.writeUInt32LE(entry.dataDescriptor ? 0 : size, 22);
    local.writeUInt16LE(localName.length, 26);
    local.writeUInt16LE(0, 28);
    const parts = [local, localName, compressed];
    if (entry.dataDescriptor) {
      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(compressed.length, 8);
      descriptor.writeUInt32LE(size, 12);
      parts.push(descriptor);
    }
    const record = Buffer.concat(parts);
    const headerOffset = overlap && index === 1 ? firstOffset : offset;
    locals.push(record);
    offset += record.length;

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(headerOffset, 42);
    centrals.push(Buffer.concat([central, name]));
  });

  const body = Buffer.concat([...(prepend ? [prepend] : []), ...locals, ...(between ? [between] : [])]);
  const directory = Buffer.concat(centrals);
  const commentBytes = Buffer.from(comment, 'utf8');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(body.length, 16);
  end.writeUInt16LE(commentBytes.length, 20);
  return Buffer.concat([body, directory, end, commentBytes, ...(append ? [append] : [])]);
}

// --------------------------------------------------------------- DOCX -----

export const CONTENT_TYPES = Object.freeze({
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  DOCM: 'application/vnd.ms-word.document.macroEnabled.main+xml',
  DOTX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  VBA: 'application/vnd.ms-office.vbaProject',
});

const OFFICE_DOCUMENT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

export function contentTypesXml({ mainPart = '/word/document.xml', mainType = CONTENT_TYPES.DOCX, extra = '' } = {}) {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    `<Override PartName="${mainPart}" ContentType="${mainType}"/>` +
    extra +
    '</Types>'
  );
}

export function packageRelsXml({ target = 'word/document.xml', type = OFFICE_DOCUMENT_REL, extra = '' } = {}) {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="${type}" Target="${target}"/>` +
    extra +
    '</Relationships>'
  );
}

export function documentXml(text = QA_MARKER) {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
  );
}

/**
 * The entries of a minimal, valid Word package. Tests take them, change
 * exactly one thing, and build with buildZip.
 */
export function docxEntries({ mainType, text } = {}) {
  return [
    { name: '[Content_Types].xml', data: contentTypesXml({ mainType }) },
    { name: '_rels/.rels', data: packageRelsXml() },
    { name: 'word/document.xml', data: documentXml(text) },
  ];
}

export function syntheticDocx(options = {}) {
  return buildZip(docxEntries(options));
}

// -------------------------------------------------------- other formats ---

export const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('synthetic png body for QA'),
]);

/** A DOS/PE header ("MZ") followed by filler: a stand-in executable, never run. */
export const EXECUTABLE_BYTES = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(126, 0x90), Buffer.from('QA-NOT-A-PROGRAM')]);

/** An OLE2 compound-file header: what a legacy .doc (or an encrypted DOCX) begins with. */
export const OLE2_BYTES = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.alloc(504, 0),
]);

/** A valid synthetic PDF of EXACTLY `size` bytes (for the 5 MiB boundary). */
export function syntheticPdfOfSize(size) {
  let padTo = size;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const pdf = syntheticPdf({ padTo });
    if (pdf.length === size) return pdf;
    padTo -= pdf.length - size;
  }
  throw new Error(`could not build a PDF of exactly ${size} bytes`);
}

/**
 * Appends a genuine incremental update (ISO 32000 7.5.6) to a classic-xref
 * PDF: a new Info object, an xref subsection, a trailer with /Prev, a new
 * startxref and %%EOF. Readers use the LAST startxref — as the inspector must.
 */
export function withIncrementalUpdate(pdf) {
  const text = pdf.toString('latin1');
  const previous = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)[1]);
  const size = Number(/\/Size (\d+)/.exec(text)[1]);
  const objectOffset = pdf.length;
  const object = Buffer.from(`${size} 0 obj\n<< /Subject (${QA_MARKER} - incremental update) >>\nendobj\n`, 'latin1');
  const xrefOffset = objectOffset + object.length;
  const update = Buffer.from(
    `xref\n${size} 1\n${String(objectOffset).padStart(10, '0')} 00000 n \n` +
      `trailer\n<< /Size ${size + 1} /Root 1 0 R /Info ${size} 0 R /Prev ${previous} >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    'latin1',
  );
  return Buffer.concat([pdf, object, update]);
}

/**
 * Reads the entries of an ordinary ZIP (such as a real-producer fixture) so
 * a test can change one part and rebuild the package with buildZip — "take
 * the real file, alter exactly this, zip it again normally". Deliberately
 * independent of the code under test (zipInspector.js): a plain walk of the
 * central directory, stored and deflated entries only.
 *
 * @returns {Array<{ name: string, data: Buffer }>} in central-directory order
 */
export function readZipEntries(zip) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd === -1) throw new Error('not a ZIP');
  const count = zip.readUInt16LE(eocd + 10);
  let cursor = zip.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) throw new Error('bad central directory');
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const raw = zip.subarray(dataStart, dataStart + compressedSize);
    entries.push({ name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
