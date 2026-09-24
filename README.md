# Valida

Public website and platform for **Valida** (legal entity: Valida MB).

One repository. One React frontend. One Express backend. One MongoDB database
(from Milestone B2). Built milestone-by-milestone according to
`18_IMPLEMENTATION_ROADMAP.md`.

---

## Current state

| Item      | Status                                                               |
| --------- | -------------------------------------------------------------------- |
| Release   | A — Fast Website Foundation                                          |
| Milestone | A6 — Frontend Quality Baseline                                       |
| Frontend  | Pre-backend public frontend implemented; A6 awaiting Windows/browser QA. |
| Backend   | Starts and stops. No routes, no database, no API yet.                |
| Database  | Not connected (Milestone B2)                                         |

The pre-backend public frontend is implemented: Home, About, Privacy, Legal,
Careers, Job Detail, Apply and the 404, on the shared design system. That is an
implementation statement, not an acceptance one — Release A is accepted only
once A6 passes Windows/browser QA and is GPT-approved.

| Status | |
| --- | --- |
| A6 implementation | **Automated / static verification complete** |
| Windows / browser / NVDA / Lighthouse QA | **Not yet run** — see the QA matrix |
| Acceptance target, after that QA and ChatGPT approval | **Ready for backend integration** |
| Phase 1 | **Not verified** — only after Release B and Release C |

The Careers, Job Detail and Apply surfaces call a real API boundary, but no
backend exists yet, so against a running build Careers correctly shows its error
state rather than inventing roles. Controlled development fixtures exist for UI
review only; they are impossible to activate in a production build.

Browser, device and assistive-technology checks are listed in
[`docs/A6_WINDOWS_QA_MATRIX.md`](docs/A6_WINDOWS_QA_MATRIX.md). Anything not yet
built is listed under **Not yet built** below, and what is built under
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
  If the file is absent the server still starts using its built-in defaults.
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

Expected output:

```
[valida-backend] listening on http://localhost:4000 (NODE_ENV=development, APP_ENV=local)
```

Stop with `Ctrl+C`. Expected output on stop:

```
[valida-backend] SIGINT received, closing server
[valida-backend] server closed
```

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

**Careers shows "Open roles are temporarily unavailable." — this is correct.**
No backend exists yet (Release B), so the real API request fails and Careers
reports the failure honestly instead of inventing roles or claiming there are
none. Job Detail and Apply behave the same way.

To review the Careers, Job Detail and Apply states before the backend exists,
enable the controlled development fixtures in `frontend/.env`:

```powershell
VITE_ENABLE_A5_FIXTURES=true
```

then restart `npm run dev`. Scenarios are chosen with a `?a5=` query parameter
(for example `/careers?a5=jobs-empty`) and regional views with `?region=`
(for example `/careers?region=DE`). Every value that is not source-established
is visibly prefixed `[DEV FIXTURE]`.

Fixtures only ever run under `npm run dev`. A production build cannot include
them, even with the flag set. Set the flag back to `false` when you finish.

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
landed in A2. The backend has no test script yet; Supertest and Vitest are
introduced with the Express application in B1. Playwright E2E arrives in
Release C.

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

# 3. Backend startup
cd ..\backend
npm start              # expect the listening line, then Ctrl+C

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
Correct until Release B. No backend exists, so the Jobs request fails and the
page reports it rather than showing invented roles. To review the role states,
use the development fixtures described under **Daily development**.

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

The table lists implemented capability, not accepted milestones. Release A is
complete only once A6 is GPT-approved after Windows and browser QA. Its
acceptance target is **ready for backend integration**; it is **not**
Phase 1 verification.

---

## Not yet built

These are scheduled, not forgotten. Each is owned by a named milestone in
`18_IMPLEMENTATION_ROADMAP.md`.

| Capability                                                                                                           | Milestone |
| -------------------------------------------------------------------------------------------------------------------- | --------- |
| `/api/v1` routing, config validation, security headers, CORS, rate limiting, logging, health and readiness endpoints | B1        |
| MongoDB connection, Job and Application models, indexes                                                              | B2        |
| Public Jobs API and Job provisioning script                                                                          | B3        |
| Private resume storage and file validation                                                                           | B4        |
| Application submission workflow                                                                                      | B5        |
| Transactional notifications                                                                                          | B6        |
| Production deployment, domain, HTTPS                                                                                 | C         |
| Production SEO: canonical host, sitemap, robots.txt, JobPosting data (need the production domain and real Jobs)      | C         |

Awaiting input rather than scheduled: the production API origin, real approved
Job content and per-market compensation, a corporate contact mechanism, and a
smaller approved transparent logo export.

---

## Documentation authority

Implementation is governed by the Valida Master Prompt Version 3.0 and canonical
Documents 00-18, all BASELINED. Where this README and a canonical document
disagree, the canonical document wins.
