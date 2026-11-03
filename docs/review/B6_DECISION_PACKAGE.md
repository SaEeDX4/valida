# B6 Acceptance — Remaining Decisions

| | |
| --- | --- |
| Milestone | Release B → **B6 — Notification Integration** (Doc 18 §§133–138) |
| Code | B6 **final-r9** (`ec15048` + 53-file delta, ZIP SHA-256 `f11d21e6…34ec`). **Unchanged by this package**: no file under `backend/src`, `backend/scripts`, `backend/tests`, `frontend/` or any `package*.json` was touched. |
| Evidence | [`docs/qa/B6_EVIDENCE_ADDENDUM.md`](../qa/B6_EVIDENCE_ADDENDUM.md) |
| Prepared | 2026-10-25 by Claude. **Every recommendation and every text below is PROPOSED. Nothing here is approved**; approval is the owner's (Doc 00 §5) after GPT review. |
| Revision | **rev 1** (2026-10-25 evening, after GPT's review). Changes: manual check 5 recorded (D5); DEV-B6-04 corrected — the §120 suppression gap is stated as an interim deviation with production gate G-SUP (new D2a); the R3 preflight limited to checks that can actually be made (§5.3); the archive decision reworked and marked unresolved (D6). |
| Revision | **rev 2** (2026-10-25 late evening). The owner approved a business direction, **OD-2026-10-25-01**: keep Titan and make a monthly offline email backup, replacing the seven-year archive request ([`OWNER_DECISION_2026-10-25_EMAIL_BACKUP.md`](OWNER_DECISION_2026-10-25_EMAIL_BACKUP.md)). D6 has been rewritten and D6a added. Every other decision is unchanged. |
| Revision | **rev 3** (2026-10-25/26, after GPT's review of rev 2). Documentation and design corrections R3-01…R3-06 to the backup design, the Persian procedure, the owner-decision record and the copy design. In this file: D6 and D6a updated; the open-items row of §1 updated; §7 updated for G-COPY; **§8 added** (remaining decisions, setup facts and future tasks). **D1–D5, D2a, D7 and D8 are unchanged and remain open**; D5 keeps its recorded evidence status. |
| Revision | **rev 4 — Stage 1** (2026-10-26). Records the owner's decisions **OD-2026-10-26-01** ([`OWNER_DECISION_2026-10-26_B6_EMAIL.md`](OWNER_DECISION_2026-10-26_B6_EMAIL.md)): D1 Titan long term (business direction **APPROVED**; amendment wording **PROPOSED** in [`B6_TITAN_AMENDMENTS.md`](B6_TITAN_AMENDMENTS.md)); D2 mechanism **APPROVED**, Saeed primary monitor, backup **UNASSIGNED**, cadence **PROPOSED**; D2a **APPROACH APPROVED — DESIGN / IMPLEMENTATION / VERIFICATION PENDING** (G-SUP closed); D4 Concept A visual direction **APPROVED**, copy **PROPOSED**, implementation **NOT AUTHORISED**; D5 **ACCEPTED and CLOSED**. Also: credential wording in DEV-B6-01 / 02 corrected; the SUP-1 precision amendment; §6 kept as the record of the current b6-1 text; §7 and §8 updated. D3, D6, D6a, D7 and D8 are unchanged. |
| Revision | **rev 5 — Stage 1 corrections** (2026-10-26, after GPT's review of rev 4). (1) **D2 cadence recorded as APPROVED**: every calendar day, including weekends and holidays. rev 4 wrongly listed it as PROPOSED. Backup coverage and the unexpected-absence procedure remain **UNRESOLVED**. (2) D2a: the suppression key lifecycle is fail-closed — no automatic lifting when a key is retired; acknowledgements are blocked while key coverage is incomplete; unrecoverable entries need an audited owner decision. (3) The acknowledgement budget is a separate proposal, **D2b**, outside D2a and G-SUP; no caps are proposed. (4) The privacy tests are defined per message and run on decoded as well as raw output. (5) One subject-length rule, by grapheme cluster. New: [`OWNER_APPROVAL_SHEET_B6_EMAIL.md`](OWNER_APPROVAL_SHEET_B6_EMAIL.md) and [`ACKNOWLEDGEMENT_BUDGET_PROPOSAL.md`](../architecture/ACKNOWLEDGEMENT_BUDGET_PROPOSAL.md). Changed here: this header, §1, the D2 and D2a rows and a new D2b row in §2, the monitoring sentence of DEV-B6-04, one cell of §4, a note in §6, §7 and §8. Nothing else changed. |
| Revision | **rev 6 — owner approvals** (2026-10-26). Records **OD-2026-10-26-02** ([`OWNER_DECISION_2026-10-26-02_B6_APPROVALS.md`](OWNER_DECISION_2026-10-26-02_B6_APPROVALS.md)). **APPROVED:** AMD-TITAN-02 (the permanent sender `notifications@`); the copy of both emails; timestamp Option 1; the dark logo inline (CID); the subject rule; monitoring every calendar day, with escalation on the same calendar day as discovery. Nothing else changed status. Corrections: the calendar-day escalation wording; an *authorised* restricted channel to HR; an OPEN key-material integrity requirement for B7 (suppression design §4.5); the HMAC attribution in the approval sheet. Changed here: this header, §1, the D1 / D2 / D2a / D4 rows of §2, notes in §3 and §6, the escalation wording in DEV-B6-04, §4, §5.3, §7 and §8. **Stage 2 is not authorised**; its instruction exists only as a draft. |
| Revision | **rev 7 — Stage 2** (2026-10-26). Records **OD-2026-10-26-03** ([`OWNER_DECISION_2026-10-26-03_B6_STAGE2_AUTHORISATION.md`](OWNER_DECISION_2026-10-26-03_B6_STAGE2_AUTHORISATION.md)): Stage 2 and its sandbox test environment **AUTHORISED**; the rest of the Concept A specification implemented as proposed, for review. **Implemented** in the recovered working copy: template version `b6-2` for both emails, with the approved copy, the grapheme subject rule and the UTC timestamp; tests T-01…T-12. **Pending:** the derived logo (candidate SHA-256 `b8c54174…341a`, awaiting the owner's approval of the bytes; its integration is prepared and NOT applied), and the owner's Windows + MongoDB run. Evidence: [`STAGE2_IMPLEMENTATION_REPORT.md`](../qa/b6-stage2/STAGE2_IMPLEMENTATION_REPORT.md). Changed here: this header, a note in §6, §8.3. |
| Revision | **rev 8 — logo** (2026-10-27). Records **OD-2026-10-27-01** ([`OWNER_DECISION_2026-10-27-01_B6_LOGO_ASSET.md`](OWNER_DECISION_2026-10-27-01_B6_LOGO_ASSET.md)): the derived logo (SHA-256 `b8c541749d0869f2473cc3344e6de5e8ecea9813bb106feb1fc3531602c8341a`) **APPROVED** with its existing black field, and its Stage 2 integration **AUTHORISED**. **Integrated** into the deliverable (the reviewed patch, applied unchanged; one added test assertion). Pending: the owner's Windows + MongoDB run, Stage 3, and the other open items. Changed here: this row, a note in §6, §8.3. |
| Revision | **rev 9 — Windows evidence** (2026-10-27; no product runtime, test or verification-script change; one QA diagnostic script added and executed — `docs/qa/b6-stage2/tools/dep0190_trigger_probe.mjs`). The owner-run Windows `verify:b6` log of the integrated package registered as **EV-S2-W1** (SHA-256 `d0b3bc71d45e54c8c3259dd4ddb36cd4ce486765221861ddb73f50d9bc115cb5`; [`WINDOWS_EVIDENCE_ADDENDUM_2026-10-27.md`](../qa/b6-stage2/WINDOWS_EVIDENCE_ADDENDUM_2026-10-27.md)): every available gate passed, MongoDB 8.0.9, exit 2, provider PENDING; five Windows skips classified; the DEP0190 warning assessed (tooling; no change). The Stage 3 plan prepared ([`STAGE3_EMAIL_CLIENT_VERIFICATION_PLAN.md`](../qa/b6-stage3/STAGE3_EMAIL_CLIENT_VERIFICATION_PLAN.md); NOT AUTHORISED, NOT RUN). The remaining owner-approval texts compiled ([`B6_REMAINING_OWNER_APPROVALS.md`](B6_REMAINING_OWNER_APPROVALS.md); statuses unchanged). Changed here: this row. |
| Revision | **rev 10 — corrections after GPT's review of r2** (2026-10-27; documentation and preserved owner evidence only). The owner's package-verification transcript registered as **EV-S2-W2** (SHA-256 `d083d6b18b950dc3a0b856afa697f225543d18144e4c1abf5a71b0d218b22856`), cross-referenced with EV-S2-W1: package identity rests on it, not on folder names or test counts. The Stage 3 plan shows both templates in every required client, with the INT delivery routes for the owner's choice (budget unchanged) and file opening split into offline and authenticated-client kinds. The scope statement corrected: one QA diagnostic script (`dep0190_trigger_probe.mjs`) was added and executed in r2. The bounce-procedure choices set out in [`B6_BOUNCE_PROCEDURE_DECISION_SHEET.md`](B6_BOUNCE_PROCEDURE_DECISION_SHEET.md) (none approved). Changed here: this row. |
| Revision | **rev 11 — owner-run Outlook classic inspection** (2026-10-27; documentation, preserved owner evidence, measurement and review-mockup tools only — no product runtime, template, test or verification-script change). The owner's seven offline Outlook classic screenshots registered as **EV-S3-OC1** ([addendum](../qa/b6-stage3/EV-S3-OC1_OUTLOOK_CLASSIC_OFFLINE_ADDENDUM.md)): preliminary, pre-authorisation, filling no Stage 3 cell. Owner feedback **OF-2026-10-27-01** ([record](OWNER_FEEDBACK_2026-10-27_B6_LOGO_LIGHT_RENDERING.md)) qualifies OD-2026-10-27-01: the black field is rejected on a light message background; OD-2026-10-27-01 is unchanged. Findings F-01…F-04 **OPEN** with candidates and corrections **PROPOSED** ([findings](../qa/b6-stage3/F01-F04_FINDINGS_AND_PROPOSAL.md)). Changed here: this row, §8.2 (rendering) and §8.3 (template task). |
| Revision | **rev 12 — corrections and the C2+P04 Outlook screenshots** (2026-11-01; documentation and preserved owner evidence only — no product runtime, template, test, asset or verification-script change). **Correction:** rev 11 called the owner's Outlook classic work "preliminary" / "pre-authorisation"; the owner had authorised Stage 3 **offline EML inspection in Outlook classic only** ([OR-2026-11-01-01](OWNER_RECORD_2026-11-01_B6_STAGE3_OUTLOOK_OFFLINE.md)). Cell A1-OC is **PARTIAL**, not PASS; online access and live email remain **NOT AUTHORISED**. The owner's six Outlook screenshots of the C2+P04 review mockups registered as **EV-S3-OC2** (mockups, not the product). Owner-reported 200 % checks and the monitor observation recorded as **OWNER-REPORTED**. The owner's preference for C2 recorded — **not** an approval. F-01…F-04 **OPEN**. The rev 11 row above is kept as written. Changed here: this row and §8.2. |
| Revision | **rev 13 — `b6-3` implemented** (2026-11-02). Records **OD-2026-11-02-01** ([record](OWNER_DECISION_2026-11-02-01_B6_C2_P04.md)): C2 masthead (`ac67a2cb…ea3b`) **APPROVED** for both emails; removal of the header label `CAREERS` **APPROVED** (only it); P-04 **APPROVED**; sandbox implementation **AUTHORISED**. **Implemented** as template `b6-3` with a layout fix to the Outlook-only wrapper (F-03) — [report](../qa/b6-3/B6-3_IMPLEMENTATION_REPORT.md). Owner screenshots of the mockups at screen size registered as **EV-S3-OC3** (GPT's measurements corroborated). OD-2026-10-27-01 is superseded for `b6-3` and kept on record. **G-COPY stays PROPOSED**; if it is later designed, its copy baseline is the approved copy as amended by OD-2026-11-02-01 decision 3. Remaining blockers in one list: [`B6_REMAINING_BLOCKERS.md`](B6_REMAINING_BLOCKERS.md). Changed here: this row, §8.2 and §8.3. |
| Revision | **rev 14 — r7: Windows evidence of `b6-3`, EV-S3-OC4 and the F-03 constraint** (2026-11-02; documentation, preserved owner evidence and QA tools only — **no product runtime, template, test, asset or verification-script change**). The owner's Windows + MongoDB run of the r6 package registered as **EV-B6-3-W1** ([`WINDOWS_EVIDENCE_R6.md`](../qa/b6-3/WINDOWS_EVIDENCE_R6.md)): every available gate passed (offline 2226 / 5 skipped, B6 460, B5 236, B4 580 / 5, database 145, B6 database gate 16, rehearsal 17, indexes 6/6; provider PENDING; exit 2) — **B6-7 met for `b6-3`**; the log reached this session altered in transit, so the received copy is kept under its own name and the original is requested in a ZIP (record only). Three owner Outlook screenshots registered as **EV-S3-OC4** (addendum Part IV): reported as the `b6-3` LONG fixture, but the window title shows the r5 review mockup; they fill no cell. **F-03:** Outlook classic lays out the 600 px C2 masthead at its width attribute, so no wrapper can narrow the message below 600 CSS px there; the r6 preview claim corrected; J7 model added; **D-6 revised and recommended** (findings §4.4; [blockers](B6_REMAINING_BLOCKERS.md)). Nothing else changed status. |
| Revision | **rev 15 — r8: D-6 approved; original evidence reconciled** (2026-11-02; records and preserved owner evidence only — no runtime, template, test, asset or verification-script change; no test rerun). Records **OD-2026-11-02-02** ([record](OWNER_DECISION_2026-11-02-02_B6_D6.md)): **D-6 APPROVED** — horizontal scrolling in Outlook classic in a narrow window or at high whole-message zoom accepted as a narrowly scoped deviation, provided all content remains readable and accessible by scrolling; not a reflow PASS; no other client, not text-only resizing; the r7 proposed conditions not imported; no further cosmetic redesign of F-03. The owner's original 07:12 screenshots of `b6-3` registered as **EV-S3-OC5** (A1-OC PARTIAL on `b6-3`; r7's "not opened" inference withdrawn); the original Windows log (`f1b4ee…e897`) preserved, its ASCII text identical to the received copy. Remaining: BL-1…BL-6 in the [blockers list](B6_REMAINING_BLOCKERS.md) (r8). Nothing else changed status. |
| Revision | **rev 16 — r9: D-1 and D-3 approved; D-2 in part; D-4 / R1 as a plan only** (2026-11-02; records, offline inspection evidence and a live-test proposal — no runtime, template, test, asset or verification-script change). Records **OD-2026-11-02-03** ([record](OWNER_DECISION_2026-11-02-03_B6_APPROVALS_D1_D3_D2_D4.md)): **D1** — AMD-TITAN-01, -03, -04 and -05 **APPROVED** (all five Titan amendments now approved); **D2a** — DEV-B6-04 with the SUP-1 amendment **APPROVED** (G-SUP stays closed; production acknowledgements disabled until suppression passes its tests); **D2** — monitoring and escalation approved (decision-sheet items 1 and 3), no automatic resending; item 4 conditionally OneDrive Personal; item 2, item 5 and the complete text still open; **Stage 3** — route R1 approved as a plan only, Windows Narrator selected for C10; the acknowledgement's appearance in Outlook classic accepted (owner-reported). Offline inspection J8 PASS; live-test proposal prepared, not executed ([`LIVE_TEST_PROPOSAL_R1.md`](../qa/b6-stage3/LIVE_TEST_PROPOSAL_R1.md)). |
| Status | **READY FOR GPT REVIEW.** B6 is **NOT ACCEPTED**. |

## 1. What is approved, what is proposed, what is open

| Class | Items |
| --- | --- |
| **Approved business direction (not a technical acceptance)** | **OD-2026-10-25-01:** retain Titan; a monthly offline backup by the owner; dated independent sets; integrity checks and offline recovery tests; encryption and access protection; a recommended second encrypted copy; this replaces the seven-year enterprise archive request. **OD-2026-10-26-01:** Titan / Bluehost long term for all company email (D1); manual bounce monitoring, with Saeed as the primary monitor, every calendar day including weekends and holidays (D2); a minimal suppression mechanism as the approach (D2a); Concept A as the visual direction for both emails (D4); acceptance of the limited manual-check evidence (D5, closed). |
| **Approved wording and specification elements — not implemented** | **OD-2026-10-26-02:** AMD-TITAN-02 (the permanent automated sender `notifications@cybervalida.com`; Reply-To `careers@`); the subjects, preheaders, labels and wording of both emails; timestamp Option 1; the official dark logo inline as CID; the subject rule; monitoring every calendar day, 365 days a year, with escalation on the same calendar day as discovery. Implementing the email items is Stage 2, which is **not authorised**. |
| **Approved and implemented** (baselined text, or behaviour approved in earlier B-milestone reviews) | Doc 09 §§128–136 (notify only after durable acceptance; failure never undoes the Application; bounded retry; no duplicate on replay; bounded timeout). Doc 10 §§117–122 (per-channel state; `lastErrorCode` stores a classification only). Doc 12 §§115–118 (acknowledgement confirms receipt only). Doc 06 §§149–150 (the acknowledgement body reuses the approved success copy). Doc 14 §§100–101 and §203 (Reply-To `careers@` — LOCKED, met). Doc 14 §§141–144 (templates in code; encoding; no header injection). Retry policy, including **R3: a permanent refusal is never retried** (current approved behaviour). |
| **Owner decisions, implemented, but in conflict with baselined Doc 14 text** | Provider: Bluehost Professional Email (Titan). Sender: `notifications@cybervalida.com` on the root domain. One provider for human and automated mail. SMTP with an app password. Since 2026-10-26 the provider is an **APPROVED long-term business direction** (OD-2026-10-26-01, D1). The permanent root-domain sender is **APPROVED** as AMD-TITAN-02 (OD-2026-10-26-02); AMD-TITAN-01, -03, -04 and -05 remain **PROPOSED** ([`B6_TITAN_AMENDMENTS.md`](B6_TITAN_AMENDMENTS.md)). None is yet recorded in Doc 14 (Doc 00 §5). SMTP transport and credentials are **not** approved by implication. |
| **Proposed in this package** | Deviation texts DEV-B6-01…06 and records AMD-B6-07/08 (§3); the bounce procedure (§4, separate file); the R3 operator recovery design (§5); the email copy (§6 — the b6-2 copy is APPROVED since OD-2026-10-26-02). Separate files: the monthly email-backup design and its Persian procedure; the automated-message copy design. Stage 1 (rev 4): the Titan amendments and change matrix; the Concept A specification and the copy proposal; the minimal suppression design; the Persian bounce procedure; the B6 acceptance checklist; the Stage 2 / Stage 4 implementation plans. rev 5: the separate acknowledgement-budget proposal (D2b); the owner approval sheet. |
| **Open — AWAITING INPUT** | The **backup** bounce monitor (the primary is Saeed) and the absence procedure, including unexpected absence (the cadence and the same-calendar-day escalation are APPROVED); implementation and verification of the approved suppression approach (gate G-SUP closed; no exception), and the location of the protected copy of its HMAC key; whether to adopt the acknowledgement budget (D2b) and, only after the plan's limits are verified, its caps; approval of the AMD-TITAN-01, -03, -04 and -05 wording (D1; AMD-TITAN-02 is APPROVED); approval of the Concept A specification as a whole and, in Stage 2, of the derived logo file (D4; the copy, timestamp, logo choice and subject rule are APPROVED); the design of the suppression key-material integrity verification (OPEN, before B7 implementation approval); the recruitment / email retention period (Doc 13 §187: *AWAITING PRIVACY / LEGAL / OPERATIONAL DETERMINATION*); the email-backup setup inputs (Outlook version / licence; sign-in with 2FA kept on, through a separately named application password per mailbox; the inventory of existing local mail data; the send-prevention settings; Device Encryption, and the cache / temporary-file gap if it is off; `shervin@` access; the second device); a non-production sender identity for staging; `careers@` as a mailbox before Phase 3. |

## 2. Decision table

"Blocks" columns: **B6** = final B6 acceptance; **Prod** = the first production use of Apply with real candidates (Doc 18 C6/C7); **Later** = the milestone where it is due.

| # | Decision | Recommended choice | Why | B6 | Prod | Later |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | Doc 14 conflicts: root-domain sender, shared provider, SMTP + app password, `careers@` routing, production sender in local tests (§3) | **Business direction APPROVED** (OD-2026-10-26-01): Titan / Bluehost is the long-term provider for all company email. **APPROVED** (OD-2026-10-26-02): AMD-TITAN-02, the permanent root-domain identity, which amends LOCKED §202. **PROPOSED:** AMD-TITAN-01, -03, -04 and -05, with a requirement-by-requirement matrix ([`B6_TITAN_AMENDMENTS.md`](B6_TITAN_AMENDMENTS.md)). DEV-B6-01…04 stay as history; DEV-B6-05 is an interim routing choice; DEV-B6-06 a historical bounded exception; AMD-B6-07 updated; AMD-B6-08 unchanged. | The owner decided the provider. Namespace, transport and credentials are separate questions, and LOCKED text is never changed silently. D3 and D7 still verify identity, authentication, routing and Outlook delivery. | **Yes** (amendment wording approved and recorded) | Yes | D3 verifies the selected identity; no migration presumed |
| D2 | Is manual bounce monitoring the Doc 14 §117 "equivalent operational mechanism"? (DEV-B6-04) | **Mechanism APPROVED; Saeed APPROVED as the primary monitor; cadence APPROVED: every calendar day, including weekends and holidays** (OD-2026-10-26-01; recorded correctly in rev 5); **escalation timing APPROVED: the same calendar day as discovery, including weekends and holidays** (OD-2026-10-26-02). Backup **UNASSIGNED**. Unexpected-absence procedure **UNRESOLVED**. **PROPOSED:** the rest of the procedure text — a review after any authorised configuration change or unusual activity, the planned-absence plan ([`BOUNCE_PROCEDURE_FA.md`](../operations/BOUNCE_PROCEDURE_FA.md)). | Bounces are visible and correlatable (run 7fcb590e). Titan has no bounce API, and §118 records outcomes "only to the degree supported". Daily review cannot prevent an hourly provider restriction (suppression design §7; D2b). | **Yes** (procedure text approved) | **Yes** (backup monitor, or an approved absence procedure) | D3 test "bounce visibility" |
| D2a | Doc 14 §120 — no suppression list: a later, distinct Application with a hard-bounced or permanently refused address triggers another acknowledgement (DEV-B6-04) | **APPROACH APPROVED — DESIGN / IMPLEMENTATION / VERIFICATION PENDING** (OD-2026-10-26-01): a minimal suppression register for confirmed invalid recipients ([`RECIPIENT_SUPPRESSION_DESIGN.md`](../architecture/RECIPIENT_SUPPRESSION_DESIGN.md), PROPOSED; rev 5 makes its key lifecycle fail-closed, §4.4; rev 6 registers an OPEN key-material integrity requirement, §4.5). **Not an exception.** **Gate G-SUP stays closed** until the implementation passes SUP-1…6 (SUP-1 amended, §3) and the focused cases. Until then the §120 gap is recorded as an interim deviation, with human detection of repeats and their escalation on the same calendar day as discovery (procedure §4.5). | The system does not stop repeat sends; only a person notices them, after the fact. | **Yes** (gap recorded; approach approved) | **Yes** — G-SUP before acknowledgements are enabled in production; at the latest at the Release E entry gate | B7 (Stage 4) |
| D2b | **Acknowledgement budget** (new in rev 5; split out of the suppression design §7.2) | **PROPOSED; owner choice** ([`ACKNOWLEDGEMENT_BUDGET_PROPOSAL.md`](../architecture/ACKNOWLEDGEMENT_BUDGET_PROPOSAL.md)): rolling hourly, daily and 3-day caps, reserved in one atomic write before SMTP; no refunds; no automatic resend. **No caps proposed** until the plan's limits are verified. Separate from D2a; **not** a G-SUP criterion. | Suppression cannot stop **new** invalid addresses. A budget reduces, but cannot remove, the risk of reaching Titan's bounce limits: delayed bounces, human mail on the same domain, unknown window rules and an unverified plan. | No | Owner choice (recommended before production acknowledgements) | B7, separately reviewed |
| D3 | R3 — an internal notification permanently refused by the relay can never be sent again | **Approve the design in §5** for implementation in **B7**, as a separately reviewed change. Keep today's behaviour until then. | Phase 1 has no Admin console, so a lost internal notification can mean an Application nobody hears about. The remedy must not weaken the retry safety properties. | No (current behaviour is the approved one) | **Yes** | B7 |
| D4 | Email presentation and copy for both notifications (§6) | **Concept A — Graphite Letter: visual direction APPROVED** for both emails (OD-2026-10-26-01). **APPROVED** (OD-2026-10-26-02): the subjects, preheaders and wording of both emails ([`EMAIL_COPY_PROPOSAL.md`](../design/EMAIL_COPY_PROPOSAL.md)); timestamp Option 1; the official dark logo inline as CID; the subject rule. **PROPOSED:** the rest of the specification ([`EMAIL_CONCEPT_A_SPEC.md`](../design/EMAIL_CONCEPT_A_SPEC.md)) and, in Stage 2, the derived logo file. **NOT AUTHORISED:** production HTML / plain-text implementation and activation. **NOT RUN:** rendering verification of the new templates. | The owner did not approve the b6-1 presentation and copy as final. | **Yes** — approval of the rest of the specification, then the Stage 2 template revision and its Stage 3 evidence | Yes | — |
| D5 | Manual check 5 — no candidate data in the internal notification | **ACCEPTED by the owner and CLOSED** (OD-2026-10-26-01), with its limits: PASS for the **visible body of one received internal notification** (run 7fcb590e, Application `6ade2f3f61de6115a9541ca5`). Provenance: owner-supplied screenshot, GPT-inspected (EV-A10; the image file did not reach this session, so it has no hash here). Not to be asked again. | It does not cover hidden headers, attachments or every possible notification. The redesigned templates need their own privacy verification (copy proposal §5). | **Done** | — | New templates: their own privacy tests (Stage 2 / 3) |
| D6 | **Email backup** (supersedes the seven-year archive request) | **Business direction APPROVED** (OD-2026-10-25-01). **Technical design PROPOSED**: [`EMAIL_BACKUP_PROPOSAL.md`](../architecture/EMAIL_BACKUP_PROPOSAL.md) and the Persian procedure. **Implementation tracking:** (1) setup verification — Outlook version and licence (identified from product information); sign-in with 2FA kept on (documented capability, account configuration and an actual sign-in recorded separately); the inventory of existing local mail data; a dedicated backup profile with send-prevention settings; folder classification; Device Encryption status and the protection matrix (the `.ost` cache / temporary-file gap if it is off); protected location; recovery profile; (2) the first monthly run (receive-only, Outbox preflight, export options set before Finish); (3) the initial full recovery exercise; (4) the second encrypted copy (**device AWAITING CONFIRMATION**; a set without it is never an overall pass); (5) `shervin@` access (**AWAITING DECISION**). Retention of the sets stays **AWAITING** (Doc 13 §187); no deletion. EA-0 and EA-2 superseded (not implemented); EA-3 rescoped to this backup. | An approved scope is **not** an operationally verified backup: no set has been made or restored yet. It does not replace the production MongoDB / resume backup (C6). | No | No (it is not a production-system dependency) | Owner's operational task, from setup onward |
| D6a | **Automated-message copy** (EA-1 rescoped) | **PROPOSED design (rev 3):** [`AUTOMATED_MESSAGE_COPY_DESIGN.md`](../architecture/AUTOMATED_MESSAGE_COPY_DESIGN.md) — the exact message preserved before SMTP; a per-attempt durable record with an explicit write order; every crash boundary classified conservatively (missing evidence is never "safe to resend"); a copy-only IMAP APPEND to Sent with a conservative hold for an uncertain APPEND; bounded guarantees with stated assumptions; **never** an SMTP submission because of copying. **Proposed gate G-COPY** (copy design §6): blocks production sending of automated notifications until implementation evidence, a live Titan APPEND check and the storage namespace exist, **or** a separately recorded owner exception — **none approved**. Independent of G-SUP. Proposed amendment AMD-COPY-01 (Doc 18 C6, new §180A). | Titan stored no Sent copy of SMTP submissions; a mailbox backup cannot recover them. | No — G-COPY is not a B6 criterion | **Yes, if G-COPY is approved** — then production sending (C6/C7) waits for its evidence or a recorded exception | A B7 candidate (separate authorisation after B6 acceptance) |
| D7 | Microsoft/Outlook deliverability (Doc 14 §132) | Test in a future, separately authorised live run (D3/D5). | Only Gmail was tested. No live send is authorised now. **r10 (2026-11-03):** observed in the owner's R1 runs — Outlook.com delivered to **Junk** (SCL 6) with SPF / DKIM / DMARC / CompAuth passing, cause unknown (owner-reported, [OR-2026-11-03-01](OWNER_RECORD_2026-11-03_B6_R1_LIVE_RUNS.md)); inbox placement stays open ([package §4, P1](B6_ACCEPTANCE_PACKAGE_R10.md)) | No | Recommended | D3 / D5 |
| D8 | Production credential hygiene | Before C6, create a **production-only** app password that never touches a developer machine, and revoke the one used for the tests. | §185 calls for separate credentials. The test password was entered on a development machine. | No | **Yes** | C6 |
| — | **B7 body-discard issue** (OPEN, not a B6 item) | Fix in B7. | Must be resolved before public deployment (owner's instruction). | No | **Yes** | B7 |
| — | The real vacancy | Stays **DRAFT** (Doc 12 §45). | Its content is AWAITING INPUT. | No | Yes | E6 |

## 3. A — Doc 14 deviations: exact proposed text

> **rev 4 (2026-10-26):** for D1 the owner approved Titan as the **long-term** provider (OD-2026-10-26-01). The proposed canonical route is now AMD-TITAN-01…05 ([`B6_TITAN_AMENDMENTS.md`](B6_TITAN_AMENDMENTS.md)). The interim texts below are kept as history; their credential wording was corrected in rev 4.
>
> **rev 6 (2026-10-26):** AMD-TITAN-02 is **APPROVED** (OD-2026-10-26-02). DEV-B6-01 is therefore superseded as the proposed route and is kept as history.

Proposed placement: a new section at the end of Doc 14, **"B6 RECORDED DEVIATIONS — PHASE 1 INTERIM"**, with matching tracker entries (Doc 00 §5). Each entry below gives the requirement, the current behaviour, the evidence and its limits, the recommendation, the smallest change, the acceptance evidence and what it blocks. The quoted text after **Proposed text** is the wording to insert. **It is not approved.**

### DEV-B6-01 — Automated mail from the root domain (`notifications@`)

- **Requirement.** Doc 14 §96 "Canonical sending namespace: notify.<PRIMARY_DOMAIN>". §202 "TRANSACTIONAL IDENTITY — LOCKED … notify.<PRIMARY_DOMAIN> for automated email identity". MAIL-036. §98 (preference: `careers@notify.`). §99: a root-domain From "is allowed only if: DMARC passes; provider setup is verified; human/transactional operational distinction remains clear". §§103, 105, 106 (bounce and DKIM preferences on `notify.`). Doc 18 §202 (D3 namespace).
- **Current behaviour.** From `Valida Careers <notifications@cybervalida.com>`; envelope sender and Return-Path `notifications@cybervalida.com`; DKIM `d=cybervalida.com` (selector `titan1`); `Auto-Submitted: auto-generated`; Reply-To `careers@cybervalida.com`.
- **Evidence and limits.** DMARC / SPF / DKIM PASS on the e4e60b91 acknowledgement in Gmail: OWNER-REPORTED · GPT-REVIEWED, header not inspected by Claude. The headers listed are visible on the returned 7fcb590e message (EV-A5). Gmail only.
- **Recommendation.** Record it as an interim deviation under §99's conditions, with D3 as the review point. A permanent amendment now would pre-empt D2/D3.
- **Smallest change.** Documentation only.
- **Acceptance evidence.** DMARC pass (reported); live provider verification (runs e4e60b91, 7fcb590e); the owner's statement that no human correspondence is sent from `notifications@` and that the backend SMTP application password is used only by the backend (monitoring and backup use separately authorised access; corrected in rev 4).
- **Blocks.** B6: yes, until recorded. D3: decide.

**Proposed text:**
> **DEV-B6-01 (Phase 1 interim — PROPOSED).** Until Milestone D3 is completed, automated notification email is sent from the dedicated mailbox `notifications@<PRIMARY_DOMAIN>` (display name "Valida Careers", Reply-To `careers@<PRIMARY_DOMAIN>`) instead of the `notify.<PRIMARY_DOMAIN>` namespace fixed in §96, §202 and MAIL-036. This uses the root-domain allowance of §99, and all three of its conditions apply: (1) DMARC passes on real messages; (2) the provider setup is verified by a live test; (3) the distinction stays clear: only the backend Notification Service sends from the mailbox and only the backend uses its SMTP application password; no person sends human correspondence from it; people authorised to monitor or back it up use their own, separately authorised access; and every message carries `Auto-Submitted: auto-generated`. The Return-Path is the same mailbox; no separate bounce domain exists (§103 preference not met). At D3 the owner either moves automated mail to `notify.<PRIMARY_DOMAIN>` as locked, or approves a permanent amendment of §202 and MAIL-036.

**Alternative permanent amendment** (only if D3 keeps this design): add to §202 / MAIL-036: *"…or, by recorded owner decision, a dedicated automated mailbox on the root domain (`notifications@<PRIMARY_DOMAIN>`) used only by the backend, under the conditions of §99."*

### DEV-B6-02 — One provider for human and automated mail

- **Requirement.** Doc 14 §108 (canonical: human mail on the corporate provider, automated mail on `notify.` through a transactional provider). MAIL-034 "Human corporate email and automated transactional email are distinct systems."
- **Current behaviour.** One Bluehost / Titan account serves `saeed@`, `shervin@`, `hr@` (human) and `notifications@` (automated). Automated mail uses only `notifications@` and its own app password; the backend holds no human mailbox's credential.
- **Evidence and limits.** Live runs. **Risk accepted:** one incident, suspension or sending-limit event affects both kinds of mail.
- **Recommendation.** Interim deviation, with D3 as the review point.
- **Smallest change.** Documentation only.
- **Acceptance evidence.** Configuration review: `SMTP_USERNAME` = `TRANSACTIONAL_FROM_ADDRESS` = `notifications@` (enforced by `backend/src/config/env.js`); owner attestation of credential separation.
- **Blocks.** B6: yes, until recorded.

**Proposed text:**
> **DEV-B6-02 (Phase 1 interim — PROPOSED).** Until D3, human corporate mail and automated notification mail share one provider account (Bluehost Professional Email, powered by Titan). They stay distinct **identities**, though not distinct systems as MAIL-034 states: automated mail uses only the dedicated `notifications@` mailbox and its own revocable app password; the backend never holds the credential of a human mailbox; no person uses the backend's SMTP application password, and people authorised to monitor or back up `notifications@` use their own, separately authorised access and send no human correspondence from it. The accepted risk: an incident, suspension or sending-limit event on the account affects both kinds of mail. Review point: D3.

### DEV-B6-03 — Authenticated SMTP with an app password, not a provider API

- **Requirement.** Doc 14 §95: the transactional provider must support "API authentication; bounce handling; delivery status; suppression handling; production-grade sending". §110 "Notification Service → Transactional Provider API". §135 "Use the selected provider's maintained message API". §152 avoid legacy/basic SMTP authentication where stronger methods exist; prefer API/token credentials. §153 avoid application passwords unless a real integration requires them and stronger API/OAuth alternatives are unavailable.
- **Current behaviour.** SMTP submission to `smtp.titan.email:465` (implicit TLS, certificate and host name verified; authentication only inside TLS) through the maintained client nodemailer 10.1.4, authenticated by an app password of `notifications@`. A single failed login latches further logins until restart (Titan blocks IPs after repeated failures).
- **Evidence and limits.** Titan documents no HTTP message API and no OAuth / token method for SMTP submission (r4 provider review). That is the §§152–153 exception. **Not provided:** delivery status and suppression handling (§95). Bounce handling only through DEV-B6-04.
- **Recommendation.** Interim deviation. §§152–153 are satisfied by their own exception clauses; §§95, 110 and 135 are not.
- **Smallest change.** Documentation only.
- **Acceptance evidence.** Live runs; the r4–r9 adapter tests (TLS required, no authentication before TLS, no credential in logs).
- **Blocks.** B6: yes, until recorded.

**Proposed text:**
> **DEV-B6-03 (Phase 1 interim — PROPOSED).** Until D3, the Notification Service submits mail by authenticated SMTP to the corporate provider (implicit TLS on port 465, with certificate and host-name verification; authentication only inside TLS) through a maintained client library, using a revocable app password of the `notifications@` mailbox. For this interim, that interface stands in for "the provider's maintained message API" (§§110, 135). The provider documents no HTTP message API and no OAuth or token method for SMTP submission, which meets the exception conditions of §§152–153. The §95 capabilities "delivery status" and "suppression handling" are **not** provided; "bounce handling" is provided only as recorded in DEV-B6-04. The app password is a server-side secret (§§111, 179), is separate per environment (§185) and is revoked on any suspicion of exposure.

**Alternative clarification** (only if D3 keeps SMTP): in §§110 / 135, *"the provider's maintained message interface — an HTTP API, or authenticated SMTP submission through a maintained client library"*.

### DEV-B6-04 — Bounces handled by hand; no suppression list

- **Requirement.**
  - Doc 14 §117: the provider "must expose delivery/bounce information through: provider dashboard; webhook/API; equivalent operational mechanism".
  - §118: outcomes "only to the degree supported/needed by actual integration".
  - **§120: "If provider suppresses an address because of hard bounce/complaint: the backend must not repeatedly send blindly forever."**
  - §121: "Retry only transient failures. Do not repeatedly retry: known invalid recipient; permanent bounce; suppression."
  - §167 (track bounces and suppression); MAIL-042 ("bounce/delivery state must be observable"); Doc 17 §311; Doc 18 §204 (D3 test "bounce visibility"); Doc 17 §426 (Phase 2 gate).
- **Current behaviour — two different failure paths:**

  | | **Relay refusal** (synchronous) | **Later bounce** (asynchronous) |
  | --- | --- | --- |
  | What happens | Titan refuses during the SMTP session (`5xx` at `RCPT TO` or after the message) | Titan answers `250` (accepted); a delivery-failure report (DSN) arrives later in the `notifications@` Inbox |
  | Backend record | `FAILED` with a permanent code (`INVALID_RECIPIENT`, `PROVIDER_REJECTED`, `SUPPRESSED`) | `SENT` (relay accepted). The backend never learns of the bounce. |
  | Same channel retried? | **No** (never automatically, under any flag) | **No** (a `SENT` channel is never re-sent) |
  | Visible where | Counts per code in the `ops:notifications:retry` dry run | Only in the `notifications@` Inbox (manual procedure) |
  | **A new, distinct Application with the same address** | **Gets a new acknowledgement attempt.** The relay will probably refuse it again: a repeated attempt, nothing delivered. | **Gets a new acknowledgement, accepted and bounced again** |

  There is **no suppression list**, no `BOUNCED` or `SUPPRESSED` state from bounces, and nothing that carries a known hard bounce from one Application to the next.
- **Compliance status — stated plainly:**
  - §117: met only if D2 accepts manual monitoring as the equivalent mechanism.
  - §118: met (the degree supported).
  - §121: met **per channel**.
  - **§120: NOT met.** A known hard-bounced or permanently refused address can be sent to again whenever a new Application uses it. That is an **interim deviation**, not compliance.
- **Interim control until suppression exists.** A human recognises repeats and escalates (bounce procedure §4.5): for every acknowledgement hard bounce or permanent refusal, the monitor checks, through a read-only database lookup by normalised address, whether an earlier Application with the same address already has a logged hard bounce or refusal. A repeat is escalated on the same calendar day as discovery, including weekends and holidays. **Limit:** this acts **after** the repeated send. It stops sending to that address from going on "forever"; it does not prevent the first repeat.
- **Production gate G-SUP (proposed).** Candidate acknowledgements stay **disabled in production** (`APPLICATION_ACKNOWLEDGEMENT_ENABLED=false`, today's default) until one of these is done:
  - (a) a suppression mechanism is implemented and passes SUP-1…SUP-6 below; or
  - (b) the owner records a separately approved **permanent exception** to §120.

  G-SUP must be closed at the latest before the Release E entry gate (Doc 12 §115 expects acknowledgements by Phase 3; Doc 14 §208). The internal notification is not affected: its one configured recipient is Valida's own, and any bounce there is an urgent escalation (procedure §4.4).
- **Evidence and limits.**
  - Run 7fcb590e: the bounce arrived in the same minute as the send. Its returned original carries the Valida Message-ID, which maps exactly to the Application. Claude checked the mapping over the attached data for all six messages: the token is the first 32 hex characters of SHA-256(`<event>/<applicationId>`).
  - **Limits:** one failure type (a nonexistent domain); RET / ENVID not shown to be honoured (the returned copy has the full body and the candidate address); no positive delivery signal ever exists; **no evidence of any suppression**, because none exists.
- **Recommendation.** Accept manual monitoring as the §117 mechanism for Phase 1. Record the §120 gap as an explicit interim deviation with gate G-SUP. Implement suppression in **B7**, together with R3: both change failure handling in the same notification module, and each is separately reviewed. Alternatively, D3 may adopt a provider whose suppression replaces it.
- **Smallest change now.** Documentation and the procedure. No code.
- **Acceptance tests.**
  - *Interim (procedure):* T1–T3, and **T5** — a tabletop of a repeated hard bounce recognised through the lookup and escalated on the same calendar day as discovery, including weekends and holidays.
  - *Suppression mechanism (when built):*

    | # | Test |
    | --- | --- |
    | SUP-1 | **(amended, rev 4)** After a **confirmed recipient-specific permanent invalid-address refusal** of an acknowledgement to address X — enhanced status 5.1.1, 5.1.2, 5.1.3 or 5.1.10 at `RCPT TO`, registered by the operator — a new, distinct Application with X: `201`; acknowledgement recorded `FAILED` / `RECIPIENT_SUPPRESSED` with **zero** submissions (local SMTP counter); internal notification still sent. *(rev 1–3 said "a permanent relay refusal", which would also suppress valid addresses refused for other reasons — suppression design §6.)* |
    | SUP-2 | The same after a **later bounce**, once an operator records the bounced Message-ID token (the system resolves the Application and its address) |
    | SUP-3 | A delayed (`4.x.x`) report and an `UNKNOWN` outcome do **not** suppress |
    | SUP-4 | Suppression never affects Application acceptance, the internal channel or replay |
    | SUP-5 | Lifting a suppression needs an operator action with a reason; its history is kept |
    | SUP-6 | No plaintext address in logs. The stored form (a restricted collection, or a keyed hash) is decided with privacy (Doc 13 §§177–178) and included in the deletion workflow (Doc 13 §190). |

- **Blocks.**
  - B6: yes — the mechanism (D2) and the recorded §120 deviation (D2a).
  - Production: the named monitor and backup; **G-SUP before acknowledgements are enabled in production**.
  - Later: suppression in B7, or a provider at D3.

**Proposed text:**
> *(rev 16: this text is **APPROVED**, with the SUP-1 amendment — OD-2026-11-02-03.)*
>
> **DEV-B6-04 (Phase 1 interim — PROPOSED).** Until D3, the "equivalent operational mechanism" of §117 for automated mail is this: delivery-failure reports arrive as messages in the `notifications@` Inbox and are handled under the B6 bounce procedure (`docs/operations/B6_BOUNCE_PROCEDURE_DRAFT.md`) by the owner-designated primary monitor (Saeed) with a named backup (**AWAITING INPUT** — unassigned), every calendar day, including weekends and holidays (cadence approved, OD-2026-10-26-01). Each report is matched to its Application through the Valida Message-ID of the returned original.
>
> The backend records relay acceptance only: `SENT` means "accepted by the relay", never "delivered". Per §118 it keeps no `DELIVERED` / `BOUNCED` / `DEFERRED` / `SUPPRESSED` state from bounces. It never re-sends a `SENT` channel and never automatically retries a permanent relay refusal, which meets §121 for each channel.
>
> **§120 is not met during this interim.** There is no suppression list, so a later, distinct Application using an address that has already hard-bounced, or been permanently refused, causes another acknowledgement attempt. Until suppression exists, the bounce procedure detects such repeats and escalates them on the same calendar day as discovery, including weekends and holidays, after the repeated send has occurred.
>
> **Gate G-SUP:** candidate acknowledgements remain disabled in production (`APPLICATION_ACKNOWLEDGEMENT_ENABLED=false`) until either a suppression mechanism passes its acceptance tests, or the owner records a separately approved permanent exception to §120. This must be done no later than the Release E entry gate.

### DEV-B6-05 — `careers@` forwards to `hr@`

- **Requirement.** Doc 14 §§34–38: by Phase 3, `careers@` needs durable recruitment history and controlled access, preferably as a shared, delegated or dedicated mailbox; Send-As; no shared password. MAIL-009 / MAIL-010. §114 (internal notification to `careers@` "or an explicitly configured authorized recruitment destination"). §203 Reply-To `careers@` (LOCKED).
- **Current behaviour.** `careers@` is a forwarding address that delivers to the `hr@` mailbox. The internal notification goes to `hr@` (`RECRUITMENT_NOTIFICATION_RECIPIENT`). Send-As `careers@` is not configured or tested.
- **Evidence and limits.** EV-A6: mail addressed to `careers@` is in the `hr@` Inbox. Human replies from `hr@` show `hr@` as the sender.
- **Recommendation.** Not a B6 conflict: §114 allows the configured destination, and §203 is met. Record it now so that it is not lost; decide before Phase 3.
- **Smallest change.** Documentation only.
- **Acceptance tests (Phase 3).** Doc 14 §§123, 125, 128 (inbound, reply, Send-As).
- **Blocks.** B6: no. Release E entry gate (Doc 18 §218, "real Careers mailbox"): yes.

**Proposed text:**
> **DEV-B6-05 (until the Release E entry gate — PROPOSED).** `careers@<PRIMARY_DOMAIN>` is a forwarding address delivering to the `hr@<PRIMARY_DOMAIN>` mailbox, which holds the recruitment history. The Reply-To of §203 is met: mail to `careers@` reaches `hr@`. The internal notification goes to the configured authorized destination `hr@` (§114). Before Phase 3, the owner either makes `careers@` a mailbox with controlled access and tested Send-As (§§35–37), or amends §35 to allow routing to a dedicated recruitment mailbox that holds the history, with Send-As `careers@` tested.

### DEV-B6-06 — The production sender used in two local verification runs

- **Requirement.** Doc 14 §185: development, staging and production need separate credentials, sender identity and recipient safeguards. §186: do not configure staging to impersonate production; use a non-production identity where possible. MAIL-047. §§182–184, 187.
- **Current behaviour.** The two live runs of 2026-10-25 sent from `notifications@` on the owner's development machine. Controls: explicit opt-in flags; a plan-only run first; a recipient allowlist (owner addresses plus a reserved `.invalid` address); hard submission limits of 2 and 4, enforced before the relay; synthetic data in `valida_test` only; a loopback-only server; confirmed cleanup; the script refuses `APP_ENV`/`NODE_ENV=production`.
- **Evidence and limits.** EV-A1–A4: `refused: 0`; the counts were exactly as planned.
- **Recommendation.** Record a deviation **limited to these owner-authorised verification runs**. Require a non-production identity, or no provider at all, for any staging deployment. Add D8 (a fresh production credential).
- **Smallest change.** Documentation only.
- **Acceptance tests.** At C6: staging runs with `TRANSACTIONAL_EMAIL_PROVIDER=none` or a non-production identity; production uses a credential created for production only.
- **Blocks.** B6: yes, until recorded. C6: the staging identity.

**Proposed text:**
> **DEV-B6-06 (limited — PROPOSED).** The owner-authorised live verification runs of 2026-10-25 (`e4e60b91`, `7fcb590e`) used the production sender `notifications@<PRIMARY_DOMAIN>` from a development machine, under these controls: explicit opt-in; a plan-only run first; a recipient allowlist of owner-controlled addresses and a reserved `.invalid` address; a hard limit on submissions enforced before the provider; synthetic data in a dedicated test database; a loopback-only test server; confirmed cleanup. This deviation covers those verification runs and later runs authorised under the same controls; it does **not** cover ongoing development or staging. Before any staging or review deployment can send email (C6), it is configured with a non-production sender identity and its own credential (**AWAITING INPUT**), or with no provider (`TRANSACTIONAL_EMAIL_PROVIDER=none`). Production uses an app password created for production only.

### AMD-B6-07 / AMD-B6-08 — records, no conflict

> **AMD-B6-07 (§94 status — PROPOSED).** "Transactional email provider: **Bluehost Professional Email (powered by Titan), authenticated SMTP submission** — selected by the owner for Phase 1; interim under DEV-B6-01…04 until D3."

> **AMD-B6-08 (§180 / Doc 15 variable list — PROPOSED).** Add the B6 variables as implemented: `TRANSACTIONAL_EMAIL_PROVIDER` (`none` | `smtp`), `SMTP_HOST`, `SMTP_SECURITY` (`implicit-tls` | `starttls`), `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` (secret), `TRANSACTIONAL_FROM_ADDRESS`, `TRANSACTIONAL_FROM_NAME`, `TRANSACTIONAL_REPLY_TO`, `RECRUITMENT_NOTIFICATION_RECIPIENT`, `APPLICATION_ACKNOWLEDGEMENT_ENABLED`, `EMAIL_RECIPIENT_ALLOWLIST` (refused in production), `NOTIFICATION_TIMEOUT_MS`, `NOTIFICATION_RETRY_MAX_ATTEMPTS`, `NOTIFICATION_RETRY_BASE_DELAY_MS`. `TRANSACTIONAL_EMAIL_API_KEY` stays reserved for an API provider and is refused with `smtp`.

## 4. B — Bounce operations (summary)

The procedure is [`docs/operations/B6_BOUNCE_PROCEDURE_DRAFT.md`](../operations/B6_BOUNCE_PROCEDURE_DRAFT.md) (DRAFT, not approved).

| Field | Content |
| --- | --- |
| Requirement | Doc 14 §§117–121, 167; MAIL-042; Doc 17 §311 |
| Current behaviour | Bounces land in `notifications@`; nobody is assigned; nothing is recorded |
| Evidence | Run 7fcb590e: bounce received and correlated (addendum §5.2) |
| Recommendation | Adopt the procedure for Phase 1. It separates **attempted**, **relay-accepted**, **delivered** (never observable), **later bounce** and **unknown**; a check every calendar day, including weekends and holidays (cadence APPROVED); correlation by Message-ID; escalation rules; a log that holds no addresses |
| Smallest change | One document, plus a restricted bounce log. No code. |
| Acceptance tests | T1: correlate the 7fcb590e bounce to its Application (passes on the attached data). T2: the backup handles a bounce without the primary's credential. T3: escalation drill for a bounced internal notification. T4 (when a live send is authorised): a bounce from an existing domain with an unknown mailbox, and a Microsoft/Outlook recipient. **T5:** tabletop of a repeated hard bounce, recognised and escalated on the same calendar day as discovery, including weekends and holidays. |
| Personal data | DSNs and returned originals contain the full message and the candidate address (addendum §5.2). Forwarding them is **never** treated as data-free. HR is told the **Application reference** through an authorised restricted channel instead; no raw bounce or returned original is forwarded. |
| Blocks | B6: the mechanism (D2) and the recorded §120 deviation (D2a). Production: the named monitor and backup, and gate G-SUP. |

## 5. C — R3: recovering an internal notification after a permanent refusal

### 5.1 Requirement

- Doc 09 §§132–134 (the Application stays accepted; record enough to retry; a controlled retry mechanism).
- Doc 14 §121: "Retry only transient failures. Do not repeatedly retry: known invalid recipient; permanent bounce; suppression."
- Doc 10 §§117–122 (channel state; codes only); Doc 10 §141 ("important lifecycle history should not be simulated by overwriting fields without traceability"); Doc 10 §139 (notification state may change "with proper authorization/audit").

### 5.2 Current behaviour (approved)

- A relay refusal is classified when it happens. `INVALID_RECIPIENT`, `PROVIDER_REJECTED` and `SUPPRESSED` (a 5xx at `RCPT` or after `DATA`) are **PERMANENT**: `assessChannel` returns `PERMANENT` (never due), and `notificationDueFilter` has no clause for them. **No flag of `ops:notifications:retry` reaches them.**
- Configuration problems detected *before* the relay (`RECIPIENT_NOT_CONFIGURED`, `SENDER_NOT_CONFIGURED`, `TEMPLATE_ERROR`, `PROVIDER_AUTH_FAILED`, `TLS_FAILED`, …) are **CONFIGURATION**: retried only with `--include-configuration`. Uncertain outcomes are retried only with `--include-uncertain`.
- The dry run reports **counts** per channel, status and code, so permanent failures are visible as numbers, but not as a list.
- **Consequence.** If the recruitment address is wrong or blocked at the relay (a typo in `RECRUITMENT_NOTIFICATION_RECIPIENT`, a disabled `hr@`, a relay policy refusal), every Application in that period ends with internal = `FAILED` / permanent, and nothing can notify HR of them later. Phase 1 has no Admin console, so those Applications are only visible to someone querying the database.
- Not R3: an internal notification **accepted** by the relay and **later bounced** stays `SENT` and is handled by the bounce procedure (manual notice to HR).

### 5.3 Recommended design — release and claim in one conditional write

A new, narrow operator path in the existing retry command. Proposed interface:

```
npm run ops:notifications:retry -- --release-internal-permanent
    (--application <id> [--application <id> …] | --failed-from <ISO date> --failed-to <ISO date>)
    --reason RECIPIENT_CORRECTED|RELAY_POLICY_RESOLVED|ACCOUNT_RESTORED
    [--send --confirm-cause-corrected --evidence-ref <reference>] [--limit N]
```

1. **Scope.** The **internal** channel only, and only `status: FAILED` with a **PERMANENT** code. A candidate acknowledgement refused as permanent is never releasable: its address is the candidate's, not Valida's configuration. Bounded by `--limit` (default 50, maximum 500), and by explicit ids or an explicit failure-time window.
2. **Dry run by default.** It lists the Application ids and codes that would be released. Nothing is written or sent.
3. **Preflight with `--send` — only checks that can actually be made.** It runs before anything is written; any failure means nothing is written and nothing is sent.
   - (a) **Configuration** loads and validates: provider `smtp`, From equal to the SMTP username, and an internal recipient configured.
   - (b) **Recipient syntax:** the configured `RECRUITMENT_NOTIFICATION_RECIPIENT` is one plain mailbox. The code's `isDeliverableAddress` checks **syntax only**, despite its name.
   - (c) **Allowlisting** outside production.
   - (d) **Relay verification:** connect, TLS, login, nothing sent — as the retry command already does.

   **What no preflight can establish:** that the recipient exists, accepts mail or will receive the message, or that a relay policy refusal will not recur. Titan **accepted** `qa-bounce@bounce-test.invalid` and bounced it only afterwards (addendum §5.2), so even acceptance at `RCPT TO` would prove nothing about receipt.

   The cause is therefore confirmed by **the operator, on operational evidence**:
   - `--confirm-cause-corrected` is required;
   - `--evidence-ref` is required: a short reference to that evidence (for example a ticket or log-entry id), 1–80 characters, letters, digits and `._:/#-` only — **no `@`**, so no address can be stored;
   - the evidence expected for each reason:
     - `RECIPIENT_CORRECTED` — the corrected recruitment address is confirmed by the owner, and a message sent **by a person** from another mailbox has been seen arriving in the recruitment mailbox;
     - `ACCOUNT_RESTORED` — the provider console shows the mailbox active and below quota, plus the same human receipt check;
     - `RELAY_POLICY_RESOLVED` — a provider ticket states the policy refusal is resolved.

   The reason and the evidence reference are stored in the history entry. Claude does not judge them; the operator is accountable for them.
4. **One conditional write per Application: release and claim together.** The existing claim (`claimNotificationAttempts`, a conditional, validated save) is extended for this path. It matches the exact observed state (`status: FAILED`, the observed permanent `lastErrorCode`, the observed `attemptCount`). In the same write it:
   - **appends** a history entry to `notifications.internal.operatorRetries[]`: `{ at, reason, evidenceRef, previousErrorCode, attemptCountBefore, requestId }`;
   - claims the attempt as today: `attemptCount + 1`, `lastAttemptAt`, `ATTEMPT_IN_PROGRESS`.

   The write uses the repository's existing durable write path (majority, journaled). The claim fails (`LOST`) if a concurrent request or run changed the state, and then nothing is sent.
5. **Send and record** follow the unchanged B6 cycle: a bounded send, a conditional record, and `ATTEMPT_IN_PROGRESS` left in place if the record fails (uncertain, never re-sent automatically). A `SENT` result means **relay acceptance only**. The command prints the Message-ID token and tells the operator to confirm **receipt** in the recruitment mailbox. A later bounce goes to the bounce procedure: it is not retried, and HR is told the Application reference through an authorised restricted channel.
6. **Never automatic.** No new state becomes "due" for scheduled runs. A permanent refusal after a release is `PERMANENT` again and needs a new operator action, which adds a new history entry. `attemptCount` is never reset; the maximum-attempts bound still applies (`EXHAUSTED` is refused). The history is capped at 10 entries, and a release is **refused at the cap** rather than dropping old entries.
7. **Uncertain sends are untouched.** `TIMEOUT`, `OUTCOME_UNKNOWN` and stale `ATTEMPT_IN_PROGRESS` keep needing `--include-uncertain`; the release path never selects them.
8. **Logging.** The release is logged with fixed tokens (Application id, channel, reason, previous code, request id), never an address. In Phase 3, the same action also writes a `NOTIFICATION_OPERATOR_RETRY` AuditEvent (Doc 10 §§147–153).

Why this shape:

- The release and the claim are one write, so there is no window in which a "released" state could be picked up by something else, and every operator-initiated attempt has a history entry by construction.
- The history entry keeps the evidence that the previous code would otherwise lose (it is overwritten by the next outcome).
- **Schema change required (Doc 10 amendment):** the bounded `operatorRetries[]` sub-document on the notification channel. It holds codes, counts, times and a request id only — no address, no provider text (Doc 10 §122). This is the only way to keep durable history in Phase 1, which has no AuditEvent collection.

Rejected alternatives:

- (a) Reclassify relay refusals of the internal channel as CONFIGURATION (the r4 option). It is smaller, but it makes those refusals reachable by the general `--include-configuration` sweep and keeps no history.
- (b) Editing the document by hand in `mongosh`. It is unaudited, error-prone and bypasses the claim.

### 5.4 Acceptance tests (to be written with the change)

| # | Test | Environment |
| --- | --- | --- |
| R3-1 | Regression: an internal `PERMANENT` channel is never selected by `--send`, `--include-uncertain` or `--include-configuration` (filter and `assessChannel`) | offline + real MongoDB |
| R3-2 | The dry run lists exactly the eligible internal channels within the bound; the database is unchanged (snapshot compared); no submission | real MongoDB + local SMTP counter |
| R3-3 | Preflight failure (invalid configuration, recipient syntax invalid, recipient not allowlisted outside production, relay verification fails, `--confirm-cause-corrected` or `--evidence-ref` missing): nothing written, nothing sent | local SMTP test server |
| R3-4 | Success: one write appends history and claims (`attemptCount + 1`, `ATTEMPT_IN_PROGRESS`); one submission; recorded `SENT`; the history has `previousErrorCode`, `attemptCountBefore`, `reason` | real MongoDB + local SMTP |
| R3-5 | Concurrency: two release runs at once give exactly one claim, one submission and one history entry; the other run is `CLAIM_LOST` | real MongoDB |
| R3-6 | The state changes between scan and claim (another retry, a new outcome): no write, no send | real MongoDB |
| R3-7 | A candidate acknowledgement that is `PERMANENT` is refused: nothing written | real MongoDB |
| R3-8 | Uncertain states are not selected by the release path | offline + real MongoDB |
| R3-9 | The claim write fails or its outcome is unknown: nothing sent | fault injection |
| R3-10 | Refused again after a release: back to `PERMANENT`, not due; a second release adds a second entry; at the cap of 10 the release is refused and nothing is dropped | real MongoDB |
| R3-11 | `attemptCount` ≥ maximum: refused (`EXHAUSTED`) | offline |
| R3-12 | Logs carry no address (the existing log scan) | offline |
| R3-13 | Schema: history entries validated (reason enum, `evidenceRef` pattern and length, bounded array, types); the write guards updated | offline + real MongoDB |
| R3-14 | `--evidence-ref` containing `@`, control characters or over 80 characters is refused before anything is written | offline |
| R3-15 | A preflight that passes does **not** imply receipt: against a local SMTP test server that accepts the recipient, the command reports "accepted by the relay", prints the Message-ID token and the receipt-check instruction, and never says "delivered" | local SMTP test server |

**Blocks.** B6: no. **Production: yes** (it should exist before real Applications rely on email notification). Recommended milestone: **B7**, whose scope is backend failure behaviour, as a separately reviewed change. **Not implemented in this package.**

## 6. D — Email copy for approval

> **rev 4 (2026-10-26):** the b6-1 copy below is the **current implemented** text. The owner did **not** approve it as final. The "Approve as is" recommendations in §§6.1–6.2 are **withdrawn**. The proposed replacement copy, with a line-by-line diff, is in [`EMAIL_COPY_PROPOSAL.md`](../design/EMAIL_COPY_PROPOSAL.md), and Concept A is specified in [`EMAIL_CONCEPT_A_SPEC.md`](../design/EMAIL_CONCEPT_A_SPEC.md). This section stays as the record of b6-1.
>
> **rev 6 (2026-10-26):** the replacement copy, timestamp Option 1, the dark logo inline (CID) and the subject rule are **APPROVED** (OD-2026-10-26-02). They are not implemented: Stage 2 is not authorised. This section remains the record of b6-1.
>
> **rev 7 (2026-10-26):** Stage 2 is authorised (OD-2026-10-26-03) and `b6-2` is implemented with that copy, timestamp and subject rule; the logo waits for the owner's approval of the derived file. This section remains the record of b6-1.
>
> **rev 8 (2026-10-27):** the derived logo is approved (OD-2026-10-27-01) and integrated as one inline CID part.

Template version `b6-1` (`backend/src/integrations/notifications/templates.js`, unchanged). Placeholders: `{job.title}`, `{job.slug}`, `{applicationId}` (internal reference), `{submittedAt}` (an absolute UTC time, written `YYYY-MM-DD HH:MM:SS UTC`). Each message has a plain-text part and an equivalent HTML part. The HTML has no images, links, tracking or external resources. Dynamic values are HTML-escaped. Subjects are reduced to one line, control characters removed, at most 120 characters for the title. (b6-1 counts UTF-16 code units. The proposed b6-2 rule — the title segment limited to 120 grapheme clusters, ellipsis included; prefix and suffix never shortened — is in the Concept A specification §6.2.)

**Test labels.** No template contains a test label. "QA SMOKE TEST ROLE - NOT A REAL VACANCY <run id>" is the title of the synthetic Job created by the opt-in live test (`backend/scripts/smoke-lifecycle.mjs`), which refuses production (`APP_ENV`/`NODE_ENV`) and runs only against `valida_test*` databases. In production the title always comes from the real Job record. The real vacancy stays DRAFT.

### 6.1 `APPLICATION_ACKNOWLEDGEMENT` (to the candidate; only when `APPLICATION_ACKNOWLEDGEMENT_ENABLED=true`)

| Part | Current text (exact) | Status | Proposed change |
| --- | --- | --- | --- |
| From | `Valida Careers <notifications@cybervalida.com>` | DEV-B6-01 | — |
| Reply-To | `careers@cybervalida.com` | Doc 14 §203 (LOCKED) | — |
| Subject | `Application received: {job.title}` | **PROPOSED** (since r1) | **None. Approve as is.** It mirrors the approved eyebrow "APPLICATION RECEIVED" (Doc 06 §148). |
| Body, line 1 | `Thank you for applying.` | Approved — Doc 06 §149 | — |
| Body, line 2 | `Your application for {job.title} has been received.` (title in bold in HTML) | Approved — Doc 06 §150 | — |
| Body, line 3 | `If we need additional information or decide to continue the process with you, we will use the contact details included in your application.` | Approved — Doc 06 §150 | — |
| Sign-off | `Valida Careers` | **PROPOSED** | **None. Approve as is** (it matches the display name). |

Plain-text part, exactly as sent (verified against the returned original EV-A5):

```
Thank you for applying.

Your application for {job.title} has been received.

If we need additional information or decide to continue the process with you, we will use the contact details included in your application.

Valida Careers
```

### 6.2 `APPLICATION_RECEIVED_INTERNAL` (to `RECRUITMENT_NOTIFICATION_RECIPIENT`)

| Part | Current text (exact) | Status | Proposed change |
| --- | --- | --- | --- |
| Subject | `New application: {job.title}` | **PROPOSED** | **None. Approve as is.** |
| Body | see below | **PROPOSED** | **None. Approve as is.** |

```
A new application was received for {job.title}.

Role: {job.title} ({job.slug})
Received: {submittedAt}
Application reference: {applicationId}

The candidate details and the resume are stored privately in Valida and are not included in this email.
```

By design it carries no candidate name, email, phone, message, answers, file name, resume or resume link (Doc 09 §§189–190; Doc 14 §115). The live check of this (D5) is open.

### 6.3 Notes for the decision (no change proposed)

- The copy makes no promise of an interview, shortlisting, selection, response time, employment or immigration outcome (Doc 06 §153; Doc 12 §§118, 172).
- Nothing was added that the approved copy lacks: no privacy-notice link, no company footer. A privacy-notice link would need approved wording and the live public URL (Doc 14 §145 trusted origin); it could be proposed at C4 / C6.

## 7. Roadmap checkpoint (Doc 18)

| | |
| --- | --- |
| **Complete in B6** (implemented; evidence as labelled) | Notification Service and both events; templates; failure classification; conditional claim against duplicate sends; bounded retry command; truthful readiness; SMTP adapter over verified TLS; opt-in live test with an ownership-verified cleanup (r1–r9). Windows + MongoDB 8.0.9: 145/145, 11/11, 17/17, `verify:b6` exit 2, audits 0, signatures verified (owner-reported, GPT-reviewed). **Live Titan:** relay acceptance; Gmail Inbox delivery; SPF / DKIM / DMARC PASS (owner-reported); Reply-To routing; no duplicate on replay; a bounce visible and correlated by Message-ID; no Sent copy (archival finding). |
| **Remaining for B6 acceptance** | See [`B6_ACCEPTANCE_CHECKLIST.md`](B6_ACCEPTANCE_CHECKLIST.md) (rev 6). In short: D1 — AMD-TITAN-01, -03, -04 and -05 approved and the approved amendments recorded (AMD-TITAN-02 is APPROVED); D2 — the rest of the procedure text approved (cadence and escalation timing APPROVED); D2a gap recorded (approach approved); D4 — the rest of the specification approved (copy, timestamp, logo choice and subject rule APPROVED, [`OWNER_DECISION_2026-10-26-02_B6_APPROVALS.md`](OWNER_DECISION_2026-10-26-02_B6_APPROVALS.md)), then the Stage 2 template revision with its tests and the Stage 3 evidence; GPT review; then the owner's explicit acceptance. D5 is closed. Commit, push and merge only when the owner authorises them. |
| **Explicitly sequenced, not deleted** (Doc 00 §5) | R3 recovery → **B7**; suppression for Doc 14 §120 → **B7** (gate G-SUP before acknowledgements are enabled in production); the optional acknowledgement budget (D2b) → **B7**, only if adopted; the B7 body-discard issue (**OPEN** — blocks public deployment) → **B7**; production credential and staging identity → **C6**; email backup → **owner's monthly operational task** (OD-2026-10-25-01; setup verification first; EA-0 / EA-2 superseded; EA-3 rescoped); automated-message copy (EA-1 rescoped) → **B7 candidate**; the **proposed** gate **G-COPY** → Doc 18 C6, new §180A, only if approved (AMD-COPY-01; not a B6 blocker); Microsoft/Outlook test → **D3/D5**; `notify.` identity or permanent amendment → **D3**; `careers@` mailbox → **Release E entry gate**; retention period → privacy / legal determination (Doc 13 §187). |
| **Next milestone** | **B7 — Backend Security, Failure & QA Gate** (Doc 18 §§139–142): NoSQL injection, mass assignment, request size (including the body-discard issue), file spoofing, path traversal, rate limit, safe errors, private storage; unit, integration, API, storage and negative results; a coverage diagnostic; then the Release B completion gate (§143). **Not started and not authorised by this package.** |

## 8. Remaining items after rev 5 (Stage 1 corrections) — what kind of item each one is

Nothing in this table is approved by this package; decisions already taken are marked as such. "Blocks" uses the columns of §2. The owner's remaining B6 approvals of wording are collected on one page: [`OWNER_APPROVAL_SHEET_B6_EMAIL.md`](OWNER_APPROVAL_SHEET_B6_EMAIL.md). Its six choices were approved on 2026-10-26 (OD-2026-10-26-02).

**8.1 Owner decisions (approval needed)**

| Item | Blocks | Where |
| --- | --- | --- |
| D1 — **direction and AMD-TITAN-02 (the permanent root-domain identity) APPROVED**; approve AMD-TITAN-01, -03, -04 and -05, and record the approved amendments in Doc 14 | B6 | [`B6_TITAN_AMENDMENTS.md`](B6_TITAN_AMENDMENTS.md); approval sheet §1 |
| D2 — **mechanism, primary monitor (Saeed), cadence (every calendar day, including weekends and holidays) and escalation timing (the same calendar day as discovery) APPROVED**; approve the rest of the procedure text; name a backup monitor and decide the unexpected-absence procedure (both UNRESOLVED) | B6 (procedure text); Prod (backup, or an approved absence procedure) | [`BOUNCE_PROCEDURE_FA.md`](../operations/BOUNCE_PROCEDURE_FA.md) |
| D2a — **approach APPROVED**; approve the design details: the storage choice (keyed HMAC recommended, or plaintext), the fail-closed key lifecycle (rev 5), the SUP-1 amendment, the operator identifiers, the location of the protected key copy, and the design of the key-material integrity verification (OPEN, design §4.5) | B6 (gap recorded); Prod (G-SUP) | [`RECIPIENT_SUPPRESSION_DESIGN.md`](../architecture/RECIPIENT_SUPPRESSION_DESIGN.md) |
| D2b — whether to adopt the acknowledgement budget; if so, its caps, chosen only after the plan's limits are verified (no numbers proposed) | Prod (owner choice; not a G-SUP criterion) | [`ACKNOWLEDGEMENT_BUDGET_PROPOSAL.md`](../architecture/ACKNOWLEDGEMENT_BUDGET_PROPOSAL.md) |
| D3 — approve the R3 design for B7 | Prod | §5 |
| D4 — **Concept A, the copy of both emails, timestamp Option 1, the dark logo inline (CID) and the subject rule APPROVED** (OD-2026-10-26-02); approve the rest of the specification, and the derived logo file in Stage 2 | B6 | [`OWNER_DECISION_2026-10-26-02_B6_APPROVALS.md`](OWNER_DECISION_2026-10-26-02_B6_APPROVALS.md); [`EMAIL_CONCEPT_A_SPEC.md`](../design/EMAIL_CONCEPT_A_SPEC.md) |
| D5 — **ACCEPTED and CLOSED** (2026-10-26); nothing further to approve | — | OD-2026-10-26-01 |
| D6a / G-COPY — approve the copy design for B7, and whether G-COPY becomes a canonical gate (AMD-COPY-01) | Prod, only if G-COPY is approved | Copy design §6 |
| D7 — Microsoft/Outlook deliverability test, later | — | §2 |
| D8 — a production-only credential before C6 | Prod | §2 |
| `shervin@` backup access (options a / b / c) | Every backup set is INCOMPLETE until decided | Backup proposal §4.1 |
| VeraCrypt installation, if Windows protection is insufficient | Backup setup | Backup proposal §6 |
| The `.ost` cache / temporary-file gap, if Device Encryption is not on | First backup run | Backup proposal §6.2 |
| Coverage of each existing local mail-data item found in the inventory | A COMPLETE backup set | Backup proposal §4.2 |
| The second backup device | An overall COMPLETE set | Backup proposal §6.3 |
| Retention of backup sets and recruitment email | — (AWAITING; no deletion) | Doc 13 §187 |
| The weekly reviewer of unresolved automated copies, once built | Prod, if G-COPY is approved | Copy design §3.8 |

**8.2 Setup facts (to verify and record; no approval implied)**

| Fact | Status |
| --- | --- |
| Outlook product, version, build, licence and support status | Not verified |
| Whether 2FA is on for each mailbox; whether application passwords can be created; the third-party-application access setting | Not verified |
| An Outlook sign-in with 2FA on and a separately named application password | Not performed |
| Which send-prevention options the installed Outlook offers (Send/Receive groups, *Send immediately when connected*, read receipts, purge options) | Not verified |
| Whether any account dialog sends a test message | Not verified (no Microsoft source found) |
| Existing Outlook profiles, data files and local folders holding Valida mail | Not inventoried |
| Folder list per mailbox, and what IMAP exposes (`Scheduled`, `Bounces-Handled`) | Not recorded |
| Mailbox sizes against the PST limit of the installed version | Not measured |
| Device Encryption availability and status; account type; recovery-key location | Not verified |
| Whether Titan indexes `X-Valida-Attempt` for `UID SEARCH HEADER`; APPENDUID; IMAP use of an application password | Not verified (live check, separately authorised) |
| Saeed's monitoring access to `notifications@` (Webmail with 2FA) | Not inspected |
| Titan's bounce limits as they apply to the owner's Bluehost plan: which tier ("Free" or "Paid") applies; whether the windows are rolling or calendar-based; whether a bounce counts when it arrives or when the original was sent (Titan's page states none of these) | Not verified (Titan's published guidance only) |
| Rendering of the Concept A templates in real clients (Gmail, Outlook Classic, Outlook Web, Apple Mail; light / dark; images off; 320 / 390 / 600 px) | rev 13: the build is `b6-3`; Outlook classic kind A1 **AUTHORISED**; cell A1-OC **PARTIAL** on `b6-2` (EV-S3-OC1), **NOT RUN** on `b6-3`; mockups seen in Outlook (EV-S3-OC2, EV-S3-OC3; rev 14: EV-S3-OC4, the mockup again, at 200 %); F-01…F-04 **OPEN** pending the `b6-3` check; rev 14: F-03 needs D-6 (no template fix within the approved design); **rev 15: D-6 APPROVED (OD-2026-11-02-02) — F-03 an accepted Outlook classic deviation; A1-OC PARTIAL on `b6-3` (EV-S3-OC5)**. Every other cell **NOT RUN** (rev 12 recorded the r5 correction) |

**8.3 Future implementation tasks (each needs its own authorisation)**

| Task | Proposed milestone |
| --- | --- |
| **Concept A template revision** for both emails (Stage 2), then independent review and the rendering matrix (Stage 3) — [`IMPLEMENTATION_PLANS_B6_TEMPLATES_B7_SUPPRESSION.md`](IMPLEMENTATION_PLANS_B6_TEMPLATES_B7_SUPPRESSION.md) | **B6** (before B6 acceptance); **AUTHORISED** (OD-2026-10-26-03); **implemented** in the sandbox, the approved logo included (OD-2026-10-27-01); Stage 3 separately authorised. rev 11: corrections for F-01, F-03 and F-04 proposed; **rev 13: approved (OD-2026-11-02-01) and implemented as `b6-3`** in the sandbox; client verification and the Windows + MongoDB run outstanding |
| R3 operator recovery path (D3) | B7 |
| Minimal suppression for Doc 14 §120 (D2a approach approved; G-SUP) — Stage 4 | B7, after B6 acceptance and separate B7 authorisation |
| The acknowledgement budget (D2b), only if the owner adopts it | B7, a separately reviewed change |
| Automated-message copy preservation (D6a), with tests C-01…C-28 | B7 candidate |
| The B7 body-discard issue (**OPEN**) | B7 — blocks public deployment |
| Production MongoDB / resume backup | C6 (Doc 18 §180) |
| A production credential; a staging identity | C6 |
| The first monthly email backup and the initial full recovery exercise | Owner's operational task, after setup verification — no code |
| The real vacancy (stays **DRAFT**) | E6 |
