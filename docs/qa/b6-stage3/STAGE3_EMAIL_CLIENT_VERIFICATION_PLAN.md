# B6 Stage 3 — email-client verification plan for the two notification templates (current build `b6-3`; `b6-2` kept as the record)

| | |
| --- | --- |
| Status | **r4 (2026-11-01, corrected):** **Kind A1 in Outlook classic only — AUTHORISED** by the owner (offline EML inspection; recorded in [OR-2026-11-01-01](../../review/OWNER_RECORD_2026-11-01_B6_STAGE3_OUTLOOK_OFFLINE.md); the authorising message itself was not received here). Cell **A1-OC: PARTIAL** on `b6-2` — observed results and outstanding checks in the [addendum §6](EV-S3-OC1_OUTLOOK_CLASSIC_OFFLINE_ADDENDUM.md); **not PASS**. **Every other cell: NOT AUTHORISED, NOT RUN** — including kind A1 in Apple Mail, kind A2 (online account access) and Part B (live email, which also needs a **separate live-email authorisation**). No email has been sent for Stage 3. |
| Revision | **r2** (2026-10-27, after GPT's review): coverage is shown for **both** templates in **every required client**, with each gap marked (§4); the INT delivery routes are set out for the owner's choice within the same 4-message budget (§5); local inspection is split into offline desktop inspection and file opening in an authenticated web or cloud client (§2). |
| Revision | **r3** (2026-10-27): the owner's preliminary offline Outlook classic inspection registered as **EV-S3-OC1** ([addendum](EV-S3-OC1_OUTLOOK_CLASSIC_OFFLINE_ADDENDUM.md)) — pre-authorisation; **it fills no cell**; every cell stays **NOT RUN**. Its findings F-01…F-04 ([findings](F01-F04_FINDINGS_AND_PROPOSAL.md)) add the recording requirements of §11. The matrix, routes, budget and checks are otherwise unchanged. |
| Revision | **r4** (2026-11-01). **Correction:** r3 called the owner's Outlook classic work "preliminary" and "pre-authorisation" and said it filled no cell. That was **incorrect** — kind A1 in Outlook classic was authorised (Status row). Added: **EV-S3-OC2**, the owner's Outlook screenshots of the C2+P04 review mockups (mockups, not the product: they fill no cell, §11.7); the owner-reported 200 % checks and monitor report (OWNER-REPORTED). The r3 row above is kept as written. |
| Revision | **r5** (2026-11-02): the build under test is now **`b6-3`** (OD-2026-11-02-01: C2 masthead, header label removed, P-04 colours; Outlook-only wrapper changed for F-03) — §1 updated; the `b6-2` identity kept as the record of EV-S3-OC1. Check C2 reworded for the masthead. Cell A1-OC: **PARTIAL on `b6-2`; NOT RUN on `b6-3`** — the next owner session (O-A in `docs/review/B6_REMAINING_BLOCKERS.md`) runs it. Everything else unchanged. |
| Revision | **r6** (2026-11-02, r7 package): EV-S3-OC4 registered — the owner's 100 % / 200 % screenshots show the r5 **mockup**, not `b6-3` (addendum Part IV), so A1-OC stays **NOT RUN** on `b6-3`; §11.10–11.12 added (file identity on every screenshot; the masthead floor in Outlook classic for C1 / C8; how D-6 would be recorded). No criterion was relaxed. |
| Revision | **r7** (2026-11-02, r8 package): owner decision **OD-2026-11-02-02 — D-6 APPROVED** (Outlook classic horizontal scrolling in a narrow window or at high whole-message zoom accepted as a deviation, provided all content remains readable and accessible by scrolling). §11.11 and §11.12 are **superseded** by §11.13; §11.14 added. The owner's original 07:12 screenshots of `b6-3` registered as EV-S3-OC5: A1-OC is now **PARTIAL on `b6-3`** (addendum §26). No other criterion changed. |
| Revision | **r8** (2026-11-02, r9): OD-2026-11-02-03 — **route R1 adopted as a plan only** (§5; the completed proposal is [`LIVE_TEST_PROPOSAL_R1.md`](LIVE_TEST_PROPOSAL_R1.md), awaiting separate approval); **C10 in Outlook classic uses Windows Narrator** (selected by the owner) instead of NVDA; **C3 in Outlook classic: N/A** — Microsoft documents its picture blocking for pictures downloaded from the Internet, no setting blocking an embedded image is documented, and the external-picture setting is not evidence for C3 (information without images is shown at source, J8 S7, and in simulation, J6); the acknowledgement's Outlook classic appearance (maximized, 100 %, light and dark) **accepted, owner-reported**. No criterion relaxed. |
| Revision | **r9** (2026-11-03, r10 package): **correction** — C3 in Outlook classic is **NOT ESTABLISHED**, not N/A: the r8 basis was one Microsoft page on pictures downloaded from the Internet; whether an embedded-picture block exists was not established, so C3 there is a documented limitation for the owner's decision (§9–§10). **Runs R-A `920d6396` and R-B `7e2ac970` executed by the owner** with a revised assignment ([OR-2026-11-03-01](../../review/OWNER_RECORD_2026-11-03_B6_R1_LIVE_RUNS.md), owner-reported): four messages received (Gmail Inbox; Outlook.com Junk); authentication passing; **C13 on a received INT: owner-reported PASS**; B-GA owner-reported PASS. Role-isolation limitation recorded (§5). No criterion relaxed. |
| Revision | **r10** (2026-11-03, r11 package): **C9 (plain-text view) and C10 (Windows Narrator) in Outlook classic: OWNER-REPORTED, accepted** (owner, 2026-11-03), with the visual and Android (B-GA) owner reports; no record of them is held in this session. **Evidence kinds kept apart:** Outlook **classic** = the owner's offline screenshots of the fixture files (EV-S3-OC1…OC5, cell A1-OC) and these owner reports; Outlook **on the web** = the received R1 messages at Outlook.com (cell B-OW: receipt in Junk; run B's internal-notification headers, owner-reported). Outlook classic with a test mailbox added (B-OC) was not run. R1: three recipient mailboxes, four messages, sender `notifications@cybervalida.com`, cross-provider assignment ([OR-2026-11-03-01 §6](../../review/OWNER_RECORD_2026-11-03_B6_R1_LIVE_RUNS.md)). No criterion relaxed. |
| Revision | **r11** (2026-11-03, r12 package): **correction of r10** — the owner's screenshots of the received Outlook.com messages were taken in Outlook **classic** (cell **B-OC**, GPT-inspected), not Outlook on the web; the r10 row's "Outlook on the web = the received R1 messages at Outlook.com (cell B-OW …)" is wrong — Outlook on the web has no rendering evidence, and Outlook.com contributes receiving-service behaviour only (Junk, SCL 6, authentication passing). **B-GW:** rendering screenshots of both messages (GPT-inspected). **C13 (ACK):** GPT inspected the received Gmail acknowledgement — no candidate name, no candidate address in the bodies, only the inline logo attachment. The R1 assignment is the approved one. Every cell reconciled against §4, §7, §9 and §10 in [`B6_ACCEPTANCE_CHECKLIST.md`](../../review/B6_ACCEPTANCE_CHECKLIST.md) §0.2. No criterion relaxed. |
| Covers | Checklist **B6-8**: independent review, the email-client rendering matrix, privacy verification on received mail. Required matrix: implementation plans §A.4; pass/fail rules: Concept A specification §10; privacy rule: copy proposal §5. |
| Not evidence | **Browser previews** (`docs/qa/b6-stage2/previews/`, Chromium) are **not** email-client evidence and fill no cell. Opening a file in a client — offline or online — is **not** evidence of how a receiving service treats the message. |
| Status kept | B6 **NOT ACCEPTED**. G-SUP **CLOSED** (acknowledgements stay disabled in production). G-COPY **PROPOSED**. Body-discard issue **OPEN**. Vacancy **DRAFT**. |

## 1. What is under test

| Item | Identity |
| --- | --- |
| Template version | **`b6-3`** (current); `backend/src/integrations/notifications/templates.js` SHA-256 `46d0df76a9f9301e775637a5c7ba930ab52c40a0f1c25005583903d79e57a3a9`. *Record:* `b6-2`, `9d8e998cf9639a516c1e35ed3a452be2a32e68b38179c44cadc3e1159fdc9534` — the build of EV-S3-OC1 |
| Image | **`b6-3`:** `assets/valida-email-masthead-1200x216.png` `ac67a2cb7d447a55d89bb3264198743d4114190e259775535215acabba1aea3b` (OD-2026-11-02-01), inline CID `valida-logo.b6@cybervalida.com`, shown at 600 × 108 and narrowing with the column. *Record (`b6-2`):* `assets/valida-logo-email-316x72.png` `b8c541749d0869f2473cc3344e6de5e8ecea9813bb106feb1fc3531602c8341a` (OD-2026-10-27-01), inline CID `valida-logo.b6@cybervalida.com`, shown at 158 × 36. **r3:** the black field is rejected on a light message background (owner feedback [OF-2026-10-27-01](../../review/OWNER_FEEDBACK_2026-10-27_B6_LOGO_LIGHT_RENDERING.md)); if a replacement is approved, the cells run on that revision and this row is updated |
| MIME | `multipart/alternative[text/plain, multipart/related[text/html, image/png]]` |
| Files for §2 kinds A1 and A2 | **`b6-3`:** `docs/qa/b6-3/fixtures/SYNTHETIC-acknowledgement.eml` `b6ef30bb59d70a9a974307138fae1b6fd1b3558fafd90e098306886ff622fac8`; `SYNTHETIC-acknowledgement-long-values.eml` `fcbe391ab4b44e8a7344bf86c8b56049bbef815e6f6a1fdd519aa0834eaf1f24`; `SYNTHETIC-internal.eml` `c1fa146455fec319f9d5dffa6d586ca104fbbf420f4f98a0b44aa576643e4989`; `SYNTHETIC-internal-long-values.eml` `b4bfb7c677d7c84ba156b48a982017be7009d1f2ea84027b778d187f2cf76bc0` — real adapter, local SMTP test server, synthetic values (b6-3 report §4). *Record (`b6-2`, EV-S3-OC1):* `docs/qa/b6-stage2/fixtures/SYNTHETIC-internal.eml` `2231a2379e845146b7f442a0a727a041eee64fd5167364d4e0fe2aa88619756f`; `SYNTHETIC-acknowledgement.eml` `0c46841170246cd580ccee273efa983b023048541d01ccd80eee1cc18ad9f02a`; `SYNTHETIC-internal-long-values.eml` `ec4972fdf19268bd7c73e4ce03c50b2ce5f0fd76caf51824f5b51ea3bfa8530a` — synthetic values, `synthetic.example.invalid` addresses, produced by the real adapter (report §7.1, I7). Check each hash before use. |
| Messages for kind B | Sent by the owner's opt-in live procedure (`backend/README.md`, "B6 live Titan test") with synthetic data; each identified by its Message-ID token |

Abbreviations: **INT** internal notification, **ACK** candidate acknowledgement, **LONG** internal notification with a 160-character title, 120-character slug and 24-hex reference.

## 2. Three kinds of evidence, never interchangeable

| | **A1 — offline desktop EML inspection** | **A2 — EML opened in an authenticated web or cloud client** | **B — delivered message** |
| --- | --- | --- | --- |
| What happens | A saved `.eml` is opened in a desktop client on a machine with the network **disconnected** for the session | A saved `.eml` is opened in a client that runs with a signed-in account; the file is handled by the client and may pass through its online service | The message is sent through Titan and read in a mailbox |
| Email sent | No | No | Yes |
| Network / account | **Offline; no account needed for the check.** If the client cannot open the file offline, the cell is recorded as A2-like ("online") and not as A1 | **Online, with account access.** "No email sent" does **not** mean offline or private: the synthetic file goes to a signed-in session and possibly the provider's service | Online, with access to the receiving mailbox |
| Clients | Outlook classic for Windows; Apple Mail on macOS | New Outlook for Windows (open or drag the `.eml`); Outlook on the web (drag the `.eml` in) — both documented by Microsoft | Gmail web and apps, Apple Mail on iOS, Outlook on the web, and desktop clients with a test mailbox added |
| Shows | How that client's renderer and reader present the message | The same for a web or cloud client — without any receiving step | Also the receiving side: filtering, sanitising, image handling, inbox list, headers and MIME tree as received |
| **Does not show** | Anything a receiving service does | **Anything a receiving service does** — opening a file is not receiving it, even in an online client | Clients not used |
| Data allowed | Synthetic fixtures only | Synthetic fixtures only (never a real message) | Synthetic data only |
| Label in the evidence | `A1-OFFLINE-EML` | `A2-AUTH-CLIENT-EML` | `B-DELIVERED` |

A result of one kind never fills a cell of another kind.

## 3. Clients and versions

Versions are those current at execution. Every cell records the exact client version or build and the OS version; web clients record the date and the browser with its version.

| Client | A1 | A2 | B | Where to read the version |
| --- | --- | --- | --- | --- |
| **Outlook classic for Windows** (Microsoft 365 Apps) | Yes | — | With a test mailbox added (§5) | File → Office Account → About Outlook |
| **New Outlook for Windows** (optional client) | — | Yes | With a test mailbox added | Settings → General → About Outlook |
| **Outlook on the web** | — | Yes (signed-in test account) | Yes (Microsoft test mailbox) | Date + browser version |
| **Apple Mail, macOS** | Yes | — | With a test mailbox added | Mail → About Mail; macOS version |
| **Gmail web** | No local route | No local route | Yes | Date + browser version |
| **Gmail app, Android and iOS** | No local route | No local route | Yes | App → Settings → About; OS; device |
| **Apple Mail, iOS / iPadOS** | No (a `.eml` from Files opens in Quick Look, not Mail) | No | Yes, with a test mailbox added | iOS version; device |
| **Titan webmail** (where `hr@` reads INT in production; outside the §A.4 matrix) | No | No | Only if INT is sent to `hr@` (§5) | Date + browser version |

## 4. Required coverage — both templates in every required client

The required clients are those of implementation plans §A.4. LONG is A1 / A2 only in every client: the live procedure always uses the title `QA SMOKE TEST ROLE - NOT A REAL VACANCY <run id>`, so **a delivered LONG message is not available** with current tooling (documented limitation).

| Required client | INT | ACK | Status with the **base routing** (both INTs to `hr@`) |
| --- | --- | --- | --- |
| Outlook classic, Windows | A1; B via an added test mailbox | A1; B via an added test mailbox | **INT delivered: MISSING** — needs route R1 or R2 (§5); A1 covers both |
| Outlook on the web | A2; B to a Microsoft test mailbox | A2; B (run R-B) | **INT delivered: MISSING** — needs route R1 |
| Apple Mail, macOS | A1; B via an added test mailbox | A1; B via an added test mailbox | **INT delivered: MISSING** — needs route R1 or R2; A1 covers both |
| Apple Mail, iOS | **B only** | B only (Gmail or Microsoft test mailbox added) | **INT: NOT COVERED AT ALL** — needs route R1 or R2 |
| Gmail web | **B only** | B only (run R-A) | **INT: NOT COVERED AT ALL** — needs route R1 or R2 |
| Gmail app, Android | **B only** | B only (run R-A) | **INT: NOT COVERED AT ALL** — needs route R1 or R2 |
| Gmail app, iOS | **B only** | B only (run R-A) | **INT: NOT COVERED AT ALL** — needs route R1 or R2 |

The previous version of this plan routed both INTs to `hr@`, which leaves INT uncovered in the Gmail clients and Apple Mail on iOS and undelivered elsewhere. That gap was not stated; it is now, and §5 gives the routes.

## 5. Part B — delivery routes for the owner's choice (budget unchanged: 4 messages)

The live procedure sends, per run without the bounce test, **1 INT** to `RECRUITMENT_NOTIFICATION_RECIPIENT` and **1 ACK** to `--candidate-recipient` — at most 2 messages. Two runs, **4 messages**, is the budget of this plan; it is **not** increased by any route below except R3, which needs the owner's explicit approval of a larger budget. INT carries no candidate data; pointing `RECRUITMENT_NOTIFICATION_RECIPIENT` at a test mailbox is a **run-time setting of the owner's local test run** (allowlisted, restored afterwards), not a production change — but it changes the recipient for that run and therefore needs the owner's explicit choice.

| Route | Run R-A | Run R-B | Required cells covered (INT and ACK) | Left out | Messages |
| --- | --- | --- | --- | --- | --- |
| **R1 — recommended** | INT and ACK → Gmail test mailbox | INT and ACK → Microsoft (Outlook.com) test mailbox | **All required clients, both templates, delivered:** Gmail web and apps and Apple Mail iOS from the Gmail mailbox; Outlook on the web from the Microsoft mailbox; Outlook classic and Apple Mail macOS with either mailbox added | INT in **Titan webmail at `hr@`** — the production reading place, **outside** the §A.4 matrix: documented limitation, or a later separately approved send | 4 |
| R2 | INT and ACK → Gmail test mailbox | INT → `hr@`; ACK → Microsoft test mailbox | Gmail clients, Apple Mail iOS, Outlook classic and Apple Mail macOS (Gmail mailbox added): both templates; Titan `hr@`: INT | **INT in Outlook on the web, delivered** — a required cell; only A2 would remain (not receiving behaviour): documented limitation | 4 |
| R3 — only with explicit approval of a larger budget | as R1 | as R1 | as R1 | — (adds R-C: INT → `hr@` and ACK → a test mailbox) | **6** |
| Base (no decision) | INT → `hr@`; ACK → Gmail | INT → `hr@`; ACK → Microsoft | ACK in all required clients; INT in Titan only | INT in all required clients (§4) | 4 |

**r9 (r10 package): runs R-A `920d6396` and R-B `7e2ac970` executed by the owner** with a revised assignment, not the M1–M4 matrix of the proposal; per-message destinations are in the run files, not yet received ([OR-2026-11-03-01 §2](../../review/OWNER_RECORD_2026-11-03_B6_R1_LIVE_RUNS.md)). **Role isolation:** every recipient was an owner-operated test mailbox, so HR and candidate roles were separated by address only; C13 shows message content, not access separation, and production separation (`hr@` vs. the applicant) is not demonstrated. **r8: R1 adopted as a plan only (OD-2026-11-02-03);** the completed sender / recipient / count / access proposal is [`LIVE_TEST_PROPOSAL_R1.md`](LIVE_TEST_PROPOSAL_R1.md); nothing runs before its separate approval. **Recommendation:** R1. It covers both templates in every required client within the existing 4-message budget; its one gap (Titan webmail at `hr@`) is outside the required matrix and is recorded as a limitation for the owner's decision. Adding `hr@` to further clients is **not** proposed: that mailbox holds real recruitment mail, so it would widen access to real personal data.

**For every route:**

- **Procedure:** `backend/README.md` "B6 live Titan test", steps 0–3 and the clean-up step; synthetic job and Application, the real Apply API, the real adapter, the test database; **without** the bounce test.
- **Allowlist:** every recipient of the run on `EMAIL_RECIPIENT_ALLOWLIST`.
- **Afterwards:** the README clean-up; the `.env` SMTP lines removed; `RECRUITMENT_NOTIFICATION_RECIPIENT` restored; a test app password revoked if one was created for the run.
- **Limits:** Titan's sending and bounce limits (UNVERIFIED for the owner's plan); about 6 logins per run; a failed login is never repeated (README).
- **Privacy check C13** is done on a received INT in whichever mailbox the chosen route uses.

## 6. Cells and conditions

"Both" means INT and ACK as allowed by the chosen route (§4–§5); LONG is A1 / A2 only.

| Cell | Client | Kind | Templates | Conditions |
| --- | --- | --- | --- | --- |
| A1-OC | Outlook classic, Windows | A1 | INT, ACK, LONG | light; dark (Office theme Black, message background dark and switched); plain-text view; NVDA reading order; zoom 200 %. **r4: AUTHORISED; PARTIAL on `b6-2`** (addendum §6); **r5: NOT RUN on `b6-3`**; **r6:** still NOT RUN — EV-S3-OC4 showed the mockup (§11.10); **r7: PARTIAL on `b6-3`** — EV-S3-OC5 (LONG, light, 100 % and 2.0); the ACK template, dark by screenshot, images off, plain text and screen reader still to run (addendum §26); **r8:** ACK C1 / C2 / C5 owner-accepted (owner-reported), ACK C4 derived, C3 N/A (Outlook classic) — **r9 correction: C3 NOT ESTABLISHED** (a limitation for the owner's decision), **C9 and C10 (Narrator) NOT RUN** in this record (r9: the owner refers to previously accepted Narrator evidence, not yet received here — OR-2026-11-03-01 E12); **r10: C9 and C10 OWNER-REPORTED, accepted** (OR-2026-11-03-01 §6) — the remaining client observations ([`../b6-3/OFFLINE_COMPLETION_R9.md`](../b6-3/OFFLINE_COMPLETION_R9.md)) |
| A1-AM | Apple Mail, macOS | A1 | INT, ACK, LONG | light; dark with "Use dark backgrounds for messages" on and off; Plain Text Alternative; VoiceOver; zoom 200 % |
| A2-OW | Outlook on the web | A2 | INT, ACK, LONG | light; dark; reading pane near 600 px and the narrowest available; zoom 200 % |
| A2-NO | New Outlook, Windows (optional) | A2 | INT, ACK, LONG | light; dark; zoom 200 % |
| B-GW | Gmail web | B | both | light; dark theme; zoom 200 %; inbox-list subject and preheader |
| B-GA | Gmail app, Android | B | both | light; dark; 390 px class device (320 px if available); TalkBack; largest font |
| B-GI | Gmail app, iOS | B | both | light; dark; VoiceOver; larger text |
| B-AI | Apple Mail, iOS | B | both | light; dark; VoiceOver; large Dynamic Type; 390 px (320 px if available) |
| B-OW | Outlook on the web | B | both (R1) / ACK (R2) | light; dark; inbox-list subject and preheader |
| B-OC, B-AM | Outlook classic; Apple Mail macOS — test mailbox added | B | both | light; dark |
| B-TW | Titan webmail (`hr@`) | B | INT (R2, R3 only) | light (dark if offered) |

## 7. Checks in every cell

| # | Check | Pass | Not acceptable (spec §10) |
| --- | --- | --- | --- |
| C1 | Layout | One readable column; header, accent rule, body, footer in order | Horizontal scrolling or clipped text at 320 px, 390 px or desktop width; overlapping text |
| C2 | Masthead (CID) — **r5** | **`b6-3`:** the masthead shown inline across the column (600 × 108 on desktop; narrower with the column), proportions kept, the mark legible on its dark band in light and dark; **record** whether it is also listed as an attachment (acceptable) and whether the client asked before showing it. *Record (`b6-2`):* Shown inline at about 158 × 36, proportions kept, its black field as approved (OD-2026-10-27-01); **record** whether it is also listed as an attachment (acceptable) and whether the client asked before showing it | Stretched, recoloured or cropped mark; an isolated dark rectangle on a light message background (OF-2026-10-27-01); a broken-image box without alt text; any other attachment |
| C3 | Images not shown | Where the client can block **embedded** images: alt text "Valida" or a clean gap; all information present. Where no setting blocks CID images: **N/A — no such setting** | Information lost without the image |
| C4 | Light mode | Contrast as specified | Text contrast below 4.5 : 1 (3 : 1 for the headline) |
| C5 | Dark mode | Client re-colouring acceptable if contrast holds | Contrast below the thresholds; the logo inverted or recoloured |
| C6 | Narrow widths | `CAREERS` hidden at ≤ 480 px where media queries work (shown elsewhere — acceptable) | Overflow, clipping or overlap |
| C7 | Long values (LONG) | Title, slug and reference wrap inside the column | Overflow or truncation in the body |
| C8 | Text at 200 % | Reflows; nothing clipped | Overlap or clipped text |
| C9 | Plain-text part | Exactly the approved text (`SYNTHETIC-*.txt`) | Information in one part and missing from the other |
| C10 | Screen reader | Reading order = source order; one heading; logo alt read once; layout tables not announced as data tables | Content skipped or out of order; the logo announced as a file name |
| C11 | Subject and preheader (B) | Subject exact under the title rule; preheader shown or omitted — both acceptable | A broken character or split grapheme in the subject |
| C12 | Headers and structure (B, "show original") | From `Valida Careers <notifications@cybervalida.com>`; Reply-To `careers@cybervalida.com`; `Auto-Submitted: auto-generated`; the §1 MIME tree; one image part | Any link, remote resource, tracking element or extra attachment |
| C13 | Privacy on received mail (B) | **INT:** no candidate data in the visible body, headers or any part. **ACK:** the address only as recipient, no display name | Any candidate data in INT; anything beyond the recipient address in ACK |
| C14 | No network fetch (A1) | With the network off, the file opens and the logo shows | The client tries to fetch anything |

Contrast is measured on the screenshot with a contrast checker (for example the free Colour Contrast Analyser) for body text, muted footer, metadata labels, eyebrow and headline; the ratios are recorded.

## 8. Evidence required for every cell

| Field | Content |
| --- | --- |
| Cell, template, mode | e.g. `B-GW / INT / dark` |
| Kind | `A1-OFFLINE-EML`, `A2-AUTH-CLIENT-EML` or `B-DELIVERED`; for A1, whether the network was actually off |
| Date and time | with time zone |
| Tester | name or role |
| Client | name and exact version / build / channel |
| OS and device | OS version; device model for mobile |
| Account (A2, B) | the kind of test account (never a real recipient's mailbox; never `hr@` for A2) |
| Settings | theme; message background; image setting; zoom or text size; reading-pane or screen width |
| Input | A1/A2: file name and SHA-256. B: Message-ID token, run id, route (R1/R2/R3), sending time |
| Build | `b6-2`; `templates.js` SHA-256 (§1) |
| Screenshots | PNG, the whole message, with SHA-256; **synthetic data only** — crop or blur everything else in the mailbox |
| Results | C1–C14: PASS / FAIL / N/A (reason) / NOT RUN; contrast ratios; screen-reader notes (what was announced, in order) |
| Observations | Any difference, classified acceptable or not under spec §10 |

Stored in `docs/qa/b6-stage3/evidence/` with a SHA-256 manifest; the cell log in [`stage3-cell-log-template.csv`](stage3-cell-log-template.csv). A cell without this record is **NOT RUN**.

## 9. Coverage that is not available

| Gap | Reason | Default |
| --- | --- | --- |
| Gmail web and apps, iOS Mail by file | No local route | Kind B, or **NOT RUN** |
| Delivered LONG | The live procedure's title is fixed | A1 / A2 only |
| INT in Titan webmail (`hr@`) under R1; delivered INT in Outlook on the web under R2 | The 4-message budget | Documented limitation for the owner's decision (§5) |
| Older Outlook versions, Outlook for Mac, Samsung Email, Yahoo and others | Not owned; no paid rendering service assumed | NOT RUN (outside the matrix) |
| 320 px on a real device | Depends on the devices available | NOT RUN if no device; a narrowed desktop window in a web client is recorded as such |
| "Images off" for embedded images | Many clients block only remote images | N/A with the reason |
| Receiving-service behaviour in A1 and A2 | Opening a file is not receiving it | Recorded under its own kind only |

The owner decides on each documented limitation (implementation plans §A.4).

## 10. Order of work and exit

1. Stage 3 authorisation recorded; the route (R1, R2, R3 or base) chosen by the owner; the inputs' hashes checked (§1).
2. Kind A1 cells, then kind A2 cells.
3. Only with the live-email authorisation: runs R-A and R-B (and R-C under R3); kind B cells; C13 on a received INT.
4. Independent review of the evidence (B6-8); then GPT review (B6-9).

**Exit for B6-8:** every required cell of §4 PASS for **both** templates, or recorded NOT RUN / N/A with the owner's decision on that limitation; no "not acceptable" difference left open; C13 passed on a received INT. Stage 3 does not by itself accept B6 (B6-10 is the owner's).

Open the three `.eml` files separately: INT and LONG share one synthetic Application reference and therefore one Message-ID, and a mailbox that imports both may merge them.

## 11. Additions from EV-S3-OC1 (r3), EV-S3-OC2 (r4) and EV-S3-OC4 (r6)

These come from the owner's Outlook classic screenshots ([addendum](EV-S3-OC1_OUTLOOK_CLASSIC_OFFLINE_ADDENDUM.md)). They tighten the record. (r3 added that they changed no cell result; **r4 correction:** cell A1-OC is PARTIAL — see the Status row.)

| # | Addition | Why |
| --- | --- | --- |
| 11.1 | For Outlook classic, record **light** as two separate conditions: (a) a **light Office theme**; (b) a **dark Office theme with the message background switched to light** | In (b) Outlook recoloured every HTML colour of the dark message but no image (F-01, F-04); (a) has not been observed |
| 11.2 | Record the **zoom** with a screenshot of the Zoom dialog, the **Windows display Scale** of the screen used, and the **width of the reading area** | Zoom values were reported, not shown; the layout width differed from the reading area (F-02); overflow at 200 % depends on the width (F-03) |
| 11.3 | **C2** is read with owner feedback OF-2026-10-27-01: an isolated black rectangle on a light message background is **not** a pass, pending the owner's decision on the treatment | F-01 |
| 11.4 | **C8** is recorded in two parts: text-only resizing (where the client offers it) must reflow; whole-message zoom is recorded with the zoom factor, the reading-area width, and whether all content is reachable — the acceptance of any scrolling is the owner's decision (findings R-03-A) | F-03: whole-message zoom scales the fixed 600 px Outlook wrapper |
| 11.5 | **Contrast**: in addition to a contrast checker, the pixel method of the addendum §3 may be used on lossless, unscaled screenshots (the logo measuring 158 × 36 px confirms the scale); report the text and background colours found | F-04: three light-rendering failures measured |
| 11.6 | **C14**: record how the network state was observed (e.g. the adapter turned off and shown in the screenshot); a statement alone is recorded as owner-attributed | §5 of the addendum |
| 11.7 | If a correction is approved, run every cell on the **approved revision**, with §1 updated (template and asset hashes) — not on `b6-2` and not on the review mockups | The review EMLs are mockups, not product output |
| 11.8 | **r4:** screenshots that arrive **resized** (EV-S3-OC2: 0.798) cannot give reliable colours for small text; request contrast screenshots as **un-resized PNG files**, and record the measured scale (column width ÷ 600) | EV-S3-OC2: 12 px labels could not be measured reliably |
| 11.9 | **r4:** owner reports without screenshots are recorded as **OWNER-REPORTED** in the cell log, separately from screenshot evidence; they do not close a finding by themselves | OR-2026-11-01-01 |
| 11.10 | **r6:** every Outlook screenshot must show the **window title or subject** of the file opened, and the cell log records the file name **and** its SHA-256 from §1 | EV-S3-OC4: the owner reported the `b6-3` fixture; the title showed the r5 mockup |
| 11.11 | **Superseded (r7) by §11.13.** **r6:** for Outlook classic, C1 and C8 are read with the masthead floor: the 600 × 108 image is laid out at its width attribute there, so the message is at least 600 CSS px wide (findings §4.4). Record the reading-area width and zoom; sideways scrolling below 600 × zoom CSS px is a **FAIL of C1 / C8 for Outlook classic** unless the owner approves decision D-6; C1 and C8 apply unchanged to every other client | The approved masthead is one 600 px image; Outlook classic applies no CSS width to images |
| 11.12 | **Superseded (r7) by §11.13** (the owner's approved wording carries none of these conditions). **r6:** if D-6 is approved, A1-OC records C1 / C8 for Outlook classic as **NOT MET — LIMITATION ACCEPTED BY THE OWNER (D-6)** (the §10 route "with the owner's decision on that limitation") only when its four conditions are shown by O-A screenshots of the `b6-3` fixtures (scrolled fully right in the narrow-window case); otherwise FAIL | Keeps the limitation bounded and evidenced |
| 11.13 | **r7 — D-6 approved (OD-2026-11-02-02).** For **Outlook classic only**, horizontal scrolling in a narrow window or at high whole-message zoom is recorded as **ACCEPTED DEVIATION (D-6)** for the scrolling criterion of C1, C6 and C8 — never as "PASS" or "reflow PASS" — provided all content remains readable and accessible by scrolling. Record the horizontal **and** vertical scrolling actually observed. **FAIL** remains the result for: content loss; inaccessible content; overlap that impairs reading or functionality; a text-resize defect. C1, C6 and C8 apply unchanged to every other client and to text-only resizing; D-6 fills no other check | The owner's decision; plan §11.4 left the acceptance of whole-message-zoom scrolling to the owner |
| 11.14 | **r7:** in the A1 / A2 cells the INT template is covered through LONG (the same template and markup; only the values differ, and LONG is the stress case); a separate short-INT capture is needed only if a reviewer asks for it. ACK is a different template and needs its own captures | Avoids repeating identical renderings; keeps both templates covered |
