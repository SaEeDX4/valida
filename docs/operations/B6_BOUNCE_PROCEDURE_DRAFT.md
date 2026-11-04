# Bounce Monitoring Procedure for Automated Email — APPROVED (OD-2026-11-03-01)

| | |
| --- | --- |
| Approval | **APPROVED by the owner on 2026-11-03 ([OD-2026-11-03-01](../review/OWNER_DECISION_2026-11-03-01_B6_BOUNCE_PROCEDURE_APPROVAL.md))** — the complete text as packaged in r11 (SHA-256 `d0b472a1…1830`), including planned absence. Where the text below says DRAFT or PROPOSED, read APPROVED. Still open by design: the backup monitor (UNASSIGNED) and unexpected absence (UNRESOLVED) — production prerequisites; the log location is conditional (OneDrive Personal). The title and this row are the only changes since approval. |
| Status | **Mechanism APPROVED** by the owner on 2026-10-26 (OD-2026-10-26-01, D2: manual monitoring is the Doc 14 §117 "equivalent operational mechanism"). **Cadence APPROVED:** every calendar day, including weekends and holidays (recorded correctly in rev 5). **Escalation timing APPROVED:** the same calendar day as discovery, including weekends and holidays (OD-2026-10-26-02). **This procedure text remains a DRAFT** — PROPOSED until the owner approves it; backup coverage and the unexpected-absence procedure are UNRESOLVED ([`docs/review/B6_DECISION_PACKAGE.md`](../review/B6_DECISION_PACKAGE.md)). Short Persian owner version: [`BOUNCE_PROCEDURE_FA.md`](BOUNCE_PROCEDURE_FA.md). |
| Revision | **rev 1** (2026-10-25 evening, after GPT's review). DSNs and returned originals are treated as personal data everywhere, and HR is told only the Application reference, through a restricted channel. Repeated hard bounces are recognised and escalated (§4.5), because no suppression list exists (Doc 14 §120 is **not met**; gate G-SUP). New test T5. **rev 3 package (2026-10-25):** §2 no longer says that Doc 14 §38 forbids shared passwords; it quotes MAIL-013 and the conditional §38 exactly. **Stage 1 package (2026-10-26):** the header records the owner's D2 decision (primary monitor; backup UNASSIGNED; cadence PROPOSED) and links the Persian procedure and the suppression design ([`docs/architecture/RECIPIENT_SUPPRESSION_DESIGN.md`](../architecture/RECIPIENT_SUPPRESSION_DESIGN.md)); the body is otherwise unchanged. **rev 5 (2026-10-26):** the cadence is recorded as **APPROVED** in the header and in §3; backup coverage and the unexpected-absence procedure are **UNRESOLVED**; the body is otherwise unchanged. **rev 6 (2026-10-26):** the escalation timing is approved (OD-2026-10-26-02); "same business day" is replaced by "the same calendar day as discovery, including weekends and holidays" in §4.5, §5, T3 and T5; HR is told the Application reference through an *authorised* restricted channel (§4.4, T3). The other business-day timings (§3, §4.7, §5) are unchanged and remain part of the PROPOSED procedure text. **r10 (2026-11-03):** the approved D-2 timings written in (§3 live-test follow-up, §4.7 step 4 — 24 hours, §5 — 7 calendar days) and the conditional log location (§4.6). Still PROPOSED: the rest of the text, including planned absence (§2). **r11 (2026-11-03):** §4.7 step 4 reworded — the approved item is a 24-hour **manual review** of uncertain outcomes, not a standing permission to re-send. |
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
| After any authorised live test | Check within 1 hour, then again at the next daily review (the next calendar day) — **APPROVED** (OD-2026-11-02-03, D-2 item 1) |
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

The log is a restricted document. **Location: OneDrive Personal (free tier), CONDITIONAL** (OD-2026-11-02-03, decision 8) — "on private access, MFA, data protection and ownership requirements" (the owner's words). No entry is written there until the owner confirms that those conditions are met; no paid service is provisioned or required. It is not in MongoDB and not in the repository.

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
4. If neither has appeared 24 hours after the attempt, the owner reviews the case manually at the next daily review and records the outcome in the log (**APPROVED**, OD-2026-11-02-03, D-2 item 2: a 24-hour manual review of uncertain outcomes). **This review is not a permission to re-send.** Nothing is re-sent automatically, and `--include-uncertain` is run only on a separate, explicit owner decision for that specific case, accepting a possible duplicate, recorded in the log.

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
- any `OPEN` entry older than 7 calendar days (**APPROVED**, OD-2026-11-02-03, D-2 item 3).

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
