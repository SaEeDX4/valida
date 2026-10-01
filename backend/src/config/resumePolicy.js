/**
 * Phase 1 server resume policy — 09_BACKEND_API_SPEC.md sections 94-104,
 * 10_DATA_MODEL.md sections 46 and 94-108, 13_SECURITY_PRIVACY_THREAT_MODEL.md
 * sections 57-79.
 *
 * Doc 10 section 46 places the global file restrictions in server
 * configuration rather than in editable Job data: every Job uses the same
 * policy, and the public Job DTO combines it with Job.applicationConfig to
 * build the application-form configuration a candidate is shown.
 *
 * These values are fixed by Doc 09 for Phase 1 — exactly one resume, at most
 * 5 MiB, PDF or DOCX — so they are constants, not environment variables:
 * loosening them is a security decision, not a deployment knob.
 *
 * B3 ADVERTISES the policy in the public Job Detail (RESUME_UPLOAD_POLICY,
 * unchanged by B4). B4 ENFORCES it on an uploaded file from this same module
 * (RESUME_FORMATS below is derived from RESUME_UPLOAD_POLICY), so the
 * advertised and enforced policy cannot drift apart. The Application model's
 * own constants (models/Application.js) are checked against these by the test
 * suite.
 */
export const RESUME_UPLOAD_POLICY = Object.freeze({
  // Doc 09 section 94 / BE-022 — one Application requires one resume.
  required: true,
  // Doc 09 section 95 — 5 MiB.
  maxBytes: 5 * 1024 * 1024,
  // Doc 09 section 96 — .pdf and .docx only; legacy .doc and macro formats are not accepted.
  allowedExtensions: Object.freeze(['.pdf', '.docx']),
});

/**
 * B4 — the one accepted MIME type for each accepted extension (Doc 09
 * section 97, Doc 10 section 100). An upload must present an allowed
 * extension AND the matching declared MIME type AND content whose structure is
 * that format (Doc 13 sections 58-64): no single signal is trusted alone.
 */
export const RESUME_FORMATS = Object.freeze({
  '.pdf': Object.freeze({ format: 'PDF', mimeType: 'application/pdf' }),
  '.docx': Object.freeze({
    format: 'DOCX',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }),
});

/** Doc 10 section 98 — stored original filename, maximum 255 characters. */
export const RESUME_FILENAME_MAX_LENGTH = 255;

/**
 * B4 — bounds for inspecting a DOCX (a ZIP package) without extracting it
 * (Doc 13 sections 76-79).
 *
 * Only the ZIP directory and two small package parts ([Content_Types].xml and
 * _rels/.rels) are ever decompressed, in memory, each capped at
 * maxInspectedPartBytes. The other limits reject archives that are
 * implausible for a 5 MiB Word document before anything is decompressed:
 *
 *   maxEntries             1000   — Apache POI ZipSecureFile default
 *                                   (MAX_FILE_COUNT) for Office packages
 *   maxCompressionRatio    100:1  — POI's MIN_INFLATE_RATIO of 0.01, applied
 *   ratioGraceBytes        100 KiB  above POI's grace entry size, so tiny,
 *                                   highly compressible parts are not refused
 *   maxTotalUncompressedBytes 100 MiB — declared total; 20x the file limit
 *   maxInspectedPartBytes  256 KiB — the parts that are actually inflated
 *   maxEntryNameBytes      1024
 *
 * Declared sizes are never trusted for memory: inflation is bounded by
 * zlib's maxOutputLength and the result must match the declared size and
 * CRC-32 exactly.
 */
export const DOCX_INSPECTION_LIMITS = Object.freeze({
  maxEntries: 1000,
  maxCompressionRatio: 100,
  ratioGraceBytes: 100 * 1024,
  maxTotalUncompressedBytes: 100 * 1024 * 1024,
  maxInspectedPartBytes: 256 * 1024,
  maxEntryNameBytes: 1024,
});
