# Owner record OR-2026-11-01-01 — Stage 3 offline Outlook classic: authorisation scope, owner-reported checks and the C2 preference

| | |
| --- | --- |
| Record ID | **OR-2026-11-01-01** — a record of the owner's statements. It creates no new approval. |
| Date | **2026-11-01**, the owner's instruction, preserved as `docs/qa/b6-stage3/evidence/EV-S3-OC2-outlook-classic-c2p04-mockups/owner-instruction-2026-11-01.txt` (SHA-256 `52eec6506688656bd251699120f8f7f46e19596d180070a7d7b5e78ca6c3ede4`) |
| From | Saeed (owner) |
| Status kept | **B6 NOT ACCEPTED.** G-SUP **CLOSED**. G-COPY **PROPOSED, NOT APPROVED**. The B7 body-discard issue **OPEN**. The real vacancy **DRAFT**. |

## 1. Authorisation scope — correction

| | |
| --- | --- |
| Owner's statement | "I previously explicitly authorised Stage 3 offline EML inspection in Outlook Classic only. Calling these checks 'pre-authorisation' is incorrect. Record the offline Outlook work as partial, with observed results and outstanding checks. Do not mark the whole client matrix PASS. Online account access and live email remain unauthorised." |
| The original authorising message | **Not received here.** This record relies on the owner's statement; it does not reconstruct the original text or date. |
| What is authorised | Stage 3 **offline EML inspection in Outlook classic** — synthetic EML files opened locally, network disconnected (plan kind A1-OFFLINE-EML). |
| What is not authorised | Online account access (plan kind A2), live email (kind B), any other client or Stage 3 part, runtime or template changes, B7, commits, pushes, deployment, DNS changes, purchases. |
| Correction made | r4 documents called the owner's Outlook work "preliminary" / "pre-authorisation" and recorded every cell as NOT RUN. In r5 the cell **A1-OC** is recorded as **PARTIAL** on `b6-2`, with observed results and outstanding checks; the client matrix is **not** PASS. |

## 2. Owner-reported checks — OWNER-REPORTED, not independently verified

No screenshot or Zoom-dialog evidence was supplied for these.

| # | Owner's report | Recorded effect |
| --- | --- | --- |
| R-1 | Both C2+P04 mockups checked at **200 %**, in light and dark, from top to bottom; **no problems** | Recorded as owner-reported. It does **not** close F-03 (narrow-window overflow): the window width is not recorded, and the mockups keep the same fixed 600 px Outlook wrapper. |
| R-2 | The broad blank area on the right appears on the owner's **wide monitor** and **disappears on the normal monitor** | Supports an environment-dependent behaviour. **F-02 stays OPEN**; the exact cause is not established. |

## 3. Design preference — not an approval

| | |
| --- | --- |
| Owner's statement | "I like C2's appearance and want to proceed with its evaluation." |
| What it is | A **positive visual preference** for candidate C2 (masthead band) and an instruction to continue evaluating it. |
| What it is **not** | Approval of the exact replacement asset bytes (`C2-masthead-1200x216.png`, SHA-256 `ac67a2cb7d447a55d89bb3264198743d4114190e259775535215acabba1aea3b`); approval of removing the header label `CAREERS`; authorisation of runtime or production integration; an accessibility exception. Each stays a separate, explicit decision. |
| Previous records | OD-2026-10-27-01 and OF-2026-10-27-01 are **unchanged**. |

## 4. Affected documents

| Document | Change |
| --- | --- |
| This record | New |
| `docs/qa/b6-stage3/EV-S3-OC1_OUTLOOK_CLASSIC_OFFLINE_ADDENDUM.md` | Correction note; cell A1-OC PARTIAL; Part II (EV-S3-OC2) |
| `docs/qa/b6-stage3/F01-F04_FINDINGS_AND_PROPOSAL.md` | r5 status of F-01…F-04 |
| `docs/qa/b6-stage3/STAGE3_EMAIL_CLIENT_VERIFICATION_PLAN.md` (r4) | Authorisation status; cell A1-OC PARTIAL |
| `docs/review/B6_ACCEPTANCE_CHECKLIST.md`, `docs/review/B6_DECISION_PACKAGE.md` (rev 12) | Status |
| Every OD and OF record | **Unchanged** |
