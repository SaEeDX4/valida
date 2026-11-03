# Owner Decision OD-2026-11-02-03 — D-1 and D-3 approved; D-2 monitoring and escalation approved; D-4 / R1 approved as a plan only; Narrator selected; the acknowledgement's Outlook appearance accepted

| | |
| --- | --- |
| Decision ID | **OD-2026-11-02-03**, the next unused identifier. Earlier decisions (OD-2026-10-25-01; OD-2026-10-26-01, -02, -03; OD-2026-10-27-01; OD-2026-11-02-01; OD-2026-11-02-02), OF-2026-10-27-01 and OR-2026-11-01-01 are preserved unchanged. |
| Date | **2026-11-02** (America/Los_Angeles) |
| Decided by | Saeed (owner), under Doc 00 §5 |
| Source | The owner's handoff "VALIDA — Consolidated B6 Offline Completion and Review Handoff", preserved byte for byte as [`owner-sources/OD-2026-11-02-03/owner-instruction-2026-11-02-b6-offline-completion.txt`](owner-sources/OD-2026-11-02-03/owner-instruction-2026-11-02-b6-offline-completion.txt) (SHA-256 `4bec67a51b569e922474bcbda74d2b45f69943732a35b5726ad4e1e51e8b7030`), section "Approved decisions" |
| Status | **B6 NOT ACCEPTED.** G-SUP **CLOSED** — production candidate acknowledgements stay disabled. G-COPY **PROPOSED**. The B7 body-discard issue **OPEN**. The real vacancy **DRAFT**. GPT / Astra review independently; final acceptance is the owner's. |

## 1. Decisions, in the owner's words, and what each settles

| # | Owner's words | Recorded as | Settles | Does not settle |
| --- | --- | --- | --- | --- |
| 1 | "Preserve C2, removal of only the header CAREERS label, and P04." | Confirmation of OD-2026-11-02-01 | — (no change) | — |
| 2 | "Preserve D-6, OD-2026-11-02-02 … This is not a reflow PASS." | Confirmation of OD-2026-11-02-02 | — (no change) | — |
| 3 | "Record the owner's acceptance of the final acknowledgement in maximized Outlook Classic at 100%, Light and Dark Mode, as owner-reported acceptance of those specific visual conditions." | **OWNER-REPORTED acceptance** of the `b6-3` acknowledgement in Outlook classic, maximized, Zoom 100 %, light and dark | Cell A1-OC, ACK template, checks C1, C2 and C5 for those conditions — as owner-reported, not screenshot evidence | Measured ACK contrast (C4 — derived, see the r9 report); C9, C10 for ACK; any other condition |
| 4 | "D-1 and D-3 are approved." | **AMD-TITAN-01, -03, -04 and -05 APPROVED** (as compiled in `B6_REMAINING_OWNER_APPROVALS.md`); **DEV-B6-04 with the SUP-1 amendment APPROVED** | B6-1 and B6-3 | Incorporation of the texts into the canonical Doc 14 file (a canonical-document revision, outside this sandbox; the controlled amendment register is updated) |
| 5 | "Production candidate acknowledgements remain disabled until the suppression requirements are satisfied." | G-SUP stays **CLOSED** | — | — |
| 6 | "D-2 monitoring and escalation are approved; no automatic resending." | **Corrected r10 (§4).** The D-2 **timings — decision-sheet items 1, 2 and 3 — APPROVED** with the recommended wording: item 1, after an authorised live test, check within 1 hour, then at the next daily review; item 2, **a 24-hour manual review of uncertain outcomes** — *r11: explicitly approved by the owner on 2026-11-03; not a standing permission to re-send (§5)*; item 3, an open entry is escalated after 7 calendar days. **No automatic resending** confirmed | B6-2 in part | **Item 5** (planned-absence text) and approval of the complete English and Persian procedure text — not stated, so not assumed. The OneDrive conditions (decision 8) stay conditional |
| 7 | "D-4/R1 is approved as a PLAN ONLY." | Route R1 adopted as the plan for Stage 3 Part B | The shape of Part B | **Any live send, any account access, the sender identity, the recipients and the count** — a separate owner approval of the completed proposal is required ([live-test proposal](../qa/b6-stage3/LIVE_TEST_PROPOSAL_R1.md)) |
| 8 | "OneDrive Personal bounce-log storage remains conditional on private access, MFA, data protection and ownership requirements. Do not provision or require a paid service." | Decision-sheet **item 4**: OneDrive Personal (free tier) **CONDITIONALLY** selected | The intended location | Whether the four conditions are met — an owner confirmation before the first log entry |
| 9 | "Windows Narrator is the selected assistive technology." | Plan C10 in Outlook classic (A1-OC) is run with **Windows Narrator** instead of NVDA | The tool for C10 | The C10 result (NOT RUN) |

## 2. Unchanged

The approved sender and copy, the primary monitor, the daily cadence, same-day escalation, C2 / P-04, D-6 and every security, privacy and accessibility requirement. No live email, account access, commit, push, deployment, purchase or B7 implementation is authorised.

## 3. Records updated with this decision (r9)

`B6_TITAN_AMENDMENTS.md` (rev 7); `B6_DECISION_PACKAGE.md` (rev 16); `B6_REMAINING_OWNER_APPROVALS.md` (status note); `B6_BOUNCE_PROCEDURE_DECISION_SHEET.md` (status note); `B6_ACCEPTANCE_CHECKLIST.md`; `B6_REMAINING_BLOCKERS.md` (r9); the Stage 3 plan (r8); the evidence addendum (Part VI).

## 4. Correction (r10, 2026-11-03)

The owner's closure handoff of 2026-11-03 lists, among the r9 corrections to apply, "owner-approved D-2 timing/no automatic resend". The r9 record of decision 6 was too narrow.

| | |
| --- | --- |
| r9 text (superseded) | "Bounce-procedure decision sheet **item 1** … and **item 3** … **APPROVED** with the recommended wording; **no automatic resending** confirmed …" — with **item 2** (24 or 48 hours) listed as not settled |
| Corrected | The decision sheet groups items 1–3 as the procedure's timings ("1–3 Business-day timings"). All three are **APPROVED** with the recommended wording; for item 2 that is **24 hours**. No automatic resending. The handoff names the approval, not the number: the recommended 24 hours is recorded, and the owner's approval of the complete text (B6-2) confirms it |
| Written into the texts | `docs/operations/B6_BOUNCE_PROCEDURE_DRAFT.md` §3, §4.7 step 4 and §5, and `docs/operations/BOUNCE_PROCEDURE_FA.md` §1, §7 and §8 (r10) |
| Still open in B6-2 | Item 5 (planned absence, "approve as written" recommended) and approval of the complete English and Persian texts. The OneDrive Personal conditions (decision 8) must be confirmed before the first bounce-log entry |
| Records updated | Decision sheet (r10 status row); `B6_REMAINING_OWNER_APPROVALS.md`; `B6_ACCEPTANCE_CHECKLIST.md`; `B6_REMAINING_BLOCKERS.md`; [`B6_ACCEPTANCE_PACKAGE_R10.md`](B6_ACCEPTANCE_PACKAGE_R10.md) |

## 5. Correction (r11, 2026-11-03)

| | |
| --- | --- |
| Owner's statement (2026-11-03, 13:13 America/Los_Angeles) | "The owner explicitly approved a 24-hour manual review of uncertain outcomes. Do not describe this as standing permission to resend. Correct both English and Persian bounce procedures." |
| r10 text (superseded) | Item 2 recorded as "an uncertain outcome may be re-sent only after **24 hours** … and only by a recorded owner decision", and the English §4.7 step 4 read "the owner may decide to retry with `--include-uncertain`" — wording that could be read as a permission to re-send after 24 hours |
| Corrected | **Item 2 = a 24-hour manual review of uncertain outcomes, explicitly approved.** After 24 hours without a delivery-failure report (or, for an internal notification, a copy in `hr@`), the owner reviews the case at the next daily review and records the outcome. The review grants **no** permission to re-send; nothing is re-sent automatically; `--include-uncertain` is run only on a separate, explicit owner decision for that specific case, recorded in the log |
| Written into | `docs/operations/B6_BOUNCE_PROCEDURE_DRAFT.md` §4.7 step 4 and revision note; `docs/operations/BOUNCE_PROCEDURE_FA.md` status row and §7 |
| Unchanged | Items 1 and 3 as approved; item 5 and approval of the complete texts still open (B6-2) |
