/**
 * Phase 1 server resume policy — 09_BACKEND_API_SPEC.md sections 94-96,
 * 10_DATA_MODEL.md section 46.
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
 * B3 only ADVERTISES this policy in the public Job Detail. Enforcing it on an
 * uploaded file (extension, MIME, signature/structure, size) is Milestone B4,
 * which must use this same module so the advertised and enforced policy cannot
 * drift apart.
 */
export const RESUME_UPLOAD_POLICY = Object.freeze({
  // Doc 09 section 94 / BE-022 — one Application requires one resume.
  required: true,
  // Doc 09 section 95 — 5 MiB.
  maxBytes: 5 * 1024 * 1024,
  // Doc 09 section 96 — .pdf and .docx only; legacy .doc and macro formats are not accepted.
  allowedExtensions: Object.freeze(['.pdf', '.docx']),
});
