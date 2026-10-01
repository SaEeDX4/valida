import { constants as zlibConstants, deflateSync } from 'node:zlib';
import { QA_MARKER } from './resumeFiles.js';

/**
 * A small writer of SYNTHETIC PDFs for the B4 structure tests (review r1,
 * finding 4): classic cross-reference tables, cross-reference streams
 * (uncompressed, FlateDecode, FlateDecode with the PNG Up predictor),
 * compressed catalogs in object streams, and hybrid-reference files — each
 * with a hook to change exactly one thing for a negative case. Every document
 * states that it is a QA test document; no real content is used. The valid
 * outputs pass `qpdf --check`.
 */
const latin1 = (text) => Buffer.from(text, 'latin1');

export const CATALOG_BODY = '<< /Type /Catalog /Pages 2 0 R >>';
export const PAGES_BODY = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
export const PAGE_BODY = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>';
const contentStream = `BT /F1 12 Tf 72 720 Td (${QA_MARKER}) Tj ET`;
export const CONTENT_BODY = `<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`;
export const PDF_OBJECT_BODIES = Object.freeze([CATALOG_BODY, PAGES_BODY, PAGE_BODY, CONTENT_BODY]);

/**
 * Writes objects 1..n (a null body writes nothing for that number — it is
 * then compressed elsewhere), returning the text and each object's offset.
 */
export function writeObjects(bodies, version = '1.4') {
  let text = `%PDF-${version}\n%\xe2\xe3\xcf\xd3\n`;
  const offsets = [];
  bodies.forEach((body, index) => {
    offsets.push(body === null ? null : text.length);
    if (body !== null) text += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  return { text, offsets };
}

export const xrefEntry = (offset, generation = 0, type = 'n', eol = ' \n') =>
  `${String(offset).padStart(10, '0')} ${String(generation).padStart(5, '0')} ${type}${eol}`;

/**
 * A classic-xref PDF. Options change exactly one thing for a negative case.
 */
export function classicPdf({
  bodies = PDF_OBJECT_BODIES, eol = ' \n', trailer, root = '1 0 R', table, offsets: offsetOverride, after = '',
} = {}) {
  const { text, offsets: real } = writeObjects(bodies);
  const offsets = offsetOverride ?? real;
  const xrefOffset = text.length;
  const rows = table ?? `xref\n0 ${bodies.length + 1}\n${xrefEntry(0, 65535, 'f', eol)}${offsets.map((o) => xrefEntry(o, 0, 'n', eol)).join('')}`;
  const trailerText = trailer ?? `trailer\n<< /Size ${bodies.length + 1} /Root ${root} >>\n`;
  return latin1(`${text}${rows}${trailerText}${after}startxref\n${xrefOffset}\n%%EOF\n`);
}

/** Big-endian row bytes for a cross-reference stream with W [1 4 2]. */
function xrefRows(rows) {
  const buffer = Buffer.alloc(rows.length * 7);
  rows.forEach(([type, second, third], index) => {
    buffer.writeUInt8(type, index * 7);
    buffer.writeUInt32BE(second, index * 7 + 1);
    buffer.writeUInt16BE(third, index * 7 + 5);
  });
  return buffer;
}

/** PNG "Up" predictor encoding (Predictor 12), as producers write it. */
function pngUp(rows, width = 7) {
  const out = Buffer.alloc((rows.length / width) * (width + 1));
  for (let row = 0; row < rows.length / width; row += 1) {
    out[row * (width + 1)] = 2;
    for (let column = 0; column < width; column += 1) {
      const above = row > 0 ? rows[(row - 1) * width + column] : 0;
      out[row * (width + 1) + 1 + column] = (rows[row * width + column] - above) & 0xff;
    }
  }
  return out;
}

/**
 * A cross-reference-stream PDF (PDF 1.5). By default FlateDecode with a PNG
 * Up predictor, like pdfTeX, qpdf or Acrobat output. `compressCatalog` puts
 * the catalog into an object stream (entry type 2).
 */
export function streamPdf({ encoding = 'flate-png', compressCatalog = false, dictionary = {}, mutateData, truncateZlib = false } = {}) {
  let bodies;
  if (compressCatalog) {
    // Object 1 (the catalog) lives in object stream 5.
    const inside = `1 0 ${CATALOG_BODY}`;
    const header = '1 0 ';
    const objectStream = `<< /Type /ObjStm /N 1 /First ${header.length} /Length ${inside.length} >>\nstream\n${inside}\nendstream`;
    bodies = [null, PAGES_BODY, PAGE_BODY, CONTENT_BODY, objectStream];
  } else {
    bodies = [...PDF_OBJECT_BODIES];
  }
  const { text, offsets } = writeObjects(bodies, '1.5');
  const xrefNumber = bodies.length + 1;
  const xrefOffset = text.length;
  const rows = [[0, 0, 0xffff]];
  offsets.forEach((offset, index) => rows.push(compressCatalog && index === 0 ? [2, 5, 0] : [1, offset, 0]));
  rows.push([1, xrefOffset, 0]);
  const raw = xrefRows(rows);
  let data;
  const fields = { Type: '/XRef', Size: String(rows.length), W: '[1 4 2]', Root: '1 0 R', ...dictionary };
  if (encoding === 'none') {
    data = raw;
  } else {
    const encoded = encoding === 'flate-png' ? pngUp(raw) : raw;
    data = deflateSync(encoded, truncateZlib ? { finishFlush: zlibConstants.Z_SYNC_FLUSH } : {});
    fields.Filter ??= '/FlateDecode';
    if (encoding === 'flate-png') fields.DecodeParms ??= '<< /Predictor 12 /Columns 7 >>';
  }
  if (mutateData) data = mutateData(data);
  fields.Length ??= String(data.length);
  const dict = Object.entries(fields).filter(([, value]) => value !== undefined).map(([key, value]) => `/${key} ${value}`).join(' ');
  return Buffer.concat([
    latin1(`${text}${xrefNumber} 0 obj\n<< ${dict} >>\nstream\n`),
    data,
    latin1(`\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`),
  ]);
}

/**
 * A HYBRID-reference file (ISO 32000-2, 7.5.8.4), as Microsoft Word writes
 * them: a classic table for the ordinary objects, and a trailer /XRefStm
 * pointing at a cross-reference stream that lists the compressed catalog.
 * `catalogInTable`: 'omitted' leaves object 1 out of the table (what readers
 * agree on); 'free' marks it free there as well — readers then DISAGREE
 * (Poppler and pdf.js take the table, qpdf the stream), a negative case.
 */
export function hybridPdf({ catalogInTable = 'free' } = {}) {
  const inside = `1 0 ${CATALOG_BODY}`;
  const objectStream = `<< /Type /ObjStm /N 1 /First 4 /Length ${inside.length} >>\nstream\n${inside}\nendstream`;
  const bodies = [null, PAGES_BODY, PAGE_BODY, CONTENT_BODY, objectStream];
  const { text: objectsText, offsets } = writeObjects(bodies, '1.5');
  // The cross-reference stream (object 6) for the compressed catalog.
  const xrefStreamOffset = objectsText.length;
  const raw = xrefRows([[2, 5, 0]]);
  const xrefStream = `6 0 obj\n<< /Type /XRef /Size 7 /W [1 4 2] /Index [1 1] /Length ${raw.length} >>\nstream\n`;
  const head = Buffer.concat([latin1(objectsText + xrefStream), raw, latin1('\nendstream\nendobj\n')]);
  const tableOffset = head.length;
  const tableRows = catalogInTable === 'free'
    ? `xref\n0 7\n${xrefEntry(0, 65535, 'f')}${xrefEntry(0, 65535, 'f')}${offsets.slice(1).map((o) => xrefEntry(o)).join('')}${xrefEntry(xrefStreamOffset)}`
    : `xref\n0 1\n${xrefEntry(0, 65535, 'f')}2 5\n${offsets.slice(1).map((o) => xrefEntry(o)).join('')}${xrefEntry(xrefStreamOffset)}`;
  return Buffer.concat([
    head,
    latin1(`${tableRows}trailer\n<< /Size 7 /Root 1 0 R /XRefStm ${xrefStreamOffset} >>\nstartxref\n${tableOffset}\n%%EOF\n`),
  ]);
}
