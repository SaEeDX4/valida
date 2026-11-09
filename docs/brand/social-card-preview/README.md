# Social card — approved for local integration; final visual sign-off pending

| | |
| --- | --- |
| Authority | [OD-2026-11-09-01](../../review/OWNER_DECISION_2026-11-09-01_C4_RECRUITMENT_ORIGIN_TITLES_SOCIAL.md), R5: "The owner authorizes a 1200 × 630 social-card preview and proposed alt text. Final asset approval is pending." |
| Governing | Doc 16 §§94–97 (Open Graph, social card 1200 × 630, social image truth); Doc 03 §§8, 13, 16–20, 22 (colours, gradient, logo rules, type); Doc 06 §§4, 6, 13–14 (copy) |
| Status | **Local integration authorised** by [OD-2026-11-09-02](../../review/OWNER_DECISION_2026-11-09-02_C4_SOCIAL_CARD_AND_ELIGIBLE_WORK_COUNTRIES.md): the exact PNG and the alt text below are approved for integration; **the owner's final visual sign-off is pending**. This folder stays the reviewed source and is still not a build input. The site serves the same bytes from `frontend/public/social/valida-social-card-1200x630.png` |

## The image

| | |
| --- | --- |
| File | [`valida-social-card-preview-1200x630.png`](valida-social-card-preview-1200x630.png) |
| Dimensions | **1200 × 630** px, RGB PNG, rendered at device scale factor 1 |
| SHA-256 | `2667d6191d73696e5b82019cc301aef82345dddc5e5c6645f6ac5abe5af9a71a` (213,187 bytes) |
| Rendered with | `node docs/brand/social-card-preview/render.mjs`. Chromium 153.0.8010.12, from e2e's `@playwright/test`. A render on another machine or browser build may differ in bytes; the checksum identifies this delivered file |

**Approved alt text (OD-2026-11-09-02), exactly as used in `og:image:alt`:**

> Valida logo with the headline "Secure systems. Deliberate engineering." and the line "Valida is a Lithuanian technology company focused on cybersecurity, secure technology, and security engineering."

(The preview round proposed the same words with typographic quotation marks; the approval uses straight ones.)

## What it is made of — approved inputs only

| Element | Source | Treatment |
| --- | --- | --- |
| Logo | `frontend/public/brand/valida-logo-horizontal-transparent.png`. This is the approved pack of 2026-09-10, the "preferred header/navbar lockup on dark surfaces". SHA-256 `f274e8ba…3377`, matching `SHA256SUMS.txt` | Scaled only, from 1009 × 230 to 281 × 64, with the aspect ratio kept. It sits on the brand's dark surface. Not redrawn, recoloured, cropped or given effects (brand README rules 1–4; Doc 03 §20) |
| Background | Doc 03 §13's gradient example: `radial-gradient(circle at 70% 30%, rgba(50,143,255,0.14), transparent 42%), #05070A` | — |
| Colours | Doc 03 §8: text `#F4F7FA`, second headline line silver `#C9D1DA` (as on the Home hero), description `#B6C0CC`, eyebrow `#7E8997`, accent rule `#328FFF` → transparent | Computed contrast on `#05070A`: 18.8, 13.1, 11.0 and 5.7 : 1. At the glow's brightest pixel (`#0C1A2D`): 16.3, 11.3, 9.5 and 4.9 : 1 |
| Type | Doc 03 §22: Space Grotesk 600 for the headline, Inter 400/500 for the rest. The site's own `@fontsource` 5.3.0 files | Headline 76 px, line height 1.05, tracking −0.03em (the site's display tracking) |
| Eyebrow | Doc 06 §13: "CYBERSECURITY · SECURE TECHNOLOGY" | With the site's eyebrow accent rule |
| Headline | Doc 06 §6 / §14: "Secure systems." / "Deliberate engineering." | Two lines, as on the Home hero |
| Description | Doc 06 §4, the canonical short description: "Valida is a Lithuanian technology company focused on cybersecurity, secure technology, and security engineering." | — |

**Nothing else is on the card.**
- No domain, no call to action, no vacancy, no claim beyond the approved copy.
- No dashboard, padlock, shield artwork or network graphic (Doc 03 §107; Doc 16 §96).

## Not a build input

- This folder lives under `docs/`.
- Vite builds from `frontend/`, and only `frontend/public/` is copied into `dist/`.
- The card source references the brand files and fonts in place; it copies nothing into the frontend.

The C4 verification checks that the built `dist/` contains no file or reference from this folder.

## Integration (OD-2026-11-09-02, local)

1. Done: the exact bytes are copied to `frontend/public/social/valida-social-card-1200x630.png`. It is the same git blob, `78116a83…`. The brand pack and its `SHA256SUMS.txt` are untouched. A test pins the hash and the 1200 × 630 size.
2. Done: `og:image` (absolute, on `https://cybervalida.com`), `og:image:width` 1200, `og:image:height` 630 and `og:image:alt` on every page with Open Graph (`frontend/src/seo/socialCard.js`, `head.js`). They are verified in the initial HTML and after client navigation (stack case C4-12).
3. Open: the owner's final visual sign-off; real platform previews on the production host (Doc 16 §266, C6).
