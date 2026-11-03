# B6 — what remains (as of r11, 2026-11-03)

| | |
| --- | --- |
| Purpose | The short list of what still stands between `b6-3` and B6 acceptance. The full reconciliation is [`B6_FINAL_REVIEW_PACKAGE.md`](B6_FINAL_REVIEW_PACKAGE.md) (r11; it supersedes the r10 package). |
| Changes since r10 | Owner confirmations: no bounce in `notifications@` at the time of the check; test credential revoked; configuration cleanup **not** confirmed. GPT reviewed the pasted run JSON contents (recorded as pasted copies). Corrections: the 24-hour item is a manual review, not a permission to re-send; R1 = three mailboxes, four messages, sender `notifications@cybervalida.com`, cross-provider assignment; Outlook classic and Outlook on the web evidence kept apart; C9 / C10 accepted owner reports; sanitized publication copies; Git state stated exactly. No code or test change; no test rerun; no email; nothing pushed. |
| Not reopened | Every settled approval; F-03 cosmetic design |
| Status kept | **B6 NOT ACCEPTED.** G-SUP **CLOSED**. G-COPY **PROPOSED**. B7 body-discard issue **OPEN**. Real vacancy **DRAFT**. No further live email is authorised. |

## A. Unresolved — only these

| # | Kind | Item | Who |
| --- | --- | --- | --- |
| **O1** | Mandatory confirmation | Configuration cleanup in the owner test workspace (README step 6) | Owner |
| **O2** | Owner decision | B6-2: item 5 and the complete English and Persian bounce procedures (r11) | Owner |
| **O3** | Owner decision | Stage 3 cells without evidence, and the R1 role-isolation limit, accepted as documented limitations (final package §5) | Owner |
| **O4** | Review and acceptance | GPT's final recommendation; explicit B6 acceptance; authorisation to push `b6-work` | GPT; owner |

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
