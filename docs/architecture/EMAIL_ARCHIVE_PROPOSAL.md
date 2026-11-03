# Valida — Seven-Year Email Archive: Proposed Architecture

> **SUPERSEDED — 2026-10-25, by owner decision OD-2026-10-25-01** ([`docs/review/OWNER_DECISION_2026-10-25_EMAIL_BACKUP.md`](../review/OWNER_DECISION_2026-10-25_EMAIL_BACKUP.md)).
>
> The owner retained Titan and replaced the seven-year enterprise archive request with a **monthly offline backup** ([`EMAIL_BACKUP_PROPOSAL.md`](EMAIL_BACKUP_PROPOSAL.md)). Nothing in this document was approved or implemented.
>
> - **EA-0 and EA-2:** superseded, not implemented.
> - **EA-1:** rescoped to automated-message copy preservation ([`AUTOMATED_MESSAGE_COPY_DESIGN.md`](AUTOMATED_MESSAGE_COPY_DESIGN.md)).
> - **EA-3:** rescoped to monthly offline backup and recovery.
>
> The text below is kept unchanged as history.

| | |
| --- | --- |
| Status | **PROPOSAL — not implemented and NOT purchase-ready.** Nothing has been bought, provisioned, migrated or configured, and no DNS record has changed. **The requirement remains UNRESOLVED.** This supersedes the r5–r8 proposal (project document `claude/valida-B6-final-r8-archive-design.md`). |
| Revision | **rev 1**, 2026-10-25 evening, after GPT's review of the first version (that version followed the B6 live tests: [`docs/qa/B6_EVIDENCE_ADDENDUM.md`](../qa/B6_EVIDENCE_ADDENDUM.md)) |
| Owner requirement | Keep **all company email** — human and automated, incoming and outgoing — with full content, headers and attachments, for **seven years**. Access from Outlook is desired. |
| Governing text | Doc 13 §§157–163, 186–198 (backups; storage limitation; retention AWAITING determination; deletion workflow; provider inventory) · Doc 14 §§174–178 · Doc 10 §§122, 125–127 · Doc 12 §§104–114 · Doc 15 §§176–192 (backup ≠ restore; independent recovery) · Doc 17 §§313–319 · Doc 00 §5 |
| Not claimed | **No legal conclusion.** This is an engineering design. It does not establish that seven years is the right or a lawful period for every kind of mail (Doc 13 §§186–187). It does **not** establish legal sufficiency, and it does **not** promise that any record will be accepted by IRCC or any other authority. A qualified professional must decide the period and scope (decision Q3). |

## 0. What changed

**In the first version** (after the live tests):

- Titan kept **no Sent copy** of SMTP submissions (addendum §6).
- A bounce returns the **full** message (addendum §5.2).
- The provider facts were verified.

**In rev 1** (after GPT's review):

1. **The independent copy of human mail is UNRESOLVED.** A daily export of ordinary folders can miss items deleted or changed before collection. Comparing counts does not prove that each message and attachment is in the copy. Two concrete methods are now compared (§4.3): **(a) Exchange Online journaling to an external destination** and **(b) an export of held, deleted and modified items through eDiscovery**. Neither is demonstrable yet, so none is selected. A proof of concept (EA-0, §10) defines what would make one selectable.
2. **Third-party archiving is no longer dismissed.** It is one of the two kinds of external journaling destination (§4.3 a).
3. **Licensing and costs re-verified** against current Microsoft and AWS pages, and all **unknowns are named**. **$336/year is only the licence subtotal for four mailboxes under its stated assumption**, not the archive's cost (§8).
4. **Each of the four mailboxes** has its coverage and its tests listed, including the 10 MB retention threshold (§5).
5. The automated-mail design (the pre-send locked copy) is **kept unchanged** in substance.

## 1. What an archive must keep separate

| State | Established by | Does **not** establish |
| --- | --- | --- |
| **Attempted send** — the backend began submitting a message | The pre-send locked copy (§4.1) and the claim in MongoDB | That the relay received it |
| **Relay acceptance** — the relay answered `250` | The recorded SMTP outcome (`SENT`) | Receipt |
| **Actual receipt** | **Never visible to the sender.** Indirect evidence only: for an internal notification, the copy found in the `hr@` mailbox | — |
| **Bounce** — a later delivery-failure report | The DSN in the sending mailbox, matched by Message-ID | Anything about other recipients |
| **Archive capture** — a copy is in the archive | The archive's own record: object key, SHA-256, time, source (pre-send copy, journal report or export) | Completeness, unless reconciled; durability, unless restored |
| **Retention enforcement** | A lock in a mode the service documents as non-bypassable, disposal logs, **restore tests** | Legal sufficiency |

## 2. Facts (retrieved 2026-10-25; USD list prices before tax, to be re-checked for Valida's billing country and currency)

| Fact | Source |
| --- | --- |
| Titan stored **no Sent copy** of 6 SMTP submissions. Titan's scripting guidance copies sent mail to Sent with a separate IMAP `APPEND`. | Addendum §6; [Titan — Configuring Titan on Email Scripts](https://support.titan.email/hc/en-us/articles/4405162224665-Configuring-Titan-on-Email-Scripts) |
| Bluehost Professional Email: Pro 10 GB, Plus 50 GB, Ultra 100 GB + 50 GB backup. Renewal $2.99 / $4.99 / $10.99 per month, or $29.99 / $49.99 / $109.99 per year. The pricing page shows other 12-month figures. No retention policy, legal hold or journaling is listed. | [Bluehost — plans comparison](https://www.bluehost.com/help/article/bluehost-professional-email) (updated 1 Jul 2026); [Bluehost — pricing](https://www.bluehost.com/pricing/professional-email) |
| Titan Email Backup: "select plans", daily, restores into the mailbox. Retention length and behaviour on cancellation are not stated. | [Titan — Email Backup](https://support.titan.email/hc/en-us/articles/52000737437721-Email-Backup) |
| Exchange Online **Plan 1 $4.00**, **Plan 2 $8.00**; Business Basic $7.00 ($5.40 without Teams) — per user/month, paid yearly. | [Microsoft — Exchange Online plans](https://www.microsoft.com/microsoft-365/exchange/compare-microsoft-exchange-online-plans); [Microsoft — business plans](https://www.microsoft.com/en-us/microsoft-365/business/compare-all-microsoft-365-business-products) |
| **Exchange Online Archiving (EOA) $3.00** user/month, paid yearly. "When a subscription is canceled, all associated data will be deleted." | [Microsoft — EOA](https://www.microsoft.com/en-us/microsoft-365/exchange/microsoft-exchange-online-archiving-email) |
| **Microsoft 365 E3 $39.00** (with Teams) / **$30.45** (without Teams) user/month, paid yearly, annual commitment. | [Microsoft — Microsoft 365 E3](https://www.microsoft.com/microsoft-365/enterprise/e3) |
| Retention policies for Exchange mailboxes: Business Premium, E3/E5, or — for an Exchange mailbox location — **Exchange Plan 2** or **EOA**. Holds on a **shared** mailbox need Plan 2, or Plan 1 + EOA. Inactive mailboxes need no licence. | [Microsoft Purview service description](https://learn.microsoft.com/en-us/office365/servicedescriptions/microsoft-365-service-descriptions/microsoft-365-tenantlevel-services-licensing-guidance/microsoft-purview-service-description) |
| **Journaling is available in every Exchange Online plan**, including Plan 1. In-Place Hold / Litigation Hold: Business Premium, E3/E5, Plan 2 (not Plan 1 alone). | [Exchange Online service description](https://learn.microsoft.com/da-dk/office365/servicedescriptions/exchange-online-service-description/exchange-online-service-description) |
| Under a retention policy, deleted, purged and edited items are kept in **Recoverable Items**. User and shared mailboxes are covered. **"Mailboxes must have at least 10 MB of data before retention settings will apply to them."** | [Microsoft — retention for Exchange](https://learn.microsoft.com/en-us/purview/retention-policies-exchange) |
| Recoverable Items subfolders: **Deletions**; **Versions** (original copies of modified items, under hold or retention policy); **Purges** (hard-deleted, under Litigation Hold or single item recovery); **DiscoveryHolds** (hard-deleted items under a hold or retention policy). It is "indexed by Exchange Search and can be discovered by … Content Search". Copy-on-write does not apply to Drafts, and it stops when the Recoverable Items quota is reached. | [Microsoft — Recoverable Items folder](https://learn.microsoft.com/en-us/exchange/security-and-compliance/recoverable-items-folder/recoverable-items-folder) |
| **Journaling:** envelope journal reports with the original message attached "unaltered". Scope: internal, external or all. **"You can't designate an Exchange Online mailbox as a journaling mailbox"** — reports go to an on-premises or third-party archive. Undeliverable reports are retried for up to 24 hours, then an NDR containing the report goes to the **alternate journaling mailbox** (also not an Exchange Online mailbox). If both are unavailable, "the rejected journal reports are lost and can't be retrieved". **"It is your responsibility to monitor and follow up on any non-delivery receipts."** The number of journal rules is limited. Duplicates are documented for hybrid set-ups; already-journaled mail is bypassed. Page updated 2026-05-29. | [Microsoft — Journaling in Exchange Online](https://learn.microsoft.com/en-us/exchange/security-and-compliance/journaling/journaling) |
| eDiscovery **export**: PST or .msg (no .eml). "To export content in eDiscovery, assign the eDiscovery user a **Microsoft 365 Enterprise E3 or E5** license." | [Microsoft — eDiscovery export](https://learn.microsoft.com/purview/edisc-search-export) |
| eDiscovery: export is in the standard tier; the **Graph API with app-only authentication is a premium (E5) feature**, while delegated authentication is in both tiers. | [Microsoft — eDiscovery overview](https://learn.microsoft.com/en-us/Purview/edisc) |
| Graph mail folders: the only Recoverable Items folder exposed is **`recoverableitemsdeletions`** (soft-deleted items). **Purges, Versions and DiscoveryHolds are not among the documented well-known folders.** | [Microsoft Graph — mailFolder](https://learn.microsoft.com/en-us/graph/api/resources/mailfolder) |
| **EWS in Exchange Online:** blocking of non-Microsoft apps starts 1 October 2026 (Microsoft developer blog). Phased disablement from 1 October 2026 and full retirement on **1 April 2027** (message center MC1227454, read via a third-party mirror). | [Microsoft — Retirement of EWS in Exchange Online](https://devblogs.microsoft.com/microsoft365dev/retirement-of-exchange-web-services-in-exchange-online); [MC1227454 (mirror)](https://www.itelio.com/en/microsoft-message-center/MC1227454) |
| Graph `sendMail`: `saveToSentItems` defaults to true; "`202 Accepted` … doesn't indicate that the request processing has completed". | [Microsoft Graph — sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0) |
| Exchange Online SMTP AUTH basic authentication: unchanged until December 2026, then off by default for existing tenants; the final date is to be announced in the second half of 2027 (MC786329, via a mirror). | [MC786329 (mirror)](https://www.itelio.com/en/microsoft-message-center/MC786329) |
| **Amazon SES receiving:** $0.10 per 1,000 emails + $0.09 per 1,000 incoming 256 KB chunks; S3 billed separately. The S3 action stores the raw MIME (up to 40 MB). **"SES does not support receipt rules that upload to S3 buckets enabled with object lock configured with a default retention period."** Receipt rules run **after** the SMTP conversation. | [AWS — SES pricing](https://aws.amazon.com/ses/pricing/); [AWS — SES S3 action](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-action-s3.html); [AWS — SES receiving concepts](https://docs.aws.amazon.com/ses/latest/DeveloperGuide/receiving-email-concepts.html) |
| **Backblaze B2:** $6.95 / TB-month; the first 10 GB free. Compliance-mode Object Lock "cannot be removed by any user". **S3 compliance mode:** no user including root can delete or shorten; the only early deletion is deleting the AWS account. | [Backblaze — pricing](https://www.backblaze.com/cloud-storage/pricing); [Backblaze — Object Lock](https://www.backblaze.com/docs/cloud-storage-object-lock); [AWS — Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/dev/object-lock-overview.html) |
| IMAP UIDs are strictly ascending, and gaps are normal. | [RFC 4315 §3](https://www.rfc-editor.org/rfc/rfc4315) |
| **Not verified:** S3 Standard storage prices (the pricing page's tables were not retrievable); Microsoft 365 E5 prices; the price of any third-party archiving service. | — |

## 3. What Titan cannot satisfy reliably

| Need | With Titan (Bluehost Plus today) |
| --- | --- |
| Capture automated outgoing mail | **No.** No Sent copy of SMTP submissions (observed). |
| Prevent loss of human mail deleted before collection | **No.** No documented retention lock, hold or journaling. The Ultra backup is a daily in-account snapshot. |
| An independent copy of everything | **No.** Only IMAP collection of what is still in the mailbox when it runs. |
| Enforce seven years | **No.** |
| Bounce / delivery data by API | **No.** |

Neither independent-copy method of §4.3 exists on Titan: it has no journaling and no hold to export from.

## 4. Architecture

### 4.1 Automated mail — the pre-send locked copy (EA-1) — PROPOSED

This is unchanged in substance from the first version. It is the one part whose capture, reconciliation, restore and failure handling Valida can demonstrate with its own tests.

1. **Compose once.** The backend composes the exact message: headers, both parts, the Valida Message-ID and the Date.
2. **Write ahead.** Before any connection to the relay, it writes two create-only objects to a compliance-locked bucket:
   - `outbound/v1/<yyyy>/<mm>/<dd>/<token>/<attempt>/message.eml` — the bytes;
   - `envelope.json` — `{ event, applicationId, attempt, token, mailFrom, rcptTo, sha256, composedAt, templateVersion, provider }`.

   If either write fails or its outcome is unknown, **nothing is submitted**: the channel is recorded `FAILED` / `ARCHIVE_UNAVAILABLE` (transient; a new code — a Doc 10 / Doc 14 change).
3. **Submit** exactly those bytes, under the existing claim, bound and classification.
4. **Record the outcome**: in MongoDB as today, and as a new create-only object `outcome.json` — `ACCEPTED_BY_RELAY`, `REFUSED` (code), or `UNKNOWN`. Nothing is overwritten; corrections are new objects (`outcome-reconciled.json`).
5. **Reconcile daily:**
   - every `SENT` channel has an `ACCEPTED_BY_RELAY` attempt;
   - every attempt has an outcome;
   - each bounce in the mail archive is matched to a token.

**It guarantees:** nothing is submitted without a locked copy of the submitted bytes, so the archive may hold more than was sent (each extra copy marked), never less — to be proven by EA-1's tests.

**It does not guarantee:** a byte-identical copy of what recipients received (the relay adds `Received` and `DKIM-Signature`), or receipt.

Crash recovery, duplicate writes and uncertain outcomes are handled as follows:

| Situation | Handling |
| --- | --- |
| A crash between write and submit | The reconciliation job records `UNKNOWN`; a retry needs `--include-uncertain`, as today. |
| A crash after submit | The same. The bytes are archived either way. |
| Outcome stored in MongoDB but its ledger object failed | Reconciliation copies it into `outcome-reconciled.json`. |
| A write retried after an unknown response | Create-only: `412`; read back and compare the SHA-256 — equal means done, different is an incident. |
| A retry of the same message | A new `<attempt>` folder with the same token. Attempt numbers come from the conditional claim. |

### 4.2 Human mail — store-level retention (EA-2) — direction PROPOSED, not purchase-ready

**Exchange Online** is the only platform evaluated on which **both** independent-copy methods of §4.3 exist and on which deleted and edited items are retained at the store.

- One retention policy covers every mailbox: retain-only until the period is decided, then retain-and-delete.
- **Preservation Lock** only after verification and the owner's explicit sign-off, because it is irreversible.

**Limits that must be tested, not assumed:**

- **the 10 MB threshold** (§5);
- copy-on-write ignores Drafts;
- versions stop when the Recoverable Items quota is reached;
- mail refused or quarantined before reaching a mailbox is not retained there;
- retention ends with the subscription (EOA: "all associated data will be deleted").

That last point is why an **independent** copy is required (Doc 14 §177; Doc 15 §184).

### 4.3 The independent copy of human mail — **UNRESOLVED**

**The gap.** A daily export of ordinary folders (Inbox, Sent Items, …) misses any item that is deleted, moved or edited before the next run. Exchange still has it in Recoverable Items, but the independent copy does not. Graph exposes only the soft-deleted folder (`recoverableitemsdeletions`), not Purges, Versions or DiscoveryHolds, and EWS is being retired. Comparing per-mailbox **counts** shows a difference exists; it does **not** prove that each message and attachment is in the copy. **The first version's Layer 3 (a daily Graph export) is therefore withdrawn as a complete answer.**

| | **(a) Journaling to an external destination** | **(b) Exporting held, deleted and modified items through eDiscovery** |
| --- | --- | --- |
| **What it captures** | Every message that passes through Exchange Online transport for the mailboxes in scope (scope "All", so internal mail between Valida mailboxes is included). The original is attached unaltered to a journal report, **at transport time** — before any user can delete or edit it. | Whatever the mailbox still holds, **including Recoverable Items** (Deletions, Purges, DiscoveryHolds, Versions) where retention or a hold applies, at the time of each export. |
| **What it misses** | Items that never pass transport: drafts, items imported or created directly in a mailbox, mail before journaling was enabled (backfill by export). **Mail Valida's backend sends through Titan** never enters Exchange Online (EA-1 covers it). Whether mail rejected or quarantined by filtering is journaled: **unknown**. Reports lost when both the journal and the alternate destinations fail for more than 24 hours. | Anything **not retained**: mailboxes under 10 MB; Drafts copy-on-write; Recoverable Items quota exhaustion; anything outside the search query. Whether unindexed or partially indexed items are exported, and how: **unknown**. |
| **Mechanism** | A journal rule; an external journal address; a separate external **alternate journaling mailbox** for NDRs; a TLS-enforcing outbound connector to the destination (to verify). | A Purview eDiscovery search over all mailboxes, including Recoverable Items, then **export to PST or .msg** (no .eml); conversion to EML / MBOX is a separate tool step. |
| **Licence** | Journaling: every Exchange Online plan. No extra Microsoft licence identified. | The **exporting user needs Microsoft 365 E3 or E5**. Unattended automation through the Graph eDiscovery API with **app-only** authentication is a **premium (E5)** feature. With E3, export is interactive, or delegated (a stored privileged user token — a security risk to assess). |
| **Destination / tool** | (a1) a **third-party archiving service** that accepts Exchange Online journaling: product, price, location, lock mode and acceptance semantics **unknown — quotes and documentation needed**; or (a2) a **Valida-operated receiver**. Example: Amazon SES receiving → S3. **But SES cannot write to an S3 bucket with a default Object Lock retention**, so an extra step is needed (a function that copies into a locked bucket, or per-object retention), and SES runs its rules **after** accepting at SMTP: a failed store would raise **no** NDR to Exchange. | PST / .msg files written to the same independent, compliance-locked store as EA-1, with a manifest. |
| **Duplicates** | Possible (documented for hybrid; message forking). De-duplicate by the attached original's SHA-256 and Message-ID while keeping every report (envelopes can differ). | Overlapping exports re-export the same items. De-duplicate by item identity / hash across exports. |
| **Failure handling** | Exchange retries for 24 hours, then sends an NDR to the alternate destination, **which must be monitored** (Microsoft: "your responsibility"). A destination that accepts at SMTP and then fails to store is a **silent loss** unless reconciliation catches it. | Export jobs can fail or be partial; their status and reports must be checked each time. A missed export run leaves a lag, but the items remain in Exchange's retention meanwhile. |
| **Reconciliation** | Compare stored journal reports against Exchange Online **message trace** for the mailboxes. Whether message trace's retention and fields allow per-message matching for every day: **to verify**. | Compare the export's item report with the search statistics, per mailbox and folder, including Recoverable Items, and check each listed item is present in the store. This proves export completeness **against the search**, not against all mail. |
| **Restore** | Open the attached original from the stored journal report (.eml), or import it into an isolated mailbox. | Open the PST in Outlook, or import it into an isolated mailbox. |
| **Independence** | **High**: a copy leaves Microsoft at transport time. | **Medium**: the copy is taken from Microsoft's retained store on a schedule; anything Microsoft did not retain cannot be exported. |
| **DNS** | (a2) needs a receiving domain or subdomain with an MX record — **not authorised now**. (a1) depends on the vendor. | None |
| **Demonstrable today?** | **No** — needs a tenant, a destination and DNS. | **No** — needs a tenant and an E3/E5 licence. |

**Status: UNRESOLVED. Nothing is selected.** If the EA-0 proof of concept (§10) passes for **(a)**, (a) becomes the recommendation for transmitted mail, with **(b)** as a periodic complement (backfill, drafts, a cross-check). That is because only (a) captures before any user action. This is a conditional preference for the review to weigh, **not** a selection.

## 5. Coverage of each mailbox (target state under Exchange Online; every row to be proven by tests)

| Mailbox | Kind / licence (assumption) | Store retention | Independent copy | Tests |
| --- | --- | --- | --- | --- |
| `saeed@` | User; Plan 1 + EOA | Retention policy. Below 10 MB, retention does not apply: until EA-2 test 2 passes, place the mailbox on Litigation Hold (licensed through EOA — to verify) or the requirement is **not met** for it. | (a) journal rule, scope All, recipient in scope; (b) included in the search | EA-2.1–2.4; EA-0.1–0.6 |
| `shervin@` | User; Plan 1 + EOA | Same | Same | Same |
| `hr@` (recruitment; receives `careers@` mail and internal notifications) | User or shared mailbox. Shared needs Plan 2, or Plan 1 + EOA, for holds and retention rights. | Same | Same | Same, plus: an internal notification received in `hr@` is found in the journal store (if the backend's mail ever enters Exchange) and in the export |
| `notifications@` (receives bounces; sends automated mail through Titan today) | User; Plan 1 + EOA (it needs a credential if it ever sends through Exchange) | Same. **Likely under 10 MB for a long time** — the hold fallback is probably needed. | Inbound bounces: (a) or (b). **Outbound automated mail: EA-1**, not journaling, while it is sent through Titan. If it moves to Graph `sendMail`, journaling and Sent Items also apply. | Same, plus EA-1 tests |
| `careers@` (today a forward; Doc 14 §35 prefers a mailbox) | If made a shared mailbox: Plan 1 + EOA, or Plan 2 — a **fifth** licence | Same | Same | Same |

**Per-mailbox test pattern** (synthetic messages only; part of EA-0 and EA-2):

1. Send a test message in, and send one out.
2. Delete and purge one; edit one.
3. After 48 hours, check:
   - eDiscovery finds each item, including the purged one and the original of the edited one;
   - the independent copy holds each message whole, with its attachment and matching SHA-256;
   - the restore of one message from the independent copy opens in Outlook.

## 6. Security, retention and disposal

Unchanged in substance from the first version:

- **Separate storage account.** MFA; least-privilege keys — the backend may only create objects under `outbound/`, and the journal or export pipeline has its own prefix.
- **Compliance-mode locks** set per object. Note that SES cannot write directly into a bucket with a default lock.
- **Legal hold**, disposal logs, and a replica in a second account or location (account lapse destroys locked data).
- Provider inventory and approved Privacy Notice wording (Doc 13 §§197–198; Doc 06). Data-subject requests are reconciled with retention (Doc 13 §§190–193).
- **Journal reports and exports contain every candidate email in full.** They are among the most sensitive data Valida holds.

## 7. Search, export and Outlook

- Outlook for day-to-day reading (Exchange Online).
- `.eml` from EA-1 and from journal reports (a) opens in Outlook.
- PST from eDiscovery (b) opens in Outlook.
- MBOX generated from EML on demand.
- A manifest with SHA-256 for every stored item.

**A PST is an export, not an archive:** it has no lock and no completeness evidence.

## 8. Costs — the four existing mailboxes

**Volume assumptions** (to be replaced with three months of real data):

| | Base | High |
| --- | --- | --- |
| Human mail | 60 messages/day × 100 KB → ≈ 2.2 GB/year, ≈ 15 GB over 7 years | 200 messages/day × 200 KB → ≈ 14.6 GB/year, ≈ 100 GB |
| Automated mail | ≈ 10 MB/year | ≈ 100 MB/year |

USD list prices, annual commitment, retrieved 2026-10-25; tax and currency extra.

| Item | Amount | Status |
| --- | --- | --- |
| **Mailbox licence subtotal**: Exchange Online Plan 1 + EOA for the 4 existing mailboxes | 4 × ($4.00 + $3.00) × 12 = **$336 / year** | Verified prices. **This is a licence subtotal under the assumption "Plan 1 + EOA for all four"; it is not the archive's total cost.** (Alternatives: Plan 2 at $384; Business Basic + EOA at $480.) |
| `careers@` as a fifth, shared mailbox | + $84 / year (Plan 1 + EOA) | Verified price; the decision is open (DEV-B6-05) |
| **(b) only — an export licence**: Microsoft 365 E3 for one eDiscovery user | **$365.40 / year** (no Teams) or **$468 / year** (with Teams). If that person's own mailbox is the E3 one, its $84 Plan 1 + EOA licence is no longer needed. | Verified prices |
| **(b) unattended automation**: premium (E5) for app-only Graph eDiscovery | **Unknown** (E5 price not verified) | Unknown |
| **(a1) third-party journaling archive** | **Unknown** — needs vendor quotes | Unknown |
| **(a2) a Valida-operated receiver, e.g. SES** | Receiving at base volume (≈ 22,000 reports/year, one 256 KB chunk each): ≈ 22 × ($0.10 + $0.09) ≈ **$4 / year**; high (≈ 73,000/year) ≈ **$14 / year**. **Plus:** S3 storage (price not verified); the copy-into-locked-bucket function (cost unknown); and engineering. | Partly verified; the rest unknown |
| Independent locked store (EA-1 and exports) — B2 | base ≈ $0–1 / year; high ≈ $8 / year | Verified price; volume assumed |
| Replica in a second location | similar to the above | Assumed |
| Migration Titan → Exchange Online (tooling, effort, MX change at D2) | **Unknown** | Unknown; DNS not authorised now |
| Monitoring (bounces, journal NDRs, export jobs, reconciliation reports) | **Unknown** (person-time) | Unknown |
| Engineering (EA-1; the EA-0 proof of concept; (a2) or the (b) pipeline; reconciliation) | **Unknown** | Unknown |
| Titan after a migration | −$200 / year (4 × $49.99 at the Plus renewal), **if** Titan is no longer needed. Whether the backend can keep sending through Titan once MX points elsewhere is **unknown**. | Partly unknown |

**Total cost: not determinable yet.** It depends on decisions Q2 and Q8 and on the unknowns above.

## 9. The platform decision for human mail

| | **H1 — Exchange Online** | **H2 — stay on Titan** |
| --- | --- | --- |
| Deleted or edited items at the store | Retained (subject to §5's limits) | Not retained |
| Independent copy | Method (a) or (b) — **UNRESOLVED** (§4.3) | IMAP collection only. Items deleted between polls are **not detectable with certainty** (UID gaps are not proof). |
| Outlook | Native | Through IMAP |
| Change | Migration and an MX change at D2 (not authorised now) | None |
| Meets "keep everything for 7 years"? | **Not yet demonstrable**: depends on §4.3 and the EA-0 / EA-2 tests | **No** — residual losses cannot be ruled out |

H1 is the **direction** proposed for the owner's consideration, because H2 cannot meet the requirement. It is **not purchase-ready** while §4.3 is unresolved.

## 10. Milestones and acceptance criteria (proposed; Doc 18 change control needed)

| Part | Placement | Acceptance criteria |
| --- | --- | --- |
| **EA-0 — Proof of concept** for the independent copy of human mail (a trial tenant or a minimal paid tenant, synthetic mailboxes and mail only; **every purchase, DNS change and provisioning step needs a separate authorisation**) | Before any H1 purchase decision | (0.1) A journal rule (scope All) delivers reports for messages in and out of each test mailbox, internal mail included, with each attached original intact (SHA-256 of the attachment compared with the message as received). (0.2) Destination failure: with the journal destination refusing mail, reports arrive as NDRs at the alternate destination within the documented window, and are re-submitted. With the destination accepting and then failing to store (a2), the **reconciliation detects the loss**. (0.3) Duplicates: reports of forked or duplicated messages are de-duplicated without losing any envelope. (0.4) Reconciliation: stored reports match message trace for every test message, over at least 7 days. (0.5) An export of held, deleted and modified items (b) contains the purged message and the original of the edited one; its item report matches the search statistics; the licence actually needed is confirmed in practice. (0.6) A mailbox under 10 MB: is a deleted and purged item retained? With and without Litigation Hold. (0.7) Whether quarantined or rejected mail is journaled. **The method whose criteria all pass is selected; if neither passes, the requirement stays unresolved and is escalated to the owner.** |
| **EA-1** — automated mail, pre-send locked copy | After B7; before production sends, if Q1 = yes | As in the first version: (1) a storage failure means no submission; (2) the stored bytes equal the bytes the SMTP test server received (SHA-256); (3) outcome objects and crash reconciliation; (4) create-only and idempotent writes; (5) a real compliance lock cannot be deleted or shortened (test bucket); (6) negative tests on the backend key; (7) nothing in MongoDB, no addresses in logs; (8) zero unexplained reconciliation gaps on synthetic data. |
| **EA-2** — store retention (H1) | With D2 (the MX change separately authorised) | (1) The policy covers each mailbox in §5. (2) Per mailbox, a deleted, purged and edited test item is found by eDiscovery after 48 hours. (3) Preservation Lock only after the owner's sign-off. (4) MFA on every administrator. (5) Outlook access. |
| **EA-3** — the independent copy, in production | With D5; before Release E | The EA-0 method, in production: daily reconciliation with no unexplained gaps; NDR and alternate-destination monitoring live; replica locked; a quarterly restore test passed with evidence (§6); EML / MBOX / PST export of one mailbox; provider inventory and Privacy Notice approved; professional advice recorded. |

## 11. Decisions requested

| # | Decision | Status |
| --- | --- | --- |
| Q1 | Does the seven-year requirement cover automated mail from its first production use? | Owner. If yes, EA-1 is a C6 prerequisite. |
| Q2 | Human-mail platform | Direction PROPOSED: H1 (Exchange Online). Not purchase-ready. |
| **Q2a** | **Independent-copy method: (a) journaling or (b) held-item export** | **UNRESOLVED** — decide after EA-0 |
| Q3 | Period and scope, for example mail about unsuccessful candidates | A professional determination |
| Q4 | Independent store provider and region; for (a), the journal destination: a vendor or Valida-operated | Owner, after EA-0 |
| Q5 | Preservation Lock (irreversible) | Only after EA-2 is verified |
| Q6 | Archive owner, read-only auditor, NDR / journal monitor | Named people (**AWAITING INPUT**) |
| Q7 | Authorise EA-0: a trial tenant, test DNS records for a journal subdomain, synthetic mail | Owner; **not authorised by this proposal** |
| Q8 | Budget, once §8's unknowns are quoted | Owner |

**Open questions:**

- **O-1:** export licence and automation path — answered in part: E3 or E5 is needed to export; app-only automation needs premium.
- **O-2:** is quarantined or rejected mail journaled?
- **O-3:** does Litigation Hold work below 10 MB, and does EOA license it?
- **O-4:** can message trace serve as the reconciliation source (fields, retention)?
- **O-5:** vendors for (a1), with prices, lock mode, location, and when they accept at SMTP relative to durable storage.
- **O-6:** after an MX move, can the backend keep using Titan SMTP for `notifications@`?

**Not authorised by this proposal:** any purchase, trial sign-up, provisioning, migration, DNS / MX change, or live email.
