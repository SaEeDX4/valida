# Owner Decision OD-2026-11-02-01 — C2 masthead and P-04 colours approved; sandbox implementation authorised

| | |
| --- | --- |
| Decision ID | **OD-2026-11-02-01**, the next unused identifier. Earlier decisions (OD-2026-10-25-01, OD-2026-10-26-01, -02, -03, OD-2026-10-27-01), owner feedback OF-2026-10-27-01 and owner record OR-2026-11-01-01 are preserved unchanged. |
| Date | **2026-11-02**, the owner's instruction, preserved as `docs/qa/b6-stage3/evidence/EV-S3-OC3-outlook-classic-c2p04-mockups-1to1/owner-instruction-2026-11-02.txt` (SHA-256 `58aa8bb64e81feb2a94b478da455ecff026968a89fc7a9efb27786943977873b`) |
| Decided by | Saeed (owner), under Doc 00 §5 and Doc 18 §364 |
| Source text | "This message records my explicit approval and sandbox implementation authorization." — "These decisions are APPROVED, not merely preferences" |
| Status | **B6 NOT ACCEPTED.** G-SUP **CLOSED**. G-COPY **PROPOSED, NOT APPROVED**. The B7 body-discard issue **OPEN**. The real vacancy **DRAFT**. |

## 1. Decisions

| # | Decision | Limits |
| --- | --- | --- |
| 1 | **C2 is APPROVED for both emails** — Candidate Acknowledgement and Internal HR Notification | — |
| 2 | **The exact asset is APPROVED:** `docs/qa/b6-stage3/proposals/f01-logo/C2-masthead-1200x216.png`, SHA-256 `ac67a2cb7d447a55d89bb3264198743d4114190e259775535215acabba1aea3b` | Any other bytes are **not** approved. The image bytes may not be changed. |
| 3 | **Removal of the top HTML header label "CAREERS" from both emails is APPROVED** | Only that label. The footer and all other approved wording are preserved. |
| 4 | **P-04 is APPROVED:** metadata labels and footer `#B6C0CC`; the blue eyebrow / section heading `#83C6FF` | Applied consistently in both emails |
| 5 | **Sandbox implementation is AUTHORISED** in the actual runtime templates, MIME composition and assets where needed, and the relevant tests | Isolated sandbox only. Practical layout fixes within the approved design are allowed where needed for genuine accessibility or functional defects; desktop line lengths and the C2 appearance must be preserved. |

## 2. Must be preserved

Approved subjects, preheaders, body copy, UTC timestamp format, title-truncation rules, plain-text content, sender and reply routing, retry behaviour, privacy protections and security requirements; inline CID delivery without externally fetched images or tracking; asset-integrity, fail-closed behaviour with the new asset. The previous asset and evidence stay traceable; old evidence is not repurposed as evidence for the new build.

## 3. Not decided or authorised by this decision

- An F-03 exception: any exception needs a separate, explicit owner decision; F-03 is not closed by horizontal scrolling reaching the content.
- Final client or accessibility conformance; B6 acceptance (B6-10).
- Live email, mailbox or account access, commits, pushes, merges, deployment, DNS changes, purchases, B7 implementation.
- A change to G-COPY's status.

## 4. Supersedes, and what stays on record

| Earlier item | Effect |
| --- | --- |
| OD-2026-10-27-01 (the derived 316 × 72 dark logo, with its black field) | **Superseded for b6-3**: the asset is no longer used in the runtime. The record, its approval and its asset bytes (`docs/qa/b6-stage2/logo/valida-logo-email-316x72.candidate.png`, `b8c54174…341a`) stay on record as the history of b6-2. |
| OD-2026-10-26-02, approved copy | **Amended only by decision 3** (the header label `CAREERS`) |
| OR-2026-11-01-01 (C2 recorded as a preference, not an approval) | Now an approval, by decision 1 |
| OF-2026-10-27-01 | Unchanged; answered by decisions 1–2 |

## 5. Implementation record

[`docs/qa/b6-3/B6-3_IMPLEMENTATION_REPORT.md`](../qa/b6-3/B6-3_IMPLEMENTATION_REPORT.md) — template version `b6-3`.
