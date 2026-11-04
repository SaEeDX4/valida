# Implementation plans — Stage 2 (B6 template revision) and Stage 4 (B7 suppression)

| | |
| --- | --- |
| Status | **rev 7:** Part A (Stage 2) is **AUTHORISED** ([OD-2026-10-26-03](OWNER_DECISION_2026-10-26-03_B6_STAGE2_AUTHORISATION.md)) and **implemented**; **rev 8:** the derived logo is approved and integrated ([OD-2026-10-27-01](OWNER_DECISION_2026-10-27-01_B6_LOGO_ASSET.md)). **Parts B and C remain plans only and are not authorised**; each needs owner approval of its inputs **and** a separate, explicit implementation instruction. |
| Separation | The changes are **never bundled** with each other, nor with R3, the message-copy work or the B7 body-discard fix. The optional acknowledgement budget (Part C) is a separate change from suppression (Part B). |
| Revision | **rev 5** (2026-10-26, after GPT's review of rev 4): A.2 and T-05 follow the single grapheme-based subject rule; T-07 states the privacy rule per message and inspects decoded as well as raw output; Part B follows the fail-closed key lifecycle, and the budget left its scope; new Part C. |
| Revision | **rev 6** (2026-10-26): the A.1 precondition statuses after OD-2026-10-26-02; B.1 gains the OPEN key-material requirement. The plans are otherwise unchanged. A Stage 2 instruction exists only as a draft and authorises nothing. |
| Revision | **rev 7** (2026-10-26): Stage 2 authorised and executed — the Status row and A.1 statuses. Results: [`STAGE2_IMPLEMENTATION_REPORT.md`](../qa/b6-stage2/STAGE2_IMPLEMENTATION_REPORT.md). The plans are otherwise unchanged. |

## Part A — Stage 2: B6 template revision (Concept A)

### A.1 Preconditions

1. The owner approves the copy ([`EMAIL_COPY_PROPOSAL.md`](../design/EMAIL_COPY_PROPOSAL.md)), including the timestamp option. — **Done:** the copy and timestamp Option 1 are APPROVED (OD-2026-10-26-02).
2. The owner approves the specification and the logo delivery ([`EMAIL_CONCEPT_A_SPEC.md`](../design/EMAIL_CONCEPT_A_SPEC.md)). — **Done for implementation purposes:** the dark logo inline (CID) and the subject rule are APPROVED; the rest of the specification is to be implemented as proposed, for review (OD-2026-10-26-03). The **derived logo file** is **APPROVED** (OD-2026-10-27-01).
3. An explicit instruction to implement Stage 2. — **Done:** OD-2026-10-26-03 (2026-10-26).
4. The baseline is checked first, and any newer work is preserved. — **Done:** recovered and verified (`ec15048` + r9 + rev 4 + rev 6; checklist §2a, S2-4). The sandbox environment is only partly available (S2-6): no MongoDB, and Node 24 without verified provenance.

### A.2 Scope

| In scope | Out of scope |
| --- | --- |
| Both renderers in `backend/src/integrations/notifications/templates.js` (Concept A HTML, plain text, `TEMPLATE_VERSION = 'b6-2'`) | Suppression, the acknowledgement budget, the copy worker, R3, the body-discard fix |
| Grapheme-safe subject truncation (`headerText`) by the rule of the Concept A specification §6.2 | Retry rules, claim logic, recipients, sender, Reply-To, eligibility, `APPLICATION_ACKNOWLEDGEMENT_ENABLED` |
| The timestamp format chosen by the owner | The website and its success copy |
| The derived logo `backend/src/integrations/notifications/assets/valida-logo-email-316x72.png` and its checksum file (option A only), produced from `valida-logo-horizontal-dark.png` by resampling only, compared side by side with the source, and approved by the owner before use | Any redrawn or recoloured logo; any hosted image URL |
| The CID related part in `smtpTransport.js` `compose()` (option A only); Message-ID, `Auto-Submitted`, DSN parameters, From and Reply-To unchanged | Any new dependency |
| Template, adapter and privacy tests; the backend README template section; the decision package §6 record | Live sends (separate authorisation) |

### A.3 Tests — written **and executed** in Stage 2

| # | Test |
| --- | --- |
| T-01 | The exact plain text of both emails (golden strings, synthetic values) |
| T-02 | HTML structure: `lang` and `dir`; exactly one `h1`; `role="presentation"` on every layout table; no `script`, `form`, `a`, `iframe`, `svg` or background image; the only `img` is the CID logo; no external URL (`http`, `//`, `url(`, `@import`); no CSS Grid, Flexbox, variables, `clamp` or animation |
| T-03 | HTML and plain text carry the same information, apart from the documented presentational labels |
| T-04 | Escaping: `&<>"'`, control characters and bidirectional controls in the title and slug; CR / LF header injection in the subject |
| T-05 | **Subject rule** (Concept A specification §6.2): titles of exactly 120 and 121 grapheme clusters (the first unchanged; the second becomes 119 clusters + `…`); trailing white space at the cut removed before `…`; at the cut, in turn, an emoji ZWJ sequence, a regional-indicator flag, a skin-tone modifier sequence, a keycap sequence, a letter with combining marks and an astral character — none is split; the prefix and the ` \| Valida` suffix always intact; the result well-formed (`isWellFormed()`, no lone surrogate); the composed `Subject` header, decoded, equals the expected string exactly; the HTML `<title>` equals the subject; the body shows the full title. The Node, ICU and Unicode versions are recorded. |
| T-06 | Long values: a 160-character title and a 120-character slug get the wrapping styles; no width over 600 px; no fixed text heights |
| T-07 | **Privacy, per message** (copy proposal §4 requirement 2 and §5): a synthetic Application with unique ASCII and non-ASCII markers in the name, email address, phone, message, answers and resume filename. Inspected: the raw bytes, the SMTP envelope, every unfolded and decoded header, and every MIME part after transfer, charset and (HTML) character-reference decoding, including filenames and Content-IDs. **Internal notification:** zero occurrences of any marker anywhere. **Acknowledgement:** the address only as the `To` address and the envelope recipient (and ORCPT, if set), with no display name from candidate data; nothing else anywhere. No new devDependency without the owner's approval. |
| T-08 | MIME tree as specified; the logo's bytes equal the approved asset (SHA-256); constant filename and Content-ID; no other parts; HTML ≤ 20 KB; the whole message ≤ 40 KB |
| T-09 | The composed headers are unchanged where they must be: Message-ID token, `Auto-Submitted`, From, Reply-To; the DSN parameters (existing adapter tests) |
| T-10 | Timestamp: the approved format; always UTC, whatever the process time zone (run under different `TZ` values) |
| T-11 | UTF-8: `’` and `—` round-trip in the body (quoted-printable) and in the subject (RFC 2047) |
| T-12 | No test-vacancy label in any template |
| Regression | The notification unit and database suites, the adapter tests against the local SMTP test server, `verify:b6` and lint. The live smoke script is not changed and not run. |

**Evidence:**

- sandbox outputs;
- the owner's Windows + MongoDB run;
- hashes of `templates.js` and the asset;
- generated `.html` and `.eml` previews, labelled "**preview — not mail-client evidence**".

### A.4 Stage 3 — review and rendering (separately authorised)

> **rev 9 (2026-10-27):** the executable plan for this matrix — local EML inspection kept apart from delivered tests, clients, checks, evidence and unavailable coverage — is [`STAGE3_EMAIL_CLIENT_VERIFICATION_PLAN.md`](../qa/b6-stage3/STAGE3_EMAIL_CLIENT_VERIFICATION_PLAN.md). NOT AUTHORISED, NOT RUN.

**Matrix:**

- Gmail web and mobile;
- supported Outlook Classic on Windows;
- Outlook Web;
- Apple Mail on macOS and iOS;
- light and dark modes;
- images on and off;
- 320, 390 and 600 px;
- long titles and identifiers;
- 200 % text;
- reading order;
- the plain-text part.

**Each cell records:** client and version, OS, date, the template hash and screenshot provenance.

**Ways to test, and what each needs:**

| Way | Clients | What is needed |
| --- | --- | --- |
| Open a locally generated `.eml` with synthetic data — **no email is sent** | Outlook Classic and Apple Mail can open `.eml` files | Owner time |
| Live send to the owner's own test mailboxes | Gmail and Outlook Web | **Separate live-email authorisation** |

Any cell not run stays **NOT RUN**, and the owner decides on each documented limitation. **No paid rendering service is assumed.**

## Part B — Stage 4: B7 minimal suppression

### B.1 Preconditions

**Status at B7 start (2026-11-04, OD-2026-11-04-01):** 1 and 2 are **met**. 3 is **pending** (the design details remain PROPOSED; the SUP-1 amendment is APPROVED, OD-2026-11-02-03; the key-copy location is AWAITING INPUT). 4 is **pending** (owner action; Claude never sees the key). 5 is **designed, PROPOSED** (design rev 8: §4.5.1, SUP-22a–g; with controlled recovery §4.2, SUP-23a–f), awaiting approval — consolidated in `docs/review/B7_SUPPRESSION_DECISION_PROPOSAL.md`. Implementation of the B.2 scope therefore has **not** started; only the production start-up refusal of acknowledgements was added, which keeps G-SUP closed.

1. B6 is accepted.
2. B7 is authorised separately.
3. The owner approves the design details ([`RECIPIENT_SUPPRESSION_DESIGN.md`](../architecture/RECIPIENT_SUPPRESSION_DESIGN.md)):
   - the storage choice (keyed HMAC recommended);
   - the fail-closed key lifecycle (rev 5);
   - the SUP-1 amendment;
   - the operator identifiers;
   - the location of the protected second copy of the key (**AWAITING INPUT**).
4. The owner places the HMAC key in the host secret store, and its protected copy where decided; Claude never sees it.
5. The OPEN key-material integrity requirement ([`RECIPIENT_SUPPRESSION_DESIGN.md`](../architecture/RECIPIENT_SUPPRESSION_DESIGN.md) §4.5) is designed, and its tests (SUP-22) specified, before B7 implementation approval.

### B.2 Scope

| File | Change |
| --- | --- |
| `backend/src/models/RecipientSuppression.js` (new) | The register schema, bounds, validation and indexes |
| `backend/src/models/Application.js` | The channel field `lastStatusCode` (validated pattern) |
| `backend/src/integrations/notifications/smtpTransport.js`, `notificationService.js` | Return the enhanced status; the new codes and classes (`RECIPIENT_SUPPRESSED`, `SUPPRESSION_CHECK_UNAVAILABLE`, `SUPPRESSION_COVERAGE_INCOMPLETE`) |
| `backend/src/modules/applications/application.notifications.js` | The coverage check and the bounded lookup for the acknowledgement channel, after the claim |
| `backend/src/config/env.js`, `backend/.env.example` | The suppression variables (secret-safe validation; refusal in production when acknowledgements are enabled without a key) |
| `backend/scripts/ops-notifications-suppression.mjs` (new) and a `package.json` script entry | `list`, `check`, `coverage`, `add`, `lift`, `forget`, `rekey`, `resolve-unrecoverable`; dry run by default |
| Tests | SUP-1…16 and SUP-18…21 (SUP-17 withdrawn), plus regression of the r9 notification suites and the log scans |
| Documentation | Backend README; the proposed Doc 10 / 13 / 14 / 15 / 17 amendments; the bounce procedures; the decision package |

**Out of scope:** the acknowledgement budget (Part C), webhooks, automatic DSN parsing, a provider change, any UI, a paid validator, R3, the copy worker and the body-discard fix (a separate B7 item).

### B.3 Evidence

- Executed SUP-1…16 and SUP-18…21 against a MongoDB replica set and the local SMTP test server (submission counts asserted);
- the owner's Windows run;
- one live DSN processed end to end, only if separately authorised, against a non-production database.

G-SUP is closed until this evidence is reviewed and accepted.

## Part C — optional acknowledgement budget (D2b; only if the owner adopts it)

**Preconditions:**

1. B6 is accepted, and B7 is authorised separately.
2. The owner adopts D2b ([`ACKNOWLEDGEMENT_BUDGET_PROPOSAL.md`](../architecture/ACKNOWLEDGEMENT_BUDGET_PROPOSAL.md)) and records the caps with the evidence behind them, after the plan's limits are verified.
3. An explicit instruction for this change, which is reviewed on its own. It may follow the suppression change; it is not a G-SUP criterion.

**Scope:** a `notification_budgets` model and its setup step; the reservation in `application.notifications.js`, after the suppression lookup and before SMTP; the codes `ACKNOWLEDGEMENT_BUDGET_EXCEEDED` and `ACKNOWLEDGEMENT_BUDGET_UNAVAILABLE`; validation of the three cap variables; tests BUD-1…BUD-10; the documentation.

**Evidence:** BUD-1…BUD-10 executed against a MongoDB replica set and the local SMTP test server, with several concurrent processes for BUD-1.
