# Owner approval sheet — B6 email: identity, texts, timestamp, logo

| | |
| --- | --- |
| Prepared | 2026-10-26 by Claude, with decision package rev 5. **Nothing on this sheet is approved until the owner marks and dates it.** |
| Outcome | **Approved by the owner on 2026-10-26 — OD-2026-10-26-02** ([`OWNER_DECISION_2026-10-26-02_B6_APPROVALS.md`](OWNER_DECISION_2026-10-26-02_B6_APPROVALS.md)): §1 (AMD-TITAN-02), §2 and §3 (both email texts), §4 (Option 1), §5 (the dark logo inline as CID) and §6 (the subject rule), plus the D2 monitoring cadence and escalation timing. The tick boxes below are the original form, left as they were; the decision record is OD-2026-10-26-02. |
| Revision | **rev 6** (2026-10-26): the outcome recorded; §7 updated; the HMAC attribution corrected (§7.3). The texts of §§1–6 are unchanged. |
| Status | **B6 NOT ACCEPTED.** G-SUP closed. G-COPY proposed, not approved. B7 not started. The body-discard issue is **OPEN**. The real vacancy is **DRAFT**. |
| Recommendations — not approvals | GPT's review of rev 4 recommends: keeping `notifications@cybervalida.com` permanently, with its authentication and access-separation conditions; the current proposed texts; timestamp Option 1; the dark official logo inline (CID), subject to checking the final image and client tests. Claude's recommendation is the same. **These are recommendations; only the owner's marks below are decisions.** |
| What approving here does | It approves wording and specifications only, to be recorded under Doc 00 §5. It does **not** authorise Stage 2 (template code), a live send, any account or DNS change, or B6 acceptance (§7). |

## 1. Sender identity — AMD-TITAN-02

This amends the **LOCKED** Doc 14 §202 and MAIL-036. Exact proposed text, unchanged from [`B6_TITAN_AMENDMENTS.md`](B6_TITAN_AMENDMENTS.md) §2:

> **AMD-TITAN-02 — The automated sender identity (recommended; separate owner approval needed; touches LOCKED §202).** Doc 14 §§96–99, §§103–106, §202, MAIL-036; Doc 18 §§201–204.
>
> **§96 (replacement):** The approved production transactional identity is `Valida Careers <notifications@<PRIMARY_DOMAIN>>`, a dedicated automated mailbox on the root domain, used only by the backend, with Reply-To `careers@<PRIMARY_DOMAIN>` (§100, §203). The `notify.<PRIMARY_DOMAIN>` namespace is an optional future configuration, not a mandatory migration.
>
> **§99 (applied to the approved identity; conditions retained):** Root-domain automated sending remains allowed only while DMARC passes on real messages, the provider configuration is verified, SPF and DKIM are aligned, and the human / automated distinction stays clear.
>
> **§98, §§103–106 (note added):** The `careers@notify.` From address, the `bounce.notify.` Return-Path and `d=notify.` DKIM are preferences that apply if the `notify.` namespace is adopted. With the root-domain identity, the Return-Path is the automated mailbox, and DKIM signs with an aligned `d=<PRIMARY_DOMAIN>` key managed by the provider.
>
> **§202 TRANSACTIONAL IDENTITY — LOCKED (amendment of a LOCKED decision):** Canonical logical architecture: a dedicated automated identity under Valida's authenticated domain — currently `notifications@<PRIMARY_DOMAIN>` by owner decision — with `notify.<PRIMARY_DOMAIN>` as an optional future namespace.
>
> **MAIL-036 (replacement):** The canonical transactional identity is a dedicated, authenticated automated address under the Valida domain, approved by the owner (currently `notifications@<PRIMARY_DOMAIN>`). `notify.<PRIMARY_DOMAIN>` is optional.
>
> **Doc 18 §§201–202 (replacement):** D3 verifies the selected transactional identity, its SPF / DKIM / DMARC alignment, its routing, Reply-To and bounce visibility. It does not presume a provider or namespace migration. §204 tests are unchanged.

**Conditions that stay attached:** DMARC passes on real messages; SPF and DKIM are aligned; the provider configuration is verified at D3; only the backend sends from `notifications@` and only the backend uses its SMTP application password; no human correspondence is sent from it; monitoring and backup use separately authorised access. D3 and D7 are not waived.

| Mark one | Effect |
| --- | --- |
| ☐ **Approve AMD-TITAN-02** | `notifications@cybervalida.com` becomes the permanent automated identity; `notify.` becomes optional |
| ☐ Do not approve now | DEV-B6-01 stays the interim record, and D3 decides |

B6-1 also needs AMD-TITAN-01, -03, -04 and -05. They are in the same document and are not repeated here.

## 2. Candidate acknowledgement — `APPLICATION_ACKNOWLEDGEMENT`

| Part | Final proposed text |
| --- | --- |
| From | `Valida Careers <notifications@cybervalida.com>` (subject to §1) |
| Reply-To | `careers@cybervalida.com` (LOCKED Doc 14 §203; unchanged) |
| Subject | `Application received — {job.title} \| Valida` |
| Preheader | `Thank you for applying. Your application has been received.` |
| Header label · eyebrow | `CAREERS` · `APPLICATION RECEIVED` |
| Headline | `Thank you for applying.` |
| Body | `We’ve received your application for {job.title}.` |
| | `If we need more information or decide to move forward, we’ll contact you using the details in your application.` |
| Sign-off | `Valida Careers` |

Plain-text part, exactly:

```
Thank you for applying.

We’ve received your application for {job.title}.

If we need more information or decide to move forward, we’ll contact you using the details in your application.

Valida Careers
```

☐ Approve as written  ☐ Approve with these changes: ______________________

## 3. Internal notification — `APPLICATION_RECEIVED_INTERNAL` (shown with timestamp Option 1)

| Part | Final proposed text |
| --- | --- |
| From · Reply-To · recipient | Unchanged (`notifications@` · `careers@` · `RECRUITMENT_NOTIFICATION_RECIPIENT`) |
| Subject | `New application — {job.title} \| Valida` |
| Preheader | `A new application is recorded in Valida. Candidate details remain private.` |
| Header label · eyebrow | `CAREERS` · `RECRUITMENT / NEW APPLICATION` |
| Headline | `A new application has arrived.` |
| Lead | `The application is recorded in Valida.` |
| Rows | `Role: {job.title}` · `Role identifier: {job.slug}` · `Received (UTC): {submittedAt}` · `Application reference: {applicationId}` |
| Note | `Candidate details and the resume are stored privately in Valida and are not included in this email.` |
| Footer | `Valida · Recruitment operations` |

Plain-text part, exactly:

```
A new application has arrived.

The application is recorded in Valida.

Role: {job.title}
Role identifier: {job.slug}
Received (UTC): {submittedAt}
Application reference: {applicationId}

Candidate details and the resume are stored privately in Valida and are not included in this email.

Valida · Recruitment operations
```

It carries no candidate personal data in any header or part (copy proposal §4, requirement 2; test T-07).

☐ Approve as written  ☐ Approve with these changes: ______________________

## 4. Timestamp format — internal notification

The value is always an absolute UTC time, the same for every recipient. Only its presentation is chosen here.

| | Plain text shows | |
| --- | --- | --- |
| ☐ **Option 1** | `Received (UTC): 2026-10-26 15:42:00` | **Recommended:** sortable, locale-neutral; "UTC" appears once, in the label |
| ☐ Option 2 | `Received (UTC): 2026-10-26 15:42:00 UTC` | No formatter change; "UTC" appears twice |
| ☐ Option 3 | `Received (UTC): 26 Oct 2026 · 15:42:00` | As on the board; not sortable. Not recommended. |

## 5. Logo

**Recommendation:** the official **dark** horizontal logo, `frontend/public/brand/valida-logo-horizontal-dark.png` (1009 × 230, on its own opaque black field), resampled only — no crop, recolour or redraw — to a 316 × 72 PNG, embedded **inline as a CID image** (no hosted URL, so nothing is fetched and nothing can track opens), displayed at 158 × 36, with alt text `Valida`.

**Conditions:**

- In Stage 2 the derived file is compared side by side with the source, its SHA-256 is recorded, and the owner approves it **before** it is used.
- Stage 3 client tests follow. Some clients block inline images or list them as attachments; both are acceptable differences, because the alt text, the `CAREERS` label and the footer still identify the sender (Concept A specification §7, §10).

☐ Approve the recommendation  ☐ No image (text only)  ☐ Other: ______________________

## 6. Subject length — part of §§2–3

Only the job-title segment of a subject is limited: at most **120 grapheme clusters, including the ellipsis `…`**. The prefix (`Application received — ` / `New application — `) and the suffix (` | Valida`) are never shortened, and no character, accent or emoji is ever split (Concept A specification §6.2; test T-05).

☐ Approve

## 7. What remains — three separate lists

### 7.1 Remaining B6 approvals (owner)

1. AMD-TITAN-01, -03, -04 and -05 (checklist B6-1). §1 (AMD-TITAN-02) is **approved**.
2. The rest of the bounce procedure text — the English draft and the Persian version (B6-2). The cadence and the escalation timing (the same calendar day as discovery, including weekends and holidays) are **approved** and are not asked again.
3. The DEV-B6-04 text, with the SUP-1 amendment (B6-3).
4. §§2–4 and §6 of this sheet (B6-4) — **approved**.
5. The rest of the Concept A specification (B6-5). §5 (the logo) is **approved**; the derived file is approved separately, in Stage 2.

### 7.2 Stage 2 authorisation — a separate, explicit instruction

- **Preconditions:** item 4 of §7.1 is approved; item 5 (the rest of the specification) is open. The full list is in the checklist §2a.
- **It would authorise only:** the b6-2 templates (both emails, HTML and plain text), the grapheme-safe subject rule, the approved timestamp format, the derived logo file (for owner approval before use) and its CID part in `compose()`, and tests T-01…T-12 written **and executed**, with regression of the affected suites ([`IMPLEMENTATION_PLANS_B6_TEMPLATES_B7_SUPPRESSION.md`](IMPLEMENTATION_PLANS_B6_TEMPLATES_B7_SUPPRESSION.md), Part A).
- **It would not authorise:** any live send, Stage 3, suppression, the budget, R3, the copy work, the body-discard fix, or any change to retry rules, recipients, sender, Reply-To or `APPLICATION_ACKNOWLEDGEMENT_ENABLED`.
- **Then:** the owner's Windows regression run (B6-7); Stage 3, separately authorised (B6-8); the evidence package and GPT review (B6-9); and only then the owner's B6 acceptance (B6-10).

### 7.3 Later B7 implementation decisions (after B6 acceptance and a separate B7 authorisation)

- **D2a — suppression:** the storage (Claude recommends a keyed HMAC; GPT's earlier HMAC recommendation was conditional on correcting the key lifecycle, and is not an approval or a review of the complete rev 5 design), the operator identifiers, the location of the protected key copy (**AWAITING INPUT**), and the key-material integrity verification (an **OPEN** requirement before B7 implementation approval — suppression design §4.5); then implementation and the G-SUP evidence (SUP-1…16, SUP-18…22).
- **D2b — acknowledgement budget:** adopt it or not; caps only after the plan's limits are verified.
- **D3 — R3** operator recovery.
- **D6a — automated-message copy**, and whether G-COPY becomes a canonical gate (AMD-COPY-01).
- **The body-discard issue** (OPEN; it blocks public deployment).

**Production prerequisites that are not B7 code:** a backup bounce monitor and the unexpected-absence procedure (UNRESOLVED); Titan's limits for the owner's plan (UNVERIFIED); D8, a production-only credential, and a staging identity (C6); D7, the Outlook delivery test; the `careers@` mailbox (Release E entry gate); retention (Doc 13 §187, AWAITING).

---

Decision recorded by: ______________________  Date: ____________  Decision ID (proposed): `OD-2026-__-__-__`
