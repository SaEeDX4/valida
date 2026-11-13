# C5 — Integrated Site Quality

| | |
| --- | --- |
| Milestone | Release C, **C5 — Integrated Site Quality** (Doc 18 §§168–172) |
| Baseline | `389c421a72fb090dc2c08c8251b664bada73d9a0` (GitHub `main` = `c4-work`) |
| Harness | `06dd991` (suite); follow-ups `f82f765`, `47bf227`, `777c1e6` and `fffc252`. Test code only |
| Fixes | `24a351d` F1, `22344eb` F2, `4807dda` F3, `72a9d52` F4. Frontend CSS and two data attributes; the backend is unchanged |
| Status | **READY FOR REVIEW (round 3, §9), with one automated gate failing: C5-14 in complete runs (§9.7).** Round 3 narrowed the Careers label-in-name exception and added the Job API preload hint; mobile lab LCP on Job Detail, Apply and the missing Job is now inside 2.5 s (O2). Open: C5-14, OD-C5-2 and OD-C5-4, the Doc 06 synchronisation, and the manual checklist. The round-2 status was: READY FOR REVIEW (round 2, §8), with mobile LCP open. C5 is not accepted: acceptance is pending independent review and the owner's approval |
| Constraints kept | Local work only. Nothing pushed, deployed or sent; no settings changed. Production candidate acknowledgements stay disabled. The first genuine Cybersecurity Specialist vacancy stays Draft, its eligible work countries OPEN. Approved copy, the social card, job eligibility and the publication rules are unchanged |

Everything below was observed in **Chromium**, through Playwright, on one Linux machine. Nothing here is a claim about other browsers, real devices, real screen readers or production field data. Those are in §6, the manual checklist, and stay open until a person runs them.

## 1. Environment

| | |
| --- | --- |
| Machine | Linux container, 2 vCPU Intel Xeon @ 2.30 GHz, 7 GiB RAM |
| Runtime | Node v24.21.0, npm 10.9.9; Playwright 1.63.0 with Chromium 153.0.8010.12 (headless) |
| Tools | axe-core 4.13.0 (the frontend's own dev dependency); Lighthouse 13.6.0, installed **outside** the repository; MongoDB 8.0.23 (disposable `valida_test_c5`) |
| Stack | One production build (`VITE_ALLOW_INDEXING=true`, `VITE_PUBLIC_SITE_URL=https://cybervalida.com`). Served by the C4 document server on 127.0.0.1:4203, and through the **lab-only** compression proxy on 127.0.0.1:4204. The real backend on 127.0.0.1:4120, with **no mail transport** and acknowledgements off |
| Data | Synthetic Jobs only (`e2e/fixtures/c5-jobs`): a long-title open Job (eligible countries NZ, DE, CA; three screening questions; a long unbroken token), an open hybrid Job, and a retained closed Job. Synthetic candidates on `*.example.test`; the synthetic resume fixtures |
| Runs | **Before**, at `06dd991` (the baseline frontend): 2026-11-10 12:08–12:38 UTC. **After**, at `72a9d52`: 2026-11-10 12:39–12:59 UTC. Then, at `777c1e6`: the targeted reruns (C5-06, C5-07, C5-15b) and the C3 and C4 regression suites. At `fffc252`: C5-12 again, against this frontend and against the baseline frontend (`06dd991`, in a temporary worktree since removed) |

How each state was produced is recorded with it:
- **REAL**: an actual response or browser state;
- **HOLD**: a real request held, then sent unchanged (loading states);
- **FAULT**: a request made to fail, then recovered for real (error states);
- **EMULATED**: Chromium emulation (viewport, text size, zoom, reduced motion, forced colours, throttling);
- **LAB**: a local measurement, never field data.

## 2. What was checked

| Area | How | Cases |
| --- | --- | --- |
| Widths | **12 routes** at 360, 390, 430, 768, 1024, 1440 and 1920 CSS px, each loaded fresh, with full-page screenshots. Plus every 10 px from 320 to 1920 and each breakpoint −1/0 (600, 700, 720, 768, 820, 900, 1000); 169 widths per route. Plus phone landscape at 844×390 and 932×430. The 12 routes: Home, About, Careers, Job (open, hybrid, closed, missing), Apply (open, closed), Privacy, Legal, 404 | C5-02, C5-03 |
| Per view | Document horizontal scroll; elements leaving the viewport; text clipped in its box; every control's size against WCAG 2.5.8, with its own exceptions applied; controls covered by something else | C5-02 |
| States | Empty Careers (the real, empty API). Loading (HOLD) and error (FAULT) with recovery, for Careers and Job Detail. Closed Job and closed Apply. Missing Job. 404. Apply: empty, client validation, long values and a long file name, a server refusal (a PNG named `.pdf`), submitting (HOLD), a network failure (FAULT), Try Again, and success, stored once in MongoDB | C5-01, C5-04, C5-05 |
| Automated accessibility | axe-core, WCAG 2.0/2.1/2.2 A and AA, on every route at 360 and 1440, and on every state above. Also its experimental WCAG 2.5.3 rule, recorded on its own | C5-06, states |
| Structure | `lang`, one `main`, landmarks, one `h1`, heading order, the skip link as the first stop, no positive `tabindex`, `alt`, list markers | C5-07 |
| Keyboard | Tab **and Shift+Tab** through 7 routes at 1440 and 390: 330 stops. At each: the focus indicator, in view, and not hidden by the sticky header. The mobile menu: expanded state, Escape, focus return, navigation. Keyboard-only Careers → Job → Apply: the error summary, its links, every field, the file chooser, submit, success | C5-08 – C5-10 |
| Screen-reader proxies | Chromium accessibility-tree snapshots of every route and the Apply error state; live regions; `aria-describedby` and `aria-invalid` associations. **Not** a screen reader | C5-11 |
| Text, zoom, reflow | Browser text size doubled (16 → 32 px) at 1280 and 390. Page zoom 200% (640×450 at scale 2), with the menu and Apply validation exercised. Reflow at 320×256 (400% of 1280) on every route | C5-12, C5-13 |
| Motion, contrast, forced colours | `prefers-reduced-motion: reduce` against no preference. Non-text contrast from computed colours. The text that axe could not judge, measured from rendered pixels. Forced colours | C5-14 – C5-16 |
| Performance | Lab LCP, CLS, INP, FCP, TTFB, long tasks, and transfer by type. Mobile: Slow 4G (562.5 ms, 1474.56 kbit/s down, 675 up) with 4× CPU, 412×823 at DPR 1.75, touch. Desktop: 40 ms, 10240 kbit/s. Cold cache; **5 runs per page and profile**, plus a repeat view. Scripted real input for INP. Lighthouse 13.6.0: mobile default and desktop presets, **3 runs per page** | C5-17 – C5-19 |

## 3. Findings

### Fixed in C5 (each with before/after evidence)

| ID | Severity | Finding | Requirement | Fix | Before → after |
| --- | --- | --- | --- | --- | --- |
| **F4** | **High** | Job Detail and Apply shift as they load: the short skeleton leaves the footer at the bottom of the first viewport, and the content pushes it down | PERF-004 (CLS ≤ 0.1), PERF-037 | Each loading skeleton is marked `data-content-pending`. The layout keeps its footer in place but unpainted (`:has()`) until the content is there | Lab CLS p75 (C5-17): Job Detail **0.271 → 0** (mobile) and **0.243 → 0.0007** (desktop); Apply 0.111 → 0 and 0.101 → 0.0007; missing Job 0.041 → 0. Lighthouse median (C5-19): Job Detail **77 → 94** (mobile) and **88 → 100** (desktop); Apply 91 → 96 and 97 → 100 |
| **F3** | Medium | Text at 200% (doubled browser text size) at 360–390 CSS px: a heading word wider than its column widened the column past the viewport. The page's `overflow-x: clip` then cut off headings, paragraphs and buttons on Home, About, Careers, Job Detail and Apply. Page zoom 200% and reflow at 320 px already passed | A11Y-017; Doc 03 §79 | Headings may break an over-long word. Job Detail's mobile column is `minmax(0, 1fr)`, and its card call to action may wrap. The region selector is capped at its container. The Apply submit button is capped at its container and may wrap | C5-12 at 390: 5 views clipped (Home: three sections; Careers, Job Detail, Apply, Apply errors: one each) → **0**. Screenshots `text200-*` from the `fffc252` runs, before and after. At 200% on a narrow phone, the largest headings now break inside long words ("syste|ms."), with no hyphen: nothing is lost, but it reads less smoothly (OD-C5-4) |
| **F2** | Medium | Shift+Tab to a control above the viewport scrolled it entirely under the sticky header: the Job Detail breadcrumb at 1440 and 390, and the Careers region selector at 390 | A11Y-010 (WCAG 2.4.11); Doc 05 §23 | `html { scroll-padding-block-start: header + 16 px }` | C5-08: **3 of 330 stops fully hidden → 0**. Error-summary links now land with the field's label in view |
| **F1** | Low | The Home operating-principles list kept the browser's default disc markers. They hung outside the column: in the page gutter at 360 px, and left of each item's hairline at 1440. Every other list in the design draws none | Doc 03 visual quality | `list-style: none` | Home screenshots at all 7 widths: markers gone, section 6–24 px shorter; everything above it is pixel-identical. Guarded by C5-07 |

**No other screenshot changed.** 273 screenshots were taken in both runs. **237 are pixel-identical**, including the other 77 of the 84 route × width screenshots: at default settings the fixes act only when text is enlarged, on scrolling, or while content loads.

The 36 that differ are all expected:
- Home: 7 widths, 14 breakpoint shots and the 200% zoom shot (F1);
- the 200% text shots (F3). In those two full runs, the shots did not show the doubled text: Chromium's capture drops the CDP setting. C5-12 at `fffc252` captures with the equivalent root size, and its before/after pair is the F3 visual evidence;
- Job Detail loading at 7 widths: the footer is not painted (F4);
- the two keyboard error-summary shots, which come to rest lower (F2);
- one recovered-state shot, where only the sticky header's captured position differs.

### Open — not fixed in C5

| ID | Severity | Finding | Why it is not fixed here |
| --- | --- | --- | --- |
| **O1** — **fixed in round 2 (F5, §8.1)** | **Medium** (WCAG A) | **WCAG 2.5.3 Label in Name.** The visible "Menu" button is named "Open navigation" / "Close navigation". The Careers rows (visible: title, facts, "View Role") are named "View {title} role". The Apply "Back to Role" link is named "Back to {title}". A speech-input user saying the visible words may not reach them. Lighthouse and axe's experimental rule both flag them (C5-06, C5-19) | These names are **canonical Doc 06 copy** (§9; the JobRow pattern; the Apply back link). Changing them is a requirements conflict under Doc 00: **OD-C5-1** |
| **O2** — investigated in round 2 (§8.3); still open | Medium | Mobile LCP under the applied Slow 4G + 4× CPU profile: p75 Job Detail 2.86 s, Apply 2.78 s, missing Job 2.83 s. Home, About and Careers are 2.13–2.16 s. The pages are client-rendered: the HTML carries the head, not the body, so the first contentful paint waits for the JavaScript. Job and Apply also wait for the Job API. Lighthouse's simulated mobile LCP: Home and Careers 0.75–0.80 s; Job Detail 2.96–3.31 s; Apply 2.63–3.07 s. Desktop LCP is under 1 s everywhere | PERF-002 is a **field** p75 target, and the lab profiles disagree by a factor of up to 3. Options that move the critical path change the C4 document server or the rendering architecture: **OD-C5-3**. Field data (M11) is the deciding evidence |
| **O3** | Medium | Oversized brand images. The header logo PNG is 1009×230 (92.7 KB) and shows at about 149×34. The footer mark PNG is 512×512 (about 135 KB) and shows at 30×30. Lighthouse estimates 88–219 KiB savings. The document server sends `/brand/*` as `no-cache` with no validator, so a repeat visit downloads them again (repeat view: 91–330 KiB, almost all of it images) | They are approved brand assets "used unmodified". Smaller derivatives need the owner's approval (**OD-C5-2**). Caching of non-fingerprinted files belongs to the host (C6, PERF-032/033). The budgets still pass: Home first load is 293 KiB lab, 328.8 KiB build |
| **O4** — **fixed in round 2 (F6, §8.4)**; the screen-reader check stays open | Medium (to confirm with NVDA) | Focus falls to the page body when the focused control is replaced: after Try Again recovers Careers or Job Detail, and after Apply succeeds. Success is announced through a `role="status"` inserted together with its text, which some screen readers may not announce | The success behaviour is a documented design choice ("announced politely rather than by stealing focus"). M1 decides whether it is announced. **OQ-C5-1** |
| **O5** | Low (to confirm with NVDA) | A failed submit raises the summary alert and one `role="alert"` per field error at once: six on the empty form | Doc 16 §53 asks not to over-announce. Only a real screen reader shows whether this is noisy (M1) |
| **O6** | Low | Careers row facts wrap with their "·" separator at the start of the next line at 360–430 px | Cosmetic; a design decision (**OD-C5-4**) |
| **O7** | Low | The browser accepts an e-mail whose local part exceeds 64 characters, which the server refuses ("Enter a valid email address."). The form recovers correctly, keeping all input | A B5 contract alignment, not a C5 layout defect (**OD-C5-4**) |
| **O8** | Info | axe "needs review" (`color-contrast`) on the Home hero and final call to action, which sit over gradients. Measured from rendered pixels instead (C5-15b): **all pass**. The lowest is 5.62:1 (the 12 px hero eyebrow); buttons are 5.86:1 and 16.15:1; headings are at least 12.65:1 | — |
| **O9** | Info | Lighthouse SEO is 58 on Apply | Expected: Apply is `noindex` by design (C4). Not a defect |
| **O10** | Low | Below the Valida 44×44 preference (A11Y-021, a design-quality target "where practical"): the header "Explore Careers" and "Menu" buttons and the region selector are 36 px high, and the native radio buttons 13 px (their labels are larger). Every one meets WCAG 2.5.8 | A design decision; no change in C5 (**OD-C5-4**) |

## 4. Results by requirement

`PASS` below means **passed in Chromium under the stated conditions**. It is not a claim for other browsers, devices or assistive technology.

| Requirement | Evidence (case, run) | Result |
| --- | --- | --- |
| Doc 18 §169; QA-WEB-013: the seven widths | C5-02, before and after: 12 routes × 7 widths = 84 fresh loads and full-page screenshots, inspected | PASS: no horizontal scroll, nothing leaving the viewport, no clipped text, no covered control |
| QA-WEB-014: intermediate widths | C5-03: 169 widths per route (every 10 px from 320 to 1920, and each breakpoint −1/0) × 12 routes; screenshots at the breakpoints for Home, Careers, Job and Apply | PASS: 0 failing widths |
| QA-WEB-017, QA-WEB-021: landscape, orientation | C5-03: 844×390 and 932×430 on every route (EMULATED viewport) | PASS. Real devices are M5 |
| QA-WEB-019; Doc 03 §84: long content | C5-02, C5-05: a 116-character title, an 83-character unbroken token, a 134-character e-mail, a 92-character file name, long messages | PASS |
| QA-WEB-015, QA-WEB-016: small-mobile Apply and navigation; controlled widths on large screens | C5-05, C5-09; screenshots at 1440 and 1920 | PASS |
| Doc 18 §169; Doc 16 §269: states | C5-01 empty (REAL); C5-04 loading (HOLD), error (FAULT) and recovery (REAL); closed Job and closed Apply; missing Job; 404; C5-05 Apply in 7 states, success stored once in MongoDB | PASS. Focus after recovery and success: **O4** |
| A11Y-038: automated testing | C5-06: axe-core 4.13.0, WCAG 2.0/2.1/2.2 A and AA; 12 routes × 2 widths, the open mobile menu, every state | PASS: **0 violations** |
| WCAG 2.5.3 (Level A): label in name | C5-06 (axe experimental rule), C5-19 (Lighthouse) | **FAIL. O1, escalated (OD-C5-1)** |
| A11Y-004 to A11Y-007, A11Y-035: language, landmarks, skip link, headings, alt | C5-07 on all 12 routes | PASS |
| A11Y-008, A11Y-009: keyboard, focus visible | C5-08: 330 Tab and Shift+Tab stops, each with a visible indicator. C5-10: keyboard-only Careers → Job → Apply → success | PASS. M10 is open |
| A11Y-010: focus not obscured | C5-08 | Before: **FAIL**, 3 stops fully under the header. After **F2**: PASS |
| A11Y-012: mobile navigation | C5-09: `aria-expanded`, Escape returns focus to the trigger, navigation closes the menu and focuses `main` | PASS |
| A11Y-013, A11Y-014: text contrast | C5-06: axe, 0 violations. C5-15b: rendered pixels where axe needed review (Home gradients), lowest 5.62:1 | PASS |
| A11Y-015: non-text contrast | C5-15: input, select, textarea and picker borders 4.05:1; focus ring 11.03:1; primary button 6.25:1 | PASS |
| A11Y-016: not colour alone | Screenshots: errors have text, and an icon or `aria-invalid`; "Applications Closed" is text | PASS |
| A11Y-017: text at 200% | C5-12 at 1280 and 390 (Chromium text-size setting, EMULATED) | Before: **FAIL** at 390. After **F3**: PASS. M6 is open |
| A11Y-018, A11Y-019: reflow; no horizontal scroll | C5-13: 320×256 on all 12 routes and Apply errors. C5-12: zoom 200%. C5-02 and C5-03 | PASS |
| A11Y-020: target size (WCAG 2.5.8) | C5-02: every control at 7 widths, with the spacing and user-agent-control exceptions | PASS: 0 failing |
| A11Y-021: about 44×44 for primary controls | C5-02: the header "Explore Careers", "Menu" and the region selector are 36 px high; the native radios are 13 px | **O10**, Low: a design decision |
| A11Y-022 to A11Y-027: labels, instructions, autocomplete, errors, error summary | C5-05, C5-10, C5-11. Every control is labelled; `name`, `email` and `tel` autocomplete; every invalid field has its message through `aria-describedby`; focus moves to the summary; the summary links reach the fields | PASS |
| A11Y-028: status announcements | C5-04 and C5-11: `role="status"` for loading, resume and success; `role="alert"` for errors | Proxy PASS. Real screen readers are M1 and M2; **O4, O5** |
| A11Y-029, A11Y-030: resume by keyboard; not drag-only | C5-10: the chooser opened from the keyboard (Enter) | PASS. The OS dialog is M10 |
| A11Y-032, A11Y-033: reduced motion | C5-14 (EMULATED): under `reduce`, 0 running animations, no transition over 0.01 s, instant scrolling, on 4 routes and the loading state | PASS. M9 is open |
| A11Y-039, A11Y-040: manual keyboard; screen reader | Chromium accessibility-tree snapshots (C5-11) only | **OPEN**: M1, M2, M10 |
| PERF-002 to PERF-004, PERF-036: lab Core Web Vitals | C5-17, 5 cold runs per page and profile (table below) | CLS: before **FAIL** on Job and Apply, after **F4** PASS. INP: PASS. Mobile LCP: **FAIL** on Job, Apply and missing Job (**O2**). Desktop: PASS. Field data is M11 |
| PERF-009 to PERF-013: budgets | `npm run verify:quality` at `777c1e6`: JS 111.4 KiB, CSS 8.8 KiB, fonts 109.7 KiB, Home 328.8 KiB (C4 at `2193433`: 111.4 / 8.7 / 109.7 / 328.7). Lab transfer (Brotli proxy): JS 95.7, CSS 8.0, fonts ≤ 97.8 KiB, Home 293.1 KiB | PASS |
| PERF-019: image sizing | Lighthouse image-delivery audit; displayed vs intrinsic size | **O3**: owner decision OD-C5-2 |
| PERF-020: image dimensions | Logo and mark carry `width`/`height`; image CLS 0 | PASS |
| PERF-031 to PERF-033: host compression and caching | Local facts only: the document server sends no compression, `immutable` on `/assets/`, `no-cache` with no validator elsewhere (C5-18; repeat views) | **C6** (M12) |
| PERF-037, PERF-038: Lighthouse ≥ 90 | C5-19, Lighthouse 13.6.0, 3 runs each (table below) | Before: Job 77 mobile and 88 desktop. After **F4**: every page ≥ 94 |
| QA-WEB-002 to QA-WEB-008: browsers and devices | Chromium 153 only | **OPEN**: M4, M5 |

### Lab performance, before (`06dd991`) → after (`72a9d52`)

C5-17, LAB, Chromium 153, cold cache, 5 runs per row; the lab compression proxy (Brotli). LCP and INP are in ms, at p75 of the 5 runs; CLS is also at p75. Transfer is in KiB on the wire, after the fixes, median of the runs. INP is the slowest scripted interaction of a run: taps or clicks on the menu, a role row, Apply for This Role, an empty submit, typing, and a radio button.

| Page / profile | LCP | CLS | INP | FCP | TBT | JS / CSS / fonts / images / API | Total | Repeat view |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Home / mobile | 2324 → **2160** | 0 → **0** | 96 → **88** | 2108 | 0 | 95.7 / 8 / 97.8 / 90.7 / — | 293.1 | 182.4 |
| About / mobile | 2272 → **2156** | 0 → **0** | 64 → **80** | 2148 | 0 | 95.7 / 8 / 97.8 / 90.7 / — | 293.1 | 182.4 |
| Careers / mobile | 2116 → **2128** | 0.0266 → **0.0266** | 56 → **56** | 2100 | 0 | 95.7 / 8 / 73.7 / 222.5 / 2.1 | 402.9 | 329.5 |
| Job Detail / mobile | 2932 → **2864** | 0.271 → **0** | 48 → **48** | 2064 | 0 | 95.7 / 8 / 97.8 / 222.5 / 3.3 | 428.9 | 278 |
| Apply / mobile | 2932 → **2780** | 0.1106 → **0** | 88 → **88** | 2028 | 0 | 95.7 / 8 / 97.8 / 90.7 / 3.3 | 296.3 | 145.4 |
| Missing Job / mobile | 2804 → **2828** | 0.0405 → **0** | — → **—** | 2048 | 0 | 95.7 / 8 / 84.6 / 222.5 / 1.3 | 413.7 | 353.5 |
| Home / desktop | 872 → **864** | 0.0005 → **0.0005** | 32 → **24** | 840 | 0 | 95.7 / 8 / 97.8 / 90.7 / — | 293.1 | 91.7 |
| About / desktop | 792 → **808** | 0.0003 → **0.0003** | 48 → **48** | 800 | 0 | 95.7 / 8 / 97.8 / 90.7 / — | 293.1 | 91.7 |
| Careers / desktop | 812 → **832** | 0.0003 → **0.0003** | 32 → **40** | 812 | 0 | 95.7 / 8 / 97.8 / 90.7 / 2.1 | 295.3 | 93.8 |
| Job Detail / desktop | 900 → **888** | 0.2433 → **0.0007** | 32 → **32** | 792 | 0 | 95.7 / 8 / 97.8 / 222.5 / 3.3 | 428.9 | 227.4 |
| Apply / desktop | 888 → **876** | 0.1007 → **0.0007** | 32 → **32** | 740 | 0 | 95.7 / 8 / 97.8 / 90.7 / 3.3 | 296.3 | 94.8 |
| Missing Job / desktop | 888 → **836** | 0.0271 → **0** | — → **—** | 780 | 0 | 95.7 / 8 / 84.6 / 222.5 / 1.3 | 413.7 | 225.5 |

**Lighthouse 13.6.0** (C5-19; simulated throttling, mobile = Moto G Power with Slow 4G and 4× CPU; benchmark index 1808–3140; 3 runs per page). Median Performance, before → after:

| | Home | Careers | Job Detail | Apply |
| --- | --- | --- | --- | --- |
| Mobile | 100 → 100 | 100 → 100 | **77 → 94** | 91 → 96 |
| Desktop | 100 → 100 | 100 → 100 | **88 → 100** | 97 → 100 |

Accessibility and Best Practices are 100 everywhere. SEO is 100, except Apply at 58 (`noindex` by design, O9). After the fixes, Lighthouse's simulated mobile LCP is 0.75–0.80 s on Home and Careers, 2.96–3.31 s on Job Detail, and 2.63–3.07 s on Apply.

**For reference** (C5-18), against the uncompressed document server, mobile, 3 runs: JS 361.2 KiB, CSS 45.7 KiB, LCP 3.68–3.84 s. Host compression (C6) is what brings the transfer to the lab-proxy figures above.

## 5. Decisions and questions for the owner

- **OD-C5-1 — DECIDED: [OD-2026-11-10-01](../review/OWNER_DECISION_2026-11-10-01_C5_LABEL_IN_NAME.md), implemented in round 2 (§8.1).** As raised: WCAG 2.5.3 against Doc 06 copy (Doc 00 change control). Doc 16 targets WCAG 2.2 AA. Three canonical accessible names do not contain their visible labels.
  - **Options:**
    - **(a)** Amend Doc 06 so each name contains its visible text. For example: "Menu" with `aria-expanded` and no `aria-label`; the Careers row named by its visible content; "Back to Role: {title}".
    - **(b)** Keep the Doc 06 copy and record a conscious exception.
    - **(c)** Change the visible labels instead.
  - **Recommendation: (a).** It is the smallest change, and it removes the Level A failure. Nothing changes until you decide.
- **OD-C5-2 — Brand image derivatives.** Should 2× display-size derivatives be produced from the approved masters, with recorded checksums: the header logo at about 298×68, the footer mark at 60×60, PNG or WebP? The masters stay unchanged. Or should the assets stay as they are? Caching of `/brand/*` goes to C6 either way.
- **OD-C5-3 — Mobile LCP approach. Round 2 (§8.3) measured the cause and a specific fix: a Job API preload from the document server.**
  - **Options:**
    - **(a)** Accept the lab result, and decide on field p75 in C6/C7.
    - **(b)** In C6, preload the Job API response from the document server for Job and Apply routes.
    - **(c)** Render the Job page body on the server.
  - **Recommendation: (a), with (b) evaluated in C6.**
- **OD-C5-4 — Small design items.**
  - the row separators (O6);
  - aligning the browser's e-mail check with the server (O7);
  - 44 px heights for the compact controls (O10);
  - whether the largest headings should get a smaller minimum size, so that at 200% text on narrow phones they break between words rather than inside them (F3).
- **OQ-C5-1 — implemented in round 2 (§8.4): focus moves to the new heading.** As raised: focus after replaced content (O4). Keep the current behaviour if NVDA (M1) announces success and recovery? Otherwise move focus to the new heading (`tabindex="-1"`).
- **Visual acknowledgements.** F1 removes visible list markers on Home. F4 hides the footer only while a Job is loading.

## 6. Manual checklist

Automated C5 runs used Playwright's Chromium only, with emulation. Nothing below has been run. Record each row as PASS / FAIL / N/A, with the date, the device, the OS and browser versions, the assistive-technology version and a note. A FAIL is reported, not fixed silently.

**Set-up for local rows (Windows, PowerShell).** Hold the C5 stack, so the pages are the same build with the same synthetic Jobs:

```powershell
cd e2e
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test_c5_manual"
$env:C5_HOLD_MINUTES = "60"
npx playwright test --config playwright.c5.config.js c5/c5-99-hold.e2e.js
```

**The set-up drops the database named in `MONGODB_TEST_URI` each time it starts: use a fresh, disposable `valida_test_…` name.** The site is then on `http://127.0.0.1:4203` until Ctrl+C or the time runs out. Everything stays on 127.0.0.1. A phone cannot reach it, except Android Chrome through `adb reverse tcp:4203 tcp:4203` and `adb reverse tcp:4120 tcp:4120` (USB debugging). That keeps the stack on loopback. iOS rows need the C6 preview host.

**Routes:** `/`, `/about`, `/careers`, `/careers/qa-c5-open-long`, `/careers/qa-c5-closed`, `/careers/qa-c5-open-long/apply`, `/privacy`, `/legal`, and any unknown path for the 404 page.

| # | Check | Environment | What to do | Pass when |
| --- | --- | --- | --- | --- |
| M1 | Screen reader, Chrome | NVDA (current) + Chrome (current), Windows | 1. With H, D and K, go through Home, Careers and Job Detail. 2. Open the mobile menu at a narrow window. 3. On Apply: Tab through every field and submit the empty form. 4. Follow one error-summary link, choose a resume, then submit a complete form. | Headings and landmarks are announced. Each control has a name, its required state and its help or error text. On the failed submit, what NVDA says is understandable and not repeated: **note how many alerts are read**. "Resume ready to submit." is announced. **Success is announced** although focus moves to the page body (open question OQ-2) |
| M2 | Screen reader, Firefox | NVDA + Firefox (current) | Repeat M1, steps 3 and 4 | As M1 |
| M3 | Speech input | Windows Voice Access, or Dragon | Say "click Menu" (narrow window), "click View Role" (Careers) and "click Back to Role" (Apply) | Each activates its control. Expected to pass since round 2 (F5, OD-2026-11-10-01) |
| M4 | Browsers | Edge and Firefox (Windows); Safari (macOS) | On every route at a wide and a narrow window, do one empty Apply submission and one complete one | Same layout and behaviour as Chromium; no horizontal scroll; focus visible |
| M5 | Real phones | iPhone with Safari (C6 preview host); Android with Chrome (`adb reverse`) | Portrait and landscape: the menu, Careers, Job Detail, Apply with a real file pick from the device, success | Usable with touch; nothing clipped; the file picker opens; the on-screen keyboard does not hide the focused field |
| M6 | OS text scaling | Windows Text size 200% + Edge; Android font size at maximum + Chrome; iOS Larger Text + Safari page zoom 200% | Every route, and the Apply validation state | No clipped or overlapping text; no horizontal scroll (C5-12 covers only the emulated Chromium setting) |
| M7 | Browser zoom | Chrome, Edge and Firefox at a 1280 px window, 200% and 400%; Firefox "Zoom Text Only" at 200% | Every route, and the Apply validation state | Reflows to one column with no two-dimensional scrolling; the header does not cover the focused control |
| M8 | Contrast themes | Windows: Settings > Accessibility > Contrast themes (for example "Night sky", "Desert") | Home, Careers, Job Detail, Apply validation | Focus indicator, input boundaries, buttons and error text all visible |
| M9 | Reduced motion | Windows: Settings > Accessibility > Visual effects > Animation effects **Off** | Home hero; scrolling to an anchor (the error-summary links) | No ambient or decorative motion; instant scrolling |
| M10 | Keyboard on the real OS | Windows + Edge, physical keyboard | Tab and Shift+Tab through every route; Escape on the menu; the file picker opened with Enter, the file chosen in the OS dialog by keyboard | No trap; focus is always visible and never fully under the header; the OS dialog is reachable and returns focus |
| M11 | Field Core Web Vitals | Production traffic (C6/C7): CrUX or RUM | p75 LCP, INP and CLS over 28 days, mobile and desktop | LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 (Doc 16) |
| M12 | Host delivery | Production host (C6) | Response headers of HTML, JS, CSS and fonts | Brotli or gzip on text; immutable caching on hashed `/assets/`; `no-cache` on HTML (the C4 contract) |

## 7. Not claimed

- Conformance to WCAG 2.2 AA (Doc 16 A11Y-002). Chromium automation plus emulation is evidence for specific checks, not a conformance evaluation.
- Field Core Web Vitals (PERF-005/007).
- Host compression, caching, TLS and redirects (C6).
- Other browsers and real devices (QA-WEB-002 – 008).
- The lab compression proxy is not the host.
- Lighthouse scores are one input, not the gate (PERF-038).

## 8. Round 2 — focused corrections (2026-11-10)

From `6487968`, on the owner's instruction "Focused QA corrections and README reconciliation". F1–F4 and the 11 earlier commits are unchanged. Sections 1–7 are kept as the round-1 record; where round 2 changes a statement, it says so here and in the row concerned.

| Commit | Kind | Subject |
| --- | --- | --- |
| `41542c7` | record | [OD-2026-11-10-01](../review/OWNER_DECISION_2026-11-10-01_C5_LABEL_IN_NAME.md): the three approved accessible names |
| `7dcfe02` | **fix F5** | Accessible names contain their visible labels |
| `5142ce2` | test | Selectors for the approved names; C5-06 gates label in name |
| `b6144fd` | test | Lab metrics aggregate every sample; missing evidence never passes |
| `684e9ca` | **fix F6** | Focus lands on the outcome heading after Try Again and Apply outcomes |
| `fb46282` | test | C5-21: keyboard continuity and the footer's return after loading |
| `1b10f9c` | test | The lab proxy serves immutable assets precompressed; runs record the critical path |
| `c83a09c` | docs | The root README reconciled with the verified GitHub consolidation |
| `b354744` | test | Opt-in experiment measuring a proposed Job API preload |

### 8.1 Label in name (O1 → fixed, F5)

OD-2026-11-10-01 keeps the visible labels and approves three names:

| Control | Visible | Name before | Name now (Chromium accessibility tree, C5-06) |
| --- | --- | --- | --- |
| Menu toggle, closed | Menu | Open navigation | **Menu**, `aria-expanded="false"` |
| Menu toggle, open | Menu | Close navigation | **Menu**, `aria-expanded="true"` |
| Careers role links (2 jobs listed) | title, facts, "View Role" | View {title} role | **View Role: {title}**; each unique |
| Apply back link | Back to Role | Back to {title} | **Back to Role: {title}** |

**C5-06 now fails on a regression.**
- axe-core's label-in-name rule runs on all 12 routes at 360 and 1440, and with the menu open.
- **One documented exception to the axe heuristic.** A Careers row is one link whose visible text is the title, its facts and "View Role". axe asks for *all* of that text in the name, so it still flags the approved "View Role: {title}". Those links are therefore gated by explicit checks instead: the computed name equals "View Role: {title}", starts with the visible call to action, contains the visible title, and is unique. No other node is excepted.
- A negative control puts the old toggle name back for one run, and the rule must detect it.

Lighthouse's own label-in-name audit: it passes on Apply (the back link) and is not raised on Home; on Careers it still flags the two role links, by the same whole-text heuristic as axe (Lighthouse Accessibility stays 100).

**Canonical documents still to synchronise** (Doc 00): Doc 06 §9, §87 and §110 still carry the old names. The exact replacement text is in the decision record, §3.

### 8.2 INP aggregation (harness defect, fixed)

`summarise()` read only the first run: `[null, 240, 260, 280, 300]` gave no INP summary, and the threshold assertion was skipped. `e2e/c5/perfStats.js` replaces it:
- every metric is aggregated from all samples, in any order, with valid and missing counts;
- only `PASS` passes. `FAIL` and `INSUFFICIENT` (a missing or short sample set) both fail C5-17;
- INP is `NOT_APPLICABLE` on a page with no scripted interaction (the missing Job).

`npm run test:c5:stats`: 16 unit tests, including first sample missing, all missing and above target.

**Recomputed from the original raw runs** (`c5/perfRecompute.mjs` on C5-17 and C5-18 at `06dd991` and `72a9d52`): **no p75 changed**. Every interactive page had 5 of 5 valid INP samples, so the defect did not affect a recorded result. The INP figures in §4 stand. The interactions themselves did not change in round 2; only the selector for the menu toggle did.

### 8.3 Mobile LCP on Job Detail, Apply and the missing Job (O2)

**Saved material.** No Chrome trace file was saved in round 1. What was saved is the per-run JSON (FCP, LCP, the LCP element, transfer) and the full Lighthouse reports, which include request timing. Round 2 adds each run's critical path (when the document, script, stylesheet and API requests start and finish) to C5-17.

**The LCP element** is the page's `h1` in all three cases: the Job title, "Apply for {title}", and "This role isn't available." Each is rendered only after the Job API answers.

**The critical path** (Job Detail, mobile, ms from the document request; a typical run):

| Step | Start | End |
| --- | --- | --- |
| Document | 0 | 581 |
| Script (95.7 KiB) and stylesheet | 604 | 1761 |
| Script runs, first paint (the skeleton) | — | ≈ 2040 (FCP) |
| **Job API request** | **2046** | **2730** |
| Job title painted (LCP) | — | ≈ 2820 |

The Job request cannot start until the script has downloaded and run. On this profile each request pays about 0.56 s of latency, so that late request costs about 0.7 s. Home, About and Careers have no such second step: their LCP equals their FCP.

**Brotli quality 11 in the lab proxy.** Compressing the main script on demand takes about 0.67 s of CPU per request here. One controlled comparison at the same code, 5 runs each:

| LCP p75 (ms) | Round 1 (`72a9d52`, on demand) | On demand, again | **Precompressed** | Precompressed + preload (experiment) |
| --- | --- | --- | --- | --- |
| Job Detail, mobile | 2864 | 2904 | **2844** | **2268** |
| Apply, mobile | 2780 | 2816 | **2876** | **2232** |
| Missing Job, mobile | 2828 | 2784 | **2712** | 2768 |
| Home, mobile | 2160 | 2212 | 2176 | 2184 |
| Job Detail, desktop | 888 | 980 | **388** | 376 |

- **On mobile the proxy's compression contributed nothing measurable.** The compressor streams, and the throttled link (1474.56 kbit/s) is slower than the compressor. The script finishes at the same moment either way (1761 against 1770 ms).
- **On desktop it added about 0.55 s** to every cold load. Round-1 desktop LCP figures (0.8–0.9 s) overstate the site by that much; precompressed, they are 0.31–0.39 s.
- The proxy now serves immutable assets precompressed by default, as a host does. The original failed run is kept unchanged.

**The gap remains on mobile**, so it is the site's, not the lab's.

**Proposed product fix (not implemented; owner decision OD-C5-3).** The document server already knows the Job a `/careers/<slug>` or `/careers/<slug>/apply` URL names. It would add one line to that document's head:

`<link rel="preload" as="fetch" crossorigin="anonymous" href="{API origin}/api/v1/jobs/{slug}">`

The browser then requests the Job while the script is still downloading, and the page's existing `fetch` reuses the response. Measured as an opt-in lab experiment (the proxy adds the link; the product is unchanged): **Job Detail 2844 → 2268 ms and Apply 2876 → 2232 ms**, both inside 2.5 s.

Limits of the proposal:
- **The missing Job is not helped** (2768 ms): a 404 preload is not reused, so the page asks again. That page is an error state, `noindex`.
- It touches the accepted C4 document server, so it needs the owner's decision and the C4 SEO suite rerun.
- A host that does not run the document server would need the same header or tag by its own means (C6).

**Field p75 stays open** (M11): it needs production traffic.

### 8.4 Keyboard continuity (O4 → fixed, F6) and the footer after loading

**Reproduced at `72a9d52`:** after Try Again recovered Careers or Job Detail, and after Apply succeeded, `document.activeElement` was `<body>` (C5-04, C5-05, C5-10). The next Tab restarted at the skip link.

**Fix:** the outcome's heading takes focus (`tabIndex="-1"`: reachable by script, not a Tab stop), only in answer to the user's own action. An initial load never moves focus. A failed submission keeps focus on its own button.

| After | Focus lands on | Next Tab |
| --- | --- | --- |
| Try Again on Careers (FAULT, then REAL) | `h2` "Open Roles" | the regional view selector, in the same section |
| Try Again on Job Detail | `h1` the Job title | the regional view selector in the summary |
| Apply: network failure | stays on "Try Again" | — |
| Apply: Try Again, then success (REAL) | `h1` "Thank you for applying." | "Back to Careers" |

**Duplicate announcements.** After success there is one live region, the polite status "Your application for {title} has been received." The focused heading's text is in no live region, so the heading is read once (by focus) and the status once. After recovery there is no live region with text. Whether a given screen reader reads both in a sensible order is M1.

**The footer returns.** F4 leaves the footer unpainted only while a `data-content-pending` marker is present. C5-21 holds each load, then lets it resolve:

| Route | Resolves into | Footer while pending | Footer after |
| --- | --- | --- | --- |
| Job Detail | success | hidden | visible, first link clickable |
| Job Detail | unavailable (404) | hidden | visible, clickable |
| Job Detail | error (FAULT) | hidden | visible, clickable |
| Apply | the form | hidden | visible, clickable |
| Apply | unavailable (404) | hidden | visible, clickable |
| Apply | error (FAULT) | hidden | visible, clickable |
| Apply | after submission success | — | visible, clickable |

### 8.5 Round-2 verification

All at `b354744` (the last commit that changes product or test code), 2026-11-10 23:01–23:30 UTC, same machine and tools as §1:

| Check | Result |
| --- | --- |
| Full C5 suite (22 cases; lab proxy precompressed) | **20 passed, 1 skipped (the hold case), 1 failed: C5-17**, on mobile LCP only: Job Detail 2860 ms, Apply 2872 ms, missing Job 2792 ms (O2, open). Every other verdict in C5-17 is PASS; INP 5 of 5 valid on every interactive page, p75 32–88 ms |
| C5-06 | 0 axe violations; label in name gated; names as in §8.1; negative control detected |
| C5-08 | 330 Tab and Shift+Tab stops, 0 failures (the new focus targets add no Tab stop) |
| C5-10, C5-21 | Keyboard-only Apply: the file chooser opened with Enter; focus on "Thank you for applying."; the next Tab is "Back to Careers" |
| C5-19 Lighthouse 13.6.0, median Performance | Home and Careers 100/100; Job Detail **91** mobile, 100 desktop; Apply 94 mobile, 100 desktop. Accessibility 100 on every page. (Job Detail mobile was 94 in round 1: its simulated LCP is 3.5 s, the same open O2) |
| C3 suite | **9 passed** |
| C4 SEO suite | **16 passed** |
| `npm run verify:quality` | Budgets PASS: JS 111.6 KiB, CSS 8.8 KiB, fonts 109.7 KiB, Home 329.0 KiB. **1134 / 1134** unit tests in 43 files |
| `npm run test:guards`, `npm run test:c5:stats` | 36 / 36; 16 / 16 |

**Reused from round 1, unaffected by round 2** (the paths they cover did not change): the before-run at `06dd991`, the before/after screenshot comparison for F1–F4, and the C5-12 baseline-frontend pair. The round-1 layout, state, reflow, motion and contrast results were also repeated in the full run above, and passed.

### 8.6 Owner checklist (short) — the items only a person can do

**Safe set-up on the exact candidate (Windows, PowerShell).**

```powershell
git clone https://github.com/SaEeDX4/valida.git C:\Temp\valida-c5-review   # a NEW folder; main is 389c421
cd C:\Temp\valida-c5-review
git fetch C:\path\to\<the handoff bundle> c5-work
git checkout --detach <final SHA from the handoff>
git rev-parse HEAD                      # must print that SHA
npm ci --prefix backend; npm ci --prefix frontend; npm ci --prefix e2e
cd e2e
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test_c5_manual"
$env:C5_HOLD_MINUTES = "60"
npx playwright test --config playwright.c5.config.js c5/c5-99-hold.e2e.js
```

- Use a **new folder**, never the owner's working copy.
- **The set-up DROPS the database named in `MONGODB_TEST_URI` every time it starts.** Use a fresh, disposable name such as `valida_test_c5_manual`. The suite refuses any name that does not match `valida_test` or `valida_test_<suffix>`; never point it at a database you want to keep.
- The site is then at `http://127.0.0.1:4203` until Ctrl+C. Nothing leaves 127.0.0.1, and no e-mail is sent.

| # | Do | Pass when |
| --- | --- | --- |
| 1 | **NVDA + Chrome.** On `/careers/qa-c5-open-long/apply`: submit the empty form; fix it; submit a complete form | The errors are understandable and not repeated; after success NVDA reads "Thank you for applying." and the received message, once each |
| 2 | **NVDA + Chrome.** Disconnect the network, load `/careers`, reconnect, press Try Again | NVDA reads "Open Roles" when the list returns; Tab continues into the list |
| 3 | **Speech input** (Windows Voice Access): "click Menu" at a narrow window; "click View Role" on Careers; "click Back to Role" on Apply | Each control is reached. With two jobs, "View Role" offers a numbered choice |
| 4 | **Keyboard, real OS file dialog.** On Apply, Tab to Choose File, press Enter, pick a PDF by keyboard | The dialog opens, the file is chosen, focus returns to the page |
| 5 | **A real phone** (Android Chrome through `adb reverse tcp:4203 tcp:4203` and `adb reverse tcp:4120 tcp:4120`; iPhone on the C6 preview host) | Menu, Careers, Job, Apply and success work by touch, portrait and landscape |
| 6 | **Text size.** Windows Text size 200% in Edge; Android font size at maximum | Nothing clipped; large headings may break inside a word |

The full list, including the other browsers, contrast themes, reduced motion and the C6/C7 items, is §6 (M1–M12). All of it stays **OPEN** until performed. In §6, M3 is now expected to pass, and the set-up there drops its database in the same way.

## 9. Round 3 — focused corrections and remaining-gate evidence (2026-11-13)

From `725cb53` (tree `48a510b`), on Astra's instruction "C5 Round 3: focused corrections and remaining-gate evidence". The 22 earlier C5 commits and the round-1 and round-2 evidence are unchanged. Sections 1–8 are kept as written; where round 3 changes a statement, it says so here.

**Status, kept separate:**

| | |
| --- | --- |
| Implementation | **Complete** for the two round-3 corrections (§9.1, §9.2) |
| Verification | **Passed, with one exception.** Everything automated and local passed except **C5-14 (reduced motion), which failed in both complete runs** (§9.7, open). **Not performed:** every manual check in §9.6 and §6 |
| Independent review, owner acceptance | **Pending.** C5 is not accepted |

| Commit | Kind | Subject |
| --- | --- | --- |
| `788e0a6` | test | The label-in-name exception covers only exact reviewed JobRow links; negative controls |
| `5af9893` | **product (C4 document server)** | The document server hints the Job API read on Job Detail and Apply documents |
| `f50e7f8` | test | C5-22 observes the hint in a browser; a no-preload comparison run |
| `98a8000` | docs | The hint in the READMEs and the C4 SEO implementation record |
| `8049060` | test | A preloaded Job read is listed as an API request in the critical path |
| `b5ec779`, `ade4f36` | test | The motion probe records what is running and where (the gate is unchanged) |

### 9.1 The Careers exception in C5-06, narrowed

**The finding.** C5-06 set aside every `label-content-name-mismatch` finding whose node was anywhere inside `[data-testid="careers-job-list"]`. A mismatched button, a second link or anything nested in a row would have been excused with the rows.

**The correction.** A finding is set aside only when **all** of these hold for the reported node:

1. it is itself a JobRow link: `ul[data-testid="careers-job-list"] > li > a`, not a descendant of one and not another control in the list;
2. its `href` is `/careers/{slug}` of a Job the public API lists at that moment;
3. the name Chromium computes for it is exactly `View Role: ` + that Job's title **from the API** (not from the page);
4. its one visible heading is that title, and its one visible call to action is `View Role`;
5. it contains no focusable descendant.

Everything else gates. The exception may be used only on Careers and at most once per listed Job; the case asserts both.

**Result at `8049060` and `b5ec779`.** The rule reported 2 nodes on Careers at 360 and at 1440 (the two listed Jobs' rows) and none on the other 11 routes or with the menu open. All 4 findings met the five conditions. Gate failures: 0.

**Negative controls.** Each puts one regression into the live page, runs the same rule and the same judgement, and restores the page. Each must produce a gate failure that names the injected node.

| Control | Injected | Gate fails | Why it is not excused |
| --- | --- | --- | --- |
| JobRow name, unrelated | first row named "Open role" | yes | computed name is not "View Role: " + the title |
| JobRow name, title dropped | first row named "View Role" | yes | the same |
| JobRow name, another role's title | first row named with the other Job's title | yes | the same |
| JobRow visible label changed | the visible call to action reads "View Role now" | yes | the visible call to action is not "View Role" |
| Unrelated button in the list | `<button aria-label="Dismiss">Save role</button>` in a list item | yes | not a JobRow link |
| Non-role link in the list | a list item > link to `/about`, named "Elsewhere", showing "About Valida" | yes | its `href` is not a listed Job |
| Control inside a row | a focusable `role="button"` named "Close", showing "Details", inside the first row | yes | not a JobRow link; the row itself also loses its exception |
| Menu toggle (round 2's control) | `aria-label="Open navigation"` | yes | not a JobRow link |

After the controls the page reports the same 2 findings, both excused, as before them.

**Raw findings retained.** `C5-06.json` → `labelInName.rawFindings` keeps every node axe reported on every route: target, HTML, impact, failure summary, the rule's checks with their data, the row facts and the computed name. `negativeControls` keeps what each control caught.

**How the whole-row link is read, and what this is not.**

- *What axe says.* The rule compares the link's whole visible text (title, the role's facts, "View Role") with its name, and reports the link because the facts are not in the name. Lighthouse's audit uses the same heuristic and reports the same two links.
- *The manual reading.* The name is "View Role: {title}". It begins with the visible call to action and contains the visible title. The role's facts (location, arrangement, hours, pay) are visible text of the same link and are **not** in its name. The name is meant to let a speech-input user say "View Role" or the title; whether speech input reaches the link that way, and whether a screen reader exposes the facts inside the link, has not been observed by anyone.
- *What is approved.* The owner approved that **copy** in OD-2026-11-10-01.
- *What is not established.* Whether that satisfies WCAG 2.5.3 (Level A) is a conformance judgement. It is **not made here**. An automated rule passing, or one of its findings being set aside, proves no conformance. The checks that would inform it — speech input (M3) and a screen reader (M1) on the Careers list — are **open** (§9.6).

### 9.2 Mobile LCP: the Job API read is hinted by the document server

**The cause (unchanged from §8.3).** The LCP element on Job Detail, Apply and the missing Job is the page's `h1`. It is rendered only after `GET /api/v1/jobs/{slug}` answers, and that request started only after the script had downloaded and run: about 0.7 s on the mobile profile.

**The change (`5af9893`).** On those documents the server writes one line after the head metadata:

`<link rel="preload" as="fetch" crossorigin="anonymous" href="{API}/api/v1/jobs/{slug}">`

The browser makes the request while the script is still downloading; the page's own `fetch` is then handed that response. Nothing in the page's code changed: `frontend/src` is untouched, and the page still decides its state from that request's own outcome.

| Question in the instruction | Answer | Evidence |
| --- | --- | --- |
| The correct public GET endpoint, safely encoded | Exactly the URL `jobsApi.js` requests: the same path and `encodeURIComponent`. Written only for a slug that passes the public slug contract (`[a-z0-9-]`, at most 120 characters), and HTML-escaped. The base must be empty or a plain origin (scheme, host, port); anything else writes no hint | Unit tests: 10 rejected bases (among them a `javascript:` URL, a base carrying markup, a path, credentials) and 7 rejected slugs |
| Which origin | The **browser-facing** API base compiled into the build (`valida-seo.json` → `apiBaseUrl`), never the server's own `--api-origin`, which may be an internal address | Unit test: the server's origin does not appear in the document |
| Fetch mode, CORS, credentials | The page's request is a CORS `GET` with `credentials: 'same-origin'` and no custom header; `crossorigin="anonymous"` requests the same mode. No preflight. The API allows the site's origin and sets no credentials | C5-22: `sec-fetch-mode: cors`; a cookie set for the API's host is **not sent**; no `Authorization` |
| Reused, not duplicated | **One** network request for the Job per document load, initiated by the parser; Resource Timing shows one entry, initiator `link`; no "preloaded but not used" warning after 6 s | C5-22, on both origins, for Job Detail, Apply and a closed Job. C5-17: the request count per page is unchanged (11, 10, 10) |
| Nothing stale afterwards | A client-side navigation (Job → Apply, Careers → a role) makes its own request. The API answers `no-store` | C5-22: 1, then 2, then 3 Job requests |
| No preload of submissions, private data or other routes | Only `GET /api/v1/jobs/{slug}`, public data, on the two Job routes. No hint on Home, About, Careers, Privacy, Legal, the 404 page, a slug outside the contract, or any 503 | Unit tests; C5-22 lists every route's preloads on both origins |
| Status codes, metadata, noindex, failure behaviour preserved | Status, `content-type`, `cache-control`, `x-robots-tag`, `retry-after` and every other byte of each document equal the unhinted server's, for indexable and review builds | Unit test comparing 10 paths on 2 pairs of servers; C4 SEO suite |
| Correct when the hint is ignored | With the link removed before the browser sees it, the page makes its ordinary request and shows the same heading | C5-22 (Job Detail, Apply, missing Job); the whole comparison run with `--no-job-preload` |
| Correct when the hinted request fails | The API unreachable from the browser, or answering 503: the error state, never the role and never "not found"; Try Again makes a new request and recovers | C5-22 |

Chromium only. A browser that does not support or cannot match the hint makes the page's ordinary request; other engines are part of the open manual checks.

### 9.3 The missing-Job page, investigated separately

**Round 2's statement is corrected.** §8.3 says "a 404 preload is not reused, so the page asks again". That was an inference, and it was wrong. The round-2 experiment added the link in the lab proxy, and the proxy rewrote only status-200 documents; the missing-Job document is a 404 and passed through untouched. The experiment never placed a hint on that page, so its unchanged 2768 ms showed nothing about a preloaded 404. (§8.3 is kept as written; the proxy's source now states this limit.)

**What the page waits for.** Request timing, mobile, without the hint (a typical run at `98a8000`):

| Step | Start | End |
| --- | --- | --- |
| Document (404) | 0 | 583 |
| Script and stylesheet | 610 | 1762 |
| First paint: the loading state | — | 2028 (FCP) |
| **Job API request (404)** | **2031** | **2633** |
| `h1` "This role isn't available." painted (LCP) | — | 2668 |

The LCP element is that `h1`. The whole delay after first paint is the one API round trip, which pays the profile's 562.5 ms latency. There is no other late resource.

**What was tested.** With the hint also written on a document whose Job read the API answered with "not found", Chromium made **one** request for it (parser-initiated, 404) and handed that response to the page's `fetch`: the same not-found state, no second request, no unused-preload warning (C5-22, Detail and Apply).

**What was done.** The hint's condition is "the server's own read of this URL was answered by the API": the Job (200) or "not found" (404). It is the same line, the same endpoint and the same rules; no rendering change, nothing concealed, and the page is still measured against the same threshold. Unknown, Draft and Archived Jobs all get the identical hint, so it tells them apart no more than the API does. A 503 gets none, so a struggling API receives no extra request.

This was a one-condition extension of §9.2, not an architecture change, so no decision was needed to proceed. It is separable: restricting the condition to status 200 in `jobApiPreloadTag` removes it, at the cost of the missing-Job result below.

### 9.4 Measurements (LAB) and verification

**Conditions, identical for both columns.** One production build per run (`VITE_ALLOW_INDEXING=true`), the real backend, the lab proxy with immutable assets precompressed (Brotli), Playwright Chromium, a new browser context per sample (cold cache), mobile: 412×823, DPR 1.75, 4× CPU, Slow 4G (562.5 ms, 1474.56 kbit/s down); desktop: 1350×940, 40 ms, 10240 kbit/s. 5 samples per page, run back to back on the same machine on 2026-11-13. The only difference is `--no-job-preload`. The two runs' code is identical (`f50e7f8` and `98a8000` differ in three documentation files).

These are **lab** figures. They are not field Core Web Vitals: Doc 16's p75 targets are field targets and need production traffic (M11, open).

| LCP, ms (5 of 5 valid in every cell) | Without the hint: median / p75 / range | **With the hint**: median / p75 / range | Target |
| --- | --- | --- | --- |
| Job Detail, mobile | 2808 / 2812 / 2756–2840 — FAIL | **2160 / 2176 / 2100–2196 — PASS** | 2500 |
| Apply, mobile | 2744 / 2760 / 2744–2768 — FAIL | **2172 / 2188 / 2092–2192 — PASS** | 2500 |
| Missing Job, mobile | 2692 / 2716 / 2668–2792 — FAIL | **2116 / 2128 / 2092–2128 — PASS** | 2500 |
| Home, mobile (no hint on this page) | 2100 / 2116 / 2056–2120 | 2052 / 2060 / 2000–2140 | 2500 |
| About, mobile (no hint) | 2072 / 2084 / 2052–2084 | 2096 / 2096 / 2060–2128 | 2500 |
| Careers, mobile (no hint) | 2100 / 2104 / 2080–2112 | 2068 / 2076 / 2024–2104 | 2500 |
| Job Detail, desktop | 380 / 380 / 328–388 | 328 / 348 / 296–348 | 2500 |
| Apply, desktop | 340 / 352 / 316–364 | 308 / 312 / 276–332 | 2500 |
| Missing Job, desktop | 340 / 352 / 328–360 | 316 / 320 / 288–324 | 2500 |

- The three failing pages improve by 0.57–0.64 s at p75 and now sit 0.31–0.37 s inside the target. The three pages without a hint moved by 8–56 ms in either direction, which is the run-to-run spread.
- With the hint, LCP follows first paint by about 0.1 s: the Job's answer is already there when the script runs.
- CLS and INP: PASS on every page in both runs (CLS p75 at most 0.0266; INP p75 24–80 ms, 5 of 5 valid on every interactive page; the missing Job has no scripted interaction).
- Requests per page are the same in both runs.

**No Chrome trace file was recorded** in any round. What is kept per sample is FCP, LCP and its element, CLS, long tasks, transfer by type and the start and end of each critical request.

**Verification**, 2026-11-13 (the last commit that changes product code is `5af9893`; the last that changes a test's judgement is `8049060`):

| Check | Result |
| --- | --- |
| Full C5 suite, run 1 at `8049060` (23 cases, Lighthouse included) | **21 passed, 1 skipped (the hold case), 1 FAILED: C5-14** (§9.7) |
| Full C5 suite, run 2 at `b5ec779` (the motion probe records detail; nothing else differs) | **21 passed, 1 skipped, 1 FAILED: C5-14** again |
| C5-17 in those two runs (hint on) | Every LCP, CLS and INP verdict PASS. Mobile LCP p75: Job Detail 2224 and 2148 ms, Apply 2128 and 2196 ms, missing Job 2096 and 2120 ms |
| C5-06 | 0 axe violations on 12 routes × 2 widths and the open menu; label in name: 4 findings, all exact reviewed JobRow links; 8 of 8 negative controls fail the gate |
| C5-22 | Passed in both runs (§9.2, §9.3) |
| C5-19 Lighthouse 13.6.0, median Performance (run 1; run 2) | Home and Careers 100/100. Job Detail mobile **94; 92**, desktop 100. Apply mobile **95; 96**, desktop 100. Accessibility 100 on every page |
| C4 SEO suite at `8049060` | **16 passed** |
| `npm run verify:quality` at `8049060` | Budgets PASS: JS 111.6 KiB, CSS 8.8 KiB, fonts 109.7 KiB, Home 329.0 KiB. **1140 / 1140** unit tests in 43 files (6 new server tests) |
| `npm run test:guards` at `8049060` | 36 / 36 |

`b5ec779` and `ade4f36` change only `e2e/c5/c5Support.js` (what the motion probe records), so the SEO suite, the quality gate and the guards at `8049060` apply to the final commit.

**Lighthouse's simulated LCP did not improve as the applied-throttling runs did, and this is not hidden.** Lighthouse estimates mobile LCP by simulation from an unthrottled load. Its figures in round 3: Job Detail 3.1–3.5 s (round 2: about 3.5 s), Apply 2.5–3.0 s. The Performance score passes its gate (at least 90) and rose slightly on Job Detail (91 → 92–94). The 2.1–2.2 s figures above come from C5-17, where the throttling is really applied to the network and CPU. The two methods disagree on these two pages; neither is field data. Only field p75 (M11) settles it.

**Reused, and why it still applies.**

| Evidence | From | Why unaffected |
| --- | --- | --- |
| C3 critical browser suite, 9 passed | `b354744` (round 2) | It serves the build with `vite preview`, not the document server, and round 3 changed nothing in `frontend/src` or `backend/` |
| `npm run test:c5:stats`, 16 passed | `b354744` | `perfStats.js` and its tests are unchanged |
| INP aggregation recomputation (§8.2) | round 2 | Not repeated, as instructed; no change affects it. INP was still measured in the runs above because C5-17 measures it with LCP |
| Before/after screenshots for F1–F4, the C5-12 baseline pair | round 1 | No style or component changed |

### 9.5 Documents

- **Updated in this repository:** this record; `docs/seo/C4_SEO_IMPLEMENTATION.md` (the hint, marked as a C5 addition outside the C4 acceptance); `README.md` and `e2e/README.md`.
- **Doc 06 is not synchronised.** §9, §87 and §110 of the canonical Doc 06 still carry the three old accessible names. The replacement text is in OD-2026-11-10-01 §3. **No external canonical document was updated in any C5 round**; that revision is made outside this repository under Doc 00 change control.
- **OD-C5-3** (§5) asked whether to preload the Job from the document server. Round 3's instruction permitted "a narrowly scoped, regression-tested change to the shared C4 server", and the change was made under it. It is **implemented and unaccepted**: its acceptance is part of C5's review, and it changes a server accepted in C4 at `2193433`.
- **Still open, unchanged and not acted on:** OD-C5-2 (brand image derivatives; O3) and OD-C5-4 (row separators, the browser's e-mail check, 44 px compact controls, heading minimum size). No redesign was added.
- **Noticed, not changed (outside this assignment):** `injectHead` in `frontend/server/renderDocument.js` passes the page title to `String.replace` as a replacement string, so a `$&`, `` $` ``, `$'` or `$$` sequence in a Job title would be interpreted rather than written literally. The title is HTML-escaped, so this is a display defect for an unusual title, not an injection. A one-line fix (a replacer function) is available when authorised.

### 9.6 Remaining gates and the owner checklist

**Acceptance blockers that remain:**

0. **C5-14 fails in complete runs with the hint (§9.7).** Astra's decision is needed on how to resolve it.
1. Astra's independent review of round 3, then the owner's acceptance.
2. The manual checks below. None has been performed by anyone; none is claimed.
3. Doc 06 synchronisation (§9.5).
4. Decisions OD-C5-2 and OD-C5-4, or their explicit deferral.

**Not blockers for C5, and not claimed:** field Core Web Vitals at p75 (M11; production traffic), compression and caching at the production host and the hint reproduced there (C6), other browser engines and real devices on the production host.

**The shortest practical owner checklist.** No action on the owner's machine is authorised by this record; this is what to do once it is.

*Before set-up:* **the set-up DROPS the database named in `MONGODB_TEST_URI` every time it starts.** Use a new, disposable name (`valida_test_c5_manual`). The suite refuses any name that is not `valida_test` or `valida_test_<suffix>`. Use a new folder, never the owner's working copy. The set-up commands are in §8.6, with the round-3 SHA from the handoff.

| # | Do (about 25 minutes in all) | Pass when |
| --- | --- | --- |
| 1 | **NVDA + Chrome**, Careers: move through the role links with Tab and with the links list (Insert+F7) | Each role is announced as "View Role: {title}", the roles are distinguishable, and the facts are reachable by reading the row |
| 2 | **NVDA + Chrome**, Apply: submit the empty form, fix it, submit a complete one | Errors are understandable and not repeated; "Thank you for applying." and the received message are read once each |
| 3 | **Speech input** (Windows Voice Access): "click Menu" in a narrow window; "click View Role" on Careers; "click Back to Role" on Apply | Each control is reached; with two roles, "View Role" offers a numbered choice |
| 4 | **Real keyboard and OS file dialog**: on Apply, Tab to Choose File, Enter, pick a PDF by keyboard | The dialog opens, the file is chosen, focus returns to the page |
| 5 | **Browser zoom 200% and 400%** in Chrome or Edge, and **Windows text size 200%** | Nothing clipped or overlapping; no horizontal scrolling at 400% on a 1280 px window |
| 6 | **A real phone** (Android Chrome through `adb reverse tcp:4203 tcp:4203` and `tcp:4120`) | Menu, Careers, a role, Apply and success work by touch, portrait and landscape |
| 7 | **Firefox or Safari**, one load of a role and of Apply | The role appears; the browser's network panel shows the Job request once or twice, never an error (the hint is optional there) |

The full list is §6 (M1–M12). Everything in it stays **OPEN** until performed.

### 9.7 Open: C5-14 (reduced motion) fails in complete runs

**What happened.** C5-14 asserts that, under emulated `prefers-reduced-motion: reduce`, no animation or transition is running on four pages. On Job Detail it counted **4**, expected 0.

| Run | Hint | Scope | C5-14 on Job Detail |
| --- | --- | --- | --- |
| Full suite, `8049060` | on | all 23 cases | **4 — FAIL** |
| Full suite, `b5ec779` | on | all 23 cases | **4 — FAIL** |
| Full suite, `ade4f36`, stopped after case 17 | **off** | cases 1–17 | 0 — pass |
| C5-14 alone, 2 runs and 25 repeats | on | 1 case | 0 in all 27 |
| C5-12 to C5-14; C5-08 with C5-14; C5-01 to C5-16 without C5-08; C5-01 to C5-14 | on | partial | 0 in all 4 |
| Round 2 full suite, `b354744` | (no hint existed) | all 22 cases | 0 — pass |

**What the 4 are** (recorded in run 2): four `CSSTransition`s on `li` elements, property `visibility`, duration **0.01 ms**, at `currentTime` 0. No element on the page declares an animation or transition longer than 0.01 s (the probe's `moving` list is empty). 0.01 ms is the site's reduced-motion rule itself (`base.css`: every transition is shortened to 0.01 ms so that it completes at once).

**What is and is not established.**
- Established: nothing perceptible moves; the count comes from 0.01 ms `visibility` transitions; it appears with the hint in complete runs and did not appear in the one complete run without it.
- **Not established:** which list the four items belong to (the later probe detail that records it never reproduced the count), why the transitions are still at time 0 when probed, and why only a complete run shows it. The likely trigger is the footer's return (F4: the footer is `visibility: hidden` while a Job is pending) happening earlier now that the Job's answer arrives with the script, but that is a hypothesis, not a finding.
- One complete run without the hint is a single sample; it does not prove the hint is the cause.

**Not done.** The gate was not changed, the case was not removed, and the failing runs are kept. C5-14's result is reported as it is.

**Smallest options, for Astra's decision:**

| Option | What | Trade-off |
| --- | --- | --- |
| A | Count as running only an animation or transition longer than 10 ms, the threshold the same probe already uses for declared motion; keep recording all of them | Matches what reduced motion is about (perceptible motion) and the site's own 0.01 ms rule. It is a change to a gate's criterion made after a failure, so it needs agreement first |
| B | Keep the gate; spend a further diagnostic pass on the complete-run condition (each attempt is a 20-minute run) | No gate change. Cost unknown; the result may be the same 0.01 ms transitions |
| C | Restrict the hint to status-200 documents or switch it off | Does not address this (Job Detail is a 200 page); switching the hint off restores the three LCP failures |

Recommendation: A, with the two failing runs kept as the record of why.
