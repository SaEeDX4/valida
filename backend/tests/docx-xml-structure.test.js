import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { inspectDocx } from '../src/modules/applications/resume/docxInspector.js';
import { bufferReader } from '../src/modules/applications/resume/byteReader.js';
import { capturingLogger } from './helpers.js';
import {
  DOCX_MIME, buildZip, docxEntries, contentTypesXml, packageRelsXml, CONTENT_TYPES, readZipEntries,
} from './fixtures/resumeFiles.js';
import { INTAKE_PATH, buildIntakeApp, createIntakeEnvironment } from './fixtures/uploadHarness.js';

/**
 * B4 review r1, FINDING 1 — package XML must be read as XML structure.
 *
 * r1 matched tag-shaped text anywhere in `[Content_Types].xml` and
 * `_rels/.rels` — inside comments, processing instructions and CDATA too —
 * and let a later match silently overwrite an earlier declaration. A
 * macro-enabled document with a commented-out "ordinary document" Override
 * was accepted and stored.
 *
 * These cases prove the fix is structural, not a comment-stripping patch:
 * non-element content never declares anything; elements are identified by
 * namespace, not prefix; the roots, children and attributes are the OPC
 * schema's; and a package that declares one thing twice is refused as
 * ambiguous instead of being resolved by document order. Each runs through
 * inspection, and the decisive ones through REAL HTTP into real storage.
 *
 * Every file is synthetic, or a real-producer QA fixture altered in code.
 */
const docx = (buffer) => inspectDocx(bufferReader(buffer));
const fixture = (name) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'resumes', name));

const CT_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/content-types';
const RELS_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOCUMENT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const DOCX_OVERRIDE = `<Override PartName="/word/document.xml" ContentType="${CONTENT_TYPES.DOCX}"/>`;

/** The review's exact reproduction: the real LibreOffice .docm, one comment added before </Types>. */
function commentDisguisedDocm() {
  const entries = readZipEntries(fixture('qa-libreoffice-macro-format.docm')).map((entry) => {
    if (entry.name !== '[Content_Types].xml') return entry;
    const xml = entry.data.toString('utf8');
    expect(xml.match(/<\/Types>/g)).toHaveLength(1);
    return { ...entry, data: xml.replace('</Types>', `<!--${DOCX_OVERRIDE}--></Types>`) };
  });
  return buildZip(entries);
}

/** A synthetic package whose [Content_Types].xml is exactly `typesXml`. */
const withTypes = (typesXml, [, rels, document] = docxEntries()) =>
  buildZip([{ name: '[Content_Types].xml', data: typesXml }, rels, document]);
/** A synthetic package whose _rels/.rels is exactly `relsXml`. */
const withRels = (relsXml, [types, , document] = docxEntries()) =>
  buildZip([types, { name: '_rels/.rels', data: relsXml }, document]);

const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const types = (body, rootOpen = `<Types xmlns="${CT_NAMESPACE}">`, rootClose = '</Types>') =>
  `${declaration}${rootOpen}` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  `<Default Extension="xml" ContentType="application/xml"/>${body}${rootClose}`;
const docmOverride = `<Override PartName="/word/document.xml" ContentType="${CONTENT_TYPES.DOCM}"/>`;

describe('the review reproduction: a comment cannot re-declare the document type', () => {
  it('the original LibreOffice .docm is refused as macro-enabled', async () => {
    expect(await docx(fixture('qa-libreoffice-macro-format.docm'))).toEqual({ ok: false, reason: 'DOCX_MACRO_ENABLED' });
  });

  it('the same .docm with a commented-out ordinary-document Override is STILL refused as macro-enabled', async () => {
    expect(await docx(commentDisguisedDocm())).toEqual({ ok: false, reason: 'DOCX_MACRO_ENABLED' });
  });
});

describe('non-element content never becomes a declaration', () => {
  it.each([
    ['a comment after the real macro-enabled Override', types(`${docmOverride}<!--${DOCX_OVERRIDE}-->`), 'DOCX_MACRO_ENABLED'],
    ['a comment before the real macro-enabled Override', types(`<!--${DOCX_OVERRIDE}-->${docmOverride}`), 'DOCX_MACRO_ENABLED'],
    ['a comment spanning lines, with a Default inside', types(`${docmOverride}<!--\n<Default Extension="xml" ContentType="${CONTENT_TYPES.DOCX}"/>\n-->`), 'DOCX_MACRO_ENABLED'],
    // With no real Override, only the commented one would make it a Word document.
    ['the ONLY main-part declaration inside a comment', types(`<!--${DOCX_OVERRIDE}-->`), 'DOCX_NOT_WORD_DOCUMENT'],
    ['a processing instruction holding an Override', types(`${docmOverride}<?qa ${DOCX_OVERRIDE} ?>`), 'DOCX_MACRO_ENABLED'],
    ['a CDATA section holding an Override', types(`${docmOverride}<![CDATA[${DOCX_OVERRIDE}]]>`), 'DOCX_XML_INVALID'],
    ['an Override written as escaped text', types(`${docmOverride}&lt;Override PartName="/word/document.xml" ContentType="${CONTENT_TYPES.DOCX}"/&gt;`), 'DOCX_XML_INVALID'],
  ])('%s', async (_label, xml, reason) => {
    expect(await docx(withTypes(xml))).toEqual({ ok: false, reason });
  });

  it('a commented-out officeDocument relationship is not a relationship', async () => {
    const rels = `${declaration}<Relationships xmlns="${RELS_NAMESPACE}">` +
      `<!--<Relationship Id="rId1" Type="${OFFICE_DOCUMENT}" Target="word/document.xml"/>--></Relationships>`;
    expect(await docx(withRels(rels))).toEqual({ ok: false, reason: 'DOCX_MAIN_DOCUMENT_RELATIONSHIP' });
  });

  it('comments and processing instructions that declare nothing are harmless', async () => {
    const xml = types(`<!-- QA note: ordinary comment -->${DOCX_OVERRIDE}<?qa-note keep ?>`)
      .replace(declaration, `${declaration}<!-- prolog comment -->\n`) + '\n<!-- epilog comment -->\n';
    expect(await docx(withTypes(xml))).toEqual({ ok: true });
  });

  it('a DOCTYPE is refused even inside a comment (no DTD is ever processed)', async () => {
    expect(await docx(withTypes(types(`${DOCX_OVERRIDE}<!-- <!DOCTYPE x> -->`)))).toEqual({ ok: false, reason: 'DOCX_XML_DTD' });
  });
});

describe('conflicting declarations are refused, never resolved by order', () => {
  it.each([
    ['two Overrides for the main part (macro-enabled, then ordinary)', types(`${docmOverride}${DOCX_OVERRIDE}`), 'DOCX_CONTENT_TYPES_AMBIGUOUS'],
    ['two Overrides for the main part (ordinary, then macro-enabled)', types(`${DOCX_OVERRIDE}${docmOverride}`), 'DOCX_CONTENT_TYPES_AMBIGUOUS'],
    ['the same part named in another case', types(`${docmOverride}<Override PartName="/WORD/Document.XML" ContentType="${CONTENT_TYPES.DOCX}"/>`), 'DOCX_CONTENT_TYPES_AMBIGUOUS'],
    ['two identical Overrides', types(`${DOCX_OVERRIDE}${DOCX_OVERRIDE}`), 'DOCX_CONTENT_TYPES_AMBIGUOUS'],
    ['two Defaults for one extension', types(`${DOCX_OVERRIDE}<Default Extension="XML" ContentType="${CONTENT_TYPES.DOCX}"/>`), 'DOCX_CONTENT_TYPES_AMBIGUOUS'],
    ['an escaped unreserved character in a part name (no single meaning)', types(`${docmOverride}<Override PartName="/word/docu%6Dent.xml" ContentType="${CONTENT_TYPES.DOCX}"/>`), 'DOCX_CONTENT_TYPES_INVALID'],
    ['a dot segment in a part name', types(`${docmOverride}<Override PartName="/word/./document.xml" ContentType="${CONTENT_TYPES.DOCX}"/>`), 'DOCX_CONTENT_TYPES_INVALID'],
    ['an escaped "/" in a part name', types(`${docmOverride}<Override PartName="/word%2Fdocument.xml" ContentType="${CONTENT_TYPES.DOCX}"/>`), 'DOCX_CONTENT_TYPES_INVALID'],
    ['a content type with surrounding white space', types(`<Override PartName="/word/document.xml" ContentType=" ${CONTENT_TYPES.DOCX}"/>`), 'DOCX_CONTENT_TYPES_INVALID'],
    ['a content type that is not a media type', types('<Override PartName="/word/document.xml" ContentType="word document"/>'), 'DOCX_CONTENT_TYPES_INVALID'],
  ])('%s', async (_label, xml, reason) => {
    expect(await docx(withTypes(xml))).toEqual({ ok: false, reason });
  });

  it('a non-ASCII main part declared both raw and percent-escaped is ambiguous', async () => {
    const [, , document] = docxEntries();
    const bytes = buildZip([
      { name: '[Content_Types].xml', data: types(`<Override PartName="/word/résumé.xml" ContentType="${CONTENT_TYPES.DOCX}"/><Override PartName="/word/r%C3%A9sum%C3%A9.xml" ContentType="${CONTENT_TYPES.DOCM}"/>`) },
      { name: '_rels/.rels', data: packageRelsXml({ target: 'word/résumé.xml' }) },
      { name: 'word/résumé.xml', data: document.data, utf8: true },
    ]);
    expect(await docx(bytes)).toEqual({ ok: false, reason: 'DOCX_CONTENT_TYPES_AMBIGUOUS' });
  });

  /*
   * Review r2 pre-submission finding: names must be compared as OPC compares
   * them (ASCII case-insensitive), and a declaration that only a wider,
   * Unicode-case-insensitive reader would apply is ambiguous.
   */
  const unicodePackage = ({ target, entryName, overrides, defaultType = CONTENT_TYPES.DOCX }) => {
    const [, , document] = docxEntries();
    const typesXml = `${declaration}<Types xmlns="${CT_NAMESPACE}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      `<Default Extension="xml" ContentType="${defaultType}"/>${overrides}</Types>`;
    return buildZip([
      { name: '[Content_Types].xml', data: typesXml },
      { name: '_rels/.rels', data: packageRelsXml({ target }) },
      { name: entryName, data: document.data, utf8: true },
    ]);
  };

  it.each([
    ['an Override for "Ä" deciding the type of the main part "ä"',
      { target: 'word/%C3%A4.xml', entryName: 'word/ä.xml', defaultType: CONTENT_TYPES.DOCM, overrides: `<Override PartName="/word/%C3%84.xml" ContentType="${CONTENT_TYPES.DOCX}"/>` }],
    ['an Override naming the part with a KELVIN SIGN for a plain "k"',
      { target: 'word/kdoc.xml', entryName: 'word/kdoc.xml', defaultType: CONTENT_TYPES.DOCM, overrides: `<Override PartName="/word/%E2%84%AAdoc.xml" ContentType="${CONTENT_TYPES.DOCX}"/>` }],
    ['two Overrides differing only by Unicode case',
      { target: 'word/%C3%A4.xml', entryName: 'word/ä.xml', overrides: `<Override PartName="/word/%C3%A4.xml" ContentType="${CONTENT_TYPES.DOCX}"/><Override PartName="/word/%C3%84.xml" ContentType="${CONTENT_TYPES.DOCM}"/>` }],
  ])('%s is refused as ambiguous', async (_label, options) => {
    expect(await docx(unicodePackage(options))).toEqual({ ok: false, reason: 'DOCX_CONTENT_TYPES_AMBIGUOUS' });
  });

  it.each([
    ['raw in both places', { target: 'word/résumé.xml', entryName: 'word/résumé.xml', overrides: `<Override PartName="/word/résumé.xml" ContentType="${CONTENT_TYPES.DOCX}"/>`, defaultType: 'application/xml' }],
    ['escaped in the Override, raw in the relationship (the same OPC name)', { target: 'word/résumé.xml', entryName: 'word/résumé.xml', overrides: `<Override PartName="/word/r%C3%A9sum%C3%A9.xml" ContentType="${CONTENT_TYPES.DOCX}"/>`, defaultType: 'application/xml' }],
    ['ASCII case differences only (OPC folds those)', { target: 'Word/Document.XML', entryName: 'word/document.xml', overrides: `<Override PartName="/WORD/document.xml" ContentType="${CONTENT_TYPES.DOCX}"/>`, defaultType: 'application/xml' }],
  ])('a non-ASCII or case-varied main part name that means one thing is accepted: %s', async (_label, options) => {
    expect(await docx(unicodePackage(options))).toEqual({ ok: true });
  });

  it.each([
    ['two relationships with one Id', packageRelsXml({ extra: '<Relationship Id="rId1" Type="http://example.invalid/other" Target="docProps/app.xml"/>' }), 'DOCX_RELATIONSHIPS_AMBIGUOUS'],
    ['a second officeDocument relationship differing only by case', packageRelsXml({ extra: `<Relationship Id="rId2" Type="${OFFICE_DOCUMENT.toUpperCase()}" Target="word/other.xml"/>` }), 'DOCX_MAIN_DOCUMENT_RELATIONSHIP'],
    ['an officeDocument type only in another case', packageRelsXml({ type: OFFICE_DOCUMENT.replace('officeDocument/2006', 'OfficeDocument/2006') }), 'DOCX_MAIN_DOCUMENT_RELATIONSHIP'],
    ['a TargetMode outside the schema', packageRelsXml().replace('Target="word/document.xml"', 'Target="word/document.xml" TargetMode="internal"'), 'DOCX_RELATIONSHIPS_INVALID'],
    ['an Id that is not an XML ID', packageRelsXml().replace('Id="rId1"', 'Id="1 2"'), 'DOCX_RELATIONSHIPS_INVALID'],
    // xs:anyURI collapses white space: a schema-validating reader sees a second officeDocument here.
    ['a second officeDocument relationship hidden by surrounding white space', packageRelsXml({ extra: `<Relationship Id="rId2" Type=" ${OFFICE_DOCUMENT} " Target="word/other.xml"/>` }), 'DOCX_RELATIONSHIPS_INVALID'],
  ])('%s', async (_label, xml, reason) => {
    expect(await docx(withRels(xml))).toEqual({ ok: false, reason });
  });
});

describe('elements are identified by namespace, not by prefix', () => {
  it('a prefixed root in the OPC namespace is the same document (accepted)', async () => {
    const xml = `${declaration}<ct:Types xmlns:ct="${CT_NAMESPACE}">` +
      '<ct:Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      `<ct:Override PartName="/word/document.xml" ContentType="${CONTENT_TYPES.DOCX}"/></ct:Types>`;
    expect(await docx(withTypes(xml))).toEqual({ ok: true });
  });

  it.each([
    ['an Override in a foreign namespace after the real one', types(`${docmOverride}<x:Override xmlns:x="http://example.invalid/ns" PartName="/word/document.xml" ContentType="${CONTENT_TYPES.DOCX}"/>`), 'DOCX_CONTENT_TYPES_INVALID'],
    ['an Override in no namespace (xmlns="")', types(`${docmOverride}<Override xmlns="" PartName="/word/document.xml" ContentType="${CONTENT_TYPES.DOCX}"/>`), 'DOCX_CONTENT_TYPES_INVALID'],
    ['an OPC-named root in a foreign namespace, with OPC-namespaced children', `${declaration}<Types xmlns="http://example.invalid/ns"><c:Override xmlns:c="${CT_NAMESPACE}" PartName="/word/document.xml" ContentType="${CONTENT_TYPES.DOCX}"/></Types>`, 'DOCX_PACKAGE_INVALID'],
    ['an unbound element prefix', types(`<q:Override PartName="/word/document.xml" ContentType="${CONTENT_TYPES.DOCX}"/>`), 'DOCX_XML_NAMESPACE_INVALID'],
    ['an unbound attribute prefix', types(`<Override q:x="1" PartName="/word/document.xml" ContentType="${CONTENT_TYPES.DOCX}"/>`), 'DOCX_XML_NAMESPACE_INVALID'],
    ['a prefix bound to the empty string', types(`<Override xmlns:q="" PartName="/word/document.xml" ContentType="${CONTENT_TYPES.DOCX}"/>`), 'DOCX_XML_NAMESPACE_INVALID'],
    ['the xml prefix re-bound', types(DOCX_OVERRIDE, `<Types xmlns="${CT_NAMESPACE}" xmlns:xml="http://example.invalid/ns">`), 'DOCX_XML_NAMESPACE_INVALID'],
    ['one attribute twice through two prefixes for one namespace', types(`<Override xmlns:a="http://example.invalid/ns" xmlns:b="http://example.invalid/ns" a:x="1" b:x="2" PartName="/word/document.xml" ContentType="${CONTENT_TYPES.DOCX}"/>`), 'DOCX_XML_INVALID'],
    ['an attribute the OPC schema does not define', types(`<Override PartName="/word/document.xml" ContentType="${CONTENT_TYPES.DOCX}" Extension="xml"/>`), 'DOCX_CONTENT_TYPES_INVALID'],
    ['an element nested in an Override', types(`<Override PartName="/word/document.xml" ContentType="${CONTENT_TYPES.DOCX}"><Default Extension="bin" ContentType="a/b"/></Override>`), 'DOCX_CONTENT_TYPES_INVALID'],
    ['an unknown OPC-namespace element', types(`${DOCX_OVERRIDE}<Extra/>`), 'DOCX_CONTENT_TYPES_INVALID'],
    ['an attribute on the root', types(DOCX_OVERRIDE, `<Types xmlns="${CT_NAMESPACE}" Version="2">`), 'DOCX_CONTENT_TYPES_INVALID'],
  ])('%s', async (_label, xml, reason) => {
    expect(await docx(withTypes(xml))).toEqual({ ok: false, reason });
  });

  it('a relationships root in the wrong namespace is refused', async () => {
    expect(await docx(withRels(packageRelsXml().replace(RELS_NAMESPACE, CT_NAMESPACE)))).toEqual({ ok: false, reason: 'DOCX_PACKAGE_INVALID' });
  });
});

describe('malformed XML is refused, never half-read', () => {
  it.each([
    ['an unclosed root', types(DOCX_OVERRIDE).replace('</Types>', '')],
    ['a mismatched end tag', types(DOCX_OVERRIDE).replace('</Types>', '</Type>')],
    ['a second root element', `${types(docmOverride)}<Types xmlns="${CT_NAMESPACE}">${DOCX_OVERRIDE}</Types>`],
    ['character data between elements', types(`${DOCX_OVERRIDE}QA`)],
    ['an unterminated comment', types(`${DOCX_OVERRIDE}<!-- unterminated`)],
    ['"--" inside a comment', types(`${DOCX_OVERRIDE}<!-- a -- b -->`)],
    ['an unterminated processing instruction', types(`${DOCX_OVERRIDE}<?qa unterminated`)],
    ['an XML declaration that is not at the start', `\n${types(DOCX_OVERRIDE)}`],
    ['a second XML declaration', types(`<?xml version="1.0"?>${DOCX_OVERRIDE}`)],
    ['a declared encoding that is not the real one', types(DOCX_OVERRIDE).replace('encoding="UTF-8"', 'encoding="ISO-8859-1"')],
    ['an unquoted attribute', types('<Override PartName=/word/document.xml ContentType="a/b"/>')],
    ['"<" in an attribute value', types('<Override PartName="/word/<document.xml" ContentType="a/b"/>')],
    ['a character reference to NUL', types('<Override PartName="/word/document.xml" ContentType="a/b&#0;"/>')],
    ['a raw control character', types(`${DOCX_OVERRIDE}\u0001`)],
    ['a non-breaking space where XML needs white space', types(`<Override PartName="/word/document.xml" ContentType="${CONTENT_TYPES.DOCX}"/>`)],
  ])('%s', async (_label, xml) => {
    expect(await docx(withTypes(xml))).toEqual({ ok: false, reason: 'DOCX_XML_INVALID' });
  });

  it('UTF-16 with a byte-order mark and a matching declaration is read (accepted)', async () => {
    const xml = contentTypesXml().replace('encoding="UTF-8"', 'encoding="UTF-16"');
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]);
    expect(await docx(withTypes(bytes))).toEqual({ ok: true });
  });

  it('UTF-16 bytes declaring UTF-8 are refused', async () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(contentTypesXml(), 'utf16le')]);
    expect(await docx(withTypes(bytes))).toEqual({ ok: false, reason: 'DOCX_XML_INVALID' });
  });
});

describe('the reader stays bounded', () => {
  it('refuses more elements than any package needs, quickly', async () => {
    const many = Array.from({ length: 4100 }, (_unused, index) => `<Default Extension="e${index}" ContentType="a/b"/>`).join('');
    const started = performance.now();
    expect(await docx(buildZip([{ name: '[Content_Types].xml', method: 0, data: types(`${DOCX_OVERRIDE}${many}`) }, ...docxEntries().slice(1)])))
      .toEqual({ ok: false, reason: 'DOCX_XML_LIMIT' });
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it('refuses deep nesting', async () => {
    const deep = `${'<Default>'.repeat(10)}${'</Default>'.repeat(10)}`;
    expect(await docx(withTypes(types(`${DOCX_OVERRIDE}${deep}`)))).toEqual({ ok: false, reason: 'DOCX_XML_LIMIT' });
  });

  it.each([
    ['~250,000 characters of comments', () => types(`${DOCX_OVERRIDE}${'<!-- c -->'.repeat(25_000)}`)],
    ['~250,000 characters inside one comment', () => types(`${DOCX_OVERRIDE}<!--${'-x'.repeat(125_000)} -->`)],
    ['~250,000 "<" characters inside one comment', () => types(`${DOCX_OVERRIDE}<!--${'<'.repeat(250_000)}-->`)],
    ['~250,000 characters of white space', () => types(`${DOCX_OVERRIDE}${' '.repeat(250_000)}`)],
  ])('reads %s in linear time', async (_label, build) => {
    const started = performance.now();
    await docx(buildZip([{ name: '[Content_Types].xml', method: 0, data: build() }, ...docxEntries().slice(1)]));
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe('real HTTP: the disguised packages are refused and nothing is stored', () => {
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

  const upload = (data) =>
    request(harness.app).post(INTAKE_PATH).attach('resume', data, { filename: 'synthetic.docx', contentType: DOCX_MIME });

  it.each([
    ['the review reproduction (commented Override in the real .docm)', commentDisguisedDocm, 'DOCX_MACRO_ENABLED'],
    ['the only main-part declaration inside a comment', () => withTypes(types(`<!--${DOCX_OVERRIDE}-->`)), 'DOCX_NOT_WORD_DOCUMENT'],
    ['two conflicting Overrides', () => withTypes(types(`${docmOverride}${DOCX_OVERRIDE}`)), 'DOCX_CONTENT_TYPES_AMBIGUOUS'],
    ['an Override in a foreign namespace', () => withTypes(types(`${docmOverride}<x:Override xmlns:x="http://example.invalid/ns" PartName="/word/document.xml" ContentType="${CONTENT_TYPES.DOCX}"/>`)), 'DOCX_CONTENT_TYPES_INVALID'],
    ['malformed XML (a second root)', () => withTypes(`${types(docmOverride)}<Types xmlns="${CT_NAMESPACE}">${DOCX_OVERRIDE}</Types>`), 'DOCX_XML_INVALID'],
  ])('%s -> 422 INVALID_RESUME_FILE', async (_label, build, reason) => {
    const response = await upload(build());
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INVALID_RESUME_FILE');
    expect(response.body.error.fieldErrors).toEqual([expect.objectContaining({ field: 'resume', code: 'INVALID_RESUME_FILE' })]);
    expect(JSON.stringify(response.body)).not.toMatch(/DOCX_|reason/);
    expect(env.storedObjects()).toEqual([]);
    expect(env.tempFiles()).toEqual([]);
    expect(env.uploadArea.ownedCount).toBe(0);
    expect(log.output()).toContain(`"reason":"${reason}"`);
  });

  it('a genuine document through the same route is still stored (201)', async () => {
    const response = await upload(buildZip(docxEntries()));
    expect(response.status).toBe(201);
    expect(env.storedObjects()).toHaveLength(1);
  });
});
