# Owner Decision OD-2026-11-03-01 — the B6 bounce procedures approved; test configuration cleanup confirmed

| | |
| --- | --- |
| Decision ID | **OD-2026-11-03-01**, the next unused identifier. Earlier decisions and records (OD-2026-10-25-01 … OD-2026-11-02-03; OF-2026-10-27-01; OR-2026-11-01-01; OR-2026-11-03-01) are unchanged. |
| Date | **2026-11-03** (America/Vancouver) |
| Decided by | Saeed (owner), under Doc 00 §5 |
| Source | The owner's handoff "Complete the final B6 evidence reconciliation and prepare the B7 handoff" (message text; no byte copy held): "Owner confirmed test configuration cleanup and approved the corrected bounce procedures, including planned absence." |
| Status kept | **B6 NOT ACCEPTED** until GPT's final recommendation and the owner's explicit acceptance. G-SUP **CLOSED**. G-COPY **PROPOSED**. B7 body-discard issue **OPEN**. Real vacancy **DRAFT**. |

## 1. What is approved

| Item | Approved text | SHA-256 of the approved version (r11) |
| --- | --- | --- |
| English bounce procedure, complete | `docs/operations/B6_BOUNCE_PROCEDURE_DRAFT.md` as packaged in r11 | `d0b472a10de584a807fb916914d0cf216adbd259da5697ca8c0427afdc071830` |
| Persian bounce procedure, complete | `docs/operations/BOUNCE_PROCEDURE_FA.md` as packaged in r11 | `b7b8120dd6904d74c6cfd708d8d96d097ac8228ff503bad588ba7b747390596d` |

The approval covers the whole of both texts, including **planned absence** (decision-sheet item 5; English §2 "Backup", Persian §9) and the corrected **24-hour manual review** of uncertain outcomes (OD-2026-11-02-03 §5). Where the approved texts still label a part PROPOSED, that label is superseded by this decision. **B6-2 is closed.**

After approval, each file received only a status title and one "Approval" row that cite this decision; the approved wording below them is byte-for-byte the r11 text.

## 2. What stays open — not changed by this approval

| Item | Status | Gate |
| --- | --- | --- |
| Backup monitor (decision-sheet item 6) | **UNASSIGNED** | Production prerequisite — before production candidate acknowledgements |
| Unexpected absence (item 7) | **UNRESOLVED** | Same |
| Bounce-log location (item 4) | OneDrive Personal, **CONDITIONAL** on private access, MFA, data protection and ownership (OD-2026-11-02-03) | Before the first log entry |

## 3. Confirmation recorded

| | |
| --- | --- |
| Test configuration cleanup after R1 (README step 6) | **OWNER-REPORTED: done** — closes item E11 of OR-2026-11-03-01 together with the revoked test credential (r11) |
