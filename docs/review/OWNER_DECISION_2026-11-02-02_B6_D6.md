# Owner Decision OD-2026-11-02-02 — D-6 approved: horizontal scrolling in Outlook classic accepted as a narrowly scoped deviation (F-03)

| | |
| --- | --- |
| Decision ID | **OD-2026-11-02-02**, the next unused identifier. Earlier decisions (OD-2026-10-25-01, OD-2026-10-26-01, -02, -03, OD-2026-10-27-01, OD-2026-11-02-01), owner feedback OF-2026-10-27-01 and owner record OR-2026-11-01-01 are preserved unchanged. |
| Date | **2026-11-02** (America/Los_Angeles) |
| Decided by | Saeed (owner), under Doc 00 §5 (explicit owner change to a baselined requirement) |
| Sources | (1) The owner's message in this session: "D-6 is explicitly approved as a narrowly scoped Outlook Classic scrolling deviation, not a reflow PASS." (2) The record prepared by GPT QA from the owner's explicit instruction (request `560ac0d7-5b63-4d51-8e89-a0c1302d83c7`), supplied in the owner's ZIP `B6_D6_Decision_and_Original_Evidence.zip` (SHA-256 `39737f37a140c19f30228ba10c96a997a866f0463a06336c0b83a40f183d1b2d`) and preserved byte for byte as [`owner-sources/OD-2026-11-02-02/B6_D6_OWNER_DECISION_AND_EVIDENCE_RECONCILIATION.md`](owner-sources/OD-2026-11-02-02/B6_D6_OWNER_DECISION_AND_EVIDENCE_RECONCILIATION.md) (SHA-256 `6bbe68842afd4581fc62d3ce35af9e1423fcf8fa0b81f75e3b4dac95dad3b9d0`) |
| Status | **B6 NOT ACCEPTED.** G-SUP **CLOSED**. G-COPY **PROPOSED, NOT APPROVED**. The B7 body-discard issue **OPEN**. The real vacancy **DRAFT**. No merge, deployment or next-milestone permission. |

## 1. Decision — APPROVED (the owner's wording controls)

> "The owner accepts horizontal scrolling in Outlook Classic when viewing these emails in a narrow window or at high whole-message zoom, provided all content remains readable and accessible by scrolling. This is a narrowly scoped D-6 deviation, not a reflow test PASS. No further cosmetic redesign cycle is requested for F-03." (source 2, §1)

**Disposition of F-03:** accepted as a **bounded known limitation**. The scrolling criterion is recorded as **"ACCEPTED DEVIATION (D-6)"**, never as "reflow PASS". Actual horizontal **and** vertical scrolling is recorded as observed.

**The r7 proposed D-6 text is superseded and not imported.** Its separate conditions — no sideways scrolling at 200 % in a maximized window, a one-axis-only assertion, and an automatic rollback of the Outlook-only wrapper — are **not** part of this decision. The `b6-3` wrapper stays as built.

## 2. Scope and limits

| | |
| --- | --- |
| Applies to | Outlook classic for Windows only; the two notification emails (internal notification, candidate acknowledgement); a narrow window or high whole-message zoom |
| Condition | All content remains readable and accessible by scrolling |
| Does **not** apply to | Any other email client (plan C1 and C8 apply there in full); text-only resizing (must still reflow, plan §11.4); the website (Doc 16 unchanged) |
| Does **not** waive | Mandatory accessibility, security, privacy or functionality. **Still blockers if found:** content loss; inaccessible content; overlap that impairs reading or functionality; text-resize defects |
| Does **not** approve | Any other Stage 3 cell or check (images disabled, plain text, reading order, contrast, other layouts); a Stage 3 PASS; final B6 acceptance; a WCAG conformance claim for the email |
| Does **not** authorise | Live email, mailbox or account access, commits, pushes, merges, deployment, DNS changes, purchases or B7 implementation. No email is sent under D-6. |
| Remains in force | The approved C2 masthead and P-04 colours (OD-2026-11-02-01) and all approved wording |

## 3. The deviation record required by Doc 16 §284

Doc 16 §284 ("QUALITY DEVIATION") allows a deviation from a quality requirement "only with: exact requirement ID; reason; measured impact; alternative considered; approval/update". Applied here by analogy, as Doc 16 governs the website:

| Element | Content |
| --- | --- |
| Requirements deviated from (Outlook classic only) | Email specification §9 ("with no fixed heights, increased text size and 200 % zoom reflow the column") for whole-message zoom; Stage 3 plan **C1** ("horizontal scrolling … at … desktop width" not acceptable) and **C8** (text at 200 % reflows) for whole-message zoom and narrow windows (§11.4 already leaves acceptance of scrolling to the owner); by analogy Doc 16 §38 (zoom), §39 (reflow), §40 (horizontal scroll), A11Y-018 and A11Y-019 |
| Reason | Outlook classic lays out the approved 600 × 108 masthead image at its `width="600"` attribute: it applies no CSS width to images, computes a percentage width from the 1,200 px image file, and does not honour `max-width`. So the message cannot be narrower than 600 CSS px in that client, whatever the wrapper does ([findings §4.4](../qa/b6-stage3/F01-F04_FINDINGS_AND_PROPOSAL.md)) |
| Measured impact | EV-S3-OC5 O1 (narrow window, owner-reported 200 %): layout about **1,198 px ≈ 599 CSS px** in a 768 px message area; horizontal scrollbar; the masthead and the end of the headline beyond the right edge in the view as opened. Maximized at 200 % (O2) and at 100 % (O3): no horizontal scrollbar. Reachability of the remaining content: **owner-reported** (no scrolled-right screenshot). ([addendum Part V](../qa/b6-stage3/EV-S3-OC1_OUTLOOK_CLASSIC_OFFLINE_ADDENDUM.md)) |
| Alternatives considered | Seven remedies (fixed or fluid wrappers, percentage image width, image switching, a VML band, a smaller Outlook-only masthead, a separate masthead table) — none within the approved design ([findings §4.4](../qa/b6-stage3/F01-F04_FINDINGS_AND_PROPOSAL.md)) |
| Approval / update | This decision; the records listed in §5 updated with its limited precedence |

## 4. Check for a conflicting non-waivable requirement

Inspected: Doc 16 §§37–40, §263 (A11Y-017, A11Y-018, A11Y-019, A11Y-041), §276 ("Brand subtlety never justifies failing: contrast; focus; keyboard; form clarity"), §284 (quality deviation), §286 ("Claude may not label an inaccessible custom component acceptable because it is visually impressive"); the Stage 3 plan §7, §10 and §11.4; Doc 00 §5. **No requirement was found that forbids this specific, explicit owner decision.** §284 sets the form of a deviation (§3 above supplies it); §286 forbids a *silent* waiver by Claude, and this is an explicit owner decision recorded with its evidence; §276 concerns contrast, focus, keyboard and form clarity, none of which D-6 relaxes; A11Y-041 makes *severe* critical-workflow blockers release-blocking — the decision's own condition (all content readable and accessible by scrolling) and its list of remaining blockers keep that rule in force. Doc 15 was not needed for this check (it is present in this session's Project, `15_DEVOPS_DEPLOYMENT.docx`).

## 5. Records updated with this decision's limited precedence (r8)

[`F01-F04_FINDINGS_AND_PROPOSAL.md`](../qa/b6-stage3/F01-F04_FINDINGS_AND_PROPOSAL.md) (§0c); [`EMAIL_CONCEPT_A_SPEC.md`](../design/EMAIL_CONCEPT_A_SPEC.md) (status note rev 12); [`STAGE3_EMAIL_CLIENT_VERIFICATION_PLAN.md`](../qa/b6-stage3/STAGE3_EMAIL_CLIENT_VERIFICATION_PLAN.md) (r7: §11.11–11.12 replaced, §11.13); [`B6_REMAINING_BLOCKERS.md`](B6_REMAINING_BLOCKERS.md) (r8); [`B6_DECISION_PACKAGE.md`](B6_DECISION_PACKAGE.md) (rev 15); [`B6_ACCEPTANCE_CHECKLIST.md`](B6_ACCEPTANCE_CHECKLIST.md). Earlier texts are kept and marked, not rewritten.
