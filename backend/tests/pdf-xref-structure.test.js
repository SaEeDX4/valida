import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { deflateSync } from 'node:zlib';
import { inspectPdf, PDF_INSPECTION_LIMITS } from '../src/modules/applications/resume/pdfInspector.js';
import { bufferReader } from '../src/modules/applications/resume/byteReader.js';
import { capturingLogger } from './helpers.js';
import { QA_MARKER, PDF_MIME, syntheticPdf, withIncrementalUpdate } from './fixtures/resumeFiles.js';
import {
  CATALOG_BODY, PAGES_BODY, PAGE_BODY, CONTENT_BODY, PDF_OBJECT_BODIES, writeObjects, xrefEntry as entry,
  classicPdf, streamPdf, hybridPdf,
} from './fixtures/pdfBuilder.js';
import { INTAKE_PATH, buildIntakeApp, createIntakeEnvironment } from './fixtures/uploadHarness.js';

/**
 * B4 review r1, FINDING 4 — a PDF must have a real cross-reference structure
 * linked to its document catalog.
 *
 * r1 accepted `%PDF-1.7\nxref\nNOT_A_PDF\nstartxref\n9\n%%EOF\n` (and any
 * `1 0 obj` at the startxref offset) because it checked only the first token
 * there. These cases prove the check now establishes, within fixed bounds:
 * a well-formed cross-reference table with its trailer, or a genuine
 * cross-reference stream; and the /Root linkage to an in-use catalog object
 * (or, for a compressed catalog, to an in-use object stream). Valid classic,
 * stream, hybrid, incremental and compressed-catalog files keep passing (the
 * real-producer fixtures are in resume-inspection.test.js and
 * resume-intake-http.test.js), and passing is never a malware verdict.
 *
 * Every file here is synthetic, built by tests/fixtures/pdfBuilder.js; the
 * positive ones were also checked with `qpdf --check` (recorded in the
 * review report).
 */
const pdf = (bytes) => inspectPdf(bufferReader(bytes));
const latin1 = (text) => Buffer.from(text, 'latin1');

describe('the review reproduction and marker-only garbage', () => {
  it('the exact review bytes are refused', async () => {
    expect(await pdf(Buffer.from('%PDF-1.7\nxref\nNOT_A_PDF\nstartxref\n9\n%%EOF\n', 'utf8'))).toEqual({ ok: false, reason: 'PDF_XREF_INVALID' });
  });

  it.each([
    ['an "xref" keyword with no subsections, straight to a trailer', '%PDF-1.7\nxref\ntrailer\n<< /Size 1 >>\nstartxref\n9\n%%EOF\n', 'PDF_TRAILER_INVALID'],
    ['a subsection header with no entries behind it', '%PDF-1.7\nxref\n0 3\nstartxref\n9\n%%EOF\n', 'PDF_XREF_INVALID'],
    ['one entry and no trailer', `%PDF-1.7\nxref\n0 1\n${entry(0, 65535, 'f')}startxref\n9\n%%EOF\n`, 'PDF_XREF_INVALID'],
    ['a trailer without /Root', `%PDF-1.7\nxref\n0 1\n${entry(0, 65535, 'f')}trailer\n<< /Size 1 >>\nstartxref\n9\n%%EOF\n`, 'PDF_TRAILER_INVALID'],
    ['a trailer whose /Root has no entry', `%PDF-1.7\nxref\n0 1\n${entry(0, 65535, 'f')}trailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n9\n%%EOF\n`, 'PDF_ROOT_MISSING'],
  ])('%s', async (_label, text, reason) => {
    expect(await pdf(latin1(text))).toEqual({ ok: false, reason });
  });
});

describe('arbitrary objects cannot pose as a cross-reference stream', () => {
  it.each([
    ['an ordinary object at the offset', '%PDF-1.7\n1 0 obj\n<< /Foo /Bar >>\nendobj\nstartxref\n9\n%%EOF\n'],
    ['an object that is not a dictionary', '%PDF-1.7\n1 0 obj\n(QA not a dictionary)\nendobj\nstartxref\n9\n%%EOF\n'],
    ['a /Type /XRef dictionary with nothing else', '%PDF-1.7\n1 0 obj\n<< /Type /XRef >>\nendobj\nstartxref\n9\n%%EOF\n'],
    ['/Type /XRef with /Size and /W but no stream', '%PDF-1.7\n1 0 obj\n<< /Type /XRef /Size 2 /W [1 4 2] /Root 1 0 R /Length 7 >>\nendobj\nstartxref\n9\n%%EOF\n'],
  ])('%s', async (_label, text) => {
    expect(await pdf(latin1(text))).toEqual({ ok: false, reason: 'PDF_XREF_STREAM_INVALID' });
  });

  it.each([
    ['/Length that does not end at "endstream"', { dictionary: { Length: '3' } }, 'PDF_XREF_STREAM_INVALID'],
    // Uncompressed: the 42 row bytes plus 5 more still decode, so only the "endstream" check refuses it.
    ['/Length running past "endstream"', { encoding: 'none', dictionary: { Length: '47' } }, 'PDF_XREF_STREAM_INVALID'],
    ['an invalid /W', { dictionary: { W: '[1 0 2]' } }, 'PDF_XREF_STREAM_INVALID'],
    ['corrupt compressed data', { mutateData: (data) => Buffer.concat([data.subarray(0, 2), Buffer.alloc(data.length - 2, 0xff)]) }, 'PDF_XREF_STREAM_INVALID'],
    ['too few rows for the declared entries', { dictionary: { Size: '40' } }, 'PDF_XREF_STREAM_INVALID'],
    ['an unsupported filter', { dictionary: { Filter: '/LZWDecode' } }, 'PDF_XREF_STREAM_UNSUPPORTED'],
    ['a /Size far beyond any real file (decompression bound)', { dictionary: { Size: '2000000' } }, 'PDF_XREF_TOO_LARGE'],
    ['a /Root to an object it does not list', { dictionary: { Index: '[0 5]', Root: '5 0 R' } }, 'PDF_ROOT_MISSING'],
    ['a /Type other than /XRef', { dictionary: { Type: '/ObjStm' } }, 'PDF_XREF_STREAM_INVALID'],
  ])('a cross-reference stream with %s is refused', async (_label, options, reason) => {
    expect(await pdf(streamPdf(options))).toEqual({ ok: false, reason });
  });
});

describe('the cross-reference table must be well formed', () => {
  const valid = classicPdf();
  const text = valid.toString('latin1');

  it.each([
    // Object 3's entry — not the catalog's — so only validating EVERY entry catches it.
    ['a malformed entry', () => {
      const { offsets } = writeObjects(PDF_OBJECT_BODIES);
      return latin1(text.replace(entry(offsets[2]), '00000000x9 00000 n \n'));
    }, 'PDF_XREF_INVALID'],
    ['entries of mixed widths in one subsection', () => latin1(text.replace(/(0000000000 65535 f \n\d{10} 00000 n) \n/, '$1\n')), 'PDF_XREF_INVALID'],
    ['a subsection claiming more entries than it has', () => latin1(text.replace('xref\n0 5', 'xref\n0 9')), 'PDF_XREF_INVALID'],
    ['overlapping subsections', () => classicPdf({ table: `xref\n0 3\n${entry(0, 65535, 'f')}${entry(15)}${entry(60)}2 1\n${entry(60)}` }), 'PDF_XREF_INVALID'],
    ['an unterminated trailer dictionary', () => latin1(text.replace(/trailer\n<<([^>]*)>>/, 'trailer\n<<$1')), 'PDF_TRAILER_INVALID'],
    ['a trailer that repeats /Root', () => classicPdf({ trailer: 'trailer\n<< /Size 5 /Root 3 0 R /Root 1 0 R >>\n' }), 'PDF_TRAILER_INVALID'],
    ['a /Root beyond /Size', () => classicPdf({ trailer: 'trailer\n<< /Size 1 /Root 1 0 R >>\n' }), 'PDF_TRAILER_INVALID'],
  ])('%s', async (_label, build, reason) => {
    expect(await pdf(build())).toEqual({ ok: false, reason });
  });
});

describe('/Root must lead to the document catalog', () => {
  it.each([
    ['a /Root marked free', () => classicPdf({ table: `xref\n0 5\n${entry(0, 65535, 'f')}${entry(0, 1, 'f')}${entry(60)}${entry(120)}${entry(200)}` }), 'PDF_ROOT_MISSING'],
    ['a /Root entry pointing into the middle of an object', () => {
      const { offsets } = writeObjects(PDF_OBJECT_BODIES);
      return classicPdf({ offsets: [offsets[0] + 4, ...offsets.slice(1)] });
    }, 'PDF_ROOT_INVALID'],
    ['a /Root entry pointing into the header', () => {
      const { offsets } = writeObjects(PDF_OBJECT_BODIES);
      return classicPdf({ offsets: [3, ...offsets.slice(1)] });
    }, 'PDF_ROOT_INVALID'],
    // Object 5 is a second catalog: only the object-number check refuses this.
    ['a /Root entry pointing at a different object (even another catalog)', () => {
      const bodies = [...PDF_OBJECT_BODIES, CATALOG_BODY];
      const { offsets } = writeObjects(bodies);
      return classicPdf({ bodies, offsets: [offsets[4], ...offsets.slice(1)] });
    }, 'PDF_ROOT_INVALID'],
    ['a /Root that is not a catalog', () => classicPdf({ root: '3 0 R' }), 'PDF_ROOT_INVALID'],
    ['a /Root with the wrong generation', () => classicPdf({ root: '1 4 R' }), 'PDF_ROOT_INVALID'],
    ['a catalog that repeats /Type (readers differ on which wins)', () =>
      classicPdf({ bodies: ['<< /Type /Catalog /Pages 2 0 R /Type /Page >>', ...PDF_OBJECT_BODIES.slice(1)] }), 'PDF_ROOT_INVALID'],
    ['a catalog that is not a complete dictionary object (review r2 pre-submission finding)', () =>
      classicPdf({ bodies: ['<< /Type /Catalog MZ QA not a dictionary', ...PDF_OBJECT_BODIES.slice(1)] }), 'PDF_ROOT_INVALID'],
    ['a catalog dictionary followed by something other than endobj', () =>
      classicPdf({ bodies: [`${CATALOG_BODY} (QA trailing garbage)`, ...PDF_OBJECT_BODIES.slice(1)] }), 'PDF_ROOT_INVALID'],
    ['a compressed catalog whose container is not an object stream', () =>
      streamPdf({ compressCatalog: true }).toString('latin1').replace('/Type /ObjStm', '/Type /ObjStX'), 'PDF_ROOT_INVALID'],
  ])('%s', async (_label, build, reason) => {
    const bytes = build();
    expect(await pdf(Buffer.isBuffer(bytes) ? bytes : latin1(bytes))).toEqual({ ok: false, reason });
  });
});

describe('one section gives one answer', () => {
  it('a hybrid file whose table marks the catalog free while its /XRefStm lists it is refused as ambiguous (readers disagree)', async () => {
    expect(await pdf(hybridPdf({ catalogInTable: 'free' }))).toEqual({ ok: false, reason: 'PDF_XREF_AMBIGUOUS' });
  });
});

describe('the section chain is bounded and loop-free', () => {
  it('a /Prev that points at its own section is refused', async () => {
    const base = syntheticPdf();
    const text = withIncrementalUpdate(base).toString('latin1');
    const updateOffset = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)[1]);
    const looped = text.replace(/\/Prev \d+/, `/Prev ${updateOffset}`);
    expect(await pdf(latin1(looped))).toEqual({ ok: false, reason: 'PDF_XREF_CHAIN_INVALID' });
  });

  it('a /Prev outside the file is refused', async () => {
    const text = withIncrementalUpdate(syntheticPdf()).toString('latin1').replace(/\/Prev \d+/, '/Prev 99999999');
    expect(await pdf(latin1(text))).toEqual({ ok: false, reason: 'PDF_XREF_CHAIN_INVALID' });
  });

  it(`more than ${PDF_INSPECTION_LIMITS.maxSections} sections are refused`, async () => {
    let bytes = syntheticPdf();
    // Each empty update adds a section that does not list the catalog.
    for (let index = 0; index <= PDF_INSPECTION_LIMITS.maxSections; index += 1) {
      const text = bytes.toString('latin1');
      const previous = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)[1]);
      const offset = bytes.length;
      bytes = Buffer.concat([bytes, latin1(`xref\n0 1\n${entry(0, 65535, 'f')}trailer\n<< /Size 6 /Root 1 0 R /Prev ${previous} >>\nstartxref\n${offset}\n%%EOF\n`)]);
    }
    expect(await pdf(bytes)).toEqual({ ok: false, reason: 'PDF_XREF_CHAIN_INVALID' });
  });
});

describe('parsing stays bounded (CPU and memory)', () => {
  const timed = async (bytes) => {
    const started = performance.now();
    const result = await pdf(bytes);
    return { result, ms: performance.now() - started };
  };

  it('a trailer that is 60,000 comment lines is read in linear time', async () => {
    const { result, ms } = await timed(classicPdf({ trailer: `trailer\n<< ${'%\n'.repeat(30_000)}/Size 5 /Root 1 0 R >>\n` }));
    expect(result).toEqual({ ok: true });
    expect(ms).toBeLessThan(1500);
  });

  it('nesting deeper than the limit is refused', async () => {
    const deep = `${'['.repeat(PDF_INSPECTION_LIMITS.maxDepth + 5)}${']'.repeat(PDF_INSPECTION_LIMITS.maxDepth + 5)}`;
    expect(await pdf(classicPdf({ trailer: `trailer\n<< /Size 5 /Root 1 0 R /QA ${deep} >>\n` }))).toEqual({ ok: false, reason: 'PDF_TRAILER_INVALID' });
  });

  it('a trailer larger than the maximum window is refused', async () => {
    const big = `(${'Q'.repeat(PDF_INSPECTION_LIMITS.maxWindowBytes)})`;
    expect(await pdf(classicPdf({ trailer: `trailer\n<< /Size 5 /QA ${big} /Root 1 0 R >>\n` }))).toEqual({ ok: false, reason: 'PDF_TRAILER_INVALID' });
  });

  it(`more than ${PDF_INSPECTION_LIMITS.maxSubsections} subsections are refused quickly`, async () => {
    const subsections = Array.from({ length: PDF_INSPECTION_LIMITS.maxSubsections + 2 }, (_unused, index) => `${index + 10} 0\n`).join('');
    const { result, ms } = await timed(classicPdf({ table: `xref\n0 1\n${entry(0, 65535, 'f')}${subsections}` }));
    expect(result).toEqual({ ok: false, reason: 'PDF_XREF_INVALID' });
    expect(ms).toBeLessThan(3000);
  });

  it('cross-reference streams that would decompress past the file budget are refused (a decompression bomb)', async () => {
    // Each stream lists 400,000 seven-byte rows (2.8 MB, within the per-stream
    // limit) — none of them the catalog, so the search goes on through /Prev;
    // the third takes the file past its 8 MiB decoding budget.
    let bytes = streamPdf();
    for (let index = 0; index < 3; index += 1) {
      const text = bytes.toString('latin1');
      const previous = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)[1]);
      const rows = Buffer.alloc(400_000 * 8); // PNG rows: filter byte 0 and seven zero bytes
      const data = deflateSync(rows);
      const offset = bytes.length;
      bytes = Buffer.concat([
        bytes,
        latin1(`${20 + index} 0 obj\n<< /Type /XRef /Size 400100 /Index [100 400000] /W [1 4 2] /Root 1 0 R /Prev ${previous} /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 7 >> /Length ${data.length} >>\nstream\n`),
        data,
        latin1(`\nendstream\nendobj\nstartxref\n${offset}\n%%EOF\n`),
      ]);
    }
    const { result, ms } = await timed(bytes);
    expect(result).toEqual({ ok: false, reason: 'PDF_XREF_TOO_LARGE' });
    expect(ms).toBeLessThan(3000);
  });

  it('many small subsections across many sections stay cheap and are capped for the whole file', async () => {
    // 20 chained sections of 1,000 empty subsections each: 20,000 in total, over the 10,000 cap.
    let bytes = syntheticPdf();
    for (let index = 0; index < 20; index += 1) {
      const text = bytes.toString('latin1');
      const previous = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)[1]);
      const offset = bytes.length;
      const empty = Array.from({ length: 1000 }, (_unused, n) => `${n + 10} 0\n`).join('');
      bytes = Buffer.concat([bytes, latin1(`xref\n${empty}trailer\n<< /Size 6 /Root 1 0 R /Prev ${previous} >>\nstartxref\n${offset}\n%%EOF\n`)]);
    }
    const { result, ms } = await timed(bytes);
    expect(result).toEqual({ ok: false, reason: 'PDF_XREF_INVALID' });
    expect(ms).toBeLessThan(1500);
  });});

describe('valid structures keep passing', () => {
  it.each([
    ['a classic table (20-byte entries, " \\n")', () => classicPdf()],
    ['a classic table with "\\r\\n" entries', () => classicPdf({ eol: '\r\n' })],
    ['a classic table with 19-byte entries (common non-conforming writers)', () => classicPdf({ eol: '\n' })],
    ['a classic table with 21-byte entries (" \\r\\n")', () => classicPdf({ eol: ' \r\n' })],
    ['a comment inside the trailer dictionary', () => classicPdf({ trailer: 'trailer\n<< /Size 5 % QA comment\n /Root 1 0 R >>\n' })],
    ['a catalog repeating a key the check does not use (as TCPDF writes /PageMode)', () =>
      classicPdf({ bodies: ['<< /Type /Catalog /Pages 2 0 R /PageMode /UseNone /PageMode /UseOutlines >>', ...PDF_OBJECT_BODIES.slice(1)] })],
    ['an incremental update whose latest section omits the catalog (found through /Prev)', () => withIncrementalUpdate(syntheticPdf())],
    ['an uncompressed cross-reference stream', () => streamPdf({ encoding: 'none' })],
    ['a FlateDecode cross-reference stream without a predictor', () => streamPdf({ encoding: 'flate' })],
    ['a FlateDecode cross-reference stream with the PNG Up predictor', () => streamPdf()],
    ['a stream without its zlib end marker (as macOS Quartz writes them)', () => streamPdf({ truncateZlib: true })],
    ['a catalog compressed in an object stream', () => streamPdf({ compressCatalog: true })],
    ['a hybrid-reference file whose table leaves the compressed catalog out', () => hybridPdf({ catalogInTable: 'omitted' })],
  ])('accepts %s', async (_label, build) => {
    expect(await pdf(build())).toEqual({ ok: true });
  });
});

describe('real HTTP: garbage is refused and nothing is stored; a sound PDF is stored as NOT_SCANNED', () => {
  let env;
  let harness;
  let log;

  beforeEach(async () => {
    log = capturingLogger();
    env = await createIntakeEnvironment({ logger: log.logger });
    harness = buildIntakeApp({ storage: env.storage, uploadArea: env.uploadArea, logger: log.logger });
  });
  afterEach(async () => {
    await env.cleanup();
  });

  const upload = (bytes) =>
    request(harness.app).post(INTAKE_PATH).attach('resume', bytes, { filename: 'synthetic.pdf', contentType: PDF_MIME });

  it.each([
    ['the exact review bytes', Buffer.from('%PDF-1.7\nxref\nNOT_A_PDF\nstartxref\n9\n%%EOF\n', 'utf8'), 'PDF_XREF_INVALID'],
    ['an ordinary object posing as the cross-reference stream', latin1('%PDF-1.7\n1 0 obj\n<< /Foo /Bar >>\nendobj\nstartxref\n9\n%%EOF\n'), 'PDF_XREF_STREAM_INVALID'],
    ['a table whose /Root is not a catalog', classicPdf({ root: '3 0 R' }), 'PDF_ROOT_INVALID'],
  ])('%s -> 422 INVALID_RESUME_FILE', async (_label, bytes, reason) => {
    const response = await upload(bytes);
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INVALID_RESUME_FILE');
    expect(JSON.stringify(response.body)).not.toMatch(/PDF_|reason/);
    expect(env.storedObjects()).toEqual([]);
    expect(env.tempFiles()).toEqual([]);
    expect(log.output()).toContain(`"reason":"${reason}"`);
  });

  it('a structurally sound PDF with an embedded script is still stored — as NOT_SCANNED: structure is not a malware verdict', async () => {
    const withScript = classicPdf({
      bodies: [
        '<< /Type /Catalog /Pages 2 0 R /OpenAction 5 0 R >>', PAGES_BODY, PAGE_BODY, CONTENT_BODY,
        `<< /S /JavaScript /JS (app.alert\\('${QA_MARKER}'\\)) >>`,
      ],
    });
    const response = await upload(withScript);
    expect(response.status).toBe(201);
    expect(env.storedObjects()).toHaveLength(1);
    expect(harness.captured[0].metadata).toMatchObject({ scanStatus: 'NOT_SCANNED', scanCheckedAt: null });
  });
});
