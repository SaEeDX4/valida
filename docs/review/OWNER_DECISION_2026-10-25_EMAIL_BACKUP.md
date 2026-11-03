# Owner Decision OD-2026-10-25-01 — Monthly Offline Email Backup (Titan retained)

| | |
| --- | --- |
| Decision ID | **OD-2026-10-25-01** |
| Date | **2026-10-25** (America/Vancouver). Recorded the same day from the owner's instruction in this working session. |
| Decided by | Saeed (owner), under Doc 00 §5 (Level 1 — explicit approved product change) and Doc 18 §364 (change control after baseline) |
| Type | **Superseding business decision.** It replaces an earlier owner request; no baselined canonical requirement is deleted (§4). |
| Status of this record | The **business direction is APPROVED** by the owner. **Everything technical below is PROPOSED** and remains subject to GPT review and owner approval: tool steps, folder scope, security tooling, devices, manifest format and the automated-message copy design. **B6 remains NOT ACCEPTED.** |
| Record revision | **rev 3** (2026-10-25). Corrections only; the approved direction (§1) and the acknowledgements (§2) are unchanged. §3: the Titan sign-in row no longer says that 2FA blocks third-party clients (R3-01); the `shervin@` row quotes the governing Doc 14 text exactly (R3-06); rows added for the local-data inventory and the cache encryption boundary (R3-03, R3-04). §5: AMD-OD-01 and AMD-OD-03 extended (no sending or source change; content completeness). §6: the G-COPY reference corrected to copy design **§6**, and G-COPY described as a proposed gate, not a B6 blocker (R3-06). |

## 1. What the owner approved

1. **Keep Bluehost Professional Email (Titan)** as the mail provider.
2. **The owner personally performs one offline backup per month.**
3. **Scope:** accessible company email, its attachments, and the required folders.
4. **Dated, independent backup sets.** Earlier sets are never overwritten.
5. **Practical integrity checks and offline recovery testing.**
6. **Appropriate encryption and access protection.**
7. **A recommended second encrypted copy**, pending confirmation of a suitable device.
8. **This simpler backup scope replaces** the owner's earlier request for a complete seven-year enterprise email archive guarantee.

## 2. What the owner acknowledged

- A monthly backup **cannot preserve messages deleted before collection**. Titan permanently deletes items in Trash and Spam 30 days after they are moved there ([Titan](https://support.titan.email/hc/en-us/articles/900005587083-What-happens-to-emails-in-Trash-and-Spam-folders)). Anything deleted permanently or purged between two monthly runs is never captured.
- This decision **does not determine legal or contractual retention duties**. It authorises **no deletion** and **does not replace production MongoDB / resume backups** (Doc 15 §§176–192; Doc 18 C6 §180).

## 3. What this decision does NOT decide (open, PROPOSED or AWAITING INPUT)

| Item | Status |
| --- | --- |
| Retention period of backup sets, and of recruitment email | **AWAITING PRIVACY / LEGAL / OPERATIONAL DETERMINATION** (Doc 13 §187; Doc 14 §176; Doc 15 §188). There is no automatic deletion and no deletion schedule. "No deletion automation yet" is **not** approval of indefinite retention. |
| Outlook Classic version, licence / activation, support status, PST functionality | **To be verified during setup** (owner-reported as available only) |
| Mailbox sizes; local capacity for monthly growth | Not measured. The reported free space (≈ 665 GB) is a starting input, not proof. |
| Access to `shervin@` | **AWAITING DECISION — unresolved.** Governing text, quoted exactly: Doc 14 §33 (a **named human mailbox**, owned by its named holder); Doc 14 §206 **MAIL-013** "Mailbox users do not share passwords."; Doc 14 §151 "Do not authorize unnecessary OAuth/mail applications to: Shervin mailbox; …". Doc 14 §38 is **conditional** and concerns **functional** mailboxes ("Do not share a functional mailbox password between Admin users when provider delegation/shared-mailbox functionality exists"); it does not settle this mailbox on its own. Options are listed, none chosen (backup proposal §4.1). |
| How Outlook signs in to Titan while 2FA stays on | **To be verified — three separate facts.** (1) *Documented capability:* Titan's Outlook guide says to set up an application password instead of the mailbox password when 2FA is on; the dedicated application-password article was found by title but its body was not retrievable or inspected; other Titan pages still say 2FA blocks third-party clients, or suggest turning 2FA off — not followed. (2) *The owner's account configuration:* unverified. (3) *A successful Outlook sign-in:* not performed. **Keep 2FA on.** Preferred: a separately named application password per mailbox for the backup client, subject to later setup authorisation; never the backend's SMTP app password. No credential is requested, generated or exposed by this record. |
| Existing local mail data on the owner's PC (other Outlook profiles, "(This computer only)" folders, attached PSTs, Outbox items) | **To be inventoried during setup**, then a coverage decision per item. Not assumed empty (backup proposal §4.2). |
| Device Encryption availability and status on the owner's PC | **To be verified** (owner-reported Windows 11 Home). If it is not on, Outlook's `.ost` cache and temporary files on C: are unencrypted even when the exported PSTs sit in a container — a **setup prerequisite gap** needing an owner decision before the first run (backup proposal §6.2). |
| Encryption tool for portable copies (and for local sets, if Device Encryption is unavailable) | **PROPOSED:** VeraCrypt (backup proposal §6). Not installed or enabled. |
| Second storage device | **AWAITING CONFIRMATION.** Not bought, configured or verified. |
| Automated-mail Sent-copy gap | **PROPOSED design** ([`AUTOMATED_MESSAGE_COPY_DESIGN.md`](../architecture/AUTOMATED_MESSAGE_COPY_DESIGN.md)); a B7 candidate needing separate authorisation |
| Bounce monitor and backup person (D2) | **Unchanged — UNASSIGNED.** Being the monthly backup operator does not make Saeed the daily bounce monitor. |

## 4. Affected requirements and tracker entries

### 4.1 Canonical requirements (baselined Documents)

| Requirement | Effect of OD-2026-10-25-01 | Proposed canonical amendment |
| --- | --- | --- |
| **Doc 14 §176** — retention aligned with the privacy / operational policy; no invented permanent retention | **Unchanged and still governing.** The backup sets have **no** approved retention period. | None. Cross-reference only (AMD-OD-01). |
| **Doc 14 §177** — understand the provider's recovery capabilities; provider retention ≠ Valida backup strategy | **Now has a Valida strategy for corporate mail:** a monthly offline backup by the owner. Titan's own copies are for its disaster recovery; Titan does not restore to an earlier state ([Titan](https://support.titan.email/hc/en-us/articles/900001330166-Are-my-mails-backed-up)). | **AMD-OD-01** (below) |
| **Doc 14 §§174–175** — mail providers in the privacy inventory; candidate mail is sensitive | Backup sets hold candidate data and the bounces (full returned messages) → they need the same access controls | **AMD-OD-02** (Doc 13 provider / data inventory entry) |
| **Doc 13 §§157–161** — backups are sensitive; restricted access; encryption; intentional retention; documented deletion limits | **Applies in full** to the email backup sets | AMD-OD-02 |
| **Doc 13 §§186–187, 190–193** — storage limitation; retention awaiting; deletion workflow; data-subject requests | **Unchanged.** The backup sets must be findable by date and mailbox so a future retention or privacy decision can be applied to them. | None |
| **Doc 15 §§176–192 and OPS-054…061**; **Doc 18 C6 §180** — production MongoDB + resume backup, restore, retention | **Unchanged and explicitly preserved.** An email backup on a laptop is **not** the production database / resume backup strategy (Doc 15 §181). | None |
| **Doc 17 §§313–318**; **Doc 18 §354** — backup ≠ restore; isolated restore tests | **Applied by analogy** to the email backup: the monthly sample recovery and an initial full recovery exercise | **AMD-OD-03** (Doc 17 test cases, PROPOSED) |
| **Doc 14 §189 / Doc 17 §312** — "Mailbox recovery" (account recovery) | **Unchanged.** This is account recovery, not message backup; still a Phase 2 item. | None |
| **Doc 06 §§160–166** — Privacy Notice | If backups are mentioned to candidates before production, the wording needs approval; no wording is proposed here | Deferred to C4 |

### 4.2 Tracker entries (B6 review documents)

| Entry | Former status | New status (PROPOSED unless stated) |
| --- | --- | --- |
| Owner request "seven-year archive of all company email" (B6 r4 review §15 and item **C6**; archive designs r4–r8; archive proposal 2026-10-25 and rev 1) | Owner request; **UNRESOLVED**; never approved, never implemented | **SUPERSEDED by OD-2026-10-25-01 (APPROVED business direction).** History preserved: [`docs/architecture/EMAIL_ARCHIVE_PROPOSAL.md`](../architecture/EMAIL_ARCHIVE_PROPOSAL.md) is kept and marked SUPERSEDED. The project documents `claude/valida-B6-final-r4…r8-archive-design.md` are left as they are; some of them are already supersession notes. |
| **EA-0** (proof of concept for an independent copy of human mail) | Proposed only; never in Doc 18; not started | **SUPERSEDED — not implemented** |
| **EA-1** (pre-send locked copy of automated mail) | Proposed only; not implemented | **Rescoped → "reliable automated-message copy preservation"** (`AUTOMATED_MESSAGE_COPY_DESIGN.md`); a B7 candidate; separate authorisation needed |
| **EA-2** (Exchange Online store retention) | Proposed only; not implemented | **SUPERSEDED — not implemented** (Titan retained) |
| **EA-3** (independent copy in production) | Proposed only; not implemented | **Rescoped → "monthly offline backup and recovery"** (`EMAIL_BACKUP_PROPOSAL.md`) |
| Archive questions Q1–Q8, O-1…O-6 | Open | **Closed as superseded**, except: the retention period (stays AWAITING, Doc 13 §187); the automated-mail question (moves to the copy design); budget (no expense is proposed) |
| **D6** (B6 decision package) | "Seven-year archive — partly decided, partly unresolved" | **"Monthly offline backup: scope APPROVED; implementation tracked"** (decision package D6) |

**Unchanged, kept independent:**

- D1 (Doc 14 deviations), D2 (bounce mechanism, people, access), D2a / G-SUP, D3 (R3), D4 (copy), D5 (manual check 5), D7 (Outlook deliverability), D8 (production credential);
- the B7 body-discard issue (OPEN);
- MongoDB / resume backup and privacy requirements;
- the real vacancy (DRAFT).

## 5. Proposed canonical amendment texts (NOT approved)

> **AMD-OD-01 — Doc 14, new §177A "Corporate mailbox backup (owner decision OD-2026-10-25-01)".** Corporate mail stays on the selected provider (Bluehost Professional Email / Titan). The owner performs one offline backup per month of the accessible mailboxes `saeed@`, `shervin@` (subject to a separately recorded decision consistent with MAIL-013 and §151), `hr@` and `notifications@`, including attachments and the required folders. Collection never sends mail and never deletes, moves, purges or imports source mail or changes server rules; multi-factor authentication stays enabled (§53). Each run is a new, dated, independent backup set that never overwrites an earlier one. Each set is integrity-checked (file hashes), encrypted at rest, held under restricted access, and recovery-tested offline (a monthly sample, and a fuller initial exercise); file integrity, mailbox completeness and successful recovery are recorded separately. A second encrypted copy on a separate, normally disconnected device is recommended. This backup **cannot** preserve messages deleted before collection, and it does not determine legal or contractual retention duties. The retention period of backup sets follows §176 and Document 13 and is not yet determined. This section does not replace the production database / resume backups of Document 15.

> **AMD-OD-02 — Doc 13 provider / data inventory (§§197–198) entry.** "Corporate email backup sets: candidate and business email, including bounce reports with full returned messages; stored on the owner's computer (encrypted volume) and, when confirmed, on one separate encrypted device; operator: the owner; retention: AWAITING determination (§187); deletion: only by an approved retention or privacy decision."

> **AMD-OD-03 — Doc 17, new test cases (Phase 2 area BACKUP / RESTORE).** QA-P2-BACKUP-001: monthly set complete for every authorised mailbox (coverage, synchronisation, export options set before completion, hashes). QA-P2-BACKUP-002: send safety and source unchanged — the backup profile's Outbox is empty before synchronisation, synchronisation is receive-only, no message is sent during the run, and no change to source mail is observed. QA-P2-RESTORE-001: an offline recovery sample from working copies in an isolated profile with the network off, including content completeness (bodies and attachments present; nothing "not downloaded"). QA-P2-RESTORE-002: the initial full recovery exercise, including a replacement-computer walkthrough. **Results are recorded, not assumed.**

## 6. Roadmap impact (Doc 18 §364)

| Item | Placement (PROPOSED) |
| --- | --- |
| Monthly backup **setup verification and the first run** | An operational task for the owner, from now on; independent of B6 acceptance. It **needs no code**, but is subject to the setup prerequisites (§3). |
| Automated-message copy (rescoped EA-1) | **A B7 candidate**, as a separately authorised change package after B6 is accepted. **Gate G-COPY** — a **proposed** production-activation gate, not an approved canonical requirement and **not a B6 acceptance blocker** — is defined in the copy design **§6** (activation rule, evidence, exception status, independence from G-SUP, proposed Doc 18 C6 placement). |
| Production MongoDB / resume backup | **C6** (Doc 18 §180), unchanged |
| Amendments AMD-OD-01…03 | To be applied to the canonical documents when approved, with this record cited |

## 7. History

This record **supersedes**, and does not delete:

- the owner's seven-year archive request;
- the archive designs of B6 r4–r8 (project documents `claude/valida-B6-final-r4…r8-archive-design.md`, left as they are; some are supersession notes already);
- `docs/architecture/EMAIL_ARCHIVE_PROPOSAL.md` (first version and rev 1; retained with a SUPERSEDED banner).

Revisions of this record: rev 2 (2026-10-25, first issue in the rev 2 package); rev 3 (2026-10-25, corrections listed in the header). The rev 2 text is preserved in the rev 2 review package.
