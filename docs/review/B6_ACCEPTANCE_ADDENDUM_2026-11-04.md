# B6 acceptance addendum — OWNER ACCEPTED (2026-11-04)

| | |
| --- | --- |
| Decision ID | **OD-2026-11-04-01** — the owner's explicit acceptance of B6 r12, recorded by GPT after its independent review. This addendum records it; it changes no earlier record or evidence. |
| Source | The owner decision "Valida — B6 acceptance and authorized B7 execution" (2026-11-04), kept byte for byte in the private review archive, SHA-256 `fd87ab50233d1bf4d9f02e94e3ca9618a09231a3b015cd2ee2d35a71397319d0`. Not published (owner material, publication rule W3). |
| Accepted | **B6 r12 — OWNER ACCEPTED.** Reviewed history: `b6-work` at `6173eeae66206ce2dfa98408fcb53242ec434151`, parent `6da01e83958b3d886ca2518eb30382abcfde633d`, B5 baseline `ec15048980c9e3e8134de4b3d7eeadc89b1aef96`. |

## 1. States — kept separate

| State | Status |
| --- | --- |
| Accepted | **Yes** — OD-2026-11-04-01 |
| Published | `b6-work` pushed to `SaEeDX4/valida` with a normal push; remote head verified at `6173eea…4151` (2026-11-04) before this addendum was added on top as a separate documentation-only commit |
| Merged into `main` | **No** — not authorised |
| Deployed | **No** — not authorised |

## 2. Accepted testing limitations — NOT TESTED

The owner accepted these four limitations. They are coverage limitations — **not** PASS, not proven N/A, and not full accessibility compliance. No security, privacy or functional requirement is waived.

| # | Limitation | Record |
| --- | --- | --- |
| 1 | Outlook classic, embedded (CID) image blocking | **NOT TESTED** — not established. The message information does not depend on the logo (J8 S7; J6) |
| 2 | Outlook classic, text-only resizing to 200 % | **NOT TESTED** — availability not established. Whole-message zoom remains covered only by the separately approved deviation D-6 |
| 3 | Outlook on the web, both templates, and the LONG file check | **NOT TESTED** |
| 4 | Apple Mail on macOS and iOS, the Gmail iOS app, a 320-pixel-class phone | **NOT TESTED** |

Preserved unchanged: **D-6** (OD-2026-11-02-02) and the owner-controlled **R1 role-isolation limitation** ([OR-2026-11-03-01](OWNER_RECORD_2026-11-03_B6_R1_LIVE_RUNS.md) §3, §6.2).

## 3. The last two review items

| Item | Closed as | Evidence |
| --- | --- | --- |
| **Q1** — the internal (LONG) template in Outlook classic, dark mode, on `b6-3` | **OWNER-REPORTED** | [`EV-S3-OC1_OUTLOOK_CLASSIC_OFFLINE_ADDENDUM.md`](../qa/b6-stage3/EV-S3-OC1_OUTLOOK_CLASSIC_OFFLINE_ADDENDUM.md) §25: "Dark rendering satisfactory, including the bottom content" for the r6 / `b6-3` `SYNTHETIC-internal-long-values.eml` (owner-reported; no dark screenshot). **Correction:** checklist §0.2 row S4 said no report was held — §25 holds it |
| **Q2** — received-header values | **GPT-INSPECTED**, at the inspected scope only | The received Gmail originals of run A's internal notification and run B's acknowledgement carry `Reply-To: careers@cybervalida.com` and `Auto-Submitted: auto-generated`; the acknowledgement's `To` has an empty display name; its bodies hold no candidate name or address; its only attachment is the inline logo. Not extended to any original that was not inspected (the two Outlook.com messages) |

Client evidence stays what it is: the Gmail web screenshots are Gmail web evidence; the received-message screenshots in Outlook classic are Outlook classic evidence. Neither shows Outlook on the web (limitation 3).

## 4. Verification and confirmations recorded

- **GPT verification of r12:** all 13 entries of the r12 SHA256SUMS, the 413 files of the cumulative manifest, the 335 publication entries, the 14-path r12 commit delta and its parent; no executable change.
- **Run JSONs** (runs A `920d6396`, B `7e2ac970`): pasted copies reviewed by GPT, not byte-verified files — automated checks and cleanup passed; two submissions per run; replay added none.
- **Owner-reported:** all four messages received; no bounce at the time of the check; the temporary credential revoked; the test settings restored; the corrected English and Persian bounce procedures approved, including planned absence (OD-2026-11-03-01). **The daily bounce monitoring obligation continues.**

## 5. Unchanged

G-SUP **CLOSED** — production candidate acknowledgements stay disabled until suppression and its operational prerequisites pass. G-COPY **PROPOSED**. The body-discard issue **OPEN**, now in B7. The real vacancy **DRAFT**. No new live email is authorised. Private evidence stays in the review archive and is cited by hash; the public repository receives code, assets, tests and sanitized documentation only.

## 6. Authorised next

**B7 — Backend Security, Failure & QA Gate** (Doc 18 §§139–143), on branch `b7-work` from the published B6 head, including orphan reconciliation (owner's instruction) and the authorised parts of suppression. Not authorised: merging into `main`, B7 publication or merge, deployment, production configuration changes, new live email.
