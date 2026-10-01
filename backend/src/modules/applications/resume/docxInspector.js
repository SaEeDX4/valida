import { DOCX_INSPECTION_LIMITS } from '../../../config/resumePolicy.js';
import { readZipDirectory, readZipEntry, ZipRejection } from './zipInspector.js';
import { parsePackageXml, PackageXmlError } from './packageXml.js';

/**
 * DOCX structure check — Milestone B4.
 *
 * Doc 09 section 100 and Doc 13 section 63: a DOCX must be structurally
 * consistent with a Word document, not merely any ZIP renamed ".docx"; Doc 09
 * section 96 and Doc 13 section 59: macro-enabled Word formats are refused.
 *
 * A Word document is an Open Packaging Conventions (OPC) package. The check
 * follows the package the way Word itself locates the document:
 *
 *   1. the ZIP must pass the bounded, strict reader (zipInspector.js);
 *   2. `[Content_Types].xml` and `_rels/.rels` must exist and be well-formed,
 *      namespace-valid XML (packageXml.js) whose root is the OPC element in
 *      the OPC namespace, holding only the elements and attributes the OPC
 *      schema defines;
 *   3. `_rels/.rels` must contain exactly one internal officeDocument
 *      relationship (transitional or strict namespace), whose target part
 *      must exist in the ZIP;
 *   4. that part's content type must be exactly the WordprocessingML
 *      document type. The macro-enabled (.docm), template (.dotx/.dotm) and
 *      every other Office type (a renamed .xlsx or .pptx) are refused;
 *   5. no VBA project may be present anywhere — by content type
 *      (vbaProject, vbaData) or by part name — so a .docm renamed .docx with a
 *      doctored content type is still refused.
 *
 * NO AMBIGUITY (review r1, finding 1). The package must mean ONE thing. The
 * r1 reader matched tag-shaped text anywhere — including inside an XML
 * comment — and let a later match overwrite an earlier declaration, so a
 * commented-out "ordinary document" Override disguised a macro-enabled
 * package. Now only real elements are declarations, and a package that
 * declares the same thing twice is refused instead of resolved by order:
 *
 *   - two Default elements for one extension, or two Override elements for
 *     one part name, are refused — names are unescaped and compared both as
 *     OPC compares them (ASCII case-insensitive) and as wider readers might
 *     (Unicode case-insensitive), so "/word/document.xml" cannot be
 *     re-declared as "/WORD/Document.XML", through an escaped variant, or
 *     through a Unicode case variant; and a declaration that only a wider
 *     reader would apply to the main part is refused too (see "COMPARING
 *     NAMES" below);
 *   - two relationships with one Id are refused, and so is any second
 *     relationship whose type differs from officeDocument only by case;
 *   - part names, extensions and content types must be syntactically valid
 *     (a part name with "." or ".." segments, an encoded "/" or an encoded
 *     unreserved character has no single meaning and is refused);
 *   - attribute values with surrounding white space are refused: a
 *     schema-validating reader would trim them, this one compares exactly.
 *
 * Only `[Content_Types].xml` and `_rels/.rels` are decompressed (each capped
 * at DOCX_INSPECTION_LIMITS.maxInspectedPartBytes) and parsed, in linear
 * time, with no DTD and no entity expansion of any kind (packageXml.js).
 * Doc 13 section 76 asks for the minimum parsing and the minimum
 * dependencies; these two small parts need no general XML library.
 *
 * The document body itself is not parsed or rendered. Structural validity is
 * not a malware verdict: the file stays NOT_SCANNED (Doc 10 section 105).
 */
export const WORDPROCESSING_DOCUMENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

const MACRO_DOCUMENT_TYPES = new Set([
  'application/vnd.ms-word.document.macroenabled.main+xml',
  'application/vnd.ms-word.template.macroenabledtemplate.main+xml',
]);
const TEMPLATE_DOCUMENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml';
const MACRO_PART_TYPES = new Set(['application/vnd.ms-office.vbaproject', 'application/vnd.ms-word.vbadata+xml']);
const MACRO_PART_NAMES = /(^|\/)(vbaproject\.bin|vbadata\.xml)$/i;

const CONTENT_TYPES_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/content-types';
const RELATIONSHIPS_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOCUMENT_RELATIONSHIPS = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument',
]);
const OFFICE_DOCUMENT_RELATIONSHIPS_ANY_CASE = new Set([...OFFICE_DOCUMENT_RELATIONSHIPS].map((type) => type.toLowerCase()));

/** The attributes the OPC schemas define — nothing else is accepted. */
const DEFAULT_ATTRIBUTES = new Set(['Extension', 'ContentType']);
const OVERRIDE_ATTRIBUTES = new Set(['PartName', 'ContentType']);
const RELATIONSHIP_ATTRIBUTES = new Set(['Id', 'Type', 'Target', 'TargetMode']);

class DocxRejection extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}
const refuse = (reason) => {
  throw new DocxRejection(reason);
};

/**
 * @param {{ size: number, read: Function }} reader
 * @returns {Promise<{ ok: true } | { ok: false, reason: string }>}
 */
export async function inspectDocx(reader, limits = DOCX_INSPECTION_LIMITS) {
  try {
    const zip = await readZipDirectory(reader, limits);

    const contentTypesEntry = zip.byName.get('[content_types].xml') ?? refuse('DOCX_CONTENT_TYPES_MISSING');
    const relationshipsEntry = zip.byName.get('_rels/.rels') ?? refuse('DOCX_RELATIONSHIPS_MISSING');

    const types = parseContentTypes(readXml(await readZipEntry(reader, contentTypesEntry, limits.maxInspectedPartBytes)));
    const relationships = parseRelationships(
      readXml(await readZipEntry(reader, relationshipsEntry, limits.maxInspectedPartBytes)),
    );

    // 5. No VBA anywhere — by declared type, or by part name (raw, unescaped
    // or case-folded in any way a reader might).
    const declaredTypes = [...types.defaults.values(), ...types.overrides.values()];
    if (declaredTypes.some((type) => MACRO_PART_TYPES.has(mediaTypeEssence(type)))) refuse('DOCX_MACRO_CONTENT');
    if (zip.entries.some((entry) => [entry.name, looseUnescape(entry.name)].some((name) => MACRO_PART_NAMES.test(wideFold(name))))) {
      refuse('DOCX_MACRO_CONTENT');
    }

    // 3. The main document, as Word finds it. A second relationship whose
    // type differs only by case is ambiguous, not ignorable.
    const officeDocuments = relationships.filter((relationship) =>
      OFFICE_DOCUMENT_RELATIONSHIPS_ANY_CASE.has(relationship.type.toLowerCase()),
    );
    if (officeDocuments.length !== 1 || !OFFICE_DOCUMENT_RELATIONSHIPS.has(officeDocuments[0].type)) {
      refuse('DOCX_MAIN_DOCUMENT_RELATIONSHIP');
    }
    const [main] = officeDocuments;
    if (main.targetMode !== 'Internal') refuse('DOCX_MAIN_DOCUMENT_RELATIONSHIP');
    const partName = resolvePartName(main.target) ?? refuse('DOCX_MAIN_DOCUMENT_INVALID');
    const part = partNameKeys(partName) ?? refuse('DOCX_MAIN_DOCUMENT_INVALID');

    // The ZIP item: exactly one, whichever comparison a reader uses.
    const entryKeys = (entry) => ({ strict: asciiFold(looseUnescape(entry.name)), wide: wideFold(looseUnescape(entry.name)) });
    const mainEntries = zip.entries.filter((entry) => entryKeys(entry).strict === part.strict.slice(1));
    if (mainEntries.length === 0) refuse('DOCX_MAIN_DOCUMENT_MISSING');
    if (zip.entries.filter((entry) => entryKeys(entry).wide === part.wide.slice(1)).length > 1) refuse('DOCX_PACKAGE_AMBIGUOUS');
    const [mainEntry] = mainEntries;
    if (mainEntry.uncompressedSize === 0 || mainEntry.name.endsWith('/')) refuse('DOCX_MAIN_DOCUMENT_EMPTY');

    // 4. Its content type decides what the package is — the Override that
    // names it under OPC's comparison, or else the Default for its extension.
    // A declaration that only a Unicode-case-insensitive reader would apply
    // to it is ambiguous: readers would disagree about the type.
    const mainType = lookupDeclaration(types.overrides, part) ?? lookupDeclaration(types.defaults, extensionKeys(part.unescaped)) ?? '';
    const mainEssence = mediaTypeEssence(mainType);
    if (MACRO_DOCUMENT_TYPES.has(mainEssence)) refuse('DOCX_MACRO_ENABLED');
    if (mainEssence === TEMPLATE_DOCUMENT_TYPE) refuse('DOCX_TEMPLATE');
    if (mainType !== WORDPROCESSING_DOCUMENT_TYPE) refuse('DOCX_NOT_WORD_DOCUMENT');

    return { ok: true };
  } catch (error) {
    if (error instanceof ZipRejection || error instanceof DocxRejection || error instanceof PackageXmlError) {
      return { ok: false, reason: error.reason };
    }
    throw error;
  }
}

// ------------------------------------------------------------- XML reading --

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Decodes a package part (UTF-8, or UTF-16 with a BOM) and parses its structure. */
function readXml(bytes) {
  let text;
  let encoding = 'utf-8';
  try {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2));
      encoding = 'utf-16';
    } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      text = new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2));
      encoding = 'utf-16';
    } else {
      text = utf8.decode(bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes);
    }
  } catch {
    refuse('DOCX_XML_INVALID');
  }
  // Kept from r1 as an early, independent refusal: a DOCTYPE or ENTITY
  // declaration anywhere — never present in a genuine package part.
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(text)) refuse('DOCX_XML_DTD');
  return parsePackageXml(text, { encoding });
}

/** A required or optional attribute: exact, with no surrounding white space. */
function attribute(element, name, reason, { required = true } = {}) {
  const value = element.attributes.get(name);
  if (value === undefined) {
    if (required) refuse(reason);
    return undefined;
  }
  if (value === '' || value !== value.trim()) refuse(reason);
  return value;
}

function onlyAttributes(element, allowed, reason) {
  for (const name of element.attributes.keys()) if (!allowed.has(name)) refuse(reason);
}

/*
 * A media type (RFC 9110 / the OPC ST_ContentType pattern): token "/" token,
 * optional ";" parameters. Tokens exclude separators and white space, so the
 * pattern cannot backtrack.
 */
const TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
const MEDIA_TYPE = new RegExp(`^${TOKEN}/${TOKEN}(?:[ \\t]*;[ \\t]*${TOKEN}=(?:${TOKEN}|"(?:[^"\\\\\\x00-\\x1f\\x7f]|\\\\[\\x20-\\x7e])*"))*$`);

function contentType(element, reason) {
  const value = attribute(element, 'ContentType', reason);
  if (!MEDIA_TYPE.test(value)) refuse(reason);
  return value.toLowerCase();
}

/** "type/subtype" in lower case, without parameters. */
function mediaTypeEssence(type) {
  const semicolon = type.indexOf(';');
  return (semicolon === -1 ? type : type.slice(0, semicolon)).trim().toLowerCase();
}

function parseContentTypes(root) {
  if (root.namespace !== CONTENT_TYPES_NAMESPACE || root.localName !== 'Types') refuse('DOCX_PACKAGE_INVALID');
  onlyAttributes(root, new Set(), 'DOCX_CONTENT_TYPES_INVALID');
  const defaults = new Declarations();
  const overrides = new Declarations();
  for (const child of root.children) {
    if (child.namespace !== CONTENT_TYPES_NAMESPACE || child.children.length > 0) refuse('DOCX_CONTENT_TYPES_INVALID');
    if (child.localName === 'Default') {
      onlyAttributes(child, DEFAULT_ATTRIBUTES, 'DOCX_CONTENT_TYPES_INVALID');
      const extension = attribute(child, 'Extension', 'DOCX_CONTENT_TYPES_INVALID');
      const keys = canonicalExtension(extension) ?? refuse('DOCX_CONTENT_TYPES_INVALID');
      defaults.add(keys, contentType(child, 'DOCX_CONTENT_TYPES_INVALID'));
    } else if (child.localName === 'Override') {
      onlyAttributes(child, OVERRIDE_ATTRIBUTES, 'DOCX_CONTENT_TYPES_INVALID');
      const partName = attribute(child, 'PartName', 'DOCX_CONTENT_TYPES_INVALID');
      const keys = partNameKeys(partName) ?? refuse('DOCX_CONTENT_TYPES_INVALID');
      overrides.add(keys, contentType(child, 'DOCX_CONTENT_TYPES_INVALID'));
    } else {
      refuse('DOCX_CONTENT_TYPES_INVALID');
    }
  }
  return { defaults, overrides };
}

/** xsd:ID is an NCName; OPC relationship Ids are ASCII in every producer. */
const RELATIONSHIP_ID = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

function parseRelationships(root) {
  if (root.namespace !== RELATIONSHIPS_NAMESPACE || root.localName !== 'Relationships') refuse('DOCX_PACKAGE_INVALID');
  onlyAttributes(root, new Set(), 'DOCX_RELATIONSHIPS_INVALID');
  const ids = new Set();
  return root.children.map((child) => {
    if (child.namespace !== RELATIONSHIPS_NAMESPACE || child.localName !== 'Relationship' || child.children.length > 0) {
      refuse('DOCX_RELATIONSHIPS_INVALID');
    }
    onlyAttributes(child, RELATIONSHIP_ATTRIBUTES, 'DOCX_RELATIONSHIPS_INVALID');
    const id = attribute(child, 'Id', 'DOCX_RELATIONSHIPS_INVALID');
    const type = attribute(child, 'Type', 'DOCX_RELATIONSHIPS_INVALID');
    const target = attribute(child, 'Target', 'DOCX_RELATIONSHIPS_INVALID');
    const targetMode = attribute(child, 'TargetMode', 'DOCX_RELATIONSHIPS_INVALID', { required: false }) ?? 'Internal';
    if (!RELATIONSHIP_ID.test(id)) refuse('DOCX_RELATIONSHIPS_INVALID');
    if (targetMode !== 'Internal' && targetMode !== 'External') refuse('DOCX_RELATIONSHIPS_INVALID');
    if (ids.has(id)) refuse('DOCX_RELATIONSHIPS_AMBIGUOUS');
    ids.add(id);
    return { type, target, targetMode };
  });
}

// ---------------------------------------------------------- OPC part names --

const UNRESERVED = /^[A-Za-z0-9._~-]$/;
const PERCENT = /%([0-9A-Fa-f]{2})/g;
/** RFC 3987 pchar: unreserved, sub-delims, ":", "@", percent-encoded, or a non-ASCII ucschar. */
const PART_NAME_CHARACTERS =
  /^(?:[A-Za-z0-9._~!$&'()*+,;=:@/-]|%[0-9A-Fa-f]{2}|[\u00a0-\ud7ff\uf900-\ufdcf\ufdf0-\uffef\u{10000}-\u{efffd}])+$/u;
const EXTENSION_CHARACTERS = /^(?:[A-Za-z0-9_~!$&'()*+,;=:@-]|%[0-9A-Fa-f]{2}|[\u00a0-\ud7ff\uf900-\ufdcf\ufdf0-\uffef\u{10000}-\u{efffd}])+$/u;

/**
 * Decodes percent-encoding. Returns null when an escape encodes something a
 * part name may not contain escaped (an unreserved character, "/" or "\\"),
 * or the bytes are not UTF-8 — such a name has no single meaning.
 */
function unescapePart(value) {
  for (const [, hex] of value.matchAll(PERCENT)) {
    const character = String.fromCharCode(Number.parseInt(hex, 16));
    if (UNRESERVED.test(character) || character === '/' || character === '\\') return null;
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/*
 * COMPARING NAMES. OPC compares part names and extensions ASCII
 * case-insensitively (ECMA-376 Part 2, 6.2.2.3) after unescaping; that is the
 * STRICT key. Some readers fold case more widely (.NET's OrdinalIgnoreCase
 * maps "ä" to "Ä", "ſ" to "S"; JavaScript lower-casing maps the Kelvin sign
 * to "k"), so every name also gets a WIDE key (full Unicode upper- then
 * lower-casing, which merges all of those). Two declarations with equal wide
 * keys are refused as ambiguous, and a declaration is applied to a part only
 * when its STRICT key matches — if only its wide key does, readers would
 * disagree, and the package is refused (review r2 pre-submission finding).
 */
const asciiFold = (value) => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
const wideFold = (value) => value.toUpperCase().toLowerCase();

/** Declarations (Defaults or Overrides) keyed both ways; a wide-key repeat is ambiguous. */
class Declarations {
  #strict = new Map();
  #wide = new Set();

  add({ strict, wide }, type) {
    if (this.#wide.has(wide)) refuse('DOCX_CONTENT_TYPES_AMBIGUOUS');
    this.#wide.add(wide);
    this.#strict.set(strict, type);
  }

  values() {
    return this.#strict.values();
  }

  /** The type declared for exactly these keys; undefined if none; refuses a wide-only match. */
  get({ strict, wide }) {
    if (this.#strict.has(strict)) return this.#strict.get(strict);
    if (this.#wide.has(wide)) refuse('DOCX_CONTENT_TYPES_AMBIGUOUS');
    return undefined;
  }
}

const lookupDeclaration = (declarations, keys) => (keys === null ? undefined : declarations.get(keys));

/**
 * The comparison keys of an OPC part name (ECMA-376 Part 2, 6.2.2), or null
 * if the name is invalid: it must start with "/", have no empty segment, no
 * segment ending in "." (so no "." or ".." segments) and valid escapes.
 */
function partNameKeys(name) {
  if (typeof name !== 'string' || !name.startsWith('/') || !PART_NAME_CHARACTERS.test(name)) return null;
  if (name.slice(1).split('/').some((segment) => segment === '' || segment.endsWith('.'))) return null;
  const unescaped = unescapePart(name);
  return unescaped === null ? null : { unescaped, strict: asciiFold(unescaped), wide: wideFold(unescaped) };
}

function canonicalExtension(extension) {
  if (!EXTENSION_CHARACTERS.test(extension)) return null;
  const unescaped = unescapePart(extension);
  return unescaped === null ? null : { strict: asciiFold(unescaped), wide: wideFold(unescaped) };
}

/** The keys of the extension of an (unescaped) part name, or null when it has none. */
function extensionKeys(unescapedPartName) {
  const last = unescapedPartName.slice(unescapedPartName.lastIndexOf('/') + 1);
  const dot = last.lastIndexOf('.');
  if (dot === -1) return null;
  const extension = last.slice(dot + 1);
  return { strict: asciiFold(extension), wide: wideFold(extension) };
}

/**
 * A ZIP entry name unescaped, best effort: entries are not all valid part
 * names ("[Content_Types].xml"), so an undecodable name is compared as it is
 * written. Used for lookups and the VBA name check, never to accept anything.
 */
function looseUnescape(entryName) {
  try {
    return decodeURIComponent(entryName);
  } catch {
    return entryName;
  }
}

/**
 * Resolves a package-relationship target (relative to the package root) to
 * a part name ("/word/document.xml"), or null when it is not a plain,
 * in-package path.
 */
function resolvePartName(target) {
  if (/[\\?#]|^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) return null;
  const resolved = [];
  for (const segment of target.replace(/^\/+/, '').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (resolved.length === 0) return null;
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.length === 0 ? null : `/${resolved.join('/')}`;
}
