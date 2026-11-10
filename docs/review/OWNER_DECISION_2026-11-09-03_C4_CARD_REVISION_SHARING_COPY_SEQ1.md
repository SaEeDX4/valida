# Owner decision OD-2026-11-09-03 — C4 r4: technical approval, social card revision 2, social-sharing copy, and SEQ-1 closed

| | |
| --- | --- |
| Identifier | **OD-2026-11-09-03**, the next free identifier after [OD-2026-11-09-02](OWNER_DECISION_2026-11-09-02_C4_SOCIAL_CARD_AND_ELIGIBLE_WORK_COUNTRIES.md). No identifier is reused |
| Date | 2026-11-09 |
| Decided by | Saeed (owner), under Doc 00 §§4–5 (a Level 1 explicit approved product change, recorded as a controlled amendment) and Doc 18 §364 |
| Source | The owner's instruction "Valida C4 r4 — Revise the social card and correct the E6 decision record" (2026-11-09) |
| Baseline | The reviewed technical baseline `86e1459fe03b2c686ccbf4e543c5774a02882019` on `c4-work` |
| Scope rule | **Only what this instruction covers is decided here.** Everything else keeps its earlier status. The r3 handoff and the earlier decision records are kept unchanged |
| Recorded by | Claude, on local `c4-work`. Nothing is pushed |

## 1. Recorded approvals

| # | Approval | Status |
| --- | --- | --- |
| T1 | **The eligibility implementation**: the `eligibleWorkCountries` field of [OD-2026-11-09-02](OWNER_DECISION_2026-11-09-02_C4_SOCIAL_CARD_AND_ELIGIBLE_WORK_COUNTRIES.md) A2, as delivered at `86e1459` | **Approved** by the owner. Technical approval of `86e1459` |
| T2 | **The exact label `Eligible Remote-Work Countries`** | **Approved** by the owner. It is the label already implemented (`frontend/src/pages/JobDetailPage.content.js`) |
| — | The final approval of the social card (revision 2, §2) | **Pending** the owner's visual review |
| — | C4 milestone acceptance | **Pending.** It follows the visual review of the revised card |

## 2. Social card, revision 2

### 2.1 One spacing adjustment

The text group (eyebrow, headline, description) moves up together. Its internal spacing is kept: 24 px between the eyebrow and the headline, and 24 px between the headline and the description.

| Measure (1200 × 630 card) | Revision 1 (`2667d619…`) | Revision 2 (`c86554a2…`) |
| --- | --- | --- |
| Layout gap, logo box bottom → eyebrow line box top (CSS px) | **125.8** (the free space of `justify-content: space-between`) | **80** (`.text { margin-top: 80px }`) |
| Visible gap, last row of logo pixels → first row of eyebrow pixels (image px) | **136** (rows 129 → 266) | **90** (rows 129 → 220) |
| The same visible gap in the 500 × 262 sharing preview (× 500/1200) | ≈ **57** | ≈ **37** |
| Space below the description | 72 | 117.8 |

**Reduction:** 45.8 px, or 36 %.

**Kept unchanged:**
- **The logo**, in position and treatment. Its box is at y 72–136; the top 200 px of the two images are pixel-identical.
- The headline, typography and colours.
- The dark background and the gradient.
- The 1200 × 630 canvas.

### 2.2 The approved marketing copy

- **Visible description on the card**, exactly:

  > Valida is a technology company focused on cybersecurity, secure technology, and security engineering.

- **`og:image:alt`**, exactly:

  > Valida logo with the headline "Secure systems. Deliberate engineering." and the line "Valida is a technology company focused on cybersecurity, secure technology, and security engineering."

### 2.3 The asset

| | |
| --- | --- |
| Revision 2, active | `frontend/public/social/valida-social-card-v2-1200x630.png`, served as `/social/valida-social-card-v2-1200x630.png`. 1200 × 630 PNG, 214,945 bytes, SHA-256 **`c86554a2a7ea2cc020eccdb8d3e5a8171de0518e9eeaefba804197171a8cc2a5`**. The reviewed source copy, `docs/brand/social-card-preview/valida-social-card-v2-1200x630.png`, is the same file |
| Revision 1, recoverable | `docs/brand/social-card-preview/valida-social-card-preview-1200x630.png`, **unchanged**: SHA-256 `2667d6191d73696e5b82019cc301aef82345dddc5e5c6645f6ac5abe5af9a71a`, git blob `78116a83…`. Also at `86e1459:frontend/public/social/valida-social-card-1200x630.png`. **No longer served** |
| Why a new file name | A revised image gets a new URL, so one URL never stands for two different images. This matters for platform caches once a card has been shared |

**Status: final visual sign-off pending the owner's inspection** of the exact PNG and of the rendered sharing preview.

## 3. The social-sharing copy amendment (limited to social sharing)

**Trace.** The text shown below the image in the r3 sharing preview is Home's `og:description`. Until now, `og:description` was always the route's search description. On Home, that is Doc 06 §12 (`HOME_META.description`), which also feeds `<meta name="description">`. The shared head helper wrote both tags from one string (`frontend/src/seo/head.js`).

**The change.** Home's sharing description, used for `og:description` only, is now:

> Valida is a technology company focused on cybersecurity, secure technology, security engineering, and modern digital systems.

- Only "a Lithuanian technology company" became "a technology company".
- "and modern digital systems" and the rest of the sentence are kept.
- No other route's sharing description contained the phrase, so no other route changes. Each still shares its own search description.

**The mechanism.**
- The route head may now carry an optional `socialDescription` (Home only).
- `describeHead` uses it for `og:description` and never for `<meta name="description">`.
- It applies only where Open Graph exists: never on noindex pages or in review builds.

**Not changed. The amendment is limited to the social-sharing context:**
- the approved page titles;
- **Home's search description** `<meta name="description">`, which stays Doc 06 §12 verbatim. It is a search-result description, not a sharing context;
- all visible page copy, including the About hero, "Valida is a Lithuanian technology company focused on …";
- the factual references to Valida MB's Lithuanian registration:
  - About, "Valida MB is a Lithuanian technology company whose registered activity context includes …";
  - Privacy "Who We Are", "Valida MB is a Lithuanian technology company.";
  - Legal, "Company type: Lithuanian Mažoji bendrija (MB)", and the other company facts;
  - the official records.

**A point to confirm.** If the owner also wants Home's search snippet to drop "Lithuanian", that is a separate amendment of Doc 06 §12. It is a one-line change and is **not made here**.

## 4. SEQ-1 — closed

**The decision, exactly as the owner gave it:**

> **The first genuine Cybersecurity Specialist vacancy may be published only after the approved Release E launch gates, including E6, are satisfied.**

**Its eligible work countries remain OPEN.**

**Effects:**
- **The answer to SEQ-1** ([trace](../recruitment/E3_E6_TRACE_AND_ELIGIBILITY_GAPS.md) §5.3) is **no**. The genuine vacancy is **not** published on the website before E6, through provisioning or otherwise.
- **Doc 18 §145.** Release C's value statement ("see real open Job") is read as a capability of the Release C system. It is not a requirement to publish the genuine vacancy in Release C.
- **C7.** The production proof (Doc 18 §§184–185) does not publish the genuine vacancy. The method of that proof is decided at C7.
- **Doc 18 §248** (E6 "Publish real vacancy") is unchanged. The amendment the trace proposed for a "yes" answer is withdrawn.
- **The Draft.** `backend/provisioning/jobs/cybersecurity-specialist.json` stays DRAFT. Its notes already say that "its publication remains subject to the Release E gates, including E6", and its guard is unchanged:
  - `awaitingInput` lists `location` and `eligibleWorkCountries`;
  - either one alone refuses publication.

  No code or data change is needed.
- **The gates stay as they were:** C5 → C6 → C7 → D → E, with E6 as the external launch. Its gates are Doc 18 §§182, 218 and 246–252, Doc 12 §§25 and 45, Doc 06 §§169 and 178, Doc 13 §§313–314, Doc 18 §§180 and 384, and Doc 16 §137.

## 5. Canonical documents — exact clause and proposed wording (PENDING SYNCHRONISATION)

These documents are kept outside the repository (Doc 00 §5; Doc 18 §364). **Nothing below is applied to the canonical files.**

| Clause | Current text | Proposed wording (PENDING SYNCHRONISATION) |
| --- | --- | --- |
| **Doc 06 §4** PRIMARY BRAND DESCRIPTION | "Canonical short description: Valida is a Lithuanian technology company focused on cybersecurity, secure technology, and security engineering." | Unchanged, plus: "**Social-sharing variant** (the social card's visible line and its alternative text only; OD-2026-11-09-03): Valida is a technology company focused on cybersecurity, secure technology, and security engineering." |
| **Doc 06 §12** HOME — SEO DESCRIPTION | "Valida is a Lithuanian technology company focused on cybersecurity, secure technology, security engineering, and modern digital systems." | Unchanged for the search description, plus: "**Social-sharing description** (`og:description` only; OD-2026-11-09-03): Valida is a technology company focused on cybersecurity, secure technology, security engineering, and modern digital systems." |
| **Doc 16 §95** SOCIAL CARD | "Default branded social image target: 1200 × 630 or an equivalent current best-practice social-card size." | Add: "**The default card is `/social/valida-social-card-v2-1200x630.png`** (SHA-256 `c86554a2…c2a5`), with the alternative text of OD-2026-11-09-03. Final visual sign-off by the owner. A revised card gets a new file name." This replaces the revision 1 wording proposed in the eligibility contract §5 |
| **Doc 18 §145** RELEASE C VALUE | "After Release C, a visitor can: Discover Valida → understand the company → see real open Job → open Job Detail → Apply → upload resume → receive truthful result" | Add: "**This describes the capability of the Release C system. The first genuine vacancy is published only after the approved Release E launch gates, including E6, are satisfied (OD-2026-11-09-03).**" |
| Doc 02 §87 | "Its corporate description must remain compatible with the following factual structure: Valida is a Lithuanian technology company focused on cybersecurity, secure technology and security engineering." | **No change proposed.** The sharing variant omits the country and states nothing contrary to the factual structure. Doc 06 §15 already says "a technology company". Recorded for completeness |

## 6. What this record changes in the repository (local, `c4-work`)

| Change | Where |
| --- | --- |
| The card source: the text group moved up, and the approved description | `docs/brand/social-card-preview/card.html` |
| The renderer: it writes revision 2 under its own name, refuses to overwrite revision 1, and reports the layout gaps | `docs/brand/social-card-preview/render.mjs` |
| Revision 2, rendered; revision 1 kept unchanged | `docs/brand/social-card-preview/valida-social-card-v2-1200x630.png` (new); `…/valida-social-card-preview-1200x630.png` (unchanged) |
| The active asset | `frontend/public/social/valida-social-card-v2-1200x630.png` added; `frontend/public/social/valida-social-card-1200x630.png` removed |
| The card reference: path, SHA-256, alt | `frontend/src/seo/socialCard.js` |
| The Home sharing description | `frontend/src/pages/HomePage.content.js` (`HOME_META.socialDescription`) |
| **The shared metadata helper and its consumers** | `frontend/src/seo/head.js` (`describeHead` accepts `socialDescription`). It is consumed by `frontend/src/components/seo/PageMeta.jsx`, which passes the prop for the browser head, and by `frontend/server/renderDocument.js`, which passes the route head object, so it needs no change, for the initial HTML. The route heads are in `frontend/src/seo/routeHeads.js`, unchanged: Home spreads `HOME_META`. Every page that renders `PageMeta` is a consumer; only Home supplies the field |
| Tests | `frontend/src/seo/seo.test.js`, `frontend/src/components/seo/PageMeta.c4.test.jsx`, `frontend/server/documentServer.test.js`, `e2e/seo/c4-seo.e2e.js` (C4-12) |
| Records | This record; `docs/brand/social-card-preview/README.md`; `docs/seo/C4_SEO_IMPLEMENTATION.md`; `docs/recruitment/E3_E6_TRACE_AND_ELIGIBILITY_GAPS.md` (SEQ-1 closed); `docs/recruitment/ELIGIBLE_WORK_COUNTRIES_CONTRACT.md` (label approved; Doc 16 §95 row); `docs/README.md`; `e2e/README.md`; `README.md` |

**Unchanged:**
- `backend/`;
- the eligibility code;
- the Draft;
- the Apply chain.

## 7. Still open

1. The final visual approval of card revision 2.
2. C4 milestone acceptance.
3. **The eligible work countries of the genuine vacancy: OPEN.** The minimum decision is the explicit list of countries from which Valida has confirmed it can employ someone to perform the role.
4. The canonical synchronisation of §5 and of the eligibility contract §5.
5. As before:
   - the vacancy's physical work location;
   - G9 (`jobSnapshot`);
   - P-1 to P-5;
   - D-6 to D-8.

Nothing is provisioned or published. Production candidate acknowledgements stay disabled.
