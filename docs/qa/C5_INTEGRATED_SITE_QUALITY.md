# C5 — Integrated Site Quality

| | |
| --- | --- |
| Milestone | Release C, **C5 — Integrated Site Quality** (Doc 18 §§168–172) |
| Baseline | `389c421a72fb090dc2c08c8251b664bada73d9a0` (GitHub `main` = `c4-work`) |
| Harness | `06dd991` (suite); follow-ups `f82f765`, `47bf227`, `777c1e6` and `fffc252`. Test code only |
| Fixes | `24a351d` F1, `22344eb` F2, `4807dda` F3, `72a9d52` F4. Frontend CSS and two data attributes; the backend is unchanged |
| Status | **READY FOR REVIEW. Open: owner decisions OD-C5-1 to OD-C5-4 and OQ-C5-1, and the manual checklist M1–M12. C5 is not complete until those are settled**. Final acceptance belongs to the owner |
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
| **O1** | **Medium** (WCAG A) | **WCAG 2.5.3 Label in Name.** The visible "Menu" button is named "Open navigation" / "Close navigation". The Careers rows (visible: title, facts, "View Role") are named "View {title} role". The Apply "Back to Role" link is named "Back to {title}". A speech-input user saying the visible words may not reach them. Lighthouse and axe's experimental rule both flag them (C5-06, C5-19) | These names are **canonical Doc 06 copy** (§9; the JobRow pattern; the Apply back link). Changing them is a requirements conflict under Doc 00: **OD-C5-1** |
| **O2** | Medium | Mobile LCP under the applied Slow 4G + 4× CPU profile: p75 Job Detail 2.86 s, Apply 2.78 s, missing Job 2.83 s. Home, About and Careers are 2.13–2.16 s. The pages are client-rendered: the HTML carries the head, not the body, so the first contentful paint waits for the JavaScript. Job and Apply also wait for the Job API. Lighthouse's simulated mobile LCP: Home and Careers 0.75–0.80 s; Job Detail 2.96–3.31 s; Apply 2.63–3.07 s. Desktop LCP is under 1 s everywhere | PERF-002 is a **field** p75 target, and the lab profiles disagree by a factor of up to 3. Options that move the critical path change the C4 document server or the rendering architecture: **OD-C5-3**. Field data (M11) is the deciding evidence |
| **O3** | Medium | Oversized brand images. The header logo PNG is 1009×230 (92.7 KB) and shows at about 149×34. The footer mark PNG is 512×512 (about 135 KB) and shows at 30×30. Lighthouse estimates 88–219 KiB savings. The document server sends `/brand/*` as `no-cache` with no validator, so a repeat visit downloads them again (repeat view: 91–330 KiB, almost all of it images) | They are approved brand assets "used unmodified". Smaller derivatives need the owner's approval (**OD-C5-2**). Caching of non-fingerprinted files belongs to the host (C6, PERF-032/033). The budgets still pass: Home first load is 293 KiB lab, 328.8 KiB build |
| **O4** | Medium (to confirm with NVDA) | Focus falls to the page body when the focused control is replaced: after Try Again recovers Careers or Job Detail, and after Apply succeeds. Success is announced through a `role="status"` inserted together with its text, which some screen readers may not announce | The success behaviour is a documented design choice ("announced politely rather than by stealing focus"). M1 decides whether it is announced. **OQ-C5-1** |
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

- **OD-C5-1 — WCAG 2.5.3 against Doc 06 copy (Doc 00 change control).** Doc 16 targets WCAG 2.2 AA. Three canonical accessible names do not contain their visible labels.
  - **Options:**
    - **(a)** Amend Doc 06 so each name contains its visible text. For example: "Menu" with `aria-expanded` and no `aria-label`; the Careers row named by its visible content; "Back to Role: {title}".
    - **(b)** Keep the Doc 06 copy and record a conscious exception.
    - **(c)** Change the visible labels instead.
  - **Recommendation: (a).** It is the smallest change, and it removes the Level A failure. Nothing changes until you decide.
- **OD-C5-2 — Brand image derivatives.** Should 2× display-size derivatives be produced from the approved masters, with recorded checksums: the header logo at about 298×68, the footer mark at 60×60, PNG or WebP? The masters stay unchanged. Or should the assets stay as they are? Caching of `/brand/*` goes to C6 either way.
- **OD-C5-3 — Mobile LCP approach.**
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
- **OQ-C5-1 — Focus after replaced content (O4).** Keep the current behaviour if NVDA (M1) announces success and recovery? Otherwise move focus to the new heading (`tabindex="-1"`).
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

The site is then on `http://127.0.0.1:4203` until Ctrl+C or the time runs out. Everything stays on 127.0.0.1. A phone cannot reach it, except Android Chrome through `adb reverse tcp:4203 tcp:4203` and `adb reverse tcp:4120 tcp:4120` (USB debugging). That keeps the stack on loopback. iOS rows need the C6 preview host.

**Routes:** `/`, `/about`, `/careers`, `/careers/qa-c5-open-long`, `/careers/qa-c5-closed`, `/careers/qa-c5-open-long/apply`, `/privacy`, `/legal`, and any unknown path for the 404 page.

| # | Check | Environment | What to do | Pass when |
| --- | --- | --- | --- | --- |
| M1 | Screen reader, Chrome | NVDA (current) + Chrome (current), Windows | 1. With H, D and K, go through Home, Careers and Job Detail. 2. Open the mobile menu at a narrow window. 3. On Apply: Tab through every field and submit the empty form. 4. Follow one error-summary link, choose a resume, then submit a complete form. | Headings and landmarks are announced. Each control has a name, its required state and its help or error text. On the failed submit, what NVDA says is understandable and not repeated: **note how many alerts are read**. "Resume ready to submit." is announced. **Success is announced** although focus moves to the page body (open question OQ-2) |
| M2 | Screen reader, Firefox | NVDA + Firefox (current) | Repeat M1, steps 3 and 4 | As M1 |
| M3 | Speech input | Windows Voice Access, or Dragon | Say "click Menu" (narrow window), "click View Role" (Careers) and "click Back to Role" (Apply) | Each activates its control. **Expected to FAIL until OD-C5-1 is decided** (WCAG 2.5.3) |
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
