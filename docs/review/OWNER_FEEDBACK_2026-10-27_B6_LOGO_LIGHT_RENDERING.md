# Owner feedback OF-2026-10-27-01 — the B6 email logo on a light message background

| | |
| --- | --- |
| Record ID | **OF-2026-10-27-01** — an owner-**feedback** record, not a decision. It approves, rejects or changes no runtime item by itself. Owner decisions keep their `OD-…` identifiers; none is created here. |
| Date | **2026-10-27**, the owner's instruction of 16:10 (America/Vancouver), preserved as `docs/qa/b6-stage3/evidence/EV-S3-OC1-outlook-classic-offline/owner-instruction-2026-10-27-1610.txt` (SHA-256 `7de0a8e512cba0324e6fa3cf696a37c70e22d54cfbee5832264ad85179671659`) |
| From | Saeed (owner) |
| Source text | "The owner explicitly rejects the isolated black rectangle around the white Valida logo when Outlook displays a light message background." and "Record this as new visual feedback qualifying the previous asset approval; do not erase the historical approval." |
| Evidence | EV-S3-OC1 — owner-run offline Outlook classic screenshots S2, S4, S6 (light message background) and the crop S3 ([addendum](../qa/b6-stage3/EV-S3-OC1_OUTLOOK_CLASSIC_OFFLINE_ADDENDUM.md)) |
| Status kept | **B6 NOT ACCEPTED.** G-SUP **CLOSED**. G-COPY **PROPOSED, NOT APPROVED**. The B7 body-discard issue **OPEN**. The real vacancy **DRAFT**. |

## 1. What the feedback qualifies

| Record | Its text | Effect of this feedback |
| --- | --- | --- |
| **OD-2026-10-27-01**, decision 2 | "Its existing black (`#000000`) background is ACCEPTED as shown in the supplied previews" | **Qualified, not erased.** The previews showed the logo on the dark header, where the black field is not visible (1.04 : 1). When Outlook classic displays a **light** message background, the same field appears as an isolated black rectangle; the owner **rejects** that appearance. |
| OD-2026-10-27-01, decisions 1 and 3 | The asset bytes approved; their Stage 2 integration authorised | **Unchanged.** The approved asset stays integrated in the `b6-2` working copy. This feedback authorises no runtime change and no replacement asset. |
| Concept A specification §7.1 ("the opaque variant keeps its own dark field and stays legible") | — | Still factually true (the logo stays legible), but no longer sufficient: legibility alone does not meet the owner's visual requirement on a light background. |
| Stage 3 plan, check C2 ("its black field as approved (OD-2026-10-27-01)") | — | To be read with this feedback: an isolated black rectangle on a light message background is **not** a pass, pending a new owner decision on the treatment. |

**r5 note (2026-11-01):** the owner has since seen candidate C2 in Outlook classic and likes it ([OR-2026-11-01-01](OWNER_RECORD_2026-11-01_B6_STAGE3_OUTLOOK_OFFLINE.md)) — a preference, not a decision. This feedback record is otherwise unchanged.

**r6 note (2026-11-02):** C2 is now **approved** and implemented as `b6-3` ([OD-2026-11-02-01](OWNER_DECISION_2026-11-02-01_B6_C2_P04.md)). Whether the integrated build meets this feedback in Outlook is still to be checked (owner check O-A).

## 2. What follows

- Candidate treatments for both light and dark rendering, built only from the approved brand assets, are **PROPOSED** in [`F01-F04_FINDINGS_AND_PROPOSAL.md`](../qa/b6-stage3/F01-F04_FINDINGS_AND_PROPOSAL.md) (finding F-01): C2 masthead band (recommended, with one wording decision) and C3 logo plate (alternative).
- Any replacement asset needs its own approval of the **exact bytes**, and its integration a separate runtime authorisation, as OD-2026-10-27-01 required for the current file.
- Inline CID delivery and offline readability are preserved by both candidates.

## 3. Affected documents

| Document | Change |
| --- | --- |
| This record | New |
| `OWNER_DECISION_2026-10-27-01_B6_LOGO_ASSET.md` and every other OD record | **Unchanged** |
| `B6_ACCEPTANCE_CHECKLIST.md`, `B6_DECISION_PACKAGE.md` (rev 11), `docs/design/EMAIL_CONCEPT_A_SPEC.md` (status note), the Stage 3 plan (r3) and the Stage 2 report | Reference this feedback |
