# Concept A — Graphite Letter: email specification for both notification templates

| | |
| --- | --- |
| Decision | **Visual direction APPROVED** for `APPLICATION_ACKNOWLEDGEMENT` and `APPLICATION_RECEIVED_INTERNAL` (OD-2026-10-26-01, D4). Concepts B and C are not used. |
| Status of this specification | **PROPOSED**, for owner approval — **except** the elements the owner approved on 2026-10-26 (OD-2026-10-26-02): the subject rule (§6.2); the official dark logo delivered inline as CID (§7.1 source choice and §7.2 option A — the derived file still needs its own approval); and the timestamp format. **rev 7:** implementation **AUTHORISED** by [OD-2026-10-26-03](../review/OWNER_DECISION_2026-10-26-03_B6_STAGE2_AUTHORISATION.md), which also has the rest of this specification implemented **as proposed, for review** (for implementation purposes only, not final production approval). **Implemented** as template version `b6-2` in the recovered working copy (not committed). **rev 8:** the derived logo file (SHA-256 `b8c54174…341a`) is **APPROVED** with its black field ([OD-2026-10-27-01](../review/OWNER_DECISION_2026-10-27-01_B6_LOGO_ASSET.md)) and **integrated** (§7.2 option A, §11). **Email-client rendering NOT RUN.** **Production activation NOT AUTHORISED.** |
| Copy | The words are specified separately in [`EMAIL_COPY_PROPOSAL.md`](EMAIL_COPY_PROPOSAL.md) and are **APPROVED** (OD-2026-10-26-02). This document fixes layout, styles, structure and behaviour only. |
| What "approved direction" means | Concept A is a direction, **not** a promise of pixel-identical rendering in every client. §10 lists the differences that are acceptable and the ones that are not. |
| Revision | **rev 5** (2026-10-26, after GPT's review of rev 4): §6.2 now states **one** subject rule — only the title segment is limited, to 120 grapheme clusters including the ellipsis; the prefix and suffix are never shortened. §10 and §11 refer to it. Nothing else changed. |
| Revision | **rev 6** (2026-10-26): status of the approved elements recorded (OD-2026-10-26-02) — the header, §6.2 and §7.2. The specification text is unchanged. |
| Revision | **rev 7** (2026-10-26): implementation status recorded (OD-2026-10-26-03) — the header and the §11 heading. The specification text is unchanged. Evidence: [`STAGE2_IMPLEMENTATION_REPORT.md`](../qa/b6-stage2/STAGE2_IMPLEMENTATION_REPORT.md). |
| Revision | **rev 8** (2026-10-27): the derived logo approved and integrated (OD-2026-10-27-01) — the header and the §11 heading. The specification text is unchanged. |
| Status note | **rev 9** (2026-10-27, status note only; no specification text changed). The owner-run offline Outlook classic inspection **EV-S3-OC1** and owner feedback **OF-2026-10-27-01** qualify three statements: §7.1 — the opaque field keeps the logo legible, but the owner rejects its appearance as an isolated black rectangle on a light message background (F-01); §9 — "200 % zoom reflow[s] the column" does not hold for Outlook classic's whole-message zoom, which scales the fixed 600 px Outlook wrapper (F-03); §4 — the computed ratios match Outlook's dark rendering exactly but not its light rendering, where labels and footer measured 2.48 : 1 and the eyebrow 3.75 : 1 (F-04). Proposed corrections: [`F01-F04_FINDINGS_AND_PROPOSAL.md`](../qa/b6-stage3/F01-F04_FINDINGS_AND_PROPOSAL.md) — **PROPOSED**, not applied. |
| Status note | **rev 12** (2026-11-02, r8; status note only — no template change): owner decision **OD-2026-11-02-02 (D-6) APPROVED** ([record](../review/OWNER_DECISION_2026-11-02-02_B6_D6.md)). For **Outlook classic only**, in a narrow window or at high whole-message zoom, horizontal scrolling is accepted provided all content remains readable and accessible by scrolling: the §9 sentence ("… 200 % zoom reflow[s] the column") is qualified to that extent — an **accepted deviation**, not a reflow pass. §9 applies unchanged to every other client and to text-only resizing; no other requirement of this specification is relaxed. The rev 11 note below is kept as written. |
| Status note | **rev 11** (2026-11-02, r7; status note only — no template change): two §0 rows corrected by the F-03 investigation ([findings §4.4](../qa/b6-stage3/F01-F04_FINDINGS_AND_PROPOSAL.md)). Outlook classic lays out the masthead at its 600 px width attribute (it applies no CSS width to images, resolves a percentage width against the 1,200 px file and ignores `max-width`), so in that client the message cannot be narrower than 600 CSS px, whatever the wrapper; the §6.1 wrapper cannot narrow the column there, and the §9 statement does not hold for Outlook classic's whole-message zoom. Owner decision D-6 (revised) is proposed. |
| Revision | **rev 10** (2026-11-02): **C2 masthead, removal of the header label `CAREERS` and P-04 colours APPROVED** by [OD-2026-11-02-01](../review/OWNER_DECISION_2026-11-02-01_B6_C2_P04.md) and **implemented** as template `b6-3` ([report](../qa/b6-3/B6-3_IMPLEMENTATION_REPORT.md)), with a layout fix to the Outlook-only wrapper (F-03). **§0 lists every amended statement and takes precedence over the sections it names**; the original text below is kept as the record and is marked where it is superseded. Email-client rendering of `b6-3`: **NOT RUN**. |

## 0. rev 10 amendments — template `b6-3` (OD-2026-11-02-01)

| Section | Superseded statement (kept below as the record) | Current specification |
| --- | --- | --- |
| §2, §3, §3.1, §3.2, §5 | Header: the 158 × 36 logo, then the label `CAREERS` (hidden at ≤ 480 px); header padding 36 px 40 px | **The header row is one image**: the approved C2 masthead (`C2-masthead-1200x216.png`, SHA-256 `ac67a2cb7d447a55d89bb3264198743d4114190e259775535215acabba1aea3b`), 600 × 108 by attribute, `width:100%; max-width:600px; height:auto`, in a cell on `#05070A` with padding 0. **No header label.** No text is drawn into the image. Reading order: masthead (alt "Valida"), eyebrow, headline, … |
| §2, §3, §4 | Metadata labels and footer `#7E8997` (5.52 : 1 computed); eyebrow `#66B3FF` (8.83 : 1 computed) | **Metadata labels and footer `#B6C0CC`** (10.64 : 1 computed on `#080C11`); **eyebrow `#83C6FF`** (10.73 : 1 computed). In Outlook classic's light rendering these measured 4.75 and 4.72 : 1 on the review mockups (EV-S3-OC3) — the build itself still to be checked |
| §4 | Header label `CAREERS` row | Removed with the label |
| §6.1 | The Outlook-only wrapper is a fixed 600 px table | **An Outlook-only full-width table whose middle cell asks for 600 px** and whose side cells take the rest — 600 px where there is room, narrower where there is not (finding F-03). Its behaviour in Outlook must be confirmed (Stage 3 A1-OC). **rev 11:** in Outlook classic the 600 px masthead image sets the minimum width, so this wrapper cannot narrow the column below 600 CSS px there; it can only keep it at 600 px on wide layouts (as the fixed table did) |
| §7 | The logo: the opaque dark lockup, 316 × 72 derived file, shown 158 × 36 (OD-2026-10-27-01) | **The masthead image** above; derived from the approved transparent lockup, resampled only, on the canvas colour; its bytes pinned (fail-closed). The b6-2 file stays on record in `docs/qa/b6-stage2/logo/`. Inline CID, Content-ID and file name unchanged |
| §7.2 | "the CAREERS label and the footer identify the sender" when images are blocked | When images are blocked, the alt text "Valida" (on the dark band), the eyebrow and the footer identify the sender; no information is carried by the image |
| §8 | "the opaque variant keeps its own dark field" | The masthead keeps the mark on its dark surface whichever background a client applies to the HTML |
| §9 | "with no fixed heights, increased text size and 200 % zoom reflow the column" | True for text-only enlargement and for browser-style zoom; for Outlook classic's whole-message zoom it depends on the wrapper above and is **to be verified**. The masthead has no fixed CSS height. **rev 11:** not true for Outlook classic's whole-message zoom — the message stays at least 600 CSS px wide there (the masthead image), so a message area narrower than about 600 × zoom scrolls sideways; a bounded limitation for the owner's decision (D-6) |
| §9 | Presentational labels (`CAREERS`, the eyebrow) are omitted from the plain text | The eyebrow is omitted from the plain text (unchanged); `CAREERS` no longer exists |
| §1 | Inputs inspected | Add: owner screenshots EV-S3-OC1, EV-S3-OC2, EV-S3-OC3 and (rev 11) EV-S3-OC4 (`docs/qa/b6-stage3/`) |

## 1. Inputs, and what was actually inspected

| Input | Identity | What it is — and is not |
| --- | --- | --- |
| Concept A board | [`assets/concept-a-graphite-letter-board.png`](assets/concept-a-graphite-letter-board.png), 1120 × 1833 px, SHA-256 `eaa814eb1e7d85380911754c68a0c762c3d6ad19fd739c8da7e9ae16df714470` (received as `62e8fb12-image.png`) | An owner-supplied **design mockup** ("CONCEPT ONLY · Proposed copy · Synthetic role / reference · Not email-client render evidence"). It is **not** HTML output and **not** a screenshot of any mail client. Measurements taken from it are approximate. |
| Frontend tokens | `frontend/src/styles/tokens.css` at baseline `ec15048` | Read in the worktree: colours, type scale, spacing, radius, borders |
| Typography and eyebrow | `frontend/src/styles/typography.css`; `components/layout/Section/Section.module.css` (`.eyebrow`, 24 × 1 px accent rule); `pages/CareersPage.module.css` (`.heroRule`, 64 × 2 px) | Read |
| Approved logo assets | `frontend/public/brand/README.md` (approved 2026-09-10); `valida-logo-horizontal-transparent.png` (1009 × 230, RGBA, SHA-256 `f274e8ba…3377`, used by the website header); `valida-logo-horizontal-dark.png` (1009 × 230, RGB on opaque `#000000`, SHA-256 `920db434…dc5e`). Both hashes match `public/brand/SHA256SUMS.txt`. | Read; dimensions, colour type and edge pixels checked. No image was generated, resized or redrawn. |
| Website logo use | `components/layout/Header/BrandLogo.jsx` and its CSS | Displayed at 34 px tall on mobile and 38 px on desktop; aspect ratio preserved; no filter |
| Current templates | `backend/src/integrations/notifications/templates.js` (`TEMPLATE_VERSION = 'b6-1'`) | Read: white background, Arial, no images, no links |

**Not done:** no deployed website was viewed; no build was run; nothing was rendered in a browser or a mail client. Contrast ratios below are **computed from declared colours** (WCAG 2.x relative luminance), not measured in any client.

## 2. Mapping from the website to the email

| Website element (file) | Value | Email use |
| --- | --- | --- |
| `--color-bg-primary` | `#05070A` | Outer canvas and header band |
| `--color-bg-secondary` | `#080C11` | Message body ("reading surface") |
| `--color-text-primary` | `#F4F7FA` | Headline, metadata values |
| `--color-text-secondary` | `#B6C0CC` | Body paragraphs, header label |
| `--color-text-muted` | `#7E8997` | Metadata labels, footer — **superseded (rev 10, §0): not used in b6-3** |
| `--color-accent` | `#328FFF` | The single accent rule |
| `--color-accent-bright` | `#66B3FF` | Eyebrow text — **superseded (rev 10, §0): the eyebrow is `#83C6FF` (`--color-focus`)** |
| `--color-border-subtle` | `rgba(190,210,230,0.12)` | Hairline separators, as the **solid** composite `#1E242B` over `#080C11` (alpha is not relied on in email) |
| `.heroRule` (Careers) | 64 × 2 px, accent gradient to transparent | One 64 × 2 px rule in solid `#328FFF`. A solid colour is the email fallback for the gradient. |
| `.t-eyebrow` | 12–13 px, weight 500, uppercase, tracking 0.14 em | Eyebrow: 12 px, weight 500 (the client may render bold or regular), uppercase, letter-spacing 0.14 em |
| `--font-display` / `--font-body` | Space Grotesk / Inter | Same names first in the stack, then email-safe fallbacks; **no web font is loaded** (§5) |
| Spacing scale (4 px base) | 24 / 32 / 40 px | Gutters 40 px desktop, 24 px mobile; vertical rhythm from the same scale |
| `--radius-md` | 12 px | **Not used.** Square corners by design; nothing depends on rounding. |
| `BrandLogo` | Unmodified approved raster, height fixed, width following | Same rule: approved raster, aspect ratio preserved, no effects (§7) |
| Buttons, links, Grid, Flexbox, backdrop blur, animation, CSS variables | — | **None** in the email |

## 3. Structure (both messages) — the header is superseded by rev 10 (§0)

```
┌ outer canvas  #05070A, width 100% ─────────────────────────────────────────┐
│ ┌ message column  width 100%, max 600 px, centred ──────────────────────┐ │
│ │ HEADER  #05070A   padding 36 px 40 px (mobile 28 px 24 px)            │ │
│ │   [logo 158 × 36]                                   CAREERS (label)   │ │
│ │ ACCENT RULE  64 × 2 px #328FFF at the left gutter, on the header edge │ │
│ │ BODY  #080C11   padding 40 px 40 px 32 px (mobile 32 px 24 px 28 px)  │ │
│ │   EYEBROW            (p, 12 px, #66B3FF, uppercase)                    │ │
│ │   HEADLINE           (h1)                                              │ │
│ │   lead paragraph(s)  (p)                                               │ │
│ │   ── hairline ──                                                       │ │
│ │   [HR only: metadata rows, each followed by a hairline]                │ │
│ │   closing / privacy paragraph (p)                                      │ │
│ │   ── hairline ──                                                       │ │
│ │   FOOTER line        (p, 13 px, #7E8997)                               │ │
│ └────────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────┘
```

**Reading order equals source order:** logo, header label, eyebrow, headline, body, metadata (HR), note, footer. There are no columns that could reorder content.

### 3.1 Candidate acknowledgement (`APPLICATION_ACKNOWLEDGEMENT`)

| Block | Element | Content (from the copy proposal) |
| --- | --- | --- |
| Header label | `p`/text in the header cell | `CAREERS` — **removed in rev 10 (§0)** |
| Eyebrow | `p` | `APPLICATION RECEIVED` |
| Headline | `h1` | `Thank you for applying.` |
| Lead | `p` | `We’ve received your application for {job.title}.` |
| Hairline | presentation cell | — |
| Next step | `p` | `If we need more information or decide to move forward, we’ll contact you using the details in your application.` |
| Hairline, then footer | `p` | `Valida Careers` |

### 3.2 Internal notification (`APPLICATION_RECEIVED_INTERNAL`) — intentionally denser

| Block | Element | Content |
| --- | --- | --- |
| Header label | text | `CAREERS` — **removed in rev 10 (§0)** |
| Eyebrow | `p` | `RECRUITMENT / NEW APPLICATION` |
| Headline | `h1` | `A new application has arrived.` |
| Lead | `p` | `The application is recorded in Valida.` |
| Metadata | four rows; each row is a label `p` then a value `p`, followed by a hairline | `ROLE` → `{job.title}` · `ROLE IDENTIFIER` → `{job.slug}` · `RECEIVED (UTC)` → `{submittedAt}` · `APPLICATION REFERENCE` → `{applicationId}` |
| Privacy note | `p` | `Candidate details and the resume are stored privately in Valida and are not included in this email.` |
| Hairline, then footer | `p` | `Valida · Recruitment operations` |

The labels are visual micro-labels; each label is immediately followed by its value in source order, so a screen reader announces "Role, Cybersecurity Specialist" in sequence.

## 4. Colours and contrast (declared colours; computed, not client-measured)

| Text | Colour | On | Ratio | Requirement |
| --- | --- | --- | --- | --- |
| Headline, metadata values | `#F4F7FA` | `#080C11` | 18.24 : 1 | ≥ 4.5 (≥ 3 for large text) |
| Body, privacy note | `#B6C0CC` | `#080C11` | 10.64 : 1 | ≥ 4.5 |
| Header label `CAREERS` — **removed in rev 10** | `#B6C0CC` | `#05070A` | 10.95 : 1 | ≥ 4.5 |
| Eyebrow — **rev 10: `#83C6FF`, 10.73 : 1** | `#66B3FF` | `#080C11` | 8.83 : 1 | ≥ 4.5 |
| Metadata labels, footer — **rev 10: `#B6C0CC`, 10.64 : 1** | `#7E8997` | `#080C11` | 5.52 : 1 | ≥ 4.5 |
| Logo alt text (images blocked) | `#F4F7FA` | `#05070A` | 18.76 : 1 | ≥ 4.5 |
| Accent rule (decorative, non-text) | `#328FFF` | `#05070A` | 6.25 : 1 | No requirement; it carries no information |
| Hairline (decorative) | `#1E242B` | `#080C11` | 1.25 : 1 | Decorative only; never the only separation of content |

**Rules:**

- Every table cell that holds text declares its background twice: the `bgcolor` attribute and `background-color` inline. Every text element declares its colour inline. Nothing relies on inheritance from the client's default.
- No transparency (`rgba`) is used for any colour.
- No information is carried by colour alone: the eyebrow, labels and footer are words.

## 5. Typography

| Role | Font stack | Desktop | Mobile (≤ 480 px, progressive) | Other |
| --- | --- | --- | --- | --- |
| Headline (`h1`) | `'Space Grotesk', 'Inter', 'Segoe UI', Arial, Helvetica, sans-serif` | 32 px / 38 px line-height | 28 px / 34 px | Weight 600; letter-spacing −0.01 em; margin 0 0 24 px |
| Eyebrow | `'Inter', 'Segoe UI', Arial, Helvetica, sans-serif` | 12 px / 16 px | same | Weight 500; uppercase; letter-spacing 0.14 em; margin 0 0 16 px |
| Body / lead | same body stack | 16 px / 26 px | 16 px / 25 px | Weight 400; margin 0 0 24 px |
| Header label | body stack | 12 px / 16 px | hidden where the client honours the media query | Uppercase; letter-spacing 0.14 em |
| Metadata label | body stack | 12 px / 16 px | same | Uppercase; letter-spacing 0.08 em; margin 0 0 4 px |
| Metadata value | body stack | 15 px / 22 px | same | Weight 400; `font-variant-numeric: tabular-nums` (ignored where unsupported) |
| Privacy note | body stack | 14 px / 22 px | same | — |
| Footer | body stack | 13 px / 20 px | same | — |

**Fonts:**

- **No web font is requested.** Doc 03 names Space Grotesk and Inter, but the email does not fetch them: a remote font is an external resource. Readers will normally see Segoe UI (Windows), the system fallback or Arial.
- **Final metrics are judged with those fallbacks**, not with the brand fonts.
- **Outlook for Windows:** it is widely reported to ignore the rest of a font stack when the first family is not installed, and to show a serif default. The implementation therefore adds an Outlook-only override that sets `Segoe UI, Arial` (conditional comment). This is **to be verified** in Stage 3.
- Minimum text size is 12 px. Labels are never shrunk to fit long content; long content wraps instead (§6.2).
- No fixed heights are set on any text block, so increased text size grows the layout rather than clipping it.

## 6. Layout and responsive behaviour

### 6.1 Construction

- **One-column presentation tables** (`role="presentation"`, `cellpadding="0"`, `cellspacing="0"`, `border="0"`):
  - an outer table at 100 % width;
  - a message table at `width:100%; max-width:600px`, centred;
  - for Outlook for Windows, which does not honour `max-width`, a conditional (`<!--[if mso]>`) wrapper table fixed at 600 px.
- **Inline critical CSS** on every element. One `<style>` block in `<head>` carries only:
  - resets (`body`, `table`, `img`);
  - the ≤ 480 px media query (gutters 24 px; headline 28 px; header label hidden);
  - the colour-scheme declaration.

  Gmail documents support for `<style>` blocks and for width-based media queries ([Gmail CSS support](https://developers.google.com/workspace/gmail/design/css)). Where a client drops the block, the inline desktop styles still produce a readable single column.
- **Not used:** CSS Grid, Flexbox, CSS variables, `clamp()`, `calc()`, backdrop filters, gradients, background images, animation or transitions, web fonts, SVG, VML decoration, scripts, forms, iframes, external stylesheets, `@import`, tracking pixels and links (neither message contains a link).

### 6.2 Widths, gutters and long values

| Viewport | Gutters | Content width | Requirement |
| --- | --- | --- | --- |
| Desktop (column at 600 px) | 40 px | 520 px | Single column, centred |
| 390 px | 24 px (media query) | 342 px | **No horizontal scrolling** |
| 320 px | 24 px (media query) | 272 px | **No horizontal scrolling**. The header still fits even if the label is not hidden: 158 px logo + at least 8 px gap + about 68 px label = 234 px ≤ 272 px |
| 320 px with the media query ignored | 40 px | 240 px | Still no overflow: the header needs about 234 px (above), and every text block wraps. This case is tight; Stage 3 checks it explicitly. |

**Long values:**

- Job titles (up to 160 characters), slugs (up to 120 characters, hyphenated) and the 24-hex reference wrap safely.
- Value cells carry `word-wrap: break-word; word-break: break-word;`. The slug and the reference also carry `word-break: break-all`, because they have no spaces.
- Gmail's documented property list includes `word-break` and `word-wrap`; it does not list `overflow-wrap`, so `overflow-wrap` is not relied on.
- The headline is fixed copy and contains no dynamic value.

**Subjects — one rule (rev 5; APPROVED by OD-2026-10-26-02).** rev 4 stated the limit inconsistently: "the job title in a subject is capped at 120 characters" here, "title ≤ 120 characters" in the copy proposal, and "a 120-character cap" in T-05, which did not say whether the title or the whole subject was meant. This is the single rule for b6-2:

| Element | Rule |
| --- | --- |
| Composition | Subject = fixed prefix + title segment + fixed suffix. Prefixes: `Application received — ` (candidate) and `New application — ` (internal). Suffix: ` \| Valida`. |
| What is limited | **Only the title segment**: at most **120 extended grapheme clusters** (Unicode UAX #29), the ellipsis included. The prefix and the suffix are **never** shortened. There is no separate limit on the whole subject. |
| Before counting | The title's existing b6-1 single-line handling (control characters removed; one line) is kept unchanged. Leading and trailing white space is then trimmed. |
| Truncation | 120 clusters or fewer: the title is used unchanged, with no ellipsis. More than 120: keep the first **119** clusters, remove trailing white space from them, and append `…` (U+2026, one cluster). |
| Segmentation | `Intl.Segmenter` with `granularity: 'grapheme'` (ICU, in Node 24). A cut can never split a combining sequence, an emoji ZWJ sequence, a flag (a regional-indicator pair), a skin-tone or keycap sequence, or a surrogate pair. Truncating by code point alone would still split combining sequences and joined emoji, so it is not sufficient. Segmentation follows the Unicode version, so the Node, ICU and Unicode versions are recorded with the test evidence. |
| Resulting length | At most 23 + 120 + 9 = **152** clusters for the candidate subject, and 18 + 120 + 9 = **147** for the internal one. The title is already bounded by the Job record (up to 160 characters, above), so the encoded header stays small. The 120-cluster limit is a presentation rule, not a size defence. |
| Where it applies | The subject, and the HTML `<title>`, which repeats the subject. The body and the internal Role row show the **full** title and wrap. |
| Encoding | The mail library RFC 2047-encodes the subject. T-05 and T-11 decode the composed `Subject` header and compare it with the expected string exactly, so a faulty encoded-word split also fails. |

**Finding for Stage 2:** the current `headerText()` truncates with `String.slice()`, which counts UTF-16 code units and can split a surrogate pair (for example, an emoji) at the boundary. Stage 2 replaces it with the rule above.

### 6.3 Spacing

| Between | Desktop | Mobile |
| --- | --- | --- |
| Header top / bottom padding | 36 px | 28 px |
| Logo to header label | at least 8 px (the label cell is right-aligned with `padding-left: 8px` and no fixed width; on desktop the visible gap is about 290 px) | label hidden |
| Accent rule | 64 × 2 px, flush with the left gutter, at the bottom edge of the header | same, at the 24 px gutter |
| Body top padding | 40 px | 32 px |
| Eyebrow → headline | 16 px | 16 px |
| Headline → lead | 24 px | 20 px |
| Paragraph → hairline → paragraph | 24 px above and below | 20 px |
| Metadata row padding (top / bottom) | 16 px | 14 px |
| Footer bottom padding | 32 px | 28 px |

## 7. The logo — superseded by the masthead in rev 10 (§0); kept as the b6-2 record

### 7.1 The source asset, and the derived email file (to be produced in Stage 2 only)

| Item | Specification |
| --- | --- |
| Source | `frontend/public/brand/valida-logo-horizontal-dark.png` — the approved horizontal lockup on an opaque `#000000` background (1009 × 230) |
| Why the opaque dark variant | If a client changes the header background (for example, a forced light theme), the transparent variant's silver lettering would sit on a light background, which Doc 03 §20 forbids ("place on low-contrast backgrounds"). The opaque variant keeps its own dark field and stays legible. On the `#05070A` header, its black field differs by only 1.04 : 1, so it does not appear as a box. |
| Derived file | Scaled to 316 × 72 px (2 × the display size) by resampling only. No crop, recolour, sharpening, effect, redraw or added margin. 1009 / 230 = 4.387 and 316 / 72 = 4.389, a 0.04 % aspect difference, below one pixel. The file's SHA-256 and a side-by-side comparison with the source are recorded, and the derived file needs **owner approval** before use. |
| Display size | `width="158" height="36"`, with matching inline CSS. The website shows the same lockup at 34–38 px tall. |
| Clear space | Doc 03 §18: about the width of the shield's internal V stroke. In practice, 36 px header padding above and below, the 40 px gutter on the left, and at least 8 px to the label (about 290 px on desktop). No text, border or icon intrudes. |
| Alt text | `Valida` — concise; identity only. The header label that follows reads "CAREERS". |
| Alt-text styling | Where clients style alt text: `#F4F7FA`, 16 px, weight 600, body font stack, on `#05070A` |

### 7.2 Delivery — one inline CID PNG (option A APPROVED, OD-2026-10-26-02)

| Option | For | Against |
| --- | --- | --- |
| **A. Inline CID image (APPROVED)** | No public image host is needed, and no production asset URL exists yet. The reader's client fetches nothing from Valida, so the image cannot act as an open-tracking signal (Doc 14 §138). The message is self-contained, which suits exact-bytes preservation (copy design). | It changes the MIME structure (below). Some clients may list the image as an attachment or show it below the message. It adds about 10–16 KB after base64 (to be measured). It is **not guaranteed** to display: some clients or settings block or strip inline images. |
| B. Hosted HTTPS PNG | Smaller message; standard practice | **No verified production asset URL exists.** Every load reaches the host, revealing open time and network information unless logs and proxies are controlled. That conflicts with the spirit of §138 and needs a privacy decision. Images are blocked by default in some clients. **Not proposed.** A URL is never substituted without verification. |
| C. No image (text only) | Simplest; universally displayed | Not the official logo. Recreating the wordmark in text is forbidden (Doc 03 §16, §20). Text is used **only** as the blocked-image alt text. |
| Data-URI image | — | **Not proposed** (inconsistent support; larger HTML) |

**Target MIME structure for option A.** The exact tree produced by nodemailer 10.1.4 must be verified by a Stage 2 test:

```
multipart/alternative
├── text/plain; charset=utf-8                     (quoted-printable)
└── multipart/related; type="text/html"
    ├── text/html; charset=utf-8                  (quoted-printable)
    └── image/png; name="valida-logo.png"         (base64)
        Content-ID: <valida-logo.b6@cybervalida.com>
        Content-Disposition: inline; filename="valida-logo.png"
```

**An inline branding asset is not a candidate attachment:**

- The PNG is a fixed Valida asset, identical in every message. Its name, Content-ID and bytes contain no candidate or Application data.
- It is **not** a resume or a candidate file. MIME tests must assert that no other part exists.
- Doc 14 §115 and MAIL-040 (no resume attachments) are unaffected.
- The D5 privacy evidence covered the b6-1 **text-only** internal notification. The new message needs its own privacy verification (copy proposal §5).
- Because some clients list inline images as attachments, the logo's presence in an attachment list is an **acceptable difference**, provided the file is the approved logo.

**When images are blocked**, the message remains complete (Doc 14 §137):

- the alt text "Valida" appears in the header;
- the "CAREERS" label and the footer identify the sender;
- no information is carried by the image.

## 8. Dark mode and client colour transformations

- The message is **designed dark**, with explicit colours on every cell and every piece of text.
- The head declares `<meta name="color-scheme" content="dark">` and `<meta name="supported-color-schemes" content="dark">`, plus `:root { color-scheme: dark; }` in the style block. This is **progressive enhancement only**:
  - some clients use it to avoid re-colouring an already-dark message;
  - others ignore it;
  - Gmail's CSS documentation does not list `prefers-color-scheme`.
- **No claim is made that any client preserves the declared colours.** Clients may leave the message as designed, or partially or fully re-colour backgrounds and text.
- **What must survive any transformation** (Stage 3 checks this, client by client):
  - all text stays readable, at ≥ 4.5 : 1 as rendered;
  - the hierarchy (eyebrow → headline → body → metadata → footer) stays visible;
  - the logo stays legible (the opaque variant keeps its own dark field);
  - no text is embedded in an image.
- No special dark-mode-only colours, image swaps or `[data-ogsc]` style hacks are proposed. Each would be one more client-specific branch to maintain without verified benefit.

## 9. Semantics, accessibility and metadata

- `<html lang="en" dir="ltr">`; `<meta charset="utf-8">`; `<meta name="viewport" content="width=device-width, initial-scale=1">`; `<title>` = the subject, HTML-escaped.
- One `h1` per message. Paragraphs are `p`. Layout tables carry `role="presentation"`. No `th` or data tables. No `aria-hidden` on content.
- **Preheader:**
  - the first element in `<body>` is a visually hidden `div` (`display:none; max-height:0; overflow:hidden; mso-hide:all`) containing the preheader text;
  - it repeats information that also appears in the body, so it does no harm if it is shown or read;
  - no invisible padding characters are added after it;
  - some clients show body text after the preheader, or ignore it — an acceptable difference.
- **Auto-detection:** `<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">` (progressive; honoured by some Apple clients) reduces automatic linking of the timestamp and reference. Auto-linking where it still happens is an acceptable difference.
- **Text resizing:**
  - with no fixed heights, increased text size and 200 % zoom reflow the column;
  - letter-spacing is applied only to short uppercase labels.
- **Dynamic values:**
  - HTML-escaped after control-character removal (current `escapeHtml`);
  - stripped of controls in the plain text;
  - single-line and bounded in subjects.
- **Size:**
  - the HTML target is ≤ 20 KB before encoding;
  - the whole message, including the logo, should be ≤ 40 KB;
  - Gmail is widely reported to clip very long messages (around 100 KB) — not verified here and not expected to apply at this size.
- **Plain-text part:** the meaning matches the HTML exactly (copy proposal). Presentational labels (`CAREERS`, the eyebrow) are omitted from the plain text, because the subject and headline carry the same information.

## 10. Acceptable and unacceptable differences

**Acceptable**, provided hierarchy and readability survive:

- fallback fonts (Segoe UI, Arial or the system sans) instead of Space Grotesk / Inter, with different line breaks;
- the headline wrapping differently from the board (the board shows a deliberate two-line break; no forced `<br>` is used);
- the solid accent rule instead of the website's gradient; square corners;
- clients re-colouring backgrounds or text in dark or light modes, if contrast still meets the thresholds;
- the logo replaced by its alt text when images are blocked, or listed as an attachment;
- the header label shown on mobile where media queries are ignored;
- spacing differences of up to about 8 px from client paragraph handling;
- the preheader not shown, or followed by body text;
- automatic linking of the date or reference by some mobile clients.

**Not acceptable:**

- horizontal scrolling or clipped text at 320 px, 390 px or desktop width;
- overlapping text;
- rendered text contrast below 4.5 : 1 (3 : 1 for the headline);
- a stretched, recoloured or cropped logo;
- information missing from the plain text that is present in the HTML, or the reverse;
- any candidate data in the internal notification;
- any link, remote resource, tracking element or extra attachment;
- a broken Unicode character, or a split grapheme cluster, in a subject.

## 11. Planned file changes — Stage 2 only (rev 8: AUTHORISED and implemented, the logo rows included — OD-2026-10-27-01)

| File | Planned change |
| --- | --- |
| `backend/src/integrations/notifications/templates.js` | Concept A HTML and plain text for both events; `TEMPLATE_VERSION` → `b6-2`; grapheme-safe subject truncation by the §6.2 rule; the approved copy; the `{submittedAt}` format as approved |
| `backend/src/integrations/notifications/assets/valida-logo-email-316x72.png` (new) | The derived logo, if option A is approved; SHA-256 recorded in a checksum file beside it |
| `backend/src/integrations/notifications/smtpTransport.js` (`compose`) | Pass the inline logo as a CID related part. Message-ID, `Auto-Submitted`, the DSN parameters, the sender and the Reply-To are unchanged. |
| `backend/tests/…` (template, adapter and privacy tests) | See the Stage 2 plan in [`IMPLEMENTATION_PLANS_B6_TEMPLATES_B7_SUPPRESSION.md`](../review/IMPLEMENTATION_PLANS_B6_TEMPLATES_B7_SUPPRESSION.md) |
| `backend/README.md`, decision package §6 | Template documentation and the copy record |

**No change** to: retry rules, claim logic, recipients, sender, Reply-To, eligibility, Application persistence, `APPLICATION_ACKNOWLEDGEMENT_ENABLED` (default `false`) and the website.
