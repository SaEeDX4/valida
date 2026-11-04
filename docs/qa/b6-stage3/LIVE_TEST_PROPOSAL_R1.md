# B6 Stage 3 Part B — controlled live-test proposal, route R1 (PROPOSAL — NOT AUTHORISED, NOT EXECUTED)

| | |
| --- | --- |
| Status | **PROPOSAL ONLY.** Route R1 is approved **as a plan only** (OD-2026-11-02-03). **No live operation may begin until the owner separately approves this completed proposal** — sender, recipients, count and access. Nothing here has been run; no address has been used; no account has been accessed. |
| r10 status (2026-11-03) | **Executed by the owner** as run A `920d6396` and run B `7e2ac970`, with a **revised assignment** — not the M1–M4 matrix below — and results **owner-reported** ([OR-2026-11-03-01](../../review/OWNER_RECORD_2026-11-03_B6_R1_LIVE_RUNS.md)). The proposal text below is kept as proposed; §7 records what was executed and the role-isolation limitation. |
| Build | `b6-3` (r6 runtime, Windows-tested; unchanged through r9) |
| Procedure | The existing opt-in live procedure, `backend/README.md` "B6 live Titan test", steps 0–6, **without** the bounce test and **without** the reply test |
| Purpose | The evidence offline files cannot give: **C13** on a received internal notification; C11 / C12 on delivered messages; the delivered-message cells of plan §4 / §6 for both templates; the LONG file in Outlook on the web (A2) |
| Status kept | **B6 NOT ACCEPTED.** G-SUP **CLOSED**: production candidate acknowledgements stay disabled; the procedure enables acknowledgements only inside its own throw-away server on `127.0.0.1` against the test database. |

## 1. The message matrix — two runs, at most four messages

Placeholders in angle brackets are **AWAITING OWNER INPUT**; nothing is assumed. "Synthetic" = the procedure's own data: job `QA SMOKE TEST ROLE - NOT A REAL VACANCY <run id>`, candidate name `QA Smoke Candidate (synthetic)`, resume `qa-smoke-resume.pdf` (a generated PDF), in the test database only.

| # | Run | Message | Header `From` | Envelope sender (MAIL FROM) | Envelope recipient (RCPT TO) | Visible `To` | `Reply-To` | Synthetic identity role | Expected evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | A — Gmail | Internal notification | `Valida Careers <notifications@cybervalida.com>` | `notifications@cybervalida.com` (the authenticated sender; DSN `RET=HDRS`, `ENVID=<message token>`, `NOTIFY=FAILURE,DELAY` — pinned by T-09) | `<GMAIL-HR-ROLE address>` — **AWAITING OWNER INPUT** | the same address, no other recipient | `careers@cybervalida.com` | **HR recipient** for this run (`RECRUITMENT_NOTIFICATION_RECIPIENT`, set for the run and restored) | §3: submission, relay acceptance, receipt; **C13 (internal)**; C11; C12 |
| M2 | A — Gmail | Candidate acknowledgement | as M1 | as M1 | `<GMAIL-CANDIDATE-ROLE address>` — **AWAITING OWNER INPUT** | the same address, **no display name** | `careers@cybervalida.com` | **Synthetic candidate** (`--candidate-recipient`) | §3; C13 (acknowledgement rule); C11; C12 |
| M3 | B — Outlook.com | Internal notification | as M1 | as M1 | `<OUTLOOK-HR-ROLE address>` — **AWAITING OWNER INPUT** | the same address | `careers@cybervalida.com` | HR recipient for this run | as M1 |
| M4 | B — Outlook.com | Candidate acknowledgement | as M1 | as M1 | `<OUTLOOK-CANDIDATE-ROLE address>` — **AWAITING OWNER INPUT** | the same address, no display name | `careers@cybervalida.com` | Synthetic candidate | as M2 |

**Count control.** Each run omits `--bounce-recipient`, so the script's own hard limit is **2 messages per run**; any further submission is refused before the relay. The replay inside the run must send nothing (the script checks it). The retry step is a **dry run only**. Two runs = **4 messages**, the plan's existing budget. No CC, no BCC, no other recipient.

**Sender identity — owner decision required.** AMD-TITAN-05 (d), now approved, says a future live test needs separate authorisation and, where possible, a non-production identity (Doc 14 §186), which is **AWAITING INPUT** on Titan. Two options, no paid service assumed:

- **S1 (only option available today):** the production sender `notifications@cybervalida.com`, from the owner's development machine, **for these two runs only**, as a bounded exception like DEV-B6-06 — not a standing permission.
- **S2:** a non-production sending identity, if the owner already has one at no extra cost — **AWAITING OWNER INPUT**.

## 2. Identities, access boundaries and secrets

| Item | Rule |
| --- | --- |
| HR / candidate separation | In each run the HR-role and candidate-role recipients are **different addresses**, so the internal notification and the acknowledgement go to different identities, as in production (`hr@` vs. the applicant). *(r10: "as in production" overstated this — with owner-operated test mailboxes the roles are separated by address only; see §7.)* **Plus-aliases of one mailbox (or provider aliases) are different addresses but one access boundary**: if the owner uses them, the evidence records "one mailbox, one access boundary; roles separated by address only". Separate accounts per role give separate boundaries; the owner chooses. All data is synthetic either way. |
| Exact recipient allowlist | For each run, `EMAIL_RECIPIENT_ALLOWLIST` holds **exactly the two addresses of that run** — no `@domain` entry; in particular **not** `@cybervalida.com` (the README's example), so nothing can reach the real `hr@`, and not `@bounce-test.invalid` (no bounce test). The script refuses a non-allowlisted candidate recipient; the service refuses a non-allowlisted internal recipient. |
| Mailboxes the owner signs in to | Only the two (or four) **test** mailboxes, in the owner's own browser and apps, to read M1–M4 and capture screenshots; and `notifications@` webmail (MFA) for the bounce check. **Not** `hr@`, **not** `careers@`; no forwarding or rule changes anywhere |
| Claude's access | **None.** Claude never signs in to, reads or receives credentials for any mailbox or account; it receives only redacted screenshots and the masked evidence file |
| SMTP secret | A **separate app password** for `notifications@` created for these runs only (Doc 14 §185; README step 0), placed **only** in `backend/.env` (`git check-ignore .env` must print `.env`), never pasted, screenshotted or sent; **revoked** after run B |
| Screenshots | Synthetic messages only; everything else in a mailbox cropped or blurred; full addresses blacked out in "Show original" images |

## 3. Evidence per message — kept apart

| Stage | Evidence | Never claimed from it |
| --- | --- | --- |
| **Submission** | The script's line for the synthetic Application: Apply API `201`, the run id; the masked evidence JSON | Acceptance or delivery |
| **Relay acceptance** | The channel recorded `SENT` = **accepted by the relay**; the Message-ID token printed by the script | Delivery |
| **Recipient receipt** | The message seen **once** in the test mailbox, folder noted (Inbox / Spam); one screenshot per client cell (plan §8 record) | Delivery anywhere else |
| **Bounce** | None expected (no bounce test; real test mailboxes). `notifications@` checked **within 1 hour** after each run and again at the **next daily review** (D-2, approved); any delivery-failure report matched by its Message-ID token and handled under the bounce procedure | — |
| **Unknown outcome** | If the script reports `UNKNOWN`, `TIMEOUT` or `OUTCOME_UNKNOWN`: recorded **INCONCLUSIVE**; **no resend, no further run, no retry with `--send`**; any later re-send is a separate, recorded owner decision under the procedure | Success or failure |

**C13 (internal notification, M1 and M3):** in "Show original" / the message source, none of `QA Smoke Candidate (synthetic)`, the candidate-role address, `qa-smoke-resume.pdf` or any other candidate detail appears in any header, the HTML, the plain text or the image part's metadata; exactly one image part (the logo). **Acknowledgement (M2, M4):** the candidate-role address only in `To`, with no display name. Governing rule: copy proposal §4 item 2; Doc 09 §§189–190; Doc 14 §115.

**C12 (all four):** `From: Valida Careers <notifications@cybervalida.com>`, `Reply-To: careers@cybervalida.com`, `Auto-Submitted: auto-generated`, the MIME tree `alternative[text/plain, related[text/html, image/png]]`, no link, no remote resource; SPF / DKIM / DMARC results as shown by the receiving service.

## 4. Reusing the same received messages

| Messages | Read in (cells) |
| --- | --- |
| Run A — M1, M2 (Gmail) | Gmail web (B-GW); the Gmail app on each phone the owner has — Android (B-GA) and / or iOS (B-GI); Apple Mail on iOS with the Gmail test mailbox added (B-AI); optionally Outlook classic or Apple Mail on macOS with that mailbox added (B-OC, B-AM) |
| Run B — M3, M4 (Outlook.com) | Outlook on the web (B-OW); Outlook classic with the Outlook.com test mailbox added (B-OC) if not done with run A |
| No send | **A2-OW**: the LONG fixture dragged into the Outlook.com web session (a delivered LONG message is not possible with the live procedure) |
| Not covered — documented limitations for the owner's decision | Titan webmail at `hr@` (outside the required matrix; a real mailbox); Apple Mail on macOS if no Mac; new Outlook (optional); any phone not available |

## 5. Order, cleanup and restrictions

1. Before run A: README steps 0–2 (configure; `--verify-only`, sends nothing; the plan, sends nothing). Stop on `PROVIDER_AUTH_FAILED` (never repeat a failed login) or `TLS_FAILED`.
2. Run A: step 3 with `--candidate-recipient <GMAIL-CANDIDATE-ROLE>` and **no** `--bounce-recipient`; `RECRUITMENT_NOTIFICATION_RECIPIENT=<GMAIL-HR-ROLE>`. Expect `AUTOMATED RESULT: PASS` (the automated part only) and `CLEANUP COMPLETE (confirmed)`.
3. Check `notifications@` within 1 hour. Read and capture the Gmail-side cells.
4. Run B: the same with the Outlook.com pair, after changing the two variables and the allowlist. Check `notifications@` within 1 hour; read and capture.
5. **Afterwards (README step 6):** confirm both cleanups (`--cleanup-run <run id>` if any record was kept); remove the `SMTP_*` lines and set `TRANSACTIONAL_EMAIL_PROVIDER=none`; restore `RECRUITMENT_NOTIFICATION_RECIPIENT` and `EMAIL_RECIPIENT_ALLOWLIST`; **revoke the test app password**; `Remove-Item Env:MONGODB_TEST_URI`. Check `notifications@` again at the next daily review.

**Excluded:** the bounce test; the reply test (README manual check 4 — it would send a fifth message into the real `careers@` / `hr@`); any send after an uncertain outcome; any production configuration change. Production `APPLICATION_ACKNOWLEDGEMENT_ENABLED` stays `false`.

## 6. What the owner must supply before approving

1. The recipient addresses — Gmail HR-role and candidate-role, Outlook.com HR-role and candidate-role — and whether each pair is two accounts or aliases of one (§2).
2. The sender option: S1 (production sender, these two runs only) or S2 (a non-production identity).
3. Which phones and computers are available for §4.
4. Then one explicit approval: "I approve live runs A and B exactly as in `LIVE_TEST_PROPOSAL_R1.md`: 4 messages, sender ___, recipients ___, with sign-in to those test mailboxes and to `notifications@` for the bounce check."

## 7. Execution record (r10, 2026-11-03) — owner-reported

| | |
| --- | --- |
| Runs | A `920d6396`, B `7e2ac970` — owner-operated in `<owner workspace>`; each exited 0, submitted exactly two messages and passed the replay / no-extra-send checks; cleanup of the synthetic records and files confirmed (owner-reported) |
| Received | All four: **Gmail — Inbox; Outlook.com — Junk** (owner-reported). Two messages per provider |
| Assignment | **Revised** from M1–M4. Established by the report: run B's internal notification went to Outlook.com (Junk). The provider of the other three messages, and the sender option used (S1 or S2), are in the run evidence files, which this session does not hold ([OR-2026-11-03-01 §2, §4](../../review/OWNER_RECORD_2026-11-03_B6_R1_LIVE_RUNS.md)). Nothing is assumed |
| Results | Gmail originals: SPF, DKIM, DMARC pass. Run B Outlook.com internal: SPF, DKIM, DMARC, CompAuth pass; SCL 6; Junk; cause unknown. Run A internal original: candidate-privacy checks passed (C13). Android Gmail, both messages: PASS. All OWNER-REPORTED |
| **Role-isolation limitation** | Every recipient was a test mailbox operated by the owner. HR and candidate roles were therefore separated **by address only**, not by person or access boundary (aliases, if used, are one boundary). C13 shows what a received message contains, **not** who can read which mailbox; production separation (`hr@` on Titan vs. the applicant's mailbox) is not demonstrated and not claimed. The internal notification was not delivered to `hr@` (cell B-TW, an R1 limitation) |
| **r11 update** ([OR-2026-11-03-01 §6](../../review/OWNER_RECORD_2026-11-03_B6_R1_LIVE_RUNS.md)) | **Three recipient mailboxes, four messages. Sender `notifications@cybervalida.com`** (S1, for these two runs). **Cross-provider assignment:** run A — INT → Gmail (Inbox), ACK → Outlook.com (Junk); run B — INT → Outlook.com (Junk), ACK → Gmail (Inbox); so each provider received one message of each template. **Role-isolation limit (owner-controlled):** one of the three mailboxes received both an HR-role and a candidate-role message. Run JSON contents: **reviewed by GPT as pasted copies** (not byte-verified originals) — all automated checks and lifecycle steps passed, two submissions per run, nothing extra on replay, synthetic records and files removed. `notifications@` Inbox and Spam: no bounce at the time of the owner's check. Test credential revoked (owner-reported); configuration cleanup not confirmed |
| **r12 update** ([OR-2026-11-03-01 §7](../../review/OWNER_RECORD_2026-11-03_B6_R1_LIVE_RUNS.md)) | The assignment above is the **approved** R1 assignment (fact). Received Outlook.com messages: screenshots in **Outlook classic** (B-OC, GPT-inspected) — not Outlook on the web. Gmail web: rendering screenshots of both messages (GPT-inspected). Received Gmail acknowledgement: no candidate name, no candidate address in the bodies, only the inline logo attachment (GPT-inspected). Test configuration restored (owner-reported) |
| Not done (excluded, as proposed) | Bounce test; reply test; any resend. No further live email is authorised |
