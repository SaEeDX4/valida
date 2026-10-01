import { constants as zlibConstants, inflateSync } from 'node:zlib';

/**
 * PDF structure check — Milestone B4.
 *
 * Doc 09 section 99 and Doc 13 section 64: a PDF must plausibly have PDF
 * structure, not only a ".pdf" name — "malware.exe" renamed "resume.pdf" must
 * not pass.
 *
 * r1 checked the header, the %%EOF marker, the startxref offset and only the
 * first TOKEN at that offset, so marker-only garbage such as
 * "%PDF-1.7 xref NOT_A_PDF startxref 9 %%EOF", or any "1 0 obj" at the
 * offset, was accepted (B4 review r1, finding 4). The check now follows the
 * file the way a PDF reader locates the document (ISO 32000-2, 7.5):
 *
 *   1. the header `%PDF-<major>.<minor>` at byte 0. No leading bytes are
 *      tolerated: data in front of the header is how PDF polyglots
 *      (a PDF that is also an executable or an archive) are built;
 *   2. an `%%EOF` marker in the last 4 KiB, followed by nothing but
 *      whitespace — so nothing (an appended ZIP, a script) trails the file;
 *   3. `startxref <offset>` immediately before that marker, where the offset
 *      lies inside the file, after the header;
 *   4. at that offset, a real CROSS-REFERENCE SECTION, either
 *        - a table: `xref`, then subsections — a header "first count" and
 *          exactly `count` well-formed 20-byte entries each, all inside the
 *          file — then `trailer` and a well-formed dictionary with an
 *          integer /Size and a /Root reference; or
 *        - a cross-reference STREAM: an indirect object whose dictionary has
 *          /Type /XRef, /Size, a valid /W, /Root, and a direct /Length whose
 *          bytes are followed by `endstream`. Its entries are decoded
 *          (FlateDecode with PNG predictors, the only encoding producers
 *          use), inside a hard output limit;
 *   5. DOCUMENT-ROOT LINKAGE: the /Root object number is looked up through
 *      the sections — the latest first, then a hybrid file's /XRefStm, then
 *      each /Prev — and must be an in-use entry whose offset holds exactly
 *      `<n> <g> obj`, a complete, well-formed dictionary of /Type /Catalog,
 *      and `endobj`; or, when the catalog is compressed, whose object stream
 *      is itself an in-use `obj` with /Type /ObjStm.
 *
 * NO AMBIGUITY: a dictionary that repeats a key this check reads (/Root,
 * /Size, /Prev, /Type, /W, ...) is refused — readers differ on which copy
 * wins — and so is a hybrid section whose table and stream disagree.
 *
 * Everything is BOUNDED: windows are read on demand (a few KiB, growing only
 * to fixed maxima), cross-reference tables are walked by arithmetic over
 * fixed-size entries through one cached window, subsections are capped for
 * the whole file, dictionary parsing has token and depth limits, the section
 * chain is limited and loop-checked, and cross-reference-stream
 * decompression is capped per stream and for the whole file.
 *
 * Page content is never parsed, decompressed or rendered (Doc 13 section
 * 76: parse no more than required; every parser is attack surface). An
 * encrypted (password-protected) PDF passes when its structure is sound —
 * the cross-reference data and catalog names are not encrypted. Structural
 * validity is not a malware verdict — embedded scripts, for instance, are
 * not detected here — which is why an accepted file is recorded as
 * NOT_SCANNED and stays unavailable for review until real scanning exists
 * (E4).
 */
const HEADER = /^%PDF-[12]\.\d/;
// ISO 32000 white-space characters: NUL, HT, LF, FF, CR, SP.
const TRAILING_WHITESPACE = /^[\0\t\n\f\r ]*$/;
const STARTXREF = /startxref[\0\t\n\f\r ]+(\d{1,10})[\0\t\n\f\r ]+%%EOF[\0\t\n\f\r ]*$/;

const MINIMUM_SIZE = 32;

export const PDF_INSPECTION_LIMITS = Object.freeze({
  /** First window read at a structure; grows by doubling to maxWindowBytes. */
  initialWindowBytes: 4 * 1024,
  maxWindowBytes: 64 * 1024,
  /** Cross-reference sections followed through /Prev and /XRefStm. */
  maxSections: 32,
  /** Table subsections in the whole file (all sections together). */
  maxSubsections: 10_000,
  /** Cross-reference streams: decoded bytes per stream and for the whole file, and entries. */
  maxXrefStreamDecodedBytes: 4 * 1024 * 1024,
  maxTotalXrefStreamDecodedBytes: 8 * 1024 * 1024,
  maxXrefStreamEntries: 500_000,
  maxTokens: 20_000,
  maxDepth: 32,
  /** Bytes read per chunk while validating table entries. */
  entryChunkBytes: 64 * 1024,
});

class PdfRejection extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}
const refuse = (reason) => {
  throw new PdfRejection(reason);
};
/** The window ended inside a structure: read more, or give up at the maximum. */
class NeedMore extends Error {}

/**
 * @param {{ size: number, read: (offset: number, length: number) => Promise<Buffer> }} reader
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function inspectPdf(reader, limits = PDF_INSPECTION_LIMITS) {
  try {
    const { size } = reader;
    if (size < MINIMUM_SIZE) refuse('PDF_TOO_SMALL');

    const head = await reader.read(0, Math.min(size, 1024));
    if (!HEADER.test(head.toString('latin1', 0, 8))) refuse('PDF_HEADER_MISSING');

    const tailLength = Math.min(size, 4096);
    const tail = (await reader.read(size - tailLength, tailLength)).toString('latin1');
    const eof = tail.lastIndexOf('%%EOF');
    if (eof === -1) refuse('PDF_EOF_MISSING');
    if (!TRAILING_WHITESPACE.test(tail.slice(eof + 5))) refuse('PDF_TRAILING_DATA');

    const startxref = STARTXREF.exec(tail) ?? refuse('PDF_STARTXREF_MISSING');
    const offset = Number(startxref[1]);
    if (offset < 9 || offset >= size) refuse('PDF_XREF_OFFSET_INVALID');

    const document = new PdfStructure(reader, limits);
    const latest = await document.section(offset);
    const root = latest.trailer.get('Root');
    const declaredSize = latest.trailer.get('Size');
    if (!isReference(root) || !Number.isInteger(declaredSize) || root.num >= declaredSize) refuse('PDF_TRAILER_INVALID');
    await document.verifyRoot(latest, root);
    return { ok: true };
  } catch (error) {
    if (error instanceof PdfRejection) return { ok: false, reason: error.reason };
    throw error;
  }
}

// ---------------------------------------------------------------- lexing --

const WHITESPACE = /[\0\t\n\f\r ]/;
/** Dictionary keys the structure check reads: none may appear twice. */
const STRUCTURAL_KEYS = new Set([
  'Type', 'Root', 'Size', 'Prev', 'XRefStm', 'W', 'Index', 'Length', 'Filter', 'DecodeParms',
  'Predictor', 'Columns', 'Colors', 'BitsPerComponent', 'N', 'First', 'Encrypt',
]);
const isReference = (value) => value !== null && typeof value === 'object' && value.kind === 'ref';
const isName = (value, name) => value !== null && typeof value === 'object' && value.kind === 'name' && value.name === name;

/*
 * A minimal, bounded PDF object parser over a latin1 window (one char per
 * byte). It understands exactly the object syntax of ISO 32000 7.3 —
 * numbers, names, strings, arrays, dictionaries, references, booleans,
 * null — and nothing else. It throws NeedMore when the window ends inside an
 * object, and PdfRejection(reason) for anything malformed.
 */
class ObjectParser {
  constructor(text, position, { reason, limits, complete }) {
    this.s = text;
    this.i = position;
    this.reason = reason;
    this.limits = limits;
    this.complete = complete; // the window reaches the end of the file
    this.tokens = 0;
  }

  fail() {
    refuse(this.reason);
  }

  more() {
    if (this.complete) this.fail();
    throw new NeedMore();
  }

  skipWhitespace() {
    for (;;) {
      if (this.i >= this.s.length) return;
      const c = this.s[this.i];
      if (WHITESPACE.test(c)) {
        this.i += 1;
      } else if (c === '%') {
        // A comment runs to the end of the line (scanned once, never re-sliced).
        let end = this.i;
        while (end < this.s.length && this.s[end] !== '\r' && this.s[end] !== '\n') end += 1;
        if (end === this.s.length) this.more();
        this.i = end;
      } else {
        return;
      }
    }
  }

  /** The next value. Integers followed by "<gen> R" become references. */
  value(depth = 0) {
    if (depth > this.limits.maxDepth) this.fail();
    if ((this.tokens += 1) > this.limits.maxTokens) this.fail();
    this.skipWhitespace();
    if (this.i >= this.s.length) this.more();
    const c = this.s[this.i];
    if (c === '<' && this.s[this.i + 1] === '<') return this.dictionary(depth);
    if (c === '<') return this.hexString();
    if (c === '[') return this.array(depth);
    if (c === '(') return this.literalString();
    if (c === '/') return this.name();
    if (/[0-9+\-.]/.test(c)) return this.number();
    const keyword = /^(true|false|null)(?=[\0\t\n\f\r ()<>[\]{}/%]|$)/.exec(this.s.slice(this.i, this.i + 6));
    if (keyword) {
      if (this.i + keyword[1].length >= this.s.length) this.more();
      this.i += keyword[1].length;
      return keyword[1] === 'null' ? null : keyword[1] === 'true';
    }
    return this.fail();
  }

  dictionary(depth) {
    this.i += 2;
    const entries = new Map();
    for (;;) {
      this.skipWhitespace();
      if (this.i + 1 >= this.s.length) this.more();
      if (this.s[this.i] === '>' && this.s[this.i + 1] === '>') {
        this.i += 2;
        return entries;
      }
      if (this.s[this.i] !== '/') this.fail();
      const key = this.name().name;
      const value = this.value(depth + 1);
      if (entries.has(key)) {
        // A repeated key has no single meaning — readers differ on which
        // wins — so a repeat of any key this check relies on is refused.
        // Other repeats are left as the producer wrote them (TCPDF, for one,
        // repeats /PageMode in its catalog); they decide nothing here.
        if (STRUCTURAL_KEYS.has(key)) this.fail();
        continue;
      }
      entries.set(key, value);
    }
  }

  array(depth) {
    this.i += 1;
    const items = [];
    for (;;) {
      this.skipWhitespace();
      if (this.i >= this.s.length) this.more();
      if (this.s[this.i] === ']') {
        this.i += 1;
        return items;
      }
      items.push(this.value(depth + 1));
    }
  }

  name() {
    const match = /^\/([^\0\t\n\f\r ()<>[\]{}/%]*)/.exec(this.s.slice(this.i, this.i + 256));
    if (!match) this.fail();
    const end = this.i + match[0].length;
    if (end >= this.s.length) this.more();
    if (match[0].length === 256) this.fail(); // over-long name
    this.i = end;
    if (/#(?![0-9A-Fa-f]{2})/.test(match[1])) this.fail();
    return { kind: 'name', name: match[1].replace(/#([0-9A-Fa-f]{2})/g, (_m, hex) => String.fromCharCode(Number.parseInt(hex, 16))) };
  }

  number() {
    const match = /^[+-]?(?:\d+\.?\d*|\.\d+)/.exec(this.s.slice(this.i, this.i + 40));
    if (!match) this.fail();
    const end = this.i + match[0].length;
    if (end >= this.s.length) this.more();
    if (!/[\0\t\n\f\r ()<>[\]{}/%]/.test(this.s[end])) this.fail();
    this.i = end;
    const text = match[0];
    if (!/^\d+$/.test(text)) return Number(text);
    const integer = Number(text);
    // "<num> <gen> R" — an indirect reference.
    const reference = /^[\0\t\n\f\r ]+(\d{1,5})[\0\t\n\f\r ]+R(?=[\0\t\n\f\r ()<>[\]{}/%])/.exec(this.s.slice(this.i, this.i + 32));
    if (reference) {
      this.i += reference[0].length;
      return { kind: 'ref', num: integer, gen: Number(reference[1]) };
    }
    if (this.i + 32 > this.s.length && /^[\0\t\n\f\r ]+\d*[\0\t\n\f\r ]*R?$/.test(this.s.slice(this.i))) this.more();
    return integer;
  }

  literalString() {
    let depth = 0;
    for (let j = this.i; j < this.s.length; j += 1) {
      const c = this.s[j];
      if (c === '\\') {
        j += 1;
      } else if (c === '(') {
        depth += 1;
      } else if (c === ')') {
        depth -= 1;
        if (depth === 0) {
          this.i = j + 1;
          return { kind: 'string' };
        }
      }
    }
    return this.more();
  }

  hexString() {
    const end = this.s.indexOf('>', this.i);
    if (end === -1) this.more();
    if (!/^<[0-9A-Fa-f\0\t\n\f\r ]*>$/.test(this.s.slice(this.i, end + 1))) this.fail();
    this.i = end + 1;
    return { kind: 'string' };
  }

  /** Consumes `pattern` (sticky-anchored at the cursor) or fails. */
  expect(pattern) {
    const match = pattern.exec(this.s.slice(this.i, this.i + 64));
    if (!match) {
      if (this.i + 64 > this.s.length && !this.complete) this.more();
      this.fail();
    }
    this.i += match[0].length;
    return match;
  }
}

// ------------------------------------------------------ document structure --

/*
 * A table entry is "nnnnnnnnnn ggggg n" plus a 2-byte end of line — 20
 * bytes (ISO 32000-2, 7.5.4). Two non-conforming widths are common in real
 * producers' output and read by every PDF reader, so they are accepted too:
 * 19 bytes (a 1-byte end of line) and 21 bytes (" \r\n"). The width is
 * taken from a subsection's first entry and then required of EVERY entry in
 * it, so the table can still be walked by arithmetic.
 */
const XREF_ENTRY_FORMS = [
  { width: 21, pattern: /^(\d{10}) (\d{5}) ([nf]) \r\n$/ },
  { width: 20, pattern: /^(\d{10}) (\d{5}) ([nf])(?: \r| \n|\r\n)$/ },
  { width: 19, pattern: /^(\d{10}) (\d{5}) ([nf])[\r\n]$/ },
];
/** The width of a subsection's entries, from its first entry. */
function entryForm(firstEntry) {
  return XREF_ENTRY_FORMS.find(({ width, pattern }) => pattern.test(firstEntry.slice(0, width))) ?? refuse('PDF_XREF_INVALID');
}

const OBJECT_HEADER = /^[\0\t\n\f\r ]*(\d{1,10})[\0\t\n\f\r ]+(\d{1,5})[\0\t\n\f\r ]+obj(?=[\0\t\n\f\r <[(/%])/;

class PdfStructure {
  #reader;
  #limits;
  #sections = new Map();
  #decodedBytes = 0;
  #subsections = 0;

  constructor(reader, limits) {
    this.#reader = reader;
    this.#limits = limits;
  }

  /**
   * Parses something at `offset` from a window that grows until `parse`
   * stops asking for more (or the maximum window is reached).
   */
  async #withWindow(offset, reason, parse) {
    const { size } = this.#reader;
    let length = this.#limits.initialWindowBytes;
    for (;;) {
      const available = Math.min(length, size - offset);
      const text = (await this.#reader.read(offset, available)).toString('latin1');
      try {
        return parse(text, offset + available >= size);
      } catch (error) {
        if (!(error instanceof NeedMore)) throw error;
        if (available >= this.#limits.maxWindowBytes || offset + available >= size) refuse(reason);
        length *= 2;
      }
    }
  }

  /**
   * The cross-reference section at `offset` — parsed once and cached. The
   * number of distinct sections is bounded; loops are caught by #locate.
   * `expect: 'stream'` is used for a hybrid file's /XRefStm.
   */
  async section(offset, { expect } = {}) {
    if (this.#sections.has(offset)) return this.#sections.get(offset);
    if (this.#sections.size >= this.#limits.maxSections) refuse('PDF_XREF_CHAIN_INVALID');
    if (!Number.isInteger(offset) || offset < 9 || offset >= this.#reader.size) refuse('PDF_XREF_CHAIN_INVALID');
    const head = (await this.#reader.read(offset, Math.min(64, this.#reader.size - offset))).toString('latin1');
    let section;
    if (expect !== 'stream' && /^[\0\t\n\f\r ]*xref(?![A-Za-z0-9])/.test(head)) section = await this.#table(offset);
    else if (OBJECT_HEADER.test(head)) section = await this.#stream(offset);
    else refuse('PDF_XREF_NOT_FOUND');
    this.#sections.set(offset, section);
    return section;
  }

  /** A classic cross-reference table and its trailer. */
  async #table(offset) {
    const { size } = this.#reader;
    /*
     * Reads go through one cached window (entryChunkBytes), so a table of
     * many small subsections costs a handful of file reads, not three per
     * subsection (review r2 pre-submission finding: 170,000 subsections took
     * about 5 s). The number of subsections in the whole file is capped too.
     */
    let cacheStart = 0;
    let cache = '';
    const read = async (at, length) => {
      const end = Math.min(at + length, size);
      if (at < cacheStart || end > cacheStart + cache.length) {
        cacheStart = at;
        cache = (await this.#reader.read(at, Math.min(Math.max(length, this.#limits.entryChunkBytes), size - at))).toString('latin1');
      }
      return cache.slice(at - cacheStart, end - cacheStart);
    };

    // "xref" and its end of line.
    let position = offset;
    const opening = /^[\0\t\n\f\r ]*xref[ \t]*(?:\r\n|\r|\n)/.exec(await read(position, 64)) ?? refuse('PDF_XREF_INVALID');
    position += opening[0].length;

    const subsections = [];
    for (;;) {
      const line = await read(position, 64);
      const skipped = /^[\0\t\n\f\r ]*/.exec(line)[0].length;
      position += skipped;
      if (line.startsWith('trailer', skipped)) break;
      const header = /^(\d{1,10})[ ]+(\d{1,10})[ \t]*(?:\r\n|\r|\n)/.exec(line.slice(skipped)) ?? refuse('PDF_XREF_INVALID');
      if ((this.#subsections += 1) > this.#limits.maxSubsections) refuse('PDF_XREF_INVALID');
      const first = Number(header[1]);
      const count = Number(header[2]);
      const entriesAt = position + header[0].length;
      const form = count === 0 ? XREF_ENTRY_FORMS[1] : entryForm(await read(entriesAt, 21));
      if (entriesAt + count * form.width > size) refuse('PDF_XREF_INVALID');
      await this.#validateEntries(read, entriesAt, count, form);
      subsections.push({ first, count, entriesAt, form });
      position = entriesAt + count * form.width;
    }
    // Subsections of one section may not overlap: an object would have two entries.
    const ordered = [...subsections].sort((a, b) => a.first - b.first);
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index].first < ordered[index - 1].first + ordered[index - 1].count) refuse('PDF_XREF_INVALID');
    }

    const trailer = await this.#withWindow(position, 'PDF_TRAILER_INVALID', (text, complete) => {
      const parser = new ObjectParser(text, 0, { reason: 'PDF_TRAILER_INVALID', limits: this.#limits, complete });
      parser.expect(/^trailer/);
      parser.skipWhitespace();
      if (!text.startsWith('<<', parser.i)) {
        if (parser.i + 2 > text.length) parser.more();
        parser.fail();
      }
      return parser.dictionary(0);
    });
    for (const key of ['Prev', 'XRefStm']) {
      if (trailer.has(key) && !Number.isInteger(trailer.get(key))) refuse('PDF_TRAILER_INVALID');
    }

    return {
      trailer,
      find: async (num) => {
        const subsection = subsections.find(({ first, count }) => num >= first && num < first + count);
        if (!subsection) return null;
        const { width, pattern } = subsection.form;
        const entry = pattern.exec(await read(subsection.entriesAt + (num - subsection.first) * width, width));
        if (!entry) refuse('PDF_XREF_INVALID');
        return entry[3] === 'n'
          ? { type: 'in-use', offset: Number(entry[1]), gen: Number(entry[2]) }
          : { type: 'free' };
      },
    };
  }

  /** Every entry of a table subsection must be well-formed, all of one width. */
  async #validateEntries(read, at, count, { width, pattern }) {
    const perChunk = Math.floor(this.#limits.entryChunkBytes / width);
    for (let done = 0; done < count; done += perChunk) {
      const entries = Math.min(perChunk, count - done);
      const chunk = await read(at + done * width, entries * width);
      for (let index = 0; index < entries; index += 1) {
        if (!pattern.test(chunk.slice(index * width, index * width + width))) refuse('PDF_XREF_INVALID');
      }
    }
  }

  /**
   * Reads `<n> <g> obj << dictionary >>` at `offset`. With `endobj`, the
   * object must be exactly that dictionary: `endobj` must follow it.
   */
  async #object(offset, reason, { endobj = false } = {}) {
    return this.#withWindow(offset, reason, (text, complete) => {
      const parser = new ObjectParser(text, 0, { reason, limits: this.#limits, complete });
      const header = OBJECT_HEADER.exec(text) ?? parser.fail();
      parser.i = header[0].length;
      parser.skipWhitespace();
      if (!text.startsWith('<<', parser.i)) {
        if (parser.i + 2 > text.length) parser.more();
        parser.fail();
      }
      const dictionary = parser.dictionary(0);
      const end = offset + parser.i;
      if (endobj) {
        parser.skipWhitespace();
        parser.expect(/^endobj(?![A-Za-z0-9])/);
      }
      return { num: Number(header[1]), gen: Number(header[2]), dictionary, end };
    });
  }

  /** Is `stream` (with its CRLF or LF) next at `at`? Returns where the data starts, or null. */
  async #streamKeyword(at) {
    const text = (await this.#reader.read(at, Math.min(64, this.#reader.size - at))).toString('latin1');
    const keyword = /^[\0\t\n\f\r ]*stream(?:\r\n|\n)/.exec(text);
    return keyword ? at + keyword[0].length : null;
  }

  /** A cross-reference stream (PDF 1.5+): the object, its dictionary and its decoded entries. */
  async #stream(offset) {
    const { size } = this.#reader;
    const reason = 'PDF_XREF_STREAM_INVALID';
    const { dictionary, end } = await this.#object(offset, reason);
    // `stream` and its end of line (CRLF or LF) must follow the dictionary.
    const dataAt = (await this.#streamKeyword(end)) ?? refuse(reason);

    if (!isName(dictionary.get('Type'), 'XRef')) refuse(reason);
    const declaredSize = dictionary.get('Size');
    const widths = dictionary.get('W');
    const length = dictionary.get('Length');
    if (!Number.isInteger(declaredSize) || declaredSize < 1) refuse(reason);
    if (!Array.isArray(widths) || widths.length !== 3 || !widths.every((w) => Number.isInteger(w) && w >= 0 && w <= 8)) refuse(reason);
    if (widths[1] < 1) refuse(reason);
    if (!Number.isInteger(length) || length < 1 || dataAt + length > size) refuse(reason);
    if (dictionary.has('Prev') && !Number.isInteger(dictionary.get('Prev'))) refuse(reason);

    const index = dictionary.get('Index') ?? [0, declaredSize];
    if (!Array.isArray(index) || index.length === 0 || index.length % 2 !== 0 || !index.every((n) => Number.isInteger(n) && n >= 0)) refuse(reason);
    const ranges = [];
    let rows = 0;
    for (let at = 0; at < index.length; at += 2) {
      ranges.push({ first: index[at], count: index[at + 1], row: rows });
      rows += index[at + 1];
    }
    const ordered = [...ranges].sort((a, b) => a.first - b.first);
    for (let at = 1; at < ordered.length; at += 1) {
      if (ordered[at].first < ordered[at - 1].first + ordered[at - 1].count) refuse(reason);
    }
    const rowWidth = widths[0] + widths[1] + widths[2];
    if (rows > this.#limits.maxXrefStreamEntries) refuse('PDF_XREF_TOO_LARGE');

    // The stream data, and `endstream` where /Length says it ends.
    const raw = await this.#reader.read(dataAt, length);
    const after = (await this.#reader.read(dataAt + length, Math.min(32, size - dataAt - length))).toString('latin1');
    if (!/^[\0\t\n\f\r ]*endstream(?![A-Za-z0-9])/.test(after)) refuse(reason);

    // Every stream's decoded size counts against one budget for the file.
    this.#decodedBytes += rows * rowWidth;
    if (this.#decodedBytes > this.#limits.maxTotalXrefStreamDecodedBytes) refuse('PDF_XREF_TOO_LARGE');
    const rowsBytes = decodeXrefStream(raw, dictionary, { rows, rowWidth, limits: this.#limits });

    return {
      trailer: dictionary,
      find: async (num) => {
        const range = ranges.find(({ first, count }) => num >= first && num < first + count);
        if (!range) return null;
        const row = range.row + (num - range.first);
        const field = (start, width) => {
          let value = 0;
          for (let byte = 0; byte < width; byte += 1) value = value * 256 + rowsBytes[row * rowWidth + start + byte];
          return value;
        };
        const type = widths[0] === 0 ? 1 : field(0, widths[0]);
        const second = field(widths[0], widths[1]);
        const third = field(widths[0] + widths[1], widths[2]);
        if (type === 1) return { type: 'in-use', offset: second, gen: third };
        if (type === 2) return { type: 'compressed', stream: second, index: third };
        return { type: 'free' };
      },
    };
  }

  /**
   * Finds an object's entry the way a reader does (ISO 32000-2, 7.5.6 and
   * 7.5.8.4): the latest section first — in a hybrid file, its table and
   * then its /XRefStm stream — then each earlier section through /Prev. A
   * /Prev chain that loops is refused.
   *
   * One section must give ONE answer: when a hybrid section's table and its
   * /XRefStm stream both describe the object (the table marking it free while
   * the stream lists it, or both listing it), readers disagree about which
   * wins — Poppler and pdf.js take the table, qpdf the stream — so the file
   * is refused as ambiguous rather than resolved one way.
   */
  async #locate(latest, num) {
    const visited = new Set();
    let section = latest;
    for (;;) {
      if (visited.has(section)) refuse('PDF_XREF_CHAIN_INVALID');
      visited.add(section);
      const entry = await section.find(num);
      const hybrid = section.trailer.get('XRefStm');
      if (hybrid !== undefined) {
        const compressed = await (await this.section(hybrid, { expect: 'stream' })).find(num);
        if (compressed && compressed.type !== 'free') {
          if (entry) refuse('PDF_XREF_AMBIGUOUS');
          return compressed;
        }
      }
      if (entry) return entry; // in use — or free in the latest section that lists it: deleted
      const previous = section.trailer.get('Prev');
      if (previous === undefined) return null;
      section = await this.section(previous);
    }
  }

  /** The /Root reference must lead to the document catalog (see the file header). */
  async verifyRoot(latest, root) {
    const entry = (await this.#locate(latest, root.num)) ?? refuse('PDF_ROOT_MISSING');
    if (entry.type === 'free') refuse('PDF_ROOT_MISSING');

    if (entry.type === 'in-use') {
      if (entry.gen !== root.gen) refuse('PDF_ROOT_INVALID');
      // The whole catalog must be a well-formed dictionary object — not a
      // "/Type /Catalog" prefix followed by anything at all.
      const object = await this.#inUseObject(entry, 'PDF_ROOT_INVALID', { endobj: true });
      if (object.num !== root.num || object.gen !== root.gen) refuse('PDF_ROOT_INVALID');
      if (!isName(object.dictionary.get('Type'), 'Catalog')) refuse('PDF_ROOT_INVALID');
      return;
    }

    // A compressed catalog (generation 0) lives in an object stream, which
    // must itself be an in-use object of /Type /ObjStm. It is not decompressed.
    if (root.gen !== 0) refuse('PDF_ROOT_INVALID');
    const container = (await this.#locate(latest, entry.stream)) ?? refuse('PDF_ROOT_MISSING');
    if (container.type !== 'in-use') refuse('PDF_ROOT_INVALID');
    const object = await this.#inUseObject(container, 'PDF_ROOT_INVALID');
    const { dictionary } = object;
    if (object.num !== entry.stream || !isName(dictionary.get('Type'), 'ObjStm')) refuse('PDF_ROOT_INVALID');
    const count = dictionary.get('N');
    if (!Number.isInteger(count) || entry.index >= count || !Number.isInteger(dictionary.get('First'))) refuse('PDF_ROOT_INVALID');
    if ((await this.#streamKeyword(object.end)) === null) refuse('PDF_ROOT_INVALID');
  }

  async #inUseObject(entry, reason, options) {
    // Nothing can start inside the 8-byte "%PDF-x.y" header.
    if (entry.offset < 8 || entry.offset >= this.#reader.size) refuse(reason);
    return this.#object(entry.offset, reason, options);
  }
}

/**
 * Decodes cross-reference stream data — no filter, or FlateDecode with no
 * predictor or a PNG predictor — to exactly rows x rowWidth bytes. Output is
 * capped at the size the entries need; anything else is refused.
 */
function decodeXrefStream(raw, dictionary, { rows, rowWidth, limits }) {
  const reason = 'PDF_XREF_STREAM_INVALID';
  let filter = dictionary.get('Filter');
  let parameters = dictionary.get('DecodeParms');
  if (Array.isArray(filter)) {
    if (filter.length > 1) refuse('PDF_XREF_STREAM_UNSUPPORTED');
    [filter] = filter;
    if (Array.isArray(parameters)) [parameters] = parameters;
  }
  if (filter !== undefined && !isName(filter, 'FlateDecode')) refuse('PDF_XREF_STREAM_UNSUPPORTED');
  if (parameters !== undefined && parameters !== null && !(parameters instanceof Map)) refuse(reason);

  const predictor = parameters?.get('Predictor') ?? 1;
  const png = predictor >= 10 && predictor <= 15;
  if (predictor !== 1 && !png) refuse('PDF_XREF_STREAM_UNSUPPORTED');
  if (png) {
    const columns = parameters.get('Columns') ?? 1;
    const colors = parameters.get('Colors') ?? 1;
    const bits = parameters.get('BitsPerComponent') ?? 8;
    if (columns !== rowWidth || colors !== 1 || bits !== 8) refuse('PDF_XREF_STREAM_UNSUPPORTED');
  }
  const encodedRow = rowWidth + (png ? 1 : 0);
  const expected = rows * encodedRow;
  if (expected > limits.maxXrefStreamDecodedBytes) refuse('PDF_XREF_TOO_LARGE');

  let data;
  if (filter === undefined) {
    data = raw;
  } else {
    try {
      // Output is capped a little above what the entries need (some producers
      // leave padding). Z_SYNC_FLUSH returns the data of a stream whose zlib
      // end marker is missing — macOS Quartz writes such streams in
      // incrementally saved files, and readers accept them — while corrupt
      // data still fails. Either way every entry must be present below.
      data = inflateSync(raw, {
        maxOutputLength: Math.max(1, expected + 1024),
        finishFlush: zlibConstants.Z_SYNC_FLUSH,
      });
    } catch {
      refuse(reason);
    }
  }
  if (data.length < expected) refuse(reason);
  if (!png) return data.subarray(0, expected);

  // PNG row filters (RFC 2083 6), one byte per pixel.
  const out = Buffer.alloc(rows * rowWidth);
  for (let row = 0; row < rows; row += 1) {
    const type = data[row * encodedRow];
    const source = row * encodedRow + 1;
    const target = row * rowWidth;
    const above = target - rowWidth;
    if (type < 0 || type > 4) refuse(reason);
    for (let column = 0; column < rowWidth; column += 1) {
      const x = data[source + column];
      if (type === 0) {
        out[target + column] = x;
        continue;
      }
      const left = column > 0 ? out[target + column - 1] : 0;
      const up = row > 0 ? out[above + column] : 0;
      let predicted;
      if (type === 1) predicted = left;
      else if (type === 2) predicted = up;
      else if (type === 3) predicted = (left + up) >> 1;
      else {
        const upLeft = row > 0 && column > 0 ? out[above + column - 1] : 0;
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      out[target + column] = (x + predicted) & 0xff;
    }
  }
  return out;
}
