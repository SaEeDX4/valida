# B6 — template version `b6-3`: C2 masthead and P-04 colours (implementation report)

| | |
| --- | --- |
| Date | 2026-11-02 (sandbox; America/Los_Angeles) |
| Authorisation | **OD-2026-11-02-01** ([record](../../review/OWNER_DECISION_2026-11-02-01_B6_C2_P04.md)): C2 approved for both emails with the exact asset `ac67a2cb…ea3b`; removal of the header label `CAREERS` only; P-04 (labels and footer `#B6C0CC`, eyebrow `#83C6FF`); sandbox implementation in the runtime templates, MIME/assets and tests |
| Baseline | The r5 working copy, verified before any change: every file matches the r5 cumulative manifest (`sha256sum -c` exit 0) and the tree equals the r5 reconstruction (`diff -r` exit 0); r5 cumulative ZIP `1d83969a…ad44` |
| Result | **READY FOR GPT REVIEW.** `b6-3` implemented; affected suites, the B6 / B5 / B4 offline gates and the full offline suite **PASS** in the sandbox; mutation checks catch every seeded defect; fresh fixtures and development previews generated from the runtime |
| Not established | **Any email-client rendering of `b6-3`** (Outlook, Gmail, Apple Mail, phones) — the owner's Outlook evidence so far shows `b6-2` (EV-S3-OC1) and the review **mockups** (EV-S3-OC2, EV-S3-OC3), not this build; the **real-database gates** (no MongoDB here); Windows; delivery. Browser previews are development evidence only. |
| r8 note (2026-11-02) | No runtime change. **Correction to the r7 addendum, point (3):** the files then received showed the r5 mockup, but the owner's original 07:12 screenshots (EV-S3-OC5) show this build; they confirm the §7 prediction (in a narrow window at 2.0 the column stays ≈ 600 CSS px). **D-6 APPROVED** (OD-2026-11-02-02): that scrolling is an accepted Outlook classic deviation. The original Windows log is now preserved ([`WINDOWS_EVIDENCE_R6.md` §7](WINDOWS_EVIDENCE_R6.md)) |
| r7 addendum (2026-11-02) | **No runtime change.** (1) Windows + MongoDB run of the r6 package: every available gate PASS — [EV-B6-3-W1](WINDOWS_EVIDENCE_R6.md). (2) **Correction to §2.2 and §5 (`mso-markup`):** those browser layouts let Chromium shrink the masthead through its CSS `width:100%`, which Outlook classic does not apply to images; with the documented Outlook rules modelled (J7, §7), the `b6-3` wrapper overflows exactly like the fixed one below 600 CSS px. The claim "narrows to 400 px with no overflow" does **not** carry over to Outlook classic. (3) The owner's new Outlook screenshots show the r5 mockup, not this build (addendum Part IV). See §7 |
| Status kept | **B6 NOT ACCEPTED.** G-SUP **CLOSED**. G-COPY **PROPOSED** (unchanged). The B7 body-discard issue **OPEN**. The real vacancy **DRAFT**. No email sent; no mailbox or account accessed; nothing committed, pushed or deployed. |

## 1. What changed in the runtime

| File | Change | SHA-256 (r5 → b6-3) |
| --- | --- | --- |
| `backend/src/integrations/notifications/assets/valida-email-masthead-1200x216.png` | **Added**: the approved C2 bytes, copied from `docs/qa/b6-stage3/proposals/f01-logo/C2-masthead-1200x216.png` | — → `ac67a2cb7d447a55d89bb3264198743d4114190e259775535215acabba1aea3b` |
| `backend/src/integrations/notifications/assets/valida-logo-email-316x72.png` | **Removed from the runtime folder** (no longer used). Its approved bytes stay at `docs/qa/b6-stage2/logo/valida-logo-email-316x72.candidate.png` (byte-identical, checked before removal) and in every earlier package | `b8c54174…341a` → — |
| `backend/src/integrations/notifications/assets/SHA256SUMS.txt` | Lists the new asset only | `29f28a96…5fca` → `5acfaaac…e2bf` |
| `backend/src/integrations/notifications/emailLogo.js` | `file`, `sha256`, `width: 600`, `height: 108`, comment. **Unchanged:** `contentId`, `filename`, `contentType`, `alt "Valida"`, the fail-closed hash check | `e83294bd…a4ce` → `b52996c7…e2dc` |
| `backend/src/integrations/notifications/templates.js` | `TEMPLATE_VERSION` `b6-3`; header row = the masthead image alone (the `CAREERS` cell removed); P-04 colours; unused `.v-header` / `.v-label` media rules and the unused `muted` token removed; **Outlook-only wrapper changed** (§2.2) | `9d8e998c…4534` → `46d0df76…57a3a9` |
| `backend/tests/b6-stage2-templates.test.js` | Version; T-01 without `CAREERS` (and asserts its absence); T-02 masthead attributes and wrapper; T-03 set; T-06 heights; T-08 new pinned hash and PNG dimensions; **new T-13** (header row, P-04 colours, no former colour) | `c64fa247…cc68` → `94bc4bd6…87a7` |
| `backend/tests/b6-notification-service.test.js` | Version assertion `b6-3` | `d2cc970c…417b` → `06ed6c4a…b9ad` |
| `backend/README.md` | The template-version heading and the masthead paragraph | `5217629d…6e42` → `5de46af7…65ba` |

**Unchanged** (hash-identical to r5): `smtpTransport.js` (`4e420977…f014`), `transport.js`, `notificationService.js`, every other backend and frontend file, every `package*.json`, every verify script.

## 2. Fidelity to the reviewed mockup, and the Outlook wrapper

### 2.1 Fidelity to what the owner reviewed in Outlook

The `b6-3` HTML of ACK, INT and LONG was compared line by line with the C2+P04 review-mockup HTML the owner opened in Outlook (EV-S3-OC2 / EV-S3-OC3). The **only** differences:

1. two unused CSS rules removed (`.v-header`, `.v-label` — no element carries those classes any more);
2. the Outlook-only wrapper (§2.2).

The plain-text parts and the subjects are **byte-identical** to `b6-2` (checked for all three original fixtures).

### 2.2 The Outlook-only wrapper (finding F-03) — a layout fix within the approved design, unverified in Outlook

| | `b6-2` | `b6-3` |
| --- | --- | --- |
| Markup (inside `<!--[if mso]>` only) | `<table width="600">` around the column | `<table width="100%"><tr><td></td><td width="600" style="width:600px;">` … `</td><td></td></tr></table>` |
| Intent | Cap the column at 600 px in Word, which ignores `max-width` | The middle cell asks for 600 px; the side cells take the rest. Where there is room, 600 px (desktop line length kept); where there is not, the column can narrow instead of scrolling sideways |
| Other clients | Never see it (HTML comment) | Same |
| Evidence | Outlook classic, 200 %, narrow window: horizontal scrolling (owner and GPT; F-03) | **Browser only** (§5, `mso-markup` shots): with the conditional markup uncommented, the `b6-3` wrapper keeps 600 px at 1440 / 680 px and narrows to 400 px with no overflow; the `b6-2` wrapper overflows at 400 px with 13 text blocks beyond the edge. **Word's table layout may differ** — this must be confirmed in Outlook (owner check O-A, §6). **r7 correction:** these layouts also shrank the masthead via CSS, which Outlook classic does not do; under the documented Outlook rules the `b6-3` wrapper keeps the 600 CSS px minimum (§7) |

If Outlook does not narrow the column, or widens it beyond 600 px on a wide monitor, the fallback is the `b6-2` wrapper (one line), and F-03 then needs the owner's explicit decision. No exception is assumed.

## 3. Tests actually executed (sandbox: Linux, Node v24.21.0 — Playwright-bundled binary, provenance not verifiable)

| Log | Command | Result |
| --- | --- | --- |
| [`J1`](evidence/J1-focused-verbose.log) | `npx vitest run --reporter=verbose` on the 7 affected suites: `b6-stage2-templates`, `b6-notification-service`, `b6-apply-notifications`, `apply-failures`, `b6-smtp-integration`, `b6-smtp-transport`, `b6-nodemailer-contract` | **280 passed / 280** (b6-2 run I1: 278; the difference is the two new T-13 tests; no test removed; one title changed, "template version b6-3") |
| [`J2`](evidence/J2-verify-b6.log) | `npm run verify:b6` (no `MONGODB_TEST_URI`) | Offline suite **2230 passed, 1 skipped** (b6-2: 2228 / 1); B6 gate **460** (458); B5 **236**; B4 **584 / 1 skipped**; **B6 real-database gate FAIL — not run** (no MongoDB in the sandbox); provider **PENDING**; exit 1, as in the b6-2 sandbox run |
| [`J3`](evidence/J3-mutation-checks.log) | 9 scratch copies (node_modules linked; working copy never modified), [`tools/mutation_b6_3.py`](tools/mutation_b6_3.py) | M0 **passes**. Every mutant **fails** its test: M1–M3 candidate data (T-07); M4 asset replaced by the b6-2 logo bytes (T-08); M5 image not attached (T-08); **M6** `CAREERS` put back (T-01, T-13); **M7** eyebrow `#66B3FF` (T-13); **M8** labels `#7E8997` (T-13) |
| [`J4`](evidence/J4-asset-mismatch-probe.log) | The real service and adapter with the M4 copy, local SMTP test server | **Fail-closed:** both events `FAILED` (`COMPOSE_FAILED`), **0 messages, 0 sessions reached MAIL FROM** |
| [`J5`](evidence/J5-fixtures.log) | [`tools/make_fixtures_b6_3.mjs`](tools/make_fixtures_b6_3.mjs) + [`tools/fixture_privacy_check.mjs`](tools/fixture_privacy_check.mjs) | 4 EMLs from the real adapter; MIME `alternative[text/plain, related[text/html, image/png]]`; image = the approved bytes; INT and LONG: **no** synthetic candidate address in any decoded surface; ACK: only in `To` |
| [`J6`](evidence/J6-previews.log) | [`tools/make_previews_b6_3.py`](tools/make_previews_b6_3.py) (Chromium 153) | 88 development shots (metrics for all, 28 saved as PNG): **no horizontal overflow** in any `b6-3` shot (§5) |

**Not re-run** (no relevant change): unrelated suites beyond the full offline suite in `verify:b6`; the database suites (cannot run here — §6).

## 4. Fresh synthetic EMLs (from the revised runtime; local SMTP test server; nothing left the machine)

[`fixtures/`](fixtures/) — `fixtures-index.json` records template `b6-3`, Node v24.21.0 and the image hash.

| File | SHA-256 | Bytes | HTML bytes |
| --- | --- | --- | --- |
| `SYNTHETIC-acknowledgement.eml` | `b6ef30bb59d70a9a974307138fae1b6fd1b3558fafd90e098306886ff622fac8` | 28,804 | 5,276 |
| `SYNTHETIC-acknowledgement-long-values.eml` (new: 160-character title) | `fcbe391ab4b44e8a7344bf86c8b56049bbef815e6f6a1fdd519aa0834eaf1f24` | 29,346 | 5,510 |
| `SYNTHETIC-internal.eml` | `c1fa146455fec319f9d5dffa6d586ca104fbbf420f4f98a0b44aa576643e4989` | 32,973 | 9,025 |
| `SYNTHETIC-internal-long-values.eml` | `b4bfb7c677d7c84ba156b48a982017be7009d1f2ea84027b778d187f2cf76bc0` | 33,705 | 9,355 |

All ≤ 40 KB (message) and ≤ 20 KB (HTML). The HTML, plain-text and subject files beside them carry their own hashes in J5. INT and LONG share one synthetic Application reference and so one Message-ID (likewise the two ACKs): open each file separately. The `b6-2` fixtures in `docs/qa/b6-stage2/fixtures/` are unchanged and remain the evidence base of EV-S3-OC1 only.

## 5. Development previews — Chromium, NOT an email client

[`previews/previews-index.json`](previews/previews-index.json) holds the metrics of every shot; PNGs of the representative ones are in [`previews/shots/`](previews/shots/). Sources: each EML's own HTML and image part (`as-built-*.from-eml.html`), or the `cid:` HTML for images-not-loaded.

| Scenario (label) | Coverage | Result |
| --- | --- | --- |
| Widths | 4 messages × 280 (stress), 320, 360, 390, 430, 600, 680, 1024, 1440 px | No overflow; no text beyond the right edge; masthead 280 × 50 … 600 × 108, ratio 5.56–5.60 (rounding); column 600 px from 600 px up; smallest text 12 px; `CAREERS` absent; privacy note (INT) and footer present |
| Desktop line length | 680, 1024, 1440 px | Column stays 600 px; the longest body paragraph sets about 62 characters per line |
| Whole-page zoom — **emulated** | 200 % in 1280 / 800 / 600 px windows; 400 % in 1280 px | No overflow; the column narrows to 400 / 300 / 320 px |
| Text-only 200 % — **emulated** | 680 and 390 px | No overflow, nothing beyond the edge; text 24 px minimum; long values wrap |
| Images not loaded — **simulation** | 680 and 390 px | Alt text "Valida" shown on the dark band; the 600 × 108 box is kept (stable layout); every word of the message present. Cosmetic: the browser places the alt text at the band's top-left with its broken-image icon, not on the 40 px gutter |
| Outlook light — **simulation** with measured colours | 680 px | Lowest text contrast **4.72** (the eyebrow) — equal to the measured Outlook value, by construction |
| Source colours (the dark design) | all | Lowest text contrast 10.64 (computed in the page) |
| Fallback font (Arial) | INT, 680 px | No overflow |
| `mso-markup` — Outlook-only markup **laid out by a browser** | b6-3: 1440 / 680 / 400 px; b6-2 for comparison | b6-3: 600 / 600 / 400 px, no overflow. b6-2: overflow at 400 px. **Not Word, not Outlook.** **r7:** the "no overflow at 400 px" relies on the browser shrinking the image; not valid for Outlook classic (§7) |

The images-not-loaded and Outlook-light shots are simulations; none of these shots fills a Stage 3 cell or is marked PASS for any client.

## 6. What remains, and the smallest owner actions

| # | What | Why it is needed | Who | Permission |
| --- | --- | --- | --- | --- |
| **O-A** | **r7: still to do — the screenshots received show the r5 mockup; the revised list is in [blockers §3](../../review/B6_REMAINING_BLOCKERS.md).** As requested at r6 — **Outlook classic, offline, on the `b6-3` fixtures** (`SYNTHETIC-acknowledgement.eml`, `SYNTHETIC-internal-long-values.eml` from `docs/qa/b6-3/fixtures/`, hashes in §4): (1) normal monitor, 100 %, light and dark — one full-window screenshot each, scrolled to show the footer; (2) **narrow window (about half the screen), Zoom 200 %**, LONG — one screenshot as opened and, if a horizontal scrollbar appears, one scrolled fully right; (3) wide monitor, 100 %, one screenshot of LONG | (1) the integrated build has not been seen in any client; (2) decides F-03 for the new wrapper; (3) checks that the wrapper keeps 600 px where there is room. Attach as **PNG files** (not pasted), so they arrive at screen size | Owner | **Already authorised** (Stage 3 offline EML inspection in Outlook classic, OR-2026-11-01-01) |
| **O-B** | **r7: DONE** (EV-B6-3-W1, [`WINDOWS_EVIDENCE_R6.md`](WINDOWS_EVIDENCE_R6.md)). As requested at r6 — **Windows + MongoDB:** in a fresh checkout of the r6 cumulative package, `npm ci`, then with `$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test"`: `npm run verify:b6`; send the log | B6-7 regression for the changed build: the real-database gates and Windows + Node 24 cannot run here; the database rehearsal exercises the real compose path with the new asset | Owner | None beyond the existing workflow (no live email; the provider gate stays PENDING) |

Earlier evidence that stays valid and is **not** requested again: the `b6-2` Windows run (EV-S2-W1) for unchanged code paths; the mockup screenshots (EV-S3-OC2/OC3) for the approved appearance and colours.

## 7. r7 addendum (2026-11-02) — no runtime change

| | |
| --- | --- |
| Runtime | **Unchanged.** Every `backend/` and `frontend/` row of the r6 cumulative manifest matches the working copy (57 rows, `sha256sum -c` exit 0); the r7 update manifest lists no runtime file |
| Windows + MongoDB | **EV-B6-3-W1** ([`WINDOWS_EVIDENCE_R6.md`](WINDOWS_EVIDENCE_R6.md)): offline 2226 passed / 5 skipped; B6 460; B5 236; B4 580 / 5 skipped; database suite 145; B6 database gate 16; rehearsal and cleanup 17; indexes 6/6; provider PENDING; exit 2. Valid for r7 |
| New development evidence | [`J7`](evidence/J7-word-constraint-model.log) — [`tools/word_constraint_model.py`](tools/word_constraint_model.py): Chromium applying three **documented** Outlook classic rules (no CSS width on `<img>`; no `max-width`; the Outlook-only markup applied) to the as-built LONG and ACK HTML, for the `b6-3`, fixed-600 and fluid-100 wrappers, at 1440 / 680 / 610 / 510 / 400 / 320 CSS px; metrics in [`previews/word-model-index.json`](previews/word-model-index.json), two PNGs in `previews/word-model/`. **Result:** with the rules applied, all three wrappers overflow by 90 / 200 / 280 CSS px at 510 / 400 / 320 px, the image staying 600 px; without rule 1 (what §5 did) the `b6-3` and fluid wrappers reflow. **A model, not Outlook** |
| Consequence | F-03 cannot be closed by a template change within the approved design; findings [§4.4](../b6-stage3/F01-F04_FINDINGS_AND_PROPOSAL.md) and the revised decision D-6 ([blockers](../../review/B6_REMAINING_BLOCKERS.md)) |
| Fixtures for O-A | The r6 fixtures of §4, unchanged — they have not yet been opened in Outlook (**r8: withdrawn** — the owner's 07:12 screenshots, EV-S3-OC5, show the LONG fixture opened). Their titles start "New application —" / "Application received —" with no "[REVIEW MOCKUP" prefix |
| Tests | None re-run: no runtime, test or verification-script change. J7 is a QA tool, not part of any suite or `verify:b6` |
