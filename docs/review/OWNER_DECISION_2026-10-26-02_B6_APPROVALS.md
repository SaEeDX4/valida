# Owner Decision OD-2026-10-26-02 — B6: six approvals (identity, copy, timestamp, logo, subject rule, monitoring)

| | |
| --- | --- |
| Decision ID | **OD-2026-10-26-02** — the next unused identifier. It maps the owner's record reference `VALIDA03-2026-10-26-SIX-APPROVALS`. **OD-2026-10-26-01 is not overwritten.** |
| Date | **2026-10-26** (America/Vancouver) |
| Decided by | Saeed (owner), under Doc 00 §5 (change control) and Doc 18 §364 (change control after baseline) |
| Source | Part I of the owner's record `Valida_B6_Owner_Approvals_and_Stage2_Draft_2026-10-26.md` (received as `0e7301de-…`, SHA-256 `39c4f1adee6879e147d23a1915735ade57be557d4cb45c51f5a6883cf69bcc27`). Part I cites the owner's explicit message in VALIDA 03 on 2026-10-26 beginning "I officially approve all six recommended choices from your latest rev5 review", and states that this is direct owner approval, not an inference from GPT's recommendations. On 2026-10-26 at 13:35 the owner instructed Claude to integrate Part I. Claude did not see the VALIDA 03 message itself. |
| Type | **Addendum.** It supplements decision package rev 5 and OD-2026-10-26-01, and overwrites neither. Where it changes a status recorded there, those documents now point here. |
| Scope rule | **Only the six choices in §1 are approved.** Every other item keeps its recorded status (§3). |
| Status | **B6 NOT ACCEPTED.** G-SUP **CLOSED**. G-COPY **PROPOSED, NOT APPROVED**. B7 not started; the body-discard issue is **OPEN**. The real vacancy is **DRAFT**. D5 stays closed only for its historical, limited evidence. Titan / Bluehost and the Outlook Classic monthly offline backups remain the approved directions. All independent security, privacy, QA and production gates remain intact. |

## 1. Decisions

| # | Item | Decision | What stays open |
| --- | --- | --- | --- |
| 1 | **D1 — sender identity** | **APPROVED:** the permanent automated sender `notifications@cybervalida.com` under **AMD-TITAN-02** (text: [`B6_TITAN_AMENDMENTS.md`](B6_TITAN_AMENDMENTS.md) §2; approval sheet §1), subject to the applicable authentication, security and access-separation requirements. Reply-To remains `careers@cybervalida.com`. | AMD-TITAN-01, -03, -04 and -05 stay **PROPOSED**. AMD-TITAN-02 amends the LOCKED Doc 14 §202 and MAIL-036; recording it in the canonical document follows change control (Doc 00 §5). D3 verification and the D7 Outlook test are not waived. |
| 2 | **D4 — copy** | **APPROVED:** the subjects, preheaders, header labels, eyebrows and wording of both Concept A emails, exactly as in §2 (identical to approval sheet §§2–3 and copy proposal §§1–2). The email-specific copy variants — the content of AMD-COPY-EMAIL-01 and -02 — are approved. The website success copy is unchanged. | Recording in Doc 06 (proposed §154A / §154B) follows change control. Not implemented: Stage 2 is not authorised. |
| 3 | **D4 — timestamp** | **APPROVED:** Option 1, `Received (UTC): YYYY-MM-DD HH:MM:SS`. The value is UTC whatever the process or recipient time zone. | Implementation and test T-10: Stage 2 |
| 4 | **D4 — logo** | **APPROVED:** the official dark horizontal Valida logo, delivered inline as a CID image. No crop, redraw or recolouring. | The **derived file** (316 × 72, resampled only) is not yet produced; its bytes, hash and side-by-side comparison need their own owner approval in Stage 2. Email-client testing is Stage 3. |
| 5 | **D4 — subject rule** | **APPROVED:** the title segment has at most 120 extended grapheme clusters, the ellipsis included; the subject prefix and suffix are preserved; a longer title keeps 119 clusters, has trailing white space trimmed and gets `…`; the body keeps the full title (Concept A specification §6.2). | Implementation and test T-05: Stage 2 |
| 6 | **D2 — operations** | **APPROVED:** Saeed monitors `notifications@` every calendar day, 365 days a year, including weekends and holidays. Escalation happens on the **same calendar day the delivery problem is discovered**, including weekends and holidays. | The backup monitor and unexpected-absence coverage stay **UNRESOLVED**. The rest of the bounce procedure text stays **PROPOSED**. |

## 2. Exact approved copy

Reproduced verbatim from Part I of the source record. Byte comparison: both plain-text bodies are identical to the rev 5 copy proposal.

### 2.1 Candidate acknowledgement — `APPLICATION_ACKNOWLEDGEMENT`

Subject: Application received — {job.title} | Valida

Preheader: Thank you for applying. Your application has been received.

Header label: CAREERS

Eyebrow: APPLICATION RECEIVED

Plain-text body (headline is also the HTML h1):

```text
Thank you for applying.

We’ve received your application for {job.title}.

If we need more information or decide to move forward, we’ll contact you using the details in your application.

Valida Careers
```

### 2.2 Internal notification — `APPLICATION_RECEIVED_INTERNAL`

Subject: New application — {job.title} | Valida

Preheader: A new application is recorded in Valida. Candidate details remain private.

Header label: CAREERS

Eyebrow: RECRUITMENT / NEW APPLICATION

Plain-text body (headline is also the HTML h1):

```text
A new application has arrived.

The application is recorded in Valida.

Role: {job.title}
Role identifier: {job.slug}
Received (UTC): {submittedAt}
Application reference: {applicationId}

Candidate details and the resume are stored privately in Valida and are not included in this email.

Valida · Recruitment operations
```

## 3. Not approved by this decision — status accuracy

| Item | Status |
| --- | --- |
| AMD-TITAN-01, -03, -04, -05 | **PROPOSED** |
| DEV-B6-04 text, with the SUP-1 amendment | **PROPOSED** |
| The Concept A specification as a whole (layout, colours, typography, spacing, dark mode, accessibility, MIME details) | **PROPOSED**, except the elements approved in §1: the subject rule (§6.2), the dark logo delivered inline as CID (§7.1 source choice, §7.2 option A) and the timestamp format |
| The derived logo bytes | Not yet produced; approval needed in Stage 2 |
| The suppression design (D2a details, including HMAC storage and the key lifecycle) | **PROPOSED**. G-SUP **CLOSED**. |
| The acknowledgement budget (D2b) | **PROPOSED** |
| The bounce procedure text beyond the cadence and the escalation timing | **PROPOSED**. Backup monitor and unexpected absence **UNRESOLVED**. |
| R3 (D3), the automated-message copy and G-COPY (D6a), D7, D8 | Unchanged |

## 4. Documentation corrections incorporated (decision package rev 6)

1. **Escalation timing.** "Same business day" is replaced throughout by "the same calendar day as discovery, including weekends and holidays": the English bounce procedure, its drills and the dependent summaries. The Persian equivalent is «همان روز تقویمیِ شناسایی مشکل، شامل آخر هفته و تعطیلات». HR receives only the Application reference, through an authorised restricted channel; no raw bounce or returned original is forwarded. The monitoring cadence was already approved and is not asked again.
2. **Suppression key material — an OPEN requirement for B7.** Matching key identifiers alone does not establish correct HMAC key material. Before B7 implementation approval, integrity verification must be defined, with tests for a correct key id with incorrect key bytes at restart, after a restore and during rotation. No acknowledgement may proceed while suppression coverage is unverified. Registered in the suppression design §4.5 and as SUP-22. This is **an open design and test requirement**: not an implemented safeguard, and not an approval of the suppression design.
3. **Approval attribution.** GPT's earlier HMAC recommendation was conditional on correcting the key lifecycle. It was not an approval, or a review, of the complete rev 5 design. The approval sheet wording that implied otherwise is corrected.
4. **Status accuracy.** Only the six choices above changed status (§3).

## 5. Authority boundary

**Effective now:** the six owner decisions and the documentation corrections above.

**NOT AUTHORISED:** Stage 2 execution; runtime, template, asset, test, schema or configuration changes; live emails; account access; installations; purchases; DNS changes; commits, pushes or merges; production deployment; starting B7.

## 6. Part II of the source — a Stage 2 instruction, DRAFT ONLY

The source record also contains Part II, "Claude Stage 2 instruction: DRAFT FOR OWNER REVIEW", marked **"DO NOT EXECUTE THIS DRAFT"**. It is kept as a **draft only**. Receiving or forwarding it authorises nothing. Stage 2 begins only after a separate, explicit owner instruction. The remaining Stage 2 prerequisites are listed in [`B6_ACCEPTANCE_CHECKLIST.md`](B6_ACCEPTANCE_CHECKLIST.md) §2a.

## 7. Affected documents (decision package rev 6)

| Document | Change |
| --- | --- |
| `docs/review/OWNER_DECISION_2026-10-26-02_B6_APPROVALS.md` | New — this record |
| `docs/review/OWNER_DECISION_2026-10-26_B6_EMAIL.md` | Header note: superseded in part by this record; affected status cells annotated. The original statuses are kept as the record of that date. |
| `docs/review/B6_DECISION_PACKAGE.md` | rev 6: §1, §2 (D1, D2, D2a, D4), §3 notes, the escalation wording in DEV-B6-04, §4 and §5.3, a §6 note, §7, §8 |
| `docs/review/B6_TITAN_AMENDMENTS.md` | AMD-TITAN-02 recorded as APPROVED (text unchanged); §1; the matrix rows it governs; AMD-TITAN-04 escalation wording |
| `docs/design/EMAIL_COPY_PROPOSAL.md` | Status: the copy and timestamp Option 1 APPROVED; §3 status |
| `docs/design/EMAIL_CONCEPT_A_SPEC.md` | Status: the subject rule and the CID dark logo APPROVED; the rest PROPOSED |
| `docs/operations/B6_BOUNCE_PROCEDURE_DRAFT.md`, `docs/operations/BOUNCE_PROCEDURE_FA.md` | Escalation timing approved; the calendar-day wording; "authorised restricted channel" |
| `docs/architecture/RECIPIENT_SUPPRESSION_DESIGN.md` | §2 escalation wording; §4.4 note; new §4.5 (OPEN key-material requirement); SUP-22 registered |
| `docs/review/B6_ACCEPTANCE_CHECKLIST.md` | B6-1, B6-2, B6-4 and B6-5 statuses; new §2a, the Stage 2 prerequisites; §3 key-material row |
| `docs/review/IMPLEMENTATION_PLANS_B6_TEMPLATES_B7_SUPPRESSION.md` | A.1 precondition statuses; B.1 key-material precondition |
| `docs/review/OWNER_APPROVAL_SHEET_B6_EMAIL.md` | Outcome recorded; §7 updated; the HMAC attribution corrected |
| Canonical Documents 00–18 | **Not edited.** The approved amendments are recorded in them through the owner's change-control process. |
