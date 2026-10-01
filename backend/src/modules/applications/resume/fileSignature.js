/**
 * Content-signature identification — Milestone B4.
 *
 * Names what a file's first bytes say it is, for the LOG only: when a
 * ".pdf" upload is refused, the operator can see it was really a Windows
 * executable or a PNG (Doc 17 sections 118-119) without the file or its name
 * being logged. The value is always one of the fixed tokens below.
 *
 * A signature decides nothing on its own (Doc 13 section 62): acceptance is
 * decided by the PDF and DOCX structure checks.
 */
const SIGNATURES = [
  ['PDF', [0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
  ['ZIP', [0x50, 0x4b, 0x03, 0x04]],
  ['ZIP', [0x50, 0x4b, 0x05, 0x06]], // empty archive
  ['OLE2_COMPOUND', [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]], // legacy .doc, encrypted OOXML
  ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['JPEG', [0xff, 0xd8, 0xff]],
  ['GIF', [0x47, 0x49, 0x46, 0x38]],
  ['PE_EXECUTABLE', [0x4d, 0x5a]], // MZ
  ['ELF_EXECUTABLE', [0x7f, 0x45, 0x4c, 0x46]],
  ['MACH_O_EXECUTABLE', [0xcf, 0xfa, 0xed, 0xfe]],
  ['MACH_O_EXECUTABLE', [0xce, 0xfa, 0xed, 0xfe]],
  ['MACH_O_EXECUTABLE', [0xca, 0xfe, 0xba, 0xbe]],
  ['RTF', [0x7b, 0x5c, 0x72, 0x74, 0x66]], // {\rtf
  ['SCRIPT', [0x23, 0x21]], // #!
];

export function identifySignature(head) {
  if (!head || head.length === 0) return 'EMPTY';
  for (const [name, bytes] of SIGNATURES) {
    if (head.length >= bytes.length && bytes.every((byte, index) => head[index] === byte)) return name;
  }
  const text = head.subarray(0, 64).toString('latin1').trimStart().toLowerCase();
  if (text.startsWith('<!doctype html') || text.startsWith('<html') || text.startsWith('<svg')) return 'MARKUP';
  if (text.startsWith('<?xml')) return 'XML';
  return 'UNKNOWN';
}
