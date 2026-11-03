# B6 — final review package (r11, 2026-11-03)

| | |
| --- | --- |
| Milestone | Release B → **B6 — Notification Integration** (Doc 18 §§133–138); next: B7 (§§139–143) |
| Build | **`b6-3`** — runtime unchanged since r6 (`templates.js` `46d0df76…57a3a9`, `emailLogo.js` `b52996c7…e2dc`, masthead `ac67a2cb…ea3b`); baseline GitHub `SaEeDX4/valida` `ec15048980c9e3e8134de4b3d7eeadc89b1aef96` |
| Supersedes | [`B6_ACCEPTANCE_PACKAGE_R10.md`](B6_ACCEPTANCE_PACKAGE_R10.md) (kept as history) |
| r11 scope | Records and publication only: the owner's confirmations and GPT's review of the run JSON contents ([OR-2026-11-03-01 §6](OWNER_RECORD_2026-11-03_B6_R1_LIVE_RUNS.md)); the corrected 24-hour manual review; the R1 mailboxes, sender and cross-provider assignment; Outlook classic and Outlook on the web evidence kept apart; sanitized publication copies. **No code, test, asset or evidence file changed; no test rerun; no email; nothing pushed** |
| Labels | SOURCE / TEST / SIMULATION / CLIENT / AT / **OWNER-REPORTED** / **GPT-REVIEWED PASTED COPY** — never interchangeable |
| Status | **B6 NOT ACCEPTED** until GPT's final recommendation and the owner's explicit acceptance. G-SUP **CLOSED** (production candidate acknowledgements disabled). G-COPY **PROPOSED**. B7 body-discard issue **OPEN**. Real vacancy **DRAFT**. Claude claims no approval |
| **Result** | **READY FOR GPT REVIEW.** The evidence is consolidated and no engineering work remains. Acceptance additionally needs the owner items in §2: one confirmation and two decisions |

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
| G8 | Per-message privacy (copy proposal §4 item 2; Doc 09 §§189–190; Doc 14 §115) | **T-07** (TEST; six unique markers through the real Apply, adapter and local SMTP); the five-field input builder (SOURCE); J8 S9 (SOURCE, scope corrected r10); **C13 on the received run A internal notification: PASS** (owner-reported) | **MET**. The acknowledgement rule on a received message was not reported → owner decision (§2, O3) |
| G9 | Suppression (Doc 14 §120) | DEV-B6-04 with SUP-1 **approved**; G-SUP closed | **APPROVED DEVIATION** |
| G10 | Bounce mechanism (Doc 14 §117) | Manual monitoring, primary monitor, cadence, escalation timing; D-2 items 1 and 3; item 2 = **24-hour manual review of uncertain outcomes, explicitly approved — no standing permission to re-send** ([OD-2026-11-02-03 §5](OWNER_DECISION_2026-11-02-03_B6_APPROVALS_D1_D3_D2_D4.md)). After R1: `notifications@` Inbox and Spam checked, **no bounce at the time of the check** (owner-reported; the next daily review continues) | **OPEN** — B6-2 text approval (§2, O2) |
| G11 | Separate, revocable test credential and restored configuration (Doc 14 §185; README step 6) | Test app password **revoked** (owner-reported). Configuration cleanup **not confirmed** | **OPEN** — one confirmation (§2, O1) |
| G12 | Copy, specification, C2 masthead, `CAREERS` removal, P-04 (B6-4, B6-5) | OD-2026-10-26-02; OD-2026-11-02-01 | **MET** |
| G13 | Template build and regression (B6-6, B6-7) | T-01…T-13; J1, J2; EV-B6-3-W1 | **MET** |
| G14 | Stage 3 client matrix (B6-8; plan §4, §10 exit) | §5 | **OPEN** — owner decision on the cells without evidence (§2, O3) |
| G15 | Outlook classic scrolling (C1 / C6 / C8) | D-6 **approved** — ACCEPTED DEVIATION, not a reflow PASS | **APPROVED DEVIATION** |
| G16 | Outlook classic visual, plain-text and screen-reader checks | EV-S3-OC5 (LONG, measured); OD-2026-11-02-03 decision 3 (ACK, owner-accepted); **C9 plain text and C10 Windows Narrator: OWNER-REPORTED, accepted** | **MET** (owner-reported where stated) |
| G17 | Live-test sender (AMD-TITAN-05 (d); Doc 14 §186) | `notifications@cybervalida.com` — option S1, for runs A and B; the runs were owner-authorised and owner-operated | **RECORDED** |
| G18 | GPT review; owner acceptance; push authorisation (B6-9, B6-10; Doc 18 §355) | This package | **OPEN** by definition |

## 2. Unresolved — only these

| # | Kind | Item | Closes with |
| --- | --- | --- | --- |
| **O1** | Mandatory confirmation | Configuration cleanup in the owner test workspace (README step 6): the `SMTP_*` lines removed, `TRANSACTIONAL_EMAIL_PROVIDER=none`, `RECRUITMENT_NOTIFICATION_RECIPIENT` and `EMAIL_RECIPIENT_ALLOWLIST` restored, `MONGODB_TEST_URI` removed | One line from the owner. Never send `.env` content |
| **O2** | Owner decision | B6-2: item 5 (planned absence, "approve as written" recommended) and approval of the complete English and Persian bounce procedures as they stand in r11 | One line |
| **O3** | Owner decision | B6-8 exit — accept as documented limitations the cells in §5 marked **owner decision**, and the R1 owner-controlled role-isolation limit | One line |
| **O4** | Review and acceptance | GPT's final recommendation; the owner's explicit B6 acceptance; authorisation to push `b6-work` | After O1–O3 |

Nothing else is requested: the run JSON contents (reviewed by GPT), the header and privacy results, the build statement and the Narrator, plain-text, visual and Android reports stand as recorded. Nothing mandatory is deferred, and no product defect is open.

## 3. Approved deviations (owner decisions; not PASS)

| ID | Deviation | Decision |
| --- | --- | --- |
| D-6 | Horizontal scrolling in Outlook classic (narrow window, high whole-message zoom), all content readable and reachable | OD-2026-11-02-02 |
| DEV-B6-04 + SUP-1 | Doc 14 §120 interim: manual bounce monitoring; no suppression until B7; G-SUP closed | OD-2026-11-02-03 |
| AMD-TITAN-01…05 | Titan as the long-term provider; root-domain automated sender; live tests separately authorised | OD-2026-10-26-02; OD-2026-11-02-03 |
| ACK appearance | Accepted on the owner's report (Outlook classic, maximized, 100 %, light and dark) | OD-2026-11-02-03 decision 3 |
| R1 role isolation | Three owner-operated mailboxes for four messages; one mailbox received an HR-role and a candidate-role message; roles separated by address and provider at most | For the owner's acceptance with O3 |

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

## 5. Stage 3 cells after R1

Outlook **classic** evidence is the owner's offline screenshots of the fixture files and the owner's reports (cell A1-OC). Outlook **on the web** evidence is the received R1 messages at Outlook.com (cell B-OW). They are different cells and are not combined.

| Cell | Evidence | Status |
| --- | --- | --- |
| **A1-OC** Outlook classic, offline fixtures | EV-S3-OC1…OC5 screenshots; LONG: C2, C4, C7 PASS, C1 / C6 / C8 D-6; ACK: C1, C2, C5 accepted; C9, C10 accepted (owner-reported) | **Complete except:** C3 (embedded images off) **not established**; C8 text-only resizing **not established** → **owner decision** |
| **B-GA** Gmail app, Android | Run A INT and run B ACK: PASS, accepted owner report | **Done** (owner-reported) |
| **B-GW** Gmail web | Run A INT and run B ACK received in the Inbox; both originals' authentication inspected (owner-reported) | Rendering in Gmail web is not in this session's records → covered by the accepted visual reports if they include it; otherwise **owner decision** |
| **B-OW** Outlook on the web | Run A ACK and run B INT received in Junk; run B INT headers inspected (owner-reported) | Rendering in Outlook on the web is not in this session's records → as B-GW |
| A2-OW LONG file in Outlook on the web | — | NOT RUN → **owner decision** |
| B-GI Gmail iOS; B-AI Apple Mail iOS | — | NOT RUN → **owner decision** |
| A1-AM / B-AM Apple Mail macOS; B-OC Outlook classic with a test mailbox | — | NOT RUN → **owner decision** |
| C13, acknowledgement rule on a received message | TEST T-07; SOURCE J8 S9 | Not reported for R1 → **owner decision** |
| B-TW Titan webmail (`hr@`); delivered LONG | — | Documented R1 and tooling limitations (plan §5, §9) → included in **owner decision** |

## 6. Git and publication state

| Place | State |
| --- | --- |
| Claude's recovered working copy (private source of the review packages) | Branch `b6-recovered-r9-rev6` at `ec15048`; the B6 work is uncommitted there by design |
| Claude's sandbox clone of `SaEeDX4/valida` | Branch **`b6-work`**: **one local commit** on `ec15048`, built from the publication list. **Not pushed.** Its SHA is given in the delivery note and in the include-list header, because a file cannot contain the hash of the commit that contains it |
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

1. **Publication:** with the owner's authorisation, `git push origin b6-work` from the sandbox clone — never a force-push — and nothing else. Merging into `main` is a separate owner step. In the owner's original workspace, which holds uncommitted work, `b6-work` is not checked out or pulled; it is fetched into a separate clone.
2. **B7** (Doc 18 §§139–143): first the pre-implementation report the project instructions require (active milestone, requirements, dependencies, repository state, expected files and packages, planned commands and tests, external inputs), then B7 only after its authorisation, on its own branch from the accepted `b6-work`, so the B6 and B7 diffs stay separately reviewable. Sequenced into B7 by the approved records: the security tests of §141 (including the body-discard issue), minimal suppression (G-SUP; preconditions in `IMPLEMENTATION_PLANS_B6_TEMPLATES_B7_SUPPRESSION.md` Part B.1), R3 operator recovery, the acknowledgement budget only if adopted, the automated-message copy candidate, TOOL-DEP0190; then the Release B completion gate (§143).

## 9. r11 file changes (against the r10 cumulative package)

| Change | Path |
| --- | --- |
| Created | `docs/review/B6_FINAL_REVIEW_PACKAGE.md` — this package |
| Modified | `docs/operations/B6_BOUNCE_PROCEDURE_DRAFT.md` (§4.7 step 4; revision note); `docs/operations/BOUNCE_PROCEDURE_FA.md` (status row; §7) |
| Modified | `docs/review/OWNER_DECISION_2026-11-02-03_B6_APPROVALS_D1_D3_D2_D4.md` (row 6; §5); `docs/review/B6_BOUNCE_PROCEDURE_DECISION_SHEET.md`; `docs/review/B6_REMAINING_OWNER_APPROVALS.md` |
| Modified | `docs/review/OWNER_RECORD_2026-11-03_B6_R1_LIVE_RUNS.md` (§6); `docs/qa/b6-stage3/LIVE_TEST_PROPOSAL_R1.md` (§7); `docs/qa/b6-stage3/STAGE3_EMAIL_CLIENT_VERIFICATION_PLAN.md`; `docs/qa/b6-stage3/EV-S3-OC1_OUTLOOK_CLASSIC_OFFLINE_ADDENDUM.md`; `docs/qa/b6-3/OFFLINE_COMPLETION_R9.md` (§5) |
| Modified | `docs/review/B6_ACCEPTANCE_PACKAGE_R10.md` (superseded note); `docs/review/B6_REMAINING_BLOCKERS.md`; `docs/review/B6_ACCEPTANCE_CHECKLIST.md`; `docs/review/B6_PUBLICATION_MANIFEST.md`; READMEs in `docs/qa/b6-3/`, `docs/qa/b6-stage3/` |
| Regenerated by packaging | `docs/qa/b6-stage2/STAGE2_DELTA_MANIFEST.sha256` |
| Not changed | Every file under `backend/` and `frontend/`; every test, fixture, asset, script and evidence file |
