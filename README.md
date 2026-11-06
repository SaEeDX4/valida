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
| Milestone | C3 — Real Apply Integration: **submitted for review, not accepted** (branch `c3-work`, local only) |
| Frontend  | Release A public frontend, connected to the real backend: Careers (`/careers`) reads `GET /api/v1/jobs` (C1), Job Detail (`/careers/<slug>`) reads `GET /api/v1/jobs/<slug>` (C2), and Apply (`/careers/<slug>/apply`) submits to `POST /api/v1/jobs/<slug>/applications` (C3, under review). |
| Backend   | Release B: the Express foundation, MongoDB models and indexes, the public Jobs API and Job provisioning, private resume storage and validation, the Apply endpoint, notifications with the SMTP adapter for the selected provider (Bluehost Professional Email / Titan), and the B7 security, failure and QA gate with recipient suppression. Production candidate acknowledgements stay **refused at start-up** (`ACKNOWLEDGEMENT_BLOCKED_BY_G_SUP`). Live Titan evidence is in [`docs/qa/B6_EVIDENCE_ADDENDUM.md`](docs/qa/B6_EVIDENCE_ADDENDUM.md). The owner decided on 2026-10-25 to keep Titan and make a monthly offline email backup ([`docs/review/OWNER_DECISION_2026-10-25_EMAIL_BACKUP.md`](docs/review/OWNER_DECISION_2026-10-25_EMAIL_BACKUP.md)); the backup is proposed, not yet set up. Automated messages have no Sent copy; a copy design is proposed ([`docs/architecture/AUTOMATED_MESSAGE_COPY_DESIGN.md`](docs/architecture/AUTOMATED_MESSAGE_COPY_DESIGN.md), not implemented). See [`backend/README.md`](backend/README.md). |
| Database  | MongoDB (B2). The real initial role is provisioned only as a DRAFT — its content is AWAITING INPUT. |

Four states are kept apart below, and one does not imply another:

- **Accepted** — the owner's acceptance of the milestone at the named commit.
- **Branch-published** — the milestone branch is on GitHub (`SaEeDX4/valida`). Remote branch heads were last observed on **2026-11-06, 23:06–23:08 UTC** (read-only).
- **Merged** — contained in `main`. `main` is at `ec15048` (B5).
- **Deployed** — running in production. Nothing is deployed; deployment is C6.

| Milestone | Accepted | Branch-published | Merged into `main` | Deployed |
| --- | --- | --- | --- | --- |
| Release A (A1–A6) — public frontend foundation | **Approved** | yes — `a6-work` | yes | no |
| B1 — Backend runtime & configuration | **Verified and merged** | yes — `b1-work` | yes | no |
| B2 — MongoDB models & indexes | **Verified and merged** | yes — `b2-work` | yes | no |
| B3 — Job provisioning & public Jobs API | **Verified and GPT-approved** (Windows Node v24.21.0; 917 offline tests + 82 real-MongoDB tests; audit: 0 vulnerabilities) | yes — `b3-work` | yes | no |
| B4 — Private resume storage & validation | **Approved and merged** (final-r3; Windows Node 24: 1504 offline tests passed + 5 skipped, B4 acceptance 580 passed + 5 skipped, 89 real-MongoDB tests; audit: 0 vulnerabilities) | yes — `b4-work` | yes | no |
| B5 — Application submission workflow | **Approved and merged** (final-r2; Windows Node 24.21.0: 1743 offline tests passed + 5 skipped, B5 acceptance 232/232, 110 real-MongoDB tests; audit: 0 vulnerabilities) | yes (`b5-work` = `main`) | yes — `ec15048` | no |
| B6 — Notification integration | **Owner-accepted** — B6 r12, OD-2026-11-04-01, at `6173eea` ([`docs/review/B6_ACCEPTANCE_ADDENDUM_2026-11-04.md`](docs/review/B6_ACCEPTANCE_ADDENDUM_2026-11-04.md), with its four accepted NOT TESTED limitations) | yes — `b6-work` at `2b00a62` (the acceptance addendum on top of `6173eea`) | no | no |
| B7 — Backend security, failure & QA gate | **Owner-accepted** — at `eabd604`, the `b7-work` head that C1 was built on (the owner's C3 instruction preserves "accepted B7"; the suppression design was approved in [OD-2026-11-04-02](docs/review/OWNER_DECISION_2026-11-04-02_B7_SUPPRESSION_APPROVAL.md); no separate acceptance record is in this repository) | yes — `b7-work` at `eabd604` | no | no |
| C1 — Frontend ↔ Jobs API integration | **Owner-accepted** at `24b92a7` (Careers against the real API, disposable database, synthetic Jobs; one fixture-gate correction) | no — `c1-work` is local only | no | no |
| C2 — Real Job Detail | **Owner-accepted** at `46818bb`, including the focus correction (Job Detail against the real API, disposable database, synthetic Jobs: open, closed, unknown/draft/archived, direct URL, refresh; one route-change scroll correction) | no — `c2-work` is local only | no | no |
| C3 — Real Apply Integration | **Submitted for review — not accepted** (the critical browser E2E suite against the real stack: [`e2e/README.md`](e2e/README.md)) | no — `c3-work` is local only | no | no |
| Phase 1 | **Not verified** — only after Release C (C7) | — | — | — |

The C1, C2 and C3 commits descend from `eabd604`, so `c3-work` holds the
whole accepted line B7 → C1 → C2 followed by C3. None of B6, B7, C1, C2 or C3
is in `main`.

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
[`backend/README.md`](backend/README.md). Playwright E2E arrives in Release C.

---

## Verifying the current build

Run every check. Each should complete without an error.

### A6 — frontend quality baseline

```powershell
cd frontend
npm ci
npm run verify:quality   # expect: ALL QUALITY BUDGET CHECKS PASSED,
                         #         Test Files 38 passed, Tests 956 passed
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
merged, and B6 and B7 are accepted and branch-published, not merged; see
[`backend/README.md`](backend/README.md). C1 and C2 are accepted, and C3 is
under review; see **Current state**.)

| Capability                                                                                                           | Milestone |
| -------------------------------------------------------------------------------------------------------------------- | --------- |
| Monthly offline email backup (owner decision 2026-10-25; setup not yet verified); automated-message Sent-copy preservation (design proposed, not implemented); bounce processing beyond the manual procedure (the manual bounce procedures are approved: OD-2026-11-03-01) | Backup: owner's operational task; copy: gate G-COPY proposed for C6, awaiting the owner's decision; automated bounce processing: no decision (the manual procedure is approved) |
| Production deployment, domain, HTTPS                                                                                 | C         |
| Production SEO: canonical host, sitemap, robots.txt, JobPosting data (need the production domain and real Jobs)      | C         |

Awaiting input rather than scheduled: the production API origin, real approved
Job content and per-market compensation, a corporate contact mechanism, a
smaller approved transparent logo export, the email-backup setup inputs (Outlook
version, `shervin@` access, encryption, second device), the production private-storage provider (selected at
deployment, C6) and a malware-scanning provider (needed before resume review,
E4).

---

## Documentation authority

Implementation is governed by the Valida Master Prompt Version 3.0 and canonical
Documents 00-18, all BASELINED. Where this README and a canonical document
disagree, the canonical document wins.
