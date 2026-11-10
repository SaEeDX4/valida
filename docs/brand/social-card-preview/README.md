# Social card — revision 2; final visual sign-off pending

| | |
| --- | --- |
| Authority | [OD-2026-11-09-01](../../review/OWNER_DECISION_2026-11-09-01_C4_RECRUITMENT_ORIGIN_TITLES_SOCIAL.md) R5 (preview); [OD-2026-11-09-02](../../review/OWNER_DECISION_2026-11-09-02_C4_SOCIAL_CARD_AND_ELIGIBLE_WORK_COUNTRIES.md) A1 (integration of revision 1); [OD-2026-11-09-03](../../review/OWNER_DECISION_2026-11-09-03_C4_CARD_REVISION_SHARING_COPY_SEQ1.md) §2 (revision 2: spacing and approved copy) |
| Governing | Doc 16 §§94–97 (Open Graph, social card 1200 × 630, social image truth); Doc 03 §§8, 13, 16–20, 22 (colours, gradient, logo rules, type); Doc 06 §§4, 6, 13–14 (copy), §4 as amended for social sharing by OD-2026-11-09-03 |
| Status | **Revision 2 is the active card. Final visual sign-off is pending the owner's inspection.** This folder is the reviewed source and is not a build input. The site serves the same bytes from `frontend/public/social/valida-social-card-v2-1200x630.png` |

## The images

| | Revision 2 — active | Revision 1 — kept, no longer served |
| --- | --- | --- |
| File | [`valida-social-card-v2-1200x630.png`](valida-social-card-v2-1200x630.png) | [`valida-social-card-preview-1200x630.png`](valida-social-card-preview-1200x630.png), unchanged |
| Dimensions | **1200 × 630** px, RGB PNG, device scale factor 1 | 1200 × 630 |
| SHA-256 | **`c86554a2a7ea2cc020eccdb8d3e5a8171de0518e9eeaefba804197171a8cc2a5`** (214,945 bytes) | `2667d6191d73696e5b82019cc301aef82345dddc5e5c6645f6ac5abe5af9a71a` (213,187 bytes) |
| Decision | OD-2026-11-09-03 | OD-2026-11-09-01 R5, integrated by OD-2026-11-09-02 |

**Rendering.**
- Command: `node docs/brand/social-card-preview/render.mjs`. It writes revision 2 and refuses to overwrite revision 1.
- Browser: Chromium 153.0.8010.12, from e2e's `@playwright/test`.
- A render on another machine or browser build may differ in bytes. The checksum identifies the delivered file.

**Approved alt text (OD-2026-11-09-03), exactly as used in `og:image:alt`:**

> Valida logo with the headline "Secure systems. Deliberate engineering." and the line "Valida is a technology company focused on cybersecurity, secure technology, and security engineering."

## What changed in revision 2

| Measure | Revision 1 | Revision 2 |
| --- | --- | --- |
| Layout gap, logo box bottom → eyebrow line box top (CSS px) | 125.8 (the free space of `justify-content: space-between`) | **80** (`.text { margin-top: 80px }`) |
| Visible gap, last logo pixel row → first eyebrow pixel row (image px) | 136 | **90** |
| The same gap in a 500 × 262 preview | ≈ 57 px | ≈ 37 px |
| Description | "Valida is a Lithuanian technology company focused on cybersecurity, secure technology, and security engineering." | "Valida is a **technology company** focused on cybersecurity, secure technology, and security engineering." |

**The text group moves up together.** Its internal 24 px gaps are unchanged.

**Unchanged:**
- **The logo**, in position and treatment. The top 200 px of the two images are pixel-identical.
- The headline, type, colours, background and canvas.

The rendering script reports the layout gaps on every run.

## What it is made of — approved inputs only

| Element | Source | Treatment |
| --- | --- | --- |
| Logo | `frontend/public/brand/valida-logo-horizontal-transparent.png`. This is the approved pack of 2026-09-10, the "preferred header/navbar lockup on dark surfaces". SHA-256 `f274e8ba…3377`, matching `SHA256SUMS.txt` | Scaled only, from 1009 × 230 to 281 × 64, with the aspect ratio kept. It sits at the top left (box y 72–136) on the brand's dark surface. Not redrawn, recoloured, cropped or given effects (brand README rules 1–4; Doc 03 §20) |
| Background | Doc 03 §13's gradient example: `radial-gradient(circle at 70% 30%, rgba(50,143,255,0.14), transparent 42%), #05070A` | — |
| Colours | Doc 03 §8: text `#F4F7FA`, second headline line silver `#C9D1DA` (as on the Home hero), description `#B6C0CC`, eyebrow `#7E8997`, accent rule `#328FFF` → transparent | Computed contrast on `#05070A`: 18.8, 13.1, 11.0 and 5.7 : 1. Even at the glow's brightest pixel (`#0C1A2D`), the worst case anywhere on the card: 16.3, 11.3, 9.5 and 4.9 : 1 |
| Type | Doc 03 §22: Space Grotesk 600 for the headline, Inter 400/500 for the rest. The site's own `@fontsource` 5.3.0 files | Headline 76 px, line height 1.05, tracking −0.03em (the site's display tracking) |
| Eyebrow | Doc 06 §13: "CYBERSECURITY · SECURE TECHNOLOGY" | With the site's eyebrow accent rule |
| Headline | Doc 06 §6 / §14: "Secure systems." / "Deliberate engineering." | Two lines, as on the Home hero |
| Description | Doc 06 §4, as amended for **social sharing only** by OD-2026-11-09-03: "Valida is a technology company focused on cybersecurity, secure technology, and security engineering." | Two lines |

**Nothing else is on the card.**
- No domain, no call to action, no vacancy, no claim beyond the approved copy.
- No dashboard, padlock, shield artwork or network graphic (Doc 03 §107; Doc 16 §96).

## Not a build input

- This folder lives under `docs/`.
- Vite builds from `frontend/`, and only `frontend/public/` is copied into `dist/`.
- The card source references the brand files and fonts in place; it copies nothing into the frontend.

## Integration

1. **The asset.** Revision 2's exact bytes are at `frontend/public/social/valida-social-card-v2-1200x630.png`.
   - A test pins its hash and 1200 × 630 size, and checks that both files here keep their hashes.
   - The revision 1 file is removed from `frontend/public/`, so the build no longer serves it.
   - A revised card gets a new file name, so one URL never stands for two images.
2. **The tags** (`frontend/src/seo/socialCard.js`, `head.js`): on every page with Open Graph, verified in the initial HTML and after client navigation (stack case C4-12):
   - `og:image`, absolute, on `https://cybervalida.com`;
   - `og:image:width` 1200 and `og:image:height` 630;
   - `og:image:alt`.
3. **The sharing description.** Home's `og:description` is the social-sharing description of OD-2026-11-09-03; every other route shares its own search description. Home's `<meta name="description">` is unchanged.
4. **Open:**
   - the owner's final visual sign-off;
   - real platform previews on the production host (Doc 16 §266, C6).
