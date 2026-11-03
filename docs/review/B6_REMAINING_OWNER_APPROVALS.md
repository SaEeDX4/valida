# B6 — the remaining owner approvals, with their exact texts

| | |
| --- | --- |
| Purpose | One place to review the texts still awaiting the owner's approval for B6. **Nothing here is approved by this document**; every status below is copied unchanged from the governing records. |
| Prepared | 2026-10-27, from the working copy described in `docs/qa/b6-stage2/STAGE2_IMPLEMENTATION_REPORT.md` |
| Exactness | Each text is copied verbatim by a script from its source file; the source's SHA-256 and line range are given so the copy can be checked. If a source changes, this compilation is out of date. |
| Status kept | **B6 NOT ACCEPTED.** G-SUP **CLOSED**. G-COPY **PROPOSED, NOT APPROVED**. Body-discard issue **OPEN**. Vacancy **DRAFT**. |

## Overview

| Checklist | Item | Current status (unchanged) | Already approved, not asked again |
| --- | --- | --- | --- |
| B6-1 | AMD-TITAN-01, -03, -04, -05 wording, then their record in Doc 14 under Doc 00 §5 | **PROPOSED** | The business direction (OD-2026-10-26-01); AMD-TITAN-02 (OD-2026-10-26-02) |
| B6-2 | The rest of the bounce procedure text — English draft and Persian version | **PROPOSED**; backup monitor **UNASSIGNED**; unexpected absence **UNRESOLVED**; log location **AWAITING INPUT** | The mechanism and the primary monitor (OD-2026-10-26-01); the cadence — every calendar day, including weekends and holidays; the escalation timing — the same calendar day as discovery, including weekends and holidays (OD-2026-10-26-02) |
| B6-3 | The DEV-B6-04 text, with the SUP-1 amendment | **PROPOSED** | The D2a approach (OD-2026-10-26-01): a minimal suppression register for confirmed invalid recipients — design, implementation and verification pending; G-SUP stays closed until it passes its tests |

Not in this sheet, statuses unchanged: the rest of the Concept A specification (B6-5 — implemented as proposed, for review; its final approval rests on Stage 3 evidence); the suppression design details (D2a), the acknowledgement budget (D2b), R3 (D3), the automated-message copy and G-COPY (D6a) — later decisions, not B6 approvals.

**Added 2026-11-02 (r9) — [OD-2026-11-02-03](OWNER_DECISION_2026-11-02-03_B6_APPROVALS_D1_D3_D2_D4.md):** **B6-1 APPROVED** (AMD-TITAN-01, -03, -04, -05 as compiled below); **B6-3 APPROVED** (DEV-B6-04 with SUP-1, as compiled below); **B6-2 in part** — monitoring and escalation approved (decision-sheet items 1 and 3), no automatic resending, the log location conditionally OneDrive Personal; item 2, item 5 and approval of the complete English and Persian texts remain open. The compiled texts below are unchanged; their "PROPOSED" labels are historical for B6-1 and B6-3.

**Added 2026-11-03 (r10) — correction ([OD-2026-11-02-03 §4](OWNER_DECISION_2026-11-02-03_B6_APPROVALS_D1_D3_D2_D4.md)):** the D-2 timings, decision-sheet **items 1–3, are APPROVED** (item 2: 24 hours), with no automatic resending; they are now written into the live procedure files (`docs/operations/B6_BOUNCE_PROCEDURE_DRAFT.md`, `BOUNCE_PROCEDURE_FA.md`). **B6-2 still open:** item 5 and approval of the complete English and Persian texts as they now stand in `docs/operations/` (the compilation below is the earlier text and is kept as history).

**Added 2026-11-03 (r11) — correction ([OD-2026-11-02-03 §5](OWNER_DECISION_2026-11-02-03_B6_APPROVALS_D1_D3_D2_D4.md)):** item 2 is a **24-hour manual review of uncertain outcomes**, explicitly approved by the owner; it is not a standing permission to re-send. Both procedures corrected.

**Added 2026-11-02 (r6):** C2, the removal of `CAREERS` and P-04 are now **APPROVED** (OD-2026-11-02-01). All open owner decisions, with batched wording, are listed in [`B6_REMAINING_BLOCKERS.md`](B6_REMAINING_BLOCKERS.md). The compiled texts below are unchanged.

**Added 2026-10-27 (r4), not compiled here:** the proposed decision texts for findings F-01 (logo treatment C2 or C3, with exact asset hashes), F-04 (P-04a / P-04b) and F-03 (only after check A-03) are in [`F01-F04_FINDINGS_AND_PROPOSAL.md` §8](../qa/b6-stage3/F01-F04_FINDINGS_AND_PROPOSAL.md) — **PROPOSED**, none approved. The compiled texts below are unchanged.

## B6-1 — Titan amendments AMD-TITAN-01, -03, -04 and -05

Source: `docs/review/B6_TITAN_AMENDMENTS.md`, SHA-256 `6a01fb0ba89e91a9a448393eaa13eb9ea352a898856cefb8e8f88eb47951c1f8`. Status in the source: "PROPOSED wording — except AMD-TITAN-02, APPROVED". Approving these texts also authorises recording them in Doc 14 under change control (Doc 00 §5); AMD-TITAN-02 is already approved and is not repeated here.

### AMD-TITAN-01 — Shared provider as the enduring architecture (lines 23–29) — **PROPOSED**

> **AMD-TITAN-01 — Shared provider as the enduring architecture.** Doc 14 §28 and §94 (status), §108, MAIL-034; Doc 13 §129 unchanged.
>
> **§28 and §94 status (replacing "AWAITING INPUT"):** Corporate email provider and transactional email provider: Bluehost Professional Email (powered by Titan), selected by the owner as the long-term provider for all Valida company email (OD-2026-10-26-01).
>
> **§108 (replacement):** Valida uses one approved provider for human corporate mail and for automated notification mail. The two functions share the provider but stay separate in identity, credentials and purpose. Automated mail is sent only from a dedicated automated identity, by the backend Notification Service. No human correspondence is sent from that identity, and the backend never uses a human mailbox or its credential. The backend's SMTP application password is a server-side secret used only by the backend. It is never used for human mailbox access, for bounce monitoring or for backup clients. People authorised to monitor or back up the automated mailbox use their own, separately authorised access — for example webmail with multi-factor authentication, or a separately named application password for a backup client — and never share it. Shared-provider quotas, sending and bounce-rate restrictions, suspension and incidents that affect both kinds of mail are explicit operating risks. A provider change needs a demonstrated requirement the provider cannot meet and a separate owner decision.
>
> **MAIL-034 (replacement):** Human corporate email and automated transactional email are distinct identities with separate credentials and purposes. They may share one approved provider.

☐ Approve as written  ☐ Approve with these changes: ______________________  ☐ Not approved

### AMD-TITAN-03 — Authenticated SMTP over verified TLS (lines 47–55) — **PROPOSED**

> **AMD-TITAN-03 — Authenticated SMTP over verified TLS.** Doc 14 §95, §110, §135; §§152–153 and §185 applied, not weakened; MAIL-038 restated.
>
> **§95 (amended):** The transactional provider must support a custom sending identity and domain, DKIM, SPF, TLS, authenticated submission, a way to observe bounces, production-grade sending and provider security. Where the provider offers no delivery-status reporting or suppression handling — as with SMTP submission to Titan — Valida does not claim them. Delivery failures are observed through the approved manual mechanism (§117). Suppression is provided by an approved application mechanism, or by a separately approved explicit exception, before candidate acknowledgements are enabled in production (§120).
>
> **§110 and §135 (amended):** Backend business event → Notification Service → the provider's maintained submission interface (an HTTP API, or authenticated SMTP submission over implicit TLS with certificate and host-name verification, through a maintained client library) → authenticated Valida email. Provider acceptance is recorded as relay acceptance, never as delivery (§166).
>
> **§§152–153 (unchanged, applied):** The application password is used because the provider documents no stronger API or OAuth method for SMTP submission (B6 r4 provider review; to be re-checked at D3). It is dedicated to the backend, revocable, separate per environment (§185) and rotated on any suspicion of exposure.
>
> **MAIL-038 (clarification):** Transactional provider credentials remain backend-only. This does not prevent separately authorised people from accessing the automated mailbox for monitoring or backup with their own access.

☐ Approve as written  ☐ Approve with these changes: ______________________  ☐ Not approved

### AMD-TITAN-04 — Manual bounce observation (lines 57–61) — **PROPOSED**

> **AMD-TITAN-04 — Manual bounce observation.** Doc 14 §117, §118, §§166–167, MAIL-042; §§120–121 and MAIL-043 unchanged.
>
> **§117 (addition):** For SMTP submission to Titan, the equivalent operational mechanism is the manual review of the automated mailbox under the approved bounce procedure. It records: a named primary monitor (currently the owner); backup cover (to be assigned); the cadence (approved: every calendar day, including weekends and holidays); correlation by the returned Message-ID or attempt token; classification; a restricted log that holds no addresses; and escalation of repeated failures, sender-side failures and provider warnings on the same calendar day as discovery, including weekends and holidays. Absence of a bounce is not delivery confirmation. Observations do not change database state automatically. This mechanism does not by itself satisfy §§120–121 or MAIL-043.
>
> **MAIL-042 (clarification):** For SMTP submission, the backend observes relay acceptance, relay refusal and uncertain outcomes; later bounces are observed through §117. Five outcomes are kept apart: relay acceptance, confirmed delivery (known only from the recipient), later permanent bounce, temporary deferral, and unknown outcome.

☐ Approve as written  ☐ Approve with these changes: ______________________  ☐ Not approved

### AMD-TITAN-05 — Routing and configuration records; historical exception (lines 63–71) — **PROPOSED**

> **AMD-TITAN-05 — Routing and configuration records; historical exception.**
>
> **(a) `careers@` routing — an interim routing choice, not yet enduring.** `careers@<PRIMARY_DOMAIN>` forwards to the `hr@` mailbox, which holds the recruitment history; Reply-To (§203, LOCKED) is met; the internal notification goes to the configured authorised destination (§114). §§35–37 and Doc 18 §218 still require, by the Release E entry gate, either a `careers@` mailbox with controlled access and tested Send-As, or an amendment of §35. Operating note: Titan's guidance says a forwarder is removed automatically when its destination rejects mail as "Recipient Does Not Exist"; the forwarding is therefore checked as part of monitoring. (DEV-B6-05 continues.)
>
> **(b) AMD-B6-07 (configuration record, updated):** "Transactional email provider: Bluehost Professional Email (powered by Titan), authenticated SMTP submission — selected by the owner as the long-term provider (OD-2026-10-26-01)."
>
> **(c) AMD-B6-08 (variable record):** unchanged. It is the configuration record of the B6 variables; Doc 15 still has no variable list (copy design §4).
>
> **(d) DEV-B6-06 — a historical, bounded exception.** The owner-authorised verification runs of 2026-10-25 used the production sender from a development machine under the recorded controls. This covers those runs only. It is **not** a permanent permission to test with production credentials. A future live test needs separate authorisation and, where possible, a non-production identity (§186), which is **AWAITING INPUT** on Titan.

☐ Approve as written  ☐ Approve with these changes: ______________________  ☐ Not approved

## B6-3 — DEV-B6-04, with the SUP-1 amendment

Source: `docs/review/B6_DECISION_PACKAGE.md`, SHA-256 `663b11d4a2ead5b9bfef81a06d9a76861c3bcfc8975cdf3406d5d2e6728b52b0`. DEV-B6-04 proposed text, lines 155–161 — **PROPOSED**:

> **DEV-B6-04 (Phase 1 interim — PROPOSED).** Until D3, the "equivalent operational mechanism" of §117 for automated mail is this: delivery-failure reports arrive as messages in the `notifications@` Inbox and are handled under the B6 bounce procedure (`docs/operations/B6_BOUNCE_PROCEDURE_DRAFT.md`) by the owner-designated primary monitor (Saeed) with a named backup (**AWAITING INPUT** — unassigned), every calendar day, including weekends and holidays (cadence approved, OD-2026-10-26-01). Each report is matched to its Application through the Valida Message-ID of the returned original.
>
> The backend records relay acceptance only: `SENT` means "accepted by the relay", never "delivered". Per §118 it keeps no `DELIVERED` / `BOUNCED` / `DEFERRED` / `SUPPRESSED` state from bounces. It never re-sends a `SENT` channel and never automatically retries a permanent relay refusal, which meets §121 for each channel.
>
> **§120 is not met during this interim.** There is no suppression list, so a later, distinct Application using an address that has already hard-bounced, or been permanently refused, causes another acknowledgement attempt. Until suppression exists, the bounce procedure detects such repeats and escalates them on the same calendar day as discovery, including weekends and holidays, after the repeated send has occurred.
>
> **Gate G-SUP:** candidate acknowledgements remain disabled in production (`APPLICATION_ACKNOWLEDGEMENT_ENABLED=false`) until either a suppression mechanism passes its acceptance tests, or the owner records a separately approved permanent exception to §120. This must be done no later than the Release E entry gate.

SUP-1 as amended (rev 4), line 142 of the same file — **PROPOSED** (an acceptance test of the future suppression mechanism; approving it does not authorise B7):

| # | Test |
| --- | --- |
| SUP-1 | **(amended, rev 4)** After a **confirmed recipient-specific permanent invalid-address refusal** of an acknowledgement to address X — enhanced status 5.1.1, 5.1.2, 5.1.3 or 5.1.10 at `RCPT TO`, registered by the operator — a new, distinct Application with X: `201`; acknowledgement recorded `FAILED` / `RECIPIENT_SUPPRESSED` with **zero** submissions (local SMTP counter); internal notification still sent. *(rev 1–3 said "a permanent relay refusal", which would also suppress valid addresses refused for other reasons — suppression design §6.)* |

☐ Approve as written  ☐ Approve with these changes: ______________________  ☐ Not approved

## B6-2 — the rest of the bounce procedure text

The parts already approved — the mechanism, the primary monitor (Saeed), the cadence and the escalation timing — are marked as approved inside the texts and are **not** asked again. Points still open within the text, as the sources state them:

- the remaining business-day timings of the English draft: §3 "After any authorised live test — Check within 1 hour, then the next business day"; §4.7 step 4 "after 1 business day"; §5 "any `OPEN` entry older than 5 business days";
- the backup monitor (**UNASSIGNED**) and the unexpected-absence arrangement (**UNRESOLVED**, Persian procedure §9);
- the location of the restricted bounce log (**AWAITING INPUT**, English draft §4).

These open points are set out one by one, with recommended wording and whether each blocks B6 acceptance or only production, in [`B6_BOUNCE_PROCEDURE_DECISION_SHEET.md`](B6_BOUNCE_PROCEDURE_DECISION_SHEET.md) (nothing in it is approved until the owner marks it).

### English draft — `docs/operations/B6_BOUNCE_PROCEDURE_DRAFT.md`, SHA-256 `a4128833b844ee2d84b9216604417c54e9ddd6cdb0308e0525e2c8635b398239` — the complete text

````markdown
# Bounce Monitoring Procedure for Automated Email — DRAFT

| | |
| --- | --- |
| Status | **Mechanism APPROVED** by the owner on 2026-10-26 (OD-2026-10-26-01, D2: manual monitoring is the Doc 14 §117 "equivalent operational mechanism"). **Cadence APPROVED:** every calendar day, including weekends and holidays (recorded correctly in rev 5). **Escalation timing APPROVED:** the same calendar day as discovery, including weekends and holidays (OD-2026-10-26-02). **This procedure text remains a DRAFT** — PROPOSED until the owner approves it; backup coverage and the unexpected-absence procedure are UNRESOLVED ([`docs/review/B6_DECISION_PACKAGE.md`](../review/B6_DECISION_PACKAGE.md)). Short Persian owner version: [`BOUNCE_PROCEDURE_FA.md`](BOUNCE_PROCEDURE_FA.md). |
| Revision | **rev 1** (2026-10-25 evening, after GPT's review). DSNs and returned originals are treated as personal data everywhere, and HR is told only the Application reference, through a restricted channel. Repeated hard bounces are recognised and escalated (§4.5), because no suppression list exists (Doc 14 §120 is **not met**; gate G-SUP). New test T5. **rev 3 package (2026-10-25):** §2 no longer says that Doc 14 §38 forbids shared passwords; it quotes MAIL-013 and the conditional §38 exactly. **Stage 1 package (2026-10-26):** the header records the owner's D2 decision (primary monitor; backup UNASSIGNED; cadence PROPOSED) and links the Persian procedure and the suppression design ([`docs/architecture/RECIPIENT_SUPPRESSION_DESIGN.md`](../architecture/RECIPIENT_SUPPRESSION_DESIGN.md)); the body is otherwise unchanged. **rev 5 (2026-10-26):** the cadence is recorded as **APPROVED** in the header and in §3; backup coverage and the unexpected-absence procedure are **UNRESOLVED**; the body is otherwise unchanged. **rev 6 (2026-10-26):** the escalation timing is approved (OD-2026-10-26-02); "same business day" is replaced by "the same calendar day as discovery, including weekends and holidays" in §4.5, §5, T3 and T5; HR is told the Application reference through an *authorised* restricted channel (§4.4, T3). The other business-day timings (§3, §4.7, §5) are unchanged and remain part of the PROPOSED procedure text. |
| Scope | Email sent by the backend from `notifications@cybervalida.com`: `APPLICATION_RECEIVED_INTERNAL` (to `hr@`) and `APPLICATION_ACKNOWLEDGEMENT` (to candidates). Phase 1 interim, until Milestone D3. Human mail is out of scope. |
| Governing text | Doc 14 §§117–121, 166–167, 178; MAIL-042; Doc 17 §311; Doc 09 §§132–135; Doc 13 §§172, 177–178, 183 |
| Responsible person | **Saeed — owner-designated primary monitor** (APPROVED, OD-2026-10-26-01), every calendar day, 365 days a year (OD-2026-10-26-02). Access: his existing authorised Webmail access with 2FA (not inspected here); never the backend's SMTP app password. |
| Backup | **UNASSIGNED** — not assigned automatically to anyone. Planned absence: PROPOSED; unexpected absence: **UNRESOLVED** (Persian procedure §9) |
| Monitoring frequency | **APPROVED: every calendar day, including weekends and holidays** (OD-2026-10-26-01). **PROPOSED:** a review after any authorised configuration change or unusual submission activity, and the event-driven checks in §3. **APPROVED** (OD-2026-10-26-02): escalation of repeats, sender-side failures and provider warnings on the same calendar day as discovery, including weekends and holidays. Daily review cannot prevent an hourly provider restriction (suppression design §7). |

## 1. What each state means — and what is never known

| State | Where it is seen | What it establishes | What it does **not** establish |
| --- | --- | --- | --- |
| **Attempted** | Backend: the channel holds `lastErrorCode: ATTEMPT_IN_PROGRESS` (the claim) | The backend began a submission | That anything reached the relay |
| **Relay refusal** (synchronous) | Backend: `FAILED` with a code. Permanent: `INVALID_RECIPIENT`, `PROVIDER_REJECTED`, `SUPPRESSED`. Transient: `PROVIDER_UNAVAILABLE`, `RATE_LIMITED`. | The relay said no during the SMTP session. **No DSN follows.** The same channel is never retried automatically if the refusal was permanent. | That the address will be refused again. Nothing stops a **new** Application with the same address from triggering another attempt (§4.5). |
| **Relay acceptance** | Backend: `SENT` (the evidence file says `ACCEPTED_BY_RELAY`) | Titan answered `250` to the message | **Receipt.** The message can still bounce minutes or days later. |
| **Actual receipt** | **Nowhere, for the sender.** SMTP and Titan give no positive delivery signal. Only the recipient can confirm it. For internal notifications, finding the message in `hr@` is the confirmation. | — | The absence of a bounce is **not** proof of receipt: the message may sit in spam or quarantine, or be dropped silently. |
| **Later bounce — permanent** (asynchronous) | A DSN in the `notifications@` **Inbox**, for example "Undelivered Mail Returned to Sender", with a `5.x.x` status or text such as "Host or domain name not found" or "User unknown" | The receiving side refused it; it will not be delivered. The backend still shows `SENT`. | — |
| **Later bounce — delayed** | A DSN saying delivery is delayed and still being retried (`4.x.x`) | Not delivered yet; the relay keeps trying | That it will fail. Wait for a final report. |
| **Unknown** | Backend: `FAILED` with `TIMEOUT` / `OUTCOME_UNKNOWN` / `PROVIDER_ERROR` / `INTERNAL_ERROR`, or a stale `ATTEMPT_IN_PROGRESS`; the retry dry run reports these as `UNCERTAIN` | The relay **may** have accepted it | Either outcome. §4.7 says how to resolve it. |
| **Archive capture** | Not part of this procedure. Mailboxes are backed up monthly (`docs/architecture/EMAIL_BACKUP_PROPOSAL.md`); automated messages have no Sent copy yet (`docs/architecture/AUTOMATED_MESSAGE_COPY_DESIGN.md`). | — | — |

The backend never changes a `SENT` channel because of a bounce (Doc 14 §119: a bounce deletes nothing; the Application stays accepted). This procedure is the only place later bounces are handled.

## 2. Access and backup coverage

- **Primary.** The responsible person signs in to the `notifications@` mailbox (Titan webmail or a mail client) with their own authenticated access and MFA. That is **never** the backend's app password: the app password is for SMTP only.
- **Backup.** Doc 14 §206 **MAIL-013** states "Mailbox users do not share passwords." Doc 14 §38 is narrower and conditional ("Do not share a functional mailbox password between Admin users when provider delegation/shared-mailbox functionality exists"). No delegated or shared-mailbox access for Titan has been identified in the material reviewed for B6; this is **not verified** on the account. The backup person therefore does not use the primary's password.
  - Proposed, **to be verified on the account**: a server-side rule in `notifications@` that sends a copy of every incoming message to the backup's own monitored mailbox, keeping the original.
  - **The copies are personal data.** DSNs carry the full returned message, including the candidate's address. The backup's mailbox therefore holds candidate data, needs the same access restrictions, and the rule is part of the Doc 14 §150 forwarding review.
  - If Titan cannot do this, or the owner does not want candidate data copied, the fallback is **break-glass** access by the account administrator, used only when the primary is unavailable and recorded in the log.
- Nobody deletes a DSN. Handled reports move to a folder **`Bounces-Handled`** in the same mailbox. They are business email: the monthly offline backup includes `Bounces-Handled` (`docs/architecture/EMAIL_BACKUP_PROPOSAL.md` §4.2), and their retention period is still AWAITING determination (Doc 13 §187).

## 3. When to look

| Trigger | Action |
| --- | --- |
| Every calendar day, including weekends and holidays (cadence APPROVED) | Review new messages in the `notifications@` Inbox and Spam |
| Weekly | Run the repeated-refusal query of §4.5 (b) |
| After any `ops:notifications:retry -- --send` run | Check the next day for bounces of the Message-IDs that run sent |
| After any authorised live test | Check within 1 hour, then the next business day |
| The retry dry run shows `UNCERTAIN` channels | Resolve them with §4.7 before anyone uses `--include-uncertain` |
| Readiness reports provider authentication failed, or the account is locked | Escalate (§5); nothing is being sent |

## 4. Handling one delivery-failure report

### 4.1 Read the report

Note the failed recipient (from the report), the status or diagnostic text, the time, and whether it is final or delayed. **Do not copy the address anywhere** except, where unavoidable, the database lookup in §4.5.

### 4.2 Find the Valida Message-ID

Open the returned original, usually an attachment such as `ForwardedMessage.eml`. Read:

- `Message-ID: <32 hex characters>.b6@cybervalida.com>`;
- the subject: `Application received: …` is an acknowledgement; `New application: …` is an internal notification.

Do **not** rely on an envelope id (ENVID): Titan's report did not show that the DSN parameters were honoured, and it returned the **full** message (addendum §5.2).

### 4.3 Match it to the Application

The Message-ID token is **the first 32 hex characters of SHA-256 of `<EVENT>/<applicationId>`**. It is the same for every attempt of one message. This was checked on all six messages of the 2026-10-25 live runs (addendum §5.2).

1. Find the candidate Application(s) in the production database, read-only, as a Phase 1 operator task:
   - for an acknowledgement, use the recipient address from the report and the Job title (the `candidate.emailNormalized` + `jobId` index, Doc 10 §129);
   - for an internal notification, the returned original states the Application reference.
2. Confirm the match without guessing. In `backend/` on the operator machine, run:

   ```powershell
   node -e "const c=require('node:crypto');for(const e of ['APPLICATION_ACKNOWLEDGEMENT','APPLICATION_RECEIVED_INTERNAL'])console.log(e, c.createHash('sha256').update(e+'/'+process.argv[1]).digest('hex').slice(0,32))" <applicationId>
   ```

   The line whose value equals the Message-ID token identifies the Application and the event.
3. **No match → unresolved** (§4.8).

### 4.4 Classify and act

| Case | Action |
| --- | --- |
| **Acknowledgement — permanent bounce** (the candidate address does not exist or refuses mail) | Log it (§4.6) and **check for a repeat** (§4.5 a). Do **not** re-send: nothing in the backend re-sends a `SENT` channel. The Application stays valid (Doc 14 §119). Tell the recruitment decision-maker, **by Application reference only**, that the candidate cannot be reached by email at the address given. Phase 3: a `communications[]` entry with status `FAILED` (Doc 12 §§105–114). |
| **Acknowledgement — delayed** | Log it as `DELAYED`; wait for a final report. If nothing arrives within 5 days, close it as `DELAYED — NO FINAL REPORT`. |
| **Internal notification — any bounce** | **Urgent: HR may not know about an Application.** (1) Restore the recruitment mailbox (quota, account, address configuration). (2) Tell HR the **Application reference** — only that — through an authorised restricted channel: a direct message to the named HR person, or by phone. **Do not forward the DSN or the returned original.** A DSN is never treated as data-free: it carries recipient addresses and the returned message, and an acknowledgement's DSN carries the candidate's address and the full acknowledgement. (3) The backend shows `SENT` and will not retry. Escalate (§5). |
| **Policy or reputation refusal** (for example `5.7.x`, "blocked", "spam", "policy") | Escalate (§5). If acknowledgements are affected, the owner may set `APPLICATION_ACKNOWLEDGEMENT_ENABLED=false` while it is investigated; Applications are unaffected. |
| **A report about a message Valida did not send** (no `.b6@cybervalida.com` Message-ID, unknown subject) | Treat it as **backscatter or spoofing**: escalate (§5) and check the DMARC aggregate reports when they exist (D4). Do not reply. |

### 4.5 Repeated hard bounces and refusals — interim control while there is no suppression list

**Why this exists.** Doc 14 §120 says a hard-bounced or suppressed address must not be sent to "repeatedly … blindly". The backend does not re-send the **same** channel. But it has **no suppression list**, so a **new, distinct Application** using the same address triggers a new acknowledgement:

- after a **later bounce**, it is accepted and bounces again;
- after a **relay refusal**, it is attempted and probably refused again.

This control **detects such repeats after they happen and escalates them**. It does not prevent the first repeat, so §120 remains an interim deviation (DEV-B6-04, gate G-SUP).

**(a) After each acknowledgement hard bounce** — the bounced Application id is `A`. In `mongosh`, signed in as a **read-only** operator, against the production database:

```javascript
const a = db.applications.findOne({ _id: ObjectId('<A>') }, { 'candidate.emailNormalized': 1 });
db.applications.find(
  { 'candidate.emailNormalized': a.candidate.emailNormalized, _id: { $ne: a._id } },
  { _id: 1, submittedAt: 1, 'notifications.candidateAcknowledgement.status': 1, 'notifications.candidateAcknowledgement.lastErrorCode': 1 }
)
```

The query never prints the address. **It is a repeat if** any listed Application either has a `PERMANENT`-type entry in the bounce log, or shows `FAILED` with `INVALID_RECIPIENT`, `PROVIDER_REJECTED` or `SUPPRESSED`. Log it as `REPEAT` and **escalate on the same calendar day as discovery, including weekends and holidays** (§5).

**(b) Weekly — repeated synchronous refusals**, read-only:

```javascript
db.applications.aggregate([
  { $match: { 'notifications.candidateAcknowledgement.status': 'FAILED',
              'notifications.candidateAcknowledgement.lastErrorCode': { $in: ['INVALID_RECIPIENT', 'PROVIDER_REJECTED', 'SUPPRESSED'] } } },
  { $group: { _id: '$candidate.emailNormalized', applications: { $push: '$_id' }, n: { $sum: 1 } } },
  { $match: { n: { $gt: 1 } } },
  { $project: { _id: 0, n: 1, applications: 1 } }
])
```

The address is projected out. Any result is a repeat: log and escalate.

**Owner's options on escalation** (recorded in the log):

- accept the single repeat;
- pause all acknowledgements (`APPLICATION_ACKNOWLEDGEMENT_ENABLED=false`; Applications are unaffected);
- bring the suppression mechanism forward.

**Gate G-SUP.** Candidate acknowledgements stay **disabled in production** until a suppression mechanism passes its tests (decision package, SUP-1…6) or a permanent exception to §120 is approved.

### 4.6 Record it in the bounce log

The log is a restricted document. Its location is **AWAITING INPUT**; it is not in MongoDB and not in the repository.

| Field | Content |
| --- | --- |
| Received | date and time |
| Message-ID token | the 32 hex characters |
| Event | `ACKNOWLEDGEMENT` / `INTERNAL` |
| Application id | internal id (no name, **no address**) |
| Type | `PERMANENT` / `DELAYED` / `POLICY` / `REPEAT` / `UNRESOLVED` |
| Action taken | short text, no personal data |
| Handled by, closed on | initials, date |

### 4.7 Resolving an UNKNOWN backend outcome

Before anyone runs `--include-uncertain`, which can send a duplicate:

1. Compute the Message-ID token for each `UNCERTAIN` channel (§4.3).
2. For an internal notification, look for that message in `hr@`. If it is there, it was received: **do not re-send**, and log it as `RESOLVED — RECEIVED`.
3. Look for a bounce with that token in `notifications@`. If there is one, **do not re-send**; handle it under §4.4.
4. If neither has appeared after 1 business day, the owner may decide to retry with `--include-uncertain`, accepting a possible duplicate. Record the decision.

### 4.8 Unresolved cases

An entry stays `OPEN` until classified. Open entries are reviewed weekly. After 30 days, close it as `UNRESOLVED — NO FURTHER ACTION`, with the reason. Never delete it.

## 5. Escalation

Escalate to the owner on the same calendar day as discovery, including weekends and holidays, for:

- any bounced **internal** notification;
- **any `REPEAT`** (§4.5);
- a policy or reputation refusal;
- 3 or more bounces in one day, or any sudden increase;
- a report for a message Valida did not send;
- an authentication failure or account lock;
- any `OPEN` entry older than 5 business days.

The owner decides: pausing acknowledgements, a provider ticket, a credential rotation, or a security review.

## 6. Personal data

**DSNs and returned originals are personal data, without exception.** Titan returned the **full message** (text and HTML parts), with the candidate address and the Job title (addendum §5.2). Even an internal notification's DSN carries the recruitment address and the returned message.

- Keep them only in the `notifications@` mailbox (and the backup copy, §2).
- **Do not forward them** to HR or anyone else; tell people the Application reference instead (§4.4).
- Do not paste them into chat tools, tickets or review material without redaction (Doc 13 §172, Doc 14 §188).
- The bounce log and the queries in §4.5 hold or print no addresses.

## 7. What this procedure does not do

- No automated reading of bounces.
- No database status change and no `BOUNCED` state.
- **No suppression:** a repeat is detected only after it happens (§4.5); Doc 14 §120 is not met (gate G-SUP).
- No confirmation of receipt.
- No detection of spam-folder placement.

These are the limits of DEV-B6-04, to be closed by suppression (proposed for B7) or revisited at D3.

## 8. Acceptance tests

| # | Test | Status |
| --- | --- | --- |
| T1 | **Tabletop correlation.** Use the run 7fcb590e bounce (`<07bd13073d4a4cfde4a827932cdbb39d.b6@cybervalida.com>`) and the evidence JSON. Run the §4.3 command for Application `6ade2f3f61de6115a9541ca5`; the `APPLICATION_ACKNOWLEDGEMENT` line must print `07bd13073d4a4cfde4a827932cdbb39d`. (The synthetic records were deleted after the test; this checks the method, not a database lookup.) | Claude ran the computation on the attached data (Node 24): **match**. To be repeated by the named monitor. |
| T2 | **Backup coverage.** The backup handles a DSN without the primary's credential, using the §2 mechanism. | AWAITING INPUT (people; Titan rule to be verified) |
| T3 | **Escalation drill** for a bounced internal notification: HR is given the Application reference through the authorised restricted channel on the same calendar day as discovery, including weekends and holidays, and **no DSN or returned original is forwarded**. | AWAITING INPUT |
| T4 | **Live, only when authorised:** (a) an unknown mailbox at an existing domain (a `5.1.1`-type report); (b) a Microsoft/Outlook recipient (Doc 14 §132). | Not authorised now |
| T5 | **Repeat recognition** — a tabletop on a **test** database. Two synthetic Applications use the same address; the first has a logged hard bounce. When the second's bounce is handled, query §4.5 (a) lists the first Application, the monitor logs `REPEAT` and escalates on the same calendar day as discovery, including weekends and holidays. Query §4.5 (b) is also checked on two synthetic refusals. Neither query prints an address. | **Query logic checked by Claude** on synthetic records in the sandbox (MongoDB 8.0.23, Linux, using the Node.js driver with the same filters, projections and pipeline — not `mongosh` itself): (a) listed exactly the earlier Application; (b) returned the one repeated pair; neither printed an address. The drill itself is AWAITING INPUT (named monitor). |
````

☐ Approve as written  ☐ Approve with these changes: ______________________  ☐ Not approved

### Persian version — `docs/operations/BOUNCE_PROCEDURE_FA.md`, SHA-256 `589abd85acac5e9ac5e9ef5fee3d07563400d5f5e0727fe753d6662a5f397bf2` — the complete text

````markdown
# رویهٔ کوتاه بررسی ایمیل‌های برگشتی (Bounce) — notifications@cybervalida.com

| | |
| --- | --- |
| مبنا | تصمیم مالک **OD-2026-10-26-01**: سازوکار بررسی دستی **تأییدشده** است. پایشگر اصلی: **سعید** (تأییدشده). |
| وضعیت این رویه | **دورهٔ بررسی: تأییدشده** — هر روز تقویمی، ۳۶۵ روز سال، از جمله آخر هفته‌ها و تعطیلات (OD-2026-10-26-01، در بازنگری rev 5 درست ثبت شد؛ OD-2026-10-26-02). **زمان ارجاع: تأییدشده** — همان روز تقویمیِ شناسایی مشکل، شامل آخر هفته و تعطیلات (OD-2026-10-26-02). **بقیهٔ متن این رویه** — بررسی‌های اضافه، سایر قواعد ارجاع و برنامهٔ غیبت برنامه‌ریزی‌شده — هنوز **پیشنهادی (PROPOSED)** است. پایشگر پشتیبان و رویهٔ غیبت پیش‌بینی‌نشده **حل‌نشده (UNRESOLVED)** است. نسخهٔ کامل انگلیسی: `docs/operations/B6_BOUNCE_PROCEDURE_DRAFT.md`. |
| پایشگر پشتیبان | **UNASSIGNED** — هنوز کسی تعیین نشده است. |
| دسترسی | فقط با دسترسی مجاز فعلی خودتان به Webmail صندوق `notifications@`، با **2FA روشن**. این دسترسی در این جلسه بررسی نشده است (UNVERIFIED). **به رمز SMTP بک‌اند دست نزنید:** از آن استفاده نکنید، آن را تغییر ندهید و با کسی به اشتراک نگذارید. |

## ۱. چه زمانی بررسی کنیم

- **هر روز تقویمی یک بار، ۳۶۵ روز سال، از جمله آخر هفته‌ها و تعطیلات** — **تأییدشده** توسط مالک (OD-2026-10-26-01 و OD-2026-10-26-02).
- یک بررسی اضافه پس از هر تغییر پیکربندی مجاز، یا هر فعالیت غیرعادی در ثبت درخواست‌ها (پیشنهادی).
- بررسی روزانه **نمی‌تواند** جلوی محدودیت‌های ساعتی Titan را بگیرد. Titan در راهنمای خود، برای هر صندوق در ارسال به دامنه‌های دیگر، حد ۵ برگشتی در ساعت و ۱۰ برگشتی در روز ذکر می‌کند (این حد برای پلن Bluehost شما تأیید نشده است). اگر پیام‌های برگشتی پشت سر هم رسید، منتظر نوبت بعدی نمانید.

## ۲. کجا را نگاه کنیم

1. Webmail صندوق `notifications@` را باز کنید.
2. پوشه‌های **Inbox** و **Spam** را ببینید.
3. موضوع‌های رایج:
   - «Undelivered Mail Returned to Sender» — پیام برگشتی آزمایش B6 همین موضوع را داشت و از `MAILER-DAEMON@smtp-out.flockmail.com` آمده بود؛
   - «Delivery Status Notification (Failure)»؛
   - «Mail delivery failed»؛
   - «Returned mail»؛
   - پیام‌های تأخیر مانند «Delayed Mail (still being retried)».
4. **نام فرستنده به‌تنهایی اصالت پیام را ثابت نمی‌کند.** روی هیچ پیوندی کلیک نکنید و هیچ پیوستی را اجرا نکنید.

## ۳. دسته‌بندی — با احتیاط

| دسته | نشانه‌ها | اقدام |
| --- | --- | --- |
| **نشانی نامعتبر (قطعی)** | کد وضعیت `5.1.1` (صندوق وجود ندارد)، `5.1.2` (دامنه وجود ندارد)، `5.1.3` (نشانی نادرست) یا `5.1.10`؛ یا متن قطعی مانند «User unknown» یا «Host or domain name not found … Host not found» همراه با اعلام شکست **دائمی** | ثبت کنید. پس از پیاده‌سازی، با دستور سرکوب (بخش ۶) ثبتش کنید. |
| **موقت** | کدهای `4.x.x`، «delayed» یا «will retry»، صندوق پر (`5.2.2` یا `4.2.2`) | فقط ثبت کنید. سرکوب **نکنید**. منتظر گزارش نهایی بمانید. |
| **مشکل از سمت فرستنده (Valida)** | کدهای `5.7.x`، اشاره به SPF، DKIM، DMARC، «policy»، «authentication»، «rate limit»، «quota» یا «blocked»، یا هشدار Titan دربارهٔ محدودیت ارسال | **همان روز تقویمیِ شناسایی مشکل، شامل آخر هفته و تعطیلات، اطلاع دهید.** این مشکل گیرنده نیست؛ سرکوب **نکنید**. |
| **نامشخص** | هیچ‌کدام از موارد بالا نیست، کد وضعیت ندارد، یا کد با متن نمی‌خواند | ثبت با وضعیت **UNRESOLVED**. حدس نزنید. |

**یک پاسخ 5xx به‌تنهایی ثابت نمی‌کند که نشانی نامعتبر است.**

## ۴. ارتباط دادن به درخواست (Correlation)

1. پیام اصلی برگشتی را باز کنید؛ معمولاً پیوستی مانند `ForwardedMessage.eml` است. فقط آن را ببینید و اجرا نکنید.
2. سرآیند `Message-ID` آن را پیدا کنید: `<TOKEN.b6@cybervalida.com>`. TOKEN یک رشتهٔ ۳۲ نویسه‌ای هگزادسیمال است.
3. TOKEN را طبق بخش ۴ رویهٔ انگلیسی به شناسهٔ درخواست (Application reference) تبدیل کنید.
4. اگر پیدا نشد یا با چند درخواست جور درآمد، وضعیت **UNRESOLVED** است. حدس نزنید.
5. اگر پیام برگشتی مربوط به **اعلان داخلی** (به `hr@`) است، مسئله **فوری** است: مقصد استخدام پیام‌ها را دریافت نمی‌کند. همان روز تقویمیِ شناسایی مشکل، شامل آخر هفته و تعطیلات، اطلاع دهید.

## ۵. چه چیزی ثبت شود

در دفتر محدود رسیدگی ثبت کنید:

- تاریخ و ساعت؛
- شناسهٔ درخواست (Application reference)؛
- دسته؛
- کد وضعیت، اگر دیده می‌شود؛
- یک شناسهٔ مدرک مانند `BNC-2026-11-02-01` (فقط حرف و عدد، بدون `@`)؛
- اقدام بعدی.

**نشانی ایمیل متقاضی، نام او و متن پیام را ثبت نکنید.** پیام برگشتی را حذف نکنید؛ پس از رسیدگی، آن را به پوشهٔ `Bounces-Handled` همان صندوق منتقل کنید.

## ۶. دستور سرکوب در آینده (هنوز وجود ندارد)

پس از پیاده‌سازی در B7، و فقط با مجوز جداگانه:

- دستور `ops:notifications:suppression add --from-bounce` با TOKEN، کد وضعیت و شناسهٔ مدرک اجرا می‌شود.
- این دستور نشانی را از **درخواست ذخیره‌شده** پیدا می‌کند؛ نشانی هرگز تایپ نمی‌شود.
- از آن پس به این نشانی **تأییدیه** فرستاده نمی‌شود. خود درخواست‌ها و اعلان داخلی بدون تغییر ادامه می‌یابند.
- لغو سرکوب دلیل و مدرک می‌خواهد و **هیچ پیام قدیمی‌ای دوباره فرستاده نمی‌شود.**

تا آن زمان، تکرار یک نشانی نامعتبر در درخواست‌های جدید را **همان روز تقویمیِ شناسایی مشکل، شامل آخر هفته و تعطیلات،** اطلاع دهید.

## ۷. هرگز

- پیام برگشتی یا متن اصلی آن را برای کسی **Forward نکنید**؛ این پیام‌ها نشانی و دادهٔ متقاضی را دارند. به HR فقط **شناسهٔ درخواست** و یک یادداشت کوتاه، از کانال محدودِ مجاز، بدهید.
- تصویر کامل پیام برگشتی را در گفت‌وگو یا جای دیگری نگذارید.
- پیامی را **دوباره نفرستید** و ارسال دستی به متقاضی انجام ندهید.
- نشانی متقاضی را ویرایش نکنید، درخواستی را حذف نکنید و وضعیت پایگاه داده را دستی تغییر ندهید.
- پیام برگشتی را حذف نکنید، فیلترها یا قانون‌های صندوق را تغییر ندهید، 2FA را خاموش نکنید و به رمز SMTP بک‌اند دست نزنید.

## ۸. ارجاع فوری (همان روز تقویمیِ شناسایی مشکل، شامل آخر هفته و تعطیلات)

- تکرار پیام برگشتی برای یک نشانی، یا چند پیام برگشتی پشت سر هم؛
- هر خطای سمت فرستنده یا هشدار Titan؛
- هر ارسال خروجی ناشناخته؛
- پیام برگشتی اعلان داخلی.

**اقدام پیشنهادی هنگام هجوم پیام‌های برگشتی:**

- توقف موقت تأییدیه‌ها با `APPLICATION_ACKNOWLEDGEMENT_ENABLED=false` و راه‌اندازی دوبارهٔ سرویس. درخواست‌ها و اعلان‌های داخلی ادامه می‌یابند.
- این یک اقدام عملیاتی آینده است و **اکنون مجاز نیست**.

## ۹. پشتیبان و غیبت (حل‌نشده)

- **پایشگر پشتیبان: UNASSIGNED.** در صورت تعیین، او دسترسی جداگانه و مجاز خودش را دارد، آموزش کوتاه می‌بیند و همین قواعد محرمانگی را رعایت می‌کند.
- **پیش از غیبت برنامه‌ریزی‌شده (پیشنهادی):** پوشش را تأیید کنید. اگر کسی نیست، تأییدیه‌ها پیش از غیبت متوقف شوند (اقدام آینده، با مجوز).
- **پس از بازگشت:**
  - پیام‌های برگشتی را به ترتیب تاریخ بررسی کنید؛
  - هیچ تأییدیهٔ معوقه‌ای خودکار فرستاده نمی‌شود؛
  - فعال کردن دوبارهٔ تأییدیه‌ها تصمیمی جداگانه است.
- **غیبت پیش‌بینی‌نشده: حل‌نشده (UNRESOLVED).** هنوز تصمیم گرفته نشده است که اگر سعید بی‌خبر در دسترس نباشد، بررسی روزانه را چه کسی انجام دهد و آیا تأییدیه‌ها متوقف شوند یا نه. تا آن تصمیم، این رویه فقط این را می‌گوید: پس از بازگشت، فاصلهٔ بررسی‌نشده را ثبت کنید و پیام‌ها را به ترتیب تاریخ رسیدگی کنید.
````

☐ Approve as written  ☐ Approve with these changes: ______________________  ☐ Not approved

---

Decision recorded by: ______________________  Date: ____________  Decision ID: the next unused `OD-YYYY-MM-DD-NN` at the time of decision
