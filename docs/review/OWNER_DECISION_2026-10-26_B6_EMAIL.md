# Owner Decision OD-2026-10-26-01 — B6 email decisions D1, D2, D2a, D4, D5

| | |
| --- | --- |
| Decision ID | **OD-2026-10-26-01** (same convention as OD-2026-10-25-01) |
| Date | **2026-10-26** (America/Vancouver), recorded the same day from the owner's Stage 1 instruction and the owner-reviewed email strategy package |
| Decided by | Saeed (owner), under Doc 00 §5 (change control) and Doc 18 §364 (change control after baseline) |
| Type | **Addendum.** It records new owner decisions. It does **not** overwrite OD-2026-10-25-01 (email backup) or any earlier record; it supersedes only the parts of the B6 decision package that it names. |
| Status of this record | Each item carries its own status: **APPROVED** (decided by the owner), **PROPOSED** (awaiting owner approval), **UNVERIFIED** (a fact not yet checked), **NOT AUTHORISED** (work that needs a separate instruction). **B6 remains NOT ACCEPTED.** B7 has not started. The B7 body-discard issue is **OPEN**. The real vacancy is **DRAFT**. |
| Correction (rev 5, 2026-10-26) | **D2 cadence.** rev 4 recorded the cadence as **PROPOSED**. The owner had already confirmed it, so it is now recorded as **APPROVED: every calendar day, including weekends and holidays.** Source: GPT's review of rev 4, forwarded by the owner on 2026-10-26 (`807976e4-attachment.txt`, SHA-256 `709bc22b…6651`), which states that the owner's earlier decision covers every day, weekends and holidays included. Claude did not see the original confirmation message. The rev 4 proposal tied the cadence to periods when candidate acknowledgements are enabled; the cadence is recorded as confirmed, without that condition. Backup coverage and the unexpected-absence procedure remain **UNRESOLVED**. No other decision in this record is changed. |
| Superseded in part | **OD-2026-10-26-02** (2026-10-26, [`OWNER_DECISION_2026-10-26-02_B6_APPROVALS.md`](OWNER_DECISION_2026-10-26-02_B6_APPROVALS.md)) approves AMD-TITAN-02, the D4 copy, timestamp Option 1, the dark logo inline (CID), the subject rule and the D2 escalation timing. The affected cells below are annotated; their original statuses are kept as the record of this decision. |
| Inputs (as received) | Stage 1 instruction (`672f4729-attachment.txt`, SHA-256 `5ce3b430…78b0`); `Valida_Email_Strategy_and_Design_Review.md` (SHA-256 `285b9546…a1df`); the Concept A board, received as `62e8fb12-image.png` (1120 × 1833 px, SHA-256 `eaa814eb…4470`, titled "A / Graphite Letter"; **no file named `Valida_Email_Concept_A.png` was received**; the board is kept as [`docs/design/assets/concept-a-graphite-letter-board.png`](../design/assets/concept-a-graphite-letter-board.png)); the owner's message of 2026-10-26 01:04 giving the "final proposed text for the applicant". |

## 1. Decisions

### D1 — Titan / Bluehost is the long-term provider for all company email

| Element | Status |
| --- | --- |
| All Valida human **and** automated company email stays on Titan / Bluehost as the **long-term** provider | **APPROVED** (business direction) |
| Provider separation, an Exchange migration or another transactional provider as the default next step | **Not the default.** None is proposed. |
| Exact canonical amendment wording (AMD-TITAN-01…05) and the requirement-by-requirement matrix | **PROPOSED** — [`B6_TITAN_AMENDMENTS.md`](B6_TITAN_AMENDMENTS.md) *(AMD-TITAN-02 since APPROVED: OD-2026-10-26-02; the others still PROPOSED.)* |
| Permanent use of the root-domain sender `Valida Careers <notifications@cybervalida.com>` (AMD-TITAN-02) | **PROPOSED — needs its own approval.** Keeping Titan does not by itself require or approve a root-domain namespace; Doc 14 §202 is LOCKED and is not changed silently. *(Since APPROVED: OD-2026-10-26-02.)* |
| Transport (authenticated SMTP), credential handling, `careers@` routing, historical production-sender testing | **Not approved by implication.** Classified in the amendment document (enduring choice / operating record / historical bounded exception), each PROPOSED. |
| D3 identity, authentication and routing verification; D7 Outlook delivery testing | **Unchanged and still required.** The provider decision waives neither. |

### D2 — manual bounce monitoring; Saeed is the primary monitor

| Element | Status |
| --- | --- |
| Manual bounce monitoring is the Doc 14 §117 "equivalent operational mechanism" for this provider | **APPROVED** (mechanism) |
| Primary monitor: **Saeed** (owner-designated) | **APPROVED** |
| Backup monitor | **UNASSIGNED.** No one is assigned automatically. |
| Cadence: **every calendar day, including weekends and holidays** | **APPROVED** — the owner's earlier confirmation, recorded correctly in rev 5 (correction note above). Not to be asked again. |
| An extra review after any authorised configuration change or unusual submission activity; same-day escalation of repeats, sender-side failures and provider warnings | **PROPOSED** — part of the procedure text ([`BOUNCE_PROCEDURE_FA.md`](../operations/BOUNCE_PROCEDURE_FA.md)). *(Escalation timing since APPROVED: the same calendar day as discovery — OD-2026-10-26-02.)* |
| Planned absence: confirm cover beforehand; if nobody can cover, pause candidate acknowledgements through the approved configuration procedure | **PROPOSED** — the pause is a future operational action, **not authorised** here |
| Unexpected absence (no notice, no cover arranged) | **UNRESOLVED** — no procedure has been decided |
| Operational access for monitoring: Saeed's existing authorised Webmail access to `notifications@`, with 2FA kept on | **UNVERIFIED** (not inspected in this session). Monitoring never uses, changes or shares the backend SMTP application password. |

### D2a — a minimal suppression mechanism (direction only)

| Element | Status |
| --- | --- |
| A minimal, maintainable suppression mechanism for **confirmed permanently invalid recipient addresses** | **APPROACH APPROVED — DESIGN / IMPLEMENTATION / VERIFICATION PENDING** |
| A suppression **exception**, or any permission to bypass G-SUP | **None.** This is not an exception. |
| Gate G-SUP (candidate acknowledgements disabled in production until suppression passes its acceptance tests) | **Closed and unchanged.** |
| Design | **PROPOSED** — [`RECIPIENT_SUPPRESSION_DESIGN.md`](../architecture/RECIPIENT_SUPPRESSION_DESIGN.md) |
| Implementation | **NOT AUTHORISED** — a bounded B7 change, after B6 acceptance and separate B7 authorisation |

### D4 — Concept A visual direction; final content and output pending

| Element | Status |
| --- | --- |
| **Concept A — Graphite Letter** for **both** `APPLICATION_ACKNOWLEDGEMENT` and `APPLICATION_RECEIVED_INTERNAL` | **Visual direction: APPROVED.** Concepts B and C are not used. |
| Final subjects, preheaders and wording | **PROPOSED, awaiting owner approval** — [`EMAIL_COPY_PROPOSAL.md`](../design/EMAIL_COPY_PROPOSAL.md). On 2026-10-26 the owner supplied the candidate subject, preview and body as the "final proposed text"; it matches the Stage 1 instruction and is recorded as the recommended copy, still **PROPOSED** until the owner approves it formally. *(Since APPROVED: OD-2026-10-26-02.)* |
| Final Concept A specification | **PROPOSED** — [`EMAIL_CONCEPT_A_SPEC.md`](../design/EMAIL_CONCEPT_A_SPEC.md) *(The subject rule, the dark logo inline as CID and the timestamp format since APPROVED: OD-2026-10-26-02; the rest still PROPOSED.)* |
| Production HTML / plain-text implementation | **NOT AUTHORISED** |
| Email-client rendering verification of the new templates | **NOT RUN** |
| Production activation | **NOT AUTHORISED** |

Concept A is approved as a **visual direction**, not as a promise of pixel-identical rendering in every client.

### D5 — owner acceptance of the limited manual-check evidence

| Element | Status |
| --- | --- |
| The owner accepts the existing limited manual-check evidence: **the visible body of the one inspected internal notification** (run 7fcb590e, Application `6ade2f3f61de6115a9541ca5`) **contained no candidate personal data** | **APPROVED — CLOSED.** Not to be asked again. |
| Limits that stay attached | One message; visible body only; no hidden headers or attachments; provenance: owner-supplied screenshot, GPT-inspected; the image did not reach Claude's session, so it has **no hash** here. |
| Evidence files | The evidence addendum and both evidence JSON files are **unchanged**; `PENDING_MANUAL` is left as generated. |
| The redesigned templates | **Need their own privacy verification.** D5 covers the b6-1 text-only internal notification only. A future inline logo or any other MIME change is outside it. |

## 2. What these decisions do not do

- **They do not accept B6.** The B6 acceptance checklist is [`B6_ACCEPTANCE_CHECKLIST.md`](B6_ACCEPTANCE_CHECKLIST.md).
- They approve **no** runtime change, template change, live email, account access, credential change, installation, DNS change, purchase, commit, push, merge, deployment or B7 work.
- They do not change:
  - the approved monthly offline backup direction (OD-2026-10-25-01);
  - the production MongoDB / resume backup;
  - the D3 / R3 recovery proposal;
  - the D7 Outlook delivery requirement;
  - D8 credential hygiene;
  - the automated-message copy design and the **proposed** gate G-COPY (not approved);
  - the B7 body-discard issue (OPEN);
  - the real vacancy (DRAFT).
- The website success copy (Doc 06 §§148–150, `ApplyPage.content.js`) is **unchanged**. The proposed email wording is an email-specific variant only.

## 3. Affected documents

| Document | Change |
| --- | --- |
| `docs/review/B6_DECISION_PACKAGE.md` | rev 4: D1, D2, D2a, D4 and D5 statuses as above; §6 (b6-1 copy) kept as the record of the current templates; the SUP-1 precision amendment; credential wording corrected |
| `docs/operations/B6_BOUNCE_PROCEDURE_DRAFT.md` | Primary monitor recorded; backup UNASSIGNED; cadence PROPOSED (the rev 4 entry; the cadence is recorded as APPROVED since rev 5); links to the Persian procedure and the suppression design |
| New | `B6_TITAN_AMENDMENTS.md`, `EMAIL_CONCEPT_A_SPEC.md`, `EMAIL_COPY_PROPOSAL.md`, `RECIPIENT_SUPPRESSION_DESIGN.md`, `BOUNCE_PROCEDURE_FA.md`, `B6_ACCEPTANCE_CHECKLIST.md`, `IMPLEMENTATION_PLANS_B6_TEMPLATES_B7_SUPPRESSION.md` |
| Canonical Documents 00–18 | **Not edited.** Amendment texts are proposals for the owner's later approval. |
| rev 5 (2026-10-26) | The D2 cadence correction above. The other rev 5 corrections — the fail-closed suppression key lifecycle, the separate acknowledgement-budget proposal (D2b), the per-message privacy tests, the single subject rule and the owner approval sheet — are listed in the decision package rev 5. |
