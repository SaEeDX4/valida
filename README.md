# Valida

Public website and platform for **Valida** (legal entity: Valida MB).

One repository. One React frontend. One Express backend. One MongoDB database
(from Milestone B2). Built milestone-by-milestone according to
`18_IMPLEMENTATION_ROADMAP.md`.

---

## Current state

| Item      | Status                                                               |
| --------- | -------------------------------------------------------------------- |
| Release   | C — Production Public Launch (Release A approved; Release B complete: B1–B5 approved and merged, B6 and B7 owner-accepted) |
| Milestone | **C6 — Production Infrastructure & Deployment: tasks C6-T1 to C6-T5 only**, on the local branch `c6-work` (not on GitHub; the milestone is **not accepted**). C6-T1, a recruitment mode in the API that is closed unless configured, is owner-accepted as a task at `cdccfae` ([decision record](docs/review/OWNER_DECISION_2026-11-15-01_C6_T1_RECRUITMENT_MODE.md)). C6-T2, visitor-aware Job documents (the document server reads Jobs on the visitor's behalf; recruitment-dependent pages are `private, no-store`), is owner-accepted as a task at `faf4571` ([record](docs/review/C6_T2_VISITOR_AWARE_DOCUMENTS.md); [acceptance](docs/review/OWNER_RECORD_2026-11-16_C6_T2_ACCEPTANCE_AND_C6_T3_AUTHORISATION.md)). C6-T3, whole-site private Review access (`SITE_ACCESS`), is owner-accepted at `9fa42b0` ([record](docs/review/C6_T3_PRIVATE_REVIEW_ACCESS.md); [acceptance](docs/review/OWNER_RECORD_2026-11-16_C6_T3_ACCEPTANCE_AND_C6_T4_AUTHORISATION.md)). C6-T4, S3-compatible private résumé storage (`RESUME_STORAGE_DRIVER=s3`), is owner-accepted at `16119a7` with corrections 1 and 2 ([record](docs/review/C6_T4_S3_PRIVATE_STORAGE.md); [acceptance](docs/review/OWNER_RECORD_2026-11-17_C6_T4_ACCEPTANCE_AND_C6_T5_AUTHORISATION.md)); real-provider versioning and version-specific deletion stay open for hosting. C6-T5, the document server's enforced Content-Security-Policy and security headers and the `X-Valida-Release` header on both services (D-6), is owner-accepted at `2a1ec6f` ([record](docs/review/C6_T5_CSP_SECURITY_HEADERS_AND_RELEASE_IDENTITY.md); [acceptance](docs/review/OWNER_RECORD_2026-11-17-02_C6_T5_ACCEPTANCE_D4A_D9_AND_C6_T6_AUTHORISATION.md)). C6-T6 — Sentry error monitoring (D-4a), the CI and backup workflow files (not activated), the read-only review-host checker, runbooks, and the hourly résumé copy with its manifest, deletion log and restore gate (D-9) — is implemented locally and awaiting review ([record](docs/review/C6_T6_MONITORING_CI_CHECKER_BACKUP.md); runbooks in [`docs/operations/`](docs/operations/)); [`backend/README.md`](backend/README.md), "Recruitment access" and "Delegated Jobs reads". No provider, deployment, DNS or HSTS; no workflow has run on GitHub. C5 — Integrated Site Quality is **owner-accepted on 2026-11-15 at `a6a0fe1`** ([record](docs/review/OWNER_RECORD_2026-11-15_C5_ACCEPTANCE.md)); since 2026-11-15 it is on GitHub as `c5-work` and in `main`, both at the acceptance-record commit `e2c7ce7`, by ordinary fast-forward pushes of that exact commit. Method, findings and evidence: [`docs/qa/C5_INTEGRATED_SITE_QUALITY.md`](docs/qa/C5_INTEGRATED_SITE_QUALITY.md). Open after acceptance: desktop and iOS Safari (on the C6 review host, before C7 closes), field performance, host delivery. C4 is owner-accepted at `2193433`, with Social Card Version 2 ([record](docs/review/OWNER_RECORD_2026-11-10_C4_ACCEPTANCE.md)). |
| Frontend  | Release A public frontend, connected to the real backend: Careers (`/careers`) reads `GET /api/v1/jobs` (C1), Job Detail (`/careers/<slug>`) reads `GET /api/v1/jobs/<slug>` (C2), and Apply (`/careers/<slug>/apply`) submits to `POST /api/v1/jobs/<slug>/applications` (C3). C4 (accepted) adds the SEO layer: canonical URLs, Open Graph, JobPosting, a sitemap and robots.txt, a review-build `noindex, nofollow` default, and a reference document server that sends each public route with its real HTTP status and its metadata in the initial HTML ([`docs/seo/C4_SEO_IMPLEMENTATION.md`](docs/seo/C4_SEO_IMPLEMENTATION.md)). |
| Backend   | Release B: the Express foundation, MongoDB models and indexes, the public Jobs API and Job provisioning, private resume storage and validation, the Apply endpoint, notifications with the SMTP adapter for the selected provider (Bluehost Professional Email / Titan), and the B7 security, failure and QA gate with recipient suppression. Production candidate acknowledgements stay **refused at start-up** (`ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP`). Live Titan evidence is in [`docs/qa/B6_EVIDENCE_ADDENDUM.md`](docs/qa/B6_EVIDENCE_ADDENDUM.md). The owner decided on 2026-10-25 to keep Titan and make a monthly offline email backup ([`docs/review/OWNER_DECISION_2026-10-25_EMAIL_BACKUP.md`](docs/review/OWNER_DECISION_2026-10-25_EMAIL_BACKUP.md)); the backup is proposed, not yet set up. Automated messages have no Sent copy; a copy design is proposed ([`docs/architecture/AUTOMATED_MESSAGE_COPY_DESIGN.md`](docs/architecture/AUTOMATED_MESSAGE_COPY_DESIGN.md), not implemented). See [`backend/README.md`](backend/README.md). |
| Database  | MongoDB (B2). The real initial role is provisioned only as a DRAFT — its content is AWAITING INPUT. |

Four states are kept apart below, and one does not imply another:

- **Accepted** — the owner's acceptance of the milestone at the named commit.
- **Branch-published** — the milestone branch is on GitHub (`SaEeDX4/valida`). Remote branch heads as observed on **2026-11-10 at 22:38 UTC** (read-only `git ls-remote`): `main` `389c421`, `c4-work` `389c421`, `c3-work` `f07ea35`, `b7-work` `eabd604`, `b6-work` `2b00a62`, `b5-work` `ec15048`; no `c1-work`, `c2-work` or `c5-work`; no tags. An observation is true for its date only.
- **Merged** — contained in `main`. On 2026-11-10 `main` was fast-forwarded from `ec15048` (B5) to the **consolidation checkpoint `389c421a72fb090dc2c08c8251b664bada73d9a0`** (11:00:40 UTC, on the owner's authorisation, verified by a fresh fetch). `main` therefore includes B6, B7, C1, C2, C3 and C4, the C4 acceptance record and the checkpoint. `c4-work` was created at the same commit (10:29:32 UTC). Publication on GitHub is not deployment.
- **Deployed** — running in production. Nothing is deployed; deployment is C6.

| Milestone | Accepted | Branch-published | Merged into `main` | Deployed |
| --- | --- | --- | --- | --- |
| Release A (A1–A6) — public frontend foundation | **Approved** | yes — `a6-work` | yes | no |
| B1 — Backend runtime & configuration | **Verified and merged** | yes — `b1-work` | yes | no |
| B2 — MongoDB models & indexes | **Verified and merged** | yes — `b2-work` | yes | no |
| B3 — Job provisioning & public Jobs API | **Verified and GPT-approved** (Windows Node v24.21.0; 917 offline tests + 82 real-MongoDB tests; audit: 0 vulnerabilities) | yes — `b3-work` | yes | no |
| B4 — Private resume storage & validation | **Approved and merged** (final-r3; Windows Node 24: 1504 offline tests passed + 5 skipped, B4 acceptance 580 passed + 5 skipped, 89 real-MongoDB tests; audit: 0 vulnerabilities) | yes — `b4-work` | yes | no |
| B5 — Application submission workflow | **Approved and merged** (final-r2; Windows Node 24.21.0: 1743 offline tests passed + 5 skipped, B5 acceptance 232/232, 110 real-MongoDB tests; audit: 0 vulnerabilities) | yes (`b5-work` = `main`) | yes — `ec15048` | no |
| B6 — Notification integration | **Owner-accepted** — B6 r12, OD-2026-11-04-01, at `6173eea` ([`docs/review/B6_ACCEPTANCE_ADDENDUM_2026-11-04.md`](docs/review/B6_ACCEPTANCE_ADDENDUM_2026-11-04.md), with its four accepted NOT TESTED limitations) | yes — `b6-work` at `2b00a62` (the acceptance addendum on top of `6173eea`) | yes — in `389c421` | no |
| B7 — Backend security, failure & QA gate | **Owner-accepted** at `eabd604`, the `b7-work` head that C1 was built on (stated explicitly in the owner's C4 instruction: "B7 — accepted and published: eabd604"; the suppression design was approved in [OD-2026-11-04-02](docs/review/OWNER_DECISION_2026-11-04-02_B7_SUPPRESSION_APPROVAL.md)) | yes — `b7-work` at `eabd604` | yes — in `389c421` | no |
| C1 — Frontend ↔ Jobs API integration | **Owner-accepted** at `24b92a7` (Careers against the real API, disposable database, synthetic Jobs; one fixture-gate correction) | yes — inside `c3-work` (no separate `c1-work` branch) | yes — in `389c421` | no |
| C2 — Real Job Detail | **Owner-accepted** at `46818bb`, including the focus correction (Job Detail against the real API, disposable database, synthetic Jobs: open, closed, unknown/draft/archived, direct URL, refresh; one route-change scroll correction) | yes — inside `c3-work` (no separate `c2-work` branch) | yes — in `389c421` | no |
| C3 — Real Apply Integration | **Owner-accepted** at `f07ea35` (r3; recorded in the owner's C4 instruction, with the accepted bundle's SHA-256 `0b7293bd…369b`). The critical browser E2E suite against the real stack: [`e2e/README.md`](e2e/README.md) | **yes — `c3-work` at `f07ea35`**, pushed 2026-11-07 08:19 UTC on the owner's authorisation and verified by a fresh fetch ([`docs/review/OWNER_RECORD_2026-11-07_C3_PUBLICATION.md`](docs/review/OWNER_RECORD_2026-11-07_C3_PUBLICATION.md)) | yes — in `389c421` | no |
| C4 — SEO / Privacy / Legal production integration | **Owner-accepted** at `2193433`, with Social Card Version 2 (SHA-256 `c86554a2…c2a5`) and its revised preview ([`docs/review/OWNER_RECORD_2026-11-10_C4_ACCEPTANCE.md`](docs/review/OWNER_RECORD_2026-11-10_C4_ACCEPTANCE.md)). It includes the review corrections: origin-safe redirects, the approved date labels ([OD-2026-11-07-01](docs/review/OWNER_DECISION_2026-11-07-01_C4_DATE_LABELS.md)), and no inferred applicant eligibility. Then [OD-2026-11-09-01](docs/review/OWNER_DECISION_2026-11-09-01_C4_RECRUITMENT_ORIGIN_TITLES_SOCIAL.md): the canonical origin `https://cybervalida.com` (pinned for indexable builds), the Document 06 titles, and the first vacancy's work countries OPEN. Then [OD-2026-11-09-02](docs/review/OWNER_DECISION_2026-11-09-02_C4_SOCIAL_CARD_AND_ELIGIBLE_WORK_COUNTRIES.md): the approved social card in Open Graph (final visual sign-off pending), and the optional per-Job `eligibleWorkCountries` field, from provisioning to the API, the Job Detail page and the remote JobPosting ([contract](docs/recruitment/ELIGIBLE_WORK_COUNTRIES_CONTRACT.md)). Then [OD-2026-11-09-03](docs/review/OWNER_DECISION_2026-11-09-03_C4_CARD_REVISION_SHARING_COPY_SEQ1.md): the eligibility implementation (`86e1459`) and the label "Eligible Remote-Work Countries" approved; social card revision 2 with the approved sharing copy; SEQ-1 closed — the first genuine vacancy may be published only after the Release E launch gates, including E6. Local implementation and stack verification: [`docs/seo/C4_SEO_IMPLEMENTATION.md`](docs/seo/C4_SEO_IMPLEMENTATION.md), [`docs/privacy/C4_PRIVACY_LEGAL_CHECK.md`](docs/privacy/C4_PRIVACY_LEGAL_CHECK.md) | yes — `c4-work` at `389c421` (created 2026-11-10 10:29:32 UTC) | yes — in `389c421` | no |
| C5 — Integrated site quality | **Owner-accepted** on 2026-11-15 at `a6a0fe1`, with four recorded decisions ([`docs/review/OWNER_RECORD_2026-11-15_C5_ACCEPTANCE.md`](docs/review/OWNER_RECORD_2026-11-15_C5_ACCEPTANCE.md)); evidence and scope in [`docs/qa/C5_INTEGRATED_SITE_QUALITY.md`](docs/qa/C5_INTEGRATED_SITE_QUALITY.md). Desktop and iOS Safari, field performance and host delivery stay open | yes — `c5-work` at `e2c7ce7` (2026-11-15) | yes — `main` at `e2c7ce7` (2026-11-15) | no |
| C6 — Production infrastructure & deployment | **Not accepted.** Task **C6-T1** (the API recruitment mode, [OD-2026-11-15-01](docs/review/OWNER_DECISION_2026-11-15-01_C6_T1_RECRUITMENT_MODE.md)) is owner-accepted at `cdccfae`; task **C6-T2** ([visitor-aware Job documents](docs/review/C6_T2_VISITOR_AWARE_DOCUMENTS.md)) is owner-accepted at `faf4571`; task **C6-T3** ([private Review access](docs/review/C6_T3_PRIVATE_REVIEW_ACCESS.md)) is owner-accepted at `9fa42b0`; task **C6-T4** ([S3-compatible private storage](docs/review/C6_T4_S3_PRIVATE_STORAGE.md)) is owner-accepted at `16119a7`; task **C6-T5** ([CSP, security headers, release identity](docs/review/C6_T5_CSP_SECURITY_HEADERS_AND_RELEASE_IDENTITY.md)) is owner-accepted at `2a1ec6f`; task **C6-T6** ([monitoring, CI, checker, backup](docs/review/C6_T6_MONITORING_CI_CHECKER_BACKUP.md)) is implemented and tested locally, awaiting review | no — `c6-work` is local only | no | no |
| Phase 1 | **Not verified** — only after Release C (C7) | — | — | — |

The accepted line is one unbroken history: B6 `2b00a62` → B7 `eabd604` → C1
`24b92a7` → C2 `46818bb` → C3 `f07ea35` → C4 `2193433` → the C4 acceptance
record `081e666` → the consolidation checkpoint `389c421`. Since 2026-11-10
all of it is in `main` and in `c4-work`, by ordinary fast-forward pushes of
that exact commit: no rebase, squash, merge commit or force. The earlier
milestone branches and records are kept as they were. `c5-work` starts at
`389c421`; since 2026-11-15 it is on GitHub and `main` is at its head,
`e2c7ce7`, by the same kind of push. `c6-work` starts at `e2c7ce7` and exists
only locally. Nothing is deployed: deployment is C6.

### Repository history and publication (standing requirement)

- Accepted commits are never rewritten: no rebase, amend, squash or
  force-push of a commit the owner has accepted, on any branch.
- New work starts from the accepted commit and descends from it, so the
  accepted history stays an unchanged prefix of the next milestone's branch.
- A milestone branch reaches GitHub only on the owner's authorisation, by a
  normal (fast-forward) push of that branch.
- Merging into `main` and deploying are separate owner decisions; neither
  follows from acceptance or publication.
- Unrelated local work, including the owner's working copy, is preserved and
  never committed or published as part of a milestone.
- Evidence that is not published stays recoverable in the private review
  package (bundle and evidence archive, with SHA-256).
- Credentials, `.env` files, private evidence, logs, database files, build
  output, bundles and temporary artifacts are never committed or published.
- Historical review packages and evidence records are kept unchanged; a later
  status is recorded in a new document or in this table.

The public frontend (Home, About, Privacy, Legal, Careers, Job Detail, Apply
and the 404) calls a real API boundary. Careers lists what the real Jobs API
returns (C1): the open Jobs, the empty state when there are none, and the error
state when the request fails — never invented roles. Job Detail shows the real
Job or its closed or unavailable state (C2). Apply shows success only after the
backend has accepted the Application (C3). Controlled development fixtures exist
for UI review only; they cannot be activated in a production build.

The browser, device and assistive-technology checklist is
[`docs/A6_WINDOWS_QA_MATRIX.md`](docs/A6_WINDOWS_QA_MATRIX.md). What is not yet
built is listed under **Not yet built** below, and what Release A built under
**Built in Release A**.

---

## Prerequisites

| Tool    | Required version            | Check with      |
| ------- | --------------------------- | --------------- |
| Node.js | 24.x (Active LTS "Krypton") | `node -v`       |
| npm     | Ships with Node 24          | `npm -v`        |
| Git     | Any recent version          | `git --version` |

Node 24 is the current Active LTS (LTS since 2025-10-28, end of life
2028-04-30). It is declared in `.nvmrc` and in the `engines` field of both
`package.json` files.

If `node -v` does not report `v24.x.x`, install Node 24 LTS from
<https://nodejs.org> before continuing. Running on a different major version
may still work but is not the supported runtime.

---

## Repository structure

```
valida/
├── frontend/          React + Vite public application
│   ├── scripts/            check-quality-budgets.mjs (A6 budget gate)
│   ├── src/
│   │   ├── app/            App root (+ retained A2 design-system preview)
│   │   ├── components/
│   │   │   ├── content/    Prose (Privacy / Legal reading layout)
│   │   │   ├── graphics/   SecurityField signature visual
│   │   │   ├── layout/     Header, Footer, SkipLink, Container, Section
│   │   │   ├── seo/        PageMeta (title, description, robots)
│   │   │   └── ui/         Button, Field, Alert, Surface, Icon, ...
│   │   ├── config/         browser-safe env (VITE_* only)
│   │   ├── dev/            DEV-only fixtures — never in a production build
│   │   ├── features/
│   │   │   ├── jobs/       Jobs API, regional presentation, JobRow, selector
│   │   │   └── applications/  Applications API, validation, resume, submission
│   │   ├── hooks/          usePrefersReducedMotion
│   │   ├── layouts/        PublicLayout (every route except Apply), ApplyLayout (Apply)
│   │   ├── pages/          Home, About, Careers, Job Detail, Apply, Privacy, Legal, 404
│   │   ├── routes/         router, paths, single route-change focus handler
│   │   ├── services/       apiClient (the only fetch), service registry
│   │   ├── styles/         tokens, base, typography, utilities
│   │   ├── test/           Vitest setup, axe helper, A6 quality suites
│   │   └── main.jsx
│   ├── vitest.config.js
│   ├── .env.example
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
│
├── backend/           Node.js + Express API
│   ├── src/
│   │   ├── app.js     builds the Express app (no listening socket)
│   │   └── server.js  starts the HTTP server
│   ├── .env.example
│   └── package.json
│
├── docs/              repository documentation, A6 Windows QA matrix
│   ├── qa/            evidence records (B6 evidence addendum; evidence files kept byte-for-byte)
│   ├── review/        milestone decision packages and owner decision records
│   ├── operations/    draft operating procedures (not approved), incl. the Persian monthly email-backup guide
│   └── architecture/  design proposals (email backup, automated-message copy; the superseded archive proposal kept as history)
├── scripts/           controlled operational utilities
├── .github/           reserved for CI configuration
├── .gitignore
├── .nvmrc
└── README.md
```

---

## First-time setup

Open the repository folder in VS Code, then open two terminals
(`Terminal → New Terminal`, then the split icon for a second one).

### 1. Environment files

**Terminal 1 — Backend**

```powershell
cd backend
Copy-Item .env.example .env
```

**Terminal 2 — Frontend**

```powershell
cd frontend
Copy-Item .env.example .env
```

The `.env` files are git-ignored and never committed. The `.env.example` files
are committed and contain safe placeholders only.

**How each `.env` is loaded:**

- **Backend** — the npm scripts pass `--env-file-if-exists=.env` to Node, so
  Node 24 loads `backend/.env` natively. No `dotenv` package is required.
  From B2 the backend needs `MONGODB_URI` and a reachable MongoDB to start —
  see [`backend/README.md`](backend/README.md).
- **Frontend** — Vite loads `frontend/.env` automatically. Only variables
  prefixed `VITE_` are exposed to the browser bundle.

### 2. Install dependencies

**Terminal 1 — Backend**

```powershell
cd backend
npm install
```

**Terminal 2 — Frontend**

```powershell
cd frontend
npm install
```

---

## Daily development

**Terminal 1 — Backend** (from `backend/`)

```powershell
npm run dev
```

Expected output: structured JSON log lines, including `"msg":"database connected"`
and `"msg":"backend listening"` with `"port":4000`. It needs a reachable
MongoDB (see [`backend/README.md`](backend/README.md)).

Stop with `Ctrl+C`; the log ends with `"msg":"shutdown complete"`.

**Terminal 2 — Frontend** (from `frontend/`)

```powershell
npm run dev
```

Expected output includes:

```
Local:   http://localhost:5173/
```

Open <http://localhost:5173> in a browser. You should see the **Valida
website**: the Home page with the header, the hero headline "Secure systems.
Deliberate engineering." and the footer. Every public route is available —
`/about`, `/careers`, `/privacy`, `/legal` — and an unknown URL shows the
branded 404.

There should be no browser console errors and no red text in the terminal.

**Careers reads the real Jobs API (C1).** The frontend calls the backend named
by `VITE_API_BASE_URL` in `frontend/.env` — `http://localhost:4000` in
`.env.example` (copy it first: `Copy-Item .env.example .env` in `frontend/`).
The backend's local default allows the dev and preview origins
(`http://localhost:5173`, `http://localhost:4173`). With the backend running,
Careers shows exactly what `GET /api/v1/jobs` returns:

- **open Jobs** — each row links to `/careers/<slug>`;
- **"No open roles right now."** — the API answered with no open Jobs. This is
  what the real database shows today, because the real role is still a DRAFT;
- **"Open roles are temporarily unavailable."** with **Try Again** — the request
  failed (backend stopped, database unavailable, or no `frontend/.env`, which
  sends the request to the frontend's own origin). A failure is never shown as
  "no open roles".

**Job Detail reads the real Jobs API (C2).** `/careers/<slug>` loads
`GET /api/v1/jobs/<slug>`, also when opened directly or refreshed:

- **an open Job** — its details and role content, with **Apply for This Role**
  linking to `/careers/<slug>/apply`;
- **a closed Job** — the same URL shows **Applications Closed** and offers no
  Apply action;
- **"This role isn't available."** — the API answered 404: the slug is unknown,
  or the Job is a draft or archived. These cases look the same on purpose.

**Apply submits to the real Application API (C3).** `/careers/<slug>/apply`
sends the form and the resume as one multipart request to
`POST /api/v1/jobs/<slug>/applications`. The browser's checks only help the
candidate; the server decides. The page shows success only after the backend
accepts the Application, shows the server's field errors in the form, and keeps
one Idempotency-Key per submission, so **Try Again** after a network failure
cannot create a second Application. If the Job closes while the form is open,
the submission is refused and the page says **"Applications for this role have
closed."** The browser suite that proves this against the real stack is in
[`e2e/README.md`](e2e/README.md).

To review the Careers, Job Detail and Apply states with synthetic data instead,
enable the controlled development fixtures in `frontend/.env`:

```powershell
VITE_ENABLE_A5_FIXTURES=true
```

then restart `npm run dev`. Scenarios are chosen with a `?a5=` query parameter
(for example `/careers?a5=jobs-empty`) and regional views with `?region=`
(for example `/careers?region=DE`). Every value that is not source-established
is visibly prefixed `[DEV FIXTURE]`.

Fixtures only ever run under `npm run dev`. A production build cannot include
them, even with the flag set — also when `NODE_ENV=development` is set in the
shell (C1: the gate checks Vite's mode as well). Set the flag back to `false`
when you finish.

---

## Commands reference

### Frontend (`frontend/`)

| Command              | Purpose                                                 |
| -------------------- | ------------------------------------------------------- |
| `npm install`        | Install dependencies                                    |
| `npm ci`             | Clean reproducible install from `package-lock.json`     |
| `npm run dev`        | Vite dev server on <http://localhost:5173>              |
| `npm run build`      | Production build into `frontend/dist/`                  |
| `npm run preview`    | Serve the built output on <http://localhost:4173>       |
| `npm run serve:documents -- --api-origin http://127.0.0.1:4000` | Serve the built output with the C4 document behaviour (real statuses, metadata in the initial HTML, `/sitemap.xml`, `/robots.txt`; a Job API preload hint on Job Detail and Apply documents, `--no-job-preload` to omit it) on <http://127.0.0.1:4173> |
| `npm test`           | Run the Vitest suite once (components + axe + contrast) |
| `npm run test:watch` | Run the suite in watch mode                             |
| `npm run verify:budgets` | Measure `dist/` against the Doc 16 budgets, fixture isolation and third-party loading (run after `build`) |
| `npm run verify:quality` | Build, run the budget gate, then the full suite — the one-command A6 check |

### Backend (`backend/`)

| Command       | Purpose                                                |
| ------------- | ------------------------------------------------------ |
| `npm install` | Install dependencies                                   |
| `npm ci`      | Clean reproducible install from `package-lock.json`    |
| `npm start`   | Start the server                                       |
| `npm run dev` | Start the server with automatic restart on file change |

The frontend test stack (Vitest, React Testing Library, axe-core — Document 17)
landed in A2. The backend's test, verification (`verify:b1`–`verify:b3`), index
and Job provisioning commands are documented in
[`backend/README.md`](backend/README.md). The browser E2E suites (C3 Apply,
C4 SEO) are in [`e2e/README.md`](e2e/README.md).

---

## Verifying the current build

Run every check. Each should complete without an error.

### A6 — frontend quality baseline

```powershell
cd frontend
npm ci
npm run verify:quality   # expect: ALL QUALITY BUDGET CHECKS PASSED,
                         #         Test Files 42 passed, Tests 1123 passed
```

`verify:budgets` measures the real production build. Legacy `.woff` font
fallbacks are emitted by the font packages but never requested by a
woff2-capable browser, so they are reported as build output and excluded from
transfer.

### A1 foundation — regression checks, still required

These verified the A1 milestone and must keep passing.

```powershell
# 1. Frontend production build
cd frontend
npm run build          # expect "built in ..." and a dist/ folder

# 2. Frontend dev server
npm run dev            # expect http://localhost:5173, then Ctrl+C

# 3. Backend startup (needs MONGODB_URI and a reachable MongoDB since B2)
cd ..\backend
npm start              # expect "backend listening" in the log, then Ctrl+C

# 4. Fresh reproducible install
cd ..\frontend
Remove-Item -Recurse -Force node_modules
npm ci
cd ..\backend
Remove-Item -Recurse -Force node_modules
npm ci
```

Also confirm no `/favicon.ico` 404 appears in the browser console — that was an
A1 correction and must not regress.

---

## Troubleshooting

**`npm run dev` fails with a port error on the frontend**
Port 5173 is in use. Close the other Vite process, or change `server.port` in
`frontend/vite.config.js`.

**Backend prints `port 4000 is already in use`**
Another process holds port 4000. Close it, or set a different `PORT` in
`backend/.env`.

**`npm ci` fails with a lockfile error**
`package-lock.json` and `package.json` are out of sync. Run `npm install` once,
then commit the updated lockfile.

**npm warns `EBADENGINE`**
You are not on Node 24. Install Node 24 LTS and re-run the command.

**Browser shows a blank page**
Open DevTools (`F12`) → Console. Confirm the dev server terminal shows no build
error and that you opened <http://localhost:5173>, not the `dist/` files
directly.

**Careers says "Open roles are temporarily unavailable."**
The Jobs request failed, and the page says so rather than showing invented
roles. Check that the backend is running and reports ready, that MongoDB is
reachable, and that `frontend/.env` sets `VITE_API_BASE_URL` to the backend
(without it the request goes to the frontend's own origin). Then choose
**Try Again**. To review the role states without a backend, use the development
fixtures described under **Daily development**.

**Text on the page is prefixed `[DEV FIXTURE]`**
Development fixtures are enabled. Set `VITE_ENABLE_A5_FIXTURES=false` in
`frontend/.env` and restart `npm run dev`. The prefix marks synthetic values that
are not approved Valida data.

**`npm run verify:budgets` reports `dist/ not found`**
Run `npm run build` first, or use `npm run verify:quality`, which builds before
measuring.

---

## Built in Release A

| Capability                                                                     | Milestone |
| ------------------------------------------------------------------------------ | --------- |
| Repository, Node runtime, frontend and backend scaffolds                        | A1        |
| Design system: tokens, typography, shared UI, Security Field, contrast gate     | A2        |
| Approved brand assets, router, header, footer, skip link, 404                   | A3        |
| Home, About, Privacy and Legal with canonical copy                              | A4        |
| Careers, Job Detail and Apply states, API boundary, regional job presentation   | A5        |
| Route-level accessibility, metadata, keyboard and budget quality gates; ApplyLayout | A6        |

Release A is approved. Its acceptance target was **ready for backend
integration**; it is **not** Phase 1 verification, which follows Releases B
and C.

---

## Not yet built

These are scheduled, not forgotten. Each is owned by a named milestone in
`18_IMPLEMENTATION_ROADMAP.md`. (Release B is built: B1–B5 are approved and
merged, and B6 and B7 are accepted and, since 2026-11-10, in `main`; see
[`backend/README.md`](backend/README.md). C1 to C4 are accepted and in `main`,
and C5 is accepted and in `main`; C6-T1 to C6-T5 are owner-accepted and C6-T6 is awaiting review, all local only; see
**Current state**.)

| Capability                                                                                                           | Milestone |
| -------------------------------------------------------------------------------------------------------------------- | --------- |
| Monthly offline email backup (owner decision 2026-10-25; setup not yet verified); automated-message Sent-copy preservation (design proposed, not implemented); bounce processing beyond the manual procedure (the manual bounce procedures are approved: OD-2026-11-03-01) | Backup: owner's operational task; copy: gate G-COPY proposed for C6, awaiting the owner's decision; automated bounce processing: no decision (the manual procedure is approved) |
| Production deployment, domain, HTTPS                                                                                 | C         |
| Production SEO on the real host: the approved apex `https://cybervalida.com` and its www redirect (OD-2026-11-09-01), HTTPS, compression, the chosen rendering mechanism, real social previews, JobPosting validation with real Jobs (the mechanism itself is built in C4) | C6, D     |

Awaiting input rather than scheduled: the production API origin, real approved
Job content and per-market compensation, a corporate contact mechanism (and a
designated privacy contact), the owner's final visual sign-off of social card
revision 2, the eligible remote-work countries of each real vacancy (OPEN for
the Cybersecurity Specialist Draft; never derived from its location), a
smaller approved transparent logo export, the email-backup setup inputs (Outlook
version, `shervin@` access, encryption, second device), the production private-storage provider (selected at
deployment, C6) and a malware-scanning provider (needed before resume review,
E4).

---

## Documentation authority

Implementation is governed by the Valida Master Prompt Version 3.0 and canonical
Documents 00-18, all BASELINED. Where this README and a canonical document
disagree, the canonical document wins.
