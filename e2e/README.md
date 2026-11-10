# Valida — critical browser E2E (C3)

This suite covers Doc 17 sections 197–213 and Doc 18 section 161. It runs a real browser against:

- the **production build** of the frontend, served by `vite preview`;
- the **real Express backend**, started by the backend's own `startServer()` and bound to 127.0.0.1 (`support/backendLauncher.mjs`);
- a **disposable MongoDB** database;
- **private local storage**;
- a **local SMTP test server**.

It starts and stops all of these itself. It changes nothing in `frontend/` or `backend/`, and it never reads `backend/.env`.

## What a run proves, and what it does not

| Proven | Not proven |
| --- | --- |
| Form → multipart → server validation → Job eligibility → private storage → MongoDB → notification → response → UI state | Production hosting, MongoDB, storage or e-mail (C6/C7) |
| The Application and its private file exist; their checksums match; no public URL serves the file | The Titan/Bluehost relay, DNS, SPF/DKIM/DMARC, deliverability (D3/D4) |
| The backend's **real SMTP adapter** completed TLS (chain and host name verified against a local test CA), logged in, and submitted each message, which the local test server accepted or refused | That any mail reached a real mailbox — nothing leaves the machine |
| Idempotency under a double-click, a same-key race, a network failure and a lost response | Load, real devices, browsers other than Chromium |
| Acknowledgements go through the existing B7 suppression gate, with a synthetic key | Production acknowledgements: these stay **refused at start-up** (`ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP`); the suite runs with `APP_ENV=local` |

**The backend listens on 127.0.0.1 only.** `node src/server.js` (`npm start`) listens on every interface, which is the production default and is unchanged. The suite instead starts the same server through `support/backendLauncher.mjs`, with startServer's existing `listenHost: '127.0.0.1'` option, the option the live smoke test uses. Before anything else runs, the setup does two checks, and it proceeds only if both pass:

- The launcher reports the address its socket **actually** listens on, read from the server itself (`server.address()`). The setup requires exactly `127.0.0.1`, IPv4, on the expected port.
- The setup tries the port on every non-loopback IPv4 address of the machine, and requires each attempt to be refused.

Both results are in `run.json` (`backendListening`).

Acknowledgements are switched on **only inside this local run**:
- the synthetic suppression key is registered through the real `ops:notifications:suppression key-register` CLI;
- every recipient is on `*.example.test`, enforced by `EMAIL_RECIPIENT_ALLOWLIST`.

## The cases (`tests/apply.e2e.js`)

| Case | Doc 17 | How it is observed |
| --- | --- | --- |
| C3-01 Home → Careers → Job → Apply → resume → submit → success, with database, storage and mail evidence | 198–207 (QA-P1-E2E-001..004) | REAL |
| C3-02 Rapid double submission (browser), and a same-key race (API) | 108, 211 | HOLD (the request is delayed 1.5 s, then sent unchanged) / REAL |
| C3-03 Network failure: no false success; Try Again reuses the key | 209 | FAULT INJECTION (the browser goes offline) |
| C3-04 Lost response: the retry replays; one Application, no second notification | 106 (and Doc 09 §§121, 200) | FAULT INJECTION (the real 201 is reset before the page sees it) |
| C3-05 Server validation shown in the form | 210 | REAL |
| C3-06 Apply open → the Job closes in the backend → submit → controlled rejection | 96, 208 | REAL (the Job is closed by the provisioning CLI) |
| C3-07 Acknowledgement refused by the mail server: the Application stays accepted | 110 | REAL (the test server refuses one synthetic recipient) |
| C3-08 That refusal recorded as a suppression; the next acknowledgement is suppressed with no SMTP | B7 gate | REAL (operator step by the suppression CLI) |
| C3-09 The backend log holds no candidate data, key, storage key or secret. Every line is scanned, including the two public-access probes; their lines are found by request id: 404, no route matched, path shape only. A synthetic e-mail address is also sent as the slug of Job Detail and of Apply (four refused requests): each line holds the route template only, and the address appears nowhere, raw or encoded | 406 | REAL |

**C3-09, before and after C3 r2.**

- **Before.** The backend access log wrote every request path raw. C3-01's probes of `/<storageKey>` and `/api/v1/<storageKey>` therefore put two storage keys into it. C3-09 excluded those two lines by path.
- **After.** A path that no route matched is logged only by its shape (`backend/src/middleware/requestLogger.js`). C3-09 now scans every line for every forbidden value, with no exclusion. It also checks the two probe lines: one each, 404, `routeMatched: false`, and only the path's shape.

**C3 r3.** A route **pattern** matches before the controller validates `:jobSlug`. So r2 still logged a value in the slug position raw, for example an e-mail address in `GET /api/v1/jobs/<value>`. Matched routes are now logged by their template (`/api/v1/jobs/:jobSlug`, `/api/v1/jobs/:jobSlug/applications`). C3-09 sends such a marker to Job Detail and to Apply, and checks for it.

The earlier run evidence is kept unchanged in the review package.

## Run it (Windows, PowerShell)

**Prerequisites:**
- Node 24;
- `npm ci` already run in `frontend/` and `backend/`;
- a local MongoDB (for example the MongoDB 8 service on `127.0.0.1:27017`).

One-time setup:

```powershell
cd e2e
npm ci
npx playwright install chromium
```

Each run:

```powershell
cd e2e
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test_e2e"
npm run test:e2e
Remove-Item Env:MONGODB_TEST_URI
```

The guards that keep a run's files out of the repository can be checked on their own. This needs no database, browser or server:

```powershell
cd e2e
npm run test:guards
```

**Database guard.** The suite refuses to start unless `MONGODB_TEST_URI` names a database called `valida_test` or `valida_test_<suffix>`. It uses the backend's own guard, `backend/scripts/test-database.mjs`, and it also refuses the database named in `backend/.env`. It then **drops that database** and starts clean.

**Ports.** It uses 4100 for the backend and 4183 for the preview. Change them with `E2E_BACKEND_PORT` and `E2E_FRONTEND_PORT`. The SMTP test server picks a free port.

## Where the output goes

Everything a run creates goes into **one new directory outside the repository**:

- By default: `%TEMP%\valida-e2e\<timestamp>-XXXXXX` on Windows, or `$TMPDIR/valida-e2e/<timestamp>-XXXXXX`.
- Or the path you give in `E2E_RUN_DIR`.

The path is printed when the stack is ready.

Before Playwright, Vite or the setup can write or clean anything, the configuration does three things (`support/runDirectory.js`):

1. **It resolves the location canonically, and refuses it if it is inside the repository.** The parent is resolved with `realpath`, so symlinks and Windows junctions are followed. A name that only starts with dots, such as `<repo>\..qa`, is inside too.
2. **It creates the directory exclusively.** The directory must not exist yet: an earlier run's directory, or any other existing one, is refused and left untouched. Its parent must already exist.
3. **It writes a one-time token into the directory.** Playwright's worker and the setup verify that token, and verify the canonical path again.

Any `playwright` command that loads this configuration creates a new run directory, even `--list`.

The setup then creates each subdirectory exclusively. So `dist/` is always new and empty, and the build never deletes anything: `--emptyOutDir` is not used.

`npm run test:guards` checks these rules. It also starts the real Playwright runner with an existing directory that holds sentinel files in `dist/` and `output/playwright/`, an in-repository `..qa`, and a junction into the repository. The runner stops in its configuration, and the sentinels survive.

Before C3 r2, the run directory was checked only lexically, and an existing one was reused. That let `..qa` and a link into the repository through, and Playwright and `vite build --emptyOutDir` emptied an existing directory's `output/playwright/` and `dist/`. The review package has the before-and-after evidence.

| Path | Contents |
| --- | --- |
| `output/cases/*.json` | Evidence record of each case (storage keys only as one-way references; Idempotency-Keys only as short hashes) |
| `output/screenshots/*.png` | The Doc 18 section 162 states, and others |
| `output/report.json` | Playwright's result |
| `smtp/*.eml`, `*.json` | Every message the SMTP test server received or refused; `rcpt.json`; `auth.json` |
| `logs/` | Set-up steps, build, backend, preview, SMTP and CLI output |
| `private-storage/` | The stored synthetic resumes |
| `run.json` | The run's facts: HEAD, ports, database name, Jobs. It holds no secret |
| `.valida-e2e-run` | The run's one-time token. It is not a secret: it only marks the directory as this run's |

All data is synthetic. Even so, treat the directory as **private review evidence**: never commit it, and delete it when it is no longer needed.

The two per-run secrets, the SMTP test password and the suppression HMAC key, are generated in memory and passed through the environment. They are never written to disk.

## C4 — SEO stack verification (`seo/c4-seo.e2e.js`)

A second suite with its own configuration (`playwright.seo.config.js`), setup (`support/seoGlobalSetup.js`) and test directory (`seo/`). It never runs as part of `npm run test:e2e`, and the C3 cases never run inside it. It reuses the run-directory, process and loopback helpers above unchanged.

**The stack:**
- the **C4 document server**, `frontend/server/serve.mjs`, serving two production builds of the same commit:
  - **indexed**: `VITE_ALLOW_INDEXING=true`, `VITE_PUBLIC_SITE_URL=https://cybervalida.com` — the approved canonical origin ([OD-2026-11-09-01](../docs/review/OWNER_DECISION_2026-11-09-01_C4_RECRUITMENT_ORIGIN_TITLES_SOCIAL.md)), served only on 127.0.0.1; the build refuses any other origin;
  - **review**: no SEO variables;
- the real backend, with no mail provider and acknowledgements off;
- a disposable MongoDB;
- the synthetic C4 Jobs in `fixtures/seo-jobs/`, provisioned through the backend CLI.

Everything listens on 127.0.0.1, and the setup checks each listening address. Ports: 4110 for the backend, 4193 for the indexed build, 4194 for the review build. They can be changed with `E2E_SEO_BACKEND_PORT`, `E2E_SEO_INDEXED_PORT` and `E2E_SEO_REVIEW_PORT`. Case C4-11 also uses 4195.

| Case | What is observed |
| --- | --- |
| C4-01 | The initial HTML of every public route: status, title, description, robots, canonical, Open Graph, JobPosting, `X-Robots-Tag`, and the 301 redirects. The raw targets `/\outside.example/A` and `/\/outside.example/A`, sent byte for byte, get the 404 page and no Location; the positive control `/About?region=CA&utm_source=qa` gets a 301 on the same origin, keeping its query |
| C4-02 | `/sitemap.xml` and `/robots.txt` against the live open Jobs; every asset the page loads is reachable and not disallowed |
| C4-03 | Two open Jobs, direct load, in a browser set to America/Vancouver. The initial HTML equals the settled head. Date Posted and Applications Close equal the API's instants in UTC, and the Job without a deadline has no Applications Close row. No JobPosting: the remote one lists no eligible remote-work countries, the hybrid one has no structured workplace |
| C4-04 | Refresh: the same status and metadata |
| C4-05 | Client navigation Home → Careers → Job → Careers → Back → Apply. The canonical follows each route; no step carries a JobPosting; Apply is noindex |
| C4-06 | Retained closed Job: closed state, no Apply action, `noindex, follow`, no JobPosting |
| C4-07 | Unknown route, unknown, Draft and Archived Job: a real 404 with the branded page (Doc 17 §214) |
| C4-08 | Open hybrid Job: indexable and canonical, with the JobPosting withheld |
| C4-09 | The backend CLI closes, then archives, a Job. Status, robots, canonical, the visible deadline and the sitemap change at once |
| C4-10 | Review build: `noindex, nofollow` everywhere; no canonical, Open Graph, JobPosting or sitemap |
| C4-11 | Jobs API unreachable (simulated): Job routes and the sitemap answer 503, never 404 |
| C4-12 | **Social card, revision 2** ([OD-2026-11-09-02](../docs/review/OWNER_DECISION_2026-11-09-02_C4_SOCIAL_CARD_AND_ELIGIBLE_WORK_COUNTRIES.md), [OD-2026-11-09-03](../docs/review/OWNER_DECISION_2026-11-09-03_C4_CARD_REVISION_SHARING_COPY_SEQ1.md)): `og:image` (absolute, on the approved origin), its width, height and the approved alt text on every indexable page in the initial HTML and after client navigation; none on noindex pages or in the review build. The route-specific `og:description` (Home: the social-sharing description; elsewhere the route's search description), with Home's search description unchanged. The image fetched from the build: 200, `image/png`, the revision 2 SHA-256, 1200 × 630; the revision 1 path answers 404. One rendered sharing preview at ordinary size (image 500 × 262), whose displayed snippet is checked against the page's metadata |
| C4-13 | **Two explicit eligible countries** (synthetic NZ, DE): the stored codes, the API, the visible "Eligible Remote-Work Countries" row and the JobPosting (`TELECOMMUTE`, `applicantLocationRequirements`) agree, in the initial HTML and the rendered page; changing the regional selector changes none of them |
| C4-14 | The otherwise identical Job **without** the key: readable, no row, no country named, no JobPosting, on direct load and after client navigation from the eligible Job (whose markup is removed on the way and back again on Back) |
| C4-15 | A **legacy** record inserted without the field loads with no claim. Through the CLI: an unrelated update keeps the countries; an invalid code is refused and the stored record is unchanged; `[]` clears the row and the markup |
| C4-16 | A **retained closed** Job with a list: closed state, no Apply action, no JobPosting, `noindex`, not in the sitemap |

Run (PowerShell), after the one-time setup above:

```powershell
cd e2e
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test_seo"
npm run test:e2e:seo
Remove-Item Env:MONGODB_TEST_URI
```

**Output.** The run directory holds:
- `output/cases/C4-*.json`;
- `output/screenshots/`;
- `logs/`: the set-up steps, both builds, the backend and both document servers;
- `dist/` and `dist-review/`.

**Not proven here.** The production host: HTTPS, the apex/www redirect, compression, the CDN, real crawlers and social previews, Search Console, and the Rich Results Test. These are C6 (see `docs/seo/C4_SEO_IMPLEMENTATION.md` §6).

## C5 — integrated site quality (`c5/`)

A third suite with its own configuration (`playwright.c5.config.js`), setup (`support/c5GlobalSetup.js`) and test directory (`c5/`), for Doc 18 §§168–172: layout, states, accessibility and lab performance of the whole public site. It reuses the run-directory, process and loopback helpers above unchanged, and runs neither inside nor alongside the C3 and C4 suites. The method, the findings and the manual checklist are in [`docs/qa/C5_INTEGRATED_SITE_QUALITY.md`](../docs/qa/C5_INTEGRATED_SITE_QUALITY.md).

**The stack:**
- one **production build** (`VITE_ALLOW_INDEXING=true`, `VITE_PUBLIC_SITE_URL=https://cybervalida.com`), served by the C4 document server on 127.0.0.1:4203;
- a **lab-only compression proxy** (`support/c5LabCompression.mjs`) in front of it, on 127.0.0.1:4204. The document server serves files uncompressed, and compression is the production host's job (C6). The proxy exists only so that throttled lab measurements are not charged for bytes a host would compress. It is not the host and proves nothing about it;
- the real backend on 127.0.0.1:4120: no mail transport at all, so nothing is sent, not even locally, and acknowledgements are off;
- a disposable MongoDB;
- the synthetic Jobs in `fixtures/c5-jobs/` (a long-title open Job with long content and screening questions, an open hybrid Job, a retained closed Job). The first case records the **empty** Careers state against the real, empty API, then provisions them through the backend CLI.

The lab proxy serves immutable assets **precompressed** (compressed once, before any measurement), as a host does. `C5_LAB_COMPRESSION=on-demand` restores per-request compression, which costs about 0.67 s of proxy CPU per request for the main script. `C5_EXPERIMENT_PRELOAD_JOB_API=1` is an experiment only: the proxy adds a Job API preload to Job and Apply documents, to measure a proposed change the product does not make.

Ports can be changed with `E2E_C5_BACKEND_PORT`, `E2E_C5_SITE_PORT` and `E2E_C5_LAB_PORT`.

| File | Cases |
| --- | --- |
| `c5-01-layout-states.e2e.js` | C5-01 empty Careers; C5-02 every public route at 360, 390, 430, 768, 1024, 1440 and 1920 CSS px (full-page screenshots; overflow, clipping, WCAG 2.5.8 targets, obscured controls); C5-03 every 10 px from 320 to 1920, each breakpoint −1/0, phone landscape; C5-04 Careers and Job Detail loading (HOLD), error (FAULT) and recovery; C5-05 Careers → Job Detail → Apply with validation, long values, a server refusal, submitting, a network failure, recovery and success |
| `c5-02-accessibility.e2e.js` | C5-06 axe-core on every route, with WCAG 2.5.3 label in name gated (OD-2026-11-10-01) and the computed names checked; C5-07 structure; C5-08 keyboard Tab and Shift+Tab with focus visibility and the sticky header; C5-09 mobile menu by keyboard; C5-10 keyboard-only Apply, the file chooser included; C5-11 accessibility-tree snapshots, live regions, error associations; C5-12 200% text and page zoom; C5-13 reflow at 320 CSS px; C5-14 reduced motion; C5-15 non-text contrast; C5-16 forced colours |
| `c5-03-performance.e2e.js` | C5-17 lab LCP, CLS, INP, FCP, TTFB, long tasks and transfer by type: mobile (Slow 4G, 4× CPU) and desktop, cold cache, 5 runs per page, plus a repeat view; C5-18 the same mobile runs against the uncompressed document server, for reference |
| `c5-05-continuity.e2e.js` | C5-21 keyboard continuity: where focus lands and the next Tab stop after Try Again recovery (Careers, Job Detail) and after Apply failure, retry and success; no duplicate announcement; the footer unpainted only while content is pending, and back after success, unavailable and error |
| `c5-04-lighthouse.e2e.js` | C5-19 Lighthouse, mobile and desktop presets, 3 runs per page. Runs only when `C5_LIGHTHOUSE_CLI` names a Lighthouse CLI installed **outside** the repository; skipped otherwise, saying so |

Each record says how it was observed: REAL, HOLD (a real request held, then sent unchanged), FAULT (a request made to fail, then recovered for real), EMULATED (a browser emulation, not a device, assistive technology or user setting) or LAB.

Run (PowerShell), after the one-time setup above:

```powershell
cd e2e
$env:MONGODB_TEST_URI = "mongodb://127.0.0.1:27017/valida_test_c5"
# Optional: Lighthouse, installed outside the repository.
# npm install --prefix C:\Tools\lighthouse lighthouse@13.6.0
# $env:C5_LIGHTHOUSE_CLI = "C:\Tools\lighthouse\node_modules\lighthouse\cli\index.js"
npm run test:e2e:c5
Remove-Item Env:MONGODB_TEST_URI
```

`C5_PERF_RUNS` (default 5), `C5_PERF_REFERENCE_RUNS` (3) and `C5_LIGHTHOUSE_RUNS` (3) change the run counts. Lab numbers depend on the machine: compare runs made on the same machine.

**Lab-metric aggregation** (`c5/perfStats.js`):
- each metric is aggregated from all of its samples, in any order;
- each metric reports its valid and missing counts;
- a verdict is `PASS` only when every expected sample is valid and the p75 meets the target. A missing or short sample set is `INSUFFICIENT`, which fails the case;
- a page with no scripted interaction has INP `NOT_APPLICABLE`.

`npm run test:c5:stats` runs its unit tests (no stack needed). `node c5/perfRecompute.mjs <C5-17.json> <out.json>` recomputes a recorded case's summaries from its raw runs.

**Output.** The run directory holds:
- `output/cases/C5-*.json`;
- `output/screenshots/`, `output/aria/` (accessibility-tree snapshots) and `output/lighthouse/` (full reports);
- `logs/`;
- `dist/`.

**Not proven here.** Other browsers and real devices, real screen readers, OS text scaling, field Core Web Vitals, and the production host's compression, caching and TLS. These are in the manual checklist and in C6/C7.
