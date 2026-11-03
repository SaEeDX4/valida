# Owner Decision OD-2026-10-26-03 — B6 Stage 2 authorisation (templates, sandbox test environment)

| | |
| --- | --- |
| Decision ID | **OD-2026-10-26-03**, the next unused identifier. **OD-2026-10-26-01 and OD-2026-10-26-02 are preserved unchanged**, including the six approvals of OD-2026-10-26-02. |
| Date | **2026-10-26** (America/Vancouver), owner's message at 14:16 |
| Decided by | Saeed (owner), under Doc 00 §5 and Doc 18 §364 |
| Source | The owner's instruction, received as `ded4d113-attachment.txt` (SHA-256 `ec3800335fad21603ca0c7120469050898c468d86a8a7fabffb210996fe27b0b`), which begins "Continue Valida from the recovered B6 r9 + rev6 working copy." and states "I explicitly AUTHORISE Stage 2 and preparation of its test environment in your sandbox, within the scope below." |
| Supersedes | The "DRAFT ONLY / Stage 2 not authorised" status of Part II of the 2026-10-26 owner record (OD-2026-10-26-02 §6). Nothing else is superseded. |
| Status | **B6 NOT ACCEPTED.** G-SUP **CLOSED**. G-COPY **PROPOSED, NOT APPROVED**. B7 not started; the body-discard issue is **OPEN**. The real vacancy is **DRAFT**. All independent security, privacy and QA requirements remain intact. Stage 2 implementation is not B6 acceptance. |

## 1. Decisions

| # | Decision | Limits |
| --- | --- | --- |
| 1 | **Stage 2 AUTHORISED**: both Concept A emails (candidate acknowledgement and internal HR notification), template version `b6-2`, in `backend/src/integrations/notifications/templates.js`, with the exact copy of OD-2026-10-26-02; grapheme-safe subject-title truncation; the UTC timestamp `Received (UTC): YYYY-MM-DD HH:MM:SS`; preparation of the derived logo; focused tests, review fixtures and directly affected documentation | No change to website copy; no Concept B or C; no hosted assets, remote fonts, tracking, new links or new design direction |
| 2 | **Sandbox setup AUTHORISED**: install Node 24 and MongoDB in Claude's sandbox and run `npm ci` from the existing lockfile | Official distributions with available checksums; loopback-only test services; synthetic data; no production databases, Titan accounts or real credentials; no added or upgraded dependency, no lockfile change, no `npm audit fix`, no engine change; report the actual versions; if blocked, report the precise limitation and continue — Node 22 results never satisfy Node 24 acceptance |
| 3 | **The remaining Concept A specification is to be implemented as proposed, for review.** This resolves checklist S2-2 **for implementation purposes** | It does **not** declare client rendering verified and grants **no** final production approval |
| 4 | **Derived-logo approval checkpoint**: the specific derived asset needs the owner's own approval **before** it is integrated into the templates and the MIME output | Approval of the source logo, or of Stage 2, is not approval of the derived bytes |

## 2. Behaviour that must remain unchanged

From, Reply-To, recipients and routing; Message-ID generation, `Auto-Submitted` and the DSN parameters; Application acceptance and persistence; notification eligibility and `APPLICATION_ACKNOWLEDGEMENT_ENABLED`; claims, concurrency protection, retry rules and idempotency; readiness and provider-gate semantics.

**Out of scope:** suppression, acknowledgement budgets, R3 recovery, automated-message copying, the B7 body-discard fix, and starting B7.

## 3. Restrictions that remain

No real email sends. No production operations or account access. No DNS changes, purchases or provider migration. **No commits, pushes, merges or deployment, even if an automated workflow requests them.** No B7 implementation.

## 4. Not approved by this decision

- The derived logo bytes (pending: [`docs/qa/b6-stage2/logo/`](../qa/b6-stage2/logo/)).
- Email-client rendering (Stage 3, separately authorised; every untested cell stays NOT RUN).
- AMD-TITAN-01, -03, -04, -05; DEV-B6-04; the rest of the bounce procedure text; suppression (D2a details); the budget (D2b); R3; G-COPY.
- B6 acceptance.

## 5. Affected documents

| Document | Change |
| --- | --- |
| This record | New |
| `docs/review/B6_ACCEPTANCE_CHECKLIST.md` | S2-2…S2-6 statuses (S2-4 and S2-5 completed); Stage 2 progress; Stage 3 and later milestones kept separate |
| `docs/review/B6_DECISION_PACKAGE.md` | rev 7 |
| `docs/qa/b6-stage2/STAGE2_IMPLEMENTATION_REPORT.md` | New — the implementation report and evidence |
| OD-2026-10-26-01, OD-2026-10-26-02 | **Unchanged** |
