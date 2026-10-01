/**
 * Bounded, namespace-aware reader for Open Packaging Conventions XML parts
 * — Milestone B4 (review r1, finding 1).
 *
 * The DOCX check reads two tiny package parts, `[Content_Types].xml` and
 * `_rels/.rels`, to learn what the package really is. The r1 reader matched
 * tag-shaped TEXT anywhere in the part, so a tag inside an XML comment was
 * taken as a declaration and silently overrode the real one: a macro-enabled
 * document with a commented-out "ordinary document" Override was accepted.
 *
 * This reader parses the XML STRUCTURE instead, the way a conforming XML
 * parser does, so only real elements become declarations:
 *
 *   - comments and processing instructions are recognised as what they are
 *     and skipped — their text never becomes an element;
 *   - DOCTYPE (and so any entity declaration) is refused, never processed:
 *     there is no entity expansion of any kind. CDATA sections and
 *     non-whitespace character data are refused too — an OPC part holds
 *     only elements;
 *   - elements must nest and close properly, and there must be exactly one
 *     root element with nothing but whitespace, comments and processing
 *     instructions around it;
 *   - namespaces are resolved (Namespaces in XML 1.0): an element is
 *     identified by its namespace URI and local name, never by its prefix,
 *     an unbound prefix is an error, and the reserved `xml` / `xmlns`
 *     bindings are enforced;
 *   - a repeated attribute — by raw name or by namespace-expanded name — is
 *     an error rather than "last one wins";
 *   - attribute values are normalised as XML requires (literal tab and line
 *     breaks become spaces) and may contain only the five predefined entity
 *     references and character references to legal XML characters.
 *
 * It is deliberately small and strict: ASCII names only, no DTD, no external
 * anything. Every scan moves forward (indexOf and sticky, anchored patterns
 * over slices that end at the next "<"), so time is linear in the part size,
 * which the ZIP reader has already capped (DOCX_INSPECTION_LIMITS); element
 * count, depth, attribute count and tag length are bounded as well.
 *
 * It returns the element tree only; what the elements MEAN (which root,
 * which children, which attributes) is decided by docxInspector.js.
 */
export const PACKAGE_XML_LIMITS = Object.freeze({
  /** Far above any genuine part: the ZIP reader allows at most 1000 parts. */
  maxElements: 4096,
  /** OPC parts are two levels deep. */
  maxDepth: 8,
  maxAttributes: 32,
  /** No genuine package tag comes anywhere near this. */
  maxTagLength: 8 * 1024,
});

export const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';

export class PackageXmlError extends Error {
  /** @param {'DOCX_XML_INVALID' | 'DOCX_XML_DTD' | 'DOCX_XML_NAMESPACE_INVALID' | 'DOCX_XML_LIMIT'} reason */
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}
const fail = (reason = 'DOCX_XML_INVALID') => {
  throw new PackageXmlError(reason);
};

// XML 1.0: the characters a document may contain at all (section 2.2).
const ILLEGAL_CHARACTER = /[^\t\n\r -퟿-�\u{10000}-\u{10ffff}]/u;
// XML white space is exactly these four (section 2.3) — not Unicode spaces.
const WHITESPACE_ONLY = /^[ \t\n]*$/;
const NAME = '[A-Za-z_][A-Za-z0-9_.-]*';
const QNAME = new RegExp(`(${NAME})(?::(${NAME}))?`, 'y');
const ATTRIBUTE = new RegExp(`[ \\t\\n]+(${NAME}(?::${NAME})?)[ \\t\\n]*=[ \\t\\n]*(?:"([^"<]*)"|'([^'<]*)')`, 'y');
const TAG_CLOSE = /[ \t\n]*(\/?)>/y;
const END_TAG_CLOSE = /[ \t\n]*>/y;
const XML_DECLARATION =
  /^<\?xml[ \t\n]+version[ \t\n]*=[ \t\n]*(["'])1\.[0-9]\1(?:[ \t\n]+encoding[ \t\n]*=[ \t\n]*(["'])([A-Za-z][A-Za-z0-9._-]*)\2)?(?:[ \t\n]+standalone[ \t\n]*=[ \t\n]*(["'])(?:yes|no)\4)?[ \t\n]*\?>/;
const PI_TARGET = new RegExp(`<\\?(${NAME}(?::${NAME})?)(?=[ \\t\\n]|\\?>)`, 'y');

const REFERENCE = /&(?:#x([0-9a-fA-F]{1,6})|#([0-9]{1,7})|(amp|lt|gt|quot|apos));/g;
const BAD_REFERENCE = /&(?!(?:#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);)/;
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Attribute-value normalisation (XML 1.0 section 3.3.3) and reference decoding. */
function attributeValue(raw) {
  if (BAD_REFERENCE.test(raw)) fail();
  return raw.replace(/[\t\n]/g, ' ').replace(REFERENCE, (_match, hex, decimal, named) => {
    if (named) return NAMED_ENTITIES[named];
    const codePoint = Number.parseInt(hex ?? decimal, hex ? 16 : 10);
    if (codePoint > 0x10ffff) fail();
    const character = String.fromCodePoint(codePoint);
    if (ILLEGAL_CHARACTER.test(character)) fail();
    return character;
  });
}

/**
 * Parses one package part.
 *
 * @param {string} text  the decoded part (BOM already removed)
 * @param {{ encoding: 'utf-8' | 'utf-16' }} detected  how the bytes were decoded;
 *   a declaration naming a different encoding is refused (two readers would
 *   otherwise disagree about the text)
 * @returns {{ namespace: string | null, localName: string, attributes: Map<string, string>, children: object[] }}
 *   the root element. Unqualified attributes are keyed by their name,
 *   namespaced ones as "{uri}local". Namespace declarations are not attributes.
 */
export function parsePackageXml(text, detected = { encoding: 'utf-8' }, limits = PACKAGE_XML_LIMITS) {
  // End-of-line handling (section 2.11), then the character check.
  const s = text.replace(/\r\n?/g, '\n');
  if (ILLEGAL_CHARACTER.test(s)) fail();

  let position = 0;
  if (s.startsWith('<?xml') && /^<\?xml[ \t\n?]/.test(s)) {
    const declaration = XML_DECLARATION.exec(s) ?? fail();
    const encoding = declaration[3]?.toLowerCase();
    if (encoding !== undefined) {
      const consistent = detected.encoding === 'utf-8' ? encoding === 'utf-8' : /^utf-16(le|be)?$/.test(encoding);
      if (!consistent) fail();
    }
    position = declaration[0].length;
  }

  /** @type {Array<{ element: object, qname: string, scope: Map<string, string> }>} */
  const stack = [];
  let root = null;
  let elementCount = 0;
  const baseScope = new Map([['xml', XML_NAMESPACE]]);

  while (position < s.length) {
    const next = s.indexOf('<', position);
    const textEnd = next === -1 ? s.length : next;
    // An OPC part holds only elements: character data must be white space.
    if (!WHITESPACE_ONLY.test(s.slice(position, textEnd))) fail();
    if (next === -1) break;
    position = next;

    if (s.startsWith('<!--', position)) {
      const end = s.indexOf('-->', position + 4);
      if (end === -1) fail();
      const body = s.slice(position + 4, end);
      if (body.includes('--') || body.endsWith('-')) fail();
      position = end + 3;
      continue;
    }
    if (s.startsWith('<!', position)) {
      // DOCTYPE (with its entity declarations) is never processed.
      if (/^<!DOCTYPE/i.test(s.slice(position, position + 9))) fail('DOCX_XML_DTD');
      fail(); // CDATA sections and anything else
    }
    if (s.startsWith('<?', position)) {
      PI_TARGET.lastIndex = position;
      const target = PI_TARGET.exec(s) ?? fail();
      if (target[1].toLowerCase() === 'xml') fail(); // a declaration is allowed only at the start
      const end = s.indexOf('?>', position + 2);
      if (end === -1) fail();
      position = end + 2;
      continue;
    }

    // An element tag. It cannot contain "<", so it ends before the next one;
    // the slice is also capped, keeping every pattern below bounded.
    const nextOpen = s.indexOf('<', position + 1);
    const sliceEnd = Math.min(nextOpen === -1 ? s.length : nextOpen, position + limits.maxTagLength + 1);
    const tag = s.slice(position, sliceEnd);

    if (tag.startsWith('</')) {
      QNAME.lastIndex = 2;
      const name = QNAME.exec(tag) ?? fail();
      END_TAG_CLOSE.lastIndex = QNAME.lastIndex;
      if (!END_TAG_CLOSE.exec(tag)) fail();
      const open = stack.pop() ?? fail();
      if (open.qname !== name[0]) fail();
      position += END_TAG_CLOSE.lastIndex;
      continue;
    }

    QNAME.lastIndex = 1;
    const name = QNAME.exec(tag) ?? fail();
    if (root !== null && stack.length === 0) fail(); // a second root element
    elementCount += 1;
    if (elementCount > limits.maxElements || stack.length + 1 > limits.maxDepth) fail('DOCX_XML_LIMIT');

    // Raw attributes, in order; a repeated raw name is an error.
    const raw = new Map();
    let cursor = QNAME.lastIndex;
    for (;;) {
      ATTRIBUTE.lastIndex = cursor;
      const match = ATTRIBUTE.exec(tag);
      if (!match) break;
      const [, attributeName, doubleQuoted, singleQuoted] = match;
      if (raw.has(attributeName)) fail();
      if (raw.size >= limits.maxAttributes) fail('DOCX_XML_LIMIT');
      raw.set(attributeName, attributeValue(doubleQuoted ?? singleQuoted));
      cursor = ATTRIBUTE.lastIndex;
    }
    TAG_CLOSE.lastIndex = cursor;
    const close = TAG_CLOSE.exec(tag);
    // Unterminated, stray text, or longer than maxTagLength (the slice ends there).
    if (!close) fail();
    const selfClosing = close[1] === '/';

    // Namespace declarations on this element extend the parent's scope.
    const parentScope = stack.length > 0 ? stack[stack.length - 1].scope : baseScope;
    let scope = parentScope;
    for (const [attributeName, value] of raw) {
      let prefix = null;
      if (attributeName === 'xmlns') prefix = '';
      else if (attributeName.startsWith('xmlns:')) prefix = attributeName.slice(6);
      else continue;
      if (scope === parentScope) scope = new Map(parentScope);
      if (prefix === 'xmlns') fail('DOCX_XML_NAMESPACE_INVALID');
      if (prefix === 'xml' ? value !== XML_NAMESPACE : value === XML_NAMESPACE || value === XMLNS_NAMESPACE) {
        fail('DOCX_XML_NAMESPACE_INVALID');
      }
      if (prefix !== '' && value === '') fail('DOCX_XML_NAMESPACE_INVALID'); // cannot unbind a prefix
      scope.set(prefix, value);
    }

    const [, first, second] = name;
    const elementPrefix = second === undefined ? '' : first;
    const localName = second ?? first;
    const namespace = scope.has(elementPrefix) ? scope.get(elementPrefix) || null : elementPrefix === '' ? null : fail('DOCX_XML_NAMESPACE_INVALID');

    // Ordinary attributes, keyed by expanded name; a repeat is an error.
    const attributes = new Map();
    for (const [attributeName, value] of raw) {
      if (attributeName === 'xmlns' || attributeName.startsWith('xmlns:')) continue;
      const colon = attributeName.indexOf(':');
      let key = attributeName;
      if (colon !== -1) {
        const prefix = attributeName.slice(0, colon);
        const uri = scope.get(prefix) || fail('DOCX_XML_NAMESPACE_INVALID');
        key = `{${uri}}${attributeName.slice(colon + 1)}`;
      }
      if (attributes.has(key)) fail();
      attributes.set(key, value);
    }

    const element = { namespace, localName, attributes, children: [] };
    if (stack.length === 0) root = element;
    else stack[stack.length - 1].element.children.push(element);
    if (!selfClosing) stack.push({ element, qname: name[0], scope });
    position += TAG_CLOSE.lastIndex;
  }

  if (root === null || stack.length > 0) fail();
  return root;
}
