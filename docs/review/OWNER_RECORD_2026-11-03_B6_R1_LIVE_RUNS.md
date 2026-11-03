# Owner record OR-2026-11-03-01 — the R1 live runs A and B: owner-reported results, and the evidence still to be attached

| | |
| --- | --- |
| Record ID | **OR-2026-11-03-01** — a record of the owner's statements. It creates no approval and no PASS. |
| Date | **2026-11-03** (America/Los_Angeles) |
| From | Saeed (owner), handoff "VALIDA — Consolidated B6 Closure and B7 Transition", section "Completed live evidence (owner-reported)" |
| Source text | The handoff arrived as message text, not as a file, so no byte copy is held. The statements in §1 are as recorded in this session; where the owner's original wording differs, the original controls. |
| Who ran it | The owner, in the owner test workspace `<owner workspace>`, with the opt-in live procedure (`backend/README.md`, "B6 live Titan test") under route R1 ([proposal](../qa/b6-stage3/LIVE_TEST_PROPOSAL_R1.md); plan-only approval OD-2026-11-02-03). Claude sent nothing, signed in to nothing and held no credential. |
| Labels | Everything in §1 is **OWNER-REPORTED**. No run output, header, screenshot or message source of these runs has reached this session (§4). Nothing here was inspected by Claude. |
| Status kept | **B6 NOT ACCEPTED.** G-SUP **CLOSED** — production candidate acknowledgements stay disabled. G-COPY **PROPOSED**. The B7 body-discard issue **OPEN**. The real vacancy **DRAFT**. **No further live email is authorised:** no send, reply test or bounce test. |

## 1. What the owner reports

| # | Owner's statement | Recorded as |
| --- | --- | --- |
| L1 | Run A `920d6396`; run B `7e2ac970` | The two run ids |
| L2 | Both runs exited 0 and submitted **exactly two messages** each | OWNER-REPORTED; 4 messages in total — the plan's budget |
| L3 | Both passed the replay / no-extra-send checks | OWNER-REPORTED (the script's own checks) |
| L4 | Database and file cleanup confirmed for both | OWNER-REPORTED — the script's cleanup of its synthetic records and resume files. **Not** the credential and configuration cleanup (§4, E11) |
| L5 | All four messages were received: **Gmail — Inbox; Outlook.com — Junk** | OWNER-REPORTED receipt and folder placement (Doc 14 §§132–133 observation) |
| L6 | Both Gmail originals inspected: **SPF, DKIM and DMARC pass** | OWNER-REPORTED authentication (Doc 14 §129) |
| L7 | Run B, Outlook.com, internal (HR-role) message headers: **SPF, DKIM, DMARC and CompAuth pass; SCL = 6; Junk.** The exact cause of the spam classification remains unknown | OWNER-REPORTED. Authentication passed; placement was Junk; cause **UNKNOWN** — no cause is inferred here |
| L8 | The received run A internal (HR-role) original passed the inspected candidate-privacy checks | OWNER-REPORTED **C13 (internal)** on a received message |
| L9 | Android Gmail rendering of both messages: **PASS** | OWNER-REPORTED, cell B-GA |
| L10 | "Preserve previously accepted offline Outlook and Narrator evidence." | The offline Outlook classic records already held (EV-S3-OC1…OC5; OD-2026-11-02-03 decision 3) are preserved unchanged. **Narrator:** the owner refers to previously accepted Narrator evidence; no Narrator record is held in this session, where plan check C10 still reads NOT RUN (r9). Nothing is re-run; the record is registered when supplied (§4, E12) |

## 2. The four messages, as far as the report establishes them

> **r11:** superseded by §6 — the assignment, the mailboxes and the sender are now recorded there.

The R1 proposal's matrix (M1–M4: run A both messages to Gmail, run B both to Outlook.com) was **not** the assignment executed: the owner describes the executed assignment as revised. The report establishes the following; the rest comes from the two run evidence files (§4, E1–E2), which this session does not hold. Nothing below is guessed.

| Run | Message | Received at | Established by the report | Still to come from the run files |
| --- | --- | --- | --- | --- |
| A `920d6396` | Internal notification (HR role) | Not stated | Received; the original passed the candidate-privacy checks (L8) | The provider and folder; the Message-ID token |
| A `920d6396` | Candidate acknowledgement | Not stated | Received (L5) | The provider and folder; the token |
| B `7e2ac970` | Internal notification (HR role) | **Outlook.com — Junk** | Authentication pass, CompAuth pass, SCL 6 (L7) | The token |
| B `7e2ac970` | Candidate acknowledgement | Not stated | Received (L5) | The provider and folder; the token |

Two messages reached Gmail (L5, L6) and therefore two reached Outlook.com; which two is in the run files. The sender identity used (S1, the production sender for these runs only, or S2) is also in the run files and the received headers.

## 3. Role-isolation limitation (recorded; not a defect)

- All four recipients were **test mailboxes operated by the owner**. The HR role and the candidate role were separated **by address only** — not by person and not by access boundary. Plus-aliases or provider aliases, if used, are one access boundary.
- C13 therefore shows **what a received message contains**: no candidate data in the internal notification (L8). It does **not** show who can read which mailbox. Production separation — `hr@` (Titan) for internal notifications, the applicant's own mailbox for acknowledgements — is not demonstrated by R1 and is **not claimed**.
- The internal notification was not delivered to `hr@`, so cell **B-TW** (Titan webmail) is not covered: the R1 limitation already recorded in plan §5, outside the required matrix.

## 4. Evidence to attach — already captured or capturable from the existing messages; no send

> **r11:** the status of every item below is updated in §6.3. Items reviewed by GPT or accepted as owner reports are **not** requested again.

Each item is a file or a one-line statement the owner already has or can take from the four received messages. **None of it was inspected here.**

| # | Item | Why it is needed | Redaction |
| --- | --- | --- | --- |
| **E1** | Run A evidence file — by default `%TEMP%\valida-b6-live-smoke-920d6396.json` (or the path given with `--evidence`) — and the run's console output | The automated record (Apply 201, both channels SENT, replay, budget, cleanup) and the masked recipients and Message-ID tokens per message (§2) | Already masked by the script; check before sending |
| **E2** | Run B evidence file — `valida-b6-live-smoke-7e2ac970.json` — and console output | Same | Same |
| **E3** | For each Gmail message: the "Show original" header block (`Authentication-Results`, `From`, `Reply-To`, `Auto-Submitted`, `Message-ID`, `Content-Type`) as text or a screenshot | L6; C12 on received mail; ties each message to its token | Black out full addresses; keep domains and results |
| **E4** | Run B Outlook.com internal message: the same header block plus `X-MS-Exchange-Organization-SCL`, `X-Forefront-Antispam-Report` and `Authentication-Results` (CompAuth) | L7 | Same |
| **E5** | The run A internal original privacy check: what was searched (the synthetic candidate name `QA Smoke Candidate (synthetic)`, the candidate-role address, `qa-smoke-resume.pdf`) and in which parts | L8 — the C13 record | No full addresses |
| **E6** | Acknowledgement on a received message: the candidate address only in `To`, with no display name (one header line from E3 or E4 covers it) | C13 (acknowledgement rule) on received mail — not in the report | Black out the address; keep the absence of a display name visible |
| **E7** | Android Gmail screenshots of both messages, if taken, with the app version, Android version and device; light / dark as viewed | L9 — cell B-GA (plan §8 record) | Synthetic messages only; crop the rest |
| **E8** | Build identity of the workspace that sent them: `Get-FileHash` of `backend\src\integrations\notifications\templates.js`, `emailLogo.js` and `assets\valida-email-masthead-1200x216.png` in `<owner workspace>` (expected `46d0df76…57a3a9`, `b52996c7…e2dc`, `ac67a2cb…ea3b`) | Ties the delivered messages to `b6-3` (plan §8 "Build"); the run file does not record the template build | None needed |
| **E9** | Bounce observation: one line — whether any delivery-failure report for the four tokens arrived in `notifications@` (checked within 1 hour after each run and at the next daily review, D-2 item 1) | Completes the procedure's follow-up; all four were received, so none is expected | No report contents |
| **E10** | Archive (optional): whether a Sent copy appeared in `notifications@` | Not a B6 criterion — G-COPY is proposed only; the 2026-10-25 finding (no Sent copy) stands | — |
| **E11** | Credential and configuration cleanup, one line each: the test app password **revoked**; the `SMTP_*` lines removed and `TRANSACTIONAL_EMAIL_PROVIDER=none` in `backend\.env`; `RECRUITMENT_NOTIFICATION_RECIPIENT` and `EMAIL_RECIPIENT_ALLOWLIST` restored; `MONGODB_TEST_URI` removed from the session | Doc 14 §185; README step 6; proposal §5 step 5 | Never send a password, `.env` content or a screenshot of either |
| **E12** | The previously accepted Narrator (C10) record and, if one exists, the Outlook classic plain-text (C9) record — the file, or the reference to where it was accepted | L10 — this session holds neither | Synthetic files only |

## 5. What this record changes

- **Plan §10 step 3** (runs R-A and R-B): **done by the owner** — OWNER-REPORTED. **C13 on a received internal notification:** OWNER-REPORTED PASS (L8) — evidence E5 to attach.
- **D7** (Microsoft / Outlook delivery, Doc 14 §132): observed — delivered to **Junk** with authentication passing (L5, L7). The Junk placement and its unknown cause are recorded as a **production prerequisite** before production candidate acknowledgements reach consumer Microsoft mailboxes; internal notifications go to `hr@` on Titan, not to Outlook.com ([acceptance package §4](B6_ACCEPTANCE_PACKAGE_R10.md)).
- Everything else is unchanged. No approval is created by this record.

## 6. Update (r11, 2026-11-03, 13:13 America/Los_Angeles)

Source: the owner's message "Proceed with one consolidated B6 closure update on r10" (message text; no byte copy held). Statements are recorded at the level given.

### 6.1 New owner confirmations and GPT review

| # | Statement | Recorded as |
| --- | --- | --- |
| U1 | "Inbox and Spam of notifications@ were checked; no bounce was found at the time of that check." | **OWNER-REPORTED: no bounce at the time of the check.** Not a guarantee against a later report; the next daily review continues under the procedure (D-2 item 1) |
| U2 | "The temporary test credential has been revoked" | **OWNER-REPORTED: test app password revoked** |
| U3 | "Do not infer that .env/configuration cleanup was also completed." | **NOT CONFIRMED:** removal of the `SMTP_*` lines, `TRANSACTIONAL_EMAIL_PROVIDER=none`, restoring `RECRUITMENT_NOTIFICATION_RECIPIENT` and `EMAIL_RECIPIENT_ALLOWLIST`, removing `MONGODB_TEST_URI` |
| U4 | GPT reviewed the pasted JSON contents for runs `920d6396` and `7e2ac970`: all automated checks and lifecycle steps passed; two submissions per run; the replay sent nothing additional; the synthetic records and files were removed | **GPT-REVIEWED PASTED COPIES** of the two run evidence files — not byte-verified original JSON files; no file and no hash is held here |
| U5 | R1 used **three recipient mailboxes** and **four messages** | Recorded |
| U6 | Sender: `notifications@cybervalida.com` | Recorded — option **S1**, the production sender, for these two runs; not a standing permission (AMD-TITAN-05 (d)) |
| U7 | "Preserve the approved cross-provider assignments and the owner-controlled role-isolation limit." | §6.2 |
| U8 | "Preserve accepted Narrator, plain-text, visual and Android owner reports." | **OWNER-REPORTED, accepted** — plan C10 (Windows Narrator) and C9 (plain-text view) in Outlook classic, the visual reports, and B-GA (Android Gmail). Held as owner reports; no Narrator or plain-text record is held in this session, and none is requested |

### 6.2 The four messages — cross-provider assignment

In each run the internal notification and the acknowledgement went to **different providers**, so each provider received one message of each template.

| Run | Message | Provider and folder | Basis |
| --- | --- | --- | --- |
| A `920d6396` | Internal notification (HR role) | Gmail — Inbox | The approved cross-provider assignment (U7); L5, L6; C13 passed on this received original (L8) |
| A `920d6396` | Acknowledgement (candidate role) | Outlook.com — Junk | The approved cross-provider assignment (U7); L5 |
| B `7e2ac970` | Internal notification (HR role) | Outlook.com — Junk | Reported (L7) |
| B `7e2ac970` | Acknowledgement (candidate role) | Gmail — Inbox | The approved cross-provider assignment (U7); L5, L6 |

The per-message masked recipients are in the run JSON copies GPT reviewed (U4); none is held here.

**Role-isolation limit (owner-controlled).** Three mailboxes received four messages, all operated by the owner, so one mailbox received two messages — under this assignment, one internal-notification (HR role) and one acknowledgement (candidate role). The HR and candidate roles were separated by address and provider at most, not by person or access boundary. C13 shows what a received message contains, not who can read which mailbox; production separation (`hr@` on Titan vs. the applicant's mailbox) is not demonstrated and is not claimed (§3 unchanged).

### 6.3 Status of the §4 items

| # | r11 status |
| --- | --- |
| E1, E2 | **Reviewed by GPT as pasted copies** (U4) — not requested again |
| E3, E4 | Owner-reported results L6, L7 stand; not requested again |
| E5 | Owner-reported C13 result L8 stands; not requested again |
| E6 | The acknowledgement rule on a received message (address only in `To`, no display name) was not reported. It is shown at TEST level (T-07) and SOURCE level (J8 S9); the received-message check is listed for the owner's limitation decision, not as a new test |
| E7 | Android: accepted owner report (U8) — not requested |
| E8 | Build: the owner's statement of 2026-11-03 ("Active build b6-3, r9 cumulative, runtime unchanged from r6") — recorded as owner-stated; not requested |
| E9 | **Done** — U1 |
| E10 | Optional, not a B6 criterion |
| E11 | Credential revoked (U2); **configuration cleanup not confirmed** (U3) — the one remaining item |
| E12 | Accepted owner reports (U8) — not requested |
