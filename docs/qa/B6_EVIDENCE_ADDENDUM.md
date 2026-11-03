# B6 Evidence Addendum — Windows r9 results and live Titan verification

| | |
| --- | --- |
| Milestone | Release B → **B6 — Notification Integration** (Doc 18 §§133–138) |
| Code under test | B6 **final-r9**: baseline `ec15048980c9e3e8134de4b3d7eeadc89b1aef96` + the r9 delta (`valida-B6-final-r9.zip`, SHA-256 `f11d21e65f56ba956f452dd4c7015495323b5dbbb8ab333418a31a38768634ec`, 53 files). No runtime file has changed since. |
| Evidence date | 2026-10-25 (owner's machine, Pacific time = UTC−7; UTC times are given where the evidence states them) |
| Prepared | 2026-10-25, by Claude, **from the attachments listed in §1**. Claude ran no test and sent no email for this addendum. |
| Revision | **rev 1** (2026-10-25 evening, after GPT's review): manual check 5 recorded from a newly reported owner screenshot (EV-A10); cross-references to the decision package corrected. The evidence JSON files are unchanged. |
| Purpose | Records the owner-run evidence and the **manual** verification that the machine-generated evidence leaves open. The original evidence files are **not modified**: the bounce run's JSON still says `"bounceVerification": "PENDING_MANUAL"`, and §5.2 below records the completed manual check separately. |
| Status | Evidence record — **READY FOR GPT REVIEW**. It does **not** accept B6. The open decisions are in [`docs/review/B6_DECISION_PACKAGE.md`](../review/B6_DECISION_PACKAGE.md). |

## 0. Provenance labels

| Label | Meaning |
| --- | --- |
| **ATTACHED · INSPECTED** | The owner ran it; the artefact was attached to this cycle; Claude read it. The fact quoted is taken from the artefact. |
| **OWNER-REPORTED · GPT-REVIEWED** | The owner ran it and reported the result, and GPT reviewed it. **The artefact was not attached to this cycle**, so Claude has not inspected it. The fact is recorded as reported, not as observed. |
| **OWNER-SUPPLIED SCREENSHOT · GPT-INSPECTED · FILE NOT RECEIVED** | The owner supplied a screenshot and GPT inspected it, but the image file did **not** reach Claude's session. The fact is recorded as described in the review instruction. **No hash exists for it here, and none is invented.** |
| **NOT EVIDENCED** | Neither an artefact nor a report covers it. |

No result in this addendum comes from Claude's sandbox. The Linux / FerretDB / sandbox MongoDB 8.0.23 results of earlier cycles are a separate evidence class and are not repeated here.

## 1. Artefacts received in this cycle (evidence register)

SHA-256 values are of the files **as received** in this session. Whether they are byte-identical to the files on the owner's machine cannot be checked from here: the owner can compare with `Get-FileHash <file> -Algorithm SHA256`.

| ID | Artefact (owner's name, where known) | SHA-256 as received | Kept in the repository? |
| --- | --- | --- | --- |
| EV-A1 | Evidence JSON of run **e4e60b91** — `B6-r9-Titan-live-20261025-091817-492-evidence.json` | `ba22d91f200c23fe90dd212d42cb78e0086698419ef35ff16384f5dec99a9755` | **Yes**, byte-identical: [`docs/qa/evidence/b6-r9/`](evidence/b6-r9/B6-r9-Titan-live-20261025-091817-492-evidence.json) (addresses already masked by the script; no secret, no message content) |
| EV-A2 | Console output of the e4e60b91 plan and live run (PowerShell window, including the script as typed) | `242bbe554278ea5fddd59b94de07d650f630cf1a916a67389a767583e3716b7e` | No: it contains the unmasked personal test address (allowlist and command line). The owner keeps the original. |
| EV-A3 | Evidence JSON of run **7fcb590e** — `B6-r9-Titan-bounce-20261025-093226-736-evidence.json` | `e91ed831c28670f703e07e86d2f3930a67aadca99759da0f0077c7e72534049d` | **Yes**, byte-identical: [`docs/qa/evidence/b6-r9/`](evidence/b6-r9/B6-r9-Titan-bounce-20261025-093226-736-evidence.json) |
| EV-A4 | Console output of the 7fcb590e plan and live run | `c2e7a2bc28a37bdfe79f61cd2466ec9533ba6820df94b394a0e5d124a859070d` | No (same reason as EV-A2) |
| EV-A5 | `ForwardedMessage.eml` — the original returned inside the bounce | `c1800b263fd3e2cf2ad61450d4bb90caea79561e55aebcf2cb4e22fc9de0dd76` | No: its headers contain the owner's public IP address and a provider user identifier. Neither is reproduced anywhere in this repository. |
| EV-A6 | Screenshot: `hr@` Inbox (Titan webmail) with the reply-routing message open | `1b3af1fe9f2868c3eae4bb0bca353fddd24d8e1a3e4c41a03ba077b6e2c79516` | No: it shows the unmasked personal address (Doc 14 §188) |
| EV-A7 | Screenshot: Gmail Inbox — the acknowledgement of run **7fcb590e** | `6d9a7e16b49ca7abc7f171e39f4b71d5bf481fa2991b4311100fd14e1112c4bb` | No (same reason) |
| EV-A8 | Screenshot: `notifications@` → **Sent** (Titan webmail) | `ba732127fd58f33c8770f95e1b7ac2f56236e5b1457f80a52f150844f4abfd41` | No (kept with the review material) |
| EV-A9 | Screenshot: `notifications@` Inbox — "Undelivered Mail Returned to Sender" | `60d9e29ad4dbe722ba8a39c77a259b503776f00a6b7789ebcd2ac195a8f40bbf` | No (kept with the review material) |

| EV-A10 | Screenshot: `hr@` Inbox — the **opened internal notification** of run **7fcb590e** (received 9:33 am, 2026-10-25), newly reported after the first version of this addendum | **No hash.** The image file was not received in this session; only the review instruction describing it was. | No. If the owner supplies the file, record its SHA-256 here before relying on it further. |

`docs/qa/evidence/.gitattributes` stops Git from converting the evidence files' CRLF line endings, so the hashes above stay valid after a commit.

The PowerShell `Start-Transcript` files (`…-terminal.txt`) named in EV-A2 and EV-A4 were **not** attached; the console output was. See §8.

## 2. Windows + real MongoDB 8.0.9 — the r9 rerun

Provenance for every row: **OWNER-REPORTED · GPT-REVIEWED**. **The logs were not attached to this cycle, so Claude did not inspect them.**

| Check (r9 review §9) | Reported result |
| --- | --- |
| Environment | Windows, Node 24.21.0, MongoDB 8.0.9 |
| Complete real-database suite | **145 / 145 passed** |
| Focused smoke-cleanup suite (the r8 failure) | **11 / 11 passed** |
| Live-procedure rehearsal + ownership-verified cleanup | **17 / 17 passed** |
| `npm run verify:b6` | **exit 2**: every available gate passed; the live-provider gate pending by design |
| `npm audit` (full) and `npm audit --omit=dev` | **0 vulnerabilities** at the time of the run |
| `npm audit signatures` | **exit 0**: 168 registry signatures and 34 attestations verified. This check could not run in the sandbox in earlier cycles, so this is its first result. |

Together these close the r9 review's open item "r9 on Windows + MongoDB 8.0.9 — NOT RUN", **as reported**. The r8 failure (3 smoke-cleanup tests: E11000 on a missing unique key) does not recur.

## 3. Live configuration as used (EV-A1–EV-A4)

| Item | Value | Provenance |
| --- | --- | --- |
| Relay | `smtp.titan.email:465`, implicit TLS | ATTACHED · INSPECTED (`relay` in both JSON files; the console says "verify (connect + TLS + login, nothing sent): OK") |
| Authenticated mailbox / From | `Valida Careers <notifications@cybervalida.com>` | Masked in the console as `n***@cybervalida.com`; From and `X-AuthUser` are visible in full in EV-A5 |
| Reply-To | `careers@cybervalida.com` | EV-A5 header; masked `c***@` in the console |
| Recruitment recipient | `hr@cybervalida.com` | Allowlist in EV-A2 / EV-A4; masked `h***@` in the JSON |
| Candidate test recipient | the owner's personal Gmail address, written `<owner test mailbox, masked>` in this repository | Masked in the JSON; unmasked only in EV-A2 / EV-A4 (not kept here) |
| Bounce test recipient | `qa-bounce@bounce-test.invalid` (a reserved `.invalid` name that cannot exist) | EV-A4 allowlist; EV-A5 `To:` |
| `NOTIFICATION_TIMEOUT_MS` | `10000` | EV-A2 / EV-A4 |
| Database | `valida_test` (test database only) | JSON `database` |
| Runtime | Node `v24.21.0`, `win32 10.0.26300`; test server on `127.0.0.1` only | JSON `node`, `platform`, `listen` |
| Credential | Entered at a masked `Read-Host` prompt (`****************`). **No credential appears in any attachment.** None was requested or used by Claude. | EV-A2 / EV-A4 |

## 4. Run e4e60b91 — delivery

### 4.1 Automated result (EV-A1, EV-A2 — ATTACHED · INSPECTED)

- **Plan-only run:** exit **2**, "HARD LIMIT: at most 2 messages are submitted".
- **Live run:** started `2026-10-25T16:18:54.323Z`, finished `16:18:57.267Z`, **exit 0**, `"automatedResult": "PASS"` (scope, as written in the JSON: "automated checks and lifecycle steps only; not mailbox delivery, bounce verification or B6 acceptance").
- Checks, all `ok: true`: loopback listener; readiness 200 (database, storage, relay login); Apply 201; internal notification recorded `SENT`; acknowledgement recorded `SENT`; replay 200; **replay sent nothing more** (`submissions: 2`, attempt counts unchanged); dry-run retry assessment `due: []`; **no more submissions than planned** (`submissions: 2, refused: 0`); notification log lines name no address.
- Messages (`ACCEPTED_BY_RELAY` = the relay answered 250; this is not delivery):

  | Event | Recipient (masked) | Message-ID |
  | --- | --- | --- |
  | `APPLICATION_RECEIVED_INTERNAL` | `h***@cybervalida.com` | `<7e930aaa529608b999870dd959cb27fe.b6@cybervalida.com>` |
  | `APPLICATION_ACKNOWLEDGEMENT` | `<owner test mailbox, masked>` | `<01781424b8228b99d2389cf2ef52da6c.b6@cybervalida.com>` |

- Lifecycle, all `ok: true`: clean shutdown; 1 Application and 1 Job deleted (confirmed by the database); resume files removed; ownership record `RELEASING` → marker released → `CLEANED`; `failures: []`.

### 4.2 Manual verification (README "B6 live Titan test", step 4)

| # | Manual check | Result | Provenance and limits |
| --- | --- | --- | --- |
| 1a | `hr@` received the internal notification | **PASS** | OWNER-REPORTED. EV-A6 shows one "New application: QA SMOKE TEST ROLE - NOT A REAL VA…" from **Valida Careers** at **9:18 am** (= 16:18 UTC, the run's time). The subject is cut off, so the run id is not visible in the screenshot. |
| 1b | The acknowledgement arrived — **Inbox or Spam?** | **PASS — Inbox** | OWNER-REPORTED · GPT-REVIEWED. No screenshot of the e4e60b91 acknowledgement was attached (EV-A7 shows the 7fcb590e one). |
| 2 | Each message arrived **once** | **PASS** | OWNER-REPORTED. Consistent with the automated count (2 submissions; the replay added none) and with EV-A6 (one 9:18 message). |
| 3 | Gmail "Show original": SPF, DKIM, DMARC **PASS**; From; Reply-To; Message-ID equals `<01781424b8228b99d2389cf2ef52da6c.b6@cybervalida.com>` | **PASS** | OWNER-REPORTED · GPT-REVIEWED. The `Authentication-Results` header was **not attached**, so Claude has not inspected it (§8). From / Reply-To / DKIM `d=cybervalida.com` are independently visible on the 7fcb590e message (EV-A5). |
| 4 | A reply sent to the acknowledgement reaches `careers@` → `hr@` | **PASS — routing shown** | EV-A6 shows, in the **`hr@` Inbox**, a message from the owner's Gmail address, **To: careers**, subject "Application received: QA SMOKE TEST ROLE - NOT A REAL VACANCY e4e60b91", body "B6 QA reply-routing test — please ignore.", **9:24 am**. **Limit:** the screenshot does not show the reply's headers (`In-Reply-To` / `References`), so that it was written with Gmail's *Reply* (that is, addressed through the `Reply-To` header) is OWNER-REPORTED, not visible. It does show that mail addressed to `careers@` lands in `hr@`. |
| 5 | The internal notification contains no candidate name, email or resume | **PASS — for the visible body of one received internal notification** | **OWNER-SUPPLIED SCREENSHOT · GPT-INSPECTED · FILE NOT RECEIVED** (EV-A10). The message is the internal notification of the **bounce run 7fcb590e** for the synthetic Job, received at 9:33 am. Its visible body shows: the Job title and slug, the received time, Application reference `6ade2f3f61de6115a9541ca5`, and the statement that the candidate details and the resume are stored privately in Valida. **No candidate name, email address, phone number, application answers, resume content or resume link is visible.** The reference matches the bounce-test Application of EV-A3 (`6ade2f3f61de6115a9541ca5`), and the described layout matches the `b6-1` template. **Limits:** this shows the visible body of **one** message. It does not prove what is in hidden headers or in any attachment, and it does not prove the absence of candidate data in every possible notification. The template code and the offline tests are the evidence for the general case; that is code evidence, not live evidence. The e4e60b91 notification's body was not shown. No email was created or sent for this check. |
| 6 | Bounce | n/a | This run had no bounce exercise; see §5. |
| 7 | Sent copy | see §6 | |

## 5. Run 7fcb590e — bounce

### 5.1 Automated result (EV-A3, EV-A4 — ATTACHED · INSPECTED)

- **Plan-only run:** exit **2**, "HARD LIMIT: at most 4 messages are submitted".
- **Live run:** started `2026-10-25T16:33:01.344Z`, finished `16:33:05.765Z`, **exit 0**, `"automatedResult": "PASS"` (same scope wording as above).
- Checks, all `ok: true`: as in §4.1, plus "bounce test Application answered 201" and "no more submissions than planned (hard limit 4)": `submissions: 4, refused: 0`.
- The bounce exercise (informational in the JSON): `outcome: ACCEPTED_BY_RELAY`, `relayAcceptance: accepted`, recorded `status: SENT`, `code: null`, **`bounceVerification: "PENDING_MANUAL"`**. This value is left exactly as generated; §5.2 records the manual check.
- Messages (all `ACCEPTED_BY_RELAY`):

  | Event | Recipient (masked) | Message-ID |
  | --- | --- | --- |
  | `APPLICATION_RECEIVED_INTERNAL` (main) | `h***@cybervalida.com` | `<fa34268550d388f6feb4919198bf7710.b6@cybervalida.com>` |
  | `APPLICATION_ACKNOWLEDGEMENT` (main) | `<owner test mailbox, masked>` | `<965ef66bde7857ed4c2d5ef117cf5467.b6@cybervalida.com>` |
  | `APPLICATION_RECEIVED_INTERNAL` (bounce) | `h***@cybervalida.com` | `<b0b7599c338a79eb404188fa08073282.b6@cybervalida.com>` |
  | `APPLICATION_ACKNOWLEDGEMENT` (bounce) | `q***@bounce-test.invalid` | `<07bd13073d4a4cfde4a827932cdbb39d.b6@cybervalida.com>` |

- Cleanup and lifecycle, all `ok: true`: ownership `VERIFIED`; **2 Applications and 1 Job deleted** (confirmed); 0 remaining; resume files removed; ownership record `CLEANED`; `failures: []`.

### 5.2 Manual verification of the bounce (completes `PENDING_MANUAL`; recorded here, not in the JSON)

| Observation | Source |
| --- | --- |
| A message **"Undelivered Mail Returned to Sender"** from `MAILER-DAEMON@smtp-out.flockmail.com` arrived in the **`notifications@` Inbox** at **9:33 am** (16:33 UTC), in the same minute as the run (which ended at 16:33:05 UTC). | EV-A9 |
| Its text: "This is the mail system at host smtp-out.flockmail.com. I'm sorry to have to inform you that your message could not be delivered to one or more recipients…" and, for `<qa-bounce@bounce-test.invalid>`: "Host or domain name not found. Name service error for name=bounce-test.invalid type=A: Host not found". An attachment `ForwardedMessage.eml` (3 KB). | EV-A9 |
| The returned original (EV-A5) carries **`Message-ID: <07bd13073d4a4cfde4a827932cdbb39d.b6@cybervalida.com>`** — the bounce exercise's acknowledgement in EV-A3 — and **`Subject: Application received: QA SMOKE TEST ROLE - NOT A REAL VACANCY 7fcb590e`**. | EV-A5 vs EV-A3 |
| Other headers of the returned original: `From: Valida Careers <notifications@cybervalida.com>`, `To: qa-bounce@bounce-test.invalid`, `Reply-To: careers@cybervalida.com`, `Auto-Submitted: auto-generated`, `Date: Sun, 25 Oct 2026 16:33:03 +0000`, `Return-Path: <notifications@cybervalida.com>`, `X-AuthUser: notifications@cybervalida.com`, `DKIM-Signature: a=rsa-sha256; d=cybervalida.com; s=titan1`. Its text part matches the B6 template word for word. | EV-A5 |

**Result: PASS — a manually observable asynchronous bounce, correlated to the Application's message by its Message-ID, for this test.**

What this does **not** prove:

- **automated bounce ingestion** — nothing reads the `notifications@` Inbox;
- **any database status update** — the channel stays `SENT` (relay accepted), as designed; the backend has no `BOUNCED` state;
- other failure types (mailbox full, policy refusal, a remote `5xx` after a delay, `DELAY` notices), their timing, or Titan's behaviour for them;
- that the DSN parameters were used. The returned original contains the **full message body** (text and HTML parts), not headers only. The adapter asks for `RET=HDRS` and `ENVID=<Message-ID token>` only when the server **advertises** DSN; nodemailer 10.1.4 adds the parameters only in that case (`smtp-connection`: `this._supportedExtensions.includes('DSN')`). Whether `smtp.titan.email` advertised DSN is not recorded, and the DSN's machine-readable part (`Status`, `Action`, `Original-Envelope-Id`) was not attached. **Bounce correlation must rely on the returned original's Message-ID, not on ENVID** (see the bounce procedure).
- Bounces therefore carry the original content, including the candidate's address and the Job title: they are personal data in the `notifications@` mailbox (Doc 14 §178).

Other deliveries of this run (owner's screens): the main Application's acknowledgement `<965ef66b…>` in the Gmail **Inbox** at 9:33 am (EV-A7: From "Valida Careers <notifications@cybervalida.com>", the template text as sent); two "New application" messages in `hr@` at 9:33 am (EV-A6, consistent with the two internal notifications; subjects truncated).

## 6. Archival observation — no Sent copy of SMTP submissions

| Observation | Source |
| --- | --- |
| `notifications@` → **Sent** shows **"No messages"** at 9:34 am on 2026-10-25, after both runs (6 SMTP submissions in total). | EV-A8; owner-reported |

Conclusion for these tests: **Titan stored no Sent copy of the SMTP-submitted messages.** This agrees with Titan's own scripting guidance, whose samples copy each sent message to Sent with a separate IMAP `APPEND`. It is one observation of undocumented behaviour, which could change. **Consequence:** an archive that only collects mailbox folders would miss every automated outgoing message. The archive proposal ([`docs/architecture/EMAIL_ARCHIVE_PROPOSAL.md`](../architecture/EMAIL_ARCHIVE_PROPOSAL.md)) is updated accordingly.

## 7. What the evidence covers

| Requirement | Evidence now | Remaining |
| --- | --- | --- |
| Doc 18 §137 — success | Live: 6 submissions accepted by the relay; 5 arrivals reported by the owner (3 in `hr@`, all visible in EV-A6; 2 in Gmail, one visible in EV-A7) and 1 bounce (§§4–5) | — |
| Doc 18 §137 — provider rejection / timeout / retry classification / partial failure | Offline and local-SMTP evidence from earlier cycles (r4–r9) | Not reproducible live without provoking failures; not requested |
| Doc 18 §137 — invalid recipient state | Live: relay acceptance followed by an asynchronous bounce (§5.2). The backend state stays `SENT` | Decision D2 (DEV-B6-04) |
| Doc 18 §138 — "real provider integration where available" | Live runs e4e60b91 and 7fcb590e | — |
| Doc 14 §122 / Doc 17 §309 / QA-084 — Reply-To reaches the recruitment mailbox | Routing to `hr@` shown; *Reply* use owner-reported (§4.2 #4) | — |
| Doc 14 §129 / Doc 17 §310 / QA-083 — SPF, DKIM, DMARC on a real message | OWNER-REPORTED · GPT-REVIEWED PASS | Header not inspected by Claude |
| Doc 14 §132 — test against Gmail **and Microsoft/Outlook** | Gmail only | **Microsoft/Outlook not tested** (needs a live send — not authorised; proposed for D3/D5) |
| Doc 14 §133 — spam placement | Gmail: Inbox (both acknowledgements) | Microsoft/Outlook |
| Doc 14 §117 / MAIL-042 / Doc 17 §311 — bounce visibility | A bounce is visible in `notifications@` and correlatable by Message-ID | Whether manual monitoring is the "equivalent operational mechanism" is decision **D2** (DEV-B6-04; item C4 of the r4 review) |
| Doc 14 §120 — do not repeatedly send blindly to a suppressed / hard-bounced address | **Not met by the system.** There is no suppression list: a later, distinct Application with a hard-bounced address triggers another acknowledgement. | Interim deviation DEV-B6-04, with a production gate (decision package, D2a) |
| Doc 09 §§189–190 / Doc 14 §115 — no candidate data in the internal notification | PASS for the visible body of one received message (EV-A10, §4.2 #5) | Hidden headers and attachments not shown |
| Doc 09 §135 — no duplicate on replay | Live: replay sent nothing | — |
| Doc 14 §§182–183 — no accidental email to real candidates | Live: allowlist + hard limits held (`refused: 0`, counts as planned) | — |

## 8. Missing or not inspected — exact list

Nothing below was reconstructed, inferred into a PASS, or replaced by a new send.

1. The Windows r9 logs (real-database suite, cleanup, rehearsal, `verify:b6`) — **not attached**.
2. The `npm audit` and `npm audit signatures` outputs — **not attached**.
3. Gmail "Show original" / `Authentication-Results` for `<01781424b8228b99d2389cf2ef52da6c.b6@cybervalida.com>` — **not attached** (owner-reported PASS, GPT-reviewed).
4. A screenshot of the **e4e60b91** acknowledgement in Gmail — **not attached** (EV-A7 is the 7fcb590e acknowledgement).
5. The headers of the reply in EV-A6 — **not attached**.
6. The complete DSN source (its `message/delivery-status` part) — **not attached**; only the rendered DSN and the returned original.
7. A view of an internal notification's body (manual check 5) — **now reported**: an owner-supplied screenshot, inspected by GPT (EV-A10). **The image file itself was not received in this session, so it has no hash here.**
8. The `Start-Transcript` files (`…-terminal.txt`) — **not attached**; the console output was.
9. A Microsoft/Outlook recipient test — **not performed**.
10. DNS lookups for SPF / DKIM / DMARC (Doc 14 §§192–194) — not part of B6 (Release D4).

## 9. Redaction

- The personal test address appears in this repository only as `<owner test mailbox, masked>` (Doc 14 §188, Doc 13 SEC-065, QA-097).
- The owner's public IP address (a `Received` header of EV-A5) and the provider's user identifier header are reproduced nowhere.
- The two evidence JSON files kept here were already masked by the script ("Addresses are masked. No password, token or message content is in this file").
- Console outputs, the `.eml` and the screenshots stay with the owner and the review material; their hashes above make every reference traceable.
