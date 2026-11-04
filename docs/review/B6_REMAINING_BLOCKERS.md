# B6 — what remains (as of r12, 2026-11-03)

| | |
| --- | --- |
| Purpose | The short list. The final checklist with the Stage 3 reconciliation is [`B6_ACCEPTANCE_CHECKLIST.md`](B6_ACCEPTANCE_CHECKLIST.md) §0; the package is [`B6_FINAL_REVIEW_PACKAGE.md`](B6_FINAL_REVIEW_PACKAGE.md) (r12). |
| Changes since r11 | B6-2 **approved** and the test configuration cleanup **confirmed** (OD-2026-11-03-01). Evidence provenance corrected: received Outlook screenshots = Outlook classic (B-OC); Gmail web rendering screenshots for both messages; GPT's inspection of the received Gmail acknowledgement; the approved R1 assignment recorded as fact. No code or test change; no test rerun; no email; nothing pushed. |
| Status kept | **B6 NOT ACCEPTED.** G-SUP **CLOSED**. G-COPY **PROPOSED**. B7 body-discard issue **OPEN**. Real vacancy **DRAFT**. No further live email is authorised. |

## A. Unresolved — only these

| # | Kind | Item |
| --- | --- | --- |
| **Q1** | GPT confirmation | INT template in Outlook classic, dark mode, on `b6-3` |
| **Q2** | GPT confirmation | Received-header values: the acknowledgement's `To` display name; `Reply-To`; `Auto-Submitted` |
| **L1–L5** | Owner decisions, one cell or check each | C3 images off; C8 text-only resizing in Outlook classic; Outlook on the web; device availability (Apple Mail macOS and iOS, Gmail iOS, 320 px phone); R1 role isolation |
| **RV** | Review and acceptance | GPT's final recommendation; explicit B6 acceptance; authorisation to push `b6-work` |

## B. Live email

R1 is complete. No further send, reply test or bounce test is authorised or needed for B6.

## C. Non-blocking improvements (unchanged)

| Item | Note |
| --- | --- |
| F-02 — blank area beside the message on the wide monitor | Separate; cause unproven; optional decision D-5 |
| ACK contrast on its own pixels; the LONG footer's pixels | Derived from measured identical colour pairs |
| A scrolled-fully-right 200 % screenshot | Would turn owner-reported reachability (D-6) into screenshot evidence |
| Canonical document consolidation | The approved amendments (AMD-TITAN-01…05, AMD-COPY-EMAIL-01/02, the D-6 qualification) into the next revision of Doc 14, Doc 06 and the email specification |
| Housekeeping | The masthead's top 3 px in Outlook; the alt-text position in browsers with images off; stale "b6-2" comments in `verify-b6.mjs` and two tests; the never-executed Windows test `storage-link-confinement.test.js:326`; a compiled copy of the bounce procedure in `B6_REMAINING_OWNER_APPROVALS.md` keeps a relative link that only resolves from `docs/operations/` |

## D. Production prerequisites

Final package §4 (P1–P10): Microsoft inbox placement (Outlook.com Junk, SCL 6, cause unknown); G-SUP suppression (B7); backup monitor and unexpected absence; the OneDrive Personal conditions before the first log entry; Titan limits; a non-production sending identity; production credential, staging identity and backups (C6); the B7 body-discard issue; G-COPY (only if approved); retention, monthly email backup, `careers@`, the real vacancy, canonical consolidation.
