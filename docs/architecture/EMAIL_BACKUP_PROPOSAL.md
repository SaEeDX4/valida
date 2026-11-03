# Valida — Monthly Offline Email Backup (Titan retained)

| | |
| --- | --- |
| Basis | Owner decision **OD-2026-10-25-01** ([`docs/review/OWNER_DECISION_2026-10-25_EMAIL_BACKUP.md`](../review/OWNER_DECISION_2026-10-25_EMAIL_BACKUP.md)). The business direction is **APPROVED**. |
| Status of this document | **PROPOSED technical design.** It supersedes `EMAIL_ARCHIVE_PROPOSAL.md`, which is retained with a SUPERSEDED banner. **Nothing has been installed, enabled, configured, exported or tested on the owner's computer.** |
| Revision | **rev 3** (2026-10-25), correcting the rev 2 design after GPT review: Titan sign-in with 2FA (R3-01, §4.1); folder coverage by inspection and a no-send, no-change collection method (R3-03, §§4.2–4.3); the encryption boundary for Outlook's cache, temporary files and working copies (R3-04, §6); content completeness checked on the offline working copy (§7.2); overall result states renamed so that a missing second copy is never an overall pass (§7.1). The rev 2 text is preserved in the rev 2 review package. **Stage 1 correction (2026-10-26):** the one-time setup now verifies encryption and the protected location **before** any existing profile is inspected, any account is added or any mail is downloaded, and existing profiles are inspected only with the network disconnected (§4.3). |
| Operator | Saeed (owner), monthly. This does not assign him the daily bounce monitoring (D2). |
| Owner procedure (Persian) | [`docs/operations/EMAIL_BACKUP_MONTHLY_PROCEDURE_FA.md`](../operations/EMAIL_BACKUP_MONTHLY_PROCEDURE_FA.md) |
| Not claimed | No legal or contractual sufficiency. No promise that any authority (including IRCC) will accept a record. No completeness for messages deleted before collection. No claim that any sign-in, export or recovery has worked. |

## 0. Four kinds of statement — kept apart

| Kind | Meaning | What exists today |
| --- | --- | --- |
| **Documented capability** | What Microsoft or Titan documentation says a product can do | Cited in §11 |
| **Owner-reported** | What the owner said about his machine and accounts | §2. Not inspected. |
| **Setup verification** | What the owner observes during setup (version, sign-in, options, synchronisation, encryption status) | **None yet** |
| **Backup and restore evidence** | A completed monthly set with hashes, and a recovery test result | **None yet** |

## 1. Three separate requirements

| # | Requirement | Handled by |
| --- | --- | --- |
| 1 | **Backup of human mailboxes** | This document (monthly offline PST sets) |
| 2 | **Preservation of outgoing backend email** (Titan SMTP stored **no Sent copy**: addendum §6) | [`AUTOMATED_MESSAGE_COPY_DESIGN.md`](AUTOMATED_MESSAGE_COPY_DESIGN.md). A mailbox backup cannot recover messages that were never stored in a mailbox. |
| 3 | **Production MongoDB / resume backup** | Doc 15 §§176–192 and Doc 18 C6 §180 — **unchanged**. An email backup on a laptop is not that strategy (Doc 15 §181). |

## 2. Environment (owner-reported, 2026-10-25 — not independently inspected)

- Windows 11 Home, version 26H2, 64-bit, 32 GB RAM.
- Internal storage ≈ 954 GB, ≈ 289 GB used, **≈ 665 GB available**.
- **Outlook Classic available.** Its version, activation, support status and PST functionality are **to be verified**.
- Mailbox sizes **not measured**.
- **No separate external backup device confirmed.**

Nothing is inferred from these facts: not that Device Encryption is on, not that an external drive exists, not that Outlook is licensed or supported, and not whether the Valida mailboxes are already configured in any Outlook profile on this computer.

## 3. Tool choice: Outlook Classic (primary), Thunderbird (fallback only)

| | **Outlook Classic (selected)** | **Thunderbird (fallback)** |
| --- | --- | --- |
| Cost | Already installed (owner-reported); **no new expense** — if licensed and activated (to verify) | Free |
| Owner familiarity | Familiar | New tool to learn and maintain |
| Unit of export | **One export per mailbox**: File → Open & Export → Import/Export → Export to a file → Outlook Data File (.pst) → the account's root folder, with *Include subfolders* (the same path Titan documents) | Built-in Export = the whole profile as one ZIP of **at most 2 GB**; Titan's guide saves messages **folder by folder** as files (*Save As*) |
| Folders and attachments | All folders and their items, attachments inside the PST | Profile copy, or per-folder message files |
| Reopen locally | **Open the PST directly** (File → Open & Export → Open Outlook Data File); opening connects the file without importing it into a mailbox | Re-import the profile, or open message files one by one |
| Format | PST — proprietary; it does **not** preserve the original message bytes | Message files (RFC 5322) — closer to the raw message, but the export is more manual |
| Known limits | The PST size limit (50 GB by default in Outlook 2010–2016; to be confirmed for the installed version); an IMAP cache file (`.ost`) is **not** a backup | 2 GB profile-export limit; mbox / eml bulk export needs third-party add-ons |

**Identifying Classic Outlook.** By product information, never by the icon or appearance: File → Office Account (or Account, or Help) → Product Information → About Outlook, recording product, version, build, bitness and activation. Microsoft's version guidance identifies New Outlook by its Settings gear. This workflow starts from Classic Outlook's File tab; if the client offers no such path, or the product information does not show classic desktop Outlook, the workflow does not apply and the owner stops.

**Why Outlook Classic for this owner:**

- It is already available and familiar.
- It needs one export per mailbox, covering all folders and attachments.
- The resulting PST can be reopened locally without Titan.

**Switch to Thunderbird only if** a specific Outlook prerequisite fails, and record which one:

- Outlook is not licensed or activated, or runs in reduced functionality;
- it is an unsupported version the owner does not accept — Office 2016 / 2019 support **ended on 14 October 2025**;
- PST export is unavailable or fails repeatedly;
- full message download for IMAP cannot be verified.

**Thunderbird is not a workaround for sign-in.** If Titan refuses a client's IMAP sign-in (for example, an authentication restriction on the account), Thunderbird meets the same provider-side restriction. A sign-in failure is escalated (§4.1), not routed to Thunderbird.

No paid licence is introduced, and the owner never runs both tools.

**New Outlook** is not the selected workflow. Its features are not substituted for these Classic steps. This document makes no claim about what New Outlook can or cannot do.

## 4. Mailboxes, access and folders

### 4.1 Setup inventory — done once, during setup, by the owner; **no credential is requested, generated or used by Claude**

| Mailbox | Authorised access | Client account | Folders discovered | Size measured | Synchronisation settings checked |
| --- | --- | --- | --- | --- | --- |
| `saeed@cybervalida.com` | Owner (own mailbox) — to confirm | IMAP account in a dedicated Outlook Classic profile (`imap.titan.email:993`, SSL/TLS) | to record | to record | to record |
| `shervin@cybervalida.com` | **AWAITING DECISION — unresolved.** Not assumed. Governing text: Doc 14 §33 (a **named human mailbox**, owned by its named holder); Doc 14 §206 **MAIL-013** "Mailbox users do not share passwords."; Doc 14 §151 "Do not authorize unnecessary OAuth/mail applications to: Shervin mailbox; …". Doc 14 §38 is **conditional** and concerns **functional** mailboxes: "Do not share a functional mailbox password between Admin users when provider delegation/shared-mailbox functionality exists." It does not on its own settle this mailbox. Options for the decision (none chosen): **(a)** Shervin runs the same export for his own mailbox and hands over an encrypted PST with its hash; **(b)** a separately approved arrangement — whether an application password created by Shervin for a backup client on another person's computer is compatible with MAIL-013 and §151 is part of that decision; **(c)** excluded, with the reason recorded (the set is then **INCOMPLETE**). | — | — | — | — |
| `hr@cybervalida.com` | Owner — to confirm | IMAP | to record | to record | to record |
| `notifications@cybervalida.com` | Owner — to confirm. **A separately named application password, never the backend's SMTP app password** (§4.1 sign-in) | IMAP | to record | to record | to record |
| `careers@cybervalida.com` | Recorded as **forwarding to `hr@`** — not a mailbox, **not counted**, unless evidence shows otherwise | — | — | — | — |

**Sign-in with 2FA kept on — three separate things:**

| | Status (2026-10-25) |
| --- | --- |
| **Documented provider capability** | Titan's Outlook configuration guide states: "If Two-Factor authentication is turned on… setup an application password instead of your normal mailbox password." Titan's IMAP/POP guide refers to application passwords in the same way. An article titled "Application Password in Titan for Third-Party Clients" exists (its title was found by search), but **its body could not be retrieved in this session and was not inspected.** Other Titan pages remain inconsistent: the 2FA settings page still says that access "via 3rd party clients like Gmail or Outlook will be blocked when Two-Factor Authentication is enabled", and the IMAP/POP page's troubleshooting suggests turning 2FA off. **That advice is not followed.** |
| **The owner's account configuration** | **Unverified.** Whether 2FA is on for each mailbox, whether application passwords can be created there, and whether the mailbox's third-party-application access setting (named "Enable Titan on other apps" in the B6 README for `notifications@`) is on, are not known for these mailboxes. |
| **A successful Outlook sign-in with 2FA on** | **Not performed.** |

**Proposed sign-in method (subject to separate setup authorisation; nothing is created now):**

- **Keep 2FA on.**
- For each authorised mailbox, create a **separately named application password** for the backup client only (for example "Outlook backup – <machine label>"), so it can be revoked without affecting anything else.
- **Never reuse the backend's SMTP application password** of `notifications@` in Outlook, and do not change or revoke it as part of backup setup.
- The password is entered only into Outlook's sign-in dialog; it is never written in commands, files, checklists, manifests, screenshots or chat.
- If a mailbox's third-party-application access must be switched on, that is an **account configuration change**: recorded and authorised before it is made.
- Titan's Outlook guide also asks to tick "Require logon using Secure Password Authentication (SPA)". The settings that actually work are **to be verified and recorded**, not assumed.
- If Outlook cannot sign in with 2FA on and an application password: **stop and escalate.** Turning 2FA off is a security decision outside this procedure.

### 4.2 Folder coverage — decided by inspection and recording (PROPOSED)

Coverage is not decided by folder name. During setup, and whenever a new folder appears, every folder is inspected and placed in one category, with the reason recorded:

| Category | Examples | Coverage |
| --- | --- | --- |
| **Server folders** | Inbox, Sent, Drafts, Archive, Spam, Trash, custom folders (including `Bounces-Handled` in `notifications@`) | **Required.** Drafts are preserved as **unsent** drafts; nothing is sent or moved. Trash and Spam hold items for at most 30 days (§4.4). |
| `Scheduled` (webmail) | Messages scheduled to be sent by Titan | **Required if exposed over IMAP**; otherwise "not visible over IMAP" is recorded. Titan sends them at the scheduled time regardless of the backup; the backup never touches them. |
| **Virtual or search views** | Starred / flagged views in webmail; Outlook Search Folders | **Excluded after inspection** — recorded as a view with no independent items. |
| **Local folders or data files with possibly unique messages** | Outlook folders labelled "(This computer only)" (third-party source, not Microsoft documentation: they are not on the server); a PST attached to a profile; local Drafts or Outbox items; data on other devices using POP or local storage | **Inventoried, not assumed empty.** Microsoft states that in Outlook 2016 and later IMAP accounts use an offline data file (`.ost`) and that "any items that are saved locally should be backed up". In the dedicated backup profile these folders should be empty (counts recorded; non-empty ⇒ stop and decide). In **existing** profiles on the computer, each data file and local folder with items gets an owner decision: covered (for example, a copy of the PST file taken with Outlook closed, with its hash) or excluded with a reason. Until decided, the set is not COMPLETE. |
| **Diagnostic folders** | `Sync Issues` and its subfolders (`Conflicts`, `Local Failures`, `Server Failures`) | Read for troubleshooting; counts recorded. Whatever the root export includes is recorded as included. |
| **Folders the client created on the server** | e.g. `Junk Email` or `Deleted Items` created by Outlook when the account was added | Recorded; **never deleted**. |
| **Pending unsent messages** | Outbox | Must be **zero** before any synchronisation (§4.3). A non-empty Outbox stops the run. |

### 4.3 Collection without sending or changing the source

**IMAP synchronisation is not inherently read-only.** A client can propagate read-state and flag changes, deletions, moves, purges and folder creation to the server, and a client with an SMTP account can send queued mail. The collection method below is designed to avoid all of these. It is **version-dependent and not proven sufficient until verified and recorded** on the installed Outlook.

**One-time setup (owner):**

0. **Encryption and the protected location first** (§6.1, §6.2; Persian procedure الف-۳, الف-۴). Verify Device Encryption's actual status — or record the cache / temporary-file gap and the owner's decision on it — and set up the protected location **before** inspecting any existing profile, adding any account or downloading any mail. Adding an account starts downloading at once into the `.ost` cache on C:.
1. **Inventory existing mail data, with the network disconnected** (§4.2; Persian procedure الف-۵). Disconnect the network **before** opening any existing profile, so Outlook can neither send a queued message nor synchronise; reconnect only after Outlook is fully closed. Inventory profiles, data files, local folders and Outbox contents in any existing profile that holds a Valida mailbox. If an existing profile's Outbox holds a queued message, that profile is not brought online; nothing is sent, deleted or moved; the item is recorded and escalated.
2. **A dedicated profile, `Valida-Backup`,** used for nothing else. No message is ever composed in it. Accounts are added as IMAP (`imap.titan.email:993`, SSL/TLS; the SMTP fields are filled because the account form requires them).
3. **No test send.** Some Outlook account dialogs offer *Test Account Settings* or *Automatically test account settings when Next is clicked*. Several provider guides describe that test as sending a test message; **no Microsoft source confirming or denying this was found in this session.** The button is not used and the automatic test is unticked where shown. If a test message is sent anyway, it is recorded and not deleted.
4. **Send-prevention and no-change settings** in that profile, each recorded (or "not offered" in this version):

   | Setting | Path (Outlook classic) | Value | Source |
   | --- | --- | --- | --- |
   | Send immediately when connected | File → Options → Advanced → Send and receive | **Off** — Outbox items then wait for a manual send/receive | Microsoft (Outlook 2010 and later) |
   | Send/Receive group, per account | Send / Receive → Send/Receive Groups → Define → Edit | **"Send mail items" off**, "Receive mail items" on, "Download complete item including attachments", all folders | Microsoft (groups can set "whether mail should be sent or received or both from an account"; option names from the Office Customization Tool help) |
   | Automatic send/receive | Same dialog | Scheduled and on-exit send/receive **off** | Microsoft (scheduled option) |
   | Read receipts | File → Options → Mail → Tracking | **Never send** | — (to verify in the installed version) |
   | Reading Pane | View → Reading Pane → Off | **Off**, so selecting an item does not mark it read | — (to verify) |
   | Client rules | File → Manage Rules & Alerts | **None** | — |
   | AutoArchive / Clean Up | File → Options → Advanced → AutoArchive Settings | **Not applied** to these accounts | — |
   | IMAP purge options, if shown | Account settings → More Settings | **No automatic purge**; value recorded | — (to verify) |
   | Client-side junk filtering, if active for these accounts | Home → Junk → Junk E-mail Options | **No Automatic Filtering** | — (to verify) |

   **Server-side rules and filters (Titan webmail) are not changed**; their existence is only recorded if visible.

**Every month, in this order:**

1. **Send-safety preflight with the network off.** Disconnect the network, start Outlook in `Valida-Backup`, confirm every Outbox holds **0** items (without opening anything) and that the send settings are unchanged. **If anything is queued: stop.** Nothing is sent, deleted or moved; Outlook is closed before the network is reconnected; the run is recorded as NOT RUN and escalated.
2. **Receive-only synchronisation.** Reconnect the network, bring Outlook online if it was left in Work Offline, and run **only the receive-only group**. Read any errors and *Sync Issues* entries. Compare the folder list with webmail; subscribe and classify new folders. Subscribing changes the account's IMAP subscription list — server metadata, not messages; it is recorded.
3. **No live message is opened or previewed.** Opening an item can mark it read on the server. Item counts per folder are recorded from folder properties (and webmail, where shown) as **supporting** evidence only.
4. **Work Offline**, then export (§5, §7).
5. **Body and attachment completeness is verified on the exported working copy, offline** (§7.2), not by opening live messages: an item that shows only headers or "not downloaded" in the working copy makes that mailbox's content **INCOMPLETE**.
6. **Source check after the run:** in webmail, looking at folder lists only, confirm that no message was sent during the run window and record any folder or change the client introduced. Nothing is deleted or reverted to "fix" it.

**No cleanup, deletion, move, purge or import** is part of this procedure at any point.

### 4.4 The Titan gap

- Items in **Trash and Spam are deleted permanently 30 days** after they are moved there, and **cannot be recovered**.
- Titan "maintains multiple copies … across multiple regions" for its own disaster recovery but **does not restore to an earlier state** for customers.

**Consequences for a monthly backup** (accepted by the owner):

- anything purged, emptied or shift-deleted between two runs is lost;
- anything that spends more than 30 days in Trash or Spam between two runs is lost;
- edits made between runs are captured only in their state at export time.

Keep the interval between runs **at most about 30 days**; this reduces the Trash / Spam loss but does not remove it.

**The backup never empties folders, changes server cleanup rules or removes messages.**

## 5. Backup sets

### 5.1 Structure (PROPOSED)

```
<protected location>\Valida_Email_Backups\
    2026-11-01_1930\                          ← YYYY-MM-DD_HHMM local time (America/Vancouver); add -2, -3 … if a name exists
        saeed@cybervalida.com.pst
        hr@cybervalida.com.pst
        notifications@cybervalida.com.pst
        shervin@cybervalida.com.pst           ← only if authorised (§4.1)
        manifest.json                         ← §8; no passwords, keys or message content
        checklist.md                          ← the one-page checklist, filled in
        SHA256SUMS.csv                        ← Get-FileHash output (hash, path) for the PST files
```

- **Each run is a new folder. Never append to an old PST and never build an incremental chain.** Full monthly snapshots, initially.
- **The export options are set before the wizard is finished:** the account root, *Include subfolders*, no filter, and a new file name inside the new run folder. The owner never needs to reopen a completed export to set an essential option (Persian procedure, step 5).
- **The protected location is not Outlook's default path**: Microsoft states that PSTs are typically saved in `Documents\Outlook Files`, and `Documents` may be synchronised by OneDrive. It must be **outside OneDrive and any cloud-sync folder**, on an encrypted volume (§6), with restricted access.

### 5.2 What a PST is and is not

- A PST holds the folders, messages and attachments as Outlook stores them.
- It is **not** a byte-identical archive of the raw SMTP messages.
- It does **not** preserve every account setting, rule, server flag or folder property.
- An **OST / IMAP cache file is not the deliverable backup.** Microsoft states that an `.ost` cannot be imported from.
- A **PST password is not an encryption control** (§6). No PST password is proposed: it adds a secret to manage while protecting little.

### 5.3 Capacity (planning only — measure first, buy nothing, delete nothing)

Let **S** be the total size of the PSTs in one set (unknown until the first run), and **M** the size of the downloaded IMAP cache (roughly the mailboxes' size). After **N** months the local space needed is about:

**N × S** (sets) + **S** (temporary recovery working copies) + **M** (Outlook cache on C:) + any **pre-allocated encrypted container**.

*Example only:* if S were 5 GB, then 12 months ≈ 60 + 5 + 5 ≈ 70 GB, out of the ≈ 665 GB reported free.

**Capacity review** (proposed rule): after each run, compute *months remaining* = (free space − a reserve the owner chooses) ÷ latest S. If it is under 12, the owner reviews: more storage (**an expense — escalate first**), or a **retention decision** (AWAITING; Doc 13 §187).

**Nothing is deleted automatically.** "Not deleted yet" is not an approved retention period.

## 6. Security (Windows 11 Home — capability-based)

### 6.1 Encryption status — checked, not assumed

| Check | How | Record |
| --- | --- | --- |
| Device Encryption offered and **On** | Settings → Privacy & security → Device encryption | Shown? On / Off |
| Device support | System Information, run as administrator → "Automatic Device Encryption Support" or "Device Encryption Support" ("Meets prerequisites" means available) | The value |
| Account type | Microsoft account or local account. Microsoft: with a local account, "Device Encryption isn't turned on automatically" | The type |
| What it covers | Microsoft: Device Encryption "enables BitLocker encryption automatically for the Operating System drive and fixed drives". Per-volume status if the system shows it; otherwise **NOT VERIFIED** | Volumes |
| No full BitLocker management | Microsoft: BitLocker Drive Encryption "isn't available on Windows Home edition". The design does not rely on it. | — |
| Recovery key | Listed in the owner's Microsoft account (`aka.ms/myrecoverykey`); a separate offline copy (a printout in a safe place). Microsoft **cannot** recreate a lost key. **Never** inside a backup set. | Listed: yes / no |

### 6.2 Protection matrix — what holds Valida mail on this computer, and what protects it

| Data | Where | If Device Encryption protects C: | If it does not |
| --- | --- | --- | --- |
| Exported PSTs, `manifest.json`, checklist, `SHA256SUMS.csv` | The run folder in the protected location | Protected at rest | Protected **only if** written directly into a mounted VeraCrypt container |
| **Outlook's offline cache (`.ost`) of the `Valida-Backup` profile** — close to a full copy of every mailbox | `drive:\Users\<user>\AppData\Local\Microsoft\Outlook` (Microsoft's documented location) | Protected at rest | **Not protected — a gap.** A container around the final PSTs does not cover it. |
| Temporary files and attachments opened or previewed | Outlook's secure temporary folder under the user profile on C: (documented for Outlook 2003–2010; location in the installed version to be identified). Microsoft notes attachments can remain there when Outlook exits while they are open. | Protected at rest | **Not protected — a gap** |
| Recovery working copies | `_recovery_…` inside the protected location | Protected at rest | Inside the container only |
| `.ost` files and local folders of **other** profiles holding Valida mail (§4.2) | C: | Protected at rest | **Not protected — a gap** |
| Second copy | The second device | **Not** protected by C:'s encryption once copied; needs its own encryption (**PROPOSED:** a VeraCrypt file container) | Same |
| Device Encryption recovery key; container passphrase | Separately from the computer and the sets | Stored separately and securely | Same |

**Consequences:**

- **A container around the final PST is not proof that all local email data is encrypted.** If Device Encryption is not available or not on, the `.ost` cache and temporary files are unencrypted at rest. That is recorded as a **setup prerequisite gap** with an owner decision **before any account is added or any mail is downloaded**; until then, encryption is NOT VERIFIED and every set is INCOMPLETE. Moving the cache into an encrypted container may be possible but is **not proposed** without separate verification.
- **A PST password is not adequate** and is not counted as a control.
- **Ordinary deletion on an SSD is not secure erasure.** Plaintext copies are therefore created only inside encrypted volumes.

### 6.3 Other controls

| Control | Proposed approach | To verify during setup |
| --- | --- | --- |
| **If Device Encryption is unavailable or off** | Keep the sets inside an encrypted **VeraCrypt file container** on the internal drive, and export **directly into the mounted container** so no plaintext PST lands on an unencrypted disk. The `.ost` / temporary-file gap of §6.2 remains and needs its own decision. | Owner approval to install (it needs administrator rights for its driver) |
| **Recovery material** | VeraCrypt passphrase stored separately and securely. **Assumed** (the official FAQ was not retrievable): there is no password recovery — a lost passphrase means lost backups. Never inside a backup set. | Confirm the assumption from VeraCrypt documentation before relying on it |
| **Access to the local location** | Folder permissions limited to the owner's account, SYSTEM and Administrators (no Users / Everyone). This protects against other local accounts, **not** against malware running as the owner. | Permissions recorded |
| **Portable (second) copy** | **Separate encryption is required.** **PROPOSED: a VeraCrypt file container on the second device.** Copy from the **original** set with Outlook closed → verify hashes inside → dismount → disconnect. The device stays normally disconnected and is stored apart from the computer. | **AWAITING CONFIRMATION** of a suitable device. Not bought, configured or verified. |
| **Secrets** | No password, passphrase or recovery key in commands, scripts, logs, manifests, checklists, source control, screenshots or chat. | — |

**Why VeraCrypt** is proposed as the single no-subscription option, where Windows protection is insufficient:

- free, open-source software;
- a **file container** is one ordinary file that hides the names and contents of everything inside;
- it works for both the internal drive and the second device;
- exporting directly into the mounted volume avoids temporary plaintext **for the exported files** (not for the cache, §6.2).

**Limits:**

- administrator rights are needed once, to install;
- the container size must be planned in advance (§5.3);
- a lost passphrase is assumed to be unrecoverable;
- it must be dismounted before the container file is copied or hashed;
- the replacement computer also needs VeraCrypt.

**Nothing is installed or enabled by this document.**

## 7. Verification and offline recovery

### 7.1 Result fields and states (recorded separately, per mailbox where relevant)

| Field | States |
| --- | --- |
| Mailbox / folder coverage | PASS · INCOMPLETE (a folder missing or unauthorised, or local data without a coverage decision) · NOT VERIFIED |
| Send safety and source unchanged | PASS (Outbox empty before synchronisation; nothing sent; no change observed) · FAILED · NOT VERIFIED |
| Synchronisation | PASS (no unresolved errors; folders match) · INCOMPLETE · FAILED |
| Export completion (all options set before Finish) | PASS · FAILED · NOT RUN |
| File integrity | PASS (hashes recorded, and copies match) · FAILED (mismatch) · PENDING MANUAL CHECK |
| Content completeness (working copy) | PASS (sampled items have bodies and attachments; none "not downloaded") · INCOMPLETE · NOT VERIFIED |
| Offline recovery | PASS (sample) · FAILED · NOT VERIFIED |
| Encryption — exported files | PASS (verified protected volume or container) · NOT VERIFIED · FAILED |
| Encryption — cache and temporary files | PASS (Device Encryption verified on C:) · GAP RECORDED · NOT VERIFIED |
| Second copy | VERIFIED · AWAITING CONFIRMATION (no device) · PENDING · FAILED |

**Overall state:**

| Overall | When |
| --- | --- |
| **COMPLETE** | Every field PASS / VERIFIED for every expected mailbox, **including the second copy** |
| **PRIMARY COMPLETE — SECOND COPY NOT MADE** | Everything PASS except the second copy, which is AWAITING CONFIRMATION or PENDING. **This is not an overall pass**; the missing second copy stays visible in every report. |
| **INCOMPLETE** | Any expected mailbox not exported (including `shervin@` without a decision), any required folder not covered, local data without a coverage decision, synchronisation or content incomplete, encryption not verified or a recorded gap, or the run stopped at the preflight (NOT RUN) |
| **FAILED** | Any export, integrity or recovery failure, or a send / source change caused by the run |

**An incomplete account never yields an unconditional SUCCESS.**

**Three different properties:** hashes establish **file integrity**; they do not establish **mailbox completeness**; neither establishes that a **restore** works. Counts are supporting evidence. **A sample is not proof of every message.**

### 7.2 Offline recovery (requirements; the owner's steps are in the Persian procedure)

1. **The original set is never opened.** With Outlook closed, copy the PSTs to an **isolated recovery folder** inside the encrypted area (not inside the run folder). Confirm each copy's SHA-256 equals the manifest **before** opening it.
2. **Disconnect the network** (Wi-Fi off / airplane mode, cable unplugged).
3. Use a **separate Outlook profile for recovery** with no mail account. If the installed version requires an account, use `Valida-Backup` in *Work Offline*, with the network off — and record that substitution.
4. **Open the PST copies locally** (File → Open & Export → Open Outlook Data File). **Never import them into a live Titan mailbox** and never drag items into live folders: Titan's own restore guide moves the contents into the live account, which is **not** what a recovery test does.
5. Inspect:
   - every required folder;
   - the oldest and newest messages, with full bodies;
   - one attachment of each common type (opened in preview, nothing executed);
   - **content completeness:** no sampled item shows only headers or a "not downloaded" notice — otherwise that mailbox's content is INCOMPLETE and is collected again into a new run folder;
   - an **offline search** for a known subject, after local indexing has finished.
6. Close the PST, close Outlook completely, then remove the working copies (only inside the recovery folder, never in a run folder). Record the results, including any temporary attachment files left on an unencrypted C: (§6.2).
7. **Opening a PST can change the working file.** A changed working copy is **never** evidence that the archived original is corrupt. Only the originals' hashes are compared against the manifest, and **Outlook is closed before any final hashing or copying**.

**Monthly sample:** step 5 for each mailbox, on a few folders and messages. **Initial full exercise** (first run, then once a year — proposed):

- every folder of every mailbox;
- counts compared with the synchronisation record;
- several attachment types;
- the second copy opened from a working copy taken from its device;
- a **replacement-computer walkthrough**: a Windows PC with a compatible, **legitimately licensed** PST reader (Classic Outlook) and, for containers, VeraCrypt.

A future Outlook licence is **not guaranteed**. If none is available when needed, a compatible reader must be found at that time — an open risk that is recorded here.

## 8. Manifest specification (real manifests stay private)

The manifest is `manifest.json` in each run folder. It holds **no passwords, keys, recovery keys, message bodies, subjects or candidate data**.

| Field | Content |
| --- | --- |
| `schema` | `"valida-email-backup-manifest/2"` (rev 3; `/1` was the rev 2 draft, never used) |
| `backupId` | the run folder name, `YYYY-MM-DD_HHMM[-n]` |
| `timezone`, `startedAt`, `finishedAt` | `"America/Vancouver"`, ISO 8601 with offset |
| `operatorRole` | `"owner"` |
| `tool` | `{ name, version, build, bitness, licenceStatus: VERIFIED / NOT VERIFIED, profile }` |
| `machine` | `{ label, os }` — a label chosen by the owner, not a serial number |
| `expectedMailboxes` | the list in §4.1, each with `authorization`: AUTHORIZED / AWAITING DECISION / EXCLUDED (reason) |
| `localDataInventory[]` | `{ item, location, itemsPresent, decision: COVERED / EXCLUDED / AWAITING DECISION, reason }` — §4.2; no message content |
| `sendSafety` | `{ outboxEmptyBeforeSync, sendSettingsVerified, receiveOnlyGroupUsed, sentDuringRun: NONE / RECORDED, sourceChangesObserved[] }` |
| `mailboxes[]` | `{ address, accountType, syncStatus, syncNotes, folders[] { path, category, required, outlookCount, webmailCount\|null, status }, exclusions[] { path, reason }, pst { file, sizeBytes, sha256, accountRootSelected, includeSubfolders, filterApplied, newFileInNewRunFolder, pstPassword: "NONE" }, contentCompleteness, coverageStatus, exportStatus }` |
| `integrity` | `{ method: "SHA-256 (Get-FileHash)", outlookClosedBeforeHashing, status }` |
| `recovery` | `{ kind: MONTHLY_SAMPLE / INITIAL_FULL, network: DISCONNECTED, profile, workingCopiesHashMatched, checks[], status }` |
| `encryption` | `{ exportedFiles: { method: DEVICE_ENCRYPTION / VERACRYPT_CONTAINER / NONE, status }, cacheAndTemp: { status: PASS / GAP_RECORDED / NOT_VERIFIED }, recoveryKeySeparatelyStored: CONFIRMED / NOT CONFIRMED }` (never the key) |
| `secondCopy` | `{ status, deviceLabel\|null, method\|null, hashesVerified\|null }` |
| `overall` | COMPLETE / PRIMARY_COMPLETE_SECOND_COPY_NOT_MADE / INCOMPLETE / FAILED |
| `notes` | free text, no secrets or candidate data |

**Synthetic example** — every value is invented; the addresses use `.invalid`:

```json
{
  "schema": "valida-email-backup-manifest/2",
  "backupId": "2099-01-01_0900",
  "timezone": "America/Vancouver",
  "startedAt": "2099-01-01T09:00:00-08:00",
  "finishedAt": "2099-01-01T10:10:00-08:00",
  "operatorRole": "owner",
  "tool": { "name": "Outlook (classic)", "version": "EXAMPLE", "build": "EXAMPLE", "bitness": "64-bit", "licenceStatus": "NOT VERIFIED", "profile": "Valida-Backup" },
  "machine": { "label": "EXAMPLE-PC", "os": "Windows 11 Home (owner-reported)" },
  "expectedMailboxes": [
    { "address": "mailbox-a@example.invalid", "authorization": "AUTHORIZED" },
    { "address": "mailbox-b@example.invalid", "authorization": "AWAITING DECISION" }
  ],
  "localDataInventory": [
    { "item": "EXAMPLE existing profile data file", "location": "EXAMPLE", "itemsPresent": false, "decision": "EXCLUDED", "reason": "EXAMPLE: no items" }
  ],
  "sendSafety": { "outboxEmptyBeforeSync": true, "sendSettingsVerified": true, "receiveOnlyGroupUsed": true, "sentDuringRun": "NONE", "sourceChangesObserved": [] },
  "mailboxes": [
    {
      "address": "mailbox-a@example.invalid",
      "accountType": "IMAP",
      "syncStatus": "PASS",
      "syncNotes": "",
      "folders": [
        { "path": "Inbox", "category": "SERVER", "required": true, "outlookCount": 0, "webmailCount": null, "status": "PASS" },
        { "path": "Sent", "category": "SERVER", "required": true, "outlookCount": 0, "webmailCount": null, "status": "PASS" }
      ],
      "exclusions": [ { "path": "Starred", "reason": "virtual view, inspected" } ],
      "pst": { "file": "mailbox-a@example.invalid.pst", "sizeBytes": 0, "sha256": "0000000000000000000000000000000000000000000000000000000000000000", "accountRootSelected": true, "includeSubfolders": true, "filterApplied": false, "newFileInNewRunFolder": true, "pstPassword": "NONE" },
      "contentCompleteness": "PASS",
      "coverageStatus": "PASS",
      "exportStatus": "PASS"
    }
  ],
  "integrity": { "method": "SHA-256 (Get-FileHash)", "outlookClosedBeforeHashing": true, "status": "PASS" },
  "recovery": { "kind": "MONTHLY_SAMPLE", "network": "DISCONNECTED", "profile": "Valida-Recovery", "workingCopiesHashMatched": true, "checks": ["EXAMPLE"], "status": "PASS" },
  "encryption": { "exportedFiles": { "method": "DEVICE_ENCRYPTION", "status": "NOT VERIFIED" }, "cacheAndTemp": { "status": "NOT_VERIFIED" }, "recoveryKeySeparatelyStored": "NOT CONFIRMED" },
  "secondCopy": { "status": "AWAITING CONFIRMATION", "deviceLabel": null, "method": null, "hashesVerified": null },
  "overall": "INCOMPLETE",
  "notes": "Synthetic example. INCOMPLETE because mailbox-b is awaiting a decision and encryption is not verified; the second copy is also not made."
}
```

**A possible future helper — specified only; no code is delivered:**

- **Inputs:** a run folder path, the expected-mailbox list and a manifest draft.
- **Outputs:**
  - `SHA256SUMS.csv`;
  - a validation report listing missing, extra or zero-size PSTs, hash mismatches between the set and a copy, and manifest fields that are missing or contradictory (for example `overall: COMPLETE` with an INCOMPLETE mailbox, or with `secondCopy` not VERIFIED).
- **Failure handling:** refuse while any PST is open or locked. **Never** modify, move or delete files. No network. No secrets read or written. Report, never "fix".

## 9. Setup prerequisites and no-go conditions

**Stop and escalate** (do not proceed with a run) if:

- Outlook Classic is not licensed or activated, or cannot export PST;
- connecting requires disabling 2FA, or sign-in fails with 2FA on and an application password;
- any Outbox in the backup profile holds a queued message, or any step would send a message;
- full message download cannot be verified;
- no encrypted location for the exported files can be established;
- the destination is inside a cloud-sync folder;
- any step would delete, empty, purge, move or import server mail, or change server rules.

**Open prerequisites:**

- Outlook version, licence and support status;
- the sign-in method with 2FA on, per mailbox (application passwords; third-party-application access setting);
- the inventory of existing local mail data and a coverage decision for each item;
- the send-prevention settings, as available in the installed version;
- mailbox sizes;
- Device Encryption status, the account type, and the recovery key location;
- the `.ost` / temporary-file encryption gap, if Device Encryption is not on;
- whether VeraCrypt is needed and its installation is approved;
- `shervin@` access;
- the second device;
- the retention period (AWAITING).

## 10. What this backup does not do

- It does not recover deleted items (§4.4) or messages never stored in a mailbox (automated mail: see the copy design).
- It does not cover messages held only on other devices or in other clients that are not inventoried.
- It does not replace the production database or resume backups.
- It sets no retention period.
- It proves no legal sufficiency.
- It does not test Outlook **deliverability**: offline recovery in Outlook is unrelated to D7.

## 11. Sources (checked 2026-10-25)

**A resolving link is not, by itself, verification.** Each entry says what was actually read.

- Titan:
  - [What happens to emails in Trash and Spam folders](https://support.titan.email/hc/en-us/articles/900005587083-What-happens-to-emails-in-Trash-and-Spam-folders) — read: 30 days; permanent.
  - [Are my mails backed up](https://support.titan.email/hc/en-us/articles/900001330166-Are-my-mails-backed-up) — read: no restoration to an earlier state.
  - [Backup using Outlook](https://support.titan.email/hc/en-us/articles/61515776629273-How-to-take-a-backup-of-my-emails-using-Outlook) — read: the export path.
  - [Restore PST via Outlook](https://support.titan.email/hc/en-us/articles/900003804526-How-to-restore-backup-PST-file-via-Outlook-Email-Client) — read: it moves the contents into the live account; not used for testing.
  - [Configure Titan Mail on Outlook](https://support.titan.email/hc/en-us/articles/900001311526-Configure-Titan-Mail-on-Outlook) — read: IMAP 993 SSL/TLS, SMTP 465 SSL/TLS, SPA; "If Two-Factor authentication is turned on… setup an application password instead of your normal mailbox password". No test-message step is described.
  - [Application Password in Titan for Third-Party Clients](https://support.titan.email/hc/en-us/articles/59899461438233-Application-Password-in-Titan-for-Third-Party-Clients) — **title found by search; the body could not be retrieved; not inspected.**
  - [Two-Factor Authentication settings](https://support.titan.email/hc/en-us/articles/9820407299737) — read: still states that third-party clients "will be blocked when Two-Factor Authentication is enabled" (inconsistent with the Outlook guide; not followed).
  - [IMAP/POP settings](https://support.titan.email/hc/en-us/articles/900000215446) — read: refers to application passwords when 2FA is on; its troubleshooting suggests turning 2FA off (not followed).
  - [Backup using Thunderbird](https://support.titan.email/hc/en-us/articles/61515570708761-How-to-take-a-backup-of-my-emails-using-Thunderbird).
- Microsoft:
  - [What version of Outlook do I have?](https://support.microsoft.com/office/what-version-of-outlook-do-i-have-b3a9568c-edb5-42b9-9825-d48d82b2257c) — read: File → Office Account (or Help) → Product Information; About Outlook; New Outlook identified by its Settings gear.
  - [Why use Send/Receive groups?](https://support.microsoft.com/en-us/outlook/why-use-send-receive-groups) — read: groups can set whether mail is sent, received or both per account.
  - [Change send and receive settings when working offline in classic Outlook](https://support.microsoft.com/en-us/outlook/change-send-and-receive-settings-when-working-offline-in-classic-outlook) — read: scheduled send/receive and F9 inclusion per group.
  - [Send/Receive group options (Office Customization Tool help)](https://learn.microsoft.com/en-us/office/customization-tool/oct-2016-help-modify-group-dialog-box) — option names ("Send mail items", "Receive mail items", "Download complete item including attachments").
  - [Email stays in the Outbox until you manually send/receive](https://learn.microsoft.com/en-us/outlook/troubleshoot/synchronization/email-stays-in-outbox-until-manually-send-or-receive) — read: *Send immediately when connected*, File → Options → Advanced → Send and receive (Outlook 2010 and later).
  - [Introduction to Outlook Data Files (.pst and .ost)](https://wus.prod.support.services.microsoft.com/en-au/office/introduction-to-outlook-data-files-pst-and-ost-222eaf92-a995-45d9-bde2-f331f60e2790) — read: IMAP accounts use `.ost` in Outlook 2016 and Outlook for Microsoft 365; location `drive:\Users\user\AppData\Local\Microsoft\Outlook`; "any items that are saved locally should be backed up"; PSTs typically in `Documents\Outlook Files`; no import from `.ost`.
  - [Attachment issues in Outlook 2010, 2007, 2003](https://learn.microsoft.com/en-us/outlook/troubleshoot/message-body/attachments-issues-outlook) — read: the Outlook Secure Temporary File folder; attachments can remain there. Documented for older versions only.
  - [Export to a .pst](https://support.microsoft.com/en-us/office/back-up-your-outlook-email-14252b52-3075-4e9b-be4e-ff9ef1068f91) — **the Classic tab was not machine-readable here and was not inspected**; the export steps follow Titan's guide and are verified by the owner during setup.
  - [Open a .pst](https://support.microsoft.com/outlook/open-and-find-items-in-an-outlook-data-file-pst);
  - [Import from a .pst](https://support.microsoft.com/en-au/office/import-email-contacts-and-calendar-from-an-outlook-pst-file-431a8e9a-f99f-4d5f-ae48-ded54b3440ac) — opening without importing;
  - [PST size limits](https://learn.microsoft.com/en-us/microsoft-365-apps/outlook/data-files/configure-size-limit-outlook-data-files);
  - [End of support for Office 2016 and 2019](https://support.microsoft.com/KB/5002369);
  - [Device Encryption in Windows](https://support.microsoft.com/en-us/help/4502379) — read: Settings path; "Automatic Device Encryption Support" / "Device Encryption Support"; OS drive and fixed drives; local account ⇒ not turned on automatically; available on Windows Home;
  - [BitLocker Drive Encryption](https://support.microsoft.com/windows/security/encryption/bitlocker-drive-encryption) — not available on Home;
  - [Find your BitLocker recovery key](https://support.microsoft.com/ro-ro/windows/security/encryption/find-your-bitlocker-recovery-key).
  - *Test Account Settings* sending a test message: **no Microsoft source found in this session**; stated from provider guides as a risk to avoid, not as a documented fact.
- Third-party (not Microsoft documentation): [Robert Sparnaaij, "Don't risk losing your Contacts and Calendar when using IMAP"](https://robert365.com/article/do-not-risk-losing-your-contacts-and-calendar-when-using-imap) — "(This computer only)" folders are held in the IMAP `.ost` and not on the server.
- Thunderbird: [Export your Thunderbird profile](https://support.mozilla.org/no/kb/thunderbird-export) — the 2 GB limit.
- VeraCrypt: [Beginner's Tutorial](https://veracrypt.io/en/Beginner's%20Tutorial.html); [VeraCrypt Volume](https://veracrypt.fr/code/VeraCrypt/tree/doc/html/VeraCrypt%20Volume.html); [Using VeraCrypt without administrator privileges](https://veracrypt.io/en/Using%20VeraCrypt%20Without%20Administrator%20Privileges.html). The official FAQ was not retrievable in this session; the no-recovery property of a lost passphrase is stated as a design assumption, to be confirmed during setup.
