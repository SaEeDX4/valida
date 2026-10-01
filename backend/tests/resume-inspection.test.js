import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { inspectPdf } from '../src/modules/applications/resume/pdfInspector.js';
import { inspectDocx } from '../src/modules/applications/resume/docxInspector.js';
import { readZipDirectory, ZipRejection } from '../src/modules/applications/resume/zipInspector.js';
import { bufferReader, ReadOutOfRangeError } from '../src/modules/applications/resume/byteReader.js';
import { identifySignature } from '../src/modules/applications/resume/fileSignature.js';
import { DOCX_INSPECTION_LIMITS } from '../src/config/resumePolicy.js';
import {
  QA_MARKER, syntheticPdf, withIncrementalUpdate, syntheticDocx, buildZip, docxEntries, contentTypesXml,
  packageRelsXml, CONTENT_TYPES, PNG_BYTES, EXECUTABLE_BYTES, OLE2_BYTES,
} from './fixtures/resumeFiles.js';

/**
 * B4 — content inspection (Doc 09 sections 99-100, Doc 13 sections 62-64 and
 * 76-79, Doc 17 sections 118-120).
 *
 * Unit level, over in-memory buffers: each structural attack is built
 * precisely and must be refused with its specific reason; valid variants
 * must pass. The archive tests also prove the BOUNDS — that a bomb is refused
 * without its data ever being read or decompressed.
 */
const pdf = (buffer) => inspectPdf(bufferReader(buffer));
const docx = (buffer) => inspectDocx(bufferReader(buffer));
const fixture = (name) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'resumes', name));

/** A reader that records every window read. */
function recordingReader(buffer) {
  const reads = [];
  const inner = bufferReader(buffer);
  return {
    size: inner.size,
    reads,
    read(offset, length) {
      reads.push([offset, length]);
      return inner.read(offset, length);
    },
  };
}

describe('PDF structure', () => {
  it.each([
    ['a classic xref table', syntheticPdf()],
    ['a cross-reference stream (PDF 1.5)', syntheticPdf({ xrefStream: true })],
    ['an incremental update (last startxref wins)', withIncrementalUpdate(syntheticPdf())],
    ['PDF 2.0', syntheticPdf({ version: '2.0' })],
    ['CRLF line endings after %%EOF', Buffer.concat([syntheticPdf(), Buffer.from('\r\n\r\n')])],
    ['LibreOffice output', fixture('qa-libreoffice.pdf')],
    ['Chromium print-to-PDF output', fixture('qa-chromium-print.pdf')],
    ['ReportLab output', fixture('qa-reportlab.pdf')],
    ['a linearized PDF with object streams', fixture('qa-qpdf-linearized-objstm.pdf')],
  ])('accepts %s', async (_label, bytes) => {
    expect(await pdf(bytes)).toEqual({ ok: true });
  });

  const valid = syntheticPdf();
  const text = valid.toString('latin1');
  const replaceText = (from, to) => Buffer.from(text.replace(from, to), 'latin1');

  it.each([
    ['a tiny file', Buffer.from('%PDF-1.4\n%%EOF'), 'PDF_TOO_SMALL'],
    ['no header (an executable)', EXECUTABLE_BYTES, 'PDF_HEADER_MISSING'],
    ['a PNG', Buffer.concat([PNG_BYTES, Buffer.alloc(64)]), 'PDF_HEADER_MISSING'],
    ['bytes in front of the header (polyglot)', Buffer.concat([Buffer.from('MZ-QA-PREFIX\n'), valid]), 'PDF_HEADER_MISSING'],
    ['a header with no version', replaceText('%PDF-1.4', '%PDF-x.y'), 'PDF_HEADER_MISSING'],
    ['a truncated file (no %%EOF)', valid.subarray(0, valid.length - 40), 'PDF_EOF_MISSING'],
    ['data appended after %%EOF', Buffer.concat([valid, Buffer.from('<script>QA</script>')]), 'PDF_TRAILING_DATA'],
    ['a ZIP appended after %%EOF', Buffer.concat([valid, syntheticDocx()]), 'PDF_TRAILING_DATA'],
    ['no startxref', replaceText('startxref', 'startxrfe'), 'PDF_STARTXREF_MISSING'],
    ['a startxref offset past the end', replaceText(/startxref\n\d+/, 'startxref\n99999999'), 'PDF_XREF_OFFSET_INVALID'],
    ['a startxref offset inside the header', replaceText(/startxref\n\d+/, 'startxref\n3'), 'PDF_XREF_OFFSET_INVALID'],
    ['a startxref offset that points at nothing', replaceText(/startxref\n\d+/, 'startxref\n20'), 'PDF_XREF_NOT_FOUND'],
  ])('refuses %s', async (_label, bytes, reason) => {
    expect(await pdf(bytes)).toEqual({ ok: false, reason });
  });

  it.each([
    ['a classic table', { padTo: 3 * 1024 * 1024 }],
    ['a cross-reference stream', { padTo: 3 * 1024 * 1024, xrefStream: true }],
  ])('reads only small windows, never the whole document (%s)', async (_label, options) => {
    const big = syntheticPdf(options);
    const reader = recordingReader(big);
    expect(await inspectPdf(reader)).toEqual({ ok: true });
    /*
     * r1 read three windows (1024 + 4096 + 64 bytes). Since review r1
     * (finding 4) the check also walks the cross-reference section and reads
     * the catalog object, so the bound is now: no single read over 4 KiB here,
     * and under 16 KiB in total — about 0.5% of this 3 MiB file.
     */
    expect(reader.reads.every(([, length]) => length <= 4096)).toBe(true);
    const total = reader.reads.reduce((sum, [, length]) => sum + length, 0);
    expect(total).toBeLessThanOrEqual(16 * 1024);
  });
});

describe('DOCX package structure', () => {
  it.each([
    ['the synthetic package', syntheticDocx()],
    ['stored (uncompressed) entries', buildZip(docxEntries().map((entry) => ({ ...entry, method: 0 })))],
    ['data descriptors', buildZip(docxEntries().map((entry) => ({ ...entry, dataDescriptor: true })))],
    ['UTF-8 flagged names', buildZip(docxEntries().map((entry) => ({ ...entry, utf8: true })))],
    ['an absolute relationship target', buildZip([docxEntries()[0], { name: '_rels/.rels', data: packageRelsXml({ target: '/word/document.xml' }) }, docxEntries()[2]])],
    ['a strict-OOXML relationship type', buildZip([docxEntries()[0], { name: '_rels/.rels', data: packageRelsXml({ type: 'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument' }) }, docxEntries()[2]])],
    ['a main part with a non-standard name', buildZip([
      { name: '[Content_Types].xml', data: contentTypesXml({ mainPart: '/word/document2.xml' }) },
      { name: '_rels/.rels', data: packageRelsXml({ target: 'word/document2.xml' }) },
      { name: 'word/document2.xml', data: docxEntries()[2].data },
    ])],
    ['a UTF-8 BOM in the content types', buildZip([{ name: '[Content_Types].xml', data: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(contentTypesXml())]) }, ...docxEntries().slice(1)])],
    ['a ZIP comment', buildZip(docxEntries(), { comment: 'QA comment' })],
    ['LibreOffice output', fixture('qa-libreoffice.docx')],
    ['pandoc output', fixture('qa-pandoc.docx')],
    ['python-docx output', fixture('qa-python-docx.docx')],
  ])('accepts %s', async (_label, bytes) => {
    expect(await docx(bytes)).toEqual({ ok: true });
  });

  const [types, rels, document] = docxEntries();
  const withEntries = (...entries) => buildZip(entries);

  it.each([
    ['an arbitrary ZIP', buildZip([{ name: 'readme.txt', data: QA_MARKER }]), 'DOCX_CONTENT_TYPES_MISSING'],
    ['no package relationships', withEntries(types, document), 'DOCX_RELATIONSHIPS_MISSING'],
    ['no main document part', withEntries(types, rels), 'DOCX_MAIN_DOCUMENT_MISSING'],
    ['an empty main document part', withEntries(types, rels, { name: 'word/document.xml', data: '' }), 'DOCX_MAIN_DOCUMENT_EMPTY'],
    ['no officeDocument relationship', withEntries(types, { name: '_rels/.rels', data: packageRelsXml({ type: 'http://example.invalid/other' }) }, document), 'DOCX_MAIN_DOCUMENT_RELATIONSHIP'],
    ['two officeDocument relationships', withEntries(types, { name: '_rels/.rels', data: packageRelsXml({ extra: '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' }) }, document), 'DOCX_MAIN_DOCUMENT_RELATIONSHIP'],
    ['an external main document', withEntries(types, { name: '_rels/.rels', data: packageRelsXml().replace('Target="word/document.xml"', 'Target="https://example.invalid/x.xml" TargetMode="External"') }, document), 'DOCX_MAIN_DOCUMENT_RELATIONSHIP'],
    ['a main document target escaping the package', withEntries(types, { name: '_rels/.rels', data: packageRelsXml({ target: '../../word/document.xml' }) }, document), 'DOCX_MAIN_DOCUMENT_INVALID'],
    ['a main document target with a scheme', withEntries(types, { name: '_rels/.rels', data: packageRelsXml({ target: 'file:///etc/passwd' }) }, document), 'DOCX_MAIN_DOCUMENT_INVALID'],
    ['the macro-enabled main content type (.docm)', buildZip(docxEntries({ mainType: CONTENT_TYPES.DOCM })), 'DOCX_MACRO_ENABLED'],
    ['the template main content type (.dotx)', buildZip(docxEntries({ mainType: CONTENT_TYPES.DOTX })), 'DOCX_TEMPLATE'],
    ['a spreadsheet main content type', buildZip(docxEntries({ mainType: CONTENT_TYPES.XLSX })), 'DOCX_NOT_WORD_DOCUMENT'],
    ['a VBA project part by name', withEntries(types, rels, document, { name: 'word/vbaProject.bin', data: 'QA' }), 'DOCX_MACRO_CONTENT'],
    ['a VBA project by content type', withEntries({ name: '[Content_Types].xml', data: contentTypesXml({ extra: `<Override PartName="/word/other.bin" ContentType="${CONTENT_TYPES.VBA}"/>` }) }, rels, document), 'DOCX_MACRO_CONTENT'],
    ['a DOCTYPE in the content types (entity expansion attempt)', withEntries({ name: '[Content_Types].xml', data: '<?xml version="1.0"?><!DOCTYPE Types [<!ENTITY qa "QA">]>' + contentTypesXml().replace(/^<\?xml[^>]*\?>\n/, '') }, rels, document), 'DOCX_XML_DTD'],
    ['content types that are not valid UTF-8', withEntries({ name: '[Content_Types].xml', data: Buffer.from([0x3c, 0xff, 0xfe, 0xfd]) }, rels, document), 'DOCX_XML_INVALID'],
    ['content types without the OPC namespace', withEntries({ name: '[Content_Types].xml', data: contentTypesXml().replace('http://schemas.openxmlformats.org/package/2006/content-types', 'http://example.invalid/ns') }, rels, document), 'DOCX_PACKAGE_INVALID'],
    ['an unknown XML entity', withEntries({ name: '[Content_Types].xml', data: contentTypesXml().replace('ContentType="application/xml"', 'ContentType="&qa;"') }, rels, document), 'DOCX_XML_INVALID'],
    ['a duplicated attribute', withEntries({ name: '[Content_Types].xml', data: contentTypesXml().replace('Extension="xml"', 'Extension="xml" Extension="bin"') }, rels, document), 'DOCX_XML_INVALID'],
    ['an ODF document', fixture('qa-pandoc.odt'), 'DOCX_CONTENT_TYPES_MISSING'],
    ['a LibreOffice .docm', fixture('qa-libreoffice-macro-format.docm'), 'DOCX_MACRO_ENABLED'],
    ['a LibreOffice .dotx', fixture('qa-libreoffice-template.dotx'), 'DOCX_TEMPLATE'],
    ['a LibreOffice .xlsx', fixture('qa-libreoffice-sheet.xlsx'), 'DOCX_NOT_WORD_DOCUMENT'],
    ['a legacy .doc (OLE2)', fixture('qa-libreoffice-legacy.doc'), 'ZIP_END_RECORD_MISSING'],
    ['an OLE2 header (encrypted Office)', OLE2_BYTES, 'ZIP_END_RECORD_MISSING'],
    ['an executable', EXECUTABLE_BYTES, 'ZIP_END_RECORD_MISSING'],
    ['a PDF', syntheticPdf(), 'ZIP_END_RECORD_MISSING'],
  ])('refuses %s', async (_label, bytes, reason) => {
    expect(await docx(bytes)).toEqual({ ok: false, reason });
  });
});

describe('XML scanning runs in linear time (CPU denial-of-service regression, found in review)', () => {
  const RUN = 255_000; // fits under the 256 KiB inspection cap
  const [types, rels, document] = docxEntries();
  const timed = async (bytes) => {
    const started = performance.now();
    const result = await docx(bytes);
    return { result, ms: performance.now() - started };
  };

  it.each([
    ['a 255,000-letter attribute name in [Content_Types].xml', () => [
      { name: '[Content_Types].xml', method: 0, data: contentTypesXml({ extra: `<Default ${'a'.repeat(RUN)}/>` }) }, rels, document]],
    ['a 255,000-letter attribute name in _rels/.rels', () => [
      types, { name: '_rels/.rels', method: 0, data: packageRelsXml({ extra: `<Relationship ${'a'.repeat(RUN)}/>` }) }, document]],
    ['255,000 characters of attribute-like text without "="', () => [
      { name: '[Content_Types].xml', method: 0, data: contentTypesXml({ extra: `<Override ${'a:b.c-'.repeat(RUN / 6)}/>` }) }, rels, document]],
    ['a very long, otherwise valid attribute value', () => [
      { name: '[Content_Types].xml', method: 0, data: contentTypesXml({ extra: `<Default Extension="x" ContentType="${'a'.repeat(RUN)}"/>` }) }, rels, document]],
  ])('refuses %s quickly (stored, so no compression limit applies)', async (_label, build) => {
    const { result, ms } = await timed(buildZip(build()));
    expect(result).toEqual({ ok: false, reason: 'DOCX_XML_INVALID' });
    // The quadratic scan took ~34 s on the first case; linear takes a few ms.
    expect(ms).toBeLessThan(1500);
  });

  it('still reads ordinary attributes in any order, quoting style and spacing', async () => {
    const xml = contentTypesXml().replace(
      '<Default Extension="xml" ContentType="application/xml"/>',
      "<Default\n   ContentType='application/xml'\tExtension = \"xml\" />",
    );
    expect(await docx(buildZip([{ name: '[Content_Types].xml', data: xml }, rels, document]))).toEqual({ ok: true });
  });

  it('refuses stray text inside a tag', async () => {
    const xml = contentTypesXml().replace('<Default Extension="xml"', '<Default junk Extension="xml"');
    expect(await docx(buildZip([{ name: '[Content_Types].xml', data: xml }, rels, document]))).toEqual({ ok: false, reason: 'DOCX_XML_INVALID' });
  });
});

describe('ZIP container: strict and unambiguous (Doc 13 sections 77-79)', () => {
  const entries = () => docxEntries();

  it.each([
    ['data in front of the archive (self-extractor / polyglot)', buildZip(entries(), { prepend: Buffer.from('MZ-QA-PREFIX') }), 'ZIP_UNREFERENCED_DATA'],
    ['data hidden between the entries and the directory', buildZip(entries(), { between: Buffer.from('QA-HIDDEN-PAYLOAD') }), 'ZIP_UNREFERENCED_DATA'],
    ['data after the end record', buildZip(entries(), { append: Buffer.from('QA-TRAILER') }), 'ZIP_END_RECORD_MISSING'],
    ['overlapping entries (the "better zip bomb")', buildZip(entries(), { overlap: true }), 'ZIP_ENTRIES_OVERLAP'],
    ['a local name different from the directory name', buildZip([{ ...entries()[0], localName: '[Content_Types].xmX' }, ...entries().slice(1)]), 'ZIP_HEADER_MISMATCH'],
    ['an encrypted entry', buildZip([{ ...entries()[0], flags: 0x0001 }, ...entries().slice(1)]), 'ZIP_ENCRYPTED'],
    ['an unsupported compression method (bzip2)', buildZip([{ ...entries()[0], method: 12, compressed: Buffer.from('QA') }, ...entries().slice(1)]), 'ZIP_UNSUPPORTED_COMPRESSION'],
    ['a stored entry whose sizes disagree', buildZip([{ ...entries()[0], method: 0, declaredSize: 5 }, ...entries().slice(1)]), 'ZIP_SIZE_INCONSISTENT'],
    ['duplicate entry names', buildZip([...entries(), { ...entries()[2] }]), 'ZIP_DUPLICATE_ENTRY'],
    ['entry names differing only in case', buildZip([...entries(), { name: 'WORD/DOCUMENT.XML', data: 'x' }]), 'ZIP_DUPLICATE_ENTRY'],
    ['an empty archive', buildZip([]), 'ZIP_EMPTY'],
  ])('refuses %s', async (_label, bytes, reason) => {
    expect(await docx(bytes)).toEqual({ ok: false, reason });
  });

  it.each([
    ['../evil.xml'],
    ['word/../../evil.xml'],
    ['/etc/passwd'],
    ['C:/Windows/evil.xml'],
    ['word\\..\\evil.xml'],
    ['word/./document.xml'],
    ['word//document.xml'],
    ['nul\u0000byte.xml'],
    ['line\nbreak.xml'],
  ])('refuses the unsafe entry name %j (path traversal is never followed — nothing is extracted)', async (name) => {
    const bytes = buildZip([...entries(), { name, data: 'QA' }]);
    expect(await docx(bytes)).toEqual({ ok: false, reason: 'ZIP_ENTRY_PATH_UNSAFE' });
  });

  it('refuses a ZIP64 end-of-directory marker', async () => {
    const bytes = syntheticDocx();
    const eocd = bytes.length - 22;
    const tampered = Buffer.from(bytes);
    tampered.writeUInt16LE(0xffff, eocd + 10);
    tampered.writeUInt16LE(0xffff, eocd + 8);
    expect(await docx(tampered)).toEqual({ ok: false, reason: 'ZIP64_UNSUPPORTED' });
  });

  it('refuses a multi-disk archive', async () => {
    const tampered = Buffer.from(syntheticDocx());
    tampered.writeUInt16LE(1, tampered.length - 22 + 4);
    expect(await docx(tampered)).toEqual({ ok: false, reason: 'ZIP_MULTI_DISK' });
  });

  it('never reads outside the file even when every offset lies', async () => {
    const tampered = Buffer.from(syntheticDocx());
    // Central directory offset pointing past the end of the file.
    tampered.writeUInt32LE(0x7fffffff, tampered.length - 22 + 16);
    const result = await docx(tampered);
    expect(result.ok).toBe(false);
  });
});

describe('archive bombs are refused before anything is decompressed (Doc 13 section 78)', () => {
  it(`refuses more than ${DOCX_INSPECTION_LIMITS.maxEntries} entries`, async () => {
    const many = Array.from({ length: DOCX_INSPECTION_LIMITS.maxEntries + 1 }, (_unused, index) => ({ name: `f/${index}.xml`, data: 'x', method: 0 }));
    expect(await docx(buildZip(many))).toEqual({ ok: false, reason: 'ZIP_TOO_MANY_ENTRIES' });
  });

  it('accepts exactly the entry limit (the bound is not off by one)', async () => {
    const filler = Array.from({ length: DOCX_INSPECTION_LIMITS.maxEntries - 3 }, (_unused, index) => ({ name: `word/media/f${index}.bin`, data: 'x', method: 0 }));
    expect(await docx(buildZip([...docxEntries(), ...filler]))).toEqual({ ok: true });
  });

  it('refuses a highly compressed entry (50 MiB of zeros in ~50 KiB) without ever reading its data', async () => {
    const zeros = Buffer.alloc(50 * 1024 * 1024);
    const compressed = deflateRawSync(zeros, { level: 9 });
    expect(compressed.length).toBeLessThan(100 * 1024);
    const bytes = buildZip([...docxEntries(), { name: 'word/media/bomb.bin', data: zeros, compressed }]);
    const reader = recordingReader(bytes);
    expect(await inspectDocx(reader)).toEqual({ ok: false, reason: 'ZIP_COMPRESSION_RATIO' });
    // The bomb's compressed data was never requested, and everything read is
    // bounded by the fixed directory windows (end-record search <= 64 KiB +
    // 22 B, the directory, and 30 B + name per local header).
    expect(reader.reads.some(([, length]) => length === compressed.length)).toBe(false);
    const total = reader.reads.reduce((sum, [, length]) => sum + length, 0);
    expect(total).toBeLessThan(65_557 + 4 * 1024);
  });

  it('refuses a compression ratio over 100:1 even when the total is small', async () => {
    const data = Buffer.alloc(2 * 1024 * 1024); // 2 MiB of zeros
    const compressed = deflateRawSync(data, { level: 9 });
    expect(data.length / compressed.length).toBeGreaterThan(100);
    const bytes = buildZip([...docxEntries(), { name: 'word/media/dense.bin', data, compressed }]);
    expect(await docx(bytes)).toEqual({ ok: false, reason: 'ZIP_COMPRESSION_RATIO' });
  });

  it('refuses a total declared size over the limit even when each ratio looks normal', async () => {
    // Four entries declaring 30 MiB each over 400 KiB of stored-random bytes:
    // ratio 75:1, total 120 MiB. They are never inflated.
    const filler = Array.from({ length: 4 }, (_unused, index) => ({
      name: `word/media/big${index}.bin`,
      data: Buffer.alloc(0),
      compressed: Buffer.alloc(400 * 1024, index + 1),
      declaredSize: 30 * 1024 * 1024,
      declaredCrc: 0,
    }));
    expect(await docx(buildZip([...docxEntries(), ...filler]))).toEqual({ ok: false, reason: 'ZIP_UNCOMPRESSED_TOO_LARGE' });
  });

  it('refuses an inspected part that inflates to more than it declares (lying header): inflation is capped', async () => {
    const huge = Buffer.alloc(8 * 1024 * 1024, 0x20); // would inflate to 8 MiB
    const [types, rels, document] = docxEntries();
    const lying = { ...types, data: Buffer.from(types.data), compressed: deflateRawSync(huge), declaredSize: Buffer.byteLength(types.data) };
    const started = process.memoryUsage().arrayBuffers;
    expect(await docx(buildZip([lying, rels, document]))).toEqual({ ok: false, reason: 'ZIP_PART_CORRUPT' });
    // zlib stopped at the declared size: nowhere near 8 MiB was allocated.
    expect(process.memoryUsage().arrayBuffers - started).toBeLessThan(8 * 1024 * 1024);
  });

  it('refuses an inspected part whose declared size exceeds the inspection cap, without inflating it', async () => {
    const [types, rels, document] = docxEntries();
    // Incompressible padding, so the size cap — not the ratio check — decides.
    const noise = randomBytes(DOCX_INSPECTION_LIMITS.maxInspectedPartBytes).toString('base64');
    const padded = contentTypesXml({ extra: `<!-- ${noise} -->` });
    expect(await docx(buildZip([{ ...types, data: padded }, rels, document]))).toEqual({ ok: false, reason: 'ZIP_PART_TOO_LARGE' });
  });

  it('refuses a CRC-32 mismatch in an inspected part', async () => {
    const [types, rels, document] = docxEntries();
    const bytes = buildZip([{ ...types, declaredCrc: (crc32(Buffer.from(types.data)) + 1) >>> 0 }, rels, document]);
    expect(await docx(bytes)).toEqual({ ok: false, reason: 'ZIP_PART_CRC_MISMATCH' });
  });

  it('refuses corrupt deflate data in an inspected part', async () => {
    const [types, rels, document] = docxEntries();
    const bytes = buildZip([{ ...types, compressed: Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff]) }, rels, document]);
    expect(await docx(bytes)).toEqual({ ok: false, reason: 'ZIP_PART_CORRUPT' });
  });

  it('readZipDirectory throws only ZipRejection for hostile input', async () => {
    await expect(readZipDirectory(bufferReader(Buffer.alloc(10)))).rejects.toBeInstanceOf(ZipRejection);
  });
});

describe('bounded readers', () => {
  it('refuse any window outside the file', async () => {
    const reader = bufferReader(Buffer.alloc(10));
    await expect(reader.read(5, 6)).rejects.toBeInstanceOf(ReadOutOfRangeError);
    await expect(reader.read(-1, 1)).rejects.toBeInstanceOf(ReadOutOfRangeError);
    await expect(reader.read(0, Number.MAX_SAFE_INTEGER)).rejects.toBeInstanceOf(ReadOutOfRangeError);
    expect((await reader.read(0, 10)).length).toBe(10);
  });
});

describe('signature identification (for the log only)', () => {
  it.each([
    [syntheticPdf(), 'PDF'],
    [syntheticDocx(), 'ZIP'],
    [OLE2_BYTES, 'OLE2_COMPOUND'],
    [PNG_BYTES, 'PNG'],
    [Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'JPEG'],
    [EXECUTABLE_BYTES, 'PE_EXECUTABLE'],
    [Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2]), 'ELF_EXECUTABLE'],
    [Buffer.from('#!/bin/sh\n'), 'SCRIPT'],
    [Buffer.from('<!DOCTYPE html><html>'), 'MARKUP'],
    [Buffer.from('{\\rtf1 QA'), 'RTF'],
    [Buffer.alloc(0), 'EMPTY'],
    [Buffer.from('plain text'), 'UNKNOWN'],
  ])('%#', (bytes, expected) => {
    expect(identifySignature(bytes.subarray(0, 16))).toBe(expected);
  });
});
