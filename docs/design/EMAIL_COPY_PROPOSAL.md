# Email copy — current (b6-1) versus proposed (Concept A)

| | |
| --- | --- |
| Status | **APPROVED** by the owner on 2026-10-26 (OD-2026-10-26-02): the subjects, preheaders, labels and wording of both emails, exactly as proposed below, and timestamp **Option 1**. **rev 7: implemented** in template version `b6-2`, exactly as approved ([OD-2026-10-26-03](../review/OWNER_DECISION_2026-10-26-03_B6_STAGE2_AUTHORISATION.md); recovered working copy, not committed; evidence in [`STAGE2_IMPLEMENTATION_REPORT.md`](../qa/b6-stage2/STAGE2_IMPLEMENTATION_REPORT.md)). The visual direction (Concept A) was approved by OD-2026-10-26-01. |
| Current text source | `backend/src/integrations/notifications/templates.js`, `TEMPLATE_VERSION = 'b6-1'` (read at baseline `ec15048`; unchanged) |
| Not changed | The website success screen (Doc 06 §§148–150; `frontend/src/pages/ApplyPage.content.js`). The proposed sentences are an **email-specific variant** only. Sender, Reply-To and recipient configuration are unchanged. |
| Change key | **=** unchanged · **R** reworded · **N** new · **D** removed · **F** format or element changed, words unchanged |
| Revision | **rev 5** (2026-10-26, after GPT's review of rev 4): §4 requirements 2 and 4 and §5 corrected — the privacy rule is stated per message and checked on decoded as well as raw output; subjects follow one grapheme-based length rule (Concept A specification §6.2). **The proposed words are unchanged.** |
| Revision | **rev 6** (2026-10-26): status recorded as **APPROVED** (OD-2026-10-26-02) — the header, the From row, the timestamp table and §3. The words are unchanged. |
| Revision | **rev 7** (2026-10-26): implementation status recorded in the header (OD-2026-10-26-03). The "Current (b6-1)" columns remain the record of the old text. The words are unchanged. |

## 1. Candidate acknowledgement — `APPLICATION_ACKNOWLEDGEMENT`

| Part | Current (b6-1, exact) | Proposed (exact) | Change | Approval location |
| --- | --- | --- | --- | --- |
| From | `Valida Careers <notifications@cybervalida.com>` | same | = | Identity: AMD-TITAN-02 (APPROVED, OD-2026-10-26-02) |
| Reply-To | `careers@cybervalida.com` | same | = | Doc 14 §203 (LOCKED; met) |
| Subject | `Application received: {job.title}` | `Application received — {job.title} \| Valida` | R — the colon becomes a spaced em dash; ` \| Valida` is added | D4; template record (decision package §6) |
| Preheader | — (none) | `Thank you for applying. Your application has been received.` | N | D4 |
| Header label | — | `CAREERS` | N (Concept A) | D4 |
| Eyebrow | — | `APPLICATION RECEIVED` | N in email; the same string as Doc 06 §148 | D4 (reuses §148) |
| Headline | `Thank you for applying.` (a bold paragraph in HTML) | `Thank you for applying.` (`h1`) | F | Doc 06 §149 — approved; text unchanged |
| Lead | `Your application for {job.title} has been received.` | `We’ve received your application for {job.title}.` | R | **New** Doc 06 email variant of §150 (AMD-COPY-EMAIL-01) + D4 |
| Next step | `If we need additional information or decide to continue the process with you, we will use the contact details included in your application.` | `If we need more information or decide to move forward, we’ll contact you using the details in your application.` | R — "additional" → "more"; "continue the process with you" → "move forward"; "we will use the contact details included in" → "we’ll contact you using the details in" | AMD-COPY-EMAIL-01 + D4 |
| Sign-off | `Valida Careers` | `Valida Careers` (footer line, after a hairline) | F | D4 |

**Plain text, proposed** (exact; `{…}` are placeholders):

```
Thank you for applying.

We’ve received your application for {job.title}.

If we need more information or decide to move forward, we’ll contact you using the details in your application.

Valida Careers
```

The plain text omits `CAREERS` and `APPLICATION RECEIVED`. They are presentational labels whose meaning is carried by the subject and the headline.

**Why the reworded sentences are acceptable** (for the owner's judgement):

- They still confirm **receipt only** (Doc 12 §§116–118; Doc 14 §113).
- The next step stays **conditional** ("If we need … or decide …").
- There is no promise of an interview, response time, selection, employment or immigration outcome (Doc 06 §153; Doc 12 §172).
- No candidate name or other personal detail is added.
- If the owner prefers the locked website sentences, Concept A works with them unchanged; that is a content choice, not a design change.

## 2. Internal notification — `APPLICATION_RECEIVED_INTERNAL`

The sender, Reply-To and recruitment recipient (`RECRUITMENT_NOTIFICATION_RECIPIENT`) are unchanged. **No routing change** is included.

| Part | Current (b6-1, exact) | Proposed (exact) | Change | Approval location |
| --- | --- | --- | --- | --- |
| Subject | `New application: {job.title}` | `New application — {job.title} \| Valida` | R | D4 |
| Preheader | — | `A new application is recorded in Valida. Candidate details remain private.` | N | D4 |
| Header label | — | `CAREERS` | N | D4 |
| Eyebrow | — | `RECRUITMENT / NEW APPLICATION` | N (Concept A) | D4 |
| Headline | `A new application was received for {job.title}.` | `A new application has arrived.` (`h1`) | R — the title moves to the Role row | AMD-COPY-EMAIL-02 + D4 |
| Lead | — | `The application is recorded in Valida.` | N | AMD-COPY-EMAIL-02 + D4 |
| Role | `Role: {job.title} ({job.slug})` | `Role: {job.title}` | R — split into two rows | D4 |
| Role identifier | (inside the Role line) | `Role identifier: {job.slug}` | N label; same value | D4 |
| Received | `Received: {submittedAt}`, value `YYYY-MM-DD HH:MM:SS UTC` | `Received (UTC): {submittedAt}`, value `YYYY-MM-DD HH:MM:SS` | R + F — see the timestamp choice below | D4 |
| Reference | `Application reference: {applicationId}` | `Application reference: {applicationId}` | = (label shown as a micro-label in HTML) | — |
| Privacy note | `The candidate details and the resume are stored privately in Valida and are not included in this email.` | `Candidate details and the resume are stored privately in Valida and are not included in this email.` | R — leading "The" removed | D4 |
| Footer | — | `Valida · Recruitment operations` | N | D4 |

**Timestamp — the meaning does not change:** the value is always an absolute UTC time, identical for every recipient (Doc 09 §188). Only the presentation is a choice:

| Option | HTML label → value | Plain text | Note |
| --- | --- | --- | --- |
| **1 — APPROVED** (OD-2026-10-26-02) | `RECEIVED (UTC)` → `2026-10-26 15:42:00` | `Received (UTC): 2026-10-26 15:42:00` | "UTC" moves from the value into the label. The value stays sortable and locale-neutral. A small formatter change, covered by tests. |
| 2 | `RECEIVED (UTC)` → `2026-10-26 15:42:00 UTC` | `Received (UTC): 2026-10-26 15:42:00 UTC` | Formatter unchanged; "UTC" appears twice |
| 3 (board) | `RECEIVED (UTC)` → `26 Oct 2026 · 15:42:00` | same | Matches the mockup; uses an English month name and is not sortable. **Not recommended.** |

**Plain text, proposed** (Option 1):

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

## 3. Canonical text — content APPROVED (OD-2026-10-26-02); recording in Doc 06 follows change control

> **AMD-COPY-EMAIL-01 — Doc 06, new §154A "APPLICATION ACKNOWLEDGEMENT EMAIL (email-specific variant of §§148–150)".**
>
> Subject: `Application received — {job.title} | Valida`.
> Preheader: `Thank you for applying. Your application has been received.`
> Eyebrow: `APPLICATION RECEIVED` (as §148).
> Headline: `Thank you for applying.` (as §149).
> Body: `We’ve received your application for {job.title}.` / `If we need more information or decide to move forward, we’ll contact you using the details in your application.`
> Sign-off: `Valida Careers`.
>
> The website success copy (§§148–152) is unchanged. §153 applies to this email.

> **AMD-COPY-EMAIL-02 — Doc 06, new §154B "INTERNAL APPLICATION NOTIFICATION EMAIL".**
>
> Subject: `New application — {job.title} | Valida`.
> Preheader: `A new application is recorded in Valida. Candidate details remain private.`
> Eyebrow: `RECRUITMENT / NEW APPLICATION`.
> Headline: `A new application has arrived.`
> Body: `The application is recorded in Valida.`
> Metadata: `Role`, `Role identifier`, `Received (UTC)` (absolute UTC, `YYYY-MM-DD HH:MM:SS`), `Application reference`.
> Note: `Candidate details and the resume are stored privately in Valida and are not included in this email.`
> Footer: `Valida · Recruitment operations`.
>
> No candidate personal data appears in any part of the message (Doc 09 §§189–190; Doc 14 §115).

The section numbers 154A / 154B avoid renumbering Doc 06; the owner may choose another location. Doc 14 §141 needs no text change: the templates stay in controlled backend code.

## 4. Shared copy requirements (Stage 2 implementation and tests)

| # | Requirement |
| --- | --- |
| 1 | No interview, response-time, selection, employment or immigration promise (Doc 06 §153; Doc 12 §172) |
| 2 | **Candidate personal data — a separate rule for each message (rev 5).** **Internal notification:** no candidate personal data at all — no applicant name, email address, phone, postal address, message, answers, resume filename, resume file or resume link — in any header field (`Subject`, `To`, `From`, `Reply-To`, `Message-ID` or any other), the preheader, `<title>`, alt text, any MIME part, MIME filename, Content-ID or other generated field. **Candidate acknowledgement:** the candidate's email address appears only where addressing requires it — the `To` header, with no display name built from candidate data, and the SMTP envelope recipient (plus an ORCPT parameter naming that same recipient, if the adapter sets one). The address appears nowhere else, and no other candidate data appears anywhere. |
| 3 | Dynamic values come only from the accepted Application and its Job record, and are safely encoded: HTML-escaped after control-character removal, controls stripped in plain text, single-line in headers |
| 4 | Subjects stay single-line and follow **one length rule** (Concept A specification §6.2): only the job-title segment is limited, to **120 grapheme clusters including the ellipsis**; the fixed prefix and the ` \| Valida` suffix are never shortened; a cut never splits a grapheme cluster. This is a Stage 2 fix: today's `headerText()` slices UTF-16 code units. |
| 5 | HTML and plain text convey the same information, except purely presentational labels (§1) |
| 6 | No test-vacancy label is hard-coded in any template. The synthetic title "QA SMOKE TEST ROLE …" comes only from the opt-in live test's synthetic Job. |
| 7 | One sign-off or footer line per message; no duplicate closing text |
| 8 | Synthetic examples in review material are labelled as such **outside** the email content (the board's header does this: "Synthetic role / reference") |
| 9 | Curly apostrophes (`’`) and the em dash (`—`) are UTF-8 in the body and RFC 2047-encoded in subjects by the mail library. Stage 2 tests check both. |

## 5. Privacy verification for the new templates

D5 accepted the b6-1 evidence only. **Both** redesigned messages need their own checks, and the rule differs by message (§4, requirement 2). *(Corrected in rev 5: rev 4 required that no marker appear anywhere in either message, which the acknowledgement cannot meet, because its `To` header must carry the candidate's address.)*

**Automated (Stage 2, test T-07):**

- **Fixture.** A synthetic Application whose name, email address, phone, message, answers and resume filename each carry a unique marker, in an ASCII form and in a non-ASCII form, so that the mail library has to encode them. The address marker is searched for both as the whole address and as its local part alone.
- **What is inspected — raw and decoded:**
  - the raw bytes of each composed message, and the SMTP envelope (`MAIL FROM`, `RCPT TO` and any DSN parameters) captured by the local SMTP test server;
  - **every header**, unfolded and decoded (RFC 2047 encoded words);
  - **every MIME part**: its headers — including `filename` and `name` parameters (RFC 2231) and `Content-ID` — and its body after transfer decoding (quoted-printable, base64) and charset decoding; in the HTML part, also after decoding character references (`&#…;` and named entities);
  - matching is case-insensitive.

  The raw bytes alone are not enough: quoted-printable, base64 or an encoded word can hide a value.
- **Internal notification — pass condition:** zero occurrences of any candidate marker anywhere, raw or decoded, envelope included.
- **Candidate acknowledgement — pass condition:** the candidate's address occurs only as the `To` address and as the envelope recipient (and in an ORCPT parameter naming that recipient, if one is set). No display name is built from candidate data. Every other marker, and the address in any other place, has zero occurrences, raw or decoded.
- **Structure:** the only parts are text, HTML and, if approved, the logo (T-08).
- **Tooling:** decoding uses Node built-ins and a small test helper. A MIME-parsing library (for example `mailparser`) would be a new devDependency and needs the owner's approval first; it is not assumed.

**Manual (Stage 3, only if a live send is separately authorised):** inspect one received internal notification's visible body, headers and MIME parts, with provenance recorded as for EV-A10. **Not authorised now.**

## 6. Synthetic example (review material only — not email content)

**SYNTHETIC EXAMPLE — not real data:**

- Role `Cybersecurity Specialist`;
- identifier `cybersecurity-specialist`;
- received `2026-10-26 15:42:00`;
- reference `0123456789abcdef01234567`.

These are the board's fictional fixture values. The real vacancy stays **DRAFT**.
