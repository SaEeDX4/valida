# A6 — Frontend Quality Baseline: Windows QA Matrix

**Branch:** `a6-quality-baseline` (from A5 baseline `33457d8`)
**Purpose:** the browser, device and assistive-technology checks that automated
tests cannot perform. jsdom performs no layout, renders no pixels, runs no
screen reader and measures no real network — so everything below is
**NOT VERIFIED** until a person runs it.

## Status

| | |
|---|---|
| **A6 implementation status** | AUTOMATED / STATIC VERIFICATION COMPLETE |
| **This matrix** | NOT YET EXECUTED |
| **Acceptance target** | READY FOR BACKEND INTEGRATION — reached only after this matrix is executed and ChatGPT approves A6 |
| **Not** | GPT-approved yet; not Phase 1 VERIFIED |

Automated and static checks establish structure, metadata, budgets and fixture
isolation. They do **not** establish that responsive layout, accessibility,
performance or SEO pass in a real browser. None of those may be reported as
passing until the corresponding rows below are executed and recorded.

Phase 1 verification happens after Release B (backend) and Release C
(integration and deployment).

---

## 0. Setup — fixtures OFF first

Your `frontend/.env` may still contain `VITE_ENABLE_A5_FIXTURES=true` from A5
browser QA. **Start by turning fixtures OFF.** The procedure has three phases,
and each states the fixture setting it requires.

### Phase A — production verification (fixtures OFF)

Edit `frontend/.env` so it contains:

```powershell
VITE_ENABLE_A5_FIXTURES=false
```

(Deleting `frontend/.env` entirely has the same effect — the default is off.)

```powershell
node -v                  # expect v24.x.x (A6 was built and tested on v22.22.2)
cd frontend
npm ci
npm run verify:quality   # build + budget gate + full test suite
npm run preview          # production build at http://localhost:4173
```

Expected from `verify:quality`: `ALL QUALITY BUDGET CHECKS PASSED`, then
`Test Files 38 passed`, `Tests 956 passed`.

Every row in sections 2-9 below carries a **Mode** column. Run the rows marked
**A** here. In this phase Careers must show **"Open roles are temporarily
unavailable."** — that is the correct result with no backend, and it confirms
fixtures are off.

> Structural guarantee, independent of this procedure: the fixture code is
> removed from any production build at compile time. A build made with
> `VITE_ENABLE_A5_FIXTURES=true` was verified to contain zero fixture markers.
> Setting the flag correctly still matters for **human** QA, so that what you
> see matches what you think you are testing.

### Phase B — development state QA (fixtures ON, `npm run dev` only)

Stop the preview server. Edit `frontend/.env`:

```powershell
VITE_ENABLE_A5_FIXTURES=true
```

```powershell
npm run dev              # http://localhost:5173 — NOT npm run preview
```

The browser console should show a warning beginning
`[Valida] A5 DEVELOPMENT FIXTURES ACTIVE` — confirming fixtures are on.

Scenarios are selected with `?a5=` — e.g. `?a5=jobs-empty`, `?a5=job-closed`,
`?a5=apply-success`. Region is selected with `?region=` — e.g. `?region=DE`.
Every fixture value that is not source-established is visibly prefixed
`[DEV FIXTURE]`.

Run the rows marked **B** here. Any state that depends on a fixture — loading
skeletons, the submit spinner, role lists, Job Detail, the Apply form and its
states — can only be reached in this phase, because a production build contains
no fixtures by design.

### Phase C — return fixtures OFF

Stop the dev server. Edit `frontend/.env` back to:

```powershell
VITE_ENABLE_A5_FIXTURES=false
```

Then confirm with `npm run dev` that Careers shows the error state again and the
console no longer shows the fixtures warning. Do not leave the flag on after QA.

## Mode legend

| Mode | Server | Fixtures | Base URL |
|---|---|---|---|
| **A** | `npm run preview` (production build) | OFF | `http://localhost:4173` |
| **B** | `npm run dev` | ON | `http://localhost:5173` |

Fixture scenario reference (Mode **B** only). With no `?a5=` parameter the list
shows several roles and each role slug shows its open Job:

| Surface | Scenarios |
|---|---|
| Careers `/careers` | *(none)* several roles · `jobs-one` · `jobs-empty` · `jobs-error` · `jobs-loading` |
| Job Detail `/careers/cybersecurity-specialist` | *(none)* open role · `job-closed` · `job-notfound` · `job-error` · `job-loading` |
| Apply `/careers/cybersecurity-specialist/apply` | `apply-success` · `apply-serverfields` · `apply-network` · `apply-closed` · `apply-ratelimit` · `apply-submitting` |
| Other roles | `/careers/dev-fixture-platform-engineer` · `/careers/dev-fixture-long-title-role` |

---

## 1. Browsers

| Browser | Required | Result |
|---|---|---|
| Chrome (latest) | Primary | |
| Edge (latest) | Yes | |
| Firefox (latest) | Yes | |
| Safari / iOS Safari | If available | |

---

## 2. Viewports

Chrome DevTools device mode. Every cell: **no horizontal page scroll**, no
clipped text, no overlapping elements.

| Width | Home **A** | About **A** | Privacy **A** | Legal **A** | 404 **A** | Careers **B** | Job Detail **B** | Apply **B** |
|---|---|---|---|---|---|---|---|---|
| 320 | | | | | | | | |
| 360 | | | | | | | | |
| 390 | | | | | | | | |
| 430 | | | | | | | | |
| 768 | | | | | | | | |
| 1024 | | | | | | | | |
| 1280 | | | | | | | | |
| 1440 | | | | | | | | |
| 1920 | | | | | | | | |

Overflow check in the DevTools console, on each page:

```js
document.documentElement.scrollWidth > document.documentElement.clientWidth
// must be false
```

---

## 3. Specific layout checks

| # | Mode | Check | How | Result |
|---|---|---|---|---|
| L1 | **B** | **Job Detail sticky summary clears the header** | 1440×900, `/careers/cybersecurity-specialist`, scroll slowly. The "Employment Details" heading, Location and Work Arrangement must stay visible below the sticky header — never slide under it. | |
| L2 | **B** | Sticky summary on a short laptop | 1366×768, same URL. The card scrolls inside itself rather than overflowing. | |
| L3 | **B** | Job Detail mobile order | 390px, same URL. Order: title → Employment Details → Apply → role content → final CTA. | |
| L4 | **B** | Long title wrapping | 320px, `/careers` (no scenario — includes the long-title role) and `/careers/dev-fixture-long-title-role`. Wraps, never overflows. | |
| L5 | **B** | Long filename | 320px, `/careers/cybersecurity-specialist/apply`, choose a file with a 150+ character name. Wraps. | |
| L6 | **B** | Long market list | 320px, `/careers/dev-fixture-platform-engineer?region=BR`. Supported markets wrap. | |
| L7 | **A** | Mobile menu panel width | ≤899px, `/`, open the menu. The panel spans the full header width. | |
| L8 | **B** | Region badge | `/careers/cybersecurity-specialist?region=DE`. Badge reads "Germany / Regional view"; the flag is decorative and the country name is always present as text. | |
| L9 | **B** | **Apply simplified shell** | 390 and 1440, `/careers/cybersecurity-specialist/apply`. Header shows only the logo and "Back to Careers" — no Home/About/Careers nav, no "Explore Careers", no Menu button. Footer shows only the ownership line, Privacy and Legal. | |
| L10 | **B** | Apply shell on 320 | 320px, same URL. Logo and "Back to Careers" wrap cleanly; footer links wrap. | |

---

## 4. Keyboard

Mouse unused. Tab, Shift+Tab, Enter, Space, Escape, arrows.

| # | Mode | Check | Result |
|---|---|---|---|
| K1 | **A** | `/`: first Tab shows **Skip to main content**; Enter moves focus into main. | |
| K2 | **A + B** | **Focus ring clearly visible** on every link, button, input, select, file picker and region selector. Check static routes in A and Careers / Job Detail / Apply in B. | |
| K3 | **A** | `/`: header nav, logo and CTA reachable in logical order. | |
| K4 | **A** | ≤899px, `/`: Enter opens the menu, focus lands on the first link, Escape closes it and returns focus to the Menu button. | |
| K5 | **A** | ≤899px, `/careers`: selecting Careers in the mobile menu closes it. | |
| K6 | **A** | After clicking a nav link, focus is not stranded in the header. | |
| K7 | **B** | `/careers/cybersecurity-specialist/apply`: submit empty → focus moves to the error summary; each summary link jumps to its field. | |
| K8 | **B** | **Resume picker**, same URL: Tab reaches it; the visible "Choose File" control shows the focus ring; Enter/Space opens the OS picker. | |
| K9 | **B** | `/careers/cybersecurity-specialist?region=CA`: region selector changes view with keyboard alone. | |
| K10 | **A + B** | No keyboard trap anywhere. | |
| K11 | **B** | **Apply shell order**: on the Apply URL, Tab gives Skip link → logo → "Back to Careers" → form. | |
| K12 | **B** | **Focus across shells**: from `/careers/cybersecurity-specialist` activate "Apply for This Role", then from Apply activate "Back to Careers". After each, focus is on the main content region — never lost to the document body. Check by pressing Tab once: focus should land on the first control inside the new page's main content, not restart from the browser chrome or the page top. | |

---

## 5. Screen reader

NVDA (free) with Chrome or Firefox.

| # | Mode | Check | Result |
|---|---|---|---|
| S1 | **A** | `/`: landmarks announced — banner, navigation, main, contentinfo. | |
| S2 | **A** | Heading navigation (H) gives a sensible outline, one H1 per page, on each static route. | |
| S3 | **B** | `/careers?a5=jobs-loading`: "Loading open roles…" announced once. | |
| S4 | **B** | `/careers?a5=jobs-error` vs `/careers?a5=jobs-empty`: announced as different states. | |
| S5 | **B** | Apply, submit empty: field errors announced on the field and in the summary. | |
| S6 | **B** | Apply: resume "ready to submit" and error messages announced. | |
| S7 | **B** | `…/apply?a5=apply-success`: success announced without stealing focus. | |
| S8 | **B** | `/careers`: job links announce "View {title} role", not just "View Role". | |
| S9 | **B** | Apply shell: banner announces only the logo and "Back to Careers"; the Legal navigation is announced in the footer. | |

---

## 6. Zoom, reflow and text spacing

The critical cases are the Apply form and Job Detail, which only render with
fixtures on. Run them in **B**, not only against the production error state.

| # | Mode | Check | Result |
|---|---|---|---|
| Z1 | **A** | 200% zoom on `/`, `/about`, `/privacy`, `/legal` — no loss of content or function. | |
| Z2 | **B** | 200% zoom on `/careers/cybersecurity-specialist` and its `/apply` form — every field, the resume picker and Submit remain usable. | |
| Z3 | **A** | 400% zoom at 1280px wide on `/` and `/privacy` — reflows to one column, no horizontal scroll (WCAG 1.4.10). | |
| Z4 | **B** | 400% zoom at 1280px wide on Job Detail and Apply — reflows to one column; the sticky summary is not sticky at this width; no horizontal scroll. | |
| Z5 | **B** | 400% zoom on Apply with validation errors shown (submit empty) — error summary and field messages remain readable and reachable. | |
| Z6 | **A + B** | Text-spacing bookmarklet (line-height 1.5, letter 0.12em, word 0.16em, paragraph 2em) on `/` (A) and Apply (B) — no clipping. | |

---

## 7. Reduced motion

Windows: **Settings → Accessibility → Visual effects → Animation effects: Off**.
Reload after changing it.

| # | Mode | Check | Result |
|---|---|---|---|
| R1 | **A** | `/`: the Security Field is completely static. | |
| R2 | **B** | `/careers?a5=jobs-loading`: skeleton shimmer has stopped; the skeleton is still visible. | |
| R3 | **B** | `…/apply?a5=apply-submitting`, fill the required fields and submit: the button spinner stops rotating but remains visible. | |
| R4 | **A** | Navigate between routes: scrolling to top is instant, not smooth. | |
| R5 | **A + B** | Nothing else animates on the routes above. | |

---

## 8. Console, network and Lighthouse

All rows in this section are **Mode A** — the production build with fixtures
off, which is what a visitor receives.

| # | Mode | Check | Result |
|---|---|---|---|
| C1 | **A** | **Console: no errors and no warnings** on every route. | |
| C2 | **A** | Network: no request to any third-party origin. | |
| C3 | **A** | Network: no request for any `.woff` file (only `.woff2`). | |
| C4 | **A** | Network: the footer mark PNG is only requested when scrolled near the footer. | |
| C5 | **A** | `/careers` shows the **error** state, never "No open roles". | |
| C6 | **A** | No `[Valida] A5 DEVELOPMENT FIXTURES ACTIVE` warning in the console. | |

In Mode **B** the console is expected to show exactly one warning — the fixtures
notice — and nothing else.

Lighthouse, **Mode A** (DevTools → Lighthouse, Mobile, Navigation):

| Route | Performance | Accessibility | Best Practices | SEO | LCP | CLS | TBT |
|---|---|---|---|---|---|---|---|
| `/` | | | | | | | |
| `/about` | | | | | | | |
| `/careers` | | | | | | | |
| `/privacy` | | | | | | | |

Doc 16 targets: Performance ≥ 90, Accessibility ≥ 95, SEO ≥ 95, LCP ≤ 2.5 s,
CLS ≤ 0.1. A localhost run is **not** field data and does not represent
production CDN delivery. Lighthouse for Job Detail and Apply is not meaningful
yet: in Mode A they render their no-backend states, and Mode B runs the
unoptimised development server.

---

## 9. Required screenshots

| # | Mode | Screenshot |
|---|---|---|
| 1 | **A** | Home at 390 and 1440 |
| 2 | **B** | Careers — several roles, `jobs-empty`, `jobs-error` — at 390 |
| 3 | **B** | Job Detail at 390 and 1440, including **L1 mid-scroll** |
| 4 | **B** | Apply default, validation errors, `apply-success` at 390 |
| 5 | **B** | Apply simplified shell (L9) at 1440 |
| 6 | **A + B** | Focus visible on a nav link (A), a button, the resume picker and the region selector (B) |
| 7 | **A** | Mobile menu open at 390 |
| 8 | **A** | Reduced-motion Home |
| 9 | **A** | 404 at 390 |
| 10 | **A** | Lighthouse summary for Home |
| 11 | **A** | Console clean on Home |

---

## 10. Known items to confirm, not fix

- **Header logo transfer.** The approved horizontal logo is a 1009×230 PNG
  (~90.5 KiB) rendered at 34–38px high. No smaller approved transparent variant
  exists. A smaller approved export is recommended; the asset must not be
  resized or re-encoded without brand approval.
- **Footer mark.** A 512×512 transparent PNG (~131.6 KiB) rendered at 30px. It
  is lazy-loaded below the fold, so it is not first-load transfer. The app-icon
  variants are RGB with no alpha and are designated for PWA/favicon use, so they
  are not a valid substitute.
