# F-01…F-04 — findings from EV-S3-OC1 and EV-S3-OC2, candidates and a correction proposal (all PROPOSED)

| | |
| --- | --- |
| Basis | [`EV-S3-OC1_OUTLOOK_CLASSIC_OFFLINE_ADDENDUM.md`](EV-S3-OC1_OUTLOOK_CLASSIC_OFFLINE_ADDENDUM.md) — the owner's offline Outlook classic screenshots: S1–S7 of `b6-2` (EV-S3-OC1, Part I) and M1–M6 of the C2+P04 review mockups (EV-S3-OC2, Part II), measured; the owner-reported checks and the C2 preference in [OR-2026-11-01-01](../../review/OWNER_RECORD_2026-11-01_B6_STAGE3_OUTLOOK_OFFLINE.md) |
| Revision | **r9** (2026-11-02): §0d added (status after OD-2026-11-02-03). **r8** (2026-11-02): owner decision **OD-2026-11-02-02 (D-6 APPROVED)** recorded with its limited precedence (§0c, §4.5); the owner's original 07:12 screenshots of `b6-3` registered (EV-S3-OC5) and r7's inference that `b6-3` had not been opened withdrawn (§0c). Earlier text kept. **r7** (2026-11-02): §0b (status per finding) and §4.4 (F-03: the masthead constraint, the remedies re-examined, one recommended bounded decision) added; the r6 F-03 development-evidence claim and R-03-B's stated effect corrected there. Earlier text kept as written. **r5** (2026-11-01) — corrections, each marked "r5" where it is made: (1) the Outlook work is **authorised** Stage 3 offline EML inspection in Outlook classic — r4's "pre-authorisation" wording was wrong; cell A1-OC is **PARTIAL** (§7.2); (2) the abbreviated C3 image hash in §2.3 read `73adbe4c…d1cd`; the full hash ends **`b95a`** (§8 always gave the full, correct hash); (3) F-02's cause stays **provisional** — a colour or width absent from the source does not exclude a template/client interaction (§3); (4) F-03 is **not** closed by reachability alone (§4); (5) material supplied to GPT but not to this session is "not received here"; (6) EV-S3-OC2 and the owner-reported checks added (§0). |
| Build examined | Findings raised on `b6-2` (`templates.js` `9d8e998c…4534`, logo `b8c54174…341a`). **r6:** the current build is `b6-3` (`templates.js` `46d0df76…57a3a9`, masthead `ac67a2cb…ea3b`). **r7:** no runtime change; `b6-3` unchanged |
| Status | **r6:** C2 and P-04 **APPROVED** (OD-2026-11-02-01) and **implemented** as `b6-3` (§0a). Below §0a, the r4/r5 text is kept as the record of the proposal, including its "PROPOSED" labels; C3, R-03-A/B and the other alternatives remain unadopted. |
| Honest limit | **Claude has no access to Outlook.** Every Outlook statement below rests on the owner's screenshots or reports. The candidate previews are **Chromium mockups** with Outlook's light colours substituted from measurements; they are **not** Outlook output. The owner's Outlook screenshots of the C2+P04 review EMLs (EV-S3-OC2) show **mockups**, not the product. |
| Status kept | **B6 NOT ACCEPTED.** G-SUP **CLOSED**. G-COPY **PROPOSED**. The B7 body-discard issue **OPEN**. The real vacancy **DRAFT**. Cell A1-OC **PARTIAL** (not PASS); every other Stage 3 cell **NOT RUN**; online access and live email **NOT AUTHORISED**. |

Severity scale used here — **High:** blocks the owner's acceptance or would make a required Stage 3 check FAIL under spec §10. **Medium:** would fail a check as currently worded, but whether content is lost is unknown. **Low:** cosmetic; not attributable to the template on current evidence.

## 0d. r9 status (2026-11-02)

**F-01:** resolved for Outlook classic as far as client evidence goes — the LONG band measured in light (EV-S3-OC5) and the acknowledgement owner-accepted in light and dark (OD-2026-11-02-03, owner-reported); other clients under Stage 3 Part B. **F-02:** unchanged and separate (D-5 optional). **F-03:** unchanged — accepted deviation D-6. **F-04:** every visible LONG line measured ≥ 4.5 : 1 in light; the footer and the acknowledgement **derived** from the same measured colour pairs (a limitation, not a measurement); other clients under Part B. No further cosmetic work is open on any finding.

## 0c. r8 status (2026-11-02) — D-6 approved; the owner's original screenshots of `b6-3`

**D-6 is APPROVED** ([OD-2026-11-02-02](../../review/OWNER_DECISION_2026-11-02-02_B6_D6.md)): horizontal scrolling in Outlook classic in a narrow window or at high whole-message zoom is accepted as a narrowly scoped deviation, provided all content remains readable and accessible by scrolling — **not a reflow PASS**. The owner's wording controls; the r7 proposed D-6 conditions (§4.4) are **not** imported. **Correction:** §0b said the owner's screenshots showed the r5 mockup; that held for the files then received (EV-S3-OC4) only. The owner's original captures (EV-S3-OC5, 07:12) show `b6-3`. Where this table differs from §0b or §0a, this table applies.

| | Implementation status | Development-test evidence | Actual client evidence (Outlook classic, `b6-3`) | Remaining closure criteria |
| --- | --- | --- | --- | --- |
| **F-01** logo on a light background | C2 in `b6-3` (unchanged) | As §0a | **EV-S3-OC5 (LONG, light):** band inline across the column, proportions kept, mark legible; no isolated rectangle. Dark: owner-reported satisfactory | The ACK template in light and dark (one screenshot each) — then F-01 can be recorded resolved for Outlook classic |
| **F-02** blank area beside the message | No change | — | Wide monitor only; none on the normal monitor (EV-S3-OC3/OC4/OC5) | **Separate** from D-6. Cause unproven; owner decision D-5 optional. Not redesigned without a material defect or an owner request. Not a B6 blocker |
| **F-03** overflow, narrow window / high zoom | R-03-C wrapper in `b6-3` (unchanged; no further redesign requested) | J7 model; confirmed by EV-S3-OC5 O1 | **O1:** layout ≈ 599 CSS px in a ≈ 384 CSS px area at 2.0 — horizontal scrollbar, masthead and the end of the headline beyond the edge as opened; O2 (maximized, 2.0) and O3 (100 %): no horizontal scrollbar. Reachability: owner-reported | **Accepted as a bounded known limitation (D-6).** Recorded as **ACCEPTED DEVIATION (D-6)** for the scrolling criterion. Still a blocker if found: content loss, inaccessible content, overlap that impairs reading or functionality, or a text-resize defect |
| **F-04** secondary-text contrast | P-04 in `b6-3` (unchanged) | As §0a | **EV-S3-OC5 O3 (LONG, light, 1:1):** all 16 visible lines exact — eyebrow 4.72, body / labels / note 4.75, headline / values 11.14 | The footer and the ACK template in light (the ACK light screenshot covers both); dark by screenshot (the ACK dark screenshot) |

## 0b. r7 status (2026-11-02) — after EV-S3-OC4, the r6 Windows run and the F-03 investigation

No runtime change in r7. The owner's new screenshots (EV-S3-OC4) show the **r5 review mockup**, not `b6-3` ([addendum §17](EV-S3-OC1_OUTLOOK_CLASSIC_OFFLINE_ADDENDUM.md)). The Windows + MongoDB run of `b6-3` passed every available gate ([EV-B6-3-W1](../b6-3/WINDOWS_EVIDENCE_R6.md)); it concerns behaviour and tests, not rendering. §0a below is kept as written; where this table differs, this table applies.

| | Implementation status | Development-test evidence (sandbox) | Actual client evidence | Remaining closure criteria |
| --- | --- | --- | --- | --- |
| **F-01** logo on a light background | Implemented in `b6-3` (unchanged) | As §0a; Windows: all gates pass on `b6-3` (EV-B6-3-W1) | **Mockups only:** EV-S3-OC2, OC3, and now OC4 (Z2, Z3: the band intact in the light rendering at 1.0 and 2.0). **`b6-3`: NOT RUN** | O-A on the `b6-3` fixtures, light and dark |
| **F-02** blank area beside the message | No change (cause provisional) | — | Wide monitor only; none on the normal monitor in Z2 / Z3 | Owner decision D-5 (not a B6 blocker) |
| **F-03** overflow at 200 %, narrow window | R-03-C wrapper in `b6-3` (unchanged). **Expected to make no difference in Outlook classic**: the 600 px masthead image sets the column's minimum width there (§4.4) | **r7 correction:** the r6 claim "narrows to 400 with no overflow" came from Chromium also shrinking the masthead through its CSS `width:100%`, which Outlook classic does not apply. J7 models the documented Outlook rules: `b6-3`, the fixed wrapper and a fluid wrapper all overflow by (600 − width) CSS px below 600 px | **`b6-3`: NOT RUN.** EV-S3-OC4 Z1 (mockup, fixed wrapper): layout ≈ 600–610 CSS px in a ≈ 510 CSS px area at 2.0 — horizontal scrollbar, masthead cut at the right; headline fully visible; reachability owner-reported, not shown | **Not closable by a template change within the approved design** (§4.4). O-A on `b6-3` supplies the facts; then owner decision **D-6 (revised, §4.4)** — or a new design decision for Outlook classic. Reachability by scrolling alone does not close it |
| **F-04** secondary-text contrast | Implemented in `b6-3` (unchanged) | As §0a | Mockups at 1:1 (EV-S3-OC3): 4.72 / 4.75. **`b6-3`: NOT RUN** | O-A light screenshot of the build, measured ≥ 4.5 : 1 |

## 0a. r6 status — `b6-3` implemented (2026-11-02, OD-2026-11-02-01)

C2 and P-04 are now **approved** (OD-2026-11-02-01) and **implemented** in the runtime as template `b6-3` ([report](../b6-3/B6-3_IMPLEMENTATION_REPORT.md)). No finding is closed by the code change alone. The r5 table below (§0) is kept as written.

| | Implementation status | Development-test evidence (sandbox) | Actual client evidence | Remaining closure criteria |
| --- | --- | --- | --- | --- |
| **F-01** logo on a light background | **Implemented:** the approved C2 masthead (`ac67a2cb…ea3b`) as the whole header row in both emails; `CAREERS` removed; the old asset retired from the runtime (kept in `docs/qa/b6-stage2/logo/`) | T-02, T-08 (pinned hash, PNG 1200 × 216), T-13; mutation M4 / M6 caught; fail-closed probe J4; previews: masthead ratio kept at 280–1440 px | **Mockups only:** EV-S3-OC2 (band pixel-identical in light and dark), EV-S3-OC3 (band present at screen size; 3 px at the top not shown — cosmetic). **`b6-3` build: NOT RUN** | O-A (1) shows the band in light and dark on the `b6-3` fixtures; then cell A1-OC C2 can be recorded |
| **F-02** blank area beside the message | **No change** (cause provisional) | — | Wide monitor only (EV-S3-OC1/OC2/OC3; owner-reported monitor dependence); absent on the normal and portrait screens (EV-S3-OC3) | Owner decision D-5 (record as environment-dependent behaviour), optionally after A-02. **Not a B6 blocker** |
| **F-03** overflow at 200 %, narrow window | **Implemented a layout fix:** the Outlook-only wrapper is now a full-width table with a 600 px middle cell (no fixed 600 px table) | T-02 pins the new wrapper; browser layout of the uncommented markup: 600 px at 1440 / 680, narrows to 400 with no overflow (b6-2 wrapper overflows) — **not Word** | **NOT RUN** on `b6-3`. `b6-2` scrolled sideways (owner, GPT) | O-A (2) with no horizontal scrolling and O-A (3) with the column still 600 px on the wide monitor → closable; otherwise owner decision D-6. Reachability by scrolling does **not** close it |
| **F-04** secondary-text contrast | **Implemented:** labels and footers `#B6C0CC`, eyebrow `#83C6FF` | T-13; mutation M7 / M8 caught; Outlook-light simulation with measured colours: lowest 4.72 | **Mockups, 1:1 (EV-S3-OC3):** eyebrow `#006DA5` **4.72**, labels and footers `#5D6875` **4.75** — measured, corroborating GPT's values. **`b6-3` build: NOT RUN** | O-A (1) light screenshots (PNG files) measured ≥ 4.5 : 1 for every line of the build; other clients under BL-3 |

Consolidated blockers and the batched decision wording: [`docs/review/B6_REMAINING_BLOCKERS.md`](../../review/B6_REMAINING_BLOCKERS.md).

## 0. r5 status at a glance (2026-11-01)

| | F-01 logo on light | F-02 region beside the message | F-03 overflow, 200 %, narrow window | F-04 secondary-text contrast |
| --- | --- | --- | --- | --- |
| **Observed in screenshots** | `b6-2`: isolated black rectangle (S2, S4, S6). C2 mockup: dark band, pixel-identical in light and dark; no isolated rectangle (M1–M6) | Layout ≈ 2,112 CSS px wide in all 12 full-window screenshots; the painted region varies (S1–S7, M1–M6) | Nothing received here: no horizontal scrollbar in any screenshot received here (all at an effective 100 %) | `b6-2` light: 2.48 / 3.75 fails. C2+P04 mockup: footer 4.75 measured; eyebrow ≥ 4.72; labels unmeasurable (resized) |
| **Owner-reported** | Rejects the isolated rectangle (OF-2026-10-27-01); likes C2, wants to continue evaluating it (OR-2026-11-01-01) | Region on the wide monitor only | `b6-2` LONG overflowed in a narrow window at 200 % (screenshot supplied to GPT); C2+P04 at 200 %, light and dark: no problems (no screenshots; window width not recorded) | — |
| **Untested** | C2 on phones (band scales: logo ≈ 103 × 23 at 390 px), images off, light Office theme, other clients; C3 in Outlook | The cause; the control message (A-02) | Reachability when scrolled fully right; the ACK in a narrow window; any remedy in Outlook | Labels and eyebrow at 1:1; all clients except Outlook classic |
| **Status** | **OPEN** — decisions pending (§8) | **OPEN** — cause provisional | **OPEN** | **OPEN** — partly measured on the mockup |
| **Smallest next step** | Owner decisions: C2 asset bytes; `CAREERS` (§8) | A-02 on the wide monitor (optional, Low severity) | A-03: share the existing narrow-window 200 % screenshot(s) here — no repeat test | O-5: one un-resized light screenshot of the LONG mockup |

## 1. Findings table (B)

| ID | Evidence | Severity | Confirmed facts | Hypotheses (not asserted) | Governing criterion | Recommended resolution | Retest |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **F-01** Logo on a light background | S2, S4, S6 (light); S3 (crop); S1, S5, S7 (dark) | **High** — the owner rejects it | In the light renderings Outlook recoloured **every HTML colour** but left the image untouched: the logo's `#000000` field stays black, 158 × 36, on a `#ECEEF0` canvas — an isolated black rectangle. In the dark renderings the field is invisible (1.04 : 1). The brand pack has **no** light-background variant: every transparent variant has light lettering (median L\* 87–90) | Outlook classic with a **light Office theme** may not transform this dark message at all (the light screenshots used a dark theme with the message background switched to light) — not inspected | Owner feedback of 2026-10-27, qualifying OD-2026-10-27-01 ([record](../../review/OWNER_FEEDBACK_2026-10-27_B6_LOGO_LIGHT_RENDERING.md)); brand README rules 1–4; Doc 03 §§16, 18, 20; spec §7.1, §8 ("the logo stays legible"); plan C2 | **C2 masthead band** (PROPOSED, recommended), which needs **one explicit wording decision** (retire the header label `CAREERS`); otherwise **C3 logo plate** (PROPOSED), which changes no wording (§2). **r5:** C2 rendered in Outlook classic (EV-S3-OC2): the band is pixel-identical in light and dark; the owner likes C2 and wants to continue its evaluation — a preference, **not** an approval. **OPEN** pending the decisions in §8 | After approved decisions and a runtime authorisation: the A1-OC cell on the approved revision |
| **F-02** Broad region right of the message at 100 % | S1, S4, S5, S6, S7 (region present); S2 (absent) | **Low** | The message is laid out **2112 px wide** in a reading surface of 2532 px in all six full-window screenshots — S2 included, where the column is still centred on x 1069.5, not on the surface's centre (1279.5). Outside it: `#FFFFFF` in dark, `#262626` in light — not template colours. S2 fills the surface with the canvas colour, with identical HTML. The template contains no width near 2112 px. **r5:** EV-S3-OC2 shows the same layout width; the owner reports the region on the wide monitor only (owner-reported) | H1 layout width fixed at an earlier window or pane size; H2 a display or monitor dependence (2532 / 2112 ≈ 1.20; supported by the owner's monitor report); H3 a template effect, or a template/client interaction — **weighed against** by identical HTML painted differently, but **not excluded**: a colour or width absent from the source does not rule out an interaction | Plan C1 (one readable column — met); spec §10 lists no criterion for the client's surface outside the message; Doc 03 §83 (centred composition) by analogy | **No template change proposed. OPEN; cause provisional.** One targeted owner action separates the Valida markup from any HTML message (A-02, §3.3) | A-02 only; nothing else |
| **F-03** Horizontal overflow, narrow window, 200 % | Owner's report and GPT's observation (LONG). **The screenshot was not received here** (supplied to GPT). Wide-window 200 % ACK: no overflow (GPT; not received here either). **r5:** the owner reports both C2+P04 mockups checked at 200 %, light and dark, with no problems — owner-reported, window width not recorded | **Medium** | The Outlook-only wrapper is a fixed **600 px** table (`templates.js` line 210: `<!--[if mso]><table … width="600" …>`). Whole-message zoom scales it: at 200 % it needs about 1,200 px plus the client's margins. In a wider window there is room; in a narrow one there is not. Long values are not the cause: they wrap inside the column (S6, S7) | Content is **reachable** by horizontal scrolling (the scrollbar suggests so) — not shown; the ACK overflows in the same narrow window too — not shown | Plan C1 ("horizontal scrolling … at desktop width" not acceptable) and C8 (text at 200 %: reflows); spec §9 claims "200 % zoom reflow[s] the column" — **not true for Outlook classic's whole-message zoom**; Doc 16 §§37–40 and Doc 03 §§82–83 by analogy | **OPEN.** Reachability is an input, not a resolution (§4.2). First make the existing narrow-window evidence available here (A-03). Then either **R-03-B** (a fluid Outlook wrapper, with its readability cost), verified in Outlook, or an explicit owner decision on a bounded limitation (**R-03-A**); neither closes F-03 by itself until it is recorded and retested (§4) | A-03; after any change or decision, the A1-OC cell at 200 % in a narrow window |
| **F-04** Secondary-text contrast | S2, S4, S6 (light); S1, S5, S7 (dark) — measured | **High** — fails C4 / spec §10 in the light rendering | Light rendering: eyebrow **3.75**, metadata labels **2.48**, footer **2.48** — below 4.5 : 1. Body and note 4.75, `CAREERS` 4.88, headline and values 11.14 pass. Dark rendering: every line ≥ 5.52. Outlook kept mid-grey text mid-grey on a light background | — (measured; the method and limits are in the addendum §3) | Spec §10 and plan C4 (4.5 : 1; 3 : 1 for the headline); Doc 16 §§32–35 (§35: muted text must not be used where its contrast fails) | **P-04a:** labels and footer `#7E8997` → `#B6C0CC`. **P-04b:** eyebrow `#66B3FF` → `#83C6FF`; fallback `#B6C0CC`. **r5 (EV-S3-OC2, mockup):** footer **measured** 4.75; eyebrow **≥ 4.72 (lower bound)**; labels **not reliably measurable** in the resized screenshots. **OPEN** (§5.4) | One un-resized light screenshot of the LONG mockup (O-5, §7.2) |

## 2. F-01 — the logo on a light background

### 2.1 What the evidence shows

- **The black field is the approved asset as designed.** Spec §7.1 chose the opaque dark variant so that, if a client changed the header to a light background, the silver lettering would keep its own dark field. Outlook classic did exactly that in S2, S4 and S6. The owner now rejects the result. This is **new owner feedback that qualifies OD-2026-10-27-01**, not an implementation defect; the approval stays on record unchanged ([feedback record](../../review/OWNER_FEEDBACK_2026-10-27_B6_LOGO_LIGHT_RENDERING.md)).
- **Outlook recoloured HTML, not images.** Measured in the light renderings: `#05070A` → `#ECEEF0`, `#080C11` → `#E9EBEF`, `#F4F7FA` → `#2C3034`, `#B6C0CC` → `#5D6875`; the logo's pixels are unchanged (`#000000` stays `#000000`). A solution therefore cannot rely on the HTML background staying dark; it can rely on an image staying as it is — in this client.

### 2.2 The brand assets, inspected first

`frontend/public/brand/` (approved 2026-09-10): 20 assets plus `README.md`; all 21 checksums match `SHA256SUMS.txt`.

| Asset | Use for this problem |
| --- | --- |
| `valida-logo-horizontal-dark.png` (`920db434…dc5e`, RGB, opaque black) | The source of the current email logo — the black field is the issue |
| `valida-logo-horizontal-transparent.png` (`f274e8ba…3377`, RGBA) | "Preferred header/navbar lockup on dark surfaces." Lettering median L\* 89: on Outlook's light canvas it reaches about **1.1 : 1** — illegible (candidate C1) |
| Other transparent variants (full lockup, mark, wordmark, tagline) | All light (median L\* 87–90); none for light backgrounds |
| A light-background (dark-lettering) variant | **Does not exist.** Creating one would recolour the mark — forbidden (README rule 1; Doc 03 §16, §20) |

**So "removing the black pixels" is not a solution:** the transparent lockup on a light background fails (C1). The mark must stay on a dark surface; the design question is only how that surface looks when Outlook turns the rest of the message light.

### 2.3 Candidates (PROPOSED review mockups; nothing integrated)

Files: [`proposals/f01-logo/`](proposals/f01-logo/) — candidate PNGs, `candidates.json`, the comparison sheet [`F01-F04-review-sheet.png`](proposals/f01-logo/F01-F04-review-sheet.png) (owner evidence rows beside mockups) and the Chromium previews in `previews/` (`previews-index.json` records Chromium 153, viewport, overflow and image sizes). Tools: [`tools/make_f01_candidates.py`](tools/make_f01_candidates.py) (checks both source hashes first), [`tools/f01_variants.py`](tools/f01_variants.py), [`tools/make_f01_previews.py`](tools/make_f01_previews.py), [`tools/make_f01_sheet.py`](tools/make_f01_sheet.py).

| | **C0** current | **C1** transparent lockup alone | **C2** masthead band — **recommended** | **C3** logo plate — alternative |
| --- | --- | --- | --- | --- |
| Image | 316 × 72, 13,303 B, `b8c54174…341a` | 316 × 72, 18,156 B | 1200 × 216, 15,801 B, `ac67a2cb…ea3b` | 412 × 144, 16,340 B, `73adbe4c…b95a` (r5: corrected from `…d1cd`) |
| Made from | dark lockup, resampled (approved) | transparent lockup, resampled only | transparent lockup, resampled only, on the canvas colour `#05070A` at the current logo position (40 px left, 36 px top) | transparent lockup, resampled only, on a `#05070A` plate: 24 px / 18 px clear space, 8 px radius, transparent corners |
| Shown at | 158 × 36 | 158 × 36 | 600 × 108 — the **whole header row**, scaling with the column | 206 × 72, fixed; header padding 18 px 40 px keeps the header 108 px tall |
| Outlook light (simulated) | isolated black rectangle — matches S2 | lettering vanishes | a dark masthead band across the column; the body below turns light | a dark rounded badge with clear space — still a separate dark object |
| Outlook dark / source | field invisible | seamless | seamless — the band is exactly the canvas colour, so the faint field also disappears | seamless |
| Phone, 390 / 320 px (Chromium) | logo 158 × 36 | 158 × 36 | logo about **103 × 23 / 84 × 19** (the band scales) | **158 × 36** (fixed) |
| Header label `CAREERS` | kept | kept | **retired** — it cannot sit as live text inside an image band | kept |
| Text inside the image | none | none | none (a variant with `CAREERS` drawn into the band was rejected: spec §8, and about 8 px tall on a phone against the 12 px minimum of spec §5) | none |
| MIME | — | — | unchanged: one `image/png` part, same Content-ID and file name | unchanged |
| Review EML size (LONG) | 31,000 B (fixture) | — | 33,806 B (indicative) | 35,183 B (indicative) |
| Brand basis | approved derived file | rule 3: a dark-surface asset | rules 1–4: unmodified mark, aspect kept, on the brand's dark surface, clear space ≥ 36 px | rules 1–4: as C2, clear space 24 / 18 px |
| Status | APPROVED (OD-2026-10-27-01); rejected on light by the owner's feedback | not proposed | **PROPOSED** | **PROPOSED** |

### 2.4 Recommendation (PROPOSED)

**C2, the masthead band, subject to one explicit owner decision: retiring the header label `CAREERS`.** It is the only candidate that leaves no separate dark object on Outlook's light background: the header becomes a deliberate dark band the width of the column, the approved mark stays unmodified on its intended dark surface, and in dark rendering the band is identical to the canvas.

What it costs, stated plainly:

1. **One approved word leaves the HTML.** `CAREERS` is part of the approved wording (OD-2026-10-26-02 approved the labels of both emails). It is presentational — already absent from the plain-text part and hidden on phones — but removing it is still a wording change and needs the owner's explicit approval. The plain text, subjects, preheaders, eyebrow, headline, body, labels, note and footer are unchanged.
2. **The logo is smaller on phones:** about 103 × 23 at 390 px and 84 × 19 at 320 px, against 158 × 36 today. Legibility on a real device is untested.

**If the owner declines the wording change, or prefers the full-size logo on phones: C3.** It changes no wording and keeps the logo at 158 × 36 everywhere, but in Outlook's light rendering it is still a dark object — a padded, rounded badge instead of a tight black box. The owner should judge both in Outlook (review EMLs, §7.2) before deciding.

### 2.5 Compatibility limits (C2 and C3)

- **r5:** C2 is now rendered in Outlook classic, offline, as a review mockup (EV-S3-OC2: ACK and LONG, light and dark, owner-reported 100 %); the band was not recoloured. **C3 in Outlook: NOT RUN** (not needed while the owner evaluates C2). The proposed eyebrow colour `#83C6FF` now has a lower-bound measurement (§5.4).
- Other clients (Gmail web and apps, Apple Mail, Outlook on the web, new Outlook): whether any of them recolours images or backgrounds is **NOT RUN**. In Outlook classic the image was left untouched; other clients are unverified.
- Outlook classic with a **light Office theme**: not inspected; it may show the dark message unchanged, where C0 already looks seamless.
- **Images not shown:** both keep `alt="Valida"` with the existing alt-text styling; C2's empty box is 600 × 108 on the canvas colour (recoloured in Outlook light).
- **Scaling:** both assets are 2× for high-density screens. Both keep explicit `width` / `height` attributes, as the current logo does (Outlook on Windows is widely reported to mis-size images without them — not verified here).
- C2 relies on the client honouring `width:100%` for the image on narrow screens; a client that used only the `width="600"` attribute would overflow at 320–390 px. Not tested in a real client.
- Both keep inline CID and offline readability; no image is fetched from anywhere.

## 3. F-02 — the broad region on the right

### 3.1 Confirmed

- In all six full-window screenshots the message is laid out **2112 px wide** (x 14–2125; S7: 11–2122) and the 600 px column is centred on that width (x 1069.5), **210 px left of the reading surface's centre**. This holds in S2 too.
- What differs between screenshots is only the paint **outside** those 2112 px: white in the dark renderings (S1, S5, S7), `#262626` in the light renderings of INT and LONG (S4, S6), and the light canvas colour in S2 (ACK light), where no region is visible.
- In EV-S3-OC1 the dark region in light mode was visible in INT and LONG (S4, S6), not in the ACK light screenshot S2. **r5:** in EV-S3-OC2 it is the reverse — visible in the ACK light screenshot (M2), absent in the LONG light screenshots (M4, M6). Which message shows it is therefore not fixed.
- The HTML declares the canvas colour twice (`<body bgcolor>` and the 100 % outer table); the only fixed width is the 600 px Outlook wrapper; nothing in the template is near 2112 px.
- At an owner-reported 200 % in a wider window, GPT saw no such region (screenshots not received here).
- **r5 — owner-reported:** the region appears on the owner's wide monitor and disappears on the normal monitor. This supports an environment dependence; it does not identify the cause.

### 3.2 Hypotheses — none asserted

| | Hypothesis | For | Against / unknown |
| --- | --- | --- | --- |
| H1 | Outlook's layout width was fixed when the window or pane was narrower (or a side pane was open) and was not recomputed | The width is the same in every screenshot of the session; the paint outside it varies, which suggests a repaint effect | Not shown |
| H2 | A display-scale mismatch (e.g. a laptop screen and an external monitor with different Windows scale settings) | 2532 / 2112 = 1.199, close to a 120 % factor; the taskbar shows a laptop battery | Windows offers 125 %, not 120 %, as a standard step; the scale was not reported |
| H3 | The template, or an interaction between the template and the client or display | Not excluded (r5): the layout width is the client's, but how Outlook sizes a page can depend on the markup | Weighed against, not excluded: the same HTML fills the surface in S2, M4 and M6; the markup has no width near 2112 px; the region is not a template colour |

### 3.3 One targeted owner action (A-02)

In the **same maximised Outlook window**, Zoom 100 %, message background **dark**:

1. Open [`proposals/review-emls/CONTROL-F02-plain-layout.eml`](proposals/review-emls/CONTROL-F02-plain-layout.eml) — a synthetic message with **no Valida markup**: a dark body and one 100 %-width grey table. Take one full-window screenshot.
2. Open `SYNTHETIC-acknowledgement.eml` and take one full-window screenshot.
3. Report the Windows display **Scale** of the screen showing Outlook (Settings › System › Display › Scale), and whether another screen with a different Scale is connected.

Reading the result (r5, revised): if the control's grey table also stops short of the right edge, the behaviour is **not specific to the Valida markup**; the owner may then decide to record it as an environment-dependent client behaviour — until that decision F-02 stays **OPEN**. If the control fills the surface and the ACK does not, F-02 becomes a template finding and a targeted markup experiment follows (as a review mockup first). Either way the screenshots should be taken on the **wide monitor**, where the owner sees the region.

## 4. F-03 — horizontal overflow at 200 % in a narrow window

### 4.1 Three different mechanisms

| Mechanism | What it does | How `b6-2` responds |
| --- | --- | --- |
| **Whole-message zoom** (Outlook classic's Zoom) | Scales everything: text, images **and fixed widths** | The Outlook-only wrapper is fixed at 600 px, so at 200 % it needs about 1,200 px plus margins. Outlook's renderer is widely reported to ignore `max-width` and media queries (not verified here), so nothing narrows it. **Overflow is expected whenever the message area is narrower than about 600 × zoom.** |
| **Text-only resizing** (a client or OS setting that enlarges text only) | Text grows; layout widths stay | The column stays 600 px wide and the text wraps inside it; no fixed heights (spec §5), so nothing should clip. Whether Outlook classic offers such a mechanism for message bodies is **not established**. |
| **Responsive reflow** (narrow viewports in clients that apply media queries) | The column follows the screen up to 600 px; gutters drop to 24 px at ≤ 480 px | Chromium previews: no overflow at 320 / 390 px (browser only). Not applicable to Outlook classic. |

So F-03 is the first mechanism. The fixed-width fallback involved is the `<!--[if mso]>` wrapper at `templates.js` line 210 (closed at line 227). Long values are not the cause: they wrap at an effective 100 % (S6, S7).

### 4.2 Reachable or lost?

Not determinable from what was received here. A horizontal scrollbar normally means the overflow can be scrolled to, but whether every word becomes visible when scrolled fully right — and whether the ACK overflows the same way — has not been shown here. **r5:** even if every word is reachable, that does **not** close F-03: plan C1 treats horizontal scrolling at desktop width as not acceptable and C8 requires reflow at 200 %. Reachability only decides which remedy is proportionate. The owner-reported 200 % checks of the C2+P04 mockups (no problems; window width not recorded) do not change this: the mockups keep the same fixed 600 px Outlook wrapper.

### 4.3 Remedies — smallest first

| | Change | Effect | Cost |
| --- | --- | --- | --- |
| **R-03-A** (only if A-03 shows everything reachable, and only by an explicit owner decision) | **No template change.** Correct the spec §9 sentence and split plan C8 into text-only resizing (must reflow) and whole-message zoom. Record one bounded, explained limitation for the owner's decision: *Outlook classic only; whole-message zoom; message area narrower than about 600 px × the zoom factor; horizontal scrolling on one axis; no content lost.* | Keeps the line-length cap that Doc 03 §82–83 asks for ("text measure remains controlled"; "content does not grow endlessly") | Readers who zoom Outlook classic in a narrow window scroll sideways. By analogy with Doc 16 §39–40 and WCAG 1.4.10 this is a reflow shortfall in that client; the owner decides whether to accept it — **this is not a blanket exception** |
| **R-03-B** (if anything is lost, or the owner rejects R-03-A) | `templates.js` line 210: `width="600"` → `width="100%"` in the Outlook-only wrapper | Outlook classic reflows at any zoom | In Outlook classic the column would span the whole message area: about **2,030 px of text width** in the S1 window at 100 % (roughly 250 characters per line) — against Doc 03 §82–83. Its rendering must be checked in Outlook before any approval |

**Recommendation (PROPOSED, r5):** A-03 first (existing screenshots, no repeat). If content is lost: R-03-B, verified in Outlook. If nothing is lost: the owner chooses between R-03-B (reflow, longer lines) and R-03-A (an explicit, bounded limitation). **F-03 stays OPEN until that choice is recorded and the A1-OC cell is retested at 200 % in a narrow window.**

### 4.4 r7 — the masthead constraint, the remedies re-examined, and one recommended bounded decision

**What changed since r5.** The owner approved C2 (OD-2026-11-02-01): since `b6-3`, the header row is **one 600 × 108 image** (the 1,200 × 216 file at 600 × 108 by attribute). In `b6-2` the header image was 158 px wide, so only the wrapper fixed the width; now the image does too.

**The constraint (documented Outlook classic behaviour):**

| Rule | Source | Effect on the masthead |
| --- | --- | --- |
| CSS `width` is not applied to `<img>` | caniemail, "width property": Outlook for Windows 2007–2019 — "Partial. Not supported on `<body>`, `<span>`, `<div>`, `<p>` or `<img>` elements." | The masthead's `width:100%; max-width:600px; height:auto` is ignored; the image is laid out at its `width="600"` attribute |
| A percentage `width` attribute on `<img>` is computed from the image file | caniemail, "width attribute": "Percentage width on `<img>` elements are based on the physical file's width, not on the parent element's width." | `width="100%"` would give 1,200 px (the file), not the column — no fluid image either |
| `max-width` is not honoured | Spec §6.1; Badsender, "Outlook email display problems" (2024) | Nothing caps or shrinks the column from CSS |

**Consequence.** In Outlook classic the message cannot be narrower than **600 CSS px** (plus Outlook's margins), **whatever the wrapper does**. At whole-message zoom 200 % that is about 1,200 device px plus margins — EV-S3-OC4 Z1 measured about 1,200–1,220 px in a 1,019 px area. So:

- the `b6-3` wrapper (R-03-C) cannot remove F-03 on its own; GPT's point that the wrapper may not be the sole cause is confirmed — the image is a binding cause;
- **R-03-B** (a fluid Outlook wrapper), which r5 said would make "Outlook classic reflow at any zoom", **no longer would**: that held only for the 158 px `b6-2` logo;
- the r6 development previews over-stated R-03-C (§0b); J7 ([`../b6-3/evidence/J7-word-constraint-model.log`](../b6-3/evidence/J7-word-constraint-model.log)) applies the three rules above in a browser and gets the same overflow for all three wrappers: 90 / 200 / 280 CSS px at 510 / 400 / 320 px. Applied to the mockup's fixed wrapper at 510 px, it reproduces EV-S3-OC4 Z1 (overflow about 90–100 CSS px, headline inside the view). **J7 is a model, not Outlook.**

**Zoom, text resizing and reflow — kept apart** (plan §11.4; Doc 16 §§37–40):

| Mechanism | `b6-3` in Outlook classic (expected) | Requirement it bears on |
| --- | --- | --- |
| Whole-message zoom (Outlook's Zoom) | Scales every width, the 600 px image included: sideways scrolling whenever the message area is narrower than about 600 × zoom CSS px plus margins; nothing is clipped by the template (no fixed heights; `overflow:hidden` only on the hidden preheader); reachability to be shown in O-A | Doc 16 §38 ("usable at high zoom") and, by analogy, §39–40 (reflow at ≈ 320 CSS px without two-dimensional scrolling; no unintended horizontal scroll): **not met in this one client below 600 CSS px** |
| Text-only resizing | Whether Outlook classic offers it for message bodies is not established. If it does, text grows inside the 600 px column and wraps (no fixed heights); the image is unaffected | Doc 16 §37 (text resize 200 %): not affected by the image constraint |
| Responsive reflow | Not available in Outlook classic for images (rules above). Clients that apply CSS widths to images reflow down to 280 px (J6, browser) | Plan C1 at 320 / 390 px in those clients (Stage 3) |

This is a reflow shortfall **in Outlook classic only**, caused by the approved single-image masthead meeting that client's documented limits. It is **not** a blanket WCAG failure of the message, and **not** an exemption: whether the shortfall is acceptable is the owner's decision.

**Remedies re-examined — none is a defensible correction within the approved design:**

| Option | Why not (now) |
| --- | --- |
| Keep R-03-C, or restore the fixed 600 px wrapper | Neither changes the 600 px floor (J7); the choice between them only matters for desktop rendering, which O-A shows |
| R-03-B, a fluid Outlook wrapper | Same floor (J7); and on a wide monitor the text would run the full message width |
| A percentage width on the image | Computed from the 1,200 px file in Outlook classic (rule 2) — a larger, not a fluid, image |
| Two images switched by a media query or by Outlook-only markup | Depends on Outlook applying CSS sizing or visibility to images, which rule 1 says it does not for width; unverifiable here; duplicates the masthead in the markup |
| A VML-drawn band (a percentage-width shape filled with the image) | A new Outlook-only rendering path, untested here, exposed to Outlook's light/dark and DPI handling; not the image the owner approved as rendered |
| A smaller fixed masthead for Outlook classic only | Changes the approved appearance at every width in that client (at 320 px the logo would be about half its approved size); needs a new design approval |
| The masthead in its own table, so only the band overflows | Still a page-level horizontal scrollbar (plan C1 / Doc 16 §40 not met); depends on Word table behaviour that is not verified |

**Recommended bounded decision — D-6 (revised r7; replaces the r6 wording in the blockers list):**

> "For Outlook classic only, I accept as a documented limitation that the approved 600 px C2 masthead keeps the message at least 600 CSS px wide, so when Outlook's whole-message zoom makes it wider than the message area, the message scrolls sideways on one axis. This acceptance applies only if owner check O-A on the `b6-3` fixtures shows: (1) no sideways scrolling at Zoom 100 % in a normal or maximized window, nor on the wide monitor; (2) no sideways scrolling at Zoom 200 % in a maximized window on the main monitor; (3) at Zoom 200 % in a narrow window, every word reachable by scrolling on one axis, nothing clipped or overlapping; and (4) the desktop layout as in the mockups I reviewed. It does not apply to any other client, where plan C1 and C8 apply in full, or to text-only resizing. If (4) fails because of the Outlook-only wrapper, the fixed 600 px wrapper of the mockups is restored (a one-line change) and that view is rechecked."

**Closure path.** O-A on `b6-3` → if (1)–(4) hold and D-6 is approved, F-03 is **closed by owner decision as a bounded limitation**; if D-6 is not approved, F-03 stays **OPEN** and the remaining route is a new design decision for Outlook classic (not recommended: it trades the approved appearance for every Outlook user against an edge case of zoom in a narrow window).

### 4.5 r8 — D-6 approved (OD-2026-11-02-02)

The owner approved D-6 in the owner's own wording ([OD-2026-11-02-02](../../review/OWNER_DECISION_2026-11-02-02_B6_D6.md) §1), which **replaces** the "recommended bounded decision" text of §4.4 and its four conditions. F-03 is accepted as a bounded known limitation for Outlook classic (narrow window or high whole-message zoom), on the condition that all content remains readable and accessible by scrolling. It is not a reflow PASS, applies to no other client and not to text-only resizing, and waives no other accessibility, security, privacy or functional requirement. **No further cosmetic redesign of F-03 is requested.** The analysis in §4.4 stays as the deviation's reason and alternatives (Doc 16 §284).

## 5. F-04 — secondary-text contrast

### 5.1 Measured (addendum §3)

| Text | Light rendering | Dark rendering | Result |
| --- | --- | --- | --- |
| Eyebrow (12 px, 500) | 3.75 | 8.83 | **Light FAIL** |
| Metadata labels (12 px) | 2.48 | 5.52 | **Light FAIL** |
| Footer (13 px) | 2.48 | 5.52 | **Light FAIL** |
| Body, note | 4.75 | 10.64 | Pass (light margin 0.25) |
| `CAREERS` | 4.88 | 10.95 | Pass |
| Headline (large), values | 11.14 | 18.24 | Pass |

Uncertainty: ±1 colour level moves the ratios near the threshold by at most ±0.12; no result changes. The source-colour ratios of spec §4 hold for the dark rendering only; they cannot be used for the light one.

### 5.2 Why mid-tones fail

Outlook's light rendering approximately mirrors lightness (fitted from the measured pairs: text L\*out ≈ 116.7–121.1 − L\*in). Light source colours become dark and readable; mid-tones stay mid-tones. `#7E8997` (L\* 57) became `#8D97A5` (L\* 62). The fix is to use light source colours for secondary text, which also keeps them readable in the dark design.

### 5.3 Corrections (PROPOSED)

| | Change | Light rendering | Dark | Basis |
| --- | --- | --- | --- | --- |
| **P-04a** | Metadata labels and footer: `#7E8997` → `#B6C0CC` (the body colour) | **4.75 — measured** (the same source colour is already measured as body text in the same screenshots) | 10.64 | Doc 16 §35. Hierarchy kept by size, upper case and tracking (labels) and by size (footer); values stay brighter (`#F4F7FA`) |
| **P-04b** | Eyebrow: `#66B3FF` → `#83C6FF` (the website's focus token) | **4.74–5.52 — PREDICTED** by the lightness model, centre `#00689D` ([`tools/outlook_light_model.py`](tools/outlook_light_model.py)). **r5 — measured lower bound ≥ 4.72** in Outlook (EV-S3-OC2, resized screenshots; §5.4) | 10.73 (measured exact in M5) | Keeps the blue accent. **Fallback** if the measured value is below 4.5: `#B6C0CC` (measured 4.75), losing the blue |
| Not proposed now | Body, note, `CAREERS` | Pass as measured | — | The 4.75 margin is thin; a further step (e.g. `#C9D1DA`, predicted 5.87–6.97) would be a broader change and is not needed by the evidence |

The comparison sheet shows P-04 on the internal notification (mockup; the eyebrow's light colour labelled PREDICTED).

### 5.4 r5 — C2+P04 measured in Outlook classic (EV-S3-OC2; mockup, not the product)

Method and limits: addendum §9.1. The six screenshots arrived **resized to 0.798**, so thin text is blended with its background. A line is **exact** when its peak equals its known ink colour; otherwise the peak is a **lower bound** (no overshoot was found in any line with a known ink colour).

| Text (C2+P04) | Light rendering | Dark rendering | Measured or not |
| --- | --- | --- | --- |
| Headline, values, body, note | 11.14 / 11.14 / 4.75 / 4.75 — exact | 18.24 / 18.24 / 10.64 / 10.64 — exact | **Measured** |
| Footer `#B6C0CC` (P-04a) | **4.75** — exact (M6); ACK footer blended (M2, ≥ 4.35) | 10.64 — exact (M5) | **Measured** (M5, M6) |
| Eyebrow `#83C6FF` (P-04b) | peaks 4.60 (M2), 4.65 (M4), **4.72** (M6) — no known ink colour | 10.73 — exact (M5) | **Lower bound ≥ 4.72.** Meets 4.5 : 1 if the lower bound holds; a 1:1 measurement is still needed. The prediction (4.74–5.52) is neither confirmed nor refuted |
| Metadata labels `#B6C0CC` (P-04a) | peaks 4.04–4.42, all blended | peaks 9.02–9.97, all blended (true 10.64) | **Not reliably measurable here.** 4.75 is **expected** (same source colour as the body, measured 4.75) — an inference, not a measurement |

**F-04 status: OPEN.** On the mockup, the footer is measured and passes; the eyebrow has a passing lower bound; the labels lack a reliable measurement. `b6-2` itself still fails C4 (§5.1). Visual appearance alone is not used to close any line. Smallest check: O-5 (§7.2).

## 6. Implementation proposal (D) — only after the owner's approval

Nothing below is authorised. A change needs: approval of the candidate's **exact asset bytes** (as OD-2026-10-27-01 did for the current file), approval of the treatment, for C2 the wording decision, and an instruction authorising the runtime change.

### 6.1 Files that would change

| File | C2 + P-04 | C3 + P-04 |
| --- | --- | --- |
| `backend/src/integrations/notifications/assets/` | New `valida-email-masthead-1200x216.png` (the approved bytes); `SHA256SUMS.txt` updated; the current `valida-logo-email-316x72.png` retired from the runtime folder (kept in the logo evidence folder and earlier packages; its approval record unchanged) | New `valida-logo-email-plate-412x144.png`; `SHA256SUMS.txt`; the current file retired likewise |
| `backend/src/integrations/notifications/emailLogo.js` | `file`, `sha256`, `width: 600`, `height: 108`, comment (source: the transparent lockup on `#05070A`). **Unchanged:** `contentId`, `filename`, `contentType`, `alt`, the fail-closed hash check | `file`, `sha256`, `width: 206`, `height: 72`, comment; the rest unchanged |
| `backend/src/integrations/notifications/templates.js` | Header row → one cell (padding 0, `font-size:0; line-height:0`) holding the image at `width:100%; max-width:600px; height:auto`; the `CAREERS` cell removed; the unused `.v-header` and `.v-label` media rules removed. P-04: `STYLE.metaLabel` and `STYLE.footer` use the body colour; `COLOR.eyebrow` = `#83C6FF`. `TEMPLATE_VERSION` → `b6-3` | Header padding `18px 40px`; image cell width 206. P-04 as for C2. `TEMPLATE_VERSION` → `b6-3` |
| `backend/tests/b6-stage2-templates.test.js` | T-01 (the expected chunks without `CAREERS`); T-02 (image `width="600" height="108"`); T-08 (the new approved hash, written independently); the version test | T-02 (`width="206" height="72"`); T-08; the version test |
| `backend/tests/b6-notification-service.test.js` | Version assertion (`b6-3`) | Same |
| Fixtures, previews, spec §§3–5, §7, §9; checklist; report | Regenerated / updated | Same |

R-03-B, only if chosen: `templates.js` line 210, `width="600"` → `width="100%"` (T-02's count of three conditional blocks is unchanged).

### 6.2 Safeguards that stay unchanged

Subjects and the grapheme-safe subject rule; preheaders; every approved word — the single exception being `CAREERS` under C2, only if the owner approves it; the UTC timestamp format; the plain-text parts (byte for byte); the privacy rules (no candidate data in INT; in ACK the address only as recipient); the MIME tree `alternative[text/plain, related[text/html, image/png]]` with exactly one image part, the same Content-ID, file name and inline disposition; no remote resource, link or tracking element; HTML ≤ 20 KB; message ≤ 40 KB (review EMLs: ≤ 35.2 KB); `smtpTransport.js`, `transport.js` and `notificationService.js` (retry, conditional claim, idempotency, failure classification) untouched; From, Reply-To, `Auto-Submitted`, DSN parameters and Message-ID untouched.

## 7. Follow-up test plan (E)

### 7.1 Sandbox (Claude) — only after an authorised change

| # | Check | Note |
| --- | --- | --- |
| SB-1 | Focused suites: `b6-stage2-templates`, `b6-notification-service`, `b6-smtp-transport`, `b6-smtp-integration`, `apply-failures`, `b6-apply-notifications` | Relevant change → re-run justified |
| SB-2 | Mutation checks: privacy (T-07) and logo (T-08) still fail when broken | As in Stage 2 |
| SB-3 | Offline gate (`npm run verify:b6` offline part) and the full offline suite | Database gates need the owner's Windows run |
| SB-4 | Regenerate fixtures, hashes and labelled Chromium previews (320 / 390 / 680) | Browser only |
| — | **Nothing is re-run now:** no runtime file changed in this package | Passed suites are not repeated |

### 7.2 Owner-run, offline Outlook classic (authorised: Stage 3 offline EML inspection in Outlook classic only)

r5: checks on the `b6-2` fixtures count towards cell **A1-OC** (now PARTIAL); checks on review mockups inform the owner's decisions but fill no cell. Checks already supported by adequate evidence are **not** repeated.

| # | Purpose | Inputs | Record | r5 status |
| --- | --- | --- | --- | --- |
| **O-3** | F-01 / F-04: the candidates in Outlook itself | C2+P04 and C3+P04 review EMLs | Light and dark, 100 % | **C2+P04: DONE** (EV-S3-OC2, six screenshots). C3+P04: not run — not needed while C2 is evaluated |
| **O-5** (new, smallest for F-04) | F-04: a reliable 1:1 measurement of the labels and the eyebrow | `REVIEW-MOCKUP-C2-P04-internal-long-values.eml` (`595651cb…8525`) | **One** light-mode screenshot at 100 %, as an **un-resized PNG file** (attached as a file, not pasted). If the original files of M4 / M6 are larger than 2048 px wide, sending those instead is enough — no new test | OPEN |
| **A-03** (revised: no repeat) | F-03: reachable or lost; ACK too? | The narrow-window 200 % screenshot(s) already supplied to GPT | Share them here. Only if none shows the view **scrolled fully right**: one such screenshot of `SYNTHETIC-internal-long-values.eml` in the same narrow window at 200 % | OPEN |
| **A-02** | F-02: Valida markup vs any HTML message | `CONTROL-F02-plain-layout.eml`, `SYNTHETIC-acknowledgement.eml` | On the **wide monitor**: two full-window screenshots and the Windows display Scale of both monitors (§3.3) | OPEN — optional (Low severity) |
| O-4 (optional) | F-01 scope | `SYNTHETIC-acknowledgement.eml` | With a **light Office theme**: one screenshot — does Outlook transform the dark message at all? | NOT RUN |

For every check: the file's SHA-256 (from [`review-emls-index.json`](proposals/review-emls/review-emls-index.json) or plan §1), the client version, the network state as the owner observed it. Screenshots are measured as in the addendum §3 / §9.

The review EMLs are **review mockups, not product output**: they reuse the fixture's headers and plain text, carry the candidate HTML and image, add `X-Valida-Review: PROPOSED mockup …; not product output; do not send`, and are re-serialised by Python's email package (header order and encoding details differ from nodemailer; a `MIME-Version` header appears on re-encoded parts). Built by [`tools/make_review_emls.py`](tools/make_review_emls.py), which re-reads each file and asserts that the plain text, the From / To / Date / Message-ID / Auto-Submitted headers, the MIME tree and the Content-ID are unchanged. **Never send them.**

### 7.3 Future, separately authorised delivery testing

Unchanged: the Stage 3 plan Part B (routes R1 / R2 / R3 within the 4-message budget) after Stage 3 authorisation and a separate live-email authorisation — run on the **approved** revision, not on these mockups.

## 8. Proposed decision texts (for the owner, when ready — none approved)

Each is specific; none is a blanket exception. **r5:** the owner's positive preference for C2 (OR-2026-11-01-01) is recorded; it does not stand in for any item below. Items 1a and 1b are separate decisions.

- **1a — C2 asset bytes:** "I approve the masthead image `C2-masthead-1200x216.png`, SHA-256 `ac67a2cb7d447a55d89bb3264198743d4114190e259775535215acabba1aea3b`, for the email header." (Alternative, if C2 is not pursued: "I approve candidate C3 (logo plate), asset `C3-plate-412x144.png` SHA-256 `73adbe4c3d49697fefc52b7779ec2946898cf39be32b31baabd4f535edfbb95a`; no wording change.")
- **1b — header label:** "I approve removing the header label `CAREERS` from the HTML of both emails; all other wording unchanged." — required for C2 only.
- **2 — F-04:** "I approve P-04a (labels and footer `#B6C0CC`) and P-04b (eyebrow `#83C6FF`, falling back to `#B6C0CC` if its Outlook light rendering measures below 4.5 : 1 at 1:1)." Best taken after O-5.
- **3 — F-03 (after A-03):** either "Apply R-03-B (fluid Outlook wrapper) as a review mockup for an Outlook check" or "I accept, as a documented limitation, horizontal scrolling on one axis in Outlook classic when its whole-message zoom makes the 600 px column wider than the message area, provided no content is lost; text-only resizing must still reflow." Either way F-03 is retested in a narrow window.
- **4 — runtime:** a separate instruction authorising the implementation of the approved items (§6), with no live email.

Still open whatever is decided: mobile sizing of the band (real devices), images-disabled behaviour, other clients and the rest of the accessibility coverage.

## 9. What this package did not do

No change to `backend/`, `frontend/` or any `package*.json`, to tests, to the deliverable's assets or to verification scripts (r4 and r5); no new dependency; no email sent; no mailbox or online account accessed; no Outlook used by Claude; no commit, push, merge, deployment, DNS change or purchase; no B7 work; no passed product suite re-run.
