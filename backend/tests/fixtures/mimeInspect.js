/**
 * B6 Stage 2 — MIME inspection for the template privacy and structure tests.
 * TEST INFRASTRUCTURE ONLY. Node built-ins only (no new dependency).
 *
 * What it does with one received message (the raw bytes the local SMTP test
 * server stored):
 *   - unfolds every header and decodes RFC 2047 encoded words STRICTLY: each
 *     encoded word must decode to whole characters on its own (a word that
 *     splits a UTF-8 sequence throws), so a broken subject cannot pass;
 *   - parses Content-Type / Content-Disposition parameters, including RFC 2231
 *     continuations and charsets (filename*, name*);
 *   - walks multipart bodies and reverses the transfer encoding
 *     (quoted-printable, base64) and then the charset (fatal on bad bytes);
 *   - decodes HTML character references for the HTML part.
 * surfaces() lists every place a value could appear — raw header lines,
 * decoded header values, parameters and decoded bodies — so a test can prove
 * that an encoding cannot hide a prohibited value.
 */

const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;
const ADJACENT_WORDS = /(=\?[^?\s]+\?[BbQq]\?[^?\s]*\?=)[ \t]+(?==\?[^?\s]+\?[BbQq]\?[^?\s]*\?=)/g;

const fromHex = (_match, hex) => String.fromCharCode(parseInt(hex, 16));

/** Decodes RFC 2047 encoded words in one (unfolded) header value. Strict: throws on an incomplete character. */
export function decodeWords(value) {
  const text = Buffer.from(value, 'latin1').toString('utf8');
  return text.replace(ADJACENT_WORDS, '$1').replace(ENCODED_WORD, (_word, charset, encoding, data) => {
    const bytes =
      encoding.toUpperCase() === 'B'
        ? Buffer.from(data, 'base64')
        : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, fromHex), 'latin1');
    return new TextDecoder(charset.split('*')[0], { fatal: true }).decode(bytes);
  });
}

const NAMED_REFERENCES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: String.fromCharCode(0xa0) };

/** Decodes numeric and the common named HTML character references. */
export function decodeHtmlEntities(value) {
  return value.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, reference) => {
    if (reference[0] === '#') {
      const code = reference[1] === 'x' || reference[1] === 'X' ? parseInt(reference.slice(2), 16) : parseInt(reference.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const name = reference.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED_REFERENCES, name) ? NAMED_REFERENCES[name] : match;
  });
}

/** `type; a=b; c*=utf-8''%E2%80%A6` -> { value, params } with RFC 2231 and quoted values decoded. */
export function parseParameters(headerValue) {
  const segments = [];
  let current = '';
  let quoted = false;
  for (const character of headerValue) {
    if (character === '"') quoted = !quoted;
    if (character === ';' && !quoted) {
      segments.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  segments.push(current);
  const [first = '', ...rest] = segments.map((segment) => segment.trim());
  const pieces = new Map();
  for (const segment of rest) {
    const equals = segment.indexOf('=');
    if (equals <= 0) continue;
    const rawName = segment.slice(0, equals).trim().toLowerCase();
    let rawValue = segment.slice(equals + 1).trim();
    if (rawValue.startsWith('"') && rawValue.endsWith('"')) rawValue = rawValue.slice(1, -1).replace(/\\(.)/g, '$1');
    const match = /^([^*]+)(?:\*(\d+))?(\*)?$/.exec(rawName);
    if (!match) continue;
    const [, base, index = '0', star] = match;
    if (!pieces.has(base)) pieces.set(base, []);
    pieces.get(base).push({ index: Number(index), encoded: Boolean(star), value: rawValue });
  }
  const params = {};
  for (const [base, list] of pieces) {
    list.sort((a, b) => a.index - b.index);
    let charset = 'utf-8';
    const bytes = [];
    let plain = '';
    let anyEncoded = false;
    list.forEach((piece, position) => {
      if (piece.encoded) {
        anyEncoded = true;
        let data = piece.value;
        if (position === 0) {
          const parts = data.split("'");
          if (parts.length >= 3) {
            charset = parts[0] || 'utf-8';
            data = parts.slice(2).join("'");
          }
        }
        bytes.push(Buffer.from(data.replace(/%([0-9A-Fa-f]{2})/g, fromHex), 'latin1'));
      } else {
        bytes.push(Buffer.from(piece.value, 'latin1'));
        plain += piece.value;
      }
    });
    params[base] = anyEncoded ? new TextDecoder(charset, { fatal: true }).decode(Buffer.concat(bytes)) : decodeWords(plain);
  }
  return { value: first.toLowerCase(), params };
}

function decodeTransfer(body, encoding) {
  if (encoding === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64');
  if (encoding === 'quoted-printable') return Buffer.from(body.replace(/=\r\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, fromHex), 'latin1');
  return Buffer.from(body, 'latin1');
}

function splitMultipart(body, boundary) {
  const pieces = body.split(`--${boundary}`);
  const parts = [];
  for (let index = 1; index < pieces.length; index += 1) {
    const piece = pieces[index];
    if (piece.startsWith('--')) break;
    parts.push(piece.replace(/^\r\n/, '').replace(/\r\n$/, ''));
  }
  return parts;
}

function parseEntity(source) {
  const end = source.indexOf('\r\n\r\n');
  const block = end === -1 ? source : source.slice(0, end);
  const body = end === -1 ? '' : source.slice(end + 4);
  const headers = block
    .replace(/\r\n(?=[ \t])/g, '')
    .split('\r\n')
    .filter((line) => line.includes(':'))
    .map((line) => {
      const colon = line.indexOf(':');
      const raw = line.slice(colon + 1).trim();
      return { name: line.slice(0, colon).trim().toLowerCase(), raw, value: decodeWords(raw) };
    });
  const header = (name) => headers.find((entry) => entry.name === name)?.raw;
  const contentType = parseParameters(header('content-type') ?? 'text/plain; charset=us-ascii');
  const disposition = header('content-disposition') ? parseParameters(header('content-disposition')) : null;
  const entity = { headers, type: contentType.value, params: contentType.params, disposition };
  if (entity.type.startsWith('multipart/')) {
    entity.parts = splitMultipart(body, contentType.params.boundary).map(parseEntity);
    return entity;
  }
  entity.transferEncoding = (header('content-transfer-encoding') ?? '7bit').toLowerCase();
  entity.bytes = decodeTransfer(body, entity.transferEncoding);
  entity.text = entity.type.startsWith('text/') ? new TextDecoder(contentType.params.charset ?? 'us-ascii', { fatal: true }).decode(entity.bytes) : null;
  return entity;
}

/** The parsed MIME tree of raw message bytes. */
export function parseMime(raw) {
  return parseEntity(Buffer.from(raw).toString('latin1'));
}

/** The decoded value of the first header `name` of an entity (or undefined). */
export function headerValue(entity, name) {
  return entity.headers.find((entry) => entry.name === name)?.value;
}

/** All leaf parts, depth-first. */
export function leaves(entity) {
  return entity.parts ? entity.parts.flatMap(leaves) : [entity];
}

/** The MIME tree as a compact structure: [type, [children]] or type. */
export function structure(entity) {
  return entity.parts ? { [entity.type]: entity.parts.map(structure) } : entity.type;
}

/** Every place a value can appear: raw and decoded headers, parameters, decoded bodies (HTML also entity-decoded). */
export function surfaces(entity, path = 'message') {
  const found = [];
  for (const entry of entity.headers) {
    found.push({ where: `${path} header ${entry.name} (raw)`, header: entry.name, text: entry.raw });
    found.push({ where: `${path} header ${entry.name} (decoded)`, header: entry.name, text: entry.value });
  }
  for (const [name, value] of Object.entries(entity.params ?? {})) found.push({ where: `${path} content-type ${name}`, header: 'content-type', text: value });
  for (const [name, value] of Object.entries(entity.disposition?.params ?? {})) found.push({ where: `${path} disposition ${name}`, header: 'content-disposition', text: value });
  if (entity.parts) {
    entity.parts.forEach((part, index) => found.push(...surfaces(part, `${path}/${index + 1}`)));
  } else if (entity.text !== null) {
    found.push({ where: `${path} body ${entity.type} (decoded)`, text: entity.text });
    if (entity.type === 'text/html') found.push({ where: `${path} body text/html (references decoded)`, text: decodeHtmlEntities(entity.text) });
  } else {
    found.push({ where: `${path} body ${entity.type} (bytes)`, text: entity.bytes.toString('latin1') });
  }
  return found;
}
