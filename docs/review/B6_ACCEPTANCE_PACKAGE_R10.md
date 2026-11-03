# B6 — final acceptance package (r10, 2026-11-03)

> **Superseded (r11, 2026-11-03)** by [`B6_FINAL_REVIEW_PACKAGE.md`](B6_FINAL_REVIEW_PACKAGE.md). Kept unchanged below as the r10 record; where they differ, the r11 package applies.

| | |
| --- | --- |
| Milestone | Release B → **B6 — Notification Integration** (Doc 18 §§133–138); next: B7 (§§139–143) |
| Build | **`b6-3`** — runtime unchanged since r6 (`templates.js` `46d0df76…57a3a9`, `emailLogo.js` `b52996c7…e2dc`, masthead `ac67a2cb…ea3b`); baseline GitHub `SaEeDX4/valida` `ec15048980c9e3e8134de4b3d7eeadc89b1aef96` |
| r10 scope | Records only: the owner-reported live runs ([OR-2026-11-03-01](OWNER_RECORD_2026-11-03_B6_R1_LIVE_RUNS.md)); three r9 corrections (D-2 timings, J8 coverage and C3, R1 assignment and role isolation); this gate reconciliation; the publication manifest. **No runtime, test, asset or script change; no test rerun** — no change justifies one. No email, account access, push or deployment |
| Labels | SOURCE / TEST / SIMULATION / CLIENT / AT / **OWNER-REPORTED** — never interchangeable |
| Status | **B6 NOT ACCEPTED.** G-SUP **CLOSED** (production candidate acknowledgements disabled). G-COPY **PROPOSED**. B7 body-discard issue **OPEN**. Real vacancy **DRAFT**. Claude claims no approval |
| **Result** | **NOT READY FOR GPT REVIEW** as the final B6 package — no engineering work remains, but the owner-reported live results have no attached evidence yet, and two owner decisions are open (§2). When the items in §7 arrive they are registered without new tests, and the package becomes ready |

## 1. Requirement → evidence

| # | Requirement (source) | Evidence | Status |
| --- | --- | --- | --- |
| G1 | Notification Service and real provider boundary (Doc 18 §133, §138) | Code and suites; Windows + MongoDB 8.0.9 run of `b6-3` (EV-B6-3-W1): offline 2226 passed / 5 skipped, B6 gate 460, database 145, B6 database 16, rehearsal and cleanup 17, indexes 6/6, `verify:b6` exit 2 (provider gate pending by design); live Titan 2026-10-25 (historical) | **MET** |
| G2 | Both initial events (§135) | Suites; R1: both events delivered in each run (OWNER-REPORTED) | **MET** — live part owner-reported (E1, E2) |
| G3 | Phase 1 provider state (§136) | Titan, AMD-TITAN-01…05 **approved** (OD-2026-10-26-02; OD-2026-11-02-03) | **MET** |
| G4 | Tests: success, provider rejection, timeout, invalid recipient, retry classification, partial failure (§137) | B6 unit, adapter and database suites (EV-B6-3-W1; sandbox J1 / J2) | **MET** |
| G5 | Real provider integration; authentication (§138; Doc 14 §129–130) | R1: SPF / DKIM / DMARC pass on both Gmail originals; SPF / DKIM / DMARC / CompAuth pass on run B's Outlook.com internal message — OWNER-REPORTED | **MET as owner-reported** — headers to attach (E3, E4) |
| G6 | Gmail and Microsoft destinations; spam-placement observation (Doc 14 §§132–133) | Gmail: Inbox. Outlook.com: **Junk**, SCL 6, cause unknown — OWNER-REPORTED | **OBSERVED** (the requirement is an observation). Junk placement → production prerequisite P1 (§4) |
| G7 | Reply-To routes to the recruitment mailbox (Doc 14 §122) | Live 2026-10-25 (historical, reviewed); the Reply-To value is unchanged in `b6-3` and pinned by T-09; the R1 reply test was excluded by the owner | **MET (historical)** |
| G8 | Per-message privacy (copy proposal §4 item 2; Doc 09 §§189–190; Doc 14 §115) | **T-07** (TEST; six unique markers through the real Apply, adapter and local SMTP); five-field input builder (SOURCE); J8 S9 (SOURCE — scope corrected r10); **C13 on a received internal notification: PASS, OWNER-REPORTED** (run A) | **MET** at TEST / SOURCE; received check owner-reported (E5); acknowledgement rule on a received message not reported (E6) |
| G9 | Suppression (Doc 14 §120) | DEV-B6-04 with SUP-1 **approved** (OD-2026-11-02-03); G-SUP closed; production acknowledgements disabled | **APPROVED DEVIATION** |
| G10 | Bounce mechanism (Doc 14 §117) | Manual monitoring, primary monitor, cadence, escalation and the D-2 timings **approved**; procedure texts updated r10 | **OPEN** — B6-2 text approval (§2, M2) |
| G11 | Separate, revocable test credential (Doc 14 §185; README step 6) | Not reported for runs A and B | **OPEN** — confirmation (§2, M3) |
| G12 | Copy, specification, C2 masthead, `CAREERS` removal, P-04 (B6-4, B6-5) | OD-2026-10-26-02; OD-2026-11-02-01 | **MET** |
| G13 | Template build and regression (B6-6, B6-7; Doc 17) | T-01…T-13; J1, J2; EV-B6-3-W1 | **MET** |
| G14 | Stage 3 client matrix (B6-8; plan §4, §10 exit) | §5 below | **OPEN** — evidence or the owner's limitation decision per cell (§2, M4) |
| G15 | Outlook classic scrolling (C1 / C6 / C8) | D-6 **approved** (OD-2026-11-02-02) — ACCEPTED DEVIATION, not a reflow PASS | **APPROVED DEVIATION** |
| G16 | Acknowledgement in Outlook classic, maximized, 100 %, light and dark | OD-2026-11-02-03 decision 3 | **OWNER-ACCEPTED** (owner-reported) |
| G17 | Live-test sender (AMD-TITAN-05 (d); Doc 14 §186) | The option used (S1 production sender for these runs only, or S2) is in the run files | **TO RECORD** with E1–E2 (§2, M1) |
| G18 | GPT review; owner acceptance; separate push authorisation (B6-9, B6-10; Doc 18 §355) | — | **OPEN** by definition |

## 2. Mandatory blockers — only these

| # | Blocker | What closes it | New test or send? |
| --- | --- | --- | --- |
| **M1** | Evidence behind the owner-reported live results, and the build that sent them (G2, G5, G8, G17) | E1–E8 of [OR-2026-11-03-01 §4](OWNER_RECORD_2026-11-03_B6_R1_LIVE_RUNS.md): the two run files, redacted header blocks, the C13 record, one acknowledgement `To` line, the Android screenshots if taken, the three `Get-FileHash` values; plus E12 (the accepted Narrator record) | **No** — already captured, or read from the four received messages |
| **M2** | B6-2: the bounce procedure text (G10) | Item 5 "approve as written", and approval of the complete English and Persian texts in `docs/operations/` (r10) | No |
| **M3** | Credential and configuration cleanup after runs A and B (G11) | One line per step (E11); and the bounce check line (E9) | No |
| **M4** | B6-8 exit (G14) | For each cell in §5 marked **owner decision**: the observation from the existing messages, or the owner's acceptance of it as a documented limitation (plan §9–§10) | No |
| **M5** | B6-9 GPT review, B6-10 owner acceptance, push authorisation (G18) | After M1–M4 | No |

Nothing mandatory is deferred. No product defect is open: the Junk placement has an unknown cause and is not a demonstrated defect (§4, P1).

## 3. Approved deviations (owner decisions; not PASS)

| ID | Deviation | Decision |
| --- | --- | --- |
| D-6 | Horizontal scrolling in Outlook classic (narrow window, high whole-message zoom), all content readable and reachable | OD-2026-11-02-02 |
| DEV-B6-04 + SUP-1 | Doc 14 §120 interim: manual bounce monitoring; no suppression until B7; G-SUP closed | OD-2026-11-02-03 |
| AMD-TITAN-01…05 | Titan as the long-term provider; root-domain automated sender; live tests need separate authorisation | OD-2026-10-26-02; OD-2026-11-02-03 |
| G16 | The acknowledgement's Outlook classic appearance accepted on the owner's report | OD-2026-11-02-03 decision 3 |
| R1 role isolation | Roles separated by address only in owner-operated test mailboxes; recorded as a limitation, not claimed as production separation | OR-2026-11-03-01 §3 — for the owner's acceptance with M4 |

## 4. Production prerequisites — recorded, not B6 blockers

| # | Prerequisite | Before | Status |
| --- | --- | --- | --- |
| P1 | **Microsoft consumer inbox placement:** R1's Outlook.com messages went to Junk (SCL 6) with authentication passing; cause unknown | Production candidate acknowledgements to Microsoft mailboxes (G-SUP opening); Release D (D3 / D5) identity work | **OPEN** — observation recorded (Doc 14 §133); no guarantee is implied (§133: "No deliverability result can be guaranteed universally") |
| P2 | Suppression implemented and tested (SUP-1…6, SUP-22 key integrity; HMAC key copy location AWAITING INPUT) | Production acknowledgements — **G-SUP** | B7; NOT AUTHORISED |
| P3 | Backup monitor (UNASSIGNED); unexpected absence (UNRESOLVED) — decision-sheet items 6–7 | Production acknowledgements | Open |
| P4 | OneDrive Personal conditions confirmed (private access, MFA, data protection, ownership) | The first bounce-log entry | Conditional (OD-2026-11-02-03) |
| P5 | Titan bounce and sending limits for the owner's plan | Production acknowledgements | UNVERIFIED |
| P6 | Non-production sending identity (Doc 14 §186) or a bounded exception per live test | Any future live test | AWAITING INPUT |
| P7 | Production-only credential (D8); staging identity; production MongoDB and resume backup | C6 | Open |
| P8 | B7 body-discard issue | Public deployment | **OPEN** — B7 |
| P9 | G-COPY (automated-message copy; Titan keeps no Sent copy) | C6 — only if approved | PROPOSED |
| P10 | Recruitment retention (Doc 13 §187); monthly email backup; `careers@` mailbox (Release E); the real vacancy (E6); canonical consolidation of the approved amendments into Doc 14 / Doc 06 | As listed | Open |

## 5. Stage 3 cells (plan §4, §6) after R1

Which template reached which provider is in the run files (E1–E2); only run B's internal notification is placed by the report (Outlook.com). "Both templates in every required client" can therefore not be confirmed for the Gmail and Outlook.com cells until those files arrive.

| Cell | What is established | Status |
| --- | --- | --- |
| A1-OC Outlook classic, offline | LONG (INT): C2, C4, C7 PASS; C1 / C6 / C8 D-6. ACK: C1, C2, C5 owner-accepted; C4 derived | **C9, C10:** record pending (E12 — the owner reports Narrator evidence was accepted). **C3: NOT ESTABLISHED** (corrected r10). **C8 text-only resizing:** not established. → **owner decision** on C3 and C8 if no observation |
| B-GA Gmail app, Android | The two Gmail messages: PASS (owner-reported) | Templates and conditions (light / dark, TalkBack, largest font) not reported → E1–E2 and E7, or **owner decision** |
| B-GW Gmail web | Two messages received in the Inbox; both originals' authentication inspected (owner-reported) | Rendering not reported → observation from the existing messages, or **owner decision** |
| B-OW Outlook on the web | Two messages received in Junk, one of them run B's INT (owner-reported) | Rendering not reported (Junk view) → observation, or **owner decision** |
| A2-OW LONG file in Outlook on the web | — | NOT RUN (no send needed) → observation, or **owner decision** |
| B-GI Gmail iOS; B-AI Apple Mail iOS | — | NOT RUN → **owner decision** (device availability) |
| A1-AM / B-AM Apple Mail macOS; B-OC Outlook classic with a test mailbox | — | NOT RUN → **owner decision** |
| B-TW Titan webmail (`hr@`) | INT not delivered there (R1) | Outside the required matrix; R1 limitation (plan §5) |
| Delivered LONG | Not available with current tooling | Documented limitation (plan §9) |
| C13 privacy on received mail | INT: **PASS, owner-reported** (run A). ACK: not reported | E5, E6 to attach |

## 6. Doc 18 §356 elements — where each is answered

| Element | Where |
| --- | --- |
| Requirements completed / not implemented / awaiting input / deferred | §1–§4 here; [`B6_ACCEPTANCE_CHECKLIST.md`](B6_ACCEPTANCE_CHECKLIST.md) |
| Packages | `nodemailer` **10.1.4** (dependency; SMTP adapter); `smtp-server` **3.19.24** and `vite` **8.3.3** (dev; local SMTP test server, test tooling); `zod` ^4.6.6 and `vitest` ^5.0.3 (version bumps) — `backend/package.json` against `ec15048` |
| Environment variables (names only) | `TRANSACTIONAL_EMAIL_PROVIDER`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `TRANSACTIONAL_FROM_ADDRESS`, `TRANSACTIONAL_FROM_NAME`, `TRANSACTIONAL_REPLY_TO`, `TRANSACTIONAL_EMAIL_API_KEY`, `RECRUITMENT_NOTIFICATION_RECIPIENT`, `APPLICATION_ACKNOWLEDGEMENT_ENABLED`, `EMAIL_RECIPIENT_ALLOWLIST`, `NOTIFICATION_TIMEOUT_MS`, `NOTIFICATION_RETRY_MAX_ATTEMPTS`, `NOTIFICATION_RETRY_BASE_DELAY_MS`; scripts: `MONGODB_TEST_URI` — `backend/.env.example`, `backend/README.md` |
| Database, API, security controls, commands | `backend/README.md` — "Notification boundary", "Notifications (B6)", "B6 live Titan test", "B6 verification", and `GET /api/v1/health/ready`; [`B6_DECISION_PACKAGE.md`](B6_DECISION_PACKAGE.md); implementation reports (`docs/qa/b6-stage2/`, `docs/qa/b6-3/`). No new public route in B6 |
| Tests executed and results | EV-B6-3-W1 ([`WINDOWS_EVIDENCE_R6.md`](../qa/b6-3/WINDOWS_EVIDENCE_R6.md)); J1–J8 (`docs/qa/b6-3/evidence/`) |
| Manual verification, screenshots, external verification | EV-S3-OC1…OC5 (addendum); OR-2026-11-03-01 (live, owner-reported) |
| Known issues | §4; housekeeping in [`B6_REMAINING_BLOCKERS.md`](B6_REMAINING_BLOCKERS.md) §C |

## 7. Owner actions — only these

1. **One ZIP of what you already have** (no send, no new test): E1–E8 and E12 of [OR-2026-11-03-01 §4](OWNER_RECORD_2026-11-03_B6_R1_LIVE_RUNS.md), redacted as listed there.
2. **One line each** for E9 (any bounce for the four tokens?) and E11 (app password revoked; `.env` SMTP lines removed and provider `none`; recipient and allowlist restored; `MONGODB_TEST_URI` removed).
3. **One decision reply:** "B6-2: item 5 approved as written; I approve the English and Persian bounce procedures as they stand in r10. Stage 3: I accept as documented limitations the cells marked *owner decision* in package §5 [except: ___], and the R1 role-isolation limitation. Runs A and B used sender ___ for those runs only." — or your own wording.
4. **After GPT review:** explicit B6 acceptance, then authorisation to push branch `b6-work` ([publication manifest](B6_PUBLICATION_MANIFEST.md)).

## 8. After acceptance — B7 (not started, not authorised)

B7 — Backend Security, Failure & QA Gate (Doc 18 §§139–142): NoSQL injection, mass assignment, request size (with the body-discard issue), file spoofing, path traversal, rate limit, safe errors, private storage; unit, integration, API, storage and negative results with a coverage diagnostic; then the Release B completion gate (§143). Sequenced into B7 by the approved records: minimal suppression (G-SUP; preconditions in `IMPLEMENTATION_PLANS_B6_TEMPLATES_B7_SUPPRESSION.md` Part B.1, including SUP-22 and the key-copy location), R3 operator recovery, the acknowledgement budget only if adopted, the automated-message copy candidate, TOOL-DEP0190. B7 work goes on its own branch from the accepted `b6-work`, so the B6 and B7 diffs stay separately reviewable, and starts with the pre-implementation report the project instructions require.

## 9. r10 file changes (against the r9 cumulative package)

| Change | Path |
| --- | --- |
| Created | `docs/review/OWNER_RECORD_2026-11-03_B6_R1_LIVE_RUNS.md` — OR-2026-11-03-01 |
| Created | `docs/review/B6_ACCEPTANCE_PACKAGE_R10.md` — this package |
| Created | `docs/review/B6_PUBLICATION_MANIFEST.md` — branch `b6-work`, withheld and ignored files with SHA-256 |
| Modified — D-2 | `docs/review/OWNER_DECISION_2026-11-02-03_B6_APPROVALS_D1_D3_D2_D4.md` (row 6; §4 correction); `docs/review/B6_BOUNCE_PROCEDURE_DECISION_SHEET.md` (r10 row); `docs/operations/B6_BOUNCE_PROCEDURE_DRAFT.md` (§3, §4.6, §4.7 step 4, §5, revision note); `docs/operations/BOUNCE_PROCEDURE_FA.md` (status, §1, §5, §7, §8); `docs/review/B6_REMAINING_OWNER_APPROVALS.md` (r10 note) |
| Modified — J8 and C3 | `docs/qa/b6-3/OFFLINE_COMPLETION_R9.md` (three rows; §4 corrections K1–K3); `docs/qa/b6-stage3/STAGE3_EMAIL_CLIENT_VERIFICATION_PLAN.md` (r9 revision; A1-OC row); `docs/qa/b6-stage3/EV-S3-OC1_OUTLOOK_CLASSIC_OFFLINE_ADDENDUM.md` (Part VI C3 row); `docs/qa/b6-3/README.md` |
| Modified — R1 | `docs/qa/b6-stage3/LIVE_TEST_PROPOSAL_R1.md` (status; §2 note; §7 execution record); `docs/qa/b6-stage3/STAGE3_EMAIL_CLIENT_VERIFICATION_PLAN.md` (§5); `docs/qa/b6-stage3/README.md` |
| Modified — status | `docs/review/B6_ACCEPTANCE_CHECKLIST.md`; `docs/review/B6_REMAINING_BLOCKERS.md` (r10); `docs/review/B6_DECISION_PACKAGE.md` (D7 note) |
| Regenerated by packaging | `docs/qa/b6-stage2/STAGE2_DELTA_MANIFEST.sha256` |
| Not changed | Every file under `backend/` and `frontend/`; every test, fixture, asset, script and evidence file |

