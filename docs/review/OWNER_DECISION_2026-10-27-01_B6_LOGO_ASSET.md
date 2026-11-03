# Owner Decision OD-2026-10-27-01 — B6 derived email logo approved for Stage 2 integration

| | |
| --- | --- |
| Decision ID | **OD-2026-10-27-01**, the next unused identifier. OD-2026-10-25-01, OD-2026-10-26-01, -02 and -03 are preserved unchanged. |
| Date | **2026-10-27**, the owner's message at 04:32 (America/Vancouver) |
| Decided by | Saeed (owner), under Doc 00 §5 and Doc 18 §364 |
| Source | The owner's message in the Claude session, which begins "I approve the specific derived logo asset: valida-logo-email-316x72.candidate.png SHA-256: b8c541749d0869f2473cc3344e6de5e8ecea9813bb106feb1fc3531602c8341a" and states "I accept its existing black background as shown in the supplied previews." and "This approves the asset and its Stage 2 integration only." |
| Resolves | The derived-logo checkpoint of OD-2026-10-26-03 (decision 4) |
| Status | **B6 NOT ACCEPTED.** G-SUP **CLOSED**. G-COPY **PROPOSED, NOT APPROVED**. B7 not started; the body-discard issue **OPEN**. The real vacancy **DRAFT**. All independent gates remain in place. |

## 1. Decision

| # | Decision | Limits |
| --- | --- | --- |
| 1 | **The derived logo asset is APPROVED** — exactly the file `valida-logo-email-316x72.candidate.png`, SHA-256 `b8c541749d0869f2473cc3344e6de5e8ecea9813bb106feb1fc3531602c8341a`, 316 × 72 px, 13,303 bytes, derived by resampling only from `frontend/public/brand/valida-logo-horizontal-dark.png` (SHA-256 `920db434d9e20eb99ec8ba417b1e164eb2e72db8e31eb6a8f04f99f814d2dc5e`) | Any other bytes — re-encoded, recoloured, cropped or resized differently — are **not** approved |
| 2 | **Its existing black (`#000000`) background is ACCEPTED** as shown in the supplied previews (`docs/qa/b6-stage2/previews/PREVIEW-ONLY-candidate-logo-*`, `docs/qa/b6-stage2/logo/logo-display-size-preview-*`) | No recolouring or masking is authorised or needed |
| 3 | **Its Stage 2 integration is AUTHORISED**: the reviewed patch (SHA-256 `767f492e17d5655c535c95fef960dc65ac3ff670d1580dde4fa938663a144a00`) applied to the deliverable — the asset and its checksum; one inline `image/png` CID part in `smtpTransport.js` `compose()`; the header image at 158 × 36 with `alt="Valida"`; the asset tests | Within OD-2026-10-26-03 only; the behaviour listed there as unchanged stays unchanged |

## 2. Not approved by this decision

- Email-client rendering (Stage 3, separately authorised; every untested cell stays **NOT RUN**). Browser previews do not establish email-client compatibility.
- Any live email, B7, commit, push, merge, deployment, DNS change or purchase.
- B6 acceptance, and every item still open in the B6 acceptance checklist.

## 3. Affected documents

| Document | Change |
| --- | --- |
| This record | New |
| `docs/review/B6_ACCEPTANCE_CHECKLIST.md`, `docs/review/B6_DECISION_PACKAGE.md`, `docs/design/EMAIL_CONCEPT_A_SPEC.md`, `docs/review/IMPLEMENTATION_PLANS_B6_TEMPLATES_B7_SUPPRESSION.md` | The logo approved and integrated |
| `docs/qa/b6-stage2/STAGE2_IMPLEMENTATION_REPORT.md`, `docs/qa/b6-stage2/README.md` | The integrated deliverable, its tests and previews |
| `backend/README.md` | The logo paragraph (from the reviewed patch) and the adapter's attachment statement |
| OD-2026-10-26-01, -02, -03 | **Unchanged** |
