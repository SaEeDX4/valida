# Valida

Public website and platform for **Valida** (legal entity: Valida MB).

One repository. One React frontend. One Express backend. One MongoDB database
(from Milestone B2). Built milestone-by-milestone according to
`18_IMPLEMENTATION_ROADMAP.md`.

---

## Current state

| Item | Status |
| --- | --- |
| Release | A — Fast Website Foundation |
| Milestone | A1 — Repository & Runtime Foundation |
| Frontend | Runs and builds. No routing, no design system, no pages yet. |
| Backend | Starts and stops. No routes, no database, no API yet. |
| Database | Not connected (Milestone B2) |

A1 delivers a working project foundation, not the website. Anything the
foundation does not yet do is listed under **Not in A1** below.

---

## Prerequisites

| Tool | Required version | Check with |
| --- | --- | --- |
| Node.js | 24.x (Active LTS "Krypton") | `node -v` |
| npm | Ships with Node 24 | `npm -v` |
| Git | Any recent version | `git --version` |

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
│   ├── src/
│   │   ├── app/
│   │   │   └── App.jsx
│   │   └── main.jsx
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
├── docs/              repository documentation
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

Open <http://localhost:5173> in a browser. You should see the heading
**"Valida — frontend runtime foundation"**, no browser console errors, and no
red text in the terminal.

---

## Commands reference

### Frontend (`frontend/`)

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm ci` | Clean reproducible install from `package-lock.json` |
| `npm run dev` | Vite dev server on <http://localhost:5173> |
| `npm run build` | Production build into `frontend/dist/` |
| `npm run preview` | Serve the built output on <http://localhost:4173> |

### Backend (`backend/`)

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm ci` | Clean reproducible install from `package-lock.json` |
| `npm start` | Start the server |
| `npm run dev` | Start the server with automatic restart on file change |

`npm run test` is not defined yet. The canonical test stack (Vitest, React
Testing Library, Supertest, Playwright — Document 17) is introduced in
Milestone A2 for the frontend and B1 for the backend.

---

## Verifying the A1 foundation

Run all four checks. Each should complete without an error.

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

---

## Not in A1

These are scheduled, not forgotten. Each is owned by a named milestone in
`18_IMPLEMENTATION_ROADMAP.md`.

| Capability | Milestone |
| --- | --- |
| Design tokens, typography, shared UI components | A2 |
| `frontend/public/` and brand assets (favicon, logo files) | A2 |
| React Router, header, footer, layouts, 404 | A3 |
| Home, About, Privacy, Legal pages and real copy | A4 |
| Careers / Job Detail / Apply frontend states | A5 |
| Accessibility, performance and SEO quality baseline | A6 |
| `/api/v1` routing, config validation, security headers, CORS, rate limiting, logging, health and readiness endpoints | B1 |
| MongoDB connection, Job and Application models, indexes | B2 |
| Public Jobs API and Job provisioning script | B3 |
| Private resume storage and file validation | B4 |
| Application submission workflow | B5 |
| Transactional notifications | B6 |
| Production deployment, domain, HTTPS | C |

---

## Documentation authority

Implementation is governed by the Valida Master Prompt Version 3.0 and canonical
Documents 00-18, all BASELINED. Where this README and a canonical document
disagree, the canonical document wins.
