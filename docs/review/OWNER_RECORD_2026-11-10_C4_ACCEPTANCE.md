# Owner record — C4 accepted at `2193433` (2026-11-10)

| | |
| --- | --- |
| Source | The owner's instruction "Valida — Prepare GitHub consolidation through accepted C4 and preserve the return to C5", received 2026-11-10. It states the accepted implementation and asks for this record. It continues the owner's assignment "Valida — Record final C4 acceptance, prepare its publication review, and proceed with local C5" |
| Recorded by | Claude, in one signed, documentation-only commit whose parent is the accepted implementation `2193433` |
| Nature | A record of decisions already made by the owner. **It decides nothing new** |

## 1. What the owner accepted

| Item | State | Identity |
| --- | --- | --- |
| **C4 — SEO / Privacy / Legal Production Integration** | **Accepted (final owner acceptance)** | Commit **`2193433aff2f8b4aa6d5aae5ab7d1ae0cee2d200`**, tree `a879201c2985cd9d1e98f8432bc8e4e0327f39e2`, on local `c4-work` |
| **Social Card Version 2** | **Approved (final visual approval)** | `frontend/public/social/valida-social-card-v2-1200x630.png`, served as `/social/valida-social-card-v2-1200x630.png`. 1200 × 630 PNG, 214,945 bytes, SHA-256 **`c86554a2a7ea2cc020eccdb8d3e5a8171de0518e9eeaefba804197171a8cc2a5`**. The reviewed source copy is `docs/brand/social-card-preview/valida-social-card-v2-1200x630.png`, the same file |
| **Its revised sharing preview** | **Approved** | `C4-12-sharing-preview.png` from the r4 final stack run on `2193433`, SHA-256 `1d3d0a13f013a0a532b374c7e72c277f8c6dc2a0e7fb37cd54b98119aa5969cd`. It is evidence kept outside the repository, delivered with the C4 r4 handoff |

**What the acceptance covers:**
- the C4 work recorded in [OD-2026-11-07-01](OWNER_DECISION_2026-11-07-01_C4_DATE_LABELS.md), [OD-2026-11-09-01](OWNER_DECISION_2026-11-09-01_C4_RECRUITMENT_ORIGIN_TITLES_SOCIAL.md), [OD-2026-11-09-02](OWNER_DECISION_2026-11-09-02_C4_SOCIAL_CARD_AND_ELIGIBLE_WORK_COUNTRIES.md) and [OD-2026-11-09-03](OWNER_DECISION_2026-11-09-03_C4_CARD_REVISION_SHARING_COPY_SEQ1.md), as implemented at `2193433`;
- the eligibility implementation and the label "Eligible Remote-Work Countries", already technically approved by OD-2026-11-09-03 T1–T2;
- the card's approved alternative text:

  > Valida logo with the headline "Secure systems. Deliberate engineering." and the line "Valida is a technology company focused on cybersecurity, secure technology, and security engineering."

**This closes:**
- items 1 and 2 of OD-2026-11-09-03 §7 (the final visual approval of card revision 2, and C4 milestone acceptance);
- the C4 SEO record's D-3.

## 2. The four states, kept separate

| | C4 |
| --- | --- |
| Accepted | **yes, `2193433`** (this record) |
| Branch-published | **no.** `c4-work` is absent on the remote. A publication review is being prepared; no push is authorised |
| Merged into `main` | no. Remote `main` is `ec15048` |
| Deployed | no |

Publication, merging and deployment are separate owner decisions. Each changes state only after it is authorised, executed and independently verified.

## 3. Still open (unchanged by this acceptance)

- **The eligible work countries of the genuine Cybersecurity Specialist vacancy: OPEN.**
  - The vacancy stays DRAFT.
  - It may be published only after the approved Release E launch gates, including E6, are satisfied (OD-2026-11-09-03 §4).
- Whether Home's search description (Doc 06 §12, `<meta name="description">`) should also drop "Lithuanian". It is unchanged, because the OD-2026-11-09-03 amendment is limited to social sharing.
- The canonical-document synchronisation of:
  - OD-2026-11-09-03 §5;
  - the eligibility contract §5;
  - the earlier records.
- **Carried over:**
  - the vacancy's physical work location;
  - G9 (`jobSnapshot`);
  - P-1 to P-5;
  - D-6 to D-8.
- **Production candidate acknowledgements stay disabled** pending separate authorisation.

## 4. Consequences in this repository

- **C4 is frozen at `2193433`.** This record and the consolidation checkpoint that follows it are documentation-only commits on top of it.
- **Status lines updated in this commit:**
  - `README.md`: C4 is accepted;
  - `docs/README.md`: the index;
  - `docs/brand/social-card-preview/README.md`: revision 2 approved;
  - `docs/seo/C4_SEO_IMPLEMENTATION.md`: D-3 and the Open Graph note.
- **Not rewritten.** Comments in the accepted code and card source still say the final visual sign-off is pending:
  - `frontend/src/seo/socialCard.js`;
  - `docs/brand/social-card-preview/card.html`.

  So do the earlier decision records. That was accurate when written, and they are not rewritten: the accepted implementation is preserved exactly. This record supersedes them.
