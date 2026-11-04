# B6 — final review package (r12, 2026-11-03)

| | |
| --- | --- |
| Milestone | Release B → **B6 — Notification Integration** (Doc 18 §§133–138); next: B7 (§§139–143) |
| Build | **`b6-3`** — runtime unchanged since r6 (`templates.js` `46d0df76…57a3a9`, `emailLogo.js` `b52996c7…e2dc`, masthead `ac67a2cb…ea3b`); baseline GitHub `SaEeDX4/valida` `ec15048980c9e3e8134de4b3d7eeadc89b1aef96` |
| Supersedes | [`B6_ACCEPTANCE_PACKAGE_R10.md`](B6_ACCEPTANCE_PACKAGE_R10.md) (kept as history) |
| r12 scope | Records and publication only: B6-2 approved and the test configuration cleanup confirmed ([OD-2026-11-03-01](OWNER_DECISION_2026-11-03-01_B6_BOUNCE_PROCEDURE_APPROVAL.md)); evidence provenance corrected — the received Outlook screenshots are Outlook **classic** (B-OC), both Gmail web messages have rendering screenshots, GPT's inspection of the received Gmail acknowledgement, the approved R1 assignment as fact ([OR-2026-11-03-01 §7](OWNER_RECORD_2026-11-03_B6_R1_LIVE_RUNS.md)); Stage 3 reconciled requirement by requirement ([checklist §0](B6_ACCEPTANCE_CHECKLIST.md)); one documentation commit on top of the GPT-verified r11 commit. r11 scope is kept in the r11 package. **No code, test, asset or evidence file changed; no test rerun; no email; nothing pushed** |
| Labels | SOURCE / TEST / SIMULATION / **CLAUDE-INSPECTED** / **GPT-INSPECTED** / **PASTED, GPT-REVIEWED** / **OWNER-REPORTED** — never interchangeable ([OR-2026-11-03-01 §7.1](OWNER_RECORD_2026-11-03_B6_R1_LIVE_RUNS.md)) |
| Status | **B6 NOT ACCEPTED** until GPT's final recommendation and the owner's explicit acceptance. G-SUP **CLOSED** (production candidate acknowledgements disabled). G-COPY **PROPOSED**. B7 body-discard issue **OPEN**. Real vacancy **DRAFT**. Claude claims no approval |
| **Result** | **READY FOR GPT REVIEW.** No engineering work remains and no mandatory blocker is open. What remains is two confirmations from GPT's own record (Q1, Q2) and five single-cell owner decisions (L1–L5) — [checklist §0.3](B6_ACCEPTANCE_CHECKLIST.md) |

## 1. Requirement → evidence

| # | Requirement (source) | Evidence | Status |
| --- | --- | --- | --- |
| G1 | Notification Service and real provider boundary (Doc 18 §133, §138) | Code and suites; Windows + MongoDB 8.0.9 run of `b6-3` (EV-B6-3-W1): offline 2226 passed / 5 skipped, B6 gate 460, database 145, B6 database 16, rehearsal and cleanup 17, indexes 6/6, `verify:b6` exit 2 (provider gate pending by design); live Titan 2026-10-25 (historical) | **MET** |
| G2 | Both initial events (§135) | R1 runs A `920d6396`, B `7e2ac970`: GPT-reviewed pasted JSON contents — every automated check and lifecycle step passed, two submissions per run, nothing extra on replay, synthetic records and files removed; all four messages received (owner-reported) | **MET** |
| G3 | Phase 1 provider state (§136) | Titan; AMD-TITAN-01…05 **approved** | **MET** |
| G4 | Tests: success, provider rejection, timeout, invalid recipient, retry classification, partial failure (§137) | B6 unit, adapter and database suites (EV-B6-3-W1; sandbox J1 / J2) | **MET** |
| G5 | Real provider integration; authentication (§138; Doc 14 §§129–130) | Sender `notifications@cybervalida.com`; SPF / DKIM / DMARC pass on both Gmail originals; SPF / DKIM / DMARC / CompAuth pass on run B's internal notification at Outlook.com — OWNER-REPORTED | **MET** (owner-reported) |
| G6 | Gmail and Microsoft destinations; spam-placement observation (Doc 14 §§132–133) | Gmail: Inbox (2). Outlook.com: **Junk** (2), SCL 6, cause unknown — OWNER-REPORTED | **OBSERVED** — the requirement is an observation; Junk placement → production prerequisite P1 |
| G7 | Reply-To routes to the recruitment mailbox (Doc 14 §122) | Live 2026-10-25 (historical, reviewed); Reply-To unchanged in `b6-3` and pinned by T-09; the R1 reply test was excluded | **MET (historical)** |
| G8 | Per-message privacy (copy proposal §4 item 2; Doc 09 §§189–190; Doc 14 §115) | **T-07** (TEST; six unique markers through the real Apply, adapter and local SMTP); the five-field input builder (SOURCE); J8 S9 (SOURCE, scope corrected r10); **C13 on the received run A internal notification: PASS** (OWNER-REPORTED); **received run B acknowledgement: no candidate name, no candidate address in the bodies, only the inline logo attachment** (GPT-INSPECTED) | **MET**; the received `To` display name is Q2 |
| G9 | Suppression (Doc 14 §120) | DEV-B6-04 with SUP-1 **approved**; G-SUP closed | **APPROVED DEVIATION** |
| G10 | Bounce mechanism (Doc 14 §117) | Manual monitoring, primary monitor, cadence, escalation timing; D-2 items 1 and 3; item 2 = **24-hour manual review of uncertain outcomes, explicitly approved — no standing permission to re-send** ([OD-2026-11-02-03 §5](OWNER_DECISION_2026-11-02-03_B6_APPROVALS_D1_D3_D2_D4.md)). After R1: `notifications@` Inbox and Spam checked, **no bounce at the time of the check** (owner-reported; the next daily review continues) | **MET** — both procedures **APPROVED** (OD-2026-11-03-01) |
| G11 | Separate, revocable test credential and restored configuration (Doc 14 §185; README step 6) | Test app password **revoked**; test configuration **restored** (OWNER-REPORTED) | **MET** |
| G12 | Copy, specification, C2 masthead, `CAREERS` removal, P-04 (B6-4, B6-5) | OD-2026-10-26-02; OD-2026-11-02-01 | **MET** |
| G13 | Template build and regression (B6-6, B6-7) | T-01…T-13; J1, J2; EV-B6-3-W1 | **MET** |
| G14 | Stage 3 client matrix (B6-8; plan §4, §10 exit) | [Checklist §0.2](B6_ACCEPTANCE_CHECKLIST.md), S1–S15 | **Reconciled** — Q1, Q2 (GPT) and L1–L5 (owner) open |
| G15 | Outlook classic scrolling (C1 / C6 / C8) | D-6 **approved** — ACCEPTED DEVIATION, not a reflow PASS | **APPROVED DEVIATION** |
| G16 | Outlook classic visual, plain-text and screen-reader checks | EV-S3-OC5 (LONG, measured); OD-2026-11-02-03 decision 3 (ACK, owner-accepted); **C9 plain text and C10 Windows Narrator: OWNER-REPORTED, accepted** | **MET** (owner-reported where stated) |
| G17 | Live-test sender (AMD-TITAN-05 (d); Doc 14 §186) | `notifications@cybervalida.com` — option S1, for runs A and B; the runs were owner-authorised and owner-operated | **RECORDED** |
| G18 | GPT review; owner acceptance; push authorisation (B6-9, B6-10; Doc 18 §355) | This package | **OPEN** by definition |

## 2. Unresolved — only these

The single list is [checklist §0.3](B6_ACCEPTANCE_CHECKLIST.md): **Q1** (INT dark in Outlook classic on `b6-3`) and **Q2** (received-header values) for GPT to confirm from its own record; **L1** C3 images off, **L2** C8 text-only resizing, **L3** Outlook on the web, **L4** device availability, **L5** R1 role isolation — single-cell owner decisions; then GPT's final recommendation, the owner's acceptance and push authorisation. Closed since r11: O1 (configuration cleanup confirmed) and O2 (bounce procedures approved). Nothing already supplied to GPT is requested again.

## 3. Approved deviations (owner decisions; not PASS)

| ID | Deviation | Decision |
| --- | --- | --- |
| D-6 | Horizontal scrolling in Outlook classic (narrow window, high whole-message zoom), all content readable and reachable | OD-2026-11-02-02 |
| DEV-B6-04 + SUP-1 | Doc 14 §120 interim: manual bounce monitoring; no suppression until B7; G-SUP closed | OD-2026-11-02-03 |
| AMD-TITAN-01…05 | Titan as the long-term provider; root-domain automated sender; live tests separately authorised | OD-2026-10-26-02; OD-2026-11-02-03 |
| ACK appearance | Accepted on the owner's report (Outlook classic, maximized, 100 %, light and dark) | OD-2026-11-02-03 decision 3 |
| R1 role isolation | Three owner-operated mailboxes for four messages; one mailbox received an HR-role and a candidate-role message; roles separated by address and provider at most | For the owner's acceptance — L5 |

## 4. Production prerequisites — recorded, not B6 blockers

| # | Prerequisite | Before | Status |
| --- | --- | --- | --- |
| P1 | **Microsoft consumer inbox placement:** both Outlook.com messages went to Junk (SCL 6) with authentication passing; cause unknown | Production candidate acknowledgements reaching Microsoft mailboxes; Release D (D3 / D5) | **OPEN** — observation recorded (Doc 14 §133: "No deliverability result can be guaranteed universally") |
| P2 | Suppression implemented and tested (SUP-1…6, SUP-22; HMAC key copy location AWAITING INPUT) | Production acknowledgements — **G-SUP** | B7; NOT AUTHORISED |
| P3 | Backup monitor (UNASSIGNED); unexpected absence (UNRESOLVED) | Production acknowledgements | Open |
| P4 | OneDrive Personal conditions confirmed (private access, MFA, data protection, ownership) | The first bounce-log entry | Conditional (OD-2026-11-02-03) |
| P5 | Titan bounce and sending limits for the owner's plan | Production acknowledgements | UNVERIFIED |
| P6 | Non-production sending identity (Doc 14 §186) or a bounded exception per live test | Any future live test | AWAITING INPUT |
| P7 | Production-only credential (D8); staging identity; production MongoDB and resume backup | C6 | Open |
| P8 | B7 body-discard issue | Public deployment | **OPEN** — B7 |
| P9 | G-COPY (Titan keeps no Sent copy) | C6, only if approved | PROPOSED |
| P10 | Recruitment retention (Doc 13 §187); monthly email backup; `careers@` (Release E); the real vacancy (E6); canonical consolidation of the approved amendments into Doc 14 / Doc 06 | As listed | Open |

## 5. Stage 3

Reconciled requirement by requirement in [checklist §0.2](B6_ACCEPTANCE_CHECKLIST.md) (S1–S15). **r12 corrections:** the received Outlook screenshots are Outlook **classic** evidence (cell B-OC), so the r11 table's "B-OW: run B INT headers, Outlook on the web" was wrong — Outlook on the web has no rendering evidence (L3); both Gmail web messages have rendering screenshots (S8 MET); GPT's inspection of the received Gmail acknowledgement is recorded at its stated scope (S13); the R1 assignment is the approved one.

## 6. Git and publication state

| Place | State |
| --- | --- |
| Claude's recovered working copy (private source of the review packages) | Branch `b6-recovered-r9-rev6` at `ec15048`; the B6 work is uncommitted there by design |
| Claude's sandbox clone of `SaEeDX4/valida` | Branch **`b6-work`**: **two local commits** — `6da01e83958b3d886ca2518eb30382abcfde633d` (r11; GPT verified its 334 changes) and, on top of it, the r12 documentation commit, whose SHA is in the delivery note and the include-list header (a file cannot contain the hash of the commit that contains it). **Not pushed** |
| GitHub (`SaEeDX4/valida`, **public**) | `main` = `ec15048`; **no `b6-work` branch** on the remote |
| The owner's machines | Not touched by Claude |

**Publication** ([`B6_PUBLICATION_MANIFEST.md`](B6_PUBLICATION_MANIFEST.md)): reviewed code, tests, scripts and assets byte for byte; documentation byte for byte except **sanitized copies** where a personal workstation path or a masked personal mailbox address is replaced by a placeholder (rules P1–P3, each file listed with its original and published SHA-256). Withheld: the owner's screenshots and messages, output from the owner's machine and the live-run files (W1–W5). Not published because `.gitignore` excludes them: `*.log`. Private originals stay in the review packages and are cited by hash. A comment in `backend/src/server.js` naming an example path under the owner's workspace was already published in `main` at `ec15048`; B6 does not add it, and the code is left unchanged.

**Sensitive-data check of the publication diff:** see the delivered check log; the results are summarised in the manifest.

## 7. Doc 18 §356 elements — where each is answered

| Element | Where |
| --- | --- |
| Requirements completed / not implemented / awaiting input / deferred | §1–§5 here; [`B6_ACCEPTANCE_CHECKLIST.md`](B6_ACCEPTANCE_CHECKLIST.md) |
| Packages | `nodemailer` **10.1.4** (dependency; SMTP adapter); `smtp-server` **3.19.24** and `vite` **8.3.3** (dev; local SMTP test server, test tooling); `zod` ^4.6.6 and `vitest` ^5.0.3 (version bumps) |
| Environment variables (names only) | `TRANSACTIONAL_EMAIL_PROVIDER`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `TRANSACTIONAL_FROM_ADDRESS`, `TRANSACTIONAL_FROM_NAME`, `TRANSACTIONAL_REPLY_TO`, `TRANSACTIONAL_EMAIL_API_KEY`, `RECRUITMENT_NOTIFICATION_RECIPIENT`, `APPLICATION_ACKNOWLEDGEMENT_ENABLED`, `EMAIL_RECIPIENT_ALLOWLIST`, `NOTIFICATION_TIMEOUT_MS`, `NOTIFICATION_RETRY_MAX_ATTEMPTS`, `NOTIFICATION_RETRY_BASE_DELAY_MS`; scripts: `MONGODB_TEST_URI` |
| Database, API, security controls, commands | `backend/README.md` — "Notification boundary", "Notifications (B6)", "B6 live Titan test", "B6 verification", `GET /api/v1/health/ready`; [`B6_DECISION_PACKAGE.md`](B6_DECISION_PACKAGE.md); the implementation reports. No new public route |
| Tests executed and results | EV-B6-3-W1 ([`WINDOWS_EVIDENCE_R6.md`](../qa/b6-3/WINDOWS_EVIDENCE_R6.md)); J1–J8 |
| Manual and external verification | EV-S3-OC1…OC5; OR-2026-11-03-01 (R1, owner-reported; run JSON contents GPT-reviewed) |
| Known issues | §4; housekeeping in [`B6_REMAINING_BLOCKERS.md`](B6_REMAINING_BLOCKERS.md) §C |

## 8. After acceptance

0. **B7 pre-implementation report:** delivered with this package, outside the B6 commit (Doc 18 §§139–143); nothing in it is started.
1. **Publication:** with the owner's authorisation, `git push origin b6-work` from the sandbox clone — never a force-push — and nothing else. Merging into `main` is a separate owner step. In the owner's original workspace, which holds uncommitted work, `b6-work` is not checked out or pulled; it is fetched into a separate clone.
2. **B7** (Doc 18 §§139–143): first the pre-implementation report the project instructions require (active milestone, requirements, dependencies, repository state, expected files and packages, planned commands and tests, external inputs), then B7 only after its authorisation, on its own branch from the accepted `b6-work`, so the B6 and B7 diffs stay separately reviewable. Sequenced into B7 by the approved records: the security tests of §141 (including the body-discard issue), minimal suppression (G-SUP; preconditions in `IMPLEMENTATION_PLANS_B6_TEMPLATES_B7_SUPPRESSION.md` Part B.1), R3 operator recovery, the acknowledgement budget only if adopted, the automated-message copy candidate, TOOL-DEP0190; then the Release B completion gate (§143).

## 9. r12 file changes (against the r11 cumulative package; also the content of the r12 commit)

| Change | Path |
| --- | --- |
| Created | `docs/review/OWNER_DECISION_2026-11-03-01_B6_BOUNCE_PROCEDURE_APPROVAL.md` |
| Modified | `docs/operations/B6_BOUNCE_PROCEDURE_DRAFT.md`, `docs/operations/BOUNCE_PROCEDURE_FA.md` — title or approval row only (the approved r11 wording is byte-identical below it) |
| Modified | `docs/review/B6_ACCEPTANCE_CHECKLIST.md` (§0, final); `docs/review/B6_FINAL_REVIEW_PACKAGE.md`; `docs/review/OWNER_RECORD_2026-11-03_B6_R1_LIVE_RUNS.md` (§7); `docs/review/B6_BOUNCE_PROCEDURE_DECISION_SHEET.md`; `docs/review/B6_REMAINING_OWNER_APPROVALS.md`; `docs/review/B6_REMAINING_BLOCKERS.md`; `docs/review/B6_PUBLICATION_MANIFEST.md` |
| Modified | `docs/qa/b6-stage3/STAGE3_EMAIL_CLIENT_VERIFICATION_PLAN.md` (r11 revision row); `docs/qa/b6-stage3/LIVE_TEST_PROPOSAL_R1.md` (§7 r12 row) |
| Modified | `backend/README.md` — one sentence: the bounce procedure is approved (documentation; no code) |
| Regenerated by packaging | `docs/qa/b6-stage2/STAGE2_DELTA_MANIFEST.sha256` |
| Not changed | Every code, test, fixture, asset, script and evidence file; `backend/README.md` apart from that sentence |

The r11 file list is in the r11 package.
