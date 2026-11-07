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
| C3-09 The backend log holds no candidate data, key, storage key or secret. Every line is scanned, including the two public-access probes; their lines are found by request id: 404, no route matched, path shape only | 406 | REAL |

**C3-09, before and after C3 r2.**

- **Before.** The backend access log wrote every request path raw. C3-01's probes of `/<storageKey>` and `/api/v1/<storageKey>` therefore put two storage keys into it. C3-09 excluded those two lines by path.
- **After.** A path that no route matched is logged only by its shape (`backend/src/middleware/requestLogger.js`). C3-09 now scans every line for every forbidden value, with no exclusion. It also checks the two probe lines: one each, 404, `routeMatched: false`, and only the path's shape.

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
